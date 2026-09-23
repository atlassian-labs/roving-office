// Where a new piece may go, and what the room already cannot reach.
//
// The report was two things: a desk that would not go back into the hole it had just
// been deleted from, and rugs that almost never added. Both came back to the editor
// answering a question about the *room* as though it were a question about the thing
// being added, so these are written the same way round — ask the placement rules
// directly, rather than driving a stubbed browser to get at them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, strandedApproaches } from '../src/editor/placement.js';

const ROOM = { W: 26, D: 20 };
const DOORWAY = { x: 3.4, z: 2.4 };

/**
 * A nav grid as far as `strandedApproaches` is concerned: a set of world points that
 * cannot be walked on, and a reachability answer that respects them.
 *
 * Stubbed rather than built from a layout because the question here is what the *rule*
 * does with an unreachable spot, not whether the real grid finds one — the real grid is
 * measured against the real room in `test/layout.test.js` and the probe.
 */
function navWithout(unwalkable) {
  const blocked = new Set(unwalkable.map(({ x, z }) => `${x},${z}`));
  return {
    rebuilds: 0,
    rebuild() { this.rebuilds++; },
    walkableAt: (x, z) => !blocked.has(`${x},${z}`),
    reachableFrom: () => new Uint8Array(1),
    reachedBy: (_seen, x, z) => !blocked.has(`${x},${z}`),
  };
}

const at = (label, x, z) => ({ label, at: { x, z } });

// --- what the room already cannot reach --------------------------------------

test('a sound room strands nothing', () => {
  const nav = navWithout([]);
  const out = strandedApproaches(
    [at('mailbox', 3.1, 4.2), at('printer', 21.4, 2.85)], nav, DOORWAY,
  );
  assert.equal(out.size, 0);
  assert.equal(nav.rebuilds, 1, 'the grid is rebuilt once, not once per approach');
});

test('an unreachable standing spot is named, and only that one', () => {
  const out = strandedApproaches(
    [at('mailbox', 3.1, 4.2), at('printer', 21.4, 2.85), at('bin', 19, 2.31)],
    navWithout([{ x: 21.4, z: 2.85 }]),
    DOORWAY,
  );
  assert.deepEqual([...out], ['printer']);
});

test('a room with nothing to reach is not a broken room', () => {
  // Before the first world is built there are no props and so no approach points.
  // Answering "everything is stranded" there would refuse the first edit of every
  // session.
  const nav = navWithout([{ x: 1, z: 1 }]);
  assert.equal(strandedApproaches([], nav, DOORWAY).size, 0);
  assert.equal(nav.rebuilds, 0, 'and it does not bother rebuilding for nobody');
});

// --- the hole a deletion leaves ----------------------------------------------

test('the position asked for is the very first thing tried', () => {
  // The headline complaint: delete a desk, add a desk, and it should go back in the
  // hole. `from` is how the hole gets offered at all.
  const [first] = [...candidates({
    room: ROOM, snap: 0.25, from: { x: 1.75, z: 16.75 }, prefer: Math.PI / 2,
  })];
  assert.deepEqual(
    { x: first.x, z: first.z },
    { x: 1.75, z: 16.75 },
    'the search started somewhere other than the spot it was handed',
  );
  assert.ok(Math.abs(first.facing - Math.PI / 2) < 1e-9, 'and pointing the way asked for');
});

test('a position off the lattice is reachable only because it was asked for', () => {
  // 1.75 is a multiple of the 0.25 snap a drag lands on, and of no lattice pass — so
  // without `from` the search never looks there. This is the bug, stated as a test.
  const hole = { x: 1.75, z: 16.75 };
  const lands = (opts) => [...candidates({ room: ROOM, snap: 0.25, turns: false, ...opts })]
    .some((c) => c.x === hole.x && c.z === hole.z);

  assert.equal(lands({ from: hole }), true, 'handed the hole, it tries the hole');
  assert.equal(lands({}), true, 'the finest pass is the snap, so it gets there eventually');
});

