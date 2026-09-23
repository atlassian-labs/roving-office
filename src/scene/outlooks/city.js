import * as THREE from 'three';
import { COLORS } from '../../config.js';
import { box, group, put } from '../build.js';
import { markNightLight } from '../night-lights.js';

// A low-fidelity city for the tower's outlook: a field of plain masses whose
// windows are randomly lit, so the skyline reads as a working city after dark
// rather than a row of grey slabs.
//
// The windows are painted into a texture, not built. The detailed towers in
// exterior.js put one mesh per window and it cost enough that they need
// distance bounds to stay affordable — a fully detailed tower is ~360 meshes.
// Out here a whole building is four meshes and two small canvases regardless of
// how many windows it appears to have, which is what makes a field of two dozen
// of them viable at all.
//
// Two canvases per building, not one. The albedo needs a facade with dark windows
// in it so the grid still reads in daylight; the emissive needs everything black
// except the lit ones, or the entire facade glows. Trying to share a single canvas
// gives you one or the other.

// Buildings are square in plan. Both visible elevations then share one texture
// pair — a rectangular footprint would need its own per face to keep the windows
// from stretching, doubling the canvases for a mass a long way off that nobody is
// examining that closely.
const SIZE_MIN = 12;
const SIZE_MAX = 30;

// How tall these masses are, and why they are not a distant horizon skyline.
//
// There is no horizon in this view. The camera is orthographic and looks down at
// roughly 48° onto a field of rooftops, and the whole frame is filled by them —
// there is no band of sky along the top for a far-off skyline to sit in, and
// anything placed out there is simply hidden behind the nearer roofs. So this field
// is not a backdrop: it is more towers, rising through the frame alongside the
// detailed ones, built cheaply enough that there can be a lot of them.
//
// Depth then has to be compensated for. Distance does not make a building smaller
// under this projection, it slides it up the screen — about 0.74 units of rise per
// unit of ground distance, against 0.67 units of fall per unit of altitude lost.
// Across this band that is a rise of some 40 units, most of the height of the view,
// so a field given one fixed altitude range would have its near masses crossing the
// frame and everything behind them lifted clean off the top.
//
// Both ends of a mass are therefore stepped down as it goes back, at the ratio of
// those two numbers. That holds the whole field at one height in the *frame*
// whatever its depth, which is the thing actually being controlled here.
const RISE_PER_DEPTH = 0.74 / 0.67;

// For a mass at the near edge of the band: where its base sits, and the range its
// top falls in. The base is below the roofscape so nothing is caught standing on
// air, and the tops run well above the top of the frame — like the detailed towers,
// these are meant to be cut off by the edge of the view rather than seen whole.
const BASE_AT_NEAR = -62;
const TOP_AT_NEAR_MIN = 24;
const TOP_AT_NEAR_MAX = 74;

// Window grid. Pitch rather than counts, so a tall building gets more floors
// instead of taller windows.
const FLOOR_PITCH = 3.4;
const COLUMN_PITCH = 3.0;
const PX_PER_CELL = 6;          // canvas resolution per window cell

const LIT_CHANCE = 0.30;

// Bright, because these masses sit at the far end of the haze curve and the glow
// is damped by it. Damping only partially (see below) is deliberate: haze should
// soften a lit window, not put it out — a hazed city with dark windows reads as
// derelict rather than distant.
const LIT_GLOW = 1.5;
const LIT_HAZE_DAMPING = 0.55;

// Whole floors left burning, as in the reference night shots where a few storeys
// are lit right across while the rest are patchy.
const LIT_FLOOR_CHANCE = 0.10;

// Facade tones, deliberately spanning dark glass and pale masonry. A field built
// only from the dark end reads as one material repeated, and in daylight it reads as
// a hole in the picture — the references are a mix of near-black curtain wall and
// pale stone, and the contrast between the two is what gives a skyline its depth.
const FACADE_TONES = [
  0x4a5560, 0x3f4954, 0x545e69, 0x38424c, 0x5c6672,   // dark glass
  0x8d8577, 0x9a9284, 0x7f8286, 0xa39b8c,             // pale stone and concrete
];

// How far a lit window's *albedo* is lifted off an unlit one. Only a little: the
// emissive map is what makes it glow after dark. Painting these the full lamp colour
// meant that by day the whole city was a night render, a third of every facade cream
// in bright sun, and nothing about the night view needed it.
const LIT_ALBEDO_MIX = 0.22;

// Placement tries per mass. The band is already crowded with the detailed towers,
// so a mass needs several goes at finding a gap before it is given up on.
const PLACE_ATTEMPTS = 14;

