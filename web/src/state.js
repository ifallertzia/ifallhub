// Shared client state + cross-view helpers (toasts, metadata enrichment).

import * as api from './lib/api.js';
import * as library from './lib/library.js';
import {
  displayUiText,
  formatRating,
  itemId,
  itemProvider,
  itemTitle,
  itemYear,
  normaliseRating,
  ratingTone,
} from './lib/format.js';
import { titleKey } from './lib/recommend.js';

export const app = {
  provider: 'moviebox',
  providers: [],
  rows: [],
  metrics: {},
  pool: [],
  meta: new Map(),
  genreLookup: new Map(),
  details: null,
  toastTimer: 0,
};

const metaListeners = new Set();

export function onMeta(listener) {
  metaListeners.add(listener);
  return () => metaListeners.delete(listener);
}

function emitMeta(keys) {
  for (const listener of metaListeners) listener(keys);
}

export function metaKey(provider, id) {
  return titleKey(provider, id);
}

export function metaFor(item) {
  return app.meta.get(metaKey(itemProvider(item) || app.provider, itemId(item))) || {};
}

export function officialRating(item) {
  const meta = metaFor(item);
  const fromMeta = normaliseRating(meta.rating);
  if (fromMeta !== null) return fromMeta;
  const metric = app.metrics[itemId(item)] || {};
  return normaliseRating(item?.imdb_rating ?? item?.rating ?? metric.rating);
}

/**
 * Fetches IMDb ratings/genres for items that lack them, in batches of 12, then
 * notifies listeners so visible cards can show their score.
 */
export async function ensureMeta(items = [], { provider } = {}) {
  const pending = [];
  for (const item of items) {
    const key = metaKey(provider || itemProvider(item) || app.provider, itemId(item));
    if (app.meta.has(key) || !itemId(item)) continue;
    if (officialRating(item) !== null) continue;
    pending.push({ key, id: itemId(item), provider: provider || itemProvider(item) || app.provider });
  }
  if (!pending.length) return;
  if (api.state.supports.meta === false) return;

  const groups = [];
  const byProvider = new Map();
  for (const entry of pending) {
    const list = byProvider.get(entry.provider) || [];
    list.push(entry);
    byProvider.set(entry.provider, list);
  }
  for (const [entryProvider, entries] of byProvider) {
    for (let index = 0; index < entries.length; index += 12) {
      groups.push({ provider: entryProvider, batch: entries.slice(index, index + 12) });
    }
  }

  const updated = [];
  for (const group of groups) {
    try {
      const payload = await api.meta({ provider: group.provider, ids: group.batch.map((entry) => entry.id) });
      api.markSupport('meta', true);
      for (const [id, value] of Object.entries(payload.meta || {})) {
        const entry = group.batch.find((candidate) => candidate.id === id);
        const key = entry?.key || metaKey(group.provider, id);
        app.meta.set(key, value || {});
        if (Array.isArray(value?.genres) && value.genres.length) app.genreLookup.set(key, value.genres);
        updated.push(key);
      }
    } catch (error) {
      if (error?.status === 404) api.markSupport('meta', false);
      return;
    }
  }
  if (updated.length) emitMeta(updated);
}

/** Meta for a card: official rating + library state. */
export function cardMeta(item, extra = {}) {
  const provider = extra.provider || itemProvider(item) || app.provider;
  const id = extra.id || itemId(item);
  const progress = library.progressFor(provider, id);
  return {
    provider,
    id,
    title: extra.title || itemTitle(item),
    year: extra.year ?? itemYear(item),
    poster: extra.poster ?? item?.poster_url ?? item?.cover_url ?? '',
    rating: extra.rating ?? officialRating(item),
    progress: extra.progress ?? progress,
    listed: extra.listed ?? library.isInWatchlist(provider, id),
    myRating: library.ratingFor(provider, id),
    reason: extra.reason || '',
    duration: extra.duration || metaFor(item).duration || item?.duration || '',
    ...extra,
  };
}

/** Patches rating badges into cards that were rendered before meta arrived. */
export function applyMetaToDom(root = document) {
  root.querySelectorAll('[data-card]').forEach((card) => {
    const provider = card.dataset.provider;
    const id = card.dataset.id;
    const meta = app.meta.get(metaKey(provider, id));
    if (!meta) return;
    const rating = formatRating(meta.rating);
    if (!rating) return;
    const badge = card.querySelector('.card-rating');
    if (badge) {
      badge.querySelector('span').textContent = rating;
      badge.className = `card-rating tone-${ratingTone(rating)}`;
    } else {
      const media = card.querySelector('.card-media');
      if (media) {
        const span = document.createElement('span');
        span.className = `card-rating tone-${ratingTone(rating)}`;
        span.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8z" /></svg>';
        const value = document.createElement('span');
        value.textContent = rating;
        span.append(value);
        media.append(span);
      }
    }
  });
}

export function toast(message, tone = 'info') {
  const element = document.querySelector('#toast');
  if (!element) return;
  element.textContent = displayUiText(message);
  element.className = `toast is-visible is-${tone}`;
  window.clearTimeout(app.toastTimer);
  app.toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), 4200);
}

/** Caches details-derived metadata so cards keep their score after navigation. */
export function rememberGenres(details) {
  if (!details?.id) return;
  const key = metaKey(details.id.provider, details.id.value);
  const genres = Array.isArray(details.genres) ? details.genres : [];
  const previous = app.meta.get(key) || {};
  const rating = normaliseRating(details.imdb_rating) ?? previous.rating ?? null;
  if (genres.length) app.genreLookup.set(key, genres);
  app.meta.set(key, {
    ...previous,
    rating,
    genres: genres.length ? genres : previous.genres || [],
    duration: details.duration || previous.duration || null,
  });
}
