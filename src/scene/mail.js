import * as THREE from 'three';
import { WINDOW_SILL_Y, WINDOW_HEAD_Y, windowSpan } from '../config.js';
import { STATIONS } from '../layout.js';
import { group } from './build.js';

// Incoming job delivery: a paper airplane darts in through the window on the
// beige (left) wall, banks across the room, and dives into the mailbox.
//
// Planes are pooled and reused so repeated arrivals allocate nothing.

const FLIGHT_TIME = 1.45;         // "quickly"
const POOL_SIZE = 4;

// Folded paper. An addressed plane is tinted towards its recipient's colour
// instead, so you can see from across the room who a request is *for* — the
// visual equivalent of a name on an envelope. Mixed rather than replaced, so it
// still reads as paper and not as a flying shirt.
const PAPER = 0xf7f4ea;
const ADDRESS_TINT = 0.55;

// Jobs asked for while every plane is airborne wait here for the next free one.
// Bounded only so a runaway feed can't grow it without limit; a person pressing
// the new-job key can't realistically get near this.
const QUEUE_MAX = 16;

// Derive the window opening from the layout config so the plane always enters
// through the actual glass, even if the window moves. It asks windowSpan() for
// the centre line rather than working it out: the left wall is built a quarter
// turn round, and multiplying the fraction out by hand put this entry point five
// units off, in the plaster between the window and the coffee machine.
function windowEntry() {
  const span = windowSpan('left', 0);
  return { x: -1.8, y: (WINDOW_SILL_Y + WINDOW_HEAD_Y) / 2 + 0.3, z: span.centre };
}

