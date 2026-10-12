// Tracker: watch stats, resume list and rating history.

import * as library from '../lib/library.js';
import { emptyStateHtml, progressRowHtml } from '../ui/components.js';
import { escapeHtml, relativeTime } from '../lib/format.js';
import { continueWatching, libraryStats } from '../lib/recommend.js';

export async function renderTracker(container) {
  paint(container);
}

function paint(container) {
  const stats = libraryStats(library.state);
  const resume = continueWatching(library.state.progress, { limit: 50 });
  const finished = library.state.progress
    .filter((entry) => entry.completed)
    .sort((a, b) => (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0));

  container.innerHTML = `
    <div class="page-shell tracker" data-view="tracker">
      <header class="page-head">
        <div>
          <p class="kicker">MOVIE TRACKER</p>
          <h1 class="page-title">What you've watched</h1>
          <p class="muted">${library.state.mode === 'server' ? 'Live from the engine — har device pe same library.' : 'Stored on this device (engine library unavailable).'}</p>
        </div>
      </header>

      <section class="stat-grid">
        ${statCard('Hours watched', stats.hours, `${stats.started} titles started`)}
        ${statCard('Finished', stats.finished, `${stats.in_progress} in progress`)}
        ${statCard('Episodes', stats.episodes, 'tracked episodes')}
        ${statCard('My List', stats.watchlist_count, 'saved titles')}
        ${statCard('Average rating', stats.average_rating ? `${stats.average_rating}/10` : '–', `${stats.rated_count} rated`)}
        ${statCard('Last watched', stats.last_watched ? relativeTime(stats.last_watched) : '–', 'most recent session')}
      </section>

      <section class="tracker-section">
        <header class="panel-head">
          <h2>Continue Watching</h2>
          <p class="muted">Progress ke hisaab se — wahin se resume hoga</p>
        </header>
        ${
          resume.length
            ? `<div class="progress-list">${resume.map((entry, index) => progressRowHtml(entry, { index })).join('')}</div>`
            : emptyStateHtml({ title: 'Nothing in progress', message: 'Koi title play karo, progress yahan automatically aa jayega.' })
        }
      </section>

      <section class="tracker-section">
        <header class="panel-head">
          <h2>Finished</h2>
          <p class="muted">Completed titles</p>
        </header>
        ${
          finished.length
            ? `<div class="progress-list">${finished
                .map((entry, index) =>
                  progressRowHtml({ ...entry, position_seconds: entry.duration_seconds || entry.position_seconds }, { index }),
                )
                .join('')}</div>`
            : '<p class="muted">Abhi tak kuch complete nahi hua.</p>'
        }
      </section>

      ${
        library.state.ratings.length
          ? `<section class="tracker-section">
              <header class="panel-head"><h2>Rated by you</h2></header>
              <div class="rating-table">
                ${library.state.ratings
                  .slice()
                  .sort((a, b) => Number(b.rating) - Number(a.rating))
                  .map(
                    (entry) => `
                    <article class="rating-row" data-card data-provider="${escapeHtml(entry.provider)}" data-id="${escapeHtml(entry.id)}" data-title="${escapeHtml(entry.title)}" tabindex="0" role="link">
                      <span class="rating-value">${escapeHtml(String(entry.rating))}<small>/10</small></span>
                      <span class="rating-copy"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(relativeTime(entry.updated_at))}</small></span>
                    </article>`,
                  )
                  .join('')}
              </div>
            </section>`
          : ''
      }

      <section class="tracker-section danger-zone">
        <header class="panel-head">
          <h2>Reset</h2>
          <p class="muted">Library data delete karo</p>
        </header>
        <div class="danger-actions">
          <button class="ghost-button" type="button" data-clear="progress">Clear watch progress</button>
          <button class="ghost-button" type="button" data-clear="watchlist">Clear My List</button>
          <button class="ghost-button" type="button" data-clear="ratings">Clear ratings</button>
          <button class="danger-button" type="button" data-clear="all">Delete everything</button>
        </div>
      </section>
    </div>`;

  container.querySelectorAll('[data-clear]').forEach((button) => {
    button.addEventListener('click', async () => {
      await library.clear(button.dataset.clear);
      paint(container);
    });
  });
  container.querySelectorAll('[data-clear-progress]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const row = button.closest('[data-card]');
      await library.updateProgress(
        { provider: row.dataset.provider, id: row.dataset.id, title: row.dataset.title },
        { remove: true },
      );
      paint(container);
    });
  });
}

function statCard(label, value, hint) {
  return `
    <article class="stat-card">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value">${escapeHtml(String(value ?? '–'))}</span>
      <span class="stat-hint">${escapeHtml(hint || '')}</span>
    </article>`;
}
