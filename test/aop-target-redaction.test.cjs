// What a tool call is allowed to say about *what it was working on*, per redaction
// mode, in every adapter.
//
// This file exists because of a defect. `tool.start.target` was the first present
// value from a list of argument keys, capped at 200 characters — and that list mixed
// file paths with `pattern`, `content_pattern`, `query` and `url`. So at `metadata`,
// the default and the mode nobody changes, a Grep pattern, a web search and a full
// WebFetch URL including its query string went to the office verbatim, while
// `docs/user/connect-your-agents.md` promised "no free text from you or the model"
// and `aop-spec.md` §10 promised "paths … no free text from the model or user".
// Truncation is not redaction. The office is public, and a URL's query string is
// where credentials live.
//
// The suite that was green while that shipped had 139 tests over the redaction path
// and not one of them asserted about `target` at `metadata`. So this file is built
// against the ways such a test passes while the product leaks:
//
//   1. **The assertion names the field, and the leak moves.** Every case here sweeps
//      the *whole serialised event list* for planted secrets, following
//      `test/aop-wire-privacy.test.cjs` — a test that checks `payload.target` passes
//      while the same pattern rides along in a desk label or a turn title.
//   2. **A denylist only lists the leaks you already found.** That is exactly the
//      shape the code had: `metadata` withheld the four fields somebody remembered.
//      So the emitted key paths are checked against an **allowlist** per mode, and a
//      new field on the wire is red until someone writes it down.
//   3. **The mapper emitted nothing, so nothing leaked.** The most likely false
//      green. Every case also asserts positively: the tool calls arrive, the
//      permitted channels are *present*, and the secrets that a mode does permit are
//      found. A silent adapter fails here rather than passing.
//   4. **The key table grows a category nobody decided.** `TARGET_KEYS` is checked
//      bidirectionally against the cases below, so adding a key to the code without
//      classifying it in a test is a failing build.
//   5. **A sixth adapter quietly opts out.** `bin/mappers/*.cjs` is enumerated from
//      disk, and a mapper with no fixture fails — the `gen-npm-scripts.mjs`
//      bidirectional idiom, applied to adapters.
//
// And the two wire boundaries are both driven end to end, because they are genuinely
// two: the hook path through `bin/aop-send.cjs`, and the OpenClaw bridge, which is an
// in-process publisher and does not go through `aop-send.cjs` at all.
//
// `HOME` is redirected before aop-core is required, for the reason
// `test/aop-wire-privacy.test.cjs` gives: the module resolves `~/.roving-office` once
// at load, and the real one holds this machine's endpoint and settings.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aop-target-redaction-'));
const FAKE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(FAKE_HOME, { recursive: true });
process.env.HOME = FAKE_HOME;

const core = require('../bin/lib/aop-core.cjs');
const { MAPPER_HELPERS: helpers } = core;
const {
  describeTarget, redactTarget, targetOf, hostOf, TARGET_KEYS, TARGET_KINDS,
} = require('../bin/mappers/lib/tool-classes.cjs');

assert.equal(core.HOME, FAKE_HOME, 'the sandboxed home must be the one aop-core resolved');

process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const MODES = ['metadata', 'summary', 'full'];

// --- the planted secrets -----------------------------------------------------
//
// One uniquely-named secret per channel, so a failure names the channel rather than
// handing over a haystack: "SEKRIT-WEBQUERY reached the wire at metadata" points at a
// key. `HOST` is the deliberate exception — the part of a URL that *may* travel at
// `metadata` — and it is asserted present, which is what tells a reader the URL was
// reduced rather than merely dropped.

const SEKRIT = {
  prompt: 'SEKRIT-PROMPT',
  grep: 'SEKRIT-GREPPATTERN',
  query: 'SEKRIT-WEBQUERY',
  url: 'SEKRIT-URLTOKEN',
  error: 'SEKRIT-TOOLERROR',
  summary: 'SEKRIT-SUMMARY',
  reason: 'SEKRIT-REASON',
  commandArg: 'SEKRIT-COMMANDARG',
};
const HOST = 'internal.example.com';
const URL_WITH_SECRET = `https://${HOST}/api/v2/records?api_key=${SEKRIT.url}`;
const PATH_TARGET = 'src/config.js';
const CWD = '/work/repo';

