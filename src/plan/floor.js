// The floor plate: what floor there is, what is on it, and which stretches of it
// are not floor to build on but floor to walk on.
//
// One data structure does the whole job, and it is the one the editor already
// uses to judge a drop: a list of rectangles, each named after what it came
// from. Three kinds go in:
//
//   * **footprints** — a prop's own blocked floor, on the world's axes
//     (`worldExtent` in src/layout.js, shared so this cannot disagree with the
//     nav grid about how much room a turned couch takes);
//   * **standing room** — the strip between a prop and the spot its user stands
//     on, reserved so that nothing later gets put in front of the coffee
//     machine;
//   * **circulation** — the entrance avenue and the street, reserved before
//     anything is placed at all.
//
// Nothing distinguishes them once they are in the list, which is the point: a
// candidate position is judged by `floorFault()` — the editor's own arithmetic,
// not a second copy of it — and the only question it ever asks is whether this
// rectangle is on the floor and clear of every other. Circulation is therefore
// not a special case anywhere in the generator. It is a piece of floor that
// something is already using.
//
// Why reserve circulation up front rather than check reachability at the end:
// a room can be laid out perfectly well and then fail one flood fill, and at
// that point there is nothing useful to do but throw it away and roll again.
// Reserving the walking lanes first means the aisles exist by construction and
// the flood fill is a *check*, which is how it is used — see `validate()` in
// src/plan/index.js and the nav-grid sweep in test/plan-generator.test.js.

import { ROOM, DOOR, windowSpan } from '../config.js';
import { worldExtent, LAYOUT_MARGIN, DESK_BODY, round2 } from '../layout.js';
import { ramp } from '../measure.js';
import { floorFault, candidates } from '../editor/placement.js';
import { STAND_MARGIN, reachable, reached } from './reach.js';

/**
 * How much of the floor a prop may not be placed on, at each boundary.
 *
 * The two real walls have an inner face at `wallT / 2`, and a prop's back should
 * stand a hair off the plaster rather than in it — 0.2 is what the authored
 * printer and bin were measured to. The two cutaway edges have no wall to stand
 * off, only the edge of the world, so they take a smaller margin: the authored
 * room puts the inbox and the couch out there on purpose, and the room would
 * look boxed in if nothing could.
 */
export const WALL_FACE = ROOM.wallT / 2;
const WALL_GAP = 0.15;
const EDGE_GAP = 0.1;

/**
 * The lane people walk in, in world units across.
 *
 * Space planning calls this width a street and gives it 150–240 cm, against the
 * 90–105 cm it allows a secondary aisle behind a chair. This room is not in
 * metres, but a person here is about 0.9 across (`AGENT_RADIUS` doubled) and
 * walks four-connected on a 0.5 grid, so a lane wants two clear cells at the
 * very least and three to be a lane rather than a squeeze.
 */
export const STREET_W = 2.4;

/**
 * How far out in front of a desk its occupant stands.
 *
 * Not a choice: `buildDesk` puts a desk's approach point at `SEAT_LOCAL_Z + 1.9`
 * along its own axis, and that is where the agent layer walks to. Written down
 * here because the *plan* has to leave that floor clear, and a bench whose
 * standing room lands inside the next bench is a bench nobody can sit at.
 */
export const DESK_APPROACH = 3.5;

/**
 * How much room a desk is *planned* around — which is not the floor it occupies.
 *
 * `DESK_BODY` (src/layout.js) is the measured footprint: 2.03 by 1.6, centred 0.62
 * back because of the chair. These are wider and shallower on purpose, and the
 * difference is the same one that runs through this whole file. A footprint answers
 * "what floor does this take", and it decides what may stand next to what. These
 * answer "where could a desk go, with room to work at it", and they decide the
 * candidate lattice and how many desks a bank holds (`bankCapacity`).
 *
 * Setting them to the measured body was tried and is wrong: a narrower desk fits
 * more of them into a run, so teams were cut into differently sized banks and
 * seventeen rooms in two hundred and forty ended up seating a team apart from
 * itself. A desk needs elbow room whether or not its neighbour's rectangle starts
 * there, and this pair is where that is written down.
 *
 * The claim itself uses the body, so a plan and the editor still describe the same
 * floor — see `layDesks` in furnish.js, which passes `DESK_BODY` to `probe`.
 */
