import { FLOOR_TOP, WINDOW_LEDGE_Y } from '../config.js';
import { DESKS, STATIONS, FURNITURE, STATION_KINDS, FURNITURE_KINDS, DECOR, windowTroughPlacements, logoPlacements } from '../layout.js';
import { group, applyMaterialPalette, disposeSubtree } from './build.js';
import { buildPlantKind, buildWindowTrough } from './plants.js';
import { buildAceLogo, buildRovoLogo } from './standees.js';
import { PROPS, buildDesk, buildWallClock } from './props/index.js';
import { movable, movables, unbuild, place, placed, drop } from './movables.js';

// Builds every interior prop and returns interaction handles. Each prop is a
// station with a job:
//   desks        -> working (monitors light up)
//   bookshelf    -> looking things up (agents pull a book out)
//   waterCooler  -> idle refresh
//   couch        -> idle rest (sittable)
//   coffee       -> idle coffee break
//   mailbox      -> delivering finished work
//   bin          -> discarding errored work
//   inbox        -> picking up incoming job material
//   coatStand    -> a coat per agent currently in the office
//   printer      -> nothing yet (see STATION_KINDS in layout.js)

/**
 * @param {THREE.Object3D} scene
 * @param {object} [theme]  the resolved theme; only its `season` is used here,
 *   to plant the window troughs for the right month.
 */
export function buildProps(scene, theme = null) {
  const props = group(0, 0, 0);
  const handles = {};

  // Workstations, and the stations beside them. Both are a loop over the layout
  // rather than a block per prop, because neither list is fixed any more: the editor
  // can add a desk or a second bookshelf, and `sync()` below builds it by the same
  // route as the ones the room was authored with.
  handles.desks = [];
  handles.bookshelves = [];
  // One per telescope, for the same reason: the tube is swept per instance from the
  // frame loop, and `handles.telescope` only ever holds the last one built.
  handles.telescopes = [];
  // Every station's handle under its own instance id, so a behaviour that walked to a
  // *particular* station can talk to that one. `handles[kind]` cannot: it holds
  // whichever was built last, which was invisible while every kind was a singleton and
  // becomes a dead prop the moment one is not — a second inbox whose boxes never go
  // down because `takePackage()` fired on its neighbour.
  handles.byStation = {};
  for (const spec of DESKS) props.add(buildDeskProp(spec, handles));
  for (const s of Object.values(STATIONS)) {
    const obj = buildStationProp(s, handles);
    if (obj) props.add(obj);
  }

  // The free-standing furniture: couches to sit on, tables to put a cup on, lamps to
  // read by. A loop for the same reason the desks and stations are one — the list is not
  // fixed, and a second couch has to arrive by the route the first one did.
  handles.couches = [];
  for (const spec of FURNITURE) props.add(buildFurnitureProp(spec, handles));

  // Digital wall clock on the beige wall, above the coffee machine.
  {
    const spec = DECOR.wallClock;
    const { obj, handle } = buildWallClock(spec);
    obj.position.set(spec.x, spec.y, spec.z);
    obj.rotation.y = spec.facing;
    props.add(obj);
    handles.wallClock = handle;
  }

  // Greenery. Floor plants stand on the slab like any other prop; the troughs go
  // up on the window sills, where they are the one thing indoors that tells you
  // what month it is (see scene/plants.js).
  for (const p of DECOR.plants) props.add(buildPlantProp(p));
  let sill = buildSillDecor(theme);
  props.add(sill);

  // Keep furniture and every interaction handle alive. Only the seasonal sill
  // dressing changes geometry; upholstery already supports repainting in place.
  handles.retheme = (nextTheme) => {
    const old = sill;
    props.remove(old);
    applyMaterialPalette(props);
    for (const m of movables(props)) m.obj.userData.repaint?.(m.spec.color ?? null);
    disposeSubtree(old, { keep: scene });
    sill = buildSillDecor(nextTheme);
    props.add(sill);
  };

  scene.add(props);
  handles.propsRoot = props;
  handles.sync = () => syncProps(props, handles);
  return handles;
}