/**
 * Which planted secrets a mode is allowed to carry, by the channel that carries them.
 *
 * `metadata` is the empty list, and that is the assertion this file was written for.
 *
 * `prompt` is permitted from `summary` up, which is not the same as saying the prompt
 * *field* travels there: a desk label at `summary` is a truncation of the prompt, so
 * the word is on the wire inside `turn.start.title` while `turn.start.prompt` is still
 * withheld until `full`. A string sweep cannot tell those apart, which is precisely why
 * there is an allowlist as well — `prompt` appears in it only under `full`.
 */
const PERMITTED_AT = {
  metadata: [],
  summary: ['grep', 'query', 'url', 'error', 'summary', 'reason', 'prompt'],
  full: ['grep', 'query', 'url', 'error', 'summary', 'reason', 'prompt'],
};

// --- the allowlist -----------------------------------------------------------
//
// Every key path any adapter may emit, written as `metadata` plus what each further
// mode adds — because that is what the modes *are*, and stating it this way makes the
// superset property something a reader can see rather than something a test asserts
// about two opaque lists. The union across five adapters, deliberately: a subset
// check against the union catches a new field wherever it appears, and the per-adapter
// presence assertions below stop the union from being a licence to emit nothing.

const ENVELOPE = ['type', 'ts', 'session.id', 'session.kind', 'session.cwd', 'session.parent_id'];

const ALLOWED_PAYLOAD = {
  metadata: {
    'session.start': ['source', 'capabilities', 'redaction', 'transcript', 'agent.name', 'agent.color', 'agent.avatar_url'],
    'session.end': ['reason', 'duration_ms'],
    'turn.start': ['turn_id', 'title', 'trigger', 'prompt_chars', 'origin.kind', 'origin.name', 'origin.id', 'origin.schedule'],
    'turn.end': ['turn_id', 'status', 'duration_ms', 'tool_calls'],
    'tool.start': ['tool_call_id', 'tool_name', 'tool_class', 'target', 'concurrent'],
    'tool.end': ['tool_call_id', 'tool_name', 'tool_class', 'status', 'duration_ms', 'result_bytes'],
    'permission.request': ['request_id', 'tool_name', 'tool_class', 'target'],
    'step.start': ['step_id', 'index', 'of', 'plan_length'],
    'step.end': ['step_id', 'index', 'of', 'status'],
    'artifact.change': ['kind', 'path', 'count'],
    error: ['message', 'fatal'],
  },
  summary: {
    'turn.end': ['title', 'summary'],
    'tool.end': ['error'],
    'step.start': ['title', 'plan'],
    'permission.request': ['reason'],
  },
  full: {
    'turn.start': ['prompt'],
  },
};

/** The allowlist for one mode, as a set of `<event>.payload.<key path>` strings. */
function allowlist(mode) {
  const out = new Set();
  const upto = MODES.slice(0, MODES.indexOf(mode) + 1);
  const types = new Set();
  for (const step of upto) for (const type of Object.keys(ALLOWED_PAYLOAD[step])) types.add(type);
  for (const type of types) {
    for (const key of ENVELOPE) out.add(`${type}.${key}`);
    for (const step of upto) {
      for (const key of ALLOWED_PAYLOAD[step][type] ?? []) out.add(`${type}.payload.${key}`);
    }
  }
  return out;
}

/**
 * Every key path present in a list of emitted events, serialised first.
 *
 * The round trip through JSON is the point rather than convenience: a mapper sets
 * plenty of fields to `undefined` and those never reach the wire, so a key list taken
 * from the live objects would fail an allowlist over fields nobody sent.
 */
function keyPaths(events) {
  const out = new Set();
  const walk = (value, prefix) => {
    for (const [k, v] of Object.entries(value ?? {})) {
      const at = `${prefix}.${k}`;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, at);
      else out.add(at);
    }
  };
  for (const event of JSON.parse(JSON.stringify(events))) walk(event, event.type);
  return [...out].sort();
}

// --- 1. the key table, and what each key is ----------------------------------
//
// One case per entry in `TARGET_KEYS`, asserted in both directions. This is the
// twenty-line unit test that should have existed: it is the cheapest possible
// statement of the policy, and it is the one that fails first.

