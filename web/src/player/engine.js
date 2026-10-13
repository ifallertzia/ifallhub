// Playback engine: resolves servers in order, opens the stream (native or via
// shaka for DASH/HLS) and reports progress through hooks. Ported from the
// original single-file client so the auto-rotation behaviour is unchanged.

import * as api from '../lib/api.js';
import { SERVER_ROTATION, displayUiText, itemId, itemProvider, providerLabel } from '../lib/format.js';
import { pickBestMatch, prepareSearchQuery } from './title-match.js';

export { pickBestMatch } from './title-match.js';

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

// Codecs/containers the browser cannot play. MovieBox DASH releases are often
// HEVC (`_h265_` paths, `codecName: h265`) and several 4KHDHub mirrors serve
// `.mkv`; both make <video>/Shaka fail with "Playback error" while mpv/VLC
// play them fine. They are ranked last (never dropped) so a manual pick or the
// download button still works.
const UNSUPPORTED_CODEC = /(^|[^a-z])(hevc|h\.?265|x\.?265|hvc1|hev1|hvc2|dvh1|dolby\s*vision)([^a-z]|$)/i;
const UNSUPPORTED_CONTAINER = /\.(mkv|avi|wmv|flv|divx|m2ts|vob)([?#\s]|$)/i;

/** `''` when the browser can probably play it, otherwise `'codec'`/`'container'`. */
export function unsupportedReason(release = {}) {
  const text = `${release.codec || ''} ${release.filename || ''} ${release.quality || ''}`;
  if (UNSUPPORTED_CONTAINER.test(text)) return 'container';
  if (UNSUPPORTED_CODEC.test(text)) return 'codec';
  return '';
}

export const ERROR_KINDS = {
  codec: 'codec',
  http: 'http',
  network: 'network',
  timeout: 'timeout',
  unknown: 'unknown',
};

function playbackError(message, kind = ERROR_KINDS.unknown, status = 0) {
  const error = new Error(message);
  error.name = 'PlaybackError';
  error.kind = kind;
  if (status) error.status = status;
  return error;
}

function hostOf(url = '') {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Maps a Shaka error (event.detail) to a message the user can act on. */
export function describeShakaError(detail = {}) {
  const code = Number(detail.code) || 0;
  const data = Array.isArray(detail.data) ? detail.data : [];
  const status = typeof data[0] === 'number' ? data[0] : 0;
  const url = typeof data[1] === 'string' ? data[1] : '';
  const raw = String(detail.message || '');

  if (code === 4032 || /unsupported by (this|the) browser|not supported by (this|the) browser/i.test(raw)) {
    return playbackError(
      'This release uses a codec the browser cannot decode (usually H.265/HEVC). Trying the next link…',
      ERROR_KINDS.codec,
    );
  }
  if (status === 401 || status === 403) {
    return playbackError(
      `The stream host refused the request (HTTP ${status}) — the signed link or its cookie expired. Refreshing the links…`,
      ERROR_KINDS.http,
      status,
    );
  }
  if (status === 404 || status === 410) {
    return playbackError(
      `The stream link is gone (HTTP ${status}) — it expired upstream. Refreshing the links…`,
      ERROR_KINDS.http,
      status,
    );
  }
  if (status >= 500) {
    return playbackError(
      `The stream host answered with HTTP ${status}${hostOf(url) ? ` (${hostOf(url)})` : ''}. Trying the next link…`,
      ERROR_KINDS.http,
      status,
    );
  }
  if ([1000, 1001, 1002, 1003, 1006, 1007].includes(code) || detail.category === 1) {
    return playbackError(
      status
        ? `Could not load the stream (HTTP ${status})${hostOf(url) ? ` from ${hostOf(url)}` : ''}.`
        : 'The stream host could not be reached (network or blocked request).',
      ERROR_KINDS.network,
      status,
    );
  }
  if (raw) return playbackError(`Stream error: ${raw}`, ERROR_KINDS.unknown, status);
  return playbackError(`Stream error ${code || ''}`.trim(), ERROR_KINDS.unknown, status);
}

/** Maps a `<video>` element MediaError to a message the user can act on. */
export function describeMediaError(video) {
  const error = video?.error;
  if (!error) return playbackError('The browser could not play this stream.', ERROR_KINDS.unknown);
  const detail = error.message ? ` (${error.message})` : '';
  switch (error.code) {
    case 4:
      return playbackError(
        `The browser cannot play this file${detail} — it is an unsupported container or codec, usually .mkv or H.265/HEVC.`,
        ERROR_KINDS.codec,
      );
    case 3:
      return playbackError(
        `The stream downloaded but could not be decoded${detail} — the browser lacks this codec.`,
        ERROR_KINDS.codec,
      );
    case 2:
      return playbackError('The stream stopped downloading — the stream host or the network dropped it.', ERROR_KINDS.network);
    case 1:
      return playbackError('Playback was aborted before it started.', ERROR_KINDS.unknown);
    default:
      return playbackError(`Playback error ${error.code}${detail}`.trim(), ERROR_KINDS.unknown);
  }
}

/** True when a link failed because the signed/stream list expired (needs refresh). */
export function isExpiredLinkError(error) {
  if (!error) return false;
  if (error.status === 403 || error.status === 410) return true;
  return /expired|refresh the stream list|no longer valid/i.test(String(error.message || ''));
}

/** Finds the same release in a freshly fetched list (refresh keeps the user's pick). */
export function matchReleaseIndex(releases = [], target = {}) {
  const quality = String(target?.quality || '');
  const filename = String(target?.filename || '');
  const exact = releases.findIndex(
    (release) => String(release.filename || '') === filename && String(release.quality || '') === quality,
  );
  if (exact >= 0) return exact;
  const byQuality = releases.findIndex((release) => String(release.quality || '') === quality);
  return byQuality >= 0 ? byQuality : 0;
}

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
  // HEVC/.mkv releases are pushed behind playable ones so the browser does not
  // burn through them (and the user's patience) before a working link starts.
  const reason = unsupportedReason(release);
  const unsupportedPenalty = reason === 'container' ? 60 : reason === 'codec' ? 50 : 0;
  return providerScore * 100 + qualityScore(release.quality) * 10 + hasMirror + size + directBonus + unsupportedPenalty;
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

/** Drops the cached stream list for one server (its links/session expired). */
export async function refreshServerStreams({ provider, item, title, year, season, episode, isSeries, cache, signal }) {
  delete cache[provider];
  return resolveServerStreams({ provider, item, title, year, season, episode, isSeries, cache, signal });
}

/** Servers to try after `provider`, wrapping so every server still gets a turn. */
export function rotationAfter(provider) {
  const index = SERVER_ROTATION.indexOf(provider);
  if (index < 0) return [...SERVER_ROTATION];
  return [...SERVER_ROTATION.slice(index + 1), ...SERVER_ROTATION.slice(0, index + 1)];
}

/** Finds this title on one server and returns its stream set (or null). */
export async function resolveServerStreams({ provider, item, title, year, season, episode, isSeries, cache, signal }) {
  if (cache[provider]?.releases?.length) return cache[provider];
  const expectedTitle = String(title || item?.title || '').trim();
  const expectedYear = String(year || item?.year || item?.release_year || '').trim();
  if (!expectedTitle) return null;

  try {
    let target = item && itemProvider(item) === provider ? item : null;
    if (!target) {
      const query = prepareSearchQuery(expectedTitle, expectedYear);
      if (!query) return null;
      const results = await api.search({ q: query, provider, page: 1 }, { signal });
      if (!Array.isArray(results) || !results.length) return null;
      // A loose search result is a no-match. Never substitute the first item:
      // that was allowing a shared sequel number to open an unrelated film.
      target = pickBestMatch(results, expectedTitle, expectedYear, isSeries);
      if (!target) return null;
    }
    const response = await api.streams(
      {
        provider,
        id: itemId(target),
        season,
        episode,
        isSeries,
        expectedTitle,
        expectedYear,
      },
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
    finish({ played: false, error: describeMediaError(video) });
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
          monitor.fail(describeShakaError(detail));
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
export async function autoPlay({ item, title, year, order, season, episode, isSeries, cache, startRelease = 0, video, signal, hooks }) {
  const setStatus = hooks.onStatus || (() => {});
  const setServerStatus = hooks.onServerStatus || (() => {});
  const setHeader = hooks.onHeader || (() => {});
  const setStreams = hooks.onStreams || (() => {});
  let lastError = '';
  let lastKind = '';
  let codecSeen = false;

  for (const provider of order) {
    if (signal.aborted) return { cancelled: true };
    setServerStatus(provider, 'loading');
    setStatus(`Checking ${providerLabel(provider)} for “${title}”…`, true);

    let entry = await resolveServerStreams({ provider, item, title, year, season, episode, isSeries, cache, signal });
    if (signal.aborted) return { cancelled: true };
    if (!entry) {
      setServerStatus(provider, 'empty');
      continue;
    }

    hooks.onEntry?.(entry);
    const firstIndex =
      provider === order[0] ? Math.min(Math.max(Number(startRelease) || 0, 0), entry.releases.length - 1) : 0;
    setStreams(entry, firstIndex);

    const sourceName = providerLabel(provider);
    let attempts = buildAttempts(entry.releases, firstIndex);
    let cursor = 0;
    let attempt = 0;
    // One stream-list refresh per server: when the stream set expires (60 min
    // TTL) or a signed CDN cookie dies mid-run, a fresh /api/streams usually plays.
    let refreshed = false;

    while (cursor < attempts.length) {
      if (signal.aborted) return { cancelled: true };
      const { releaseIndex, mirrorIndex } = attempts[cursor];
      cursor += 1;
      const release = entry.releases[releaseIndex];
      const quality = String(release.quality || 'AUTO').toUpperCase();
      attempt += 1;
      setServerStatus(provider, 'trying');
      hooks.onSelect?.(entry, releaseIndex);
      setHeader(displayUiText(release.filename || title), quality, sourceName);
      setStatus(`Trying ${sourceName} · ${quality} (${attempt} of ${attempts.length})…`, true);

      await closeActivePlayer(video, hooks.currentPlayer?.());
      if (signal.aborted) return { cancelled: true };

      let failure = null;
      try {
        const playback = await api.play(
          { streamSetId: entry.streamSetId, releaseIndex: release.serverIndex ?? releaseIndex, mirrorIndex },
          { signal },
        );
        if (signal.aborted) return { cancelled: true };
        hooks.onPlayback?.({ playback, release, provider, mirrorIndex });
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
        failure = result.error || new Error('This stream could not be started.');
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') return { cancelled: true };
        failure = error;
      }

      lastError = failure?.message || 'This stream could not be started.';
      lastKind = failure?.kind || '';
      if (lastKind === ERROR_KINDS.codec) codecSeen = true;

      if (!refreshed && isExpiredLinkError(failure)) {
        refreshed = true;
        setStatus(`${sourceName} links expired — getting fresh links…`, true);
        const fresh = await refreshServerStreams({ provider, item, title, year, season, episode, isSeries, cache, signal });
        if (signal.aborted) return { cancelled: true };
        if (fresh) {
          entry = fresh;
          hooks.onEntry?.(entry);
          const target = matchReleaseIndex(entry.releases, release);
          attempts = buildAttempts(entry.releases, target);
          setStreams(entry, target);
          cursor = 0;
          attempt = 0;
          continue;
        }
      }

      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    setServerStatus(provider, 'failed');
    setStatus(`${sourceName} has no working link. Moving to the next server…`, true);
  }

  return { played: false, error: lastError, kind: lastKind, codecSeen, order };
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
