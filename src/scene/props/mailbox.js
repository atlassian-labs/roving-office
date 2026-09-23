import * as THREE from 'three';
import { COLORS } from '../../config.js';
import { box, group, mat, put } from '../build.js';
import { movable } from '../movables.js';

// ---------------------------------------------------------------------------
// Mailbox: airmailed jobs queue up here and finished work gets posted back.
// The tube runs along +x, and the camera looks down the +x/+z quadrant, so the
// +x end is the one facing the viewer. That end is left permanently open and the
// waiting backlog is stacked just inside it.
const MB = {
  L: 1.5,        // length along x
  W: 1.0,        // width along z (also the dome diameter)
  H: 0.8,        // height of the straight sides
  yBase: 1.15,   // underside of the tube
  t: 0.07,       // shell thickness
};
const MAILBOX_LETTER_SLOTS = 6;

// Packages will not go through a slot, so they are stacked on the floor beside the
// post — on the camera side of it, where the pile is actually visible, and short of
// the snake plant further along the wall.
const MAILBOX_PARCEL_SLOTS = 5;
// Out along +z from the post and a little towards the room, which keeps the pile
// clear of the long shadow the mailbox throws: parked closer in, a cardboard box sat
// in that shadow and read as a grey smudge on the floor.
const PARCEL_STACK = { x: 0.34, z: 1.5 };
// The same cube as the package an agent carries (Agent.js, 0.5), because it is
// meant to be the same box picked up.
const PARCEL = 0.5;

// Where each parcel sits in the pile: two on the floor, two across them, one on
// top. Stacked by hand rather than in a column, because five boxes in a tower is a
// gag and two rows and a cap is how a delivery is actually left.
const PARCEL_SLOTS = [
  { x: -0.23, y: 0.00, z: 0.01, r: 0.06 },
  { x: 0.22, y: 0.00, z: 0.06, r: -0.11 },
  { x: -0.18, y: 0.42, z: 0.03, r: -0.17 },
  { x: 0.24, y: 0.42, z: -0.04, r: 0.13 },
  { x: 0.03, y: 0.84, z: 0.01, r: 0.24 },
];

// Flag swings in the plane of the mailbox's front face: upright when there's mail
// waiting, folded down along the side when there isn't.
const FLAG_UP = 0;
const FLAG_DOWN = -1.45;

