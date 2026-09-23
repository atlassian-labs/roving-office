#!/usr/bin/env node
//
// What each prop's blocked rectangle claims, against what the prop actually is.
//
// `obstacleFootprints()` (src/layout.js) gives every prop one axis-aligned
// rectangle, taken from a hardcoded half-extent per kind. That rectangle does two
// different jobs:
//
//   1. **prop against prop** — `floorFault` (src/editor/placement.js) refuses a
//      drop whose rectangle overlaps another's, so this is what decides how close
//      two objects may be placed;
//   2. **walker against prop** — the nav grid blocks every cell the rectangle
//      touches (`_addPropObstacles`, src/agents/pathfinding.js), so it is also
//      what decides how close somebody may walk.
//
// Those two jobs do not want the same number, and that is the point of this tool.
// Job 1 wants the *mesh*: two things may touch and may not interpenetrate. Job 2
// wants the mesh plus a body — but the walker side already adds its own margin
// three times over, outside the footprint:
//
//   * `block()` marks every cell a rectangle *touches* rather than every cell
//     whose centre it covers, so at CELL = 0.5 a footprint is rounded outward by
//     up to half a unit on each side before a walker sees it;
//   * `_markTight` then flags every free cell within one cell of furniture and
//     charges A* to route through it, so a route prefers to keep another half unit
//     clear wherever there is room;
//   * the crowd pass keeps AGENT_RADIUS (0.46) between bodies in world space.
//
// So padding a footprint "so people can walk past" is paying a third time. This
// prints the slack so the argument can be had in numbers.
//
// Usage:
//   node bin/footprint-audit.js            the table, worst first
//   node bin/footprint-audit.js --table    the measured bodies, as JSON
//   node bin/footprint-audit.js --proposed what a body-plus-approach model claims
//   node bin/footprint-audit.js --check    CI-style: exit non-zero on any drift
//   node bin/footprint-audit.js --json
//
import { stubDom, loadThree } from './lib/headless-scene.js';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');

stubDom();
const THREE = await loadThree();

const { PROJECTS, resolveTheme } = await import('../src/projects.js');
const { applyPalette } = await import('../src/config.js');
const { buildProps } = await import('../src/scene/props.js');
const { clearMaterialCache } = await import('../src/scene/build.js');
const { seedRandom } = await import('./lib/headless-scene.js');
const L = await import('../src/layout.js');
const { CELL } = await import('../src/agents/pathfinding.js');

clearMaterialCache();
const unseed = seedRandom(1);
const theme = resolveTheme(PROJECTS[0], {});
applyPalette(theme.palette);

const scene = new THREE.Scene();
const root = new THREE.Group();
scene.add(root);
buildProps(root, theme);
unseed();

/**
 * The world-space footprint of everything under one object, floor only.
 *
 * Deliberately **not** the whole bounding box: a standard lamp's shade is 1.6 up
 * and a monstera's leaves spread well past its pot, and neither is something a
 * walker's shins meet. Anything above knee height is ignored, because the question
 * this tool is asking is about floor.
 */
/**
 * A prop's measured floor box, expressed in the frame its *consumers* transform
 * from.
 *
 * This is the third attempt and the only one that holds, so the two that failed are
 * worth writing down.
 *
 * Measuring in world space and storing that is wrong, because the table is per kind
 * and a kind's instances face different ways. Measuring in the model's own frame —
 * by zeroing `rotation.y`, or by pushing every corner back through the inverse world
 * matrix — is also wrong, for two reasons the scene graph does not advertise: some
 * props carry their rotation on an ancestor rather than on the node the editor tags,
 * and some carry a *scale* there too. The printer is 1.5x, so dividing it out gave a
 * body a third too small; the mailbox's `facing` turns out not to describe its mesh
 * orientation at all, so re-applying `worldExtent` transposed it.
 *
 * So the table is defined by **inverting the transform that reads it**. Measure the
 * box in world space, then store whatever `hw`/`hd`/`offX`/`offZ` make
 * `worldExtent(facing, hw, hd)` and `toWorld(facing, offX, offZ)` reproduce that box
 * for the facing it was measured at. Whatever the scene graph does internally, the
 * numbers are then correct by construction — and `--check` verifies exactly that
 * property, which is the one that matters.
 */
