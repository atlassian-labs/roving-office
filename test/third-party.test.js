import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, run } from '../bin/gen-third-party.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tro-third-party-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, body) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), typeof body === 'string' ? body : JSON.stringify(body));
  };
  return { root, put };
}

test('the committed inventory and notices match the lockfile, license evidence and vendored assets offline', () => {
  run({ check: true });
});

test('unsupported optional packages retain exact audited evidence, and an upgrade cannot silently reuse it', (t) => {
  const { root, put } = fixture(t);
  put('third-party/components.json', { reviewedAt: '2026-09-09', components: [], distributions: {}, npmEvidence: {} });
  put('package.json', { devDependencies: { watcher: '1.0.0' } });
  const lock = { packages: {
    'node_modules/watcher': { version: '1.0.0', license: 'MIT', dev: true, optional: true, os: ['darwin'], integrity: 'sha512-original' },
  } };
  put('package-lock.json', lock);
  put('node_modules/watcher/package.json', { name: 'watcher', version: '1.0.0', license: 'MIT' });
  put('node_modules/watcher/LICENSE', read('vendor/color-name-list/LICENSE'));
  const original = generate(root, { platform: 'darwin' });
  put('third-party/inventory.json', original['third-party/inventory.json']);
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
  assert.deepEqual(generate(root, { platform: 'linux' }), original);
  assert.throws(() => generate(root, { platform: 'darwin' }), /missing package\/license evidence/);
  lock.packages['node_modules/watcher'].integrity = 'sha512-changed';
  put('package-lock.json', lock);
  assert.throws(() => generate(root, { platform: 'linux' }), /missing package\/license evidence/);
});

test('license evidence includes Unlicense and README terms while metadata-only entries stay unresolved', () => {
  const inventory = JSON.parse(read('third-party/inventory.json'));
  const find = (name) => inventory.npm.find((item) => item.name === name);
  assert.equal(find('markdown-it-anchor').licenseEvidenceStatus, 'license-text-recorded');
  assert.ok(find('markdown-it-anchor').licenseEvidence.some((item) => item.path.endsWith('/UNLICENSE')));
  for (const name of ['errno', 'esrecurse', 'imurmurhash']) {
    assert.equal(find(name).licenseEvidenceStatus, 'license-text-recorded');
    assert.ok(find(name).licenseEvidence.some((item) => /README/i.test(item.path)));
  }
  assert.equal(find('@humanfs/types').licenseEvidenceStatus, 'full-license-text-missing');
  assert.match(find('@11ty/recursive-copy').review, /ISC.*MIT/);
});

// The end-to-end staging check that used to live here drove `bin/kaizen-build.sh` — it
// assembled a fixture tree, ran the recipe, and asserted the staged output carried the
// complete licence texts while no `node_modules` licence came with it. That deployment has
// been retired, and the Fly recipe has no staging step to run: it is a Docker build, so
// the equivalent would mean building an image in the suite.
//
// The coverage it carried is still covered, in two cheaper places:
//
//   - the notices' *content* — that every declared licence's full text is present and
//     matches the lockfile — is the first test in this file, which reads the committed
//     artifacts directly;
//   - the notices *shipping*, and `node_modules` not shipping, is `test/docker-context.js`
//     via `test/docker-context.test.js`: it asserts every path `Dockerfile.fly` copies
//     survives `.dockerignore`, and that nothing tracked is uploaded that no COPY takes.
//
// What is genuinely gone is the assertion that a *staged tree* ends up correct, as
// distinct from the recipe that stages it being correct. That is worth knowing rather
// than discovering.
