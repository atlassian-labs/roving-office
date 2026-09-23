// Seeds, and the streams of randomness a seed hands out.
//
// A seed is a *phrase*, the way a Minecraft world's is: `brass-lantern-4417`
// names one office and will always name that office. Anything can be a seed —
// a number, a keycard, a scene id, a sentence somebody typed — because the only
// thing the generator ever does with it is hash it.
//
// Two rules here, and both are about not lying to whoever holds the seed.
//
// **A stage gets its own stream, hashed from the seed and the stage's name.**
// Not derived arithmetically from one root stream, which is the trap Minecraft
// itself fell into: feature seeds computed by multiplying and adding the world
// seed produce degenerate streams for some seeds, and features start repeating
// along a diagonal (`minecraft.wiki/w/Anomalous_world_seeds`). Re-hashing the
// pair cannot correlate two stages that way. It buys a second thing that
// matters more day to day: the stages are *independent*, so changing how the
// planting works cannot reshuffle the desks. A seed's room stays the room it
// was, feature by feature, as this code grows.
//
// **A stream is drawn from in a fixed order or it is not deterministic at all.**
// Every helper below takes exactly one draw per call — `chance` costs one,
// `pick` costs one, `int` costs one — so a caller can count its draws, and a
// branch that skips a draw shifts everything after it. That is the whole
// contract; `weighted` is the only one that walks a list, and it still draws
// once.

/**
 * Hash a string into a well-mixed 32-bit state generator (xmur3).
 *
 * Called for its output rather than its uniqueness: what a PRNG wants is a full
 * state, and a small seed spread badly across one is how a generator starts its
 * life in a corner of its own period.
 */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * sfc32: small, fast, and long-period enough that no office will ever see it
 * repeat. Four words of state, all four taken from the hash above.
 */
function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * A stream of draws, with the handful of questions the generator ever asks.
 *
 * A class rather than a bare function because every one of these is a place
 * where a plain `Math.random()` call would silently break determinism, and a
 * method is harder to reach for by accident than an import.
 */
export class Stream {
  constructor(next) {
    this.next = next;
  }

  /** A float in [0, 1). One draw. */
  float() { return this.next(); }

