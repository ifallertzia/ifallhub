// Sidify-V2 `MediaDetailView` (`MovieWatchSection`, `SeasonTabsSection`, `EpisodeRow`,
// and `More like this` Shelf) wired to Ifallhub's `/api/details`, `/api/streams`,
// `/api/related`, and `/api/library`.

import * as api from '../lib/api.js';
import {
  SERVER_ROTATION,
  displayUiText,
  escapeHtml,
  formatClock,
  formatRating,
  formatRuntime,
  isSeriesItem,
  itemId,
  itemPoster,
  itemProvider,
  itemTitle,
  itemYear,
  providerLabel,
} from '../lib/format.js';
import * as library from '../lib/library.js';
import {
  initialSeasonNumber,
  itemBackdrop,
  itemGenres,
  mediaArt,
  orderedSeasonNumbers,
  summariseReleases,
} from '../lib/media-helpers.js';
import { rankRelated, similarByMeta } from '../lib/recommend.js';
import {
  cacheDetails,
  cachedDetails,
  cachedMeta,
  ensureMeta,
  setAmbientSeed,
  state,
  toast,
} from '../state.js';
import {
  chipsHtml,
  errorStateHtml,
  posterCardHtml,
  sectionHeaderHtml,
  shelfHtml,
} from '../ui/components.js';
import { iconHtml } from '../ui/icons.js';
import {
  openBetaPlayerSheet,
  openQualityPickerSheet,
  openVlcPickerSheet,
} from '../ui/sheets.js';

function watchActionsHtml({
  season = 0,
  episode = 0,
  resumeLabel = '',
  size = 'md',
} = {}) {
  const sm = size === 'sm';
  const primaryCls = sm
    ? 'inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition active:scale-[0.98]'
    : 'inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-semibold text-on-primary transition active:scale-[0.98]';
  const secondaryCls = sm
    ? 'inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3 text-[12.5px] font-semibold text-fg transition hover:bg-fill-3 active:scale-[0.98]'
    : 'inline-flex h-10 items-center gap-2 rounded-full bg-fill-2 px-4 text-[14px] font-semibold text-fg transition hover:bg-fill-3 active:scale-[0.98]';

  const dataAttrs = `data-season="${escapeHtml(String(season || 0))}" data-episode="${escapeHtml(String(episode || 0))}"`;

  return `
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" data-action-try-play ${dataAttrs} class="${primaryCls}">
        ${iconHtml('play', { size: sm ? 12 : 14 })}
        <span>${escapeHtml(resumeLabel || 'Try Play')}</span>
        <span class="rounded-full bg-black/15 px-1.5 py-[1px] text-[10px] font-bold tracking-wide uppercase">Beta</span>
      </button>
      <button type="button" data-action-vlc ${dataAttrs} class="${secondaryCls}">
        ${iconHtml('monitorPlay', { size: sm ? 13 : 15 })}
        <span>Play with VLC</span>
      </button>
      <button type="button" data-action-download ${dataAttrs} class="${secondaryCls}">
        ${iconHtml('download', { size: sm ? 13 : 15 })}
        <span>Download</span>
      </button>
    </div>`;
}

