// The offices this browser owns, and the whole of what "owning" means.
//
// An office's write token is minted with the office and returned exactly once, by the
// one response in the server that hands out a write capability to a caller who presented
// none (`POST /api/offices`). Holding it is the whole of being that office's owner:
// there is no account, no sign-up, no password reset and no user store anywhere in this
// project, and none of those are wanted. Every privileged act on an office — adding a
// machine, revoking one, setting a passcode, closing the room — asks for that token and
// nothing else. Capability begets capability, and this file is where the browser's copy
// of the first capability lives.
//
// **It used to live nowhere.** `mintOffice` read `keycard` out of the mint response and
// dropped the rest on the floor, so an office cut at reception — the front door, and the
// way almost every office is made — had a write token that existed for the length of one
// `await` and then for nobody. That office was permanently unownable: no second machine
// could be added to it, no token revoked, no passcode set, and no way to close it if its
// link leaked. Everything else in this module exists to hold one string so that is no
// longer true.
//
// A **separate store** from src/office/recent.js, deliberately. That list is capped at a
// dozen and evicts the oldest, which is right for a history and would be indefensible
// here: an eviction there must never silently destroy a credential. Offices are dropped
// from this one only when they are closed, or when the server says they are gone.
//
// Two things worth being honest about, both said plainly in
// docs/user/sharing-an-office.md rather than left to be discovered:
//
//   * **There is no recovery.** Clear this browser's storage, or open the office on your
//     phone, and you stop being its owner. The office keeps working — the keycard still
//     opens it — you have simply lost the ability to close or re-passcode it. The
//     mitigation is the one the CLI already uses: the token is shown once, at mint time,
//     as something to save.
//   * **This is a write credential in `localStorage`**, so it inherits the office page's
//     DOM-XSS posture, and the page renders agent-supplied strings. The trade is still
//     the right one — an office nobody can close is the worse defect by a distance — but
//     it is a trade and not a free win.

import { readJson, writeJson } from '../local-store.js';

/**
 * Versioned, like every other key this browser keeps.
 *
 * A shape this file cannot read is discarded rather than migrated (see `all`), so the
 * version in the name is what lets a future shape arrive without pretending the old one
 * was compatible.
 */
const KEY = 'roving-office.owner.v1';

/** @returns {Record<string, string>} keycard → write token, for the shapes we can read */
function all() {
  const parsed = readJson(KEY, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [card, token] of Object.entries(parsed)) {
    if (typeof token === 'string' && token) out[card] = token;
  }
  return out;
}

/**
 * Keep an office's write token, because this browser just minted it.
 *
 * @param {string} keycard
 * @param {string} token   the plaintext from the mint response — the only copy there is
 * @returns {boolean} whether storage actually kept it. False is survivable and not
 *   worth interrupting anyone about: private browsing and a full quota both present
 *   this way, and the office you are walking into works perfectly well unowned.
 */
export function remember(keycard, token) {
  if (typeof keycard !== 'string' || !keycard) return false;
  if (typeof token !== 'string' || !token) return false;
  return writeJson(KEY, { ...all(), [keycard]: token });
}

/**
 * The write token for this office, if this browser holds it.
 *
 * @returns {?string}
 */
export function tokenFor(keycard) {
  return all()[keycard] ?? null;
}

/** Whether this browser can do anything to this office beyond watch it. */
export function owns(keycard) {
  return Boolean(tokenFor(keycard));
}

/**
 * Forget an office's token.
 *
 * Called when the office is closed, which is the only case that is certainly right:
 * there is nothing left to own. A reaped office is *not* forgotten here, because
 * visiting its keycard makes a room at that address again — and the token still opens
 * it, since the tokens went with the office that was reaped. Better a dead string than
 * a live office nobody can close.
 */
export function forget(keycard) {
  const held = all();
  if (!(keycard in held)) return false;
  delete held[keycard];
  return writeJson(KEY, held);
}

/**
 * The header that presents this office's token, or nothing.
 *
 * `X-Roving-Office-Token` rather than `Authorization`, and the server's `suppliedToken`
 * says why: hosting layers inject and rewrite `Authorization`, so the custom header is
 * the one nothing in the way touches. Spread into a `fetch` init, so a caller with no
 * token sends no header at all rather than an empty one.
 */
export function authHeader(keycard) {
  const token = tokenFor(keycard);
  return token ? { 'X-Roving-Office-Token': token } : {};
}