export function buildMailbox() {
  const g = group(0, 0, 0);

  const post = box(0.25, 1.3, 0.25, 'woodDark', { rough: 0.7 });
  post.position.y = 0.65; g.add(post);

  const { L, W, H, yBase, t } = MB;
  const R = W / 2;
  const yArch = yBase + H;          // height the dome springs from
  const shell = { rough: 0.5, metal: 0.2 };

  // Floor, with a darker liner so the open cavity reads as a shadowed interior.
  put(g, box(L, t, W, 'mailbox', shell), 0, yBase + t / 2);
  put(g, box(L - t, 0.02, W - 2 * t, 0x24384a, { rough: 0.85, cast: false }), 0, yBase + t + 0.01);

  // Straight sides.
  for (const sz of [-1, 1]) {
    put(g, box(L, H, t, 'mailbox', shell), 0, yBase + H / 2, sz * (R - t / 2));
  }

  // Domed roof, open at both ends. DoubleSide so the underside is solid when you
  // look in through the opening.
  const roundTop = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, L, 16, 1, true, 0, Math.PI),
    mat('mailbox', shell)
  );
  roundTop.material.side = THREE.DoubleSide;
  roundTop.rotation.z = Math.PI / 2;   // swings the axis onto x, dome facing up
  roundTop.position.set(0, yArch, 0);
  roundTop.castShadow = true;
  g.add(roundTop);

  // Closed rear (-x): a rectangular panel plus a half-disc under the dome.
  put(g, box(t, H, W, 'mailbox', shell), -(L / 2 - t / 2), yBase + H / 2, 0);
  const rearDome = new THREE.Mesh(
    new THREE.CircleGeometry(R, 16, 0, Math.PI),
    mat('mailbox', { rough: 0.5, metal: 0.2, cast: false })
  );
  rearDome.material.side = THREE.DoubleSide;
  rearDome.rotation.y = -Math.PI / 2;  // face the normal down -x, flat edge level
  rearDome.position.set(-(L / 2 - t), yArch, 0);
  g.add(rearDome);

  // --- The backlog, visible through the open end ---
  // One mesh per slot, revealed as jobs queue up. Slightly emissive because the
  // inside of the tube is otherwise too shadowed to read.
  const letters = [];
  for (let i = 0; i < MAILBOX_LETTER_SLOTS; i++) {
    const letter = group(0, 0, 0);

    const paper = box(0.62, 0.03, 0.44, COLORS.paper, {
      rough: 0.85, cast: false, emissive: 0xfff6e0, emissiveIntensity: 0.14,
    });
    letter.add(paper);
    // Flap band + airmail stripe, so it reads as an envelope not a blank card.
    put(letter, box(0.28, 0.033, 0.44, 0xe6dcc4, { rough: 0.85, cast: false }), 0.17, 0.001, 0);
    put(letter, box(0.62, 0.034, 0.05, 0xd23b3b, { rough: 0.8, cast: false }), 0, 0.001, 0.185);

    // Stacked at the mouth of the tube, nudged about so the pile looks handled.
    // The stack starts at the lip (the first envelope pokes out past it) because
    // the camera only ever gets a glancing look down the tube — anything parked
    // deeper than this is swallowed by the near wall and the dome.
    const flip = i % 2 ? 1 : -1;
    letter.position.set(
      0.62 - i * 0.05,
      yBase + t + 0.035 + i * 0.045,
      flip * 0.03
    );
    letter.rotation.y = flip * (0.05 + i * 0.015);
    letter.rotation.z = -0.05 - i * 0.01;   // slight nose-down tilt, as if shoved in
    letter.visible = false;
    g.add(letter);
    letters.push(letter);
  }

  // --- The parcel pile, on the floor beside the post -----------------------
  // Same cardboard and same taped band as the package an agent carries, so the box
  // you watched land is recognisably the box they pick up.
  const parcels = [];
  for (let i = 0; i < MAILBOX_PARCEL_SLOTS; i++) {
    const slot = PARCEL_SLOTS[i];
    const parcel = group(
      PARCEL_STACK.x + slot.x,
      slot.y + PARCEL / 2,
      PARCEL_STACK.z + slot.z,
    );
    // A touch of variation in the box itself, so a pile of five is not one box
    // photocopied five times.
    const w = PARCEL * (0.9 + (i % 3) * 0.07);
    const d = PARCEL * (0.92 + (i % 2) * 0.1);
    parcel.add(box(w, PARCEL, d, COLORS.parcel, { rough: 0.9 }));
    // Tape over the seam, and a label. Both kept deliberately mean: the camera
    // looks down on these, so the top face is nearly all you see of a box, and a
    // wide band of pale tape plus a white label turned a pile of cardboard into a
    // pile of something that read as polystyrene.
    const tape = box(w * 0.13, PARCEL + 0.006, d + 0.006, COLORS.parcelTape, { rough: 0.8, cast: false });
    parcel.add(tape);
    put(parcel, box(w * 0.22, 0.004, d * 0.16, 0xe8e0cd, { rough: 0.9, cast: false }), -w * 0.22, PARCEL / 2 + 0.004, d * 0.2);
    parcel.rotation.y = slot.r;
    parcel.visible = false;
    g.add(parcel);
    parcels.push(parcel);
  }

  // Flag, mounted on the outside of the camera-facing (+z) wall so it's actually
  // visible, and swinging in that plane.
  const flagPivot = group(-0.45, 1.32, R + 0.03);
  const flagPole = box(0.06, 0.52, 0.05, 0x9a9a9a, { cast: false });
  flagPole.position.y = 0.26; flagPivot.add(flagPole);
  const flag = box(0.34, 0.26, 0.04, 0xd23b3b, { cast: false });
  flag.position.set(0.19, 0.42, 0); flagPivot.add(flag);
  flagPivot.rotation.z = FLAG_DOWN;
  g.add(flagPivot);

  const handle = {
    id: 'mailbox',
    kind: 'mailbox',
    flagPivot,
    letters,
    parcels,
    deliveries: 0,
    _hold: 0,

    // Where a thrown parcel should come down, in the mailbox's own space. The
    // courier needs it and only this function knows where the pile was put.
    pileOffset: { x: PARCEL_STACK.x, y: PARCEL * 0.6, z: PARCEL_STACK.z },

    // What is waiting to be collected, by size. Not counted here: these are *told*
    // to us once a frame from the post model, which is the only thing that actually
    // knows. They used to be tallied here too, with every path that removed an
    // envelope obliged to call a matching `collect()` — four such paths, one of them
    // a `for` loop of compensations — and any new path that forgot left the flag
    // stuck up over an empty box. One source of truth is worth more than the frame
    // of latency this costs.
    waitingLetters: 0,
    waitingParcels: 0,

    /** Everything waiting, whatever shape it came in. */
    get pending() { return this.waitingLetters + this.waitingParcels; },

    /** An agent dropped finished work in — a brief flag raise for the outgoing. */
    deliver() { this.deliveries++; this._hold = 5; },

    /**
     * Tell the mailbox what the post model is holding.
     *
     * @param {number} lettersWaiting  envelopes in the tube
     * @param {number} parcelsWaiting  packages on the pile
     */
    setWaiting(lettersWaiting, parcelsWaiting) {
      if (lettersWaiting === this.waitingLetters && parcelsWaiting === this.waitingParcels) return;
      this.waitingLetters = lettersWaiting;
      this.waitingParcels = parcelsWaiting;
      // Counts run past the slots built for them — six envelopes and five parcels
      // on show is plenty to read as "a backlog" — so the visuals cap and the
      // numbers do not.
      for (let i = 0; i < letters.length; i++) letters[i].visible = i < lettersWaiting;
      for (let i = 0; i < parcels.length; i++) parcels[i].visible = i < parcelsWaiting;
    },

    update(dt) {
      if (this._hold > 0) this._hold -= dt;
      // The flag means "there is work waiting", not "there is a letter in the slot",
      // so a pile of parcels raises it exactly as an envelope does.
      const up = this.pending > 0 || this._hold > 0;
      const target = up ? FLAG_UP : FLAG_DOWN;
      flagPivot.rotation.z += (target - flagPivot.rotation.z) * Math.min(1, dt * 6);
    },
  };
  return { obj: g, handle };
}

