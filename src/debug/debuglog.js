// The debug log: this office's event stream, as text.
//
// The office is a picture, and a picture is a wonderful way to understand a room and
// a poor way to answer "did that event arrive, and what was in it?". So this page is
// the same office with the room taken out: the real header, the real keycard, the
// real scene switcher and source picker, and in place of the building a list of the
// events themselves, newest first.
//
// **It loads no three.js and opens no WebGL context.** That is the point rather than
// an optimisation: the times you most need to know what is arriving are the times the
// scene is the suspect — a machine too slow to render it, a browser without WebGL, a
// bug that leaves the canvas black. A debug view that shares the thing under
// suspicion is a debug view you cannot trust. Everything imported here is checked to
// be scene-free; the header components already were.
//
// Two feeds, because an office has two kinds of truth to tell:
//
//   1. **The wire** — every AOP frame the receiver holds, from every harness, read
//      raw (see data/AopTail.js). Not filtered to the active scene's sources: an
//      event from a harness this scene ignores is dimmed rather than dropped,
//      because "nothing is arriving" and "your agent is arriving into a scene that
//      is not listening for it" are different problems with the same symptom, and
//      the second one is otherwise invisible.
//
//   2. **The simulation** — Test Data invents its agents in this browser and never
//      crosses the network, so it has no wire to tail. It is logged from the source
//      object directly, behind a toggle, in the office's own vocabulary rather than
//      AOP's. Without it a Test Data office — which is what every new office is —
//      would show an empty page and look broken.
//
// Both feeds are named the way the room names them: an event is about a *character*,
// not a session id, and the log says so in a column of its own (see agents/cast.js).
// That is what makes the filters below the strip worth having — the name you are
// watching walk across the office is the name you can type in the box here.

import {
  keycard, loadOffice, officeInfo, watchOffice, claimLocalEndpoint,
  listScenes, getScene, initialSceneId, rememberActive, setSceneSources, tryPasscode,
} from '../office/office.js';
import { SOURCES, createSource, getSource, aopEndpoint, sourceLabel, variantLabel } from '../data/sources.js';
import { summarise } from '../data/feeds.js';
import { createAopTail } from './aop-tail.js';
import { createSceneSwitcher } from '../ui/switcher.js';
import { createKeycardChip } from '../ui/keycard-chip.js';
import { createSourceBadge } from '../ui/source-badge.js';
import { createSourcePicker } from '../ui/source-picker.js';
import { askForPasscode } from '../ui/passcode-prompt.js';
import {
  createEventRow, createHeaderRow, setWatched, setCharacter, familyOf,
  describeAop, describeOffice, describePresence, formatAgo, shortId,
} from './event-row.js';
import { createLogFilters, countFacets } from './log-filters.js';
import { createCast } from '../agents/cast.js';
import { ensureHost, node } from '../ui/dom.js';
import { readText, writeText } from '../local-store.js';

/**
 * How many rows are built as elements.
 *
 * A hundred is what a person scrolls, and it is also what keeps this page honest
 * about being fast: the receiver's ring holds twenty times that, so a replay is
 * *parsed* in full and only the newest hundred are ever made into elements.
 */
const KEEP = 100;

/**
 * How many events are remembered as data.
 *
 * Deliberately the receiver's own ring size, so a filter reaches exactly as far back
 * as the office does. This is the difference between a filter that is useful and one
 * that is a toy: the rare event you are hunting for is by definition not in the
 * newest hundred rows, and a search that could only see what was already on screen
 * would find nothing and — much worse — would say so.
 *
 * An entry is a handful of strings and a parsed envelope we were holding anyway, so
 * two thousand of them cost a fraction of the elements a tenth as many rows would.
 */
const REMEMBER = 2000;

/** How often the "time ago" column is redrawn. */
const CLOCK_MS = 1000;

/** Which source ids are simulated rather than arriving over the wire. */
const SIMULATED = 'test-data';

const store = {
  key: `roving-office.debuglog.testdata.${keycard}`,
  read(fallback) {
    const raw = readText(this.key);
    return raw === null ? fallback : raw === '1';
  },
  write(on) {
    writeText(this.key, on ? '1' : '0');
  },
};

// --- the office ------------------------------------------------------------

