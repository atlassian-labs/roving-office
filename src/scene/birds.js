// Post by bird: a letter carried in through the window, dropped into the box,
// and the courier flies home.
//
// A second *vehicle* for the letter channel, not a third kind of envelope.
// What lands in the box is a letter like any other — same mailbox tally, same
// thing in the collector's hand, same word in the log — because the bird is
// how the work travelled, and it is already settled that how work travels
// means nothing. The paper plane and the bird are one coin toss apart, and
// the toss is the manager's (see `_post`).
//
// Which bird is the one decision made here. The owl leads both shifts — three
// flights in four at night, half by day, because it being a night bird is a
// fact about owls rather than about the work and is allowed to mean what it
// says — and the pigeon, kookaburra and raven split what is left, evenly and
// per flight, so the sky stays varied and none of the three is rarer than the
// others for a reason nobody could see.
//
// The birds are built in the kit's own idiom — boxes and cones, flat-shaded —
// but anatomically: a chest and a tapered rump, a two-segment wing that
// sweeps back at the wrist, a fanned tail, legs tucked up for flight, and a
// beak that tells you the species across the room.
//
// Pooled and phased like MailFlights: in through the window along a bezier,
// a hover over the box while the letter drops, and a flight back out. The
// letter is its own mesh under the bird, tinted for its recipient the way an
// addressed plane is, so who a request is for survives the change of courier.

import * as THREE from 'three';
import { WINDOW_LIGHTS, windowLight } from '../config.js';
import { CHANNELS, STATIONS } from '../layout.js';
import { group } from './build.js';
import { worldClock } from '../time.js';

// One, because only one bird flies at a time (see `launch`). It stays a pool rather
// than a single field so the queue, the drain and `relocate` read the same as
// MailFlights' do, and so raising it is a one-line experiment if the birds ever get
// separate windows to come in through.
const POOL_SIZE = 1;

/*
 * The four beats of a flight, at 1.75× the speed they were first flown at.
 *
 * They were 2.1 / 0.7 / 1.7 / 0.32, and they read as sluggish for two reasons that
 * stacked. Threading the window shortened both curves — the old exit swung out over the
 * head rail, which was a longer way round — so at unchanged durations the bird lost 8%
 * of its speed on the way in and 19% on the way out. On top of that only one flies at a
 * time now, so a busy office queues them, and a letter waiting its turn reads as a slow
 * bird even though the flight itself has not changed.
 *
 * Scaled together rather than one at a time, because the drop is timed as a fraction of
 * the hover (`DROP_TIME / HOVER_TIME` in `update`) and the two have to stay in step. The
 * whole in-hover-out is 2.6 seconds now rather than 4.5, which also drains the queue
 * faster — the part of "slower" that was never about the animation.
 */
const IN_TIME = 1.2;             // still slower than the plane: wings, not a throw
const HOVER_TIME = 0.4;          // long enough to read the drop
const OUT_TIME = 0.97;
const DROP_TIME = 0.18;          // the letter's own fall into the slot

const PAPER = 0xf7f4ea;
const ADDRESS_TINT = 0.55;       // same mix as the plane, for the same reason
const QUEUE_MAX = 16;

/**
 * Where the letter rides: under the bird, in its talons.
 *
 * A constant rather than three numbers written out at each of the three places that
 * need them — the build, the launch and every frame of the fall. Never mutated; the
 * fall lerps *from* it into a scratch vector.
 */
const TALON_OFFSET = new THREE.Vector3(0, -0.32, 0.1);

/**
 * How far back the wings sweep to get through the window, and where.
 *
 * A bird with its wings out is about 3.1 across and the hole is 2.1, so it does not
 * fit — which is not a number to tune away but the reason the animation needs a
 * gesture it did not have. It tucks, which is what a bird crossing a gap does: wings
 * swept right back at the shoulder, one beat's worth of glide, out the other side.
 *
 * `FULL_BY` and `NONE_BY` are distances from the wall plane. Inside the first the
 * wings are all the way back; outside the second they are all the way out; between,
 * a smoothstep, so the tuck reads as one movement rather than a switch.
 */
