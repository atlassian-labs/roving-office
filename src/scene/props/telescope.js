import { box, cyl, group, put, sphere } from '../build.js';
import { place, placed, drop } from '../movables.js';

// ---------------------------------------------------------------------------
// Telescope: the room's second way of looking something up.
//
// The bookshelf answers for what the company knows. This answers for what it does
// not: a question whose answer is outside the building gets looked for outside the
// building, and a telescope at the window is the room saying so in one glance from
// across the floor. Which is why it is a `research` station that `serves: ['web']`
// rather than a new kind of errand — nothing about the *job* changed, only where an
// agent goes to do it. See `STATION_KINDS` in src/layout.js.
//
// Everything below is derived from three decisions, in this order, because the parts
// depend on each other and only one of them is free to be chosen by eye:
//
//   1. `EYE_Y` — the height of the eyepiece, which is the whole reason the pose
//      exists. An agent's head sits at 2.2 and its eyes with it, so an eyepiece there
//      is used standing perfectly upright, which is not how anybody has ever used a
//      telescope. This sits 0.10 under it, and `STOOP_BEND` in agents/Agent.js is
//      derived from exactly that gap — the prop's proportions and the pose are one
//      decision made in two files, so neither is free to drift.
//
//      0.10 rather than something dramatic because of which way a bend actually
//      moves a head. Pivoting at the waist swings the eye through an arc, and at these
//      proportions the arc is mostly *forward*: the bend that drops an eye 0.10 carries
//      it 0.50 in towards the eyepiece. So leaning in is the whole gesture and dropping
//      is a side effect, which is exactly what using a telescope on a tall tripod looks
//      like — you lean into it, you do not squat under it. An eyepiece set low enough
//      to need a deep fold would be a different instrument and a worse pose.
//
//   2. `TUBE_PITCH` — up and out. The window opening runs from a sill at
//      `WINDOW_SILL_Y` (2.2) to a head at `WINDOW_HEAD_Y`, so a tube aimed level would
//      be pointed at the plaster *below* the glass. This aims it over the sill and
//      keeps climbing, which is both the only line that clears the wall and the one
//      that looks like somebody watching the sky rather than the street.
//
//   3. Everything else follows. `HUB_Y` is wherever the legs have to meet to put the
//      eyepiece at `EYE_Y` once the tube is pitched, and `LEG_LEN` is however long a
//      leg has to be to reach the floor from there at `LEG_SPREAD`. Both are computed
//      below rather than written down: the eyepiece is the part that has to be in the
//      right place, and the tripod is only what holds it there.
//
// The tripod is three legs at 120°, not four at 90°, because three legs cannot rock —
// and because the splayed triangle is what says "tripod" from across a room where
// nothing is more than a few boxes anyway.

/**
 * Where an eye goes. The one number here chosen rather than derived — and the number
 * `STOOP_BEND` in agents/Agent.js is derived *from*, so it is exported for it.
 */
export const EYE_Y = 2.10;

/**
 * Up and out, above level. Clears the sill and keeps climbing.
 *
 * In degrees because it was set by eye and then corrected by eye — 35.5° read as
 * aimed at the sky rather than out of the window, and this is that less five.
 */
export const TUBE_PITCH = 30.5 * (Math.PI / 180);

/** How far back of its pivot the eyepiece sits, along the tube. */
const EYEPIECE_Z = 0.55;

/** How far above the hub the tube is slung, in the fork of the yoke. */
const YOKE_RISE = 0.31;

const LEG_SPREAD = 0.42;      // radians off vertical: enough to look planted

const TUBE_LEN = 1.90;
const TUBE_R = 0.17;

/**
 * Where the three legs meet, so that the eyepiece lands at `EYE_Y`.
 *
 * Pitching the tube swings the eyepiece *down* — it is behind the pivot, so raising
 * the far end lowers the near one — and that drop has to be given back to the hub.
 */
const HUB_Y = EYE_Y - YOKE_RISE + EYEPIECE_Z * Math.sin(TUBE_PITCH);

/** How long a leg has to be to reach the floor from the hub at that splay. */
const LEG_LEN = HUB_Y / Math.cos(LEG_SPREAD);

/** How far out a foot lands from the centre line — the tripod's own radius. */
export const FOOT_REACH = LEG_LEN * Math.sin(LEG_SPREAD);

const BRASS = 0xb8925a;
const TUBE_C = 0x2f3d4a;
const TIMBER = 0x6f5334;

/**
 * The telescope, standing on its own origin with the tube aimed out at −z.
 *
 * −z is out of the room through the back wall, which is where the windows are, and
 * it matches every other station's convention: a prop is built facing the way it
 * faces at `facing: 0`, and the layout turns it (see `place()` in scene/movables.js).
 */
