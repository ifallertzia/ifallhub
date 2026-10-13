// Watch page: player, server rotation, resume, progress tracking, episode
// auto-advance and a "More like this" rail under the player.

import * as api from '../lib/api.js';
import * as library from '../lib/library.js';
import { appendPlaybackLink } from '../ui/playback-links.js';
import {
  setCurrentPlayback,
  clearCurrentPlayback,
  createVlcButton,
  describeOpenResult,
  showVlcToast,
} from '../ui/vlc-button.js';
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
import { subtitleLanguageTag, subtitleToVtt } from '../player/subtitles.js';
import { mountPlayerOverlay } from '../player/overlay.js';
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
import { isH265Url } from '../player/ffmpeg-player.js';
import { isLibde265Available } from '../player/libde265-player.js';

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
  playingTitle: '',
  playerControls: null,
  resumeAt: 0,
  progressTimer: 0,
  autoplayNext: true,
  subtitleSearchController: null,
  subtitleSetId: '',
  subtitleOptions: [],
  selectedSubtitleIndex: null,
  subtitleText: '',
  subtitleLoadId: 0,
  subtitleObjectUrl: '',
  subtitleTrack: null,
  subtitleNode: null,
};

export async function renderWatch(container, route) {
  await stop();
  state.provider = route.params.provider;
  state.id = route.params.id;
  state.title = 'Now playing';
  state.playingTitle = '';
  state.quality = 'AUTO';
  state.source = '';
  state.details = null;
  state.isSeries = false;
  state.season = Number(route.query.get('s') || 0);
  state.episode = Number(route.query.get('e') || 0);
  state.cache = {};
  state.status = {};
  state.entry = null;
  state.selected = 0;
  state.resumeAt = 0;
  state.subtitleSearchController?.abort();
  state.subtitleSearchController = null;
  state.subtitleSetId = '';
  state.subtitleOptions = [];
  state.selectedSubtitleIndex = null;
  state.subtitleText = '';
  state.subtitleLoadId += 1;

  container.innerHTML = `
    <div class="page-shell watch" data-view="watch">
      <div class="player-stage">
        <div class="video-frame" id="player-frame" data-orientation="landscape">
          <video id="video" playsinline preload="metadata" aria-label="Video playback"></video>
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

      <!-- Playback links panel - Hidden from UI but functionality kept for VLC button -->
      <div id="watch-playback-links" hidden aria-hidden="true">
        <p class="muted" data-links-empty>No playback links resolved yet.</p>
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
  const frame = container.querySelector('#player-frame');
  const video = container.querySelector('#video');
  
  // Add VLC button to player frame
  addVlcButtonToPlayer(container);
  
  state.playerControls = mountPlayerOverlay({
    frame,
    video,
    getPlayer: () => state.player,
    getTitle: () => state.playingTitle || state.title,
    getQuality: () => state.quality,
    getDecoder: () => state.entry?.releases?.[state.selected]?.codec || 'AUTO',
    getSource: () => state.source,
    getReleases: () => state.entry?.releases || [],
    getSelectedRelease: () => state.selected,
    getSubtitleOptions: () => state.subtitleOptions,
    getSelectedSubtitle: () => state.selectedSubtitleIndex,
    getChapters: () => state.details?.chapters || [],
    getCanPrevious: () => Boolean(previousEpisode()),
    getCanNext: () => Boolean(nextEpisode()),
    onBack: () => navigate(titlePath(state.provider, state.id)),
    onPrevious: () => {
      const previous = previousEpisode();
      if (previous) navigate(watchPath(state.provider, state.id, previous));
    },
    onNext: () => {
      const next = nextEpisode();
      if (next) navigate(watchPath(state.provider, state.id, next));
    },
    onSearchSubtitles: (button) => searchSubtitles(button),
    onSelectSubtitle: (value) => chooseSubtitle(value),
    onSelectRelease: (index) => playManual(index),
    onStatus: (message) => setStatus(message, false),
  });
  await loadDetails();
  await startRotation();
}

/**
 * Add the "Open in VLC" button to the player UI. Clicking it asks the engine to
 * start a local player on the stream the page is playing; when this deployment
 * has no local player the engine copies the playback link instead.
 */
function addVlcButtonToPlayer(container) {
  // Remove any existing VLC button
  const existingButton = container.querySelector('.vlc-button-container');
  if (existingButton) {
    existingButton.remove();
  }
  
  // Create VLC button
  const vlcButton = createVlcButton({
    className: 'ghost-button',
    target: () => ({
      streamSetId: state.entry?.streamSetId || '',
      releaseIndex: state.entry?.releases?.[state.selected]?.serverIndex ?? 0,
      mirrorIndex: 0,
      resumeSeconds: Math.max(0, Math.round(state.resumeAt || 0)),
    }),
    onResult: (result) => {
      const summary = describeOpenResult(result);
      showVlcToast(summary.message, summary.kind);
    },
  });
  
  // Find the player controls area to add the button
  const playerFrame = container.querySelector('#player-frame');
  
  if (playerFrame && !container.querySelector('.vlc-button-container')) {
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'vlc-button-container';
    buttonContainer.appendChild(vlcButton);
    
    // Add to player frame
    playerFrame.appendChild(buttonContainer);
    
    // Store reference
    state.vlcButton = vlcButton;
  }
}


function bind(container) {
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

function setSubtitleStatus(message) {
  const status = document.querySelector('#subtitle-status');
  if (status) status.textContent = message;
}

function subtitleOption(index) {
  return state.subtitleOptions.find((option) => Number(option.index) === Number(index));
}

async function searchSubtitles(button) {
  const title = state.details?.title || state.title;
  if (!title || title === 'Now playing') {
    setSubtitleStatus('This title could not be identified for subtitle search.');
    return;
  }

  state.subtitleSearchController?.abort();
  state.subtitleLoadId += 1;
  if (state.selectedSubtitleIndex !== null && !state.subtitleText) {
    state.selectedSubtitleIndex = null;
    const select = document.querySelector('#subtitle-language');
    if (select) select.value = '';
  }
  const controller = new AbortController();
  state.subtitleSearchController = controller;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Searching…';
  setSubtitleStatus(`Searching online captions for ${title}…`);

  try {
    const payload = await api.subtitles({
      title,
      year: state.details?.year || '',
      season: state.isSeries ? state.season : 0,
      episode: state.isSeries ? state.episode : 0,
    }, { signal: controller.signal });
    if (controller.signal.aborted || state.subtitleSearchController !== controller) return;

    clearActiveSubtitle();
    state.subtitleLoadId += 1;
    state.subtitleSetId = payload.subtitle_set_id || '';
    state.subtitleOptions = (payload.subtitles || []).map((option, order) => ({
      index: Number.isInteger(Number(option.index)) ? Number(option.index) : order,
      name: String(option.name || 'Unknown'),
    }));
    state.selectedSubtitleIndex = null;
    state.subtitleText = '';

    const select = document.querySelector('#subtitle-language');
    if (select) {
      select.replaceChildren(new Option('Subtitles off', ''));
      for (const option of state.subtitleOptions) {
        select.add(new Option(option.name, String(option.index)));
      }
      select.value = '';
      select.disabled = !state.subtitleSetId || state.subtitleOptions.length === 0;
    }

    if (!state.subtitleSetId || state.subtitleOptions.length === 0) {
      setSubtitleStatus('No online subtitles were found for this title or episode. Playback will continue without captions.');
    } else {
      setSubtitleStatus(`${state.subtitleOptions.length} subtitle language${state.subtitleOptions.length === 1 ? '' : 's'} found. Choose one to turn captions on.`);
    }
  } catch (error) {
    if (error?.name !== 'AbortError' && state.subtitleSearchController === controller) {
      setSubtitleStatus('Online subtitle search is unavailable right now. Playback will continue without captions.');
    }
  } finally {
    if (state.subtitleSearchController === controller) {
      state.subtitleSearchController = null;
      button.disabled = false;
      button.textContent = originalLabel || 'CC Find subtitles';
    }
  }
}

async function chooseSubtitle(value) {
  if (!value) {
    state.subtitleLoadId += 1;
    state.selectedSubtitleIndex = null;
    state.subtitleText = '';
    clearActiveSubtitle();
    setSubtitleStatus('Subtitles off.');
    return;
  }

  const index = Number(value);
  const option = subtitleOption(index);
  if (!option || !state.subtitleSetId) return;
  const loadId = ++state.subtitleLoadId;
  state.selectedSubtitleIndex = index;
  state.subtitleText = '';
  clearActiveSubtitle();
  setSubtitleStatus(`Loading ${option.name} subtitles…`);

  try {
    const payload = await api.subtitleFile({ setId: state.subtitleSetId, index });
    if (loadId !== state.subtitleLoadId || state.selectedSubtitleIndex !== index) return;
    state.subtitleText = subtitleToVtt(payload.text);
    await activateSelectedSubtitle(loadId);
  } catch (error) {
    if (loadId !== state.subtitleLoadId) return;
    state.selectedSubtitleIndex = null;
    state.subtitleText = '';
    const select = document.querySelector('#subtitle-language');
    if (select) select.value = '';
    clearActiveSubtitle();
    setSubtitleStatus(`${option.name} subtitles could not be loaded. Playback will continue without captions.`);
  }
}

function clearActiveSubtitle() {
  if (state.player && state.subtitleTrack && typeof state.player.selectTextTrack === 'function') {
    try {
      state.player.selectTextTrack(null);
    } catch {
      /* The player may already be unloading. */
    }
  }
  state.subtitleNode?.remove();
  if (state.subtitleObjectUrl) URL.revokeObjectURL(state.subtitleObjectUrl);
  state.subtitleTrack = null;
  state.subtitleNode = null;
  state.subtitleObjectUrl = '';
}

async function activateSelectedSubtitle(loadId = state.subtitleLoadId) {
  if (loadId !== state.subtitleLoadId || state.selectedSubtitleIndex === null || !state.subtitleText) return;
  const video = document.querySelector('#video');
  const option = subtitleOption(state.selectedSubtitleIndex);
  if (!video || !option) return;
  if (!video.currentSrc || video.readyState === 0) {
    setSubtitleStatus(`${option.name} subtitles are ready and will appear when playback starts.`);
    return;
  }

  clearActiveSubtitle();
  const objectUrl = URL.createObjectURL(new Blob([state.subtitleText], { type: 'text/vtt;charset=utf-8' }));
  state.subtitleObjectUrl = objectUrl;
  const language = subtitleLanguageTag(option.name);
  const player = state.player;

  if (player && typeof player.addTextTrackAsync === 'function') {
    try {
      const track = await player.addTextTrackAsync(
        objectUrl,
        language,
        'subtitles',
        'text/vtt',
        undefined,
        option.name,
      );
      if (loadId !== state.subtitleLoadId || player !== state.player) {
        URL.revokeObjectURL(objectUrl);
        if (state.subtitleObjectUrl === objectUrl) state.subtitleObjectUrl = '';
        return;
      }
      player.selectTextTrack(track);
      state.subtitleTrack = track;
      setSubtitleStatus(`${option.name} subtitles on.`);
    } catch {
      if (state.subtitleObjectUrl === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        state.subtitleObjectUrl = '';
      }
      if (loadId === state.subtitleLoadId) {
        setSubtitleStatus(`${option.name} subtitles could not be attached to this stream.`);
      }
    }
    return;
  }

  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = option.name;
  track.srclang = language === 'und' ? 'en' : language;
  track.src = objectUrl;
  track.default = true;
  track.addEventListener('load', () => {
    if (loadId === state.subtitleLoadId && track.track) track.track.mode = 'showing';
  }, { once: true });
  video.appendChild(track);
  state.subtitleNode = track;
  if (track.track) track.track.mode = 'showing';
  setSubtitleStatus(`${option.name} subtitles on.`);
}

function handlePlayerReady(player) {
  state.player = player;
  state.playerControls?.refresh();
  void activateSelectedSubtitle();
}

async function loadDetails() {
  try {
    const details = await api.details({ provider: state.provider, id: state.id });
    state.details = details;
    app.details = details;
    rememberGenres(details);
    state.title = details.title || state.id;
    if (!state.playingTitle) state.playingTitle = state.title;
    state.isSeries = details.media_type === 'series' || (details.seasons || []).length > 0;
    if (state.isSeries && !state.season) {
      state.season = Number(details.seasons?.[0]?.number || 1);
      state.episode = Number(details.seasons?.[0]?.episodes?.[0]?.number || 1);
    }
    state.playerControls?.refresh();
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
  await stop({ keepUi: true });

  const runId = ++state.runId;
  const controller = new AbortController();
  state.controller = controller;
  state.order = startAfter ? rotationAfter(startAfter) : [...SERVER_ROTATION];
  state.status = {};
  paintRotation();
  hideOverlay();
  setStatus(`Checking ${providerLabel(state.order[0])} first…`, true);

  const result = await autoPlay({
    item: {
      id: { provider: state.provider, value: state.id },
      title: state.title,
      year: state.details?.year || '',
      media_type: state.details?.media_type || '',
    },
    title: state.title,
    year: state.details?.year || '',
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
        state.playerControls?.refresh();
      },
      onSelect: (entry, index) => {
        state.selected = index;
        paintStreams();
        state.playerControls?.refresh();
      },
      onStreams: (entry, index) => {
        state.entry = entry;
        state.selected = index;
        state.current = entry.provider;
        paintStreams();
        state.playerControls?.refresh();
      },
      onPlayback: (attempt) => {
        if (runId === state.runId && !controller.signal.aborted) showPlaybackLink(attempt);
      },
      onTrack: handlePlayerReady,
      onPlaying: ({ provider, release }) => {
        state.quality = String(release.quality || 'AUTO').toUpperCase();
        state.source = providerLabel(provider);
        state.playerControls?.refresh();
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
  await stop({ keepUi: true });
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
      if (controller.signal.aborted || runId !== state.runId) return;
      showPlaybackLink({ playback, release: target, provider: state.entry.provider, mirrorIndex: attempt.mirrorIndex });
      const result = await openStream({
        playback,
        video,
        signal: controller.signal,
        onTrack: handlePlayerReady,
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
  state.playerControls?.refresh();
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

function previousEpisode() {
  if (!state.isSeries) return null;
  const seasons = state.details?.seasons || [];
  const seasonIndex = seasons.findIndex((entry) => Number(entry.number) === Number(state.season));
  const season = seasons[seasonIndex];
  const episodes = season?.episodes || [];
  const index = episodes.findIndex((entry) => Number(entry.number) === Number(state.episode));
  if (index > 0) {
    return { season: Number(state.season), episode: Number(episodes[index - 1].number) };
  }
  const previousSeason = seasons[seasonIndex - 1];
  if (previousSeason?.episodes?.length) {
    const lastEpisode = previousSeason.episodes[previousSeason.episodes.length - 1];
    return { season: Number(previousSeason.number), episode: Number(lastEpisode.number) };
  }
  return null;
}

function nextEpisode() {
  if (!state.isSeries) return null;
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
  state.playingTitle = displayUiText(title);
  state.quality = String(quality || 'AUTO').toUpperCase();
  state.source = source || '';
  state.playerControls?.refresh();
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

function showPlaybackLink(attempt) {
  appendPlaybackLink(document.querySelector('#watch-playback-links'), attempt, window.location.origin);
  
  // Also set the current playback for VLC button
  setCurrentPlayback(
    attempt.playback,
    attempt.release,
    attempt.provider,
    attempt.mirrorIndex || 0
  );
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
  if (!keepUi) {
    state.playerControls?.destroy();
    state.playerControls = null;
    state.vlcButton = null;
  }
  state.controller?.abort();
  state.controller = null;
  window.clearInterval(state.progressTimer);
  state.progressTimer = 0;
  state.subtitleLoadId += 1;
  clearActiveSubtitle();
  
  // Clear VLC button state
  clearCurrentPlayback();
  
  if (!keepUi) {
    state.subtitleSearchController?.abort();
    state.subtitleSearchController = null;
    state.subtitleSetId = '';
    state.subtitleOptions = [];
    state.selectedSubtitleIndex = null;
    state.subtitleText = '';
  } else if (state.selectedSubtitleIndex !== null && !state.subtitleText) {
    state.selectedSubtitleIndex = null;
    const select = document.querySelector('#subtitle-language');
    if (select) select.value = '';
    setSubtitleStatus('Subtitle loading was interrupted by the stream change. Choose the language again.');
  }
  const video = document.querySelector('#video');
  if (video && video.currentTime > 5) void saveProgress().catch(() => {});
  state.player = await closeActivePlayer(video, state.player);
  if (!keepUi) state.entry = null;
}

export function stopPlayback() {
  return stop();
}
