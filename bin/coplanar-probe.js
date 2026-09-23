#!/usr/bin/env node
//
// Coplanar-face probe - finds the surfaces that will flicker, before you see them.
//
// The recurring graphical bug in this scene is always the same shape: two faces
// land on exactly the same coordinate, which leaves the depth buffer no way to
// order them, so the pair trade places pixel by pixel as the camera moves. It is
// hard to spot by reading the code and easy to spot by measuring, so this builds
// the scene headlessly and measures it.
//
// Two rules make the output worth reading:
//
//   * Only same-facing pairs can fight. Where one box's top meets another's
//     bottom the surfaces merely touch, and only one of the two faces points at
//     any given camera. Those are excluded.
//   * Transparent surfaces cannot fight at all - they blend rather than contest
//     a pixel. The night-light pools are coincident planes by design.
//
// Known limitation, worth reading before chasing anything: this compares
// axis-aligned bounding boxes, so it over-reports rotated and curved geometry.
// The external stair's stringer and handrail are parallel diagonal boards whose
// boxes coincide while their surfaces never meet - a false positive. Treat a hit
// on anything sloped or spherical as a question, not an answer.
//
// Usage:
//   node bin/coplanar-probe.js [options]
//
//   --building=<key>    which building to raise (default: the first project's)
//   --season=<key>      summer | autumn | winter | spring
//   --sweep             every building and season, one summary line each
//   --n=<count>         how many pairs to list (default 12)
//   --min=<area>        ignore pairs contesting less than this (default 0.05)
//   --only=<hex|leaf|car>
//                       only pairs involving a mesh of this colour; "leaf" means
//                       the lift door leaves, "car" the lift car's shell
//   --door=<0..1>       slide the lift doors open by this fraction first, since a
//                       static scene only ever shows them shut
//   --car=<floors>      park the lift car this many storeys below the open floor,
//                       since a static scene only ever shows it at the landing
//   --dump=<axis>:<n>   list every mesh with a face on that plane, e.g. z:20.0.
//                       This is how you identify what is actually colliding.
//   --seed=<n>          the seed the scene is dressed from (default: DEFAULT_SEED).
//                       Vary it to hunt for pairs that only one dressing produces;
//                       leave it alone for a measurement you can compare.
//
// The scene dresses itself at random, so every build is seeded, and built from
// cold as the app builds - see seedRandom() for why a probe that did not do this
// made CI a coin toss rather than a gate, and buildScene() for why seeding by
// itself was not enough.
//
import { options } from './lib/cli-args.js';
import { loadThree, stubDom, seedRandom, DEFAULT_SEED } from './lib/headless-scene.js';

const { opt } = options(process.argv.slice(2));

const OPTS = {
  building: opt('building'),
  season: opt('season'),
  sweep: opt('sweep') === true,
  rows: Number(opt('n', 12)),
  minArea: Number(opt('min', 0.05)),
  only: opt('only'),
  door: opt('door') === null ? null : Number(opt('door')),
  car: opt('car') === null ? null : Number(opt('car')),
  dump: opt('dump'),
  // A baseline JSON of { building: worstVisibleArea } — with it, the sweep
  // becomes an assertion: a worst pair beyond a building's recorded value exits
  // non-zero, which is what lets CI enforce what AGENTS.md used to ask readers
  // to compare by eye. Regenerate with --record after a *deliberate* change.
  assert: opt('assert'),
  record: opt('record'),
  // The dressing this run measures. Fixed by default, because a number that
  // moves on its own cannot be compared with a recorded one.
  seed: Number(opt('seed', DEFAULT_SEED)),
};

// A bare `--seed` would otherwise read as `true` and quietly measure seed 1,
// which is the sort of silence this whole change is about.
if (opt('seed') === true || !Number.isFinite(OPTS.seed)) {
  process.stderr.write(`--seed wants a number, as in --seed=7.\n`);
  process.exit(2);
}

// Faces closer together than this count as the same plane: loose enough to catch
// arithmetic that lands "nearly" on a shared coordinate, tight enough to leave
// the deliberate hairline clearances this scene is full of alone.
const SAME_PLANE = 0.004;

const AXES = ['x', 'y', 'z'];
const LEAF_COLOUR = 'b6bcc3';
const LEAF_THICKNESS = 0.14;
// The car's shell, by colour: floor, ceiling, back, sides, handrail, light panel.
// `--only=car` groups them, because a fault on the car reads as one fault however
// many of its panels are involved, and on its own each colour is a needle in 600
// pairs of city noise.
const CAR_COLOURS = new Set(['8d949b', '7e858c', '9aa1a8', '939aa1', 'c9ced4', 'fff2d8']);

let THREE = null;

