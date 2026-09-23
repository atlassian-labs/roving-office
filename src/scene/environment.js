import * as THREE from 'three';
import {
  COLORS, ROOM, DOOR, WINDOWS, FLOOR_THICKNESS, FLOOR_TOP,
  WINDOW_SILL_Y, WINDOW_HEAD_Y, WINDOW_FRAME_T, WINDOW_FRAME_D, WINDOW_LIGHTS,
} from '../config.js';
import { pick } from '../dice.js';
import { box, mat, group, cyl, put } from './build.js';
import { buildExterior } from './exterior.js';
import { SKYLINE_GROUND_Y } from './outlooks/skyline.js';
import { PARIS_BASE_Y } from './outlooks/paris.js';
import { buildRoof, buildStoreysBelow, STOREY_H } from './building.js';
import {
  stairFlight, stoopApproach, stoopSteps,
  STAIR_TREAD, STAIR_WIDTH, STAIR_Z, STAIR_RAIL_H, STAIR_POST_EVERY,
} from './approach.js';
import { buildCeilingLights, collectNightLights } from './night-lights.js';
import { buildWindowTrough } from './plants.js';
import { OFFICE_SHELLS } from './office-shells.js';

// Builds the L-shaped cutaway office shell for the active theme:
//   - either a diorama plinth (ground floor) or the storeys below (upper floors)
//   - a themed floor finish: plank, poured concrete, or carpet tile
//   - sage back wall (with the door) and white left wall, both with windows
//   - a landing outside the door, kept at floor level so agents walk in and out
//     on a single plane; it gains steps down to the pavement at ground level
//   - the world outside (street in three seasons, or a high-rise outlook)
//
// Returns handles, notably { door } which the agent layer animates.

/**
 * How far the base mass under the lowest modelled storey has to reach, for the
 * outlooks where the ground is nowhere near it.
 *
 * A building on a street meets the street, and needs no entry here. A tower on
 * level 34 does not: without being carried down to the rooftops it stops in
 * mid-air with daylight underneath. The rooftops of Paris are the same problem one
 * storey up — the neighbouring blocks are cut off well below their own street, so
 * ours goes down to the same place rather than showing a bottom nobody should see.
 */
const BASE_TO = {
  'skyline-high': SKYLINE_GROUND_Y - 0.5,
  'paris-rooftops': PARIS_BASE_Y + 2,
};

