// The published Claude and Codex plugins, as artifacts rather than as code.
//
// `test/plugin-codex.test.cjs` asserts what the *checkout* says; this asserts what a
// stranger downloads. The two failures it exists to catch are the two that cannot be
// caught anywhere else, because both are invisible from inside a checkout:
//
//   1. **An artifact that only works here.** A file left out of `RUNTIME`, or a path
//      that names the machine that built it, is a hook that resolves to nothing on
//      somebody else's laptop — and a hook that cannot run fails silently by design, so
//      the only symptom is an office that stays empty.
//   2. **A committed marketplace that has stopped matching its source.** `plugins/claude`
//      is generated output that a deploy copies rather than builds, exactly like
//      `docs/site`, and committed generated output needs a drift check or it quietly
//      goes stale. That check is `pack:plugins:check`, and it is called from here so it
//      cannot be forgotten.
//
// `bin/aop-plugin-pack.cjs --verify` goes further still and *runs* each artifact from a
// temp directory. It is not called from here because it spawns a real Codex install and
// a loopback receiver; CI runs it as `npm run pack:plugins`, beside `pack:openclaw`.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pack = require('../bin/aop-plugin-pack.cjs');
const { unzip } = require('../bin/lib/zip.cjs');
const { auditTree, SPECIFIERS } = require('../bin/lib/pack-audit.cjs');

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const VERSION = readJson('package.json').version;
const BUILD = pack.build({ baseUrl: pack.DEFAULT_BASE_URL, version: VERSION });

/** One host's staged entries as a path → buffer map, which is how most of these read. */
const filesOf = (host) => new Map(BUILD.built[host].entries.map((e) => [e.path, e.data]));

test('the committed Claude marketplace and archive still match this checkout', () => {
  const problems = pack.check(path.join(ROOT, pack.SITE_PATH), BUILD.files, VERSION);
  assert.deepEqual(problems, [], 'run `npm run pack:plugins` and commit what it writes');
});

test('the marketplace pins the digest of the archive that was actually built', () => {
  const marketplace = JSON.parse(read(`${pack.SITE_PATH}/claude/marketplace.json`));
  const [entry] = marketplace.plugins;
  const archive = fs.readFileSync(path.join(ROOT, pack.SITE_PATH, 'claude', pack.archiveName(VERSION)));
  const digest = require('node:crypto').createHash('sha256').update(archive).digest('hex');

  assert.equal(entry.source.sha256, digest);
  assert.equal(entry.source.url, `${pack.DEFAULT_BASE_URL}/${pack.SITE_PATH}/claude/${pack.archiveName(VERSION)}`);
  assert.equal(entry.version, VERSION);
});