const TUCK_SWEEP = 1.25;         // radians, ~72°
const TUCK_FULL_BY = 1.4;
const TUCK_NONE_BY = 3.6;

/** The wall the window is cut into. */
const WALL_X = 0;

// The owl flies at night. The band is the lamps' rather than astronomy's: it
// only has to agree with when the room looks like night.
const NIGHT_FROM = 19;
const NIGHT_TO = 7;

/**
 * How often a letter takes wing rather than flying in as a paper plane.
 *
 * One letter in three. The plane keeps the majority because it is the room's
 * oldest animation and the one the mailbox was built around, but a bird rare
 * enough to be a surprise is also rare enough to be missed, and a third is
 * often enough that anybody watching a busy office will see one.
 */
export const BIRD_SHARE = 1 / 3;

/**
 * The owl's share of flights, per shift.
 *
 * It has the night outright — three flights in four — because that is a fact
 * about owls rather than about the work, and the one thing in this whole
 * channel allowed to mean what it says. By day it keeps half: its
 * tawny-and-cream reads best against the room, and it is the bird people are
 * hoping for.
 *
 * Whatever is left over is split **evenly** between the other three, so the
 * pigeon, the kookaburra and the raven are equally uncommon. A weighted tail
 * would be three numbers to tune in exchange for a difference nobody watching
 * could detect.
 */
const OWL_SHARE = { night: 0.75, day: 0.5 };

/** The three who share what the owl leaves, in no particular order. */
const UNDERSTUDIES = ['pigeon', 'kookaburra', 'raven'];

export const BIRD_KINDS = ['owl', ...UNDERSTUDIES];

/**
 * Who flies this one, drawn per flight so the sky stays varied.
 *
 * @param {'night'|'day'} shift  which side of the lamps the clock is on
 * @param {() => number} [rng]   injectable so a flight can be pinned in a test
 */
export function rosterBird(shift, rng = Math.random) {
  if (rng() < OWL_SHARE[shift]) return 'owl';
  // Its own toss rather than a continuation of the first: reusing the roll's
  // remainder would correlate the understudy with how narrowly the owl missed,
  // which is a bias for the price of one fewer call to Math.random.
  const i = Math.floor(rng() * UNDERSTUDIES.length);
  return UNDERSTUDIES[Math.min(UNDERSTUDIES.length - 1, i)];
}

/**
 * Which hole in the window the birds use: the middle light of the top row.
 *
 * Middle so it is clear of both jambs, and top so the bird comes in above the desks
 * and descends to the box, which is the shape of the flight anyway. A *light* and not
 * the opening, because the opening is not a hole — three across and two up means two
 * mullions and a transom in the middle of it, and aiming at the centre of the whole
 * window aims at the transom.
 */
const LIGHT = { col: 1, row: WINDOW_LIGHTS.rows - 1 };

/** How far outside the wall a flight starts and ends. */
const OUTSIDE_X = -1.8;

/**
 * How far inside the wall the flight is still holding the light's own centre line.
 *
 * **Both** middle control points go here, which is what makes the crossing safe rather
 * than merely tuned. With them coincident on the line, the curve's drift off it is the
 * cubic's last term alone — `t³` — so by the time the bird's tail is out of the frame
 * the bend has barely started, whatever the box's position does to the far end of the
 * curve. A single control point on the line was not enough: the bend was already
 * underway with the tail still in the opening, and the wingtip cleared the near mullion
 * by −0.01.
 *
 * That is the reason for the shape. It has to survive a mailbox dragged to the far
 * corner, and a path tuned against the default position would not.
 */
const THREAD_X = 4.0;

function windowEntry() {
  const light = windowLight('left', 0, LIGHT.col, LIGHT.row);
  return { x: OUTSIDE_X, y: light.midY, z: light.centre, light };
}

/**
 * How tucked the wings are at a given depth into the room: 1 at the wall, 0 inside.
 *
 * Exported because the check that the birds clear the timber has to pose the bird the
 * way the render loop poses it, and a second copy of this curve in the test would be
 * a test of the copy.
 */
