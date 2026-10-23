// Entry point: mounts Sidify-V2's `AppShell` (`MeshBackdrop`, `Sidebar`, `TopBar` LCD,
// iOS-26 Liquid Glass `MobileNav`, `Sheets`, and `Toasts`) and wires all routes to
// Ifallhub's `/api/*` backend.

import './style.css';

import * as api from './lib/api.js';
import {
  escapeHtml,
  isSeriesItem,
  providerLabel,
} from './lib/format.js';
import * as library from './lib/library.js';
import { detailPathFor, mediaArt } from './lib/media-helpers.js';
import { continueWatching, progressFraction } from './lib/recommend.js';
import * as router from './lib/router.js';
import {
  applyTheme,
  setProvider,
  state,
  toast,
  toggleTheme,
} from './state.js';
import { iconHtml, logoFullHtml, logoMarkHtml } from './ui/icons.js';
import { openEngineSheet } from './ui/sheets.js';
import { renderDetails } from './views/details.js';
import { renderMediaBrowse, renderMovies, renderSeries } from './views/media-browse.js';
import { renderMyList } from './views/mylist.js';
import { renderSearch } from './views/search.js';
import { renderTracker } from './views/tracker.js';
import { renderWatch } from './views/watch.js';

function renderShellMarkup() {
  const [c0, c1, c2] = state.ambientColors;
  return `
    <div id="mesh-backdrop" aria-hidden="true" class="pointer-events-none fixed inset-x-0 top-0 z-0 h-[520px] overflow-hidden">
      <div class="absolute inset-0 transition-opacity duration-1000" style="opacity: var(--ambient-opacity)">
        <div
          data-blob="0"
          class="absolute -top-36 -left-24 h-[520px] w-[62%] rounded-full blur-3xl transition-[background] duration-1000"
          style="background: radial-gradient(closest-side, ${c0}, transparent 72%)"
        ></div>
        <div
          data-blob="1"
          class="absolute -top-28 -right-24 h-[480px] w-[58%] rounded-full blur-3xl transition-[background] duration-1000"
          style="background: radial-gradient(closest-side, ${c1}, transparent 72%)"
        ></div>
        <div
          data-blob="2"
          class="absolute top-10 left-1/4 h-[380px] w-[50%] rounded-full blur-3xl transition-[background] duration-1000"
          style="background: radial-gradient(closest-side, ${c2}, transparent 75%)"
        ></div>
      </div>
      <div class="page-shade absolute inset-0"></div>
    </div>

    <div class="relative z-10 flex min-h-dvh desk:h-dvh desk:overflow-hidden">
      <!-- Desktop Sidify-V2 Frosted Sidebar -->
      <aside
        aria-label="Primary"
        class="chrome-glass relative z-20 hidden w-[220px] shrink-0 flex-col select-none shadow-[inset_-0.5px_0_0_var(--hairline)] desk:flex"
      >
        <div class="flex h-[58px] items-center justify-between px-5">
          <a href="/movies" data-nav class="rounded-lg focus:outline-none">
            ${logoFullHtml('Ifallhub')}
          </a>
        </div>

        <div class="px-3.5 pb-3">
          <div class="relative">
            <span class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-2">
              ${iconHtml('search', { size: 15 })}
            </span>
            <input
              id="sidebar-search"
              type="search"
              placeholder="Search"
              aria-label="Search movies and series"
              autocomplete="off"
              spellcheck="false"
              class="field h-9 w-full rounded-[7px] pr-7 pl-8 text-[13.5px]"
            />
            <button
              type="button"
              id="sidebar-search-clear"
              hidden
              aria-label="Clear search"
              class="absolute top-1/2 right-1.5 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-fg-2 hover:text-fg"
            >
              ${iconHtml('x', { size: 12 })}
            </button>
            <div
              id="sidebar-suggest"
              hidden
              class="menu-glass absolute top-[calc(100%+6px)] right-0 left-0 z-40 overflow-hidden rounded-[10px] py-1"
            ></div>
          </div>
        </div>

        <nav class="flex-1 overflow-y-auto px-2.5 pb-4" id="sidebar-nav">
          <div class="space-y-0.5">
            <a href="/movies" data-nav data-side-link="movies" class="flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[14px] text-fg-2 transition-colors hover:bg-fill hover:text-fg">
              <span data-side-icon>${iconHtml('clapperboard', { size: 17 })}</span>
              <span class="truncate">Movies</span>
            </a>
            <a href="/series" data-nav data-side-link="series" class="flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[14px] text-fg-2 transition-colors hover:bg-fill hover:text-fg">
              <span data-side-icon>${iconHtml('tv', { size: 17 })}</span>
              <span class="truncate">Series</span>
            </a>
            <a href="/watchlist" data-nav data-side-link="watchlist" class="flex h-8 items-center justify-between gap-2 rounded-[7px] px-2.5 text-[14px] text-fg-2 transition-colors hover:bg-fill hover:text-fg">
              <span class="inline-flex min-w-0 items-center gap-2.5">
                <span data-side-icon>${iconHtml('bookmark', { size: 17 })}</span>
                <span class="truncate">Watchlist</span>
              </span>
              <span id="sidebar-watchlist-count" hidden class="rounded-full bg-fill-2 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-fg-2">0</span>
            </a>
            <a href="/tracker" data-nav data-side-link="tracker" class="flex h-8 items-center justify-between gap-2 rounded-[7px] px-2.5 text-[14px] text-fg-2 transition-colors hover:bg-fill hover:text-fg">
              <span class="inline-flex min-w-0 items-center gap-2.5">
                <span data-side-icon>${iconHtml('clock', { size: 17 })}</span>
                <span class="truncate">History</span>
              </span>
              <span id="sidebar-progress-count" hidden class="rounded-full bg-fill-2 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-fg-2">0</span>
            </a>
            <a href="/search" data-nav data-side-link="search" class="flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[14px] text-fg-2 transition-colors hover:bg-fill hover:text-fg">
              <span data-side-icon>${iconHtml('search', { size: 17 })}</span>
              <span class="truncate">Search</span>
            </a>
          </div>

          <div class="t-eyebrow mt-6 mb-1.5 px-2.5 text-fg-2">Sources</div>
          <div class="space-y-0.5" id="sidebar-sources"></div>
        </nav>

        <div class="flex items-center justify-between px-3.5 py-3 shadow-[inset_0_0.5px_0_var(--hairline)]">
          <button
            type="button"
            data-open-settings
            class="inline-flex min-w-0 items-center gap-2 rounded-[7px] px-2 py-1 text-[12.5px] font-medium text-fg-2 transition hover:bg-fill hover:text-fg"
          >
            <span id="sidebar-engine-dot" class="h-2 w-2 shrink-0 rounded-full bg-fg-3"></span>
            <span id="sidebar-engine-label" class="truncate">Connecting…</span>
          </button>
          <button
            type="button"
            data-toggle-theme
            aria-label="Toggle theme"
            class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-2 transition hover:bg-fill hover:text-fg"
          >
            <span data-theme-icon>${iconHtml('sun', { size: 15 })}</span>
          </button>
        </div>
      </aside>

      <!-- Main Column -->
      <div class="flex min-w-0 flex-1 flex-col desk:overflow-hidden">
        <!-- Desktop Sidify-V2 TopBar with Functional LCD -->
        <header class="chrome-glass sticky top-0 z-20 hidden h-[60px] shrink-0 items-center gap-3 px-4 select-none shadow-[inset_0_-0.5px_0_var(--hairline)] desk:flex">
          <div class="flex items-center gap-0.5">
            <button
              type="button"
              data-hist-back
              aria-label="Back"
              class="grid h-8 w-8 place-items-center rounded-full text-fg-2 transition hover:bg-fill hover:text-fg"
            >
              ${iconHtml('chevronLeft', { size: 19 })}
            </button>
            <button
              type="button"
              data-hist-forward
              aria-label="Forward"
              class="grid h-8 w-8 place-items-center rounded-full text-fg-2 transition hover:bg-fill hover:text-fg"
            >
              ${iconHtml('chevronRight', { size: 19 })}
            </button>
          </div>

          <div
            id="topbar-lcd"
            class="relative mx-auto flex h-[46px] min-w-0 flex-1 max-w-[560px] items-center overflow-hidden rounded-[6px] bg-lcd ring-1 ring-inset ring-edge"
          ></div>

          <div class="flex items-center gap-1.5">
            <button
              type="button"
              data-open-settings
              class="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-[12.5px] font-semibold text-fg transition hover:bg-fill-2"
            >
              <span id="topbar-engine-dot" class="h-2 w-2 rounded-full bg-fg-3"></span>
              <span id="topbar-provider-label">${escapeHtml(providerLabel(state.provider))}</span>
            </button>
            <button
              type="button"
              data-toggle-theme
              aria-label="Switch theme"
              class="grid h-8 w-8 place-items-center rounded-full text-fg-2 transition hover:bg-fill hover:text-fg"
            >
              <span data-theme-icon>${iconHtml('sun', { size: 16 })}</span>
            </button>
            <button
              type="button"
              data-open-settings
              aria-label="Settings and Access Key"
              class="grid h-8 w-8 place-items-center rounded-full text-fg-2 transition hover:bg-fill hover:text-fg"
            >
              ${iconHtml('sliders', { size: 16 })}
            </button>
          </div>
        </header>

        <!-- Mobile Minimal Top Strip -->
        <div class="flex items-center justify-between px-4 pt-[max(10px,env(safe-area-inset-top))] pb-1 desk:hidden">
          <a href="/movies" data-nav class="rounded-lg">
            ${logoFullHtml('Ifallhub')}
          </a>
          <div class="flex items-center gap-1">
            <button
              type="button"
              data-toggle-theme
              aria-label="Toggle theme"
              class="grid h-8 w-8 place-items-center rounded-full bg-fill text-fg-2"
            >
              <span data-theme-icon>${iconHtml('sun', { size: 15 })}</span>
            </button>
            <button
              type="button"
              data-open-settings
              aria-label="Settings"
              class="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-[12px] font-semibold text-fg"
            >
              <span id="mobile-engine-dot" class="h-2 w-2 rounded-full bg-fg-3"></span>
              <span id="mobile-provider-label">${escapeHtml(providerLabel(state.provider))}</span>
            </button>
          </div>
        </div>

        <main
          id="view-root"
          class="flex-1 pb-[calc(92px+env(safe-area-inset-bottom))] focus:outline-none desk:overflow-y-auto desk:pb-10"
          tabindex="-1"
        ></main>
      </div>

      <!-- Mobile Sidify-V2 iOS-26 Liquid Glass Floating Pill Nav -->
      <nav
        aria-label="Primary mobile"
        class="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pt-1 pb-[max(10px,env(safe-area-inset-bottom))] select-none desk:hidden"
      >
        <div class="bar-glass liquid-float pointer-events-auto relative mx-auto flex h-[64px] max-w-[440px] items-center justify-around overflow-hidden rounded-full px-1.5">
          <span aria-hidden="true" class="liquid-edge pointer-events-none absolute inset-0 rounded-full"></span>
          <span aria-hidden="true" class="liquid-sheen pointer-events-none absolute inset-0 rounded-full"></span>
          <span aria-hidden="true" class="pointer-events-none absolute inset-x-7 top-0 h-[0.5px] bg-white/55"></span>
          ${[
            { id: 'movies', href: '/movies', label: 'Movies', icon: 'clapperboard' },
            { id: 'series', href: '/series', label: 'Series', icon: 'tv' },
            { id: 'search', href: '/search', label: 'Search', icon: 'search' },
            { id: 'watchlist', href: '/watchlist', label: 'Watchlist', icon: 'bookmark' },
            { id: 'tracker', href: '/tracker', label: 'History', icon: 'clock' },
          ]
            .map(
              (t) => `
              <a
                href="${t.href}"
                data-nav
                data-mobile-link="${t.id}"
                class="relative z-10 flex h-[52px] flex-1 flex-col items-center justify-center gap-[3px] rounded-full text-[10px] font-semibold tracking-[-0.1px] text-fg-2 transition-colors active:scale-95"
              >
                <span data-mobile-pill hidden class="pill-glass pointer-events-none absolute inset-0 rounded-full"></span>
                <span class="relative z-10">${iconHtml(t.icon, { size: 20 })}</span>
                <span class="relative z-10 leading-none">${t.label}</span>
              </a>`,
            )
            .join('')}
        </div>
      </nav>
    </div>`;
}

