// Central palette + layout config for The Roving Office.
// Everything (props, stations, nav-grid obstacles) derives from here so the
// visual layout and the walkable map can never drift out of sync.

// The default (brownstone) palette. Themes override slices of this; the live
// palette is `COLORS` below, which is mutated in place by applyPalette() so the
// hundreds of build-time `COLORS.x` reads across the scene pick up a new theme
// without every builder needing a palette argument threaded through it.
const BASE_COLORS = {
  wallSage: 0x9fb79b,
  wallWhite: 0xeae7dd,
  baseboard: 0xf2efe6,
  floorWood: 0xc79f68,
  floorWoodAlt: 0xba9059,
  // Alternative floor finishes, selected by the theme's `floor.kind`.
  floorConcrete: 0x9c9e9f,
  floorConcreteAlt: 0x94969a,
  floorSeam: 0x7f8285,
  floorCarpet: 0x8d8577,
  floorCarpetAlt: 0x847c6f,
  rugSage: 0xa9c4a6,
  woodDark: 0x6f4b31,
  woodMid: 0x8a5a38,
  frame: 0x5a3d29,
  glass: 0x9fc4d6,
  terracotta: 0xbf6f4c,
  couch: 0xcf8368,
  leaf: 0x6f9e6a,
  leafDark: 0x4f7a4c,
  grass: 0x7fa86b,
  pot: 0xc0714f,

  // Houseplants. Held apart from `leaf`/`leafDark` above, which every season
  // repaints for the street outside — amber in autumn, blossom in spring. Most of
  // the office's planting is evergreen and uses these, so the room reads green in
  // every month; the plants that do turn with the season are the ones standing on
  // the open edges and in the window bay, and the troughs on the sills, which ask
  // for the seasonal pair instead (see scene/plants.js).
  houseLeaf: 0x5d9163,
  houseLeafDark: 0x41714e,
  houseLeafLight: 0x86b46f,
  cactusGreen: 0x7d9e6a,
  cactusDark: 0x62815a,
  soil: 0x3a2b1f,
  bloomWarm: 0xe4a13c,     // cactus flower, violet heads
  bloomCool: 0xc079b8,
  metalDark: 0x2b2f36,
  paper: 0xf4f1e8,
  mailbox: 0x3f6b8a,

  // Cardboard, shared so the parcel an agent carries, the pile beside the mailbox
  // and the one a courier throws are all visibly the same box. Three places wanted
  // these numbers and two of them had them written out by hand.
  parcel: 0xbf9b6a,
  parcelTape: 0xd9c39a,
  // Brown for the courier's uniform. Deliberately darker than the cardboard, or
  // driver and delivery merge into one brown smudge at this camera distance.
  courier: 0x6b4a2f,
  sky: 0xbcd3dd,

  // Exterior
  road: 0x6f7378,
  roadLine: 0xe8e4d2,
  sidewalk: 0xb6b2a8,
  curb: 0x9b978d,
  buildingA: 0x9a6b52,
  buildingB: 0x8a8f96,
  buildingC: 0xa8907c,
  buildingD: 0x6f7d84,
  windowLit: 0xffe0a8,
  // `windowDark` was declared twice in this table — 0x3e4a55 here and 0x2c3a44
  // in the storeys section below — and a later key silently wins, so 0x2c3a44 has
  // always been the value everything renders with. The shadowed one is removed
  // rather than restored: bringing 0x3e4a55 back would visibly relight every
  // unlit window, which is a look change and not a lint fix.

  // Aeron chair
  aeronFrame: 0x1e2126,
  aeronMesh: 0x3c4249,
  aeronGraphite: 0x33373d,

  // Water cooler
  coolerBody: 0xe9ebee,
  coolerWater: 0x8fc9de,

  // Printer
  printerBody: 0xe4e6ea,   // off-white shell, a shade cooler than the water cooler's
  printerPanel: 0x2f343a,  // control panel, the lid seam, the mouth of the output tray
  printerTrim: 0x9aa0a6,   // plinth, tray handles, the paper shelf

  // Winter dressing (only used by snowy exteriors).
  snow: 0xf2f6f8,
  snowShade: 0xdfe8ee,

  // The roof, for the buildings that have one over their two standing walls (see
  // scene/building.js). Timber by default, because the first roof was a chalet's;
  // a theme with a different one — zinc, say — overrides these two.
  roofPlane: 0x7a5637,
  roofTrim: 0x5c3f28,
  chimneyPot: 0xb2643f,
  branchBare: 0x6b5a4b,
  evergreen: 0x3f6b4f,
  evergreenDark: 0x2f5540,

  // High-rise dressing (rooftops seen from an upper floor).
  roofDeck: 0x8e8b86,
  roofUnit: 0xa8a5a0,
  roofTar: 0x6d6a66,
  haze: 0xc9d8e2,

  // Autumn foliage and leaf litter.
  autumnLeaf: 0xd98324,
  autumnLeafAlt: 0xb5541f,
  autumnLeafDeep: 0x8c3b16,
  autumnLitter: 0xbe7433,

  // Structure of the storeys visible below this floor.
  slabEdge: 0xd6d2c8,      // exposed concrete floor-slab edge
  facadeLower: 0xb9b3a6,   // spandrel / wall panel of the level below
  windowDark: 0x2c3a44,    // unlit glazing on a lower level
  windowFrame: 0x59636c,   // steel window surrounds and glazing bars
  shutter: 0x7e8489,       // roller shutter / loading door leaf
  shutterRib: 0x6a7076,    // the slat lines across it
  mullion: 0xb9bfc4,       // anodised aluminium curtain-wall mullion
  spandrel: 0x39434c,      // dark spandrel panel at each floor line
  brickPier: 0x8d5540,     // pilasters between arcade bays
  brickShade: 0x8a5038,    // recessed bay panel behind an arch
  baseCourse: 0x8f9195,    // painted plinth band along the pavement
  signPaint: 0xd9d3c6,     // weathered painted signage on brick
};

