import * as THREE from 'three';
import { easeOut, lerp, smoothstep } from '../ease.js';
import { SIT_SECONDS, footReach } from './Agent.js';
import { AGENT_RADIUS } from './crowd.js';

// Behaviour engine for a single agent, built as a small action queue. Complex
// routines (fetch job material -> sit at a desk -> go look something up ->
// deliver to the mailbox -> leave through the door) are just lists of actions,
// which keeps the movement/animation logic in one predictable place.
//
// Action kinds:
//   { kind:'walk',   target, status? }      walk a path to a world point; the
//                                          target may be a function, resolved as
//                                          the walk begins
//   { kind:'stepTo', target, seconds }      one pace in a straight line, no path
//   { kind:'follow', points, speed }        walk a fixed line of points, heights
//                                          included — the stairs outside the door
//   { kind:'face',   rotation }             turn to a heading (eased)
//   { kind:'turnChair', desk, to, seconds } swivel a desk chair, and its occupant
//   { kind:'sit',    seatHeight?, rotation?, position?, seconds? }
//   { kind:'stand' }                      get up, in place, before moving on
//   { kind:'wait',   duration, anim? }      hold a pose (typing/reading/...)
//   { kind:'until',  predicate, timeout }  hold until a condition is met
//   { kind:'status', status }               set the visual status
//   { kind:'carry',  item, opts? }          show/hide a carried item; `item` may be
//                                           a function, resolved when it runs
//   { kind:'do',     fn }                   run a side effect

export const WALK_SPEED = 6.4;

// How long a walker puts up with getting nowhere before looking for a way round.
// Short, because standing still is the thing being fixed: a step's hesitation reads
// as noticing somebody, and anything longer reads as being stuck.
const HELD_UP_DETOUR = 0.3;

// How far off a walker looks for people to route around. Near enough to be in the
// way; beyond it, closing lanes for somebody else's benefit is how a room seizes up.
const DETOUR_LOOK = 4.5;

// A detour that avoided the crowd right around them and still didn't get them
// moving means the crowd is wider than that, not that the first route was
// unlucky — so each detour in a row that fails to clear the holdup widens the
// next one's search, rather than retrying the same near radius until
// HELD_UP_ABANDON gives up on the trip altogether. Capped, because "avoid
// everyone in the building" is already the widest a route can usefully get.
const DETOUR_LOOK_GROWTH = 0.6;
const DETOUR_LOOK_MAX_TRIES = 4;

// How close counts as "might as well have arrived": comfortably past MIN_GAP
// (crowd.js), so finishing here rather than fighting for the exact coordinate
// is not a visible difference once resolveOverlaps places them for the frame.
const NEAR_GOAL_RADIUS = 0.6;
// Short, on purpose: unlike HELD_UP_ABANDON this is not a backstop for the
// genuinely impossible, it is the normal outcome for a goal somebody else's
// claim has drifted across — see the comment in _stepWalk.
const NEAR_GOAL_ABANDON = 3;

// And how long before it gives up altogether. This is a backstop for the genuinely
// impossible, not a normal outcome: giving up strands the agent short of wherever
// they were going, which is how people ended up miming at the mailbox from the
// middle of the room. Long enough that a busy office never reaches it.
const HELD_UP_ABANDON = 40;
const ARRIVE_EPS = 0.06;

// How far up a flight the walker ahead has to be before the next one sets off.
//
// Measured along the pitch, and that is why it is wider than the shoulder room two
// people are given on the level (crowd.js MIN_GAP): a gap up a staircase is spent
// on the rise as well as the run, so the same number buys less daylight between two
// bodies than it does on the floor. This is about two treads, which is what a person
// leaves on a stair — close enough to be a queue, far enough to be two people.
const STAIR_GAP = AGENT_RADIUS * 2 + 0.7;

/**
 * How long somebody waits their turn at the end of a flight before taking it anyway.
 *
 * Taking turns is what keeps a staircase single file, and a queue for one drains in
 * seconds — but the wait had no end to it, which made `follow` the one action in the
 * room that could never finish. Two walkers who each believe the other holds the
 * flight is not a state this reaches (see `_mountBlocked` on why), and yet a
 * doorway's worth of people going down as a cron job sends a fresh one up every
 * minute is a queue that can be *starved*, and that is the same thing seen from the
 * bottom step: somebody who never gets on.
 *
 * So the wait is bounded, and what follows it is deliberately the rude option —
 * climb anyway, sharing the treads with whoever is on them — rather than abandoning
 * the trip. Off the end of a flight there is nowhere to abandon it *to*: the nav grid
 * is the room's floor, and a walker stranded on the landing outside would have
 * nothing to walk on. Two bodies overlapping on a staircase for a second is the
 * lesser fault, and the office is bounded either way.
 */
const MOUNT_WAIT = 20;

