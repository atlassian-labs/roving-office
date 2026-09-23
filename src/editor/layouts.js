// The layouts this browser has saved.
//
// Per-browser and never leaves it, on the same terms as the office history
// (src/office/recent.js): a saved layout is *yours* — the office on the server
// knows nothing about it — and a failure to read or write storage is never
// fatal, it just means the dropdown is empty. What travels between people is
// the blob itself, through Export and Import, which is why the name rides
// inside the blob: a layout pasted to a colleague arrives already called
// something.
//
// Names are the identity here. Saving under an existing name replaces that
// layout — the natural reading of "save as Cosy Corner" when Cosy Corner
// already exists — and renaming onto a taken name is refused rather than
// quietly merging two layouts into one.

import { readJson, writeJson } from '../local-store.js';

const KEY = 'roving-office.layouts.v1';

/** @typedef {{name: string, at: number, blob: object}} SavedLayout */

/** In the order they were first saved — a shelf, not a feed. @returns {SavedLayout[]} */
export function listLayouts() {
  const parsed = readJson(KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v) => v && typeof v.name === 'string' && v.blob
    && typeof v.blob === 'object');
}

/** The saved layout called `name`, or null. */
export function getLayout(name) {
  return listLayouts().find((l) => l.name === name) ?? null;
}

/**
 * Save a layout under a name, replacing any layout already called that.
 *
 * The name is written into the blob as well as beside it, so an Export of this
 * layout carries it and an Import elsewhere can offer it back.
 *
 * @param {string} name
 * @param {object} blob  as produced by `layoutSnapshot()`
 * @returns {?SavedLayout} what was stored, or null for a blank name
 */
export function saveLayout(name, blob) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || !blob || typeof blob !== 'object') return null;
  const entry = { name: trimmed, at: Date.now(), blob: { ...blob, name: trimmed } };
  const kept = listLayouts();
  const i = kept.findIndex((l) => l.name === trimmed);
  if (i >= 0) kept[i] = entry;   // replaced in place, so the shelf keeps its order
  else kept.push(entry);
  writeJson(KEY, kept);
  return entry;
}

/**
 * Rename a saved layout. Refused when the new name is blank, or already taken
 * by a different layout — a rename must never quietly swallow one.
 *
 * @returns {boolean} whether the rename happened
 */
export function renameLayout(from, to) {
  const next = typeof to === 'string' ? to.trim() : '';
  if (!next || next === from) return false;
  const kept = listLayouts();
  if (kept.some((l) => l.name === next)) return false;
  const entry = kept.find((l) => l.name === from);
  if (!entry) return false;
  entry.name = next;
  entry.blob = { ...entry.blob, name: next };
  writeJson(KEY, kept);
  return true;
}

/** Drop a saved layout. Deleting what is not there is not an error. */
export function deleteLayout(name) {
  writeJson(KEY, listLayouts().filter((l) => l.name !== name));
}

/**
 * Are these the same room?
 *
 * Compared with the `name` set aside, because the name is a label on the plan
 * and not part of it: "Cosy Corner" and an unnamed export of the identical
 * furniture are one layout. Both sides come from `layoutSnapshot()`, which
 * builds its families in one code path, so serialised comparison is exact
 * rather than approximate.
 */
export function sameLayout(a, b) {
  return stripName(a) === stripName(b);
}

/** The name of the first saved layout matching this blob, or null. */
export function matchingLayout(blob, layouts = listLayouts()) {
  const plain = stripName(blob);
  return layouts.find((l) => stripName(l.blob) === plain)?.name ?? null;
}

function stripName(blob) {
  if (!blob || typeof blob !== 'object') return 'null';
  const rest = { ...blob };
  delete rest.name;
  return JSON.stringify(rest);
}
