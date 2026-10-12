//! HTTP API used by the MovieBox web client.
//!
//! The server deliberately binds to loopback by default. It reuses the same
//! provider clients as the TUI and keeps resolved stream headers server-side;
//! the browser only receives a short-lived, same-origin playback URL.
//!
//! For public deployments the loopback listener is meant to sit behind the
//! production web server (see `deploy/server.mjs`). Two env vars harden it:
//!
//! * `MOVIEBOX_WEB_API_TOKEN` – optional shared access key. When set, every
//!   `/api/*` route except `/api/health` and `/api/media/*` requires the key
//!   via `Authorization: Bearer`, `X-MovieBox-Key`, or a `moviebox_key` cookie.
//!   Media routes are guarded by their unguessable per-session tokens instead.
//! * `MOVIEBOX_WEB_API_RATE_PER_MIN` – per-client request budget for the JSON
//!   API (default 120, `0` disables). Health checks and media segments are
//!   exempt so playback and Render's health probe are never throttled.

use std::collections::{HashMap, HashSet};
use std::io;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio::sync::broadcast;
use url::Url;

use crate::library::LibraryStore;
use crate::models::{BrowseMetrics, CatalogItem};
use crate::providers::ReleaseProvider;
use crate::providers::models::{
    MediaDetails, PlaybackSource, ProviderError, ProviderKind, Release, ResolutionIntent,
    SourceMirror,
};
use crate::service::MovieBoxService;

const MAX_REQUEST_LINE_BYTES: usize = 8 * 1024;
const MAX_HEADER_LINE_BYTES: usize = 8 * 1024;
const MAX_HEADERS: usize = 64;
const MAX_BODY_BYTES: usize = 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 10 * 1024 * 1024;
const STREAM_SET_TTL: Duration = Duration::from_secs(20 * 60);
const PLAYBACK_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_STREAM_SETS: usize = 512;
const MAX_PLAYBACK_SESSIONS: usize = 512;
const DEFAULT_RATE_PER_MIN: u32 = 300;
const RATE_BUCKET_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_RATE_BUCKETS: usize = 16384;
/// Homepage rows come from a remote catalog; cache them so a browser that
/// renders six carousels does not refetch the provider on every navigation.
const HOMEPAGE_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_HOMEPAGE_PAGES: usize = 8;
const RATING_TTL: Duration = Duration::from_secs(60 * 60);
const MAX_RATING_CACHE: usize = 4096;
const MAX_BATCH_IDS: usize = 12;
/// Server-sent events keep-alive interval; short enough to notice a dropped
/// socket, long enough to stay out of the client's way.
const EVENT_KEEPALIVE: Duration = Duration::from_secs(20);

type Headers = HashMap<String, String>;

struct WebState {
    service: MovieBoxService,
    media_client: reqwest::Client,
    stream_sets: Mutex<HashMap<String, CachedStreamSet>>,
    playbacks: Mutex<HashMap<String, WebPlayback>>,
    access_token: Option<String>,
    rate_per_minute: u32,
    rate_buckets: Mutex<HashMap<String, TokenBucket>>,
    /// Watchlist / progress / ratings shared by every connected browser.
    library: Arc<LibraryStore>,
    homepage_pages: Mutex<HashMap<String, (Instant, Vec<CatalogRow>)>>,
    title_meta: Mutex<HashMap<String, (Instant, TitleMeta)>>,
}

/// One homepage entry plus the metrics the catalog reported for it.
#[derive(Clone)]
struct CatalogRow {
    item: CatalogItem,
    metrics: BrowseMetrics,
}

/// Cached detail fields the browser needs on cards without a details request.
#[derive(Clone)]
struct TitleMeta {
    rating: Option<f64>,
    genres: Vec<String>,
    duration: Option<String>,
}

struct TokenBucket {
    tokens: f64,
    updated_at: Instant,
}

#[derive(Clone)]
struct CachedStreamSet {
    created_at: Instant,
    provider: ProviderKind,
    subject_id: String,
    season: usize,
    episode: usize,
    releases: Vec<Release>,
}

struct WebPlayback {
    created_at: Instant,
    source: PlaybackSource,
    primary_host: String,
    allowed_hosts: HashSet<String>,
}

struct HttpRequest {
    method: String,
    target: String,
    headers: Headers,
    body: Vec<u8>,
}

struct HttpResponse {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
}

#[derive(Deserialize)]
struct PlayRequest {
    stream_set_id: String,
    release_index: usize,
    #[serde(default)]
    mirror_index: usize,
}

impl WebState {
    fn new() -> Self {
        let media_client = crate::net::http_client_builder_base()
            .pool_max_idle_per_host(64)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .tcp_keepalive(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        let access_token = std::env::var("MOVIEBOX_WEB_API_TOKEN")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let rate_per_minute = std::env::var("MOVIEBOX_WEB_API_RATE_PER_MIN")
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok())
            .unwrap_or(DEFAULT_RATE_PER_MIN);
        Self {
            service: MovieBoxService::new(),
            media_client,
            stream_sets: Mutex::new(HashMap::new()),
            playbacks: Mutex::new(HashMap::new()),
            access_token,
            rate_per_minute,
            rate_buckets: Mutex::new(HashMap::new()),
            library: LibraryStore::new(),
            homepage_pages: Mutex::new(HashMap::new()),
            title_meta: Mutex::new(HashMap::new()),
        }
    }

    fn authorize_api_request(&self, request: &HttpRequest) -> Result<(), HttpResponse> {
        if let Some(expected) = self.access_token.as_deref() {
            if !request_presents_access_key(request, expected) {
                return Err(HttpResponse::error(
                    401,
                    "A valid access key is required. Send it as an X-MovieBox-Key header, \
                     an Authorization: Bearer header, or a moviebox_key cookie.",
                ));
            }
        }
        Ok(())
    }

    async fn enforce_rate_limit(&self, client_key: &str) -> Result<(), HttpResponse> {
        if self.rate_per_minute == 0 {
            return Ok(());
        }
        let rate = f64::from(self.rate_per_minute);
        let burst = (rate / 6.0).max(10.0);
        let mut buckets = self.rate_buckets.lock().await;
        let now = Instant::now();
        buckets.retain(|_, bucket| now.duration_since(bucket.updated_at) < RATE_BUCKET_TTL);
        if buckets.len() >= MAX_RATE_BUCKETS {
            if let Some(oldest) = buckets
                .iter()
                .min_by_key(|(_, bucket)| bucket.updated_at)
                .map(|(key, _)| key.clone())
            {
                buckets.remove(&oldest);
            }
        }
        let bucket = buckets
            .entry(client_key.to_string())
            .or_insert(TokenBucket {
                tokens: burst,
                updated_at: now,
            });
        let elapsed = now.duration_since(bucket.updated_at).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * rate / 60.0).min(burst);
        bucket.updated_at = now;
        if bucket.tokens < 1.0 {
            return Err(HttpResponse::error(
                429,
                "Too many requests. Slow down and try again shortly.",
            ));
        }
        bucket.tokens -= 1.0;
        Ok(())
    }
}

/// Start the local web API. Use `127.0.0.1:8787` for a same-device frontend.
pub async fn run(addr: &str) -> io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    let state = Arc::new(WebState::new());
    eprintln!("MovieBox-Tui web API listening on http://{addr}");

    loop {
        let (stream, peer) = listener.accept().await?;
        let state = Arc::clone(&state);
        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream, state).await {
                log::debug!("web API connection from {peer} ended: {error}");
            }
        });
    }
}

async fn handle_connection(stream: TcpStream, state: Arc<WebState>) -> io::Result<()> {
    let peer_addr = stream.peer_addr().ok();
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let request =
        match tokio::time::timeout(Duration::from_secs(10), read_request(&mut reader)).await {
            Ok(Ok(Some(request))) => request,
            Ok(Ok(None)) => return Ok(()),
            Ok(Err(error)) => {
                let status = if error.to_string().contains("too large") {
                    413
                } else {
                    400
                };
                return write_response(
                    &mut write_half,
                    HttpResponse::json(status, json!({ "error": error.to_string() })),
                    false,
                )
                .await;
            }
            Err(_) => {
                return write_response(
                    &mut write_half,
                    HttpResponse::json(408, json!({ "error": "Request timed out" })),
                    false,
                )
                .await;
            }
        };

    // Media routes carry their own unguessable per-session capability token,
    // so they skip the API access key and rate budget (segments are numerous).
    if request.target.starts_with("/api/media/") {
        return proxy_media(&request, &state, &mut write_half).await;
    }

    let (path, _query) = split_target(&request.target);
    if path != "/api/health" {
        let client_key = client_identity(&request.headers, peer_addr);
        if let Err(response) = state.enforce_rate_limit(&client_key).await {
            return write_response(&mut write_half, response, request.method == "HEAD").await;
        }
        if let Err(response) = state.authorize_api_request(&request) {
            return write_response(&mut write_half, response, request.method == "HEAD").await;
        }
    }

    // Live library sync. This response never ends on its own: it streams the
    // current library, then every change, until the browser hangs up.
    if path == "/api/library/events" && request.method == "GET" {
        return stream_library_events(&state, &mut write_half).await;
    }

    let response = route_api(&request, &state).await;
    write_response(&mut write_half, response, request.method == "HEAD").await
}

