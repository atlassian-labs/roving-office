//
// A zip writer with no compressor and no clock.
//
// `bin/aop-plugin-pack.cjs` needs a zip because that is the only archive format Claude
// Code's `"source": "archive"` accepts, and it needs the *same bytes* every run because
// the archive it produces is committed and its SHA-256 is written into the marketplace
// JSON beside it. A digest that moves on a rebuild would make `npm test`'s drift check
// fail on a checkout nobody had edited, and would republish an identical plugin under a
// new identity.
//
// Two decisions buy that, and both are the reason this is 90 lines rather than a
// dependency:
//
//   1. **Stored, never deflated.** zlib's output is a function of the zlib version Node
//      was built against, so a deflated entry is reproducible on one machine and not
//      across two — CI runs `node:24-bookworm` and contributors run whatever they have.
//      Stored entries are a function of nothing but the input. The artifact is ~200 KiB
//      and its largest member is a PNG, which deflate cannot shrink anyway.
//   2. **One fixed timestamp.** Zip stores mtimes, so a fresh checkout would otherwise
//      produce a different archive from the one committed an hour earlier. Every entry
//      is stamped 1980-01-01, the earliest a DOS date can express, which is what
//      reproducible-build tooling conventionally uses to mean "no time".
//
// Unix permissions *are* carried, in the external attributes with a UNIX
// version-made-by, because the plugin's hook entry point is a shell script. Nothing
// depends on that surviving extraction — `hooks/hooks.json` invokes it through `sh` for
// exactly that reason — but an extractor that honours the mode should get it right.
//
// No zip64, no encryption, no data descriptors: the members are a handful of source
// files, and the formats those features exist for are not reachable from here.
//

'use strict';

/** CRC-32, the one checksum a zip entry cannot do without. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// 1980-01-01 00:00:00, the zero of the DOS date format: day 1, month 1, year 1980.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

// (3 << 8) says UNIX made this, which is what makes the high half of the external
// attributes a mode rather than DOS flags. 20 is "spec 2.0", plenty for stored entries.
const VERSION_MADE_BY = (3 << 8) | 20;
const VERSION_NEEDED = 10;

/**
 * A zip archive of the given members.
 *
 * Directory entries are deliberately absent. They are optional in the format, and an
 * extractor that writes every entry as a file turns one into a zero-byte file where a
 * directory should be — a failure mode with no upside, since every extractor has to
 * create parent directories for the file entries anyway.
 *
 * @param {{path: string, data: Buffer, mode?: number}[]} entries
 *   Written in the order given, so the caller owns determinism of ordering too.
 * @returns {Buffer}
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    if (entry.path.includes('\\') || entry.path.startsWith('/') || entry.path.includes('..')) {
      throw new Error(`zip: refusing an entry name that escapes the archive: ${entry.path}`);
    }
    const data = entry.data;
    const crc = crc32(data);
    const mode = entry.mode ?? 0o644;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(0, 6);              // no flags: no UTF-8 bit needed, names are ASCII
    local.writeUInt16LE(0, 8);              // method 0 — stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);             // no extra field
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);           // extra
    central.writeUInt16LE(0, 32);           // comment
    central.writeUInt16LE(0, 34);           // disk number
    central.writeUInt16LE(0, 36);           // internal attributes
    central.writeUInt32LE((mode & 0xffff) << 16, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);                        // this disk
  end.writeUInt16LE(0, 6);                        // disk with the directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);                       // no archive comment

  return Buffer.concat([...locals, directory, end]);
}

/**
 * Read back an archive this module wrote.
 *
 * Only stored entries, which is the only kind `zip` produces — a deflated member is a
 * hard error rather than a silent skip, so this can never quietly report a truncated
 * tree. It exists because `--verify` and `npm test` both need to unpack the artifact,
 * and neither may depend on an `unzip` binary being in the image CI runs. Where one
 * *is* on PATH the packer cross-checks against it, so this is the fallback rather than
 * the only reader.
 *
 * @param {Buffer} buf
 * @returns {{path: string, data: Buffer, mode: number}[]}  in central-directory order
 */
function unzip(buf) {
  // The end-of-central-directory record is last, and has no length prefix anywhere
  // else, so it is found by scanning backwards for its signature. 22 bytes minimum,
  // and we never write an archive comment, so the first hit going back is it.
  let end = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('unzip: no end-of-central-directory record');

  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = [];

  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error(`unzip: bad central header at ${at}`);
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const mode = buf.readUInt32LE(at + 38) >>> 16;
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    if (method !== 0) throw new Error(`unzip: ${name} is compressed, and this reader only stores`);

    if (buf.readUInt32LE(localAt) !== 0x04034b50) {
      throw new Error(`unzip: bad local header for ${name}`);
    }
    const localName = buf.readUInt16LE(localAt + 26);
    const localExtra = buf.readUInt16LE(localAt + 28);
    const from = localAt + 30 + localName + localExtra;
    const data = buf.subarray(from, from + size);
    if (crc32(data) !== buf.readUInt32LE(at + 16)) throw new Error(`unzip: ${name} fails its CRC`);

    entries.push({ path: name, data, mode });
    at += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

module.exports = { zip, unzip, crc32 };
