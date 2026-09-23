import { CAMERA } from '../config.js';

/**
 * Keep the orthographic eye behind the visible foreground, including a saved
 * view made with the old, short orbit. At a low tilt the bottom of its near
 * plane used to pass below the ground: even a huge sea was clipped to a straight
 * line with sky below it. Moving along the view axis changes depth only, so the
 * framing, zoom, pan and orbit angles stay the same.
 */
export function ensureOrbitDepth(camera, target) {
  let dx = camera.position.x - target.x;
  let dy = camera.position.y - target.y;
  let dz = camera.position.z - target.z;
  let distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) {
    [dx, dy, dz] = CAMERA.position.map((n, i) => n - CAMERA.target[i]);
    distance = Math.hypot(dx, dy, dz);
  }

  // The ground spans halfHeight * tan(polar) on either side of the target
  // along the viewing axis. Fit the widest, lowest allowed view once, with
  // room for the pan-height allowance and foreground planting.
  const minimum = CAMERA.frustum / CAMERA.minZoom * Math.tan(CAMERA.maxPolarAngle) + 64;
  const radius = Math.max(distance, minimum);
  camera.position.set(target.x + dx * radius / distance,
    target.y + dy * radius / distance, target.z + dz * radius / distance);
  // Preserve the room's background depth allowance when moving the eye back.
  camera.far = radius + 400;
  camera.updateProjectionMatrix();
}