export class AgentController {
  /**
   * @param agent
   * @param nav
   * @param {?(agent, ux: number, uz: number) => boolean} wayBlocked  asked before
   *   each step whether a colleague is standing in the way; see agents/crowd.js
   * @param {?(() => Iterable<{position: THREE.Vector3, seated: boolean}>)} crowd
   *   who else is in the room, asked for when a way round somebody is needed
   */
  constructor(agent, nav, wayBlocked = null, crowd = null) {
    this.agent = agent;
    this.nav = nav;
    this.wayBlocked = wayBlocked;
    this.crowd = crowd;
    this._heldUp = 0;
    this.queue = [];
    this.current = null;
    this.onIdle = null;      // called when the queue empties
    this._faceFrom = 0;
    this._faceT = 0;
    /** @type {?THREE.Vector3[]} the route being walked now, corners only */
    this._path = null;
    this._pathIndex = 0;
    /**
     * The route of the walk that finished most recently, kept after `_path` is cleared.
     *
     * Only read by the furniture editor, which draws it (see scene/path-trails.js): where
     * somebody just came from is the other half of what a layout change did to them, and
     * it is gone by the time you notice the room changed. Held here rather than
     * accumulated in the editor because this is the object that knows when a walk ends —
     * and it ends in three different places.
     */
    this._lastPath = null;
    /** When `_lastPath` was retired, so the editor can fade it out with age. */
    this._lastPathAt = 0;
  }

  /**
   * Retire the current route, remembering it as the one just walked.
   *
   * Every way a walk can end comes through here: arriving, being abandoned as
   * impossible, and being interrupted by a new action list. Missing any one of them
   * would leave a stale route on display, which is worse than none — it would be
   * pointing somewhere nobody is going.
   */
  _endPath() {
    if (this._path) {
      this._lastPath = this._path;
      this._lastPathAt = performance.now();
    }
    this._path = null;
  }

  /**
   * Where this agent has just been, and where they are going next.
   *
   * Both are the runner's own arrays rather than copies, on the understanding that the
   * caller only reads them: they are replaced wholesale on every re-plan and detour, so
   * a caller reading them each frame always sees the current answer without having to
   * be told that it changed.
   *
   * `ahead` starts at the waypoint being walked towards, not at the agent — whoever
   * draws it can put the line's first point wherever the agent actually is, which is
   * between waypoints almost all of the time.
   *
   * `behindAge` is in seconds since that walk ended, and `Infinity` when there has never
   * been one, so that a caller fading old routes out can treat "too old to draw" and
   * "nothing to draw" as the same case.
   *
   * @returns {{ahead: ?THREE.Vector3[], behind: ?THREE.Vector3[], behindAge: number}}
   */
  pathTrail() {
    const walking = this.current?.kind === 'walk' && this._path;
    return {
      ahead: walking ? this._path.slice(this._pathIndex) : null,
      behind: this._lastPath,
      behindAge: this._lastPath ? (performance.now() - this._lastPathAt) / 1000 : Infinity,
    };
  }

  get busy() { return this.current !== null || this.queue.length > 0; }

  /** Replace whatever the agent was doing. */
  run(actions) {
    this.clear();
    this.push(actions);
  }

  push(actions) {
    const list = Array.isArray(actions) ? actions : [actions];
    for (const a of list) if (a) this.queue.push(a);
  }

  clear() {
    this.queue.length = 0;
    this.current = null;
    this._endPath();
    this.agent.walking = false;
    this.agent.heldUp = 0;
    this.agent.onRoute = false;
    // Giving up the flight as well as the route: somebody interrupted mid-climb is
    // no longer the reason the next person is waiting at the bottom of it.
    this.agent.routeFlight = null;
  }

  /** Replace only the remaining entrance steps, keeping queued work intact. */
  replaceEntrance(direction, actions) {
    const matches = (a) => a?.entrance === direction;
    const current = matches(this.current);
    const index = this.queue.findIndex(matches);
    if (!current && index < 0) return false;
    const remaining = this.queue.filter((a) => !matches(a));
    if (current) {
      this.clear();
      this.push([...actions, ...remaining]);
    } else {
      remaining.splice(index, 0, ...actions);
      this.queue = remaining;
    }
    return true;
  }

  /**
   * The room changed under this walker: work out the way there again.
   *
   * The furniture editor moves walls of the room while people are crossing it (see
   * src/editor.js), and a path is a list of points computed once against the grid as
   * it was. Left alone, somebody mid-stride would walk their old route straight
   * through a desk that had just been dropped in front of them.
   *
   * Only walkers are affected, and only the current step: anybody standing, sitting or
   * queueing has no path to correct, and the actions still in the queue resolve their
   * own targets when they begin.
   *
   * @returns {boolean} whether a route was found. False means the walk is now
   *   impossible, which the editor treats as a reason to refuse the drop.
   */
  replan() {
    if (this.current?.kind !== 'walk' || !this._goal) return true;
    const path = this.nav.findPath(this.agent.position, this._goal);
    if (!path || !path.length) return false;
    this._path = path;
    this._pathIndex = 0;
    this._lastDist = null;
    return true;
  }

