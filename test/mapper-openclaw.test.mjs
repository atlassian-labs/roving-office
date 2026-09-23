// OpenClaw plugin hooks → AOP, for the half of the mapper that answers *why* a turn
// exists. The rest of the bridge needs an OpenClaw to exercise; this does not, because
// the mapper takes its publish function, its clock and its redaction mode as arguments.
//
// The payload shapes are read from the package's own type declarations at 2026.7.1-2 and
// 2026.8.2 — `PluginHookCronChangedEvent`, `PluginHookGatewayCronJob` and
// `PluginHookAgentContext` — and written up in docs/developer/adapters/openclaw.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Mapper } from '../openclaw-plugin/lib/map.mjs';

const SESSION = 'sess-1';
const JOB = 'cbcfacee-4c25-4f4f-963d-292d0d02dff8';

/** A mapper that collects what it would have published. */
function build({ redaction = 'metadata' } = {}) {
  const out = [];
  const warned = [];
  let now = 1_770_000_000_000;
  const mapper = new Mapper({
    publish: (ev) => out.push(ev),
    redaction: () => redaction,
    fallbackCwd: '/home/paige/.openclaw/workspace',
    logger: { warn: (line) => warned.push(line) },
    now: () => now,
  });
  return {
    mapper,
    out,
    warned,
    tick: (ms) => { now += ms; },
    turns: () => out.filter((e) => e.type === 'turn.start'),
  };
}

const cronJob = (over = {}) => ({
  id: JOB,
  agentId: 'paige',
  name: 'Paige hourly Room to Read Gmail check',
  enabled: true,
  schedule: { kind: 'cron', expr: '17 * * * *' },
  sessionTarget: 'main',
  payload: { kind: 'agentTurn', text: 'Check the Room to Read inboxes and only speak up if something is new' },
  ...over,
});

const runCtx = (over = {}) => ({
  sessionId: SESSION, agentId: 'paige', workspaceDir: '/home/paige/.openclaw/workspace-paige', ...over,
});

test('a cron run names its job on the desk, at the default redaction', () => {
  const { mapper, turns } = build({ redaction: 'metadata' });
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob(), runAtMs: 1 });
  mapper.onAgentRun({ prompt: 'Check the Room to Read inboxes' }, runCtx({ trigger: 'cron', jobId: JOB }));

  const [turn] = turns();
  // The whole point: `metadata` is the default, and this used to be the word "Working".
  // The desk drops the agent's own name off the front of it — Paige is standing there —
  // while `origin.name` keeps the operator's words, because that is the fact.
  assert.equal(turn.payload.title, 'Hourly Room to Read Gmail check');
  assert.equal(turn.payload.trigger, 'schedule');
  assert.deepEqual(turn.payload.origin, {
    kind: 'schedule',
    name: 'Paige hourly Room to Read Gmail check',
    id: JOB,
    schedule: '17 * * * *',
  });
});

test('a job whose whole name is the agent keeps it', () => {
  // One word left over is a mangling rather than a label, so the prefix stays.
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob({ name: 'Paige' }) });
  mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB }));
  assert.equal(turns()[0].payload.title, 'Paige');
});

test("the operator's description says why, from summary up", () => {
  const description = 'Only speaks up when something in the inbox is actually new';
  for (const [redaction, expected] of [['metadata', undefined], ['summary', description]]) {
    const { mapper, turns } = build({ redaction });
    mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob({ description }) });
    mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB }));
    // Spec §10 holds `origin.detail` back at `metadata`, and a description is prose even
    // when an operator wrote it. Changing that is a change to the spec, not to this file.
    assert.equal(turns()[0].payload.origin.detail, expected, redaction);
  }
});

test('the operator name is a name, and the prompt is still withheld at metadata', () => {
  const { mapper, turns } = build({ redaction: 'metadata' });
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob(), runAtMs: 1 });
  mapper.onAgentRun({ prompt: 'Check the Room to Read inboxes' }, runCtx({ trigger: 'cron', jobId: JOB }));

  const [turn] = turns();
  assert.equal(turn.payload.prompt, undefined, 'the user words never travel at metadata');
  assert.equal(turn.payload.prompt_chars, 30, 'their length is a count, and counts do');
});