test('a hosted marketplace names an https archive, never the relative source a checkout uses', () => {
  const hosted = JSON.parse(read(`${pack.SITE_PATH}/claude/marketplace.json`));
  assert.equal(hosted.plugins[0].source.source, 'archive');
  assert.match(hosted.plugins[0].source.url, /^https:\/\//);
  assert.match(hosted.plugins[0].source.sha256, /^[0-9a-f]{64}$/);

  // The checkout's own marketplace still says `./`, and must: that is what
  // `npm run connect:claude` adds, and it is the thing a URL cannot mean.
  assert.equal(readJson('.claude-plugin/marketplace.json').plugins[0].source, './');
});

test('the archive is byte-reproducible, so a rebuild cannot move the digest it is pinned by', () => {
  const again = pack.build({ baseUrl: pack.DEFAULT_BASE_URL, version: VERSION });
  assert.equal(again.digest, BUILD.digest);
  for (const [rel, data] of again.files) assert.ok(data.equals(BUILD.files.get(rel)), `${rel} differs`);
});

test('the archive unpacks to exactly what was staged, modes included', () => {
  const staged = filesOf('claude');
  const unpacked = unzip(BUILD.archive);

  assert.deepEqual(unpacked.map((e) => e.path), [...staged.keys()]);
  for (const entry of unpacked) {
    assert.ok(entry.data.equals(staged.get(entry.path)), `${entry.path} differs from the staged file`);
  }
  // No directory entries: an extractor that writes every member as a file would turn
  // one into a zero-byte file where a directory belongs.
  assert.ok(!unpacked.some((e) => e.path.endsWith('/')));
  assert.equal(unpacked.find((e) => e.path === 'bin/aop-plugin-hook.sh').mode & 0o111, 0o111);
});

for (const host of Object.keys(pack.HOSTS)) {
  test(`the ${host} artifact's file list is complete and describes the bytes`, () => {
    const files = filesOf(host);
    const listed = JSON.parse(files.get('FILES.json').toString('utf8'));
    const crypto = require('node:crypto');

    assert.equal(listed.version, VERSION);
    assert.equal(listed.harness, pack.HOSTS[host].harness);
    // Every file in the artifact except FILES.json itself, which cannot state its
    // own digest. Both directions, so neither an unlisted file nor a listed ghost passes.
    assert.deepEqual(
      listed.files.map((f) => f.path).sort(),
      [...files.keys()].filter((rel) => rel !== 'FILES.json').sort(),
    );
    for (const item of listed.files) {
      const data = files.get(item.path);
      assert.equal(item.bytes, data.length, item.path);
      assert.equal(item.sha256, crypto.createHash('sha256').update(data).digest('hex'), item.path);
    }
  });

  test(`the ${host} artifact carries no path from the machine that built it`, () => {
    for (const [rel, data] of filesOf(host)) {
      if (/\.(png|zip)$/.test(rel)) continue;
      assert.ok(!data.toString('utf8').includes(ROOT), `${rel} names the checkout`);
    }
  });

  test(`every ${host} hook command resolves through the host's own plugin root`, () => {
    // The failure this rules out is the one the published plugin exists to fix.
    // `aop-claude-install.cjs --settings` writes *this* checkout's absolute path into
    // `~/.claude/settings.json` deliberately, and that is the right thing for a route
    // whose whole point is being live. An artifact that did the same would install a
    // plugin that only works on the machine that built it.
    const hooks = JSON.parse(filesOf(host).get('hooks/hooks.json').toString('utf8'));
    const commands = Object.values(hooks.hooks).flat()
      .flatMap((group) => group.hooks).map((hook) => hook.command);
    assert.ok(commands.length > 0);
    for (const command of commands) {
      assert.ok(
        command.includes('${CLAUDE_PLUGIN_ROOT}'),
        `${command} does not go through the plugin root`,
      );
      assert.ok(!/(?:^|[^$])\/(?:Users|home|var|opt)\//.test(command), `${command} names an absolute path`);
    }
  });

  test(`the ${host} artifact brings every module it imports and reaches outside itself nowhere`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tmp_rovo_dist_${host}-`));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [rel, data] of filesOf(host)) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), data);
    }
    assert.deepEqual(auditTree(dir), { escapes: [], missing: [] });
  });

  test(`the ${host} artifact stamps the one version the whole repository agrees on`, () => {
    const manifest = JSON.parse(filesOf(host).get(pack.HOSTS[host].manifest).toString('utf8'));
    assert.equal(manifest.version, VERSION);
    assert.equal(readJson('.claude-plugin/plugin.json').version, VERSION);
    assert.equal(readJson('.codex-plugin/plugin.json').version, VERSION);
  });

  test(`the ${host} artifact ships its notice, its logo and its own documentation`, () => {
    const files = filesOf(host);
    assert.ok(files.has('NOTICE'));
    assert.ok(files.has('README.md'));
    assert.ok(files.has('assets/logo-256.png'));
    // No licence file exists at the root of this repository yet, so no artifact may
    // claim one. When one lands, `LEGAL` picks it up and this flips — which is the
    // point of asserting the notice says which of the two is true.
    const licensed = pack.LEGAL.some((rel) => /^LICEN[CS]E/.test(rel) && fs.existsSync(path.join(ROOT, rel)));
    const notice = files.get('NOTICE').toString('utf8');
    assert.equal(licensed, !/grants no licence/.test(notice));
    for (const rel of pack.LEGAL) {
      if (fs.existsSync(path.join(ROOT, rel))) assert.ok(files.has(rel), `${rel} exists but does not ship`);
    }
  });

  test(`the ${host} artifact requires nothing but its own files and Node builtins`, () => {
    // This is what makes the NOTICE's central claim checkable rather than aspirational.
    // A bare specifier is an npm package, and in an artifact that ships none it is both
    // a hook that dies on `Cannot find module` and a dependency with no notice covering
    // it. `auditTree` deliberately skips these, so it is asserted separately.
    const builtins = new Set(require('node:module').builtinModules);
    for (const [rel, data] of filesOf(host)) {
      if (!/\.(mjs|cjs|js)$/.test(rel)) continue;
      const body = data.toString('utf8');
      for (const pattern of SPECIFIERS) {
        for (const match of body.matchAll(pattern)) {
          const spec = match[1];
          if (spec.startsWith('.')) continue;
          assert.ok(builtins.has(spec.replace(/^node:/, '').split('/')[0]), `${rel} requires ${spec}`);
        }
      }
    }
  });

  test(`the ${host} artifact does not carry notices for software it does not contain`, () => {
    const files = filesOf(host);
    // THIRD_PARTY_NOTICES.txt is the browser application's, and says so in its own first
    // paragraph. Shipping it here would claim notices for a 3D library and a colour
    // table that are provably absent — misleading rather than thorough. The generated
    // NOTICE names it and says where it is instead.
    assert.ok(fs.existsSync(path.join(ROOT, pack.APP_NOTICES)), 'the project does carry app notices');
    assert.ok(!files.has(pack.APP_NOTICES));
    const notice = files.get('NOTICE').toString('utf8');
    assert.ok(notice.includes(pack.APP_NOTICES), 'the NOTICE must say where the app notices are');
    assert.match(notice, /third-party\/inventory\.json/);
  });
}

test('the Codex artifact is a marketplace Codex can find, rooted at the plugin', () => {
  const files = filesOf('codex');
  // One of the four paths Codex looks in, and the only host-neutral one — verified
  // against codex-cli 0.153.4, which resolves this tree and installs from it.
  const marketplace = JSON.parse(files.get('.agents/plugins/marketplace.json').toString('utf8'));
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].version, VERSION);
  // `./` is correct here and wrong in the Claude manifest, and that is the whole
  // reason the two artifacts are shaped differently: Codex clones a repository, so the
  // marketplace root and the plugin root are one directory.
  assert.equal(marketplace.plugins[0].source, './');
  assert.ok(files.has('.codex-plugin/plugin.json'));
  assert.ok(files.has('bin/mappers/codex-cli.cjs'));
  // The Codex mapper keeps its state machine in the Claude one, so shipping only its
  // own file would be an artifact that passes every static check and dies on hook one.
  assert.ok(files.has('bin/mappers/claude-code.cjs'));
});

test('the Claude artifact leaves behind what only a checkout can use', () => {
  const files = filesOf('claude');
  assert.ok(!files.has('.claude-plugin/marketplace.json'), 'the "./" marketplace must not travel');
  assert.ok(!files.has('.codex-plugin/plugin.json'));
  assert.ok(!files.has('bin/mappers/codex-cli.cjs'));
  assert.ok(!files.has('package.json'), 'nothing in the artifact is installed by npm');
  for (const rel of files.keys()) assert.ok(!rel.startsWith('node_modules'));
});

test('no hook in the chain depends on an executable bit surviving extraction', () => {
  // The exec bits are set, and a local install preserves them — but a *published*
  // install is unpacked by the host, and whether a zip's stored mode reaches disk is
  // the extractor's business. So every step names its interpreter as well.
  const commands = Object.values(readJson('hooks/hooks.json').hooks)
    .flat().flatMap((group) => group.hooks).map((hook) => hook.command);
  assert.ok(commands.length > 0);
  for (const command of commands) assert.match(command, /^sh "\$\{CLAUDE_PLUGIN_ROOT\}\//);
  assert.match(read('bin/aop-plugin-hook.sh'), /^exec sh "\$plugin_root\/bin\/aop-node\.sh"/m);
});

test('the Codex tree is not committed, because only a checkout can use it', () => {
  // The Claude half is committed — the Fly image runs no install, so the archive and its
  // manifest have to be files already. The Codex half is a whole repository waiting for a
  // repository, and nothing serves a clone, so it is rebuilt on every pack instead.
  //
  // `COPY plugins` and the `plugins/codex` exclusion belong to
  // test/docker-context.test.js, which enumerates every file each COPY takes and names
  // that hole in its DELIBERATE_HOLES. The archive's content type is a claim about a
  // response, and is asserted against a running server in test/server-http.test.js.
  assert.match(read('.gitignore'), /^plugins\/codex\/$/m);
});

// What the inventory says about these artifacts is enforced by regenerating it
// (test/third-party.test.js), not by reading `components.json` back and finding the keys
// it contains. And whether CI runs `pack:plugins` is not something a test inside that
// same check can usefully report on.