export const DESK_HW = 2.5;
export const DESK_HD = 1.4;

export { DESK_BODY };

/** Room for one body, for the strip in front of a prop and the spot at the end of it. */
const BODY = 0.5;

/**
 * Two decimal places — the precision the layout is authored, exported and stored
 * to. The store's own rounding, re-exported from src/layout.js rather than
 * restated, because a generator that snapped to a different grid from the one the
 * blob is written on is the bug below waiting to happen again.
 *
 * Every position is snapped to it *here*, as a prop is placed, rather than on the
 * way out into the blob. It has to be this way round, and the bug that says so is
 * worth keeping: a plant placed at a scale of 1.6284 was written out as 1.63,
 * which grew its spread by three millimetres — enough that the desk beside it,
 * whose own position had rounded the other way, overlapped it by a hair. The plan
 * that was checked and the plan that was stored were not the same plan.
 *
 * So the rule is that the generator only ever reasons about numbers the blob can
 * carry exactly. Nothing downstream has to round anything, and what
 * `validate()` proves about a layout is true of the layout that gets stored.
 */
export { round2 };

/** A rectangle from a centre and half-extents, in the shape `floorFault` wants. */
export function rectOf(key, x, z, hw, hd, { soft = false } = {}) {
  return {
    key, x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd, soft,
  };
}

/** Does this point sit inside this rectangle? */
export function inRect(r, x, z) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** The middle of a rectangle. */
export function middle(r) {
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}

/**
 * The unit vector a heading points along — the same `heading()` src/layout.js
 * derives every approach point from.
 */
export function heading(facing) {
  return { x: Math.sin(facing), z: Math.cos(facing) };
}

/**
 * The four sides of the room a prop can stand against, and which way it faces
 * when it does.
 *
 * Two of them are walls and two are the open edges of the cutaway, and the
 * difference matters only for how close a prop may get (see the margins above)
 * — a prop against an open edge is still a prop with its back to the outside
 * and its front to the room, which is what `facing` means here.
 *
 * `facing` is the heading from the prop to its own standing room, because that
 * is what `facing` means everywhere in the layout: a station looks at the floor
 * its user stands on. Quarter turns exactly, so `squareUp()` on the way back in
 * has nothing to correct.
 */
export const SIDES = {
  back: { axis: 'z', at: 0, facing: 0, wall: true, label: 'the back wall' },
  left: { axis: 'x', at: 0, facing: Math.PI / 2, wall: true, label: 'the left wall' },
  front: { axis: 'z', at: ROOM.D, facing: Math.PI, wall: false, label: 'the open edge' },
  right: { axis: 'x', at: ROOM.W, facing: -Math.PI / 2, wall: false, label: 'the open edge' },
};

/**
 * Where a prop's centre goes if it is to stand against this side.
 *
 * @param {string} side  a key of SIDES
 * @param {number} hd  the prop's half-depth once turned into the world (i.e. after
 *   `worldExtent`), measured along the side's own normal
 */
export function standoff(side, hd) {
  const s = SIDES[side];
  const gap = s.wall ? WALL_FACE + WALL_GAP : EDGE_GAP;
  const at = s.at === 0 ? hd + gap : s.at - hd - gap;
  // No closer to any boundary than `applyLayout` will keep it. A small prop
  // against an open edge — a bin, a plant — wants to stand 0.6 from the world's
  // edge and would be pulled back to 0.8 on import, which is a prop somewhere
  // other than where the plan put it. Better to plan it where it will end up.
  return Math.min(ROOM.W - LAYOUT_MARGIN, Math.max(LAYOUT_MARGIN, at));
}

/**
 * The stretch of floor the entrance owns.
 *
 * Everybody who ever comes into this room walks through it, and the room has
 * already written down that nobody may loiter there: `randomInteriorPoint`
 * refuses to let a wanderer stop within `DOORWAY_DEPTH` of the opening,
 * ±(`DOOR_HALF` + 0.8). Those are the numbers, taken from the agent layer rather
 * than guessed, and the reason the bin was moved out of this rectangle in
 * A prop in here is a prop the door swings into and every arrival has
 * to get past.
 */
export const DOORWAY_DEPTH = 4.0;
const DOOR_KEEP_HALF = 1.2 + 0.8;

export function doorApron() {
  return rectOf('way:door', DOOR.x, DOORWAY_DEPTH / 2, DOOR_KEEP_HALF, DOORWAY_DEPTH / 2);
}

