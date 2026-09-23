// The publisher: an in-process, long-lived AOP emitter.
//
// This is the first *bridge* in the repo, and it is a different animal from
// `bin/aop-send.cjs`. A hook adapter is a process that exists for 40ms: it cannot
// batch, cannot retry, cannot heartbeat, and has to hand a remote POST to a detached
// child because the harness is blocked on its exit. A bridge is already running and
// nobody is waiting on it, so all four of those become easy — and the whole design
// here follows from that one difference.
//
// What that buys, concretely:
//
//   * **Batching.** Events are queued and posted together after a short linger, so a
//     burst of eight parallel tool calls is one request rather than eight. A hook
//     adapter cannot do this: each of its processes only ever knows about one event.
//   * **Retry with backoff.** A failed batch goes back to the front of the queue and
//     is tried again later, in *this* process. No spool hand-off, no second sender,
//     so no at-least-once duplicate to de-duplicate.
//   * **Heartbeats.** `session.heartbeat` (spec §4.1) is simply a timer. The adapter
//     notes say hooks "cannot heartbeat on their own (they are dead between events)"
//     and that the office must therefore reap on a TTL; a bridge closes that gap, so
//     an OpenClaw session sitting quietly at a desk is not mistaken for a dead one.
//
// What it must still respect: **design rule 1.** OpenClaw awaits hook handlers, and
// gives each a timeout budget, so a handler that awaited a 900ms remote POST would
// make every tool call 900ms slower. So `publish()` is synchronous — it appends to an
// array, arms a timer and returns — and the network only ever happens on the timer.
// The hook is never the thing holding the request open. That is the same promise
// `aop-send` keeps by spawning a detached child, kept here by simply not awaiting.
//
// Loss is bounded rather than eliminated: a queue is memory, and a gateway that is
// SIGKILLed loses what has not gone out. The spool file covers the graceful cases —
// `gateway_stop` flushes, and anything still queued is written to disk and picked up
// on the next start. Bounded because the alternative is a queue that grows until the
// gateway dies of it; the office is a window onto *now*, and an hour-old tool call is
// worth less than the process staying healthy.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// The decisions every emitter shares (spec §3.4.1, §5.5, §10). Deliberately the same
// module the hook adapters use, so a repo cannot walk into one office through Claude
// Code and a different one through OpenClaw. `./shared.mjs` is the one file the packer
// rewrites, so this import works the same in a checkout and in a packed artifact.
import { core } from './shared.mjs';

// --- budgets ---------------------------------------------------------------
//
// A bridge is allowed to be patient in a way a hook is not, because the patience is
// spent in a process nobody is waiting on. Only `publish()` is on the agent's clock,
// and it does no I/O at all.

const LINGER_MS = 250;          // how long a batch waits for company
const CONNECT_MS = 2000;
const REQUEST_MS = 4000;
const HEARTBEAT_MS = 15000;     // spec §4.1
const SESSION_TTL_MS = 30 * 60 * 1000;
const GZIP_OVER = 4096;
const MAX_BATCH = 64;
const MAX_QUEUE = 2000;         // beyond this the oldest events are dropped
const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000];
const SPOOL_MAX_LINES = 500;
const SHUTDOWN_MS = 2000;       // bounded, so a slow office cannot block SIGTERM

const SPOOL_FILE = path.join(core.DIR, 'spool-openclaw.ndjson');

/**
 * POST NDJSON with a bridge's budgets. The request itself lives in `aop-core` and is
 * shared with the hook adapter: the two disagree only about how long they may wait, and
 * an IPv6-literal bug that had to be fixed in one place rather than two is the reason
 * that sharing exists at all.
 */
function post(endpoint, body) {
  return core.post(endpoint, body, {
    connectMs: CONNECT_MS,
    requestMs: REQUEST_MS,
    gzipOver: GZIP_OVER,
  });
}

