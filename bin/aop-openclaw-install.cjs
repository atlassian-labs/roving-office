#!/usr/bin/env node
// aop-openclaw-install — register The Roving Office as an OpenClaw plugin.
//
//   node bin/aop-openclaw-install.cjs --status      report what is currently wired up
//   node bin/aop-openclaw-install.cjs --dry-run     show the commands, run nothing
//   node bin/aop-openclaw-install.cjs               install (linked, in place)
//   node bin/aop-openclaw-install.cjs --uninstall   remove
//
// This installer is thinner than the other two, and the reason is worth stating: the
// other harnesses have no concept of an integration, so `aop-rovo-install` has to edit
// a YAML file as text and `aop-claude-install` has to manage a marketplace. OpenClaw has
// a real plugin manager, so the whole job is to call it correctly and to say clearly
// what happened.
//
// **Installed with `--link`, deliberately.** OpenClaw can install a plugin from ClawHub,
// npm, git or a local path, and for a local path it offers both a copy and a link. We
// link, for two reasons:
//
//   1. The plugin shares `bin/lib/aop-core.cjs` with the hook adapters — one answer to
//      "which office does this repo belong to" and "how much may be said about it" for
//      every harness on the machine. A copy of the plugin directory alone would not
//      carry it.
//   2. It sidesteps the trap documented for the Claude plugin, where install *copies*
//      the repo to a version-keyed cache and `plugin update` compares versions to decide
//      whether to re-copy — so a change that does not bump the version is a change no
//      session ever runs. A link has no snapshot, so it cannot go stale, and there is no
//      version ritual to forget.
//
// The cost of that choice is that the checkout has to stay where it is. That is the same
// deal `aop-rovo-install` already strikes by baking an adapter path into a config file,
// and `--status` reports the path so a moved checkout is visible rather than mysterious.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { scaffoldAll, statusLines } = require('./lib/local-config.cjs');
const { flags } = require('./lib/cli-flags.cjs');

const PLUGIN_ID = 'roving-office';
const PLUGIN_DIR = path.resolve(__dirname, '..', 'openclaw-plugin');
const CORE = path.resolve(__dirname, 'lib', 'aop-core.cjs');
const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');

// Verified against the `openclaw` npm package at this version: the hook names, the
// payload types and `api.on` all come from its shipped `dist/*.d.ts`. Older versions may
// well work — the plugin asks for each hook individually and shrugs off one it does not
// recognise — but this is the version the mapping was read from.
const VERIFIED_AGAINST = '2026.7.1-2';

// --- finding openclaw ------------------------------------------------------

