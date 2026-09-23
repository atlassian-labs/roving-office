// The telescope: the room's second research station.
//
// Three things here are worth a test, and they are all *agreements between files* —
// which is the only kind of thing about a prop that a headless test can check and the
// only kind that breaks silently. What the thing looks like is checked by looking at it
// (docs/images/objects/telescope.png, and the gallery in docs/item-movements.html).
//
//   * The tube has to clear the window it is aimed through. The eyepiece height and the
//     pitch are chosen in scene/props/telescope.js for the pose and the silhouette; the
//     window is set in config.js for the wall. Nothing connects them but arithmetic.
//   * The pose has to reach the eyepiece. `STOOP_BEND` is derived from `EYE_Y`, so this
//     is really a test that the derivation is the right one — that bending by that much
//     puts an eye where the prop put its eyepiece.
//   * The footprint has to cover what an agent can walk into, and no more. The
//     objective overhangs the legs by a metre — but overhead, which is the correction
//     these tests now carry: an over-deep rectangle is symmetric, so it steals the floor
//     on the room side and pushes the standing room out of reach of the eyepiece.
//   * The tube has to be aimed through a pane rather than at a mullion, and to pass over
//     the planted sill rather than through it. Both are adjacencies to things set
//     elsewhere for their own reasons.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW_SILL_Y, WINDOW_HEAD_Y, WINDOWS, ROOM, windowSpan } from '../src/config.js';
import { STATION_KINDS, STATIONS, stationsOfKind, windowTroughPlacements } from '../src/layout.js';
import { EYE_Y as EYEPIECE_Y, TUBE_PITCH, FOOT_REACH, telescopeMetrics } from '../src/scene/props/telescope.js';
import { AGENT_EYE_Y, STOOP_BEND } from '../src/agents/Agent.js';

/** How far forward a stoop carries an eye — the same arithmetic as test/stoop.test.js. */
const STOOP_CARRY = (AGENT_EYE_Y - 0.9) * Math.sin(STOOP_BEND);

const metrics = telescopeMetrics();
const scope = STATIONS.telescope;
const def = STATION_KINDS.telescope;

// --- it is aimed through the glass -------------------------------------------

test('the objective looks out over the sill, not at the plaster under it', () => {
  assert.ok(metrics.objectiveY > WINDOW_SILL_Y,
    `the lens is at ${metrics.objectiveY.toFixed(2)}, below the sill at ${WINDOW_SILL_Y}`);
  assert.ok(metrics.objectiveY < WINDOW_HEAD_Y,
    'and not above the head of the opening, which is the wall again');
});

test('the tube is pitched up, so a positive rotation lifts the far end', () => {
  // The sign that was wrong first time round: with the pitch the other way the
  // objective dips into the floor and the eyepiece stands above an agent's head.
  assert.ok(TUBE_PITCH > 0);
  assert.ok(metrics.objectiveY > metrics.eyeY,
    'the end pointing out of the window must be the high end');
});

test('the lens reaches the glass without being buried in the wall', () => {
  // The station's z is derived from this overhang in layout.js, so this is the check
  // that the derivation still holds after either number moves.
  const innerFace = ROOM.wallT / 2;
  const lensZ = scope.z - metrics.reach;
  assert.ok(lensZ < innerFace + 0.2,
    `the lens sits ${(lensZ - innerFace).toFixed(2)} off the glass — too far back to be at it`);
  assert.ok(lensZ > innerFace - 0.3,
    `the lens is ${(innerFace - lensZ).toFixed(2)} into the plaster`);
});

// --- it is at the window near the printer ------------------------------------

test('it stands at the window the printer stands at', () => {
  const win = windowSpan('back', 1);
  assert.ok(scope.x - def.hw > win.from && scope.x + def.hw < win.to,
    `the tripod at ${scope.x} ± ${def.hw} is not wholly inside the opening ${win.from}..${win.to}`);
  // The same opening the printer is at, which is what "near the printer" means here:
  // the room has two back windows and this is the one with the machine at its end.
  assert.ok(STATIONS.printer.x > win.from && STATIONS.printer.x < win.to,
    'the printer moved off this window, so "near the printer" now means somewhere else');
  assert.equal(WINDOWS.back.length, 2, 'a third back window would need this choice re-made');
});

