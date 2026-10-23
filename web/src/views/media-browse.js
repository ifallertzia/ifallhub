// Sidify-V2 visually styled Movies & Series browse view powered by MovieBox-TUI's
// `/api/collections`, `/api/discover` (paged), `/api/search`, `/api/suggest`, `/api/meta`, and `/api/library`.

import * as api from '../lib/api.js';
import {
  escapeHtml,
  formatRating,
  isSeriesItem,
  itemId,
  itemProvider,
  itemTitle,
  itemYear,
  providerLabel,
} from '../lib/format.js';
import * as library from '../lib/library.js';
import {
  DEFAULT_GENRES,
  SORTS,
  detailPathFor,
  extractMediaFacets,
  filterAndSortMedia,
  itemBackdrop,
  itemGenres,
  mediaArt,
  officialRatingOf,
} from '../lib/media-helpers.js';
import { becauseYouWatched, continueWatching, dedupeItems } from '../lib/recommend.js';
import * as router from '../lib/router.js';
import {
  cachedMeta,
  ensureMeta,
  getCollectionsCached,
  setAmbientSeed,
  setProvider,
  state as appState,
} from '../state.js';
import {
  cardGridHtml,
  chipsHtml,
  emptyStateHtml,
  errorStateHtml,
  posterCardHtml,
  posterGridSkeletonHtml,
  sectionHeaderHtml,
  shelfHtml,
} from '../ui/components.js';
import { iconHtml } from '../ui/icons.js';

function mergeParams(basePath, current, patch) {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v === null || v === undefined) next.delete(k);
    else next.set(k, String(v));
  }
  if (next.get('sort') === 'trending') next.delete('sort');
  const qs = next.toString();
  return `${basePath}${qs ? `?${qs}` : ''}`;
}

