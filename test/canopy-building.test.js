import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom } from './lib/room.js';
import { playUntil } from './lib/frames.js';
import { seedRandom } from '../bin/lib/headless-scene.js';
import { createScene, resolveTheme } from '../src/projects.js';
import { applyPalette, ROOM, FLOOR_TOP } from '../src/config.js';

let THREE, AgentManager, buildEnvironment, buildProps, buildCanopyHouse, disposeSubtree, clearMaterialCache, releaseNightLightAssets;
before(async () => {
  ({ THREE, AgentManager } = await loadRoom());
  ({ buildEnvironment } = await import('../src/scene/environment.js'));
  ({ buildProps } = await import('../src/scene/props.js'));
  ({ buildCanopyHouse } = await import('../src/scene/canopy.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
  ({ releaseNightLightAssets } = await import('../src/scene/night-lights.js'));
});
function clear(root) { disposeSubtree(root); clearMaterialCache(); releaseNightLightAssets(); }
function room(season = 'summer') {
  seedRandom(1);
  const theme = resolveTheme(createScene({ building: 'canopy', season }), { season });
  applyPalette(theme.palette); clearMaterialCache();
  const root = new THREE.Group(), environment = buildEnvironment(root, theme);
  return { root, environment };
}

test('Canopy House keeps the whole editable floor clear of permanent solid planting and structure', () => {
  const root = buildCanopyHouse(); root.updateMatrixWorld(true);
  root.traverse(o => {
    if (o.geometry?.type !== 'BoxGeometry') return;
    const bounds = new THREE.Box3().setFromObject(o);
    if (bounds.max.y <= FLOOR_TOP || bounds.min.y >= 2.4) return;
    const crossesFloor = bounds.max.x > .6 && bounds.min.x < ROOM.W - .6
      && bounds.max.z > .6 && bounds.min.z < ROOM.D - .6;
    assert.equal(crossesFloor, false, 'a fixed architectural object blocks the editable floor');
  });
  clear(root);
});

test('the new building admits agents, assigns desks and lets everyone walk out', () => {
  const { root, environment } = room();
  const props = { ...buildProps(root), ...environment };
  const manager = new AgentManager(root, props);
  for (let i = 0; i < 3; i++) manager.handleEvent({ type: 'spawn', id: `canopy-${i}`, name: `Person ${i}` });
  assert.notEqual(playUntil(manager, () => [...manager.agents.values()].every(r => !r.arriving), 45), null);
  assert.equal(props.desks.filter(d => d.occupiedBy).length, 3);
  assert.ok(environment.stoop, 'the ground-floor approach is missing');
  assert.equal(typeof environment.door.requestOpen, 'function');
  for (let i = 0; i < 3; i++) manager.handleEvent({ type: 'exit', id: `canopy-${i}` });
  assert.notEqual(playUntil(manager, () => manager.agents.size === 0, 60), null);
  assert.equal(props.desks.filter(d => d.occupiedBy).length, 0);
  clear(root);
});

test('all seasons stay within the environment geometry budget and release their instance buffers', () => {
  for (const season of ['summer', 'autumn', 'winter', 'spring']) {
    const { root } = room(season);
    let meshes = 0, triangles = 0, pointLights = 0, instances = 0, disposed = 0;
    root.traverse(o => {
      if (o.isPointLight) pointLights++;
      if (!o.isMesh) return;
      meshes++;
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.count ?? 1);
      if (o.isInstancedMesh) {
        instances++;
        assert.ok(Number.isFinite(o.boundingSphere.radius) && o.boundingSphere.radius > 0);
        o.addEventListener('dispose', () => disposed++);
      }
    });
    assert.ok(meshes < 250, `${season}: ${meshes} environment meshes`);
    assert.ok(triangles < 350000, `${season}: ${triangles} environment triangles`);
    assert.equal(pointLights, 6, 'planting or pendants added per-frame lights');
    clear(root);
    assert.equal(disposed, instances);
  }
});

test('rebuilding a world releases both sun-shadow render targets', () => {
  const root = new THREE.Group(), sun = new THREE.DirectionalLight();
  root.add(sun);
  sun.shadow.map = new THREE.WebGLRenderTarget(16, 16);
  sun.shadow.mapPass = new THREE.WebGLRenderTarget(16, 16);
  const released = [];
  for (const [name, target] of [['shadow', sun.shadow.map], ['blur', sun.shadow.mapPass]]) {
    target.addEventListener('dispose', () => released.push(name));
  }
  disposeSubtree(root);
  assert.deepEqual(released.sort(), ['blur', 'shadow']);
});
