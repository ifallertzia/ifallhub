// App shell: navigation, routing, global card actions and engine status.

import './style.css';

import * as api from './lib/api.js';
import * as library from './lib/library.js';
import { handleRoute, navigate, onRoute, parseRoute, start as startRouter, titlePath, watchPath } from './lib/router.js';
import { applyMetaToDom, app, ensureMeta, onMeta, toast } from './state.js';
import { escapeHtml, providerLabel } from './lib/format.js';
import { renderHome } from './views/home.js';
import { bindSearchSuggestions, renderBrowse, runSearch, searchFromRoute } from './views/browse.js';
import { renderDetails } from './views/details.js';
import { renderMyList } from './views/mylist.js';
import { renderTracker } from './views/tracker.js';
import { renderWatch, stopPlayback } from './views/watch.js';

const view = document.querySelector('#view');
const searchInput = document.querySelector('#search-input');
const searchList = document.querySelector('#search-suggestions');
const searchForm = document.querySelector('#search-form');
let activeRoute = parseRoute();

// --- Engine status ---------------------------------------------------------

const ENGINE_LABELS = {
  checking: 'Connecting…',
  connected: 'Engine connected',
  demo: 'Demo preview',
  offline: 'Engine offline',
};

api.onEngineChange(({ engine, version }) => {
  const badge = document.querySelector('#engine-status');
  const label = document.querySelector('#engine-status-text');
  if (badge) badge.dataset.state = engine;
  if (label) label.textContent = version ? `${ENGINE_LABELS[engine]} · v${version}` : ENGINE_LABELS[engine];
});

library.subscribe(() => {
  document.dispatchEvent(new CustomEvent('ifallhub:library-changed'));
});

// --- Routing ---------------------------------------------------------------

onRoute(async (route) => {
  activeRoute = route;
  const previous = view.dataset.view;
  if (previous === 'watch' && route.name !== 'watch') await stopPlayback();

  updateNav(route);
  view.dataset.view = route.name;

  if (route.name === 'home') await renderHome(view, route);
  else if (route.name === 'search' || route.name === 'genre') {
    if (route.name === 'genre') {
      route.query.set('q', route.params.genre);
      searchInput.value = route.params.genre;
    }
    await renderBrowse(view, route);
    if (route.name === 'search' && route.query.get('q')) searchFromRoute(route);
  } else if (route.name === 'details') await renderDetails(view, route);
  else if (route.name === 'watch') await renderWatch(view, route);
  else if (route.name === 'mylist') await renderMyList(view, route);
  else if (route.name === 'tracker') await renderTracker(view, route);
  else await renderHome(view, route);

  window.scrollTo({ top: 0, behavior: route.name === 'home' ? 'smooth' : 'auto' });
});

function updateNav(route) {
  document.querySelectorAll('[data-nav-item]').forEach((item) => {
    const target = item.dataset.navItem;
    const active =
      target === route.name ||
      (target === 'search' && route.name === 'genre') ||
      (target === 'home' && !['home', 'search', 'genre', 'mylist', 'tracker'].includes(route.name));
    item.classList.toggle('is-active', active);
  });
  const crumb = document.querySelector('#crumb-current');
  if (crumb) {
    crumb.textContent =
      route.name === 'details' || route.name === 'watch'
        ? app.details?.title || 'Title'
        : { home: 'Discover', search: 'Search', genre: 'Genre', mylist: 'My List', tracker: 'Tracker' }[route.name] || 'Discover';
  }
  const count = document.querySelector('#nav-list-count');
  if (count) {
    const total = library.state.watchlist.length;
    count.textContent = total ? String(total) : '';
    count.hidden = !total;
  }
}

// --- Search ----------------------------------------------------------------

searchForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const term = searchInput.value.trim();
  navigate(term ? `/search?q=${encodeURIComponent(term)}&provider=${encodeURIComponent(app.provider)}` : '/');
});

searchInput?.addEventListener('input', () => {
  const clear = document.querySelector('#clear-search');
  if (clear) clear.hidden = !searchInput.value;
});

document.querySelector('#clear-search')?.addEventListener('click', () => {
  searchInput.value = '';
  document.querySelector('#clear-search').hidden = true;
  navigate('/');
});

bindSearchSuggestions(searchInput, searchList);

// --- Global card actions ---------------------------------------------------

