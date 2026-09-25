#!/usr/bin/env node
/**
 * Build the Claude Code and Codex plugins as distribution artifacts — installable by
 * somebody who has never cloned this repository.
 *
 * `npm run connect:claude` and `npm run connect:codex` both install *out of a checkout*:
 * one adds `./` as a marketplace, the other stages a copy of the checkout and adds that.
 * Both are the right thing while the adapter is being developed, and neither is any use
 * to a person who has the office's URL and nothing else. This closes that gap the way
 * `bin/aop-openclaw-pack.cjs` closed it for a Gateway on a server, and it follows that
 * file's shape deliberately: an explicit staging list, the version stamped from
 * `package.json`, an audit that refuses an artifact reaching outside itself, and a
 * `--verify` that runs the result from a temp directory with no checkout above it.
 *
 * ## Two hosts, two shapes, and the reason they differ
 *
 * **Claude Code** takes a marketplace as a URL. Its `"source": "archive"` fetches a zip
 * over HTTPS and can pin it with a SHA-256, so the whole installation is two commands and
 * needs neither Git nor npm:
 *
 *     /plugin marketplace add https://therovingoffice.com/plugins/claude/marketplace.json
 *     /plugin install roving-office@roving-office
 *
 * A URL-hosted marketplace cannot use the `"source": "./"` that `.claude-plugin/marketplace.json`
 * carries in the checkout — there is no checkout on the far end for `./` to mean — so the
 * hosted manifest is *generated* from that file with the source replaced. It is generated
 * rather than maintained by hand because it contains a digest: a hand-edited copy would
 * be wrong the first time anybody changed a mapper.
 *
 * **Codex** does not. `codex plugin marketplace add` accepts a local path, `owner/repo`,
 * or a Git URL — and nothing else. So Codex needs a *repository*, not an archive, and the
 * artifact for it is therefore a complete distribution-repository tree rather than a file:
 * `.agents/plugins/marketplace.json` at its root, the plugin beside it, `"source": "./"`
 * (which is correct here, because Codex clones the repository and the root *is* the
 * checkout). Publishing it is `git push` into a public repository that does not exist yet
 * — that repository is the one thing this build cannot stand in for, and the only thing
 * left between this artifact and a published Codex plugin.
 *
 * ## What is committed, and why only half of it
 *
 * The rule is: **what the site serves is committed; what needs a repository that does not
 * exist yet is not.**
 *
 *   plugins/claude/marketplace.json          committed, served at /plugins/claude/…
 *   plugins/claude/roving-office-<v>.zip     committed, served beside it
 *   plugins/codex/                           gitignored — nothing serves a Git tree
 *
 * Committing generated output is the precedent `docs/site` set and for the same reason:
 * the deploy target may not build. 
 * `Dockerfile.fly` runs no `npm install` at all, so a marketplace assembled at deploy
 * time would exist on one target and 404 on the other. `--check` is the drift guard that
 * makes that safe, and it is part of `npm test`.
 *
 * That only works because the archive is **byte-reproducible** — see `bin/lib/zip.cjs`,
 * which stores rather than deflates and stamps one fixed timestamp. A digest that moved
 * on a rebuild would fail `--check` on a checkout nobody had edited.
 *
 * ## The version matters here, as it does for every snapshot
 *
 * Both hosts install a *copy* and key their caches on the version, so a plugin-affecting
 * change that does not bump it is a change no session will ever run (AGENTS.md, "bump the
 * version, every time"). The version is taken from `package.json` and stamped into both
 * manifests' artifacts, and `--check` refuses a build where the three disagree.
 *
 * Usage:
 *   node bin/aop-plugin-pack.cjs                    # build plugins/ (and plugins/codex/)
 *   node bin/aop-plugin-pack.cjs --verify           # build, then install and fire a hook
 *                                                   #   from a temp dir with no checkout
 *   node bin/aop-plugin-pack.cjs --check            # fail if the committed files drifted
 *   node bin/aop-plugin-pack.cjs --out <dir>        # somewhere other than plugins/
 *   node bin/aop-plugin-pack.cjs --base-url <url>   # somewhere other than the live site
 *
 * Exits non-zero on failure, unlike the adapters — this is a build tool, and a build that
 * quietly produced a broken artifact would be worse than a red exit.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const { zip, unzip } = require('./lib/zip.cjs');
const { auditTree, SPECIFIERS } = require('./lib/pack-audit.cjs');
const { flags } = require('./lib/cli-flags.cjs');

const ROOT = path.resolve(__dirname, '..');

/** Where the site serves the Claude marketplace from, and what the docs tell people to add. */
const SITE_PATH = 'plugins';
const DEFAULT_BASE_URL = 'https://therovingoffice.com';

