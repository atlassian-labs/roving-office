// Somebody sitting on the couch, measured rather than looked at.
//
// The report this exists for was "the character's legs go through the couch", and it
// was true: the cushion sat at 1.105, higher than a standing agent's hip, so a sitter's
// knees and shins were inside the front panel and their feet dangled two thirds of a
// metre off the floor. Both halves of that are geometry, so both can be held down.
//
// The couch and the agent are built for real here — the same builders the room uses —
// and the boxes are measured in world space. Nothing is asserted about how either one
// is *drawn*, only about where the two of them end up relative to each other, which is
// the thing that was wrong and the thing that has to stay right if either is retuned.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';
import { play } from './lib/frames.js';

let THREE, buildArmchair, buildCouch, mountArmchair, COUCH_SEAT_HEIGHT, upholstery;
let Agent, FURNITURE_KINDS;
let AgentController, sit, stand, stepTo;

before(async () => {
  stubDom();
  THREE = await loadThree();
  ({
    buildArmchair, buildCouch, mountArmchair, COUCH_SEAT_HEIGHT, upholstery,
  } = await import('../src/scene/props/couch.js'));
  ({ Agent } = await import('../src/agents/Agent.js'));
  ({ FURNITURE_KINDS } = await import('../src/layout.js'));
  ({ AgentController, sit, stand, stepTo } = await import('../src/agents/states.js'));
});

/** A couch at the origin, facing +z, with the seats the room would give it. */
function couchAtOrigin() {
  const kind = FURNITURE_KINDS.couch;
  const spec = {
    id: 'couch', kind: 'couch', x: 0, z: 0, facing: 0,
    approach: { x: 0, z: kind.approachDist },
    seats: kind.seatOffsets.map((o) => ({
      x: o.x, z: o.z, rotation: 0, front: { x: o.x, z: kind.hd + 0.6 },
    })),
  };
  const built = buildCouch(spec);
  built.obj.updateMatrixWorld(true);
  return built;
}

function armchairAtOrigin() {
  const kind = FURNITURE_KINDS.armchair;
  const spec = {
    id: 'armchair', kind: 'armchair', x: 0, z: 0, facing: 0,
    approach: { x: 0, z: kind.approachDist },
    seats: kind.seatOffsets.map((o) => ({
      x: o.x, z: o.z, rotation: 0, front: { x: o.x, z: kind.hd + 0.4 },
    })),
  };
  const built = buildArmchair(spec);
  built.obj.updateMatrixWorld(true);
  return built;
}

/** Somebody sat down on that seat, the way `sitDownOn` does it. */
function sitterOn(seat) {
  const agent = new Agent({ id: 'sitter', name: 'Sitter' });
  agent.setPositionXZ(seat.position.x, seat.position.z);
  agent.setRotation(seat.rotation);
  // Settled, not settling: these measure where somebody ends up. The journey has its
  // own test below.
  agent.setSeated(true, { seatHeight: COUCH_SEAT_HEIGHT, instant: true });
  agent.root.updateMatrixWorld(true);
  return agent;
}

/** The world-space box of everything below the knee: shins and feet. */
function lowerLegBox(agent) {
  const box = new THREE.Box3();
  for (const knee of agent.knees) {
    knee.updateMatrixWorld(true);
    knee.traverse((n) => { if (n.isMesh) box.expandByObject(n); });
  }
  return box;
}

/** The world-space box of the couch's frame — the part legs used to be inside. */
function frameBox(obj) {
  const box = new THREE.Box3();
  obj.traverse((n) => {
    // The frame is everything the sitter is *on* or beside, which is all of it: the
    // question is only whether a shin is inside any of it.
    if (n.isMesh) box.expandByObject(n);
  });
  return box;
}

