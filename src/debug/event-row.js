// One event, as a line of text you can read at a glance.
//
// The debug log lives or dies on this module: two thousand rows of pretty-printed
// JSON is not a log, it is a haystack. So every event is reduced to one line — when,
// who, what, and the single detail that distinguishes this occurrence from the next
// one — with the full envelope a click away for when the line is not enough.
//
// "Who" is answered twice, because a row has two of them and they are not the same
// question: the *sender* (which harness put this on the wire) and the **character**
// (which colleague in the room it is about). The sender is what you filter by when an
// adapter is misbehaving; the character is what you look for when you are watching
// somebody walk across the office and want to know what they are doing. A log that
// offered only a session id left the second question to be answered by hand.
//
// The summaries below are written from the spec's payload tables (docs/developer/protocol/aop-spec.md
// §4) rather than from whatever a harness happened to send, and every one of them
// falls back rather than throwing: an adapter that omits a documented field, or
// invents one, must still produce a readable row. A debug log that breaks on
// malformed input is broken exactly when it is needed.

import { node } from '../ui/dom.js';
import { renderMark } from '../ui/marks.js';
import { preciseDuration, elideMiddle } from '../ui/format.js';

/**
 * Which family an AOP type belongs to, for colour (spec §4: eighteen types, five
 * families). Colour is doing real work here — it is what lets you find the one
 * `permission.request` in a wall of `tool.start`s without reading any of them.
 */
const FAMILY = {
  'session.start': 'session', 'session.end': 'session', 'session.heartbeat': 'session',
  // Steps are turns, not tools. They are parts of one piece of work rather than calls
  // made during it, and the colour is where that reading is easiest to check: a round
  // walking its checklist should read as one long turn, not as a burst of tool traffic.
  'turn.start': 'turn', 'turn.title': 'turn', 'turn.end': 'turn',
  'step.start': 'turn', 'step.end': 'turn',
  'tool.start': 'tool', 'tool.end': 'tool', 'artifact.change': 'tool',
  'permission.request': 'attention', 'permission.resolve': 'attention',
  notification: 'attention', error: 'attention', 'context.compact': 'attention',
  'job.queued': 'job', 'job.claimed': 'job', 'job.dropped': 'job',
  usage: 'session',
};

/** The office's own vocabulary, which the simulated feed speaks (see MockSource). */
const OFFICE_FAMILY = {
  spawn: 'session', exit: 'session', rename: 'session',
  status: 'turn', job: 'turn', step: 'turn',
  research: 'tool', activity: 'tool',
  mail: 'job', dispatch: 'job',
};

export function familyOf(type, kind) {
  // People arriving and leaving are their own family: they are the only rows about
  // the office rather than about work happening inside it.
  if (kind === 'viewer') return 'presence';
  if (kind === 'office') return OFFICE_FAMILY[type] ?? 'other';
  return FAMILY[type] ?? 'other';
}

// --- time ------------------------------------------------------------------

/**
 * The wall clock, to the millisecond.
 *
 * Milliseconds are not decoration: the events worth staring at arrive in bursts —
 * a `tool.start`/`tool.end` pair around an 80ms grep — and to the second they all
 * carry the same timestamp and the log stops being able to show you an order.
 *
 * Assembled by hand rather than through `Intl`: this runs for every row of a
 * two-thousand-event replay, and a `DateTimeFormat` per row is the one thing in
 * here fast enough to notice.
 */