/**
 * What a rectangle on the floor *is*. Three roles, and the reason there are
 * three rather than one flat list of obstacles is a mistake worth not making.
 *
 * The obvious design — reserve the street, then refuse any prop that overlaps it
 * — forbids the single most useful arrangement in the room: a bench of desks
 * along a street, with the street doing duty as the standing room behind the
 * chairs. That is not a conflict, it is what a street is *for*. So a rectangle
 * says which kind of claim it is, and the two rules are:
 *
 *   * a **prop** may not overlap a prop, a way, or somebody's standing room;
 *   * **standing room** may not overlap a prop, and may overlap anything else.
 *
 * Which reads as: build nothing in the aisles, and stand wherever there is floor.
 */
const PROP = 'prop';
const WAY = 'way';
const STAND = 'stand';

/** What a prop's own footprint must keep clear of. */
const FOR_PROP = new Set([PROP, WAY, STAND]);
/** What somebody's standing room must keep clear of. */
const FOR_STAND = new Set([PROP]);

/** The three roles, for anything that reads a plan rather than builds one. */
export const ROLES = { PROP, WAY, STAND };

/**
 * The floor a prop at this position comes to: its own footprint, the strip out to
 * where its user stands, and the spot itself.
 *
 * Geometry only — nothing here asks whether the position is any good. That is what
 * makes it shared: `Floor.probe()` below is this plus the three refusals, and
 * `survey()` (src/plan/survey.js) is this over a room that already exists, so a
 * drawing of a hand-made layout is measured exactly as a generated one was.
 *
 * @param {string} key  as the editor keys its groups: `station:coffee`, `desk:desk-2`
 * @param {{x: number, z: number, facing: number}} want
 * @param {{hw: number, hd: number, offX?: number, offZ?: number, approach?: ?number,
 *   soft?: boolean, label?: string}} size
 *   `hw`/`hd` in the prop's own axes and `offX`/`offZ` where its geometry sits
 *   relative to its origin — the kind tables in src/layout.js carry all four, and
 *   they are measured (see `BODIES` there). `approach` is how far out its user
 *   stands, or null for a prop nobody walks to (the coat stand, a plant, a rug)
 */
export function claimOf(key, want, {
  hw, hd, offX = 0, offZ = 0, approach = null, soft = false, label = key,
}) {
  // Snapped to authoring precision before anything is measured against it: see
  // `round2` above for the hairline overlap that taught this.
  const at = { ...want, x: round2(want.x), z: round2(want.z) };
  const world = worldExtent(at.facing, hw, hd);
  const dir = heading(at.facing);
  // Where the body sits, which for several props is not on the origin: a couch's
  // seat is a third of a unit behind it, a desk's chair 0.62 back. Local +z is the
  // way the prop looks, so `offZ` runs along `dir` and `offX` across it.
  const across = { x: dir.z, z: -dir.x };
  const body = {
    x: at.x + dir.x * offZ + across.x * offX,
    z: at.z + dir.z * offZ + across.z * offX,
  };
  const foot = {
    ...rectOf(key, body.x, body.z, world.hw, world.hd, { soft }), role: PROP,
  };
  if (approach == null) return { at, foot, strip: null, spot: null, label };

  const spot = { x: at.x + dir.x * approach, z: at.z + dir.z * approach };
  // The floor between the prop's front and the spot, plus a body's width past
  // it: standing room is somewhere to stand *and* the way in to it.
  //
  // Measured from the body's own front face rather than from `hd`, which are the
  // same thing only for a prop built around its origin. A couch's front face is at
  // 0.24 and not at 0.57, so a strip starting at 0.57 would leave a third of a unit
  // of floor belonging to neither the couch nor the way in to it — and a desk's
  // chair reaches 2.22 back, so a strip starting at 1.6 would run through it.
  const near = offZ + hd;
  const far = approach + BODY;
  const size = worldExtent(at.facing, Math.max(hw, BODY), Math.max(0, (far - near) / 2));
  const mid = (far + near) / 2;
  const strip = {
    ...rectOf(
      `stand:${key}`,
      at.x + dir.x * mid + across.x * offX,
      at.z + dir.z * mid + across.z * offX,
      size.hw,
      size.hd,
    ),
    role: STAND,
  };
  return { at, foot, strip, spot, label };
}

