#!/usr/bin/env node
// aop-claude-install — wire The Roving Office adapter into Claude Code.
//
//   node bin/aop-claude-install.cjs               install as a plugin
//   node bin/aop-claude-install.cjs --settings    install as settings.json hooks
//   node bin/aop-claude-install.cjs --dry-run     show the plan, change nothing
//   node bin/aop-claude-install.cjs --status      report what is wired up
//   node bin/aop-claude-install.cjs --uninstall   remove whichever route is active
//
// **Two routes, and they are not interchangeable.** This is the whole design of
// this script, and it comes from one measured fact: `claude plugin install`
// *copies* the plugin into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`
// — verified on 2.1.246 — so the installed plugin is a **snapshot**.
//
//   plugin (default)   One command, survives moving your checkout, and is what
//                      you would publish. But editing a mapper changes nothing
//                      until you refresh the snapshot, so it is the wrong shape
//                      for developing the adapter.
//   --settings         Hooks in ~/.claude/settings.json pointing at this
//                      checkout's aop-send.cjs. Live: an edit applies to the very
//                      next tool call. But the absolute path is stored verbatim,
//                      so moving the checkout breaks it silently.
//
// Never both at once: Claude Code runs **every** matching hook, so a machine with
// both routes active emits every event twice — two `tool.start`s with the same
// `tool_call_id`, and a room that double-counts. The installer refuses rather than
// letting that happen, and `--status` says which route is live.
//
// Which brings up the one happy difference from the Rovo CLI installer: because
// Claude runs every hook rather than only the first, we can simply *add* ourselves
// beside whatever hooks a user already has. No taking the first slot, no
// `--chain` to re-run a displaced command. Existing hooks are never touched.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  scaffoldAll, statusLines, checkAdapter,
} = require('./lib/local-config.cjs');
const { readJson } = require('./lib/aop-core.cjs');
const { flags } = require('./lib/cli-flags.cjs');

const HARNESS = 'claude-code';
const MARKER = 'aop-send.cjs';
const PLUGIN = 'roving-office';
const PLUGIN_ID = `${PLUGIN}@${PLUGIN}`;   // plugin@marketplace, both named for the office

const REPO = path.resolve(__dirname, '..');
let ADAPTER = path.join(__dirname, 'aop-send.cjs');

// Hooks run the adapter through a launcher rather than directly, because a hook
// inherits the environment of whatever started the agent and a GUI harness —
// Claude Desktop's Cowork — is started by launchd with a PATH that has no
// version-managed Node on it. See the header of aop-node.sh.
const LAUNCHER_NAME = 'aop-node.sh';
let LAUNCHER = path.join(__dirname, LAUNCHER_NAME);

/**
 * The hooks we install, and the ones the mapper knows but we deliberately leave
 * alone. Every hook costs a process spawn on the agent's critical path, so an
 * event earns its place by telling the office something the others do not.
 *
 * `matcher` only applies to tool-scoped events; elsewhere Claude ignores it.
 */
const HOOKS = [
  { name: 'SessionStart' },
  { name: 'UserPromptSubmit' },
  { name: 'PreToolUse', matcher: '*' },
  { name: 'PostToolUse', matcher: '*' },
  { name: 'PostToolUseFailure', matcher: '*' },
  { name: 'PermissionRequest', matcher: '*' },
  { name: 'PermissionDenied', matcher: '*' },
  { name: 'Notification' },
  { name: 'Stop' },
  { name: 'StopFailure' },
  { name: 'SubagentStart' },
  { name: 'SubagentStop' },
  { name: 'PreCompact' },
  { name: 'TeammateIdle' },
  { name: 'SessionEnd' },
];

const HOOK_TIMEOUT = 5;   // seconds; the adapter's own watchdog fires at 2.5

const USER_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const PLUGIN_REGISTRY = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
const MARKETPLACES = path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json');