/** Mount the mailbox: the one station whose model does not point where its
 * station points — see mailboxRelocate below. */
export function mount(s, handles) {
  // Delivery target. Deliberately not `place()`d: the tube is modelled with its
  // open end along +x, which is both the side the camera looks into and the side
  // the paper planes dive in from. Turning it to face its approach point like the
  // other props would present the sealed rear end to both.
  //
  // That quarter turn between the model and the station is written down rather
  // than left as a zero rotation that happened to look right — see
  // `mailboxRelocate`.
  const { obj, handle } = buildMailbox();
  handles.mailbox = handle;
  const relocate = () => mailboxRelocate(obj, handle, s);
  relocate();
  return movable(obj, `station:${s.id}`, { label: 'Mailbox', spec: s, relocate });
}

/**
 * Put the mailbox where the layout says, and move its two throw targets with it.
 *
 * The mailbox is the one station whose model does not point where its station points.
 * The tube's open end is modelled along local +x — the side the camera looks into and
 * the side the planes dive in from — so the group sits a quarter turn behind its
 * facing. Authored, that came out as a rotation of exactly zero, which is why it
 * could be left off entirely; written down, the mailbox can be turned round and still
 * present its open end to whatever it is now facing.
 *
 * `slot` and `pile` are offsets in that model space, so they are rotated rather than
 * added: a turned mailbox has its slot on a different side of the room, and a letter
 * that kept flying to the old one would land in mid air.
 */
function mailboxRelocate(obj, handle, station) {
  const spin = station.facing - Math.PI / 2;
  obj.position.set(station.x, 0, station.z);
  obj.rotation.y = spin;

  const s = Math.sin(spin), c = Math.cos(spin);
  const world = (dx, dz) => ({
    x: station.x + dx * c + dz * s,
    z: station.z - dx * s + dz * c,
  });

  const slot = world(0.6, 0);
  handle.slot = new THREE.Vector3(slot.x, 1.5, slot.z);
  const pile = world(handle.pileOffset.x, handle.pileOffset.z);
  handle.pile = new THREE.Vector3(pile.x, handle.pileOffset.y, pile.z);
}

