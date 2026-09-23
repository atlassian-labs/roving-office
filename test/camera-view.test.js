import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const storage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
};

const { loadCameraView, restoreCameraView, saveCameraView } =
  await import('../src/scene/camera-view.js');

function point(x, y, z) {
  return {
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; },
  };
}

function coords(value) {
  return [value.x, value.y, value.z];
}

function view() {
  const camera = {
    position: point(26, 25, 26),
    zoom: 1,
    projectionUpdates: 0,
    updateProjectionMatrix() { this.projectionUpdates += 1; },
  };
  const controls = {
    target: point(12, 1.5, 10),
    minZoom: 0.7,
    maxZoom: 2.4,
  };
  return { camera, controls };
}

beforeEach(() => store.clear());

test('camera position, orbit target and zoom round-trip through storage', () => {
  const first = view();
  first.camera.position.set(30, 19, 14);
  first.controls.target.set(9, 2, 7);
  first.camera.zoom = 1.75;

  assert.equal(saveCameraView(first.camera, first.controls, storage), true);
  assert.deepEqual(loadCameraView(storage), {
    position: [30, 19, 14],
    target: [9, 2, 7],
    zoom: 1.75,
  });

  const next = view();
  assert.equal(restoreCameraView(next.camera, next.controls, storage), true);
  assert.deepEqual(coords(next.camera.position), [30, 19, 14]);
  assert.deepEqual(coords(next.controls.target), [9, 2, 7]);
  assert.equal(next.camera.zoom, 1.75);
  assert.equal(next.camera.projectionUpdates, 1);
});

test('restore clamps an old zoom to the current control limits', () => {
  store.set('roving-office.camera.v1', JSON.stringify({
    position: [30, 19, 14], target: [9, 2, 7], zoom: 99,
  }));
  const { camera, controls } = view();
  assert.equal(restoreCameraView(camera, controls, storage), true);
  assert.equal(camera.zoom, controls.maxZoom);
});

test('malformed stored state leaves the configured camera untouched', () => {
  const cases = [
    '{not json',
    JSON.stringify({ position: [1, 2], target: [3, 4, 5], zoom: 1 }),
    JSON.stringify({ position: [1, 2, 3], target: [3, 4, 5], zoom: -1 }),
    JSON.stringify({ position: [1, null, 3], target: [3, 4, 5], zoom: 1 }),
  ];

  for (const raw of cases) {
    store.set('roving-office.camera.v1', raw);
    const { camera, controls } = view();
    assert.equal(restoreCameraView(camera, controls, storage), false);
    assert.deepEqual(coords(camera.position), [26, 25, 26]);
    assert.deepEqual(coords(controls.target), [12, 1.5, 10]);
    assert.equal(camera.zoom, 1);
    assert.equal(camera.projectionUpdates, 0);
  }
});

test('storage failures fall back silently', () => {
  const broken = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  const { camera, controls } = view();
  assert.equal(restoreCameraView(camera, controls, broken), false);
  assert.equal(saveCameraView(camera, controls, broken), false);
});
