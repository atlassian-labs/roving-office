// Adding furniture to a room that already has something wrong with it.
//
// The report: "Adding furniture isn't always right. Often I get a 'Nowhere in the room
// to put that' where I just deleted a desk and am trying to re-add. There must be room
// as I just deleted it. Beyond that, rugs should always be able to be added no? Adding
// rugs fails almost all the time."
//
// Both were the same defect. `reachFault` reported the first standing place it could
// not reach, whoever owned it, so one prop stranded by an earlier edit was reported
// against every candidate position of everything added afterwards. A rug proves it: its
// footprint is soft, so it blocks nothing and can strand nobody, yet it could not be
// added either.
//
// These run the editor's own decision — the real `floorFault`, `reachFault`,
// `strandedApproaches` and `candidates`, composed the way `settle` composes them —
// against the real layout and the real nav grid. Before and after differ by one
// argument, the stranded baseline, which is the fix.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';
import {
  candidates, floorFault, reachFault, strandedApproaches,
} from '../src/editor/placement.js';

let NavGrid, buildDesk, layout, DOOR, ROOM;

before(async () => {
  stubDom();
  await loadThree();
  ({ NavGrid } = await import('../src/agents/pathfinding.js'));
  ({ buildDesk } = await import('../src/scene/props/desk.js'));
  layout = await import('../src/layout.js');
  ({ DOOR, ROOM } = await import('../src/config.js'));
});

/** One grid for the room under test, as the editor keeps one `probe`. */
let nav;

beforeEach(() => {
  layout.resetLayout();
  nav = new NavGrid();
});

const deskProps = new Map();

/**
 * A desk's standing room, off the built prop.
 *
 * Off the prop because that is where the editor reads it: a desk's approach point is
 * derived by `buildDesk` and not by the layout, so recomputing it here would be a
 * second derivation free to disagree with the first. Cached on everything that moves
 * it, so a desk that has been dragged is rebuilt and one that has not is reused —
 * building all five per candidate position made an early draft of this file take 37
 * seconds, all of it in geometry no assertion looked at.
 */
function deskApproach(desk, i) {
  const id = `${desk.id}:${desk.x},${desk.z},${desk.facing}`;
  if (!deskProps.has(id)) deskProps.set(id, buildDesk({ ...desk }, i).handle);
  return deskProps.get(id).approach;
}

/** Every standing place in the room, the way the editor's own `approaches()` reads them. */
function approaches() {
  const out = [];
  layout.DESKS.forEach((d, i) => out.push({ label: d.id, at: deskApproach(d, i) }));
  for (const [key, s] of Object.entries(layout.STATIONS)) {
    if (s.approachDist != null) out.push({ label: key, at: s.approach });
  }
  for (const f of layout.FURNITURE) {
    if (layout.FURNITURE_KINDS[f.kind]?.seatOffsets) out.push({ label: f.id, at: f.approach });
  }
  return out;
}

const stranded = () => strandedApproaches(approaches(), nav, DOOR.inside);

const reachOf = (key, baseline, soft = false) => reachFault({
  key, approaches: approaches(), nav, from: DOOR.inside, stranded: baseline, soft,
});

const floorOf = (key) => floorFault(key, layout.obstacleFootprints(), ROOM);

/**
 * Wall the coffee machine off with a floor lamp, and nothing else wrong.
 *
 * This is how a real room reaches the state that caused the bug: `applyLayout`
 * validates nothing, so a hand-edited plan — or one saved before a station existed —
 * can strand something no drag would ever have been allowed to strand.
 *
 * A lamp because it is the smallest thing that does the job, and it works by
 * narrowing the way down the left-hand side of the room until the nav grid can no
 * longer get a walker through it to the machine.
 *
 * **It moved from (4.0, 16.8) to (4.2, 17.4)**, and the reason is the
 * point of this test rather than an inconvenience. Standing room is a rectangle a
 * prop may not be dropped into now, and the old spot sat squarely in the coffee
 * machine's way in — so the editor refuses it outright, by a rectangle test, before
 * any flood fill runs. Which is the new rule working. But it makes the old spot
 * useless *here*, because what this file is about is the other half of the verdict:
 * a piece placed perfectly legally that nevertheless walls a machine off, which
 * only a flood fill can see. The new spot clears every rectangle and still strands
 * the machine.
 *
 * The coffee machine rather than the printer, which was the first choice and taught
 * something worth writing down: the nav grid is a half-unit lattice, so blocking a
 * *point* means blocking the cell it falls in, and a rectangle that clears a
 * neighbouring standing place by 0.15 can still swallow the cell that place sits in.
 * A lamp by the printer stranded desk-2 as well, from 0.15 away.
 */