test('a sitter’s shins and feet are in front of the couch, not inside it', () => {
  const { obj, handle } = couchAtOrigin();
  const agent = sitterOn(handle.seats[0]);
  const legs = lowerLegBox(agent);
  const couch = frameBox(obj);
  // The whole of the lower leg is forward of the couch's front face. `min.z` is the
  // back of the shin, so this is the strict version: nothing below the knee is even
  // level with the front panel, let alone behind it.
  assert.ok(legs.min.z >= couch.max.z,
    `shins start at z ${legs.min.z.toFixed(3)}, couch ends at ${couch.max.z.toFixed(3)}`);
});

test('and their feet are on the floor, give or take a shadow', () => {
  const { handle } = couchAtOrigin();
  const agent = sitterOn(handle.seats[0]);
  const legs = lowerLegBox(agent);
  assert.ok(legs.min.y >= -0.01, `feet at ${legs.min.y.toFixed(3)}, below the floor`);
  assert.ok(legs.min.y < 0.2,
    `feet ${legs.min.y.toFixed(3)} off the floor — that is a dangle, not a sit`);
});

test('the cushion is a seat an agent could get onto', () => {
  // Below the hip they stand at, or it is a stool. This is the number the whole fix
  // turns on, and the one that was wrong.
  assert.ok(COUCH_SEAT_HEIGHT < 0.9,
    `a seat at ${COUCH_SEAT_HEIGHT} is higher than a standing agent's hip`);
});

test('both seats are on their own cushion, not on the frame between them', () => {
  const { obj, handle } = couchAtOrigin();
  const cushions = [];
  obj.traverse((n) => {
    // The cushions are the only meshes that are not the frame colour. Asked of the
    // builder rather than written down: the seat is the body colour lifted toward white,
    // and a sofa can be upholstered in any of six.
    if (n.isMesh && n.material?.color?.getHex() === upholstery(null).cushion) cushions.push(n);
  });
  assert.equal(cushions.length, 2, 'two cushions');
  for (const seat of handle.seats) {
    const on = cushions.some((cu) => {
      const b = new THREE.Box3().setFromObject(cu);
      return seat.position.x >= b.min.x && seat.position.x <= b.max.x
        && seat.position.z >= b.min.z && seat.position.z <= b.max.z;
    });
    assert.ok(on, `seat at ${seat.position.x}, ${seat.position.z} is not on a cushion`);
  }
});

test('the armchair has one bookable seat on its one cushion', () => {
  const { obj, handle } = armchairAtOrigin();
  const cushions = [];
  obj.traverse((n) => {
    if (n.isMesh && n.material?.color?.getHex() === upholstery(null).cushion) cushions.push(n);
  });
  assert.equal(handle.seats.length, 1);
  assert.equal(cushions.length, 1);
  const seat = handle.freeSeat();
  assert.ok(seat);
  seat.occupiedBy = 'one';
  assert.equal(handle.freeSeat(), null);
});

test('an armchair sitter clears the frame on the same geometry as the couch', () => {
  const { obj, handle } = armchairAtOrigin();
  const legs = lowerLegBox(sitterOn(handle.seats[0]));
  const chair = frameBox(obj);
  assert.ok(legs.min.z >= chair.max.z,
    `shins start at z ${legs.min.z.toFixed(3)}, armchair ends at ${chair.max.z.toFixed(3)}`);
});

test('the editor mount registers the armchair as somewhere agents may sit', () => {
  const kind = FURNITURE_KINDS.armchair;
  const spec = {
    id: 'armchair', kind: 'armchair', x: 3, z: 4, facing: 0,
    approach: { x: 3, z: 4 + kind.approachDist },
    seats: [{ x: 3, z: 4 - 0.05, rotation: 0, front: { x: 3, z: 4 + kind.hd + 0.4 } }],
  };
  const handles = { couches: [] };
  const obj = mountArmchair(spec, handles, 'Armchair');
  assert.equal(obj.userData.movable.key, 'furniture:armchair');
  assert.equal(handles.couches.length, 1);
  assert.equal(handles.couches[0].couch.kind, 'armchair');
});

// --- and the way down ------------------------------------------------------
//
// The report these are for: "for a moment the legs flash under the couch cushion, and
// the character jumps from the motion of sitting to the final place of static sitting."
// Two faults in one movement — the last step was taken standing, so a standing pair of
// legs swept through the frame, and the sit itself happened in a single frame.
//
// Both are about the frames *between* standing and sitting, so both are tested by
// running the real action through the real controller a frame at a time.