function bodyFor(object, at, facing) {
  const box = (() => {
    object.updateWorldMatrix(true, true);
    const measured = floorBox(object);
    return measured.empty ? null : measured;
  })();
  if (!box) return null;
  const worldHw = (box.x1 - box.x0) / 2;
  const worldHd = (box.z1 - box.z0) / 2;
  // Relative to the prop's **own position**, which is what `obstacleFootprints`
  // anchors on — not to the rectangle's centre, which already contains the offset
  // being measured and would compound it a little further on every regeneration.
  const wx = (box.x0 + box.x1) / 2 - at.x;
  const wz = (box.z0 + box.z1) / 2 - at.z;
  // `worldExtent` swaps the pair when the prop is a quarter turn round, so undo it.
  const swaps = Math.abs(Math.cos(facing ?? 0)) <= 0.5;
  const c = Math.cos(facing ?? 0);
  const sn = Math.sin(facing ?? 0);
  return {
    hw: swaps ? worldHd : worldHw,
    hd: swaps ? worldHw : worldHd,
    offX: wx * c - wz * sn,
    offZ: wx * sn + wz * c,
  };
}

const KNEE = 0.5;
/**
 * Below this a mesh is a mat rather than a thing — but only if it is also
 * somewhere else.
 *
 * The printer has a paper mat 3cm high, 1.35 out in front of it, which no reading
 * makes an obstacle: a walker steps on it. Excluding everything that flat was the
 * obvious rule and it was wrong in the other direction — a telescope's tripod feet
 * are also flat pads on the floor, and they are the widest part of the prop and
 * genuinely in the way. Dropping them under-measured the telescope by 0.05 and a
 * test that had been asserting the footprint covers the feet caught it.
 *
 * So flat geometry is absorbed when it sits *under* the prop's solid mass and
 * dropped when it lies out beyond it. The feet splay from the tripod's centre and
 * overlap it; the mat is a clear 0.4 in front of the printer's body and does not.
 */
const FLAT = 0.10;
function floorBox(object) {
  const box = new THREE.Box3();
  const out = {
    x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, empty: true,
  };
  object.updateWorldMatrix(true, true);
  const flats = [];
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    box.setFromObject(child);
    if (!Number.isFinite(box.min.x) || box.min.y > KNEE) return;
    if (box.max.y < FLAT) {
      flats.push({
        x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z,
      });
      return;
    }
    out.x0 = Math.min(out.x0, box.min.x);
    out.x1 = Math.max(out.x1, box.max.x);
    out.z0 = Math.min(out.z0, box.min.z);
    out.z1 = Math.max(out.z1, box.max.z);
    out.empty = false;
  });
  // A second pass, because whether a flat piece counts depends on where the solid
  // mass ended up, which is not known until the first pass is done.
  if (!out.empty) {
    for (const flat of flats) {
      if (flat.x0 >= out.x1 || flat.x1 <= out.x0 || flat.z0 >= out.z1 || flat.z1 <= out.z0) continue;
      out.x0 = Math.min(out.x0, flat.x0);
      out.x1 = Math.max(out.x1, flat.x1);
      out.z0 = Math.min(out.z0, flat.z0);
      out.z1 = Math.max(out.z1, flat.z1);
    }
  }
  return out;
}

// Every prop the editor can move, by the key the footprints are tagged with —
// asked of the movables registry rather than guessed at, so this measures exactly
// the objects the editor drags and `obstacleFootprints()` describes.
const { movables } = await import('../src/scene/movables.js');
const byKey = new Map(movables(root).map((m) => [m.key, m.obj]));