const KEY_CASES = {
  file_path: { args: { file_path: `${CWD}/src/config.js` }, kind: 'path', metadata: PATH_TARGET },
  path: { args: { path: `${CWD}/src/config.js` }, kind: 'path', metadata: PATH_TARGET },
  new_path: { args: { new_path: `${CWD}/src/config.js` }, kind: 'path', metadata: PATH_TARGET },
  notebook_path: { args: { notebook_path: `${CWD}/nb.ipynb` }, kind: 'path', metadata: 'nb.ipynb' },
  file: { args: { file: `${CWD}/src/config.js` }, kind: 'path', metadata: PATH_TARGET },
  filename: { args: { filename: 'notes.md' }, kind: 'path', metadata: 'notes.md' },
  file_paths: { args: { file_paths: [`${CWD}/src/config.js`, `${CWD}/b.js`] }, kind: 'path', metadata: PATH_TARGET },
  paths: { args: { paths: [`${CWD}/src/config.js`] }, kind: 'path', metadata: PATH_TARGET },
  folder_path: { args: { folder_path: `${CWD}/src` }, kind: 'path', metadata: 'src' },
  // A saved prompt's name is declared by whoever saved it, not composed by the model
  // in the moment: the same category as a tool name, which §10 already sends.
  prompt_name: { args: { prompt_name: 'release-checklist' }, kind: 'name', metadata: 'release-checklist' },
  // Free text. Nothing at `metadata` — `tool_class` still says a search happened.
  pattern: { args: { pattern: SEKRIT.grep }, kind: 'search', metadata: undefined },
  content_pattern: { args: { content_pattern: SEKRIT.grep }, kind: 'search', metadata: undefined },
  query: { args: { query: `${SEKRIT.query} merger docs` }, kind: 'search', metadata: undefined },
  // The host, and never the path or the query string.
  url: { args: { url: URL_WITH_SECRET }, kind: 'network', metadata: HOST },
};

test('every argument key `targetOf` reads is classified, and every classification is tested', () => {
  // Both directions, as two set differences rather than one deep-equal, because the
  // failure message is the whole value: "you added `body` to TARGET_KEYS and did not
  // say what category it is" is actionable and a diff of two lists is not.
  const inCode = TARGET_KEYS.map(([key]) => key);
  const inTest = Object.keys(KEY_CASES);
  assert.deepEqual(
    inCode.filter((key) => !inTest.includes(key)),
    [],
    'these keys reach `target` and no case here says what category they are',
  );
  assert.deepEqual(
    inTest.filter((key) => !inCode.includes(key)),
    [],
    'these cases name an argument key `targetOf` no longer reads',
  );
  for (const [, kind] of TARGET_KEYS) {
    assert.ok(TARGET_KINDS[kind], `TARGET_KEYS uses the category ${kind}, which has no policy`);
  }
});

test('each key is described as its own category, whatever the mode', () => {
  for (const [key, expected] of Object.entries(KEY_CASES)) {
    const described = describeTarget(expected.args, undefined, CWD, helpers);
    assert.ok(described, `${key} described nothing`);
    assert.equal(described.kind, expected.kind, `${key} is the wrong category`);
  }
});

test('at metadata a path is sent, a search says nothing, and a URL is only its host', () => {
  for (const [key, expected] of Object.entries(KEY_CASES)) {
    assert.equal(
      targetOf(expected.args, undefined, CWD, helpers, 'metadata'),
      expected.metadata,
      `${key} at metadata`,
    );
  }
});

test('at summary and full the value travels as it always did', () => {
  for (const mode of ['summary', 'full']) {
    for (const [key, expected] of Object.entries(KEY_CASES)) {
      const target = targetOf(expected.args, undefined, CWD, helpers, mode);
      assert.equal(
        target,
        describeTarget(expected.args, undefined, CWD, helpers).value,
        `${key} at ${mode}`,
      );
    }
  }
});

test('a mode nobody recognised redacts rather than sends', () => {
  // The whole class of defect in one assertion: a future emission point that forgets
  // to pass the mode can only ever say too little.
  for (const mode of [undefined, null, '', 'FULL', 'verbose', 'metadata ']) {
    assert.equal(targetOf({ query: SEKRIT.query }, undefined, CWD, helpers, mode), undefined, String(mode));
    assert.equal(targetOf({ url: URL_WITH_SECRET }, undefined, CWD, helpers, mode), HOST, String(mode));
    assert.equal(targetOf({ file_path: `${CWD}/${PATH_TARGET}` }, undefined, CWD, helpers, mode), PATH_TARGET);
  }
});

