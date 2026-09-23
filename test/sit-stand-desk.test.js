// The sit-stand desk, checked without a browser.
//
// This is the one desk whose whole point is that it moves, and a screenshot cannot show
// that: the shutter fires at load, and under Chrome's virtual time budget
// `requestAnimationFrame` never fires at all, so no picture of this desk says whether it
// ever leaves the height it was built at. Stepping `update()` by hand and reading the
// surface back does — see docs/developer/developing.md on why that is the only way round it.
//
// Three things are worth pinning beyond the travel itself. That an *ordinary* desk is
// completely unchanged by all this, because the surface group it now hangs from is the
// sort of refactor that silently moves five desks a centimetre. That the desk moves only
// when it is sent somewhere, since a desk on a clock of its own is furniture moving with
// nobody in the room. And that the chair is *not* tied to the height — it was, and an
// empty desk changing height dragged its chair across the floor by itself.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let buildDesk, DESK_TOP_Y, RISE, THREE;

before(async () => {
  stubDom();
  THREE = await loadThree();
  ({ buildDesk, DESK_TOP_Y } = await import('../src/scene/props/desk.js'));
  ({ RISE } = await import('../src/scene/props/sit-stand.js'));
});

const spec = (extra = {}) => ({ id: 'd', x: 0, z: 0, facing: 0, ...extra });

/** The desk's working surface: the group everything on the desk hangs from. */
function surfaceOf(obj) {
  const found = obj.children.find((c) => c.type === 'Group' && c.children.some((k) => k.geometry));
  assert.ok(found, 'the desk has no surface group');
  return found;
}

/** The tallest point of anything under `obj`, in world terms. */
function highest(obj) {
  let top = -Infinity;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.geometry) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    top = Math.max(top, b.max.y);
  });
  return top;
}

function run(handle, seconds, dt = 1 / 30) {
  const seen = { min: Infinity, max: -Infinity };
  for (let t = 0; t < seconds; t += dt) {
    handle.update(dt);
    seen.min = Math.min(seen.min, handle.raised);
    seen.max = Math.max(seen.max, handle.raised);
  }
  return seen;
}

test('an ordinary desk is untouched by the surface group', () => {
  const { obj, handle } = buildDesk(spec(), 0);
  assert.equal(handle.standing, false);
  const surface = surfaceOf(obj);
  assert.equal(surface.position.y, 0, 'an ordinary desk lifted its own surface');

  // Ticking it must not move anything: only a sit-stand desk has a height to keep.
  const before = highest(obj);
  for (let t = 0; t < 90; t += 1 / 30) handle.update(1 / 30);
  assert.equal(surface.position.y, 0, 'an ordinary desk drifted upward');
  assert.equal(highest(obj), before, 'an ordinary desk changed shape');
  assert.equal(handle.raised, 0);
});

test('a sit-stand desk is a desk: same top height when it is down', () => {
  const plain = buildDesk(spec({ id: 'a' }), 0);
  const standing = buildDesk(spec({ id: 'b', standing: true }), 0);
  assert.equal(standing.handle.standing, true);

  standing.handle.setStanding(false);
  // Long enough for the motor to arrive at the bottom.
  run(standing.handle, 30);
  assert.ok(Math.abs(standing.handle.raised) < 1e-9, 'never reached seated height');

  // Lowered, its surface is exactly an ordinary desk's — which is the claim that lets a
  // standing desk sit in the row without being a centimetre out of it.
  assert.ok(Math.abs(surfaceOf(standing.obj).position.y) < 1e-9);
  assert.ok(DESK_TOP_Y > 0);
  assert.ok(Math.abs(highest(plain.obj) - highest(standing.obj)) < 1e-6,
    'a lowered sit-stand desk is not the same height as an ordinary one');
});

