import * as THREE from 'three';
import { COLORS, STREET_Y } from '../config.js';
import { spread } from '../dice.js';
import { archFill, archRing, box, group, mat, put } from './build.js';
import { markLitWindow } from './night-lights.js';

/**
 * The storeys below the open office floor.
 *
 * Only the floor we are watching is cut away; every level beneath it is a
 * complete, enclosed building. Two treatments are supported: `glazed`, a
 * curtain-walled tower, and `solid`, a brick warehouse whose ground floor is a
 * proper arcade of arched openings.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES, BOTH LEARNED THE HARD WAY
 *
 * 1. A wall must be *rotated* into the face it belongs to. Build it in local
 *    space (length along x, thickness along z) and rotate the group. A builder
 *    that accepts an orientation and ignores it puts side walls straight across
 *    the middle of the building.
 *
 * 2. Every surface must sit at its own depth, AT OR IN FRONT OF the wall face.
 *    These walls are solid boxes with no holes punched in them, so anything
 *    positioned "recessed into a reveal" is simply inside the backing and never
 *    renders at all. Two surfaces sharing a depth is equally bad: coplanar faces
 *    fight in the depth buffer and the facade shimmers. Hence the depth ladder
 *    below — every element gets a distinct, positive offset from the wall face.
 * ---------------------------------------------------------------------------
 */

export const STOREY_H = 7;       // height of one complete building level

// Slab edge expressed at each floor line.
const SLAB_H = 0.42;
const SLAB_PROUD = 0.12;

// Glass and lighting.
const GLASS_T = 0.1;
const LIT_EVERY = 5;             // roughly one window in five is lit

// --- The depth ladder --------------------------------------------------------
// Outer face of each element = wallT / 2 + offset. All strictly positive, all
// distinct, ordered from the wall outwards.
const D_SIGN = 0.03;             // painted signage, flat against the brick
const D_GLASS = 0.05;            // glazing and door leaves
const D_BARS = 0.10;             // glazing bars, shutter ribs, vision panels
const D_RING = 0.15;             // arch rings
const D_IMPOST = 0.20;           // the cross beam under an arch head
// The slab edge band is not on this ladder, and that is a trap: it straddles the
// wall line rather than standing off it, so its outer face lands at SLAB_H / 2 =
// 0.21. That rung is taken, and the spandrel was sitting on it — at every floor
// line a 26-by-0.42 band of spandrel panel and slab edge contested one plane, on
// every elevation, which is what broke up the horizontal courses of the tower.
const D_SPANDREL = 0.185;        // curtain-wall spandrel panels
// Mullion fins must sit in FRONT of the spandrel bands they cross, or the floor
// bands swallow them at every storey line and the vertical line breaks up.
const D_MULLION = 0.31;
const D_PIER = 0.24;             // pilasters
const D_SILL = 0.29;             // window sills
const D_LINTEL = 0.32;           // flat lintels over loading doors
const D_BASE = 0.35;             // painted base course
const D_CORNICE = [0.26, 0.38, 0.32];   // corbelled courses, stepping out then back

// --- Glazed (curtain wall) ---------------------------------------------------
// After the modernist tower references: a *fine* grid, far finer than one window
// per modelled storey. Each 7-unit storey carries four apparent floors, and the
// How hot a lit office glows at full night. Matches the emissive the glazing
// helper sets, so switching a window to clock-driven does not change how it looks
// once the lights are actually on.
const LIT_GLOW = 0.55;

// verticals are continuous full-height mullion fins rather than gaps between
// panes — on those buildings the unbroken vertical line is the whole look.
const BAND_ROWS = 4;             // apparent floors per modelled storey
const SPANDREL_H = 0.42;         // dark band at each floor line
const MULLION_PITCH = 1.45;      // target spacing of the vertical fins
const MULLION_W = 0.13;
const MULLION_D = 0.18;          // how far a fin stands off the glass
const LIT_PANE_CHANCE = 0.16;    // lit offices scattered across the grid

// --- Solid (brick warehouse) ------------------------------------------------
// Vertical composition of an arcade elevation, in storey-local y (±STOREY_H/2).
const BASE_H = 0.8;              // painted base course along the pavement
const OPENING_BOTTOM = -2.7;     // cill line of the arcade openings
const SILL_H = 0.2;
// Where the arches spring. Set low deliberately: the openings are now as wide as
// the widest bay allows, so a high springing would push the arch crown up through
// the signage band. Dropping the impost buys the crown its clearance and gives the
// arch heads the prominence they have on the references.
const SPRING_Y = -0.45;
const SIGN_BOTTOM = 1.95;        // painted signage band
const SIGN_TOP = 2.65;
const CORNICE_H = 0.75;

const PILASTER_W = 0.75;
const ARCH_RING_W = 0.34;        // depth of the voussoir ring
const BAY_MARGIN = 0.6;          // brick either side of an opening, beyond the pier
// Hard cap on an opening, so the arch crown clears the signage band above it.
const MAX_OPEN_W = 4.4;

const ARCADE_BAYS_LONG = 5;
const ARCADE_BAYS_SHORT = 3;
const GARAGE_BAY_INDICES = [2, 3];
const ENTRANCE_BAY_INDEX = 4;

const PED_W = 1.4;               // personnel door within the entrance bay
const PED_H = 1.9;
const DOOR_SLATS = 7;

// Glazing bars within an arched opening.
const BAY_MULLIONS = 2;          // divides the lower section into three lights
const IMPOST_H = 0.16;           // the cross beam between square head and arch

// Upper solid storeys (if a solid building ever has more than one level).
const STEEL_WIN_W = 2.5;
const STEEL_WIN_H = 1.9;
const STEEL_WIN_SPACING = 5.0;
const BAR_T = 0.08;

function glassOpts(isLit) {
  return isLit
    ? { rough: 0.25, metal: 0.1, emissive: COLORS.windowLit, emissiveIntensity: 0.55, cast: false }
    : { rough: 0.25, metal: 0.35, cast: false };
}

