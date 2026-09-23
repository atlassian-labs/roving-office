// The offices this browser has been in.
//
// Nobody owns an office and there is no list of them on the server — a keycard is
// the only way back into one, so losing the keycard loses the office. That makes
// this list less of a convenience than it looks: it is the only record anywhere
// that your office exists, which is why it is written the moment you arrive rather
// than when you leave.
//
// It is per-browser and never leaves it, and a failure to read or write storage is
// never fatal: the wizard simply shows no history. That last part is src/local-store.js's
// job rather than this file's.

import { readJson, writeJson } from '../local-store.js';
import { officeUrl } from './keycard.js';

const KEY = 'roving-office.recent.v1';

/** How many to keep. Past a dozen the wizard is a list to be searched, not read. */
const MAX = 12;

/** @typedef {{keycard: string, at: number}} Visit */

/** Most recently visited first. @returns {Visit[]} */
export function listRecent() {
  const parsed = readJson(KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((v) => v && typeof v.keycard === 'string')
    .map((v) => ({ keycard: v.keycard, at: Number(v.at) || 0 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX);
}

/** Note that we are in this office now, moving it to the top of the list. */
export function rememberRecent(keycard) {
  if (typeof keycard !== 'string' || !keycard) return;
  const kept = listRecent().filter((v) => v.keycard !== keycard);
  writeJson(KEY, [{ keycard, at: Date.now() }, ...kept].slice(0, MAX));
}

/**
 * Drop an office from the list.
 *
 * Used when the server tells us it is gone: a reaped office is not history, it is
 * a dead link, and offering it again would be the one thing this list must not do.
 */
export function forgetRecent(keycard) {
  writeJson(KEY, listRecent().filter((v) => v.keycard !== keycard));
}

/**
 * Is this remembered office still there — and drop it from the list if it is not.
 *
 * Both halves belong here rather than in whatever is drawing the list, because the
 * forgetting is the load-bearing part and it is now asked from two places: reception's
 * list of offices and the same list inside the keycard dialog. Two copies of "a 404
 * means forget it" is one copy that eventually does not.
 *
 * `?peek` rather than a plain `GET`, and that is the whole reason this is not one line:
 * visiting a keycard *creates* the office there, so checking a row with an ordinary read
 * would be the visit that resurrects it and every dead office would look alive forever.
 * A `HEAD` is cheaper still and no use — the app shell answers those too, so it says
 * nothing about whether the *office* exists.
 *
 * Three outcomes, and they are deliberately not two:
 *
 *   * **gone** — the office was reaped for being empty, or its owner closed it. Forgotten
 *     here, so the caller's only job is to say so before the row goes.
 *   * **locked** — it is there and has a passcode. The peek degrades to a summary rather
 *     than refusing precisely so this case cannot be mistaken for the one above; a 401
 *     read as a death would strike a live office out of the only record that it exists.
 *   * **unreachable** — the server did not answer. The row is left alone rather than
 *     accused: a keycard is the only way back into an office, so a flaky network must
 *     never be what loses one.
 *
 * @returns {Promise<{gone: boolean, locked: boolean, reachable: boolean}>}
 */
export async function checkRecent(keycard) {
  try {
    const res = await fetch(`${officeUrl(keycard)}/api?peek=1`);
    if (res.status === 404) {
      forgetRecent(keycard);
      return { gone: true, locked: false, reachable: true };
    }
    if (!res.ok) return { gone: false, locked: false, reachable: false };
    const doc = await res.json().catch(() => null);
    return { gone: false, locked: Boolean(doc?.passcode), reachable: true };
  } catch {
    return { gone: false, locked: false, reachable: false };
  }
}