  /** An integer in [lo, hi], inclusive both ends. One draw. */
  int(lo, hi) {
    if (hi <= lo) return lo;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** A float in [lo, hi). One draw. */
  range(lo, hi) { return lo + this.next() * (hi - lo); }

  /** True with probability `p`. One draw. */
  chance(p) { return this.next() < p; }

  /** One of these, evenly. One draw. */
  pick(list) {
    if (!list.length) return null;
    return list[Math.min(list.length - 1, Math.floor(this.next() * list.length))];
  }

  /**
   * One of these, by weight — `[[value, weight], …]` or `{key: weight}`.
   *
   * Weights rather than a repeated list because the weights are the *design*:
   * "mostly six to nine desks, occasionally a packed floor" is a sentence about
   * offices, and a list with the same entry written nine times is that sentence
   * spelled out badly.
   */
  weighted(table) {
    const entries = Array.isArray(table) ? table : Object.entries(table);
    const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    if (total <= 0) return entries[0]?.[0] ?? null;
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= Math.max(0, weight);
      if (roll < 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  /** A shuffled copy. One draw per element bar the first (Fisher–Yates). */
  shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * `n` values in [0, 1), for the places that want a whole handful at once.
   *
   * Only so the count of draws is obvious at the call site, which is the whole
   * reason this class exists.
   */
  floats(n) {
    return Array.from({ length: n }, () => this.next());
  }
}

/**
 * The stream this seed hands to this stage.
 *
 * @param {string} seed   the whole seed, as text
 * @param {string} stage  what is being decided: 'brief', 'desks', 'planting', …
 */
export function streamFor(seed, stage) {
  const hash = xmur3(`the-roving-office/${seed}::${stage}`);
  return new Stream(sfc32(hash(), hash(), hash(), hash()));
}

/**
 * A number in [0, 1) for a point on the floor: the same seed and the same point
 * always give the same number, and nothing about it depends on when it is asked.
 *
 * This is what the placement scans tie-break on, and it is deliberately *not* a
 * draw from a stream. A scan scores a few hundred candidate positions and keeps
 * the best; taking a draw per candidate would make the stream's position depend
 * on how many candidates there happened to be, so adding one lattice step
 * somewhere would move every later decision in the room. A field over the floor
 * has no order to depend on — score it forwards, backwards, or half of it, and
 * the same position wins.
 *
 * Quantised to a tenth of a unit, which is finer than the finest lattice any
 * caller uses, so two candidates are never handed the same number by accident.
 *
 * @param {string} seed
 * @param {string} salt  what is being placed: 'couch', 'plant-3', …
 */
export function fieldAt(seed, salt, x, z) {
  const hash = xmur3(`${seed}::${salt}::${Math.round(x * 10)},${Math.round(z * 10)}`);
  return hash() / 4294967296;
}

/**
 * Any seed, as the text the generator will hash.
 *
 * Numbers, keycards and scene ids all arrive here, and all of them are simply
 * printed: there is no canonical form to normalise to, because a seed means
 * nothing except to the hash. Trimmed, though, so `"amber "` and `"amber"` are
 * one office rather than two — a trailing space is a typo and never a choice.
 */
export function seedText(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return String(input);
  if (typeof input === 'string' && input.trim()) return input.trim();
  return null;
}

/**
 * Words a minted seed is made of.
 *
 * Two pools and a number, so a seed is something a person can read out over a
 * desk — `slate-orchard-2210` — rather than eight characters of base36 nobody
 * will ever type twice. 64 × 64 × 10000 is forty million of them, and any other
 * string is a seed too, so the pools are for legibility and not for the size of
 * the space.
 */
const SEED_ADJECTIVES = [
  'amber', 'ashen', 'brass', 'bright', 'candid', 'cedar', 'chalk', 'clay',
  'copper', 'coral', 'crisp', 'dusty', 'early', 'ember', 'fern', 'flint',
  'gilded', 'glass', 'golden', 'granite', 'hazel', 'humid', 'indigo', 'inky',
  'ivory', 'lantern', 'lilac', 'linen', 'marble', 'mellow', 'mint', 'misty',
  'mossy', 'northern', 'olive', 'opal', 'paper', 'pewter', 'plum', 'quiet',
  'russet', 'saffron', 'sage', 'salt', 'sandy', 'slate', 'smoky', 'soft',
  'sorrel', 'southern', 'sparrow', 'spruce', 'steel', 'stone', 'sunlit',
  'tawny', 'teal', 'thistle', 'umber', 'velvet', 'walnut', 'warm', 'willow',
  'winter',
];

const SEED_NOUNS = [
  'anchor', 'annex', 'arbour', 'arcade', 'atrium', 'bay', 'beacon', 'bench',
  'bridge', 'brook', 'burrow', 'cabinet', 'cairn', 'canal', 'chapter',
  'cistern', 'cloister', 'commons', 'compass', 'corner', 'cove', 'dock',
  'ferry', 'foundry', 'gable', 'gallery', 'garden', 'gate', 'harbour',
  'hollow', 'kiln', 'lantern', 'ledger', 'lighthouse', 'loft', 'meadow',
  'mill', 'orchard', 'parlour', 'pier', 'quarry', 'quay', 'reef', 'ridge',
  'sawmill', 'signal', 'spindle', 'stable', 'station', 'studio', 'terrace',
  'thicket', 'tide', 'trellis', 'vault', 'verge', 'vessel', 'warren',
  'weather', 'wharf', 'window', 'workshop', 'yard', 'yarn',
];

/**
 * A fresh seed nobody has used, in the readable form above.
 *
 * `Math.random` on purpose, and it is the one place in the generator allowed to
 * call it: minting a seed is the moment *before* determinism starts. Everything
 * downstream of the string this returns is a pure function of it.
 */
export function mintSeed(rng = Math.random) {
  const adj = SEED_ADJECTIVES[Math.floor(rng() * SEED_ADJECTIVES.length)];
  const noun = SEED_NOUNS[Math.floor(rng() * SEED_NOUNS.length)];
  const n = Math.floor(rng() * 10000).toString().padStart(4, '0');
  return `${adj}-${noun}-${n}`;
}