/** Outer-face-relative z for a box of thickness `t` sitting `d` proud. */
function zFor(wallT, d, t) { return wallT / 2 + d - t / 2; }

/** Outer-face-relative z for a flat (zero-thickness) element sitting `d` proud. */
function zFlat(wallT, d) { return wallT / 2 + d; }

/**
 * The cheap treatment: two rows of plain panes on an elevation nobody looks at.
 *
 * Two of the four elevations on every storey face away from the camera, and are where
 * the mesh budget is won — so what they get is a couple of rows of flat glass standing
 * proud enough to read as windows, and nothing else: no frames, no reveals, no sills.
 * The masonry facades both want this; the curtain wall does not, because its glazing
 * is one ribbon a floor whether it is looked at or not, and only the mullions in front
 * of it are worth withholding.
 *
 * Only the pane's proportions belong to the facade. A warehouse's steel windows are
 * wide and low and a punched masonry opening is narrow and tall, and that difference
 * survives even at this distance — which is the whole reason the two treatments still
 * look like different buildings from behind.
 *
 * The lit counter is walked in the same order as everywhere else (a pane at a time,
 * across then up), because it is shared across the whole building: taking draws in a
 * different order here would relight every window of every elevation after it.
 *
 * @param {THREE.Object3D} parent  the elevation's own group
 * @param {number} len             elevation length
 * @param {number} wallT           wall thickness
 * @param {{n: number}} lit        the building's shared lit-window counter
 * @param {number} paneW
 * @param {number} paneH
 */
function buildPlainPanes(parent, len, wallT, lit, paneW, paneH) {
  const cols = Math.max(2, Math.floor(len / 4.2));
  const stepX = len / (cols + 1);
  for (let row = 1; row <= 2; row++) {
    for (let col = 1; col <= cols; col++) {
      const isLit = lit.n++ % LIT_EVERY === 0;
      const pane = box(paneW, paneH, GLASS_T,
        isLit ? COLORS.windowLit : COLORS.windowDark, glassOpts(isLit));
      pane.position.set(-len / 2 + col * stepX, -STOREY_H / 2 + row * (STOREY_H / 3),
                        zFor(wallT, D_GLASS, GLASS_T));
      if (isLit) markLitWindow(pane, LIT_GLOW);
      parent.add(pane);
    }
  }
}

/**
 * Build `count` complete storeys below y = 0.
 *
 * @param {number} count         how many levels
 * @param {number} roomW         footprint width  (x)
 * @param {number} roomD         footprint depth  (z)
 * @param {number} wallT         wall thickness
 * @param {'glazed'|'solid'|'punched'} walls  facade treatment
 * @param {string|null} signText    painted signage for solid elevations
 * @param {number|null} baseTo      world y the base mass reaches down to. Needed
 *   for a tower, whose lowest modelled storey is nowhere near the ground: without
 *   it the building stops in mid-air above the rooftops below.
 */
