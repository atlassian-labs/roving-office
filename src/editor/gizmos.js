import * as THREE from 'three';
import { FLOOR_TOP, ROOM } from '../config.js';
import { obstacleFootprints } from '../layout.js';
import { CELL } from '../agents/pathfinding.js';
import { RUG_TOP } from '../scene/props/rug.js';

/**
 * What the furniture editor draws on the floor.
 *
 * Three overlays, and between them the only answer to "did that actually work?" that
 * does not involve waiting for an agent to walk past:
 *
 *   * the **blocked-cell overlay**, straight off the nav grid. This *is* the "and the
 *     paths adjust" half of the feature, made visible — drop a desk in a doorway and
 *     the gap in the walkable floor closes under it as you watch. Without it the
 *     editor would be a way to move furniture and hope.
 *   * **footprint outlines**, so the rectangle a prop blocks can be seen rather than
 *     inferred from where people refuse to walk. They are wider than the models look,
 *     which is surprising until you can see them.
 *   * a **selection ring** under whatever is picked up, tinted by whether where it is
 *     now is somewhere it may be left.
 *
 * All of it is chrome rather than scenery, so none of it is themed, none of it casts
 * or receives shadow, and all of it lies flat a few millimetres above the slab. The
 * heights are staggered on purpose: three coplanar overlays would z-fight, which is
 * exactly what `npm run probe -- --sweep` exists to catch.
 */

/**
 * The floor chrome, stacked, and all of it **above a rug**.
 *
 * Everything on this layer used to sit between 0.015 and 0.06 over the boards, and a
 * rug's upper surface is 0.05 over the boards — so on a rug the blocked cells, the
 * footprint edges and most of the selection tint were simply buried, and dragging a
 * prop across one meant dragging it blind. `RUG_TOP` comes from the rug itself
 * (scene/props/rug.js) rather than being copied here, so a thicker rug lifts this
 * with it instead of quietly hiding it again.
 *
 * The order within the stack is the order of how much each has to say: the standing
 * room wash underneath everything, then the cells, then the edges that a placement
 * decision actually turns on, then the selection.
 */
const CHROME = FLOOR_TOP + RUG_TOP;
const Y_WALK = CHROME + 0.02;
const Y_ZONE = CHROME + 0.035;
const Y_PICK = CHROME + 0.05;
const Y_RING = CHROME + 0.075;

/**
 * The stack, exported so a test can assert it clears a rug and stays in order.
 *
 * Heights rather than a comment, because "above the rug" is the kind of claim that
 * is true when it is written and false two commits later — which is how it came to
 * be false in the first place.
 */
export const CHROME_HEIGHTS = {
  walk: Y_WALK - FLOOR_TOP,
  zone: Y_ZONE - FLOOR_TOP,
  pick: Y_PICK - FLOOR_TOP,
  ring: Y_RING - FLOOR_TOP,
};

// Atlassian palette colours, shared with the legend. Solid, unlit diagram
// cells stay consistent across different floor materials, rugs and sunlight.
const WALKING = 0xb7b9be; // Neutral400
const FOOTPRINT = 0x8fb8f6; // Blue300
const OK = 0x7ee2b8; // Green300
const CLASH = 0xfd9891; // Red300
const FLASH = 0xc9372c; // Red700
const ZONE_OPACITY = 1;
const WALK_OPACITY = 1;
const PICK_OPACITY = 1;

/** Exact sRGB colours drawn on the floor, unaffected by scene exposure. */
export function chromeColours() {
  const css = (value) => `#${value.toString(16).padStart(6, '0')}`;
  return { zone: css(FOOTPRINT), pick: css(OK), clash: css(CLASH), walk: css(WALKING) };
}

/** Unlit UI colour; opacity is reserved for temporary pulses and the ring. */
function overlayMat(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, toneMapped: false, depthWrite: false, side: THREE.DoubleSide,
  });
}

/**
 * @param {THREE.Object3D} scene  where the overlays are parented
 *
 * Parented to the scene rather than to the world root on purpose: the world is torn
 * down and disposed wholesale on a project switch (see disposeWorld in main.js), and
 * gizmos hanging off it would have their geometry disposed underneath them while the
 * editor was still holding the objects. The editor owns their lifetime instead, and
 * `dispose()` is how it gives them back.
 */
