// Sidify-V2 UI primitives & Media Cards wired to Ifallhub's `/api/*` catalog & library.

import {
  escapeHtml,
  formatRating,
  isSeriesItem,
  itemId,
  itemPoster,
  itemProvider,
  itemTitle,
  itemYear,
  providerLabel,
  relativeTime,
} from '../lib/format.js';
import { detailPathFor, itemGenres, mediaArt, officialRatingOf } from '../lib/media-helpers.js';
import { watchPath } from '../lib/router.js';
import { progressFraction } from '../lib/recommend.js';
import { iconHtml } from './icons.js';

export const SVG = {
  play: iconHtml('play', { size: 15 }),
  plus: iconHtml('bookmark', { size: 15 }),
  check: iconHtml('check', { size: 15 }),
  info: iconHtml('info', { size: 15 }),
  star: iconHtml('starFilled', { size: 11 }),
  download: iconHtml('download', { size: 15 }),
  chevronLeft: iconHtml('chevronLeft', { size: 18 }),
  chevronRight: iconHtml('chevronRight', { size: 18 }),
};

export function pageTitleHtml(title, { subtitle = '', trailingHtml = '' } = {}) {
  return `
    <div class="flex flex-wrap items-end justify-between gap-4 px-4 pt-3 pb-4 desk:px-8 desk:pt-7 desk:pb-6">
      <div class="min-w-0">
        <h1 class="t-display desk:t-headline truncate">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="mt-1 text-[14px] text-fg-2">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${trailingHtml ? `<div class="shrink-0">${trailingHtml}</div>` : ''}
    </div>`;
}

