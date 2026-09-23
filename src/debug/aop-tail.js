// A raw tail of one office's AOP stream: every frame, from every harness, exactly
// as it arrived on the wire.
//
// This is the transport half of AopSource with the reduction removed, and it exists
// because those two halves want opposite things. `AopSource` translates AOP events
// into stage directions and is *right* to throw work away — heartbeats mean nothing
// to a room, subagent sessions would evict real characters (spec §6.1), and an
// unknown type is ignored by design (§11). A debug log wants precisely the events
// that reduction discards, so it reads underneath it rather than through it.
//
// Two deliberate differences from AopSource, both of which are the whole point:
//
//   - **No harness filter.** `?harness=` is omitted, so one connection carries every
//     harness the receiver has. The office subscribes per source because it draws one
//     room per set of sources; the log subscribes to the office because "nothing is
//     arriving" and "something is arriving that this scene ignores" are different
//     answers and only an unfiltered stream can tell them apart.
//
//   - **`fetch`, not `EventSource`.** The receiver names every frame `event: <type>`
//     (spec §5.2), and `EventSource` delivers a named frame *only* to a listener
//     registered for that name — which is why AopSource carries a hardcoded
//     AOP_EVENT_TYPES list. A debug log built on that list would silently omit
//     exactly the new event type you opened it to find, and would do so with no hint
//     that anything was missing. Reading the frames ourselves costs the parser below
//     and buys a log that cannot lie by omission.
//
// The cost of leaving `EventSource` behind is its automatic reconnect, which is
// replaced here — and improved on, because resuming with `?after=<cursor>` replays
// what was missed while disconnected instead of merely reopening.

/** Backoff between reconnects, in ms. Short: a stalled log is a useless one. */
const RETRY_MS = [500, 1000, 2000, 4000, 8000];

/** The receiver's greeting, which states the cursor it is currently at. */
const GREETING = /^agent office aop stream, cursor (\d+)$/;

/**
 * @param {object} opts
 * @param {string} opts.endpoint  AOP base path, e.g. `/office/ABCD-1234/aop/v0`
 * @param {(frame: {cursor: ?number, type: ?string, event: object, at: number}) => void} opts.onEvent
 * @param {(state: {state: 'connecting'|'live'|'offline', detail?: ?string}) => void} [opts.onState]
 * @param {(info: {cursor: number}) => void} [opts.onRestart]  the receiver's buffer
 *   went backwards, so everything previously shown predates a different receiver
 * @param {typeof fetch} [opts.fetchImpl]  injectable for tests
 */
export function createAopTail({ endpoint, onEvent, onState = null, onRestart = null, fetchImpl = null }) {
  const doFetch = fetchImpl ?? ((...args) => fetch(...args));

  /**
   * How far we have read. Starts at 0 rather than null, because 0 is the receiver's
   * "replay everything you still have" (the ring holds 2000 events) and the log's
   * first screen should be the recent past, not an empty page waiting on the next
   * agent to do something.
   */
  let cursor = 0;
  let attempt = 0;
  let running = false;
  let abort = null;
  let timer = null;
  /** Set when we abort our own stream to resume from a restarted receiver's ring. */
  let restarting = false;

  function report(state, detail = null) {
    onState?.({ state, detail });
  }

  function start() {
    if (running) return api;
    running = true;
    connect();
    return api;
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    abort?.abort();
    abort = null;
  }

  function retry() {
    if (!running) return;
    const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
    attempt++;
    timer = setTimeout(connect, wait);
  }

  async function connect() {
    if (!running) return;
    report('connecting');
    abort = new AbortController();

    try {
      const res = await doFetch(`${endpoint}/stream?after=${encodeURIComponent(cursor)}`, {
        headers: { accept: 'text/event-stream' },
        signal: abort.signal,
        // A tail must never be served from a cache, and the browser is entitled to
        // try: this is a plain GET that stays open for hours.
        cache: 'no-store',
      });
      if (!res.ok || !res.body) {
        report('offline', `receiver said ${res.status}`);
        return retry();
      }

      attempt = 0;
      report('live');
      await read(res.body);
      // A stream that ends cleanly is still a stream that ended — the server
      // restarted, or something between us closed it. Reconnect and resume.
      report('offline', 'stream closed');
    } catch (err) {
      // Resuming against a restarted receiver is a reconnect we asked for, so it
      // is neither a failure to report nor a stop to obey — and it is checked
      // first, because it aborts the same signal that `stop()` does.
      if (restarting) {
        restarting = false;
        attempt = 0;
      } else if (!running || abort?.signal.aborted) {
        return;                               // our own stop(), not a failure
      } else {
        report('offline', 'no receiver');
      }
    }
    retry();
  }

  /**
   * Pull the body apart into SSE frames.
   *
   * Frames are separated by a blank line and we may be handed any fraction of one,
   * so the tail of the buffer is always kept back until its terminator arrives —
   * splitting on newlines alone would hand out half a JSON payload the moment an
   * event straddled two TCP reads, which under load is most of them.
   */
  async function read(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let split;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        if (frame) handle(frame);
      }
    }
  }

  function handle(frame) {
    let id = null;
    let type = null;
    let data = '';

    for (const line of frame.split('\n')) {
      // Comments are the keepalive pings and the opening greeting. The greeting is
      // worth reading rather than skipping: it names the cursor the receiver is at,
      // which is the only way to notice that it restarted with an empty ring while
      // we were away. Resuming from a cursor higher than anything it now holds
      // would silently skip every event until it caught back up.
      if (line.startsWith(':')) {
        const greeting = GREETING.exec(line.slice(1).trim());
        if (greeting && Number(greeting[1]) < cursor) {
          cursor = 0;
          restarting = true;
          onRestart?.({ cursor: Number(greeting[1]) });
          abort?.abort();               // reconnect from the start of the new ring
        }
        continue;
      }

      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      // One optional space after the colon is part of the framing, not the value.
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');

      if (field === 'id') id = value;
      else if (field === 'event') type = value;
      else if (field === 'data') data = data ? `${data}\n${value}` : value;
    }

    if (!data) return;                  // a frame that was only an id, or only a comment

    let event;
    try {
      event = JSON.parse(data);
    } catch {
      // Worth showing rather than dropping: an adapter emitting malformed JSON is
      // exactly the bug this page is for, and a silent skip is how it stays hidden.
      onEvent({ cursor: numeric(id), type: type ?? null, event: null, raw: data, at: Date.now() });
      return;
    }

    const at = numeric(id);
    if (at !== null) cursor = at;
    onEvent({ cursor: at, type: type ?? event?.type ?? null, event, raw: data, at: Date.now() });
  }

  const api = {
    start,
    stop,
    /** How far the tail has read, for the controls strip. */
    get cursor() { return cursor; },
  };
  return api;
}

function numeric(value) {
  const n = value === null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}
