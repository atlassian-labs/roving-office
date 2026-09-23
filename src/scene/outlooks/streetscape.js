// The shared street kit: the pavement level, and the pieces more than one outlook plants — trees, bushes,
// benches, lamps, cars — plus the colour helpers (mixHex, hazed) and the
// seeded RNG that keeps a rebuilt scene from reshuffling itself.
//
// Split from exterior.js with the outlooks; this is the half they all share.

import * as THREE from 'three';
import { COLORS } from '../../config.js';
import { pick, spread } from '../../dice.js';
import { markNightLight, streetLampLighting } from '../night-lights.js';
import { box, cyl, group, mat, put } from '../build.js';

// Sidewalk surface (a step up from the road). Exported because anything that has
// to *reach* the pavement — notably the external staircase — needs the real number:
// assuming the street sits at the storey line leaves the stair floating.
export const WALK_Y = -1.12;

// A big base plane so there's never a visible void under the scene.

/**
 * A park tree: trunk plus a stack of faceted canopy blobs, dressed for the season.
 *
 * Exported for reception's vignette (scene/vignette.js), which plants a handful of
 * these beyond its one window. Same tree as the park across the road, so the view
 * out of reception's glass is the view out of the office's.
 */
export function buildTree(x, z, y = WALK_Y, scale = 1, mode = 'summer') {
  const g = group(x, y, z);
  g.scale.setScalar(scale);
  
  if (mode === 'winter') {
    // Deciduous tree in winter: bare branches, grown rather than placed.
    //
    // They used to be six small spheres sitting above the trunk, touching nothing.
    // Across a road that read as a sparse canopy, which is all it was ever asked to
    // do — but a leafy tree hides its structure and a bare one *is* its structure,
    // so the moment anything looked closely the blobs were blobs. What looked
    // closely was its own portrait in docs/user/the-kit.md.
    //
    // So: limbs that leave the trunk somewhere, point somewhere, and fork. Thirteen
    // meshes against the old seven, which is worth watching — a park plants
    // thirty-four of these and a street another fourteen — so it is four bold limbs
    // rather than a spray of twigs. Bold is also what survives the distance.
    // Tall enough to be the same tree as the summer one: that canopy tops out
    // around y = 7, and a trunk that stopped at 3 made winter a different species.
    const trunkH = 4.0;
    put(g, cyl(0.11, 0.3, trunkH, COLORS.branchBare, { segments: 7 }), 0, trunkH / 2);

    /**
     * One branch, jointed to whatever it grows out of.
     *
     * Nested rather than absolute: a limb's joint carries its own frame, so a twig
     * hung off it at `along` gets its parent's direction for free and only has to
     * say how far it turns away from it. That is what keeps a fork looking like a
     * fork — the alternative is trigonometry per twig, and six spheres.
     *
     * @param {number} along   how far up the parent to leave it, in parent units
     * @param {number} bearing which way to swing, about the parent's own axis
     * @param {number} tilt    how far off the parent's line, in radians
     * @param {number} len     length
     * @param {number} rBase   thickness where it joins
     * @param {number} rTip    thickness at the end
     * @returns {THREE.Group} the joint, to add to the parent — and to hang the next off
     */
    const branch = (along, bearing, tilt, len, rBase, rTip) => {
      const joint = group(0, along, 0);
      joint.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(
          Math.sin(bearing) * Math.sin(tilt),
          Math.cos(tilt),
          Math.cos(bearing) * Math.sin(tilt),
        ).normalize(),
      );
      const shaft = cyl(rTip, rBase, len, COLORS.branchBare, { segments: 5 });
      shaft.position.y = len / 2;
      shaft.castShadow = true;
      joint.add(shaft);
      return joint;
    };

    // Bearing, how far up the trunk, tilt from vertical, length. Fixed rather than
    // random: with this few parts one bad roll is a broken-looking tree, and the
    // planting already varies every one of them by scale.
    const limbs = [
      [0.6, 2.35, 0.72, 1.9],
      [2.7, 2.95, 0.6, 1.7],
      [4.6, 2.6, 0.62, 1.8],
      // The leader. It leaves below the trunk's own top and no thicker than the
      // trunk is there, so it reads as the trunk carrying on rather than a graft.
      [3.5, 3.4, 0.16, 2.4],
    ];
    // Every tree carries the same skeleton, and a park plants thirty-four of them,
    // so each one is spun on the spot. With leaves on, a repeated arrangement is
    // invisible; with the structure showing, a row of identical trees is a wallpaper.
    g.rotation.y = Math.random() * Math.PI * 2;

    for (const [bearing, along, tilt, len] of limbs) {
      const limb = branch(along, bearing, tilt, len, tilt < 0.3 ? 0.13 : 0.1, 0.05);
      // Forked near the end, one twig carrying the line on and one breaking away.
      limb.add(branch(len * 0.7, 1.1, 0.46, len * 0.6, 0.05, 0.018));
      limb.add(branch(len * 0.93, -0.9, 0.28, len * 0.5, 0.045, 0.014));
      g.add(limb);
    }
  } else if (mode === 'autumn') {
    // Autumn: mixed turning foliage with varying colors and density.
    put(g, cyl(0.26, 0.34, 3.0, 0x7a5233, { segments: 7 }), 0, 1.5);
    
    // Autumn palette varies by tree and blob within tree for mixed canopy read.
    const autumnPalettes = [
      [COLORS.autumnLeaf, COLORS.autumnLeafAlt, COLORS.autumnLeafDeep],
      [COLORS.autumnLeafAlt, COLORS.autumnLeaf, COLORS.autumnLeafDeep],
      [COLORS.autumnLeafDeep, COLORS.autumnLeaf, COLORS.autumnLeafAlt],
    ];
    const treePalette = pick(autumnPalettes);
    
    // Vary blob count and sparsity: some trees are sparser with visible branches.
    const blobCount = Math.random() > 0.4 ? 4 : 3;
    for (let i = 0; i < blobCount; i++) {
      const r = 1.9 - i * 0.28;
      const color = treePalette[i % treePalette.length];
      const blob = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 0),
        mat(color, { flat: true, rough: 0.95 })
      );
      blob.position.set(
        Math.cos(i * 2.1) * 0.7,
        3.4 + i * 0.85,
        Math.sin(i * 2.1) * 0.7
      );
      blob.castShadow = true;
      g.add(blob);
    }
    
    // Some sparse branches showing through.
    if (Math.random() > 0.6) {
      const visibleBranch = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 4, 4),
        mat(COLORS.branchBare, { flat: true, rough: 0.9 })
      );
      visibleBranch.position.set(0.4, 3.2, -0.3);
      g.add(visibleBranch);
    }
  } else {
    // Summer: leafy deciduous tree.
    put(g, cyl(0.26, 0.34, 3.0, 0x7a5233, { segments: 7 }), 0, 1.5);
    // The third tone stops the canopy reading as one flat colour. In spring that
    // has to be a paler blossom, not the summer green.
    const colors = mode === 'spring'
      ? [COLORS.leaf, COLORS.leafDark, 0xfadce7]
      : [COLORS.leaf, COLORS.leafDark, 0x7fa86b];
    for (let i = 0; i < 4; i++) {
      const r = 1.9 - i * 0.28;
      const blob = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 0),
        mat(colors[i % colors.length], { flat: true, rough: 0.95 })
      );
      blob.position.set(
        Math.cos(i * 2.1) * 0.7,
        3.4 + i * 0.85,
        Math.sin(i * 2.1) * 0.7
      );
      blob.castShadow = true;
      g.add(blob);
    }
  }
  return g;
}

