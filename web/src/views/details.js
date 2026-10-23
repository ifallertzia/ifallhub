// Sidify-V2 visually styled Title Detail page wired 100% to MovieBox-TUI's updated (0.1.27) backend.

import * as api from '../lib/api.js';
import {
  escapeHtml,
  formatClock,
  formatRating,
  isSeriesItem,
  itemId,
  itemPoster,
  itemProvider,
  itemTitle,
  itemYear,
  prettySize,
  providerLabel,
} from '../lib/format.js';
import * as library from '../lib/library.js';
import {
  detailPathFor,
  episodeNumberOf,
  formatDetailList,
  initialSeasonNumber,
  itemBackdrop,
  itemGenres,
  mediaArt,
  officialRatingOf,
  orderedSeasonNumbers,
  seasonNumberOf,
  splitCsvList,
  summariseReleases,
} from '../lib/media-helpers.js';
import { dedupeItems, rankRelated } from '../lib/recommend.js';
import * as router from '../lib/router.js';
import { buildStreamEntry, downloadRelease } from '../player/engine.js';
import {
  cacheDetails,
  cachedDetails,
  cachedMeta,
  ensureMeta,
  getCollectionsCached,
  setAmbientSeed,
  toast,
} from '../state.js';
import {
  chipsHtml,
  errorStateHtml,
  posterCardHtml,
  shelfHtml,
  spinnerHtml,
} from '../ui/components.js';
import { iconHtml } from '../ui/icons.js';
import { openRatingSheet } from '../ui/sheets.js';
import {
  describeOpenResult,
  loadPlayerSupport,
  openStreamExternally,
  playerButtonLabel,
} from '../ui/vlc-button.js';

