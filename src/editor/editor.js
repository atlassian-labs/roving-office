import * as THREE from 'three';
import { DOOR, FLOOR_TOP, ROOM } from '../config.js';
import { BIRD_KIND_OPTIONS, CHANNELS, JOB_ROLES, STATION_KINDS, STATIONS, addObject, kitItems, applyLayout, authoredLayout, canRemoveObject, canTurnObject, kitKeyOf, layoutSnapshot, paletteOf, setObjectColor, obstacleFootprints, removeObject, resetLayout, reviseLayout, stationsForRole } from '../layout.js';
import {
  listLayouts, getLayout, saveLayout, renameLayout, deleteLayout, matchingLayout, sameLayout,
} from './layouts.js';
import { NavGrid } from '../agents/pathfinding.js';
import { movables } from '../scene/movables.js';
import { createEditorGizmos } from './gizmos.js';
import { createPathTrails } from './path-trails.js';
import { createEditorPanel } from './panel.js';
import { candidates, floorFault, reachFault, strandedApproaches } from './placement.js';
import { generateOffice } from '../plan/index.js';
import { officeInfo, setSceneLayout } from '../office/office.js';

/**
 * An edit mode for the office floor.
 *
 * Press `E` and the furniture becomes draggable: pick a prop up, drop it somewhere
 * else, and the paths re-route around wherever it landed. It is an authoring tool for
 * one person — whoever is laying the room out — rather than a feature for anybody
 * watching their agents work, which is why it hides behind a key nobody presses by
 * accident. What it arranges is kept: every accepted change is saved to the scene it
 * belongs to, so a reload — or a second tab, or somebody else holding the keycard —
 * finds the room the way it was left. See `persist`.
 *
 * Three decisions shape everything below.
 *
 * **The office keeps running.** Nothing is paused. Agents go on walking, sitting and
 * fetching coffee while the room is rearranged around them, re-pathing as the walkable
 * map changes under each drop. Freezing would have been easier and would also have hidden
 * the one thing worth watching, which is the paths adjusting — which is also why every
 * walker's route is drawn on the floor while the mode is open (see scene/path-trails.js).
 * A claim like "the paths adjust" ought to be visible rather than taken on trust.
 *
 * **A drop can be refused.** Furniture that overlaps other furniture, leaves the floor,
 * or fences off the coffee machine is not a layout worth having, so the footprint tints
 * red while it is being dragged and the drop reverts. Being able to *see* why is most of
 * the value: the blocked-cell overlay is the nav grid, drawn.
 *
 * **The layout is one mutable singleton.** Dragging writes to the record in
 * `src/config.js` and everything downstream re-derives from it (see `reviseLayout`).
 * There is no second copy of the plan to keep in step.
 */

/** How long an undo history is worth keeping. Plenty for a session of nudging. */
const UNDO_DEPTH = 60;

/**
 * How long after the last change the layout is written to the office.
 *
 * A commit is cheap and frequent — every drop, every add, every undo — and a PATCH is
 * neither. Long enough that nudging a desk into place is one save rather than nine,
 * short enough that letting go and hitting reload keeps what you did.
 */
const SAVE_DEBOUNCE_MS = 500;

/** Anything past this is a drag rather than a click, in device pixels. */
const CLICK_SLOP = 6;

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {THREE.Camera} opts.camera     the office lens; edit mode is not available
 *   while riding an agent, so this is always the orthographic one
 * @param {object} opts.controls         OrbitControls, suspended during a drag
 * @param {THREE.Object3D} opts.scene    where the gizmos are parented
 * @param {() => ?object} opts.getWorld  the live world, or null before the first build
 */