test('raised, it stands exactly one RISE above the row', () => {
  const plain = buildDesk(spec({ id: 'a' }), 0);
  const standing = buildDesk(spec({ id: 'b', standing: true }), 0);
  standing.handle.setStanding(true);
  run(standing.handle, 30);
  assert.ok(Math.abs(standing.handle.raised - 1) < 1e-9, 'never reached standing height');
  assert.ok(Math.abs(surfaceOf(standing.obj).position.y - RISE) < 1e-9);
  // Measured off the tops rather than off the surface group, so this catches a monitor or
  // a plant left behind on the floor while the top went up without it.
  assert.ok(Math.abs((highest(standing.obj) - highest(plain.obj)) - RISE) < 1e-6,
    'the things standing on the desk did not rise with it');
});

/**
 * The chair: the desk's own child group standing at the seat.
 *
 * Not the surface group (at z 0), and not the mat or the feet, which are meshes. Found by
 * where it stands rather than by counting children, so re-ordering the builder cannot
 * quietly pass these.
 */
function chairOf(obj) {
  const found = obj.children.find((c) => c.type === 'Group' && Math.abs(c.position.z - 1.6) < 1e-6);
  assert.ok(found, 'no chair at the seat');
  return found;
}

test('the height does not move the chair: it is pushed, not dragged', () => {
  const { obj, handle } = buildDesk(spec({ standing: true }), 0);
  const chair = chairOf(obj);
  // This is the ghost bug, and it is worth a test of its own because it looked like a
  // feature in code and like a haunting on screen: `chair.position.x` was a multiple of
  // the height, so every raise and lower slid the chair with nobody touching it.
  assert.equal(chair.position.x, 0, 'the chair did not start tucked in');
  handle.setStanding(false);
  run(handle, 5);
  assert.equal(handle.raised, 0, 'the desk did not come down');
  assert.equal(chair.position.x, 0, 'the desk dragged its chair down with it');
  handle.setStanding(true);
  run(handle, 5);
  assert.equal(handle.raised, 1, 'the desk did not go back up');
  assert.equal(chair.position.x, 0, 'the desk dragged its chair up with it');
});

test('pushed aside, the chair goes and stays — and comes back when pulled', () => {
  const { obj, handle } = buildDesk(spec({ standing: true }), 0);
  const chair = chairOf(obj);

  handle.pushChairAside(true);
  run(handle, 3);
  const aside = Math.abs(chair.position.x);
  assert.ok(aside > 1, `chair did not move aside (${aside})`);
  assert.equal(handle.chairAside, 1);

  // It stays where it was shoved, however long the desk runs: the person who pushed it is
  // the only thing that moves it back.
  run(handle, 60);
  assert.equal(Math.abs(chair.position.x), aside, 'the chair drifted on its own');

  handle.pushChairAside(false);
  run(handle, 3);
  assert.ok(Math.abs(chair.position.x) < 1e-9, 'the chair did not come back under the desk');
  assert.equal(handle.chairAside, 0);
});

test('aside is beside the occupant, and inside the desk it belongs to', () => {
  // It was 2.75 first, which stood the chair clear of the 4.4-wide top altogether and read
  // as the chair having been sent away rather than shifted. Measured off the geometry
  // rather than against a remembered number, because the number is the thing under
  // review: what matters is that the chair ends up within the desk's own width, and that
  // it leaves somewhere to stand.
  const { obj, handle } = buildDesk(spec({ standing: true }), 0);
  const chair = chairOf(obj);
  handle.pushChairAside(true);
  run(handle, 3);

  obj.updateMatrixWorld(true);
  const chairBox = new THREE.Box3().setFromObject(chair);

  // To the occupant's left, which is the camera's near side. Either side clears the mat
  // equally, so this is a choice about the view rather than about the desk: shoved the other
  // way, the chair went behind the desk from where the camera stands, and a chair you cannot
  // see has not visibly moved.
  assert.ok(chair.position.x < 0, 'the chair was pushed to the far side of the desk');
  assert.ok(chairBox.min.x > -2.2,
    `the chair reaches x ${chairBox.min.x.toFixed(2)}, past the end of a 4.4-wide top`);
  // And the occupant's own patch of floor is clear: they stand at the seat point, x 0, and
  // the chair has to be beside them rather than on top of them.
  assert.ok(chairBox.max.x < -0.3,
    `the chair overhangs the standing spot, reaching across to x ${chairBox.max.x.toFixed(2)}`);
});