export async function renderDetails(root, route = {}) {
  const provider = route.params?.provider || 'moviebox';
  const id = route.params?.id || '';
  const querySeason = route.query?.get('s') || route.query?.get('season');
  const queryEpisode = route.query?.get('e') || route.query?.get('episode');
  const routeSignal = route.signal;

  let disposed = false;
  let unsubLibrary = null;

  root.innerHTML = `<div class="min-h-[60dvh] px-4 pt-6 desk:px-8">${spinnerHtml('Loading title…')}</div>`;

  let details;
  try {
    details =
      cachedDetails(provider, id) || (await api.details({ provider, id }, { signal: routeSignal }));
    cacheDetails(provider, id, details);
  } catch (err) {
    if (disposed || routeSignal?.aborted) return;
    root.innerHTML = errorStateHtml({
      title: 'Title unavailable',
      message: err?.message || `Could not load metadata from ${providerLabel(provider)}.`,
    });
    root.querySelector('[data-retry]')?.addEventListener('click', () => {
      void renderDetails(root, route);
    });
    return;
  }
  if (disposed || routeSignal?.aborted) return;

  const title = itemTitle(details);
  const year = itemYear(details);
  const isSeries = isSeriesItem(details);
  const kind = isSeries ? 'series' : 'movie';
  const genres = itemGenres(details);
  const rating = formatRating(officialRatingOf(details));
  const duration = details.duration || '';
  const castList = splitCsvList(details.stars ?? details.cast);
  const printsStr = formatDetailList(details.prints);
  const audiosStr = formatDetailList(details.audios);
  const dubs = Array.isArray(details.dubs) ? details.dubs : [];
  const posterFallback = mediaArt(title, year, kind, 'poster');
  const backdropFallback = mediaArt(title, year, kind, 'backdrop');
  const poster = itemPoster(details) || posterFallback;
  const backdrop = itemBackdrop(details) || poster || backdropFallback;

  setAmbientSeed(`${title}:${year}`);

  const seasons = Array.isArray(details.seasons) ? details.seasons : [];
  const savedProgress = library.progressFor(provider, id);
  let activeSeason = isSeries
    ? initialSeasonNumber(seasons, querySeason || savedProgress?.season || 1)
    : 0;
  let activeEpisode = 0;

  function episodesForSeason(sNum) {
    const found = seasons.find((s) => seasonNumberOf(s) === Number(sNum));
    return Array.isArray(found?.episodes) ? found.episodes : [];
  }

  if (isSeries) {
    const eps = episodesForSeason(activeSeason);
    const wantedEp = Number(
      queryEpisode ||
        (savedProgress && Number(savedProgress.season) === activeSeason
          ? savedProgress.episode
          : 0),
    );
    const hasWanted = eps.some((ep, idx) => episodeNumberOf(ep, idx + 1) === wantedEp);
    activeEpisode = hasWanted
      ? wantedEp
      : eps.length
        ? episodeNumberOf(eps[0], 1)
        : 1;
  }

  let streamEntry = null;
  let streamsLoading = true;
  let streamsError = '';
  let streamRunId = 0;
  let relatedItems = [];

  const backHref = isSeries ? '/series' : '/movies';

  function playHrefFor(epOverride = null, relIndex = null) {
    const ep = epOverride ?? activeEpisode;
    const base = router.watchPath(provider, id, {
      season: isSeries ? activeSeason : 0,
      episode: isSeries ? ep : 0,
    });
    if (relIndex !== null && Number.isInteger(relIndex) && relIndex >= 0) {
      return `${base}${base.includes('?') ? '&' : '?'}r=${relIndex}`;
    }
    return base;
  }

  function primaryPlayLabel() {
    const prog = library.progressFor(provider, id);
    if (!prog) {
      return isSeries ? `Play S${activeSeason} · E${activeEpisode}` : 'Play';
    }
    const pos = Number(prog.position_seconds) || 0;
    const dur = Number(prog.duration_seconds) || 0;
    const inProgress = pos > 10 && (!dur || pos / dur < 0.94);
    if (isSeries) {
      if (
        Number(prog.season) === Number(activeSeason) &&
        Number(prog.episode) === Number(activeEpisode) &&
        inProgress
      ) {
        return `Resume S${activeSeason}·E${activeEpisode} (${formatClock(pos)})`;
      }
      return `Play S${activeSeason} · E${activeEpisode}`;
    }
    return inProgress ? `Resume ${formatClock(pos)}` : 'Play';
  }

  root.innerHTML = `
    <div class="fade-up pb-16">
      <!-- Full-bleed Backdrop Hero -->
      <div class="relative -mt-2 overflow-hidden">
        <div class="relative h-[44vw] min-h-[260px] max-h-[440px] w-full overflow-hidden">
          <img
            src="${escapeHtml(backdrop)}"
            data-fallback-src="${escapeHtml(backdropFallback)}"
            alt=""
            class="h-full w-full scale-105 object-cover object-center opacity-55 blur-[2px] saturate-[1.15]"
          />
          <div
            class="pointer-events-none absolute inset-0"
            style="background: linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.45) 48%, var(--window) 100%);"
          ></div>

          <a
            href="${escapeHtml(backHref)}"
            data-nav
            class="pill-glass absolute top-4 left-4 z-10 inline-flex h-9 items-center gap-1 rounded-full pr-3.5 pl-2.5 text-[13.5px] font-medium text-white desk:top-6 desk:left-8"
          >
            ${iconHtml('chevronLeft', { size: 17 })}
            <span>${isSeries ? 'Series' : 'Movies'}</span>
          </a>
        </div>

        <!-- Overlapping Poster + Metadata Header -->
        <div class="relative z-10 -mt-28 flex flex-col gap-6 px-4 desk:-mt-36 desk:flex-row desk:items-end desk:gap-8 desk:px-8">
          <div class="w-[152px] shrink-0 overflow-hidden rounded-[12px] bg-raised shadow-[0_24px_48px_-12px_rgba(0,0,0,0.65)] ring-1 ring-white/14 desk:w-[216px]">
            <div class="aspect-[2/3] w-full">
              <img
                src="${escapeHtml(poster)}"
                data-fallback-src="${escapeHtml(posterFallback)}"
                alt="${escapeHtml(title)}"
                class="h-full w-full object-cover"
              />
            </div>
          </div>

          <div class="min-w-0 flex-1 pb-1">
            <div class="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-semibold tracking-wider text-fg-2 uppercase">
              <span>${isSeries ? 'TV Series' : 'Feature Film'}</span>
              <span>·</span>
              <span>${escapeHtml(providerLabel(provider))}</span>
              ${year ? `<span>·</span><span>${escapeHtml(String(year))}</span>` : ''}
              ${duration ? `<span>·</span><span>${escapeHtml(duration)}</span>` : ''}
              ${
                rating
                  ? `<span class="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-[2px] text-[12px] font-bold text-amber-400 normal-case">
                       ${iconHtml('starFilled', { size: 11 })} ${escapeHtml(rating)}
                     </span>`
                  : ''
              }
            </div>

            <h1 class="t-display desk:t-hero text-fg">${escapeHtml(title)}</h1>

            ${
              details.tagline
                ? `<p class="mt-1.5 text-[15px] italic text-fg-2">“${escapeHtml(details.tagline)}”</p>`
                : ''
            }

            ${
              genres.length
                ? `<div class="mt-3 flex flex-wrap gap-1.5">
                     ${genres
                       .map(
                         (g) =>
                           `<a href="/search?q=${encodeURIComponent(g)}&provider=${encodeURIComponent(provider)}" data-nav class="rounded-full bg-fill px-3 py-1 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg">${escapeHtml(g)}</a>`,
                       )
                       .join('')}
                   </div>`
                : ''
            }

            <div data-release-summary class="mt-3 text-[12.5px] font-medium text-fg-2">
              Checking available streams…
            </div>

            <!-- Action Bar (100% MovieBox-TUI Playback + Library) -->
            <div class="mt-5 flex flex-wrap items-center gap-2.5">
              <a
                href="${escapeHtml(playHrefFor())}"
                data-nav
                data-primary-play
                class="pill-selected inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14.5px] font-semibold transition active:scale-[0.98]"
              >
                ${iconHtml('play', { size: 15 })}
                <span data-primary-play-label>${escapeHtml(primaryPlayLabel())}</span>
              </a>

              <button
                type="button"
                data-open-vlc
                class="inline-flex h-11 items-center gap-2 rounded-full bg-fill-2 px-5 text-[14px] font-semibold text-fg transition hover:bg-fill-3 active:scale-[0.98]"
              >
                ${iconHtml('tv', { size: 16 })}
                <span data-open-vlc-label>Open in VLC</span>
              </button>

              <button
                type="button"
                data-detail-watchlist
                class="inline-flex h-11 items-center gap-2 rounded-full bg-fill px-4 text-[14px] font-semibold text-fg transition hover:bg-fill-2"
              ></button>

              <button
                type="button"
                data-detail-rate
                class="inline-flex h-11 items-center gap-1.5 rounded-full bg-fill px-4 text-[14px] font-semibold text-fg transition hover:bg-fill-2"
              ></button>
            </div>

            ${
              dubs.length > 1
                ? `<div class="mt-4 flex flex-wrap items-center gap-1.5">
                     <span class="mr-1 text-[12px] font-semibold tracking-wider text-fg-2 uppercase">Audio / Dubs:</span>
                     ${dubs
                       .map((dub) => {
                         const activeDub = String(dub.subject_id) === String(id);
                         const dubHref = detailPathFor(provider, dub.subject_id, isSeries);
                         return `<a
                           href="${escapeHtml(dubHref)}"
                           data-nav
                           class="inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-semibold transition ${
                             activeDub ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
                           }"
                         >${escapeHtml(dub.label || dub.language || 'Track')}</a>`;
                       })
                       .join('')}
                   </div>`
                : ''
            }
          </div>
        </div>
      </div>

      <!-- Synopsis & Credits -->
      <div class="mt-8 grid gap-8 px-4 desk:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] desk:px-8">
        <div>
          <h2 class="t-title mb-2">Overview</h2>
          <p class="max-w-[70ch] text-[15px] leading-relaxed text-fg-2">
            ${escapeHtml(details.description || 'No synopsis reported by this provider yet.')}
          </p>
        </div>

        <dl class="grid grid-cols-2 gap-x-6 gap-y-3 self-start rounded-[14px] bg-raised/70 p-4 text-[13.5px] ring-1 ring-edge">
          ${
            details.director
              ? `<div class="col-span-2">
                   <dt class="text-[11.5px] font-semibold tracking-wider text-fg-3 uppercase">Director</dt>
                   <dd class="mt-0.5 font-medium text-fg">
                     <a href="/search?q=${encodeURIComponent(details.director)}&provider=${encodeURIComponent(provider)}" data-nav class="underline-offset-2 hover:text-brand hover:underline">${escapeHtml(details.director)}</a>
                   </dd>
                 </div>`
              : ''
          }
          ${
            castList.length
              ? `<div class="col-span-2">
                   <dt class="text-[11.5px] font-semibold tracking-wider text-fg-3 uppercase">Cast</dt>
                   <dd class="mt-1 flex flex-wrap gap-1.5">
                     ${castList
                       .slice(0, 8)
                       .map(
                         (person) =>
                           `<a href="/search?q=${encodeURIComponent(person)}&provider=${encodeURIComponent(provider)}" data-nav class="rounded-full bg-fill px-2.5 py-0.5 text-[12.5px] font-medium text-fg hover:bg-fill-2">${escapeHtml(person)}</a>`,
                       )
                       .join('')}
                   </dd>
                 </div>`
              : ''
          }
          <div>
            <dt class="text-[11.5px] font-semibold tracking-wider text-fg-3 uppercase">Source</dt>
            <dd class="mt-0.5 font-medium text-fg">${escapeHtml(providerLabel(provider))}</dd>
          </div>
          ${
            year
              ? `<div>
                   <dt class="text-[11.5px] font-semibold tracking-wider text-fg-3 uppercase">Released</dt>
                   <dd class="mt-0.5 font-medium text-fg">${escapeHtml(String(year))}</dd>
                 </div>`
              : ''
          }
          ${
            printsStr
              ? `<div class="col-span-2">
                   <dt class="text-[11.5px] font-semibold tracking-wider text-fg-3 uppercase">Prints</dt>
                   <dd class="mt-0.5 font-medium text-fg">${escapeHtml(printsStr)}</dd>
                 </div>`
              : ''
          }
          ${
            audiosStr
              ? `<div class="col-span-2">
                   <dt class="text-[11.5px] font-semibold tracking-wider text-fg-3 uppercase">Audio</dt>
                   <dd class="mt-0.5 font-medium text-fg">${escapeHtml(audiosStr)}</dd>
                 </div>`
              : ''
          }
        </dl>
      </div>

      <!-- Series Seasons & Episodes -->
      <div data-seasons-section class="mt-10 px-4 desk:px-8" ${isSeries && seasons.length ? '' : 'hidden'}>
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 class="t-section">Episodes</h2>
          <div data-season-tabs></div>
        </div>
        <div data-episodes-list class="divide-y divide-edge overflow-hidden rounded-[14px] bg-raised/70 ring-1 ring-edge"></div>
      </div>

      <!-- Available Streams & Direct Downloads (MovieBox-TUI 0.1.27) -->
      <div class="mt-10 px-4 desk:px-8">
        <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 class="t-section" data-streams-heading>
              ${isSeries ? `Available streams · S${activeSeason}:E${activeEpisode}` : 'Available streams'}
            </h2>
            <p class="mt-0.5 text-[13px] text-fg-2">
              Click any stream to play in MovieBox-TUI's web player, open directly in VLC, or download the file.
            </p>
          </div>
        </div>
        <div data-detail-streams class="space-y-2 rounded-[14px] bg-raised/70 p-3.5 ring-1 ring-edge">
          <div class="py-4 text-[13.5px] text-fg-2">Loading streams…</div>
        </div>
      </div>

      <!-- Related Shelf -->
      <div data-related-host class="mt-10"></div>
    </div>`;

  const primaryPlayLink = root.querySelector('[data-primary-play]');
  const primaryPlayLabelEl = root.querySelector('[data-primary-play-label]');
  const openVlcLabelEl = root.querySelector('[data-open-vlc-label]');

  loadPlayerSupport()
    .then((sup) => {
      if (disposed) return;
      if (openVlcLabelEl) {
        openVlcLabelEl.textContent = sup?.available
          ? playerButtonLabel(sup)
          : 'Copy VLC link';
      }
    })
    .catch(() => {});

  function syncPrimaryPlayLink() {
    if (primaryPlayLink) primaryPlayLink.setAttribute('href', playHrefFor());
    if (primaryPlayLabelEl) primaryPlayLabelEl.textContent = primaryPlayLabel();
  }

  function syncLibraryButtons() {
    const wlBtn = root.querySelector('[data-detail-watchlist]');
    const rateBtn = root.querySelector('[data-detail-rate]');
    const listed = library.isInWatchlist(provider, id);
    const myRating = library.ratingFor(provider, id);

    if (wlBtn) {
      wlBtn.className = `inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition ${
        listed ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
      }`;
      wlBtn.innerHTML = `${iconHtml(listed ? 'check' : 'bookmark', { size: 15 })}<span>${listed ? 'In Watchlist' : 'Watchlist'}</span>`;
    }

    if (rateBtn) {
      rateBtn.className = `inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition ${
        myRating ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
      }`;
      rateBtn.innerHTML = `${iconHtml('starFilled', { size: 14 })}<span>${myRating ? `${myRating}/10` : 'Rate'}</span>`;
    }
    syncPrimaryPlayLink();
  }

  function renderSeasons() {
    if (!isSeries || !seasons.length) return;
    const tabsHost = root.querySelector('[data-season-tabs]');
    const listHost = root.querySelector('[data-episodes-list]');
    const seasonNums = orderedSeasonNumbers(seasons);
    if (!seasonNums.length) return;

    tabsHost.innerHTML = chipsHtml(
      seasonNums.map((n) => ({ id: String(n), label: `Season ${n}` })),
      String(activeSeason),
      { attrName: 'data-season-tab' },
    );

    const episodes = episodesForSeason(activeSeason);
    if (!episodes.length) {
      listHost.innerHTML = `<div class="px-5 py-8 text-center text-[14px] text-fg-2">No episodes listed for Season ${activeSeason}.</div>`;
      return;
    }

    listHost.innerHTML = episodes
      .map((ep, idx) => {
        const epNum = episodeNumberOf(ep, idx + 1);
        const epTitle = ep.title || `Episode ${epNum}`;
        const epDesc = ep.overview || ep.description || '';
        const selected = epNum === Number(activeEpisode);
        const epWatchHref = playHrefFor(epNum);

        return `
          <div
            data-ep-row="${epNum}"
            class="group flex cursor-pointer items-center justify-between gap-4 px-4 py-3.5 transition-colors ${
              selected ? 'bg-brand/10' : 'hover:bg-fill'
            }"
          >
            <div class="flex min-w-0 items-start gap-3.5">
              <span class="mt-0.5 inline-flex h-6 min-w-[26px] shrink-0 items-center justify-center rounded-full px-1.5 text-[12px] font-bold tabular-nums ${
                selected ? 'pill-selected' : 'bg-fill text-fg-3'
              }">${epNum}</span>
              <div class="min-w-0">
                <div class="truncate text-[14.5px] font-semibold text-fg">${escapeHtml(epTitle)}</div>
                ${epDesc ? `<p class="mt-0.5 line-clamp-2 text-[12.5px] text-fg-2">${escapeHtml(epDesc)}</p>` : ''}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <a
                href="${escapeHtml(epWatchHref)}"
                data-nav
                class="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition ${
                  selected ? 'pill-selected' : 'bg-fill-2 text-fg hover:bg-fill-3'
                }"
              >
                ${iconHtml('play', { size: 12 })}
                <span>Play</span>
              </a>
            </div>
          </div>`;
      })
      .join('');
  }

  function renderStreamsSection() {
    const streamsHost = root.querySelector('[data-detail-streams]');
    const headingEl = root.querySelector('[data-streams-heading]');
    const summaryEl = root.querySelector('[data-release-summary]');
    if (headingEl) {
      headingEl.textContent = isSeries
        ? `Available streams · S${activeSeason}:E${activeEpisode}`
        : 'Available streams';
    }

    if (streamsLoading) {
      if (summaryEl) summaryEl.textContent = 'Checking available streams…';
      if (streamsHost) {
        streamsHost.innerHTML = `<div class="flex items-center gap-2 px-2 py-4 text-[13.5px] text-fg-2">${iconHtml('loader2', { size: 15, className: 'animate-spin' })}<span>Resolving streams from ${escapeHtml(providerLabel(provider))}…</span></div>`;
      }
      return;
    }

    const releases = streamEntry?.releases || [];
    if (!releases.length) {
      if (summaryEl) {
        summaryEl.textContent = streamsError || 'Click Play to auto-rotate across all servers';
      }
      if (streamsHost) {
        streamsHost.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-3 px-2 py-3 text-[13.5px] text-fg-2">
            <span>${escapeHtml(streamsError || `No direct releases returned by ${providerLabel(provider)} — MovieBox-TUI's player will automatically search all servers.`)}</span>
            <a href="${escapeHtml(playHrefFor())}" data-nav class="pill-selected inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold">
              ${iconHtml('play', { size: 12 })}
              <span>Auto-play across servers</span>
            </a>
          </div>`;
      }
      return;
    }

    const summary = summariseReleases(releases);
    if (summaryEl) {
      summaryEl.textContent = summary
        ? `Available: ${summary}`
        : `${releases.length} stream${releases.length === 1 ? '' : 's'} ready`;
    }

    if (streamsHost) {
      streamsHost.innerHTML = releases
        .map((rel, idx) => {
          const quality = rel.quality || 'HD';
          const sizeLabel = rel.size_bytes ? prettySize(rel.size_bytes) : '';
          const unsupported = rel.unsupportedReason;
          const mirrors =
            Array.isArray(rel.mirrors) && rel.mirrors.length
              ? rel.mirrors
              : [{ label: 'Mirror 1' }];

          return `
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-[11px] bg-fill/80 px-3.5 py-2.5 ring-1 ring-edge transition hover:bg-fill">
              <a
                href="${escapeHtml(playHrefFor(activeEpisode, idx))}"
                data-nav
                class="flex min-w-0 flex-1 items-center gap-3"
              >
                <span class="inline-flex h-7 shrink-0 items-center justify-center rounded-[7px] bg-fill-2 px-2.5 text-[12px] font-bold text-fg">${escapeHtml(quality)}</span>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-[13.5px] font-semibold text-fg">${escapeHtml(rel.filename || `${title} (${quality})`)}</div>
                  <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-2">
                    <span>${escapeHtml(providerLabel(rel.provider || provider))}</span>
                    ${sizeLabel ? `<span>·</span><span class="font-medium text-fg">${escapeHtml(sizeLabel)}</span>` : ''}
                    ${rel.codec ? `<span>·</span><span>${escapeHtml(rel.codec)}</span>` : ''}
                    ${rel.language ? `<span>·</span><span>${escapeHtml(rel.language)}</span>` : ''}
                    ${
                      unsupported
                        ? `<span class="rounded bg-amber-500/18 px-1.5 py-[1px] text-[10.5px] font-semibold text-amber-300">⚠ ${
                            unsupported === 'codec' ? 'H.265 — best in VLC' : 'MKV — best in VLC'
                          }</span>`
                        : ''
                    }
                  </div>
                </div>
              </a>

              <div class="flex shrink-0 flex-wrap items-center gap-1.5">
                <a
                  href="${escapeHtml(playHrefFor(activeEpisode, idx))}"
                  data-nav
                  class="pill-selected inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-semibold"
                >
                  ${iconHtml('play', { size: 12 })}
                  <span>Play</span>
                </a>
                <button
                  type="button"
                  data-detail-vlc="${idx}"
                  class="inline-flex h-8 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
                >
                  ${iconHtml('tv', { size: 13 })}
                  <span>VLC</span>
                </button>
                ${mirrors
                  .slice(0, 2)
                  .map(
                    (m, mIdx) => `<button
                      type="button"
                      data-detail-dl="${idx}"
                      data-detail-mirror="${mIdx}"
                      class="inline-flex h-8 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
                    >
                      ${iconHtml('download', { size: 13 })}
                      <span>${mirrors.length > 1 ? escapeHtml(m.label || `DL ${mIdx + 1}`) : 'Download'}</span>
                    </button>`,
                  )
                  .join('')}
              </div>
            </div>`;
        })
        .join('');
    }
  }

  async function loadStreamsForCurrentSelection() {
    const run = ++streamRunId;
    streamsLoading = true;
    streamsError = '';
    streamEntry = null;
    renderStreamsSection();

    try {
      const resp = await api.streams(
        {
          provider,
          id,
          season: isSeries ? activeSeason : 0,
          episode: isSeries ? activeEpisode : 0,
          isSeries,
          expectedTitle: title,
          expectedYear: year,
        },
        { signal: routeSignal },
      );
      if (disposed || routeSignal?.aborted || run !== streamRunId) return;
      streamEntry = buildStreamEntry(id, resp);
      streamsLoading = false;
      renderStreamsSection();
    } catch (err) {
      if (disposed || routeSignal?.aborted || run !== streamRunId) return;
      streamsLoading = false;
      streamsError = err?.message || '';
      renderStreamsSection();
    }
  }

  function renderRelated() {
    const host = root.querySelector('[data-related-host]');
    if (!host) return;
    if (!relatedItems.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = shelfHtml({
      key: 'related',
      title: 'More like this',
      itemsHtml: relatedItems
        .map((it) => {
          const p = itemProvider(it);
          const cid = itemId(it);
          const m = cachedMeta(p, cid);
          return posterCardHtml(it, {
            metaEntry: m,
            rating: officialRatingOf(it, m),
            listed: library.isInWatchlist(p, cid),
            progress: library.progressFor(p, cid),
            personalRating: library.ratingFor(p, cid),
          });
        })
        .join(''),
    });
  }

  syncLibraryButtons();
  renderSeasons();
  void loadStreamsForCurrentSelection();

  // Background related lookup
  void (async () => {
    try {
      const pool = [];
      const [rel, cols] = await Promise.all([
        api.related({ provider, id }, { signal: routeSignal }).catch(() => null),
        getCollectionsCached().catch(() => null),
      ]);
      if (Array.isArray(rel?.items)) pool.push(...rel.items);
      for (const k of ['trending', 'top_rated', 'fresh', 'most_watched']) {
        if (Array.isArray(cols?.[k])) pool.push(...cols[k]);
      }
      const candidates = dedupeItems(pool).filter(
        (it) => !(itemProvider(it) === provider && itemId(it) === String(id)),
      );
      if (disposed || routeSignal?.aborted) return;
      relatedItems = rankRelated({
        anchor: details,
        candidates,
        metaLookup: (it) => cachedMeta(itemProvider(it), itemId(it)),
        limit: 16,
      });
      renderRelated();
      void ensureMeta(relatedItems);
    } catch {}
  })();

  const onSync = () => {
    if (disposed) return;
    syncLibraryButtons();
    renderRelated();
  };
  unsubLibrary = library.subscribe(onSync);
  window.addEventListener('ifallhub:meta', onSync, { signal: routeSignal });

  root.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const seasonTab = target.closest('[data-season-tab]');
    if (seasonTab) {
      activeSeason = Number(seasonTab.dataset.seasonTab) || 1;
      const eps = episodesForSeason(activeSeason);
      activeEpisode = eps.length ? episodeNumberOf(eps[0], 1) : 1;
      syncPrimaryPlayLink();
      renderSeasons();
      void loadStreamsForCurrentSelection();
      return;
    }

    const epRow = target.closest('[data-ep-row]');
    if (epRow && !target.closest('a[data-nav]')) {
      activeEpisode = Number(epRow.dataset.epRow) || 1;
      syncPrimaryPlayLink();
      renderSeasons();
      void loadStreamsForCurrentSelection();
      return;
    }

    const openVlcBtn = target.closest('[data-open-vlc]');
    if (openVlcBtn) {
      if (!streamEntry?.streamSetId) {
        void router.navigate(playHrefFor());
        return;
      }
      const firstRel = streamEntry.releases?.[0];
      const prog = library.progressFor(provider, id);
      const resumeSec =
        prog &&
        (!isSeries ||
          (Number(prog.season) === Number(activeSeason) &&
            Number(prog.episode) === Number(activeEpisode)))
          ? Math.floor(Number(prog.position_seconds) || 0)
          : 0;
      const res = await openStreamExternally({
        streamSetId: streamEntry.streamSetId,
        releaseIndex: firstRel?.serverIndex ?? 0,
        mirrorIndex: 0,
        resumeSeconds: resumeSec,
      });
      const summary = describeOpenResult(res);
      toast(summary.message, summary.kind === 'error' ? 'error' : 'info');
      return;
    }

    const relVlcBtn = target.closest('[data-detail-vlc]');
    if (relVlcBtn) {
      if (!streamEntry?.streamSetId) return;
      const rIdx = Number(relVlcBtn.dataset.detailVlc) || 0;
      const rel = streamEntry.releases?.[rIdx];
      const res = await openStreamExternally({
        streamSetId: streamEntry.streamSetId,
        releaseIndex: rel?.serverIndex ?? rIdx,
        mirrorIndex: 0,
        resumeSeconds: 0,
      });
      const summary = describeOpenResult(res);
      toast(summary.message, summary.kind === 'error' ? 'error' : 'info');
      return;
    }

    const relDlBtn = target.closest('[data-detail-dl]');
    if (relDlBtn) {
      if (!streamEntry?.streamSetId) return;
      const rIdx = Number(relDlBtn.dataset.detailDl) || 0;
      const mIdx = Number(relDlBtn.dataset.detailMirror) || 0;
      relDlBtn.disabled = true;
      try {
        const fname = await downloadRelease({
          entry: streamEntry,
          releaseIndex: rIdx,
          mirrorIndex: mIdx,
        });
        toast(`Downloading ${fname}`);
      } catch (err) {
        toast(err?.message || 'Download could not be started.', 'error');
      } finally {
        relDlBtn.disabled = false;
      }
      return;
    }

    if (target.closest('[data-detail-watchlist]')) {
      const listed = await library.toggleWatchlist({
        provider,
        id,
        title,
        media_type: kind,
        year,
        poster_url: itemPoster(details) || '',
        official_rating: officialRatingOf(details),
      });
      toast(listed ? `Saved “${title}” to Watchlist` : `Removed “${title}” from Watchlist`);
      return;
    }

    if (target.closest('[data-detail-rate]')) {
      openRatingSheet({
        provider,
        id,
        title,
        year,
        poster: itemPoster(details) || '',
        isSeries,
        officialRating: officialRatingOf(details),
      });
    }
  });

  routeSignal?.addEventListener(
    'abort',
    () => {
      disposed = true;
      if (unsubLibrary) unsubLibrary();
    },
    { once: true },
  );
}