export function buildEnvironment(scene, theme) {
  const env = group(0, 0, 0);
  const handles = {};

  // Sensible defaults for when theme is undefined
  const floorSpec = theme?.floor ?? { kind: 'plank', plankWidth: 1.6 };
  const outside = theme?.outside ?? 'street-summer';
  const elevation = theme?.elevation ?? 'ground';
  const storeysBelow = theme?.storeysBelow ?? 0;
  const showPlinth = theme?.plinth ?? true;
  const entrance = theme?.entrance ?? 'stoop';
  const lowerWalls = theme?.lowerWalls ?? 'glazed';
  // Loading doors need somewhere for vehicles to arrive from.
  const serviceYard = theme?.serviceYard ?? false;
  // Painted signage across the brick of a solid-walled building.
  const signText = theme?.signText ?? null;
  // A pitched roof over the two standing walls, for the buildings that have one.
  const roof = theme?.roof ?? null;
  const shell = OFFICE_SHELLS[theme?.building];

  // ---- Diorama plinth (only when not showing storeys below) ----
  if (showPlinth) {
    put(env, box(ROOM.W + 4, 1.2, ROOM.D + 4, COLORS.baseboard, { rough: 0.95 }), ROOM.W / 2, -0.6, ROOM.D / 2);
    put(env, box(ROOM.W + 4.2, 0.5, ROOM.D + 4.2, COLORS.woodMid, { rough: 0.9 }), ROOM.W / 2, -1.0, ROOM.D / 2);
  }

  // ---- Storeys below (when this floor is not ground level) ----
  if (storeysBelow > 0) {
    const storeys = buildStoreysBelow({
      count: storeysBelow,
      roomW: ROOM.W,
      roomD: ROOM.D,
      wallT: ROOM.wallT,
      walls: lowerWalls,
      signText,
      baseTo: BASE_TO[outside] ?? null,
    });
    env.add(storeys);
  }

  // ---- Floor (plank, concrete, or carpet) ----
  env.add(shell ? shell.floor(theme) : buildFloor(floorSpec));

  // ---- Glass balustrade on the open edges (tower floors) ----
  // Only the tower gets one: it is the only floor where the cutaway edge is a real
  // drop rather than the side of a dolls' house.
  if (theme?.building === 'skyscraper') env.add(buildEdgeBalustrade());

  // ---- Stone balcony with planters (mansard floors) ----
  // The tower's counterpart for a building with no glass edge to speak of: not a
  // walkway — nothing paths onto it, same as the balustrade — just the ledge a
  // Haussmann roofline actually has, dressed with the season's planting.
  if (theme?.building === 'mansard') env.add(buildEdgeBalcony(theme?.season));

  // ---- Back wall (sage) with windows + the door ----
  // The left wall owns the corner, so this one stops against its inner face. Its
  // far end is the cutaway edge of the diorama, where the skirting returns.
  //
  // The mansard's stair runs most of the length of this wall (buildStaircase,
  // same flight the warehouse uses, just restyled — see below), past a small
  // landing right outside the door. Standing on that landing: a wall a short
  // step ahead of you, a wall to your left closing off the corner, and open to
  // your right along the recess to the stairs and the glazing that looks onto
  // them — not glazing immediately behind the door itself, which would just be
  // a pane a step from your face.
  const glazedStairwell = entrance === 'stairs' && theme?.building === 'mansard';
  if (shell) {
    const { height, portalWidth } = shell;
    const portal = buildWall({
      length: portalWidth, height,
      position: [portalWidth / 2, height / 2, 0], rotationY: 0,
      color: COLORS.wallSage, extent: [0.2 - portalWidth / 2, portalWidth / 2],
      door: { localX: DOOR.x - portalWidth / 2, width: DOOR.width, height: DOOR.height, entrance },
    });
    env.add(portal.obj, shell.build(theme));
    handles.door = portal.door;
  } else {
    // The door's own jambs — the landing's walls pick up exactly where the door
    // casing stops, so there is no seam between them.
    const doorLeftX = DOOR.x - DOOR.width / 2;
    const doorRightX = DOOR.x + DOOR.width / 2;
    // Where the landing's back wall stops and the glazing (with the stairs
    // behind it) takes over.
    const pocketRightX = doorRightX + 0.4;
    // The door reads as centred in an ordinary stretch of wall, not jammed
    // against an opening: a stub of wall to its right, in the same z = 0 plane
    // as the stub already standing to its left, exactly as long as that one is.
    // Past that stub the plane carries on as a railing rather than more wall or
    // more glass — see buildStairwellRail below.
    const stubLen = doorLeftX - ROOM.wallT / 2;
    const rightStubEnd = doorRightX + stubLen;

    const backWall = buildWall({
      length: ROOM.W,
      color: COLORS.wallSage,
      position: [ROOM.W / 2, ROOM.H / 2, 0],
      rotationY: 0,
      extent: glazedStairwell
        ? [-ROOM.W / 2 + ROOM.wallT / 2, rightStubEnd - ROOM.W / 2]
        : [-ROOM.W / 2 + ROOM.wallT / 2, ROOM.W / 2],
      skirtReturns: [false, true],
      windows: glazedStairwell ? [] : WINDOWS.back,
      door: {
        localX: DOOR.x - ROOM.W / 2,
        width: DOOR.width,
        height: DOOR.height,
        entrance,
        storeysBelow,
      },
    });
    env.add(backWall.obj);
    // The agent layer animates whatever is in the opening via requestOpen(), so a
    // lift and a hinged door are interchangeable from its point of view.
    handles.door = backWall.door;
    if (entrance === 'elevator') handles.elevator = backWall.door;

    if (glazedStairwell) {
      // The landing: a wall facing the door and a wall closing the corner to its
      // left, both ordinary one-storey walls — neither is anywhere near the
      // stairs, so neither needs to reach below the floor.
      put(env, box(pocketRightX - doorLeftX, ROOM.H, ROOM.wallT, COLORS.facadeLower, { rough: 0.9, cast: false }), (doorLeftX + pocketRightX) / 2, ROOM.H / 2, -STAIR_WIDTH);
      put(env, box(ROOM.wallT, ROOM.H, STAIR_WIDTH, COLORS.facadeLower, { rough: 0.9, cast: false }), doorLeftX, ROOM.H / 2, -STAIR_WIDTH / 2);
      // The glazing's own stone cap (buildStairwellGlazing) starts at pocketRightX;
      // this carries the same coping back over the landing's wall too, so it reads
      // as one continuous line the whole way rather than stopping short right where
      // the landing itself needed it most.
      const landingCap = box(pocketRightX - doorLeftX + ROOM.wallT, 0.3, STAIR_WIDTH + 0.2,
        COLORS.baseCourse, { rough: 0.9, cast: false });
      landingCap.position.set((doorLeftX + pocketRightX) / 2, ROOM.H + 0.15, -STAIR_WIDTH);
      env.add(landingCap);

      // The far wall, at the open-corner end of the recess: this one *is* beside
      // the stairs, so it has to reach down with them rather than stop at the
      // floor and leave the lower flight hanging past its bottom edge.
      const dropHeight = storeysBelow * STOREY_H + 1.5;
      put(env, box(ROOM.wallT, ROOM.H + dropHeight, STAIR_WIDTH, COLORS.facadeLower, { rough: 0.9, cast: false }), ROOM.W, ROOM.H / 2 - dropHeight / 2, -STAIR_WIDTH / 2);

      env.add(buildStairwellGlazing(pocketRightX, ROOM.W, ROOM.H, dropHeight));
      // The balcony's parapet doesn't stop at the corner either — it turns and
      // runs along the stairwell's own open edge, picking up exactly where the
      // right-hand stub of wall stops (so the wall and the rail read as one
      // continuous plane) and reaching the balcony's own rail line (its lip is
      // BALCONY_LEDGE_D past ROOM.W, same as buildEdgeBalcony works out), so the
      // two actually meet instead of stopping a short gap apart.
      env.add(buildStairwellRail(rightStubEnd, ROOM.W + BALCONY_LEDGE_D - 0.04, theme?.season));
    }

    // ---- Left wall (white) with a window ----
    // Runs past the back wall's outer face to close the corner, so there is no notch
    // on the outside where the two meet. Its local +x end is the corner; the far end
    // is the cutaway edge.
    const leftWall = buildWall({
      length: ROOM.D,
      color: COLORS.wallWhite,
      position: [0, ROOM.H / 2, ROOM.D / 2],
      rotationY: Math.PI / 2,
      extent: [-ROOM.D / 2, ROOM.D / 2 + ROOM.wallT / 2],
      skirtReturns: [true, false],
      windows: WINDOWS.left,
      door: null,
    });
    env.add(leftWall.obj);
  }

  // ---- The roof ----
  // Only ever over the far two walls: see buildRoof(). Built before the exterior so
  // it is in place by the time the season outside is decided.
  if (roof) env.add(buildRoof(roof, ROOM));

  // ---- Ground outside the door ----
  // A lift needs no stoop: its car floor is the landing, and building one would
  // leave a slab hanging in the shaft while the car is on another floor.
  if (entrance !== 'elevator') {
    // A landing at floor level, with no steps down off it, is what an upper floor
    // needs — and also what a hatch needs, where there is no ground to step down to.
    const levelLanding = storeysBelow > 0 || entrance === 'hatch';
    env.add(buildStoop(levelLanding));
    // The way in from the street, published for the same reason the lift is.
    handles.stoop = stoopApproach(levelLanding);
    if (entrance === 'stairs') {
      // Handed out for the same reason the lift is: it is the way into this
      // building, so everything that comes in has to know the way up. Present only
      // when the entrance is a flight, which is what switches the courier and the
      // agents from walking in off a stoop to climbing.
      handles.stairs = stairFlight(storeysBelow * STOREY_H);
      // Stone treads and an iron rail behind the glazing, rather than the
      // warehouse's timber — same flight, dressed for the building it's on.
      env.add(buildStaircase(handles.stairs, glazedStairwell ? {
        tread: COLORS.baseCourse, post: COLORS.metalDark ?? COLORS.frame,
        rail: COLORS.metalDark ?? COLORS.frame, baluster: COLORS.metalDark ?? COLORS.frame,
      } : undefined));
    }
  }

  // ---- The office's own lighting, for after dark ----
  env.add(buildCeilingLights(theme?.fittings));

  scene.add(env);

  // ---- The world outside ----
  // The season is passed alongside the mode because the mode alone cannot carry it:
  // a tower insists on 'skyline-high' whatever the season, so the roofscape was
  // pinned to summer for ever.
  buildExterior(env, {
    mode: outside, season: theme?.season, elevation, storeysBelow, serviceYard, building: theme?.building,
  });

  // Every fitting that comes on after dark, gathered in one pass now that the
  // whole environment exists. Collected rather than returned piecemeal, because
  // street lamps are built deep inside the exterior and threading handles back up
  // would touch every builder in between. Must run after buildExterior().
  handles.nightLights = collectNightLights(env);

  return handles;
}