// The same passcode prompt the office page uses, for the same reason: this page reads
// the same office through the same routes, so a locked office locks it too and being
// told "the office could not be opened (401)" would send somebody debugging the wrong
// thing. It offers none of the office controls — no dialog, no closing, no passcode to
// set — because this is a reading of the event stream and not a place to run a room.
const office = await loadOffice({
  onLocked: () => askForPasscode({ keycard, submit: (typed) => tryPasscode(typed) }),
});
if (!office) throw new Error('no office to open');   // loadOffice() has redirected

/** The scene whose sources decide what counts as watched. @type {?object} */
let scene = getScene(initialSceneId()) ?? listScenes()[0] ?? null;

// The log's own hosts, which debuglog.html provides; `ensureHost` covers the rest of
// the header the same way the office does.
const rows = ensureHost('log-rows', { className: 'log-rows', parent: document.body });
const emptyNote = document.getElementById('log-empty');
const officeLink = document.getElementById('to-office');
if (officeLink) officeLink.href = `/office/${keycard}`;

// Column headers, immediately above the rows and sharing their grid. Built here
// rather than written into debuglog.html because the columns are the row module's
// business, and two places describing them is how they come to disagree.
rows.before(createHeaderRow());

// The header sticks, and what it has to stick *below* is the title bar — whose
// height is not a constant: `.brand` wraps on a narrow window, and a two-line bar
// would swallow the headers whole. So it is measured and published as a custom
// property, which is the one thing CSS cannot work out for itself here.
const titleBar = document.getElementById('title-bar');
if (titleBar) {
  const syncHeaderOffset = () => {
    document.documentElement.style.setProperty('--titlebar-h', `${titleBar.offsetHeight}px`);
  };
  syncHeaderOffset();
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncHeaderOffset).observe(titleBar);
  else window.addEventListener('resize', syncHeaderOffset);
}

// --- header ---------------------------------------------------------------

const badge = createSourceBadge({ onClick: () => openPicker() });
const sourcePicker = createSourcePicker();
const keycardChip = createKeycardChip({ keycard });
keycardChip.setOffice(office);

const switcher = createSceneSwitcher({
  scenes: listScenes(),
  initialId: scene?.id ?? null,
  onChange: (id) => {
    scene = getScene(id) ?? scene;
    rememberActive(id);
    // Which harnesses count as watched has changed, so every row's dimming is now
    // out of date. Repainting beats tracking it per row, and at a hundred rows it
    // is imperceptible.
    repaintWatched();
    paintBadge();
    restartSimulation();
    paintEmpty();
  },
  // No "new scene" row and no trash can: creating and deleting rooms is the
  // office's business, and offering it from a log would be a control whose effect
  // you cannot see. Switching is offered because it changes what this page means.
});

/**
 * How many tabs were watching at the last heartbeat, or null before the first one.
 *
 * The count is the *only* thing presence knows: it is a heartbeat per tab, with no
 * name attached and no way to tell which of two viewers closed their laptop.
 */
let viewers = null;

/**
 * Log viewers arriving and leaving.
 *
 * Presence is polled rather than pushed — a thirty second heartbeat with a ninety
 * second expiry — so these rows are timestamped **when the change was noticed**, not
 * when it happened: a join shows up within half a minute, and a leave can be up to
 * two minutes late because that is how long it takes an unheard-from tab to expire.
 * Every other row on this page carries the emitter's own clock and is exact, so the
 * discrepancy is spelled out in the tooltip rather than left to be discovered.
 *
 * The first reading is a baseline rather than an arrival: on load it counts this very
 * tab, and "you joined" is not news to the person reading it. The strip carries the
 * running total, so nothing is lost by staying quiet about it.
 */
function notePresence(next) {
  if (next === null) return;
  const previous = viewers;
  viewers = next;
  paintControls();
  if (previous === null || next === previous) return;

  const delta = next - previous;
  add({
    kind: 'viewer',
    type: delta > 0 ? 'viewer.join' : 'viewer.leave',
    def: null,
    glyph: delta > 0 ? '→' : '←',
    at: Date.now(),
    who: 'This office',
    senderId: senderIdOf(null, null, 'viewer'),
    senderLabel: 'This office',
    // Nobody in the room opened a tab, so there is no character to name.
    character: null,
    whoTitle: delta > 0
      ? 'Noticed on a heartbeat, so up to 30s after they arrived'
      : 'Noticed when their heartbeat expired, so up to 2 minutes after they left',
    session: null,
    summary: describePresence(delta, next),
    event: { viewers: next, previously: previous, delta, noticedAt: new Date().toISOString() },
  });
}

