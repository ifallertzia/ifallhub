import './style.css';

let shakaModulePromise;

const state = {
  provider: 'moviebox',
  query: '',
  results: [],
  item: null,
  details: null,
  releases: [],
  streamSetId: null,
  selectedRelease: 0,
  season: 0,
  episode: 0,
  isSeries: false,
  activePlayer: null,
  playbackRunId: 0,
  playbackController: null,
  autoPlaybackActive: false,
  discoverItems: [],
  requestNumber: 0,
  currentRoute: '/',
  fallbackProvidersTried: [],
  isNavigating: false,
  playbackHistory: [],
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const searchForm = $('#search-form');
const searchInput = $('#search-input');
const providerSelect = $('#provider-select');
const resultsGrid = $('#results-grid');
const resultCount = $('#result-count');
const resultsTitle = $('#results-title');
const resultsKicker = $('#results-kicker');
const emptyState = $('#empty-state');
const loadingState = $('#loading-state');
const errorState = $('#error-state');
const detailsDialog = $('#details-dialog');
const detailsContent = $('#details-content');
const playerDialog = $('#player-dialog');
const videoElement = $('#video-element');
const videoError = $('#video-error-overlay');
const homePage = $('#home-page');
const detailsPage = $('#details-page');
const detailsPageContent = $('#details-page-content');
const playerPage = $('#player-page');
let searchTimer = 0;
let detailRequestNumber = 0;
// Faster switching: reduced from 15000 to 6500ms for quick fallback
const STREAM_START_TIMEOUT_MS = 6500;
const STABLE_PLAYBACK_MS = 1200;
const PROVIDER_PRIORITY = {
  moviebox: 0,
  fourkhdhub: 1,
  dramachi: 2,
  addons: 3,
  bdix_circleftp: 4,
  bdix_dhakaflix: 5,
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function apiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const key = getAccessKey();
  if (key) headers['X-MovieBox-Key'] = key;
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { error: await response.text() };
  const attempt = options.accessAttempts || 0;
  if (response.status === 401 && attempt < 3) {
    setAccessKey('');
    const unlocked = await promptAccessKey();
    if (unlocked) return api(path, { ...options, accessAttempts: attempt + 1 });
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

const ACCESS_KEY_STORAGE = 'moviebox_access_key';

function getAccessKey() {
  try {
    return localStorage.getItem(ACCESS_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

function setAccessKey(key) {
  try {
    if (key) localStorage.setItem(ACCESS_KEY_STORAGE, key);
    else localStorage.removeItem(ACCESS_KEY_STORAGE);
  } catch {
    /* Storage can be unavailable in private contexts. */
  }
}

function promptAccessKey() {
  return new Promise((resolve) => {
    const dialog = $('#access-dialog');
    const form = $('#access-form');
    const input = $('#access-input');
    if (!dialog || !form || !input) return resolve(false);
    const onSubmit = (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      setAccessKey(value);
      input.value = '';
      cleanup();
      dialog.close();
      resolve(true);
    };
    const onClose = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('close', onClose);
    };
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('close', onClose);
    if (!dialog.open) dialog.showModal();
    input.focus();
  });
}

function setEngineStatus(status, label) {
  const element = $('#engine-status');
  if (!element) return;
  element.dataset.state = status;
  const txt = $('#engine-status-text');
  if (txt) txt.textContent = label;
}

async function checkEngine() {
  try {
    const health = await api('/api/health');
    if (health.mode === 'demo') setEngineStatus('demo', 'Demo preview');
    else setEngineStatus('connected', 'Engine connected');
  } catch {
    setEngineStatus('offline', 'Engine offline');
  }
}

function setLoading(isLoading) {
  if (!loadingState || !errorState || !emptyState || !resultsGrid) return;
  loadingState.hidden = !isLoading;
  errorState.hidden = true;
  emptyState.hidden = isLoading || state.results.length > 0;
  resultsGrid.hidden = isLoading || state.results.length === 0;
  if (resultCount) resultCount.textContent = isLoading ? '' : resultCount.textContent;
}

function setError(title, message) {
  if (!loadingState || !emptyState || !resultsGrid || !errorState) return;
  loadingState.hidden = true;
  emptyState.hidden = true;
  resultsGrid.hidden = true;
  errorState.hidden = false;
  const t = $('#error-title');
  const m = $('#error-message');
  if (t) t.textContent = title;
  if (m) m.textContent = displayUiText(message);
  if (resultCount) resultCount.textContent = '';
}

function setEmptyMessage(title, message) {
  if (!loadingState || !errorState || !resultsGrid || !emptyState) return;
  loadingState.hidden = true;
  errorState.hidden = true;
  resultsGrid.hidden = true;
  emptyState.hidden = false;
  emptyState.innerHTML = `
    <div class="empty-icon"><span></span><span></span><span></span></div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
  `;
  if (resultCount) resultCount.textContent = '';
}

function hashTitle(value) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash % 360);
}

function itemProvider(item) {
  return item?.id?.provider || item?.provider || state.provider;
}

function itemId(item) {
  return item?.id?.value || item?.id || '';
}

function providerLabel(provider) {
  const key = String(provider || '').trim().toLowerCase();
  const labels = {
    moviebox: 'Siddharth',
    fourkhdhub: 'Ritu',
    dramachi: 'Sakshi',
    bdix_circleftp: 'Shreya',
    bdix_dhakaflix: 'Everyone',
    addons: 'Ifallhub',
  };
  return labels[key] || displayUiText(provider) || 'Source';
}

function displayUiText(value = '') {
  return String(value)
    .replace(/\bmovie\s*box(?:-tui)?\b/gi, 'Ifallhub')
    .replace(/\b4k\s*hd\s*hub\b/gi, 'Ritu')
    .replace(/\bdrama\s*chi\b/gi, 'Sakshi')
    .replace(/\bcircle\s*ftp(?:\s*\(bdix\))?\b/gi, 'Shreya')
    .replace(/\bdhaka\s*flix(?:\s*\(bdix\))?\b/gi, 'Everyone')
    .replace(/\bcommunity\s*add[ -]?ons?\b/gi, 'Ifallhub');
}

function prettySize(size) {
  const bytes = Number(size);
  if (!bytes || bytes < 0) return '';
  const units = ['B', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// --- ROUTING (sub pages, not popups) ---
function parseRoute() {
  const path = window.location.pathname;
  const search = new URLSearchParams(window.location.search);
  // /title/:provider/:id
  const titleMatch = path.match(/^\/title\/([^\/]+)\/(.+)$/);
  if (titleMatch) {
    return { name: 'details', provider: decodeURIComponent(titleMatch[1]), id: decodeURIComponent(titleMatch[2]), query: search };
  }
  // /watch or /player
  if (path.startsWith('/watch') || path.startsWith('/player')) {
    return { name: 'player', query: search };
  }
  return { name: 'home', query: search };
}

function navigate(path, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  handleRoute();
}

function updateBreadcrumb(route) {
  const current = $('#breadcrumb-current');
  const navDiscover = $('#nav-discover');
  if (!current) return;
  $$('.nav-item', document).forEach(el => el.classList.remove('active'));
  if (route.name === 'home') {
    current.textContent = 'Discover';
    if (navDiscover) navDiscover.classList.add('active');
  } else if (route.name === 'details') {
    current.textContent = state.details?.title || state.item?.title || 'Title details';
    // keep discover active but show sub
  } else if (route.name === 'player') {
    current.textContent = state.details?.title || 'Now playing';
  }
}

function showPage(name) {
  if (homePage) homePage.hidden = name !== 'home';
  if (detailsPage) detailsPage.hidden = name !== 'details';
  if (playerPage) playerPage.hidden = name !== 'player';
  // Close any open dialogs when navigating to pages
  try { detailsDialog?.close(); } catch {}
  try { playerDialog?.close(); } catch {}
  state.currentRoute = name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleRoute() {
  const route = parseRoute();
  updateBreadcrumb(route);
  if (route.name === 'home') {
    showPage('home');
    const q = route.query.get('q');
    const provider = route.query.get('provider');
    if (provider && ProviderKindValid(provider)) {
      syncProvider(provider);
    }
    if (q) {
      if (searchInput) searchInput.value = q;
      await runSearch(q, false);
    } else if (!state.results.length && !state.query) {
      // Only load discover if not already searching
      if (state.discoverItems.length) renderDiscover(state.discoverItems);
      else loadDiscover();
    }
  } else if (route.name === 'details') {
    showPage('details');
    // Load details if needed
    const provider = route.provider;
    const id = route.id;
    if (!provider || !id) {
      navigate('/', true);
      return;
    }
    // If we already have this item loaded, reuse, else fetch
    const item = { id: { provider, value: id }, provider, title: state.details?.title || id };
    if (state.item && itemProvider(state.item) === provider && itemId(state.item) === id && state.details) {
      renderDetailsPage(state.details);
      if (!state.releases.length) loadStreams();
    } else {
      await openDetails(item, true);
    }
  } else if (route.name === 'player') {
    showPage('player');
    // If no active playback, go back to details or home
    if (!state.streamSetId || !state.releases.length) {
      // Try to recover from history or go home
      if (state.item) {
        navigate(`/title/${encodeURIComponent(itemProvider(state.item))}/${encodeURIComponent(itemId(state.item))}`, true);
      } else {
        navigate('/', true);
      }
    }
  }
}

function ProviderKindValid(p) {
  return ['moviebox','fourkhdhub','dramachi','bdix_circleftp','bdix_dhakaflix','addons'].includes(p);
}

// --- Sorting releases to bring playable links to top ---
function scoreRelease(release) {
  const provider = String(release.provider || state.provider || '').toLowerCase();
  const providerScore = PROVIDER_PRIORITY[provider] ?? 10;
  const quality = release.quality || 'AUTO';
  let qualityScore = 0;
  const qLower = quality.toLowerCase();
  if (qLower.includes('2160') || qLower.includes('4k') || qLower.includes('uhd')) qualityScore = 0;
  else if (qLower.includes('1080')) qualityScore = 1;
  else if (qLower.includes('720')) qualityScore = 2;
  else if (qLower.includes('480')) qualityScore = 3;
  else if (qLower.includes('360')) qualityScore = 4;
  else qualityScore = 5;
  // Prefer releases with mirrors and size
  const hasMirror = (release.mirrors?.length || 0) > 0 ? 0 : 10;
  const size = release.size_bytes ? 0 : 1; // prefer known size
  // Prefer direct_file or known good
  const directBonus = release.mirrors?.some(m => m.direct_file) ? -1 : 0;
  return providerScore * 100 + qualityScore * 10 + hasMirror + size + directBonus;
}

function sortReleases(releases) {
  return [...releases].sort((a, b) => {
    const sa = scoreRelease(a);
    const sb = scoreRelease(b);
    if (sa !== sb) return sa - sb;
    // Higher resolution first if same provider
    const ra = a.quality ? parseInt(a.quality) || 0 : 0;
    const rb = b.quality ? parseInt(b.quality) || 0 : 0;
    return rb - ra;
  });
}

function renderCards(items) {
  state.results = Array.isArray(items) ? items : [];
  if (!resultsGrid) return;
  resultsGrid.innerHTML = '';
  if (errorState) errorState.hidden = true;
  if (loadingState) loadingState.hidden = true;
  resultsGrid.hidden = state.results.length === 0;
  if (emptyState) emptyState.hidden = state.results.length > 0;
  if (resultCount) resultCount.textContent = state.results.length
    ? `${state.results.length} ${state.results.length === 1 ? 'TITLE' : 'TITLES'}`
    : '';

  if (!state.results.length) {
    setEmptyMessage(
      state.query ? 'No titles found just yet.' : 'Every good story starts somewhere.',
      state.query
        ? 'Try another spelling, or switch to a different source.'
        : 'Search a title above, or pick a quick search to get started.',
    );
    return;
  }

  resultsGrid.innerHTML = state.results.map((item, index) => {
    const title = item.title || 'Untitled';
    const hue = hashTitle(title);
    const cover = item.poster_url || item.cover_url;
    const poster = cover
      ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(title)} poster" loading="lazy" />`
      : '';
    const type = item.media_type === 'series' || item.stype === 2 ? 'SERIES' : 'MOVIE';
    const year = item.year || item.release_year || '';
    const provider = itemProvider(item);
    const sourceName = providerLabel(provider);

    return `
      <article class="movie-card" role="button" tabindex="0" data-card-index="${index}" aria-label="View ${escapeHtml(title)} details">
        <div class="movie-poster" style="--poster-glow: hsla(${hue}, 64%, 57%, .55); --poster-top: hsl(${hue}, 23%, 27%);">
          ${poster}
          <div class="poster-fallback" ${cover ? 'hidden' : ''}>
            <span class="fallback-top">IFALLHUB · ${escapeHtml(sourceName.toUpperCase())}</span>
            <div class="fallback-art"><span>${escapeHtml(title.trim().slice(0, 1).toUpperCase())}</span></div>
            <span class="fallback-bottom">${escapeHtml(title)}</span>
          </div>
          <span class="card-type">${type}</span>
          <span class="card-overlay"><span class="card-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg></span></span>
        </div>
        <h3 class="movie-card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
        <div class="movie-card-meta">
          ${year ? `<span>${escapeHtml(year)}</span><span class="meta-separator"></span>` : ''}
          <span>${escapeHtml(sourceName)}</span>
        </div>
      </article>
    `;
  }).join('');

  $$('.movie-poster img', resultsGrid).forEach((image) => {
    image.addEventListener('error', () => {
      image.remove();
      const fallback = $('.poster-fallback', image.parentElement);
      if (fallback) fallback.hidden = false;
    }, { once: true });
  });

  $$('.movie-card', resultsGrid).forEach((card) => {
    const open = () => {
      const item = state.results[Number(card.dataset.cardIndex)];
      if (item) openDetails(item);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    // Prefetch details on hover for speed
    card.addEventListener('mouseenter', () => {
      const item = state.results[Number(card.dataset.cardIndex)];
      if (item) {
        const provider = itemProvider(item);
        const id = itemId(item);
        // Warm cache, no await
        api(apiUrl('/api/details', { provider, id })).catch(() => {});
      }
    }, { once: true });
  });
}

function renderDiscover(items) {
  state.query = '';
  if (resultsKicker) resultsKicker.textContent = 'PICKED FOR YOU';
  if (resultsTitle) resultsTitle.textContent = "Tonight's possibilities";
  renderCards(items);
}

async function loadDiscover() {
  state.query = '';
  if (resultsKicker) resultsKicker.textContent = 'PICKED FOR YOU';
  if (resultsTitle) resultsTitle.textContent = "Tonight's possibilities";
  setLoading(true);
  try {
    const data = await api('/api/discover?provider=moviebox');
    state.discoverItems = data.items || [];
    renderDiscover(state.discoverItems);
  } catch (error) {
    state.results = [];
    setEmptyMessage('Every good story starts somewhere.', 'Search a title above, or pick a quick search to get started.');
    if (resultCount) resultCount.textContent = '';
    if (error.message && !error.message.toLowerCase().includes('unknown')) {
      setEngineStatus('offline', 'Engine offline');
    }
  }
}

async function runSearch(value = searchInput?.value || '', updateUrl = true) {
  const query = value.trim();
  clearTimeout(searchTimer);
  state.query = query;
  if (!query) {
    if (updateUrl) navigate('/', false);
    return loadDiscover();
  }
  if (resultsKicker) resultsKicker.textContent = 'SEARCH RESULTS';
  if (resultsTitle) resultsTitle.textContent = `Results for “${query}”`;
  setLoading(true);
  const request = ++state.requestNumber;
  if (updateUrl) {
    const url = apiUrl('/', { q: query, provider: state.provider });
    // Use replaceState for typing to avoid history spam, pushState on submit
    navigate(url, false);
  }
  try {
    const items = await api(apiUrl('/api/search', {
      q: query,
      provider: state.provider,
      page: 1,
    }));
    if (request !== state.requestNumber) return;
    renderCards(items);
  } catch (error) {
    if (request !== state.requestNumber) return;
    setError('Search couldn’t finish', error.message || 'The source did not return results.');
  }
}

function renderDetailsLoading() {
  const loadingHtml = `
    <div class="details-loading"><div class="loading-spinner"></div><span>Loading details…</span></div>
  `;
  if (detailsPageContent) detailsPageContent.innerHTML = loadingHtml;
  if (detailsContent) detailsContent.innerHTML = `
    <button class="dialog-close" type="button" data-close="details" aria-label="Close details">×</button>
    ${loadingHtml}
  `;
}

function seasonByNumber(details, number) {
  return (details?.seasons || []).find((season) => Number(season.number) === Number(number));
}

function renderDetailsPage(details) {
  const item = state.item || {};
  const title = details.title || item.title || 'Untitled';
  const poster = details.poster_url || item.poster_url || item.cover_url;
  const isSeries = details.media_type === 'series' || (details.seasons || []).length > 0;
  const year = details.year || item.year || '';
  const type = isSeries ? 'SERIES' : 'FEATURE FILM';
  const rating = details.imdb_rating
    ? `<span class="rating-badge">★ ${escapeHtml(details.imdb_rating)}</span>`
    : '';
  const genres = (details.genres || []).slice(0, 5).map((genre) => `<span class="genre-chip">${escapeHtml(genre)}</span>`).join('');
  const cover = poster
    ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(title)} poster" />`
    : `<div class="poster-fallback"><span class="fallback-top">IFALLHUB WEB</span><div class="fallback-art"><span>${escapeHtml(title.slice(0, 1))}</span></div><span class="fallback-bottom">${escapeHtml(title)}</span></div>`;
  const seasonOptions = (details.seasons || []).map((season) =>
    `<option value="${Number(season.number)}" ${Number(season.number) === Number(state.season) ? 'selected' : ''}>Season ${Number(season.number)}</option>`,
  ).join('');
  const episodes = seasonByNumber(details, state.season)?.episodes || [];
  const episodeOptions = episodes.map((episode) => {
    const label = episode.title ? `Episode ${Number(episode.number)} · ${escapeHtml(episode.title)}` : `Episode ${Number(episode.number)}`;
    return `<option value="${Number(episode.number)}" ${Number(episode.number) === Number(state.episode) ? 'selected' : ''}>${label}</option>`;
  }).join('');
  const episodeControls = isSeries
    ? `<div class="episode-pickers">
         ${seasonOptions ? `<label>SEASON<select id="season-select">${seasonOptions}</select></label>` : ''}
         ${episodeOptions ? `<label>EPISODE<select id="episode-select">${episodeOptions}</select></label>` : ''}
       </div>`
    : '';

  const html = `
    <section class="detail-hero">
      <div class="detail-cover">${cover}</div>
      <div class="detail-copy">
        <div class="detail-eyebrow"><span></span>${type} · ${escapeHtml(providerLabel(itemProvider(item)))}</div>
        <h2>${escapeHtml(title)}</h2>
        <div class="detail-meta">
          ${year ? `<span>${escapeHtml(year)}</span>` : ''}
          ${details.duration ? `<span>${year ? '·' : ''} ${escapeHtml(details.duration)}</span>` : ''}
          ${rating}
        </div>
        <p class="detail-description">${escapeHtml(details.description || details.tagline || 'Choose a stream below to start watching.')}</p>
        ${details.director ? `<div class="detail-credits"><span>Directed by <strong>${escapeHtml(details.director)}</strong></span></div>` : ''}
        ${genres ? `<div class="detail-genres">${genres}</div>` : ''}
      </div>
    </section>
    <section class="streams-panel">
      <div class="stream-controls">
        <div class="stream-heading"><div class="section-kicker">AVAILABLE SOURCES</div><h3>Choose a stream</h3><p id="stream-subtitle">Checking configured sources…</p></div>
        ${episodeControls}
      </div>
      <div class="stream-list" id="stream-list"><div class="detail-busy"><span class="loading-spinner"></span>Finding available streams…</div></div>
      <div class="stream-actions">
        <div class="stream-note">Streams are prepared by your Ifallhub player. Best playable links are shown first.</div>
        <button class="play-button" id="play-selected" type="button" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg><span>Play automatically</span>
        </button>
      </div>
    </section>
  `;

  if (detailsPageContent) detailsPageContent.innerHTML = html;
  if (detailsContent) {
    detailsContent.innerHTML = `
      <button class="dialog-close" type="button" data-close="details" aria-label="Close details">×</button>
      ${html}
    `;
  }

  const attachEvents = (root) => {
    const coverImage = $('.detail-cover img', root);
    if (coverImage) {
      coverImage.addEventListener('error', () => {
        const hue = hashTitle(title);
        const fallback = document.createElement('div');
        fallback.className = 'poster-fallback';
        fallback.style.setProperty('--poster-glow', `hsla(${hue}, 64%, 57%, .55)`);
        fallback.innerHTML = `<span class="fallback-top">IFALLHUB WEB</span><div class="fallback-art"><span>${escapeHtml(title.slice(0, 1))}</span></div><span class="fallback-bottom">${escapeHtml(title)}</span>`;
        coverImage.replaceWith(fallback);
      }, { once: true });
    }
    $('#season-select', root)?.addEventListener('change', (event) => {
      state.season = Number(event.target.value);
      const season = seasonByNumber(state.details, state.season);
      state.episode = Number(season?.episodes?.[0]?.number || 1);
      renderDetailsPage(state.details);
      loadStreams();
    });
    $('#episode-select', root)?.addEventListener('change', (event) => {
      state.episode = Number(event.target.value);
      loadStreams();
    });
    $('#play-selected', root)?.addEventListener('click', playSelected);
  };

  if (detailsPageContent) attachEvents(detailsPageContent);
  if (detailsContent) attachEvents(detailsContent);
}

async function openDetails(item, isRouteNavigation = false) {
  state.item = item;
  state.details = null;
  state.releases = [];
  state.streamSetId = null;
  state.selectedRelease = 0;
  state.fallbackProvidersTried = [];
  const request = ++detailRequestNumber;
  renderDetailsLoading();
  if (!isRouteNavigation) {
    const provider = itemProvider(item);
    const id = itemId(item);
    navigate(`/title/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`);
    showPage('details');
  }

  try {
    const details = await api(apiUrl('/api/details', {
      provider: itemProvider(item),
      id: itemId(item),
    }));
    if (request !== detailRequestNumber) return;
    state.details = details;
    state.isSeries = details.media_type === 'series' || (details.seasons || []).length > 0;
    state.season = state.isSeries ? Number(details.seasons?.[0]?.number || 1) : 0;
    state.episode = state.isSeries
      ? Number(details.seasons?.[0]?.episodes?.[0]?.number || 1)
      : 0;
    renderDetailsPage(details);
    updateBreadcrumb({ name: 'details' });
    loadStreams();
  } catch (error) {
    if (request !== detailRequestNumber) return;
    const errHtml = `
      <div class="details-loading"><div class="error-mark">!</div><span>${escapeHtml(displayUiText(error.message || 'Could not load title details.'))}</span></div>
    `;
    if (detailsPageContent) detailsPageContent.innerHTML = errHtml;
    if (detailsContent) detailsContent.innerHTML = `
      <button class="dialog-close" type="button" data-close="details" aria-label="Close details">×</button>
      ${errHtml}
    `;
  }
}

async function loadStreams() {
  const list = $('#stream-list', detailsPageContent) || $('#stream-list', detailsContent);
  const subtitle = $('#stream-subtitle', detailsPageContent) || $('#stream-subtitle', detailsContent);
  const playButton = $('#play-selected', detailsPageContent) || $('#play-selected', detailsContent);
  if (!state.item) return;

  state.streamSetId = null;
  state.releases = [];
  state.selectedRelease = 0;
  if (playButton) playButton.disabled = true;
  if (list) list.innerHTML = '<div class="detail-busy"><span class="loading-spinner"></span>Finding available streams…</div>';
  if (subtitle) subtitle.textContent = 'Checking configured sources…';
  const request = ++detailRequestNumber;

  try {
    const response = await api(apiUrl('/api/streams', {
      provider: itemProvider(state.item),
      id: itemId(state.item),
      season: state.season,
      episode: state.episode,
      is_series: state.isSeries,
    }));
    if (request !== detailRequestNumber) return;
    state.streamSetId = response.stream_set_id || null;
    let releases = response.releases || response.streams || [];
    // Sort to bring playable links to top before playing
    releases = sortReleases(releases);
    state.releases = releases;
    if (subtitle) {
      const total = state.releases.length;
      subtitle.textContent = total ? `${total} stream${total === 1 ? '' : 's'} found — best first` : 'No streams found for this title.';
    }
    renderStreams();
  } catch (error) {
    if (request !== detailRequestNumber) return;
    if (subtitle) subtitle.textContent = 'The source could not be reached.';
    if (list) list.innerHTML = `<div class="stream-empty stream-error">${escapeHtml(displayUiText(error.message || 'Could not load streams.'))}</div>`;
  }
}

function renderStreams() {
  const list = $('#stream-list', detailsPageContent) || $('#stream-list', detailsContent);
  const playButton = $('#play-selected', detailsPageContent) || $('#play-selected', detailsContent);
  const playerList = $('#player-stream-list');
  if (!list && !playerList) return;
  const targetLists = [list, playerList].filter(Boolean);
  if (!state.releases.length) {
    targetLists.forEach(l => {
      l.innerHTML = '<div class="stream-empty">No playable streams are available. Try another provider or check your add-on setup.</div>';
    });
    if (playButton) playButton.disabled = true;
    return;
  }

  const html = state.releases.map((release, index) => {
    const quality = release.quality || 'AUTO';
    const source = providerLabel(release.provider || state.provider);
    const filename = displayUiText(release.filename || 'Stream');
    const fields = [release.codec, release.language, prettySize(release.size_bytes)].filter(Boolean);
    const isSelected = index === state.selectedRelease;
    return `
      <button class="stream-option ${isSelected ? 'selected' : ''}" type="button" data-release-index="${index}">
        <span class="stream-quality">${escapeHtml(quality)}</span>
        <span class="stream-main">
          <span class="stream-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
          <span class="stream-sub">${fields.map(escapeHtml).join('<span>·</span>') || 'Ready to play'}</span>
        </span>
        <span class="stream-source" title="${escapeHtml(source)}">${escapeHtml(source)}</span>
        <span class="stream-check">${isSelected ? '✓' : ''}</span>
      </button>
    `;
  }).join('');

  targetLists.forEach(l => l.innerHTML = html);

  targetLists.forEach(l => {
    $$('.stream-option', l).forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedRelease = Number(button.dataset.releaseIndex);
        renderStreams();
        // If already in player page, auto play selected
        if (state.currentRoute === 'player') playSelected();
      });
    });
  });
  if (playButton) playButton.disabled = !state.streamSetId || state.autoPlaybackActive;
}

async function tryNextProvider() {
  const currentTitle = state.details?.title || state.item?.title;
  if (!currentTitle) return false;
  const allProviders = ['moviebox','fourkhdhub','dramachi','addons','bdix_circleftp','bdix_dhakaflix'];
  const current = String(itemProvider(state.item) || state.provider).toLowerCase();
  const candidates = allProviders.filter(p => p !== current && !state.fallbackProvidersTried.includes(p));
  // Sort by priority
  candidates.sort((a,b) => (PROVIDER_PRIORITY[a] ?? 10) - (PROVIDER_PRIORITY[b] ?? 10));

  for (const nextProvider of candidates) {
    try {
      state.fallbackProvidersTried.push(nextProvider);
      const statusEl = $('#player-status');
      if (statusEl) statusEl.textContent = `Trying ${providerLabel(nextProvider)} for "${currentTitle}"…`;
      const searchRes = await api(apiUrl('/api/search', { q: currentTitle, provider: nextProvider, page: 1 }));
      if (!searchRes.length) continue;
      // Find best match by title similarity (simple includes)
      let best = searchRes[0];
      const lowerTitle = currentTitle.toLowerCase();
      const exact = searchRes.find(r => r.title && r.title.toLowerCase() === lowerTitle);
      if (exact) best = exact;
      else {
        const partial = searchRes.find(r => r.title && (r.title.toLowerCase().includes(lowerTitle) || lowerTitle.includes(r.title.toLowerCase())));
        if (partial) best = partial;
      }
      // Load its streams
      state.item = best;
      syncProvider(nextProvider);
      const streamsRes = await api(apiUrl('/api/streams', {
        provider: nextProvider,
        id: itemId(best),
        season: state.season,
        episode: state.episode,
        is_series: state.isSeries,
      }));
      let releases = streamsRes.releases || streamsRes.streams || [];
      if (!releases.length) continue;
      releases = sortReleases(releases);
      state.streamSetId = streamsRes.stream_set_id;
      state.releases = releases;
      state.selectedRelease = 0;
      renderStreams();
      // Try to play this new provider's streams
      if (statusEl) statusEl.textContent = `Found ${releases.length} streams in ${providerLabel(nextProvider)}, trying…`;
      return true;
    } catch (e) {
      console.warn(`Fallback to ${nextProvider} failed:`, e);
      continue;
    }
  }
  return false;
}

async function playSelected() {
  if (!state.releases.length || !state.streamSetId || state.autoPlaybackActive) return;

  const button = $('#play-selected', detailsPageContent) || $('#play-selected', detailsContent);
  const title = state.details?.title || state.item?.title || 'Now playing';
  const firstRelease = Math.min(Math.max(Number(state.selectedRelease) || 0, 0), state.releases.length - 1);
  const attempts = [];
  for (let offset = 0; offset < state.releases.length; offset += 1) {
    const releaseIndex = (firstRelease + offset) % state.releases.length;
    const mirrorCount = Math.max(1, state.releases[releaseIndex].mirrors?.length || 1);
    for (let mirrorIndex = 0; mirrorIndex < mirrorCount; mirrorIndex += 1) {
      attempts.push({ releaseIndex, mirrorIndex });
    }
  }

  const runId = ++state.playbackRunId;
  state.autoPlaybackActive = true;
  if (button) {
    button.disabled = true;
    const span = button.querySelector('span');
    if (span) span.textContent = 'Trying streams…';
  }
  // Navigate to player sub-page (same tab), not popup
  if (state.currentRoute !== 'player') {
    navigate('/watch', false);
    showPage('player');
  }
  const playerTitle = $('#player-page-title') || $('#player-title');
  if (playerTitle) playerTitle.textContent = title;
  if (videoError) videoError.hidden = true;

  const playerStatus = $('#player-status');
  let lastError = '';
  try {
    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      if (runId !== state.playbackRunId) break;

      const { releaseIndex, mirrorIndex } = attempts[attemptIndex];
      const release = state.releases[releaseIndex];
      const quality = release.quality || 'AUTO';
      const provider = release.provider || itemProvider(state.item) || state.provider;
      const sourceName = providerLabel(provider);
      state.selectedRelease = releaseIndex;
      renderStreams();
      const qEl = $('#player-page-quality') || $('#player-quality');
      const sEl = $('#player-page-source') || $('#player-source');
      if (qEl) qEl.textContent = String(quality).toUpperCase();
      if (sEl) sEl.textContent = sourceName;
      if (playerTitle) playerTitle.textContent = displayUiText(release.filename || title);
      if (playerStatus) {
        playerStatus.textContent = `Trying ${sourceName} · ${quality} (${attemptIndex + 1} of ${attempts.length})…`;
      }
      if (videoError) videoError.hidden = true;

      await closeActivePlayer();
      if (runId !== state.playbackRunId) break;

      try {
        const playback = await api('/api/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stream_set_id: state.streamSetId,
            release_index: releaseIndex,
            mirror_index: mirrorIndex,
          }),
        });
        if (runId !== state.playbackRunId) break;

        const result = await openPlayer(playback, title, runId, quality, provider);
        if (result.played) {
          if (playerStatus) {
            playerStatus.textContent = `Now playing · ${sourceName} · ${quality}. Automatic switching stopped.`;
          }
          state.playbackHistory.push({ provider, quality, title, time: Date.now() });
          return;
        }
        if (result.cancelled) break;
        lastError = result.error?.message || 'This stream could not be started.';
        // Fast fail - don't wait long
        if (playerStatus) playerStatus.textContent = `Failed ${sourceName} · ${quality}, trying next…`;
      } catch (error) {
        if (runId !== state.playbackRunId) break;
        lastError = error.message || 'This stream could not be prepared.';
      }
      // Small delay between attempts for speed, but not too much
      await new Promise(r => setTimeout(r, 200));
    }

    // If all attempts in current provider failed, try next provider automatically
    if (runId === state.playbackRunId) {
      if (playerStatus) playerStatus.textContent = `All ${attempts.length} streams failed in ${providerLabel(itemProvider(state.item))}, searching other sources…`;
      const foundNext = await tryNextProvider();
      if (foundNext) {
        // Recursively try the new provider's streams
        state.autoPlaybackActive = false;
        return playSelected();
      }
      const detail = lastError ? ` ${displayUiText(lastError)}` : '';
      showVideoError(`None of the ${attempts.length} available streams could be started.${detail} Tried other sources too.`);
      if (playerStatus) {
        playerStatus.textContent = `Tried all ${attempts.length} streams plus other sources. Try another title or source.`;
      }
    }
  } finally {
    if (runId === state.playbackRunId) state.autoPlaybackActive = false;
    if (button && (runId === state.playbackRunId || !state.autoPlaybackActive)) {
      button.disabled = !state.streamSetId || state.autoPlaybackActive;
      const span = button.querySelector('span');
      if (span) span.textContent = 'Play automatically';
    }
  }
}

