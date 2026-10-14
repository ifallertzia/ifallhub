// Keep a visible, copyable history of the resolved URLs actually handed to the
// player. When the browser cannot decode a release (H.265/HEVC, `.mkv`, a DASH
// manifest) the user still needs the link for mpv/VLC, so every attempt is
// listed with its own copy button. These proxy/session URLs are short-lived and
// are therefore never persisted, and provider headers stay server-side.
import { displayUiText, providerLabel } from '../lib/format.js';
import { writeClipboard } from './vlc-button.js';

// A long server rotation can resolve dozens of links; this panel is a short
// history of what the player was given, not a request log.
export const MAX_LINK_ROWS = 40;
const COPIED_LABEL_MS = 2500;

/** Per-panel row bookkeeping: one row per URL, so retries do not stack. */
const panelRows = new WeakMap();

function rowsFor(container) {
  let rows = panelRows.get(container);
  if (!rows) {
    rows = new Map();
    panelRows.set(container, rows);
  }
  return rows;
}

function updateCount(container, rows) {
  const panel = container.closest?.('.playback-links') || container;
  const label = panel.querySelector?.('[data-links-count]');
  if (!label) return;
  const total = rows.size;
  label.textContent = total === 1 ? '1 link' : `${total} links`;
}

/** Drops the oldest rows once the panel is full. */
function pruneRows(container, rows) {
  while (rows.size > MAX_LINK_ROWS) {
    const oldest = rows.keys().next().value;
    rows.get(oldest)?.row?.remove?.();
    rows.delete(oldest);
  }
  if (typeof container.scrollHeight === 'number') container.scrollTop = container.scrollHeight;
}

/** Every URL currently listed (oldest first) — powers "Copy all". */
export function playbackLinkUrls(container) {
  if (!container) return [];
  return [...rowsFor(container).values()].map((entry) => entry.url);
}

/** Clipboard write that falls back to the legacy path used across the app. */
async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Denied or unavailable: fall through to the legacy path. */
  }
  return writeClipboard(text);
}

/** Shows `text`, then puts `restore` back. unref() keeps the timer out of tests. */
function flashLabel(button, text, restore, delay = COPIED_LABEL_MS) {
  button.textContent = text;
  const timer = setTimeout(() => {
    button.textContent = restore;
  }, delay);
  timer?.unref?.();
}

export function appendPlaybackLink(
  container,
  { playback = {}, release = {}, provider, mirrorIndex = 0, note = '' } = {},
  origin,
) {
  if (!container) return null;
  const rawUrl = playback.playback_url || playback.url;
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl, origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
  } catch {
    return null;
  }

  const rows = rowsFor(container);
  const existing = rows.get(url.href);
  if (existing) {
    // The same link came back (a retry or a kept pick): say so on its row
    // instead of stacking a duplicate.
    existing.retries += 1;
    existing.caption.textContent = `${existing.base} · retried ×${existing.retries}`;
    return existing.row;
  }

  container.querySelector?.('[data-links-empty]')?.remove();
  const row = document.createElement('div');
  row.className = 'playback-link-row';
  const label = document.createElement('label');
  label.className = 'playback-link-main';
  const caption = document.createElement('span');
  const mirror = release.mirrors?.[mirrorIndex];
  const base = `${providerLabel(provider)} · ${displayUiText(release.filename || release.quality || 'Stream')} · ${displayUiText(mirror?.label || `Link ${mirrorIndex + 1}`)} · ${String(playback.stream_type || 'file').toUpperCase()}`;
  caption.textContent = base;
  if (note) {
    const badge = document.createElement('span');
    badge.className = 'playback-link-note';
    badge.textContent = `⚠ ${displayUiText(note)}`;
    caption.append(badge);
  }
  const input = document.createElement('input');
  input.className = 'playback-link-url';
  input.type = 'text';
  input.readOnly = true;
  input.value = url.href;
  input.title = 'Select the whole link, or use Copy link.';
  input.addEventListener?.('focus', () => input.select?.());
  input.addEventListener?.('click', () => input.select?.());
  label.append(caption, input);

  const button = document.createElement('button');
  button.className = 'ghost-button small';
  button.type = 'button';
  button.textContent = 'Copy link';
  button.addEventListener('click', async () => {
    if (await copyText(input.value)) {
      flashLabel(button, 'Copied!', 'Copy link');
      return;
    }
    // No clipboard access (insecure context, denied permission): select the
    // text so the user can copy it with Ctrl/Cmd+C.
    input.focus?.();
    input.select?.();
    button.textContent = 'Select & copy manually';
  });
  row.append(label, button);
  container.append(row);

  rows.set(url.href, { row, url: url.href, caption, base, retries: 0 });
  pruneRows(container, rows);
  updateCount(container, rows);
  return row;
}