  // -------------------------------------------------------------------------
  update(dt) {
    if (!this.current) {
      if (this.queue.length === 0) {
        // Nothing to do — let the owner decide what happens next.
        this.agent.update(dt, { moving: false });
        this.onIdle?.();
        if (this.queue.length === 0) return;
      }
      this.current = this.queue.shift();
      this._begin(this.current);
    }

    const done = this._step(this.current, dt);
    if (done) {
      this.current._onEnd?.();
      this.current = null;
    }
  }

  _begin(a) {
    switch (a.kind) {
      case 'walk': {
        // A target given as a function is resolved here, as the walk starts,
        // rather than when the list was written. Booking a place to stand is the
        // reason (see agents/crowd.js): an action list is built before the action
        // that gives up whatever the agent is currently holding has run, so a spot
        // chosen at build time would be chosen against out-of-date information.
        const target = typeof a.target === 'function' ? a.target() : a.target;
        const path = this.nav.findPath(this.agent.position, target);
        this._path = path && path.length ? path : null;
        this._pathIndex = 0;
        this._heldUp = 0;
        this._nextDetour = HELD_UP_DETOUR;
        // How many detours in a row have failed to get them moving again — see
        // _detour(), which widens its search the more of these there have been.
        this._detourTries = 0;
        this._nearGoal = 0;
        // Kept so a blocked walk can be re-planned toward the same place.
        this._goal = target;
        this._lastDist = null;
        this.agent.heldUp = 0;
        // On their way somewhere, which is what earns right of way in a crowd —
        // still true while they wait for somebody to move (see agents/crowd.js).
        this.agent.walking = true;
        if (a.status) this.agent.setStatus(a.status);
        if (this.agent.seated) this.agent.setSeated(false);
        break;
      }
      case 'face': {
        this._faceFrom = this.agent.root.rotation.y;
        this._faceT = 0;
        // Resolved here rather than in the builder: `lookAt` has to measure from
        // where the agent ended up, and a heading can be a function for the same
        // reason — the chair choreography does not know which way it will turn
        // until the walk that precedes it has chosen a side.
        a._to = a.at != null ? this._headingTo(a.at)
          : (typeof a.rotation === 'function' ? a.rotation() : a.rotation);
        break;
      }
      case 'turnChair': {
        a._from = a.desk.chairFacing ?? a.desk.sitRotation ?? 0;
        a._to = typeof a.to === 'function' ? a.to() : a.to;
        a._elapsed = 0;
        break;
      }
      case 'wait':
        a._left = a.duration;
        break;
      case 'until':
        a._left = a.timeout;
        break;
      case 'sit': {
        if (a.rotation != null) this.agent.setRotation(a.rotation);
        a._from = this.agent.position.clone();
        a._elapsed = 0;
        a._folding = false;
        // Where their feet are going to end up, which is where they have to be standing
        // before they fold. See `seatStand`.
        a._spot = a.position
          ? seatStand(a.position, this.agent.root.rotation.y)
          : this.agent.position.clone();
        break;
      }
      case 'stand':
        a._elapsed = 0;
        this.agent.setSeated(false);
        break;
      case 'stepTo':
        a._from = this.agent.position.clone();
        a._elapsed = 0;
        break;
      case 'follow':
        // Their height is the route's from the outset. Being a step off it in plan
        // sorts itself out — the walk below aims at the next point from wherever they
        // are standing — but being a storey off it would have them climb from thin
        // air, and both ends of every flight are level with the ground the walker is
        // already on.
        this.agent.setElevation(a.points[0].y ?? 0);
        a._index = 1;
        // Which flight this is, and which way up it they are going, so that two
        // walkers can tell they are on the same one. Read off the geometry rather
        // than passed in, because that is what makes a climber and a descender agree
        // they share a staircase: the two routes are one line walked either way, so
        // its ends name it and the rise says which way they are facing.
        a._flight = flightKey(a.points);
        a._dir = flightDirection(a.points);
        // How long they have been waiting their turn at the end of it. See MOUNT_WAIT.
        a._waited = 0;
        this.agent.walking = true;
        // Not on the flight yet: `_stepFollow` puts them on it once it is clear (see
        // `_mountBlocked`), and until then they wait at the foot like anybody else —
        // separated by the crowd pass, which is exactly what `onRoute` turns off.
        this.agent.onRoute = false;
        if (a.status) this.agent.setStatus(a.status);
        if (this.agent.seated) this.agent.setSeated(false);
        break;
      case 'status':
        this.agent.setStatus(a.status);
        break;
      case 'carry': {
        // Resolved here rather than when the list was built, the way `walk` resolves
        // its destination: what an agent is carrying can depend on what they found
        // when they got to the box, which is not known when the walk is planned.
        const item = typeof a.item === 'function' ? a.item() : a.item;
        this.agent.setCarrying(item, a.opts || {});
        break;
      }
      case 'do':
        a.fn?.();
        break;
      default:
        console.warn('Unknown action', a);
    }
  }

