// The one reducer, driven the way a test can: recorded AOP envelopes in, stage
// directions out, with the clock and the travel debounce under the test's
// control. This is the place the room can disagree with reality, so these are
// the fixtures that matter most.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAopReducer, safeAvatar, normalisePlan,
  TRAVEL_DEBOUNCE_MS, SESSION_TTL_MS, FAREWELL_TTL_MS,
} from '../src/data/aop-reducer.js';

const HARNESS = 'claude-code';

/**
 * A reducer on a bench: fake clock, fake timers fired by hand, captured output.
 */
function bench({ harness = HARNESS } = {}) {
  const out = [];
  let clock = 1_000_000;
  const timers = new Map();
  let nextTimer = 1;

  const r = createAopReducer({
    harness,
    emit: (ev) => out.push(ev),
    now: () => clock,
    schedule: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, at: clock + ms }); return id; },
    cancel: (id) => timers.delete(id),
    loadColourNames: () => new Promise(() => {}),   // never resolves: no fetch in a test
  });

  return {
    r, out,
    /** Advance the clock, firing any timer that comes due, in order. */
    tick(ms) {
      clock += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= clock) { timers.delete(id); t.fn(); }
      }
    },
    types: () => out.map((e) => e.type),
    last: () => out[out.length - 1],
    take() { const copy = [...out]; out.length = 0; return copy; },
  };
}

const env = (type, sid, payload = {}, extra = {}) => ({
  aop: '0.1', id: `${type}:${sid}:${Math.random()}`, type,
  harness: { name: HARNESS },
  session: { id: sid },
  payload,
  ...extra,
});

// --- spawning ----------------------------------------------------------------

test('any event naming an unknown session spawns it — implicit spawn, spec §7.1', () => {
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'edit' }));
  assert.equal(b.out[0].type, 'spawn');
  assert.equal(b.out[0].id, `${HARNESS}:S1`);
  assert.ok(b.out[0].name, 'the cast hands every session a name');
});

test('events for another harness are not ours', () => {
  const b = bench();
  b.r.reduce({ ...env('session.start', 'S1'), harness: { name: 'rovo-cli' } });
  assert.deepEqual(b.out, []);
});

test('duplicate event ids reduce once — a snapshot/stream overlap is harmless', () => {
  const b = bench();
  const e = env('session.start', 'S1');
  b.r.reduce(e);
  b.r.reduce(e);
  assert.equal(b.out.filter((x) => x.type === 'spawn').length, 1);
});

test('subagent sessions are skipped until the scene can render ghosts', () => {
  const b = bench();
  b.r.reduce(env('tool.start', 'ghost', { tool_call_id: 't', tool_class: 'search' },
    { session: { id: 'ghost', parent_id: 'S1' } }));
  assert.deepEqual(b.out, []);
});

// --- turns -------------------------------------------------------------------

test('a prompt arrives as addressed post, and the agent sets to work', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Fix the flaky test' }));
  const types = b.types();
  assert.ok(types.includes('spawn'));
  const mail = b.out.find((e) => e.type === 'mail');
  assert.equal(mail.forId, `${HARNESS}:S1`, 'a prompt typed into one terminal is nobody else\'s to open');
  assert.equal(mail.job, 'Fix the flaky test');
  assert.equal(b.last().type, 'status');
  assert.equal(b.last().status, 'working');
});

test('a follow-up turn keeps the stable job instead of quoting the latest prompt', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', {
    title: 'Can you implement stable job labels in the agent roster?',
  }));
  b.take();

  b.r.reduce(env('turn.start', 'S1', { title: 'Yup — clean up the worktree.' }));
  const mail = b.out.find((e) => e.type === 'mail');
  assert.equal(mail.job, 'Implement stable job labels in the agent roster');
  assert.equal(b.out.some((e) => e.type === 'rename'), false,
    'a finishing chore does not rename the person after the follow-up');
});

