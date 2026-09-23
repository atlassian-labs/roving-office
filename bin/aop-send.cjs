#!/usr/bin/env node
// aop-send — the shared harness adapter. Reads one hook payload on stdin, turns it
// into Agent Office Protocol events (docs/developer/protocol/aop-spec.md) and posts them to the
// office's receiver.
//
//   aop-send <harness> <event-name> [--chain "<command>"]
//
// Example, as installed into ~/.rovo/config.yml:
//   aop-send rovo-cli on_tool_start
//
// Design constraints, all learned the hard way from real harnesses:
//
//   1. ALWAYS exit 0. Rovo CLI *disables* an event hook that exits non-zero, so a
//      failed POST would silently uninstall the integration. Every error path here
//      ends in exit 0, including crashes and timeouts.
//   2. Never make the agent wait. Hard watchdog at WATCHDOG_MS; the POST itself
//      gets a much smaller budget. A slow office must never become a slow agent.
//   3. Do nothing at all when the office is not running. No endpoint file means we
//      exit before parsing, hashing or shelling out to git.
//   4. Redact at the emitter (spec §10). The receiver never sees what we dropped,
//      so a leak here cannot be un-leaked downstream.
//
// --chain exists because of a Rovo CLI constraint verified on 202608.25.1: when an
// event has several `commands`, only the FIRST one actually runs. So an installer
// cannot politely append itself behind an existing hook — it has to take the slot
// and re-run the displaced command itself. See bin/aop-rovo-install.cjs.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// The decisions every AOP emitter shares — where the office is, which office a
// directory belongs to, and how much may be said about it. Extracted once a
// long-lived bridge needed the same answers; see bin/lib/aop-core.cjs.
const core = require('./lib/aop-core.cjs');
const {
  AOP_VERSION, DIR, SETTINGS_FILE, ALIAS_FILE,
  readJson, writeJsonAtomic,
  firstString, nowIso, toIso,
  MAPPER_HELPERS,
  deriveProject, resolveEndpoint, wireSession,
  resolveRedaction,
} = core;

// --- budgets ---------------------------------------------------------------

const STDIN_MS = 250;        // a hook that sends nothing must not hang us
const CONNECT_MS = 500;      // spec §5.6
const REQUEST_MS = 1000;
const WATCHDOG_MS = 2500;    // absolute ceiling on this process
const GZIP_OVER = 4096;

// A remote office is on the other side of a TLS handshake and someone else's
// network, and measured round trips to a hosted one run 0.7–0.9s — comfortably past
// the budgets above, which were set for loopback where 50ms is a slow reply. Raising
// them is safe *only* because a remote send no longer happens in the hook's process
// (see FLUSH_MODE): these are the flusher's budgets, and the flusher keeps nobody
// waiting. The hook itself still exits inside WATCHDOG_MS whatever the network does.
const REMOTE_CONNECT_MS = 2000;
const REMOTE_REQUEST_MS = 4000;
const FLUSH_WATCHDOG_MS = 10000;

const SPOOL_FILE = path.join(DIR, 'spool.ndjson');
const SPOOL_MAX_LINES = 500;
const SAMPLE_MAX = 50;

// Nothing below this line is allowed to take the process down.
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));

// --- small helpers ---------------------------------------------------------

/** Read stdin, but never block on a hook that sends nothing. */
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let buf = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(buf); } };
    const timer = setTimeout(finish, STDIN_MS);
    timer.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

// --- per-session adapter state --------------------------------------------
//
// Hooks are dead between events, so anything that has to persist across them —
// sequence numbers, whether a turn is open, which tool call is in flight — lives
// in a small JSON file. Last writer wins; the worst case is a duplicate
// `session.start`, which the receiver's id de-duplication already absorbs.

const STATE_TTL_MS = 30 * 60 * 1000;

function stateFile(harness) { return path.join(DIR, `state-${harness}.json`); }

function loadState(harness) {
  const state = readJson(stateFile(harness), null) ?? { sessions: {} };
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [id, s] of Object.entries(state.sessions)) {
    if ((s.lastSeen ?? 0) < cutoff) delete state.sessions[id];
  }
  return state;
}

function sessionState(state, id) {
  if (!state.sessions[id]) state.sessions[id] = { seq: 0, started: false, turnOpen: false, tools: {} };
  return state.sessions[id];
}

// --- transport -------------------------------------------------------------

