import * as THREE from 'three';
import { box, cyl, sphere, group, mat, put } from './build.js';

// The office planting.
//
// Split out of props.js because greenery is now a small family of species rather
// than the one blobby pot it started as, and because it answers a question the
// rest of the furniture does not: *what month is it?*
//
// The answer is deliberately split, and that split is the whole idea. The season
// is told in the two places where the outside is already in the frame, and only
// there:
//
//   - The plants standing on the room's open cutaway edges and in the sage wall's
//     window bay are `seasonal`: they take the same greens the seasons repaint for
//     the street, so they turn amber in October and come out in blossom in April
//     alongside the trees over the road.
//   - The window sills carry planted troughs, with that season's street visible
//     straight through the glass behind them: blossom, then a full green, then
//     amber and hips, then evergreen sprigs with berries and bare stems.
//
// Everything else — the fig by the coffee machine, the snake plant on the beige
// wall, the fern, the trailing pothos, the cacti and succulents on the desks — is
// evergreen, which is what keeps the office green in February instead of looking
// like something nobody watered.
//
// Sizing convention: every builder here puts the *base of its pot at local
// y = 0*, so a caller positions the group at whatever surface it stands on —
// floor, desk top, side table, shelf — and nothing needs to know a pot's height.

/**
 * Which palette keys a plant follows. Materials keep these keys so a theme change
 * can repaint retained plants without rebuilding their geometry.
 *
 * The evergreen set is `F.leaf*`, held deliberately apart from the
 * palette's `leaf`/`leafDark`: those two are what every season repaints, and a
 * houseplant in the middle of the room that turned orange in October would read as
 * a houseplant nobody had watered. A plant asks for the seasonal pair only when it
 * stands somewhere the street is in shot behind it.
 */
function greens(seasonal = false) {
  return seasonal
    ? { leaf: 'leaf', dark: 'leafDark', light: 'leaf' }
    : { leaf: 'houseLeaf', dark: 'houseLeafDark', light: 'houseLeafLight' };
}

/**
 * What is in the window troughs, month by month. Colour *and* geometry, because
 * winter is not a recolour of summer — it is bare wood with a couple of berries
 * on it, and no palette entry can say that.
 *
 * `foliage` is a fraction: how full the trough is planted. `blooms` is how many
 * flower heads sit above it, `berries` how many hard winter fruits, and `twigs`
 * how many bare stems show through.
 */
const SILL_SEASONS = {
  spring: {
    // Blossom, matching the cherries the street has come into flower.
    mound: 0xe9b7cd, moundAlt: 0xd79cb6, foliage: 0.9,
    blooms: 9, bloom: 0xfff2f6, bloomAlt: 0xf6c9dc, berries: 0, twigs: 1,
  },
  summer: {
    // High summer: full, and flowering white and yellow.
    mound: 0x6ea364, moundAlt: 0x548a4e, foliage: 1.0,
    blooms: 8, bloom: 0xfdf6e0, bloomAlt: 0xf0c65a, berries: 0, twigs: 0,
  },
  autumn: {
    // Turning, and going over: fewer flowers, more seedhead.
    mound: 0xc27b33, moundAlt: 0x9c5324, foliage: 0.75,
    blooms: 5, bloom: 0xd98324, bloomAlt: 0x8c3b16, berries: 3, twigs: 3,
  },
  winter: {
    // Cut back to evergreen sprigs, with berries and bare stems above them, and
    // nothing at all in flower — so the bloom colours go unread.
    mound: 0x3f6b4f, moundAlt: 0x2f5540, foliage: 0.5,
    blooms: 0, bloom: null, bloomAlt: null, berries: 7, twigs: 6,
  },
};

const BERRY = 0xb2402f;

/** Deterministic generator, so planting does not rearrange itself on a rebuild. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A pot: tapered body, a rim that stands proud of it, and soil sunk just below
 * the rim. The soil is *inside* the pot rather than capping it, so the two never
 * share a face and flicker.
 */