/** Every frame of somebody lowering themselves onto `seat`, from the floor in front. */
function lowerOnto(seat, frames = 60, dt = 1 / 60) {
  const agent = new Agent({ id: 'sitter', name: 'Sitter' });
  agent.setPositionXZ(seat.front.x, seat.front.z);
  agent.setRotation(seat.rotation);
  const controller = new AgentController(agent, { findPath: (_f, t) => [t.clone()] });
  controller.run([sit(seat.rotation, COUCH_SEAT_HEIGHT, seat.position)]);
  const shots = [];
  for (let i = 0; i < frames; i++) {
    controller.update(dt);
    agent.root.updateMatrixWorld(true);
    shots.push({ y: agent.body.position.y, legs: lowerLegBox(agent) });
  }
  return shots;
}

test('sitting down is a movement, not a cut', () => {
  const { handle } = couchAtOrigin();
  const shots = lowerOnto(handle.seats[0]);
  const drops = shots.map((s, i) => (i ? shots[i - 1].y - s.y : 0)).slice(1);
  const total = shots[0].y - shots[shots.length - 1].y;
  assert.ok(total > 0.3, `barely descended: ${total.toFixed(3)}`);
  // No single frame covers most of the descent, which is what a snap looks like from
  // here. At sixty frames a second the biggest step should be a small fraction of it.
  const worst = Math.max(...drops);
  assert.ok(worst < total * 0.25,
    `one frame dropped ${worst.toFixed(3)} of ${total.toFixed(3)} — that is a jump`);
  assert.ok(drops.filter((d) => d > 1e-6).length > 10, 'and it takes real frames to do');
});

test('and the legs never pass through the couch on the way down', () => {
  const { obj, handle } = couchAtOrigin();
  const couch = frameBox(obj);
  for (const [i, shot] of lowerOnto(handle.seats[0]).entries()) {
    // Same test as the settled one, applied to every frame of the descent: nothing
    // below the knee is ever level with the couch's front panel, let alone behind it.
    assert.ok(shot.legs.min.z >= couch.max.z,
      `frame ${i}: shins at z ${shot.legs.min.z.toFixed(3)}, couch ends at ${couch.max.z.toFixed(3)}`);
  }
});

test('the same lowering movement stays clear of the armchair', () => {
  const { obj, handle } = armchairAtOrigin();
  const chair = frameBox(obj);
  const shots = lowerOnto(handle.seats[0]);
  assert.ok(shots[0].y - shots.at(-1).y > 0.3, 'the sitter lowers onto the cushion');
  for (const [i, shot] of shots.entries()) {
    assert.ok(shot.legs.min.z >= chair.max.z,
      `frame ${i}: shins at z ${shot.legs.min.z.toFixed(3)}, armchair ends at ${chair.max.z.toFixed(3)}`);
  }
});

test('getting up keeps the feet planted and brings the hips forward', () => {
  // The other half of the same report, twice over. First they rose and slid forward at
  // once; then, held still, they rose with their feet dragging backwards across the
  // floor. Neither is standing up. Standing up is the feet staying exactly where they
  // are while the body comes up over them, so that is what is measured: the foot, in
  // world space, frame by frame.
  const { handle } = couchAtOrigin();
  const seat = handle.seats[0];
  const agent = new Agent({ id: 'riser', name: 'Riser' });
  agent.setPositionXZ(seat.position.x, seat.position.z);
  agent.setRotation(seat.rotation);
  agent.setSeated(true, { seatHeight: COUCH_SEAT_HEIGHT, instant: true });
  agent.root.updateMatrixWorld(true);

  const controller = new AgentController(agent, { findPath: (_f, t) => [t.clone()] });
  controller.run([stand(), stepTo(seat.front)]);

  const footAt = () => {
    agent.root.updateMatrixWorld(true);
    return lowerLegBox(agent).min.clone();
  };
  const planted = footAt();
  const hipZ = agent.position.z;
  let rising = 0;
  let worstDrift = 0;
  for (let i = 0; i < 90; i++) {
    controller.update(1 / 60);
    if (agent.seatBlend <= 0) break;
    rising++;
    const foot = footAt();
    worstDrift = Math.max(worstDrift, Math.abs(foot.z - planted.z));
  }
  assert.ok(rising > 10, 'rising takes real frames');
  // A millimetre at this scale. Anything more is a foot sliding.
  assert.ok(worstDrift < 0.01,
    `feet slid ${worstDrift.toFixed(4)} while standing up`);
  assert.ok(agent.position.z > hipZ + 0.3,
    `hips only came forward ${(agent.position.z - hipZ).toFixed(3)}`);
});

