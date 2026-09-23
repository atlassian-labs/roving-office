// Seed in, office out.
//
// `generateOffice('slate-orchard-2210')` hands back a whole room: a layout blob
// in the furniture editor's own v4 format, the season and building it should be
// dressed in, a name, and a sentence saying why it is arranged the way it is.
// The same seed always gives the same office, on this version of the generator,
// and any string at all is a seed.
//
// The stages are in the other files — `brief.js` decides what the office wants,
// `furnish.js` fits it onto the floor, `naming.js` says what came out. What lives
// here is the part that makes the whole thing usable rather than merely clever:
//
//   * **the check**, which is the room's own rules asked of the plan (every job
//     role present, everybody able to reach their standing spot, nothing on top
//     of anything else), and
//   * **the retry**, because a brief that does not fit is not an error. Fourteen
//     desks, three pods and a great library will not go onto 26 by 20, and the
//     useful response is the response a space planner has: take something out and
//     fit it again. Three attempts, each a deterministic degradation of the last,
//     and then a floor that is guaranteed to work.
//
// So `generateOffice` cannot fail and cannot return a broken room, which is what
// makes it safe to run on every new scene without anybody watching.

import { ROOM, DOOR } from '../config.js';
import {
  LAYOUT_VERSION, STATION_KINDS, JOB_ROLES, FURNITURE_KINDS, round2,
} from '../layout.js';
import { floorFault } from '../editor/placement.js';
import { seedText, mintSeed, streamFor } from './rng.js';
import { brief as briefFor } from './brief.js';
import { furnish } from './furnish.js';
import { nameFor, reasonFor, traitsOf } from './naming.js';
import { reachable, reached } from './reach.js';
import { score } from './score.js';

/**
 * A readable seed for a thing that already has an unreadable name.
 *
 * A scene's id is `scene-m8x2k1-7fa3`, which is a perfectly good seed and a
 * terrible thing to show anybody or type into another room. This turns it into
 * one of the word-pair seeds `mintSeed` produces — deterministically, so the
 * scene's office is still the scene's office, and legibly, so it can be read out,
 * shared, and typed in somewhere else to get the same room.
 */
export function seedFor(key) {
  const s = streamFor(String(key), 'seed');
  return mintSeed(() => s.float());
}

/**
 * The layout blob, in the format `applyLayout()` reads and the editor exports.
 *
 * Version 4, complete, and keyed by id exactly as `layoutSnapshot()` would write
 * it — with two additions that ride along inside it:
 *
 *   * `name` is already a convention here (`src/editor/layouts.js` writes the
 *     name of a saved layout into its own blob), so a generated office arrives
 *     already called something.
 *   * `seed` and `reason` are new, and they are the whole point of a *generated*
 *     room: the seed is what makes it reproducible and the reason is what makes
 *     it explicable. Both are ignored by `applyLayout`, which reads the families
 *     it knows and forgives everything else, and both are kept by the office
 *     store, which treats a layout as opaque.
 *
 * One difference from `layoutSnapshot()`, and it is deliberate: `standing` is
 * written on **every** desk rather than only on the ones that are. A snapshot may
 * leave it off, because it describes the room it was taken from; a generated blob
 * is applied *onto* another room, and `applyLayout` reads `standing` only where a
 * blob mentions it — so a silent blob would leave whatever desk happened to be a
 * sit-stand desk before still standing on a T-frame.
 */
