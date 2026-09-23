import * as THREE from 'three';

// Two people, one bit of floor.
//
// Every destination in the office used to be a single point: one approach spot
// per station, so the second person to want a coffee walked to the exact
// coordinate the first was standing on and the two bodies became one. Desks and
// couch seats never had the problem because they are booked before they are
// walked to — a station was not booked at all.
//
// So this file answers the same question twice, at two different scales:
//
//   * `StandingSpots` spreads arrivals along the front of a machine, so people
//     queue shoulder to shoulder rather than converging on one coordinate. This
//     is what makes a crowd at the mailbox *look* deliberate.
//   * `resolveOverlaps` is the guarantee behind it. Whatever the behaviour code
//     asked for, and however the walking worked out, the frame ends with no two
//     bodies sharing space. Nothing else has to be careful for this to hold.
//
// The split matters: the spots are a nicety and could be tuned or removed, while
// the separation pass is the invariant. Overlap is a bug at any distance, so the
// pass is unconditional and runs on every agent, every frame.
//
// A third question, at a third scale: `declutterTags` answers it for the name
// tag floating over each head rather than the body underneath. A queue standing
// correctly a shoulder apart is a floor-space problem solved — but each tag is
// drawn five world units wide (Agent.js TAG_WORLD_W), sized to read from across
// the room, and three or four of those over a two-metre queue overlap into one
// illegible pill regardless of how well the bodies are spaced. That is a
// screen-space problem, not a floor-space one, so resolveOverlaps correctly has
// nothing to say about it and this is a separate pass.

/**
 * How much floor one person takes up.
 *
 * The torso is 0.8 wide, so a gap of twice this keeps two bodies clearly apart
 * with a little air between them. Measured on the torso rather than on the full
 * arm span (the hands hang at ±0.63, see Agent._buildBody) on purpose: people do
 * brush past each other in a corridor, and insisting on a metre and a quarter of
 * clearance in a room with five desks would make the walking lanes unusable.
 */
export const AGENT_RADIUS = 0.46;
const MIN_GAP = AGENT_RADIUS * 2;

// Overlaps are resolved pairwise, so pushing A off B can push A onto C, and a
// cluster of three or four in a corner needs several goes to settle: measured, one
// pass leaves people a tenth of a unit inside each other, and this many gets the
// gap it asked for. Costs nothing when the room is calm, because the loop stops as
// soon as a pass finds nothing to do.
const PASSES = 8;

/**
 * Push apart anybody sharing space. Call once per frame, after everyone has
 * moved.
 *
 * Seated people hold their ground: they are in a chair that is theirs alone, and
 * shoving them would slide them out of the furniture they are drawn sitting in.
 * Everyone standing gives way, which is also what makes this read as behaviour
 * rather than physics — the person standing at the machine takes half a step
 * sideways as a colleague arrives.
 *
 * @param {Array<{id: string, position: THREE.Vector3, seated: boolean,
 *                setPositionXZ: function}>} agents
 * @param {{walkableAt: function}} nav  so nobody is pushed into the furniture
 * @returns {number} how many pairs had to be separated
 */
export function resolveOverlaps(agents, nav) {
  if (agents.length < 2) return 0;
  let separated = 0;

  for (let pass = 0; pass < PASSES; pass++) {
    let touched = 0;

    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i], b = agents[j];
        // Two people in chairs are two people in two chairs. Nothing to do, and
        // nothing we could do without taking one out of their seat.
        if (a.seated && b.seated) continue;
        // On a fixed route — a flight of stairs — rather than free-standing floor.
        // A shove has nowhere to land somebody there: the flight isn't part of the
        // room's walkable nav grid, so `shift` would take them off the treads
        // altogether, and a stair is the one place where stepping aside isn't a
        // thing people do. Keeping two climbers apart is `follow`'s own job, and it
        // does it by taking turns rather than by spacing — one walker at a time
        // holds the flight, the rest wait at the end they are getting on at, where
        // they are ordinary standing bodies again and this pass gives them room.
        // See `_stepFollow` and `_mountBlocked` in states.js.
        if (a.onRoute || b.onRoute) continue;

        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        let d = Math.hypot(dx, dz);
        if (d >= MIN_GAP) continue;

        if (d > 1e-4) {
          dx /= d; dz /= d;
        } else {
          // Exactly coincident — the case this whole file exists for, and the one
          // with no direction to push along. Derive one from the pair's names so
          // they always separate the same way instead of jittering on a fresh
          // random angle every frame.
          const angle = pairAngle(a, b);
          dx = Math.sin(angle); dz = Math.cos(angle); d = 0;
        }

        const overlap = MIN_GAP - d;
        // Right of way decides who steps aside and by how much. Whatever one of
        // them cannot take — a wall behind them, furniture — is handed to the
        // other, so a shove is never quietly lost.
        const wa = yieldWeight(a), wb = yieldWeight(b);
        const moved = shift(a, -dx, -dz, overlap * (wa / (wa + wb)), nav);
        shift(b, dx, dz, overlap - moved, nav);

        touched++;
      }
    }

    if (pass === 0) separated = touched;
    if (touched === 0) break;
  }

  return separated;
}