/**
 * What a failing status most likely means, given what the receiver can actually return.
 *
 * Written from measurements against the deployed office rather than from the HTTP spec,
 * because the interesting cases are the ones where the office never got a say:
 *
 *   401  the receiver's own answer to a bad or missing token
 *   502  the *hosted* office's answer to the same thing — Kaizen's edge replaces the
 *        receiver's 401 before it leaves, so a wrong token looks like a broken gateway
 *   403  nobody's answer: ingest never returns 403, so this came from a WAF or an egress
 *        proxy between the agent and the office, and no amount of fixing the token or the
 *        keycard will help
 *   404  the keycard in the url does not name an office
 */
function explain(status) {
  if (status === 401 || status === 502) return ' — most likely a wrong write token';
  if (status === 403) {
    return ' — this is not the office refusing you: its ingest never answers 403, so'
      + ' something in between (a WAF, or an egress proxy) is blocking the request. Try the'
      + ' same POST with curl from the same host — if that is refused too, it is the network';
  }
  if (status === 404) return ' — the keycard in the url does not name an office';
  if (status === 413) return ' — the batch was too large for the receiver';
  return '';
}

export class Publisher {
  /**
   * @param {object}   opts
   * @param {object}   opts.harness      the AOP `harness` object, verbatim
   * @param {object}   [opts.endpoint]   `{ url, token }` from plugin config, highest precedence
   * @param {string}   [opts.scene]      force one office (spec §3.4.3)
   * @param {number}   [opts.lingerMs]
   * @param {number}   [opts.heartbeatMs]
   * @param {object}   [opts.logger]     OpenClaw's plugin logger, if we were given one
   * @param {Function} [opts.now]        injectable clock, for tests
   */
  constructor({ harness, endpoint = null, scene = null, lingerMs, heartbeatMs, logger = null, now = Date.now } = {}) {
    this.harness = harness;
    this.configuredEndpoint = endpoint?.url ? endpoint : null;
    this.scene = scene ?? null;
    this.lingerMs = Number.isFinite(lingerMs) ? lingerMs : LINGER_MS;
    this.heartbeatMs = Number.isFinite(heartbeatMs) ? heartbeatMs : HEARTBEAT_MS;
    this.logger = logger;
    this.now = now;

    this.queue = [];
    this.seq = new Map();          // sessionId → last seq
    this.dropped = 0;
    this.complained = false;
    this.sent = 0;
    this.failures = 0;
    this.timer = null;
    this.timerDue = Infinity;
    this.notBefore = 0;      // backoff floor; see `arm`
    this.inFlight = false;
    this.attempt = 0;
    this.stopped = false;

    // Everything the office would have to guess at otherwise: which office this
    // session's directory belongs to, resolved once per cwd and cached.
    this.projects = new Map();
  }

  /** Anything at all to talk to? Re-resolved per batch, so an office that starts later is found. */
  endpoint() {
    return core.resolveEndpoint(this.configuredEndpoint);
  }

  /** Cached, because `deriveProject` shells out to git on a miss. */
  project(cwd) {
    if (!cwd) return this.scene ? { id: this.scene, scene: this.scene } : undefined;
    if (!this.projects.has(cwd)) {
      let derived;
      try { derived = core.deriveProject(cwd); } catch { derived = undefined; }
      if (derived && this.scene) derived = { ...derived, scene: this.scene };
      this.projects.set(cwd, derived);
    }
    return this.projects.get(cwd);
  }

