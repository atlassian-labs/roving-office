// One phrasing of "what part are they on", shared by four surfaces. These are the
// assertions that stop the roster row and the HUD from describing the same step
// two different ways.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeStepLabels, planTally, stepLabel, planResting, SETTLED,
} from '../src/agents/steps.js';

test('no step is no label — the answer for nearly every turn in the office', () => {
  assert.equal(stepLabel(null), null);
  assert.equal(stepLabel(undefined), null);
  // A step that arrived with neither a title nor a pair of counters says nothing,
  // and every caller draws nothing rather than an empty bar or a dash.
  assert.equal(stepLabel({ title: null, index: null, of: null }), null);
});

test('a titled step counts itself; an untitled one still says where it is', () => {
  assert.equal(stepLabel({ title: 'Ingest mail', index: 2, of: 5 }), '(2/5) Ingest mail');
  assert.equal(stepLabel({ title: 'Ingest mail' }), 'Ingest mail');
  // Not a fallback for a bug: at `metadata` redaction the title is dropped emitter-side
  // because the model wrote it, and the counters are the honest whole of what arrived.
  assert.equal(stepLabel({ title: null, index: 2, of: 5 }), 'Step 2 of 5');
});

test('parallel active parts get one counted line each, with the fraction first', () => {
  const plan = {
    items: [
      { id: 'a', title: 'Run tests', status: 'completed' },
      { id: 'b', title: 'Run eslint', status: 'active' },
      { id: 'c', title: 'Run the geometry probe', status: 'active' },
      { id: 'd', title: 'Update docs', status: 'pending' },
    ],
    more: 0,
  };
  assert.deepEqual(
    activeStepLabels({ id: 'b', title: 'Running eslint', index: 2, of: 4 }, plan),
    ['(2/4) Running eslint', '(3/4) Run the geometry probe'],
  );
});

test('half a fraction is not drawn as one', () => {
  assert.equal(stepLabel({ title: 'One', index: 2, of: null }), 'One');
  assert.equal(stepLabel({ title: null, index: null, of: 5 }), null);
});

test('a tally counts what is settled, and skipped counts as settled', () => {
  const plan = {
    items: [
      { title: 'a', status: 'completed' },
      { title: 'b', status: 'skipped' },
      { title: 'c', status: 'failed' },
      { title: 'd', status: 'active' },
      { title: 'e', status: 'pending' },
    ],
    more: 0,
  };
  // A scheduled job that found nothing to do in a phase has done that phase; calling
  // it unfinished would leave every quiet heartbeat looking abandoned.
  assert.deepEqual(planTally(plan), { done: 3, of: 5 });
  assert.ok(SETTLED.has('skipped'));
});

test('a tally counts the truncated tail, so a long plan is not quietly shortened', () => {
  const items = Array.from({ length: 20 }, () => ({ status: 'completed' }));
  assert.deepEqual(planTally({ items, more: 6 }), { done: 20, of: 26 });
});

test('no plan is no tally', () => {
  assert.equal(planTally(null), null);
  assert.equal(planTally({ items: [], more: 0 }), null);
});

test('between parts, the fraction holds the line so the row does not twitch', () => {
  const plan = { items: [{ status: 'completed' }, { status: 'pending' }], more: 0 };
  assert.equal(planResting(plan), '1/2 parts');
  // No checklist is still nothing at all: this is about a round that has parts, not
  // about inventing one for a job that never had any.
  assert.equal(planResting(null), null);
});