export function tuckAt(x) {
  const d = Math.abs(x - WALL_X);
  if (d <= TUCK_FULL_BY) return 1;
  if (d >= TUCK_NONE_BY) return 0;
  const u = 1 - (d - TUCK_FULL_BY) / (TUCK_NONE_BY - TUCK_FULL_BY);
  return u * u * (3 - 2 * u);      // smoothstep
}

/**
 * Sweep one flight's wings back by `tuck`, and damp the beat while they are back.
 *
 * The left wing takes the negative angle: the pivots sit either side of the body, so
 * the same rotation about y would send one wing towards the tail and the other
 * towards the beak.
 */
export function poseWings(bird, tuck, flap) {
  const sweep = tuck * TUCK_SWEEP;
  bird.wingL.rotation.y = -sweep;
  bird.wingR.rotation.y = sweep;
  // A tucked wing that keeps beating reads as a glitch rather than as a glide.
  const beat = flap * (1 - tuck * 0.85);
  bird.wingL.rotation.z = -beat;
  bird.wingR.rotation.z = beat;
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

const mat = (color, rough = 0.85) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: true });

/**
 * What each species is made of. Everything the frame below needs to differ:
 * plumage, size, and the beak that identifies the bird at office distance.
 */
const SPECIES = {
  owl: {
    body: 0xa97e4f, head: 0xa97e4f, belly: 0xd8c49a, wing: 0x8a6540,
    beak: 0x8a6a2e, beakLen: 0.1, beakDrop: 0.05,   // short, hooked downward
    eye: 0x1c150c, eyeSize: 0.09,                   // the big owl eyes
    scale: 1.5, tail: 0.3, face: 0xead9b5, tufts: true,
  },
  raven: {
    body: 0x1d2026, head: 0x1d2026, belly: 0x25282e, wing: 0x16181d,
    beak: 0x2e3138, beakLen: 0.24, beakDrop: 0,     // the long straight bill
    eye: 0x0d0f13, eyeSize: 0.055,
    scale: 1.5, tail: 0.44, gloss: 0.45,            // wedge tail, oily sheen
  },
  pigeon: {
    body: 0x8a90a0, head: 0x5a6070, belly: 0xa8adba, wing: 0x767c8c,
    beak: 0x3a3d44, beakLen: 0.09, beakDrop: 0.02,
    eye: 0xd86a2a, eyeSize: 0.05,                   // the orange pigeon eye
    scale: 1.3, tail: 0.3, neck: 0x3a8a5a, wingBars: 0x2e3138,
  },
  kookaburra: {
    body: 0x6e5638, head: 0xe8dcc0, belly: 0xe8dcc0, wing: 0x5d4a30,
    beak: 0x4a3a2a, beakLen: 0.3, beakDrop: 0.02,   // the great heavy bill
    eye: 0x2a2016, eyeSize: 0.06, eyeStripe: 0x4a3a2a,
    scale: 1.45, tail: 0.36, tailBar: 0x9a5a3a, wingFlash: 0x4a7ab8,
  },
};

/**
 * One bird, facing +z, wings on shoulder pivots with a swept outer segment.
 *
 * Exported for the portrait tool and the tests; the office itself only meets
 * birds through {@link BirdFlights}.
 *
 * @param {'owl'|'raven'|'pigeon'|'kookaburra'} kind
 * @returns {{root: THREE.Group, wingL: THREE.Group, wingR: THREE.Group}}
 */