function buildFloor(floorSpec) {
  const g = group(0, 0, 0);
  const kind = floorSpec.kind || 'plank';

  if (kind === 'plank') {
    // Alternating planks running the length of the room, with a hairline of
    // shadow between them: each one keeps to its own `plankW` bay and is laid
    // 3% narrower than the bay, so the gap is split either side of it.
    //
    // The last bay is cut off at the wall. A plank width rarely divides ROOM.W
    // exactly — 0.9 into 26 leaves a quarter-bay over — and a whole final plank
    // ran that remainder out past the room, which on the mansard put the
    // floorboards' top face 0.09 inside the balcony ledge's, both of them on
    // y = FLOOR_TOP, flashing down the whole open edge as the camera moved.
    // Two surfaces on one plane, the fault docs/developer/coplanar-probe.md exists to
    // catch. The boards stop where the room does.
    const plankW = floorSpec.plankWidth ?? 1.6;
    const gap = plankW * 0.03;
    const planks = Math.ceil(ROOM.W / plankW);
    for (let i = 0; i < planks; i++) {
      const shade = i % 2 === 0 ? COLORS.floorWood : COLORS.floorWoodAlt;
      const x0 = i * plankW + gap / 2;
      const x1 = Math.min((i + 1) * plankW - gap / 2, ROOM.W);
      if (x1 - x0 <= 0) continue;
      const p = box(x1 - x0, FLOOR_THICKNESS, ROOM.D, shade, { rough: 0.8, cast: false });
      p.position.set((x0 + x1) / 2, 0, ROOM.D / 2);
      p.receiveShadow = true;
      g.add(p);
    }
  } else if (kind === 'concrete') {
    // Poured concrete slabs with subtle seams (polished, low roughness).
    const tileSize = floorSpec.tileSize ?? 6;
    const tilesX = Math.ceil(ROOM.W / tileSize);
    const tilesZ = Math.ceil(ROOM.D / tileSize);
    const seamThickness = 0.08;

    for (let ix = 0; ix < tilesX; ix++) {
      for (let iz = 0; iz < tilesZ; iz++) {
        const x = ix * tileSize + tileSize / 2;
        const z = iz * tileSize + tileSize / 2;
        const shade = (ix + iz) % 2 === 0 ? COLORS.floorConcrete : COLORS.floorConcreteAlt;
        const slab = box(tileSize - seamThickness, FLOOR_THICKNESS, tileSize - seamThickness, shade, {
          rough: 0.4,  // Polished concrete: lower roughness
          cast: false,
        });
        slab.position.set(x, 0, z);
        slab.receiveShadow = true;
        g.add(slab);
      }
    }

    // Seam lines between slabs (thin, darker strips).
    // Horizontal seams (running +x)
    for (let iz = 0; iz <= tilesZ; iz++) {
      const z = iz * tileSize;
      if (z > 0 && z < ROOM.D) {
        const seam = box(ROOM.W, 0.15, seamThickness, COLORS.floorSeam, { cast: false });
        seam.position.set(ROOM.W / 2, 0.01, z);
        seam.receiveShadow = true;
        g.add(seam);
      }
    }
    // Vertical seams (running +z)
    for (let ix = 0; ix <= tilesX; ix++) {
      const x = ix * tileSize;
      if (x > 0 && x < ROOM.W) {
        const seam = box(seamThickness, 0.15, ROOM.D, COLORS.floorSeam, { cast: false });
        seam.position.set(x, 0.01, ROOM.D / 2);
        seam.receiveShadow = true;
        g.add(seam);
      }
    }
  } else if (kind === 'carpet') {
    // Carpet tiles in alternating tones (matte, high roughness).
    const tileSize = floorSpec.tileSize ?? 2.4;
    const tilesX = Math.ceil(ROOM.W / tileSize);
    const tilesZ = Math.ceil(ROOM.D / tileSize);

    for (let ix = 0; ix < tilesX; ix++) {
      for (let iz = 0; iz < tilesZ; iz++) {
        const x = ix * tileSize + tileSize / 2;
        const z = iz * tileSize + tileSize / 2;
        const shade = (ix + iz) % 2 === 0 ? COLORS.floorCarpet : COLORS.floorCarpetAlt;
        const tile = box(tileSize * 0.99, FLOOR_THICKNESS, tileSize * 0.99, shade, {
          rough: 0.95,  // Matte carpet
          cast: false,
        });
        tile.position.set(x, 0, z);
        tile.receiveShadow = true;
        g.add(tile);
      }
    }
  }

  return g;
}

/**
 * A wall assembled from solid strips around window and door openings, so we never
 * need CSG. Returns { obj, door } where door is an animatable handle.
 *
 * Exported for reception's vignette (scene/vignette.js), which builds a corner of
 * two of these at a fraction of the room's height. That is what `height`, `sill`
 * and `head` are for: an eight-unit wall glazed between 2.2 and 6.8 is right for a
 * room seen whole, and wrong for a close-up whose frame runs out below the sill.
 * Left alone they are the room's own figures, so the office is unaffected.
 *
 * @param extent  Local-x bounds of the wall's solid mass, defaulting to its full
 *   length. Lets one wall of a corner own the corner outright while the other
 *   stops against its inner face. The two used to run their full lengths and
 *   interpenetrate, which left both top faces sharing one plane over the square
 *   where they crossed — two different colours with no depth order between them,
 *   flickering at the top of the corner. Butting them means the only coincident
 *   faces left point in opposite directions, so one is always culled.
 * @param skirtReturns  Per end ([start, end]), whether that end is an exposed cut
 *   where the skirting returns around the wall rather than stopping flush with it.
 *   Flush put the board's end cap in the wall's own end plane — the same coplanar
 *   pair, this time beige against sage at the open end of the wall.
 * @param height  Wall height, defaulting to ROOM.H.
 * @param sill    World height of a window sill, defaulting to the room's.
 * @param head    World height of a window head, defaulting to the room's.
 */
export function buildWall({
  length, color, position, rotationY, windows = [], door = null,
  extent = null, skirtReturns = [false, false],
  height = ROOM.H, sill = WINDOW_SILL_Y, head = WINDOW_HEAD_Y,
}) {
  const g = group(...position);
  g.rotation.y = rotationY;

  const t = ROOM.wallT;
  const H = height;
  const [massFrom, massTo] = extent ?? [-length / 2, length / 2];
  // Local y, from the shared world heights: the wall's own origin is mid-height.
  const sillY = sill - H / 2;
  const headY = head - H / 2;

  // Normalise every opening into local-x ranges with vertical extents.
  const openings = [];
  for (const w of windows) {
    const cx = -length / 2 + w.center * length;
    openings.push({
      kind: 'window', cx, width: w.width,
      yBottom: sillY, yTop: headY,
    });
  }
  if (door) {
    openings.push({
      kind: 'door', cx: door.localX, width: door.width,
      yBottom: -H / 2, yTop: -H / 2 + door.height,
    });
  }
  openings.sort((a, b) => a.cx - b.cx);

  const addSolid = (from, to) => {
    const w = to - from;
    if (w <= 0.001) return;
    const panel = box(w, H, t, color, { rough: 0.9, cast: false });
    panel.position.set((from + to) / 2, 0, 0);
    panel.receiveShadow = true;
    g.add(panel);
  };

  let cursor = massFrom;
  let doorHandle = null;

  for (const op of openings) {
    const from = op.cx - op.width / 2;
    const to = op.cx + op.width / 2;
    addSolid(cursor, from);

    // Strip below the opening (windows only — doors reach the floor).
    if (op.yBottom > -H / 2 + 0.001) {
      const belowH = op.yBottom - (-H / 2);
      const below = box(op.width, belowH, t, color, { rough: 0.9, cast: false });
      below.position.set(op.cx, -H / 2 + belowH / 2, 0);
      below.receiveShadow = true;
      g.add(below);
    }
    // Strip above the opening.
    if (op.yTop < H / 2 - 0.001) {
      const aboveH = (H / 2) - op.yTop;
      const above = box(op.width, aboveH, t, color, { rough: 0.9, cast: false });
      above.position.set(op.cx, op.yTop + aboveH / 2, 0);
      above.receiveShadow = true;
      g.add(above);
    }

    if (op.kind === 'window') {
      g.add(buildWindow(op.cx, (op.yBottom + op.yTop) / 2, op.width, op.yTop - op.yBottom));
    } else {
      const built = door?.entrance === 'elevator'
        ? buildElevator(op.cx, -H / 2, op.width, op.yTop - op.yBottom,
                        { storeysBelow: door.storeysBelow })
        : buildDoor(op.cx, -H / 2, op.width, op.yTop - op.yBottom);
      g.add(built.obj);
      doorHandle = built.handle;
    }
    cursor = to;
  }
  addSolid(cursor, massTo);

  // Baseboard, split so it doesn't run across the doorway.
  //
  // It already stands this far off both wall faces, so returning it around an
  // exposed end by the same amount reads as a mitred return rather than a board
  // that has been cut back.
  const SKIRT_PROUD = 0.04;
  const skirtFrom = massFrom - (skirtReturns[0] ? SKIRT_PROUD : 0);
  const skirtTo = massTo + (skirtReturns[1] ? SKIRT_PROUD : 0);

  const doorSpan = door ? [door.localX - door.width / 2, door.localX + door.width / 2] : null;
  const addBase = (from, to) => {
    if (to - from <= 0.001) return;
    put(g, box(to - from, 0.6, t + SKIRT_PROUD * 2, COLORS.baseboard, { rough: 0.85, cast: false }), (from + to) / 2, -H / 2 + 0.3, 0);
  };
  if (doorSpan) {
    addBase(skirtFrom, doorSpan[0]);
    addBase(doorSpan[1], skirtTo);
  } else {
    addBase(skirtFrom, skirtTo);
  }

  return { obj: g, door: doorHandle };
}