/**
 * Ask which sources should fill the active scene.
 *
 * Offered here for the reason the log exists: the commonest thing you learn from it
 * is that the scene is not listening to the harness you are running, and being sent
 * to another page to act on that would be a poor joke. The choice is stored with the
 * scene, exactly as the office stores it.
 */
function openPicker() {
  if (!scene) return;
  sourcePicker.show({
    current: scene.sources,
    testDataPinned: scene.record?.testDataPinned ?? false,
    locked: Boolean(office.reserved),
    onOpenOwnOffice: () => { window.location.href = '/'; },
    onPick: async (sourceIds, { testDataPinned } = {}) => {
      await setSceneSources(scene.id, sourceIds, { testDataPinned });
      scene = getScene(scene.id) ?? scene;
      switcher.setScenes(listScenes());
      repaintWatched();
      paintBadge();
      restartSimulation();
      paintEmpty();
    },
  });
}

/**
 * Which sources this scene listens to, as a set of ids.
 *
 * Recomputed rather than cached: it is read on every arriving event, and a stale
 * copy would dim the wrong rows after a switch — which is worse than no dimming,
 * because the dimming is the thing being trusted.
 */
function watchedIds() {
  return new Set(scene?.sources ?? []);
}

/**
 * Whether the active scene would show this event's source in the room.
 *
 * A harness with no registered source counts as unwatched, and deliberately: the
 * question this dimming answers is "is the office drawing this?", and for a harness
 * the office has no mark for the answer is no. Treating it as watched because there
 * was no source to check would dim every row *except* the most obscure one.
 *
 * Presence is the exception, because the question does not apply to it: a viewer
 * arriving is a fact about the office rather than about any scene in it, and dimming
 * it would be answering a question nobody asked with a wrong answer.
 */
function isWatched(entry, watched) {
  if (entry.kind === 'viewer') return true;
  return Boolean(entry.def) && watched.has(entry.def.id);
}

/**
 * Say how each of the scene's sources is doing, in the badge the office uses.
 *
 * There are no feeds on this page, so the states are assembled from what is
 * actually known: every AOP source shares the one receiver connection, so they
 * share its state — narrowed to `listening` for a harness that has not said
 * anything yet, which is the same distinction AopSource draws between a live
 * connection and a live session. Test Data is live exactly when its toggle is on.
 */
function paintBadge() {
  const defs = (scene?.sources ?? []).map(getSource).filter(Boolean);
  const states = defs.map((def) => {
    if (def.id === SIMULATED) {
      return simulation
        ? { def, state: 'live', detail: 'simulated' }
        : { def, state: 'idle', detail: 'not tailed' };
    }
    if (tailState.state !== 'live') return { def, state: tailState.state, detail: tailState.detail };
    return seenHarnesses.has(def.harness)
      ? { def, state: 'live', detail: null }
      : { def, state: 'waiting', detail: null };
  });

  badge.setSources(defs, { clickable: true });
  badge.setStatus(summarise(states), states);
}

// --- the log --------------------------------------------------------------

/**
 * Rows on screen, newest first, and the pending arrivals not yet in the document.
 *
 * Arrivals are buffered and flushed on a frame because they come in bursts: the
 * opening replay is up to two thousand events in a handful of reads, and a page
 * that touched the document once per event would spend that entire time in layout.
 * One flush per frame makes a burst of eighty into one reflow.
 */
const live = [];            // { entry, row, ago, character }, newest first
let pending = [];
let frame = null;
let received = 0;
let paused = false;

/**
 * Every event still remembered, oldest first — the data behind the rows.
 *
 * Kept apart from `live` because the two answer different questions: `live` is what
 * is on screen, `entries` is what the page *knows*, and a filter is a view of the
 * second drawn into the first. Before they were separate, hiding rows was all a
 * filter could do, which meant it could only ever search the newest hundred events.
 */
const entries = [];

/** Harness slugs seen on the wire, so the badge can tell listening from live. */
const seenHarnesses = new Set();

