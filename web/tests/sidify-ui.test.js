import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detailPathFor,
  externalPlayerLinks,
  extractMediaFacets,
  filterAndSortMedia,
  initialSeasonNumber,
  mediaArt,
  orderedSeasonNumbers,
  parseReleaseHints,
  safeDownloadFilename,
  summariseReleases,
} from '../src/lib/media-helpers.js';
import { ROUTES, parseRoute } from '../src/lib/router.js';
import {
  chipsHtml,
  posterCardHtml,
  shelfHtml,
} from '../src/ui/components.js';

test('mediaArt builds deterministic SVG poster and backdrop data URIs', () => {
  const posterA = mediaArt('Dune: Part Two', '2024', 'movie', 'poster');
  const posterB = mediaArt('Dune: Part Two', '2024', 'movie', 'poster');
  const backdrop = mediaArt('Severance', '2022', 'series', 'backdrop');

  assert.equal(posterA, posterB);
  assert.match(posterA, /^data:image\/svg\+xml;utf8,/);
  assert.match(decodeURIComponent(posterA), /FILM · 2024/);
  assert.match(decodeURIComponent(backdrop), /viewBox='0 0 1280 720'/);
});

test('parseReleaseHints extracts container, codec, HDR, bit-depth and Dolby/DTS risk', () => {
  const uhd = parseReleaseHints('Dune.Part.Two.2024.2160p.UHD.DV.HDR10.DDP5.1.H.265.mkv');
  assert.equal(uhd.container, 'MKV');
  assert.equal(uhd.codec, 'HEVC');
  assert.equal(uhd.bitDepth, '10-bit');
  assert.equal(uhd.hdr, 'DV');
  assert.equal(uhd.audio, 'DDP');
  assert.equal(uhd.browserAudioRisk, true);

  const web = parseReleaseHints('Interstellar.2014.1080p.WEB-DL.AAC2.0.H.264.mp4');
  assert.equal(web.container, 'MP4');
  assert.equal(web.codec, 'H.264');
  assert.equal(web.audio, 'AAC');
  assert.equal(web.browserAudioRisk, false);
});

test('orderedSeasonNumbers deduplicates and sorts positive seasons only', () => {
  const seasons = [
    { season_number: 3 },
    { season_number: 0 },
    { season_number: 1 },
    { season_number: 2 },
    { season_number: 1 },
  ];
  assert.deepEqual(orderedSeasonNumbers(seasons), [1, 2, 3]);
  assert.equal(initialSeasonNumber(seasons, '2'), 2);
  assert.equal(initialSeasonNumber(seasons, '99'), 1);
});

test('filterAndSortMedia filters by kind, genre, decade/year and sorts cleanly', () => {
  const catalog = [
    {
      id: { provider: 'moviebox', value: 'm1' },
      title: 'Dune: Part Two',
      year: '2024',
      media_type: 'movie',
      imdb_rating: '8.5',
      genres: ['Science Fiction', 'Adventure'],
    },
    {
      id: { provider: 'moviebox', value: 'm2' },
      title: 'Interstellar',
      year: '2014',
      media_type: 'movie',
      imdb_rating: '8.7',
      genres: ['Science Fiction', 'Drama'],
    },
    {
      id: { provider: 'moviebox', value: 's1' },
      title: 'Severance',
      year: '2022',
      media_type: 'series',
      imdb_rating: '8.7',
      genres: ['Drama', 'Mystery'],
    },
  ];

  const moviesOnly = filterAndSortMedia(catalog, { kind: 'movie', sort: 'rating' });
  assert.deepEqual(moviesOnly.map((i) => i.id.value), ['m2', 'm1']);

  const decade2020s = filterAndSortMedia(catalog, { kind: 'movie', year: '2020s' });
  assert.deepEqual(decade2020s.map((i) => i.id.value), ['m1']);

  const dramaSeries = filterAndSortMedia(catalog, { kind: 'series', genre: 'Drama' });
  assert.deepEqual(dramaSeries.map((i) => i.id.value), ['s1']);

  const facets = extractMediaFacets(catalog);
  assert.ok(facets.genres.includes('Science Fiction'));
  assert.deepEqual(facets.years, ['2024', '2022', '2014']);
});