// --- json, carefully -------------------------------------------------------

/** Distinguish "no file" from "a file I must not mangle". */
function loadSettings(file) {
  if (!fs.existsSync(file)) return { ok: true, value: {}, existed: false };
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return { ok: true, value: {}, existed: true };
  try { return { ok: true, value: JSON.parse(text), existed: true }; } catch (err) {
    return { ok: false, error: err.message, existed: true };
  }
}

// --- the plugin route ------------------------------------------------------

// `command -v` is a shell builtin, so it has to be the script `sh` runs — not the
// file it execs. Passing it as `execFileSync('command', ['-v', 'claude'], {shell})`
// makes Node hand `-v` and `claude` to `sh -c` as *positional parameters*, so the
// shell runs a bare `command`, prints nothing and exits 0 — indistinguishable from
// "not installed". That silently disabled the whole plugin route on every machine.
function claudeCli() {
  try {
    return execFileSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}

function claude(args) {
  try {
    const out = execFileSync('claude', args, { cwd: REPO, encoding: 'utf8', timeout: 60000 });
    return { ok: true, out: out.trim() };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message };
  }
}

function pluginState() {
  const registry = readJson(PLUGIN_REGISTRY, null);
  const installs = registry?.plugins?.[PLUGIN_ID] ?? [];
  const enabled = readJson(USER_SETTINGS, {})?.enabledPlugins?.[PLUGIN_ID];
  const market = readJson(MARKETPLACES, {})?.[PLUGIN] ?? null;
  return {
    installed: installs.length > 0,
    enabled: enabled !== false && installs.length > 0,
    installPath: installs[0]?.installPath ?? null,
    version: installs[0]?.version ?? null,
    marketplacePath: market?.installLocation ?? market?.source?.path ?? null,
  };
}

/**
 * The version in the manifest Claude reads, which decides whether an update can
 * do anything at all.
 *
 * The snapshot is cached at `cache/<plugin>/<plugin>/<version>`, and an update
 * that is offered the version it already holds concludes there is nothing to
 * fetch — silently, and whatever the files say. So a plugin-affecting change
 * that does not bump this is a change no session will ever run, and the advice
 * to run `plugin update` is only true once the version has moved.
 */
function manifestVersion() {
  return readJson(path.join(REPO, '.claude-plugin', 'plugin.json'), {})?.version ?? null;
}

/**
 * Is the snapshot still the code in this checkout?
 *
 * Compares the files that actually decide what the office is told, plus the two
 * manifests that decide whether a refresh is possible at all. Cheap, and it
 * catches the confusing case by far: an edited mapper that changes nothing
 * because the running plugin is a copy taken before the edit.
 */
const SNAPSHOT_FILES = [
  path.join('bin', 'aop-send.cjs'),
  // What a desk label may contain, which office a repo walks into, and the bag of
  // helpers a mapper is handed: aop-send decides none of those itself, so an edit
  // here changes what the office is told just as squarely as an edited mapper.
  path.join('bin', 'lib', 'aop-core.cjs'),
  path.join('bin', 'mappers', `${HARNESS}.cjs`),
  path.join('bin', 'mappers', 'lib', 'tool-classes.cjs'),
  path.join('bin', 'mappers', 'lib', 'event-shape.cjs'),
  path.join('bin', 'aop-plugin-hook.sh'),
  path.join('bin', 'aop-node.sh'),
  path.join('hooks', 'hooks.json'),
  path.join('.claude-plugin', 'plugin.json'),
];

function snapshotStale(state) {
  if (!state.installPath) return false;
  // A version the registry does not share is stale by definition, whatever the
  // files say — and it is the case where the fix differs, so it is asked first.
  const checkout = manifestVersion();
  if (checkout && state.version && checkout !== state.version) return true;
  return SNAPSHOT_FILES.some((rel) => {
    try {
      return fs.readFileSync(path.join(REPO, rel), 'utf8')
        !== fs.readFileSync(path.join(state.installPath, rel), 'utf8');
    } catch { return true; }
  });
}