export function buildWindow(cx, cy, w, h) {
  const g = group(cx, cy, 0);
  const frameC = COLORS.frame;
  const fT = WINDOW_FRAME_T;

  const fD = WINDOW_FRAME_D;
  const top = box(w + fT, fT, fD, frameC); top.position.set(0, h / 2, 0);
  const bot = box(w + fT, fT, fD, frameC); bot.position.set(0, -h / 2, 0);
  const left = box(fT, h + fT, fD, frameC); left.position.set(-w / 2, 0, 0);
  const right = box(fT, h + fT, fD, frameC); right.position.set(w / 2, 0, 0);
  g.add(top, bot, left, right);

  // Read rather than declared, so `windowLight()` in config.js is describing the same
  // bars this draws. It has to be: the birds fly through one of these holes, and a
  // builder that quietly divided the glass differently would put them through timber.
  const { cols, rows, barT, barD } = WINDOW_LIGHTS;
  for (let i = 1; i < cols; i++) {
    put(g, box(barT, h, barD, frameC, { cast: false }), -w / 2 + (w / cols) * i, 0, 0);
  }
  for (let j = 1; j < rows; j++) {
    put(g, box(w, barT, barD, frameC, { cast: false }), 0, -h / 2 + (h / rows) * j, 0);
  }

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      color: COLORS.glass, transparent: true, opacity: 0.22,
      roughness: 0.1, metalness: 0.0,
    })
  );
  glass.position.set(0, 0, 0.05);
  g.add(glass);

  return g;
}

// A framed doorway with a hinged leaf that swings inward (+z) when agents pass.
export function buildDoor(cx, yFloor, w, h) {
  const g = group(cx, yFloor, 0);
  const frameC = COLORS.frame;
  const fT = 0.3;

  // Casing.
  const left = box(fT, h + fT, 0.62, frameC); left.position.set(-w / 2, (h + fT) / 2, 0);
  const right = box(fT, h + fT, 0.62, frameC); right.position.set(w / 2, (h + fT) / 2, 0);
  const head = box(w + fT * 2, fT, 0.62, frameC); head.position.set(0, h + fT / 2, 0);
  g.add(left, right, head);

  // Threshold plate flush with the floor.
  put(g, box(w, 0.12, 0.7, 0x8a6a4a, { rough: 0.8, cast: false }), 0, 0.06, 0);

  // A little brass plaque above the door (nod to the inspo signage).
  put(g, box(1.5, 0.34, 0.1, 0xbf9b45, { rough: 0.35, metal: 0.6 }), 0, h + 0.75, 0.2);

  // Hinged leaf: pivot on the left jamb so it opens inward.
  const pivot = group(-w / 2 + 0.06, 0, 0);
  const leafW = w - 0.12;
  put(pivot, box(leafW, h - 0.1, 0.14, 0x8a5230, { rough: 0.65 }), leafW / 2, (h - 0.1) / 2, 0);
  // Two recessed panels for a classic look.
  for (const py of [h * 0.28, h * 0.66]) {
    put(pivot, box(leafW * 0.62, h * 0.26, 0.06, 0x9a5f38, { rough: 0.6, cast: false }), leafW / 2, py, 0.09);
  }
  // Handle.
  const knob = cyl(0.09, 0.09, 0.22, 0xbf9b45, { segments: 10, metal: 0.7, rough: 0.3 });
  knob.rotation.x = Math.PI / 2;
  knob.position.set(leafW - 0.28, h * 0.45, 0.16);
  pivot.add(knob);
  g.add(pivot);

  const MAX_OPEN = -Math.PI * 0.46;   // negative swings toward +z (interior)

  const handle = {
    id: 'door',
    pivot,
    _hold: 0,
    /** Ask the door to be open this frame; it eases shut once nobody asks. */
    requestOpen(seconds = 0.9) { this._hold = Math.max(this._hold, seconds); },
    update(dt) {
      if (this._hold > 0) this._hold -= dt;
      const target = this._hold > 0 ? MAX_OPEN : 0;
      pivot.rotation.y += (target - pivot.rotation.y) * Math.min(1, dt * 7);
    },
  };

  return { obj: g, handle };
}

// --- Glazed stairwell (mansard) ----------------------------------------------
// The back wall past the door, pushed back a stair's width and rebuilt in
// glass — mullions and panes, no wall behind them at all, run from the cap
// down past the floor to the depth the stair actually reaches, so the flight
// (buildStaircase, called from buildEnvironment with stone-and-iron colours)
// stays behind glass for its whole visible run instead of the glazing stopping
// at floor level and leaving the lower steps hanging in open air. There is no
// return wall closing the door end: the wall it would close against was asked
// to go too, so the glazing simply starts at x0, an exposed cut like every
// other open edge in this diorama. `z` is fixed at -STAIR_WIDTH: exactly deep
// enough that the flight, which already sits centred on STAIR_Z hugging the
// *original* wall line, now has its outer edge flush with the glass instead of
// flush with the wall it used to run against.
function buildStairwellGlazing(x0, x1, height, dropHeight) {
  const g = group(0, 0, 0);
  const frameC = COLORS.frame;
  const stone = COLORS.baseCourse;
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const z = -STAIR_WIDTH;
  const bottom = -dropHeight;
  const fullH = height - bottom;

  // A stone cap along the top: nothing else reaches up here to roof over the
  // recess, and a pane simply stopping short of the sky is an unfinished edge
  // rather than a wall.
  put(g, box(w + ROOM.wallT, 0.3, STAIR_WIDTH + 0.2, stone, { rough: 0.9, cast: false }), cx, height + 0.15, z);

  const cols = Math.max(2, Math.round(w / 2.6));
  const colW = w / cols;
  for (let i = 0; i <= cols; i++) {
    put(g, box(0.1, fullH, 0.16, frameC, { rough: 0.5, metal: 0.4, cast: false }), x0 + i * colW, (height + bottom) / 2, z);
  }
  put(g, box(w, 0.1, 0.16, frameC, { rough: 0.5, metal: 0.4, cast: false }), cx, height, z);

  for (let i = 0; i < cols; i++) {
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(colW - 0.14, fullH - 0.16),
      new THREE.MeshStandardMaterial({
        color: COLORS.glass ?? 0xa8c8dc, transparent: true, opacity: 0.22,
        roughness: 0.08, metalness: 0.0,
      })
    );
    pane.position.set(x0 + (i + 0.5) * colW, (height + bottom) / 2, z + 0.05);
    g.add(pane);
  }

  return g;
}

