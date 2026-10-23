# Web Player Deployment (Render)

The browser player in `web/` is backed by the same Rust engine as the terminal
UI: the same provider clients, search, details, season/episode handling, stream
resolution, and playback code in `src/web_api.rs`, `src/service.rs`, and
`src/providers/`. The browser never receives provider auth headers; resolved
stream details stay on the server and the player only receives short-lived,
same-origin `/api/media/...` URLs.

## Use a Render Web Service (Docker) - not a Static Site

The repository's `.github/workflows/pages.yml` deploys the **mdBook
documentation only**; it does not deploy the movie web app. GitHub Pages and
other static hosts cannot run the Rust API. Deploy the app as a **single Render
Web Service built from the repository `Dockerfile`** instead. Do **not** deploy
`web/dist` as a static site: the Vite demo API is development-only and is not
part of the production build, so a static host has no `/api/*` backend and real
search/playback cannot work.

The production container runs two processes behind one public origin:

```
browser ──► deploy/server.mjs ── 0.0.0.0:$PORT (public)
                │  serves web/dist (Vite build, hashed assets)
                │  edge rate limits + security headers
                └──► /api/* ──► moviebox-tui --web-api 127.0.0.1:8787
                                 (loopback only, never launched as a TUI)
```

- `deploy/server.mjs` binds `0.0.0.0:$PORT` (Render injects `PORT`).
- The Rust API is spawned internally on `127.0.0.1:8787` and is never exposed.
- `/api/media/*` streams HLS/DASH manifests, media segments, and byte-range
  responses through without buffering video on the server.
- `/api/library/events` is a server-sent-events stream (watchlist/progress/rating
  updates). The proxy disables retries, idle timeouts and buffering for it, so
  browsers stay live-synced without polling.

## Deploy with the Render Blueprint

1. Fork or push this repository to GitHub.
2. In the Render dashboard choose **New → Blueprint** and select the repository.
   Render reads `render.yaml`, which declares one `web` service with the Docker
   runtime and a `/api/health` health check.
3. Confirm the plan and create the service. Render builds the multi-stage
   `Dockerfile` and starts the container.