test('referential follow-ups stay within the job and an explicit new job replaces it', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Fix the compass layout' }));
  b.take();

  b.r.reduce(env('turn.start', 'S1', { title: 'Make it a little smaller' }));
  assert.equal(b.out.find((e) => e.type === 'mail').job, 'Fix the compass layout');
  b.take();

  b.r.reduce(env('turn.start', 'S1', { title: 'New job: investigate the roster filters' }));
  assert.equal(b.out.find((e) => e.type === 'mail').job,
    'New job: investigate the roster filters');
});

test('generic metadata turns yield to the first substantive job', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Working' }));
  assert.equal(b.out.find((e) => e.type === 'mail').job, 'Working');
  b.take();

  b.r.reduce(env('turn.start', 'S1', { title: 'Please verify the job history' }));
  assert.equal(b.out.find((e) => e.type === 'mail').job, 'Verify the job history');
});

test('a completed turn is a delivery; a failed one an error; anything else idle', () => {
  const b = bench();
  b.r.reduce(env('turn.end', 'S1', { status: 'completed', summary: 'Shipped' }));
  assert.equal(b.last().type, 'dispatch');
  assert.equal(b.last().summary, 'Shipped');

  b.r.reduce(env('turn.end', 'S1', { status: 'error' }));
  assert.deepEqual(b.last(), { type: 'status', id: `${HARNESS}:S1`, status: 'error' });

  b.r.reduce(env('turn.end', 'S1', { status: 'cancelled' }));
  assert.equal(b.last().status, 'idle');
});

test('a concise title learned at completion retitles the job already in history', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', {
    title: 'Can you make a todo list locally and check through it - as a test?',
  }));
  b.take();

  b.r.reduce(env('turn.end', 'S1', {
    status: 'completed', title: 'Local Todo List Test',
  }));
  assert.deepEqual(b.types(), ['rename', 'retitle', 'dispatch']);
  assert.deepEqual(
    b.out.find((e) => e.type === 'retitle'),
    {
      type: 'retitle', id: `${HARNESS}:S1`,
      from: 'Make a todo list locally and check through it - as a test',
      job: 'Local Todo List Test',
    },
  );
});

test('turn.title renames the job in hand without starting a second one', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', {
    turn_id: 'p1',
    title: 'Create a work item to "Make great movies" and then switch to the branch',
  }));
  b.take();

  b.r.reduce(env('turn.title', 'S1', {
    turn_id: 'p1', title: 'Cinematic office activity filming',
  }));

  // A rename and a retitle: no `mail`, because no second request arrived, and no
  // `status`, because the agent never stopped working on the one it had.
  assert.deepEqual(b.types(), ['rename', 'retitle']);
  assert.deepEqual(
    b.out.find((e) => e.type === 'retitle'),
    {
      type: 'retitle',
      id: `${HARNESS}:S1`,
      from: 'Create a work item to "Make great movies" and then switch to the branch',
      job: 'Cinematic office activity filming',
    },
  );
});

test('turn.title says nothing when it has nothing new to say', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Fix the flaky test' }));
  b.take();

  b.r.reduce(env('turn.title', 'S1', { title: 'Fix the flaky test' }));
  b.r.reduce(env('turn.title', 'S1', { title: '   ' }));
  assert.deepEqual(b.types(), []);
});

test('a turn.title the office never heard a turn.start for still names the desk', () => {
  // Hooks installed mid-turn, or a receiver that restarted: the upgrade is the first
  // thing this office hears about the work, and a name is better than none.
  const b = bench();
  b.r.reduce(env('session.start', 'S1', { source: 'startup' }));
  b.take();

  b.r.reduce(env('turn.title', 'S1', { title: 'Cinematic office activity filming' }));
  assert.deepEqual(b.types(), ['rename', 'retitle']);
  assert.equal(b.out.find((e) => e.type === 'retitle').job, 'Cinematic office activity filming');
});

// --- steps: one job, several parts ------------------------------------------

const KEY = `${HARNESS}:S1`;