/** @type {{state: string, detail: ?string}} */
let tailState = { state: 'connecting', detail: null };

/**
 * Add one event.
 *
 * Paused means paused: the arrival is dropped rather than queued, because a log that
 * catches up in a rush when you unpause has lost the thing that made pausing useful.
 * The counter keeps running so you can see it happening.
 */
function add(entry) {
  received++;
  if (paused) { paintControls(); return; }

  // The family is settled once, here, because both the row's colour and the type
  // dropdown's grouping want it and neither should be asking twice.
  entry.family = familyOf(entry.type, entry.kind);

  entries.push(entry);
  if (entries.length > REMEMBER) entries.shift();

  pending.push(entry);
  if (frame === null) frame = requestAnimationFrame(flush);
}

function flush() {
  frame = null;
  const batch = pending;
  pending = [];
  if (!batch.length) return;

  // Filtering happens before anything is built: a filtered log that constructed every
  // arrival and then hid it would do all the work it was told not to.
  const wanted = batch.filter((entry) => filters.matches(entry));

  // Only the newest KEEP can survive, so a two-thousand-event replay builds a
  // hundred elements rather than two thousand and immediately throwing most away.
  const useful = wanted.length > KEEP ? wanted.slice(-KEEP) : wanted;
  const watched = watchedIds();

  // Oldest first into a fragment, each prepended, so the newest ends up at the top.
  const fragment = document.createDocumentFragment();
  for (const entry of useful) {
    const built = createEventRow(entry, entry.def, isWatched(entry, watched));
    fragment.prepend(built.row);
    live.unshift({ entry, ...built });
  }
  rows.prepend(fragment);

  while (live.length > KEEP) live.pop().row.remove();

  // New arrivals can bring a character, a type or a harness the dropdowns have never
  // offered before — the commonest way a filter becomes possible is that the thing to
  // filter on has just turned up.
  filters.setFacets(countFacets(entries));
  paintControls();
  paintEmpty();
}

/**
 * Rebuild the visible rows from what is remembered.
 *
 * The answer to a filter changing, and the reason the entries are kept at all: the
 * newest hundred *matching* events are built afresh, which is how a search can reach
 * back two thousand events into a page that only ever holds a hundred rows.
 *
 * Wholesale, and cheap enough to be: a hundred rows is a handful of milliseconds, and
 * anything cleverer would have to reason about which of two filters is the narrower.
 */
function rebuild() {
  // Anything waiting for the next frame is already in `entries`, so this rebuild is
  // about to draw it — and a queued arrival left queued would then be drawn a second
  // time, which is how a filtered page ends up showing seven rows over a counter that
  // says five. The batch is dropped rather than kept because `entries` is the record
  // and `pending` was only ever a list of what had not been painted yet.
  pending = [];
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }

  for (const { row } of live) row.remove();
  live.length = 0;

  const watched = watchedIds();
  const wanted = [];
  // Newest first, and stopping as soon as there are enough when nothing is filtered:
  // reading a hundred entries out of two thousand rather than all of them is the
  // difference between a scene switch being free and being felt.
  for (let i = entries.length - 1; i >= 0 && wanted.length < KEEP; i--) {
    if (filters.matches(entries[i])) wanted.push(entries[i]);
  }

  const fragment = document.createDocumentFragment();
  for (const entry of wanted) {
    const built = createEventRow(entry, entry.def, isWatched(entry, watched));
    fragment.append(built.row);       // already newest first
    live.push({ entry, ...built });
  }
  rows.prepend(fragment);

  paintControls();
  paintEmpty();
}

/**
 * How many remembered events the filters match.
 *
 * Counted on demand rather than tracked, because tracking it means keeping a running
 * total correct across arrivals, evictions from the far end of the ring, and every
 * change of filter — three chances to drift, in service of a number that costs one
 * pass over an array whose search text is already cached.
 */
function countMatching() {
  if (!filters.active()) return entries.length;
  let n = 0;
  for (const entry of entries) if (filters.matches(entry)) n++;
  return n;
}

/**
 * Re-dim every row against the scene's current sources.
 *
 * Cheap enough to do wholesale — one class per row — and wholesale is the only way
 * to be right: the rows were built against a different scene's idea of watched.
 */