function installPlugin({ dryRun }) {
  console.log('Route: plugin (a snapshot of this checkout, copied into ~/.claude/plugins/cache)');
  console.log(`  marketplace  add ${REPO}`);
  console.log(`  plugin       install ${PLUGIN_ID}`);
  if (dryRun) { console.log('\n(dry run: nothing written)'); return true; }

  if (!claudeCli()) {
    console.error('\nThe `claude` command is not on PATH, so the plugin route cannot run.');
    console.error('Either install Claude Code first, or use the live route instead:');
    console.error('  npm run connect:claude:settings');
    return false;
  }

  // `marketplace add` is idempotent, and `update` is what picks up a manifest
  // that changed since it was added.
  const added = claude(['plugin', 'marketplace', 'add', './']);
  if (!added.ok) { console.error(`\nmarketplace add failed:\n${added.out}`); return false; }
  console.log(`\n${added.out}`);
  const updated = claude(['plugin', 'marketplace', 'update', PLUGIN]);
  if (updated.ok) console.log(updated.out);

  const installed = claude(['plugin', 'install', PLUGIN_ID]);
  if (!installed.ok) { console.error(`\nplugin install failed:\n${installed.out}`); return false; }
  console.log(installed.out);

  // Already installed at an older version? Then the snapshot is stale and only
  // an explicit update moves it.
  if (snapshotStale(pluginState())) {
    const bumped = claude(['plugin', 'update', PLUGIN_ID]);
    if (bumped.ok) console.log(bumped.out);
  }
  return true;
}

function uninstallPlugin({ dryRun }) {
  const state = pluginState();
  if (!state.installed) return false;
  console.log(`Route: plugin — uninstalling ${PLUGIN_ID}`);
  if (dryRun) { console.log('  (dry run: nothing written)'); return true; }
  const out = claude(['plugin', 'uninstall', PLUGIN_ID]);
  console.log(`  ${out.out.split('\n').pop()}`);
  const market = claude(['plugin', 'marketplace', 'remove', PLUGIN]);
  if (market.ok) console.log(`  ${market.out.split('\n').pop()}`);
  return out.ok;
}

// --- the settings.json route ----------------------------------------------

/**
 * Quote a path for the shell Claude runs a hook command through.
 *
 * These are absolute paths on someone else's machine, and `~/Library/Application
 * Support` is proof that a space is not hypothetical.
 */