test('a category with no policy sends nothing', () => {
  assert.equal(redactTarget({ value: 'anything', kind: 'invented' }, 'metadata'), undefined);
  assert.equal(redactTarget(undefined, 'metadata'), undefined);
  assert.equal(redactTarget({ value: '', kind: 'path' }, 'metadata'), undefined);
});

test('a command still names what it runs, and still drops its arguments', () => {
  const target = targetOf(
    { command: `gcloud auth print-access-token ${SEKRIT.commandArg}` },
    `gcloud auth print-access-token ${SEKRIT.commandArg}`,
    CWD, helpers, 'metadata',
  );
  assert.equal(target, 'gcloud auth');
  assert.equal(describeTarget({}, 'npm run probe', CWD, helpers).kind, 'command');
});

// --- 2. the host reduction ---------------------------------------------------

test('a URL reduces to its host, and to nothing when it has none', () => {
  assert.equal(hostOf('https://internal.example.com/api?api_key=SEKRIT'), 'internal.example.com');
  // The form the credential-in-a-git-remote fix was about, in the other field:
  // userinfo goes with the rest. See `test/aop-wire-privacy.test.cjs`.
  assert.equal(hostOf(`https://mike:${SEKRIT.url}@internal.example.com/p?q=1`), 'internal.example.com');
  assert.equal(hostOf('http://localhost:8080/aop/v0/events'), 'localhost:8080');
  assert.equal(hostOf('internal.example.com/api?api_key=SEKRIT'), 'internal.example.com');
  assert.equal(hostOf('//internal.example.com/api'), 'internal.example.com');
  assert.equal(hostOf('https://internal.example.com#SEKRIT'), 'internal.example.com');
  // Nothing that names a host: the safe end of the reduction is silence.
  assert.equal(hostOf('about:blank'), undefined);
  assert.equal(hostOf('file:///work/repo/src/config.js'), undefined);
  assert.equal(hostOf('not a url at all'), undefined);
});

// --- 3. every adapter, every mode --------------------------------------------
//
// The redaction *policy* is one thing shared by every adapter; what differs per
// adapter is which events it can produce and which argument keys its harness
// populates. So the fixtures vary per adapter and the assertions do not.

