// Sidify-V2 media utilities adapted for Ifallhub's multi-provider `/api/*` catalog.

import {
  isSeriesItem,
  itemId,
  itemPoster,
  itemProvider,
  itemTitle,
  itemYear,
  normaliseRating,
  parseYear,
  prettySize,
} from './format.js';

const PALETTES = [
  ['#1d1135', '#7e22ce', '#f472b6'],
  ['#0b1d2e', '#0369a1', '#67e8f9'],
  ['#1f1409', '#b45309', '#fde68a'],
  ['#0f2419', '#047857', '#6ee7b7'],
  ['#2a0d16', '#be123c', '#fda4af'],
  ['#171923', '#4338ca', '#a5b4fc'],
  ['#231420', '#9d174d', '#f9a8d4'],
  ['#102027', '#0f766e', '#99f6e4'],
];

function hashSeed(input) {
  let h = 2166136261;
  const s = String(input || 'media');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapTitle(title, maxChars) {
  const words = String(title || 'Untitled').trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
      if (lines.length === 2) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < 3) lines.push(line);
  return lines.slice(0, 3);
}

/**
 * Deterministic poster/backdrop SVG data URI fallback matching Sidify-V2's `mediaArt()`.
 */
export function mediaArt(title, year = '', kind = 'movie', variant = 'poster') {
  const h = hashSeed(`${kind}:${title}:${year}`);
  const [c0, c1, c2] = PALETTES[h % PALETTES.length];
  const angle = (h % 7) * 25 + 115;
  const cx = 25 + (h % 55);
  const cy = 20 + ((h >> 4) % 45);

  if (variant === 'backdrop') {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1280 720' preserveAspectRatio='xMidYMid slice'>
      <defs>
        <linearGradient id='g' gradientTransform='rotate(${angle} .5 .5)'>
          <stop offset='0%' stop-color='${c0}'/>
          <stop offset='58%' stop-color='${c1}'/>
          <stop offset='100%' stop-color='${c0}'/>
        </linearGradient>
        <radialGradient id='r' cx='${cx}%' cy='${cy}%' r='62%'>
          <stop offset='0%' stop-color='${c2}' stop-opacity='.55'/>
          <stop offset='65%' stop-color='${c1}' stop-opacity='.18'/>
          <stop offset='100%' stop-color='${c0}' stop-opacity='0'/>
        </radialGradient>
      </defs>
      <rect width='1280' height='720' fill='url(#g)'/>
      <rect width='1280' height='720' fill='url(#r)'/>
      <circle cx='${980 - (h % 260)}' cy='${180 + (h % 180)}' r='300' fill='none' stroke='${c2}' stroke-opacity='.14' stroke-width='2'/>
      <circle cx='${980 - (h % 260)}' cy='${180 + (h % 180)}' r='210' fill='none' stroke='${c2}' stroke-opacity='.1' stroke-width='1.5'/>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  const lines = wrapTitle(title, 14);
  const label = kind === 'series' ? 'SERIES' : 'FILM';
  const yStart = 500 - (lines.length - 1) * 40;
  const textSvg = lines
    .map(
      (line, idx) =>
        `<text x='36' y='${yStart + idx * 40}' fill='#fff' font-family='-apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif' font-size='34' font-weight='800' letter-spacing='-0.8'>${escapeXml(line)}</text>`,
    )
    .join('');

  const meta = year ? `${label} · ${escapeXml(year)}` : label;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 600' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='${c1}'/>
        <stop offset='55%' stop-color='${c0}'/>
        <stop offset='100%' stop-color='#07070a'/>
      </linearGradient>
      <radialGradient id='r' cx='${cx}%' cy='${cy}%' r='68%'>
        <stop offset='0%' stop-color='${c2}' stop-opacity='.72'/>
        <stop offset='60%' stop-color='${c1}' stop-opacity='.2'/>
        <stop offset='100%' stop-color='${c0}' stop-opacity='0'/>
      </radialGradient>
      <linearGradient id='s' x1='0' y1='.35' x2='0' y2='1'>
        <stop offset='0%' stop-color='#000' stop-opacity='0'/>
        <stop offset='100%' stop-color='#000' stop-opacity='.82'/>
      </linearGradient>
    </defs>
    <rect width='400' height='600' fill='url(#g)'/>
    <rect width='400' height='600' fill='url(#r)'/>
    <circle cx='${120 + (h % 180)}' cy='${130 + ((h >> 3) % 130)}' r='150' fill='none' stroke='#fff' stroke-opacity='.12' stroke-width='1.5'/>
    <circle cx='${120 + (h % 180)}' cy='${130 + ((h >> 3) % 130)}' r='95' fill='none' stroke='#fff' stroke-opacity='.09' stroke-width='1'/>
    <rect width='400' height='600' fill='url(#s)'/>
    <text x='36' y='54' fill='rgba(255,255,255,.72)' font-family='-apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif' font-size='13' font-weight='700' letter-spacing='2.2'>${meta}</text>
    ${textSvg}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Ambient MeshBackdrop palette derived deterministically from a title seed. */
export function ambientColorsFor(seed = 'Ifallhub') {
  const h = hashSeed(seed);
  const [c0, c1, c2] = PALETTES[h % PALETTES.length];
  return [c1, c2, c0];
}

export function itemBackdrop(item) {
  return item?.backdrop_url || item?.backdrop || item?.cover_url || itemPoster(item) || '';
}

export function detailPathFor(provider, id, isSeries = false) {
  const base = isSeries ? '/series' : '/movies';
  return `${base}/${encodeURIComponent(provider || 'moviebox')}/${encodeURIComponent(id)}`;
}

export function titleHref(item) {
  return detailPathFor(itemProvider(item), itemId(item), isSeriesItem(item));
}

/* ── Release Hints (exact port of Sidify-V2 releaseHints.ts) ── */

export function parseReleaseHints(name, explicitCodec = '') {
  const raw = `${name || ''} ${explicitCodec || ''}`;
  const lower = raw.toLowerCase();

  const container = /\.mp4\b/i.test(lower)
    ? 'MP4'
    : /\.mkv\b/i.test(lower)
      ? 'MKV'
      : /\.webm\b/i.test(lower)
        ? 'WEBM'
        : null;

  const codec = /\b(x265|h\.?265|hevc)\b/i.test(lower)
    ? 'HEVC'
    : /\bav1\b/i.test(lower)
      ? 'AV1'
      : /\b(x264|h\.?264|avc1?)\b/i.test(lower)
        ? 'H.264'
        : null;

  const hdr = /\b(dv|dovi|dolby[. -]?vision)\b/i.test(lower)
    ? 'DV'
    : /\bhdr10\+|\bhdr10plus\b/i.test(lower)
      ? 'HDR10+'
      : /\bhdr10?\b/i.test(lower)
        ? 'HDR'
        : null;

  const bitDepth =
    /\b10[- .]?bit\b|\bhi10p\b/i.test(lower) || (codec === 'HEVC' && Boolean(hdr))
      ? '10-bit'
      : null;

  const audio = /\batmos\b/i.test(lower)
    ? 'Atmos'
    : /\btruehd\b/i.test(lower)
      ? 'TrueHD'
      : /\bdts(-?hd|-?x)?(?=[\d._ -]|$)/i.test(lower)
        ? 'DTS'
        : /\b(ddp|dd\+|eac-?3)(?=[\d._ -]|$)/i.test(lower)
          ? 'DDP'
          : /\b(ac-?3|dd)(?=[\d._ -]|$)/i.test(lower)
            ? 'DD'
            : /\baac(?=[\d._ -]|$)/i.test(lower)
              ? 'AAC'
              : /\bopus(?=[\d._ -]|$)/i.test(lower)
                ? 'Opus'
                : null;

  const browserAudioRisk =
    audio === 'Atmos' || audio === 'TrueHD' || audio === 'DTS' || audio === 'DDP' || audio === 'DD';

  const chips = [container, codec, bitDepth, hdr, audio].filter(Boolean);
  return { container, codec, bitDepth, hdr, audio, browserAudioRisk, chips };
}

/** Summarise a stream set's releases into `2160p · 1080p · 720p · 920 MB – 5.4 GB`. */
export function summariseReleases(releases = []) {
  if (!Array.isArray(releases) || !releases.length) return '';
  const qualities = [];
  const sizes = [];
  for (const r of releases) {
    const q = String(r.quality || '').trim();
    if (q && !qualities.includes(q)) qualities.push(q);
    if (Number(r.size_bytes) > 0) sizes.push(Number(r.size_bytes));
  }
  const bits = [];
  if (qualities.length) bits.push(qualities.slice(0, 4).join(' · '));
  if (sizes.length === 1) {
    bits.push(prettySize(sizes[0]));
  } else if (sizes.length > 1) {
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    bits.push(min === max ? prettySize(min) : `${prettySize(min)} – ${prettySize(max)}`);
  }
  return bits.filter(Boolean).join(' · ');
}

/* ── Season / Episode & Metadata Helpers (MovieBox-TUI models.rs) ── */

export function seasonNumberOf(season, fallback = 0) {
  const n = Number(season?.number ?? season?.season_number ?? season?.seasonNumber ?? fallback);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function episodeNumberOf(episode, fallback = 1) {
  const n = Number(episode?.number ?? episode?.episode_number ?? episode?.episodeNumber ?? fallback);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

export function orderedSeasonNumbers(seasons = []) {
  const seen = new Set();
  for (const s of seasons || []) {
    const n = seasonNumberOf(s, 0);
    if (Number.isInteger(n) && n >= 1) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

export function initialSeasonNumber(seasons = [], requested = null) {
  const ordered = orderedSeasonNumbers(seasons);
  const req = Number(requested);
  if (req && ordered.includes(req)) return req;
  return ordered[0] ?? 1;
}

export function officialRatingOf(item, metaEntry = null) {
  return normaliseRating(
    item?.imdb_rating ?? metaEntry?.rating ?? metaEntry?.imdb_rating ?? item?.rating,
  );
}

export function splitCsvList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,|/]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

export function formatDetailList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
  }
  return String(value ?? '').trim();
}

/* ── Browse Filtering, Facets & Sorting (Sidify-V2 query.ts) ── */

export const SORTS = [
  { id: 'trending', label: 'Trending' },
  { id: 'newest', label: 'Newest' },
  { id: 'rating', label: 'Top rated' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'title', label: 'A–Z' },
];

export const DEFAULT_GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Mystery',
  'Romance',
  'Science Fiction',
  'Thriller',
];

export function itemGenres(item, metaEntry = null) {
  const raw = metaEntry?.genres || item?.genres || [];
  if (Array.isArray(raw)) return raw.map((g) => String(g).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(/[,|/]/).map((g) => g.trim()).filter(Boolean);
  return [];
}

export function extractMediaFacets(items = [], metaLookup = () => null) {
  const genreCounts = new Map();
  const years = new Set();

  for (const item of items) {
    const meta = metaLookup(item);
    for (const g of itemGenres(item, meta)) {
      genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
    }
    const y = parseYear(meta?.year ?? itemYear(item));
    if (y) years.add(String(y));
  }

  let genres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([g]) => g);

  if (genres.length < 6) {
    const merged = new Set([...genres, ...DEFAULT_GENRES]);
    genres = [...merged];
  }

  const sortedYears = [...years].sort((a, b) => Number(b) - Number(a));
  return { genres: genres.slice(0, 18), years: sortedYears };
}

export function filterAndSortMedia(
  items = [],
  { kind = '', q = '', genre = '', year = '', sort = 'trending', metaLookup = () => null, metrics = {} } = {},
) {
  const term = String(q || '').trim().toLowerCase();
  const targetGenre = String(genre || '').trim().toLowerCase();
  const targetYear = String(year || '').trim();

  const filtered = items.filter((item) => {
    const meta = metaLookup(item);
    const merged = meta
      ? {
          ...meta,
          ...item,
          genres: item.genres || meta.genres,
          imdb_rating: item.imdb_rating ?? meta.rating ?? meta.imdb_rating,
        }
      : item;
    if (kind === 'movie' && isSeriesItem(merged)) return false;
    if (kind === 'series' && !isSeriesItem(merged)) return false;

    if (term) {
      const hay = [
        itemTitle(merged),
        itemYear(merged),
        merged.director || '',
        ...splitCsvList(merged.stars ?? merged.cast),
        ...itemGenres(merged, meta),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(term)) return false;
    }

    if (targetGenre) {
      const genres = itemGenres(merged, meta).map((g) => g.toLowerCase());
      if (!genres.includes(targetGenre)) return false;
    }

    if (targetYear) {
      const y = parseYear(meta?.year ?? itemYear(merged));
      if (targetYear.endsWith('s')) {
        const decade = Number(targetYear.slice(0, 4));
        if (!y || y < decade || y >= decade + 10) return false;
      } else if (String(y || '') !== targetYear) {
        return false;
      }
    }

    return true;
  });

  const sorted = [...filtered];
  const scoreOf = (it) => officialRatingOf(it, metaLookup(it)) ?? -1;
  const yearOf = (it) => parseYear(metaLookup(it)?.year ?? itemYear(it)) ?? 0;
  const trendOf = (it) => Number(metrics?.[itemId(it)]?.trending ?? 0);

  switch (sort) {
    case 'newest':
      sorted.sort((a, b) => yearOf(b) - yearOf(a) || scoreOf(b) - scoreOf(a));
      break;
    case 'oldest':
      sorted.sort((a, b) => (yearOf(a) || 9999) - (yearOf(b) || 9999));
      break;
    case 'rating':
      sorted.sort((a, b) => scoreOf(b) - scoreOf(a) || yearOf(b) - yearOf(a));
      break;
    case 'title':
      sorted.sort((a, b) => itemTitle(a).localeCompare(itemTitle(b)));
      break;
    case 'trending':
    default:
      if (Object.keys(metrics || {}).length) {
        sorted.sort((a, b) => trendOf(b) - trendOf(a));
      }
      break;
  }

  return sorted;
}