export function buildBirdMesh(kind = 'raven') {
  const s = SPECIES[kind] ?? SPECIES.raven;
  const g = group(0, 0, 0);
  const rough = s.gloss ?? 0.85;

  // The body in two masses: a deep chest and a tapered rump, pitched so the
  // bird flies chest-proud and tail-low, the way birds actually carry.
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.5), mat(s.body, rough));
  chest.position.set(0, 0.02, 0.08);
  chest.rotation.x = 0.14;
  chest.castShadow = true;
  g.add(chest);
  const rump = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.4), mat(s.body, rough));
  rump.position.set(0, 0.06, -0.26);
  rump.rotation.x = -0.18;
  g.add(rump);
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.42), mat(s.belly, 0.9));
  belly.position.set(0, -0.16, 0.06);
  g.add(belly);

  // Head, up and forward on a hint of neck.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.3), mat(s.head, rough));
  head.position.set(0, 0.32, 0.32);
  head.castShadow = true;
  g.add(head);
  if (s.neck) {
    // The pigeon's iridescent collar: one green box where the light catches.
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.2), mat(s.neck, 0.4));
    collar.position.set(0, 0.19, 0.26);
    g.add(collar);
  }
  if (s.face) {
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.04), mat(s.face, 0.95));
    face.position.set(0, 0.32, 0.48);
    g.add(face);
  }
  if (s.tufts) {
    for (const sx of [-0.1, 0.1]) {
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.07), mat(s.head));
      tuft.position.set(sx, 0.49, 0.28);
      tuft.rotation.z = -sx * 2;
      g.add(tuft);
    }
  }
  if (s.eyeStripe) {
    // The kookaburra's bandit stripe, through the eye and round the head.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.2), mat(s.eyeStripe));
    stripe.position.set(0, 0.35, 0.34);
    g.add(stripe);
  }
  for (const sx of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(s.eyeSize, s.eyeSize, 0.03), mat(s.eye, 0.3),
    );
    eye.position.set(sx, 0.35, s.face ? 0.51 : 0.46);
    g.add(eye);
  }

  // The beak: the species' signature, sized and set per bird.
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.055, s.beakLen, 4), mat(s.beak, 0.5));
  beak.rotation.x = Math.PI / 2 + s.beakDrop * 4;
  beak.position.set(0, 0.3 - s.beakDrop, 0.46 + s.beakLen / 2);
  g.add(beak);

  // Tail: three slats, fanned a little, barred if the species wears bars.
  for (const [i, sx] of [-1, 0, 1].entries()) {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.04, s.tail + (sx === 0 ? 0.06 : 0)),
      mat(i === 1 && s.tailBar ? s.tailBar : s.body, rough),
    );
    slat.position.set(sx * 0.1, 0.06, -0.44 - s.tail / 2);
    slat.rotation.y = sx * 0.16;
    slat.rotation.x = -0.32;
    g.add(slat);
  }

  // Legs, tucked up for flight: a bird with dangling legs is landing.
  for (const sx of [-0.09, 0.09]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 5), mat(0x8a6a2e, 0.6));
    leg.position.set(sx, -0.22, -0.05);
    leg.rotation.x = 1.2;
    g.add(leg);
  }

  // Wings in two segments per side: the inner arm flat from the shoulder, the
  // outer hand swept back — the silhouette that reads as flight, not as a
  // plank. The flap pivots at the shoulder; the wrist sweep is built in.
  const wingPair = (side) => {
    const pivot = group(side * 0.2, 0.14, 0.02);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.4), mat(s.wing, rough));
    inner.position.x = side * 0.21;
    inner.castShadow = true;
    pivot.add(inner);
    const outer = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.32), mat(s.wing, rough));
    outer.position.set(side * 0.58, 0, -0.1);
    outer.rotation.y = -side * 0.5;                 // the sweep at the wrist
    outer.castShadow = true;
    pivot.add(outer);
    if (s.wingBars) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.055, 0.06), mat(s.wingBars));
      bar.position.set(side * 0.21, 0, -0.08);
      pivot.add(bar);
    }
    if (s.wingFlash) {
      const flash = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.14), mat(s.wingFlash, 0.5));
      flash.position.set(side * 0.16, 0, 0.06);
      pivot.add(flash);
    }
    return pivot;
  };
  const wingL = wingPair(-1);
  const wingR = wingPair(1);
  g.add(wingL, wingR);

  // A true-to-scale bird is a dark speck from the office's usual distance.
  // Oversized the way everything here is chunky: read from across the room
  // or not worth flying in.
  g.scale.setScalar(s.scale);

  return { root: g, wingL, wingR };
}

