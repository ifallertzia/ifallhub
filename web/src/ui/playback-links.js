// Keep a visible history of the resolved URLs actually handed to the player.
// Do not persist these short-lived proxy/session URLs or expose provider headers.
import { displayUiText, providerLabel } from '../lib/format.js';

export function appendPlaybackLink(container, { playback, release, provider, mirrorIndex = 0 }, origin) {
  if (!container) return;
  const rawUrl = playback.playback_url || playback.url;
  if (!rawUrl) return;
  let url;
  try {
    url = new URL(rawUrl, origin);
    if (!['http:', 'https:'].includes(url.protocol)) return;
  } catch {
    return;
  }

  container.querySelector('[data-links-empty]')?.remove();
  const row = document.createElement('div');
  row.className = 'playback-link-row';
  const label = document.createElement('label');
  label.className = 'playback-link-main';
  const caption = document.createElement('span');
  const mirror = release.mirrors?.[mirrorIndex];
  caption.textContent = `${providerLabel(provider)} · ${displayUiText(release.filename || release.quality || 'Stream')} · ${displayUiText(mirror?.label || `Link ${mirrorIndex + 1}`)} · ${String(playback.stream_type || 'file').toUpperCase()}`;
  const input = document.createElement('input');
  input.className = 'playback-link-url';
  input.type = 'text';
  input.readOnly = true;
  input.value = url.href;
  label.append(caption, input);

  const button = document.createElement('button');
  button.className = 'ghost-button small';
  button.type = 'button';
  button.textContent = 'Copy link';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = 'Copied!';
    } catch {
      input.focus();
      input.select();
      button.textContent = 'Select & copy manually';
    }
  });
  row.append(label, button);
  container.append(row);
}
