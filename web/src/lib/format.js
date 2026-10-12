// Shared formatting helpers. Every value that reaches the DOM goes through
// escapeHtml() or textContent; nothing here returns raw markup.

export const PROVIDER_IDS = [
  'moviebox',
  'fourkhdhub',
  'dramachi',
  'bdix_circleftp',
  'bdix_dhakaflix',
  'addons',
];

// Playback order used by "Play automatically": Sakshi → Ritu → Siddharth → rest.
export const SERVER_ROTATION = [
  'dramachi',
  'fourkhdhub',
  'moviebox',
  'addons',
  'bdix_circleftp',
  'bdix_dhakaflix',
];

const PROVIDER_LABELS = {
  moviebox: 'Siddharth',
  fourkhdhub: 'Ritu',
  dramachi: 'Sakshi',
  bdix_circleftp: 'Shreya',
  bdix_dhakaflix: 'Everyone',
  addons: 'Ifallhub',
};

// Values match the CSS classes in style.css and the ids from /api/providers.
const PROVIDER_DOT_CLASS = {
  moviebox: 'moviebox-dot',
  fourkhdhub: 'fourkhdhub-dot',
  dramachi: 'dramachi-dot',
  bdix_circleftp: 'bdix_circleftp-dot',
  bdix_dhakaflix: 'bdix_dhakaflix-dot',
  addons: 'addons-dot',
};

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

export function displayUiText(value = '') {
  return String(value)
    .replace(/\bmovie\s*box(?:-tui)?\b/gi, 'Ifallhub')
    .replace(/\b4k\s*hd\s*hub\b/gi, 'Ritu')
    .replace(/\bdrama\s*chi\b/gi, 'Sakshi')
    .replace(/\bcircle\s*ftp\b(?:\s*\(bdix\))?/gi, 'Shreya')
    .replace(/\bdhaka\s*flix\b(?:\s*\(bdix\))?/gi, 'Everyone')
    .replace(/\bcommunity\s*add[ -]?ons?\b/gi, 'Ifallhub');
}

export function providerLabel(provider) {
  const key = String(provider || '').trim().toLowerCase();
  return PROVIDER_LABELS[key] || displayUiText(provider) || 'Source';
}

export function providerDotClass(provider) {
  return PROVIDER_DOT_CLASS[String(provider || '').trim().toLowerCase()] || 'source-dot';
}

export function isKnownProvider(provider) {
  return PROVIDER_IDS.includes(String(provider || '').trim().toLowerCase());
}

export function prettySize(size) {
  const bytes = Number(size);
  if (!bytes || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Normalises provider rating values ("8.7", 87, "N/A") to a 0-10 number or null. */
export function normaliseRating(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed > 10) return Math.round((parsed / 10) * 10) / 10;
  return Math.round(parsed * 10) / 10;
}

export function formatRating(value) {
  const rating = normaliseRating(value);
  return rating === null ? '' : rating.toFixed(1);
}

/** Colour tone for a 0-10 score, used for IMDb-style rating rings. */
export function ratingTone(value) {
  const rating = normaliseRating(value);
  if (rating === null) return 'unknown';
  if (rating >= 8) return 'great';
  if (rating >= 6.5) return 'good';
  if (rating >= 5) return 'mixed';
  return 'weak';
}

/** "169m" / "2h 49m" / seconds -> "2h 49m". */
export function formatRuntime(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const total = Number(text);
    if (total < 60) return `${total}m`;
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (/h|m|min/i.test(text)) return text.replace(/\s+/g, ' ');
  return text;
}

/** Seconds -> "1:02:33" (or "12:45"). */
export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function relativeTime(seconds) {
  const stamp = Number(seconds) || 0;
  if (!stamp) return '';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - stamp);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}w ago`;
  return new Date(stamp * 1000).toLocaleDateString();
}

export function parseYear(value) {
  const match = String(value || '').match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

/** Stable hue from a title, used for poster fallbacks. */
export function hashHue(value = '') {
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash % 360);
}

export function itemProvider(item) {
  return item?.id?.provider || item?.provider || '';
}

export function itemId(item) {
  return item?.id?.value || item?.id || '';
}

export function itemTitle(item) {
  return item?.title || 'Untitled';
}

export function itemYear(item) {
  return item?.year || item?.release_year || '';
}

export function itemPoster(item) {
  return item?.poster_url || item?.cover_url || '';
}

export function isSeriesItem(item) {
  return item?.media_type === 'series' || Number(item?.stype) === 2 || Number(item?.season_count) > 0;
}

export function mediaTypeLabel(item) {
  return isSeriesItem(item) ? 'Series' : 'Movie';
}

export function seasonCount(item) {
  const count = Number(item?.season_count);
  return Number.isFinite(count) && count > 0 ? count : null;
}

/** "Dune: Part Two" -> "Dune" (used for grouping/franchise hints in the UI). */
export function franchiseToken(title = '') {
  const stop = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'for', 'part']);
  const word = String(title)
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .find((token) => token.length > 3 && !stop.has(token.toLowerCase()));
  return word || '';
}
