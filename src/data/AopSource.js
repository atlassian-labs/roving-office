import { AgentSource } from './AgentSource.js';
import { createAopReducer } from './aop-reducer.js';

// A live feed from a real agentic harness, over the Agent Office Protocol.
//
// One class serves all five harnesses (Rovo CLI, Claude Code, Cursor, Codex, OpenClaw)
// because AOP is harness-neutral by design: the adapter that runs inside the
// harness has already done the translating, so all that differs here is which
// `harness.name` we subscribe to. See docs/developer/protocol/aop-spec.md.
//
// Two responsibilities:
//   1. Transport — snapshot over fetch, then a live SSE subscription.
//   2. Reduction — AOP events (what happened) into stage directions (what the
//      office should show), per spec §6. The scene stays ignorant of AOP.
//
// Replaces the old RovoSource stub, which promised exactly this for one harness.

/** Statuses reported to the UI so a badge can say what the feed is doing. */
export const FEED_STATES = ['connecting', 'live', 'waiting', 'offline'];

/**
 * Every AOP event type the stream can name (spec §4), because **`EventSource`
 * dispatches named frames only to matching listeners** — never to `onmessage`.
 *
 * The receiver sets `event:` to the AOP type (spec §5.2), so an office that only
 * assigns `onmessage` hears the snapshot replay and then nothing at all: agents
 * appear when you switch offices and never walk in on their own. Every type gets
 * an explicit listener instead, with `onmessage` kept for a receiver that leaves
 * frames unnamed.
 *
 * Add new types here when the spec grows one. Until then an unknown type is simply
 * not delivered, which is the same outcome §11 already asks for — ignored.
 */
export const AOP_EVENT_TYPES = [
  'session.start', 'session.end', 'session.heartbeat',
  'turn.start', 'turn.title', 'turn.end',
  'step.start', 'step.end',
  'tool.start', 'tool.end',
  'permission.request', 'permission.resolve',
  'artifact.change', 'context.compact',
  'job.queued', 'job.claimed', 'job.dropped',
  'notification', 'error', 'usage',
];

const REAP_INTERVAL_MS = 5_000;

export class AopSource extends AgentSource {
  /**
   * @param {object}  opts
   * @param {string}  opts.harness       harness slug to subscribe to, e.g. 'claude-code'
   * @param {string}  [opts.endpoint]    AOP base path on the office server
   * @param {?string} [opts.projectId]   office this feed belongs to (see filtering note)
   * @param {(s: {state: string, detail?: string, agents: number}) => void} [opts.onStatus]
   * @param {(url: string) => EventSource} [opts.eventSourceFactory] injectable for tests
   */
  constructor({
    harness,
    endpoint = '/aop/v0',
    projectId = null,
    onStatus = null,
    eventSourceFactory = null,
  } = {}) {
    super();
    if (!harness) throw new Error('AopSource: a harness slug is required');

    this.harness = harness;
    this.endpoint = endpoint;
    this.projectId = projectId;
    this.onStatus = onStatus;
    this.makeEventSource = eventSourceFactory
      ?? ((url) => new EventSource(url));

    this.onEvent = null;
    this.es = null;
    this.reaper = null;
    this.state = 'connecting';

    /**
     * The reducer holds the sessions, the cast and the travel debounce; this
     * class watches the stage directions going past to keep the badge honest —
     * somebody arriving makes the feed live, the last one leaving makes it
     * waiting — which is presence, not reduction.
     */
    this.reducer = createAopReducer({
      harness,
      emit: (ev) => {
        this.onEvent?.(ev);
        if (ev.type === 'spawn' && this.state !== 'live') this._setState('live');
        if (ev.type === 'exit') this._setState(this.sessions.size ? 'live' : 'waiting');
      },
    });
    this.cursor = null;
  }

  /** The reducer's live sessions — read by the badge counts and the resync. */
  get sessions() { return this.reducer.sessions; }

  /** Who the sessions are; the debug log asks the same cast (see aop-reducer). */
  get cast() { return this.reducer.cast; }

  start(onEvent) {
    this.onEvent = onEvent;
    this._setState('connecting');
    this._hydrate();
    this.reaper = setInterval(() => this.reducer.reap(), REAP_INTERVAL_MS);
    return this;
  }

