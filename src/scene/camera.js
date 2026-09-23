import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA, FPV } from '../config.js';
import { restoreCameraView, saveCameraView } from './camera-view.js';
import { ensureOrbitDepth } from './camera-depth.js';

export function createCamera(aspect) {
  const f = CAMERA.frustum;
  const cam = new THREE.OrthographicCamera(
    -f * aspect, f * aspect, f, -f, 0.1, 400
  );
  cam.position.set(...CAMERA.position);
  const target = new THREE.Vector3(...CAMERA.target);
  ensureOrbitDepth(cam, target);
  cam.lookAt(target);
  return cam;
}

export function updateCameraAspect(cam, aspect) {
  const f = CAMERA.frustum;
  cam.left = -f * aspect;
  cam.right = f * aspect;
  cam.top = f;
  cam.bottom = -f;
  cam.updateProjectionMatrix();
}

export function createControls(cam, domElement) {
  const controls = new OrbitControls(cam, domElement);
  controls.target.set(...CAMERA.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Orbit is allowed, but clamped: a little movement is fun, flipping behind
  // the walls is not.
  controls.enableRotate = CAMERA.allowRotate;
  controls.rotateSpeed = 0.55;

  // Panning: OrbitControls treats ctrl/⌘/shift + left-drag as a pan, so holding
  // ctrl and dragging slides the office around. `screenSpacePanning = false`
  // keeps that motion on the ground plane, i.e. left/right and forward/back
  // rather than drifting vertically.
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.panSpeed = 1.0;

  controls.minPolarAngle = CAMERA.minPolarAngle;
  controls.maxPolarAngle = CAMERA.maxPolarAngle;

  // Clamp the swing around whatever heading the default position implies, so
  // the limits stay correct if CAMERA.position is retuned.
  const [px, , pz] = CAMERA.position;
  const [tx, , tz] = CAMERA.target;
  const defaultAzimuth = Math.atan2(px - tx, pz - tz);
  controls.minAzimuthAngle = defaultAzimuth - CAMERA.azimuthRange;
  controls.maxAzimuthAngle = defaultAzimuth + CAMERA.azimuthRange;

  // Zoom stays available.
  controls.enableZoom = true;
  controls.minZoom = CAMERA.minZoom;
  controls.maxZoom = CAMERA.maxZoom;

  // Position + target reconstruct the orbit (and therefore its orientation);
  // zoom is the orthographic lens. Install today's limits before restoring so
  // an older preference is brought inside the current scene constraints.
  const restored = restoreCameraView(cam, controls);
  controls.update();
  clampPan(cam, controls);
  ensureOrbitDepth(cam, controls.target);
  controls.update();
  if (restored) saveCameraView(cam, controls);

  // OrbitControls emits for rotate, pan and zoom, including the last damping
  // frames. localStorage is deliberately synchronous here: reloading immediately
  // after letting go must not lose the final view.
  controls.addEventListener('change', () => saveCameraView(cam, controls));
  return controls;
}

// Keeps panning inside CAMERA.panBounds. Panning moves the orbit target *and*
// the camera together, so any correction has to be applied to both or the view
// direction would shear. Call this each frame after controls.update().
export function clampPan(camera, controls) {
  const b = CAMERA.panBounds;
  const t = controls.target;

  const cx = Math.min(b.maxX, Math.max(b.minX, t.x));
  const cz = Math.min(b.maxZ, Math.max(b.minZ, t.z));
  // Ground-plane panning shouldn't drift the height, but clamp it just in case.
  const cy = Math.min(CAMERA.target[1] + 4, Math.max(CAMERA.target[1] - 4, t.y));

  if (cx !== t.x || cz !== t.z || cy !== t.y) {
    const dx = cx - t.x, dy = cy - t.y, dz = cz - t.z;
    t.set(cx, cy, cz);
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
  }
}

// --- First person ----------------------------------------------------------
// A second lens, used only while riding an agent. It is perspective where the
// office camera is orthographic, which is the point: standing somewhere only
// means something to a camera that has a viewpoint.

export function createFirstPersonCamera(aspect) {
  return new THREE.PerspectiveCamera(FPV.fov, aspect, FPV.near, FPV.far);
}

export function updateFirstPersonAspect(cam, aspect) {
  cam.aspect = aspect;
  cam.updateProjectionMatrix();
}

// The look target is one unit ahead, so a rise of tan(pitch) gives that angle.
// Precomputed: it is a constant, and this runs every frame.
const PITCH_RISE = Math.tan((FPV.pitchDeg * Math.PI) / 180);

// Scratch vectors, reused rather than allocated: this runs every frame.
const _eye = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _look = new THREE.Vector3();
const _smoothed = new THREE.Vector3();

/**
 * Put the camera behind an agent's eyes, facing the way they face.
 *
 * Position comes off the head's *world* matrix rather than being recomputed from
 * the agent's position, so everything the body already does for free comes along:
 * the walk bob, and the drop into a chair. Heading is the agent's own local +Z —
 * the axis `faceDirection` aims — flattened, so looking along a corridor doesn't
 * tilt the horizon when the body is mid-bob.
 *
 * @param {THREE.PerspectiveCamera} cam
 * @param {import('../agents/Agent.js').Agent} agent
 * @param {number} dt   seconds since the last frame; 0 to snap (i.e. on entry)
 */
export function aimFirstPerson(cam, agent, dt = 0) {
  // The manager has just moved the agent, so the head's world matrix is stale
  // until the renderer's own traversal. Ask for it now.
  agent.head.updateWorldMatrix(true, false);
  _eye.setFromMatrixPosition(agent.head.matrixWorld);

  agent.root.getWorldDirection(_forward);
  _forward.y = 0;
  // A body facing straight up or down has no heading to flatten. It cannot
  // happen today, but a zero-length forward would silently produce NaNs.
  if (_forward.lengthSq() < 1e-8) _forward.set(0, 0, 1);
  else _forward.normalize();

  _eye.addScaledVector(_forward, FPV.eyeForward);
  _eye.y += FPV.eyeUp;

  // Exponential smoothing, framerate-independent: dt = 0 snaps, which is what
  // entering the view wants so the first frame is already in place.
  const k = dt > 0 ? 1 - Math.exp(-FPV.smoothing * dt) : 1;
  if (k >= 1) {
    cam.position.copy(_eye);
    _smoothed.copy(_forward);
  } else {
    cam.position.lerp(_eye, k);
    _smoothed.lerp(_forward, k).normalize();
  }

  // Pitch is applied to the look target rather than baked into the heading, so the
  // smoothing above stays a pure horizontal turn and the tilt cannot drift with it.
  _look.copy(cam.position).add(_smoothed);
  _look.y += PITCH_RISE;
  cam.lookAt(_look);
}