test('a job the plugin never saw start is still named, if the gateway listed it', () => {
  // The case this exists for: an hourly job on a gateway that restarted at :10. Its next
  // tick is at :17, and `cron_changed` has said nothing yet.
  const { mapper, turns } = build();
  assert.equal(mapper.seedJobs([cronJob()]), 1);
  mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB }));
  assert.equal(turns()[0].payload.title, 'Hourly Room to Read Gmail check');
});

test('a seed never overwrites what the hook already said', () => {
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'updated', jobId: JOB, job: cronJob({ name: 'Renamed this morning' }) });
  assert.equal(mapper.seedJobs([cronJob()]), 0, 'a slow list() must not undo a fresh rename');
  mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB }));
  assert.equal(turns()[0].payload.title, 'Renamed this morning');
});

test('a removed job is forgotten', () => {
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob() });
  mapper.onCronChanged({ action: 'removed', jobId: JOB });
  mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB }));
  // No name to have, so the kind speaks instead — and it is still not "Working".
  assert.equal(turns()[0].payload.title, 'Scheduled job');
  assert.deepEqual(turns()[0].payload.origin, { kind: 'schedule' });
});

test('an action arriving without its job does not blank the name', () => {
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob() });
  mapper.onCronChanged({ action: 'finished', jobId: JOB, status: 'ok' });
  mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB }));
  assert.equal(turns()[0].payload.title, 'Hourly Room to Read Gmail check');
});

test('the four schedule kinds each say something short', () => {
  const cases = [
    [{ kind: 'cron', expr: '17 * * * *', tz: 'Australia/Sydney' }, '17 * * * * Australia/Sydney'],
    [{ kind: 'every', everyMs: 1_800_000 }, 'every 30m'],
    [{ kind: 'every', everyMs: 3_600_000 }, 'every 1h'],
    [{ kind: 'every', everyMs: 45_000 }, 'every 45s'],
    [{ kind: 'at', at: '2027-02-01T16:00:00Z' }, '2027-02-01T16:00:00Z'],
    [{ kind: 'on-exit', command: '/opt/paige/scripts/ingest.sh --once' }, 'on exit: ingest.sh'],
  ];
  for (const [schedule, expected] of cases) {
    const { mapper, turns } = build();
    mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob({ schedule }) });
    mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB }));
    assert.equal(turns()[0].payload.origin.schedule, expected, JSON.stringify(schedule));
  }
});

test('housekeeping is not a person asking for something', () => {
  for (const trigger of ['memory', 'overflow']) {
    const { mapper, turns } = build();
    mapper.onAgentRun({}, runCtx({ trigger }));
    const { payload } = turns()[0];
    assert.equal(payload.trigger, undefined, `${trigger}: AOP has no word, so none is sent`);
    assert.equal(payload.origin.kind, 'maintenance');
    assert.equal(payload.title, 'Housekeeping');
  }
});

test('a heartbeat is told apart from an errand', () => {
  const { mapper, turns } = build();
  mapper.onAgentRun({}, runCtx({ trigger: 'heartbeat' }));
  assert.equal(turns()[0].payload.trigger, 'schedule', 'AOP has one word for both');
  assert.equal(turns()[0].payload.origin.kind, 'heartbeat', 'origin keeps them apart');
  assert.equal(turns()[0].payload.title, 'Heartbeat');
});

test('an ordinary turn is unchanged, prompt and all', () => {
  const { mapper, turns } = build({ redaction: 'summary' });
  mapper.onAgentRun({ prompt: 'Fix the nav grid around the couch' }, runCtx({ trigger: 'user' }));
  const { payload } = turns()[0];
  assert.equal(payload.title, 'Fix the nav grid around the couch');
  assert.equal(payload.trigger, 'user');
  assert.deepEqual(payload.origin, { kind: 'human' });
});

