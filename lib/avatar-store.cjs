/**
 * Somewhere to keep the faces.
 *
 * An agent's avatar is a file on the machine the *agent* runs on — `Avatar:
 * avatars/paige-turner.jpg` in an `IDENTITY.md`, on a gateway in another country — and the
 * office is a browser somewhere else entirely. Nothing can be linked; the bytes have to
 * travel. So an adapter uploads the picture once and thereafter names it in events, and
 * this is where the uploaded bytes live.
 *
 * **Content-addressed**, by SHA-256 of the bytes, which decides most of the design for us:
 *
 * - The same avatar uploaded by five agents is stored once.
 * - An upload is idempotent, so an adapter that cannot remember what it has already sent
 *   may simply send again — and a restarted gateway does exactly that.
 * - The name of a file is a claim that can be *checked*, so a mismatched upload is
 *   rejected rather than trusted. Without that, the address is a slot anybody can stuff.
 * - Cached forever by the browser, because bytes that hash to X are always the same bytes.
 *
 * Stored outside any one office, next to the office registry, since two offices watching
 * one gateway are watching the same faces. Knowing the hash is what grants access to the
 * picture, and you only learn the hash from an event in an office you can already read.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** 2 MB. Comfortable for a portrait, nowhere near enough to be a file host. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * What an avatar may be, sniffed from the bytes themselves.
 *
 * The uploader's opinion of its own file is not consulted: the type is read from the
 * leading bytes, and anything unrecognised is refused. That rules out SVG on purpose —
 * an SVG is a document that can carry script, and this one would be served from the
 * office's own origin.
 */
const SIGNATURES = [
  { type: 'image/png', ext: '.png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', ext: '.jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', ext: '.gif', test: (b) => b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { type: 'image/webp', ext: '.webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

/** `image/png` → `.png`, for a file already on disk. */
const TYPE_BY_EXT = new Map(SIGNATURES.map((s) => [s.ext, s.type]));

const HASH = /^[0-9a-f]{64}$/;

/** The bytes → `{ type, ext }`, or `null` if this is not an image we will serve. */
function sniff(bytes) {
  return SIGNATURES.find((s) => s.test(bytes)) ?? null;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function createAvatarStore({ dir, maxBytes = MAX_BYTES, log = () => {} }) {
  let ready = false;

  /** Made on first write, not at boot: an office where nobody has a face needs no folder. */
  function ensureDir() {
    if (ready) return;
    fs.mkdirSync(dir, { recursive: true });
    ready = true;
  }

  /**
   * The stored file for a hash, whatever extension it landed under, or `null`.
   *
   * Four `existsSync` calls rather than a directory listing, because a listing grows with
   * the number of avatars and this does not.
   */
  function find(hash) {
    if (!HASH.test(String(hash ?? ''))) return null;
    for (const { ext, type } of SIGNATURES) {
      const file = path.join(dir, hash + ext);
      if (fs.existsSync(file)) return { file, type, ext };
    }
    return null;
  }

  return {
    MAX_BYTES: maxBytes,

    /** Is this a hash-shaped name at all? Checked before anything touches the disk. */
    validName: (hash) => HASH.test(String(hash ?? '')),

    has: (hash) => find(hash) !== null,

    /** `{ file, type }` for serving, or `null`. The type is the sniffed one, never a header. */
    get: find,

    /**
     * Store bytes claimed to hash to `hash`.
     *
     * @returns {{ stored: boolean, type: string }} `stored: false` when it was already here,
     *   which is the common case for a gateway that has restarted and is offering its
     *   avatars again.
     * @throws {Error} with a `code` of 400 or 413 — a claim that does not check out, a type
     *   we will not serve, or a file too big to be a portrait.
     */
    put(hash, bytes) {
      if (!HASH.test(String(hash ?? ''))) {
        throw Object.assign(new Error('avatar name must be a sha-256 hex digest'), { code: 400 });
      }
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        throw Object.assign(new Error('empty avatar'), { code: 400 });
      }
      if (bytes.length > maxBytes) {
        throw Object.assign(new Error(`avatar larger than ${maxBytes} bytes`), { code: 413 });
      }
      const actual = sha256(bytes);
      if (actual !== hash) {
        // The whole guarantee of a content-addressed store, in one comparison.
        throw Object.assign(new Error(`avatar does not hash to its name (${actual})`), { code: 400 });
      }
      const kind = sniff(bytes);
      if (!kind) {
        throw Object.assign(new Error('avatar must be a png, jpeg, gif or webp'), { code: 400 });
      }
      const existing = find(hash);
      if (existing) return { stored: false, type: existing.type };
      ensureDir();
      // Written beside and renamed, so a reader can never see a half-written face.
      const file = path.join(dir, hash + kind.ext);
      const temp = `${file}.${process.pid}.part`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, file);
      log(`[office] avatar stored ${hash.slice(0, 12)}… (${kind.type}, ${bytes.length} bytes)`);
      return { stored: true, type: kind.type };
    },
  };
}

module.exports = { createAvatarStore, MAX_BYTES, TYPE_BY_EXT, sha256, sniff };