test('no steps means one step: a plain turn reduces exactly as it always did', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Fix the flaky test' }));
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'edit' }));
  b.r.reduce(env('turn.end', 'S1', { status: 'completed', summary: 'Shipped' }));
  // The rule that matters most, because it is the case almost every turn is in:
  // steps must be invisible when nobody sent any. A stray `step: null` here would
  // be harmless on screen and still wrong — it is the office asserting something
  // about work it was told nothing about.
  assert.equal(b.types().filter((t) => t === 'step').length, 0);
  const mail = b.out.find((e) => e.type === 'mail');
  assert.equal(mail.plan, null, 'no checklist in the envelope either');
});

test('a plan travels inside the envelope, so it lands when the letter is opened', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', {
    title: 'Nightly sweep',
    plan: [{ id: 'a', title: 'Ingest mail' }, { id: 'b', title: 'File it' }],
  }));
  const mail = b.out.find((e) => e.type === 'mail');
  assert.equal(mail.plan.items.length, 2);
  assert.deepEqual(mail.plan.items.map((e) => e.status), ['pending', 'pending']);
  assert.equal(mail.plan.more, 0);
});

test('a step relabels the part in hand and ticks the plan behind it', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', {
    title: 'Nightly sweep',
    plan: [{ id: 'a', title: 'Ingest mail' }, { id: 'b', title: 'File it' }],
  }));
  b.take();

  b.r.reduce(env('step.start', 'S1', { step_id: 'a', title: 'Ingest mail', index: 1, of: 2 }));
  let s = b.last();
  assert.equal(s.type, 'step');
  assert.deepEqual(s.step, { id: 'a', title: 'Ingest mail', index: 1, of: 2 });
  assert.equal(s.plan.items[0].status, 'active');

  b.r.reduce(env('step.end', 'S1', { step_id: 'a', status: 'completed' }));
  s = b.last();
  assert.equal(s.step, null, 'nothing in hand between parts');
  assert.equal(s.plan.items[0].status, 'completed');
  assert.equal(s.plan.items[1].status, 'pending');
});

test('a step never starts a walk — it is a label, not a journey (§4.2 rule 5)', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Nightly sweep' }));
  b.take();
  for (let i = 1; i <= 5; i += 1) {
    b.r.reduce(env('step.start', 'S1', { step_id: `s${i}`, title: `Part ${i}`, index: i, of: 5 }));
    b.r.reduce(env('step.end', 'S1', { step_id: `s${i}` }));
  }
  b.tick(10_000);
  // Five parts, ten directions, and not one of them moves anybody: no status, no
  // research trip, no activity. This is the difference between a step and a tool.
  assert.deepEqual(new Set(b.types()), new Set(['step']));
});

test('the next step closes the last one, because harnesses announce better than they finish', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', {
    title: 'Nightly sweep',
    plan: [{ title: 'One' }, { title: 'Two' }],
  }));
  b.r.reduce(env('step.start', 'S1', { step_id: '1', title: 'One' }));
  b.take();
  b.r.reduce(env('step.start', 'S1', { step_id: '2', title: 'Two' }));   // no step.end for One
  const s = b.last();
  assert.equal(s.step.id, '2');
  assert.equal(s.plan.items[0].status, 'completed', 'the implicit close is the normal path');
  assert.equal(s.plan.items[1].status, 'active');
});

test('a step never outlives its turn, and the checklist goes with it', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Nightly sweep', plan: [{ title: 'One' }] }));
  b.r.reduce(env('step.start', 'S1', { step_id: '1', title: 'One' }));
  b.take();
  b.r.reduce(env('turn.end', 'S1', { status: 'completed' }));
  const [cleared, delivered] = b.take();
  assert.deepEqual(cleared, { type: 'step', id: KEY, step: null, plan: null });
  assert.equal(delivered.type, 'dispatch', 'the step is taken down before the walk to the mailbox');
});