export function buildTelescope() {
  const g = group(0, 0, 0);

  // --- Tripod: three legs at 120°, splayed off the hub ---
  //
  // One leg at the back under the eyepiece, two forward. That way round on purpose: the
  // forward pair brace against the direction the tube leans, and the gap between them
  // is where a stooping agent's feet go.
  //
  // Two nested groups per leg rather than two rotations on one, and this is not a
  // style choice. A Euler triple is applied in a fixed order — three.js reads 'XYZ' as
  // R = Rx·Ry·Rz, so the Y turn happens *before* the X tilt — and a leg pointing
  // straight down is unchanged by a turn about its own axis. Setting both on one group
  // therefore tilted all three legs the same way in world space and collapsed the
  // tripod into a single stick. The azimuth has to be the parent of the tilt so that
  // each leg leans out along its *own* bearing.
  for (let i = 0; i < 3; i++) {
    const around = Math.PI + (i * 2 * Math.PI) / 3;
    const bearing = group(0, HUB_Y, 0);
    bearing.rotation.y = around;

    const leg = group(0, 0, 0);
    leg.rotation.x = LEG_SPREAD;

    put(leg, cyl(0.045, 0.055, LEG_LEN, TIMBER, { rough: 0.75 }), 0, -LEG_LEN / 2);

    // A brass shoe, because the foot is where a tripod shows its quality, and it is
    // the one part of the thing at eye level for somebody sitting at a desk nearby.
    put(leg, cyl(0.055, 0.038, 0.10, BRASS, { rough: 0.35, metal: 0.7 }), 0, -LEG_LEN);

    bearing.add(leg);
    g.add(bearing);
  }

  put(g, cyl(0.11, 0.13, 0.16, BRASS, { rough: 0.4, metal: 0.6 }), 0, HUB_Y);

  // --- Yoke: the fork the tube pitches in ---
  const yoke = group(0, HUB_Y + 0.08, 0);
  for (const sx of [-0.17, 0.17]) {
    put(yoke, box(0.05, YOKE_RISE, 0.05, BRASS, { rough: 0.4, metal: 0.6 }), sx, YOKE_RISE / 2, 0);
  }
  g.add(yoke);

  // --- Tube: pitched up and out, slid back so the eyepiece overhangs the hub ---
  //
  // Its own group, pivoting where the yoke holds it, so `scan()` can move the whole
  // assembly — tube, dew shield, finder, eyepiece — as one rigid thing. A telescope
  // that scanned by sliding its tube would telescope, which is the one pun this room
  // can do without.
  //
  // Positive rotation about x lifts the −z end, which is the end pointing out of the
  // window. Getting that sign the wrong way round tips the objective into the floor
  // and stands the eyepiece above an agent's head, so `test/telescope.test.js` pins
  // the objective above the sill and the eyepiece below a standing eye.
  const pivot = group(0, HUB_Y + YOKE_RISE, 0);
  pivot.rotation.x = TUBE_PITCH;

  const tube = cyl(TUBE_R, TUBE_R, TUBE_LEN, TUBE_C, { rough: 0.45 });
  // Lying along the group's z, so pitching about x aims it up and out.
  tube.rotation.x = Math.PI / 2;
  tube.position.z = EYEPIECE_Z - TUBE_LEN / 2;
  g.add(pivot);
  pivot.add(tube);

  /** The far end of the tube, in the pivot's own coordinates. */
  const FRONT_Z = EYEPIECE_Z - TUBE_LEN;

  // The dew shield: a slightly wider ring at the far end. It is what makes one end of
  // a plain cylinder read as the front of a telescope rather than either end of a pipe.
  const shield = cyl(TUBE_R + 0.035, TUBE_R + 0.02, 0.24, TUBE_C, { rough: 0.5 });
  shield.rotation.x = Math.PI / 2;
  shield.position.z = FRONT_Z + 0.10;
  pivot.add(shield);

  // The objective, sunk just inside the shield: dark glass with a cold sheen, so it
  // catches the window light rather than reading as a hole in the end of the tube.
  const glass = cyl(TUBE_R - 0.01, TUBE_R - 0.01, 0.03, 0x1b2a38, { rough: 0.15, metal: 0.5 });
  glass.rotation.x = Math.PI / 2;
  glass.position.z = FRONT_Z + 0.20;
  pivot.add(glass);

  // Two brass bands where a real tube is clamped into its rings.
  for (const z of [-0.15, 0.30]) {
    const band = cyl(TUBE_R + 0.02, TUBE_R + 0.02, 0.07, BRASS, { rough: 0.35, metal: 0.7 });
    band.rotation.x = Math.PI / 2;
    band.position.z = z;
    pivot.add(band);
  }

  // --- Eyepiece: the part the pose is about ---
  // At the near end and canted, so it presents itself to a face stooped over it
  // rather than firing straight up the tube's axis at the ceiling behind.
  const eyepiece = group(0, 0, EYEPIECE_Z);
  const barrel = cyl(0.075, 0.09, 0.26, BRASS, { rough: 0.3, metal: 0.75 });
  barrel.rotation.x = Math.PI / 2;
  eyepiece.add(barrel);
  const cup = cyl(0.10, 0.075, 0.08, 0x1a1a1a, { rough: 0.9 });
  cup.rotation.x = Math.PI / 2;
  cup.position.z = 0.16;
  eyepiece.add(cup);
  pivot.add(eyepiece);

  // A finder scope alongside, because every telescope has one, and because it breaks
  // the tube's silhouette so the thing does not read as a length of drainpipe.
  const finder = cyl(0.045, 0.045, 0.52, BRASS, { rough: 0.35, metal: 0.65 });
  finder.rotation.x = Math.PI / 2;
  finder.position.set(0, TUBE_R + 0.09, -0.35);
  pivot.add(finder);

  // The focus knob, on the side a hand would reach for it from inside the room.
  const knob = cyl(0.06, 0.06, 0.05, BRASS, { rough: 0.3, metal: 0.75 });
  knob.rotation.z = Math.PI / 2;
  knob.position.set(TUBE_R + 0.03, 0, 0.30);
  pivot.add(knob);

  put(pivot, sphere(0.085, 0x2a2a2a, { rough: 0.5, metal: 0.3 }), 0, -TUBE_R - 0.10, 0.40);

  /** Where the pitch rests, so a sweep can always come home to it. */
  const restPitch = pivot.rotation.x;
  let scanning = 0;

  const handle = {
    id: 'telescope',
    kind: 'telescope',
    /** The pitch group, exposed for the docs gallery and for tests to read. */
    pivot,
    /** Height of the eyepiece above the floor — what an eye actually has to reach. */
    eyeY: EYE_Y,
    /**
     * Sweep the tube while somebody is looking through it.
     *
     * Somebody at an eyepiece is hunting for something, and a tube that never moves
     * says they already found it. Small on purpose: this has to read as searching and
     * not as a machine slewing, and the eyepiece has to stay under the face stooped
     * over it — a big sweep would walk it out from under them.
     *
     * @param {number} seconds  how long the sweep should last
     */
    scan(seconds = 2.8) {
      scanning = Math.max(scanning, seconds);
    },
    /** Ticked by the prop ticker. Nothing to do when nobody is looking. */
    update(dt) {
      if (scanning <= 0) {
        // Ease home, so a lookup ending mid-sweep does not snap the tube straight.
        const k = Math.min(1, dt * 4);
        pivot.rotation.x += (restPitch - pivot.rotation.x) * k;
        pivot.rotation.y += (0 - pivot.rotation.y) * k;
        return;
      }
      scanning -= dt;
      const t = performance.now() * 0.0009;
      pivot.rotation.x = restPitch + Math.sin(t) * 0.045;
      pivot.rotation.y = Math.sin(t * 0.6) * 0.075;
    },
    /** True while a sweep is running. For tests, not for the room. */
    get scanning() { return scanning > 0; },
  };

  return { obj: g, handle };
}

