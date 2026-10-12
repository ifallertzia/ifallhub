// Watch page: player, server rotation, resume, progress tracking, episode
// auto-advance and a "More like this" rail under the player.

import * as api from '../lib/api.js';
import * as library from '../lib/library.js';
import { cardHtml, rowHtml, spinnerHtml } from '../ui/components.js';
import {
  SERVER_ROTATION,
  displayUiText,
  escapeHtml,
  formatRuntime,
  normaliseRating,
  providerLabel,
} from '../lib/format.js';
import { rankRelated, similarByMeta } from '../lib/recommend.js';
import { app, cardMeta, ensureMeta, rememberGenres } from '../state.js';
import { navigate, titlePath, watchPath } from '../lib/router.js';
import {
  STATUS_LABELS,
  autoPlay,
  buildAttempts,
  closeActivePlayer,
  downloadRelease,
  openStream,
  rotationAfter,
  unsupportedReason,
} from '../player/engine.js';

const CODEC_HINT =
  'Ye link H.265/HEVC ya .mkv me hai — browser ise play nahi kar sakta (mpv/VLC me chalega). Neeche koi doosra release chuno ya TUI use karo.';

const state = {
  provider: 'moviebox',
  id: '',
  title: 'Now playing',
  details: null,
  season: 0,
  episode: 0,
  isSeries: false,
  entry: null,
  cache: {},
  order: [],
  status: {},
  current: null,
  controller: null,
  player: null,
  runId: 0,
  selected: 0,
  quality: 'AUTO',
  source: '',
  resumeAt: 0,
  progressTimer: 0,
  autoplayNext: true,
};

export async function renderWatch(container, route) {
  stop();
  state.provider = route.params.provider;
  state.id = route.params.id;
  state.season = Number(route.query.get('s') || 0);
  state.episode = Number(route.query.get('e') || 0);
  state.cache = {};
  state.status = {};
  state.entry = null;
  state.selected = 0;
  state.resumeAt = 0;

  container.innerHTML = `
    <div class="page-shell watch" data-view="watch">
      <header class="watch-topbar">
        <button class="ghost-button" type="button" data-back>← Back</button>
        <div class="watch-heading">
          <p class="kicker">NOW PLAYING</p>
          <h1 id="watch-title">Preparing stream…</h1>
        </div>
        <div class="watch-badges">
          <span class="badge" id="watch-quality">AUTO</span>
          <span class="badge" id="watch-source">SOURCE</span>
        </div>
      </header>

      <div class="player-stage">
        <div class="video-frame">
          <video id="video" controls playsinline preload="metadata" aria-label="Playback"></video>
          <div class="video-overlay" id="video-overlay" hidden>
            <div class="overlay-mark">!</div>
            <h3>Playback couldn't start</h3>
            <p id="video-message">Check that the selected stream is available.</p>
            <button class="primary-button" type="button" data-retry-server>Try next server ↻</button>
          </div>
        </div>
      </div>

      <div class="watch-statusbar">
        <p class="watch-status" id="watch-status" role="status" aria-live="polite">Finding a working link…</p>
        <div class="server-rotation" id="server-rotation" aria-label="Server order"></div>
      </div>

      <section class="watch-controls">
        <div class="watch-title-block">
          <h2 id="watch-details-title">Loading details…</h2>
          <p class="muted" id="watch-details-meta"></p>
          <div class="watch-actions">
            <button class="ghost-button" type="button" data-watchlist>＋ My List</button>
            <label class="switch"><input type="checkbox" id="autoplay-next" checked /><span>Auto-play next episode</span></label>
          </div>
        </div>
        <div class="stream-list" id="watch-streams">${spinnerHtml('Collecting links…')}</div>
      </section>

      <section class="related-panel" id="watch-related">
        ${rowHtml({ key: 'watch-related', title: 'More like this', hint: 'Iske jaisi aur titles', itemsHtml: '<div class="loading-state"><span class="spinner"></span><span>Loading…</span></div>' })}
      </section>
    </div>`;

  bind(container);
  await loadDetails();
  await startRotation();
}

