// One worker's share of the seeded sweep.
//
// **The `isMainThread` guard is not defensive tidiness — without it this file fails the
// suite.** `node --test` collects every `.js` under `test/`, so it runs this one directly
// as a test file; on the main thread there is no `workerData` to read and no port to post
// to. Guarded, a direct run is a no-op that reports zero tests, which is what a helper
// should do. `test/lib/dockerignore.js` and `test/lib/plan-sweep.js` are collected the
// same way and are inert for the same reason.
import { isMainThread, workerData, parentPort } from 'node:worker_threads'
import { generateOffice } from '../../src/plan/index.js'

if (!isMainThread) {
  // Offices are plain data — ~9 KB each, structured-clone clean — so posting them back
  // costs far less than the ~50 ms each takes to build. That is the whole reason this is
  // worth a worker at all: the work is CPU-bound and the result is cheap to move.
  parentPort.postMessage(workerData.seeds.map((seed) => generateOffice(seed)))
}