export function buildStoreysBelow({ count, roomW, roomD, wallT, walls = 'glazed', signText = null, baseTo = null }) {
  const g = group(0, 0, 0);
  if (count <= 0) return g;

  const half = wallT / 2;
  // Shared counter so lit windows are scattered across the whole building rather
  // than repeating identically on every elevation.
  const lit = { n: 0 };
  // One opening width for the whole building, derived from both elevations at
  // once (see arcadeOpeningWidth). Sizing each elevation independently is what
  // made the long side read as squished: its bays are narrower, so its arches
  // came out narrower too, and the two facades disagreed at the corner.
  const openW = arcadeOpeningWidth(roomW, roomD);

  for (let level = 0; level < count; level++) {
    const top = -level * STOREY_H;
    const midY = top - STOREY_H / 2;
    const storey = group(0, 0, 0);

    // ---- Slab edge at this floor line, on all four sides ----
    for (const [w, d, x, z] of [
      [roomW + SLAB_PROUD * 2, SLAB_H, roomW / 2, 0],
      [roomW + SLAB_PROUD * 2, SLAB_H, roomW / 2, roomD],
      [SLAB_H, roomD + SLAB_PROUD * 2, 0, roomD / 2],
      [SLAB_H, roomD + SLAB_PROUD * 2, roomW, roomD / 2],
    ]) {
      const isX = w > d;
      const band = box(isX ? w : SLAB_H, SLAB_H, isX ? SLAB_H : d, COLORS.slabEdge,
        { rough: 0.85, cast: false });
      band.position.set(x, top - SLAB_H / 2, z);
      band.receiveShadow = true;
      storey.add(band);
    }

    // ---- Floor plate ----
    // Held clear of the elevations rather than run out to meet them: at full size its
    // edge faces sat on exactly the planes of the walls' outer faces, all four sides.
    // It is enclosed by them either way, so nothing is lost by pulling it in.
    const plate = box(roomW - 0.08, 0.36, roomD - 0.08, COLORS.facadeLower,
      { rough: 0.9, cast: false });
    plate.position.set(roomW / 2, top - STOREY_H + 0.18, roomD / 2);
    plate.receiveShadow = true;
    storey.add(plate);

    // ---- The four elevations ----
    // `seen` marks the two faces the camera looks at. Expensive detail goes only
    // on those; the hidden pair gets the cheap treatment, which is where the mesh
    // budget is won. Which pair is long vs short is derived, not assumed.
    const wRole = roomW >= roomD ? 'long' : 'short';
    const dRole = roomW >= roomD ? 'short' : 'long';
    const atGround = level === count - 1;

    const faces = [
      { len: roomW, at: [roomW / 2, midY, 0], rotY: 0, seen: false, role: wRole },
      { len: roomW, at: [roomW / 2, midY, roomD - half], rotY: 0, seen: true, role: wRole },
      { len: roomD, at: [0, midY, roomD / 2], rotY: Math.PI / 2, seen: false, role: dRole },
      { len: roomD, at: [roomW - half, midY, roomD / 2], rotY: Math.PI / 2, seen: true, role: dRole },
    ];

    for (const face of faces) {
      const wall = group(...face.at);
      wall.rotation.y = face.rotY;
      const opts = { seen: face.seen, atGround, role: face.role, lit, signText, openW };
      if (walls === 'solid') buildSolidWall(wall, face.len, wallT, opts);
      else if (walls === 'punched') buildPunchedWall(wall, face.len, wallT, opts);
      else buildGlazedWall(wall, face.len, wallT, opts);
      storey.add(wall);
    }

    // ---- Ground-meeting plinth under the lowest storey ----
    // This has to actually reach the ground. The street sits |STREET_Y| below the
    // lowest floor plate, so a fixed skirt leaves the building floating with a gap
    // you can see straight under the walls through. Overshoot so the join buries.
    if (atGround) {
      const floorLine = top - STOREY_H;
      // Either meet the street just below (a real ground floor), or carry on down
      // to wherever the world says the base is (a tower seen from level 34).
      const baseH = baseTo === null
        ? Math.abs(STREET_Y) + 0.5
        : Math.max(0.5, floorLine - baseTo);
      const base = box(roomW + 0.5, baseH, roomD + 0.5,
        walls === 'glazed' ? COLORS.spandrel : COLORS.baseCourse,
        { rough: 0.9, cast: false });
      base.position.set(roomW / 2, floorLine - baseH / 2, roomD / 2);
      base.receiveShadow = true;
      storey.add(base);
    }

    g.add(storey);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Glazed curtain wall
// ---------------------------------------------------------------------------

/**
 * Curtain wall, built the way the reference towers actually are: a continuous
 * glazed ribbon at every floor, a dark spandrel band on each floor line, and
 * uninterrupted vertical mullion fins running the full height of the wall.
 *
 * The fins are what carry the look, and because they span the whole storey there
 * is one per column *per wall* rather than one per column per floor — so the grid
 * gets finer while the mesh count stays roughly flat. Individual panes are drawn
 * only where an office is lit, which is exactly where the eye goes anyway.
 */
function buildGlazedWall(parent, len, wallT, { seen = false, lit }) {
  // Carried a hair past the floor line rather than stopping on it. Cut to exactly one
  // storey, the backing's top face landed on the same plane as the slab edge band that
  // wraps that line — 26 by 0.4 of contested surface at every storey of every
  // elevation. The bleed is swallowed by the backing of the storey above.
  const BACKING_BLEED = 0.03;
  const backing = box(len, STOREY_H + BACKING_BLEED, wallT, COLORS.spandrel, { rough: 0.8 });
  backing.position.y = BACKING_BLEED / 2;
  backing.castShadow = true;
  backing.receiveShadow = true;
  parent.add(backing);

  const bay = STOREY_H / BAND_ROWS;
  const glassH = bay - SPANDREL_H;
  const glassZ = zFor(wallT, D_GLASS, GLASS_T);
  const spandrelT = wallT * 0.5;

  const cols = Math.max(3, Math.round(len / MULLION_PITCH));
  const colW = len / cols;

  for (let row = 0; row < BAND_ROWS; row++) {
    const bottom = -STOREY_H / 2 + row * bay;
    const centreY = bottom + glassH / 2;

    // The floor's glazing, as one ribbon. The fins in front of it supply the
    // vertical divisions, so drawing every pane separately buys nothing.
    put(parent, box(len - 0.06, glassH, GLASS_T, COLORS.windowDark, glassOpts(false)), 0, centreY, glassZ);

    // Lit offices, on the column grid so they sit inside the mullion bays.
    if (seen) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() > LIT_PANE_CHANCE) continue;
        lit.n++;
        const pane = box(colW - MULLION_W - 0.06, glassH * 0.94, GLASS_T,
          COLORS.windowLit, glassOpts(true));
        pane.position.set(-len / 2 + (c + 0.5) * colW, centreY, glassZ + 0.02);
        // Only glows after dark; by day the pale glass reads as a reflection.
        markLitWindow(pane, LIT_GLOW);
        parent.add(pane);
      }
    }

    // Spandrel at the floor line above the glass.
    //
    // Set a touch below the line it fills, because the slab edge band already owns
    // the top of every storey. Run flush, the two shared a top face, and the slab's
    // exposed ledge — a shelf the full width of the elevation, in plain view from an
    // isometric camera — flickered between the two colours right round the building.
    const SPANDREL_DROP = 0.02;
    const s = box(len, SPANDREL_H, spandrelT, COLORS.spandrel, { rough: 0.8, cast: false });
    s.position.set(0, bottom + glassH + SPANDREL_H / 2 - SPANDREL_DROP,
      zFor(wallT, D_SPANDREL, spandrelT));
    parent.add(s);
  }

  if (!seen) return;

  // Continuous vertical mullions, full storey height so they line straight through
  // the floor bands — the unbroken vertical is the entire character of these towers.
  for (let c = 0; c <= cols; c++) {
    const fin = box(MULLION_W, STOREY_H, MULLION_D, COLORS.mullion,
      { rough: 0.45, metal: 0.55, cast: false });
    fin.position.set(-len / 2 + c * colW, 0, zFor(wallT, D_MULLION, MULLION_D));
    parent.add(fin);
  }
}

// ---------------------------------------------------------------------------
// Solid brick warehouse
// ---------------------------------------------------------------------------

