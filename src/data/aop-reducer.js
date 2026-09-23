// The one reducer: AOP events (what happened) into stage directions (what the
// office should show), per spec §6. Extracted from AopSource so the rules can
// be tested without a network in the room — the class keeps the transport
// (snapshot, SSE, reconnect) and drives this with real timers and the real
// clock; a test drives it with fake ones and a recorded stream.
//
// Stateful on purpose: sessions, their in-flight tools and the travel
// debounce ARE the reduction — but everything impure arrives injected, so in
// Node this is just a function of events and time.

// Naming a session is not the reducer's business: the debug log has to arrive
// at the same name for the same session or it would be describing a different
// office, so the rules live in one place both can read (src/agents/cast.js).
import { createCast } from '../agents/cast.js';
import { startsNewJob, jobLabel } from '../agents/names.js';
// Clothes, however, are ours: only the room paints anybody.
import { resolveColour, loadColourNames as loadColourNamesReal } from '../agents/colour.js';

// Tool classes that are worth walking across the room for. Everything else is
// desk work, so it must not trigger a trip — see the debounce note below.
const TRAVEL_CLASSES = new Set(['search', 'network', 'knowledge', 'scm', 'wait']);

// A tool call shorter than this renders as continued desk work rather than a
// journey (spec §6). Without it, a burst of 80ms greps has agents pacing the
// room all day and never appearing to work.
export const TRAVEL_DEBOUNCE_MS = 400;

/** As long a URL as an avatar can plausibly need; a cap all the same. */
const MAX_AVATAR_URL = 512;

/**
 * Steps: the missing middle between a turn and a tool call (spec §4.2).
 *
 * Everything here arrives from a harness, so the caps are re-applied on this side
 * too. An emitter is supposed to have trimmed already, but "the emitter promised"
 * is not a defence a receiver gets to make.
 */
const MAX_STEP_TITLE = 80;
const PLAN_MAX = 20;
const PLAN_STATUS = new Set(['pending', 'active', 'completed', 'skipped', 'failed', 'cancelled']);
const STEP_END_STATUS = new Set(['completed', 'skipped', 'failed', 'cancelled']);

/**
 * A plan off the wire, into the shape the panels draw.
 *
 * Generous about what it accepts, in the house style: a bare array of strings is a
 * plan somebody wrote in a hurry, and refusing it would only mean a checklist that
 * silently never appears. Over-long lists are **truncated, not dropped** — the
 * remainder becomes `more`, so a 200-item list still says something true rather
 * than nothing at all.
 *
 * @param {*} value
 * @returns {?{items: Array<{id: ?string, title: string, status: string}>, more: number}}
 */
export function normalisePlan(value) {
  if (!Array.isArray(value)) return null;
  const items = [];
  for (const entry of value) {
    const raw = typeof entry === 'string' ? entry : entry?.title;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (items.length >= PLAN_MAX) break;
    items.push({
      id: typeof entry?.id === 'string' && entry.id ? entry.id : null,
      title: raw.trim().slice(0, MAX_STEP_TITLE),
      status: PLAN_STATUS.has(entry?.status) ? entry.status : 'pending',
    });
  }
  if (!items.length) return null;
  // Only the entries we could actually read count towards the remainder, so a list
  // padded with blanks does not claim a tail that was never there.
  const legible = value.filter((e) => {
    const raw = typeof e === 'string' ? e : e?.title;
    return typeof raw === 'string' && raw.trim();
  }).length;
  return { items, more: Math.max(0, legible - items.length) };
}

/**
 * How long a session may go quiet before the office assumes it is gone.
 *
 * Reaping exists for harnesses that die without a word — `kill -9` sends no
 * `session.end` — not for people who are thinking. There are two clocks: a
 * session that declared `session.end` in its `capabilities` (spec §4.1) has
 * promised to say goodbye, and that promise is worth trusting, so it is only
 * reaped as a crash backstop. Everything else keeps a short leash, because a
 * stuck character that never leaves is worse than one that leaves early.
 */
