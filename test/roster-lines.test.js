// What a roster row says when one person is holding several jobs.
//
// The manager side of that is covered by test/one-character-many-jobs.test.js: two
// sessions of one actor become one character with two jobs, one desk, and a departure
// that waits for the last of them. This is the other half — what the *panel* draws —
// and it shipped untested, because the rule lived inside `renderList`, which is closed
// over inside `createOverlay` and needs eighty-odd `document` calls stubbed to reach.
//
// So the decision is its own function now and the span-assembly is not. This tests the
// decision: how many lines, in whose words, and what a row that knows nothing about
// jobs still renders as.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusLines } from '../src/ui/overlay.js';

test('several jobs get a line each, in their own words', () => {
  // Each job's own verb, not the character's. The body animates on the newest event —
  // one person, one thing at a time — so the panel is the only place the others show,
  // and giving them all the newest status would be the lie the row is meant to avoid.
  const lines = statusLines({
    name: 'Sideline Cruston',
    status: 'working',
    jobs: [
      { id: 's1', title: 'Check the nightly backups', status: 'working' },
      { id: 's2', title: 'Rotate the access keys', status: 'waiting' },
    ],
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Check the nightly backups$/);
  assert.match(lines[1], /Rotate the access keys$/);
  assert.notEqual(lines[0].split(' · ')[0], lines[1].split(' · ')[0],
    'two jobs in different states should not read as being in the same one');
});

test('a job with no title still says what it is doing', () => {
  const [line] = statusLines({ status: 'idle', jobs: [] });
  assert.ok(line, 'a row always says something');
  assert.ok(!line.includes('·'), 'nothing to append, so no separator');
});

test('a row that knows nothing about jobs renders exactly as it always did', () => {
  // The compatibility claim the whole change rests on: a harness that sends no identity
  // keeps one character per session, and its rows have no `jobs` at all.
  const before = statusLines({ status: 'working', job: 'Fix the flaky test' });
  assert.equal(before.length, 1);
  assert.match(before[0], /Fix the flaky test$/);

  // And one job is one line, not a stack of one — otherwise every ordinary row would
  // grow the multi-line treatment for nothing.
  const one = statusLines({
    status: 'working', job: 'Fix the flaky test',
    jobs: [{ id: 's1', title: 'Fix the flaky test', status: 'working' }],
  });
  assert.equal(one.length, 1);
  assert.deepEqual(one, before, 'one job should read the same as no jobs list at all');
});

test('a job that has not said what it is doing falls back to the person', () => {
  // A `spawn` opens a job with no status of its own until the first event for it, and
  // an empty verb on the panel would read as a job that had stalled.
  const lines = statusLines({
    status: 'working',
    jobs: [
      { id: 's1', title: 'One', status: null },
      { id: 's2', title: 'Two', status: 'waiting' },
    ],
  });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith(lines[0].split(' · ')[0]));
  assert.ok(lines[0].split(' · ')[0].length > 0, 'the first job should still have a verb');
});
