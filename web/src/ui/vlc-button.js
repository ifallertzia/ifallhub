// "Open in VLC" handoff for external players.
//
// The Rust engine runs next to the browser, so it can start VLC / mpv / IINA
// with a loopback media URL — provider headers and cookies stay server-side,
// and the player decodes what the browser cannot (H.265/HEVC, `.mkv`, DASH).
// When this deployment has no local player (a hosted server, demo mode, or a
// browser profile that blocks the request), the same button degrades to
// copying the resolved link with paste-into-VLC instructions.

import * as api from '../lib/api.js';
import { displayUiText, providerLabel } from '../lib/format.js';

let currentPlaybackUrl = null;
let currentReleaseInfo = null;
let supportPromise = null;

/**
 * Store the current playback URL and release info
 * Called when a stream starts playing or is attempted
 */
export function setCurrentPlayback(playback, release, provider, mirrorIndex = 0) {
  if (!playback?.playback_url && !playback?.url) {
    currentPlaybackUrl = null;
    currentReleaseInfo = null;
    return;
  }

  currentPlaybackUrl = playback.playback_url || playback.url;
  currentReleaseInfo = {
    release: release || {},
    provider: provider || '',
    mirrorIndex: mirrorIndex,
    quality: release?.quality || 'Unknown',
    filename: release?.filename || 'Stream',
    codec: release?.codec || '',
    streamType: playback.stream_type || 'file',
  };
}

/**
 * Clear the current playback URL
 */
export function clearCurrentPlayback() {
  currentPlaybackUrl = null;
  currentReleaseInfo = null;
}

/**
 * Get the current playback URL
 */
export function getCurrentPlaybackUrl() {
  return currentPlaybackUrl;
}

/**
 * Get the current release info
 */
export function getCurrentReleaseInfo() {
  return currentReleaseInfo;
}

/**
 * Check if there's a valid playback URL available
 */
export function hasPlaybackUrl() {
  return currentPlaybackUrl !== null;
}

