import * as THREE from 'three';
import { COLORS, DOOR } from '../config.js';
import { lerp, smoothstep } from '../ease.js';
import { clamp01 } from '../measure.js';
import { STATIONS, landingsFor } from '../layout.js';
import { box, group, put } from './build.js';

// Some work arrives by hand. A courier comes to the door, takes a couple of paces
// into the room, lobs the parcel onto the pile beside the mailbox and goes back to
// the van you never see.
//
// How they get to the door is the entrance's business, and every entrance ends in
// the same place — two paces inside, where they can actually be seen:
//
//   stoop     round the corner of the building, along the wall and up onto it
//   stairs    along the pavement a storey below, and up the flight at a run
//   elevator  up in the car, then out of it onto the office floor
//
// All three are one route: a list of points, some with their own speed, walked
// forwards on the way in and backwards on the way out. That is the whole of the
// difference between them, which is why adding the flight did not add a phase.
//
// This is the package half of job delivery; letters keep the paper dart through
// the window in scene/mail.js. The two channels have the same shape on purpose —
// `launch(payload)` returning false when saturated, `onArrive(payload)` on
// touchdown — so the agent layer routes on size and cares about nothing else.
//
// One delivery runs at a time. A courier is a person, and two of them overlapping
// in the same doorway looks like a bug even when the queue is honest; anything
// asked for mid-round waits its turn.

// Fallback off-stage, used only when there is no entrance scenery to walk in from.
// `AT_DOOR` is on the landing, and `INSIDE` is the delivery itself.
const OFF_STAGE = { x: DOOR.x + 4.6, z: -5.4 };
const AT_DOOR = { x: DOOR.x + 0.1, z: -1.85 };

// Two paces past the threshold. Far enough in to be seen in the round rather than
// as a silhouette in the doorway, near enough that this is still a delivery at the
// door and not a visit — and clear of the coat stand at (5.8, 1.4) and the bin's
// approach at (2.6, 2.2), so the pace in lands on open floor.
const INSIDE = { x: DOOR.x - 0.25, z: 1.5 };

// Some offices open onto a lift instead of a street. The car *is* the way up, so
// there is no approach to walk: they ride it, step out onto the floor, and step
// back in when they are done.
const IN_CAR = { x: DOOR.x, z: -1.05 };

// How long to wait for the car. Bounded on purpose, and for the same reason the wait
// at the mailbox is: if the lift never comes the parcel still has to arrive, because
// the office is allowed to fall behind reality but never to lose a request.
const LIFT_WAIT = 6;

// Speeds, in units per second.
//
// The walk is deliberately brisk — twice what it was, and half again what an agent
// manages (`WALK_SPEED` is 6.4). Couriers do not amble: the round is the job, and a
// delivery man who strolls in reads as someone who works here.
//
// The other two are pinned to it rather than set independently, because what sells
// them is the *ratio*. Stairs are taken faster than the flat, and the pace through
// the doorway is slower than the approach because it is a step, not more walking; at
// these absolute speeds a smaller multiple than before is enough to read as either.
const WALK = 9.2;
const RUN = WALK * 1.35;
const STEP = WALK * 0.43;

// Radians of leg swing per unit walked, so the cadence comes from the pace: the same
// stride length carried faster is simply more steps a second. Wound back as the walk
// sped up — 2.0 at this pace was a blur of legs rather than a stride.
const STRIDE = 1.5;

// How far ahead of the doorway to ask for the door, so the leaf is already moving
// when they reach it rather than being shoved open from a standstill.
const DOOR_LEAD = 0.9;

// Seconds for the wind-up, while the door is still swinging. The throw itself is
// timed off the distance it has to cover (see `_beginThrow`).
const HEAVE = 0.45;

// The parcel leaves the courier's hands at shoulder height, in front of where they
// are standing when they throw.
const THROW_FROM = { x: INSIDE.x - 0.15, y: 2.0, z: INSIDE.z + 0.6 };

const PARCEL = 0.5;   // matches the pile and the carried package

// Hugged to the chest, at the height an agent carries the same box (`Agent.package`),
// so a parcel handed over does not change size or height in the process.
const CARRY_Y = 1.25;
const QUEUE_MAX = 8;