function addPot(g, { r = 0.4, h = 0.7, color = null, rim = true }) {
  const c = color ?? 'pot';
  put(g, cyl(r, r * 0.78, h, c, { segments: 14, rough: 0.8 }), 0, h / 2);
  if (rim) {
    put(g, cyl(r * 1.08, r * 1.02, h * 0.13, c, { segments: 14, rough: 0.75 }), 0, h - h * 0.05);
  }
  put(g, cyl(r * 0.93, r * 0.93, 0.07, 'soil', { segments: 14, cast: false }), 0, h - 0.06);
  return h;
}

/**
 * A stem from `from` to `to`: a thin cylinder aimed along the line between them.
 * Cylinders are built along y, so the direction goes in as a rotation.
 */
function stemTo(from, to, radius, color) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const stem = cyl(radius, radius * 1.15, dir.length(), color, { segments: 5, cast: false });
  stem.position.copy(from).addScaledVector(dir, 0.5);
  stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return stem;
}

/** One flat-shaded leaf blob, squashed into a leaf-ish ellipsoid and aimed outward. */
function leafBlob(radius, color, { spread = 1, lift = 1, thin = 0.42 } = {}) {
  const leaf = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 0),
    mat(color, { flat: true, rough: 0.9 })
  );
  leaf.scale.set(spread, lift, thin);
  leaf.castShadow = true;
  return leaf;
}

// ---------------------------------------------------------------------------
// Floor plants

/**
 * A weeping fig in a big pot: the room's hero plant, tall enough to read from
 * across the office. Two leaning stems with the foliage carried up their length,
 * rather than a lollipop on a stick.
 */
export function buildFig(scale = 1, opts = {}) {
  const g = group(0, 0, 0);
  const F = greens(opts.seasonal);
  const potH = addPot(g, { r: 0.36 * scale, h: 0.62 * scale });
  const rnd = seeded(0x1f1);

  // Two stems from the same pot, leaning apart.
  const stems = [
    { lean: 0.10, dir: 0.4, h: 1.02 },
    { lean: -0.13, dir: 2.4, h: 0.78 },
  ];
  for (const s of stems) {
    const stemH = s.h * scale;
    const stem = cyl(0.055 * scale, 0.085 * scale, stemH, 'woodDark', { segments: 8 });
    stem.position.set(
      Math.cos(s.dir) * 0.1 * scale,
      potH + stemH / 2 - 0.05 * scale,
      Math.sin(s.dir) * 0.1 * scale
    );
    stem.rotation.z = s.lean;
    g.add(stem);

    // Foliage up the top two-thirds of the stem, alternating tone so the canopy
    // does not read as one flat mass.
    const top = potH + stemH;
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const a = i * 2.3 + s.dir;
      const y = top - stemH * 0.62 * (1 - t) - 0.1 * scale;
      const r = (0.19 + rnd() * 0.08) * scale;
      const leaf = leafBlob(r, i % 3 === 0 ? F.dark : F.leaf, {
        spread: 1.15, lift: 0.55, thin: 0.8,
      });
      leaf.position.set(
        Math.cos(a) * (0.24 + t * 0.12) * scale + Math.sin(s.lean) * -y * 0.5,
        y,
        Math.sin(a) * (0.24 + t * 0.12) * scale
      );
      leaf.rotation.set(0.25 - t * 0.4, a, 0.2);
      g.add(leaf);
    }
    // A pale crown of new growth at the tip.
    put(g, leafBlob(0.17 * scale, F.light, { spread: 1.0, lift: 0.7, thin: 0.85 }), Math.sin(s.lean) * -top * 0.5, top + 0.1 * scale, 0);
  }
  return g;
}

/**
 * A monstera: a low clump of big, broad leaves on their own stalks. Wider than
 * it is tall, so it fills a corner the fig would overshoot.
 */
