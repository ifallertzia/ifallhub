// Pure ranking/recommendation logic. No DOM, no fetch: everything here is unit
// tested (see web/tests) and reused by the home carousels, the details page and
// the "More like this" strip under the player.

import {
  franchiseToken,
  itemId,
  itemProvider,
  itemYear,
  normaliseRating,
  parseYear,
} from './format.js';

const COMPLETED_AT = 0.92;

/** 0-1 completion for a progress entry; falls back to the completed flag. */
export function progressFraction(entry) {
  if (!entry) return 0;
  const duration = Number(entry.duration_seconds) || 0;
  const position = Number(entry.position_seconds) || 0;
  if (duration > 0) return Math.min(1, Math.max(0, position / duration));
  return entry.completed ? 1 : 0;
}

export function isFinished(entry) {
  return Boolean(entry?.completed) || progressFraction(entry) >= COMPLETED_AT;
}

export function remainingSeconds(entry) {
  const duration = Number(entry?.duration_seconds) || 0;
  const position = Number(entry?.position_seconds) || 0;
  if (!duration) return 0;
  return Math.max(0, duration - position);
}

/**
 * "Continue Watching" row: unfinished titles, most recently touched first,
 * merged with the poster/title data the caller has on hand.
 */
export function continueWatching(progress = [], { limit = 12 } = {}) {
  const entries = Array.isArray(progress) ? progress.filter((entry) => entry && entry.id) : [];
  return entries
    .filter((entry) => !isFinished(entry) && Number(entry.position_seconds) > 5)
    .sort((a, b) => (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0))
    .slice(0, limit)
    .map((entry) => ({
      provider: entry.provider,
      id: entry.id,
      title: entry.title,
      poster_url: entry.poster_url || null,
      year: entry.year || null,
      media_type: entry.media_type || 'movie',
      season: Number(entry.season) || 0,
      episode: Number(entry.episode) || 0,
      fraction: progressFraction(entry),
      remaining_seconds: remainingSeconds(entry),
      updated_at: Number(entry.updated_at) || 0,
    }));
}

/** Key that identifies a title across providers. */
export function titleKey(provider, id) {
  return `${String(provider || '').toLowerCase()}::${String(id || '')}`;
}

/** Indexes library lists by title key for O(1) lookups while rendering. */
export function indexByKey(entries = []) {
  const index = new Map();
  for (const entry of entries) {
    if (!entry?.id) continue;
    index.set(titleKey(entry.provider, entry.id), entry);
  }
  return index;
}

function ratingOf(item, metrics = {}) {
  const key = itemId(item);
  const metric = metrics[key] || {};
  return normaliseRating(item?.imdb_rating ?? item?.rating ?? metric.rating);
}

/**
 * Ranks "related" titles returned by the API. Server relevance comes first,
 * then a small boost for titles the viewer already likes and a penalty for
 * titles already in the watchlist or already watched.
 */
