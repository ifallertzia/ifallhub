// Library store: watchlist, watch progress and personal ratings.
//
// Server-first: every change is written to the Rust API so the whole library
// survives restarts and syncs across devices. Browsers stay in step through
// /api/library/events (server-sent events); if the deployment runs an older
// engine without those routes the store transparently falls back to
// localStorage and cross-tab `storage` events, so the UI never breaks.

import * as api from './api.js';
import { titleKey } from './recommend.js';

const LOCAL_KEY = 'ifallhub_library_v1';
const POLL_INTERVAL_MS = 8000;
const RECONNECT_MIN_MS = 1500;
const RECONNECT_MAX_MS = 30000;

export const state = {
  mode: 'loading', // loading | server | local
  version: 0,
  syncedAt: 0,
  live: false,
  watchlist: [],
  progress: [],
  ratings: [],
  lastError: '',
};

const listeners = new Set();
let eventSource = null;
let pollTimer = 0;
let reconnectDelay = RECONNECT_MIN_MS;
let started = false;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(reason = 'change') {
  const snapshot = {
    mode: state.mode,
    version: state.version,
    live: state.live,
    watchlist: state.watchlist,
    progress: state.progress,
    ratings: state.ratings,
  };
  for (const listener of listeners) listener(snapshot, reason);
}

// --- Local fallback storage ------------------------------------------------

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { watchlist: [], progress: [], ratings: [], version: 0 };
    const parsed = JSON.parse(raw);
    return {
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      progress: Array.isArray(parsed.progress) ? parsed.progress : [],
      ratings: Array.isArray(parsed.ratings) ? parsed.ratings : [],
      version: Number(parsed.version) || 0,
    };
  } catch {
    return { watchlist: [], progress: [], ratings: [], version: 0 };
  }
}

function writeLocal() {
  try {
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({
        watchlist: state.watchlist,
        progress: state.progress,
        ratings: state.ratings,
        version: state.version,
      }),
    );
  } catch {
    /* Storage may be unavailable; the in-memory copy still works. */
  }
}

function applySnapshot(snapshot, { source = 'server' } = {}) {
  state.watchlist = Array.isArray(snapshot.watchlist) ? snapshot.watchlist : [];
  state.progress = Array.isArray(snapshot.progress) ? snapshot.progress : [];
  state.ratings = Array.isArray(snapshot.ratings) ? snapshot.ratings : [];
  state.version = Number(snapshot.version) || state.version;
  state.syncedAt = Number(snapshot.synced_at) || Math.floor(Date.now() / 1000);
  state.mode = source === 'server' ? 'server' : 'local';
  state.lastError = '';
  emit('sync');
}

// --- Selectors -------------------------------------------------------------

export function isInWatchlist(provider, id) {
  const key = titleKey(provider, id);
  return state.watchlist.some((entry) => titleKey(entry.provider, entry.id) === key);
}

export function watchlistEntry(provider, id) {
  const key = titleKey(provider, id);
  return state.watchlist.find((entry) => titleKey(entry.provider, entry.id) === key) || null;
}

export function progressFor(provider, id) {
  const key = titleKey(provider, id);
  return state.progress.find((entry) => titleKey(entry.provider, entry.id) === key) || null;
}

export function ratingFor(provider, id) {
  const key = titleKey(provider, id);
  const entry = state.ratings.find((item) => titleKey(item.provider, item.id) === key);
  return entry ? Number(entry.rating) || 0 : 0;
}

/** Genre-weighted ratings, used by the personalised "Because you watch" row. */
export function ratedWithGenres(genreLookup = new Map()) {
  return state.ratings.map((entry) => ({
    ...entry,
    genres: genreLookup.get(titleKey(entry.provider, entry.id)) || [],
  }));
}

// --- Bootstrapping ---------------------------------------------------------

export async function start() {
  if (started) return state;
  started = true;
  const local = readLocal();
  if (local.watchlist.length || local.progress.length || local.ratings.length) {
    applySnapshot(local, { source: 'local' });
  }
  try {
    const snapshot = await api.library({
      onUnauthorized: () => window.dispatchEvent(new CustomEvent('ifallhub:access-needed')),
    });
    applySnapshot(snapshot, { source: 'server' });
    api.markSupport('library', true);
    mergeLocalIntoServer(local);
    connectEvents();
  } catch (error) {
    api.markSupport('library', false);
    state.mode = 'local';
    state.lastError = error?.message || '';
    startPolling();
    emit('fallback');
  }
  return state;
}

/** Pushes anything saved while offline up to the server once it is reachable. */
async function mergeLocalIntoServer(local) {
  const serverKeys = new Set(state.watchlist.map((entry) => titleKey(entry.provider, entry.id)));
  const pending = (local.watchlist || []).filter(
    (entry) => !serverKeys.has(titleKey(entry.provider, entry.id)),
  );
  for (const entry of pending) {
    try {
      await api.saveWatchlist(entry);
    } catch {
      break;
    }
  }
  if (pending.length) await refresh();
}

export async function refresh() {
  if (state.mode !== 'server') return state;
  try {
    const snapshot = await api.library();
    applySnapshot(snapshot, { source: 'server' });
  } catch (error) {
    state.lastError = error?.message || '';
  }
  return state;
}

// --- Live sync -------------------------------------------------------------