const appRoot = document.getElementById('app');
appRoot.innerHTML = renderShellMarkup();
applyTheme(state.theme);

const viewRoot = document.getElementById('view-root');
const sidebarSearch = document.getElementById('sidebar-search');
const sidebarSearchClear = document.getElementById('sidebar-search-clear');

/* ── Shell State Synchronizers ─────────────────────────────── */

function activeSectionForPath(pathname = window.location.pathname) {
  if (pathname.startsWith('/series')) return 'series';
  if (pathname.startsWith('/search')) return 'search';
  if (pathname.startsWith('/watchlist') || pathname.startsWith('/mylist')) return 'watchlist';
  if (pathname.startsWith('/tracker') || pathname.startsWith('/history')) return 'tracker';
  return 'movies';
}

function syncNavHighlight(pathname = window.location.pathname) {
  const active = activeSectionForPath(pathname);

  document.querySelectorAll('[data-side-link]').forEach((el) => {
    const on = el.dataset.sideLink === active;
    el.className = `flex h-8 items-center justify-between gap-2 rounded-[7px] px-2.5 text-[14px] transition-colors ${
      on ? 'bg-fill-2 font-semibold text-fg' : 'text-fg-2 hover:bg-fill hover:text-fg'
    }`;
    const ic = el.querySelector('[data-side-icon]');
    if (ic) ic.className = `shrink-0 ${on ? 'text-playing' : 'text-fg-2'}`;
  });

  document.querySelectorAll('[data-mobile-link]').forEach((el) => {
    const on = el.dataset.mobileLink === active;
    el.classList.toggle('text-playing', on);
    el.classList.toggle('text-fg-2', !on);
    const pill = el.querySelector('[data-mobile-pill]');
    if (pill) pill.hidden = !on;
  });
}

