'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const {
  installCommands, preserveRunningCache, stagedMarketplace,
} = require('../bin/aop-codex-install.cjs');

test('the package and both copied plugins share one version', () => {
  const versions = [
    readJson('package.json').version,
    readJson('.claude-plugin/plugin.json').version,
    readJson('.codex-plugin/plugin.json').version,
  ];
  assert.equal(new Set(versions).size, 1);
});

test('every bundled hook delegates through the host selector, named interpreter and all', () => {
  const groups = Object.values(readJson('hooks/hooks.json').hooks).flat();
  const handlers = groups.flatMap((group) => group.hooks);
  assert.equal(handlers.length, 15);
  // `sh` in front, because the published Claude plugin arrives as a zip the host
  // unpacks and a stored unix mode may or may not reach disk — see
  // test/plugin-dist.test.cjs. Codex's own copier does preserve it, so the exec bit
  // is still asserted: this is belt and braces, not a replacement.
  assert.deepEqual(new Set(handlers.map((handler) => handler.command)),
    new Set(['sh "${CLAUDE_PLUGIN_ROOT}/bin/aop-plugin-hook.sh"']));

  const mode = fs.statSync(path.join(ROOT, 'bin', 'aop-plugin-hook.sh')).mode;
  assert.ok(mode & 0o111, 'the plugin cache must preserve a runnable wrapper');
});

test('the shared manifest contains all ten Codex hooks without dropping Claude-only hooks', () => {
  const configured = new Set(Object.keys(readJson('hooks/hooks.json').hooks));
  const codex = new Set([
    'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact',
    'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop', 'Stop',
  ]);
  const installedForCodex = [...configured].filter((name) => codex.has(name));
  assert.equal(installedForCodex.length, 10);
  assert.ok(configured.has('PostToolUseFailure'), 'Claude keeps its richer failure hook');
});

test('updating an installed Codex plugin replaces its immutable cache snapshot', () => {
  const source = '/tmp/roving-office-codex-marketplace';
  const commands = installCommands({ installed: true, marketplace: true, source });
  assert.deepEqual(commands.map((args) => args.slice(0, 3)), [
    ['plugin', 'remove', 'roving-office@roving-office'],
    ['plugin', 'marketplace', 'remove'],
    ['plugin', 'marketplace', 'add'],
    ['plugin', 'add', 'roving-office@roving-office'],
  ]);
  assert.equal(commands[2][3], source);
});

test('worktree installs stage a versioned non-Git marketplace', () => {
  const staged = stagedMarketplace('0.11.0+codex.local-test');
  assert.match(staged, /codex-marketplaces\/roving-office-0\.11\.0\+codex\.local-test$/);
  assert.notEqual(staged, ROOT);
});

test('refreshing keeps the old cache root alive for already-running threads', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cache-test-'));
  const cache = path.join(temp, 'cache');
  const oldRoot = path.join(cache, '0.12.2');
  fs.mkdirSync(path.join(oldRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(oldRoot, 'bin', 'hook.sh'), 'old snapshot');

  const preserved = preserveRunningCache('0.12.2', cache, temp);
  try {
    fs.rmSync(oldRoot, { recursive: true, force: true });
    preserved.restore();
    assert.equal(fs.readFileSync(path.join(oldRoot, 'bin', 'hook.sh'), 'utf8'), 'old snapshot');
  } finally {
    preserved.cleanup();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