test('a turn recovered from a tool call claims nothing about who asked', () => {
  // OpenClaw can run tools for a turn that began before the plugin loaded. We did not
  // see it start, so we are in no position to name whoever did or did not ask — but the
  // work in hand is a fact, and it is on the wire beside this event either way.
  const { mapper, turns, warned } = build();
  mapper.onToolStart({ toolName: 'read', params: { path: 'README.md' } }, { sessionId: SESSION });
  const { payload } = turns()[0];
  assert.equal(payload.title, 'Reading README.md');
  assert.equal(payload.trigger, undefined);
  assert.equal(payload.origin, undefined);
  assert.equal(warned.length, 1, 'and the missing run hook is said out loud, once');
  mapper.onToolStart({ toolName: 'read', params: { path: 'AGENTS.md' } }, { sessionId: 'sess-2' });
  assert.equal(warned.length, 1, 'once per gateway, not once per turn');
});

test('a search names no target, because the query is the model talking', () => {
  const { mapper, turns } = build();
  mapper.onToolStart(
    { toolName: 'memory_search', params: { query: 'why did Mike ask for the Rabbitohs watcher' } },
    { sessionId: SESSION },
  );
  assert.equal(turns()[0].payload.title, 'Searching');
});

test('a tool nobody has a verb for still says nothing rather than something wrong', () => {
  const { mapper, turns } = build();
  mapper.onToolStart({ toolName: 'message', params: {} }, { sessionId: SESSION });
  assert.equal(turns()[0].payload.title, 'Working', 'the `other` class has no honest verb');
});

// --- a scheduled desk on a gateway with no run lifecycle -------------------
//
// The case these exist for is the one measured in the office on 2026-09-03: `agent_end`
// arriving while `before_agent_run` never did, so every turn was recovered from its first
// tool call and every desk read "Working". `cron_changed` is not a conversation hook, so
// the job is still knowable — the join just has to be made the hard way.

test('a scheduled turn names its job with no run hook at all', () => {
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob(), runAtMs: 1 });
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3 inbox_check.py' } }, {
    sessionId: SESSION, agentId: 'paige',
  });

  const { payload } = turns()[0];
  assert.equal(payload.title, 'Hourly Room to Read Gmail check');
  assert.equal(payload.trigger, 'schedule');
  assert.equal(payload.origin.name, 'Paige hourly Room to Read Gmail check');
  assert.equal(payload.origin.id, JOB);
});

test('two ticks in flight for one agent are not guessed between', () => {
  const other = 'e5f0a1c2-0000-4000-8000-000000000002';
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob() });
  mapper.onCronChanged({ action: 'started', jobId: other, job: cronJob({ id: other, name: 'Paige nightly ledger' }) });
  // Nothing in the target names either job: `inbox_check` shares no word with "Room to
  // Read Gmail check" or "nightly ledger", so there is still nothing to go on.
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3 inbox_check.py' } }, {
    sessionId: SESSION, agentId: 'paige',
  });

  const { payload } = turns()[0];
  assert.equal(payload.origin, undefined, 'a desk in the wrong errand is worse than one in none');
  assert.equal(payload.title, 'Running python3 inbox_check.py');
});

// --- telling two ticks apart by the work in hand ---------------------------
//
// Two jobs for one agent on the same ten-minute anchor, which is what Sideline's Rabbitohs
// and Utah watchers actually do. Both desks used to lose their name to the tie.

const RABBITOHS = 'c2e813d9-3d10-4c8a-9b30-d0de7b3333f7';
const UTAH = '7b41f0aa-1111-4000-8000-000000000003';

function twoWatchers(mapper) {
  const every10m = { kind: 'every', everyMs: 600_000 };
  mapper.onCronChanged({ action: 'started', jobId: RABBITOHS, agentId: 'sideline', job: {
    id: RABBITOHS, agentId: 'sideline', name: 'Sideline Rabbitohs live watch', schedule: every10m,
    payload: { kind: 'agentTurn', text: 'Run python3 rabbitohs_live_watch.py and speak up only at halftime or fulltime' },
  } });
  mapper.onCronChanged({ action: 'started', jobId: UTAH, agentId: 'sideline', job: {
    id: UTAH, agentId: 'sideline', name: 'Sideline Utah team results watch', schedule: every10m,
    payload: { kind: 'agentTurn', text: 'Run python3 utah_team_results_watch.py and report any final score' },
  } });
}

