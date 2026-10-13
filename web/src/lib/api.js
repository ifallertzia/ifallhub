// Thin client for the Ifallhub API. Same-origin by default so the production
// server can proxy /api/* to the Rust engine; the access key (when the operator
// set one) is attached to every call and never leaves this browser.

import { escapeHtml } from './format.js';

const ACCESS_KEY_STORAGE = 'ifallhub_access_key';

export const state = {
  engine: 'checking', // checking | connected | demo | offline
  version: '',
  supports: {
    collections: null,
    related: null,
    suggest: null,
    meta: null,
    library: null,
    events: null,
  },
};

const listeners = new Set();

export function onEngineChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener({ ...state });
}

export function setEngine(status, version = state.version) {
  state.engine = status;
  state.version = version;
  emit();
}

export function markSupport(feature, supported) {
  if (state.supports[feature] === supported) return;
  state.supports[feature] = supported;
  emit();
}

export function getAccessKey() {
  try {
    return localStorage.getItem(ACCESS_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setAccessKey(key) {
  try {
    if (key) localStorage.setItem(ACCESS_KEY_STORAGE, key);
    else localStorage.removeItem(ACCESS_KEY_STORAGE);
  } catch {
    /* Private browsing can block storage. */
  }
  // EventSource cannot send headers, so the key is mirrored into the
  // `moviebox_key` cookie the API already accepts. Same-origin only.
  try {
    const value = key
      ? `moviebox_key=${encodeURIComponent(key)}; Path=/; SameSite=Strict; Max-Age=31536000`
      : 'moviebox_key=; Path=/; SameSite=Strict; Max-Age=0';
    document.cookie = value;
  } catch {
    /* Cookies may be blocked; header auth still works for normal requests. */
  }
}

export function apiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const key = getAccessKey();
  if (key) headers['X-MovieBox-Key'] = key;
  const response = await fetch(path, { ...options, headers, signal: options.signal });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() };

  if (response.status === 401 && (options.accessAttempts || 0) < 3) {
    setAccessKey('');
    const unlocked = await options.onUnauthorized?.();
    if (unlocked) return api(path, { ...options, accessAttempts: (options.accessAttempts || 0) + 1 });
  }
  if (response.status === 404 && options.onMissing) return options.onMissing();
  if (!response.ok) {
    throw new ApiError(payload.error || `Request failed (${response.status})`, response.status);
  }
  return payload;
}

export async function checkEngine() {
  try {
    const health = await api('/api/health');
    if (health.mode === 'demo') setEngine('demo', health.version || '');
    else setEngine('connected', health.version || '');
    return health;
  } catch {
    setEngine('offline', '');
    return null;
  }
}

// --- Endpoints -------------------------------------------------------------

export const providers = (options) => api('/api/providers', options);

export function collections({ limit = 24, pages = 3 } = {}, options = {}) {
  return api(apiUrl('/api/collections', { limit, pages }), options);
}

export function discover({ provider = 'moviebox', page = 1 } = {}, options = {}) {
  return api(apiUrl('/api/discover', { provider, page }), options);
}

export function search({ q, provider = 'moviebox', page = 1 } = {}, options = {}) {
  return api(apiUrl('/api/search', { q, provider, page }), options);
}

export function suggest({ q } = {}, options = {}) {
  return api(apiUrl('/api/suggest', { q }), options);
}

export function details({ provider, id } = {}, options = {}) {
  return api(apiUrl('/api/details', { provider, id }), options);
}

export function related({ provider, id, limit = 18 } = {}, options = {}) {
  return api(apiUrl('/api/related', { provider, id, limit }), options);
}

export function meta({ provider, ids = [] } = {}, options = {}) {
  return api(apiUrl('/api/meta', { provider, id: ids.join(',') }), options);
}

export function streams({
  provider,
  id,
  season = 0,
  episode = 0,
  isSeries = false,
  expectedTitle = '',
  expectedYear = '',
} = {}, options = {}) {
  return api(
    apiUrl('/api/streams', {
      provider,
      id,
      season,
      episode,
      is_series: isSeries ? 'true' : 'false',
      expected_title: expectedTitle,
      expected_year: expectedYear,
    }),
    options,
  );
}

export function subtitles({ title, year = '', season = 0, episode = 0 } = {}, options = {}) {
  return api(apiUrl('/api/subtitles', { title, year, season, episode }), options);
}

export function subtitleFile({ setId, index } = {}, options = {}) {
  return api(apiUrl('/api/subtitle-file', { set_id: setId, index }), options);
}

export function play({ streamSetId, releaseIndex, mirrorIndex = 0 } = {}, options = {}) {
  return api('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stream_set_id: streamSetId,
      release_index: releaseIndex,
      mirror_index: mirrorIndex,
    }),
    ...options,
  });
}

export function library(options = {}) {
  return api('/api/library', options);
}

export function saveWatchlist(entry, remove = false, options = {}) {
  return api('/api/library/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...entry, remove }),
    ...options,
  });
}

export function saveProgress(entry, remove = false, options = {}) {
  return api('/api/library/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...entry, remove }),
    ...options,
  });
}

export function saveRating(entry, options = {}) {
  return api('/api/library/rating', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
    ...options,
  });
}

export function clearLibrary(scope = 'all', options = {}) {
  return api('/api/library/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
    ...options,
  });
}

/** Human-readable copy for provider errors surfaced in the UI. */
export function describeError(error) {
  const message = error?.message || 'The engine did not respond.';
  return escapeHtml(message).replace(/&amp;/g, '&');
}
