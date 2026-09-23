import * as THREE from 'three';
import { FLOOR_TOP } from '../config.js';
import { CHROME_HEIGHTS } from './gizmos.js';

/**
 * The routes people are walking, drawn on the floor for the furniture editor.
 *
 * Two ribbons per agent, and between them the answer to the question the editor is
 * really for — *did moving that make the room worse to walk through?*
 *
 *   * the **route ahead**, from where somebody is now to wherever they are going. This
 *     is the one that reacts: drop a desk across a walker's line and the ribbon bends
 *     round it in the same frame, because the path it is drawn from has genuinely been
 *     re-planned (see `AgentController.replan`).
 *   * the **route just walked**, kept after the walk ends. Where somebody came from is
 *     half of what a layout change did to them, and without this it is gone by the time
 *     you have noticed anything changed — the ribbon ahead simply vanishes on arrival
 *     and there is nothing left to compare.
 *
 * The blocked-cell overlay next door says where walking is *possible*. This says where
 * it is actually *happening*, which is a different question: a doorway can be perfectly
 * walkable and still be one nobody's route goes through any more.
 *
 * Editor-only, and for the same reason the rest of the editor is: a viewer watching
 * their agents work wants a room, not a diagram of one.
 */

// Above rugs and every selection overlay; separate heights prevent crossings
// from fighting their own history. Furniture can still occlude a route.
const Y_BEHIND = FLOOR_TOP + CHROME_HEIGHTS.ring + 0.015;
const Y_AHEAD = FLOOR_TOP + CHROME_HEIGHTS.ring + 0.03;

/**
 * Ribbon widths, in metres of floor. The past is drawn slighter than the future, being
 * the lesser claim on your attention.
 *
 * Set by looking rather than by taste: the first attempt was half this, which read as a
 * scratch on the boards at the far end of the room and disappeared entirely where a
 * route ran under a desk. A route has to survive being partly occluded, because most of
 * them are.
 */
const W_BEHIND = 0.15;
const W_AHEAD = 0.24;

// Bold unlit routes remain readable in sunshine. History softens as it ages.
const O_BEHIND = 0.8;
const O_AHEAD = 1;
const C_AHEAD = 0x1f845a; // Green700: where the agent is going.
const C_BEHIND = 0x1868db; // Blue700: where the agent has been.

/**
 * How long a finished route stays on the floor, in seconds, and how long it keeps its
 * full strength before it starts to go.
 *
 * The fade earns its keep twice. It stops a long session silting up into a cat's cradle
 * of every journey anybody has made, and — because brightness now tracks age — it makes
 * a glance at the floor say *when*: the bright blue is the walk that just happened, the
 * faint one is several errands ago. The hold at the start is so that a route that has
 * only just finished is unambiguously still there, rather than already dimmed and read
 * as old.
 */
const BEHIND_LIFE = 20;
const BEHIND_HOLD = 6;

/**
 * The most corners either ribbon will draw.
 *
 * Paths arrive already stripped of collinear waypoints (`NavGrid._smooth`), so a route
 * across the whole room is a dozen points rather than a hundred cells. Sixty-four is
 * far past anything the office produces and is the size the buffers are allocated at
 * once, so the cost of the ceiling being generous is a few kilobytes rather than work
 * per frame.
 */
const MAX_POINTS = 64;

/** Below this, two waypoints are the same waypoint and the segment has no direction. */
const MIN_SEGMENT = 1e-4;

/**
 * A flat ribbon along a polyline, its geometry allocated once and rewritten in place.
 *
 * Written as a strip with mitred joins rather than one quad per segment, which is worth
 * the arithmetic for a reason that only shows up in motion: separate quads either gap on
 * the outside of every corner, or — if you overlap them to hide the gap — double-blend
 * where they overlap, so a translucent route grows a bright pip at each turn. A single
 * strip has neither, because each corner is one pair of vertices shared by the segments
 * on both sides of it.
 */
