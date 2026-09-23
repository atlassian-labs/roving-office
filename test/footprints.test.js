// Does every prop's blocked rectangle still contain the prop?
//
// The footprints in `BODIES` (src/layout.js) are *measured* — `node
// bin/footprint-audit.js --table` builds each prop headlessly and takes the
// bounding box of its floor-level geometry — and a measured number is only as
// good as the thing that re-measures it. Without this test the tables go stale
// the first time somebody widens a base or nudges a mesh inside its group, and
// **nothing else in the suite would notice**: `clear` in bin/office-fitness.js,
// the one number whose job is to catch a walker inside the furniture, tests a
// walker's centre against these same rectangles. A mesh outside its rectangle is
// invisible to the measure that exists to find it.
//
// That is not hypothetical. Before the tables were measured, seven of
// twenty-three props had geometry outside their own footprint — every desk's
// chair by 0.81, the mailbox by 0.94, the coffee machine by 0.63 — and agents had
// been walking through them for as long as the room has existed.
//
// It runs the real thing rather than reimplementing it, in the spirit of
// test/docs.test.js and `bin/gen-npm-scripts.mjs --check`: a second copy of the
// measurement would be a second thing to keep in step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BODIES, BERTHS, STATION_KINDS, FURNITURE_KINDS, PLANT_KINDS } from '../src/layout.js';
import { RUG_TOP, RUG_LIFT } from '../src/scene/props/rug.js';
import { obstacleFootprints } from '../src/layout.js';
import { floorFault } from '../src/editor/placement.js';
import { ROOM } from '../src/config.js';
import { CHROME_HEIGHTS, chromeColours, createEditorGizmos } from '../src/editor/gizmos.js';
import { createPathTrails } from '../src/editor/path-trails.js';
import { FLOOR_TOP } from '../src/config.js';
import * as THREE from 'three';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

test('every footprint still contains its prop', () => {
  let out = '';
  try {
    out = execFileSync(process.execPath, [join('bin', 'footprint-audit.js'), '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENSSL_CONF: '/dev/null' },
    });
  } catch (err) {
    assert.fail(`footprints have drifted from the props:\n${err.stderr || err.stdout || err.message}\n`
      + 'Re-measure with `node bin/footprint-audit.js --table` and paste the numbers '
      + 'into the kind tables in src/layout.js.');
  }
  assert.ok(out !== null);
});

test('every kind a room can hold has a body', () => {
  // A kind with no entry would fall back to nothing measured at all, and the props
  // that need the check most are the ones nobody has looked at. The authored room
  // holds neither an armchair nor a fern, so this is the assertion that keeps the
  // measurement sweeping generated offices until it has seen all of them.
  const want = [
    ...Object.keys(STATION_KINDS).map((k) => `station:${k}`),
    ...Object.keys(FURNITURE_KINDS).map((k) => `furniture:${k}`),
    ...Object.keys(PLANT_KINDS).map((k) => `plant:${k}`),
    'desk:desk',
  ];
  for (const key of want) {
    const body = BODIES[key];
    assert.ok(body, `${key} has no measured body`);
    assert.ok(body.hw > 0 && body.hd > 0, `${key} has a body of ${body.hw} x ${body.hd}`);
  }
});

test('a berth is a walker\'s business, and only one prop asks for one', () => {
  // The split this whole change turns on: the rectangle is what the *editor*
  // refuses overlaps against, and a berth is extra floor a *walker* keeps clear.
  // Merge them and a lamp and a plant can no longer stand side by side to make a
  // wall you walk around rather than between, which is a thing rooms do.
  //
  // Pinned to one entry deliberately. Every berth is a footprint that is bigger
  // than its prop for someone else's reasons, so a second one should have to argue
  // for itself here rather than arrive quietly.
  assert.deepEqual(Object.keys(BERTHS), ['furniture:floorLamp']);
  for (const key of Object.keys(BERTHS)) {
    assert.ok(BODIES[key], `${key} takes a berth but has no body`);
  }
});