  _step(a, dt) {
    switch (a.kind) {
      case 'walk': return this._stepWalk(dt);
      case 'face': return this._stepFace(a, dt);
      case 'turnChair': return this._stepTurnChair(a, dt);
      case 'wait': {
        a._left -= dt;
        this.agent.update(dt, a.anim || {});
        return a._left <= 0;
      }
      case 'until': {
        a._left -= dt;
        this.agent.update(dt, a.anim || {});
        // The timeout is a deliberate escape hatch: if whatever we are waiting on
        // never becomes true (a prop was torn down mid-wait, say), the agent must
        // still be able to carry on rather than freeze in place forever.
        return a.predicate() || a._left <= 0;
      }
      // Instant actions complete immediately.
      case 'stepTo': return this._stepStepTo(a, dt);
      case 'follow': return this._stepFollow(a, dt);
      case 'sit': return this._stepSit(a, dt);
      case 'stand': return this._stepStand(a, dt);
      case 'status': case 'carry': case 'do':
        return true;
      default:
        return true;
    }
  }

  /**
   * Cover the pace set by `stepTo`, easing to a stop so they settle into a seat
   * rather than arriving at it dead on. Their facing is left alone: the turn
   * belongs to whoever queued the step, and somebody sitting down keeps looking
   * out into the room as they lower themselves backwards onto the cushion.
   */
  _stepStepTo(a, dt) {
    a._elapsed += dt;
    const k = Math.min(1, a._elapsed / a.seconds);
    const eased = easeOut(k);
    this.agent.setPositionXZ(
      lerp(a._from.x, a.target.x, eased),
      lerp(a._from.z, a.target.z, eased),
    );
    this.agent.update(dt, { moving: k < 1 });
    return k >= 1;
  }

  /**
   * Lower somebody into a seat: the last step and the fold, together.
   *
   * These used to be two actions — a `stepTo` that slid them into the seat on their
   * feet, and a `sit` that teleported them onto the cushion and snapped the pose in a
   * single frame. Both halves showed. Walking backwards into a couch put a standing
   * pair of legs through the frame on the way, and the snap at the end was a character
   * jumping from mid-stride to fully seated with nothing in between.
   *
   * One action fixes both, because it is one movement. The travel is eased out so they
   * settle rather than arrive, and `setSeated` has already started the pose blending at
   * the same rate — so the knees are folding while the body is still moving, and the
   * shins swing out in front of the couch instead of sweeping through it.
   *
   * A seat with no position is a seat they are already standing in: the sit is then
   * just the fold, which is what a chair swung in underneath somebody amounts to.
   */
  _stepSit(a, dt) {
    a._elapsed += dt;

    // Back up to the spot first, on their feet, still walking.
    if (!a._folding) {
      const k = Math.min(1, a._elapsed / SIT_STEP_SECONDS);
      const eased = easeOut(k);
      this.agent.setPositionXZ(
        lerp(a._from.x, a._spot.x, eased),
        lerp(a._from.z, a._spot.z, eased),
      );
      // The walk cycle is dropped before they arrive, and that is not cosmetic. A
      // swinging leg reaches a good way behind the body, and this step is backwards
      // towards furniture: carry the stride all the way in and the rear shin clips the
      // couch's front panel for a frame or two on the way. Letting the legs settle over
      // the last of the step is what a person does anyway — you step back, and then you
      // are standing before you sit.
      const left = Math.hypot(a._spot.x - this.agent.position.x, a._spot.z - this.agent.position.z);
      this.agent.update(dt, { moving: left > SIT_STEP_SETTLE });
      if (k < 1) return false;
      a._folding = true;
      a._elapsed = 0;
      this.agent.setSeated(true, a.seatHeight != null ? { seatHeight: a.seatHeight } : {});
      return false;
    }

    // Then fold, with the feet left exactly where the step put them: the mirror of
    // standing up, and for the same reason. Folding swings the foot forward on the end
    // of the thigh, so a root held still would push both feet forward across the floor;
    // moving it back by what the foot gains pins them and lets the hips travel instead,
    // down and back onto the cushion. It also lands them on the seat to the millimetre,
    // because the distance they travel is the same distance the fold is worth.
    const before = footReach(this.agent.seatBlend);
    // Not `moving`: they are lowering themselves, and a walk cycle underneath that is
    // two animations fighting over the same hips.
    this.agent.update(dt, {});
    const back = footReach(this.agent.seatBlend) - before;
    if (back > 0) {
      const heading = this.agent.root.rotation.y;
      const { x, z } = this.agent.position;
      this.agent.setPositionXZ(x - Math.sin(heading) * back, z - Math.cos(heading) * back);
    }
    return this.agent.seatBlend >= 1;
  }

