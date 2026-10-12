// Home: hero + Netflix-style carousels, all fed by the live API.

import * as api from '../lib/api.js';
import * as library from '../lib/library.js';
import { cardHtml, errorStateHtml, posterFallbackHtml, rowHtml, skeletonRow } from '../ui/components.js';
import {
  escapeHtml,
  formatRating,
  itemId,
  itemPoster,
  itemProvider,
  itemTitle,
  itemYear,
  mediaTypeLabel,
  normaliseRating,
  providerLabel,
  ratingTone,
} from '../lib/format.js';
import { becauseYouWatched, continueWatching, dedupeItems, heroCandidates, indexByKey } from '../lib/recommend.js';
import { app, cardMeta, ensureMeta, toast } from '../state.js';
import { navigate, titlePath, watchPath } from '../lib/router.js';

const ROW_HINTS = {
  trending: 'What everyone is watching this week',
  top_rated: 'Highest IMDb scores of all time',
  fresh: 'Recent releases critics liked',
  most_watched: 'Community favourites',
};

let heroTimer = 0;
let heroIndex = 0;
let heroItems = [];

export async function renderHome(container) {
  stopHero();
  container.innerHTML = `
    <section class="hero" id="hero" aria-live="polite">
      <div class="hero-backdrop"></div>
      <div class="hero-body">
        <div class="hero-copy">
          <p class="hero-kicker">IFALLHUB · YOUR ENTERTAINMENT</p>
          <h1 class="hero-title">Movies, series aur anime — ek jagah.</h1>
          <p class="hero-text">Search karo, watchlist banao, wahin se resume karo. Ratings, suggestions aur similar titles sab live backend se aate hain.</p>
          <div class="hero-actions">
            <a class="primary-button" href="#browse" data-focus-search>Browse titles</a>
            <a class="ghost-button" href="/mylist" data-nav>My List</a>
          </div>
        </div>
      </div>
    </section>
    <div class="rails" id="home-rails">
      ${skeletonRow('Trending Now')}
      ${skeletonRow('Top Rated')}
    </div>`;

  try {
    await loadRows();
    renderRails();
  } catch (error) {
    const rails = container.querySelector('#home-rails');
    if (rails) {
      rails.innerHTML = errorStateHtml({
        title: 'The engine is not responding',
        message: error?.message || 'Start the local API to load titles.',
      });
    }
  }
}

async function loadRows() {
  let payload = null;
  try {
    payload = await api.collections({ limit: 24, pages: 3 });
    api.markSupport('collections', true);
  } catch (error) {
    if (error?.status !== 404) throw error;
    api.markSupport('collections', false);
  }

  if (!payload) {
    const discover = await api.discover({ provider: 'moviebox', page: 1 });
    payload = {
      rows: [
        { key: 'trending', label: 'Trending Now', hint: ROW_HINTS.trending, items: discover.items || [] },
      ],
      metrics: discover.metrics || {},
    };
  }

  app.metrics = payload.metrics || {};
  app.rows = payload.rows || [];
  app.pool = dedupeItems(app.rows.flatMap((row) => row.items || []));
  heroItems = heroCandidates(app.pool, app.metrics, { limit: 6 });
  ensureMeta(app.pool.slice(0, 48));
}

