// Two post boxes in one room.
//
// The mailbox was capped at one for a reason that was true at the time: `Post` was a
// single queue with no notion of which box an envelope was in, so two props would both
// have shown the room's three letters. The answer was to give every envelope a box
// rather than to forbid the second box.
//
// Three things have to hold, and none of them is obvious:
//
//   1. A delivery lands in *one* box, and each prop shows only its own.
//   2. Deliveries are spread across the boxes rather than all landing in one, and the
//      box is decided once and written down so the scenery aims at the same one.
//   3. A collector goes to the box that actually has their work, not to the near one.
//
// The third is the bug a second box would otherwise introduce: an agent standing at an
// empty box while their envelope sits across the room.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { play } from './lib/frames.js';
import { arrived, loadRoom } from './lib/room.js';

let Post, layout;

before(async () => {
  await loadRoom();
  ({ Post } = await import('../src/agents/post.js'));
  layout = await import('../src/layout.js');
});

beforeEach(() => layout.resetLayout());

/** A second post box, over on the far side of the room from the authored one. */
function secondBox() {
  const made = layout.addStation('mailbox', { x: 21, z: 17 });
  assert.ok(made, 'a second post box should be allowed');
  layout.reviseLayout();
  return made;
}

// --- the box is part of the envelope ----------------------------------------

test('an envelope remembers which box it is in, and each box counts its own', () => {
  const post = new Post();
  post.land({ job: 'One', arrival: 'letter', box: 'mailbox' });
  post.land({ job: 'Two', arrival: 'letter', box: 'mailbox-2' });
  post.land({ job: 'Three', arrival: 'package', box: 'mailbox-2' });

  assert.equal(post.countByArrival('letter', 'mailbox'), 1);
  assert.equal(post.countByArrival('letter', 'mailbox-2'), 1);
  assert.equal(post.countByArrival('package', 'mailbox-2'), 1);
  assert.equal(post.countByArrival('package', 'mailbox'), 0);
  // Unscoped is still the room's total, which is what a single-box room wants.
  assert.equal(post.countByArrival('letter'), 2);
});

test('an agent can only take what is in the box they are standing at', () => {
  const post = new Post();
  post.land({ job: 'Far away', arrival: 'letter', box: 'mailbox-2' });

  assert.equal(post.canCollect('a', 'mailbox'), false, 'nothing in this box');
  assert.equal(post.take('a', 'mailbox'), null, 'and nothing to be taken from it');
  assert.equal(post.canCollect('a', 'mailbox-2'), true);
  assert.equal(post.take('a', 'mailbox-2')?.job, 'Far away');
});

test('boxesWith says where an agent may collect, oldest first', () => {
  const post = new Post();
  post.land({ job: 'For B', forId: 'b', arrival: 'letter', box: 'mailbox-2' });
  post.land({ job: 'Open', arrival: 'letter', box: 'mailbox' });

  // Addressed post is invisible to anybody else, so the boxes each agent is offered
  // differ — which is the whole reason this is asked per agent.
  assert.deepEqual(post.boxesWith('b'), ['mailbox-2', 'mailbox']);
  assert.deepEqual(post.boxesWith('c'), ['mailbox']);
});

// --- which box a delivery goes to -------------------------------------------

test('one box takes everything', () => {
  assert.equal(layout.postBoxFor().id, 'mailbox');
  assert.equal(layout.postBoxFor(() => 0.99).id, 'mailbox', 'whatever the draw says');
});

test('two boxes each get their share', () => {
  // A draw rather than a rule, and this is what the rule got wrong: both ways into the
  // authored room are at the same end of it, so "the nearest box" was always the box
  // that was already there and a second one never received anything at all.
  const far = secondBox();
  assert.equal(layout.postBoxFor(() => 0).id, 'mailbox');
  assert.equal(layout.postBoxFor(() => 0.99).id, far.id);

  const hits = {};
  for (let i = 0; i < 600; i += 1) {
    const id = layout.postBoxFor().id;
    hits[id] = (hits[id] ?? 0) + 1;
  }
  assert.equal(Object.keys(hits).length, 2, 'both boxes should come up');
  // Even, give or take: this is 600 tosses of a fair coin, so a fifth either way is
  // slack enough never to flake and tight enough to catch a lopsided draw.
  for (const id of Object.keys(hits)) {
    assert.ok(hits[id] > 200 && hits[id] < 400, `${id} took ${hits[id]} of 600`);
  }
});

test('a draw of exactly 1 does not fall off the end', () => {
  secondBox();
  assert.ok(layout.postBoxFor(() => 1), 'an rng that returns 1 must still name a box');
});

test('no post box at all is null rather than a throw', () => {
  // Reachable once something else can dispatch — the printer's fax — so it
  // has to answer rather than break.
  layout.STATION_KINDS.printer.roles = ['dispatch'];
  try {
    assert.ok(layout.removeObject('station:mailbox'));
    layout.reviseLayout();
    assert.equal(layout.postBoxFor(), null);
  } finally {
    layout.STATION_KINDS.printer.roles = [];
  }
});

// --- the collector goes where the work is -----------------------------------

test('a collector walks to the box holding their work, not to the nearer one', () => {
  const far = secondBox();
  const { manager, rec } = arrived();

  // Put their envelope in the far box by hand, so distance and contents disagree: the
  // authored box at (1.4, 4.2) is much nearer a desk at (12, 8) than (21, 17) is.
  manager.post.post('a1');
  manager.post.land({ job: 'In the far box', forId: 'a1', arrival: 'letter', box: far.id });

  const chosen = manager._nearestPostBox(rec);
  assert.equal(chosen.id, far.id,
    'contents first, distance second — otherwise they stand at an empty box');

  // And with nothing anywhere, the nearest is the right answer: somebody walking over
  // to wait for a plane still in the air has no contents to choose by.
  manager.post.take('a1', far.id);
  assert.equal(manager._nearestPostBox(rec).id, 'mailbox');
});

test('a job posted into a two-box room lands in exactly one of them', () => {
  secondBox();
  const { manager } = arrived();
  manager.handleEvent({ type: 'mail', job: 'Somewhere definite', arrival: 'letter' });
  play(manager, 1);

  const boxes = manager.post.pending.map((m) => m.box);
  assert.equal(boxes.length, 1, 'one envelope');
  assert.ok(boxes[0], 'and it knows which box it is in');
  // One of the room's boxes, and *only* one. Deliberately not compared against another
  // call to `postBoxFor` — it is a draw, so a second call proves nothing. What matters
  // is that the answer was decided once and written down, which is what lets the
  // scenery aim at the same box instead of drawing again.
  assert.ok(layout.postBoxes().some((b) => b.id === boxes[0]));
});
