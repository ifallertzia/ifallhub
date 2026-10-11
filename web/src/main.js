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
  discoverItems: [],
  requestNumber: 0,
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
let searchTimer = 0;
let detailRequestNumber = 0;

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
  element.dataset.state = status;
  $('#engine-status-text').textContent = label;
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
  loadingState.hidden = !isLoading;
  errorState.hidden = true;
  emptyState.hidden = isLoading || state.results.length > 0;
  resultsGrid.hidden = isLoading || state.results.length === 0;
  resultCount.textContent = isLoading ? '' : resultCount.textContent;
}

function setError(title, message) {
  loadingState.hidden = true;
  emptyState.hidden = true;
  resultsGrid.hidden = true;
  errorState.hidden = false;
  $('#error-title').textContent = title;
  $('#error-message').textContent = message;
  resultCount.textContent = '';
}

function setEmptyMessage(title, message) {
  loadingState.hidden = true;
  errorState.hidden = true;
  resultsGrid.hidden = true;
  emptyState.hidden = false;
  emptyState.innerHTML = `
    <div class="empty-icon"><span></span><span></span><span></span></div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
  `;
  resultCount.textContent = '';
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

function renderCards(items) {
  state.results = Array.isArray(items) ? items : [];
  resultsGrid.innerHTML = '';
  errorState.hidden = true;
  loadingState.hidden = true;
  resultsGrid.hidden = state.results.length === 0;
  emptyState.hidden = state.results.length > 0;
  resultCount.textContent = state.results.length
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
            <span class="fallback-top">MOVIEBOX · ${escapeHtml(sourceName.toUpperCase())}</span>
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
  });
}

function providerLabel(provider) {
  return ({
    moviebox: 'MovieBox',
    fourkhdhub: '4KHDHub',
    dramachi: 'Dramachi',
    bdix_circleftp: 'CircleFTP',
    bdix_dhakaflix: 'DhakaFlix',
    addons: 'Add-ons',
  })[provider] || provider || 'Source';
}

function renderDiscover(items) {
  state.query = '';
  resultsKicker.textContent = 'PICKED FOR YOU';
  resultsTitle.textContent = "Tonight's possibilities";
  renderCards(items);
}

async function loadDiscover() {
  state.query = '';
  resultsKicker.textContent = 'PICKED FOR YOU';
  resultsTitle.textContent = "Tonight's possibilities";
  setLoading(true);
  try {
    const data = await api('/api/discover?provider=moviebox');
    state.discoverItems = data.items || [];
    renderDiscover(state.discoverItems);
  } catch (error) {
    state.results = [];
    setEmptyMessage('Every good story starts somewhere.', 'Search a title above, or pick a quick search to get started.');
    resultCount.textContent = '';
    if (error.message && !error.message.toLowerCase().includes('unknown')) {
      setEngineStatus('offline', 'Engine offline');
    }
  }
}

async function runSearch(value = searchInput.value) {
  const query = value.trim();
  clearTimeout(searchTimer);
  state.query = query;
  if (!query) {
    return loadDiscover();
  }
  resultsKicker.textContent = 'SEARCH RESULTS';
  resultsTitle.textContent = `Results for “${query}”`;
  setLoading(true);
  const request = ++state.requestNumber;
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
  detailsContent.innerHTML = `
    <button class="dialog-close" type="button" data-close="details" aria-label="Close details">×</button>
    <div class="details-loading"><div class="loading-spinner"></div><span>Loading details…</span></div>
  `;
}

async function openDetails(item) {
  state.item = item;
  state.details = null;
  state.releases = [];
  state.streamSetId = null;
  state.selectedRelease = 0;
  const request = ++detailRequestNumber;
  renderDetailsLoading();
  if (!detailsDialog.open) detailsDialog.showModal();

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
    renderDetails(details);
    loadStreams();
  } catch (error) {
    if (request !== detailRequestNumber) return;
    detailsContent.innerHTML = `
      <button class="dialog-close" type="button" data-close="details" aria-label="Close details">×</button>
      <div class="details-loading"><div class="error-mark">!</div><span>${escapeHtml(error.message || 'Could not load title details.')}</span></div>
    `;
  }
}

function seasonByNumber(details, number) {
  return (details?.seasons || []).find((season) => Number(season.number) === Number(number));
}