export function createEditor({ canvas, camera, controls, scene, getWorld }) {
  const gizmos = createEditorGizmos(scene);
  // The routes people are walking, which is the other half of what a drop did: the
  // blocked-cell overlay says where walking is possible, these say where it is actually
  // happening. Kept separate from the gizmos because they are the only part of the
  // editor's chrome that changes every frame rather than only when the layout does.
  const trails = createPathTrails(scene);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // The floor, as a mathematical plane. Dragging is an intersection with this rather
  // than a hit on the slab mesh, so a prop can be dragged over another prop — a ray
  // cast at the room would stop on whatever is in the way and the drag would jump.
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_TOP);
  const hit = new THREE.Vector3();

  // A grid of its own, used only to ask "what would the room be like if this went
  // here?". Separate from the one the agents walk, because the answer is needed before
  // the drop is accepted and the agents must not see a room that is about to be undone.
  const probe = new NavGrid();

  let active = false;
  /** @type {?object} the movable being edited */
  let selected = null;
  /** @type {?{grabX: number, grabZ: number, from: object, moved: boolean}} */
  let drag = null;
  let snap = 0.25;
  /** Layout snapshots, oldest first. */
  const undo = [];
  /** @type {?number[]} where the pointer went down, for telling clicks from drags. */
  let downXY = null;
  /**
   * The hole the last deletion left: which kit item it was, and where it stood.
   *
   * So that taking a desk out and putting one back in puts it back where it was, rather
   * than hunting outwards from the middle of the room for a gap and reporting there is
   * none. Only the last one is worth keeping — this is about the pair of
   * keystrokes, not a history of everything ever removed — and it is cleared by anything
   * that moves the furniture underneath it, since the hole may no longer be a hole.
   * @type {?{kit: string, x: number, z: number, facing: ?number}}
   */
  let lastRemoved = null;
  /** @type {?ReturnType<typeof setTimeout>} the pending save, if a change is settling. */
  let saveTimer = null;

  /**
   * Which stable plan the room is standing on: 'default' for the authored room,
   * or the name of a layout off the shelf. The room is in one of three modes —
   * Default, Named, or Edited-on-top-of-one-of-those — and the parent is the
   * "on top of" part: it decides what Save means (write back to the name, or
   * ask for a new one) and what the picker says while you are mid-edit.
   *
   * Never load-bearing for the first two modes: whether the room IS the default
   * or a named layout is re-derived by matching the plan itself (see
   * refreshLayouts). The parent only speaks when the plan matches nothing.
   * @type {string}
   */
  let parent = 'default';

  /**
   * The name a plan arrived with, for a plan that arrived with one: a generated
   * office (`onRoll`) or a pasted blob whose `name` is not on the shelf.
   *
   * Two jobs, and they were one job until the generator arrived. It is what Save
   * offers when it has to ask for a name — and it is what the picker *calls* the
   * room in the meantime, because a generated office is a particular room with a
   * particular name and showing it as "Default" says the one thing it is not.
   */
  let suggested = null;

  /** The seed that generated the plan in the room, if one did. */
  let fromSeed = null;

  const panel = createEditorPanel({
    // The panel's × is the mouse's `E`: the same way out, so the two cannot drift into
    // meaning different things.
    onClose: () => leave(),
    onSnap: (size) => { snap = size; panel.setSnap(size); },
    onPaths: (on) => setPaths(on),
    // One serialisation, three ways out: the clipboard, a downloaded file, and
    // whatever a colleague does with either. The name rides inside the blob, so a
    // layout that arrives by any of them is already called something (see
    // editor/layouts.js).
    onLayoutText: () => JSON.stringify(
      parent !== 'default' ? { ...layoutSnapshot(), name: parent } : layoutSnapshot(), null, 2),
    onLayoutApply: (text) => {
      let blob;
      try { blob = JSON.parse(text); } catch { return false; }
      const ok = commit(() => applyLayout(blob));
      // applyLayout ignores keys it does not know, `name` among them — the name
      // is the editor's business, adopted only once the plan itself was accepted.
      // A name that is on the shelf becomes the parent; one that is not yet is
      // kept as the suggestion for the save that would put it there.
      if (ok && typeof blob.name === 'string' && blob.name.trim()) {
        const name = blob.name.trim();
        if (getLayout(name)) parent = name;
        else suggested = name;
        // A generated layout carries the seed that made it, so a blob pasted from
        // one is still traceable back to its room.
        fromSeed = typeof blob.seed === 'string' ? blob.seed : null;
        refreshLayouts();
      }
      return ok;
    },
    onReset: () => {
      const ok = commit(() => resetLayout());
      // The name goes with the plan: back at the authored room there is no
      // generated office in here any more, and a picker still calling it "The
      // Fernery" the moment you nudged a desk would be describing a room that
      // had been thrown away.
      if (ok) { parent = 'default'; suggested = null; fromSeed = null; refreshLayouts(); }
      return ok;
    },
    /**
     * Roll a whole new office: a fresh seed through the generator (src/plan/),
     * straight into the room.
     *
     * It goes through `commit()` like every other change, which is what makes it
     * a normal edit rather than a mode — one press of ⌘Z puts the old room back,
     * and the layout picker moves to `Default *` because a generated office is
     * exactly that: an edit nobody has saved yet.
     *
     * The name travels the same way a pasted layout's does, through the blob, so
     * a generated room arrives already called something and the name is the
     * suggestion if you go on to save it.
     */
    onRoll: () => {
      const generated = generateOffice();
      if (!commit(() => applyLayout(generated.layout))) return {};
      parent = 'default';
      suggested = generated.name;
      fromSeed = generated.seed;
      refreshLayouts();
      return { ok: true, name: generated.name, seed: generated.seed, reason: generated.reason };
    },
    onAdd: (key) => addPiece(key),
    onChannel: (key, on) => setChannel(key, on),
    onChannelOption: (key, value) => setChannelChoice(key, value),
    onDelete: () => deletePiece(),
    onDuplicate: () => duplicatePiece(),
    onColor: (color) => recolour(color),
    /**
     * Save, as the mode reads it: an edit of a named layout writes straight back
     * to that name; an edit of the Default has no name yet, so the panel is told
     * to ask for one. Never reachable in the other two modes — the button is
     * disabled — but answering emptily there is politer than throwing.
     */
    onLayoutSave: () => {
      const mode = currentMode();
      if (mode.kind !== 'edited') return {};
      if (mode.parent !== 'default') {
        const stored = saveLayout(mode.parent, layoutSnapshot());
        if (!stored) return {};
        refreshLayouts();
        return { ok: true, name: stored.name };
      }
      return { needsName: true, suggest: suggested ?? '' };
    },
    onLayoutSaveAs: (name) => {
      const stored = saveLayout(name, layoutSnapshot());
      if (!stored) return false;
      parent = stored.name;
      suggested = null;
      refreshLayouts();
      return true;
    },
    onLayoutPick: (name) => {
      const stored = getLayout(name);
      if (!stored) return;
      if (commit(() => applyLayout(stored.blob))) {
        parent = name;
        refreshLayouts();
      }
    },
    onLayoutRename: (from, to) => {
      const ok = renameLayout(from, to);
      if (ok && parent === from) parent = to.trim();
      if (ok) refreshLayouts();
      return ok;
    },
    onLayoutDelete: (name) => {
      deleteLayout(name);
      // The room is untouched — only the shelf is. A deleted parent leaves the
      // edit standing on the Default, and the name survives as the suggestion
      // for saving it again, which is the polite undo for a slip.
      if (parent === name) { parent = 'default'; suggested = name; }
      refreshLayouts();
    },
  });
  panel.setSnap(snap);
  panel.setPaths(trails.enabled);

  /**
   * The room's mode, read off the plan itself.
   *
   * Matching beats memory: the authored plan is Default and a plan on the shelf
   * is Named however you arrived at them — five drags that happen to land back
   * on "Cosy Corner" ARE "Cosy Corner". Only a plan matching nothing needs the
   * remembered parent, to say what the edit is an edit of.
   */
  function currentMode() {
    const now = layoutSnapshot();
    const layouts = listLayouts();
    if (sameLayout(now, authoredLayout())) return { kind: 'default', parent: 'default' };
    const match = matchingLayout(now, layouts);
    if (match) return { kind: 'named', name: match, parent: match };
    const onShelf = getLayout(parent);
    return {
      kind: 'edited',
      parent: onShelf ? parent : 'default',
      // The name the plan came in under, and only where the shelf has nothing
      // better to say: an edit of "Cosy Corner" is an edit of Cosy Corner
      // whatever the blob it started life as was called.
      called: onShelf ? null : suggested,
      seed: onShelf ? null : fromSeed,
    };
  }

  /** Re-derive everything the picker and Save show, and adopt the stable parent. */
  function refreshLayouts() {
    const mode = currentMode();
    parent = mode.parent;
    panel.setLayoutState({ layouts: listLayouts(), mode });
  }
  refreshLayouts();

  // --- The room, as the editor sees it -------------------------------------

  /** Every prop that can be picked up, or an empty list before the first world. */
  function pieces() {
    const root = getWorld()?.props?.propsRoot;
    return root ? movables(root) : [];
  }

  /**
   * Put every prop where the layout now says.
   *
   * All of them, not just the one that moved. Cheap — a position write and a rotation
   * each — and it means nothing can be forgotten: a prop whose numbers are unchanged is
   * simply put back where it already was.
   */
  function replaceAll() {
    for (const m of pieces()) m.relocate();
  }

  /**
   * Everywhere somebody has to be able to get to.
   *
   * Read off the prop handles rather than recomputed from the config, because the
   * handles are what the agent layer actually walks to and they have just been brought
   * up to date by `replaceAll()`. Recomputing here would be a second derivation of the
   * same rule, free to disagree with the first.
   */
  function approaches() {
    const props = getWorld()?.props;
    if (!props) return [];
    const out = [];
    for (const desk of props.desks ?? []) out.push({ label: desk.id, at: desk.approach });
    for (const [key, s] of Object.entries(STATIONS)) {
      if (s.approachDist != null) out.push({ label: key, at: s.approach });
    }
    // Every couch, labelled by its own id so the label lines up with the tail of the
    // footprint key — which is how `canBeReached` tells a prop's own standing room from
    // everybody else's. A room may have none, in which case there is nothing to reach.
    for (const entry of props.couches ?? []) {
      out.push({ label: entry.id, at: entry.couch.approach });
    }
    return out;
  }

  /** Nothing was wrong before the change. Shared, so the common case allocates nothing. */
  const NOTHING_STRANDED = new Set();

  /**
   * How much floor a piece takes up, as half-extents, read off its own rectangle.
   *
   * Off the rectangle rather than out of the kind tables, so this cannot come to
   * disagree with what actually blocks the floor — `obstacleFootprints` already lays a
   * kind's `hw`/`hd` onto the world axes for whatever way the piece is pointing, and
   * this is the same answer read back. Which means it is only the piece's *own* width
   * and depth while the piece is square to the room, so callers measure at facing 0.
   *
   * @returns {?{hw: number, hd: number}} null for a piece with no rectangle at all
   */
  function extentOf(key) {
    const r = obstacleFootprints().find((f) => f.key === key);
    return r ? { hw: (r.x1 - r.x0) / 2, hd: (r.z1 - r.z0) / 2 } : null;
  }

  /**
   * Which standing places nobody can reach in the room as it stands.
   *
   * The baseline every check below is measured against — see `strandedApproaches` in
   * editor/placement.js for why one is needed at all. Called at the *start* of a
   * gesture and never per candidate: the answer describes the room before the change,
   * and measuring it midway would fold in whatever the change just broke.
   *
   * @returns {Set<string>} approach labels already unreachable
   */
  function alreadyStranded() {
    return strandedApproaches(approaches(), probe, DOOR.inside);
  }

  /**
   * A room with somewhere nobody can get to says so, in a few words.
   *
   * Not a cause of anything any more — that is the point of `alreadyStranded` — but
   * still a fact about the room worth putting in front of whoever is arranging it.
   * Empty string when the room is sound, so it can be appended unconditionally.
   */
  function strandedNote(stranded) {
    if (!stranded.size) return '';
    const names = [...stranded];
    const list = names.length > 2
      ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
      : names.join(' and ');
    return ` Note: nothing can reach ${list} as the room stands.`;
  }

  /**
   * Is the layout as it currently stands one worth keeping?
   *
   * Asked continuously while dragging, to tint the footprint, and again on release to
   * decide whether the drop stands. Only faults involving the prop in hand are
   * reported: a room may well have a pre-existing overlap somewhere, and refusing every
   * drop because of it would make the editor useless — the same reasoning the coplanar
   * probe uses, where the pairs it already reports are noise and a new one is the bug.
   *
   * `stranded` is how that promise is kept for the reachability half, which used to
   * break it. Anything in it was already unreachable before this gesture began, so it
   * is the room's existing problem and not this prop's — and a prop that is *itself*
   * stranded can still be dragged, which is the only way anybody could fix such a room
   * by hand.
   *
   * @param {string} key  the prop being moved
   * @param {Set<string>} [stranded]  what was already unreachable before the change
   * @returns {{ok: boolean, why: string}}
   */
  function validate(key, stranded = NOTHING_STRANDED) {
    return fitsFloor(key) ?? canBeReached(key, stranded) ?? { ok: true, why: '' };
  }

  /**
   * Say a refusal on the floor as well as in the status line: fill the blocking
   * footprint red for a beat — or the prop's own, for the refusals that have no
   * other rectangle to point at (off the floor, nowhere left to stand).
   */
  function flashRefusal(ownKey, why) {
    const blocker = why.match(/overlapping (\S+)/)?.[1];
    gizmos.flash(blocker ?? ownKey);
  }

  /**
   * The half of `validate` that is only about rectangles: on the floor, and not inside
   * anything else. See `floorFault` in editor/placement.js.
   *
   * Kept first and kept cheap — no grid, no flood fill — because the search for
   * somewhere to put a new piece tries a few hundred positions, and running the whole
   * check on each would mean a few hundred nav rebuilds.
   *
   * @returns {?{ok: boolean, why: string}} a fault, or null if there is none
   */
  function fitsFloor(key) {
    return floorFault(key, obstacleFootprints(), ROOM);
  }

  /**
   * The other half: can everybody still get everywhere? See `reachFault` in
   * editor/placement.js, which is also where the `stranded` baseline is explained.
   *
   * Needs the piece to have been *built*, not merely written into the layout, because
   * it asks the props where people stand.
   *
   * @returns {?{ok: boolean, why: string}} a fault, or null if there is none
   */
  function canBeReached(key, stranded = NOTHING_STRANDED) {
    return reachFault({
      key,
      approaches: approaches(),
      nav: probe,
      from: DOOR.inside,
      stranded,
      // A rug blocks nothing, so it cannot change who can reach what — and saying so
      // here is what stops a rug paying for a flood fill per candidate position.
      soft: !!obstacleFootprints().find((r) => r.key === key)?.soft,
    });
  }

  /**
   * Change the layout, and bring the room into line with it.
   *
   * The one route by which the layout is ever written: dragging, rotating, adding,
   * deleting, importing, undoing and resetting all come through here, so the list of
   * things that have to happen afterwards exists once. In order, because each step reads
   * the one before — the config is re-derived; the room is brought into agreement about
   * what furniture exists, building anything new and unbuilding anything gone; the props
   * are re-placed; the anchors baked out of the mailbox are recomputed; and only then does
   * the agent layer rebuild its walkable map, let go of any furniture that has left the
   * room, and put everybody back on a route that exists.
   *
   * @param {() => boolean} mutate  writes the layout; false to abandon
   * @param {object} [opts]
   * @param {boolean} [opts.remember]  whether this goes on the undo stack. Off for an
   *   undo itself, which must not become something to undo.
   * @param {boolean} [opts.save]  write the result back to the scene. Off for a change
   *   that *came* from the scene: sending it straight back would be a pointless round
   *   trip at best, and at worst a slow argument between two tabs.
   * @param {?object} [opts.before]  the layout to go back to, when the caller has
   *   already written the change. A drag has moved the prop a hundred times by the time
   *   the mouse comes up, so it hands in the snapshot it took when the drag began
   *   rather than pretending the change has not happened yet.
   * @returns {boolean}
   */
  /**
   * Write the layout to the scene it belongs to, a moment after the last change.
   *
   * Fire and forget, exactly like the look a scene rolls the first time anyone opens
   * it: the room on screen is already right, so a failed save costs the *next* visitor
   * the arrangement rather than this one, and there is nothing useful to say to
   * somebody in the middle of moving a chair.
   *
   * The demo office is skipped. Its rooms are authored and shared, so a stranger
   * tidying one would be tidying it for everybody who visits — the same reason the
   * source picker offers them an office of their own instead of letting them repoint
   * this one.
   */
  function persist() {
    if (officeInfo()?.reserved) return;
    const sceneId = getWorld()?.project?.id;
    if (!sceneId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      setSceneLayout(sceneId, layoutSnapshot()).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }

  function commit(mutate, { remember = true, before = null, save = true } = {}) {
    const prior = before ?? exactLayout();
    if (!mutate()) return false;

    // Any accepted change can have filled the hole the last deletion left, so the offer
    // to put one back there expires here. `deletePiece` writes it *after* its own commit,
    // which is what leaves exactly one hole remembered: the one just made.
    lastRemoved = null;

    reviseLayout();
    const world = getWorld();
    world?.props?.sync?.();
    replaceAll();

    world?.mail?.relocate();
    world?.deliveries?.relocate();
    world?.manager?.relayout();

    if (remember) {
      undo.push(prior);
      if (undo.length > UNDO_DEPTH) undo.shift();
    }
    gizmos.refresh(world?.manager?.nav);
    paint();
    // Every committed change can turn the room into, or out of, a stored layout —
    // a drag away from "Cosy Corner" is what lights Save back up.
    refreshLayouts();
    // …and it is the room this scene comes back to. The two are different questions:
    // a named layout is a plan you can pick again in any room, this is where *this*
    // room's furniture stands. Picking "Cosy Corner" therefore also saves it here,
    // which is right — you chose it for this office.
    if (save) persist();
    return true;
  }

  /**
   * Undo the change in hand and put the room back, without touching the undo stack.
   *
   * The counterpart to `commit` for a change that turned out not to be allowed. It is
   * not a commit with a flag, because nothing about it should be remembered: a refused
   * drop never happened.
   */
  function revert(to) {
    applyLayout(to);
    // A refused change can be an addition as easily as a move, so the room is put back
    // to the right *furniture* and not only the right positions.
    getWorld()?.props?.sync?.();
    replaceAll();
    gizmos.refreshLayout(getWorld()?.manager?.nav);
    paint();
  }

  /** A snapshot precise enough to restore from. See `layoutSnapshot`. */
  function exactLayout() { return layoutSnapshot({ round: false }); }

  /**
   * Who works at the selected desk, for the panel's "Assigned to" row.
   *
   * Null for everything that is not a desk, which is how the panel knows to leave the row
   * out altogether — and "No one" rather than null for a desk nobody has claimed, because
   * an unclaimed desk is a real and useful answer when you are deciding whether to delete
   * it. Asked of the live world every repaint rather than cached: agents arrive, go home
   * and inherit desks while the editor is open.
   */
  function assignedTo(sel) {
    if (!sel.key.startsWith('desk:')) return null;
    return getWorld()?.manager?.deskOccupantName(sel.spec.id) ?? 'No one';
  }

  function markerStyle(sel) {
    if (!sel.key.startsWith('desk:')) return null;
    return getWorld()?.props?.desks?.find(d => d.id === sel.spec.id)?.assignmentMarker?.label ?? null;
  }

  function paint() {
    panel.setSelection(selected
      ? {
        label: selected.label,
        key: selected.key,
        x: selected.spec.x,
        z: selected.spec.z,
        facing: selected.spec.facing,
        assignedTo: assignedTo(selected),
        markerStyle: markerStyle(selected),
      }
      : null);
    // The list, and the state of the jobs the room may not go without. Both, because a
    // section with nothing to add is still worth drawing if it is a required job — see
    // `groupKit`.
    panel.setKit(kitItems(), {
      required: JOB_ROLES,
      covered: Object.fromEntries(JOB_ROLES.map((role) => [
        role, stationsForRole(role).map((s2) => STATION_KINDS[s2.kind]?.label ?? s2.kind),
      ])),
    }, { ...CHANNELS });
    // What this item can actually have done to it. Asked here rather than in the panel
    // because the layout is the thing that knows, and asked on every paint because every
    // answer changes with the selection.
    const nothing = { ok: false, why: 'Nothing selected' };
    panel.setCapabilities(selected
      ? {
        turn: canTurnObject(selected.key),
        remove: canRemoveObject(selected.key),
        duplicate: kitKeyOf(selected.key)
          ? { ok: true, why: '' }
          : { ok: false, why: `the room is built with one ${selected.label.toLowerCase()}` },
        palette: paletteOf(selected.key),
      }
      : {
        turn: nothing, remove: nothing, duplicate: nothing, palette: null,
      });
    gizmos.setSelection(selected);
  }

  /**
   * Bring a new piece of furniture into the room, somewhere it fits.
   *
   * Where is the interesting part, and it took two rewrites to get right. Asking for a
   * position would need a click, and a click in this mode already means something, so the
   * room is searched instead: outwards from the middle, and the first spot the editor's
   * own drop check accepts is where it goes. The same check a drag is held to, so a piece
   * can never arrive somewhere a drag could not have put it.
   *
   * Three things earlier attempts got wrong, all found by pressing the button:
   *
   * **A piece has to be allowed to turn.** The stock room is tight, and a desk is nearly
   * three units wide — at a fixed facing there is genuinely nowhere for one, and "nowhere
   * in the room to put that" is a poor answer when turning it ninety degrees would have
   * fitted it into a gap. Each position is tried at every quarter turn the piece has.
   *
   * **The search has to reach the walls.** A search bounded by a ring count stopped
   * before the open floor at the edges. It now sweeps the whole floor, which it can only
   * afford because the cheap half of the check runs first: a few hundred rectangle tests,
   * and the flood fill only for the handful of positions that clear them.
   *
   * **One piece, moved.** The version that broke it added a record per candidate and
   * took it out again — and since ids count past what exists rather than into gaps, every
   * one of those records was called `desk-6`. The props layer matched by name, kept the
   * prop it had already built, and went on reporting the seat and standing room of the
   * first position for every position after it, so a room that refused the first spot
   * refused all of them. It brings one piece into being now and *moves* it, which is
   * exactly what dragging does — and one candidate can no longer be answered with the
   * geometry of another. (The props layer no longer accepts an impostor either; see
   * `syncProps`.)
   *
   * If nowhere works, nothing is added and the panel says so, rather than a prop
   * appearing inside the couch.
   */
  /**
   * Switch a way work arrives on or off.
   *
   * Through `commit` like every other edit, which is what makes it undoable, saved with
   * the room, and pushed to whoever else is watching — a switch is a change to the
   * office, not a preference of this tab. Nothing derives from it geometrically, so
   * there is nothing to validate and no drop to refuse: the room is as walkable with
   * the courier off as on.
   */
  function setChannel(key, on) {
    if (!(key in CHANNELS)) return panel.say(`No such way in: ${key}.`, false);
    const before = exactLayout();
    if (!commit(() => { CHANNELS[key] = on; return true; }, { before })) {
      return panel.say('Could not change that.', false);
    }
    const said = {
      courier: [
        'The delivery person is back on the round.',
        'No more deliveries by hand — everything comes by air.',
      ],
      birds: [
        'The birds are back on the wing.',
        'The aviary rests — every letter comes by paper plane.',
      ],
    }[key] ?? ['Switched on.', 'Switched off.'];
    return panel.say(on ? said[0] : said[1], true);
  }

  /**
   * Pick a switch's option — today, which bird flies the post. Through `commit`
   * for the same reasons as setChannel: it is a fact about the office, undoable
   * and saved with the room.
   */
  function setChannelChoice(key, value) {
    if (key !== 'birdKind' || !BIRD_KIND_OPTIONS.includes(value)) {
      return panel.say('No such choice.', false);
    }
    const before = exactLayout();
    if (!commit(() => { CHANNELS.birdKind = value; return true; }, { before })) {
      return panel.say('Could not change that.', false);
    }
    return panel.say(value === 'roster'
      ? 'The mixed roster flies again — the owl keeps the night shift.'
      : `Every letter now arrives by ${value}.`, true);
  }

  function addPiece(key) {
    const before = exactLayout();
    // Before anything is brought into being, so it describes the room as it was rather
    // than the room with a new prop parked in the middle of it. See `settle`.
    const stranded = alreadyStranded();
    // Where the last one of these was taken out, if the last thing to happen was taking
    // one out. "Delete a desk, add a desk" should put one back in the hole — the floor
    // is provably free, since a desk was standing on it a moment ago.
    const hole = lastRemoved?.kit === key ? lastRemoved : null;
    // Somewhere to start, which the search is about to overwrite: a piece has to exist
    // before it can be tried anywhere, and `addObject` is the only thing that knows how
    // to make one. Refused here means the room is at its limit for this kind.
    const made = addObject(key, {});
    if (!made) return panel.say('No more of those will fit in the room.', false);
    return settle(made, before, {
      stranded,
      from: hole ? { x: hole.x, z: hole.z } : undefined,
      near: hole ? { x: hole.x, z: hole.z } : undefined,
      prefer: hole?.facing,
      arrived: (label) => (hole
        ? `${label} is back where the last one was.`
        : `${label} is in — drag it where you want it.`),
    });
  }

  /**
   * Put a piece that has just been brought into being somewhere it fits, or take it
   * back out again.
   *
   * Shared by Add and Duplicate, which differ only in where the search should start and
   * what to say when it lands. Everything after that is the same operation and has to
   * stay the same operation: the two-stage check, the unremembered commits while
   * candidates are being tried, and the single remembered one at the end that makes an
   * addition one step of undo rather than several.
   *
   * `stranded` has to be measured by the caller, before the piece is brought into
   * being: taken here it would already include anything the new piece is blocking at
   * its default position, and whitelist the very fault the search exists to avoid.
   *
   * @param {{key: string, spec: object}} made
   * @param {object} before  the room to put back if nowhere works
   * @param {{near?: {x: number, z: number}, prefer?: number, clearOf?: {x: number, z: number, r: number},
   *   from?: {x: number, z: number}, stranded?: Set<string>,
   *   arrived: (label: string) => string}} opts
   */
  function settle(made, before, {
    near, prefer, clearOf, from, stranded = NOTHING_STRANDED, arrived,
  }) {
    // Read off the piece's own rectangle rather than a second copy of the kind tables,
    // and while it is still at the facing it was created with, which is nought.
    const extent = extentOf(made.key);
    for (const at of spots({ turns: 'facing' in made.spec, near, prefer, from, extent })) {
      // A piece whose footprint blocks nothing is refused by nothing, so the first spot
      // tried is wherever the search starts — which for a duplicate is the original, and
      // a second rug laid exactly over the first is indistinguishable from the button
      // having done nothing at all. Only the soft-footprinted pieces need this; every
      // other copy is pushed clear by its own original's rectangle.
      if (clearOf && Math.hypot(at.x - clearOf.x, at.z - clearOf.z) < clearOf.r) continue;
      made.spec.x = at.x;
      made.spec.z = at.z;
      if ('facing' in made.spec) made.spec.facing = at.facing;
      reviseLayout();
      // The cheap half needs only the layout, so it throws out almost every candidate
      // for the price of some arithmetic. The expensive half asks the props where people
      // stand, so the piece has to be *built* and put in place first — which is what
      // `commit()` does, and why it is only reached by a position that already fits the
      // floor. Not remembered: a spot about to be refused is not something to be able to
      // undo into.
      if (fitsFloor(made.key)) continue;
      commit(() => true, { remember: false });
      if (canBeReached(made.key, stranded)) continue;

      // Now it is one addition, remembered as one step back to the room before it.
      commit(() => true, { before });
      selected = pieces().find((m) => m.key === made.key) ?? null;
      paint();
      return panel.say(arrived(selected?.label ?? 'It'), true);
    }

    commit(() => applyLayout(before), { remember: false });
    // Say what is wrong with the room as well as with the request. A refusal used to be
    // this sentence and nothing else, which sent everybody looking for floor space —
    // and through the whole of the placement work the floor was never the problem.
    return panel.say(`Nowhere in the room to put that.${strandedNote(stranded)}`, false);
  }

  /**
   * Put a second one of the selected piece in the room, next to the first.
   *
   * Six rugs, or a row of desks, is the obvious thing to want and a tedious thing to do
   * one trip through the picker at a time. A copy is the same kind, turned the same way,
   * and placed as near the original as the room allows — near rather than in the middle,
   * because a duplicate that appears across the room has to be found before it can be
   * used, and finding it is the work the button was meant to save.
   *
   * It copies what the layout holds and nothing else: a duplicate is a second instance,
   * not a second reference, so moving one afterwards never moves the other.
   */
  function duplicatePiece() {
    if (!selected) return panel.say('Nothing selected to duplicate.', false);
    const source = selected;
    const kit = kitKeyOf(source.key);
    if (!kit) {
      return panel.say(`${source.label} cannot be duplicated: the room is built with one.`, false);
    }

    const before = exactLayout();
    // Before the copy exists, for the same reason `addPiece` does it here. See `settle`.
    const stranded = alreadyStranded();
    const made = addObject(kit, {});
    if (!made) return panel.say(`No more ${source.label.toLowerCase()}s will fit in the room.`, false);
    copyLook(source.spec, made.spec);
    return settle(made, before, {
      stranded,
      near: { x: source.spec.x, z: source.spec.z },
      prefer: source.spec.facing,
      clearOf: standOff(source.key),
      arrived: (label) => `${label} duplicated — drag it where you want it.`,
    });
  }

  /**
   * Paint the selection, or hand it back to the room's own theme.
   *
   * Nothing to validate: a colour moves nothing and blocks nothing, so a room that was
   * walkable stays walkable. It still goes through `commit` — that is where the undo
   * step is recorded, and picking the wrong plum should be one press of ⌘Z like every
   * other edit here.
   *
   * @param {?string} color  a name from the prop's palette, or null to follow the room
   */
  function recolour(color) {
    if (!selected) return panel.say('Nothing selected to paint.', false);
    const before = exactLayout();
    if (!setObjectColor(selected.key, color)) return undefined;
    commit(() => true, { before });
    const shown = paletteOf(selected.key)?.options.find((o) => o.key === color);
    return panel.say(`${selected.label} is ${shown ? shown.label.toLowerCase() : 'the room\'s colour'}.`, true);
  }

  /**
   * Move the selection by a small step, the way a drag cannot.
   *
   * A drag gets a piece close; the last few centimetres it fights the pointer for, and
   * on a snapped grid it cannot reach them at all. This is the same operation as a drop
   * — change it, check it, keep it or put it back — because a nudge that could push a
   * couch through a wall would be a second, laxer way into the layout.
   *
   * The step is the snap, so a nudge walks the same lattice a drag lands on and the two
   * cannot disagree about where the cells are. The snap is never nothing — a quarter of
   * a unit is the finest it goes — so there is no second rule for a room without one.
   * Nothing clamps the result: a piece pushed at a wall is refused by the same check
   * that refuses a drag through one, and says so in the same words.
   *
   * @param {number} dx  in room units, -1, 0 or 1
   * @param {number} dz
   */
  function nudge(dx, dz) {
    if (!selected) return panel.say('Nothing selected to move.', false);
    const before = exactLayout();
    const stranded = alreadyStranded();
    const label = selected.label;
    selected.spec.x += dx * snap;
    selected.spec.z += dz * snap;
    reviseLayout();
    replaceAll();

    const verdict = validate(selected.key, stranded);
    if (!verdict.ok) {
      revert(before);
      flashRefusal(selected.key, verdict.why);
      return panel.say(`Not moved: ${verdict.why}.`, false);
    }
    commit(() => true, { before });
    panel.say(`${label} moved.`, true);
  }

  /**
   * How far a copy of this piece has to land from the original to be visible as one.
   *
   * Null for anything whose footprint blocks, because the original's own rectangle
   * already does this job — a second couch cannot be put where the first is. It is the
   * pieces that block nothing that need it, which so far is the rug. Half the longer
   * side, so the copy is at worst half-overlapping and plainly two rugs rather than one.
   *
   * @param {string} key  a footprint key
   * @returns {?{x: number, z: number, r: number}}
   */
  function standOff(key) {
    const rect = obstacleFootprints().find((r) => r.key === key);
    if (!rect || !rect.soft) return null;
    return {
      x: (rect.x0 + rect.x1) / 2,
      z: (rect.z0 + rect.z1) / 2,
      r: Math.max(rect.x1 - rect.x0, rect.z1 - rect.z0) / 2,
    };
  }

  /**
   * Everything about a piece except which one it is and where it stands.
   *
   * A duplicate is a second instance rather than a second reference, so this copies
   * values across and never the record: moving one afterwards must never move the
   * other. Identity and position are what the copy gets for itself; everything else —
   * a plant's species and how big it grew, a rug's colour — is what makes it a copy of
   * *this* piece rather than a fresh one off the picker.
   */
  const IDENTITY = new Set(['id', 'kind', 'x', 'z']);
  function copyLook(from, to) {
    for (const [field, value] of Object.entries(from)) {
      if (!IDENTITY.has(field)) to[field] = value;
    }
  }

  /**
   * Take the selected piece out of the room.
   *
   * No validation on the way out, which is worth saying out loud: removing furniture can
   * only ever open the floor up, so a room that was walkable stays walkable. The one
   * thing that can refuse is the layout itself, keeping the last of something — see
   * `canRemoveObject()`.
   */
  function deletePiece() {
    if (!selected) return panel.say('Nothing selected to remove.', false);
    const { key, label } = selected;
    const verdict = canRemoveObject(key);
    if (!verdict.ok) return panel.say(`Cannot remove ${label}: ${verdict.why}.`, false);
    // Where it stood, and what the picker calls one of these, taken before it goes.
    // `addPiece` reads it back so that adding one of the same kind lands in the hole.
    const hole = {
      kit: kitKeyOf(key),
      x: selected.spec.x,
      z: selected.spec.z,
      facing: selected.spec.facing,
    };
    if (!commit(() => removeObject(key))) return panel.say(`Could not remove ${label}.`, false);
    lastRemoved = hole.kit ? hole : null;
    selected = null;
    paint();
    return panel.say(`${label} removed.`, true);
  }

  /**
   * Every position and facing to try for a piece, best first.
   *
   * The room and the snap are this editor's; everything else about how the search walks
   * the floor — nearest first, quarter turns, the lattice down to the snap, the exact
   * `from` tried ahead of it, and skipping what cannot fit — is `candidates` in
   * editor/placement.js, which is also where the reasoning lives.
   */
  function* spots(opts) {
    yield* candidates({ ...opts, room: ROOM, snap });
  }

  // --- Picking and dragging ------------------------------------------------

  function castTo(event) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  /** The nearest movable at or above whatever the ray struck, or null. */
  function pick(event) {
    const root = getWorld()?.props?.propsRoot;
    if (!root) return null;
    castTo(event);
    for (const struck of raycaster.intersectObject(root, true)) {
      let o = struck.object;
      while (o) {
        if (o.userData?.movable) return o.userData.movable;
        o = o.parent;
      }
    }
    return null;
  }

  /** Where on the floor the pointer is, or null if it is aimed at the sky. */
  function floorPoint(event) {
    castTo(event);
    return raycaster.ray.intersectPlane(ground, hit) ? hit : null;
  }

  function onPointerDown(event) {
    if (!active || event.button !== 0) return;
    downXY = [event.clientX, event.clientY];

    const found = pick(event);
    if (!found) {
      // Bare floor: clear the selection, and leave the camera alone so the room can
      // still be orbited and panned while edit mode is open.
      selected = null;
      paint();
      return;
    }

    selected = found;
    paint();

    const at = floorPoint(event);
    if (!at) return;
    drag = {
      // Where the prop's centre sits relative to the grab, so it does not jump to the
      // cursor: you pick a desk up by its corner and it stays picked up by its corner.
      grabX: found.spec.x - at.x,
      grabZ: found.spec.z - at.z,
      from: exactLayout(),
      // What was already unreachable when the prop was picked up. Measured once, here,
      // because it is a fact about the room *before* the drag: re-measuring it on each
      // move would fold in whatever the drag has just broken and report nothing.
      stranded: alreadyStranded(),
      moved: false,
    };
    // The camera must let go of the mouse for the length of the drag, or moving a desk
    // also orbits the room.
    controls.enabled = false;
    gizmos.setValidity(true);
  }

  function onPointerMove(event) {
    if (!active || !drag) return;
    const at = floorPoint(event);
    if (!at) return;

    // Alt is the escape hatch from the grid, for the odd prop that has to go exactly
    // where the eye says rather than on a quarter.
    const step = event.altKey ? 0 : snap;
    const place = (v) => (step ? Math.round(v / step) * step : v);
    selected.spec.x = place(at.x + drag.grabX);
    selected.spec.z = place(at.z + drag.grabZ);
    drag.moved = true;

    // The prop follows the cursor immediately, and so does everything drawn on the
    // floor — but the walkable map itself does not. That waits for the drop:
    // rebuilding the grid the agents are walking on 60 times a second would have them
    // re-pathing continuously through positions the furniture is only passing through.
    //
    // The red cells used to wait with it and looked stuck, because they were read
    // straight off the grid. They are drawn from the live footprints now, over the
    // grid's own boundaries, so the picture keeps up while the agents' grid holds
    // still — see `refreshCells` in gizmos.js.
    reviseLayout();
    replaceAll();
    const verdict = validate(selected.key, drag.stranded);
    gizmos.setValidity(verdict.ok);
    gizmos.refreshLayout(getWorld()?.manager?.nav);
    panel.setSelection({
      label: selected.label,
      key: selected.key,
      x: selected.spec.x,
      z: selected.spec.z,
      facing: selected.spec.facing,
      assignedTo: assignedTo(selected),
      markerStyle: markerStyle(selected),
    });
    if (!verdict.ok) panel.say(`Cannot drop here: ${verdict.why}.`, false);
  }

  function onPointerUp(event) {
    if (!active) return;
    controls.enabled = true;

    const wasDrag = drag;
    drag = null;
    const slop = downXY ? Math.hypot(event.clientX - downXY[0], event.clientY - downXY[1]) : 0;
    downXY = null;
    if (!wasDrag) return;

    // A press that barely moved is a click, meant to select rather than to nudge — so
    // the prop goes back exactly where it was. Without this a hand shaking by two
    // pixels while choosing a desk would quietly move it.
    if (!wasDrag.moved || slop <= CLICK_SLOP) return revert(wasDrag.from);

    const verdict = validate(selected.key, wasDrag.stranded);
    if (!verdict.ok) {
      revert(wasDrag.from);
      flashRefusal(selected.key, verdict.why);
      return panel.say(`Put back: ${verdict.why}.`, false);
    }

    // The drag has already written the new position, so there is nothing left to mutate
    // — but it still goes through `commit`, which is the only place that rebuilds the
    // walkable map, re-plans the walkers and records an undo step.
    const label = selected.label;
    commit(() => true, { before: wasDrag.from });
    panel.say(`${label} moved.`, true);
  }

  /**
   * Turn the selection a quarter turn.
   *
   * Written the same way round as a drop — change it, check it, keep it or put it back —
   * so both routes into the layout behave alike. A prop with no `facing` has no heading
   * to turn: the rug is the case, and its width and depth are its own.
   */
  function rotate(quarters) {
    if (!selected) return panel.say('Nothing selected to turn.', false);
    if (selected.spec.facing == null) return panel.say(`${selected.label} does not turn.`, false);

    const before = exactLayout();
    const stranded = alreadyStranded();
    selected.spec.facing += quarters * (Math.PI / 2);
    reviseLayout();
    replaceAll();

    const verdict = validate(selected.key, stranded);
    if (!verdict.ok) {
      revert(before);
      flashRefusal(selected.key, verdict.why);
      return panel.say(`Not turned: ${verdict.why}.`, false);
    }
    commit(() => true, { before });
    panel.say(`${selected.label} turned.`, true);
  }

  function stepBack() {
    const previous = undo.pop();
    if (!previous) return panel.say('Nothing left to undo.', false);
    commit(() => applyLayout(previous), { remember: false });
    panel.say('Undone.', true);
  }

  /**
   * Bring the route ribbons up to date. Driven from the render loop.
   *
   * Every frame, and only while the mode is open. A route changes far more often than
   * the layout does — on every step of ordinary walking, when somebody steps round a
   * colleague, when an action list is interrupted, and when a drop re-plans the room —
   * so redrawing on notification would mean subscribing to four different things and
   * would still be one missed case away from a ribbon pointing somewhere nobody is
   * going. Reading the current answer once a frame cannot go stale.
   *
   * The ribbons are drawn from the *live* grid, not the probe grid used to vet a drag,
   * which is why they move on release rather than under the cursor: until a drop is
   * accepted, nobody has been asked to walk anywhere new.
   */
  function tick() {
    if (!active) return;
    trails.update(getWorld()?.manager?.pathTrails() ?? []);
  }

  /**
   * Show or hide the route ribbons, from wherever the ask came.
   *
   * One place, because there are two ways to ask — `P` and the panel's switch — and they
   * must not be able to disagree about what is showing. The trails own the preference and
   * the panel is told what it turned out to be, so the buttons track the key for free.
   *
   * @param {boolean} on
   * @returns {boolean} what it now is
   */
  /**
   * Put the mode away: the panel, the gizmos, the trails and the pointer.
   *
   * Declared rather than only being a method, because the panel's own × closes edit
   * mode too and `panel.hide()` is not that — it would leave every one of those still
   * live behind a panel that had gone.
   */
  function leave() {
    if (!active) return;
    active = false;
    drag = null;
    selected = null;
    controls.enabled = true;
    panel.hide();
    gizmos.hide();
    trails.hide();
  }

  function setPaths(on) {
    const now = trails.setEnabled(on);
    panel.setPaths(now);
    // Nothing has been drawn while they were off, so turning them back on needs a frame's
    // worth of routes immediately rather than at the next tick — otherwise the ribbons
    // appear a frame late, which reads as a stutter on a deliberate action.
    if (now) tick();
    panel.say(now ? 'Showing the routes people are walking.' : 'Routes hidden.', true);
    return now;
  }

  /**
   * Keys that the shortcut registry cannot dispatch.
   *
   * The registry ignores anything held with ⌘, ctrl or alt — deliberately, so browser
   * and OS shortcuts keep working — which rules out ⌘Z. And `[` / `]` are only meaningful
   * with something selected in a mode that is usually off, so binding them globally
   * would put two dead keys in the help panel. They are registered there for
   * documentation, and dispatched here.
   */
  function onKeyDown(event) {
    if (!active) return;
    const target = event.target;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      return stepBack();
    }
    // ⌘D, on the same terms as ⌘Z above: the browser's own binding for it is Bookmark,
    // which is not something anybody means while dragging furniture around a room.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      return duplicatePiece();
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '[') { event.preventDefault(); return rotate(-1); }
    if (event.key === ']') { event.preventDefault(); return rotate(1); }
    // The arrows nudge the selection along the room's own axes rather than the camera's.
    // The room is looked at from a fixed isometric corner, so "up the screen" and "away
    // along -z" are the same direction to anybody using this, and the two never drift
    // apart the way they would if the camera could be spun.
    const NUDGE = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (NUDGE[event.key]) {
      // Two controls in the scene panel step with the arrows while they have focus —
      // the compass dial and the location map — and both are canvases rather than form
      // fields, so the guard at the top of this function does not cover them. A key
      // that turns the sun *and* shoves the couch is a key nobody can use.
      if (target?.closest?.('canvas[role]')) return;
      event.preventDefault();
      return nudge(...NUDGE[event.key]);
    }
    // Backspace as well as Delete, because a full-size keyboard has both and a laptop
    // has one of them. Guarded by the mode and by there being a selection, so neither
    // is a key that does anything surprising to a page.
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      return deletePiece();
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  // On the window rather than the canvas, so a drag that runs off the edge of the
  // canvas still ends: a pointerup nobody hears leaves a desk stuck to the cursor.
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    get isOpen() { return active; },

    tick,

    /**
     * Take a layout somebody else arranged, in another tab or on another machine.
     *
     * The same path an edit of your own takes — the walkable map rebuilt, everybody
     * sitting re-seated, every walker re-routed — because a layout arriving over the
     * wire is not different in kind from one arriving off the mouse, and a second
     * implementation of "apply a layout to a room with people in it" is a second
     * implementation to keep correct.
     *
     * Not remembered and not saved. Undo is a record of what *you* did, and a
     * colleague's change turning up in your undo stack would make ⌘Z do something
     * nobody could predict; saving it would send it back where it came from.
     *
     * Works with the mode closed, which is the ordinary case: somebody watching their
     * agents has no idea the editor exists and should still see the desk move.
     */
    adopt(blob) {
      // `null` is the room going back to the layout authored in `layout.js`, which is
      // what a scene with nothing stored means everywhere else too.
      return commit(() => (blob ? applyLayout(blob) : resetLayout()), { remember: false, save: false });
    },

    /**
     * Show or hide the route ribbons, for `P`.
     *
     * Only meaningful with the mode open, since that is the only time routes are drawn,
     * so pressing it outside says so rather than silently changing something invisible.
     * The preference itself survives closing and reopening the mode.
     */
    togglePaths() {
      if (!active) return false;
      return setPaths(!trails.enabled);
    },

    enter() {
      if (active) return;
      active = true;
      selected = null;
      drag = null;
      panel.show();
      // The ribbon preference outlives the mode, so the switch is redrawn on the way in
      // rather than assumed to still say what it said when the panel was built.
      panel.setPaths(trails.enabled);
      // No opening message: the gestures it used to spell out now stand permanently under
      // the item picker, so the status line starts empty and carries only news.
      //
      // A room with somewhere nobody can get to is news, though, and it is news that
      // arrives no other way: a layout can be imported, or saved before a station
      // existed, and strand something without any drop having been refused.
      // It no longer stops the room being edited, which is exactly why it now has to be
      // said out loud rather than inferred from everything mysteriously failing.
      const stranded = alreadyStranded();
      panel.say(stranded.size ? strandedNote(stranded).trim() : '', !stranded.size);
      paint();
      gizmos.show(getWorld()?.manager?.nav);
      trails.show();
      tick();
    },

    exit: leave,

    toggle() { active ? leave() : this.enter(); },

    /**
     * A new world has been built under us.
     *
     * The layout survives a project switch — it is a singleton in the config, not part
     * of any one world — but every prop in the room is a new object, so the selection
     * is stale and the gizmos are drawn from a grid that has been thrown away. Dropping
     * the selection and redrawing is the whole of it.
     */
    attach() {
      // A scene switch brings that scene's own layout with it (they persist per
      // scene now), which would silently discard the named layout the picker
      // still shows. The selection is a statement of intent, so it is honoured:
      // the saved plan is re-applied to the new room. Not an undo step — nothing
      // the user did — and parent survives because the plan will match it again.
      const kept = getLayout(parent);
      if (kept) commit(() => applyLayout(kept.blob), { remember: false });

      selected = null;
      drag = null;
      // Every agent in the old room has gone with it, and their ribbons are keyed by
      // agent id — which a new office is free to reuse. Dropped rather than left to the
      // pruning in `update`, so nobody inherits a stranger's history.
      trails.clear();
      if (!active) return;
      paint();
      gizmos.refresh(getWorld()?.manager?.nav);
      tick();
    },

    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      gizmos.dispose();
      trails.dispose();
    },
  };
}
