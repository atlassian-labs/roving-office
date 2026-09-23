//
// Driving a harness mapper, in a test.
//
// A mapper is a pure function of one hook event: `map({ event, payload, state, … })`
// in, a list of AOP events out. Nothing about that is hard to call — but a mapper's
// whole design shows up *across* calls rather than in one (a held introduction, a turn
// safety net, a step list that advances), so every mapper test drives a sequence
// through one persistent state bag, exactly as `bin/aop-send.cjs` does per hook
// process. Four files wrote that driver out by hand, two of them identically.
//
//   const fire = driver(mapper);
//   const state = { sessions: {} };
//   fire(state, 'SessionStart', payload);
//   fire(state, 'UserPromptSubmit', payload, { redaction: 'metadata' });
//
// What a test varies goes in a named options object rather than a bare fourth
// argument, which could as easily read as any of the three: `redaction` (how much a
// payload is allowed to say), `sessionTitle` (the name the harness gives the work,
// which arrives a moment after the turn opens and so must be answerable at call
// time) and `endpointId` (which receiver is listening, and so whether a session has
// to introduce itself again).
//
// `node --test` treats every file under `test/` as a test file, so this one is
// reported in the run as a file with no tests in it — the same cost `test/lib/frames.js`
// and `test/lib/room.js` pay for living beside their callers.
//

'use strict';

const { MAPPER_HELPERS } = require('../../bin/lib/aop-core.cjs');

/**
 * Bind a `fire(state, event, payload, options)` to one mapper.
 *
 * `helpers` is the production bag from aop-core, not a fixture: a test that assembled
 * its own could pass while the real hook process handed the mapper something else.
 *
 * `endpointId` defaults to a fixed value because the mappers that read it only care
 * whether it *changed* — a constant means "still the same office", which is what a
 * test asserting about anything else wants. The tests about re-introduction pass a
 * different one deliberately.
 *
 * `sessionTitle` is the answer the harness gives when asked for the name of the work,
 * and it may be a function instead of a string: a mapper reads the title lazily and
 * bounds how often it does so, so a test about *that* has to be the thing being asked
 * rather than merely supply an answer.
 *
 * @param {{ map: (options: object) => object[] }} mapper
 * @returns {(state: object, event: string, payload: object, options?: {
 *   redaction?: 'metadata'|'summary'|'full', endpointId?: string|null,
 *   sessionTitle?: string|null|(() => string|null),
 * }) => object[]}
 */
function driver(mapper) {
  return function fire(state, event, payload, {
    redaction = 'summary', endpointId = 'ep-1', sessionTitle = null,
  } = {}) {
    return mapper.map({
      event, payload, state, redaction, helpers: MAPPER_HELPERS, endpointId,
      readTitle: typeof sessionTitle === 'function' ? sessionTitle : () => sessionTitle,
    });
  };
}

module.exports = { driver };