export function formatClock(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/** The date, shown only when an event is not from today — a replayed ring can be old. */
export function formatDay(date, now = new Date()) {
  const sameDay = date.getDate() === now.getDate()
    && date.getMonth() === now.getMonth()
    && date.getFullYear() === now.getFullYear();
  if (sameDay) return '';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * How long ago, in the largest unit that still says something useful.
 *
 * Seconds, then minutes, then hours — and days past that, because a ring buffer
 * replayed on a Monday morning would otherwise offer "73h ago" as though that were
 * an answer. Rounded down throughout, so a row never claims to be older than it is.
 */
export function formatAgo(ms) {
  if (ms < 0) return 'just now';           // a harness clock running slightly ahead
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// --- one-line summaries ----------------------------------------------------

/**
 * The one detail that tells this event apart from the next one of its type.
 *
 * @param {string} type
 * @param {object} event  a full AOP envelope
 * @returns {string}
 */
export function describeAop(type, event) {
  const p = event?.payload ?? {};
  const bits = [];

  switch (type) {
    case 'session.start':
      // What kind of start it was is the interesting part — a `resume` that the
      // office treats as a new arrival is a bug you can only see spelled out.
      push(bits, p.source);
      push(bits, event?.session?.label);
      push(bits, p.model);
      if (p.permission_mode) bits.push(`mode ${p.permission_mode}`);
      // The redaction mode belongs on the very first row of a session, because it
      // is the answer to the question the rest of the session provokes: at
      // `metadata` every title is the word "Working" and every summary is absent,
      // by design (spec §10). Without this the log looks broken instead of quiet,
      // and the only way to find out which was to go and read a settings file.
      if (p.redaction) bits.push(`redaction ${p.redaction}`);
      if (Array.isArray(p.capabilities)) bits.push(`${p.capabilities.length} capabilities`);
      break;

    case 'session.heartbeat':
      push(bits, p.status);
      if (Number.isFinite(p.idle_ms)) bits.push(`idle ${preciseDuration(p.idle_ms)}`);
      break;

    case 'session.end':
      push(bits, p.reason);
      pushDuration(bits, p.duration_ms);
      break;

    case 'turn.start':
      // The title is the desk label, so it is the row: it is the closest thing the
      // protocol has to "what is this agent actually doing".
      push(bits, p.title);
      // Why, next to what — and `origin` rather than `trigger` when both are here,
      // because it is the one that names the job. A title that *is* the origin's name is
      // the common case for a scheduled run, and repeating it verbatim two columns apart
      // would say nothing twice, so that pairing collapses to the schedule alone.
      if (p.origin?.kind) {
        const from = [];
        if (p.origin.name && p.origin.name !== p.title) from.push(p.origin.name);
        if (p.origin.schedule) from.push(p.origin.schedule);
        bits.push(from.length ? `via ${p.origin.kind}: ${from.join(', ')}` : `via ${p.origin.kind}`);
      } else {
        push(bits, p.trigger && `via ${p.trigger}`);
      }
      // A turn that arrives knowing it has parts is worth telling apart from one that
      // does not, because everything below about steps follows from it.
      if (Array.isArray(p.plan) && p.plan.length) {
        bits.push(`${p.plan.length} step${p.plan.length === 1 ? '' : 's'}`);
      }
      break;

    case 'turn.title':
      // The new label and nothing else. What it replaced is a row or two above, which
      // is where the log is better read than a `from → to` on one line would be.
      push(bits, p.title);
      break;

    case 'step.start':
      // Same shape as the roster row and the HUD, and for the same reason: one step
      // described two ways in two panels is the office contradicting itself. The
      // title-less form is not a fallback — at `metadata` the title is dropped
      // emitter-side and the counters are the whole of what arrived (spec §10).
      push(bits, p.title);
      if (Number.isFinite(p.index) && Number.isFinite(p.of)) bits.push(`${p.index} of ${p.of}`);
      else if (Number.isFinite(p.index)) bits.push(`step ${p.index}`);
      if (Array.isArray(p.plan) && p.plan.length) bits.push(`plan of ${p.plan.length}`);
      break;

    case 'step.end':
      // `skipped` is the one worth reading the log for: a part that was deliberately
      // not done looks identical to one that was, everywhere except here.
      push(bits, p.status ?? 'completed');
      push(bits, p.summary);
      pushDuration(bits, p.duration_ms);
      break;

    case 'turn.end':
      push(bits, p.status);
      push(bits, p.summary ?? p.title);
      pushDuration(bits, p.duration_ms);
      break;

    case 'tool.start':
      push(bits, p.tool_name);
      push(bits, p.tool_class && `[${p.tool_class}]`);
      // Both, not one or the other. `target` is what the call is *on* and `summary`
      // is what the harness chose to say about it; a `??` between them meant that
      // any adapter sending both had one of them silently dropped, and which one
      // depended on a field the reader could not see.
      push(bits, pathish(p.target));
      push(bits, p.summary);
      if (p.concurrent) bits.push('concurrent');
      break;

    case 'tool.end':
      push(bits, p.tool_name);
      push(bits, p.status);
      pushDuration(bits, p.duration_ms);
      push(bits, p.error);
      break;

    case 'artifact.change':
      push(bits, p.kind);
      push(bits, pathish(p.path ?? p.url));
      if (Number.isFinite(p.added) || Number.isFinite(p.removed)) {
        bits.push(`+${p.added ?? 0} −${p.removed ?? 0}`);
      }
      break;

    case 'permission.request':
      push(bits, p.tool_name);
      push(bits, pathish(p.target));
      push(bits, p.reason);
      break;

    case 'permission.resolve':
      push(bits, p.decision);
      push(bits, p.by && `by ${p.by}`);
      break;

    case 'notification':
    case 'error':
      push(bits, p.level ?? p.kind);
      push(bits, p.message);
      if (p.recoverable === false) bits.push('unrecoverable');
      break;

    case 'context.compact':
      push(bits, p.trigger);
      if (Number.isFinite(p.tokens_before) && Number.isFinite(p.tokens_after)) {
        bits.push(`${p.tokens_before} → ${p.tokens_after} tokens`);
      }
      break;

    case 'job.queued':
      push(bits, p.title);
      push(bits, p.source && `from ${p.source}`);
      push(bits, p.priority);
      break;

    case 'job.claimed':
      push(bits, p.job_id);
      push(bits, p.claimed_by && `→ ${p.claimed_by}`);
      break;

    case 'job.dropped':
      push(bits, p.job_id);
      push(bits, p.reason);
      break;

    case 'usage':
      pushUsage(bits, p);
      break;

    default:
      // An unknown type is the one this page most needs to render well: it is
      // either a spec that has grown or an adapter that is wrong, and both are
      // invisible if the row is blank. Show the payload as it came.
      return compact(p);
  }

  return bits.join(' · ');
}

/**
 * The same job for the office's own vocabulary, which the simulated feed speaks.
 *
 * These are stage directions rather than protocol events — what the room was told
 * to show, not what a harness reported — and they are logged so that a Test Data
 * scene has something to tail at all. Keeping them in the same list as AOP events
 * is only honest if they never look the same, which is what the `office` kind and
 * this separate vocabulary are for.
 */
export function describeOffice(type, ev) {
  const bits = [];
  switch (type) {
    case 'spawn': push(bits, ev.name); push(bits, ev.variant); break;
    case 'rename': push(bits, ev.name); break;
    case 'status': push(bits, ev.status); break;
    case 'job': push(bits, ev.job); break;
    case 'research': push(bits, ev.scope); push(bits, ev.topic); break;
    case 'activity': push(bits, ev.activity); break;
    case 'mail':
      push(bits, ev.size);
      push(bits, ev.job);
      bits.push(ev.forId ? `for ${shortId(ev.forId)}` : 'unaddressed');
      break;
    case 'dispatch': push(bits, ev.summary); break;
    case 'exit': break;
    default: return compact(ev);
  }
  return bits.join(' · ');
}

/**
 * Somebody opened or closed a tab on this office.
 *
 * Only the count is knowable — presence is a heartbeat per tab and nothing more, so
 * there is no name to show and no way to tell which of two viewers left. A delta
 * bigger than one is reported as itself rather than split into separate rows it
 * cannot actually distinguish.
 *
 * @param {number} delta   change in viewers, negative for leaving
 * @param {number} viewers how many are watching now, this tab included
 */
export function describePresence(delta, viewers) {
  const bits = [];
  if (Math.abs(delta) > 1) bits.push(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}`);
  // "Just you" is the fact worth stating plainly, because the reason to look at this
  // at all is usually to find out whether anyone else is in here.
  if (viewers <= 1) bits.push(viewers === 1 ? 'just you watching' : 'nobody watching');
  else bits.push(`${viewers} watching, including you`);
  return bits.join(' · ');
}

/**
 * A path shortened from the middle; anything else left exactly as it came.
 *
 * The distinction is between values with structure and values that are prose. A
 * path, URL or branch has its identity at the end, so cutting the end throws away
 * the answer — that is the bug this exists for. A message or a reason reads from
 * the left and can safely run off the right-hand edge, which the cell's own
 * ellipsis already does, better, at whatever width the window happens to be.
 */
function pathish(value) {
  if (typeof value !== 'string' || !/[/\\]/.test(value)) return value;
  return elideMiddle(value, PATH_CHARS);
}

/**
 * How much of a path a summary cell can carry before it is doing more harm than
 * good. Not a pixel measurement — the cell is `1fr` and its width is the window's
 * business — but a budget: past about this much, a path is crowding out the tool
 * name and the class beside it, which are what the eye is running down.
 */
const PATH_CHARS = 72;

function push(bits, value) {
  if (typeof value === 'string' && value.trim()) bits.push(value.trim());
  else if (typeof value === 'number') bits.push(String(value));
}

function pushDuration(bits, ms) {
  if (Number.isFinite(ms)) bits.push(preciseDuration(ms));
}

function pushUsage(bits, p) {
  const u = p?.usage ?? p ?? {};
  if (Number.isFinite(u.input_tokens)) bits.push(`in ${u.input_tokens}`);
  if (Number.isFinite(u.output_tokens)) bits.push(`out ${u.output_tokens}`);
  if (Number.isFinite(u.cached_tokens)) bits.push(`cached ${u.cached_tokens}`);
  if (Number.isFinite(u.cost_usd)) bits.push(`$${u.cost_usd}`);
}

/** A payload with no summary of its own, flattened to something scannable. */
function compact(obj) {
  if (!obj || typeof obj !== 'object') return obj == null ? '' : String(obj);
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' || k === 'id') continue;
    if (v === null || v === undefined) continue;
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
    const short = text.length <= 60 ? text
      : (/[/\\]/.test(text) ? elideMiddle(text, 60) : `${text.slice(0, 59)}…`);
    parts.push(`${k}=${short}`);
    if (parts.length === 6) break;
  }
  return parts.join(' ');
}

/**
 * Session ids are long and only their tail distinguishes them, so they are shown
 * short — enough to follow one session down the page, which is the only thing
 * anyone does with them here. The full id is in the expanded envelope.
 */
export function shortId(id) {
  const text = String(id ?? '');
  // Namespaced ids from the office's fan-in arrive as `source#agent-3`; the useful
  // half is after the hash (see feeds.js).
  const tail = text.includes('#') ? text.slice(text.indexOf('#') + 1) : text;
  return tail.length > 10 ? `…${tail.slice(-8)}` : tail;
}

// --- the row ---------------------------------------------------------------

/**
 * The columns, named once.
 *
 * A log without column headers asks its reader to work out that the third field is
 * an event type and the sixth is a truncated session id — which is a puzzle you
 * only have to solve once, and therefore exactly the kind nobody should be given
 * on a bad day. The awkward part is that the headers and the cells are in
 * different places in the DOM, so this list is the one description of the columns
 * and both of them are built from it: `createHeaderRow` for the labels, and
 * `createEventRow` for the order it appends its cells in. Adding a column to one
 * and forgetting the other is then not something you can do.
 *
 * @type {{cls: string, label: string, hint: string}[]}
 */
export const LOG_COLUMNS = [
  { cls: 'lr-time', label: 'when', hint: 'When the event arrived, and how long ago' },
  // No label: the column is sixteen pixels wide, which is a mark and nothing else.
  { cls: 'lr-mark', label: '', hint: 'Which harness sent this' },
  { cls: 'lr-type', label: 'event', hint: 'The AOP event type — see docs/developer/protocol/aop-spec.md §4' },
  { cls: 'lr-character', label: 'who in the room', hint: 'The colleague this row is about, by the name on their desk' },
  { cls: 'lr-who', label: 'sender', hint: 'The harness that emitted it' },
  { cls: 'lr-session', label: 'session', hint: 'Session id, shortened — the full one is in the expanded envelope' },
  { cls: 'lr-summary', label: 'what happened', hint: 'The detail that tells this event apart from the next one of its type' },
];

/**
 * The header strip: the same seven columns, on the same grid, one row above.
 *
 * Hidden from assistive technology on purpose. These are not table headers — the
 * rows are list items, not cells — so a screen reader gains nothing from hearing
 * seven stray nouns before a log that already reads its rows out in full
 * sentences. The header is a visual aid for a reader scanning columns, and it is
 * honest to say so.
 */
export function createHeaderRow() {
  const head = node('div', 'log-head-row');
  head.setAttribute('aria-hidden', 'true');
  for (const col of LOG_COLUMNS) {
    const cell = node('span', 'lrh');
    cell.dataset.col = col.cls;
    cell.textContent = col.label;
    if (col.hint) cell.title = col.hint;
    head.append(cell);
  }
  return head;
}

/**
 * Build one row.
 *
 * Constructed once and mutated thereafter only by the clock (see `entry.ago`), so a
 * hundred rows on screen cost a hundred text writes per second and nothing else.
 * The expanded envelope is deliberately *not* built here — most rows are never
 * opened, and stringifying every payload on arrival is how a log gets slow.
 *
 * @param {object} entry  see src/debuglog.js for the shape
 * @param {?object} def   the SourceDef this event's harness belongs to, if known
 * @param {boolean} watched  whether the active scene listens to that source
 * @returns {{ row: HTMLElement, ago: HTMLElement, character: HTMLElement }}
 */
export function createEventRow(entry, def, watched) {
  const row = node('li', 'log-row');
  row.dataset.family = familyOf(entry.type, entry.kind);
  row.dataset.kind = entry.kind;

  const line = node('div', 'lr-line');
  line.setAttribute('role', 'button');
  line.tabIndex = 0;
  line.setAttribute('aria-expanded', 'false');

  const date = new Date(entry.at);
  const day = formatDay(date);

  const time = node('span', 'lr-time');
  const abs = node('time', 'lr-abs');
  abs.dateTime = date.toISOString();
  abs.textContent = day ? `${day} ${formatClock(date)}` : formatClock(date);
  const ago = node('span', 'lr-ago', formatAgo(Date.now() - entry.at));
  time.append(abs, ago);

  const mark = node('span', 'lr-mark');
  if (def) {
    mark.style.setProperty('--accent', def.accent);
    mark.innerHTML = renderMark(def.mark);
    mark.title = def.label;
  } else {
    // A harness with no registered source is not an error — the registry is a list
    // of what we draw marks for, not a list of what may talk to us (spec §4.6) —
    // so it gets a neutral placeholder and its slug in the `who` column. Rows that
    // are not about a harness at all (presence) bring their own glyph.
    mark.classList.add('unknown');
    mark.textContent = entry.glyph ?? '•';
  }

  const type = node('span', 'lr-type', entry.type ?? '(untyped)');

  // Who this is about, in the room's own words — the same name on the desk label and
  // over the agent's head, so a row can be tied to a body without decoding an id.
  const character = node('span', 'lr-character');
  setCharacter(character, entry);

  const who = node('span', 'lr-who', entry.who);
  if (entry.whoTitle) who.title = entry.whoTitle;

  const session = node('span', 'lr-session', entry.session ? shortId(entry.session) : '');
  if (entry.session) session.title = entry.session;

  const summary = node('span', 'lr-summary', entry.summary);

  // Appended in `LOG_COLUMNS` order rather than by hand, so the cells cannot end up
  // in a different order from the headers above them.
  const cells = {
    'lr-time': time,
    'lr-mark': mark,
    'lr-type': type,
    'lr-character': character,
    'lr-who': who,
    'lr-session': session,
    'lr-summary': summary,
  };
  line.append(...LOG_COLUMNS.map((col) => cells[col.cls]).filter(Boolean));
  row.append(line);

  // Lazily built, once, on first open.
  let pre = null;
  const toggle = () => {
    if (!pre) {
      pre = document.createElement('pre');
      pre.className = 'lr-json';
      // Pretty-printed when we have an object, and the raw text when we do not:
      // a frame that failed to parse is shown exactly as it arrived, since the
      // malformation is the thing being looked at.
      pre.textContent = entry.event
        ? JSON.stringify(entry.event, null, 2)
        : (entry.raw ?? '');
      row.append(pre);
    }
    const open = row.classList.toggle('open');
    line.setAttribute('aria-expanded', String(open));
  };

  line.addEventListener('click', toggle);
  line.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  setWatched(row, entry, watched);
  // The character cell is handed back with the clock: both are cells a built row is
  // expected to be told about again later, and finding them by query would be looking
  // up something we were holding a moment ago.
  return { row, ago, character };
}

/**
 * Mark whether the active scene shows this event's source, and say why not.
 *
 * Dimming on its own is a signal nobody can look up: a row half as bright as its
 * neighbours could mean anything, and a reader with a missing agent has no reason to
 * guess it means *this*. So the reason goes in the tooltip, naming the source, which
 * turns the one thing this page is best at telling you into something it actually
 * says out loud.
 *
 * Separate from construction because a scene switch re-answers it for every row that
 * is already on screen.
 */
export function setWatched(row, entry, watched) {
  row.classList.toggle('unwatched', !watched);
  const line = row.querySelector('.lr-line');
  if (!line) return;
  if (watched) line.removeAttribute('title');
  else line.title = entry.def
    ? `This scene is not listening to ${entry.def.label}, so the office is not showing this`
    : 'No source is registered for this harness, so the office cannot show it';
}

/**
 * Write the character cell: who, in the room, this row is about.
 *
 * Split out from construction because a name is not fixed for the life of a row. An
 * agent is re-surnamed when their work changes — Ada Prompt becomes Ada Filter-Builder
 * the moment the prompt lands — and the log repaints every row that character owns
 * rather than leaving the page holding two names for one person. That is the whole
 * point of naming rows at all: the name you are reading in the room is the name you
 * can search for here, all the way back through their history.
 *
 * @param {HTMLElement} cell  the `.lr-character` span
 * @param {object} entry
 */
export function setCharacter(cell, entry) {
  const who = entry.character;

  if (!who) {
    // Not everything is about somebody: a queued job belongs to nobody yet, and a
    // tab opening is about the office rather than anyone in it. An em dash says that
    // more honestly than a guess would.
    cell.textContent = '—';
    cell.className = 'lr-character none';
    cell.title = 'Not about anybody in the room';
    return;
  }

  cell.className = 'lr-character';
  if (who.subagent) {
    // A subagent has no body in the room yet (spec §6.1), so naming it outright would
    // promise a colleague you will never find. It is shown as the errand of the agent
    // who sent it, indented, which also answers the question it otherwise provokes:
    // why did nobody move when this arrived?
    cell.classList.add('sub');
    cell.textContent = `↳ ${who.name ?? 'subagent'}`;
    cell.title = who.name
      ? `A subagent of ${who.name}. The room does not draw subagents, so nobody moves for this row.`
      : 'A subagent. The room does not draw subagents, so nobody moves for this row.';
    return;
  }

  cell.textContent = who.name;
  cell.title = `${who.name}${NAMED_FROM[who.namedFrom] ?? ''}`;
}

/** Where a name came from, spelled out — the office's rules, said once (see cast.js). */
const NAMED_FROM = {
  harness: ' — the name the harness chose for this session',
  branch: ' — named after the git branch, until a prompt says otherwise',
  prompt: ' — surnamed after the work they were last given',
  simulated: ' — invented by the simulated feed, which never crosses the network',
};

/**
 * Everything about a row worth matching a search against, lowercased once and kept.
 *
 * The raw envelope is in here, not just the line: the reason to search a debug log is
 * usually a value that never made it into a one-line summary — a tool call id, a file
 * path, a model name — and a search that could only see what was already on screen
 * would be no better than reading. Built on demand and cached, because most sessions
 * never type anything in the box, and thrown away on a rename so a search for the new
 * name cannot miss rows the old one would have found.
 *
 * @param {object} entry
 * @returns {string}
 */
export function searchText(entry) {
  if (entry.haystack != null) return entry.haystack;
  const parts = [
    entry.type, entry.who, entry.character?.name, entry.session, entry.summary,
    entry.raw ?? (entry.event ? JSON.stringify(entry.event) : ''),
  ];
  entry.haystack = parts.filter(Boolean).join(' ').toLowerCase();
  return entry.haystack;
}
