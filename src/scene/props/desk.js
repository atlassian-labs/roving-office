import * as THREE from 'three';
import { COLORS } from '../../config.js';
import { pick, spread, whole } from '../../dice.js';
import { box, cyl, group, put } from '../build.js';
import { CAMERA } from '../../config.js';
import { buildDeskPlant } from '../plants.js';
import { makeKanbanBoard } from '../kanban.js';
import { RISE, addSitStandFrame, sitStandMotor } from './sit-stand.js';
import { buildDeskMarker } from './desk-marker.js';

const SEAT_LOCAL_Z = 1.6;     // occupant offset from desk centre, in desk space
export const SEAT_HEIGHT = 0.68;  // top of the Aeron seat pan
export const DESK_TOP_Y = 1.58;  // working surface: the 1.5 frame plus half its 0.16 top
// The board itself. Named now rather than written into four places, because a sit-stand
// desk has to build a frame that fits the top it is carrying, and a frame sized off a
// literal is a frame that silently stops fitting the day the desk changes size.
const DESK_W = 4.4;
const DESK_D = 2.2;
const TOP_T = 0.16;
const LEG_X = 1.9;            // legs, and the lifting columns that replace them
// How far somebody shoves their chair to get it out of the way, and how long the shove
// takes. Far enough that it is not in the shins of whoever is standing at the desk —
// the seat and the mat are the same patch of floor — and no further. It was 2.75 first,
// which cleared the end of the top altogether and read as the chair being sent away:
// a chair parked at arm's length beside its owner is somebody who pushed it aside, and
// one standing off the end of the desk is somebody who did not want it in the room.
// Negative, which is to say the occupant's left and the camera's near side. Either side
// clears the mat equally, and the choice is the viewer's rather than the agent's: pushed
// the other way the chair went behind the desk from where the camera stands, and a chair
// you cannot see has not visibly moved.
const CHAIR_ASIDE_X = -1.25;
const CHAIR_PUSH = 0.45;      // seconds: a shove, not a journey
const DESK_PLANT_X = 1.7;     // where a desk plant stands, from the desk centre
const DESK_PLANT_Z = 0.7;
const KEYS_W = 1.5;
const MONITOR_Z = -0.35;
const KEYS_Z = 0.62;          // keyboard and mouse, under the occupant's hands

/**
 * Which corner of a desk top its plant stands on: the one nearest the viewer.
 *
 * The camera looks into the room from a single corner, so half the desks have the
 * backs of their monitors towards it — and on those a plant sat on the occupant's
 * side of the desk is behind a screen and never seen. Taken from the camera's own
 * heading rather than alternated by index, which is what left the two desks in the
 * middle of the room with their plants hidden.
 *
 * @param {number} facing  the desk's rotation, as in DESKS
 * @returns {{x: number, z: number}} offset in desk-local space
 */
function deskPlantCorner(facing) {
  const camX = CAMERA.position[0] - CAMERA.target[0];
  const camZ = CAMERA.position[2] - CAMERA.target[2];
  const s = Math.sin(facing), c = Math.cos(facing);
  // The desk's local +z and +x axes, projected onto the direction of the viewer.
  const frontToCamera = s * camX + c * camZ > 0;
  let xSide = c * camX - s * camZ > 0 ? 1 : -1;
  // The mug lives on the front-left of the top; if that is the corner nearest the
  // camera, take the other end of the desk rather than stacking the two.
  if (frontToCamera && xSide < 0) xSide = 1;
  return { x: xSide * DESK_PLANT_X, z: frontToCamera ? DESK_PLANT_Z : -DESK_PLANT_Z };
}

// An ordinary monitor: bezel, then the glass inside it.
const MON_BEZEL_W = 1.7;
const MON_GLASS_W = 1.5;
// The ultrawide on a sit-stand desk is half again as wide, and one instead of two — which
// makes it narrower overall than the pair it replaces, since two 1.7 bezels at ±1.05 spanned
// 3.8 and this spans 2.55.
const WIDE = 1.5;
// How far the bezel sits behind the glass. Built on the same axis as the glass rather than
// at the same centre, so the gap is even across the whole curve instead of pinching to
// nothing in the middle, which would be a coplanar pair in the one place you look most.
const BEZEL_BEHIND = 0.05;