export function buildMonstera(scale = 1, opts = {}) {
  const g = group(0, 0, 0);
  const F = greens(opts.seasonal);
  const potH = addPot(g, { r: 0.32 * scale, h: 0.46 * scale, color: 'terracotta' });

  const LEAVES = 7;
  for (let i = 0; i < LEAVES; i++) {
    const a = (i / LEAVES) * Math.PI * 2 + 0.4;
    const reach = (0.26 + (i % 3) * 0.06) * scale;
    const h = (0.3 + (i % 4) * 0.13) * scale;

    // Stalk out to where the leaf hangs.
    const stalk = cyl(0.025 * scale, 0.035 * scale, h, F.dark, { segments: 6 });
    stalk.position.set(Math.cos(a) * reach * 0.45, potH + h / 2, Math.sin(a) * reach * 0.45);
    stalk.rotation.z = -Math.cos(a) * 0.5;
    stalk.rotation.x = Math.sin(a) * 0.5;
    g.add(stalk);

    // The leaf itself: a broad plate, tipped over to catch the light.
    const leaf = leafBlob((0.24 + (i % 2) * 0.05) * scale,
      i % 2 ? F.leaf : F.dark, { spread: 1.3, lift: 0.3, thin: 1.1 });
    leaf.position.set(Math.cos(a) * reach, potH + h, Math.sin(a) * reach);
    leaf.rotation.set(0.5, -a, 0.35);
    g.add(leaf);
  }
  return g;
}

/**
 * A snake plant: upright blades, almost no footprint. The one to put where
 * anything with a canopy would be in the way.
 */
export function buildSnakePlant(scale = 1, opts = {}) {
  const g = group(0, 0, 0);
  const F = greens(opts.seasonal);
  const potH = addPot(g, { r: 0.26 * scale, h: 0.44 * scale, color: 'coolerBody', rim: false });
  const rnd = seeded(0x2c5);

  const BLADES = 9;
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2;
    const h = (0.6 + rnd() * 0.42) * scale;
    const blade = box(0.12 * scale, h, 0.045 * scale,
      i % 3 === 0 ? F.light : F.dark, { rough: 0.85 });
    // Leaning out from the centre, each blade turned to face its own way.
    blade.position.set(Math.cos(a) * 0.1 * scale, potH + h / 2 - 0.04, Math.sin(a) * 0.1 * scale);
    blade.rotation.y = -a;
    blade.rotation.z = Math.cos(a) * 0.16;
    blade.rotation.x = -Math.sin(a) * 0.16;
    g.add(blade);
  }
  return g;
}

/** A fern: a shallow bowl of arching fronds. Small enough for a side table. */
export function buildFern(scale = 1, opts = {}) {
  const g = group(0, 0, 0);
  const F = greens(opts.seasonal);
  const potH = addPot(g, { r: 0.17 * scale, h: 0.2 * scale, color: 'pot' });

  const FRONDS = 9;
  for (let i = 0; i < FRONDS; i++) {
    const a = (i / FRONDS) * Math.PI * 2 + 0.3;
    const frond = leafBlob((0.1 + (i % 3) * 0.025) * scale,
      i % 2 ? F.light : F.leaf, { spread: 1.6, lift: 0.28, thin: 0.5 });
    // Arching: the further out, the more it droops.
    frond.position.set(
      Math.cos(a) * 0.15 * scale,
      potH + (0.07 + (i % 3) * 0.05) * scale,
      Math.sin(a) * 0.15 * scale
    );
    frond.rotation.set(0.2, -a, 0.55);
    g.add(frond);
  }
  return g;
}

/**
 * Trailing pothos, for standing on top of something tall: a pot of leaves with
 * strands long enough to actually hang — over the front edge and, in one long
 * run, down the side of whatever it is sitting on.
 *
 * Every strand is thrown between +z and +x, so a caller stands the pot at the
 * front corner of a shelf top and the trails fall in clear air past the front and
 * the side rather than down inside the carcass. `sideDrop` is how many links the
 * long one gets; each link is roughly 0.2 of drop.
 */