const LAMP = { x: 4.2, z: 17.4 };
const VICTIM = 'coffee';

function strandTheCoffee() {
  layout.applyLayout({
    layout: 3,
    furniture: { 'floorLamp-2': { kind: 'floorLamp', ...LAMP } },
  });
  layout.reviseLayout();
}

/** The editor's `settle` loop, with the two checks it actually uses. */
function trySettle(kit, { baseline, from, soft } = {}) {
  const was = baseline ?? new Set();
  const made = layout.addObject(kit, {});
  assert.ok(made, `the layout would not make a ${kit} at all`);
  const rect = layout.obstacleFootprints().find((r) => r.key === made.key);
  const extent = rect ? { hw: (rect.x1 - rect.x0) / 2, hd: (rect.z1 - rect.z0) / 2 } : null;
  const skipReach = soft ?? !!rect?.soft;

  let tried = 0;
  for (const at of candidates({
    room: ROOM, snap: 0.25, turns: 'facing' in made.spec, from, extent,
  })) {
    tried++;
    made.spec.x = at.x;
    made.spec.z = at.z;
    if ('facing' in made.spec) made.spec.facing = at.facing;
    layout.reviseLayout();
    if (floorOf(made.key)) continue;
    if (reachOf(made.key, was, skipReach)) continue;
    return { placed: { x: at.x, z: at.z }, tried, key: made.key };
  }
  return { placed: null, tried, key: made.key };
}

// --- the room as it ships ----------------------------------------------------

test('the authored room strands nobody', () => {
  assert.deepEqual([...stranded()], [],
    'the shipped room should be sound; everything below is measured against that');
});

// --- the defect --------------------------------------------------------------

test('one stranded machine is one fault, and the lamp itself is placed legally', () => {
  strandTheCoffee();
  assert.deepEqual([...stranded()], [VICTIM]);
  // The lamp is on the floor and overlaps nothing, so the room's only complaint is the
  // standing place it covers. Asserted of the lamp rather than of every rectangle in
  // the room, because the authored room *already* has the side table overlapping the
  // end of the couch — deliberately, that is where a table by a sofa goes. Which is
  // the same point `floorFault` is built around: a room may carry a pre-existing
  // overlap, and only faults involving the piece in hand are anybody's business.
  assert.equal(floorOf('furniture:floorLamp-2'), null);
});

test('a rug could not be added to such a room, and now can — twice over', () => {
  strandTheCoffee();
  const baseline = stranded();

  // Three runs, because a rug is now fixed by either half of this on its own and the
  // test would be worthless if it could not tell them apart. `soft` is the piece's own
  // rectangle blocking nothing; `baseline` is the room's existing fault being the
  // room's problem. Only with neither does the bug come back.
  const attempt = (opts) => {
    layout.resetLayout();
    strandTheCoffee();
    return trySettle('furniture:rug', opts);
  };
  assert.equal(attempt({ soft: false }).placed, null,
    'with neither fix a rug should still be refused — the bug is not reproduced');
  assert.ok(attempt({ soft: false, baseline }).placed,
    'the stranded baseline alone should let a rug in');
  assert.ok(attempt({}).placed,
    'and so should knowing a soft rectangle cannot strand anybody');
});

