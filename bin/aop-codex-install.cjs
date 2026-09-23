#!/usr/bin/env node
// Install The Roving Office as a local Codex plugin.
//
//   node bin/aop-codex-install.cjs               install/update
//   node bin/aop-codex-install.cjs --dry-run     print the commands only
//   node bin/aop-codex-install.cjs --status      inspect plugin and hook readiness
//   node bin/aop-codex-install.cjs --uninstall   remove the plugin

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { scaffoldAll, statusLines } = require('./lib/local-config.cjs');
const { readJson } = require('./lib/aop-core.cjs');
const { flags } = require('./lib/cli-flags.cjs');

const REPO = path.resolve(__dirname, '..');
const ADAPTER = path.join(__dirname, 'aop-send.cjs');
const MANIFEST = path.join(REPO, '.codex-plugin', 'plugin.json');
const MARKETPLACE = 'roving-office';
const PLUGIN_ID = `roving-office@${MARKETPLACE}`;
const STAGE_DIR = path.join(os.homedir(), '.roving-office', 'codex-marketplaces');
const CACHE_DIR = path.join(os.homedir(), '.codex', 'plugins', 'cache', MARKETPLACE, 'roving-office');

function run(args) {
  const result = spawnSync('codex', args, {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    out: String(result.stdout ?? '').trim(),
    error: String(result.stderr ?? '').trim(),
  };
}

function codexAvailable() {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 });
  return result.status === 0;
}

function jsonCommand(args) {
  const result = run([...args, '--json']);
  if (!result.ok) return { ...result, value: null };
  try { return { ...result, value: JSON.parse(result.out) }; }
  catch { return { ...result, ok: false, value: null, error: 'Codex returned invalid JSON.' }; }
}

function installedPlugin() {
  const plugins = jsonCommand(['plugin', 'list']);
  if (!plugins.ok) return null;
  return plugins.value?.installed?.find((entry) => entry.pluginId === PLUGIN_ID) ?? null;
}

function configuredMarketplace() {
  const markets = jsonCommand(['plugin', 'marketplace', 'list']);
  if (!markets.ok) return null;
  return markets.value?.marketplaces?.find((entry) => entry.name === MARKETPLACE) ?? null;
}

function stagedMarketplace(version = readJson(MANIFEST, {})?.version) {
  const suffix = String(version ?? 'unknown').replace(/[^A-Za-z0-9._+-]/g, '-');
  return path.join(STAGE_DIR, `roving-office-${suffix}`);
}

function cachedPlugin(version, cacheDir = CACHE_DIR) {
  if (typeof version !== 'string' || !/^[A-Za-z0-9._+-]+$/.test(version)) return null;
  return path.join(cacheDir, version);
}

/**
 * Codex threads load their hook command once, with an immutable versioned
 * `PLUGIN_ROOT`. Removing a plugin normally deletes that directory immediately,
 * breaking every thread that was already open even though the installer quite
 * correctly tells the user that the new snapshot needs a new thread.
 *
 * Keep the previous cache alive during and after the refresh. It is no longer a
 * registered plugin and new threads cannot select it; it exists only so commands
 * already loaded by running threads do not become dangling paths.
 */
function preserveRunningCache(version, cacheDir = CACHE_DIR, tempRoot = os.tmpdir()) {
  const target = cachedPlugin(version, cacheDir);
  if (!target || !fs.existsSync(target)) return null;
  const temp = fs.mkdtempSync(path.join(tempRoot, 'roving-office-codex-cache-'));
  const snapshot = path.join(temp, version);
  fs.cpSync(target, snapshot, { recursive: true });
  return {
    restore() {
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.cpSync(snapshot, target, { recursive: true });
      }
    },
    cleanup() { fs.rmSync(temp, { recursive: true, force: true }); },
  };
}

/**
 * A local marketplace rooted at a Git worktree is unsafe for development installs:
 * Codex clones the repository and checks out its default branch, not the worktree's
 * branch. Materialise the hook plugin without Git metadata so the cache is copied from
 * the exact checkout the installer is running in.
 */
