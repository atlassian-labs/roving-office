import * as THREE from 'three';
import { ROOM } from '../config.js';
import { clamp01 } from '../measure.js';
import { put } from './build.js';

// Lights that only exist after dark: the office ceiling fittings and the pool of
// light each street lamp throws onto the road.
//
// Two things do the work, and they are deliberately different:
//
//   * A PointLight actually illuminates geometry — the pole, a passing car, the
//     desks and the agents at them. It is what makes the room readable at night.
//   * A "pool" is a flat disc of additive glow laid on the ground. No light in a
//     forward renderer paints a visible circle on a large flat plane the way the
//     eye expects, because the floor is one big low-detail surface; the disc is
//     what actually reads as "that lamp is lighting the road".
//
// Both are needed. The light alone looks oddly dim on the tarmac, and the disc
// alone leaves everything standing on it unlit.
//
// Fittings register themselves in `userData.nightLight` rather than being
// threaded back up through the builders as return values. Street lamps are built
// three calls deep inside the exterior, and passing a registry down through every
// intermediate function to collect a handful of handles would put plumbing in a
// dozen signatures that have no other interest in lighting. One traversal at
// build time collects them instead — see collectNightLights().

const LAMP_COLOUR = 0xffd6a0;      // warm sodium-ish street lighting

// Ceiling fittings sit on a grid over the floor plate. A theme supplies its own
// grid, colour and strength — a warehouse is lit by a few hard lamps a long way up
// where an office is lit by an even grid of soft ones — and these are the
// fallbacks for anything a theme leaves out.
const FITTINGS_DEFAULT = {
  cols: 3,
  rows: 2,
  colour: 0xffe6c4,
  intensity: 55,
  poolRadius: 6.5,
  poolOpacity: 0.20,
};

const CEILING_DROP = 0.6;          // below the (absent) ceiling line

// Intensities are in candela: this renderer uses three's physical light units, so
// what reaches a surface falls off as 1/d² and the numbers have to be derived from
// the actual drop, not eyeballed. A fitting at ROOM.H - 0.6 is ~7.3 above the
// floor, so 55cd puts ~1.0 on the boards under it and ~1.5 on an agent's head.
// Picking these by feel is how you end up with a room lit like a car park.
const CEILING_DISTANCE = 20;       // hard cutoff, beyond the useful falloff

const LAMP_POOL_R = 5.4;
const LAMP_POOL_OPACITY = 0.34;
const LAMP_HEAD_EMISSIVE = 1.15;   // how hot the glass ball goes at night

// The floor plate's top face; pools sit a hair above it so they don't z-fight.
const FLOOR_TOP = 0.1;

// Shared by every pool in the world. Teardown disposes the textures it finds on
// materials, so this reference has to be dropped when a world is torn down or the
// next one would hand its pools an already-disposed texture — see
// releaseNightLightAssets().
let _poolTexture = null;

/**
 * A soft radial falloff, drawn once and shared by every pool.
 *
 * The stops are not a linear ramp: a straight gradient reads as a flat grey
 * plate with a hard rim. Easing the alpha down steeply at first and then long
 * into the edge is what gives it the look of light falling off.
 */
function poolTexture() {
  if (_poolTexture) return _poolTexture;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0.00, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.62)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.24)');
  gradient.addColorStop(0.80, 'rgba(255,255,255,0.06)');
  gradient.addColorStop(1.00, 'rgba(255,255,255,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  _poolTexture = new THREE.CanvasTexture(canvas);
  _poolTexture.colorSpace = THREE.SRGBColorSpace;
  return _poolTexture;
}

/**
 * A disc of additive glow, lying flat and facing up.
 *
 * `depthWrite` is off so pools never occlude each other: two overlapping pools
 * should sum to something brighter, which is what overlapping light does.
 */
export function buildLightPool(radius, colour, opacity) {
  const material = new THREE.MeshBasicMaterial({
    map: poolTexture(),
    color: colour,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  const pool = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material);
  pool.rotation.x = -Math.PI / 2;
  pool.renderOrder = 2;     // after opaque geometry
  pool.receiveShadow = false;
  pool.castShadow = false;
  return pool;
}

/**
 * Tag an object as after-dark lighting, so collectNightLights() finds it.
 *
 * @param {THREE.Object3D} carrier      the object to tag
 * @param {object} spec
 * @param {THREE.PointLight} [spec.light]
 * @param {THREE.Mesh} [spec.pool]
 * @param {THREE.Material[]} [spec.emissive]  materials whose glow follows nightfall
 */
export function markNightLight(carrier, spec) {
  carrier.userData.nightLight = {
    light: spec.light ?? null,
    pool: spec.pool ?? null,
    emissive: spec.emissive ?? [],
    // Captured now, so applyNightLights scales against the fitting's own design
    // brightness rather than whatever it last wrote.
    lightIntensity: spec.light?.intensity ?? 0,
    poolOpacity: spec.pool?.material.opacity ?? 0,
    emissiveIntensity: spec.emissiveIntensity ?? LAMP_HEAD_EMISSIVE,
  };
  return carrier;
}

/**
 * The office's own lighting: a grid of ceiling fittings.
 *
 * There is no ceiling to mount them on — the room is a cutaway and the fourth
 * wall and lid are missing so you can see in. So the fittings are invisible,
 * placed where the ceiling plane would be. Giving them visible housings would
 * hang boxes in mid-air directly in the camera's view of the floor.
 *
 * What you see instead is their effect: the pools they cast on the floor.
 */
export function buildCeilingLights(spec = {}) {
  const { cols, rows, colour, intensity, poolRadius, poolOpacity } =
    { ...FITTINGS_DEFAULT, ...spec };

  const g = new THREE.Group();
  g.name = 'ceiling-lights';

  const y = ROOM.H - CEILING_DROP;

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      // Cell centres, so the outer fittings sit inboard of the walls rather than
      // hard against them.
      const x = ROOM.W * (col + 0.5) / cols;
      const z = ROOM.D * (row + 0.5) / rows;

      const fitting = new THREE.Group();
      fitting.position.set(x, 0, z);

      const light = new THREE.PointLight(colour, intensity, CEILING_DISTANCE, 2);
      light.position.y = y;
      light.castShadow = false;
      fitting.add(light);

      const pool = put(fitting, buildLightPool(poolRadius, colour, poolOpacity), 0, FLOOR_TOP + 0.015);

      markNightLight(fitting, { light, pool });
      g.add(fitting);
    }
  }

  return g;
}

