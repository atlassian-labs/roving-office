import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom } from './lib/room.js';
import { STREET_Y } from '../src/config.js';

let THREE, buildLanternGarden, disposeSubtree, clearMaterialCache;
before(async () => {
  ({ THREE } = await loadRoom());
  ({ buildLanternGarden } = await import('../src/scene/outlooks/lantern-garden.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
});

test('the pond crossing has a continuous timber walking surface above the water', () => {
  const root = new THREE.Group(); buildLanternGarden(root); root.updateMatrixWorld(true);
  const bridge = root.getObjectByName('lantern-footbridge-timber');
  const pond = root.getObjectByName('lantern-garden-pond');
  const ray = new THREE.Raycaster();
  for (let x = 29.25; x < 43; x += .5) {
    for (const z of [29.25, 30, 30.75]) {
      ray.set(new THREE.Vector3(x, STREET_Y + 5, z), new THREE.Vector3(0, -1, 0));
      const crossing = ray.intersectObject(bridge)[0];
      assert.ok(crossing, `the bridge has no walking surface at ${x},${z}`);
      assert.ok(crossing.point.y > pond.position.y + .1, 'the deck is submerged');
    }
  }
  disposeSubtree(root); clearMaterialCache();
});


test('the entrance path continues through the bamboo outside the courtyard gate', () => {
  const root = new THREE.Group(); buildLanternGarden(root); root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(); ray.far = 7;
  for (const z of [-17.5, -16.9, -16.3]) for (const height of [.6, 1.7]) {
    ray.set(new THREE.Vector3(-29, STREET_Y + height, z), new THREE.Vector3(1, 0, 0));
    assert.equal(ray.intersectObject(root, true).length, 0, 'the route beyond the gate is blocked');
  }
  disposeSubtree(root); clearMaterialCache();
});