function createRibbon({ y, width, color, opacity }) {
  const half = width / 2;
  const positions = new Float32Array(MAX_POINTS * 2 * 3);
  const indices = new Uint16Array((MAX_POINTS - 1) * 6);
  // The index pattern never changes — only how much of it is drawn — so it is written
  // once here rather than rebuilt with every path.
  for (let i = 0; i < MAX_POINTS - 1; i++) {
    const a = i * 2;
    indices.set([a, a + 1, a + 3, a, a + 3, a + 2], i * 6);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);

  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, toneMapped: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Chrome, not scenery: it does not take part in the room's lighting or its shadows.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // The room is drawn first and this goes over the top of it. Without this a ribbon
  // lying 9cm above the boards still flickers against them at a shallow camera angle.
  mesh.renderOrder = y === Y_AHEAD ? 7 : 6;
  mesh.frustumCulled = false;
  mesh.visible = false;

  /**
   * Point the ribbon along `points`, or hide it if there is nothing to draw.
   * @param {?Array<{x: number, z: number}>} points
   */
  function set(points) {
    const pts = dedupe(points);
    if (pts.length < 2) {
      mesh.visible = false;
      geometry.setDrawRange(0, 0);
      return;
    }

    for (let i = 0; i < pts.length; i++) {
      // The outward normal at this corner: perpendicular to the way in, the way out, or
      // the average of the two where there is one of each. Averaging is what mitres the
      // join; the clamp stops a hairpin turn throwing a long spike, at the cost of the
      // outside of a very sharp corner being slightly pinched. A pinch is invisible and
      // a spike is not.
      const before = i > 0 ? pts[i - 1] : null;
      const after = i < pts.length - 1 ? pts[i + 1] : null;
      let nx = 0, nz = 0;
      if (before && after) {
        const [ix, iz] = normal(before, pts[i]);
        const [ox, oz] = normal(pts[i], after);
        nx = ix + ox; nz = iz + oz;
        const len = Math.hypot(nx, nz) || 1;
        nx /= len; nz /= len;
        // 1/cos(theta/2), as the mitre needs, clamped so the spike cannot run away.
        const scale = Math.min(1 / Math.max(nx * ix + nz * iz, 0.4), 2.5);
        nx *= scale; nz *= scale;
      } else if (after) {
        [nx, nz] = normal(pts[i], after);
      } else if (before) {
        [nx, nz] = normal(before, pts[i]);
      }

      const o = i * 6;
      positions[o] = pts[i].x + nx * half;
      positions[o + 1] = y;
      positions[o + 2] = pts[i].z + nz * half;
      positions[o + 3] = pts[i].x - nx * half;
      positions[o + 4] = y;
      positions[o + 5] = pts[i].z - nz * half;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.setDrawRange(0, (pts.length - 1) * 6);
    mesh.visible = true;
  }

  return {
    mesh,
    set,
    hide() { mesh.visible = false; geometry.setDrawRange(0, 0); },
    dispose() { geometry.dispose(); material.dispose(); },
    setOpacity(o) { material.opacity = o; },
  };
}

/** The unit normal, in plan, of the segment from `a` to `b`. */
function normal(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

/**
 * The points, with repeats and the over-long tail removed.
 *
 * Coincident points are dropped because a zero-length segment has no direction to take
 * a normal from, and one appears routinely: the ribbon ahead is drawn from the agent's
 * live position to the waypoint they are walking at, and they stand exactly on it for
 * the frame they reach it.
 */
function dedupe(points) {
  if (!points || points.length < 2) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length && out.length < MAX_POINTS; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].z - last.z) < MIN_SEGMENT) continue;
    out.push(points[i]);
  }
  return out;
}

/**
 * @param {THREE.Object3D} scene  where the ribbons are parented
 *
 * Parented to the scene rather than the world root, for the same reason the editor's
 * other gizmos are: the world is disposed wholesale on a project switch, and geometry
 * hanging off it would be freed underneath objects still in use. The editor owns the
 * lifetime, and `dispose()` gives it back.
 */
