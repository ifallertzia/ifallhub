# Ifallhub Web

A Netflix/IMDb-style browser UI for the MovieBox-Tui provider, search and playback
pipeline. The Rust API reuses the same provider clients and stream resolvers as the
terminal UI; the browser never receives provider auth headers. A short-lived local
playback session proxies the selected stream so DASH/HLS manifests and byte-range
requests work through the browser player.

On top of search and playback the web app is a full tracking client:

- **Open in VLC** — every title page and the player page have an "Open in VLC"
  button next to Play. The Rust engine resolves the selected release and starts
  VLC / mpv / IINA on the same machine with a loopback media URL, which is what
  makes H.265/HEVC, `.mkv` and DASH releases playable even when the browser
  cannot decode them. When the deployment has no local player (a hosted server),
  the button copies the link and shows paste-into-VLC instructions instead.

- **Playback links** — the player page lists every link the player is handed
  (provider · quality · mirror · stream type) with its full URL, a per-link
  "Copy link" button and a "Copy all" button, so an H.265/HEVC or `.mkv` release
  the browser cannot decode can be pasted into mpv/VLC. `⧉ Copy link` in the page
  actions copies the URL playback is using right now. These links are short-lived
  proxy/session URLs: they are never stored or sent anywhere else.

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
- `GET /api/player` — which local players (VLC, mpv, IINA, Android) this machine
  can launch, plus the reason when it cannot launch any
- `GET /api/subtitles?title=…&year=…&season=0&episode=0` — caption search. The
  engine's own MovieBox captions and the public providers are queried at the same
  time and merged into one ranked list (English first, then Hindi, then the rest;
  popularity breaks ties). Answers `{ subtitle_set_id, sources, subtitles: [{ index,
  name, language, source, format, downloads, hearing_impaired }] }`.
- `GET /api/subtitle-file?set_id=…&index=0` — downloads one entry and returns
  `{ text, name, source, language }` as plain text (SRT/WebVTT/ASS; zip and gzip
  archives are unpacked server-side).
- `POST /api/player/open` with `{ "stream_set_id": "…", "release_index": 0,
  "player": "vlc", "resume_seconds": 754 }` — "Open in VLC": resolves the
  release and starts the player **on the machine running the API** on a loopback
  media URL, so provider headers never leave the server. Answers `409` with
  `{ available: false, players: [] }` when no player can be launched; the UI then
  copies the playback link for manual playback instead.

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

### Subtitles

Captions come from public, key-free providers, always fetched by the Rust API
(there is no CORS problem and no third-party key in the browser):

- **OpenSubtitles v3** — the public Stremio add-on. The title is resolved to an
  IMDb id through Cinemeta, then `/subtitles/movie/<id>.json` or
  `/subtitles/series/<id>:<season>:<episode>.json` is queried.
- **Podnapisi** — key-free XML search by title/year/season.
- **Wyzie Subs** — joins the fan-out only when `MOVIEBOX_WYZIE_KEY` (or
  `WYZIE_API_KEY`) is set, because it needs a free API key. The key stays on the
  server.

Provider results are merged with the engine's MovieBox captions, and every
download is re-validated against an explicit provider host allowlist, even after
redirects. The player turns the best match on automatically (English first, then
Hindi) — switch it off with the "Load subtitles automatically" checkbox in the
subtitle panel, or pick any language there.

On phones the player collapses to one horizontal bar (play/pause + fullscreen);
every other control lives inside fullscreen, which fills the whole screen.

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
