import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';
import { ROOM, FLOOR_TOP, WINDOW_HEAD_Y, windowSpan } from '../src/config.js';

let THREE, buildDuneAtelier, buildDuneFloor, buildDuneCourtyard, disposeSubtree, clearMaterialCache;
before(async () => {
  THREE = await loadThree(); stubDom();
  ({ buildDuneAtelier, buildDuneFloor } = await import('../src/scene/dune-atelier.js'));
  ({ buildDuneCourtyard } = await import('../src/scene/outlooks/dune-courtyard.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
});
function clear(root) { disposeSubtree(root); clearMaterialCache(); }

test('the Dune arch reveals leave the established flight apertures and editable floor open', () => {
  const root = buildDuneAtelier(); root.updateMatrixWorld(true);
  const solids = [];
  root.traverse(o => { if (o.isMesh && !o.material.transparent) solids.push(o); });
  const ray = new THREE.Raycaster();
  for (const [wall, index] of [['back', 0], ['back', 1], ['left', 0]]) {
    const span = windowSpan(wall, index), back = wall === 'back';
    for (const along of [span.from + .12, span.centre, span.to - .12]) {
      for (const y of [3.1, 5.2, WINDOW_HEAD_Y]) {
        ray.set(new THREE.Vector3(back ? along : 2, y, back ? 2 : along),
          new THREE.Vector3(back ? 0 : -1, 0, back ? -1 : 0));
        assert.equal(ray.intersectObjects(solids).filter(hit => hit.distance < 4).length, 0,
          `${wall} window ${index}: an arch blocks an established aperture`);
      }
    }
  }
  for (const o of solids) {
    const b = new THREE.Box3().setFromObject(o);
    if (b.max.y <= FLOOR_TOP || b.min.y >= 2.4) continue;
    assert.equal(b.max.x > .6 && b.min.x < ROOM.W - .6 && b.max.z > .6 && b.min.z < ROOM.D - .6,
      false, 'a permanent mass occupies editable floor');
  }
  clear(root);
});

test('Dune geometry stays modest and every season releases its instance buffers', () => {
  for (const season of ['summer', 'autumn', 'winter', 'spring']) {
    const root = new THREE.Group(); root.add(buildDuneAtelier(), buildDuneFloor());
    buildDuneCourtyard(root, season);
    let meshes = 0, triangles = 0, instances = 0, disposed = 0;
    root.traverse(o => {
      assert.equal(o.isLight || false, false, 'an architectural element adds a real light');
      if (!o.isMesh) return;
      meshes++;
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.count ?? 1);
      if (o.isInstancedMesh) {
        instances++;
        assert.ok(Number.isFinite(o.boundingSphere.radius) && o.boundingSphere.radius > 0);
        o.addEventListener('dispose', () => disposed++);
      }
    });
    assert.ok(meshes < 150, `${season}: ${meshes} meshes`);
    assert.ok(triangles < 100000, `${season}: ${triangles} triangles`);
    clear(root); assert.equal(disposed, instances);
  }
});