/** How many parcels are drawn lying beside a station that has no pile of its own. */
const DROPPED_SLOTS = 3;

/**
 * A blocky courier in brown. Read at this camera distance, not up close.
 *
 * Built to the **same measurements as an agent** (`Agent._buildBody`): hips at 0.9,
 * a 0.8 x 1.0 x 0.5 torso at 1.4, shoulders at 1.78 and a 0.62 head at 2.2, for a
 * 2.5-tall character. He used to be a two-thirds-scale version of all of that, which
 * made a grown man delivering to an office look like a child on the doorstep — the
 * one place in the scene where two human figures stand next to each other and the
 * mismatch has something to be measured against.
 *
 * He is not an Agent, though, and should not be: no name tag, no status ring, no work
 * log, no crowd. He is scenery that walks.
 */
export function buildCourier() {
  const g = group(0, 0, 0);

  // Legs, one pair of blocks swinging from the hip. Simpler than an agent's
  // thigh-and-shin pair, which exists to sit down; this one only ever walks.
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = group(side * 0.18, 0.9, 0);
    put(leg, box(0.3, 0.9, 0.3, 0x3f3a36, { rough: 0.85 }), 0, -0.45);
    put(leg, box(0.3, 0.12, 0.44, 0x22262b, { rough: 0.7 }), 0, -0.84, 0.08);
    g.add(leg);
    legs.push(leg);
  }

  // Torso in courier brown, with the shorts-and-shirt break the uniform is known
  // for suggested by a darker band at the waist.
  put(g, box(0.8, 1.0, 0.5, COLORS.courier, { rough: 0.8 }), 0, 1.4);
  put(g, box(0.82, 0.12, 0.52, 0x2e2a26, { rough: 0.8, cast: false }), 0, 1.0);

  // Head and a peaked cap, which is what says courier rather than colleague.
  put(g, box(0.62, 0.62, 0.62, 0xd7a87f, { rough: 0.9 }), 0, 2.2);
  put(g, box(0.66, 0.18, 0.64, COLORS.courier, { rough: 0.8 }), 0, 2.58);
  put(g, box(0.58, 0.07, 0.22, 0x4f382a, { rough: 0.8, cast: false }), 0, 2.53, 0.42);

  // Arms on a shared pivot at the shoulders, so the whole throw is one rotation.
  const arms = group(0, 1.78, 0);
  for (const side of [-1, 1]) {
    put(arms, box(0.22, 0.8, 0.22, COLORS.courier, { rough: 0.8 }), side * 0.52, -0.4, 0.1);
    put(arms, box(0.2, 0.18, 0.2, 0xd7a87f, { rough: 0.6, cast: false }), side * 0.52, -0.86, 0.1);
  }
  g.add(arms);

  g.visible = false;
  return { obj: g, legs, arms };
}

/** The parcel itself, in the courier's hands and then in the air. */
export function buildParcel() {
  const g = group(0, 0, 0);
  g.add(box(PARCEL, PARCEL, PARCEL, COLORS.parcel, { rough: 0.9 }));
  // Narrow tape and a small label, for the reason given on the pile in props.js:
  // seen from above, a wide pale band is most of the box.
  g.add(box(PARCEL * 0.13, PARCEL + 0.006, PARCEL + 0.006, COLORS.parcelTape, {
    rough: 0.8, cast: false,
  }));
  const label = box(PARCEL * 0.22, 0.004, PARCEL * 0.16, 0xe8e0cd, {
    rough: 0.9, cast: false,
  });
  label.position.set(-PARCEL * 0.22, PARCEL / 2 + 0.004, PARCEL * 0.2);
  g.add(label);
  g.visible = false;
  return g;
}

/**
 * A walked route: points in space, each carrying the speed of the leg that arrives
 * at it, timed once so every frame is a lookup rather than a decision.
 *
 * Legs run at a constant speed instead of easing across the whole trip, because the
 * speeds *are* the performance — a run up the flight between a walk along the
 * pavement and a step through the door. Easing the lot would flatten the three back
 * into one.
 */