test('the editor\'s floor chrome clears a rug', () => {
  // Everything the editor draws on the floor — the blocked cells, the footprint
  // edges, the standing-room wash, the selection tint and its ring — has to sit
  // above a rug's upper surface, because a rug is also drawn just above the boards.
  //
  // It did not, and the symptom was the footprints being invisible under a rug
  // exactly when they matter most: while dragging something across one. The cells
  // were at 0.015 over the boards, the edges at 0.03, and a rug's top is at 0.05.
  //
  // Asserted against the rug's own constant rather than against a copy of it, so a
  // thicker rug fails this test instead of quietly burying the overlay again.
  for (const [name, y] of Object.entries(CHROME_HEIGHTS)) {
    assert.ok(y > RUG_TOP, `${name} is ${y} over the floor and a rug's top is ${RUG_TOP}`);
  }
  // And the stack is in the intended order: the walking room, then the footprints
  // over it, then whichever prop is in hand over both, then the selection ring.
  //
  const order = ['walk', 'zone', 'pick', 'ring'];
  const ys = order.map((k) => CHROME_HEIGHTS[k]);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b), `chrome out of order: ${order}`);
  assert.ok(RUG_LIFT > 0, 'a rug lying in the floor would z-fight with it');
});

test('the shipped room is legal by its own rules', () => {
  // `applyLayout` validates nothing, so the authored room can carry a fault no drag
  // would ever have been allowed to create — and it did. Measuring the footprints
  // put the inbox's body edge at z 16.99 while desk-3's standing room ended at
  // 17.00: a 0.20 by 0.01 overlap, nobody actually competing for floor, and a fault
  // by the room's own rules. The inbox moved a tenth of a unit.
  //
  // Nothing was checking. There is a test that the shipped room strands nobody,
  // which is the expensive half of the verdict, and none for the cheap half — so
  // the room the editor holds up as legal was not.
  const rects = obstacleFootprints();
  const faults = rects
    .map((r) => ({ key: r.key, fault: floorFault(r.key, rects, ROOM) }))
    .filter((r) => r.fault);
  assert.deepEqual(
    faults.map((f) => `${f.key}: ${f.fault.why}`),
    [],
    'the authored room breaks its own placement rules',
  );
});


test('editor legend colours match solid, untone-mapped floor cells', () => {
  const scene = new THREE.Scene();
  const gizmos = createEditorGizmos(scene);
  const [zone, walk, pick] = scene.children[0].children;
  const colours = chromeColours();
  for (const [mesh, key] of [[zone, 'zone'], [walk, 'walk'], [pick, 'pick']]) {
    assert.equal(`#${mesh.material.color.getHexString()}`, colours[key]);
    assert.equal(mesh.material.opacity, 1, 'the floor must not tint a legend colour');
    assert.equal(mesh.material.toneMapped, false, 'exposure must not tint UI colours');
  }
  gizmos.setValidity(false);
  assert.equal(`#${pick.material.color.getHexString()}`, colours.clash);
  assert.equal(pick.material.opacity, 1);
  gizmos.dispose();
});

test('walking routes clear rugs and selection overlays and retain their colour', () => {
  const scene = new THREE.Scene();
  const trails = createPathTrails(scene);
  trails.update([{ id: 'walker', position: {x: 1, z: 1},
    ahead: [{x: 3, z: 1}], behind: [{x: 0, z: 1}, {x: 1, z: 1}], behindAge: 0 }]);
  const meshes = scene.children[0].children;
  assert.equal(meshes.length, 2);
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    const used = mesh.geometry.index.array.slice(0, mesh.geometry.drawRange.count);
    assert.ok(used.length > 0);
    for (const vertex of used) assert.ok(pos.getY(vertex) > FLOOR_TOP + CHROME_HEIGHTS.ring);
    assert.equal(mesh.material.toneMapped, false);
    assert.ok(mesh.renderOrder > 5, 'routes draw after the selection ring');
  }
  assert.notEqual(meshes[0].geometry.getAttribute('position').getY(0),
    meshes[1].geometry.getAttribute('position').getY(0), 'history cannot fight the route ahead');
  trails.dispose();
});