/**
 * The live palette. Same object identity for the whole session, so modules that
 * imported it see theme changes immediately (they all read `COLORS.x` at build
 * time, never destructure at import time).
 */
export const COLORS = { ...BASE_COLORS };

/**
 * Reset the live palette to the defaults, then apply a theme's overrides.
 * Call this before rebuilding the scene.
 */
export function applyPalette(overrides = {}) {
  for (const key of Object.keys(COLORS)) delete COLORS[key];
  Object.assign(COLORS, BASE_COLORS, overrides);
  return COLORS;
}

/**
 * What an agent is doing, in four families.
 *
 * A status answers two questions at once — "is this one busy?" and "busy doing
 * what?" — and the palette now says so: one hue per family, and shades of it for
 * the members. Idle is grey whatever kind of idle it is, work is green whether
 * it is typing, reading or blocked, and moving is blue for both walks and dances.
 * You can read the office at a glance from the floor rings without knowing a label.
 *
 * Delivering is the exception, deliberately: success is the family's violet, but
 * a binned job keeps the red that every screen in the world uses for a bad end.
 * The grouping in the legend carries the kinship there, rather than the hue.
 *
 * This is the single source of truth — STATUS_COLORS and STATUS_LIST below are
 * derived from it, so a new status is added in exactly one place.
 */