test('the tick that names the script being run is the one claimed', () => {
  const { mapper, turns } = build();
  twoWatchers(mapper);
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3 rabbitohs_live_watch.py' } }, {
    sessionId: SESSION, agentId: 'sideline',
  });

  const { payload } = turns()[0];
  assert.equal(payload.title, 'Rabbitohs live watch');
  assert.equal(payload.trigger, 'schedule');
  assert.equal(payload.origin.id, RABBITOHS);
  assert.equal(payload.origin.name, 'Sideline Rabbitohs live watch');
  assert.equal(payload.origin.schedule, 'every 10m');
});

test('and the other tick is still there for the session that is running it', () => {
  const { mapper, turns } = build();
  twoWatchers(mapper);
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3 rabbitohs_live_watch.py' } }, {
    sessionId: SESSION, agentId: 'sideline',
  });
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3 utah_team_results_watch.py' } }, {
    sessionId: 'sess-2', agentId: 'sideline',
  });

  assert.equal(turns()[0].payload.origin.id, RABBITOHS);
  assert.equal(turns()[1].payload.origin.id, UTAH, 'both desks named, where neither used to be');
  assert.equal(turns()[1].payload.title, 'Utah team results watch');
});

test('a word both jobs use decides nothing', () => {
  // "watch" is in both names. A tie is the ambiguity we started with, so it declines.
  const { mapper, turns } = build();
  twoWatchers(mapper);
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3 watch_all.py' } }, {
    sessionId: SESSION, agentId: 'sideline',
  });
  assert.equal(turns()[0].payload.origin, undefined);
});

test('an interpreter is not evidence', () => {
  // `python3` appears in both prompts and names neither job.
  const { mapper, turns } = build();
  twoWatchers(mapper);
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3' } }, {
    sessionId: SESSION, agentId: 'sideline',
  });
  assert.equal(turns()[0].payload.origin, undefined);
});

test('matching on a job prompt does not put one on the wire', () => {
  const { mapper, out } = build();
  twoWatchers(mapper);
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3 rabbitohs_live_watch.py' } }, {
    sessionId: SESSION, agentId: 'sideline',
  });
  const wire = JSON.stringify(out);
  assert.ok(!wire.includes('speak up only at halftime'), 'read to recognise, never forwarded');
  assert.ok(!wire.includes('report any final score'));
});

test("a tick says whose errand it is even when its job does not", () => {
  // `cron_changed` mirrors `agentId` at the top level, so an action arriving without its
  // `job` can still be filtered by agent — and another agent's tick stays unclaimable.
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'added', jobId: JOB, job: { id: JOB, name: 'Paige hourly Room to Read Gmail check' } });
  mapper.onCronChanged({ action: 'started', jobId: JOB, agentId: 'paige' });
  mapper.onToolStart({ toolName: 'exec', params: {} }, { sessionId: SESSION, agentId: 'sideline' });
  assert.equal(turns()[0].payload.origin, undefined, "not sideline's tick");

  mapper.onToolStart({ toolName: 'exec', params: {} }, { sessionId: 'sess-2', agentId: 'paige' });
  assert.equal(turns()[1].payload.origin.id, JOB, 'but it is Paige’s');
});

test("another agent's errand is not claimable", () => {
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob() });
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3 rabbitohs.py' } }, {
    sessionId: SESSION, agentId: 'sideline',
  });
  assert.equal(turns()[0].payload.origin, undefined);
});

test('a tick nobody claimed in a minute is nobody\'s', () => {
  const { mapper, turns, tick } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob() });
  tick(61_000);
  mapper.onToolStart({ toolName: 'exec', params: { command: 'python3 inbox_check.py' } }, {
    sessionId: SESSION, agentId: 'paige',
  });
  assert.equal(turns()[0].payload.origin, undefined, 'a turn a minute later is a different turn');
});

