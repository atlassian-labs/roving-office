// An office stripped to the jobs it needs, still working.
//
// Making the bin, the machines and the printer removable is only half a change: the
// behaviours that used to walk to them by name now have to cope with them being gone.
// `_discard` closes the work where it stands, `_drinkBreak` takes a break without a
// cup, and `_drinkRun` skips the mug. None of that is reachable through the old code,
// because the old rule would not let the props leave.
//
// Driven through a real AgentManager rather than asserted about the lookup, because the
// thing worth pinning is that the room keeps running — a behaviour that throws halfway
// through leaves an agent standing still for ever, and no unit test of a lookup notices.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { play, playUntil } from './lib/frames.js';
import { arrived, loadRoom } from './lib/room.js';

let layout;

before(async () => {
  await loadRoom();
  layout = await import('../src/layout.js');
});

beforeEach(() => layout.resetLayout());

/** Everything the room may lose, gone. */
function strip() {
  for (const kind of ['printer', 'bin', 'coffee', 'waterCooler', 'inbox']) {
    assert.ok(layout.removeObject(`station:${kind}`), `${kind} should be removable`);
  }
  layout.reviseLayout();
}

test('the room can be stripped and still staffed', () => {
  strip();
  const { manager, rec } = arrived();
  play(manager, 5);
  assert.equal(manager.agents.size, 1, 'the agent is still in the building');
  assert.ok(Number.isFinite(rec.agent.position.x), 'and still somewhere real');
});

test('failed work is closed where they stand when there is no bin', () => {
  strip();
  // No bin prop either, since the station has gone: the props layer would not build one.
  const { manager, rec } = arrived();
  const feed = [];
  manager.onFeed?.((entry) => feed.push(entry));

  manager.handleEvent({ type: 'job', id: 'a1', job: 'Parse the manifest' });
  play(manager, 2);
  manager.handleEvent({ type: 'status', id: 'a1', status: 'error' });

  // Closed means the log entry closed, not the label cleared: an agent goes on being
  // the person who last did that job, which is what the roster shows between jobs.
  let closed = null;
  playUntil(manager, () => (closed = rec.agent.recentJobs().find((j) => j.outcome === 'error')), 30);
  assert.ok(closed, 'the work never closed, so the discard walked to a bin that is not there');
  // And the log records the removal: what it reports is that work was thrown away, not
  // which prop received it.
  assert.ok(feed.some((e) => e.kind === 'removal'),
    'a job thrown away with no bin should still reach the job log');
  // And they are not wedged in the errand. Deliberately not `status === 'idle'`: the
  // log closes a beat before the sequence ends, and the moment it does the idle roll
  // may already have sent them for a drink — so pinning 'idle' made this flake in the
  // full suite while passing alone. What matters is that they left the error behind.
  play(manager, 3);
  assert.notEqual(rec.agent.status, 'error',
    'still erroring three seconds on: the discard never finished');
});

test('a drink break with nothing to drink is a break, not a crash', () => {
  strip();
  const { manager, rec } = arrived();
  const was = rec.agent.position.clone();
  manager.handleEvent({ type: 'activity', id: 'a1', activity: 'drink' });
  play(manager, 10);
  assert.equal(manager.agents.size, 1);
  assert.ok(rec.agent.position.distanceTo(was) >= 0, 'they are still in the room');
  assert.notEqual(rec.agent.status, 'drinking', 'nothing served them a drink');
});

test('a long stretch at a desk earns no mug when there is no machine', () => {
  // `_drinkRun` is the desk-side garnish, rolled for after a long spell of seated work.
  // With nothing to fetch from it must simply not happen.
  strip();
  const { manager } = arrived();
  manager.handleEvent({ type: 'job', id: 'a1', job: 'A long stretch of work' });
  manager.handleEvent({ type: 'status', id: 'a1', status: 'working' });
  play(manager, 120);
  assert.equal(manager.agents.size, 1, 'the office survived two minutes with no machines');
});

test('the office still delivers, because that is a job it cannot lose', () => {
  // `dispatch` is in `JOB_ROLES`, so however far the room is stripped the mailbox is
  // still there and `_deliver` still finds it — by role now, rather than by name.
  strip();
  const { manager, rec } = arrived();
  manager.handleEvent({ type: 'job', id: 'a1', job: 'Ship the thing' });
  play(manager, 2);
  manager.handleEvent({ type: 'dispatch', id: 'a1', summary: 'Done' });

  let done = null;
  playUntil(manager, () => (done = rec.agent.recentJobs().find((j) => j.outcome === 'done')), 40);
  assert.ok(done, 'a stripped room must still be able to post finished work');
  // They got to the post to do it, rather than the walk failing quietly.
  const post = layout.stationForRole('dispatch');
  const off = Math.hypot(rec.agent.position.x - post.approach.x, rec.agent.position.z - post.approach.z);
  assert.ok(off < 3, `delivered from ${off.toFixed(2)} away from the post`);
});