// The balcony's own parapet, continued round the corner along the stairwell's
// open edge rather than stopping where the wall did. No ledge here — the
// floor already reaches this line, there is no street to cantilever over —
// just the rail and a trough, the same iron and the same planting as the
// balcony it is a continuation of.
function buildStairwellRail(x0, x1, season = 'autumn') {
  const g = group(0, 0, 0);
  const iron = COLORS.metalDark ?? COLORS.frame;
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;

  put(g, box(w, 0.06, 0.06, iron, { rough: 0.5, metal: 0.55, cast: false }), cx, FLOOR_TOP + BALCONY_RAIL_H, 0);

  const balusters = Math.max(3, Math.round(w / 0.55));
  for (let i = 0; i <= balusters; i++) {
    put(g, box(0.05, BALCONY_RAIL_H, 0.05, iron, { rough: 0.5, metal: 0.55, cast: false }), x0 + (i / balusters) * w, FLOOR_TOP + BALCONY_RAIL_H / 2, 0);
  }

  put(g, buildWindowTrough({ width: Math.min(1.8, w - 0.6), season }), cx, FLOOR_TOP - 0.02, -0.08);

  // The corner post where this rail meets the balcony's own x-edge (its lip
  // is exactly x1, see buildEdgeBalcony) — the same thicker post as the
  // balcony's other corners, so the join reads the same way at all three.
  put(g, box(0.1, BALCONY_RAIL_H, 0.1, iron, { rough: 0.45, metal: 0.6, cast: false }), x1, FLOOR_TOP + BALCONY_RAIL_H / 2, 0);

  return g;
}

// ---------------------------------------------------------------------------
// Elevator: an exposed shaft on the outside of the building, with a car that
// actually travels between floors and sliding doors at the threshold.
//
// The car doubles as the landing — when it is at this floor its floor plate is
// flush with the office floor, so agents step straight out of it. That is why no
// stoop is built for this entrance: the car *is* the ground outside the door.
// Agent arrivals and departures are gated on `ready`, so nobody is ever standing
// in the shaft with the car somewhere else.

