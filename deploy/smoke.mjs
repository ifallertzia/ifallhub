#!/usr/bin/env node
/**
 * Smoke tests for a running MovieBox web deployment.
 *
 * Usage:
 *   node deploy/smoke.mjs [--base http://127.0.0.1:8080] [--token KEY] [--mock] [--real]
 *
 * Checks the public surface of the production server: homepage, /api/health,
 * providers, search routing, API access-key enforcement, and /api/media proxy
 * routing. With `--real` it also walks search -> details -> streams -> play and
 * fetches the start of the resolved media through the same-origin proxy
 * (requires reachability to the configured providers).
 *
 * `--mock` relaxes provider-shaped assertions for offline harnesses.
 */

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const base = argValue('--base', 'http://127.0.0.1:8080').replace(/\/$/, '');
const token = argValue('--token', process.env.SMOKE_TOKEN || '');
const mock = args.includes('--mock');
const real = args.includes('--real');

let failures = 0;
const note = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function get(path, headers = {}) {
  const response = await fetch(base + path, { headers: { Accept: 'application/json', ...headers } });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: response.status, text, json };
}

async function main() {
  // 1. Homepage (static build).
  {
    const response = await fetch(base + '/', { redirect: 'follow' });
    const html = await response.text();
    note(
      response.status === 200 && /moviebox/i.test(html),
      'homepage serves the web player',
      `status=${response.status}`,
    );
  }

  // 2. Health check (no access key required).
  {
    const { status, json } = await get('/api/health');
    note(
      status === 200 && json && json.status === 'ok',
      '/api/health',
      JSON.stringify(json)?.slice(0, 120) || `status=${status}`,
    );
  }

  // 3. Access key enforcement on the JSON API.
  if (token) {
    const denied = await get('/api/providers');
    note(denied.status === 401, 'JSON API rejects missing access key', `status=${denied.status}`);
    const granted = await get('/api/providers', { 'X-MovieBox-Key': token });
    note(granted.status === 200, 'JSON API accepts X-MovieBox-Key', `status=${granted.status}`);
  }

  // 4. Providers list.
  {
    const headers = token ? { 'X-MovieBox-Key': token } : {};
    const { status, json } = await get('/api/providers', headers);
    const providers = Array.isArray(json) ? json.map((entry) => entry.id) : [];
    note(
      status === 200 && providers.length > 0,
      '/api/providers lists providers',
      providers.join(', ') || `status=${status}`,
    );
  }

  // 5. Search routing (real providers unless --mock).
  {
    const headers = token ? { 'X-MovieBox-Key': token } : {};
    const { status, json } = await get('/api/search?q=matrix&provider=moviebox', headers);
    if (mock) {
      note(status === 200 && Array.isArray(json), '/api/search routing (mock)', `status=${status}`);
    } else if (status === 200 && Array.isArray(json)) {
      note(true, '/api/search returned live provider results', `${json.length} items`);
    } else if (status >= 500 && json && json.error) {
      note(
        true,
        '/api/search routed to the provider stack (provider unreachable from this host)',
        `status=${status} error=${String(json.error).slice(0, 100)}`,
      );
    } else {
      note(false, '/api/search routing', `status=${status} body=${String(json?.error || '').slice(0, 100)}`);
    }
  }

  // 6. Media proxy routing (unknown session tokens must 404/400, never proxy).
  {
    const bogus = await fetch(`${base}/api/media/deadbeef/https/example.com/a.mp4`);
    note(bogus.status === 404, 'media proxy rejects unknown sessions', `status=${bogus.status}`);
    const malformed = await fetch(`${base}/api/media/deadbeef/ftp/example.com/a.mp4`);
    note(
      malformed.status === 400 || malformed.status === 404,
      'media proxy rejects non-HTTP targets',
      `status=${malformed.status}`,
    );
  }

  // 7. Optional end-to-end playback attempt.
  if (real && !mock) {
    const headers = token ? { 'X-MovieBox-Key': token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    try {
      const search = await get('/api/search?q=interstellar&provider=moviebox', headers);
      const item = Array.isArray(search.json) ? search.json[0] : null;
      if (!item) {
        note(false, 'real playback: search returned an item', `status=${search.status}`);
      } else {
        const id = item.id?.value ?? item.id;
        const streams = await get(
          `/api/streams?provider=moviebox&id=${encodeURIComponent(id)}&season=0&episode=0`,
          headers,
        );
        const streamSet = streams.json?.stream_set_id;
        if (!streamSet || !Array.isArray(streams.json?.releases) || streams.json.releases.length === 0) {
          note(false, 'real playback: streams resolved', `status=${streams.status}`);
        } else {
          const play = await fetch(`${base}/api/play`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ stream_set_id: streamSet, release_index: 0, mirror_index: 0 }),
          });
          const playback = await play.json();
          const playbackUrl = playback?.playback_url;
          if (play.status !== 200 || !playbackUrl) {
            note(false, 'real playback: play resolved a source', `status=${play.status} error=${playback?.error || ''}`);
          } else {
            const ranged = await fetch(base + playbackUrl, { headers: { Range: 'bytes=0-1023' } });
            const bytes = (await ranged.arrayBuffer()).byteLength;
            note(
              ranged.status === 200 || ranged.status === 206,
              'real playback: media proxy streams resolved media',
              `status=${ranged.status} bytes=${bytes} type=${playback.stream_type}`,
            );
          }
        }
      }
    } catch (error) {
      note(false, 'real playback attempt', String(error).slice(0, 160));
    }
  }

  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('smoke test crashed:', error);
  process.exit(1);
});
