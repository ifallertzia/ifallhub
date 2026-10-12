// Playback engine: resolves servers in order, opens the stream (native or via
// shaka for DASH/HLS) and reports progress through hooks. Ported from the
// original single-file client so the auto-rotation behaviour is unchanged.

import * as api from '../lib/api.js';
import { SERVER_ROTATION, displayUiText, itemId, itemProvider, providerLabel } from '../lib/format.js';

export const STREAM_START_TIMEOUT_MS = 6500;
const STABLE_PLAYBACK_MS = 1200;

const PROVIDER_PRIORITY = Object.fromEntries(SERVER_ROTATION.map((provider, index) => [provider, index]));

const QUALITY_SCORES = [
  [/2160|4k|uhd/i, 0],
  [/1080/i, 1],
  [/720/i, 2],
  [/480/i, 3],
  [/360/i, 4],
];

export const STATUS_LABELS = {
  idle: 'Waiting',
  loading: 'Checking',
  trying: 'Trying',
  failed: 'Failed',
  empty: 'No links',
  playing: 'Playing',
};

function qualityScore(quality = '') {
  const text = String(quality);
  for (const [pattern, score] of QUALITY_SCORES) if (pattern.test(text)) return score;
  return 5;
}

export function scoreRelease(release, fallbackProvider) {
  const provider = String(release.provider || fallbackProvider || '').toLowerCase();
  const providerScore = PROVIDER_PRIORITY[provider] ?? 10;
  const hasMirror = (release.mirrors?.length || 0) > 0 ? 0 : 10;
  const size = release.size_bytes ? 0 : 1;
  const directBonus = release.mirrors?.some((mirror) => mirror.direct_file) ? -1 : 0;
  return providerScore * 100 + qualityScore(release.quality) * 10 + hasMirror + size + directBonus;
}

/** Best playable links first, keeping the API's own index for /api/play. */
export function sortReleases(releases = [], fallbackProvider) {
  return [...releases].sort((a, b) => {
    const diff = scoreRelease(a, fallbackProvider) - scoreRelease(b, fallbackProvider);
    if (diff !== 0) return diff;
    return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
  });
}

export function buildStreamEntry(provider, item, response = {}) {
  const raw = response.releases || response.streams || [];
  const releases = sortReleases(
    raw.map((release, serverIndex) => ({ ...release, serverIndex })),
    provider,
  );
  return { provider, item, streamSetId: response.stream_set_id || null, releases };
}

export function buildAttempts(releases = [], firstIndex = 0) {
  const attempts = [];
  const total = releases.length;
  for (let offset = 0; offset < total; offset += 1) {
    const releaseIndex = (firstIndex + offset) % total;
    const mirrorCount = Math.max(1, releases[releaseIndex].mirrors?.length || 1);
    for (let mirrorIndex = 0; mirrorIndex < mirrorCount; mirrorIndex += 1) {
      attempts.push({ releaseIndex, mirrorIndex });
    }
  }
  return attempts;
}

/** Servers to try after `provider`, wrapping so every server still gets a turn. */
export function rotationAfter(provider) {
  const index = SERVER_ROTATION.indexOf(provider);
  if (index < 0) return [...SERVER_ROTATION];
  return [...SERVER_ROTATION.slice(index + 1), ...SERVER_ROTATION.slice(0, index + 1)];
}

export function pickBestMatch(results = [], title = '') {
  const lower = String(title || '').toLowerCase();
  const exact = results.find((entry) => entry.title?.toLowerCase() === lower);
  if (exact) return exact;
  const partial = results.find(
    (entry) => entry.title?.toLowerCase().includes(lower) || lower.includes(entry.title?.toLowerCase()),
  );
  return partial || results[0];
}

/** Finds this title on one server and returns its stream set (or null). */
export async function resolveServerStreams({ provider, item, title, season, episode, isSeries, cache, signal }) {
  if (cache[provider]?.releases?.length) return cache[provider];
  try {
    let target = item && itemProvider(item) === provider ? item : null;
    if (!target) {
      if (!title) return null;
      const results = await api.search({ q: title, provider, page: 1 }, { signal });
      if (!Array.isArray(results) || !results.length) return null;
      target = pickBestMatch(results, title);
    }
    const response = await api.streams(
      { provider, id: itemId(target), season, episode, isSeries },
      { signal },
    );
    const entry = buildStreamEntry(provider, target, response);
    if (!entry.releases.length || !entry.streamSetId) return null;
    cache[provider] = entry;
    return entry;
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn(`${provider} has no usable streams:`, error);
    return null;
  }
}

let shakaPromise;