test('and only then do they walk away from the couch', () => {
  const { handle } = couchAtOrigin();
  const seat = handle.seats[0];
  const agent = new Agent({ id: 'riser', name: 'Riser' });
  agent.setPositionXZ(seat.position.x, seat.position.z);
  agent.setRotation(seat.rotation);
  agent.setSeated(true, { seatHeight: COUCH_SEAT_HEIGHT, instant: true });
  const controller = new AgentController(agent, { findPath: (_f, t) => [t.clone()] });
  controller.run([stand(), stepTo(seat.front)]);
  play(controller, 2);
  assert.ok(Math.abs(agent.position.z - seat.front.z) < 0.05,
    `ended at ${agent.position.z.toFixed(2)}, not the standing spot ${seat.front.z.toFixed(2)}`);
});

test('sitting down keeps the feet planted too, once the folding starts', () => {
  // The mirror of standing up, and asked for as one: walk to where the feet will end
  // up, turn, and fold over them. The step back is a step, so of course the feet move
  // during it — what must not move is a foot once the folding has begun.
  const { handle } = couchAtOrigin();
  const seat = handle.seats[0];
  const agent = new Agent({ id: 'sitter', name: 'Sitter' });
  agent.setPositionXZ(seat.front.x, seat.front.z);
  agent.setRotation(seat.rotation);
  const controller = new AgentController(agent, { findPath: (_f, t) => [t.clone()] });
  controller.run([sit(seat.rotation, COUCH_SEAT_HEIGHT, seat.position)]);

  let planted = null;
  let worstDrift = 0;
  let folding = 0;
  for (let i = 0; i < 120; i++) {
    controller.update(1 / 60);
    if (agent.seatBlend <= 0) continue;      // still stepping back
    agent.root.updateMatrixWorld(true);
    const foot = lowerLegBox(agent).min.clone();
    if (!planted) { planted = foot; continue; }
    folding++;
    worstDrift = Math.max(worstDrift, Math.abs(foot.z - planted.z));
  }
  assert.ok(folding > 10, 'the fold takes real frames');
  assert.ok(worstDrift < 0.01, `feet slid ${worstDrift.toFixed(4)} while sitting down`);
});

test('and the fold lands them exactly on the seat', () => {
  // Falls out of the planted feet rather than being aimed at: the hips travel back by
  // precisely what the fold is worth, which is the distance the standing spot was
  // chosen to be. If this drifts, the two halves have stopped agreeing.
  const { handle } = couchAtOrigin();
  const seat = handle.seats[0];
  const agent = new Agent({ id: 'sitter', name: 'Sitter' });
  agent.setPositionXZ(seat.front.x, seat.front.z);
  agent.setRotation(seat.rotation);
  const controller = new AgentController(agent, { findPath: (_f, t) => [t.clone()] });
  controller.run([sit(seat.rotation, COUCH_SEAT_HEIGHT, seat.position)]);
  play(controller, 2);
  assert.ok(Math.abs(agent.position.z - seat.position.z) < 0.01,
    `landed at ${agent.position.z.toFixed(3)}, seat is ${seat.position.z.toFixed(3)}`);
  assert.ok(Math.abs(agent.position.x - seat.position.x) < 0.01, 'and on the right cushion');
});