test('a turn that errored fails the step it was on rather than ticking it', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Nightly sweep', plan: [{ title: 'One' }] }));
  b.r.reduce(env('step.start', 'S1', { step_id: '1', title: 'One' }));
  b.r.reduce(env('turn.end', 'S1', { status: 'error' }));
  // The plan is gone by now, so the assertion is about the record, not the wire:
  // a failed round must not leave a tick on the part it died in.
  assert.equal(b.r.sessions.get(KEY).plan, null);
  assert.equal(b.r.sessions.get(KEY).step, null);
});

test('a new turn clears a step left behind by a lost turn.end', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'First' }));
  b.r.reduce(env('step.start', 'S1', { step_id: '1', title: 'One' }));
  b.take();
  b.r.reduce(env('turn.start', 'S1', { title: 'Second' }));   // no turn.end ever arrived
  const step = b.out.find((e) => e.type === 'step');
  assert.deepEqual(step, { type: 'step', id: KEY, step: null, plan: null });
});

test('a plan restated on step.start wins, because that is when the agent writes it down', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Nightly sweep' }));   // no plan yet
  b.take();
  b.r.reduce(env('step.start', 'S1', {
    step_id: 'a', title: 'Ingest mail',
    plan: [{ title: 'Ingest mail' }, { title: 'File it' }, { title: 'Sweep' }],
  }));
  const s = b.last();
  assert.equal(s.plan.items.length, 3);
  assert.equal(s.plan.items[0].status, 'active');
  // Neither counter was sent, and both are known anyway: this is the case that makes
  // "2 of 5" work for a harness whose todo list is just titles and statuses.
  assert.equal(s.step.index, 1);
  assert.equal(s.step.of, 3, 'a plan with no index/of still knows how long it is');
});

test('a skipped entry stays on the list — a heartbeat with nothing to do is normal', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', {
    title: 'Nightly sweep',
    plan: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
  }));
  b.r.reduce(env('step.start', 'S1', { step_id: '2', title: 'Two' }));
  b.r.reduce(env('step.end', 'S1', { step_id: '2', status: 'skipped' }));
  b.r.reduce(env('step.start', 'S1', { step_id: '3', title: 'Three' }));
  const s = b.last();
  assert.deepEqual(s.plan.items.map((e) => e.status), ['pending', 'skipped', 'active']);
});

test('a plan is truncated, not dropped: the tail becomes a count', () => {
  const b = bench();
  const plan = Array.from({ length: 26 }, (_, i) => ({ title: `Item ${i + 1}` }));
  b.r.reduce(env('turn.start', 'S1', { title: 'Long one', plan }));
  const { plan: got } = b.out.find((e) => e.type === 'mail');
  assert.equal(got.items.length, 20);
  assert.equal(got.more, 6, 'a 200-item list still says something true');
});

test('a truncated plan still counts its tail: "2 of 26", not "2 of 20"', () => {
  const b = bench();
  const plan = Array.from({ length: 26 }, (_, i) => ({ title: `Item ${i + 1}` }));
  b.r.reduce(env('turn.start', 'S1', { title: 'Long one', plan }));
  b.r.reduce(env('step.start', 'S1', { step_id: 'x', title: 'Item 2' }));
  assert.deepEqual(
    { index: b.last().step.index, of: b.last().step.of }, { index: 2, of: 26 },
    'the office would otherwise shorten somebody\'s afternoon',
  );
});

test('a plan of bare strings is still a plan; junk in it is not counted', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', {
    title: 'Loose', plan: ['One', '  ', { nope: 1 }, 'Two', null],
  }));
  const { plan } = b.out.find((e) => e.type === 'mail');
  assert.deepEqual(plan.items.map((e) => e.title), ['One', 'Two']);
  assert.equal(plan.more, 0, 'the remainder counts entries we could read, not blanks');
});

test('a plan that is not a list, or has nothing legible in it, is no plan at all', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'x', plan: 'do the thing' }));
  assert.equal(b.out.find((e) => e.type === 'mail').plan, null);
  b.take();
  b.r.reduce(env('turn.start', 'S2', { title: 'y', plan: [null, '', { }] }));
  assert.equal(b.out.find((e) => e.type === 'mail').plan, null);
});