export const STATUS_GROUPS = [
  {
    key: 'idle', label: 'Idle', color: 0x9aa1a9,
    statuses: [
      // `bare` marks a family's plain case: the one its heading already names, so
      // it is counted under "Idle" and given no row of its own. A row reading
      // "idle · nothing on" was the label saying the same thing twice.
      { key: 'idle', label: 'nothing on', color: 0x9aa1a9, bare: true },
      { key: 'resting', label: 'resting', color: 0x78848f },
      // `alone` is the word for a panel that shows the status by itself, where the
      // family heading is not there to lean on: a legend row under "Idle" reads
      // "drink" perfectly well, and a roster row reading "Drink" does not. Only
      // this one needs it — everywhere else the legend's word capitalises into a
      // sentence about a person unchanged, which is what keeps the two panels
      // saying the same word for the same dot.
      { key: 'drinking', label: 'drink', color: 0xc2c9cf, alone: 'Getting a drink' },
    ],
  },
  {
    key: 'working', label: 'Working', color: 0x59b36f,
    statuses: [
      { key: 'working', label: 'writing', color: 0x59b36f },
      { key: 'researching', label: 'researching', color: 0x3f9f8e },
      { key: 'waiting', label: 'waiting', color: 0x9fbf5e },
    ],
  },
  {
    key: 'delivering', label: 'Delivering', color: 0xb489e0,
    statuses: [
      { key: 'delivering', label: 'success', color: 0xb489e0 },
      { key: 'error', label: 'error', color: 0xe06767 },
    ],
  },
  {
    key: 'moving', label: 'Moving', color: 0x6fb1e0,
    statuses: [
      { key: 'walking', label: 'walking', color: 0x6fb1e0 },
      { key: 'dancing', label: 'dancing', color: 0x4688ec },
    ],
  },
];

/** Every status, flattened, in legend order. */
export const STATUS_LIST = STATUS_GROUPS.flatMap((g) => g.statuses.map((s) => s.key));

/** Status -> color. Derived from STATUS_GROUPS; do not edit by hand. */
export const STATUS_COLORS = Object.fromEntries(
  STATUS_GROUPS.flatMap((g) => g.statuses.map((s) => [s.key, s.color]))
);

const STATUS_INDEX = new Map(
  STATUS_GROUPS.flatMap((g) => g.statuses.map((s) => [s.key, { group: g, status: s }]))
);

/**
 * A status in one word: "Writing", "Researching", "Delivered".
 *
 * One word, because the family is already on the row in colour — the lozenge
 * beside the name is the green of Working — and the specific word implies it
 * anyway. This used to name the family first and shade it second, which wrote
 * the state twice ("Working · writing") and pushed the job title that follows
 * it onto a second line for nothing.
 *
 * A lone member speaks for its whole family, as does a family's plain
 * case ("Idle"), and an unknown status is passed through rather than swallowed —
 * a harness inventing a word should show up as that word, not as a blank.
 *
 * The legend keeps the short lowercase labels: its rows sit indented under the
 * family heading, which is the one place the family word is not a repetition.
 */
export function statusLabel(key) {
  const found = STATUS_INDEX.get(key);
  if (!found) return key ?? '';
  const { group, status } = found;
  if (group.statuses.length === 1 || status.bare) return group.label;
  return status.alone ?? status.label[0].toUpperCase() + status.label.slice(1);
}

/**
 * Job-log outcomes: a warm ramp, and warm on purpose.
 *
 * These describe a piece of work, not a person, and the two vocabularies used to
 * be told apart only by a comment — the log's three colours were literally the
 * status palette's walking blue, working green and error red, so a green dot
 * meant "this agent is typing" in one panel and "this job is finished" in the
 * one below it. Paper is warm here and people are cool, and nothing in the
 * status palette is amber, tan or rust.
 */
export const JOB_COLORS = {
  active: '#e8ab52',    // open, still warm
  done: '#ab7f57',      // settled
  error: '#a85a33',     // binned
};
// -- Rugs you can choose ----------------------------------------------------
/**
 * The colours a rug can be set to in the editor.
 *
 * A choice here *overrides* the room, which is why "no choice" is a real state and the
 * default one: `rugSage` above is part of the theme and every project repaints it (see
 * `projects.js`), so a room that has never been asked about its rug should go on
 * following its season and its scene. Once somebody picks a colour, they have said
 * something the theme does not get to overrule.
 *
 * Six, because it is enough to make the choice feel like a choice and few enough to
 * read as a row of swatches rather than a colour picker. They are the colours a real
 * office rug comes in — muted, dust-coloured, nothing that competes with the people
 * standing on it.
 */
