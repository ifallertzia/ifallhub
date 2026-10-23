// Sidify-V2 Interactive Sheets (`BetaPlayerSheet`, `VlcPickerSheet`,
// `QualityPickerSheet`, and `EngineSettingsSheet`) wired end-to-end to
// Ifallhub's `/api/*` backend, Shaka/native player engine, subtitles, and VLC launcher.

import * as api from '../lib/api.js';
import {
  SERVER_ROTATION,
  displayUiText,
  escapeHtml,
  formatClock,
  isSeriesItem,
  itemId,
  itemPoster,
  itemTitle,
  itemYear,
  prettySize,
  providerLabel,
} from '../lib/format.js';
import * as library from '../lib/library.js';
import {
  detectClientPlatform,
  externalPlayerLinks,
  itemBackdrop,
  mediaArt,
  orderedSeasonNumbers,
  parseReleaseHints,
  playInVlcViaM3u,
  safeDownloadFilename,
} from '../lib/media-helpers.js';
import {
  autoPlay,
  buildStreamEntry,
  closeActivePlayer,
  isExpiredLinkError,
  matchReleaseIndex,
  openStream,
  pickBestMatch,
  rotationAfter,
} from '../player/engine.js';
import { mountPlayerOverlay } from '../player/overlay.js';
import {
  pickAutomaticSubtitle,
  subtitleLanguageTag,
  subtitleToVtt,
} from '../player/subtitles.js';
import { prepareSearchQuery } from '../player/title-match.js';
import {
  applyTheme,
  cacheDetails,
  cachedDetails,
  setProvider,
  state,
  toast,
} from '../state.js';
import { iconHtml } from './icons.js';
import { appendPlaybackLink, playbackLinkUrls } from './playback-links.js';
import {
  absolutePlaybackUrl,
  copyPlaybackUrlOrResolve,
  describeOpenResult,
  loadPlayerSupport,
  openStreamExternally,
  playerButtonLabel,
  writeClipboard,
} from './vlc-button.js';

let activeCleanup = null;

export function closeActiveSheet() {
  if (activeCleanup) {
    const fn = activeCleanup;
    activeCleanup = null;
    fn();
  }
  const host = typeof document !== 'undefined' ? document.getElementById('sheets-root') : null;
  if (host) host.innerHTML = '';
  if (typeof document !== 'undefined') document.body.style.overflow = '';
}

function mountSheetShell({
  title,
  subtitle = '',
  badgeHtml = '',
  maxWidthClass = 'sm:max-w-[600px]',
  bodyHtml = '',
  onClose = null,
}) {
  closeActiveSheet();
  const host = document.getElementById('sheets-root');
  if (!host) return null;
  document.body.style.overflow = 'hidden';

  host.innerHTML = `
    <div role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" class="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6">
      <button type="button" data-sheet-backdrop aria-label="Close" class="fixed inset-0 bg-black/65 backdrop-blur-sm"></button>
      <div class="menu-glass fade-up relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[22px] sm:rounded-[18px] ${escapeHtml(maxWidthClass)}">
        <div class="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-fill-3 sm:hidden"></div>
        <div class="flex shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-3 hairline-b">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <div class="t-title truncate" data-sheet-title>${escapeHtml(title)}</div>
              ${badgeHtml}
            </div>
            <p class="mt-0.5 truncate text-[12.5px] text-fg-2" data-sheet-subtitle ${subtitle ? '' : 'hidden'}>${escapeHtml(subtitle)}</p>
          </div>
          <button
            type="button"
            data-sheet-close
            aria-label="Close"
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fill text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg"
          >
            ${iconHtml('x', { size: 16 })}
          </button>
        </div>
        <div class="overflow-y-auto px-5 py-4" data-sheet-body>
          ${bodyHtml}
        </div>
      </div>
    </div>`;

  const handleClose = () => {
    closeActiveSheet();
    onClose?.();
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    }
  };
  window.addEventListener('keydown', onKey);
  host.querySelector('[data-sheet-backdrop]')?.addEventListener('click', handleClose);
  host.querySelector('[data-sheet-close]')?.addEventListener('click', handleClose);

  const cleanupList = [() => window.removeEventListener('keydown', onKey)];
  activeCleanup = () => {
    for (const fn of cleanupList.splice(0)) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  };

  return {
    root: host,
    body: host.querySelector('[data-sheet-body]'),
    setSubtitle(text) {
      const el = host.querySelector('[data-sheet-subtitle]');
      if (!el) return;
      el.textContent = text || '';
      el.hidden = !text;
    },
    setTitle(text) {
      const el = host.querySelector('[data-sheet-title]');
      if (el) el.textContent = text || '';
    },
    addCleanup(fn) {
      cleanupList.push(fn);
    },
    close: handleClose,
  };
}

/**
 * Fetches streams for `(provider, id, season, episode)`, walking fallback
 * providers in `SERVER_ROTATION` if the requested provider has no streams.
 */