function stageMarketplace(target = stagedMarketplace()) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const entry of ['.codex-plugin', '.claude-plugin', 'hooks', 'bin']) {
    fs.cpSync(path.join(REPO, entry), path.join(target, entry), { recursive: true });
  }
  for (const entry of ['package.json', 'README.md', 'LICENSE']) {
    const source = path.join(REPO, entry);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, entry));
  }
  return target;
}

/**
 * Codex's `plugin add` is intentionally idempotent: an already-installed plugin is
 * left on its existing cache snapshot. That is the wrong update semantic for this
 * installer, because the hook commands then come from the new marketplace checkout
 * while PLUGIN_ROOT can still name an older cache missing the files they invoke.
 * Remove first when present so `add` has to materialise the current version.
 */
function installCommands({ installed = false, marketplace = false, source = stagedMarketplace() } = {}) {
  return [
    ...(installed ? [['plugin', 'remove', PLUGIN_ID, '--json']] : []),
    ...(marketplace ? [['plugin', 'marketplace', 'remove', MARKETPLACE, '--json']] : []),
    ['plugin', 'marketplace', 'add', source, '--json'],
    ['plugin', 'add', PLUGIN_ID, '--json'],
  ];
}

function hooksFeature() {
  const result = run(['features', 'list']);
  if (!result.ok) return null;
  const line = result.out.split('\n').find((entry) => /^hooks\s/.test(entry));
  const match = line && /\s(true|false)\s*$/.exec(line);
  return match ? match[1] === 'true' : null;
}

