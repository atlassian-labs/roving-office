import * as THREE from 'three';
import { ROOM, DOOR } from '../config.js';
import { obstacleFootprints } from '../layout.js';

// Grid-based nav mesh + A* so agents walk around furniture instead of through
// it. The grid covers the interior floor *plus* the entrance stoop, joined by a
// walkable corridor through the doorway, so agents can enter and leave.

// Half-unit cells: fine enough that a chair's seat and the walking lane between
// two facing desks both stay walkable, still tiny for A* (~2.5k cells).
// Exported because the editor's blocked-cell overlay draws one quad per cell and has
// to know how big a cell is (see scene/editor-gizmos.js). Nothing else needs it: ask
// the grid, which speaks world units everywhere it can.
export const CELL = 0.5;
const MIN_X = 0;
const MIN_Z = -4;                       // includes the stoop outside the door
const DOOR_HALF = 1.2;                  // half-width of the walkable doorway
const WALL_MARGIN = 0.6;                // keep agents off the wall faces
const EDGE_MARGIN = 0.6;                // keep agents off the cutaway edges

// How far into the room the entrance traffic reaches. Nobody idles inside this.
const DOORWAY_DEPTH = 4.0;

// How wide a berth a route gives somebody it is routing around: their shoulders
// plus the walker's, so the way round is a way past rather than a squeeze.
const BODY_CLEARANCE = 0.62;

// A cell this close to a blocked one is where a walker's own shoulders reach it,
// even though their centre — the only thing the grid otherwise tracks — clears
// it fine. One cell is close enough: at CELL=0.5 the diagonal neighbour sits
// 0.71 away, comfortably past AGENT_RADIUS (0.46, agents/crowd.js), so this
// errs a little wide rather than a little narrow.
const TIGHT_REACH = 1;

// The extra it costs A* to route a step through a tight cell, in the same units
// as an orthogonal step (1). Enough that a route bends to keep clear of
// furniture when there is room to — a couple of cells' width of detour buys
// back a whole tight cell — without being so large that the *only* way through
// a narrow lane (both sides tight at once, nothing to prefer between them)
// reads as an obstacle rather than a cost. Inflating every
// footprint by a body radius was tried first and rejected — the lane past
// desk-3 is only 1.3 units wide and would have closed outright. This is the
// soft alternative the ticket asked for instead: cost the shoulder-width
// margin, don't block it.
//
// A cost, not a block, can never turn a reachable cell unreachable — A* with
// added non-negative edge weights still finds whatever path exists, just
// possibly a different one — so this cannot be the thing that closes the
// narrow lane the way inflating footprints would have. Measured (headless,
// Test Data, 30 simulated minutes, walking frames only): 1.0 took the frames
// clipping a furniture footprint from ~20% to ~3% at a realistic 5-agent
// office, and ~17% to ~4% stress-tested at 12; 0.5 only got to ~5-9%, and 2.0's
// last couple of points cost the first observed pathfinding dead end across
// dozens of these runs. 1.0 is the knee of that curve.
const TIGHT_PENALTY = 1.0;

export class NavGrid {
  constructor() {
    this.cols = Math.ceil((ROOM.W - MIN_X) / CELL);
    this.rows = Math.ceil((ROOM.D - MIN_Z) / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);
    // Furniture only, not walls/edges/the doorway — kept apart from `blocked`
    // because `_markTight` (below) needs to ask about furniture specifically.
    this.furniture = new Uint8Array(this.cols * this.rows);
    this.tight = new Uint8Array(this.cols * this.rows);
    this.rebuild();
  }

  /**
   * Re-derive the walkable map from the layout, in place.
   *
   * In place, and that is the point: one grid is handed out by reference to every
   * agent's controller, to the standing-spot book and to the crowd separation pass,
   * none of which are told when the furniture moves. Replacing the object would leave
   * all of them pathing around a room that no longer exists, so the same object is
   * re-derived and everybody holding it is correct again for free.
   *
   * Cheap enough to call on every drop: one pass over ~2.5k cells plus a rectangle
   * each for the props (see `obstacleFootprints`).
   */
  rebuild() {
    this.blocked.fill(0);
    this.furniture.fill(0);
    this._addBoundaries();
    this._addPropObstacles();
    this._markTight();
  }

