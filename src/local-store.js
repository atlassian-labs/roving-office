// What this browser keeps to itself, and the one rule for keeping it.
//
// An office lives on the server (lib/office-store.cjs), because an office is
// shared by sending someone its URL. What stays here is only the part that is
// yours: which room you are standing in, the offices you have visited, the
// layouts on your shelf, where you left the camera, whether you asked the debug
// log for test data. None of it is worth a network round trip and none of it
// should follow the keycard to anyone else.
//
// The rule is that storage is allowed to refuse. Private browsing, a locked-down
// embed and a full quota all present as a throw from `getItem`/`setItem`, and in
// every case the answer is the same: carry on without the memory. A missing
// history shows an empty wizard, a missing camera uses the configured lens, a
// missing layout shelf is an empty dropdown — never a failed boot.
//
// Five modules used to state that rule for themselves, each with its own
// try/catch and its own comment about private mode: src/office/office.js,
// src/office/recent.js, src/editor/layouts.js, src/scene/camera-view.js and
// src/debug/debuglog.js. Stating it once is what makes it a rule instead of five
// habits, and it means a refusal cannot be handled correctly in four places and
// forgotten in the fifth.
//
// `storage` is an optional override on every reader and writer, for tests that
// hand in a shim (test/camera-view.test.js passes one that throws, which is the
// only way to exercise a refusal in Node). Omitted, it means this browser's own
// `localStorage`; reaching for that is itself inside the try, because a page in a
// sandboxed frame throws on the *property* rather than on the call.

function shelfFor(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.window?.localStorage ?? null; } catch { return null; }
}

/** The string stored under `key`, or `fallback` when there is none to be had. */
export function readText(key, fallback = null, storage) {
  try { return shelfFor(storage)?.getItem(key) ?? fallback; } catch { return fallback; }
}

/** Store a string. @returns {boolean} whether it was actually kept. */
export function writeText(key, value, storage) {
  try {
    const shelf = shelfFor(storage);
    if (!shelf) return false;
    shelf.setItem(key, value);
    return true;
  } catch { return false; }
}

/**
 * The JSON stored under `key`, or `fallback`.
 *
 * A blank or absent entry is `fallback` rather than a parse error, and so is
 * anything that is not JSON at all: what a previous version of this office wrote
 * is not this version's problem, so the callers still have to check the shape of
 * what comes back.
 */
export function readJson(key, fallback = null, storage) {
  try {
    const raw = shelfFor(storage)?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

/** Store a value as JSON. @returns {boolean} whether it was actually kept. */
export function writeJson(key, value, storage) {
  try { return writeText(key, JSON.stringify(value), storage); } catch { return false; }
}