test('a step title is capped at 80 on this side too — the emitter only promised', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'x' }));
  b.r.reduce(env('step.start', 'S1', { step_id: 'a', title: 'z'.repeat(300) }));
  assert.equal(b.last().step.title.length, 80);
});

test('half a fraction is no fraction: index without of says neither', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'x' }));
  b.r.reduce(env('step.start', 'S1', { step_id: 'a', title: 'One', index: 2 }));
  const { step } = b.last();
  assert.equal(step.index, null, '"2 of" reads as a bug and a bare "2" reads as something else');
  assert.equal(step.of, null);
});

test('a step.end for something that never started marks the plan, not the open step', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'x', plan: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }));
  b.r.reduce(env('step.start', 'S1', { step_id: 'b', title: 'B' }));
  b.take();
  b.r.reduce(env('step.end', 'S1', { step_id: 'a', status: 'failed' }));
  const s = b.last();
  assert.equal(s.step.id, 'b', 'the open step is left alone');
  assert.deepEqual(s.plan.items.map((e) => e.status), ['failed', 'active']);
});

test('an unknown step.end status falls back to completed, per §11', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'x', plan: [{ title: 'A' }] }));
  b.r.reduce(env('step.start', 'S1', { step_id: 'a', title: 'A' }));
  b.r.reduce(env('step.end', 'S1', { step_id: 'a', status: 'exploded' }));
  assert.equal(b.last().plan.items[0].status, 'completed');
});

test('the plan handed out is a copy — nothing downstream can edit the reducer', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'x', plan: [{ title: 'A' }] }));
  const { plan } = b.out.find((e) => e.type === 'mail');
  plan.items[0].status = 'vandalised';
  b.r.reduce(env('step.start', 'S1', { step_id: 'a', title: 'A' }));
  assert.equal(b.last().plan.items[0].status, 'active');
});

test('normalisePlan is exported, because both a mapper and a panel need the same answer', () => {
  assert.equal(normalisePlan(null), null);
  assert.equal(normalisePlan([{ title: 'A', status: 'nonsense' }]).items[0].status, 'pending');
});

// --- the travel debounce -----------------------------------------------------

test('desk-class tools never leave the desk', () => {
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'edit' }));
  b.tick(TRAVEL_DEBOUNCE_MS * 3);
  assert.deepEqual(b.types().filter((t) => t !== 'spawn'), ['status']);
  assert.equal(b.last().status, 'working');
});

test('a long look-up is a bookshelf trip; the web is the globe', () => {
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'search', target: 'src/' }));
  b.tick(TRAVEL_DEBOUNCE_MS + 1);
  assert.equal(b.last().type, 'research');
  assert.equal(b.last().scope, 'graph');
  assert.equal(b.last().topic, 'src/');

  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't2', tool_class: 'network', target: 'https://x' }));
  b.tick(TRAVEL_DEBOUNCE_MS + 1);
  assert.equal(b.last().scope, 'web');
});

test('a search with no target still makes the trip, named by the tool', () => {
  // What the default redaction mode now sends for a search or a web fetch: the class and
  // no target, because the pattern is the model's own words. `tool_class` is what the
  // scene animates, so the trip must survive the missing field — an agent that froze
  // waiting for a label it is never going to get would be the fix breaking the product.
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_name: 'Grep', tool_class: 'search' }));
  b.tick(TRAVEL_DEBOUNCE_MS + 1);
  assert.equal(b.last().type, 'research');
  assert.equal(b.last().scope, 'graph');
  assert.equal(b.last().topic, 'Grep', 'the tool name is the fallback, and it is enough');

  // The same for a fetch, which keeps its host and so still names somewhere.
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't2', tool_name: 'WebFetch', tool_class: 'network', target: 'docs.example.com' }));
  b.tick(TRAVEL_DEBOUNCE_MS + 1);
  assert.equal(b.last().scope, 'web');
  assert.equal(b.last().topic, 'docs.example.com');
});