function readSpool() {
  try {
    const lines = fs.readFileSync(SPOOL_FILE, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-SPOOL_MAX_LINES);
  } catch { return []; }
}

function appendSpool(lines) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(SPOOL_FILE, `${lines.join('\n')}\n`, { mode: 0o600 });
    const kept = readSpool();
    if (kept.length >= SPOOL_MAX_LINES) fs.writeFileSync(SPOOL_FILE, `${kept.join('\n')}\n`, { mode: 0o600 });
  } catch { /* the office simply misses these */ }
}

/**
 * Take exclusive ownership of what is currently spooled.
 *
 * A rename, because two senders can now be in flight at once — a hook draining
 * inline and a detached flusher started by the one before it. Reading the file and
 * deleting it afterwards loses whatever arrived in between; renaming it hands this
 * process a private, complete batch and leaves an empty spool for everyone else.
 * On POSIX the rename is atomic, so exactly one caller can win a given batch.
 */
function claimSpool() {
  const claim = `${SPOOL_FILE}.${process.pid}.claim`;
  try {
    fs.renameSync(SPOOL_FILE, claim);
  } catch {
    return { lines: [], release: () => {} };   // nothing spooled, or someone beat us
  }
  let lines = [];
  try { lines = fs.readFileSync(claim, 'utf8').split('\n').filter(Boolean); } catch { /* unreadable */ }
  return {
    lines,
    /** Give the batch back if we could not deliver it; drop the claim if we did. */
    release: (delivered) => {
      if (!delivered && lines.length) appendSpool(lines);
      try { fs.unlinkSync(claim); } catch { /* already gone */ }
    },
  };
}

// --- where the events go ---------------------------------------------------

// Both live in bin/lib/aop-core.cjs: the endpoint is machine-wide, so a hook adapter
// and a long-lived bridge must agree about it exactly.

/**
 * POST NDJSON with the hook's budgets, or the flusher's. Shared with the OpenClaw
 * bridge via bin/lib/aop-core.cjs — the request is identical, only the patience differs.
 */
function post(endpoint, body) {
  return core.post(endpoint, body, {
    connectMs: endpoint.remote ? REMOTE_CONNECT_MS : CONNECT_MS,
    requestMs: endpoint.remote ? REMOTE_REQUEST_MS : REQUEST_MS,
    gzipOver: GZIP_OVER,
  });
}

// --- payload sampling ------------------------------------------------------
//
// One field-name question is still open per harness (what a tool hook actually
// puts in `attributes`), and the honest way to close it is to look at real
// traffic. So we record the *shape* of each payload — keys and value types, never
// string contents — the first SAMPLE_MAX times we see a new shape. Set
// ROVING_OFFICE_CAPTURE=full to record values too, on your own machine, knowingly.

function recordShape(harness, event, payload) {
  const mode = process.env.ROVING_OFFICE_CAPTURE;
  if (mode === '0' || mode === 'off') return;
  const file = path.join(DIR, `shapes-${harness}.ndjson`);
  try {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
    if (existing.length >= SAMPLE_MAX) return;
    const shape = (obj, depth = 0) => {
      if (obj === null || typeof obj !== 'object') return typeof obj;
      if (Array.isArray(obj)) return depth > 2 ? 'array' : [shape(obj[0], depth + 1)];
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = depth > 2 ? typeof v : shape(v, depth + 1);
      return out;
    };
    const line = JSON.stringify({
      at: nowIso(), event,
      shape: shape(payload),
      ...(mode === 'full' ? { payload } : {}),
    });
    if (existing.includes(line)) return;
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
  } catch { /* sampling is never worth an error */ }
}

// --- redaction mode --------------------------------------------------------

// `resolveRedaction` lives in bin/lib/aop-core.cjs. Precedence: env over
// `settings.json` over the safe default, and `full` always needs a second opt-in.

// --- chaining --------------------------------------------------------------

/**
 * Re-run the command we displaced, handing it the same stdin.
 *
 * Detached and unwatched: its failures are its own business, and we must not wait
 * for it. This is what keeps a pre-existing hook (telemetry, notifications)
 * working after we take the single command slot Rovo gives an event.
 */
function chain(command, stdin) {
  if (!command) return;
  try {
    const child = spawn('/bin/sh', ['-c', command], {
      stdio: ['pipe', 'ignore', 'ignore'], detached: true,
    });
    child.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(stdin ?? '');
    child.unref();
  } catch { /* nothing we can do, and nothing worth failing for */ }
}