function syncSidebarSources() {
  const host = document.getElementById('sidebar-sources');
  if (!host) return;
  host.innerHTML = state.providers
    .map((p) => {
      const on = p.id === state.provider;
      return `<button
        type="button"
        data-pick-source="${escapeHtml(p.id)}"
        class="flex h-7.5 w-full items-center justify-between rounded-[7px] px-2.5 text-[13.5px] transition-colors ${
          on ? 'bg-fill-2 font-semibold text-fg' : 'text-fg-2 hover:bg-fill hover:text-fg'
        }"
      >
        <span class="truncate">${escapeHtml(providerLabel(p.id))}</span>
        ${on ? `<span class="h-1.5 w-1.5 rounded-full bg-playing"></span>` : ''}
      </button>`;
    })
    .join('');

  const topLabel = document.getElementById('topbar-provider-label');
  const mobLabel = document.getElementById('mobile-provider-label');
  if (topLabel) topLabel.textContent = providerLabel(state.provider);
  if (mobLabel) mobLabel.textContent = providerLabel(state.provider);
}

function syncEngineBadges() {
  const mode = api.state.engine;
  const dotClass =
    mode === 'connected'
      ? 'bg-emerald-400'
      : mode === 'demo'
        ? 'bg-amber-400'
        : mode === 'locked'
          ? 'bg-amber-400'
          : 'bg-red-400';
  const label =
    mode === 'connected'
      ? 'Live Backend'
      : mode === 'demo'
        ? 'Demo Mode'
        : mode === 'locked'
          ? 'Key Required'
          : 'Offline';

  for (const id of ['sidebar-engine-dot', 'topbar-engine-dot', 'mobile-engine-dot']) {
    const el = document.getElementById(id);
    if (el) el.className = `h-2 w-2 shrink-0 rounded-full ${dotClass}`;
  }
  const sideLbl = document.getElementById('sidebar-engine-label');
  if (sideLbl) sideLbl.textContent = label;
  syncTopbarLcd();
}