function connectEvents() {
  if (typeof EventSource !== 'function') {
    startPolling();
    return;
  }
  closeEvents();
  const source = new EventSource('/api/library/events');
  eventSource = source;
  source.addEventListener('library', (event) => {
    try {
      applySnapshot(JSON.parse(event.data), { source: 'server' });
    } catch {
      refresh();
    }
    reconnectDelay = RECONNECT_MIN_MS;
    state.live = true;
    api.markSupport('events', true);
    stopPolling();
  });
  source.addEventListener('ping', () => {
    state.live = true;
  });
  source.onerror = () => {
    state.live = false;
    api.markSupport('events', false);
    closeEvents();
    startPolling();
    // Retry the stream with backoff; polling keeps the UI fresh meanwhile.
    window.setTimeout(() => {
      if (state.mode === 'server' && !eventSource) {
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
        connectEvents();
      }
    }, reconnectDelay);
  };
}

function closeEvents() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  window.clearInterval(pollTimer);
  pollTimer = 0;
}

// Another tab changed the local fallback store.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== LOCAL_KEY || state.mode === 'server') return;
    applySnapshot(readLocal(), { source: 'local' });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.mode === 'server') refresh();
  });
}

// --- Mutations -------------------------------------------------------------

function bump() {
  state.version += 1;
  if (state.mode !== 'server') writeLocal();
  emit('mutate');
}

function localEntry(entry) {
  const stamp = Math.floor(Date.now() / 1000);
  return {
    poster_url: null,
    year: null,
    media_type: 'movie',
    ...entry,
    provider: String(entry.provider || ''),
    id: String(entry.id || ''),
    title: entry.title || 'Untitled',
    added_at: entry.added_at || stamp,
    updated_at: stamp,
  };
}

/** Adds or removes a watchlist entry. Returns the new "is listed" state. */
export async function toggleWatchlist(entry, force) {
  const provider = String(entry.provider || '');
  const id = String(entry.id || '');
  if (!provider || !id) return false;
  const listed = force ?? !isInWatchlist(provider, id);
  const key = titleKey(provider, id);

  if (listed) {
    const existing = state.watchlist.find((item) => titleKey(item.provider, item.id) === key);
    const next = localEntry({ ...entry, added_at: existing?.added_at });
    if (existing) Object.assign(existing, next);
    else state.watchlist.unshift(next);
  } else {
    state.watchlist = state.watchlist.filter((item) => titleKey(item.provider, item.id) !== key);
  }
  bump();

  if (state.mode === 'server') {
    try {
      const snapshot = await api.saveWatchlist(localEntry(entry), !listed);
      applySnapshot(snapshot, { source: 'server' });
    } catch (error) {
      state.lastError = error?.message || 'Could not reach the engine';
    }
  }
  return listed;
}

/** Stores (or clears) the resume point for a title. */
export async function updateProgress(entry, { remove = false } = {}) {
  const provider = String(entry.provider || '');
  const id = String(entry.id || '');
  if (!provider || !id) return null;
  const key = titleKey(provider, id);
  const existing = state.progress.find((item) => titleKey(item.provider, item.id) === key);

  if (remove) {
    state.progress = state.progress.filter((item) => titleKey(item.provider, item.id) !== key);
    bump();
    if (state.mode === 'server') {
      try {
        applySnapshot(await api.saveProgress(entry, true), { source: 'server' });
      } catch (error) {
        state.lastError = error?.message || '';
      }
    }
    return null;
  }

  const next = {
    ...localEntry({ ...entry, added_at: existing?.added_at }),
    season: Number(entry.season) || 0,
    episode: Number(entry.episode) || 0,
    position_seconds: Math.max(0, Math.floor(Number(entry.position_seconds) || 0)),
    duration_seconds: Number(entry.duration_seconds) > 0 ? Math.floor(Number(entry.duration_seconds)) : null,
    completed: Boolean(entry.completed),
  };
  if (existing) Object.assign(existing, next);
  else state.progress.unshift(next);
  state.progress.sort((a, b) => (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0));
  bump();

  if (state.mode === 'server') {
    try {
      applySnapshot(await api.saveProgress(next), { source: 'server' });
    } catch (error) {
      state.lastError = error?.message || '';
    }
  }
  return next;
}

/** Stores a 1-10 personal rating; pass 0 to remove it. */
export async function setRating(entry, rating) {
  const provider = String(entry.provider || '');
  const id = String(entry.id || '');
  if (!provider || !id) return 0;
  const value = Math.max(0, Math.min(10, Math.round(Number(rating) || 0)));
  const key = titleKey(provider, id);

  if (value === 0) {
    state.ratings = state.ratings.filter((item) => titleKey(item.provider, item.id) !== key);
  } else {
    const next = { ...localEntry(entry), rating: value };
    const existing = state.ratings.find((item) => titleKey(item.provider, item.id) === key);
    if (existing) Object.assign(existing, next);
    else state.ratings.unshift(next);
  }
  bump();

  if (state.mode === 'server') {
    try {
      applySnapshot(await api.saveRating({ ...entry, rating: value }), { source: 'server' });
    } catch (error) {
      state.lastError = error?.message || '';
    }
  }
  return value;
}

export async function clear(scope = 'all') {
  if (scope === 'all' || scope === 'watchlist') state.watchlist = [];
  if (scope === 'all' || scope === 'progress') state.progress = [];
  if (scope === 'all' || scope === 'ratings') state.ratings = [];
  bump();
  if (state.mode === 'server') {
    try {
      applySnapshot(await api.clearLibrary(scope), { source: 'server' });
    } catch (error) {
      state.lastError = error?.message || '';
    }
  }
}