// Exported alongside buildTree(), and for the same reason.
export function buildBush(x, z, y, mode = 'summer') {
  const g = group(x, y, z);
  
  if (mode === 'winter') {
    // Winter evergreen bush: conical shape with snow cap.
    for (let i = 0; i < 3; i++) {
      const bush = new THREE.Mesh(
        new THREE.IcosahedronGeometry(spread(0.65, 0.25), 0),
        mat(i % 2 ? COLORS.evergreenDark : COLORS.evergreen, { flat: true, rough: 0.95 })
      );
      bush.position.set((i - 1) * 0.7, 0.45, (i % 2) * 0.4);
      bush.castShadow = true;
      g.add(bush);
      
      // Snow cap on top of each bush blob.
      const snowCap = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.3, 0),
        mat(COLORS.snow, { flat: true, rough: 1.0 })
      );
      snowCap.position.set((i - 1) * 0.7, 1.15, (i % 2) * 0.4);
      g.add(snowCap);
    }
  } else if (mode === 'autumn') {
    // Autumn: bushes turn too with autumn palette.
    const autumnColors = [COLORS.autumnLeaf, COLORS.autumnLeafAlt, COLORS.autumnLeafDeep];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(
        new THREE.IcosahedronGeometry(spread(0.75, 0.35), 0),
        mat(autumnColors[i % autumnColors.length], { flat: true, rough: 0.95 })
      );
      b.position.set((i - 1) * 0.7, 0.55, (i % 2) * 0.5);
      b.castShadow = true;
      g.add(b);
    }
  } else {
    // Summer: deciduous bush.
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(
        new THREE.IcosahedronGeometry(spread(0.75, 0.35), 0),
        mat(i % 2 ? COLORS.leafDark : COLORS.leaf, { flat: true, rough: 0.95 })
      );
      b.position.set((i - 1) * 0.7, 0.55, (i % 2) * 0.5);
      b.castShadow = true;
      g.add(b);
    }
  }
  return g;
}

