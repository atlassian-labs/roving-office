// Can everybody get everywhere? — asked of a plan that is not a room yet.
//
// This is the same question `NavGrid.reachableFrom()` answers for the live room,
// and it is asked here for one reason: a generated layout has to be *checked*
// before it is handed to anybody, and the nav grid can only be built from a
// layout that has already been applied to the office. Applying a layout in order
// to find out whether it is any good would mean rearranging the room somebody is
// standing in, which is not a thing a generator may do.
//
// So this is a deliberate second implementation of one question, and the terms
// are worth stating because a second implementation is normally the wrong answer:
//
//   * It reads the **same rectangles**. Both sides derive a prop's blocked floor
//     from `worldExtent()` and the same `hw`/`hd` tables, so there is no second
//     opinion about how much floor a turned couch takes.
//   * It uses the **same cell size and the same margins**, named below against
//     the constants they mirror.
//   * The agreement is **tested rather than asserted**: `test/plan-reach.test.js`
//     generates offices, applies each one for real, builds the real `NavGrid` and
//     checks that the two agree about every standing spot in the room. If they
//     ever drift, that test says so.
//
// What is deliberately *not* copied is the rest of the nav grid: the tight-cell
// penalty is about route cost and not about whether a route exists, and the stoop
// outside the door is not floor anybody has to reach from inside.

import { ROOM, DOOR } from '../config.js';

/** Mirrors `CELL` in src/agents/pathfinding.js. */
const CELL = 0.5;

/**
 * Mirrors `WALL_MARGIN` and `EDGE_MARGIN` in src/agents/pathfinding.js, which are
 * the same number for the walls and the cutaway edges.
 *
 * It is why a standing spot is refused within this much of any boundary (see
 * `Floor.probe`): the nav grid keeps agents off the wall faces, so a spot in that
 * strip is a spot nobody can stand on however clear the floor looks.
 */
export const STAND_MARGIN = 0.6;

/**
 * Every cell of the interior floor somebody can walk to from just inside the
 * door, as a set of `cx,cz` keys.
 *
 * Four-connected, like the nav grid's own fill and for its reason: a route may
 * cut a diagonal because a walker has width and rounds a corner, but reachability
 * is a promise, and a promise squeezed through a gap of exactly zero is not one
 * worth making.
 *
 * @param {{x0: number, z0: number, x1: number, z1: number, soft?: boolean}[]} blockers
 *   prop footprints only — an aisle is floor, and a rug is walked on
 * @param {{x: number, z: number}} [from]
 */
export function reachable(blockers, from = DOOR.inside) {
  const cols = Math.ceil(ROOM.W / CELL);
  const rows = Math.ceil(ROOM.D / CELL);
  const solid = new Uint8Array(cols * rows);
  const idx = (cx, cz) => cz * cols + cx;
  const centre = (c) => c * CELL + CELL / 2;

  // The boundaries, by cell centre — which is how `_addBoundaries` decides.
  for (let cz = 0; cz < rows; cz += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const x = centre(cx);
      const z = centre(cz);
      if (x < STAND_MARGIN || z < STAND_MARGIN
        || x > ROOM.W - STAND_MARGIN || z > ROOM.D - STAND_MARGIN) solid[idx(cx, cz)] = 1;
    }
  }

  // The furniture, by every cell its rectangle *touches* — which is how
  // `NavGrid.block()` marks one, and not the same thing as by cell centre. It is
  // the difference between a desk blocking the floor it stands on and a desk
  // blocking the floor it stands on rounded out to the grid, and up to half a cell
  // in each direction is a great deal in a room where the aisles are two cells
  // wide. Checking centres here made this fill *more* permissive than the real
  // grid, so the generator passed rooms whose corners the agents could not reach —
  // which is precisely the failure a second implementation of one question exists
  // to avoid, and is why test/plan-reach.test.js compares the two cell by cell.
  for (const r of blockers) {
    if (r.soft) continue;
    const cx0 = Math.max(0, Math.floor(r.x0 / CELL));
    const cx1 = Math.min(cols - 1, Math.floor(r.x1 / CELL));
    const cz0 = Math.max(0, Math.floor(r.z0 / CELL));
    const cz1 = Math.min(rows - 1, Math.floor(r.z1 / CELL));
    for (let cz = cz0; cz <= cz1; cz += 1) {
      for (let cx = cx0; cx <= cx1; cx += 1) solid[idx(cx, cz)] = 1;
    }
  }

  const seen = new Set();
  const start = [Math.floor(from.x / CELL), Math.floor(from.z / CELL)];
  if (solid[idx(start[0], start[1])]) return seen;
  const queue = [start];
  seen.add(`${start[0]},${start[1]}`);
  while (queue.length) {
    const [cx, cz] = queue.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      if (solid[idx(nx, nz)]) continue;
      const key = `${nx},${nz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([nx, nz]);
    }
  }
  return seen;
}

/** Is this world point in the reached set? */
export function reached(seen, x, z) {
  return seen.has(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
}
