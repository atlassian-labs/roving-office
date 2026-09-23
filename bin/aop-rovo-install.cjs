#!/usr/bin/env node
// aop-rovo-install — register The Roving Office adapter as Rovo CLI event hooks.
//
//   node bin/aop-rovo-install.cjs --dry-run     show the diff, change nothing
//   node bin/aop-rovo-install.cjs               install (backs up first)
//   node bin/aop-rovo-install.cjs --uninstall   remove, restoring displaced hooks
//   node bin/aop-rovo-install.cjs --status      report what is currently wired up
//
// Two Rovo behaviours shape this whole script, both verified on 202608.25.1:
//
//   1. **Only the first `command` of an event runs.** The `/hooks` help implies
//      several commands per event run in parallel; they do not. An installer that
//      politely appends itself after an existing hook is silently never called.
//      So we take the first slot and re-run whatever we displaced via
//      `aop-send --chain`, which keeps the user's telemetry or notifications alive.
//   2. **`eventHooks` is read once, at session start.** Editing the config does
//      nothing for sessions already running, so we say so at the end rather than
//      letting someone conclude the office is broken.
//
// The config is edited as text, not through a YAML library: it is a hand-editable
// file full of the user's comments, and this way everything outside the
// `eventHooks` block is preserved byte for byte.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scaffoldAll, statusLines, checkAdapter } = require('./lib/local-config.cjs');
const { flags } = require('./lib/cli-flags.cjs');

const HARNESS = 'rovo-cli';
const MARKER = 'aop-send.cjs';

// Where the installed hooks will point. Overridable with --adapter, because the
// path is baked into the user's config: installing from a git worktree or a temp
// checkout writes hooks that break the day that directory goes away.
let ADAPTER = path.join(__dirname, 'aop-send.cjs');

/** Every hook we know Rovo can fire, in the order the office cares about. */
const HOOKS = [
  'on_session_start',
  'on_user_prompt',
  'on_tool_start',
  'on_tool_end',
  'on_tool_permission',
  'on_complete',
  'on_error',
  'on_session_end',
];

const DEFAULT_CONFIG = path.join(os.homedir(), '.rovo', 'config.yml');
const DEFAULT_LOG = path.join(os.homedir(), '.rovo', 'event_hooks.log');

/**
 * What the office loses when a hook is not ours, one line each.
 *
 * `--status` could always *say* which hooks were somebody else's; what it could not say
 * was that this matters. Found the hard way: another tool's installer had taken the
 * `on_tool_start` and `on_tool_end` slots on this machine — because taking the first slot
 * is the only way to be called, so every well-behaved installer does it — and the office
 * had been showing sessions that arrive, sit, and deliver, without a single tool call or
 * checklist between. Everything looked installed. `office` on six rows out of eight reads
 * like success, and the two that mattered most were the two that were gone.
 *
 * So the report names the consequence rather than the configuration. A hook is not a
 * feature anybody wants; it is the reason a character does something you can watch.
 */
const COST = {
  on_session_start: 'characters arrive late, at their first prompt rather than at launch',
  on_user_prompt: 'nothing says what the work is: no desk label, and no mail arriving',
  on_tool_start: 'no tool work at all, and no checklists — a turn\'s parts are update_todo\'s arguments',
  on_tool_end: 'tools never finish, so a character keeps doing the last thing it started',
  on_tool_permission: 'a permission prompt never raises a hand',
  on_complete: 'work is never handed in, so nothing is ever delivered',
  on_error: 'a failed turn looks exactly like a finished one',
  on_session_end: 'no goodbye: the character is reaped on a timer instead of leaving',
};

// --- YAML, only as far as we need it ---------------------------------------

/** Strip a YAML scalar's quoting, so a chained command round-trips intact. */
function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    const inner = v.slice(1, -1);
    return v[0] === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner.replace(/''/g, "'");
  }
  return v;
}