test('it looks out of the middle of the middle pane', () => {
  // An opening is three lights across (`cols` in `buildWindow`), and a tube aimed at
  // the join between two of them is aimed at a mullion. Derived from `windowSpan` so a
  // window that moves takes the telescope with it, rather than asserting 18.2.
  const win = windowSpan('back', 1);
  const paneW = win.width / 3;
  const middle = win.from + paneW * 1.5;
  assert.ok(Math.abs(scope.x - middle) < 0.01,
    `the tube is at ${scope.x} and the middle pane's centre is ${middle.toFixed(2)}`);

  // And it is the whole tube inside that pane, not just its centre line: a dew shield
  // overlapping the next light would undo the point of centring it.
  const TUBE_R = 0.17;
  assert.ok(scope.x - TUBE_R > win.from + paneW && scope.x + TUBE_R < win.from + paneW * 2,
    'the tube is wider than the pane it is centred in');
});

test('it clears the neighbours it was measured against', () => {
  const gap = (a, b) => Math.abs(a.x - b.x)
    - (STATION_KINDS[a.kind].hw + STATION_KINDS[b.kind].hw);
  assert.ok(gap(scope, STATIONS.bookshelf) > 0.5, 'too close to the bookshelf');
  assert.ok(gap(scope, STATIONS.printer) > 0.5, 'too close to the printer');
  // The bin used to be the tight one, at 19.0 — it is in the corner past the printer
  // now, and its going is what freed this pane. Checked anyway, because "the bin is
  // nowhere near" is the assumption this placement rests on.
  assert.ok(gap(scope, STATIONS.bin) > 2.0, 'the bin came back to the window');
});

test('the tube passes over the planted sill, not through it', () => {
  // The one adjacency nothing else would catch: the trough on this window is pushed to
  // the far end (`align: 1` in WINDOW_TROUGHS) and its sill board reaches back to
  // within 0.03 of the tube in x. That is close enough to be worth a test — and the
  // reason it is nonetheless safe is height, not that sliver, so height is what is
  // asserted. The board sits on the ledge; the tube is most of a metre above it by the
  // time it gets there.
  const trough = windowTroughPlacements().find((t) => Math.abs(t.x - 20.05) < 0.5);
  assert.ok(trough, 'the trough moved off this window, so this test is about nothing');

  // Height of the tube's axis where it crosses the trough's own z.
  const pivotY = metrics.eyeY + 0.55 * Math.sin(TUBE_PITCH);
  const along = (scope.z - trough.z) / Math.cos(TUBE_PITCH);
  const tubeY = pivotY + along * Math.sin(TUBE_PITCH);
  assert.ok(tubeY - 0.17 > trough.y + 0.4,
    `the tube's underside is at ${(tubeY - 0.17).toFixed(2)} over a ledge at `
    + `${trough.y.toFixed(2)} — too low to be clearing the planting`);
});

// --- the footprint covers what actually overhangs ----------------------------

