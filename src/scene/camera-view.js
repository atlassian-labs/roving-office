// The office camera is a browser preference, not part of an office. The same
// lens already survives switching scenes during a session; keeping one view in
// localStorage extends that behaviour across reloads without putting personal
// framing into the shared office model.

import { readJson, writeJson } from '../local-store.js';

const KEY = 'roving-office.camera.v1';

function vector(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) return null;
  return value;
}

/** Read a complete, finite camera view, or null when this browser has none. */
export function loadCameraView(storage) {
  const parsed = readJson(KEY, null, storage);
  const position = vector(parsed?.position);
  const target = vector(parsed?.target);
  const zoom = parsed?.zoom;
  if (!position || !target || !Number.isFinite(zoom) || zoom <= 0) return null;
  return { position, target, zoom };
}

/** Save the view OrbitControls needs to reconstruct its orbit. */
export function saveCameraView(camera, controls, storage) {
  const view = {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
    zoom: camera.zoom,
  };
  if (!vector(view.position) || !vector(view.target)
    || !Number.isFinite(view.zoom) || view.zoom <= 0) return false;
  // A refused write (private browsing, a locked-down embed) is reported rather
  // than thrown: the configured camera remains the fallback, so persistence must
  // never make boot fail.
  return writeJson(KEY, view, storage);
}

/** Apply a saved view, clamping the lens to today's zoom limits. */
export function restoreCameraView(camera, controls, storage) {
  const view = loadCameraView(storage);
  if (!view) return false;
  camera.position.set(...view.position);
  controls.target.set(...view.target);
  camera.zoom = Math.max(controls.minZoom, Math.min(controls.maxZoom, view.zoom));
  camera.updateProjectionMatrix();
  return true;
}
