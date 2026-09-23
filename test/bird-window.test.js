// Does the bird fit through the window, and does it ever fly into another bird?
//
// Both faults this pins were visible the moment somebody watched the room and invisible
// to every test that existed: birds crossed the timber at the top of the frame, and two
// birds arriving together flew through each other. Both are geometry, so both can be
// measured — which is the same argument `footprints.test.js` makes about the props, and
// the same one the coplanar probe makes about surfaces at equal depth.
//
// The measurement is a *positive* one: while any drawn part of the bird is inside the
// frame's depth, its whole box must sit inside the clear rectangle of one light
// (`windowLight` in config.js). That is one assertion against one source of truth, and
// it covers the head rail, the sill, both jambs, both mullions and the transom without
// modelling any of them — model the frame here and this file becomes a test of its own
// copy of the frame, which is how the birds came to be flying through it.
//
// Two things need care, and both were wrong in the first version of this:
//
//   * **Only what is drawn counts.** All four species hang on the same perch with three
//     of them hidden, and `Box3.setFromObject` does not care about `visible` — measure
//     the perch and every bird is 3.1 units wide with its wings out.
//   * **The frame has a depth.** A bird is over two units long, so its bounding box can
//     share a mullion's z and y from well inside the room. Only the slab the frame
//     actually occupies is the window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';
import {
  WINDOW_FRAME_D, WINDOW_LIGHTS, windowLight,
} from '../src/config.js';

stubDom();
const THREE = await loadThree();
globalThis.THREE = THREE;

const { BirdFlights, BIRD_KINDS, poseWings, tuckAt } = await import('../src/scene/birds.js');

/** The hole the birds use: middle light, top row. Same choice `birds.js` makes. */
const LIGHT = windowLight('left', 0, 1, WINDOW_LIGHTS.rows - 1);

/** The wall plane, and how far either side of it the timber reaches. */
const WALL_X = 0;
const FRAME_HALF = WINDOW_FRAME_D / 2;

/** A flight's drawn extent: the visible bird and the letter in its talons. */
function drawnBox(slot) {
  const box = new THREE.Box3().setFromObject(slot.bird.root);
  if (slot.letter.visible) box.union(new THREE.Box3().setFromObject(slot.letter));
  return box;
}

/**
 * Walk one flight and hand every sample to `visit`, posed as the render loop poses it.
 *
 * Deliberately not driven through `update()`: that advances on wall-clock deltas, and a
 * frame rate is exactly the thing a geometry check should not depend on. This walks the
 * same curves with the same facing, roll and wing pose at a resolution no real frame
 * rate would reach.
 */
function walkFlight(flights, slot, kind, visit, boxId = null, samples = 600) {
  for (const b of Object.values(slot.birds)) b.root.visible = false;
  slot.birds[kind].root.visible = true;
  slot.bird = slot.birds[kind];
  slot.letter.visible = true;
  flights._aim(slot, boxId);

  const at = (t) => {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return new THREE.Vector3(
      a * slot.p0.x + b * slot.p1.x + c * slot.p2.x + d * slot.p3.x,
      a * slot.p0.y + b * slot.p1.y + c * slot.p2.y + d * slot.p3.y,
      a * slot.p0.z + b * slot.p1.z + c * slot.p2.z + d * slot.p3.z,
    );
  };

  for (const phase of ['in', 'out']) {
    if (phase === 'out') flights._aimOut(slot);
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const pos = at(t);
      const next = at(Math.min(1, t + 1 / samples));
      slot.perch.position.copy(pos);
      const dx = next.x - pos.x, dz = next.z - pos.z;
      if (Math.hypot(dx, dz) > 1e-9) slot.perch.rotation.y = Math.atan2(dx, dz);
      slot.perch.rotation.z = Math.sin(t * Math.PI) * (phase === 'in' ? -0.18 : 0.18);
      // The beat at its widest, which is the pose that has to fit.
      poseWings(slot.bird, tuckAt(pos.x), 0.65);
      slot.perch.updateMatrixWorld(true);
      visit({ phase, t, pos, box: drawnBox(slot) });
    }
  }
}

