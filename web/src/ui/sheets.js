// Sidify-V2 visually styled lightweight modals: Personal Rating & MovieBox-TUI Engine Settings.

import * as api from '../lib/api.js';
import { escapeHtml, providerLabel } from '../lib/format.js';
import * as library from '../lib/library.js';
import { applyTheme, setProvider, state, toast } from '../state.js';
import { iconHtml } from './icons.js';
import { clearPlayerSupportCache } from './vlc-button.js';

let activeCleanup = null;

export function closeActiveSheet() {
  if (typeof activeCleanup === 'function') {
    const fn = activeCleanup;
    activeCleanup = null;
    fn();
  }
}

export function showToast(message, { kind = 'info' } = {}) {
  toast(message, kind);
}

function getSheetHost() {
  let host = document.getElementById('sheet-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'sheet-root';
    document.body.appendChild(host);
  }
  return host;
}

function mountModalShell({ maxWidth = 'max-w-[460px]', ariaLabel = 'Dialog', contentHtml = '', onClose = null } = {}) {
  closeActiveSheet();
  const host = getSheetHost();
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const backdrop = document.createElement('div');
  backdrop.className =
    'fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-md desk:items-center desk:p-6';
  backdrop.innerHTML = `
    <div
      role="dialog"
      aria-modal="true"
      aria-label="${escapeHtml(ariaLabel)}"
      data-sheet-panel
      class="menu-glass relative flex max-h-[88dvh] w-full ${maxWidth} flex-col overflow-hidden rounded-t-[20px] text-fg desk:rounded-[20px]"
    >
      ${contentHtml}
    </div>`;

  host.innerHTML = '';
  host.appendChild(backdrop);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeActiveSheet();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-sheet-close]')) {
      closeActiveSheet();
    }
  });

  activeCleanup = () => {
    window.removeEventListener('keydown', onKeyDown);
    document.body.style.overflow = prevOverflow;
    if (typeof onClose === 'function') {
      try {
        onClose();
      } catch {}
    }
    backdrop.remove();
  };

  return backdrop.querySelector('[data-sheet-panel]');
}

/* ── Personal Rating Sheet (`/api/library/rating`) ──────────── */

export function openRatingSheet({ provider, id, title, year = '', poster = '', isSeries = false, officialRating = null }) {
  const current = library.ratingFor(provider, id) || 0;
  const entry = {
    provider,
    id,
    title,
    media_type: isSeries ? 'series' : 'movie',
    year,
    poster_url: poster,
    official_rating: officialRating,
  };

  const panel = mountModalShell({
    maxWidth: 'max-w-[400px]',
    ariaLabel: `Rate ${title}`,
    contentHtml: `
      <div class="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div class="min-w-0">
          <div class="t-title">Rate title</div>
          <div class="mt-0.5 truncate text-[13px] text-fg-2">${escapeHtml(title)}</div>
        </div>
        <button type="button" data-sheet-close aria-label="Close" class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fill text-fg-2 hover:bg-fill-2 hover:text-fg">
          ${iconHtml('x', { size: 16 })}
        </button>
      </div>
      <div class="px-5 pt-2 pb-5">
        <div class="grid grid-cols-5 gap-2">
          ${Array.from({ length: 10 }, (_, idx) => {
            const val = idx + 1;
            const on = current === val;
            return `<button
              type="button"
              data-rate-val="${val}"
              class="flex h-11 items-center justify-center rounded-[10px] text-[14px] font-bold transition ${
                on ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
              }"
            >★ ${val}</button>`;
          }).join('')}
        </div>
        ${
          current
            ? `<button type="button" data-rate-clear class="mt-3 flex h-10 w-full items-center justify-center rounded-[10px] bg-fill text-[13.5px] font-medium text-danger hover:bg-fill-2">
                 Remove rating (${current}/10)
               </button>`
            : ''
        }
      </div>`,
  });

  panel.addEventListener('click', async (e) => {
    const valBtn = e.target.closest('[data-rate-val]');
    if (valBtn) {
      const rating = Number(valBtn.dataset.rateVal);
      closeActiveSheet();
      try {
        await library.setRating(entry, rating);
        toast(`Rated “${title}” ${rating}/10`);
      } catch (err) {
        toast(err?.message || 'Could not save rating.', 'error');
      }
      return;
    }
    if (e.target.closest('[data-rate-clear]')) {
      closeActiveSheet();
      try {
        await library.setRating(entry, 0);
        toast('Rating removed');
      } catch (err) {
        toast(err?.message || 'Could not remove rating.', 'error');
      }
    }
  });
}

/* ── MovieBox-TUI Backend & Access Key Sheet ─────────────────── */