/**
 * How much of a shove somebody absorbs, relative to the person they are sharing
 * space with.
 *
 * Seated people hold their ground entirely. Beyond that it is right of way:
 * somebody walking keeps their line and the person standing about does most of the
 * stepping aside. That is both how people behave and what keeps walking working —
 * split evenly, half of every step a walker takes is cancelled by the colleague
 * they are passing, and they appear to march on the spot.
 */
function yieldWeight(agent) {
  if (agent.seated) return 0;
  // On their way somewhere, rather than merely animated: somebody waiting their
  // turn in a queue is still going somewhere, and should not be shoved out of the
  // line they are standing in by everyone who passes.
  return agent.walking ? 0.25 : 1;
}

/**
 * Slide one person along a direction, as far along it as the floor allows.
 *
 * A push that would land somebody inside a desk is worse than the overlap it
 * fixes, so the move is tried at full length and then shortened. Anyone already
 * standing on blocked floor — walking the last step into a chair, or on the
 * doorstep outside — is moved regardless: they are not made any more stuck, and
 * refusing would leave the overlap standing.
 *
 * @returns {number} the distance actually applied
 */
function shift(agent, ux, uz, amount, nav) {
  if (amount <= 1e-6) return 0;
  const { x, z } = agent.position;
  const loose = !nav.walkableAt(x, z);

  for (const fraction of [1, 0.6, 0.3]) {
    const step = amount * fraction;
    const nx = x + ux * step, nz = z + uz * step;
    if (loose || nav.walkableAt(nx, nz)) {
      agent.setPositionXZ(nx, nz);
      return step;
    }
  }
  return 0;
}

// How far ahead a walker looks for somebody in their way: the gap they have to
// keep, plus a little, so they come to a stop just short of a colleague rather
// than pressing into them.
const LOOK_AHEAD = MIN_GAP + 0.3;

// Only what is genuinely in front counts. Squeezing past somebody shoulder to
// shoulder is fine and normal; walking into their back is not.
const AHEAD_DOT = 0.55;

/**
 * Is somebody standing in the way of a step in this direction?
 *
 * The separation pass alone is not enough for walking. A walker who presses into
 * a colleague has their step cancelled by the push and marches on the spot, which
 * is exactly the tell the codebase already avoids elsewhere. So a walker asks
 * this first and simply waits — which is what a person does when the way to the
 * coffee machine is occupied, and gets the queue for free.
 *
 * Seated people are not counted: they are inside furniture, off the walkable
 * lanes, so they are never really "in the way" — and treating them as blockers
 * would stop people walking up to their own desk. Keeping bodies apart around a
 * chair is left to `resolveOverlaps`, which is where the guarantee lives.
 *
 * @param {{position: THREE.Vector3}} agent  the walker
 * @param {Iterable<{position: THREE.Vector3, seated: boolean}>} others
 * @param {number} ux  unit heading
 * @param {number} uz
 */
export function wayBlocked(agent, others, ux, uz) {
  for (const other of others) {
    if (other === agent || other.seated) continue;

    const dx = other.position.x - agent.position.x;
    const dz = other.position.z - agent.position.z;
    const d = Math.hypot(dx, dz);
    if (d > LOOK_AHEAD || d < 1e-6) continue;
    if ((dx * ux + dz * uz) / d < AHEAD_DOT) continue;

    // Somebody who is getting on with their own walk will clear the way by
    // themselves, so wait for them: that is all a queue is. Somebody stopped —
    // parked at a machine, or held up by a third person — is a standoff, and if
    // both wait it never ends, so one goes first and the separation pass eases the
    // other aside.
    if (other.moving && !other.heldUp) return true;
    if (!goesFirst(other, agent)) continue;

    return true;
  }
  return false;
}