export function buildPothos(scale = 1, opts = {}) {
  const g = group(0, 0, 0);
  const F = greens(opts.seasonal);
  const potH = addPot(g, { r: 0.19 * scale, h: 0.22 * scale, color: 'mailbox', rim: false });

  // The crown sitting in the pot.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const leaf = leafBlob(0.12 * scale, i % 2 ? F.leaf : F.light,
      { spread: 1.2, lift: 0.45, thin: 0.9 });
    leaf.position.set(Math.cos(a) * 0.11 * scale, potH + 0.07 * scale, Math.sin(a) * 0.11 * scale);
    leaf.rotation.set(0.3, a, 0.2);
    g.add(leaf);
  }

  // Strand angles: 0 runs down the side of whatever this is standing on, the rest
  // spill over its front. They start REACH out from the pot, which is what keeps
  // them clear of the top of the case: a strand that starts plumb under the rim
  // falls inside the carcass and is never seen again.
  const REACH = 0.42;
  const strands = [
    { a: 0.05, links: opts.sideDrop ?? 9 },
    { a: 0.8, links: 5 },
    { a: 1.5, links: 7 },
    { a: 2.15, links: 4 },
  ];
  for (const strand of strands) {
    const first = new THREE.Vector3(
      Math.cos(strand.a) * REACH * scale,
      potH * 0.75 - 0.08 * scale,
      Math.sin(strand.a) * REACH * scale
    );
    // An arching stem out of the pot to where the runner starts to fall.
    g.add(stemTo(new THREE.Vector3(0, potH * 0.85, 0), first, 0.016 * scale, F.dark));

    for (let i = 0; i < strand.links; i++) {
      // Leaning further out as it falls, and tapering, so the strand reads as one
      // runner rather than a stack of separate leaves.
      const drop = i * 0.2 * scale;
      const out = (REACH + i * 0.05) * scale;
      const leaf = leafBlob((0.115 - i * 0.006) * scale,
        i % 2 ? F.dark : F.leaf, { spread: 1.15, lift: 0.5, thin: 0.95 });
      leaf.position.set(Math.cos(strand.a) * out, first.y - drop, Math.sin(strand.a) * out);
      leaf.rotation.set(0.2, strand.a, 0.35 + i * 0.08);
      g.add(leaf);
      // A length of runner between this leaf and the next.
      if (i < strand.links - 1) {
        const next = new THREE.Vector3(
          Math.cos(strand.a) * (REACH + (i + 1) * 0.05) * scale,
          first.y - (i + 1) * 0.2 * scale,
          Math.sin(strand.a) * (REACH + (i + 1) * 0.05) * scale
        );
        g.add(stemTo(leaf.position.clone(), next, 0.012 * scale, F.dark));
      }
    }
  }
  return g;
}

/**
 * The upright-leaved plant the office had before it had any others: a pot of tall
 * paddle leaves. Restored as a species because it is the one that reads best at
 * size and from a distance, so it is what stands on the open edges of the room
 * where the season has to carry across the whole scene.
 */