/// Identify the caller for rate limiting. The production web server sits in
/// front of this API and forwards the edge client address in
/// `X-Forwarded-For`; fall back to the socket peer otherwise.
fn client_identity(headers: &Headers, peer: Option<std::net::SocketAddr>) -> String {
    if let Some(forwarded) = headers.get("x-forwarded-for") {
        if let Some(last) = forwarded
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .next_back()
        {
            if last.len() <= 64 && !last.contains(|c: char| c.is_whitespace()) {
                return last.to_ascii_lowercase();
            }
        }
    }
    peer.map(|peer| peer.ip().to_string()).unwrap_or_default()
}

fn request_presents_access_key(request: &HttpRequest, expected: &str) -> bool {
    const BEARER_PREFIX: &str = "bearer ";
    if let Some(auth) = request.headers.get("authorization")
        && auth.len() > BEARER_PREFIX.len()
        && auth
            .get(..BEARER_PREFIX.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(BEARER_PREFIX))
        && let Some(token) = auth.get(BEARER_PREFIX.len()..)
        && constant_time_eq(token.trim(), expected)
    {
        return true;
    }
    if let Some(key) = request.headers.get("x-moviebox-key")
        && constant_time_eq(key.trim(), expected)
    {
        return true;
    }
    if let Some(cookie) = request.headers.get("cookie") {
        for part in cookie.split(';') {
            if let Some((name, value)) = part.trim().split_once('=')
                && name.trim() == "moviebox_key"
                && constant_time_eq(value.trim(), expected)
            {
                return true;
            }
        }
    }
    false
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

async fn read_request(reader: &mut BufReader<OwnedReadHalf>) -> io::Result<Option<HttpRequest>> {
    let mut request_line = String::new();
    let read = reader.read_line(&mut request_line).await?;
    if read == 0 {
        return Ok(None);
    }
    if request_line.len() > MAX_REQUEST_LINE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "request line too large",
        ));
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_ascii_uppercase();
    let target = parts.next().unwrap_or("/").to_string();
    if !target.starts_with('/') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "only origin-form request targets are accepted",
        ));
    }

    let mut headers = HashMap::new();
    let mut header_count = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await? == 0 {
            break;
        }
        if line.len() > MAX_HEADER_LINE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request header too large",
            ));
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        header_count += 1;
        if header_count > MAX_HEADERS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "too many request headers",
            ));
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    if headers
        .get("transfer-encoding")
        .is_some_and(|value| value.to_ascii_lowercase().contains("chunked"))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "chunked request bodies are not supported",
        ));
    }

    let body_len = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if body_len > MAX_BODY_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "request body too large",
        ));
    }
    let mut body = vec![0; body_len];
    if body_len > 0 {
        reader.read_exact(&mut body).await?;
    }

    Ok(Some(HttpRequest {
        method,
        target,
        headers,
        body,
    }))
}

impl HttpResponse {
    fn json(status: u16, value: Value) -> Self {
        let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
        Self {
            status,
            content_type: "application/json; charset=utf-8",
            body,
        }
    }

    fn error(status: u16, message: impl Into<String>) -> Self {
        let message = message.into();
        Self::json(status, json!({ "error": message }))
    }
}

async fn route_api(request: &HttpRequest, state: &WebState) -> HttpResponse {
    if request.method == "OPTIONS" {
        return HttpResponse {
            status: 204,
            content_type: "application/json; charset=utf-8",
            body: Vec::new(),
        };
    }
    if request.method != "GET" && request.method != "POST" && request.method != "HEAD" {
        return HttpResponse::error(405, "Method not allowed");
    }

    let (path, query) = split_target(&request.target);
    match path {
        "/api/health" if request.method == "GET" || request.method == "HEAD" => HttpResponse::json(
            200,
            json!({
                "status": "ok",
                "mode": "live",
                "engine": "MovieBox-Tui",
                "version": env!("CARGO_PKG_VERSION"),
            }),
        ),
        "/api/providers" if request.method == "GET" || request.method == "HEAD" => {
            let providers = [
                ProviderKind::MovieBox,
                ProviderKind::FourKHdHub,
                ProviderKind::Dramachi,
                ProviderKind::BdixCircleFtp,
                ProviderKind::BdixDhakaFlix,
                ProviderKind::Addons,
            ]
            .into_iter()
            .map(|provider| {
                json!({
                    "id": provider_id(provider),
                    "name": provider.label(),
                })
            })
            .collect::<Vec<_>>();
            HttpResponse::json(200, json!(providers))
        }
        "/api/discover" if request.method == "GET" || request.method == "HEAD" => {
            discover(query, state).await
        }
        "/api/search" if request.method == "GET" || request.method == "HEAD" => {
            search(query, state).await
        }
        "/api/details" if request.method == "GET" || request.method == "HEAD" => {
            details(query, state).await
        }
        "/api/streams" if request.method == "GET" || request.method == "HEAD" => {
            streams(query, state).await
        }
        "/api/play" if request.method == "POST" => play(request, state).await,
        "/api/suggest" if request.method == "GET" || request.method == "HEAD" => {
            suggest(query, state).await
        }
        "/api/collections" if request.method == "GET" || request.method == "HEAD" => {
            collections(query, state).await
        }
        "/api/related" if request.method == "GET" || request.method == "HEAD" => {
            related(query, state).await
        }
        "/api/meta" if request.method == "GET" || request.method == "HEAD" => {
            title_meta_batch(query, state).await
        }
        "/api/library" if request.method == "GET" || request.method == "HEAD" => {
            HttpResponse::json(200, state.library.to_json().await)
        }
        "/api/library/watchlist" if request.method == "POST" => {
            library_watchlist(request, state).await
        }
        "/api/library/progress" if request.method == "POST" => library_progress(request, state).await,
        "/api/library/rating" if request.method == "POST" => library_rating(request, state).await,
        "/api/library/clear" if request.method == "POST" => library_clear(request, state).await,
        _ => HttpResponse::error(404, "Unknown API route"),
    }
}

async fn discover(query: &str, state: &WebState) -> HttpResponse {
    let params = parse_query(query);
    let provider = match parse_provider(params.get("provider")) {
        Ok(provider) => provider,
        Err(message) => return HttpResponse::error(400, message),
    };
    if provider != ProviderKind::MovieBox {
        return HttpResponse::error(400, "Discover is currently available for MovieBox only");
    }
    let page = parse_page(params.get("page"));
    match state.service.homepage("2", page).await {
        Ok((items, metrics)) => {
            HttpResponse::json(200, json!({ "items": items, "metrics": metrics }))
        }
        Err(error) => HttpResponse::error(502, error),
    }
}

// ---------------------------------------------------------------------------
// Discovery extras: carousels, related titles, autocomplete and card metadata
// ---------------------------------------------------------------------------

struct CollectionRow {
    key: &'static str,
    label: &'static str,
    hint: &'static str,
}

/// The home screen carousels. `continue` (resume watching) is assembled in the
/// browser from the library, because it is per-viewer state.
const COLLECTION_ROWS: [CollectionRow; 4] = [
    CollectionRow {
        key: "trending",
        label: "Trending Now",
        hint: "What everyone is watching this week",
    },
    CollectionRow {
        key: "top_rated",
        label: "Top Rated",
        hint: "Highest IMDb scores of all time",
    },
    CollectionRow {
        key: "fresh",
        label: "Fresh & Highly Rated",
        hint: "Recent releases critics liked",
    },
    CollectionRow {
        key: "most_watched",
        label: "Most Watched",
        hint: "Community favourites",
    },
];

async fn suggest(query: &str, state: &WebState) -> HttpResponse {
    let params = parse_query(query);
    let term = params
        .get("q")
        .or_else(|| params.get("query"))
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if term.is_empty() {
        return HttpResponse::json(200, json!({ "suggestions": [] }));
    }
    if term.len() > 120 {
        return HttpResponse::error(400, "Search query is too long");
    }
    match state.service.suggest(term).await {
        Ok(suggestions) => HttpResponse::json(200, json!({ "suggestions": suggestions })),
        Err(message) => HttpResponse::error(502, message),
    }
}

async fn collections(query: &str, state: &WebState) -> HttpResponse {
    let params = parse_query(query);
    let per_row = parse_usize(params.get("limit"), 24, 48).clamp(8, 48);
    let pages = parse_usize(params.get("pages"), 3, MAX_HOMEPAGE_PAGES).clamp(1, MAX_HOMEPAGE_PAGES);
    let pool = match homepage_pool(state, pages).await {
        Ok(pool) => pool,
        Err(message) => return HttpResponse::error(502, message),
    };
    let mut rows: Vec<Value> = Vec::new();
    let mut metrics_map = serde_json::Map::new();
    for row in COLLECTION_ROWS {
        let entries = ranked_entries(&pool, row.key, per_row);
        if entries.is_empty() {
            continue;
        }
        let items: Vec<Value> = entries
            .into_iter()
            .map(|entry| {
                let metric = serde_json::to_value(entry.metrics).unwrap_or(Value::Null);
                metrics_map.insert(entry.item.id.value.clone(), metric);
                serde_json::to_value(&entry.item).unwrap_or(Value::Null)
            })
            .collect();
        rows.push(json!({
            "key": row.key,
            "label": row.label,
            "hint": row.hint,
            "items": items,
        }));
    }
    HttpResponse::json(
        200,
        json!({
            "rows": rows,
            "metrics": Value::Object(metrics_map),
            "source": "moviebox",
        }),
    )
}

/// Metric used to rank a carousel.
fn row_value(row: &CatalogRow, key: &str) -> f64 {
    match key {
        "trending" => row.metrics.trending.unwrap_or(0.0),
        "top_rated" => row.metrics.rating.unwrap_or(0.0),
        "fresh" => row.metrics.recent_rating.unwrap_or(0.0),
        _ => row.metrics.popularity.unwrap_or(0.0),
    }
}

