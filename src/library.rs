//! Persistent library for the web client: watchlist, watch progress and
//! personal ratings.
//!
//! The terminal UI keeps its own favorites/history files; this module backs the
//! browser UI so a deployment remembers what you saved, where you stopped and
//! what you rated, even after a restart. Every mutation bumps a version number
//! and is broadcast on a channel so connected browsers can live-sync through
//! `GET /api/library/events` (see `web_api`).
//!
//! Storage is a single JSON document under the data directory, written
//! atomically through the shared cache helpers.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::Mutex;
use tokio::sync::broadcast;

/// Hard cap per list so a stray client cannot grow the file without bound.
pub const MAX_ENTRIES: usize = 600;

const EVENT_CHANNEL_CAPACITY: usize = 64;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Stable identity for a title inside the library.
pub fn entry_key(provider: &str, id: &str) -> String {
    format!("{}::{}", provider.trim().to_ascii_lowercase(), id.trim())
}

fn clamp_text(value: Option<String>, max: usize) -> Option<String> {
    value
        .map(|text| text.trim().chars().take(max).collect::<String>())
        .filter(|text| !text.is_empty())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub provider: String,
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub poster_url: Option<String>,
    #[serde(default)]
    pub year: Option<String>,
    /// `movie` or `series`.
    #[serde(default)]
    pub media_type: String,
    /// Official (IMDb) rating captured when the title was saved, 0-10 scale.
    #[serde(default)]
    pub official_rating: Option<f64>,
    pub added_at: u64,
    #[serde(default)]
    pub updated_at: u64,
}

