// The three shapes every mapper builds, stated once.
//
// A mapper's job is per-harness — which hook means what, where the session id
// hides, which of five field names holds the tool output. But three mechanics
// underneath that are not per-harness at all, and each had grown a copy in every
// mapper that needed it: the per-session bookkeeping record, the rule that an
// unknown field must not overwrite a known one, and the result byte count.
//
// They live in `lib/` for the same reason as `tool-classes.cjs`: `aop-send`
// resolves `./mappers/<harness>.cjs` from the harness name, so a module sitting
// directly beside the mappers would be loadable as a harness called "lib".

'use strict';

/**
 * The mapper's memory of one session, created on first sight.
 *
 * Every mapper needs the same fields and for the same reasons — `seq` to invent
 * ids for tool calls a harness does not identify, `started`/`turnOpen` to honour
 * the spec's "introduced before used" rule, `tools` to pair an end with its
 * start, `todo` for the step list. A mapper may be the first thing to touch
 * `state`, so the sessions map is created here too.
 */
function stateFor(state, id) {
  state.sessions ??= {};
  if (!state.sessions[id]) {
    state.sessions[id] = { seq: 0, started: false, turnOpen: false, tools: {}, todo: {} };
  }
  return state.sessions[id];
}

/** Keys worth merging: `undefined` must not overwrite something we already knew. */
function defined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

/**
 * How big the result was. A byte count is metadata, not content — it survives
 * even the strictest redaction mode, and it is what makes a 4 kB read look
 * different from a 400 kB one.
 *
 * Takes the result itself rather than the payload, because only the mapper knows
 * which of its harness's field names is carrying it.
 */
function resultBytes(value) {
  if (value == null) return undefined;
  try {
    return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
  } catch { return undefined; }
}

module.exports = { stateFor, defined, resultBytes };
