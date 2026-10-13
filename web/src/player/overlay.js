const LAYOUT_STORAGE_KEY = 'ifallhub_player_controls_v1';
const ICONS = {
  back: '<path d="m15 18-6-6 6-6"/><path d="M20 12H9"/>',
  subtitles: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h3M14 10h3M14 14h3"/>',
  audio: '<path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  decoder: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  chapters: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  enhance: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
  rotate: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 1M4 17l2 1a7 7 0 0 0 12.5-3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>',
  pip: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1"/>',
  aspect: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M4 4l6 6M20 4l-6 6M20 20l-6-6M4 20l6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  background: '<path d="M4 12v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="11" width="4" height="7" rx="2"/><rect x="17" y="11" width="4" height="7" rx="2"/>',
  screenshot: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  'fullscreen-exit': '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>',
  play: '<path d="m8 5 12 7-12 7V5Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5h3v14H8zM15 5h3v14h-3z" fill="currentColor" stroke="none"/>',
  previous: '<path d="M6 5v14M19 6 9 12l10 6V6Z"/>',
  next: '<path d="M18 5v14M5 6l10 6-10 6V6Z"/>',
  rewind: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5"/>',
  forward: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  battery: '<rect x="3" y="7" width="17" height="10" rx="2"/><path d="M22 10v4"/>',
  volume: '<path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
  mute: '<path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="m17 9 5 6m0-6-5 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  brightness: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  chevrons: '<path d="m7 6 6 6-6 6M14 6l6 6-6 6"/>',
};

export const PLAYER_CONTROL_IDS = [
  'back', 'title', 'subtitles', 'audio', 'decoder', 'chapters', 'enhance',
  'rotate', 'lock', 'pip', 'aspect', 'more-options', 'background-play',
  'quality', 'screenshot',
];

export const PLAYER_REGIONS = [
  'landscape.top-left', 'landscape.top-right', 'landscape.bottom-left', 'landscape.bottom-right',
  'portrait.top-left', 'portrait.top-right', 'portrait.bottom',
];

export const DEFAULT_PLAYER_LAYOUT = {
  'landscape.top-left': ['back', 'title'],
  'landscape.top-right': ['subtitles', 'audio', 'quality', 'more-options'],
  'landscape.bottom-left': ['decoder', 'enhance', 'background-play'],
  'landscape.bottom-right': ['aspect', 'rotate', 'lock', 'pip', 'screenshot'],
  'portrait.top-left': ['back', 'title'],
  'portrait.top-right': ['subtitles', 'audio', 'more-options'],
  'portrait.bottom': ['decoder', 'quality', 'enhance', 'rotate', 'lock', 'pip', 'aspect', 'background-play', 'screenshot'],
};

const CONTROL_LABELS = {
  back: 'Back to title', title: 'Video title', subtitles: 'Subtitles', audio: 'Audio tracks',
  decoder: 'Decoder information', chapters: 'Chapters', enhance: 'Enhance', rotate: 'Rotate video',
  lock: 'Lock controls', pip: 'Picture in picture', aspect: 'Aspect ratio',
  'more-options': 'More player options', 'background-play': 'Background playback',
  quality: 'Playback quality', screenshot: 'Take screenshot',
};

const REGION_TITLES = {
  'landscape.top-left': 'Landscape top left', 'landscape.top-right': 'Landscape top right',
  'landscape.bottom-left': 'Landscape bottom left', 'landscape.bottom-right': 'Landscape bottom right',
  'portrait.top-left': 'Portrait top left', 'portrait.top-right': 'Portrait top right',
  'portrait.bottom': 'Portrait bottom row',
};

/**
 * True when the player should show the compact bar — play/pause and fullscreen
 * only — instead of every control chip. Phones always qualify, and small touch
 * screens (a tablet in a phone-sized window) do too.
 */
export function usesCompactBar(width, coarsePointer = false) {
  const size = Number(width) || 0;
  if (size > 0 && size <= 820) return true;
  return Boolean(coarsePointer) && size <= 1024;
}