/** Is this somewhere `applyLayout` will leave a prop's centre where it is put? */
export function inMargin(at) {
  return at.x >= LAYOUT_MARGIN && at.z >= LAYOUT_MARGIN
    && at.x <= ROOM.W - LAYOUT_MARGIN && at.z <= ROOM.D - LAYOUT_MARGIN;
}

/** Is this a spot the nav grid would let somebody stand on? */
export function standable(spot) {
  return spot.x >= STAND_MARGIN && spot.z >= STAND_MARGIN
    && spot.x <= ROOM.W - STAND_MARGIN && spot.z <= ROOM.D - STAND_MARGIN;
}

/**
 * The floor as it is being laid out: every rectangle claimed so far, and the two
 * questions anybody asks of it.
 */
export class Floor {
  constructor() {
    /** @type {{key: string, role: string, x0: number, z0: number, x1: number, z1: number, soft: boolean}[]} */
    this.rects = [{ ...doorApron(), role: WAY }];
    /** Standing spots that must stay walkable, for the reachability check later. */
    this.approaches = [];
    /**
     * The rectangles a candidate is compared against, per role set, kept between
     * calls.
     *
     * Placement is a scan — a few thousand candidate positions for every piece in
     * the room — and each candidate asks the same two questions of the same
     * arrays. Building those arrays per question is the whole cost of the
     * generator: filtering and copying sixty rectangles a few tens of thousands of
     * times took an office from six milliseconds to fifty. So the arrays are built
     * once per role set and thrown away whenever something is committed, and the
     * candidate is pushed and popped around the one call that needs it.
     */
    this._lists = new Map();
  }

  /** The rectangles of these roles, as one array, cached until the floor changes. */
  _listFor(roles) {
    const key = [...roles].sort().join(',');
    let list = this._lists.get(key);
    if (!list) {
      list = this.rects.filter((r) => roles.has(r.role));
      this._lists.set(key, list);
    }
    return list;
  }

  /**
   * Is this rectangle on the floor and clear of what its role has to be clear of?
   *
   * Straight to `floorFault`, which reports only faults involving the key it is
   * given — so the candidate is compared against everything already claimed and
   * nothing already claimed is compared against anything else. A room mid-layout
   * has no pre-existing faults anyway, but borrowing the editor's function rather
   * than writing the loop again means "on the floor and out of the way" has one
   * definition in this codebase, and the bounds check comes along with it: a
   * standing spot off the edge of the floor is a spot nobody can stand on, and it
   * is refused here without a rule of its own.
   */
  fits(rect, roles = FOR_PROP) {
    const list = this._listFor(roles);
    list.push(rect);
    const fault = floorFault(rect.key, list, ROOM);
    list.pop();
    return fault === null;
  }

  /** Is this point clear of everything that blocks? (A soft rug does not.) */
  clear(x, z) {
    return !this.rects.some((r) => r.role === PROP && !r.soft && inRect(r, x, z));
  }

  /**
   * Whether this position is one the piece could take, and what it would come to.
   *
   * The geometry is `claimOf()` above; what this adds is the three refusals — the
   * footprint has to be on the floor and out of everything's way, the standing
   * room has to be clear of the props, and the standing spot has to be somewhere
   * the nav grid would let a person stand.
   *
   * Nothing is committed: every placement in the generator is a search, which
   * scores a few hundred of these and throws the rest away.
   */
  probe(key, want, size) {
    const claim = claimOf(key, want, size);
    // Where `applyLayout` would keep it, or nowhere. Import clamps a prop's centre
    // into the room by `LAYOUT_MARGIN`, so a plan that puts one outside that is a
    // plan the room will quietly rearrange — which is how the generator and the
    // stored layout came to disagree about a plant in the corner.
    //
    // Here rather than in `claimOf`, because `claimOf` is geometry and this is a
    // rule about placement: a survey of a room somebody laid out by hand has to
    // describe the prop where it actually is, margin or no margin.
    if (!inMargin(claim.at)) return null;
    if (!this.fits(claim.foot)) return null;
    if (!claim.strip) return claim;
    // Off the walls, because the nav grid keeps walkers off them: a spot inside
    // `STAND_MARGIN` of any boundary is a spot nobody can stand on however clear
    // the floor around it looks, and a station whose standing room is in the wall
    // is a station nobody can ever use. This is the one rule in the generator that
    // the rectangles cannot express — the floor is there, it just cannot be stood
    // on — so it is checked point-wise rather than as another footprint.
    if (!standable(claim.spot)) return null;
    if (!this.fits(claim.strip, FOR_STAND)) return null;
    return claim;
  }