fn ranked_entries<'a>(pool: &'a [CatalogRow], key: &str, limit: usize) -> Vec<&'a CatalogRow> {
    let mut entries: Vec<&CatalogRow> = pool
        .iter()
        .filter(|row| row_value(row, key) > 0.0)
        .collect();
    entries.sort_by(|a, b| {
        row_value(b, key)
            .partial_cmp(&row_value(a, key))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    entries.truncate(limit);
    entries
}

async fn homepage_pool(state: &WebState, pages: usize) -> Result<Vec<CatalogRow>, String> {
    let mut pool: Vec<CatalogRow> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for page in 1..=pages {
        let cache_key = format!("homepage:{page}");
        let cached = {
            let cache = state.homepage_pages.lock().await;
            cache
                .get(&cache_key)
                .and_then(|(fetched, rows)| (fetched.elapsed() < HOMEPAGE_TTL).then(|| rows.clone()))
        };
        let rows = match cached {
            Some(rows) => rows,
            None => {
                let (items, metrics) = state.service.homepage("2", page).await?;
                let rows: Vec<CatalogRow> = items
                    .into_iter()
                    .map(|item| {
                        let row_metrics = metrics.get(&item.id.value).copied().unwrap_or_default();
                        CatalogRow {
                            item,
                            metrics: row_metrics,
                        }
                    })
                    .collect();
                let mut cache = state.homepage_pages.lock().await;
                cache.retain(|_, (fetched, _)| fetched.elapsed() < HOMEPAGE_TTL);
                if cache.len() >= MAX_HOMEPAGE_PAGES {
                    cache.clear();
                }
                cache.insert(cache_key, (Instant::now(), rows.clone()));
                rows
            }
        };
        for row in rows {
            if seen.insert(row.item.id.value.clone()) {
                pool.push(row);
            }
        }
    }
    Ok(pool)
}

struct RelatedSeed {
    term: String,
    reason: String,
    weight: i32,
}

const SEED_STOPWORDS: [&str; 14] = [
    "the", "a", "an", "of", "and", "in", "on", "to", "for", "part", "my", "ii", "iii", "untitled",
];

/// Search terms that plausibly return titles related to `details`, ordered by
/// how strongly they predict "you will also like this".
fn related_seeds(details: &MediaDetails) -> Vec<RelatedSeed> {
    let mut seeds: Vec<RelatedSeed> = Vec::new();
    if let Some(director) = details
        .director
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 80)
    {
        seeds.push(RelatedSeed {
            term: director.to_string(),
            reason: format!("More from {director}"),
            weight: 3,
        });
    }
    for genre in details
        .genres
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .take(3)
    {
        seeds.push(RelatedSeed {
            term: genre.to_string(),
            reason: format!("Because you like {genre}"),
            weight: 2,
        });
    }
    if let Some(token) = franchise_token(&details.title) {
        seeds.push(RelatedSeed {
            reason: format!("More {token} titles"),
            term: token,
            weight: 1,
        });
    }
    seeds.truncate(6);
    seeds
}

/// First meaningful word of a title, which usually is the franchise name.
fn franchise_token(title: &str) -> Option<String> {
    title
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .find(|word| {
            word.chars().count() > 3 && !SEED_STOPWORDS.contains(&word.to_ascii_lowercase().as_str())
        })
        .map(str::to_string)
}

async fn related(query: &str, state: &WebState) -> HttpResponse {
    let params = parse_query(query);
    let provider = match parse_provider(params.get("provider")) {
        Ok(provider) => provider,
        Err(message) => return HttpResponse::error(400, message),
    };
    let id = params
        .get("id")
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if id.is_empty() || id.len() > 512 {
        return HttpResponse::error(400, "A valid title id is required");
    }
    let limit = parse_usize(params.get("limit"), 18, 40).clamp(6, 40);
    let details = match state.service.details_typed(provider, id).await {
        Ok(details) => details,
        Err(error) => return HttpResponse::error(502, provider_error_message(provider, error)),
    };
    let seeds = related_seeds(&details);
    if seeds.is_empty() {
        return HttpResponse::json(
            200,
            json!({ "items": [], "reasons": {}, "seeds": [], "source_id": id }),
        );
    }
    let searches = futures::future::join_all(
        seeds
            .iter()
            .map(|seed| state.service.search_typed(provider, &seed.term, 1)),
    )
    .await;

    let mut order: Vec<String> = Vec::new();
    let mut scores: HashMap<String, i32> = HashMap::new();
    let mut items: HashMap<String, CatalogItem> = HashMap::new();
    let mut reasons: HashMap<String, Vec<String>> = HashMap::new();
    for (index, result) in searches.into_iter().enumerate() {
        let Ok(found) = result else { continue };
        let seed = &seeds[index];
        for item in found {
            if item.id.value.trim() == id {
                continue;
            }
            let key = item.id.value.clone();
            *scores.entry(key.clone()).or_insert(0) += seed.weight;
            let entry_reasons = reasons.entry(key.clone()).or_default();
            if !entry_reasons.contains(&seed.reason) {
                entry_reasons.push(seed.reason.clone());
            }
            items.entry(key.clone()).or_insert(item);
            if !order.contains(&key) {
                order.push(key);
            }
        }
    }
    order.sort_by(|a, b| {
        scores
            .get(b)
            .copied()
            .unwrap_or(0)
            .cmp(&scores.get(a).copied().unwrap_or(0))
    });
    order.truncate(limit);

    let mut selected: Vec<Value> = Vec::new();
    let mut selected_reasons = serde_json::Map::new();
    for key in &order {
        if let Some(item) = items.get(key) {
            selected.push(serde_json::to_value(item).unwrap_or(Value::Null));
        }
        if let Some(entry_reasons) = reasons.get(key) {
            selected_reasons.insert(key.clone(), json!(entry_reasons));
        }
    }
    HttpResponse::json(
        200,
        json!({
            "items": selected,
            "reasons": Value::Object(selected_reasons),
            "seeds": seeds
                .iter()
                .map(|seed| json!({ "term": seed.term, "reason": seed.reason }))
                .collect::<Vec<_>>(),
            "source_id": id,
        }),
    )
}

/// Card metadata (official rating, genres, runtime) for a batch of ids, so the
/// browser can show IMDb scores on search results and watchlist entries without
/// opening every title.
async fn title_meta_batch(query: &str, state: &WebState) -> HttpResponse {
    let params = parse_query(query);
    let provider = match parse_provider(params.get("provider")) {
        Ok(provider) => provider,
        Err(message) => return HttpResponse::error(400, message),
    };
    let ids: Vec<String> = params
        .get("id")
        .map(String::as_str)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 512)
        .take(MAX_BATCH_IDS)
        .map(str::to_string)
        .collect();
    if ids.is_empty() {
        return HttpResponse::json(200, json!({ "meta": {} }));
    }

    let mut meta = serde_json::Map::new();
    let mut pending: Vec<String> = Vec::new();
    {
        let cache = state.title_meta.lock().await;
        for id in &ids {
            let key = format!("{}:{id}", provider.cache_key());
            match cache.get(&key) {
                Some((fetched, cached)) if fetched.elapsed() < RATING_TTL => {
                    meta.insert(id.clone(), meta_json(cached));
                }
                _ => pending.push(id.clone()),
            }
        }
    }

    if !pending.is_empty() {
        let fetched = futures::future::join_all(
            pending
                .iter()
                .map(|id| state.service.details_typed(provider, id)),
        )
        .await;
        let mut resolved: Vec<(String, TitleMeta)> = Vec::new();
        for (index, result) in fetched.into_iter().enumerate() {
            let Ok(details) = result else { continue };
            let rating = details
                .imdb_rating
                .as_deref()
                .and_then(|value| value.trim().parse::<f64>().ok());
            resolved.push((
                pending[index].clone(),
                TitleMeta {
                    rating,
                    genres: details.genres.clone(),
                    duration: details.duration.clone(),
                },
            ));
        }
        if !resolved.is_empty() {
            let mut cache = state.title_meta.lock().await;
            cache.retain(|_, (fetched, _)| fetched.elapsed() < RATING_TTL);
            if cache.len() >= MAX_RATING_CACHE {
                cache.clear();
            }
            for (id, value) in &resolved {
                cache.insert(
                    format!("{}:{id}", provider.cache_key()),
                    (Instant::now(), value.clone()),
                );
            }
        }
        for (id, value) in resolved {
            meta.insert(id, meta_json(&value));
        }
    }
    HttpResponse::json(200, json!({ "meta": Value::Object(meta) }))
}

fn meta_json(meta: &TitleMeta) -> Value {
    json!({
        "rating": meta.rating,
        "genres": meta.genres,
        "duration": meta.duration,
    })
}

// ---------------------------------------------------------------------------
// Library: watchlist, watch progress and personal ratings
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct LibraryItemRequest {
    provider: String,
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    poster_url: Option<String>,
    #[serde(default)]
    year: Option<String>,
    #[serde(default)]
    media_type: Option<String>,
    #[serde(default)]
    official_rating: Option<f64>,
    #[serde(default)]
    remove: bool,
}

#[derive(Deserialize)]
struct ProgressRequest {
    provider: String,
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    poster_url: Option<String>,
    #[serde(default)]
    year: Option<String>,
    #[serde(default)]
    media_type: Option<String>,
    #[serde(default)]
    season: usize,
    #[serde(default)]
    episode: usize,
    #[serde(default)]
    position_seconds: u64,
    #[serde(default)]
    duration_seconds: Option<u64>,
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    remove: bool,
}

