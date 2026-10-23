// Guards the Vercel deployment wiring. The project deploys as a single
// container-image Function, so the failure modes worth catching here are: the
// Dockerfile.vercel disappearing or being ignored on upload, and the image
// listening somewhere other than the port Vercel sends traffic to.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

/// Join backslash continuations so one instruction is one line.
function instructions(dockerfile) {
  const joined = dockerfile.replace(/\\\r?\n\s*/g, ' ');
  return joined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function instructionList(dockerfile, keep) {
  return instructions(dockerfile)
    .map((line) => line.replace(/\s+/g, ' '))
    .filter((line) => keep.test(line.split(' ')[0].toUpperCase()));
}

test('Dockerfile.vercel exists at the project root', () => {
  const stats = statSync(path.join(repoRoot, 'Dockerfile.vercel'));
  assert.ok(stats.isFile());
});

test('the image listens where Vercel sends traffic', () => {
  const lines = instructions(read('Dockerfile.vercel'));
  const joined = lines.join('\n');
  // Vercel routes container traffic to port 80 unless PORT is set in the
  // project settings, so the image default must match.
  assert.match(joined, /PORT=80\b/, 'the runtime stage must default PORT to 80');
  assert.match(joined, /^EXPOSE 80$/m, 'the image must expose port 80');
  assert.match(
    joined,
    /CMD \["node", ?"deploy\/server\.mjs"\]/,
    'the container must start the web server',
  );
  // Binding port 80 needs root inside the container.
  assert.doesNotMatch(joined, /^USER (?!root)/m, 'dropping privileges would break the port 80 bind');
});

test('writable state stays under /tmp because the container filesystem is read-only', () => {
  const joined = instructions(read('Dockerfile.vercel')).join('\n');
  assert.match(joined, /MOVIEBOX_DATA_DIR=\/tmp\//);
  assert.match(joined, /MOVIEBOX_CONFIG_DIR=\/tmp\//);
});

test('the Vercel image builds the same stack as the Render image', () => {
  // Structural parity: same stages, same sources copied, same start command.
  // ENV/EXPOSE/USER lines are the documented differences (port 80, root, /tmp).
  const keep = /^(FROM|WORKDIR|COPY|RUN|ENTRYPOINT|CMD)$/;
  const normalize = (list) =>
    list
      .filter((line) => !line.startsWith('RUN mkdir -p /tmp/'))
      .map((line) => line.replace(/\s+/g, ' '));
  const render = normalize(instructionList(read('Dockerfile'), keep));
  const vercel = normalize(instructionList(read('Dockerfile.vercel'), keep));
  assert.deepEqual(vercel, render);
});

test('vercel.json declares exactly one container service and publishes it', () => {
  const config = JSON.parse(read('vercel.json'));
  const services = config.services ?? {};
  // A single service running the Dockerfile.vercel image. The earlier failure
  // was a second service on the `rust` runtime: that runtime builds a
  // vercel_runtime Function, which cannot host a long-running HTTP server.
  assert.deepEqual(Object.keys(services), ['app']);
  assert.equal(services.app.root, '.');
  assert.equal(services.app.runtime, 'container');
  assert.equal(services.app.entrypoint, 'Dockerfile.vercel');
  assert.equal(services.app.bindings, undefined, 'a container needs no bindings');

  // Container images require explicit routing in services mode: a service is
  // internal until a rewrite targets it.
  assert.deepEqual(config.rewrites, [
    { source: '/(.*)', destination: { service: 'app' } },
  ]);
  assert.equal(config.functions, undefined);
});

test('.vercelignore keeps everything the image build needs', () => {
  const ignore = read('.vercelignore');
  const rules = ignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  // Negations come after the exclusion they undo.
  const dockerIgnoreIndex = rules.indexOf('/Dockerfile');
  const dockerKeepIndex = rules.indexOf('!Dockerfile.vercel');
  assert.ok(dockerIgnoreIndex >= 0, '/Dockerfile should stay excluded (Render only)');
  assert.ok(dockerKeepIndex > dockerIgnoreIndex, 'Dockerfile.vercel must be re-included');

  for (const needed of ['web', 'src', 'deploy', 'Cargo.toml', 'Cargo.lock']) {
    assert.ok(
      !rules.includes(`/${needed}`) && !rules.includes(needed),
      `${needed} is copied by the Dockerfile and must not be ignored`,
    );
  }
  assert.ok(!rules.some((rule) => rule.replace(/^\//, '') === 'Dockerfile.vercel'));
});

test('the deploy scripts referenced by the image exist', () => {
  assert.ok(statSync(path.join(repoRoot, 'deploy/server.mjs')).isFile());
  assert.ok(statSync(path.join(repoRoot, 'deploy/smoke.mjs')).isFile());
  assert.ok(statSync(path.join(repoRoot, 'web/package-lock.json')).isFile());
});