/** Fixed planting and standees follow the new windows, without moving furniture. */
function buildSillDecor(theme) {
  const props = group();
  const season = theme?.season ?? 'summer';
  // Window troughs are up on the sills and are not floor props, so they are not
  // tagged movable: see docs/developer/editor.md on what deliberately does not move.
  // The mansard's glazed stairwell wall is built with no windows at all (see
  // buildEnvironment) — the plain WINDOWS.back config it would otherwise read
  // still lists two, so without this a trough plants itself on each sill
  // regardless of whether the wall behind it exists.
  const troughExclude = theme?.building === 'mansard'
    ? [{ wall: 'back', window: 0 }, { wall: 'back', window: 1 }]
    : [];
  for (const t of windowTroughPlacements(troughExclude)) {
    const trough = buildWindowTrough({ width: t.width, season });
    trough.position.set(t.x, t.y, t.z);
    trough.rotation.y = t.rotationY;
    props.add(trough);
  }

  // Brand-mark standees, beside the sill planting above. Fixed for the same
  // reason the troughs are: an object on a sill, not furniture on the floor —
  // and placed per building for the same reason too, since the mansard has no
  // back-wall sill for the ace to stand on (see logoPlacements).
  const LOGO_HEIGHT = 0.9;   // 50% over the marks' original 0.6, to read from across the room
  const LOGO_BUILDERS = { ace: buildAceLogo, rovo: buildRovoLogo };
  for (const l of logoPlacements(theme?.building)) {
    const { obj } = LOGO_BUILDERS[l.kind](LOGO_HEIGHT);
    obj.position.set(l.x, WINDOW_LEDGE_Y, l.z);
    obj.rotation.y = l.rotationY;
    props.add(obj);
  }

  return props;
}

/**
 * Build one desk, and register the handle the agent layer sits people at.
 *
 * The index handed to `buildDesk` is the desk's position in the layout, which decides
 * which species of plant stands on it and nothing else — so a sixth desk gets the
 * sixth plant in the cycle and two neighbours still differ.
 */
function buildDeskProp(spec, handles) {
  const { obj, handle } = buildDesk(spec, DESKS.indexOf(spec));
  handles.desks.push(handle);
  return movable(obj, `desk:${spec.id}`, {
    label: spec.id,
    spec,
    relocate: () => handle.relocate(),
    teardown: () => drop(handles.desks, handle),
  });
}

/**
 * Build one station, by kind.
 *
 * The room used to raise these in a block apiece, each naming its own station out of
 * the config — which was the only way to write it while there was exactly one of each.
 * Keyed by kind instead, the same code builds the mailbox the room was authored with
 * and a bookshelf somebody adds in the editor, and neither knows which it is.
 *
 * Every kind hands its handle to `handles.<kind>` *and* to `handles.byStation[id]`.
 * The first is what code wanting *the* mailbox asks for; the second is what code that
 * walked to one particular station asks for, and is the only one that stays correct
 * when a kind has more than one instance. Bookshelves also keep their own list, since
 * something looking for a shelf wants to choose among them.
 *
 * @param {object} s  a station instance out of `STATIONS`
 * @param {object} handles
 * @returns {?THREE.Object3D} tagged movable and ready to add, or null for a kind with
 *   no prop to build
 */
function buildStationProp(s, handles) {
  const def = PROPS[s.kind];
  if (!def) return null;
  if (def.mount) {
    const mounted = def.mount(s, handles);
    // A mount registers its own handle its own way — the mailbox and the coat stand set
    // `handles[kind]`, the bookshelf pushes onto `handles.bookshelves` — so the
    // by-station index has to be filled in after the fact rather than by the line
    // below, which a mount never reaches. Missing this meant `byStation` had no mailbox
    // at all, and `_propAt(mailbox)?.deliver()` silently did nothing: the flag never
    // moved on a delivery. Optional chaining hid it, and the headless tests could not
    // see it because they build no scenery.
    if (handles[s.kind]) handles.byStation[s.id] = handles[s.kind];
    return mounted;
  }
  // The common pattern, which most kinds are: build, face the approach point,
  // register the handle under the kind's own name, and hand the editor a
  // movable that knows how to re-place itself.
  const { obj, handle } = def.build();
  place(obj, s);
  // By kind for everything that wants *the* mailbox, and by id for anything that wants
  // the one it just walked to. Both, because most callers legitimately want the former.
  handles[s.kind] = handle;
  handles.byStation[s.id] = handle;
  return placed(obj, s, STATION_KINDS[s.kind]?.label ?? s.kind);
}

/**
 * Build one piece of free-standing furniture, by kind.
 *
 * The same shape as `buildStationProp`, and for the same reason: three blocks each naming
 * its own singleton out of the config was the only way to write this while there was
 * exactly one couch. Keyed by kind, the couch the room was authored with and a second one
 * added in the editor are built by one path, and neither knows which it is.
 *
 * Only the couch registers a handle, because it is the only one the agent layer has any
 * business with — a table and a lamp are things to look at and walk around. It goes into
 * a list rather than a `handles.couch`, so somebody looking for a seat can be offered
 * every cushion in the room (see `_nearestCouch` in the agent manager).
 *
 * @param {object} spec  a furniture instance out of `FURNITURE`
 * @param {object} handles
 * @returns {THREE.Object3D} tagged movable and ready to add
 */
