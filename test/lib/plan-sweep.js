// The seeded sweep, generated once per process.
//
// `test/plan-generator.test.js` and `test/plan-score.test.js` both ask questions of the
// *same* two hundred and forty seeds — `sweep-0` … `sweep-239` — and between them used to
// call `generateOffice` about fifteen hundred times to do it, because each test rebuilt
// the slice it wanted. An office costs ~50 ms to generate, so that was the whole of those
// files' runtime: around eighty seconds of work where twelve would do.
//
// Nothing about the coverage needed to change. `generateOffice` is deterministic — that is
// the first thing `plan-generator.test.js` asserts — so the tenth caller asking for
// `sweep-77` is guaranteed the object the first caller got. Generating it once and handing
// the same array to every test is not a shortcut; it is the only honest reading of a
// deterministic function.
//
// **Read-only.** Every office here is shared, so a test that hands one to something which
// mutates it would corrupt the sweep for every test after it — and, because `node:test`
// runs a file's tests in order, corrupt them in a way that looks like a failure somewhere
// else entirely. `applyLayout` is the one known such caller. Use `cloneLayout` for it.
//
// Per process, not per suite: `node --test` runs each file in its own process, so the two
// files still pay for one sweep each. Twelve seconds against eighty is worth having
// without reaching for a cross-process cache, which would need invalidating whenever
// anything under `src/plan/` changed and would go stale silently the one time it mattered.
import { generateOffice } from '../../src/plan/index.js'

/** How many seeds the sweep covers. Enough to be a claim; quick enough to run. */
export const SWEEP = 240

/** The seed list itself, so a test that only wants the text does not build a room. */
export const seeds = Array.from({ length: SWEEP }, (_, i) => `sweep-${i}`)

let cache = null

/**
 * Every office in the sweep. Built on the first call, reused by every call after.
 *
 * Lazy rather than eager at import: a file that imports `seeds` for the text alone — or a
 * future one that wants a different slice — should not pay twelve seconds for rooms it
 * never looks at.
 */
export function sweep() {
  if (cache === null) cache = seeds.map((seed) => generateOffice(seed))
  return cache
}

/** The first `n` offices of the sweep. The whole sweep is generated either way. */
export function sweepSlice(n) {
  return sweep().slice(0, n)
}

/**
 * A private copy of one office's layout, for a caller that will mutate it.
 *
 * `applyLayout` takes ownership of what it is given, so handing it a shared office is how
 * you poison the sweep. A structured clone costs microseconds against the fifty
 * milliseconds a regeneration would, which is the whole reason this helper exists rather
 * than a "just call generateOffice again here" comment.
 */
export function cloneLayout(office) {
  return structuredClone(office.layout)
}