test('an 80ms grep never leaves the desk — the debounce is the whole point', () => {
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'search' }));
  b.tick(80);
  b.r.reduce(env('tool.end', 'S1', { tool_call_id: 't1', status: 'ok' }));
  b.tick(TRAVEL_DEBOUNCE_MS * 2);
  assert.equal(b.out.filter((e) => e.type === 'research').length, 0,
    'finished inside the debounce: never left the desk');
});

test('one call announced twice makes one trip, and its end still lands', () => {
  // The shape measured off an OpenClaw gateway: the same `tool_call_id` arriving at two
  // layers 55ms apart, ending in the reverse order. The stale debounce used to fire against
  // the replacement — a second journey for one call — and clear the timer the surviving
  // entry needed, after which the last `tool.end` was dropped as half a pair.
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'search', target: 'outer query' }));
  b.tick(55);
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'search', target: 'inner query' }));
  b.tick(TRAVEL_DEBOUNCE_MS + 1);

  const trips = b.out.filter((e) => e.type === 'research');
  assert.equal(trips.length, 1, 'one call, one trip');
  assert.equal(trips[0].topic, 'inner query', 'and the surviving start names it');

  // The inner end closes the call; the outer end has nothing left to say and says nothing.
  b.r.reduce(env('tool.end', 'S1', { tool_call_id: 't1', status: 'error' }));
  assert.equal(b.last().status, 'error', 'the end that matched was not swallowed');
  b.take();
  b.r.reduce(env('tool.end', 'S1', { tool_call_id: 't1', status: 'error' }));
  assert.deepEqual(b.take(), [], 'and the duplicate end changes nothing');
});

test('an 80ms call announced twice still never leaves the desk', () => {
  // The worst of it, and the invariant that says so: a stale debounce outlives the call it
  // belongs to, so the trip departed *after* the `tool.end` — for a call that took 80ms.
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'search', target: 'outer' }));
  b.tick(55);
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'search', target: 'inner' }));
  b.tick(25);
  b.r.reduce(env('tool.end', 'S1', { tool_call_id: 't1', status: 'ok' }));
  b.tick(TRAVEL_DEBOUNCE_MS * 2);

  assert.equal(b.out.filter((e) => e.type === 'research').length, 0,
    'finished inside the debounce, twice over: never left the desk');
});

test('a duplicate start inside the debounce does not strand the call at the desk', () => {
  // The other half of the same bug: both starts land inside 400ms, so if the first timer
  // is cancelled without arming a replacement, the trip never happens at all.
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'network', target: 'https://x' }));
  b.tick(50);
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'network', target: 'https://x' }));
  b.tick(TRAVEL_DEBOUNCE_MS + 1);
  assert.equal(b.out.filter((e) => e.type === 'research').length, 1);
  assert.equal(b.last().scope, 'web');
});

test('scm is delivering, and wait is the couch', () => {
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'scm' }));
  b.tick(TRAVEL_DEBOUNCE_MS + 1);
  assert.deepEqual(b.last(), { type: 'status', id: `${HARNESS}:S1`, status: 'delivering' });

  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't2', tool_class: 'wait' }));
  b.tick(TRAVEL_DEBOUNCE_MS + 1);
  assert.deepEqual(b.last(), { type: 'activity', id: `${HARNESS}:S1`, activity: 'couch' });
});

test('a failed tool call reports error; an unmatched tool.end is ignored', () => {
  const b = bench();
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'execute' }));
  b.r.reduce(env('tool.end', 'S1', { tool_call_id: 't1', status: 'error' }));
  assert.equal(b.last().status, 'error');

  const before = b.out.length;
  b.r.reduce(env('tool.end', 'S1', { tool_call_id: 'never-started', status: 'error' }));
  assert.equal(b.out.length, before, 'half a pair must not flicker the room');
});

// --- waiting on a human ------------------------------------------------------

