// Sidify-V2 `SearchPage` (`/search`) wired to Ifallhub's `/api/search`, `/api/suggest`,
// `/api/meta`, and `/api/library` across all providers.

import * as api from '../lib/api.js';
import {
  displayUiText,
  escapeHtml,
  formatRating,
  isKnownProvider,
  isSeriesItem,
  itemId,
  itemPoster,
  itemProvider,
  itemTitle,
  itemYear,
  providerLabel,
} from '../lib/format.js';
import * as library from '../lib/library.js';
import { detailPathFor, mediaArt } from '../lib/media-helpers.js';
import { dedupeItems } from '../lib/recommend.js';
import {
  cachedMeta,
  ensureMeta,
  setAmbientSeed,
  state,
} from '../state.js';
import {
  cardGridHtml,
  chipsHtml,
  emptyStateHtml,
  posterGridSkeletonHtml,
  sectionHeaderHtml,
} from '../ui/components.js';
import { iconHtml } from '../ui/icons.js';

const HISTORY_KEY = 'ifallhub_search_history_v1';

const CATEGORY_CARDS = [
  { genre: 'Action', color: '#be123c' },
  { genre: 'Science Fiction', color: '#0369a1' },
  { genre: 'Drama', color: '#6d28d9' },
  { genre: 'Thriller', color: '#0f766e' },
  { genre: 'Animation', color: '#b45309' },
  { genre: 'Comedy', color: '#c2410c' },
  { genre: 'Crime', color: '#334155' },
  { genre: 'Fantasy', color: '#7e22ce' },
  { genre: 'Mystery', color: '#1d4ed8' },
  { genre: 'Horror', color: '#881337' },
];

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    /* ignore */
  }
}

function pushHistory(term) {
  const clean = String(term || '').trim();
  if (clean.length < 2) return;
  const next = [clean, ...loadHistory().filter((x) => x.toLowerCase() !== clean.toLowerCase())];
  saveHistory(next);
}

function mediaSearchListHtml(items = []) {
  return `
    <div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
      ${items
        .slice(0, 8)
        .map((item) => {
          const p = itemProvider(item);
          const id = itemId(item);
          const title = itemTitle(item);
          const year = itemYear(item);
          const series = isSeriesItem(item);
          const m = cachedMeta(p, id);
          const rating = formatRating(item.imdb_rating ?? m?.imdb_rating);
          const fallback = mediaArt(title, year, series ? 'series' : 'movie', 'poster');
          const poster = itemPoster(item) || fallback;
          const href = detailPathFor(p, id, series);
          return `
            <a
              href="${escapeHtml(href)}"
              data-nav
              class="group flex items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-fill"
            >
              <div class="relative h-[60px] w-[42px] shrink-0 overflow-hidden rounded-[6px] bg-raised ring-1 ring-edge">
                <img src="${escapeHtml(poster)}" data-fallback-src="${escapeHtml(fallback)}" alt="" loading="lazy" class="h-full w-full object-cover" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[14.5px] font-medium text-fg">${escapeHtml(title)}</div>
                <div class="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-fg-2">
                  <span>${series ? 'Series' : 'Movie'}</span>
                  ${year ? `<span>· ${escapeHtml(year)}</span>` : ''}
                  ${
                    rating
                      ? `<span class="inline-flex items-center gap-0.5">· ${iconHtml('starFilled', { size: 10 })} ${escapeHtml(rating)}</span>`
                      : ''
                  }
                  <span>· ${escapeHtml(providerLabel(p))}</span>
                </div>
              </div>
            </a>`;
        })
        .join('')}
    </div>`;
}

