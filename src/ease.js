// Moving a value from where it was to where it is going, over a progress of 0 to 1.
//
// Every animation in this office is written the same way: something works out how
// far through it is — `Math.min(1, elapsed / seconds)` — bends that progress into a
// curve so the movement has weight, and interpolates between two numbers with it.
// The bending and the interpolating were both written out by hand wherever they
// were needed: two declarations of `lerp`, three of smoothstep under three names
// (`smooth`, `smooth`, `ease`) and two more spelled straight into the expression
// that used them, plus a dozen hand-inlined `a + (b - a) * t`.
//
// They belong in one place because the curve is a house style rather than a local
// choice. A cone of light coming down out of the sky, a parcel leaving a courier's
// hands, a card sliding across a kanban board and a desk motor raising a worktop
// are all the same movement to the eye — a push and then a stop — and they read as
// one office because they share a curve, not because four files happen to agree.
//
// This is the sibling of src/measure.js and not part of it: a measure turns a
// quantity into a score that is compared against other scores, while these turn a
// progress into a position that is only ever looked at. Sharing `clamp01` is as
// close as the two get.

import { clamp01 } from './measure.js';

/** Straight line from `a` to `b`. `t` is how far along, 0 to 1. */
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Ease in and out: a push, then a stop.
 *
 * The office's default curve, and what a thing with mass does when something
 * starts it moving and then catches it again.
 *
 * The progress is clamped because one caller cannot promise its own is in range
 * (src/scene/props/sit-stand.js, whose worktop is asked where it should be rather
 * than told how long it has been travelling). The others cap theirs on the way in
 * and a clamp on an in-range number costs nothing.
 */
export const smoothstep = (t) => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};

/**
 * Ease out only: away at full pace, then a settle.
 *
 * For a movement that was already underway before this part of it started — a
 * character crossing the last of the floor to a chair they have been walking
 * towards, who should arrive gently but has no reason to set off gently.
 */
export const easeOut = (t) => {
  const k = clamp01(t);
  return 1 - (1 - k) * (1 - k);
};