// --- main ------------------------------------------------------------------

function parseArgs(argv) {
  const out = { harness: null, event: null, chain: null, printProject: false, flush: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--print-project') { out.printProject = true; continue; }
    if (argv[i] === '--flush') { out.flush = true; continue; }
    if (argv[i] === '--chain') { out.chain = argv[++i] ?? null; continue; }
    if (argv[i].startsWith('--chain=')) { out.chain = argv[i].slice(8); continue; }
    rest.push(argv[i]);
  }
  [out.harness, out.event] = rest;
  return out;
}

// --- delivery --------------------------------------------------------------

/**
 * Hand the spool to a detached copy of ourselves and forget about it.
 *
 * This is the whole answer to "how does a plugin talk to a remote office without
 * slowing the agent down". Design rule 2 says a slow office must never become a slow
 * agent, and against a hosted receiver the POST alone costs more than this process is
 * allowed to live. So the hook's job shrinks to an append and a spawn — a few
 * milliseconds of local disk — and the network happens in a process nobody is waiting
 * for, with budgets it can actually meet.
 *
 * `detached` + `unref` + ignored stdio is what makes it survivable: the child leaves
 * our process group, so it is not killed when the harness reaps us, and it holds no
 * pipe that could block on a full buffer.
 */
function spawnFlusher() {
  // One sender is enough. A busy session fires a hook per tool call, and starting a
  // Node process for each would spend more CPU on process startup than on the work —
  // so if a flusher claimed a batch moments ago, leave it to finish: it re-checks the
  // spool before exiting and will carry these lines too.
  if (flusherIsWorking()) return true;
  try {
    const child = spawn(process.execPath, [__filename, '--flush'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,   // AOP_URL/AOP_TOKEN must survive into the child
    });
    child.unref();
    return true;
  } catch {
    return false;   // no spawn, no delivery this time — the spool keeps the events
  }
}

/**
 * Is a sender mid-flight?
 *
 * Judged by a claim file young enough to belong to a living process. A stale claim —
 * left by a sender that was killed between the rename and the release — must not
 * suppress senders forever, so age is the test rather than mere existence.
 */
function flusherIsWorking() {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(DIR)) {
      if (!name.startsWith(`${path.basename(SPOOL_FILE)}.`) || !name.endsWith('.claim')) continue;
      const { mtimeMs } = fs.statSync(path.join(DIR, name));
      if (now - mtimeMs < FLUSH_WATCHDOG_MS) return true;
    }
  } catch { /* no directory yet, or unreadable: assume nobody is working */ }
  return false;
}

/**
 * Drain the spool to the office. The detached half of `spawnFlusher`.
 *
 * Nothing calls this on the hook's critical path, so it may take the time a real
 * network needs. It claims the spool rather than reading it, so a hook that fires
 * while we are in flight neither loses its events nor has them sent twice.
 */