  stop() {
    this.es?.close();
    this.es = null;
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
    this.reducer.stop();
  }

  // --- Transport ------------------------------------------------------------

  /**
   * Replay what happened before this office opened, then go live.
   *
   * The office is a window onto *now*, but "now" includes an agent that has been
   * mid-turn for ten minutes — without a snapshot, opening the page or switching
   * project would show an empty room until the next tool call.
   */
  async _hydrate() {
    await this._snapshot();
    this._subscribe();
  }

  /** Fetch the snapshot and reduce it. Separate so `_resync` can reuse it without
   * opening a second stream. */
  async _snapshot() {
    const query = `?harness=${encodeURIComponent(this.harness)}`;
    try {
      const res = await fetch(`${this.endpoint}/state${query}`, { headers: { accept: 'application/json' } });
      if (res.ok) {
        const snap = await res.json();
        this.cursor = snap.cursor ?? null;
        for (const ev of snap.events ?? []) this._reduce(ev);
      }
    } catch {
      // No receiver yet is a normal state, not an error: the office runs fine
      // with nothing attached, and the stream below will keep retrying.
    }
  }

  /**
   * Re-sync after the stream comes back.
   *
   * `EventSource` reconnects silently, and nothing here noticed: a receiver that
   * restarted has an empty buffer and a cursor sequence that starts again from
   * zero, so the resumed subscription replays nothing and the office is left
   * showing whatever it happened to believe before the drop — including an empty
   * room, if its characters were reaped while disconnected.
   *
   * Seen ids are cleared because a restarted receiver may legitimately re-issue
   * events the office has already applied; re-applying them is harmless, since
   * `spawn` only fires for a session the office does not yet know about.
   *
   * Sessions the snapshot no longer mentions are deliberately *not* evicted here.
   * A fresh receiver knows about nobody, and evicting on that basis would clear a
   * room full of live agents; their own TTL (§7.4) is the honest way for them to go.
   */
  async _resync() {
    this.reducer.resetSeen();
    await this._snapshot();
    this._setState(this.sessions.size ? 'live' : 'waiting');
  }

  _subscribe() {
    const after = this.cursor ? `&after=${encodeURIComponent(this.cursor)}` : '';
    const url = `${this.endpoint}/stream?harness=${encodeURIComponent(this.harness)}${after}`;

    const es = this.makeEventSource(url);
    this.es = es;

    es.onopen = () => {
      this._setState(this.sessions.size ? 'live' : 'waiting');
      // First open is already covered by the snapshot in _hydrate; every later one
      // means we lost time, and possibly a whole receiver, and must catch up.
      if (this._hasConnected) this._resync();
      this._hasConnected = true;
    };
    es.onerror = () => {
      // EventSource reconnects on its own, so this is "not connected right now"
      // rather than a failure worth tearing anything down for.
      this._setState('offline');
    };

    // Named frames need named listeners; `onmessage` alone hears nothing but an
    // unnamed receiver. Both are wired, and `_reduce` de-duplicates by event id,
    // so a receiver that somehow sends both framings is still harmless.
    const onFrame = (msg) => this._onFrame(msg);
    es.onmessage = onFrame;
    for (const type of AOP_EVENT_TYPES) es.addEventListener?.(type, onFrame);
  }

  _onFrame(msg) {
    if (!msg?.data) return;              // `: ping` keepalives arrive as comments
    let ev;
    try {
      ev = JSON.parse(msg.data);
    } catch {
      console.warn('[AopSource] unparseable frame', msg.data);
      return;
    }
    if (msg.lastEventId) this.cursor = msg.lastEventId;
    this._reduce(ev);
  }

  _setState(state, detail) {
    this.state = state;
    this.onStatus?.({ state, detail, agents: this.sessions.size });
  }

  _emit(ev) { this.onEvent?.(ev); }

  // --- Reduction ------------------------------------------------------------
  // The rules live in aop-reducer.js, extracted so a test can drive them with a
  // recorded stream and fake clocks. This class only owns the wiring: real
  // timers, the real clock, and the presence states the badge shows.

  _reduce(ev) { this.reducer.reduce(ev); }
}