  /**
   * Envelope one event (spec §3) and queue it. **Synchronous, and it stays that way**
   * — this is the function a hook handler calls, and the hook is on the agent's clock.
   *
   * @param {{ type: string, session: object, payload?: object, ts?: string, ext?: object }} ev
   */
  publish(ev) {
    if (this.stopped || !ev?.type || !ev?.session?.id) return;

    const id = ev.session.id;
    const seq = (this.seq.get(id) ?? 0) + 1;
    this.seq.set(id, seq);

    const envelope = {
      aop: core.AOP_VERSION,
      id: `${id}:${seq}:${crypto.randomBytes(4).toString('hex')}`,
      ts: ev.ts ?? new Date(this.now()).toISOString(),
      seq,
      type: ev.type,
      harness: this.harness,
      // `wireSession` last, so `this.project()` below still gets the real directory.
      session: core.wireSession(ev.session),
      payload: ev.payload ?? {},
    };
    const project = this.project(ev.session.cwd);
    if (project) envelope.project = project;
    if (ev.ext) envelope.ext = ev.ext;

    this.queue.push(JSON.stringify(envelope));

    // A bound, not a leak. Drop the oldest: a stale tool call matters less than the
    // live turn behind it, and the receiver's own ring buffer makes the same choice.
    if (this.queue.length > MAX_QUEUE) {
      this.dropped += this.queue.length - MAX_QUEUE;
      this.queue.splice(0, this.queue.length - MAX_QUEUE);
    }

    this.arm(this.lingerMs);
  }

