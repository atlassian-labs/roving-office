// One office's Agent Office Protocol receiver: a ring buffer, its subscribers, and
// the rules for what a newly opened window is owed (docs/developer/protocol/aop-spec.md §5).
//
// This used to be module state in server.cjs, back when a server *was* an office.
// Now a server hosts as many offices as have keycards, and two offices must not be
// able to see each other's agents — an office is private to whoever holds its
// keycard, and a shared ring would leak every session to every visitor. So the
// state is a factory, and each office gets its own.
//
// It holds events and nothing else: the office is a window onto now, not a
// historian. Reduction into stage directions happens in the browser
// (src/data/AopSource.js), so there is exactly one reducer in the system.

'use strict';

const AOP_MAJOR = '0';
// What this receiver speaks, and what it says it speaks when asked (spec §11). Only
// the major is enforced on the way in: a minor is additive by definition, so an
// emitter ahead of us sends types we ignore and one behind us sends a subset.
const AOP_VERSION = '0.2';
const RING_MAX = 2000;          // events kept for replay
// Must match AopSource's clocks, or a reload will empty a room the live feed still
// believes in: the browser keeps a session for 30 minutes while this replays only 90
// seconds of it. Two copies because the receiver has no imports from src/.
const SESSION_TTL_MS = 300_000;         // no farewell promised: 5 minutes
const FAREWELL_TTL_MS = 30 * 60_000;    // farewell promised: 30 minutes, crash-only
const PING_MS = 15_000;

function createAopBus() {
  /** Ring buffer of accepted events, each wrapped with the cursor we assigned. */
  const ring = [];
  let cursor = 0;

  /** Event ids already accepted, so a retrying adapter cannot double-spawn. */
  const seenIds = new Set();

  /** Open SSE subscribers. @type {Set<{res: object, harness: ?string, ping: any}>} */
  const subscribers = new Set();

  /**
   * Sessions that declared `session.end` in their capabilities.
   *
   * Kept outside the ring on purpose. Scanning replayed entries for the capability
   * would lose it in the two cases that matter most: a busy session whose
   * `session.start` has aged out of the ring, and a client reconnecting with
   * `?after=`, which skips those older entries entirely. Either way the session would
   * silently fall back to the short TTL and its character would vanish mid-work.
   */
  const farewellSessions = new Set();

  /** When an event was last accepted here — what "this office is in use" means. */
  let lastEventAt = 0;

  function sessionKey(ev) {
    return `${ev.harness?.name ?? ''}:${ev.session?.id ?? ''}`;
  }

  /**
   * Validate loosely and accept generously.
   *
   * A malformed event is dropped rather than failing the batch: adapters run inside
   * someone's agent loop, and a 400 there is a hook that gets disabled.
   */
  function accept(ev) {
    if (!ev || typeof ev !== 'object') return false;
    if (typeof ev.type !== 'string') return false;
    if (typeof ev.aop === 'string' && ev.aop.split('.')[0] !== AOP_MAJOR) return false;
    if (!ev.session || typeof ev.session.id !== 'string') {
      // Mailbox events legitimately have no session; give them a synthetic one.
      if (!ev.type.startsWith('job.')) return false;
      ev.session = { id: 'queue' };
    }
    if (ev.id) {
      if (seenIds.has(ev.id)) return false;
      seenIds.add(ev.id);
      if (seenIds.size > RING_MAX * 4) seenIds.clear();
    }
    if (!ev.ts) ev.ts = new Date().toISOString();

    const entry = { cursor: ++cursor, at: Date.now(), ev };
    const key = sessionKey(ev);
    if (ev.type === 'session.start' && Array.isArray(ev.payload?.capabilities)
        && ev.payload.capabilities.includes('session.end')) {
      farewellSessions.add(key);
    } else if (ev.type === 'session.end') {
      farewellSessions.delete(key);
    }

    ring.push(entry);
    if (ring.length > RING_MAX) ring.shift();
    lastEventAt = entry.at;
    fanout(entry);
    return true;
  }

  function frame(entry) {
    return `id: ${entry.cursor}\nevent: ${entry.ev.type}\ndata: ${JSON.stringify(entry.ev)}\n\n`;
  }

  function fanout(entry) {
    const harness = entry.ev.harness?.name ?? null;
    const text = frame(entry);
    for (const sub of subscribers) {
      if (sub.harness && sub.harness !== harness) continue;
      sub.res.write(text);
    }
  }

  /**
   * What a newly opened office needs to see.
   *
   * Replaying the whole ring would resurrect agents that finished an hour ago, so
   * sessions that ended or went quiet past the TTL are left out — and the events of
   * a session still in flight are replayed in order, through the same reducer the
   * live stream feeds.
   */
  function replay({ harness, after }) {
    const now = Date.now();
    const live = new Map();       // session key -> entries

    for (const entry of ring) {
      const ev = entry.ev;
      if (harness && (ev.harness?.name ?? null) !== harness) continue;
      if (after && entry.cursor <= after) continue;

      const key = sessionKey(ev);
      if (ev.type === 'session.end') { live.delete(key); continue; }
      if (!live.has(key)) live.set(key, []);
      live.get(key).push(entry);
    }

    const events = [];
    for (const [key, entries] of live) {
      const last = entries[entries.length - 1];
      const ttl = farewellSessions.has(key) ? FAREWELL_TTL_MS : SESSION_TTL_MS;
      if (last.at < now - ttl) continue;    // went quiet: it would only be reaped again
      events.push(...entries);
    }
    events.sort((a, b) => a.cursor - b.cursor);
    return { cursor, events: events.map((e) => e.ev) };
  }

  /** Attach an SSE subscriber. The response is already headed by the caller. */
  function subscribe(res, { harness = null, after = null } = {}) {
    res.write(`: agent office aop stream, cursor ${cursor}\n\n`);

    // Anything that arrived between the client's snapshot and this subscription.
    if (after !== null) {
      for (const entry of ring) {
        if (entry.cursor <= after) continue;
        if (harness && (entry.ev.harness?.name ?? null) !== harness) continue;
        res.write(frame(entry));
      }
    }

    // Keepalive: without traffic, proxies and sleeping laptops quietly drop the
    // connection and the office silently stops updating.
    const sub = { res, harness, ping: setInterval(() => res.write(`: ping ${Date.now()}\n\n`), PING_MS) };
    subscribers.add(sub);
    return () => {
      clearInterval(sub.ping);
      subscribers.delete(sub);
    };
  }

  /** Hang up on everyone: the office this bus belonged to has been reaped. */
  function close() {
    for (const sub of subscribers) {
      clearInterval(sub.ping);
      try { sub.res.end(); } catch { /* already gone */ }
    }
    subscribers.clear();
    ring.length = 0;
    seenIds.clear();
    farewellSessions.clear();
  }

  return {
    accept,
    replay,
    subscribe,
    close,
    get cursor() { return cursor; },
    get buffered() { return ring.length; },
    get subscribers() { return subscribers.size; },
    get lastEventAt() { return lastEventAt; },
  };
}

module.exports = {
  createAopBus, AOP_MAJOR, AOP_VERSION, SESSION_TTL_MS, FAREWELL_TTL_MS, PING_MS,
};