function renderDetails(details) {
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
    : `<div class="poster-fallback"><span class="fallback-top">MOVIEBOX WEB</span><div class="fallback-art"><span>${escapeHtml(title.slice(0, 1))}</span></div><span class="fallback-bottom">${escapeHtml(title)}</span></div>`;
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

  detailsContent.innerHTML = `
    <button class="dialog-close" type="button" data-close="details" aria-label="Close details">×</button>
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
        <div class="stream-note">Streams are resolved by your local MovieBox-Tui engine.</div>
        <button class="play-button" id="play-selected" type="button" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg><span>Play selected</span>
        </button>
      </div>
    </section>
  `;

  const coverImage = $('.detail-cover img', detailsContent);
  if (coverImage) {
    coverImage.addEventListener('error', () => {
      const hue = hashTitle(title);
      const fallback = document.createElement('div');
      fallback.className = 'poster-fallback';
      fallback.style.setProperty('--poster-glow', `hsla(${hue}, 64%, 57%, .55)`);
      fallback.innerHTML = `<span class="fallback-top">MOVIEBOX WEB</span><div class="fallback-art"><span>${escapeHtml(title.slice(0, 1))}</span></div><span class="fallback-bottom">${escapeHtml(title)}</span>`;
      coverImage.replaceWith(fallback);
    }, { once: true });
  }

  $('#season-select', detailsContent)?.addEventListener('change', (event) => {
    state.season = Number(event.target.value);
    const season = seasonByNumber(state.details, state.season);
    state.episode = Number(season?.episodes?.[0]?.number || 1);
    renderDetails(state.details);
    loadStreams();
  });
  $('#episode-select', detailsContent)?.addEventListener('change', (event) => {
    state.episode = Number(event.target.value);
    loadStreams();
  });
  $('#play-selected', detailsContent)?.addEventListener('click', playSelected);
}

async function loadStreams() {
  const list = $('#stream-list', detailsContent);
  const subtitle = $('#stream-subtitle', detailsContent);
  const playButton = $('#play-selected', detailsContent);
  if (!list || !state.item) return;

  state.streamSetId = null;
  state.releases = [];
  state.selectedRelease = 0;
  if (playButton) playButton.disabled = true;
  list.innerHTML = '<div class="detail-busy"><span class="loading-spinner"></span>Finding available streams…</div>';
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
    if (request !== detailRequestNumber || !detailsDialog.open) return;
    state.streamSetId = response.stream_set_id || null;
    state.releases = response.releases || response.streams || [];
    if (subtitle) {
      const total = state.releases.length;
      subtitle.textContent = total ? `${total} stream${total === 1 ? '' : 's'} found` : 'No streams found for this title.';
    }
    renderStreams();
  } catch (error) {
    if (request !== detailRequestNumber || !detailsDialog.open) return;
    if (subtitle) subtitle.textContent = 'The source could not be reached.';
    list.innerHTML = `<div class="stream-empty stream-error">${escapeHtml(error.message || 'Could not load streams.')}</div>`;
  }
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

function renderStreams() {
  const list = $('#stream-list', detailsContent);
  const playButton = $('#play-selected', detailsContent);
  if (!list) return;
  if (!state.releases.length) {
    list.innerHTML = '<div class="stream-empty">No playable streams are available. Try another provider or check your add-on setup.</div>';
    if (playButton) playButton.disabled = true;
    return;
  }

  list.innerHTML = state.releases.map((release, index) => {
    const quality = release.quality || 'AUTO';
    const mirror = release.mirrors?.[0];
    const source = mirror?.label || providerLabel(release.provider || state.provider);
    const fields = [release.codec, release.language, prettySize(release.size_bytes)].filter(Boolean);
    return `
      <button class="stream-option ${index === state.selectedRelease ? 'selected' : ''}" type="button" data-release-index="${index}">
        <span class="stream-quality">${escapeHtml(quality)}</span>
        <span class="stream-main">
          <span class="stream-name" title="${escapeHtml(release.filename || 'Stream')}">${escapeHtml(release.filename || 'Stream')}</span>
          <span class="stream-sub">${fields.map(escapeHtml).join('<span>·</span>') || 'Ready to play'}</span>
        </span>
        <span class="stream-source" title="${escapeHtml(source)}">${escapeHtml(source)}</span>
        <span class="stream-check">${index === state.selectedRelease ? '✓' : ''}</span>
      </button>
    `;
  }).join('');

  $$('.stream-option', list).forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedRelease = Number(button.dataset.releaseIndex);
      renderStreams();
    });
  });
  if (playButton) playButton.disabled = !state.streamSetId;
}

