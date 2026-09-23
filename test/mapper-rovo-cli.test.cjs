// Rovo CLI hook payloads → AOP events, against fixtures shaped like the payloads
// the mapper's header documents (verified against 202608.25.1) — including the
// batched array shapes and the flat fallbacks the shape recorder caught live.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mapper = require('../bin/mappers/rovo-cli.cjs');
const { MAPPER_HELPERS: helpers } = require('../bin/lib/aop-core.cjs');
const { driver } = require('./lib/mapper.cjs');

const fire = driver(mapper);

const SESSION = 'b2b5e280-e87c-41ed-9189-da867a77c3e1';
const CWD = '/work/repo';
const base = (attributes = {}) => ({
  session_id: SESSION,
  transcript_path: '/var/folders/x/message_history.json',
  cwd: CWD,
  timestamp: '2026-08-26T13:40:08.084525+00:00',
  attributes,
});

test('on_session_start introduces the session, capabilities and all', () => {
  const state = { sessions: {} };
  const out = fire(state, 'on_session_start', base());
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'session.start');
  assert.equal(out[0].payload.source, 'startup');
  assert.deepEqual(out[0].payload.capabilities, mapper.CAPABILITIES);
  assert.equal(out[0].payload.transcript, true);
});

test('the first hook to arrive introduces the session, whatever it is', () => {
  // A receiver installed mid-session first hears a prompt, never on_session_start.
  const state = { sessions: {} };
  const out = fire(state, 'on_user_prompt', base({ user_prompt: 'Sort the backlog' }));
  assert.deepEqual(out.map((e) => e.type), ['session.start', 'turn.start']);
  assert.equal(out[0].payload.source, 'attach', 'not startup: we joined late');
  assert.equal(out[1].payload.title, 'Sort the backlog');
});

test('the flat prompt key is read as well as the documented one', () => {
  const state = { sessions: {} };
  const out = fire(state, 'on_user_prompt', base({ prompt: 'Flat shape' }));
  assert.equal(out.find((e) => e.type === 'turn.start').payload.title, 'Flat shape');
});

test('Rovo\'s generated session title beats a direct quote of the prompt', () => {
  const state = { sessions: {} };
  const out = fire(state, 'on_user_prompt', base({
    user_prompt: 'Can you make a todo list locally and check through it - as a test?',
  }), { sessionTitle: 'Local Todo List Test' });
  assert.equal(out.find((e) => e.type === 'turn.start').payload.title, 'Local Todo List Test');
});

test('the generated title is read from Rovo session metadata, safely and best-effort', () => {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rovo-title-'));
  try {
    const dir = path.join(sessionsDir, SESSION);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ title: 'Local Todo List Test' }));
    assert.equal(mapper.readSessionTitle(SESSION, helpers, sessionsDir), 'Local Todo List Test');
    assert.equal(mapper.readSessionTitle('../elsewhere', helpers, sessionsDir), null);
    assert.equal(mapper.readSessionTitle('missing', helpers, sessionsDir), null);
  } finally {
    fs.rmSync(sessionsDir, { recursive: true, force: true });
  }
});

test('metadata mode keeps the prompt off the desk label', () => {
  const state = { sessions: {} };
  const out = fire(state, 'on_user_prompt', base({ user_prompt: 'private words' }), { redaction: 'metadata' });
  const turn = out.find((e) => e.type === 'turn.start');
  assert.equal(turn.payload.title, 'Working');
  assert.equal(turn.payload.prompt, undefined);
  assert.equal(turn.payload.prompt_chars, 'private words'.length);
});

test('a batched on_tool_start fans out, each call flagged concurrent', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  const out = fire(state, 'on_tool_start', base({
    tool_calls: [
      { tool_name: 'open_files', tool_call_id: 'c1', tool_args: { file_paths: [`${CWD}/a.js`] } },
      { tool_name: 'grep', tool_call_id: 'c2', tool_args: { pattern: 'foo' } },
    ],
  }));

  const tools = out.filter((e) => e.type === 'tool.start');
  assert.equal(tools.length, 2);
  assert.equal(tools[0].payload.tool_class, 'read');
  assert.equal(tools[0].payload.target, 'a.js');
  assert.equal(tools[0].payload.concurrent, true);
  assert.equal(tools[1].payload.tool_class, 'search');
  // Tool activity with no prompt seen still opens a turn — the safety net.
  assert.ok(out.some((e) => e.type === 'turn.start'));
});