class Route {
  /** @param {Array<{x: number, y?: number, z: number, speed?: number}>} points */
  constructor(points) {
    this.points = points;
    this.legs = [];
    this.seconds = 0;
    let covered = 0;

    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const length = Math.hypot(b.x - a.x, (b.y ?? 0) - (a.y ?? 0), b.z - a.z);
      const seconds = length / (b.speed ?? WALK);
      this.legs.push({ a, b, length, seconds, from: this.seconds, covered });
      this.seconds += seconds;
      covered += length;
    }

    this.length = covered;
    // When the last leg begins — the pace through the doorway, which is what the
    // door has to be open for.
    this.entersAt = this.legs.length ? this.legs[this.legs.length - 1].from : 0;
  }

  /**
   * Where the walker is at time `t`, written into `out` to keep the frame free of
   * allocation. `heading` is null on a leg with nowhere to go, so a walker holds
   * whatever way they were already facing rather than snapping to due north.
   */
  at(t, out) {
    const legs = this.legs;
    if (!legs.length) {
      const p = this.points[0];
      out.position.set(p.x, p.y ?? 0, p.z);
      out.heading = null;
      out.distance = 0;
      return out;
    }

    let leg = legs[legs.length - 1];
    for (const l of legs) {
      if (t < l.from + l.seconds) { leg = l; break; }
    }

    const k = leg.seconds > 0
      ? clamp01((t - leg.from) / leg.seconds)
      : 1;
    const { a, b } = leg;
    out.position.set(
      lerp(a.x, b.x, k),
      lerp(a.y ?? 0, b.y ?? 0, k),
      lerp(a.z, b.z, k),
    );
    out.heading = leg.length > 1e-4 ? Math.atan2(b.x - a.x, b.z - a.z) : null;
    out.distance = leg.covered + leg.length * k;
    return out;
  }

  /**
   * The same route walked the other way.
   *
   * A speed belongs to the leg that arrives at a point, so reversing the points
   * would hand every leg the speed of the one before it — the run down the flight
   * would be taken at the pavement's walk, and the step through the door at a run.
   * Each point therefore inherits the speed of the point that followed it.
   */
  reversed() {
    const p = this.points;
    const last = p.length - 1;
    return new Route(p.map((_, i) => ({ ...p[last - i], speed: p[last - i + 1]?.speed })));
  }
}

export class CourierDeliveries {
  /**
   * @param {THREE.Object3D} scene
   * @param {object} [props]  the prop handles. `mailbox` gives the landing point,
   *   `door` is asked to open, and the entrance-specific ones choose the way in:
   *   `elevator` when the office opens onto a lift, `stairs` when it is up a flight,
   *   `stoop` when the door opens onto the street (see scene/approach.js). All
   *   optional: with none of them, deliveries still complete on time so the post model
   *   never stalls waiting on scenery.
   */
  constructor(scene, {
    boxAt = null, door = null, elevator = null, stairs = null, stoop = null,
  } = {}) {
    // Looks a post box's prop up by id: which box he throws at is decided per delivery
    // and carried on the payload, so this cannot be a handle settled at build time.
    this.boxAt = boxAt;
    this.door = door;
    this.elevator = elevator;
    this.stairs = stairs;
    this.stoop = stoop;
    /** Set by the agent layer: called with the payload as the parcel lands. */
    this.onArrive = null;

    this.root = group(0, 0, 0);
    scene.add(this.root);

    const courier = buildCourier();
    this.courier = courier.obj;
    this.legs = courier.legs;
    this.arms = courier.arms;
    this.root.add(this.courier);

    this.parcel = buildParcel();
    this.root.add(this.parcel);

    /**
     * Parcels lying where they were thrown, for a station with no pile of its own.
     *
     * The post box has its own — modelled beside the tube, drawn from the post model
     * (`parcels` in props/mailbox.js) — and until parcels could land anywhere that was
     * the only case there was. A printer and a stack of cartons have nowhere to put one,
     * so the box simply disappeared on touchdown: `onArrive` hides the thrown parcel and
     * hands over to a pile that, for those two, does not exist.
     *
     * Owned by the delivery channel rather than added to each prop, because it is a fact
     * about the *delivery* and not about the furniture: what it draws is "a parcel is
     * waiting here", at the spot this courier put it. Three is plenty — past that another
     * box says nothing the first three did not, exactly as the mailbox's five do.
     */
    this.dropped = [];
    for (let i = 0; i < DROPPED_SLOTS; i++) {
      const box3 = buildParcel();
      box3.visible = false;
      this.root.add(box3);
      this.dropped.push(box3);
    }
    /** Which station the dropped pile is currently drawn beside. */
    this._droppedAt = null;

    /** Payloads waiting for the courier to come back round, oldest first. */
    this.waiting = [];

    this.phase = 'idle';
    this.t = 0;
    this.payload = null;

    /** Walked in on the way to the throw, and reversed on the way back out. */
    this.route = null;

    this.target = new THREE.Vector3();
    this.relocate();

    this._pos = new THREE.Vector3();
    this._at = { position: new THREE.Vector3(), heading: null, distance: 0 };
  }