const CAR_SPEED = 9.5;          // units/sec of travel
const CAR_DOOR_TIME = 0.75;     // seconds for the doors to slide fully open
const CAR_MIN_DWELL = 1.6;      // doors stay open at least this long
export function buildElevator(cx, yFloor, w, h, { storeysBelow = 3 } = {}) {
  const g = group(cx, yFloor, 0);
  // This floor is the top of the building, so the car only ever travels DOWN from
  // here and back up again. Nothing exists above it to serve, and a shaft running
  // on past the open floor would look like it led into the sky.
  const parkFloors = [];
  for (let f = -Math.max(1, storeysBelow); f <= -1; f++) parkFloors.push(f);
  const frameC = COLORS.frame;
  const shaftDepth = DOOR.stoopDepth + 0.4;      // z from 0 back to -3.4
  const halfW = w / 2;

  // ---- Threshold surround ----
  // The frame laps over the opening instead of butting up to it.
  //
  // Sat flush, each jamb's inner face landed exactly on the wall's reveal — two
  // faces on one plane down the full height of the door, and the largest contested
  // surface in the building. That is the flicker at the lift: it needed neither the
  // doors moving nor the shadow map, only a camera, which is why it survived every
  // fix aimed at the leaves. The head did the same against the soffit above the
  // opening, and all three pieces shared their top faces where they crossed.
  //
  // So the jambs are the posts — full height, lapped `LAP` into the opening, which
  // buries the reveal behind them. The head then runs between the posts, dipping
  // below the soffit and dying inside each one, its top held just shy of theirs.
  // Every plane the frame used to share is now inside solid metal.
  const jambT = 0.34;
  const LAP = 0.06;
  const left = box(jambT + LAP, h + jambT, 0.7, frameC);
  left.position.set(-halfW - jambT / 2 + LAP / 2, (h + jambT) / 2, 0);
  const right = box(jambT + LAP, h + jambT, 0.7, frameC);
  right.position.set(halfW + jambT / 2 - LAP / 2, (h + jambT) / 2, 0);
  // Laps 0.04 into each post, and stops 0.03 short of their tops.
  const headBottom = h - LAP;
  const headTop = h + jambT - 0.03;
  const head = box(w - LAP * 2 + 0.08, headTop - headBottom, 0.7, frameC);
  head.position.set(0, (headBottom + headTop) / 2, 0);
  g.add(left, right, head);

  // Wider than the opening, so its ends tuck under the jambs. Cut to the opening
  // width exactly, each end landed on the same plane as a closed leaf's outer edge.
  put(g, box(w + 0.08, 0.12, 0.8, 0x6f757c, { rough: 0.5, metal: 0.5, cast: false }), 0, 0.06, 0);

  // Arrival lamp above the doors, lit only while the car is standing here.
  const lampMat = mat(0x3a4048, { rough: 0.4, emissive: 0xffca6a, emissiveIntensity: 0 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.26, 0.12), lampMat);
  lamp.position.set(0, h + 0.72, 0.3);
  g.add(lamp);

  // ---- Shaft ----
  // Deliberately no wall on the +x side: the camera looks at +x faces, so leaving
  // it open as an exposed steel frame is what makes the car's travel readable.
  const shaftBottom = (Math.min(...parkFloors) - 0.5) * STOREY_H;
  // Stops just over the door head: enough for the car plus overrun, and no more.
  const shaftTop = h + 1.6;
  const shaftH = shaftTop - shaftBottom;
  const shaftY = shaftBottom + shaftH / 2;

  put(g, box(w + jambT * 2, shaftH, 0.3, COLORS.facadeLower, { rough: 0.85 }), 0, shaftY, -shaftDepth);

  put(g, box(0.3, shaftH, shaftDepth, COLORS.facadeLower, { rough: 0.85 }), -halfW - jambT, shaftY, -shaftDepth / 2);

  // Corner columns + ties on the open side, so it reads as structure not a gap.
  for (const cz of [-0.15, -shaftDepth + 0.15]) {
    put(g, box(0.26, shaftH, 0.26, frameC, { rough: 0.6, metal: 0.4, cast: false }), halfW + jambT, shaftY, cz);
  }
  for (let ty = shaftBottom + STOREY_H; ty < shaftTop; ty += STOREY_H) {
    put(g, box(0.22, 0.22, shaftDepth, frameC, { rough: 0.6, metal: 0.4, cast: false }), halfW + jambT, ty, -shaftDepth / 2);
  }

  // ---- The car ----
  const car = group(0, 0, 0);
  const carH = h + 0.5;
  const carW = w + 0.1;
  const carD = shaftDepth - 0.4;
  const carZ = -carD / 2 - 0.2;

  // The shell is a depth ladder rather than a set of flush panels.
  //
  // Floor, ceiling and back were each exactly `carW` wide, and the side panels'
  // outer faces landed on that same width — so three pairs of surfaces contested
  // each side plane of the car, down its full height, on the +x faces the camera
  // looks straight at. Floor and sides shared their front and back planes too.
  // That is the flicker that outlived every fix to the doors: it was never the
  // doors, it was the car, which is why it showed while the car was standing at
  // the landing with the doors open, and moved when the camera did.
  //
  // So the sides alone reach the full width, and the panels they carry run *into*
  // their thickness and stop at three different depths inside it: every edge is
  // buried in solid metal, no two land on one plane, and nothing gains a gap.
  const SIDE_T = 0.12;
  const FLOOR_BITE = 0.07;      // each panel stops this far short of the outer
  const CEIL_BITE = 0.09;       //   face — all less than SIDE_T so the edge dies
  const BACK_BITE = 0.05;       //   inside the side, all different so none meet

  const carFloor = box(carW - FLOOR_BITE * 2, 0.22, carD, 0x8d949b,
    { rough: 0.5, metal: 0.3, cast: false });
  carFloor.position.set(0, 0.0, carZ);
  carFloor.receiveShadow = true;
  car.add(carFloor);

  put(car, box(carW - CEIL_BITE * 2, 0.18, carD, 0x7e858c, { rough: 0.6, cast: false }), 0, carH, carZ);

  put(car, box(carW - BACK_BITE * 2, carH, 0.12, 0x9aa1a8, { rough: 0.55, cast: false }), 0, carH / 2, carZ - carD / 2);

  for (const sx of [-1, 1]) {
    // Held 0.04 clear of the floor plate at each end: the back edge dies inside
    // the back panel, and the front one simply stops short of the car's threshold
    // instead of landing on the same plane as the floor's.
    put(car, box(SIDE_T, carH, carD - 0.08, 0x939aa1, { rough: 0.55, cast: false }), sx * (carW - SIDE_T) / 2, carH / 2, carZ);
  }

  // Warm ceiling panel so the interior reads as lit even in shadow.
  const carLight = box(carW * 0.6, 0.06, carD * 0.5, 0xfff2d8, {
    rough: 0.3, emissive: 0xffe6b0, emissiveIntensity: 0.9, cast: false,
  });
  carLight.position.set(0, carH - 0.14, carZ);
  car.add(carLight);

  // A handrail on the back wall — small, but it sells the interior.
  const rail = cyl(0.05, 0.05, carW * 0.7, 0xc9ced4, { segments: 8, metal: 0.8, rough: 0.3, cast: false });
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, carH * 0.42, carZ - carD / 2 + 0.18);
  car.add(rail);

  g.add(car);

  // ---- Sliding doors ----
  // Two leaves meeting in the middle, retracting behind the jambs.
  //
  // The two leaves are parted by a seam instead of meeting edge to edge. Each ran
  // the full half-width, so closed, their leading faces landed on exactly x = 0 —
  // one coplanar pair down the full height of the door, which is why the doors only
  // misbehaved once shut. A real lift has that seam anyway.
  //
  // They are also run into the sill below and the head above rather than stopping
  // short: the old leaf shared its underside with the sill's, and left a 0.06 slot
  // of open shaft under the head. Both ends are now buried in trim that is deeper
  // than the leaf, so neither shows.
  const SEAM = 0.015;              // half the gap between the closed leaves
  const leafW = halfW - SEAM;
  const leafBottom = 0.02;         // inside the sill, which stands 0.12 proud
  const leafTop = h + 0.04;        // inside the head, which starts at h
  const panels = [];
  for (const sx of [-1, 1]) {
    // Casts no shadow. A leaf is 0.14 thick and slides inside a wall 0.2 thick, so
    // its faces run about 0.03 from the wall's own — close enough for the shadow map,
    // which is far coarser than the depth buffer, to shadow the wall against itself.
    // That is the flicker that survived the geometry fixes: it moved with the doors
    // because the caster did. Nothing is lost by dropping it — the leaf sits in a
    // doorway, and the wall around it casts the shadow that reads.
    const panel = box(leafW, leafTop - leafBottom, 0.14, 0xb6bcc3,
      { rough: 0.4, metal: 0.45, cast: false });
    // Outer edge still lands on the jamb at sx * halfW; only the leading edge moves.
    const home = sx * (halfW + SEAM) / 2;
    panel.position.set(home, (leafBottom + leafTop) / 2, 0);
    // A line down the leading edge, for a bit of relief. It has to stand proud of
    // the leaf: sat flat on the face, its back was coplanar with the face it lay on.
    put(panel, box(0.05, h - 0.6, 0.06, 0x8b9198, { rough: 0.5, cast: false }), -sx * (halfW / 2 - 0.12), 0, 0.06);
    g.add(panel);
    panels.push({ mesh: panel, dir: sx, home });
  }

  const pickPark = () => pick(parkFloors) * STOREY_H;

  const handle = {
    id: 'elevator',
    kind: 'elevator',
    // 'away' parked elsewhere | 'arriving' | 'open' | 'closing' | 'departing'
    state: 'away',
    carY: pickPark(),
    targetY: 0,
    doorT: 0,
    _hold: 0,
    _dwell: 0,

    /** True only when the car is here and the doors are wide enough to walk through. */
    get ready() { return this.state === 'open' && this.doorT > 0.9; },

    /** Summon the car to this floor. Safe to call repeatedly. */
    call() {
      if (this.state === 'away' || this.state === 'departing') {
        this.state = 'arriving';
        this.targetY = 0;
      }
      // Already here and closing up? Re-open rather than make them wait.
      if (this.state === 'closing') this.state = 'open';
    },

    /**
     * Door-compatible API so the agent layer can treat this like the swinging
     * door: asking it to open also summons it.
     */
    requestOpen(seconds = 0.9) {
      this._hold = Math.max(this._hold, seconds);
      this.call();
    },

    update(dt) {
      if (this._hold > 0) this._hold -= dt;

      switch (this.state) {
        case 'arriving':
        case 'departing': {
          const dy = this.targetY - this.carY;
          const step = Math.sign(dy) * Math.min(Math.abs(dy), CAR_SPEED * dt);
          this.carY += step;
          if (Math.abs(this.targetY - this.carY) < 0.02) {
            this.carY = this.targetY;
            if (this.state === 'arriving') {
              this.state = 'open';
              this._dwell = CAR_MIN_DWELL;
            } else {
              this.state = 'away';
            }
          }
          break;
        }
        case 'open':
          this.doorT = Math.min(1, this.doorT + dt / CAR_DOOR_TIME);
          this._dwell -= dt;
          // Only leave once fully open, nobody is asking, and it has stood here
          // long enough to look like a real stop.
          if (this.doorT >= 1 && this._hold <= 0 && this._dwell <= 0) this.state = 'closing';
          break;
        case 'closing':
          this.doorT = Math.max(0, this.doorT - dt / CAR_DOOR_TIME);
          if (this.doorT <= 0) {
            this.state = 'departing';
            // Never "travel" to the floor it is already on.
            let next = pickPark();
            if (next === this.carY) next = pickPark();
            this.targetY = next;
          }
          break;
        case 'away':
          break;
      }

      car.position.y = this.carY;

      // The landing doors stay put and simply sit closed while the car is away,
      // exactly as a real lift lobby does.
      const slide = (halfW - 0.06) * this.doorT;
      for (const p of panels) p.mesh.position.x = p.home + p.dir * slide;

      lampMat.emissiveIntensity = this.carY === 0 ? 0.95 : 0;
    },
  };

  return { obj: g, handle };
}