function createPlaybackMonitor(signal) {
  let resolvePlayback;
  let settled = false;
  let timeoutId = 0;
  let stableTimeoutId = 0;
  const promise = new Promise((resolve) => { resolvePlayback = resolve; });

  const finish = (result) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeoutId);
    window.clearTimeout(stableTimeoutId);
    videoElement.removeEventListener('playing', onPlaying);
    videoElement.removeEventListener('canplay', onCanPlay);
    videoElement.removeEventListener('loadeddata', onLoadedData);
    videoElement.removeEventListener('error', onVideoError);
    videoElement.removeEventListener('stalled', onStalled);
    signal.removeEventListener('abort', onAbort);
    resolvePlayback(result);
  };

  const confirmStablePlayback = () => {
    // Wait a bit to ensure playback is stable and not immediately failing
    // This fixes "playing but still switching" issue
    stableTimeoutId = window.setTimeout(() => {
      if (videoElement.readyState >= 2 && !videoElement.paused) {
        finish({ played: true });
      } else {
        // If not really playing, wait for playing event
      }
    }, STABLE_PLAYBACK_MS);
  };

  const onPlaying = () => {
    // Video started playing, confirm stable after short delay
    window.clearTimeout(timeoutId);
    confirmStablePlayback();
  };

  const onCanPlay = () => {
    // Can play is also a good indicator, but wait for playing for stability
    if (videoElement.readyState >= 3) {
      // Have enough data
    }
  };

  const onLoadedData = () => {
    // Data loaded, but still need playing
  };

  const onStalled = () => {
    // Stalled is not necessarily fatal, don't fail immediately
  };

  const onVideoError = () => {
    const code = videoElement.error?.code;
    const message = videoElement.error?.message || '';
    // Fail fast on error
    finish({
      played: false,
      error: new Error(code ? `Playback error ${code}: ${message}`.trim() : 'The browser could not play this stream.'),
    });
  };
  const onAbort = () => finish({ played: false, cancelled: true });

  videoElement.addEventListener('playing', onPlaying);
  videoElement.addEventListener('canplay', onCanPlay);
  videoElement.addEventListener('loadeddata', onLoadedData);
  videoElement.addEventListener('error', onVideoError);
  videoElement.addEventListener('stalled', onStalled);
  signal.addEventListener('abort', onAbort);
  timeoutId = window.setTimeout(() => {
    // If video has some data but not playing, consider it as trying
    if (videoElement.readyState >= 2) {
      // Has data, wait a bit more for playing
      timeoutId = window.setTimeout(() => {
        finish({ played: false, error: new Error('The stream did not start playing before timeout.') });
      }, 2000);
    } else {
      finish({ played: false, error: new Error('The stream did not start before timeout.') });
    }
  }, STREAM_START_TIMEOUT_MS);
  if (signal.aborted) onAbort();

  return {
    promise,
    fail(error) {
      finish({ played: false, error: error instanceof Error ? error : new Error(String(error || 'Stream error')) });
    },
    cancel() {
      finish({ played: false, cancelled: true });
    },
  };
}

