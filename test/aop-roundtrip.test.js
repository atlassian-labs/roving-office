// Emitter and reducer, in one breath: hook payloads in one end, stage directions out
// the other.
//
// Both halves are thoroughly tested apart, and that is exactly the gap. The mapper's
// tests assert what it *emits* and the reducer's tests assert what it does with events
// a test wrote by hand — so a field one side renames, or a shape one side assumes, is
// invisible to both. This is the only place the two contracts are checked against each
// other rather than against a fixture.
//
// Steps are the reason it exists: `plan` crosses the wire as an array and arrives as
// `{ items, more }`, `index`/`of` are derived on one side from a list numbered on the
// other, and a skipped part is inferred by the emitter and rendered by the receiver.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createAopReducer } from '../src/data/aop-reducer.js';

const require = createRequire(import.meta.url);
const mapper = require('../bin/mappers/claude-code.cjs');
const { MAPPER_HELPERS: helpers } = require('../bin/lib/aop-core.cjs');

const HARNESS = 'claude-code';
const SESSION = 'sess-1';
const KEY = `${HARNESS}:${SESSION}`;

/**
 * A mapper and a reducer wired nose to tail, driven by hook name and payload.
 *
 * `title` stands in for Claude's generated session title, which the real mapper reads
 * out of a transcript this test has no reason to write. A function, because the whole
 * point of it is that it is absent when the turn opens and present a moment later.
 */
function chain({ redaction = 'summary', title = () => null } = {}) {
  const state = { sessions: {} };
  const out = [];
  let n = 0;
  const reducer = createAopReducer({
    harness: HARNESS,
    emit: (ev) => out.push(ev),
    schedule: () => 0,
    cancel: () => {},
    loadColourNames: () => new Promise(() => {}),
  });

  return {
    out,
    fire(event, payload) {
      const events = mapper.map({
        event, payload, state, redaction, helpers, endpointId: 'ep', readTitle: title,
      });
      for (const ev of events) {
        n += 1;
        reducer.reduce({ ...ev, aop: '0.1', harness: { name: HARNESS }, id: `e${n}` });
      }
      return events;
    },
    steps: () => out.filter((e) => e.type === 'step'),
    take() { const copy = [...out]; out.length = 0; return copy; },
  };
}

const prompt = (text) => ({ session_id: SESSION, cwd: '/w', prompt: text });
let calls = 0;
const todoWrite = (todos) => ({
  session_id: SESSION, cwd: '/w', tool_name: 'TodoWrite',
  tool_use_id: `c${(calls += 1)}`, tool_input: { todos },
});
const todo = (content, status, activeForm) => ({ content, status, activeForm });

test('a title generated after the prompt renames the job, end to end', () => {
  // The shape of a real session: Claude has no title when the prompt hook fires, and
  // has written one by the time the first tool call does.
  let generated = null;
  const c = chain({ title: () => generated });

  c.fire('UserPromptSubmit', prompt(
    'Create a work item to "Make great movies" and then switch to the branch',
  ));
  assert.equal(
    c.out.find((e) => e.type === 'mail').job,
    'Create a work item to "Make great movies" and then switch to the branch',
  );

  c.take();
  generated = 'Cinematic office activity filming';
  c.fire('PreToolUse', {
    session_id: SESSION, cwd: '/w', transcript_path: '/w/t.jsonl',
    tool_name: 'Read', tool_use_id: 'r1', tool_input: { file_path: '/w/a.js' },
  });

  // One rename of the work in hand, and the desk label with it. No second envelope:
  // the request did not arrive twice just because it now has a shorter name.
  const retitle = c.out.find((e) => e.type === 'retitle');
  assert.equal(retitle.from, 'Create a work item to "Make great movies" and then switch to the branch');
  assert.equal(retitle.job, 'Cinematic office activity filming');
  assert.deepEqual(c.out.filter((e) => e.type === 'mail'), []);

  // And the surname follows the job across the wire, which is the whole visible point.
  const rename = c.out.find((e) => e.type === 'rename');
  assert.ok(rename, 'the office re-surnames whoever is doing the work');
});

test('a todo list walked end to end arrives as parts of one round', () => {
  const c = chain();
  c.fire('UserPromptSubmit', prompt('Run the nightly data sweep'));

  const mail = c.out.find((e) => e.type === 'mail');
  assert.equal(mail.job, 'Run the nightly data sweep');
  // The checklist is not in the envelope, and that is correct rather than a miss: the
  // agent writes its list *after* the prompt, so the office learns it at the first
  // part instead. Spec §4.2 rule 4 is what makes that legal.
  assert.equal(mail.plan, null);

  c.take();
  c.fire('PostToolUse', todoWrite([
    todo('Collect the exports', 'in_progress', 'Collecting the exports'),
    todo('Check the counts', 'pending'),
    todo('Post the summary', 'pending'),
  ]));

  const [first] = c.steps();
  // Derived, not sent: TodoWrite numbers nothing, and the plan is where the position
  // and the length both come from.
  assert.deepEqual(
    { title: first.step.title, index: first.step.index, of: first.step.of },
    { title: 'Collecting the exports', index: 1, of: 3 },
  );
  assert.deepEqual(first.plan.items.map((e) => e.status), ['active', 'pending', 'pending']);
  assert.equal(first.plan.more, 0);
});