export function buildLeafyBush(scale = 1, opts = {}) {
  const g = group(0, 0, 0);
  const F = greens(opts.seasonal);
  const potH = addPot(g, { r: 0.4 * scale, h: 0.7 * scale });
  // Every blade is jittered off its nominal height and size. The plant this
  // restores had them on three exact heights, which left pairs of leaves sharing a
  // face — invisible while they are the same green, but it is the flicker the
  // probe is there to catch, so it is not worth handing back.
  const rnd = seeded(0x5b1);

  const LEAVES = 8;
  for (let i = 0; i < LEAVES; i++) {
    const a = (i / LEAVES) * Math.PI * 2;
    // Tall, narrow blades, each at its own height so the crown is not a dome.
    const leaf = leafBlob((0.5 + rnd() * 0.06) * scale, i % 2 ? F.leaf : F.dark,
      { spread: 0.7, lift: 1.4, thin: 0.4 });
    leaf.position.set(
      Math.cos(a) * (0.34 + rnd() * 0.05) * scale,
      potH + (0.4 + (i % 3) * 0.35 + rnd() * 0.09) * scale,
      Math.sin(a) * (0.34 + rnd() * 0.05) * scale
    );
    leaf.rotation.y = a;
    g.add(leaf);
  }
  // A few paler leaves through the middle, for depth at the size these are used.
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.5;
    const leaf = leafBlob((0.36 + rnd() * 0.05) * scale, F.light,
      { spread: 0.7, lift: 1.2, thin: 0.4 });
    leaf.position.set(
      Math.cos(a) * 0.16 * scale,
      potH + (0.75 + i * 0.3 + rnd() * 0.08) * scale,
      Math.sin(a) * 0.16 * scale
    );
    leaf.rotation.y = a;
    g.add(leaf);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Desk plants.
//
// Sized to match the fern on the side table by the couch — the size that reads at
// a glance across the room — and no larger: the screens start half a unit above
// the desk top, and a desk plant that reaches them is a desk plant in the way of
// the work. Each species is scaled individually so the three come out the same
// height as each other, since their geometry is not the same shape.

/**
 * Cacti: three squat barrels of different heights in one pot, one of them in
 * flower. A cluster rather than a single stem with arms, because at desk size a
 * tall body with arms on it turned into a beer bottle every time the arms lined
 * up with the camera — and the camera orbits.
 */
export function buildCactus(scale = 1) {
  const g = group(0, 0, 0);
  const potH = addPot(g, { r: 0.17 * scale, h: 0.14 * scale, color: 'terracotta', rim: false });

  const barrels = [
    { a: 0.4, out: 0.07, r: 0.085, h: 0.16, flower: true },
    { a: 2.6, out: 0.08, r: 0.07, h: 0.11, flower: false },
    { a: 4.6, out: 0.06, r: 0.055, h: 0.07, flower: false },
  ];
  for (const b of barrels) {
    const x = Math.cos(b.a) * b.out * scale;
    const z = Math.sin(b.a) * b.out * scale;
    const h = b.h * scale;
    const body = cyl(b.r * 0.92 * scale, b.r * scale, h, 'cactusGreen',
      { segments: 8, rough: 0.85 });
    body.position.set(x, potH + h / 2 - 0.02, z);
    g.add(body);
    // A dome on top, so the barrel is not a cut-off tube.
    const cap = sphere(b.r * 0.9 * scale, 'cactusDark', { segments: 8, rough: 0.85 });
    cap.scale.y = 0.55;
    cap.position.set(x, potH + h - 0.03, z);
    g.add(cap);
    if (b.flower) {
      put(g, sphere(0.028 * scale, 'bloomCool', { segments: 7, rough: 0.7 }), x, potH + h + 0.025 * scale, z);
    }
  }
  return g;
}

/** A succulent rosette in a shallow bowl of grit. The lowest of the desk plants. */
export function buildSucculent(scale = 1, opts = {}) {
  const g = group(0, 0, 0);
  const F = greens(opts.seasonal);
  const bowlH = 0.11 * scale;
  put(g, cyl(0.2 * scale, 0.15 * scale, bowlH, 'paper', { segments: 14, rough: 0.7 }), 0, bowlH / 2);
  put(g, cyl(0.185 * scale, 0.185 * scale, 0.05, 0x8d8577, { segments: 14, cast: false }), 0, bowlH - 0.035);

  // Two tiers of fat leaves, the upper one turned between the lower.
  for (const [tier, count, r, y] of [[0, 7, 0.13, 0.05], [1, 5, 0.085, 0.11]]) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + tier * 0.45;
      const leaf = leafBlob(r * scale, tier ? F.light : F.leaf,
        { spread: 0.9, lift: 0.55, thin: 0.7 });
      leaf.position.set(
        Math.cos(a) * r * 0.75 * scale,
        bowlH + y * scale,
        Math.sin(a) * r * 0.75 * scale
      );
      leaf.rotation.set(0.75 - tier * 0.3, -a, 0);
      g.add(leaf);
    }
  }
  return g;
}