/**
 * The colours a couch or an armchair can be upholstered in.
 *
 * Each names its own accent, which is the cushion at the small of your back. Written
 * down as a pair rather than computed, because "a contrasting colour" is a judgement and
 * a hue rotation is not one: moss wants ochre and navy wants clay, and neither is what
 * an algorithm hands you. Six, for the reason `RUG_COLORS` has six.
 *
 * The seat cushions are not here. They are the body colour lifted toward white, always,
 * so a repainted sofa cannot end up with cushions off some other sofa — which is exactly
 * what the couch had: a hardcoded terracotta seat under a body colour every project
 * repaints, so the green velvet couch in the Paris scene sat on terracotta cushions.
 */
export const SOFA_COLORS = {
  terracotta: { label: 'Terracotta', hex: 0xcf8368, accent: 0x9fb3c8 },
  moss: { label: 'Moss', hex: 0x7f9068, accent: 0xd9a441 },
  navy: { label: 'Navy', hex: 0x4d6180, accent: 0xd98f6a },
  mustard: { label: 'Mustard', hex: 0xc9a24a, accent: 0x5f7f86 },
  charcoal: { label: 'Charcoal', hex: 0x5a5f66, accent: 0xc98a5c },
  blush: { label: 'Blush', hex: 0xc98b93, accent: 0x7f9a86 },
};

export const RUG_COLORS = {
  sage: { label: 'Sage', hex: 0xa9c4a6 },
  clay: { label: 'Clay', hex: 0xc08a6e },
  sand: { label: 'Sand', hex: 0xd3c09a },
  slate: { label: 'Slate', hex: 0x8d99a6 },
  plum: { label: 'Plum', hex: 0x9c8299 },
  ink: { label: 'Ink', hex: 0x5f6a75 },
};


// Room footprint. Interior spans x:[0,W] z:[0,D]; only the two far walls exist
// (z=0 "back" wall in sage, x=0 "left" wall in white) so it reads as a cutaway.
export const ROOM = {
  W: 26,
  D: 20,
  H: 8,
  wallT: 0.4,
};

// The door lives in the back (sage) wall. Agents enter and exit through it.
export const DOOR = {
  x: 3.4,          // centre along the back wall
  width: 2.8,
  height: 5.0,
  inside: { x: 3.4, z: 2.4 },    // interior staging point just inside
  outside: { x: 3.4, z: -2.2 },  // on the entrance stoop (spawn / despawn)
  stoopDepth: 3.0,               // stoop reaches from the wall out to z = -3.0
};

/**
 * Height of a window opening: sill and head, in world units above the floor.
 *
 * Shared for the same reason as STREET_Y and FLOOR_TOP below. Three places need
 * to agree on where the glass starts and stops — the wall that cuts the opening,
 * the paper planes that fly in through it, and the planted troughs that stand on
 * its inner sill — and until now two of them carried the number by hand, one
 * with a `// matches environment.js` comment holding it in place.
 */
export const WINDOW_SILL_Y = 2.2;
export const WINDOW_HEAD_Y = ROOM.H - 1.2;

/** Thickness of a window's timber frame; its bottom rail is the inner sill. */
export const WINDOW_FRAME_T = 0.28;

/** Top of that rail — the ledge a plant pot can actually stand on. */
export const WINDOW_LEDGE_Y = WINDOW_SILL_Y + WINDOW_FRAME_T / 2;

/**
 * How a window is divided into lights: three across, two up, on glazing bars this
 * thick.
 *
 * Here rather than in `buildWindow()`, and for the same reason the sill height is
 * here: something other than the builder needs the answer. The bars are the only
 * solid things *inside* an opening, so anything that has to pass **through** the
 * glass has to know where they are — and the birds do. They flew straight
 * across both mullions and the transom for as long as this was a pair of local
 * constants in the builder, because there was no way to ask.
 */
export const WINDOW_LIGHTS = { cols: 3, rows: 2, barT: 0.1, barD: 0.3 };

/**
 * How deep the frame sits through the wall.
 *
 * The slab a bird is actually *in* the window for, which is a much smaller stretch of
 * its flight than the width of its own shadow suggests: a bird two units inside the
 * room can still share a bounding box with a mullion lengthwise without going near it.
 */
export const WINDOW_FRAME_D = 0.5;

