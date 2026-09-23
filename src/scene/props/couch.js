import * as THREE from 'three';
import { COLORS, SOFA_COLORS } from '../../config.js';
import { lerp } from '../../ease.js';
import { box, group, mat, put } from '../build.js';
import { movable, drop } from '../movables.js';

/**
 * Top of the cushion — and the one number the rest of the couch is measured from.
 *
 * It is not a taste decision. An agent's leg is a 0.48 thigh over a 0.42 shin, hung
 * from a hip at 0.9, which is exactly why they stand with their feet on the floor.
 * Sit one down and the thigh goes horizontal, so the knee stays at about the height of
 * the hip and the shin hangs the rest of the way: the feet reach the floor when, and
 * only when, the seat is about a shin off it. Half a unit is that height give or take
 * the 0.06 the hips ride above the cushion — a hand's breadth of daylight under the
 * heels at the room's camera distance, where a couch drawn low enough to put them flat
 * on the floor stops reading as a couch and starts reading as a step.
 *
 * The old couch put this at 1.105 — above a standing agent's hip — so a sitter's feet
 * dangled two thirds of a metre in the air and, worse, their knees and shins were
 * inside the front panel, because from that far back no leg that short reaches the
 * front of a couch this deep. It read as somebody's legs going through the furniture,
 * which is what it was.
 *
 * `AgentManager` imports this rather than keeping its own copy: the height somebody
 * sits at and the height the cushion is drawn at are one fact, and they were two.
 */
export const COUCH_SEAT_HEIGHT = 0.5;

/** How thick the cushions are, and so where the frame under them stops. */
const CUSHION_T = 0.16;

/** The frame: off the floor by a shadow's worth, up to the underside of the cushions. */
const BASE_BOTTOM = 0.02;
const BASE_H = (COUCH_SEAT_HEIGHT - CUSHION_T) - BASE_BOTTOM;

/**
 * Front and back of the couch, and the gap between them.
 *
 * Shallower than it was, by a third. A seated agent's knee lands 0.48 in front of
 * their hip, so a couch whose front panel is further out than that from wherever the
 * cushion seats them is one no agent can hang their legs over — which was the other
 * half of the same fault, and the half that kept a sitter perched on the front edge
 * with a foot of empty cushion behind them.
 *
 * The margin is measured against the shin's *box* rather than its centre line: a shin
 * is 0.28 deep, so aiming the knee joint past the front panel still leaves a couple of
 * centimetres of leg inside it. `test/couch-sitting.test.js` builds both and checks the
 * boxes, which is how that was caught.
 */
const BACK_Z = -0.9;
const FRONT_Z = 0.24;
const DEPTH = FRONT_Z - BACK_Z;

/** Where the cushions stop, a little inside the frame's front edge. */
const CUSHION_FRONT_Z = 0.2;

/** Top of the back panel: the middle of a seated agent's back, not their shoulders. */
const BACK_TOP = 1.15;

/** Top of the arms: a hand's rest above the cushion. */
const ARM_TOP = 0.8;

// ---------------------------------------------------------------------------
/**
 * How far the seat cushions are lifted out of the body colour.
 *
 * Toward white rather than to a colour of their own, so a sofa is one sofa whatever it
 * is upholstered in. The couch used to carry a literal `0xd9926f` here — a terracotta
 * seat under a body colour the theme repaints per project — so the green velvet couch
 * in the Paris scene sat on cushions off a different sofa entirely. This reproduces
 * what that literal looked like against the default body and cannot come adrift of it.
 */
const CUSHION_LIFT = 0.12;

/** The accent for a sofa nobody has painted: the blue-grey the couch was authored with. */
const AUTO_ACCENT = 0x9fb3c8;

/** A colour moved this far toward white. */
function lighten(hex, by) {
  const lift = (shift) => {
    const c = (hex >> shift) & 0xff;
    return Math.round(lerp(c, 255, by));
  };
  return (lift(16) << 16) | (lift(8) << 8) | lift(0);
}

/**
 * The three colours a lounge seat is built from, for a given choice.
 *
 * No choice means the room's: `COLORS.couch` is part of the theme and three of the four
 * projects repaint it, so a sofa nobody has asked about goes on following its scene —
 * the same rule the rug follows. A choice overrides it and keeps overriding it.
 *
 * Exported so that a test can ask what colour the cushions came out rather than knowing
 * a literal. It knew `0xd9926f`, which is exactly the sort of thing that goes stale the
 * first time somebody repaints a sofa.
 */
export function upholstery(color) {
  const chosen = SOFA_COLORS[color];
  const body = chosen ? chosen.hex : COLORS.couch;
  return { body, cushion: lighten(body, CUSHION_LIFT), accent: chosen ? chosen.accent : AUTO_ACCENT };
}

const COUCH_SHAPE = {
  width: 4.2,
  armX: [-1.85, 1.85],
  cushions: [-1.0, 1.0],
  cushionW: 1.7,
  pillow: { x: -1.2, w: 0.8, tilt: 0.2 },
};

const ARMCHAIR_SHAPE = {
  width: 2.2,
  // A hair inside the base's outer faces: landing them exactly together would make
  // two same-facing planes contest the armchair's visible sides in the depth buffer.
  armX: [-0.84, 0.84],
  cushions: [0],
  cushionW: 1.3,
  pillow: { x: 0, w: 0.9, tilt: -0.08 },
};

/**
 * The common upholstered seat underneath the two-seat couch and one-seat armchair.
 * Their geometry differs only across the front: the depth, sitting height and route
 * into a cushion are one contract because agents use the same movement for both.
 */
