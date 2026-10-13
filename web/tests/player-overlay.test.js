import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PLAYER_LAYOUT,
  PLAYER_CONTROL_IDS,
  PLAYER_REGIONS,
  formatPlayerTime,
} from '../src/player/overlay.js';

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