impl LibraryEntry {
    pub fn key(&self) -> String {
        entry_key(&self.provider, &self.id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressEntry {
    pub provider: String,
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub poster_url: Option<String>,
    #[serde(default)]
    pub year: Option<String>,
    #[serde(default)]
    pub media_type: String,
    #[serde(default)]
    pub season: usize,
    #[serde(default)]
    pub episode: usize,
    #[serde(default)]
    pub position_seconds: u64,
    #[serde(default)]
    pub duration_seconds: Option<u64>,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub updated_at: u64,
}

impl ProgressEntry {
    pub fn key(&self) -> String {
        entry_key(&self.provider, &self.id)
    }

    /// 0.0-1.0, used by the browser for progress bars and "resume" decisions.
    pub fn fraction(&self) -> f64 {
        match self.duration_seconds {
            Some(duration) if duration > 0 => {
                (self.position_seconds as f64 / duration as f64).clamp(0.0, 1.0)
            }
            _ => 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatingEntry {
    pub provider: String,
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub poster_url: Option<String>,
    #[serde(default)]
    pub year: Option<String>,
    /// Personal rating, 1-10. Zero removes the rating.
    pub rating: u8,
    #[serde(default)]
    pub updated_at: u64,
}

impl RatingEntry {
    pub fn key(&self) -> String {
        entry_key(&self.provider, &self.id)
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct LibrarySnapshot {
    #[serde(default)]
    pub watchlist: Vec<LibraryEntry>,
    #[serde(default)]
    pub progress: Vec<ProgressEntry>,
    #[serde(default)]
    pub ratings: Vec<RatingEntry>,
    #[serde(default)]
    pub version: u64,
}

impl LibrarySnapshot {
    pub fn to_json(&self) -> Value {
        json!({
            "version": self.version,
            "synced_at": now_secs(),
            "watchlist": self.watchlist,
            "progress": self.progress,
            "ratings": self.ratings,
        })
    }

    fn trim(&mut self) {
        if self.watchlist.len() > MAX_ENTRIES {
            self.watchlist.sort_by_key(|entry| entry.added_at);
            let excess = self.watchlist.len() - MAX_ENTRIES;
            self.watchlist.drain(0..excess);
        }
        if self.progress.len() > MAX_ENTRIES {
            self.progress.sort_by_key(|entry| entry.updated_at);
            let excess = self.progress.len() - MAX_ENTRIES;
            self.progress.drain(0..excess);
        }
        if self.ratings.len() > MAX_ENTRIES {
            self.ratings.sort_by_key(|entry| entry.updated_at);
            let excess = self.ratings.len() - MAX_ENTRIES;
            self.ratings.drain(0..excess);
        }
    }
}

/// One library change, broadcast to every connected browser.
#[derive(Debug, Clone)]
pub struct LibraryEvent {
    pub version: u64,
    pub scope: &'static str,
    pub key: String,
}

pub struct LibraryStore {
    snapshot: Mutex<LibrarySnapshot>,
    path: Option<PathBuf>,
    events: broadcast::Sender<LibraryEvent>,
}

impl LibraryStore {
    /// Loads the stored library from `path` (or starts empty when `None`).
    pub fn load(path: Option<PathBuf>) -> Arc<Self> {
        let snapshot = match path.as_ref() {
            Some(path) if path.exists() => match std::fs::read_to_string(path) {
                Ok(content) => match serde_json::from_str::<LibrarySnapshot>(&content) {
                    Ok(snapshot) => snapshot,
                    Err(error) => {
                        crate::config::rotate_corrupt_file(path, &format!("web library ({error})"));
                        LibrarySnapshot::default()
                    }
                },
                Err(error) => {
                    log::warn!(
                        "failed to read web library from {}: {error}",
                        crate::logging::sanitize_path(path)
                    );
                    LibrarySnapshot::default()
                }
            },
            _ => LibrarySnapshot::default(),
        };
        let (events, _receiver) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Arc::new(Self {
            snapshot: Mutex::new(snapshot),
            path,
            events,
        })
    }

    /// Library backed by the standard data directory.
    pub fn new() -> Arc<Self> {
        Self::load(crate::config::web_library_path())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<LibraryEvent> {
        self.events.subscribe()
    }

    pub async fn snapshot(&self) -> LibrarySnapshot {
        self.snapshot.lock().await.clone()
    }

    pub async fn to_json(&self) -> Value {
        self.snapshot.lock().await.to_json()
    }

    /// Adds or removes a watchlist entry, returning the new "is listed" state.
    pub async fn toggle_watchlist(&self, mut entry: LibraryEntry, remove: bool) -> bool {
        let key = entry.key();
        let mut snapshot = self.snapshot.lock().await;
        if remove {
            let before = snapshot.watchlist.len();
            snapshot.watchlist.retain(|item| item.key() != key);
            // Commit only when something actually left the list, otherwise every
            // unlist request would rewrite the file and wake every client.
            let removed = snapshot.watchlist.len() != before;
            self.commit(&mut snapshot, "watchlist", key, removed);
            return false;
        }
        let stamp = now_secs();
        entry.updated_at = stamp;
        match snapshot.watchlist.iter_mut().find(|item| item.key() == key) {
            Some(existing) => {
                let unchanged = existing.title == entry.title
                    && existing.poster_url == entry.poster_url
                    && existing.year == entry.year
                    && existing.media_type == entry.media_type
                    && existing.official_rating == entry.official_rating;
                if unchanged {
                    // Already listed with the same data: no write, no event.
                    return true;
                }
                entry.added_at = existing.added_at;
                *existing = entry;
            }
            None => {
                entry.added_at = stamp;
                snapshot.watchlist.push(entry);
            }
        }
        self.commit(&mut snapshot, "watchlist", key, true);
        true
    }

    pub async fn upsert_progress(
        &self,
        mut entry: ProgressEntry,
        remove: bool,
    ) -> Option<ProgressEntry> {
        let key = entry.key();
        let mut snapshot = self.snapshot.lock().await;
        if remove {
            let before = snapshot.progress.len();
            snapshot.progress.retain(|item| item.key() != key);
            if snapshot.progress.len() != before {
                self.commit(&mut snapshot, "progress", key, true);
            }
            return None;
        }
        entry.updated_at = now_secs();
        let stored = match snapshot.progress.iter_mut().find(|item| item.key() == key) {
            Some(existing) => {
                *existing = entry;
                existing.clone()
            }
            None => {
                snapshot.progress.push(entry.clone());
                entry
            }
        };
        self.commit(&mut snapshot, "progress", key, true);
        Some(stored)
    }

    /// Stores a 1-10 personal rating; a rating of zero removes it.
    pub async fn set_rating(&self, mut entry: RatingEntry) -> bool {
        let key = entry.key();
        let mut snapshot = self.snapshot.lock().await;
        if entry.rating == 0 {
            let before = snapshot.ratings.len();
            snapshot.ratings.retain(|item| item.key() != key);
            let removed = snapshot.ratings.len() != before;
            self.commit(&mut snapshot, "ratings", key, removed);
            return false;
        }
        entry.rating = entry.rating.min(10);
        entry.updated_at = now_secs();
        match snapshot.ratings.iter_mut().find(|item| item.key() == key) {
            Some(existing) => {
                if existing.rating == entry.rating {
                    return true;
                }
                *existing = entry;
            }
            None => snapshot.ratings.push(entry),
        }
        self.commit(&mut snapshot, "ratings", key, true);
        true
    }

    /// Clears one scope (`watchlist`, `progress`, `ratings`) or everything.
    pub async fn clear(&self, scope: &str) {
        let mut snapshot = self.snapshot.lock().await;
        let cleared = match scope {
            "watchlist" => !snapshot.watchlist.is_empty(),
            "progress" => !snapshot.progress.is_empty(),
            "ratings" => !snapshot.ratings.is_empty(),
            _ => {
                !snapshot.watchlist.is_empty()
                    || !snapshot.progress.is_empty()
                    || !snapshot.ratings.is_empty()
            }
        };
        match scope {
            "watchlist" => snapshot.watchlist.clear(),
            "progress" => snapshot.progress.clear(),
            "ratings" => snapshot.ratings.clear(),
            _ => {
                snapshot.watchlist.clear();
                snapshot.progress.clear();
                snapshot.ratings.clear();
            }
        }
        self.commit(&mut snapshot, "clear", "*".to_string(), cleared);
    }

    /// Bumps the version, persists and notifies subscribers.
    fn commit(
        &self,
        snapshot: &mut LibrarySnapshot,
        scope: &'static str,
        key: String,
        changed: bool,
    ) {
        if !changed {
            return;
        }
        snapshot.trim();
        snapshot.version = snapshot.version.wrapping_add(1);
        self.persist(snapshot);
        let _ = self.events.send(LibraryEvent {
            version: snapshot.version,
            scope,
            key,
        });
    }

    fn persist(&self, snapshot: &LibrarySnapshot) {
        let Some(path) = self.path.as_ref() else {
            return;
        };
        match serde_json::to_string(snapshot) {
            Ok(content) => {
                if let Err(error) = crate::cache::atomic_write_file(path, content.as_bytes()) {
                    log::warn!("failed to save web library: {error}");
                }
            }
            Err(error) => log::warn!("failed to encode web library: {error}"),
        }
    }
}

/// Normalises a client-supplied library entry into a stored watchlist entry.
pub fn watchlist_entry(
    provider: &str,
    id: &str,
    title: &str,
    poster_url: Option<String>,
    year: Option<String>,
    media_type: Option<String>,
    official_rating: Option<f64>,
) -> LibraryEntry {
    LibraryEntry {
        provider: provider.to_string(),
        id: id.to_string(),
        title: clamp_text(Some(title.to_string()), 300).unwrap_or_else(|| id.to_string()),
        poster_url: clamp_text(poster_url, 2048),
        year: clamp_text(year, 12),
        media_type: media_type.unwrap_or_else(|| "movie".to_string()),
        official_rating,
        added_at: now_secs(),
        updated_at: now_secs(),
    }
}

/// Normalises a client-supplied progress update.
///
/// One argument per stored column; grouping them into a struct would only move
/// the same eleven fields to the call site in `web_api`.
#[allow(clippy::too_many_arguments)]
pub fn progress_entry(
    provider: &str,
    id: &str,
    title: &str,
    poster_url: Option<String>,
    year: Option<String>,
    media_type: Option<String>,
    season: usize,
    episode: usize,
    position_seconds: u64,
    duration_seconds: Option<u64>,
    completed: bool,
) -> ProgressEntry {
    ProgressEntry {
        provider: provider.to_string(),
        id: id.to_string(),
        title: clamp_text(Some(title.to_string()), 300).unwrap_or_else(|| id.to_string()),
        poster_url: clamp_text(poster_url, 2048),
        year: clamp_text(year, 12),
        media_type: media_type.unwrap_or_else(|| "movie".to_string()),
        season,
        episode,
        position_seconds,
        duration_seconds,
        completed,
        updated_at: now_secs(),
    }
}

/// Normalises a client-supplied personal rating (1-10; zero removes it).
pub fn rating_entry(
    provider: &str,
    id: &str,
    title: &str,
    poster_url: Option<String>,
    year: Option<String>,
    rating: u8,
) -> RatingEntry {
    RatingEntry {
        provider: provider.to_string(),
        id: id.to_string(),
        title: clamp_text(Some(title.to_string()), 300).unwrap_or_else(|| id.to_string()),
        poster_url: clamp_text(poster_url, 2048),
        year: clamp_text(year, 12),
        rating: rating.min(10),
        updated_at: now_secs(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(provider: &str, id: &str, title: &str) -> LibraryEntry {
        watchlist_entry(provider, id, title, None, None, None, Some(8.1))
    }

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ifallhub-library-{}-{name}",
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    #[tokio::test]
    async fn watchlist_toggle_is_idempotent_and_persists() {
        let path = temp_path("toggle");
        let store = LibraryStore::load(Some(path.clone()));
        assert!(
            store
                .toggle_watchlist(entry("moviebox", "1", "Dune"), false)
                .await
        );
        assert!(
            store
                .toggle_watchlist(entry("moviebox", "1", "Dune"), false)
                .await
        );
        assert_eq!(store.snapshot().await.watchlist.len(), 1);

        let reloaded = LibraryStore::load(Some(path.clone()));
        assert_eq!(reloaded.snapshot().await.watchlist.len(), 1);
        assert_eq!(reloaded.snapshot().await.version, 1);

        assert!(
            !store
                .toggle_watchlist(entry("moviebox", "1", "Dune"), true)
                .await
        );
        assert!(store.snapshot().await.watchlist.is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn providers_with_same_id_are_distinct() {
        let store = LibraryStore::load(None);
        store
            .toggle_watchlist(entry("moviebox", "42", "Heat"), false)
            .await;
        store
            .toggle_watchlist(entry("dramachi", "42", "Heat"), false)
            .await;
        assert_eq!(store.snapshot().await.watchlist.len(), 2);
    }

    #[tokio::test]
    async fn progress_upsert_keeps_latest_position() {
        let store = LibraryStore::load(None);
        let update = |position: u64| {
            progress_entry(
                "moviebox",
                "7",
                "Interstellar",
                None,
                None,
                None,
                0,
                0,
                position,
                Some(10_140),
                false,
            )
        };
        store.upsert_progress(update(60), false).await;
        let stored = store.upsert_progress(update(600), false).await.unwrap();
        assert_eq!(stored.position_seconds, 600);
        assert_eq!(store.snapshot().await.progress.len(), 1);
        assert!((stored.fraction() - 600.0 / 10_140.0).abs() < 1e-9);
    }

    #[tokio::test]
    async fn rating_zero_removes_and_ten_is_the_ceiling() {
        let store = LibraryStore::load(None);
        let mut rating = RatingEntry {
            provider: "moviebox".into(),
            id: "9".into(),
            title: "Oldboy".into(),
            poster_url: None,
            year: None,
            rating: 12,
            updated_at: 0,
        };
        assert!(store.set_rating(rating.clone()).await);
        assert_eq!(store.snapshot().await.ratings[0].rating, 10);

        rating.rating = 0;
        assert!(!store.set_rating(rating).await);
        assert!(store.snapshot().await.ratings.is_empty());
    }

    #[tokio::test]
    async fn every_mutation_bumps_the_version_once() {
        let store = LibraryStore::load(None);
        assert_eq!(store.snapshot().await.version, 0);
        store
            .toggle_watchlist(entry("moviebox", "1", "Dune"), false)
            .await;
        store
            .toggle_watchlist(entry("moviebox", "1", "Dune"), false)
            .await;
        assert_eq!(store.snapshot().await.version, 1);
        store
            .toggle_watchlist(entry("moviebox", "1", "Dune"), true)
            .await;
        assert_eq!(store.snapshot().await.version, 2);
    }

    #[tokio::test]
    async fn removals_persist_and_bump_the_version() {
        let path = temp_path("remove");
        let store = LibraryStore::load(Some(path.clone()));
        store
            .toggle_watchlist(entry("moviebox", "1", "Dune"), false)
            .await;
        store
            .set_rating(rating_entry("moviebox", "1", "Dune", None, None, 7))
            .await;
        assert_eq!(store.snapshot().await.version, 2);

        // The returned bool is "is it listed now", never "did something change".
        assert!(
            !store
                .toggle_watchlist(entry("moviebox", "1", "Dune"), true)
                .await
        );
        assert!(
            !store
                .set_rating(rating_entry("moviebox", "1", "Dune", None, None, 0))
                .await
        );

        let snapshot = store.snapshot().await;
        assert_eq!(snapshot.version, 4);
        assert!(snapshot.watchlist.is_empty());
        assert!(snapshot.ratings.is_empty());
        drop(snapshot);

        let reloaded = LibraryStore::load(Some(path.clone()));
        assert_eq!(reloaded.snapshot().await.version, 4);
        assert!(reloaded.snapshot().await.watchlist.is_empty());
        assert!(reloaded.snapshot().await.ratings.is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn clearing_an_empty_scope_is_a_no_op() {
        let store = LibraryStore::load(None);
        store.clear("watchlist").await;
        assert_eq!(store.snapshot().await.version, 0);

        store
            .toggle_watchlist(entry("moviebox", "1", "Dune"), false)
            .await;
        store.clear("watchlist").await;
        assert_eq!(store.snapshot().await.version, 2);
        assert!(store.snapshot().await.watchlist.is_empty());
    }

    #[tokio::test]
    async fn clear_scopes_are_independent() {
        let store = LibraryStore::load(None);
        store
            .toggle_watchlist(entry("moviebox", "1", "Dune"), false)
            .await;
        store
            .upsert_progress(
                progress_entry(
                    "moviebox",
                    "1",
                    "Dune",
                    None,
                    None,
                    None,
                    0,
                    0,
                    30,
                    Some(100),
                    false,
                ),
                false,
            )
            .await;
        store.clear("progress").await;
        let snapshot = store.snapshot().await;
        assert_eq!(snapshot.watchlist.len(), 1);
        assert!(snapshot.progress.is_empty());
        store.clear("all").await;
        assert!(store.snapshot().await.watchlist.is_empty());
    }

    #[tokio::test]
    async fn subscribers_receive_change_events() {
        let store = LibraryStore::load(None);
        let mut receiver = store.subscribe();
        store
            .toggle_watchlist(entry("moviebox", "3", "Parasite"), false)
            .await;
        let event = receiver.recv().await.expect("event");
        assert_eq!(event.scope, "watchlist");
        assert_eq!(event.key, "moviebox::3");
    }

    #[tokio::test]
    async fn corrupt_file_is_rotated_and_recovered() {
        let path = temp_path("corrupt");
        std::fs::write(&path, "{not json").unwrap();
        let store = LibraryStore::load(Some(path.clone()));
        assert!(store.snapshot().await.watchlist.is_empty());
        let rotated = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .any(|entry| entry.file_name().to_string_lossy().contains("corrupt"));
        assert!(rotated, "corrupt library file should be rotated aside");
        let _ = std::fs::remove_file(&path);
    }
}
