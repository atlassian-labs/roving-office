// A sliding-window rate limiter, small enough to read in one sitting.
//
// It exists for exactly one route — `POST /api/offices`, the only unauthenticated
// thing on the server that creates a resource — so it is deliberately not a general
// middleware. No store, no persistence, no headers: it counts recent events under a
// key the caller chooses and says yes or no.
//
// **In memory on purpose.** A limit that survives a restart would need the disk, and
// the disk is the thing being protected; a process that has just restarted has also
// just dropped every ring buffer it was holding, so forgiving the counters with it is
// the honest arithmetic. The cap in lib/office-store.cjs is the part that persists.

'use strict';

/** The stalest hit in a window, used to decide which key to forget first. */
function latest(stamps) {
  return stamps.length ? stamps[stamps.length - 1] : 0;
}

/**
 * Count events per key over a rolling window.
 *
 * A sliding window rather than a fixed one because a fixed window is twice its own
 * limit at the seam — five now and five a second later, if the second lands after the
 * boundary — and the whole point of the number is that it is the number.
 *
 * @param {object} opts
 * @param {number} opts.limit       how many events one key may have in a window
 * @param {number} opts.windowMs    how long an event counts for
 * @param {number} [opts.maxKeys]   how many keys to remember at once, so a caller
 *   cycling spoofed client addresses cannot grow the map without bound
 * @param {() => number} [opts.now] the clock, so a test does not have to sleep
 */
function createRateLimiter({ limit, windowMs, maxKeys = 4096, now = () => Date.now() }) {
  /** @type {Map<string, number[]>} key → the timestamps still inside the window */
  const hits = new Map();
  let tidiedAt = 0;

  /**
   * Drop what has expired, and forget the stalest keys if there are still too many.
   *
   * Forgetting a key can only ever *forgive* — a key with no record starts from zero —
   * so eviction cannot invent a refusal for somebody who was under the limit. It does
   * mean an attacker rotating addresses can clear their own counter, which is why the
   * server pairs this with a whole-server limiter and a hard cap on offices: this
   * limiter's job is to stop one client running away with the endpoint, not to be the
   * only thing standing between the endpoint and a determined flood.
   *
   * Eviction goes well under the ceiling rather than exactly to it, because trimming
   * to `maxKeys` would put the map back over on the very next key and sort the whole
   * thing again — a per-request sort for as long as the flood lasted. Making room in
   * batches costs one sort per quarter of the map instead.
   */
  function tidy(at) {
    tidiedAt = at;
    for (const [key, stamps] of hits) {
      const live = stamps.filter((t) => at - t < windowMs);
      if (live.length) hits.set(key, live);
      else hits.delete(key);
    }
    if (hits.size <= maxKeys) return;
    const keep = Math.max(1, Math.floor(maxKeys * 0.75));
    const stalest = [...hits].sort((a, b) => latest(a[1]) - latest(b[1]));
    for (const [key] of stalest.slice(0, hits.size - keep)) hits.delete(key);
  }

  /**
   * Spend one of this key's allowance.
   *
   * @param {string} key
   * @returns {{ ok: boolean, remaining: number, retryAfterMs: number }} `retryAfterMs`
   *   is when the oldest counted event falls out of the window, which is the earliest
   *   moment a refused caller could succeed.
   */
  function take(key) {
    const at = now();
    // Tidying on a schedule rather than on every call: the sweep is O(keys) and the
    // route it guards is not hot enough to care, but a busy office should not pay for
    // a full scan per request either.
    if (at - tidiedAt >= windowMs) tidy(at);

    const stamps = (hits.get(key) ?? []).filter((t) => at - t < windowMs);
    if (stamps.length >= limit) {
      hits.set(key, stamps);
      return { ok: false, remaining: 0, retryAfterMs: windowMs - (at - stamps[0]) };
    }
    stamps.push(at);
    hits.set(key, stamps);
    // After the insert, not before: checked first, the map settles one key *over* the
    // ceiling and stays there, which is a bound that is quietly not the stated one.
    if (hits.size > maxKeys) tidy(at);
    return { ok: true, remaining: limit - stamps.length, retryAfterMs: 0 };
  }

  /** Give a key its allowance back — for an attempt that was refused further down. */
  function refund(key) {
    const stamps = hits.get(key);
    if (!stamps?.length) return;
    stamps.pop();
    if (stamps.length) hits.set(key, stamps);
    else hits.delete(key);
  }

  return {
    take,
    refund,
    limit,
    windowMs,
    get keys() { return hits.size; },
  };
}

module.exports = { createRateLimiter };