/**
 * One light's clear opening: the hole, not the pane.
 *
 * Inset by half a bar on every divided edge and by half the frame at the outside
 * edges, so the rectangle returned is what something could actually fly through
 * without touching timber. `col` counts from the low end of the wall axis, `row`
 * from the sill up.
 *
 * @param {'back'|'left'} wall
 * @param {number} index  which opening in that wall
 * @param {number} col
 * @param {number} row
 * @returns {?{axis: 'x'|'z', from: number, to: number, centre: number,
 *   y0: number, y1: number, midY: number, width: number, height: number}}
 */
export function windowLight(wall, index = 0, col = 0, row = 0) {
  const span = windowSpan(wall, index);
  if (!span) return null;
  const { cols, rows, barT } = WINDOW_LIGHTS;
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;

  const cellW = span.width / cols;
  const cellH = (WINDOW_HEAD_Y - WINDOW_SILL_Y) / rows;
  // Half a bar off each shared edge, half the frame off each outer one.
  const edge = (i, n) => (i === 0 || i === n ? WINDOW_FRAME_T / 2 : barT / 2);
  const from = span.from + cellW * col + edge(col, cols);
  const to = span.from + cellW * (col + 1) - edge(col + 1, cols);
  const y0 = WINDOW_SILL_Y + cellH * row + edge(row, rows);
  const y1 = WINDOW_SILL_Y + cellH * (row + 1) - edge(row + 1, rows);

  return {
    axis: span.axis,
    from, to, centre: (from + to) / 2,
    y0, y1, midY: (y0 + y1) / 2,
    width: to - from, height: y1 - y0,
  };
}

// Window openings per wall, expressed as fractions along the wall length so
// they stay clear of the door and the bookshelf. `center` is a fraction of the
// wall's own length, measured along the wall as it is built — which is not the
// same direction as the world axis on both walls, so ask windowSpan() below
// rather than multiplying it out by hand.
export const WINDOWS = {
  back: [
    { center: 0.33, width: 6.0 },   // x  5.58 .. 11.58
    { center: 0.70, width: 6.5 },   // x 14.95 .. 21.45
  ],
  left: [
    { center: 0.62, width: 6.5 },   // z  4.35 .. 10.85 (mirrored: see below)
  ],
};

/**
 * Where a window opening actually is in the room, along the wall it is cut into.
 *
 * The two walls are built differently: the back wall runs with world x, while the
 * left wall is a quarter turn round, so its local +x points at world −z and its
 * openings come out mirrored. That catches callers out — the paper planes flew in
 * at `center * ROOM.D`, which on this wall is a point in solid plaster five units
 * past the glass — so anything that has to line up with a window asks here.
 *
 * @param {'back'|'left'} wall
 * @param {number} index  which opening in that wall
 * @returns {?{axis: 'x'|'z', centre: number, width: number, from: number, to: number}}
 */
export function windowSpan(wall, index = 0) {
  const win = WINDOWS[wall]?.[index];
  if (!win) return null;
  const len = wall === 'back' ? ROOM.W : ROOM.D;
  const centre = wall === 'back' ? win.center * len : (1 - win.center) * len;
  return {
    axis: wall === 'back' ? 'x' : 'z',
    centre,
    width: win.width,
    from: centre - win.width / 2,
    to: centre + win.width / 2,
  };
}

/**
 * Height of the road surface relative to the office floor it sits under.
 *
 * Shared, because two separate places need to agree on it: the exterior lays its
 * ground at this height, and `building.js` sizes the plinth under the lowest
 * storey to reach it. When they disagree the building visibly floats.
 */
export const STREET_Y = -1.3;

/**
 * The floor slabs are centred on y = 0 and this thick, so the surface agents and
 * props actually stand on is `FLOOR_TOP` — not zero.
 *
 * Shared for the same reason as STREET_Y: this number was previously known in
 * three separate places by hand. The rug carried a literal 0.11, the stoop a
 * literal 0.1, and anything modelled from y = 0 sat a slab's half-thickness too
 * low. Mostly that is invisible, because the sunken part is buried inside opaque
 * slab — but a prop whose base is exactly FLOOR_TOP tall disappears entirely and
 * lands its top face in the floor's own plane, where the two flicker against each
 * other. Derived from the thickness rather than written out, so the two cannot
 * drift apart.
 */
