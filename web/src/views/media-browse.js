// Sidify-V2 `MediaBrowsePage` (`Movies` & `Series` views) wired to Ifallhub's
// `/api/collections`, `/api/discover`, `/api/search`, `/api/meta`, and `/api/library`.

import * as api from '../lib/api.js';
import {
  displayUiText,
  escapeHtml,
  formatRating,
  formatRuntime,
  isKnownProvider,
  isSeriesItem,
  itemId,
  itemPoster,
  itemProvider,
  itemTitle,
  itemYear,
  providerLabel,
  seasonCount,
} from '../lib/format.js';
import * as library from '../lib/library.js';
import {
  SORTS,
  detailPathFor,
  extractMediaFacets,
  filterAndSortMedia,
  itemBackdrop,
  itemGenres,
  mediaArt,
} from '../lib/media-helpers.js';
import {
  becauseYouWatched,
  continueWatching,
  dedupeItems,
  heroCandidates,
} from '../lib/recommend.js';
import {
  cachedMeta,
  ensureMeta,
  setAmbientSeed,
  setProvider,
  state,
} from '../state.js';
import {
  cardGridHtml,
  chipsHtml,
  emptyStateHtml,
  errorStateHtml,
  pageTitleHtml,
  posterCardHtml,
  posterGridSkeletonHtml,
  sectionHeaderHtml,
  shelfHtml,
} from '../ui/components.js';
import { iconHtml } from '../ui/icons.js';
import { openEngineSheet } from '../ui/sheets.js';

const DEMO_DISMISSED_KEY = 'ifallhub_demo_notice_dismissed';