/**
 * The runtime, and nothing else.
 *
 * Listed rather than globbed for the same reason the OpenClaw packer lists its files: a
 * stray scratch file in `bin/` must not be able to end up inside something we publish.
 * This is deliberately a fraction of `bin/` — the office generators, the probe and the
 * screenshot tools are a contributor's toolkit and have no business on a stranger's
 * machine, and several of them import the vendored three.js.
 *
 * The paths are the checkout's own, so every file in an artifact is byte-identical to
 * the file it came from and an artifact can be reviewed by diffing it against `bin/`.
 */
const RUNTIME = [
  'bin/aop-plugin-hook.sh',       // what hooks.json invokes; picks the harness from the host
  'bin/aop-node.sh',              // finds a Node a GUI-launched hook can actually reach
  'bin/aop-send.cjs',             // the adapter proper
  'bin/lib/aop-core.cjs',         // endpoint, project, redaction — the shared decisions
  'bin/mappers/lib/tool-classes.cjs',
  'bin/mappers/lib/todo-steps.cjs',
  'bin/mappers/lib/event-shape.cjs',
  'hooks/hooks.json',
  'assets/logo-256.png',          // the listing's logo; not referenced by either manifest
];

/**
 * Files that carry terms rather than behaviour, copied when the repository has them.
 *
 * Optional rather than required, and that is a statement of fact about `main` rather
 * than a convenience: there is no root `LICENSE` in this repository yet, and inventing
 * one in a build script would be inventing licensing terms. The build says so loudly
 * instead, and picks the file up the moment it lands.
 *
 * `THIRD_PARTY_NOTICES.txt` is deliberately **not** on this list, even though it exists.
 * It is the *browser application's* notices — three.js and the colour table — and its own
 * first paragraph says so: "These notices apply to those components only and do not
 * license this project, its fonts, logos or artwork." None of those components is in
 * either artifact, which `auditDependencies` below asserts rather than assumes. A file
 * of notices for software that is not here would be misleading rather than thorough, so
 * the generated `NOTICE` points at it instead.
 *
 * The root `NOTICE` is off this list for a related reason: `notice()` below **generates**
 * one, saying things about *this artifact* the repository's cannot — its version, its host,
 * and that it bundles no third-party code. Copying the repository's as well put two files
 * called `NOTICE` in the staging list, which is how this was found.
 *
 * That is the right way round rather than a convenient one. Apache-2.0 §4(d) asks a
 * derivative work to carry the attribution notices from the original's `NOTICE`
 * "excluding those notices that do not pertain to any part of the Derivative Works" —
 * and the repository's `NOTICE` is a brand-asset carve-out naming six logos in the
 * scene, not one of which is in either artifact. The generated notice carries the
 * copyright line, which is the part that does pertain. If an artifact ever starts
 * shipping one of those assets, this decision has to be revisited, not inherited.
 */
const LEGAL = ['LICENSE', 'LICENCE', 'LICENSE.md'];

/** Where the notices that do not apply to these artifacts live, for the NOTICE to name. */
const APP_NOTICES = 'THIRD_PARTY_NOTICES.txt';

const HOSTS = {
  claude: {
    harness: 'claude-code',
    label: 'Claude Code',
    manifest: '.claude-plugin/plugin.json',
    /** `aop-send` resolves `./mappers/<harness>.cjs`, so the host decides which travel. */
    mappers: ['bin/mappers/claude-code.cjs'],
    /**
     * The environment each host hands a hook, which is also how the hook knows which
     * host it is in: `bin/aop-plugin-hook.sh` reads `codex-cli` from the *presence* of
     * `PLUGIN_ROOT`. Codex sets both — `CLAUDE_PLUGIN_ROOT` as a compatibility alias,
     * which is what lets one `hooks/hooks.json` serve both — so a verification that
     * set only `PLUGIN_ROOT` would be testing an environment no host produces.
     */
    rootVars: ['CLAUDE_PLUGIN_ROOT'],
  },
  codex: {
    harness: 'codex-cli',
    label: 'Codex',
    manifest: '.codex-plugin/plugin.json',
    // Two, because `codex-cli.cjs` keeps the state machine in the Claude mapper and
    // states only the differences. Shipping one would be an artifact that passes the
    // audit and dies on its first hook.
    mappers: ['bin/mappers/claude-code.cjs', 'bin/mappers/codex-cli.cjs'],
    rootVars: ['PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT'],
  },
};