4. Open the service URL. The engine badge should turn green ("Engine
   connected"), and the access-key dialog appears when
   `MOVIEBOX_WEB_API_TOKEN` is set (the Blueprint generates one automatically).

You can also create the service manually: **New → Web Service →** pick the
repository → set **Environment** to `Docker` (do not pick "Static Site") →
keep the root `Dockerfile` → set **Health Check Path** to `/api/health`.

## Configuration

All configuration is environment-only. Secrets belong in the Render dashboard
(or your platform's secret store) - never in the repository or the image.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Public port. Render sets this automatically; the server binds `0.0.0.0:$PORT`. |
| `MOVIEBOX_WEB_API_TOKEN` | unset | Optional shared access key for the JSON API (`/api/health` and `/api/media/*` stay reachable by design). The web UI prompts for it. |
| `MOVIEBOX_WEB_API_RATE_PER_MIN` | `300` | Per-client request budget inside the Rust API (`0` disables). |
| `MOVIEBOX_WEB_RATE_LIMIT` | `300` | Edge rate limit for `/api/*` per client per minute (`0` disables). |
| `MOVIEBOX_WEB_MEDIA_RATE_LIMIT` | `1200` | Edge rate limit for `/api/media/*` segments (`0` disables). A long DASH movie makes many segment requests, so keep this generous. |
| `MOVIEBOX_DATA_DIR` | platform default | Data directory. The web library (watchlist, resume progress, personal ratings) is stored here as `web_library.json`. Mount a volume to keep it across deploys. |
| `MOVIEBOX_API_ADDR` | `127.0.0.1:8787` | Loopback address of the spawned Rust API. |
| `MOVIEBOX_WEB_LOCAL_PLAYER` | auto | `0` disables the "Open in VLC" handoff. By default the API can launch a detected VLC/mpv/IINA when it inherits a graphical session; a hosted container has neither, so the button copies the link instead. |
| `MOVIEBOX_WEB_PLAYER_BASE` | bind address | Base URL the launched player uses to reach `/api/media/*`. Wildcard binds become `http://127.0.0.1:<port>`; set this when the player runs on another device. |
| `MOVIEBOX_WYZIE_KEY` | unset | Optional free [Wyzie Subs](https://docs.wyzie.io/subs/intro) key. Set it to include Wyzie in the public subtitle fan-out; without it OpenSubtitles v3 and Podnapisi still answer. The key stays server-side. |
| `MOVIEBOX_WEB_ROOT` | `web/dist` | Static asset root inside the container. |
| `MOVIEBOX_LOG` | `info` | Rust log level (`off`…`trace`). |
| `MOVIEBOX_FOURKHDHUB_URL` | unset | Custom 4KHDHub base URL (same as the TUI). |

### Web library and live sync

`GET/POST /api/library*` store the watchlist, resume points and 1-10 personal
ratings on the server, so one deployment keeps the same library across browsers
and devices. `GET /api/library/events` pushes every change to connected clients.
`EventSource` cannot send custom headers, so on a token-protected deployment the
browser authenticates the event stream with the `moviebox_key` cookie (the API
already accepts that cookie form); without it the client falls back to polling
`/api/library` every 8 seconds.

### Open in VLC

`GET /api/player` reports whether this API can start a media player, and
`POST /api/player/open` starts one with a loopback `/api/media/*` URL for the
selected release (provider headers stay server-side). The player runs on the
machine that hosts the API, so a public deployment answers
`{ "available": false }` and the web UI falls back to copying the link. Launching
a player also needs the `MOVIEBOX_WEB_API_TOKEN` like any other JSON route; keep
that in mind if you expose the API to untrusted clients.

### Access protection

Set `MOVIEBOX_WEB_API_TOKEN` (Render's Blueprint does this with
`generateValue: true`, so the value is generated and stored as a secret). When
set, every JSON API route requires the key via one of:

- `X-MovieBox-Key: <token>`
- `Authorization: Bearer <token>`
- a `moviebox_key=<token>` cookie

`/api/health` stays open so Render's health probe works, and `/api/media/*`
is guarded instead by its unguessable per-session playback tokens (issued only
after an authenticated `/api/play`), so `<video>` and Shaka requests keep
working without custom headers.

### Rate limits

Both layers throttle per client address (`X-Forwarded-For` from the edge,
socket peer otherwise): the Node edge server and the Rust API. Health checks
and media segments are exempt from the API-level budget; media has its own
higher limit. Tune the values above for your audience, and keep them enabled on
any public deployment.

## Local production run

With Docker:

```sh
docker build -t moviebox-web .
docker run --rm -p 3000:3000 -e MOVIEBOX_WEB_API_TOKEN=devkey moviebox-web
```

Without Docker (Node 22+ and the Rust toolchain):

```sh
cd web && npm ci && npm run build && cd ..
cargo build --release
MOVIEBOX_API_BIN=target/release/moviebox-tui PORT=3000 node deploy/server.mjs
```

Then run the smoke checks:

```sh
node deploy/smoke.mjs --base http://127.0.0.1:3000 --token devkey
# Optional end-to-end attempt against live providers:
node deploy/smoke.mjs --base http://127.0.0.1:3000 --token devkey --real
```

## What the proxy preserves

- Provider headers and upstream stream details stay server-side; the browser
  only sees `/api/media/{session}/...` URLs on the same origin.
- HLS/DASH manifests are fetched and rewritten so every segment, key, and
  subtitle URI is re-routed through `/api/media/...`.
- The watch page can also search MovieBox captions by the verified title/year
  (and season/episode for series). `/api/subtitles` returns language choices;
  `/api/subtitle-file` fetches the selected caption server-side from trusted
  MovieBox CDNs, avoiding browser CORS and keeping provider URLs private.
- Media segments and byte-range (`Range`/`If-Range`) requests are streamed
  through without buffering the video, and `Content-Range`/`Content-Length`
  are forwarded so seeking works.

## Troubleshooting

- **"Engine offline" badge** - the Rust API is not answering; check the Render
  logs for `moviebox-tui` startup lines and `deploy/server.mjs` proxy errors.
- **401 responses** - `MOVIEBOX_WEB_API_TOKEN` is set; enter the key when the
  app asks, and make sure automated clients send `X-MovieBox-Key`.
- **429 responses** - a client exceeded the rate budget; raise the limits or
  wait for the window to refill.
- **Search returns 502** - the provider was unreachable from the service;
  providers occasionally block datacenter IPs. Try again later or configure
  `MOVIEBOX_FOURKHDHUB_URL`/add-ons.
- **Every title says "No streams on this source"** - between 2026-10-13 and
  2026-10-23 the MovieBox API answered `play-info`/`resource` with a short
  placeholder clip for every title, so nothing was playable anywhere. The engine
  now recovers the real signed MP4 through `resource-position/v2` and caches
  under a new schema, so a redeploy of this commit is enough: stream caches
  written against the placeholder are ignored automatically and no manual
  volume cleanup is needed. Verify the deployed service with
  `node deploy/smoke.mjs --base https://<service> --token <key> --real`, which
  walks search -> streams -> play and fetches real media bytes.
- **"Playback error" / video never starts** - usually an HEVC (`hvc1`/`hev1`)
  DASH stream or a `.mkv` direct link, which browsers cannot decode. The player
  now ranks those releases behind playable H.264/`.mp4` links, marks them in the
  stream list, and reports the real cause (codec, HTTP status, expired link);
  expired signed cookies (`403`) and expired stream sets (`410`) trigger an
  automatic stream-list refresh before giving up. Diagnose the rest with
  `python3 scripts/check_playback_links.py`; the full cause table and every link
  the player uses are in [`playback-links.md`](playback-links.md).

## Vercel

Vercel is supported as a container-image Function: `Dockerfile.vercel` builds the
same frontend plus Rust engine stack and Vercel routes all traffic to it. Storage
there is ephemeral (state lives under `/tmp`), and instances scale to zero when
idle. See [vercel-deployment.md](vercel-deployment.md).

## Scope and compliance

Streams come from the providers and add-ons you configure. Only use this with
content you have the right to access, and follow the laws and terms that apply
to you. The maintainers do not operate any provider.
