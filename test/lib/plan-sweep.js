// The seeded sweep: generated once per process, and in parallel.
//
// `test/plan-generator.test.js` and `test/plan-score.test.js` both ask questions of the
// *same* two hundred and forty seeds — `sweep-0` … `sweep-239`, identical `SWEEP` in each
// — and between them used to call `generateOffice` about fifteen hundred times to do it,
// because every test rebuilt the slice it wanted. An office costs ~50 ms, so that was
// essentially the whole of those files' runtime: about eighty seconds of work where
// twelve would do, and those two files were 83 s of a 61 s suite.
//
// Two changes, and the order matters because the second is worthless without the first.
//
// **Generate once.** `generateOffice` is deterministic — it is the first thing
// `plan-generator.test.js` asserts — so the tenth caller asking for `sweep-77` is
// guaranteed the object the first caller got. Sharing one array is not a shortcut, it is
// the only honest reading of a deterministic function. Parallelising *before* doing this
// would only have spread the wasted work across more cores.
//
// **Then generate in parallel.** 240 independent CPU-bound calls is the shape a worker
// pool is for, and an office is ~9 KB of plain data, so posting the results back costs
// nothing against the 50 ms each took to build.
//
// **Read-only.** Every office here is shared, so a test that hands one to something which
// mutates it corrupts the sweep for every test after it — and because `node:test` runs a
// file's tests in order, it corrupts them in a way that looks like a failure somewhere
// else entirely. `applyLayout` is the one known such caller; `cloneLayout` is for it.
//
// Per process, not per suite: `node --test` gives each file its own process, so the two
// files still build one sweep each. That is duplicated *CPU* but not duplicated *wall
// clock*, because the files run concurrently — which is why a cross-process cache is not
// worth the staleness it would introduce. A cached sweep would need invalidating whenever
// anything under `src/plan/` changed, and would go quietly stale the one time it mattered.
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'

/** How many seeds the sweep covers. Enough to be a claim; quick enough to run. */
export const SWEEP = 240

/** The seed list itself, so a test that only wants the text does not build a room. */
export const seeds = Array.from({ length: SWEEP }, (_, i) => `sweep-${i}`)

/**
 * Workers to spread the sweep across.
 *
 * Capped well below the core count on purpose. `node --test` is already running this file
 * alongside ninety-odd others at full concurrency, so a pool sized to the machine would
 * oversubscribe it and slow every other file down to speed this one up. Four is enough to
 * turn twelve seconds into three, and leaves the rest of the suite alone.
 */
const WORKERS = Math.max(1, Math.min(4, availableParallelism() - 1))

const WORKER_URL = new URL('./plan-sweep-worker.js', import.meta.url)

let pending = null

/**
 * Every office in the sweep, as a promise. Built on the first call, reused after.
 *
 * Asynchronous because the work is done off-thread, which is why the tests that use it
 * are `async` — a small price for the only change that moves the suite's floor.
 */
export function sweep() {
  if (pending === null) pending = build()
  return pending
}

/** The first `n` offices of the sweep. The whole sweep is built either way. */
export async function sweepSlice(n) {
  return (await sweep()).slice(0, n)
}

async function build() {
  // Contiguous chunks rather than round-robin: the seeds are independent, so there is
  // nothing to balance, and contiguous slices keep the reassembly below a plain concat.
  const size = Math.ceil(SWEEP / WORKERS)
  const chunks = []
  for (let i = 0; i < SWEEP; i += size) chunks.push(seeds.slice(i, i + size))

  const results = await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: { seeds: chunk } })
    worker.once('message', (offices) => { worker.terminate(); resolve(offices) })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      // A worker that exits without posting is a generator that threw, and the suite
      // should say so rather than hang on a promise nobody resolves.
      if (code !== 0) reject(new Error(`sweep worker exited ${code}`))
    })
  })))

  return results.flat()
}

/**
 * A private copy of one office's layout, for a caller that will mutate it.
 *
 * `applyLayout` takes ownership of what it is given, so handing it a shared office is how
 * you poison the sweep. A structured clone costs microseconds against the fifty
 * milliseconds a regeneration would, which is why this exists rather than a "just call
 * generateOffice again here" comment.
 */
export function cloneLayout(office) {
  return structuredClone(office.layout)
}
