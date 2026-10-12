# Ifallhub Web

A Netflix/IMDb-style browser UI for the MovieBox-Tui provider, search and playback
pipeline. The Rust API reuses the same provider clients and stream resolvers as the
terminal UI; the browser never receives provider auth headers. A short-lived local
playback session proxies the selected stream so DASH/HLS manifests and byte-range
requests work through the browser player.

On top of search and playback the web app is a full tracking client:

- **Home carousels** — Continue Watching, Trending Now, Top Rated, Fresh & Highly
  Rated, Most Watched, plus a personalised "Because you watch" row.
- **Official ratings** — IMDb scores come from the catalog metrics and
  `/api/meta`, and are shown on cards, the title page (rating ring) and the hero.
- **Recommendations** — `/api/related` builds "More like this" from the title's
  director, genres and franchise token; the same rail appears under the player.
- **My List** — server-backed watchlist (`/api/library`).
- **Tracker** — resume points, finished titles, episode counts, hours watched and
  personal 1-10 ratings.
- **Live sync** — `GET /api/library/events` is a server-sent-events stream, so a
  change made in one tab (or on another device) appears everywhere immediately.
  When the engine predates those routes, the client falls back to `localStorage`
  and cross-tab `storage` events.

## Run locally

You need Node.js/npm and the Rust toolchain already required by MovieBox-Tui.

1. Start the local Rust API from the repository root:

   ```sh
   cargo run -- --web-api
   ```

   By default, it listens only on `127.0.0.1:8787`. Override that with an optional
   address (`cargo run -- --web-api 127.0.0.1:8787`) or `MOVIEBOX_WEB_API_ADDR`.

2. In a second terminal, start the web app:

   ```sh
   cd web
   npm ci
   IFALLHUB_API_URL=http://127.0.0.1:8787 npm run dev
   ```

   `MOVIEBOX_API_URL` is still honoured as an alias. Open the URL printed by Vite.
   On PowerShell, set the variable first:

   ```powershell
   $env:IFALLHUB_API_URL = "http://127.0.0.1:8787"
   npm run dev
   ```

3. To see the UI without starting Rust, run `npm run dev` by itself. Vite serves a
   clearly-labelled demo API with sample titles, a sample clip and an in-memory
   library (including the SSE stream). Demo mode does not call MovieBox or any
   configured provider.

## Test and build

```sh
cd web
npm test    # node:test suites: ranking/format helpers + the playback engine
            # (codec ranking, Shaka/MediaError decoding, expired-link refresh)
npm run build
```

The static site is written to `web/dist`. The production build contains no API of
its own: the Vite demo API is a development-only convenience and is not shipped in
`web/dist`. For a working deployment, do **not** publish `web/dist` as a static
site — use the repository's Docker-based Render Web Service (or any host that runs
the same container), which serves `web/dist` and proxies `/api/*` to the headless
Rust API on the same origin. See [`docs/web-deployment.md`](../docs/web-deployment.md)
for the full guide, including access-key protection and rate limits.

## API routes

Catalog and playback:

- `GET /api/health`, `GET /api/providers`
- `GET /api/discover?provider=moviebox&page=1`
- `GET /api/collections?limit=24&pages=3` — ranked carousels plus per-title metrics
- `GET /api/search?q=...&provider=moviebox&page=1`
- `GET /api/suggest?q=...` — autocomplete terms
- `GET /api/details?provider=moviebox&id=...`
- `GET /api/related?provider=moviebox&id=...&limit=18` — similar titles with reasons
- `GET /api/meta?provider=moviebox&id=a,b,c` — official rating/genres/runtime for
  up to 12 ids (card metadata, cached server-side for an hour)
- `GET /api/streams?provider=moviebox&id=...&season=0&episode=0`
- `POST /api/play` with `{ "stream_set_id": "…", "release_index": 0 }`
- `GET /api/media/{session}/{scheme}/{host}/{path}` — short-lived, same-origin media proxy

Library (watchlist, progress, ratings):

- `GET /api/library` — `{ version, synced_at, watchlist, progress, ratings }`
- `POST /api/library/watchlist` — `{ provider, id, title, …, remove? }`
- `POST /api/library/progress` — `{ provider, id, position_seconds, duration_seconds, season, episode, completed, remove? }`
- `POST /api/library/rating` — `{ provider, id, rating }` (`0` removes)
- `POST /api/library/clear` — `{ scope: "watchlist" | "progress" | "ratings" | "all" }`
- `GET /api/library/events` — server-sent events: an initial `library` frame, then
  one frame per change, plus a `ping` every 20s

Every mutation response returns the whole library, so one round trip resyncs the
client. Library data is stored in `web_library.json` under the data directory
(override with `MOVIEBOX_DATA_DIR`).

## Layout

```
web/
  index.html            app shell: sidebar, topbar search, view container, dialogs
  vite.config.js        dev proxy + demo API (development only)
  src/
    main.js             routing, navigation, global card actions, boot
    style.css           design system + all view styles
    state.js            shared client state, metadata cache, toasts
    lib/api.js          API client (access key, endpoints, capability probing)
    lib/library.js      watchlist/progress/ratings store with SSE + fallback
    lib/recommend.js    pure ranking: continue watching, related, stats
    lib/router.js       history router
    lib/format.js       escaping, labels, rating/runtime formatting
    ui/components.js    card, rail, ring and state HTML builders
    player/engine.js    server rotation, shaka/native playback, downloads
    views/*.js          home, browse, details, watch, mylist, tracker
  tests/                node:test suites for the pure helpers
```

The API binds to loopback by default. For public deployments, run it behind the
production server (`deploy/server.mjs`, included in the Docker image) and set
`MOVIEBOX_WEB_API_TOKEN` plus the edge rate limits described in
[`docs/web-deployment.md`](../docs/web-deployment.md). Use streams only when you
have the right to access them and follow the laws and terms that apply to you.