test('the chair aside does not end up inside the frame', () => {
  // The lifting columns and their feet are the parts a chair could be shoved into, and an
  // isometric screenshot is no use for telling a near miss from an intersection — in the
  // catalogue portrait the two look like one object. So it is asked of the boxes.
  const { obj, handle } = buildDesk(spec({ standing: true }), 0);
  const chair = chairOf(obj);
  handle.pushChairAside(true);
  run(handle, 3);
  obj.updateMatrixWorld(true);
  const chairBox = new THREE.Box3().setFromObject(chair);

  // The frame is the floor-bound meshes: columns, feet, pads and beam. Not the mat, which
  // the chair is expected to stand on the edge of, and not the surface group, whose front
  // edge a tucked-in chair already overlaps on every desk in the room.
  const frame = obj.children.filter((c) => c.type === 'Mesh' && Math.abs(c.position.z) < 1);
  assert.ok(frame.length >= 6, `only found ${frame.length} frame parts`);
  for (const part of frame) {
    const b = new THREE.Box3().setFromObject(part);
    // The mat is the wide flat one at the seat; skip it by shape rather than by index.
    if (b.max.x - b.min.x > 2) continue;
    assert.ok(!b.intersectsBox(chairBox),
      `the chair aside intersects a frame part at x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}`);
  }
});

test('a sit-stand desk is built raised, and stands still until it is sent somewhere', () => {
  const { handle } = buildDesk(spec({ standing: true }), 0);
  // Raised at build: the room's one sit-stand desk is up when the office opens, so what
  // the thing does is legible in the first frame rather than in the first minute.
  assert.equal(handle.raised, 1);
  // And left alone it does nothing at all. The old version cycled on a clock, which is
  // what put a desk in motion in an empty room.
  const idle = run(handle, 300);
  assert.equal(idle.min, 1, `an untouched desk moved: ${idle.min}..${idle.max}`);
  assert.equal(idle.max, 1);
});

test('the height changes every third to fifth turn, not every turn', () => {
  const { handle } = buildDesk(spec({ standing: true }), 0);
  // Starts raised, so the first run of turns is standing ones.
  const runs = [];
  let current = null;
  let length = 0;
  for (let i = 0; i < 400; i++) {
    const standing = handle.takeStandingTurn();
    if (current === null || standing === current) { length++; } else { runs.push(length); length = 1; }
    current = standing;
  }
  // Drop the last run, which the loop cut short rather than the desk.
  runs.shift();
  assert.ok(runs.length > 20, `only saw ${runs.length} runs`);
  for (const n of runs) {
    assert.ok(n >= 3 && n <= 5, `a run of ${n} turns is outside three to five`);
  }
  // And it does flip, rather than sitting on one answer forever.
  assert.ok(runs.length > 1);
});

test('the height API is safe on an ordinary desk', () => {
  const { obj, handle } = buildDesk(spec(), 0);
  // The agent layer calls all of these without asking what the desk stands on, so they
  // have to be no-ops rather than crashes — and must not secretly raise a desk with no
  // columns, or shove the chair of one that has no mat to clear.
  handle.setStanding(true);
  handle.pushChairAside(true);
  assert.equal(handle.takeStandingTurn(), false, 'an ordinary desk offered to be stood at');
  run(handle, 30);
  assert.equal(handle.raised, 0);
  assert.equal(handle.chairAside, 0);
  assert.equal(chairOf(obj).position.x, 0);
});

/** Every screen on a desk: the meshes whose material carries an emissive map. */
function screensOf(obj) {
  const found = [];
  obj.traverse((o) => { if (o.isMesh && o.material?.emissiveMap) found.push(o); });
  return found;
}

test('a sit-stand desk has one monitor where an ordinary desk has two', () => {
  // Counted by screens rather than by groups, because "one monitor" is a claim about what
  // somebody sees: one panel, one bezel, one stand.
  const flat = buildDesk(spec(), 0);
  const tall = buildDesk(spec({ standing: true }), 0);
  assert.equal(screensOf(flat.obj).length, 2);

  // The ultrawide carries two windows on the one panel — the editor and the board, the same
  // two images the pair shows — so the screen count is not the monitor count. What says there
  // is one monitor is that the panel is continuous: both windows sit at the same x.
  const screens = screensOf(tall.obj);
  const xs = new Set(screens.map((m) => m.parent.position.x));
  assert.equal(xs.size, 1, 'the wide desk has monitors in more than one place');
  assert.equal([...xs][0], 0, 'the single monitor is not centred on the desk');
});

