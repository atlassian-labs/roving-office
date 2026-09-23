// The post: what is in the mailbox, and whose it is.
//
// Two kinds of envelope share one box, and the difference is about ownership
// rather than looks:
//
//   unaddressed  Work nobody owns yet — a queued ticket, a scheduled job. The
//                first agent to reach the box takes it, and that race is real:
//                two agents can set off and only one can win.
//   addressed    A prompt typed into one specific session. Only its recipient can
//                open it, so nobody else so much as walks over.
//
// Addressing happens when the envelope is *posted*, not when it is collected,
// which is what lets the room be honest about work in flight: a plane already
// tinted with its recipient's colour is visibly for somebody.
//
// This is deliberately a plain module with no scene and no Three.js in it. The
// ownership rules have all the edge cases — post for an agent who leaves
// mid-flight, an agent arriving at the box before their plane does, a queue that
// outruns the walking — and rules like that are worth being able to test without
// a browser in the room.

// --- How does this piece of work arrive? ----------------------------------
//
// Work arrives by air as a paper plane, or by courier as a parcel thrown in
// through the door. **Which one is a coin toss, and means nothing.**
//
// That is a deliberate simplification. It used to mean something: small
// work came as a letter, big work as a package, and since the feed gives us
// nothing to tell them apart — an AOP prompt is a line of text and nothing else —
// the office *guessed*, off a list of words like "refactor" and "typo" and a
// square-rooted lean on the title's length. Eighty-odd lines of it.
//
// The guess had to go, for two reasons. It was wrong often enough to notice, and
// being wrong is worse than saying nothing: a room that labels work "big" is
// making a claim, and a claim nobody can check is noise dressed as information.
// And the distinction it drew was not real. A letter and a parcel are the same
// thing — a job — and everything downstream treated them the same, so the only
// thing the inference bought was two animations chosen for a bad reason.
//
// So the animations stay and the meaning goes. Arrivals are drawn by weight and
// not by anything about the job (`ARRIVAL_WEIGHTS`), which keeps the room varied
// without pretending the variety is data — the weights are about which animation
// is worth seeing most often, which is a question about the room and not about
// the work. A printout or an incoming fax joins this list as a third way in and
// needs nothing else.

/**
 * The ways work can arrive, which is also what an agent carries when it does.
 *
 * A list rather than a pair, because the point is that it is extensible: adding a
 * fax means adding a string here and an animation to go with it, and no rule
 * anywhere has to learn about faxes.
 */
export const ARRIVALS = ['letter', 'package', 'fax'];

/**
 * How much of the draw each way in gets, relative to the others.
 *
 * **The mailbox counts double**. Not because a letter means more than a
 * parcel — nothing about the work decides the channel, and that is still the whole
 * point — but because the window is the room's front door for work. It is the arrival
 * with the flag, the pile, and now two vehicles of its own, and an even three-way split
 * left the thing people watch for arriving a third of the time. The courier and the fax
 * machine split the rest evenly between them: they are alternatives to the plane, not
 * rivals to each other.
 *
 * A channel absent from the pool weighs nothing, so the shares renormalise over whatever
 * the room actually has — a room with no fax machine is letter-two-parcel-one, not
 * letter-two-parcel-one-and-a-quarter-of-nothing.
 */
export const ARRIVAL_WEIGHTS = { letter: 2, package: 1, fax: 1 };

/**
 * How this job arrives. Nothing about the work decides it.
 *
 * Weighted rather than uniform (see {@link ARRIVAL_WEIGHTS}), which is why this walks
 * the pool instead of indexing into it. An unlisted channel still draws — weight 1, the
 * same as the fax — so a new way in arrives on the day its string is added and can be
 * given a share afterwards if it wants one.
 *
 * @param {() => number} [rng]  injectable so the toss can be pinned in a test
 * @param {string[]} [channels]  the ways in that are switched on, which the courier
 *   toggle narrows (see `enabledArrivals` in layout.js). A one-sided coin is not a
 *   special case: with the courier off, every arrival is a letter.
 * @return {string} one of {@link ARRIVALS}
 */
export function arrivalFor(rng = Math.random, channels = ARRIVALS) {
  const pool = channels.length ? channels : ARRIVALS;
  const shareOf = (a) => ARRIVAL_WEIGHTS[a] ?? 1;
  const total = pool.reduce((n, a) => n + shareOf(a), 0);
  let roll = rng() * total;
  for (const a of pool) {
    roll -= shareOf(a);
    // `< 0` and not `<= 0`: a toss of exactly 1 lands roll on 0 at the last channel,
    // and `<=` would hand it to the first instead of falling through to the end.
    if (roll < 0) return a;
  }
  return pool[pool.length - 1];
}

/** One envelope's expectation counter is bumped from posting until touchdown. */
export class Post {
  constructor() {
    /** Envelopes in the box, oldest first. `forId: null` means unaddressed. */
    this.pending = [];
    /** id → how many envelopes for them are in the air. */
    this.inFlight = new Map();
  }

  /** How many envelopes are sitting in the box. */
  get size() { return this.pending.length; }

  /**
   * Post an envelope. Counted as in-flight immediately, so a recipient will walk
   * over and wait at the box for a plane that has not landed yet — the request
   * exists the moment it is made, and only the animation lags.
   */
  post(forId = null) {
    if (forId) this.inFlight.set(forId, (this.inFlight.get(forId) ?? 0) + 1);
  }

  /** A posting that never got airborne, so nobody should wait for it. */
  unpost(forId = null) {
    if (forId) this._land(forId);
  }

