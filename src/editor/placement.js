// Where a new piece of furniture could go, and what the room already cannot reach.
//
// Both halves of the placement rules live here, and they are here rather than inside
// `createEditor` because both are arithmetic about a room rather than anything to do
// with a pointer, a camera or a panel — and because a bug of this shape wants a test
// that can ask the question directly instead of driving a stubbed browser.
//
// The editor owns the decisions; this owns the two answers it was getting wrong.

/**
 * Which standing places nobody can get to, in the room as it stands.
 *
 * This is the baseline a drop or an addition is judged against. `canBeReached` in the
 * editor used to report the first unreachable approach point it could find, whoever
 * owned it — so one prop stranded by an earlier edit was reported against every
 * position of everything anybody moved or added afterwards, and the editor refused
 * the lot with "Nowhere in the room to put that". Adding a *rug* failed, which is the
 * plainest possible sign the answer had nothing to do with the thing being added: a
 * rug's footprint is soft, so it blocks nothing and can strand nobody.
 *
 * Measured once at the start of a gesture, never per candidate position. The answer
 * is a property of the room *before* the change, and re-measuring it midway would fold
 * in whatever the change has just broken and then forgive it.
 *
 * @param {{label: string, at: {x: number, z: number}}[]} approaches
 * @param {{rebuild: () => void, walkableAt: (x: number, z: number) => boolean,
 *   reachableFrom: (p: {x: number, z: number}) => Uint8Array,
 *   reachedBy: (seen: Uint8Array, x: number, z: number) => boolean}} nav
 * @param {{x: number, z: number}} from  where everybody comes in, i.e. the doorway
 * @returns {Set<string>} the labels that cannot be reached
 */
export function strandedApproaches(approaches, nav, from) {
  const out = new Set();
  if (!approaches.length) return out;
  nav.rebuild();
  const reached = nav.reachableFrom(from);
  for (const a of approaches) {
    if (nav.walkableAt(a.at.x, a.at.z) && nav.reachedBy(reached, a.at.x, a.at.z)) continue;
    out.add(a.label);
  }
  return out;
}

/** The role a rectangle plays: somebody's way in, rather than a thing. */
const STAND = 'stand';

/**
 * Is this piece on the floor, and out of everything else's way?
 *
 * The cheap half of the verdict: rectangles only, no grid and no flood fill, so the
 * search for somewhere to put a new piece can run it on every candidate and only pay
 * for the expensive half on the handful that get through.
 *
 * Only faults involving `key` are reported. A room may well have a pre-existing overlap
 * somewhere, and refusing every drop because of it would make the editor useless — the
 * same reasoning the coplanar probe uses, where the pairs it already reports are noise
 * and a new one is the bug.
 *
 * **Two rectangles per prop, and they follow different rules.** A prop's `role` is
 * `'prop'` for the floor its own geometry stands on and `'stand'` for the floor
 * somebody needs in order to use it — the space in front of a printer to work at
 * it, or in front of a couch to sit down on it (`obstacleFootprints` in
 * src/layout.js builds both). What may overlap what is the whole point:
 *
 * | | another body | somebody's standing room |
 * |---|---|---|
 * | **a body** | refused | refused |
 * | **standing room** | refused | **allowed** |
 *
 * Two people's standing room overlapping is not a collision — it is two people
 * sharing the same bit of circulation — and that one cell of the table is what
 * lets **two printers stand side by side**, which is a thing offices do and this
 * editor used to refuse. A plant may go against the back of a couch for the same
 * reason: the couch's standing room is at its front, so its back and sides are
 * only body, and a body ends where the mesh ends.
 *
 * @param {string} key  the piece being placed
 * @param {{key: string, x0: number, z0: number, x1: number, z1: number, soft?: boolean,
 *   role?: string}[]} rects
 * @param {{W: number, D: number}} room
 * @returns {?{ok: boolean, why: string}} a fault, or null if there is none
 */