/**
 * Deterministic PRNG (mulberry32), so a given project always looks out at the
 * same skyline. Math.random() would reshuffle the entire city every time the
 * season or building override rebuilt the world, which reads as a glitch rather
 * than as variety.
 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (n) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

/**
 * Paint a building's window grid into an albedo and an emissive canvas.
 *
 * @returns {{map: THREE.CanvasTexture, emissiveMap: THREE.CanvasTexture}}
 */
function facadeTextures({ cols, rows, facade, glass, lit, random }) {
  const w = cols * PX_PER_CELL;
  const h = rows * PX_PER_CELL;

  const albedo = document.createElement('canvas');
  albedo.width = w; albedo.height = h;
  const a = albedo.getContext('2d');
  a.fillStyle = hex(facade);
  a.fillRect(0, 0, w, h);

  const glow = document.createElement('canvas');
  glow.width = w; glow.height = h;
  const e = glow.getContext('2d');
  e.fillStyle = '#000';
  e.fillRect(0, 0, w, h);

  for (let row = 0; row < rows; row++) {
    // A floor either burns right across or is decided window by window.
    const wholeFloor = random() < LIT_FLOOR_CHANCE;

    for (let col = 0; col < cols; col++) {
      const isLit = wholeFloor || random() < LIT_CHANCE;

      // Inset by a pixel so the facade shows through as a mullion grid.
      const x = col * PX_PER_CELL + 1;
      const y = row * PX_PER_CELL + 1;
      const cw = PX_PER_CELL - 2;
      const ch = PX_PER_CELL - 2;

      // Albedo barely distinguishes lit from unlit; the emissive canvas below is
      // what turns these on at dusk. See LIT_ALBEDO_MIX.
      a.fillStyle = hex(isLit ? mixToward(glass, lit, LIT_ALBEDO_MIX) : glass);
      a.fillRect(x, y, cw, ch);

      if (isLit) {
        e.fillStyle = hex(lit);
        e.fillRect(x, y, cw, ch);
      }
    }
  }

  const finish = (canvas) => {
    const tex = new THREE.CanvasTexture(canvas);
    // Crisp edges: these are windows, and filtering them turns a grid into mush.
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  return { map: finish(albedo), emissiveMap: finish(glow) };
}

/**
 * One low-fidelity building: a mass, a parapet, and a glazed elevation on each of
 * the two faces that point back at the office.
 *
 * @param {object} spec
 * @param {number} spec.haze  0 = crisp, 1 = lost in the sky
 */
function buildCityBuilding({ x, y, z, size, height, tone, haze, random }) {
  const g = group(x, y, z);
  g.name = 'city-building';

  const facade = mixToward(tone, COLORS.haze, haze);
  const glass = mixToward(COLORS.windowDark, COLORS.haze, haze);
  const lit = mixToward(COLORS.windowLit, COLORS.haze, haze * 0.7);

  put(g, box(size, height, size, facade, { rough: 0.92, cast: false }), 0, height / 2);

  const cap = box(size + 0.7, 0.6, size + 0.7, mixToward(0x5a5e63, COLORS.haze, haze),
    { rough: 0.9, cast: false });
  cap.position.y = height + 0.3;
  g.add(cap);

  const cols = Math.max(3, Math.round(size / COLUMN_PITCH));
  const rows = Math.max(4, Math.round(height / FLOOR_PITCH));
  const { map, emissiveMap } = facadeTextures({ cols, rows, facade, glass, lit, random });

  // One material for both elevations of this building, and its own — the emissive
  // is driven per building at dusk, so a cached or shared material would light the
  // whole city as one.
  const material = new THREE.MeshStandardMaterial({
    map,
    emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.55,
    metalness: 0.1,
  });

  // Set in slightly from the mass so the elevation never z-fights the body.
  const inset = 0.05;

  const front = new THREE.Mesh(new THREE.PlaneGeometry(size, height), material);
  front.position.set(0, height / 2, size / 2 + inset);
  g.add(front);

  const side = new THREE.Mesh(new THREE.PlaneGeometry(size, height), material);
  side.rotation.y = Math.PI / 2;
  side.position.set(size / 2 + inset, height / 2, 0);
  g.add(side);

  // Haze softens the glow but never kills it.
  markNightLight(g, {
    emissive: [material],
    emissiveIntensity: LIT_GLOW * (1 - haze * LIT_HAZE_DAMPING),
  });

  return g;
}

/** Blend a colour toward another. */
function mixToward(hexColour, towardHex, amount) {
  const t = Math.max(0, Math.min(1, amount));
  const channel = (shift) => {
    const from = (hexColour >> shift) & 0xff;
    const to = (towardHex >> shift) & 0xff;
    return Math.round(from * (1 - t) + to * t) & 0xff;
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * A field of low-fidelity towers filling the distance behind the office.
 *
 * Placement is relative to the direction the camera looks, not to the world axes,
 * because of two consequences of an isometric camera that are easy to get wrong.
 *
 * It is orthographic, so distance does not shrink anything: a mass either falls
 * inside a fixed-width slab in front of the lens or it is not on screen at all.
 * Scattering buildings around a compass arc — the obvious approach — put most of
 * this city outside that slab.
 *
 * And depth moves things *up* the screen rather than toward a horizon, so how far
 * back a mass sits and how tall it is are not independent choices. That is handled
 * by stepping each mass down with its depth; see RISE_PER_DEPTH.
 *
 * So buildings are placed by how far *back* they sit along the view axis and how far
 * they stray across it, which is exactly the frame they have to fill. Across the
 * axis the units are convenient: the lateral direction is the screen's own
 * horizontal, so `spread` is very nearly half the frame width in world units.
 *
 * @param {(x: number, z: number) => number} opts.haze  distance fade policy,
 *   supplied by the caller so the whole exterior fades on one curve
 * @param {{x: number, z: number}} opts.centre  what the camera is pointed at
 * @param {{x: number, z: number}} opts.view    camera-to-target direction, in xz
 * @param {[number, number]} [opts.depth]  how far back, along the view axis
 * @param {number} [opts.spread]           half-width across the view axis
 * @param {number} [opts.count]
 * @param {number} [opts.seed]
 * @param {{x: number, z: number, radius: number}[]} [opts.avoid]  footprints already
 *   taken, so this city fills the gaps between them instead of growing through them
 */
export function buildCityField({
  haze,
  centre,
  view,
  // Deep enough to sit among and behind the detailed towers — a field this size does
  // not fit in a narrow strip once their footprints are excluded — and spread to
  // just past both edges of the frame, so the city runs off the sides rather than
  // stopping short of them.
  depth = [30, 78],
  spread = 46,
  count = 24,
  seed = 1337,
  avoid = [],
}) {
  const g = group(0, 0, 0);
  const random = rng(seed);

  // Normalised view axis, and the horizontal perpendicular to it. Lateral offset
  // moves a mass sideways on screen without changing its height in frame, which is
  // what makes it safe to spread across without losing anything off the top.
  const len = Math.hypot(view.x, view.z) || 1;
  const axis = { x: view.x / len, z: view.z / len };
  const lateral = { x: -axis.z, z: axis.x };

  const taken = [...avoid];

  for (let i = 0; i < count; i++) {
    const size = SIZE_MIN + random() * (SIZE_MAX - SIZE_MIN);

    // Even lateral slots, rather than pure random: with this few masses, random
    // placement leaves bald patches in a frame they are meant to fill, and clumps
    // three of them into one silhouette.
    const slot = -spread + ((i + 0.5) / count) * spread * 2;

    // The detailed towers already stand in this band, so a mass may well land
    // inside one. Both the depth *and* the lateral offset are re-rolled on each
    // attempt: re-rolling depth alone means a lateral slot that happens to line up
    // with a tower is blocked at every depth, fails all its attempts, and leaves a
    // hole. That is how a field of eighteen once placed two.
    const jitter = (spread / count) * 1.6;
    let x = 0, z = 0, back = 0, placed = false;
    for (let attempt = 0; attempt < PLACE_ATTEMPTS && !placed; attempt++) {
      back = depth[0] + random() * (depth[1] - depth[0]);
      const across = slot + (random() - 0.5) * jitter * 2;
      x = centre.x + axis.x * back + lateral.x * across;
      z = centre.z + axis.z * back + lateral.z * across;
      placed = !taken.some((t) => Math.hypot(x - t.x, z - t.z) < t.radius + size / 2);
    }
    if (!placed) continue;

    taken.push({ x, z, radius: size / 2 });

    // Both ends stepped down by depth, so the field holds one height in the frame —
    // see RISE_PER_DEPTH. Only depth along the view axis counts: lateral offset
    // moves a mass sideways on screen without changing where it sits vertically.
    const drop = RISE_PER_DEPTH * (back - depth[0]);
    const base = BASE_AT_NEAR - drop;
    const top = TOP_AT_NEAR_MIN + random() * (TOP_AT_NEAR_MAX - TOP_AT_NEAR_MIN) - drop;

    const tone = FACADE_TONES[Math.floor(random() * FACADE_TONES.length)];

    g.add(buildCityBuilding({
      x, y: base, z, size,
      height: top - base,
      tone,
      haze: haze(x, z),
      random,
    }));
  }

  return g;
}