// --- Glass balustrade --------------------------------------------------------
// A frameless glass barrier along the two open edges of the floor: a metal shoe at
// the bottom, a slim cap rail on top, and toughened glass between.
//
// Its height is the desk top (buildDesk puts a 0.16 slab at y = 1.5), so the rail
// runs level with the desks rather than cutting the room at some unrelated line.
const DESK_TOP_Y = 1.58;
const BALUSTRADE_T = 0.16;       // depth of shoe and cap rail

function buildEdgeBalustrade() {
  const g = group(0, 0, 0);
  const T = BALUSTRADE_T;
  const SHOE_H = 0.14;
  const CAP_H = 0.07;
  // Bedded a little into the floor rather than resting on its face, so the shoe's
  // underside and the floor's top surface do not share a plane.
  const shoeBottom = FLOOR_TOP - 0.03;
  const capTop = DESK_TOP_Y;

  const run = (cx, cz, w, d) => {
    put(g, box(w, SHOE_H + 0.03, d, 0x8b9299, { rough: 0.45, metal: 0.55, cast: false }), cx, shoeBottom + (SHOE_H + 0.03) / 2, cz);

    put(g, box(w, CAP_H, d, 0x9aa2a9, { rough: 0.4, metal: 0.6, cast: false }), cx, capTop - CAP_H / 2, cz);

    // The pane runs behind both, overlapping each a little, so no edge of the glass
    // lands on the plane of the metal that holds it.
    const paneBottom = shoeBottom + SHOE_H - 0.02;
    const paneTop = capTop - CAP_H + 0.02;
    const pane = new THREE.Mesh(
      new THREE.BoxGeometry(w, paneTop - paneBottom, d * 0.3),
      new THREE.MeshStandardMaterial({
        color: COLORS.glass, transparent: true, opacity: 0.18,
        roughness: 0.08, metalness: 0.0,
      })
    );
    pane.position.set(cx, (paneBottom + paneTop) / 2, cz);
    g.add(pane);
  };

  // The +x edge owns the corner; the +z edge stops where it begins, so the two runs
  // abut instead of overlapping in a square.
  const xEdge = ROOM.W - T / 2;
  const zEdge = ROOM.D - T / 2;
  const zFrom = ROOM.wallT / 2;
  const xFrom = ROOM.wallT / 2;
  run(xEdge, (zFrom + ROOM.D) / 2, T, ROOM.D - zFrom);
  run((xFrom + ROOM.W - T) / 2, zEdge, ROOM.W - T - xFrom, T);

  return g;
}

// --- Stone balcony with planters ---------------------------------------------
// A cantilevered ledge continuing the floor line past the two open edges: a
// stone slab, a wrought-iron rail at its outer lip, and troughs of the season's
// planting along it. Unwalkable by construction — it is never wired into the
// agent layer's floor or desk graph, so nothing paths onto it; it is scenery
// seen past the rail, the way the tower's glass is scenery you see through.
const BALCONY_LEDGE_D = 0.85;
const BALCONY_RAIL_H = 0.95;

function buildEdgeBalcony(season = 'autumn') {
  const g = group(0, 0, 0);
  const stone = COLORS.baseCourse;
  const iron = COLORS.metalDark ?? COLORS.frame;
  const T = BALCONY_LEDGE_D;
  const railTopY = FLOOR_TOP + BALCONY_RAIL_H;
  const railMidY = FLOOR_TOP + BALCONY_RAIL_H / 2;

  // Every corner this balcony has to land on, worked out once so the two
  // rails and the wrap at the wall all agree about where they are — the
  // earlier version had each edge measured off its own ledge instead, and the
  // two only agreed by coincidence, which is why they didn't actually meet.
  const lipX = ROOM.W + T - 0.04;      // the x-edge's own outer line
  const lipZ = ROOM.D + T - 0.04;      // the z-edge's own outer line
  const zNear = 0;                     // x-edge's near end: buildStairwellRail meets it here
  const xWall = -ROOM.wallT / 2;       // z-edge's near end: the left wall's outer face

  // Ledges: stone, cantilevered past the room's own faces, each run a corner
  // further than its own rail so the two overlap in the corner square rather
  // than mitring edge to edge.
  const ledgeX = box(T, 0.22, lipZ - zNear + T, stone, { rough: 0.9, cast: false });
  ledgeX.position.set(ROOM.W + T / 2, FLOOR_TOP - 0.11, (zNear + lipZ) / 2);
  ledgeX.receiveShadow = true;
  g.add(ledgeX);
  const ledgeZ = box(lipX - xWall + T, 0.22, T, stone, { rough: 0.9, cast: false });
  ledgeZ.position.set((xWall + lipX) / 2, FLOOR_TOP - 0.11, ROOM.D + T / 2);
  ledgeZ.receiveShadow = true;
  g.add(ledgeZ);

  // X-edge rail: fixed x = lipX, z from zNear up to lipZ.
  put(g, box(0.06, 0.06, lipZ - zNear, iron, { rough: 0.5, metal: 0.55, cast: false }), lipX, railTopY, (zNear + lipZ) / 2);
  const balustersX = Math.max(3, Math.round((lipZ - zNear) / 0.55));
  for (let i = 0; i <= balustersX; i++) {
    put(g, box(0.05, BALCONY_RAIL_H, 0.05, iron, { rough: 0.5, metal: 0.55, cast: false }), lipX, railMidY, zNear + (i / balustersX) * (lipZ - zNear));
  }

  // Z-edge rail: fixed z = lipZ, x from the wall's own face up to lipX — the
  // two shared corners, so both rails terminate on the same point instead of
  // stopping a hand's width short of each other.
  put(g, box(lipX - xWall, 0.06, 0.06, iron, { rough: 0.5, metal: 0.55, cast: false }), (xWall + lipX) / 2, railTopY, lipZ);
  const balustersZ = Math.max(3, Math.round((lipX - xWall) / 0.55));
  for (let i = 0; i <= balustersZ; i++) {
    put(g, box(0.05, BALCONY_RAIL_H, 0.05, iron, { rough: 0.5, metal: 0.55, cast: false }), xWall + (i / balustersZ) * (lipX - xWall), railMidY, lipZ);
  }

  // A post at the shared corner, thick enough that the right-angle join
  // between the two rails reads as one fitting rather than a butt joint.
  put(g, box(0.1, BALCONY_RAIL_H, 0.1, iron, { rough: 0.45, metal: 0.6, cast: false }), lipX, railMidY, lipZ);

  // The wrap at the wall: the z-edge doesn't just stop at xWall, it turns
  // ninety degrees and runs a short return along the wall's own face — the
  // rail meeting the masonry square-on rather than butting into it end-on.
  const wrapLen = 1.1;
  put(g, box(0.06, 0.06, wrapLen, iron, { rough: 0.5, metal: 0.55, cast: false }), xWall, railTopY, lipZ - wrapLen / 2);
  const wrapBalusters = Math.max(2, Math.round(wrapLen / 0.55));
  for (let i = 0; i <= wrapBalusters; i++) {
    put(g, box(0.05, BALCONY_RAIL_H, 0.05, iron, { rough: 0.5, metal: 0.55, cast: false }), xWall, railMidY, lipZ - (i / wrapBalusters) * wrapLen);
  }
  put(g, box(0.1, BALCONY_RAIL_H, 0.1, iron, { rough: 0.45, metal: 0.6, cast: false }), xWall, railMidY, lipZ);
  // A short stub of ledge under the wrap, so the return rail has something to
  // stand on rather than floating past the z-edge ledge's own end.
  //
  // It fills only the corner nothing else covers: inboard of the z-edge ledge
  // in z, and outboard of the room in x. Sized off its own neighbours, it used
  // to reach 0.85 back into the room and 0.81 into the z-edge ledge, and stone
  // and floorboards both put their top face on y = FLOOR_TOP — so the corner
  // flickered where the boards, the ledge and the planting meet, which is the
  // one bug docs/developer/coplanar-probe.md is for.
  const stubX0 = xWall - T / 2;      // the z-edge ledge's own near-x end
  const stubX1 = 0;                  // the room's edge: the floorboards start here
  const stubZ0 = lipZ - wrapLen;     // the wrap rail's inboard end
  const stubZ1 = ROOM.D;             // where the z-edge ledge already takes over
  put(g, box(stubX1 - stubX0, 0.22, stubZ1 - stubZ0, stone, { rough: 0.9, cast: false }), (stubX0 + stubX1) / 2, FLOOR_TOP - 0.11, (stubZ0 + stubZ1) / 2);

  // Planters along each ledge, set toward the room side so they clear the rail
  // rather than standing in front of it.
  const potEvery = 3.6;
  const potX = ROOM.W + T / 2 + 0.08;
  const potsAlongX = Math.max(1, Math.floor(ROOM.D / potEvery));
  for (let i = 0; i < potsAlongX; i++) {
    const width = Math.min(1.9, ROOM.D / potsAlongX - 0.5);
    const trough = buildWindowTrough({ width, season });
    trough.rotation.y = Math.PI / 2;
    trough.position.set(potX, FLOOR_TOP - 0.02, ((i + 0.5) / potsAlongX) * ROOM.D);
    g.add(trough);
  }
  const potZ = ROOM.D + T / 2 + 0.08;
  const potsAlongZ = Math.max(1, Math.floor(ROOM.W / potEvery));
  for (let i = 0; i < potsAlongZ; i++) {
    const width = Math.min(1.9, ROOM.W / potsAlongZ - 0.5);
    put(g, buildWindowTrough({ width, season }), ((i + 0.5) / potsAlongZ) * ROOM.W, FLOOR_TOP - 0.02, potZ);
  }

  return g;
}