export function floorFault(key, rects, room) {
  const mine = rects.find((r) => r.key === key);
  if (!mine) return null;

  if (mine.x0 < 0 || mine.z0 < 0 || mine.x1 > room.W || mine.z1 > room.D) {
    return { ok: false, why: 'hanging off the floor' };
  }
  // Whose standing room is whose: `stand:station:printer` belongs to
  // `station:printer`, and a prop never blocks its own way in.
  const owner = (r) => (r.role === STAND ? r.key.slice('stand:'.length) : r.key);
  const owns = owner(mine);
  for (const other of rects) {
    if (other.key === key || owner(other) === owns) continue;
    // A soft rectangle is measured, not blocked, so nothing overlaps it and it overlaps
    // nothing: a rug goes *under* the desks, which is what a rug is for. The bounds
    // check above still applies to it — a rug half off the floor is a rug half off the
    // floor. It also means a rug can only ever fail these bounds, which is why a rug
    // that could not be added was always the room's fault and never the rug's.
    if (mine.soft || other.soft) continue;
    // The one square of the table that says yes.
    if (mine.role === STAND && other.role === STAND) continue;
    if (mine.x0 < other.x1 && mine.x1 > other.x0
      && mine.z0 < other.z1 && mine.z1 > other.z0) {
      return {
        ok: false,
        why: other.role === STAND
          ? `in the way of ${owner(other)}`
          : `overlapping ${other.key}`,
      };
    }
  }
  return null;
}

/**
 * Can everybody still get everywhere they need to?
 *
 * The expensive half: one flood fill from the doorway, tested against every standing
 * place in the room. This is what catches a piece that has walled the coffee machine
 * off without touching it, and it is worth the cost — it is the check that stops the
 * editor building a room the agents cannot work in.
 *
 * `stranded` is what keeps it honest. Anything named there could not be reached
 * *before* this change, so it is the room's existing problem and not this piece's.
 * Without that the first unreachable approach point was reported against every
 * candidate position of everything anybody added or moved, so a single prop stranded
 * by an earlier edit refused every edit after it — permanently, and while blaming
 * whatever was in hand at the time.
 *
 * A piece that is *itself* stranded can still be moved, for the same reason: refusing
 * would trap it exactly where it needs to be dragged out of.
 *
 * @param {object} opts
 * @param {string} opts.key  the piece being placed
 * @param {{label: string, at: {x: number, z: number}}[]} opts.approaches
 * @param {object} opts.nav  a grid, as `strandedApproaches` describes
 * @param {{x: number, z: number}} opts.from  the doorway
 * @param {Set<string>} [opts.stranded]  what could not be reached before this change
 * @param {boolean} [opts.soft]  whether this piece's own rectangle blocks nothing
 * @returns {?{ok: boolean, why: string}} a fault, or null if there is none
 */
export function reachFault({
  key, approaches, nav, from, stranded = new Set(), soft = false,
}) {
  // A piece whose rectangle does not block cannot change who can reach what, so there
  // is nothing here for it to fail and no reason to pay for a flood fill finding that
  // out. This is not an optimisation so much as the honest answer: the nav grid skips
  // soft rectangles when it is built, so the fill would be over the identical room.
  //
  // It matters most for exactly the piece that was worst affected. Every candidate
  // position for a rug clears the cheap half — soft, so only its bounds are checked —
  // so every one of them used to run a fill to re-answer an unchanging question:
  // 14244 fills, 611ms, against 27ms for saying so up front.
  if (soft) return null;

  nav.rebuild();

  // Its own standing room first, because that is the failure actually about the piece
  // in hand: a machine shoved into a corner with nowhere to stand in front of it is
  // unusable however open the rest of the room is.
  const own = approaches.find((a) => key.endsWith(`:${a.label}`) || key === a.label);
  if (own && !stranded.has(own.label) && !nav.walkableAt(own.at.x, own.at.z)) {
    return { ok: false, why: 'nowhere left to stand at it' };
  }

  const reached = nav.reachableFrom(from);
  for (const a of approaches) {
    if (stranded.has(a.label)) continue;
    if (!nav.reachedBy(reached, a.at.x, a.at.z)) {
      return { ok: false, why: `${a.label} can no longer be reached` };
    }
  }

  return null;
}

