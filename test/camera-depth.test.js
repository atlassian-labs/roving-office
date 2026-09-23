import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree } from '../bin/lib/headless-scene.js';
import { CAMERA } from '../src/config.js';
import { ensureOrbitDepth } from '../src/scene/camera-depth.js';
import { restoreCameraView, saveCameraView } from '../src/scene/camera-view.js';

let THREE;
before(async () => { THREE = await loadThree(); });

function view({ aspect = 1.25, zoom = 1.1, polar = 1.14, azimuth = .72, targetY = 1.5 } = {}) {
  const f = CAMERA.frustum;
  const camera = new THREE.OrthographicCamera(-f * aspect, f * aspect, f, -f, .1, 400);
  const target = new THREE.Vector3(12, targetY, 10);
  camera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(32, polar, azimuth));
  camera.zoom = zoom;
  aim(camera, target);
  return { camera, target };
}

function aim(camera, target) {
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function groundAt(camera, x, y, height) {
  // Use the infinite line: Ray.intersectPlane() would reject the very negative
  // intersection responsible for the old strip, without telling us its depth.
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x, y), camera);
  const t = (height - ray.ray.origin.y) / ray.ray.direction.y;
  return ray.ray.at(t, new THREE.Vector3());
}

test('low tilted view keeps foreground ground in front of the near plane', () => {
  const { camera, target } = view();
  const foreground = groundAt(camera, 0, -1, -1.25);
  assert.ok(foreground.clone().project(camera).z < -1, 'reproduce the reported sky strip');
  ensureOrbitDepth(camera, target);
  aim(camera, target);
  const projected = foreground.clone().project(camera);
  assert.ok(projected.z > -1 && projected.z < 1, 'the same foreground is now inside the depth range');
});

test('ground covers the lens depth across allowed zoom, tilt, pan height and aspect', () => {
  for (const aspect of [.5, 1.25, 2.4]) for (const zoom of [CAMERA.minZoom, 1.1, CAMERA.maxZoom]) {
    for (const polar of [CAMERA.minPolarAngle, 1.14, CAMERA.maxPolarAngle]) {
      for (const targetY of [CAMERA.target[1] - 4, CAMERA.target[1] + 4]) {
        for (const azimuth of [-.16, .72, 1.6]) {
          const { camera, target } = view({ aspect, zoom, polar, targetY, azimuth });
          ensureOrbitDepth(camera, target);
          aim(camera, target);
          for (const height of [-1.25, -15.25, -26]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
            const depth = groundAt(camera, x, y, height).project(camera).z;
            assert.ok(depth > -1 && depth < 1, JSON.stringify({ aspect, zoom, polar, targetY, height, x, y, depth }));
          }
        }
      }
    }
  }
});

test('repairing an old saved orbit preserves framing, zoom and picking, and stays stable on reload', () => {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const original = view();
  const controls = { target: original.target, minZoom: CAMERA.minZoom, maxZoom: CAMERA.maxZoom };
  saveCameraView(original.camera, controls, storage);
  const points = [[3, 1, 4], [19, 8, -3], [12, 0, 10]].map(p => new THREE.Vector3(...p));
  const before = points.map(p => p.clone().project(original.camera));

  const { camera, target } = view({ zoom: 8, polar: .6 });
  restoreCameraView(camera, { ...controls, target }, storage);
  ensureOrbitDepth(camera, target);
  aim(camera, target);
  assert.equal(camera.zoom, original.camera.zoom);
  for (const [i, point] of points.entries()) {
    const after = point.clone().project(camera);
    assert.ok(Math.abs(after.x - before[i].x) < 1e-10);
    assert.ok(Math.abs(after.y - before[i].y) < 1e-10);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(after.x, after.y), camera);
    assert.ok(ray.ray.distanceToPoint(point) < 1e-10, 'picking still reaches the object under the same pixel');
  }
  const position = camera.position.clone(), far = camera.far;
  saveCameraView(camera, { ...controls, target }, storage);
  restoreCameraView(camera, { ...controls, target }, storage);
  ensureOrbitDepth(camera, target);
  assert.ok(position.distanceTo(camera.position) < 1e-10);
  assert.ok(Math.abs(camera.far - far) < 1e-10);
});