function repaintWatched() {
  const watched = watchedIds();
  for (const { entry, row } of live) {
    setWatched(row, entry, isWatched(entry, watched));
  }
}

/** Retick the relative column. One text write per visible row, once a second. */
function tickClock() {
  const now = Date.now();
  for (const { entry, ago } of live) {
    const next = formatAgo(now - entry.at);
    // Compared before writing: most rows say the same thing they said a second ago
    // once they are past a minute old, and an unchanged assignment still costs.
    if (ago.textContent !== next) ago.textContent = next;
  }
}
setInterval(tickClock, CLOCK_MS);

// --- the wire -------------------------------------------------------------

const tail = createAopTail({
  endpoint: aopEndpoint(),
  onState: (state) => {
    tailState = state;
    paintBadge();
    paintControls();
  },
  onRestart: () => {
    note('The receiver restarted, so everything above it came from a previous one.');
  },
  onEvent: ({ cursor, type, event, raw, at }) => {
    const harness = event?.harness?.name ?? null;
    if (harness) seenHarnesses.add(harness);
    const def = harness ? findByHarness(harness) : null;
    const { character, renamedTo } = characterOf(event, harness, type);
    // Who sent it, in the width of a column — the label the row shows and the name
    // the sender filter files it under are the same answer, so it is asked once.
    const sender = whoOf(def, event, harness);

    add({
      kind: 'aop',
      type,
      cursor,
      def,
      // The emitter's own clock, which is what the event says about itself; the
      // moment it reached us is the fallback, and for a replayed ring the two can
      // be hours apart.
      at: timeOf(event?.ts) ?? at,
      who: sender,
      whoTitle: harness ? `harness.name = ${harness}` : null,
      senderId: senderIdOf(def, harness, 'aop'),
      senderLabel: sender,
      character,
      session: event?.session?.id ?? null,
      summary: event ? describeAop(type, event) : 'unparseable frame',
      event,
      raw,
    });

    // Announced after the row it happened on, so the prompt that caused the rename is
    // itself already in the log to be repainted with everything before it.
    if (renamedTo) renameCharacter(character.key, renamedTo);

    // A harness arriving for the first time can change `waiting` into `live`.
    if (harness) paintBadge();
  },
});

/**
 * The registry entry for a harness slug, if there is one.
 *
 * Built once from the registry rather than searched per event, and `null` is a
 * perfectly good answer: §4.6 reserves five slugs and explicitly allows any other,
 * so a harness we draw no mark for is a stranger to render generically, not an error.
 */
const BY_HARNESS = new Map(SOURCES.filter((def) => def.harness).map((def) => [def.harness, def]));

function findByHarness(harness) {
  return BY_HARNESS.get(harness) ?? null;
}

/** Who this event is about, in the width of a column. */
function whoOf(def, event, harness) {
  const variant = event?.harness?.variant ?? null;
  if (def) return sourceLabel(def, variant);
  // An unregistered harness still gets named, rather than being anonymised into
  // whatever the office happens to draw marks for.
  const suffix = variantLabel(variant);
  return harness ? (suffix ? `${harness} - ${suffix}` : harness) : 'unknown';
}

// --- who it is about ------------------------------------------------------

/**
 * One cast per harness, matching the office exactly.
 *
 * The office runs one `AopSource` per source, and the set of first names already
 * taken — the thing that stops two agents both being Ada — is per-source there. A
 * single cast across every harness would resolve a collision differently and this
 * page would start disagreeing with the room about who is who, which is the one thing
 * it must never do.
 *
 * The log tails harnesses no scene is listening to, so some of these casts name
 * characters the office is not currently drawing. That is the point: those rows are
 * the answer to "why is my agent not in the room?", and they are easier to read about
 * somebody with a name.
 *
 * @type {Map<string, ReturnType<typeof createCast>>}
 */
const casts = new Map();

function castFor(harness) {
  const id = harness ?? 'unknown';
  let cast = casts.get(id);
  if (!cast) casts.set(id, cast = createCast());
  return cast;
}

/**
 * Who, in the room, an AOP frame is about — and whether that answer just changed.
 *
 * The naming rules are the cast's, not this page's, which is what makes the name here
 * the same name as the one on the desk in the office. What is left is the bookkeeping
 * the room does at the same moments: a prompt re-surnames whoever it was addressed to,
 * and a session ending frees their first name for the next arrival.
 *
 * @returns {{character: ?object, renamedTo: ?string}}
 */