function syncThemeIcons() {
  const isLight = document.documentElement.dataset.theme === 'light';
  document.querySelectorAll('[data-theme-icon]').forEach((el) => {
    el.innerHTML = iconHtml(isLight ? 'moon' : 'sun', { size: 15 });
  });
}

function syncTopbarLcd() {
  const lcd = document.getElementById('topbar-lcd');
  if (!lcd) return;

  const cw = continueWatching(library.state.progress || [], { limit: 1 });
  if (cw.length) {
    const entry = cw[0];
    const series = entry.media_type === 'series' || Number(entry.season) > 0;
    const fallback = mediaArt(entry.title, entry.year, series ? 'series' : 'movie', 'poster');
    const poster = entry.poster_url || fallback;
    const pct = Math.round(progressFraction(entry) * 100);
    const href = detailPathFor(entry.provider, entry.id, series);
    const epTag = Number(entry.season) > 0 ? ` · S${entry.season} E${entry.episode || 1}` : '';

    lcd.innerHTML = `
      <a href="${escapeHtml(href)}" data-nav class="h-[46px] w-[36px] shrink-0 overflow-hidden bg-raised">
        <img src="${escapeHtml(poster)}" data-fallback-src="${escapeHtml(fallback)}" alt="" class="h-full w-full object-cover" />
      </a>
      <a href="${escapeHtml(href)}" data-nav class="flex min-w-0 flex-1 flex-col items-center justify-center px-3 text-center">
        <div class="w-full truncate text-[12.5px] leading-tight font-semibold text-fg">${escapeHtml(entry.title)}</div>
        <div class="w-full truncate text-[11px] leading-tight text-fg-2">
          Continue watching${escapeHtml(epTag)} · ${pct}%
        </div>
      </a>
      <a
        href="${escapeHtml(router.watchPath(entry.provider, entry.id, { season: Number(entry.season) || 0, episode: Number(entry.episode) || 0 }))}"
        data-nav
        aria-label="Resume ${escapeHtml(entry.title)}"
        class="pill-selected mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-full transition"
      >
        ${iconHtml('play', { size: 12 })}
      </a>
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-fill-2">
        <div class="h-full bg-brand" style="width:${pct}%"></div>
      </div>`;
    return;
  }

  const mode = api.state.engine;
  const statusCopy =
    mode === 'connected'
      ? `Connected · ${providerLabel(state.provider)}`
      : mode === 'demo'
        ? `Preview catalog · ${providerLabel(state.provider)}`
        : 'Pick a movie or series';

  lcd.innerHTML = `
    <div class="flex flex-1 items-center justify-center gap-2 text-fg-2">
      ${logoMarkHtml(20, 'opacity-80')}
      <span class="text-[12.5px] font-medium">${escapeHtml(statusCopy)}</span>
    </div>`;
}