/** A little flowering pot — the African violet somebody was given and kept. */
export function buildDeskBloom(scale = 1, opts = {}) {
  const g = group(0, 0, 0);
  const F = greens(opts.seasonal);
  const potH = addPot(g, { r: 0.17 * scale, h: 0.15 * scale, color: 'couch', rim: false });

  // A wide, flat cushion of leaves, each one a slightly different size and height
  // so none of them share a face. Wide is the whole trick: built tall, with the
  // flowers stacked on stems above it, this came out looking like a bottle left on
  // the desk rather than a plant grown on it.
  const rnd = seeded(0x9e2);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = leafBlob((0.125 + rnd() * 0.02) * scale, i % 2 ? F.leaf : F.dark,
      { spread: 1.4, lift: 0.3, thin: 1.0 });
    leaf.position.set(
      Math.cos(a) * 0.11 * scale,
      potH + (0.01 + rnd() * 0.03) * scale,
      Math.sin(a) * 0.11 * scale
    );
    leaf.rotation.set(0.85, -a, 0);
    g.add(leaf);
  }

  // Flower heads sitting in among the leaves, not over them.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.6;
    const out = (0.05 + (i % 2) * 0.05) * scale;
    put(g, sphere(0.035 * scale, i % 2 ? 'bloomCool' : 'bloomWarm', { segments: 7, rough: 0.75 }), Math.cos(a) * out, potH + (0.05 + (i % 2) * 0.015) * scale, Math.sin(a) * out);
  }
  return g;
}

// ---------------------------------------------------------------------------
// The seasonal window troughs.

/**
 * A planted trough on the inside of a window, with the sill board it stands on.
 *
 * Built along local x, with the wall behind it at -z: the caller positions it at
 * the window's sill height and turns it to the wall. This is the only planting in
 * the office that changes with the month — see the note at the top of the file.
 *
 * @param {object} opts
 * @param {number} opts.width  length of the trough along the window
 * @param {string} opts.season key into SILL_SEASONS
 */