const rows = [];
for (const rect of L.obstacleFootprints()) {
  const object = byKey.get(rect.key);
  const declaredHw = (rect.x1 - rect.x0) / 2;
  const declaredHd = (rect.z1 - rect.z0) / 2;
  if (!object) {
    rows.push({ key: rect.key, declaredHw, declaredHd, soft: !!rect.soft, found: false });
    continue;
  }
  const box = floorBox(object);
  if (box.empty) {
    rows.push({ key: rect.key, declaredHw, declaredHd, soft: !!rect.soft, found: false });
    continue;
  }
  const meshHw = (box.x1 - box.x0) / 2;
  const meshHd = (box.z1 - box.z0) / 2;
  // **How far the geometry sits from the point the rectangle is centred on.**
  //
  // This is the structural half of the problem and the reason shrinking the
  // numbers alone will not fix it. `obstacleFootprints` centres every rectangle on
  // the prop's own origin, and several props are not built around theirs: a
  // couch's seat is a third of a unit behind its origin, and a desk's chair is
  // over a unit and a half behind. An axis-aligned rectangle centred on the origin
  // has to reach far enough to cover the loaded side, which means it also reaches
  // that far into the empty one — so the same rectangle is too big on one side and
  // too small on the other at the same time.
  const offX = (box.x0 + box.x1) / 2 - (rect.x0 + rect.x1) / 2;
  const offZ = (box.z0 + box.z1) / 2 - (rect.z0 + rect.z1) / 2;
  // **How far the mesh pokes out of its own rectangle, measured directly.**
  //
  // Compared edge to edge rather than derived from the half-extents and the
  // offset: `declaredHw - meshHw - |offX|` looks like the same thing and
  // double-counts the offset, which turned a desk chair's real 0.49 of overhang
  // into a reported 0.81. Two numbers that should agree and do not are worth one
  // more line of arithmetic.
  const outX = Math.max(rect.x0 - box.x0, box.x1 - rect.x1);
  const outZ = Math.max(rect.z0 - box.z0, box.z1 - rect.z1);
  rows.push({
    key: rect.key,
    kind: rect.key.split(':')[0],
    soft: !!rect.soft,
    found: true,
    meshHw,
    meshHd,
    declaredHw,
    declaredHd,
    slackHw: declaredHw - meshHw,
    slackHd: declaredHd - meshHd,
    offX,
    offZ,
    // Positive: the mesh leaves its rectangle by this much on the worst side.
    // Negative: the rectangle clears the mesh everywhere on this axis, by this much.
    outX,
    outZ,
    // What a walker actually meets, once the grid has rounded the rectangle out to
    // whole cells: the number that matters for "can somebody walk past this".
    gridHw: Math.ceil(declaredHw / CELL) * CELL,
    gridHd: Math.ceil(declaredHd / CELL) * CELL,
  });
}

/**
 * What the same prop would claim under the plan layer's model.
 *
 * `src/plan/floor.js` already draws the distinction this tool exists to argue
 * for, and has since the two disagreed once: `claimOf` gives a prop a tight `foot`
 * (role `PROP`)
 * *and* a separate `strip` out to where its user stands (role `STAND`), aimed
 * along `heading(facing)`. The rules over those roles are already the right ones —
 * `FOR_PROP` keeps a body clear of other bodies, aisles and other props' standing
 * room, while `FOR_STAND` lets two people's standing room overlap, because two
 * people sharing circulation space is not a collision.
 *
 * So two printers may stand side by side, a plant may go against the back of a
 * couch, and a lamp and a plant may sit together to make a wall you walk around —
 * all of which the generator permits today and the editor refuses, because
 * `obstacleFootprints()` flattens both rectangles into one symmetric box centred
 * on the origin.
 *
 * The kinds already carry the numbers. Everything with a side that needs space
 * declares `approachDist` — printer and bookshelf 2.0, inbox 1.8, coffee, mailbox
 * and waterCooler 1.7, bin 1.55, telescope 1.52, couch and armchair 2.5 — and
 * everything you never walk up to declares none: coatStand, sideTable, rug,
 * floorLamp. Nobody has to invent a table.
 */
