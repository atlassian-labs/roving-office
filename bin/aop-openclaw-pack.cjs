#!/usr/bin/env node
/**
 * Pack the OpenClaw plugin into a self-contained tarball.
 *
 * `npm run connect:openclaw` links the plugin out of this checkout, which is the right
 * thing when the Gateway and the checkout are the same machine: a link has no snapshot,
 * so it cannot go stale and there is no version ritual to forget (see
 * docs/developer/protocol/aop-harness-adapters.md §5.5).
 *
 * A Gateway on a *server* has no checkout to link to, so it needs an artifact. That is
 * this. The only real work is the seam: `openclaw-plugin/lib/shared.mjs` reaches up into
 * `bin/` for the two modules shared with the hook adapters, and `bin/` is not going to
 * exist on the far end. So the packer vendors those two files and replaces that one file
 * with a version pointing at them. Nothing else is rewritten — every other file in the
 * artifact is byte-identical to the checkout, which is what makes the artifact
 * reviewable by diffing it against `openclaw-plugin/`.
 *
 * Output is `dist/roving-office-openclaw-<version>.tgz`, an npm tarball because that is
 * what OpenClaw's `npm-pack:` install source wants:
 *
 *     openclaw plugins install npm-pack:/path/to/roving-office-openclaw-0.3.0.tgz
 *
 * ...and beside it `dist/aop-openclaw-server.sh`, which runs that install on the far end
 * and does the rest of the dance the tarball leaves behind — mint an office, set the
 * four config keys that matter. Both files go over together; neither is much use alone.
 *
 * **The version matters here in a way it does not for a link.** A packed install is a
 * copy, so it is a snapshot, and it brings back exactly the staleness problem the Claude
 * plugin has to manage with a version bump on every change (§2.5). The version is taken
 * from package.json rather than invented, so bumping the repo bumps the artifact; ship a
 * change without bumping and a server may keep running the old copy.
 *
 * Usage:
 *   node bin/aop-openclaw-pack.cjs              # build dist/…tgz
 *   node bin/aop-openclaw-pack.cjs --verify     # build, then run it from a temp dir
 *   node bin/aop-openclaw-pack.cjs --out <dir>  # somewhere other than dist/
 *
 * Exits non-zero on failure, unlike the adapters — this is a build tool run by a human,
 * and a build that quietly produced a broken artifact would be worse than a red exit.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
// The wire version the checkout speaks, so the verification below asserts what this
// build claims rather than a string frozen at the time it was written. It is also a
// sharper check than a literal was: the artifact carries its *own* vendored copy of
// `aop-core`, so a stale one now fails here instead of shipping.
const { AOP_VERSION } = require('./lib/aop-core.cjs');
// The "does this artifact reach outside itself" walk, shared with the Claude and Codex
// packer, which has to answer exactly the same question about a different tree.
const { auditTree } = require('./lib/pack-audit.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'openclaw-plugin');

/**
 * The files that make up the plugin, relative to `openclaw-plugin/`.
 *
 * Listed rather than globbed, so a stray scratch file in the plugin directory cannot
 * end up inside something we hand to a server.
 */
const FILES = [
  'package.json',
  'openclaw.plugin.json',
  'index.mjs',
  'lib/avatar.mjs',
  'lib/identity.mjs',
  'lib/map.mjs',
  'lib/publisher.mjs',
  'lib/shared.mjs',      // replaced, not copied — see `SEAM`
];

/**
 * What the seam resolves to in a checkout, and what it becomes in the artifact.
 *
 * `from` is relative to the repo root; `as` is the filename under `vendor/`. Both are
 * plain CommonJS with no dependencies of their own, which is the only reason vendoring
 * them is this cheap.
 */
const VENDOR = [
  { from: 'bin/lib/aop-core.cjs', as: 'aop-core.cjs', exportedAs: 'core' },
  { from: 'bin/mappers/lib/tool-classes.cjs', as: 'tool-classes.cjs', exportedAs: 'toolClasses' },
];

const SEAM = 'lib/shared.mjs';

/**
 * The server-side installer, copied out beside the tarball.
 *
 * An artifact on its own still leaves a dance to do by hand — mint an office, install
 * with `--force`, set four config keys, restart — so the script that does it travels
 * with it and the two files are one `scp`. It is copied verbatim rather than generated,
 * for the same reason the rest of the artifact is byte-identical to the checkout: a
 * shell script written into a JS string is a shell script nobody will review.
 */
const SERVER_SCRIPT = 'aop-openclaw-server.sh';

function die(message) {
  console.error(`[pack] ${message}`);
  process.exit(1);
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return die(`cannot read ${path.relative(ROOT, file)}`);
  }
}