function characterOf(event, harness, type) {
  const id = event?.session?.id;
  if (!id) return { character: null, renamedTo: null };

  const cast = castFor(harness);
  const key = `${harness ?? 'unknown'}:${id}`;

  // A subagent has no body of its own in the room (spec §6.1), so it is filed under
  // the agent who sent it: their errand, on their row, findable when you filter to
  // them. Naming it in its own right would promise a colleague you cannot go and look
  // at, and leaving it blank would hide a fan-out that is often exactly what you came
  // to see.
  const parentId = event?.session?.parent_id;
  if (parentId) {
    const parentKey = `${harness ?? 'unknown'}:${parentId}`;
    return {
      character: { key: parentKey, name: cast.get(parentKey)?.name ?? null, subagent: true },
      renamedTo: null,
    };
  }

  const who = cast.note(key, event);
  const character = { key, name: who.name, namedFrom: who.namedFrom, subagent: false };

  let renamedTo = null;
  if (type === 'turn.start') {
    renamedTo = cast.rename(key, event?.payload?.title);
    if (renamedTo) {
      character.name = renamedTo;
      character.namedFrom = 'prompt';
    }
  }
  // Retiring keeps the record and only frees the name, so every row already on screen
  // goes on naming them and a resumed session comes back as itself (see cast.js).
  if (type === 'session.end') cast.retire(key);

  return { character, renamedTo };
}

/**
 * Who a simulated stage direction is about.
 *
 * Test Data invents its own people and announces them, so there is nothing to name
 * here — only somewhere to write down what it said, since most of its events carry an
 * id and no name. Mail is the one addressed to somebody other than its subject, and
 * belongs to the character it was addressed to.
 *
 * @returns {{character: ?object, renamedTo: ?string}}
 */
function simCharacter(ev) {
  const id = ev.id ?? ev.forId ?? null;
  if (!id) return { character: null, renamedTo: null };

  let renamedTo = null;
  if (ev.name && simNames.get(id) !== ev.name) {
    // A rename is news; a spawn is the first thing we knew.
    if (simNames.has(id)) renamedTo = ev.name;
    simNames.set(id, ev.name);
  }

  return {
    character: {
      key: `${SIMULATED}:${id}`,
      // Before the spawn — a replay that starts mid-office, or an event the mock
      // emits about somebody it has not introduced — the id is all there is, and
      // saying so beats inventing a second name for a person who already has one.
      name: simNames.get(id) ?? `agent ${shortId(id)}`,
      namedFrom: 'simulated',
      subagent: false,
    },
    renamedTo,
  };
}

/** Names the simulated feed has announced, by its own agent id. */
const simNames = new Map();

/**
 * A character has been re-surnamed: say so everywhere, including in the past.
 *
 * The alternative is a page holding two names for one person — the old one above the
 * rename, the new one below — which breaks the one promise the character column makes,
 * that the name you can see in the room is the name you can search for here. So every
 * remembered event is updated and every visible row repainted, and a filter set to
 * that character keeps them all rather than appearing to lose half their history.
 *
 * The search text goes with it: a haystack built around the old name would answer a
 * search for the new one with silence.
 */
function renameCharacter(key, name) {
  for (const entry of entries) {
    if (entry.character?.key !== key || entry.character.name === name) continue;
    entry.character = { ...entry.character, name };
    entry.haystack = null;
  }
  for (const { entry, character } of live) {
    if (entry.character?.key === key) setCharacter(character, entry);
  }
}

/**
 * Which sender a row is filed under, as an id the sender filter can hold on to.
 *
 * A registered source is its own id; an unregistered harness is namespaced by its
 * slug so it cannot collide with one; and presence belongs to the office rather than
 * to anything that sends events.
 */
function senderIdOf(def, harness, kind) {
  if (kind === 'viewer') return 'this-office';
  if (def) return def.id;
  return harness ? `harness:${harness}` : 'unknown';
}

