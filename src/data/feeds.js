// Several sources filling one office at once.
//
// An office used to hold exactly one source, which made the room a client type:
// your Claude sessions in one building, your Rovo terminals in another. But an
// office is a *project* — the repo or product area you are watching — and the
// harness a session arrived on is a costume it wears, not a room it gets put in
// (docs/developer/protocol/aop-spec.md §3.4). So an office subscribes to a *set* of sources, and
// three Rovo terminals, a Claude session and a bit of test traffic are five
// characters in one room.
//
// This module is the fan-in: it owns one feed instance per chosen source, keeps
// their connection states apart so the badge can be honest about each one, and
// hands the manager every event with the SourceDef it arrived on so the agent can
// wear the right mark.
//
// The set is not fixed for the life of a world. `sync()` takes a new choice of
// sources and moves the difference — dropping the feeds that went, starting the
// ones that arrived, and *leaving the rest alone*, which is the whole point of it:
// ticking Claude Code on in a room where three Rovo agents are working used to
// rebuild the building around them.
//
// Two things it has to get right, both of them consequences of merging feeds that
// were written in isolation:
//
//   - **Ids are namespaced per feed.** Each source numbers its own sessions —
//     MockSource counts `agent-1`, `agent-2`; AopSource keys on the session id —
//     and nothing ever promised those would not collide. Two sources naming the
//     same agent would share one character in the room, and events meant for one
//     would drive the other. Prefixing is cheap and the ids are internal. The
//     prefix counts feed *instances* rather than sources, because a source ticked
//     off and straight back on is a second feed whose `agent-1` is not the first
//     one's — and the room still holds the first one, walking to the lift.
//   - **A feed's status is its own.** Claude Code being live says nothing about
//     whether the Rovo adapter is installed, so states are tracked per source and
//     summarised for the pill, never overwritten by whichever feed reported last.

import { createSource, getSource } from './sources.js';

/**
 * Feed states, most alive first.
 *
 * The pill can only carry one word for a set of feeds, and this is the order it
 * picks from: one live feed makes the office live, because agents really are
 * arriving, and the room is no longer ambiguous. `offline` sorts last so a single
 * missing adapter doesn't shout over three working ones — the per-source detail
 * is in the tooltip, and the badge still says how many of them are live.
 */
const STATE_RANK = ['live', 'connecting', 'waiting', 'offline'];

/**
 * @typedef {object} Feed
 * @property {object} def       the SourceDef (src/data/sources.js)
 * @property {object} source    the live AgentSource instance
 * @property {string} prefix    what this feed's ids are namespaced under
 * @property {boolean} started  whether its events are already flowing
 * @property {string} state     one of FEED_STATES, or 'idle' before it reports
 * @property {?string} detail   the source's own words, e.g. 'simulated'
 */

/**
 * Build every feed an office asked for.
 *
 * Unknown ids are dropped rather than thrown on: a source can be retired from the
 * registry while an office in someone's `localStorage` still names it, and losing
 * one feed is not a reason to fail to open the room.
 *
 * @param {string[]} sourceIds  chosen sources, in the order they should be shown
 * @param {object} ctx
 * @param {object} ctx.project  the office record, for per-project sizing
 * @param {object} ctx.manager  the AgentManager, for sources that watch the room
 * @param {(summary: {state: string, detail: ?string},
 *            states: Array<{def: object, state: string, detail: ?string}>) => void} [ctx.onStatus]
 *   called whenever any feed's state changes, with the summary for the whole set
 *   and the per-source breakdown behind it. Both are passed rather than fetched,
 *   because a source can report during construction — before `createFeeds` has
 *   returned anything for the caller to ask.
 */