async function resolveStreamEntriesWithFallback({
  provider,
  id,
  title,
  year,
  isSeries,
  season,
  episode,
}) {
  const order = [provider, ...rotationAfter(provider).filter((p) => p !== provider)];
  let lastError = null;
  for (const candidate of order) {
    try {
      let subjectId = id;
      if (candidate !== provider) {
        const q = prepareSearchQuery(title, year);
        if (!q) continue;
        const found = await api.search({ q, provider: candidate, page: 1 });
        const match = pickBestMatch(found, title, year, isSeries);
        if (!match) continue;
        subjectId = itemId(match);
      }
      const res = await api.streams({
        provider: candidate,
        id: subjectId,
        season: isSeries ? season : 0,
        episode: isSeries ? episode : 0,
        isSeries,
        expectedTitle: title,
        expectedYear: year,
      });
      const entry = buildStreamEntry(
        candidate,
        { id: subjectId, title, year, media_type: isSeries ? 'series' : 'movie' },
        res,
      );
      if (entry.releases.length) return entry;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('No playable streams found across any source.');
}

async function ensureDetailsLoaded(provider, id, fallbackItem = null) {
  const cached = cachedDetails(provider, id);
  if (cached) return cached;
  try {
    const details = await api.details({ provider, id });
    cacheDetails(provider, id, details);
    return details;
  } catch {
    return fallbackItem || { id: { provider, value: id }, title: 'Untitled', media_type: 'movie' };
  }
}

/* ═══════════════════════════════════════════════════════════════
 * 1. Sidify-V2 `BetaPlayerSheet` (Browser Stream + Shaka + Subtitles)
 * ═══════════════════════════════════════════════════════════════ */

const AUTO_SUBTITLES_KEY = 'ifallhub_auto_subtitles_v1';

export async function openBetaPlayerSheet({
  provider = state.provider,
  id,
  season = 0,
  episode = 0,
  item = null,
  details: passedDetails = null,
  onClose = null,
} = {}) {
  if (!id) return;

  const baseTitle = itemTitle(passedDetails || item);
  const seriesGuess =
    isSeriesItem(passedDetails || item) || Number(season) > 0 || Number(episode) > 0;
  let activeSeason = seriesGuess ? Math.max(1, Number(season) || 1) : 0;
  let activeEpisode = seriesGuess ? Math.max(1, Number(episode) || 1) : 0;

  const formatHeaderTitle = (t) =>
    seriesGuess && activeSeason > 0 ? `${t} · S${activeSeason} E${activeEpisode}` : t;

  const sheet = mountSheetShell({
    title: formatHeaderTitle(baseTitle),
    subtitle: 'Resolving best stream across sources…',
    badgeHtml: `<span class="rounded-full bg-fill-2 px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-fg-2 uppercase">Beta</span>`,
    maxWidthClass: 'sm:max-w-[960px]',
    onClose,
    bodyHtml: `
      <div class="space-y-3.5">
        <div class="video-frame relative aspect-video w-full overflow-hidden rounded-[12px] bg-black ring-1 ring-edge" id="sheet-video-frame">
          <video id="sheet-video" playsinline preload="metadata"></video>
          <div class="video-overlay" id="sheet-video-overlay">
            <div class="flex flex-col items-center gap-2">
              ${iconHtml('loader2', { size: 28, className: 'animate-spin text-white/80' })}
              <span class="text-[13px] text-white/80" data-overlay-msg>Finding best stream…</span>
            </div>
          </div>
        </div>

        <!-- Transport, Seek, Sound, Resume & Episode Quick Controls -->
        <div class="flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <div class="flex flex-wrap items-center gap-1.5">
            <button type="button" data-seek="-10" class="inline-flex h-7 items-center gap-1 rounded-full bg-fill px-2.5 font-medium text-fg transition-colors hover:bg-fill-2" title="Back 10 seconds (← or J)">
              ${iconHtml('rotateCcw', { size: 12 })}
              <span>10s</span>
            </button>
            <button type="button" data-seek="10" class="inline-flex h-7 items-center gap-1 rounded-full bg-fill px-2.5 font-medium text-fg transition-colors hover:bg-fill-2" title="Forward 10 seconds (→ or L)">
              <span>10s</span>
              ${iconHtml('rotateCw', { size: 12 })}
            </button>
            <button type="button" data-unmute hidden class="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-3 font-semibold text-on-primary">
              ${iconHtml('volumeX', { size: 13 })}
              <span>Turn sound on</span>
            </button>
            <span data-resume-pill hidden class="inline-flex h-7 items-center gap-1.5 rounded-full bg-fill px-2.5 text-fg-2">
              <span data-resume-label></span>
              <span>·</span>
              <button type="button" data-start-over class="font-semibold text-playing hover:opacity-80">Start over</button>
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button type="button" data-prev-ep hidden class="inline-flex h-7 items-center gap-1 rounded-full bg-fill px-2.5 font-medium text-fg hover:bg-fill-2">
              ${iconHtml('chevronLeft', { size: 13 })}
              <span>Prev</span>
            </button>
            <button type="button" data-next-ep hidden class="inline-flex h-7 items-center gap-1 rounded-full bg-fill px-2.5 font-medium text-fg hover:bg-fill-2">
              <span>Next ep</span>
              ${iconHtml('chevronRight', { size: 13 })}
            </button>
            <button type="button" data-subtitles-quick class="inline-flex h-7 items-center gap-1 rounded-full bg-fill px-2.5 font-medium text-fg hover:bg-fill-2">
              ${iconHtml('subtitles', { size: 13 })}
              <span data-subs-label>Subtitles</span>
            </button>
            <button type="button" data-open-vlc class="inline-flex h-7 items-center gap-1 rounded-full bg-fill px-2.5 font-medium text-fg hover:bg-fill-2">
              ${iconHtml('monitorPlay', { size: 13 })}
              <span data-vlc-btn-label>Play with VLC</span>
            </button>
          </div>
        </div>

        <!-- Server Rotation & Quality Selector -->
        <div class="space-y-2 rounded-[12px] bg-fill/55 px-3.5 py-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2 text-[11.5px]">
            <span class="font-semibold tracking-wider text-fg-2 uppercase">Sources &amp; Qualities</span>
            <div class="flex flex-wrap items-center gap-1" data-server-chips></div>
          </div>
          <div class="no-scrollbar flex items-center gap-1.5 overflow-x-auto pt-0.5" data-quality-pills>
            <span class="text-[12px] text-fg-2">Loading qualities…</span>
          </div>
        </div>

        <!-- Sidify-V2 "No sound / black screen?" Help Drawer + Resolved Links -->
        <details class="group rounded-[12px] bg-fill/60 px-3.5 py-2.5 text-[12.5px] text-fg-2">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-fg">
            <span class="inline-flex items-center gap-1.5">
              ${iconHtml('volume2', { size: 14, className: 'text-fg-2' })}
              <span>No sound, black screen, or external player links?</span>
            </span>
            <span class="text-[11.5px] font-semibold text-playing">Options ▾</span>
          </summary>
          <div class="mt-2.5 space-y-3 border-t border-edge pt-2.5">
            <p class="leading-relaxed">
              Many 4K / BluRay releases carry <strong class="text-fg">Dolby AC-3 / EAC-3 / DTS</strong> audio or <strong class="text-fg">10-bit HEVC</strong> video which browsers mute or skip. Switch to a browser-safe H.264/AAC quality or open directly in <strong class="text-fg">VLC</strong>.
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" data-try-next-quality class="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary">
                <span>Try next quality</span>
              </button>
              <button type="button" data-switch-vlc-sheet class="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3">
                ${iconHtml('monitorPlay', { size: 13 })}
                <span>VLC options</span>
              </button>
              <button type="button" data-switch-dl-sheet class="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3">
                ${iconHtml('download', { size: 13 })}
                <span>Download</span>
              </button>
              <button type="button" data-copy-all-links class="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3">
                ${iconHtml('copy', { size: 13 })}
                <span>Copy stream link</span>
              </button>
            </div>
            <div class="playback-links">
              <div class="mb-1.5 flex items-center justify-between text-[11px] font-semibold tracking-wider text-fg-2 uppercase">
                <span>Resolved playback links</span>
                <span data-links-count>0 links</span>
              </div>
              <div id="watch-playback-links">
                <p class="text-[12px] text-fg-3" data-links-empty>Links appear here as streams are resolved.</p>
              </div>
            </div>
          </div>
        </details>
      </div>`,
  });

  if (!sheet) return;

  let cancelled = false;
  let playAbort = new AbortController();
  const streamCache = new Map();
  let shakaInstance = null;
  let playerOverlay = null;
  let currentEntry = null;
  let currentReleaseIndex = 0;
  let currentMirrorIndex = 0;
  let currentPlaybackUrl = '';
  let currentDecoder = 'AUTO';
  let subtitleSetId = '';
  let subtitleOptions = [];
  let selectedSubtitleIndex = null;
  let subtitleBlobUrl = null;
  let autoSubtitles = true;
  try {
    autoSubtitles = localStorage.getItem(AUTO_SUBTITLES_KEY) !== '0';
  } catch {
    /* ignore */
  }

  const body = sheet.body;
  const video = body.querySelector('#sheet-video');
  const frame = body.querySelector('#sheet-video-frame');
  const videoOverlay = body.querySelector('#sheet-video-overlay');
  const linksContainer = body.querySelector('#watch-playback-links');
  const qualityPills = body.querySelector('[data-quality-pills]');
  const serverChips = body.querySelector('[data-server-chips]');
  const unmuteBtn = body.querySelector('[data-unmute]');
  const resumePill = body.querySelector('[data-resume-pill]');
  const resumeLabel = body.querySelector('[data-resume-label]');
  const prevEpBtn = body.querySelector('[data-prev-ep]');
  const nextEpBtn = body.querySelector('[data-next-ep]');
  const subsLabel = body.querySelector('[data-subs-label]');
  const vlcBtnLabel = body.querySelector('[data-vlc-btn-label]');

  const serverStatus = new Map();
  const details = passedDetails || (await ensureDetailsLoaded(provider, id, item));
  if (cancelled) return;

  const isSeries = isSeriesItem(details) || seriesGuess;
  if (isSeries && activeSeason <= 0) {
    const ordered = orderedSeasonNumbers(details.seasons || []);
    activeSeason = ordered[0] || 1;
    activeEpisode = 1;
  }

  const backdrop =
    itemBackdrop(details) ||
    mediaArt(itemTitle(details), itemYear(details), isSeries ? 'series' : 'movie', 'backdrop');
  video.poster = backdrop;
  sheet.setTitle(formatHeaderTitle(itemTitle(details)));

  loadPlayerSupport()
    .then((support) => {
      if (!cancelled && vlcBtnLabel && support?.available) {
        vlcBtnLabel.textContent = playerButtonLabel(support);
      }
    })
    .catch(() => {});

  function renderServerChips() {
    if (!serverChips) return;
    const order = [provider, ...rotationAfter(provider).filter((p) => p !== provider)];
    serverChips.innerHTML = order
      .map((srv) => {
        const st = serverStatus.get(srv) || 'idle';
        const tone =
          st === 'playing'
            ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40'
            : st === 'trying' || st === 'loading'
              ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40'
              : st === 'failed' || st === 'empty'
                ? 'bg-red-500/15 text-red-300'
                : 'bg-fill text-fg-3';
        return `<span class="rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${tone}">${escapeHtml(providerLabel(srv))}${st === 'playing' ? ' ●' : st === 'trying' || st === 'loading' ? '…' : ''}</span>`;
      })
      .join('');
  }

  function renderQualityPills() {
    if (!qualityPills) return;
    const releases = currentEntry?.releases || [];
    if (!releases.length) {
      qualityPills.innerHTML = `<span class="text-[12px] text-fg-3">No qualities loaded yet.</span>`;
      return;
    }
    qualityPills.innerHTML = releases
      .map((rel, idx) => {
        const active = idx === currentReleaseIndex;
        const hints = parseReleaseHints(rel.filename, rel.codec);
        const q = rel.quality || 'Auto';
        const size = prettySize(rel.size_bytes);
        const hintStr = hints.chips.slice(0, 2).join(' · ');
        const label = [q, size, hintStr].filter(Boolean).join(' · ');
        return `<button
          type="button"
          data-pick-release="${idx}"
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors ${
            active ? 'bg-primary text-on-primary' : 'bg-fill-2 text-fg hover:bg-fill-3'
          }"
          title="${escapeHtml(displayUiText(rel.filename || q))}"
        >${escapeHtml(label)}</button>`;
      })
      .join('');
  }

  function adjacentEpisode(delta) {
    if (!isSeries) return null;
    const seasons = (details.seasons || []).slice().sort((a, b) => a.season_number - b.season_number);
    if (!seasons.length) return null;
    const curS = seasons.find((s) => Number(s.season_number) === activeSeason) || seasons[0];
    const epCount = Math.max(1, Number(curS?.episode_count) || (curS?.episodes?.length || 1));
    const nextEp = activeEpisode + delta;
    if (nextEp >= 1 && nextEp <= epCount) {
      return { season: activeSeason, episode: nextEp };
    }
    const idx = seasons.findIndex((s) => Number(s.season_number) === activeSeason);
    if (delta > 0 && idx >= 0 && idx + 1 < seasons.length) {
      return { season: Number(seasons[idx + 1].season_number), episode: 1 };
    }
    if (delta < 0 && idx > 0) {
      const prevS = seasons[idx - 1];
      const prevCount = Math.max(1, Number(prevS.episode_count) || (prevS.episodes?.length || 1));
      return { season: Number(prevS.season_number), episode: prevCount };
    }
    return null;
  }

  function syncEpisodeButtons() {
    if (prevEpBtn) prevEpBtn.hidden = !adjacentEpisode(-1);
    if (nextEpBtn) nextEpBtn.hidden = !adjacentEpisode(1);
  }

  function showLoadingOverlay(msg) {
    if (!videoOverlay) return;
    videoOverlay.hidden = false;
    videoOverlay.innerHTML = `
      <div class="flex flex-col items-center gap-2">
        ${iconHtml('loader2', { size: 28, className: 'animate-spin text-white/80' })}
        <span class="text-[13px] text-white/80" data-overlay-msg>${escapeHtml(msg || 'Loading stream…')}</span>
      </div>`;
  }

  function showErrorOverlay(msg) {
    if (!videoOverlay) return;
    videoOverlay.hidden = false;
    videoOverlay.innerHTML = `
      <div class="overlay-mark">!</div>
      <h3>Couldn’t play in browser</h3>
      <p>${escapeHtml(displayUiText(msg || 'This stream format requires VLC or another quality.'))}</p>
      <div class="mt-2 flex flex-wrap justify-center gap-2">
        <button type="button" data-overlay-retry class="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-black">Retry</button>
        <button type="button" data-overlay-vlc class="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-4 text-[13px] font-semibold text-white ring-1 ring-white/25">Play with VLC</button>
      </div>`;
    videoOverlay.querySelector('[data-overlay-retry]')?.addEventListener('click', () => void startAutoPlay());
    videoOverlay.querySelector('[data-overlay-vlc]')?.addEventListener('click', () => {
      void openVlcPickerSheet({ provider, id, season: activeSeason, episode: activeEpisode, item: details, details });
    });
  }

  function clearSubtitleTrack() {
    if (shakaInstance && typeof shakaInstance.selectTextTrack === 'function') {
      try { shakaInstance.selectTextTrack(null); } catch { /* ignore */ }
    }
    video.querySelectorAll('track[data-online-subtitle]').forEach((t) => t.remove());
    if (subtitleBlobUrl) {
      URL.revokeObjectURL(subtitleBlobUrl);
      subtitleBlobUrl = null;
    }
  }

  async function applySubtitleOption(rawVal) {
    clearSubtitleTrack();
    selectedSubtitleIndex = null;
    if (rawVal === '' || rawVal == null) {
      if (subsLabel) subsLabel.textContent = 'Subtitles off';
      playerOverlay?.refresh();
      return;
    }
    const chosen = subtitleOptions.find((o) => String(o.index) === String(rawVal));
    if (!chosen || !subtitleSetId) return;
    try {
      if (subsLabel) subsLabel.textContent = 'Loading CC…';
      const payload = await api.subtitleFile({ setId: subtitleSetId, index: chosen.index });
      if (cancelled) return;
      const rawText = typeof payload === 'string' ? payload : payload?.text || '';
      const vtt = subtitleToVtt(rawText);
      subtitleBlobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }));
      const lang = subtitleLanguageTag(chosen.language || chosen.name);

      if (shakaInstance && typeof shakaInstance.addTextTrackAsync === 'function') {
        try {
          const stTrack = await shakaInstance.addTextTrackAsync(
            subtitleBlobUrl,
            lang === 'und' ? 'en' : lang,
            'subtitles',
            'text/vtt',
            undefined,
            displayUiText(chosen.name || 'Subtitles'),
          );
          shakaInstance.selectTextTrack(stTrack);
        } catch {
          /* fall back to native track below */
        }
      } else {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = displayUiText(chosen.name || chosen.language || 'Subtitles');
        track.srclang = lang === 'und' ? 'en' : lang;
        track.src = subtitleBlobUrl;
        track.default = true;
        track.dataset.onlineSubtitle = '1';
        video.appendChild(track);
        if (track.track) track.track.mode = 'showing';
      }

      selectedSubtitleIndex = chosen.index;
      const select = frame.querySelector('#subtitle-language');
      if (select) select.value = String(chosen.index);
      if (subsLabel) subsLabel.textContent = `CC · ${(lang === 'und' ? 'ON' : lang).toUpperCase()}`;
      playerOverlay?.refresh();
    } catch (err) {
      if (subsLabel) subsLabel.textContent = 'Subtitles';
      toast(displayUiText(err.message || 'Subtitle failed to load'), 'error');
    }
  }

  async function loadOnlineSubtitles({ autoApply = false } = {}) {
    try {
      const response = await api.subtitles({
        title: itemTitle(details),
        year: itemYear(details),
        season: isSeries ? activeSeason : 0,
        episode: isSeries ? activeEpisode : 0,
      });
      if (cancelled) return;
      subtitleSetId = response?.subtitle_set_id || '';
      subtitleOptions = Array.isArray(response?.subtitles) ? response.subtitles : [];
      const select = frame.querySelector('#subtitle-language');
      if (select) {
        select.innerHTML =
          '<option value="">Subtitles off</option>' +
          subtitleOptions
            .map(
              (o) =>
                `<option value="${escapeHtml(String(o.index))}">${escapeHtml(displayUiText(o.name || o.language || 'Subtitle'))}</option>`,
            )
            .join('');
        select.disabled = !subtitleOptions.length;
      }
      if (autoApply && autoSubtitles && subtitleOptions.length) {
        const preferred = pickAutomaticSubtitle(subtitleOptions);
        if (preferred) await applySubtitleOption(preferred.index);
      } else if (!subtitleOptions.length && subsLabel) {
        subsLabel.textContent = 'No CC';
      }
    } catch {
      /* Subtitles are optional */
    }
  }

  function reportProgress() {
    if (!video || !Number.isFinite(video.duration) || video.duration < 15) return;
    if (video.currentTime < 3) return;
    void library.updateProgress({
      provider,
      id,
      title: itemTitle(details),
      poster_url: itemPoster(details) || null,
      year: itemYear(details) || null,
      media_type: isSeries ? 'series' : 'movie',
      season: isSeries ? activeSeason : 0,
      episode: isSeries ? activeEpisode : 0,
      position_seconds: video.currentTime,
      duration_seconds: video.duration,
      completed: video.duration > 0 && video.currentTime / video.duration >= 0.92,
    });
  }

  playerOverlay = mountPlayerOverlay({
    frame,
    video,
    getPlayer: () => shakaInstance,
    getTitle: () => formatHeaderTitle(itemTitle(details)),
    getQuality: () => currentEntry?.releases?.[currentReleaseIndex]?.quality || 'AUTO',
    getDecoder: () => currentDecoder,
    getSource: () => providerLabel(currentEntry?.provider || provider),
    getReleases: () => currentEntry?.releases || [],
    getSelectedRelease: () => currentReleaseIndex,
    getSubtitleOptions: () => subtitleOptions,
    getSelectedSubtitle: () => selectedSubtitleIndex,
    getAutoSubtitles: () => autoSubtitles,
    getCanPrevious: () => Boolean(adjacentEpisode(-1)),
    getCanNext: () => Boolean(adjacentEpisode(1)),
    onBack: () => sheet.close(),
    onPrevious: () => {
      const target = adjacentEpisode(-1);
      if (target) void switchEpisode(target.season, target.episode);
    },
    onNext: () => {
      const target = adjacentEpisode(1);
      if (target) void switchEpisode(target.season, target.episode);
    },
    onSearchSubtitles: () => loadOnlineSubtitles({ autoApply: true }),
    onSelectSubtitle: (val) => void applySubtitleOption(val),
    onToggleAutoSubtitles: (checked) => {
      autoSubtitles = Boolean(checked);
      try {
        localStorage.setItem(AUTO_SUBTITLES_KEY, autoSubtitles ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    onSelectRelease: (idx) => void selectSpecificRelease(idx),
    onStatus: (msg) => sheet.setSubtitle(displayUiText(msg)),
  });

  async function seekWhenReady(seconds) {
    if (!(seconds > 3)) return;
    const applySeek = () => {
      try {
        if (!Number.isFinite(video.duration) || seconds < video.duration - 2) {
          video.currentTime = seconds;
        }
      } catch {
        /* ignore */
      }
    };
    if (video.readyState >= 1) applySeek();
    else video.addEventListener('loadedmetadata', applySeek, { once: true });
  }

  async function selectSpecificRelease(idx, isRetry = false) {
    if (!currentEntry || !currentEntry.releases[idx]) return;
    const savedTime = Number(video.currentTime) || 0;
    const pickedRelease = currentEntry.releases[idx];
    playAbort.abort();
    playAbort = new AbortController();
    showLoadingOverlay(`Switching to ${pickedRelease.quality || 'stream'}…`);

    try {
      shakaInstance = await closeActivePlayer(video, shakaInstance);
      const playback = await api.play(
        {
          streamSetId: currentEntry.streamSetId,
          releaseIndex: pickedRelease.serverIndex ?? idx,
          mirrorIndex: 0,
        },
        { signal: playAbort.signal },
      );
      if (cancelled || playAbort.signal.aborted) return;
      currentPlaybackUrl = playback?.playback_url || playback?.url || '';
      appendPlaybackLink(
        linksContainer,
        { playback, release: pickedRelease, provider: currentEntry.provider, mirrorIndex: 0 },
        window.location.origin,
      );

      const res = await openStream({
        playback,
        video,
        signal: playAbort.signal,
        onTrack: (p) => { shakaInstance = p; },
      });
      if (cancelled || playAbort.signal.aborted) return;
      if (!res.played) throw res.error || new Error('Could not play selected quality.');

      shakaInstance = res.player;
      currentReleaseIndex = idx;
      currentMirrorIndex = 0;
      currentDecoder = String(playback?.stream_type || 'NATIVE').toUpperCase();
      videoOverlay.hidden = true;
      await seekWhenReady(savedTime);
      if (selectedSubtitleIndex != null) void applySubtitleOption(selectedSubtitleIndex);
      renderQualityPills();
      playerOverlay?.refresh();
      sheet.setSubtitle(
        `${providerLabel(currentEntry.provider)} · ${pickedRelease.quality || 'Auto'}${pickedRelease.size_bytes ? ` · ${prettySize(pickedRelease.size_bytes)}` : ''}`,
      );
    } catch (err) {
      if (cancelled || playAbort.signal.aborted) return;
      if (!isRetry && isExpiredLinkError(err)) {
        try {
          const fresh = await api.streams({
            provider: currentEntry.provider,
            id: itemId(currentEntry.item),
            season: isSeries ? activeSeason : 0,
            episode: isSeries ? activeEpisode : 0,
            isSeries,
            expectedTitle: itemTitle(details),
            expectedYear: itemYear(details),
          });
          currentEntry = buildStreamEntry(currentEntry.provider, currentEntry.item, fresh);
          const nextIdx = matchReleaseIndex(currentEntry.releases, pickedRelease);
          return selectSpecificRelease(nextIdx, true);
        } catch {
          /* fall through */
        }
      }
      showErrorOverlay(err.message);
    }
  }

  async function startAutoPlay() {
    playAbort.abort();
    playAbort = new AbortController();
    serverStatus.clear();
    renderServerChips();
    syncEpisodeButtons();
    clearSubtitleTrack();
    showLoadingOverlay('Checking sources…');

    const saved = library.progressFor(provider, id);
    const sameEp =
      !isSeries ||
      (Number(saved?.season) === activeSeason && Number(saved?.episode) === activeEpisode);
    const resumeSeconds =
      saved && sameEp && !saved.completed && Number(saved.position_seconds) > 5
        ? Number(saved.position_seconds)
        : 0;

    if (resumeSeconds > 0 && resumePill && resumeLabel) {
      resumeLabel.textContent = `Resumed from ${formatClock(resumeSeconds)}`;
      resumePill.hidden = false;
    } else if (resumePill) {
      resumePill.hidden = true;
    }

    const order = [provider, ...rotationAfter(provider).filter((p) => p !== provider)];

    const result = await autoPlay({
      item: details,
      title: itemTitle(details),
      year: itemYear(details),
      order,
      season: isSeries ? activeSeason : 0,
      episode: isSeries ? activeEpisode : 0,
      isSeries,
      cache: streamCache,
      startRelease: 0,
      video,
      signal: playAbort.signal,
      hooks: {
        currentPlayer: () => shakaInstance,
        onTrack: (player) => {
          shakaInstance = player;
        },
        onStatus: (msg) => {
          if (!cancelled) {
            sheet.setSubtitle(displayUiText(msg));
            const ovMsg = videoOverlay?.querySelector('[data-overlay-msg]');
            if (ovMsg) ovMsg.textContent = displayUiText(msg);
          }
        },
        onServerStatus: (srv, st) => {
          serverStatus.set(srv, st);
          if (!cancelled) renderServerChips();
        },
        onStreams: (entry, firstIdx) => {
          currentEntry = entry;
          currentReleaseIndex = firstIdx;
          if (!cancelled) renderQualityPills();
        },
        onSelect: (entry, relIdx) => {
          currentEntry = entry;
          currentReleaseIndex = relIdx;
          if (!cancelled) renderQualityPills();
        },
        onPlayback: (attempt) => {
          currentPlaybackUrl = attempt?.playback?.playback_url || attempt?.playback?.url || '';
          currentMirrorIndex = attempt?.mirrorIndex || 0;
          appendPlaybackLink(linksContainer, attempt, window.location.origin);
        },
      },
    });

    if (cancelled || result?.cancelled) return;

    if (!result?.played) {
      showErrorOverlay(result?.error || 'No browser-playable stream found across sources.');
      sheet.setSubtitle('Browser playback unavailable — open in VLC or try another source.');
      return;
    }

    currentEntry = result.entry;
    const matchedIdx = result.entry?.releases?.indexOf(result.release) ?? 0;
    currentReleaseIndex = matchedIdx >= 0 ? matchedIdx : 0;
    currentDecoder = String(result.playback?.stream_type || 'NATIVE').toUpperCase();
    videoOverlay.hidden = true;
    await seekWhenReady(resumeSeconds);
    renderQualityPills();
    playerOverlay?.refresh();
    const rel = result.release || {};
    sheet.setSubtitle(
      `${providerLabel(result.provider)} · ${rel.quality || 'Auto'}${rel.size_bytes ? ` · ${prettySize(rel.size_bytes)}` : ''}`,
    );
    if (unmuteBtn) unmuteBtn.hidden = !video.muted;
    void loadOnlineSubtitles({ autoApply: true });
  }

  async function switchEpisode(nextSeason, nextEpisode) {
    reportProgress();
    activeSeason = nextSeason;
    activeEpisode = nextEpisode;
    sheet.setTitle(formatHeaderTitle(itemTitle(details)));
    await startAutoPlay();
  }

  const progressTimer = setInterval(reportProgress, 10_000);
  video.addEventListener('pause', reportProgress);
  video.addEventListener('volumechange', () => {
    if (unmuteBtn) unmuteBtn.hidden = !video.muted;
  });
  video.addEventListener('ended', () => {
    reportProgress();
    const nxt = adjacentEpisode(1);
    if (nxt) {
      toast(`Playing S${nxt.season} · E${nxt.episode}…`);
      void switchEpisode(nxt.season, nxt.episode);
    }
  });

  const onShortKeys = (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      video.currentTime = Math.max(0, (video.currentTime || 0) - 10);
    } else if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + 10);
    }
  };
  window.addEventListener('keydown', onShortKeys);

  body.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const seekBtn = target.closest('[data-seek]');
    if (seekBtn) {
      const delta = Number(seekBtn.dataset.seek) || 0;
      video.currentTime = Math.max(
        0,
        Math.min(video.duration || Infinity, (video.currentTime || 0) + delta),
      );
      return;
    }

    if (target.closest('[data-unmute]')) {
      video.muted = false;
      if (video.volume === 0) video.volume = 1;
      unmuteBtn.hidden = true;
      return;
    }

    if (target.closest('[data-start-over]')) {
      video.currentTime = 0;
      resumePill.hidden = true;
      video.play().catch(() => {});
      return;
    }

    if (target.closest('[data-prev-ep]')) {
      const prev = adjacentEpisode(-1);
      if (prev) void switchEpisode(prev.season, prev.episode);
      return;
    }

    if (target.closest('[data-next-ep]')) {
      const nxt = adjacentEpisode(1);
      if (nxt) void switchEpisode(nxt.season, nxt.episode);
      return;
    }

    if (target.closest('[data-subtitles-quick]')) {
      const subChip = frame.querySelector('[data-action="subtitles"]');
      if (subChip) subChip.click();
      else void loadOnlineSubtitles({ autoApply: true });
      return;
    }

    const pickBtn = target.closest('[data-pick-release]');
    if (pickBtn) {
      const idx = Number(pickBtn.dataset.pickRelease);
      if (Number.isInteger(idx)) void selectSpecificRelease(idx);
      return;
    }

    if (target.closest('[data-try-next-quality]')) {
      const releases = currentEntry?.releases || [];
      if (releases.length > 1) {
        void selectSpecificRelease((currentReleaseIndex + 1) % releases.length);
      } else {
        toast('No other qualities available on this source.');
      }
      return;
    }

    if (target.closest('[data-open-vlc]')) {
      const rel = currentEntry?.releases?.[currentReleaseIndex];
      if (currentEntry?.streamSetId && rel) {
        const res = await openStreamExternally({
          streamSetId: currentEntry.streamSetId,
          releaseIndex: rel.serverIndex ?? currentReleaseIndex,
          mirrorIndex: currentMirrorIndex,
          resumeSeconds: video.currentTime || 0,
        });
        if (res.opened) {
          video.pause();
          toast(describeOpenResult(res).message);
          return;
        }
      }
      reportProgress();
      void openVlcPickerSheet({
        provider,
        id,
        season: activeSeason,
        episode: activeEpisode,
        item: details,
        details,
      });
      return;
    }

    if (target.closest('[data-switch-vlc-sheet]')) {
      reportProgress();
      void openVlcPickerSheet({
        provider,
        id,
        season: activeSeason,
        episode: activeEpisode,
        item: details,
        details,
      });
      return;
    }

    if (target.closest('[data-switch-dl-sheet]')) {
      reportProgress();
      void openQualityPickerSheet({
        provider,
        id,
        season: activeSeason,
        episode: activeEpisode,
        item: details,
        details,
      });
      return;
    }

    if (target.closest('[data-copy-all-links]')) {
      const urls = playbackLinkUrls(linksContainer);
      if (urls.length) {
        const ok = await writeClipboard(urls.join('\n'));
        toast(ok ? 'Stream link copied to clipboard' : 'Select link below to copy manually');
      } else {
        const rel = currentEntry?.releases?.[currentReleaseIndex];
        const copied = await copyPlaybackUrlOrResolve({
          url: currentPlaybackUrl,
          streamSetId: currentEntry?.streamSetId,
          releaseIndex: rel?.serverIndex ?? currentReleaseIndex,
          mirrorIndex: currentMirrorIndex,
        });
        toast(
          copied ? 'Stream link copied to clipboard' : 'No stream link resolved yet',
          copied ? 'info' : 'error',
        );
      }
    }
  });

  sheet.addCleanup(() => {
    cancelled = true;
    playAbort.abort();
    clearInterval(progressTimer);
    window.removeEventListener('keydown', onShortKeys);
    reportProgress();
    clearSubtitleTrack();
    playerOverlay?.destroy();
    void closeActivePlayer(video, shakaInstance);
  });

  await startAutoPlay();
}

