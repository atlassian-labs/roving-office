// The sit-stand base: a desk's legs replaced by a frame that travels.
//
// This is not a prop. It is the *underneath* of one, and it exists as its own file
// because a sit-stand desk is not a new kind of desk — it is an ordinary desk standing
// on a different base. Everything that makes a desk a desk (two monitors, the board on
// the second screen, a keyboard under the occupant's hands, a mug that appears when
// somebody fetches one, a plant on the corner nearest the camera) is desk.js's, and a
// standing desk gets all of it by being one. What it does not get is four legs.
//
// So the contract here is narrow: given the desk's group and the group that carries its
// working surface, add the frame. Some parts stand on the floor and never move; the
// rest hang off the surface and rise with it. Which is which is the whole design.
//
// What it is built out of comes from how the real thing is built. An electric
// height-adjustable desk is six parts — a top frame, two lifting columns, a motor, a
// control box, a desk panel and a cable harness — and of those, the ones that can be
// seen across a room are the columns, the feet, the beam between them and the handset
// under the front edge. Those are modelled. The motor and control box live inside the
// columns, where nobody can see them, so they are not.
//
// It is a **T-frame** rather than a C-frame: the feet extend both fore and aft of each
// column and a beam spans between them. A C-frame throws its foot forward only and
// drops the beam, which buys toe room at the cost of the stability — and at this
// distance the beam is one of the few lines that says "machine" rather than "table".

import { COLORS } from '../../config.js';
import { lerp, smoothstep } from '../../ease.js';
import { box, footY, put } from '../build.js';

/**
 * How far the working surface rises, and why it is not further.
 *
 * The honest answer to "how high is a standing desk" would be the real one: a desk is
 * 73 cm seated and about 110 cm standing, and at this scene's body scale — an agent's
 * head tops out at 2.51 for a body reading about 1.72 m, so roughly 1.46 units to the
 * metre — that 37 cm rise is 0.54 units. This was 0.54 first, and it looked right
 * standing empty.
 *
 * It is 0.34 because of the arm. An agent's arm is one box on a shoulder pivot with no
 * elbow in it (see `TYPE_REACH` in agents/Agent.js): the shoulder is at 1.78 standing
 * and the hand hangs 0.86 below it, so where the hand can be is a circle, not a
 * reachable volume. The keyboard sits at 1.63, and the shoulder angle that puts a hand
 * on it is what decides the height:
 *
 *     rise 0.18 → -98.7°     rise 0.34 → -109.7°     rise 0.54 → -124.7°
 *
 * Seated typing is -97.3°. At 0.54 the arms come up half a unit above the shoulders and
 * the agent reads as reaching over their own head to type — a desk too high for the
 * person at it, which is precisely the ergonomic mistake the real object exists to fix.
 * At 0.34 the reach is 12° past the seated one, which is somebody at a slightly high
 * desk, and the surface is still clearly a stand up from the row it sits beside.
 *
 * The trade is real and worth naming: this is a smaller rise than life, bought to keep
 * the pose honest, because a body with no elbow cannot be argued with.
 */
export const RISE = 0.34;

/** The shoulder angle that lands a hand on the keys at `RISE`. Used by the standing pose. */
export const STANDING_TYPE_REACH = -109.7 * (Math.PI / 180);

const FOOT_H = 0.12;

/**
 * Build the frame under a sit-stand desk.
 *
 * @param {object}   parts
 * @param {object}   parts.g        the desk's own group: takes everything floor-bound
 * @param {object}   parts.surface  the group that carries the top: takes everything that rises
 * @param {number}   parts.topY     height of the working surface *within* the surface group
 * @param {number}   parts.topT     thickness of the desk top, so the frame hangs off its underside
 * @param {number}   parts.columnX  how far out the columns stand, matching the legs they replace
 * @param {number}   parts.deskD    depth of the top, for sizing the feet under it
 * @param {number}   parts.standZ   where the occupant stands, in desk space — the mat goes there
 */