  /**
   * Where the throw is aimed: the pile beside the mailbox.
   *
   * Its own method for the same reason MailFlights.relocate() is — the mailbox can be
   * dragged across the room, and a target cloned once at build time would have the
   * courier lobbing parcels at the floor where the box used to stand. Updated in
   * place, so a throw already in flight lands where the box is now.
   */
  relocate() {
    // Re-aimed at the box this parcel is for, wherever that box is now: he carries one
    // at a time, so unlike the planes there is only ever one throw to fix.
    this._aim(this.payload?.box ?? null);
  }

  /** Keep payloads and throws alive when the entrance around the courier changes. */
  redecorate(next, previous) {
    const changed = Boolean(previous.elevator) !== Boolean(next.elevator)
      || JSON.stringify(previous.stairs?.route) !== JSON.stringify(next.stairs?.route)
      || JSON.stringify(previous.stoop?.route) !== JSON.stringify(next.stoop?.route);
    for (const key of ['door', 'elevator', 'stairs', 'stoop']) this[key] = next[key] ?? null;
    if (!changed || !this.busy) return;

    if (this.phase === 'approach' || this.phase === 'summon') {
      // An old flight of stairs or shaft is gone. Finish the current delivery
      // from the inner landing, with the same parcel and pending queue. This
      // remains solid floor even when the new lift car is on another storey.
      this.route = new Route([{ ...INSIDE, y: 0 }]);
      this.phase = 'approach';
      this.t = 0;
      this._place(INSIDE.x, 0, INSIDE.z);
      this._parcelToHands();
    } else if (this.phase === 'leave') {
      this.route = this._approach().reversed();
      this.t = 0;
      this._place(INSIDE.x, 0, INSIDE.z);
    } else {
      // Heaving or throwing: keep the throw's timing and use the new way out
      // once it lands. onArrive is still called only at touchdown.
      this.route = this._approach();
    }
    this.relocate();
  }

  /**
   * Where the parcel is going, out of the box named on the payload.
   *
   * Named there rather than decided here, because the manager drew the box once as it
   * posted: two independent draws would eventually send the courier to one box and the
   * envelope to another.
   */
  _aim(boxId) {
    const handle = boxId ? this.boxAt?.(boxId) : null;
    // No `?? STATIONS.mailbox`. That fallback was safe for exactly as long as the
    // mailbox could not be deleted, and the printer was then given both of the post's
    // jobs — so the post became removable and `STATIONS.mailbox` became `undefined`,
    // which this line then read `.x` off. In the courier's case that threw *in the
    // constructor*, so a room with no post box did not render at all: a black screen
    // rather than a missing parcel.
    //
    // A missing box is now a real answer and the caller checks for it. Nothing should
    // reach here without one — `landingsFor()` closes a channel with nowhere to land —
    // but "nothing should" is what the old fallback assumed too.
    const station = boxId ? STATIONS[boxId] : null;
    if (handle?.pile) return this.target.copy(handle.pile);
    // In front of whatever it is, rather than in a slot on it. Which is the whole of
    // what a parcel needs and the reason it can land anywhere work arrives: only the
    // post box has a pile modelled into it, and a box put down beside a printer or a
    // stack of cartons is a box put down beside them (see PARCEL_PREFERENCE).
    if (station) return this.target.set(station.x, PARCEL * 0.6, station.z + 1.25);
    // No box named on the payload, which the manager always stamps — so this is a
    // caller that did not, and the honest answer is the spot the manager would have
    // drawn: the best-preferred landing this room has. Aiming at the origin instead
    // (the old behaviour once the mailbox fallback went) threw the parcel into the
    // corner of the floor, which looks like a bug because it is one.
    const [best] = landingsFor('package');
    if (best) return this.target.set(best.x, PARCEL * 0.6, best.z + 1.25);
    // Nowhere at all. `launch` refuses, so nothing is ever thrown from here.
    return this.target;
  }