  /**
   * Get up, and finish getting up before going anywhere.
   *
   * This used to complete in the same frame it started, which meant the step out of the
   * seat began while the character was still unfolding — so they rose and slid forward
   * at once, and what you saw was somebody sliding out of a couch and standing up
   * somewhere in front of it. Nobody leaves a sofa like that: you stand, and then you
   * walk.
   *
   * So it holds the queue until the pose has actually arrived. It does move them, but
   * only by what it takes to keep their feet still: see below. Whatever comes next — a
   * step clear, a walk across the room — starts from a character already on their feet.
   *
   * Gated on the pose rather than a clock, so a `setSeated(false, { instant: true })`
   * that has already put somebody on their feet costs no frames at all.
   */
  _stepStand(a, dt) {
    a._elapsed += dt;
    // Feet stay where they are; the hips come forward over them.
    //
    // Unfolding swings the foot back under the hip — see `footReach` — so a character
    // who rises without moving drags both feet backwards across the floor, which is the
    // one thing feet never do. Moving the root forward by exactly what the foot lost
    // pins the feet to the ground and lets the body do the standing, which is what
    // standing is.
    const before = footReach(this.agent.seatBlend);
    this.agent.update(dt, {});
    const forward = before - footReach(this.agent.seatBlend);
    if (forward > 0) {
      const heading = this.agent.root.rotation.y;
      const { x, z } = this.agent.position;
      this.agent.setPositionXZ(x + Math.sin(heading) * forward, z + Math.cos(heading) * forward);
    }
    return this.agent.seatBlend <= 0;
  }

  /**
   * Cover a fixed route, heights and all, spending one frame's worth of travel
   * across as many of its points as that reaches.
   *
   * Nobody goes round anybody here — a flight of stairs has no lanes, and stepping
   * aside on one means stepping off it — so the crowd is answered by *taking turns*
   * instead. One walker holds the flight; the rest wait at the end they are getting
   * on at, which is ground the room's ordinary separation pass can spread them
   * across, and follow them up one after another. That is what a staircase is: a
   * queue with a gap in it, going one way at a time.
   *
   * See `_mountBlocked` for the rule, and crowd.js for the other half of it.
   */
  _stepFollow(a, dt) {
    const agent = this.agent;
    const finish = () => {
      agent.walking = false;
      agent.onRoute = false;
      agent.routeFlight = null;
      agent.update(dt, { moving: false });
      return true;
    };

    // Waiting their turn at the foot (or at the head, going down). They stand where
    // they are rather than on the route's first point, so the separation pass can
    // give a second and third arrival room without fighting a route they are not on
    // yet — and when the flight clears they walk onto it from wherever that left
    // them, which is a step or so away.
    if (!agent.onRoute) {
      a._waited += dt;
      if (this._mountBlocked(a) && a._waited < MOUNT_WAIT) {
        const mount = a.points[0];
        agent.faceDirection(mount.x - agent.position.x, mount.z - agent.position.z);
        agent.heldUp += dt;
        agent.update(dt, { moving: false });
        return false;
      }
      agent.onRoute = true;
      agent.routeFlight = a._flight;
      agent.routeDir = a._dir;
      agent.heldUp = 0;
    }

    let budget = a.speed * dt;
    while (budget > 0 && a._index < a.points.length) {
      const target = a.points[a._index];
      const pos = agent.position;
      const dx = target.x - pos.x;
      const dy = (target.y ?? 0) - pos.y;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist <= Math.max(budget, ARRIVE_EPS)) {
        agent.setPositionXZ(target.x, target.z);
        agent.setElevation(target.y ?? 0);
        budget -= dist;
        a._index++;
      } else {
        const k = budget / dist;
        agent.setPositionXZ(pos.x + dx * k, pos.z + dz * k);
        agent.setElevation(pos.y + dy * k);
        budget = 0;
      }
      agent.faceDirection(dx, dz);
    }

