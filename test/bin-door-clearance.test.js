// The bin, the door, and the floor they were both trying to stand on.
//
// The report was that binning failed work opened the front door through the
// character. Both halves were true and both are pinned here.
//
// The bin stood at (1.2, 1.5) with its standing room at (2.6, 2.2). The door's leaf
// hinges on the left jamb and swings inward through better than a right angle, so
// open it lies across that exact patch of floor — 0.26 off its centre plane, less
// than half a body. And the thing that opened it was the agent themselves: the
// manager held the door for anybody merely *near* the opening, which the bin's
// standing room is.
//
// So there are two invariants, and they are independent on purpose. Moving the bin
// somewhere else does not make the proximity proxy right, and fixing the proxy does
// not get the bin out of the entrance lane. Either one alone would leave a way for
// this to come back.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { play, playUntil } from './lib/frames.js';
import { arrived, loadRoom } from './lib/room.js';
import { DOOR } from '../src/config.js';
import { STATIONS } from '../src/layout.js';

before(loadRoom);

// --- the door, as it is actually built ---------------------------------------
//
// Read off buildDoor() in scene/environment.js rather than written down: the leaf
// is hung on the left jamb inset by its own 0.06, and MAX_OPEN swings it toward the
// interior. If the door is ever rebuilt wider, or hinged on the other jamb, these
// come out different and the assertions below move with it.
const HINGE = { x: DOOR.x - DOOR.width / 2 + 0.06, z: 0 };
const LEAF = DOOR.width - 0.12;
const MAX_OPEN = -Math.PI * 0.46;

/** Where the leaf's outer edge ends up once it is fully open. */
const leafTip = () => ({
  x: HINGE.x + LEAF * Math.cos(MAX_OPEN),
  z: HINGE.z - LEAF * Math.sin(MAX_OPEN),
});

/** How far a point is from the open leaf, in the plane of the floor. */
function distanceToOpenLeaf(x, z) {
  const tip = leafTip();
  const dx = tip.x - HINGE.x, dz = tip.z - HINGE.z;
  const len = Math.hypot(dx, dz);
  const along = ((x - HINGE.x) * dx + (z - HINGE.z) * dz) / len;
  // Past either end of the leaf it is the end that is nearest, not the plane.
  if (along <= 0) return Math.hypot(x - HINGE.x, z - HINGE.z);
  if (along >= len) return Math.hypot(x - tip.x, z - tip.z);
  return Math.abs((x - HINGE.x) * dz - (z - HINGE.z) * dx) / len;
}

// A body's half-width (AGENT_RADIUS in agents/crowd.js) plus a little. Standing this
// close to the leaf is standing in it as far as anybody looking at the room is
// concerned, whether or not the meshes technically overlap.
const BODY_CLEARANCE = 0.55;

// The lane the room already refuses to let anybody idle in — see
// `randomInteriorPoint` in agents/pathfinding.js, which is where these two numbers
// come from (DOORWAY_DEPTH, and DOOR_HALF + 0.8).
const inEntranceLane = (x, z) => z < 4.0 && Math.abs(x - DOOR.x) < 2.0;

// --- 1: nobody's standing room is in the doorway -----------------------------

test('the bin is not somewhere the door can swing into', () => {
  const bin = STATIONS.bin;
  const gap = distanceToOpenLeaf(bin.approach.x, bin.approach.z);
  assert.ok(
    gap > BODY_CLEARANCE,
    `standing room at (${bin.approach.x}, ${bin.approach.z}) is ${gap.toFixed(2)} `
    + `from the open leaf; wanted more than ${BODY_CLEARANCE}`,
  );
  // And the bin itself, which the leaf would otherwise sweep the crumples out of.
  assert.ok(distanceToOpenLeaf(bin.x, bin.z) > 0.4, 'the leaf clears the bin');
});

test('the bin is not standing in the way in', () => {
  const bin = STATIONS.bin;
  assert.ok(
    !inEntranceLane(bin.approach.x, bin.approach.z),
    `standing room at (${bin.approach.x}, ${bin.approach.z}) is inside the entrance `
    + 'lane, which the room will not even let a wanderer stop in',
  );
});