async function requestVideoPlayback(signal) {
  if (signal.aborted) throw new Error('Playback was cancelled.');
  try {
    await videoElement.play();
  } catch (error) {
    if (error?.name !== 'NotAllowedError' || signal.aborted) throw error;

    const wasMuted = videoElement.muted;
    videoElement.muted = true;
    const unmuteAfterStart = () => {
      if (!wasMuted) videoElement.muted = false;
    };
    videoElement.addEventListener('playing', unmuteAfterStart, { once: true });
    try {
      await videoElement.play();
    } catch (mutedError) {
      videoElement.removeEventListener('playing', unmuteAfterStart);
      videoElement.muted = wasMuted;
      throw mutedError;
    }
  }
}

function showVideoError(message) {
  const msgEl = $('#video-error-message');
  if (msgEl) msgEl.textContent = displayUiText(message || 'Check that the selected stream is available.');
  if (videoError) videoError.hidden = false;
}

async function closeActivePlayer() {
  if (state.activePlayer) {
    try { await state.activePlayer.destroy(); } catch { /* Player may already be disposed. */ }
    state.activePlayer = null;
  }
  if (videoElement) {
    videoElement.pause();
    videoElement.removeAttribute('src');
    videoElement.muted = false;
    videoElement.load();
  }
}