// Curved monitors are sold by radius: "1800R" is the 1.8 m circle the panel would close if
// you carried it on round, and the smaller the number the deeper the curve — 1500R and
// 1000R are the more aggressive ones. 1800R is the ordinary curve on a 34" ultrawide, whose
// glass is about 800 mm across, so the panel subtends 800/1800 of a radian: a little over
// 25°.
//
// The angle is what carries into a room where nothing is in millimetres and a desk is 4.4
// units wide, so the angle is what is kept and the radius is worked back out from whatever
// the panel measures here. Deepening the curve is one number: 1500 gives about 31°.
const CURVE_RADIUS_MM = 1800;
const ULTRAWIDE_MM = 800;
const SCREEN_ARC = ULTRAWIDE_MM / CURVE_RADIUS_MM;

/**
 * A slice of a cylinder wall, curving away from the viewer at its edges: a curved screen,
 * or the bezel behind one.
 *
 * Every piece of one monitor is built on a common axis — passed as `axisR`, the glass's own
 * radius — so a bezel at a larger radius sits evenly behind the glass rather than crossing
 * it. The wall is then brought to the local origin, leaving that axis at +z, which is the
 * occupant's side: the panel is concave towards them, as a curved monitor is.
 *
 * @param {object}  o
 * @param {number}  o.radius     this piece's radius
 * @param {number}  o.arc        the whole panel's arc in radians
 * @param {number}  o.height     its height
 * @param {THREE.Material} o.mat
 * @param {number} [o.from]      where this piece starts across the panel, 0..1
 * @param {number} [o.to]        and where it ends — halves make two windows on one screen
 * @param {number} [o.axisR]     the axis to build on, defaulting to this piece's own
 */
function curvedPanel({ radius, arc, height, mat, from = 0, to = 1, axisR = null, segments = 24 }) {
  const start = Math.PI - arc / 2 + from * arc;
  const geo = new THREE.CylinderGeometry(
    radius, radius, height, Math.max(2, Math.round(segments * (to - from))), 1, true,
    start, (to - from) * arc
  );
  // Seen from the concave side the wall runs the other way as the angle grows, so the image
  // would read mirrored against a flat screen's. Flipped on the geometry, never on the
  // texture: the editor screen is one texture shared by every desk in the room.
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  geo.translate(0, 0, axisR ?? radius);
  return new THREE.Mesh(geo, mat);
}

// Monitors are off — genuinely black — until somebody sits down at the desk.
// `ON` is pushed well past 1 so the code visibly glows once tone mapping has had
// its way with it.
const SCREEN_OFF = 0;
const SCREEN_ON = 2.40;

// A shared "code on screen" texture: coloured line fragments on a dark editor
// background. Used as both the colour map and the emissive map so the code
// itself glows.
let _codeTexture = null;
export function codeScreenTexture() {
  if (_codeTexture) return _codeTexture;

  const W = 256, H = 152;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0e1b2b';
  ctx.fillRect(0, 0, W, H);

  // Gutter.
  ctx.fillStyle = '#152438';
  ctx.fillRect(0, 0, 16, H);

  const palette = ['#6fb1e0', '#7bc47f', '#e0b24f', '#b489e0', '#d8dee9', '#4fb0b0'];
  let y = 10;
  for (let row = 0; row < 13; row++) {
    let x = 22 + (row % 4) * 11;              // fake indentation
    const segments = whole(2, 4);
    for (let s = 0; s < segments; s++) {
      const w = spread(16, 52);
      if (x + w > W - 10) break;
      ctx.fillStyle = pick(palette);
      ctx.fillRect(x, y, w, 5);
      x += w + 7;
    }
    // Line number tick in the gutter.
    ctx.fillStyle = '#33465c';
    ctx.fillRect(5, y + 1, 7, 3);
    y += 11;
  }

  // Cursor.
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(22, y, 2, 8);

  _codeTexture = new THREE.CanvasTexture(canvas);
  _codeTexture.colorSpace = THREE.SRGBColorSpace;
  _codeTexture.__shared = true;
  return _codeTexture;
}

