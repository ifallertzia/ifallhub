// Sidify-V2 visually styled Watch Page powered 100% by MovieBox-TUI's updated (0.1.27) playback engine.

import * as api from '../lib/api.js';
import {
  SERVER_ROTATION,
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
  initialSeasonNumber,
  mediaArt,
  officialRatingOf,
  orderedSeasonNumbers,
  seasonNumberOf,
} from '../lib/media-helpers.js';
import { dedupeItems, rankRelated } from '../lib/recommend.js';
import * as router from '../lib/router.js';
import {
  autoPlay,
  closeActivePlayer,
  downloadRelease,
  openStream,
  refreshServerStreams,
  resolveServerStreams,
  rotationAfter,
} from '../player/engine.js';
import { mountPlayerOverlay } from '../player/overlay.js';
import { pickAutomaticSubtitle, subtitleToVtt } from '../player/subtitles.js';
import {
  cacheDetails,
  cachedDetails,
  cachedMeta,
  ensureMeta,
  setAmbientSeed,
  toast,
} from '../state.js';
import { posterCardHtml, shelfHtml, spinnerHtml } from '../ui/components.js';
import { iconHtml } from '../ui/icons.js';
import { appendPlaybackLink, playbackLinkUrls } from '../ui/playback-links.js';
import {
  clearCurrentPlayback,
  copyPlaybackUrlOrResolve,
  createVlcButton,
  describeOpenResult,
  loadPlayerSupport,
  openStreamExternally,
  playerButtonLabel,
  setCurrentPlayback,
  writeClipboard,
} from '../ui/vlc-button.js';

const AUTO_NEXT_KEY = 'ifallhub.autoNext.v1';
const AUTO_SUBS_KEY = 'ifallhub.autoSubs.v1';

function readBoolPref(key, fallback = true) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function writeBoolPref(key, val) {
  try {
    localStorage.setItem(key, val ? '1' : '0');
  } catch {}
}

function defaultRotationFor(provider) {
  const first = provider && SERVER_ROTATION.includes(provider) ? provider : SERVER_ROTATION[0];
  return [first, ...SERVER_ROTATION.filter((p) => p !== first)];
}

function serverLabel(provider) {
  const idx = SERVER_ROTATION.indexOf(provider);
  return idx >= 0 ? `Server ${idx + 1}` : 'Server';
}

function revokeTrackBlobs(videoEl) {
  if (!videoEl) return;
  videoEl.querySelectorAll('track').forEach((t) => {
    if (t.dataset.blobUrl) {
      try {
        URL.revokeObjectURL(t.dataset.blobUrl);
      } catch {}
    }
    t.remove();
  });
}

