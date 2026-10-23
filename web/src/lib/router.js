// Minimal history router for the Sidify-V2 Movies & Series SPA shell.

export const ROUTES = [
  { name: 'home', pattern: /^\/$/ },
  { name: 'movies', pattern: /^\/movies$/ },
  { name: 'series', pattern: /^\/series$/ },
  { name: 'browse', pattern: /^\/browse$/ },
  { name: 'search', pattern: /^\/search$/ },
  { name: 'mylist', pattern: /^\/(?:mylist|watchlist)$/ },
  { name: 'tracker', pattern: /^\/(?:tracker|history)$/ },
  { name: 'genre', pattern: /^\/genre\/([^/]+)$/ },
  { name: 'details', pattern: /^\/(?:title|movies|series)\/([^/]+)\/(.+)$/ },
  { name: 'watch', pattern: /^\/watch\/([^/]+)\/(.+)$/ },
];

export function parseRoute(location = typeof window !== 'undefined' ? window.location : '/') {
  let rawPath = '/';
  let rawSearch = '';
  if (typeof location === 'string') {
    const qIdx = location.indexOf('?');
    rawPath = qIdx >= 0 ? location.slice(0, qIdx) : location;
    rawSearch = qIdx >= 0 ? location.slice(qIdx) : '';
  } else if (location) {
    rawPath = location.pathname || '/';
    rawSearch = location.search || '';
  }
  const path = rawPath.replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(rawSearch);
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (!match) continue;
    const params = {};
    if (route.name === 'details' || route.name === 'watch') {
      params.provider = decodeURIComponent(match[1]);
      params.id = decodeURIComponent(match[2]);
    }
    if (route.name === 'genre') params.genre = decodeURIComponent(match[1]);
    return { name: route.name, path, pathname: path, query, params };
  }
  return { name: 'home', path: '/', pathname: path, query, params: {} };
}

const handlers = new Set();

export function onRoute(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

let currentPath = '';
let activeController = null;
let started = false;

export async function handleRoute() {
  if (activeController) activeController.abort();
  activeController = new AbortController();
  const route = { ...parseRoute(), signal: activeController.signal };
  currentPath = route.path + route.query.toString();
  for (const handler of handlers) await handler(route);
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('/') ? path : `/${path}`;
  if (replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  return handleRoute();
}

export function currentRoutePath() {
  return currentPath;
}

export function back(fallback = '/movies') {
  if (window.history.length > 1) {
    window.history.back();
    return Promise.resolve();
  }
  return navigate(fallback, { replace: true });
}

export function start() {
  if (!started && typeof window !== 'undefined') {
    started = true;
    window.addEventListener('popstate', () => void handleRoute());
    document.addEventListener('click', (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link = event.target instanceof Element ? event.target.closest('a[data-nav]') : null;
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        return;
      }
      event.preventDefault();
      void navigate(href);
    });
  }
  return handleRoute();
}

/** Builds a title URL that survives reloads and can be shared. */
export function titlePath(provider, id, extra = '') {
  return `/movies/${encodeURIComponent(provider)}/${encodeURIComponent(id)}${extra}`;
}

export function watchPath(provider, id, { season = 0, episode = 0 } = {}) {
  const query = new URLSearchParams();
  if (season) query.set('s', String(season));
  if (episode) query.set('e', String(episode));
  const suffix = query.toString() ? `?${query}` : '';
  return `/watch/${encodeURIComponent(provider)}/${encodeURIComponent(id)}${suffix}`;
}