export function buildBench(x, z, y, rotationY = 0, mode = 'summer') {
  const g = group(x, y, z);
  g.rotation.y = rotationY;
  const seat = box(3.0, 0.14, 0.9, 0x8a5a38, { rough: 0.85 });
  seat.position.y = 0.75; g.add(seat);
  const back = box(3.0, 0.8, 0.14, 0x8a5a38, { rough: 0.85 });
  back.position.set(0, 1.2, -0.42); g.add(back);
  for (const sx of [-1.25, 1.25]) {
    const leg = box(0.16, 0.75, 0.8, COLORS.metalDark, { metal: 0.4 });
    leg.position.set(sx, 0.38, 0); g.add(leg);
  }
  
  // In winter, add snow caps on the seat and back.
  if (mode === 'winter') {
    put(g, box(3.2, 0.12, 1.0, COLORS.snow, { rough: 1.0, cast: false }), 0, 0.88);
    
    put(g, box(3.2, 0.16, 0.2, COLORS.snow, { rough: 1.0, cast: false }), 0, 1.42, -0.32);
  }
  
  return g;
}

// Depth cue: fade a colour toward the sky haze. Blending the material colour is
// both cheaper and cleaner than wrapping each tower in a translucent shell, which
// z-fights against the facade detail it is meant to soften.
export function mixHex(from, to, amount) {
  const a = Math.max(0, Math.min(1, amount));
  const channel = (shift) => {
    const near = (from >> shift) & 0xff;
    const far = (to >> shift) & 0xff;
    return Math.round(near * (1 - a) + far * a) & 0xff;
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function hazed(hex, amount) {
  return mixHex(hex, COLORS.haze, amount);
}

// Small deterministic generator, so the planting is the same every rebuild. Trees
// that jump to new positions each time the season changes read as a glitch of its
// own, and Math.random() would do exactly that.
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A street lamp. Its arm overhangs the road, so which way it faces matters:
 * `rotationY` turns the whole fitting, carrying the arm, head and its pool of
 * light round together. Without it every lamp reaches out along +x and half of
 * them light the pavement behind them instead of the tarmac in front.
 */
export function buildStreetLamp(x, z, y, scale = 1, mode = 'summer', rotationY = 0) {
  const g = group(x, y, z);
  g.scale.setScalar(scale);
  g.rotation.y = rotationY;
  const base = cyl(0.24, 0.3, 0.35, COLORS.metalDark, { segments: 10 });
  base.position.y = 0.17; g.add(base);
  const pole = cyl(0.11, 0.13, 5.4, 0x3a4048, { segments: 8 });
  pole.position.y = 2.7; g.add(pole);
  const arm = box(1.1, 0.12, 0.12, 0x3a4048);
  arm.position.set(0.5, 5.35, 0); g.add(arm);
  // A material of its own per lamp, not a cached one: nightfall drives each
  // head's glow, and a shared material would light every lamp in the scene at once
  // (including any that a theme wants left dark).
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff2d2, emissive: 0xffe6bd, emissiveIntensity: 0, roughness: 0.5,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), headMaterial);
  head.position.set(1.0, 5.25, 0); g.add(head);

  // After dark this lamp lights the tarmac under it. Starts off — applyNightLights
  // brings it up as the sun drops.
  // The pool clears the kerbstone, which now stands proud of the pavement: laid
  // any lower, the opaque kerb would have taken a bite out of the glow as it
  // spilled over the edge onto the road.
  const lighting = streetLampLighting(1.0, 0.06, headMaterial);
  g.add(lighting.pool);
  markNightLight(g, lighting);

  
  // In winter, add a snow cap on the lamp head.
  if (mode === 'winter') {
    put(g, box(0.7, 0.15, 0.7, COLORS.snow, { rough: 1.0, cast: false }), 1.0, 5.65, 0);
  }
  
  return g;
}

