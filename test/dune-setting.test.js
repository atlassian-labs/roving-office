import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';
import { DOOR, STREET_Y } from '../src/config.js';

let THREE, buildDuneCourtyard, disposeSubtree, clearMaterialCache;
before(async () => {
  THREE = await loadThree(); stubDom();
  ({ buildDuneCourtyard } = await import('../src/scene/outlooks/dune-courtyard.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
});
function clear(root) { disposeSubtree(root); clearMaterialCache(); }

function instanceBounds(mesh) {
  mesh.geometry.computeBoundingBox();
  const result = [], local = new THREE.Matrix4(), world = new THREE.Matrix4();
  for (let i = 0; i < (mesh.isInstancedMesh ? mesh.count : 1); i++) {
    world.copy(mesh.matrixWorld);
    if (mesh.isInstancedMesh) { mesh.getMatrixAt(i, local); world.multiply(local); }
    result.push(mesh.geometry.boundingBox.clone().applyMatrix4(world));
  }
  return result;
}

test('Dune pedestrians have a continuous clear route through the gate, alleys and market', () => {
  const root = new THREE.Group(); buildDuneCourtyard(root); root.updateMatrixWorld(true);
  const routes = [
    [DOOR.x, -3, DOOR.x, -67, 1.4],
    [-52, -35.5, 59, -35.5, 1.8],
    [-48, -49.5, 59, -49.5, 1.8],
    [-33.5, -63, -33.5, 46, 1.8],
    [-49, 12, -18, 12, 1.8],
    [-49, 29, -18, 29, 1.8],
  ];
  const pedestrianY = STREET_Y + .08;
  root.traverse(mesh => {
    if (!mesh.isMesh || !['BoxGeometry', 'CylinderGeometry'].includes(mesh.geometry.type)) return;
    for (const bounds of instanceBounds(mesh)) {
      if (bounds.max.y <= pedestrianY || bounds.min.y >= STREET_Y + 2.4) continue;
      for (const [ax, az, bx, bz, halfWidth] of routes) {
        const lane = new THREE.Box3(
          new THREE.Vector3(Math.min(ax, bx) - (ax === bx ? halfWidth : 0), pedestrianY,
            Math.min(az, bz) - (az === bz ? halfWidth : 0)),
          new THREE.Vector3(Math.max(ax, bx) + (ax === bx ? halfWidth : 0), STREET_Y + 2.4,
            Math.max(az, bz) + (az === bz ? halfWidth : 0)));
        assert.equal(bounds.intersectsBox(lane), false,
          `${mesh.name || mesh.geometry.type} blocks the walking lane (${ax},${az}) to (${bx},${bz})`);
      }
    }
  });
  clear(root);
});

test('Dune town foundations remain level while the distant terrain has several dune crests', () => {
  const root = new THREE.Group(); buildDuneCourtyard(root); root.updateMatrixWorld(true);
  const terrain = root.getObjectByName('dune-continuous-terrain');
  const houses = root.getObjectByName('dune-town-walls');
  const ray = new THREE.Raycaster();
  assert.ok(houses.count >= 25, 'the town lost its surrounding neighbourhoods');
  for (const b of instanceBounds(houses)) {
    for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
      ray.set(new THREE.Vector3(x, 80, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(terrain)[0];
      assert.ok(hit, 'a village foundation has no ground');
      assert.ok(Math.abs(hit.point.y - (STREET_Y + .025)) < .001, 'a village foundation straddles a dune');
    }
  }
  const heights = [];
  for (let z = -65; z >= -220; z -= 2) {
    ray.set(new THREE.Vector3(12, 80, z), new THREE.Vector3(0, -1, 0));
    heights.push(ray.intersectObject(terrain)[0].point.y);
  }
  let crests = 0;
  for (let i = 1; i < heights.length - 1; i++) {
    if (heights[i] > STREET_Y + 4 && heights[i] > heights[i - 1] && heights[i] >= heights[i + 1]) crests++;
  }
  assert.ok(crests >= 3, `only ${crests} distinct distant dune crests`);
  terrain.geometry.computeBoundingBox();
  assert.ok(terrain.geometry.boundingBox.min.x <= -600 && terrain.geometry.boundingBox.max.z >= 600,
    'the continuous sand surface ends within the normal camera range');
  clear(root);
});