async function runFlush() {
  const endpoint = resolveEndpoint();
  if (!endpoint) return;

  // Drain until empty, not once. Hooks that fire while we are in flight are told not
  // to start a second sender (see `spawnFlusher`), which is only safe if we come back
  // and look — so a burst of tool calls is carried by this one process instead of one
  // process each. Stops on the first failure: if the office is unreachable, the next
  // pass would fail identically, and the events keep their place in the spool.
  const deadline = Date.now() + FLUSH_WATCHDOG_MS;
  while (Date.now() < deadline) {
    const batch = claimSpool();
    if (!batch.lines.length) return;
    const { ok } = await post(endpoint, batch.lines.join('\n'));
    batch.release(ok);
    if (!ok) return;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // The detached half: no stdin, no mapper, no harness — just deliver what is
  // already spooled and go. Started by `spawnFlusher` from a previous invocation.
  if (args.flush) {
    await runFlush();
    process.exit(0);
  }

  // A diagnostic, not a hook path: answers "which office would a session in this
  // directory walk into, and how much would it say?" without needing a harness,
  // a payload or a running office. The installer uses it to write a scaffold that
  // names your actual repo instead of a generic placeholder.
  if (args.printProject) {
    console.log(JSON.stringify({
      project: deriveProject(process.cwd()),
      redaction: resolveRedaction(),
      settingsFile: SETTINGS_FILE,
      aliasFile: ALIAS_FILE,
      aliases: readJson(ALIAS_FILE, null)?.aliases ?? {},
    }, null, 2));
    process.exit(0);
  }

  if (!args.harness) process.exit(0);

  const stdin = await readStdin();

  // The displaced hook goes first: it should not pay for our latency, and it must
  // still run even if everything below decides to bail.
  chain(args.chain, stdin);

  // No office running? Then there is nothing to do, and we said we would not
  // shell out to git or touch caches in that case.
  const endpoint = resolveEndpoint();
  if (!endpoint?.url) process.exit(0);

  let payload = {};
  try { payload = stdin ? JSON.parse(stdin) : {}; } catch { payload = {}; }
  if (!payload || typeof payload !== 'object') payload = {};

  const event = args.event ?? firstString(payload.hook_event_name, payload.event, payload.type) ?? 'unknown';
  recordShape(args.harness, event, payload);

  let mapper;
  try { mapper = require(`./mappers/${args.harness}.cjs`); } catch { process.exit(0); }

  const redaction = resolveRedaction();

  const state = loadState(args.harness);
  const events = mapper.map({
    event,
    payload,
    state,
    redaction,
    // Which receiver we are talking to. A restarted office has an empty buffer and
    // has never heard of this session, so anything it learned from the original
    // session.start — capabilities above all, which decide how patiently the office
    // waits before reaping an idle agent — is gone. When this changes, the mapper
    // re-introduces the session rather than assuming it is still known.
    endpointId: `${endpoint.pid ?? ''}@${endpoint.url}`,
    helpers: MAPPER_HELPERS,
  }) ?? [];
  if (!events.length) { writeJsonAtomic(stateFile(args.harness), state); process.exit(0); }

  // Envelope every mapped event (spec §3). The mapper owns `session`, `payload`
  // and `type`; everything else is the same for every harness.
  const version = firstString(payload.cli_version, payload.version);

  // Optional, and the mapper's business: one harness binary can be reached more
  // than one way — a terminal, a desktop app, an SDK — and the office says so
  // rather than calling them all the same thing. A mapper that has no opinion
  // returns nothing and the envelope stays as it was.
  let variant;
  try { variant = typeof mapper.variant === 'function' ? mapper.variant({ payload, env: process.env }) : null; }
  catch { variant = null; }

  const harness = { name: args.harness };
  if (version) harness.version = version;
  if (variant) harness.variant = variant;

  const lines = events.map((ev) => {
    const sess = sessionState(state, ev.session.id);
    sess.lastSeen = Date.now();
    const envelope = {
      aop: AOP_VERSION,
      id: `${ev.session.id}:${++sess.seq}:${crypto.randomBytes(4).toString('hex')}`,
      ts: ev.ts ?? toIso(payload.timestamp),
      seq: sess.seq,
      type: ev.type,
      harness,
      // `wireSession` last, so `deriveProject` below still gets the real directory.
      session: wireSession(ev.session),
      payload: ev.payload ?? {},
    };
    const project = deriveProject(ev.session.cwd);
    if (project) envelope.project = project;
    if (ev.ext) envelope.ext = ev.ext;
    return JSON.stringify(envelope);
  });

  writeJsonAtomic(stateFile(args.harness), state);

  // Two ways to deliver, chosen by where the office is.
  //
  // Remote: spool and hand off. The events are on disk before we return, so nothing
  // is riding on this process surviving, and the network cost lands in a process the
  // harness is not waiting for. If the spawn fails we have still spooled, so the next
  // hook — or the next flusher — carries them.
  //
  // Local: send inline, as it always has. A loopback POST answers inside 50ms, which
  // is cheaper than starting a second Node process, and staying synchronous keeps the
  // common path exactly as proven.
  if (endpoint.remote) {
    appendSpool(lines);
    spawnFlusher();
  } else {
    const batch = claimSpool();
    const { ok } = await post(endpoint, [...batch.lines, ...lines].join('\n'));
    batch.release(ok);
    if (!ok) appendSpool(lines);
  }

  process.exit(0);
}

// The watchdog is the real guarantee: whatever happens above, this process is
// gone well inside the harness's patience.
//
// The flusher is allowed to be slower, because nobody is being kept waiting by it —
// it is detached, the harness has already been answered, and its whole purpose is to
// outlive the hook that started it. It still gets a ceiling, so a hung socket cannot
// leave a Node process loitering for the rest of the session.
const watchdog = setTimeout(
  () => process.exit(0),
  process.argv.includes('--flush') ? FLUSH_WATCHDOG_MS : WATCHDOG_MS,
);
watchdog.unref?.();

main().catch(() => process.exit(0));
