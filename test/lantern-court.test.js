import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom } from './lib/room.js';
import { STREET_Y, windowSpan } from '../src/config.js';

let THREE, buildLanternCourt, buildLanternGarden, disposeSubtree, clearMaterialCache;
before(async () => {
  ({ THREE } = await loadRoom());
  ({ buildLanternCourt } = await import('../src/scene/lantern-court.js'));
  ({ buildLanternGarden } = await import('../src/scene/outlooks/lantern-garden.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
});
function clear(root) { disposeSubtree(root); clearMaterialCache(); }

test('Lantern Court paper screens leave all established paper-plane apertures clear', () => {
  const shell = buildLanternCourt(); shell.updateMatrixWorld(true);
  const screens = [];
  shell.traverse(o => { if (o.name === 'lantern-shoji') screens.push(new THREE.Box3().setFromObject(o)); });
  assert.ok(screens.length > 0, 'the shoji facade is missing');
  for (const [wall, index] of [['back', 0], ['back', 1], ['left', 0]]) {
    const span = windowSpan(wall, index), axis = wall === 'back' ? 'x' : 'z';
    const perpendicular = wall === 'back' ? 'z' : 'x';
    for (const screen of screens) {
      if (screen.max[perpendicular] - screen.min[perpendicular] > .1) continue;
      assert.ok(screen.max[axis] < span.centre - span.width / 2
        || screen.min[axis] > span.centre + span.width / 2, `${wall} window ${index} is blocked by paper`);
    }
  }
  clear(shell);
});

test('the courtyard maple loses its canopy in winter while preserving its branching silhouette', () => {
  function garden(season) {
    const root = new THREE.Group(); buildLanternGarden(root, season);
    return { root, leaves: root.getObjectByName('lantern-maple-leaves'), branches: root.getObjectByName('lantern-maple-branches') };
  }
  const summer = garden('summer'), winter = garden('winter');
  assert.ok(winter.leaves.count < summer.leaves.count * .05);
  assert.equal(winter.branches.count, summer.branches.count);
  assert.deepEqual([...winter.branches.instanceMatrix.array], [...summer.branches.instanceMatrix.array]);
  clear(summer.root); clear(winter.root);
});

test('Lantern Court has a walkable opening where the approach crosses its garden wall', () => {
  const root = new THREE.Group(); buildLanternGarden(root, 'summer'); root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(); ray.far = 3.5;
  for (const z of [-18.2, -16.8, -15.4]) {
    for (const height of [.5, 1.6, 2.8]) {
      ray.set(new THREE.Vector3(-23.5, STREET_Y + height, z), new THREE.Vector3(1, 0, 0));
      assert.equal(ray.intersectObject(root, true).length, 0, 'garden geometry obstructs the entrance path');
    }
  }
  clear(root);
});