test('a single call in the batch is not marked concurrent', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  const out = fire(state, 'on_tool_start', base({
    tool_calls: [{ tool_name: 'bash', tool_call_id: 'c1', tool_args: { command: 'ls' } }],
  }));
  assert.equal(out.find((e) => e.type === 'tool.start').payload.concurrent, undefined);
});

test('the flat single-call shape still works', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  const out = fire(state, 'on_tool_start', base({
    tool_name: 'create_file', tool_call_id: 'c9', args: { file_path: `${CWD}/new.js` },
  }));
  const tool = out.find((e) => e.type === 'tool.start');
  assert.equal(tool.payload.tool_class, 'edit');
  assert.equal(tool.payload.target, 'new.js');
});

test('on_tool_end closes calls by id, with class and duration from state', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  fire(state, 'on_tool_start', base({
    tool_calls: [{ tool_name: 'grep', tool_call_id: 'c1', tool_args: { pattern: 'x' } }],
  }));
  const out = fire(state, 'on_tool_end', base({
    tool_results: [{ tool_name: 'grep', tool_call_id: 'c1' }],
  }));
  const end = out.find((e) => e.type === 'tool.end');
  assert.equal(end.payload.tool_call_id, 'c1');
  assert.equal(end.payload.tool_class, 'search');
  assert.equal(end.payload.status, 'ok');
  assert.equal(typeof end.payload.duration_ms, 'number');
});

test('an end with no id closes the most recent open call', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  fire(state, 'on_tool_start', base({
    tool_calls: [{ tool_name: 'bash', tool_call_id: 'only', tool_args: { command: 'make' } }],
  }));
  const out = fire(state, 'on_tool_end', base({}));
  assert.equal(out.find((e) => e.type === 'tool.end').payload.tool_call_id, 'only');
});

test('a fan-out to named subagents stands in synthetic ghosts, then dissolves them', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  const started = fire(state, 'on_tool_start', base({
    tool_calls: [{
      tool_name: 'invoke_subagents', tool_call_id: 'fan1',
      tool_args: { subagent_names: ['reviewer', 'tester'] },
    }],
  }));

  const ghosts = started.filter((e) => e.type === 'session.start' && e.session.kind === 'subagent');
  assert.equal(ghosts.length, 2);
  for (const g of ghosts) {
    assert.equal(g.ext?.synthetic, true, 'a guess must render more faintly than the truth');
    assert.equal(g.session.parent_id, SESSION);
    assert.equal(g.payload.parent_tool_call_id, 'fan1');
  }

  const ended = fire(state, 'on_tool_end', base({ tool_results: [{ tool_call_id: 'fan1' }] }));
  const dissolved = ended.filter((e) => e.type === 'session.end' && e.session.kind === 'subagent');
  assert.equal(dissolved.length, 2, 'every ghost dissolves with the call that conjured it');
});

test('on_complete ends the turn; on_error reports and ends it', () => {
  const state = { sessions: {} };
  fire(state, 'on_user_prompt', base({ user_prompt: 'Task' }));
  const done = fire(state, 'on_complete', base({ summary: 'Shipped it' }));
  assert.deepEqual(done.map((e) => e.type), ['turn.end']);
  assert.equal(done[0].payload.summary, 'Shipped it');

  fire(state, 'on_user_prompt', base({ user_prompt: 'Task two' }));
  const errored = fire(state, 'on_error', base({ error: 'It broke' }));
  assert.deepEqual(errored.map((e) => e.type), ['error', 'turn.end']);
  assert.equal(errored[0].payload.message, 'It broke');
  assert.equal(errored[1].payload.status, 'error');
});