function bind(container) {
  container.querySelector('[data-back]')?.addEventListener('click', () => {
    navigate(titlePath(state.provider, state.id));
  });
  container.querySelector('[data-retry-server]')?.addEventListener('click', () => {
    hideOverlay();
    startRotation({ startAfter: state.current || undefined });
  });
  const watchlistButton = container.querySelector('[data-watchlist]');
  watchlistButton?.addEventListener('click', async () => {
    const listed = await library.toggleWatchlist({
      provider: state.provider,
      id: state.id,
      title: state.details?.title || state.title,
      poster_url: state.details?.poster_url || null,
      year: state.details?.year || null,
      media_type: state.details?.media_type || 'movie',
      official_rating: normaliseRating(state.details?.imdb_rating),
    });
    watchlistButton.textContent = listed ? '✓ In My List' : '＋ My List';
    document.dispatchEvent(new CustomEvent('ifallhub:library-changed'));
  });
  container.querySelector('#autoplay-next')?.addEventListener('change', (event) => {
    state.autoplayNext = event.target.checked;
  });

  const video = container.querySelector('#video');
  video?.addEventListener('timeupdate', () => trackProgress(video));
  video?.addEventListener('ended', () => onEnded(video));
  video?.addEventListener('play', () => {
    if (state.resumeAt > 5 && video.currentTime < 2) {
      video.currentTime = state.resumeAt;
      state.resumeAt = 0;
    }
  });
}

async function loadDetails() {
  try {
    const details = await api.details({ provider: state.provider, id: state.id });
    state.details = details;
    app.details = details;
    rememberGenres(details);
    state.title = details.title || state.id;
    state.isSeries = details.media_type === 'series' || (details.seasons || []).length > 0;
    if (state.isSeries && !state.season) {
      state.season = Number(details.seasons?.[0]?.number || 1);
      state.episode = Number(details.seasons?.[0]?.episodes?.[0]?.number || 1);
    }
    const heading = document.querySelector('#watch-details-title');
    if (heading) {
      heading.textContent = state.isSeries
        ? `${state.title} · S${state.season} E${state.episode || 1}`
        : state.title;
    }
    const meta = document.querySelector('#watch-details-meta');
    if (meta) {
      const bits = [details.year, details.duration ? formatRuntime(details.duration) : '', (details.genres || []).slice(0, 3).join(' · ')]
        .filter(Boolean)
        .map((bit) => escapeHtml(String(bit)));
      meta.innerHTML = bits.join('<span class="dot"></span>');
    }
    const watchlistButton = document.querySelector('[data-watchlist]');
    if (watchlistButton) {
      const listed = library.isInWatchlist(state.provider, state.id);
      watchlistButton.textContent = listed ? '✓ In My List' : '＋ My List';
    }
    const progress = library.progressFor(state.provider, state.id);
    if (progress && Number(progress.position_seconds) > 5 && !progress.completed) {
      const sameEpisode = !state.isSeries || (Number(progress.season) === Number(state.season) && Number(progress.episode) === Number(state.episode));
      if (sameEpisode) state.resumeAt = Number(progress.position_seconds) || 0;
    }
    loadRelated();
  } catch {
    const heading = document.querySelector('#watch-details-title');
    if (heading) heading.textContent = state.title;
    loadRelated();
  }
}