// ---------------------------------------------------------------------------
/**
 * Workstation: desk, dual monitors that light up, and an Aeron chair.
 *
 * Exported for reception's vignette (scene/vignette.js), which builds one desk on
 * its own square of floor. The signature is the whole reason it can: a desk is
 * described by a spec — `{ id, x, z, facing }` — and knows nothing about the room
 * it stands in.
 *
 * @param {{id: string, x: number, z: number, facing: number}} spec
 * @param {number} [index]  which desk this is, used only to vary its plant
 */
export function buildDesk(spec, index = 0) {
  const g = group(spec.x, 0, spec.z);
  g.rotation.y = spec.facing;

  // The working surface and everything standing on it.
  //
  // A desk is mostly a horizontal plane with things arranged on it, and until sit-stand
  // desks existed that plane could not move, so its height was baked into every one of
  // them: the top at 1.5, monitors at 1.58, keys at 1.6. This group is that plane made
  // liftable. For an ordinary desk it sits at zero and never moves, so those numbers
  // still mean exactly what they always did — but a raising desk takes its monitors, its
  // keyboard, its mug and its plant up with it, in register, from one write to one `y`.
  //
  // What is *not* in here is as deliberate: the legs or the frame's feet, and the chair.
  // Those belong to the floor.
  const surface = group(0, 0, 0);
  g.add(surface);

  put(surface, box(DESK_W, TOP_T, DESK_D, 'woodMid', { rough: 0.6 }), 0, DESK_TOP_Y - TOP_T / 2);

  // Four legs, or a frame that travels. The columns stand exactly where the legs they
  // replace did, so a standing desk lines up with the row on the floor as well as at the
  // top: at rest it is the same desk, and that is the point of measuring it that way.
  if (spec.standing) {
    addSitStandFrame({
      g, surface, topY: DESK_TOP_Y, topT: TOP_T, columnX: LEG_X, deskD: DESK_D,
      standZ: SEAT_LOCAL_Z,
    });
  } else {
    for (const sx of [-LEG_X, LEG_X]) {
      for (const sz of [-0.9, 0.9]) {
        put(g, box(0.16, 1.5, 0.16, 'metalDark', { rough: 0.5, metal: 0.4 }), sx, 0.75, sz);
      }
    }
  }

  // Monitors, screens facing the occupant (+z in desk space). Two on an ordinary desk: one
  // runs the editor and the other the team's board, the pair having once shown the same code
  // texture twice, which read as one screen rather than a workstation.
  //
  // A sit-stand desk has *one*, half again as wide and curved — which is what the people who
  // buy sit-stand desks buy, and it earns its place here for a reason the room can see. At
  // standing height the top is 0.34 higher, and two monitors at that height are two flat
  // planes angled at nothing in particular; one curved panel turns to face its occupant
  // wherever they are, which is the whole argument for the things.
  const screenMats = [];
  const screenGlows = [];
  // The board animates, so it is one per desk; the editor is a single texture shared by the
  // whole room. Both are made whatever the monitor count, because a one-screen desk still
  // shows both — side by side on the one panel, which is what an ultrawide is for.
  const kanban = makeKanbanBoard();
  const screenTextures = [codeScreenTexture(), kanban.texture];

  /**
   * Whichever texture a screen runs doubles as its emissive map so the content glows; only
   * the intensity changes between idle and working.
   */
  const screenMaterial = (tex) => new THREE.MeshStandardMaterial({
    map: tex,
    // Starts black: `color` multiplies the map, so 0x000000 hides the code
    // entirely rather than leaving a dimly-lit screenshot on a dead monitor.
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: SCREEN_OFF,
    roughness: 0.3,
    metalness: 0.0,
    // A plane is single-sided by default; the desk can be rotated to any
    // heading, so render both faces rather than risk a culled (black) screen.
    side: THREE.DoubleSide,
  });

  /**
   * A soft bloom just in front of the glass, so a working screen throws visible light instead
   * of only being brighter in its own pixels. Additive and untextured, which is why a curved
   * one can be the same cylinder wall as the screen with no mapping to go wrong.
   */
  const glowMaterial = () => new THREE.MeshBasicMaterial({
    color: 0x7fb6e8,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const flatGlow = (w, h, z) => {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMaterial());
    glow.position.set(0, 1.0, z);
    return glow;
  };

  /** The stand and foot every monitor stands on, the foot widening with the panel. */
  const monitorBase = (mx, widthScale) => {
    const monitor = group(mx, DESK_TOP_Y, MONITOR_Z);
    const stand = box(0.12, 0.5, 0.12, 'metalDark', { metal: 0.5, rough: 0.4 });
    stand.position.y = 0.25; monitor.add(stand);
    const foot = box(0.5 * widthScale, 0.06, 0.4, 'metalDark', { metal: 0.5, rough: 0.4 });
    foot.position.y = 0.03; monitor.add(foot);
    return monitor;
  };

  if (spec.standing) {
    const glassW = MON_GLASS_W * WIDE;
    // The radius that gives a panel this wide the 25° of a 1800R ultrawide.
    const radius = glassW / SCREEN_ARC;
    const monitor = monitorBase(0, WIDE);

    // The bezel: a wall behind the glass, a touch taller and wider than it, on the glass's
    // own axis so the gap between them never closes.
    const bezel = curvedPanel({
      radius: radius + BEZEL_BEHIND,
      arc: SCREEN_ARC * 1.06,
      height: 1.0,
      mat: new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.4, side: THREE.DoubleSide }),
      axisR: radius,
    });
    bezel.position.y = 1.0;
    monitor.add(bezel);

    // Two windows open on the one panel, each taking half the curve: the editor and the
    // board, the same two images an ordinary desk shows on two separate screens.
    for (const [i, tex] of screenTextures.entries()) {
      const mat = screenMaterial(tex);
      const win = curvedPanel({
        radius, arc: SCREEN_ARC, height: 0.85, mat, from: i / 2, to: (i + 1) / 2,
      });
      win.position.y = 1.0;
      monitor.add(win);
      screenMats.push(mat);
    }

    // The bloom follows the glass, on the same axis a hair in front of it. A flat card was
    // the obvious thing and looked wrong: it had to stand clear of the deepest part of the
    // curve, so at the ends of the panel it hung out in front of nothing, a pale rectangle
    // with hard edges reading as a sheet of perspex rather than as light.
    const glow = curvedPanel({
      radius: radius - 0.06, arc: SCREEN_ARC * 1.2, height: 1.2, mat: glowMaterial(),
      axisR: radius,
    });
    glow.position.y = 1.0;
    monitor.add(glow);
    screenGlows.push(glow);
    surface.add(monitor);
  } else {
    for (const [side, mx] of [-1.05, 1.05].entries()) {
      const monitor = monitorBase(mx, 1);
      const bezel = box(MON_BEZEL_W, 1.0, 0.08, 0x15181c, { rough: 0.4 });
      bezel.position.y = 1.0; monitor.add(bezel);

      const mat = screenMaterial(screenTextures[side]);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(MON_GLASS_W, 0.85), mat);
      // PlaneGeometry already faces +z, which is the occupant's side of the desk —
      // no rotation needed. (Rotating it here pointed the lit face into the bezel.)
      screen.position.set(0, 1.0, 0.05);
      monitor.add(screen);
      screenMats.push(mat);

      const glow = flatGlow(1.9, 1.2, 0.12);
      monitor.add(glow);
      screenGlows.push(glow);

      surface.add(monitor);
    }
  }

  // Keyboard + mouse, at KEYS_Z: near enough the front edge of the top that the
  // occupant's hands land on them. An agent's arm is one length with no elbow (see
  // TYPE_REACH in agents/Agent.js), so how far forward it can reach is not negotiable
  // — the keyboard is the thing that has to move, and it is where a keyboard belongs
  // anyway rather than out in the middle of the desk.
  const kb = box(KEYS_W, 0.06, 0.5, 0x22262b, { rough: 0.6 });
  kb.position.set(0, 1.6, KEYS_Z); surface.add(kb);
  const mouse = box(0.22, 0.08, 0.32, 0x22262b, { rough: 0.6 });
  mouse.position.set(1.0, 1.61, KEYS_Z); surface.add(mouse);

  // The mug is hidden until its occupant actually fetches a drink, so a mug on a
  // desk means someone went and got one rather than being permanent set dressing.
  // Tucked into the front-left corner, clear of the nameplate beside the keyboard.
  const mug = group(-1.85, 1.6, 0.87);
  mug.name = 'desk-mug';
  put(mug, cyl(0.13, 0.11, 0.24, COLORS.paper, { segments: 10 }), 0, 0.12);
  // What's in it. Own material instance, because the shared cache would tint
  // every desk's mug at once.
  const brew = cyl(0.105, 0.105, 0.02, 0x3a2418, { segments: 10, cast: false });
  brew.material = brew.material.clone();
  brew.position.y = 0.235;
  mug.add(brew);
  mug.visible = false;
  surface.add(mug);

  // One plant per desk, on the corner of the top nearest the viewer (see
  // deskPlantCorner) and turned a different way on each desk so the row doesn't
  // look stamped out. The corners are clear of the monitors, the keyboard and the
  // mug, and the plant is off to the side of the screens rather than in front of
  // them, so it never stands between an agent and the work.
  const plant = buildDeskPlant(index);
  const corner = deskPlantCorner(spec.facing);
  plant.position.set(corner.x, DESK_TOP_Y, corner.z);
  plant.rotation.y = index * 1.3;
  surface.add(plant);

  // Midway across the gap left of the keyboard, and midway from the front edge
  // to the monitor row. Both desk types use these same reference dimensions.
  const assignmentMarker = buildDeskMarker({
    topY: DESK_TOP_Y,
    x: (-DESK_W / 2 - KEYS_W / 2) / 2,
    z: (DESK_D / 2 + MONITOR_Z) / 2,
  });
  surface.add(assignmentMarker.root);

  // Aeron chair at the seat, turned to face the desk. It stands on the seat point
  // itself, so it turns about its own post — which is how it gets out of the way of
  // somebody sitting down (see `setChairFacing`).
  const chair = buildAeronChair();
  chair.position.set(0, 0, SEAT_LOCAL_Z);
  chair.rotation.y = Math.PI;   // faces -z in desk space == toward the monitors
  g.add(chair);

  // World-space anchors for the agent layer. Where somebody sits, and where they
  // stand before they do — both of them a fixed offset out along the desk's own axis,
  // lifted into the world. `relocate()` below is this same sum done again, which is
  // why the two are written as one function rather than inline here.
  const anchor = (dz) => {
    const p = new THREE.Vector3(0, 0, dz).applyEuler(g.rotation).add(g.position);
    return new THREE.Vector3(p.x, 0, p.z);
  };
  const APPROACH_LOCAL_Z = SEAT_LOCAL_Z + 1.9;

  // Which way the desk was pointing when it was last placed, so `relocate()` can tell
  // how far it has just been turned and swing the chair by the same amount.
  let placedFacing = spec.facing;

  // Height, for a sit-stand desk. The motor owns where the surface is and how it eases
  // there; this owns what moves with it, which is the top and everything standing on it.
  //
  // What is *not* in here is the chair. It used to be — `chair.position.x` was a
  // multiple of the height, so the two were one movement — and that is exactly the bug
  // it looked like: an empty desk changing height dragged its chair across the floor
  // with nobody touching it. A chair is moved by the person who wants it out of the way,
  // so it is driven from the agent layer and animates on its own clock below.
  const motor = spec.standing ? sitStandMotor(1) : null;
  let raised = spec.standing ? 1 : 0;
  const applyHeight = (f) => {
    raised = f;
    surface.position.y = RISE * f;
  };
  applyHeight(raised);

  // Where the chair is between its two places, 0 tucked in .. 1 shoved aside, and where
  // it has been asked to be. Nobody has pushed it yet, so it starts where it was left:
  // tucked in under the desk, raised or not.
  let aside = 0;
  let asideTarget = 0;

  // Turns until this desk next changes height. A sit-stand desk that flipped on every
  // job would be a novelty item — nobody stands for one job, sits for the next and
  // stands again. Three to five posts is long enough to read as a decision somebody
  // made about their morning, and short enough to see twice in a sitting.
  const POSTS_MIN = 3;
  const POSTS_MAX = 5;
  const nextRun = () => whole(POSTS_MIN, POSTS_MAX);
  // It starts raised, so the first few posts are worked standing.
  let standingRun = true;
  let postsLeft = nextRun();

  const handle = {
    id: spec.id,
    kind: 'desk',
    // Whether this desk stands on a sit-stand frame. Not a different kind of desk — the
    // agent layer reads it to know whether working standing up is even on offer here.
    standing: !!spec.standing,
    seat: anchor(SEAT_LOCAL_Z),
    approach: anchor(APPROACH_LOCAL_Z),
    // The occupant looks at the monitors, i.e. opposite the desk's own facing.
    sitRotation: spec.facing + Math.PI,
    // Which way the chair's seat is pointing, in world terms — the same heading its
    // occupant would be facing. Square to the monitors when nobody is using it.
    chairFacing: spec.facing + Math.PI,
    /**
     * The desk has been moved or turned: work its world anchors out again.
     *
     * A desk is the prop with the most baked into it — a seat, the standing room in
     * front of that seat, the heading an occupant faces, and a plant on whichever
     * corner is nearest the camera — and every one of those is measured from where the
     * desk is. None of it can be left to a world rebuild, because the room goes on
     * running while the furniture is dragged (see src/editor.js).
     *
     * The chair is turned by however far the desk was, rather than being squared back
     * up to the monitors. Both halves of that matter, and only because somebody may be
     * sitting in it: a desk merely slid across the floor must not spin the seat under
     * its occupant, and a desk swung round to face the window must take them with it.
     */
    relocate() {
      const spin = spec.facing - placedFacing;
      placedFacing = spec.facing;

      g.position.set(spec.x, 0, spec.z);
      g.rotation.y = spec.facing;
      this.seat.copy(anchor(SEAT_LOCAL_Z));
      this.approach.copy(anchor(APPROACH_LOCAL_Z));
      this.sitRotation = spec.facing + Math.PI;
      this.setChairFacing(this.chairFacing + spin);
      // The plant sits on whichever corner of the top is nearest the camera, which is
      // a question about the desk's heading — so a turned desk moves its plant.
      const c = deskPlantCorner(spec.facing);
      plant.position.set(c.x, DESK_TOP_Y, c.z);
    },
    screenMats,
    screenGlows,
    working: false,
    // Whether the occupant's drink is sitting on the desk. Mirrors `working`:
    // handle state the agent layer can read back rather than having to remember.
    mug: false,
    occupiedBy: null,
    assignmentMarker,
    setAssignment(agent) { assignmentMarker.setAssignment(agent); },
    /**
     * Wake or sleep both monitors. Called the moment an agent sits down at the
     * desk and again when they get up, so an empty desk always reads as two
     * black panels.
     */
    setWorking(on) {
      this.working = !!on;
      for (const m of screenMats) {
        m.emissiveIntensity = on ? SCREEN_ON : SCREEN_OFF;
        m.color.setHex(on ? 0xffffff : 0x000000);
      }
      for (const glowCard of screenGlows) {
        glowCard.material.opacity = on ? 0.16 : 0;
      }
    },
    /**
     * Advance the board on the second screen.
     *
     * A no-op while the desk is dark: the monitors are genuinely black when
     * nobody is sitting there, so there is no one to see a card move and no
     * reason to repaint the canvas.
     *
     * @param {number} dt  seconds
     */
    update(dt) {
      if (this.working) kanban?.update(dt);
      // The surface only moves when it has been sent somewhere, and the chair only when
      // somebody has pushed it. Both are no-ops the rest of the time, which is most of it.
      if (motor) applyHeight(motor.step(dt));
      if (aside !== asideTarget) {
        const per = dt / CHAIR_PUSH;
        aside = Math.abs(asideTarget - aside) <= per
          ? asideTarget
          : aside + Math.sign(asideTarget - aside) * per;
        chair.position.x = CHAIR_ASIDE_X * aside;
      }
    },
    /** Where the surface is: 0 at seated height, 1 fully raised. */
    get raised() { return raised; },
    /**
     * Whether the next post at this desk is worked standing, and count it.
     *
     * Called once as somebody takes up a post, and it has a side effect on purpose: the
     * run of posts is the desk's, not the occupant's, so it survives one agent going
     * home and the next sitting down. An ordinary desk always answers no, which is what
     * lets the agent layer ask without first asking what kind of desk it is holding.
     *
     * @returns {boolean} true to work this post on your feet
     */
    takeStandingTurn() {
      if (!motor) return false;
      if (--postsLeft <= 0) {
        standingRun = !standingRun;
        postsLeft = nextRun();
      }
      return standingRun;
    },
    /** How many more posts before the height changes. Read by the tests. */
    get postsUntilChange() { return motor ? postsLeft : 0; },
    /**
     * Send a sit-stand desk to standing or seated height.
     *
     * A no-op on an ordinary desk, so the agent layer can call it without asking what it
     * is standing on. Nothing gives the desk back afterwards: it stays where the last
     * person to use it left it, which is what a real one does and what makes the height
     * a fact about the room rather than an animation playing in the corner.
     */
    setStanding(on) { motor?.driveTo(on ? 1 : 0); },
    /**
     * Push the chair aside, or pull it back in.
     *
     * The only thing that moves a chair sideways, and it is called by the agent who is
     * doing the pushing — never by the desk itself. See `standAtDesk` in
     * agents/AgentManager.js, where it happens between arriving and the desk going up.
     *
     * @param {boolean} on  true to shove it clear of the mat, false to roll it back
     */
    pushChairAside(on) {
      if (!motor) return;
      asideTarget = on ? 1 : 0;
    },
    /** Where the chair is: 0 tucked in, 1 shoved aside. */
    get chairAside() { return aside; },
    /**
     * Turn the chair to a heading, keeping `chairFacing` true.
     *
     * A chair is furniture that moves, and this is the only way it does. Nobody
     * walks through their own chair to sit down: it is swung out of the way, sat on
     * from the front, and swivelled back to the monitors, and the agent layer drives
     * all three (see the chair choreography in agents/AgentManager.js).
     *
     * @param {number} y  world heading for the seat to face
     */
    setChairFacing(y) {
      this.chairFacing = y;
      chair.rotation.y = y - spec.facing;
    },
    /**
     * Put the occupant's drink on the desk, or clear it away.
     * @param {boolean} on
     * @param {?number} color  what's in the cup (see agents/drinks.js)
     */
    setMug(on, color = null) {
      this.mug = !!on;
      mug.visible = this.mug;
      if (on && color != null) brew.material.color.setHex(color);
    },
  };
  handle.setWorking(false);
  return { obj: g, handle };
}