export const SESSION_TTL_MS = 300_000;          // no farewell promised: 5 minutes
export const FAREWELL_TTL_MS = 30 * 60_000;     // farewell promised: 30 minutes, crash-only

/**
 * An avatar URL we are willing to put in an `<img src>`.
 *
 * Everything here arrives from a harness, so it is untrusted by definition, and an `src`
 * is one of the few places a string becomes a *decision* — `javascript:` and `data:` both
 * do something in one. Only two shapes get through: a root-relative path, which is how the
 * office's own avatar route names itself, and an absolute `http(s)` URL, for a harness whose
 * identities already have pictures on the web. A protocol-relative `//host/x` is refused
 * with them, being an absolute URL wearing a relative coat.
 */
export function safeAvatar(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url || url.length > MAX_AVATAR_URL) return null;
  if (url.startsWith('//')) return null;
  if (url.startsWith('/')) return url;
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * @param {object} deps
 * @param {string} deps.harness   the slug this feed subscribes to; events naming
 *   another harness are not ours and are dropped
 * @param {(ev: object) => void} deps.emit  where stage directions go
 * @param {() => number} [deps.now]
 * @param {Function} [deps.schedule]  setTimeout, or a test fake
 * @param {Function} [deps.cancel]    clearTimeout, or a test fake
 * @param {() => Promise} [deps.loadColourNames]  the 237 KB colour table fetch
 */