const HOOK_ADAPTERS = {
  'claude-code': {
    module: '../bin/mappers/claude-code.cjs',
    events: (s) => [
      ['SessionStart', { session_id: s, cwd: CWD, hook_event_name: 'SessionStart', source: 'startup', transcript_path: '/x/t.jsonl' }],
      ['UserPromptSubmit', { session_id: s, cwd: CWD, prompt: `${SEKRIT.prompt} — search the records`, prompt_id: 'p1' }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'Read', tool_use_id: 'c1', tool_input: { file_path: `${CWD}/${PATH_TARGET}` } }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'Grep', tool_use_id: 'c2', tool_input: { pattern: SEKRIT.grep } }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'WebFetch', tool_use_id: 'c3', tool_input: { url: URL_WITH_SECRET } }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'WebSearch', tool_use_id: 'c4', tool_input: { query: `${SEKRIT.query} merger docs` } }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'Bash', tool_use_id: 'c5', tool_input: { command: `gcloud auth print-access-token ${SEKRIT.commandArg}` } }],
      ['PermissionRequest', { session_id: s, cwd: CWD, tool_name: 'Grep', tool_use_id: 'c6', tool_input: { pattern: SEKRIT.grep }, reason: SEKRIT.reason }],
      ['PostToolUseFailure', { session_id: s, cwd: CWD, tool_name: 'Grep', tool_use_id: 'c2', tool_input: { pattern: SEKRIT.grep }, error: SEKRIT.error }],
      ['Stop', { session_id: s, cwd: CWD, last_message: SEKRIT.summary }],
    ],
  },
  'codex-cli': {
    module: '../bin/mappers/codex-cli.cjs',
    events: (s) => [
      ['SessionStart', { session_id: s, cwd: CWD, hook_event_name: 'SessionStart', source: 'startup' }],
      ['UserPromptSubmit', { session_id: s, cwd: CWD, prompt: `${SEKRIT.prompt} — search the records`, turn_id: 't1' }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'apply_patch', tool_use_id: 'c1', tool_input: { file_path: `${CWD}/${PATH_TARGET}` } }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'grep_files', tool_use_id: 'c2', tool_input: { pattern: SEKRIT.grep } }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'web_search', tool_use_id: 'c3', tool_input: { query: `${SEKRIT.query} merger docs` } }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'browser_fetch', tool_use_id: 'c4', tool_input: { url: URL_WITH_SECRET } }],
      ['PreToolUse', { session_id: s, cwd: CWD, tool_name: 'exec_command', tool_use_id: 'c5', tool_input: { command: `gcloud auth print-access-token ${SEKRIT.commandArg}` } }],
      ['PostToolUseFailure', { session_id: s, cwd: CWD, tool_name: 'grep_files', tool_use_id: 'c2', tool_input: { pattern: SEKRIT.grep }, error: SEKRIT.error }],
      ['Stop', { session_id: s, cwd: CWD, last_assistant_message: SEKRIT.summary }],
    ],
  },
  cursor: {
    module: '../bin/mappers/cursor.cjs',
    events: (s) => [
      ['sessionStart', { session_id: s, cwd: CWD }],
      ['beforeSubmitPrompt', { session_id: s, cwd: CWD, prompt: `${SEKRIT.prompt} — search the records` }],
      ['preToolUse', { session_id: s, cwd: CWD, tool_name: 'ReadFile', tool_use_id: 'c1', tool_input: { file_path: `${CWD}/${PATH_TARGET}` } }],
      ['preToolUse', { session_id: s, cwd: CWD, tool_name: 'Grep', tool_use_id: 'c2', tool_input: { pattern: SEKRIT.grep } }],
      ['preToolUse', { session_id: s, cwd: CWD, tool_name: 'WebSearch', tool_use_id: 'c3', tool_input: { query: `${SEKRIT.query} merger docs` } }],
      ['preToolUse', { session_id: s, cwd: CWD, tool_name: 'WebFetch', tool_use_id: 'c4', tool_input: { url: URL_WITH_SECRET } }],
      ['postToolUseFailure', { session_id: s, cwd: CWD, tool_name: 'Grep', tool_use_id: 'c2', tool_input: { pattern: SEKRIT.grep }, error: SEKRIT.error }],
      ['beforeShellExecution', { session_id: s, cwd: CWD, command: `gcloud auth print-access-token ${SEKRIT.commandArg}` }],
      ['stop', { session_id: s, cwd: CWD, summary: SEKRIT.summary }],
    ],
  },
  'rovo-cli': {
    module: '../bin/mappers/rovo-cli.cjs',
    events: (s) => [
      ['on_session_start', { session_id: s, cwd: CWD, attributes: {} }],
      ['on_user_prompt', { session_id: s, cwd: CWD, attributes: { user_prompt: `${SEKRIT.prompt} — search the records` } }],
      ['on_tool_start', { session_id: s, cwd: CWD, attributes: { tool_calls: [
        { tool_name: 'open_files', tool_call_id: 'c1', tool_args: { file_paths: [`${CWD}/${PATH_TARGET}`] } },
        { tool_name: 'grep_file_content', tool_call_id: 'c2', tool_args: { content_pattern: SEKRIT.grep } },
        { tool_name: 'search_the_web', tool_call_id: 'c3', tool_args: { query: `${SEKRIT.query} merger docs` } },
        { tool_name: 'fetch_url', tool_call_id: 'c4', tool_args: { url: URL_WITH_SECRET } },
        { tool_name: 'bash', tool_call_id: 'c5', tool_args: { command: `gcloud auth print-access-token ${SEKRIT.commandArg}` } },
      ] } }],
      ['on_tool_permission', { session_id: s, cwd: CWD, attributes: { tool_name: 'grep_file_content', reason: SEKRIT.reason } }],
      ['on_tool_end', { session_id: s, cwd: CWD, attributes: { tool_results: [{ tool_name: 'grep_file_content', tool_call_id: 'c2', status: 'error', error: SEKRIT.error }] } }],
      ['on_complete', { session_id: s, cwd: CWD, attributes: { summary: SEKRIT.summary } }],
      ['on_session_end', { session_id: s, cwd: CWD, attributes: {} }],
    ],
  },
};

/** Drive one adapter's whole fixture through one mode, as `bin/aop-send.cjs` does. */
function driveHooks(name, mode) {
  const mapper = require(HOOK_ADAPTERS[name].module);
  const state = { sessions: {} };
  const session = `${name}-${mode}`;
  const out = [];
  for (const [event, payload] of HOOK_ADAPTERS[name].events(session)) {
    out.push(...mapper.map({
      event, payload, state, redaction: mode, helpers, endpointId: 'ep-1', readTitle: () => null,
    }));
  }
  return out;
}

