import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';
import { DOOR } from '../src/config.js';

let THREE, buildTideHarbour, disposeSubtree, clearMaterialCache;
before(async () => {
  stubDom();
  THREE = await loadThree();
  ({ buildTideHarbour } = await import('../src/scene/outlooks/tide-harbour.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
});

function harbour() {
  const root = new THREE.Group();
  buildTideHarbour(root);
  root.updateMatrixWorld(true);
  return root;
}
function clear(root) { disposeSubtree(root); clearMaterialCache(); }
function boundsOfInstances(mesh) {
  mesh.geometry.computeBoundingBox();
  return Array.from({ length: mesh.count }, (_, i) => {
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
    return mesh.geometry.boundingBox.clone().applyMatrix4(matrix.premultiply(mesh.matrixWorld));
  });
}
function hitsAt(objects, x, z) {
  return new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0)).intersectObjects(objects);
}

test('Tide harbour puts its expanded fleet on water and every town building on mainland', () => {
  const root = harbour();
  try {
    const land = root.getObjectByName('harbour-mainland');
    const dry = [land, root.getObjectByName('harbour-office-quay'), root.getObjectByName('harbour-walkways')];
    const boats = boundsOfInstances(root.getObjectByName('harbour-hulls'));
    assert.ok(boats.length >= 12, 'the harbour should contain a fleet, not three isolated boats');
    for (const [i, b] of boats.entries()) {
      for (const x of [b.min.x, (b.min.x + b.max.x) / 2, b.max.x]) {
        for (const z of [b.min.z, (b.min.z + b.max.z) / 2, b.max.z]) {
          assert.equal(hitsAt(dry, x, z).length, 0, `boat ${i} overlaps dry land or a pier`);
        }
      }
      for (const other of boats.slice(i + 1)) assert.equal(b.intersectsBox(other), false, `boat ${i} overlaps another hull`);
    }
    const lanes = [root.getObjectByName('harbour-coastal-lane'), root.getObjectByName('harbour-inland-lane')];
    const buildings = boundsOfInstances(root.getObjectByName('harbour-buildings'));
    assert.ok(buildings.length >= 30, 'the town should extend behind its first waterfront row');
    for (const [i, b] of buildings.entries()) for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
      assert.ok(hitsAt([land], x, z).length, `building ${i} has a corner over water`);
      assert.equal(hitsAt(lanes, x, z).length, 0, `building ${i} blocks a coastal or inland lane`);
    }
  } finally { clear(root); }
});

test('Tide mainland and water extend beyond the old slab, with a continuous door-to-town route', () => {
  const root = harbour();
  try {
    const land = root.getObjectByName('harbour-mainland');
    for (const [x, z] of [[-200, -80], [200, -80], [0, -500], [-500, -200], [500, -200]]) {
      assert.ok(hitsAt([land], x, z).length, `mainland ends abruptly at ${x}, ${z}`);
    }
    const water = root.getObjectByName('harbour-water');
    for (const [x, z] of [[-500, 400], [500, 400], [0, 650]]) assert.ok(hitsAt([water], x, z).length);
    const route = [land, root.getObjectByName('harbour-office-quay'), root.getObjectByName('harbour-walkways')];
    for (let z = -35; z <= -3; z += .25) assert.ok(hitsAt(route, DOOR.x, z).length, `entrance route has a gap at z=${z}`);
  } finally { clear(root); }
});
