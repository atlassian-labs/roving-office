// Turning a quantity into a number between 0 and 1.
//
// Three scorers in this repo ask the same shape of question — the office
// scorecard (src/plan/score.js), the looks judge together with the measures that
// have not earnt a weight yet (bin/lib/looks-judge.js,
// bin/lib/looks-candidates.js), and the composite the autoresearch loop ratchets
// on (bin/office-fitness.js) — and each of them carried its own copy of these
// one-liners. They belong in one place because a measure is only comparable to
// another measure if "1" means the same thing in both: a ramp that clamps at one
// call site and not at another gives two scores that look like the same units and
// are not.
//
// `clamp01` is here for the same reason a rung lower down: the scene uses it to
// hold animation progress and a daylight fraction inside their range
// (src/scene/beam.js, src/scene/lighting.js), and it is the clamp that makes a
// ramp a measure rather than a slope.
//
// Deliberately arithmetic and nothing else. Nothing in this file knows what a
// desk or a rug is, which is what lets the looks judge use it while staying
// independent of the generator it is meant to judge from the outside (see that
// file's header).

/** Nothing outside 0 to 1 — the range every measure here has to land in. */
export const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** 0 below `lo`, 1 at or above `hi`, straight line between. */
export const ramp = (v, lo, hi) => clamp01((v - lo) / (hi - lo));

/** 1 inside the band, falling away outside it by `slack`. */
export function band(v, lo, hi, slack) {
  if (v >= lo && v <= hi) return 1;
  const off = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - off / slack);
}

/**
 * The average, and what an empty list averages to.
 *
 * `empty` is a policy rather than a detail, and the callers disagree about it
 * deliberately: the scorecard answers 1, because a room with no desks in it has
 * not failed the daylight measure — there is nothing left unlit — while the looks
 * judge answers 0, because a room with nothing worth looking at is not a room
 * that looks good. Naming it here keeps the disagreement readable at the call
 * site instead of hiding it in three copies of the same loop.
 */
export const mean = (list, empty = 0) => (
  list.length ? list.reduce((a, b) => a + b, 0) / list.length : empty
);

/** How much of a list passes a test. An empty list has nothing failing it. */
export const share = (list, test) => (list.length ? list.filter(test).length / list.length : 1);
