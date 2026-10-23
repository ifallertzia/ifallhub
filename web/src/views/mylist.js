// Sidify-V2 `Watchlist` & Library view (`/watchlist` & `/mylist`) wired live to
// Ifallhub's `/api/library` & `/api/library/events` SSE stream.

import { escapeHtml } from '../lib/format.js';
import * as library from '../lib/library.js';
import { officialRatingOf } from '../lib/media-helpers.js';
import { cachedMeta, ensureMeta, setAmbientSeed, toast } from '../state.js';
import {
  cardGridHtml,
  chipsHtml,
  emptyStateHtml,
  pageTitleHtml,
} from '../ui/components.js';
import { iconHtml } from '../ui/icons.js';

function entryToItem(entry) {
  return {
    id: { provider: entry.provider || 'moviebox', value: entry.id },
    title: entry.title || 'Untitled',
    year: entry.year || '',
    poster_url: entry.poster_url || '',
    media_type: entry.media_type || 'movie',
    imdb_rating: entry.official_rating || null,
  };
}

export async function renderMyList(container, ctx = {}) {
  let tab = 'all'; // 'all' | 'movies' | 'series' | 'rated'
  setAmbientSeed('Watchlist');

  function render() {
    if (ctx.signal?.aborted) return;
    const watchlist = library.state.watchlist || [];
    const ratings = library.state.ratings || [];

    const subtitle =
      tab === 'rated'
        ? `${ratings.length} rated ${ratings.length === 1 ? 'title' : 'titles'}`
        : `${watchlist.length} saved ${watchlist.length === 1 ? 'title' : 'titles'}`;

    const items =
      tab === 'rated'
        ? ratings.map((r) => entryToItem(r))
        : watchlist
            .filter((entry) => {
              if (tab === 'movies') return entry.media_type !== 'series';
              if (tab === 'series') return entry.media_type === 'series';
              return true;
            })
            .map((entry) => entryToItem(entry));

    void ensureMeta(items.slice(0, 24));

    const clearBtnHtml =
      (tab === 'rated' ? ratings.length : watchlist.length) > 0
        ? `<button type="button" data-clear-scope="${tab === 'rated' ? 'ratings' : 'watchlist'}" class="inline-flex h-9 items-center gap-1.5 rounded-full bg-fill px-4 text-[13px] font-semibold text-fg-2 transition hover:bg-fill-2 hover:text-danger">
             ${iconHtml('trash', { size: 14 })}
             <span>Clear ${tab === 'rated' ? 'ratings' : 'watchlist'}</span>
           </button>`
        : '';

    container.innerHTML = `
      <div class="fade-up pb-14">
        ${pageTitleHtml('Watchlist', { subtitle, trailingHtml: clearBtnHtml })}

        ${chipsHtml(
          [
            { id: 'all', label: `All saved (${watchlist.length})` },
            { id: 'movies', label: 'Movies' },
            { id: 'series', label: 'Series' },
            { id: 'rated', label: `Rated (${ratings.length})` },
          ],
          tab,
          { className: 'mb-6 px-4 desk:px-8', attrName: 'data-list-tab' },
        )}

        ${
          items.length
            ? cardGridHtml(items, (item) => {
                const p = item.id.provider;
                const id = item.id.value;
                const m = cachedMeta(p, id);
                return {
                  metaEntry: m,
                  rating: officialRatingOf(item, m),
                  listed: library.isInWatchlist(p, id),
                  progress: library.progressFor(p, id),
                  personalRating: library.ratingFor(p, id),
                };
              })
            : emptyStateHtml({
                icon: tab === 'rated' ? 'star' : 'bookmark',
                title: tab === 'rated' ? 'No rated titles yet' : 'Your watchlist is empty',
                message:
                  tab === 'rated'
                    ? 'Open any movie or series and tap Rate to score what you’ve watched.'
                    : 'Tap the bookmark icon on any movie or series poster to save it here.',
                action: `<a href="/movies" data-nav class="pill-selected inline-flex h-10 items-center rounded-full px-5 text-[14px] font-semibold">Browse movies</a>`,
              })
        }
      </div>`;
  }

  container.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const tabBtn = target.closest('[data-list-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.listTab || 'all';
      render();
      return;
    }

    const clearBtn = target.closest('[data-clear-scope]');
    if (clearBtn) {
      const scope = clearBtn.dataset.clearScope;
      await library.clear(scope);
      toast(`Cleared ${escapeHtml(scope)}`);
      render();
    }
  });

  const onSync = () => render();
  const unsub = library.subscribe(onSync);
  window.addEventListener('ifallhub:meta', onSync);
  ctx.signal?.addEventListener('abort', () => {
    unsub();
    window.removeEventListener('ifallhub:meta', onSync);
  });

  render();
}