export function createPathTrails(scene) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  /**
   * Whether edit mode is open, and whether routes are wanted while it is.
   *
   * Two flags rather than one because they answer to different people: the first is the
   * editor opening and closing, the second is a preference the viewer set with `P`. Kept
   * apart so that turning routes off, leaving edit mode and coming back does not quietly
   * turn them on again — a toggle that forgets is a toggle you stop trusting.
   */
  let open = false;
  let wanted = true;
  const apply = () => { root.visible = open && wanted; };

  /** @type {Map<string, {ahead: object, behind: object}>} agent id -> its two ribbons */
  const lanes = new Map();
  /** Reused so that a per-frame redraw of every route allocates nothing. */
  const scratch = [];

  function laneFor(id) {
    let lane = lanes.get(id);
    if (!lane) {
      lane = {
        behind: createRibbon({ y: Y_BEHIND, width: W_BEHIND, color: C_BEHIND, opacity: O_BEHIND }),
        ahead: createRibbon({ y: Y_AHEAD, width: W_AHEAD, color: C_AHEAD, opacity: O_AHEAD }),
      };
      root.add(lane.behind.mesh, lane.ahead.mesh);
      lanes.set(id, lane);
    }
    return lane;
  }

  /**
   * How strongly to draw a finished route of this age, 0 meaning not at all.
   *
   * Held at full for the first few seconds so a walk that has only just ended does not
   * read as an old one, then eased away rather than ramped: a linear fade appears to
   * hang about near the end and then vanish, where a smooth curve leaves as though it
   * were always going to.
   */
  function fadeFor(age) {
    if (!Number.isFinite(age)) return O_BEHIND;
    if (age <= BEHIND_HOLD) return O_BEHIND;
    if (age >= BEHIND_LIFE) return 0;
    const remaining = 1 - (age - BEHIND_HOLD) / (BEHIND_LIFE - BEHIND_HOLD);
    return O_BEHIND * remaining * remaining;
  }

  return {
    /**
     * Redraw every route. Called once a frame while the editor is open.
     *
     * Rebuilt from scratch each time rather than on notification of a change, which is
     * the cheaper thing to *reason about* and costs nothing that matters: it is a few
     * dozen vertex writes into buffers that already exist. It also happens to be the
     * only version that is always right — a route changes when the layout moves under
     * it, when a walker steps round a colleague, when an action list is interrupted and
     * on every frame of ordinary walking, and a redraw that has to be told about each
     * of those is a redraw that will one day miss one.
     *
     * @param {Array<{id: string, position: {x, z}, ahead: ?Array,
     *                behind: ?Array, behindAge: number}>} trails
     */
    update(trails) {
      const live = new Set();
      for (const t of trails) {
        live.add(t.id);
        const lane = laneFor(t.id);

        if (t.ahead && t.ahead.length) {
          // Drawn from where the agent actually is, not from the waypoint they are
          // heading for: they are between waypoints almost always, and a ribbon that
          // started at the next corner would float free of the person walking it.
          scratch.length = 0;
          scratch.push(t.position, ...t.ahead);
          lane.ahead.set(scratch);
        } else {
          lane.ahead.hide();
        }

        const fade = fadeFor(t.behindAge);
        if (t.behind && t.behind.length > 1 && fade > 0) {
          lane.behind.setOpacity(fade);
          lane.behind.set(t.behind);
        } else {
          lane.behind.hide();
        }
      }

      // Somebody who has gone home takes their ribbons with them.
      for (const [id, lane] of lanes) {
        if (live.has(id)) continue;
        root.remove(lane.ahead.mesh, lane.behind.mesh);
        lane.ahead.dispose();
        lane.behind.dispose();
        lanes.delete(id);
      }
    },

    show() { open = true; apply(); },
    hide() { open = false; apply(); },

    /** Whether routes are currently wanted, whatever the editor is doing. */
    get enabled() { return wanted; },

    /** Turn routes on or off and report where that landed, for `P`. */
    setEnabled(next) { wanted = !!next; apply(); return wanted; },

    /** Drop every ribbon, for when the room they were drawn in has been replaced. */
    clear() {
      for (const lane of lanes.values()) {
        root.remove(lane.ahead.mesh, lane.behind.mesh);
        lane.ahead.dispose();
        lane.behind.dispose();
      }
      lanes.clear();
    },

    dispose() {
      this.clear();
      scene.remove(root);
    },
  };
}