  /** Take a probe's floor for good. */
  commit(probe) {
    if (!probe) return null;
    this.rects.push(probe.foot);
    if (probe.strip) this.rects.push(probe.strip);
    if (probe.spot) this.approaches.push({ label: probe.label, at: probe.spot });
    this._lists.clear();
    return probe;
  }

  /**
   * Take a prop back off the floor: its footprint, its standing room and its
   * standing spot.
   *
   * For the one repair the generator makes. A prop can only ever be *dropped*
   * because the room cannot reach it, and dropping it can only free floor — so
   * nothing else that was placed has to be reconsidered, which is what makes a
   * single pass sound (see `generateOffice`).
   */
  drop(key) {
    const before = this.rects.length;
    this.rects = this.rects.filter((r) => r.key !== key && r.key !== `stand:${key}`);
    const label = key.slice(key.indexOf(':') + 1);
    this.approaches = this.approaches.filter((a) => a.label !== label);
    this._lists.clear();
    return this.rects.length < before;
  }

  /**
   * Would putting this here leave somebody unable to get to where they stand?
   *
   * The question `reachFault` asks in the furniture editor, asked of a candidate
   * before it is committed — and the one question the rectangles cannot answer.
   * A prop that overlaps nothing can still seal the only way into the corridor
   * behind a bank of desks, which is how four seeds in two thousand came to
   * produce a room with three desks nobody could sit at: a bookshelf went into
   * the gap at the end of the run, and the run's standing room became a pocket.
   *
   * One flood fill, and only for the handful of candidates a scan actually wants
   * (see `put()` in furnish.js) — not for the few thousand it scores.
   *
   * Takes one claim or several, and a bank of desks passes several: they go down
   * as one piece, and two desks that each leave a way through can between them
   * close the only one.
   *
   * @param {object|object[]} claims  from `probe()` or `claimOf()`
   */
  strands(claims) {
    const list = Array.isArray(claims) ? claims : [claims];
    const props = this.rects.filter((r) => r.role === PROP && !r.soft);
    const seen = reachable([...props, ...list.map((c) => c.foot)], DOOR.inside);
    for (const claim of list) {
      if (claim.spot && !reached(seen, claim.spot.x, claim.spot.z)) return true;
    }
    return this.approaches.some((a) => !reached(seen, a.at.x, a.at.z));
  }

  /**
   * Reserve floor nothing may be built on — a street, an avenue, the apron in
   * front of a bank of desks.
   */
  reserve(key, rect) {
    this.rects.push({ ...rect, key, role: WAY });
    this._lists.clear();
    return rect;
  }

  /** How far this point is from the nearest thing whose key starts like this. */
  distanceTo(prefix, x, z) {
    let best = Infinity;
    for (const r of this.rects) {
      if (!r.key.startsWith(prefix)) continue;
      const mx = Math.max(r.x0 - x, 0, x - r.x1);
      const mz = Math.max(r.z0 - z, 0, z - r.z1);
      best = Math.min(best, Math.hypot(mx, mz));
    }
    return best;
  }
}

/**
 * The circulation skeleton: the avenue in from the door, and the one street it
 * runs into.
 *
 * A street rather than a network, because this is one room of 26 by 20 with a
 * single door in it. Circulation planning wants primary paths carrying traffic
 * between the entry, the desks and the amenities without slicing through the
 * focus zone, and in a room this size that is one lane and the lane in from the
 * door — anything more elaborate would be corridors drawn for their own sake in
 * a space you can see across.
 *
 * The street's axis is the room's `grain` from the brief, and its position is
 * drawn from the range that leaves a usable block on both sides. Which side of
 * it the desks go on is decided here too, and by the rule the research is
 * clearest about: **the quiet end is the end without the door in it.** An office
 * whose desks sit between the entrance and everything else is an office where
 * every arrival, every coffee and every parcel walks through the focus zone.
 *
 * @param {object} brief
 * @param {import('./rng.js').Stream} stream
 */
