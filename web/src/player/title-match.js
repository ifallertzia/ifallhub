// Conservative title identity checks for cross-provider playback fallback.
// Search APIs frequently return broad results, so shared words or a sequel
// number alone are never enough to select a result.

const LANGUAGES = new Set([
  'hindi', 'hin', 'english', 'eng', 'tamil', 'tam', 'telugu', 'tel', 'kannada', 'kan',
  'malayalam', 'mal', 'bengali', 'bangla', 'ben', 'marathi', 'mar', 'punjabi', 'pan',
  'gujarati', 'guj', 'urdu', 'urd', 'spanish', 'spa', 'french', 'fra', 'fre', 'german',
  'ger', 'deu', 'italian', 'ita', 'japanese', 'jpn', 'korean', 'kor', 'chinese', 'chi',
  'mandarin', 'cantonese', 'russian', 'rus', 'portuguese', 'por', 'turkish', 'tur', 'arabic',
  'ara', 'thai', 'indonesian', 'ind', 'vietnamese', 'vie', 'dutch', 'nld', 'polish', 'pol',
  'swedish', 'swe', 'danish', 'dan', 'norwegian', 'nor', 'finnish', 'fin', 'greek', 'ell',
  'hebrew', 'heb', 'czech', 'ces', 'hungarian', 'hun', 'romanian', 'ron', 'ukrainian', 'ukr',
  'persian', 'fas', 'tagalog', 'filipino', 'malay', 'msa',
]);

const AUDIO_TAGS = new Set([
  'dub', 'dubbed', 'audio', 'multi', 'dual', 'sub', 'subs', 'subtitle', 'subtitles', 'version',
]);
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'for']);
const NUMBER_WORDS = new Map([
  ['one', '1'], ['two', '2'], ['three', '3'], ['four', '4'], ['five', '5'],
  ['six', '6'], ['seven', '7'], ['eight', '8'], ['nine', '9'], ['ten', '10'],
]);

function rawTokens(value = '') {
  return [...String(value).toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').matchAll(/[\p{L}\p{N}]+/gu)]
    .map((match) => ({ token: match[0], index: match.index }));
}

function isYearToken(token) {
  return /^\d{4}$/.test(token) && Number(token) >= 1900 && Number(token) <= 2099;
}

function isResolutionToken(token) {
  return /^\d{3,4}p$/.test(token) && Number.parseInt(token, 10) >= 144;
}

function isReleaseMetadataToken(token) {
  return isResolutionToken(token) || [
    '4k', '8k', 'uhd', 'hd', 'sd', 'hdr', 'hdr10', 'dv', 'web', 'dl', 'webdl', 'webrip', 'bluray',
    'brrip', 'bdrip', 'hdrip', 'hdtv', 'remux', 'hevc', 'h264', 'h265', 'x264', 'x265', 'av1',
    'aac', 'dts', 'mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'mp3', 'm4v', 'webm', 'proper',
    'repack', 'limited', 'internal', 'unknown', 'release', 'file', 'video', 'stream', 'source',
    'direct', 'download', 'link',
  ].includes(token) || (/^s\d+e\d+$/.test(token));
}

function isMetadataToken(token) {
  return LANGUAGES.has(token) || AUDIO_TAGS.has(token) || isReleaseMetadataToken(token);
}

function stripAnnotations(value = '', preserveYears = false) {
  return String(value).replace(/\[([^\]]*)\]|\(([^)]*)\)/g, (_whole, square, round) => {
    const contents = square ?? round ?? '';
    const tokens = rawTokens(contents).map(({ token }) => token);
    const metadata = tokens.length > 0 && tokens.every((token) => isYearToken(token) || isMetadataToken(token));
    if (!metadata) return ` ${contents} `;
    if (!preserveYears) return ' ';
    return `${tokens.filter(isYearToken).join(' ')} `;
  });
}

function stripTrailingMetadata(value = '') {
  const text = String(value).trim();
  const spans = rawTokens(text);
  if (!spans.length) return text;
  let firstSuffix = spans.length;
  while (firstSuffix > 0 && isMetadataToken(spans[firstSuffix - 1].token)) firstSuffix -= 1;
  if (firstSuffix > 0 && firstSuffix < spans.length) {
    return text.slice(0, spans[firstSuffix].index).replace(/[\s._:|+-]+$/u, '');
  }
  return text;
}