function shellQuote(value) {
  return /^[A-Za-z0-9_./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function ourCommand() {
  return `${shellQuote(LAUNCHER)} ${shellQuote(ADAPTER)} ${HARNESS}`;
}

function isOurs(entry) {
  return typeof entry?.command === 'string' && entry.command.includes(MARKER);
}

/**
 * Add, refresh or remove our hook in one event's group list.
 *
 * A "group" is Claude's `{ matcher?, hooks: [...] }`. Ours is always its own
 * group: sharing a group with someone else's hook would mean editing their
 * matcher, and this script's promise is that other hooks are left untouched.
 *
 * @returns {?string} what changed, or null for no change
 */
function applyToEvent(groups, hook, { uninstall }) {
  const wanted = ourCommand();

  for (let g = 0; g < groups.length; g++) {
    const list = Array.isArray(groups[g]?.hooks) ? groups[g].hooks : [];
    const mine = list.findIndex(isOurs);
    if (mine === -1) continue;

    if (uninstall) {
      list.splice(mine, 1);
      if (!list.length) groups.splice(g, 1);
      return 'removed';
    }
    if (list[mine].command !== wanted) {
      list[mine] = { type: 'command', command: wanted, timeout: HOOK_TIMEOUT };
      return 'updated path';
    }
    return null;
  }

  if (uninstall) return null;
  const group = { hooks: [{ type: 'command', command: wanted, timeout: HOOK_TIMEOUT }] };
  if (hook.matcher) group.matcher = hook.matcher;
  groups.push(group);
  return 'added';
}

function planSettings(settings, { uninstall }) {
  const next = JSON.parse(JSON.stringify(settings));
  const hooks = (next.hooks && typeof next.hooks === 'object') ? next.hooks : {};
  const actions = [];

  for (const hook of HOOKS) {
    const groups = Array.isArray(hooks[hook.name]) ? hooks[hook.name] : [];
    const action = applyToEvent(groups, hook, { uninstall });
    if (action) actions.push({ hook: hook.name, action });
    if (groups.length) hooks[hook.name] = groups;
    else delete hooks[hook.name];
  }

  // Leave no empty shells behind: an uninstall should return the file to
  // something indistinguishable from never having run this script.
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;

  return { next, actions };
}

/** Which of our hooks are in a settings file, and what else lives there. */
function settingsState(file) {
  const loaded = loadSettings(file);
  if (!loaded.ok) return { ok: false, error: loaded.error, ours: [], others: [] };
  const hooks = loaded.value.hooks ?? {};
  const ours = [];
  const others = [];
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const entry of group?.hooks ?? []) {
        (isOurs(entry) ? ours : others).push({ event, command: entry.command });
      }
    }
  }
  return { ok: true, existed: loaded.existed, ours, others };
}

function writeSettings(file, value) {
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const backup = `${file}.bak.roving-office-${stamp}`;
    fs.copyFileSync(file, backup);
    console.log(`Backed up to ${backup}`);
  }

  // An uninstall that empties a file we created should take the file with it —
  // a stray `{}` in `.claude/` is litter that outlives its reason.
  if (!Object.keys(value).length) {
    try { fs.unlinkSync(file); console.log(`Removed ${file} (nothing left in it)`); return; } catch { /* fall through */ }
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Wrote ${file}`);
}

// --- status ----------------------------------------------------------------

// What launchd hands a GUI application, and therefore what a Cowork session's
// hooks get. Reproduced here so `--status` can answer the question that took a
// bug report to ask: will this install work outside a terminal?
const GUI_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * The Node a hook would find if it were started from the GUI, or null.
 *
 * Runs the real launcher rather than reimplementing its search, so this can
 * never claim an install is healthy on rules the launcher does not follow.
 */
function guiNode() {
  try {
    const found = execFileSync(LAUNCHER, ['-p', 'process.execPath'], {
      env: { PATH: GUI_PATH, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return found || null;
  } catch {
    return null;
  }
}

function reportStatus(settingsPath) {
  const plugin = pluginState();
  const settings = settingsState(settingsPath);

  console.log('Route: plugin');
  if (!plugin.installed) {
    console.log('  not installed');
  } else {
    console.log(`  ${PLUGIN_ID} v${plugin.version}  ${plugin.enabled ? 'enabled' : 'DISABLED'}`);
    console.log(`  snapshot   ${plugin.installPath}`);
    console.log(`  source     ${plugin.marketplacePath ?? '(unknown)'}`);
    if (snapshotStale(plugin)) {
      const checkout = manifestVersion();
      console.log('  ⚠ the snapshot differs from this checkout');
      if (checkout && checkout !== plugin.version) {
        console.log(`      this checkout is v${checkout} — refresh it with:`);
        console.log(`      claude plugin marketplace update ${PLUGIN} && claude plugin update ${PLUGIN_ID}`);
      } else {
        console.log(`      and both call themselves v${plugin.version}, so \`plugin update\` will find`);
        console.log('      the version it already has and do nothing. Bump the version in');
        console.log('      .claude-plugin/plugin.json, or force a fresh copy of the same one:');
        console.log(`      claude plugin uninstall ${PLUGIN_ID} && claude plugin install ${PLUGIN_ID}`);
      }
    }
  }

  // The plugin is a snapshot of the whole checkout, so a version of the plugin
  // that is not a version of the repo would be two answers to one question.
  const manifest = manifestVersion();
  const pkg = readJson(path.join(REPO, 'package.json'), {})?.version ?? null;
  if (manifest && pkg && manifest !== pkg) {
    console.log(`  ⚠ .claude-plugin/plugin.json says v${manifest}, package.json says v${pkg}`);
  }

  console.log(`\nRoute: settings (${settingsPath})`);
  if (!settings.ok) {
    console.log(`  cannot read: ${settings.error}`);
  } else if (!settings.ours.length) {
    console.log('  no office hooks');
  } else {
    for (const h of settings.ours) console.log(`  ${h.event.padEnd(19)} ${h.command}`);
  }
  if (settings.others?.length) {
    console.log('  other hooks in this file, left untouched:');
    for (const h of settings.others) console.log(`    ${h.event.padEnd(19)} ${h.command}`);
  }

  if (plugin.enabled && settings.ours?.length) {
    console.log('\n⚠ BOTH routes are active. Claude runs every matching hook, so every');
    console.log('  event is being sent twice. Remove one:');
    console.log(`      claude plugin uninstall ${PLUGIN_ID}`);
    console.log('  or  node bin/aop-claude-install.cjs --uninstall --settings');
  }

  console.log('');
  for (const line of statusLines(ADAPTER)) console.log(line);

  // Terminal sessions almost always work, so a status that only proves the
  // terminal case proves the easy half. This is the half that broke.
  const node = guiNode();
  console.log('\nGUI sessions (Claude Desktop / Cowork)');
  if (node) {
    console.log(`  node ${node}`);
  } else {
    console.log('  ⚠ no node is reachable from launchd\'s PATH, so Cowork sessions will');
    console.log('    send nothing while terminal ones work. Point AOP_NODE at a node, or');
    console.log(`    symlink one onto ${GUI_PATH.split(':')[0]}.`);
  }

  console.log('\nClaude Code reads hooks at session start — restart a session after changes.');
}