test('externalPlayerLinks builds platform-appropriate VLC/IINA schemes', () => {
  const url = 'https://ifallhub.test/api/media/token/video.mkv';
  const android = externalPlayerLinks(url, 'Dune', 'android');
  assert.match(android[0].href, /^intent:\/\/ifallhub\.test\/api\/media\/token\/video\.mkv#Intent;scheme=https;package=org\.videolan\.vlc/);

  const ios = externalPlayerLinks(url, 'Dune', 'ios');
  assert.match(ios[0].href, /^vlc-x-callback:\/\/x-callback-url\/stream\?url=/);

  const mac = externalPlayerLinks(url, 'Dune', 'mac');
  assert.match(mac[0].href, /^iina:\/\/weblink\?url=/);
});

test('detailPathFor, safeDownloadFilename and summariseReleases format cleanly', () => {
  assert.equal(detailPathFor('moviebox', 'abc-1', false), '/movies/moviebox/abc-1');
  assert.equal(detailPathFor('dramachi', 'show/2', true), '/series/dramachi/show%2F2');
  assert.equal(safeDownloadFilename('Dune: Part Two', '2024', '1080p', 'Dune.mkv'), 'Dune Part Two (2024) 1080p.mkv');
  assert.equal(
    summariseReleases([
      { quality: '2160p', size_bytes: 5_000_000_000 },
      { quality: '1080p', size_bytes: 1_500_000_000 },
    ]),
    '2160p · 1080p · 1.4 GB – 4.7 GB',
  );
});

test('Sidify-V2 PosterCard, Shelf and Chips render escaped semantic markup', () => {
  const html = posterCardHtml(
    {
      id: { provider: 'moviebox', value: 'x1' },
      title: 'Dune <script>',
      year: '2024',
      media_type: 'movie',
      imdb_rating: '8.5',
    },
    { listed: true },
  );
  assert.ok(html.includes('href="/movies/moviebox/x1"'));
  assert.ok(html.includes('Dune &lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('data-watchlist="1"'));

  const shelf = shelfHtml({ key: 'trending', title: 'Trending now', itemsHtml: html });
  assert.ok(shelf.includes('Trending now'));
  assert.ok(shelf.includes('data-scroll="-1"'));
  assert.ok(shelf.includes('data-scroll="1"'));

  const chips = chipsHtml([{ id: 'all', label: 'All' }, { id: 'Action', label: 'Action' }], 'Action');
  assert.ok(chips.includes('aria-selected="true"'));
});

test('parseRoute handles Sidify-V2 movie/series/watchlist/history paths alongside legacy paths', () => {
  assert.ok(Array.isArray(ROUTES) && ROUTES.length >= 10);
  assert.equal(parseRoute('/movies').name, 'movies');
  assert.equal(parseRoute('/series').name, 'series');
  assert.equal(parseRoute('/watchlist').name, 'mylist');
  assert.equal(parseRoute('/mylist').name, 'mylist');
  assert.equal(parseRoute('/history').name, 'tracker');
  assert.equal(parseRoute('/tracker').name, 'tracker');
  assert.equal(parseRoute({ pathname: '/genre/Action', search: '' }).params.genre, 'Action');

  const movieDetail = parseRoute('/movies/moviebox/101');
  assert.equal(movieDetail.name, 'details');
  assert.equal(movieDetail.params.provider, 'moviebox');
  assert.equal(movieDetail.params.id, '101');

  const seriesDetail = parseRoute('/series/dramachi/999?season=2');
  assert.equal(seriesDetail.name, 'details');
  assert.equal(seriesDetail.params.provider, 'dramachi');
  assert.equal(seriesDetail.params.id, '999');
  assert.equal(seriesDetail.query.get('season'), '2');

  const legacyTitle = parseRoute('/title/fourkhdhub/55');
  assert.equal(legacyTitle.name, 'details');
  assert.equal(legacyTitle.params.provider, 'fourkhdhub');
  assert.equal(legacyTitle.params.id, '55');
});
