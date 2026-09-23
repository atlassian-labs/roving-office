// The office's own dice: the choices nobody needs to be able to reproduce.
//
// Two kinds of randomness live in this repo and they are not the same thing.
// `src/plan/rng.js` is the *seeded* generator: a seed names one office, so every
// draw there is repeatable and counted, and the whole module exists to keep it
// that way. This file is the other kind — which shirt an arriving character
// pulls on, how long a thinking pause runs, which book goes on the shelf. Nobody
// will ever ask for that room back, so these draws come straight off the global
// `Math.random`.
//
// They were spelled out by hand at fifty-odd call sites, and declared eight
// times under seven names besides (`pick`, `_pick`, `kbPick`, `chance`,
// `kbRand`, `between`, `_count`) — which is how
// `list[Math.floor(Math.random() * list.length)]` ends up among the most-typed
// lines in the office. Stating them once is mostly about reading:
// `chance(P_BREAK)` says what the number is for, where `Math.random() < P_BREAK`
// says how it is computed.
//
// Two properties of this file are load-bearing and neither is obvious:
//
//   1. **Every helper takes exactly one draw**, the same one the hand-written
//      line took. `bin/lib/headless-scene.js` replaces `Math.random` with a
//      seeded stream so a screenshot or the coplanar probe can compare one
//      build against another, and under that stream the *order and number* of
//      draws is the whole of determinism. A helper that drew twice, or drew
//      before evaluating its arguments, would silently re-dress every scene.
//   2. **`Math.random` is read at call time, never captured.** That same seeding
//      happens after this module is imported, so a `const random = Math.random`
//      here would hand every caller the unseeded original.

/** One of these, evenly. `undefined` from an empty list, as the index says. */
export const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * True with probability `p`.
 *
 * `Math.random() >= p` is exactly `!chance(p)` and reads here as one. A handful
 * of skip guards are written `Math.random() > p` instead and are deliberately
 * left as they are (src/scene/building.js, outlooks/skyline.js,
 * outlooks/streetscape.js): `>` and `>=` are the same predicate for every draw
 * except `p` itself, and one of those guards can have `p === 0`, where the two
 * genuinely disagree. Not a difference anybody would ever see — but "identical"
 * is cheaper to keep than "near enough".
 */
export const chance = (p) => Math.random() < p;

/**
 * A whole number in [lo, hi], both ends included.
 *
 * Distinct from `Stream.int` in src/plan/rng.js, which answers `lo` for an
 * inverted range because a generator handed a nonsense range should still
 * produce a room. Here an inverted range is a bug in the caller and reads like
 * one: `whole(3, 1)` is `3 + Math.floor(random * -1)`, which is 3 or 2.
 */
export const whole = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/**
 * `base`, plus up to `span` more.
 *
 * The same arithmetic as `between(base, base + span)` and deliberately not
 * written that way. `hi - lo` is not `span` in floating point — 0.8 - 0.3 is
 * 0.5000000000000001 — and the scene's geometry is compared against a recorded
 * baseline at full precision (test/coplanar-baseline.json), so which of the two
 * a caller wrote has to survive. Both exist because both are what the call
 * sites mean: a jitter on top of a floor, or somewhere in a range.
 */
export const spread = (base, span) => base + Math.random() * span;

/** Somewhere in [lo, hi). */
export const between = (lo, hi) => lo + Math.random() * (hi - lo);
