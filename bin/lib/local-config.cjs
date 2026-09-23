// The machine-local config that every harness install shares.
//
// Two optional files under `~/.roving-office`, both read fresh on every event:
//
//   settings.json   how much the office is allowed to be told (spec §10)
//   projects.json   which office a git remote walks into
//
// They are scaffolded at install time rather than documented in a README,
// because the safe default — `metadata` redaction — makes every desk label read
// "Working", which looks like a bug and is really an unmade decision. JSON has no
// comments, so the explanation lives in a `"//"` key that every reader ignores.
//
// This lives here rather than in either installer because the files are about the
// *office*, not about a harness: a machine with Claude Code and Rovo CLI both
// wired up has one redaction setting and one alias table, and whichever installer
// runs first should be the one that creates them.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { isLoopback, readJson } = require('./aop-core.cjs');

const HOME_DIR = path.join(os.homedir(), '.roving-office');
const SETTINGS_FILE = path.join(HOME_DIR, 'settings.json');
const ALIAS_FILE = path.join(HOME_DIR, 'projects.json');
// Written by a local office on start, or by aop-connect for a remote one. Read here
// only to report it; the adapter is the one that acts on it.
const ENDPOINT_FILE = path.join(HOME_DIR, 'endpoint.json');

/**
 * Ask the adapter what it derives in this directory, so a scaffold names the
 * real repo and cannot drift from runtime behaviour.
 *
 * @param {string} adapter path to aop-send.cjs
 */
function derived(adapter) {
  try {
    return JSON.parse(execFileSync(process.execPath, [adapter, '--print-project'], {
      cwd: process.cwd(), timeout: 4000, encoding: 'utf8',
    }));
  } catch {
    return null;
  }
}

/** Write only when absent: an existing file was edited by someone for a reason. */
function scaffold(file, body) {
  if (fs.existsSync(file)) return 'kept';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return 'created';
}

function scaffoldSettings() {
  return scaffold(SETTINGS_FILE, {
    '//': [
      'How much the office is told about your work.',
      'Read fresh on every event, so an edit applies to the very next tool call —',
      'there is no need to restart an agent session.',
      '',
      'redaction:',
      '  metadata  (default) tool names, classes, file paths, durations, counts.',
      '            No free text, so desk labels read "Working".',
      '  summary   adds prompt-derived desk labels and error messages, truncated.',
      '  full      adds whole prompts, and also needs includePrompts: true.',
      '',
      'Tool activity is never generic: a bookshelf trip carries the file being',
      'read even under metadata. Only free text is withheld.',
    ],
    redaction: 'metadata',
    includePrompts: false,
  });
}

function scaffoldProjects(info) {
  const remote = info?.project?.repo?.remote ?? null;
  const slug = remote
    ? remote.replace(/^git@/, '').replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(':', '/')
    : null;
  return scaffold(ALIAS_FILE, {
    '//': [
      'Maps a git remote onto one of the offices in src/projects.js.',
      '',
      'An office id is derived from the git remote, so a repo whose name differs',
      'from the office you want it to appear in needs an entry here.',
      slug
        ? `This checkout resolves to: ${slug} -> "${info.project.id}"`
        : 'No git remote was found in this checkout.',
      '',
      'Add entries like:',
      '  "aliases": { "bitbucket.org/you/your-repo": "the-roving-office" }',
      '',
      'Note: the office does not route on project id yet, so every office fed by',
      'a harness currently sees every session from it. This mapping travels in',
      'each event and is what that routing will use.',
    ],
    aliases: {},
  });
}

/** Both files at once, with the lines an installer should print about them. */
function scaffoldAll(adapter) {
  const info = derived(adapter);
  const settings = scaffoldSettings();
  const projects = scaffoldProjects(info);
  const lines = [
    `${settings === 'created' ? 'Created' : 'Kept'} ${SETTINGS_FILE}`,
    `${projects === 'created' ? 'Created' : 'Kept'} ${ALIAS_FILE}`,
  ];
  if (settings === 'created') {
    lines.push(
      '',
      'Desk labels will read "Working" until you set redaction to',
      `"summary" in ${SETTINGS_FILE} — see the "//" note inside it.`,
    );
  }
  return { info, lines };
}

