// Title details: IMDb-style sheet with official rating, credits, episodes,
// stream list, personal rating and a "More like this" rail.

import * as api from '../lib/api.js';
import * as library from '../lib/library.js';
import { cardHtml, errorStateHtml, posterFallbackHtml, ratingRingHtml, rowHtml, spinnerHtml } from '../ui/components.js';
import {
  displayUiText,
  escapeHtml,
  formatRating,
  formatRuntime,
  normaliseRating,
  prettySize,
  providerLabel,
} from '../lib/format.js';
import { rankRelated, similarByMeta } from '../lib/recommend.js';
import { app, cardMeta, ensureMeta, rememberGenres, toast } from '../state.js';
import { navigate, watchPath } from '../lib/router.js';
import { buildStreamEntry, downloadRelease } from '../player/engine.js';

const state = {
  provider: 'moviebox',
  id: '',
  details: null,
  season: 0,
  episode: 0,
  entry: null,
  request: 0,
};

export async function renderDetails(container, route) {
  const request = ++state.request;
  state.provider = route.params.provider;
  state.id = route.params.id;
  state.details = null;
  state.entry = null;

  container.innerHTML = `<div class="page-shell">${spinnerHtml('Loading title…')}</div>`;

  let details;
  try {
    details = await api.details({ provider: state.provider, id: state.id });
  } catch (error) {
    if (request !== state.request) return;
    container.innerHTML = `<div class="page-shell">${errorStateHtml({
      title: 'Could not load this title',
      message: error?.message || 'The source did not return details.',
    })}</div>`;
    container.querySelector('[data-retry]')?.addEventListener('click', () => renderDetails(container, route));
    return;
  }
  if (request !== state.request) return;

  state.details = details;
  app.details = details;
  rememberGenres(details);
  const isSeries = details.media_type === 'series' || (details.seasons || []).length > 0;
  state.season = isSeries ? Number(details.seasons?.[0]?.number || 1) : 0;
  state.episode = isSeries ? Number(details.seasons?.[0]?.episodes?.[0]?.number || 1) : 0;

  paint(container);
  loadStreams();
  loadRelated(container);
}