export const FLOOR_THICKNESS = 0.2;
export const FLOOR_TOP = FLOOR_THICKNESS / 2;


// Camera (orthographic isometric). Orbit is allowed but constrained so the
// scene always reads as a cosy diorama rather than flipping behind the walls.
export const CAMERA = {
  frustum: 22,
  position: [26, 25, 26],
  target: [12, 1.5, 10],
  minZoom: 0.7,
  maxZoom: 8,  // close enough to inspect one desk and its materials
  allowRotate: true,
  // Vertical tilt limits (radians from straight down).
  minPolarAngle: Math.PI * 0.16,
  maxPolarAngle: Math.PI * 0.44,
  // How far the camera may swing left/right of its default heading.
  azimuthRange: Math.PI * 0.28,
  // ctrl/⌘/shift + drag pans across the ground plane, clamped to this box so
  // the office can't be pushed off screen.
  panBounds: { minX: -6, maxX: ROOM.W + 6, minZ: -6, maxZ: ROOM.D + 6 },
};

// Riding along behind an agent's eyes (`f` with one selected). This is a second,
// perspective camera: the office is normally drawn orthographically, which has no
// viewpoint to stand at, so a first-person view has to be its own lens rather than
// a repositioning of the usual one.
export const FPV = {
  // Wide enough to read as a head rather than a telescope. 72 was the first guess
  // and it was too tight: at desk distance a narrow lens crops to a monitor and a
  // patch of desk, which reads as zoomed-in rather than as standing there. 85 takes
  // in the desk, its neighbours and the room behind — still short of the 90-plus
  // where the barrel distortion starts announcing itself at the edges.
  fov: 85,
  // The eye sits a hair in front of the face, so the near plane does not have to
  // do the work of hiding the agent's own head — but keep it tight anyway, since
  // a desk edge two near-planes away should not vanish when they lean in.
  near: 0.1,
  far: 400,
  // Offsets from the centre of the head box (0.62 on a side, so its face is at
  // 0.31). Deliberately *inside* the head rather than just in front of it: an eye
  // parked ahead of the face pokes through anything the agent stands close to, and
  // they stand very close to desks and bookshelves. From within, the body's own faces
  // are back-facing and culled, and the agent's own name tag is dropped by the
  // proximity fade below — but the hair is not, which is why the head is hidden
  // outright while ridden. See Agent.setHeadVisible.
  eyeForward: 0.12,
  eyeUp: 0.1,
  // A few degrees below level, which is where a person walking somewhere actually
  // looks: at the floor ahead, not the horizon. The agents are also tall next to
  // their furniture — eyes at 2.3, desks at 1.1 — so a little down puts the desk in
  // the frame. Negative tilts down; 0 is dead level.
  //
  // This was briefly -16, to duck a black band across the top of every shot that I
  // had put down to an unlit ceiling slab. It was the agent's own hair, a tenth of a
  // unit from the eye (see Agent.setHeadVisible). Hiding the head removed it at every
  // angle, so the tilt no longer has to pay for it and is back to being about where
  // people look. Worth remembering that a wider `fov` opens upward as well as down.
  pitchDeg: -7,
  // The walk cycle already bobs the body 0.07, which is the whole charm of the
  // view; this only takes the edge off the sharpest turns. Higher is snappier.
  smoothing: 18,
  // Name tags fade out as their owner gets close. Depth-testing them (see
  // `Agent.setTagMode`) stops them punching through furniture, but nothing stops a
  // label two feet from your face filling the frame — a perspective camera makes it
  // enormous however small it is in world units. Someone that close is legible as a
  // person anyway; the label is what is in the way. Invisible at or below `near`,
  // fully drawn at or beyond `far`, ramped between.
  tagFadeNear: 1.5,
  tagFadeFar: 3.2,
};