function die(message) {
  console.error(`[pack] ${message}`);
  process.exit(1);
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel));
  } catch {
    return die(`cannot read ${rel}`);
  }
}

const readJson = (rel) => JSON.parse(read(rel).toString('utf8'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const jsonFile = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

// --- generated members -----------------------------------------------------

/**
 * The artifact's explicit file list, with a digest each.
 *
 * The release requirement this satisfies is "publish complete runtime artifacts with
 * explicit file lists". A list of names alone would only say what was *meant* to be
 * here; the digests make it a statement about the bytes, so an artifact can be checked
 * against it long after the build that made it, on a machine with no checkout.
 *
 * It does not list itself, for the obvious reason: a file cannot contain its own digest.
 */
function filesJson(host, version, entries) {
  return jsonFile({
    artifact: `roving-office-${host}`,
    plugin: 'roving-office',
    version,
    harness: HOSTS[host].harness,
    generatedBy: 'bin/aop-plugin-pack.cjs',
    note: 'Every file in this artifact except this one. Paths are relative to the plugin root.',
    files: entries.map((entry) => ({
      path: entry.path,
      bytes: entry.data.length,
      mode: `0${(entry.mode ?? 0o644).toString(8)}`,
      sha256: sha256(entry.data),
    })),
  });
}

/**
 * The notice that travels with every artifact.
 *
 * Generated rather than copied, because it says things only the build knows — which
 * version this is, which host it was cut for, and that the artifact bundles no
 * third-party code, which the audit and the staging list together actually establish.
 * It is a notice and not a licence: it grants nothing, and says where the terms are.
 */
function notice(host, version, hasLicence) {
  const manifest = readJson(HOSTS[host].manifest);
  const author = manifest.author?.name ?? 'The Roving Office';
  return Buffer.from(`The Roving Office — ${HOSTS[host].label} plugin
Version ${version}

Copyright ${author}.

Generated by bin/aop-plugin-pack.cjs from the project source at
${manifest.homepage ?? 'https://github.com/atlassian-labs/roving-office'}

This artifact contains this project's own code and its logo, and no third-party
software: it bundles no packages, vendors no third-party source and requires no
package installation, so every module it loads is one of the files listed in
FILES.json or a Node builtin. The build asserts that rather than assuming it.

Consequently the project's ${APP_NOTICES} does not travel with this
artifact. Those notices are the browser application's — the vendored 3D library and
the colour table — and none of that software is here. They are in the project source
beside this file's generator, with the full provenance record in
third-party/inventory.json.

This artifact needs a Node from the project's supported range on the machine where the
agent runs, and nothing else.

${hasLicence
    ? 'Licence terms are in the LICENSE file beside this one.'
    : `No licence file is shipped with this build, because the project source does not
carry one yet. Until it does, this artifact grants no licence and is not intended for
public redistribution. The logo's release rights are recorded as an open gate in
third-party/inventory.json (component "project-artwork").`}
`, 'utf8');
}

/** The install story, in the artifact, for whoever unpacks it without the site. */
function readme(host, version, baseUrl) {
  const common = `# The Roving Office — ${HOSTS[host].label} plugin

Version ${version}. A zero-context observer: it turns your agent's lifecycle, tool,
plan, permission and subagent events into characters walking around a live isometric
office. Nothing here enters the model's context or changes how the agent behaves.

`;
  const install = host === 'claude'
    ? `## Install

    /plugin marketplace add ${baseUrl}/${SITE_PATH}/claude/marketplace.json
    /plugin install roving-office@roving-office

Then restart the session: hooks are read at session start.

Third-party marketplaces have auto-update disabled by default, so a new version is
picked up by \`/plugin marketplace update roving-office\` followed by
\`/plugin update roving-office@roving-office\`.
`
    : `## Install

This directory is a Codex marketplace. Point Codex at it — a local path while it is on
disk, or the Git repository it is published to:

    codex plugin marketplace add <path-or-repo>
    codex plugin add roving-office@roving-office

Then start a new thread, open \`/hooks\`, and review and trust the plugin's hooks:
installing a plugin does not trust them for you.
`;
  return Buffer.from(`${common}${install}
## Pointing it at an office

Installing the plugin does not tell it which office to feed. The adapter reads
\`~/.roving-office/endpoint.json\`, or the \`AOP_URL\` and \`AOP_TOKEN\` environment
variables. Connecting it to a hosted office is separate work and is not part of this
artifact.

## What it may say about you

Redaction defaults to \`metadata\`: tool classes, targets and timings, no prompt text
and no file contents. \`~/.roving-office/settings.json\` raises it deliberately.

## Files

\`FILES.json\` lists every file here with its size and SHA-256.
`, 'utf8');
}

/**
 * The hosted Claude marketplace.
 *
 * Derived from `.claude-plugin/marketplace.json` rather than written out again, so the
 * name, description and owner cannot drift between the marketplace a developer adds
 * from a checkout and the one a stranger adds from a URL. Exactly one thing changes,
 * and it is the thing that has to: `"./"` becomes the archive, pinned.
 */
function claudeMarketplace(version, digest, baseUrl) {
  const source = readJson('.claude-plugin/marketplace.json');
  const entry = source.plugins?.[0];
  if (!entry) die('.claude-plugin/marketplace.json lists no plugins');
  if (source.plugins.length !== 1) die('.claude-plugin/marketplace.json lists more than one plugin; this build assumes one');

  return jsonFile({
    ...source,
    plugins: [{
      name: entry.name,
      description: entry.description,
      version,
      source: {
        source: 'archive',
        url: `${baseUrl}/${SITE_PATH}/claude/${archiveName(version)}`,
        // Recommended by the schema, and the reason this file is generated: it is
        // verified on every download and the install is refused on a mismatch.
        sha256: digest,
      },
    }],
  });
}

/**
 * The Codex marketplace, at the root of the distribution tree.
 *
 * `.agents/plugins/marketplace.json` is the first path Codex looks in and the only
 * host-neutral one, which is why the artifact uses it rather than borrowing Claude's.
 * `"source": "./"` is correct here and wrong in the Claude manifest, and the difference
 * is the whole reason these two artifacts are shaped differently: Codex clones the
 * repository, so the marketplace root and the plugin root are the same directory.
 */
function codexMarketplace(version) {
  const source = readJson('.claude-plugin/marketplace.json');
  const manifest = readJson('.codex-plugin/plugin.json');
  return jsonFile({
    name: source.name,
    description: source.description,
    owner: source.owner,
    plugins: [{
      name: manifest.name,
      description: manifest.description,
      version,
      source: './',
    }],
  });
}

const archiveName = (version) => `roving-office-${version}.zip`;

// --- staging ---------------------------------------------------------------

/**
 * Every member of one host's artifact, in one fixed order.
 *
 * Sorted by path with a plain code-unit comparison rather than a locale-aware one: the
 * order is part of the archive's bytes, and a build whose output depended on `LANG`
 * would be reproducible on one machine and not the next.
 */
function stage(host, version, baseUrl) {
  const spec = HOSTS[host];
  const entries = [];
  const add = (rel, data, mode = 0o644) => entries.push({ path: rel, data, mode });

  for (const rel of [...RUNTIME, ...spec.mappers]) {
    add(rel, read(rel), rel.endsWith('.sh') ? 0o755 : 0o644);
  }

  // Stamped, not copied: the manifest in the checkout is the source of everything
  // except the version, which comes from package.json so three files cannot give three
  // answers to one question.
  const manifest = { ...readJson(spec.manifest), version };
  add(spec.manifest, jsonFile(manifest));

  const legal = LEGAL.filter((rel) => fs.existsSync(path.join(ROOT, rel)));
  for (const rel of legal) add(rel, read(rel));
  const hasLicence = legal.some((rel) => /^LICEN[CS]E/.test(rel));

  if (host === 'codex') add('.agents/plugins/marketplace.json', codexMarketplace(version));

  add('NOTICE', notice(host, version, hasLicence));
  add('README.md', readme(host, version, baseUrl));

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // FILES.json is appended after the sort and describes everything before it, so its
  // own position is fixed too — last — without it having to describe itself.
  entries.push({ path: 'FILES.json', data: filesJson(host, version, entries), mode: 0o644 });

  return { entries, hasLicence };
}

/** Write a staged entry list to a directory, so it can be walked and audited. */
function materialise(entries, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const entry of entries) {
    const at = path.join(dir, entry.path);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, entry.data);
    fs.chmodSync(at, entry.mode);
  }
  return dir;
}

