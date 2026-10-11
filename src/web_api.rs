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
use url::Url;

use crate::providers::models::{
    PlaybackSource, ProviderError, ProviderKind, Release, ResolutionIntent, SourceMirror,
};
use crate::providers::ReleaseProvider;
use crate::service::MovieBoxService;

const MAX_REQUEST_LINE_BYTES: usize = 8 * 1024;
const MAX_HEADER_LINE_BYTES: usize = 8 * 1024;
const MAX_HEADERS: usize = 64;
const MAX_BODY_BYTES: usize = 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 10 * 1024 * 1024;
const STREAM_SET_TTL: Duration = Duration::from_secs(20 * 60);
const PLAYBACK_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const MAX_STREAM_SETS: usize = 96;
const MAX_PLAYBACK_SESSIONS: usize = 96;
const DEFAULT_RATE_PER_MIN: u32 = 120;
const RATE_BUCKET_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_RATE_BUCKETS: usize = 8192;

type Headers = HashMap<String, String>;

struct WebState {
    service: MovieBoxService,
    media_client: reqwest::Client,
    stream_sets: Mutex<HashMap<String, CachedStreamSet>>,
    playbacks: Mutex<HashMap<String, WebPlayback>>,
    access_token: Option<String>,
    rate_per_minute: u32,
    rate_buckets: Mutex<HashMap<String, TokenBucket>>,
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
            .pool_max_idle_per_host(16)
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
        let bucket = buckets.entry(client_key.to_string()).or_insert(TokenBucket {
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
    let request = match tokio::time::timeout(
        Duration::from_secs(10),
        read_request(&mut reader),
    )
    .await
    {
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
            .last()
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
        "/api/health" if request.method == "GET" || request.method == "HEAD" => {
            HttpResponse::json(
                200,
                json!({
                    "status": "ok",
                    "mode": "live",
                    "engine": "MovieBox-Tui",
                    "version": env!("CARGO_PKG_VERSION"),
                }),
            )
        }
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
        Ok((items, metrics)) => HttpResponse::json(
            200,
            json!({ "items": items, "metrics": metrics }),
        ),
        Err(error) => HttpResponse::error(502, error),
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
    let id = params.get("id").map(String::as_str).unwrap_or_default().trim();
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
    let id = params.get("id").map(String::as_str).unwrap_or_default().trim();
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

    let releases = match fetch_releases(&state.service, provider, id, season, episode, is_series).await {
        Ok(releases) => releases,
        Err(message) => return HttpResponse::error(502, message),
    };
    if releases.is_empty() {
        return HttpResponse::error(404, "No playable streams found for this title");
    }

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
            Some(client) => ReleaseProvider::episode_streams(client, subject_id, season, episode).await,
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
            None => return HttpResponse::error(410, "Stream list expired. Refresh the stream list and try again."),
        }
    };
    let release = match stream_set.releases.get(request.release_index) {
        Some(release) => release.clone(),
        None => return HttpResponse::error(400, "Selected stream does not exist"),
    };

    let source = match resolve_source(&state.service, &stream_set, &release, request.mirror_index).await {
        Ok(source) => source,
        Err(message) => return HttpResponse::error(502, message),
    };
    let source_url = match Url::parse(&source.url) {
        Ok(url)
            if matches!(url.scheme(), "http" | "https")
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none() => url,
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
            return write_proxy_error(writer, 403, "Media host is not part of this playback session").await;
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
        let rewritten = if is_hls {
            rewrite_hls_playlist(&manifest, &final_url, &token, &allowed_hosts)
        } else {
            rewrite_dash_manifest(
                &manifest,
                &final_url,
                &token,
                &allowed_hosts,
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

fn rewrite_hls_playlist(
    manifest: &str,
    base_url: &Url,
    token: &str,
    allowed_hosts: &HashSet<String>,
) -> String {
    manifest
        .lines()
        .map(|line| {
            if line.trim().is_empty() {
                return line.to_string();
            }
            if line.trim_start().starts_with('#') {
                rewrite_hls_uri_attributes(line, base_url, token, allowed_hosts)
            } else {
                let leading = line.len() - line.trim_start().len();
                let trailing = line.len() - line.trim_end().len();
                let end = line.len().saturating_sub(trailing);
                let value = &line[leading..end];
                let rewritten = route_manifest_reference(value, base_url, token, allowed_hosts)
                    .unwrap_or_else(|| value.to_string());
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
    let mut output = String::with_capacity(line.len() + 64);
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
        let Some(end_relative) = line.get(value_start..).and_then(|tail| tail.find(quote as char)) else {
            break;
        };
        let value_end = value_start + end_relative;
        output.push_str(&line[cursor..value_start]);
        let value = &line[value_start..value_end];
        output.push_str(
            &route_manifest_reference(value, base_url, token, allowed_hosts)
                .unwrap_or_else(|| value.to_string()),
        );
        cursor = value_end;
    }
    output.push_str(&line[cursor..]);
    output
}

fn route_manifest_reference(
    reference: &str,
    base_url: &Url,
    token: &str,
    allowed_hosts: &HashSet<String>,
) -> Option<String> {
    let target = base_url.join(reference).ok()?;
    if !matches!(target.scheme(), "http" | "https")
        || !allowed_hosts.contains(&authority(&target))
    {
        return None;
    }
    Some(media_route(token, &target))
}

fn rewrite_dash_manifest(
    manifest: &str,
    base_url: &Url,
    token: &str,
    allowed_hosts: &HashSet<String>,
    max_height: Option<u64>,
) -> String {
    let filtered = if let Some(height) = max_height.filter(|height| *height > 0) {
        crate::proxy::filter_dash_representations(manifest, height)
    } else {
        manifest.to_string()
    };
    let mut rewritten = filtered;
    for host in allowed_hosts {
        for (scheme, default_port) in [("https", 443), ("http", 80)] {
            let host_without_port = base_url.host_str().unwrap_or_default();
            let authorities = if base_url.port() == Some(default_port) {
                vec![host.clone(), host_without_port.to_string()]
            } else {
                vec![host.clone()]
            };
            for authority in authorities {
                let from = format!("{scheme}://{authority}/");
                let to = format!("/api/media/{token}/{scheme}/{authority}/");
                rewritten = rewritten.replace(&from, &to);
            }
        }
    }
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
    if crate::player::is_dash_url(url.as_str()) {
        "dash"
    } else if url.path().to_ascii_lowercase().ends_with(".m3u8")
        || url.path().to_ascii_lowercase().ends_with(".m3u")
        || url.path().to_ascii_lowercase().contains("/hls/")
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
    let _ = (&stream_set.subject_id, stream_set.season, stream_set.episode);
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
        let input = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"keys/one.key?sig=abc\"\nsegments/01.ts\n";
        let result = rewrite_hls_playlist(input, &base, "session", &allowed);
        assert!(result.contains("/api/media/session/https/cdn.example.test/hls/keys/one.key?sig=abc"));
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
        headers.insert("cookie".into(), format!("theme=dark; moviebox_key={expected}; other=1"));
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
        headers.insert("x-forwarded-for".into(), "203.0.113.9, 198.51.100.7".to_string());
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
            assert!(lower.contains("authorization: bearer upstream-key"), "{request}");
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
        assert!(head.to_ascii_lowercase().contains("content-range: bytes 100-199/1000"), "{head}");
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
        assert!(body.contains(&segment_route), "{body}");

        proxy_task.await.unwrap();
        upstream_task.await.unwrap();
    }
}