export function openEngineSheet({ focusKey = false } = {}) {
  const mode = api.state.engine;
  const version = api.state.version ? `v${api.state.version}` : '';
  const hasKey = Boolean(api.getAccessKey());

  const panel = mountModalShell({
    maxWidth: 'max-w-[460px]',
    ariaLabel: 'Engine and settings',
    contentHtml: `
      <div class="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <div class="t-title">Engine &amp; Preferences</div>
          <div class="mt-0.5 text-[13px] text-fg-2">
            MovieBox-TUI backend ${version ? `(${escapeHtml(version)})` : ''} · ${escapeHtml(mode)}
          </div>
        </div>
        <button type="button" data-sheet-close aria-label="Close" class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fill text-fg-2 hover:bg-fill-2 hover:text-fg">
          ${iconHtml('x', { size: 16 })}
        </button>
      </div>

      <div class="space-y-4 overflow-y-auto px-5 pt-2 pb-5">
        <!-- Active Catalog Source -->
        <div>
          <div class="t-eyebrow mb-2 text-fg-2">Catalog Source</div>
          <div class="flex flex-wrap gap-1.5">
            ${state.providers
              .map((p) => {
                const on = p.id === state.provider;
                return `<button
                  type="button"
                  data-engine-source="${escapeHtml(p.id)}"
                  class="inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold transition ${
                    on ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
                  }"
                >${escapeHtml(providerLabel(p.id))}</button>`;
              })
              .join('')}
          </div>
        </div>

        <!-- Appearance -->
        <div>
          <div class="t-eyebrow mb-2 text-fg-2">Appearance</div>
          <div class="flex gap-1.5">
            ${['dark', 'light', 'system']
              .map((th) => {
                const on = state.theme === th;
                return `<button
                  type="button"
                  data-engine-theme="${th}"
                  class="inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold capitalize transition ${
                    on ? 'pill-selected' : 'bg-fill text-fg hover:bg-fill-2'
                  }"
                >${th}</button>`;
              })
              .join('')}
          </div>
        </div>

        <!-- Access Key (X-MovieBox-Key) -->
        <form data-key-form class="space-y-2 border-t border-edge pt-3.5">
          <div class="t-eyebrow text-fg-2">Access Key</div>
          <p class="text-[12.5px] text-fg-2">
            If your MovieBox-TUI server was started with <code class="rounded bg-fill px-1.5 py-0.5 text-[11.5px]">--api-key</code>, enter it below.
          </p>
          <div class="flex gap-2">
            <input
              type="password"
              data-key-input
              placeholder="${hasKey ? '•••••••• (saved)' : 'Enter X-MovieBox-Key…'}"
              autocomplete="off"
              class="field h-9 flex-1 rounded-[8px] px-3 text-[13.5px]"
            />
            <button type="submit" class="pill-selected inline-flex h-9 items-center rounded-[8px] px-4 text-[13px] font-semibold">
              Save
            </button>
            ${
              hasKey
                ? `<button type="button" data-key-clear class="inline-flex h-9 items-center rounded-[8px] bg-fill px-3 text-[13px] font-semibold text-danger hover:bg-fill-2">Clear</button>`
                : ''
            }
          </div>
        </form>
      </div>`,
  });

  if (focusKey) {
    panel.querySelector('[data-key-input]')?.focus();
  }

  panel.addEventListener('click', async (e) => {
    const srcBtn = e.target.closest('[data-engine-source]');
    if (srcBtn) {
      const next = srcBtn.dataset.engineSource;
      setProvider(next);
      closeActiveSheet();
      toast(`Source switched to ${providerLabel(next)}`);
      window.dispatchEvent(new CustomEvent('ifallhub:refresh-view'));
      return;
    }

    const thBtn = e.target.closest('[data-engine-theme]');
    if (thBtn) {
      applyTheme(thBtn.dataset.engineTheme);
      closeActiveSheet();
      return;
    }

    if (e.target.closest('[data-key-clear]')) {
      api.setAccessKey('');
      clearPlayerSupportCache();
      await api.checkEngine();
      closeActiveSheet();
      toast('Access key cleared');
      window.dispatchEvent(new CustomEvent('ifallhub:refresh-view'));
    }
  });

  panel.querySelector('[data-key-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = panel.querySelector('[data-key-input]')?.value.trim() || '';
    api.setAccessKey(val);
    clearPlayerSupportCache();
    await api.checkEngine();
    await library.refresh().catch(() => {});
    closeActiveSheet();
    toast(val ? 'Access key saved' : 'Access key updated');
    window.dispatchEvent(new CustomEvent('ifallhub:refresh-view'));
  });
}