// --- cli -------------------------------------------------------------------

function main() {
  const { flag, value, help } = flags(process.argv.slice(2));

  if (help) {
    console.log('usage: aop-claude-install.cjs [--settings] [--dry-run|--uninstall|--status]');
    console.log('                              [--config <path>] [--project] [--adapter <path>]');
    console.log('');
    console.log('  (default)     install as a Claude Code plugin — a snapshot, one command');
    console.log('  --settings    install as hooks in settings.json — live, edits apply at once');
    console.log('  --project     with --settings, write ./.claude/settings.local.json instead of ~');
    console.log('  --force       allow both routes at once (they double every event)');
    return;
  }

  const uninstall = flag('--uninstall');
  const dryRun = flag('--dry-run');
  const useSettings = flag('--settings') || flag('--project');
  if (value('--adapter')) {
    ADAPTER = path.resolve(value('--adapter'));
    // The launcher travels with the adapter: both are shipped side by side, and
    // a hook that found one but not the other would be worse than neither.
    LAUNCHER = path.join(path.dirname(ADAPTER), LAUNCHER_NAME);
  }

  // Project scope writes `settings.local.json`, not `settings.json`: the command
  // contains an absolute path to *this* machine's checkout, which is precisely
  // the thing that must not be committed and handed to a teammate. Claude reads
  // the local file for exactly this purpose, and git ignores it by convention.
  const settingsPath = value('--config')
    ? path.resolve(value('--config'))
    : (flag('--project') ? path.join(process.cwd(), '.claude', 'settings.local.json') : USER_SETTINGS);

  if (flag('--status')) { reportStatus(settingsPath); return; }

  // Uninstall clears whatever is actually there, not whatever was asked for:
  // someone who installed as a plugin and then typed `--uninstall --settings`
  // should still end up clean.
  if (uninstall) {
    let did = false;
    if (!flag('--settings') && !flag('--project')) did = uninstallPlugin({ dryRun }) || did;
    const state = settingsState(settingsPath);
    if (state.ok && state.ours.length) {
      const loaded = loadSettings(settingsPath);
      const { next, actions } = planSettings(loaded.value, { uninstall: true });
      console.log(`Route: settings — ${settingsPath}`);
      for (const a of actions) console.log(`  ${a.hook.padEnd(19)} ${a.action}`);
      if (!dryRun) writeSettings(settingsPath, next);
      else console.log('  (dry run: nothing written)');
      did = true;
    }
    if (!did) console.log('Nothing to do: the office is not wired into Claude Code.');
    return;
  }

  const { ok, notes } = checkAdapter(ADAPTER);
  for (const note of notes) console.log(note);
  if (!ok) { process.exitCode = 1; return; }

  const plugin = pluginState();
  const existing = settingsState(settingsPath);

  if (!useSettings) {
    if (existing.ok && existing.ours.length && !flag('--force')) {
      console.error('Refusing to install: office hooks are already in');
      console.error(`  ${settingsPath}`);
      console.error('Claude runs every matching hook, so adding the plugin as well would');
      console.error('send every event twice. Remove the settings hooks first:');
      console.error('  node bin/aop-claude-install.cjs --uninstall --settings');
      process.exitCode = 1;
      return;
    }
    if (!installPlugin({ dryRun })) { process.exitCode = 1; return; }
    if (!dryRun) {
      console.log('');
      for (const line of scaffoldAll(ADAPTER).lines) console.log(line);
      console.log('\nThe plugin is a snapshot: after editing a mapper, refresh it with');
      console.log(`  claude plugin marketplace update ${PLUGIN} && claude plugin update ${PLUGIN_ID}`);
      console.log('or use the live route instead:  npm run connect:claude:settings');
      console.log('\nClaude Code reads hooks at session start — start a NEW session for the');
      console.log('office to see it. Then run the office:  npm start');
    }
    return;
  }

  if (plugin.enabled && !flag('--force')) {
    console.error(`Refusing to install: the ${PLUGIN_ID} plugin is already active.`);
    console.error('Claude runs every matching hook, so settings hooks as well would send');
    console.error('every event twice. Remove the plugin first:');
    console.error(`  claude plugin uninstall ${PLUGIN_ID}`);
    process.exitCode = 1;
    return;
  }

  if (!existing.ok) {
    console.error(`Cannot parse ${settingsPath}: ${existing.error}`);
    console.error('Fix the JSON (or move the file aside) and re-run.');
    process.exitCode = 1;
    return;
  }

  const loaded = loadSettings(settingsPath);
  const { next, actions } = planSettings(loaded.value, { uninstall: false });

  console.log(`Route: settings — ${settingsPath}`);
  console.log(`  command: ${ourCommand()}`);
  if (!actions.length) console.log('  nothing to do');
  for (const a of actions) console.log(`  ${a.hook.padEnd(19)} ${a.action}`);
  if (existing.others.length) {
    console.log(`  ${existing.others.length} existing hook(s) left untouched — Claude runs them all`);
  }

  if (dryRun) {
    console.log('\n--- resulting "hooks" block ---');
    console.log(JSON.stringify({ hooks: next.hooks }, null, 2));
    console.log('\n(dry run: nothing written)');
    return;
  }

  if (JSON.stringify(next) === JSON.stringify(loaded.value)) {
    console.log('\nSettings already correct; not rewriting.');
    return;
  }

  console.log('');
  writeSettings(settingsPath, next);
  console.log('');
  for (const line of scaffoldAll(ADAPTER).lines) console.log(line);
  console.log('\nClaude Code reads hooks at session start — start a NEW session for the');
  console.log('office to see it. Then run the office:  npm start');
}

main();