test('a title generated after the prompt travels on completion for task history', () => {
  const state = { sessions: {} };
  fire(state, 'on_user_prompt', base({ user_prompt: 'Try it locally' }));
  const [done] = fire(state, 'on_complete', base(), { sessionTitle: 'Local Todo List Test' });
  assert.equal(done.payload.title, 'Local Todo List Test');
});

test('a new receiver is re-introduced, and hears the turn in flight again', () => {
  const state = { sessions: {} };
  fire(state, 'on_user_prompt', base({ user_prompt: 'Long task' }), { endpointId: 'ep-1' });
  const out = fire(state, 'on_tool_start', base({
    tool_calls: [{ tool_name: 'grep', tool_call_id: 'g1', tool_args: { pattern: 'x' } }],
  }), { endpointId: 'ep-2' });

  assert.deepEqual(out.map((e) => e.type), ['session.start', 'turn.start', 'tool.start']);
  assert.equal(out[1].payload.title, 'Long task');
});

test('on_session_end says goodbye; an unknown hook is a heartbeat', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  const ended = fire(state, 'on_session_end', base());
  assert.deepEqual(ended.map((e) => e.type), ['session.end']);

  const state2 = { sessions: {} };
  fire(state2, 'on_session_start', base());
  const odd = fire(state2, 'on_future_event', base());
  assert.deepEqual(odd.map((e) => e.type), ['session.heartbeat']);
});

test('a payload with no session id maps to nothing at all', () => {
  const state = { sessions: {} };
  assert.deepEqual(fire(state, 'on_user_prompt', { attributes: { user_prompt: 'x' } }), []);
});

// --- todo lists become steps -------------------------------------------------
//
// `update_todo` used to be classed `other` and discarded. It is this harness's only
// statement that a turn has parts, and the office was throwing it away.

/** An `on_tool_start` for update_todo, which is where Rovo's arguments live. */
const updateTodo = (todos, id = 'c-todo', args = {}) => base({
  tool_calls: [{ tool_name: 'update_todo', tool_call_id: id, tool_args: { ...args, todos } }],
});

/** The same, with the harness's merge flag set: a patch by id, not a list. */
const mergeTodo = (todos, id = 'c-merge') => updateTodo(todos, id, { merge: true });

const todo = (content, status, extra = {}) => ({ content, status, ...extra });

test('update_todo opens a step and carries the plan', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  const out = fire(state, 'on_tool_start', updateTodo([
    todo('Read the spec', 'completed', { id: '1', active_form: 'Reading the spec' }),
    todo('Write the reducer', 'in_progress', { id: '2', active_form: 'Writing the reducer' }),
    todo('Wire the panels', 'pending', { id: '3', active_form: 'Wiring the panels' }),
  ]));

  const step = out.find((e) => e.type === 'step.start');
  assert.ok(step);
  assert.equal(step.payload.title, 'Writing the reducer');
  assert.deepEqual([step.payload.index, step.payload.of], [2, 3]);
  // Rovo's todos carry their own ids, so no hashing is needed here.
  assert.equal(step.payload.step_id, '2');
  assert.deepEqual(step.payload.plan.map((e) => e.status), ['completed', 'active', 'pending']);
  // Emitted alongside the tool.start, not instead of it: it is still a tool call.
  assert.ok(out.some((e) => e.type === 'tool.start'));
});

test('the part in hand is closed when the next one opens', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  fire(state, 'on_tool_start', updateTodo([
    todo('One', 'in_progress', { id: '1' }), todo('Two', 'pending', { id: '2' }),
  ]));
  const out = fire(state, 'on_tool_start', updateTodo([
    todo('One', 'completed', { id: '1' }), todo('Two', 'in_progress', { id: '2' }),
  ], 'c-todo-2'));

  const end = out.find((e) => e.type === 'step.end');
  assert.equal(end.payload.step_id, '1');
  assert.equal(end.payload.status, 'completed');
  assert.equal(out.find((e) => e.type === 'step.start').payload.step_id, '2');
});