function paint(container) {
  const details = state.details;
  if (!details) return;
  const provider = state.provider;
  const id = state.id;
  const title = details.title || 'Untitled';
  const poster = details.poster_url || '';
  const isSeries = details.media_type === 'series' || (details.seasons || []).length > 0;
  const rating = normaliseRating(details.imdb_rating);
  const myRating = library.ratingFor(provider, id);
  const listed = library.isInWatchlist(provider, id);
  const progress = library.progressFor(provider, id);
  const genres = details.genres || [];
  const stars = (details.stars || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const seasonOptions = (details.seasons || [])
    .map(
      (season) =>
        `<option value="${Number(season.number)}" ${Number(season.number) === Number(state.season) ? 'selected' : ''}>Season ${Number(season.number)}</option>`,
    )
    .join('');
  const episodes = (details.seasons || []).find((season) => Number(season.number) === Number(state.season))?.episodes || [];

  container.innerHTML = `
    <div class="page-shell details" data-view="details">
      <section class="detail-hero">
        <div class="detail-backdrop">
          ${poster ? `<img src="${escapeHtml(poster)}" alt="" aria-hidden="true" />` : posterFallbackHtml(title, provider)}
        </div>
        <div class="detail-grid">
          <div class="detail-poster">
            ${poster ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(title)} poster" />` : posterFallbackHtml(title, provider)}
          </div>
          <div class="detail-main">
            <p class="kicker">${escapeHtml(providerLabel(provider))} · ${isSeries ? 'SERIES' : 'MOVIE'}</p>
            <h1 class="detail-title">${escapeHtml(title)}</h1>
            ${details.tagline ? `<p class="detail-tagline">${escapeHtml(details.tagline)}</p>` : ''}
            <div class="detail-meta">
              ${details.year ? `<span class="meta-pill">${escapeHtml(details.year)}</span>` : ''}
              ${details.duration ? `<span class="meta-pill">${escapeHtml(formatRuntime(details.duration))}</span>` : ''}
              ${isSeries && details.seasons?.length ? `<span class="meta-pill">${details.seasons.length} Season${details.seasons.length > 1 ? 's' : ''}</span>` : ''}
              ${details.prints ? `<span class="meta-pill">${escapeHtml(displayUiText(details.prints))}</span>` : ''}
              ${details.audios ? `<span class="meta-pill">${escapeHtml(displayUiText(details.audios))}</span>` : ''}
            </div>
            <div class="detail-scores">
              ${ratingRingHtml(rating, { label: 'IMDb', size: 'lg' })}
              <div class="score-copy">
                <p class="score-line">${rating ? `Official IMDb score ${formatRating(rating)}/10` : 'No official rating reported for this title.'}</p>
                <p class="score-line muted">Your rating: <strong data-my-rating>${myRating ? `${myRating}/10` : 'not rated'}</strong></p>
              </div>
            </div>
            <div class="detail-actions">
              <button class="primary-button" type="button" data-play-title>▶ ${progress && progress.position_seconds > 5 ? 'Resume' : 'Play'}</button>
              <button class="ghost-button" type="button" data-watchlist="${listed ? '1' : '0'}">${listed ? '✓ In My List' : '+ My List'}</button>
              <button class="ghost-button" type="button" data-rate-toggle>★ Rate</button>
            </div>
            <div class="rate-panel" hidden>
              <p class="rate-label">Rate this title (1-10)</p>
              <div class="rate-buttons">
                ${Array.from({ length: 10 }, (_, index) => index + 1)
                  .map(
                    (value) =>
                      `<button type="button" class="rate-button ${value === myRating ? 'is-active' : ''}" data-rate="${value}" aria-label="Rate ${value} out of 10">${value}</button>`,
                  )
                  .join('')}
                <button type="button" class="rate-clear" data-rate="0">Clear</button>
              </div>
            </div>
            ${progress ? `<p class="detail-resume">You stopped at ${Math.round(((progress.position_seconds || 0) / Math.max(1, progress.duration_seconds || 1)) * 100)}%${Number(progress.season) > 0 ? ` · S${progress.season} E${progress.episode || 1}` : ''}</p>` : ''}
            <p class="detail-description">${escapeHtml(details.description || 'No description available for this title.')}</p>
            ${details.director ? `<p class="detail-credit"><span>Director</span> <a href="/search?q=${encodeURIComponent(details.director)}" data-nav>${escapeHtml(details.director)}</a></p>` : ''}
            ${stars.length ? `<p class="detail-credit"><span>Cast</span> ${stars.slice(0, 6).map((name) => `<a href="/search?q=${encodeURIComponent(name)}" data-nav>${escapeHtml(name)}</a>`).join(', ')}</p>` : ''}
            ${genres.length ? `<div class="genre-chips">${genres.map((genre) => `<a class="chip" href="/search?q=${encodeURIComponent(genre)}" data-nav><span>${escapeHtml(genre)}</span></a>`).join('')}</div>` : ''}
          </div>
        </div>
      </section>

      ${
        isSeries
          ? `<section class="episode-panel">
              <header class="panel-head">
                <h2>Episodes</h2>
                <label class="field">
                  <span>Season</span>
                  <select id="season-select">${seasonOptions}</select>
                </label>
              </header>
              <div class="episode-list">
                ${episodes.length
                  ? episodes
                      .map(
                        (episode) => `
                        <article class="episode-row ${Number(episode.number) === Number(state.episode) ? 'is-active' : ''}" data-episode="${Number(episode.number)}">
                          <span class="episode-number">${Number(episode.number)}</span>
                          <span class="episode-copy">
                            <strong>${escapeHtml(episode.title || `Episode ${Number(episode.number)}`)}</strong>
                            ${episode.overview ? `<small>${escapeHtml(episode.overview)}</small>` : ''}
                          </span>
                          <button class="icon-button" type="button" data-play-episode="${Number(episode.number)}" aria-label="Play episode ${Number(episode.number)}">▶</button>
                        </article>`,
                      )
                      .join('')
                  : '<p class="muted">No episode list from this source.</p>'}
              </div>
            </section>`
          : ''
      }

      <section class="streams-panel">
        <header class="panel-head">
          <div>
            <h2>Available streams</h2>
            <p class="muted" id="stream-subtitle">Checking configured sources…</p>
          </div>
          <button class="primary-button" type="button" data-play-title>▶ Play automatically</button>
        </header>
        <div class="stream-list" id="stream-list">${spinnerHtml('Finding streams…')}</div>
        <p class="stream-note">Play automatically tries Sakshi → Ritu → Siddharth → the rest. Har link ka apna download button hai.</p>
      </section>

      <section class="related-panel" id="related-panel">
        ${rowHtml({ key: 'related', title: 'More like this', hint: 'Similar titles from this source', itemsHtml: '<div class="loading-state"><span class="spinner"></span><span>Finding similar titles…</span></div>' })}
      </section>
    </div>`;

  bind(container);
}

function bind(container) {
  container.querySelectorAll('[data-play-title]').forEach((button) => {
    button.addEventListener('click', () => {
      navigate(watchPath(state.provider, state.id, { season: state.season, episode: state.episode }));
    });
  });

  const watchlistButton = container.querySelector('[data-watchlist]');
  watchlistButton?.addEventListener('click', async () => {
    const listed = await library.toggleWatchlist({
      provider: state.provider,
      id: state.id,
      title: state.details?.title,
      poster_url: state.details?.poster_url || null,
      year: state.details?.year || null,
      media_type: state.details?.media_type || 'movie',
      official_rating: normaliseRating(state.details?.imdb_rating),
    });
    watchlistButton.dataset.watchlist = listed ? '1' : '0';
    watchlistButton.textContent = listed ? '✓ In My List' : '+ My List';
    toast(listed ? 'Added to My List' : 'Removed from My List', listed ? 'success' : 'info');
    document.dispatchEvent(new CustomEvent('ifallhub:library-changed'));
  });

  container.querySelector('[data-rate-toggle]')?.addEventListener('click', () => {
    const panel = container.querySelector('.rate-panel');
    if (panel) panel.hidden = !panel.hidden;
  });
  container.querySelectorAll('[data-rate]').forEach((button) => {
    button.addEventListener('click', async () => {
      const value = await library.setRating(
        {
          provider: state.provider,
          id: state.id,
          title: state.details?.title,
          poster_url: state.details?.poster_url || null,
          year: state.details?.year || null,
        },
        Number(button.dataset.rate),
      );
      const label = container.querySelector('[data-my-rating]');
      if (label) label.textContent = value ? `${value}/10` : 'not rated';
      container.querySelectorAll('[data-rate]').forEach((entry) => {
        entry.classList.toggle('is-active', Number(entry.dataset.rate) === value);
      });
      toast(value ? `Rated ${value}/10` : 'Rating cleared', 'success');
      document.dispatchEvent(new CustomEvent('ifallhub:library-changed'));
    });
  });

  container.querySelector('#season-select')?.addEventListener('change', (event) => {
    state.season = Number(event.target.value);
    const season = (state.details.seasons || []).find((entry) => Number(entry.number) === state.season);
    state.episode = Number(season?.episodes?.[0]?.number || 1);
    paint(container);
    loadStreams();
  });

  container.querySelectorAll('[data-play-episode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.episode = Number(button.dataset.playEpisode);
      navigate(watchPath(state.provider, state.id, { season: state.season, episode: state.episode }));
    });
  });
  container.querySelectorAll('[data-episode]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('[data-play-episode]')) return;
      state.episode = Number(row.dataset.episode);
      container.querySelectorAll('[data-episode]').forEach((entry) => entry.classList.toggle('is-active', entry === row));
      loadStreams();
    });
  });
}

async function loadStreams() {
  const list = document.querySelector('#stream-list');
  const subtitle = document.querySelector('#stream-subtitle');
  if (!list) return;
  list.innerHTML = spinnerHtml('Finding streams…');
  try {
    const response = await api.streams({
      provider: state.provider,
      id: state.id,
      season: state.season,
      episode: state.episode,
      isSeries: state.details?.media_type === 'series' || (state.details?.seasons || []).length > 0,
      expectedTitle: state.details?.title || '',
      expectedYear: state.details?.year || '',
    });
    state.entry = buildStreamEntry(state.provider, { id: { provider: state.provider, value: state.id }, title: state.details?.title }, response);
    const releases = state.entry.releases;
    if (subtitle) {
      subtitle.textContent = releases.length
        ? `${releases.length} stream${releases.length === 1 ? '' : 's'} found — best first`
        : 'No streams on this source. Play automatically checks the others.';
    }
    list.innerHTML = releases.length ? releases.map(streamRowHtml).join('') : '<p class="muted">No links on this source yet.</p>';
    list.querySelectorAll('[data-stream-play]').forEach((button) => {
      button.addEventListener('click', () => {
        navigate(watchPath(state.provider, state.id, { season: state.season, episode: state.episode }));
      });
    });
    list.querySelectorAll('[data-download]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const filename = await downloadRelease({
            entry: state.entry,
            releaseIndex: Number(button.dataset.release),
            mirrorIndex: Number(button.dataset.mirror || 0),
          });
          toast(`Download started: ${filename}`, 'success');
        } catch (error) {
          toast(error?.message || 'Download could not start.', 'error');
        } finally {
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    if (subtitle) subtitle.textContent = 'This source could not be reached. Play automatically tries the others.';
    list.innerHTML = `<p class="muted">${escapeHtml(displayUiText(error?.message || 'Could not load streams.'))}</p>`;
  }
}

function streamRowHtml(release, index) {
  const mirrors = release.mirrors?.length ? release.mirrors : [{ label: '' }];
  const fields = [release.codec, release.language, prettySize(release.size_bytes)].filter(Boolean);
  return `
    <div class="stream-row">
      <button class="stream-option" type="button" data-stream-play data-release="${index}">
        <span class="stream-quality">${escapeHtml(String(release.quality || 'AUTO'))}</span>
        <span class="stream-main">
          <span class="stream-name" title="${escapeHtml(displayUiText(release.filename || 'Stream'))}">${escapeHtml(displayUiText(release.filename || 'Stream'))}</span>
          <span class="stream-sub">${fields.map((field) => escapeHtml(String(field))).join('<span class="dot"></span>') || 'Ready to play'}</span>
        </span>
        <span class="stream-source">${escapeHtml(providerLabel(release.provider))}</span>
      </button>
      <div class="stream-downloads">
        ${mirrors
          .map(
            (mirror, mirrorIndex) => `
            <button class="ghost-button small" type="button" data-download data-release="${index}" data-mirror="${mirrorIndex}">
              ↓ ${escapeHtml(mirrors.length > 1 ? mirror.label || `Link ${mirrorIndex + 1}` : 'Download')}
            </button>`,
          )
          .join('')}
      </div>
    </div>`;
}

async function loadRelated(container) {
  const panel = container.querySelector('#related-panel');
  if (!panel) return;
  let items = [];
  let reasons = {};
  try {
    const payload = await api.related({ provider: state.provider, id: state.id, limit: 24 });
    api.markSupport('related', true);
    items = payload.items || [];
    reasons = payload.reasons || {};
  } catch (error) {
    if (error?.status === 404) api.markSupport('related', false);
  }
  if (!items.length) {
    items = similarByMeta(state.details, app.pool, { limit: 18 }).map((entry) => entry.item);
  }
  if (!items.length) {
    panel.innerHTML = rowHtml({
      key: 'related',
      title: 'More like this',
      itemsHtml: '<p class="muted">No similar titles found from this source yet.</p>',
    });
    return;
  }

  const ranked = rankRelated(items, {
    reasons,
    ratings: Object.fromEntries(
      library.state.ratings.map((entry) => [entry.id, { rating: entry.rating }]),
    ),
    watchlist: library.state.watchlist,
    progress: library.state.progress,
    limit: 24,
  });
  panel.innerHTML = rowHtml({
    key: 'related',
    title: 'More like this',
    hint: 'Genres, director aur franchise ke hisaab se',
    count: `${ranked.length}`,
    itemsHtml: ranked
      .map((entry) =>
        cardHtml(entry.item, {
          ...cardMeta(entry.item, { provider: state.provider }),
          reason: entry.reasons[0] || '',
        }),
      )
      .join(''),
  });
  panel.querySelectorAll('[data-rail] [data-scroll]').forEach((button) => {
    button.addEventListener('click', () => {
      const track = button.closest('[data-rail]').querySelector('[data-track]');
      track.scrollBy({ left: Number(button.dataset.scroll) * Math.max(320, track.clientWidth * 0.8), behavior: 'smooth' });
    });
  });
  ensureMeta(ranked.map((entry) => entry.item), { provider: state.provider });
}

export function currentDetails() {
  return state.details;
}

export function detailsTarget() {
  return { provider: state.provider, id: state.id, title: state.details?.title || state.id };
}