  idx(cx, cz) { return cz * this.cols + cx; }
  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows; }
  isBlocked(cx, cz) { return !this.inBounds(cx, cz) || this.blocked[this.idx(cx, cz)] === 1; }

  /**
   * Flag every free cell within TIGHT_REACH of a piece of furniture.
   *
   * Furniture specifically, not `blocked` in general — a wall is not
   * something a walker's shoulders round the way a desk corner is, and the
   * doorway corridor is meant to be walked straight down the middle of, not
   * skirted like an obstacle. Checking the general blocked map here
   * charged TIGHT_PENALTY near every wall and the whole entrance lane, which
   * the chair-clipping measurements never covered — the frame-clipping percentages
   * that picked TIGHT_PENALTY's value were furniture-only.
   *
   * Run once per rebuild rather than measured mid-search: it depends only on
   * the furniture map, which a search never changes, so finding it up front is
   * one pass over ~2.5k cells instead of the same neighbourhood check redone
   * for every cell A* touches.
   */
  _markTight() {
    this.tight.fill(0);
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        if (this.blocked[this.idx(cx, cz)]) continue;
        outer:
        for (let dz = -TIGHT_REACH; dz <= TIGHT_REACH; dz++) {
          for (let dx = -TIGHT_REACH; dx <= TIGHT_REACH; dx++) {
            if (!dx && !dz) continue;
            const nx = cx + dx, nz = cz + dz;
            if (!this.inBounds(nx, nz) || !this.furniture[this.idx(nx, nz)]) continue;
            this.tight[this.idx(cx, cz)] = 1;
            break outer;
          }
        }
      }
    }
  }

  worldToCell(x, z) {
    return [Math.floor((x - MIN_X) / CELL), Math.floor((z - MIN_Z) / CELL)];
  }
  cellToWorld(cx, cz) {
    return new THREE.Vector3(MIN_X + cx * CELL + CELL / 2, 0, MIN_Z + cz * CELL + CELL / 2);
  }
  cellCenter(cx, cz) {
    return { x: MIN_X + cx * CELL + CELL / 2, z: MIN_Z + cz * CELL + CELL / 2 };
  }

  /** @param {Uint8Array} [into] which grid to mark; `this.blocked` if omitted. */
  block(x0, z0, x1, z1, into = this.blocked) {
    const [cx0, cz0] = this.worldToCell(Math.min(x0, x1), Math.min(z0, z1));
    const [cx1, cz1] = this.worldToCell(Math.max(x0, x1), Math.max(z0, z1));
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++)
        if (this.inBounds(cx, cz)) into[this.idx(cx, cz)] = 1;
  }

  // Walls, cutaway edges, and the outside area (except the doorway corridor).
  _addBoundaries() {
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const { x, z } = this.cellCenter(cx, cz);
        let blocked = false;

        if (z < WALL_MARGIN) {
          // Outside the back wall (or in the wall itself): only the doorway
          // corridor and the stoop directly beyond it are walkable.
          const inCorridor = Math.abs(x - DOOR.x) <= DOOR_HALF;
          const onStoop = z >= -DOOR.stoopDepth;
          blocked = !(inCorridor && onStoop);
        } else if (x < WALL_MARGIN) {
          blocked = true;                                  // left wall
        } else if (x > ROOM.W - EDGE_MARGIN) {
          blocked = true;                                  // open cutaway edge
        } else if (z > ROOM.D - EDGE_MARGIN) {
          blocked = true;                                  // open cutaway edge
        }

        if (blocked) this.blocked[this.idx(cx, cz)] = 1;
      }
    }
  }

  // Furniture footprints, taken straight from the layout config. Marked in
  // both grids: `blocked`, same as any obstacle, and `furniture`, which is
  // what `_markTight` costs a shoulder-width margin around — walls and the
  // doorway are blocked too, but never furniture, so never tight. The soft
  // ones are skipped entirely; see `obstacleFootprints`.
  _addPropObstacles() {
    for (const f of obstacleFootprints()) {
      // A soft rectangle is measured, not blocked: the rug is the case, and walking
      // round a rug is not a thing people do.
      if (f.soft) continue;
      // **Standing room is floor, and walkable by definition.** It is the space
      // somebody needs in order to *use* a prop — in front of a printer to work at
      // it, in front of a couch to sit down on it — so blocking it would wall off
      // the way in to every machine in the room. It is reserved against other
      // *props* (see `floorFault` in src/editor/placement.js) and against nobody
      // walking.
      if (f.role === 'stand') continue;
      // **The body, plus whatever berth the prop asks a walker for.**
      //
      // The rectangle itself is now the prop's measured floor extent and nothing
      // more (`BODIES` in src/layout.js), which is what the editor needs to decide
      // how close two things may stand. A walker wants a little more from one prop
      // — a floor lamp is a thin pole with a shade over head height, so a walker
      // whose centre clears the base by a hair still looks like they walked through
      // the lamp — and `berth` is where that lives. Adding it here rather than to
      // the footprint is what lets a lamp and a plant stand side by side to make a
      // wall you walk around rather than between.
      const b = f.berth ?? 0;
      this.block(f.x0 - b, f.z0 - b, f.x1 + b, f.z1 + b);
      this.block(f.x0 - b, f.z0 - b, f.x1 + b, f.z1 + b, this.furniture);
    }
  }

  /**
   * Can somebody stand at this world point?
   *
   * The same question `isBlocked` answers, asked in world units, because the
   * crowd separation pass works in world space and has to know where it is
   * allowed to push people (see agents/crowd.js).
   */
  walkableAt(x, z) {
    const [cx, cz] = this.worldToCell(x, z);
    return !this.isBlocked(cx, cz);
  }

  /**
   * Every cell reachable on foot from a world point, as a flag per cell.
   *
   * A flood fill rather than a route, because the question it answers is about the
   * whole room at once: the furniture editor asks whether *anything* has been fenced
   * off, and one pass over the grid answers that for every approach point together,
   * where a path search would be one search per point (see `validate` in
   * src/editor.js).
   *
   * Four-connected on purpose, and this is the one place that differs from `findPath`.
   * A route may cut a diagonal between two blocked cells because a walker has width
   * and rounds the corner; reachability is a promise, and a promise squeezed through a
   * gap of exactly zero is not one worth making.
   *
   * @param {{x: number, z: number}} from
   * @returns {Uint8Array} indexed by `idx(cx, cz)`
   */
  reachableFrom(from) {
    const seen = new Uint8Array(this.cols * this.rows);
    const [sx, sz] = this.nearestFree(from.x, from.z);
    if (this.isBlocked(sx, sz)) return seen;

    const queue = [this.idx(sx, sz)];
    seen[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const cx = cur % this.cols, cz = Math.floor(cur / this.cols);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (this.isBlocked(nx, nz)) continue;
        const ni = this.idx(nx, nz);
        if (seen[ni]) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    return seen;
  }

  /** Can somebody get from `from` to this world point at all? Uses a prepared fill. */
  reachedBy(seen, x, z) {
    const [cx, cz] = this.worldToCell(x, z);
    if (!this.inBounds(cx, cz)) return false;
    return seen[this.idx(cx, cz)] === 1;
  }

  /** Nearest walkable cell to a world point (targets may sit on obstacles). */
  nearestFree(x, z) {
    const [cx, cz] = this.worldToCell(x, z);
    if (!this.isBlocked(cx, cz)) return [cx, cz];
    for (let r = 1; r < Math.max(this.cols, this.rows); r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.isBlocked(nx, nz)) return [nx, nz];
        }
      }
    }
    return [cx, cz];
  }

  /**
   * A* -> list of world-space waypoints. The final point is the exact target.
   *
   * `avoid` is a set of world points to route around as though they were furniture
   * — the people standing in the way. The room is fixed but its occupants are not,
   * so a walker who finds somebody in front of them asks for the way round rather
   * than standing there (see `_stepWalk` in states.js). Where there is no way round
   * this returns null, and waiting is the right answer after all.
   *
   * @param {{x: number, z: number}} start
   * @param {{x: number, z: number}} goal
   * @param {{avoid?: Iterable<{x: number, z: number}>, clearance?: number}} [opts]
   */
  findPath(start, goal, { avoid = null, clearance = BODY_CLEARANCE } = {}) {
    const [sx, sz] = this.nearestFree(start.x, start.z);
    const [gx, gz] = this.nearestFree(goal.x, goal.z);
    const startI = this.idx(sx, sz), goalI = this.idx(gx, gz);
    const exact = new THREE.Vector3(goal.x, 0, goal.z);

    if (startI === goalI) return [exact];

    // The cells the crowd is standing in, closed for the length of this search.
    // Where the walker is and where they are going are never closed: they have to
    // be able to leave, and to arrive.
    const shut = this._cellsAround(avoid, clearance, [startI, goalI]);
    const isBlocked = shut
      ? (cx, cz) => this.isBlocked(cx, cz) || shut.has(this.idx(cx, cz))
      : (cx, cz) => this.isBlocked(cx, cz);

    const open = new MinHeap();
    const gScore = new Map([[startI, 0]]);
    const came = new Map();
    open.push(startI, this._h(sx, sz, gx, gz));

    const neighbors = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    while (open.size) {
      const current = open.pop();
      if (current === goalI) {
        const pts = this._reconstruct(came, current);
        pts[pts.length - 1] = exact;   // finish exactly on the target
        return pts;
      }
      const ccx = current % this.cols, ccz = Math.floor(current / this.cols);
      for (const [dx, dz] of neighbors) {
        const nx = ccx + dx, nz = ccz + dz;
        if (isBlocked(nx, nz)) continue;
        // Don't cut corners through blocked diagonals.
        if (dx !== 0 && dz !== 0 && (isBlocked(ccx + dx, ccz) || isBlocked(ccx, ccz + dz))) continue;
        const ni = this.idx(nx, nz);
        const step = (dx !== 0 && dz !== 0) ? 1.414 : 1;
        // Passable, but costed extra if it puts a shoulder past the cell's own
        // centre and into whatever's next door (see TIGHT_PENALTY above).
        const cost = step + (this.tight[ni] ? TIGHT_PENALTY : 0);
        const tentative = gScore.get(current) + cost;
        if (tentative < (gScore.get(ni) ?? Infinity)) {
          came.set(ni, current);
          gScore.set(ni, tentative);
          open.push(ni, tentative + this._h(nx, nz, gx, gz));
        }
      }
    }
    return null;
  }

  /**
   * The cells within `clearance` of any of these points, as a set of indices.
   *
   * A body's width rather than a point, because a route that merely misses
   * somebody's centre still walks through their shoulder.
   */
  _cellsAround(points, clearance, keep = []) {
    if (!points) return null;
    const set = new Set();
    const reach = Math.ceil(clearance / CELL);
    for (const p of points) {
      const [px, pz] = this.worldToCell(p.x, p.z);
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const cx = px + dx, cz = pz + dz;
          if (!this.inBounds(cx, cz)) continue;
          const c = this.cellCenter(cx, cz);
          if (Math.hypot(c.x - p.x, c.z - p.z) > clearance) continue;
          set.add(this.idx(cx, cz));
        }
      }
    }
    for (const i of keep) set.delete(i);
    return set.size ? set : null;
  }

  _h(ax, az, bx, bz) {
    const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
    return (dx + dz) + (1.414 - 2) * Math.min(dx, dz);
  }

  _reconstruct(came, current) {
    const cells = [current];
    while (came.has(current)) { current = came.get(current); cells.unshift(current); }
    const pts = cells.map((i) => this.cellToWorld(i % this.cols, Math.floor(i / this.cols)));
    return this._smooth(pts);
  }

  // Drop collinear waypoints for smoother walking.
  _smooth(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z;
      const bcx = c.x - b.x, bcz = c.z - b.z;
      if (Math.abs(abx * bcz - abz * bcx) > 1e-3) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /** A random walkable point inside the room (never on the stoop). */
  randomInteriorPoint() {
    for (let tries = 0; tries < 60; tries++) {
      const cx = Math.floor(Math.random() * this.cols);
      const cz = Math.floor(Math.random() * this.rows);
      if (this.isBlocked(cx, cz)) continue;
      const { x, z } = this.cellCenter(cx, cz);
      if (z < 1.0) continue;                       // keep wandering indoors
      // Not in the doorway, either. Somebody with nothing to do who stops here is
      // standing on the way in, and everyone who arrives afterwards has to get past
      // them — which is how the entrance came to collect a small crowd.
      if (z < DOORWAY_DEPTH && Math.abs(x - DOOR.x) < DOOR_HALF + 0.8) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(ROOM.W / 2, 0, ROOM.D / 2);
  }
}

// Tiny binary min-heap for the A* open set.
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node, prio) {
    this.items.push({ node, prio });
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].prio <= this.items[i].prio) break;
      [this.items[p], this.items[i]] = [this.items[i], this.items[p]];
      i = p;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let s = i;
        if (l < n && this.items[l].prio < this.items[s].prio) s = l;
        if (r < n && this.items[r].prio < this.items[s].prio) s = r;
        if (s === i) break;
        [this.items[s], this.items[i]] = [this.items[i], this.items[s]];
        i = s;
      }
    }
    return top.node;
  }
}