async function loadShaka() {
  if (!shakaModulePromise) {
    shakaModulePromise = import('shaka-player').then((module) => {
      const shaka = module.default || module;
      shaka.polyfill.installAll();
      return shaka;
    });
  }
  return shakaModulePromise;
}

async function openPlayer(playback, title, runId, quality, provider) {
  const playbackUrl = playback.playback_url || playback.url;
  if (!playbackUrl) return { played: false, error: new Error('The selected source did not return a playable link.') };

  const controller = new AbortController();
  state.playbackController = controller;
  const monitor = createPlaybackMonitor(controller.signal);
  const sourceName = provider ? providerLabel(provider) : displayUiText(playback.source_label || 'STREAM');
  const playerTitle = $('#player-page-title') || $('#player-title');
  const qEl = $('#player-page-quality') || $('#player-quality');
  const sEl = $('#player-page-source') || $('#player-source');
  if (playerTitle) playerTitle.textContent = displayUiText(playback.title || title);
  if (qEl) qEl.textContent = String(playback.quality || quality || 'AUTO').toUpperCase();
  if (sEl) sEl.textContent = sourceName;
  if (videoError) videoError.hidden = true;

  try {
    if (controller.signal.aborted || runId !== state.playbackRunId) {
      monitor.cancel();
    } else if (playback.stream_type === 'dash' || playback.stream_type === 'hls' || playbackUrl.includes('.mpd') || playbackUrl.includes('.m3u8')) {
      const shaka = await loadShaka();
      if (controller.signal.aborted || runId !== state.playbackRunId) {
        monitor.cancel();
      } else {
        const player = new shaka.Player();
        state.activePlayer = player;
        // Configure shaka for better audio/video handling
        player.configure({
          streaming: {
            bufferingGoal: 30,
            rebufferingGoal: 10,
            bufferBehind: 20,
            retryParameters: {
              maxAttempts: 3,
              baseDelay: 300,
              backoffFactor: 2,
            },
          },
          manifest: {
            dash: {
              ignoreMinBufferTime: true,
            },
            hls: {
              ignoreManifestProgramDateTime: true,
            },
          },
          abr: {
            enabled: true,
            defaultBandwidthEstimate: 2000000,
          },
        });

        let shakaErrorHandler = null;
        const cleanupShakaError = () => {
          if (shakaErrorHandler) {
            player.removeEventListener('error', shakaErrorHandler);
            shakaErrorHandler = null;
          }
        };

        // Wrap finish to also cleanup shaka listener
        const originalFinish = monitor.fail;
        // We'll handle shaka errors separately
        shakaErrorHandler = (event) => {
          const detail = event.detail;
          const isCritical = detail?.severity == null
            || detail.severity === shaka.util?.Error?.Severity?.CRITICAL
            || detail.severity === 2;
          // Only fail on critical errors, and only if not already playing stably
          if (isCritical) {
            // If video is already playing stably, don't fail - let it continue
            if (videoElement.readyState >= 3 && !videoElement.paused && videoElement.currentTime > 1) {
              console.warn('Shaka non-fatal error during stable playback:', detail?.message);
              return;
            }
            monitor.fail(new Error(detail?.message || `Stream error ${detail?.code || ''}`.trim()));
            cleanupShakaError();
          }
        };
        player.addEventListener('error', shakaErrorHandler);

        // Ensure cleanup when monitor settles
        monitor.promise.then(() => cleanupShakaError()).catch(() => cleanupShakaError());

        const setupPromise = (async () => {
          await player.attach(videoElement);
          if (controller.signal.aborted || runId !== state.playbackRunId) return;
          await player.load(playbackUrl);
        })();
        const setupResult = await Promise.race([
          setupPromise.then(() => ({ ready: true }), (error) => ({ error })),
          monitor.promise.then((result) => ({ result })),
        ]);
        if (setupResult.result) {
          // The stream failed, timed out, or was cancelled while Shaka was loading it.
        } else if (setupResult.error) {
          monitor.fail(setupResult.error);
        } else if (!controller.signal.aborted && runId === state.playbackRunId) {
          requestVideoPlayback(controller.signal).catch((error) => monitor.fail(error));
        }
      }
    } else {
      if (videoElement) {
        videoElement.src = playbackUrl;
        videoElement.load();
      }
      requestVideoPlayback(controller.signal).catch((error) => monitor.fail(error));
    }
  } catch (error) {
    monitor.fail(error);
  }

  const result = await monitor.promise;
  if (state.playbackController === controller) state.playbackController = null;
  if (!result.played) {
    controller.abort();
    await closeActivePlayer();
  }
  return result;
}

