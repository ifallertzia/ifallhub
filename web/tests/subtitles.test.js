import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pickAutomaticSubtitle,
  subtitleLanguageTag,
  subtitleToVtt,
} from '../src/player/subtitles.js';

test('subtitleToVtt converts UTF-8 SRT timestamps and preserves cue text', () => {
  const source = '\uFEFF1\r\n00:00:01,050 --> 00:00:03,200\r\nHello, world!\r\n';
  assert.equal(
    subtitleToVtt(source),
    'WEBVTT\n\n1\n00:00:01.050 --> 00:00:03.200\nHello, world!',
  );
});

test('subtitleToVtt leaves WebVTT cues intact', () => {
  const source = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nCaption';
  assert.equal(subtitleToVtt(source), source);
});

test('subtitleToVtt converts basic ASS dialogue and formatting tags', () => {
  const source = [
    '[Script Info]',
    'Title: Example',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.23,0:00:02.50,Default,,0,0,0,,{\\i1}Namaste!\\NWelcome',
  ].join('\n');
  assert.equal(
    subtitleToVtt(source),
    'WEBVTT\n\n00:00:01.230 --> 00:00:02.500\nNamaste!\nWelcome',
  );
});

test('subtitleToVtt rejects empty and unsupported files', () => {
  assert.throws(() => subtitleToVtt('  '), /empty/);
  assert.throws(() => subtitleToVtt('<html>not a subtitle</html>'), /not supported/);
});

test('subtitleLanguageTag maps common language names and codes', () => {
  assert.equal(subtitleLanguageTag('English'), 'en');
  assert.equal(subtitleLanguageTag('Hindi'), 'hi');
  // Three letter codes fold onto their ISO 639-1 tag, which browsers accept.
  assert.equal(subtitleLanguageTag('eng'), 'en');
  assert.equal(subtitleLanguageTag('Unknown caption'), 'und');
});

test('subtitle language tags are detected inside provider labels', () => {
  assert.equal(subtitleLanguageTag('English · OpenSubtitles · 1080p WEB-DL'), 'en');
  assert.equal(subtitleLanguageTag('English [SDH] · Podnapisi · WEB'), 'en');
  assert.equal(subtitleLanguageTag('Hindi · Wyzie · 1080p'), 'hi');
  assert.equal(subtitleLanguageTag('hindi'), 'hi');
  assert.equal(subtitleLanguageTag('eng'), 'en');
  assert.equal(subtitleLanguageTag('English'), 'en');
  // Two letter words that are also language codes must not win.
  assert.equal(subtitleLanguageTag('Movie 2024 IT release'), 'und');
  assert.equal(subtitleLanguageTag('The Best Of It'), 'und');
  assert.equal(subtitleLanguageTag(''), 'und');
});

test('automatic subtitles prefer english, then the first result', () => {
  const options = [
    { index: 0, name: 'Hindi · Wyzie · 1080p', language: 'hi' },
    { index: 1, name: 'French · Podnapisi', language: 'fr' },
    { index: 2, name: 'English · OpenSubtitles · 1080p', language: 'en' },
  ];
  assert.equal(pickAutomaticSubtitle(options).index, 2);
  assert.equal(pickAutomaticSubtitle(options, ['hi']).index, 0);
  // Language carried only inside the label still counts.
  assert.equal(
    pickAutomaticSubtitle([{ index: 4, name: 'English [SDH] · Podnapisi · WEB' }]).index,
    4,
  );
  // No English available: keep the first provider result.
  assert.equal(pickAutomaticSubtitle([{ index: 7, name: 'Tamil · Wyzie' }]).index, 7);
  assert.equal(pickAutomaticSubtitle([]), null);
  assert.equal(pickAutomaticSubtitle(null), null);
});