test('the ultrawide is half again as wide as an ordinary monitor', () => {
  const flat = buildDesk(spec(), 0);
  const tall = buildDesk(spec({ standing: true }), 0);
  const width = (o) => {
    o.updateMatrixWorld(true);
    const b = new THREE.Box3();
    for (const s of screensOf(o)) b.union(new THREE.Box3().setFromObject(s));
    return b.max.x - b.min.x;
  };
  // Screen glass against screen glass: one flat screen is 1.5 across, so the wide one is 2.25.
  const oneFlat = (() => {
    flat.obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(screensOf(flat.obj)[0]);
    return b.max.x - b.min.x;
  })();
  const wide = width(tall.obj);
  assert.ok(Math.abs(wide / oneFlat - 1.5) < 0.02,
    `the wide panel is ${(wide / oneFlat).toFixed(2)}x an ordinary screen, not 1.5x`);

  // And narrower overall than the two it replaces, which spanned 3.8 from bezel to bezel.
  assert.ok(wide < 3.0, `the single panel spans ${wide.toFixed(2)}, wider than the pair it replaced`);
});

test('the ultrawide is curved towards its occupant, at about 1800R', () => {
  // Curvature is quoted as a radius — 1800R is a 1.8 m circle — and on a 34" ultrawide, whose
  // glass is about 800 mm across, that is an arc of 800/1800 rad: a little over 25°. The scene
  // is not in millimetres, so what is checked is the angle, via the depth of the curve: the
  // edges of the glass should stand forward of its middle by R(1 - cos(arc/2)).
  const { obj } = buildDesk(spec({ standing: true }), 0);
  obj.updateMatrixWorld(true);
  const screens = screensOf(obj);
  const box = new THREE.Box3();
  for (const s of screens) box.union(new THREE.Box3().setFromObject(s));

  const width = box.max.x - box.min.x;
  const depth = box.max.z - box.min.z;
  assert.ok(depth > 0.01, 'the panel is flat: it has no curve at all');

  // Recover the arc from the width and the sagitta, and check it against 800/1800 radians.
  // sagitta = R(1 - cos(a/2)) and width = 2R sin(a/2), which solve to a = 4*atan(2s/w).
  const arc = 4 * Math.atan((2 * depth) / width);
  const expected = 800 / 1800;
  assert.ok(Math.abs(arc - expected) < 0.03,
    `the panel curves through ${(arc * 180 / Math.PI).toFixed(1)}\u00b0, not the ${(expected * 180 / Math.PI).toFixed(1)}\u00b0 of 1800R`);

  // Concave towards the occupant, who is at +z: the middle of the glass is the furthest part
  // from them. Curved the other way it would be a shop-window display, not a monitor.
  const middle = screens
    .flatMap((sc) => {
      const p = sc.geometry.attributes.position;
      const v = new THREE.Vector3();
      const out = [];
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); out.push(sc.localToWorld(v.clone())); }
      return out;
    })
    .reduce((lowest, v) => (Math.abs(v.x) < Math.abs(lowest.x) ? v : lowest));
  assert.ok(middle.z < box.max.z - depth / 2,
    'the panel bulges towards the occupant rather than away from them');
});

test('an ordinary desk still has two flat screens', () => {
  // The refactor that gave the wide desk its panel runs through both branches, and an
  // ordinary desk is five sixths of the room.
  const { obj } = buildDesk(spec(), 0);
  obj.updateMatrixWorld(true);
  for (const s of screensOf(obj)) {
    const b = new THREE.Box3().setFromObject(s);
    assert.ok(b.max.z - b.min.z < 1e-6, 'an ordinary screen has acquired a curve');
    assert.ok(Math.abs((b.max.x - b.min.x) - 1.5) < 1e-6, 'an ordinary screen changed width');
  }
});