function toBlob({ seed, name, reason, built }) {
  const desks = {};
  for (const d of built.desks) {
    desks[d.id] = {
      x: round2(d.x), z: round2(d.z), facing: round2(d.facing), standing: !!d.standing,
    };
  }

  const stations = {};
  for (const s of built.stations) {
    stations[s.id] = {
      kind: s.kind, x: round2(s.x), z: round2(s.z), facing: round2(s.facing),
    };
  }

  const furniture = {};
  for (const f of built.furniture) {
    const def = FURNITURE_KINDS[f.kind];
    furniture[f.id] = {
      kind: f.kind,
      x: round2(f.x),
      z: round2(f.z),
      // A heading only where the piece has a front, and a colour only where the
      // kind comes in colours — the same two rules `layoutSnapshot()` follows, so
      // a generated blob reads like an exported one.
      ...(def?.turns ? { facing: round2(f.facing ?? 0) } : {}),
      ...(def?.palette ? { color: f.color ?? null } : {}),
    };
  }

  const plants = {};
  for (const p of built.plants) {
    plants[p.id] = {
      kind: p.kind,
      x: round2(p.x),
      z: round2(p.z),
      facing: 0,
      scale: round2(p.scale),
      seasonal: !!p.seasonal,
    };
  }

  return {
    layout: LAYOUT_VERSION,
    complete: true,
    name,
    seed,
    reason,
    desks,
    stations,
    furniture,
    decor: {},
    plants,
    channels: { courier: !!built.courier },
  };
}

/**
 * Is this a room the office can actually work in?
 *
 * Three questions, and all three are the room's own rules rather than the
 * generator's opinion of itself:
 *
 *   1. **Somewhere to do every job.** `JOB_ROLES` is the list the furniture editor
 *      refuses to let you delete your way past, read here from the same table —
 *      so a plan that cannot say who is in, cannot take work in, cannot look
 *      anything up or cannot get work out is refused for the same reason a person
 *      would be stopped from making one. This is the one that fires: a wall can
 *      genuinely fill up, and then the brief is trimmed and refitted.
 *   2. **Nothing on top of anything else**, which the placement guarantees
 *      rectangle by rectangle, checked anyway: it costs one pass and it is the
 *      difference between trusting the search and knowing.
 *   3. **Everybody can get to their own standing spot**, from just inside the
 *      door.
 *
 * The third used to be the interesting one — a couch and a bank of desks that
 * each fit perfectly well could between them fence off the corner the water
 * cooler is in, and no local rule could see it coming. It is now checked *as
 * every piece goes down* (`Floor.strands`, the same refusal the editor makes on a
 * drop), so nothing can create a stranding after the fact and this cannot fail.
 * It stays because "cannot fail" is a claim, and a claim about a room is worth one
 * flood fill: across three thousand seeds it has not fired since the placement
 * gate went in, which is the evidence for the claim rather than a substitute for
 * it.
 */
export function validate(built) {
  const faults = [];
  if (!built.desks.length) faults.push('no desks');

  const roles = new Set();
  for (const s of built.stations) {
    for (const role of STATION_KINDS[s.kind]?.roles ?? []) roles.add(role);
  }
  for (const role of JOB_ROLES) {
    if (!roles.has(role)) faults.push(`nowhere to ${role}`);
  }

  const props = built.floor.rects.filter((r) => r.role === 'prop');
  for (const rect of props) {
    const fault = floorFault(rect.key, props, ROOM);
    if (fault) faults.push(`${rect.key}: ${fault.why}`);
  }

  const seen = reachable(props, DOOR.inside);
  for (const spot of built.floor.approaches) {
    if (!reached(seen, spot.at.x, spot.at.z)) faults.push(`${spot.label} cannot be reached`);
  }

  return { ok: faults.length === 0, faults };
}

/**
 * The brief with something taken out of it, for another go at the same floor.
 *
 * What comes out, in this order: desks first, because they are what the room runs
 * out of room for; then the planting, which is the cheapest thing to lose; then
 * the second couch. Deterministic, so an office that needed two attempts needs
 * exactly two attempts every time.
 */
function trim(brief, attempt) {
  const desks = Math.max(2, Math.round(brief.desks * (attempt === 1 ? 0.7 : 0.5)));
  const teams = [];
  let left = desks;
  for (const size of brief.teams) {
    if (left <= 0) break;
    const take = Math.min(size, left);
    teams.push(take);
    left -= take;
  }
  if (left > 0) teams.push(left);
  return {
    ...brief,
    desks,
    teams,
    planting: { ...brief.planting, count: Math.max(0, brief.planting.count - 2 * attempt) },
    lounge: attempt > 1
      ? { ...brief.lounge, couches: Math.min(1, brief.lounge.couches), armchairs: 0 }
      : brief.lounge,
    rugs: attempt > 1 ? Math.min(1, brief.rugs) : brief.rugs,
  };
}