function timeOf(ts) {
  if (typeof ts !== 'string') return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

// --- the simulation ------------------------------------------------------

/** @type {?object} the running MockSource, when the toggle is on. */
let simulation = null;
let showSimulated = store.read(Boolean(scene?.sources?.includes(SIMULATED)));

/**
 * Start or stop the simulated feed to match the toggle and the scene.
 *
 * It only runs when the scene actually uses Test Data *and* the toggle is on:
 * simulating agents for a scene that does not use them would be inventing traffic
 * this office does not have, which in a debug log is a lie rather than a demo.
 */
function restartSimulation() {
  const wanted = showSimulated && Boolean(scene?.sources?.includes(SIMULATED));
  if (wanted === Boolean(simulation)) return;

  if (!wanted) {
    simulation.stop();
    simulation = null;
  } else {
    const def = getSource(SIMULATED);
    simulation = createSource(SIMULATED, { project: scene, onStatus: () => {} });
    simulation.start((ev) => {
      const { character, renamedTo } = simCharacter(ev);
      add({
        kind: 'office',
        type: ev.type,
        def,
        at: Date.now(),
        who: def.label,
        whoTitle: 'simulated in this browser — never crosses the network',
        senderId: senderIdOf(def, null, 'office'),
        senderLabel: def.label,
        character,
        session: ev.id ?? null,
        summary: describeOffice(ev.type, ev),
        event: ev,
      });
      if (renamedTo) renameCharacter(character.key, renamedTo);
    });
  }
  paintBadge();
  paintControls();
}

// --- controls -------------------------------------------------------------

const controlsHost = ensureHost('log-controls', { className: 'log-controls', parent: document.body });

const pauseButton = button('Pause', () => {
  paused = !paused;
  if (!paused) pending = [];        // resume on now, not on the backlog
  paintControls();
});
const simButton = button('Test Data', () => {
  showSimulated = !showSimulated;
  store.write(showSimulated);
  restartSimulation();
});
const clearButton = button('Clear', () => {
  for (const { row } of live) row.remove();
  live.length = 0;
  // What is remembered goes too. A Clear that emptied the screen but left the entries
  // behind would put them all back the moment a filter changed, which is not what
  // anybody means by it — and the dropdowns would go on offering characters whose
  // every row had just been thrown away.
  entries.length = 0;
  pending = [];
  filters.setFacets(countFacets(entries));
  paintEmpty();
  paintControls();
});

const counter = node('span', 'lc-count');
const status = node('span', 'lc-status');
// The running total, which the log's join and leave rows are the history of. Nothing
// else in the office displays it at all, so without this you could count viewers only
// by adding up transitions — and the first one is a baseline you never saw.
const watchers = node('span', 'lc-watchers');

controlsHost.append(status, counter, watchers, pauseButton, simButton, clearButton);

/**
 * The filters, which are a view of what is remembered rather than a tap on the feed.
 *
 * Below the strip that holds Pause and Clear rather than in it, because those two act
 * on the *stream* — what is being collected — and these act on the *question* being
 * put to it. Mixing the two in one row invites the reading where a filter is throwing
 * events away, which it never is.
 */
const filters = createLogFilters({
  host: document.getElementById('log-filters'),
  onChange: rebuild,
});
paintControls();

/**
 * `/` puts the cursor in the search box, from anywhere on the page.
 *
 * The one shortcut this page needs: the log is read by scrolling, both hands off the
 * keyboard, and reaching for the mouse to start narrowing is the friction that stops
 * people narrowing at all. Ignored while typing, so a `/` in a search term is a `/`.
 */
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const at = document.activeElement;
  if (at instanceof HTMLInputElement || at instanceof HTMLSelectElement
      || at instanceof HTMLTextAreaElement) return;
  e.preventDefault();
  filters.focusSearch();
});

