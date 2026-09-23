import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, seedRandom, stubDom } from '../bin/lib/headless-scene.js';
import { CAMERA, applyPalette } from '../src/config.js';
import { BUILDING_ORDER, resolveTheme } from '../src/projects.js';
import { ensureOrbitDepth } from '../src/scene/camera-depth.js';

let THREE, buildEnvironment, disposeSubtree, clearMaterialCache;
before(async () => {
  stubDom();
  THREE = await loadThree();
  ({ buildEnvironment } = await import('../src/scene/environment.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
});

test('every seasonal office has landscape beneath the corners of the widest, lowest panned view', () => {
  for (const building of BUILDING_ORDER) for (const season of ['summer', 'autumn', 'winter', 'spring']) {
    const theme = resolveTheme({ theme: building }, { building, season });
    applyPalette(theme.palette);
    const root = new THREE.Group(), restore = seedRandom();
    try {
      buildEnvironment(root, theme);
      root.updateMatrixWorld(true);
      const landscape = [];
      root.traverse(mesh => {
        if (!mesh.isMesh || mesh.isInstancedMesh) return;
        mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        // Actual terrain, not roofs, boats, foliage or the interior floor.
        if (bounds.max.x - bounds.min.x > 150 && bounds.max.z - bounds.min.z > 150) landscape.push(mesh);
      });
      const f = CAMERA.frustum, b = CAMERA.panBounds;
      const defaultAzimuth = Math.atan2(CAMERA.position[0] - CAMERA.target[0], CAMERA.position[2] - CAMERA.target[2]);
      for (const aspect of [.5, 2.4]) for (const sign of [-1, 1]) {
        for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.maxZ]]) {
          const target = new THREE.Vector3(x, CAMERA.target[1] + sign * 4, z);
          const camera = new THREE.OrthographicCamera(-f * aspect, f * aspect, f, -f, .1, 400);
          camera.zoom = CAMERA.minZoom;
          camera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(32,
            CAMERA.maxPolarAngle, defaultAzimuth + sign * CAMERA.azimuthRange));
          ensureOrbitDepth(camera, target);
          camera.lookAt(target); camera.updateMatrixWorld(true);
          const ray = new THREE.Raycaster(); ray.near = camera.near; ray.far = camera.far;
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            ray.setFromCamera(new THREE.Vector2(sx, sy), camera);
            assert.ok(ray.intersectObjects(landscape, false).length,
              JSON.stringify({ building, season, aspect, sign, target: target.toArray(), corner: [sx, sy] }));
          }
        }
      }
    } finally { restore(); disposeSubtree(root); clearMaterialCache(); }
  }
});