function buildFurnitureProp(spec, handles) {
  const label = FURNITURE_KINDS[spec.kind]?.label ?? spec.kind;
  const def = PROPS[spec.kind];
  if (!def) return null;
  if (def.mount) return def.mount(spec, handles, label);

  const obj = def.build();
  // `spec.facing` is undefined for a lamp, which does not turn — and `rotation.y` will
  // not take undefined, so it falls back to square rather than to NaN.
  const relocate = () => {
    obj.position.set(spec.x, 0, spec.z);
    obj.rotation.y = spec.facing ?? 0;
  };
  relocate();
  return movable(obj, `furniture:${spec.id}`, { label, spec, relocate });
}

/** Build one floor plant. Its species is the only name it has worth showing. */
function buildPlantProp(p) {
  const plant = buildPlantKind(p.kind, p.scale, { seasonal: p.seasonal });
  plant.position.set(p.x, FLOOR_TOP - 0.02, p.z);
  // A plant turns. Its footprint is a square either way, so the heading changes nothing
  // about where people walk — but a monstera's leaves point somewhere, and which way a
  // fig leans is the difference between a plant in a corner and a plant in the way.
  plant.rotation.y = p.facing ?? 0;
  return movable(plant, `plant:${p.id}`, {
    label: `${p.kind} plant`,
    spec: p,
    relocate: () => {
      plant.position.set(p.x, FLOOR_TOP - 0.02, p.z);
      plant.rotation.y = p.facing ?? 0;
    },
  });
}



/**
 * Bring the room into agreement with the layout about *which furniture exists*.
 *
 * The editor's `replaceAll()` puts every prop where the layout now says, which was the
 * whole job while the furniture was a fixed set that could only be moved. Now that a
 * desk or a bookshelf can be added and taken away, something has to build the one and
 * unbuild the other, and this is it: a reconciliation rather than an add and a remove,
 * so one function covers a deliberate addition, an undone one, an imported layout with
 * furniture this room has never had, and a reset back to the authored five desks.
 *
 * Only the four families that can change are considered. The clock is in the room by
 * construction — one per wall, screwed to it — so it is never a candidate for removal
 * however little the layout says about it.
 *
 * A prop counts as the one the layout means only if it was built from *the very record
 * the layout now holds*, and not merely from something that shared its name. Ids are
 * reused — they count past what exists rather than into gaps, so a piece taken out and
 * another put in are both `desk-6` — and a prop built from the first record goes on
 * reading its position, which is a record nothing will ever write to again. It sits
 * wherever that dead record last said, and reports its seat and its standing room from
 * there, so the editor's checks are answered about a room nobody can see. That is what
 * had `Add` able to place a piece in one spot only: every position the search tried after
 * the first was judged against a prop still standing in the first, and refused. Comparing
 * the records rather than the names costs an identity test per prop and cannot go stale.
 *
 * @param {THREE.Object3D} root  the props group
 * @param {object} handles
 * @returns {{added: number, removed: number, rebuilt: number}}
 */
function syncProps(root, handles) {
  const built = new Map(movables(root).map((m) => [m.key, m]));
  const wanted = [
    ...DESKS.map((spec) => [`desk:${spec.id}`, spec, () => buildDeskProp(spec, handles)]),
    ...Object.values(STATIONS).map((s) => [`station:${s.id}`, s, () => buildStationProp(s, handles)]),
    ...FURNITURE.map((spec) => [`furniture:${spec.id}`, spec, () => buildFurnitureProp(spec, handles)]),
    ...DECOR.plants.map((p) => [`plant:${p.id}`, p, () => buildPlantProp(p)]),
  ];

  let added = 0;
  let rebuilt = 0;
  for (const [key, spec, make] of wanted) {
    const there = built.get(key);
    if (there && there.spec === spec) continue;
    // Same name, different record: unbuild the impostor first, so what follows is the
    // ordinary business of building something the room does not have.
    if (there) {
      unbuild(there);
      built.delete(key);
      rebuilt += 1;
    }
    const obj = make();
    if (!obj) continue;
    root.add(obj);
    if (!there) added += 1;
  }

  // Stations that have left the room take their handle with them. Pruned here rather
  // than in a teardown because it is a fact about the whole set — one pass over what
  // survives cannot leave an entry behind, where a per-prop hook can be missed.
  const liveStations = new Set(Object.values(STATIONS).map((st) => st.id));
  for (const id of Object.keys(handles.byStation ?? {})) {
    if (!liveStations.has(id)) delete handles.byStation[id];
  }

  let removed = 0;
  const keep = new Set(wanted.map(([key]) => key));
  for (const [key, m] of built) {
    if (keep.has(key) || !CHANGEABLE.test(key)) continue;
    unbuild(m);
    removed += 1;
  }
  return { added, removed, rebuilt };
}

/** Footprint keys for the families that can come and go. */
const CHANGEABLE = /^(desk|station|furniture|plant):/;