document.addEventListener('click', async (event) => {
  const navLink = event.target.closest('a[data-nav]');
  if (navLink) {
    const href = navLink.getAttribute('href');
    if (href && href.startsWith('/') && !href.startsWith('//')) {
      event.preventDefault();
      navigate(href);
      return;
    }
  }

  if (event.target.closest('[data-focus-search]')) {
    event.preventDefault();
    searchInput?.focus();
    return;
  }

  const card = event.target.closest('[data-card]');
  if (!card) return;
  const provider = card.dataset.provider || app.provider;
  const id = card.dataset.id;

  const watchlistButton = event.target.closest('[data-watchlist]');
  if (watchlistButton) {
    event.preventDefault();
    event.stopPropagation();
    const listed = await library.toggleWatchlist({
      provider,
      id,
      title: card.dataset.title,
      poster_url: card.dataset.poster || null,
      year: card.dataset.year || null,
      media_type: card.dataset.type || 'movie',
    });
    watchlistButton.dataset.watchlist = listed ? '1' : '0';
    watchlistButton.innerHTML = listed
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>';
    watchlistButton.title = listed ? 'Remove from My List' : 'Add to My List';
    toast(listed ? `Added “${card.dataset.title}” to My List` : 'Removed from My List', listed ? 'success' : 'info');
    updateNav(activeRoute);
    return;
  }

  const playButton = event.target.closest('[data-play]');
  if (playButton) {
    event.preventDefault();
    event.stopPropagation();
    navigate(watchPath(provider, id));
    return;
  }

  const clearProgress = event.target.closest('[data-clear-progress]');
  if (clearProgress) {
    event.preventDefault();
    event.stopPropagation();
    await library.updateProgress({ provider, id, title: card.dataset.title }, { remove: true });
    return;
  }

  if (event.target.closest('[data-open]') || event.target === card || card.contains(event.target)) {
    if (event.target.closest('button, a, input, select')) return;
    navigate(titlePath(provider, id));
  }
});

document.addEventListener('keydown', (event) => {
  const card = event.target.closest?.('[data-card]');
  if (card && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    navigate(titlePath(card.dataset.provider || app.provider, card.dataset.id));
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (activeRoute.name !== 'search') navigate('/');
    window.setTimeout(() => searchInput?.focus(), 80);
  }
});

document.querySelector('[data-retry]')?.addEventListener('click', () => {
  if (activeRoute.name === 'search') runSearch();
  else handleRoute();
});

// --- Access key ------------------------------------------------------------

window.addEventListener('ifallhub:access-needed', () => {
  const dialog = document.querySelector('#access-dialog');
  if (dialog && !dialog.open) dialog.showModal();
});

document.querySelector('#access-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector('#access-input');
  api.setAccessKey(input.value.trim());
  input.value = '';
  document.querySelector('#access-dialog')?.close();
  toast('Access key saved', 'success');
  handleRoute();
});

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog')?.close());
});

document.querySelector('#help-button')?.addEventListener('click', () => {
  document.querySelector('#help-dialog')?.showModal();
});
document.querySelector('#music-button')?.addEventListener('click', () => {
  document.querySelector('#music-dialog')?.showModal();
});
document.querySelector('#sidebar-music')?.addEventListener('click', () => {
  document.querySelector('#music-dialog')?.showModal();
});

// --- Provider switcher -----------------------------------------------------

async function loadProviders() {
  try {
    const providers = await api.providers();
    if (Array.isArray(providers) && providers.length) app.providers = providers;
  } catch {
    app.providers = [];
  }
  const stack = document.querySelector('#source-stack');
  if (!stack) return;
  const list = app.providers.length
    ? app.providers
    : [{ id: 'moviebox', name: 'Siddharth' }];
  stack.innerHTML = list
    .map(
      (entry) => `
      <button class="source-shortcut ${entry.id === app.provider ? 'is-active' : ''}" type="button" data-provider="${escapeHtml(entry.id)}">
        <span class="source-dot ${escapeHtml(entry.id)}-dot"></span>
        <span>${escapeHtml(providerLabel(entry.id))}</span>
      </button>`,
    )
    .join('');
  stack.addEventListener('click', (event) => {
    const button = event.target.closest('[data-provider]');
    if (!button) return;
    app.provider = button.dataset.provider;
    stack.querySelectorAll('[data-provider]').forEach((entry) => {
      entry.classList.toggle('is-active', entry === button);
    });
    const providerSelect = document.querySelector('#filter-provider');
    if (providerSelect) providerSelect.value = app.provider;
    if (activeRoute.name === 'search' && searchInput?.value.trim()) runSearch();
    else if (activeRoute.name === 'search') navigate('/');
    toast(`Source: ${providerLabel(app.provider)}`, 'info');
  });
}

// --- Live updates ----------------------------------------------------------

onMeta(() => applyMetaToDom(view));

document.addEventListener('ifallhub:library-changed', () => {
  updateNav(activeRoute);
  if (['mylist', 'tracker'].includes(activeRoute.name)) handleRoute();
  if (activeRoute.name === 'home') {
    const rails = document.querySelector('#home-rails');
    if (rails) handleRoute();
  }
  applyMetaToDom(view);
});

// --- Boot ------------------------------------------------------------------

async function boot() {
  await api.checkEngine();
  await Promise.all([loadProviders(), library.start()]);
  updateNav(activeRoute);
  await startRouter();
  // Warm the metadata cache for whatever is on screen.
  window.setTimeout(() => ensureMeta(app.pool.slice(0, 36)), 400);
}

boot();
