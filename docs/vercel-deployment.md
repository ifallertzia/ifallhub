# Vercel Deployment (services)

The web player deploys to Vercel as a **project with two services**: a public
Node service that serves the built frontend and proxies `/api/*`, and an
internal Rust service that runs the engine (`moviebox-tui --web-api`).

```
browser ──► site  (public, node)          0.0.0.0:$PORT (Vercel assigns)
              │  serves web/dist, SPA fallback, rate limits, streaming proxy
              └──► /api/*  ──►  api  (internal, rust)   $PORT
                                 moviebox-tui --web-api
```

The browser only ever talks to one origin, exactly like the Docker/Render
deployment, so there is no CORS, the access-key cookie keeps working, and
`/api/media/*` keeps streaming ranges through a proxy that never buffers video.

## `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": {
    "site": {
      "root": ".",
      "runtime": "node",
      "installCommand": "npm ci --prefix web",
      "buildCommand": "npm run build --prefix web",
      "entrypoint": "deploy/vercel-app.sh",
      "bindings": [
        { "type": "service", "service": "api", "format": "url", "env": "API_URL" }
      ]
    },
    "api": {
      "root": ".",
      "runtime": "rust",
      "buildCommand": "cargo build --release --locked",
      "entrypoint": "deploy/vercel-api.sh"
    }
  },
  "rewrites": [
    { "source": "/(.*)", "destination": { "service": "site" } }
  ]
}
```

- **`site`** is the only service with public traffic (the catch-all rewrite).
- **`api`** is internal: it has no rewrite and is reachable only through the
  `API_URL` binding declared on `site`.
- The binding injects the API's internal base URL into `site` at runtime;
  `deploy/vercel-app.sh` refuses to start when neither `API_URL` nor
  `MOVIEBOX_API_TARGET` is present, so a broken binding fails loudly instead of
  silently proxying to loopback.
- `deploy/server.mjs` reads `MOVIEBOX_API_TARGET` first (manual override) and
  `API_URL` second (the binding), normalises a trailing slash, and never spawns
  a child engine when an external target is configured.
- `deploy/vercel-api.sh` runs `moviebox-tui --web-api`. The engine resolves its
  listen address as `--web-api ADDR` → `MOVIEBOX_WEB_API_ADDR` → `PORT`
  (`0.0.0.0:$PORT`) → `127.0.0.1:8787`, so a managed host that injects `PORT`
  is reachable over the container network and a local run stays on loopback.

## Environment variables

Set these on the Vercel project (all services inherit them):

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOVIEBOX_WEB_API_TOKEN` | unset | Shared access key. When set, the app asks for it once and stores it in the browser. |
| `MOVIEBOX_WEB_RATE_LIMIT` | `300` | JSON API requests/minute/client at the `site` edge. |
| `MOVIEBOX_WEB_MEDIA_RATE_LIMIT` | `1200` | `/api/media/*` requests/minute/client. |
| `MOVIEBOX_LOG` | `warn` | Engine log level (`off`…`trace`). |
| `MOVIEBOX_DATA_DIR` | `/tmp/ifallhub/data` | Library, caches, resume points. |
| `MOVIEBOX_CONFIG_DIR` | `/tmp/ifallhub/config` | Config and favorites. |
| `MOVIEBOX_FOURKHDHUB_URL` | built-in | Custom 4KHDHub base URL. |
| `MOVIEBOX_WYZIE_KEY` | unset | Optional key for public subtitle search. |

`API_URL` is **not** set by hand: Vercel injects it from the binding. Do not set
`MOVIEBOX_WEB_API_TARGET` in production either unless you deliberately point the
frontend at another backend (that variable overrides the binding).

## Deploy

1. Import the repository in Vercel. `vercel.json` is detected automatically;
   keep the project **root** at the repository root.
2. Add the environment variables above for Production (and Preview if you want
   previews to work).
3. Deploy. Both services build independently: the `site` service runs
   `npm ci`/`npm run build` inside `web/`, and the `api` service compiles the
   engine with `cargo build --release --locked`.
4. Open the deployment URL. `/api/health` must answer
   `{"engine":"MovieBox-Tui","status":"ok","version":"0.1.27"}`.

Verify a deployment from a machine with the repository checked out:

```bash
node deploy/smoke.mjs --base https://<project>.vercel.app --token <key> --real
```

`--real` walks search → streams → play and pulls the first kilobyte of real
media through the proxy, which is the check that catches provider outages.

## Limits you should know about

- **Storage is ephemeral.** The watchlist, resume points, ratings and stream
  caches live on the service's filesystem and are reset by every new deployment
  (and whenever the instance is replaced). For durable state, either keep
  `/api` on a host with a persistent disk (see
  [web-deployment.md](web-deployment.md)) or mount a volume and point
  `MOVIEBOX_DATA_DIR` at it.
- **Media bandwidth.** Playback bytes flow through the `site` service and count
  against the plan's bandwidth and transfer limits. A hosted deployment is best
  suited to a handful of viewers; heavy watching is cheaper in the TUI or with
  "Open in VLC" pointing at a home machine.
- **No local player.** There is no desktop session on Vercel, so "Open in VLC"
  degrades to copying the link (`deploy/vercel-api.sh` sets
  `MOVIEBOX_WEB_LOCAL_PLAYER=0`).
- **Cold starts and long requests.** Provider searches can take several seconds;
  keep rate limits sane and expect the first request after idle to be slower
  while the engine service wakes.
- **Server-sent events.** `/api/library/events` is proxied without buffering,
  but a platform proxy may still cut a long-lived stream. The client falls back
  to polling automatically, so syncing keeps working either way.

## Alternatives

- **Static frontend, separate API.** Point the `site` service at
  `web/` with `framework: "vite"` and rewrite `/api/(.*)` directly to the `api`
  service. That drops the Node proxy, but Vercel then serves `web/dist` without
  SPA fallback knowledge, so client routes such as `/watch/moviebox/123` can
  404 on refresh unless the platform applies an index fallback.
- **Frontend on Vercel, engine on Render.** Keep this repository's Render
  blueprint for `/api` and proxy to it with `MOVIEBOX_API_TARGET`; this adds a
  cross-origin hop, so it needs explicit CORS on the engine and is not the
  default here.