  /** Whether there is anywhere for a parcel to be put down. */
  get canDeliver() { return STATIONS && landingsFor('package').length > 0; }

  /**
   * Draw the parcels waiting beside a station that has no pile of its own.
   *
   * Told rather than counted, on the same terms as the mailbox's own pile: the post
   * model is the only thing that knows what is waiting, and a channel keeping its own
   * tally would be a second answer free to disagree with the first.
   *
   * One station at a time, which is all the room can produce: `landingsFor('package')`
   * returns the best-preferred *kind* present, so parcels go to mailboxes or to printers
   * or to inboxes and never to two of those at once. A change of station clears the old
   * pile, so nothing is left lying beside furniture that is no longer receiving.
   *
   * @param {?string} id     the station, or null to clear
   * @param {number} count   parcels waiting there
   */
  showDropped(id, count = 0) {
    if (id !== this._droppedAt) {
      for (const box3 of this.dropped) box3.visible = false;
      this._droppedAt = id;
    }
    const station = id ? STATIONS[id] : null;
    for (let i = 0; i < this.dropped.length; i++) {
      const box3 = this.dropped[i];
      const show = Boolean(station) && i < count;
      box3.visible = show;
      if (!show) continue;
      // Beside it and a little scattered, the way thrown boxes come to rest — not
      // stacked square, which would read as somebody having tidied them.
      const flip = i % 2 ? 1 : -1;
      box3.position.set(
        station.x + flip * (0.35 + i * 0.12),
        PARCEL * 0.6,
        station.z + 1.25 + (i % 3) * 0.28,
      );
      box3.rotation.y = flip * (0.2 + i * 0.15);
    }
  }

  /**
   * Send a package out for delivery.
   *
   * @param {*} payload  handed to `onArrive` as the parcel lands, so the office
   *   announces the work at the moment it thumps down.
   * @return {boolean} false only if the waiting list is full
   */
  launch(payload = null) {
    // Nowhere to put it down: no round. Said here as well as upstream because a
    // courier who sets off for a room with no landing spot walks in, heaves, and
    // throws a parcel at the floor — and that used to be a crash rather than a shrug.
    if (!payload?.box && !this.canDeliver) return false;
    if (this.phase !== 'idle') {
      if (this.waiting.length >= QUEUE_MAX) return false;
      this.waiting.push(payload);
      return true;
    }
    this._begin(payload);
    return true;
  }

  /** True while a delivery is running, for anything that wants to know. */
  get busy() { return this.phase !== 'idle'; }

  _begin(payload) {
    this.payload = payload;
    this._aim(payload?.box ?? null);
    this.t = 0;
    this.courier.visible = true;
    this.parcel.visible = true;
    this.arms.rotation.x = 0;

    this.route = this._approach();

    if (this.elevator) {
      this.phase = 'summon';
      this.elevator.call();
      // Down in the shaft with the car, so the ride up is the approach.
      this._place(IN_CAR.x, this.elevator.carY, IN_CAR.z);
      this.courier.rotation.y = 0;      // facing into the room
      this._parcelToHands();
      return;
    }

    this.phase = 'approach';
    const start = this.route.points[0];
    this._place(start.x, start.y ?? 0, start.z);
    this.courier.rotation.y = this.route.at(0, this._at).heading ?? 0;
    this._parcelToHands();
  }

