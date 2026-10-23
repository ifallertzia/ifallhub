#!/bin/sh
# Entrypoint for the internal `api` service on Vercel services.
#
# Runs the headless Rust engine (`moviebox-tui --web-api`) as a long-lived
# process on the port the platform injects. The service is internal: it only
# receives traffic from the `site` service through the binding, never from the
# internet directly.
#
# State (watchlist, resume points, ratings, stream caches) lives on the
# container filesystem, which is ephemeral on Vercel: it survives restarts of
# the same instance but is reset by a new deployment. Point MOVIEBOX_DATA_DIR /
# MOVIEBOX_CONFIG_DIR at a mounted volume if you need it to persist.
set -eu

cd "$(dirname "$0")/.."

BIN="${MOVIEBOX_API_BIN:-./target/release/moviebox-tui}"
if [ ! -x "$BIN" ]; then
  echo "[moviebox-api] engine binary not found at $BIN (did cargo build run?)" >&2
  exit 1
fi

# Vercel gives the service a PORT; bind every interface so the platform proxy
# can reach us. An explicit address always wins.
if [ -z "${MOVIEBOX_WEB_API_ADDR:-}" ]; then
  if [ -z "${PORT:-}" ]; then
    echo "[moviebox-api] PORT is not set; falling back to 127.0.0.1:8787" >&2
  fi
  MOVIEBOX_WEB_API_ADDR="0.0.0.0:${PORT:-8787}"
fi
export MOVIEBOX_WEB_API_ADDR

# Keep writes off a possibly read-only or non-persistent home directory.
export MOVIEBOX_DATA_DIR="${MOVIEBOX_DATA_DIR:-/tmp/ifallhub/data}"
export MOVIEBOX_CONFIG_DIR="${MOVIEBOX_CONFIG_DIR:-/tmp/ifallhub/config}"
mkdir -p "$MOVIEBOX_DATA_DIR" "$MOVIEBOX_CONFIG_DIR"

# There is no desktop session on a server, so "Open in VLC" must stay off
# instead of probing for players on every request.
export MOVIEBOX_WEB_LOCAL_PLAYER="${MOVIEBOX_WEB_LOCAL_PLAYER:-0}"

echo "[moviebox-api] starting $BIN --web-api $MOVIEBOX_WEB_API_ADDR"
exec "$BIN" --web-api "$MOVIEBOX_WEB_API_ADDR"