/* ═══════════════════════════════════════════════════════════════
 * 2. Sidify-V2 `VlcPickerSheet` ("Play with VLC")
 * ═══════════════════════════════════════════════════════════════ */

export async function openVlcPickerSheet({
  provider = state.provider,
  id,
  season = 0,
  episode = 0,
  item = null,
  details: passedDetails = null,
} = {}) {
  if (!id) return;
  const baseTitle = itemTitle(passedDetails || item);
  const seriesGuess =
    isSeriesItem(passedDetails || item) || Number(season) > 0 || Number(episode) > 0;
  const epSuffix = seriesGuess && season > 0 ? ` · S${season} E${episode || 1}` : '';

  const sheet = mountSheetShell({
    title: `Play with VLC · ${baseTitle}${epSuffix}`,
    subtitle: 'Full HEVC, Dolby Atmos, AC-3, DTS & MKV support',
    maxWidthClass: 'sm:max-w-[640px]',
    bodyHtml: `
      <div class="space-y-3" data-vlc-content>
        <div class="flex items-center justify-center gap-2 py-10 text-[13.5px] text-fg-2">
          ${iconHtml('loader2', { size: 18, className: 'animate-spin' })}
          <span>Loading streams for VLC…</span>
        </div>
      </div>`,
  });
  if (!sheet) return;

  let cancelled = false;
  sheet.addCleanup(() => {
    cancelled = true;
  });

  const details = passedDetails || (await ensureDetailsLoaded(provider, id, item));
  if (cancelled) return;
  const isSeries = isSeriesItem(details) || seriesGuess;
  const sNum = isSeries ? Math.max(1, Number(season) || 1) : 0;
  const eNum = isSeries ? Math.max(1, Number(episode) || 1) : 0;
  const platform = detectClientPlatform();
  const support = await loadPlayerSupport().catch(() => ({ available: false, players: [] }));
  if (cancelled) return;

  let currentEntry = null;
  let activeProvider = provider;

  function renderSourcePills() {
    return `
      <div class="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1">
        ${SERVER_ROTATION.map((srv) => {
          const on = srv === activeProvider;
          return `<button type="button" data-vlc-source="${escapeHtml(srv)}" class="h-7 shrink-0 rounded-full px-3 text-[12px] font-semibold transition-colors ${
            on ? 'bg-primary text-on-primary' : 'bg-fill text-fg-2 hover:bg-fill-2 hover:text-fg'
          }">${escapeHtml(providerLabel(srv))}</button>`;
        }).join('')}
      </div>`;
  }

  async function loadForProvider(targetProvider, allowFallback = true) {
    const container = sheet.body.querySelector('[data-vlc-content]');
    if (!container) return;
    container.innerHTML = `
      <div class="flex items-center justify-center gap-2 py-10 text-[13.5px] text-fg-2">
        ${iconHtml('loader2', { size: 18, className: 'animate-spin' })}
        <span>Checking ${escapeHtml(providerLabel(targetProvider))}…</span>
      </div>`;

    try {
      if (allowFallback) {
        currentEntry = await resolveStreamEntriesWithFallback({
          provider: targetProvider,
          id,
          title: itemTitle(details),
          year: itemYear(details),
          isSeries,
          season: sNum,
          episode: eNum,
        });
      } else {
        let subjectId = id;
        if (targetProvider !== provider) {
          const q = prepareSearchQuery(itemTitle(details), itemYear(details));
          const found = await api.search({ q, provider: targetProvider, page: 1 });
          const match = pickBestMatch(found, itemTitle(details), itemYear(details), isSeries);
          if (!match) throw new Error(`Title not found on ${providerLabel(targetProvider)}.`);
          subjectId = itemId(match);
        }
        const res = await api.streams({
          provider: targetProvider,
          id: subjectId,
          season: sNum,
          episode: eNum,
          isSeries,
          expectedTitle: itemTitle(details),
          expectedYear: itemYear(details),
        });
        currentEntry = buildStreamEntry(targetProvider, details, res);
      }
      activeProvider = currentEntry.provider;
      if (!cancelled) renderList();
    } catch (err) {
      if (cancelled) return;
      activeProvider = targetProvider;
      container.innerHTML =
        renderSourcePills() +
        `
        <div class="rounded-[12px] bg-fill px-4 py-6 text-center text-[13.5px] text-fg-2">
          <p class="font-medium text-fg">${escapeHtml(displayUiText(err.message || 'No streams found'))}</p>
          <p class="mt-1 text-[12px]">Pick another source above to check alternate mirrors.</p>
        </div>`;
    }
  }

  function renderList() {
    const container = sheet.body.querySelector('[data-vlc-content]');
    if (!container || !currentEntry) return;
    const saved = library.progressFor(provider, id);
    const resumeSeconds = saved && !saved.completed ? Number(saved.position_seconds) || 0 : 0;

    container.innerHTML = `
      ${renderSourcePills()}
      <p class="text-[12.5px] leading-relaxed text-fg-2">
        ${
          support?.available
            ? `<strong class="text-fg">${escapeHtml(playerButtonLabel(support))}</strong> is detected on this machine and will launch directly. You can also copy a link or save an <code class="text-fg">.m3u</code> playlist.`
            : platform === 'android' || platform === 'ios'
              ? 'Tap <strong class="text-fg">Play in VLC</strong> to hand the stream straight to the VLC app on your device.'
              : 'Pick a quality to launch VLC via <code class="text-fg">.m3u</code> playlist, protocol link, or copy the stream URL into <strong class="text-fg">VLC → Media → Open Network Stream</strong>.'
        }
      </p>
      <div class="space-y-2">
        ${currentEntry.releases
          .map((rel, idx) => {
            const hints = parseReleaseHints(rel.filename, rel.codec);
            const size = prettySize(rel.size_bytes);
            return `
              <div class="rounded-[12px] bg-fill/75 px-3.5 py-3 transition-colors hover:bg-fill">
                <div class="flex flex-wrap items-center justify-between gap-2.5">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="rounded-md bg-primary px-2 py-0.5 text-[12px] font-bold text-on-primary">${escapeHtml(rel.quality || 'Auto')}</span>
                      ${size ? `<span class="text-[12.5px] font-medium tabular-nums text-fg">${escapeHtml(size)}</span>` : ''}
                      ${hints.chips.map((c) => `<span class="rounded bg-fill-2 px-1.5 py-0.5 text-[10.5px] font-semibold text-fg-2">${escapeHtml(c)}</span>`).join('')}
                      <span class="text-[11.5px] text-fg-3">· ${escapeHtml(providerLabel(rel.provider || activeProvider))}</span>
                    </div>
                    <div class="mt-1 truncate text-[12px] text-fg-2" title="${escapeHtml(displayUiText(rel.filename || ''))}">
                      ${escapeHtml(displayUiText(rel.filename || 'Stream release'))}
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      data-vlc-launch="${idx}"
                      data-resume="${Math.floor(resumeSeconds)}"
                      class="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition active:scale-[0.98]"
                    >
                      ${iconHtml('play', { size: 12 })}
                      <span>${escapeHtml(support?.available ? playerButtonLabel(support) : 'Play in VLC')}</span>
                    </button>
                    <button
                      type="button"
                      data-vlc-copy="${idx}"
                      class="inline-flex h-8 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
                      title="Copy direct stream URL"
                    >
                      ${iconHtml('copy', { size: 13 })}
                      <span>Copy</span>
                    </button>
                  </div>
                </div>
                <div data-vlc-links="${idx}" hidden class="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-edge pt-2.5"></div>
              </div>`;
          })
          .join('')}
      </div>`;
  }

  sheet.body.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const srcBtn = target.closest('[data-vlc-source]');
    if (srcBtn) {
      void loadForProvider(srcBtn.dataset.vlcSource, false);
      return;
    }

    const copyBtn = target.closest('[data-vlc-copy]');
    if (copyBtn && currentEntry) {
      const idx = Number(copyBtn.dataset.vlcCopy);
      const rel = currentEntry.releases[idx];
      if (!rel) return;
      copyBtn.disabled = true;
      try {
        const playback = await api.play({
          streamSetId: currentEntry.streamSetId,
          releaseIndex: rel.serverIndex ?? idx,
          mirrorIndex: 0,
        });
        const url = absolutePlaybackUrl(playback, window.location.origin);
        if (url && (await writeClipboard(url))) {
          toast('Stream URL copied — paste into VLC Network Stream');
        } else {
          toast('Could not copy stream URL', 'error');
        }
      } catch (err) {
        toast(displayUiText(err.message || 'Failed to resolve stream link'), 'error');
      } finally {
        copyBtn.disabled = false;
      }
      return;
    }

    const launchBtn = target.closest('[data-vlc-launch]');
    if (launchBtn && currentEntry) {
      const idx = Number(launchBtn.dataset.vlcLaunch);
      const rel = currentEntry.releases[idx];
      if (!rel) return;
      launchBtn.disabled = true;
      try {
        if (support?.available) {
          const opened = await openStreamExternally({
            streamSetId: currentEntry.streamSetId,
            releaseIndex: rel.serverIndex ?? idx,
            mirrorIndex: 0,
            resumeSeconds: Number(launchBtn.dataset.resume) || 0,
          });
          const outcome = describeOpenResult(opened);
          toast(outcome.message, outcome.kind === 'error' ? 'error' : 'info');
          if (opened.opened) return;
        }

        const playback = await api.play({
          streamSetId: currentEntry.streamSetId,
          releaseIndex: rel.serverIndex ?? idx,
          mirrorIndex: 0,
        });
        const streamUrl = absolutePlaybackUrl(playback, window.location.origin);
        if (!streamUrl) throw new Error('Could not resolve stream URL');

        const streamTitle = `${itemTitle(details)}${epSuffix} (${rel.quality || 'Stream'})`;
        const links = externalPlayerLinks(streamUrl, streamTitle, platform);
        const drawer = sheet.body.querySelector(`[data-vlc-links="${idx}"]`);
        if (drawer) {
          drawer.hidden = false;
          drawer.innerHTML =
            links
              .map((l) =>
                l.kind === 'm3u'
                  ? `<button type="button" data-m3u-url="${escapeHtml(streamUrl)}" data-m3u-title="${escapeHtml(streamTitle)}" class="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-3 text-[12px] font-semibold text-on-primary">${escapeHtml(l.name)}</button>`
                  : `<a href="${escapeHtml(l.href)}" class="inline-flex h-7 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3">${escapeHtml(l.name)} ${iconHtml('externalLink', { size: 11 })}</a>`,
              )
              .join('') +
            `<input type="text" readonly value="${escapeHtml(streamUrl)}" class="field mt-1 h-8 w-full rounded-[8px] px-2.5 font-mono text-[11.5px] text-fg-2" onclick="this.select()" />`;
        }

        if (platform === 'android' || platform === 'ios') {
          window.location.href = links[0].href;
        } else {
          playInVlcViaM3u(streamUrl, streamTitle);
          await writeClipboard(streamUrl).catch(() => {});
          toast('Downloaded .m3u for VLC (and copied stream link)');
        }
      } catch (err) {
        toast(displayUiText(err.message || 'Could not prepare VLC stream'), 'error');
      } finally {
        launchBtn.disabled = false;
      }
      return;
    }

    const m3uBtn = target.closest('[data-m3u-url]');
    if (m3uBtn) {
      playInVlcViaM3u(m3uBtn.dataset.m3uUrl, m3uBtn.dataset.m3uTitle);
    }
  });

  await loadForProvider(provider, true);
}

/* ═══════════════════════════════════════════════════════════════
 * 3. Sidify-V2 `QualityPickerSheet` ("Download · Choose a quality")
 * ═══════════════════════════════════════════════════════════════ */

export async function openQualityPickerSheet({
  provider = state.provider,
  id,
  season = 0,
  episode = 0,
  item = null,
  details: passedDetails = null,
} = {}) {
  if (!id) return;
  const baseTitle = itemTitle(passedDetails || item);
  const seriesGuess =
    isSeriesItem(passedDetails || item) || Number(season) > 0 || Number(episode) > 0;
  const epSuffix = seriesGuess && season > 0 ? ` · S${season} E${episode || 1}` : '';

  const sheet = mountSheetShell({
    title: `Download · ${baseTitle}${epSuffix}`,
    subtitle: 'Choose a quality to save or copy link',
    maxWidthClass: 'sm:max-w-[600px]',
    bodyHtml: `
      <div class="space-y-3" data-dl-content>
        <div class="flex items-center justify-center gap-2 py-10 text-[13.5px] text-fg-2">
          ${iconHtml('loader2', { size: 18, className: 'animate-spin' })}
          <span>Loading download qualities…</span>
        </div>
      </div>`,
  });
  if (!sheet) return;

  let cancelled = false;
  sheet.addCleanup(() => {
    cancelled = true;
  });

  const details = passedDetails || (await ensureDetailsLoaded(provider, id, item));
  if (cancelled) return;
  const isSeries = isSeriesItem(details) || seriesGuess;
  const sNum = isSeries ? Math.max(1, Number(season) || 1) : 0;
  const eNum = isSeries ? Math.max(1, Number(episode) || 1) : 0;

  let currentEntry = null;
  let activeProvider = provider;

  function renderSourceRow() {
    return `
      <div class="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1">
        ${SERVER_ROTATION.map((srv) => {
          const on = srv === activeProvider;
          return `<button type="button" data-dl-source="${escapeHtml(srv)}" class="h-7 shrink-0 rounded-full px-3 text-[12px] font-semibold transition-colors ${
            on ? 'bg-primary text-on-primary' : 'bg-fill text-fg-2 hover:bg-fill-2 hover:text-fg'
          }">${escapeHtml(providerLabel(srv))}</button>`;
        }).join('')}
      </div>`;
  }

  async function loadQualities(targetProvider, allowFallback = true) {
    const container = sheet.body.querySelector('[data-dl-content]');
    if (!container) return;
    container.innerHTML = `
      <div class="flex items-center justify-center gap-2 py-10 text-[13.5px] text-fg-2">
        ${iconHtml('loader2', { size: 18, className: 'animate-spin' })}
        <span>Checking ${escapeHtml(providerLabel(targetProvider))}…</span>
      </div>`;
    try {
      if (allowFallback) {
        currentEntry = await resolveStreamEntriesWithFallback({
          provider: targetProvider,
          id,
          title: itemTitle(details),
          year: itemYear(details),
          isSeries,
          season: sNum,
          episode: eNum,
        });
      } else {
        let subjectId = id;
        if (targetProvider !== provider) {
          const q = prepareSearchQuery(itemTitle(details), itemYear(details));
          const found = await api.search({ q, provider: targetProvider, page: 1 });
          const match = pickBestMatch(found, itemTitle(details), itemYear(details), isSeries);
          if (!match) throw new Error(`No releases on ${providerLabel(targetProvider)}.`);
          subjectId = itemId(match);
        }
        const res = await api.streams({
          provider: targetProvider,
          id: subjectId,
          season: sNum,
          episode: eNum,
          isSeries,
          expectedTitle: itemTitle(details),
          expectedYear: itemYear(details),
        });
        currentEntry = buildStreamEntry(targetProvider, details, res);
      }
      activeProvider = currentEntry.provider;
      if (!cancelled) renderQualityList();
    } catch (err) {
      if (cancelled) return;
      activeProvider = targetProvider;
      container.innerHTML =
        renderSourceRow() +
        `
        <div class="rounded-[12px] bg-fill px-4 py-6 text-center text-[13.5px] text-fg-2">
          ${escapeHtml(displayUiText(err.message || 'No downloads found for this source.'))}
        </div>`;
    }
  }

  function renderQualityList() {
    const container = sheet.body.querySelector('[data-dl-content]');
    if (!container || !currentEntry) return;
    container.innerHTML = `
      ${renderSourceRow()}
      <div class="space-y-2">
        ${currentEntry.releases
          .map((rel, idx) => {
            const hints = parseReleaseHints(rel.filename, rel.codec);
            const size = prettySize(rel.size_bytes);
            return `
              <button
                type="button"
                data-dl-pick="${idx}"
                class="flex w-full items-center justify-between gap-3 rounded-[12px] bg-fill/75 px-3.5 py-3 text-left transition-colors hover:bg-fill-2"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="rounded-md bg-primary px-2 py-0.5 text-[12px] font-bold text-on-primary">${escapeHtml(rel.quality || 'Auto')}</span>
                    ${size ? `<span class="text-[13px] font-semibold tabular-nums text-fg">${escapeHtml(size)}</span>` : ''}
                    ${hints.chips.map((c) => `<span class="rounded bg-fill-2 px-1.5 py-0.5 text-[10.5px] font-semibold text-fg-2">${escapeHtml(c)}</span>`).join('')}
                  </div>
                  <div class="mt-1 truncate text-[12px] text-fg-2">${escapeHtml(displayUiText(rel.filename || 'Release'))}</div>
                </div>
                <span class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-fill-2 px-3 text-[12.5px] font-semibold text-fg">
                  ${iconHtml('download', { size: 13 })}
                  <span>Select</span>
                </span>
              </button>`;
          })
          .join('')}
      </div>`;
  }

  async function renderSelectedQuality(idx) {
    const container = sheet.body.querySelector('[data-dl-content]');
    const rel = currentEntry?.releases?.[idx];
    if (!container || !rel) return;

    container.innerHTML = `
      <div class="flex items-center justify-center gap-2 py-10 text-[13.5px] text-fg-2">
        ${iconHtml('loader2', { size: 18, className: 'animate-spin' })}
        <span>Preparing ${escapeHtml(rel.quality || 'download')} link…</span>
      </div>`;

    try {
      const playback = await api.play({
        streamSetId: currentEntry.streamSetId,
        releaseIndex: rel.serverIndex ?? idx,
        mirrorIndex: 0,
      });
      if (cancelled) return;
      const url = absolutePlaybackUrl(playback, window.location.origin);
      const isSegmented = ['hls', 'dash'].includes(String(playback.stream_type || '').toLowerCase());
      const dlName = safeDownloadFilename(
        itemTitle(details),
        itemYear(details),
        rel.quality,
        rel.filename,
      );
      const hints = parseReleaseHints(rel.filename, rel.codec);

      container.innerHTML = `
        <button type="button" data-dl-back class="inline-flex items-center gap-1.5 text-[13px] font-semibold text-playing hover:opacity-80">
          ${iconHtml('arrowLeft', { size: 14 })}
          <span>All qualities</span>
        </button>

        <div class="space-y-3 rounded-[14px] bg-fill/80 p-4">
          <div>
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="rounded-md bg-primary px-2 py-0.5 text-[12px] font-bold text-on-primary">${escapeHtml(rel.quality || 'Auto')}</span>
              ${rel.size_bytes ? `<span class="text-[13px] font-semibold text-fg">${escapeHtml(prettySize(rel.size_bytes))}</span>` : ''}
              ${hints.chips.map((c) => `<span class="rounded bg-fill-2 px-1.5 py-0.5 text-[10.5px] font-semibold text-fg-2">${escapeHtml(c)}</span>`).join('')}
              <span class="text-[12px] text-fg-2">· ${escapeHtml(providerLabel(activeProvider))}</span>
            </div>
            <p class="mt-1.5 break-all text-[12.5px] text-fg-2">${escapeHtml(displayUiText(rel.filename || dlName))}</p>
          </div>

          ${
            isSegmented
              ? `<p class="rounded-[10px] bg-fill-2 px-3 py-2 text-[12.5px] text-fg-2">
                   This source uses a segmented <strong class="text-fg">${escapeHtml(String(playback.stream_type).toUpperCase())}</strong> manifest rather than a single file. Open in <strong class="text-fg">VLC</strong> or copy the stream URL for <code class="text-fg">yt-dlp</code> / <code class="text-fg">ffmpeg</code>.
                 </p>`
              : `<div class="flex flex-wrap items-center gap-2">
                   <a
                     href="${escapeHtml(url)}"
                     download="${escapeHtml(dlName)}"
                     target="_blank"
                     rel="noopener noreferrer"
                     class="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-semibold text-on-primary transition active:scale-[0.98]"
                   >
                     ${iconHtml('download', { size: 15 })}
                     <span>Download file</span>
                   </a>
                 </div>`
          }

          <div class="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" data-dl-copy="${escapeHtml(url)}" class="inline-flex h-9 items-center gap-1.5 rounded-full bg-fill-2 px-4 text-[13px] font-semibold text-fg hover:bg-fill-3">
              ${iconHtml('copy', { size: 13 })}
              <span>Copy link</span>
            </button>
            <button type="button" data-dl-open-vlc class="inline-flex h-9 items-center gap-1.5 rounded-full bg-fill-2 px-4 text-[13px] font-semibold text-fg hover:bg-fill-3">
              ${iconHtml('monitorPlay', { size: 13 })}
              <span>Play with VLC</span>
            </button>
          </div>

          <input type="text" readonly value="${escapeHtml(url)}" class="field h-8 w-full rounded-[8px] px-2.5 font-mono text-[11.5px] text-fg-2" onclick="this.select()" />
        </div>`;
    } catch (err) {
      if (cancelled) return;
      container.innerHTML = `
        <button type="button" data-dl-back class="inline-flex items-center gap-1.5 text-[13px] font-semibold text-playing">
          ${iconHtml('arrowLeft', { size: 14 })}
          <span>All qualities</span>
        </button>
        <div class="rounded-[12px] bg-fill p-4 text-[13px] text-danger">${escapeHtml(displayUiText(err.message || 'Could not resolve download link.'))}</div>`;
    }
  }

  sheet.body.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const srcBtn = target.closest('[data-dl-source]');
    if (srcBtn) {
      void loadQualities(srcBtn.dataset.dlSource, false);
      return;
    }

    const pickBtn = target.closest('[data-dl-pick]');
    if (pickBtn) {
      void renderSelectedQuality(Number(pickBtn.dataset.dlPick));
      return;
    }

    if (target.closest('[data-dl-back]')) {
      renderQualityList();
      return;
    }

    const copyBtn = target.closest('[data-dl-copy]');
    if (copyBtn) {
      const ok = await writeClipboard(copyBtn.dataset.dlCopy);
      toast(ok ? 'Download URL copied to clipboard' : 'Select URL field to copy');
      return;
    }

    if (target.closest('[data-dl-open-vlc]')) {
      void openVlcPickerSheet({
        provider: activeProvider,
        id,
        season: sNum,
        episode: eNum,
        item: details,
        details,
      });
    }
  });

  await loadQualities(provider, true);
}

/* ═══════════════════════════════════════════════════════════════
 * 4. Sidify-V2 Engine, Theme & Access Key Settings Sheet
 * ═══════════════════════════════════════════════════════════════ */

export function openEngineSheet({ focusKey = false } = {}) {
  const engineState = api.state.engine;
  const statusLabel =
    engineState === 'connected'
      ? 'Connected to live backend'
      : engineState === 'demo'
        ? 'Demo catalog mode'
        : 'Backend offline / locked';
  const dotColor =
    engineState === 'connected'
      ? 'bg-emerald-400'
      : engineState === 'demo'
        ? 'bg-amber-400'
        : 'bg-red-400';

  const sheet = mountSheetShell({
    title: 'Settings & Backend',
    subtitle: statusLabel,
    maxWidthClass: 'sm:max-w-[500px]',
    bodyHtml: `
      <div class="space-y-5">
        <div>
          <div class="t-eyebrow mb-2 px-1 text-fg-2">Appearance</div>
          <div class="grid grid-cols-3 gap-1 rounded-[12px] bg-fill p-1">
            ${[
              { id: 'dark', label: 'Dark' },
              { id: 'light', label: 'Light' },
              { id: 'system', label: 'Auto' },
            ]
              .map(
                (t) => `<button type="button" data-set-theme="${t.id}" class="h-8 rounded-[9px] text-[13px] font-semibold transition-colors ${
                  state.theme === t.id ? 'bg-primary text-on-primary shadow' : 'text-fg-2 hover:text-fg'
                }">${t.label}</button>`,
              )
              .join('')}
          </div>
        </div>

        <div>
          <div class="t-eyebrow mb-2 px-1 text-fg-2">Default Catalog Source</div>
          <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            ${state.providers
              .map(
                (p) => `<button type="button" data-set-provider="${escapeHtml(p.id)}" class="flex h-9 items-center justify-between rounded-[10px] px-3 text-[13px] font-medium transition-colors ${
                  state.provider === p.id ? 'bg-primary text-on-primary font-semibold' : 'bg-fill text-fg hover:bg-fill-2'
                }">
                  <span>${escapeHtml(providerLabel(p.id))}</span>
                  ${state.provider === p.id ? iconHtml('check', { size: 14 }) : ''}
                </button>`,
              )
              .join('')}
          </div>
        </div>

        <div>
          <div class="t-eyebrow mb-2 px-1 text-fg-2">Backend Engine</div>
          <div class="space-y-2.5 rounded-[14px] bg-fill/80 p-3.5 text-[13px]">
            <div class="flex items-center justify-between">
              <span class="inline-flex items-center gap-2 font-semibold text-fg">
                <span class="h-2.5 w-2.5 rounded-full ${dotColor}"></span>
                <span>${escapeHtml(statusLabel)}</span>
              </span>
              <button type="button" data-recheck-health class="text-[12.5px] font-semibold text-playing hover:opacity-80">Refresh</button>
            </div>
            <p class="text-[12px] leading-relaxed text-fg-2">
              Start the headless Rust API server locally to unlock live streaming, proxy manifests, online subtitles, and server-synced watchlist:
            </p>
            <code class="block rounded-[8px] bg-surface px-3 py-2 font-mono text-[11.5px] text-fg select-all">cargo run -- --web-api 127.0.0.1:8787</code>
          </div>
        </div>

        <div>
          <div class="t-eyebrow mb-2 px-1 text-fg-2">Access Key (MOVIEBOX_WEB_API_TOKEN)</div>
          <form data-key-form class="flex gap-2">
            <input
              type="password"
              name="accessKey"
              value="${escapeHtml(api.getAccessKey() || '')}"
              placeholder="Paste access key (leave blank if none)"
              autocomplete="off"
              class="field h-10 flex-1 rounded-[10px] px-3.5 text-[13.5px]"
            />
            <button type="submit" class="h-10 rounded-full bg-primary px-4 text-[13.5px] font-semibold text-on-primary">Save</button>
          </form>
        </div>
      </div>`,
  });

  if (!sheet) return;
  if (focusKey) {
    setTimeout(() => sheet.body.querySelector('input[name="accessKey"]')?.focus(), 50);
  }

  sheet.body.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const themeBtn = target.closest('[data-set-theme]');
    if (themeBtn) {
      applyTheme(themeBtn.dataset.setTheme);
      openEngineSheet();
      return;
    }

    const provBtn = target.closest('[data-set-provider]');
    if (provBtn) {
      setProvider(provBtn.dataset.setProvider);
      toast(`Default source set to ${providerLabel(provBtn.dataset.setProvider)}`);
      openEngineSheet();
      return;
    }

    if (target.closest('[data-recheck-health]')) {
      try {
        await api.checkEngine();
        await library.refresh();
        toast('Backend status refreshed');
        openEngineSheet();
      } catch (err) {
        toast(displayUiText(err.message || 'Backend unreachable'), 'error');
      }
    }
  });

  sheet.body.querySelector('[data-key-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector('input[name="accessKey"]');
    api.setAccessKey(input?.value || '');
    await api.checkEngine();
    await library.refresh();
    toast(api.getAccessKey() ? 'Access key saved & verified' : 'Access key cleared');
    sheet.close();
    window.dispatchEvent(new CustomEvent('ifallhub:refresh-view'));
  });
}