  /** The way in, whichever entrance this office has. */
  _approach() {
    if (this.elevator) {
      // The car does the climbing. All that is left to walk is the pace out of it.
      return new Route([{ ...IN_CAR, y: 0 }, { ...INSIDE, y: 0, speed: STEP }]);
    }

    if (this.stairs) {
      const f = this.stairs;
      const [pad, bottom, top, landing] = f.route;
      return new Route([
        // In along the pavement, a storey below the floor being delivered to.
        { x: f.xPad + f.tread * 5, y: f.groundY, z: f.z },
        { ...pad },
        // Up the flight at a run. Two points, because the pitch is constant and the
        // line through the tread noses is the flight itself (see scene/approach.js).
        { ...bottom, speed: RUN },
        { ...top, speed: RUN },
        { ...landing },
        { ...INSIDE, y: 0, speed: STEP },
      ]);
    }

    if (this.stoop) {
      // Round the outside corner of the building, along the wall and up onto the
      // landing. The step up off the pavement is taken at a step's pace.
      const [corner, edge, up, landing] = this.stoop.route;
      return new Route([
        { ...corner },
        { ...edge },
        { ...up, speed: STEP },
        { ...landing },
        { ...INSIDE, y: 0, speed: STEP },
      ]);
    }

    // No scenery to go on: straight in off the street, so a delivery still completes
    // on time and the post model never stalls waiting for a handle.
    return new Route([
      { ...OFF_STAGE, y: 0 },
      { ...AT_DOOR, y: 0 },
      { ...INSIDE, y: 0, speed: STEP },
    ]);
  }

  _place(x, y, z) { this.courier.position.set(x, y, z); }

  /** Turn toward the way they are walking, rather than snapping at every corner. */
  _face(heading, dt) {
    if (heading == null) return;
    let delta = heading - this.courier.rotation.y;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.courier.rotation.y += delta * Math.min(1, dt * 9);
  }

  /** Parcel held in front of the chest, riding along with the courier. */
  _parcelToHands() {
    const c = this.courier.position;
    const r = this.courier.rotation.y;
    // In front of them, wherever they happen to be facing. Held square to +z, it
    // floated off to one side the moment they turned to climb the stairs.
    this.parcel.position.set(c.x + Math.sin(r) * 0.5, c.y + CARRY_Y, c.z + Math.cos(r) * 0.5);
    this.parcel.rotation.set(0, r, 0);
  }

  /**
   * Hold whatever is in the doorway open.
   *
   * Renewed every frame rather than booked for a duration, because how long the
   * courier is inside depends on a throw whose length depends on the room. A lift's
   * landing doors answer the same call (they are the same handle), and asking also
   * summons the car — which is exactly what is wanted while standing on its floor.
   */
  _holdDoor() { this.door?.requestOpen(0.4); }