/**
 * Every position and facing worth trying for a piece, best first.
 *
 * Nearest the middle of the room first, because the middle is where you are looking: a
 * piece that arrives in view and next to nothing is the easiest thing to then drag
 * somewhere deliberate, and one that arrives tucked behind the couch reads as nothing
 * having happened. The whole floor is a candidate, sorted by distance, rather than the
 * floor within some radius.
 *
 * Facings in turn at each position, in the order `0, 90, 180, 270` from `prefer` — so a
 * piece that fits without turning is not turned, and one that only fits sideways is.
 * Only for a piece with a front: a floor lamp and a plant look the same from every
 * side, so four headings for one would be the same position tried four times.
 *
 * Three things this gets right that the version in `createEditor` did not:
 *
 * **`from` is tried before anything else.** One exact position, off the lattice if need
 * be. It is what makes "delete a desk, add a desk" put one back in the hole: the
 * lattice walks multiples of `snap`, so a piece that was dragged to 1.75 sat between
 * the cells of every pass and the hole it left was somewhere the search never looked.
 *
 * **The lattice reaches the snap.** It went coarse then half-coarse and stopped, which
 * with the default quarter-unit snap left positions you could drag a piece to that Add
 * could never find. The finest pass is the snap itself, so the two agree about where a
 * piece may stand. It costs about four times the candidates — measured on the authored
 * room, a search that finds nowhere goes from 58ms to 136ms for a desk — which is worth
 * it to stop the search having a blind spot the mouse does not.
 *
 * **A piece that cannot fit is not offered.** `extent` is the piece's own half-extents,
 * so a position where it would hang off the floor is never yielded. A rug is 9 by 7, so
 * most of the floor is somewhere its *centre* cannot go — four candidates in seven were
 * being generated only to be refused (measured: 4272 of 7956).
 *
 * @param {object} opts
 * @param {{W: number, D: number}} opts.room
 * @param {number} opts.snap  the finest lattice, and the grid a drag lands on
 * @param {boolean} [opts.turns]  whether the piece has a front to point
 * @param {{x: number, z: number}} [opts.near]  where "nearest first" is measured from
 * @param {number} [opts.prefer]  the heading to try before the others
 * @param {{x: number, z: number}} [opts.from]  one exact position, tried first
 * @param {{hw: number, hd: number}} [opts.extent]  half-extents at facing 0
 * @yields {{x: number, z: number, facing: number}}
 */
export function* candidates({
  room, snap, turns = true, near, prefer, from, extent,
}) {
  const seen = new Set();
  const first = Number.isFinite(prefer) ? Math.round(prefer / (Math.PI / 2)) : 0;
  const quarters = turns ? 4 : 1;

  // Half-extents at a given quarter turn. An odd number of quarters lays the piece's
  // depth across x and its width across z, exactly as `obstacleFootprints` does.
  const wholly = (x, z, q) => {
    if (!extent) return true;
    const hw = q % 2 ? extent.hd : extent.hw;
    const hd = q % 2 ? extent.hw : extent.hd;
    return x - hw >= 0 && x + hw <= room.W && z - hd >= 0 && z + hd <= room.D;
  };

  /** One position, at every facing the piece could stand there in. */
  const offer = function* (x, z) {
    const id = `${x},${z}`;
    if (seen.has(id)) return;
    seen.add(id);
    for (let q = 0; q < quarters; q += 1) {
      if (!wholly(x, z, first + q)) continue;
      yield { x, z, facing: (first + q) * (Math.PI / 2) };
    }
  };

  if (from) yield* offer(from.x, from.z);

  // Coarse first, then finer, because a full room and an empty one want different
  // things. A one-unit lattice finds the obvious gap in a couple of dozen tries; when
  // there is no obvious gap it is worth looking again more closely, since the difference
  // between "nowhere for another desk" and one that slots in against the wall can be a
  // fraction of a unit. Positions already tried are not tried again.
  const coarse = Math.max(snap, 0.5) * 2;
  const steps = [...new Set([coarse, coarse / 2, snap])]
    .filter((step) => step > 0)
    .sort((a, b) => b - a);
  const mid = near ?? { x: room.W / 2, z: room.D / 2 };
  for (const step of steps) {
    const cells = [];
    for (let x = step; x < room.W; x += step) {
      for (let z = step; z < room.D; z += step) {
        cells.push({ x, z, d: (x - mid.x) ** 2 + (z - mid.z) ** 2 });
      }
    }
    cells.sort((a, b) => a.d - b.d);
    for (const cell of cells) yield* offer(cell.x, cell.z);
  }
}
