// Which panels were open, and nothing else about them.
//
// The roster covers the corner of the room the camera points at, so somebody who
// puts it away is making a decision about how they want to watch their office —
// and having to make it again on every reload is what made the arrangement feel
// like something the app was merely tolerating. So it is remembered, in the same
// place and under the same rule as where you left the camera: see
// src/local-store.js, which owns what this browser keeps to itself and states the
// one rule for keeping it. Storage is allowed to refuse, and a refusal here means
// the panels open the way they always did.
//
// Per *browser*, not per office. An office is shared by sending someone its URL,
// and how you like the chrome arranged is not part of what you are sending them;
// it is the same call the camera view and the layout shelf already make. It also
// means switching scenes does not rearrange the screen under you.
//
// One entry holding every panel rather than a key each: they are one preference —
// how this screen is laid out — and a reader looking for it in a storage inspector
// should find it all in one place.

import { readJson, writeJson } from '../local-store.js';

const KEY = 'roving-office.panels.v1';

/** The stored map, or an empty one for anything that is not a map. */
function arrangement(storage) {
  const parsed = readJson(KEY, null, storage);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed;
}

/**
 * Was this panel open when it was last opened or closed?
 *
 * `fallback` is the arrangement the app ships with — the roster open, the strips
 * closed — and it is the answer for a browser that has never been here, for one
 * that refuses to remember, and for an entry written by some other version of
 * this office that does not say a boolean.
 *
 * @param {string} id       the panel's element id, e.g. `'dev-panel'`
 * @param {boolean} fallback
 * @param {object} [storage]  a shim, for tests; omitted means this browser's own
 */
export function recallPanel(id, fallback, storage) {
  const open = arrangement(storage)[id];
  return typeof open === 'boolean' ? open : fallback;
}

/**
 * Remember that a panel is open, or is not.
 *
 * @returns {boolean} whether it was actually kept — false in private browsing, a
 *   locked-down embed or a full quota, which is not an error and not worth saying
 *   anything about: the panel is already in the state the caller asked for.
 */
export function rememberPanel(id, open, storage) {
  return writeJson(KEY, { ...arrangement(storage), [id]: Boolean(open) }, storage);
}