/**
 * Refuse to ship an artifact that will not run somewhere else.
 *
 * Two failures, one walk, and both present identically on the far side: a plugin that
 * requires `../../bin/lib/aop-core.cjs` on a machine with no `bin/` above it, and one
 * whose own `todo-steps.cjs` was left out of `RUNTIME`, are both a hook that exits
 * without sending anything — silently, because the adapter's first design rule is that
 * the office never becomes the agent's problem. Which makes this the only place either
 * one can be noticed.
 */
function audit(dir, host) {
  const { escapes, missing } = auditTree(dir);
  if (escapes.length) {
    die(`the ${host} artifact reaches outside itself, so its hooks would send nothing:\n  ${escapes.join('\n  ')}`);
  }
  if (missing.length) {
    die(`the ${host} artifact imports files it does not contain — add them to RUNTIME:\n  ${missing.join('\n  ')}`);
  }
}

/**
 * Nothing in the artifact may name the machine that built it.
 *
 * `aop-claude-install.cjs --settings` writes this checkout's absolute path into
 * `~/.claude/settings.json` on purpose, and the migration note in the plugin's own
 * release notes is about
 * exactly that. An *artifact* that did the same would be a plugin that only works on
 * the developer's laptop, and the symptom — hooks that resolve to a path that is not
 * there — is the thing this whole build exists to prevent. So it is asserted rather
 * than assumed, over the bytes rather than over the staging list.
 */
