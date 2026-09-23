import * as THREE from 'three';
import { COLORS, FLOOR_TOP } from '../config.js';

// Small helpers for kit-bashing low-poly props with a consistent, cozy look.

const _mats = new Map();

// Cached standard material (flat-ish, soft) keyed by color+roughness.
export function mat(color, { rough = 0.85, metal = 0.0, flat = false, emissive = 0x000000, emissiveIntensity = 0 } = {}) {
  // A palette key keeps its meaning when a running room is redecorated. Literal
  // colours (including an agent's chosen colour) remain independent of the theme.
  const paletteKey = Object.hasOwn(COLORS, color) ? color : null;
  const key = `${color}-${rough}-${metal}-${flat}-${emissive}-${emissiveIntensity}`;
  if (_mats.has(key)) {
    const cached = _mats.get(key);
    if (paletteKey) cached.color.setHex(COLORS[paletteKey]);
    return cached;
  }
  const m = new THREE.MeshStandardMaterial({
    color: paletteKey ? COLORS[paletteKey] : color,
    roughness: rough,
    metalness: metal,
    flatShading: flat,
    emissive,
    emissiveIntensity,
  });
  if (paletteKey) m.userData.paletteKey = paletteKey;
  _mats.set(key, m);
  return m;
}

// A box mesh with sensible defaults for shadows.
export function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  return m;
}

export function cyl(rTop, rBot, h, color, opts = {}) {
  const seg = opts.segments || 12;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat(color, opts));
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  return m;
}

/**
 * A flat half-annulus, lying in the XY plane facing +z — an arch ring.
 *
 * One mesh per arch instead of a row of individual voussoir boxes, which matters
 * when every bay of every elevation has one.
 */
export function archRing(rInner, rOuter, color, opts = {}) {
  const seg = opts.segments || 16;
  const g = new THREE.RingGeometry(rInner, rOuter, seg, 1, 0, Math.PI);
  const m = new THREE.Mesh(g, mat(color, opts));
  m.castShadow = false;
  m.receiveShadow = opts.receive !== false;
  return m;
}

/** A flat half-disc in the XY plane facing +z — the glazing inside an arch head. */
export function archFill(r, color, opts = {}) {
  const seg = opts.segments || 16;
  const g = new THREE.CircleGeometry(r, seg, 0, Math.PI);
  const m = new THREE.Mesh(g, mat(color, opts));
  m.castShadow = false;
  m.receiveShadow = opts.receive !== false;
  return m;
}

export function sphere(r, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, opts.segments || 14, opts.segments || 12), mat(color, opts));
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  return m;
}

// Convenience: make a group, position it, return it.
export function group(x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

/**
 * Put a part where it belongs in the thing it is part of — the other half of
 * `group()`, which positions but does not parent.
 *
 * Kit-bashing a prop is one stanza repeated: make a shape, offset it, hand it to
 * its parent. Written out that takes three lines and a name, and the name is
 * almost never the point — the slab on top of a head is only ever "the slab",
 * read once on the line below. Saying it in one call puts the shape and the
 * offset that positions it side by side, which is how the measurements are
 * actually reasoned about: a box 0.22 high sitting at y 0.27 either lands on top
 * of the head or it does not, and that is now one line to check instead of two.
 *
 * The parent comes first, as in the `parent.add(part)` this ends in, and the part
 * is returned for the callers that go on to rotate it or read it back.
 *
 * Not to be confused with `place()` in scene/movables.js, which puts a whole
 * finished prop at its station in the room. This is inside one prop's own body.
 */
export function put(parent, obj, x = 0, y = 0, z = 0) {
  obj.position.set(x, y, z);
  parent.add(obj);
  return obj;
}

// --- Teardown -------------------------------------------------------------
// Switching projects rebuilds the whole world, so everything the old one
// allocated on the GPU has to be released or we leak a scene per switch.

const TEXTURE_SLOTS = [
  'map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap',
  'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'envMap', 'lightMap',
];

function resources(root) {
  const held = new Set();
  root?.traverse((o) => {
    if (o.geometry) held.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      held.add(m);
      for (const slot of TEXTURE_SLOTS) if (m[slot]) held.add(m[slot]);
    }
  });
  return held;
}

/** Free a removed subtree, except resources still used by a retained root. */
export function disposeSubtree(root, { keep = null } = {}) {
  const held = resources(keep);
  for (const resource of resources(root)) {
    if (!held.has(resource)) resource.dispose?.();
  }
  root.traverse((o) => {
    // A rebuilt world's sun owns render targets outside any mesh material.
    o.shadow?.dispose?.();
    // Instancing owns GPU buffers beyond the shared geometry and material.
    if (o.isInstancedMesh) o.dispose();
  });
}

/**
 * Drop the shared material cache. Must be called after disposeSubtree() on
 * teardown: cached materials are handed out by reference, so leaving them in the
 * map would mean the next world reuses disposed materials. Also required for
 * theming to take effect, since the cache is keyed on colour.
 * With `keep`, prune only unused entries: retained materials stay tracked until
 * the furniture stops using them or the whole world is disposed.
 */
export function clearMaterialCache({ keep = null } = {}) {
  const held = resources(keep);
  for (const [key, m] of _mats) {
    if (held.has(m)) continue;
    m.dispose();
    _mats.delete(key);
  }
}

/** Repaint retained furniture without replacing its handles or animation state. */
export function applyMaterialPalette(root) {
  for (const resource of resources(root)) {
    const key = resource.userData?.paletteKey;
    if (key) resource.color.setHex(COLORS[key]);
  }
}

/**
 * Y for a disc-shaped foot of height `h` resting on the floor.
 *
 * Beds it a whisker into the slab rather than landing it exactly on the surface:
 * a foot placed flush shares a plane with the floor and the pair flicker. Bedding
 * it also means the hidden underside stays hidden, so there is no rim of shadow
 * under the prop.
 */
export function footY(h) { return FLOOR_TOP - 0.02 + h / 2; }
