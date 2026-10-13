const SRT_TIMESTAMP = /(\d{1,2}:\d{2}:\d{2}),([0-9]{1,3})/g;

function toVttTimestamp(value) {
  const match = String(value || '').trim().match(/^(\d+):(\d{2}):(\d{2})[.,]([0-9]{1,3})$/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}.${match[4].padEnd(3, '0')}`;
}

function assToVtt(text) {
  const lines = text.split('\n');
  let inEvents = false;
  let fields = [];
  const cues = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      inEvents = trimmed.toLowerCase() === '[events]';
      continue;
    }
    if (!inEvents) continue;
    if (/^format\s*:/i.test(trimmed)) {
      fields = trimmed.slice(trimmed.indexOf(':') + 1).split(',').map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(trimmed) || !fields.length) continue;

    let rest = trimmed.slice(trimmed.indexOf(':') + 1).trim();
    const values = [];
    for (let index = 0; index < fields.length - 1; index += 1) {
      const comma = rest.indexOf(',');
      if (comma < 0) break;
      values.push(rest.slice(0, comma));
      rest = rest.slice(comma + 1);
    }
    if (values.length !== fields.length - 1) continue;
    values.push(rest);

    const start = toVttTimestamp(values[fields.indexOf('start')]);
    const end = toVttTimestamp(values[fields.indexOf('end')]);
    const textIndex = fields.indexOf('text');
    if (!start || !end || textIndex < 0) continue;
    const caption = values.slice(textIndex).join(',')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
      .trim();
    if (caption) cues.push(`${start} --> ${end}\n${caption}`);
  }

  return cues.length ? `WEBVTT\n\n${cues.join('\n\n')}` : '';
}

/** Convert common MovieBox subtitle formats to browser-native WebVTT. */
export function subtitleToVtt(rawText) {
  const text = String(rawText ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('The subtitle file is empty.');
  if (/^WEBVTT(?:\s|$)/i.test(text)) return text;

  if (/^\s*\[Script Info\]/im.test(text) && /^\s*\[Events\]/im.test(text)) {
    const converted = assToVtt(text);
    if (converted) return converted;
  }

  if (!/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text)) {
    throw new Error('This subtitle format is not supported by the browser player.');
  }
  return `WEBVTT\n\n${text.replace(SRT_TIMESTAMP, (_, time, milliseconds) => `${time}.${milliseconds.padEnd(3, '0')}`)}`;
}

const LANGUAGE_TAGS = {
  ar: 'ar', ara: 'ar', arabic: 'ar',
  bn: 'bn', ben: 'bn', bengali: 'bn',
  cs: 'cs', cze: 'cs', ces: 'cs', czech: 'cs',
  da: 'da', dan: 'da', danish: 'da',
  de: 'de', ger: 'de', deu: 'de', german: 'de',
  el: 'el', gre: 'el', ell: 'el', greek: 'el',
  en: 'en', eng: 'en', english: 'en',
  es: 'es', spa: 'es', spanish: 'es',
  fa: 'fa', per: 'fa', fas: 'fa', persian: 'fa',
  fi: 'fi', fin: 'fi', finnish: 'fi',
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr',
  he: 'he', heb: 'he', hebrew: 'he',
  hi: 'hi', hin: 'hi', hindi: 'hi',
  hu: 'hu', hun: 'hu', hungarian: 'hu',
  id: 'id', ind: 'id', indonesian: 'id',
  it: 'it', ita: 'it', italian: 'it',
  ja: 'ja', jpn: 'ja', japanese: 'ja',
  ko: 'ko', kor: 'ko', korean: 'ko',
  ml: 'ml', mal: 'ml', malayalam: 'ml',
  ms: 'ms', may: 'ms', msa: 'ms', malay: 'ms',
  nl: 'nl', dut: 'nl', nld: 'nl', dutch: 'nl',
  no: 'no', nor: 'no', norwegian: 'no',
  pl: 'pl', pol: 'pl', polish: 'pl',
  pt: 'pt', por: 'pt', portuguese: 'pt',
  ru: 'ru', rus: 'ru', russian: 'ru',
  ta: 'ta', tam: 'ta', tamil: 'ta',
  te: 'te', tel: 'te', telugu: 'te',
  th: 'th', tha: 'th', thai: 'th',
  tr: 'tr', tur: 'tr', turkish: 'tr',
  ur: 'ur', urd: 'ur', urdu: 'ur',
  vi: 'vi', vie: 'vi', vietnamese: 'vi',
  zh: 'zh', chi: 'zh', zho: 'zh', chinese: 'zh',
};

// Two letter words that also happen to be ISO 639-1 codes (it, is, no, as…).
// Scanning labels like "English · OpenSubtitles · 1080p" must not match these.
const LANGUAGE_FALSE_POSITIVES = new Set([
  'in', 'is', 'it', 'as', 'no', 'on', 'to', 'of', 'at', 'be', 'do', 'if',
  'or', 'so', 'we', 'an', 'by', 'my', 'up', 'us', 'me', 'ok', 'tv', 'hd',
]);

/** ISO 639-1 tag for a picker label, e.g. `English · OpenSubtitles · 1080p` → `en`. */
export function subtitleLanguageTag(label) {
  const value = String(label || '').trim().toLowerCase();
  if (!value) return 'und';
  if (LANGUAGE_TAGS[value]) return LANGUAGE_TAGS[value];
  const exact = value.match(/^[a-z]{2,3}(?:-[a-z]{2,4})?$/);
  if (exact) return exact[0].split('-')[0];
  for (const token of value.split(/[^a-z]+/)) {
    if (!token || LANGUAGE_FALSE_POSITIVES.has(token)) continue;
    if (LANGUAGE_TAGS[token]) return LANGUAGE_TAGS[token];
  }
  return 'und';
}

/** Language tag an engine/provider option reports, falling back to its label. */
function optionLanguageTag(option) {
  const reported = String(option?.language || '').trim().toLowerCase();
  if (reported && reported !== 'und') return reported;
  return subtitleLanguageTag(option?.name);
}

/**
 * The caption to turn on automatically: the first option in `preferred` order
 * (English by default), otherwise the first option the providers returned.
 */
export function pickAutomaticSubtitle(options, preferred = ['en', 'eng', 'english', 'hi']) {
  const list = (Array.isArray(options) ? options : []).filter(Boolean);
  if (!list.length) return null;
  for (const want of preferred) {
    const match = list.find((option) => {
      const tag = optionLanguageTag(option);
      return tag === want || tag.startsWith(`${want}-`) || tag.startsWith(`${want}_`);
    });
    if (match) return match;
  }
  return list[0];
}