/**
 * Every module the artifact loads is either one of its own files or a Node builtin.
 *
 * `auditTree` answers the *relative* half of the question and deliberately skips bare
 * specifiers, because in a checkout a bare specifier is an npm package that is really
 * there. In an artifact it is a package that is not, and one would be a hook that dies
 * on `Cannot find module` — or, worse, a third-party dependency shipped with no notice
 * for it, which is the claim the generated NOTICE makes and this is what makes that
 * claim checked. See `third-party/components.json`, whose `openclaw-tarball` entry says
 * the same thing about the other packer's payload.
 */
function auditDependencies(entries, host) {
  const builtins = new Set(require('module').builtinModules);
  const bare = [];
  for (const entry of entries) {
    if (!/\.(mjs|cjs|js)$/.test(entry.path)) continue;
    const body = entry.data.toString('utf8');
    for (const pattern of SPECIFIERS) {
      for (const match of body.matchAll(pattern)) {
        const spec = match[1];
        if (spec.startsWith('.')) continue;
        const name = spec.replace(/^node:/, '').split('/')[0];
        if (!builtins.has(name)) bare.push(`${entry.path} -> ${spec}`);
      }
    }
  }
  if (bare.length) {
    die(`the ${host} artifact requires packages it does not ship, and no notice covers them:\n  ${bare.join('\n  ')}`);
  }
}

function auditPaths(entries, host) {
  const named = [];
  for (const entry of entries) {
    if (/\.(png|zip|woff2|ico)$/.test(entry.path)) continue;
    if (entry.data.toString('utf8').includes(ROOT)) named.push(entry.path);
  }
  if (named.length) {
    die(`the ${host} artifact names the checkout it was built in (${ROOT}):\n  ${named.join('\n  ')}`);
  }
}

// --- building --------------------------------------------------------------

/**
 * Build both hosts into `out`, and return everything a caller needs to check it.
 *
 * Pure with respect to the filesystem it writes: given the same checkout it produces
 * the same bytes, which is what makes `--check` a drift check rather than a coin toss.
 */
function build({ baseUrl, version }) {
  const built = {};

  for (const host of Object.keys(HOSTS)) {
    const { entries, hasLicence } = stage(host, version, baseUrl);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `tmp_rovo_pack_${host}-`));
    try {
      audit(materialise(entries, path.join(scratch, 'plugin')), host);
      auditPaths(entries, host);
      auditDependencies(entries, host);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    built[host] = { entries, hasLicence };
  }

  const files = new Map();

  // Claude: one archive, plus the manifest that points at it and pins it.
  const archive = zip(built.claude.entries);
  files.set(path.join('claude', archiveName(version)), archive);
  files.set(path.join('claude', 'marketplace.json'), claudeMarketplace(version, sha256(archive), baseUrl));

  // Codex: the distribution repository, file by file, because Codex clones rather
  // than downloads and there is nothing useful to put in an archive.
  for (const entry of built.codex.entries) {
    files.set(path.join('codex', entry.path), entry.data);
  }

  return { built, files, archive, digest: sha256(archive) };
}