test('a part left pending was skipped', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  fire(state, 'on_tool_start', updateTodo([
    todo('One', 'in_progress', { id: '1' }), todo('Two', 'pending', { id: '2' }),
  ]));
  const out = fire(state, 'on_tool_start', updateTodo([
    todo('One', 'pending', { id: '1' }), todo('Two', 'in_progress', { id: '2' }),
  ], 'c-todo-2'));
  assert.equal(out.find((e) => e.type === 'step.end').payload.status, 'skipped');
});

test('at metadata the shape survives and the sentences do not', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base(), { redaction: 'metadata' });
  const out = fire(state, 'on_tool_start', updateTodo([
    todo('Read the spec', 'in_progress', { id: '1', active_form: 'Reading the spec' }),
  ]), { redaction: 'metadata' });
  const step = out.find((e) => e.type === 'step.start');
  assert.equal(step.payload.title, undefined);
  assert.equal(step.payload.plan, undefined);
  assert.equal(step.payload.of, 1);
});

test('a batch containing update_todo still reports every tool call', () => {
  const state = { sessions: {} };
  fire(state, 'on_session_start', base());
  const out = fire(state, 'on_tool_start', base({
    tool_calls: [
      { tool_name: 'update_todo', tool_call_id: 'c1', tool_args: { todos: [todo('One', 'in_progress', { id: '1' })] } },
      { tool_name: 'grep', tool_call_id: 'c2', tool_args: { pattern: 'foo' } },
    ],
  }));
  assert.equal(out.filter((e) => e.type === 'tool.start').length, 2);
  assert.equal(out.filter((e) => e.type === 'step.start').length, 1);
});

test('step.start and step.end are declared as capabilities', () => {
  assert.ok(mapper.CAPABILITIES.includes('step.start'));
  assert.ok(mapper.CAPABILITIES.includes('step.end'));
});

// --- `merge: true`, where the update is a patch and not the list ------------------
//
// Rovo's `update_todo` takes a merge flag, and with it an update carries only the items
// that changed and only the fields that changed. Read as a whole list — which is what a
// mapper written against Claude's `TodoWrite` does — an ids-only merge is silent, the
// checklist shrinks to the size of the batch, and the item just ticked off looks like an
// item deleted. All three were live; each has a test here.

/** Rovo numbers its todo items, so ids arrive as integers. */
const item = (id, status, content, activeForm) => ({
  id,
  status,
  ...(content === undefined ? {} : { content }),
  ...(activeForm === undefined ? {} : { active_form: activeForm }),
});

const opened = (state) => {
  fire(state, 'on_session_start', base());
  fire(state, 'on_user_prompt', base({ user_prompt: 'Walk a checklist' }));
  return fire(state, 'on_tool_start', updateTodo([
    item(1, 'in_progress', 'Read the mapper', 'Reading the mapper'),
    item(2, 'pending', 'Fix the merge case', 'Fixing the merge case'),
    item(3, 'pending', 'Document it', 'Documenting it'),
  ], 'c-open'));
};

test('a merge carrying only ids and statuses still moves the part on', () => {
  const state = { sessions: {} };
  opened(state);
  // The whole update: two ids, two statuses, not a word of text.
  const out = fire(state, 'on_tool_start', mergeTodo([
    item(1, 'completed'), item(2, 'in_progress'),
  ]));

  const end = out.find((e) => e.type === 'step.end');
  const start = out.find((e) => e.type === 'step.start');
  assert.equal(end?.payload.step_id, '1', 'the part in hand was closed');
  assert.equal(end.payload.status, 'completed');
  assert.equal(start?.payload.step_id, '2');
  // Remembered from the opening list: a merge that omits the wording has not lost it.
  assert.equal(start.payload.title, 'Fixing the merge case');
});

test('a merge keeps the whole checklist, and its length', () => {
  const state = { sessions: {} };
  opened(state);
  const out = fire(state, 'on_tool_start', mergeTodo([
    item(1, 'completed'), item(2, 'in_progress'),
  ]));
  const step = out.find((e) => e.type === 'step.start');
  assert.deepEqual([step.payload.index, step.payload.of], [2, 3], 'three parts, not two');
  assert.deepEqual(step.payload.plan.map((e) => e.title), [
    'Read the mapper', 'Fix the merge case', 'Document it',
  ]);
  assert.deepEqual(step.payload.plan.map((e) => e.status), ['completed', 'active', 'pending']);
});