const flightsFor = () => new BirdFlights(new THREE.Group(), () => null);

test('the light the birds use is a hole, not a pane', () => {
  // If this ever fails the window has been re-divided under the birds, and the entry
  // point they aim at is timber rather than glass.
  assert.ok(LIGHT, 'the middle light of the top row should exist');
  assert.ok(LIGHT.width > 1.8, `the hole is only ${LIGHT.width.toFixed(2)} wide`);
  assert.ok(LIGHT.height > 1.8, `the hole is only ${LIGHT.height.toFixed(2)} tall`);
});

test('a bird with its wings out does not fit through the window, which is why it tucks', () => {
  // The fact the tuck exists for. Asserted so that nobody deletes the gesture as
  // decoration: without it there is no route through this window at all.
  const flights = flightsFor();
  const slot = flights.pool[0];
  slot.perch.position.set(WALL_X, LIGHT.midY, LIGHT.centre);
  slot.perch.rotation.set(0, Math.PI / 2, 0);
  slot.letter.visible = false;

  for (const kind of BIRD_KINDS) {
    for (const b of Object.values(slot.birds)) b.root.visible = false;
    slot.birds[kind].root.visible = true;
    slot.bird = slot.birds[kind];

    poseWings(slot.bird, 0, 0);
    slot.perch.updateMatrixWorld(true);
    const out = drawnBox(slot);
    assert.ok(
      out.max.z - out.min.z > LIGHT.width,
      `${kind} with its wings out is ${(out.max.z - out.min.z).toFixed(2)} across, which would fit`,
    );

    poseWings(slot.bird, 1, 0.65);
    slot.perch.updateMatrixWorld(true);
    const tucked = drawnBox(slot);
    assert.ok(
      tucked.max.z - tucked.min.z < LIGHT.width,
      `${kind} tucked is ${(tucked.max.z - tucked.min.z).toFixed(2)} across, still too wide for ${LIGHT.width.toFixed(2)}`,
    );
  }
});

test('no bird touches the window frame, on the way in or the way out', () => {
  const flights = flightsFor();
  for (const kind of BIRD_KINDS) {
    let sawFrame = false;
    walkFlight(flights, flights.pool[0], kind, ({ phase, t, box }) => {
      // Is any drawn part of it inside the timber's own slab?
      if (box.max.x < WALL_X - FRAME_HALF || box.min.x > WALL_X + FRAME_HALF) return;
      sawFrame = true;
      const where = `${kind} on the way ${phase} at t=${t.toFixed(3)}`;
      assert.ok(box.min.z >= LIGHT.from,
        `${where}: reaches z ${box.min.z.toFixed(2)}, past the light's near edge at ${LIGHT.from.toFixed(2)}`);
      assert.ok(box.max.z <= LIGHT.to,
        `${where}: reaches z ${box.max.z.toFixed(2)}, past the light's far edge at ${LIGHT.to.toFixed(2)}`);
      assert.ok(box.min.y >= LIGHT.y0,
        `${where}: drops to y ${box.min.y.toFixed(2)}, below the light's bottom at ${LIGHT.y0.toFixed(2)}`);
      assert.ok(box.max.y <= LIGHT.y1,
        `${where}: rises to y ${box.max.y.toFixed(2)}, above the light's top at ${LIGHT.y1.toFixed(2)} — the head rail`);
    });
    // A flight that never went through the window would pass the assertions above by
    // never running them, which is the shape of a green test that checks nothing.
    assert.ok(sawFrame, `${kind} never crossed the window at all`);
  }
});