function button(label, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'lc-button';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function paintControls() {
  pauseButton.textContent = paused ? 'Resume' : 'Pause';
  pauseButton.classList.toggle('on', paused);
  pauseButton.title = paused
    ? 'Arrivals are being counted but not shown'
    : 'Stop the list moving while you read it';

  const usable = Boolean(scene?.sources?.includes(SIMULATED));
  simButton.classList.toggle('on', showSimulated && usable);
  simButton.disabled = !usable;
  simButton.title = usable
    ? 'Test Data is simulated in this browser, so it has no wire to tail — log it from the source instead'
    : 'This scene does not use Test Data';

  // Three numbers could be true at once — what is on screen, what the filters match,
  // and what has arrived — and saying all three every time would be noise. So the
  // counter says the shortest true thing: the plain total when nothing is hidden, and
  // otherwise where the gap is.
  const matched = countMatching();
  if (filters.active()) {
    counter.textContent = matched > live.length
      ? `newest ${live.length} of ${matched} matching · ${received} events`
      : `${matched} of ${received} events match`;
  } else {
    counter.textContent = live.length === received
      ? `${received} event${received === 1 ? '' : 's'}`
      : `${live.length} of ${received} events`;
  }
  counter.title = `${entries.length} events remembered, newest ${KEEP} of the matching ones drawn · cursor ${tail.cursor}`;

  // Hidden until the first heartbeat answers, rather than guessing at zero.
  watchers.hidden = viewers === null;
  watchers.textContent = viewers === 1 ? 'just you watching' : `${viewers} watching`;
  watchers.title = 'Tabs with this office open, counted by a 30s heartbeat that expires after 90s';

  status.dataset.state = tailState.state;
  status.textContent = tailState.detail
    ? `${tailState.state} · ${tailState.detail}`
    : tailState.state;
  status.title = `Tailing every harness on ${aopEndpoint()}/stream`;
}

// --- the empty page -----------------------------------------------------

/**
 * What an empty log means, which is never "broken".
 *
 * The commonest empty page here is the one that is *correct*: a brand new office
 * uses Test Data, Test Data never crosses the network, and so there is genuinely
 * nothing on the wire to show. Saying so — and saying what to do instead — is the
 * difference between a debug tool and a blank screen.
 */
function paintEmpty() {
  // Guarded for the same reason `ensureHost` exists: a missing line of markup
  // should cost the note, not every event that would have arrived after it.
  if (!emptyNote) return;
  if (live.length) {
    emptyNote.textContent = '';
    emptyNote.hidden = true;
    return;
  }
  emptyNote.hidden = false;

  // A page emptied by its own filters is the one empty state that is nobody's fault
  // and nothing to do with the office, so it is answered first and answered plainly —
  // including how many events are sitting behind the filter, because "nothing matches"
  // and "nothing arrived" look identical and mean opposite things.
  if (filters.active()) {
    emptyNote.textContent = entries.length
      ? `None of the ${entries.length} events held here match these filters. Clear them to see everything again.`
      : 'Nothing has arrived yet, and these filters would hide it if it had. Clear them to see everything.';
    return;
  }

  const onlySimulated = (scene?.sources ?? []).every((id) => id === SIMULATED);
  if (scene && (scene.sources?.length ?? 0) === 0) {
    emptyNote.textContent = 'This scene has no sources yet. Choose some from the badge above and their events will appear here.';
  } else if (onlySimulated && !showSimulated) {
    emptyNote.textContent = 'This scene is filled with Test Data, which is simulated in this browser and never crosses the network. Switch on Test Data above to log it, or point the scene at a harness to watch real traffic.';
  } else if (onlySimulated) {
    emptyNote.textContent = 'Waiting for the simulated office to wake up…';
  } else {
    emptyNote.textContent = 'Nothing has arrived yet. Every harness posting to this office shows up here, whether or not this scene is listening to it.';
  }
}

/** A one-off line above the log, for the things that happen to the office itself. */
function note(message) {
  const el = node('li', 'log-note', message);
  rows.prepend(el);
}

// --- go -------------------------------------------------------------------

// Everything above is declarations, and the order here is not arbitrary: the tail
// reports `connecting` synchronously from `start()`, which paints the badge and the
// controls strip. Starting it any earlier — next to its own construction, where it
// would read most naturally — reaches for a button that does not exist yet.
paintBadge();
restartSimulation();
paintEmpty();
tail.start();

// Presence lands in the log like anything else, so its first heartbeat must find a
// controls strip to update. The beat is a round trip and could not arrive before this
// line in practice, but "could not in practice" is a poor foundation for an ordering.
watchOffice({
  onOffice: (info) => {
    keycardChip.setOffice(info);
    notePresence(info?.viewers ?? null);
  },
  onLost: () => {
    note('This office was deleted — nobody was watching it, and no agents arrived.');
  },
});
claimLocalEndpoint().then(() => keycardChip.setOffice(officeInfo()));
