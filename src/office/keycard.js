// Keycards: the name of an office, and the whole of its address.
//
// An office is reached at /office/<keycard> and by nothing else — there is no
// login, no owner and no listing. The keycard *is* the capability: unguessable
// enough to be private, short enough to read down a corridor. "Public but
// hidden", which is why the alphabet below matters more than it looks.
//
// Crockford base32: the digits plus A-Z with I, L, O and U removed. The first
// three go because `1/I/l` and `0/O` are the two mistakes everyone makes when
// copying a code by eye, and Crockford's answer — accept them on input, never
// emit them — is exactly what a keycard typed from a screenshot needs. U goes
// because without it almost no English profanity can be spelled, and a keycard is
// something people paste into team chat.
//
// Eight characters is 32^8 ≈ 1.1e12 offices. The hyphen is grouping only and is
// not stored: KEYCARD `K7F29QBX` and `k7f2-9qbx` are the same office.
//
// server.cjs loads this module (the one definition of the format) rather than
// keeping its own copy: client-side validation that disagreed with the server's
// would mean a wizard that accepts a keycard the server then rejects.

/** Crockford base32, in canonical emit order. */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters per half, and so the hyphen's position. */
export const GROUP = 4;

/** Total significant characters in a keycard. */
export const LENGTH = GROUP * 2;

/**
 * Confusable inputs, folded to what the reader meant.
 *
 * Only ever applied on the way in. Nothing here is ever produced, so a keycard
 * cannot come out of `mint()` needing this table to be read back.
 */
const FOLD = { I: '1', L: '1', O: '0', U: 'V' };

/**
 * The reserved demo office: the authored scenes, and the one office never reaped.
 *
 * Spelled in the same alphabet as every other keycard so it needs no special case
 * anywhere but the store — it is a real office that happens to have a memorable
 * address. Not `DEMO-0000`, however much that reads better: `O` is one of the four
 * letters the alphabet drops, so that string is not a keycard at all and the fold
 * would quietly send it to `DEM0-0000` — a different, empty office.
 */
export const DEMO_KEYCARD = 'TEST-0000';

/**
 * Fold one keycard-ish string into its canonical form, or null if it is not one.
 *
 * Deliberately generous: hyphens, spaces, lower case and the confusable letters
 * are all things a human hand does to a code between reading it and typing it,
 * and none of them change which office was meant. Anything left over that is not
 * in the alphabet is a typo, not a keycard, and gets a null rather than a guess.
 *
 * @param {unknown} input
 * @returns {?string} `XXXX-XXXX`, or null
 */
export function parseKeycard(input) {
  if (typeof input !== 'string') return null;
  let out = '';
  for (const raw of input.trim().toUpperCase()) {
    if (raw === '-' || raw === ' ' || raw === '_') continue;   // grouping, in any dialect
    const ch = FOLD[raw] ?? raw;
    if (!ALPHABET.includes(ch)) return null;
    out += ch;
    if (out.length > LENGTH) return null;
  }
  if (out.length !== LENGTH) return null;
  return format(out);
}

/** True if this is a keycard we would hand out. */
export function isKeycard(input) {
  return parseKeycard(input) !== null;
}

/**
 * The same folding, applied to a half-typed keycard — for an input mask.
 *
 * `parseKeycard` is all-or-nothing because a lookup has to be, but someone typing
 * has been through every prefix of the string on the way there, and a field that
 * refuses to show what they typed until the eighth character is a field that feels
 * broken. So this keeps whatever is legal, drops whatever is not, and groups what
 * it has: `k7f` → `K7F`, `k7f2 9` → `K7F2-9`.
 *
 * @param {string} input
 * @returns {string} up to LENGTH characters, hyphenated once there are more than GROUP
 */
export function foldPartial(input) {
  let out = '';
  for (const raw of String(input ?? '').toUpperCase()) {
    if (out.length >= LENGTH) break;
    const ch = FOLD[raw] ?? raw;
    if (ALPHABET.includes(ch)) out += ch;
  }
  return out.length > GROUP ? format(out) : out;
}