export async function renderSearch(container, ctx = {}) {
  let query = (ctx.query?.get('q') || '').trim();
  let tab = 'all'; // 'all' | 'movies' | 'series'
  let providerMode =
    ctx.query?.get('provider') && isKnownProvider(ctx.query.get('provider'))
      ? ctx.query.get('provider')
      : 'all';
  let suggestions = [];
  let results = [];
  let loading = false;
  let errorMsg = '';
  let debounceTimer = 0;

  setAmbientSeed(query || 'Search');

  container.innerHTML = `
    <div class="fade-up pb-12">
      <div class="px-4 pt-3 desk:px-8 desk:pt-7">
        <h1 class="t-display desk:t-headline truncate" data-search-heading>
          ${escapeHtml(query || 'Search')}
        </h1>
      </div>

      <div class="sticky top-0 z-10 bg-canvas/85 px-4 pt-3 pb-3 backdrop-blur-xl desk:px-8">
        <div class="flex flex-wrap items-center gap-2.5">
          <div class="relative min-w-[220px] flex-1">
            <span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-2">
              ${iconHtml('search', { size: 16 })}
            </span>
            <input
              type="search"
              data-search-input
              value="${escapeHtml(query)}"
              placeholder="Movies, series, actors, directors…"
              aria-label="Search movies and series"
              autocomplete="off"
              spellcheck="false"
              class="field h-10 w-full rounded-[10px] pr-9 pl-9 text-[15px]"
            />
            <button
              type="button"
              data-search-clear
              ${query ? '' : 'hidden'}
              aria-label="Clear search"
              class="absolute top-1/2 right-2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-fill-3 text-fg-2 hover:text-fg"
            >
              ${iconHtml('x', { size: 13 })}
            </button>
          </div>

          <select aria-label="Search source" data-search-provider class="field h-10 rounded-[10px] px-3 text-[13.5px] font-medium">
            <option value="all" ${providerMode === 'all' ? 'selected' : ''}>All sources</option>
            ${state.providers
              .map(
                (p) =>
                  `<option value="${escapeHtml(p.id)}" ${providerMode === p.id ? 'selected' : ''}>${escapeHtml(providerLabel(p.id))}</option>`,
              )
              .join('')}
          </select>
        </div>
        <div data-suggest-row class="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto"></div>
      </div>

      <div data-search-body class="mt-2"></div>
    </div>`;

  const headingEl = container.querySelector('[data-search-heading]');
  const inputEl = container.querySelector('[data-search-input]');
  const clearBtn = container.querySelector('[data-search-clear]');
  const suggestRow = container.querySelector('[data-suggest-row]');
  const bodyEl = container.querySelector('[data-search-body]');

  function cardMetaFor(item) {
    const p = itemProvider(item);
    const id = itemId(item);
    const m = cachedMeta(p, id);
    return {
      metaEntry: m,
      rating: item?.imdb_rating ?? m?.imdb_rating,
      listed: library.isInWatchlist(p, id),
      progress: library.progressFor(p, id),
      personalRating: library.ratingFor(p, id),
    };
  }

  function renderSuggestions() {
    if (!suggestRow) return;
    if (!query || !suggestions.length) {
      suggestRow.innerHTML = '';
      return;
    }
    suggestRow.innerHTML = suggestions
      .filter((s) => s.toLowerCase() !== query.toLowerCase())
      .slice(0, 6)
      .map(
        (s) =>
          `<button type="button" data-pick-term="${escapeHtml(s)}" class="h-7 shrink-0 rounded-full bg-fill px-3 text-[12px] font-medium text-fg-2 transition hover:bg-fill-2 hover:text-fg">${escapeHtml(s)}</button>`,
      )
      .join('');
  }

  function renderBody() {
    if (ctx.signal?.aborted || !bodyEl) return;
    if (headingEl) headingEl.textContent = query || 'Search';
    if (clearBtn) clearBtn.hidden = !query;
    renderSuggestions();

    if (!query) {
      const history = loadHistory();
      bodyEl.innerHTML = `
        <div class="space-y-9">
          ${
            history.length
              ? `<section class="px-4 desk:px-8">
                   <div class="mb-2 flex items-center justify-between">
                     <h2 class="t-section">Recently searched</h2>
                     <button type="button" data-clear-history class="text-[14px] font-semibold text-playing hover:opacity-80">Clear</button>
                   </div>
                   <div class="max-w-[640px]">
                     ${history
                       .map(
                         (h) => `
                         <div class="flex h-12 items-center gap-3 hairline-b">
                           <span class="text-fg-2">${iconHtml('clock', { size: 17 })}</span>
                           <button type="button" data-pick-term="${escapeHtml(h)}" class="min-w-0 flex-1 truncate text-left text-[15px] text-fg hover:text-playing">
                             ${escapeHtml(h)}
                           </button>
                           <button type="button" data-remove-history="${escapeHtml(h)}" aria-label="Remove ${escapeHtml(h)}" class="grid h-8 w-8 place-items-center rounded-full text-fg-2 hover:bg-fill hover:text-fg">
                             ${iconHtml('x', { size: 15 })}
                           </button>
                         </div>`,
                       )
                       .join('')}
                   </div>
                 </section>`
              : ''
          }

          <section>
            ${sectionHeaderHtml('Browse categories')}
            <div class="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 2xl:grid-cols-5">
              ${CATEGORY_CARDS.map(
                (c) => `
                  <a
                    href="/movies?genre=${encodeURIComponent(c.genre)}"
                    data-nav
                    style="background: linear-gradient(135deg, ${c.color}, color-mix(in oklab, ${c.color} 45%, #09090b))"
                    class="group relative flex h-[96px] items-end overflow-hidden rounded-[12px] p-3.5 text-white shadow-sm ring-1 ring-white/10 transition-transform hover:scale-[1.015] active:scale-[0.99]"
                  >
                    <span class="text-[16px] font-bold tracking-[-0.3px]">${escapeHtml(c.genre)}</span>
                  </a>`,
              ).join('')}
            </div>
          </section>
        </div>`;
      return;
    }

    const tabsHtml = chipsHtml(
      [
        { id: 'all', label: 'Top results' },
        { id: 'movies', label: 'Movies' },
        { id: 'series', label: 'Series' },
      ],
      tab,
      { className: 'mb-5 px-4 desk:px-8', attrName: 'data-search-tab' },
    );

    if (loading && !results.length) {
      bodyEl.innerHTML = tabsHtml + posterGridSkeletonHtml(12);
      return;
    }

    const filtered = results.filter((it) => {
      if (tab === 'movies') return !isSeriesItem(it);
      if (tab === 'series') return isSeriesItem(it);
      return true;
    });

    if (!filtered.length) {
      bodyEl.innerHTML =
        tabsHtml +
        emptyStateHtml({
          icon: 'search',
          title: errorMsg ? 'Search unavailable' : `No results for “${query}”`,
          message: errorMsg || 'Check the spelling, try fewer words, or switch to All sources.',
        });
      return;
    }

    if (tab === 'all' && filtered.length >= 2) {
      const top = filtered[0];
      const topP = itemProvider(top);
      const topId = itemId(top);
      const topSeries = isSeriesItem(top);
      const topFallback = mediaArt(itemTitle(top), itemYear(top), topSeries ? 'series' : 'movie', 'poster');
      const topPoster = itemPoster(top) || topFallback;
      const topHref = detailPathFor(topP, topId, topSeries);
      const topRating = formatRating(top.imdb_rating ?? cachedMeta(topP, topId)?.imdb_rating);

      bodyEl.innerHTML = `
        ${tabsHtml}
        <div class="space-y-9">
          <div class="grid grid-cols-1 gap-6 px-4 desk:px-8 2xl:grid-cols-[minmax(300px,420px)_1fr]">
            <section>
              <h2 class="t-section mb-3">Top result</h2>
              <a
                href="${escapeHtml(topHref)}"
                data-nav
                class="group flex items-center gap-5 rounded-[18px] bg-raised p-5 ring-1 ring-edge transition-colors hover:bg-raised-2"
              >
                <div class="h-[132px] w-[88px] shrink-0 overflow-hidden rounded-[10px] bg-surface ring-1 ring-edge">
                  <img src="${escapeHtml(topPoster)}" data-fallback-src="${escapeHtml(topFallback)}" alt="" class="h-full w-full object-cover" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="line-clamp-2 text-[22px] leading-tight font-bold tracking-[-0.4px] text-fg">
                    ${escapeHtml(itemTitle(top))}
                  </div>
                  <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13.5px] text-fg-2">
                    <span>${topSeries ? 'Series' : 'Movie'}</span>
                    ${itemYear(top) ? `<span>· ${escapeHtml(itemYear(top))}</span>` : ''}
                    ${topRating ? `<span class="inline-flex items-center gap-0.5">· ${iconHtml('starFilled', { size: 11 })} ${escapeHtml(topRating)}</span>` : ''}
                    <span>· ${escapeHtml(providerLabel(topP))}</span>
                  </div>
                </div>
              </a>
            </section>

            <section class="min-w-0">
              <div class="mb-2 flex items-baseline justify-between">
                <h2 class="t-section">Movies &amp; series</h2>
                <span class="text-[13px] text-fg-2">${filtered.length} matches</span>
              </div>
              ${mediaSearchListHtml(filtered.slice(1, 9))}
            </section>
          </div>

          <section>
            ${sectionHeaderHtml('All matches', { subtitle: `${filtered.length} titles` })}
            ${cardGridHtml(filtered, cardMetaFor)}
          </section>
        </div>`;
      return;
    }

    bodyEl.innerHTML = `
      ${tabsHtml}
      ${cardGridHtml(filtered, cardMetaFor)}`;
  }

  async function runSearch(term) {
    const clean = String(term || '').trim();
    if (!clean) {
      results = [];
      suggestions = [];
      loading = false;
      renderBody();
      return;
    }

    loading = true;
    errorMsg = '';
    renderBody();

    api
      .suggest({ q: clean }, { signal: ctx.signal })
      .then((res) => {
        if (!ctx.signal?.aborted) {
          suggestions = Array.isArray(res?.suggestions) ? res.suggestions : [];
          renderSuggestions();
        }
      })
      .catch(() => {});

    try {
      if (providerMode === 'all') {
        const targets = ['moviebox', 'fourkhdhub', 'dramachi'];
        const settled = await Promise.allSettled(
          targets.map((srv) => api.search({ q: clean, provider: srv, page: 1 }, { signal: ctx.signal })),
        );
        const merged = [];
        for (const res of settled) {
          if (res.status === 'fulfilled' && Array.isArray(res.value)) {
            merged.push(...res.value);
          }
        }
        results = dedupeItems(merged);
      } else {
        const found = await api.search({ q: clean, provider: providerMode, page: 1 }, { signal: ctx.signal });
        results = dedupeItems(Array.isArray(found) ? found : []);
      }
      pushHistory(clean);
      setAmbientSeed(results[0] ? itemTitle(results[0]) : clean);
      void ensureMeta(results.slice(0, 24));
    } catch (err) {
      errorMsg = displayUiText(err.message);
      results = [];
    } finally {
      loading = false;
      if (!ctx.signal?.aborted) renderBody();
    }
  }

  function syncSearchUrl() {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (providerMode !== 'all') params.set('provider', providerMode);
    const qs = params.toString();
    window.history.replaceState({}, '', qs ? `/search?${qs}` : '/search');
  }

  inputEl?.addEventListener('input', (e) => {
    query = e.target.value;
    syncSearchUrl();
    if (clearBtn) clearBtn.hidden = !query;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runSearch(query);
    }, 300);
  });

  container.addEventListener('change', (e) => {
    if (e.target.matches('[data-search-provider]')) {
      providerMode = e.target.value;
      syncSearchUrl();
      if (query.trim()) void runSearch(query);
    }
  });

  container.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    if (target.closest('[data-search-clear]')) {
      query = '';
      if (inputEl) {
        inputEl.value = '';
        inputEl.focus();
      }
      syncSearchUrl();
      void runSearch('');
      return;
    }

    const tabBtn = target.closest('[data-search-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.searchTab || 'all';
      renderBody();
      return;
    }

    const pickBtn = target.closest('[data-pick-term]');
    if (pickBtn) {
      query = pickBtn.dataset.pickTerm || '';
      if (inputEl) inputEl.value = query;
      syncSearchUrl();
      void runSearch(query);
      return;
    }

    const rmBtn = target.closest('[data-remove-history]');
    if (rmBtn) {
      const val = rmBtn.dataset.removeHistory;
      saveHistory(loadHistory().filter((x) => x !== val));
      renderBody();
      return;
    }

    if (target.closest('[data-clear-history]')) {
      saveHistory([]);
      renderBody();
    }
  });

  const onSync = () => {
    if (!ctx.signal?.aborted) renderBody();
  };
  const unsubLib = library.subscribe(onSync);
  window.addEventListener('ifallhub:meta', onSync);
  ctx.signal?.addEventListener('abort', () => {
    clearTimeout(debounceTimer);
    unsubLib();
    window.removeEventListener('ifallhub:meta', onSync);
  });

  if (query) {
    await runSearch(query);
  } else {
    renderBody();
    if (window.innerWidth < 980) inputEl?.focus();
  }
}
