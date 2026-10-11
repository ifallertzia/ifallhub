# MovieBox Web Player

A small browser UI for the existing MovieBox-Tui provider/search/playback pipeline. The Rust API reuses the same provider clients and stream resolvers as the terminal UI; the browser never receives provider auth headers. A short-lived local playback session proxies the selected stream so DASH/HLS manifests and byte-range requests can work through the browser player.

## Run locally

You need Node.js/npm and the Rust toolchain already required by MovieBox-Tui.

1. Start the local Rust API from the repository root:

   ```sh
   cargo run -- --web-api
   ```

   By default, it listens only on `127.0.0.1:8787`. Override that with an optional address (`cargo run -- --web-api 127.0.0.1:8787`) or `MOVIEBOX_WEB_API_ADDR`.

2. In a second terminal, start the web app:

   ```sh
   cd web
   npm ci
   MOVIEBOX_API_URL=http://127.0.0.1:8787 npm run dev
   ```

   Open the URL printed by Vite. On PowerShell, set the variable first:

   ```powershell
   $env:MOVIEBOX_API_URL = "http://127.0.0.1:8787"
   npm run dev
   ```

3. To see the UI without starting Rust, run `npm run dev` by itself. Vite serves a clearly-labelled demo API with sample titles and a public sample clip. Demo mode does not call MovieBox or any configured provider.

## Build

```sh
cd web
npm ci
npm run build
```

The static site is written to `web/dist`. When hosting it separately, configure the web server to forward `/api/*` to the local MovieBox-Tui web API. The dev server does this automatically when `MOVIEBOX_API_URL` is set.

## API routes

- `GET /api/health` and `GET /api/providers`
- `GET /api/discover?provider=moviebox&page=1`
- `GET /api/search?q=...&provider=moviebox&page=1`
- `GET /api/details?provider=moviebox&id=...`
- `GET /api/streams?provider=moviebox&id=...&season=0&episode=0`
- `POST /api/play` with `{ "stream_set_id": "…", "release_index": 0 }`
- `GET /api/media/{session}/{scheme}/{host}/{path}` for the short-lived, same-origin media proxy

The API binds to loopback by default; do not expose it publicly without adding authentication and a deployment-specific access policy. Use streams only when you have the right to access them and follow the laws and terms that apply to you.
