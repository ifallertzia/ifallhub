//! Public subtitle providers used by the web player's caption picker.
//!
//! The engine's own MovieBox captions cover only MovieBox titles, so search
//! requests fan out to public, key-free subtitle services and every provider's
//! results are merged into one list:
//!
//! * **OpenSubtitles v3** (`opensubtitles-v3.strem.io`) – the Stremio add-on.
//!   Needs an IMDb id, which is resolved through Cinemeta (`v3-cinemeta.strem.io`),
//!   both key-free.
//! * **Podnapisi** (`podnapisi.net`) – key-free XML search by title/year/season.
//! * **Wyzie Subs** (`sub.wyzie.io`) – aggregated providers. It needs a free API
//!   key, so this one only joins the fan-out when `MOVIEBOX_WYZIE_KEY` (or
//!   `WYZIE_API_KEY`) is set in the environment. The key stays on the server.
//!
//! Every returned URL is fetched by the engine, never by the browser, so the
//! download path re-validates the host against an explicit allowlist (see
//! [`is_allowed_subtitle_host`]) and unpacks `.zip`/`.gz` payloads with
//! [`decode_subtitle_file`].

use std::collections::HashSet;
use std::io::Read;
use std::time::Duration;

use scraper::{Html, Selector};
use serde_json::Value;
use url::Url;

pub const ENV_WYZIE_KEY: &str = "MOVIEBOX_WYZIE_KEY";
pub const ENV_WYZIE_KEY_ALIAS: &str = "WYZIE_API_KEY";
pub const CINEMETA_BASE: &str = "https://v3-cinemeta.strem.io";
pub const OPENSUBTITLES_ADDON_BASE: &str = "https://opensubtitles-v3.strem.io";
pub const WYZIE_BASE: &str = "https://sub.wyzie.io";
pub const PODNAPISI_BASE: &str = "https://www.podnapisi.net";

/// How long the whole fan-out may take before the merged list is returned.
pub const SEARCH_BUDGET: Duration = Duration::from_secs(20);
/// Per-provider budget; slow providers are dropped instead of delaying the list.
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(12);
/// Upper bound on results kept per provider before merging.
const MAX_PER_PROVIDER: usize = 40;
pub const MAX_SUBTITLES: usize = 48;

/// One subtitle file offered by a public provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicSubtitle {
    /// Label shown in the picker, e.g. `English · OpenSubtitles · 1080p`.
    pub name: String,
    /// Direct subtitle file URL. Only the engine fetches this.
    pub url: String,
    /// ISO 639-1/639-2 code (`en`, `hi`, …), empty when the provider omits it.
    pub language: String,
    /// Provider id: `opensubtitles`, `podnapisi`, `wyzie`.
    pub source: String,
    /// File format when the provider reports one (`srt`, `ass`, …).
    pub format: String,
    /// Download counter when the provider reports one (used for ranking).
    pub downloads: Option<u64>,
    /// Hearing-impaired / SDH flag when the provider reports one.
    pub hearing_impaired: bool,
}

/// Search input shared by every provider.
#[derive(Debug, Clone, Default)]
pub struct SubtitleQuery {
    pub title: String,
    pub year: Option<String>,
    pub season: usize,
    pub episode: usize,
}

impl SubtitleQuery {
    pub fn is_series(&self) -> bool {
        self.season > 0 && self.episode > 0
    }
}