export function plate(brief, stream) {
  const axis = brief.grain;
  const span = axis === 'x' ? ROOM.D : ROOM.W;   // the axis the street sits *along*
  // Leave at least this much block on either side: a desk bank plus its standing
  // room is 1.4 + 3.5, so a side that cannot hold that is not a side worth having.
  const edge = 5.2;
  const at = stream.range(edge, span - edge);
  const half = STREET_W / 2;

  const street = axis === 'x'
    // A band across the room, at z = at.
    ? rectOf('way:street', ROOM.W / 2, at, ROOM.W / 2, half)
    // A band down the room, at x = at.
    : rectOf('way:street', at, ROOM.D / 2, half, ROOM.D / 2);

  // The avenue in from the door, reaching the street. It is the door apron
  // stretched: the apron is what nobody may stand in, this is what nobody may
  // *build* in, and where the street is beyond the apron the two join up.
  const avenueTo = axis === 'x' ? Math.max(DOORWAY_DEPTH, at + half) : DOORWAY_DEPTH;
  const avenue = rectOf('way:avenue', DOOR.x, avenueTo / 2, DOOR_KEEP_HALF, avenueTo / 2);

  // The two blocks the street leaves, near side and far side of it.
  const near = axis === 'x'
    ? rectOf('block:near', ROOM.W / 2, (at - half) / 2, ROOM.W / 2, (at - half) / 2)
    : rectOf('block:near', (at - half) / 2, ROOM.D / 2, (at - half) / 2, ROOM.D / 2);
  const far = axis === 'x'
    ? rectOf('block:far', ROOM.W / 2, (at + half + ROOM.D) / 2, ROOM.W / 2, (ROOM.D - at - half) / 2)
    : rectOf('block:far', (at + half + ROOM.W) / 2, ROOM.D / 2, (ROOM.W - at - half) / 2, ROOM.D / 2);

  // Which block has the door in it. `near` is always the side towards the
  // origin, and the door stands at x 3.4 in the z = 0 wall — so for a street
  // across the room the door is always in `near`, and for one down the room it
  // depends on where the street landed.
  const doorInNear = axis === 'x' ? true : DOOR.x < at;
  const doorSide = doorInNear ? near : far;
  const quietSide = doorInNear ? far : near;

  // **Which block the desks get: quiet against daylight, rather than quiet alone.**
  //
  // This one line was most of why `daylight` sat at 0.50 while every other measure
  // of the plan was above 0.85. The door stands at x 3.4 in the z = 0 wall and two
  // of the room's three window openings are in that same wall, so "desks away from
  // the entrance traffic" points at precisely the block "desks get the light"
  // points away from — and this choice had no daylight term at all. Every
  // arrangement inherited it, which is why all five scored within 0.10.
  //
  // Quiet is worth a point and a fully lit block is worth a little more, which is
  // deliberately close: at 2.2x the desks moved onto the door side wholesale and
  // walking through the furniture got worse (`clear` 0.9299 against a 0.9432
  // floor). The room still prefers the quiet side; it will now give it up for a
  // window rather than never.
  const area = (r) => (r.x1 - r.x0) * (r.z1 - r.z0);
  const lit = (r) => {
    let sum = 0;
    let n = 0;
    for (let x = r.x0 + 1; x < r.x1; x += 2) {
      for (let z = r.z0 + 1; z < r.z1; z += 2) {
        sum += daylight({ x, z });
        n += 1;
      }
    }
    return n ? sum / n : 0;
  };
  const worth = (r) => (r === quietSide ? 1 : 0) + 1.8 * lit(r);
  const fits = [near, far].filter((r) => area(r) >= 90);
  const work = fits.length
    ? fits.reduce((a, b) => (worth(b) > worth(a) ? b : a))
    : (area(quietSide) >= 90 ? quietSide : doorSide);
  const support = work === near ? far : near;

  return {
    axis, at, street, avenue, near, far, work, support,
    /** Every stretch of floor that is there to be walked on. */
    ways: [street, avenue],
  };
}

/**
 * How far a point is from the nearest window *opening*.
 *
 * To the opening's own span, so a spot beside the glass counts as beside the glass
 * and one behind the pier between two windows does not: the back wall carries two
 * openings and the left wall one, and the stretches of plaster between them are
 * not daylight.
 */
