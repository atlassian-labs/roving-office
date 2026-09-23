// Changing an office's sources under the people standing in it.
//
// This used to be a world rebuild: the picker stored the new set and `activateScene`
// threw the building away and put up another one, which meant a feed you had not
// touched lost every character it had drawn. Now the difference is moved instead —
// `feeds.sync()` for the feeds, `AgentManager.showOut()` for the people — and these
// are the two properties that makes true.
//
// The feeds run on their own timers, so the clock is a mock one: the opening cast
// files in at 700ms and the office would otherwise be tested in real seconds.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom } from './lib/room.js';
import { play } from './lib/frames.js';

let THREE;
let createFeeds;
let AgentManager;

/** A scene record, as far as a feed is concerned: an id and an opening cast. */
const project = { id: 'scene-under-test', agents: { startCount: 2 } };

const TIMERS = { apis: ['setTimeout', 'setInterval'] };

before(async () => {
  ({ THREE, AgentManager } = await loadRoom());
  // A live source finds its receiver from the page's own URL and then opens a
  // stream to it. Neither exists in Node, and neither is what any of this is about:
  // the AOP feeds are here to be added and removed, not to carry anything.
  globalThis.window = { location: { pathname: '/' } };
  globalThis.EventSource = class { close() {} };

  ({ createFeeds } = await import('../src/data/feeds.js'));
});

/** Just the spawns, which are the events that carry an id. */
const spawned = (events) => events.filter((ev) => ev.type === 'spawn').map((ev) => ev.id);

/** A running set of feeds, with everything it has said so far. */
function running(ids) {
  const seen = [];
  const feeds = createFeeds(ids, { project, manager: null });
  feeds.start((ev) => seen.push(ev));
  return { feeds, seen };
}

// --- the feeds --------------------------------------------------------------

test('a source nobody touched goes on running, and goes on counting', (t) => {
  t.mock.timers.enable(TIMERS);
  const { feeds, seen } = running(['test-data']);
  t.after(() => feeds.stop());

  t.mock.timers.tick(1000);
  assert.deepEqual(spawned(seen), ['test-data@1#agent-1'], 'the office opens with somebody');

  // The change that used to cost the room everybody in it.
  feeds.sync(['test-data', 'rovo-cli']);
  seen.length = 0;
  t.mock.timers.tick(20000);

  const ids = spawned(seen);
  assert.ok(ids.length > 0, 'the untouched feed is still filling the room');
  assert.ok(ids.every((id) => id.startsWith('test-data@1#')),
    `still the same feed, not a fresh one: ${ids.join(', ')}`);
  assert.ok(ids.includes('test-data@1#agent-2'),
    'and still counting from where it was, rather than starting again at agent-1');
});

test('a source that goes takes its feed with it', (t) => {
  t.mock.timers.enable(TIMERS);
  const { feeds, seen } = running(['test-data']);
  t.after(() => feeds.stop());

  t.mock.timers.tick(1000);
  assert.ok(seen.length > 0);

  feeds.sync(['rovo-cli']);
  assert.deepEqual(feeds.defs.map((d) => d.id), ['rovo-cli']);

  seen.length = 0;
  t.mock.timers.tick(60000);
  assert.deepEqual(seen, [], 'a stopped feed says nothing else, ever');
});

test('a source ticked off and back on cannot name somebody the room still holds', (t) => {
  t.mock.timers.enable(TIMERS);
  const { feeds, seen } = running(['test-data']);
  t.after(() => feeds.stop());

  t.mock.timers.tick(1000);
  const [before_] = spawned(seen);
  assert.equal(before_, 'test-data@1#agent-1');

  // Off and straight back on, which is one click each in the picker. The first
  // instance's people are still walking to the lift at this point, and the second
  // instance numbers its sessions from `agent-1` exactly as the first one did — so
  // without a prefix per *instance* the newcomer would be a name the room already
  // holds, and `_spawn` drops those on the floor.
  feeds.sync([]);
  feeds.sync(['test-data']);
  seen.length = 0;
  t.mock.timers.tick(1000);

  const [after] = spawned(seen);
  assert.equal(after, 'test-data@2#agent-1');
  assert.notEqual(after, before_, 'two instances, two names');
});

test('a feed added before anything is listening waits to be started', (t) => {
  t.mock.timers.enable(TIMERS);
  const feeds = createFeeds([], { project, manager: null });
  t.after(() => feeds.stop());

  feeds.sync(['test-data']);
  const seen = [];
  t.mock.timers.tick(5000);
  assert.deepEqual(seen, []);

  feeds.start((ev) => seen.push(ev));
  t.mock.timers.tick(1000);
  assert.ok(spawned(seen).length > 0, 'and runs the moment there is somewhere to run to');
});

test('sync says what came and what went', () => {
  const feeds = createFeeds(['test-data'], { project, manager: null });
  const { added, removed } = feeds.sync(['rovo-cli', 'claude-code']);

  assert.deepEqual(added.map((d) => d.id), ['rovo-cli', 'claude-code']);
  assert.deepEqual(removed.map((d) => d.id), ['test-data']);
});

test('the set is left in the order it was asked for, not the order it was built', () => {
  const feeds = createFeeds(['test-data'], { project, manager: null });
  feeds.sync(['rovo-cli', 'test-data', 'claude-code']);

  assert.deepEqual(feeds.defs.map((d) => d.id), ['rovo-cli', 'test-data', 'claude-code'],
    'the badge reads left to right, and test-data is the one that was already there');
});

test('a retired id is dropped and a repeated one is still a single feed', () => {
  const feeds = createFeeds([], { project, manager: null });
  feeds.sync(['nothing-of-the-kind', 'test-data', 'test-data']);

  assert.deepEqual(feeds.defs.map((d) => d.id), ['test-data']);
});