/**
 * The assertions that are the same for every adapter and every mode.
 *
 * @param {object[]} events   what the adapter emitted
 * @param {string}   mode     the redaction mode it was driven at
 * @param {string}   who      the adapter, for the failure message
 */
function assertPolicy(events, mode, who) {
  const wire = JSON.stringify(events);
  assert.ok(events.length, `${who} at ${mode} emitted nothing at all — a silent adapter proves nothing`);

  // 1. The planted secrets, by channel. Both directions: forbidden ones absent,
  //    permitted ones present — so a mode cannot pass by saying nothing.
  const permitted = PERMITTED_AT[mode];
  for (const [channel, secret] of Object.entries(SEKRIT)) {
    if (channel === 'commandArg') {
      assert.ok(!wire.includes(secret), `${who} at ${mode}: a command's argument reached the wire`);
      continue;
    }
    if (permitted.includes(channel)) continue;
    assert.ok(!wire.includes(secret), `${who} at ${mode}: ${secret} reached the wire`);
  }

  // 2. Every emitted key path is one somebody wrote down.
  const allowed = allowlist(mode);
  const unknown = keyPaths(events).filter((key) => !allowed.has(key));
  assert.deepEqual(unknown, [], `${who} at ${mode}: these key paths are on the wire and not in the allowlist`);

  // 3. The office still gets what it animates: the tool calls arrive, each with a
  //    class, and the path-shaped and command-shaped targets are still named.
  const starts = events.filter((e) => e.type === 'tool.start');
  assert.ok(starts.length >= 4, `${who} at ${mode}: only ${starts.length} tool.start events`);
  for (const start of starts) {
    assert.ok(start.payload.tool_class, `${who} at ${mode}: a tool.start with no tool_class`);
  }
  const targets = starts.map((e) => e.payload.target);
  assert.ok(targets.includes(PATH_TARGET), `${who} at ${mode}: the file path is gone from the wire`);
  assert.ok(targets.includes('gcloud auth'), `${who} at ${mode}: the command label is gone from the wire`);
}

for (const name of Object.keys(HOOK_ADAPTERS)) {
  test(`${name}: at metadata a search says only that it searched, and a fetch only its host`, () => {
    const events = driveHooks(name, 'metadata');
    assertPolicy(events, 'metadata', name);

    const starts = events.filter((e) => e.type === 'tool.start');
    const search = starts.filter((e) => e.payload.tool_class === 'search');
    assert.ok(search.length, `${name}: the fixture produced no search call`);
    for (const call of search) {
      assert.equal(call.payload.target, undefined, `${name}: a search named its query at metadata`);
    }

    const fetched = starts.filter((e) => e.payload.tool_class === 'network');
    assert.ok(fetched.length, `${name}: the fixture produced no network call`);
    // Reduced, not dropped: the host is exactly what §10 already permits of a remote.
    assert.ok(
      fetched.some((e) => e.payload.target === HOST),
      `${name}: no fetch reported its host — the reduction dropped the field instead`,
    );
  });

  test(`${name}: at summary and full the target is the value it always was`, () => {
    for (const mode of ['summary', 'full']) {
      const events = driveHooks(name, mode);
      assertPolicy(events, mode, name);
      const wire = JSON.stringify(events);
      // Positive, and the guard against a fix that over-corrected: the modes that buy
      // free text still get it, and the fixture really did carry these secrets.
      assert.ok(wire.includes(SEKRIT.grep), `${name} at ${mode}: the pattern should be here`);
      assert.ok(wire.includes(SEKRIT.query), `${name} at ${mode}: the query should be here`);
      assert.ok(wire.includes(SEKRIT.url), `${name} at ${mode}: the URL should be whole here`);

      // The one distinction the string sweep above cannot draw: `summary` buys a desk
      // label derived from the prompt, and not the prompt.
      const turn = events.find((e) => e.type === 'turn.start');
      assert.equal(
        typeof turn?.payload.prompt === 'string',
        mode === 'full',
        `${name} at ${mode}: turn.start.prompt is only ever a thing at full`,
      );
    }
  });

  test(`${name}: the modes are still each other's superset`, () => {
    const of = (mode) => new Set(keyPaths(driveHooks(name, mode)));
    const [meta, summary, full] = ['metadata', 'summary', 'full'].map(of);
    for (const key of meta) assert.ok(summary.has(key), `${name}: summary dropped ${key}`);
    for (const key of summary) assert.ok(full.has(key), `${name}: full dropped ${key}`);
  });
}

