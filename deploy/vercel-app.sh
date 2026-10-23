#!/usr/bin/env bash
# Entrypoint for the public `site` service on Vercel services.
#
# Serves the built frontend from web/dist and reverse-proxies same-origin
# `/api/*` to the internal Rust `api` service. The API base URL arrives through
# the service binding declared in vercel.json (`API_URL`), so nothing here
# hardcodes a host or port; MOVIEBOX_API_TARGET still overrides it for local
# runs and other hosts.
set -euo pipefail

cd "$(dirname "$0")/.."

export HOST="${HOST:-0.0.0.0}"

if [ -z "${MOVIEBOX_API_TARGET:-}" ] && [ -z "${API_URL:-}" ]; then
  echo "[moviebox-web] neither API_URL (service binding) nor MOVIEBOX_API_TARGET is set" >&2
  echo "[moviebox-web] the /api proxy needs the api service's internal URL" >&2
  exit 1
fi

if [ -n "${API_URL:-}" ] && [ -z "${MOVIEBOX_API_TARGET:-}" ]; then
  echo "[moviebox-web] api service bound at ${API_URL}"
fi

exec node deploy/server.mjs
