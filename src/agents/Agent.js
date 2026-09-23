import * as THREE from 'three';
import { STATUS_COLORS, COLORS } from '../config.js';
import { pick } from '../dice.js';
import { lerp } from '../ease.js';
import { clamp01 } from '../measure.js';
import { SEAT_HEIGHT } from '../scene/props/desk.js';
import { STANDING_TYPE_REACH } from '../scene/props/sit-stand.js';
import { EYE_Y as TELESCOPE_EYE_Y } from '../scene/props/telescope.js';
import { buildPrintout } from '../scene/props/printer.js';
import { box, group, put, sphere } from '../scene/build.js';
import { randomDrink } from './drinks.js';
import { markTexture } from './mark-texture.js';
import { planTally } from './steps.js';

// A stylized low-poly humanoid agent.
//
// The legs are built as hip -> thigh -> knee -> shin so the agent can actually
// sit in a chair (thighs horizontal, shins down) rather than just sinking into
// the floor. Agents can carry a package or a letter (work, however it arrived), a
// book (research), or a cup (break).

// Skin tones: very light to deep, warm-to-deep ramp for believability
const SKIN_TONES = [
  0xf1c9a5,  // very light, cool-warm
  0xe8bfa0,  // light
  0xe0ac83,  // light-mid
  0xd9a577,  // mid-light
  0xc68642,  // mid
  0xb8744a,  // mid-deep
  0xa0623f,  // deep
  0x8d5524,  // deeper
  0x704020,  // deep warm
];

// Hair colours: black, browns (dark to light), blonde, auburn, grey, and softer hues
const HAIR_COLORS = [
  0x1e1a17,  // black
  0x3a2b20,  // very dark brown
  0x4a3728,  // dark brown
  0x6b4a2f,  // mid-dark brown
  0x8a6a4a,  // mid brown
  0xa0876a,  // light brown
  0xc5a882,  // light brown/blonde
  0x888888,  // grey
];

// Hairstyles: roughly half the agents get feminine styles (longer/bun/ponytail)
const HAIRSTYLES = [
  'short',    // flat slab (classic, gender-neutral)
  'bob',      // side panels plus short back (feminine)
  'long',     // longer back panel, reaches upper back (feminine)
  'ponytail', // crop plus tapered tail (feminine)
  'bun',      // crop plus sphere on top-back (feminine)
  'curly',    // overlapping spheres for volume (gender-neutral)
];

// The canvas and the world width move together: everything inside the tag is
// positioned as canvas pixels scaled by `TAG_WORLD_W / TAG_W`, so a wider pair of
// numbers at the same ratio leaves the type and the lozenge exactly the size they
// were and simply gives a long name somewhere to go. Real sessions are named after
// the job they are on — `Matilda Cat-Researcher` — and at 4:1 half of those lost
// their first barrel to the ellipsis. Nothing widens for a short name: the pill is
// only ever drawn as wide as the text inside it.
const TAG_W = 640;
const TAG_H = 128;
const TAG_WORLD_W = 5.0;          // sprite width in world units (canvas is 5:1)
/** Exported so a test can state this dependency rather than assume it is 1. */
export const TAG_WORLD_H = 1.0;
const TAG_Y = 3.3;                // height above the agent's feet
const TAG_FONT_PX = 46;          // full size, used by short names
const TAG_FONT_MIN_PX = 30;      // floor: below this a name stops being readable
const TAG_MARGIN = 14;           // keeps the pill's stroke off the canvas edge
const TAG_ICON_PX = 44;          // source mark's box, a shade over the dot's 42
const TAG_ICON_GAP = 13;         // mark to status dot: closer than dot to name,
                                 // so the two glyphs read as one cluster
// Tags are drawn over everything by default (see `setTagMode`). Seen from inside
// the room instead of above it, that is wrong twice over: a label punches through
// the monitor behind it, and a nearby agent's pill swells to fill the view.
// In-world mode fixes the first by letting the depth buffer do its job.
//
// The scale fixes the second, and has to be aggressive. A 5-unit pill is eight times
// the width of the 0.6-wide body under it — which reads fine from outside the
// building, where everything is far away and uniformly scaled, and absurd from
// across the room, where a colleague four metres off still wears a sign a quarter of
// the screen wide. At 0.28 the pill is a bit over twice the body's width, which is
// about what a name badge should look like on a person.
// Tags stop at the threshold. The back wall stands at z = 0, so anything behind it —
// the stoop, the flight of stairs, the inside of a lift car — is outside the room, and
// a floating pill over somebody's head out there reads as UI escaping the building.
// A shade past the wall rather than exactly on it, so the tag is gone before they are.
const TAG_INDOORS_Z = 0.3;

const TAG_INWORLD_SCALE = 0.28;

/* How much bigger a name tag has to be drawn for the viewport it will be shown
 * in, and why it needs to be a factor at all.
 *
 * The tags are sprites sized in *world* units, so their size on screen is
 * `TAG_WORLD_H * viewportHeight * zoom / (2 * frustum)`. That scales *with* the
 * viewport rather than compensating for it, so the same tag that is 36px tall on
 * a full screen is 15px tall in a 425px embed — and since the pill's texture is
 * 128px for a 46px font, 15px of pill leaves the name at about 5px. Legible at
 * one size and not at another, from the same code.
 *
 * So the office corrects for it, rather than a host being asked to. A host does
 * not know the frustum or the texture geometry, and the standalone office has the
 * same problem in a small window.
 *
 * 1 until told otherwise, so nothing changes for a caller that never sets it. */
let tagLegibility = 1;

/** The tag height, in CSS pixels, that keeps a name readable. */
export const TAG_TARGET_PX = 30;

/**
 * Set the correction, in multiples of the tag's natural size.
 *
 * Clamped, because this multiplies a sprite that sits in the scene: unbounded it
 * would let a very small viewport put a name tag across the whole room.
 */
export function setTagLegibility(scale) {
  const next = Number(scale);
  if (!Number.isFinite(next) || next <= 0) return tagLegibility;
  tagLegibility = Math.max(0.6, Math.min(2.5, next));
  return tagLegibility;
}

/**
 * The factor every part of a tag is drawn at.
 *
 * One function because the alternative is three call sites that have to agree,
 * and that is exactly how the step chip got left behind: the pill and its
 * satellite sprites picked up the legibility correction and the chip did not, so
 * it sat at its natural size and offset under a pill twice its scale.
 */
export function tagPartScale(tagScale) {
  return tagScale * tagLegibility;
}

/**
 * The correction a viewport and zoom call for.
 *
 * Pure, so the arithmetic can be checked without a scene. Returns null rather
 * than a guess when asked before layout, when height is still 0.
 */
export function tagLegibilityFor({ viewportHeight, zoom, frustum, targetPx = TAG_TARGET_PX }) {
  if (!(viewportHeight > 0) || !(zoom > 0) || !(frustum > 0)) return null;
  const naturalPx = (TAG_WORLD_H * viewportHeight * zoom) / (2 * frustum);
  if (!(naturalPx > 0)) return null;
  return targetPx / naturalPx;
}
const TAG_INWORLD_OPACITY = 0.85;
// A shrunken pill left at TAG_Y floats a clear metre above a 2.5-tall head, reading
// as a sign on a pole rather than a label on a person. Closer suits the smaller size.
const TAG_INWORLD_Y = 2.95;