export async function renderWatch(root, route = {}) {
  const provider = route.params?.provider || 'moviebox';
  const id = route.params?.id || '';
  const querySeason = Number(route.query?.get('s') || 0);
  const queryEpisode = Number(route.query?.get('e') || 0);
  const queryRelease = route.query?.has('r') ? Number(route.query.get('r')) : null;
  const routeSignal = route.signal;

  let disposed = false;
  let runController = null;
  let activePlayerInstance = null;
  let overlayHandle = null;
  let unsubLibrary = null;
  let lastSavedAt = 0;

  const viewState = {
    provider,
    id,
    details: null,
    isSeries: false,
    season: querySeason > 0 ? querySeason : 0,
    episode: queryEpisode > 0 ? queryEpisode : 0,
    startRelease: Number.isInteger(queryRelease) && queryRelease >= 0 ? queryRelease : 0,
    order: defaultRotationFor(provider),
    cache: {},
    serverStatuses: {},
    current: provider,
    activeEntry: null,
    activeRelease: 0,
    activeMirror: 0,
    activeQuality: 'AUTO',
    activePlayback: null,
    subtitleSetId: '',
    subtitles: [],
    selectedSub: null,
    autoSubs: readBoolPref(AUTO_SUBS_KEY, true),
    subRunId: 0,
    autoNext: readBoolPref(AUTO_NEXT_KEY, true),
    resumeApplied: false,
    playerSupport: null,
    related: [],
  };

  function abortCurrentRun() {
    if (runController) {
      runController.abort();
      runController = null;
    }
  }

  function freshRunSignal() {
    abortCurrentRun();
    runController = new AbortController();
    if (routeSignal?.aborted) runController.abort();
    return runController.signal;
  }

  root.innerHTML = `<div class="min-h-[60dvh] px-4 pt-6 desk:px-8">${spinnerHtml('Loading player…')}</div>`;

  loadPlayerSupport()
    .then((sup) => {
      if (disposed) return;
      viewState.playerSupport = sup;
      updateExternalButtons();
    })
    .catch(() => {});

  try {
    viewState.details =
      cachedDetails(provider, id) || (await api.details({ provider, id }, { signal: routeSignal }));
    cacheDetails(provider, id, viewState.details);
  } catch (err) {
    if (disposed || routeSignal?.aborted) return;
    root.innerHTML = `
      <div class="mx-auto max-w-[520px] px-6 py-16 text-center">
        <div class="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-fill text-danger">
          ${iconHtml('alertTriangle', { size: 24 })}
        </div>
        <h1 class="t-title">Could not load title</h1>
        <p class="mt-1.5 text-[14px] text-fg-2">${escapeHtml(err?.message || 'Title metadata could not be loaded.')}</p>
        <div class="mt-5 flex justify-center gap-2.5">
          <a href="${escapeHtml(detailPathFor(provider, id, false))}" data-nav class="inline-flex h-10 items-center gap-2 rounded-full bg-fill px-5 text-[14px] font-semibold text-fg hover:bg-fill-2">
            ${iconHtml('chevronLeft', { size: 16 })}
            <span>Back</span>
          </a>
        </div>
      </div>`;
    return;
  }

  if (disposed || routeSignal?.aborted) return;

  const details = viewState.details;
  const title = itemTitle(details);
  const year = itemYear(details);
  const isSeries = isSeriesItem(details);
  viewState.isSeries = isSeries;
  setAmbientSeed(`${title}:${year}`);

  const seasons = Array.isArray(details.seasons) ? details.seasons : [];
  if (isSeries) {
    const savedProgress = library.progressFor(provider, id);
    if (viewState.season <= 0) {
      viewState.season = initialSeasonNumber(seasons, savedProgress?.season || 1);
    }
    if (viewState.episode <= 0) {
      const seasonObj = seasons.find((s) => seasonNumberOf(s) === viewState.season) || seasons[0];
      const eps = Array.isArray(seasonObj?.episodes) ? seasonObj.episodes : [];
      const wantedEp =
        savedProgress && Number(savedProgress.season) === viewState.season
          ? Number(savedProgress.episode)
          : 0;
      const validWanted = eps.some((ep, idx) => episodeNumberOf(ep, idx + 1) === wantedEp);
      viewState.episode = validWanted
        ? wantedEp
        : eps.length
          ? episodeNumberOf(eps[0], 1)
          : 1;
    }
  } else {
    viewState.season = 0;
    viewState.episode = 0;
  }

  const backHref = detailPathFor(provider, id, isSeries);
  const fallbackPoster = mediaArt(title, year, isSeries ? 'series' : 'movie', 'poster');
  const poster = itemPoster(details) || fallbackPoster;
  const rating = formatRating(officialRatingOf(details));

  function episodeTitleLabel() {
    if (!viewState.isSeries) return title;
    return `${title} · S${viewState.season}:E${viewState.episode}`;
  }

  function episodesForSeason(seasonNum) {
    const sObj = seasons.find((s) => seasonNumberOf(s) === Number(seasonNum));
    return Array.isArray(sObj?.episodes) ? sObj.episodes : [];
  }

  function adjacentEpisode(delta) {
    if (!viewState.isSeries || !seasons.length) return null;
    const seasonNums = orderedSeasonNumbers(seasons);
    if (!seasonNums.length) return null;
    const flat = [];
    for (const sNum of seasonNums) {
      const eps = episodesForSeason(sNum);
      if (!eps.length) {
        flat.push({ season: sNum, episode: 1 });
      } else {
        eps.forEach((ep, idx) => {
          flat.push({ season: sNum, episode: episodeNumberOf(ep, idx + 1) });
        });
      }
    }
    const idx = flat.findIndex(
      (x) => x.season === Number(viewState.season) && x.episode === Number(viewState.episode),
    );
    if (idx < 0) return delta > 0 ? flat[0] || null : null;
    return flat[idx + delta] || null;
  }

  root.innerHTML = `
    <div class="fade-up pb-16">
      <!-- Top Bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-3 desk:px-8 desk:pt-5">
        <div class="flex min-w-0 items-center gap-2.5">
          <a
            href="${escapeHtml(backHref)}"
            data-nav
            class="pill-glass inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold text-fg hover:bg-fill-2"
          >
            ${iconHtml('chevronLeft', { size: 16 })}
            <span>Details</span>
          </a>
          <div class="min-w-0">
            <h1 class="truncate text-[16px] font-bold tracking-tight text-fg desk:text-[18px]" data-watch-heading>
              ${escapeHtml(episodeTitleLabel())}
            </h1>
            <div class="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-2">
              ${year ? `<span>${escapeHtml(String(year))}</span>` : ''}
              ${rating ? `<span>·</span><span class="inline-flex items-center gap-1 font-semibold text-amber-400">${iconHtml('starFilled', { size: 11 })} ${escapeHtml(rating)}</span>` : ''}
              <span>·</span>
              <span data-active-server-badge class="font-semibold text-brand">${escapeHtml(providerLabel(viewState.current))}</span>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-next-server
            class="inline-flex h-9 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[13px] font-semibold text-fg transition hover:bg-fill-2"
          >
            ${iconHtml('refresh', { size: 14 })}
            <span>Next server</span>
          </button>
          <button
            type="button"
            data-copy-current
            class="inline-flex h-9 items-center gap-1.5 rounded-full bg-fill px-3.5 text-[13px] font-semibold text-fg transition hover:bg-fill-2"
          >
            ${iconHtml('copy', { size: 14 })}
            <span data-copy-current-label>Copy link</span>
          </button>
          <button
            type="button"
            data-open-external
            class="pill-selected inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition"
          >
            ${iconHtml('tv', { size: 14 })}
            <span data-open-external-label>Open in VLC</span>
          </button>
        </div>
      </div>

      <!-- Video Stage -->
      <div class="px-0 sm:px-4 desk:px-8">
        <div
          data-video-frame
          class="video-frame relative aspect-video w-full overflow-hidden bg-black sm:rounded-[16px] sm:ring-1 sm:ring-edge shadow-[0_24px_64px_-16px_rgba(0,0,0,0.75)]"
        >
          <video
            data-video
            playsinline
            preload="metadata"
            crossorigin="anonymous"
            poster="${escapeHtml(poster)}"
            class="h-full w-full bg-black object-contain"
          ></video>

          <div class="vlc-button-container" data-vlc-slot></div>

          <!-- Loading / Status Banner -->
          <div
            data-player-banner
            class="pointer-events-none absolute top-3.5 left-3.5 z-[6] inline-flex max-w-[82%] items-center gap-2 rounded-full bg-black/70 px-3.5 py-1.5 text-[12.5px] font-medium text-white backdrop-blur-md"
          >
            <span data-banner-spinner>${iconHtml('loader2', { size: 14, className: 'animate-spin' })}</span>
            <span data-banner-text class="truncate">Preparing stream…</span>
          </div>

          <!-- Fatal Error Overlay -->
          <div
            data-player-error
            hidden
            class="absolute inset-0 z-[7] flex flex-col items-center justify-center bg-black/82 px-6 text-center backdrop-blur-sm"
          >
            <div class="mb-3 grid h-12 w-12 place-items-center rounded-full bg-white/10 text-danger">
              ${iconHtml('alertTriangle', { size: 22 })}
            </div>
            <div class="text-[16px] font-bold text-white">Playback unavailable in browser</div>
            <p data-player-error-msg class="mt-1 max-w-[460px] text-[13.5px] text-white/75"></p>
            <div class="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                data-retry-rotation
                class="pill-selected inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold"
              >
                ${iconHtml('refresh', { size: 14 })}
                <span>Try all servers</span>
              </button>
              <button
                type="button"
                data-open-external
                class="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/14 px-4 text-[13px] font-semibold text-white hover:bg-white/22"
              >
                ${iconHtml('tv', { size: 14 })}
                <span data-open-external-label>Open in VLC</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Server, Quality, Audio Dubs & Subtitles Controls -->
      <div class="mt-5 space-y-4 px-4 desk:px-8">
        <div class="space-y-4 rounded-[16px] bg-raised/75 p-4 ring-1 ring-edge">
          <!-- Servers Row -->
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="text-[12px] font-semibold tracking-wider text-fg-2 uppercase">Servers</div>
            <div class="text-[12px] text-fg-2" data-stream-summary></div>
          </div>
          <div data-server-pills class="no-scrollbar flex gap-2 overflow-x-auto pb-0.5"></div>

          <!-- Quality & Subtitles Row -->
          <div class="flex flex-wrap items-center justify-between gap-4 border-t border-edge pt-3.5">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="mr-1 text-[12px] font-semibold tracking-wider text-fg-2 uppercase">Quality</span>
              <div data-quality-pills class="flex flex-wrap gap-1.5"></div>
            </div>

            <div class="flex flex-wrap items-center gap-2.5">
              <label class="inline-flex items-center gap-2 text-[13px] text-fg-2">
                <span class="font-semibold text-fg">Subtitles</span>
                <select
                  data-subtitle-select
                  class="h-8 rounded-full bg-fill px-3 text-[13px] font-medium text-fg ring-1 ring-edge focus:ring-brand"
                >
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
          </div>

          ${
            Array.isArray(details.dubs) && details.dubs.length > 1
              ? `
              <div class="flex flex-wrap items-center gap-2 border-t border-edge pt-3.5">
                <span class="mr-1 text-[12px] font-semibold tracking-wider text-fg-2 uppercase">Audio / Dubs</span>
                ${details.dubs
                  .map((dub) => {
                    const activeDub = String(dub.subject_id) === String(id);
                    const dubHref = router.watchPath(provider, dub.subject_id, {
                      season: viewState.season,
                      episode: viewState.episode,
                    });
                    return `<a
                      href="${escapeHtml(dubHref)}"
                      data-nav
                      class="inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold transition ${
                        activeDub ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
                      }"
                    >${escapeHtml(dub.label || dub.language || 'Track')}</a>`;
                  })
                  .join('')}
              </div>`
              : ''
          }
        </div>

        <!-- Series Episode Switcher -->
        <div data-episodes-panel ${isSeries && seasons.length ? '' : 'hidden'} class="rounded-[16px] bg-raised/75 p-4 ring-1 ring-edge">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2.5">
              <h2 class="text-[16px] font-bold text-fg">Episodes</h2>
              <button
                type="button"
                data-prev-ep
                class="inline-flex h-8 items-center gap-1 rounded-full bg-fill px-3 text-[12.5px] font-semibold text-fg hover:bg-fill-2 disabled:opacity-40"
              >
                ${iconHtml('chevronLeft', { size: 14 })}
                <span>Prev</span>
              </button>
              <button
                type="button"
                data-next-ep
                class="inline-flex h-8 items-center gap-1 rounded-full bg-fill px-3 text-[12.5px] font-semibold text-fg hover:bg-fill-2 disabled:opacity-40"
              >
                <span>Next</span>
                ${iconHtml('chevronRight', { size: 14 })}
              </button>
            </div>
            <label class="inline-flex cursor-pointer items-center gap-2 text-[13px] text-fg-2 select-none">
              <input type="checkbox" data-auto-next ${viewState.autoNext ? 'checked' : ''} class="h-4 w-4 rounded accent-[#fa2d48]" />
              <span>Auto-play next episode</span>
            </label>
          </div>
          <div data-watch-seasons class="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto"></div>
          <div data-watch-episodes class="grid max-h-[260px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"></div>
        </div>

        <!-- Available Streams & Direct Downloads (MovieBox-TUI 0.1.27) -->
        <div class="rounded-[16px] bg-raised/75 p-4 ring-1 ring-edge">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-[16px] font-bold text-fg">Available streams &amp; downloads</h2>
              <p class="text-[12.5px] text-fg-2">Switch release, launch directly in VLC/mpv, or download recovered MP4/MKV files.</p>
            </div>
          </div>
          <div data-releases-list class="space-y-2">
            <div class="py-3 text-[13px] text-fg-2">Resolving server releases…</div>
          </div>
        </div>

        <!-- Resolved Playback Links Panel (playback-links.js) -->
        <div data-links-panel hidden class="playback-links ring-1 ring-edge">
          <div class="playback-links-head">
            <span class="playback-links-title">Resolved playback URLs <span data-links-count class="ml-1 font-normal text-fg-3"></span></span>
            <button
              type="button"
              data-copy-all-links
              class="inline-flex h-7 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
            >
              ${iconHtml('copy', { size: 12 })}
              <span data-copy-all-label>Copy all</span>
            </button>
          </div>
          <div data-links-list class="playback-links-list"></div>
        </div>
      </div>

      <!-- Related Shelf -->
      <div data-watch-related class="mt-8"></div>
    </div>`;

  const frameEl = root.querySelector('[data-video-frame]');
  const videoEl = root.querySelector('[data-video]');
  const vlcSlot = root.querySelector('[data-vlc-slot]');
  const bannerEl = root.querySelector('[data-player-banner]');
  const bannerSpinner = root.querySelector('[data-banner-spinner]');
  const bannerText = root.querySelector('[data-banner-text]');
  const errorBox = root.querySelector('[data-player-error]');
  const errorMsgEl = root.querySelector('[data-player-error-msg]');
  const serverPillsEl = root.querySelector('[data-server-pills]');
  const qualityPillsEl = root.querySelector('[data-quality-pills]');
  const subtitleSelect = root.querySelector('[data-subtitle-select]');
  const releasesListEl = root.querySelector('[data-releases-list]');
  const linksPanelEl = root.querySelector('[data-links-panel]');
  const linksListEl = root.querySelector('[data-links-list]');
  const headingEl = root.querySelector('[data-watch-heading]');
  const activeServerBadge = root.querySelector('[data-active-server-badge]');
  const streamSummaryEl = root.querySelector('[data-stream-summary]');

  function currentTargetForExternal() {
    const entry = viewState.activeEntry || viewState.cache[viewState.current];
    const rel = entry?.releases?.[viewState.activeRelease] || entry?.releases?.[0];
    return {
      streamSetId: entry?.streamSetId || '',
      releaseIndex: rel?.serverIndex ?? viewState.activeRelease ?? 0,
      mirrorIndex: viewState.activeMirror || 0,
      resumeSeconds: Math.floor(videoEl.currentTime || 0),
    };
  }

  // Mount MovieBox-TUI's floating VLC launcher button inside video frame
  const vlcButton = createVlcButton({
    target: () => currentTargetForExternal(),
  });
  vlcSlot.appendChild(vlcButton);

  // Mount MovieBox-TUI's full interactive player overlay
  overlayHandle = mountPlayerOverlay({
    frame: frameEl,
    video: videoEl,
    getTitle: () => episodeTitleLabel(),
    getQuality: () => viewState.activeQuality || 'AUTO',
    getSource: () => providerLabel(viewState.current),
    getReleases: () => viewState.activeEntry?.releases || [],
    getSelectedRelease: () => viewState.activeRelease,
    getSubtitleOptions: () => viewState.subtitles,
    getSelectedSubtitle: () => viewState.selectedSub,
    getAutoSubtitles: () => viewState.autoSubs,
    getCanPrevious: () => Boolean(adjacentEpisode(-1)),
    getCanNext: () => Boolean(adjacentEpisode(1)),
    onBack: () => router.navigate(backHref),
    onPrevious: () => {
      const target = adjacentEpisode(-1);
      if (target) switchEpisode(target.season, target.episode);
    },
    onNext: () => {
      const target = adjacentEpisode(1);
      if (target) switchEpisode(target.season, target.episode);
    },
    onSearchSubtitles: () => loadSubtitlesForCurrent(true),
    onSelectSubtitle: (subOpt) => {
      if (!subOpt || subOpt === 'off') applySubtitleByIndex('off');
      else {
        const idx = viewState.subtitles.indexOf(subOpt);
        applySubtitleByIndex(idx >= 0 ? String(idx) : 'off');
      }
    },
    onToggleAutoSubtitles: (enabled) => {
      viewState.autoSubs = Boolean(enabled);
      writeBoolPref(AUTO_SUBS_KEY, viewState.autoSubs);
      overlayHandle?.refresh();
    },
    onSelectRelease: (idx) => playSpecificRelease(Number(idx) || 0, 0),
    onStatus: (msg) => {
      if (msg) toast(msg);
    },
  });

  function updateExternalButtons() {
    const label = viewState.playerSupport?.available
      ? playerButtonLabel(viewState.playerSupport)
      : 'Copy VLC link';
    root.querySelectorAll('[data-open-external-label]').forEach((el) => {
      el.textContent = label;
    });
  }
  updateExternalButtons();

  function setStatus(msg, loading = false, error = '') {
    if (error) {
      errorBox.hidden = false;
      errorMsgEl.textContent = error;
      bannerEl.hidden = true;
      return;
    }
    errorBox.hidden = true;
    if (!msg) {
      bannerEl.hidden = true;
      return;
    }
    bannerEl.hidden = false;
    bannerSpinner.hidden = !loading;
    bannerText.textContent = msg;
  }

  function renderServerPills() {
    const seen = [...new Set([...SERVER_ROTATION, viewState.provider])];
    serverPillsEl.innerHTML = seen
      .map((srv) => {
        const active = srv === viewState.current;
        const cached = viewState.cache[srv];
        const count = Array.isArray(cached?.releases) ? cached.releases.length : null;
        const st = viewState.serverStatuses[srv] || '';
        const dot =
          st === 'playing'
            ? '● '
            : st === 'trying' || st === 'loading'
              ? '◌ '
              : st === 'failed' || st === 'empty'
                ? '× '
                : '';
        return `<button
          type="button"
          data-server-pick="${escapeHtml(srv)}"
          aria-pressed="${active ? 'true' : 'false'}"
          class="inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition ${
            active ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
          }"
        >
          <span>${escapeHtml(dot + serverLabel(srv))}</span>
          <span class="text-[11.5px] ${active ? 'text-white/85' : 'text-fg-2'}">${escapeHtml(providerLabel(srv))}${count !== null ? ` (${count})` : ''}</span>
        </button>`;
      })
      .join('');
    if (activeServerBadge) activeServerBadge.textContent = providerLabel(viewState.current);
  }

  function renderQualityPills() {
    const releases = viewState.activeEntry?.releases || [];
    const seen = new Set();
    const opts = [{ value: 'AUTO', label: 'Auto' }];
    for (const r of releases) {
      const q = String(r.quality || '').trim();
      if (q && !seen.has(q.toUpperCase())) {
        seen.add(q.toUpperCase());
        opts.push({ value: q, label: q });
      }
    }
    qualityPillsEl.innerHTML = opts
      .map((opt) => {
        const on = String(opt.value).toUpperCase() === String(viewState.activeQuality).toUpperCase();
        return `<button
          type="button"
          data-quality-pick="${escapeHtml(opt.value)}"
          aria-pressed="${on ? 'true' : 'false'}"
          class="inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-semibold transition ${
            on ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
          }"
        >${escapeHtml(opt.label)}</button>`;
      })
      .join('');
  }

  function renderEpisodesPanel() {
    if (!viewState.isSeries || !seasons.length) return;
    const seasonsBar = root.querySelector('[data-watch-seasons]');
    const epsGrid = root.querySelector('[data-watch-episodes]');
    const prevBtn = root.querySelector('[data-prev-ep]');
    const nextBtn = root.querySelector('[data-next-ep]');

    if (prevBtn) prevBtn.disabled = !adjacentEpisode(-1);
    if (nextBtn) nextBtn.disabled = !adjacentEpisode(1);

    const seasonNums = orderedSeasonNumbers(seasons);
    seasonsBar.innerHTML = seasonNums
      .map((n) => {
        const on = n === Number(viewState.season);
        return `<button
          type="button"
          data-watch-season="${n}"
          class="inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition ${
            on ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
          }"
        >Season ${n}</button>`;
      })
      .join('');

    const eps = episodesForSeason(viewState.season);
    epsGrid.innerHTML = eps
      .map((ep, idx) => {
        const epNum = episodeNumberOf(ep, idx + 1);
        const active = epNum === Number(viewState.episode);
        const epName = ep.title || `Episode ${epNum}`;
        return `<button
          type="button"
          data-watch-ep="${epNum}"
          class="flex items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[13px] transition ${
            active ? 'pill-selected font-semibold' : 'bg-fill text-fg hover:bg-fill-2'
          }"
        >
          <span class="shrink-0 font-bold tabular-nums">${epNum}.</span>
          <span class="truncate">${escapeHtml(epName)}</span>
        </button>`;
      })
      .join('');
    overlayHandle?.refresh();
  }

  function renderReleasesList() {
    const entry = viewState.activeEntry;
    const releases = entry?.releases || [];
    if (!releases.length) {
      releasesListEl.innerHTML = `<div class="py-3 text-[13px] text-fg-2">No releases reported by ${escapeHtml(providerLabel(viewState.current))}.</div>`;
      if (streamSummaryEl) streamSummaryEl.textContent = '';
      return;
    }
    if (streamSummaryEl) {
      streamSummaryEl.textContent = `${releases.length} stream${releases.length === 1 ? '' : 's'} on ${providerLabel(viewState.current)}`;
    }

    releasesListEl.innerHTML = releases
      .map((rel, idx) => {
        const isCurrent = idx === viewState.activeRelease && Boolean(viewState.activePlayback);
        const quality = rel.quality || 'HD';
        const sizeLabel = rel.size_bytes ? prettySize(rel.size_bytes) : '';
        const unsupported = rel.unsupportedReason;
        const mirrors =
          Array.isArray(rel.mirrors) && rel.mirrors.length ? rel.mirrors : [{ label: 'Mirror 1' }];

        return `
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-[12px] px-3.5 py-2.5 ring-1 transition ${
            isCurrent ? 'bg-brand/12 ring-brand/60' : 'bg-fill/75 ring-edge hover:bg-fill'
          }">
            <button
              type="button"
              data-play-release="${idx}"
              class="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span class="inline-flex h-7 shrink-0 items-center justify-center rounded-[7px] px-2.5 text-[12px] font-bold ${
                isCurrent ? 'pill-selected' : 'bg-fill-2 text-fg'
              }">${escapeHtml(quality)}</span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13.5px] font-semibold text-fg">
                  ${escapeHtml(rel.filename || `${title} (${quality})`)}
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-2">
                  <span>${escapeHtml(providerLabel(rel.provider || viewState.current))}</span>
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
            </button>

            <div class="flex shrink-0 flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-vlc-release="${idx}"
                class="inline-flex h-8 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
                title="Open release in VLC / external player"
              >
                ${iconHtml('tv', { size: 13 })}
                <span>VLC</span>
              </button>
              ${mirrors
                .slice(0, 2)
                .map(
                  (m, mIdx) => `<button
                    type="button"
                    data-dl-release="${idx}"
                    data-dl-mirror="${mIdx}"
                    class="inline-flex h-8 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
                    title="Download ${escapeHtml(m.label || 'file')}"
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

  function recordResolvedPlayback({ playback, release, provider: srv, mirrorIndex = 0 }) {
    setCurrentPlayback(playback, release, srv, mirrorIndex);
    const note =
      release?.unsupportedReason === 'codec'
        ? 'H.265/HEVC — open in VLC if audio-only'
        : release?.unsupportedReason === 'container'
          ? 'MKV container — open in VLC if unsupported'
          : '';
    const row = appendPlaybackLink(
      linksListEl,
      { playback, release, provider: srv, mirrorIndex, note },
      window.location.origin,
    );
    if (row) linksPanelEl.hidden = false;
  }

  async function applySubtitleByIndex(val) {
    if (subtitleSelect) subtitleSelect.value = val;
    revokeTrackBlobs(videoEl);
    videoEl.querySelectorAll('track').forEach((t) => t.remove());

    if (val === 'off' || val === null || val === undefined) {
      viewState.selectedSub = null;
      overlayHandle?.refresh();
      return;
    }

    const idx = Number(val);
    const sub = viewState.subtitles[idx];
    if (!sub || !viewState.subtitleSetId) return;
    viewState.selectedSub = sub;
    overlayHandle?.refresh();

    try {
      const payload = await api.subtitleFile(
        { setId: viewState.subtitleSetId, index: sub.index ?? idx },
        { signal: routeSignal },
      );
      if (disposed || viewState.selectedSub !== sub) return;
      const vtt = subtitleToVtt(payload?.text || '');
      if (!vtt.trim()) return;
      const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }));
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = sub.name || 'Subtitles';
      track.srclang = 'en';
      track.src = blobUrl;
      track.default = true;
      track.dataset.blobUrl = blobUrl;
      videoEl.appendChild(track);
      if (videoEl.textTracks?.[0]) {
        videoEl.textTracks[0].mode = 'showing';
      }
    } catch (err) {
      if (!routeSignal?.aborted) {
        toast(err?.message || 'Subtitle track could not be loaded.', 'error');
      }
    }
  }

  async function loadSubtitlesForCurrent(manual = false) {
    const subRun = ++viewState.subRunId;
    revokeTrackBlobs(videoEl);
    videoEl.querySelectorAll('track').forEach((t) => t.remove());
    viewState.subtitleSetId = '';
    viewState.subtitles = [];
    viewState.selectedSub = null;

    if (!manual && api.state.supports.subtitles === false) return;

    try {
      const resp = await api.subtitles(
        {
          title,
          year,
          season: viewState.isSeries ? viewState.season : 0,
          episode: viewState.isSeries ? viewState.episode : 0,
        },
        { signal: routeSignal },
      );
      if (disposed || subRun !== viewState.subRunId) return;
      api.markSupport('subtitles', true);
      viewState.subtitleSetId = resp?.subtitle_set_id || '';
      const list = Array.isArray(resp?.subtitles) ? resp.subtitles : [];
      viewState.subtitles = list;

      if (subtitleSelect) {
        subtitleSelect.innerHTML = [
          `<option value="off">Off</option>`,
          ...list.map(
            (s, idx) =>
              `<option value="${idx}">${escapeHtml(s.name || s.language || `Subtitle ${idx + 1}`)}</option>`,
          ),
        ].join('');
      }
      overlayHandle?.refresh();

      if (viewState.autoSubs && list.length && viewState.subtitleSetId) {
        const autoSub = pickAutomaticSubtitle(list);
        if (autoSub) {
          const autoIdx = list.indexOf(autoSub);
          if (autoIdx >= 0) await applySubtitleByIndex(String(autoIdx));
        }
      }
      if (manual) {
        toast(list.length ? `Found ${list.length} subtitle tracks` : 'No subtitles found for this title');
      }
    } catch (err) {
      if (err?.status === 404 || err?.status === 501) {
        api.markSupport('subtitles', false);
      }
    }
  }

  function applySavedResumeIfNeeded() {
    if (viewState.resumeApplied) return;
    viewState.resumeApplied = true;
    const saved = library.progressFor(provider, id);
    if (!saved) return;
    if (
      viewState.isSeries &&
      (Number(saved.season) !== Number(viewState.season) ||
        Number(saved.episode) !== Number(viewState.episode))
    ) {
      return;
    }
    const pos = Number(saved.position_seconds) || 0;
    const dur = Number(saved.duration_seconds) || 0;
    if (pos > 8 && (!dur || pos / dur < 0.94)) {
      const seekOnce = () => {
        if (videoEl.duration && pos < videoEl.duration - 4) {
          try {
            videoEl.currentTime = pos;
            toast(`Resumed at ${formatClock(pos)}`);
          } catch {}
        }
      };
      if (videoEl.readyState >= 1) seekOnce();
      else videoEl.addEventListener('loadedmetadata', seekOnce, { once: true });
    }
  }

  async function startPlaybackWithOrder(order, { startRelease = 0 } = {}) {
    const signal = freshRunSignal();
    clearCurrentPlayback();
    renderServerPills();
    setStatus('Connecting to stream…', true);

    const outcome = await autoPlay({
      item: details,
      title,
      year,
      order,
      season: viewState.isSeries ? viewState.season : 0,
      episode: viewState.isSeries ? viewState.episode : 0,
      isSeries: viewState.isSeries,
      cache: viewState.cache,
      startRelease,
      video: videoEl,
      signal,
      hooks: {
        currentPlayer: () => activePlayerInstance,
        onTrack: (p) => {
          activePlayerInstance = p;
        },
        onStatus: (msg, loading) => {
          if (disposed || signal.aborted) return;
          setStatus(msg, Boolean(loading));
        },
        onServerStatus: (srv, st) => {
          if (disposed || signal.aborted) return;
          viewState.serverStatuses[srv] = st;
          if (st === 'loading' || st === 'trying' || st === 'playing') {
            viewState.current = srv;
          }
          renderServerPills();
        },
        onStreams: (entry, activeIdx) => {
          if (disposed || signal.aborted) return;
          viewState.activeEntry = entry;
          viewState.activeRelease = activeIdx;
          renderQualityPills();
          renderReleasesList();
          overlayHandle?.refresh();
        },
        onSelect: (entry, relIdx) => {
          if (disposed || signal.aborted) return;
          viewState.activeEntry = entry;
          viewState.activeRelease = relIdx;
          renderReleasesList();
        },
        onPlayback: ({ playback, release, provider: srv, mirrorIndex }) => {
          if (disposed || signal.aborted) return;
          viewState.activeMirror = mirrorIndex;
          recordResolvedPlayback({ playback, release, provider: srv, mirrorIndex });
        },
        onPlaying: ({ provider: srv, release, entry, quality, playback }) => {
          if (disposed || signal.aborted) return;
          viewState.current = srv;
          viewState.activeEntry = entry;
          viewState.activePlayback = playback;
          viewState.activeQuality = quality || release?.quality || 'AUTO';
          const rIdx = entry.releases.indexOf(release);
          if (rIdx >= 0) viewState.activeRelease = rIdx;
          renderServerPills();
          renderQualityPills();
          renderReleasesList();
          overlayHandle?.refresh();
          setTimeout(() => {
            if (!disposed) bannerEl.hidden = true;
          }, 800);
          applySavedResumeIfNeeded();
          void loadSubtitlesForCurrent(false);
        },
      },
    });

    if (disposed || signal.aborted || outcome?.cancelled) return;

    if (!outcome?.played) {
      const fallbackEntry =
        viewState.cache[viewState.current] ||
        Object.values(viewState.cache).find((e) => e?.releases?.length);
      if (fallbackEntry) {
        viewState.activeEntry = fallbackEntry;
        renderReleasesList();
      }
      setStatus(
        '',
        false,
        outcome?.error ||
          'No browser-playable stream succeeded across servers. Launch directly in VLC to play H.265/MKV streams.',
      );
    }
  }

  async function playSpecificRelease(releaseIdx, mirrorIdx = 0) {
    const signal = freshRunSignal();
    let entry = viewState.activeEntry || viewState.cache[viewState.current];
    if (!entry) {
      entry = await resolveServerStreams({
        provider: viewState.current,
        item: details,
        title,
        year,
        season: viewState.isSeries ? viewState.season : 0,
        episode: viewState.isSeries ? viewState.episode : 0,
        isSeries: viewState.isSeries,
        cache: viewState.cache,
        signal,
      });
    }
    const release = entry?.releases?.[releaseIdx];
    if (!release || signal.aborted) return;

    const quality = String(release.quality || 'AUTO').toUpperCase();
    setStatus(`Opening ${quality} on ${providerLabel(viewState.current)}…`, true);
    await closeActivePlayer(videoEl, activePlayerInstance);
    activePlayerInstance = null;
    if (signal.aborted) return;

    try {
      let playback;
      try {
        playback = await api.play(
          {
            streamSetId: entry.streamSetId,
            releaseIndex: release.serverIndex ?? releaseIdx,
            mirrorIndex: mirrorIdx,
          },
          { signal },
        );
      } catch (err) {
        if (err?.status === 403 || err?.status === 404 || err?.status === 410) {
          const fresh = await refreshServerStreams({
            provider: viewState.current,
            item: details,
            title,
            year,
            season: viewState.isSeries ? viewState.season : 0,
            episode: viewState.isSeries ? viewState.episode : 0,
            isSeries: viewState.isSeries,
            cache: viewState.cache,
            signal,
          });
          if (!fresh || signal.aborted) throw err;
          entry = fresh;
          viewState.activeEntry = fresh;
          const nextRel = entry.releases[releaseIdx] || entry.releases[0];
          playback = await api.play(
            {
              streamSetId: entry.streamSetId,
              releaseIndex: nextRel.serverIndex ?? releaseIdx,
              mirrorIndex: mirrorIdx,
            },
            { signal },
          );
        } else {
          throw err;
        }
      }
      if (disposed || signal.aborted) return;

      recordResolvedPlayback({
        playback,
        release,
        provider: viewState.current,
        mirrorIndex: mirrorIdx,
      });

      const res = await openStream({
        playback,
        video: videoEl,
        signal,
        onTrack: (p) => {
          activePlayerInstance = p;
        },
      });
      if (disposed || signal.aborted || res.cancelled) return;
      if (!res.played) {
        throw res.error || new Error('Selected release could not be played in browser.');
      }

      viewState.activeEntry = entry;
      viewState.activeRelease = releaseIdx;
      viewState.activeMirror = mirrorIdx;
      viewState.activePlayback = playback;
      viewState.activeQuality = release.quality || 'AUTO';
      viewState.serverStatuses[viewState.current] = 'playing';
      renderServerPills();
      renderQualityPills();
      renderReleasesList();
      overlayHandle?.refresh();
      setStatus(`Now playing ${quality}`, false);
      setTimeout(() => {
        if (!disposed) bannerEl.hidden = true;
      }, 700);
      applySavedResumeIfNeeded();
    } catch (err) {
      if (disposed || signal.aborted) return;
      toast(err?.message || 'Release failed in browser — try VLC or another release.', 'error');
      setStatus('', false, err?.message || 'Selected release could not be played in browser.');
    }
  }

  function selectQuality(q) {
    viewState.activeQuality = q;
    renderQualityPills();
    const releases = viewState.activeEntry?.releases || [];
    if (!releases.length) return;
    if (String(q).toUpperCase() === 'AUTO') {
      void playSpecificRelease(0, 0);
      return;
    }
    const idx = releases.findIndex(
      (r) => String(r.quality || '').toUpperCase() === String(q).toUpperCase(),
    );
    if (idx >= 0) void playSpecificRelease(idx, 0);
  }

  function switchEpisode(nextSeason, nextEpisode) {
    viewState.season = Number(nextSeason);
    viewState.episode = Number(nextEpisode);
    viewState.cache = {};
    viewState.serverStatuses = {};
    viewState.activeEntry = null;
    viewState.activePlayback = null;
    viewState.startRelease = 0;
    viewState.resumeApplied = false;
    linksListEl.innerHTML = '';
    linksPanelEl.hidden = true;
    if (headingEl) headingEl.textContent = episodeTitleLabel();
    renderEpisodesPanel();
    const nextUrl = router.watchPath(provider, id, {
      season: viewState.season,
      episode: viewState.episode,
    });
    window.history.replaceState(null, '', nextUrl);
    void startPlaybackWithOrder(defaultRotationFor(viewState.current));
  }

  function persistProgress(force = false) {
    const now = Date.now();
    if (!force && now - lastSavedAt < 12_000) return;
    const position = Math.floor(videoEl.currentTime || 0);
    const duration = Math.floor(videoEl.duration || 0);
    if (position < 3) return;
    lastSavedAt = now;
    void library.updateProgress({
      provider,
      id,
      title,
      media_type: viewState.isSeries ? 'series' : 'movie',
      year,
      poster_url: itemPoster(details) || '',
      official_rating: officialRatingOf(details),
      season: viewState.isSeries ? viewState.season : 0,
      episode: viewState.isSeries ? viewState.episode : 0,
      position_seconds: position,
      duration_seconds: duration > 0 ? duration : 0,
      completed: duration > 0 && position / duration >= 0.94,
    });
  }

  videoEl.addEventListener('timeupdate', () => persistProgress(false));
  videoEl.addEventListener('pause', () => persistProgress(true));
  videoEl.addEventListener('ended', () => {
    persistProgress(true);
    if (viewState.isSeries && viewState.autoNext) {
      const nextTarget = adjacentEpisode(1);
      if (nextTarget) {
        toast(`Up next: S${nextTarget.season} · E${nextTarget.episode}`);
        switchEpisode(nextTarget.season, nextTarget.episode);
      }
    }
  });

  root.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const srvBtn = target.closest('[data-server-pick]');
    if (srvBtn) {
      const srv = srvBtn.dataset.serverPick;
      if (!srv) return;
      viewState.current = srv;
      const customOrder = [srv, ...SERVER_ROTATION.filter((p) => p !== srv)];
      void startPlaybackWithOrder(customOrder);
      return;
    }

    if (target.closest('[data-next-server]')) {
      const rotated = rotationAfter(viewState.current);
      void startPlaybackWithOrder(rotated);
      return;
    }

    if (target.closest('[data-retry-rotation]')) {
      viewState.cache = {};
      viewState.serverStatuses = {};
      void startPlaybackWithOrder(defaultRotationFor(provider));
      return;
    }

    const qBtn = target.closest('[data-quality-pick]');
    if (qBtn) {
      selectQuality(qBtn.dataset.qualityPick || 'AUTO');
      return;
    }

    const playRelBtn = target.closest('[data-play-release]');
    if (playRelBtn) {
      void playSpecificRelease(Number(playRelBtn.dataset.playRelease) || 0, 0);
      return;
    }

    const vlcRelBtn = target.closest('[data-vlc-release]');
    if (vlcRelBtn) {
      const rIdx = Number(vlcRelBtn.dataset.vlcRelease) || 0;
      const entry = viewState.activeEntry || viewState.cache[viewState.current];
      const rel = entry?.releases?.[rIdx];
      if (!entry?.streamSetId) {
        toast('Still resolving streams — try again in a moment.', 'error');
        return;
      }
      const res = await openStreamExternally({
        streamSetId: entry.streamSetId,
        releaseIndex: rel?.serverIndex ?? rIdx,
        mirrorIndex: 0,
        resumeSeconds: Math.floor(videoEl.currentTime || 0),
      });
      const summary = describeOpenResult(res);
      toast(summary.message, summary.kind === 'error' ? 'error' : 'info');
      return;
    }

    const dlBtn = target.closest('[data-dl-release]');
    if (dlBtn) {
      const rIdx = Number(dlBtn.dataset.dlRelease) || 0;
      const mIdx = Number(dlBtn.dataset.dlMirror) || 0;
      const entry = viewState.activeEntry || viewState.cache[viewState.current];
      if (!entry?.streamSetId) return;
      dlBtn.disabled = true;
      try {
        const fname = await downloadRelease({
          entry,
          releaseIndex: rIdx,
          mirrorIndex: mIdx,
        });
        toast(`Downloading ${fname}`);
      } catch (err) {
        toast(err?.message || 'Download could not be started.', 'error');
      } finally {
        dlBtn.disabled = false;
      }
      return;
    }

    const extBtn = target.closest('[data-open-external]');
    if (extBtn) {
      const extTarget = currentTargetForExternal();
      if (!extTarget.streamSetId) {
        toast('Resolving stream first…');
        return;
      }
      const res = await openStreamExternally(extTarget);
      const summary = describeOpenResult(res);
      toast(summary.message, summary.kind === 'error' ? 'error' : 'info');
      return;
    }

    const copyBtn = target.closest('[data-copy-current]');
    if (copyBtn) {
      const extTarget = currentTargetForExternal();
      const rawUrl = viewState.activePlayback?.playback_url || viewState.activePlayback?.url || '';
      const copied = await copyPlaybackUrlOrResolve({
        url: rawUrl,
        streamSetId: extTarget.streamSetId,
        releaseIndex: extTarget.releaseIndex,
        mirrorIndex: extTarget.mirrorIndex,
      });
      toast(
        copied ? 'Playback link copied to clipboard' : 'No resolved link available yet',
        copied ? 'info' : 'error',
      );
      return;
    }

    const copyAllBtn = target.closest('[data-copy-all-links]');
    if (copyAllBtn) {
      const urls = playbackLinkUrls(linksListEl);
      if (urls.length && (await writeClipboard(urls.join('\n')))) {
        toast(`Copied ${urls.length} link${urls.length === 1 ? '' : 's'}`);
      }
      return;
    }

    const seasonBtn = target.closest('[data-watch-season]');
    if (seasonBtn) {
      const sNum = Number(seasonBtn.dataset.watchSeason) || 1;
      const eps = episodesForSeason(sNum);
      const firstEp = eps.length ? episodeNumberOf(eps[0], 1) : 1;
      switchEpisode(sNum, firstEp);
      return;
    }

    const epBtn = target.closest('[data-watch-ep]');
    if (epBtn) {
      switchEpisode(viewState.season, Number(epBtn.dataset.watchEp) || 1);
      return;
    }

    if (target.closest('[data-prev-ep]')) {
      const prev = adjacentEpisode(-1);
      if (prev) switchEpisode(prev.season, prev.episode);
      return;
    }

    if (target.closest('[data-next-ep]')) {
      const next = adjacentEpisode(1);
      if (next) switchEpisode(next.season, next.episode);
    }
  });

  root.addEventListener('change', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.matches('[data-subtitle-select]')) {
      void applySubtitleByIndex(target.value);
      return;
    }
    if (target.matches('[data-auto-next]')) {
      viewState.autoNext = Boolean(target.checked);
      writeBoolPref(AUTO_NEXT_KEY, viewState.autoNext);
    }
  });

  renderServerPills();
  renderQualityPills();
  renderEpisodesPanel();

  // Start real MovieBox-TUI playback immediately
  void startPlaybackWithOrder(viewState.order, { startRelease: viewState.startRelease });

  // Load related titles shelf in background
  void (async () => {
    try {
      const rel = await api.related({ provider, id }, { signal: routeSignal }).catch(() => null);
      if (disposed || routeSignal?.aborted) return;
      const candidates = dedupeItems(Array.isArray(rel?.items) ? rel.items : []).filter(
        (it) => !(itemProvider(it) === provider && itemId(it) === String(id)),
      );
      if (!candidates.length) return;
      viewState.related = rankRelated({
        anchor: details,
        candidates,
        metaLookup: (it) => cachedMeta(itemProvider(it), itemId(it)),
        limit: 14,
      });
      const relHost = root.querySelector('[data-watch-related]');
      const renderRel = () => {
        if (disposed || !relHost || !viewState.related.length) return;
        relHost.innerHTML = shelfHtml({
          key: 'watch-related',
          title: 'More like this',
          itemsHtml: viewState.related
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
      };
      renderRel();
      void ensureMeta(viewState.related);
      window.addEventListener('ifallhub:meta', renderRel, { signal: routeSignal });
      unsubLibrary = library.subscribe(renderRel);
    } catch {}
  })();

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    persistProgress(true);
    abortCurrentRun();
    clearCurrentPlayback();
    if (unsubLibrary) unsubLibrary();
    try {
      overlayHandle?.destroy();
    } catch {}
    revokeTrackBlobs(videoEl);
    void closeActivePlayer(videoEl, activePlayerInstance);
  };

  routeSignal?.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
