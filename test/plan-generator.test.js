// The seeded office generator.
//
// The promise the generator makes is not "different every time" — that is easy
// and worth nothing — but "**useful** every time": a room whose desks are in
// teams, whose aisles go somewhere, which has somewhere to do every job the
// office needs doing, and which the furniture editor would have allowed somebody
// to build by hand. So the sweep below is the real test, and it asks of a few
// hundred seeds exactly what the editor asks of one drag.
//
// It is a plain test with no browser and no three.js, because `src/plan/` reaches
// config.js, layout.js and the editor's placement arithmetic and nothing else.
// The one thing that cannot be checked here is whether the *nav grid* agrees that
// everybody can get everywhere; that needs a real grid, and it is
// test/plan-reach.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateOffice, officeFor, seedFor, validate } from '../src/plan/index.js';
import { brief } from '../src/plan/brief.js';
import { furnish } from '../src/plan/furnish.js';
import { SCHEMES, POST_CHARACTERS, TYPOLOGIES } from '../src/plan/brief.js';
import { streamFor, mintSeed, seedText, fieldAt } from '../src/plan/rng.js';
import {
  DESKS, STATIONS, FURNITURE, DECOR, JOB_ROLES, STATION_KINDS, FURNITURE_KINDS,
  LAYOUT_VERSION, LAYOUT_MARGIN, applyLayout, resetLayout, layoutSnapshot, worldExtent,
  obstacleFootprints, stationsForRole, agentCapacity,
} from '../src/layout.js';
import { RUG_COLORS, SOFA_COLORS, ROOM } from '../src/config.js';
import { floorFault } from '../src/editor/placement.js';
import { LOOKS } from '../bin/lib/looks-judge.js';

/**
 * The rug-shape measure, read from wherever it currently lives so the test and the
 * judge cannot drift apart.
 *
 * It moved: written as a candidate in bin/lib/looks-candidates.js and promoted
 * into the judge once three rounds of labelling had something to say about it.
 * Looking it up by key rather than reimplementing it is what made that a one-line
 * change instead of two measures slowly disagreeing.
 */
const compactOf = (rugs) => LOOKS.find((m) => m.key === 'compact').of({ rugs });

/** How many seeds the sweep covers. Enough to be a claim; quick enough to run. */
const SWEEP = 240;
const seeds = Array.from({ length: SWEEP }, (_, i) => `sweep-${i}`);

test('the same seed is always the same office', () => {
  for (const seed of ['brass-lantern-0007', '42', 'a sentence somebody typed']) {
    const a = generateOffice(seed);
    const b = generateOffice(seed);
    assert.deepEqual(a.layout, b.layout, `${seed} laid out differently the second time`);
    assert.equal(a.name, b.name);
    assert.equal(a.reason, b.reason);
    assert.deepEqual(a.look, b.look);
  }
});

test('a seed is text, however it arrives', () => {
  // A number, a number as a string, and the same string with a stray space are
  // one office: a trailing space is a typo and never a choice.
  assert.deepEqual(generateOffice(42).layout, generateOffice('42').layout);
  assert.deepEqual(generateOffice('amber').layout, generateOffice('  amber ').layout);
  assert.equal(seedText('  '), null);
  assert.equal(seedText(Number.NaN), null);
  // Nothing given mints one, which is the only draw in the generator that is not
  // the seed's.
  const minted = generateOffice();
  assert.match(minted.seed, /^[a-z]+-[a-z]+-\d{4}$/);
  assert.deepEqual(generateOffice(minted.seed).layout, minted.layout);
});

test('different seeds are different offices', () => {
  const plans = new Set(seeds.map((s) => JSON.stringify(generateOffice(s).layout)));
  // Not "all different" as a matter of principle — two seeds are allowed to
  // produce one room — but anything less than nearly all of them would mean the
  // seed is not reaching the decisions.
  assert.ok(plans.size > SWEEP * 0.98, `only ${plans.size} distinct plans from ${SWEEP} seeds`);
});

test('a stage cannot be reshuffled by another stage', () => {
  // Streams are hashed per stage rather than derived from one root, so drawing
  // more from one stage cannot move another. This is the property that lets the
  // planting be rewritten without moving anybody's desk.
  const desks = streamFor('anchor', 'desks');
  const first = desks.floats(4);
  const other = streamFor('anchor', 'planting');
  other.floats(50);
  assert.deepEqual(streamFor('anchor', 'desks').floats(4), first);
  // And two stages of one seed are not the same sequence, which is what a linear
  // derivation from a root seed risks (see the note in src/plan/rng.js).
  assert.notDeepEqual(streamFor('anchor', 'desks').floats(4), streamFor('anchor', 'stations').floats(4));
});