  /**
   * Arm the send timer to fire in `delay` ms — or at `notBefore`, whichever is later.
   *
   * Two rules meet here, and getting either wrong is a real failure mode found by
   * testing rather than by reading:
   *
   * **A pending timer is brought forward if this request is sooner.** Without that,
   * "there is already a timer" swallows every later request to send promptly, so a
   * spool recovered at gateway start would sit on disk behind whatever long timer
   * happened to be pending.
   *
   * **But never earlier than `notBefore`.** That is the backoff floor, set when a POST
   * fails. Bringing the timer forward without it is worse than the bug it fixes: each
   * new event would drag the next attempt back to one linger, so a burst of work
   * against an office that is *down* becomes one failing request per event — the exact
   * hammering the backoff exists to prevent. A backoff is a promise about the earliest
   * next attempt, and a linger must not be allowed to break it.
   */
  arm(delay) {
    if (this.inFlight || this.stopped) return;
    const due = Math.max(this.now() + delay, this.notBefore);
    if (this.timer) {
      if (due >= this.timerDue) return;      // something sooner is already scheduled
      clearTimeout(this.timer);
    }
    this.timerDue = due;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerDue = Infinity;
      void this.drain();
    }, Math.max(0, due - this.now()));
    // Never hold the gateway open on our account.
    this.timer.unref?.();
  }

  /**
   * Send what is queued, one batch at a time. A failed batch goes back to the *front*
   * so ordering survives a flaky network, and the next attempt waits out a backoff.
   */
  async drain() {
    if (this.inFlight || this.stopped) return;
    const endpoint = this.endpoint();
    if (!endpoint) return;               // no office attached: spec §5.5, do nothing
    if (!this.queue.length) return;

    this.inFlight = true;
    try {
      const batch = this.queue.splice(0, MAX_BATCH);
      const { ok, reason, status, body } = await post(endpoint, batch.join('\n'));
      if (ok) {
        this.sent += batch.length;
        this.attempt = 0;
        this.notBefore = 0;
        // Say so once, if we had been complaining: a recovery is as worth knowing as a
        // failure, and otherwise the log's last word on the subject is a lie.
        if (this.complained) {
          this.logger?.info?.(`roving-office: office reachable again, ${this.sent} events delivered so far`);
          this.complained = false;
        }
      } else {
        // Complain once per outage rather than once per batch. A wrong token would
        // otherwise write a line every few seconds forever, and an operator who is being
        // shouted at continuously is an operator who stops reading.
        if (!this.complained) {
          this.complained = true;
          this.logger?.warn?.(
            `roving-office: events are not being accepted (${reason ?? 'unknown'}). `
            + `Nothing will appear until this is fixed. Publishing to ${endpoint.url}`
            + `${explain(status)}${body ? `\n  the response said: ${body}` : ''}`,
          );
        }
      }
      if (!ok) {
        this.failures += 1;
        // Back to the *front*: ordering should survive a flaky network, and the office
        // reduces a session's events in sequence.
        this.queue.unshift(...batch);
        this.attempt = Math.min(this.attempt + 1, BACKOFF_MS.length - 1);
        this.notBefore = this.now() + BACKOFF_MS[this.attempt];
      }
    } finally {
      this.inFlight = false;
    }

    // `arm` applies the floor, so 0 here means "as soon as the backoff allows".
    if (this.queue.length) this.arm(0);
  }

  // --- heartbeats ----------------------------------------------------------

  /**
   * Start the heartbeat timer. The office reaps a character it has not heard from, and
   * a session can legitimately sit idle for an hour between prompts, so "still alive"
   * has to come from somewhere that is not the agent doing work. A bridge is that
   * somewhere — which is exactly what a hook adapter cannot be.
   *
   * @param {() => Array<{session: object, idleMs: number}>} liveSessions
   */
  startHeartbeat(liveSessions) {
    if (this.heartbeatTimer || !this.heartbeatMs) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.stopped) return;
      for (const { session, idleMs } of liveSessions()) {
        if (idleMs > SESSION_TTL_MS) continue;   // the office has rightly given up on it
        this.publish({
          type: 'session.heartbeat',
          session,
          payload: { status: idleMs > this.heartbeatMs * 2 ? 'idle' : 'working', idle_ms: idleMs },
        });
      }
    }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  // --- spool, for the gaps between gateway lifetimes ------------------------

  /**
   * Take back whatever a previous gateway could not deliver. Renamed before it is
   * read, so two gateways starting at once cannot both claim the same lines — the
   * same atomic-claim trick `aop-send` uses, and for the same reason.
   */
  drainSpool() {
    let lines;
    try {
      const claim = `${SPOOL_FILE}.claim-${process.pid}`;
      fs.renameSync(SPOOL_FILE, claim);
      lines = fs.readFileSync(claim, 'utf8').split('\n').filter(Boolean);
      fs.unlinkSync(claim);
    } catch {
      return 0;                          // no spool, or another gateway got there first
    }
    if (!lines.length) return 0;
    // In front of anything new: these are older events.
    this.queue.unshift(...lines.slice(-MAX_QUEUE));
    this.arm(0);
    return lines.length;
  }

  /** Put the queue on disk so the next gateway start can carry it. */
  spool() {
    if (!this.queue.length) return 0;
    const lines = this.queue.slice(-SPOOL_MAX_LINES);
    try {
      fs.mkdirSync(path.dirname(SPOOL_FILE), { recursive: true });
      fs.appendFileSync(SPOOL_FILE, `${lines.join('\n')}\n`, { mode: 0o600 });
    } catch {
      return 0;
    }
    this.queue.length = 0;
    return lines.length;
  }

  /**
   * Last call. Bounded on purpose: OpenClaw's shutdown finalizer is itself bounded so
   * a slow plugin cannot block SIGTERM, and an office that has gone away must not be
   * the reason a gateway takes four seconds to die. Whatever does not make it goes to
   * the spool instead.
   */
  async stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }

    const deadline = this.now() + SHUTDOWN_MS;
    while (this.queue.length && this.now() < deadline) {
      const before = this.queue.length;
      await this.drain();
      if (this.queue.length >= before) break;      // making no progress; stop trying
    }
    const spooled = this.spool();
    this.stopped = true;
    return { sent: this.sent, spooled, dropped: this.dropped, failures: this.failures };
  }

  /** For `--status` and for tests. */
  stats() {
    const endpoint = this.endpoint();
    return {
      url: endpoint?.url ?? null,
      source: endpoint?.source ?? null,
      remote: endpoint?.remote ?? null,
      queued: this.queue.length,
      sent: this.sent,
      dropped: this.dropped,
      failures: this.failures,
    };
  }
}

export { SPOOL_FILE, core };
