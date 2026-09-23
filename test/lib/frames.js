//
// Running the room's clock, in a test.
//
// Nothing in the office happens on its own: a frame arrives, something's `update(dt)`
// is called, and the walk, the queue and the animation advance by that much. So a test
// about behaviour is a loop over frames — and that loop was written out by hand in nine
// files, four of them declaring this same `play` and the rest inlining it, or inlining
// the "run until it happens" form beside it.
//
// There are only two shapes, and which one a test reaches for is what it is asking:
//
//   play(subject, seconds)          let this much of the day pass, then look
//   playUntil(subject, done, limit) wait for something, and say how long it took
//
// `subject` is anything with an `update(dt)` — an `AgentManager` for a test about the
// room, an `AgentController` for one about a single movement. Sixty frames to the
// second, matching the browser, because the durations a test asserts about (a walk
// taking four seconds, a coffee run rolled for once a minute) are written in seconds.
//
// Both take real time nowhere: the clock is the loop, so a test can run two minutes of
// office in a few milliseconds and never wait on a timer.
//
// `node --test` treats every file under `test/` as a test file, so this one is reported
// in the run as a file with no tests in it. That is the whole cost of it living beside
// the tests that use it, and it is the right place for it: nothing outside `test/` has
// any business running the room a frame at a time.
//

/**
 * Let the room run for `seconds` of simulated time, at 60fps.
 *
 * @param {{ update: (dt: number) => void }} subject
 * @param {number} seconds  may be fractional — `1 / 60` is one frame
 */
export function play(subject, seconds) {
  for (let i = 0; i < seconds * 60; i++) subject.update(1 / 60);
}

/**
 * Run frames until `done()` or the clock runs out; says how long it took.
 *
 * The predicate is asked *after* each frame, so a condition already true when the
 * first frame lands reports 0 rather than being missed. `null` means the limit was
 * reached without it ever coming true, which is the failure a test asserts against —
 * `assert.ok(playUntil(...) !== null)` is "this actually happened", and the number is
 * there for the tests that also care how soon.
 *
 * @param {{ update: (dt: number) => void }} subject
 * @param {() => unknown} done   truthy when the thing being waited for has happened
 * @param {number} [limit]       seconds to give up after
 * @returns {number|null} seconds elapsed, or null if it never happened
 */
export function playUntil(subject, done, limit = 60) {
  for (let i = 0; i < limit * 60; i++) {
    subject.update(1 / 60);
    if (done()) return i / 60;
  }
  return null;
}