test('the tie-break field does not depend on when it is asked', () => {
  const forwards = [];
  for (let x = 0; x < 8; x += 1) forwards.push(fieldAt('s', 'couch', x, 3));
  const backwards = [];
  for (let x = 7; x >= 0; x -= 1) backwards.push(fieldAt('s', 'couch', x, 3));
  assert.deepEqual(forwards, backwards.reverse());
  assert.ok(forwards.every((n) => n >= 0 && n < 1));
});

test('every colour a scheme names is a colour the room has', () => {
  for (const [key, scheme] of Object.entries(SCHEMES)) {
    assert.ok(scheme.rug in RUG_COLORS, `${key}: no rug called ${scheme.rug}`);
    assert.ok(scheme.sofa in SOFA_COLORS, `${key}: no upholstery called ${scheme.sofa}`);
    assert.ok(scheme.accent in SOFA_COLORS, `${key}: no upholstery called ${scheme.accent}`);
  }
});

test('every way work can arrive can also get work out', () => {
  // The brief may not describe a room that cannot dispatch: the inbox is intake
  // only, so a post character made of one would be a room where finished work has
  // nowhere to go. Asked of `STATION_KINDS` rather than of a list here, so a role
  // moved in the layout is caught rather than restated.
  for (const [key, post] of Object.entries(POST_CHARACTERS)) {
    const kinds = [
      ...Array(post.mailboxes).fill('mailbox'),
      ...Array(post.printers).fill('printer'),
      ...Array(post.inboxes).fill('inbox'),
    ];
    const roles = new Set(kinds.flatMap((k) => STATION_KINDS[k].roles));
    assert.ok(roles.has('intake'), `${key} cannot take work in`);
    assert.ok(roles.has('dispatch'), `${key} cannot get work out`);
  }
});

test('a brief always adds up', () => {
  for (const seed of seeds.slice(0, 60)) {
    const b = brief(seed);
    assert.ok(b.desks >= 2 && b.desks <= 14, `${seed}: ${b.desks} desks`);
    assert.equal(b.teams.reduce((n, t) => n + t, 0), b.desks, `${seed}: teams do not add up`);
    assert.ok(b.teams.every((t) => t >= 1));
    assert.ok(b.desks >= TYPOLOGIES[b.typology].minDesks, `${seed}: ${b.typology} with ${b.desks} desks`);
    assert.ok(b.standing <= b.desks);
  }
});

