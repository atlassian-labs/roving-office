import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';
import { DOOR, STREET_Y } from '../src/config.js';

let THREE, buildCanopyGarden, disposeSubtree, clearMaterialCache;
before(async () => {
  stubDom();
  THREE = await loadThree();
  ({ buildCanopyGarden } = await import('../src/scene/outlooks/canopy-garden.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
});

test('Canopy grass continues beyond the old square while the entrance path keeps its world scale', () => {
  const root = new THREE.Group();
  buildCanopyGarden(root);
  root.updateMatrixWorld(true);
  try {
    const ground = root.getObjectByName('canopy-garden-ground');
    function hit(x, z) {
      return new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0))
        .intersectObject(ground)[0];
    }
    for (const x of [-600, 600]) for (const z of [-600, 600]) {
      assert.ok(hit(x, z), `ground ends before ${x}, ${z}`);
    }
    const entrance = hit(DOOR.x, -9);
    assert.ok(Math.abs(entrance.point.y - (STREET_Y + .025)) < 1e-6);
    assert.ok(Math.abs(entrance.uv.x - (.5 + DOOR.x / 160)) < 1e-6);
    assert.ok(Math.abs(entrance.uv.y - (.5 + 9 / 160)) < 1e-6);
    assert.equal(ground.geometry.index.count, 6, 'the extension needs no extra triangles');
  } finally { disposeSubtree(root); clearMaterialCache(); }
});