function syncLibraryBadges() {
  const wlCount = library.state.watchlist?.length || 0;
  const cwCount = continueWatching(library.state.progress || [], { limit: 50 }).length;

  const wlEl = document.getElementById('sidebar-watchlist-count');
  if (wlEl) {
    wlEl.textContent = String(wlCount);
    wlEl.hidden = wlCount === 0;
  }
  const prEl = document.getElementById('sidebar-progress-count');
  if (prEl) {
    prEl.textContent = String(cwCount);
    prEl.hidden = cwCount === 0;
  }
  syncTopbarLcd();
}

/* ── Global Delegated Interactions ─────────────────────────── */

// 1. Automatic SVG fallback artwork when any external poster/backdrop fails to load
document.addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (img?.tagName === 'IMG' && img.dataset?.fallbackSrc && img.src !== img.dataset.fallbackSrc) {
      img.src = img.dataset.fallbackSrc;
    }
  },
  true,
);

// 2. Sidebar live search + MovieBox-TUI `/api/suggest`
const sidebarSuggest = document.getElementById('sidebar-suggest');
let sidebarTimer = 0;
let sidebarSuggestTimer = 0;

function hideSidebarSuggest() {
  if (sidebarSuggest) {
    sidebarSuggest.hidden = true;
    sidebarSuggest.innerHTML = '';
  }
}