// The classic folded-dart shape, nose pointing along +z.
export function buildPaperPlaneMesh() {
  const nose = [0, 0, 0.95];
  const tail = [0, 0, -0.55];
  const tipL = [-0.6, -0.1, -0.5];
  const tipR = [0.6, -0.1, -0.5];
  const keel = [0, -0.26, -0.45];

  const tris = [
    nose, tail, tipL,     // left wing
    nose, tipR, tail,     // right wing
    nose, tipL, keel,     // left keel
    nose, keel, tipR,     // right keel
  ];

  const positions = new Float32Array(tris.length * 3);
  tris.forEach((v, i) => {
    positions[i * 3] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: PAPER,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

function cubicBezier(p0, p1, p2, p3, t, out) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  out.set(
    a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    a * p0.z + b * p1.z + c * p2.z + d * p3.z
  );
  return out;
}

export class MailFlights {
  constructor(scene, boxAt) {
    // Looks a box's prop up by id, because which box a plane dives into is decided per
    // delivery and carried on the payload. A function rather than a handle so a mailbox
    // added or dragged after this was built is still found.
    this.boxAt = typeof boxAt === 'function' ? boxAt : () => boxAt;
    // Set by the agent layer: called with the flight's payload on touchdown.
    this.onArrive = null;
    this.root = group(0, 0, 0);
    scene.add(this.root);

    // Payloads with no free plane yet, oldest first.
    this.waiting = [];

    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const plane = buildPaperPlaneMesh();
      plane.visible = false;
      this.root.add(plane);
      // Four control points apiece. They were shared while every letter went to the
      // same box, and that was the constraint that forced the old "each way in serves
      // the nearest box" rule; a curve per flight is what lets the box be drawn at
      // random per delivery instead.
      this.pool.push({
        mesh: plane,
        active: false,
        t: 0,
        payload: null,
        p0: new THREE.Vector3(),
        p1: new THREE.Vector3(),
        p2: new THREE.Vector3(),
        p3: new THREE.Vector3(),
      });
    }


    this._pos = new THREE.Vector3();
    this._prev = new THREE.Vector3();
  }

  /**
   * Lay out the flight path: in through the window, a sweep into the room, then a dive
   * into the mailbox slot.
   *
   * Its own method rather than four lines in the constructor because the mailbox can
   * move. The path is four fixed control points, computed once against where the slot
   * was — so a mailbox dragged across the room would go on receiving post at its old
   * address, planes diving into thin air. The furniture editor calls this after a drop
   * (see src/editor.js).
   *
   * The control points are updated in place, because a flight already in the air is
   * interpolating along these very vectors: replacing them would leave the plane
   * finishing its journey to the old slot.
   */
  relocate() {
    // Every flight still in the air, re-aimed at where its own box is *now*. A mailbox
    // dragged mid-flight would otherwise have the plane finish its journey to the old
    // address and dive into thin air, which is what this method has always been for —
    // it just has more than one path to fix now.
    for (const slot of this.pool) {
      if (slot.active) this._aim(slot, slot.payload?.box ?? null);
    }
  }

  /**
   * Lay one flight's path out: in through the window, a sweep into the room, then a
   * dive into the box this envelope is addressed to.
   *
   * The box comes off the payload rather than being drawn here. The manager draws it
   * once as it posts and stamps the answer on, so the plane and the envelope cannot end
   * up in different boxes — which two independent draws would eventually manage.
   */
  _aim(slot, boxId) {
    const entry = windowEntry();
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
    // A plane needs a slot to dive into, so unlike a parcel it cannot be left anywhere:
    // `landingsFor('letter')` narrows to stations serving `post` and closes the channel
    // when the room has none. If one gets this far anyway it flies to where it entered
    // and lands nowhere, which is a plane that goes nowhere rather than a crash.
    const target = handle?.slot
      ?? (station ? new THREE.Vector3(station.x + 0.6, 1.6, station.z) : entry);

    slot.p0.set(entry.x, entry.y, entry.z);
    slot.p1.set(7.0, entry.y + 0.8, entry.z - 1.6);
    slot.p2.set(7.5, target.y + 1.9, target.z + 1.5);
    slot.p3.copy(target);
  }

  /**
   * Send a new job flying in.
   *
   * If every plane is already airborne the job is held and sent the moment one
   * lands, rather than dropped: jobs can be requested faster than the flight
   * time (the `t` shortcut is one keypress) and losing one would look like the
   * office had swallowed it. Order is preserved.
   *
   * @param {*} payload  carried along and handed to `onArrive` on touchdown, so
   *                     the UI announces the job exactly as the plane lands.
   *                     `{ job, forId?, color? }` — `forId` addresses the
   *                     envelope to one agent, and `color` is theirs, used to
   *                     tint the plane in flight.
   * @return {boolean} false only if the waiting list is also full
   */
  launch(payload = null) {
    const slot = this.pool.find((p) => !p.active);
    if (!slot) {
      if (this.waiting.length >= QUEUE_MAX) return false;
      this.waiting.push(payload);
      return true;
    }
    this._send(slot, payload);
    return true;
  }

  /** Put a specific pooled plane at the start of the flight path. */
  _send(slot, payload) {
    slot.active = true;
    slot.t = 0;
    slot.payload = payload;
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(1);

    // Each pooled plane owns its material, so tinting one flight cannot bleed
    // into the next. Unaddressed post always returns to plain paper.
    const to = payload?.color;
    slot.mesh.material.color.set(PAPER);
    if (typeof to === 'number') slot.mesh.material.color.lerp(new THREE.Color(to), ADDRESS_TINT);
    this._aim(slot, payload?.box ?? null);
    cubicBezier(slot.p0, slot.p1, slot.p2, slot.p3, 0, slot.mesh.position);
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;

      this._prev.copy(p.mesh.position);
      p.t += dt / FLIGHT_TIME;

      if (p.t >= 1) {
        // Touchdown: tuck it into the mailbox and register the new job.
        p.active = false;
        p.mesh.visible = false;
        p.t = 0;
        const { payload } = p;
        p.payload = null;
        // Nothing to tell the mailbox: what it shows is read back off the post model
        // every frame, and `onArrive` is what puts this envelope into it.
        this.onArrive?.(payload);
        continue;
      }

      cubicBezier(p.p0, p.p1, p.p2, p.p3, p.t, this._pos);
      p.mesh.position.copy(this._pos);

      // Point the nose along the direction of travel.
      const dx = this._pos.x - this._prev.x;
      const dy = this._pos.y - this._prev.y;
      const dz = this._pos.z - this._prev.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > 1e-5) {
        p.mesh.rotation.y = Math.atan2(dx, dz);
        p.mesh.rotation.x = -Math.atan2(dy, horiz);
      }
      // A little roll wobble so it reads as paper, not a missile.
      p.mesh.rotation.z = Math.sin(p.t * Math.PI * 3) * 0.3;

      // Shrink slightly as it drops in, so it "posts" into the slot.
      if (p.t > 0.88) p.mesh.scale.setScalar(1 - (p.t - 0.88) / 0.12 * 0.5);
    }

    // Anything that was asked for while the pool was busy goes out now, in the
    // order it was requested. Launching after the loop rather than at touchdown
    // keeps a freed plane from being advanced twice in the same frame.
    while (this.waiting.length) {
      const slot = this.pool.find((p) => !p.active);
      if (!slot) break;
      this._send(slot, this.waiting.shift());
    }
  }
}