#[derive(Deserialize)]
struct RatingRequest {
    provider: String,
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    poster_url: Option<String>,
    #[serde(default)]
    year: Option<String>,
    rating: u8,
}

#[derive(Deserialize)]
struct ClearRequest {
    #[serde(default)]
    scope: String,
}

fn normalize_media_type(value: Option<String>) -> Option<String> {
    value.map(|value| {
        match value.trim().to_ascii_lowercase().as_str() {
            "series" | "tv" | "show" | "2" => "series",
            _ => "movie",
        }
        .to_string()
    })
}

fn parse_library_target(provider: &str, id: &str) -> Result<(ProviderKind, String), HttpResponse> {
    let kind = match ProviderKind::parse(provider) {
        Some(kind) => kind,
        None => return Err(HttpResponse::error(400, "Unknown content provider")),
    };
    let id = id.trim();
    if id.is_empty() || id.len() > 512 {
        return Err(HttpResponse::error(400, "A valid title id is required"));
    }
    Ok((kind, id.to_string()))
}

async fn library_watchlist(request: &HttpRequest, state: &WebState) -> HttpResponse {
    let body: LibraryItemRequest = match serde_json::from_slice(&request.body) {
        Ok(body) => body,
        Err(error) => {
            return HttpResponse::error(400, format!("Invalid watchlist request: {error}"))
        }
    };
    let (provider, id) = match parse_library_target(&body.provider, &body.id) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let entry = crate::library::watchlist_entry(
        provider_id(provider),
        &id,
        body.title.trim(),
        body.poster_url,
        body.year,
        normalize_media_type(body.media_type),
        body.official_rating,
    );
    let listed = state.library.toggle_watchlist(entry, body.remove).await;
    library_response(state, json!({ "listed": listed })).await
}

async fn library_progress(request: &HttpRequest, state: &WebState) -> HttpResponse {
    let body: ProgressRequest = match serde_json::from_slice(&request.body) {
        Ok(body) => body,
        Err(error) => {
            return HttpResponse::error(400, format!("Invalid progress request: {error}"))
        }
    };
    let (provider, id) = match parse_library_target(&body.provider, &body.id) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let entry = crate::library::progress_entry(
        provider_id(provider),
        &id,
        body.title.trim(),
        body.poster_url,
        body.year,
        normalize_media_type(body.media_type),
        body.season,
        body.episode,
        body.position_seconds,
        body.duration_seconds,
        body.completed,
    );
    let stored = state.library.upsert_progress(entry, body.remove).await;
    library_response(state, json!({ "stored": stored })).await
}

async fn library_rating(request: &HttpRequest, state: &WebState) -> HttpResponse {
    let body: RatingRequest = match serde_json::from_slice(&request.body) {
        Ok(body) => body,
        Err(error) => return HttpResponse::error(400, format!("Invalid rating request: {error}")),
    };
    let (provider, id) = match parse_library_target(&body.provider, &body.id) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let entry = crate::library::rating_entry(
        provider_id(provider),
        &id,
        body.title.trim(),
        body.poster_url,
        body.year,
        body.rating,
    );
    let rated = state.library.set_rating(entry).await;
    library_response(state, json!({ "rated": rated })).await
}

async fn library_clear(request: &HttpRequest, state: &WebState) -> HttpResponse {
    let scope = match serde_json::from_slice::<ClearRequest>(&request.body) {
        Ok(body) => body.scope,
        Err(_) => String::new(),
    };
    let scope = match scope.trim().to_ascii_lowercase().as_str() {
        "watchlist" | "progress" | "ratings" => scope.trim().to_ascii_lowercase(),
        _ => "all".to_string(),
    };
    state.library.clear(&scope).await;
    library_response(state, json!({ "cleared": scope })).await
}

/// Full library payload plus any per-route extras, so one round trip resyncs
/// the browser after a mutation.
async fn library_response(state: &WebState, extras: Value) -> HttpResponse {
    let mut payload = match state.library.to_json().await {
        Value::Object(map) => map,
        other => {
            let mut map = serde_json::Map::new();
            map.insert("library".to_string(), other);
            map
        }
    };
    if let Value::Object(extras) = extras {
        for (key, value) in extras {
            payload.insert(key, value);
        }
    }
    HttpResponse::json(200, Value::Object(payload))
}

// ---------------------------------------------------------------------------
// Server-sent events: live library sync
// ---------------------------------------------------------------------------

async fn write_sse_frame(
    writer: &mut OwnedWriteHalf,
    event: &str,
    payload: &Value,
) -> io::Result<()> {
    let body = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
    let frame = format!("event: {event}\ndata: {body}\n\n");
    writer.write_all(frame.as_bytes()).await?;
    writer.flush().await
}

async fn stream_library_events(state: &WebState, writer: &mut OwnedWriteHalf) -> io::Result<()> {
    const HEADERS: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\n\
                           Cache-Control: no-store, no-transform\r\nX-Accel-Buffering: no\r\n\
                           Connection: close\r\n\r\n";
    writer.write_all(HEADERS.as_bytes()).await?;
    writer.flush().await?;

    let mut receiver = state.library.subscribe();
    let initial = state.library.to_json().await;
    if write_sse_frame(writer, "library", &initial).await.is_err() {
        return Ok(());
    }
    let mut ticker = tokio::time::interval(EVENT_KEEPALIVE);
    // The first tick fires immediately; consume it so keep-alives stay spaced.
    ticker.tick().await;
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if write_sse_frame(writer, "ping", &json!({})).await.is_err() {
                    return Ok(());
                }
            }
            received = receiver.recv() => match received {
                Ok(_event) => {
                    let payload = state.library.to_json().await;
                    if write_sse_frame(writer, "library", &payload).await.is_err() {
                        return Ok(());
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => return Ok(()),
            },
        }
    }
}

async fn search(query: &str, state: &WebState) -> HttpResponse {
    let params = parse_query(query);
    let search_query = params
        .get("q")
        .or_else(|| params.get("query"))
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if search_query.is_empty() {
        return HttpResponse::error(400, "Search query is required");
    }
    if search_query.len() > 200 {
        return HttpResponse::error(400, "Search query is too long");
    }
    let provider = match parse_provider(params.get("provider")) {
        Ok(provider) => provider,
        Err(message) => return HttpResponse::error(400, message),
    };
    let page = parse_page(params.get("page"));
    match state
        .service
        .search_typed(provider, search_query, page)
        .await
    {
        Ok(items) => HttpResponse::json(200, json!(items)),
        Err(error) => HttpResponse::error(502, provider_error_message(provider, error)),
    }
}

async fn details(query: &str, state: &WebState) -> HttpResponse {
    let params = parse_query(query);
    let provider = match parse_provider(params.get("provider")) {
        Ok(provider) => provider,
        Err(message) => return HttpResponse::error(400, message),
    };
    let id = params
        .get("id")
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if id.is_empty() || id.len() > 512 {
        return HttpResponse::error(400, "A valid title id is required");
    }
    match state.service.details_typed(provider, id).await {
        Ok(item) => HttpResponse::json(200, json!(item)),
        Err(error) => HttpResponse::error(502, provider_error_message(provider, error)),
    }
}

async fn streams(query: &str, state: &WebState) -> HttpResponse {
    let params = parse_query(query);
    let provider = match parse_provider(params.get("provider")) {
        Ok(provider) => provider,
        Err(message) => return HttpResponse::error(400, message),
    };
    let id = params
        .get("id")
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if id.is_empty() || id.len() > 512 {
        return HttpResponse::error(400, "A valid title id is required");
    }
    let season = parse_usize(params.get("season"), 0, 500);
    let episode = parse_usize(params.get("episode"), 0, 5000);
    let is_series = params
        .get("is_series")
        .is_some_and(|value| value == "true" || value == "1")
        || season > 0
        || episode > 0
        || id.starts_with("series:")
        || id.starts_with("tv:")
        || id.starts_with("anime:");

    let mut releases =
        match fetch_releases(&state.service, provider, id, season, episode, is_series).await {
            Ok(releases) => releases,
            Err(message) => return HttpResponse::error(502, message),
        };
    if releases.is_empty() {
        return HttpResponse::error(404, "No playable streams found for this title");
    }
    // Sort releases to bring best playable links to top (fixes video-only/audio-only by prioritizing reliable providers)
    releases.sort_by(|a, b| {
        // Web playback order: Sakshi (Dramachi) first, then Ritu (4KHDHub), then Siddharth (MovieBox).
        let provider_priority = |p: ProviderKind| match p {
            ProviderKind::Dramachi => 0,
            ProviderKind::FourKHdHub => 1,
            ProviderKind::MovieBox => 2,
            ProviderKind::Addons => 3,
            ProviderKind::BdixCircleFtp => 4,
            ProviderKind::BdixDhakaFlix => 5,
        };
        let pa = provider_priority(a.provider);
        let pb = provider_priority(b.provider);
        if pa != pb {
            return pa.cmp(&pb);
        }
        // Higher quality first
        let qa = a.resolution_u64();
        let qb = b.resolution_u64();
        qb.cmp(&qa).then_with(|| b.size_bytes.cmp(&a.size_bytes))
    });

    let stream_set_id = opaque_token();
    let mut sets = state.stream_sets.lock().await;
    sets.retain(|_, value| value.created_at.elapsed() < STREAM_SET_TTL);
    if sets.len() >= MAX_STREAM_SETS {
        if let Some(oldest) = sets
            .iter()
            .min_by_key(|(_, value)| value.created_at)
            .map(|(key, _)| key.clone())
        {
            sets.remove(&oldest);
        }
    }
    sets.insert(
        stream_set_id.clone(),
        CachedStreamSet {
            created_at: Instant::now(),
            provider,
            subject_id: id.to_string(),
            season,
            episode,
            releases: releases.clone(),
        },
    );
    let public_releases = releases
        .into_iter()
        .map(|mut release| {
            for mirror in &mut release.mirrors {
                // URLs and request headers stay in the server-side stream set;
                // the browser only needs the source label and release metadata.
                mirror.resolver_url.clear();
                mirror.headers.clear();
            }
            release
        })
        .collect::<Vec<_>>();
    HttpResponse::json(
        200,
        json!({
            "stream_set_id": stream_set_id,
            "blocked_addons": [],
            "releases": public_releases,
        }),
    )
}