/** What `--status` should say about the machine-local side of the install. */
function statusLines(adapter) {
  const info = derived(adapter);
  const lines = [
    'Machine-local config',
    `  ${SETTINGS_FILE}`,
    `      redaction: ${info?.redaction ?? 'unknown'}${info?.redaction === 'metadata' ? '  (desk labels read "Working")' : ''}`,
    `  ${ALIAS_FILE}`,
  ];
  const aliases = Object.entries(info?.aliases ?? {});
  if (!aliases.length) lines.push('      no aliases');
  for (const [from, to] of aliases) lines.push(`      ${from} -> ${to}`);
  if (info?.project) {
    lines.push(`  this directory resolves to office "${info.project.id}" on branch ${info.project.repo?.branch ?? '(none)'}`);
  }

  // Where the events actually go. Worth stating in every installer's --status,
  // because "the hooks are installed" and "the hooks reach an office" are different
  // facts and only the second one puts anybody in the room. An office on another host
  // makes that gap wider: nothing local is listening, so there is nothing to notice.
  lines.push('', ...endpointLines());
  return lines;
}

/** How this machine's adapters are currently addressed, local or remote. */
function endpointLines() {
  const endpoint = readJson(ENDPOINT_FILE, null);

  if (process.env.AOP_URL) {
    return [
      'Events go to (AOP_URL in this environment, which wins over the file)',
      `  ${process.env.AOP_URL}`,
      `      token: ${process.env.AOP_TOKEN ? 'AOP_TOKEN is set' : 'AOP_TOKEN is NOT set — ingest will be refused'}`,
    ];
  }
  if (!endpoint?.url) {
    return [
      'Events go to: nowhere — no office has published an endpoint',
      '  start one locally (npm run serve) or attach to a remote office:',
      '      node bin/aop-connect.cjs <url>',
    ];
  }
  const remote = !isLoopback(endpoint.url);
  return [
    `Events go to (${remote ? 'remote' : 'local'})`,
    `  ${endpoint.url}`,
    `      office ${endpoint.keycard ?? '(unknown)'}${endpoint.pid ? `, served by pid ${endpoint.pid}` : ''}`,
    ...(remote ? ['      delivery is off the agent\'s clock: a hook spools and hands off to a',
      '      detached sender, a long-lived bridge batches on its own timer'] : []),
  ];
}

function ensureExecutable(file, label) {
  const notes = [];
  if (!fs.existsSync(file)) return { ok: false, notes: [`${label} not found at ${file}`] };
  try {
    fs.accessSync(file, fs.constants.X_OK);
  } catch {
    try {
      fs.chmodSync(file, 0o755);
      notes.push(`Made ${file} executable`);
    } catch {
      return { ok: false, notes: [`Cannot execute ${file}; chmod +x it and re-run.`] };
    }
  }
  return { ok: true, notes };
}

/**
 * Check the adapter is runnable and its path is worth writing down.
 *
 * A hook that is not executable fails silently, and a hook path inside a git
 * worktree or /tmp dies with the directory — both are worth a word before they
 * bite, because the path is stored verbatim by the harness.
 *
 * The Node launcher beside the adapter is checked on the same terms. It is the
 * file a hook command actually names, so a lost +x bit on it breaks every event
 * just as quietly as one on the adapter would.
 *
 * @returns {{ok: boolean, notes: string[]}}
 */
function checkAdapter(adapter) {
  const notes = [];
  const adapterCheck = ensureExecutable(adapter, 'Adapter');
  notes.push(...adapterCheck.notes);
  if (!adapterCheck.ok) return { ok: false, notes };

  const launcher = path.join(path.dirname(adapter), 'aop-node.sh');
  if (fs.existsSync(launcher)) {
    const launcherCheck = ensureExecutable(launcher, 'Node launcher');
    notes.push(...launcherCheck.notes);
    if (!launcherCheck.ok) return { ok: false, notes };
  }
  // Any directory named for worktrees, however the tool that made it spells it:
  // `worktrees/`, `.worktrees/`, and the per-tool variants that keep appearing.
  if (/\/\.?worktrees?\//.test(adapter) || adapter.startsWith('/tmp/')) {
    notes.push(
      'Note: this adapter path looks temporary (worktree or /tmp).',
      '      Hooks store it verbatim, so re-run with --adapter <stable path>',
      '      once the code lives in its permanent checkout.',
      '',
    );
  }
  return { ok: true, notes };
}

module.exports = {
  HOME_DIR,
  SETTINGS_FILE,
  ALIAS_FILE,
  derived,
  scaffold,
  scaffoldSettings,
  scaffoldProjects,
  scaffoldAll,
  statusLines,
  checkAdapter,
};