export function formatPlayerTime(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(remainder)}` : `${minutes}:${pad(remainder)}`;
}

function createIcon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  svg.innerHTML = ICONS[name] || ICONS.more;
  return svg;
}

function copyLayout(layout) {
  return Object.fromEntries(PLAYER_REGIONS.map((region) => [region, [...layout[region]]]));
}

function loadLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return copyLayout(DEFAULT_PLAYER_LAYOUT);
    const layout = {};
    const assigned = { landscape: new Set(), portrait: new Set() };
    for (const region of PLAYER_REGIONS) {
      const orientation = region.split('.')[0];
      const candidates = Array.isArray(parsed[region]) ? parsed[region] : DEFAULT_PLAYER_LAYOUT[region];
      layout[region] = [];
      for (const id of candidates) {
        if (!PLAYER_CONTROL_IDS.includes(id) || assigned[orientation].has(id)) continue;
        assigned[orientation].add(id);
        layout[region].push(id);
      }
    }
    return layout;
  } catch {
    return copyLayout(DEFAULT_PLAYER_LAYOUT);
  }
}

function saveLayout(layout) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getMediaChapters(video, supplied = []) {
  if (Array.isArray(supplied) && supplied.length) return supplied;
  const chapterTrack = Array.from(video.textTracks || []).find((track) => track.kind === 'chapters');
  if (!chapterTrack?.cues) return [];
  return Array.from(chapterTrack.cues).map((cue, index) => ({
    title: cue.text || `Chapter ${index + 1}`,
    start: cue.startTime,
  }));
}

function getAudioTracks(player, video) {
  if (player && typeof player.getAudioTracks === 'function') {
    try { return player.getAudioTracks() || []; } catch { return []; }
  }
  try { return video.audioTracks ? Array.from(video.audioTracks) : []; } catch { return []; }
}

function buildPopoverMarkup() {
  return `
    <section class="player-popover-panel" data-panel="subtitles" hidden aria-label="Subtitle options">
      <div class="player-popover-heading"><strong>Subtitles</strong><button class="player-close-button" type="button" data-action="close-popover" aria-label="Close subtitle options"></button></div>
      <button class="player-menu-button" type="button" data-find-subtitles aria-label="Search online subtitles">Find subtitles online</button>
      <label class="player-menu-field" for="subtitle-language"><span>Language</span><select id="subtitle-language" disabled aria-label="Subtitle language"><option value="">Subtitles off</option></select></label>
      <label class="player-menu-toggle"><input type="checkbox" data-auto-subtitles aria-label="Load subtitles automatically" /><span>Load subtitles automatically</span></label>
      <p class="player-menu-status" id="subtitle-status" role="status" aria-live="polite">Search online captions by title.</p>
    </section>
    <section class="player-popover-panel" data-panel="audio" hidden aria-label="Audio track options">
      <div class="player-popover-heading"><strong>Audio</strong><button class="player-close-button" type="button" data-action="close-popover" aria-label="Close audio options"></button></div>
      <button class="player-menu-button" type="button" data-action="mute"></button>
      <div class="player-menu-options" data-audio-options></div>
      <label class="player-menu-field" for="player-volume"><span>Volume</span><input id="player-volume" type="range" min="0" max="1" step="0.01" aria-label="Playback volume" /></label>
    </section>
    <section class="player-popover-panel" data-panel="quality" hidden aria-label="Playback quality options">
      <div class="player-popover-heading"><strong>Quality</strong><button class="player-close-button" type="button" data-action="close-popover" aria-label="Close quality options"></button></div>
      <div class="player-menu-options" data-quality-options></div>
    </section>
    <section class="player-popover-panel" data-panel="decoder" hidden aria-label="Decoder information">
      <div class="player-popover-heading"><strong>Decoder</strong><button class="player-close-button" type="button" data-action="close-popover" aria-label="Close decoder information"></button></div>
      <p class="player-menu-status" data-decoder-description>Browser playback</p>
    </section>
    <section class="player-popover-panel" data-panel="chapters" hidden aria-label="Chapter options">
      <div class="player-popover-heading"><strong>Chapters</strong><button class="player-close-button" type="button" data-action="close-popover" aria-label="Close chapter options"></button></div>
      <div class="player-menu-options" data-chapter-options></div>
    </section>
    <section class="player-popover-panel" data-panel="more-options" hidden aria-label="More player options">
      <div class="player-popover-heading"><strong>Player options</strong><button class="player-close-button" type="button" data-action="close-popover" aria-label="Close player options"></button></div>
      <button class="player-menu-button" type="button" data-action="toggle-bottom-layout" aria-pressed="false">Bottom layout: off</button>
      <button class="player-menu-button" type="button" data-action="toggle-remaining-time" aria-pressed="false">Time display: elapsed</button>
      <button class="player-menu-button" type="button" data-action="toggle-hidden-pill" aria-pressed="true">Hidden status pill: on</button>
      <button class="player-menu-button" type="button" data-action="toggle-visible-status" aria-pressed="false">Clock/battery pill: off</button>
      <label class="player-menu-field" for="player-seek-step"><span>Seek interval</span><select id="player-seek-step" aria-label="Seek interval"><option value="5">5 seconds</option><option value="10" selected>10 seconds</option><option value="30">30 seconds</option></select></label>
      <button class="player-menu-button" type="button" data-action="fullscreen">Enter fullscreen</button>
      <button class="player-menu-button" type="button" data-action="customize-controls">Customize control layout</button>
    </section>
    <section class="player-popover-panel player-layout-panel" data-panel="layout" hidden aria-label="Customize player controls">
      <div class="player-popover-heading"><strong>Control layout</strong><button class="player-close-button" type="button" data-action="close-popover" aria-label="Close control layout"></button></div>
      <button class="player-menu-button" type="button" data-action="reset-layout">Reset to defaults</button>
      <div class="player-layout-editor" data-layout-editor></div>
    </section>`;
}

function buildOverlayMarkup() {
  return `
    <div class="player-scrim" aria-hidden="true"></div>
    <div class="player-control-layer">
      <div class="player-top-row">
        <div class="player-region" data-region="landscape.top-left" role="group" aria-label="Landscape top left controls"></div>
        <div class="player-region" data-region="landscape.top-right" role="group" aria-label="Landscape top right controls"></div>
        <div class="player-region" data-region="portrait.top-left" role="group" aria-label="Portrait top left controls"></div>
        <div class="player-region" data-region="portrait.top-right" role="group" aria-label="Portrait top right controls"></div>
        <div class="player-visible-status" data-visible-status hidden aria-label="Current time and battery"></div>
      </div>
      <div class="player-center-transport" data-transport-location="center"></div>
      <div class="player-bottom-column">
        <div class="player-time-label" data-time-label aria-live="off">00:00 / 00:00</div>
        <div class="player-seek-wrap">
          <div class="player-seek-hit-area" data-seek-area role="slider" tabindex="0" aria-label="Seek video" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="00:00">
            <div class="player-seek-track" data-seek-track>
              <span class="player-track-base"></span><span class="player-track-buffer"></span><span class="player-track-played"></span><span class="player-track-thumb"></span>
              <svg class="player-wave-svg" data-wave-svg aria-hidden="true" preserveAspectRatio="none">
                <defs><clipPath id="wave-buffer-clip"><rect data-wave-buffer-rect x="0" y="0" height="16" width="0"></rect></clipPath><clipPath id="wave-played-clip"><rect data-wave-played-rect x="0" y="0" height="16" width="0"></rect></clipPath></defs>
                <path class="player-wave-base" data-wave-base></path><path class="player-wave-buffer" data-wave-buffer clip-path="url(#wave-buffer-clip)"></path><path class="player-wave-played" data-wave-played clip-path="url(#wave-played-clip)"></path>
              </svg>
            </div>
          </div>
        </div>
        <div class="player-bottom-row">
          <div class="player-region" data-region="landscape.bottom-left" role="group" aria-label="Landscape bottom left controls"></div>
          <div class="player-region player-region-portrait" data-region="portrait.bottom" role="group" aria-label="Portrait bottom controls"></div>
          <div class="player-bottom-transport" data-transport-location="bottom"></div>
          <div class="player-region" data-region="landscape.bottom-right" role="group" aria-label="Landscape bottom right controls"></div>
        </div>
      </div>
      <div class="player-popover" data-player-popover hidden role="dialog" aria-label="Player options">${buildPopoverMarkup()}</div>
    </div>
    <div class="player-hidden-pill" data-hidden-pill hidden aria-label="Playback status"><span class="player-pill-segment"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.hourglass}</svg><span data-hidden-remaining>--:--</span></span><span class="player-pill-divider"></span><span class="player-pill-segment"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.clock}</svg><span data-player-clock></span></span><span class="player-pill-divider" data-hidden-battery-divider hidden></span><span class="player-pill-segment" data-hidden-battery hidden><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.battery}</svg><span data-battery-label></span></span></div>
    <button class="player-lock-pill" data-unlock-button type="button" hidden aria-label="Unlock player controls"></button>
    <div class="player-gesture-card" data-gesture-card hidden aria-live="polite"><svg class="player-gesture-ring" viewBox="0 0 72 72" aria-hidden="true"><circle class="player-gesture-ring-track" cx="36" cy="36" r="31"></circle><circle class="player-gesture-ring-sweep" cx="36" cy="36" r="31"></circle></svg><div class="player-gesture-copy"><div class="player-gesture-heading"><span class="player-gesture-direction" data-gesture-direction></span><span class="player-gesture-time" data-gesture-time></span></div><div class="player-gesture-progress"><span data-gesture-progress></span></div></div></div>
    <div class="player-boost-hud" data-boost-hud hidden aria-label="2 times playback speed"><span class="player-boost-chevrons" aria-hidden="true"></span><strong>2.0x</strong><small>Speed</small></div>
    <div class="player-adjustment player-adjustment-left" data-adjustment hidden role="meter" aria-label="Volume adjustment"><span class="player-adjustment-icon">${`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.volume}</svg>`}</span><span class="player-adjustment-track"><span data-adjustment-fill></span></span><span class="player-adjustment-value" data-adjustment-value></span></div>
    <div class="player-adjustment player-adjustment-right" data-brightness-adjustment hidden role="meter" aria-label="Brightness adjustment"><span class="player-adjustment-icon">${`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.brightness}</svg>`}</span><span class="player-adjustment-track"><span data-brightness-fill></span></span><span class="player-adjustment-value" data-brightness-value></span></div>`;
}

export function mountPlayerOverlay({
  frame,
  video,
  getPlayer = () => null,
  seekbarVariant = 'standard',
  transportSize = 'medium',
  showHiddenPill: hiddenPillEnabled = true,
  showVisibleStatus: visibleStatusEnabled = false,
  getTitle = () => '',
  getQuality = () => 'AUTO',
  getDecoder = () => 'AUTO',
  getSource = () => '',
  getReleases = () => [],
  getSelectedRelease = () => 0,
  getSubtitleOptions = () => [],
  getSelectedSubtitle = () => null,
  getAutoSubtitles = () => true,
  getChapters = () => [],
  getCanPrevious = () => false,
  getCanNext = () => false,
  onBack = () => {},
  onPrevious = () => {},
  onNext = () => {},
  onSearchSubtitles = () => {},
  onSelectSubtitle = () => {},
  onToggleAutoSubtitles = () => {},
  onSelectRelease = () => {},
  onStatus = () => {},
} = {}) {
  if (!frame || !video) throw new Error('Player overlay requires its video frame and video element.');
  const root = document.createElement('section');
  root.className = 'player-overlay';
  root.setAttribute('aria-label', 'Video player controls');
  root.dataset.visible = 'true';
  root.dataset.seekVariant = ['standard', 'thick', 'slim', 'wavy'].includes(seekbarVariant) ? seekbarVariant : 'standard';
  root.dataset.transportSize = ['small', 'medium', 'large'].includes(transportSize) ? transportSize : 'medium';
  root.innerHTML = buildOverlayMarkup();
  frame.append(root);

  const refs = {
    controlLayer: root.querySelector('.player-control-layer'),
    popover: root.querySelector('[data-player-popover]'),
    seekArea: root.querySelector('[data-seek-area]'),
    seekTrack: root.querySelector('[data-seek-track]'),
    timeLabel: root.querySelector('[data-time-label]'),
    hiddenPill: root.querySelector('[data-hidden-pill]'),
    hiddenRemaining: root.querySelector('[data-hidden-remaining]'),
    playerClock: root.querySelector('[data-player-clock]'),
    hiddenBattery: root.querySelector('[data-hidden-battery]'),
    hiddenBatteryDivider: root.querySelector('[data-hidden-battery-divider]'),
    batteryLabel: root.querySelector('[data-battery-label]'),
    visibleStatus: root.querySelector('[data-visible-status]'),
    lockButton: root.querySelector('[data-unlock-button]'),
    gestureCard: root.querySelector('[data-gesture-card]'),
    gestureDirection: root.querySelector('[data-gesture-direction]'),
    gestureTime: root.querySelector('[data-gesture-time]'),
    gestureProgress: root.querySelector('[data-gesture-progress]'),
    boostHud: root.querySelector('[data-boost-hud]'),
    adjustment: root.querySelector('[data-adjustment]'),
    brightnessAdjustment: root.querySelector('[data-brightness-adjustment]'),
    waveSvg: root.querySelector('[data-wave-svg]'),
    waveBase: root.querySelector('[data-wave-base]'),
    waveBuffer: root.querySelector('[data-wave-buffer]'),
    wavePlayed: root.querySelector('[data-wave-played]'),
    waveBufferRect: root.querySelector('[data-wave-buffer-rect]'),
    wavePlayedRect: root.querySelector('[data-wave-played-rect]'),
    audioOptions: root.querySelector('[data-audio-options]'),
    qualityOptions: root.querySelector('[data-quality-options]'),
    chapterOptions: root.querySelector('[data-chapter-options]'),
    layoutEditor: root.querySelector('[data-layout-editor]'),
    decoderDescription: root.querySelector('[data-decoder-description]'),
  };

  const state = {
    layout: loadLayout(), orientation: 'landscape', visible: true, locked: false,
    bottomLayout: false, remainingTime: false, expandedRegions: new Set(), popover: '',
    enhanced: false, backgroundPlay: false, rotated: false, aspect: 'contain',
    seekSeconds: 10, scrub: null, ignoreTimeUntil: 0, committedPosition: null,
    hideTimer: 0, tapTimer: 0, lastTapX: 0, suppressClickUntil: 0, pointer: null,
    boostTimer: 0, gestureTimer: 0, adjustmentTimer: 0, seekedTimeout: 0,
    waveFrame: 0, waveTime: 0, wavePhase: 0, brightness: 1, battery: null,
    compact: false, pseudoFullscreen: false,
    batteryLevel: null, lastClockTick: 0, clockText: '', subtitleSearchRunning: false,
    destroyed: false,
  };
  let showHiddenPill = hiddenPillEnabled;
  let showVisibleStatus = visibleStatusEnabled;

  function createTransportButton(iconName, label, action) {
    const button = document.createElement('button');
    button.className = `player-transport-button player-transport-${action}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(createIcon(iconName));
    return button;
  }

  function createTransport() {
    const row = document.createElement('div');
    row.className = 'player-transport-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Playback controls');
    row.append(
      createTransportButton('previous', 'Previous episode', 'previous'),
      makeSkipButton('rewind', 'Rewind'),
      createTransportButton('play', 'Play video', 'toggle-play'),
      makeSkipButton('forward', 'Forward'),
      createTransportButton('next', 'Next episode', 'next'),
      // Always in the bar: on phones the compact bar keeps only play/pause
      // (left) and this button (right).
      createTransportButton('fullscreen', 'Enter fullscreen', 'fullscreen'),
    );
    return row;
  }

  function makeSkipButton(direction, label) {
    const button = createTransportButton(direction, `${label} ${state.seekSeconds} seconds`, direction);
    button.classList.add('player-skip-button');
    const count = document.createElement('span');
    count.className = 'player-skip-seconds';
    count.dataset.skipSeconds = direction;
    count.textContent = String(state.seekSeconds);
    button.append(count);
    return button;
  }

  root.querySelector('[data-transport-location="center"]').append(createTransport());
  root.querySelector('[data-transport-location="bottom"]').append(createTransport());

  function currentDuration() {
    return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  }

  function effectivePosition() {
    if (state.scrub) return state.scrub.position;
    if (Date.now() < state.ignoreTimeUntil && Number.isFinite(state.committedPosition)) return state.committedPosition;
    return Number(video.currentTime) || 0;
  }

  function displayTime() {
    const duration = currentDuration();
    const position = effectivePosition();
    const end = duration
      ? `${state.remainingTime ? '-' : ''}${formatPlayerTime(state.remainingTime ? Math.max(0, duration - position) : duration)}`
      : '--:--';
    return `${formatPlayerTime(position)} / ${end}`;
  }

  function getBufferEnd(position) {
    let end = 0;
    try {
      for (let index = 0; index < video.buffered.length; index += 1) {
        const start = video.buffered.start(index);
        const currentEnd = video.buffered.end(index);
        if (currentEnd > position && currentEnd >= start) end = Math.max(end, currentEnd);
      }
    } catch { return 0; }
    return end;
  }

  function updateTrack() {
    const duration = currentDuration();
    const position = clamp(effectivePosition(), 0, duration || Number.MAX_SAFE_INTEGER);
    const progress = duration ? clamp(position / duration, 0, 1) : 0;
    const bufferEnd = getBufferEnd(position);
    const buffer = duration && bufferEnd > position ? clamp(bufferEnd / duration, 0, 1) : 0;
    refs.timeLabel.textContent = displayTime();
    refs.seekArea.setAttribute('aria-valuemax', String(Math.floor(duration)));
    refs.seekArea.setAttribute('aria-valuenow', String(Math.floor(position)));
    refs.seekArea.setAttribute('aria-valuetext', `${formatPlayerTime(position)} of ${duration ? formatPlayerTime(duration) : 'unknown duration'}`);
    refs.seekArea.dataset.scrubbing = String(Boolean(state.scrub));
    refs.seekTrack.querySelector('.player-track-played').style.width = `${progress * 100}%`;
    refs.seekTrack.querySelector('.player-track-buffer').style.width = `${buffer * 100}%`;
    refs.seekTrack.querySelector('.player-track-thumb').style.left = `${progress * 100}%`;
    refs.waveBufferRect.setAttribute('width', String(refs.seekTrack.clientWidth * buffer));
    refs.wavePlayedRect.setAttribute('width', String(refs.seekTrack.clientWidth * progress));
    root.dataset.playing = String(!video.paused);
    updateTransportState();
    updatePills(false);
    drawWave();
  }

  function makeControlButton(id) {
    if (id === 'title') {
      const title = document.createElement('div');
      title.className = 'player-title';
      title.dataset.playerTitle = '';
      title.textContent = getTitle() || '';
      title.setAttribute('aria-label', `Now playing: ${getTitle() || 'Unknown title'}`);
      return title;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `player-chip player-control-${id}`;
    button.dataset.controlId = id;
    button.dataset.action = id;
    const value = id === 'quality' ? String(getQuality() || 'AUTO').toUpperCase()
      : id === 'decoder' ? String(getDecoder() || 'AUTO').toUpperCase() : '';
    const label = id === 'quality' ? `Playback quality ${value}`
      : id === 'decoder' ? `Decoder ${value}` : CONTROL_LABELS[id];
    button.setAttribute('aria-label', label);
    button.title = label;
    if (id === 'quality' || id === 'decoder') {
      button.classList.add('player-text-chip');
      button.textContent = value;
    } else {
      const iconName = id === 'more-options' ? 'more' : id === 'background-play' ? 'background' : id;
      button.append(createIcon(iconName));
    }
    if (['enhance', 'background-play', 'rotate', 'lock'].includes(id)) {
      const active = id === 'enhance' ? state.enhanced
        : id === 'background-play' ? state.backgroundPlay
          : id === 'rotate' ? state.rotated : state.locked;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    }
    if (id === 'aspect') {
      button.setAttribute('aria-pressed', String(state.aspect !== 'contain'));
      button.classList.toggle('is-active', state.aspect !== 'contain');
    }
    if (id === 'pip' && !document.pictureInPictureEnabled) {
      button.disabled = true;
      button.setAttribute('aria-label', 'Picture in picture unavailable');
    }
    return button;
  }

  function isChapterAvailable() {
    return getMediaChapters(video, getChapters()).length > 0;
  }

  function effectiveLayout() {
    const layout = copyLayout(state.layout);
    const orientationRegions = PLAYER_REGIONS.filter((region) => region.startsWith(`${state.orientation}.`));
    if (!orientationRegions.some((region) => layout[region].includes('quality')) && getReleases().length) {
      const region = state.orientation === 'portrait' ? 'portrait.bottom' : 'landscape.top-right';
      layout[region].push('quality');
    }
    return layout;
  }

  function makeRegionButton(id, region) {
    if (id === '__expand' || id === '__collapse') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'player-chip player-overflow-chip';
      button.dataset.action = 'expand-region';
      button.dataset.region = region;
      button.setAttribute('aria-label', id === '__expand' ? 'Show more controls' : 'Show fewer controls');
      button.setAttribute('aria-expanded', String(id === '__collapse'));
      button.append(createIcon('chevron'));
      return button;
    }
    return makeControlButton(id);
  }

  function renderRegions() {
    const layout = effectiveLayout();
    for (const region of PLAYER_REGIONS) {
      const container = root.querySelector(`[data-region="${region}"]`);
      let ids = layout[region].filter((id) => id !== 'chapters' || isChapterAvailable());
      const isBottomRegion = state.orientation === 'portrait'
        ? region === 'portrait.bottom'
        : region.endsWith('bottom-left') || region.endsWith('bottom-right');
      const overflowing = state.bottomLayout && isBottomRegion && ids.length > 2;
      if (overflowing) {
        if (state.expandedRegions.has(region)) ids = [...ids, '__collapse'];
        else ids = [...ids.slice(0, 2), '__expand'];
      }
      container.replaceChildren(...ids.map((id) => makeRegionButton(id, region)));
    }
    root.querySelectorAll('[data-player-title]').forEach((title) => {
      title.textContent = getTitle() || '';
      title.setAttribute('aria-label', `Now playing: ${getTitle() || 'Unknown title'}`);
    });
    root.querySelectorAll('[data-control-id="quality"]').forEach((button) => {
      const value = String(getQuality() || 'AUTO').toUpperCase();
      button.textContent = value;
      button.setAttribute('aria-label', `Playback quality ${value}`);
      button.title = `Playback quality ${value}`;
    });
    root.querySelectorAll('[data-control-id="decoder"]').forEach((button) => {
      const value = String(getDecoder() || 'AUTO').toUpperCase();
      button.textContent = value;
      button.setAttribute('aria-label', `Decoder ${value}`);
      button.title = `Decoder ${value}`;
    });
    root.querySelectorAll('.player-skip-seconds').forEach((count) => {
      count.textContent = String(state.seekSeconds);
      const button = count.closest('button');
      const label = count.dataset.skipSeconds === 'rewind' ? 'Rewind' : 'Forward';
      button.setAttribute('aria-label', `${label} ${state.seekSeconds} seconds`);
      button.title = `${label} ${state.seekSeconds} seconds`;
    });
    updateTransportState();
  }

  function renderLayoutEditor() {
    refs.layoutEditor.replaceChildren();
    for (const region of PLAYER_REGIONS) {
      const details = document.createElement('details');
      details.className = 'player-layout-region';
      const summary = document.createElement('summary');
      summary.textContent = REGION_TITLES[region];
      details.append(summary);
      const list = document.createElement('div');
      list.className = 'player-layout-options';
      for (const id of PLAYER_CONTROL_IDS) {
        const label = document.createElement('label');
        label.className = 'player-layout-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = state.layout[region].includes(id);
        input.dataset.layoutRegion = region;
        input.dataset.layoutControl = id;
        input.setAttribute('aria-label', `${CONTROL_LABELS[id]} in ${REGION_TITLES[region]}`);
        const name = document.createElement('span');
        name.textContent = CONTROL_LABELS[id];
        label.append(input, name);
        list.append(label);
      }
      details.append(list);
      refs.layoutEditor.append(details);
    }
  }

  function renderQualityOptions() {
    refs.qualityOptions.replaceChildren();
    const releases = getReleases();
    if (!releases.length) {
      const empty = document.createElement('p');
      empty.className = 'player-menu-status';
      empty.textContent = 'No quality options are available yet.';
      refs.qualityOptions.append(empty);
      return;
    }
    releases.forEach((release, index) => {
      const button = document.createElement('button');
      button.className = 'player-menu-option';
      button.type = 'button';
      button.dataset.action = 'select-release';
      button.dataset.releaseIndex = String(index);
      button.setAttribute('aria-label', `Play ${release.quality || 'Auto'} quality, ${release.filename || 'stream'}`);
      const label = document.createElement('span');
      label.textContent = `${String(release.quality || 'AUTO').toUpperCase()} · ${release.filename || 'Stream'}`;
      button.append(label);
      if (index === getSelectedRelease()) button.append(createIcon('check', 'player-menu-check'));
      refs.qualityOptions.append(button);
    });
  }

  function renderAudioOptions() {
    refs.audioOptions.replaceChildren();
    const tracks = getAudioTracks(getPlayer(), video);
    if (!tracks.length) {
      const message = document.createElement('p');
      message.className = 'player-menu-status';
      message.textContent = 'No selectable audio tracks are exposed by this stream.';
      refs.audioOptions.append(message);
      return;
    }
    tracks.forEach((track, index) => {
      const button = document.createElement('button');
      button.className = 'player-menu-option';
      button.type = 'button';
      button.dataset.action = 'select-audio';
      button.dataset.audioIndex = String(index);
      const title = track.label || track.language || `Audio ${index + 1}`;
      button.setAttribute('aria-label', `Select audio track ${title}`);
      const label = document.createElement('span');
      label.textContent = title;
      button.append(label);
      if (track.active || track.enabled) button.append(createIcon('check', 'player-menu-check'));
      refs.audioOptions.append(button);
    });
  }

  function renderChapterOptions() {
    refs.chapterOptions.replaceChildren();
    getMediaChapters(video, getChapters()).forEach((chapter, index) => {
      const button = document.createElement('button');
      button.className = 'player-menu-option';
      button.type = 'button';
      button.dataset.action = 'select-chapter';
      button.dataset.chapterIndex = String(index);
      const start = Number(chapter.start ?? chapter.startTime ?? 0);
      button.setAttribute('aria-label', `Go to chapter ${chapter.title || `Chapter ${index + 1}`} at ${formatPlayerTime(start)}`);
      const label = document.createElement('span');
      label.textContent = `${formatPlayerTime(start)} · ${chapter.title || `Chapter ${index + 1}`}`;
      button.append(label);
      refs.chapterOptions.append(button);
    });
  }

  function updateMoreMenu() {
    const buttons = {
      'toggle-bottom-layout': `Bottom layout: ${state.bottomLayout ? 'on' : 'off'}`,
      'toggle-remaining-time': `Time display: ${state.remainingTime ? 'remaining' : 'elapsed'}`,
      'toggle-hidden-pill': `Hidden status pill: ${showHiddenPill ? 'on' : 'off'}`,
      'toggle-visible-status': `Clock/battery pill: ${showVisibleStatus ? 'on' : 'off'}`,
    };
    for (const [action, text] of Object.entries(buttons)) {
      const button = root.querySelector(`[data-action="${action}"]`);
      button.textContent = text;
      button.setAttribute('aria-pressed', String(action === 'toggle-bottom-layout' ? state.bottomLayout
        : action === 'toggle-remaining-time' ? state.remainingTime
          : action === 'toggle-hidden-pill' ? showHiddenPill : showVisibleStatus));
    }
    root.querySelector('#player-seek-step').value = String(state.seekSeconds);
  }

  function showPopover(name) {
    state.popover = name;
    refs.popover.hidden = !name;
    refs.popover.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
    if (name === 'quality') renderQualityOptions();
    if (name === 'audio') renderAudioOptions();
    if (name === 'chapters') renderChapterOptions();
    if (name === 'layout') renderLayoutEditor();
    if (name === 'subtitles') {
      const select = root.querySelector('#subtitle-language');
      if (select) select.value = getSelectedSubtitle() == null ? '' : String(getSelectedSubtitle());
      const auto = root.querySelector('[data-auto-subtitles]');
      if (auto) auto.checked = Boolean(getAutoSubtitles());
    }
    if (name === 'more-options') updateMoreMenu();
    if (name) showControls();
    else scheduleHide();
  }

  function updateTransportState() {
    root.querySelectorAll('[data-action="toggle-play"]').forEach((button) => {
      button.replaceChildren(createIcon(video.paused ? 'play' : 'pause'));
      button.setAttribute('aria-label', video.paused ? 'Play video' : 'Pause video');
      button.title = video.paused ? 'Play video' : 'Pause video';
      button.setAttribute('aria-pressed', String(!video.paused));
    });
    root.querySelectorAll('[data-action="previous"]').forEach((button) => { button.disabled = !getCanPrevious(); });
    root.querySelectorAll('[data-action="next"]').forEach((button) => { button.disabled = !getCanNext(); });
    const mute = root.querySelector('[data-panel="audio"] [data-action="mute"]');
    if (mute) {
      mute.replaceChildren(createIcon(video.muted || video.volume === 0 ? 'mute' : 'volume'), document.createTextNode(video.muted || video.volume === 0 ? 'Unmute' : 'Mute'));
      mute.setAttribute('aria-label', video.muted || video.volume === 0 ? 'Unmute audio' : 'Mute audio');
    }
    const volume = root.querySelector('#player-volume');
    if (volume && document.activeElement !== volume) volume.value = String(video.muted ? 0 : video.volume);
  }

  function renderOrientation() {
    state.orientation = window.matchMedia?.('(orientation: portrait)').matches ? 'portrait' : 'landscape';
    root.dataset.orientation = state.orientation;
    frame.dataset.orientation = state.orientation;
    const row = root.querySelector('.player-bottom-row');
    row.dataset.bottomLayout = String(state.bottomLayout);
    applyTransportLocation();
    refs.visibleStatus.hidden = !showVisibleStatus;
    renderRegions();
  }


  function buildWavePath(width, phase, amplitude) {
    if (width <= 0) return '';
    const points = [];
    for (let x = 0; x <= width; x += 4) {
      const y = 8 + amplitude * Math.sin(((x + phase) % 80) / 80 * Math.PI * 2);
      points.push(`${x === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(2)}`);
    }
    if (width % 4 !== 0) {
      const y = 8 + amplitude * Math.sin(((width + phase) % 80) / 80 * Math.PI * 2);
      points.push(`L${width.toFixed(1)} ${y.toFixed(2)}`);
    }
    return points.join(' ');
  }

  function drawWave(timestamp = 0) {
    if (root.dataset.seekVariant !== 'wavy') {
      cancelAnimationFrame(state.waveFrame);
      state.waveFrame = 0;
      return;
    }
    const width = refs.seekTrack.clientWidth;
    if (!width) return;
    const playing = !video.paused && !state.scrub;
    const now = timestamp || performance.now();
    if (playing && state.waveTime) state.wavePhase = (state.wavePhase + (now - state.waveTime) * 0.01) % 80;
    state.waveTime = playing ? now : 0;
    const path = buildWavePath(width, state.wavePhase, playing ? 6 : 0);
    refs.waveSvg.setAttribute('viewBox', `0 0 ${width} 16`);
    refs.waveBase.setAttribute('d', path);
    refs.waveBuffer.setAttribute('d', path);
    refs.wavePlayed.setAttribute('d', path);
    if (playing && !state.waveFrame) {
      state.waveFrame = requestAnimationFrame((next) => { state.waveFrame = 0; drawWave(next); });
    } else if (!playing) {
      cancelAnimationFrame(state.waveFrame);
      state.waveFrame = 0;
    }
  }

  function refresh() {
    if (state.destroyed) return;
    renderOrientation();
    updateTrack();
    updatePills(true);
  }

  function seekTo(position, commit = true) {
    const duration = currentDuration();
    if (!duration) return;
    const next = clamp(Number(position) || 0, 0, duration);
    video.currentTime = next;
    if (commit) {
      state.ignoreTimeUntil = Date.now() + 800;
      state.committedPosition = next;
      window.clearTimeout(state.seekedTimeout);
      state.seekedTimeout = window.setTimeout(() => {
        if (Date.now() >= state.ignoreTimeUntil) {
          state.committedPosition = null;
          updateTrack();
        }
      }, 810);
    }
    updateTrack();
  }

  function seekBy(seconds) {
    seekTo(effectivePosition() + seconds, true);
    showControls();
  }

  function positionFromPointer(event) {
    const rect = refs.seekArea.getBoundingClientRect();
    return rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) * currentDuration() : 0;
  }

  function onSeekPointerDown(event) {
    if ((event.button !== undefined && event.button !== 0) || !currentDuration()) return;
    event.preventDefault();
    showControls();
    refs.seekArea.setPointerCapture?.(event.pointerId);
    state.scrub = { pointerId: event.pointerId, position: positionFromPointer(event), lastSeekAt: 0 };
    updateTrack();
    onSeekPointerMove(event);
  }

  function onSeekPointerMove(event) {
    if (!state.scrub || state.scrub.pointerId !== event.pointerId) return;
    state.scrub.position = positionFromPointer(event);
    const now = performance.now();
    if (!state.scrub.lastSeekAt || now - state.scrub.lastSeekAt >= 120) {
      seekTo(state.scrub.position, false);
      state.scrub.lastSeekAt = now;
    }
    updateTrack();
  }

  function finishScrub(event) {
    if (!state.scrub || (event?.pointerId != null && state.scrub.pointerId !== event.pointerId)) return;
    const position = state.scrub.position;
    state.scrub = null;
    seekTo(position, true);
    scheduleHide();
  }

  function onSeekKeyDown(event) {
    if (!currentDuration()) return;
    let position = effectivePosition();
    if (event.key === 'ArrowLeft') position -= state.seekSeconds;
    else if (event.key === 'ArrowRight') position += state.seekSeconds;
    else if (event.key === 'PageDown') position -= 30;
    else if (event.key === 'PageUp') position += 30;
    else if (event.key === 'Home') position = 0;
    else if (event.key === 'End') position = currentDuration();
    else return;
    event.preventDefault();
    seekTo(position, true);
    showControls();
  }

  function syncControlLayer() {
    const hidden = !state.visible || state.locked;
    refs.controlLayer.inert = hidden;
    refs.controlLayer.setAttribute('aria-hidden', String(hidden));
  }

  function showControls() {
    if (state.locked) return;
    state.visible = true;
    root.dataset.visible = 'true';
    syncControlLayer();
    updatePills(false);
    scheduleHide();
  }

  function hideControls() {
    if (state.locked || video.paused || state.scrub) return;
    state.visible = false;
    root.dataset.visible = 'false';
    syncControlLayer();
    showPopover('');
    updatePills(false);
  }

  function scheduleHide() {
    window.clearTimeout(state.hideTimer);
    if (video.paused || state.scrub || state.popover || !state.visible || state.locked) return;
    state.hideTimer = window.setTimeout(hideControls, 3000);
  }


  function toggleLock() {
    state.locked = !state.locked;
    if (state.locked) {
      state.visible = false;
      root.dataset.visible = 'false';
      showPopover('');
    } else {
      state.visible = true;
      root.dataset.visible = 'true';
      scheduleHide();
    }
    syncControlLayer();
    updateLockButton();
    renderRegions();
  }

  function showSeekGesture(direction) {
    const now = Date.now();
    const sameBurst = refs.gestureCard.dataset.direction === direction && now - Number(refs.gestureCard.dataset.updatedAt || 0) < 850;
    const total = sameBurst ? Number(refs.gestureCard.dataset.total || state.seekSeconds) + state.seekSeconds : state.seekSeconds;
    refs.gestureCard.dataset.direction = direction;
    refs.gestureCard.dataset.updatedAt = String(now);
    refs.gestureCard.dataset.total = String(total);
    refs.gestureCard.dataset.side = direction === 'forward' ? 'right' : 'left';
    refs.gestureCard.style.setProperty('--gesture-progress', `${clamp(total / Math.max(1, state.seekSeconds * 5), 0.2, 1) * 100}%`);
    const label = document.createElement('span');
    label.append(createIcon(direction));
    const amount = document.createElement('strong');
    amount.textContent = `${direction === 'forward' ? '+' : '−'}${total}s`;
    label.append(amount);
    refs.gestureDirection.replaceChildren(label);
    refs.gestureTime.textContent = `${formatPlayerTime(effectivePosition())} / ${formatPlayerTime(currentDuration())}`;
    refs.gestureCard.hidden = false;
    refs.gestureCard.classList.remove('is-visible');
    const ring = refs.gestureCard.querySelector('.player-gesture-ring-sweep');
    ring.style.animation = 'none';
    ring.style.strokeDashoffset = '194.78';
    void ring.getBoundingClientRect();
    ring.style.animation = '';
    requestAnimationFrame(() => refs.gestureCard.classList.add('is-visible'));
    window.clearTimeout(state.gestureTimer);
    state.gestureTimer = window.setTimeout(() => {
      refs.gestureCard.classList.remove('is-visible');
      window.setTimeout(() => { refs.gestureCard.hidden = true; }, 180);
    }, 850);
  }

  function handleDoubleTap(clientX) {
    const rect = frame.getBoundingClientRect();
    const direction = clientX < rect.left + rect.width / 2 ? 'rewind' : 'forward';
    seekBy(direction === 'forward' ? state.seekSeconds : -state.seekSeconds);
    showSeekGesture(direction);
  }


  function adjustmentUi(type, value, overboost = false) {
    const panel = type === 'volume' ? refs.adjustment : refs.brightnessAdjustment;
    const fill = panel.querySelector(type === 'volume' ? '[data-adjustment-fill]' : '[data-brightness-fill]');
    const label = panel.querySelector(type === 'volume' ? '[data-adjustment-value]' : '[data-brightness-value]');
    panel.dataset.overboost = String(overboost);
    panel.setAttribute('aria-valuemin', '0');
    panel.setAttribute('aria-valuemax', '100');
    panel.setAttribute('aria-valuenow', String(Math.round(clamp(value, 0, 1) * 100)));
    fill.style.height = `${clamp(value, 0, 1) * 100}%`;
    label.textContent = `${Math.round(value * 100)}%`;
    panel.hidden = false;
    showControls();
    window.clearTimeout(state.adjustmentTimer);
    state.adjustmentTimer = window.setTimeout(() => {
      refs.adjustment.hidden = true;
      refs.brightnessAdjustment.hidden = true;
    }, 900);
  }

  function startAdjustment(type) {
    const pointer = state.pointer;
    if (!pointer) return;
    pointer.mode = type;
    pointer.initial = type === 'volume' ? video.volume : state.brightness;
    pointer.adjustmentY = pointer.startY;
    frame.dataset.adjusting = type;
  }

  function changeAdjustment(pointer) {
    const delta = (pointer.adjustmentY - pointer.y) / Math.max(1, frame.clientHeight);
    if (pointer.mode === 'volume') {
      const value = clamp(pointer.initial + delta, 0, 1);
      video.volume = value;
      if (value > 0 && video.muted) video.muted = false;
      adjustmentUi('volume', value);
    } else if (pointer.mode === 'brightness') {
      state.brightness = clamp(pointer.initial + delta * 1.5, 0.1, 1.5);
      video.style.filter = `brightness(${state.brightness})`;
      adjustmentUi('brightness', state.brightness / 1.5, state.brightness > 1.1);
    }
  }

  function onVideoPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = frame.getBoundingClientRect();
    const x = event.clientX - rect.left;
    state.pointer = { pointerId: event.pointerId, x, y: event.clientY - rect.top, startX: x, startY: event.clientY - rect.top, mode: 'pending', moved: false };
    video.setPointerCapture?.(event.pointerId);
    state.pointer.edgeType = x < rect.width / 2 ? 'brightness' : 'volume';
    state.boostTimer = window.setTimeout(() => {
      if (!state.pointer || state.pointer.moved || state.pointer.mode !== 'pending') return;
      state.pointer.mode = 'boost';
      state.pointer.originalRate = video.playbackRate || 1;
      video.playbackRate = 2;
      refs.boostHud.hidden = false;
      showControls();
    }, 450);
  }

  function onVideoPointerMove(event) {
    const pointer = state.pointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const rect = frame.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    const dx = pointer.x - pointer.startX;
    const dy = pointer.y - pointer.startY;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) pointer.moved = true;
    if (pointer.edgeType && pointer.mode === 'pending' && Math.abs(dy) > 8) {
      window.clearTimeout(state.boostTimer);
      startAdjustment(pointer.edgeType);
    } else if (pointer.mode === 'pending' && pointer.moved) {
      window.clearTimeout(state.boostTimer);
      pointer.mode = 'swipe';
    }
    if (pointer.mode === 'volume' || pointer.mode === 'brightness') changeAdjustment(pointer);
  }

  function onVideoPointerUp(event) {
    const pointer = state.pointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    window.clearTimeout(state.boostTimer);
    if (pointer.mode === 'boost') {
      video.playbackRate = pointer.originalRate || 1;
      refs.boostHud.hidden = true;
      state.suppressClickUntil = performance.now() + 350;
    } else if (pointer.mode === 'volume' || pointer.mode === 'brightness' || pointer.mode === 'swipe') {
      refs.adjustment.hidden = true;
      refs.brightnessAdjustment.hidden = true;
      delete frame.dataset.adjusting;
      state.suppressClickUntil = performance.now() + 350;
    }
    state.pointer = null;
  }

  function onFramePointerMove() {
    if (!state.locked && !state.scrub && !video.paused) showControls();
  }


  function updateLockButton() {
    refs.lockButton.hidden = !state.locked;
    refs.lockButton.replaceChildren(createIcon(state.locked ? 'unlock' : 'lock'), document.createTextNode(state.locked ? 'Unlock' : 'Lock'));
    refs.lockButton.setAttribute('aria-label', state.locked ? 'Unlock player controls' : 'Lock player controls');
  }

  function updatePills(forceClock = false) {
    const now = Date.now();
    if (forceClock || now - state.lastClockTick >= 10000 || !state.clockText) {
      state.clockText = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      state.lastClockTick = now;
      refs.playerClock.textContent = state.clockText;
      const visibleClock = refs.visibleStatus.querySelector('[data-visible-clock]');
      if (visibleClock) visibleClock.textContent = state.clockText;
    }
    const duration = currentDuration();
    refs.hiddenRemaining.textContent = duration ? formatPlayerTime(Math.max(0, duration - effectivePosition())) : '--:--';
    refs.hiddenPill.hidden = !showHiddenPill || state.visible;
    refs.hiddenBattery.hidden = state.batteryLevel == null;
    refs.hiddenBatteryDivider.hidden = state.batteryLevel == null;
    refs.batteryLabel.textContent = state.batteryLevel == null ? '' : `${Math.round(state.batteryLevel * 100)}%`;
    refs.visibleStatus.hidden = !showVisibleStatus;
    const visibleBattery = refs.visibleStatus.querySelector('[data-visible-battery]');
    const visibleDivider = refs.visibleStatus.querySelector('[data-visible-battery-divider]');
    const visibleBatteryLabel = refs.visibleStatus.querySelector('[data-visible-battery-label]');
    if (visibleBattery) visibleBattery.hidden = state.batteryLevel == null;
    if (visibleDivider) visibleDivider.hidden = state.batteryLevel == null;
    if (visibleBatteryLabel && state.batteryLevel != null) visibleBatteryLabel.textContent = `${Math.round(state.batteryLevel * 100)}%`;
  }

  function updateBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then((battery) => {
      if (state.destroyed) return;
      state.battery = battery;
      state.batteryLevel = Number.isFinite(battery.level) ? battery.level : null;
      battery.addEventListener('levelchange', onBatteryChange);
      battery.addEventListener('chargingchange', onBatteryChange);
      updatePills(true);
    }).catch(() => {});
  }

  function onBatteryChange() {
    if (state.battery) state.batteryLevel = Number.isFinite(state.battery.level) ? state.battery.level : null;
    updatePills(true);
  }

  async function togglePictureInPicture() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video.requestPictureInPicture) await video.requestPictureInPicture();
      else onStatus('Picture in picture is unavailable in this browser.');
    } catch { onStatus('Picture in picture could not be started.'); }
  }

  function isFullscreen() {
    return Boolean(document.fullscreenElement) || state.pseudoFullscreen;
  }

  /**
   * CSS-only fullscreen used when the Fullscreen API cannot fullscreen an
   * element (iOS Safari before 16.4, some in-app browsers). The video frame is
   * pinned over the viewport so the player still fills the phone screen and
   * every control stays available inside it.
   */
  function setPseudoFullscreen(active) {
    state.pseudoFullscreen = active;
    frame.classList.toggle('is-fullscreen-fallback', active);
    document.body.classList.toggle('player-fullscreen-open', active);
    applyFullscreenState();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (state.pseudoFullscreen) {
        setPseudoFullscreen(false);
        return;
      }
      if (frame.requestFullscreen) {
        await frame.requestFullscreen();
        return;
      }
      setPseudoFullscreen(true);
    } catch {
      // A rejected request (or a browser without element fullscreen) still gets
      // the full-screen phone layout.
      setPseudoFullscreen(!state.pseudoFullscreen);
    }
  }

  /** Reflects fullscreen state in the DOM: compact bar off, all controls on. */
  function applyFullscreenState() {
    const active = isFullscreen();
    root.dataset.fullscreen = String(active);
    root.classList.toggle('is-fullscreen', active);
    root.querySelectorAll('[data-action="fullscreen"]').forEach((button) => {
      const label = active ? 'Exit fullscreen' : 'Enter fullscreen';
      button.setAttribute('aria-label', label);
      button.title = label;
      if (button.classList.contains('player-transport-fullscreen')) {
        button.replaceChildren(createIcon(active ? 'fullscreen-exit' : 'fullscreen'));
      } else if (button.classList.contains('player-menu-button')) {
        button.textContent = active ? 'Exit fullscreen' : 'Enter fullscreen';
      }
      button.setAttribute('aria-pressed', String(active));
    });
    updateCompactMode();
    showControls();
  }

  /**
   * Phones get one horizontal bar (play/pause + fullscreen) instead of every
   * control chip; tapping fullscreen shows the complete control set inside the
   * full-screen player.
   */
  function isCompactViewport() {
    const width = window.innerWidth || document.documentElement?.clientWidth || 0;
    return usesCompactBar(width, window.matchMedia?.('(pointer: coarse)').matches);
  }

  function updateCompactMode() {
    const compact = !isFullscreen() && isCompactViewport();
    state.compact = compact;
    root.dataset.compact = String(compact);
    frame.dataset.compact = String(compact);
    applyTransportLocation();
  }

  /**
   * The transport row exists twice (center and bottom slots); only one is shown.
   * The compact phone bar always rides the bottom row, whatever the layout
   * picker says, so play/pause and fullscreen are never lost.
   */
  function applyTransportLocation() {
    const location = state.compact ? 'bottom' : state.bottomLayout ? 'center' : 'bottom';
    root.querySelectorAll('[data-transport-location]').forEach((container) => {
      container.hidden = container.dataset.transportLocation !== location;
    });
  }

  function takeScreenshot() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (!canvas.width || !canvas.height) throw new Error('Video frame is not ready');
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return onStatus('Screenshot could not be created for this stream.');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${(getTitle() || 'video').replace(/[^a-z0-9._-]+/gi, '_')}-${Math.floor(video.currentTime)}.png`;
        link.click();
        URL.revokeObjectURL(link.href);
      });
    } catch { onStatus('Screenshot is blocked for this stream.'); }
  }

  function chooseAudio(index) {
    const tracks = getAudioTracks(getPlayer(), video);
    const track = tracks[index];
    if (!track) return;
    try {
      const player = getPlayer();
      if (player?.selectAudioTrack) player.selectAudioTrack(track);
      else if (video.audioTracks) {
        for (let trackIndex = 0; trackIndex < video.audioTracks.length; trackIndex += 1) video.audioTracks[trackIndex].enabled = trackIndex === index;
      }
      renderAudioOptions();
    } catch { onStatus('This browser cannot switch the audio track for this stream.'); }
  }

  function startSubtitleSearch(button) {
    if (state.subtitleSearchRunning) return;
    state.subtitleSearchRunning = true;
    Promise.resolve().then(() => onSearchSubtitles(button)).finally(() => {
      state.subtitleSearchRunning = false;
      refresh();
    });
  }

  function runAction(action, button) {
    showControls();
    switch (action) {
      case 'back': onBack(); break;
      case 'previous': if (getCanPrevious()) onPrevious(); break;
      case 'next': if (getCanNext()) onNext(); break;
      case 'rewind': seekBy(-state.seekSeconds); break;
      case 'forward': seekBy(state.seekSeconds); break;
      case 'toggle-play':
        if (video.paused) video.play().catch(() => onStatus('Tap play again to start this stream.'));
        else video.pause();
        break;
      case 'subtitles':
        showPopover('subtitles');
        if (!getSubtitleOptions().length) startSubtitleSearch(root.querySelector('[data-find-subtitles]'));
        else root.querySelector('#subtitle-language')?.focus();
        break;
      case 'audio': showPopover('audio'); break;
      case 'decoder':
        refs.decoderDescription.textContent = `${getDecoder() || 'AUTO'} · ${getSource() || 'Browser playback'}`;
        showPopover('decoder');
        break;
      case 'chapters': showPopover('chapters'); break;
      case 'quality': showPopover('quality'); break;
      case 'more-options': showPopover('more-options'); break;
      case 'enhance':
        state.enhanced = !state.enhanced;
        button.setAttribute('aria-pressed', String(state.enhanced));
        button.classList.toggle('is-active', state.enhanced);
        break;
      case 'background-play':
        state.backgroundPlay = !state.backgroundPlay;
        button.setAttribute('aria-pressed', String(state.backgroundPlay));
        button.classList.toggle('is-active', state.backgroundPlay);
        break;
      case 'rotate':
        state.rotated = !state.rotated;
        frame.classList.toggle('is-rotated', state.rotated);
        button.setAttribute('aria-pressed', String(state.rotated));
        button.classList.toggle('is-active', state.rotated);
        break;
      case 'aspect':
        state.aspect = state.aspect === 'contain' ? 'cover' : state.aspect === 'cover' ? 'fill' : 'contain';
        video.dataset.aspect = state.aspect;
        button.setAttribute('aria-pressed', String(state.aspect !== 'contain'));
        button.classList.toggle('is-active', state.aspect !== 'contain');
        onStatus(`Aspect ratio: ${state.aspect}.`);
        break;
      case 'lock': toggleLock(); break;
      case 'pip': void togglePictureInPicture(); break;
      case 'screenshot': takeScreenshot(); break;
      case 'expand-region':
        if (state.expandedRegions.has(button.dataset.region)) state.expandedRegions.delete(button.dataset.region);
        else state.expandedRegions.add(button.dataset.region);
        renderRegions();
        break;
      case 'close-popover': showPopover(''); break;
      case 'mute':
        video.muted = !video.muted;
        updateTransportState();
        break;
      case 'select-audio': chooseAudio(Number(button.dataset.audioIndex)); break;
      case 'select-release':
        showPopover('');
        onSelectRelease(Number(button.dataset.releaseIndex));
        break;
      case 'select-chapter': {
        const chapter = getMediaChapters(video, getChapters())[Number(button.dataset.chapterIndex)];
        if (chapter) seekTo(Number(chapter.start ?? chapter.startTime ?? 0), true);
        showPopover('');
        break;
      }
      case 'toggle-bottom-layout':
        state.bottomLayout = !state.bottomLayout;
        updateMoreMenu();
        renderOrientation();
        break;
      case 'toggle-remaining-time':
        state.remainingTime = !state.remainingTime;
        updateMoreMenu();
        updateTrack();
        break;
      case 'toggle-hidden-pill':
        showHiddenPill = !showHiddenPill;
        updateMoreMenu();
        updatePills(true);
        break;
      case 'toggle-visible-status':
        showVisibleStatus = !showVisibleStatus;
        updateMoreMenu();
        renderVisibleStatus();
        updatePills(true);
        break;
      case 'fullscreen': void toggleFullscreen(); break;
      case 'customize-controls': showPopover('layout'); break;
      case 'reset-layout':
        state.layout = copyLayout(DEFAULT_PLAYER_LAYOUT);
        saveLayout(state.layout);
        renderLayoutEditor();
        renderRegions();
        break;
      default: break;
    }
  }

  function renderVisibleStatus() {
    refs.visibleStatus.replaceChildren();
    if (!showVisibleStatus) return;
    const clock = document.createElement('span');
    clock.className = 'player-visible-status-segment';
    clock.append(createIcon('clock'));
    const clockValue = document.createElement('strong');
    clockValue.dataset.visibleClock = '';
    clockValue.textContent = state.clockText;
    clock.append(clockValue);
    refs.visibleStatus.append(clock);
    const divider = document.createElement('span');
    divider.className = 'player-visible-status-divider';
    divider.dataset.visibleBatteryDivider = '';
    const battery = document.createElement('span');
    battery.className = 'player-visible-status-segment';
    battery.dataset.visibleBattery = '';
    battery.append(createIcon('battery'));
    const batteryValue = document.createElement('strong');
    batteryValue.dataset.visibleBatteryLabel = '';
    battery.append(batteryValue);
    refs.visibleStatus.append(divider, battery);
    refs.visibleStatus.hidden = false;
    updatePills(true);
  }

  function onRootClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const search = target.closest('[data-find-subtitles]');
    if (search) {
      event.preventDefault();
      startSubtitleSearch(search);
      return;
    }
    const button = target.closest('[data-action]');
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    runAction(button.dataset.action, button);
  }

  function onRootChange(event) {
    const target = event.target;
    if (target.matches('#subtitle-language')) onSelectSubtitle(target.value);
    else if (target.matches('[data-auto-subtitles]')) onToggleAutoSubtitles(target.checked);
    else if (target.matches('#player-volume')) {
      video.volume = Number(target.value);
      if (video.volume > 0 && video.muted) video.muted = false;
      updateTransportState();
    } else if (target.matches('#player-seek-step')) {
      state.seekSeconds = clamp(Number(target.value) || 10, 5, 30);
      renderRegions();
    } else if (target.matches('[data-layout-control]')) {
      const orientation = target.dataset.layoutRegion.split('.')[0];
      for (const region of PLAYER_REGIONS) {
        if (region.startsWith(`${orientation}.`)) {
          state.layout[region] = state.layout[region].filter((id) => id !== target.dataset.layoutControl);
        }
      }
      if (target.checked) state.layout[target.dataset.layoutRegion].push(target.dataset.layoutControl);
      saveLayout(state.layout);
      renderLayoutEditor();
      renderRegions();
    }
  }

  function onGlobalKeyDown(event) {
    if (root.contains(event.target) || event.target?.matches?.('input, select, textarea, [contenteditable="true"]')) return;
    if (event.key === 'Escape' && state.popover) {
      showPopover('');
      event.preventDefault();
    } else if (event.key === ' ' || event.key.toLowerCase() === 'k') {
      event.preventDefault();
      runAction('toggle-play');
    } else if (event.key.toLowerCase() === 'm') {
      video.muted = !video.muted;
      updateTransportState();
    } else if (event.key.toLowerCase() === 'f') void toggleFullscreen();
    else if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(-state.seekSeconds); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(state.seekSeconds); }
  }

  function onTimeUpdate() {
    updateTrack();
    if (state.scrub) refs.gestureTime.textContent = `${formatPlayerTime(state.scrub.position)} / ${formatPlayerTime(currentDuration())}`;
  }

  function onFullscreenChange() {
    if (document.fullscreenElement && state.pseudoFullscreen) {
      // A real fullscreen request succeeded: drop the CSS fallback.
      state.pseudoFullscreen = false;
      frame.classList.remove('is-fullscreen-fallback');
      document.body.classList.remove('player-fullscreen-open');
    }
    applyFullscreenState();
  }

  function onViewportChange() {
    renderOrientation();
    updateCompactMode();
  }

  function onPictureInPictureChange() {
    root.classList.toggle('is-pip', document.pictureInPictureElement === video);
  }

  function onVideoEnded() {
    state.visible = true;
    root.dataset.visible = 'true';
    syncControlLayer();
    updatePills(false);
  }

  function handleVideoStateChange() {
    if (video.paused) {
      state.visible = true;
      root.dataset.visible = 'true';
      syncControlLayer();
      window.clearTimeout(state.hideTimer);
      refs.boostHud.hidden = true;
    } else scheduleHide();
    updateTrack();
  }

  function handleVideoClick(event) {
    if (performance.now() < state.suppressClickUntil) return;
    if (state.tapTimer) {
      window.clearTimeout(state.tapTimer);
      state.tapTimer = 0;
      handleDoubleTap(state.lastTapX || event.clientX);
      return;
    }
    state.lastTapX = event.clientX;
    state.tapTimer = window.setTimeout(() => {
      state.tapTimer = 0;
      if (state.locked) return;
      state.visible = !state.visible;
      root.dataset.visible = String(state.visible);
      syncControlLayer();
      if (state.visible) scheduleHide();
      else { window.clearTimeout(state.hideTimer); showPopover(''); }
      updatePills(false);
    }, 260);
  }

  function cleanupBattery() {
    if (!state.battery) return;
    state.battery.removeEventListener('levelchange', onBatteryChange);
    state.battery.removeEventListener('chargingchange', onBatteryChange);
  }

  root.addEventListener('click', onRootClick);
  root.addEventListener('change', onRootChange);
  refs.seekArea.addEventListener('pointerdown', onSeekPointerDown);
  refs.seekArea.addEventListener('pointermove', onSeekPointerMove);
  refs.seekArea.addEventListener('pointerup', finishScrub);
  refs.seekArea.addEventListener('pointercancel', finishScrub);
  refs.seekArea.addEventListener('keydown', onSeekKeyDown);
  video.addEventListener('click', handleVideoClick);
  video.addEventListener('pointerdown', onVideoPointerDown);
  video.addEventListener('pointermove', onVideoPointerMove);
  video.addEventListener('pointerup', onVideoPointerUp);
  video.addEventListener('pointercancel', onVideoPointerUp);
  frame.addEventListener('pointermove', onFramePointerMove);
  for (const name of ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'seeked', 'volumechange', 'ratechange']) video.addEventListener(name, onTimeUpdate);
  video.addEventListener('play', handleVideoStateChange);
  video.addEventListener('pause', handleVideoStateChange);
  video.addEventListener('ended', onVideoEnded);
  document.addEventListener('keydown', onGlobalKeyDown);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('enterpictureinpicture', onPictureInPictureChange);
  document.addEventListener('leavepictureinpicture', onPictureInPictureChange);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  refs.lockButton.addEventListener('click', toggleLock);
  renderVisibleStatus();
  updateCompactMode();
  applyFullscreenState();
  renderOrientation();
  syncControlLayer();
  updateLockButton();
  updateTrack();
  updatePills(true);
  updateBattery();
  state.statusTimer = window.setInterval(() => updatePills(true), 10000);

  return {
    refresh,
    isFullscreen,
    toggleFullscreen,
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      window.clearTimeout(state.hideTimer);
      window.clearTimeout(state.tapTimer);
      window.clearTimeout(state.boostTimer);
      window.clearTimeout(state.gestureTimer);
      window.clearTimeout(state.adjustmentTimer);
      window.clearTimeout(state.seekedTimeout);
      window.clearInterval(state.statusTimer);
      cancelAnimationFrame(state.waveFrame);
      cleanupBattery();
      root.removeEventListener('click', onRootClick);
      root.removeEventListener('change', onRootChange);
      refs.seekArea.removeEventListener('pointerdown', onSeekPointerDown);
      refs.seekArea.removeEventListener('pointermove', onSeekPointerMove);
      refs.seekArea.removeEventListener('pointerup', finishScrub);
      refs.seekArea.removeEventListener('pointercancel', finishScrub);
      refs.seekArea.removeEventListener('keydown', onSeekKeyDown);
      video.removeEventListener('click', handleVideoClick);
      video.removeEventListener('pointerdown', onVideoPointerDown);
      video.removeEventListener('pointermove', onVideoPointerMove);
      video.removeEventListener('pointerup', onVideoPointerUp);
      video.removeEventListener('pointercancel', onVideoPointerUp);
      frame.removeEventListener('pointermove', onFramePointerMove);
      for (const name of ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'seeked', 'volumechange', 'ratechange']) video.removeEventListener(name, onTimeUpdate);
      video.removeEventListener('play', handleVideoStateChange);
      video.removeEventListener('pause', handleVideoStateChange);
      video.removeEventListener('ended', onVideoEnded);
      document.removeEventListener('keydown', onGlobalKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('enterpictureinpicture', onPictureInPictureChange);
      document.removeEventListener('leavepictureinpicture', onPictureInPictureChange);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('orientationchange', onViewportChange);
      refs.lockButton.removeEventListener('click', toggleLock);
      root.remove();
      delete frame.dataset.orientation;
      delete frame.dataset.compact;
      frame.classList.remove('is-rotated');
      frame.classList.remove('is-fullscreen-fallback');
      document.body.classList.remove('player-fullscreen-open');
      video.style.filter = '';
      video.style.objectFit = '';
      delete video.dataset.aspect;
    },
  };
}