async fn fetch_releases(
    service: &MovieBoxService,
    provider: ProviderKind,
    subject_id: &str,
    season: usize,
    episode: usize,
    is_series: bool,
) -> Result<Vec<Release>, String> {
    let result: Result<Vec<Release>, ProviderError> = match provider {
        ProviderKind::MovieBox => {
            ReleaseProvider::episode_streams(&service.client, subject_id, season, episode).await
        }
        ProviderKind::FourKHdHub => match service.fourk_client.as_ref() {
            Some(client) => {
                ReleaseProvider::episode_streams(client, subject_id, season, episode).await
            }
            None => Err(ProviderError::Unavailable(
                "4KHDHub is unavailable".to_string(),
            )),
        },
        ProviderKind::Dramachi => {
            ReleaseProvider::episode_streams(&service.dramachi_client, subject_id, season, episode)
                .await
        }
        ProviderKind::BdixCircleFtp => {
            ReleaseProvider::episode_streams(&service.circleftp_client, subject_id, season, episode)
                .await
        }
        ProviderKind::BdixDhakaFlix => {
            ReleaseProvider::episode_streams(&service.dhakaflix_client, subject_id, season, episode)
                .await
        }
        ProviderKind::Addons => {
            let installed = crate::config::load_addons();
            let (releases, _blocked_addons) = crate::providers::addons::aggregate_streams(
                &service.addon_client,
                &installed,
                subject_id,
                season,
                episode,
                is_series,
            )
            .await;
            Ok(releases)
        }
    };
    result.map_err(|error| {
        if provider == ProviderKind::Addons {
            error.to_string()
        } else {
            provider_error_message(provider, error)
        }
    })
}

async fn play(request: &HttpRequest, state: &WebState) -> HttpResponse {
    let request: PlayRequest = match serde_json::from_slice(&request.body) {
        Ok(request) => request,
        Err(error) => return HttpResponse::error(400, format!("Invalid play request: {error}")),
    };

    let stream_set = {
        let mut sets = state.stream_sets.lock().await;
        sets.retain(|_, value| value.created_at.elapsed() < STREAM_SET_TTL);
        match sets.get(&request.stream_set_id) {
            Some(value) => value.clone(),
            None => {
                return HttpResponse::error(
                    410,
                    "Stream list expired. Refresh the stream list and try again.",
                );
            }
        }
    };
    let release = match stream_set.releases.get(request.release_index) {
        Some(release) => release.clone(),
        None => return HttpResponse::error(400, "Selected stream does not exist"),
    };

    let source =
        match resolve_source(&state.service, &stream_set, &release, request.mirror_index).await {
            Ok(source) => source,
            Err(message) => return HttpResponse::error(502, message),
        };
    let source_url = match Url::parse(&source.url) {
        Ok(url)
            if matches!(url.scheme(), "http" | "https")
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none() =>
        {
            url
        }
        _ => return HttpResponse::error(502, "The stream resolver returned an invalid URL"),
    };
    let primary_host = authority(&source_url);
    let token = opaque_token();
    let mut allowed_hosts = HashSet::new();
    allowed_hosts.insert(primary_host.clone());

    let media_url = media_route(&token, &source_url);
    let stream_type = stream_type(&source_url);
    {
        let mut playbacks = state.playbacks.lock().await;
        playbacks.retain(|_, value| value.created_at.elapsed() < PLAYBACK_TTL);
        if playbacks.len() >= MAX_PLAYBACK_SESSIONS {
            if let Some(oldest) = playbacks
                .iter()
                .min_by_key(|(_, value)| value.created_at)
                .map(|(key, _)| key.clone())
            {
                playbacks.remove(&oldest);
            }
        }
        playbacks.insert(
            token,
            WebPlayback {
                created_at: Instant::now(),
                source: source.clone(),
                primary_host,
                allowed_hosts,
            },
        );
    }

    HttpResponse::json(
        200,
        json!({
            "playback_url": media_url,
            "stream_type": stream_type,
            "source_label": source.source_label,
            "quality": release.quality,
            "title": release.filename,
            "provider": provider_id(stream_set.provider),
        }),
    )
}

async fn proxy_media(
    request: &HttpRequest,
    state: &WebState,
    writer: &mut OwnedWriteHalf,
) -> io::Result<()> {
    if request.method != "GET" && request.method != "HEAD" {
        return write_proxy_error(writer, 405, "Method not allowed").await;
    }
    let (token, target_url) = match parse_media_target(&request.target) {
        Some(value) => value,
        None => return write_proxy_error(writer, 400, "Invalid media URL").await,
    };

    let (source, primary_host, mut allowed_hosts) = {
        let mut playbacks = state.playbacks.lock().await;
        playbacks.retain(|_, value| value.created_at.elapsed() < PLAYBACK_TTL);
        let Some(playback) = playbacks.get(&token) else {
            return write_proxy_error(writer, 404, "Playback session expired").await;
        };
        let requested_host = authority(&target_url);
        if !playback.allowed_hosts.contains(&requested_host) {
            return write_proxy_error(
                writer,
                403,
                "Media host is not part of this playback session",
            )
            .await;
        }
        (
            playback.source.clone(),
            playback.primary_host.clone(),
            playback.allowed_hosts.clone(),
        )
    };

    let target_host = authority(&target_url);
    let mut upstream = if request.method == "HEAD" {
        state.media_client.head(target_url.clone())
    } else {
        state.media_client.get(target_url.clone())
    };

    // Provider auth is kept on the Rust side and only forwarded to the
    // stream's original host. Browser Range requests are forwarded separately.
    if target_host == primary_host {
        for (name, value) in &source.headers {
            let lower = name.to_ascii_lowercase();
            if matches!(
                lower.as_str(),
                "host"
                    | "connection"
                    | "content-length"
                    | "transfer-encoding"
                    | "accept-encoding"
                    | "range"
                    | "if-range"
            ) {
                continue;
            }
            if let (Ok(header_name), Ok(header_value)) = (
                reqwest::header::HeaderName::from_bytes(name.as_bytes()),
                reqwest::header::HeaderValue::from_str(value),
            ) {
                upstream = upstream.header(header_name, header_value);
            }
        }
    }
    if let Some(range) = request.headers.get("range") {
        upstream = upstream.header(reqwest::header::RANGE, range.as_str());
    }
    if let Some(if_range) = request.headers.get("if-range") {
        upstream = upstream.header("If-Range", if_range.as_str());
    }

    let response = match upstream.send().await {
        Ok(response) => response,
        Err(error) => {
            log::warn!("web stream proxy request failed: {error}");
            return write_proxy_error(writer, 502, "Upstream stream request failed").await;
        }
    };
    let status = response.status();
    let final_url = response.url().clone();
    let response_headers = response.headers().clone();
    if let Some(final_host) = final_url.host_str() {
        let mut key = final_host.to_ascii_lowercase();
        if let Some(port) = final_url.port() {
            key.push(':');
            key.push_str(&port.to_string());
        }
        allowed_hosts.insert(key);
    }
    {
        let mut playbacks = state.playbacks.lock().await;
        if let Some(playback) = playbacks.get_mut(&token) {
            playback.allowed_hosts.extend(allowed_hosts.iter().cloned());
        }
    }

    let content_type = response_headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let path_lower = final_url.path().to_ascii_lowercase();
    let content_type_lower = content_type.to_ascii_lowercase();
    let source_is_dash_root = Url::parse(&source.url)
        .ok()
        .is_some_and(|source_url| source_url == target_url)
        && crate::player::is_dash_url(&source.url);
    let is_dash = path_lower.ends_with(".mpd")
        || content_type_lower.contains("dash+xml")
        || content_type_lower.contains("application/xml")
        || content_type_lower.contains("text/xml")
        || source_is_dash_root;
    let is_hls = path_lower.ends_with(".m3u8")
        || path_lower.ends_with(".m3u")
        || content_type_lower.contains("mpegurl");

    if request.method == "GET" && status.is_success() && (is_dash || is_hls) {
        let content_length = response_headers
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<usize>().ok());
        if content_length.is_some_and(|length| length > MAX_MANIFEST_BYTES) {
            return write_proxy_error(writer, 502, "Stream manifest is too large").await;
        }
        let bytes = match collect_manifest(response).await {
            Ok(bytes) => bytes,
            Err(message) => {
                log::warn!("failed to read web stream manifest: {message}");
                return write_proxy_error(writer, 502, &message).await;
            }
        };
        let manifest = String::from_utf8_lossy(&bytes);
        // Extract all hosts from manifest and add them to allowed_hosts for future segment requests
        // This fixes video-only / audio-only issues where audio and video are on different CDNs
        let extra_hosts = extract_hosts_from_text(&manifest);
        let mut combined_hosts = allowed_hosts.clone();
        combined_hosts.extend(extra_hosts.iter().cloned());
        // Also add base_url host if not already
        combined_hosts.insert(authority(&final_url));
        {
            let mut playbacks = state.playbacks.lock().await;
            if let Some(playback) = playbacks.get_mut(&token) {
                playback.allowed_hosts.extend(combined_hosts.iter().cloned());
            }
        }
        let rewritten = if is_hls {
            rewrite_hls_playlist(&manifest, &final_url, &token, &combined_hosts)
        } else {
            rewrite_dash_manifest(
                &manifest,
                &final_url,
                &token,
                &combined_hosts,
                source.max_height,
            )
        };
        let response_type = if is_hls {
            "application/vnd.apple.mpegurl"
        } else {
            "application/dash+xml"
        };
        return write_manifest_response(writer, response_type, rewritten.as_bytes()).await;
    }

    let content_length = response_headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let content_range = response_headers
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok());
    let accept_ranges = response_headers
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|value| value.to_str().ok());
    let reason = status.canonical_reason().unwrap_or("OK");
    let mut headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nAccept-Ranges: {}\r\nConnection: close\r\n",
        status.as_u16(),
        reason,
        content_type,
        accept_ranges.unwrap_or("bytes")
    );
    if let Some(length) = content_length {
        headers.push_str(&format!("Content-Length: {length}\r\n"));
    }
    if let Some(range) = content_range {
        headers.push_str(&format!("Content-Range: {range}\r\n"));
    }
    headers.push_str("X-Content-Type-Options: nosniff\r\n\r\n");
    writer.write_all(headers.as_bytes()).await?;
    writer.flush().await?;

    if request.method == "HEAD" || status == reqwest::StatusCode::NO_CONTENT {
        return Ok(());
    }
    let mut body_stream = response.bytes_stream();
    loop {
        match tokio::time::timeout(Duration::from_secs(90), body_stream.next()).await {
            Ok(Some(Ok(chunk))) => writer.write_all(&chunk).await?,
            Ok(Some(Err(error))) => {
                log::debug!("web stream body ended with an upstream error: {error}");
                break;
            }
            Ok(None) | Err(_) => break,
        }
    }
    writer.flush().await
}