test('permission gates: request waits, resolve resumes, and waiting mutes travel', () => {
  const b = bench();
  b.r.reduce(env('permission.request', 'S1', { request_id: 'r1' }));
  assert.equal(b.last().status, 'waiting');

  // A travel-class call finishing its debounce while waiting must not move anyone.
  b.r.reduce(env('tool.start', 'S1', { tool_call_id: 't1', tool_class: 'search' }));
  b.tick(TRAVEL_DEBOUNCE_MS + 1);
  assert.equal(b.out.filter((e) => e.type === 'research').length, 0);

  b.r.reduce(env('permission.resolve', 'S1', { request_id: 'r1', decision: 'allow' }));
  assert.equal(b.last().status, 'working');
});

test('only warn and error notifications interrupt anybody', () => {
  const b = bench();
  b.r.reduce(env('notification', 'S1', { message: 'fyi', level: 'info' }));
  assert.deepEqual(b.types().filter((t) => t === 'status'), []);
  b.r.reduce(env('notification', 'S1', { message: 'look!', level: 'error' }));
  assert.equal(b.last().status, 'waiting');
});

// --- lifecycle ---------------------------------------------------------------

test('session.end walks them out; a compaction is a water-cooler trip', () => {
  const b = bench();
  b.r.reduce(env('session.start', 'S1'));
  b.r.reduce(env('context.compact', 'S1', { trigger: 'auto' }));
  assert.deepEqual(b.last(), { type: 'activity', id: `${HARNESS}:S1`, activity: 'water' });

  b.r.reduce(env('session.end', 'S1'));
  assert.equal(b.last().type, 'exit');
  assert.equal(b.r.sessions.size, 0);
});

test('job.queued is unaddressed post — first to the box wins it', () => {
  const b = bench();
  b.r.reduce(env('job.queued', 'S1', { title: 'Queued ticket' }));
  const mail = b.out.find((e) => e.type === 'mail');
  assert.equal(mail.job, 'Queued ticket');
  assert.equal(mail.forId, undefined, 'queued work is nobody\'s yet');
});

// --- reaping -----------------------------------------------------------------

test('a silent session is reaped on the short leash', () => {
  const b = bench();
  b.r.reduce(env('session.start', 'S1'));
  b.tick(SESSION_TTL_MS + 1);
  b.r.reap();
  assert.equal(b.last().type, 'exit');
});

test('a session that promised to say goodbye keeps the long leash', () => {
  const b = bench();
  b.r.reduce(env('session.start', 'S1', { capabilities: ['session.start', 'session.end'] }));
  b.tick(SESSION_TTL_MS + 1);
  b.r.reap();
  assert.equal(b.r.sessions.size, 1, 'the promise is worth trusting');
  b.tick(FAREWELL_TTL_MS);
  b.r.reap();
  assert.equal(b.last().type, 'exit', 'but a crash backstop still exists');
});

test('a heartbeat is enough to stay', () => {
  const b = bench();
  b.r.reduce(env('session.start', 'S1'));
  b.tick(SESSION_TTL_MS - 1000);
  b.r.reduce(env('session.heartbeat', 'S1'));
  b.tick(SESSION_TTL_MS - 1000);
  b.r.reap();
  assert.equal(b.r.sessions.size, 1);
});

// --- naming ------------------------------------------------------------------

test('a new job re-surnames the session; the first name survives', () => {
  const b = bench();
  b.r.reduce(env('turn.start', 'S1', { title: 'Refactor the auth layer' }));
  const spawn = b.out.find((e) => e.type === 'spawn');
  const rename = b.out.find((e) => e.type === 'rename');
  if (rename) {
    const first = (n) => n.split(' ')[0];
    assert.equal(first(rename.name), first(spawn.name),
      'the person underneath never changes');
  }
});

// --- avatars -----------------------------------------------------------------

test('safeAvatar refuses everything that could become a decision', () => {
  assert.equal(safeAvatar('javascript:alert(1)'), null);
  assert.equal(safeAvatar('data:text/html,x'), null);
  assert.equal(safeAvatar('//evil.example/x.png'), null);
  assert.equal(safeAvatar('/office/K7F2/avatar/1.png'), '/office/K7F2/avatar/1.png');
  assert.equal(safeAvatar('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(safeAvatar('x'.repeat(600)), null);
});