async function playSelected() {
  const selected = state.releases[state.selectedRelease];
  if (!selected || !state.streamSetId) return;
  const button = $('#play-selected', detailsContent);
  if (button) {
    button.disabled = true;
    button.querySelector('span').textContent = 'Preparing…';
  }

  try {
    const playback = await api('/api/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stream_set_id: state.streamSetId,
        release_index: state.selectedRelease,
        mirror_index: 0,
      }),
    });
    await openPlayer(playback, state.details?.title || state.item?.title || 'Now playing');
  } catch (error) {
    const list = $('#stream-list', detailsContent);
    if (list) list.insertAdjacentHTML('afterbegin', `<div class="stream-empty stream-error">${escapeHtml(error.message || 'Could not prepare this stream.')}</div>`);
  } finally {
    if (button) {
      button.disabled = !state.streamSetId;
      button.querySelector('span').textContent = 'Play selected';
    }
  }
}

function showVideoError(message) {
  $('#video-error-message').textContent = message || 'Check that the selected stream is available.';
  videoError.hidden = false;
}

async function closeActivePlayer() {
  if (state.activePlayer) {
    try { await state.activePlayer.destroy(); } catch { /* Player may already be disposed. */ }
    state.activePlayer = null;
  }
  videoElement.pause();
  videoElement.removeAttribute('src');
  videoElement.load();
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

async function openPlayer(playback, title) {
  await closeActivePlayer();
  const playbackUrl = playback.playback_url || playback.url;
  if (!playbackUrl) throw new Error('The selected source did not return a playable link.');

  $('#player-title').textContent = playback.title || title;
  $('#player-quality').textContent = (playback.quality || 'AUTO').toUpperCase();
  $('#player-source').textContent = playback.source_label || 'STREAM';
  videoError.hidden = true;
  if (!playerDialog.open) playerDialog.showModal();

  if (playback.stream_type === 'dash' || playback.stream_type === 'hls') {
    try {
      const shaka = await loadShaka();
      const player = new shaka.Player();
      state.activePlayer = player;
      await player.attach(videoElement);
      player.addEventListener('error', (event) => {
        const detail = event.detail;
        showVideoError(detail?.message || `Stream error ${detail?.code || ''}`.trim());
      });
      await player.load(playbackUrl);
    } catch (error) {
      showVideoError(error.message || 'This browser could not load the selected stream.');
    }
  } else {
    videoElement.src = playbackUrl;
    videoElement.load();
    videoElement.addEventListener('error', () => {
      if (videoElement.error) showVideoError('The browser could not decode this file or the stream is unavailable.');
    }, { once: true });
  }
}

function syncProvider(provider) {
  state.provider = provider;
  providerSelect.value = provider;
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

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});

searchInput.addEventListener('input', () => {
  const clearButton = $('#clear-search');
  clearButton.classList.toggle('visible', Boolean(searchInput.value));
  clearTimeout(searchTimer);
  state.requestNumber += 1;
  if (!searchInput.value.trim()) {
    loadDiscover();
    return;
  }
  searchTimer = window.setTimeout(() => runSearch(searchInput.value), 340);
});

$('#clear-search').addEventListener('click', () => {
  searchInput.value = '';
  $('#clear-search').classList.remove('visible');
  searchInput.focus();
  loadDiscover();
});

providerSelect.addEventListener('change', () => {
  syncProvider(providerSelect.value);
  if (searchInput.value.trim()) runSearch(searchInput.value);
  else if (state.provider === 'moviebox') loadDiscover();
  else setEmptyMessage('Search this source.', `Enter a title to search ${providerLabel(state.provider)}.`);
});

$$('.source-shortcut').forEach((button) => {
  button.addEventListener('click', () => {
    syncProvider(button.dataset.provider);
    if (searchInput.value.trim()) runSearch(searchInput.value);
    else if (state.provider === 'moviebox') loadDiscover();
    else setEmptyMessage('Search this source.', `Enter a title to search ${providerLabel(state.provider)}.`);
    $('#search-area').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

$$('.quick-searches button').forEach((button) => {
  button.addEventListener('click', () => {
    searchInput.value = button.dataset.query;
    $('#clear-search').classList.add('visible');
    runSearch(button.dataset.query);
    searchInput.focus();
  });
});

$('#retry-button').addEventListener('click', () => runSearch(searchInput.value));
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#sidebar-search').addEventListener('click', () => setTimeout(() => searchInput.focus(), 10));

document.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close]');
  if (!close) return;
  if (close.dataset.close === 'details') detailsDialog.close();
  if (close.dataset.close === 'player') playerDialog.close();
  if (close.dataset.close === 'help') $('#help-dialog').close();
  if (close.dataset.close === 'access') $('#access-dialog')?.close();
});

for (const dialog of [detailsDialog, playerDialog, $('#help-dialog'), $('#access-dialog')]) {
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

playerDialog.addEventListener('close', () => { closeActivePlayer(); });
detailsDialog.addEventListener('close', () => { detailRequestNumber += 1; });

window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});

checkEngine();
loadDiscover();
