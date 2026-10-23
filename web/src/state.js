// Application-wide UI state: active provider, theme, ambient MeshBackdrop colors,
// ephemeral metadata cache, and Sidify-V2 `menu-glass` toast notifications.

import * as api from './lib/api.js';
import { escapeHtml, isKnownProvider, itemId, itemProvider } from './lib/format.js';
import { ambientColorsFor } from './lib/media-helpers.js';

const PROVIDER_STORAGE = 'ifallhub_provider_v1';
const THEME_STORAGE = 'ifallhub_theme';

function loadProvider() {
  try {
    const raw = localStorage.getItem(PROVIDER_STORAGE);
    if (raw && isKnownProvider(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'moviebox';
}

function loadTheme() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* ignore */
  }
  return 'dark';
}

export const state = {
  provider: loadProvider(),
  theme: loadTheme(),
  ambientColors: ambientColorsFor('Ifallhub'),
  providers: [
    { id: 'moviebox', label: 'Siddharth', supports_discover: true },
    { id: 'fourkhdhub', label: 'Ritu', supports_discover: false },
    { id: 'dramachi', label: 'Sakshi', supports_discover: false },
    { id: 'bdix_circleftp', label: 'Shreya', supports_discover: false },
    { id: 'bdix_dhakaflix', label: 'Everyone', supports_discover: false },
    { id: 'addons', label: 'Ifallhub', supports_discover: false },
  ],
  health: null,
  collections: null,
  collectionsFetchedAt: 0,
  metaCache: new Map(), // `${provider}:${id}` -> { imdb_rating, genres, duration, year, poster_url, media_type }
  detailsCache: new Map(),
};

export function applyTheme(theme = state.theme) {
  state.theme = theme === 'light' || theme === 'system' ? theme : 'dark';
  try {
    localStorage.setItem(THEME_STORAGE, state.theme);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    const resolved =
      state.theme === 'system'
        ? window.matchMedia?.('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : state.theme;
    document.documentElement.dataset.theme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'light' ? '#ffffff' : '#000000');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ifallhub:theme', { detail: state.theme }));
  }
}

export function toggleTheme() {
  const current =
    typeof document !== 'undefined' ? document.documentElement.dataset.theme : state.theme;
  applyTheme(current === 'light' ? 'dark' : 'light');
}

export function setAmbientSeed(seed) {
  const [c0, c1, c2] = ambientColorsFor(seed || 'Ifallhub');
  state.ambientColors = [c0, c1, c2];
  if (typeof document !== 'undefined') {
    const mesh = document.getElementById('mesh-backdrop');
    if (mesh) {
      const b0 = mesh.querySelector('[data-blob="0"]');
      const b1 = mesh.querySelector('[data-blob="1"]');
      const b2 = mesh.querySelector('[data-blob="2"]');
      if (b0) b0.style.background = `radial-gradient(closest-side, ${c0}, transparent 72%)`;
      if (b1) b1.style.background = `radial-gradient(closest-side, ${c1}, transparent 72%)`;
      if (b2) b2.style.background = `radial-gradient(closest-side, ${c2}, transparent 75%)`;
    }
  }
}

export function setProvider(id) {
  if (!isKnownProvider(id)) return;
  state.provider = id;
  try {
    localStorage.setItem(PROVIDER_STORAGE, id);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ifallhub:provider', { detail: id }));
  }
}

export function cacheDetails(provider, id, details) {
  if (!details) return;
  const key = `${provider}:${id}`;
  state.detailsCache.set(key, details);
  state.metaCache.set(key, {
    imdb_rating: details.imdb_rating ?? null,
    genres: details.genres || [],
    duration: details.duration || null,
    year: details.year || null,
    poster_url: details.poster_url || null,
    media_type: details.media_type || 'movie',
  });
}

export function cachedDetails(provider, id) {
  return state.detailsCache.get(`${provider}:${id}`) || null;
}

/**
 * Batch-fetches `/api/meta` for items missing ratings/genres and dispatches
 * `ifallhub:meta` when new metadata arrives so visible cards can patch cleanly.
 */
export async function ensureMeta(items) {
  const byProvider = new Map();
  for (const item of items || []) {
    const provider = itemProvider(item);
    const id = itemId(item);
    if (!id) continue;
    const key = `${provider}:${id}`;
    if (state.metaCache.has(key)) continue;
    if (item.imdb_rating || (Array.isArray(item.genres) && item.genres.length)) {
      state.metaCache.set(key, {
        imdb_rating: item.imdb_rating ?? null,
        genres: item.genres || [],
        duration: item.duration || null,
        year: item.year || null,
        poster_url: item.poster_url || null,
        media_type: item.media_type || 'movie',
      });
      continue;
    }
    if (!byProvider.has(provider)) byProvider.set(provider, []);
    byProvider.get(provider).push(id);
  }

  let updated = false;
  await Promise.all(
    [...byProvider.entries()].map(async ([provider, ids]) => {
      for (let index = 0; index < ids.length; index += 12) {
        const chunk = ids.slice(index, index + 12);
        try {
          const response = await api.meta({ provider, ids: chunk });
          const meta = response?.meta || {};
          for (const [id, entry] of Object.entries(meta)) {
            state.metaCache.set(`${provider}:${id}`, entry);
            updated = true;
          }
        } catch {
          /* Card metadata enrichment is strictly best-effort */
        }
      }
    }),
  );

  if (updated && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ifallhub:meta'));
  }
}

export function cachedMeta(provider, id) {
  return state.metaCache.get(`${provider}:${id}`) || null;
}

/* ── Sidify-V2 Menu-Glass Toast Stack ─────────────────────── */

let activeToasts = [];
let nextToastId = 1;

function renderToasts() {
  if (typeof document === 'undefined') return;
  const host = document.getElementById('toasts-root');
  if (!host) return;
  if (!activeToasts.length) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `
    <div aria-live="polite" class="pointer-events-none fixed inset-x-0 bottom-[86px] desk:bottom-6 z-[95] flex flex-col items-center gap-2 px-4">
      ${activeToasts
        .map(
          (t) => `
          <div class="menu-glass fade-up pointer-events-auto rounded-full px-4 py-2 text-[13.5px] font-medium ${
            t.kind === 'error' ? 'text-danger' : 'text-fg'
          }">
            ${escapeHtml(t.message)}
          </div>`,
        )
        .join('')}
    </div>`;
}

export function toast(message, kind = 'info') {
  if (!message) return;
  const id = nextToastId++;
  activeToasts = [...activeToasts.slice(-2), { id, message: String(message), kind }];
  renderToasts();
  setTimeout(() => {
    activeToasts = activeToasts.filter((t) => t.id !== id);
    renderToasts();
  }, 2600);
}
