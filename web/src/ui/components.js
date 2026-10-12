// HTML builders for the shared UI pieces (cards, carousels, states).
// Everything is escaped; behaviour is attached through delegated data-* hooks.

import {
  escapeHtml,
  formatRating,
  formatRuntime,
  hashHue,
  itemId,
  itemPoster,
  itemProvider,
  itemTitle,
  itemYear,
  mediaTypeLabel,
  providerLabel,
  ratingTone,
  relativeTime,
  seasonCount,
} from '../lib/format.js';
import { progressFraction } from '../lib/recommend.js';

const SVG = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.7" /><path d="M12 11v5M12 8h.01" /></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8z" /></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>',
};

export { SVG };

export function posterFallbackHtml(title, provider) {
  const hue = hashHue(title);
  return `
    <div class="card-fallback" style="--poster-glow: hsla(${hue}, 64%, 57%, .5); --poster-top: hsl(${hue}, 24%, 22%);">
      <span class="fallback-kicker">${escapeHtml(providerLabel(provider))}</span>
      <span class="fallback-art">${escapeHtml(String(title).trim().slice(0, 1).toUpperCase() || 'I')}</span>
      <span class="fallback-title">${escapeHtml(title)}</span>
    </div>`;
}

/**
 * Poster card. `meta` may carry `rating`, `reason`, `progress` (a library
 * progress entry) and `listed` for the watchlist state.
 */
export function cardHtml(item, meta = {}) {
  const provider = meta.provider || itemProvider(item);
  const id = meta.id || itemId(item);
  const title = meta.title || itemTitle(item);
  const poster = meta.poster || itemPoster(item);
  const year = meta.year ?? itemYear(item);
  const type = meta.type || mediaTypeLabel(item);
  const rating = formatRating(meta.rating ?? item?.imdb_rating);
  const progress = meta.progress ? progressFraction(meta.progress) : 0;
  const listed = Boolean(meta.listed);
  const seasons = seasonCount(item);
  const runtime = formatRuntime(meta.duration || item?.duration);
  const episodeLabel =
    meta.progress && Number(meta.progress.season) > 0
      ? `S${Number(meta.progress.season)} · E${Number(meta.progress.episode) || 1}`
      : '';

  const metaBits = [
    year ? escapeHtml(year) : '',
    seasons ? `${seasons} Season${seasons > 1 ? 's' : ''}` : '',
    runtime ? escapeHtml(runtime) : '',
    episodeLabel ? escapeHtml(episodeLabel) : '',
    escapeHtml(providerLabel(provider)),
  ].filter(Boolean);

  return `
    <article class="card ${meta.size === 'wide' ? 'card-wide' : ''}" data-card
      data-provider="${escapeHtml(provider)}" data-id="${escapeHtml(id)}"
      data-title="${escapeHtml(title)}" data-year="${escapeHtml(year || '')}"
      data-poster="${escapeHtml(poster || '')}" data-type="${escapeHtml(String(item?.media_type || 'movie'))}"
      tabindex="0" role="link" aria-label="${escapeHtml(title)} — open details">
      <div class="card-media">
        ${poster ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy" decoding="async" />` : ''}
        ${posterFallbackHtml(title, provider)}
        ${rating ? `<span class="card-rating tone-${ratingTone(rating)}">${SVG.star}<span>${escapeHtml(rating)}</span></span>` : ''}
        <span class="card-type">${escapeHtml(type)}</span>
        ${progress > 0 && progress < 1 ? `<span class="card-progress"><span style="width:${Math.round(progress * 100)}%"></span></span>` : ''}
        ${progress >= 1 ? '<span class="card-done">Watched</span>' : ''}
        <div class="card-hover">
          <button class="card-action card-action-primary" type="button" data-play title="Play ${escapeHtml(title)}" aria-label="Play ${escapeHtml(title)}">${SVG.play}</button>
          <button class="card-action" type="button" data-watchlist="${listed ? '1' : '0'}" title="${listed ? 'Remove from My List' : 'Add to My List'}" aria-label="${listed ? 'Remove from My List' : 'Add to My List'}">${listed ? SVG.check : SVG.plus}</button>
          <button class="card-action" type="button" data-open title="More info" aria-label="More info about ${escapeHtml(title)}">${SVG.info}</button>
        </div>
        ${meta.reason ? `<span class="card-reason">${escapeHtml(meta.reason)}</span>` : ''}
      </div>
      <div class="card-info">
        <h3 class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
        <p class="card-meta">${metaBits.join('<span class="dot"></span>')}</p>
        ${meta.note ? `<p class="card-note">${escapeHtml(meta.note)}</p>` : ''}
      </div>
    </article>`;
}

export function cardGridHtml(items, metaFor = () => ({}), { size = '' } = {}) {
  return items.map((item) => cardHtml(item, { ...metaFor(item), size })).join('');
}

export function rowHtml({ key, title, hint = '', itemsHtml, count = null, action = '' }) {
  return `
    <section class="rail" data-rail="${escapeHtml(key)}">
      <header class="rail-head">
        <div>
          <h2 class="rail-title">${escapeHtml(title)}</h2>
          ${hint ? `<p class="rail-hint">${escapeHtml(hint)}</p>` : ''}
        </div>
        <div class="rail-tools">
          ${count !== null ? `<span class="rail-count">${escapeHtml(String(count))}</span>` : ''}
          ${action}
          <button class="rail-arrow" type="button" data-scroll="-1" aria-label="Scroll ${escapeHtml(title)} left">${SVG.chevronLeft}</button>
          <button class="rail-arrow" type="button" data-scroll="1" aria-label="Scroll ${escapeHtml(title)} right">${SVG.chevronRight}</button>
        </div>
      </header>
      <div class="rail-track" data-track>${itemsHtml}</div>
    </section>`;
}

export function skeletonCards(count = 8) {
  return Array.from({ length: count }, () => '<div class="card-skeleton"></div>').join('');
}

export function skeletonRow(title = 'Loading') {
  return rowHtml({ key: `skeleton-${title}`, title, itemsHtml: skeletonCards() });
}

export function emptyStateHtml({ title, message, action = '' }) {
  return `
    <div class="empty-state">
      <div class="empty-mark">${SVG.star}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${action}
    </div>`;
}

export function errorStateHtml({ title = 'Something went wrong', message, retry = true }) {
  return `
    <div class="error-state">
      <div class="error-mark">!</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message || 'The engine could not complete this request.')}</p>
      ${retry ? '<button class="ghost-button" type="button" data-retry>Try again ↻</button>' : ''}
    </div>`;
}

export function spinnerHtml(label = 'Loading…') {
  return `<div class="loading-state"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

