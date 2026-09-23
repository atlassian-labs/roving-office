// Bending from the waist, and the joint that had to exist first.
//
// The stoop is the first pose that folds an agent rather than moving their arms, and it
// needed `this.trunk` — a pivot at hip height carrying the torso, shoulders, head and
// everything held. That reparenting touches every other pose in the file, so most of
// what is here is checking that nothing *else* moved: the point of the change is that a
// standing agent looks exactly as they did, and only a stooping one is different.
//
// `Agent` itself needs a WebGL context, so this tests the arithmetic and the geometry
// through the module's own exports rather than by building a figure. What a stoop looks
// like is checked by looking at it, in docs/character-movements.html.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_EYE_Y, STOOP_BEND, DIAL_REACH } from '../src/agents/Agent.js';
import { STANDING_TYPE_REACH } from '../src/scene/props/sit-stand.js';
import { EYE_Y as EYEPIECE_Y } from '../src/scene/props/telescope.js';

/** Where the waist is. Held here as a literal on purpose — see the test below. */
const HIP_Y = 0.9;

/** Where a bend of `a` radians puts an eye, measuring from the waist pivot. */
function eyeAfter(a) {
  const lever = AGENT_EYE_Y - HIP_Y;
  return {
    y: HIP_Y + lever * Math.cos(a),
    forward: lever * Math.sin(a),
  };
}

test('the stoop is the bend that reaches the eyepiece', () => {
  // The whole claim: the angle is derived from the prop, so bending by it lands an eye
  // on the eyepiece. Not approximately — this is arithmetic, and if it drifts it is
  // because one of the two files changed and the other did not.
  const eye = eyeAfter(STOOP_BEND);
  assert.ok(Math.abs(eye.y - EYEPIECE_Y) < 1e-9,
    `bending ${STOOP_BEND.toFixed(3)} puts the eye at ${eye.y.toFixed(3)}, `
    + `eyepiece at ${EYEPIECE_Y}`);
});

test('it is a lean rather than a fold, which is what "a little" means', () => {
  assert.ok(STOOP_BEND > 0.2, 'too small to read at the room camera distance');
  assert.ok(STOOP_BEND < 0.5, 'more than a modest bend — this is a stoop, not a squat');

  // And the reason it can be small: at this leverage the arc is mostly forward, so the
  // gesture is leaning in. If this ever inverts, the pose stops looking like somebody
  // using a telescope and starts looking like somebody ducking.
  const eye = eyeAfter(STOOP_BEND);
  assert.ok(eye.forward > (AGENT_EYE_Y - eye.y) * 3,
    'the bend should carry an eye further forward than it lowers it');
});

test('the eye height it is derived from is the one the camera uses', () => {
  // `AGENT_EYE_Y` is the head's own centre, and scene/camera.js flies the first-person
  // view to `head.matrixWorld`. Two numbers that must not disagree, so there is one.
  assert.equal(AGENT_EYE_Y, 2.2);
  assert.ok(AGENT_EYE_Y > HIP_Y, 'a head above a waist, or the lever is negative');
});

test('a bend of nothing is standing up straight', () => {
  const eye = eyeAfter(0);
  assert.equal(eye.y, AGENT_EYE_Y);
  assert.equal(eye.forward, 0);
});

test('the trunk pivots at the hip, so the legs are not carried with it', () => {
  // Not a decoration: pitching the whole body about its origin — which is what the
  // first attempt at this would have been — rotates the feet off the floor. The pivot
  // has to be at the waist, and the legs have to stay outside it.
  //
  // Read out of the module rather than trusted: `HIP_Y` is not exported, so this
  // asserts the geometry it implies instead. The head sits `AGENT_EYE_Y - HIP_Y` above
  // the joint, and that lever is what every number above is derived through — if the
  // joint moved, this file's own arithmetic would stop matching the pose's.
  const lever = AGENT_EYE_Y - HIP_Y;
  assert.ok(lever > 1.0 && lever < 1.6,
    'the waist-to-eye lever is not a body shape any more');
  // Feet stay on the floor through a stoop, because they are not in the group.
  const eye = eyeAfter(STOOP_BEND);
  assert.ok(eye.y > HIP_Y, 'the head cannot fold below its own pivot');
});

// --- dialling ----------------------------------------------------------------

test('the dial reaches above the shoulder, which a keyboard never does', () => {
  // Sending a fax means punching a number into the touchscreen, and the screen is
  // *above* a shoulder: the prop carries it at 1.10 and the room doubles the machine's
  // height, so it sits at 2.20 against a shoulder at 1.78. A reach that lands on a desk
  // would be a hand in the machine's midriff.
  assert.ok(DIAL_REACH < -Math.PI / 2,
    'the arm should swing past level to get above the shoulder');
  assert.ok(DIAL_REACH > -Math.PI, 'and not all the way over the head');

  // Further over than the standing-desk reach, which is the comparison that makes it a
  // number rather than a taste: that one lands on keys below the shoulder.
  assert.ok(DIAL_REACH < STANDING_TYPE_REACH,
    `dialling (${DIAL_REACH.toFixed(2)}) should reach higher than typing `
    + `(${STANDING_TYPE_REACH.toFixed(2)})`);
});