/** Quote only when a plain scalar would be ambiguous or invalid. */
function quote(value) {
  if (/^[/~A-Za-z0-9._-]/.test(value) && !/:\s|\s#|["']/.test(value)) return value;
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

/**
 * Read the `eventHooks` block into `{ before, logFile, events, after }`.
 *
 * Events are `{ name, commands: string[] }` in file order. Anything we cannot
 * make sense of is left in `after`, so a hand-rolled config is never mangled.
 */
function parseConfig(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^eventHooks:\s*$/.test(l));
  if (start === -1) return { before: text.replace(/\s*$/, ''), heading: [], logFile: null, events: [], after: '' };

  // The block ends at the next top-level key (column 0, not a comment).
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[^\s#-]/.test(lines[i])) { end = i; break; }
  }

  // Comment lines immediately above the key belong to the block, not to what came
  // before it. Without this, every re-install re-emits the heading and the file
  // slowly fills up with copies of the same comment.
  let head = start;
  while (head > 0 && /^#/.test(lines[head - 1])) head--;
  const heading = lines.slice(head, start);

  const block = lines.slice(start + 1, end);
  const events = [];
  let logFile = null;
  let current = null;
  for (let i = 0; i < block.length; i++) {
    const line = block[i];
    const log = line.match(/^\s*logFile:\s*(.+)$/);
    if (log) { logFile = unquote(log[1]); continue; }
    const name = line.match(/^\s*-\s*name:\s*(.+)$/);
    if (name) { current = { name: unquote(name[1]), commands: [] }; events.push(current); continue; }
    const cmd = line.match(/^(\s*)-\s*command:\s*(.+)$/);
    if (!cmd || !current) continue;

    // A command can arrive folded across several lines. We never write it that
    // way — Rovo does, because it rewrites this file with a YAML dumper that
    // wraps long scalars at about 80 columns. Reading only the first line loses
    // everything after it, which quietly discarded the `--chain '...'` that keeps
    // someone else's hook alive. Folded plain scalars join with a single space.
    const indent = cmd[1].length;
    let text = cmd[2];
    while (i + 1 < block.length) {
      const next = block[i + 1];
      const deeper = next.match(/^(\s+)(\S.*)$/);
      if (!deeper || deeper[1].length <= indent) break;
      if (/^-\s/.test(deeper[2]) || /^(name|command|logFile):/.test(deeper[2])) break;
      text += ` ${deeper[2]}`;
      i++;
    }
    current.commands.push(unquote(text));
  }

  return {
    before: lines.slice(0, head).join('\n').replace(/\s*$/, ''),
    heading,
    logFile,
    events,
    after: lines.slice(end).join('\n').replace(/^\s*\n/, ''),
  };
}

function renderConfig({ before, heading, logFile, events, after }) {
  const head = heading?.length
    ? heading
    : ['# Event Hooks configuration. See /hooks command to list available events.'];
  const out = [before, '', ...head, 'eventHooks:'];
  out.push(`  logFile: ${quote(logFile ?? DEFAULT_LOG)}`);
  out.push('  events:');
  for (const ev of events) {
    out.push(`  - name: ${ev.name}`);
    out.push('    commands:');
    for (const c of ev.commands) out.push(`    - command: ${quote(c)}`);
  }
  const tail = after.trim();
  return `${out.join('\n')}\n${tail ? `\n${tail}\n` : ''}`;
}

// --- the command we install ------------------------------------------------

function ourCommand(hook, displaced) {
  const base = `${ADAPTER} ${HARNESS} ${hook}`;
  return displaced ? `${base} --chain '${displaced.replace(/'/g, "'\\''")}'` : base;
}

function isOurs(command) { return command.includes(MARKER); }

/** Recover the command we displaced, so --uninstall really does restore it. */
function chainedFrom(command) {
  const m = command.match(/--chain[= ]'((?:[^']|'\\'')*)'/) ?? command.match(/--chain[= ]"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  return m[1].replace(/'\\''/g, "'").replace(/\\(["\\])/g, '$1');
}

function plan(config, { uninstall }) {
  const events = config.events.map((e) => ({ name: e.name, commands: [...e.commands] }));
  const actions = [];

  for (const hook of HOOKS) {
    let entry = events.find((e) => e.name === hook);

    if (uninstall) {
      if (!entry) continue;
      const mine = entry.commands.findIndex(isOurs);
      if (mine === -1) continue;
      const displaced = chainedFrom(entry.commands[mine]);
      if (displaced) {
        entry.commands[mine] = displaced;
        actions.push({ hook, action: 'restored', detail: displaced });
      } else {
        entry.commands.splice(mine, 1);
        actions.push({ hook, action: 'removed' });
      }
      if (!entry.commands.length) {
        events.splice(events.indexOf(entry), 1);
        actions.push({ hook, action: 'dropped empty entry' });
      }
      continue;
    }

    if (!entry) {
      entry = { name: hook, commands: [ourCommand(hook, null)] };
      events.push(entry);
      actions.push({ hook, action: 'added' });
      continue;
    }

    const mine = entry.commands.findIndex(isOurs);
    if (mine === 0) {
      // Already first. Refresh in place so a moved checkout still works.
      const wanted = ourCommand(hook, chainedFrom(entry.commands[0]));
      if (entry.commands[0] !== wanted) {
        entry.commands[0] = wanted;
        actions.push({ hook, action: 'updated path' });
      } else {
        actions.push({ hook, action: 'unchanged' });
      }
      continue;
    }

    if (mine > 0) {
      // We were appended behind someone — the slot that never runs.
      const existing = entry.commands[0];
      entry.commands.splice(mine, 1);
      entry.commands[0] = ourCommand(hook, existing);
      actions.push({ hook, action: 'promoted to first slot', detail: `chains ${existing}` });
      continue;
    }

    const existing = entry.commands[0];
    entry.commands[0] = ourCommand(hook, existing);
    actions.push({ hook, action: 'took first slot', detail: `chains ${existing}` });
  }

  return { events, actions };
}

// --- cli -------------------------------------------------------------------

function main() {
  const { flag, value, help } = flags(process.argv.slice(2));

  const configPath = value('--config') ?? DEFAULT_CONFIG;
  const uninstall = flag('--uninstall');
  const dryRun = flag('--dry-run');
  if (value('--adapter')) ADAPTER = path.resolve(value('--adapter'));

  if (help) {
    console.log('usage: aop-rovo-install.cjs [--dry-run|--uninstall|--status]');
    console.log('                            [--config <path>] [--adapter <path>]');
    return;
  }

  if (!uninstall && !flag('--status')) {
    const { ok, notes } = checkAdapter(ADAPTER);
    for (const note of notes) console.log(note);
    if (!ok) { process.exitCode = 1; return; }
  }

  if (!fs.existsSync(configPath)) {
    console.error(`No Rovo config at ${configPath}. Start Rovo CLI once, then re-run.`);
    process.exitCode = 1;
    return;
  }

  const text = fs.readFileSync(configPath, 'utf8');
  const config = parseConfig(text);

  if (flag('--status')) {
    console.log(`Rovo config: ${configPath}`);
    if (!config.events.length) console.log('  no eventHooks configured');
    for (const ev of config.events) {
      const first = ev.commands[0] ?? '(none)';
      const mark = isOurs(first) ? 'office' : (ev.commands.some(isOurs) ? 'office (inactive — not first)' : 'other');
      console.log(`  ${ev.name.padEnd(20)} ${mark}`);
      ev.commands.forEach((c, i) => console.log(`      ${i === 0 ? 'runs  ' : 'dead  '} ${c}`));
    }

    // A slot can be lost long after a successful install — see COST above — so the
    // report ends on what is *not* arriving rather than leaving that to be inferred
    // from eight rows of which two say `other`.
    const held = config.events
      .filter((ev) => HOOKS.includes(ev.name) && !isOurs(ev.commands[0] ?? ''));
    const absent = HOOKS.filter((h) => !config.events.some((ev) => ev.name === h));
    if (held.length || absent.length) {
      console.log('\nNot reaching the office:');
      for (const ev of held) {
        const ours = ev.commands.some(isOurs);
        console.log(`  ${ev.name.padEnd(20)} ${ours ? 'ours, but not first' : 'another command has the slot'}`);
        console.log(`      so     ${COST[ev.name]}`);
      }
      for (const h of absent) {
        console.log(`  ${h.padEnd(20)} not installed`);
        console.log(`      so     ${COST[h]}`);
      }
      console.log('\n  npm run connect:rovo    take the first slot back, chaining what it displaces');
    }

    console.log('');
    for (const line of statusLines(ADAPTER)) console.log(line);
    console.log('\nOnly the first command of an event is executed by Rovo CLI.');
    return;
  }

  const { events, actions } = plan(config, { uninstall });
  const next = renderConfig({ ...config, events });

  console.log(`${uninstall ? 'Uninstall' : 'Install'} plan for ${configPath}`);
  if (!actions.length) console.log('  nothing to do');
  for (const a of actions) {
    console.log(`  ${a.hook.padEnd(20)} ${a.action}${a.detail ? ` — ${a.detail}` : ''}`);
  }

  if (dryRun) {
    console.log('\n--- resulting eventHooks block ---');
    console.log(next.slice(next.indexOf('eventHooks:')).trimEnd());
    console.log('\n(dry run: nothing written)');
    return;
  }

  if (next === text) { console.log('\nConfig already correct; not rewriting.'); return; }

  const backup = `${configPath}.bak.roving-office-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
  fs.copyFileSync(configPath, backup);
  fs.writeFileSync(configPath, next);
  console.log(`\nBacked up to ${backup}`);
  console.log(`Wrote ${configPath}`);

  if (!uninstall) {
    // Scaffolded after the config is safely written, and never overwritten: the
    // defaults change no behaviour, they just make the choices findable.
    for (const line of scaffoldAll(ADAPTER).lines) console.log(line);

    console.log('\nRovo CLI reads eventHooks once, at session start — start a NEW Rovo');
    console.log('session for the office to see it. Then run the office:  npm start');
  }
}

main();
