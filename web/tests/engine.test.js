import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ERROR_KINDS,
  buildAttempts,
  buildStreamEntry,
  describeMediaError,
  describeShakaError,
  isExpiredLinkError,
  matchReleaseIndex,
  pickBestMatch,
  rotationAfter,
  scoreRelease,
  sortReleases,
  unsupportedReason,
} from '../src/player/engine.js';
import { apiUrl } from '../src/lib/api.js';
import { prepareSearchQuery, releaseTitleMatches, titlesMatch } from '../src/player/title-match.js';

const hevcRelease = {
  provider: 'moviebox',
  filename: 'Inception 1080p h265',
  quality: '1080p',
  codec: 'h265',
  mirrors: [{ label: '1080p h265', direct_file: true }],
};

const h264Release = {
  provider: 'moviebox',
  filename: 'Inception 1080p',
  quality: '1080p',
  codec: 'h264',
  mirrors: [{ label: '1080p', direct_file: true }],
};

const mkvRelease = {
  provider: 'fourkhdhub',
  filename: 'Inception.2010.2160p.WEB-DL.x265.mkv',
  quality: '2160p',
  mirrors: [{ label: 'R2', direct_file: true }],
};

test('unsupportedReason flags HEVC releases and unsafe containers', () => {
  assert.equal(unsupportedReason(hevcRelease), 'codec');
  assert.equal(unsupportedReason({ codec: 'hevc' }), 'codec');
  assert.equal(unsupportedReason({ filename: 'Movie.2024.1080p.x265.mkv' }), 'container');
  assert.equal(unsupportedReason({ filename: 'Movie.2024.1080p.WEB-DL.mkv' }), 'container');
  assert.equal(unsupportedReason(h264Release), '');
  assert.equal(unsupportedReason({ filename: 'Inception.2010.1080p.BluRay.mp4', codec: 'avc1' }), '');
  assert.equal(unsupportedReason({}), '');
  // "h265" inside a normal word must not trip the matcher.
  assert.equal(unsupportedReason({ filename: 'The Aviator 2004 1080p' }), '');
});

test('scoreRelease pushes browser-unplayable releases behind playable ones', () => {
  // Same provider: 2160p HEVC loses to a playable 1080p release.
  const playable1080 = { ...h264Release, provider: 'fourkhdhub' };
  assert.ok(scoreRelease(hevcRelease, 'moviebox') > scoreRelease(h264Release, 'moviebox'));
  assert.ok(scoreRelease(mkvRelease, 'fourkhdhub') > scoreRelease(playable1080, 'fourkhdhub'));
  // A supported codec (even at a lower resolution) outranks HEVC at 4K.
  const hevc4k = { provider: 'fourkhdhub', quality: '2160p', codec: 'hevc', mirrors: [{}] };
  assert.ok(scoreRelease(hevc4k, 'fourkhdhub') > scoreRelease({ ...playable1080, quality: '720p' }, 'fourkhdhub'));
});

test('sortReleases keeps provider order and prefers playable codecs', () => {
  const sorted = sortReleases([hevcRelease, h264Release], 'moviebox');
  assert.equal(sorted[0].codec, 'h264');

  const mixed = sortReleases(
    [
      { provider: 'moviebox', quality: '1080p', codec: 'h264', mirrors: [{}] },
      { provider: 'dramachi', quality: '1080p', codec: 'h265', mirrors: [{}] },
    ],
    'moviebox',
  );
  // Dramachi is earlier in SERVER_ROTATION, so it still wins its slot.
  assert.equal(mixed[0].provider, 'dramachi');
});

test('buildAttempts starts on the release the UI selected and walks mirrors', () => {
  const releases = [
    { quality: '1080p', mirrors: [{}, {}] },
    { quality: '720p', mirrors: [{}] },
  ];
  assert.deepEqual(buildAttempts(releases, 1), [
    { releaseIndex: 1, mirrorIndex: 0 },
    { releaseIndex: 0, mirrorIndex: 0 },
    { releaseIndex: 0, mirrorIndex: 1 },
  ]);
});