/**
 * Which of two people held up in front of each other should move first.
 *
 * Whoever has been waiting longer, so a busy corridor cannot starve anybody: a
 * fixed order would mean the same person yielding to everybody every time, and
 * standing still for as long as the room stayed busy. Names settle exact ties, of
 * which the common one is two people who have only just stopped.
 */
function goesFirst(other, agent) {
  const waited = (other.heldUp ?? 0) - (agent.heldUp ?? 0);
  if (Math.abs(waited) > 0.05) return waited > 0;
  return String(other.id) < String(agent.id);
}

/** A stable heading for a pair, so a coincident pair always parts the same way. */
function pairAngle(a, b) {
  const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return ((h >>> 0) % 360) * Math.PI / 180;
}

// ---------------------------------------------------------------------------

// Shoulder to shoulder along the front of a machine. Wider than MIN_GAP so a
// queue looks like a queue rather than like people being held apart.
const SPOT_GAP = 1.05;

// Places at a machine, sideways from the station's own approach point: the front
// of it, then a step to either side, then two. Five is more than an office this
// size ever needs at one machine, and a sixth arrival is simply separated by the
// pass like anybody else.
const SPOT_OFFSETS = [0, SPOT_GAP, -SPOT_GAP, SPOT_GAP * 2, -SPOT_GAP * 2];

// A spot is held while its owner is within this of it. Loose enough that the
// separation pass nudging somebody sideways does not lose them their place.
const HOLD_RADIUS = 1.5;

// Safety valve for a booking whose owner never arrives: they were diverted
// mid-walk and no longer intend to come. Same reasoning as the timeout on
// `waitUntil` in states.js — a state nothing can clear has to clear itself.
const CLAIM_TIMEOUT = 25;

/**
 * Who stands where at a shared machine.
 *
 * Stations are single points in the layout config, because that is what a prop
 * has: one front. This hands out the floor in front of it — the approach point
 * itself first, then a step to either side — and keeps the booking only while its
 * owner is actually there or on their way.
 *
 * Bookings expire by observation rather than by being released, which is why no
 * behaviour has to remember to give a spot back. An agent who walks off to a desk
 * loses their place at the coffee machine because they are no longer standing in
 * it, which is exactly the rule a person would follow.
 */
export class StandingSpots {
  /** @param {{walkableAt: function}} nav */
  constructor(nav) {
    this.nav = nav;
    this.claims = new Map();        // agentId -> { key, point, arrived, age }
  }

  /**
   * Book this agent a place at `station` and say where it is.
   *
   * The middle is taken first, because that is where the layout put the approach
   * point and it is where somebody using a machine on their own belongs — square in
   * front of it. Only when the middle is taken do the side places come into it, and
   * then the nearest free one wins, so an arrival stops at the near end of the queue
   * rather than walking through somebody to reach the far side.
   *
   * @param {{id: string, approach: {x: number, z: number}, lookRotation?: number}} station
   * @param {{id: string, position: THREE.Vector3}} agent
   * @returns {THREE.Vector3} where to walk to
   */
  claim(station, agent) {
    this.release(agent.id);

    const { approach, lookRotation = 0 } = station;
    // A rotation of 0 faces +z here (see Agent.faceDirection), so the shoulder
    // axis across the front of the machine is a quarter turn from the look.
    const sx = Math.cos(lookRotation), sz = -Math.sin(lookRotation);
    const taken = new Set([...this.claims.values()].map((c) => c.key));

    const free = [];
    for (const offset of SPOT_OFFSETS) {
      const key = `${station.id}:${offset}`;
      if (taken.has(key)) continue;

      const x = approach.x + sx * offset;
      const z = approach.z + sz * offset;
      // The approach point is a given — the layout put it there — but a step to
      // the side of it may be inside the bin or through a wall.
      if (offset !== 0 && !this.nav.walkableAt(x, z)) continue;

      free.push({ key, x, z, offset });
    }

    if (!free.length) {
      // Every place taken: send them to the front of the machine and let the
      // separation pass find them room. Rare, and better than not going at all —
      // but still booked, under a key of their own rather than the shared front
      // key, so a second overflow arrival in the same beat doesn't walk onto the
      // exact point this one is already headed for, and so prune() can find and
      // eventually release this claim the same as any other.
      const key = `${station.id}:overflow:${agent.id}`;
      const point = new THREE.Vector3(approach.x, 0, approach.z);
      this.claims.set(agent.id, { key, point, arrived: false, age: 0 });
      return point.clone();
    }

    // The front of the machine wins outright whenever it is free, which is what
    // makes a lone visitor stand square in front of the thing they came to use. This
    // used to be decided by distance alone, with the middle only winning an exact
    // tie — so anyone approaching from one side stopped at the near end of an empty
    // queue, a metre or two off to the side of the coffee machine, facing past it.
    //
    // Once the front is taken, distance decides: you join the near end of the queue
    // rather than walking through somebody to reach the far one.
    const cost = (s) => Math.hypot(s.x - agent.position.x, s.z - agent.position.z);
    const middle = free.find((s) => s.offset === 0);
    if (!middle) free.sort((a, b) => (cost(a) - cost(b)) || (Math.abs(a.offset) - Math.abs(b.offset)));
    else free.unshift(...free.splice(free.indexOf(middle), 1));

    const { key, x, z } = free.find((s) => s.offset === 0) ?? free[0];
    const point = new THREE.Vector3(x, 0, z);
    this.claims.set(agent.id, { key, point, arrived: false, age: 0 });
    return point.clone();
  }

