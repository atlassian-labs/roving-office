import { DOOR } from '../config.js';
import { WALK_Y } from './outlooks/streetscape.js';

// How you get from the street to the door — the stoop and the external staircase,
// and the routes over both.
//
// The geometry lives here rather than in the builder because it has more than one
// reader: the builder that puts the treads there, the courier who comes up them with
// a parcel, and the agents who walk in and out. Worked out once and handed round as
// a descriptor, a step height changed in one place cannot leave the others walking
// through the air. `buildEnvironment` publishes whichever applies as `handles.stoop`
// or `handles.stairs`, in the same way it publishes the lift.
//
// --- The staircase -----------------------------------------------------------
// One straight flight, run parallel to the facade and tight against it, climbing
// from the pavement to the door landing — the way an external stair is actually
// built on a warehouse. (It used to switch back into the street, which read as a
// fire escape stranded in mid-air.)
//
// Two constraints shape the numbers:
//   1. the flight must *reach the pavement*, which is |WALK_Y| below the storey
//      line, not the storey line itself,
//   2. it must stay inside the near pavement band without fouling the street lamps
//      standing at its outer edge, hence the modest tread width.
const RISER_TARGET = 0.46;
export const STAIR_TREAD = 0.62;
export const STAIR_WIDTH = 2.3;
export const STAIR_Z = -1.15;            // centre-line, hugging the wall face
export const STAIR_RAIL_H = 1.0;
export const STAIR_POST_EVERY = 4;       // treads between balusters / ground props

/**
 * Work out the flight for a door standing `dropHeight` above its storey line.
 *
 * @param {number} dropHeight  height of the modelled storeys below this floor
 * @return {{groundY: number, steps: number, riser: number, tread: number,
 *           run: number, xTop: number, xPad: number, width: number, z: number,
 *           pitch: number, route: Array<{x: number, y: number, z: number}>,
 *           descent: Array<{x: number, y: number, z: number}>}}
 *   `route` climbs from the pavement to the landing; `descent` is the same flight
 *   the other way, so nobody has to remember to reverse it.
 */
export function stairFlight(dropHeight) {
  const groundY = -(dropHeight + Math.abs(WALK_Y));
  const steps = Math.max(3, Math.round(Math.abs(groundY) / RISER_TARGET));
  const riser = Math.abs(groundY) / steps;
  const run = steps * STAIR_TREAD;

  // The flight starts at the outer edge of the stoop and descends in +x, so the
  // top tread meets the landing rather than the wall.
  const xTop = DOOR.x + (DOOR.width + 2.6) / 2;

  const flight = {
    groundY,
    steps,
    riser,
    run,
    xTop,
    // Middle of the pad at the foot, where the flight meets the pavement.
    xPad: xTop + run + STAIR_TREAD,
    tread: STAIR_TREAD,
    width: STAIR_WIDTH,
    z: STAIR_Z,
    pitch: Math.atan2(riser, STAIR_TREAD),
  };

  flight.route = stairRoute(flight);
  flight.descent = [...flight.route].reverse();
  return flight;
}

/**
 * The walkable line up the flight: pavement, bottom tread, top tread, landing.
 *
 * Four points rather than one per tread, because the pitch is constant — the
 * straight line through the tread noses *is* the flight, so interpolating along it
 * puts a walker's feet on the treads the whole way up. What that buys is a route
 * that stays right when the storey height changes and the step count with it.
 *
 * Heights are tread *tops*, since that is what is stood on: tread `i` has its top
 * at `-riser * i`, so the topmost is level with the landing and the bottom one sits
 * one riser above the pavement.
 */
function stairRoute({ xTop, run, tread, riser, steps, groundY, z }) {
  return [
    // On the pad at the foot of the flight, which stands a little proud of the
    // pavement it is bedded into.
    { x: xTop + run + tread, y: groundY + 0.2, z },
    // The bottom tread...
    { x: xTop + (steps - 0.5) * tread, y: -riser * (steps - 1), z },
    // ...and the top one, level with the landing.
    { x: xTop + 0.5 * tread, y: 0, z },
    // Off the flight and across the landing, to the spot outside the door that
    // every entrance shares.
    { x: DOOR.outside.x, y: 0, z: DOOR.outside.z },
  ];
}

// --- The stoop ---------------------------------------------------------------
// A landing flush with the floor, with two steps down at its outer edge. The steps
// are the builder's, but where their tops are is everyone's, so they are worked out
// here and `buildStoop` reads them back.
const STOOP_STEP_H = 0.42;
const STOOP_STEP_D = 0.7;
const STOOP_STEPS = 2;

/** Tread tops and centres for the steps down off the landing, outermost last. */
export function stoopSteps() {
  const steps = [];
  for (let i = 0; i < STOOP_STEPS; i++) {
    steps.push({
      i,
      // Matching the boxes: each is `STOOP_STEP_H` tall, centred on this y.
      y: -0.2 - i * STOOP_STEP_H,
      z: -DOOR.stoopDepth - 0.35 - i * STOOP_STEP_D,
      width: DOOR.width + 2.6 - i * 0.5,
    });
  }
  return steps;
}

/**
 * The way up to a door that opens onto a stoop.
 *
 * The courier used to appear on open pavement out past the end of the stoop, in
 * plain view — a delivery man popping into existence mid-street. He now comes round
 * the **outside corner of the building**, where the two standing walls meet: from
 * the diorama's camera that corner is the one bit of the exterior hidden by the
 * building itself, so he walks out from behind it and the arrival has somewhere to
 * have come from.
 *
 * @param {boolean} raised  true when the door opens onto an interior landing a storey
 *   up rather than onto the street. There is no pavement to walk in from then, and no
 *   steps either — `buildStoop` omits them — so the route stays at floor level.
 */
export function stoopApproach(raised = false) {
  const groundY = raised ? 0 : WALK_Y;

  return {
    route: [
      // Tucked behind the corner. Both walls stand between here and the camera.
      { x: -3.2, y: groundY, z: -1.5 },
      // Out along the face of the wall, to the edge of the landing.
      { x: -0.1, y: groundY, z: -1.5 },
      // And up onto it. A single step off the pavement, taken deliberately, because
      // the stoop's own steps are round at the front and this is the side of it.
      { x: 1.5, y: 0, z: -1.5 },
      // The spot outside the door that every entrance shares.
      { x: DOOR.outside.x, y: 0, z: DOOR.outside.z },
    ],
  };
}