export function createFeeds(sourceIds, { project, manager, onStatus = null } = {}) {
  /** @type {Feed[]} */
  const feeds = [];

  // The scene record a feed is built against. Kept in a variable rather than read
  // off the parameter because changing an office's sources replaces its record
  // (office.js `replace`), and a feed built after that should be built against the
  // record the office is actually showing.
  let scene = project;

  // Where events go, handed over by `start()` and kept. Feeds arrive later now: a
  // source ticked on in the picker has to be wired into the same stream the others
  // are already running on, and there is nobody left to pass it in a second time.
  /** @type {?(ev: object, def: object) => void} */
  let onEvent = null;

  // What the next feed's ids are namespaced under. See the note at the top on why
  // this counts instances and not sources.
  let instances = 0;

  /**
   * Build one feed and put it in the set.
   *
   * Unknown ids are dropped rather than thrown on: a source can be retired from the
   * registry while an office in someone's `localStorage` still names it, and losing
   * one feed is not a reason to fail to open the room.
   *
   * @returns {?Feed}
   */
  function build(id) {
    const def = getSource(id);
    if (!def) return null;

    // The record is complete and *already in the set* before its source is built,
    // because a source may report its state during construction — Test Data is live
    // immediately — and that callback summarises the whole set. A feed that had not
    // joined yet would be summarised out of its own good news: the office would be
    // told `idle` by the one feed that is running.
    const feed = {
      def,
      prefix: `${def.id}@${++instances}`,
      source: null,
      started: false,
      state: 'idle',
      detail: null,
    };
    feeds.push(feed);

    const source = createSource(id, {
      project: scene,
      manager,
      onStatus: ({ state, detail } = {}) => {
        feed.state = state ?? 'idle';
        feed.detail = detail ?? null;
        onStatus?.(summarise(feeds), stateList(feeds));
      },
    });
    // A registered source that declines to build is not a thing today, but the
    // record has to come back out if it ever is — every method below assumes a
    // feed in the set has a source to drive.
    if (!source) {
      feeds.splice(feeds.indexOf(feed), 1);
      return null;
    }
    feed.source = source;
    return feed;
  }

  /** Set a feed running, once there is somewhere for its events to go. */
  function run(feed) {
    if (feed.started || !onEvent) return;
    feed.started = true;
    feed.source.start((ev) => onEvent(scoped(feed, ev), feed.def));
  }

  /** Stop a feed and take it out of the set. */
  function drop(feed) {
    feed.source.stop();
    const at = feeds.indexOf(feed);
    if (at >= 0) feeds.splice(at, 1);
  }

  for (const id of sourceIds ?? []) build(id);

  return {
    /** The chosen sources, for the badge, the switcher and the picker. */
    get defs() { return feeds.map((f) => f.def); },

    /** Per-source connection state, for the badge's tooltip. */
    get states() { return stateList(feeds); },

    /** One state for the whole office, for the pill. */
    get summary() { return summarise(feeds); },

    /**
     * Whether anything here can invent work on demand — the `T` shortcut.
     *
     * Feature-detected per feed rather than tested against a class, exactly as it
     * was when an office had one source: a live harness feed does not implement
     * `sendJob`, because fabricating work would be a lie about what the agents
     * are doing. A mixed office offers the key as long as *something* in it can.
     */
    get canSendJob() { return feeds.some((f) => typeof f.source?.sendJob === 'function'); },

    /**
     * Whether anything here can invent work that comes with a checklist.
     *
     * A separate capability from `canSendJob` rather than a flag on it, because a
     * source may well be able to fabricate a job and have nothing sensible to say
     * about parts — the two are feature-detected apart so neither key advertises the
     * other's ability.
     */
    get canSendRound() { return feeds.some((f) => typeof f.source?.sendRound === 'function'); },

    /**
     * Start every feed, tagging each event with the source it came from.
     *
     * The handler is kept, because this is no longer the only moment a feed starts:
     * anything `sync()` adds afterwards is set running against the same one.
     *
     * @param {(ev: object, def: object) => void} handler
     */
    start(handler) {
      onEvent = handler;
      for (const feed of [...feeds]) run(feed);
    },

    /**
     * Move the set to a new choice of sources, disturbing nothing else.
     *
     * The office used to answer a change of sources by rebuilding the world, which
     * meant the building, the furniture and *everybody in it* went with the change —
     * tick a second harness on and the agents you were watching vanished, their feed
     * reconnecting from scratch behind a fresh room. So the difference is moved
     * instead: feeds still chosen are never touched, feeds that went are stopped and
     * dropped, and feeds that arrived are built and started on the spot.
     *
     * Removed sources leave their characters standing in the room, because they are
     * not this module's to remove — an agent walks out of a building, which takes a
     * door, a lift and a few seconds. The caller gets the defs back and shows them
     * out (see `AgentManager.showOut`).
     *
     * A source ticked off and back on is a *new* feed, never the old one resumed:
     * `stop()` is terminal for both source classes — MockSource latches `_stopped`,
     * AopSource closes its stream and its reducer — and rebuilding is what the
     * picker means by ticking it on again anyway.
     *
     * @param {string[]} nextIds  the new choice, in the order it should be shown
     * @param {object} [opts]
     * @param {object} [opts.project]  the scene record, if it has been replaced
     * @returns {{added: object[], removed: object[]}} the SourceDefs either way
     */
    sync(nextIds, { project: nextProject = null } = {}) {
      if (nextProject) scene = nextProject;

      // Unknown ids drop out here rather than at `build`, so the sort below has a
      // complete order to sort against — and a repeated id is one feed, not two.
      /** @type {object[]} */
      const wanted = [];
      for (const id of nextIds ?? []) {
        const def = getSource(id);
        if (def && !wanted.some((d) => d.id === def.id)) wanted.push(def);
      }

      const removed = [];
      for (const feed of [...feeds]) {
        if (wanted.some((d) => d.id === feed.def.id)) continue;
        drop(feed);
        removed.push(feed.def);
      }

      const added = [];
      for (const def of wanted) {
        if (feeds.some((f) => f.def.id === def.id)) continue;
        const feed = build(def.id);
        if (feed) added.push(feed);
      }

      // Back into the order they were asked for. `defs` is what the badge and the
      // picker read left to right, and a source ticked on should not sit at the end
      // of the pill for no better reason than having been built last.
      const order = (feed) => wanted.findIndex((d) => d.id === feed.def.id);
      feeds.sort((a, b) => order(a) - order(b));

      for (const feed of added) run(feed);
      // Said again once the whole move is over. A feed that reports during its own
      // construction — Test Data is live immediately — has already summarised a set
      // that was still being assembled around it, and the badge should be left
      // describing what the office became rather than the middle of the change.
      onStatus?.(summarise(feeds), stateList(feeds));

      return { added: added.map((f) => f.def), removed };
    },

    stop() {
      for (const feed of feeds) feed.source.stop();
    },

    /**
     * Post a job into the office, from whichever feed can invent one.
     *
     * The first that can, rather than all of them: pressing `T` means "one more
     * job", and an office with Test Data twice over is not a thing you can build.
     *
     * The optional call, here and in `canSendJob`, covers the one moment a record
     * is in the set without its source: a feed reporting its state mid-construction
     * runs the caller's `onStatus` from inside the loop above.
     */
    sendJob(job) {
      const feed = feeds.find((f) => typeof f.source?.sendJob === 'function');
      return feed ? feed.source.sendJob(job) : null;
    },

    /** The same, for work that arrives with a checklist to walk (spec §4.2). */
    sendRound() {
      const feed = feeds.find((f) => typeof f.source?.sendRound === 'function');
      return feed ? feed.source.sendRound() : null;
    },
  };
}