/** The seam, as it has to look once `bin/` is no longer above us. */
function packedSeam(version) {
  const lines = VENDOR.map((v) => `export const ${v.exportedAs} = require('../vendor/${v.as}');`);
  return `// Generated by bin/aop-openclaw-pack.cjs for ${version} — do not edit.
//
// In the checkout this file requires the two shared modules from \`bin/\`. A packed
// artifact has no \`bin/\` above it, so they are vendored into \`vendor/\` beside this
// directory and required from there instead. The originals are
// ${VENDOR.map((v) => v.from).join(' and ')};
// if you are debugging the artifact, diff \`vendor/\` against them.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

${lines.join('\n')}
`;
}

/**
 * The artifact's own package.json.
 *
 * Derived from the plugin's rather than written out again, so the OpenClaw block —
 * `extensions`, `compat` — cannot drift between the linked plugin and the packed one.
 * Three things change: the version is stamped from the repo, `private` is dropped
 * (npm refuses to pack a private package under some configurations, and this is meant
 * to be handed around), and `files` is made explicit so the tarball carries `vendor/`.
 */
function packedManifest(version) {
  const manifest = JSON.parse(read(path.join(SRC, 'package.json')));
  delete manifest.private;
  manifest.version = version;
  manifest.files = ['index.mjs', 'lib/', 'vendor/', 'openclaw.plugin.json'];
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function stage(dir, version) {
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });

  for (const rel of FILES) {
    if (rel === SEAM) continue;
    if (rel === 'package.json') {
      fs.writeFileSync(path.join(dir, rel), packedManifest(version));
      continue;
    }
    const src = path.join(SRC, rel);
    if (!fs.existsSync(src)) die(`${rel} is missing from openclaw-plugin/`);
    fs.copyFileSync(src, path.join(dir, rel));
  }

  fs.writeFileSync(path.join(dir, SEAM), packedSeam(version));

  for (const v of VENDOR) {
    const src = path.join(ROOT, v.from);
    if (!fs.existsSync(src)) die(`${v.from} is missing — the seam would dangle`);
    fs.copyFileSync(src, path.join(dir, 'vendor', v.as));
  }
}

/**
 * Refuse to ship an artifact that will not run somewhere else.
 *
 * Two failures, one walk, because they present identically on the far side. A tarball that
 * imports `../../bin` on a machine with no `bin`, and a tarball whose own `lib/avatar.mjs`
 * was never copied in, both surface as an OpenClaw Gateway logging a module-not-found at
 * startup — far from here, and easy to blame on OpenClaw. Cheaper to catch either while the
 * staging directory is still on this disk, and cheaper still to be told *which* it was.
 *
 * The walk itself is `bin/lib/pack-audit.cjs`, shared with `bin/aop-plugin-pack.cjs`.
 * What stays here is what to *say*, which is the part that is about this artifact.
 */
function audit(dir) {
  const { escapes, missing } = auditTree(dir);
  if (escapes.length) {
    die(`the artifact reaches outside itself, so it would break on a server:\n  ${escapes.join('\n  ')}`);
  }
  if (missing.length) {
    die(`the artifact imports files it does not contain — add them to FILES:\n  ${missing.join('\n  ')}`);
  }
  return true;
}

/**
 * Run the staged plugin from a directory that is *not* this checkout.
 *
 * The audit proves no import escapes; this proves the thing actually works, which are
 * different claims — a vendored file could be present and still be the wrong one. So the
 * plugin is registered against a stub `api`, driven through a session, and its events are
 * caught by a local receiver. No network beyond loopback, no OpenClaw required.
 */
