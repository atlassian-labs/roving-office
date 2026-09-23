import * as THREE from 'three';
import { FLOOR_TOP, ROOM } from '../config.js';
import { smoothstep } from '../ease.js';
import { clamp01 } from '../measure.js';
import { group } from './build.js';

// Beamed up: the way somebody leaves when they cannot leave.
//
// Going home is a walk — desk given back, coat off the stand, lift called, out the
// door and down the flight — and a walk is at the mercy of the room it crosses. It
// can be held up by a crowd at the door, and it only advances while frames are
// being drawn, which a browser stops doing for a tab nobody is looking at. Neither
// is a reason for a character to stand in the office forever, so a departure that
// has not finished is eventually taken out of the room's hands: a cone of light
// comes down out of the sky, the character rises into it, and they are gone.
//
// Under `prefers-reduced-motion` there is no animation to watch: they simply go.
//
// Nothing here knows why the room gave up on somebody. See `AgentManager._leave`
// and `LEAVE_GRACE` for that.

/** How long the whole thing takes, in seconds, and where its phases divide. */
const STRIKE = 0.22;              // the cone slams down out of the sky
const LIFT = 0.95;                // and takes them up
const FADE = 0.3;                 // then closes to nothing
const TOTAL = STRIKE + LIFT + FADE;

/**
 * How many can be in the air at once.
 *
 * A cap rather than a fixed pool because the case this exists for is a hundred
 * departures arriving in one frame — a tab that was in the background for hours,
 * whose reaper went on retiring sessions the whole time. Beaming all of them at
 * once is a wall of blue and one frame's worth of allocation; eight at a time
 * reads as the room being cleared out, and drains a hundred in half a minute.
 */
export const AT_ONCE = 8;

// Six times the height of the room, and that is not extravagance: this building has
// no ceiling, the diorama camera looks down into it from well above the walls, and a
// cone that stops anywhere short of the top of the frame ends in a flat elliptical
// lid hanging in the air — a glass vase rather than a beam. Two room-heights was not
// enough, because how high the far end lands *on screen* depends where in the room
// somebody is standing, so it has to be tall enough for the deepest desk in the room.
// The flare is very gentle over that length, which is right: it is a column of light
// whose other end is out of the picture, and out of the picture is the only end a
// beam from the sky is allowed to have.
const BEAM_H = ROOM.H * 6;
const BEAM_R_TOP = 2.4;
const BEAM_R_BOTTOM = 0.52;

// How far up they go. Off the top of the shot from the diorama camera, and far
// enough that a first-person viewer watching from the floor loses them.
const RISE = 6.4;

// And how fast they turn on the way, in radians a second. Set as an absolute angle
// from where they were facing rather than added to each frame: an animation that
// adds per frame runs at whatever rate the machine happens to be drawing at.
const SPIN = 9;

const GLOW = 0x45bdf2;            // the cone
const CORE = 0xeafaff;            // the brighter shaft inside it

/** True when the viewer has asked for no animation. */
function stillness() {
  return globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}

/**
 * Light rather than surface: unlit, and never written to the depth buffer so the
 * cone's own two walls do not fight over which is in front.
 *
 * Only the bright shaft up the middle is *additive*. That is a deliberate split,
 * and it is what makes this read as blue: additive light over a lit interior floor
 * saturates to white — the cone came out as a white paper funnel against the
 * daylight sky, with the colour surviving only at night — so the cone is an
 * ordinary translucent blue instead, and the additive one is the thin bit in the
 * middle that is *supposed* to blow out.
 */
function glow(color, opacity, { additive = false } = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * One cone of light, built once and reused.
 *
 * Two nested groups, because the two things that move move about different points:
 * `root` sits on the floor under the character, and `column` hangs from the sky at
 * the top of the beam so that scaling it in y slams the cone *down* rather than
 * growing it up out of the floorboards.
 */
function buildBeam() {
  const root = group(0, 0, 0);
  const column = group(0, BEAM_H, 0);

  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(BEAM_R_TOP, BEAM_R_BOTTOM, BEAM_H, 18, 1, true),
    glow(GLOW, 0),
  );
  cone.position.y = -BEAM_H / 2;
  cone.castShadow = false;
  cone.receiveShadow = false;

  // A slim bright shaft up the middle of the cone. Narrower than a person on
  // purpose: a column as wide as the body sits in front of it and bleaches the
  // character to a white silhouette, and what should be lit is somebody
  // recognisable, right up until they are gone.
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(BEAM_R_TOP * 0.22, BEAM_R_BOTTOM * 0.3, BEAM_H, 12, 1, true),
    glow(CORE, 0, { additive: true }),
  );
  core.position.y = -BEAM_H / 2;
  core.castShadow = false;
  core.receiveShadow = false;

  column.add(cone, core);

  // What the cone landing looks like on the floorboards: a thin ring of light
  // spreading outwards, and gone long before the rest of it. Additive, unlike the
  // cone — this one *is* light falling on a surface, and a translucent blue disc
  // instead of a bright ring came out as a stain on the boards. Bedded a whisker
  // above the floor rather than on it, for the reason FLOOR_TOP exists.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.95, 28), glow(CORE, 0, { additive: true }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = FLOOR_TOP + 0.04;
  ring.castShadow = false;
  ring.receiveShadow = false;

  root.add(column, ring);
  root.visible = false;
  return { root, column, cone, core, ring };
}