export function buildWindowTrough({ width = 2.4, season = 'summer' } = {}) {
  const spec = SILL_SEASONS[season] ?? SILL_SEASONS.summer;
  const g = group(0, 0, 0);
  const rnd = seeded(0x3a7 + Math.round(width * 31));

  // The sill board, running past the trough at both ends and standing a little
  // proud of the frame below it. Sunk a whisker so its underside never shares a
  // plane with the window frame's bottom rail.
  const BOARD_H = 0.1;
  put(g, box(width + 0.7, BOARD_H, 0.46, 'woodMid', { rough: 0.8 }), 0, BOARD_H / 2 - 0.02, 0.13);

  // The trough: a plain zinc-lined box with a lip, sat on the board.
  const TROUGH_H = 0.24;
  const troughY = BOARD_H + TROUGH_H / 2 - 0.02;
  put(g, box(width, TROUGH_H, 0.3, 'pot', { rough: 0.8 }), 0, troughY, 0.14);
  put(g, box(width + 0.06, 0.05, 0.34, 'terracotta', { rough: 0.75 }), 0, BOARD_H + TROUGH_H - 0.035, 0.14);

  const soilY = BOARD_H + TROUGH_H - 0.06;
  put(g, box(width - 0.08, 0.06, 0.24, 'soil', { cast: false }), 0, soilY, 0.14);

  // Planting along the trough. `foliage` thins the row out for the seasons that
  // have been cut back, rather than swapping in a second row of geometry.
  const slots = Math.max(3, Math.round(width / 0.42));
  const planted = Math.max(2, Math.round(slots * spec.foliage));
  for (let i = 0; i < planted; i++) {
    const x = -width / 2 + (width / (planted + 1)) * (i + 1);
    const r = 0.15 + rnd() * 0.08;
    const mound = leafBlob(r, i % 2 ? spec.mound : spec.moundAlt,
      { spread: 1.25, lift: 0.85, thin: 1.2 });
    mound.position.set(x, soilY + r * 0.55, 0.14 + (rnd() - 0.5) * 0.06);
    mound.rotation.y = rnd() * Math.PI;
    g.add(mound);
  }

  // Flower heads over the foliage.
  for (let i = 0; i < spec.blooms; i++) {
    const x = -width / 2 + 0.2 + rnd() * (width - 0.4);
    const head = sphere(0.05 + rnd() * 0.02, i % 2 ? spec.bloom : spec.bloomAlt,
      { segments: 7, rough: 0.75 });
    head.position.set(x, soilY + 0.22 + rnd() * 0.14, 0.1 + rnd() * 0.1);
    g.add(head);
  }

  // Berries: autumn's hips, and the only colour winter gets.
  for (let i = 0; i < spec.berries; i++) {
    const x = -width / 2 + 0.25 + rnd() * (width - 0.5);
    const cluster = group(x, soilY + 0.2 + rnd() * 0.12, 0.1 + rnd() * 0.1);
    for (let j = 0; j < 3; j++) {
      put(cluster, sphere(0.035, BERRY, { segments: 6, rough: 0.5 }), (j - 1) * 0.05, (j % 2) * 0.045, (j % 2) * 0.04);
    }
    g.add(cluster);
  }

  // Bare stems standing above the planting: sparse in autumn, the whole story in
  // winter. Leaned every which way, because pruned wood does not stand plumb.
  for (let i = 0; i < spec.twigs; i++) {
    const x = -width / 2 + 0.18 + (i / Math.max(1, spec.twigs - 1)) * (width - 0.36);
    const h = 0.34 + rnd() * 0.3;
    const twig = cyl(0.022, 0.032, h, 'branchBare', { segments: 5 });
    twig.position.set(x, soilY + h / 2, 0.13 + (rnd() - 0.5) * 0.1);
    twig.rotation.z = (rnd() - 0.5) * 0.5;
    twig.rotation.x = (rnd() - 0.5) * 0.4;
    g.add(twig);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Lookup

const SPECIES = {
  fig: buildFig,
  bush: buildLeafyBush,
  monstera: buildMonstera,
  snake: buildSnakePlant,
  fern: buildFern,
  pothos: buildPothos,
  cactus: buildCactus,
  succulent: buildSucculent,
  bloom: buildDeskBloom,
};

/**
 * Build a plant by species name, so placements can live as data in config.js.
 * An unknown name falls back to the fig rather than leaving a hole in the room.
 */
export function buildPlantKind(kind, scale = 1, opts = {}) {
  return (SPECIES[kind] ?? buildFig)(scale, opts);
}

// One species per desk, cycled so no two neighbours match. Cacti and succulents
// dominate because they are what survives on a desk somebody only visits when
// there is work on. The scales even the three out at around 0.55 tall, against the
// side table's fern at 0.72 — the succulent is deliberately short of the others,
// because matching a flat rosette to their height makes it a salad bowl.
const DESK_SPECIES = [
  { kind: 'cactus', scale: 1.7 },
  { kind: 'succulent', scale: 1.75 },
  { kind: 'bloom', scale: 1.65 },
];

/** The desk plant for desk `index`. Deterministic: desk 3 always has the violet. */
export function buildDeskPlant(index = 0) {
  const spec = DESK_SPECIES[index % DESK_SPECIES.length];
  return buildPlantKind(spec.kind, spec.scale);
}