// A Herman Miller Aeron-style task chair: graphite frame, curved mesh back
// with a lumbar band, waterfall seat pan, armrests, 5-star caster base.
export function buildAeronChair() {
  const g = group(0, 0, 0);
  const FRAME = COLORS.aeronFrame;
  const MESH = COLORS.aeronMesh;
  const GRAPHITE = COLORS.aeronGraphite;

  // --- 5-star base with casters ---
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = box(0.62, 0.09, 0.14, GRAPHITE, { metal: 0.45, rough: 0.5 });
    arm.position.set(Math.cos(a) * 0.31, 0.12, Math.sin(a) * 0.31);
    arm.rotation.y = -a;
    g.add(arm);
    const caster = cyl(0.09, 0.09, 0.07, 0x15181c, { segments: 10 });
    caster.rotation.x = Math.PI / 2;
    caster.position.set(Math.cos(a) * 0.6, 0.08, Math.sin(a) * 0.6);
    g.add(caster);
  }

  // --- Gas cylinder ---
  put(g, cyl(0.075, 0.09, 0.42, 0x22262b, { segments: 10, metal: 0.6, rough: 0.35 }), 0, 0.36);
  put(g, box(0.34, 0.14, 0.44, GRAPHITE, { metal: 0.4, rough: 0.5 }), 0, 0.57);

  // --- Seat pan (mesh with a graphite rim and waterfall front edge) ---
  const panY = SEAT_HEIGHT - 0.06;
  put(g, box(1.02, 0.1, 0.94, MESH, { rough: 0.92 }), 0, panY, 0.02);
  const rimFront = cyl(0.07, 0.07, 1.02, GRAPHITE, { segments: 10, metal: 0.3, rough: 0.5 });
  rimFront.rotation.z = Math.PI / 2;
  rimFront.position.set(0, panY - 0.02, 0.5);
  g.add(rimFront);
  for (const sx of [-0.51, 0.51]) {
    const rimSide = cyl(0.055, 0.055, 0.94, GRAPHITE, { segments: 8, metal: 0.3, rough: 0.5 });
    rimSide.rotation.x = Math.PI / 2;
    rimSide.position.set(sx, panY, 0.02);
    g.add(rimSide);
  }

  // --- Curved mesh back ---
  // Slats laid along a shallow arc so the back wraps around the occupant.
  const arcR = 1.3;
  const halfSpan = 0.42;         // radians either side of centre
  const backBottom = 0.78;
  const backTop = 2.02;
  const backH = backTop - backBottom;
  const slats = 9;

  const arcPoint = (t) => {
    const ang = t * halfSpan;
    return {
      x: Math.sin(ang) * arcR,
      z: -Math.cos(ang) * arcR + arcR - 0.34,
      ang,
    };
  };

  for (let i = 0; i < slats; i++) {
    const t = (i / (slats - 1)) * 2 - 1;
    const p = arcPoint(t);
    const slat = box(0.13, backH * 0.95, 0.07, MESH, { rough: 0.95 });
    slat.position.set(p.x, backBottom + backH / 2, p.z);
    slat.rotation.y = -p.ang;
    g.add(slat);
  }

  // Back frame: side posts + top rail + lumbar band.
  for (const t of [-1, 1]) {
    const p = arcPoint(t);
    const post = box(0.1, backH + 0.12, 0.16, FRAME, { metal: 0.35, rough: 0.45 });
    post.position.set(p.x, backBottom + backH / 2, p.z);
    post.rotation.y = -p.ang;
    g.add(post);
  }
  // Curved rails approximated by short segments along the arc.
  for (const [y, thick] of [[backTop, 0.1], [backBottom + 0.02, 0.09], [backBottom + backH * 0.3, 0.12]]) {
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const t = (i / (segs - 1)) * 2 - 1;
      const p = arcPoint(t);
      const isLumbar = Math.abs(y - (backBottom + backH * 0.3)) < 0.01;
      const seg = box(0.34, thick, 0.1, isLumbar ? GRAPHITE : FRAME, {
        metal: 0.3, rough: 0.5, cast: false,
      });
      seg.position.set(p.x, y, p.z);
      seg.rotation.y = -p.ang;
      g.add(seg);
    }
  }

  // Back support spine linking the back to the tilt mechanism.
  const spine = box(0.16, 0.55, 0.14, FRAME, { metal: 0.4, rough: 0.45 });
  spine.position.set(0, 0.62, -0.42);
  spine.rotation.x = -0.22;
  g.add(spine);

  // --- Armrests ---
  for (const sx of [-0.62, 0.62]) {
    put(g, box(0.1, 0.42, 0.12, FRAME, { metal: 0.35, rough: 0.45 }), sx, 0.86, -0.1);
    put(g, box(0.16, 0.09, 0.62, 0x15181c, { rough: 0.7 }), sx, 1.1, 0.06);
  }

  return g;
}