const TAG_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const tagFont = (px) => `700 ${px}px ${TAG_FONT_STACK}`;

// Shared white circle used for every agent's status lozenge; tinted per agent
// via the sprite material's colour.
let _circleTexture = null;
function circleTexture() {
  if (_circleTexture) return _circleTexture;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.arc(32, 32, 27, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  _circleTexture = new THREE.CanvasTexture(c);
  _circleTexture.__shared = true;   // never disposed with an individual agent
  return _circleTexture;
}

const HIP_Y = 0.9;

/**
 * Where the eye is, for anything that has to be put in front of one.
 *
 * The head's own centre, which is also the point `sceneCamera` flies the first-person
 * view to (see scene/camera.js) — so "where an agent is looking from" is one number
 * and not two that agree by luck.
 */
export const AGENT_EYE_Y = 2.2;

/**
 * The stoop: bending from the waist to put an eye somewhere lower than it stands.
 *
 * Added for the telescope, which is the first thing in the room an agent has
 * to get *down* to rather than reach for. Every other pose is arms — typing, drinking,
 * holding a book — because until now everything an agent used met them at or above
 * their own height.
 *
 * Two things worth saying about it.
 *
 * **It needed a joint that did not exist.** The torso, shoulders and head hung off the
 * body as siblings, so there was nothing to rotate that meant "the upper half": turning
 * `body` pitches the legs and feet with it and tips the figure off the floor, and
 * turning the three separately is three rotations that have to agree about a pivot they
 * do not share. So `_buildBody` now hangs them, and everything carried, off `this.trunk`
 * at hip height — one pivot at the one place a body actually folds. The legs stay on
 * `body`, because legs do not bend at the waist.
 *
 * **The angle is derived, not chosen.** It is exactly the bend that drops an eye from
 * `AGENT_EYE_Y` onto the telescope's eyepiece, so if the prop's proportions change the
 * pose follows instead of quietly missing. Which is also why it is small — 22.6°,
 * "a little", because at this leverage a bend is mostly a lean: the same 0.39 radians
 * that lowers an eye 0.10 carries it half a metre forward, in towards the eyepiece.
 * That is what using a telescope on a tall tripod looks like. A pose tuned by eye until
 * it read as "bending" would have been a fold at the waist and a face in the tripod.
 */
const STOOP_LEVER = AGENT_EYE_Y - HIP_Y;
export const STOOP_BEND = Math.acos(1 - (AGENT_EYE_Y - TELESCOPE_EYE_Y) / STOOP_LEVER);

/** How fast the stoop goes on and comes off. Slower than a fidget, faster than a walk. */
const STOOP_EASE = 0.14;

/**
 * Dialling: one hand up at the printer's touchscreen, jabbing at it.
 *
 * What sending a fax looks like from across the room, and it needs to be *legible* as
 * outgoing rather than merely as standing near a machine. So it is the same idea as the
 * typing fidget — an arm on a repeating cycle — with two differences that matter.
 *
 * It is **one arm, not two**. Typing is two hands on a keyboard; this is one hand on a
 * screen, and the other one hanging is most of what tells them apart at this size.
 *
 * And it reaches *up*. The screen is cantilevered off the machine's front at 2.20 in
 * world units — the prop is authored at 1.10 and the room doubles its height — while a
 * shoulder is at 1.78. So the hand has to go above the shoulder, which is past the
 * quarter turn that reaches a desk: `STANDING_TYPE_REACH` is −109.7° for a keyboard
 * below the shoulder, and this is −126° for a screen above it.
 *
 * The jab is `abs(sin)` rather than `sin` so the hand returns to the screen on every
 * beat instead of easing through it — the same argument the dance's hop makes about
 * landing. A finger pressing big numbers stops at the glass each time.
 */
export const DIAL_REACH = -126 * (Math.PI / 180);
const DIAL_SPEED = 0.009;
const DIAL_TRAVEL = 0.2;

/**
 * The happy dance: a celebration, in four numbers.
 *
 * Read at the room's camera distance, which rules out anything subtle — a shift of
 * weight or a nod would be a few pixels of nothing. What carries at that size is the
 * silhouette changing: arms up out of the body's outline, and the whole figure leaving
 * the floor. So the dance is a bounce with the arms overhead, pumping out of phase so
 * the two sides never read as one shape.
 *
 * The sway is what stops it being a pogo stick. It runs at half the bounce's rate, so
 * the figure leans into every second hop and the loop is two beats long rather than
 * one — long enough not to read as a stuck frame.
 *
 * The beat is wound from `dt`, the way the walk cycle is, and not read off the wall
 * clock the way typing and drinking are. Those two are idle fidgets that only have to
 * look busy; this is a whole-body cycle, and a whole-body cycle that ignores the frame
 * clock runs at a different speed on a slow frame — and cannot be stepped through by
 * anything that is not a real second, which includes every test of it.
 */
const DANCE_RATE = 9;           // radians of beat per second
const DANCE_HOP = 0.17;         // how far off the floor, in world units
const DANCE_SWAY = 0.13;        // radians of lean, at half the beat
const DANCE_REACH = -2.45;      // shoulder angle with the arms overhead

/**
 * How long it takes to lower yourself into a seat, or get back out of one.
 *
 * Sitting used to be a single frame: the body dropped to the cushion, the hips and
 * knees folded, and all of it happened between one frame and the next. What you saw
 * was a character standing in front of a couch and then, with no motion in between,
 * a character on it.
 *
 * Exported because the action that carries somebody into the seat runs for the same
 * length (`sit` in agents/states.js). The two have to agree or the character arrives
 * over the cushion still half standing, or finishes folding a step short of it.
 */
export const SIT_SECONDS = 0.45;

/**
 * How far the hips and knees fold when somebody sits. Not quite square, so a seated
 * character keeps a hint of the angle a real one does.
 */
const SEAT_FOLD = Math.PI / 2 * 0.95;

/**
 * How far in front of the hip the feet are, at a given point in the seat blend.
 *
 * Worth having as a number rather than a look, because standing up depends on it. The
 * hip and the knee fold by equal and opposite amounts, so the shin stays vertical the
 * whole way and the foot simply swings forward on the end of the thigh: at rest it is
 * under the hip, and fully seated it is a thigh's length in front.
 *
 * Which is why a character standing up cannot keep still. Unfolding walks the foot
 * back under the hip, so a root left where it was drags the feet backwards across the
 * floor — and feet do not do that. Standing up is the hips coming *forward* over
 * planted feet, and `_stepStand` in states.js uses this to move them exactly that far.
 */
export function footReach(blend) {
  return THIGH_LEN * Math.sin(SEAT_FOLD * blend);
}

const THIGH_LEN = 0.48;
const SHIN_LEN = 0.42;

// Typing: where the hands go, how far they move, and how fast.
//
// An arm here is one box on a shoulder pivot with a hand on the end of it — no elbow —
// so the whole pose is this one angle, and the arithmetic is worth writing down. Sat
// at a desk the shoulder ends up at y ≈ 1.62 and the hand hangs 0.86 below it; the
// office's desk top is at 1.58 and its keyboard 0.05 above that. So the arm has to
// come round to a little past horizontal — a shade over 90° — to put the hands on the
// keys. It used to stop at 69°, which left them swinging about in the void under the
// desk, in front of the occupant's knees.
//
// Half the travel and half the rate of the version before it. A tenth of a radian at
// two beats a second was an agent hammering a desk in frustration; this is somebody
// working, and it stays legible at the far end of a room.
const TYPE_REACH = -Math.PI / 1.85;
const TYPE_TRAVEL = 0.05;
const TYPE_SPEED = 0.006;

// Work-log sizing: how many entries we keep, and how many the inspector shows.
const HISTORY_CAP = 40;
export const HISTORY_SHOWN = 10;

// Build a hairstyle group positioned at the head; the head is a box at y=2.2,
// spanning y 1.89..2.51 and x/z -0.31..0.31. Long hair sits at the back (z < 0)
// and drapes down without intersecting the torso (which spans z -0.25..0.25 and y 0.9..1.9).
function buildHairstyle(style, color) {
  const hair = group(0, 0, 0);

  if (style === 'short') {
    // Flat slab on top: classic short crop
    put(hair, box(0.66, 0.22, 0.66, color, { rough: 0.85 }), 0, 0.27);  // sits on top of head at y 2.2 + 0.27 = 2.47
  } else if (style === 'bob') {
    // Short back + side panels past ears
    put(hair, box(0.3, 0.24, 0.35, color, { rough: 0.85 }), 0, 0.22, -0.2);  // sits behind head, not too far back
    put(hair, box(0.18, 0.28, 0.28, color, { rough: 0.85 }), -0.38, 0.15, 0);  // left of head, past the ear
    put(hair, box(0.18, 0.28, 0.28, color, { rough: 0.85 }), 0.38, 0.15, 0);  // right of head, past the ear
  } else if (style === 'long') {
    // Longer back panel reaching upper back, draping down the rear
    // Head spans y 1.89..2.51. Hair from y 2.0 down to ~y 1.6 (upper back level)
    // At z -0.3 to keep it behind the torso (torso is z -0.25..0.25)
    const back = box(0.44, 0.6, 0.32, color, { rough: 0.85 });
    back.position.set(0, -0.1, -0.3);  // y -0.1 relative to head at 2.2 = 2.1 absolute
    // This reaches from y ~1.8 down to y ~2.4 in world coords
    hair.add(back);
  } else if (style === 'ponytail') {
    // Short crop + a tapered tail behind, hanging down
    put(hair, box(0.66, 0.22, 0.66, color, { rough: 0.85 }), 0, 0.27);
    // Tail: narrower, longer, positioned at the back lower down
    put(hair, box(0.18, 0.5, 0.18, color, { rough: 0.85 }), 0, -0.15, -0.28);  // y -0.15 relative to head = 2.05 abs
  } else if (style === 'bun') {
    // Short crop + a small sphere on top-back for a bun
    put(hair, box(0.66, 0.22, 0.66, color, { rough: 0.85 }), 0, 0.27);
    // Bun: small sphere on top-back
    put(hair, sphere(0.16, color, { rough: 0.85 }), 0, 0.52, -0.1);  // sits on top of head, slightly back
  } else if (style === 'curly') {
    // Overlapping spheres for a voluminous curly/afro look
    put(hair, sphere(0.2, color, { rough: 0.85 }), 0, 0.15, -0.15);
    put(hair, sphere(0.18, color, { rough: 0.85 }), 0, 0.35, 0);
    put(hair, sphere(0.16, color, { rough: 0.85 }), -0.2, 0.1, 0);
    put(hair, sphere(0.16, color, { rough: 0.85 }), 0.2, 0.1, 0);
  }

  return hair;
}

export class Agent {
  constructor({
    id, name, color = 0x6fb1e0, colorLabel = null, avatar = null, drink = randomDrink(),
    source = null, variant = null,
  }) {
    this.id = id;
    this.name = name;
    this.color = color;
    // What the colour was called where it came from — `teal`, `#c1440e` — when it was
    // somebody's choice rather than the palette's. Null for everybody else, which is
    // how the detail panel knows whether there is anything worth saying about it.
    this.colorLabel = colorLabel;
    // A URL to a picture of this agent, when their harness sent one up (spec §3.2).
    // Shown in the detail panel; the character in the room is still the character.
    this.avatar = avatar;
    this.status = 'idle';
    this.job = null;

    // Which part of the round is in hand, and the checklist it came from (spec §4.2).
    //
    // A third field rather than a reuse of either of the two above, and the reason is
    // worth writing down. `history[n].label` is the *piece of work* and must not move
    // for the length of a turn, or one round would log as five. `job` is the running
    // *headline*, which the manager already retitles as they go — "Looking up: auth
    // token scopes" at the bookshelf, "Done: …" on the walk to the mailbox. Neither
    // is free, so the part gets its own:
    //
    //   history label   the round     "Nightly sweep"          never moves in a turn
    //   step            the part      "Ingest mail (2/5)"      moves per step.start
    //   job            the headline  "Looking up: …"          moves per activity
    //
    // Both null for the whole of an ordinary turn, which is nearly all of them: no
    // steps means one step, and a job with no parts must look untouched.
    this.step = null;   // { id, title, index, of }
    this.plan = null;   // { items: [{ id, title, status }], more }

    // Which feed this agent arrived on (a SourceDef from src/data/sources.js), or
    // null if the feed could not say. Worn as a mark on the name tag, and that is
    // the whole point of it being per-agent: an office can be filled by several
    // sources at once, so the tag is how you tell the Claude session from the Rovo
    // terminal at the next desk without going near the title bar.
    this.source = source;

    // Which door of that source they came through — 'cli', 'desktop', 'sdk' (spec
    // §4.7), or null when the harness does not say. The source answers "which
    // program"; this answers "started how", which is the difference between a
    // terminal session and one the desktop app is driving. Shown beside the source
    // in the inspector, not on the name tag: it is a detail you go looking for.
    this.variant = variant;

    // Fixed for this agent's whole shift: it decides which station they break at,
    // and it is shown in the inspector. Injectable so a source could one day
    // supply a known preference rather than rolling one.
    this.drink = drink;

    // Work log, oldest first. Each entry is
    //   { label, outcome: 'active'|'done'|'error', startedAt, endedAt, steps?, plan? }
    // Capped so a long-lived agent can't grow it without bound; the inspector
    // only ever shows the most recent HISTORY_SHOWN anyway.
    this.history = [];

    this.root = group(0, 0, 0);
    this.root.userData.agentId = id;

    this._buildBody();
    this._buildNameTag();
    this._buildStatusRing();

    this.walkPhase = Math.random() * Math.PI * 2;
    /** Where the happy dance is in its cycle. Wound from `dt`, like the walk above. */
    this.dancePhase = 0;
    this.seated = false;
    /** How far into the seated pose they are: 0 standing, 1 sitting. See setSeated. */
    this.seatBlend = 0;
    /** The seat they are lowering onto, kept so `update` can blend toward it. */
    this.seatHeight = SEAT_HEIGHT;
    this.moving = false;
    this.walking = false;    // on their way somewhere, even if held up right now
    this.heldUp = 0;         // seconds spent waiting for somebody to get out of the way
    // On a fixed route — the stairs, currently — rather than free-walking the
    // room. Set only around `follow` in states.js; see crowd.js for why the
    // separation pass leaves these agents alone.
    this.onRoute = false;
    // Which flight that is and which way they are going up it, so the next walker
    // can tell whether the staircase they want is the one already in use, and
    // whether it is in use in their direction. Meaningless unless `onRoute`; see
    // `_mountBlocked` in states.js.
    this.routeFlight = null;
    this.routeDir = 1;
  }

  _buildBody() {
    const g = group(0, 0, 0);
    this.skin = pick(SKIN_TONES);
    const hairC = pick(HAIR_COLORS);

    // --- Legs: hip pivot -> thigh -> knee pivot -> shin -> foot ---
    this.hips = [];
    this.knees = [];
    for (const sx of [-0.18, 0.18]) {
      const hip = group(sx, HIP_Y, 0);
      put(hip, box(0.3, THIGH_LEN, 0.3, 0x35404a, { rough: 0.8 }), 0, -THIGH_LEN / 2);

      const knee = group(0, -THIGH_LEN, 0);
      put(knee, box(0.28, SHIN_LEN, 0.28, 0x35404a, { rough: 0.8 }), 0, -SHIN_LEN / 2);
      put(knee, box(0.3, 0.12, 0.44, 0x22262b, { rough: 0.7 }), 0, -SHIN_LEN + 0.06, 0.08);

      hip.add(knee);
      g.add(hip);
      this.hips.push(hip);
      this.knees.push(knee);
    }

    // --- Trunk: the one pivot a body folds at ---
    //
    // Everything above the hips hangs off this rather than off `g`, so a stoop is one
    // rotation about one joint (see STOOP_BEND). At hip height because that is where a
    // waist is, and taken from HIP_Y rather than written again so the legs and the
    // thing they carry cannot end up pivoting about different points.
    //
    // Positions inside it are measured from the joint, which is why each is its old
    // height less HIP_Y. That subtraction is the whole of the change to this method:
    // nothing moved, it is just parented somewhere that can turn.
    this.trunk = group(0, HIP_Y, 0);
    g.add(this.trunk);

    // --- Torso (agent colour) ---
    this.torso = box(0.8, 1.0, 0.5, this.color, { rough: 0.7 });
    this.torso.position.y = 1.4 - HIP_Y;
    this.trunk.add(this.torso);
    // Everything painted in the agent's colour, kept together so setColor can repaint
    // the outfit without going hunting through the body for it.
    this.shirt = [this.torso];

    // --- Arms: shoulder pivots ---
    this.shoulders = [];
    for (const sx of [-0.52, 0.52]) {
      const shoulder = group(sx, 1.78 - HIP_Y, 0);
      const arm = box(0.22, 0.8, 0.22, this.color, { rough: 0.7 });
      this.shirt.push(arm);
      arm.position.y = -0.4;
      shoulder.add(arm);
      put(shoulder, box(0.2, 0.18, 0.2, this.skin, { rough: 0.6 }), 0, -0.86);
      this.trunk.add(shoulder);
      this.shoulders.push(shoulder);
    }

    // --- Head ---
    this.head = box(0.62, 0.62, 0.62, this.skin, { rough: 0.6 });
    this.head.position.y = AGENT_EYE_Y - HIP_Y;
    this.trunk.add(this.head);

    // --- Hair: varied hairstyles to convey gender diversity ---
    const hairstyle = pick(HAIRSTYLES);
    const hairGroup = buildHairstyle(hairstyle, hairC);
    hairGroup.position.y = AGENT_EYE_Y - HIP_Y;  // head height; internal offsets are relative
    this.trunk.add(hairGroup);
    // Kept on the agent so `setHeadVisible` can take it away with the head.
    this.hair = hairGroup;

    // --- Carryables ---
    this.package = group(0, 1.25 - HIP_Y, 0.5);
    this.package.add(
      box(0.5, 0.4, 0.5, COLORS.parcel, { rough: 0.9 }),
      box(0.12, 0.42, 0.52, COLORS.parcelTape, { cast: false })
    );
    this.package.visible = false;
    this.trunk.add(this.package);

    // A letter is carried, not hefted: held out in one hand at waist height rather
    // than hugged to the chest like the box. Same envelope as the ones stacked in
    // the mailbox — paper, a flap band, and the red airmail stripe — so the thing
    // taken out of the slot is the thing walked back to the desk.
    this.envelope = group(0.2, 1.16 - HIP_Y, 0.42);
    this.envelope.add(
      box(0.44, 0.03, 0.32, COLORS.paper, { rough: 0.85 }),
      box(0.2, 0.034, 0.32, 0xe6dcc4, { rough: 0.85, cast: false }),
    );
    const stripe = box(0.44, 0.036, 0.04, 0xd23b3b, { rough: 0.8, cast: false });
    stripe.position.z = 0.13;
    this.envelope.add(stripe);
    // Tipped up a little, the way you hold something you have just been handed and
    // are half reading on the walk back.
    this.envelope.rotation.x = -0.35;
    this.envelope.rotation.z = 0.12;
    this.envelope.visible = false;
    this.trunk.add(this.envelope);

    // A printout: one loose sheet, held flat and out in front.
    //
    // Its own carryable rather than reusing the envelope, because the point of it is to
    // be *recognisable* from across the room — an agent walking back from the machine
    // with a page is the visible half of "the fax arrived", and an envelope would say
    // the post came instead. Held flat rather than hugged: paper has no weight, so it
    // goes in one hand at waist height, tipped up the way you hold something you are
    // half reading on the walk back. Bigger than the envelope and pale, so the two read
    // apart at a glance rather than only up close.
    this.sheet = group(0.16, 1.18 - HIP_Y, 0.46);
    // Built by the printer's own module, so the page in somebody's hand is the same
    // object the gallery photographs (`printout` in scene/catalogue.js) rather than a
    // second sheet drawn to look like it.
    this.sheet.add(buildPrintout());
    this.sheet.rotation.x = -0.4;
    this.sheet.rotation.z = 0.1;
    this.sheet.visible = false;
    this.trunk.add(this.sheet);

    this.book = group(0, 1.3 - HIP_Y, 0.44);
    this.bookCover = box(0.42, 0.54, 0.1, 0x4f7a8a, { rough: 0.8 });
    this.book.add(this.bookCover);
    const pages = box(0.36, 0.48, 0.12, 0xf4f1e8, { rough: 0.9, cast: false });
    pages.position.z = 0.02;
    this.book.add(pages);
    this.book.rotation.x = -0.5;
    this.book.visible = false;
    this.trunk.add(this.book);

    this.cup = group(0.34, 1.34 - HIP_Y, 0.32);
    this.cupBody = box(0.18, 0.24, 0.18, 0xf4f1e8, { rough: 0.8 });
    this.cup.add(this.cupBody);
    // What's in the cup, so a long black doesn't look like a peppermint tea.
    // Its own material instance: the shared cache would tint every cup at once.
    this.cupBrew = box(0.15, 0.02, 0.15, 0x3a2418, { rough: 0.5, cast: false });
    this.cupBrew.material = this.cupBrew.material.clone();
    this.cupBrew.position.y = 0.12;
    this.cup.add(this.cupBrew);
    this.cup.visible = false;
    this.trunk.add(this.cup);

    this.body = g;
    this.root.add(g);
  }

  // The label is up to three sprites: a static pill with the name (drawn once),
  // a separately tinted circular lozenge, and — when the feed named itself —
  // that source's mark ahead of the lozenge. Tinting a material colour is a cheap
  // uniform change, so the status dot updates reliably without ever having to
  // re-upload a canvas texture. The mark is a sprite for a different reason: it
  // arrives asynchronously (see mark-texture.js) and would otherwise have to
  // invalidate the pill's texture on decode.
  _buildNameTag() {
    const canvas = document.createElement('canvas');
    canvas.width = TAG_W; canvas.height = TAG_H;
    this._tagCanvas = canvas;

    // Tag presentation, switched wholesale by `setTagMode`. Kept on the agent
    // because a rename redraws the pill and has to restore whichever mode is live.
    this._tagMode = 'overlay';
    this._tagScale = 1;
    this._tagFade = 1;
    this._tagIndoors = true;
    // Everyone has a head until a camera climbs inside it. See `setHeadVisible`.
    this._headVisible = true;

    const layout = this._drawNameTag();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this._tagTexture = tex;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false,
    }));
    sprite.position.y = TAG_Y;
    sprite.renderOrder = 999;
    this.nameTag = sprite;
    this.root.add(sprite);
    this._sizeNameTag();

    // --- Status lozenge ---
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: circleTexture(),
      transparent: true,
      depthTest: false,
      color: STATUS_COLORS[this.status] ?? STATUS_COLORS.idle,
    }));
    dot.position.y = TAG_Y;
    dot.renderOrder = 1000;
    this.statusDot = dot;
    this.root.add(dot);

    // --- Source mark ---
    // Only when the feed named itself. The texture arrives in the mark's own
    // colours and is cached per source rather than per agent, so the material tint
    // stays white — three Rovo agents share one texture, and the Claude one beside
    // them has its own. The accent goes in only to give the monochrome marks a
    // `currentColor` to resolve to.
    const markMap = markTexture(this.source?.mark, this.source?.accent);
    if (markMap) {
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({
        map: markMap,
        transparent: true,
        depthTest: false,
      }));
      icon.position.y = TAG_Y;
      icon.renderOrder = 1000;
      this.sourceIcon = icon;
      this.root.add(icon);
    }

    this._placeTagSprites(layout);
  }

  /**
   * Draw the pill and the name into the tag canvas, returning where the sprites
   * that sit on top of it belong. Separate from the sprite setup because a rename
   * has to redraw exactly this and nothing else.
   *
   * @returns {{dotCx: number, iconCx: ?number}} x centres in canvas pixels; a
   *   null `iconCx` means this agent has no source mark to place
   */
  _drawNameTag() {
    const ctx = this._tagCanvas.getContext('2d');

    ctx.clearRect(0, 0, TAG_W, TAG_H);

    const dotR = 21, padL = 26, gap = 18, padR = 30, boxH = 84;
    // The mark is drawn as a sprite, not into this canvas, so all the pill owes
    // it is room. Reserved only when there is a source, so an office without one
    // keeps the tighter pill it had before.
    const iconW = this.source?.mark ? TAG_ICON_PX + TAG_ICON_GAP : 0;
    const chrome = padL + iconW + dotR * 2 + gap + padR;

    // Real sessions are named like colleagues — `Chen Rovocli-Datasource`, not
    // `Ada` — and at the full type size that pill would run off the end of a
    // fixed-width canvas and get clipped mid-word. So shrink to fit, and only
    // ellipsise once shrinking would make the name too small to read across the
    // room.
    let size = TAG_FONT_PX;
    let label = this.name;
    let textW;
    for (;;) {
      ctx.font = tagFont(size);
      textW = ctx.measureText(label).width;
      if (chrome + textW <= TAG_W - TAG_MARGIN || size <= TAG_FONT_MIN_PX) break;
      size -= 2;
    }
    while (chrome + textW > TAG_W - TAG_MARGIN && label.length > 4) {
      label = `${label.slice(0, -2).trimEnd()}…`;
      textW = ctx.measureText(label).width;
    }

    const boxW = chrome + textW;
    const boxX = (TAG_W - boxW) / 2;
    const boxY = (TAG_H - boxH) / 2;

    // Pill background.
    ctx.fillStyle = 'rgba(252,253,249,0.97)';
    roundRect(ctx, boxX, boxY, boxW, boxH, boxH / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(36,50,71,0.28)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Left to right: source mark (if any), status lozenge, name. All vertically
    // centred on the pill.
    const iconCx = iconW ? boxX + padL + TAG_ICON_PX / 2 : null;
    const dotCx = boxX + padL + iconW + dotR;
    const dotCy = boxY + boxH / 2;

    // Name, positioned after the reserved lozenge space.
    ctx.fillStyle = '#243247';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, dotCx + dotR + gap, dotCy + 2);

    this._dotRadiusPx = dotR;
    return { dotCx, iconCx };
  }

  /**
   * Anchor the status lozenge and the source mark to the left of the name.
   *
   * Sprites always face the camera, so the offset is applied in each sprite's own
   * screen space (via `center`) rather than in world space. That keeps them glued
   * to the name at every camera angle — and it has to be recomputed on a rename,
   * because a longer name makes a wider pill and shifts everything left.
   */
  _placeTagSprites(layout) {
    // Remembered so a mode change can re-run the layout at the new scale without
    // having to redraw the canvas to find out where the dot goes.
    this._tagLayout = layout;
    const dotD = (this._dotRadiusPx ?? 21) * 2;
    this._placeTagSprite(this.statusDot, layout.dotCx, dotD);
    this._placeTagSprite(this.sourceIcon, layout.iconCx, TAG_ICON_PX);
  }

  /**
   * Re-run this tag's sizing, for when the legibility correction changes.
   *
   * Public because the manager drives it: a viewport change is not something an
   * individual agent can see, and the sizes are otherwise set once at build.
   */
  resizeTag() {
    this._sizeNameTag();
    if (this._tagLayout) this._placeTagSprites(this._tagLayout);
    this._placeStepChip();
  }

  /** The pill's own size, which is all `_tagScale` means for the name sprite. */
  _sizeNameTag() {
    const s = tagPartScale(this._tagScale);
    this.nameTag.scale.set(TAG_WORLD_W * s, TAG_WORLD_H * s, 1);
  }

  /**
   * Put one tag sprite at a canvas-pixel x centre, sized in canvas pixels.
   *
   * `center` is expressed in multiples of the sprite's own size, hence dividing
   * the offset by it.
   */
  _placeTagSprite(sprite, cx, sizePx) {
    if (!sprite || cx == null) return;
    const pxToWorld = TAG_WORLD_W / TAG_W;
    const sizeWorld = sizePx * pxToWorld;
    const drawn = sizeWorld * tagPartScale(this._tagScale);
    sprite.scale.set(drawn, drawn, 1);
    // `center` is a ratio of the sprite's own size, and scaling shrinks the offset
    // and the sprite by the same factor — so the anchor is scale-invariant and the
    // unscaled numbers are the right ones to divide.
    const offsetWorld = (TAG_W / 2 - cx) * pxToWorld;
    sprite.center.set(0.5 + offsetWorld / sizeWorld, 0.5);
  }

  /**
   * How this agent's name tag relates to the rest of the scene.
   *
   * - `overlay` (default): drawn on top of everything, depth ignored. Correct for
   *   the office view, where the camera is outside the building and a tag hidden by
   *   a wall would be a tag you could never read.
   * - `inWorld`: depth-tested, smaller and slightly translucent, so it sits behind
   *   the monitor it is behind. Correct from inside the room.
   *
   * Deliberately not named after the first-person camera: the agent has no business
   * knowing which lens is in use, only how it has been asked to draw.
   */
  setTagMode(mode) {
    if (mode === this._tagMode) return;
    this._tagMode = mode;
    const inWorld = mode === 'inWorld';

    for (const sprite of [this.nameTag, this.statusDot, this.sourceIcon]) {
      if (!sprite) continue;
      sprite.material.depthTest = inWorld;
      sprite.position.y = inWorld ? TAG_INWORLD_Y : TAG_Y;
      // renderOrder only decides order *within* the transparent pass, so leaving
      // the pill under its dot costs nothing; what matters is that depth testing
      // is back on, which is what stops the pair floating through furniture.
    }

    // Leaving in-world mode drops any fade with it, so the office view is never
    // left showing a tag half-faded by where a camera used to be standing.
    if (!inWorld) this._tagFade = 1;
    this._applyTagOpacity();

    this._tagScale = inWorld ? TAG_INWORLD_SCALE : 1;
    this._sizeNameTag();
    if (this._tagLayout) this._placeTagSprites(this._tagLayout);
  }

  /**
   * Show or hide this agent's own head and hair.
   *
   * For a camera parked behind these eyes. The head box needs no help — the eye sits
   * inside it, so all six faces present their backs and are culled. The hair is the
   * problem, and it took a raycast to see why: it sits *on* the head, so the eye is
   * underneath it looking at its underside, which faces the viewer and is a solid
   * dark slab a tenth of a unit away. It reads as a black band across the top of the
   * view, at every hairstyle, wherever the agent happens to be standing.
   *
   * The head goes too, though it is invisible anyway, so that the guarantee survives
   * someone retuning FPV.eyeForward past the face.
   *
   * The cost is that a hidden mesh casts no shadow, so this agent's shadow loses its
   * head for as long as it is hidden. Only ever one agent, only while their own eyes
   * are the camera, and the alternative is layer masks on every light — not a trade
   * worth making for the outline of a shadow nobody is looking at.
   *
   * Named for what it does rather than for the lens, like `setTagMode`.
   */
  setHeadVisible(visible) {
    if (visible === this._headVisible) return;
    this._headVisible = visible;
    this.head.visible = visible;
    this.hair.visible = visible;
  }

  /**
   * Fade this agent's tag, 0 (gone) to 1 (fully drawn).
   *
   * Only meaningful in `inWorld` mode, where the viewer is close enough for
   * proximity to matter — see FPV.tagFadeNear in config.js for who decides.
   */
  setTagFade(fade) {
    const f = clamp01(fade);
    if (f === this._tagFade) return;
    this._tagFade = f;
    this._applyTagOpacity();
  }

  /**
   * Show the name tag only while this agent is in the room.
   *
   * Called once a frame for everybody from `AgentManager.update`, rather than from the
   * walking, because it has to be true of an agent who is standing still as much as one
   * on the move — and that loop is the one place guaranteed to run for every agent
   * whatever they are doing.
   *
   * Depth alone decides it: everywhere an agent can be outside the room is behind the
   * back wall, whether that is the stoop, the staircase or a lift car.
   */
  refreshTagVisibility() {
    const inside = this.root.position.z > TAG_INDOORS_Z;
    if (inside === this._tagIndoors) return;
    this._tagIndoors = inside;
    this._applyTagOpacity();
  }

  _applyTagOpacity() {
    const base = this._tagMode === 'inWorld' ? TAG_INWORLD_OPACITY : 1;
    const opacity = this._tagIndoors ? base * this._tagFade : 0;
    for (const sprite of [this.nameTag, this.statusDot, this.sourceIcon]) {
      if (!sprite) continue;
      sprite.material.opacity = opacity;
      // A fully faded sprite still costs a draw call and a blend, and there are
      // three of them per agent. Skip them outright once they contribute nothing.
      sprite.visible = opacity > 0.01;
    }
  }

  /**
   * Rename in place — the name lives in a canvas texture, so the pill is redrawn
   * and the status dot re-anchored to the new width. Used when a live session takes
   * on a new job and its surname follows the work (see src/agents/names.js).
   */
  setName(name) {
    if (!name || name === this.name) return;
    this.name = name;
    const layout = this._drawNameTag();
    if (this._tagTexture) this._tagTexture.needsUpdate = true;
    this._placeTagSprites(layout);
  }

  /**
   * Change what somebody is wearing.
   *
   * Only ever used when a harness tells us a colour late — an OpenClaw identity is read
   * one hook after its session starts — so this happens once, seconds in, and never
   * again. `box()` gives every mesh its own material, so the shirt is repainted part by
   * part rather than through a shared one.
   */
  setColor(color, label = null) {
    if (!Number.isFinite(color) || color === this.color) return;
    this.color = color;
    this.colorLabel = label;
    for (const part of this.shirt ?? []) part.material?.color?.setHex(color);
  }

  /**
   * The picture, when one arrives.
   *
   * Later than the colour and for a better reason: the adapter has to upload the file
   * before it can name it, so an avatar is always news. Held rather than drawn — the
   * character in the room is the character, and the portrait belongs in the panel.
   */
  setAvatar(avatar) {
    this.avatar = typeof avatar === 'string' && avatar ? avatar : null;
  }

  _buildStatusRing() {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.08, 8, 24),
      new THREE.MeshStandardMaterial({
        color: STATUS_COLORS.idle, emissive: STATUS_COLORS.idle,
        emissiveIntensity: 0.6, roughness: 0.4,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    this.statusRing = ring;
    this.root.add(ring);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    const c = STATUS_COLORS[status] ?? STATUS_COLORS.idle;
    this.statusRing.material.color.setHex(c);
    this.statusRing.material.emissive.setHex(c);
    this.statusDot.material.color.setHex(c);
  }

  // --- Work log ------------------------------------------------------------

  /** The job currently in flight, if any. */
  openJob() {
    const last = this.history[this.history.length - 1];
    return last && last.outcome === 'active' ? last : null;
  }

  /** Label of the job in flight — handy for reporting what got binned. */
  currentJobLabel() { return this.openJob()?.label ?? null; }

  /**
   * Start logging a job. Re-announcing the job already in flight (which the
   * feed does when an agent returns from the bookshelf) is a no-op, so a single
   * job never shows up as two log entries.
   */
  beginJob(label) {
    if (!label) return;
    const open = this.openJob();
    if (open) {
      if (open.label === label) return;
      // A new job displaced one that never reported an outcome.
      open.outcome = 'done';
      open.endedAt = Date.now();
    }
    this.history.push({
      label, outcome: 'active', startedAt: Date.now(), endedAt: null,
    });
    if (this.history.length > HISTORY_CAP) this.history.shift();
  }

  /**
   * Retitle the job in flight without opening a new log entry. Used when an
   * agent collects a specific request out of the mailbox: they were already
   * marked as starting work, and this is what the work turned out to be.
   */
  renameOpenJob(label) {
    const open = this.openJob();
    if (!open || !label) return false;
    open.label = label;
    this.job = label;
    return true;
  }

  /** Retitle the most recent job, but never an unrelated older entry. */
  retitleLatestJob(label, expected = null) {
    const latest = this.history[this.history.length - 1];
    if (!latest || !label || (expected && latest.label !== expected)) return false;
    latest.label = label;
    this.job = label;
    return true;
  }

  /** Close out the job in flight. `outcome` is 'done' or 'error'. */
  finishJob(outcome = 'done') {
    const open = this.openJob();
    if (!open) return null;
    open.outcome = outcome;
    open.endedAt = Date.now();
    return open;
  }

  /** Most recent entries, newest first. */
  recentJobs(limit = HISTORY_SHOWN) {
    return this.history.slice(-limit).reverse();
  }

  /**
   * Which part of the round is in hand, and the checklist behind it.
   *
   * Deliberately touches neither the job log nor the status: a step is a label, and
   * the office moves people for tool calls, not for parts (spec §4.2 rule 5).
   *
   * The one thing it does write is the tally, onto the open log entry, because that
   * entry outlives the checklist. The plan is cleared when the turn ends but the walk
   * to the mailbox has not happened yet, so by the time "Recent jobs" is drawn the
   * only record of how many parts there were is the one kept here.
   *
   * @param {?object} step  the open step, or null for none
   * @param {?object} [plan]  the checklist; omit to leave the current one alone
   */
  setStep(step, plan) {
    this.step = step ?? null;
    if (plan !== undefined) this.plan = plan ?? null;
    if (this.plan) {
      const open = this.openJob();
      if (open) {
        open.steps = planTally(this.plan);
        // Keep the checklist, not only its fraction. The live plan is cleared at
        // turn.end, but Recent jobs must still be able to open the completed work
        // and show which individual parts passed, failed or were skipped.
        open.plan = {
          items: this.plan.items.map((entry) => ({ ...entry })),
          more: this.plan.more ?? 0,
        };
      }
    }
  }

  /**
   * Show one carryable, or none.
   *
   * `kind` is 'package' | 'letter' | 'book' | 'cup' | null. Package and letter are the
   * two ways work arrives — by courier or by air — and which one a job came by is a
   * coin toss that says nothing about it (see `ARRIVALS` in agents/post.js). Carrying
   * it back out the way it came in is consistency, not significance.
   */
  setCarrying(kind, opts = {}) {
    this.package.visible = kind === 'package';
    this.envelope.visible = kind === 'letter';
    // A fax is carried as what it is: a sheet of paper. It used to fall through
    // to nothing at all, so somebody who had just collected a printout walked back to
    // their desk empty-handed — the one beat of the errand a viewer can actually see,
    // and it was missing.
    this.sheet.visible = kind === 'fax';
    this.book.visible = kind === 'book';
    this.cup.visible = kind === 'cup';
    if (kind === 'book' && opts.color != null) {
      this.bookCover.material = this.bookCover.material.clone();
      this.bookCover.material.color.setHex(opts.color);
    }
    if (kind === 'cup' && opts.color != null) this.cupBrew.material.color.setHex(opts.color);
    this.carrying = kind;
  }

  setPositionXZ(x, z) { this.root.position.set(x, this.root.position.y, z); }

  /**
   * Height of the ground under their feet.
   *
   * Separate from `setPositionXZ`, which deliberately leaves y alone, because the
   * room is one flat plane and almost nothing needs this: only the flight of stairs
   * outside a first-floor door, where an arrival climbs a storey to get in. Kept off
   * `body.position.y`, which is the walk bob and the seat height and is written every
   * frame.
   */
  setElevation(y) { this.root.position.y = y; }
  get position() { return this.root.position; }

  setRotation(y) { this.root.rotation.y = y; }

  faceDirection(dx, dz) {
    if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return;
    const target = Math.atan2(dx, dz);
    let d = target - this.root.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.root.rotation.y += d * 0.2;
  }

  /**
   * Sit down (in a chair or on the couch) or stand back up.
   *
   * Sets where they are going, not where they are. `seated` is the intent and takes
   * effect at once — the crowd rules and the walk cycle both ask about it, and a
   * character halfway into a chair is not available to walk anywhere — while the pose
   * itself is blended across `SIT_SECONDS` by `update`, which is what makes lowering
   * yourself onto a cushion a movement rather than a cut.
   *
   * `instant` skips the blend, for the two callers that are not animating anything: a
   * reduced-motion still frame, and a world being rebuilt around somebody who was
   * already sitting when it came down.
   */
  setSeated(seated, { seatHeight = SEAT_HEIGHT, instant = false } = {}) {
    this.seated = seated;
    this.seatHeight = seatHeight;
    if (instant) {
      this.seatBlend = seated ? 1 : 0;
      // Applied here and not left to the next `update`, because "instant" has to mean
      // the pose is on now: both callers that ask for it are drawing a still frame, and
      // one of them may never tick at all.
      this._applySeatBlend(this.seatBlend);
    }
  }

  /**
   * Put the body somewhere between standing and sitting.
   *
   * Every part of the seated pose is a straight interpolation from its standing value,
   * which is why this reads as one movement: the hips and knees fold at the same rate
   * the body descends, so the shins swing out in front as the character comes down
   * rather than being folded after they land.
   */
  _applySeatBlend(k) {
    this.body.position.y = ((this.seatHeight + 0.06) - HIP_Y) * k;
    for (const hip of this.hips) hip.rotation.x = -SEAT_FOLD * k;
    for (const knee of this.knees) knee.rotation.x = SEAT_FOLD * k;
    for (const s of this.shoulders) s.rotation.x = -Math.PI / 6 * k;
  }

  update(dt, {
    moving = false, typing = false, reading = false, drinking = false, dancing = false,
    stooping = false, dialling = false,
  } = {}) {
    // Whether they are actually on the move, which the crowd rules ask about: a
    // walker who has stopped to let somebody past is standing still, whatever the
    // status label on their head says (see agents/crowd.js).
    this.moving = moving && !this.seated;

    // The lean is the one thing a dance leaves behind, because it is the one thing no
    // other pose writes. Everything else — arms, knees, the hop — is driven back to
    // rest by whichever branch runs next; a tilt would simply stay. Settled here, above
    // all of them, so it unwinds whatever the dancer did next: sat down, walked off, or
    // stood still.
    if (!dancing && this.body.rotation.z !== 0) {
      this.body.rotation.z = Math.abs(this.body.rotation.z) < 1e-3
        ? 0
        : this.body.rotation.z * 0.82;
    }

    // The stoop, settled here for the same reason the dance's lean is: it is a joint no
    // other pose writes, so nothing else would ever put it back. Above the branches
    // rather than inside one because it has to come *off* in whichever pose runs next —
    // walk away from a telescope mid-lookup and you should straighten up on the way, not
    // arrive at your desk still folded over.
    //
    // Only ever asked for while standing. Nobody stoops out of a chair, and a bend
    // applied on top of the seated fold would put a face in the desk.
    const stoopTarget = stooping && !this.seated ? STOOP_BEND : 0;
    if (this.trunk.rotation.x !== stoopTarget) {
      const gap = stoopTarget - this.trunk.rotation.x;
      this.trunk.rotation.x = Math.abs(gap) < 1e-3
        ? stoopTarget
        : this.trunk.rotation.x + gap * STOOP_EASE;
    }

    // Ease toward whichever pose was asked for. Held above the branches below because
    // it governs which of them runs: anybody with any of the seated pose still on them
    // is neither walking nor standing still, they are on their way into or out of a
    // seat, and the pose has to keep moving until it arrives.
    const seatTarget = this.seated ? 1 : 0;
    if (this.seatBlend !== seatTarget) {
      const step = dt / SIT_SECONDS;
      this.seatBlend = seatTarget > this.seatBlend
        ? Math.min(seatTarget, this.seatBlend + step)
        : Math.max(seatTarget, this.seatBlend - step);
    }

    if (dancing && !this.seated) {
      this.dancePhase += dt * DANCE_RATE;
      const t = this.dancePhase;
      const beat = Math.sin(t);
      // Hopping, not floating: the height is the absolute sine, so the figure lands on
      // every beat instead of easing through the bottom of it.
      const hop = Math.abs(beat);
      this.body.position.y = hop * DANCE_HOP;
      this.body.rotation.z = Math.sin(t * 0.5) * DANCE_SWAY;
      // Arms overhead and out of phase, so the two never make one shape.
      this.shoulders[0].rotation.x = DANCE_REACH + beat * 0.45;
      this.shoulders[1].rotation.x = DANCE_REACH - beat * 0.45;
      // Knees soak up the landing: deepest as the hop bottoms out.
      for (const knee of this.knees) knee.rotation.x = (1 - hop) * 0.55;
      this.hips[0].rotation.x = beat * 0.12;
      this.hips[1].rotation.x = -beat * 0.12;
      return;
    }

    if (this.seatBlend > 0) {
      this._applySeatBlend(this.seatBlend);
      // The desk fidgets only once they have actually arrived. Reaching for a keyboard
      // on the way down is an arm doing two things at once, and it looks like it.
      if (this.seated && this.seatBlend >= 1) {
        if (typing) {
          const t = performance.now() * TYPE_SPEED;
          this.shoulders[0].rotation.x = TYPE_REACH + Math.sin(t) * TYPE_TRAVEL;
          this.shoulders[1].rotation.x = TYPE_REACH + Math.sin(t + 1.6) * TYPE_TRAVEL;
        } else if (reading) {
          this.shoulders[0].rotation.x = -Math.PI / 3;
          this.shoulders[1].rotation.x = -Math.PI / 3;
        }
      }
      return;
    }

    if (moving) {
      this.walkPhase += dt * 16;
      const swing = Math.sin(this.walkPhase) * 0.5;
      this.hips[0].rotation.x = swing;
      this.hips[1].rotation.x = -swing;
      // Knees only bend one way (backwards) like real legs.
      this.knees[0].rotation.x = Math.max(0, -swing) * 0.9;
      this.knees[1].rotation.x = Math.max(0, swing) * 0.9;

      // Arms counter-swing, unless carrying something in front.
      if (this.carrying) {
        this.shoulders[0].rotation.x = -Math.PI / 3;
        this.shoulders[1].rotation.x = -Math.PI / 3;
      } else {
        this.shoulders[0].rotation.x = -swing * 0.7;
        this.shoulders[1].rotation.x = swing * 0.7;
      }
      this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.07;
      return;
    }

    // Standing still: ease everything back toward rest.
    const ease = (v, target = 0) => lerp(v, target, 0.2);
    for (const hip of this.hips) hip.rotation.x = ease(hip.rotation.x);
    for (const knee of this.knees) knee.rotation.x = ease(knee.rotation.x);

    if (dialling) {
      // One hand at the screen and the other hanging, which is the half of this that
      // reads as dialling rather than as typing.
      //
      // `shoulders[0]`, and which one is not arbitrary: the touchscreen is cantilevered
      // off the machine's front *right*, and somebody using it has turned to face the
      // machine — so the screen ends up on their left. Shoulder 0 sits at local x −0.52,
      // which the half-turn puts at world +0.52, a couple of centimetres from the panel
      // at +0.54. Shoulder 1 is on the far side, reaching across the machine for a
      // screen behind its own body, which is what the first version did.
      const t = performance.now() * DIAL_SPEED;
      this.shoulders[0].rotation.x = DIAL_REACH + Math.abs(Math.sin(t)) * DIAL_TRAVEL;
      this.shoulders[1].rotation.x = ease(this.shoulders[1].rotation.x);
    } else if (drinking) {
      const t = performance.now() * 0.004;
      this.shoulders[1].rotation.x = -Math.PI / 2.2 + Math.sin(t) * 0.18;
      this.shoulders[0].rotation.x = ease(this.shoulders[0].rotation.x);
    } else if (typing) {
      // Typing on your feet, at a sit-stand desk that has been raised.
      //
      // The same fidget as the seated one above, at a different angle, and the angle is
      // not a taste: an arm here is one box on a shoulder pivot with no elbow, so where a
      // hand can be is a circle round the shoulder rather than a volume it can reach into.
      // Standing puts the shoulder at 1.78 instead of 1.62, and the keys go up by `RISE`
      // with the desk, so the reach that lands a hand on them is a further 12 degrees
      // over. `STANDING_TYPE_REACH` is derived from exactly that sum, next to the rise it
      // is derived with, so a desk that changes height cannot leave this behind — which is
      // the whole reason it is imported rather than written here as another literal.
      const t = performance.now() * TYPE_SPEED;
      this.shoulders[0].rotation.x = STANDING_TYPE_REACH + Math.sin(t) * TYPE_TRAVEL;
      this.shoulders[1].rotation.x = STANDING_TYPE_REACH + Math.sin(t + 1.6) * TYPE_TRAVEL;
    } else if (reading) {
      for (const s of this.shoulders) s.rotation.x = ease(s.rotation.x, -Math.PI / 3);
    } else if (this.carrying) {
      for (const s of this.shoulders) s.rotation.x = ease(s.rotation.x, -Math.PI / 3);
    } else {
      for (const s of this.shoulders) s.rotation.x = ease(s.rotation.x);
    }
    this.body.position.y = ease(this.body.position.y);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      const m = o.material;
      if (m) {
        // Shared textures (e.g. the status circle) outlive individual agents.
        if (m.map && !m.map.__shared) m.map.dispose?.();
        m.dispose?.();
      }
    });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
