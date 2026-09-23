#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scaffoldAll, statusLines, checkAdapter } = require('./lib/local-config.cjs');
const { readJson } = require('./lib/aop-core.cjs');
const { flags } = require('./lib/cli-flags.cjs');

const HARNESS = 'cursor';
const CONFIG = path.join(os.homedir(), '.cursor', 'hooks.json');
const HOOKS = [
  'sessionStart', 'sessionEnd', 'beforeSubmitPrompt', 'preToolUse', 'postToolUse',
  'postToolUseFailure', 'beforeShellExecution', 'afterShellExecution', 'afterFileEdit',
  'subagentStart', 'subagentStop', 'preCompact', 'stop',
];
let ADAPTER = path.join(__dirname, 'aop-send.cjs');

function command(hook) { return `${JSON.stringify(ADAPTER)} ${HARNESS} ${hook}`; }
function ours(entry) { return typeof entry?.command === 'string' && entry.command.includes('aop-send.cjs') && entry.command.includes(` ${HARNESS} `); }

function plan(doc, uninstall = false) {
  const next = structuredClone(doc ?? {});
  next.version ??= 1;
  next.hooks = next.hooks && typeof next.hooks === 'object' ? next.hooks : {};
  const actions = [];
  for (const hook of HOOKS) {
    const entries = Array.isArray(next.hooks[hook]) ? next.hooks[hook] : [];
    const index = entries.findIndex(ours);
    if (uninstall) {
      if (index >= 0) { entries.splice(index, 1); actions.push(`${hook}: removed`); }
    } else if (index < 0) { entries.push({ command: command(hook), timeout: 5 }); actions.push(`${hook}: added`); }
    else if (entries[index].command !== command(hook) || entries[index].timeout !== 5) {
      entries[index] = { command: command(hook), timeout: 5 }; actions.push(`${hook}: updated`);
    }
    if (entries.length) next.hooks[hook] = entries; else delete next.hooks[hook];
  }
  if (!Object.keys(next.hooks).length) delete next.hooks;
  return { next, actions };
}

function main() {
  const { flag, value, help } = flags(process.argv.slice(2));
  if (help) {
    console.log('usage: aop-cursor-install.cjs [--dry-run|--status|--uninstall] [--config <path>] [--adapter <path>]'); return;
  }
  const uninstall = flag('--uninstall');
  if (value('--adapter')) ADAPTER = path.resolve(value('--adapter'));
  const file = value('--config') ? path.resolve(value('--config')) : CONFIG;
  if (flag('--status')) {
    const doc = readJson(file, {}); console.log(`Hooks file: ${file}`);
    for (const hook of HOOKS) console.log(`  ${hook.padEnd(22)} ${Array.isArray(doc.hooks?.[hook]) && doc.hooks[hook].some(ours) ? 'office hook installed' : 'not installed'}`);
    for (const line of statusLines(ADAPTER)) console.log(line); return;
  }
  const checked = checkAdapter(ADAPTER);
  if (!checked.ok) { checked.notes.forEach((note) => console.error(note)); return 1; }
  const current = readJson(file, {}); const { next, actions } = plan(current, uninstall);
  console.log(`${uninstall ? 'Uninstall' : 'Install'} plan for ${file}`);
  console.log(actions.length ? actions.map((action) => `  ${action}`).join('\n') : '  nothing to do');
  if (flag('--dry-run')) { console.log(JSON.stringify(next, null, 2)); return; }
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak.roving-office`);
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  }
  if (!uninstall) {
    scaffoldAll(ADAPTER).lines.forEach((line) => console.log(line));
    console.log('Cursor reloads hooks automatically.');
  }
}
if (require.main === module) process.exitCode = main() ?? 0;
module.exports = { plan, main };