async fn collect_manifest(response: reqwest::Response) -> Result<Vec<u8>, String> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    loop {
        match tokio::time::timeout(Duration::from_secs(20), stream.next()).await {
            Ok(Some(Ok(chunk))) => {
                if bytes.len().saturating_add(chunk.len()) > MAX_MANIFEST_BYTES {
                    return Err("Stream manifest is too large".to_string());
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(Some(Err(error))) => return Err(format!("Could not read stream manifest: {error}")),
            Ok(None) => return Ok(bytes),
            Err(_) => return Err("Timed out while reading stream manifest".to_string()),
        }
    }
}

fn extract_hosts_from_text(text: &str) -> HashSet<String> {
    let mut hosts = HashSet::new();
    // Simple scanner for http:// and https:// URLs
    let mut idx = 0;
    while idx < text.len() {
        let remaining = &text[idx..];
        let https_pos = remaining.find("https://");
        let http_pos = remaining.find("http://");
        let (pos, is_https) = match (https_pos, http_pos) {
            (Some(a), Some(b)) => {
                if a < b { (a, true) } else { (b, false) }
            }
            (Some(a), None) => (a, true),
            (None, Some(b)) => (b, false),
            (None, None) => break,
        };
        let start = idx + pos;
        let url_start = start;
        // Find end of URL: whitespace, quote, <, >, or newline
        let after_scheme = if is_https { &text[url_start + 8..] } else { &text[url_start + 7..] };
        let mut end_offset = after_scheme.len();
        for (i, c) in after_scheme.char_indices() {
            if c.is_whitespace() || c == '"' || c == '\'' || c == '<' || c == '>' || c == ')' || c == ' ' {
                end_offset = i;
                break;
            }
        }
        let url_str = &text[url_start..url_start + if is_https { 8 } else { 7 } + end_offset];
        if let Ok(url) = Url::parse(url_str) {
            if matches!(url.scheme(), "http" | "https") {
                if let Some(host) = url.host_str() {
                    let mut auth = host.to_ascii_lowercase();
                    if let Some(port) = url.port() {
                        auth.push(':');
                        auth.push_str(&port.to_string());
                    }
                    hosts.insert(auth);
                }
            }
        }
        idx = url_start + if is_https { 8 } else { 7 } + end_offset;
    }
    hosts
}

fn rewrite_hls_playlist(
    manifest: &str,
    base_url: &Url,
    token: &str,
    _allowed_hosts: &HashSet<String>,
) -> String {
    // For HLS, we rewrite all http/https URIs and resolve relative segment URIs via base_url
    manifest
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return line.to_string();
            }
            if trimmed.starts_with('#') {
                rewrite_hls_uri_attributes(line, base_url, token, _allowed_hosts)
            } else {
                // Segment URI - could be relative or absolute
                let leading = line.len() - line.trim_start().len();
                let trailing = line.len() - line.trim_end().len();
                let end = line.len().saturating_sub(trailing);
                let value = &line[leading..end];
                if value.is_empty() {
                    return line.to_string();
                }
                let rewritten = route_manifest_reference(value, base_url, token, _allowed_hosts)
                    .unwrap_or_else(|| {
                        // If it's relative and join fails, keep original
                        value.to_string()
                    });
                format!("{}{}{}", &line[..leading], rewritten, &line[end..])
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn rewrite_hls_uri_attributes(
    line: &str,
    base_url: &Url,
    token: &str,
    allowed_hosts: &HashSet<String>,
) -> String {
    let upper = line.to_ascii_uppercase();
    let mut output = String::with_capacity(line.len() + 128);
    let mut cursor = 0usize;
    while let Some(relative) = upper.get(cursor..).and_then(|tail| tail.find("URI=")) {
        let key_end = cursor + relative + 4;
        let Some(quote) = line.as_bytes().get(key_end).copied() else {
            break;
        };
        if quote != b'"' && quote != b'\'' {
            cursor = key_end;
            continue;
        }
        let value_start = key_end + 1;
        let Some(end_relative) = line
            .get(value_start..)
            .and_then(|tail| tail.find(quote as char))
        else {
            break;
        };
        let value_end = value_start + end_relative;
        output.push_str(&line[cursor..value_start]);
        let value = &line[value_start..value_end];
        // Rewrite any URI, regardless of allowed_hosts - security is handled by token + host extraction
        let rewritten = route_manifest_reference(value, base_url, token, allowed_hosts)
            .unwrap_or_else(|| value.to_string());
        output.push_str(&rewritten);
        cursor = value_end;
    }
    output.push_str(&line[cursor..]);
    output
}

fn route_manifest_reference(
    reference: &str,
    base_url: &Url,
    token: &str,
    _allowed_hosts: &HashSet<String>,
) -> Option<String> {
    // Try to parse as absolute URL first
    let target = if reference.starts_with("http://") || reference.starts_with("https://") {
        Url::parse(reference).ok()?
    } else {
        // Relative URL - join with base
        base_url.join(reference).ok()?
    };
    if !matches!(target.scheme(), "http" | "https") {
        return None;
    }
    // Allow any http/https host - we will add it to allowed_hosts when serving manifest
    // This fixes audio-only / video-only issues where audio and video are on different CDNs
    Some(media_route(token, &target))
}

fn rewrite_dash_manifest(
    manifest: &str,
    _base_url: &Url,
    token: &str,
    _allowed_hosts: &HashSet<String>,
    max_height: Option<u64>,
) -> String {
    let filtered = if let Some(height) = max_height.filter(|height| *height > 0) {
        crate::proxy::filter_dash_representations(manifest, height)
    } else {
        manifest.to_string()
    };
    // Rewrite ALL http:// and https:// URLs to go through our media proxy
    // This ensures audio and video segments on different hosts are both proxied
    // and fixes video-only / audio-only playback issues
    let mut rewritten = filtered;
    // Replace https:// first to avoid double-replacing http:// inside https://
    // Use placeholder to avoid recursive replacement
    // We replace with media route prefix
    rewritten = rewritten.replace("https://", &format!("/api/media/{}/https/", token));
    rewritten = rewritten.replace("http://", &format!("/api/media/{}/http/", token));
    rewritten
}

async fn write_manifest_response(
    writer: &mut OwnedWriteHalf,
    content_type: &str,
    body: &[u8],
) -> io::Result<()> {
    let headers = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    writer.write_all(headers.as_bytes()).await?;
    writer.write_all(body).await?;
    writer.flush().await
}

async fn write_proxy_error(
    writer: &mut OwnedWriteHalf,
    status: u16,
    message: &str,
) -> io::Result<()> {
    let body = message.as_bytes();
    let headers = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        reason_phrase(status),
        body.len()
    );
    writer.write_all(headers.as_bytes()).await?;
    writer.write_all(body).await?;
    writer.flush().await
}

async fn write_response(
    writer: &mut OwnedWriteHalf,
    response: HttpResponse,
    head_only: bool,
) -> io::Result<()> {
    let headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        response.status,
        reason_phrase(response.status),
        response.content_type,
        response.body.len()
    );
    writer.write_all(headers.as_bytes()).await?;
    if !head_only {
        writer.write_all(&response.body).await?;
    }
    writer.flush().await
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        410 => "Gone",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        _ => "Error",
    }
}

fn split_target(target: &str) -> (&str, &str) {
    target.split_once('?').unwrap_or((target, ""))
}

fn parse_query(query: &str) -> HashMap<String, String> {
    url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect()
}

fn parse_provider(value: Option<&String>) -> Result<ProviderKind, String> {
    match value.and_then(|value| ProviderKind::parse(value)) {
        Some(provider) => Ok(provider),
        None => Err("Unknown content provider".to_string()),
    }
}