async function loadRelated() {
  const panel = document.querySelector('#watch-related');
  if (!panel) return;
  let items = [];
  let reasons = {};
  try {
    const payload = await api.related({ provider: state.provider, id: state.id, limit: 18 });
    items = payload.items || [];
    reasons = payload.reasons || {};
  } catch {
    /* Fall back to the client-side matcher below. */
  }
  if (!items.length && state.details) {
    items = similarByMeta(state.details, app.pool, { limit: 18 }).map((entry) => entry.item);
  }
  if (!items.length) {
    panel.innerHTML = rowHtml({ key: 'watch-related', title: 'More like this', itemsHtml: '<p class="muted">No similar titles yet.</p>' });
    return;
  }
  const ranked = rankRelated(items, {
    reasons,
    ratings: Object.fromEntries(library.state.ratings.map((entry) => [entry.id, { rating: entry.rating }])),
    watchlist: library.state.watchlist,
    progress: library.state.progress,
    limit: 18,
  });
  panel.innerHTML = rowHtml({
    key: 'watch-related',
    title: 'More like this',
    hint: 'Player ke niche — iske jaisi aur titles',
    count: `${ranked.length}`,
    itemsHtml: ranked
      .map((entry) => cardHtml(entry.item, { ...cardMeta(entry.item, { provider: state.provider }), reason: entry.reasons[0] || '' }))
      .join(''),
  });
  panel.querySelectorAll('[data-scroll]').forEach((button) => {
    button.addEventListener('click', () => {
      const track = button.closest('[data-rail]').querySelector('[data-track]');
      track.scrollBy({ left: Number(button.dataset.scroll) * Math.max(320, track.clientWidth * 0.8), behavior: 'smooth' });
    });
  });
  ensureMeta(ranked.map((entry) => entry.item), { provider: state.provider });
}

// --- Rotation --------------------------------------------------------------

async function startRotation({ startAfter, startRelease = 0 } = {}) {
  const video = document.querySelector('#video');
  if (!video) return;
  stop({ keepUi: true });

  const runId = ++state.runId;
  const controller = new AbortController();
  state.controller = controller;
  state.order = startAfter ? rotationAfter(startAfter) : [...SERVER_ROTATION];
  state.status = {};
  paintRotation();
  hideOverlay();
  setStatus(`Checking ${providerLabel(state.order[0])} first…`, true);

  const result = await autoPlay({
    item: { id: { provider: state.provider, value: state.id }, title: state.title },
    title: state.title,
    order: state.order,
    season: state.season,
    episode: state.episode,
    isSeries: state.isSeries,
    cache: state.cache,
    startRelease,
    video,
    signal: controller.signal,
    hooks: {
      onStatus: setStatus,
      onServerStatus: (provider, status) => {
        state.status[provider] = status;
        paintRotation();
      },
      onHeader: (title, quality, source) => {
        setHeader(title, quality, source);
      },
      onEntry: (entry) => {
        state.entry = entry;
        state.current = entry.provider;
        paintStreams();
      },
      onSelect: (entry, index) => {
        state.selected = index;
        paintStreams();
      },
      onStreams: (entry, index) => {
        state.entry = entry;
        state.selected = index;
        state.current = entry.provider;
        paintStreams();
      },
      onTrack: (player) => {
        state.player = player;
      },
      onPlaying: ({ provider, release }) => {
        state.quality = String(release.quality || 'AUTO').toUpperCase();
        state.source = providerLabel(provider);
        markWatchStarted();
      },
      currentPlayer: () => state.player,
    },
  });

  if (runId !== state.runId) return;
  if (!result.played && !result.cancelled) {
    showOverlay(
      `No server could start this title (${state.order.map(providerLabel).join(' → ')}).${result.error ? ` Last error: ${displayUiText(result.error)}` : ''}${result.codecSeen ? ` ${CODEC_HINT}` : ''}`,
    );
    setStatus('No link could start. Try the next server or download a link below.', false);
  }
}