/** Absolute, same-origin URL for a playback payload (routes are relative). */
export function absolutePlaybackUrl(playback, origin) {
  const raw = playback?.playback_url || playback?.url || '';
  if (!raw) return '';
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  try {
    const url = new URL(raw, base || undefined);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

/** Clipboard write with the legacy fallback used elsewhere in this module. */
export async function writeClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Private browsing or a denied permission: fall through. */
  }
  try {
    const input = document.createElement('input');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand?.('copy') ?? false;
    document.body.removeChild(input);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Copy the current playback URL to clipboard
 * Returns true if successful, false otherwise
 */
export async function copyPlaybackUrl() {
  if (!currentPlaybackUrl) {
    return false;
  }

  const link = absolutePlaybackUrl({ playback_url: currentPlaybackUrl });
  return writeClipboard(link || currentPlaybackUrl);
}

/**
 * Which external players the engine can launch here (cached per page load).
 * A missing route (older engine) or an unreachable engine resolves to
 * `available: false`, which sends the button down the copy-link path.
 */
export async function loadPlayerSupport({ refresh = false } = {}) {
  if (refresh || !supportPromise) {
    supportPromise = api.playerSupport().then(
      (payload) => ({
        available: Boolean(payload?.available) && (payload?.players?.length || 0) > 0,
        players: payload?.players || [],
        default: payload?.default || '',
        reason: String(payload?.reason || ''),
      }),
      (error) => ({
        available: false,
        players: [],
        default: '',
        reason:
          error?.status === 404
            ? 'This engine build cannot open external players.'
            : 'The engine could not be reached.',
      }),
    );
  }
  return supportPromise;
}

/** Forgets the cached support payload (tests and post-settings refreshes). */
export function clearPlayerSupportCache() {
  supportPromise = null;
}

/** Button text for the player the engine would launch: "Open in VLC". */
export function playerButtonLabel(support) {
  const players = support?.players || [];
  const preferred = players.find((player) => player.id === support?.default) || players[0];
  return `Open in ${preferred?.label || 'VLC'}`;
}

/** True when the engine answered that no local player can be launched here. */
export function isPlayerUnavailable(error) {
  return error?.status === 404 || error?.status === 405 || error?.payload?.available === false;
}

/**
 * Copies the link for the selected release so it can be pasted into VLC.
 * Resolves a fresh playback session when one is not cached yet.
 */
export async function copyStreamLink({
  streamSetId = '',
  releaseIndex = 0,
  mirrorIndex = 0,
} = {}) {
  let link = '';
  if (streamSetId) {
    try {
      const playback = await api.play({ streamSetId, releaseIndex, mirrorIndex });
      link = absolutePlaybackUrl(playback);
    } catch {
      link = '';
    }
  }
  if (!link && currentPlaybackUrl) link = absolutePlaybackUrl({ playback_url: currentPlaybackUrl });
  if (!link) return '';
  return (await writeClipboard(link)) ? link : '';
}

/**
 * Copies the link the player is using right now (`url`), and only resolves a
 * fresh playback session when there is nothing playing yet. The "Copy link"
 * button on the player uses this, so what lands on the clipboard is the same
 * URL the browser was handed — including H.265/HEVC and `.mkv` releases the
 * browser itself cannot decode.
 * @returns {Promise<string>} the copied URL, or `''` when there was nothing to copy
 */
export async function copyPlaybackUrlOrResolve({
  url = '',
  streamSetId = '',
  releaseIndex = 0,
  mirrorIndex = 0,
} = {}) {
  const playing = absolutePlaybackUrl({ playback_url: url });
  if (playing) return (await writeClipboard(playing)) ? playing : '';
  return copyStreamLink({ streamSetId, releaseIndex, mirrorIndex });
}

/**
 * "Open in VLC" for one release: asks the engine to launch a local player and
 * falls back to copying the link when this deployment cannot launch one.
 * @returns {Promise<{opened: boolean, label?: string, url?: string, copied?: boolean, reason?: string, error?: string}>}
 */
export async function openStreamExternally(target = {}) {
  const {
    streamSetId = '',
    releaseIndex = 0,
    mirrorIndex = 0,
    player = '',
    resumeSeconds = 0,
  } = target || {};
  if (!streamSetId || releaseIndex < 0) {
    return { opened: false, error: 'Playback links are still loading. Try again in a moment.' };
  }

  const support = await loadPlayerSupport();
  if (support.available) {
    try {
      const result = await api.openInPlayer({
        streamSetId,
        releaseIndex,
        mirrorIndex,
        player,
        resumeSeconds,
      });
      return { opened: true, label: result?.label || playerButtonLabel(support), url: result?.url || '' };
    } catch (error) {
      if (!isPlayerUnavailable(error)) {
        return { opened: false, error: error?.message || 'Could not open the media player.' };
      }
      // No launchable player after all: copy the link instead.
    }
  }

  const link = await copyStreamLink({ streamSetId, releaseIndex, mirrorIndex });
  return link
    ? { opened: false, copied: true, link, reason: support.reason }
    : {
        opened: false,
        copied: false,
        reason: support.reason,
        error: 'No player on this computer and the link could not be copied.',
      };
}

/** Toast copy for an `openStreamExternally()` result. Pure. */
export function describeOpenResult(result) {
  if (result?.opened) {
    return {
      kind: 'success',
      message: `${result.label || 'VLC'} is opening on this computer.`,
    };
  }
  if (result?.copied) {
    return {
      kind: 'info',
      message:
        'No local player found. Link copied — in VLC: Media → Open Network Stream → paste.',
    };
  }
  return { kind: 'error', message: result?.error || 'Could not open a local player.' };
}

/**
 * Create a button that hands the current/selected stream to a local player.
 * @param {Object} options - Button options
 * @param {string} options.text - Fixed label; by default the detected player names itself
 * @param {string} options.className - Additional CSS classes
 * @param {object|function} options.target - `{streamSetId, releaseIndex, mirrorIndex, resumeSeconds}`
 * @param {function} options.onClick - Custom click handler (skips the default flow)
 * @param {function} options.onResult - Receives the `openStreamExternally()` result
 * @returns {HTMLElement} The button element
 */
export function createVlcButton(options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `vlc-button ${options.className || ''}`.trim();
  const icon = document.createElement('span');
  icon.className = 'vlc-button-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '▶';
  const label = document.createElement('span');
  label.textContent = options.text || 'Open in VLC';
  button.append(icon, label);
  button.title = 'Play this stream in VLC, mpv or IINA on this computer.';

  if (!options.text) {
    loadPlayerSupport().then((support) => {
      if (support.available) label.textContent = playerButtonLabel(support);
    });
  }

  button.addEventListener('click', async () => {
    if (options.onClick) {
      await options.onClick(button);
      return;
    }
    const original = label.textContent;
    button.disabled = true;
    label.textContent = 'Opening…';
    let result;
    try {
      const target = typeof options.target === 'function' ? await options.target() : options.target;
      result = await openStreamExternally(target || {});
    } finally {
      button.disabled = false;
      label.textContent = original;
    }
    const summary = describeOpenResult(result);
    if (options.onResult) options.onResult(result);
    else showVlcToast(summary.message, summary.kind);
  });

  return button;
}

/**
 * Show a toast notification for VLC operations
 */
export function showVlcToast(message, type = 'info') {
  const toast = document.getElementById('vlc-toast') || createToastContainer();

  // Clear existing timeout
  if (toast._timeout) {
    clearTimeout(toast._timeout);
  }

  toast.textContent = message;
  toast.className = `vlc-toast vlc-toast-${type}`;
  toast.hidden = false;

  // Auto-hide after 5 seconds
  toast._timeout = setTimeout(() => {
    toast.hidden = true;
    toast._timeout = null;
  }, 5000);
}

/**
 * Create the toast container element
 */
function createToastContainer() {
  const toast = document.createElement('div');
  toast.id = 'vlc-toast';
  toast.className = 'vlc-toast';
  toast.hidden = true;
  toast.role = 'status';
  toast.ariaLive = 'polite';

  document.body.appendChild(toast);

  // Add CSS if not already present
  if (!document.getElementById('vlc-toast-css')) {
    const style = document.createElement('style');
    style.id = 'vlc-toast-css';
    style.textContent = `
      .vlc-toast {
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 16px;
        border-radius: 8px;
        background: #1a1a1a;
        color: #fff;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 9999;
        max-width: 400px;
        transition: opacity 0.2s, transform 0.2s;
      }
      .vlc-toast.hidden {
        opacity: 0;
        transform: translateY(10px);
        pointer-events: none;
      }
      .vlc-toast-success {
        border-left: 3px solid #22c55e;
      }
      .vlc-toast-error {
        border-left: 3px solid #ef4444;
        background: #2a0a0a;
      }
      .vlc-toast-info {
        border-left: 3px solid #3b82f6;
      }
      .vlc-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: #2a2a2a;
        color: #fff;
        border: 1px solid #444;
        border-radius: 6px;
        font-size: 13px;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.2s;
      }
      .vlc-button:hover {
        background: #3a3a3a;
        border-color: #666;
      }
      .vlc-button:active {
        background: #4a4a4a;
      }
      .vlc-button:disabled {
        opacity: 0.7;
        cursor: progress;
      }
      .vlc-button .vlc-button-icon {
        font-size: 11px;
        color: #ff8a69;
      }
      .vlc-button small {
        display: block;
        font-size: 10px;
        color: #888;
        margin-top: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  return toast;
}

/**
 * Release summary used by the instructions below and by the player page.
 */
export function getVlcInstructions() {
  const info = getCurrentReleaseInfo();

  if (!info) {
    return 'Start a stream first, then click "Open in VLC" to open it in a local player.';
  }

  const lines = [
    `Stream: ${displayUiText(info.filename)}`,
    `Quality: ${info.quality}`,
    `Codec: ${info.codec || 'Unknown'}`,
    `Type: ${info.streamType.toUpperCase()}`,
    `Source: ${providerLabel(info.provider)}`,
    '',
    'Click "Open in VLC" to start the player here.',
    'If no player is installed, the link is copied instead:',
    'VLC → Media → Open Network Stream → paste → Play.',
  ];

  return lines.join('\n');
}