// --- External staircase ------------------------------------------------------
// Where the treads are is worked out in scene/approach.js, because the courier and
// the agent layer walk this flight and all three have to agree about it. This is
// only the carpentry.

function buildStaircase({ groundY, steps, riser, run, xTop, pitch }, style) {
  const g = group(0, 0, 0);
  // Timber by default, as a warehouse fire-stair actually is. A caller with a
  // different material for this flight (the mansard's stone-and-iron one) says
  // so explicitly rather than this guessing from context it doesn't have.
  const treadC = style?.tread ?? COLORS.woodMid;
  const postC = style?.post ?? COLORS.woodDark;
  const railC = style?.rail ?? COLORS.woodDark;
  const capRailC = style?.rail ?? 0xb08a5a;
  const balusterC = style?.baluster ?? 0xb08a5a;

  // Treads. Tread i sits one riser lower than the one before it; the box bottom
  // is the underside of that step, so the last one lands exactly on the pavement.
  for (let i = 0; i < steps; i++) {
    const bottom = -riser * (i + 1);
    const x = xTop + (i + 0.5) * STAIR_TREAD;

    const step = box(STAIR_TREAD * 1.02, riser, STAIR_WIDTH, treadC,
      { rough: 0.9, cast: false });
    step.position.set(x, bottom + riser / 2, STAIR_Z);
    step.receiveShadow = true;
    g.add(step);

    // Props down to the pavement every few treads, so the flight is carried.
    if (i % STAIR_POST_EVERY === 0 && i > 0) {
      const h = bottom - groundY;
      put(g, box(0.18, h, 0.18, postC, { rough: 0.9, cast: false }), x, groundY + h / 2, STAIR_Z - STAIR_WIDTH / 2 + 0.14);
    }
  }

  // Raking stringer under the outer edge, and the handrail above it. Both are one
  // box rotated by the pitch: the flight descends as x increases, so the rotation
  // about z is negative.
  const midX = xTop + run / 2;
  const midY = -riser * steps / 2;
  const sloped = (h, y, z, colour) => {
    const beam = box(Math.hypot(run, riser * steps), h, 0.16, colour,
      { rough: 0.85, cast: false });
    beam.position.set(midX, y, z);
    beam.rotation.z = -pitch;
    g.add(beam);
    return beam;
  };

  // The tread *tops* run half a riser above the pitch line through the midpoint,
  // so the rail is measured from there — otherwise the balusters overshoot it.
  const noseY = midY + riser / 2;
  sloped(0.34, noseY - 0.42, STAIR_Z - STAIR_WIDTH / 2 + 0.08, railC);
  sloped(0.12, noseY + STAIR_RAIL_H, STAIR_Z - STAIR_WIDTH / 2 + 0.08, capRailC);

  // Balusters from tread to handrail.
  for (let i = 0; i < steps; i += STAIR_POST_EVERY) {
    const top = -riser * i;
    const baluster = box(0.1, STAIR_RAIL_H, 0.1, balusterC, { rough: 0.8, cast: false });
    baluster.position.set(xTop + (i + 0.5) * STAIR_TREAD, top + STAIR_RAIL_H / 2,
                          STAIR_Z - STAIR_WIDTH / 2 + 0.08);
    g.add(baluster);
  }

  // A pad at the foot, so the bottom tread meets something built rather than grass.
  const pad = box(STAIR_TREAD * 3, 0.2, STAIR_WIDTH + 0.4, COLORS.baseCourse,
    { rough: 0.95, cast: false });
  pad.position.set(xTop + run + STAIR_TREAD, groundY + 0.1, STAIR_Z);
  pad.receiveShadow = true;
  g.add(pad);

  return g;
}

// The stoop keeps the ground at floor height right outside the door, so agents
// enter and exit on one flat plane. When isInterior is true (storeys below), omit
// the descending steps and show an interior-looking landing. Otherwise, steps drop
// to the sidewalk.
function buildStoop(isInterior = false) {
  const g = group(0, 0, 0);
  const w = DOOR.width + 2.6;
  const d = DOOR.stoopDepth;

  // Landing, top flush with the interior floor.
  const landing = box(w, 1.4, d, isInterior ? COLORS.facadeLower : COLORS.baseboard, {
    rough: 0.95,
    cast: false,
  });
  landing.position.set(DOOR.x, FLOOR_TOP - 0.7, -d / 2);
  landing.receiveShadow = true;
  g.add(landing);

  // Trim edge.
  put(g, box(w + 0.3, 0.28, d + 0.3, COLORS.woodMid, { rough: 0.9, cast: false }), DOOR.x, -0.62, -d / 2);

  // Steps only make sense at ground level. On an upper floor the door opens onto
  // an internal landing, so the landing slab is all there is.
  if (!isInterior) {
    for (const s of stoopSteps()) {
      const step = box(s.width, 0.42, 0.7, COLORS.sidewalk, { rough: 1.0, cast: false });
      step.position.set(DOOR.x, s.y, s.z);
      step.receiveShadow = true;
      g.add(step);
    }
  }

  // A doormat on the landing.
  put(g, box(1.8, 0.06, 1.0, 0x6b5a44, { rough: 1.0, cast: false }), DOOR.x, 0.13, -0.9);

  return g;
}