function buildSolidWall(parent, len, wallT, { seen = false, atGround = false, role = 'long', lit, signText, openW }) {
  const backing = box(len, STOREY_H, wallT, COLORS.facadeLower, { rough: 0.9 });
  backing.castShadow = true;
  backing.receiveShadow = true;
  parent.add(backing);

  // Wide and low, as a warehouse's steel windows are on the elevations that get them.
  if (!seen) return buildPlainPanes(parent, len, wallT, lit, 1.5, 1.3);

  if (atGround) {
    // The ground floor is the arcade. The long elevation carries the loading
    // doors and the entrance and the painted sign; the short one is all windows.
    const long = role === 'long';
    const bays = long ? ARCADE_BAYS_LONG : ARCADE_BAYS_SHORT;
    return buildArcadeElevation(parent, len, wallT, {
      roles: arcadeRoles(bays, long),
      openW: openW ?? arcadeOpeningWidth(len, len),
      sign: long ? signText : null,
      lit,
    });
  }

  // Upper solid storeys: a grid of steel windows.
  const rows = Math.max(1, Math.floor(STOREY_H / (STEEL_WIN_H + 1.2)));
  const cols = Math.max(2, Math.floor(len / STEEL_WIN_SPACING));
  const stepX = len / (cols + 1);
  const stepY = STOREY_H / (rows + 1);
  for (let row = 1; row <= rows; row++) {
    for (let col = 1; col <= cols; col++) {
      buildSteelWindow(parent, -len / 2 + col * stepX, -STOREY_H / 2 + row * stepY,
                       wallT, STEEL_WIN_W, STEEL_WIN_H, lit.n++ % LIT_EVERY === 0);
    }
  }
}

/**
 * A brick arcade elevation, after the San Francisco warehouse references: a
 * rhythm of round-arched openings separated by brick pilasters, on a painted base
 * course, under a corbelled cornice, with faded painted signage over the top.
 *
 * The elevation is divided into equal bays and each bay is given a role, so the
 * loading doors land on the bay grid instead of being placed independently of it
 * — which is what made the previous version read as stickers on a flat wall.
 *
 * `openW` is handed in rather than derived here, so every opening on the building
 * is the same size regardless of which elevation it sits on. The bay grid still
 * differs between elevations — that only changes how much brick sits between the
 * arches, which is exactly how the reference warehouses handle their end walls.
 */
function buildArcadeElevation(parent, len, wallT, { roles, openW, sign, lit }) {
  const bays = roles.length;
  const bayW = len / bays;

  // ---- Painted base course ----
  const baseT = wallT * 0.55;
  const base = box(len, BASE_H, baseT, COLORS.baseCourse, { rough: 0.9, cast: false });
  base.position.set(0, -STOREY_H / 2 + BASE_H / 2, zFor(wallT, D_BASE, baseT));
  base.receiveShadow = true;
  parent.add(base);

  // ---- Pilasters on every bay division, corners included ----
  const pierT = wallT * 0.5;
  const pierH = STOREY_H - BASE_H;
  for (let i = 0; i <= bays; i++) {
    const pier = box(PILASTER_W, pierH, pierT, COLORS.brickPier, { rough: 0.92, cast: false });
    pier.position.set(-len / 2 + i * bayW, -STOREY_H / 2 + BASE_H + pierH / 2,
                      zFor(wallT, D_PIER, pierT));
    pier.receiveShadow = true;
    parent.add(pier);
  }

  // ---- Bays ----
  for (let i = 0; i < bays; i++) {
    const x = -len / 2 + (i + 0.5) * bayW;
    if (roles[i] === 'garage') buildLoadingBay(parent, x, openW, wallT);
    else if (roles[i] === 'pedestrian') buildEntranceBay(parent, x, openW, wallT);
    else buildWindowBay(parent, x, openW, wallT, lit.n++ % LIT_EVERY === 0);
  }

  // ---- Corbelled cornice ----
  let y = STOREY_H / 2 - CORNICE_H;
  const courses = [[0.24, D_CORNICE[0]], [0.30, D_CORNICE[1]], [0.21, D_CORNICE[2]]];
  for (const [h, d] of courses) {
    const bandT = wallT * 0.5;
    put(parent, box(len, h, bandT, COLORS.slabEdge, { rough: 0.88, cast: false }), 0, y + h / 2, zFor(wallT, d, bandT));
    y += h;
  }

  if (sign) buildGhostSign(parent, len, wallT, sign);
}

/**
 * The one opening width used by every arcade bay on the building.
 *
 * Both elevations are considered together and the tighter of the two wins, so the
 * arches match all the way round the corner. The long side carries more bays than
 * the short side, so its bays are narrower and it is normally the constraint.
 */
export function arcadeOpeningWidth(roomW, roomD) {
  const bayLong = Math.max(roomW, roomD) / ARCADE_BAYS_LONG;
  const bayShort = Math.min(roomW, roomD) / ARCADE_BAYS_SHORT;
  const bayW = Math.min(bayLong, bayShort);
  return Math.max(1.6, Math.min(bayW - PILASTER_W - BAY_MARGIN, MAX_OPEN_W));
}

/** Bay roles: loading doors and the entrance sit on the bay grid. */
function arcadeRoles(bays, withDoors) {
  const roles = new Array(bays).fill('window');
  if (!withDoors || bays <= ENTRANCE_BAY_INDEX) return roles;
  for (const i of GARAGE_BAY_INDICES) roles[i] = 'garage';
  roles[ENTRANCE_BAY_INDEX] = 'pedestrian';
  return roles;
}

/**
 * Glazing bars for an arched opening.
 *
 * Two things the references make plain that the first pass got wrong: the vertical
 * bars run the *whole* height of the square lower light, right up to the impost,
 * and there is a cross beam on the springing line dividing that light from the
 * semicircular head. The bars then carry on up into the fanlight on the same
 * lines. Without the impost the square and the half-circle read as one odd blob.
 */