function searchHrefFor(qText) {
  const clean = String(qText || '').trim();
  const params = new URLSearchParams();
  if (clean) params.set('q', clean);
  if (state.provider && state.provider !== 'moviebox') params.set('provider', state.provider);
  const qs = params.toString();
  return `/search${qs ? `?${qs}` : ''}`;
}

sidebarSearch?.addEventListener('input', () => {
  const val = sidebarSearch.value;
  if (sidebarSearchClear) sidebarSearchClear.hidden = !val;

  clearTimeout(sidebarSuggestTimer);
  sidebarSuggestTimer = setTimeout(async () => {
    const clean = val.trim();
    if (clean.length < 2 || api.state.supports.suggest === false || !sidebarSuggest) {
      hideSidebarSuggest();
      return;
    }
    try {
      const res = await api.suggest({ q: clean });
      api.markSupport('suggest', true);
      const list = Array.isArray(res?.suggestions) ? res.suggestions : Array.isArray(res) ? res : [];
      if (!list.length || document.activeElement !== sidebarSearch) {
        hideSidebarSuggest();
        return;
      }
      sidebarSuggest.hidden = false;
      sidebarSuggest.innerHTML = list
        .slice(0, 6)
        .map(
          (s) => `<button
            type="button"
            data-side-suggest="${escapeHtml(String(s))}"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-fg transition hover:bg-fill"
          >
            <span class="text-fg-3">${iconHtml('search', { size: 12 })}</span>
            <span class="truncate">${escapeHtml(String(s))}</span>
          </button>`,
        )
        .join('');
    } catch (err) {
      if (err?.status === 404 || err?.status === 501) api.markSupport('suggest', false);
    }
  }, 180);

  clearTimeout(sidebarTimer);
  sidebarTimer = setTimeout(() => {
    const clean = val.trim();
    if (clean) void router.navigate(searchHrefFor(clean));
    else if (window.location.pathname.startsWith('/search')) void router.navigate(searchHrefFor(''));
  }, 280);
});

sidebarSearch?.addEventListener('blur', () => {
  setTimeout(hideSidebarSuggest, 160);
});

sidebarSearch?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(sidebarTimer);
    hideSidebarSuggest();
    void router.navigate(searchHrefFor(sidebarSearch.value));
  }
});

sidebarSearchClear?.addEventListener('click', () => {
  if (!sidebarSearch) return;
  sidebarSearch.value = '';
  sidebarSearchClear.hidden = true;
  hideSidebarSuggest();
  if (window.location.pathname.startsWith('/search')) void router.navigate(searchHrefFor(''));
  sidebarSearch.focus();
});