/** Group the significant characters for reading: `K7F29QBX` → `K7F2-9QBX`. */
export function format(chars) {
  const flat = String(chars).toUpperCase();
  return `${flat.slice(0, GROUP)}-${flat.slice(GROUP)}`;
}

/**
 * A fresh keycard that is not already taken.
 *
 * `taken` is asked rather than assumed, because the only authority on which
 * offices exist is the store — and minting a keycard that already names someone
 * else's office would hand a stranger the keys to it. After enough collisions we
 * give up rather than spin: at 1.1e12 addresses that outcome means the random
 * source is broken, and a caller deserves to hear so instead of hanging.
 *
 * @param {(keycard: string) => boolean} [taken]  is this one already in use?
 * @param {object} [opts]
 * @param {(n: number) => Uint8Array} [opts.bytes]  a CSPRNG; see randomBytes below
 * @param {number} [opts.tries]
 * @returns {string}
 */
export function mint(taken = () => false, { bytes = randomBytes, tries = 32 } = {}) {
  for (let i = 0; i < tries; i++) {
    const candidate = format(randomChars(LENGTH, bytes));
    if (!taken(candidate)) return candidate;
  }
  throw new Error('keycard: could not mint an unused keycard');
}

/**
 * `n` characters of the alphabet, uniformly.
 *
 * Rejection sampling rather than `% 32`: the alphabet is exactly 32 long so the
 * modulo would in fact be uniform today, but it is the kind of correctness that
 * quietly breaks the day someone adds a letter back.
 */
function randomChars(n, bytes) {
  const buf = bytes(n * 2);
  let out = '';
  let i = 0;
  while (out.length < n) {
    if (i >= buf.length) { i = 0; buf.set(bytes(buf.length)); }
    const b = buf[i++];
    if (b >= 256 - (256 % ALPHABET.length)) continue;   // would skew the tail
    out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}

/**
 * Cryptographic randomness, or nothing at all.
 *
 * A keycard is a capability: it is the only thing standing between an office and
 * anyone who fancies guessing at one, so `Math.random()` is not an acceptable
 * fallback here — it is seeded predictably, it is not designed to resist anyone, and
 * a keycard minted from it would *look* exactly as random as a good one. Refusing is
 * the honest failure, and any runtime without `globalThis.crypto` (Node before 19,
 * for one) can pass its own: see `mint`'s `bytes` option, which is how server.cjs
 * hands in `crypto.randomBytes`.
 */
function randomBytes(n) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('keycard: no cryptographic randomness available — pass mint({ bytes })');
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/**
 * The keycard named by a URL path, or null for anywhere else.
 *
 * One reader for the app shell, the API and the AOP routes, so `/office/k7f2-9qbx`
 * and `/office/K7F2-9QBX/aop/v0/stream` cannot disagree about whose office they
 * are talking about.
 *
 * @param {string} pathname
 * @returns {?{keycard: string, rest: string}} `rest` keeps its leading slash, or ''
 */
export function officePath(pathname) {
  const m = /^\/office\/([^/]+)(\/.*)?$/.exec(pathname || '');
  if (!m) return null;
  const keycard = parseKeycard(decodeURIComponent(m[1]));
  if (!keycard) return null;
  return { keycard, rest: m[2] ?? '' };
}

/** Where an office lives. */
export function officeUrl(keycard, { seed = null } = {}) {
  // A seed rides in the query string rather than the path, because it is not part
  // of the address: the office is the keycard, and the seed is a one-time
  // instruction about how to furnish the room the first time anybody opens it
  // (see `adopt()` in office.js). Drop it and you are still in the same office.
  return seed
    ? `/office/${keycard}?seed=${encodeURIComponent(seed)}`
    : `/office/${keycard}`;
}