export function createEditorGizmos(scene) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  /**
   * Three meshes, two ideas, and one of them is the selection.
   *
   * Everything on this layer is drawn as **nav-grid cells** rather than as smooth
   * rectangles, because that is the floor as the room actually treats it: a prop
   * blocks every half-unit cell it touches, so a rectangle that looks like it clears
   * a gap by a hair does not. Drawing the true rectangle and letting somebody
   * discover the quantisation by being refused was the older, worse answer.
   *
   *   blue    no other prop may go here -- a prop's own footprint
   *   grey    where people walk to use things -- the standing room in front of them
   *   green   the selected prop; red when a drop would be refused
   *
   * Allocated once at the grid's full size, because a room is a fixed number of
   * cells and growing a buffer per drop would churn GPU memory for nothing; the draw
   * range is what changes.
   */
  const zone = new THREE.Mesh(new THREE.BufferGeometry(), overlayMat(FOOTPRINT, ZONE_OPACITY));
  zone.renderOrder = 3;
  root.add(zone);

  const walk = new THREE.Mesh(new THREE.BufferGeometry(), overlayMat(WALKING, WALK_OPACITY));
  walk.renderOrder = 2;
  root.add(walk);

  // The prop in hand, in green — so what you are moving is never the same colour as
  // what you are moving it around. `setValidity` turns it red when the drop would be
  // refused, which is the one moment the two should look alike.
  const pickMat = overlayMat(OK, PICK_OPACITY);
  const pick = new THREE.Mesh(new THREE.BufferGeometry(), pickMat);
  pick.renderOrder = 4;
  root.add(pick);

  /** @type {?Float32Array} */
  let zoneVerts = null;
  /** @type {?Float32Array} */
  let walkVerts = null;
  /** @type {?Float32Array} */
  let pickVerts = null;
  /** The grid last seen, so a selection change can redraw without being handed one. */
  let lastNav = null;

  // --- The refusal flash ----------------------------------------------------
  // A refused rotate or drop names its blocker in the status line, which is a
  // long way from the floor. This is the same fact said where the eye already
  // is: the blocking footprint filled red for a beat, then gone. One mesh,
  // reused; a second refusal simply restarts it.
  // Brighter and more opaque than a resting footprint, because footprints are red
  // now too and a flash has to be legible against them rather than beside them.
  const flashMat = overlayMat(FLASH, 0.55);
  const flashFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat);
  flashFill.rotation.x = -Math.PI / 2;
  flashFill.visible = false;
  flashFill.renderOrder = 4;
  root.add(flashFill);
  let flashTimer = null;

  // --- Selection ring ------------------------------------------------------
  const ringMat = overlayMat(OK, 0.85);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 5;
  root.add(ring);

  /** @type {?object} the movable currently selected */
  let selected = null;

  /**
   * Which grid cells a set of rectangles claims.
   *
   * The same rule `NavGrid.block` uses — every cell a rectangle *touches*, not every
   * cell whose centre it covers — because that is how the room decides, and an
   * overlay that rounded differently would be a picture of a floor nobody has.
   * `berth` comes along for the one prop that asks a walker for more than its own
   * extent (see `BERTHS` in src/layout.js).
   */
  function claimCells(nav, rects) {
    const mark = new Uint8Array(nav.cols * nav.rows);
    for (const r of rects) {
      if (r.soft) continue;
      const b = r.berth ?? 0;
      const [cx0, cz0] = nav.worldToCell(r.x0 - b, r.z0 - b);
      const [cx1, cz1] = nav.worldToCell(r.x1 + b, r.z1 + b);
      for (let cz = cz0; cz <= cz1; cz += 1) {
        for (let cx = cx0; cx <= cx1; cx += 1) {
          if (nav.inBounds(cx, cz)) mark[nav.idx(cx, cz)] = 1;
        }
      }
    }
    return mark;
  }

  /**
   * Marked cells into a quad soup, one square each.
   *
   * A hairline gap so the squares read as squares: the quantisation is the point of
   * drawing cells at all, and a merged region would hide it. Cells whose centre falls
   * outside the room are skipped — the grid reaches out over the stoop so agents can
   * come and go, and painting that would frame the office in a border saying nothing.
   */
  function cellQuads(nav, mark, into, y) {
    const need = nav.cols * nav.rows * 6 * 3;
    const verts = into && into.length === need ? into : new Float32Array(need);
    const h = CELL / 2 - 0.02;
    let i = 0;
    for (let cz = 0; cz < nav.rows; cz += 1) {
      for (let cx = 0; cx < nav.cols; cx += 1) {
        if (mark[nav.idx(cx, cz)] !== 1) continue;
        const { x, z } = nav.cellCenter(cx, cz);
        if (x < 0 || x > ROOM.W || z < 0 || z > ROOM.D) continue;
        for (const [dx, dz] of [[-h, -h], [h, -h], [h, h], [-h, -h], [h, h], [-h, h]]) {
          verts[i++] = x + dx; verts[i++] = y; verts[i++] = z + dz;
        }
      }
    }
    return { verts, count: i / 3 };
  }

  /** Point one mesh at a fresh quad soup. */
  function paintCells(mesh, held, nav, mark, y) {
    const { verts, count } = cellQuads(nav, mark, held, y);
    if (verts !== held) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.BufferGeometry();
      mesh.geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    }
    mesh.geometry.setDrawRange(0, count);
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
    return verts;
  }

  /**
   * Redraw the floor: footprints, walking room, and whatever is in hand.
   *
   * The prop being dragged is lifted out of the red and drawn green, so what you are
   * moving is never the same colour as what you are moving it around. Its *standing
   * room* stays blue with everybody else's — it is still floor people walk on, and
   * whose it is does not change that.
   *
   * Blue has the red taken out of it rather than being drawn under it. Where a prop
   * stands on somebody else's standing room the two would otherwise blend into a
   * third colour, which is exactly the confusion this layer has been through once
   * already.
   */
  function refreshOutlines(nav = lastNav) {
    if (nav) lastNav = nav;
    if (!lastNav) return;
    const grid = lastNav;
    const all = obstacleFootprints().filter((r) => !r.soft);
    const mine = selected?.key ?? null;

    const bodies = all.filter((r) => r.role !== 'stand' && r.key !== mine);
    const held = mine ? all.filter((r) => r.key === mine) : [];
    const rooms = all.filter((r) => r.role === 'stand');

    const zoneMark = claimCells(grid, bodies);
    const pickMark = claimCells(grid, held);
    const walkMark = claimCells(grid, rooms);
    for (let i = 0; i < walkMark.length; i += 1) {
      if (zoneMark[i] === 1 || pickMark[i] === 1) walkMark[i] = 0;
    }

    zoneVerts = paintCells(zone, zoneVerts, grid, zoneMark, Y_ZONE);
    walkVerts = paintCells(walk, walkVerts, grid, walkMark, Y_WALK);
    pickVerts = paintCells(pick, pickVerts, grid, pickMark, Y_PICK);
    pick.visible = !!mine;
  }

  /**
   * Put the ring on the selection, wherever it is now.
   *
   * There used to be a tinted plane here as well, drawn on the selection's exact
   * rectangle. It went when the prop in hand started being drawn as green cells:
   * two green things on one prop, one of them grid-quantised and one of them not, is
   * two pictures of the same fact — and that is what made this layer confusing in
   * the first place.
   */
  function refreshSelection() {
    ring.visible = !!selected;
    if (!selected) return;
    const { x, z } = selected.spec;
    ring.position.set(x, Y_RING, z);
  }

  return {
    /**
     * Fill one footprint red for a beat — the visible half of a refusal.
     * @param {string} key  a footprint key; unknown keys flash nothing
     */
    flash(key) {
      const rect = obstacleFootprints().find((r) => r.key === key);
      if (!rect) return;
      flashFill.position.set((rect.x0 + rect.x1) / 2, Y_PICK + 0.005, (rect.z0 + rect.z1) / 2);
      flashFill.scale.set(rect.x1 - rect.x0, rect.z1 - rect.z0, 1);
      flashFill.visible = true;
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashFill.visible = false; flashTimer = null; }, 700);
    },

    /** Show the overlays and draw them from the current layout and grid. */
    show(nav) {
      root.visible = true;
      refresh(nav);
    },

    hide() {
      root.visible = false;
      selected = null;
      ring.visible = false;
      pick.visible = false;
    },

    /** @param {?object} movable  as tagged by scene/props.js */
    setSelection(movable) {
      selected = movable;
      // The floor changes too: whichever prop is in hand comes out of the red and is
      // drawn green, so a bare `refreshSelection` would leave the old one green.
      refreshOutlines();
      refreshSelection();
    },

    /**
     * Colour the selection by whether it may be left where it is.
     * @param {boolean} ok
     */
    setValidity(ok) {
      // Green while it may be dropped, red the moment it may not — on the ring and on
      // the prop's own cells, which are the two things the eye is already on.
      const color = ok ? OK : CLASH;
      ringMat.color.setHex(color);
      pickMat.color.setHex(color);
      pickMat.opacity = PICK_OPACITY;
    },

    /**
     * The layout moved: redraw everything the overlay knows, without touching the
     * grid the agents walk on.
     *
     * `nav` is read but not rebuilt — the cells are drawn from the live footprints
     * plus the grid's own boundaries. See `refreshCells` for why the grid itself has
     * to wait for the drop.
     */
    refreshLayout(nav) {
      refreshOutlines(nav);
      refreshSelection();
    },

    /** The layout was committed: redraw everything, the walkable map included. */
    refresh,

    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    },
  };

  function refresh(nav) {
    refreshOutlines(nav);
    refreshSelection();
  }
}