export function addSitStandFrame({ g, surface, topY, topT, columnX, deskD, standZ }) {
  // Everything that travels hangs off the *underside of the top*, and that height is not
  // zero. The surface group sits at zero and its children carry the absolute heights a
  // desk has always used — the top at 1.5, monitors at 1.58 — so a frame written as
  // offsets from the group's own origin lands on the floor instead of under the board.
  // Which is exactly what happened: the columns, the beam, the tray and the handset all
  // built themselves in a heap around y=0 while the fixed inner posts, measured from the
  // floor, went to the right place and made the portrait look plausible.
  const underTop = topY - topT;
  // The column sections. The *upper* one is the wider of the two, because that is the
  // way a lifting column is actually built: the widest section carries the top frame and
  // the narrower ones nest downward toward the foot. Getting this the wrong way round is
  // the tell-tale of a desk drawn from memory — it reads as a table on spikes.
  //
  // The two sections are given different colours, which most real frames do not bother
  // with — they are black all the way down. This one is deliberately two-tone because
  // the first version was not, and photographed as a plain table on two black posts:
  // with no visible join there was nothing to say the column was a column rather than a
  // leg, and the desk lost the only feature it has. A pale inner section against a dark
  // sleeve draws the join, and it pays off twice, because the thing that changes as the
  // desk rises is precisely how much of the pale section is showing.
  const SLEEVE_W = 0.30;
  const SLEEVE_H = 0.78;
  const INNER_W = 0.19;
  // The fixed inner post reaches the underside of the lowered top, so that at rest the
  // column is closed up. Derived rather than written down, because a literal that happens
  // to equal `underTop` today is a literal that silently stops equalling it.
  const INNER_TOP = underTop;
  const INNER_COLOR = 0x8d949d;

  const footD = Math.min(deskD - 0.4, 1.6);

  for (const sx of [-columnX, columnX]) {
    put(g, box(0.26, FOOT_H, footD, COLORS.metalDark, { rough: 0.45, metal: 0.5 }), sx, footY(FOOT_H), 0);

    // Pads under the ends of each foot. Small, and worth it: a bare foot box sits flat
    // on the floorboards, and two surfaces on one plane is the bug this scene keeps
    // having (see docs/developer/coplanar-probe.md). Standing the foot on pads means the thing
    // touching the floor is a few centimetres across instead of most of a metre.
    for (const sz of [-footD / 2 + 0.13, footD / 2 - 0.13]) {
      put(g, box(0.22, 0.04, 0.17, 0x1b1e23, { rough: 0.9 }), sx, footY(0.04), sz);
    }

    const inner = box(INNER_W, INNER_TOP - FOOT_H, INNER_W, INNER_COLOR, {
      rough: 0.35, metal: 0.6,
    });
    inner.position.set(sx, FOOT_H + (INNER_TOP - FOOT_H) / 2, 0);
    g.add(inner);

    // Everything from here hangs off the surface, so it travels with the top.
    put(surface, box(0.13, 0.09, deskD - 0.4, COLORS.metalDark, { rough: 0.45, metal: 0.5 }), sx, underTop - 0.05, 0);

    const sleeve = box(SLEEVE_W, SLEEVE_H, SLEEVE_W, COLORS.metalDark, {
      rough: 0.4, metal: 0.55,
    });
    sleeve.position.set(sx, underTop - SLEEVE_H / 2, 0);
    surface.add(sleeve);

    // The collar on the bottom lip of the sleeve — the gland the inner section slides
    // through. A hand's breadth of geometry, and it is what turns two boxes into one
    // telescoping column: without it the join is a colour change, and a colour change in
    // shadow is nothing at all.
    const collar = box(SLEEVE_W + 0.04, 0.07, SLEEVE_W + 0.04, 0x14171b, {
      rough: 0.6, metal: 0.3,
    });
    collar.position.set(sx, underTop - SLEEVE_H + 0.035, 0);
    surface.add(collar);
  }

  // The beam between the columns. Deep rather than deep-set: the first version was
  // tucked up against the underside at the back, where the desk's own shadow ate it.
  const beam = box(columnX * 2 - SLEEVE_W, 0.13, 0.17, COLORS.metalDark, {
    rough: 0.45, metal: 0.5,
  });
  beam.position.set(0, underTop - 0.17, -0.12);
  surface.add(beam);

  // The cable harness, slung under the back edge. The one part of the wiring that is
  // visible on a real desk, and the reason a raising desk does not tear its own power
  // out: it travels with the top.
  put(surface, box(1.7, 0.12, 0.22, 0x33383f, { rough: 0.7, metal: 0.3 }), -0.4, underTop - 0.15, -deskD / 2 + 0.26);

  // The desk panel, under the front edge on the right — the switch that makes this an
  // electric desk rather than a crank one. A display and three keys: up, down, and the
  // memory preset that is the reason the panel exists, because the point of the desk is
  // returning to two known heights rather than hunting for them.
  put(surface, box(0.5, 0.1, 0.22, 0x22262c, { rough: 0.5 }), 1.0, underTop - 0.05, deskD / 2 - 0.18);
  const display = box(0.18, 0.06, 0.03, 0x8fd6c8, {
    rough: 0.3, emissive: 0x2f7f70, emissiveIntensity: 0.9,
  });
  display.position.set(0.84, underTop - 0.05, deskD / 2 - 0.07);
  surface.add(display);
  for (const [i, bx] of [1.01, 1.08, 1.17].entries()) {
    put(surface, box(0.055, 0.04, 0.03, i === 2 ? 0xd8dee9 : 0x6f7783, { rough: 0.6 }), bx, underTop - 0.045, deskD / 2 - 0.07);
  }

  // An anti-fatigue mat where the occupant stands, centred on the spot they stand on
  // rather than merely near the desk. Ergonomics guidance for standing work is emphatic
  // that a person needs somewhere to shift their weight to — a foot rail on the old
  // open-frame desks, a mat on a modern one — so the mat is part of the desk rather than
  // dressing.
  //
  // Its colour is lifted off near-black, which is where it started: under the after-dark
  // rig a very dark mat stopped reading as an object on the floor and started reading as
  // a hole in it. Matt rather than shiny, though — it is rubber, and it must not catch
  // the lamps. Lifted the same centimetre clear of the boards that the rug is, for the
  // same reason as the pads above.
  put(g, box(2.3, 0.05, 1.0, 0x585e68, { rough: 0.95 }), 0, footY(0.05), standZ);
}

