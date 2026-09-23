import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom } from './lib/room.js';
import { playUntil } from './lib/frames.js';
import { seedRandom } from '../bin/lib/headless-scene.js';
import { createScene, resolveTheme, PROJECTS } from '../src/projects.js';
import { applyPalette, ROOM, FLOOR_TOP } from '../src/config.js';

const BUILDINGS = ['tide', 'dune', 'lantern'];
const SEASONS = ['summer', 'autumn', 'winter', 'spring'];
let THREE, AgentManager, buildEnvironment, buildProps, OFFICE_SHELLS, disposeSubtree, clearMaterialCache, releaseNightLightAssets;

before(async () => {
  ({ THREE, AgentManager } = await loadRoom());
  ({ buildEnvironment } = await import('../src/scene/environment.js'));
  ({ buildProps } = await import('../src/scene/props.js'));
  ({ OFFICE_SHELLS } = await import('../src/scene/office-shells.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
  ({ releaseNightLightAssets } = await import('../src/scene/night-lights.js'));
});

function clear(root) {
  disposeSubtree(root);
  clearMaterialCache();
  releaseNightLightAssets();
}

function room(building, season = 'summer') {
  seedRandom(1);
  const theme = resolveTheme(createScene({ building, season }), { building, season });
  applyPalette(theme.palette);
  clearMaterialCache();
  const root = new THREE.Group(), environment = buildEnvironment(root, theme);
  return { root, theme, environment };
}

test('switching from an existing office adopts each new building’s complete native look', () => {
  const interiors = [];
  for (const building of BUILDINGS) {
    const native = resolveTheme(createScene({ building }), { season: 'summer' });
    const swapped = resolveTheme(PROJECTS[0], { building, season: 'summer' });
    for (const part of ['floor', 'light', 'palette', 'fittings', 'outside']) {
      assert.deepEqual(swapped[part], native[part], `${building}: retained the old ${part}`);
    }
    interiors.push(JSON.stringify([native.floor, native.palette, native.light]));
  }
  assert.equal(new Set(interiors).size, 3);
});

for (const building of BUILDINGS) {
  test(`${building}: surrounding landscape keeps the working floor clear`, () => {
    const { root } = room(building);
    root.updateMatrixWorld(true);
    const outlook = root.getObjectByName({ tide: 'tide-harbour', dune: 'dune-courtyard', lantern: 'lantern-garden' }[building]);
    assert.ok(outlook);
    // Test actual surfaces, including individual instances and broad terrain
    // meshes whose overall bounding boxes span both sides of the room.
    const ray = new THREE.Raycaster(); ray.far = 2.4 - FLOOR_TOP - .04;
    for (let x = 1.2; x < ROOM.W; x += 2.4) for (let z = 1.2; z < ROOM.D; z += 2.4) {
      ray.set(new THREE.Vector3(x, 2.4, z), new THREE.Vector3(0, -1, 0));
      assert.equal(ray.intersectObject(outlook, true).length, 0,
        `landscape intrudes into the office near ${x.toFixed(1)}, ${z.toFixed(1)}`);
    }
    clear(root);
  });

  test(`${building}: permanent architecture keeps the editable floor clear`, () => {
    const theme = resolveTheme(createScene({ building }));
    applyPalette(theme.palette);
    const root = OFFICE_SHELLS[building].build(theme);
    root.updateMatrixWorld(true);
    const local = new THREE.Matrix4(), world = new THREE.Matrix4();
    root.traverse(o => {
      if (!o.isMesh || o.geometry.type !== 'BoxGeometry') return;
      o.geometry.computeBoundingBox();
      for (let i = 0; i < (o.isInstancedMesh ? o.count : 1); i++) {
        world.copy(o.matrixWorld);
        if (o.isInstancedMesh) { o.getMatrixAt(i, local); world.multiply(local); }
        const bounds = o.geometry.boundingBox.clone().applyMatrix4(world);
        if (bounds.max.y <= FLOOR_TOP || bounds.min.y >= 2.4) continue;
        const crossesFloor = bounds.max.x > .6 && bounds.min.x < ROOM.W - .6
          && bounds.max.z > .6 && bounds.min.z < ROOM.D - .6;
        assert.equal(crossesFloor, false, `${o.name || o.uuid}: permanent solid object blocks the floor`);
      }
    });
    clear(root);
  });

  test(`${building}: people can arrive, take desks and leave through its real entrance`, () => {
    const { root, theme, environment } = room(building);
    const props = { ...buildProps(root, theme), ...environment };
    const manager = new AgentManager(root, props);
    for (let i = 0; i < 3; i++) manager.handleEvent({ type: 'spawn', id: `person-${i}`, name: `Person ${i}` });
    assert.notEqual(playUntil(manager, () => [...manager.agents.values()].every(r => !r.arriving), 45), null);
    assert.equal(props.desks.filter(d => d.occupiedBy).length, 3);
    assert.ok(environment.stoop);
    assert.equal(typeof environment.door.requestOpen, 'function');
    for (let i = 0; i < 3; i++) manager.handleEvent({ type: 'exit', id: `person-${i}` });
    assert.notEqual(playUntil(manager, () => manager.agents.size === 0, 60), null);
    assert.equal(props.desks.filter(d => d.occupiedBy).length, 0);
    clear(root);
  });

  test(`${building}: every season stays within the geometry budget and releases its resources`, () => {
    for (const season of SEASONS) {
      const { root, theme } = room(building, season);
      let meshes = 0, triangles = 0, points = 0;
      const instances = new Set(), textures = new Set(), releasedInstances = new Set(), releasedTextures = new Set();
      root.traverse(o => {
        if (o.isPointLight) points++;
        if (!o.isMesh) return;
        meshes++;
        triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
        if (o.isInstancedMesh) {
          instances.add(o);
          assert.ok(Number.isFinite(o.boundingSphere?.radius) && o.boundingSphere.radius > 0);
          o.addEventListener('dispose', () => releasedInstances.add(o));
        }
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const value of Object.values(material)) {
            if (!value?.isTexture || textures.has(value)) continue;
            textures.add(value);
            value.addEventListener('dispose', () => releasedTextures.add(value));
          }
        }
      });
      assert.ok(meshes < 250, `${season}: ${meshes} environment meshes`);
      assert.ok(triangles < 350000, `${season}: ${triangles} environment triangles`);
      assert.equal(points, theme.fittings.cols * theme.fittings.rows, 'extra real lights in the architecture or outlook');
      clear(root);
      assert.equal(releasedInstances.size, instances.size);
      assert.equal(releasedTextures.size, textures.size);
    }
  });
}