function managedOnlyPolicy() {
  const candidates = [
    '/etc/codex/requirements.toml',
    '/Library/Application Support/OpenAI/Codex/requirements.toml',
    path.join(os.homedir(), '.codex', 'requirements.toml'),
  ];
  for (const file of candidates) {
    try {
      if (/^\s*allow_managed_hooks_only\s*=\s*true\s*(?:#.*)?$/m.test(fs.readFileSync(file, 'utf8'))) {
        return file;
      }
    } catch { /* absent or unreadable */ }
  }
  return null;
}

function printCommand(args) {
  const quote = (value) => (/^[A-Za-z0-9_./:@-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`);
  console.log(['codex', ...args].map(quote).join(' '));
}

function printPolicyWarnings() {
  const feature = hooksFeature();
  if (feature === false) {
    console.log('\nWARNING: Codex hooks are disabled. The plugin can be installed, but it cannot emit events.');
  } else if (feature === null) {
    console.log('\nWARNING: Could not confirm that the Codex hooks feature is enabled.');
  }
  const policy = managedOnlyPolicy();
  if (policy) {
    console.log(`\nWARNING: ${policy} sets allow_managed_hooks_only = true.`);
    console.log('This local plugin is not managed, so its hooks will not run. Ask your administrator to deploy it as a managed hook.');
  }
}

function status() {
  console.log('Codex plugin');
  if (!codexAvailable()) {
    console.log('  Codex CLI not found on PATH');
    return 1;
  }

  const manifest = readJson(MANIFEST, {});
  const plugins = jsonCommand(['plugin', 'list']);
  const markets = jsonCommand(['plugin', 'marketplace', 'list']);
  const installed = plugins.value?.installed?.find((entry) => entry.pluginId === PLUGIN_ID);
  const marketplace = markets.value?.marketplaces?.find((entry) => entry.name === MARKETPLACE);

  if (!marketplace) console.log(`  marketplace ${MARKETPLACE}: not configured`);
  else {
    console.log(`  marketplace ${MARKETPLACE}: ${marketplace.root ?? marketplace.marketplaceSource?.source ?? 'configured'}`);
  }

  if (!installed) console.log(`  ${PLUGIN_ID}: not installed`);
  else {
    console.log(`  ${PLUGIN_ID}: ${installed.enabled === false ? 'disabled' : 'enabled'}, version ${installed.version ?? 'unknown'}`);
    if (installed.version !== manifest.version) {
      console.log(`      stale — checkout is version ${manifest.version}; run npm run connect:codex`);
    } else {
      console.log('      version matches this checkout');
    }
  }

  printPolicyWarnings();
  console.log('');
  console.log(statusLines(ADAPTER).join('\n'));
  return 0;
}

function install({ dryRun = false } = {}) {
  if (!codexAvailable()) {
    console.error('Codex CLI not found on PATH. Install Codex, then run this command again.');
    return 1;
  }

  const existing = installedPlugin();
  const marketplace = configuredMarketplace();
  const source = stagedMarketplace();
  const expected = readJson(MANIFEST, {})?.version;
  const commands = installCommands({
    installed: Boolean(existing),
    marketplace: Boolean(marketplace),
    source,
  });

  if (dryRun) {
    console.log(`Would stage the current checkout at ${source}`);
    console.log('Would install the staged Codex plugin:');
    for (const args of commands) printCommand(args);
    console.log('\nNo files or Codex settings were changed.');
    return 0;
  }

  const previous = existing?.version !== expected
    ? preserveRunningCache(existing?.version)
    : null;
  try {
    stageMarketplace(source);

    for (const args of commands) {
      const result = run(args);
      // Both plugin and marketplace removal may prune the old cache. Restore it
      // between commands as well as at the end to minimise the failure window for
      // an active thread that happens to fire a hook during this refresh.
      previous?.restore();
      if (!result.ok) {
        console.error(result.error || result.out || `codex ${args.join(' ')} failed`);
        return 1;
      }
    }
  } finally {
    previous?.restore();
    previous?.cleanup();
  }

  const refreshed = installedPlugin();
  if (!refreshed || refreshed.version !== expected) {
    console.error(
      `Codex cached ${refreshed?.version ?? 'no plugin'} after installation; expected ${expected}.`,
    );
    return 1;
  }

  const cachedWrapper = path.join(
    os.homedir(), '.codex', 'plugins', 'cache', MARKETPLACE, 'roving-office',
    expected, 'bin', 'aop-plugin-hook.sh',
  );
  try {
    fs.accessSync(cachedWrapper, fs.constants.X_OK);
  } catch {
    console.error(`Codex installed ${expected}, but its hook wrapper is missing: ${cachedWrapper}`);
    return 1;
  }

  console.log(`${existing ? 'Refreshed' : 'Installed'} ${PLUGIN_ID} from ${REPO}`);
  console.log(`Staged branch snapshot at ${source}`);
  console.log(scaffoldAll(ADAPTER).lines.join('\n'));
  printPolicyWarnings();
  console.log('\nStart a new Codex thread, open /hooks, and review/trust the plugin hooks.');
  return 0;
}

function uninstall() {
  if (!codexAvailable()) {
    console.error('Codex CLI not found on PATH.');
    return 1;
  }
  const result = run(['plugin', 'remove', PLUGIN_ID, '--json']);
  if (!result.ok) {
    console.error(result.error || result.out || `Could not remove ${PLUGIN_ID}`);
    return 1;
  }
  console.log(`Removed ${PLUGIN_ID}. The ${MARKETPLACE} marketplace remains configured.`);
  console.log('Start a new Codex thread for the change to take effect.');
  return 0;
}

function main(argv) {
  const { flag, help } = flags(argv);
  // This installer takes no valued flags, and it is the only one that rejects an
  // argument it does not know: everything it does is a mode, so a misspelling is
  // never a harmless extra — it silently selects the default, which installs.
  const known = new Set(['--dry-run', '--status', '--uninstall', '--help', '-h']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length) {
    console.error(`Unknown option: ${unknown[0]}`);
    return 1;
  }
  if (help) {
    console.log('Usage: node bin/aop-codex-install.cjs [--dry-run | --status | --uninstall]');
    return 0;
  }
  const modes = ['--dry-run', '--status', '--uninstall'].filter((mode) => flag(mode));
  if (modes.length > 1) {
    console.error('Choose only one of --dry-run, --status, or --uninstall.');
    return 1;
  }
  if (flag('--status')) return status();
  if (flag('--uninstall')) return uninstall();
  return install({ dryRun: flag('--dry-run') });
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  hooksFeature,
  installCommands,
  managedOnlyPolicy,
  main,
  preserveRunningCache,
  stagedMarketplace,
};