function worldBox(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
}

// The leaves are found by colour and thickness rather than by name, because the
// scene does not name its meshes.
function isCarPart(mesh) {
  return CAR_COLOURS.has(mesh.material?.color?.getHexString?.());
}

function isDoorLeaf(mesh) {
  if (mesh.material?.color?.getHexString?.() !== LEAF_COLOUR) return false;
  const b = worldBox(mesh);
  const thin = Math.min(b.max.x - b.min.x, b.max.z - b.min.z);
  return Math.abs(thin - LEAF_THICKNESS) < 0.02;
}

// Close to the app's own travel but not identical: for probing, sampling across
// the sweep is what matters, not matching it to the millimetre.
function driveDoors(scene, fraction) {
  const leaves = [];
  scene.traverse((o) => { if (o.isMesh && isDoorLeaf(o)) leaves.push(o); });
  for (const leaf of leaves) {
    const b = worldBox(leaf);
    const width = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    const dir = Math.sign(leaf.position.x) || 1;
    leaf.position.x += dir * fraction * Math.max(0, width - 0.06);
  }
  scene.updateMatrixWorld(true);
  return leaves.length;
}

// The car is a group of its own, so move it by its parent rather than mesh by
// mesh. It is found through one of its panels, the scene naming nothing.
async function driveCar(scene, floors) {
  const { STOREY_H } = await import('../src/scene/building.js');
  let car = null;
  scene.traverse((o) => {
    if (car || !o.isMesh) return;
    if (o.material?.color?.getHexString?.() === '8d949b' && o.parent?.isGroup) car = o.parent;
  });
  if (!car) return null;
  car.position.y = -Math.abs(floors) * STOREY_H;
  scene.updateMatrixWorld(true);
  return car.position.y;
}

async function buildScene(building, season) {
  const { PROJECTS, resolveTheme } = await import('../src/projects.js');
  const { applyPalette } = await import('../src/config.js');
  const { buildEnvironment } = await import('../src/scene/environment.js');
  const { clearMaterialCache } = await import('../src/scene/build.js');
  const { releaseNightLightAssets } = await import('../src/scene/night-lights.js');

  const overrides = {};
  if (building) overrides.building = building;
  if (season) overrides.season = season;

  const theme = resolveTheme(PROJECTS[0], overrides);
  applyPalette(theme.palette);

  // Build from cold, exactly as the app does.
  //
  // Seeding alone is not enough, for a reason worth writing down. three.js draws
  // four `Math.random()` values to make a UUID for every object, geometry,
  // material and texture it creates — some 22,000 draws a build, next to a few
  // dozen for the dressing itself. So where a book's width lands in the stream
  // depends on how many *things* were made before it, and the scene hands out
  // materials from a process-wide cache: the first build of a process creates 273
  // that later builds get for free. 273 UUIDs, 1092 draws, and the same seed
  // dressing the scene differently. Measured tenth in a sweep, a building scored
  // differently from the same building measured alone.
  //
  // buildWorld() in src/world.js resets both caches before it builds, because
  // they are keyed on colour and would otherwise hand back the last theme's
  // materials — so in a browser every build is a cold one. Doing the same here
  // makes each build independent of every build before it, and keeps the probe
  // measuring the scene the app actually raises rather than a warm variant of it
  // that no reader will ever see.
  //
  // It also means the probe leans on the same invariant the app does: a cache
  // that survives a rebuild is a theming bug there, so this cannot quietly rot
  // while the app stays correct.
  clearMaterialCache();
  releaseNightLightAssets();

  seedRandom(OPTS.seed);
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  buildEnvironment(root, theme);
  scene.updateMatrixWorld(true);
  return { scene, theme };
}