async function playManual(releaseIndex) {
  const video = document.querySelector('#video');
  if (!video || !state.entry) return;
  stop({ keepUi: true });
  const runId = ++state.runId;
  const controller = new AbortController();
  state.controller = controller;
  state.selected = releaseIndex;
  paintStreams();
  hideOverlay();
  const release = state.entry.releases[releaseIndex];
  setHeader(displayUiText(release.filename || state.title), String(release.quality || 'AUTO').toUpperCase(), providerLabel(state.entry.provider));
  setStatus(`Starting ${providerLabel(state.entry.provider)} · ${release.quality || 'AUTO'}…`, true);

  const attempts = buildAttempts(state.entry.releases, releaseIndex);
  let lastFailure = null;
  for (const attempt of attempts) {
    if (controller.signal.aborted || runId !== state.runId) return;
    const target = state.entry.releases[attempt.releaseIndex];
    state.selected = attempt.releaseIndex;
    paintStreams();
    try {
      const playback = await api.play(
        { streamSetId: state.entry.streamSetId, releaseIndex: target.serverIndex ?? attempt.releaseIndex, mirrorIndex: attempt.mirrorIndex },
        { signal: controller.signal },
      );
      const result = await openStream({
        playback,
        video,
        signal: controller.signal,
        onTrack: (player) => {
          state.player = player;
        },
      });
      if (result.played) {
        state.quality = String(target.quality || 'AUTO').toUpperCase();
        state.source = providerLabel(state.entry.provider);
        setHeader(displayUiText(target.filename || state.title), state.quality, state.source);
        setStatus(`Now playing on ${state.source} · ${state.quality}.`, false);
        state.status[state.entry.provider] = 'playing';
        paintRotation();
        markWatchStarted();
        return;
      }
      if (result.cancelled) return;
      lastFailure = result.error || null;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      lastFailure = error;
    }
  }
  showOverlay(
    `This link could not be started.${lastFailure ? ` ${displayUiText(lastFailure.message)}` : ''} Try another link or the next server.${lastFailure?.kind === 'codec' ? ` ${CODEC_HINT}` : ''}`,
  );
}

// --- Progress tracking -----------------------------------------------------

function markWatchStarted() {
  document.querySelector('#watch-quality').textContent = state.quality;
  document.querySelector('#watch-source').textContent = state.source;
  saveProgress();
  window.clearInterval(state.progressTimer);
  state.progressTimer = window.setInterval(() => saveProgress(), 15000);
}

async function saveProgress({ completed = false } = {}) {
  const video = document.querySelector('#video');
  if (!video) return;
  const position = Math.floor(video.currentTime || 0);
  const duration = Math.floor(video.duration || 0) || Math.floor(state.durationSeconds || 0) || null;
  if (!completed && position < 5) return;
  await library.updateProgress({
    provider: state.provider,
    id: state.id,
    title: state.details?.title || state.title,
    poster_url: state.details?.poster_url || null,
    year: state.details?.year || null,
    media_type: state.isSeries ? 'series' : 'movie',
    season: state.season,
    episode: state.episode,
    position_seconds: completed && duration ? duration : position,
    duration_seconds: duration,
    completed: completed || (duration > 0 && position / duration > 0.97),
  });
  document.dispatchEvent(new CustomEvent('ifallhub:library-changed'));
}

function trackProgress(video) {
  if (video.currentTime > 5 && !state.progressTimer) markWatchStarted();
}

async function onEnded(video) {
  await saveProgress({ completed: true });
  if (!state.autoplayNext || !state.isSeries) return;
  const next = nextEpisode();
  if (!next) return;
  navigate(watchPath(state.provider, state.id, { season: next.season, episode: next.episode }));
}

function nextEpisode() {
  const seasons = state.details?.seasons || [];
  const season = seasons.find((entry) => Number(entry.number) === Number(state.season));
  const episodes = season?.episodes || [];
  const index = episodes.findIndex((entry) => Number(entry.number) === Number(state.episode));
  if (index >= 0 && index < episodes.length - 1) {
    return { season: Number(state.season), episode: Number(episodes[index + 1].number) };
  }
  const seasonIndex = seasons.findIndex((entry) => Number(entry.number) === Number(state.season));
  const nextSeason = seasons[seasonIndex + 1];
  if (nextSeason?.episodes?.length) {
    return { season: Number(nextSeason.number), episode: Number(nextSeason.episodes[0].number) };
  }
  return null;
}

// --- UI helpers ------------------------------------------------------------

function setStatus(text, busy = false) {
  const element = document.querySelector('#watch-status');
  if (element) element.textContent = displayUiText(text);
  document.querySelector('.watch-statusbar')?.classList.toggle('is-busy', busy);
}