/** IMDb-style circular score. */
export function ratingRingHtml(rating, { label = 'IMDb', size = 'md' } = {}) {
  const value = formatRating(rating);
  const tone = ratingTone(value);
  if (!value) {
    return `<div class="rating-ring tone-unknown size-${size}"><span class="ring-value">–</span><span class="ring-label">${escapeHtml(label)}</span></div>`;
  }
  const percent = Math.min(100, (Number(value) / 10) * 100);
  return `
    <div class="rating-ring tone-${tone} size-${size}" role="img" aria-label="${escapeHtml(label)} rating ${escapeHtml(value)} out of 10">
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle class="ring-bg" cx="18" cy="18" r="15.9"></circle>
        <circle class="ring-fg" cx="18" cy="18" r="15.9" stroke-dasharray="${percent.toFixed(1)} 100"></circle>
      </svg>
      <span class="ring-value">${escapeHtml(value)}</span>
      <span class="ring-label">${escapeHtml(label)}</span>
    </div>`;
}

export function chipHtml(label, { active = false, href = '', dataset = '' } = {}) {
  const classes = `chip${active ? ' is-active' : ''}`;
  const inner = `<span>${escapeHtml(label)}</span>`;
  if (href) return `<a class="${classes}" href="${escapeHtml(href)}" data-nav ${dataset}>${inner}</a>`;
  return `<button class="${classes}" type="button" ${dataset}>${inner}</button>`;
}

export function progressRowHtml(entry, { index = 0 } = {}) {
  const fraction = progressFraction(entry);
  const percent = Math.round(fraction * 100);
  const provider = entry.provider;
  const id = entry.id;
  const title = entry.title || 'Untitled';
  const poster = entry.poster_url || '';
  return `
    <article class="progress-row" data-card data-provider="${escapeHtml(provider)}" data-id="${escapeHtml(id)}"
      data-title="${escapeHtml(title)}" data-year="${escapeHtml(entry.year || '')}"
      data-poster="${escapeHtml(poster || '')}" data-type="${escapeHtml(entry.media_type || 'movie')}" tabindex="0" role="link">
      <span class="progress-index">${index + 1}</span>
      <span class="progress-thumb">
        ${poster ? `<img src="${escapeHtml(poster)}" alt="" loading="lazy" />` : ''}
        ${posterFallbackHtml(title, provider)}
      </span>
      <span class="progress-copy">
        <span class="progress-title">${escapeHtml(title)}</span>
        <span class="progress-sub">
          ${Number(entry.season) > 0 ? `S${Number(entry.season)} · E${Number(entry.episode) || 1}<span class="dot"></span>` : ''}
          ${escapeHtml(providerLabel(provider))}<span class="dot"></span>${escapeHtml(relativeTime(entry.updated_at))}
        </span>
        <span class="progress-bar"><span style="width:${percent}%"></span></span>
      </span>
      <span class="progress-actions">
        <span class="progress-percent">${percent}%</span>
        <button class="icon-button" type="button" data-play title="Resume ${escapeHtml(title)}" aria-label="Resume ${escapeHtml(title)}">${SVG.play}</button>
        <button class="icon-button" type="button" data-clear-progress title="Remove from Continue Watching" aria-label="Remove ${escapeHtml(title)} from Continue Watching">✕</button>
      </span>
    </article>`;
}