test('a part passed over is inferred by the emitter and drawn by the receiver', () => {
  const c = chain();
  c.fire('UserPromptSubmit', prompt('Sweep'));
  c.fire('PostToolUse', todoWrite([
    todo('One', 'in_progress'), todo('Two', 'pending'), todo('Three', 'pending'),
  ]));
  c.take();

  // Nobody says "skipped" anywhere. The emitter reads it off the next list, the wire
  // carries it as a status, and the receiver puts it on the checklist — three steps,
  // no shared code, and this is the assertion that they agree.
  c.fire('PostToolUse', todoWrite([
    todo('One', 'pending'), todo('Two', 'pending'), todo('Three', 'in_progress'),
  ]));

  const last = c.steps().pop();
  assert.deepEqual(last.plan.items.map((e) => e.status), ['skipped', 'pending', 'active']);
  assert.equal(last.step.index, 3);
});

test('the last part is closed on the wire, then the checklist is taken down', () => {
  const c = chain();
  c.fire('UserPromptSubmit', prompt('Sweep'));
  const opened = c.fire('PostToolUse', todoWrite([
    todo('One', 'in_progress'), todo('Two', 'pending'),
  ]));
  const openedId = opened.find((e) => e.type === 'step.start').payload.step_id;
  c.take();

  // Nothing rewrites the list after the last part, so `Stop` is the only place that
  // part's end can come from — and it once came from nowhere. The receiver
  // cleared the label at `turn.end` regardless, so the office looked right while the
  // wire lost the part: one live session carried 192 events, a single `step.start`
  // and not one `step.end`.
  const wire = c.fire('Stop', { session_id: SESSION, cwd: '/w' });
  const ends = wire.filter((e) => e.type === 'step.end');
  assert.equal(ends.length, 1, 'the open part is closed exactly once');
  assert.equal(ends[0].payload.step_id, openedId);
  assert.equal(ends[0].payload.status, 'completed');
  assert.ok(
    wire.indexOf(ends[0]) < wire.findIndex((e) => e.type === 'turn.end'),
    'the part ends inside the turn, so it ends first',
  );

  // Which the office reads as two beats: the part closing with One ticked, and then
  // the whole checklist coming down as the round is delivered.
  const steps = c.steps();
  assert.equal(steps[0].step, null);
  assert.deepEqual(steps[0].plan.items.map((e) => e.status), ['completed', 'pending']);
  assert.deepEqual(steps.at(-1), { type: 'step', id: KEY, step: null, plan: null });

  const types = c.out.map((e) => e.type);
  assert.ok(types.lastIndexOf('step') < types.indexOf('dispatch'));
});

test('a second turn inherits nothing from the first', () => {
  const c = chain();
  c.fire('UserPromptSubmit', prompt('First'));
  c.fire('PostToolUse', todoWrite([todo('One', 'in_progress'), todo('Two', 'pending')]));
  // One is passed over rather than finished, so the emitter remembers it as skipped —
  // it has to, because every later write puts it back at `pending` (see `stepEvents`).
  c.fire('PostToolUse', todoWrite([
    todo('One', 'pending'), todo('Two', 'in_progress'),
  ]));
  c.fire('Stop', { session_id: SESSION, cwd: '/w' });
  c.take();

  // That memory belongs to the list it was inferred from. Held per *session* it
  // outlived the turn, and the next turn's first write inherited a verdict on work
  // that had not happened yet.
  c.fire('UserPromptSubmit', prompt('Second'));
  const wire = c.fire('PostToolUse', todoWrite([
    todo('One', 'pending'), todo('Two', 'in_progress'),
  ]));

  assert.deepEqual(
    wire.filter((e) => e.type.startsWith('step.')).map((e) => e.type),
    ['step.start'],
    'nothing to close: the previous turn closed its own part',
  );
  const [start] = wire.filter((e) => e.type === 'step.start');
  assert.deepEqual(
    start.payload.plan.map((e) => e.status),
    ['pending', 'active'],
    'One is pending in this turn, not skipped in the last one',
  );
});

test('at metadata the whole chain says "Step 2 of 3" and not one word more', () => {
  const c = chain({ redaction: 'metadata' });
  c.fire('UserPromptSubmit', prompt('Something private'));
  assert.equal(c.out.find((e) => e.type === 'mail').job, 'Working');
  c.take();

  c.fire('PostToolUse', todoWrite([
    todo('Read the private file', 'completed'),
    todo('Summarise the private file', 'in_progress', 'Summarising the private file'),
    todo('Delete it', 'pending'),
  ]));

  const [step] = c.steps();
  assert.equal(step.step.title, null, 'a todo item is a sentence the model wrote');
  assert.equal(step.plan, null);
  assert.deepEqual([step.step.index, step.step.of], [2, 3]);
});

test('a turn with no todo list produces no step directions at all', () => {
  const c = chain();
  c.fire('UserPromptSubmit', prompt('Fix the flaky test'));
  c.fire('PreToolUse', {
    session_id: SESSION, cwd: '/w', tool_name: 'Edit', tool_use_id: 'e1',
    tool_input: { file_path: '/w/a.js' },
  });
  c.fire('PostToolUse', {
    session_id: SESSION, cwd: '/w', tool_name: 'Edit', tool_use_id: 'e1',
    tool_input: { file_path: '/w/a.js' },
  });
  c.fire('Stop', { session_id: SESSION, cwd: '/w' });

  // The rule the whole feature has to survive: no steps means one step, and a turn
  // that sent none must reduce to exactly what it did before any of this existed.
  assert.equal(c.steps().length, 0);
});