export function rankRelated(items = [], { reasons = {}, ratings = {}, watchlist = [], progress = [], limit = 24 } = {}) {
  const rated = indexByKey(Object.entries(ratings || {}).map(([id, rating]) => ({ provider: '', id, rating })));
  const listed = indexByKey(watchlist || []);
  const watched = indexByKey(progress || []);

  return items
    .map((item, index) => {
      const key = itemId(item);
      const providerKey = titleKey(itemProvider(item), key);
      const myRating = Number(rated.get(key)?.rating) || 0;
      const inWatchlist = listed.has(providerKey);
      const watchedEntry = watched.get(providerKey);
      const score =
        (items.length - index) * 2 +
        (ratingOf(item) || 0) * 1.5 +
        myRating * 1.2 +
        (inWatchlist ? 1 : 0) -
        (watchedEntry && isFinished(watchedEntry) ? 4 : 0);
      const token = franchiseToken(item.title);
      const franchise = token ? `More ${token}` : '';
      return {
        item,
        score,
        reasons: [...(reasons[key] || []), ...(franchise ? [franchise] : [])].slice(0, 2),
        rating: ratingOf(item),
        in_watchlist: inWatchlist,
        watched: Boolean(watchedEntry),
        year: parseYear(itemYear(item)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Removes duplicates (by provider+id) while preserving order. */
export function dedupeItems(items = []) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = titleKey(itemProvider(item), itemId(item));
    if (!itemId(item) || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

/** Client-side "similar" fallback when the API has no related endpoint. */
export function similarByMeta(source, candidates = [], { limit = 18 } = {}) {
  if (!source) return [];
  const genres = new Set((source.genres || []).map((genre) => String(genre).toLowerCase()));
  const director = String(source.director || '').toLowerCase();
  const token = franchiseToken(source.title).toLowerCase();
  const sourceYear = parseYear(source.year) || 0;

  return dedupeItems(candidates)
    .filter((item) => itemId(item) !== itemId(source))
    .map((item) => {
      const itemGenres = (item.genres || []).map((genre) => String(genre).toLowerCase());
      const overlap = itemGenres.filter((genre) => genres.has(genre)).length;
      const year = parseYear(itemYear(item)) || 0;
      const score =
        overlap * 3 +
        (director && String(item.director || '').toLowerCase() === director ? 4 : 0) +
        (token && item.title?.toLowerCase().includes(token) ? 3 : 0) +
        (ratingOf(item) || 0) * 0.5 -
        (sourceYear && year ? Math.abs(sourceYear - year) / 20 : 0);
      return { item, score, reasons: [], rating: ratingOf(item), year };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Personalised row built from what the viewer rated and saved: the genres they
 * rate highest drive the picks out of a larger pool.
 */
export function becauseYouWatched(pool = [], { ratings = [], watchlist = [], exclude = [], limit = 24 } = {}) {
  // key -> { weight, label } so reasons keep the catalog's genre casing.
  const preferred = new Map();
  const add = (genre, weight) => {
    const key = String(genre).toLowerCase();
    const existing = preferred.get(key) || { weight: 0, label: String(genre) };
    preferred.set(key, { weight: existing.weight + weight, label: existing.label });
  };
  for (const rating of ratings || []) {
    for (const genre of rating.genres || []) add(genre, Number(rating.rating || 0));
  }
  for (const entry of watchlist || []) {
    for (const genre of entry.genres || []) add(genre, 4);
  }
  if (!preferred.size) return [];
  const skip = new Set((exclude || []).map((item) => titleKey(itemProvider(item), itemId(item))));
  const topGenres = [...preferred.entries()]
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 3);

  return dedupeItems(pool)
    .filter((item) => !skip.has(titleKey(itemProvider(item), itemId(item))))
    .map((item) => {
      const itemGenres = (item.genres || []).map((genre) => String(genre).toLowerCase());
      const matched = topGenres.filter(([genre]) => itemGenres.includes(genre));
      if (!matched.length) return null;
      return {
        item,
        score: matched.reduce((total, [, value]) => total + value.weight, 0) + (ratingOf(item) || 0),
        reasons: [`Because you like ${matched[0][1].label}`],
        rating: ratingOf(item),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Aggregate stats for the tracker page. */
export function libraryStats({ watchlist = [], progress = [], ratings = [] } = {}) {
  const watchedSeconds = (progress || []).reduce(
    (total, entry) => total + Math.min(Number(entry.position_seconds) || 0, Number(entry.duration_seconds) || Number(entry.position_seconds) || 0),
    0,
  );
  const finished = (progress || []).filter((entry) => isFinished(entry)).length;
  const series = (progress || []).filter((entry) => entry.media_type === 'series' || Number(entry.season) > 0);
  const episodes = series.reduce(
    (total, entry) => total + (Number(entry.season) > 0 || Number(entry.episode) > 0 ? 1 : 0),
    0,
  );
  const rated = (ratings || []).map((entry) => Number(entry.rating) || 0).filter((value) => value > 0);
  const average = rated.length ? rated.reduce((total, value) => total + value, 0) / rated.length : 0;
  const lastWatched = (progress || []).reduce(
    (latest, entry) => Math.max(latest, Number(entry.updated_at) || 0),
    0,
  );
  return {
    watchlist_count: (watchlist || []).length,
    started: (progress || []).length,
    finished,
    episodes,
    hours: Math.round((watchedSeconds / 3600) * 10) / 10,
    average_rating: Math.round(average * 10) / 10,
    rated_count: rated.length,
    last_watched: lastWatched,
    in_progress: (progress || []).length - finished,
  };
}

/**
 * Picks hero candidates from the first carousel: highly rated first, then
 * whatever the catalog ranked as trending.
 */
export function heroCandidates(items = [], metrics = {}, { limit = 5 } = {}) {
  const scored = dedupeItems(items).map((item) => {
    const rating = ratingOf(item, metrics);
    return { item, rating, score: (rating || 0) * 2 + (item.poster_url ? 1 : 0) };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/** Sort helpers shared by the browse page. */
export const SORTERS = {
  relevance: () => 0,
  rating: (a, b) => (ratingOf(b) || 0) - (ratingOf(a) || 0),
  year: (a, b) => (parseYear(itemYear(b)) || 0) - (parseYear(itemYear(a)) || 0),
  title: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
};

export function sortItems(items = [], sort = 'relevance') {
  const sorter = SORTERS[sort] || SORTERS.relevance;
  return [...items].sort(sorter);
}