/** Scraper-safe query text: drops bracketed language tags and preserves years. */
export function sanitizeSearchQuery(value = '') {
  const withoutAnnotations = stripAnnotations(value, true);
  return stripTrailingMetadata(withoutAnnotations)
    .replace(/[\[\](){}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Adds the known release year once, after removing language/audio suffixes. */
export function prepareSearchQuery(title = '', year = '') {
  const cleanTitle = sanitizeSearchQuery(title);
  if (!cleanTitle) return '';
  const normalizedYear = normalizeYear(year);
  if (!normalizedYear || rawTokens(cleanTitle).some(({ token }) => token === normalizedYear)) return cleanTitle;
  return `${cleanTitle} ${normalizedYear}`;
}

function normalizeYear(value) {
  const match = String(value ?? '').match(/\b(?:19|20)\d{2}\b/u);
  return match && Number(match[0]) <= 2099 ? match[0] : '';
}

function yearFromTitle(value = '') {
  const clean = stripAnnotations(value, false);
  const tokens = rawTokens(clean);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (isYearToken(tokens[index].token) && tokens[index].index > 0) return tokens[index].token;
  }
  return '';
}

function titleTokens(value = '', releaseFilename = false) {
  const clean = stripTrailingMetadata(stripAnnotations(value, false));
  const spans = rawTokens(clean);
  const tokens = [];
  for (let index = 0; index < spans.length; index += 1) {
    const { token } = spans[index];
    if (releaseFilename && isReleaseMetadataToken(token)) break;
    if (isYearToken(token) && index > 0) continue;
    if (STOP_WORDS.has(token)) continue;
    tokens.push(NUMBER_WORDS.get(token) || token);
  }
  return tokens;
}

function isNumberToken(token) {
  return /^\d+$/u.test(token);
}

function editDistance(left, right) {
  const a = [...left];
  const b = [...right];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      current[j + 1] = Math.min(
        previous[j + 1] + 1,
        current[j] + 1,
        previous[j] + Number(a[i] !== b[j]),
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

function tokenMatches(expected, candidate) {
  if (expected === candidate) return true;
  if (isNumberToken(expected) || isNumberToken(candidate)) return false;
  const longest = Math.max([...expected].length, [...candidate].length);
  return longest >= 5 && editDistance(expected, candidate) <= Math.floor(longest / 5);
}

function hasWordToken(tokens) {
  return tokens.some((token) => !isNumberToken(token) || isYearToken(token));
}

function titleTokensMatch(expected, candidate) {
  if (!expected.length || !candidate.length || !hasWordToken(expected)) return false;
  const expectedNumbers = expected.filter(isNumberToken);
  const candidateNumbers = candidate.filter(isNumberToken);
  if (expectedNumbers.join(',') !== candidateNumbers.join(',')) return false;

  let candidateIndex = 0;
  for (const expectedToken of expected) {
    let matchIndex = -1;
    for (let index = candidateIndex; index < candidate.length; index += 1) {
      if (tokenMatches(expectedToken, candidate[index])) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex < 0) return false;
    candidateIndex = matchIndex + 1;
  }

  const extraTokens = Math.max(0, candidate.length - expected.length);
  return extraTokens <= Math.max(Math.floor(expected.length / 2) + 2, 3);
}

/** Compare titles, rejecting known release-year conflicts and number-only hits. */
export function titlesMatch(expectedTitle, candidateTitle, expectedYear = '', candidateYear = '') {
  const leftYear = normalizeYear(expectedYear) || yearFromTitle(expectedTitle);
  const rightYear = normalizeYear(candidateYear) || yearFromTitle(candidateTitle);
  if (leftYear && rightYear && leftYear !== rightYear) return false;
  return titleTokensMatch(titleTokens(expectedTitle), titleTokens(candidateTitle));
}

/**
 * A filename with an explicit, unrelated title is rejected. Generic/ambiguous
 * filenames such as "1080p WEB-DL" or a one-word addon label return null so a
 * verified provider page title can be used as the identity check.
 */
export function releaseTitleMatches(expectedTitle, filename, expectedYear = '') {
  const expected = titleTokens(expectedTitle);
  if (!hasWordToken(expected)) return false;

  const year = normalizeYear(expectedYear);
  if (year) {
    const expectedNumbers = new Set(expected.filter(isNumberToken));
    const candidateYear = rawTokens(filename).find(({ token }) => isYearToken(token) && !expectedNumbers.has(token))?.token;
    if (candidateYear && candidateYear !== year) return false;
  }

  const candidate = titleTokens(filename, true);
  if (!hasWordToken(candidate) || (candidate.length === 1 && expected.length > 1)) return null;
  return titleTokensMatch(expected, candidate);
}

/** Pick the closest verified title; never turn a no-match into results[0]. */
export function pickBestMatch(results = [], title = '', year = '', isSeries) {
  const expectedTokens = titleTokens(title);
  if (!hasWordToken(expectedTokens)) return null;

  const ranked = (Array.isArray(results) ? results : [])
    .map((entry, index) => {
      if (!entry?.title || !titlesMatch(title, entry.title, year, entry.year)) return null;
      if (isSeries !== undefined && isSeries !== null) {
        const entryIsSeries = entry.media_type === 'series' || Number(entry.season_count) > 0;
        const hasType = entry.media_type === 'series' || entry.media_type === 'movie' || Number(entry.season_count) > 0;
        if (hasType && entryIsSeries !== Boolean(isSeries)) return null;
      }
      const candidateTokens = titleTokens(entry.title);
      const yearBonus = normalizeYear(year) && normalizeYear(entry.year) === normalizeYear(year) ? 10 : 0;
      const exactBonus = expectedTokens.join(' ') === candidateTokens.join(' ') ? 100 : 0;
      const extraPenalty = Math.max(0, candidateTokens.length - expectedTokens.length);
      return { entry, index, score: exactBonus + yearBonus - extraPenalty };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return ranked[0]?.entry || null;
}
