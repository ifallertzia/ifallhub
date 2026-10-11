# syntax=docker/dockerfile:1
# Multi-stage build for the MovieBox web player on Render (or any Docker host).
#
# Stage 1 builds the Vite frontend, stage 2 builds the headless Rust API as a
# static musl binary, and the runtime stage runs one Node process that serves
# web/dist on 0.0.0.0:$PORT and proxies /api/* to the Rust API on loopback.
# The terminal UI is never launched. Secrets (e.g. MOVIEBOX_WEB_API_TOKEN) are
# provided at runtime via the environment - never baked into the image.

# ---- Frontend build --------------------------------------------------------
FROM node:22-alpine AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Rust API build (static musl binary) -----------------------------------
FROM rust:1.90-alpine AS api-build
RUN apk add --no-cache build-base
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY .cargo/ .cargo/
# Warm the dependency graph with placeholder sources so source edits do not
# recompile every crate.
RUN mkdir -p src \
    && printf 'pub fn placeholder() {}\n' > src/lib.rs \
    && printf 'fn main() {}\n' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src target/release/moviebox-tui
COPY src/ src/
RUN cargo build --release --locked \
    && cp target/release/moviebox-tui /moviebox-tui

# ---- Runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production \
    MOVIEBOX_API_BIN=/app/moviebox-tui \
    MOVIEBOX_API_ADDR=127.0.0.1:8787 \
    MOVIEBOX_WEB_ROOT=/app/web/dist
COPY deploy/server.mjs deploy/smoke.mjs ./deploy/
COPY --from=web-build /build/web/dist ./web/dist
COPY --from=api-build /moviebox-tui ./moviebox-tui
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "deploy/server.mjs"]