export function buildCar(x, z, color, rotationY = 0, mode = 'summer') {
  const g = group(x, WALK_Y - 0.16, z);
  g.rotation.y = rotationY;

  // Kept as named spans rather than inline numbers, because everything stacked on
  // this car — glazing, snow — has to be positioned from the surface it rests on.
  const BODY_H = 0.75;
  const BODY_TOP = 0.75 + BODY_H / 2;      // 1.125
  const CABIN_W = 2.3, CABIN_D = 1.72, CABIN_H = 0.62;
  const CABIN_X = -0.15;
  const CABIN_TOP = 1.4 + CABIN_H / 2;     // 1.71

  const body = box(4.2, BODY_H, 1.9, color, { rough: 0.45, metal: 0.25 });
  body.position.y = 0.75; g.add(body);
  const cabin = box(CABIN_W, CABIN_H, CABIN_D, 0x2c3238, { rough: 0.3, metal: 0.2 });
  cabin.position.set(CABIN_X, 1.4, 0); g.add(cabin);
  // Glazing band, standing clearly proud of the cabin so it reads as glass set in
  // a frame. It used to clear the cabin by a single hundredth, which left the
  // band's own top and bottom faces exposed as hairline slivers running right
  // round the roof — two silhouette edges that close together shimmer against
  // each other however good the depth buffer is.
  const GLASS_PROUD = 0.03;
  const glassSide = box(
    CABIN_W + GLASS_PROUD * 2, 0.30, CABIN_D + GLASS_PROUD * 2,
    0x8fb6c9, { rough: 0.15, cast: false },
  );
  glassSide.position.set(CABIN_X, 1.44, 0); g.add(glassSide);

  for (const sx of [-1.35, 1.35]) {
    for (const sz of [-0.98, 0.98]) {
      const wheel = cyl(0.42, 0.42, 0.3, 0x1b1e22, { segments: 12 });
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(sx, 0.42, sz);
      g.add(wheel);
    }
  }
  // Head/tail lights
  const hl = box(0.1, 0.18, 0.4, 0xfff0cf, { emissive: 0xffe6bd, emissiveIntensity: 0.5, cast: false });
  hl.position.set(2.1, 0.8, 0.55); g.add(hl);
  const tl = box(0.1, 0.18, 0.4, 0xc0392b, { emissive: 0x992d22, emissiveIntensity: 0.4, cast: false });
  tl.position.set(-2.1, 0.8, 0.55); g.add(tl);

  // In winter, snow settles on the car — but on the surfaces it would actually
  // settle on, and bedded into each one.
  //
  // A single slab spanning the whole car did neither: its top face sat at exactly
  // the cabin roof height, so roof and snow fought for the same plane and flashed,
  // and over the bonnet and boot the same slab hung in mid air half a unit above
  // the bodywork it was meant to be lying on.
  //
  // Each cap here is inset from the panel beneath it and sunk slightly into it, so
  // no face is shared and no underside is left showing.
  if (mode === 'winter') {
    const snowCap = (w, d, x, surfaceY, h) => {
      const cap = box(w, h, d, COLORS.snow, { rough: 1.0, cast: false });
      cap.position.set(x, surfaceY - 0.03 + h / 2, 0);
      return cap;
    };

    // On the cabin roof, inset so its hidden underside stays inside the cabin.
    g.add(snowCap(CABIN_W - 0.1, CABIN_D - 0.1, CABIN_X, CABIN_TOP, 0.16));

    // On the bonnet and boot, the two flat panels either side of the cabin.
    const cabinFront = CABIN_X + CABIN_W / 2;
    const cabinRear = CABIN_X - CABIN_W / 2;
    const NOSE = 2.1 - 0.04;   // just shy of the body ends
    for (const [from, to] of [[cabinFront + 0.02, NOSE], [-NOSE, cabinRear - 0.02]]) {
      g.add(snowCap(to - from, 1.78, (from + to) / 2, BODY_TOP, 0.1));
    }
  }

  return g;
}