function syncProvider(provider) {
  state.provider = provider;
  if (providerSelect) providerSelect.value = provider;
  $$('.source-shortcut').forEach((button) => {
    const isSelected = button.dataset.provider === provider;
    button.classList.toggle('selected', isSelected);
    const oldCheck = $('.source-check', button);
    if (oldCheck) oldCheck.remove();
    if (isSelected) {
      const check = document.createElement('span');
      check.className = 'source-check';
      check.textContent = '✓';
      button.append(check);
    }
  });
}

// Event listeners
if (searchForm) {
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch(searchInput?.value || '');
  });
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    const clearButton = $('#clear-search');
    if (clearButton) clearButton.classList.toggle('visible', Boolean(searchInput.value));
    clearTimeout(searchTimer);
    state.requestNumber += 1;
    if (!searchInput.value.trim()) {
      navigate('/', true);
      loadDiscover();
      return;
    }
    searchTimer = window.setTimeout(() => runSearch(searchInput.value), 340);
  });
}

const clearSearchBtn = $('#clear-search');
if (clearSearchBtn) {
  clearSearchBtn.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    clearSearchBtn.classList.remove('visible');
    if (searchInput) searchInput.focus();
    navigate('/', true);
    loadDiscover();
  });
}

if (providerSelect) {
  providerSelect.addEventListener('change', () => {
    syncProvider(providerSelect.value);
    if (searchInput?.value.trim()) runSearch(searchInput.value);
    else if (state.provider === 'moviebox') loadDiscover();
    else setEmptyMessage('Search this source.', `Enter a title to search ${providerLabel(state.provider)}.`);
  });
}