test('one tick is claimed once', () => {
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob() });
  mapper.onToolStart({ toolName: 'exec', params: {} }, { sessionId: SESSION, agentId: 'paige' });
  mapper.onToolStart({ toolName: 'exec', params: {} }, { sessionId: 'sess-2', agentId: 'paige' });

  assert.equal(turns()[0].payload.origin.id, JOB);
  assert.equal(turns()[1].payload.origin, undefined, 'the second session did not run this tick');
});

test('a session that has finished a job once is certain of it after that', () => {
  // `finished` is the only cron event carrying a job and a session at the same time, and a
  // job with a `sessionTarget` runs its every tick in that same session. So the guess above
  // is needed for the first tick and for no tick after it.
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob() });
  mapper.onCronChanged({ action: 'finished', jobId: JOB, job: cronJob(), status: 'ok', sessionId: SESSION });
  mapper.onToolStart({ toolName: 'exec', params: {} }, { sessionId: SESSION, agentId: 'paige' });

  const { payload } = turns()[0];
  assert.equal(payload.origin.id, JOB, 'no tick pending, and still named');
  assert.equal(payload.trigger, 'schedule');
});

test('tool_calls counts this turn, not the session', () => {
  // The running total this fixes was visible in the office: 14, then 16, then 20, for
  // three turns of one session, because the reset lived in the hook that never fired.
  const { mapper, out } = build();
  const ctx = { sessionId: SESSION, agentId: 'paige' };
  const ends = () => out.filter((e) => e.type === 'turn.end').map((e) => e.payload.tool_calls);

  for (const turn of [1, 2]) {
    mapper.onToolStart({ toolName: 'read', params: { path: 'a.md' }, toolCallId: `c${turn}a` }, ctx);
    mapper.onToolEnd({ toolName: 'read', toolCallId: `c${turn}a` }, ctx);
    mapper.onToolStart({ toolName: 'read', params: { path: 'b.md' }, toolCallId: `c${turn}b` }, ctx);
    mapper.onToolEnd({ toolName: 'read', toolCallId: `c${turn}b` }, ctx);
    mapper.onAgentEnd({ success: true }, ctx);
  }
  assert.deepEqual(ends(), [2, 2]);
});

test('every field is capped, so a pasted essay cannot ride on every turn', () => {
  const { mapper, turns } = build();
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob({
    name: 'n'.repeat(500),
    schedule: { kind: 'cron', expr: 'e'.repeat(500) },
  }) });
  mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB }));
  const { origin, title } = turns()[0].payload;
  assert.equal(origin.name.length, 80);
  assert.equal(origin.schedule.length, 40);
  assert.equal(title.length, 80);
});

test('a job carries no prompt of its own onto the wire', () => {
  // `payload.text` is the cron's prompt. It is a prompt like any other and answers to
  // redaction like one, so it must not arrive dressed as an operator's label.
  const { mapper, out } = build({ redaction: 'metadata' });
  mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob() });
  mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB }));
  const wire = JSON.stringify(out);
  assert.ok(!wire.includes('only speak up if something is new'), 'the job prompt stayed home');
});

test('the mapper never answers a hook', () => {
  const { mapper } = build();
  assert.equal(mapper.onCronChanged({ action: 'started', jobId: JOB, job: cronJob() }), undefined);
  assert.equal(mapper.onAgentRun({}, runCtx({ trigger: 'cron', jobId: JOB })), undefined);
});

test('a trigger from a future OpenClaw is not called human', () => {
  // The failure mode this guards is the one the change removed, one field along: a word
  // we do not know is not evidence that a person asked for anything.
  const { mapper, turns } = build();
  mapper.onAgentRun({}, runCtx({ trigger: 'somethingNewIn2027' }));
  const { payload } = turns()[0];
  assert.equal(payload.trigger, undefined);
  assert.equal(payload.origin, undefined, 'no kind we can stand behind, so no origin');
  assert.equal(payload.title, 'Working');
});

test('a plain chat turn has no trigger at all, and that means a person', () => {
  const { mapper, turns } = build({ redaction: 'summary' });
  mapper.onAgentRun({ prompt: 'Sort the backlog' }, runCtx());
  assert.deepEqual(turns()[0].payload.origin, { kind: 'human' });
  assert.equal(turns()[0].payload.title, 'Sort the backlog');
});