test('buildStreamEntry keeps the API index so /api/play stays correct', () => {
  const response = {
    stream_set_id: 'set-1',
    releases: [hevcRelease, { ...h264Release, mirrors: [{}] }],
  };
  const entry = buildStreamEntry('moviebox', { id: 'moviebox:1' }, response);
  assert.equal(entry.streamSetId, 'set-1');
  assert.equal(entry.releases[0].codec, 'h264');
  // The HEVC release keeps its original server index for the play request.
  assert.equal(entry.releases[1].serverIndex, 0);
  assert.equal(entry.releases[0].serverIndex, 1);
});

test('describeShakaError turns Shaka codes into actionable messages', () => {
  const codec = describeShakaError({ code: 4032, severity: 2, message: 'Unsupported by browser' });
  assert.equal(codec.kind, ERROR_KINDS.codec);
  assert.equal(codec.name, 'PlaybackError');

  const forbidden = describeShakaError({ code: 1001, severity: 2, data: [403, 'https://cdn.example/s/index.mpd'] });
  assert.equal(forbidden.kind, ERROR_KINDS.http);
  assert.equal(forbidden.status, 403);

  const gone = describeShakaError({ code: 1001, severity: 2, data: [410, 'https://cdn.example/s/index.mpd'] });
  assert.equal(gone.status, 410);
  assert.equal(isExpiredLinkError(gone), true);

  const server = describeShakaError({ code: 1001, severity: 2, data: [503, 'https://cdn.example/s/seg.m4s'] });
  assert.equal(server.kind, ERROR_KINDS.http);
  assert.match(server.message, /HTTP 503/);

  const network = describeShakaError({ code: 1002, severity: 2, data: [0, 'https://cdn.example/s/seg.m4s'] });
  assert.equal(network.kind, ERROR_KINDS.network);

  const unknown = describeShakaError({ code: 9999, severity: 2, message: 'weird' });
  assert.equal(unknown.kind, ERROR_KINDS.unknown);
  assert.match(unknown.message, /weird/);
});

test('describeMediaError maps <video> MediaError codes', () => {
  assert.equal(describeMediaError({ error: { code: 4, message: '' } }).kind, ERROR_KINDS.codec);
  assert.equal(describeMediaError({ error: { code: 3, message: '' } }).kind, ERROR_KINDS.codec);
  assert.equal(describeMediaError({ error: { code: 2, message: '' } }).kind, ERROR_KINDS.network);
  assert.equal(describeMediaError({ error: { code: 1, message: '' } }).kind, ERROR_KINDS.unknown);
  assert.match(describeMediaError({ error: { code: 4, message: '' } }).message, /mkv|H\.265/);
  assert.equal(describeMediaError(null).kind, ERROR_KINDS.unknown);
});

test('isExpiredLinkError catches 403/410 and expired copy', () => {
  assert.equal(isExpiredLinkError({ status: 403 }), true);
  assert.equal(isExpiredLinkError({ status: 410 }), true);
  assert.equal(isExpiredLinkError({ message: 'Stream list expired. Refresh the stream list and try again.' }), true);
  assert.equal(isExpiredLinkError({ status: 502, message: 'upstream failed' }), false);
  assert.equal(isExpiredLinkError(null), false);
});

test('matchReleaseIndex keeps the user pick after a refresh', () => {
  const fresh = [
    { filename: 'Inception 720p', quality: '720p' },
    { filename: 'Inception 1080p', quality: '1080p' },
  ];
  assert.equal(matchReleaseIndex(fresh, { filename: 'Inception 1080p', quality: '1080p' }), 1);
  assert.equal(matchReleaseIndex(fresh, { filename: 'Inception 1080p h265', quality: '1080p' }), 1);
  assert.equal(matchReleaseIndex(fresh, { filename: 'Gone 480p', quality: '480p' }), 0);
  assert.equal(matchReleaseIndex([], undefined), 0);
});