    if (a._index >= a.points.length) return finish();
    agent.update(dt, { moving: true });
    return false;
  }

  /**
   * Is somebody else's turn still running on this flight?
   *
   * Two ways it can be, and both are the same rule seen from either end:
   *
   *   * **Coming the other way.** One line, walked in both directions: a climber and
   *     a descender do not pass, they walk through each other. So whoever is on it
   *     owns it, and the other waits at their end until it is empty.
   *   * **Still on the bottom step.** Behind somebody going the same way is fine —
   *     that is a queue — as long as it is a body's length behind, so wait until
   *     they are clear of the end being got on at.
   *
   * Only walkers who are actually *on* the flight count. Somebody else waiting to get
   * on never blocks, which is what keeps two people who both arrive at the foot from
   * standing there deferring to each other forever: the first controller to be asked
   * gets on, and by the time the second is asked there is a body on the stairs to
   * wait for. And nothing blocks a walker already on it, so a queue always drains.
   */
  _mountBlocked(a) {
    const mount = a.points[0];
    for (const other of this.crowd?.() ?? []) {
      if (other === this.agent || !other.onRoute) continue;
      if (other.routeFlight !== a._flight) continue;
      if (other.routeDir !== a._dir) return true;

      const dx = other.position.x - mount.x;
      const dy = other.position.y - (mount.y ?? 0);
      const dz = other.position.z - mount.z;
      if (Math.hypot(dx, dy, dz) < STAIR_GAP) return true;
    }
    return false;
  }

  _stepWalk(dt) {
    const a = this.agent;
    // A walk that is over — however it ended — is no longer waiting on anybody.
    const finish = () => {
      this._endPath();
      a.heldUp = 0;
      a.walking = false;
      a.update(dt, { moving: false });
      return true;
    };
    if (!this._path) return finish();

    const target = this._path[this._pathIndex];
    const pos = a.position;
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const step = WALK_SPEED * dt;

    if (dist <= Math.max(step, ARRIVE_EPS)) {
      a.setPositionXZ(target.x, target.z);
      this._pathIndex++;
      this._lastDist = null;              // a new waypoint, a new measure of progress
      if (this._pathIndex >= this._path.length) return finish();
    } else {
      const ux = dx / dist, uz = dz / dist;

      // A separate, longer-horizon watch for being stuck right on top of the
      // goal. `_heldUp` below resets on any small wiggle, which is right for a
      // normal queue wait — but a goal that is itself crowded (a neighbour's
      // StandingSpots claim can drift up to HOLD_RADIUS from their own point,
      // which is more than one SPOT_GAP, so it can end up sitting across the
      // last stretch into somebody else's) produces exactly that kind of wiggle
      // without the last half-metre ever actually closing. Tracked on distance
      // alone so a few centimetres of jitter can't keep resetting it the way it
      // resets `_heldUp`, and forgiven quickly rather than waiting for
      // HELD_UP_ABANDON: this close, finishing here and letting resolveOverlaps
      // place them looks no different from arriving exactly on the point.
      if (dist < NEAR_GOAL_RADIUS) {
        this._nearGoal += dt;
        if (this._nearGoal >= NEAR_GOAL_ABANDON) return finish();
      } else {
        this._nearGoal = 0;
      }

      // Two ways a walk can fail to get anywhere, and both have to be noticed.
      // Somebody standing in the way can be seen coming. Being pushed back as fast
      // as you step cannot — it happens in a gap too narrow for two, with nobody
      // strictly in front — so the ground actually gained is measured as well.
      const blocked = this.wayBlocked?.(a, ux, uz) === true;
      const gained = this._lastDist == null ? step : this._lastDist - dist;
      this._lastDist = dist;

      if (blocked || gained < step * 0.15) {
        this._heldUp += dt;
        // How long they have been waiting is public, because who gives way to whom
        // is decided by it (see agents/crowd.js).
        a.heldUp = this._heldUp;
      } else {
        this._heldUp = 0;
        a.heldUp = 0;
        // Moving again under their own power, so the next time they get stuck is
        // a fresh problem, not a continuation of this one — see _detour().
        this._detourTries = 0;
      }

      // Held up: go round. Note the wait is *not* reset by re-routing — it is what
      // settles who goes first when two people are in each other's way (see
      // agents/crowd.js), and clearing it on every attempt is how a group could
      // deadlock in a doorway indefinitely, each politely waiting for the others.
      if (this._heldUp >= this._nextDetour) {
        this._nextDetour = this._heldUp + HELD_UP_DETOUR;
        this._detour();
      }

      // Only now, and only for the genuinely impossible.
      if (this._heldUp >= HELD_UP_ABANDON) return finish();

      // Somebody in the way is waited for, not walked into: they stop, still facing
      // where they are going, and set off again the moment the way clears. A queue
      // at the coffee machine is this and nothing more. Merely being slowed down is
      // different — they keep walking into it, and look like somebody pushing
      // through a crowd, because that is what they are doing.
      if (blocked) {
        a.faceDirection(dx, dz);
        a.update(dt, { moving: false });
        return false;
      }

      a.setPositionXZ(pos.x + ux * step, pos.z + uz * step);
      a.faceDirection(dx, dz);
    }
    a.update(dt, { moving: true });
    return false;
  }

  /**
   * The heading that points this agent at `target`, matching Agent.faceDirection:
   * rotation 0 faces +z, so the arguments to atan2 go (dx, dz) in that order.
   */
  _headingTo(target) {
    const to = typeof target === 'function' ? target() : target;
    const pos = this.agent.root.position;
    const dx = to.x - pos.x;
    const dz = to.z - pos.z;
    // Standing exactly on the thing leaves no direction to face, so keep the current
    // heading rather than snapping to an arbitrary one.
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return this._faceFrom;
    return Math.atan2(dx, dz);
  }

  /**
   * Held up: look for a way round the people in the way, and take it.
   *
   * Nobody waits for a colleague they could walk around, so waiting is what is left
   * when there is no way past — a lane too narrow for two, or the last step to a
   * machine somebody else is standing at. That is exactly when a queue is the right
   * behaviour, so the queue survives by being the only thing left rather than by
   * being asked for.
   *
   * The look radius widens with each attempt in a row that hasn't worked (see
   * DETOUR_LOOK_GROWTH): a route that dodges the nearest few people and still
   * runs straight back into a holdup is telling you the crowd is bigger than the
   * radius it was drawn from, and retrying that same radius forty times over is
   * just a slow way of finding HELD_UP_ABANDON.
   */
  _detour() {
    const look = DETOUR_LOOK
      * (1 + Math.min(this._detourTries, DETOUR_LOOK_MAX_TRIES) * DETOUR_LOOK_GROWTH);
    this._detourTries++;

    const around = [];
    for (const other of this.crowd?.() ?? []) {
      if (other === this.agent || other.seated) continue;
      const dx = other.position.x - this.agent.position.x;
      const dz = other.position.z - this.agent.position.z;
      if (Math.hypot(dx, dz) > look) continue;
      around.push(other.position);
    }

    // The way round if there is one; failing that a fresh route by the direct way,
    // because the room is unchanged but where they are standing in it is not.
    const path = (around.length
      && this.nav.findPath(this.agent.position, this._goal, { avoid: around }))
      || this.nav.findPath(this.agent.position, this._goal);
    if (!path || !path.length) return;

    this._path = path;
    this._pathIndex = 0;
    this._lastDist = null;
  }

  _stepFace(a, dt) {
    const FACE_TIME = 0.28;
    this._faceT += dt;
    const t = Math.min(1, this._faceT / FACE_TIME);
    this.agent.setRotation(this._faceFrom + shortestTurn(a._to - this._faceFrom) * t);
    this.agent.update(dt, { moving: false });
    return t >= 1;
  }

  /**
   * Swivel a desk chair, and whoever is sitting in it.
   *
   * The seat point never moves — a task chair turns about its post — so this is a
   * rotation and nothing else. Turning the occupant in step is what makes it read as
   * one movement: a person swinging round to their monitors, rather than a chair
   * revolving under a body that stares straight ahead.
   */
  _stepTurnChair(a, dt) {
    a._elapsed += dt;
    const k = Math.min(1, a._elapsed / a.seconds);
    const eased = smoothstep(k);                // a push, then a stop
    const y = a._from + shortestTurn(a._to - a._from) * eased;
    a.desk.setChairFacing?.(y);
    if (this.agent.seated) this.agent.setRotation(y);
    this.agent.update(dt, { moving: false });
    return k >= 1;
  }
}