  update(dt) {
    if (this.phase === 'idle') {
      // Next in the queue only once the last courier is out of the room, so the
      // doorway is never shared.
      if (this.waiting.length) this._begin(this.waiting.shift());
      return;
    }

    this.t += dt;

    if (this.phase === 'summon') {
      this._holdDoor();
      // Ride the car up rather than appearing at the top of the shaft.
      this._place(IN_CAR.x, this.elevator.carY, IN_CAR.z);
      this._parcelToHands();
      this._stepLegs(0);
      if (this.elevator.ready || this.t >= LIFT_WAIT) {
        // If the wait ran out, step out onto the floor and throw anyway: better a
        // parcel through a shut door than a request that never turns up.
        this.phase = 'approach';
        this.t = 0;
      }
      return;
    }

    if (this.phase === 'approach') {
      if (this._walk(dt, this.route)) {
        // An appearance change may have shortened the arrival to the inner
        // landing. Keep the complete current route for the journey back out.
        this.route = this._approach();
        this.phase = 'heave';
        this.t = 0;
      }
      return;
    }

    if (this.phase === 'heave') {
      this._holdDoor();
      // Wind-up: arms come back over the shoulder while the door finishes swinging.
      const k = Math.min(1, this.t / HEAVE);
      this.arms.rotation.x = -1.5 * smoothstep(k);
      this._settleLegs();
      // Carry the parcel from the hands to the point it will leave from, in all three
      // axes. Easing only the height left it to jump the width of the doorway on the
      // first frame of the throw, which read as a glitch rather than a heave.
      const c = this.courier.position;
      const e = smoothstep(k);
      this.parcel.position.set(
        lerp(c.x, THROW_FROM.x, e),
        lerp(c.y + CARRY_Y, THROW_FROM.y, e),
        lerp(c.z + 0.5, THROW_FROM.z, e),
      );
      this.parcel.rotation.y = lerp(this.courier.rotation.y, 0, e);
      if (this.t >= HEAVE) this._beginThrow();
      return;
    }

    if (this.phase === 'throw') {
      this._holdDoor();
      const k = Math.min(1, this.t / this._throwSecs);

      // Arms snap through and settle back.
      this.arms.rotation.x = lerp(-1.5, 0.35, smoothstep(Math.min(1, k * 3)));

      // A flat parabola across the room: linear in plan, with a lobbed arc on top
      // of the straight line between the hands and the pile.
      const a = THROW_FROM;
      const b = this.target;
      const e = smoothstep(k) * 0.35 + k * 0.65;   // eases out of the hand, then coasts
      this._pos.set(
        lerp(a.x, b.x, e),
        lerp(a.y, b.y, e) + Math.sin(Math.PI * e) * this._throwArc,
        lerp(a.z, b.z, e),
      );
      this.parcel.position.copy(this._pos);
      // Tumbling, because a thrown box does.
      this.parcel.rotation.x = e * 3.4;
      this.parcel.rotation.y = e * 1.7;

      this._settleLegs();

      if (this.t >= this._throwSecs) {
        // Touchdown. Where the receiving station draws its own pile — the post box does
        // — all this has to do is stop drawing the one in the air and say it arrived.
        // Where it does not, `showDropped` takes over on the next frame and this one
        // still has to go, or there would be two boxes on the same square.
        this.parcel.visible = false;
        const { payload } = this;
        this.payload = null;
        this.route = this.route.reversed();
        this.phase = 'leave';
        this.t = 0;
        this.onArrive?.(payload);
      }
      return;
    }

    if (this.phase === 'leave') {
      // Arms come down as they go. The way out is the way in, reversed — back into
      // the lift car, down the flight, or off along the street.
      this.arms.rotation.x *= 0.85;
      if (this._walk(dt, this.route)) {
        this.courier.visible = false;
        this.phase = 'idle';
        this.t = 0;
      }
    }
  }

  /**
   * Cover a route, and say when it is done.
   *
   * @return {boolean} true on the frame the last point is reached
   */
  _walk(dt, route) {
    const at = route.at(this.t, this._at);
    this._place(at.position.x, at.position.y, at.position.z);
    this._face(at.heading, dt);
    this._parcelToHands();
    this._stepLegs(at.distance * STRIDE);
    // Ask for the door in time to walk through it, and keep asking while inside.
    if (this.t >= route.entersAt - DOOR_LEAD) this._holdDoor();
    return this.t >= route.seconds;
  }

  /**
   * Time and shape the throw for the distance it actually has to cover.
   *
   * Both used to be constants, tuned for a parcel launched from the threshold. Now
   * that it leaves from inside the room the throw is a good deal shorter, and the
   * old numbers made it a slow, towering lob across four units.
   */
  _beginThrow() {
    const reach = Math.hypot(this.target.x - THROW_FROM.x, this.target.z - THROW_FROM.z);
    this._throwSecs = Math.min(1.1, Math.max(0.55, reach / 5.5));
    this._throwArc = Math.min(2.4, Math.max(0.9, reach * 0.34));
    this.phase = 'throw';
    this.t = 0;
  }

  _stepLegs(phase) {
    const swing = Math.sin(phase) * 0.5;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
  }

  _settleLegs() {
    for (const leg of this.legs) leg.rotation.x *= 0.8;
  }
}