$$('.source-shortcut').forEach((button) => {
  button.addEventListener('click', () => {
    syncProvider(button.dataset.provider);
    if (searchInput?.value.trim()) runSearch(searchInput.value);
    else if (state.provider === 'moviebox') loadDiscover();
    else setEmptyMessage('Search this source.', `Enter a title to search ${providerLabel(state.provider)}.`);
    const area = $('#search-area');
    if (area) area.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

$$('.quick-searches button').forEach((button) => {
  button.addEventListener('click', () => {
    if (searchInput) searchInput.value = button.dataset.query;
    const clearBtn = $('#clear-search');
    if (clearBtn) clearBtn.classList.add('visible');
    runSearch(button.dataset.query);
    if (searchInput) searchInput.focus();
  });
});

const retryBtn = $('#retry-button');
if (retryBtn) retryBtn.addEventListener('click', () => runSearch(searchInput?.value || ''));
const helpBtn = $('#help-button');
if (helpBtn) helpBtn.addEventListener('click', () => $('#help-dialog')?.showModal());
const sidebarMusic = $('#sidebar-music');
if (sidebarMusic) sidebarMusic.addEventListener('click', () => $('#music-dialog')?.showModal());
const musicBtn = $('#music-button');
if (musicBtn) musicBtn.addEventListener('click', () => $('#music-dialog')?.showModal());
const sidebarSearch = $('#sidebar-search');
if (sidebarSearch) sidebarSearch.addEventListener('click', (e) => {
  e.preventDefault();
  navigate('/', false);
  setTimeout(() => searchInput?.focus(), 100);
});

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (!close) return;
  if (close.dataset.close === 'details') {
    if (state.currentRoute === 'details') navigate('/', false);
    else detailsDialog?.close();
  }
  if (close.dataset.close === 'player') {
    if (state.currentRoute === 'player') {
      if (state.item) navigate(`/title/${encodeURIComponent(itemProvider(state.item))}/${encodeURIComponent(itemId(state.item))}`, false);
      else navigate('/', false);
    } else playerDialog?.close();
  }
  if (close.dataset.close === 'help') $('#help-dialog')?.close();
  if (close.dataset.close === 'music') $('#music-dialog')?.close();
  if (close.dataset.close === 'access') $('#access-dialog')?.close();
});

// Handle SPA navigation via data-nav
document.addEventListener('click', (event) => {
  const navLink = event.target.closest('a[data-nav]');
  if (!navLink) return;
  const href = navLink.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('http')) return;
  event.preventDefault();
  navigate(href, false);
});

for (const dialog of [detailsDialog, playerDialog, $('#help-dialog'), $('#music-dialog'), $('#access-dialog')]) {
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

const detailsBackBtn = $('#details-back-button');
if (detailsBackBtn) detailsBackBtn.addEventListener('click', () => navigate('/', false));
const playerBackBtn = $('#player-back-button');
if (playerBackBtn) playerBackBtn.addEventListener('click', () => {
  state.playbackRunId += 1;
  state.autoPlaybackActive = false;
  state.playbackController?.abort();
  state.playbackController = null;
  closeActivePlayer();
  if (state.item) navigate(`/title/${encodeURIComponent(itemProvider(state.item))}/${encodeURIComponent(itemId(state.item))}`, false);
  else navigate('/', false);
});

const videoRetryBtn = $('#video-retry-button');
if (videoRetryBtn) videoRetryBtn.addEventListener('click', async () => {
  const found = await tryNextProvider();
  if (found) {
    state.autoPlaybackActive = false;
    playSelected();
  } else {
    showVideoError('No more sources found. Try another title.');
  }
});

// Handle browser back/forward
window.addEventListener('popstate', () => {
  handleRoute();
});

window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (state.currentRoute !== 'home') navigate('/', false);
    setTimeout(() => {
      searchInput?.focus();
      searchInput?.select();
    }, 100);
  }
  if (event.key === 'Escape') {
    if (state.currentRoute === 'player') {
      state.playbackRunId += 1;
      state.autoPlaybackActive = false;
      state.playbackController?.abort();
      closeActivePlayer();
      if (state.item) navigate(`/title/${encodeURIComponent(itemProvider(state.item))}/${encodeURIComponent(itemId(state.item))}`, false);
      else navigate('/', false);
    } else if (state.currentRoute === 'details') {
      navigate('/', false);
    }
  }
});

// Initial load
checkEngine();
handleRoute();