test('a desk could not be added either, and now can', () => {
  strandTheCoffee();
  const baseline = stranded();
  // A desk blocks floor, so the exemption above does not apply to it: the baseline is
  // the only thing standing between this room and refusing every desk for ever.
  assert.equal(trySettle('desk').placed, null, 'the bug is not reproduced for a desk');

  layout.resetLayout();
  strandTheCoffee();
  assert.ok(trySettle('desk', { baseline }).placed,
    'the room has open floor; a desk should go somewhere on it');
});

test('the offending prop can still be dragged out of the way', () => {
  // The room has to be fixable by hand, which is the baseline mattering in the other
  // direction: if the room's own fault refused every drop, the lamp causing it would be
  // stuck exactly where it needs to be dragged from.
  strandTheCoffee();
  const baseline = stranded();
  assert.deepEqual([...baseline], [VICTIM]);

  // Open floor between desk-1, desk-3 and the water cooler, clear of all three.
  const lamp = layout.FURNITURE.find((f) => f.id === 'floorLamp-2');
  lamp.x = 7.0;
  lamp.z = 8.0;
  layout.reviseLayout();

  assert.equal(floorOf('furniture:floorLamp-2'), null);
  assert.equal(reachOf('furniture:floorLamp-2', baseline), null,
    'dragging the offending lamp clear should be allowed');
  assert.deepEqual([...stranded()], [], 'and doing so fixes the room');
});

// --- what must still be refused ---------------------------------------------

test('a piece that strands a machine is still refused', () => {
  // The whole purpose of the reachability check, and the thing a fix like this could
  // easily throw away. The room starts sound, so nothing is forgiven.
  const baseline = stranded();
  assert.equal(baseline.size, 0, 'the authored room forgives nothing, because nothing is wrong');

  assert.ok(layout.addFurniture('floorLamp', { id: 'floorLamp-2', ...LAMP }));
  layout.reviseLayout();

  const fault = reachOf('furniture:floorLamp-2', baseline);
  assert.ok(fault, "a lamp on the coffee machine's standing room must still be refused");
  assert.match(fault.why, new RegExp(VICTIM));
});

test('a rug is exempt from the reach check because it cannot fail it', () => {
  // Not merely an optimisation: the nav grid skips soft rectangles when it is built, so
  // a fill with the rug in place is a fill over the identical room. Asserted both ways
  // round, so the exemption cannot quietly start hiding a real fault.
  const rug = layout.addFurniture('rug', { id: 'rug-2', x: 13, z: 10 });
  layout.reviseLayout();
  const baseline = stranded();
  assert.equal(reachOf(`furniture:${rug.id}`, baseline, true), null);
  assert.equal(reachOf(`furniture:${rug.id}`, baseline, false), null,
    'and it would have passed anyway, which is what makes skipping it safe');
});

// --- delete a desk, add a desk ----------------------------------------------

test('a desk goes back into the hole the last one left', () => {
  // The headline complaint. desk-3 is dragged to a quarter-unit position first, which is
  // what a real session does and what the lattice alone could never revisit.
  const desk = layout.DESKS.find((d) => d.id === 'desk-3');
  desk.x = 6.75;
  desk.z = 13.25;
  layout.reviseLayout();
  const hole = { x: desk.x, z: desk.z };

  assert.ok(layout.removeObject('desk:desk-3'));
  layout.reviseLayout();

  const out = trySettle('desk', { baseline: stranded(), from: hole });
  assert.deepEqual(out.placed, hole, 'a desk should go back exactly where the last one was');
  assert.equal(out.tried, 1, 'and be the first thing tried, not the hundredth');
});

test('the hole is a suggestion, not an instruction', () => {
  // Deleting something in a corner and adding something big must not force the big
  // thing into the corner: `from` is offered to the same checks as every other
  // candidate, and a 9-by-7 rug centred at (2, 3) would hang four units off the floor.
  const corner = { x: 2, z: 3 };
  const out = trySettle('furniture:rug', { baseline: stranded(), from: corner });
  assert.ok(out.placed, 'a rug should still land somewhere');
  assert.notDeepEqual(out.placed, corner, 'and not in a hole it does not fit in');
  assert.equal(floorOf(out.key), null, 'wherever it landed, it is wholly on the floor');
});