/// The Wyzie API key, when the operator provided one.
pub fn wyzie_key() -> Option<String> {
    [ENV_WYZIE_KEY, ENV_WYZIE_KEY_ALIAS]
        .into_iter()
        .find_map(|name| {
            std::env::var(name)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

/// Builds a query URL without panicking on bad input.
fn build_url(base: &str, path: &str, params: &[(&str, String)]) -> Option<Url> {
    let mut url = Url::parse(&format!("{base}{path}")).ok()?;
    {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in params {
            pairs.append_pair(key, value);
        }
    }
    Some(url)
}

async fn fetch_json(client: &reqwest::Client, url: Url) -> Option<Value> {
    let response = tokio::time::timeout(PROVIDER_TIMEOUT, client.get(url).send())
        .await
        .ok()?
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    tokio::time::timeout(PROVIDER_TIMEOUT, response.json::<Value>())
        .await
        .ok()?
        .ok()
}

async fn fetch_text(client: &reqwest::Client, url: Url) -> Option<String> {
    let response = tokio::time::timeout(PROVIDER_TIMEOUT, client.get(url).send())
        .await
        .ok()?
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = tokio::time::timeout(PROVIDER_TIMEOUT, response.bytes())
        .await
        .ok()?
        .ok()?;
    Some(String::from_utf8_lossy(&bytes).to_string())
}

/// Resolves a title to its IMDb id through Cinemeta (the public Stremio
/// metadata add-on), which is what the OpenSubtitles and Wyzie providers need.
pub async fn resolve_imdb_id(
    client: &reqwest::Client,
    title: &str,
    year: Option<&str>,
    is_series: bool,
) -> Option<String> {
    let title = title.trim();
    if title.is_empty() || title.len() > 200 {
        return None;
    }
    let media_type = if is_series { "series" } else { "movie" };
    // An id passed straight in needs no lookup.
    if title.starts_with("tt") && title[2..].chars().all(|c| c.is_ascii_digit()) {
        return Some(title.to_string());
    }
    // The search term travels in the path, so spaces must stay %20-encoded.
    let term = percent_encoding::utf8_percent_encode(title, percent_encoding::NON_ALPHANUMERIC)
        .to_string();
    let url = build_url(
        CINEMETA_BASE,
        &format!("/catalog/{media_type}/top/search={term}.json"),
        &[],
    )?;
    let payload = fetch_json(client, url).await?;
    parse_cinemeta_search(&payload, title, year, is_series)
}

/// Picks the best Cinemeta search hit for `title`/`year`. Pure, so the match
/// rules stay unit-testable without network access.
pub fn parse_cinemeta_search(
    payload: &Value,
    title: &str,
    year: Option<&str>,
    is_series: bool,
) -> Option<String> {
    let metas = payload.get("metas")?.as_array()?;
    let wanted_type = if is_series { "series" } else { "movie" };
    let wanted_year = year
        .map(crate::providers::models::extract_4digit_year)
        .filter(|value| !value.is_empty());
    let mut fallback = None;
    for meta in metas {
        let Some(id) = meta.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !id.starts_with("tt") {
            continue;
        }
        if meta
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|kind| {
                // Cinemeta reports `series` for shows; some entries use `tvSeries`.
                kind != wanted_type && !(is_series && kind.eq_ignore_ascii_case("tvseries"))
            })
        {
            continue;
        }
        let name = meta.get("name").and_then(Value::as_str).unwrap_or_default();
        if !crate::providers::title_match::titles_match(
            title,
            name,
            wanted_year.as_deref(),
            meta.get("releaseInfo").and_then(Value::as_str),
        ) {
            if fallback.is_none() {
                fallback = Some(id.to_string());
            }
            continue;
        }
        return Some(id.to_string());
    }
    // Nothing matched by title: keep the top hit so the picker can still offer
    // subtitles instead of silently returning an empty list.
    fallback
}

/// The public fan-out. Providers run concurrently and every failure is dropped;
/// an empty list simply means "no public subtitles found".
pub async fn search(client: &reqwest::Client, query: &SubtitleQuery) -> Vec<PublicSubtitle> {
    if query.title.trim().is_empty() {
        return Vec::new();
    }
    let imdb_id = resolve_imdb_id(
        client,
        &query.title,
        query.year.as_deref(),
        query.is_series(),
    )
    .await;
    let (opensubtitles, podnapisi, wyzie) = tokio::join!(
        search_opensubtitles_v3(client, imdb_id.as_deref(), query),
        search_podnapisi(client, query),
        search_wyzie(client, imdb_id.as_deref(), query),
    );
    let merged = merge_providers([opensubtitles, podnapisi, wyzie]);
    merged.into_iter().take(MAX_SUBTITLES).collect()
}

/// OpenSubtitles v3 (the Stremio add-on): key-free, needs an IMDb id.
async fn search_opensubtitles_v3(
    client: &reqwest::Client,
    imdb_id: Option<&str>,
    query: &SubtitleQuery,
) -> Vec<PublicSubtitle> {
    let Some(imdb_id) = imdb_id else {
        return Vec::new();
    };
    let path = if query.is_series() {
        format!(
            "/subtitles/series/{imdb_id}:{}:{}.json",
            query.season, query.episode
        )
    } else {
        format!("/subtitles/movie/{imdb_id}.json")
    };
    let Some(url) = build_url(OPENSUBTITLES_ADDON_BASE, &path, &[]) else {
        return Vec::new();
    };
    let Some(payload) = fetch_json(client, url).await else {
        return Vec::new();
    };
    parse_opensubtitles_v3(&payload)
}

/// Parses the `{ "subtitles": [ { id, url, lang, label?, downloads? } ] }` reply.
pub fn parse_opensubtitles_v3(payload: &Value) -> Vec<PublicSubtitle> {
    let Some(entries) = payload.get("subtitles").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut results = Vec::new();
    let mut seen = HashSet::new();
    for entry in entries.iter().take(MAX_PER_PROVIDER) {
        let Some(url) = entry.get("url").and_then(Value::as_str) else {
            continue;
        };
        if url.trim().is_empty() || !seen.insert(url.to_string()) {
            continue;
        }
        let language = entry
            .get("lang")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        // Only an explicit label becomes part of the picker name; the provider
        // id is an opaque hash, not something to show.
        let label = entry
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let downloads = entry.get("downloads").and_then(Value::as_u64);
        results.push(PublicSubtitle {
            name: subtitle_name(&language, "OpenSubtitles", &label),
            url: url.trim().to_string(),
            language,
            source: "opensubtitles".to_string(),
            format: guess_format(url).to_string(),
            downloads,
            hearing_impaired: entry
                .get("hearingImpaired")
                .or_else(|| entry.get("hi"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
    }
    results
}

/// Wyzie Subs: aggregated providers, needs a free key (kept server-side).
async fn search_wyzie(
    client: &reqwest::Client,
    imdb_id: Option<&str>,
    query: &SubtitleQuery,
) -> Vec<PublicSubtitle> {
    let Some(key) = wyzie_key() else {
        return Vec::new();
    };
    let Some(id) = imdb_id else {
        return Vec::new();
    };
    let mut params = vec![("id", id.to_string()), ("key", key)];
    if query.is_series() {
        params.push(("season", query.season.to_string()));
        params.push(("episode", query.episode.to_string()));
    }
    let Some(url) = build_url(WYZIE_BASE, "/search", &params) else {
        return Vec::new();
    };
    let Some(payload) = fetch_json(client, url).await else {
        return Vec::new();
    };
    parse_wyzie(&payload)
}

/// Parses the Wyzie `/search` array response.
pub fn parse_wyzie(payload: &Value) -> Vec<PublicSubtitle> {
    let Some(entries) = payload.as_array() else {
        return Vec::new();
    };
    let mut results = Vec::new();
    let mut seen = HashSet::new();
    for entry in entries.iter().take(MAX_PER_PROVIDER) {
        let Some(url) = entry.get("url").and_then(Value::as_str) else {
            continue;
        };
        if url.trim().is_empty() || !seen.insert(url.to_string()) {
            continue;
        }
        let language = entry
            .get("language")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let display = entry
            .get("display")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let release = entry
            .get("release")
            .or_else(|| entry.get("fileName"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let hearing_impaired = entry
            .get("isHearingImpaired")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let mut label = if display.is_empty() {
            language.clone()
        } else {
            display.clone()
        };
        if hearing_impaired {
            label.push_str(" [SDH]");
        }
        if !release.is_empty() {
            label.push_str(" · ");
            label.push_str(&release);
        }
        results.push(PublicSubtitle {
            name: subtitle_name(&language, "Wyzie", &label),
            url: url.trim().to_string(),
            language,
            source: "wyzie".to_string(),
            format: entry
                .get("format")
                .and_then(Value::as_str)
                .unwrap_or_else(|| guess_format(url))
                .to_ascii_lowercase(),
            downloads: entry.get("downloadCount").and_then(Value::as_u64),
            hearing_impaired,
        });
    }
    results
}

/// Podnapisi: key-free XML search, usable without an IMDb id.
async fn search_podnapisi(client: &reqwest::Client, query: &SubtitleQuery) -> Vec<PublicSubtitle> {
    let mut params = vec![
        ("sK", query.title.trim().to_string()),
        ("sXML", "1".to_string()),
    ];
    if let Some(year) = query
        .year
        .as_deref()
        .map(crate::providers::models::extract_4digit_year)
        .filter(|value| !value.is_empty())
    {
        params.push(("sY", year));
    }
    if query.is_series() {
        params.push(("sTS", query.season.to_string()));
        params.push(("sTE", query.episode.to_string()));
    }
    let Some(url) = build_url(PODNAPISI_BASE, "/subtitles/search/old", &params) else {
        return Vec::new();
    };
    let Some(body) = fetch_text(client, url).await else {
        return Vec::new();
    };
    parse_podnapisi_xml(&body)
}

/// Parses the Podnapisi search XML: one `<subtitle>` node per result with
/// `<title>`, `<language>`, `<url>` (download path) and `<downloads>`.
pub fn parse_podnapisi_xml(body: &str) -> Vec<PublicSubtitle> {
    let document = Html::parse_document(body);
    let Ok(selector) = Selector::parse("subtitle") else {
        return Vec::new();
    };
    let mut results = Vec::new();
    for node in document.select(&selector).take(MAX_PER_PROVIDER) {
        let pick = |name: &str| -> String {
            Selector::parse(name)
                .ok()
                .and_then(|selector| node.select(&selector).next())
                .map(|element| element.text().collect::<String>().trim().to_string())
                .unwrap_or_default()
        };
        let raw_url = pick("url");
        let url = match resolve_podnapisi_url(&raw_url) {
            Some(url) => url,
            None => continue,
        };
        let language = normalize_language_code(&pick("language"));
        let title = pick("title");
        let downloads = pick("downloads").parse::<u64>().ok();
        let mut label = title;
        if label.is_empty() {
            label = language.clone();
        }
        results.push(PublicSubtitle {
            name: subtitle_name(&language, "Podnapisi", &label),
            url,
            language,
            source: "podnapisi".to_string(),
            format: guess_format(&raw_url).to_string(),
            downloads,
            hearing_impaired: false,
        });
    }
    results
}

/// Podnapisi returns root-relative download paths.
fn resolve_podnapisi_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Some(raw.to_string());
    }
    let joined = Url::parse(PODNAPISI_BASE).ok()?.join(raw).ok()?;
    Some(joined.to_string())
}

/// Merges provider lists: de-duplicates by (language, name), keeps the widest
/// language coverage and ranks the familiar languages first.
pub fn merge_providers<const N: usize>(lists: [Vec<PublicSubtitle>; N]) -> Vec<PublicSubtitle> {
    let mut merged: Vec<PublicSubtitle> = Vec::new();
    let mut seen = HashSet::new();
    for list in lists {
        for entry in list {
            let key = format!(
                "{}::{}",
                entry.language.to_ascii_lowercase(),
                collapse_whitespace(&entry.name).to_ascii_lowercase()
            );
            if !seen.insert(key) {
                continue;
            }
            merged.push(entry);
        }
    }
    merged.sort_by(|a, b| {
        language_priority(&a.language)
            .cmp(&language_priority(&b.language))
            .then_with(|| b.downloads.unwrap_or(0).cmp(&a.downloads.unwrap_or(0)))
            .then_with(|| source_priority(&a.source).cmp(&source_priority(&b.source)))
            .then_with(|| a.name.cmp(&b.name))
    });
    merged
}

/// Lower is better: the languages this client's audience usually wants first.
pub fn language_priority(code: &str) -> u8 {
    match code.to_ascii_lowercase().as_str() {
        "en" | "eng" | "english" => 0,
        "hi" | "hin" | "hindi" => 1,
        "ur" | "urd" | "urdu" | "bn" | "ben" | "bengali" | "ta" | "tam" | "tamil" | "te"
        | "tel" | "telugu" | "ml" | "mal" | "malayalam" => 2,
        "" => 3,
        _ => 4,
    }
}

fn source_priority(source: &str) -> u8 {
    match source {
        "opensubtitles" => 0,
        "wyzie" => 1,
        "podnapisi" => 2,
        _ => 3,
    }
}

/// Every provider labels results slightly differently; this keeps picker
/// entries readable: `English · OpenSubtitles · release name`.
fn subtitle_name(language: &str, source: &str, detail: &str) -> String {
    let language_label = language_label(language);
    let mut name = if language_label.is_empty() {
        source.to_string()
    } else {
        format!("{language_label} · {source}")
    };
    let detail = collapse_whitespace(detail);
    if !detail.is_empty() && !detail.eq_ignore_ascii_case(&language_label) {
        name.push_str(" · ");
        // Keep labels short enough for the picker.
        name.push_str(&detail.chars().take(72).collect::<String>());
    }
    name
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Human-readable language name for picker labels (unknown codes pass through).
pub fn language_label(code: &str) -> String {
    let trimmed = code.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_ascii_lowercase();
    let name = match lower.as_str() {
        "en" | "eng" | "english" => "English",
        "hi" | "hin" | "hindi" => "Hindi",
        "ur" | "urd" | "urdu" => "Urdu",
        "bn" | "ben" | "bengali" => "Bengali",
        "ta" | "tam" | "tamil" => "Tamil",
        "te" | "tel" | "telugu" => "Telugu",
        "ml" | "mal" | "malayalam" => "Malayalam",
        "mr" | "mar" | "marathi" => "Marathi",
        "pa" | "pan" | "punjabi" | "panjabi" => "Punjabi",
        "gu" | "guj" | "gujarati" => "Gujarati",
        "kn" | "kan" | "kannada" => "Kannada",
        "ar" | "ara" | "arabic" => "Arabic",
        "zh" | "chi" | "zho" | "chinese" => "Chinese",
        "cs" | "cze" | "ces" | "czech" => "Czech",
        "da" | "dan" | "danish" => "Danish",
        "nl" | "dut" | "nld" | "dutch" => "Dutch",
        "fi" | "fin" | "finnish" => "Finnish",
        "fr" | "fre" | "fra" | "french" => "French",
        "de" | "ger" | "deu" | "german" => "German",
        "el" | "gre" | "ell" | "greek" => "Greek",
        "he" | "heb" | "hebrew" => "Hebrew",
        "hu" | "hun" | "hungarian" => "Hungarian",
        "id" | "ind" | "indonesian" => "Indonesian",
        "it" | "ita" | "italian" => "Italian",
        "ja" | "jpn" | "japanese" => "Japanese",
        "ko" | "kor" | "korean" => "Korean",
        "ms" | "may" | "msa" | "malay" => "Malay",
        "no" | "nor" | "norwegian" => "Norwegian",
        "fa" | "per" | "fas" | "persian" => "Persian",
        "pl" | "pol" | "polish" => "Polish",
        "pt" | "por" | "portuguese" => "Portuguese",
        "ro" | "rum" | "ron" | "romanian" => "Romanian",
        "ru" | "rus" | "russian" => "Russian",
        "es" | "spa" | "spanish" => "Spanish",
        "sv" | "swe" | "swedish" => "Swedish",
        "th" | "tha" | "thai" => "Thai",
        "tr" | "tur" | "turkish" => "Turkish",
        "uk" | "ukr" | "ukrainian" => "Ukrainian",
        "vi" | "vie" | "vietnamese" => "Vietnamese",
        _ => "",
    };
    if name.is_empty() {
        trimmed.to_string()
    } else {
        name.to_string()
    }
}

/// Folds provider-specific language spellings into ISO 639-1 where possible.
fn normalize_language_code(value: &str) -> String {
    let raw = value.trim().to_ascii_lowercase();
    if raw.len() <= 3 {
        return language_code_for_name(&raw)
            .unwrap_or(raw.as_str())
            .to_string();
    }
    language_code_for_name(&raw)
        .map(str::to_string)
        .unwrap_or_else(|| language_label(&raw).to_ascii_lowercase())
}

/// ISO 639-1 code for an English language name or a 2/3 letter code.
pub fn language_code_for_name(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "en" | "eng" | "english" => Some("en"),
        "hi" | "hin" | "hindi" => Some("hi"),
        "ur" | "urd" | "urdu" => Some("ur"),
        "bn" | "ben" | "bengali" => Some("bn"),
        "ta" | "tam" | "tamil" => Some("ta"),
        "te" | "tel" | "telugu" => Some("te"),
        "ml" | "mal" | "malayalam" => Some("ml"),
        "mr" | "mar" | "marathi" => Some("mr"),
        "pa" | "pan" | "punjabi" | "panjabi" => Some("pa"),
        "gu" | "guj" | "gujarati" => Some("gu"),
        "kn" | "kan" | "kannada" => Some("kn"),
        "ar" | "ara" | "arabic" => Some("ar"),
        "zh" | "chi" | "zho" | "chinese" => Some("zh"),
        "cs" | "cze" | "ces" | "czech" => Some("cs"),
        "da" | "dan" | "danish" => Some("da"),
        "nl" | "dut" | "nld" | "dutch" => Some("nl"),
        "fi" | "fin" | "finnish" => Some("fi"),
        "fr" | "fre" | "fra" | "french" => Some("fr"),
        "de" | "ger" | "deu" | "german" => Some("de"),
        "el" | "gre" | "ell" | "greek" => Some("el"),
        "he" | "heb" | "hebrew" => Some("he"),
        "hu" | "hun" | "hungarian" => Some("hu"),
        "id" | "ind" | "indonesian" => Some("id"),
        "it" | "ita" | "italian" => Some("it"),
        "ja" | "jpn" | "japanese" => Some("ja"),
        "ko" | "kor" | "korean" => Some("ko"),
        "ms" | "may" | "msa" | "malay" => Some("ms"),
        "no" | "nor" | "norwegian" => Some("no"),
        "fa" | "per" | "fas" | "persian" => Some("fa"),
        "pl" | "pol" | "polish" => Some("pl"),
        "pt" | "por" | "portuguese" => Some("pt"),
        "ro" | "rum" | "ron" | "romanian" => Some("ro"),
        "ru" | "rus" | "russian" => Some("ru"),
        "es" | "spa" | "spanish" => Some("es"),
        "sv" | "swe" | "swedish" => Some("sv"),
        "th" | "tha" | "thai" => Some("th"),
        "tr" | "tur" | "turkish" => Some("tr"),
        "uk" | "ukr" | "ukrainian" => Some("uk"),
        "vi" | "vie" | "vietnamese" => Some("vi"),
        _ => None,
    }
}

/// Language code guessed from a picker label such as `English`, `English [CC]`
/// or `Hindi · OpenSubtitles · 1080p`. Empty when nothing is recognised.
pub fn detect_language_code(label: &str) -> String {
    for token in label.split(|character: char| !character.is_ascii_alphabetic()) {
        if token.len() < 2 {
            continue;
        }
        if let Some(code) = language_code_for_name(token) {
            return code.to_string();
        }
    }
    String::new()
}

/// Best-effort format for ranking/labels; the file itself is sniffed on fetch.
fn guess_format(url: &str) -> &'static str {
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if path.ends_with(".ass") || path.ends_with(".ssa") {
        "ass"
    } else if path.ends_with(".vtt") {
        "vtt"
    } else if path.ends_with(".zip") {
        "zip"
    } else if path.ends_with(".gz") {
        "gz"
    } else {
        // Nearly every provider serves SRT; the file is sniffed again when it
        // is downloaded.
        "srt"
    }
}

/// Hosts the engine may download public subtitles from.
///
/// Explicitly listed (no wildcard catch-all) because the engine fetches these
/// URLs server-side. Every redirect hop is validated again.
pub const ALLOWED_SUBTITLE_HOST_SUFFIXES: &[&str] = &[
    "strem.io",
    "opensubtitles.org",
    "opensubtitles.com",
    "opensubtitles.eu",
    "subdl.com",
    "subdl.org",
    "podnapisi.net",
    "wyzie.io",
    "subsource.net",
    "subf2m.co",
    "yifysubtitles.ch",
    "subscene.com",
];

/// True when a public subtitle URL is safe to fetch server-side.
pub fn is_allowed_subtitle_host(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || !host.contains('.') || host.parse::<std::net::IpAddr>().is_ok() {
        return false;
    }
    ALLOWED_SUBTITLE_HOST_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// Unpacks a downloaded subtitle payload into plain text.
///
/// Providers ship `.srt`/`.vtt` directly, but Podnapisi and others wrap the file
/// in a zip and some endpoints gzip the response. The browser player only
/// understands text (WebVTT/SRT/ASS), so the unpacking happens here.
pub fn decode_subtitle_file(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("Subtitle file is empty".to_string());
    }
    // Zip: read the first entry that looks like a subtitle.
    if bytes.len() > 4 && &bytes[0..2] == b"PK" {
        return decode_zip(bytes);
    }
    // Gzip.
    if bytes.len() > 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        let mut decoder = flate2::read::GzDecoder::new(bytes);
        let mut text = Vec::new();
        decoder
            .read_to_end(&mut text)
            .map_err(|_| "Could not unpack this subtitle file".to_string())?;
        return decode_subtitle_file(&text);
    }
    let text = String::from_utf8_lossy(bytes).to_string();
    if text.trim().is_empty() {
        return Err("Subtitle file is empty".to_string());
    }
    Ok(strip_bom(&text))
}

fn decode_zip(bytes: &[u8]) -> Result<String, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| "Could not read this subtitle archive".to_string())?;
    let mut fallback: Option<String> = None;
    for index in 0..archive.len().min(24) {
        let entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_ascii_lowercase();
        // Archives often carry a readme next to the caption, so only real
        // subtitle extensions win outright; anything else is a fallback.
        let is_subtitle = [".srt", ".vtt", ".ass", ".ssa", ".sub"]
            .iter()
            .any(|extension| name.ends_with(extension));
        let mut contents = Vec::new();
        if std::io::Read::take(entry, 4 * 1024 * 1024)
            .read_to_end(&mut contents)
            .is_err()
        {
            continue;
        }
        let text = String::from_utf8_lossy(&contents).to_string();
        if text.trim().is_empty() {
            continue;
        }
        if is_subtitle {
            return Ok(strip_bom(&text));
        }
        if fallback.is_none() {
            fallback = Some(text);
        }
    }
    fallback
        .map(|text| strip_bom(&text))
        .ok_or_else(|| "This subtitle archive did not contain a readable subtitle".to_string())
}

fn strip_bom(text: &str) -> String {
    let trimmed = text.trim_start_matches('\u{feff}');
    if trimmed.len() == text.len() {
        text.to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cinemeta_search_prefers_the_exact_title_and_year() {
        let payload = json!({
            "metas": [
                { "id": "tt9999999", "name": "Interstellar Wars", "type": "movie", "releaseInfo": "2019" },
                { "id": "tt0816692", "name": "Interstellar", "type": "movie", "releaseInfo": "2014" },
            ]
        });
        assert_eq!(
            parse_cinemeta_search(&payload, "Interstellar", Some("2014"), false),
            Some("tt0816692".to_string())
        );
        // A series search skips entries that are typed as movies…
        let mismatched = json!({
            "metas": [{ "id": "tt1111111", "name": "Some Show", "type": "movie", "releaseInfo": "2020" }]
        });
        assert_eq!(
            parse_cinemeta_search(&mismatched, "Some Show", None, true),
            None
        );
        // …and uses a matching series entry.
        let matched = json!({
            "metas": [{ "id": "tt2222222", "name": "Some Show", "type": "series", "releaseInfo": "2020" }]
        });
        assert_eq!(
            parse_cinemeta_search(&matched, "Some Show", None, true),
            Some("tt2222222".to_string())
        );
        assert_eq!(parse_cinemeta_search(&json!({}), "X", None, false), None);
    }

    #[test]
    fn opensubtitles_v3_results_become_labeled_options() {
        let payload = json!({
            "subtitles": [
                { "id": "1", "url": "https://dl.opensubtitles.org/en/download/sub/1", "lang": "en" },
                { "id": "2", "url": "https://dl.opensubtitles.org/en/download/sub/2", "lang": "hi", "label": "Hindi 1080p" },
                { "id": "3", "url": "https://dl.opensubtitles.org/en/download/sub/1", "lang": "en" },
                { "id": "4", "lang": "en" }
            ]
        });
        let results = parse_opensubtitles_v3(&payload);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].language, "en");
        assert_eq!(results[0].source, "opensubtitles");
        assert_eq!(results[0].name, "English · OpenSubtitles");
        assert_eq!(results[1].name, "Hindi · OpenSubtitles · Hindi 1080p");
    }

    #[test]
    fn wyzie_results_carry_format_downloads_and_sdh_marks() {
        let payload = json!([
            {
                "url": "https://dl.opensubtitles.com/download/1.srt",
                "language": "en",
                "display": "English",
                "format": "srt",
                "downloadCount": 4200,
                "isHearingImpaired": true,
                "release": "Movie.2024.1080p.WEB-DL"
            },
            { "language": "hi", "display": "Hindi" }
        ]);
        let results = parse_wyzie(&payload);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].source, "wyzie");
        assert_eq!(results[0].downloads, Some(4200));
        assert!(results[0].hearing_impaired);
        assert!(
            results[0]
                .name
                .starts_with("English · Wyzie · English [SDH]")
        );
    }

    #[test]
    fn podnapisi_xml_is_parsed_and_download_paths_are_resolved() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
        <results>
          <subtitle>
            <title>Interstellar 2014 1080p</title>
            <language>English</language>
            <url>/subtitles/abc123/download</url>
            <downloads>812</downloads>
          </subtitle>
          <subtitle>
            <title>Interstellar</title>
            <language>Hindi</language>
            <url>https://www.podnapisi.net/subtitles/def456/download</url>
          </subtitle>
          <subtitle><title>No url here</title><language>English</language></subtitle>
        </results>"#;
        let results = parse_podnapisi_xml(xml);
        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].url,
            "https://www.podnapisi.net/subtitles/abc123/download"
        );
        assert_eq!(results[0].language, "en");
        assert_eq!(results[0].downloads, Some(812));
        assert_eq!(
            results[0].name,
            "English · Podnapisi · Interstellar 2014 1080p"
        );
        assert_eq!(results[1].language, "hi");
        assert_eq!(
            results[1].url,
            "https://www.podnapisi.net/subtitles/def456/download"
        );
    }

    #[test]
    fn merge_ranks_english_first_and_drops_duplicates() {
        let opensubtitles = vec![
            PublicSubtitle {
                name: "English · OpenSubtitles · A".into(),
                url: "https://dl.opensubtitles.org/a.srt".into(),
                language: "en".into(),
                source: "opensubtitles".into(),
                format: "srt".into(),
                downloads: Some(10),
                hearing_impaired: false,
            },
            PublicSubtitle {
                name: "Hindi · OpenSubtitles · B".into(),
                url: "https://dl.opensubtitles.org/b.srt".into(),
                language: "hi".into(),
                source: "opensubtitles".into(),
                format: "srt".into(),
                downloads: None,
                hearing_impaired: false,
            },
        ];
        let wyzie = vec![
            PublicSubtitle {
                name: "  english ·  opensubtitles ·  a ".into(),
                url: "https://sub.wyzie.io/mirror/a.srt".into(),
                language: "EN".into(),
                source: "wyzie".into(),
                format: "srt".into(),
                downloads: Some(999),
                hearing_impaired: false,
            },
            PublicSubtitle {
                name: "French · Wyzie · C".into(),
                url: "https://sub.wyzie.io/c.srt".into(),
                language: "fr".into(),
                source: "wyzie".into(),
                format: "srt".into(),
                downloads: Some(5),
                hearing_impaired: false,
            },
        ];
        let merged = merge_providers([opensubtitles, wyzie]);
        let languages: Vec<&str> = merged.iter().map(|entry| entry.language.as_str()).collect();
        assert_eq!(languages, vec!["en", "hi", "fr"]);
        assert_eq!(merged[0].source, "opensubtitles");
    }

    #[test]
    fn language_labels_and_detection_cover_picker_names() {
        assert_eq!(language_label("en"), "English");
        assert_eq!(language_label("English"), "English");
        assert_eq!(language_label("klingon"), "klingon");
        assert_eq!(detect_language_code("English"), "en");
        assert_eq!(detect_language_code("English [CC]"), "en");
        assert_eq!(detect_language_code("Hindi · OpenSubtitles · 1080p"), "hi");
        assert_eq!(detect_language_code("Und"), "");
        assert_eq!(language_priority("eng"), 0);
        assert_eq!(language_priority("hi"), 1);
        assert_eq!(language_priority("fr"), 4);
    }

    #[test]
    fn subtitle_hosts_are_limited_to_known_providers() {
        assert!(is_allowed_subtitle_host("dl.opensubtitles.org"));
        assert!(is_allowed_subtitle_host("opensubtitles-v3.strem.io"));
        assert!(is_allowed_subtitle_host("sub.wyzie.io"));
        assert!(is_allowed_subtitle_host("www.podnapisi.net"));
        assert!(!is_allowed_subtitle_host("127.0.0.1"));
        assert!(!is_allowed_subtitle_host("localhost"));
        assert!(!is_allowed_subtitle_host("evil.test"));
        assert!(!is_allowed_subtitle_host("opensubtitles.org.evil.test"));
        assert!(!is_allowed_subtitle_host(""));
    }

    /// A real zip archive (deflate) holding `release/readme.txt` and
    /// `release/movie.srt`, so the archive path is tested without a zip writer.
    const SRT_ZIP: [u8; 282] = [
        80, 75, 3, 4, 20, 0, 0, 0, 8, 0, 49, 148, 77, 93, 62, 210, 216, 214, 8, 0, 0, 0, 6, 0, 0,
        0, 18, 0, 0, 0, 114, 101, 108, 101, 97, 115, 101, 47, 114, 101, 97, 100, 109, 101, 46, 116,
        120, 116, 203, 203, 47, 73, 45, 230, 2, 0, 80, 75, 3, 4, 20, 0, 0, 0, 8, 0, 49, 148, 77,
        93, 183, 23, 81, 214, 30, 0, 0, 0, 38, 0, 0, 0, 17, 0, 0, 0, 114, 101, 108, 101, 97, 115,
        101, 47, 109, 111, 118, 105, 101, 46, 115, 114, 116, 51, 228, 50, 48, 176, 2, 33, 67, 29,
        3, 3, 3, 5, 93, 93, 59, 5, 168, 128, 17, 72, 128, 203, 35, 53, 39, 39, 159, 11, 0, 80, 75,
        1, 2, 20, 3, 20, 0, 0, 0, 8, 0, 49, 148, 77, 93, 62, 210, 216, 214, 8, 0, 0, 0, 6, 0, 0, 0,
        18, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 1, 0, 0, 0, 0, 114, 101, 108, 101, 97, 115, 101,
        47, 114, 101, 97, 100, 109, 101, 46, 116, 120, 116, 80, 75, 1, 2, 20, 3, 20, 0, 0, 0, 8, 0,
        49, 148, 77, 93, 183, 23, 81, 214, 30, 0, 0, 0, 38, 0, 0, 0, 17, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 128, 1, 56, 0, 0, 0, 114, 101, 108, 101, 97, 115, 101, 47, 109, 111, 118, 105, 101,
        46, 115, 114, 116, 80, 75, 5, 6, 0, 0, 0, 0, 2, 0, 2, 0, 127, 0, 0, 0, 133, 0, 0, 0, 0, 0,
    ];

    #[test]
    fn subtitle_payloads_are_unpacked_from_zip_gzip_and_plain_text() {
        let srt = "1\n00:00:01,000 --> 00:00:02,000\nHello\n";
        assert_eq!(decode_subtitle_file(srt.as_bytes()).unwrap(), srt);
        assert_eq!(
            decode_subtitle_file("\u{feff}1\nHello\n".as_bytes()).unwrap(),
            "1\nHello\n"
        );

        // Zip archives hold a readme plus the subtitle; the subtitle wins.
        assert_eq!(decode_subtitle_file(&SRT_ZIP).unwrap(), srt);

        // Gzip-compressed payloads are inflated first (matching the zip bytes,
        // so this test needs no encoder).
        use std::io::Write;
        let mut gzipped = Vec::new();
        {
            let mut encoder =
                flate2::write::GzEncoder::new(&mut gzipped, flate2::Compression::default());
            encoder.write_all(srt.as_bytes()).unwrap();
            encoder.finish().unwrap();
        }
        assert_eq!(decode_subtitle_file(&gzipped).unwrap(), srt);

        assert!(decode_subtitle_file(&[]).is_err());
        assert!(decode_subtitle_file(&[80, 75, 3, 4, 0, 0]).is_err());
    }
}
