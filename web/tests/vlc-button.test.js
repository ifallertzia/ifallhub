import test from 'node:test';
import assert from 'node:assert/strict';
import {
  absolutePlaybackUrl,
  clearPlayerSupportCache,
  copyPlaybackUrlOrResolve,
  copyStreamLink,
  describeOpenResult,
  isPlayerUnavailable,
  loadPlayerSupport,
  openStreamExternally,
  playerButtonLabel,
} from '../src/ui/vlc-button.js';

const origin = 'https://ifallhub.test';

function setup(t, { clipboard, fetchImpl } = {}) {
  const previous = {};
  const overrides = {
    document: {},
    navigator: { clipboard: clipboard || { writeText: async () => {} } },
    // The browser always has one; the module builds absolute media URLs with it.
    window: { location: { origin } },
    fetch: fetchImpl,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    clearPlayerSupportCache();
  });
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

test('playerButtonLabel names the engine default player', () => {
  assert.equal(
    playerButtonLabel({
      default: 'mpv',
      players: [
        { id: 'vlc', label: 'VLC' },
        { id: 'mpv', label: 'MPV' },
      ],
    }),
    'Open in MPV',
  );
  // No engine answer yet: the button keeps the VLC wording.
  assert.equal(playerButtonLabel(null), 'Open in VLC');
  assert.equal(playerButtonLabel({ players: [{ id: 'vlc', label: 'VLC' }] }), 'Open in VLC');
});

test('absolutePlaybackUrl resolves engine-relative media routes', () => {
  assert.equal(
    absolutePlaybackUrl({ playback_url: '/api/media/token/https/cdn.test/movie.mkv?x=1' }, origin),
    `${origin}/api/media/token/https/cdn.test/movie.mkv?x=1`,
  );
  assert.equal(absolutePlaybackUrl({ playback_url: 'https://cdn.test/a.mp4' }, origin), 'https://cdn.test/a.mp4');
  assert.equal(absolutePlaybackUrl({ playback_url: '' }, origin), '');
  // Unresolvable without an origin, and non-HTTP schemes are refused.
  assert.equal(absolutePlaybackUrl({ playback_url: '/api/media/token/x' }, ''), '');
});

test('describeOpenResult explains every outcome', () => {
  assert.deepEqual(describeOpenResult({ opened: true, label: 'VLC' }), {
    kind: 'success',
    message: 'VLC is opening on this computer.',
  });
  assert.match(describeOpenResult({ opened: false, copied: true }).message, /Link copied/);
  assert.equal(describeOpenResult({ opened: false, error: 'Boom' }).message, 'Boom');
  assert.match(describeOpenResult({}).message, /Could not open/);
});

test('isPlayerUnavailable only treats "no player here" as a fallback', () => {
  assert.equal(isPlayerUnavailable({ status: 409, payload: { available: false } }), true);
  assert.equal(isPlayerUnavailable({ status: 404 }), true);
  assert.equal(isPlayerUnavailable({ status: 502, payload: { error: 'resolver failed' } }), false);
  assert.equal(isPlayerUnavailable(null), false);
});

test('loadPlayerSupport treats a missing route as an unavailable player', async (t) => {
  setup(t, {
    fetchImpl: async () => jsonResponse({ error: 'Unknown API route' }, 404),
  });
  const support = await loadPlayerSupport();
  assert.equal(support.available, false);
  assert.deepEqual(support.players, []);
  assert.match(support.reason, /cannot open external players/);
});

test('openStreamExternally launches the player the engine reports', async (t) => {
  const calls = [];
  setup(t, {
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
      if (url === '/api/player') {
        return jsonResponse({
          available: true,
          players: [{ id: 'vlc', label: 'VLC' }],
          default: 'vlc',
        });
      }
      return jsonResponse({ ok: true, label: 'VLC', url: 'http://127.0.0.1:8787/api/media/t/video.mkv' });
    },
  });

  const result = await openStreamExternally({
    streamSetId: 'set-1',
    releaseIndex: 3,
    resumeSeconds: 128.6,
  });

  assert.deepEqual(result, {
    opened: true,
    label: 'VLC',
    url: 'http://127.0.0.1:8787/api/media/t/video.mkv',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, '/api/player/open');
  assert.deepEqual(calls[1].body, {
    stream_set_id: 'set-1',
    release_index: 3,
    mirror_index: 0,
    resume_seconds: 129,
  });
});