  release(agentId) { this.claims.delete(agentId); }

  /**
   * Drop bookings nobody is standing in.
   *
   * @param {number} dt
   * @param {(agentId: string) => ?THREE.Vector3} positionOf  null if they have left
   */
  prune(dt, positionOf) {
    for (const [agentId, claim] of this.claims) {
      const p = positionOf(agentId);
      if (!p) { this.claims.delete(agentId); continue; }

      const near = Math.hypot(p.x - claim.point.x, p.z - claim.point.z) <= HOLD_RADIUS;
      if (near) { claim.arrived = true; claim.age = 0; continue; }

      // Left the spot after standing in it: their place is free. Never got there
      // at all: hold it for the walk, then give up on them.
      claim.age += dt;
      if (claim.arrived || claim.age > CLAIM_TIMEOUT) this.claims.delete(agentId);
    }
  }
}

// ---------------------------------------------------------------------------

// How close two agents have to be before their name tags visibly collide.
// Bigger than MIN_GAP — bodies can be legally shoulder to shoulder in a queue
// while their five-unit-wide pills (Agent.js TAG_WORLD_W) still overlap by most
// of their width — smaller than a full tag, so two people at neighbouring desks
// a couple of units apart both keep theirs.
const TAG_CLUSTER_RADIUS = 1.8;

/**
 * Thin the name tags in a crowd.
 *
 * `StandingSpots` and `resolveOverlaps` do their job correctly: a queue really
 * is bodies a shoulder apart. But the tag floating over each head is drawn wide
 * enough to read from across the room (see Agent.js TAG_WORLD_W, and the
 * comment above it on why it has to be that big), and several of those over a
 * two-metre queue paint one illegible block regardless of how well the floor
 * space underneath was shared out. That is a screen-space problem, so it gets
 * its own pass rather than being folded into either of the floor-space ones.
 *
 * One tag per local cluster survives — the lowest id, the same tie-break
 * `goesFirst` already uses — so it is the same one every frame rather than
 * flickering between neighbours as positions shift by a few centimetres.
 *
 * Only reducing to 0 or 1: a half-faded pill in a crowd is still a smear, not a
 * softer version of the same information, so there is nothing worth showing in
 * between. Called unconditionally, including while riding an agent in first
 * person — safe only because `syncRideVisuals` in main.js runs later in the same
 * frame and overwrites every agent's fade with its own distance-based number
 * whenever a ride is in progress, which is also why this file does not need to
 * know whether one is.
 *
 * @param {Array<{id: string, position: THREE.Vector3, setTagFade: function}>} agents
 */
export function declutterTags(agents) {
  for (const a of agents) {
    let outranked = false;
    for (const b of agents) {
      if (b === a) continue;
      if (String(b.id) >= String(a.id)) continue;
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      if (Math.hypot(dx, dz) < TAG_CLUSTER_RADIUS) { outranked = true; break; }
    }
    a.setTagFade(outranked ? 0 : 1);
  }
}
