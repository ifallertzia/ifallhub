#!/bin/sh
# Install step for the public `site` service on Vercel services.
#
# Deliberately does not use `npm --prefix`: Vercel's build sandbox ran that from
# a directory where the prefix did not resolve, so npm reported "can only
# install with an existing package-lock.json" even though web/package-lock.json
# is committed. Resolving our own path and changing into web/ works from any
# working directory the platform picks.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ ! -d "$root/web" ]; then
  echo "[site] web/ not found under $root" >&2
  exit 1
fi
cd "$root/web"

echo "[site] node $(node --version 2>/dev/null || echo '?'), npm $(npm --version 2>/dev/null || echo '?')"
echo "[site] installing in $(pwd)"

if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  # The lockfile is committed; this only keeps a stripped checkout buildable.
  echo "[site] no package-lock.json here, falling back to npm install" >&2
  npm install --no-audit --no-fund
fi