export function sectionHeaderHtml(title, { subtitle = '', actionHtml = '' } = {}) {
  return `
    <div class="mb-3 flex items-baseline justify-between gap-4 px-4 desk:px-8">
      <div class="min-w-0">
        <h2 class="t-section truncate">${escapeHtml(title)}</h2>
        ${subtitle ? `<p class="mt-0.5 truncate text-[13px] text-fg-2">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${actionHtml || ''}
    </div>`;
}

/**
 * Sidify-V2 `PosterCard`: 2:3 movie/series poster with top-left rating badge,
 * top-right bookmark button, deterministic SVG fallback artwork, and 2-line caption.
 */
export function posterCardHtml(item, meta = {}) {
  const provider = meta.provider || itemProvider(item);
  const id = meta.id || itemId(item);
  const title = meta.title || itemTitle(item);
  const year = meta.year ?? itemYear(item);
  const series = meta.isSeries ?? isSeriesItem(item);
  const kind = series ? 'series' : 'movie';
  const fallback = mediaArt(title, year, kind, 'poster');
  const poster = meta.poster || itemPoster(item) || fallback;
  const rating = formatRating(meta.rating ?? officialRatingOf(item, meta.metaEntry));
  const listed = Boolean(meta.listed);
  const progress = meta.progress ? progressFraction(meta.progress) : 0;
  const genres = itemGenres(item, meta.metaEntry);
  const href = detailPathFor(provider, id, series);

  const episodeLabel =
    meta.progress && Number(meta.progress.season) > 0
      ? `S${Number(meta.progress.season)} · E${Number(meta.progress.episode) || 1}`
      : '';

  const subBits = [
    year ? String(year) : '',
    episodeLabel || genres[0] || (provider !== 'moviebox' ? providerLabel(provider) : series ? 'Series' : 'Film'),
  ].filter(Boolean);

  const widthClass =
    meta.widthClass || 'w-[146px] desk:w-[164px]';

  return `
    <div
      class="group/poster relative shrink-0 select-none ${escapeHtml(widthClass)}"
      data-card
      data-provider="${escapeHtml(provider)}"
      data-id="${escapeHtml(id)}"
      data-title="${escapeHtml(title)}"
      data-year="${escapeHtml(year || '')}"
      data-poster="${escapeHtml(itemPoster(item) || '')}"
      data-type="${series ? 'series' : 'movie'}"
      data-rating="${escapeHtml(rating || '')}"
    >
      <a href="${escapeHtml(href)}" data-nav class="block focus:outline-none" aria-label="${escapeHtml(title)}">
        <div class="relative aspect-[2/3] overflow-hidden rounded-[10px] bg-raised ring-1 ring-edge">
          <img
            src="${escapeHtml(poster)}"
            data-fallback-src="${escapeHtml(fallback)}"
            alt="${escapeHtml(title)}"
            loading="lazy"
            decoding="async"
            class="h-full w-full object-cover transition-transform duration-500 ease-out group-hover/poster:scale-[1.04]"
          />
          <span
            data-card-rating
            ${rating ? '' : 'hidden'}
            class="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-[3px] text-[11px] font-semibold text-white backdrop-blur-md"
          >
            ${SVG.star}
            <span data-card-rating-val>${escapeHtml(rating || '')}</span>
          </span>
          ${
            progress > 0 && progress < 1
              ? `<span class="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/55 backdrop-blur-sm">
                   <span class="block h-full rounded-full bg-brand" style="width:${Math.round(progress * 100)}%"></span>
                 </span>`
              : progress >= 1
                ? `<span class="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-[2px] text-[10.5px] font-semibold text-white/90 backdrop-blur-md">Watched</span>`
                : ''
          }
          ${
            meta.personalRating
              ? `<span class="absolute bottom-2 right-2 rounded-full bg-brand/95 px-2 py-[2px] text-[10.5px] font-bold text-white shadow">★ ${escapeHtml(String(meta.personalRating))}</span>`
              : ''
          }
        </div>
        <div class="mt-2 truncate text-[14px] leading-snug font-medium text-fg" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <div class="truncate text-[12.5px] leading-snug text-fg-2" data-card-sub>${escapeHtml(subBits.join(' · '))}</div>
      </a>
      <button
        type="button"
        data-watchlist="${listed ? '1' : '0'}"
        aria-label="${listed ? `Remove ${escapeHtml(title)} from Watchlist` : `Add ${escapeHtml(title)} to Watchlist`}"
        aria-pressed="${listed ? 'true' : 'false'}"
        class="absolute top-2 right-2 z-10 grid h-8 w-8 place-items-center rounded-full backdrop-blur-md transition ${
          listed
            ? 'pill-selected'
            : 'bg-black/55 text-white opacity-95 desk:opacity-0 desk:group-hover/poster:opacity-100 focus:opacity-100 hover:bg-black/75'
        }"
      >
        ${iconHtml(listed ? 'bookmarkFilled' : 'bookmark', { size: 15 })}
      </button>
    </div>`;
}

export function cardHtml(item, meta = {}) {
  return posterCardHtml(item, meta);
}

export function cardGridHtml(items, metaFor = () => ({})) {
  return `
    <div class="grid grid-cols-2 gap-x-3.5 gap-y-6 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      ${items.map((item) => posterCardHtml(item, { ...metaFor(item), widthClass: '!w-auto' })).join('')}
    </div>`;
}

export function shelfHtml({ key = 'shelf', title = '', subtitle = '', actionHtml = '', itemsHtml = '' } = {}) {
  return `
    <section data-rail="${escapeHtml(key)}">
      ${title ? sectionHeaderHtml(title, { subtitle, actionHtml }) : ''}
      <div class="group/shelf relative">
        <div data-track class="no-scrollbar flex gap-3.5 overflow-x-auto px-4 pb-1 scroll-smooth desk:gap-5 desk:px-8">
          ${itemsHtml}
        </div>
        <button
          type="button"
          data-scroll="-1"
          aria-label="Scroll ${escapeHtml(title || 'row')} left"
          class="chrome-glass absolute top-1/2 left-2 z-10 hidden h-[34px] w-[34px] -translate-y-1/2 place-items-center rounded-full text-fg opacity-0 ring-1 ring-edge transition-opacity group-hover/shelf:opacity-100 hover:bg-raised-2 desk:grid"
        >
          ${SVG.chevronLeft}
        </button>
        <button
          type="button"
          data-scroll="1"
          aria-label="Scroll ${escapeHtml(title || 'row')} right"
          class="chrome-glass absolute top-1/2 right-2 z-10 hidden h-[34px] w-[34px] -translate-y-1/2 place-items-center rounded-full text-fg opacity-0 ring-1 ring-edge transition-opacity group-hover/shelf:opacity-100 hover:bg-raised-2 desk:grid"
        >
          ${SVG.chevronRight}
        </button>
      </div>
    </section>`;
}

export function rowHtml({ key, title, hint = '', itemsHtml, action = '' }) {
  return shelfHtml({ key, title, subtitle: hint, actionHtml: action, itemsHtml });
}

export function chipsHtml(options = [], value = '', { className = '', attrName = 'data-chip-val' } = {}) {
  return `
    <div role="tablist" class="no-scrollbar flex gap-1.5 overflow-x-auto ${escapeHtml(className)}">
      ${options
        .map((opt) => {
          const on = String(opt.id) === String(value);
          return `<button
            type="button"
            role="tab"
            aria-selected="${on ? 'true' : 'false'}"
            ${attrName}="${escapeHtml(String(opt.id))}"
            class="h-8 shrink-0 rounded-full px-3.5 text-[13.5px] font-semibold transition-colors ${
              on ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
            }"
          >${escapeHtml(opt.label)}</button>`;
        })
        .join('')}
    </div>`;
}

export function chipHtml(label, { active = false, href = '', dataset = '' } = {}) {
  const classes = `inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13.5px] font-semibold transition-colors ${
    active ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
  }`;
  if (href) return `<a class="${classes}" href="${escapeHtml(href)}" data-nav ${dataset}>${escapeHtml(label)}</a>`;
  return `<button class="${classes}" type="button" ${dataset}>${escapeHtml(label)}</button>`;
}

export function posterGridSkeletonHtml(count = 12) {
  return `
    <div class="grid grid-cols-2 gap-x-3.5 gap-y-6 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      ${Array.from(
        { length: count },
        () => `
        <div>
          <div class="skeleton aspect-[2/3] w-full rounded-[10px]"></div>
          <div class="skeleton mt-2 h-3.5 w-3/4 rounded"></div>
          <div class="skeleton mt-1.5 h-3 w-1/2 rounded"></div>
        </div>`,
      ).join('')}
    </div>`;
}

export function skeletonCards(count = 8) {
  return Array.from(
    { length: count },
    () => `
    <div class="w-[146px] shrink-0 desk:w-[164px]">
      <div class="skeleton aspect-[2/3] w-full rounded-[10px]"></div>
      <div class="skeleton mt-2 h-3.5 w-3/4 rounded"></div>
    </div>`,
  ).join('');
}

export function emptyStateHtml({ icon = 'clapperboard', title = '', message = '', action = '' } = {}) {
  return `
    <div class="mx-auto flex max-w-[380px] flex-col items-center px-6 py-16 text-center">
      <div class="mb-4 grid h-14 w-14 place-items-center rounded-full bg-fill text-fg-2">
        ${iconHtml(icon, { size: 24 })}
      </div>
      <div class="t-title">${escapeHtml(title)}</div>
      ${message ? `<p class="mt-1.5 text-[14px] leading-relaxed text-fg-2">${escapeHtml(message)}</p>` : ''}
      ${action ? `<div class="mt-5">${action}</div>` : ''}
    </div>`;
}

export function errorStateHtml({ title = 'Something went wrong', message = '', retry = true } = {}) {
  return emptyStateHtml({
    icon: 'info',
    title,
    message: message || 'The backend could not complete this request right now.',
    action: retry
      ? `<button type="button" data-retry class="inline-flex h-10 items-center gap-2 rounded-full bg-fill px-5 text-[14px] font-semibold text-fg hover:bg-fill-2">
           ${iconHtml('refresh', { size: 15 })}
           <span>Try again</span>
         </button>`
      : '',
  });
}

export function spinnerHtml(label = 'Loading…') {
  return `
    <div class="flex items-center justify-center gap-2.5 py-14 text-[14px] text-fg-2">
      ${iconHtml('loader2', { size: 18, className: 'animate-spin' })}
      <span>${escapeHtml(label)}</span>
    </div>`;
}

export function progressRowHtml(entry, { index = 0 } = {}) {
  const fraction = progressFraction(entry);
  const percent = Math.round(fraction * 100);
  const provider = entry.provider || 'moviebox';
  const id = entry.id;
  const title = entry.title || 'Untitled';
  const series = entry.media_type === 'series' || Number(entry.season) > 0;
  const fallback = mediaArt(title, entry.year || '', series ? 'series' : 'movie', 'poster');
  const poster = entry.poster_url || fallback;
  const href = detailPathFor(provider, id, series);

  return `
    <div
      class="group flex items-center gap-3.5 rounded-[12px] bg-raised/75 px-3.5 py-2.5 ring-1 ring-edge transition-colors hover:bg-raised"
      data-card
      data-provider="${escapeHtml(provider)}"
      data-id="${escapeHtml(id)}"
      data-title="${escapeHtml(title)}"
      data-year="${escapeHtml(entry.year || '')}"
      data-poster="${escapeHtml(entry.poster_url || '')}"
      data-type="${series ? 'series' : 'movie'}"
      data-season="${escapeHtml(String(entry.season || 0))}"
      data-episode="${escapeHtml(String(entry.episode || 0))}"
    >
      <span class="w-5 shrink-0 text-center text-[13px] font-medium tabular-nums text-fg-3">${index + 1}</span>
      <a href="${escapeHtml(href)}" data-nav class="relative h-14 w-10 shrink-0 overflow-hidden rounded-[6px] bg-raised ring-1 ring-edge">
        <img src="${escapeHtml(poster)}" data-fallback-src="${escapeHtml(fallback)}" alt="" loading="lazy" class="h-full w-full object-cover" />
      </a>
      <a href="${escapeHtml(href)}" data-nav class="min-w-0 flex-1">
        <div class="truncate text-[14.5px] font-semibold text-fg">${escapeHtml(title)}</div>
        <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-2">
          ${Number(entry.season) > 0 ? `<span class="font-medium text-fg">S${Number(entry.season)} · E${Number(entry.episode) || 1}</span><span>·</span>` : ''}
          <span>${escapeHtml(providerLabel(provider))}</span>
          <span>·</span>
          <span>${escapeHtml(relativeTime(entry.updated_at))}</span>
        </div>
        <div class="mt-1.5 h-1 w-full max-w-[260px] overflow-hidden rounded-full bg-fill-2">
          <div class="h-full rounded-full bg-brand" style="width:${percent}%"></div>
        </div>
      </a>
      <div class="flex shrink-0 items-center gap-1.5">
        <span class="hidden text-[12px] font-medium tabular-nums text-fg-2 sm:inline">${percent}%</span>
        <a
          href="${escapeHtml(watchPath(provider, id, { season: Number(entry.season) || 0, episode: Number(entry.episode) || 0 }))}"
          data-nav
          aria-label="Resume ${escapeHtml(title)}"
          class="pill-selected inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition active:scale-[0.98]"
        >
          ${iconHtml('play', { size: 12 })}
          <span>Resume</span>
        </a>
        <button
          type="button"
          data-clear-progress
          aria-label="Remove ${escapeHtml(title)} from history"
          class="grid h-8 w-8 place-items-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg"
        >
          ${iconHtml('x', { size: 15 })}
        </button>
      </div>
    </div>`;
}
