// My List: everything the viewer saved or rated, straight from the library.

import * as library from '../lib/library.js';
import { cardHtml, emptyStateHtml } from '../ui/components.js';
import { escapeHtml, relativeTime } from '../lib/format.js';
import { cardMeta, ensureMeta } from '../state.js';

export async function renderMyList(container) {
  paint(container);
}

function paint(container) {
  const watchlist = library.state.watchlist;
  const ratings = library.state.ratings;
  const mode = library.state.mode;

  container.innerHTML = `
    <div class="page-shell list" data-view="mylist">
      <header class="page-head">
        <div>
          <p class="kicker">YOUR LIBRARY</p>
          <h1 class="page-title">My List</h1>
          <p class="muted">
            ${watchlist.length} saved · ${ratings.length} rated ·
            ${mode === 'server' ? 'synced with the engine' : 'stored on this device'}
          </p>
        </div>
        <div class="page-head-actions">
          <button class="ghost-button" type="button" data-clear-watchlist ${watchlist.length ? '' : 'disabled'}>Clear list</button>
        </div>
      </header>

      ${
        watchlist.length
          ? `<section class="grid-section">
              <h2 class="section-title">Saved titles</h2>
              <div class="card-grid">
                ${watchlist
                  .map((entry) =>
                    cardHtml(
                      {
                        id: { provider: entry.provider, value: entry.id },
                        title: entry.title,
                        poster_url: entry.poster_url,
                        year: entry.year,
                        media_type: entry.media_type,
                      },
                      cardMeta(
                        { id: { provider: entry.provider, value: entry.id }, title: entry.title, poster_url: entry.poster_url, year: entry.year },
                        {
                          provider: entry.provider,
                          id: entry.id,
                          title: entry.title,
                          poster: entry.poster_url,
                          year: entry.year,
                          rating: entry.official_rating,
                          listed: true,
                          note: `Added ${relativeTime(entry.added_at)}`,
                        },
                      ),
                    ),
                  )
                  .join('')}
              </div>
            </section>`
          : emptyStateHtml({
              title: 'Nothing saved yet',
              message: 'Tap the + on any poster to build your list. It syncs with the engine automatically.',
              action: '<a class="primary-button" href="/" data-nav>Browse titles</a>',
            })
      }

      ${
        ratings.length
          ? `<section class="grid-section">
              <h2 class="section-title">Your ratings</h2>
              <div class="rating-table">
                ${ratings
                  .slice()
                  .sort((a, b) => Number(b.rating) - Number(a.rating))
                  .map(
                    (entry) => `
                    <article class="rating-row" data-card data-provider="${escapeHtml(entry.provider)}" data-id="${escapeHtml(entry.id)}" data-title="${escapeHtml(entry.title)}" tabindex="0" role="link">
                      <span class="rating-value">${escapeHtml(String(entry.rating))}<small>/10</small></span>
                      <span class="rating-copy">
                        <strong>${escapeHtml(entry.title)}</strong>
                        <small>${escapeHtml(entry.year || '')} · rated ${escapeHtml(relativeTime(entry.updated_at))}</small>
                      </span>
                      <button class="icon-button" type="button" data-clear-rating="${escapeHtml(entry.id)}" aria-label="Clear rating for ${escapeHtml(entry.title)}">✕</button>
                    </article>`,
                  )
                  .join('')}
              </div>
            </section>`
          : ''
      }
    </div>`;

  container.querySelector('[data-clear-watchlist]')?.addEventListener('click', async () => {
    await library.clear('watchlist');
    paint(container);
  });
  container.querySelectorAll('[data-clear-rating]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const entry = library.state.ratings.find((item) => item.id === button.dataset.clearRating);
      if (!entry) return;
      await library.setRating(entry, 0);
      paint(container);
    });
  });

  ensureMeta(watchlist.map((entry) => ({ id: { provider: entry.provider, value: entry.id }, title: entry.title })));
}