  _land(forId) {
    if (!forId) return;
    const left = (this.inFlight.get(forId) ?? 1) - 1;
    if (left > 0) this.inFlight.set(forId, left);
    else this.inFlight.delete(forId);
  }

  /**
   * Touchdown.
   *
   * `arrival` is settled before the flight rather than here, because it decides which
   * way the work travels — a letter comes in through the window, a package comes to
   * the door — so by the time anything lands the choice is long made. It is worked
   * out from the title if a caller leaves it off.
   *
   * `plan` is the checklist the request arrived with, when it had one — carried
   * rather than acted on, because an envelope's contents are nobody's business until
   * somebody opens it. Most post has none.
   *
   * @param {{job: string, forId: ?string, arrival: ?string, plan: ?object}} envelope
   * @param {(id: string) => boolean} isPresent  is the recipient still in the room?
   * @return {boolean} false if the envelope was binned undelivered
   */
  land({ job, forId = null, jobId = null, arrival = null, plan = null, box = null }, isPresent = () => true) {
    this._land(forId);

    // The recipient left while it was in the air. Nobody else may open someone
    // else's post, so it is binned rather than left to hold the flag up over an
    // envelope that can never be collected.
    if (forId && !isPresent(forId)) return false;

    // `forId` is the *person* it is addressed to and `jobId` is the *job of theirs* it
    // belongs to, and those are not the same thing: one colleague may hold
    // several sessions at once, and an envelope has to be collectable by them while
    // still knowing which of their jobs it is the work for. Only ownership is decided
    // here — `jobId` is carried and handed back by `take`, for the caller to apply.
    this.pending.push({
      job, forId, jobId, arrival: arrival ?? arrivalFor(), plan, box, at: Date.now(),
    });
    return true;
  }

  /**
   * How many envelopes arrived a given way, in one box or in all of them.
   *
   * Scoped by box because a room may have several, and each prop draws only what is
   * actually in it: two boxes both showing the same three letters would be worse than
   * not offering a second box at all. Omit `box` for the room's whole total.
   */
  countByArrival(arrival, box = null) {
    return this.pending.reduce((n, m) => {
      if (m.arrival !== arrival) return n;
      if (box !== null && m.box !== box) return n;
      return n + 1;
    }, 0);
  }

  /**
   * Which boxes hold something this agent may open, oldest envelope first.
   *
   * So a collector can be sent to the nearest box that has anything for them rather
   * than to *the* box, which is a question a room with two of them cannot answer.
   * Boxes are returned in the order their oldest openable envelope arrived, so with
   * nothing else to choose between them the older work is still preferred.
   */
  boxesWith(id) {
    const seen = [];
    for (const m of this.pending) {
      if (m.forId && m.forId !== id) continue;
      if (!seen.includes(m.box ?? null)) seen.push(m.box ?? null);
    }
    return seen;
  }

  /**
   * Index of the first envelope this agent may open, or -1.
   *
   * `box` narrows it to one box, which is what a collector standing at a particular
   * box needs: they can only take what is in front of them. Left off, it asks about the
   * room, which is what deciding whether to set off at all needs.
   */
  indexFor(id, box = undefined) {
    return this.pending.findIndex((m) => (!m.forId || m.forId === id)
      && (box === undefined || (m.box ?? null) === box));
  }

  /** Is there anything for this agent — anywhere, or in one particular box? */
  canCollect(id, box = undefined) { return this.indexFor(id, box) >= 0; }

  /**
   * Does this agent have post of their own to fetch — in the box or still inbound?
   *
   * Addressed post only. Unaddressed mail keeps its older, looser meaning — it is
   * picked up on the way to a job by whoever is going anyway — so it must not
   * drag a seated agent out of their chair.
   */
  hasOwn(id) {
    if ((this.inFlight.get(id) ?? 0) > 0) return true;
    return this.pending.some((m) => m.forId === id);
  }

  /**
   * Take the first envelope this agent may open, out of one box or out of any.
   *
   * Scoped in practice: an agent takes from the box they walked to. Unscoped is kept
   * for the headless case, where there is no scenery and no walk to speak of.
   */
  take(id, box = undefined) {
    const i = this.indexFor(id, box);
    if (i < 0) return null;
    return this.pending.splice(i, 1)[0];
  }

  /** Retitle addressed mail that landed before its harness learned the concise title. */
  retitleFor(id, from, to) {
    if (!id || !from || !to || from === to) return 0;
    let changed = 0;
    for (const item of this.pending) {
      if (item.forId !== id || item.job !== from) continue;
      item.job = to;
      changed += 1;
    }
    return changed;
  }

  /**
   * Give up on post that never arrived.
   *
   * An agent who has stood at the box for the full wait and found nothing was
   * expecting a plane that is not coming: the flight was dropped for a full
   * queue, or the scene was torn down under it. The expectation has to go, because
   * `hasOwn` is what sends them to the box — leave it standing and they set off
   * again the moment they sit down, and again, and again, forever.
   *
   * Safe against a plane that lands late. `land` puts a late envelope in the box
   * regardless, and one waiting there is enough to bring its recipient back.
   *
   * @return {number} how many expectations were abandoned
   */
  abandon(id) {
    const expected = this.inFlight.get(id) ?? 0;
    this.inFlight.delete(id);
    return expected;
  }

  /**
   * Bin everything addressed to an agent who has gone, including what is still in
   * the air, and say how many envelopes left the box so the flag can be corrected.
   */
  dropFor(id) {
    const before = this.pending.length;
    this.pending = this.pending.filter((m) => m.forId !== id);
    this.inFlight.delete(id);
    return before - this.pending.length;
  }
}