/** Each feed's state, without the live source instance hanging off it. */
function stateList(feeds) {
  return feeds.map(({ def, state, detail }) => ({ def, state, detail }));
}

/** Namespace an event's agent ids so two feeds can never name the same agent. */
function scoped(feed, ev) {
  const out = { ...ev };
  if (typeof ev.id === 'string') out.id = `${feed.prefix}#${ev.id}`;
  // Addressed post names its recipient, so it has to travel the same way or an
  // envelope would be addressed to an agent that, under this scheme, is nobody.
  if (typeof ev.forId === 'string') out.forId = `${feed.prefix}#${ev.forId}`;
  return out;
}

/**
 * Collapse the set's states into the one line a pill can hold.
 *
 * With a single feed this is exactly what that feed said, so a plain Test Data
 * office reads `live · simulated` as it always did. With several, the count is
 * the useful part — `2 of 3` tells you at a glance that something you asked for
 * is not reporting, and the tooltip says which.
 *
 * The count leaves the word `live` to the state beside it when the state is
 * already `live`, because the pill drew them one after the other and read
 * `live · 2 of 3 live`. When the best state is something else the word is doing
 * real work, since it is not the state being counted: `connecting… · 0 of 3 live`.
 *
 * Exported because the debug log wears the same badge without building any feeds
 * (src/debuglog.js): it knows each source's state from one shared connection rather
 * than from a feed apiece, and a second opinion about how to say `2 of 3 live` is
 * how the same office comes to read two different ways on two pages.
 *
 * @param {Array<{state: string, detail: ?string}>} feeds
 */
export function summarise(feeds) {
  if (feeds.length === 0) return { state: 'idle', detail: null };
  if (feeds.length === 1) return { state: feeds[0].state, detail: feeds[0].detail };

  const best = STATE_RANK.find((s) => feeds.some((f) => f.state === s)) ?? 'idle';
  const live = feeds.filter((f) => f.state === 'live').length;
  const of = `${live} of ${feeds.length}`;
  return { state: best, detail: best === 'live' ? of : `${of} live` };
}