function setHeader(title, quality, source) {
  const heading = document.querySelector('#watch-title');
  if (heading) heading.textContent = displayUiText(title);
  const qualityEl = document.querySelector('#watch-quality');
  if (qualityEl) qualityEl.textContent = String(quality || 'AUTO').toUpperCase();
  const sourceEl = document.querySelector('#watch-source');
  if (sourceEl) sourceEl.textContent = source || '';
}

function paintRotation() {
  const bar = document.querySelector('#server-rotation');
  if (!bar) return;
  bar.innerHTML = state.order
    .map((provider, index) => {
      const status = state.status[provider] || 'idle';
      const arrow = index < state.order.length - 1 ? '<span class="server-arrow">→</span>' : '';
      return `<span class="server-chip is-${status}">
          <span class="server-step">${index + 1}</span>
          <span class="server-name">${escapeHtml(providerLabel(provider))}</span>
          <span class="server-state">${escapeHtml(STATUS_LABELS[status] || status)}</span>
        </span>${arrow}`;
    })
    .join('');
}

function paintStreams() {
  const list = document.querySelector('#watch-streams');
  if (!list) return;
  if (!state.entry?.releases?.length) {
    list.innerHTML = '<p class="muted">No links on this source yet.</p>';
    return;
  }
  list.innerHTML = state.entry.releases
    .map((release, index) => {
      const mirrors = release.mirrors?.length ? release.mirrors : [{ label: '' }];
      const reason = unsupportedReason(release);
      const warning = reason
        ? ` <span class="stream-warning" title="Browser ise decode nahi kar sakta; download ya mpv/VLC me chalega.">⚠ ${reason === 'container' ? 'container browser me nahi' : 'H.265 browser me nahi'}</span>`
        : '';
      return `
        <div class="stream-row ${index === state.selected ? 'is-active' : ''}">
          <button class="stream-option" type="button" data-play-release="${index}">
            <span class="stream-quality">${escapeHtml(String(release.quality || 'AUTO'))}</span>
            <span class="stream-main">
              <span class="stream-name">${escapeHtml(displayUiText(release.filename || 'Stream'))}</span>
              <span class="stream-sub">${escapeHtml(providerLabel(release.provider))}${release.codec ? ` · ${escapeHtml(release.codec)}` : ''}${warning}</span>
            </span>
            <span class="stream-check">${index === state.selected ? '✓' : ''}</span>
          </button>
          <div class="stream-downloads">
            ${mirrors
              .map(
                (mirror, mirrorIndex) =>
                  `<button class="ghost-button small" type="button" data-download="${index}" data-mirror="${mirrorIndex}">↓ ${escapeHtml(mirrors.length > 1 ? mirror.label || `Link ${mirrorIndex + 1}` : 'Download')}</button>`,
              )
              .join('')}
          </div>
        </div>`;
    })
    .join('');

  list.querySelectorAll('[data-play-release]').forEach((button) => {
    button.addEventListener('click', () => playManual(Number(button.dataset.playRelease)));
  });
  list.querySelectorAll('[data-download]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const filename = await downloadRelease({
          entry: state.entry,
          releaseIndex: Number(button.dataset.download),
          mirrorIndex: Number(button.dataset.mirror || 0),
        });
        setStatus(`Download started: ${filename}`, false);
      } catch (error) {
        setStatus(error?.message || 'Download could not start.', false);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function showOverlay(message) {
  const overlay = document.querySelector('#video-overlay');
  const text = document.querySelector('#video-message');
  if (text) text.textContent = displayUiText(message);
  if (overlay) overlay.hidden = false;
}

function hideOverlay() {
  const overlay = document.querySelector('#video-overlay');
  if (overlay) overlay.hidden = true;
}

async function stop({ keepUi = false } = {}) {
  state.runId += 1;
  state.controller?.abort();
  state.controller = null;
  window.clearInterval(state.progressTimer);
  state.progressTimer = 0;
  const video = document.querySelector('#video');
  if (video && video.currentTime > 5) await saveProgress();
  state.player = await closeActivePlayer(video, state.player);
  if (!keepUi) state.entry = null;
}

export function stopPlayback() {
  return stop();
}
