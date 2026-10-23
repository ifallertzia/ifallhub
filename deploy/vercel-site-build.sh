#!/bin/sh
# Build step for the public `site` service on Vercel services.
#
# Produces web/dist, which deploy/server.mjs serves. Runs from the repository
# root regardless of the directory the platform invokes it in.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root/web"

echo "[site] building in $(pwd)"
npm run build

if [ ! -f dist/index.html ]; then
  echo "[site] build finished without dist/index.html" >&2
  exit 1
fi
echo "[site] web/dist ready"
