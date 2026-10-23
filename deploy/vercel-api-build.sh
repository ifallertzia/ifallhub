#!/bin/sh
# Build step for the internal `api` service on Vercel services.
#
# Compiles the headless engine (`moviebox-tui --web-api`). If the platform's
# Rust runtime is present we use its cargo; otherwise the toolchain is fetched
# once so the build does not fail on a missing compiler.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

# rustup installs into ~/.cargo/bin, which is not always on PATH in build
# images even when the toolchain is already installed.
if [ -d "${CARGO_HOME:-$HOME/.cargo}/bin" ]; then
  PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
  export PATH
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "[api] cargo not found on PATH; installing the Rust toolchain"
  if command -v curl >/dev/null 2>&1; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://sh.rustup.rs | sh -s -- -y --profile minimal
  else
    echo "[api] no curl/wget available to install Rust, and no cargo in the image" >&2
    exit 1
  fi
  PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
  export PATH
fi

echo "[api] $(cargo --version 2>/dev/null || echo 'cargo ?') building in $(pwd)"

# Cargo.toml uses fat LTO with a single codegen unit for runtime speed, which
# is very slow on a two-core builder. Thin LTO plus parallel codegen units keeps
# the binary quick while finishing inside a Vercel-sized build budget; both are
# env overrides, so nothing in Cargo.toml changes for normal builds.
CARGO_PROFILE_RELEASE_LTO="${CARGO_PROFILE_RELEASE_LTO:-thin}"
CARGO_PROFILE_RELEASE_CODEGEN_UNITS="${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:-16}"
export CARGO_PROFILE_RELEASE_LTO CARGO_PROFILE_RELEASE_CODEGEN_UNITS

cargo build --release --locked

if [ ! -x target/release/moviebox-tui ]; then
  echo "[api] cargo finished without target/release/moviebox-tui" >&2
  exit 1
fi

echo "[api] engine built: $(./target/release/moviebox-tui --version 2>/dev/null || echo 'version unknown')"