/**
 * Mount one telescope into the room.
 *
 * A mount for one reason only: the tube has to be swept while somebody is looking
 * through it, so every instance needs to be reachable from the frame loop, and
 * `handles.telescope` holds whichever was built last. The bookshelves keep their own
 * list for the same reason and this is deliberately the same shape — a room may have
 * two of either, and the second one being a dead prop is exactly the bug that
 * `byStation` was added to stop (see `buildStationProp` in scene/props.js).
 *
 * Registered by kind as well, because the generic path does and something asking for
 * *a* telescope should get the same answer here as anywhere else.
 */
export function mount(s, handles) {
  const { obj, handle } = buildTelescope();
  place(obj, s);
  handles.telescope = handle;
  // Explicitly, rather than leaving it to the by-kind fallback in `buildStationProp`:
  // that copies `handles[kind]`, which is whichever instance was built last, so with
  // two telescopes in the room both ids would point at the same tube and the first
  // one would never sweep. `max` is Infinity here, so that is a real room.
  handles.byStation[s.id] = handle;
  const entry = { id: s.id, scope: handle };
  handles.telescopes.push(entry);
  return placed(obj, s, 'Telescope', () => drop(handles.telescopes, entry));
}

/**
 * How high the objective ends up, and how far out in front of the tripod it reaches.
 *
 * Derived here rather than written down anywhere, and asserted in
 * `test/telescope.test.js` against the window it has to be looking through. The
 * eyepiece height and the pitch are set above for the pose and the silhouette; the
 * window is set in config.js for the wall. Nothing stops those drifting apart except
 * somebody noticing, so this is the noticing.
 *
 * @returns {{eyeY: number, objectiveY: number, reach: number, back: number}}
 *   `reach` is how far the objective overhangs the origin at −z; `back` how far the
 *   eyepiece cup overhangs it at +z. Together they are the prop's plan depth, which
 *   is what `hd` in the layout's kind table has to cover.
 */
export function telescopeMetrics() {
  const pivotY = HUB_Y + YOKE_RISE;
  const frontZ = EYEPIECE_Z - TUBE_LEN;
  const objY = pivotY + Math.sin(TUBE_PITCH) * -(frontZ + 0.20);
  return {
    eyeY: pivotY - EYEPIECE_Z * Math.sin(TUBE_PITCH),
    objectiveY: objY,
    reach: Math.abs(frontZ) * Math.cos(TUBE_PITCH),
    back: (EYEPIECE_Z + 0.20) * Math.cos(TUBE_PITCH),
  };
}
