// Cursor hook payloads, through the mapper and into the same reducer the scene uses.
// This is deliberately a round trip: a mapper-only test cannot catch a field mismatch
// that leaves a perfectly valid-looking AOP event invisible in the office.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createAopReducer } from '../src/data/aop-reducer.js';

const require = createRequire(import.meta.url);
const mapper = require('../bin/mappers/cursor.cjs');
const { MAPPER_HELPERS: helpers } = require('../bin/lib/aop-core.cjs');

const HARNESS = 'cursor';
const SESSION = 'cursor-roundtrip';
const KEY = `${HARNESS}:${SESSION}`;

function chain() {
  const state = { sessions: {} };
  const stage = [];
  const reducer = createAopReducer({
    harness: HARNESS,
    emit: (event) => stage.push(event),
    schedule: () => 0,
    cancel: () => {},
    loadColourNames: () => new Promise(() => {}),
  });
  let sequence = 0;
  return {
    stage,
    fire(event, payload) {
      const wire = mapper.map({ event, payload, state, redaction: 'summary', helpers });
      for (const mapped of wire) reducer.reduce({
        ...mapped, aop: '0.1', id: `cursor-${++sequence}`, harness: { name: HARNESS },
      });
      return wire;
    },
    take() { const copy = [...stage]; stage.length = 0; return copy; },
  };
}

const payload = (extra = {}) => ({ session_id: SESSION, cwd: '/work/repo', ...extra });
const todo = (content, status, activeForm) => ({ content, status, ...(activeForm ? { activeForm } : {}) });

test('a Cursor three-step TodoWrite job advances in the office and completes its final step', () => {
  const c = chain();
  c.fire('beforeSubmitPrompt', payload({ prompt: 'Ship the release', generation_id: 'g1' }));
  c.take();

  const firstList = [
    todo('Prepare release notes', 'in_progress', 'Preparing release notes'),
    todo('Publish package', 'pending'),
    todo('Announce release', 'pending'),
  ];
  c.fire('preToolUse', payload({ tool_name: 'TodoWrite', tool_use_id: 'todo-1', tool_input: { todos: firstList } }));
  const firstWire = c.fire('postToolUse', payload({ tool_name: 'TodoWrite', tool_use_id: 'todo-1', tool_input: { todos: firstList } }));
  const firstStep = firstWire.find((event) => event.type === 'step.start');
  assert.deepEqual(
    { index: firstStep.payload.index, of: firstStep.payload.of, title: firstStep.payload.title },
    { index: 1, of: 3, title: 'Preparing release notes' },
  );
  assert.deepEqual(c.stage.at(-1), {
    type: 'step', id: KEY,
    step: { id: firstStep.payload.step_id, title: 'Preparing release notes', index: 1, of: 3 },
    plan: {
      items: [
        { id: firstStep.payload.step_id, title: 'Prepare release notes', status: 'active' },
        { id: firstWire.find((event) => event.type === 'step.start').payload.plan[1].id, title: 'Publish package', status: 'pending' },
        { id: firstWire.find((event) => event.type === 'step.start').payload.plan[2].id, title: 'Announce release', status: 'pending' },
      ], more: 0,
    },
  });
  c.take();

  const secondList = [
    todo('Prepare release notes', 'completed'), todo('Publish package', 'in_progress', 'Publishing package'),
    todo('Announce release', 'pending'),
  ];
  c.fire('preToolUse', payload({ tool_name: 'TodoWrite', tool_use_id: 'todo-2', tool_input: { todos: secondList } }));
  const secondWire = c.fire('postToolUse', payload({ tool_name: 'TodoWrite', tool_use_id: 'todo-2', tool_input: { todos: secondList } }));
  assert.deepEqual(secondWire.filter((event) => event.type.startsWith('step.')).map((event) => event.type), ['step.end', 'step.start']);
  const active = c.stage.filter((event) => event.type === 'step').at(-1);
  assert.equal(active.step.index, 2);
  assert.deepEqual(active.plan.items.map((item) => item.status), ['completed', 'active', 'pending']);
  c.take();

  const finalList = [
    todo('Prepare release notes', 'completed'), todo('Publish package', 'completed'),
    todo('Announce release', 'in_progress', 'Announcing release'),
  ];
  c.fire('preToolUse', payload({ tool_name: 'TodoWrite', tool_use_id: 'todo-3', tool_input: { todos: finalList } }));
  c.fire('postToolUse', payload({ tool_name: 'TodoWrite', tool_use_id: 'todo-3', tool_input: { todos: finalList } }));
  const stopWire = c.fire('stop', payload());
  const finalEnd = stopWire.find((event) => event.type === 'step.end');
  assert.equal(finalEnd.payload.status, 'completed');
  assert.ok(stopWire.indexOf(finalEnd) < stopWire.findIndex((event) => event.type === 'turn.end'));
  assert.deepEqual(c.stage.at(-1), { type: 'dispatch', id: KEY, summary: undefined });
});