function isDemoDismissed() {
  try {
    return sessionStorage.getItem(DEMO_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function buildSegmentedToggle(kind) {
  const options = [
    { id: 'movie', label: 'Movies', href: '/movies' },
    { id: 'series', label: 'Series', href: '/series' },
  ];
  return `
    <div class="inline-flex rounded-full bg-fill p-1">
      ${options
        .map((opt) => {
          const active = opt.id === kind;
          return `<a
            href="${opt.href}"
            data-nav
            aria-current="${active ? 'page' : 'false'}"
            class="rounded-full px-4 py-1 text-[13px] font-semibold transition-colors ${
              active ? 'bg-primary text-on-primary' : 'text-fg-2 hover:bg-fill-2 hover:text-fg'
            }"
          >${opt.label}</a>`;
        })
        .join('')}
    </div>`;
}

function mediaHeroHtml(hero, kind) {
  if (!hero) return '';
  const provider = itemProvider(hero);
  const id = itemId(hero);
  const title = itemTitle(hero);
  const year = itemYear(hero);
  const metaEntry = cachedMeta(provider, id);
  const series = kind === 'series' || isSeriesItem(hero);
  const fallback = mediaArt(title, year, series ? 'series' : 'movie', 'backdrop');
  const backdrop = itemBackdrop(hero) || fallback;
  const rating = formatRating(hero.imdb_rating ?? metaEntry?.imdb_rating);
  const runtime = formatRuntime(hero.duration || metaEntry?.duration);
  const seasons = seasonCount(hero);
  const genres = itemGenres(hero, metaEntry).slice(0, 3).join(', ');
  const listed = library.isInWatchlist(provider, id);
  const href = detailPathFor(provider, id, series);

  const metaBits = [
    year,
    series && seasons ? `${seasons} ${seasons === 1 ? 'season' : 'seasons'}` : runtime,
    genres,
  ].filter(Boolean);

  return `
    <section
      class="relative -mt-2 mb-6 overflow-hidden desk:mx-8 desk:mt-0 desk:mb-8 desk:rounded-[20px] desk:ring-1 desk:ring-edge"
      data-card
      data-provider="${escapeHtml(provider)}"
      data-id="${escapeHtml(id)}"
      data-title="${escapeHtml(title)}"
      data-year="${escapeHtml(year || '')}"
      data-poster="${escapeHtml(itemPoster(hero) || '')}"
      data-type="${series ? 'series' : 'movie'}"
      data-rating="${escapeHtml(rating || '')}"
    >
      <div class="relative min-h-[420px] w-full bg-raised desk:min-h-[470px]">
        <img
          src="${escapeHtml(backdrop)}"
          data-fallback-src="${escapeHtml(fallback)}"
          alt=""
          aria-hidden="true"
          class="absolute inset-0 h-full w-full object-cover"
        />
        <div
          aria-hidden="true"
          class="absolute inset-0"
          style="background: linear-gradient(90deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.52) 44%, rgba(0,0,0,0.18) 74%, rgba(0,0,0,0.06) 100%), linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.24) 42%, rgba(0,0,0,0.78) 78%, var(--bg) 100%)"
        ></div>

        <div class="relative flex min-h-[420px] flex-col justify-end p-5 text-white desk:min-h-[470px] desk:max-w-[650px] desk:p-10">
          <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold tracking-[0.9px] text-white/80 uppercase">
            <span class="rounded-full bg-white/15 px-2.5 py-1 backdrop-blur-md">
              ${series ? 'Featured series' : 'Featured film'}
            </span>
            ${
              rating
                ? `<span class="inline-flex items-center gap-1 text-white/95">
                     ${iconHtml('starFilled', { size: 12 })}
                     ${escapeHtml(rating)}
                   </span>`
                : ''
            }
            <span class="text-white/60">· ${escapeHtml(providerLabel(provider))}</span>
          </div>

          <h2 class="mt-3 text-[32px] leading-[1.05] font-extrabold tracking-[-0.8px] text-white desk:text-[46px] desk:tracking-[-1.2px]">
            ${escapeHtml(title)}
          </h2>

          ${
            metaBits.length
              ? `<div class="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] font-medium text-white/75">
                   ${escapeHtml(metaBits.join(' · '))}
                 </div>`
              : ''
          }

          ${
            hero.description
              ? `<p class="mt-3 line-clamp-2 max-w-[600px] text-[14px] leading-relaxed text-white/80 desk:line-clamp-3 desk:text-[15px]">
                   ${escapeHtml(hero.description)}
                 </p>`
              : ''
          }

          <div class="mt-5 flex flex-wrap items-center gap-2.5">
            <a
              href="${escapeHtml(href)}"
              data-nav
              class="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black shadow-lg transition active:scale-[0.98]"
            >
              ${iconHtml('info', { size: 17 })}
              <span>More info</span>
            </a>

            <button
              type="button"
              data-try-play
              class="inline-flex h-11 items-center gap-2 rounded-full bg-white/16 px-5 text-[15px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-xl transition hover:bg-white/24 active:scale-[0.98]"
            >
              ${iconHtml('play', { size: 15 })}
              <span>Watch now</span>
            </button>

            <button
              type="button"
              data-watchlist="${listed ? '1' : '0'}"
              aria-label="${listed ? 'Remove from Watchlist' : 'Add to Watchlist'}"
              aria-pressed="${listed ? 'true' : 'false'}"
              class="grid h-11 w-11 place-items-center rounded-full backdrop-blur-xl transition active:scale-95 ${
                listed ? 'bg-white text-black' : 'bg-white/15 text-white ring-1 ring-white/20 hover:bg-white/25'
              }"
            >
              ${iconHtml(listed ? 'check' : 'bookmark', { size: 18 })}
            </button>
          </div>
        </div>
      </div>
    </section>`;
}

export async function renderMediaBrowse(container, ctx = {}, forcedKind = '') {
  const urlKind = ctx.query?.get('type');
  const kind =
    forcedKind ||
    (urlKind === 'series' ? 'series' : urlKind === 'movie' ? 'movie' : 'movie');

  const initialProvider =
    ctx.query?.get('provider') && isKnownProvider(ctx.query.get('provider'))
      ? ctx.query.get('provider')
      : state.provider;
  if (initialProvider !== state.provider) setProvider(initialProvider);

  const filterState = {
    provider: initialProvider,
    q: (ctx.query?.get('q') || '').trim(),
    genre: ctx.query?.get('genre') || '',
    year: ctx.query?.get('year') || '',
    sort: ctx.query?.get('sort') || 'trending',
    page: 1,
    hasMore: true,
    loadingMore: false,
  };

  let rawCatalog = [];
  let collectionRows = [];
  let metrics = {};
  let remoteSearchItems = null;
  let searchTimer = 0;

  container.innerHTML = `
    <div class="fade-up pb-12">
      ${pageTitleHtml(kind === 'series' ? 'Series' : 'Movies', {
        trailingHtml: buildSegmentedToggle(kind),
      })}
      <div data-demo-slot></div>
      <div data-hero-slot>
        <div class="px-4 pb-6 desk:px-8">
          <div class="skeleton h-[380px] w-full rounded-[20px] desk:h-[440px]"></div>
        </div>
      </div>
      <div data-filter-slot class="mb-6 space-y-3 px-4 desk:px-8"></div>
      <div data-shelves-slot class="space-y-9"></div>
      <div data-grid-slot class="mt-9">${posterGridSkeletonHtml(12)}</div>
    </div>`;

  const demoSlot = container.querySelector('[data-demo-slot]');
  const heroSlot = container.querySelector('[data-hero-slot]');
  const filterSlot = container.querySelector('[data-filter-slot]');
  const shelvesSlot = container.querySelector('[data-shelves-slot]');
  const gridSlot = container.querySelector('[data-grid-slot]');

  function metaLookup(item) {
    return cachedMeta(itemProvider(item), itemId(item));
  }

  function cardMetaFor(item) {
    const p = itemProvider(item);
    const id = itemId(item);
    const m = cachedMeta(p, id);
    const ratingEntry = library.ratingFor(p, id);
    return {
      metaEntry: m,
      rating: item?.imdb_rating ?? m?.imdb_rating,
      listed: library.isInWatchlist(p, id),
      progress: library.progressFor(p, id),
      personalRating: ratingEntry,
    };
  }

  function renderDemoBanner() {
    if (!demoSlot) return;
    if ((api.state.engine !== 'demo' && api.state.engine !== 'offline') || isDemoDismissed()) {
      demoSlot.innerHTML = '';
      return;
    }
    demoSlot.innerHTML = `
      <div class="mx-4 mb-5 flex items-start gap-3 rounded-[12px] bg-raised/80 px-3.5 py-3 text-[13px] text-fg-2 ring-1 ring-edge desk:mx-8">
        ${iconHtml('info', { size: 16, className: 'mt-0.5 text-fg-2' })}
        <p class="min-w-0 flex-1 leading-relaxed">
          Showing built-in preview titles. Connect the live Rust backend (<code class="text-fg">cargo run -- --web-api</code>) to stream the full multi-source catalog.
          <button type="button" data-open-engine class="ml-1 font-semibold text-playing hover:opacity-80">Settings</button>
        </p>
        <button
          type="button"
          data-dismiss-demo
          aria-label="Dismiss notice"
          class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg"
        >
          ${iconHtml('x', { size: 14 })}
        </button>
      </div>`;
  }

  function renderFilterBar() {
    if (!filterSlot) return;
    const pool = remoteSearchItems ?? rawCatalog;
    const facets = extractMediaFacets(
      pool.filter((it) => (kind === 'series' ? isSeriesItem(it) : !isSeriesItem(it))),
      metaLookup,
    );
    const dirty = Boolean(
      filterState.q ||
        filterState.genre ||
        filterState.year ||
        filterState.sort !== 'trending' ||
        filterState.provider !== 'moviebox',
    );

    const activeInput = filterSlot.querySelector('[data-browse-search]');
    const hadFocus = activeInput && document.activeElement === activeInput;
    const selStart = activeInput?.selectionStart ?? null;

    filterSlot.innerHTML = `
      <div class="flex flex-wrap items-center gap-2.5">
        <div class="relative min-w-[220px] flex-1">
          <span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-2">
            ${iconHtml('search', { size: 16 })}
          </span>
          <input
            type="search"
            data-browse-search
            value="${escapeHtml(filterState.q)}"
            placeholder="${kind === 'series' ? 'Search series, genres, cast…' : 'Search movies, genres, directors…'}"
            aria-label="Search ${kind === 'series' ? 'series' : 'movies'}"
            autocomplete="off"
            spellcheck="false"
            class="field h-10 w-full rounded-[10px] pr-9 pl-9 text-[14.5px]"
          />
          ${
            filterState.q
              ? `<button type="button" data-clear-search aria-label="Clear search" class="absolute top-1/2 right-2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-fill-3 text-fg-2 hover:text-fg">
                   ${iconHtml('x', { size: 13 })}
                 </button>`
              : ''
          }
        </div>

        <select aria-label="Catalog source" data-filter-provider class="field h-10 rounded-[10px] px-3 text-[13.5px] font-medium">
          ${state.providers
            .map(
              (p) =>
                `<option value="${escapeHtml(p.id)}" ${p.id === filterState.provider ? 'selected' : ''}>Source: ${escapeHtml(providerLabel(p.id))}</option>`,
            )
            .join('')}
        </select>

        <select aria-label="Release year" data-filter-year class="field h-10 rounded-[10px] px-3 text-[13.5px] font-medium">
          <option value="">Any year</option>
          <option value="2020s" ${filterState.year === '2020s' ? 'selected' : ''}>2020s</option>
          <option value="2010s" ${filterState.year === '2010s' ? 'selected' : ''}>2010s</option>
          <option value="2000s" ${filterState.year === '2000s' ? 'selected' : ''}>2000s</option>
          ${facets.years
            .map(
              (y) =>
                `<option value="${escapeHtml(y)}" ${String(filterState.year) === String(y) ? 'selected' : ''}>${escapeHtml(y)}</option>`,
            )
            .join('')}
        </select>

        <select aria-label="Sort by" data-filter-sort class="field h-10 rounded-[10px] px-3 text-[13.5px] font-medium">
          ${SORTS.map(
            (s) =>
              `<option value="${escapeHtml(s.id)}" ${filterState.sort === s.id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`,
          ).join('')}
        </select>

        ${
          dirty
            ? `<button type="button" data-clear-filters class="h-10 rounded-[10px] px-3 text-[13.5px] font-semibold text-playing hover:bg-fill">
                 Clear filters
               </button>`
            : ''
        }
      </div>

      ${chipsHtml(
        [{ id: '', label: 'All genres' }, ...facets.genres.map((g) => ({ id: g, label: g }))],
        filterState.genre,
        { attrName: 'data-filter-genre' },
      )}`;

    if (hadFocus) {
      const nextInput = filterSlot.querySelector('[data-browse-search]');
      if (nextInput) {
        nextInput.focus();
        if (selStart != null) {
          try { nextInput.setSelectionRange(selStart, selStart); } catch { /* ignore */ }
        }
      }
    }
  }

  function syncUrlQuietly() {
    const base = kind === 'series' ? '/series' : '/movies';
    const params = new URLSearchParams();
    if (filterState.q) params.set('q', filterState.q);
    if (filterState.genre) params.set('genre', filterState.genre);
    if (filterState.year) params.set('year', filterState.year);
    if (filterState.sort && filterState.sort !== 'trending') params.set('sort', filterState.sort);
    if (filterState.provider && filterState.provider !== 'moviebox') params.set('provider', filterState.provider);
    const qs = params.toString();
    window.history.replaceState({}, '', qs ? `${base}?${qs}` : base);
  }

  function renderContent() {
    if (ctx.signal?.aborted) return;
    renderDemoBanner();
    renderFilterBar();

    const filtered = Boolean(
      filterState.q ||
        filterState.genre ||
        filterState.year ||
        filterState.sort !== 'trending' ||
        filterState.provider !== 'moviebox',
    );

    const activePool = remoteSearchItems ?? rawCatalog;
    const kindPool = activePool.filter((it) =>
      kind === 'series' ? isSeriesItem(it) : !isSeriesItem(it),
    );
    // If a non-MovieBox provider doesn't tag media_type strictly on every search card, fall back gracefully.
    const effectivePool = kindPool.length || filterState.provider === 'moviebox' ? kindPool : activePool;

    // 1. Hero
    if (!filtered && effectivePool.length) {
      const candidates = heroCandidates(effectivePool, metrics, { limit: 4 });
      const hero = candidates[0] || effectivePool[0];
      setAmbientSeed(itemTitle(hero));
      heroSlot.innerHTML = mediaHeroHtml(hero, kind);
    } else {
      heroSlot.innerHTML = '';
    }

    // 2. Shelves (when unfiltered)
    if (!filtered) {
      const shelves = [];

      // Continue watching shelf
      const cw = continueWatching(library.state.progress, { limit: 12 }).filter((entry) =>
        kind === 'series'
          ? entry.media_type === 'series' || Number(entry.season) > 0
          : entry.media_type !== 'series' && !(Number(entry.season) > 0),
      );
      if (cw.length) {
        shelves.push(
          shelfHtml({
            key: 'continue',
            title: 'Continue watching',
            subtitle: 'Pick up right where you left off',
            actionHtml: `<a href="/tracker" data-nav class="text-[13.5px] font-semibold text-playing hover:opacity-80">History</a>`,
            itemsHtml: cw
              .map((entry) =>
                posterCardHtml(
                  {
                    id: { provider: entry.provider, value: entry.id },
                    title: entry.title,
                    year: entry.year,
                    poster_url: entry.poster_url,
                    media_type: entry.media_type || kind,
                  },
                  {
                    progress: entry,
                    listed: library.isInWatchlist(entry.provider, entry.id),
                    personalRating: library.ratingFor(entry.provider, entry.id),
                  },
                ),
              )
              .join(''),
          }),
        );
      }

      // Backend collection shelves filtered by movie/series
      const rowMeta = {
        trending: {
          title: 'Trending now',
          subtitle: kind === 'series' ? 'Series everyone is watching' : 'What everyone is watching',
        },
        fresh: {
          title: kind === 'series' ? 'New seasons' : 'New releases',
          subtitle: 'Recent arrivals worth your evening',
        },
        top_rated: {
          title: 'Critically acclaimed',
          subtitle: kind === 'series' ? 'Highest rated series' : 'Highest rated films',
        },
        most_watched: {
          title: kind === 'series' ? 'Popular series' : 'Popular films',
          subtitle: 'Most watched right now',
        },
      };

      for (const row of collectionRows) {
        const items = (row.items || []).filter((it) =>
          kind === 'series' ? isSeriesItem(it) : !isSeriesItem(it),
        );
        if (items.length < 2) continue;
        const copy = rowMeta[row.key] || { title: row.label, subtitle: row.hint || '' };
        shelves.push(
          shelfHtml({
            key: row.key,
            title: copy.title,
            subtitle: copy.subtitle,
            itemsHtml: items.slice(0, 18).map((it) => posterCardHtml(it, cardMetaFor(it))).join(''),
          }),
        );
      }

      // Personalized "Because you watched" shelf
      const personal = becauseYouWatched(
        effectivePool,
        {
          ratings: library.ratedWithGenres(state.meta),
          watchlist: library.state.watchlist.map((w) => ({
            ...w,
            genres: cachedMeta(w.provider, w.id)?.genres || [],
          })),
          limit: 14,
        },
      );
      if (personal.length >= 2) {
        shelves.push(
          shelfHtml({
            key: 'for-you',
            title: 'Because you watched',
            subtitle: personal[0]?.reasons?.[0] || 'Picked from your watchlist and ratings',
            itemsHtml: personal.map((p) => posterCardHtml(p.item, cardMetaFor(p.item))).join(''),
          }),
        );
      }

      shelvesSlot.innerHTML = shelves.join('');
    } else {
      shelvesSlot.innerHTML = '';
    }

    // 3. Main All Movies / All Series Grid
    const visibleItems = filterAndSortMedia(effectivePool, {
      kind: filterState.provider === 'moviebox' ? kind : '',
      q: remoteSearchItems ? '' : filterState.q,
      genre: filterState.genre,
      year: filterState.year,
      sort: filterState.sort,
      metaLookup,
      metrics,
    });

    const noun = kind === 'series' ? 'series' : visibleItems.length === 1 ? 'movie' : 'movies';
    const gridTitle = filtered
      ? filterState.q
        ? `Results for “${filterState.q}”`
        : 'Filtered results'
      : kind === 'series'
        ? 'All series'
        : 'All movies';

    if (!visibleItems.length) {
      gridSlot.innerHTML = emptyStateHtml({
        icon: kind === 'series' ? 'tv' : 'clapperboard',
        title: `No ${kind === 'series' ? 'series' : 'movies'} match`,
        message: 'Try clearing a filter, switching catalog source, or searching with fewer words.',
        action: filtered
          ? `<button type="button" data-clear-filters class="inline-flex h-10 items-center rounded-full bg-fill px-5 text-[14px] font-semibold text-fg hover:bg-fill-2">Reset filters</button>`
          : '',
      });
    } else {
      gridSlot.innerHTML = `
        ${sectionHeaderHtml(gridTitle, { subtitle: `${visibleItems.length} ${noun}` })}
        ${cardGridHtml(visibleItems, cardMetaFor)}
        ${
          filterState.hasMore
            ? `<div class="mt-8 flex justify-center px-4">
                 <button
                   type="button"
                   data-load-more
                   ${filterState.loadingMore ? 'disabled' : ''}
                   class="inline-flex h-10 items-center gap-2 rounded-full bg-fill px-6 text-[14px] font-semibold text-fg transition hover:bg-fill-2 disabled:opacity-50"
                 >
                   ${filterState.loadingMore ? iconHtml('loader2', { size: 15, className: 'animate-spin' }) : ''}
                   <span>${filterState.loadingMore ? 'Loading…' : 'Load more'}</span>
                 </button>
               </div>`
            : ''
        }`;
    }
  }

  async function loadCatalog() {
    filterState.page = 1;
    filterState.hasMore = true;
    remoteSearchItems = null;

    try {
      if (filterState.q) {
        const found = await api.search(
          { q: filterState.q, provider: filterState.provider, page: 1 },
          { signal: ctx.signal },
        );
        remoteSearchItems = dedupeItems(Array.isArray(found) ? found : []);
        filterState.hasMore = remoteSearchItems.length >= 12;
        void ensureMeta(remoteSearchItems.slice(0, 24));
      } else if (filterState.provider === 'moviebox') {
        const useCached =
          state.collections && Date.now() - state.collectionsFetchedAt < 180_000;
        const [colRes, discRes] = await Promise.all([
          useCached
            ? Promise.resolve(state.collections)
            : api.collections({ limit: 24, pages: 3 }, { signal: ctx.signal }).catch(() => null),
          api.discover({ provider: 'moviebox', page: 1 }, { signal: ctx.signal }),
        ]);
        if (colRes) {
          state.collections = colRes;
          state.collectionsFetchedAt = Date.now();
          collectionRows = colRes.rows || [];
          metrics = { ...(colRes.metrics || {}) };
        }
        metrics = { ...metrics, ...(discRes?.metrics || {}) };
        const combined = [
          ...(discRes?.items || []),
          ...collectionRows.flatMap((r) => r.items || []),
        ];
        rawCatalog = dedupeItems(combined);
        filterState.hasMore = (discRes?.items || []).length >= 10;
        void ensureMeta(rawCatalog.slice(0, 30));
      } else {
        const seedTerm = kind === 'series' ? 'Season' : '2024';
        const found = await api.search(
          { q: seedTerm, provider: filterState.provider, page: 1 },
          { signal: ctx.signal },
        );
        rawCatalog = dedupeItems(Array.isArray(found) ? found : []);
        collectionRows = [];
        filterState.hasMore = rawCatalog.length >= 10;
        void ensureMeta(rawCatalog.slice(0, 24));
      }

      if (!ctx.signal?.aborted) renderContent();
    } catch (err) {
      if (ctx.signal?.aborted) return;
      heroSlot.innerHTML = '';
      shelvesSlot.innerHTML = '';
      renderDemoBanner();
      renderFilterBar();
      gridSlot.innerHTML = errorStateHtml({
        title: `Couldn’t load ${providerLabel(filterState.provider)}`,
        message: displayUiText(err.message),
      });
    }
  }

  async function loadMorePage() {
    if (filterState.loadingMore || !filterState.hasMore) return;
    filterState.loadingMore = true;
    renderContent();
    const nextPage = filterState.page + 1;
    try {
      let more = [];
      if (filterState.q) {
        more = await api.search(
          { q: filterState.q, provider: filterState.provider, page: nextPage },
          { signal: ctx.signal },
        );
        remoteSearchItems = dedupeItems([...(remoteSearchItems || []), ...(more || [])]);
      } else if (filterState.provider === 'moviebox') {
        const res = await api.discover({ provider: 'moviebox', page: nextPage }, { signal: ctx.signal });
        more = res?.items || [];
        metrics = { ...metrics, ...(res?.metrics || {}) };
        rawCatalog = dedupeItems([...rawCatalog, ...more]);
      } else {
        const seedTerm = kind === 'series' ? 'Season' : '2024';
        more = await api.search(
          { q: seedTerm, provider: filterState.provider, page: nextPage },
          { signal: ctx.signal },
        );
        rawCatalog = dedupeItems([...rawCatalog, ...(more || [])]);
      }
      filterState.page = nextPage;
      filterState.hasMore = Array.isArray(more) && more.length >= 8;
      if (more?.length) void ensureMeta(more.slice(0, 24));
    } catch {
      filterState.hasMore = false;
    } finally {
      filterState.loadingMore = false;
      if (!ctx.signal?.aborted) renderContent();
    }
  }

  // Interactive handlers scoped to container
  container.addEventListener('input', (event) => {
    const input = event.target.closest?.('[data-browse-search]');
    if (!input) return;
    filterState.q = input.value;
    syncUrlQuietly();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (!filterState.q.trim()) {
        remoteSearchItems = null;
        if (rawCatalog.length) renderContent();
        else void loadCatalog();
      } else {
        void loadCatalog();
      }
    }, 320);
  });

  container.addEventListener('change', (event) => {
    const target = event.target;
    if (target.matches('[data-filter-provider]')) {
      filterState.provider = target.value;
      setProvider(target.value);
      syncUrlQuietly();
      void loadCatalog();
    } else if (target.matches('[data-filter-year]')) {
      filterState.year = target.value;
      syncUrlQuietly();
      renderContent();
    } else if (target.matches('[data-filter-sort]')) {
      filterState.sort = target.value;
      syncUrlQuietly();
      renderContent();
    }
  });

  container.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('[data-dismiss-demo]')) {
      try { sessionStorage.setItem(DEMO_DISMISSED_KEY, '1'); } catch { /* ignore */ }
      renderDemoBanner();
      return;
    }

    if (target.closest('[data-open-engine]')) {
      openEngineSheet();
      return;
    }

    if (target.closest('[data-clear-search]')) {
      filterState.q = '';
      remoteSearchItems = null;
      syncUrlQuietly();
      if (rawCatalog.length) renderContent();
      else void loadCatalog();
      return;
    }

    if (target.closest('[data-clear-filters]')) {
      filterState.q = '';
      filterState.genre = '';
      filterState.year = '';
      filterState.sort = 'trending';
      filterState.provider = 'moviebox';
      setProvider('moviebox');
      remoteSearchItems = null;
      syncUrlQuietly();
      void loadCatalog();
      return;
    }

    const genreBtn = target.closest('[data-filter-genre]');
    if (genreBtn) {
      filterState.genre = genreBtn.dataset.filterGenre || '';
      syncUrlQuietly();
      renderContent();
      return;
    }

    if (target.closest('[data-load-more]')) {
      void loadMorePage();
      return;
    }

    if (target.closest('[data-retry]')) {
      void loadCatalog();
    }
  });

  const onMetaOrLibrary = () => {
    if (!ctx.signal?.aborted) renderContent();
  };
  const unsubLib = library.subscribe(onMetaOrLibrary);
  window.addEventListener('ifallhub:meta', onMetaOrLibrary);
  ctx.signal?.addEventListener('abort', () => {
    clearTimeout(searchTimer);
    unsubLib();
    window.removeEventListener('ifallhub:meta', onMetaOrLibrary);
  });

  await loadCatalog();
}

export async function renderMovies(container, ctx) {
  return renderMediaBrowse(container, ctx, 'movie');
}

export async function renderSeries(container, ctx) {
  return renderMediaBrowse(container, ctx, 'series');
}