test('fallback search sanitizes language suffixes and appends the known year', () => {
  assert.equal(prepareSearchQuery('Drishyam 2 [Hindi]', '2022'), 'Drishyam 2 2022');
  assert.equal(prepareSearchQuery('Drishyam 2 (Hindi Dubbed)', '2022'), 'Drishyam 2 2022');
  assert.equal(prepareSearchQuery('Dune: Part Two (2024)', '2024'), 'Dune: Part Two 2024');
});

test('search and expected-title API parameters are safely URL-encoded', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: 'https://ifallhub.test' } };
  try {
    const searchRoute = apiUrl('/api/search', {
      q: prepareSearchQuery('Drishyam 2 [Hindi]', '2022'),
      provider: 'fourkhdhub',
    });
    const streamsRoute = apiUrl('/api/streams', {
      provider: 'fourkhdhub',
      id: '/drishyam-2/',
      expected_title: 'Drishyam 2 [Hindi]',
      expected_year: '2022',
    });
    const subtitlesRoute = apiUrl('/api/subtitles', {
      title: 'Dune: Part Two',
      year: '2024',
      season: 1,
      episode: 2,
    });
    const subtitleFileRoute = apiUrl('/api/subtitle-file', { set_id: 'abc123', index: 1 });
    assert.equal(new URL(searchRoute, globalThis.window.location.origin).searchParams.get('q'), 'Drishyam 2 2022');
    assert.equal(new URL(streamsRoute, globalThis.window.location.origin).searchParams.get('expected_title'), 'Drishyam 2 [Hindi]');
    assert.equal(new URL(subtitlesRoute, globalThis.window.location.origin).searchParams.get('title'), 'Dune: Part Two');
    assert.equal(new URL(subtitlesRoute, globalThis.window.location.origin).searchParams.get('episode'), '2');
    assert.equal(new URL(subtitleFileRoute, globalThis.window.location.origin).searchParams.get('index'), '1');
    assert.match(streamsRoute, /expected_title=Drishyam\+2\+%5BHindi%5D/u);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('fallback title selection rejects a shared sequel number and has no first-result fallback', () => {
  const unrelated = {
    id: { provider: 'fourkhdhub', value: '/cabin-fever-2/' },
    title: 'Cabin Fever 2 Spring Fever',
    media_type: 'movie',
    year: '2009',
  };
  const matching = {
    id: { provider: 'fourkhdhub', value: '/drishyam-2/' },
    title: 'Drishyam 2 [Hindi]',
    media_type: 'movie',
    year: '2022',
  };

  assert.equal(pickBestMatch([unrelated], 'Drishyam 2 [Hindi]', '2022', false), null);
  assert.equal(
    pickBestMatch([unrelated, matching], 'Drishyam 2 [Hindi]', '2022', false),
    matching,
  );
  assert.equal(titlesMatch('Drishyam 2', 'Cabin Fever 2 Spring Fever', '2022', '2009'), false);
  assert.equal(titlesMatch('Drishyam 2', 'Drishyam 2 (2022)', '2022', '2022'), true);
});

test('release filenames are checked before scraper streams are accepted', () => {
  assert.equal(
    releaseTitleMatches(
      'Drishyam 2 [Hindi]',
      'Cabin.Fever.2.Spring.Fever.2009.1080p.WEB-DL.mkv',
      '2022',
    ),
    false,
  );
  assert.equal(
    releaseTitleMatches('Drishyam 2', 'Drishyam.2.2022.1080p.WEB-DL.H.264.mkv', '2022'),
    true,
  );
  assert.equal(releaseTitleMatches('Drishyam 2', '1080p WEB-DL H.264', '2022'), null);
});

test('rotationAfter still wraps every server into the order', () => {
  const order = rotationAfter('moviebox');
  assert.equal(order.length, 6);
  assert.equal(order[order.length - 1], 'moviebox');
});