/** Write a built file map under `out`, replacing whatever was there. */
function emit(files, out, { modeOf }) {
  for (const dir of new Set([...files.keys()].map((rel) => rel.split(path.sep)[0]))) {
    fs.rmSync(path.join(out, dir), { recursive: true, force: true });
  }
  for (const [rel, data] of files) {
    const at = path.join(out, rel);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, data);
    fs.chmodSync(at, modeOf(rel));
  }
}

/** The mode a written file wants: the staged one, or 0644 for what the build generated. */
function modeLookup(built) {
  const modes = new Map();
  for (const [host, { entries }] of Object.entries(built)) {
    for (const entry of entries) modes.set(path.join(host, entry.path), entry.mode);
  }
  return (rel) => modes.get(rel) ?? 0o644;
}

// --- verification ----------------------------------------------------------

/**
 * Unpack the archive somewhere with no checkout above it, and prove the plugin runs.
 *
 * The audit proves no import escapes and `auditPaths` proves no path names this
 * machine; neither proves the thing works, and they cannot — a file can be present,
 * correct and still be the wrong version of itself. So the archive is extracted, a
 * receiver is opened on loopback, and the hook is fired exactly as a host fires it:
 * the command string out of the artifact's own `hooks/hooks.json`, through a shell,
 * with the host's plugin-root variable set and `HOME` pointed at a scratch directory
 * so the run cannot see or disturb the office on this machine.
 *
 * Two hook events rather than one, because the Claude mapper *holds* the introduction
 * at `SessionStart` and releases it on the first real event — a verification that fired
 * only `SessionStart` would assert that a working adapter sends nothing.
 *
 * Asynchronous, and that is load-bearing rather than taste: the receiver runs on this
 * process's event loop, and a `spawnSync` blocks it — so the hook's POST would sit in
 * the accept backlog, never be answered, and time out. The first draft did exactly
 * that and "verified" an adapter that had in fact been unable to deliver anything.
 */
async function verifyRun(pluginRoot, host, label) {
  const spec = HOSTS[host];
  const hooks = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  const command = hooks.hooks.SessionStart?.[0]?.hooks?.[0]?.command;
  if (!command) return die(`${label}: the artifact's hooks.json has no SessionStart command`);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp_rovo_pack_home-'));
  const got = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      for (const line of Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean)) {
        try { got.push(JSON.parse(line)); } catch { /* a body we did not send is not ours */ }
      }
      res.writeHead(202, { 'Content-Type': 'application/json' }).end('{}');
    });
  });

  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/office/TEST-0000/aop/v0/events`;

    const session = `pack-verify-${host}`;
    const payloads = [
      { hook_event_name: 'SessionStart', session_id: session, cwd: home, source: 'startup', model: 'verify' },
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: session,
        cwd: home,
        prompt: 'pack verification',
        prompt_id: 'p1',
        turn_id: 'p1',
      },
    ];

    for (const payload of payloads) {
      const result = await runHook(command, payload, {
        cwd: home,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          AOP_URL: url,
          ...Object.fromEntries(spec.rootVars.map((name) => [name, pluginRoot])),
        },
      });
      if (result.code !== 0) return die(`${label}: the hook exited ${result.code}\n${result.stderr}`);
      if (result.stderr.trim()) return die(`${label}: the hook wrote to stderr:\n${result.stderr}`);
    }

    // The hook has exited, so it has written its request; the receiver's `end` handler
    // is a turn of this loop later. A short wait rather than a handshake, because the
    // adapter deliberately does not wait for us either.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const types = got.map((event) => event.type);
    if (!types.includes('session.start')) {
      return die(`${label}: no session.start arrived; got ${types.join(', ') || '(nothing)'}`);
    }
    if (!types.includes('turn.start')) return die(`${label}: no turn.start arrived; got ${types.join(', ')}`);
    const wrong = got.find((event) => event.harness?.name !== spec.harness);
    if (wrong) return die(`${label}: an event claimed harness ${wrong.harness?.name}, not ${spec.harness}`);

    // The point of the whole exercise: the command the host ran resolved inside the
    // installed artifact, and nothing it loaded came from this checkout.
    console.log(`[pack]   ${label}`);
    for (const name of spec.rootVars) console.log(`[pack]     ${name}=${pluginRoot}`);
    console.log(`[pack]     ${types.join(', ')} — harness ${spec.harness}`);
    return true;
  } finally {
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** One hook invocation, exactly as a host makes it: a shell command fed JSON on stdin. */
function runHook(command, payload, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

/** Extract the archive with our own reader, and cross-check `unzip` where there is one. */
function extract(archive, into) {
  for (const entry of unzip(archive)) {
    const at = path.join(into, entry.path);
    if (!path.resolve(at).startsWith(path.resolve(into))) die(`the archive escapes its target: ${entry.path}`);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, entry.data);
    fs.chmodSync(at, entry.mode || 0o644);
  }

  // A reader that only has to read what this repo writes could agree with the writer
  // and both be wrong about the format. When a real implementation is on PATH, ask it.
  const zipFile = path.join(path.dirname(into), 'cross-check.zip');
  fs.writeFileSync(zipFile, archive);
  const probe = spawnSync('unzip', ['-t', zipFile], { encoding: 'utf8' });
  if (probe.error) {
    console.log('[pack]   unzip is not on PATH, so the archive was read by bin/lib/zip.cjs alone');
  } else if (probe.status !== 0) {
    die(`\`unzip -t\` rejects the archive this build produced:\n${probe.stdout}${probe.stderr}`);
  } else {
    console.log('[pack]   `unzip -t` accepts the archive');
  }
  return into;
}

