// Surveying a room: the plan of a layout, whoever laid it out.
//
// `survey()` is what made the plan drawings general — before it, the only rooms
// that could be drawn were rooms the generator had just made, because the drawing
// read the generator's own working notes. Now it reads the *room*, so
// `node bin/office-plan.js --from=cosy-corner.json` draws a layout somebody
// arranged by hand and a generated office is drawn from the blob it will be
// stored as.
//
// Which means the survey has to agree with two things it does not own: the nav
// grid's idea of what floor is blocked, and the generator's idea of where people
// stand. Both are checked here rather than asserted in a comment.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DESKS, STATIONS, FURNITURE, applyLayout, resetLayout, obstacleFootprints,
} from '../src/layout.js';
import { generateOffice } from '../src/plan/index.js';
import { survey } from '../src/plan/survey.js';
import { ROLES, DESK_BODY } from '../src/plan/floor.js';

beforeEach(() => resetLayout());

test('the authored room surveys as itself', () => {
  const plan = survey();
  const props = plan.rects.filter((r) => r.role === ROLES.PROP);

  // Read, not re-derived: every footprint is the nav grid's own, so a drawing
  // cannot disagree with the room about how much floor a couch takes.
  //
  // Both sides are projected to the same fields. The rectangles carry a `role` and
  // a walker's `berth` as well now, and the survey sets the role itself — so
  // comparing a projection against a raw footprint compares the geometry, which is
  // the claim being made, rather than the bookkeeping around it.
  const geometry = ({
    key, x0, z0, x1, z1, soft,
  }) => ({
    key, x0, z0, x1, z1, soft,
  });
  assert.deepEqual(
    props.map(geometry),
    obstacleFootprints().filter((r) => r.role === ROLES.PROP).map(geometry),
  );

  // Standing *room* comes through as its own rectangle now, one per prop anybody
  // walks up to, and it is what stops another prop being dropped in the way.
  const stands = plan.rects.filter((r) => r.role === ROLES.STAND);
  assert.ok(stands.length > 0, 'no standing room in the survey at all');
  assert.ok(stands.every((r) => r.key.startsWith('stand:')));

  // One standing spot per desk, per station that has standing room, and per
  // piece of lounge seating — and nothing for the coat stand, the side table or
  // the rug, because nobody queues at those.
  const seats = FURNITURE.filter((f) => f.kind === 'couch' || f.kind === 'armchair');
  const queued = Object.values(STATIONS).filter((s) => s.approachDist != null);
  assert.equal(plan.approaches.length, DESKS.length + queued.length + seats.length);
  assert.ok(plan.approaches.every((a) => a.label && Number.isFinite(a.at.x)));

  // And the doorway, which is floor nobody may build on and which no layout
  // mentions, because it belongs to the room rather than to the furniture.
  assert.ok(plan.rects.some((r) => r.role === ROLES.WAY && r.key === 'way:door'));
});

test('a survey follows the layout it is given', () => {
  const before = survey();
  const office = generateOffice('slate-orchard-2210');
  applyLayout(office.layout);
  const after = survey();

  assert.notDeepEqual(
    after.rects.filter((r) => r.role === ROLES.PROP).map((r) => r.key),
    before.rects.filter((r) => r.role === ROLES.PROP).map((r) => r.key),
  );
  // Every desk in the blob is a desk in the survey, on the floor the blob puts it
  // on. Not *centred* on the blob's position: a desk's footprint covers its chair,
  // which sits `DESK_BODY.offZ` behind the desk itself, so the rectangle is centred
  // that far along the way the desk faces. The offset is what lets the rectangle
  // cover the chair without also reaching the same distance into the empty floor in
  // front of the desktop.
  for (const [id, desk] of Object.entries(office.layout.desks)) {
    const rect = after.rects.find((r) => r.key === `desk:${id}`);
    assert.ok(rect, `${id} is missing from the survey`);
    const dir = { x: Math.sin(desk.facing ?? 0), z: Math.cos(desk.facing ?? 0) };
    const want = {
      x: desk.x + dir.x * DESK_BODY.offZ,
      z: desk.z + dir.z * DESK_BODY.offZ,
    };
    assert.ok(Math.abs((rect.x0 + rect.x1) / 2 - want.x) < 0.001, id);
    assert.ok(Math.abs((rect.z0 + rect.z1) / 2 - want.z) < 0.001, id);
  }
});

test('a surveyed generated office is the office the generator planned', () => {
  // The two descriptions of one room: the generator's notes, and the room read
  // back after its blob has been applied. They have to agree, or the drawings are
  // of something other than what gets stored.
  for (const seed of ['sweep-2', 'sweep-31', 'sweep-77']) {
    const office = generateOffice(seed);
    resetLayout();
    applyLayout(office.layout);
    const plan = survey();

    const planned = office.report.rects.filter((r) => r.role === ROLES.PROP);
    const surveyed = plan.rects.filter((r) => r.role === ROLES.PROP);
    assert.deepEqual(
      surveyed.map((r) => r.key).sort(),
      planned.map((r) => r.key).sort(),
      `${seed}: the room holds different props than the plan says`,
    );

    // Standing spots to two decimal places, which is the precision a layout is
    // stored to. Anything further apart than that would mean the survey and the
    // generator disagree about where somebody stands.
    const spots = new Map(plan.approaches.map((a) => [a.label, a.at]));
    for (const spot of office.report.approaches) {
      const found = spots.get(spot.label);
      assert.ok(found, `${seed}: nobody stands at ${spot.label} any more`);
      assert.ok(Math.abs(found.x - spot.at.x) < 0.01 && Math.abs(found.z - spot.at.z) < 0.01,
        `${seed}: ${spot.label} stands somewhere else`);
    }
  }
});
