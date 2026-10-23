import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  detailPathFor,
  episodeNumberOf,
  extractMediaFacets,
  filterAndSortMedia,
  formatDetailList,
  initialSeasonNumber,
  mediaArt,
  officialRatingOf,
  orderedSeasonNumbers,
  parseReleaseHints,
  seasonNumberOf,
  splitCsvList,
  summariseReleases,
} from '../src/lib/media-helpers.js';
import { ROUTES, parseRoute, watchPath } from '../src/lib/router.js';
import {
  chipsHtml,
  posterCardHtml,
  shelfHtml,
} from '../src/ui/components.js';

const STYLE_CSS = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('style.css uses @theme inline, @layer base, and never overrides button/link colors outside layers', () => {
  assert.ok(STYLE_CSS.includes('@theme inline'));
  assert.ok(STYLE_CSS.includes('@layer base'));
  assert.ok(STYLE_CSS.includes('.pill-selected'));
  assert.ok(!/color:\s*inherit/.test(STYLE_CSS));
});

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

test('MovieBox-TUI Season/Episode helpers read Rust `number` field and deduplicate cleanly', () => {
  const seasons = [
    { number: 3, episodes: [{ season: 3, number: 1 }] },
    { number: 0, episodes: [] },
    { number: 1, episodes: [{ season: 1, number: 1 }, { season: 1, number: 2 }] },
    { number: 2, episodes: [{ season: 2, number: 4 }] },
    { number: 1, episodes: [] },
  ];
  assert.equal(seasonNumberOf(seasons[0]), 3);
  assert.equal(episodeNumberOf(seasons[3].episodes[0]), 4);
  assert.deepEqual(orderedSeasonNumbers(seasons), [1, 2, 3]);
  assert.equal(initialSeasonNumber(seasons, '2'), 2);
  assert.equal(initialSeasonNumber(seasons, '99'), 1);
});

test('officialRatingOf, splitCsvList, and formatDetailList match Rust MediaDetails & TitleMeta schemas', () => {
  assert.equal(officialRatingOf({ title: 'X' }, { rating: 8.6 }), 8.6);
  assert.equal(officialRatingOf({ imdb_rating: '8.9' }, { rating: 7.5 }), 8.9);
  assert.deepEqual(splitCsvList('Timothée Chalamet, Zendaya, Rebecca Ferguson'), [
    'Timothée Chalamet',
    'Zendaya',
    'Rebecca Ferguson',
  ]);
  assert.equal(formatDetailList('2160p · 1080p'), '2160p · 1080p');
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

  const metaLookup = (it) => (it.id.value === 'm2' ? { rating: 8.7 } : null);
  const moviesOnly = filterAndSortMedia(catalog, { kind: 'movie', sort: 'rating', metaLookup });
  assert.deepEqual(moviesOnly.map((i) => i.id.value), ['m2', 'm1']);

  const decade2020s = filterAndSortMedia(catalog, { kind: 'movie', year: '2020s' });
  assert.deepEqual(decade2020s.map((i) => i.id.value), ['m1']);

  const dramaSeries = filterAndSortMedia(catalog, { kind: 'series', genre: 'Drama' });
  assert.deepEqual(dramaSeries.map((i) => i.id.value), ['s1']);

  const facets = extractMediaFacets(catalog);
  assert.ok(facets.genres.includes('Science Fiction'));
  assert.deepEqual(facets.years, ['2024', '2022', '2014']);
});

test('detailPathFor, watchPath, and summariseReleases format cleanly', () => {
  assert.equal(detailPathFor('moviebox', 'abc-1', false), '/movies/moviebox/abc-1');
  assert.equal(detailPathFor('dramachi', 'show/2', true), '/series/dramachi/show%2F2');
  assert.equal(watchPath('moviebox', 'abc-1', { season: 2, episode: 5 }), '/watch/moviebox/abc-1?s=2&e=5');
  assert.equal(
    summariseReleases([
      { quality: '2160p', size_bytes: 5_000_000_000 },
      { quality: '1080p', size_bytes: 1_500_000_000 },
    ]),
    '2160p · 1080p · 1.4 GB – 4.7 GB',
  );
});

test('PosterCard, Shelf and Chips use .pill-selected instead of stark white blocks', () => {
  const html = posterCardHtml(
    {
      id: { provider: 'moviebox', value: 'x1' },
      title: 'Dune <script>',
      year: '2024',
      media_type: 'movie',
    },
    { listed: true, metaEntry: { rating: 8.5, genres: ['Sci-Fi'] } },
  );
  assert.ok(html.includes('href="/movies/moviebox/x1"'));
  assert.ok(html.includes('Dune &lt;script&gt;'));
  assert.ok(html.includes('8.5'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('data-watchlist="1"'));
  assert.ok(html.includes('pill-selected'));
  assert.ok(!html.includes('bg-primary text-on-primary'));

  const shelf = shelfHtml({ key: 'trending', title: 'Trending now', itemsHtml: html });
  assert.ok(shelf.includes('Trending now'));
  assert.ok(shelf.includes('data-scroll="-1"'));
  assert.ok(shelf.includes('data-scroll="1"'));

  const chips = chipsHtml([{ id: 'all', label: 'All' }, { id: 'Action', label: 'Action' }], 'Action');
  assert.ok(chips.includes('aria-selected="true"'));
  assert.ok(chips.includes('pill-selected'));
  assert.ok(!chips.includes('bg-primary text-on-primary'));
});

test('parseRoute handles movie/series/watchlist/history/watch paths alongside legacy paths', () => {
  assert.ok(Array.isArray(ROUTES) && ROUTES.length >= 10);
  assert.equal(parseRoute('/movies').name, 'movies');
  assert.equal(parseRoute('/series').name, 'series');
  assert.equal(parseRoute('/watchlist').name, 'mylist');
  assert.equal(parseRoute('/mylist').name, 'mylist');
  assert.equal(parseRoute('/history').name, 'tracker');
  assert.equal(parseRoute('/tracker').name, 'tracker');
  assert.equal(parseRoute({ pathname: '/genre/Action', search: '' }).params.genre, 'Action');

  const watch = parseRoute('/watch/moviebox/101?s=1&e=3');
  assert.equal(watch.name, 'watch');
  assert.equal(watch.params.provider, 'moviebox');
  assert.equal(watch.params.id, '101');
  assert.equal(watch.query.get('s'), '1');
  assert.equal(watch.query.get('e'), '3');

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
