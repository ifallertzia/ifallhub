// Sidify-V2 visually styled Search page powered 100% by MovieBox-TUI's `/api/search`, `/api/suggest`, and `/api/meta`.

import * as api from '../lib/api.js';
import {
  escapeHtml,
  isSeriesItem,
  itemId,
  itemProvider,
  providerLabel,
} from '../lib/format.js';
import * as library from '../lib/library.js';
import { DEFAULT_GENRES, officialRatingOf } from '../lib/media-helpers.js';
import { dedupeItems, sortItems } from '../lib/recommend.js';
import {
  cachedMeta,
  ensureMeta,
  setAmbientSeed,
  setProvider,
  state as appState,
} from '../state.js';
import {
  cardGridHtml,
  chipsHtml,
  emptyStateHtml,
  errorStateHtml,
  pageTitleHtml,
  posterGridSkeletonHtml,
} from '../ui/components.js';
import { iconHtml } from '../ui/icons.js';

const CATEGORY_GRADIENTS = [
  ['#be123c', '#4c0519'],
  ['#1d4ed8', '#172554'],
  ['#7e22ce', '#2e1065'],
  ['#047857', '#022c22'],
  ['#b45309', '#451a03'],
  ['#0f766e', '#042f2e'],
  ['#4338ca', '#1e1b4b'],
  ['#9d174d', '#500724'],
];

const SEARCH_SORTS = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'rating', label: 'Top rated' },
  { id: 'year', label: 'Newest' },
  { id: 'title', label: 'A–Z' },
];

