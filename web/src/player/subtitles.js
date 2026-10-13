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

export function subtitleLanguageTag(label) {
  const value = String(label || '').trim().toLowerCase();
  const known = {
    arabic: 'ar', bengali: 'bn', chinese: 'zh', dutch: 'nl', english: 'en', french: 'fr',
    german: 'de', hindi: 'hi', indonesian: 'id', italian: 'it', japanese: 'ja', korean: 'ko',
    malay: 'ms', persian: 'fa', polish: 'pl', portuguese: 'pt', russian: 'ru', spanish: 'es',
    tamil: 'ta', telugu: 'te', thai: 'th', turkish: 'tr', urdu: 'ur', vietnamese: 'vi',
  };
  if (known[value]) return known[value];
  const code = value.match(/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i);
  return code ? code[0].toLowerCase() : 'und';
}
