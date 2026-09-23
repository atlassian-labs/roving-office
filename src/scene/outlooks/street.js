// The street outlook: the corner the brownstone and its siblings stand on —
// sidewalks, roads, crosswalks, the park across the way, a low-fi backdrop
// skyline, street furniture, and the warehouse's service yard.

import * as THREE from 'three';
import { COLORS, ROOM, STREET_Y } from '../../config.js';
import { chance, spread } from '../../dice.js';
import { markLitWindow } from '../night-lights.js';
import { box, cyl, group, mat, put } from '../build.js';
// Imported rather than duplicated: the yard markings have to line up with the
// loading doors, and two independent copies of these numbers would drift.
import { loadingBayFractions, loadingBayWidth } from '../building.js';
import { buildAlderStreet } from './alder.js';
import { GARDEN_DISTRICTS } from './garden-districts.js';
import {
  WALK_Y, buildTree, buildBush, buildBench, buildStreetLamp, buildCar,
} from './streetscape.js';

// Band boundaries measured outward from each wall.
const WALK_NEAR = 3.6;      // sidewalk depth against the building
const ROAD_W = 8.0;         // road width
const WALK_FAR = 3.4;       // sidewalk depth on the far side

// Warehouse service yard.
const YARD_DEPTH = 9.0;      // apron depth out from the loading elevation
const LANE_W = 5.0;          // driveway width
const YARD_BAY_FRACS = loadingBayFractions();
const YARD_BAY_W = loadingBayWidth(ROOM.W, ROOM.D);

const ROAD_START = WALK_NEAR;                 // 3.6
const ROAD_END = WALK_NEAR + ROAD_W;          // 11.6
const FAR_WALK_END = ROAD_END + WALK_FAR;     // 15.0