/**
 * The room a seed always falls back to.
 *
 * Small, plain and impossible not to fit: three desks in a row, a post box, a
 * shelf, a coat stand and a bin. Nothing here has ever been needed by a seed in
 * the sweep (`npm run plan -- --sweep`), and it exists so that `generateOffice`
 * can promise a working room rather than promising one usually.
 */
function fallbackBrief(brief) {
  return {
    ...brief,
    desks: 3,
    teams: [3],
    typology: 'rows',
    standing: 1,
    post: { ...brief.post, key: 'post-room', mailboxes: 1, printers: 0, inboxes: 0, courier: true },
    research: { ...brief.research, key: 'reference', bookshelves: 1, telescope: false },
    refresh: { key: 'coffee', label: 'coffee only', coffee: true, cooler: false },
    lounge: { key: 'none', label: 'no lounge', couches: 0, armchairs: 0, tables: 0, lamps: 0 },
    planting: { key: 'spare', count: 1 },
    rugs: 0,
    bin: true,
  };
}

/**
 * Generate an office.
 *
 * @param {string|number} [input]  any seed; a fresh readable one is minted if
 *   nothing is given, which is the only non-deterministic thing in this module
 * @returns {{seed: string, name: string, reason: string,
 *   look: {season: string, building: string}, layout: object, report: object}}
 */
export function generateOffice(input) {
  const seed = seedText(input) ?? mintSeed();
  const first = briefFor(seed);

  const attempts = [];
  let brief = first;
  let built = null;
  let check = null;

  for (let attempt = 0; attempt <= 3; attempt += 1) {
    if (attempt === 3) brief = fallbackBrief(first);
    else if (attempt > 0) brief = trim(first, attempt);
    built = { ...furnish(brief), courier: brief.post.courier };
    check = validate(built);
    attempts.push({ attempt, desks: built.desks.length, faults: check.faults });
    if (check.ok) break;
  }

  const traits = traitsOf(brief, built);
  const name = nameFor(brief, traits);
  const reason = reasonFor(brief, traits);

  return {
    seed,
    name,
    reason,
    // The season and the building, which between them are the room's palette,
    // its floor finish, its light and what is outside its windows. Stored beside
    // the layout as a scene's `look`, exactly as a rolled scene's is.
    look: { season: brief.scheme.season, building: brief.scheme.building },
    layout: toBlob({ seed, name, reason, built }),
    /** What happened, for the CLI, the tests and anybody debugging a seed. */
    report: {
      ok: check.ok,
      faults: check.faults,
      // How good the room is, as against whether it works — see src/plan/score.js
      // for why the two are different questions and why only the second is a gate.
      score: score(built),
      attempts,
      brief,
      traits,
      fit: built.fit,
      plan: {
        axis: built.plan.axis,
        at: round2(built.plan.at),
        street: built.plan.street,
        avenue: built.plan.avenue,
        work: built.plan.work,
      },
      // The rectangles the plan settled on, for the plan-view drawings.
      rects: built.floor.rects,
      approaches: built.floor.approaches,
    },
  };
}

/**
 * The office a *thing* should have: a scene, an office, anything with an id.
 *
 * The seed is derived from the key rather than minted, which is what makes this
 * safe to call from more than one place at once. Two tabs opening the same new
 * scene at the same instant generate the same office and race to store an
 * identical blob — the same reasoning that lets a scene's look be rolled in the
 * browser (see `adopt()` in src/office/office.js), except that here the two
 * cannot even differ.
 */
export function officeFor(key) {
  return generateOffice(seedFor(key));
}