// --- 4. the OpenClaw bridge --------------------------------------------------
//
// The fifth adapter, and the one a fix can most easily miss: it is a long-lived
// in-process mapper rather than a hook process, so it shares `targetOf` and nothing
// else. A fix applied only to the hook path leaves every OpenClaw install sending
// what it always sent — a mistake this repo has made once already, and
// `test/aop-wire-privacy.test.cjs` says so at the top of its own bridge case.

async function driveOpenclaw(mode) {
  const { Mapper } = await import('../openclaw-plugin/lib/map.mjs');
  const out = [];
  const mapper = new Mapper({
    publish: (event) => out.push(event),
    redaction: () => mode,
    fallbackCwd: CWD,
    logger: { warn: () => {} },
    now: () => 1_770_000_000_000,
  });
  const ctx = { sessionId: 'oc-1', agentId: 'paige', workspaceDir: CWD };
  mapper.onAgentRun({ prompt: `${SEKRIT.prompt} — search the records` }, ctx);
  const calls = [
    ['read_file', { file_path: `${CWD}/${PATH_TARGET}` }],
    ['grep', { pattern: SEKRIT.grep }],
    ['web_search', { query: `${SEKRIT.query} merger docs` }],
    ['fetch_url', { url: URL_WITH_SECRET }],
    ['bash', { command: `gcloud auth print-access-token ${SEKRIT.commandArg}` }],
  ];
  calls.forEach(([toolName, params], i) => {
    mapper.onToolStart({ toolName, params, toolCallId: `c${i}` }, ctx);
    mapper.onToolEnd({ toolName, params, toolCallId: `c${i}` }, ctx);
  });
  mapper.onAgentEnd?.({}, ctx);
  return out;
}

test('the openclaw bridge applies the same policy at metadata', async () => {
  const events = await driveOpenclaw('metadata');
  const wire = JSON.stringify(events);
  assert.ok(events.length, 'the bridge published nothing at all');
  for (const [channel, secret] of Object.entries(SEKRIT)) {
    assert.ok(!wire.includes(secret), `the bridge sent ${channel} (${secret}) at metadata`);
  }

  const starts = events.filter((e) => e.type === 'tool.start');
  assert.equal(starts.length, 5, 'every tool call still arrives');
  const byClass = (cls) => starts.filter((e) => e.payload.tool_class === cls);
  for (const call of byClass('search')) assert.equal(call.payload.target, undefined);
  assert.ok(byClass('network').some((e) => e.payload.target === HOST), 'the fetch kept its host');
  assert.ok(
    starts.some((e) => e.payload.target === PATH_TARGET),
    'the path-shaped target still names the file',
  );
});

test('the openclaw bridge still sends the whole value at summary', async () => {
  const wire = JSON.stringify(await driveOpenclaw('summary'));
  assert.ok(wire.includes(SEKRIT.grep), 'the pattern should be here');
  assert.ok(wire.includes(SEKRIT.url), 'the URL should be whole here');
});

// --- 5. no adapter opts out --------------------------------------------------

test('every mapper in bin/mappers has a fixture in this file', () => {
  const dir = path.join(__dirname, '..', 'bin', 'mappers');
  const mappers = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.cjs'))
    .map((name) => name.replace(/\.cjs$/, ''))
    .sort();
  const covered = [...Object.keys(HOOK_ADAPTERS), 'openclaw'].sort();
  assert.deepEqual(
    mappers.filter((name) => !covered.includes(name)),
    [],
    'these adapters share `targetOf` and no fixture here drives them',
  );
  // And the other direction, so the list cannot rot into decoration.
  assert.deepEqual(
    covered.filter((name) => name !== 'openclaw' && !mappers.includes(name)),
    [],
    'these fixtures name a mapper that no longer exists',
  );
});

// --- 6. end to end, through the real hook process ----------------------------

