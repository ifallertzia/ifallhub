// Guards the Vercel deployment wiring: a service whose build script was renamed
// or lost its executable bit fails at deploy time, not at review time, so the
// config is checked here instead.
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const configPath = path.join(repoRoot, 'vercel.json');

function readConfig() {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function assertExecutableFile(relativePath, label = relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  const stats = statSync(fullPath);
  assert.ok(stats.isFile(), `${label} must be a file`);
  assert.ok((stats.mode & 0o111) !== 0, `${label} must be executable`);
}

/// `sh deploy/x.sh` and `deploy/x.sh` both have to point at a real script.
function scriptPath(command) {
  if (!command) return null;
  const trimmed = command.trim();
  const match = trimmed.match(/^(?:sh|bash|\.)\s+(\S+\.sh)$/);
  if (match) return match[1];
  if (/^\S+\.sh$/.test(trimmed)) return trimmed;
  return null;
}

test('vercel.json declares the public site and internal api services', () => {
  const config = readConfig();
  assert.equal(config.$schema, 'https://openapi.vercel.sh/vercel.json');
  assert.deepEqual(Object.keys(config.services).sort(), ['api', 'site']);
  assert.equal(config.services.site.runtime, 'node');
  assert.equal(config.services.api.runtime, 'rust');
});

test('every Vercel build script exists and is executable', () => {
  const config = readConfig();
  for (const [name, service] of Object.entries(config.services)) {
    assertExecutableFile(service.entrypoint, `${name} entrypoint`);
    for (const key of ['installCommand', 'buildCommand']) {
      const script = scriptPath(service[key]);
      if (script) assertExecutableFile(script, `${name} ${key}`);
    }
  }
});

test('build commands avoid npm --prefix, which Vercel resolved from the wrong directory', () => {
  const config = readConfig();
  const commands = Object.values(config.services)
    .flatMap((service) => [service.installCommand, service.buildCommand])
    .filter(Boolean);
  for (const command of commands) {
    assert.doesNotMatch(
      command,
      /--prefix\s+web/,
      'run npm inside web/ instead of passing --prefix web',
    );
  }
});

test('the site service binds the api service and is the only public one', () => {
  const config = readConfig();
  const bindings = config.services.site.bindings ?? [];
  assert.deepEqual(bindings, [
    { type: 'service', service: 'api', format: 'url', env: 'API_URL' },
  ]);
  assert.equal(config.services.api.bindings, undefined);

  // A service is internal until a rewrite targets it, so the single catch-all
  // must point at `site` and must be the least specific entry (last).
  const rewrites = config.rewrites ?? [];
  assert.ok(rewrites.length > 0, 'a rewrite is needed to publish the site service');
  const last = rewrites[rewrites.length - 1];
  assert.equal(last.destination?.service, 'site');
  assert.equal(last.source, '/(.*)');
  for (const rewrite of rewrites) {
    assert.notEqual(
      rewrite.destination?.service,
      'api',
      'the api service must stay internal',
    );
  }
});
