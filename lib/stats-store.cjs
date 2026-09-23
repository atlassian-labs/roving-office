// Daily aggregates: how much this server has been used, and nothing about by whom.
//
// **This file starts a record that never existed.** Before it, the project wrote no
// history at all: `lib/office-store.cjs` is a registry of the offices that exist right
// now, the reaper deletes an idle one leaving no trace, and `lib/aop-bus.cjs` is a ring
// buffer that forgets. So every per-day number here begins at `recordingSince` and there
// is no way to backfill a single day before it. The admin console says so on its face,
// because a chart that starts at zero looks like a quiet week rather than a missing one.
//
// What is kept is **counters and small per-day buckets**, deliberately not an event
// stream:
//
//   * No content. No prompts, titles, summaries, paths, tool names, agent names,
//     keycards, tokens or URLs reach this file. Only the *type* of an event is read, and
//     only to decide which counter to add one to.
//   * No per-office rows. "How many distinct offices did Claude Code feed today" is a
//     number here, never a list — see `distinct` for how that is counted without writing
//     an identifier down.
//   * No identifiers of any kind: no client address, no visitor id, no hash of either.
//     There is nothing in this file that could be joined to anything else.
//
// The bound on growth is `RETAIN_DAYS`, and it is the whole retention rule: a day older
// than that is dropped on the next write. Nothing else here grows — the per-day bucket
// is a fixed set of counters whose keys come from the two lists below.

'use strict';

const fs = require('fs');
const path = require('path');

const VERSION = 1;

/**
 * How many daily buckets to keep.
 *
 * Four months, which covers "connections per day" over a quarter with a margin, and
 * bounds the file at a few hundred kilobytes of counters forever. A day past this is
 * deleted rather than rolled up into a monthly total: a summary of a summary is a third
 * thing to keep correct, and nobody has asked for last year.
 */
const RETAIN_DAYS = 120;

/** Debounce on the write, for the reason lib/office-store.cjs gives about its own. */
const SAVE_DEBOUNCE_MS = 2000;

/**
 * The harness names this counts under, and why they are restated here.
 *
 * The authority is `src/data/sources.js` (the picker) and the registry in
 * docs/developer/protocol/aop-spec.md §4.6 (the wire). Both are ES modules or prose and
 * this is a CommonJS file the receiver loads at boot, so the list is a second copy for
 * exactly the reason `lib/aop-bus.cjs` keeps a second copy of the session clocks: the
 * receiver has no imports from `src/`. Adding a harness means adding it here too, and a
 * harness that is missed is not lost — it lands in `other`.
 *
 * `mock` is the wire name of the Test Data source, and it is on the list so that Test
 * Data traffic is *visible and separate* rather than folded into real usage. In practice
 * it is nearly always zero: Test Data is simulated in the browser
 * (`src/data/MockSource.js`) and posts nothing to a server at all. That is worth knowing
 * before reading a zero there as "nobody uses it".
 */
const HARNESSES = ['claude-code', 'codex-cli', 'cursor', 'rovo-cli', 'openclaw', 'mock'];

/** Anything not on the list above. A harness we have never met still counts. */
const OTHER = 'other';

/** Every bucket a source count can land in, in the order the console draws them. */
const SOURCE_KEYS = [...HARNESSES, OTHER];

/**
 * How many distinct-office keys to hold in memory at once.
 *
 * See `distinct`. Generous next to a 500-office cap times seven sources, and a bound
 * rather than a promise: past it the set is cleared, which can only ever *over*-count a
 * day, never invent reach that did not happen.
 */
const MAX_DISTINCT_KEYS = 20_000;

/** A day, UTC. Said out loud in the console, because a reader's midnight is not this one. */
function dayKey(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 10);
}

