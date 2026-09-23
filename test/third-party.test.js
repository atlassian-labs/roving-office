import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

// The whole of this test drives `bin/kaizen-build.sh`, the maintainers' internal deploy
// recipe, which is not published — so in the public export there is no recipe to drive.
// The Fly recipe's equivalent guarantees are covered by test/docs.test.js and
// test/plugin-dist.test.cjs, both of which check it unconditionally.
const NO_KAIZEN = fs.existsSync(path.join(ROOT, 'bin/kaizen-build.sh'))
  ? false
  : 'bin/kaizen-build.sh is not in this tree: an exported copy has no internal deploy recipe'

test('the hosted artifact retains the complete runtime notices without shipping development dependencies', { skip: NO_KAIZEN }, (t) => {
  const { root, put } = fixture(t);
  for (const name of ['bin/kaizen-build.sh', 'THIRD_PARTY_NOTICES.txt', 'vendor/three/LICENSE', 'vendor/color-name-list/LICENSE']) put(name, read(name));
  for (const name of ['bin/kaizen-entry.mjs', 'server.cjs', 'home.html', 'styles.css', 'favicon.ico', 'docs/library.html', 'docs/site/index.html', 'docs/images/example.png', 'docs/examples/layout.json', 'assets/icon.svg', 'lib/example.cjs', 'src/example.js', 'admin/console.html', 'plugins/claude/marketplace.json', 'plugins/codex/bin/example.cjs']) put(name, 'fixture');
  put('node_modules/example/LICENSE', 'development-only fixture');
  execFileSync('bash', ['bin/kaizen-build.sh'], { cwd: root, stdio: 'pipe' });
  const staged = path.join(root, '.output/server');
  const notices = fs.readFileSync(path.join(staged, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  for (const license of ['vendor/three/LICENSE', 'vendor/color-name-list/LICENSE']) {
    assert.ok(notices.includes(read(license).trimEnd()), `missing complete ${license}`);
    assert.equal(fs.readFileSync(path.join(staged, license), 'utf8'), read(license));
  }
  assert.ok(!fs.existsSync(path.join(staged, 'node_modules')));
  assert.ok(!fs.existsSync(path.join(staged, 'third-party/inventory.json')));
  // The published Claude marketplace ships; the Codex distribution tree does not — it
  // is a repository to clone rather than a file to download. See test/plugin-dist.test.cjs.
  assert.ok(fs.existsSync(path.join(staged, 'plugins/claude/marketplace.json')));
  assert.ok(!fs.existsSync(path.join(staged, 'plugins/codex')));
  // The admin console's files. `server.cjs` serves them itself because the static file
  // server refuses that directory, so a host that did not ship them would answer 404 to
  // a console its own password had just admitted somebody to — which looks like a broken
  // page rather than an absent feature. Asserted on both recipes, because the console
  // existing on one deploy target and not the other is the failure worth preventing.
  assert.ok(fs.existsSync(path.join(staged, 'admin/console.html')));
  assert.match(read('Dockerfile.fly'), /^COPY admin \.\/admin$/m);
  assert.match(read('Dockerfile.fly'), /^COPY THIRD_PARTY_NOTICES\.txt \.\/$/m);
  assert.match(read('Dockerfile.fly'), /^COPY vendor \.\/vendor$/m);
});