function collect(scene) {
  const items = [];
  const faceNormals = new Map();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const m = o.material;
    if (m && (m.transparent || m.depthWrite === false || m.depthTest === false)) return;
    if (o.isInstancedMesh) {
      o.geometry.computeBoundingBox();
      if (!faceNormals.has(o.geometry)) {
        const normals = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        const positions = o.geometry.attributes.position, index = o.geometry.index;
        for (let t = 0; t < (index?.count ?? positions.count); t += 3) {
          a.fromBufferAttribute(positions, index ? index.getX(t) : t);
          b.fromBufferAttribute(positions, index ? index.getX(t + 1) : t + 1);
          c.fromBufferAttribute(positions, index ? index.getX(t + 2) : t + 2);
          normals.push(b.sub(a).cross(c.sub(a)).normalize().clone());
        }
        faceNormals.set(o.geometry, normals);
      }
      const matrix = new THREE.Matrix4(), colour = new THREE.Color();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, matrix);
        matrix.premultiply(o.matrixWorld);
        if (o.instanceColor) o.getColorAt(i, colour);
        else colour.copy(m.color);
        // A rotated crown's AABB extrema are not planar faces. Only compare
        // axes for which the geometry has a world-aligned surface normal.
        const faces = new Set(), normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
        const normal = new THREE.Vector3();
        for (const faceNormal of faceNormals.get(o.geometry)) {
          normal.copy(faceNormal).applyMatrix3(normalMatrix).normalize();
          for (const axis of AXES) {
            if (normal[axis] > .99999) faces.add(`${axis}max`);
            if (normal[axis] < -.99999) faces.add(`${axis}min`);
          }
        }
        items.push({ box: o.geometry.boundingBox.clone().applyMatrix4(matrix), colour: colour.getHexString(), faces, leaf: false, car: false });
      }
      return;
    }
    items.push({
      box: worldBox(o),
      colour: m?.color?.getHexString?.() ?? '??????',
      leaf: isDoorLeaf(o),
      car: isCarPart(o),
    });
  });
  return items;
}

// Two boxes contest a plane when they sit on the same coordinate along one axis
// with the same face - both maxima or both minima - and overlap in the other two
// axes by enough area to see.
function findPairs(items, minArea) {
  const hits = [];
  for (let i = 0; i < items.length; i++) {
    const a = items[i].box;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j].box;
      for (let ax = 0; ax < 3; ax++) {
        const axis = AXES[ax];
        const u = AXES[(ax + 1) % 3];
        const v = AXES[(ax + 2) % 3];

        const ou = Math.min(a.max[u], b.max[u]) - Math.max(a.min[u], b.min[u]);
        if (ou <= 0) continue;
        const ov = Math.min(a.max[v], b.max[v]) - Math.max(a.min[v], b.min[v]);
        if (ov <= 0) continue;
        const area = ou * ov;
        if (area < minArea) continue;

        for (const face of ['min', 'max']) {
          if (items[i].faces && !items[i].faces.has(`${axis}${face}`)) continue;
          if (items[j].faces && !items[j].faces.has(`${axis}${face}`)) continue;
          if (Math.abs(a[face][axis] - b[face][axis]) >= SAME_PLANE) continue;
          hits.push({
            area, axis, face, at: a[face][axis], u, v,
            a: items[i], b: items[j],
            uRange: [Math.max(a.min[u], b.min[u]), Math.min(a.max[u], b.max[u])],
            vRange: [Math.max(a.min[v], b.min[v]), Math.min(a.max[v], b.max[v])],
          });
        }
      }
    }
  }
  return hits.sort((x, y) => y.area - x.area);
}

// A face pointing down into something solid is a hit but not a symptom, so the
// number that matters is the worst pair a camera can actually see.
const visible = (h) => !(h.axis === 'y' && h.face === 'min');

function report(hits, items) {
  let shown = hits;
  if (OPTS.only) {
    const want = String(OPTS.only).toLowerCase();
    shown = hits.filter(({ a, b }) => {
      if (want === 'leaf') return a.leaf || b.leaf;
      if (want === 'car') return a.car || b.car;
      return a.colour === want || b.colour === want;
    });
  }
  console.log(`MESHES ${items.length}  PAIRS ${shown.length}`);
  for (const h of shown.slice(0, OPTS.rows)) {
    console.log(
      `${h.area.toFixed(3).padStart(9)}  ${h.axis}${h.face === 'max' ? '+' : '-'}=` +
      `${h.at.toFixed(3)}  #${h.a.colour}|#${h.b.colour}  ` +
      `${h.u}[${h.uRange[0].toFixed(2)},${h.uRange[1].toFixed(2)}] ` +
      `${h.v}[${h.vRange[0].toFixed(2)},${h.vRange[1].toFixed(2)}]`
    );
  }
}

function dump(items, spec) {
  const [axis, raw] = String(spec).split(':');
  const at = Number(raw);
  console.log(`DUMP ${axis} = ${at}`);
  for (const it of items) {
    for (const face of ['min', 'max']) {
      if (Math.abs(it.box[face][axis] - at) >= 0.03) continue;
      const s = it.box.max.clone().sub(it.box.min);
      console.log(
        `  ${axis}${face === 'max' ? '+' : '-'}=${it.box[face][axis].toFixed(3)}  ` +
        `#${it.colour}  size ${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}  ` +
        `x[${it.box.min.x.toFixed(2)},${it.box.max.x.toFixed(2)}] ` +
        `y[${it.box.min.y.toFixed(2)},${it.box.max.y.toFixed(2)}] ` +
        `z[${it.box.min.z.toFixed(2)},${it.box.max.z.toFixed(2)}]`
      );
    }
  }
}