export class BeamUps {
  /** @param {THREE.Object3D} scene  where the cones are drawn */
  constructor(scene) {
    this.root = group(0, 0, 0);
    scene.add(this.root);
    /**
     * One entry per cone ever needed, reused. `y` and `spin` are where the
     * character was when the beam took them, so the rise and the turn are
     * absolute rather than accumulated frame by frame.
     * @type {Array<{beam: object, agent: ?object, onGone: ?Function, t: number,
     *               gone: boolean, y: number, spin: number}>}
     */
    this.slots = [];
  }

  /** How many characters are being beamed up right now. */
  get active() { return this.slots.filter((s) => s.agent).length; }

  /**
   * Whether another one would have to wait.
   *
   * Asked before a caller disturbs anybody, so that being refused costs the person
   * refused nothing — see `AgentManager._beamOut`.
   */
  get busy() { return !stillness() && this.active >= AT_ONCE; }

  /**
   * Take somebody out of the room.
   *
   * Built on first use rather than pooled up front, because a room where nobody
   * ever gets stuck should carry no cones at all — including in the coplanar
   * probe, which walks the whole scene graph and does not care whether a mesh is
   * visible.
   *
   * @param {{root: THREE.Object3D, position: THREE.Vector3, setTagFade: Function}} agent
   * @param {Function} onGone  called once, when they should be removed from the room
   * @returns {boolean} whether this one has been dealt with — either beamed, or
   *   removed outright because the viewer asked for stillness. False means every
   *   beam is busy and the caller should offer them again on a later frame; they
   *   are already overdue, and a few seconds more of that is worth having the
   *   clear-out actually be watchable.
   */
  beamUp(agent, onGone) {
    if (stillness()) {
      onGone?.();
      return true;
    }
    if (this.busy) return false;

    let slot = this.slots.find((s) => !s.agent);
    if (!slot) {
      slot = { beam: buildBeam(), agent: null, onGone: null, t: 0, gone: false, y: 0, spin: 0 };
      this.root.add(slot.beam.root);
      this.slots.push(slot);
    }

    slot.agent = agent;
    slot.onGone = onGone ?? null;
    slot.t = 0;
    slot.gone = false;
    slot.y = agent.root.position.y;
    slot.spin = agent.root.rotation.y;

    // Their tag goes with the first frame of it: a name pill drifting up a column
    // of light is the one part of this that would read as a bug. Safe to set and
    // leave set, because the room drops anybody being beamed from the crowd (see
    // `AgentManager._people`), so nothing else touches their fade again.
    agent.setTagFade(0);

    // The cone stands where they are and stays there: nothing moves them again —
    // their walk is over and they are out of the crowd — so it does not have to
    // follow them, and a column of light that drifted would be worse than one that
    // does not.
    slot.beam.root.position.set(agent.position.x, 0, agent.position.z);
    slot.beam.root.visible = true;
    this._draw(slot, 0);
    return true;
  }

  update(dt) {
    for (const slot of this.slots) {
      if (!slot.agent) continue;
      slot.t += dt;
      this._draw(slot, slot.t);

      // Gone at the top of the lift, not at the end of the animation: the cone
      // closing on an empty patch of floor is the last beat of it, and holding the
      // character in the room for those three tenths would be the room holding on
      // to somebody all over again.
      if (!slot.gone && slot.t >= STRIKE + LIFT) {
        slot.gone = true;
        const done = slot.onGone;
        slot.onGone = null;
        done?.();
      }

      if (slot.t >= TOTAL) {
        slot.agent = null;
        slot.beam.root.visible = false;
      }
    }
  }

  /** Where everything is at `t` seconds into one beam. */
  _draw(slot, t) {
    const { beam, agent } = slot;
    const strike = clamp01(t / STRIKE);
    const lift = clamp01((t - STRIKE) / LIFT);
    const fade = clamp01((t - STRIKE - LIFT) / FADE);

    // Down out of the sky, then steady, then pinched out.
    beam.column.scale.y = 0.04 + 0.96 * smoothstep(strike);
    const pinch = 1 - 0.72 * fade;
    beam.column.scale.x = pinch;
    beam.column.scale.z = pinch;

    // Brightest while somebody is actually in it, with a shimmer on top so a beam
    // that stands for a second does not look like a still.
    const shimmer = 1 + 0.12 * Math.sin(t * 34);
    beam.cone.material.opacity = 0.42 * strike * (1 - fade) * shimmer;
    beam.core.material.opacity = 0.55 * strike * (1 - fade * fade) * shimmer;

    // The pool spreads and is gone well before the cone is: it belongs to the
    // arrival of the beam, not to the length of it.
    const pool = clamp01(t / (STRIKE + LIFT * 0.45));
    beam.ring.scale.setScalar(0.7 + pool * 1.5);
    beam.ring.material.opacity = 0.6 * (1 - pool) * strike;

    if (!agent || slot.gone) return;

    // Up, turning, and drawn away to nothing. Ease *in* — they hang for a beat as
    // the cone lands and then go, which is what makes it read as being taken rather
    // than as jumping.
    const k = lift * lift;
    agent.root.position.y = slot.y + RISE * k;
    agent.root.rotation.y = slot.spin + t * SPIN;
    const shrink = 1 - 0.86 * clamp01((lift - 0.25) / 0.75);
    agent.root.scale.setScalar(shrink);
  }
}
