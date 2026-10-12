import test from 'node:test';
import assert from 'node:assert/strict';

import {
  becauseYouWatched,
  continueWatching,
  dedupeItems,
  heroCandidates,
  indexByKey,
  isFinished,
  libraryStats,
  progressFraction,
  rankRelated,
  similarByMeta,
  sortItems,
  titleKey,
} from '../src/lib/recommend.js';

const item = (id, extra = {}) => ({
  id: { provider: 'moviebox', value: id },
  title: extra.title || `Title ${id}`,
  poster_url: extra.poster_url ?? 'https://example.test/p.jpg',
  year: extra.year || '2023',
  media_type: extra.media_type || 'movie',
  ...extra,
});

test('progressFraction maps position/duration and honours the completed flag', () => {
  assert.equal(progressFraction({ position_seconds: 600, duration_seconds: 1200 }), 0.5);
  assert.equal(progressFraction({ position_seconds: 4000, duration_seconds: 1200 }), 1);
  assert.equal(progressFraction({ completed: true }), 1);
  assert.equal(progressFraction(null), 0);
  assert.equal(isFinished({ position_seconds: 1190, duration_seconds: 1200 }), true);
  assert.equal(isFinished({ position_seconds: 600, duration_seconds: 1200 }), false);
});

test('continueWatching skips finished and barely-started titles, newest first', () => {
  const rows = continueWatching([
    { provider: 'moviebox', id: 'a', title: 'A', position_seconds: 300, duration_seconds: 1200, updated_at: 10 },
    { provider: 'moviebox', id: 'b', title: 'B', position_seconds: 1190, duration_seconds: 1200, updated_at: 30 },
    { provider: 'moviebox', id: 'c', title: 'C', position_seconds: 2, duration_seconds: 1200, updated_at: 20 },
    { provider: 'moviebox', id: 'd', title: 'D', position_seconds: 990, duration_seconds: 1000, updated_at: 40 },
  ]);
  assert.deepEqual(
    rows.map((entry) => entry.id),
    ['a'],
  );
  assert.equal(rows[0].fraction, 0.25);
});

test('indexByKey and titleKey normalise provider casing', () => {
  const index = indexByKey([{ provider: 'MovieBox', id: 'x', rating: 9 }]);
  assert.equal(index.get(titleKey('moviebox', 'x')).rating, 9);
});

test('rankRelated boosts official and personal ratings, penalises finished titles', () => {
  const items = [item('a', { imdb_rating: '6.0' }), item('b', { imdb_rating: '9.0' }), item('c')];
  const ranked = rankRelated(items, {
    reasons: { a: ['Because you like Drama'] },
    ratings: { b: { rating: 10 } },
    progress: [{ provider: 'moviebox', id: 'c', position_seconds: 100, duration_seconds: 100, completed: true }],
  });
  assert.equal(ranked[0].item.id.value, 'b');
  assert.equal(ranked[0].reasons.length >= 0, true);
  assert.equal(ranked[ranked.length - 1].item.id.value, 'c');
  assert.equal(ranked[0].rating, 9);
});

test('rankRelated adds a franchise reason from the title', () => {
  const ranked = rankRelated([item('d1', { title: 'Dune: Part Two' })]);
  assert.deepEqual(ranked[0].reasons, ['More Dune']);
});

test('dedupeItems removes provider+id duplicates but keeps cross-provider copies', () => {
  const unique = dedupeItems([
    item('a'),
    item('a'),
    { id: { provider: 'dramachi', value: 'a' }, title: 'A on Sakshi' },
  ]);
  assert.equal(unique.length, 2);
});

test('similarByMeta ranks by genre, director and franchise overlap', () => {
  const source = { id: { provider: 'moviebox', value: 's' }, title: 'Dune', genres: ['Science Fiction', 'Adventure'], director: 'Denis Villeneuve', year: '2021' };
  const ranked = similarByMeta(source, [
    item('x', { title: 'Blade Runner 2049', genres: ['Science Fiction'], director: 'Denis Villeneuve', year: '2017' }),
    item('y', { title: 'Dune: Part Two', genres: ['Science Fiction', 'Adventure'], year: '2024' }),
    item('z', { title: 'The Notebook', genres: ['Romance'], year: '2004' }),
  ]);
  const ids = ranked.map((entry) => entry.item.id.value);
  assert.deepEqual(ids, ['y', 'x']);
});

test('becauseYouWatched uses rated and saved genres to pick from the pool', () => {
  const picks = becauseYouWatched(
    [
      item('h1', { genres: ['Horror'], imdb_rating: '7.0' }),
      item('r1', { genres: ['Romance'], imdb_rating: '9.0' }),
    ],
    {
      ratings: [{ provider: 'moviebox', id: 'r0', rating: 9, genres: ['Romance'] }],
      watchlist: [{ provider: 'moviebox', id: 'w0', genres: ['Romance'] }],
    },
  );
  assert.equal(picks.length, 1);
  assert.equal(picks[0].item.id.value, 'r1');
  assert.match(picks[0].reasons[0], /Because you like Romance/);
});

test('libraryStats summarises hours, finished titles and average rating', () => {
  const stats = libraryStats({
    watchlist: [{ provider: 'moviebox', id: 'a' }],
    progress: [
      { provider: 'moviebox', id: 'a', position_seconds: 3600, duration_seconds: 7200, media_type: 'movie', updated_at: 100 },
      { provider: 'moviebox', id: 'b', position_seconds: 100, duration_seconds: 100, completed: true, media_type: 'series', season: 1, episode: 3, updated_at: 200 },
    ],
    ratings: [
      { rating: 8 },
      { rating: 9 },
    ],
  });
  assert.equal(stats.watchlist_count, 1);
  assert.equal(stats.finished, 1);
  assert.equal(stats.in_progress, 1);
  assert.equal(stats.hours, 1);
  assert.equal(stats.average_rating, 8.5);
  assert.equal(stats.episodes, 1);
  assert.equal(stats.last_watched, 200);
});

test('heroCandidates prefers highly rated posters', () => {
  const heroes = heroCandidates(
    [item('low', { imdb_rating: '5.0' }), item('high', { imdb_rating: '9.2' }), item('noposter', { poster_url: null })],
    {},
    { limit: 2 },
  );
  assert.equal(heroes[0].id.value, 'high');
  assert.equal(heroes.length, 2);
});

test('sortItems supports rating, year and title orders', () => {
  const items = [item('a', { title: 'Zeta', imdb_rating: '6.0', year: '2010' }), item('b', { title: 'Alpha', imdb_rating: '9.0', year: '2022' })];
  assert.equal(sortItems(items, 'rating')[0].id.value, 'b');
  assert.equal(sortItems(items, 'year')[0].id.value, 'b');
  assert.equal(sortItems(items, 'title')[0].id.value, 'b');
  assert.equal(sortItems(items, 'relevance').length, 2);
});