// Raised sidewalk slabs wrapping the two walled sides, plus the far sides.
function buildSidewalks(mode = 'summer') {
  const g = group(0, 0, 0);
  const H = 0.18;
  const slabColor = mode === 'winter' ? COLORS.snow : COLORS.sidewalk;
  const curbColor = mode === 'winter' ? COLORS.snowShade : COLORS.curb;
  
  const slab = (x, z, w, d) => {
    const s = box(w, H, d, slabColor, { rough: 1.0, cast: false });
    s.position.set(x, WALK_Y - H / 2, z);
    s.receiveShadow = true;
    return s;
  };
  // The kerbstone stands a little proud of the slab it edges, rather than
  // finishing flush with it. Flush meant its top face and the pavement's top face
  // occupied exactly the same plane along every kerb line, and two coplanar faces
  // have no depth order: the pair flickered against each other as the camera
  // moved. A real kerb stands up from the pavement anyway, so the fix that
  // separates them is also the one that looks right.
  const CURB_PROUD = 0.04;
  // The kerb also overhangs the gutter by a hair. The kerb line was where *three*
  // surfaces arrived on exactly the same plane: the pavement slab's edge face, the
  // road slab's edge face and the kerbstone's own road-facing face all sat at the
  // boundary coordinate, and all three overlapped in height. Coplanar faces have no
  // depth order, so the whole kerb line flickered — worst on the far side of each
  // street, which is the one face of the four the camera looks straight at.
  //
  // Nudging the kerb out over the tarmac makes it the only thing on that plane and
  // puts the other two behind it, where they are hidden by the kerb itself.
  const CURB_OVERHANG = 0.02;
  // `rx`/`rz` point from the pavement toward the road; exactly one is non-zero.
  const curbEdge = (x, z, w, d, rx = 0, rz = 0) => {
    const h = 0.26;
    const c = box(w + Math.abs(rx) * CURB_OVERHANG, h, d + Math.abs(rz) * CURB_OVERHANG,
      curbColor, { rough: 1.0, cast: false });
    c.position.set(x + rx * CURB_OVERHANG / 2, WALK_Y + CURB_PROUD - h / 2,
      z + rz * CURB_OVERHANG / 2);
    return c;
  };

  // The pavements are laid as two L-shapes, one per pair of blocks, rather than as
  // four strips that each run the full length of the scene.
  //
  // Run full-length, every strip crossed the one at right angles to it, so each
  // corner had two slabs of identical height stacked on the same square — top faces
  // on one plane, bottom faces on another, and no way for the depth buffer to order
  // either. Four such squares, and the largest is thirteen units across. That is
  // what was breaking up on the far side of each street.
  //
  // Running full-length also carried a raised pavement straight over both roadways,
  // which is why the fix is a trim rather than a nudge: each block now owns its own
  // corner and the arms abut instead of crossing.
  const xTo = ROOM.W / 2 + 4 + (ROOM.W + 40) / 2;
  const zTo = ROOM.D / 2 + 4 + (ROOM.D + 40) / 2;
  const slabBetween = (x0, x1, z0, z1) =>
    slab((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0);
  // A kerb line at the pavement boundary `z` (or `x`), spanning the other axis.
  // `rz`/`rx` point from the pavement toward the road, as curbEdge expects.
  const curbAlongX = (z, x0, x1, rz) =>
    curbEdge((x0 + x1) / 2, z - rz * 0.13, x1 - x0, 0.26, 0, rz);
  const curbAlongZ = (x, z0, z1, rx) =>
    curbEdge(x - rx * 0.13, (z0 + z1) / 2, 0.26, z1 - z0, rx, 0);

  // Near block: the building's own pavement, wrapping the corner by the back wall
  // and up the left side. The back arm owns the corner square, and the left arm
  // starts where the back arm's kerbstone finishes.
  g.add(slabBetween(-ROAD_START, xTo, -WALK_NEAR, 0));
  g.add(curbAlongX(-ROAD_START, -ROAD_START - CURB_OVERHANG, xTo, -1));
  g.add(slabBetween(-WALK_NEAR, 0, 0, zTo));
  g.add(curbAlongZ(-ROAD_START, -ROAD_START + 0.26, zTo, -1));

  // Far blocks, one street out: the same L turned about the intersection, in front
  // of the skyline along the back and the park along the left.
  g.add(slabBetween(-FAR_WALK_END, xTo, -FAR_WALK_END, -ROAD_END));
  g.add(curbAlongX(-ROAD_END, -FAR_WALK_END, xTo, 1));
  g.add(slabBetween(-FAR_WALK_END, -ROAD_END, -ROAD_END, zTo));
  g.add(curbAlongZ(-ROAD_END, -ROAD_END + CURB_OVERHANG, zTo, 1));

  // In winter, ploughed snow piles up in the gutter against the kerb.
  //
  // The bank is sized from the two surfaces it has to meet rather than from a
  // height above the pavement: it beds a hair into the tarmac and overlaps the
  // kerbstone it leans on. Sitting it exactly on the road left a coplanar pair
  // with the road surface, and stopping it exactly at the kerb line left another
  // against the kerb's outer face — and the version measured up from WALK_Y
  // floated a tenth of a unit clear of the road it was supposedly piled on.
  if (mode === 'winter') {
    const BANK_TOP = WALK_Y + 0.18;
    const BANK_BOTTOM = STREET_Y - 0.01;   // buried a little into the road
    const BANK_W = 0.8;                    // wide enough to bite into the kerb
    const snowBank = (x, z, w, d) => {
      const bank = box(w, BANK_TOP - BANK_BOTTOM, d, COLORS.snow, { rough: 1.0, cast: false });
      bank.position.set(x, (BANK_TOP + BANK_BOTTOM) / 2, z);
      return bank;
    };
    // Along the near kerbs the gutter lies outward of the kerb line; along the far
    // kerbs it lies inward, so the offset flips. The banks are trimmed to their own
    // block's frontage for the same reason the pavements are: run past each other
    // they met in a square at the corner, at one height, on one plane.
    const bankAlongX = (z, x0, x1) => snowBank((x0 + x1) / 2, z, x1 - x0, BANK_W);
    const bankAlongZ = (x, z0, z1) => snowBank(x, (z0 + z1) / 2, BANK_W, z1 - z0);
    const NEAR_GUTTER = -ROAD_START - BANK_W / 2 + 0.1;
    const FAR_GUTTER = -ROAD_END + BANK_W / 2 - 0.1;
    g.add(bankAlongX(NEAR_GUTTER, NEAR_GUTTER - BANK_W / 2, xTo));
    g.add(bankAlongZ(NEAR_GUTTER, NEAR_GUTTER + BANK_W / 2, zTo));
    g.add(bankAlongX(FAR_GUTTER, -FAR_WALK_END, xTo));
    g.add(bankAlongZ(FAR_GUTTER, FAR_GUTTER + BANK_W / 2, zTo));
  }

  return g;
}

// Road surfaces + centre lane markings for both streets.
function buildRoads(mode = 'summer') {
  const g = group(0, 0, 0);

  const road = (x, z, w, d) => {
    const roadColor = mode === 'winter' ? COLORS.snowShade : COLORS.road;
    const r = box(w, 0.06, d, roadColor, { rough: 1.0, cast: false });
    r.position.set(x, STREET_Y, z);
    r.receiveShadow = true;
    return r;
  };

  // Back street (runs along x) and left street (runs along z).
  //
  // The back street carries the intersection, and the left street is laid in two
  // pieces either side of it. Both used to run their full length, which paved the
  // eight-by-eight crossing square twice over: two slabs of tarmac at identical
  // height, top faces on one plane and bottoms on another. Sixty-four square units
  // of the roadway with nothing to separate the two surfaces.
  const zFrom = ROOM.D / 2 + 4 - (ROOM.D + 40) / 2;
  const zTo = ROOM.D / 2 + 4 + (ROOM.D + 40) / 2;
  const leftX = -(ROAD_START + ROAD_W / 2);
  g.add(road(ROOM.W / 2 + 4, -(ROAD_START + ROAD_W / 2), ROOM.W + 40, ROAD_W));
  g.add(road(leftX, (zFrom - ROAD_END) / 2, ROAD_W, -ROAD_END - zFrom));
  g.add(road(leftX, (-ROAD_START + zTo) / 2, ROAD_W, zTo + ROAD_START));

  // In winter, add dark tyre tracks for cleared slushy appearance.
  if (mode === 'winter') {
    // Bedded into the tarmac like the lane markings are, so only the track's top
    // face is exposed. Centred *on* the road surface, its lower half straddled
    // the tarmac and left barely five thousandths of clearance — enough to shimmer
    // on any device that hands out a shallow depth buffer.
    const tyre = (x, z, w, d) => {
      const t = box(w, 0.02, d, COLORS.road, { rough: 1.0, cast: false });
      t.position.set(x, STREET_Y + 0.04, z);
      return t;
    };
    // Tyre tracks on back street
    g.add(tyre(ROOM.W / 2 + 4, -(ROAD_START + ROAD_W / 2) - 1.2, ROOM.W + 40, 0.6));
    g.add(tyre(ROOM.W / 2 + 4, -(ROAD_START + ROAD_W / 2) + 1.2, ROOM.W + 40, 0.6));
    // Tyre tracks on left street
    g.add(tyre(-(ROAD_START + ROAD_W / 2) - 1.2, ROOM.D / 2 + 4, 0.6, ROOM.D + 40));
    g.add(tyre(-(ROAD_START + ROAD_W / 2) + 1.2, ROOM.D / 2 + 4, 0.6, ROOM.D + 40));
  }

  // Dashed centre lines. Snow covers them in winter; every other season has them.
  if (mode !== 'winter') {
    const midBack = -(ROAD_START + ROAD_W / 2);
    for (let x = -26; x < ROOM.W + 22; x += 4.2) {
      if (x > -ROAD_END - 2 && x < -ROAD_START + 2) continue; // intersection
      put(g, box(2.2, 0.02, 0.28, COLORS.roadLine, { cast: false }), x, STREET_Y + 0.04, midBack);
    }
    const midLeft = -(ROAD_START + ROAD_W / 2);
    for (let z = -22; z < ROOM.D + 22; z += 4.2) {
      if (z > -ROAD_END - 2 && z < -ROAD_START + 2) continue;
      put(g, box(0.28, 0.02, 2.2, COLORS.roadLine, { cast: false }), midLeft, STREET_Y + 0.04, z);
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
/**
 * Service yard for the warehouse: a concrete apron across the loading doors on
 * the long (+z) elevation, and a driveway running out to the left-hand street.
 *
 * The left street already extends well past the building on z, so the shortest
 * honest connection is straight out along -x. Vehicles reaching loading doors
 * with no road to arrive on is exactly the kind of detail that reads as wrong
 * without being able to say why.
 */
function buildServiceYard(mode = 'summer') {
  const g = group(0, 0, 0);

  const apronColor = mode === 'winter' ? COLORS.snowShade : COLORS.sidewalk;
  const laneColor = mode === 'winter' ? COLORS.snowShade : COLORS.road;

  // Apron in front of the loading doors, a touch above the ground plane.
  const apronZ = ROOM.D + YARD_DEPTH / 2;
  const APRON_H = 0.08;
  const apron = box(ROOM.W + 3, APRON_H, YARD_DEPTH, apronColor, { rough: 1.0, cast: false });
  apron.position.set(ROOM.W / 2, STREET_Y + 0.04, apronZ);
  apron.receiveShadow = true;
  g.add(apron);
  const APRON_TOP = STREET_Y + 0.04 + APRON_H / 2;

  // Driveway from the apron out to the near kerb of the left street, crossing the
  // sidewalk on a dropped kerb.
  //
  // It runs *under* the apron where the two meet, which is also why its surface
  // sits just below the concrete: matching the apron height exactly put the two
  // top faces in one plane across the whole overlap, and the pair flickered.
  const laneZ = ROOM.D + YARD_DEPTH * 0.45;
  const laneFromX = -ROAD_START - 0.4;
  const laneToX = 2.0;
  const LANE_H = 0.06;
  const LANE_TOP = APRON_TOP - 0.02;
  // Where the tarmac disappears beneath the concrete, so the markings know to stop.
  const apronEdgeX = ROOM.W / 2 - (ROOM.W + 3) / 2;
  const lane = box(laneToX - laneFromX, LANE_H, LANE_W, laneColor, { rough: 1.0, cast: false });
  lane.position.set((laneFromX + laneToX) / 2, LANE_TOP - LANE_H / 2, laneZ);
  lane.receiveShadow = true;
  g.add(lane);

  // Dropped kerb where the driveway crosses the sidewalk line.
  const drop = box(0.5, 0.2, LANE_W, mode === 'winter' ? COLORS.snowShade : COLORS.curb,
    { rough: 1.0, cast: false });
  drop.position.set(-ROAD_START + 0.13, STREET_Y + 0.1, laneZ);
  g.add(drop);

  if (mode !== 'winter') {
    // Painted bay markings in front of each loading door, plus a centre line down
    // the driveway. Snow would cover these.
    for (const frac of YARD_BAY_FRACS) {
      const bayX = ROOM.W / 2 + frac * ROOM.W;
      for (const dx of [-YARD_BAY_W / 2, YARD_BAY_W / 2]) {
        put(g, box(0.18, 0.02, YARD_DEPTH * 0.6, COLORS.roadLine, { cast: false }), bayX + dx, STREET_Y + 0.09, ROOM.D + YARD_DEPTH * 0.36);
      }
      // Stop line at the head of the bay.
      put(g, box(YARD_BAY_W, 0.02, 0.18, COLORS.roadLine, { cast: false }), bayX, STREET_Y + 0.09, ROOM.D + 0.7);
    }

    // Centre line down the driveway. It stops short of the apron edge: the run
    // used to carry on to the end of the lane, which put the last dashes on top of
    // the concrete — floating above a lane that had already ducked underneath it.
    const DASH_L = 0.7;
    for (let x = laneFromX + 0.55; x < apronEdgeX - DASH_L / 2 - 0.2; x += 1.1) {
      put(g, box(DASH_L, 0.02, 0.2, COLORS.roadLine, { cast: false }), x, LANE_TOP + 0.01, laneZ);
    }
  }

  return g;
}

// Zebra crossings on both streets, near the corner (like the inspo).
function buildCrosswalks(mode = 'summer') {
  const g = group(0, 0, 0);
  
  // Crosswalks fade or disappear in winter snow; only show in summer.
  if (mode === 'summer') {
    const stripe = (x, z, w, d) => {
      const s = box(w, 0.02, d, COLORS.roadLine, { cast: false });
      s.position.set(x, STREET_Y + 0.05, z);
      return s;
    };

    // Across the back street (stripes run along z, marching along x).
    for (let i = 0; i < 8; i++) {
      g.add(stripe(7.2 + i * 1.15, -(ROAD_START + ROAD_W / 2), 0.62, ROAD_W - 0.3));
    }
    // Across the left street (stripes run along x, marching along z).
    for (let i = 0; i < 8; i++) {
      g.add(stripe(-(ROAD_START + ROAD_W / 2), 6.0 + i * 1.15, ROAD_W - 0.3, 0.62));
    }
  }
  return g;
}

// ---------------------------------------------------------------------------
// The park (screen-left): grass, winding path, trees, bushes, benches, pond.
function buildPark(mode = 'summer') {
  const g = group(0, 0, 0);
  const parkX = -(FAR_WALK_END + 22);   // centre of the park slab
  const parkW = 44;
  const parkD = ROOM.D + 60;
  const parkCz = ROOM.D / 2 + 6;

  // Grass slab (or snow in winter).
  const groundColor = mode === 'winter' ? COLORS.snow : COLORS.grass;
  const grass = box(parkW, 0.22, parkD, groundColor, { rough: 1.0, cast: false });
  grass.position.set(parkX, WALK_Y - 0.03, parkCz);
  grass.receiveShadow = true;
  g.add(grass);

  // A lighter mown strip for visual interest (no mowing under snow, and autumn
  // grass has gone over).
  if (mode === 'summer' || mode === 'spring') {
    put(g, box(parkW * 0.55, 0.02, parkD * 0.7, 0x8cb576, { cast: false }), parkX + 4, WALK_Y + 0.09, parkCz);
  }

  // Path running through the park, parallel to the street.
  const pathColor = mode === 'winter' ? COLORS.snowShade : 0xcfc7b2;
  put(g, box(3.0, 0.04, parkD * 0.86, pathColor, { cast: false }), -(FAR_WALK_END + 5.5), WALK_Y + 0.1, parkCz);
  // A branch heading deeper into the park.
  put(g, box(18, 0.04, 2.4, pathColor, { cast: false }), parkX + 2, WALK_Y + 0.1, parkCz - 12);

  // A small pond (frozen/icy in winter, cooler in autumn).
  let pondColor = 0x6fa8bf;
  let pondRimColor = 0xb9b49f;
  if (mode === 'winter') {
    pondColor = 0xb8d5e8;
  } else if (mode === 'autumn') {
    // Cooler autumn water tone with hint of reflection.
    pondColor = 0x5a8fa6;
  }
  // The pond sits in its own shallow stack of heights, clear of the ground layers
  // it lies on. Both discs used to sit within a hundredth of the mown strip's top
  // face — the rim exactly on it — so the sandy edge flashed against the grass.
  const POND_RIM_Y = WALK_Y + 0.14;
  const POND_WATER_Y = POND_RIM_Y - 0.01;
  const POND_R = 5.0;
  // The water is drawn a touch wider than the rim's inner edge so it runs *under*
  // the sand rather than meeting it edge-to-edge. Two flat discs sharing a
  // silhouette at the same radius is the same coplanar problem in miniature.
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(POND_R + 0.08, 24),
    mat(pondColor, { rough: mode === 'winter' ? 0.15 : 0.25 })
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(parkX - 6, POND_WATER_Y, parkCz + 12);
  g.add(pond);
  // Sandy rim in summer; banked snow around a frozen pond in winter; leaf-tinged in autumn.
  if (mode === 'autumn') {
    pondRimColor = 0xa89070;  // more subdued, earthy
  } else if (mode === 'winter') {
    pondRimColor = COLORS.snowShade;
  }
  const pondRim = new THREE.Mesh(
    new THREE.RingGeometry(POND_R, POND_R + 0.7, 24),
    mat(pondRimColor, { rough: 1.0 })
  );
  pondRim.rotation.x = -Math.PI / 2;
  pondRim.position.set(parkX - 6, POND_RIM_Y, parkCz + 12);
  g.add(pondRim);
  
  // Leaves in autumn, blossom in spring: same scatter, different palette.
  if (mode === 'autumn' || mode === 'spring') {
    const floatingLeafSpots = [[0.5, 1.2], [-1.8, 0.3], [1.5, -1.0]];
    for (const [ox, oz] of floatingLeafSpots) {
      const leaf = box(0.35, 0.02, 0.25, COLORS.autumnLitter, { cast: false });
      leaf.rotation.z = Math.random() * Math.PI;
      // Floating *on* the water, so it tracks the water height rather than
      // carrying its own guess at it.
      leaf.position.set(parkX - 6 + ox, POND_WATER_Y + 0.02, parkCz + 12 + oz);
      g.add(leaf);
    }
  }

  // Trees: a denser cluster deeper in, a row along the path.
  const treeSpots = [
    [-(FAR_WALK_END + 2.5), 2], [-(FAR_WALK_END + 2.5), 10],
    [-(FAR_WALK_END + 2.5), 18], [-(FAR_WALK_END + 2.5), 26],
    [-(FAR_WALK_END + 2.5), -6],
    [parkX + 2, -8], [parkX - 8, -2], [parkX + 6, 6],
    [parkX - 12, 8], [parkX + 1, 22], [parkX - 14, 24],
    [parkX - 4, 30], [parkX + 8, 32], [parkX - 16, -10],
  ];
  for (const [x, z] of treeSpots) {
    g.add(buildTree(x, z, WALK_Y + 0.1, spread(0.9, 0.6), mode));
  }

  // Bushes / shrubs scattered around.
  const bushSpots = [
    [-(FAR_WALK_END + 8), 6], [-(FAR_WALK_END + 9), 14], [parkX - 2, 2],
    [parkX + 5, 16], [parkX - 10, 18], [parkX + 3, -4], [parkX - 6, 26],
  ];
  for (const [x, z] of bushSpots) g.add(buildBush(x, z, WALK_Y + 0.1, mode));

  // Park benches facing the path.
  g.add(buildBench(-(FAR_WALK_END + 8.6), 8, WALK_Y + 0.1, Math.PI / 2, mode));
  g.add(buildBench(-(FAR_WALK_END + 8.6), 20, WALK_Y + 0.1, Math.PI / 2, mode));

  // Park lamps.
  g.add(buildStreetLamp(-(FAR_WALK_END + 3.2), 6, WALK_Y + 0.1, 0.75, mode));
  g.add(buildStreetLamp(-(FAR_WALK_END + 3.2), 22, WALK_Y + 0.1, 0.75, mode));

  // Autumn leaf litter, or spring blossom drifted off the trees. `autumnLitter`
  // is repointed at petal pink by the spring palette, so the scatter is shared.
  if (mode === 'autumn' || mode === 'spring') {
    // Raked piles near benches and kerb — nobody rakes blossom.
    const litterPiles = mode === 'spring' ? [] : [
      [-(FAR_WALK_END + 8.6), 6, 1.2],    // pile near bench 1
      [-(FAR_WALK_END + 8.6), 20, 1.0],   // pile near bench 2
      [-(ROAD_END + 0.5), 8, 0.9],        // pile against kerb
    ];
    for (const [px, pz, pScale] of litterPiles) {
      put(g, box(2.0 * pScale, 0.08, 1.8 * pScale, COLORS.autumnLitter, { cast: false }), px, WALK_Y + 0.05, pz);
    }
    
    // Scattered leaves across grass and path.
    const litterSpots = [
      [parkX + 8, parkCz - 8], [parkX - 12, parkCz + 2], [parkX + 3, parkCz + 15],
      [-(FAR_WALK_END + 5), parkCz - 4], [parkX - 2, parkCz - 12],
      [-(FAR_WALK_END + 10), parkCz + 8], [parkX + 12, parkCz + 20],
    ];
    for (const [lx, lz] of litterSpots) {
      const litter = box(0.5, 0.03, 0.4, COLORS.autumnLitter, { cast: false });
      litter.rotation.z = Math.random() * Math.PI;
      litter.position.set(lx, WALK_Y + 0.04, lz);
      g.add(litter);
    }
    
    // Few leaves in the gutters (sidewalk edges).
    const gutterLeaves = [
      [ROOM.W / 2 + 6, -ROAD_START - 0.8],
      [-ROAD_START - 0.8, ROOM.D / 2 + 6],
      [ROOM.W / 2 + 12, -ROAD_END + 1.0],
    ];
    for (const [gx, gz] of gutterLeaves) {
      const gutterLeaf = box(0.4, 0.02, 0.3, COLORS.autumnLitter, { cast: false });
      gutterLeaf.rotation.z = Math.random() * Math.PI;
      // Lying on the tarmac, at the road's own height. Measured down from the
      // pavement instead, these hovered a clear gap above the gutter they name.
      gutterLeaf.position.set(gx, STREET_Y + 0.04, gz);
      g.add(gutterLeaf);
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
// Background skyline across the back street, weighted toward the top-right.
function buildSkyline() {
  const g = group(0, 0, 0);

  // [x, z, width, depth, height, color]
  const specs = [
    // Directly across the street, mid ground.
    [-6, -20, 12, 10, 13, COLORS.buildingC],
    [6, -21, 11, 11, 17, COLORS.buildingA],
    [17, -20, 10, 10, 12, COLORS.buildingB],
    [27, -21, 12, 11, 20, COLORS.buildingA],
    [38, -20, 10, 10, 15, COLORS.buildingC],

    // Top-right cluster: taller towers stepping back.
    [30, -34, 14, 13, 30, COLORS.buildingD],
    [44, -30, 12, 12, 26, COLORS.buildingB],
    [46, -46, 16, 14, 38, COLORS.buildingD],
    [30, -50, 13, 13, 33, COLORS.buildingB],
    [58, -36, 12, 12, 22, COLORS.buildingA],
    [16, -38, 11, 11, 24, COLORS.buildingC],

    // A little depth on the far left of the back street.
    [-18, -22, 11, 10, 11, COLORS.buildingB],
    [-30, -26, 12, 12, 16, COLORS.buildingC],
  ];

  for (const [x, z, w, d, h, c] of specs) {
    g.add(buildBuilding(x, z, w, d, h, c));
  }
  return g;
}

function buildBuilding(x, z, w, d, h, color) {
  const g = group(x, WALK_Y, z);

  // Planted *through* the ground rather than standing on the pavement line. These
  // masses sit well beyond the far pavement, so their base met nothing but the
  // ground plane at STREET_Y - 0.02 — and starting them at WALK_Y left every one
  // floating 0.2 clear of it, on a hairline of daylight that shimmered with shadow
  // acne along the whole row. Only the base moves: the top, the parapet cap and the
  // window rows are all still measured from the pavement line.
  const SINK = 0.6;
  const body = box(w, h + SINK, d, color, { rough: 0.95 });
  body.position.y = h / 2 - SINK / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Simple parapet cap.
  put(g, box(w + 0.5, 0.6, d + 0.5, 0x6b6f74, { rough: 0.9 }), 0, h + 0.3);

  // Window grid on the two faces the camera can see (+x and +z).
  const cols = Math.max(2, Math.floor(w / 2.6));
  const rows = Math.max(2, Math.floor(h / 3.2));
  const litChance = 0.35;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = chance(litChance);
      const wc = lit ? COLORS.windowLit : COLORS.windowDark;
      const opts = lit
        ? { emissive: COLORS.windowLit, emissiveIntensity: 0.7, rough: 0.5, cast: false }
        : { rough: 0.5, cast: false };

      const y = 2.2 + r * (h - 3.2) / Math.max(1, rows - 1 || 1);
      if (y > h - 1.2) continue;

      // +z face
      const wz = box(w / cols * 0.55, 1.3, 0.12, wc, opts);
      wz.position.set(-w / 2 + (c + 0.5) * (w / cols), y, d / 2 + 0.02);
      if (lit) markLitWindow(wz, 0.7);
      g.add(wz);

      // +x face
      const wx = box(0.12, 1.3, d / cols * 0.55, wc, opts);
      wx.position.set(w / 2 + 0.02, y, -d / 2 + (c + 0.5) * (d / cols));
      if (lit) markLitWindow(wx, 0.7);
      g.add(wx);
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
// Street furniture: lamps, a hydrant, parked cars, and a shopfront awning.
function buildStreetFurniture(mode = 'summer') {
  const g = group(0, 0, 0);

  // Street lamps along the near sidewalk of the back street. Its road lies to -z,
  // so the arm swings a quarter turn to reach out over it.
  for (const x of [0, 12, 24, 36]) {
    g.add(buildStreetLamp(x, -ROAD_START + 0.9, WALK_Y, 1, mode, Math.PI / 2));
  }
  // And along the left street, whose road lies to -x: a half turn.
  for (const z of [2, 14, 26]) {
    g.add(buildStreetLamp(-ROAD_START + 0.9, z, WALK_Y, 1, mode, Math.PI));
  }

  // Fire hydrant near the corner.
  const hyd = group(-2.0, WALK_Y, -2.0);
  const hbody = cyl(0.22, 0.26, 0.8, 0xc0392b, { segments: 10 });
  hbody.position.y = 0.4; hyd.add(hbody);
  const hcap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat(0xc0392b, { rough: 0.6 }));
  hcap.position.y = 0.82; hyd.add(hcap);
  
  // In winter, add snow on the hydrant top.
  if (mode === 'winter') {
    put(hyd, box(0.5, 0.15, 0.5, COLORS.snow, { rough: 1.0, cast: false }), 0, 1.05);
  }
  
  g.add(hyd);

  // Parked cars along the far kerb of the back street.
  g.add(buildCar(4, -(ROAD_END - 1.6), 0x4a6fa5, 0, mode));
  g.add(buildCar(13, -(ROAD_END - 1.6), 0xb5544a, 0, mode));
  g.add(buildCar(30, -(ROAD_END - 1.6), 0x5c6b73, 0, mode));
  // And one on the left street.
  g.add(buildCar(-(ROAD_END - 1.6), 12, 0x6d8a5a, Math.PI / 2, mode));

  // Shopfront awning across the left street corner (a nod to the inspo's
  // coffee roaster) sitting on the far sidewalk.
  const awning = group(-(ROAD_END + 1.8), WALK_Y, ROOM.D * 0.35);
  put(awning, box(1.6, 0.5, 9.0, 0x3f5a44, { rough: 0.9 }), 0, 4.2, 0);
  
  // In winter, add snow on the awning; in autumn, add fallen leaves.
  if (mode === 'winter') {
    put(awning, box(1.7, 0.2, 9.2, COLORS.snow, { rough: 1.0, cast: false }), 0, 4.42, 0);
  } else if (mode === 'autumn') {
    // A few leaves blown onto the awning.
    const awningLeaf1 = box(0.4, 0.02, 0.3, COLORS.autumnLitter, { cast: false });
    awningLeaf1.rotation.z = 0.5;
    awningLeaf1.position.set(-0.5, 4.38, -2.0);
    awning.add(awningLeaf1);
    
    const awningLeaf2 = box(0.35, 0.02, 0.28, COLORS.autumnLitter, { cast: false });
    awningLeaf2.rotation.z = -0.3;
    awningLeaf2.position.set(0.8, 4.38, 1.5);
    awning.add(awningLeaf2);
  }
  
  g.add(awning);

  return g;
}

export { buildSidewalks, buildRoads, buildCrosswalks, buildPark, buildSkyline, buildStreetFurniture, buildServiceYard };

/**
 * The street, as the outlook registry sees it (see ./index.js).
 *
 * `ground` says what the shared base plane should be for this outlook — a road
 * surface, snowed over in winter. `build` raises everything that stands on it.
 * The service yard rides in on ctx because only a warehouse asks for one.
 */
export const outlook = {
  id: 'street',
  label: 'Street',
  aerial: false,
  ground: (season) => ({
    y: STREET_Y - 0.02,
    color: season === 'winter' ? COLORS.snow : COLORS.road,
  }),
  build(g, { season, serviceYard, building }) {
    if (building === 'simple' || building === 'warehouse') {
      buildAlderStreet(g, season, building === 'warehouse' ? GARDEN_DISTRICTS.warehouse : undefined);
      return;
    }
    g.add(buildSidewalks(season));
    g.add(buildRoads(season));
    g.add(buildCrosswalks(season));
    g.add(buildPark(season));
    g.add(buildSkyline());
    g.add(buildStreetFurniture(season));
    // A service yard only makes sense where there are loading doors to serve.
    if (serviceYard) g.add(buildServiceYard(season));
  },
};