const KINDS = { ...L.STATION_KINDS, ...L.FURNITURE_KINDS };
function proposal(row) {
  const kind = row.key.split(':')[0];
  const name = row.key.slice(kind.length + 1);
  const spec = kind === 'desk'
    ? { approachDist: L.DESK_APPROACH ?? 1.9 }
    : KINDS[Object.values(L.STATIONS).find((s) => s.id === name)?.kind
      ?? L.FURNITURE.find((f) => f.id === name)?.kind] ?? {};
  return {
    // The body: what the mesh actually occupies, which is what a neighbouring prop
    // has to clear. Sides and back go to nothing.
    bodyHw: row.meshHw,
    bodyHd: row.meshHd,
    // The approach: one side only, as deep as the kind already says.
    approach: spec.approachDist ?? null,
    blockedNow: (row.declaredHw * 2) * (row.declaredHd * 2),
    blockedBody: (row.meshHw * 2) * (row.meshHd * 2),
  };
}

if (argv.includes('--check')) {
  /**
   * Does every prop's rectangle still contain the prop?
   *
   * The guard that makes "measured, not chosen" true rather than aspirational, in
   * the spirit of `bin/gen-npm-scripts.mjs --check`. Remodel a prop so its base is
   * wider, or move a mesh inside its group, and the kind tables in src/layout.js
   * are quietly wrong again — and nothing else would notice, because `clear` in
   * bin/office-fitness.js tests a walker's centre against those same rectangles.
   * That is how seven props came to have geometry outside their own footprint.
   *
   * A tolerance rather than exact equality, because these are two-decimal numbers
   * and a mesh built from trigonometry is not: 0.02 is a fifth of a nav-grid cell
   * and a twentieth of a body, and no drift that matters is smaller.
   */
  const TOLERANCE = 0.02;
  const bad = rows.filter((r) => r.found && (r.outX > TOLERANCE || r.outZ > TOLERANCE));
  const loose = rows.filter((r) => r.found && !r.soft
    && (r.outX < -0.25 || r.outZ < -0.25));
  if (bad.length) {
    process.stderr.write('  FOOTPRINTS HAVE DRIFTED — geometry outside its own rectangle:\n');
    for (const r of bad) {
      process.stderr.write(`    ${r.key.padEnd(22)} pokes out by `
        + `${Math.max(r.outX, 0).toFixed(2)} / ${Math.max(r.outZ, 0).toFixed(2)}\n`);
    }
    process.stderr.write('\n  Re-measure and paste the numbers into the kind tables:\n');
    process.stderr.write('    node bin/footprint-audit.js --table\n');
    process.exitCode = 1;
  } else if (loose.length) {
    process.stderr.write('  FOOTPRINTS HAVE DRIFTED — rectangles far larger than the props:\n');
    for (const r of loose) {
      process.stderr.write(`    ${r.key.padEnd(22)} clears its mesh by `
        + `${(-r.outX).toFixed(2)} / ${(-r.outZ).toFixed(2)}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stderr.write(`  ${rows.filter((r) => r.found).length} footprints match their props`
      + ` to within ${TOLERANCE}\n`);
  }
} else if (argv.includes('--table')) {
  // One entry per *kind*, not per prop: two bookshelves are the same mesh, and a
  // plant's spread is its kind's times its own scale, so the table holds the unit
  // and each instance keeps its multiplier.
  //
  // Swept over generated offices until every kind has been seen, because the
  // authored room does not contain them all — it has no armchair and no fern, and
  // the generator places both. A table missing two kinds would fall back to
  // whatever the old constant was for exactly the props nobody had checked.
  const { generateOffice } = await import('../src/plan/index.js');
  const table = new Map();
  const want = new Set([
    ...Object.keys(L.STATION_KINDS).map((k) => `station:${k}`),
    ...Object.keys(L.FURNITURE_KINDS).map((k) => `furniture:${k}`),
    ...Object.keys(L.PLANT_KINDS).map((k) => `plant:${k}`),
    'desk:desk',
  ]);

  const harvest = (group) => {
    const kindOf = new Map();
    for (const s of Object.values(L.STATIONS)) kindOf.set(`station:${s.id}`, ['station', s.kind, 1]);
    for (const f of L.FURNITURE) kindOf.set(`furniture:${f.id}`, ['furniture', f.kind, 1]);
    for (const p of L.DECOR.plants) kindOf.set(`plant:${p.id}`, ['plant', p.kind, p.scale]);
    for (const d of L.DESKS) kindOf.set(`desk:${d.id}`, ['desk', 'desk', 1]);
    const placedAt = new Map();
    for (const d of L.DESKS) placedAt.set(`desk:${d.id}`, d);
    for (const st of Object.values(L.STATIONS)) placedAt.set(`station:${st.id}`, st);
    for (const fu of L.FURNITURE) placedAt.set(`furniture:${fu.id}`, fu);
    for (const pl of L.DECOR.plants) placedAt.set(`plant:${pl.id}`, { ...pl, facing: 0 });
    for (const m of movables(group)) {
      const entry = kindOf.get(m.key);
      const at = placedAt.get(m.key);
      if (!entry || !at) continue;
      const [g, kind, scale] = entry;
      const box = bodyFor(m.obj, at, at.facing ?? 0);
      if (!box || !scale) continue;
      // A plant's kind holds the unit spread and each instance multiplies by its
      // own scale, so divide it back out. Everything else scales at 1.
      const unit = {
        hw: box.hw / scale, hd: box.hd / scale, offX: box.offX / scale, offZ: box.offZ / scale,
      };
      // **The union of the spans**, per axis, because instances of a kind differ in
      // different directions and a kind's body has to cover all of them: desk-4 is
      // the standing desk, wider and shallower, and desk-1 is narrower and deeper.
      //
      // Taking the larger extent and the larger offset separately looks equivalent
      // and is not — it pairs one instance's extent with another's offset and
      // describes a box neither of them occupies, which left all five desks poking
      // 0.09 out of their own rectangle. Spans compose; half-extents and centres do
      // not.
      const span = {
        x0: unit.offX - unit.hw, x1: unit.offX + unit.hw,
        z0: unit.offZ - unit.hd, z1: unit.offZ + unit.hd,
      };
      const seen = table.get(`${g}:${kind}`);
      table.set(`${g}:${kind}`, seen ? {
        x0: Math.min(seen.x0, span.x0), x1: Math.max(seen.x1, span.x1),
        z0: Math.min(seen.z0, span.z0), z1: Math.max(seen.z1, span.z1),
      } : span);
    }
  };

  harvest(root);
  let swept = 0;
  for (let i = 0; i < 400 && [...want].some((k) => !table.has(k)); i += 1) {
    swept += 1;
    L.resetLayout();
    L.applyLayout(generateOffice(`body-${i}`).layout);
    clearMaterialCache();
    const unseedOne = seedRandom(1);
    const next = new THREE.Group();
    scene.add(next);
    buildProps(next, theme);
    unseedOne();
    harvest(next);
    scene.remove(next);
  }
  const missing = [...want].filter((k) => !table.has(k));
  const round = (v) => Math.round(v * 100) / 100;
  const out = {};
  for (const [k, v] of [...table].sort()) {
    if (!want.has(k)) continue;
    out[k] = {
      hw: round((v.x1 - v.x0) / 2),
      hd: round((v.z1 - v.z0) / 2),
      offX: round((v.x0 + v.x1) / 2),
      offZ: round((v.z0 + v.z1) / 2),
    };
  }
  process.stderr.write(`  ${Object.keys(out).length} kinds measured over ${swept + 1} rooms`
    + `${missing.length ? `, MISSING ${missing.join(' ')}` : ', none missing'}\n`);
  console.log(JSON.stringify(out, null, 2));
} else if (argv.includes('--proposed')) {
  const found = rows.filter((r) => r.found && !r.soft);
  process.stdout.write('\n  What the plan layer\'s model would claim instead\n\n');
  process.stdout.write(`  ${'prop'.padEnd(22)} ${'body (mesh)'.padStart(12)} ${'blocked now'.padStart(12)}`
    + ` ${'body only'.padStart(12)} ${'approach'.padStart(9)}\n`);
  let now = 0;
  let body = 0;
  for (const r of found) {
    const p = proposal(r);
    now += p.blockedNow;
    body += p.blockedBody;
    process.stdout.write(`  ${r.key.padEnd(22)} ${`${p.bodyHw.toFixed(2)}x${p.bodyHd.toFixed(2)}`.padStart(12)}`
      + ` ${p.blockedNow.toFixed(2).padStart(12)} ${p.blockedBody.toFixed(2).padStart(12)}`
      + ` ${(p.approach == null ? 'none' : p.approach.toFixed(2)).padStart(9)}\n`);
  }
  process.stdout.write(`\n  blocked floor, all props: ${now.toFixed(1)} now -> ${body.toFixed(1)} as bodies`
    + ` (${(100 * (1 - body / now)).toFixed(0)}% less), out of ${(26 * 20).toFixed(0)} of room\n`);
  process.stdout.write('  The approach strips are not lost -- they move to role STAND, which refuses\n');
  process.stdout.write('  another prop but lets two people\'s standing room overlap, and stays walkable.\n\n');
} else if (asJson) {
  console.log(JSON.stringify({ cell: CELL, knee: KNEE, rows }, null, 1));
} else {
  const found = rows.filter((r) => r.found);
  const missing = rows.filter((r) => !r.found);
  process.stdout.write(`\n  ${found.length} props measured, floor geometry only (below y ${KNEE})\n`);
  process.stdout.write(`  grid cell ${CELL}, so the nav grid rounds every rectangle out to a multiple of it\n\n`);
  process.stdout.write(`  ${'prop'.padEnd(22)} ${'mesh'.padStart(11)} ${'declared'.padStart(11)}`
    + ` ${'off-centre'.padStart(11)} ${'pokes out'.padStart(11)} ${'grid'.padStart(11)}\n`);
  const pair = (a, b) => `${a.toFixed(2)}x${b.toFixed(2)}`.padStart(11);
  const sign = (a, b) => `${a >= 0 ? '+' : ''}${a.toFixed(2)}/${b >= 0 ? '+' : ''}${b.toFixed(2)}`.padStart(11);
  // Worst first: a negative worst edge is a prop whose geometry leaves its own
  // blocked rectangle, which is the half of this nobody has been able to see.
  for (const r of found.sort((a, b) => Math.max(b.outX, b.outZ) - Math.max(a.outX, a.outZ))) {
    process.stdout.write(`  ${r.key.padEnd(22)} ${pair(r.meshHw, r.meshHd)} ${pair(r.declaredHw, r.declaredHd)}`
      + ` ${sign(r.offX, r.offZ)} ${sign(r.outX, r.outZ)} ${pair(r.gridHw, r.gridHd)}${r.soft ? '  soft' : ''}\n`);
  }
  const poking = found.filter((r) => Math.max(r.outX, r.outZ) > 0.05);
  process.stdout.write(`\n  ${poking.length} of ${found.length} props have geometry outside their own blocked rectangle.\n`);
  process.stdout.write('  Nothing currently measures that: `clear` in bin/office-fitness.js tests a\n');
  process.stdout.write('  walker\'s centre against these same rectangles, so a mesh that leaves its\n');
  process.stdout.write('  rectangle is invisible to the one number that would have caught it.\n');
  if (missing.length) {
    process.stdout.write(`\n  no mesh matched for ${missing.length}: ${missing.map((r) => r.key).join(', ')}\n`);
  }
}