test('the lattice reaches every position a drag can, whatever the snap', () => {
  // It used to stop at 0.5 while drags landed on multiples of 0.25 — so there were
  // positions you could put a piece with the mouse that Add could never find.
  for (const snap of [0.25, 0.5, 1]) {
    const seen = new Set();
    for (const c of candidates({ room: ROOM, snap, turns: false })) seen.add(`${c.x},${c.z}`);
    const offGrid = [...seen].filter((id) => id.split(',')
      .some((n) => Math.abs((Number(n) / snap) - Math.round(Number(n) / snap)) > 1e-9));
    assert.deepEqual(offGrid, [], `snap ${snap} yielded a position off its own grid`);
    assert.ok(seen.has(`${snap},${snap}`), `snap ${snap} never reached its finest cell`);
  }
});

test('no position is offered twice, however many passes look at it', () => {
  const seen = new Set();
  let yielded = 0;
  for (const c of candidates({ room: ROOM, snap: 0.5, turns: false, from: { x: 4, z: 4 } })) {
    seen.add(`${c.x},${c.z}`);
    yielded++;
  }
  assert.equal(yielded, seen.size, 'the same floor was tried more than once');
});

// --- a piece that cannot fit is not offered ----------------------------------

const RUG = { hw: 4.5, hd: 3.5 };     // 9 by 7: FURNITURE_KINDS.rug

test('a rug is never offered a position it would hang off the floor from', () => {
  let offered = 0;
  for (const c of candidates({ room: ROOM, snap: 0.5, extent: RUG })) {
    offered++;
    const hw = (Math.round(c.facing / (Math.PI / 2)) % 2) ? RUG.hd : RUG.hw;
    const hd = (Math.round(c.facing / (Math.PI / 2)) % 2) ? RUG.hw : RUG.hd;
    assert.ok(c.x - hw >= 0 && c.x + hw <= ROOM.W, `x ${c.x} at facing ${c.facing}`);
    assert.ok(c.z - hd >= 0 && c.z + hd <= ROOM.D, `z ${c.z} at facing ${c.facing}`);
  }
  assert.ok(offered > 0, 'a 9 by 7 rug fits in a 26 by 20 room; something is too strict');
});

test('the extent filter throws out most of a rug\'s candidates, not most of a lamp\'s', () => {
  const count = (extent) => [...candidates({ room: ROOM, snap: 0.5, extent })].length;
  const all = count(undefined);
  const rug = count(RUG);
  const lamp = count({ hw: 0.5, hd: 0.5 });
  assert.ok(rug < all * 0.6, `a rug kept ${rug} of ${all}; the point was to cut the waste`);
  assert.ok(lamp > all * 0.9, `a lamp kept only ${lamp} of ${all}; it fits nearly anywhere`);
});

test('a piece with no front is offered each position once', () => {
  const turning = [...candidates({ room: ROOM, snap: 1, turns: true })].length;
  const fixed = [...candidates({ room: ROOM, snap: 1, turns: false })].length;
  assert.equal(turning, fixed * 4, 'four quarter turns each, or one apiece');
});

// --- nearest first -----------------------------------------------------------

test('the search starts where it is told to look', () => {
  // The nearest cell of the coarsest pass, which for a snap of 1 is a 2-unit lattice —
  // so "the middle of the room" is the lattice cell nearest the middle, not (13, 10)
  // itself. Asserted as a distance for that reason: the contract is nearest-first, and
  // pinning an exact cell would pin the lattice spacing instead.
  const near = (target, opts) => {
    const [firstAt] = [...candidates({ room: ROOM, snap: 1, turns: false, ...opts })];
    return Math.hypot(firstAt.x - target.x, firstAt.z - target.z);
  };
  const COARSE = 2;
  assert.ok(near({ x: ROOM.W / 2, z: ROOM.D / 2 }) <= COARSE,
    'an addition should arrive in view, i.e. near the middle of the room');
  assert.ok(near({ x: 21, z: 3 }, { near: { x: 21, z: 3 } }) <= COARSE,
    'a duplicate should arrive beside its original');
});
