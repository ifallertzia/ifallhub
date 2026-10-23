#!/usr/bin/env node
/**
 * MovieBox web player production server.
 *
 * Serves the built frontend (web/dist) and reverse-proxies same-origin
 * `/api/*` routes to the headless Rust API (`moviebox-tui --web-api`), which
 * stays private on loopback. Optionally spawns and supervises the Rust API so
 * the whole deployment runs as one process tree (Render Web Service / Docker).
 *
 * Environment:
 *   PORT                       Public port (required on Render; default 3000).
 *   HOST                       Public bind address (default 0.0.0.0).
 *   MOVIEBOX_WEB_ROOT          Static root (default ../web/dist next to this file).
 *   MOVIEBOX_API_TARGET        Upstream API base URL (overrides everything else).
 *   API_URL                    Upstream API base URL injected by a platform
 *                              service binding (Vercel services). Used when
 *                              MOVIEBOX_API_TARGET is not set.
 *   MOVIEBOX_API_BIN           If set (and MOVIEBOX_API_TARGET is not), spawn
 *                              `$MOVIEBOX_API_BIN --web-api $MOVIEBOX_API_ADDR`.
 *   MOVIEBOX_API_ADDR          Listen address for the spawned API (default 127.0.0.1:8787).
 *   MOVIEBOX_WEB_RATE_LIMIT    Requests/minute/client for the JSON API (default 300, 0 disables).
 *   MOVIEBOX_WEB_MEDIA_RATE_LIMIT  Requests/minute/client for /api/media (default 1200, 0 disables).
 *
 * Secrets (e.g. MOVIEBOX_WEB_API_TOKEN for the API) belong in the deployment
 * environment, never in this file or the image.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A service binding (Vercel services: `{ "type": "service", ... "env": "API_URL" }`)
// injects the API service's internal base URL as API_URL. The explicit
// MOVIEBOX_API_TARGET always wins so operators can override it per deployment.
const boundApiTarget = (process.env.MOVIEBOX_API_TARGET || process.env.API_URL || '').trim();
const apiTargetSource = process.env.MOVIEBOX_API_TARGET
  ? 'MOVIEBOX_API_TARGET'
  : process.env.API_URL
    ? 'API_URL (service binding)'
    : 'default loopback';

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number.parseInt(process.env.PORT || '3000', 10),
  webRoot: path.resolve(process.env.MOVIEBOX_WEB_ROOT || path.join(__dirname, '..', 'web', 'dist')),
  // Bindings and operators sometimes hand over a trailing slash; URL parsing
  // tolerates it, but the proxied paths must not end up with `//api`.
  apiTarget: boundApiTarget ? boundApiTarget.replace(/\/+$/, '') : 'http://127.0.0.1:8787',
  apiTargetSource,
  apiBin: process.env.MOVIEBOX_API_BIN || '',
  apiAddr: process.env.MOVIEBOX_API_ADDR || '127.0.0.1:8787',
  rateLimit: parseRate(process.env.MOVIEBOX_WEB_RATE_LIMIT, 300),
  mediaRateLimit: parseRate(process.env.MOVIEBOX_WEB_MEDIA_RATE_LIMIT, 1200),
};

function parseRate(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const apiOrigin = new URL(config.apiTarget);
const apiPort = apiOrigin.port
  ? Number.parseInt(apiOrigin.port, 10)
  : apiOrigin.protocol === 'https:'
    ? 443
    : 80;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
};

const COMPRESSIBLE = new Set([
  'text/html; charset=utf-8',
  'text/javascript; charset=utf-8',
  'text/css; charset=utf-8',
  'application/json; charset=utf-8',
  'image/svg+xml',
  'text/plain; charset=utf-8',
  'text/vtt; charset=utf-8',
]);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function log(message) {
  console.log(`[moviebox-web] ${message}`);
}

// ---------------------------------------------------------------------------
// Minimal per-client token bucket limiter for the public edge.
// ---------------------------------------------------------------------------

const rateBuckets = new Map();

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length <= 64 && !/\s/.test(last)) return last.toLowerCase();
  }
  return (req.socket.remoteAddress || 'unknown').toLowerCase();
}

function allowRequest(key, perMinute, table) {
  if (perMinute === 0) return true;
  const now = Date.now();
  const burst = Math.max(perMinute / 6, 10);
  let bucket = table.get(key);
  if (!bucket) {
    if (table.size > 8192) {
      for (const [entryKey, entry] of table) {
        if (now - entry.updatedAt > 10 * 60 * 1000) table.delete(entryKey);
      }
      if (table.size > 8192) table.clear();
    }
    bucket = { tokens: burst, updatedAt: now };
    table.set(key, bucket);
  }
  const elapsedSeconds = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(burst, bucket.tokens + (elapsedSeconds * perMinute) / 60);
  bucket.updatedAt = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateBuckets) {
    if (now - entry.updatedAt > 10 * 60 * 1000) rateBuckets.delete(key);
  }
}, 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

function resolveStaticPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalized = path.posix.normalize(decoded);
  if (normalized.includes('..')) return null;
  const relative = normalized.replace(/^\/+/, '');
  const candidate = path.resolve(config.webRoot, relative);
  const rootWithSep = config.webRoot.endsWith(path.sep) ? config.webRoot : config.webRoot + path.sep;
  if (candidate !== config.webRoot && !candidate.startsWith(rootWithSep)) return null;
  return candidate;
}

function sendFile(req, res, filePath, cacheControl) {
  const stat = fs.statSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Content-Length': stat.size,
    'Accept-Ranges': 'none',
  };
  const acceptsGzip =
    COMPRESSIBLE.has(contentType) &&
    stat.size > 1024 &&
    /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (acceptsGzip) {
    const compressed = zlib.gzipSync(fs.readFileSync(filePath));
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = compressed.length;
    headers.Vary = 'Accept-Encoding';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    return res.end(compressed);
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const target = resolveStaticPath(urlPath);
  if (!target) {
    res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  let filePath = target;
  let stat = null;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = fs.statSync(filePath);
    }
  } catch {
    stat = null;
  }

  if (!stat) {
    // SPA fallback: extension-less paths render the app shell; missing assets 404.
    const hasExtension = path.basename(urlPath).includes('.');
    if (hasExtension || urlPath.startsWith('/assets/')) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    filePath = path.join(config.webRoot, 'index.html');
    try {
      stat = fs.statSync(filePath);
    } catch {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Frontend build not found');
    }
  }

  const immutable = urlPath.startsWith('/assets/');
  const cacheControl = immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
  return sendFile(req, res, filePath, cacheControl);
}

// ---------------------------------------------------------------------------
// /api reverse proxy (streaming, no body buffering)
// ---------------------------------------------------------------------------

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function proxyApi(req, res, retryCount = 0) {
  const upstreamHeaders = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'host') continue;
    upstreamHeaders[name] = value;
  }
  upstreamHeaders.host = apiOrigin.host;
  upstreamHeaders['x-forwarded-for'] = clientKey(req);
  upstreamHeaders['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
  upstreamHeaders['x-forwarded-host'] = req.headers.host || '';
  upstreamHeaders.connection = 'close';

  const isMedia = req.url.startsWith('/api/media/');
  // Server-sent events stay open on purpose: never retry them and keep the
  // socket quiet-tolerant, or every library update would drop the stream.
  const isEventStream = req.url.startsWith('/api/library/events');
  const maxRetries = isMedia || isEventStream ? (isEventStream ? 0 : 1) : 2;
  const request = http.request(
    {
      protocol: apiOrigin.protocol,
      hostname: apiOrigin.hostname,
      port: apiPort,
      method: req.method,
      path: req.url,
      headers: upstreamHeaders,
    },
    (upstream) => {
      // Retry on 502/503/504 for non-media requests
      if (!isMedia && !isEventStream && [502, 503, 504].includes(upstream.statusCode) && retryCount < maxRetries) {
        log(`Retrying ${req.url} after ${upstream.statusCode} (attempt ${retryCount + 1})`);
        upstream.resume();
        setTimeout(() => proxyApi(req, res, retryCount + 1), 200 * (retryCount + 1));
        return;
      }
      const headers = {};
      for (const [name, value] of Object.entries(upstream.headers)) {
        if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
      }
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers[name] = value;
      // Add CORS for media
      if (isMedia) headers['Access-Control-Allow-Origin'] = '*';
      if (isEventStream) {
        headers['Cache-Control'] = 'no-store, no-transform';
        headers['X-Accel-Buffering'] = 'no';
      }
      res.writeHead(upstream.statusCode || 502, headers);
      if (req.method === 'HEAD') {
        upstream.resume();
        return res.end();
      }
      // Stream chunks straight through - media responses are never buffered.
      upstream.pipe(res);
    },
  );

  // Media streams can legitimately be quiet for long stretches.
  // Increased timeouts to handle concurrent load
  // Media and event streams can legitimately be quiet for long stretches.
  request.setTimeout(isEventStream ? 0 : isMedia ? 300_000 : 90_000, () => {
    request.destroy(new Error('upstream timeout'));
  });

  request.on('error', (error) => {
    log(`api proxy error for ${req.url}: ${error.message} (retry ${retryCount})`);
    if (retryCount < maxRetries && !isMedia && !isEventStream) {
      setTimeout(() => proxyApi(req, res, retryCount + 1), 300 * (retryCount + 1));
      return;
    }
    if (res.headersSent) return res.destroy();
    res.writeHead(502, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: 'The MovieBox API is temporarily busy. Please retry in a moment.' }));
  });

  if (req.method === 'HEAD' || req.method === 'GET') {
    request.end();
  } else {
    req.pipe(request);
    req.on('error', () => request.destroy());
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const apiLimiter = new Map();
const mediaLimiter = new Map();

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;

  if (urlPath.startsWith('/api/')) {
    const key = clientKey(req);
    const isHealth = urlPath === '/api/health';
    const isMedia = urlPath.startsWith('/api/media/');
    if (!isHealth) {
      const perMinute = isMedia ? config.mediaRateLimit : config.rateLimit;
      const table = isMedia ? mediaLimiter : apiLimiter;
      if (!allowRequest(key, perMinute, table)) {
        res.writeHead(429, {
          ...SECURITY_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Retry-After': '60',
        });
        return res.end(JSON.stringify({ error: 'Too many requests. Slow down and try again shortly.' }));
      }
    }
    return proxyApi(req, res);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }
  return serveStatic(req, res);
});

// Long media responses must not be cut by generic socket inactivity timers.
server.requestTimeout = 300_000;
server.headersTimeout = 65_000;
server.timeout = 0;

// ---------------------------------------------------------------------------
// Optional Rust API child process (single-service deployments)
// ---------------------------------------------------------------------------

let apiProcess = null;

function spawnApi() {
  const args = ['--web-api', config.apiAddr];
  log(`starting Rust API: ${config.apiBin} ${args.join(' ')}`);
  apiProcess = spawn(config.apiBin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  apiProcess.on('error', (error) => {
    log(`failed to start the Rust API: ${error.message}`);
    shutdown(1);
  });
  apiProcess.on('exit', (code, signal) => {
    log(`Rust API exited (code=${code}, signal=${signal}); stopping web server`);
    shutdown(1);
  });
}

function shutdown(exitCode = 0) {
  server.close(() => process.exit(exitCode));
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 5_000).unref();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

// ---------------------------------------------------------------------------

if (!fs.existsSync(path.join(config.webRoot, 'index.html'))) {
  console.error(`[moviebox-web] frontend build not found at ${config.webRoot} - run "npm ci && npm run build" in web/`);
  process.exit(1);
}

if (boundApiTarget) {
  log(`proxying /api to ${config.apiTarget} from ${apiTargetSource} (not spawning the Rust API)`);
} else if (config.apiBin) {
  spawnApi();
}

server.listen(config.port, config.host, () => {
  log(
    `listening on http://${config.host}:${config.port} (api target ${config.apiTarget} via ${apiTargetSource})`,
  );
});