export class BirdFlights {
  /**
   * @param {THREE.Object3D} scene  the world root
   * @param {(id: string) => ?object} boxAt  box prop by id, as MailFlights takes it
   */
  constructor(scene, boxAt) {
    this.boxAt = typeof boxAt === 'function' ? boxAt : () => boxAt;
    this.onArrive = null;
    this.root = group(0, 0, 0);
    scene.add(this.root);
    this.waiting = [];

    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      // The whole aviary is built up front and one bird shown per flight, so
      // the pool never rebuilds geometry and the night bird costs nothing by day.
      const perch = group(0, 0, 0);
      const birds = {};
      for (const kind of BIRD_KINDS) {
        birds[kind] = buildBirdMesh(kind);
        birds[kind].root.visible = false;
        perch.add(birds[kind].root);
      }

      const letter = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.05, 0.26),
        new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.9 }),
      );
      letter.position.copy(TALON_OFFSET);      // in the talons
      perch.add(letter);

      perch.visible = false;
      this.root.add(perch);
      this.pool.push({
        perch, birds, letter,
        bird: birds.raven,
        active: false,
        phase: 'in',              // in → hover → out
        t: 0,
        clock: Math.random() * 10, // start the wingbeat somewhere other than zero
        payload: null,
        p0: new THREE.Vector3(), p1: new THREE.Vector3(),
        p2: new THREE.Vector3(), p3: new THREE.Vector3(),
        hover: new THREE.Vector3(),
        slot: new THREE.Vector3(),
      });
    }

    this._pos = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    /** Scratch for the letter's fall, so a hover allocates nothing per frame. */
    this._drop = new THREE.Vector3();
  }

  /** Re-aim every flight in the air, for a box dragged mid-delivery. */
  relocate() {
    for (const slot of this.pool) {
      if (slot.active) this._aim(slot, slot.payload?.box ?? null);
    }
  }

  _aim(slot, boxId) {
    const entry = windowEntry();
    const handle = boxId ? this.boxAt?.(boxId) : null;
    const station = (boxId && STATIONS[boxId]) ?? STATIONS.mailbox;
    const target = handle?.slot
      ?? new THREE.Vector3(station.x + 0.6, 1.6, station.z);

    slot.slot.copy(target);
    // Hovering off to one side of the slot rather than square over it, so the
    // letter falls past the bird's own body instead of through it.
    slot.hover.set(target.x + 0.4, target.y + 1.15, target.z + 0.5);
    // In along the light's centre line, then bank down to the box. Both middle points
    // sit on the line (see THREAD_X): the crossing has to be square, because the hole
    // is barely wider than the bird even with its wings tucked. This used to pull
    // straight for (6, +1.4, −2), which began the bank while the bird was still in the
    // opening and took it through both mullions and the transom.
    slot.p0.set(entry.x, entry.y, entry.z);
    slot.p1.set(THREAD_X, entry.y, entry.z);
    slot.p2.copy(slot.p1);
    slot.p3.copy(slot.hover);
  }

  /** Point the exit path from wherever the hover ended back out the window. */
  _aimOut(slot) {
    const entry = windowEntry();
    // The way in, backwards: up off the box, onto the light's line, and out along it.
    // The old exit aimed at `entry.y + 2.4`, which is above the head rail — every bird
    // left the room through the top of the window frame, which is the fault that was
    // easiest to see and the one reported first.
    slot.p0.copy(slot.hover);
    slot.p1.set(THREAD_X, entry.y, entry.z);
    slot.p2.copy(slot.p1);
    slot.p3.set(entry.x, entry.y, entry.z);
  }

  /**
   * Send a letter in by bird. Same contract as MailFlights.launch: held in
   * order if the aviary is busy, false only when the waiting list is also full.
   *
   * **One bird in the air at a time**, which is the courier's rule for the courier's
   * reason: two of them sharing a doorway reads as a bug even when the queue behind
   * them is honest. Planes get away with four at once because a plane is a dart that
   * can pass a foot from another dart; a bird is three units of wingspan aiming at
   * one hole in one window and then at one slot in one box, so two of them at once
   * were not near each other — they were *inside* each other, which is what this
   * fixes. Letters that arrive together now trickle in a flight apart,
   * about two and a half seconds, and the tally on the box is the same either way.
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

  _send(slot, payload) {
    slot.active = true;
    slot.phase = 'in';
    slot.t = 0;
    slot.payload = payload;

    // The shift roster, drawn per flight, so an office watched across an
    // afternoon meets more than one courier and across dusk the odds shift
    // under it — the owl takes three flights in four at night and half by day
    // (`OWL_SHARE`). Unless the room chose a species: a chosen bird flies
    // every run, day and night, because the choice is the office's and the
    // clock cannot overrule it.
    const h = worldClock.hours();
    const chosen = CHANNELS.birdKind !== 'roster' && SPECIES[CHANNELS.birdKind]
      ? CHANNELS.birdKind : null;
    const night = h >= NIGHT_FROM || h < NIGHT_TO;
    const kind = chosen ?? rosterBird(night ? 'night' : 'day');
    for (const b of Object.values(slot.birds)) b.root.visible = false;
    slot.bird = slot.birds[kind];
    slot.bird.root.visible = true;

    slot.letter.visible = true;
    slot.letter.position.copy(TALON_OFFSET);
    slot.letter.material.color.set(PAPER);
    const to = payload?.color;
    if (typeof to === 'number') slot.letter.material.color.lerp(new THREE.Color(to), ADDRESS_TINT);

    this._aim(slot, payload?.box ?? null);
    cubicBezier(slot.p0, slot.p1, slot.p2, slot.p3, 0, slot.perch.position);
    slot.perch.visible = true;
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.clock += dt;

      // Wingbeat: heavy on the way in and out, a flutter while holding the
      // hover — which is how a real bird spends its effort, and what makes the
      // hover read as work rather than as the animation pausing.
      // The travel beat goes up with the travel speed (13 was the pace at 2.1s in): a
      // bird crossing the room half again as fast on the same lazy wingbeat is gliding,
      // and gliding is not how it got there. The hover's flutter is left alone — that
      // one is about holding still, not about how fast it arrived.
      const flap = p.phase === 'hover'
        ? Math.sin(p.clock * 26) * 0.85
        : Math.sin(p.clock * 23) * 0.55 + 0.1;
      // Wings back while it threads the window, out again once it is in the room.
      poseWings(p.bird, tuckAt(p.perch.position.x), flap);

      if (p.phase === 'in' || p.phase === 'out') {
        this._prev.copy(p.perch.position);
        p.t += dt / (p.phase === 'in' ? IN_TIME : OUT_TIME);

        if (p.t >= 1) {
          if (p.phase === 'in') {
            p.phase = 'hover';
            p.t = 0;
            p.perch.position.copy(p.hover);
          } else {
            p.active = false;
            p.perch.visible = false;
            p.t = 0;
            p.payload = null;
          }
          continue;
        }

        cubicBezier(p.p0, p.p1, p.p2, p.p3, p.t, this._pos);
        p.perch.position.copy(this._pos);
        const dx = this._pos.x - this._prev.x;
        const dz = this._pos.z - this._prev.z;
        if (Math.hypot(dx, dz) > 1e-5) p.perch.rotation.y = Math.atan2(dx, dz);
        // A shallow bank into the direction of travel; level again to hover.
        p.perch.rotation.z = Math.sin(p.t * Math.PI) * (p.phase === 'in' ? -0.18 : 0.18);
      } else {
        // The hover: hold the spot with a light bob, let the letter go, and
        // hand the payload over the moment it is in the slot — the same
        // touchdown the plane reports, from a different courier.
        p.t += dt / HOVER_TIME;
        p.perch.position.y = p.hover.y + Math.sin(p.clock * 8) * 0.05;

        if (p.letter.visible) {
          const dropT = Math.min(1, p.t * (HOVER_TIME / DROP_TIME));
          // From the talons to the slot, in the perch's own frame. Both vectors are
          // reused rather than made here: this runs every frame of every hover, and the
          // start of the fall is the same point on every bird there has ever been.
          const to = this._drop.copy(p.slot).sub(p.perch.position);
          p.letter.position.lerpVectors(TALON_OFFSET, to, dropT * dropT);  // gravity, cheaply
          if (dropT >= 1) {
            p.letter.visible = false;
            const { payload } = p;
            this.onArrive?.(payload);
          }
        }

        if (p.t >= 1) {
          p.phase = 'out';
          p.t = 0;
          this._aimOut(p);
        }
      }
    }

    while (this.waiting.length) {
      const slot = this.pool.find((s) => !s.active);
      if (!slot) break;
      this._send(slot, this.waiting.shift());
    }
  }
}
