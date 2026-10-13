import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import {
  DEFAULT_PLAYER_LAYOUT,
  PLAYER_CONTROL_IDS,
  PLAYER_REGIONS,
  formatPlayerTime,
  usesCompactBar,
} from '../src/player/overlay.js';

const STYLE_SHEET = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('player time uses mm:ss and switches to hh:mm:ss for long media', () => {
  assert.equal(formatPlayerTime(0), '0:00');
  assert.equal(formatPlayerTime(91), '1:31');
  assert.equal(formatPlayerTime(3599), '59:59');
  assert.equal(formatPlayerTime(3600), '01:00:00');
  assert.equal(formatPlayerTime(3661), '01:01:01');
  assert.equal(formatPlayerTime(-10), '0:00');
});

test('player layout defines the seven configurable regions and supported controls', () => {
  assert.deepEqual(Object.keys(DEFAULT_PLAYER_LAYOUT), PLAYER_REGIONS);
  for (const region of PLAYER_REGIONS) {
    assert.ok(Array.isArray(DEFAULT_PLAYER_LAYOUT[region]), `${region} should have a default layout`);
    for (const control of DEFAULT_PLAYER_LAYOUT[region]) {
      assert.ok(PLAYER_CONTROL_IDS.includes(control), `${control} should be configurable`);
    }
  }
});

test('default layout has no duplicate controls within either orientation', () => {
  for (const orientation of ['landscape', 'portrait']) {
    const ids = PLAYER_REGIONS
      .filter((region) => region.startsWith(`${orientation}.`))
      .flatMap((region) => DEFAULT_PLAYER_LAYOUT[region]);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test('phones use the compact bar, desktops keep the full control set', () => {
  assert.equal(usesCompactBar(390, true), true); // phone portrait
  assert.equal(usesCompactBar(740, true), true); // phone landscape
  assert.equal(usesCompactBar(900, true), true); // small touch screen
  assert.equal(usesCompactBar(900, false), false); // desktop window at 900px
  assert.equal(usesCompactBar(1440, false), false);
  assert.equal(usesCompactBar(0, false), false);
});

test('the compact phone bar hides every control except play/pause and fullscreen', () => {
  for (const region of [
    'landscape.top-right',
    'portrait.top-right',
    'landscape.bottom-left',
    'landscape.bottom-right',
    'portrait.bottom',
  ]) {
    assert.ok(
      STYLE_SHEET.includes(`.player-overlay[data-compact="true"] .player-region[data-region="${region}"]`),
      `${region} should be hidden in the compact bar`,
    );
  }
  assert.ok(STYLE_SHEET.includes('.player-overlay[data-compact="true"] .player-center-transport'));
  assert.ok(STYLE_SHEET.includes('.player-overlay[data-compact="true"] .player-transport-previous'));
  assert.ok(STYLE_SHEET.includes('.player-overlay[data-compact="true"] .player-skip-button'));
  assert.ok(STYLE_SHEET.includes('.player-transport-fullscreen'));
  assert.ok(STYLE_SHEET.includes('.player-overlay[data-fullscreen="true"]'));
  assert.ok(STYLE_SHEET.includes('.player-overlay[data-fullscreen="true"][data-orientation="portrait"] .player-region[data-region="portrait.bottom"]'));
  assert.ok(STYLE_SHEET.includes('.video-frame.is-fullscreen-fallback'));
});