/**
 * Everything a street lamp needs to come on: the pool it throws on the road, and
 * the glass head's own glow. Returned rather than added, so the lamp builder can
 * place them in its own local space.
 *
 * Deliberately no PointLight, and this was measured rather than assumed. There are
 * nine lamps; giving each one a light took the scene from 17.7fps to 8.8 in a
 * software rasteriser, because a forward renderer runs every light for every
 * fragment of every lit surface. The pools cost 0.2fps for the same nine.
 *
 * The trade is a good one here because of what a street lamp actually has to
 * light: a large, flat, featureless road. There is no geometry out there for a
 * real light to model — no relief on the tarmac to catch it — so a light buys
 * almost nothing a disc of glow doesn't already sell. The office interior is the
 * opposite case, full of desks and agents that need genuine shading, which is why
 * buildCeilingLights() does spend real lights.
 *
 * @param {number} headX       local x of the lamp head, so the pool sits under it
 * @param {number} groundY     local y of the surface to lay the pool on
 * @param {THREE.Material} headMaterial
 */
export function streetLampLighting(headX, groundY, headMaterial) {
  const pool = buildLightPool(LAMP_POOL_R, LAMP_COLOUR, LAMP_POOL_OPACITY);
  // Pushed out past the kerb: the lamp overhangs the road on its arm, so the
  // brightest part of the pool belongs on the tarmac, not on the pavement.
  pool.position.set(headX + 1.4, groundY, 0);

  return { pool, emissive: [headMaterial] };
}

/**
 * Tag a mesh whose glazing should only glow after dark.
 *
 * Lit windows on the towers, the city and our own lower storeys were emissive all
 * the time, so every office in the skyline burned at midday. Their albedo is
 * deliberately left alone — pale glass reads as a daylight reflection — and only
 * the glow follows the clock.
 *
 * Materials here are usually shared through the material cache, so several meshes
 * resolve to the same one and it gets written more than once a frame. That is a
 * couple of wasted scalar writes, against having to thread unique materials
 * through every facade builder.
 *
 * @param {THREE.Mesh} mesh
 * @param {number} intensity  glow at full night
 */
export function markLitWindow(mesh, intensity) {
  mesh.material.emissiveIntensity = 0;
  return markNightLight(mesh, { emissive: [mesh.material], emissiveIntensity: intensity });
}

/**
 * Drop the shared pool texture. Must be called on teardown, alongside
 * clearMaterialCache(): disposeSubtree() disposes the `map` of every material it
 * walks, so the first pool disposed takes the shared texture with it. Holding the
 * reference would leave the next world's pools pointing at a dead texture.
 */
export function releaseNightLightAssets() {
  _poolTexture?.dispose();
  _poolTexture = null;
}

/**
 * Gather every tagged fitting under a subtree, once, at build time.
 *
 * @param {THREE.Object3D} root
 * @returns {object[]} handles for applyNightLights()
 */
export function collectNightLights(root) {
  const found = [];
  root.traverse((obj) => {
    if (obj.userData?.nightLight) found.push(obj.userData.nightLight);
  });
  return found;
}

/**
 * Bring the fittings up or down. Cheap enough to call every frame: a couple of
 * scalar writes per fitting.
 *
 * @param {object[]} handles  what collectNightLights() returned
 * @param {number} amount     0 = full daylight (off), 1 = night (full)
 */
export function applyNightLights(handles, amount) {
  if (!handles?.length) return;
  const t = clamp01(amount);
  const off = t < 0.01;

  for (const h of handles) {
    if (h.light) {
      h.light.intensity = h.lightIntensity * t;
      // Hiding it drops it from the renderer's light list, so a daylit scene pays
      // nothing for a dozen dark fittings. The cost is a shader recompile when the
      // count changes, which is one hitch at dusk — cheaper than carrying every
      // light through every fragment all day.
      h.light.visible = !off;
    }
    if (h.pool) {
      h.pool.material.opacity = h.poolOpacity * t;
      h.pool.visible = !off;
    }
    for (const m of h.emissive) {
      m.emissiveIntensity = h.emissiveIntensity * t;
    }
  }
}