/** A fresh day's counters. Every key exists from the start, so a chart has no holes. */
function emptyDay() {
  return {
    offices: { minted: 0, closed: 0, reaped: 0 },
    /**
     * Per source: how many offices it fed, and how many events it sent.
     *
     * `offices` is the captain's question — "how many successful connections" — under
     * his own definition, that a source counts when any data has flowed. `events` is
     * the volume behind it, which is a different question and a different shape of
     * number; both are here so neither has to stand in for the other.
     */
    sources: Object.fromEntries(SOURCE_KEYS.map((k) => [k, { offices: 0, events: 0 }])),
    /** Jobs, in the office's own vocabulary. See `countJob`. */
    jobs: {
      turnsStarted: 0,
      queued: 0,
      completed: 0,
      unfinished: 0,
      claimed: 0,
      dropped: 0,
    },
    /** What people chose their rooms to look like, counted as they chose it. */
    looks: { seasons: {}, buildings: {} },
    /**
     * Everything the reserved demo office did, in one number and out of everything else.
     *
     * The demo is where `/` redirects, so its traffic is not usage of the product by
     * anybody in particular — it is visitors and tests. Excluded from every count above
     * and kept here so that exclusion is visible rather than silent.
     */
    demoEvents: 0,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.file  where to persist
 * @param {(msg: string) => void} [opts.log]
 * @param {() => number} [opts.now] the clock, so a test does not have to wait for midnight
 */
function createStatsStore({ file, log = () => {}, now = () => Date.now() }) {
  /** @type {Map<string, object>} `YYYY-MM-DD` → counters */
  const days = new Map();

  /** When the first counter was written. Everything before this is unknowable. */
  let recordingSince = null;

  let saveTimer = null;

  /**
   * Which offices a source has already been counted for today — in memory, never on disk.
   *
   * "Count distinct offices, not events" needs to know whether this office has been seen
   * today, and the obvious way to know is to write the keycard down. That is the one
   * thing this file must not do: a per-day list of keycards per harness is a map of who
   * used what and when, which is the record the whole design is avoiding.
   *
   * So the set lives in this process's heap and holds `day|source|keycard` only until the
   * day rolls or the process restarts. The honest cost is stated rather than hidden: **a
   * restart re-counts**. An office that fed Claude Code before a redeploy and again after
   * it is two distinct offices in that day's number. The console says so where the number
   * is drawn, and the alternative — persisting a per-office identifier — is a worse thing
   * to have than a slightly high count on a deploy day.
   * @type {Set<string>}
   */
  const seen = new Set();
  let seenDay = null;

  function bucket(at = now()) {
    const key = dayKey(at);
    let day = days.get(key);
    if (!day) {
      day = emptyDay();
      days.set(key, day);
      if (!recordingSince) recordingSince = at;
      trim();
    }
    return day;
  }

  /** Drop buckets past the retention rule. The only thing that bounds this file. */
  function trim() {
    if (days.size <= RETAIN_DAYS) return;
    for (const key of [...days.keys()].sort().slice(0, days.size - RETAIN_DAYS)) {
      days.delete(key);
    }
  }

  /**
   * Is this the first time today that `source` carried data for this office?
   *
   * Clears the whole set on a day change rather than filtering it, because yesterday's
   * keys can never match again and holding them is holding office identifiers for no
   * purpose at all.
   */
  function distinct(source, keycard, at) {
    const today = dayKey(at);
    if (seenDay !== today) {
      seen.clear();
      seenDay = today;
    }
    if (seen.size >= MAX_DISTINCT_KEYS) seen.clear();
    const key = `${today}|${source}|${keycard}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }

  /** Which bucket a wire `harness.name` counts under. */
  function sourceKey(name) {
    const slug = typeof name === 'string' ? name.trim().toLowerCase() : '';
    return HARNESSES.includes(slug) ? slug : OTHER;
  }

  // --- what gets counted ---------------------------------------------------

  /**
   * An office came into being. The demo does not count: `/` redirects into it, so it is
   * created by the front door rather than by anybody deciding to open a room.
   */
  function officeMinted({ reserved = false } = {}) {
    if (reserved) return;
    bucket().offices.minted += 1;
    save();
  }

  /** Somebody closed an office through `DELETE /office/<keycard>/api`. */
  function officeClosed({ reserved = false } = {}) {
    if (reserved) return;
    bucket().offices.closed += 1;
    save();
  }

  /** The reaper took `count` idle offices. The demo is exempt from it and from this. */
  function officesReaped(count = 1) {
    if (count <= 0) return;
    bucket().offices.reaped += count;
    save();
  }

  /**
   * A batch of accepted AOP events arrived for an office.
   *
   * Reads `type` and `harness.name` from each event and nothing else — no payload is
   * touched, so no title, prompt, path or name can reach a counter here even by accident.
   *
   * @param {object} opts
   * @param {string} opts.keycard   used only to decide "have I seen this office today",
   *   held in memory for the rest of the day and never written down (see `distinct`)
   * @param {boolean} opts.reserved whether this is the demo office
   * @param {object[]} opts.events  the events the bus accepted
   */
  function eventsAccepted({ keycard, reserved = false, events = [] }) {
    if (!events.length) return;
    const at = now();
    const day = bucket(at);

    if (reserved) {
      day.demoEvents += events.length;
      save();
      return;
    }

    for (const ev of events) {
      const source = sourceKey(ev?.harness?.name);
      const row = day.sources[source] ?? day.sources[OTHER];
      row.events += 1;
      if (distinct(source, keycard, at)) row.offices += 1;
      countJob(day, ev?.type, ev?.payload?.status);
    }
    save();
  }

  /**
   * Jobs, in the vocabulary the office actually has.
   *
   * AOP has no event called "job done" (docs/developer/protocol/aop-spec.md §4.2, §4.5),
   * so this is the nearest honest reading of the question and the reasoning is written
   * down here rather than left in a chart label:
   *
   *   * **Delivered** is `turn.start` and `job.queued`. Both reduce to `mail` — the paper
   *     aeroplane arriving at a desk (`src/data/aop-reducer.js`) — which is precisely what
   *     "a job was delivered" means in this product. They are counted apart because one is
   *     a round of work in a session and the other is work landing in the mailbox from
   *     outside, and adding them would make two different things one number.
   *   * **Done** is `turn.end` with `status: "completed"`, which reduces to `dispatch` —
   *     the finished work leaving through the outbox. Every other status is `unfinished`
   *     rather than being split three ways, because `error`, `cancelled` and `blocked`
   *     answer a question nobody asked here.
   *   * `job.claimed` and `job.dropped` are counted as themselves.
   *
   * A `turn.title` is deliberately not counted: the spec says it renames the work in hand
   * and MUST NOT be read as a new job, and a counter that ignored that rule would inflate
   * deliveries by however often harnesses rename their work.
   */
  function countJob(day, type, status) {
    switch (type) {
      case 'turn.start': day.jobs.turnsStarted += 1; return;
      case 'turn.end':
        if (status === 'completed') day.jobs.completed += 1;
        else day.jobs.unfinished += 1;
        return;
      case 'job.queued': day.jobs.queued += 1; return;
      case 'job.claimed': day.jobs.claimed += 1; return;
      case 'job.dropped': day.jobs.dropped += 1; return;
      default:
    }
  }

  /**
   * Somebody's room was given a look.
   *
   * A season and a building are two words out of a fixed authored pool
   * (`src/projects.js`), which is what makes them safe to count: there is no free text in
   * either, so a popularity table cannot become a place where a user's own words end up.
   * A scene *name* is free text and is therefore not counted anywhere.
   */
  function lookSet({ reserved = false, look = null } = {}) {
    if (reserved || !look) return;
    const day = bucket();
    let moved = false;
    for (const [field, into] of [['season', day.looks.seasons], ['building', day.looks.buildings]]) {
      const value = look[field];
      if (typeof value !== 'string' || !value) continue;
      // The pool is a couple of dozen words; the slice is only so that a caller who
      // reached past `normaliseLook` cannot make a long key.
      const key = value.slice(0, 32);
      into[key] = (into[key] ?? 0) + 1;
      moved = true;
    }
    if (moved) save();
  }

  // --- reading it back -----------------------------------------------------

  /**
   * Every day held, oldest first, each with its date.
   *
   * A list rather than the map, because the console draws a bar per day in order and an
   * object's key order is a thing to have to think about. Days with no activity are
   * **absent**, not zero-filled: the console needs to be able to tell "nothing happened"
   * from "we were not recording", and only the caller knows which side of
   * `recordingSince` a gap falls on.
   */
  function series() {
    return [...days.keys()].sort().map((date) => ({ date, ...days.get(date) }));
  }

  function toJSON() {
    return {
      version: VERSION,
      recordingSince,
      retainDays: RETAIN_DAYS,
      sourceKeys: SOURCE_KEYS,
      days: series(),
    };
  }

  // --- persistence ---------------------------------------------------------

  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flush();
    }, SAVE_DEBOUNCE_MS);
    saveTimer.unref?.();
  }

  function flush() {
    trim();
    const body = {
      version: VERSION,
      recordingSince,
      days: Object.fromEntries([...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (err) {
      log(`[stats] could not write ${file}: ${err.message}`);
    }
  }

  /**
   * Read the counters back, forgiving anything unrecognisable.
   *
   * A counter file is not worth failing a boot over and it is not worth trusting either:
   * every number is coerced through `count`, and a day whose shape we cannot read is
   * dropped rather than half-loaded. The consequence of being wrong here is a chart with
   * a gap, which the console already has to be able to draw.
   */
  function load() {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return;   // no file yet: recording starts with the first counter written
    }
    if (!parsed || parsed.version !== VERSION || !parsed.days || typeof parsed.days !== 'object') return;
    recordingSince = Number.isFinite(parsed.recordingSince) ? parsed.recordingSince : null;
    for (const [date, stored] of Object.entries(parsed.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !stored || typeof stored !== 'object') continue;
      days.set(date, readDay(stored));
    }
    trim();
    if (days.size) log(`[stats] restored ${days.size} day(s) of counters from ${file}`);
  }

  const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

  /** A stored day, in this version's shape whatever shape it was written in. */
  function readDay(stored) {
    const day = emptyDay();
    for (const key of ['minted', 'closed', 'reaped']) {
      day.offices[key] = count(stored.offices?.[key]);
    }
    for (const key of SOURCE_KEYS) {
      day.sources[key] = {
        offices: count(stored.sources?.[key]?.offices),
        events: count(stored.sources?.[key]?.events),
      };
    }
    for (const key of Object.keys(day.jobs)) day.jobs[key] = count(stored.jobs?.[key]);
    for (const [field, into] of [['seasons', day.looks.seasons], ['buildings', day.looks.buildings]]) {
      const from = stored.looks?.[field];
      if (!from || typeof from !== 'object') continue;
      for (const [word, n] of Object.entries(from)) {
        if (typeof word === 'string' && word.length <= 32 && count(n)) into[word.slice(0, 32)] = count(n);
      }
    }
    day.demoEvents = count(stored.demoEvents);
    return day;
  }

  return {
    officeMinted,
    officeClosed,
    officesReaped,
    eventsAccepted,
    lookSet,
    series,
    toJSON,
    load,
    flush,
    get recordingSince() { return recordingSince; },
    get days() { return days.size; },
    RETAIN_DAYS,
    SOURCE_KEYS,
  };
}

module.exports = { createStatsStore, SOURCE_KEYS, HARNESSES, RETAIN_DAYS, dayKey };
