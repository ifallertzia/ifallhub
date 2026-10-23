# Vercel Deployment

The web player deploys to Vercel as **one container-image Function**: the same
Docker stack used for Render, built by Vercel from `Dockerfile.vercel` at the
repository root. Node serves the built frontend on `$PORT` and reverse-proxies
`/api/*` to the headless Rust engine inside the same container, so the browser
always talks to a single origin.

```
browser ──► Vercel route ──► container (Dockerfile.vercel)
                              ├─ node deploy/server.mjs      :80 (or $PORT)
                              └─ moviebox-tui --web-api      127.0.0.1:8787
```

## Why a container, not a Rust service

Vercel's `rust` runtime runs a **Function** built from the `vercel_runtime`
crate - one request in, one response out. This project's engine is a long-lived
HTTP server, and Vercel also does not support service bindings for services on
the Go or Rust runtime. The earlier two-service layout (Node `site` + Rust
`api` with an `API_URL` binding) therefore could not work: even after the build
was fixed, there was no supported way to run or reach the engine.

The container runtime has none of those limits: it runs any OCI image, listens
on a port, and supports bindings. That is exactly the deployment shape this
repository already used for Render, so `Dockerfile.vercel` builds the same two
artifacts the root `Dockerfile` does.

## Configuration

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": {
    "app": {
      "root": ".",
      "runtime": "container",
      "entrypoint": "Dockerfile.vercel"
    }
  },
  "rewrites": [
    { "source": "/(.*)", "destination": { "service": "app" } }
  ]
}
```

One service, built from `Dockerfile.vercel`, published by the single catch-all
rewrite. Declaring the service explicitly (instead of relying on auto-detection)
keeps a project-level framework preset from taking over the build, and a
container service needs no binding. Do **not** reintroduce a service on the
`rust` runtime: that runtime compiles a `vercel_runtime` Function, which cannot
host this long-running engine, and Rust/Go services cannot hold bindings.

`Dockerfile.vercel` differs from the Render `Dockerfile` in three documented ways,
and `web/tests/vercel-config.test.js` keeps the rest of the two files identical:

| Difference | Why |
| --- | --- |
| `ENV PORT=80` + `EXPOSE 80` | Vercel sends container traffic to port 80 unless `PORT` is set in project settings |
| runs as root (no `USER node`) | binding port 80 inside the container needs privileges |
| `MOVIEBOX_DATA_DIR`/`CONFIG_DIR` under `/tmp` | the container filesystem is read-only, `/tmp` is the writable scratch space |
| thin LTO + 16 codegen units | keeps the Rust build inside a two-core builder's budget while `Cargo.toml` keeps fat LTO for local/CI |

## Environment variables

Set these on the Vercel project:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOVIEBOX_WEB_API_TOKEN` | unset | Shared access key. When set, the app asks for it once and stores it in the browser. |
| `PORT` | `80` | Only needed if your plan forbids port 80; the image and server follow it. |
| `MOVIEBOX_LOG` | `warn` | Engine log level (`off`…`trace`). |
| `MOVIEBOX_FOURKHDHUB_URL` | built-in | Custom 4KHDHub base URL. |
| `MOVIEBOX_WYZIE_KEY` | unset | Optional key for public subtitle search. |

`MOVIEBOX_API_TARGET` / `API_URL` remain supported by `deploy/server.mjs` if you
ever want the frontend container to proxy to an engine hosted elsewhere (Render,
a VPS). Without them the server starts the bundled engine on loopback.

## Deploy

1. Import the repository in Vercel and keep the project root at the repository
   root. Container detection needs `Dockerfile.vercel` to be uploaded, which
   `.vercelignore` guarantees (`/Dockerfile` is excluded, `!Dockerfile.vercel`
   re-includes the Vercel one).
2. Add the environment variables above.
3. Deploy. The build log shows the Vite build, the `cargo build --release`
   stage, and then `MovieBox-Tui web API listening on http://127.0.0.1:8787`
   once traffic starts.
4. Check the deployment:

   ```bash
   curl -s https://<project>.vercel.app/api/health
   # {"engine":"MovieBox-Tui","status":"ok",...}

   node deploy/smoke.mjs --base https://<project>.vercel.app --token <key> --real
   ```

   `--real` walks search → streams → play and pulls the first kilobyte of real
   media through the proxy, which is what catches provider outages.

The same image is built and smoke-tested in CI (`image` job in
`.github/workflows/web-deploy.yml`), so a broken container fails the pull
request before it reaches Vercel.

## Limits you should know about

- **Storage is ephemeral.** Watchlist, resume points, ratings and stream caches
  live in `/tmp/ifallhub` and are lost on every new deployment or scale-to-zero
  cycle. For durable state keep the engine on a host with a persistent disk (see
  [web-deployment.md](web-deployment.md)) or add a managed store.
- **Scale to zero.** Container Functions scale down after about five minutes
  without traffic (30 seconds in preview), so the first request afterwards pays
  a cold start: node boots, then the engine starts and resolves its provider
  session.
- **Request duration.** Very long media responses can exceed the Function
  duration limit. The player uses range requests and short segments, which is
  why playback works, but a single multi-hour progressive download is not the
  intended path on Vercel.
- **Bandwidth.** Media bytes flow through the Function and count against the
  plan's fast data transfer.
- **Image size and build time.** The image carries the Node runtime and a static
  musl engine binary; expect the first build to take several minutes.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails with `npm ci ... can only install with an existing package-lock.json` | a custom install command resolving outside `web/` | the container runs `npm ci` inside `web/`; do not add an `installCommand` |
| Build succeeds, deployment 502s | the container is not listening on the port Vercel routes to | keep `ENV PORT=80` (or set `PORT` in project settings to match) |
| `EACCES` writing state | the container filesystem is read-only | keep `MOVIEBOX_DATA_DIR`/`MOVIEBOX_CONFIG_DIR` under `/tmp` |
| `/api/health` returns `{"engine": ...}` but searches fail | the engine cannot reach the provider from Vercel's region, or the provider is down | check the Function logs and `python3 scripts/check_playback_links.py` |
| Container exits immediately | the engine binary is missing or the frontend build failed | read the build log; the image asserts both (`--version` and `dist/index.html`) |

## Alternatives

- **Render Web Service** with the root `Dockerfile` and `render.yaml`: persistent
  disk, no scale-to-zero, health checks. See [web-deployment.md](web-deployment.md).
- **Frontend static + engine elsewhere**: deploy `web/dist` on Vercel and point
  `MOVIEBOX_API_TARGET` at an engine you host; this adds a cross-origin hop, so
  the engine has to allow CORS.