test('the footprint is the tripod, because the tube overhangs it overhead', () => {
  // The footprint covers the feet, which is what this has always been about — but
  // it is checked against the feet and no longer against the circle they stand on.
  //
  // `hw >= FOOT_REACH` was the old test and it demands the rectangle contain a
  // circle of the tripod's full radius. Three legs at a hundred and twenty degrees
  // never put a foot at the widest point of that circle, so the real bounding box
  // is smaller than the circle in one axis, and the footprint is now measured off
  // the geometry (`BODIES` in src/layout.js) rather than chosen to bound it. That
  // the rectangle contains every part of the prop is asserted directly, over every
  // prop in the room, by `node bin/footprint-audit.js --check` in
  // test/footprints.test.js — which is a stronger claim than this one was.
  //
  // What is still worth asserting here is that the tripod is the *widest* thing
  // about the telescope at floor level, because the rest of the test depends on it.
  assert.ok(def.hw > 0.5 && def.hd > 0.5,
    `the footprint has collapsed to ${def.hw} x ${def.hd}`);
  assert.ok(Math.max(def.hw, def.hd) >= FOOT_REACH * 0.9,
    `the feet reach ${FOOT_REACH.toFixed(2)} and the footprint is only `
    + `${def.hw} x ${def.hd} — it is no longer the tripod`);

  // The claim the footprint rests on, and the one that was wrong first time round: the
  // part of the tube low enough for an agent to walk into is *inside* the tripod's own
  // footprint, and everything beyond that is genuine headroom over their head. If the
  // pitch or the tripod ever changes enough to break this, `hd` has to grow to cover
  // the overhang again — and the standing room has to move back with it.
  const HEAD_TOP = 2.51;
  const pivotY = metrics.eyeY + (0.55 * Math.sin(TUBE_PITCH));
  // How far along the tube its underside rises past a head, converted to plan distance.
  const along = (HEAD_TOP - (pivotY - 0.17)) / Math.sin(TUBE_PITCH);
  const lowUntil = Math.max(0, along) * Math.cos(TUBE_PITCH);
  assert.ok(lowUntil < FOOT_REACH,
    `the tube is at head height out to ${lowUntil.toFixed(2)}, past the feet at `
    + `${FOOT_REACH.toFixed(2)} — the footprint has to cover the overhang after all`);
  assert.ok(metrics.reach > FOOT_REACH,
    'the tube no longer overhangs the tripod, so this test is about nothing');
});

test('the standing room puts an eye at the eyepiece', () => {
  // The number the first version got wrong, and the reason: an over-deep footprint
  // pushed the approach back, and an agent stooped at an eyepiece three quarters of a
  // metre in front of them. Derived here from the pose rather than asserted as a
  // constant, so the two cannot drift.
  assert.ok(scope.approach, 'a station agents walk to needs somewhere to stand');
  const cupZ = scope.z + metrics.back;
  const eyeZ = scope.approach.z - STOOP_CARRY;
  const gap = eyeZ - cupZ;
  // Measured to the *face*, not the eye-point. An eye here is the head's centre and the
  // head is a 0.62 box, so a gap of half that is a face on the cup — which is the error
  // both earlier versions of this number made, in opposite directions.
  //
  // In plan, which is what standing room is in. Along the tilted tube the face and the
  // cup actually overlap by about 0.04, and that is wanted rather than tolerated: an
  // eye at an eyepiece is touching it, and the alternative is a visible gap between a
  // face and the thing it is supposed to be looking through.
  const HEAD_HALF = 0.31;
  assert.ok(gap > HEAD_HALF,
    `a stooping eye lands ${gap.toFixed(2)} from the cup, inside the ${HEAD_HALF} `
    + 'half-depth of its own head — the face is in the eyepiece');
  assert.ok(gap < HEAD_HALF + 0.25,
    `and ${(gap - HEAD_HALF).toFixed(2)} of air past that is too far to be looking `
    + 'through it');

  // And the height agrees, which is what STOOP_BEND is derived for.
  assert.ok(Math.abs(metrics.eyeY - EYEPIECE_Y) < 1e-9);
});

test('the standing room is still clear of the footprint', () => {
  assert.ok(scope.approach.z - (scope.z + def.hd) > 0.2,
    'the standing room is inside the footprint, which the nav grid will not like');
});

// --- one telescope in the authored room --------------------------------------

test('the authored room has exactly one, and it may have more', () => {
  assert.equal(stationsOfKind('telescope').length, 1);
  assert.equal(def.max, Infinity, 'looking things up is not something one place must do');
  assert.deepEqual(def.roles, ['research']);
  assert.deepEqual(def.serves, ['web']);
});