/**
 * How long the columns take to run their full travel, in seconds.
 *
 * Real columns manage about 30 mm/s, which would make this crawl take a twelve-second
 * age: honest, and unwatchable in a scene where a whole job is thirty seconds. It is
 * compressed to something that still reads as motorised rather than snapped — you can
 * see it move, and you do not wait for it.
 */
export const TRAVEL = 1.6;

/**
 * The motor under a sit-stand desk.
 *
 * It has no clock of its own, and that is the point. A desk that cycled on a timer
 * moved with nobody near it — the surface rising in an empty room, and worse, the chair
 * sliding out from under it by itself, because the chair had been tied to the height.
 * Furniture in this office moves when somebody moves it, and the only thing that moves
 * a desk is the person taking up a post at it (see `takeStandingTurn` in desk.js).
 *
 * So this is a motor and nothing more: it is told where to go and it goes there, easing
 * off as it arrives. It owns its own position rather than being handed one each frame,
 * because "where is the desk" and "where is it heading" are the same question asked of
 * one part, and splitting them across caller and callee is how they come to disagree.
 *
 * @param {number} start  where the surface begins, 0 seated .. 1 standing
 */
export function sitStandMotor(start = 1) {
  let at = start;
  let from = start;
  let target = start;
  // Progress along the current run, 0..1. Starts arrived: a desk built raised is not a
  // desk in the middle of rising.
  let t = 1;

  return {
    /** Send the surface to `f`, easing there over `TRAVEL`. Re-asking is free. */
    driveTo(f) {
      if (f === target) return;
      from = at;
      target = f;
      t = 0;
    },
    /** Where it is heading, which is where it already is once it has arrived. */
    get target() { return target; },
    /** Where the surface is: 0 at seated height, 1 fully raised. */
    get at() { return at; },
    /**
     * Advance the motor.
     * @param   {number} dt  seconds
     * @returns {number} where the surface is now
     */
    step(dt) {
      if (t < 1) {
        t = Math.min(1, t + dt / TRAVEL);
        // Smoothstep, which is what a motor under load actually does: it takes a
        // moment to get the top moving and eases off as it arrives. Linear travel
        // reads as a lift being winched.
        at = lerp(from, target, smoothstep(t));
      }
      return at;
    },
  };
}
