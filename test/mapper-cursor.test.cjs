'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mapper = require('../bin/mappers/cursor.cjs');
const { driver } = require('./lib/mapper.cjs');
const base = (extra = {}) => ({ session_id: 'cursor-1', cwd: '/work/repo', timestamp: 1735689600000, ...extra });
const fire = driver(mapper);

test('Cursor session, prompt, tool and stop become AOP lifecycle events', () => {
  const state = { sessions: {} };
  assert.equal(fire(state, 'sessionStart', base()).at(0).type, 'session.start');
  const turn = fire(state, 'beforeSubmitPrompt', base({ prompt: 'Fix the flaky test', generation_id: 'g1' }));
  assert.equal(turn.at(0).type, 'turn.start');
  assert.equal(turn.at(0).payload.title, 'Fix the flaky test');
  const start = fire(state, 'preToolUse', base({ tool_name: 'Read', tool_use_id: 't1', tool_input: { file_path: '/work/repo/a.js' } }));
  assert.deepEqual(start.at(0).payload, { tool_call_id: 't1', tool_name: 'Read', tool_class: 'read', target: 'a.js' });
  const end = fire(state, 'postToolUse', base({ tool_name: 'Read', tool_use_id: 't1', tool_output: 'contents' }));
  assert.equal(end.at(0).type, 'tool.end'); assert.equal(end.at(0).payload.status, 'ok');
  assert.equal(fire(state, 'stop', base()).at(0).type, 'turn.end');
});

test('late attachment introduces a session before a prompt and redacts metadata', () => {
  const state = { sessions: {} }; const events = fire(state, 'beforeSubmitPrompt', base({ prompt: 'private task' }), { redaction: 'metadata' });
  assert.deepEqual(events.map((event) => event.type), ['session.start', 'turn.start']);
  assert.equal(events.at(-1).payload.title, 'Working'); assert.equal(events.at(-1).payload.prompt, undefined);
});

test('a Cursor todo list becomes a plan and active steps, then advances correctly', () => {
  const state = { sessions: {} }; fire(state, 'beforeSubmitPrompt', base({ prompt: 'Ship it' }));
  const initial = [{ content: 'Investigate', status: 'in_progress', activeForm: 'Investigating' }, { content: 'Implement', status: 'pending' }];
  fire(state, 'preToolUse', base({ tool_name: 'TodoWrite', tool_use_id: 'todo-1', tool_input: { todos: initial } }));
  const first = fire(state, 'postToolUse', base({ tool_name: 'TodoWrite', tool_use_id: 'todo-1', tool_input: { todos: initial } }));
  assert.deepEqual(first.map((event) => event.type), ['tool.end', 'step.start']); assert.equal(first.at(-1).payload.of, 2);
  const advanced = [{ content: 'Investigate', status: 'completed' }, { content: 'Implement', status: 'in_progress' }];
  fire(state, 'preToolUse', base({ tool_name: 'TodoWrite', tool_use_id: 'todo-2', tool_input: { todos: advanced } }));
  const next = fire(state, 'postToolUse', base({ tool_name: 'TodoWrite', tool_use_id: 'todo-2', tool_input: { todos: advanced } }));
  assert.deepEqual(next.map((event) => event.type), ['tool.end', 'step.end', 'step.start']); assert.equal(next.at(-1).payload.index, 2);
});

test('file edits, compaction and session end have their AOP equivalents', () => {
  const state = { sessions: {} };
  const edit = fire(state, 'afterFileEdit', base({ file_path: '/work/repo/src/a.js', edits: [{ old_string: 'a', new_string: 'b\nc' }] }));
  assert.equal(edit.at(-1).type, 'artifact.change');
  assert.deepEqual(edit.at(-1).payload, { kind: 'file', path: 'src/a.js', added: 2, removed: 1 });
  assert.equal(fire(state, 'preCompact', base()).at(0).type, 'context.compact');
  assert.equal(fire(state, 'sessionEnd', base({ reason: 'exit' })).at(0).type, 'session.end');
});