function addGlazingBars(parent, x, openW, wallT, { bottom, top, transoms = 2, fanlight = true }) {
  const h = top - bottom;
  if (h <= 0) return;
  const barZ = zFor(wallT, D_BARS, BAR_T);
  const barOpts = { rough: 0.6, metal: 0.3, cast: false };
  const lights = BAY_MULLIONS + 1;
  const offsetOf = (m) => -openW / 2 + (m * openW) / lights;

  // Verticals: full height of the lower light, sill to impost.
  for (let m = 1; m <= BAY_MULLIONS; m++) {
    put(parent, box(BAR_T, h, BAR_T, COLORS.windowFrame, barOpts), x + offsetOf(m), bottom + h / 2, barZ);
  }

  // Horizontals, evenly spaced within it.
  for (let t = 1; t <= transoms; t++) {
    put(parent, box(openW, BAR_T, BAR_T, COLORS.windowFrame, barOpts), x, bottom + (t * h) / (transoms + 1), barZ);
  }

  // The impost beam, standing proud of the bars so it reads as structure rather
  // than as one more glazing bar.
  const impostT = wallT * 0.4;
  const impost = box(openW + 0.3, IMPOST_H, impostT, COLORS.slabEdge,
    { rough: 0.85, cast: false });
  impost.position.set(x, top + IMPOST_H / 2, zFor(wallT, D_IMPOST, impostT));
  parent.add(impost);

  if (!fanlight) return;

  // Bars continuing into the fanlight, each cut off at the arch: the half-chord
  // of a circle of radius r at offset dx is sqrt(r² - dx²).
  const r = openW / 2;
  const fanBottom = top + IMPOST_H;
  for (let m = 1; m <= BAY_MULLIONS; m++) {
    const dx = offsetOf(m);
    const barH = top + Math.sqrt(Math.max(0, r * r - dx * dx)) - fanBottom;
    if (barH <= 0.05) continue;
    put(parent, box(BAR_T, barH, BAR_T, COLORS.windowFrame, barOpts), x + dx, fanBottom + barH / 2, barZ);
  }
}

/** The brick voussoir ring around an arched head. */
function addArchRing(parent, x, r, wallT) {
  put(parent, archRing(r, r + ARCH_RING_W, COLORS.slabEdge, { rough: 0.88 }), x, SPRING_Y, zFlat(wallT, D_RING));
}

/** An arched window bay: glazing below the springing, a fanlight in the head. */
function buildWindowBay(parent, x, openW, wallT, isLit) {
  const r = openW / 2;
  const colour = isLit ? COLORS.windowLit : COLORS.windowDark;
  const gOpts = glassOpts(isLit);
  const glassZ = zFor(wallT, D_GLASS, GLASS_T);

  const glassH = SPRING_Y - OPENING_BOTTOM - SILL_H;
  const midY = OPENING_BOTTOM + SILL_H + glassH / 2;

  put(parent, box(openW, glassH, GLASS_T, colour, gOpts), x, midY, glassZ);

  // Fanlight, slightly inside the ring so a line of brick reads around it.
  put(parent, archFill(r - 0.05, colour, gOpts), x, SPRING_Y, zFlat(wallT, D_GLASS));

  addArchRing(parent, x, r, wallT);
  addGlazingBars(parent, x, openW, wallT, {
    bottom: OPENING_BOTTOM + SILL_H,
    top: SPRING_Y,
    transoms: 2,
  });

  const sillT = wallT * 0.5;
  put(parent, box(openW + 0.4, SILL_H, sillT, COLORS.slabEdge, { rough: 0.85, cast: false }), x, OPENING_BOTTOM + SILL_H / 2, zFor(wallT, D_SILL, sillT));
}

/**
 * A loading bay: a square-headed roller shutter rising to the same height as the
 * neighbouring arch crowns, so the door breaks the arcade rhythm exactly as it
 * does on the reference buildings.
 */
function buildLoadingBay(parent, x, openW, wallT) {
  const headY = SPRING_Y + openW / 2;
  const doorH = headY - OPENING_BOTTOM;

  const leaf = box(openW, doorH, GLASS_T, COLORS.shutter,
    { rough: 0.7, metal: 0.35, cast: false });
  leaf.position.set(x, OPENING_BOTTOM + doorH / 2, zFor(wallT, D_GLASS, GLASS_T));
  parent.add(leaf);

  const ribZ = zFor(wallT, D_BARS, BAR_T);
  for (let i = 1; i <= DOOR_SLATS; i++) {
    put(parent, box(openW - 0.16, 0.1, BAR_T, COLORS.shutterRib, { rough: 0.75, cast: false }), x, OPENING_BOTTOM + (i * doorH) / (DOOR_SLATS + 1), ribZ);
  }

  const lintelT = wallT * 0.45;
  put(parent, box(openW + 0.5, 0.3, lintelT, COLORS.slabEdge, { rough: 0.85, cast: false }), x, headY + 0.15, zFor(wallT, D_LINTEL, lintelT));
}

/**
 * The entrance bay, after the Oriental Warehouse reference: a big arched opening
 * with a glazed screen, the personnel door set into it, and a lit fanlight over.
 */
function buildEntranceBay(parent, x, openW, wallT) {
  const r = openW / 2;
  const glassZ = zFor(wallT, D_GLASS, GLASS_T);

  // Lit right through, screen and fanlight both: this is the lobby, and light
  // spilling out of it is what makes the entrance read as the entrance.
  const screenH = SPRING_Y - OPENING_BOTTOM;
  put(parent, box(openW, screenH, GLASS_T, COLORS.windowLit, glassOpts(true)), x, OPENING_BOTTOM + screenH / 2, glassZ);

  put(parent, archFill(r - 0.05, COLORS.windowLit, glassOpts(true)), x, SPRING_Y, zFlat(wallT, D_GLASS));

  addArchRing(parent, x, r, wallT);
  // The screen is glazed like the windows either side of it: bars the full height
  // of the square light, then the impost, then the fanlight above.
  addGlazingBars(parent, x, openW, wallT, {
    bottom: OPENING_BOTTOM,
    top: SPRING_Y,
    transoms: 2,
  });

  // The door itself, forward of the screen and its bars.
  const leaf = box(PED_W, PED_H, BAR_T, COLORS.shutter,
    { rough: 0.7, metal: 0.3, cast: false });
  leaf.position.set(x, OPENING_BOTTOM + PED_H / 2, zFor(wallT, D_RING, BAR_T));
  parent.add(leaf);

  const sillT = wallT * 0.5;
  put(parent, box(PED_W + 1.0, SILL_H, sillT, COLORS.baseCourse, { rough: 0.9, cast: false }), x, OPENING_BOTTOM + SILL_H / 2, zFor(wallT, D_SILL, sillT));
}