// 3. Global click delegation (Shelf arrows, Watchlist bookmarks, Quick Play, Shell controls)
document.addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest('[data-hist-back]')) {
    window.history.back();
    return;
  }
  if (target.closest('[data-hist-forward]')) {
    window.history.forward();
    return;
  }
  if (target.closest('[data-toggle-theme]')) {
    toggleTheme();
    return;
  }
  if (target.closest('[data-open-settings]')) {
    openEngineSheet();
    return;
  }

  const pickSrc = target.closest('[data-pick-source]');
  if (pickSrc) {
    const nextProv = pickSrc.dataset.pickSource;
    setProvider(nextProv);
    toast(`Source switched to ${providerLabel(nextProv)}`);
    const path = window.location.pathname;
    if (path === '/' || path.startsWith('/movies') || path.startsWith('/series')) {
      const base = path.startsWith('/series') ? '/series' : '/movies';
      router.navigate(nextProv === 'moviebox' ? base : `${base}?provider=${encodeURIComponent(nextProv)}`);
    } else if (path.startsWith('/search')) {
      const q = new URLSearchParams(window.location.search).get('q') || '';
      router.navigate(`/search?provider=${encodeURIComponent(nextProv)}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    }
    return;
  }

  const sideSug = target.closest('[data-side-suggest]');
  if (sideSug) {
    const picked = sideSug.dataset.sideSuggest || '';
    if (sidebarSearch) sidebarSearch.value = picked;
    hideSidebarSuggest();
    void router.navigate(searchHrefFor(picked));
    return;
  }

  // Horizontal Shelf Scroll Arrows
  const scrollBtn = target.closest('[data-scroll]');
  if (scrollBtn) {
    const rail = scrollBtn.closest('[data-rail]') || scrollBtn.parentElement;
    const track = rail?.querySelector('[data-track]');
    if (track) {
      const dir = Number(scrollBtn.dataset.scroll) || 1;
      track.scrollBy({ left: dir * Math.max(280, track.clientWidth * 0.82), behavior: 'smooth' });
    }
    return;
  }

  // Watchlist Bookmark Toggle on any card / hero
  const wlBtn = target.closest('[data-watchlist]');
  if (wlBtn) {
    event.preventDefault();
    event.stopPropagation();
    const card = wlBtn.closest('[data-card]');
    if (!card) return;
    const entry = {
      provider: card.dataset.provider || state.provider,
      id: card.dataset.id,
      title: card.dataset.title || 'Untitled',
      year: card.dataset.year || null,
      poster_url: card.dataset.poster || null,
      media_type: card.dataset.type || 'movie',
    };
    const listed = await library.toggleWatchlist(entry);
    toast(listed ? `Saved “${entry.title}” to Watchlist` : `Removed “${entry.title}” from Watchlist`);
  }
});

// 4. Global `/` shortcut focuses search
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    const pageSearch = document.querySelector('[data-search-input], [data-browse-search]');
    if (pageSearch) pageSearch.focus();
    else sidebarSearch?.focus();
  }
});

/* ── Subscriptions & Router Registration ───────────────────── */

window.addEventListener('ifallhub:theme', syncThemeIcons);
window.addEventListener('ifallhub:provider', syncSidebarSources);
window.addEventListener('ifallhub:refresh-view', () =>
  router.navigate(window.location.pathname + window.location.search, { replace: true }),
);
api.onEngineChange((engine) => {
  syncEngineBadges();
  if (engine === 'locked') openEngineSheet({ focusKey: true });
});
library.subscribe(syncLibraryBadges);

router.onRoute((route) => {
  syncNavHighlight(route.pathname);
  if (!route.pathname.startsWith('/search') && sidebarSearch && document.activeElement !== sidebarSearch) {
    sidebarSearch.value = '';
    if (sidebarSearchClear) sidebarSearchClear.hidden = true;
  }
  viewRoot.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'instant' });

  switch (route.name) {
    case 'series':
      void renderSeries(viewRoot, route);
      break;
    case 'browse':
    case 'genre': {
      const next = new URLSearchParams(route.query);
      if (route.params?.genre && !next.get('genre')) {
        next.set('genre', route.params.genre);
      }
      void renderMediaBrowse(viewRoot, { ...route, query: next });
      break;
    }
    case 'details':
      void renderDetails(viewRoot, route);
      break;
    case 'watch':
      void renderWatch(viewRoot, route);
      break;
    case 'search':
      void renderSearch(viewRoot, route);
      break;
    case 'mylist':
      void renderMyList(viewRoot, route);
      break;
    case 'tracker':
      void renderTracker(viewRoot, route);
      break;
    case 'movies':
    case 'home':
    default:
      void renderMovies(viewRoot, route);
      break;
  }
});

/* ── Bootstrap Backend & Live Library Sync ─────────────────── */

async function bootstrap() {
  syncSidebarSources();
  syncThemeIcons();
  syncLibraryBadges();
  syncNavHighlight();
  router.start();

  try {
    const engine = await api.checkEngine();
    state.health = { engine, version: api.state.version };
    const provRes = await api.providers().catch(() => null);
    const provList = Array.isArray(provRes) ? provRes : provRes?.providers;
    if (Array.isArray(provList) && provList.length) {
      state.providers = provList;
      syncSidebarSources();
    }
    library.start();
  } catch {
    /* Offline/demo state is already reflected in api.state.engine */
  }
  syncEngineBadges();
}

void bootstrap();