test('a merge does not cancel the item it has just ticked off', () => {
  const state = { sessions: {} };
  opened(state);
  fire(state, 'on_tool_start', mergeTodo([item(1, 'completed'), item(2, 'in_progress')]));
  // The next merge does not mention part 1 at all, which under a merge means unchanged.
  const out = fire(state, 'on_tool_start', mergeTodo([
    item(2, 'completed'), item(3, 'in_progress'),
  ], 'c-merge-2'));
  const step = out.find((e) => e.type === 'step.start');
  assert.equal(step.payload.plan[0].status, 'completed', 'still done, not struck through');
  assert.deepEqual(step.payload.plan.map((e) => e.status), ['completed', 'completed', 'active']);
});

test('a replacement can still drop a part, and that is a cancellation', () => {
  const state = { sessions: {} };
  opened(state);
  // No merge flag: this *is* the list now, and part 1 is not in it.
  const out = fire(state, 'on_tool_start', updateTodo([
    item(2, 'in_progress', 'Fix the merge case', 'Fixing the merge case'),
  ], 'c-replace'));
  const end = out.find((e) => e.type === 'step.end');
  assert.equal(end.payload.status, 'cancelled');
  assert.equal(out.find((e) => e.type === 'step.start').payload.of, 1);
});

test('an integer id is the id, so rewording an item does not lose the part', () => {
  const state = { sessions: {} };
  opened(state);
  const step = fire(state, 'on_tool_start', updateTodo([
    // Same list, same ids, part 1 reworded as agents do mid-turn.
    item(1, 'in_progress', 'Read the mapper header', 'Reading the mapper header'),
    item(2, 'pending', 'Fix the merge case', 'Fixing the merge case'),
    item(3, 'pending', 'Document it', 'Documenting it'),
  ], 'c-reword')).find((e) => e.type === 'step.start');
  // Hashed ids would make this a different part: one cancelled, another started.
  assert.equal(step, undefined, 'the part in hand is the same part');
  assert.equal(state.sessions[SESSION].todo.activeId, '1');
});

test('an empty update leaves the list where it was', () => {
  const state = { sessions: {} };
  opened(state);
  const out = fire(state, 'on_tool_start', mergeTodo([], 'c-empty'));
  assert.deepEqual(out.filter((e) => e.type.startsWith('step.')), []);
  assert.equal(state.sessions[SESSION].todo.list.length, 3, 'the three parts are still held');
});

test('a part a merge introduces without naming is counted, not drawn', () => {
  const state = { sessions: {} };
  opened(state);
  const step = fire(state, 'on_tool_start', mergeTodo([
    item(1, 'completed'), item(4, 'in_progress'),
  ])).find((e) => e.type === 'step.start');
  assert.equal(step.payload.of, 4, 'four parts now');
  assert.equal(step.payload.title, undefined, 'nothing honest to call it');
  assert.equal(step.payload.plan.length, 3, 'and nothing to draw on its row');
});

test('the held list does not cross a turn boundary', () => {
  const state = { sessions: {} };
  opened(state);
  fire(state, 'on_complete', base({ summary: 'done' }));
  // A new turn, and Rovo's ids start again at 1 — so a list carried over would let
  // this update land on the last turn's parts.
  const out = fire(state, 'on_user_prompt', base({ user_prompt: 'Something else' }));
  assert.deepEqual(state.sessions[SESSION].todo.list, []);
  const step = fire(state, 'on_tool_start', mergeTodo([
    item(1, 'in_progress', 'Start again', 'Starting again'),
  ], 'c-turn-2')).find((e) => e.type === 'step.start');
  assert.deepEqual([step.payload.index, step.payload.of], [1, 1]);
  assert.equal(step.payload.title, 'Starting again');
  assert.ok(out.some((e) => e.type === 'turn.start'));
});