function renderRails() {
  const rails = document.querySelector('#home-rails');
  if (!rails) return;
  const blocks = [];

  const resume = continueWatching(library.state.progress, { limit: 14 });
  if (resume.length) {
    blocks.push(
      rowHtml({
        key: 'continue',
        title: 'Continue Watching',
        hint: 'Wahin se shuru karo jahan chhoda tha',
        count: `${resume.length}`,
        itemsHtml: resume
          .map((entry) =>
            cardHtml(
              { id: { provider: entry.provider, value: entry.id }, title: entry.title, poster_url: entry.poster_url, year: entry.year, media_type: entry.media_type },
              cardMeta(
                { id: { provider: entry.provider, value: entry.id }, title: entry.title, poster_url: entry.poster_url, year: entry.year },
                {
                  provider: entry.provider,
                  id: entry.id,
                  title: entry.title,
                  poster: entry.poster_url,
                  year: entry.year,
                  type: entry.media_type === 'series' ? 'Series' : 'Movie',
                  progress: entry,
                  note: entry.remaining_seconds ? `${Math.round(entry.remaining_seconds / 60)} min left` : 'Resume',
                },
              ),
            ),
          )
          .join(''),
      }),
    );
  }

  for (const row of app.rows) {
    const items = dedupeItems(row.items || []).slice(0, 24);
    if (!items.length) continue;
    blocks.push(
      rowHtml({
        key: row.key,
        title: row.label,
        hint: row.hint || ROW_HINTS[row.key] || '',
        count: `${items.length}`,
        itemsHtml: items
          .map((item) =>
            cardHtml(item, {
              ...cardMeta(item),
              ranking: items.indexOf(item) + 1,
            }),
          )
          .join(''),
      }),
    );
  }

  const personal = becauseYouWatched(app.pool, {
    ratings: library.state.ratings.map((entry) => ({
      ...entry,
      genres: app.genreLookup.get(`${String(entry.provider).toLowerCase()}::${entry.id}`) || [],
    })),
    watchlist: library.state.watchlist,
    exclude: [],
    limit: 18,
  });
  if (personal.length) {
    blocks.push(
      rowHtml({
        key: 'because',
        title: 'Because you watch on Ifallhub',
        hint: 'Aapki ratings aur watchlist se banaya gaya',
        count: `${personal.length}`,
        itemsHtml: personal
          .map((entry) => cardHtml(entry.item, { ...cardMeta(entry.item), reason: entry.reasons[0] || '' }))
          .join(''),
      }),
    );
  }

  const listed = library.state.watchlist.slice(0, 18);
  if (listed.length) {
    blocks.push(
      rowHtml({
        key: 'mylist',
        title: 'My List',
        hint: 'Aapke saved titles',
        count: `${library.state.watchlist.length}`,
        action: '<a class="rail-link" href="/mylist" data-nav>See all</a>',
        itemsHtml: listed
          .map((entry) =>
            cardHtml(
              { id: { provider: entry.provider, value: entry.id }, title: entry.title, poster_url: entry.poster_url, year: entry.year, media_type: entry.media_type },
              cardMeta(
                { id: { provider: entry.provider, value: entry.id }, title: entry.title, poster_url: entry.poster_url, year: entry.year },
                { provider: entry.provider, id: entry.id, title: entry.title, poster: entry.poster_url, year: entry.year, listed: true, rating: entry.official_rating },
              ),
            ),
          )
          .join(''),
      }),
    );
  }

  if (!blocks.length) {
    rails.innerHTML = `<div class="empty-state"><h3>No titles yet</h3><p>The engine returned an empty catalog. Try again in a moment.</p></div>`;
    return;
  }

  rails.innerHTML = blocks.join('');
  bindRailScroll(rails);
  startHero();
}

function bindRailScroll(root) {
  root.querySelectorAll('[data-rail]').forEach((rail) => {
    const track = rail.querySelector('[data-track]');
    rail.querySelectorAll('[data-scroll]').forEach((button) => {
      button.addEventListener('click', () => {
        const direction = Number(button.dataset.scroll);
        const amount = Math.max(320, track.clientWidth * 0.8);
        track.scrollBy({ left: direction * amount, behavior: 'smooth' });
      });
    });
  });
}

// --- Hero ------------------------------------------------------------------

function startHero() {
  stopHero();
  if (!heroItems.length) return;
  paintHero(heroItems[0]);
  heroTimer = window.setInterval(() => {
    heroIndex = (heroIndex + 1) % heroItems.length;
    paintHero(heroItems[heroIndex]);
  }, 8000);
}

function stopHero() {
  window.clearInterval(heroTimer);
  heroTimer = 0;
  heroIndex = 0;
}

function paintHero(item) {
  const hero = document.querySelector('#hero');
  if (!hero || !item) return;
  const provider = itemProvider(item) || 'moviebox';
  const id = itemId(item);
  const title = itemTitle(item);
  const poster = itemPoster(item);
  const metric = app.metrics[id] || {};
  const rating = formatRating(normaliseRating(metric.rating) ?? normaliseRating(metric.recent_rating));
  const year = itemYear(item);
  const type = mediaTypeLabel(item);
  const backdrop = hero.querySelector('.hero-backdrop');
  const copy = hero.querySelector('.hero-copy');

  if (backdrop) {
    backdrop.innerHTML = poster
      ? `<img src="${escapeHtml(poster)}" alt="" aria-hidden="true" />`
      : posterFallbackHtml(title, provider);
    backdrop.dataset.hasPoster = poster ? '1' : '0';
  }
  if (copy) {
    copy.innerHTML = `
      <p class="hero-kicker">${escapeHtml(providerLabel(provider))} · ${escapeHtml(type)}${year ? ` · ${escapeHtml(year)}` : ''}</p>
      <h1 class="hero-title">${escapeHtml(title)}</h1>
      <div class="hero-badges">
        ${rating ? `<span class="hero-rating tone-${ratingTone(rating)}">IMDb ${escapeHtml(rating)}</span>` : ''}
        ${metric.trending ? '<span class="hero-pill">Trending</span>' : ''}
      </div>
      <div class="hero-actions">
        <button class="primary-button" type="button" data-hero-play>▶ Play</button>
        <button class="ghost-button" type="button" data-hero-info>More info</button>
      </div>`;
    copy.querySelector('[data-hero-play]')?.addEventListener('click', () => navigate(watchPath(provider, id)));
    copy.querySelector('[data-hero-info]')?.addEventListener('click', () => navigate(titlePath(provider, id)));
  }
}

export function refreshHomeIfVisible() {
  const rails = document.querySelector('#home-rails');
  if (rails && !document.querySelector('[data-view="details"]')) renderRails();
}

export { heroItems };