test('no seat has its back to the group it is in', () => {
  // The rule, as given: *"Sofas and armchairs, side tables etc. should always
  // face each other, or face at 90 degrees to each other, never away from each
  // other. Sofas ideally mostly on rugs."*
  //
  // It lives here rather than in the looks judge because it is an **invariant**,
  // not a preference. The judge is a model of one person's taste fitted to their
  // rankings, and a thing they have stated outright is not something to weigh
  // against being near the coffee machine — it either holds for every seed or the
  // generator is wrong. Before it was enforced, 43% of seats faced away from their
  // own group and 55% of side tables stood behind the back of the seat they were
  // meant to serve.
  const heading = (f) => ({ x: Math.sin(f), z: Math.cos(f) });
  let seats = 0;
  let tables = 0;
  let onRug = 0;
  let couches = 0;

  for (let i = 0; i < 120; i += 1) {
    const office = generateOffice(`facing-${i}`);
    const pieces = Object.values(office.layout.furniture ?? {});
    const seating = pieces.filter((p) => p.kind === 'couch' || p.kind === 'armchair');
    const rugs = pieces.filter((p) => p.kind === 'rug').map((r) => {
      const world = worldExtent(r.facing ?? 0, FURNITURE_KINDS.rug.hw, FURNITURE_KINDS.rug.hd);
      return {
        x0: r.x - world.hw, x1: r.x + world.hw, z0: r.z - world.hd, z1: r.z + world.hd,
      };
    });

    for (const seat of seating) {
      const rest = seating.filter((other) => other !== seat);
      if (!rest.length) continue;
      seats += 1;
      const mid = {
        x: rest.reduce((n, p) => n + p.x, 0) / rest.length,
        z: rest.reduce((n, p) => n + p.z, 0) / rest.length,
      };
      const to = { x: mid.x - seat.x, z: mid.z - seat.z };
      const len = Math.hypot(to.x, to.z);
      if (len < 0.5) continue;
      const look = heading(seat.facing);
      const cos = (look.x * to.x + look.z * to.z) / len;
      assert.ok(
        cos > 0,
        `${office.seed}: ${seat.id} faces away from the rest of the seating (cos ${cos.toFixed(2)})`,
      );
    }

    // A side table has no facing anybody sits in, so the rule for it is the
    // reachable one: never behind the back of the seat it serves.
    for (const table of pieces.filter((p) => p.kind === 'sideTable')) {
      const near = seating
        .map((p) => ({ p, d: Math.hypot(p.x - table.x, p.z - table.z) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!near) continue;
      tables += 1;
      const back = heading(near.p.facing);
      const off = { x: table.x - near.p.x, z: table.z - near.p.z };
      assert.ok(
        back.x * off.x + back.z * off.z >= -1.2,
        `${office.seed}: ${table.id} stands behind the back of ${near.p.id}`,
      );
    }

    for (const couch of seating.filter((p) => p.kind === 'couch')) {
      couches += 1;
      if (rugs.some((r) => couch.x > r.x0 && couch.x < r.x1 && couch.z > r.z0 && couch.z < r.z1)) {
        onRug += 1;
      }
    }
  }

  // Enough of each to mean something: a run where nothing was placed would pass
  // every assertion above by never reaching one.
  assert.ok(seats > 100, `only ${seats} seats had company to face`);
  assert.ok(tables > 60, `only ${tables} side tables to check`);
  // "Sofas ideally mostly on rugs" — *ideally*, so a share and not an assertion
  // per couch. It was 52% when the rugs were placed by proximity to a centroid.
  assert.ok(onRug / couches > 0.8, `only ${((onRug / couches) * 100).toFixed(0)}% of couches stand on a rug`);
});

test('rugs that join up make a rectangle, not a staircase', () => {
  // *"Rectangular rugs — or combined multiple rugs as a rectangle to indicate an
  // area — are definitely better than ragged ones."*
  //
  // Stated, so it goes here rather than into the looks judge. It is a *share*
  // rather than a per-room assertion, because a square join is not always
  // available: the aligned position can be taken by a desk, and two tidy separate
  // areas are a better answer than one area with a corner bitten out of it.
  //
  // The measure is the one in bin/lib/looks-candidates.js: rugs grouped into the
  // areas they actually form, each area against its own bounding box. Before the
  // rule, 26% of rooms with two rugs made a rectangle and 27% were ragged.
  let rect = 0;
  let ragged = 0;
  let rooms = 0;

  for (let i = 0; i < 120; i += 1) {
    const rugs = Object.values(generateOffice(`rug-${i}`).layout.furniture ?? {})
      .filter((p) => p.kind === 'rug')
      .map((r) => {
        const w = worldExtent(r.facing ?? 0, FURNITURE_KINDS.rug.hw, FURNITURE_KINDS.rug.hd);
        return {
          x0: r.x - w.hw, x1: r.x + w.hw, z0: r.z - w.hd, z1: r.z + w.hd,
        };
      });
    if (rugs.length < 2) continue;
    rooms += 1;
    const fill = compactOf(rugs);
    if (fill > 0.97) rect += 1;
    if (fill < 0.7) ragged += 1;
  }

  assert.ok(rooms > 50, `only ${rooms} rooms had two rugs to join`);
  assert.ok(rect / rooms > 0.6, `only ${((rect / rooms) * 100).toFixed(0)}% of rug areas are rectangles`);
  assert.ok(ragged / rooms < 0.2, `${((ragged / rooms) * 100).toFixed(0)}% of rug areas are ragged`);
});

test('every seed produces a room that works', () => {
  const shortfalls = [];
  for (const seed of seeds) {
    const office = generateOffice(seed);
    const r = office.report;
    assert.ok(r.ok, `${seed}: ${r.faults.join('; ')}`);
    assert.ok(r.traits.desks >= 1, `${seed}: nobody can work here`);
    if (r.fit.got < r.fit.asked) shortfalls.push(seed);

    // Somewhere to do every job, which is the rule the editor enforces on a
    // deletion — asked here of the plan, from the same table.
    const roles = new Set(office.report.traits.traits && Object.entries(r.traits.stations)
      .filter(([, n]) => n > 0)
      .flatMap(([kind]) => STATION_KINDS[kind].roles));
    for (const role of JOB_ROLES) assert.ok(roles.has(role), `${seed}: nowhere to ${role}`);
  }
  // A brief the floor cannot seat in full is not a failure — fourteen desks and a
  // great library will not go onto 26 by 20 — but it should be the exception.
  assert.ok(shortfalls.length < SWEEP * 0.25,
    `${shortfalls.length} of ${SWEEP} briefs came out short`);
});

test('a generated plan is a plan the editor could have made', () => {
  for (const seed of seeds.slice(0, 80)) {
    const office = generateOffice(seed);
    const blob = office.layout;

    assert.equal(blob.layout, LAYOUT_VERSION);
    assert.equal(blob.complete, true);
    assert.equal(typeof blob.name, 'string');
    assert.equal(blob.seed, office.seed);

    resetLayout();
    assert.ok(applyLayout(blob), `${seed}: applied nothing`);

    // What the blob said is what the room now holds.
    assert.equal(DESKS.length, Object.keys(blob.desks).length, `${seed}: desk count`);
    assert.equal(agentCapacity(), DESKS.length);
    assert.equal(Object.keys(STATIONS).length, Object.keys(blob.stations).length, `${seed}: stations`);
    assert.equal(FURNITURE.length, Object.keys(blob.furniture).length, `${seed}: furniture`);
    assert.equal(DECOR.plants.length, Object.keys(blob.plants).length, `${seed}: plants`);
    for (const role of JOB_ROLES) {
      assert.ok(stationsForRole(role).length, `${seed}: nowhere to ${role} after applying`);
    }

    // Nothing overlaps and nothing hangs off the floor, judged by the editor's own
    // arithmetic on the real footprints the nav grid will be built from.
    const rects = obstacleFootprints();
    for (const rect of rects) {
      assert.equal(floorFault(rect.key, rects, ROOM), null, `${seed}: ${rect.key}`);
    }

    // Nothing is anywhere `applyLayout` would move it. Import clamps a prop's
    // centre into the room by `LAYOUT_MARGIN`, so a plan that puts one outside
    // that is a plan the room silently rearranges — and then the layout that was
    // checked is not the layout that gets stored. This caught the check being
    // dropped in a refactor, which is what it is for.
    for (const [family, entries] of Object.entries({
      desk: blob.desks, station: blob.stations, furniture: blob.furniture, plant: blob.plants,
    })) {
      for (const [id, piece] of Object.entries(entries)) {
        assert.ok(piece.x >= LAYOUT_MARGIN && piece.x <= ROOM.W - LAYOUT_MARGIN
          && piece.z >= LAYOUT_MARGIN && piece.z <= ROOM.D - LAYOUT_MARGIN,
        `${seed}: ${family} ${id} at ${piece.x},${piece.z} is outside the margin import keeps`);
      }
    }

    // Every desk is either on a T-frame or not, said explicitly: a generated blob
    // is applied *onto* another room, and `applyLayout` reads `standing` only
    // where a blob mentions it.
    for (const [id, desk] of Object.entries(blob.desks)) {
      assert.equal(typeof desk.standing, 'boolean', `${seed}: ${id} says nothing about standing`);
    }
    const standing = DESKS.filter((d) => d.standing).length;
    assert.equal(standing, Object.values(blob.desks).filter((d) => d.standing).length);

    // Every colour named is one the piece comes in, and only pieces that come in
    // colours have one.
    for (const [id, piece] of Object.entries(blob.furniture)) {
      const palette = FURNITURE_KINDS[piece.kind]?.palette;
      if (!palette) {
        assert.ok(!('color' in piece), `${seed}: ${id} was painted and does not come in colours`);
        continue;
      }
      assert.ok(piece.color === null || piece.color in palette, `${seed}: ${id} is ${piece.color}`);
    }
  }
  resetLayout();
});

test('a generated plan survives a round trip through the editor', () => {
  // Applied, snapshotted, applied again: the second snapshot has to match the
  // first, or a generated room is one that changes the moment somebody saves it.
  for (const seed of seeds.slice(0, 30)) {
    resetLayout();
    applyLayout(generateOffice(seed).layout);
    const once = layoutSnapshot();
    assert.ok(applyLayout(once));
    assert.deepEqual(layoutSnapshot(), once, `${seed}: not stable through a save`);
  }
  resetLayout();
});

test('the room is named after what is in it', () => {
  for (const seed of seeds.slice(0, 120)) {
    const office = generateOffice(seed);
    assert.ok(office.name.length >= 4 && office.name.length <= 40, `${seed}: "${office.name}"`);
    // No placeholders, no double spaces, no "undefined" — the three ways a
    // generated phrase fails in public.
    assert.doesNotMatch(office.name, /undefined|null|NaN|\s\s|^\s|\s$/, `${seed}: "${office.name}"`);
    assert.doesNotMatch(office.reason, /undefined|null|NaN|\s\s|,\s*\./, `${seed}: "${office.reason}"`);
    assert.match(office.reason, /desk/);
    // The reason counts the desks the room actually has.
    assert.ok(office.reason.startsWith(`${office.report.traits.desks} desk`), `${seed}: ${office.reason}`);
  }
});

test('the look is one a scene can be dressed in', () => {
  const seasons = new Set(['summer', 'autumn', 'winter', 'spring']);
  const buildings = new Set(['simple', 'warehouse', 'skyscraper', 'mansard']);
  for (const seed of seeds.slice(0, 40)) {
    const { look } = generateOffice(seed);
    assert.ok(seasons.has(look.season), `${seed}: ${look.season}`);
    assert.ok(buildings.has(look.building), `${seed}: ${look.building}`);
  }
});

test('a thing with an id gets a readable seed of its own', () => {
  const id = 'scene-m8x2k1-7fa3';
  assert.match(seedFor(id), /^[a-z]+-[a-z]+-\d{4}$/);
  assert.equal(seedFor(id), seedFor(id));
  assert.notEqual(seedFor(id), seedFor('scene-m8x2k1-7fa4'));
  // Which is the whole point: two tabs opening one new scene generate the same
  // office rather than racing to store two different ones.
  assert.deepEqual(officeFor(id).layout, officeFor(id).layout);
  assert.equal(officeFor(id).seed, seedFor(id));
});

test('a plan that does not fit is refused rather than shipped', () => {
  // `validate` is the gate, so it has to actually fail on a broken room. The
  // cheapest broken room is one with nowhere to do a job: take the brief's post
  // away entirely and the plan can no longer get work out.
  const b = brief('brass-lantern-0007');
  const built = furnish({
    ...b,
    post: { ...b.post, mailboxes: 0, printers: 0, inboxes: 0 },
  });
  const check = validate(built);
  assert.equal(check.ok, false);
  assert.ok(check.faults.some((f) => f.includes('intake')), check.faults.join('; '));
  assert.ok(check.faults.some((f) => f.includes('dispatch')), check.faults.join('; '));
});

test('nothing that would fence somebody in is ever put down', () => {
  // `sweep-409` is the seed that found this: a bin in a corner the couch fenced
  // off, which failed the whole layout — a good office thrown away to protect a
  // wastepaper basket. The answer was to ask the question as each piece goes down
  // rather than once at the end, which is what the furniture editor does on a drop
  // (`reachFault`). So the room keeps its plan *and* its bin, and the check at the
  // end has nothing left to find.
  const office = generateOffice('sweep-409');
  assert.equal(office.report.ok, true, office.report.faults.join('; '));
  assert.equal(office.report.attempts.length, 1, 'it needed a second attempt');
  assert.ok(Object.keys(office.layout.stations).includes('bin'), 'the bin was dropped after all');

  // And across the sweep, nobody is ever stranded — the fault exists, it is
  // checked for, and it does not happen. Which is a stronger statement than the
  // repair it replaced.
  for (const seed of seeds) {
    const faults = generateOffice(seed).report.attempts.flatMap((a) => a.faults);
    assert.ok(!faults.some((f) => f.includes('cannot be reached')),
      `${seed}: ${faults.join('; ')}`);
  }
});

test('mintSeed is the only unseeded draw, and it is readable', () => {
  const rolls = [0.1, 0.9, 0.5];
  let i = 0;
  const rng = () => rolls[i++ % rolls.length];
  assert.match(mintSeed(rng), /^[a-z]+-[a-z]+-\d{4}$/);
});