export async function renderSearch(root, route = {}) {
  const initialQ = (route.query?.get('q') || '').trim();
  const initialProvider = route.query?.get('provider') || appState.provider || 'moviebox';
  const initialType = route.query?.get('type') || 'all';
  const initialSort = route.query?.get('sort') || 'relevance';
  const routeSignal = route.signal;

  const viewState = {
    q: initialQ,
    provider: initialProvider,
    type: initialType,
    sort: initialSort,
    page: 1,
    hasMore: false,
    loadingMore: false,
    results: [],
    suggestions: [],
    suggestOpen: false,
    loading: false,
    error: '',
  };

  let disposed = false;
  let searchTimer = null;
  let suggestTimer = null;
  let runCounter = 0;
  let suggestCounter = 0;
  let unsubLibrary = null;

  setAmbientSeed('SearchCatalog');

  const providerOptions = () => {
    const list = appState.providers.length
      ? appState.providers
      : [
          { id: 'moviebox' },
          { id: 'fourkhdhub' },
          { id: 'dramachi' },
          { id: 'bdix_circleftp' },
          { id: 'bdix_dhakaflix' },
          { id: 'addons' },
        ];
    return list.map((p) => ({
      id: p.id,
      label: providerLabel(p.id),
    }));
  };

  root.innerHTML = `
    <div class="fade-up pb-16">
      ${pageTitleHtml('Search', { subtitle: 'Search MovieBox-TUI providers with live suggestions and server-side pagination.' })}

      <div class="px-4 desk:px-8">
        <div class="relative max-w-[680px]">
          <form data-search-page-form class="relative flex items-center" autocomplete="off">
            <span class="pointer-events-none absolute left-4 text-fg-3">${iconHtml('search', { size: 18 })}</span>
            <input
              type="search"
              data-search-input
              value="${escapeHtml(viewState.q)}"
              placeholder="Movies, TV series, directors, cast…"
              aria-label="Search catalog"
              class="h-12 w-full rounded-[12px] bg-fill pr-11 pl-11 text-[16px] text-fg placeholder:text-fg-3 focus:bg-fill-2 focus:ring-2 focus:ring-brand/45"
            />
            <button
              type="button"
              data-search-clear
              ${viewState.q ? '' : 'hidden'}
              aria-label="Clear search"
              class="absolute right-3 grid h-7 w-7 place-items-center rounded-full text-fg-3 hover:bg-fill-2 hover:text-fg"
            >
              ${iconHtml('x', { size: 16 })}
            </button>
          </form>

          <!-- MovieBox-TUI /api/suggest live suggestions -->
          <div
            data-suggest-menu
            hidden
            class="menu-glass absolute top-[calc(100%+6px)] right-0 left-0 z-30 overflow-hidden rounded-[12px] py-1.5"
          ></div>
        </div>

        <!-- Provider Selector Pills -->
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <span class="mr-1 text-[12px] font-semibold tracking-wider text-fg-3 uppercase">Source</span>
          <div data-provider-chips class="min-w-0 flex-1"></div>
        </div>

        <!-- Type + Sort Controls -->
        <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div data-kind-tabs></div>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center gap-2 text-[13px] text-fg-2">
              <span>Sort</span>
              <select
                data-sort-select
                class="h-8 rounded-full bg-fill px-3 text-[13px] font-semibold text-fg ring-1 ring-edge"
              >
                ${SEARCH_SORTS.map(
                  (s) =>
                    `<option value="${escapeHtml(s.id)}" ${viewState.sort === s.id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`,
                ).join('')}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div data-search-body class="mt-6"></div>
    </div>`;

  const input = root.querySelector('[data-search-input]');
  const clearBtn = root.querySelector('[data-search-clear]');
  const suggestMenu = root.querySelector('[data-suggest-menu]');
  const providerChipsHost = root.querySelector('[data-provider-chips]');
  const kindTabsHost = root.querySelector('[data-kind-tabs]');
  const sortSelect = root.querySelector('[data-sort-select]');
  const body = root.querySelector('[data-search-body]');

  function syncUrl() {
    const params = new URLSearchParams();
    if (viewState.q) params.set('q', viewState.q);
    if (viewState.provider && viewState.provider !== 'moviebox') {
      params.set('provider', viewState.provider);
    }
    if (viewState.type && viewState.type !== 'all') params.set('type', viewState.type);
    if (viewState.sort && viewState.sort !== 'relevance') params.set('sort', viewState.sort);
    const qs = params.toString();
    window.history.replaceState(null, '', `/search${qs ? `?${qs}` : ''}`);
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

  function renderFilterBars() {
    providerChipsHost.innerHTML = chipsHtml(providerOptions(), viewState.provider, {
      attrName: 'data-search-provider',
    });

    const moviesCount = viewState.results.filter((it) => !isSeriesItem(it)).length;
    const seriesCount = viewState.results.filter((it) => isSeriesItem(it)).length;
    kindTabsHost.innerHTML = chipsHtml(
      [
        { id: 'all', label: viewState.q ? `All (${viewState.results.length})` : 'All' },
        { id: 'movie', label: viewState.q ? `Movies (${moviesCount})` : 'Movies' },
        { id: 'series', label: viewState.q ? `Series (${seriesCount})` : 'Series' },
      ],
      viewState.type,
      { attrName: 'data-search-type' },
    );
  }

  function renderSuggestMenu() {
    if (!viewState.suggestOpen || !viewState.suggestions.length) {
      suggestMenu.hidden = true;
      suggestMenu.innerHTML = '';
      return;
    }
    suggestMenu.hidden = false;
    suggestMenu.innerHTML = viewState.suggestions
      .slice(0, 8)
      .map(
        (s) => `
        <button
          type="button"
          data-suggest-pick="${escapeHtml(String(s))}"
          class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[14px] text-fg transition-colors hover:bg-fill"
        >
          <span class="text-fg-3">${iconHtml('search', { size: 14 })}</span>
          <span class="truncate">${escapeHtml(String(s))}</span>
        </button>`,
      )
      .join('');
  }

  function renderCategories() {
    body.innerHTML = `
      <div class="px-4 desk:px-8">
        <div class="mb-3 flex items-baseline justify-between gap-2">
          <h2 class="t-section">Browse Categories on ${escapeHtml(providerLabel(viewState.provider))}</h2>
          <span class="text-[12.5px] text-fg-2">Select a genre or type a title above</span>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          ${DEFAULT_GENRES.map((genre, idx) => {
            const [c0, c1] = CATEGORY_GRADIENTS[idx % CATEGORY_GRADIENTS.length];
            return `
              <button
                type="button"
                data-pick-genre="${escapeHtml(genre)}"
                style="background: linear-gradient(135deg, ${c0} 0%, ${c1} 100%);"
                class="group relative flex h-[96px] items-end overflow-hidden rounded-[12px] p-4 text-left text-white shadow-sm ring-1 ring-white/10 transition-transform active:scale-[0.98]"
              >
                <span class="text-[16px] font-bold tracking-tight">${escapeHtml(genre)}</span>
              </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  function renderResults() {
    renderFilterBars();
    if (!viewState.q) {
      renderCategories();
      return;
    }
    if (viewState.loading) {
      body.innerHTML = posterGridSkeletonHtml(12);
      return;
    }
    if (viewState.error && !viewState.results.length) {
      body.innerHTML = errorStateHtml({
        title: `${providerLabel(viewState.provider)} search failed`,
        message: viewState.error,
      });
      body.querySelector('[data-retry]')?.addEventListener('click', () => {
        void executeSearch(viewState.q, { reset: true });
      });
      return;
    }

    let filtered = viewState.results;
    if (viewState.type === 'movie') filtered = filtered.filter((it) => !isSeriesItem(it));
    else if (viewState.type === 'series') filtered = filtered.filter((it) => isSeriesItem(it));

    const sorted = sortItems(filtered, viewState.sort, (it) => {
      const m = cachedMeta(itemProvider(it), itemId(it));
      return m ? { ...m, imdb_rating: officialRatingOf(it, m) } : null;
    });

    if (!sorted.length) {
      body.innerHTML = emptyStateHtml({
        icon: 'search',
        title: `No results for “${viewState.q}”`,
        message: `No matching ${viewState.type === 'all' ? 'titles' : viewState.type === 'series' ? 'series' : 'movies'} on ${providerLabel(viewState.provider)}. Try switching Source above.`,
      });
      return;
    }

    body.innerHTML = `
      ${cardGridHtml(sorted, cardMetaFor)}
      ${
        viewState.hasMore
          ? `<div class="mt-8 flex justify-center px-4">
               <button
                 type="button"
                 data-search-more
                 ${viewState.loadingMore ? 'disabled' : ''}
                 class="inline-flex h-10 items-center gap-2 rounded-full bg-fill px-6 text-[14px] font-semibold text-fg transition hover:bg-fill-2 disabled:opacity-50"
               >
                 ${viewState.loadingMore ? iconHtml('loader2', { size: 15, className: 'animate-spin' }) : ''}
                 <span>${viewState.loadingMore ? 'Loading more…' : 'Load more results'}</span>
               </button>
             </div>`
          : ''
      }`;
  }

  async function fetchSuggestions(query) {
    const trimmed = query.trim();
    if (trimmed.length < 2 || api.state.supports.suggest === false) {
      viewState.suggestions = [];
      viewState.suggestOpen = false;
      renderSuggestMenu();
      return;
    }
    const sId = ++suggestCounter;
    try {
      const res = await api.suggest({ q: trimmed }, { signal: routeSignal });
      if (disposed || routeSignal?.aborted || sId !== suggestCounter) return;
      api.markSupport('suggest', true);
      const list = Array.isArray(res?.suggestions) ? res.suggestions : Array.isArray(res) ? res : [];
      viewState.suggestions = list.filter(
        (s) => String(s).trim().toLowerCase() !== trimmed.toLowerCase(),
      );
      viewState.suggestOpen = viewState.suggestions.length > 0 && document.activeElement === input;
      renderSuggestMenu();
    } catch (err) {
      if (err?.status === 404 || err?.status === 501) {
        api.markSupport('suggest', false);
      }
    }
  }

  async function executeSearch(query, { reset = true } = {}) {
    const runId = ++runCounter;
    const trimmed = query.trim();
    viewState.q = trimmed;
    clearBtn.hidden = !trimmed;
    syncUrl();

    if (!trimmed) {
      viewState.results = [];
      viewState.loading = false;
      viewState.error = '';
      viewState.hasMore = false;
      renderResults();
      return;
    }

    if (reset) {
      viewState.page = 1;
      viewState.loading = true;
      viewState.error = '';
      renderResults();
    } else {
      viewState.loadingMore = true;
      renderResults();
    }

    try {
      const resp = await api.search(
        {
          q: trimmed,
          provider: viewState.provider,
          page: viewState.page,
        },
        { signal: routeSignal },
      );
      if (disposed || routeSignal?.aborted || runId !== runCounter) return;
      const batch = Array.isArray(resp) ? resp : Array.isArray(resp?.items) ? resp.items : [];
      const stamped = batch.map((it) => ({
        ...it,
        provider: itemProvider(it) || viewState.provider,
      }));
      const prevLen = reset ? 0 : viewState.results.length;
      viewState.results = reset
        ? dedupeItems(stamped)
        : dedupeItems([...viewState.results, ...stamped]);
      viewState.hasMore = batch.length >= 10 && viewState.results.length > prevLen;
      viewState.loading = false;
      viewState.loadingMore = false;
      viewState.error = '';
      renderResults();

      void ensureMeta(stamped);
    } catch (err) {
      if (disposed || routeSignal?.aborted || runId !== runCounter) return;
      viewState.loading = false;
      viewState.loadingMore = false;
      viewState.error = err?.message || `Could not query ${providerLabel(viewState.provider)}.`;
      renderResults();
    }
  }

  input.addEventListener('input', () => {
    const val = input.value;
    clearBtn.hidden = !val.trim();
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => void fetchSuggestions(val), 180);

    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void executeSearch(val, { reset: true }), 320);
  });

  input.addEventListener('focus', () => {
    if (viewState.suggestions.length) {
      viewState.suggestOpen = true;
      renderSuggestMenu();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (disposed) return;
      viewState.suggestOpen = false;
      renderSuggestMenu();
    }, 160);
  });

  root.querySelector('[data-search-page-form]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    viewState.suggestOpen = false;
    renderSuggestMenu();
    void executeSearch(input.value, { reset: true });
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    viewState.suggestions = [];
    viewState.suggestOpen = false;
    renderSuggestMenu();
    input.focus();
    void executeSearch('', { reset: true });
  });

  sortSelect?.addEventListener('change', () => {
    viewState.sort = sortSelect.value;
    syncUrl();
    renderResults();
  });

  root.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const sugBtn = target.closest('[data-suggest-pick]');
    if (sugBtn) {
      const picked = sugBtn.dataset.suggestPick || '';
      input.value = picked;
      viewState.suggestOpen = false;
      renderSuggestMenu();
      void executeSearch(picked, { reset: true });
      return;
    }

    const genreBtn = target.closest('[data-pick-genre]');
    if (genreBtn) {
      const g = genreBtn.dataset.pickGenre || '';
      input.value = g;
      void executeSearch(g, { reset: true });
      return;
    }

    const provChip = target.closest('[data-search-provider]');
    if (provChip) {
      const nextProv = provChip.dataset.searchProvider || 'moviebox';
      if (nextProv !== viewState.provider) {
        viewState.provider = nextProv;
        setProvider(nextProv);
        void executeSearch(viewState.q, { reset: true });
      }
      return;
    }

    const typeChip = target.closest('[data-search-type]');
    if (typeChip) {
      viewState.type = typeChip.dataset.searchType || 'all';
      syncUrl();
      renderResults();
      return;
    }

    if (target.closest('[data-search-more]')) {
      if (!viewState.loadingMore && viewState.hasMore) {
        viewState.page += 1;
        void executeSearch(viewState.q, { reset: false });
      }
    }
  });

  const onSync = () => {
    if (!disposed && viewState.results.length) renderResults();
  };
  unsubLibrary = library.subscribe(onSync);
  window.addEventListener('ifallhub:meta', onSync, { signal: routeSignal });

  if (viewState.q) {
    void executeSearch(viewState.q, { reset: true });
  } else {
    renderResults();
    if (typeof window !== 'undefined' && window.innerWidth >= 980) input.focus();
  }

  routeSignal?.addEventListener(
    'abort',
    () => {
      disposed = true;
      clearTimeout(searchTimer);
      clearTimeout(suggestTimer);
      if (unsubLibrary) unsubLibrary();
    },
    { once: true },
  );
}