/** A multi-pane steel window for upper solid storeys. */
function buildSteelWindow(parent, x, y, wallT, w, h, isLit) {
  const glass = box(w, h, GLASS_T, isLit ? COLORS.windowLit : COLORS.windowDark,
    glassOpts(isLit));
  glass.position.set(x, y, zFor(wallT, D_GLASS, GLASS_T));
  parent.add(glass);

  const barZ = zFor(wallT, D_BARS, BAR_T);
  const barOpts = { rough: 0.6, metal: 0.3, cast: false };
  for (let m = 1; m <= 2; m++) {
    put(parent, box(BAR_T, h, BAR_T, COLORS.windowFrame, barOpts), x - w / 2 + (m * w) / 3, y, barZ);
  }
  put(parent, box(w, BAR_T, BAR_T, COLORS.windowFrame, barOpts), x, y, barZ);

  const sillT = wallT * 0.5;
  put(parent, box(w + 0.3, 0.16, sillT, COLORS.slabEdge, { rough: 0.85, cast: false }), x, y - h / 2 - 0.08, zFor(wallT, D_SILL, sillT));
}

/**
 * Weathered painted signage straight onto the brick, as on all three references.
 *
 * Drawn to a canvas with bites taken out of the lettering so it reads as faded
 * paint rather than a decal, and left part-transparent so brick shows through.
 */
function buildGhostSign(parent, len, wallT, text) {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d');

  g.fillStyle = `#${COLORS.signPaint.toString(16).padStart(6, '0')}`;
  g.font = 'bold 170px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.split('').join(' '), c.width / 2, c.height / 2 + 6);

  // Weather it: flecks knocked out of the paint, plus a few broad wash-outs.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) {
    g.globalAlpha = spread(0.3, 0.5);
    g.fillRect(Math.random() * c.width, Math.random() * c.height,
               spread(2, 14), spread(2, 10));
  }
  for (let i = 0; i < 7; i++) {
    g.globalAlpha = 0.3;
    g.fillRect(Math.random() * c.width, 0, spread(30, 90), c.height);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(len - PILASTER_W * 2.5, SIGN_TOP - SIGN_BOTTOM),
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      opacity: 0.85,
      roughness: 0.95,
      depthWrite: false,
    }),
  );
  plane.position.set(0, (SIGN_BOTTOM + SIGN_TOP) / 2, zFlat(wallT, D_SIGN));
  parent.add(plane);
}

// --- Shared with the exterior ----------------------------------------------
// The service yard outside has to line up with the loading doors, so these are
// exported rather than duplicated as a second copy of the same numbers.

/** Where the loading bays sit, as fractions of the long elevation's length. */
export function loadingBayFractions() {
  return GARAGE_BAY_INDICES.map((i) => -0.5 + (i + 0.5) / ARCADE_BAYS_LONG);
}

/** Width of a loading bay opening, for a building of the given footprint. */
export function loadingBayWidth(roomW, roomD) {
  return arcadeOpeningWidth(roomW, roomD);
}

// ===========================================================================
// Punched masonry: a Haussmann block
// ===========================================================================
//
// Between the curtain wall and the brick arcade there is a third thing these
// buildings need: a plain masonry wall with tall openings punched through it in a
// regular grid. It is the commonest facade there is, and it is what a Parisian
// block, a mill, a terrace or a school all resolve to at this level of detail.

const PUNCH_ROWS = 2;            // apparent floors per modelled storey
const PUNCH_WIN_W = 1.5;
const PUNCH_WIN_H = 2.6;
const PUNCH_PITCH = 3.4;         // target spacing between window centres
const D_BALCONY = 0.44;          // ironwork, in front of everything else

