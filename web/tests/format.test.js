import test from 'node:test';
import assert from 'node:assert/strict';

import {
  displayUiText,
  escapeHtml,
  formatClock,
  formatRating,
  formatRuntime,
  franchiseToken,
  hashHue,
  isKnownProvider,
  isSeriesItem,
  mediaTypeLabel,
  normaliseRating,
  parseYear,
  prettySize,
  providerDotClass,
  providerLabel,
  ratingTone,
  SERVER_ROTATION,
} from '../src/lib/format.js';

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('1')">`), '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;');
});

test('provider labels map internal ids to the friendly names', () => {
  assert.equal(providerLabel('moviebox'), 'Siddharth');
  assert.equal(providerLabel('dramachi'), 'Sakshi');
  assert.equal(providerLabel('bdix_dhakaflix'), 'Everyone');
  assert.equal(providerDotClass('bdix_circleftp'), 'bdix_circleftp-dot');
  assert.equal(isKnownProvider('addons'), true);
  assert.equal(isKnownProvider('nope'), false);
  assert.deepEqual(SERVER_ROTATION.slice(0, 3), ['dramachi', 'fourkhdhub', 'moviebox']);
});

test('displayUiText rewrites provider names in copy', () => {
  assert.equal(displayUiText('MovieBox-Tui is running'), 'Ifallhub is running');
  assert.equal(displayUiText('4KHDHub link'), 'Ritu link');
  assert.equal(displayUiText('DhakaFlix (BDIX)'), 'Everyone');
});

test('prettySize formats byte counts', () => {
  assert.equal(prettySize(0), '');
  assert.equal(prettySize(512), '512 B');
  assert.equal(prettySize(1640000000), '1.5 GB');
});

test('normaliseRating accepts strings, percentages and junk', () => {
  assert.equal(normaliseRating('8.7'), 8.7);
  assert.equal(normaliseRating(87), 8.7);
  assert.equal(normaliseRating('N/A'), null);
  assert.equal(normaliseRating(''), null);
  assert.equal(formatRating(8.74), '8.7');
  assert.equal(formatRating(null), '');
});

test('ratingTone buckets scores for colour', () => {
  assert.equal(ratingTone(9), 'great');
  assert.equal(ratingTone(7), 'good');
  assert.equal(ratingTone(5.5), 'mixed');
  assert.equal(ratingTone(3), 'weak');
  assert.equal(ratingTone(null), 'unknown');
});

test('formatRuntime handles minutes, seconds and free text', () => {
  assert.equal(formatRuntime('169m'), '169m');
  assert.equal(formatRuntime(125), '2h 5m');
  assert.equal(formatRuntime(90), '1h 30m');
  assert.equal(formatRuntime(''), '');
});

test('formatClock renders h:mm:ss only when needed', () => {
  assert.equal(formatClock(75), '1:15');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(-5), '0:00');
});

test('parseYear finds a year inside noisy strings', () => {
  assert.equal(parseYear('2024'), 2024);
  assert.equal(parseYear('Movie (2011) HD'), 2011);
  assert.equal(parseYear('unknown'), null);
});

test('media type helpers read either shape', () => {
  assert.equal(isSeriesItem({ media_type: 'series' }), true);
  assert.equal(isSeriesItem({ stype: 2 }), true);
  assert.equal(isSeriesItem({ season_count: 3 }), true);
  assert.equal(mediaTypeLabel({ media_type: 'movie' }), 'Movie');
});

test('franchiseToken skips stopwords and short words', () => {
  assert.equal(franchiseToken('Dune: Part Two'), 'Dune');
  assert.equal(franchiseToken('The Batman'), 'Batman');
  assert.equal(franchiseToken('Up'), '');
});

test('hashHue is stable and within range', () => {
  const hue = hashHue('Interstellar');
  assert.equal(hue, hashHue('Interstellar'));
  assert.ok(hue >= 0 && hue < 360);
});