/**
 * Drive `bin/aop-send.cjs` exactly as a hook does — payload on stdin, harness and
 * event as argv — against a receiver that records the bytes.
 *
 * The same shape as `emitted()` in `test/aop-wire-privacy.test.cjs`, and async for the
 * same non-negotiable reason: the receiver is this process, so blocking on the child is
 * a deadlock that reads exactly like an emitter that sends nothing.
 */
function emitted(cwd, payloads, env = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push(body); res.writeHead(204); res.end(); });
  });

  const fire = (port, event, payload) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, '..', 'bin', 'aop-send.cjs'), 'claude-code', event,
    ], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: {
        ...process.env,
        HOME: FAKE_HOME,
        AOP_URL: `http://127.0.0.1:${port}/aop/v0/events`,
        AOP_TOKEN: 'test-token',
        ROVING_OFFICE_REDACTION: 'metadata',
        ...env,
      },
      cwd,
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`aop-send exited ${code}: ${stderr}`));
      else resolve();
    });
    child.stdin.end(JSON.stringify(payload));
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        for (const [event, payload] of payloads) await fire(port, event, payload);
      } catch (err) { server.close(); reject(err); return; }
      server.close(() => resolve(received.join('\n')));
    });
  });
}

test('a hook fired with a Grep pattern and a tokened URL posts neither', async () => {
  const cwd = path.join(FAKE_HOME, 'checkouts', 'e2e');
  fs.mkdirSync(cwd, { recursive: true });
  const session = 'target-e2e-1';
  const raw = await emitted(cwd, [
    ['SessionStart', { session_id: session, cwd, hook_event_name: 'SessionStart', source: 'startup' }],
    ['UserPromptSubmit', { session_id: session, cwd, prompt: `${SEKRIT.prompt} find the records`, prompt_id: 'p1' }],
    ['PreToolUse', { session_id: session, cwd, tool_name: 'Grep', tool_use_id: 'c1', tool_input: { pattern: SEKRIT.grep } }],
    ['PreToolUse', { session_id: session, cwd, tool_name: 'WebFetch', tool_use_id: 'c2', tool_input: { url: URL_WITH_SECRET } }],
    ['PreToolUse', { session_id: session, cwd, tool_name: 'Read', tool_use_id: 'c3', tool_input: { file_path: `${cwd}/${PATH_TARGET}` } }],
  ]);

  assert.ok(raw.length, 'the receiver got nothing at all — the harness would be silent');
  for (const [channel, secret] of Object.entries(SEKRIT)) {
    assert.ok(!raw.includes(secret), `${channel} (${secret}) is on the wire:\n${raw}`);
  }

  // Reduced rather than dropped, and the office still has its three tool calls.
  const events = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const starts = events.filter((e) => e.type === 'tool.start');
  assert.equal(starts.length, 3, 'every tool call still reaches the office');
  assert.equal(starts.find((e) => e.payload.tool_name === 'Grep').payload.target, undefined);
  assert.equal(starts.find((e) => e.payload.tool_name === 'WebFetch').payload.target, HOST);
  assert.equal(starts.find((e) => e.payload.tool_name === 'Read').payload.target, PATH_TARGET);
});

test('the same hook at full still sends the whole pattern and the whole URL', async () => {
  const cwd = path.join(FAKE_HOME, 'checkouts', 'e2e-full');
  fs.mkdirSync(cwd, { recursive: true });
  const session = 'target-e2e-2';
  const raw = await emitted(cwd, [
    ['SessionStart', { session_id: session, cwd, hook_event_name: 'SessionStart', source: 'startup' }],
    ['UserPromptSubmit', { session_id: session, cwd, prompt: `${SEKRIT.prompt} find the records`, prompt_id: 'p1' }],
    ['PreToolUse', { session_id: session, cwd, tool_name: 'Grep', tool_use_id: 'c1', tool_input: { pattern: SEKRIT.grep } }],
    ['PreToolUse', { session_id: session, cwd, tool_name: 'WebFetch', tool_use_id: 'c2', tool_input: { url: URL_WITH_SECRET } }],
  ], { ROVING_OFFICE_REDACTION: 'full', ROVING_OFFICE_INCLUDE_PROMPTS: '1' });

  assert.ok(raw.includes(SEKRIT.grep), `the pattern should be here at full:\n${raw}`);
  assert.ok(raw.includes(SEKRIT.url), 'the URL should be whole at full');
  assert.ok(raw.includes(SEKRIT.prompt), 'and so should the prompt');
});