/**
 * Install the Codex tree the way Codex installs it, into a throwaway Codex home.
 *
 * `codex plugin marketplace add` takes a local path or a Git remote and resolves both
 * the same way — it copies the marketplace root into a versioned cache — so a local-path
 * install is a faithful stand-in for the Git one, and it is the only half that can be
 * run before the distribution repository exists. `CODEX_HOME` keeps it entirely out of
 * the real one: no marketplace is added to this machine and no plugin is installed on it.
 */
function verifyCodexCli(tree, version, scratch) {
  const probe = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.log('[pack]   codex is not on PATH, so the real install was not exercised');
    return null;
  }

  // Under the caller's scratch rather than its own, because the cache it produces is
  // the thing verified next and a `finally` that swept it would take the evidence with
  // it. The caller removes the whole tree when it is done.
  const home = path.join(scratch, 'codex-home');
  fs.mkdirSync(home, { recursive: true });
  const codex = (args) => spawnSync('codex', args, {
    encoding: 'utf8', timeout: 120_000, env: { ...process.env, CODEX_HOME: home },
  });

  const added = codex(['plugin', 'marketplace', 'add', tree]);
  if (added.status !== 0) die(`codex refused the generated marketplace:\n${added.stderr || added.stdout}`);

  const installed = codex(['plugin', 'add', 'roving-office@roving-office', '--json']);
  if (installed.status !== 0) die(`codex refused to install the plugin:\n${installed.stderr || installed.stdout}`);

  let at;
  try { at = JSON.parse(installed.stdout).installedPath; } catch { at = null; }
  // Through realpath on both sides: macOS hands out `/var/folders/…` temp directories
  // that are a symlink to `/private/var/folders/…`, and Codex answers with the resolved
  // form. Comparing the strings would fail this check on every Mac.
  const real = fs.realpathSync(home);
  if (!at || !fs.realpathSync.native(at).startsWith(real)) {
    die(`codex reported install path ${at}, which is not under the throwaway home ${real}`);
  }
  if (!fs.existsSync(path.join(at, 'bin', 'aop-send.cjs'))) die(`codex cached ${at} without the adapter`);
  console.log(`[pack]   codex installed ${version} into its own cache, ${path.relative(real, fs.realpathSync(at))}`);
  return at;
}