export async function loadShaka() {
  if (!shakaPromise) {
    shakaPromise = import('shaka-player').then((module) => {
      const shaka = module.default || module;
      shaka.polyfill.installAll();
      return shaka;
    });
  }
  return shakaPromise;
}

export async function closeActivePlayer(video, activePlayer) {
  if (activePlayer) {
    try {
      await activePlayer.destroy();
    } catch {
      /* Already disposed. */
    }
  }
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.muted = false;
    video.load();
  }
  return null;
}

function createPlaybackMonitor(video, signal) {
  let resolvePlayback;
  let settled = false;
  let timeoutId = 0;
  let stableTimeoutId = 0;
  const promise = new Promise((resolve) => {
    resolvePlayback = resolve;
  });

  const finish = (result) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeoutId);
    window.clearTimeout(stableTimeoutId);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('error', onVideoError);
    signal.removeEventListener('abort', onAbort);
    resolvePlayback(result);
  };

  const onPlaying = () => {
    window.clearTimeout(timeoutId);
    stableTimeoutId = window.setTimeout(() => {
      if (video.readyState >= 2 && !video.paused) finish({ played: true });
    }, STABLE_PLAYBACK_MS);
  };
  const onVideoError = () => {
    const code = video.error?.code;
    const message = video.error?.message || '';
    finish({
      played: false,
      error: new Error(code ? `Playback error ${code}: ${message}`.trim() : 'The browser could not play this stream.'),
    });
  };
  const onAbort = () => finish({ played: false, cancelled: true });

  video.addEventListener('playing', onPlaying);
  video.addEventListener('error', onVideoError);
  signal.addEventListener('abort', onAbort);
  timeoutId = window.setTimeout(() => {
    if (video.readyState >= 2) {
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

async function requestPlayback(video, signal) {
  if (signal.aborted) throw new Error('Playback was cancelled.');
  try {
    await video.play();
  } catch (error) {
    if (error?.name !== 'NotAllowedError' || signal.aborted) throw error;
    const wasMuted = video.muted;
    video.muted = true;
    const unmute = () => {
      if (!wasMuted) video.muted = false;
    };
    video.addEventListener('playing', unmute, { once: true });
    try {
      await video.play();
    } catch (mutedError) {
      video.removeEventListener('playing', unmute);
      video.muted = wasMuted;
      throw mutedError;
    }
  }
}

function isAdaptive(playback) {
  const type = String(playback.stream_type || '').toLowerCase();
  const url = String(playback.playback_url || playback.url || '');
  return type === 'dash' || type === 'hls' || url.includes('.mpd') || url.includes('.m3u8');
}

/**
 * Opens one resolved stream. Resolves with `{ played, error, cancelled }` and
 * hands back the shaka instance so the caller can destroy it later.
 */
export async function openStream({ playback, video, signal, onTrack }) {
  const playbackUrl = playback.playback_url || playback.url;
  if (!playbackUrl) {
    return { played: false, error: new Error('The selected source did not return a playable link.') };
  }
  const monitor = createPlaybackMonitor(video, signal);
  let activePlayer = null;

  try {
    if (isAdaptive(playback)) {
      const shaka = await loadShaka();
      if (signal.aborted) {
        monitor.cancel();
      } else {
        const player = new shaka.Player();
        activePlayer = player;
        player.configure({
          streaming: {
            bufferingGoal: 30,
            rebufferingGoal: 10,
            bufferBehind: 20,
            retryParameters: { maxAttempts: 3, baseDelay: 300, backoffFactor: 2 },
          },
          manifest: {
            dash: { ignoreMinBufferTime: true },
            hls: { ignoreManifestProgramDateTime: true },
          },
          abr: { enabled: true, defaultBandwidthEstimate: 2000000 },
        });
        const onError = (event) => {
          const detail = event.detail;
          const critical =
            detail?.severity == null ||
            detail.severity === shaka.util?.Error?.Severity?.CRITICAL ||
            detail.severity === 2;
          if (!critical) return;
          if (video.readyState >= 3 && !video.paused && video.currentTime > 1) return;
          monitor.fail(new Error(detail?.message || `Stream error ${detail?.code || ''}`.trim()));
        };
        player.addEventListener('error', onError);
        monitor.promise.then(() => player.removeEventListener('error', onError)).catch(() => {});

        const setup = (async () => {
          await player.attach(video);
          if (signal.aborted) return;
          await player.load(playbackUrl);
        })();
        const outcome = await Promise.race([
          setup.then(() => ({ ready: true }), (error) => ({ error })),
          monitor.promise.then((result) => ({ result })),
        ]);
        if (outcome.error) monitor.fail(outcome.error);
        else if (outcome.ready && !signal.aborted) {
          requestPlayback(video, signal).catch((error) => monitor.fail(error));
        }
      }
    } else {
      video.src = playbackUrl;
      video.load();
      requestPlayback(video, signal).catch((error) => monitor.fail(error));
    }
  } catch (error) {
    monitor.fail(error);
  }

  const result = await monitor.promise;
  if (!result.played) {
    activePlayer = await closeActivePlayer(video, activePlayer);
  } else {
    onTrack?.(activePlayer);
  }
  return { ...result, player: activePlayer };
}

/**
 * Walks the server rotation, then every release/mirror on each server, until a
 * stream starts. `hooks` receives UI updates; `signal` cancels the whole run.
 */
export async function autoPlay({ item, title, order, season, episode, isSeries, cache, startRelease = 0, video, signal, hooks }) {
  const setStatus = hooks.onStatus || (() => {});
  const setServerStatus = hooks.onServerStatus || (() => {});
  const setHeader = hooks.onHeader || (() => {});
  const setStreams = hooks.onStreams || (() => {});
  let lastError = '';

  for (const provider of order) {
    if (signal.aborted) return { cancelled: true };
    setServerStatus(provider, 'loading');
    setStatus(`Checking ${providerLabel(provider)} for “${title}”…`, true);

    const entry = await resolveServerStreams({ provider, item, title, season, episode, isSeries, cache, signal });
    if (signal.aborted) return { cancelled: true };
    if (!entry) {
      setServerStatus(provider, 'empty');
      continue;
    }

    hooks.onEntry?.(entry);
    const firstIndex =
      provider === order[0] ? Math.min(Math.max(Number(startRelease) || 0, 0), entry.releases.length - 1) : 0;
    setStreams(entry, firstIndex);

    const attempts = buildAttempts(entry.releases, firstIndex);
    const sourceName = providerLabel(provider);
    let attempt = 0;
    for (const { releaseIndex, mirrorIndex } of attempts) {
      if (signal.aborted) return { cancelled: true };
      const release = entry.releases[releaseIndex];
      const quality = String(release.quality || 'AUTO').toUpperCase();
      attempt += 1;
      setServerStatus(provider, 'trying');
      hooks.onSelect?.(entry, releaseIndex);
      setHeader(displayUiText(release.filename || title), quality, sourceName);
      setStatus(`Trying ${sourceName} · ${quality} (${attempt} of ${attempts.length})…`, true);

      await closeActivePlayer(video, hooks.currentPlayer?.());
      if (signal.aborted) return { cancelled: true };

      try {
        const playback = await api.play(
          { streamSetId: entry.streamSetId, releaseIndex: release.serverIndex ?? releaseIndex, mirrorIndex },
          { signal },
        );
        if (signal.aborted) return { cancelled: true };
        const result = await openStream({
          playback,
          video,
          signal,
          onTrack: (player) => hooks.onTrack?.(player),
        });
        if (result.played) {
          setServerStatus(provider, 'playing');
          setStatus(`Now playing on ${sourceName} · ${quality}.`, false);
          hooks.onPlaying?.({ provider, release, entry, quality, playback });
          return { played: true, provider, release, entry, playback };
        }
        if (result.cancelled || signal.aborted) return { cancelled: true };
        lastError = result.error?.message || 'This stream could not be started.';
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') return { cancelled: true };
        lastError = error.message || 'This stream could not be prepared.';
      }
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    setServerStatus(provider, 'failed');
    setStatus(`${sourceName} has no working link. Moving to the next server…`, true);
  }

  return { played: false, error: lastError, order };
}

/** Downloads one release/mirror as a file when the link supports it. */
export async function downloadRelease({ entry, releaseIndex, mirrorIndex }) {
  const release = entry.releases[releaseIndex];
  if (!release || !entry.streamSetId) throw new Error('Links are still loading. Try again in a moment.');
  const playback = await api.play({
    streamSetId: entry.streamSetId,
    releaseIndex: release.serverIndex ?? releaseIndex,
    mirrorIndex,
  });
  const url = playback.playback_url || playback.url;
  if (!url) throw new Error('This link did not return a downloadable file.');
  const type = String(playback.stream_type || 'file').toLowerCase();
  if (type !== 'file') {
    throw new Error(`This link is a ${type.toUpperCase()} stream split into segments, so it can't be saved as one file.`);
  }
  const filename = (displayUiText(release.filename) || 'download').replace(/[\\/:*?"<>|]+/g, '_');
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  try {
    if (new URL(url, window.location.href).origin !== window.location.origin) link.target = '_blank';
  } catch {
    /* Relative URL: keep the default behaviour. */
  }
  document.body.append(link);
  link.click();
  link.remove();
  return filename;
}