export function createAopReducer({
  harness,
  emit,
  now = Date.now,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
  loadColourNames = loadColourNamesReal,
} = {}) {
  /**
   * Live sessions, keyed `harness:session.id` — the office identity from spec
   * §3.2, because two harnesses can hand out the same session id.
   */
  const sessions = new Map();

  /**
   * Who those sessions are, by name. Held apart from the records above because the
   * debug log needs the same answer without any of the rest of this class, and a
   * second implementation of "who is this?" is a second office.
   */
  const cast = createCast();

  /** Event ids already reduced, so a snapshot/stream overlap is harmless. */
  let seen = new Set();

  /** @param {object} ev an AOP envelope */
  function reduce(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.harness?.name && ev.harness.name !== harness) return;

    // Unknown event types are ignored rather than rejected, so a newer adapter
    // can talk to an older office (spec §11).
    if (ev.id) {
      if (seen.has(ev.id)) return;
      seen.add(ev.id);
      // The set is a duplicate guard, not a log; keep it from growing forever.
      if (seen.size > 5000) seen = new Set([ev.id]);
    }

    // TODO(ghosts): subagent sessions should materialise as translucent clones at
    // the parent's desk (spec §6.1). Until the scene can do that they are
    // skipped — spawning them normally would let one fan-out evict every real
    // session from the room.
    if (ev.session?.parent_id) return;

    const key = keyOf(ev);
    if (!key) return;

    const p = ev.payload ?? {};

    switch (ev.type) {
      case 'session.end':   return end(key);
      case 'session.start': {
        const rec = touch(key, ev);
        // Trust a session that says it will announce its own end.
        if (Array.isArray(p.capabilities) && p.capabilities.includes('session.end')) {
          rec.saysGoodbye = true;
        }
        return;
      }
      case 'session.heartbeat': { touch(key, ev); return; }

      case 'turn.start': {
        const rec = touch(key, ev);
        const replaceJob = startsNewJob(rec.jobTitle, p.title);
        if (replaceJob) {
          rec.jobTitle = jobLabel(p.title);
          renameFromTitle(key, rec, rec.jobTitle);
        }

        // A new round starts with nothing in hand. Normally `turn.end` has already
        // cleared these, but hook-based adapters drop events, and a step left over
        // from the last turn would sit on the desk label as though it were live.
        clearSteps(key, rec);
        rec.plan = normalisePlan(p.plan);

        // Every prompt is a request that arrived from outside, so it arrives the
        // way requests do: by air, into the mailbox, and the agent fetches it.
        //
        // Addressed to this session, because that is the truth — a prompt typed
        // into one terminal cannot be picked up by anybody else, and an
        // unaddressed envelope in a shared box is collectable by whoever reaches
        // it first. The title travels inside the envelope rather than being set
        // here, so the desk label changes when the agent actually opens it.
        // The plan travels *inside* the envelope with the title, for the same reason
        // the title does: it is the contents of the request, and the office should
        // not know the checklist before anybody has opened the thing.
        // A turn is not necessarily a job. Once a session has a useful heading,
        // acknowledgements, corrections and packing-up requests keep carrying that
        // same assignment rather than becoming direct quotes on the roster. An
        // explicit/new substantive job replaces it above. Generic metadata-only
        // turns still have an honest fallback until a real title arrives.
        const job = rec.jobTitle ?? jobLabel(p.title) ?? 'New request';
        emit({ type: 'mail', job, forId: key, plan: planOut(rec) });
        if (!rec.waiting) emit({ type: 'status', id: key, status: 'working' });
        return;
      }

      // The work turned out to have a name. Harnesses learn it late — Claude writes
      // its generated session title a second or two after the prompt that earned it
      // — so the desk opens labelled with a quote of the request and is corrected
      // here, rather than wearing the quote until the turn ends.
      case 'turn.title': {
        const rec = touch(key, ev);
        retitleJob(key, rec, p.title);
        return;
      }

      case 'turn.end': {
        const rec = touch(key, ev);
        retitleJob(key, rec, p.title);
        rec.waiting = false;
        // A step never outlives its turn (spec §4.2 rule 3), and the checklist goes
        // with it: it described this round, and the round is over.
        clearSteps(key, rec, { failed: p.status === 'error' });
        if (p.status === 'completed') {
          return emit({ type: 'dispatch', id: key, summary: p.summary ?? p.title });
        }
        if (p.status === 'error') return emit({ type: 'status', id: key, status: 'error' });
        return emit({ type: 'status', id: key, status: 'idle' });
      }

      case 'step.start':  return stepStart(key, ev, p);
      case 'step.end':    return stepEnd(key, ev, p);

      case 'tool.start':  return toolStart(key, ev, p);
      case 'tool.end':    return toolEnd(key, ev, p);

      case 'permission.request': {
        const rec = touch(key, ev);
        rec.waiting = true;
        return emit({ type: 'status', id: key, status: 'waiting' });
      }

      case 'permission.resolve': {
        const rec = touch(key, ev);
        rec.waiting = false;
        return emit({ type: 'status', id: key, status: 'working' });
      }

      case 'notification': {
        const rec = touch(key, ev);
        if (p.level !== 'warn' && p.level !== 'error') return;
        rec.waiting = true;
        return emit({ type: 'status', id: key, status: 'waiting' });
      }

      case 'error': {
        touch(key, ev);
        return emit({ type: 'status', id: key, status: 'error' });
      }

      case 'context.compact': {
        touch(key, ev);
        return emit({ type: 'activity', id: key, activity: 'water' });
      }

      // Inbound work is not about a session at all — it is a paper airplane.
      case 'job.queued':
        return emit({ type: 'mail', job: p.title ?? 'Incoming job' });

      default:
        return;   // artifact.change, job.claimed, job.dropped: nothing to stage yet
    }
  }

  function keyOf(ev) {
    const id = ev.session?.id;
    return id ? `${ev.harness?.name ?? harness}:${id}` : null;
  }

  /**
   * Find or create the session behind an event.
   *
   * Any event naming an unknown session spawns it (spec §7.1, "implicit spawn"),
   * because hook-based adapters are lossy: a dropped `session.start` must not
   * mean an invisible agent for the rest of the run.
   */
  function touch(key, ev) {
    let rec = sessions.get(key);
    if (!rec) {
      // The cast decides who this is — including handing back the name a session had
      // before it was reaped, so a harness that goes quiet and speaks up again is
      // the same colleague rather than a stranger at the same desk.
      const who = cast.note(key, ev);
      rec = {
        who,
        lastSeen: now(),
        jobTitle: null,
        waiting: false,
        tools: new Map(),
        // Which part of the round is in hand, and the checklist it came from. Both
        // null for the whole of a normal turn — see the steps block below.
        step: null,
        plan: null,
        stepSeq: 0,
        // Set from session.start capabilities; decides which TTL applies below.
        saysGoodbye: false,
        // What the identity says they wear, as written, kept for the detail panel; the
        // parsed form goes to the character. Null means "nobody said", which is the
        // usual case and means the palette decides.
        colorLabel: ev.session?.actor_color ?? null,
        // A picture of whoever this is, if their harness went to the trouble of sending
        // one up (spec §3.2). Held as the URL to load, already vetted — see safeAvatar.
        avatar: safeAvatar(ev.session?.actor_avatar),
        // How this harness was reached — 'cli', 'desktop', 'sdk' (spec §4.7).
        // Display only: the office subscribes by harness name, so a desktop and
        // a terminal session are one source shown two ways, never two feeds.
        variant: ev.harness?.variant ?? null,
      };
      sessions.set(key, rec);
      const clothes = colour(rec.colorLabel);
      emit({
        type: 'spawn',
        id: key,
        name: rec.who.name,
        // Who this session *is*, apart from being a session — a configured agent who
        // exists between sessions and will be back tomorrow under a new id (spec §3.2).
        // Sent so the room can seat one person for several of their sessions at once:
        // an OpenClaw agent running two cron jobs is one colleague with two jobs, not
        // two colleagues. Null for every harness that offers a terminal tab and no
        // identity, and a null here means one character per session, exactly as before.
        actor: rec.who.actor ?? null,
        variant: rec.variant,
        // Left off entirely rather than sent as null, so the manager's own palette
        // stays the default for every harness that has nothing to say about clothes.
        ...clothes,
        avatar: rec.avatar,
      });
      // A description the colour-name table has not arrived for yet: sit down in a
      // palette shirt and change when it lands, the same way a late name is adopted.
      if (rec.colorLabel && clothes.color === undefined) {
        describeLater(key, rec, rec.colorLabel);
      }
        }
    // A reconnect replays from wherever the buffer starts, so the first event we
    // see for a session need not be its session.start. Take the variant from the
    // first event that carries one rather than only from a spawn we may have missed.
    if (!rec.variant && ev.harness?.variant) rec.variant = ev.harness.variant;
    // Whether we have met this identity is the cast's record rather than ours, so asking
    // it is what keeps the log and the room from disagreeing about who has been named.
    if (!rec.who.actor && ev.session?.actor) adoptActor(key, rec, ev.session.actor);
    if (!rec.colorLabel && ev.session?.actor_color) adoptColour(key, rec, ev.session.actor_color);
    // An avatar is the *latest* thing an identity can bring, because the adapter has to
    // upload the picture before it can name it — so arriving after the session did is not
    // an edge case here, it is the normal path (see docs/developer/protocol/aop-spec.md §3.2).
    if (!rec.avatar && ev.session?.actor_avatar) adoptAvatar(key, rec, ev.session.actor_avatar);
    rec.lastSeen = now();
    return rec;
  }

  /**
   * Learn who somebody is after they have already sat down.
   *
   * The judgement is the cast's — how much of a name arrived decides how much of theirs
   * changes — and all that is left here is announcing it, on the same contract as a
   * rename from a prompt: a name coming back means say so, `null` means nothing moved.
   */
  function adoptActor(key, rec, actor) {
    const next = cast.adoptActor(key, actor);
    rec.who = cast.get(key) ?? rec.who;
    if (!next) return;
    emit({ type: 'rename', id: key, name: next });
  }

  /**
   * The bits of a spawn that describe clothes, or nothing at all.
   *
   * `colorLabel` is what was written (`Rich red / crimson`, `#c1440e`) and rides along for
   * the detail panel; `color` is what the office can paint with. A value with no colour in
   * it anywhere yields neither, so the palette decides and nothing has to special-case a
   * failed parse.
   *
   * A description may resolve to nothing *yet* rather than nothing at all, because the
   * colour-name table is fetched on demand — hence `_describeLater`, which finishes the
   * job down the same road a late identity takes.
   */
  function colour(label) {
    const resolved = resolveColour(label);
    if (resolved) return { color: resolved.color, colorLabel: label };
    return {};
  }

  /**
   * A colour that arrives with a late identity, for the same reason a name does: the
   * agent context is a hook behind the session. Changing clothes mid-session is a small
   * oddity, and much the smaller one — the alternative is an agent whose whole point is
   * being recognisable at a glance wearing a random shirt until it next restarts.
   */
  function adoptColour(key, rec, label) {
    rec.colorLabel = label;
    const resolved = resolveColour(label);
    if (resolved) {
      emit({ type: 'recolor', id: key, color: resolved.color, colorLabel: label });
      return;
    }
    describeLater(key, rec, label);
  }

  /**
   * Try a written colour again once the colour-name table has arrived.
   *
   * `Rich red / crimson` cannot be read until 237 KB of colour names has loaded, and that
   * is a fetch — so the first agent to describe a colour is dressed from the palette for
   * the few milliseconds it takes, then changes into their own shirt. Everybody after them
   * resolves immediately, and an office where nobody names a colour never loads it at all.
   *
   * Nothing is retried if the label turns out not to contain a colour: the table only
   * loads once, and a wish is still a wish afterwards.
   */
  function describeLater(key, rec, label) {
    loadColourNames().then(() => {
      // The session may have gone home, or a later event may have said something better.
      if (sessions.get(key) !== rec || rec.colorLabel !== label) return;
      const resolved = resolveColour(label);
      if (!resolved) return;
      emit({ type: 'recolor', id: key, color: resolved.color, colorLabel: label });
    });
  }

  /**
   * A face that turns up mid-session, which is how faces normally turn up.
   */
  function adoptAvatar(key, rec, value) {
    const avatar = safeAvatar(value);
    if (!avatar) return;
    rec.avatar = avatar;
    emit({ type: 'avatar', id: key, avatar });
  }

  /**
   * Re-surname a session from the work it has just been given.
   *
   * The surname is the job, so it moves with the job: each new job replaces it and
   * the person underneath — the first name — never changes, which is what keeps a
   * colleague followable across a rename. Which titles are worth a rename at all is
   * the cast's judgement (a harness-chosen name is never touched, and nodding along
   * describes no job), so a name coming back means announce it and nothing more.
   */
  function renameFromTitle(key, rec, title) {
    const next = cast.rename(key, title);
    if (!next) return;
    rec.who = cast.get(key) ?? rec.who;
    emit({ type: 'rename', id: key, name: next });
  }

  /**
   * Give the job in hand a better name, without it becoming a second job.
   *
   * Two events arrive at this: `turn.title`, from an adapter that has just been told
   * what the work is called, and `turn.end`, from one that only knew at the end. The
   * office treats them identically on purpose — the round did not change, only the
   * name for it — so the history entry is renamed in place and `startsNewJob` is not
   * consulted. A new *job* is `turn.start`'s business and stays there.
   */
  function retitleJob(key, rec, title) {
    const next = jobLabel(title);
    if (!next || next === rec.jobTitle) return;
    const from = rec.jobTitle;
    rec.jobTitle = next;
    renameFromTitle(key, rec, next);
    emit({ type: 'retitle', id: key, from, job: next });
  }

  // --- steps ---------------------------------------------------------------
  //
  // A step is a *label*, and deliberately nothing more: it never emits a status,
  // never starts a walk and never touches the job history. Spec §4.2 rule 5 is the
  // reason — a harness working through a five-item todo list did all five at one
  // desk, and a reduction that moved anybody would have it pacing the room for work
  // it never got up for. Journeys stay the business of `tool_class` and its debounce.

  /** The plan as the manager wants it: a fresh copy, so nothing downstream can edit ours. */
  function planOut(rec) {
    if (!rec.plan) return null;
    return { items: rec.plan.items.map((e) => ({ ...e })), more: rec.plan.more };
  }

  /**
   * Where a step sits in the plan, or -1. Matched by id and then by title.
   *
   * Matching on the title as a fallback is not tidy, but it is what makes the common
   * case work: harnesses whose todo lists have no stable ids (Claude Code's, for one)
   * would otherwise show a checklist where nothing is ever ticked.
   */
  function planIndexOf(plan, id, title) {
    if (!plan) return -1;
    const byId = id ? plan.items.findIndex((e) => e.id === id) : -1;
    if (byId >= 0) return byId;
    return title ? plan.items.findIndex((e) => e.title === title) : -1;
  }

  function markPlan(rec, id, title, status) {
    const at = planIndexOf(rec.plan, id, title);
    if (at >= 0) rec.plan.items[at].status = status;
  }

  /** Close whatever step is open. Returns true if there was one. */
  function closeStep(rec, status) {
    if (!rec.step) return false;
    markPlan(rec, rec.step.id, rec.step.title, status);
    rec.step = null;
    return true;
  }

  /** End of the round: no open step, no checklist. */
  function clearSteps(key, rec, { failed = false } = {}) {
    const had = closeStep(rec, failed ? 'failed' : 'completed') || !!rec.plan;
    rec.plan = null;
    rec.stepSeq = 0;
    // Nothing was ever shown, so there is nothing to take down — and the check is the
    // point, not an optimisation: the overwhelming majority of turns have no steps at
    // all, and those must reduce to exactly the directions they did before steps
    // existed (spec §4.2 rule 1). An unconditional emit here would put a `step` on
    // the end of every turn in the office and make rule 1 impossible to test.
    if (had) emit({ type: 'step', id: key, step: null, plan: null });
  }

  function stepStart(key, ev, p) {
    const rec = touch(key, ev);
    // Most harnesses only learn the checklist when the agent writes it down, which is
    // after `turn.start` — so a plan restated here replaces the one we had (§4.2 rule 4).
    if (p.plan !== undefined) rec.plan = normalisePlan(p.plan);

    // An implicit close is the normal path, not the recovery path: announcing the next
    // item is something harnesses do reliably, closing the last one is not (rule 2).
    closeStep(rec, 'completed');

    const title = typeof p.title === 'string' && p.title.trim()
      ? p.title.trim().slice(0, MAX_STEP_TITLE)
      : null;
    const id = typeof p.step_id === 'string' && p.step_id ? p.step_id : `s${++rec.stepSeq}`;

    // 1-based, and only meaningful *together*: half a fraction is worse than none,
    // since "2 of" reads as a bug and a bare "2" reads as a count of something else.
    //
    // Both are derived from the plan when the harness did not number them, which is
    // the common case rather than the exotic one — a todo list is a list of titles and
    // statuses, and neither Claude Code nor Rovo CLI counts it for us. The plan already
    // knows the answer, so "2 of 5" comes free for any harness that sends one.
    const at = planIndexOf(rec.plan, id, title);
    const index = Number.isInteger(p.index) && p.index > 0 ? p.index
      : (at >= 0 ? at + 1 : null);
    // The truncated tail counts: a plan cut to 20 of 26 is on its "2 of 26", not
    // its "2 of 20". The office would otherwise shorten somebody's afternoon.
    const of = Number.isInteger(p.of) && p.of > 0 ? p.of
      : (rec.plan ? rec.plan.items.length + rec.plan.more : null);

    const paired = index !== null && of !== null;
    rec.step = { id, title, index: paired ? index : null, of: paired ? of : null };
    markPlan(rec, id, title, 'active');
    emit({ type: 'step', id: key, step: { ...rec.step }, plan: planOut(rec) });
  }

  function stepEnd(key, ev, p) {
    const rec = touch(key, ev);
    const status = STEP_END_STATUS.has(p.status) ? p.status : 'completed';
    const id = typeof p.step_id === 'string' ? p.step_id : null;

    if (rec.step && (!id || rec.step.id === id)) {
      closeStep(rec, status);
    } else if (id) {
      // An end for a step that is not the open one. Out-of-order and unusual, but the
      // plan is the one place it can still show, so mark it there and leave the open
      // step alone rather than closing the wrong thing.
      markPlan(rec, id, null, status);
    } else {
      return;   // nothing open, nothing named: half a pair, so nothing to say
    }
    emit({ type: 'step', id: key, step: rec.step ? { ...rec.step } : null, plan: planOut(rec) });
  }

  function toolStart(key, ev, p) {
    const rec = touch(key, ev);
    const cls = p.tool_class ?? 'other';
    const id = p.tool_call_id ?? `${cls}:${rec.tools.size}`;

    // A second start for a call already in flight. The entry is about to be replaced, and
    // a debounce timer left armed behind it is unreachable from that moment on — `toolEnd`
    // can only cancel the timer on the entry it finds. So it fires regardless, and it fires
    // against whatever the map holds now: a second journey for one call, named after the
    // start that was replaced. Worse for a call that finishes quickly, because the orphan
    // outlives the call itself — the trip then happens *after* the `tool.end`, which is the
    // one thing the debounce exists to prevent. So cancel before replacing.
    //
    // Not a hypothetical: OpenClaw announces some tool calls at two layers under one
    // `tool_call_id` (docs/developer/adapters/openclaw.md), which is a question for that harness. This
    // is the receiver's own house in order either way — an id arriving twice must not leave
    // a timer running against a call it no longer describes.
    const open = rec.tools.get(id);
    if (open?.timer) cancel(open.timer);

    if (!TRAVEL_CLASSES.has(cls)) {
      // Desk work: no journey, so there is nothing to debounce.
      rec.tools.set(id, { cls, timer: null });
      if (!rec.waiting) emit({ type: 'status', id: key, status: 'working' });
      return;
    }

    // Worth a trip — but only if it lasts long enough to be worth watching.
    const timer = schedule(() => {
      const t = rec.tools.get(id);
      if (t) t.timer = null;
      if (rec.waiting) return;
      if (cls === 'wait') return emit({ type: 'activity', id: key, activity: 'couch' });
      if (cls === 'scm') return emit({ type: 'status', id: key, status: 'delivering' });
      // Fetching a page is the one look-up whose answer is not in the building, so
      // it is the globe that turns rather than a book coming off the shelf. Every
      // other trip — the graph, the repo, a grep — is answered in the room.
      emit({
        type: 'research',
        id: key,
        topic: p.target ?? p.summary ?? p.tool_name,
        scope: cls === 'network' ? 'web' : 'graph',
      });
    }, TRAVEL_DEBOUNCE_MS);

    rec.tools.set(id, { cls, timer });
  }

  function toolEnd(key, ev, p) {
    const rec = touch(key, ev);
    const id = p.tool_call_id;
    const t = id ? rec.tools.get(id) : null;
    // A tool.end with no matching start is ignored: events may arrive out of
    // order, and inventing a state change from half a pair would flicker.
    if (!t) return;
    rec.tools.delete(id);
    if (t.timer) {
      cancel(t.timer);   // finished inside the debounce: never left the desk
      return;
    }
    if (p.status === 'error') return emit({ type: 'status', id: key, status: 'error' });
  }

  function end(key) {
    const rec = sessions.get(key);
    if (!rec) return;
    for (const t of rec.tools.values()) if (t.timer) cancel(t.timer);
    sessions.delete(key);
    // Frees the first name for the next arrival without forgetting who this was, so
    // a resumed session is not renamed behind your back (see cast.retire).
    cast.retire(key);
    emit({ type: 'exit', id: key });
  }

  /** Retire sessions that went quiet — the only defence against a killed harness. */
  function reap() {
    const at = now();
    for (const [key, rec] of sessions) {
      const ttl = rec.saysGoodbye ? FAREWELL_TTL_MS : SESSION_TTL_MS;
      if (rec.lastSeen < at - ttl) end(key);
    }
  }
  return {
    reduce,
    reap,
    sessions,
    cast,
    /** A restarted receiver may legitimately re-issue events (see AopSource._resync). */
    resetSeen() { seen.clear(); },
    /** Any debounce still pending would fire into a torn-down world. */
    stop() {
      for (const s of sessions.values()) {
        for (const t of s.tools.values()) if (t.timer) cancel(t.timer);
      }
      sessions.clear();
    },
  };
}