export async function renderDetails(container, ctx = {}, { autoPlayOnMount = false } = {}) {
  const provider = decodeURIComponent(ctx.params?.provider || state.provider || 'moviebox');
  const id = decodeURIComponent(ctx.params?.id || '');

  if (!id) {
    container.innerHTML = errorStateHtml({ title: 'Title not found', message: 'Missing title identifier.', retry: false });
    return;
  }

  container.innerHTML = `
    <div class="fade-up pb-14">
      <div class="relative -mt-2 min-h-[420px] bg-raised desk:min-h-[480px]">
        <div class="flex min-h-[420px] items-end gap-6 p-5 desk:min-h-[480px] desk:p-10">
          <div class="skeleton aspect-[2/3] w-[118px] shrink-0 rounded-[12px] desk:w-[216px]"></div>
          <div class="flex-1 space-y-3 pb-2">
            <div class="skeleton h-4 w-28 rounded-full"></div>
            <div class="skeleton h-10 w-2/3 rounded-lg"></div>
            <div class="skeleton h-4 w-1/2 rounded"></div>
            <div class="skeleton h-16 w-full max-w-[540px] rounded-lg"></div>
          </div>
        </div>
      </div>
    </div>`;

  let details = cachedDetails(provider, id);
  if (!details) {
    try {
      details = await api.details({ provider, id }, { signal: ctx.signal });
      cacheDetails(provider, id, details);
    } catch (err) {
      if (ctx.signal?.aborted) return;
      container.innerHTML = errorStateHtml({
        title: 'Couldn’t load this title',
        message: displayUiText(err.message),
      });
      container.querySelector('[data-retry]')?.addEventListener('click', () => {
        void renderDetails(container, ctx, { autoPlayOnMount });
      });
      return;
    }
  }
  if (ctx.signal?.aborted) return;

  const isSeries = isSeriesItem(details);
  const title = itemTitle(details);
  const year = itemYear(details);
  const kind = isSeries ? 'series' : 'movie';
  setAmbientSeed(title);

  const seasons = Array.isArray(details.seasons) ? details.seasons : [];
  let selectedSeason = initialSeasonNumber(seasons, ctx.query?.get('season') || ctx.query?.get('s'));
  let ratingOpen = false;
  let movieStreamSummary = '';
  let relatedRanked = [];

  const posterFallback = mediaArt(title, year, kind, 'poster');
  const backdropFallback = mediaArt(title, year, kind, 'backdrop');

  function heroResumeInfo() {
    const saved = library.progressFor(provider, id);
    if (!saved || saved.completed || !(Number(saved.position_seconds) > 5)) {
      return { season: isSeries ? selectedSeason : 0, episode: isSeries ? 1 : 0, label: 'Try Play' };
    }
    if (isSeries && Number(saved.season) > 0) {
      return {
        season: Number(saved.season),
        episode: Math.max(1, Number(saved.episode) || 1),
        label: `Resume S${saved.season}·E${saved.episode || 1} (${formatClock(saved.position_seconds)})`,
      };
    }
    return {
      season: 0,
      episode: 0,
      label: `Resume ${formatClock(saved.position_seconds)}`,
    };
  }

  function renderSeasonSection() {
    const seasonNums = orderedSeasonNumbers(seasons);
    if (!seasonNums.length) {
      // Fallback single season with 1 episode when provider didn't enumerate episodes
      return `
        <section>
          ${sectionHeaderHtml('Episodes', { subtitle: 'Season 1' })}
          <div class="rounded-[12px] bg-fill/40 px-3.5 py-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-[14px] font-semibold text-fg">Season 1 · Episode 1</div>
              <div class="text-[12px] text-fg-2">Stream or open in VLC</div>
            </div>
            ${watchActionsHtml({ season: 1, episode: 1, size: 'sm' })}
          </div>
        </section>`;
    }

    const activeSeasonObj =
      seasons.find((s) => Number(s.season_number) === selectedSeason) || seasons[0];
    const sNum = Number(activeSeasonObj?.season_number) || selectedSeason;
    const epTotal = Math.max(
      1,
      Number(activeSeasonObj?.episode_count) || (activeSeasonObj?.episodes?.length || 1),
    );
    const episodes =
      Array.isArray(activeSeasonObj?.episodes) && activeSeasonObj.episodes.length
        ? activeSeasonObj.episodes
        : Array.from({ length: epTotal }, (_, idx) => ({
            episode_number: idx + 1,
            title: `Episode ${idx + 1}`,
          }));

    const saved = library.progressFor(provider, id);

    return `
      <section>
        ${sectionHeaderHtml('Seasons & episodes', {
          subtitle: `${seasonNums.length} ${seasonNums.length === 1 ? 'season' : 'seasons'}`,
        })}
        <div class="px-4 desk:px-0">
          ${chipsHtml(
            seasonNums.map((n) => ({ id: String(n), label: `Season ${n}` })),
            String(sNum),
            { className: 'mb-4', attrName: 'data-season-tab' },
          )}
          <ol class="space-y-2">
            ${episodes
              .map((ep, idx) => {
                const epNum = Number(ep.episode_number ?? ep.episodeNumber ?? idx + 1);
                const epTitle = ep.title || ep.name || `Episode ${epNum}`;
                const epDur = formatRuntime(ep.duration || ep.runtime);
                const isSavedEp =
                  saved &&
                  !saved.completed &&
                  Number(saved.season) === sNum &&
                  Number(saved.episode) === epNum &&
                  Number(saved.position_seconds) > 5;
                const resumeLabel = isSavedEp ? `Resume ${formatClock(saved.position_seconds)}` : '';

                return `
                  <li class="flex flex-col gap-3 rounded-[12px] bg-fill/40 px-3.5 py-3 transition-colors hover:bg-fill/65 sm:flex-row sm:items-center sm:justify-between">
                    <div class="flex min-w-0 items-start gap-3">
                      <div class="mt-0.5 w-7 shrink-0 text-right text-[13px] font-semibold tabular-nums text-fg-3">
                        ${epNum}
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-baseline gap-2">
                          <span class="truncate text-[14.5px] font-semibold text-fg">${escapeHtml(epTitle)}</span>
                          ${epDur ? `<span class="text-[12px] text-fg-2 tabular-nums">${escapeHtml(epDur)}</span>` : ''}
                          ${isSavedEp ? `<span class="rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-semibold text-fg">In progress</span>` : ''}
                        </div>
                        ${
                          ep.overview || ep.description
                            ? `<p class="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-fg-2">${escapeHtml(ep.overview || ep.description)}</p>`
                            : ''
                        }
                      </div>
                    </div>
                    <div class="shrink-0 pl-10 sm:pl-0">
                      ${watchActionsHtml({ season: sNum, episode: epNum, resumeLabel, size: 'sm' })}
                    </div>
                  </li>`;
              })
              .join('')}
          </ol>
        </div>
      </section>`;
  }

  function renderMovieSection() {
    const resume = heroResumeInfo();
    return `
      <section class="rounded-[16px] bg-raised/70 p-4 ring-1 ring-edge desk:p-5">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="truncate text-[15.5px] font-semibold text-fg">
              ${escapeHtml(title)}${year ? ` (${escapeHtml(year)})` : ''}
            </div>
            <div class="mt-0.5 text-[12.5px] text-fg-2" data-stream-summary>
              ${escapeHtml(movieStreamSummary || `Source: ${providerLabel(provider)} · Multi-server auto-fallback ready`)}
            </div>
          </div>
          ${watchActionsHtml({ season: 0, episode: 0, resumeLabel: resume.label === 'Try Play' ? '' : resume.label, size: 'md' })}
        </div>
        <p class="mt-3 text-[12px] leading-relaxed text-fg-2">
          <strong class="text-fg">Try Play</strong> streams right in your browser with automatic server fallback (${SERVER_ROTATION.slice(0, 3).map(providerLabel).join(' → ')}) and online subtitles. If a 4K/BluRay file uses Dolby/DTS audio, open in <strong class="text-fg">VLC</strong> or <strong class="text-fg">Download</strong>.
        </p>
      </section>`;
  }

  function renderRelatedSection() {
    if (!relatedRanked.length) return '';
    return shelfHtml({
      key: 'related',
      title: 'More like this',
      subtitle: relatedRanked[0]?.reasons?.[0] || 'Similar titles you might enjoy',
      itemsHtml: relatedRanked
        .map((entry) => {
          const it = entry.item;
          const p = itemProvider(it);
          const itemIdVal = itemId(it);
          const metaEntry = cachedMeta(p, itemIdVal);
          return posterCardHtml(it, {
            metaEntry,
            rating: entry.rating ?? it.imdb_rating ?? metaEntry?.imdb_rating,
            listed: library.isInWatchlist(p, itemIdVal),
            progress: library.progressFor(p, itemIdVal),
            personalRating: library.ratingFor(p, itemIdVal),
          });
        })
        .join(''),
    });
  }

  function renderPage() {
    if (ctx.signal?.aborted) return;
    const poster = itemPoster(details) || posterFallback;
    const backdrop = itemBackdrop(details) || backdropFallback;
    const rating = formatRating(details.imdb_rating);
    const runtime = formatRuntime(details.duration);
    const genres = itemGenres(details);
    const listed = library.isInWatchlist(provider, id);
    const myRating = library.ratingFor(provider, id);
    const resume = heroResumeInfo();

    const metaBits = [
      year,
      isSeries && seasons.length
        ? `${seasons.length} ${seasons.length === 1 ? 'season' : 'seasons'}`
        : runtime,
      Array.isArray(details.prints) && details.prints.length ? details.prints.slice(0, 3).join(' / ') : '',
      Array.isArray(details.audios) && details.audios.length ? details.audios.slice(0, 2).join(', ') : '',
    ].filter(Boolean);

    const creditsBits = [
      details.director ? `Directed by ${details.director}` : '',
      Array.isArray(details.cast) && details.cast.length ? `Cast: ${details.cast.slice(0, 5).join(', ')}` : '',
    ].filter(Boolean);

    const browseBase = isSeries ? '/series' : '/movies';

    container.innerHTML = `
      <div
        class="fade-up pb-14"
        data-detail-root
        data-card
        data-provider="${escapeHtml(provider)}"
        data-id="${escapeHtml(id)}"
        data-title="${escapeHtml(title)}"
        data-year="${escapeHtml(year || '')}"
        data-poster="${escapeHtml(itemPoster(details) || '')}"
        data-type="${kind}"
        data-rating="${escapeHtml(rating || '')}"
      >
        <!-- Full-bleed Backdrop Header -->
        <div class="relative -mt-2 overflow-hidden bg-raised">
          <div class="relative min-h-[400px] w-full desk:min-h-[490px]">
            <img
              src="${escapeHtml(backdrop)}"
              data-fallback-src="${escapeHtml(backdropFallback)}"
              alt=""
              aria-hidden="true"
              class="absolute inset-0 h-full w-full object-cover"
            />
            <div
              aria-hidden="true"
              class="absolute inset-0"
              style="background: linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.64) 48%, rgba(0,0,0,0.32) 100%), linear-gradient(180deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.52) 55%, var(--bg) 100%)"
            ></div>

            <div class="relative flex min-h-[400px] flex-col justify-end gap-6 p-5 text-white desk:min-h-[490px] desk:flex-row desk:items-end desk:gap-8 desk:p-10">
              <div class="w-[118px] shrink-0 overflow-hidden rounded-[12px] bg-raised shadow-[0_18px_50px_-14px_rgba(0,0,0,0.8)] ring-1 ring-white/15 desk:w-[216px]">
                <img
                  src="${escapeHtml(poster)}"
                  data-fallback-src="${escapeHtml(posterFallback)}"
                  alt="${escapeHtml(title)}"
                  class="aspect-[2/3] w-full object-cover"
                />
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold tracking-[0.9px] text-white/80 uppercase">
                  <span class="rounded-full bg-white/15 px-2.5 py-1 backdrop-blur-md">
                    ${isSeries ? 'Series' : 'Film'}
                  </span>
                  ${
                    rating
                      ? `<span class="inline-flex items-center gap-1 text-white">
                           ${iconHtml('starFilled', { size: 12 })}
                           ${escapeHtml(rating)}
                         </span>`
                      : ''
                  }
                  <span class="rounded-full bg-white/10 px-2.5 py-1 text-white/75 backdrop-blur-md">
                    ${escapeHtml(providerLabel(provider))}
                  </span>
                </div>

                <h1 class="mt-2.5 text-[30px] leading-[1.06] font-extrabold tracking-[-0.8px] text-white desk:text-[46px] desk:tracking-[-1.2px]">
                  ${escapeHtml(title)}
                </h1>

                ${
                  details.tagline
                    ? `<p class="mt-1.5 text-[14.5px] text-white/70 italic">${escapeHtml(details.tagline)}</p>`
                    : ''
                }

                ${
                  metaBits.length
                    ? `<div class="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] font-medium text-white/80">
                         ${escapeHtml(metaBits.join(' · '))}
                       </div>`
                    : ''
                }

                ${
                  genres.length
                    ? `<div class="mt-2 flex flex-wrap gap-1.5 text-[12.5px] text-white/80">
                         ${genres
                           .map(
                             (g) =>
                               `<a href="${browseBase}?genre=${encodeURIComponent(g)}" data-nav class="rounded-full bg-white/12 px-2.5 py-0.5 transition hover:bg-white/22">${escapeHtml(g)}</a>`,
                           )
                           .join('')}
                       </div>`
                    : ''
                }

                ${
                  details.description
                    ? `<p class="mt-4 max-w-[680px] text-[14px] leading-relaxed text-white/85 desk:text-[15px]">
                         ${escapeHtml(displayUiText(details.description))}
                       </p>`
                    : ''
                }

                ${
                  creditsBits.length
                    ? `<p class="mt-2.5 max-w-[680px] text-[12.5px] text-white/65">
                         ${escapeHtml(creditsBits.join(' · '))}
                       </p>`
                    : ''
                }

                <!-- Sidify-V2 Action Pills Row -->
                <div class="mt-5 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    data-action-try-play
                    data-season="${escapeHtml(String(resume.season))}"
                    data-episode="${escapeHtml(String(resume.episode))}"
                    class="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black shadow-lg transition active:scale-[0.98]"
                  >
                    ${iconHtml('play', { size: 15 })}
                    <span>${escapeHtml(resume.label)}</span>
                    <span class="rounded-full bg-black/10 px-1.5 py-[1px] text-[10px] font-bold tracking-wide text-black/75 uppercase">Beta</span>
                  </button>

                  <button
                    type="button"
                    data-action-vlc
                    data-season="${escapeHtml(String(resume.season))}"
                    data-episode="${escapeHtml(String(resume.episode))}"
                    class="inline-flex h-11 items-center gap-2 rounded-full bg-white/16 px-5 text-[15px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-xl transition hover:bg-white/24 active:scale-[0.98]"
                  >
                    ${iconHtml('monitorPlay', { size: 16 })}
                    <span>Play with VLC</span>
                  </button>

                  <button
                    type="button"
                    data-action-download
                    data-season="${escapeHtml(String(resume.season))}"
                    data-episode="${escapeHtml(String(resume.episode))}"
                    class="inline-flex h-11 items-center gap-2 rounded-full bg-white/16 px-5 text-[15px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-xl transition hover:bg-white/24 active:scale-[0.98]"
                  >
                    ${iconHtml('download', { size: 16 })}
                    <span>Download</span>
                  </button>

                  <button
                    type="button"
                    data-watchlist="${listed ? '1' : '0'}"
                    aria-pressed="${listed ? 'true' : 'false'}"
                    class="inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold backdrop-blur-xl transition active:scale-[0.98] ${
                      listed
                        ? 'bg-white text-black'
                        : 'bg-white/16 text-white ring-1 ring-white/20 hover:bg-white/24'
                    }"
                  >
                    ${iconHtml(listed ? 'check' : 'bookmark', { size: 16 })}
                    <span>${listed ? 'In watchlist' : 'Watchlist'}</span>
                  </button>

                  <button
                    type="button"
                    data-toggle-rate
                    class="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold backdrop-blur-xl transition active:scale-[0.98] ${
                      myRating
                        ? 'bg-white text-black'
                        : 'bg-white/16 text-white ring-1 ring-white/20 hover:bg-white/24'
                    }"
                  >
                    ${iconHtml(myRating ? 'starFilled' : 'star', { size: 15 })}
                    <span>${myRating ? `Rated ${myRating}/10` : 'Rate'}</span>
                  </button>
                </div>

                ${
                  ratingOpen
                    ? `<div class="mt-3 inline-flex flex-wrap items-center gap-1 rounded-[14px] bg-black/65 p-2 ring-1 ring-white/20 backdrop-blur-xl">
                         <span class="px-2 text-[12px] font-medium text-white/75">Your score:</span>
                         ${Array.from({ length: 10 }, (_, idx) => {
                           const score = idx + 1;
                           const on = myRating === score;
                           return `<button type="button" data-rate-score="${score}" class="h-7 w-7 rounded-full text-[12.5px] font-bold transition ${
                             on ? 'bg-white text-black' : 'bg-white/12 text-white hover:bg-white/25'
                           }">${score}</button>`;
                         }).join('')}
                         ${
                           myRating
                             ? `<button type="button" data-rate-score="0" class="ml-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-red-300 hover:bg-white/10">Clear</button>`
                             : ''
                         }
                       </div>`
                    : ''
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Watch / Seasons Section -->
        <div class="space-y-9 px-4 pt-6 desk:px-10">
          ${isSeries ? renderSeasonSection() : renderMovieSection()}
        </div>

        <!-- More Like This Shelf -->
        <div class="mt-9" data-related-slot>
          ${renderRelatedSection()}
        </div>

        <!-- Back Link -->
        <div class="mt-9 px-4 desk:px-10">
          <a
            href="${browseBase}"
            data-nav
            class="inline-flex items-center gap-1 text-[14px] font-semibold text-playing hover:opacity-80"
          >
            ← Back to all ${isSeries ? 'series' : 'movies'}
          </a>
        </div>
      </div>`;
  }

  // Delegated click handler on container
  container.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const seasonBtn = target.closest('[data-season-tab]');
    if (seasonBtn) {
      selectedSeason = Number(seasonBtn.dataset.seasonTab) || 1;
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('season', String(selectedSeason));
      window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}`);
      renderPage();
      return;
    }

    const playBtn = target.closest('[data-action-try-play]');
    if (playBtn) {
      event.preventDefault();
      event.stopPropagation();
      const s = Number(playBtn.dataset.season) || (isSeries ? selectedSeason : 0);
      const e = Number(playBtn.dataset.episode) || (isSeries ? 1 : 0);
      void openBetaPlayerSheet({ provider, id, season: s, episode: e, item: details, details });
      return;
    }

    const vlcBtn = target.closest('[data-action-vlc]');
    if (vlcBtn) {
      event.preventDefault();
      event.stopPropagation();
      const s = Number(vlcBtn.dataset.season) || (isSeries ? selectedSeason : 0);
      const e = Number(vlcBtn.dataset.episode) || (isSeries ? 1 : 0);
      void openVlcPickerSheet({ provider, id, season: s, episode: e, item: details, details });
      return;
    }

    const dlBtn = target.closest('[data-action-download]');
    if (dlBtn) {
      event.preventDefault();
      event.stopPropagation();
      const s = Number(dlBtn.dataset.season) || (isSeries ? selectedSeason : 0);
      const e = Number(dlBtn.dataset.episode) || (isSeries ? 1 : 0);
      void openQualityPickerSheet({ provider, id, season: s, episode: e, item: details, details });
      return;
    }

    if (target.closest('[data-toggle-rate]')) {
      ratingOpen = !ratingOpen;
      renderPage();
      return;
    }

    const scoreBtn = target.closest('[data-rate-score]');
    if (scoreBtn) {
      const score = Number(scoreBtn.dataset.rateScore) || 0;
      await library.setRating(
        {
          provider,
          id,
          title,
          poster_url: itemPoster(details) || null,
          year: year || null,
          media_type: kind,
        },
        score,
      );
      ratingOpen = false;
      toast(score > 0 ? `Rated ${title} ${score}/10` : 'Rating cleared');
      renderPage();
    }
  });

  const onSync = () => {
    if (!ctx.signal?.aborted) renderPage();
  };
  const unsubLib = library.subscribe(onSync);
  window.addEventListener('ifallhub:meta', onSync);
  ctx.signal?.addEventListener('abort', () => {
    unsubLib();
    window.removeEventListener('ifallhub:meta', onSync);
  });

  renderPage();

  // Background preload 1: Movie stream quality/size summary
  if (!isSeries) {
    api
      .streams(
        {
          provider,
          id,
          season: 0,
          episode: 0,
          isSeries: false,
          expectedTitle: title,
          expectedYear: year,
        },
        { signal: ctx.signal },
      )
      .then((res) => {
        if (ctx.signal?.aborted) return;
        const summary = summariseReleases(res?.releases || []);
        if (summary) {
          movieStreamSummary = `${providerLabel(provider)} · ${summary}`;
          const el = container.querySelector('[data-stream-summary]');
          if (el) el.textContent = movieStreamSummary;
        }
      })
      .catch(() => {});
  }

  // Background preload 2: Related titles (`More like this`)
  api
    .related({ provider, id, limit: 18 }, { signal: ctx.signal })
    .then(async (res) => {
      if (ctx.signal?.aborted) return;
      let items = res?.items || [];
      let reasons = res?.reasons || {};
      if (!items.length && state.collections?.rows) {
        const pool = state.collections.rows.flatMap((r) => r.items || []);
        const sim = similarByMeta(details, pool, { limit: 12 });
        items = sim.map((s) => s.item);
        reasons = Object.fromEntries(sim.map((s) => [itemId(s.item), s.reasons]));
      }
      if (!items.length) return;
      const ratingMap = Object.fromEntries(
        library.state.ratings.map((r) => [r.id, r.rating]),
      );
      relatedRanked = rankRelated(items, {
        reasons,
        ratings: ratingMap,
        watchlist: library.state.watchlist,
        progress: library.state.progress,
      });
      const slot = container.querySelector('[data-related-slot]');
      if (slot) slot.innerHTML = renderRelatedSection();
      await ensureMeta(items.slice(0, 18));
    })
    .catch(() => {});

  // If navigated via `/watch/:provider/:id?s=&e=`, open the player sheet automatically!
  if (autoPlayOnMount) {
    const reqS = Number(ctx.query?.get('s') || ctx.query?.get('season')) || (isSeries ? selectedSeason : 0);
    const reqE = Number(ctx.query?.get('e') || ctx.query?.get('episode')) || (isSeries ? 1 : 0);
    void openBetaPlayerSheet({
      provider,
      id,
      season: reqS,
      episode: reqE,
      item: details,
      details,
    });
  }
}

export async function renderWatch(container, ctx = {}) {
  return renderDetails(container, ctx, { autoPlayOnMount: true });
}
