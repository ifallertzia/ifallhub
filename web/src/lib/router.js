// Minimal history router for the SPA shell.

export const ROUTES = [
  { name: 'home', pattern: /^\/$/ },
  { name: 'search', pattern: /^\/search$/ },
  { name: 'mylist', pattern: /^\/mylist$/ },
  { name: 'tracker', pattern: /^\/tracker$/ },
  { name: 'genre', pattern: /^\/genre\/([^/]+)$/ },
  { name: 'details', pattern: /^\/title\/([^/]+)\/(.+)$/ },
  { name: 'watch', pattern: /^\/watch\/([^/]+)\/(.+)$/ },
];

export function parseRoute(location = window.location) {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(location.search);
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (!match) continue;
    const params = {};
    if (route.name === 'details' || route.name === 'watch') {
      params.provider = decodeURIComponent(match[1]);
      params.id = decodeURIComponent(match[2]);
    }
    if (route.name === 'genre') params.genre = decodeURIComponent(match[1]);
    return { name: route.name, path, query, params };
  }
  return { name: 'home', path: '/', query, params: {} };
}

const handlers = new Set();

export function onRoute(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

let currentPath = '';

export async function handleRoute() {
  const route = parseRoute();
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

export function back(fallback = '/') {
  if (window.history.length > 1) {
    window.history.back();
    return Promise.resolve();
  }
  return navigate(fallback, { replace: true });
}

export function start() {
  window.addEventListener('popstate', () => handleRoute());
  return handleRoute();
}

/** Builds a title URL that survives reloads and can be shared. */
export function titlePath(provider, id, extra = '') {
  return `/title/${encodeURIComponent(provider)}/${encodeURIComponent(id)}${extra}`;
}

export function watchPath(provider, id, { season = 0, episode = 0 } = {}) {
  const query = new URLSearchParams();
  if (season) query.set('s', String(season));
  if (episode) query.set('e', String(episode));
  const suffix = query.toString() ? `?${query}` : '';
  return `/watch/${encodeURIComponent(provider)}/${encodeURIComponent(id)}${suffix}`;
}
