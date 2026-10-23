// Sidify-V2 Watch History, Continue Watching & Stats view (`/tracker` & `/history`)
// wired live to Ifallhub's `/api/library` (`progress`, `ratings`, `watchlist`, `clear`).

import { escapeHtml, relativeTime } from '../lib/format.js';
import * as library from '../lib/library.js';
import {
  continueWatching,
  isFinished,
  libraryStats,
} from '../lib/recommend.js';
import { setAmbientSeed, toast } from '../state.js';
import {
  emptyStateHtml,
  pageTitleHtml,
  posterCardHtml,
  progressRowHtml,
  sectionHeaderHtml,
  shelfHtml,
} from '../ui/components.js';
import { iconHtml } from '../ui/icons.js';

export async function renderTracker(container, ctx = {}) {
  setAmbientSeed('History');

  function render() {
    if (ctx.signal?.aborted) return;
    const stats = libraryStats(library.state);
    const inProgress = continueWatching(library.state.progress || [], { limit: 25 });
    const finished = (library.state.progress || []).filter((entry) => isFinished(entry));

    container.innerHTML = `
      <div class="fade-up space-y-9 pb-14">
        ${pageTitleHtml('History', {
          subtitle: stats.last_watched
            ? `Last watched ${relativeTime(stats.last_watched)}`
            : 'Continue watching, completed titles & viewing stats',
        })}

        <!-- Sidify-V2 ReplayCard Stats Banner -->
        <section class="px-4 desk:px-8">
          <div class="relative overflow-hidden rounded-[18px] bg-gradient-to-br from-[#201218] via-[#171822] to-[#0f1722] p-5 text-white ring-1 ring-white/10">
            <div class="t-eyebrow text-white/55">Viewing Replay</div>
            <div class="mt-1 text-[20px] font-bold tracking-[-0.4px]">
              ${
                stats.hours > 0
                  ? `${stats.hours} ${stats.hours === 1 ? 'hour' : 'hours'} streamed across ${stats.finished + stats.in_progress} titles`
                  : 'Your personal watch activity'
              }
            </div>
            <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div class="rounded-[12px] bg-white/8 px-3.5 py-2.5 backdrop-blur-md">
                <div class="text-[22px] font-extrabold tabular-nums">${stats.in_progress}</div>
                <div class="text-[11.5px] text-white/65">In progress</div>
              </div>
              <div class="rounded-[12px] bg-white/8 px-3.5 py-2.5 backdrop-blur-md">
                <div class="text-[22px] font-extrabold tabular-nums">${stats.finished}</div>
                <div class="text-[11.5px] text-white/65">Finished</div>
              </div>
              <div class="rounded-[12px] bg-white/8 px-3.5 py-2.5 backdrop-blur-md">
                <div class="text-[22px] font-extrabold tabular-nums">${stats.hours}h</div>
                <div class="text-[11.5px] text-white/65">Watch time</div>
              </div>
              <div class="rounded-[12px] bg-white/8 px-3.5 py-2.5 backdrop-blur-md">
                <div class="text-[22px] font-extrabold tabular-nums">${stats.watchlist_count}</div>
                <div class="text-[11.5px] text-white/65">Watchlist</div>
              </div>
              <div class="rounded-[12px] bg-white/8 px-3.5 py-2.5 backdrop-blur-md">
                <div class="text-[22px] font-extrabold tabular-nums">${stats.average_rating ?? '–'}</div>
                <div class="text-[11.5px] text-white/65">Avg rating</div>
              </div>
            </div>
          </div>
        </section>

        <!-- Continue Watching -->
        <section>
          ${sectionHeaderHtml('Continue watching', {
            subtitle: inProgress.length ? `${inProgress.length} active` : '',
          })}
          ${
            inProgress.length
              ? `<div class="space-y-2 px-4 desk:px-8">
                   ${inProgress.map((entry, idx) => progressRowHtml(entry, { index: idx })).join('')}
                 </div>`
              : emptyStateHtml({
                  icon: 'clock',
                  title: 'Nothing in progress',
                  message: 'Movies and episodes you start watching will appear here with automatic resume points.',
                  action: `<a href="/movies" data-nav class="pill-selected inline-flex h-10 items-center rounded-full px-5 text-[14px] font-semibold">Explore movies</a>`,
                })
          }
        </section>

        <!-- Finished Titles Shelf -->
        ${
          finished.length
            ? shelfHtml({
                key: 'finished',
                title: 'Completed',
                subtitle: `${finished.length} ${finished.length === 1 ? 'title' : 'titles'} finished`,
                itemsHtml: finished
                  .map((entry) =>
                    posterCardHtml(
                      {
                        id: { provider: entry.provider, value: entry.id },
                        title: entry.title,
                        year: entry.year,
                        poster_url: entry.poster_url,
                        media_type: entry.media_type || 'movie',
                      },
                      {
                        progress: { ...entry, completed: true },
                        listed: library.isInWatchlist(entry.provider, entry.id),
                        personalRating: library.ratingFor(entry.provider, entry.id),
                      },
                    ),
                  )
                  .join(''),
              })
            : ''
        }

        <!-- Sidify-V2 iOS Settings Group for Library Maintenance -->
        ${
          stats.in_progress || stats.finished || stats.watchlist_count || stats.rated_count
            ? `<section class="max-w-[680px] px-4 desk:px-8">
                 <div class="t-eyebrow mb-2 px-1 text-fg-2">Library Data</div>
                 <div class="overflow-hidden rounded-[14px] bg-raised ring-1 ring-edge">
                   <div class="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2.5 hairline-b">
                     <div>
                       <div class="text-[14.5px] font-medium text-fg">Watch history &amp; resume points</div>
                       <div class="text-[12px] text-fg-2">${escapeHtml(String(library.state.progress.length))} saved entries</div>
                     </div>
                     <button type="button" data-clear-lib="progress" class="text-[13.5px] font-semibold text-danger hover:opacity-80">Clear</button>
                   </div>
                   <div class="flex min-h-[48px] items-center justify-between gap-3 px-4 py-2.5">
                     <div>
                       <div class="text-[14.5px] font-medium text-fg">Reset entire library</div>
                       <div class="text-[12px] text-fg-2">Clears watchlist, watch progress, and personal ratings</div>
                     </div>
                     <button type="button" data-clear-lib="all" class="inline-flex items-center gap-1 text-[13.5px] font-semibold text-danger hover:opacity-80">
                       ${iconHtml('trash', { size: 14 })}
                       <span>Reset all</span>
                     </button>
                   </div>
                 </div>
               </section>`
            : ''
        }
      </div>`;
  }

  container.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const clearProgressBtn = target.closest('[data-clear-progress]');
    if (clearProgressBtn) {
      event.preventDefault();
      event.stopPropagation();
      const row = clearProgressBtn.closest('[data-card]');
      if (row) {
        await library.updateProgress(
          {
            provider: row.dataset.provider,
            id: row.dataset.id,
            title: row.dataset.title || 'Title',
          },
          { remove: true },
        );
        toast('Removed from Continue watching');
      }
      return;
    }

    const clearLibBtn = target.closest('[data-clear-lib]');
    if (clearLibBtn) {
      const scope = clearLibBtn.dataset.clearLib || 'all';
      await library.clear(scope);
      toast(scope === 'all' ? 'Library reset' : 'Watch history cleared');
      render();
    }
  });

  const unsub = library.subscribe(() => render());
  ctx.signal?.addEventListener('abort', () => unsub());

  render();
}