function toGlass(at) {
  let best = Infinity;
  for (const win of windows()) {
    const along = win.axis === 'x' ? at.x : at.z;
    const across = win.axis === 'x' ? at.z : at.x;
    const off = Math.max(win.from - along, 0, along - win.to);
    best = Math.min(best, Math.hypot(off, across));
  }
  return best;
}

// Full marks within `LIT` of the glass, nothing at `UNLIT` or beyond.
const LIT = 4;
const UNLIT = 12;

/**
 * How much daylight a point on this floor gets, 0 to 1.
 *
 * The one statement of the curve, because three different places need it and they
 * must agree: the scorecard measures `daylight` with it (src/plan/score.js), the
 * desk-placement rule scores banks with it (`deskScore` in src/plan/furnish.js),
 * and `plate()` above picks which half of the room the desks get with it. The plan
 * therefore chooses against the number it is judged by rather than against an
 * approximation of it — and when this curve is retuned, all three move together
 * instead of two of them and whichever copy was remembered.
 *
 * A ramp rather than a count, because a count could never approach 1 — this room
 * has window frontage on two of its four sides, so "all the desks by a window" is
 * not a room that exists, and a measure whose best case is 0.4 is a measure nobody
 * can read. Full marks within four units of the glass, nothing beyond twelve,
 * which is most of the way across the floor.
 */
export function daylight(at) {
  return 1 - ramp(toGlass(at), LIT, UNLIT);
}

/**
 * Every position a prop of this size could stand at, against this side of the
 * room, in the order the seed wants to try them.
 *
 * The lattice is the editor's own `candidates()`, so the generator can only ever
 * put a prop where a person could have dragged it, and never anywhere the editor
 * would refuse as hanging off the floor. What this adds is the band: a station
 * against a wall is a station whose distance from that wall is decided by its own
 * depth and not by the search.
 *
 * @param {string} side  a key of SIDES
 * @param {{hw: number, hd: number}} extent  the prop's own half-extents
 * @param {number} [snap]
 */
export function alongSide(side, extent, snap = 0.5) {
  const s = SIDES[side];
  const world = worldExtent(s.facing, extent.hw, extent.hd);
  const fixed = standoff(side, world.hd);
  const out = [];
  const from = s.axis === 'z' ? { z: fixed } : { x: fixed };
  const along = s.axis === 'z' ? ROOM.W : ROOM.D;
  for (let v = snap; v <= along - snap; v += snap) {
    const at = s.axis === 'z' ? { x: v, ...from } : { ...from, z: v };
    if (at.x - world.hw < 0 || at.x + world.hw > ROOM.W) continue;
    if (at.z - world.hd < 0 || at.z + world.hd > ROOM.D) continue;
    out.push({ ...at, facing: s.facing, side });
  }
  return out;
}

/**
 * Every position and facing a prop could stand at anywhere on the floor.
 *
 * Straight through the editor's generator, which already refuses a position
 * where the piece would hang off the floor and offers the four quarter turns at
 * each one. Ordered nearest-first to `near`, which this ignores — the caller
 * scores every candidate anyway — but which costs nothing and keeps the two
 * callers of `candidates()` asking for the same thing.
 */
export function anywhere(extent, { turns = true, prefer = 0, snap = 0.5 } = {}) {
  return [...candidates({
    room: ROOM, snap, turns, prefer, extent, near: { x: ROOM.W / 2, z: ROOM.D / 2 },
  })];
}

/**
 * The window openings, as stretches of the side they are cut into.
 *
 * The basis of both things this file says about glass, and not exported itself
 * because nothing outside wants the raw openings: `atWindow` below answers the
 * question the props ask (a telescope is for looking out of a window, so a
 * telescope not at one is a prop somebody left in the middle of the room; a plant
 * in a window bay is a plant that gets some light) and `daylight` above answers
 * the one the desks ask.
 */
function windows() {
  const out = [];
  for (const [wall, side] of [['back', 'back'], ['left', 'left']]) {
    for (let i = 0; ; i += 1) {
      const span = windowSpan(wall, i);
      if (!span) break;
      out.push({ side, axis: span.axis, from: span.from, to: span.to, centre: span.centre });
    }
  }
  return out;
}

/** Is this position within one of the room's window openings? */
export function atWindow(pos) {
  return windows().some((w) => (w.axis === 'x'
    ? pos.z < 3 && pos.x > w.from && pos.x < w.to
    : pos.x < 3 && pos.z > w.from && pos.z < w.to));
}