function verify(tarball) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp_rovo_openclaw_verify-'));
  try {
    execFileSync('tar', ['xzf', tarball, '-C', scratch], { stdio: 'pipe' });
    const pkgDir = path.join(scratch, 'package');

    const script = `
      import http from 'node:http';
      import zlib from 'node:zlib';
      import assert from 'node:assert';
      import plugin from ${JSON.stringify(path.join(pkgDir, 'index.mjs'))};

      const got = [];
      const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          let raw = Buffer.concat(chunks);
          if ((req.headers['content-encoding'] ?? '').includes('gzip')) {
            raw = zlib.gunzipSync(raw);
          }
          for (const line of raw.toString('utf8').split('\\n').filter(Boolean)) got.push(JSON.parse(line));
          res.writeHead(202, { 'Content-Type': 'application/json' }).end('{}');
        });
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const url = \`http://127.0.0.1:\${server.address().port}/office/TEST-0000/aop/v0/events\`;

      const handlers = new Map();
      await plugin.register({
        pluginConfig: { url, token: 'verify', lingerMs: 20, heartbeatMs: 60000 },
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        on(name, handler) { handlers.set(name, handler); },
      });

      const sid = 'pack-verify';
      const ctx = { sessionId: sid, runId: 'r1', agentId: 'main', workspaceDir: process.cwd(), modelId: 'm' };
      const fire = async (n, e, c) => assert.equal(await handlers.get(n)?.(e, c), undefined, n + ' returned a decision');

      await fire('session_start', { sessionId: sid }, { sessionId: sid });
      await fire('before_agent_run', { prompt: 'pack verification', messages: [] }, ctx);
      await fire('before_tool_call', { toolName: 'bash', params: { command: 'ls -la' }, toolCallId: 't1' }, { ...ctx, toolName: 'bash', toolCallId: 't1' });
      await fire('after_tool_call', { toolName: 'bash', params: { command: 'ls -la' }, toolCallId: 't1', result: {}, durationMs: 5 }, { ...ctx, toolName: 'bash', toolCallId: 't1' });
      await fire('agent_end', { runId: 'r1', messages: [], success: true, durationMs: 9 }, ctx);
      await new Promise((r) => setTimeout(r, 300));
      await handlers.get('gateway_stop')?.({}, {});
      await new Promise((r) => setTimeout(r, 200));
      server.close();

      const types = got.map((e) => e.type);
      assert.ok(got.length >= 5, 'expected at least 5 events, got ' + got.length);
      assert.ok(types.includes('session.start'), 'no session.start');
      assert.ok(types.includes('tool.start') && types.includes('tool.end'), 'no tool pair');
      assert.ok(
        got.every((e) => e.aop === ${JSON.stringify(AOP_VERSION)} && e.harness.name === 'openclaw'),
        'bad envelope: expected aop ${AOP_VERSION}, got ' + JSON.stringify(got.map((e) => e.aop)),
      );
      const tool = got.find((e) => e.type === 'tool.start');
      assert.equal(tool.payload.tool_class, 'execute', 'vendored classifier is wrong: ' + tool.payload.tool_class);
      assert.ok(got.every((e) => e.project?.id), 'vendored project derivation produced nothing');
      console.log('types: ' + types.join(', '));
      console.log('project: ' + got[0].project.id);
    `;
    const scriptFile = path.join(scratch, 'verify.mjs');
    fs.writeFileSync(scriptFile, script);
    const out = execFileSync(process.execPath, [scriptFile], {
      cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 30_000,
    });
    process.stdout.write(out.split('\n').filter(Boolean).map((l) => `[pack]   ${l}\n`).join(''));
    return true;
  } catch (err) {
    const detail = err?.stderr?.toString?.().trim() || err?.message || String(err);
    return die(`the packed artifact does not run:\n${detail}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const wantVerify = argv.includes('--verify');
  const outFlag = argv.indexOf('--out');
  const outDir = outFlag >= 0 ? path.resolve(argv[outFlag + 1] ?? '') : path.join(ROOT, 'dist');

  const version = JSON.parse(read(path.join(ROOT, 'package.json'))).version;
  if (!version) die('the repo package.json has no version to stamp');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp_rovo_openclaw_pack-'));
  const staging = path.join(scratch, 'package');
  try {
    fs.mkdirSync(staging, { recursive: true });
    stage(staging, version);
    audit(staging);
    console.log(`[pack] staged ${FILES.length} files + ${VENDOR.length} vendored, no import escapes`);

    fs.mkdirSync(outDir, { recursive: true });
    const name = `roving-office-openclaw-${version}.tgz`;
    const tarball = path.join(outDir, name);
    // `tar` rather than `npm pack`, because npm renames by package name and would want
    // to run lifecycle scripts; the layout npm produces (everything under `package/`)
    // is all `npm-pack:` needs, and staging is already shaped that way.
    execFileSync('tar', ['czf', tarball, '-C', scratch, 'package'], { stdio: 'pipe' });

    const kb = (fs.statSync(tarball).size / 1024).toFixed(1);
    console.log(`[pack] ${path.relative(ROOT, tarball)} (${kb} KiB, version ${version})`);

    // The installer goes out beside the tarball, executable, so what lands on the
    // server is two files and no instructions to remember.
    const installer = path.join(outDir, SERVER_SCRIPT);
    fs.copyFileSync(path.join(__dirname, SERVER_SCRIPT), installer);
    fs.chmodSync(installer, 0o755);
    console.log(`[pack] ${path.relative(ROOT, installer)} (the server-side installer)`);

    if (wantVerify) {
      verify(tarball);
      console.log('[pack] verified: it runs from a temp dir with no checkout above it');
    }

    console.log('');
    console.log('Copy both files to the OpenClaw server:');
    console.log(`  scp ${path.relative(ROOT, tarball)} ${path.relative(ROOT, installer)} <host>:`);
    console.log('');
    console.log('Then, over there — it installs with --force, points the plugin at an office,');
    console.log('and tells you what to restart. A box that already has one keeps it, so every');
    console.log('run after the first is an upgrade rather than a move:');
    console.log(`  ./${SERVER_SCRIPT} ${name}`);
    console.log(`  ./${SERVER_SCRIPT} ${name} --keycard AB12CD34 --token <t>   # an office that exists`);
    console.log(`  ./${SERVER_SCRIPT} ${name} --new-office                     # a fresh one anyway`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main();