function buildPunchedWall(parent, len, wallT, { seen = false, atGround = false, lit }) {
  // Carried a hair past the floor line, as the curtain wall is: cut to exactly one
  // storey, the backing's top face lands on the plane of the slab edge band that
  // wraps that line, and the two contest the whole length of every elevation.
  const BACKING_BLEED = 0.03;
  const backing = box(len, STOREY_H + BACKING_BLEED, wallT, COLORS.facadeLower, { rough: 0.92 });
  backing.position.y = BACKING_BLEED / 2;
  backing.castShadow = true;
  backing.receiveShadow = true;
  parent.add(backing);

  // Narrow and tall, the proportion a hole punched through masonry has.
  if (!seen) return buildPlainPanes(parent, len, wallT, lit, 1.3, 2.0);

  // A string course at each floor line: the horizontal that holds a street of these
  // together. Sits below the line rather than on it, so the slab edge keeps its own.
  for (const row of [0, 1]) {
    const y = -STOREY_H / 2 + row * (STOREY_H / PUNCH_ROWS);
    put(parent, box(len, 0.34, 0.5, COLORS.baseCourse, { rough: 0.9, cast: false }), 0, y + 0.17, zFor(wallT, D_SILL, 0.5));
  }

  const cols = Math.max(2, Math.round(len / PUNCH_PITCH));
  const stepX = len / cols;
  const rowStep = STOREY_H / PUNCH_ROWS;

  for (let row = 0; row < PUNCH_ROWS; row++) {
    // The window sits in the upper part of its floor, as a real one does — it is the
    // wall under a window that a room needs, not the wall above it.
    const sill = -STOREY_H / 2 + row * rowStep + 0.9;
    const centreY = sill + PUNCH_WIN_H / 2;
    // Ground-floor openings are shop-and-carriage height, so the whole rhythm shifts
    // down and gets taller.
    const isShopfront = atGround && row === 0;
    const h = isShopfront ? PUNCH_WIN_H + 0.9 : PUNCH_WIN_H;
    const y = isShopfront ? sill + h / 2 - 0.5 : centreY;

    for (let col = 0; col < cols; col++) {
      const x = -len / 2 + (col + 0.5) * stepX;
      const isLit = lit.n++ % LIT_EVERY === 0;

      // The surround is a *frame*: two jambs, a lintel and a sill, with the middle
      // left open for the glass.
      //
      // It was one solid box to begin with, and every window in the building was
      // invisible — because the depth ladder puts D_PIER in front of D_GLASS, so the
      // "surround" was a stone slab hung over the opening. The same mistake as the
      // recessed reveal in the walls, arrived at from the other direction: there the
      // glazing was buried behind the wall, here it was buried behind its own frame.
      const OUT = 0.28;
      for (const side of [-1, 1]) {
        put(parent, box(OUT, h + 0.5, 0.3, COLORS.baseCourse, { rough: 0.9, cast: false }), x + side * (PUNCH_WIN_W + OUT) / 2, y, zFor(wallT, D_PIER, 0.3));
      }
      const lintel = box(PUNCH_WIN_W + OUT * 2, 0.3, 0.3, COLORS.baseCourse,
        { rough: 0.9, cast: false });
      lintel.position.set(x, y + h / 2 + 0.15, zFor(wallT, D_PIER, 0.3));
      parent.add(lintel);
      const stool = box(PUNCH_WIN_W + OUT * 2 + 0.3, 0.22, 0.42, COLORS.baseCourse,
        { rough: 0.9, cast: false });
      stool.position.set(x, y - h / 2 - 0.11, zFor(wallT, D_SILL, 0.42));
      parent.add(stool);

      const pane = box(PUNCH_WIN_W, h, GLASS_T,
        isLit ? COLORS.windowLit : COLORS.windowDark, glassOpts(isLit));
      pane.position.set(x, y, zFor(wallT, D_GLASS, GLASS_T));
      if (isLit) markLitWindow(pane, LIT_GLOW);
      parent.add(pane);

      // A centre mullion and one transom: two boxes that turn a dark rectangle into
      // a French window.
      const mull = box(0.1, h, 0.1, COLORS.windowFrame ?? COLORS.frame,
        { rough: 0.7, cast: false });
      mull.position.set(x, y, zFor(wallT, D_BARS, 0.1));
      parent.add(mull);
      const trans = box(PUNCH_WIN_W, 0.1, 0.1, COLORS.windowFrame ?? COLORS.frame,
        { rough: 0.7, cast: false });
      trans.position.set(x, y + h * 0.18, zFor(wallT, D_BARS, 0.1));
      parent.add(trans);

      // Wrought-iron balcony on the upper row: the detail that makes this a
      // boulevard rather than a warehouse.
      if (row === 1) {
        const railY = y - h / 2 + 0.55;
        const rail = box(PUNCH_WIN_W + 0.6, 0.08, 0.1, COLORS.metalDark,
          { rough: 0.5, metal: 0.5, cast: false });
        rail.position.set(x, railY + 0.5, zFlat(wallT, D_BALCONY));
        parent.add(rail);
        for (let b = 0; b < 6; b++) {
          const baluster = box(0.06, 1.0, 0.06, COLORS.metalDark,
            { rough: 0.5, metal: 0.5, cast: false });
          baluster.position.set(
            x - (PUNCH_WIN_W + 0.4) / 2 + (b + 0.5) * ((PUNCH_WIN_W + 0.4) / 6),
            railY + 0.02, zFlat(wallT, D_BALCONY),
          );
          parent.add(baluster);
        }
      }
    }
  }
}

// ===========================================================================
// The roof
// ===========================================================================
//
// A cutaway office cannot have a roof over it — the camera looks down into the
// room, and a complete roof is a lid on the whole diorama. So the roof follows the
// same rule the walls do: it is built only where it is *not* in the way. The two
// standing walls (x = 0 and z = 0) get a pitched plane each, sloping away from the
// room and overhanging outside, and the near half of the building is open exactly
// as its near two elevations are.
//
// What that buys is the silhouette, which is all a roof is doing at this distance:
// eaves and a fascia above the far walls, a ridge behind them, and something for
// a chimney to stand out of.

/** Pitch, how far it reaches, and what stands on it. */
const ROOFS = {
  mansard: { pitch: 0.86, inner: 2.6, over: 1.4, rise: 3.4, drop: 0.7, deck: 0.4, chimneys: true },
};

/**
 * A roof over the two standing walls.
 *
 * @param {'mansard'} kind
 * @param {{W: number, D: number, H: number, wallT: number}} room
 */