test('openStreamExternally copies the link when no local player exists', async (t) => {
  const written = [];
  const calls = [];
  setup(t, {
    clipboard: { writeText: async (value) => written.push(value) },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
      if (url === '/api/player') {
        return jsonResponse({
          available: false,
          players: [],
          reason: 'No VLC, mpv or IINA is installed on this machine.',
        });
      }
      if (url === '/api/play') {
        return jsonResponse({ playback_url: '/api/media/token/https/cdn.test/movie.mkv' });
      }
      throw new Error(`unexpected call: ${url}`);
    },
  });

  const result = await openStreamExternally({ streamSetId: 'set-2', releaseIndex: 0 });

  assert.equal(result.opened, false);
  assert.equal(result.copied, true);
  assert.match(result.reason, /No VLC/);
  assert.deepEqual(written, [`${origin}/api/media/token/https/cdn.test/movie.mkv`]);
  // The launch route is never called once the engine says it has no player.
  assert.deepEqual(
    calls.map((call) => call.url),
    ['/api/player', '/api/play'],
  );
});

test('openStreamExternally surfaces resolution errors instead of copying', async (t) => {
  const written = [];
  setup(t, {
    clipboard: { writeText: async (value) => written.push(value) },
    fetchImpl: async (url) => {
      if (url === '/api/player') {
        return jsonResponse({ available: true, players: [{ id: 'vlc', label: 'VLC' }], default: 'vlc' });
      }
      return jsonResponse({ error: '4KHDHub stream resolution timed out' }, 502);
    },
  });

  const result = await openStreamExternally({ streamSetId: 'set-3', releaseIndex: 1 });

  assert.equal(result.opened, false);
  assert.equal(result.copied, undefined);
  assert.equal(result.error, '4KHDHub stream resolution timed out');
  assert.deepEqual(written, []);
});

test('openStreamExternally waits for the stream list', async (t) => {
  setup(t, { fetchImpl: async () => jsonResponse({ available: true, players: [] }) });
  const result = await openStreamExternally({ streamSetId: '', releaseIndex: 0 });
  assert.equal(result.opened, false);
  assert.match(result.error, /still loading/);
});

test('copyStreamLink resolves and copies the playback URL', async (t) => {
  const written = [];
  setup(t, {
    clipboard: { writeText: async (value) => written.push(value) },
    fetchImpl: async (url) => {
      assert.equal(url, '/api/play');
      return jsonResponse({ playback_url: '/api/media/token/https/cdn.test/movie.mkv' });
    },
  });

  const link = await copyStreamLink({ streamSetId: 'set-4', releaseIndex: 2, mirrorIndex: 1 });

  assert.equal(link, `${origin}/api/media/token/https/cdn.test/movie.mkv`);
  assert.equal(written.length, 1);
});

test('copyPlaybackUrlOrResolve copies the playing link without a new session', async (t) => {
  const written = [];
  setup(t, {
    clipboard: { writeText: async (value) => written.push(value) },
    fetchImpl: async (url) => {
      throw new Error(`unexpected call: ${url}`);
    },
  });

  const link = await copyPlaybackUrlOrResolve({ url: '/api/media/token/https/cdn.test/movie.mkv?x=1' });

  assert.equal(link, `${origin}/api/media/token/https/cdn.test/movie.mkv?x=1`);
  assert.deepEqual(written, [link]);
});

test('copyPlaybackUrlOrResolve falls back to resolving a release', async (t) => {
  const written = [];
  const calls = [];
  setup(t, {
    clipboard: { writeText: async (value) => written.push(value) },
    fetchImpl: async (url) => {
      calls.push(url);
      return jsonResponse({ playback_url: '/api/media/token/https/cdn.test/movie.mkv' });
    },
  });

  const link = await copyPlaybackUrlOrResolve({ url: '', streamSetId: 'set-9', releaseIndex: 4 });

  assert.equal(link, `${origin}/api/media/token/https/cdn.test/movie.mkv`);
  assert.deepEqual(calls, ['/api/play']);
  assert.deepEqual(written, [link]);
});

test('copyPlaybackUrlOrResolve reports nothing when no link resolves', async (t) => {
  setup(t, {
    clipboard: { writeText: async () => {} },
    fetchImpl: async () => jsonResponse({ error: 'stream set expired' }, 410),
  });

  assert.equal(await copyPlaybackUrlOrResolve({ url: '', streamSetId: 'gone' }), '');
});