async function verify(out, version, digest) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp_rovo_pack_verify-'));
  try {
    const archive = fs.readFileSync(path.join(out, 'claude', archiveName(version)));
    if (sha256(archive) !== digest) die('the archive on disk does not match the digest just built');

    const claudeRoot = extract(archive, path.join(scratch, 'claude'));
    if (fs.existsSync(path.join(claudeRoot, 'node_modules'))) die('the archive brought a node_modules');
    await verifyRun(claudeRoot, 'claude', 'claude, unpacked from the archive into a temp directory');

    // Copied out of the checkout before it is run, even though it would run in place.
    // The claim being made is "with no checkout above it", and `plugins/codex/` has
    // the whole repository above it — so the claim would be untested where it matters.
    const codexRoot = path.join(scratch, 'codex');
    fs.cpSync(path.join(out, 'codex'), codexRoot, { recursive: true });
    await verifyRun(codexRoot, 'codex', 'codex, from the distribution tree in a temp directory');

    const cached = verifyCodexCli(codexRoot, version, scratch);
    if (cached) await verifyRun(cached, 'codex', "codex, from codex's own plugin cache");
    return true;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// --- the drift check -------------------------------------------------------

/**
 * Do the committed files still say what this checkout would say?
 *
 * Only the served half is checked, because only the served half is committed. This is
 * `docs/site`'s bargain, and the same guard: generated output that a deploy copies
 * rather than builds has to be committed, and committed generated output needs a test
 * or it quietly stops matching its source.
 */
function check(out, files, version) {
  const problems = [];
  const served = [...files.keys()].filter((rel) => rel.startsWith(`claude${path.sep}`));

  const present = new Set();
  const dir = path.join(out, 'claude');
  if (fs.existsSync(dir)) for (const name of fs.readdirSync(dir)) present.add(path.join('claude', name));

  for (const rel of served) {
    const at = path.join(out, rel);
    present.delete(rel);
    if (!fs.existsSync(at)) { problems.push(`${rel} is missing`); continue; }
    if (!fs.readFileSync(at).equals(files.get(rel))) problems.push(`${rel} differs from this checkout`);
  }
  for (const stale of present) problems.push(`${stale} is left over from an older version`);

  const versions = {
    'package.json': readJson('package.json').version,
    '.claude-plugin/plugin.json': readJson('.claude-plugin/plugin.json').version,
    '.codex-plugin/plugin.json': readJson('.codex-plugin/plugin.json').version,
  };
  for (const [file, found] of Object.entries(versions)) {
    if (found !== version) problems.push(`${file} says ${found}, and the build stamped ${version}`);
  }

  return problems;
}

// --- cli -------------------------------------------------------------------

async function main(argv) {
  const { flag, value, help } = flags(argv);
  if (help) {
    console.log('usage: aop-plugin-pack.cjs [--verify | --check] [--out <dir>] [--base-url <url>]');
    return 0;
  }

  const out = path.resolve(value('--out') ?? path.join(ROOT, SITE_PATH));
  const baseUrl = String(value('--base-url') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const version = readJson('package.json').version;
  if (!version) die('the repo package.json has no version to stamp');

  const { built, files, digest } = build({ baseUrl, version });

  if (flag('--check')) {
    const problems = check(out, files, version);
    if (problems.length) {
      console.error('[pack] the committed plugin distribution has drifted from this checkout:');
      for (const problem of problems) console.error(`[pack]   ${problem}`);
      console.error('[pack] run `npm run pack:plugins` and commit what it writes.');
      return 1;
    }
    console.log(`[pack] the committed Claude marketplace and archive match this checkout (${version})`);
    return 0;
  }

  fs.mkdirSync(out, { recursive: true });
  emit(files, out, { modeOf: modeLookup(built) });

  const rel = path.relative(ROOT, out) || '.';
  const kb = (files.get(path.join('claude', archiveName(version))).length / 1024).toFixed(1);
  console.log(`[pack] ${rel}/claude/${archiveName(version)} (${kb} KiB, ${built.claude.entries.length} files)`);
  console.log(`[pack] ${rel}/claude/marketplace.json (archive pinned to sha256:${digest.slice(0, 16)}…)`);
  console.log(`[pack] ${rel}/codex/ (${built.codex.entries.length} files — a Codex marketplace, ready for a public repository)`);

  if (!built.claude.hasLicence) {
    console.log('[pack] NOTE: this repository has no root LICENSE, so neither artifact carries one.');
    console.log('[pack]       The build picks one up as soon as it lands; until then the generated');
    console.log('[pack]       NOTICE says the artifact grants no licence.');
  }

  if (flag('--verify')) await verify(out, version, digest);

  console.log('');
  console.log('Once the site has been deployed, the published Claude install is:');
  console.log(`  /plugin marketplace add ${baseUrl}/${SITE_PATH}/claude/marketplace.json`);
  console.log('  /plugin install roving-office@roving-office');
  console.log('');
  console.log(`Codex needs a repository rather than an archive. Publish ${rel}/codex/ to a public`);
  console.log('Git repository, then:');
  console.log('  codex plugin marketplace add <owner>/<repo>');
  console.log('  codex plugin add roving-office@roving-office');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = {
  HOSTS, RUNTIME, LEGAL, APP_NOTICES, SITE_PATH, DEFAULT_BASE_URL,
  archiveName, build, check, stage, claudeMarketplace, codexMarketplace, main,
};