test('the badge is told what the set became, not what it was mid-move', (t) => {
  t.mock.timers.enable(TIMERS);
  const summaries = [];
  const feeds = createFeeds(['test-data'], {
    project,
    manager: null,
    onStatus: (summary) => summaries.push(summary),
  });
  t.after(() => feeds.stop());
  feeds.start(() => {});

  summaries.length = 0;
  // Losing the only live feed and gaining another, which is one click in the
  // picker. The pill must not be left describing the gap in the middle of it.
  feeds.sync(['rovo-cli']);

  assert.ok(summaries.length >= 1, 'the change is reported at all');
  assert.equal(summaries.at(-1).state, 'connecting', 'what the set is once it settles');
  assert.ok(!summaries.some((s) => s.state === 'idle'),
    'and never an empty office, which it never was');
});

// --- the people -------------------------------------------------------------

const mockDef = { id: 'test-data', label: 'Test Data' };
const rovoDef = { id: 'rovo-cli', label: 'Rovo CLI' };

/** A room with one agent from each of two sources. */
function crewed() {
  const manager = new AgentManager(new THREE.Group(), {});
  manager.handleEvent({ type: 'spawn', id: 'test-data@1#agent-1', name: 'Ada' }, mockDef);
  manager.handleEvent({ type: 'spawn', id: 'rovo-cli@2#s-9', name: 'Grace' }, rovoDef);
  return manager;
}

test('the people from a removed source walk out, and nobody else does', () => {
  const manager = crewed();

  assert.equal(manager.showOut([mockDef]), 1, 'one of the two wears that source');
  assert.equal(manager.roster().length, 2,
    'still in the room: leaving a building takes a door, not a delete');

  play(manager, 60);
  assert.deepEqual(manager.roster().map((r) => r.id), ['rovo-cli@2#s-9'],
    'and the feed nobody touched still has its agent');
});

test('showing somebody out twice does not send them back for their coat', () => {
  const manager = crewed();

  assert.equal(manager.showOut(['test-data']), 1);
  // The same source removed, re-added and removed again names the same def, and the
  // first crowd may well still be on its way to the lift.
  assert.equal(manager.showOut(['test-data']), 0);
});

test('showing out a source nobody in the room came from does nothing', () => {
  const manager = crewed();

  assert.equal(manager.showOut(['codex-cli']), 0);
  assert.equal(manager.showOut([]), 0);
  assert.equal(manager.roster().length, 2);
});

test('a completion summary never replaces the job shown in the roster', () => {
  const manager = new AgentManager(new THREE.Group(), {});
  manager.handleEvent({ type: 'spawn', id: 'agent-1', name: 'Ada' }, mockDef);
  manager.handleEvent({ type: 'job', id: 'agent-1', job: 'Keep job labels stable' });

  manager.handleEvent({
    type: 'dispatch', id: 'agent-1', summary: 'Understood. The test server is healthy.',
  });

  assert.equal(manager.roster()[0].job, 'Keep job labels stable');
});

test('a late concise title retitles one completed job and its retained checklist', () => {
  const manager = new AgentManager(new THREE.Group(), {});
  manager.handleEvent({ type: 'spawn', id: 'agent-1', name: 'Ada' }, mockDef);
  manager.handleEvent({ type: 'job', id: 'agent-1', job: 'Can you test this locally?' });
  manager.handleEvent({
    type: 'step', id: 'agent-1',
    step: { id: '2', title: 'Running tests', index: 2, of: 2 },
    plan: {
      items: [
        { id: '1', title: 'Inspect the checkout', status: 'completed' },
        { id: '2', title: 'Run tests', status: 'active' },
      ],
      more: 0,
    },
  });
  manager.handleEvent({
    type: 'retitle', id: 'agent-1',
    from: 'Can you test this locally?', job: 'Local Test',
  });
  manager.handleEvent({
    type: 'step', id: 'agent-1', step: null,
    plan: {
      items: [
        { id: '1', title: 'Inspect the checkout', status: 'completed' },
        { id: '2', title: 'Run tests', status: 'completed' },
      ],
      more: 0,
    },
  });
  manager.getAgent('agent-1').finishJob('done');

  const [entry] = manager.roster()[0].recent;
  assert.equal(entry.label, 'Local Test');
  assert.equal(entry.outcome, 'done');
  assert.deepEqual(entry.steps, { done: 2, of: 2 });
  assert.deepEqual(entry.plan.items.map((item) => item.title), [
    'Inspect the checkout', 'Run tests',
  ]);
});

test('a late concise title catches the original prompt while its envelope is flying', () => {
  const mail = {
    payload: null,
    launch(payload) { this.payload = payload; return true; },
  };
  const manager = new AgentManager(new THREE.Group(), { mail });
  manager.handleEvent({ type: 'spawn', id: 'agent-1', name: 'Ada' }, mockDef);
  // `arrival` pinned, because this test is about an envelope *in flight* and the channel
  // is otherwise a draw over whatever the room can receive. That was letter-or-package
  // when this was written and became letter-or-package-or-fax later — and a fax has
  // no flight at all, so one run in three stopped launching anything and the test failed
  // on the toss. Saying which channel it means is both the fix and the documentation.
  manager.handleEvent({
    type: 'mail', id: 'agent-1', forId: 'agent-1', arrival: 'letter',
    job: 'Can you test this locally?',
  });
  manager.handleEvent({
    type: 'retitle', id: 'agent-1',
    from: 'Can you test this locally?', job: 'Local Test',
  });

  mail.onArrive(mail.payload);
  assert.equal(manager.post.take('agent-1')?.job, 'Local Test');
});