fn parse_page(value: Option<&String>) -> usize {
    value
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .clamp(1, 200)
}

fn parse_usize(value: Option<&String>, default: usize, max: usize) -> usize {
    value
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
        .min(max)
}

fn provider_id(provider: ProviderKind) -> &'static str {
    match provider {
        ProviderKind::MovieBox => "moviebox",
        ProviderKind::FourKHdHub => "fourkhdhub",
        ProviderKind::Dramachi => "dramachi",
        ProviderKind::BdixCircleFtp => "bdix_circleftp",
        ProviderKind::BdixDhakaFlix => "bdix_dhakaflix",
        ProviderKind::Addons => "addons",
    }
}

fn provider_error_message(provider: ProviderKind, error: ProviderError) -> String {
    error.user_message(provider)
}

fn opaque_token() -> String {
    use rand::RngExt;
    let mut rng = rand::rng();
    (0..32)
        .map(|_| format!("{:x}", rng.random_range(0..16)))
        .collect()
}

fn authority(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    }
}

fn media_route(token: &str, url: &Url) -> String {
    let mut path = format!(
        "/api/media/{token}/{}/{}/{}",
        url.scheme(),
        authority(url),
        url.path().trim_start_matches('/')
    );
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }
    path
}

fn parse_media_target(target: &str) -> Option<(String, Url)> {
    let (path, query) = split_target(target);
    let remainder = path.strip_prefix("/api/media/")?;
    let (token, remainder) = remainder.split_once('/')?;
    let (scheme, remainder) = remainder.split_once('/')?;
    if !matches!(scheme, "http" | "https") {
        return None;
    }
    let (authority, resource_path) = remainder.split_once('/').unwrap_or((remainder, ""));
    if token.is_empty()
        || authority.is_empty()
        || authority.contains('@')
        || authority.contains('\\')
    {
        return None;
    }
    let mut raw = format!("{scheme}://{authority}/{}", resource_path);
    if !query.is_empty() {
        raw.push('?');
        raw.push_str(query);
    }
    let url = Url::parse(&raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return None;
    }
    Some((token.to_string(), url))
}

fn stream_type(url: &Url) -> &'static str {
    let url_str = url.as_str().to_ascii_lowercase();
    let path = url.path().to_ascii_lowercase();
    if crate::player::is_dash_url(url.as_str()) || path.ends_with(".mpd") || url_str.contains("/dash/") {
        "dash"
    } else if path.ends_with(".m3u8")
        || path.ends_with(".m3u")
        || url_str.contains("/hls/")
        || url_str.contains(".m3u8")
        || url_str.contains(".m3u")
    {
        "hls"
    } else {
        "file"
    }
}