async function once(building, season, { quiet = false } = {}) {
  const { scene, theme } = await buildScene(building, season);
  let leaves = 0;
  if (OPTS.door !== null) leaves = driveDoors(scene, OPTS.door);
  let carY = null;
  if (OPTS.car !== null) carY = await driveCar(scene, OPTS.car);

  const items = collect(scene);
  const hits = findPairs(items, OPTS.minArea);
  const worst = hits.find(visible);

  if (quiet) {
    console.log(
      `${theme.building.padEnd(12)} ${theme.season.padEnd(7)} ` +
      `meshes ${String(items.length).padStart(5)}  pairs ${String(hits.length).padStart(4)}  ` +
      `worst visible ${worst ? worst.area.toFixed(2) : '-'}`
    );
    return { building: theme.building, worst: worst ? worst.area : 0 };
  }

  console.log(`BUILDING ${theme.building}  SEASON ${theme.season}  SEED ${OPTS.seed}`);
  if (OPTS.door !== null) console.log(`DOORS ${OPTS.door} open (${leaves} leaves)`);
  if (OPTS.car !== null) {
    console.log(carY === null ? 'CAR not found' : `CAR ${OPTS.car} storeys down (y ${carY.toFixed(2)})`);
  }
  if (OPTS.dump) dump(items, OPTS.dump);
  report(hits, items);
}

async function main() {
  THREE = await loadThree();
  stubDom();

  if (OPTS.sweep) {
    const { BUILDING_LIST, SEASON_LIST } = await import('../src/projects.js');
    const worstBy = {};
    for (const b of BUILDING_LIST) {
      for (const s of SEASON_LIST) {
        const r = await once(b, s, { quiet: true });
        worstBy[r.building] = Math.max(worstBy[r.building] ?? 0, r.worst);
      }
    }
    if (OPTS.record) {
      const { writeFileSync } = await import('node:fs');
      // The seed is recorded with the numbers because it is part of what they
      // mean: measurements of one dressing say nothing about another, so a
      // baseline that did not carry its seed could be compared against a run of
      // a different scene without anything looking wrong.
      const baseline = {
        seed: OPTS.seed,
        worst: Object.fromEntries(
          Object.entries(worstBy).map(([b, w]) => [b, Number(w.toFixed(2))]),
        ),
      };
      writeFileSync(String(OPTS.record), `${JSON.stringify(baseline, null, 2)}\n`);
      console.log(`recorded baseline (seed ${OPTS.seed}) -> ${OPTS.record}`);
    }
    if (OPTS.assert) {
      const { readFileSync } = await import('node:fs');
      const file = JSON.parse(readFileSync(String(OPTS.assert), 'utf8'));
      if (typeof file.seed !== 'number' || !file.worst) {
        console.error(
          `${OPTS.assert} is not a seeded baseline. Re-record it: ` +
          `npm run probe -- --sweep --record=${OPTS.assert}`
        );
        process.exit(1);
      }
      // Comparing this run against numbers taken from a different dressing is
      // meaningless, and quietly so, which is the failure mode this whole change
      // exists to remove. Say it out loud instead.
      if (file.seed !== OPTS.seed) {
        console.error(
          `${OPTS.assert} was recorded under seed ${file.seed}, but this run used ` +
          `seed ${OPTS.seed}. Different dressing, incomparable numbers — drop ` +
          `--assert to explore this seed, or --record a baseline for it.`
        );
        process.exit(1);
      }
      const baseline = file.worst;
      // The dressing is fixed now, so this is no longer covering for a randomly
      // built scene — only for the last digit. The recorded numbers are rounded
      // to 2dp, and Math.sin and Math.sqrt may differ by an ulp between CI
      // (Linux) and a developer machine (macOS). A real new pair is orders bigger
      // than either.
      const SLACK = 0.05;
      const failures = [];
      for (const [b, w] of Object.entries(worstBy)) {
        if (!(b in baseline)) { failures.push(`${b}: no baseline recorded`); continue; }
        if (w > baseline[b] + SLACK) {
          failures.push(`${b}: worst visible ${w.toFixed(2)} exceeds baseline ${baseline[b]}`);
        }
      }
      if (failures.length) {
        console.error(`\nCOPLANAR REGRESSION — a new pair of surfaces is contesting a plane:`);
        for (const f of failures) console.error(`  ${f}`);
        console.error(`If the change is deliberate, re-record: npm run probe -- --sweep --record=${OPTS.assert}`);
        process.exit(1);
      }
      console.log(`baseline held (${Object.keys(worstBy).length} buildings, seed ${OPTS.seed})`);
    }
    return;
  }
  await once(OPTS.building, OPTS.season);
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
