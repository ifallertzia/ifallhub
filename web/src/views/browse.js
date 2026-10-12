// Browse + search: live suggestions, source/type filters and a rated grid.

import * as api from '../lib/api.js';
import * as library from '../lib/library.js';
import { cardHtml, emptyStateHtml, errorStateHtml, spinnerHtml } from '../ui/components.js';
import { escapeHtml, itemId, isSeriesItem, itemProvider, providerLabel } from '../lib/format.js';
import { dedupeItems, sortItems } from '../lib/recommend.js';
import { app, cardMeta, ensureMeta } from '../state.js';
import { navigate } from '../lib/router.js';

const state = {
  query: '',
  provider: 'moviebox',
  type: 'all',
  sort: 'relevance',
  results: [],
  loading: false,
  request: 0,
  suggestTimer: 0,
  suggestions: [],
};

export async function renderBrowse(container, route) {
  const query = route.query.get('q') || '';
  const provider = route.query.get('provider') || app.provider;
  const type = route.query.get('type') || 'all';
  const sort = route.query.get('sort') || 'relevance';
  Object.assign(state, { query, provider, type, sort });

  container.innerHTML = `
    <section class="browse">
      <header class="browse-head">
        <div>
          <p class="kicker">FIND SOMETHING</p>
          <h1 class="page-title">${query ? `Results for “${escapeHtml(query)}”` : 'Browse the catalog'}</h1>
        </div>
        <div class="browse-filters" role="group" aria-label="Filters">
          <label class="field">
            <span>Source</span>
            <select id="filter-provider" aria-label="Content source">
              ${(app.providers.length ? app.providers : [{ id: 'moviebox', name: 'Siddharth' }])
                .map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === provider ? 'selected' : ''}>${escapeHtml(providerLabel(entry.id))}</option>`)
                .join('')}
            </select>
          </label>
          <label class="field">
            <span>Type</span>
            <select id="filter-type" aria-label="Media type">
              <option value="all" ${type === 'all' ? 'selected' : ''}>Everything</option>
              <option value="movie" ${type === 'movie' ? 'selected' : ''}>Movies</option>
              <option value="series" ${type === 'series' ? 'selected' : ''}>Series</option>
            </select>
          </label>
          <label class="field">
            <span>Sort</span>
            <select id="filter-sort" aria-label="Sort order">
              <option value="relevance" ${sort === 'relevance' ? 'selected' : ''}>Relevance</option>
              <option value="rating" ${sort === 'rating' ? 'selected' : ''}>IMDb rating</option>
              <option value="year" ${sort === 'year' ? 'selected' : ''}>Newest</option>
              <option value="title" ${sort === 'title' ? 'selected' : ''}>A → Z</option>
            </select>
          </label>
        </div>
      </header>
      <div class="browse-body" id="browse-body">${spinnerHtml('Searching…')}</div>
    </section>`;

  container.querySelector('#filter-provider').addEventListener('change', (event) => {
    state.provider = event.target.value;
    app.provider = state.provider;
    runSearch();
  });
  container.querySelector('#filter-type').addEventListener('change', (event) => {
    state.type = event.target.value;
    paint();
  });
  container.querySelector('#filter-sort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    paint();
  });

  if (query) await runSearch();
  else paintEmpty();
}

export async function runSearch() {
  const body = document.querySelector('#browse-body');
  if (!state.query.trim()) return paintEmpty();
  const request = ++state.request;
  state.loading = true;
  if (body) body.innerHTML = spinnerHtml(`Searching ${providerLabel(state.provider)}…`);
  try {
    const results = await api.search({ q: state.query, provider: state.provider, page: 1 });
    if (request !== state.request) return;
    state.results = Array.isArray(results) ? results : [];
    state.loading = false;
    paint();
    ensureMeta(state.results.slice(0, 24), { provider: state.provider });
  } catch (error) {
    if (request !== state.request) return;
    state.loading = false;
    if (body) {
      body.innerHTML = errorStateHtml({
        title: 'Search could not finish',
        message: error?.message || 'The source did not respond.',
      });
      body.querySelector('[data-retry]')?.addEventListener('click', () => runSearch());
    }
  }
}

function visibleResults() {
  let items = dedupeItems(state.results);
  if (state.type === 'movie') items = items.filter((item) => !isSeriesItem(item));
  if (state.type === 'series') items = items.filter((item) => isSeriesItem(item));
  return sortItems(items, state.sort);
}

function paint() {
  const body = document.querySelector('#browse-body');
  if (!body) return;
  const items = visibleResults();
  if (!items.length) {
    body.innerHTML = emptyStateHtml({
      title: state.query ? 'No titles found' : 'Search for a title',
      message: state.query
        ? `Nothing matched on ${providerLabel(state.provider)}. Try another spelling or switch source.`
        : 'Type a title above, or pick a genre from the home page.',
    });
    return;
  }
  body.innerHTML = `
    <p class="result-count">${items.length} ${items.length === 1 ? 'title' : 'titles'}${state.query ? ` for “${escapeHtml(state.query)}”` : ''}</p>
    <div class="card-grid">${items.map((item) => cardHtml(item, cardMeta(item, { provider: itemProvider(item) || state.provider }))).join('')}</div>`;
}

function paintEmpty() {
  const body = document.querySelector('#browse-body');
  if (!body) return;
  body.innerHTML = emptyStateHtml({
    title: 'Search the whole catalog',
    message: 'Type a movie, series or anime title. Suggestions appear as you type.',
  });
}

/** Live suggestions for the top-bar search field. */
export function bindSearchSuggestions(input, list) {
  if (!input) return;
  const close = () => {
    list.innerHTML = '';
    list.hidden = true;
  };
  input.addEventListener('input', () => {
    const term = input.value.trim();
    window.clearTimeout(state.suggestTimer);
    if (term.length < 2) return close();
    state.suggestTimer = window.setTimeout(async () => {
      if (api.state.supports.suggest === false) return;
      try {
        const payload = await api.suggest({ q: term });
        api.markSupport('suggest', true);
        const suggestions = (payload.suggestions || []).slice(0, 8);
        if (!suggestions.length) return close();
        list.innerHTML = suggestions
          .map((entry) => `<button type="button" data-suggestion="${escapeHtml(entry)}">${escapeHtml(entry)}</button>`)
          .join('');
        list.hidden = false;
      } catch (error) {
        if (error?.status === 404) api.markSupport('suggest', false);
        close();
      }
    }, 220);
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-suggestion]');
    if (!button) return;
    input.value = button.dataset.suggestion;
    close();
    navigate(`/search?q=${encodeURIComponent(button.dataset.suggestion)}&provider=${encodeURIComponent(app.provider)}`);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.searchbox')) close();
  });
}

export function currentQuery() {
  return state.query;
}

export function watchlistCount() {
  return library.state.watchlist.length;
}

/** Re-runs the visible search when the route changes to /search. */
export function searchFromRoute(route) {
  const query = route.query.get('q') || '';
  const provider = route.query.get('provider') || state.provider;
  const changed = query !== state.query || provider !== state.provider;
  state.query = query;
  state.provider = provider;
  app.provider = provider;
  const heading = document.querySelector('.browse .page-title');
  if (heading) heading.textContent = query ? `Results for “${query}”` : 'Browse the catalog';
  if (changed) runSearch();
  else paint();
}

export function itemIdOf(item) {
  return itemId(item);
}