export async function renderMediaBrowse(root, route = {}, forcedKind = '') {
  const kind = forcedKind || (route.name === 'series' ? 'series' : 'movie');
  const isSeriesView = kind === 'series';
  const basePath = isSeriesView ? '/series' : '/movies';
  const query = route.query || new URLSearchParams();
  const routeSignal = route.signal;

  const viewState = {
    provider: query.get('provider') || query.get('source') || appState.provider || 'moviebox',
    genre: query.get('genre') || '',
    year: query.get('year') || '',
    sort: query.get('sort') || 'trending',
    collections: null,
    discoverItems: [],
    discoverPage: 1,
    hasMoreDiscover: true,
    loadingMore: false,
    providerSearchItems: [],
    providerSearchPage: 1,
    hasMoreProviderSearch: false,
    suggestions: [],
    suggestOpen: false,
    loading: true,
    error: '',
  };

  setProvider(viewState.provider);

  let disposed = false;
  let suggestTimer = null;
  let suggestCounter = 0;
  let unsubLibrary = null;

  const isFiltered = () =>
    Boolean(viewState.genre || viewState.year || viewState.sort !== 'trending');

  root.innerHTML = `
    <div class="fade-up pb-16">
      <!-- Top Controls Bar -->
      <div class="flex flex-col gap-3 px-4 pt-3 pb-4 desk:px-8 desk:pt-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <!-- Movies | Series Segmented Switcher (crimson selected pill — never stark white) -->
            <div class="inline-flex rounded-full bg-fill p-1 ring-1 ring-edge" role="tablist" aria-label="Media type">
              <a
                href="/movies${viewState.provider !== 'moviebox' ? `?provider=${encodeURIComponent(viewState.provider)}` : ''}"
                data-nav
                role="tab"
                aria-selected="${!isSeriesView ? 'true' : 'false'}"
                class="inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-semibold transition-colors ${
                  !isSeriesView ? 'pill-selected' : 'text-fg-2 hover:text-fg'
                }"
              >
                ${iconHtml('film', { size: 14 })}
                <span>Movies</span>
              </a>
              <a
                href="/series${viewState.provider !== 'moviebox' ? `?provider=${encodeURIComponent(viewState.provider)}` : ''}"
                data-nav
                role="tab"
                aria-selected="${isSeriesView ? 'true' : 'false'}"
                class="inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-semibold transition-colors ${
                  isSeriesView ? 'pill-selected' : 'text-fg-2 hover:text-fg'
                }"
              >
                ${iconHtml('tv', { size: 14 })}
                <span>Series</span>
              </a>
            </div>
            ${
              viewState.provider !== 'moviebox'
                ? `<span class="hidden rounded-full bg-brand/15 px-3 py-1 text-[12px] font-semibold text-brand sm:inline-flex">${escapeHtml(providerLabel(viewState.provider))}</span>`
                : ''
            }
          </div>

          <!-- MovieBox-TUI Search Bar + Live /api/suggest -->
          <div class="relative w-full sm:w-auto sm:min-w-[270px] desk:min-w-[330px]">
            <form data-browse-search-form class="relative flex items-center" autocomplete="off">
              <span class="pointer-events-none absolute left-3.5 text-fg-3">
                ${iconHtml('search', { size: 15 })}
              </span>
              <input
                type="search"
                data-browse-search
                value=""
                placeholder="Search ${isSeriesView ? 'series' : 'movies'} on ${escapeHtml(providerLabel(viewState.provider))}…"
                aria-label="Search ${isSeriesView ? 'series' : 'movies'}"
                class="h-9 w-full rounded-full bg-fill pr-8 pl-9 text-[13.5px] text-fg placeholder:text-fg-3 focus:bg-fill-2 focus:ring-2 focus:ring-brand/45"
              />
            </form>
            <div
              data-browse-suggest
              hidden
              class="menu-glass absolute top-[calc(100%+6px)] right-0 left-0 z-30 overflow-hidden rounded-[12px] py-1.5"
            ></div>
          </div>
        </div>

        <!-- Genre Chips + Sort + Year Row -->
        <div class="flex flex-wrap items-center justify-between gap-2.5">
          <div data-genre-bar class="min-w-0 flex-1 overflow-hidden"></div>

          <div class="flex shrink-0 items-center gap-2">
            <select
              data-year-select
              aria-label="Filter by year"
              class="h-8 rounded-full bg-fill px-3 text-[13px] font-semibold text-fg hover:bg-fill-2"
            >
              <option value="">All years</option>
            </select>
            <select
              data-sort-select
              aria-label="Sort titles"
              class="h-8 rounded-full bg-fill px-3 text-[13px] font-semibold text-fg hover:bg-fill-2"
            >
              ${SORTS.map(
                (s) =>
                  `<option value="${escapeHtml(s.id)}" ${viewState.sort === s.id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`,
              ).join('')}
            </select>
            <button
              type="button"
              data-reset-filters
              ${isFiltered() ? '' : 'hidden'}
              class="h-8 rounded-full bg-fill px-3 text-[12.5px] font-semibold text-brand hover:bg-fill-2"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <!-- Content Mount -->
      <div data-browse-content>
        ${posterGridSkeletonHtml(12)}
      </div>
    </div>`;

  const searchInput = root.querySelector('[data-browse-search]');
  const suggestEl = root.querySelector('[data-browse-suggest]');
  const resetBtn = root.querySelector('[data-reset-filters]');
  const genreBar = root.querySelector('[data-genre-bar]');
  const yearSelect = root.querySelector('[data-year-select]');
  const sortSelect = root.querySelector('[data-sort-select]');
  const contentHost = root.querySelector('[data-browse-content]');

  function syncUrl() {
    const nextHref = mergeParams(basePath, new URLSearchParams(), {
      provider: viewState.provider !== 'moviebox' ? viewState.provider : '',
      genre: viewState.genre,
      year: viewState.year,
      sort: viewState.sort,
    });
    window.history.replaceState(null, '', nextHref);
    resetBtn.hidden = !isFiltered();
  }

  function metaLookup(item) {
    return cachedMeta(itemProvider(item), itemId(item));
  }

  function cardMetaFor(item) {
    const p = itemProvider(item);
    const id = itemId(item);
    const m = cachedMeta(p, id);
    return {
      metaEntry: m,
      rating: officialRatingOf(item, m),
      listed: library.isInWatchlist(p, id),
      progress: library.progressFor(p, id),
      personalRating: library.ratingFor(p, id),
    };
  }

  function filterByKind(items = []) {
    return items.filter((it) => (isSeriesView ? isSeriesItem(it) : !isSeriesItem(it)));
  }

  function allPoolItems() {
    if (viewState.provider !== 'moviebox') {
      return dedupeItems(viewState.providerSearchItems);
    }
    const cols = viewState.collections || {};
    const combined = [
      ...(cols.trending || []),
      ...(cols.top_rated || []),
      ...(cols.fresh || []),
      ...(cols.most_watched || []),
      ...viewState.discoverItems,
    ];
    return dedupeItems(combined);
  }

  function renderFacets(pool) {
    const { genres, years } = extractMediaFacets(pool, metaLookup);
    const genreOptions = [
      { id: '', label: 'All' },
      ...genres.slice(0, 14).map((g) => ({ id: g, label: g })),
    ];
    genreBar.innerHTML = chipsHtml(genreOptions, viewState.genre, { attrName: 'data-genre-chip' });

    const currentYear = viewState.year;
    yearSelect.innerHTML = [
      `<option value="">All years</option>`,
      `<option value="2020s" ${currentYear === '2020s' ? 'selected' : ''}>2020s</option>`,
      `<option value="2010s" ${currentYear === '2010s' ? 'selected' : ''}>2010s</option>`,
      `<option value="2000s" ${currentYear === '2000s' ? 'selected' : ''}>2000s</option>`,
      ...years
        .slice(0, 18)
        .map(
          (y) =>
            `<option value="${escapeHtml(y)}" ${currentYear === y ? 'selected' : ''}>${escapeHtml(y)}</option>`,
        ),
    ].join('');
  }

  function heroBannerHtml(item) {
    if (!item) return '';
    const provider = itemProvider(item);
    const id = itemId(item);
    const title = itemTitle(item);
    const year = itemYear(item);
    const series = isSeriesItem(item);
    const m = cachedMeta(provider, id);
    const rating = formatRating(officialRatingOf(item, m));
    const genres = itemGenres(item, m);
    const backdropFallback = mediaArt(title, year, series ? 'series' : 'movie', 'backdrop');
    const backdrop = itemBackdrop(item) || backdropFallback;
    const detailHref = detailPathFor(provider, id, series);
    const playHref = router.watchPath(provider, id);
    const listed = library.isInWatchlist(provider, id);
    const desc = item.description || m?.description || '';

    setAmbientSeed(`${title}:${year}`);

    return `
      <section class="px-4 pb-8 desk:px-8">
        <div
          class="group relative min-h-[340px] overflow-hidden rounded-[18px] bg-raised ring-1 ring-edge desk:min-h-[420px]"
          data-card
          data-provider="${escapeHtml(provider)}"
          data-id="${escapeHtml(id)}"
          data-title="${escapeHtml(title)}"
          data-year="${escapeHtml(year || '')}"
          data-poster="${escapeHtml(item.poster_url || item.poster || '')}"
          data-type="${series ? 'series' : 'movie'}"
          data-rating="${escapeHtml(rating || '')}"
        >
          <img
            src="${escapeHtml(backdrop)}"
            data-fallback-src="${escapeHtml(backdropFallback)}"
            alt="${escapeHtml(title)}"
            class="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.02]"
          />
          <div
            class="absolute inset-0"
            style="background: linear-gradient(90deg, rgba(8,8,12,0.92) 0%, rgba(8,8,12,0.68) 46%, rgba(8,8,12,0.18) 100%), linear-gradient(180deg, rgba(8,8,12,0.08) 0%, rgba(8,8,12,0.88) 100%);"
          ></div>

          <div class="relative z-10 flex min-h-[340px] max-w-[600px] flex-col justify-end p-6 desk:min-h-[420px] desk:p-10">
            <div class="mb-2 flex flex-wrap items-center gap-2 text-[11.5px] font-bold tracking-widest text-white/75 uppercase">
              <span class="rounded-full bg-brand/90 px-2.5 py-0.5 text-white">Featured</span>
              ${year ? `<span>${escapeHtml(String(year))}</span>` : ''}
              ${genres.length ? `<span>·</span><span>${escapeHtml(genres.slice(0, 3).join(' · '))}</span>` : ''}
              ${rating ? `<span>·</span><span class="inline-flex items-center gap-1 text-amber-300">${iconHtml('starFilled', { size: 11 })} ${escapeHtml(rating)}</span>` : ''}
            </div>

            <a href="${escapeHtml(detailHref)}" data-nav class="block">
              <h1 class="t-display desk:t-hero text-white drop-shadow-sm">${escapeHtml(title)}</h1>
            </a>

            ${
              desc
                ? `<p class="mt-2.5 line-clamp-2 text-[14.5px] leading-relaxed text-white/80">${escapeHtml(desc)}</p>`
                : ''
            }

            <div class="mt-5 flex flex-wrap items-center gap-2.5">
              <a
                href="${escapeHtml(playHref)}"
                data-nav
                class="pill-selected inline-flex h-10 items-center gap-2 rounded-full px-5 text-[14px] font-semibold transition active:scale-[0.98]"
              >
                ${iconHtml('play', { size: 15 })}
                <span>Play</span>
              </a>
              <a
                href="${escapeHtml(detailHref)}"
                data-nav
                class="pill-glass inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-white transition hover:bg-white/22"
              >
                ${iconHtml('info', { size: 15 })}
                <span>Details</span>
              </a>
              <button
                type="button"
                data-watchlist="${listed ? '1' : '0'}"
                class="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition ${
                  listed ? 'pill-selected' : 'pill-glass text-white hover:bg-white/22'
                }"
              >
                ${iconHtml(listed ? 'check' : 'bookmark', { size: 15 })}
                <span>${listed ? 'Saved' : 'Watchlist'}</span>
              </button>
            </div>
          </div>
        </div>
      </section>`;
  }

  function renderSuggestDropdown() {
    if (!viewState.suggestOpen || !viewState.suggestions.length) {
      suggestEl.hidden = true;
      suggestEl.innerHTML = '';
      return;
    }
    suggestEl.hidden = false;
    suggestEl.innerHTML = viewState.suggestions
      .slice(0, 7)
      .map(
        (s) => `
        <button
          type="button"
          data-browse-suggest-pick="${escapeHtml(String(s))}"
          class="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13.5px] text-fg transition hover:bg-fill"
        >
          <span class="text-fg-3">${iconHtml('search', { size: 13 })}</span>
          <span class="truncate">${escapeHtml(String(s))}</span>
        </button>`,
      )
      .join('');
  }

  function renderBody() {
    if (viewState.loading) {
      contentHost.innerHTML = posterGridSkeletonHtml(12);
      return;
    }
    if (viewState.error) {
      contentHost.innerHTML = errorStateHtml({
        title: `Could not load ${isSeriesView ? 'series' : 'movies'}`,
        message: viewState.error,
      });
      contentHost.querySelector('[data-retry]')?.addEventListener('click', () => void loadCatalog());
      return;
    }

    if (
      viewState.provider !== 'moviebox' &&
      !viewState.providerSearchItems.length &&
      !viewState.genre
    ) {
      renderFacets([]);
      contentHost.innerHTML = `
        <div class="px-4 desk:px-8">
          <div class="rounded-[16px] bg-raised/75 p-6 ring-1 ring-edge">
            <h2 class="t-title">Browse ${escapeHtml(providerLabel(viewState.provider))}</h2>
            <p class="mt-1 text-[14px] text-fg-2">
              ${escapeHtml(providerLabel(viewState.provider))} uses MovieBox-TUI's direct catalog search. Pick a category below or enter a title above.
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              ${DEFAULT_GENRES.slice(0, 12)
                .map(
                  (g) => `<button
                    type="button"
                    data-genre-chip="${escapeHtml(g)}"
                    class="inline-flex h-8 items-center rounded-full bg-fill px-3.5 text-[13px] font-semibold text-fg hover:bg-fill-2"
                  >${escapeHtml(g)}</button>`,
                )
                .join('')}
            </div>
          </div>
        </div>`;
      return;
    }

    const pool = filterByKind(allPoolItems());
    renderFacets(pool);

    if (isFiltered() || viewState.provider !== 'moviebox') {
      const results = filterAndSortMedia(pool, {
        kind,
        genre: viewState.genre,
        year: viewState.year,
        sort: viewState.sort,
        metaLookup,
        metrics: viewState.collections?.metrics || {},
      });

      if (!results.length) {
        contentHost.innerHTML = emptyStateHtml({
          icon: isSeriesView ? 'tv' : 'film',
          title: 'No matching titles',
          message: 'Try clearing a filter or searching across providers.',
          action: `<button type="button" data-clear-empty class="inline-flex h-10 items-center rounded-full bg-fill px-5 text-[14px] font-semibold text-fg hover:bg-fill-2">Clear filters</button>`,
        });
        contentHost.querySelector('[data-clear-empty]')?.addEventListener('click', () => {
          viewState.genre = '';
          viewState.year = '';
          viewState.sort = 'trending';
          yearSelect.value = '';
          sortSelect.value = 'trending';
          syncUrl();
          renderBody();
        });
        return;
      }

      const canMore =
        viewState.provider === 'moviebox'
          ? viewState.hasMoreDiscover
          : viewState.hasMoreProviderSearch;

      contentHost.innerHTML = `
        ${sectionHeaderHtml(`${results.length} ${results.length === 1 ? 'title' : 'titles'}`, {
          subtitle: [viewState.genre, viewState.year, providerLabel(viewState.provider)]
            .filter(Boolean)
            .join(' · '),
        })}
        ${cardGridHtml(results, cardMetaFor)}
        ${
          canMore
            ? `<div class="mt-8 flex justify-center px-4">
                 <button
                   type="button"
                   data-load-more
                   ${viewState.loadingMore ? 'disabled' : ''}
                   class="inline-flex h-10 items-center gap-2 rounded-full bg-fill px-6 text-[14px] font-semibold text-fg transition hover:bg-fill-2 disabled:opacity-50"
                 >
                   ${viewState.loadingMore ? iconHtml('loader2', { size: 15, className: 'animate-spin' }) : ''}
                   <span>${viewState.loadingMore ? 'Loading more…' : 'Load more'}</span>
                 </button>
               </div>`
            : ''
        }`;
      return;
    }

    // Default MovieBox-TUI Curated Shelves + Paged Discover Grid
    const cols = viewState.collections || {};
    const trending = filterByKind(cols.trending || []);
    const topRated = filterByKind(cols.top_rated || []);
    const fresh = filterByKind(cols.fresh || []);
    const mostWatched = filterByKind(cols.most_watched || []);
    const heroItem = trending[0] || topRated[0] || fresh[0] || pool[0] || null;

    const cw = continueWatching(library.state.progress || []).filter((entry) =>
      isSeriesView
        ? entry.media_type === 'series' || Number(entry.season) > 0
        : entry.media_type !== 'series' && !(Number(entry.season) > 0),
    );
    const byw = becauseYouWatched({
      library: library.state,
      candidates: pool,
      metaLookup,
      limit: 12,
    });

    const shelves = [];
    if (cw.length) {
      shelves.push(
        shelfHtml({
          key: 'continue',
          title: 'Continue Watching',
          subtitle: 'Pick up right where you left off',
          itemsHtml: cw
            .slice(0, 12)
            .map((entry) =>
              posterCardHtml(
                {
                  id: entry.id,
                  provider: entry.provider || 'moviebox',
                  title: entry.title,
                  year: entry.year,
                  poster_url: entry.poster_url,
                  media_type: entry.media_type,
                  imdb_rating: entry.official_rating,
                },
                {
                  listed: library.isInWatchlist(entry.provider || 'moviebox', entry.id),
                  progress: entry,
                  personalRating: library.ratingFor(entry.provider || 'moviebox', entry.id),
                },
              ),
            )
            .join(''),
        }),
      );
    }

    const pushShelf = (key, title, subtitle, list) => {
      if (!list.length) return;
      shelves.push(
        shelfHtml({
          key,
          title,
          subtitle,
          itemsHtml: list.slice(0, 18).map((it) => posterCardHtml(it, cardMetaFor(it))).join(''),
        }),
      );
    };

    pushShelf(
      'trending',
      isSeriesView ? 'Trending Series' : 'Trending Now',
      'Live from MovieBox-TUI collections',
      trending.slice(heroItem === trending[0] ? 1 : 0),
    );
    if (byw) {
      pushShelf('because', byw.heading, '', filterByKind(byw.items));
    }
    pushShelf('top-rated', 'Critically Acclaimed', 'Highest rated across the catalog', topRated);
    pushShelf('fresh', 'New & Recent Releases', 'Latest additions', fresh);
    pushShelf('popular', 'Most Watched', 'Popular streams this week', mostWatched);

    if (pool.length) {
      shelves.push(`
        <section class="pt-2">
          ${sectionHeaderHtml(isSeriesView ? 'All Series' : 'All Movies', {
            subtitle: `${pool.length} titles loaded`,
          })}
          ${cardGridHtml(pool, cardMetaFor)}
          ${
            viewState.hasMoreDiscover
              ? `<div class="mt-8 flex justify-center px-4">
                   <button
                     type="button"
                     data-load-more
                     ${viewState.loadingMore ? 'disabled' : ''}
                     class="inline-flex h-10 items-center gap-2 rounded-full bg-fill px-6 text-[14px] font-semibold text-fg transition hover:bg-fill-2 disabled:opacity-50"
                   >
                     ${viewState.loadingMore ? iconHtml('loader2', { size: 15, className: 'animate-spin' }) : ''}
                     <span>${viewState.loadingMore ? 'Loading more…' : 'Load more catalog'}</span>
                   </button>
                 </div>`
              : ''
          }
        </section>`);
    }

    if (!heroItem && !shelves.length) {
      contentHost.innerHTML = emptyStateHtml({
        icon: isSeriesView ? 'tv' : 'film',
        title: `No ${isSeriesView ? 'series' : 'movies'} found`,
        message: 'Try searching by title using MovieBox-TUI search.',
      });
      return;
    }

    contentHost.innerHTML = `
      ${heroBannerHtml(heroItem)}
      <div class="space-y-9">${shelves.join('')}</div>`;
  }

  async function loadCatalog() {
    viewState.loading = true;
    viewState.error = '';
    renderBody();

    try {
      if (viewState.provider === 'moviebox') {
        const [cols, disc1, disc2] = await Promise.all([
          getCollectionsCached().catch(() => null),
          api.discover({ provider: 'moviebox', page: 1 }, { signal: routeSignal }).catch(() => ({ items: [] })),
          api.discover({ provider: 'moviebox', page: 2 }, { signal: routeSignal }).catch(() => ({ items: [] })),
        ]);
        if (disposed || routeSignal?.aborted) return;
        viewState.collections = cols || {};
        const items1 = Array.isArray(disc1?.items) ? disc1.items : Array.isArray(disc1) ? disc1 : [];
        const items2 = Array.isArray(disc2?.items) ? disc2.items : Array.isArray(disc2) ? disc2 : [];
        viewState.discoverItems = dedupeItems([...items1, ...items2]);
        viewState.discoverPage = items2.length ? 2 : 1;
        viewState.hasMoreDiscover = (items2.length || items1.length) > 0;
        if (!cols && !viewState.discoverItems.length) {
          throw new Error('Could not reach catalog endpoints.');
        }
      } else if (viewState.genre) {
        const res = await api.search(
          { q: viewState.genre, provider: viewState.provider, page: 1 },
          { signal: routeSignal },
        );
        if (disposed || routeSignal?.aborted) return;
        const list = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
        viewState.providerSearchItems = dedupeItems(
          list.map((it) => ({ ...it, provider: itemProvider(it) || viewState.provider })),
        );
        viewState.providerSearchPage = 1;
        viewState.hasMoreProviderSearch = list.length >= 10;
      } else {
        viewState.providerSearchItems = [];
        viewState.hasMoreProviderSearch = false;
      }

      viewState.loading = false;
      renderBody();
      void ensureMeta(allPoolItems().slice(0, 48));
    } catch (err) {
      if (disposed || routeSignal?.aborted) return;
      viewState.loading = false;
      viewState.error = err?.message || 'Unable to load catalog from backend.';
      renderBody();
    }
  }

  async function loadMoreCatalog() {
    if (viewState.loadingMore) return;
    viewState.loadingMore = true;
    renderBody();

    try {
      if (viewState.provider === 'moviebox') {
        const nextPage = viewState.discoverPage + 1;
        const resp = await api.discover(
          { provider: 'moviebox', page: nextPage },
          { signal: routeSignal },
        );
        if (disposed || routeSignal?.aborted) return;
        const batch = Array.isArray(resp?.items) ? resp.items : Array.isArray(resp) ? resp : [];
        const before = viewState.discoverItems.length;
        viewState.discoverItems = dedupeItems([...viewState.discoverItems, ...batch]);
        viewState.discoverPage = nextPage;
        viewState.hasMoreDiscover = batch.length > 0 && viewState.discoverItems.length > before;
        void ensureMeta(batch);
      } else if (viewState.genre) {
        const nextPage = viewState.providerSearchPage + 1;
        const resp = await api.search(
          { q: viewState.genre, provider: viewState.provider, page: nextPage },
          { signal: routeSignal },
        );
        if (disposed || routeSignal?.aborted) return;
        const batch = Array.isArray(resp) ? resp : Array.isArray(resp?.items) ? resp.items : [];
        const stamped = batch.map((it) => ({
          ...it,
          provider: itemProvider(it) || viewState.provider,
        }));
        const before = viewState.providerSearchItems.length;
        viewState.providerSearchItems = dedupeItems([
          ...viewState.providerSearchItems,
          ...stamped,
        ]);
        viewState.providerSearchPage = nextPage;
        viewState.hasMoreProviderSearch =
          batch.length >= 10 && viewState.providerSearchItems.length > before;
        void ensureMeta(stamped);
      }
    } catch {}
    if (!disposed && !routeSignal?.aborted) {
      viewState.loadingMore = false;
      renderBody();
    }
  }

  async function fetchBrowseSuggestions(raw) {
    const trimmed = raw.trim();
    if (trimmed.length < 2 || api.state.supports.suggest === false) {
      viewState.suggestions = [];
      viewState.suggestOpen = false;
      renderSuggestDropdown();
      return;
    }
    const sId = ++suggestCounter;
    try {
      const res = await api.suggest({ q: trimmed }, { signal: routeSignal });
      if (disposed || routeSignal?.aborted || sId !== suggestCounter) return;
      api.markSupport('suggest', true);
      const list = Array.isArray(res?.suggestions) ? res.suggestions : Array.isArray(res) ? res : [];
      viewState.suggestions = list;
      viewState.suggestOpen = list.length > 0 && document.activeElement === searchInput;
      renderSuggestDropdown();
    } catch (err) {
      if (err?.status === 404 || err?.status === 501) {
        api.markSupport('suggest', false);
      }
    }
  }

  function submitToMovieBoxSearch(qText) {
    const qVal = String(qText || '').trim();
    const params = new URLSearchParams();
    if (qVal) params.set('q', qVal);
    if (viewState.provider && viewState.provider !== 'moviebox') {
      params.set('provider', viewState.provider);
    }
    params.set('type', isSeriesView ? 'series' : 'movie');
    void router.navigate(`/search?${params.toString()}`);
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => void fetchBrowseSuggestions(searchInput.value), 180);
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (disposed) return;
      viewState.suggestOpen = false;
      renderSuggestDropdown();
    }, 160);
  });

  root.querySelector('[data-browse-search-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitToMovieBoxSearch(searchInput.value);
  });

  yearSelect.addEventListener('change', () => {
    viewState.year = yearSelect.value;
    syncUrl();
    renderBody();
  });

  sortSelect.addEventListener('change', () => {
    viewState.sort = sortSelect.value;
    syncUrl();
    renderBody();
  });

  resetBtn.addEventListener('click', () => {
    viewState.genre = '';
    viewState.year = '';
    viewState.sort = 'trending';
    yearSelect.value = '';
    sortSelect.value = 'trending';
    syncUrl();
    if (viewState.provider !== 'moviebox') void loadCatalog();
    else renderBody();
  });

  root.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const sugBtn = target.closest('[data-browse-suggest-pick]');
    if (sugBtn) {
      submitToMovieBoxSearch(sugBtn.dataset.browseSuggestPick || '');
      return;
    }

    const genreBtn = target.closest('[data-genre-chip]');
    if (genreBtn) {
      viewState.genre = genreBtn.dataset.genreChip || '';
      syncUrl();
      if (viewState.provider !== 'moviebox') void loadCatalog();
      else renderBody();
      return;
    }

    if (target.closest('[data-load-more]')) {
      void loadMoreCatalog();
    }
  });

  const onSync = () => {
    if (!disposed && !viewState.loading) renderBody();
  };
  unsubLibrary = library.subscribe(onSync);
  window.addEventListener('ifallhub:meta', onSync, { signal: routeSignal });

  await loadCatalog();

  routeSignal?.addEventListener(
    'abort',
    () => {
      disposed = true;
      clearTimeout(suggestTimer);
      if (unsubLibrary) unsubLibrary();
    },
    { once: true },
  );
}

export function renderMovies(root, route) {
  return renderMediaBrowse(root, route, 'movie');
}

export function renderSeries(root, route) {
  return renderMediaBrowse(root, route, 'series');
}