async fn resolve_source(
    service: &MovieBoxService,
    stream_set: &CachedStreamSet,
    release: &Release,
    mirror_index: usize,
) -> Result<PlaybackSource, String> {
    if release.provider == ProviderKind::FourKHdHub {
        let client = service
            .fourk_client
            .as_ref()
            .ok_or_else(|| "4KHDHub is unavailable".to_string())?;
        let mut resolved = tokio::time::timeout(
            Duration::from_secs(20),
            client.resolve_release(release, ResolutionIntent::Playback),
        )
        .await
        .map_err(|_| "4KHDHub stream resolution timed out".to_string())?
        .map_err(|error| error.user_message().to_string())?;
        if resolved.max_height.is_none() {
            resolved.max_height = Some(release.resolution_u64());
        }
        return Ok(resolved);
    }

    if release.provider == ProviderKind::Addons {
        return crate::providers::addons::release_to_playback_source(release)
            .ok_or_else(|| "The selected add-on stream has no playable URL".to_string());
    }

    let mirror: &SourceMirror = release
        .mirrors
        .get(mirror_index)
        .ok_or_else(|| "The selected stream has no playable mirror".to_string())?;
    let mut source = PlaybackSource {
        provider: release.provider,
        url: mirror.resolver_url.clone(),
        headers: mirror.headers.clone(),
        subtitle: None,
        source_label: mirror.label.clone(),
        max_height: Some(release.resolution_u64()),
    };

    // This metadata is retained in the short-lived stream set for a later
    // subtitle picker without delaying the initial web playback request.
    let _ = (
        &stream_set.subject_id,
        stream_set.season,
        stream_set.episode,
    );
    if source.max_height == Some(0) {
        source.max_height = None;
    }
    Ok(source)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn read_http_head(socket: &mut tokio::net::TcpStream) -> String {
        let mut collected = Vec::new();
        let mut chunk = [0u8; 1024];
        while !collected.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = socket.read(&mut chunk).await.unwrap();
            assert!(read > 0, "connection closed before request head completed");
            collected.extend_from_slice(&chunk[..read]);
            assert!(collected.len() < 64 * 1024, "request head too large");
        }
        String::from_utf8_lossy(&collected).to_string()
    }

    #[test]
    fn media_route_round_trips_signed_dash_urls() {
        let url = Url::parse(
            "https://cdn.example.test:8443/dash/movie/index.mpd?token=a%2Fb&expires=123",
        )
        .unwrap();
        let route = media_route("session", &url);
        let (token, decoded) = parse_media_target(&route).unwrap();
        assert_eq!(token, "session");
        assert_eq!(decoded, url);
    }

    #[test]
    fn media_route_rejects_non_http_targets_and_userinfo() {
        assert!(parse_media_target("/api/media/token/file/example.test/path").is_none());
        assert!(parse_media_target("/api/media/token/https/user@example.test/path").is_none());
        assert!(parse_media_target("/api/media/token/https/example.test").is_some());
    }

    #[test]
    fn hls_playlist_rewrites_relative_segments_and_key_uris() {
        let base = Url::parse("https://cdn.example.test/hls/master.m3u8").unwrap();
        let mut allowed = HashSet::new();
        allowed.insert("cdn.example.test".to_string());
        let input =
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"keys/one.key?sig=abc\"\nsegments/01.ts\n";
        let result = rewrite_hls_playlist(input, &base, "session", &allowed);
        assert!(
            result.contains("/api/media/session/https/cdn.example.test/hls/keys/one.key?sig=abc")
        );
        assert!(result.contains("/api/media/session/https/cdn.example.test/hls/segments/01.ts"));
    }

    #[test]
    fn access_key_matches_supported_presentation_channels() {
        let expected = "s3cret-key";
        let mut headers = Headers::new();
        headers.insert("authorization".into(), format!("Bearer {expected}"));
        let request = HttpRequest {
            method: "GET".into(),
            target: "/api/search".into(),
            headers: headers.clone(),
            body: Vec::new(),
        };
        assert!(request_presents_access_key(&request, expected));

        let mut headers = Headers::new();
        headers.insert("x-moviebox-key".into(), expected.to_string());
        let request = HttpRequest {
            method: "GET".into(),
            target: "/api/search".into(),
            headers: headers.clone(),
            body: Vec::new(),
        };
        assert!(request_presents_access_key(&request, expected));

        let mut headers = Headers::new();
        headers.insert(
            "cookie".into(),
            format!("theme=dark; moviebox_key={expected}; other=1"),
        );
        let request = HttpRequest {
            method: "GET".into(),
            target: "/api/search".into(),
            headers,
            body: Vec::new(),
        };
        assert!(request_presents_access_key(&request, expected));

        let request = HttpRequest {
            method: "GET".into(),
            target: "/api/search".into(),
            headers: Headers::new(),
            body: Vec::new(),
        };
        assert!(!request_presents_access_key(&request, expected));
    }

    #[test]
    fn client_identity_prefers_forwarded_edge_address() {
        let mut headers = Headers::new();
        headers.insert(
            "x-forwarded-for".into(),
            "203.0.113.9, 198.51.100.7".to_string(),
        );
        assert_eq!(client_identity(&headers, None), "198.51.100.7");
        assert_eq!(client_identity(&Headers::new(), None), String::new());
    }

    #[tokio::test]
    async fn rate_limiter_throttles_requests_over_budget() {
        let mut state = WebState::new();
        state.rate_per_minute = 12;
        let burst = (f64::from(state.rate_per_minute) / 6.0).max(10.0) as usize;
        for _ in 0..burst {
            assert!(state.enforce_rate_limit("198.51.100.7").await.is_ok());
        }
        let rejected = state.enforce_rate_limit("198.51.100.7").await;
        assert!(rejected.is_err());
        assert_eq!(rejected.err().map(|response| response.status), Some(429));
        // A different client keeps its own budget.
        assert!(state.enforce_rate_limit("203.0.113.9").await.is_ok());
    }

    #[tokio::test]
    async fn media_proxy_forwards_range_requests_and_streams_bodies() {
        // Mock stream origin that only answers ranged requests.
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_addr = upstream.local_addr().unwrap();
        let upstream_task = tokio::spawn(async move {
            let (mut socket, _) = upstream.accept().await.unwrap();
            let request = read_http_head(&mut socket).await;
            assert!(request.starts_with("GET /video.mp4 HTTP/1.1"), "{request}");
            let lower = request.to_ascii_lowercase();
            assert!(lower.contains("range: bytes=100-199"), "{request}");
            assert!(
                lower.contains("authorization: bearer upstream-key"),
                "{request}"
            );
            let head = "HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\n\
                        Content-Range: bytes 100-199/1000\r\nContent-Length: 100\r\n\r\n";
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.write_all(&[7u8; 100]).await.unwrap();
            socket.flush().await.unwrap();
            tokio::time::sleep(Duration::from_secs(2)).await;
        });

        let authority = format!("127.0.0.1:{}", upstream_addr.port());
        let mut allowed_hosts = HashSet::new();
        allowed_hosts.insert(authority.clone());
        let state = WebState {
            service: MovieBoxService::new(),
            media_client: reqwest::Client::new(),
            stream_sets: Mutex::new(HashMap::new()),
            playbacks: Mutex::new(HashMap::from([(
                "sesstoken".to_string(),
                WebPlayback {
                    created_at: Instant::now(),
                    source: PlaybackSource {
                        provider: ProviderKind::MovieBox,
                        url: format!("http://{authority}/video.mp4"),
                        headers: vec![("Authorization".into(), "Bearer upstream-key".into())],
                        subtitle: None,
                        source_label: "mock".to_string(),
                        max_height: Some(1080),
                    },
                    primary_host: authority.clone(),
                    allowed_hosts,
                },
            )])),
            access_token: None,
            rate_per_minute: 0,
            rate_buckets: Mutex::new(HashMap::new()),
        };

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut client = tokio::net::TcpStream::connect(listener.local_addr().unwrap())
            .await
            .unwrap();
        let (server_side, _) = listener.accept().await.unwrap();
        let request = HttpRequest {
            method: "GET".to_string(),
            target: format!("/api/media/sesstoken/http/{authority}/video.mp4"),
            headers: HashMap::from([("range".to_string(), "bytes=100-199".to_string())]),
            body: Vec::new(),
        };
        let (_reader, mut writer) = server_side.into_split();
        let proxy_task = tokio::spawn(async move {
            proxy_media(&request, &state, &mut writer).await.unwrap();
        });

        let mut raw = Vec::new();
        let read_result = client.read_to_end(&mut raw);
        tokio::time::timeout(Duration::from_secs(10), read_result)
            .await
            .unwrap()
            .unwrap();
        let raw = String::from_utf8_lossy(&raw);
        let (head, body) = raw.split_once("\r\n\r\n").expect("raw HTTP response");
        assert!(head.starts_with("HTTP/1.1 206 Partial Content"), "{head}");
        assert!(
            head.to_ascii_lowercase()
                .contains("content-range: bytes 100-199/1000"),
            "{head}"
        );
        assert_eq!(body.as_bytes(), &[7u8; 100][..]);

        proxy_task.await.unwrap();
        upstream_task.await.unwrap();
    }

    #[tokio::test]
    async fn media_proxy_rewrites_hls_manifests_to_media_routes() {
        let manifest = "#EXTM3U\n#EXT-X-VERSION:3\nsegments/01.ts\n";
        let upstream = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_addr = upstream.local_addr().unwrap();
        let manifest_body = manifest.to_string();
        let upstream_task = tokio::spawn(async move {
            let (mut socket, _) = upstream.accept().await.unwrap();
            let request = read_http_head(&mut socket).await;
            assert!(
                request.starts_with("GET /live/master.m3u8"),
                "unexpected upstream request: {request}"
            );
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.apple.mpegurl\r\nContent-Length: {}\r\n\r\n",
                manifest_body.len()
            );
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.write_all(manifest_body.as_bytes()).await.unwrap();
            socket.flush().await.unwrap();
            tokio::time::sleep(Duration::from_secs(2)).await;
        });

        let authority = format!("127.0.0.1:{}", upstream_addr.port());
        let mut allowed_hosts = HashSet::new();
        allowed_hosts.insert(authority.clone());
        let state = WebState {
            service: MovieBoxService::new(),
            media_client: reqwest::Client::new(),
            stream_sets: Mutex::new(HashMap::new()),
            playbacks: Mutex::new(HashMap::from([(
                "hls-token".to_string(),
                WebPlayback {
                    created_at: Instant::now(),
                    source: PlaybackSource {
                        provider: ProviderKind::MovieBox,
                        url: format!("http://{authority}/live/master.m3u8"),
                        headers: Vec::new(),
                        subtitle: None,
                        source_label: "mock".to_string(),
                        max_height: None,
                    },
                    primary_host: authority.clone(),
                    allowed_hosts,
                },
            )])),
            access_token: None,
            rate_per_minute: 0,
            rate_buckets: Mutex::new(HashMap::new()),
        };

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut client = tokio::net::TcpStream::connect(listener.local_addr().unwrap())
            .await
            .unwrap();
        let (server_side, _) = listener.accept().await.unwrap();
        let request = HttpRequest {
            method: "GET".to_string(),
            target: format!("/api/media/hls-token/http/{authority}/live/master.m3u8"),
            headers: Headers::new(),
            body: Vec::new(),
        };
        let (_reader, mut writer) = server_side.into_split();
        let proxy_task = tokio::spawn(async move {
            proxy_media(&request, &state, &mut writer).await.unwrap();
        });

        let mut raw = Vec::new();
        let read_result = client.read_to_end(&mut raw);
        tokio::time::timeout(Duration::from_secs(10), read_result)
            .await
            .unwrap()
            .unwrap();
        let raw = String::from_utf8_lossy(&raw);
        let (head, body) = raw.split_once("\r\n\r\n").expect("raw HTTP response");
        assert!(head.contains("200 OK"), "{head}");
        assert!(head.contains("application/vnd.apple.mpegurl"), "{head}");
        let segment_route = format!("/api/media/hls-token/http/{authority}/live/segments/01.ts");
        assert!(body.contains(segment_route.as_str()), "{body}");

        proxy_task.await.unwrap();
        upstream_task.await.unwrap();
    }

    fn catalog_row(id: &str, trending: Option<f64>, rating: Option<f64>) -> CatalogRow {
        CatalogRow {
            item: CatalogItem {
                id: crate::providers::models::ProviderMediaId {
                    provider: ProviderKind::MovieBox,
                    value: id.to_string(),
                },
                title: format!("Title {id}"),
                media_type: crate::providers::models::MediaType::Movie,
                year: Some("2024".to_string()),
                poster_url: None,
                season_count: None,
            },
            metrics: BrowseMetrics {
                trending,
                rating,
                recent_rating: rating,
                popularity: trending,
            },
        }
    }

    fn details_for(title: &str, director: Option<&str>, genres: &[&str]) -> MediaDetails {
        MediaDetails {
            id: crate::providers::models::ProviderMediaId {
                provider: ProviderKind::MovieBox,
                value: "subject-1".to_string(),
            },
            title: title.to_string(),
            media_type: crate::providers::models::MediaType::Movie,
            year: Some("2014".to_string()),
            description: None,
            tagline: None,
            imdb_rating: Some("8.7".to_string()),
            director: director.map(str::to_string),
            stars: None,
            prints: None,
            audios: None,
            poster_url: None,
            duration: Some("169m".to_string()),
            genres: genres.iter().map(|genre| genre.to_string()).collect(),
            seasons: vec![],
            dubs: vec![],
        }
    }

    #[test]
    fn related_seeds_prefer_director_then_genres_then_franchise() {
        let seeds = related_seeds(&details_for(
            "Interstellar: Beyond",
            Some("Christopher Nolan"),
            &["Science Fiction", "Drama", "Adventure", "Mystery"],
        ));
        let terms: Vec<&str> = seeds.iter().map(|seed| seed.term.as_str()).collect();
        assert_eq!(terms[0], "Christopher Nolan");
        assert_eq!(terms[1], "Science Fiction");
        assert_eq!(seeds.len(), 5, "director + 3 genres + franchise token");
        assert!(seeds.iter().any(|seed| seed.term == "Interstellar"));
    }

    #[test]
    fn related_seeds_skip_stopword_titles_and_blank_directors() {
        let seeds = related_seeds(&details_for("The Thing", Some("  "), &[]));
        assert!(seeds.is_empty(), "no usable seeds: {seeds:?}");
        let franchise = related_seeds(&details_for("Dune: Part Two", None, &[]));
        assert_eq!(franchise.len(), 1);
        assert_eq!(franchise[0].term, "Dune");
    }

    #[test]
    fn franchise_token_ignores_short_and_stopword_leads() {
        assert_eq!(franchise_token("Dune: Part Two").as_deref(), Some("Dune"));
        assert_eq!(franchise_token("The Batman").as_deref(), Some("Batman"));
        assert_eq!(franchise_token("Up").as_deref(), None);
    }

    #[test]
    fn ranked_entries_sort_by_the_row_metric_and_drop_unranked() {
        let pool = vec![
            catalog_row("low", Some(10.0), Some(6.1)),
            catalog_row("none", None, None),
            catalog_row("high", Some(90.0), Some(9.2)),
        ];
        let trending: Vec<&str> = ranked_entries(&pool, "trending", 10)
            .iter()
            .map(|row| row.item.id.value.as_str())
            .collect();
        assert_eq!(trending, vec!["high", "low"]);
        let top_rated: Vec<&str> = ranked_entries(&pool, "top_rated", 1)
            .iter()
            .map(|row| row.item.id.value.as_str())
            .collect();
        assert_eq!(top_rated, vec!["high"]);
    }

    #[test]
    fn media_type_normalisation_defaults_to_movie() {
        assert_eq!(
            normalize_media_type(Some("TV".to_string())).as_deref(),
            Some("series")
        );
        assert_eq!(
            normalize_media_type(Some("weird".to_string())).as_deref(),
            Some("movie")
        );
        assert_eq!(normalize_media_type(None), None);
    }

    #[test]
    fn library_targets_reject_unknown_providers_and_blank_ids() {
        assert!(parse_library_target("moviebox", "42").is_ok());
        assert!(parse_library_target("not-a-source", "42").is_err());
        assert!(parse_library_target("moviebox", "   ").is_err());
        assert!(parse_library_target("moviebox", &"x".repeat(600)).is_err());
    }
}