test('no station puts its standing room in the door, whatever the room holds', () => {
  // The invariant rather than the instance. The bin is the one that was wrong, but
  // the reason it was wrong is that nothing was checking — so the next prop dragged
  // into the entrance corner fails here instead of on screen.
  for (const s of Object.values(STATIONS)) {
    if (s.approachDist == null) continue;      // dressing: nowhere to stand
    const gap = distanceToOpenLeaf(s.approach.x, s.approach.z);
    assert.ok(gap > BODY_CLEARANCE, `${s.id} stands ${gap.toFixed(2)} from the open leaf`);
    assert.ok(!inEntranceLane(s.approach.x, s.approach.z), `${s.id} stands in the way in`);
  }
});

// --- 2: the door opens for an errand, not for a postcode ---------------------

/** A door that remembers being asked, which is all the manager wants of one. */
function stubDoor() {
  return { asked: 0, requestOpen() { this.asked++; }, update() {} };
}

/** One agent, in through the door and standing about with the coat hung up. */
function office() {
  const door = stubDoor();
  return { ...arrived({ door }), door };
}

// The spot the bin used to stand somebody on: inside the old proximity test, and
// inside the leaf's arc. Used directly rather than via the bin, so this stays a
// test about the door however the furniture is arranged later.
const OLD_BIN_SPOT = { x: 2.6, z: 2.2 };

test('standing by the door on other business does not open it', () => {
  const { manager, rec, door } = office();
  rec.agent.setPositionXZ(OLD_BIN_SPOT.x, OLD_BIN_SPOT.z);
  door.asked = 0;
  manager.update(1 / 60);
  assert.equal(door.asked, 0,
    'the door opened for somebody who was not going through it');
});

test('the door still opens for somebody on their way out', () => {
  const { manager, rec, door } = office();
  rec.agent.setPositionXZ(OLD_BIN_SPOT.x, OLD_BIN_SPOT.z);
  rec.leaving = true;
  door.asked = 0;
  manager.update(1 / 60);
  assert.ok(door.asked > 0, 'somebody walking out was left to open the door themselves');
});

test('the door opens for somebody on their way in', () => {
  // The whole walk in, not just the moment they reach the mat: `arriving` is set from
  // the spawn point outside and cleared once they are through with a coat on a hook,
  // so the leaf is open before they get to it and eases shut behind them.
  const { door } = office();
  // Asked *while* arriving, without watching each frame for it: the count starts at
  // zero and a door only ever gets asked again, so anything above zero by the time the
  // walk is over happened during the walk.
  assert.ok(door.asked > 0, 'nobody opened the door for the new arrival');
});

// --- 3: the reported bug, end to end ----------------------------------------

test('binning failed work never opens the door, and still reaches the bin', () => {
  // The report, as a test. `_discard` walks to the bin's standing room, turns to it,
  // and drops the crumple — so this covers the two ways the fix could be hollow: a
  // door that still swings on somebody who is only binning something, and a bin
  // moved somewhere the walk cannot actually finish.
  const door = stubDoor();
  const crumples = { discarded: 0, discard() { this.discarded++; } };
  const { manager, rec } = arrived({ door, bin: crumples });

  door.asked = 0;
  manager.handleEvent({ type: 'status', id: 'a1', status: 'error' });

  const reached = playUntil(manager, () => crumples.discarded > 0, 60);

  assert.ok(reached !== null, 'the work never reached the bin at all');
  assert.equal(door.asked, 0,
    `the door was asked to open ${door.asked} times during a trip to the bin`);

  // And they got there, rather than the discard firing from wherever the walk gave
  // up: `spots.claim` hands out the floor in front of the bin, a shoulder either way.
  const bin = STATIONS.bin;
  const off = Math.hypot(rec.agent.position.x - bin.approach.x,
    rec.agent.position.z - bin.approach.z);
  assert.ok(off < 1.5, `binned from ${off.toFixed(2)} away from the bin's standing room`);
});

test('an agent at their desk never touches the door', () => {
  // A cheap guard on the quiet case rather than a test of the gate — a desk this far
  // from the opening was outside the old proximity box too. It is here so that a
  // future door that opens on some *other* proxy (a status, a route, a timer) has to
  // get past a settled office leaving it alone for two seconds.
  const { manager, rec, door } = office();
  rec.agent.setPositionXZ(12, 8);
  door.asked = 0;
  play(manager, 2);
  assert.equal(door.asked, 0);
});