function buildLoungeSeat(spec, shape) {
  const g = group(0, 0, 0);
  const paint = upholstery(spec.color);
  const c = paint.body;

  // The seat, and everything else measured from it. Sitting down used to put an
  // agent's knees and feet *inside* the front panel, which is what happens when the
  // furniture and the people are drawn to different scales: the cushion was at 1.105,
  // higher than a standing agent's hip at 0.9, so the couch was a bar stool with arms
  // and nobody's legs could reach past the front of it.
  const base = put(g, box(shape.width, BASE_H, DEPTH, c, { rough: 0.9 }), 0, BASE_BOTTOM + BASE_H / 2, BACK_Z + DEPTH / 2);
  // The three groups a repaint has to move together. Held by mesh rather than by
  // material, because the materials come out of a shared cache keyed by colour and
  // writing into one would repaint everything else in the room that is the same shade.
  const body = [base];
  const cushions = [];

  // The back stands on the base and rises to the middle of a seated agent's back.
  const backH = BACK_TOP - (COUCH_SEAT_HEIGHT - CUSHION_T);
  const back = put(g, box(shape.width, backH, 0.5, c, { rough: 0.9 }), 0, BACK_TOP - backH / 2, BACK_Z + 0.25);
  body.push(back);

  // Arms, a hand's rest above the cushion rather than shoulder-high on a sitter.
  const armH = ARM_TOP - BASE_BOTTOM;
  for (const sx of shape.armX) {
    const arm = put(g, box(0.5, armH, DEPTH, c, { rough: 0.9 }), sx, BASE_BOTTOM + armH / 2, BACK_Z + DEPTH / 2);
    body.push(arm);
  }

  // The cushions run from the back panel to just short of the front edge, so a sitter
  // is on them wherever `seatOffsets` puts them.
  const cushionD = CUSHION_FRONT_Z - (BACK_Z + 0.5);
  for (const sx of shape.cushions) {
    const cu = put(g, box(shape.cushionW, CUSHION_T, cushionD, paint.cushion, { rough: 0.9 }), sx, COUCH_SEAT_HEIGHT - CUSHION_T / 2, CUSHION_FRONT_Z - cushionD / 2);
    cushions.push(cu);
  }

  const pillow = box(shape.pillow.w, 0.5, 0.22, paint.accent, { rough: 0.9 });
  pillow.position.set(shape.pillow.x, COUCH_SEAT_HEIGHT + 0.25, BACK_Z + 0.62);
  pillow.rotation.z = shape.pillow.tilt;
  g.add(pillow);

  /**
   * Re-upholster without rebuilding, the way the rug repaints.
   *
   * Hung on `userData` for the same reason `movable` is: a prop declares what can be
   * done to it at the point it is built, and the editor goes looking.
   */
  g.userData.repaint = (next) => {
    const now = upholstery(next);
    for (const m of body) m.material = mat(now.body, { rough: 0.9 });
    for (const m of cushions) m.material = mat(now.cushion, { rough: 0.9 });
    pillow.material = mat(now.accent, { rough: 0.9 });
  };

  const handle = {
    id: spec.id,
    kind: spec.kind,
    seats: spec.seats.map((s, i) => ({
      index: i,
      position: new THREE.Vector3(s.x, 0, s.z),
      // Where somebody stands to get into this seat, and steps back out to when
      // they leave it: the seat itself is inside the couch, so it is the only
      // route in or out that does not cross the furniture (see FURNITURE_KINDS
      // in config).
      front: new THREE.Vector3(s.front.x, 0, s.front.z),
      rotation: s.rotation,
      occupiedBy: null,
    })),
    approach: new THREE.Vector3(spec.approach.x, 0, spec.approach.z),
    freeSeat() { return this.seats.find((s) => !s.occupiedBy) ?? null; },
    /**
     * The couch has been moved or turned: bring its cushions with it.
     *
     * Updated in place rather than rebuilt from the config's seats, and that is the whole
     * point of the method. A seat carries a booking — `occupiedBy` — and mapping a
     * fresh array over the config would hand back two empty seats and lose track of
     * whoever is sitting on them, so the couch would let a second person sit down in
     * an occupied cushion.
     */
    relocate() {
      for (const [i, seat] of this.seats.entries()) {
        const s = spec.seats[i];
        if (!s) continue;
        seat.position.set(s.x, 0, s.z);
        seat.front.set(s.front.x, 0, s.front.z);
        seat.rotation = s.rotation;
      }
      this.approach.set(spec.approach.x, 0, spec.approach.z);
    },
  };
  return { obj: g, handle };
}

export function buildCouch(spec) {
  return buildLoungeSeat(spec, COUCH_SHAPE);
}

/** One cushion, on the same sitting geometry and movement contract as the couch. */
export function buildArmchair(spec) {
  return buildLoungeSeat(spec, ARMCHAIR_SHAPE);
}

/**
 * Mount one couch: seats that carry bookings, and the relocate chain that keeps them
 * booked while the furniture is dragged.
 */
export function mount(spec, handles, label) {
  return mountLoungeSeat(spec, handles, label, buildCouch);
}

export function mountArmchair(spec, handles, label) {
  return mountLoungeSeat(spec, handles, label, buildArmchair);
}

function mountLoungeSeat(spec, handles, label, build) {
  const { obj, handle } = build(spec);
  const relocate = () => {
    obj.position.set(spec.x, 0, spec.z);
    obj.rotation.y = spec.facing;
    // Colour comes back through here too: relocating is the moment a prop is told the
    // layout has changed, and a repaint is a change to the layout like any other.
    obj.userData.repaint(spec.color ?? null);
    handle.relocate();
  };
  relocate();
  const entry = { id: spec.id, couch: handle };
  handles.couches.push(entry);
  return movable(obj, `furniture:${spec.id}`, {
    label,
    spec,
    relocate,
    teardown: () => drop(handles.couches, entry),
  });
}