/** The short way round to a heading: a quarter turn left, never three right. */
function shortestTurn(delta) {
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

// ---------------------------------------------------------------------------
// Action builders — small helpers so behaviours read like a script.

/** @param {THREE.Vector3|(() => THREE.Vector3)} target resolved as the walk starts */
export const walk = (target, status = 'walking') => ({ kind: 'walk', target, status });
/** @param {number|(() => number)} rotation heading, resolved as the turn starts */
export const face = (rotation) => ({ kind: 'face', rotation });

/**
 * Turn to look at a point, from wherever the agent is actually standing.
 *
 * The difference from `face` is the whole reason this exists. A station carries one
 * `lookRotation`, correct for somebody stood squarely at its approach point — but a
 * shared machine hands out places to either side of that point (agents/crowd.js), and
 * a fixed heading has the second and third arrivals staring at the wall alongside the
 * coffee machine rather than at it. Resolved when the turn begins, so it uses where
 * the walk actually ended rather than where it was aimed.
 *
 * @param {{x: number, z: number}|(() => {x: number, z: number})} target
 */
export const lookAt = (target) => ({ kind: 'face', at: target });
/**
 * Sit down.
 *
 * `position` is optional and worth giving when the seat is a real place rather
 * than wherever the agent happens to be standing: it settles them exactly on the
 * cushion, so a nudge from the crowd on the way in cannot leave somebody sitting
 * on the arm (see agents/crowd.js).
 */
/** How long the step back to the seat takes, before any folding starts. */
const SIT_STEP_SECONDS = 0.4;

/**
 * How close to the seat the stride stops, in world units.
 *
 * Measured as a distance rather than a fraction of the step, because what it is
 * protecting against is a distance: a swinging leg reaches behind the body, this step
 * is backwards towards furniture, and how much of the step is left is the only thing
 * that says whether that reach lands in the couch. A fraction would mean a long
 * approach settled early and a short one settled far too late.
 *
 * The margin it buys is small, and meant to be. The standing spot is where the feet
 * have to be, so the clearance between a settled shin and the couch's front panel is
 * fixed by the furniture at about five centimetres; what this distance protects is the
 * last of the leg swing eating into it, and that is worth eight millimetres of the
 * five. Measured across four hundred random starting phases — `Agent` begins its walk
 * cycle at a random point, which is exactly why the old fraction-based cutoff clipped
 * the couch about one run in ten and passed the test the other nine.
 */
const SIT_STEP_SETTLE = 0.75;

/**
 * Where somebody stands to sit down: the spot their own feet will occupy afterwards.
 *
 * Sitting folds the foot forward on the end of the thigh by `footReach`, so a seat and
 * the standing room for it are exactly that far apart — stand here, fold, and the feet
 * have not moved while the hips have travelled back and down onto the cushion.
 *
 * @param {{x: number, z: number}} position  the seat itself
 * @param {number} rotation  the heading they will be sitting at
 */
export function seatStand(position, rotation) {
  const reach = footReach(1);
  return new THREE.Vector3(
    position.x + Math.sin(rotation) * reach,
    0,
    position.z + Math.cos(rotation) * reach,
  );
}

export const sit = (rotation, seatHeight, position = null, seconds = SIT_SECONDS) =>
  ({ kind: 'sit', rotation, seatHeight, position, seconds });

/**
 * One pace to a point, in a straight line, with no path found for it.
 *
 * For the step into a seat or out of one, where the destination is inside the
 * furniture on purpose. Pathfinding is no use there and actively harmful: a route
 * to blocked floor aims at the nearest free cell instead, which is how people came
 * to walk round the floor lamp and in through the arm of the couch. Short by
 * design — it is a step, not a walk, and it does not consult the room.
 */
export const stepTo = (target, seconds = 0.45) => ({ kind: 'stepTo', target, seconds });

/**
 * Walk a fixed line of points, heights included, with no path found for it.
 *
 * For the flight of stairs outside a first-floor door (scene/approach.js). The nav grid
 * is one flat plane and cannot express a climb, and there would be nothing to find in
 * any case: a flight of stairs is a route, not a choice. `stepTo` is the same idea for
 * a single pace on the level.
 *
 * The default speed is a fraction under a walk, because that is what stairs are. The
 * courier, who runs up them, is not an agent and keeps his own timings in
 * scene/courier.js.
 *
 * @param {Array<{x: number, y?: number, z: number}>} points  walked in order
 */
export const follow = (points, { speed = WALK_SPEED * 0.66, status = 'walking' } = {}) =>
  ({ kind: 'follow', points, speed, status });

/**
 * A name for the flight a route runs over, the same one from either end.
 *
 * A staircase is published as two arrays — `route` up it and `descent` down — and
 * whoever is on one has to be visible to whoever is about to start the other. Naming
 * it by its two ends, in a fixed order, gives both arrays the same name without
 * anybody having to pass an id around and keep it honest. Rounded, because these are
 * the same numbers either way and only ever compared for equality.
 */
function flightKey(points) {
  const ends = [points[0], points[points.length - 1]]
    .map((p) => `${p.x.toFixed(2)},${(p.y ?? 0).toFixed(2)},${p.z.toFixed(2)}`)
    .sort();
  return ends.join('|');
}

/** Which way this route runs over that flight: 1 climbing, -1 descending. */
function flightDirection(points) {
  const rise = (points[points.length - 1].y ?? 0) - (points[0].y ?? 0);
  return rise < 0 ? -1 : 1;
}

/**
 * Get up. Holds until they are on their feet — see `_stepStand` — so that whatever
 * follows starts from a standing character rather than a rising one.
 */
export const stand = () => ({ kind: 'stand' });

/**
 * Swing a desk chair round to a heading, taking its occupant with it.
 *
 * Both halves of sitting down at a desk: the quarter turn that gets the chair out of
 * the way of somebody arriving, and the turn back to the monitors once they are in
 * it. Brisk — it is a spin of a chair on castors, not a piece of choreography, and
 * anything statelier makes sitting down look like an event.
 *
 * @param {{chairFacing: number, setChairFacing: (y: number) => void}} desk
 * @param {number|(() => number)} to  heading for the seat, resolved as the turn starts
 */
export const turnChair = (desk, to, seconds = 0.2) =>
  ({ kind: 'turnChair', desk, to, seconds });
export const wait = (duration, anim) => ({ kind: 'wait', duration, anim });
/** Hold until `predicate()` is true, giving up after `timeout` seconds. */
export const waitUntil = (predicate, timeout = 14, anim) =>
  ({ kind: 'until', predicate, timeout, anim });
export const status = (s) => ({ kind: 'status', status: s });
/** `item` is a kind, or a function returning one when the action runs. */
export const carry = (item, opts) => ({ kind: 'carry', item, opts });
export const act = (fn) => ({ kind: 'do', fn });

export const vec = (p) => new THREE.Vector3(p.x, 0, p.z);