test('and still does not, wherever the box has been dragged to', () => {
  // The claim the path's shape is built on. A route that cleared the frame only for the
  // default mailbox would be a route tuned against one layout, and the box is furniture
  // — it can be dragged to the far corner, or round to the other end of this very wall,
  // which is the case that pulls the curve hardest across the opening.
  const corners = [
    ['far corner', new THREE.Vector3(24, 1.6, 18)],
    ['far end of this wall', new THREE.Vector3(2.4, 1.6, 19)],
    ['under the window', new THREE.Vector3(2.4, 1.6, 10.5)],
    ['near the door', new THREE.Vector3(12, 1.6, 1.2)],
    ['high on a wall', new THREE.Vector3(3, 3.4, 6)],
  ];
  for (const [where, at] of corners) {
    const flights = new BirdFlights(new THREE.Group(), () => ({ slot: at }));
    let sawFrame = false;
    walkFlight(flights, flights.pool[0], 'owl', ({ phase, t, box }) => {
      if (box.max.x < WALL_X - FRAME_HALF || box.min.x > WALL_X + FRAME_HALF) return;
      sawFrame = true;
      const msg = `box ${where}, on the way ${phase} at t=${t.toFixed(3)}`;
      assert.ok(box.min.z >= LIGHT.from && box.max.z <= LIGHT.to,
        `${msg}: z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)} outside ${LIGHT.from.toFixed(2)}..${LIGHT.to.toFixed(2)}`);
      assert.ok(box.min.y >= LIGHT.y0 && box.max.y <= LIGHT.y1,
        `${msg}: y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)} outside ${LIGHT.y0.toFixed(2)}..${LIGHT.y1.toFixed(2)}`);
    }, 'someBox');
    assert.ok(sawFrame, `box ${where}: the bird never crossed the window`);
  }
});

test('the wings are all the way back before the bird reaches the glass', () => {
  // The tuck is keyed off depth rather than off the curve's own t, so a change to the
  // path cannot leave the bird arriving at the frame half-folded.
  assert.equal(tuckAt(WALL_X), 1);
  assert.equal(tuckAt(WALL_X + FRAME_HALF), 1);
  assert.equal(tuckAt(WALL_X - FRAME_HALF), 1);
  // And out again by the time it is over the room.
  assert.equal(tuckAt(6), 0);
  // Monotonic in between, so it reads as one movement.
  let last = 1;
  for (let x = 0; x <= 6; x += 0.05) {
    const now = tuckAt(x);
    assert.ok(now <= last + 1e-9, `the tuck grew again at x=${x.toFixed(2)}`);
    last = now;
  }
});

test('only one bird is ever in the air', () => {
  // Two of them aimed at one hole in one window and then at one slot in one box were
  // not near each other, they were inside each other. The second letter waits.
  const flights = flightsFor();
  assert.equal(flights.launch({ job: 'first' }), true);
  assert.equal(flights.pool.filter((p) => p.active).length, 1);

  for (const job of ['second', 'third']) {
    assert.equal(flights.launch({ job }), true, 'a held letter is still accepted');
  }
  assert.equal(flights.pool.filter((p) => p.active).length, 1, 'still one bird');
  assert.equal(flights.waiting.length, 2, 'the rest are queued, in order');
  assert.deepEqual(flights.waiting.map((p) => p.job), ['second', 'third']);
});

test('the queue drains one flight at a time, oldest first', () => {
  const flights = flightsFor();
  for (const job of ['a', 'b', 'c']) flights.launch({ job });
  assert.equal(flights.pool[0].payload.job, 'a');

  // Finish the flight the way update() does, then let it drain.
  flights.pool[0].active = false;
  flights.update(0.016);
  assert.equal(flights.pool[0].payload.job, 'b', 'the next letter goes up next');
  assert.equal(flights.waiting.length, 1);
  assert.equal(flights.pool.filter((p) => p.active).length, 1, 'and still only one');
});

test('a room with no free bird still takes letters, up to a limit', () => {
  // Unchanged contract: `launch` is false only when the waiting list is full, so a
  // runaway feed cannot grow it without bound and a person pressing the key cannot
  // realistically reach it.
  const flights = flightsFor();
  let accepted = 0;
  for (let i = 0; i < 40; i++) if (flights.launch({ job: `j${i}` })) accepted += 1;
  assert.ok(accepted > 1 && accepted < 40, `accepted ${accepted}`);
  assert.equal(flights.launch({ job: 'one too many' }), false);
});