export function buildRoof(kind, room) {
  const spec = ROOFS[kind] ?? ROOFS.mansard;
  const g = group(0, 0, 0);

  // Along the back wall (z = 0), running in x; and along the left wall (x = 0),
  // running in z. Each is built in its own local frame — length along local x —
  // and rotated into its face, which is rule one.
  //
  // The left one needs `dir` as well as a rotation, and it is worth saying why: a
  // quarter turn about y that sends the plane's *length* the right way (local +x to
  // world +z) also sends its *slope* the wrong way (local +z to world -x), which is
  // out over open ground with the ridge pointing away from the room. The rotation
  // alone cannot satisfy both — it would need a mirror — so the slope direction is
  // a parameter, and the second plane slopes toward local -z instead. Built with
  // the turn alone, the two planes end up in the same corner sloping across each
  // other, which is exactly what the coplanar probe reported.
  //
  // The back plane's own length only carried `over` once — enough to overhang the
  // corner end (its `from` starts at -over) but nothing at the open end, so it
  // lands exactly on room.W with no overhang there at all. The left plane doesn't
  // have this problem: its `from` is offset by `inner` rather than by its own
  // overhang, so the same `+over` in its length shows up as genuine overshoot
  // past room.D at its own open end. Carrying `over` twice gives the back plane
  // that same overshoot at its open end, so both eaves clear whatever stands at
  // that corner — a balcony rail, say — by the same margin instead of one of them
  // landing flush on the wall line and the other genuinely overhanging it.
  g.add(buildRoofPlane(spec, room.W + spec.over * 2, room.H, { dir: 1 }));
  const left = buildRoofPlane(spec, room.D + spec.over - spec.inner, room.H, {
    dir: -1,
    // Started past the corner rather than run into it: the back plane already covers
    // that square, and two slabs crossing there is a join no cap can hide.
    from: spec.inner,
  });
  left.rotation.y = -Math.PI / 2;
  g.add(left);

  if (spec.chimneys) {
    // Stood on the flat deck (see the `spec.deck` block in buildRoofPlane), not at a
    // fixed height above the wall: the deck's own height depends on `rise`, and a
    // fixed offset put the chimney's base well below the slope at that point, so the
    // stack read as a cap and three pots floating over a gap, with most of its height
    // hidden inside the roof. `inset` is the deck's own centre line — spec.inner * 0.72,
    // the same fraction buildRoofPlane positions the deck at — so a chimney at the
    // *other* plane's inset lands on that plane's deck, not off the edge of it.
    const deckY = room.H + spec.rise + 0.43;
    const inset = spec.inner * 0.72;
    for (const [x, z] of [[room.W * 0.34, inset], [inset, room.D * 0.42]]) {
      g.add(buildChimney(x, deckY, z));
    }
  }

  // Hip corner. Real Haussmann roofs mitre this into a diagonal hip; these two
  // planes just butt into each other in a stepped L, which a corner this small
  // in frame does not repay modelling properly. What it does need is solid —
  // the two trim bars (ridge and fascia, each fixed in one axis and running
  // the *other* plane's full length) stop short of the point where they
  // should actually cross, by the gap between one plane's z = inner and the
  // other's own edge, and that gap showed the bare wallhead through. Rather
  // than chase trim bars that keep landing short, one solid block fills the
  // whole eave-to-ridge corner volume outright, painted as roof: it reads as
  // extra roof mass at a corner that is barely on screen, not as a patch.
  const cornerFill = box(spec.inner + spec.over + 0.4, spec.rise + spec.drop + 0.1,
    spec.inner + spec.over + 0.4, COLORS.roofPlane, { rough: 0.9, cast: false });
  cornerFill.position.set(
    (spec.inner - spec.over) / 2 - 0.2,
    room.H + (spec.rise - spec.drop) / 2,
    (spec.inner - spec.over) / 2 - 0.2,
  );
  g.add(cornerFill);

  return g;
}

/**
 * One pitched plane, hard against a wall whose top is at `wallTop`.
 *
 * Built to slope down toward local -z: the ridge end reaches `inner` back over the
 * room, the eaves end overhangs by `over`, and the fascia at that end hangs a
 * little *below* the wall top so the wall's own top edge is covered rather than
 * left as a line the roof happens to touch.
 */
function buildRoofPlane(spec, length, wallTop, { dir = 1, from = -spec.over } = {}) {
  const g = group(0, 0, 0);
  const T = 0.34;
  const run = spec.inner + spec.over;
  const slabLen = Math.hypot(run, spec.rise + spec.drop);
  // Middle of the plane along its length, and the height halfway between eaves and
  // ridge. `dir` flips which way it falls; everything measured in z is signed by it.
  const cx = from + length / 2;
  const cz = dir * (spec.inner - spec.over) / 2;
  const cy = wallTop + (spec.rise - spec.drop) / 2;
  const pitch = Math.atan2(spec.rise + spec.drop, run);

  const slab = box(length, T, slabLen, COLORS.roofPlane, { rough: 0.9 });
  slab.castShadow = true;
  slab.receiveShadow = true;
  slab.position.set(cx, cy, cz);
  slab.rotation.x = -dir * pitch;
  g.add(slab);

  // Fascia along the eaves: a board hanging at the low edge, which is the part of a
  // roof you actually see from inside a cutaway room.
  put(g, box(length, 0.55, 0.26, COLORS.roofTrim, { rough: 0.85, cast: false }), cx, wallTop - spec.drop - 0.18, dir * (-spec.over - 0.1));

  // Ridge cap along the high edge.
  put(g, box(length, 0.36, 0.7, COLORS.roofTrim, { rough: 0.85, cast: false }), cx, wallTop + spec.rise + 0.1, dir * (spec.inner - 0.2));

  // A flat deck along the ridge: what makes a mansard a mansard rather than a very
  // steep gable.
  if (spec.deck) {
    put(g, box(length, 0.3, spec.inner * spec.deck, COLORS.roofPlane, { rough: 0.8, cast: false }), cx, wallTop + spec.rise + 0.28, dir * spec.inner * 0.72);
  }

  return g;
}

/** A chimney stack with pots, for a roof that has fireplaces under it. */
function buildChimney(x, y, z) {
  const g = group(x, y, z);
  const H = 3.2;
  put(g, box(1.6, H, 1.2, COLORS.facadeLower, { rough: 0.95 }), 0, H / 2);
  put(g, box(1.9, 0.24, 1.5, COLORS.baseCourse, { rough: 0.9, cast: false }), 0, H - 0.05);
  for (let i = 0; i < 3; i++) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.21, 0.24, 0.8, 9),
      mat(COLORS.chimneyPot, { rough: 0.9 }),
    );
    pot.castShadow = true;
    pot.position.set(-0.5 + i * 0.5, H + 0.5, 0);
    g.add(pot);
  }
  return g;
}