function openclawVersion() {
  try {
    return execFileSync('openclaw', ['--version'], {
      encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n')[0];
  } catch {
    return null;
  }
}

/** Run an `openclaw` subcommand, streaming its output. Never throws. */
function openclaw(args, { dryRun }) {
  const shown = `openclaw ${args.join(' ')}`;
  if (dryRun) { console.log(`  would run:  ${shown}`); return { ok: true, dryRun: true }; }
  console.log(`  running:  ${shown}`);
  const res = spawnSync('openclaw', args, { stdio: 'inherit', timeout: 180000 });
  return { ok: res.status === 0, status: res.status };
}

/**
 * Whether the plugin appears installed, read from OpenClaw's own config rather than by
 * parsing `plugins list` output — a config key is a stabler contract than a table.
 * `plugins.entries.<id>` is where an install records itself, and `plugins.load.paths`
 * is where a linked one records where it lives.
 */
function readInstallState() {
  let raw;
  try { raw = fs.readFileSync(OPENCLAW_CONFIG, 'utf8'); } catch { return { configExists: false }; }
  let cfg;
  try {
    // The config is JSON5 and may carry comments, so a strict parse can legitimately
    // fail on a file that OpenClaw is perfectly happy with. Falling back to a substring
    // check keeps `--status` useful instead of wrong.
    cfg = JSON.parse(raw);
  } catch {
    return {
      configExists: true,
      parsed: false,
      mentioned: raw.includes(PLUGIN_ID),
    };
  }
  const entry = cfg?.plugins?.entries?.[PLUGIN_ID] ?? null;
  const paths = cfg?.plugins?.load?.paths ?? [];
  return {
    configExists: true,
    parsed: true,
    entry,
    linkedPath: Array.isArray(paths) ? paths.find((p) => String(p).includes('openclaw-plugin')) ?? null : null,
    config: entry?.config ?? null,
    // The whole config, for the cast below: who an agent is depends on `agents.list` and on
    // the workspace that follows from it, so answering "why is this one called that" needs
    // more of the file than the plugin's own entry.
    openclaw: cfg,
  };
}

// --- who the office will think everybody is ---------------------------------

/**
 * The cast, resolved the way the running plugin resolves it.
 *
 * Here because the bug it answers cost an afternoon. An agent wearing the wrong name is
 * nearly always an `IDENTITY.md` read from the wrong directory, and until this table existed
 * there was no way to see *which* directory without running a gateway and reading its log.
 * It calls the plugin's own `lib/identity.mjs` rather than restating the rules, so a table
 * that disagrees with the room is a bug in one place rather than a difference of opinion.
 */
function castLines(config) {
  let identity;
  try {
    identity = require(path.join(PLUGIN_DIR, 'lib', 'identity.mjs'));
  } catch (err) {
    return [`Cast:      could not be read (${err.message})`];
  }
  const { makeIdentityResolver, workspaceForAgent, DEFAULT_AGENT_ID } = identity;

  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const declared = list.find((entry) => entry?.default === true);
  // The default agent first, and included even when the config has never heard of it —
  // that is the normal shape, and the one that used to come out nameless.
  const ids = [...new Set([
    declared ? String(declared.id) : DEFAULT_AGENT_ID,
    ...list.map((entry) => String(entry?.id ?? '')).filter(Boolean),
  ])];

  const resolve = makeIdentityResolver({ api: { config } });
  const lines = ['Cast:      who the office will call each agent'];
  for (const id of ids) {
    const who = resolve(id) ?? {};
    const bits = [who.name ?? 'NO NAME — the office will invent one'];
    if (who.color) bits.push(`wearing ${who.color}`);
    if (who.avatarPath) bits.push('with a face');
    else if (who.avatar) bits.push(`avatar ${who.avatar} NOT FOUND`);
    lines.push(`           ${id.padEnd(12)} ${bits.join(', ')}`);
    lines.push(`           ${''.padEnd(12)} ${who.workspace ?? workspaceForAgent(config, id) ?? '(no workspace)'}/IDENTITY.md`);
  }
  return lines;
}

// --- the plugin's own sanity ------------------------------------------------

function checkPlugin() {
  const notes = [];
  let ok = true;
  for (const file of ['package.json', 'openclaw.plugin.json', 'index.mjs', 'lib/publisher.mjs', 'lib/map.mjs']) {
    const full = path.join(PLUGIN_DIR, file);
    if (fs.existsSync(full)) continue;
    notes.push(`  missing: ${full}`);
    ok = false;
  }
  // The link points at this directory, and the directory reaches out of itself for the
  // shared core. If that is gone the plugin loads and then fails on its first event,
  // which is a much worse way to find out.
  if (!fs.existsSync(CORE)) {
    notes.push(`  missing: ${CORE} (the shared emitter core)`);
    ok = false;
  }
  return { ok, notes };
}

// --- status ----------------------------------------------------------------

function status() {
  const version = openclawVersion();
  console.log(`OpenClaw:  ${version ?? 'not found on PATH'}`);
  if (version) console.log(`           (this plugin was read from ${VERIFIED_AGAINST})`);
  console.log(`Plugin:    ${PLUGIN_DIR}`);

  const { ok, notes } = checkPlugin();
  if (!ok) { console.log('  INCOMPLETE:'); for (const n of notes) console.log(n); }

  const state = readInstallState();
  if (!state.configExists) {
    console.log(`Config:    none at ${OPENCLAW_CONFIG} — run OpenClaw once, then install`);
  } else if (!state.parsed) {
    console.log(`Config:    ${OPENCLAW_CONFIG} (not strict JSON, so read loosely)`);
    console.log(`           plugin id ${state.mentioned ? 'appears' : 'does not appear'} in the file`);
  } else if (state.entry) {
    const enabled = state.entry.enabled !== false;
    console.log(`Config:    installed, ${enabled ? 'enabled' : 'DISABLED'}`);
    if (state.linkedPath) console.log(`           linked from ${state.linkedPath}`);
    if (state.linkedPath && path.resolve(state.linkedPath) !== PLUGIN_DIR) {
      console.log('           WARNING: that is not this checkout — the link points elsewhere');
    }
    const cfg = state.config ?? {};
    const keys = Object.keys(cfg);
    console.log(`           config: ${keys.length ? keys.join(', ') : '(none — endpoint comes from env or the endpoint file)'}`);
    if (cfg.url) console.log(`           url: ${cfg.url}`);

    // The one setting whose absence is otherwise invisible: OpenClaw blocks the run
    // lifecycle hooks for a non-bundled plugin without it, and says so only in
    // `openclaw plugins inspect`. Without it the office still shows tool work, but desks
    // have no job labels — so it is worth stating either way rather than only on failure.
    const granted = state.entry?.hooks?.allowConversationAccess === true;
    console.log(`           run lifecycle: ${granted ? 'allowed' : 'BLOCKED — no job labels on desks'}`);
    if (!granted) {
      console.log(`             fix: openclaw config set plugins.entries.${PLUGIN_ID}.hooks.allowConversationAccess true`);
    }
  } else {
    console.log(`Config:    ${OPENCLAW_CONFIG} — plugin not installed`);
  }

  // Who everybody will turn out to be. Printed whenever the config parsed, installed or
  // not: "will the room have the right people in it" is worth answering before an install
  // as well as after one.
  if (state.parsed) {
    console.log('');
    for (const line of castLines(state.openclaw)) console.log(line);
  }

  // `statusLines` already ends with where the events actually go, which is the fact that
  // matters most and the one an installed-but-unattached plugin gets wrong.
  console.log('');
  for (const line of statusLines(path.join(__dirname, 'aop-send.cjs'))) console.log(line);

  if (!version) {
    console.log('\nOpenClaw is not on this PATH, so nothing can be installed here.');
    console.log('The plugin itself is complete and installable from a machine that has it.');
  }
}

// --- install / uninstall ---------------------------------------------------

function install({ dryRun, conversationAccess }) {
  const { ok, notes } = checkPlugin();
  if (!ok) {
    console.log('The plugin directory is incomplete:');
    for (const n of notes) console.log(n);
    process.exitCode = 1;
    return;
  }

  const version = openclawVersion();
  if (!version) {
    console.log('OpenClaw is not on this PATH.');
    console.log('');
    console.log('Install it, then re-run this — or, on the machine that has it:');
    console.log(`  openclaw plugins install --link ${PLUGIN_DIR}`);
    // Exit 0: a missing harness is not an error, it is just a machine that does not
    // have it. The other installers take the same view.
    return;
  }

  console.log(`Installing ${PLUGIN_ID} into OpenClaw ${version}`);
  const linked = openclaw(['plugins', 'install', '--link', PLUGIN_DIR], { dryRun });
  if (!linked.ok) {
    console.log('');
    console.log('That failed. Two things worth checking, in this order:');
    console.log('  1. `openclaw plugins doctor` — it reports manifest and compat problems.');
    console.log(`  2. plugins.allow / plugins.deny in ${OPENCLAW_CONFIG}, which can exclude us.`);
    process.exitCode = 1;
    return;
  }

  // `before_agent_run` and `agent_end` are conversation hooks, and OpenClaw blocks them
  // for any non-bundled plugin unless this is set. Blocked, they take the desk labels and
  // turn timing with them — and they fail *silently* from the plugin's side, which is why
  // this is set at install time rather than left as a step in a document somebody skips.
  //
  // What it grants, precisely: those two hooks carry `prompt` and `messages`. This plugin
  // reads the prompt and nothing else, clamps it to 80 characters for a desk label, and
  // omits it entirely under `metadata` redaction. It never reads `messages`.
  if (conversationAccess) {
    const key = `plugins.entries.${PLUGIN_ID}.hooks.allowConversationAccess`;
    const res = openclaw(['config', 'set', key, 'true'], { dryRun });
    if (!res.ok) {
      console.log('');
      console.log('Could not grant run-lifecycle access, so desks will have no job labels.');
      console.log(`Set this by hand in ${OPENCLAW_CONFIG}:`);
      console.log(`    ${key}: true`);
    }
  } else {
    console.log('');
    console.log('Skipping run-lifecycle access (--no-conversation-access).');
    console.log('Tool activity and sessions will report; desks will have no job labels.');
  }

  if (dryRun) { console.log('\n(dry run: nothing run, nothing written)'); return; }

  for (const line of scaffoldAll(path.join(__dirname, 'aop-send.cjs')).lines) console.log(line);

  // This installer wires the plugin to *this machine's* office and no further: with no
  // config the plugin falls back to AOP_URL and then to ~/.roving-office/endpoint.json,
  // which is what a local office already writes, so a local setup needs nothing said.
  //
  // Publishing to a *remote* office is a different job with a different tool: a Gateway
  // that wants a hosted office is usually a Gateway on a server, with no checkout to link
  // to, so it is `npm run pack:openclaw` and the installer that ships beside the tarball.
  // Here, where the link route already worked, all that is left is the two keys.
  console.log('');
  console.log('The plugin will publish to AOP_URL, or to ~/.roving-office/endpoint.json —');
  console.log('which is to say, to whichever local office is running.');
  console.log('To publish to a REMOTE office instead, name it:');
  console.log(`    openclaw config set plugins.entries.${PLUGIN_ID}.config.url   <office-events-url>`);
  console.log(`    openclaw config set plugins.entries.${PLUGIN_ID}.config.token <write-token>`);
  console.log('On a server, with no checkout to link: npm run pack:openclaw, then run the');
  console.log('aop-openclaw-server.sh beside the tarball — it mints the office for you.');
  console.log('');
  console.log('The plugin loads at Gateway startup, so restart the OpenClaw Gateway:');
  console.log('    openclaw gateway restart');
  console.log('Then check it: node bin/aop-openclaw-install.cjs --status');
}

function uninstall({ dryRun }) {
  const version = openclawVersion();
  if (!version) { console.log('OpenClaw is not on this PATH; nothing to remove.'); return; }
  console.log(`Removing ${PLUGIN_ID} from OpenClaw ${version}`);
  const res = openclaw(['plugins', 'uninstall', PLUGIN_ID], { dryRun });
  if (!res.ok) {
    console.log(`\nThat failed. Remove plugins.entries.${PLUGIN_ID} from ${OPENCLAW_CONFIG} by hand.`);
    process.exitCode = 1;
    return;
  }
  if (!dryRun) {
    console.log('');
    console.log('Removed. `settings.json` and `projects.json` are left alone — they belong to');
    console.log('the office, not to OpenClaw, and other harnesses on this machine still read them.');
    console.log('Restart the Gateway to unload it:  openclaw gateway restart');
  }
}

// --- cli -------------------------------------------------------------------

function main() {
  const { flag, help } = flags(process.argv.slice(2));

  if (help) {
    console.log('usage: aop-openclaw-install.cjs [--status|--dry-run|--uninstall]');
    console.log('                                [--no-conversation-access]');
    console.log('');
    console.log('  Registers the plugin against whichever office is running locally, by');
    console.log('  linking this checkout. For a Gateway on a server, which has no checkout:');
    console.log('      npm run pack:openclaw   # tarball + aop-openclaw-server.sh, in dist/');
    console.log('');
    console.log('  --no-conversation-access');
    console.log('                  do not grant the run lifecycle hooks. The office still gets');
    console.log('                  sessions, tools and subagents, but desks carry no job label,');
    console.log('                  because the prompt is what a job label is made of.');
    return;
  }

  if (flag('--status')) { status(); return; }

  const dryRun = flag('--dry-run');
  if (flag('--uninstall')) { uninstall({ dryRun }); return; }
  install({ dryRun, conversationAccess: !flag('--no-conversation-access') });
}

main();
