// A harness todo list, turned into AOP `plan` + `step.start`/`step.end` (spec §4.2).
//
// Claude Code's `TodoWrite` and Rovo CLI's `update_todo` are nearly the same tool wearing
// two names: a list with exactly one item `in_progress`. Both used to be classed `other`
// and thrown away, which meant the one harness signal that says "this turn has five parts
// and I am on the second" was the one signal the office ignored.
//
// Shared rather than copied because two implementations of "which part is this" would
// drift into two answers. What the sharing had to learn is that the payloads differ in
// more than `activeForm` against `active_form`:
//
// **Rovo's list is not always rewritten whole.** `update_todo` takes a `merge` flag, and
// with it an update carries only the items that changed and only the fields that changed
// — `{id: 1, status: "completed"}, {id: 2, status: "in_progress"}` and not a word of text.
// Read as a whole list that is a three-part turn becoming a one-part turn, and a part that
// was just ticked off becoming a part that *vanished*. Measured on 202608.25.1, against a
// mapper that assumed a rewrite, all three of the following were wrong at once:
//
//   - an ids-only merge produced **no step events at all**, so the office kept the first
//     part on the desk label for the rest of the session;
//   - the checklist collapsed to the size of the batch — "2 of 2" for a list of three,
//     the one thing `planTally` exists to prevent;
//   - and the completed part was struck through as `cancelled`, then *remembered* as
//     cancelled, because absent-from-the-list is how a replacement says "dropped".
//
// So the list is held here, per turn, and an update is applied to it rather than mistaken
// for it. A merge that mentions nothing about an item is a merge that says that item is
// unchanged; only a replacement can drop one. Claude Code and Codex send no `merge` flag
// and take the replace path, which is what they have always meant.
//
// The other half of the same finding: Rovo's todo items **carry their own ids**, and
// integer ones, so the text hash below was being used for a harness that had already
// answered the question. Ids matter more than they look — see `hashId`.

'use strict';

/** Tools that rewrite a todo list. Matched case-insensitively, and by exact name. */
const TODO_TOOLS = new Set(['todowrite', 'update_todo', 'todo_write', 'todoread']);

/** Harness todo status → AOP plan status. Anything unrecognised is pending. */
const PLAN_STATUS = {
  pending: 'pending',
  in_progress: 'active',
  active: 'active',
  completed: 'completed',
  done: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

/** Spec §10: a plan is capped at 20 entries and the tail becomes a count. */
const PLAN_MAX = 20;

/**
 * How much of a list we are willing to carry between hook processes.
 *
 * Every hook is its own `node`, so the held list is written to and read back from the
 * state file on disk each time (see `bin/aop-send.cjs`). That makes it the one piece of
 * this module with a cost per event rather than per turn, and an agent is free to write
 * a hundred-item checklist. Three times the plan cap is far more than the office can
 * draw and small enough to stay uninteresting on disk.
 */
const LIST_MAX = 60;

/** Longest item text we hold. The wire clamps again at `CAPS.step_title`, tighter. */
const TEXT_MAX = 200;

function isTodoTool(name) {
  return typeof name === 'string' && TODO_TOOLS.has(name.trim().toLowerCase());
}

/**
 * The harness's own id for an item, where it has one.
 *
 * Rovo numbers its todo items, so the id arrives as `1` rather than `"1"` — and a
 * `typeof === 'string'` test quietly sent every Rovo item to the text hash below,
 * throwing away the one identifier that was guaranteed not to move. That matters most
 * for exactly the case that revealed it: a merge update may carry an id and a status
 * and nothing else, and an id is then the only thing it can be matched on at all.
 */
function idOf(entry) {
  const raw = entry?.id;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  // Integers only. A float id is nobody's convention and rounding one would invent
  // a collision; `NaN` and `Infinity` are not identifiers either.
  if (typeof raw === 'number' && Number.isInteger(raw)) return String(raw);
  return null;
}

/**
 * A stable id for a todo item that has none.
 *
 * Hashed from the item's text rather than taken from its position, because the
 * position is the one thing about a todo list that genuinely moves: an agent that
 * inserts a forgotten step at the top would otherwise renumber every item below it,
 * and the office would read that as five parts finishing at once. Claude Code's list
 * has no ids at all, so this is the common path for that harness — and the reason a
 * harness that *does* number its items should be taken at its word: a hash is a hash
 * of the wording, and an agent that rewords an item mid-turn would otherwise look like
 * one that abandoned a part and started another.
 */
function hashId(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `t${(h >>> 0).toString(36)}`;
}

/** An item's text, trimmed and bounded, or null when the update did not state it. */
function legible(value) {
  return (typeof value === 'string' && value.trim()) ? value.trim().slice(0, TEXT_MAX) : null;
}

/**
 * Read one todo *update* into a normalised form — which is not the same as a list.
 *
 * `title` is the imperative ("Fix the flaky test") and `active` is the present
 * continuous ("Fixing the flaky test") where the harness offers both. Which one gets
 * used depends on where it is going: a checklist reads as a list of things to do, and
 * the one line naming what somebody is doing right now reads better in the other
 * voice. Both tools already make this distinction, so it costs nothing to honour it.
 *
 * Every field except the id may be **null here, meaning "not stated"**, because a merge
 * update is allowed to omit anything that has not changed. Distinguishing unstated from
 * `pending` is the whole point: read the other way, a merge saying only that item 4 is
 * done would demote every item beside it back to not-started. `applyUpdate` is what
 * turns one of these into a list, filling the gaps from the list already in hand.
 *
 * An entry with neither an id nor legible text is dropped, because there is then nothing
 * to match it on and nothing to say about it.
 *
 * @param {*} todos  whatever the tool was called with
 * @returns {Array<{id: string, title: ?string, active: ?string, status: ?string}>}
 */
function readTodos(todos) {
  if (!Array.isArray(todos)) return [];
  const out = [];
  for (const entry of todos) {
    const title = legible(typeof entry === 'string' ? entry : entry?.content ?? entry?.title);
    const id = typeof entry === 'string' ? null : idOf(entry);
    if (!title && !id) continue;
    const status = typeof entry === 'string' ? null : entry?.status;
    out.push({
      id: id ?? hashId(title),
      title,
      active: typeof entry === 'string' ? null : legible(entry?.activeForm ?? entry?.active_form),
      status: status == null || status === ''
        ? null
        : PLAN_STATUS[String(status).toLowerCase()] ?? 'pending',
    });
  }
  return out;
}

/**
 * One entry, once what the update says is laid over what we already knew.
 *
 * The wording is inherited only where the update is silent: an item whose text *has*
 * changed gets its new text, and its present-continuous form follows the new wording
 * rather than staying behind describing the old one.
 */
function fill(entry, known) {
  return {
    id: entry.id,
    title: entry.title ?? known?.title ?? null,
    active: entry.active ?? entry.title ?? known?.active ?? known?.title ?? null,
    status: entry.status ?? known?.status ?? 'pending',
  };
}

/**
 * The list as it stands after this update — the one thing every step decision reads.
 *
 * Two dialects, told apart by the harness's own flag:
 *
 * - **replace** (`merge` absent or false, which is all Claude Code and Codex ever mean):
 *   the update *is* the list. An item that has gone from it has genuinely gone, which is
 *   what lets `stepEvents` tell a cancelled part from a skipped one. Text is still
 *   inherited by id where the update left it out, since a replacement that repeats the
 *   ids but not the wording has not renamed anything.
 * - **merge** (`merge: true`): the update is a patch by id. Known ids are updated in
 *   place, keeping their position — an agent ticking off part 2 has not moved part 5 —
 *   and unknown ids join the end, which is the only place a genuinely new item can go
 *   without renumbering the parts already announced.
 *
 * Null when the update says nothing legible at all, and the caller leaves the list it
 * has alone: `update_todo` with an empty array is not an agent abandoning its plan.
 *
 * @param {Array<object>} held  the list we already have, oldest known first
 * @param {*} todos             the update, in the tool's own shape
 * @param {{merge: boolean}} options
 * @returns {?Array<{id: string, title: ?string, active: ?string, status: string}>}
 */
function applyUpdate(held, todos, { merge }) {
  const update = readTodos(todos);
  if (!update.length) return null;
  const known = new Map((held ?? []).map((entry) => [entry.id, entry]));

  if (!merge) return update.map((entry) => fill(entry, known.get(entry.id))).slice(0, LIST_MAX);

  const next = (held ?? []).map((entry) => ({ ...entry }));
  const at = new Map(next.map((entry, index) => [entry.id, index]));
  for (const entry of update) {
    const index = at.get(entry.id);
    if (index === undefined) {
      at.set(entry.id, next.length);
      next.push(fill(entry, null));
    } else {
      next[index] = fill(entry, next[index]);
    }
  }
  return next.slice(0, LIST_MAX);
}

/**
 * The plan as it goes on the wire: an array, capped, titles only.
 *
 * Null at `metadata` redaction, and that is the ruling rather than an oversight. A tool
 * *name* is operator-authored and survives `metadata`; a todo item is a sentence the
 * **model** wrote, so it is free text and it goes. What survives is the shape — the
 * counters on `step.start` — so the office still says "Step 2 of 5" without a word of
 * anybody's content in it.
 */
function planFor(items, redaction, helpers, settled = {}) {
  if (redaction === 'metadata' || !items.length) return null;
  // An item can be counted without being drawable: a merge is allowed to introduce a
  // brand new id with no text, and there is then nothing honest to write on that row.
  // It still counts towards `of`, because the turn does have that many parts — the
  // checklist is a hint, and the counter is the fact.
  const named = items.filter((e) => e.title);
  if (!named.length) return null;
  return named.slice(0, PLAN_MAX).map((e) => ({
    id: e.id,
    title: helpers.clamp(e.title, helpers.CAPS.step_title),
    // `settled` outranks the list, but only where the list says `pending` — see the
    // note on it in `stepEvents`. An item the agent has genuinely picked back up says
    // `in_progress` or `completed`, and then the list is the newer truth of the two.
    status: (e.status === 'pending' && settled[e.id]) ? settled[e.id] : e.status,
  }));
}

/**
 * Diff a todo list against the last one we saw, and say what changed in AOP.
 *
 * One `step.end` and one `step.start` at most, because these tools keep exactly one
 * item `in_progress`. The end comes first so a reducer sees the pair in the order they
 * happened, though §4.2 rule 2 means it would cope without.
 *
 * The status a part ends in is read off the *new* list rather than announced, since
 * neither tool announces anything: an item that is now `completed` finished, one still
 * `pending` was **skipped**, and one that has vanished from the list was `cancelled`.
 * That skipped/completed distinction is the whole reason to bother with `step.end` here
 * — without it a part passed over looks exactly like a part done.
 *
 * "Vanished" is a fact about the list, which is why the list is assembled first. Under a
 * merge nothing an update fails to mention has gone anywhere, and reading absence as
 * cancellation there struck through the very item the agent had just ticked off.
 *
 * @param {object} args
 * @param {*} args.todos          the tool's `todos` argument
 * @param {boolean} [args.merge]  the harness's own merge flag: a patch, not a list
 * @param {object} args.todoState per-turn `{ list, activeId, activeAt, settled }`, mutated here
 * @param {object} args.session   the AOP session descriptor to attribute events to
 * @param {string} args.ts
 * @param {string} args.redaction
 * @param {object} args.helpers
 * @returns {Array<object>} zero, one or two AOP events
 */
function stepEvents({ todos, merge = false, todoState, session, ts, redaction, helpers }) {
  // The list, not the update. Everything below — which part is in hand, how many parts
  // there are, what the checklist looks like — is a question about the list, and asking
  // it of a merge update is how a three-part turn came to report "2 of 2".
  const items = applyUpdate(todoState.list, todos, { merge: merge === true });
  if (!items?.length) return [];
  todoState.list = items;

  const out = [];
  const active = items.find((e) => e.status === 'active') ?? null;
  const previousId = todoState.activeId ?? null;

  /**
   * Statuses we worked out that the harness has no way to say.
   *
   * Neither tool can express "skipped": an item passed over simply sits at `pending`
   * for the rest of the run. We infer it once, when the next part starts — and then
   * have to *remember* it, because every later call rewrites the whole list with that
   * item back at `pending` and the plan riding on the next `step.start` would quietly
   * un-skip it. That is a real bug this caught: the receiver marked the part skipped
   * off the `step.end`, and the very next plan overwrote the mark.
   *
   * Held on the emitter rather than fixed in the receiver deliberately. The emitter is
   * the side that concluded it, so the wire should carry the conclusion; a receiver
   * that preserved statuses across a replacement could never be told a plan had
   * legitimately been reset.
   */
  todoState.settled = todoState.settled ?? {};

  if (previousId && previousId !== active?.id) {
    const now = items.find((e) => e.id === previousId) ?? null;
    let status = 'cancelled';                       // gone from the list entirely
    if (now?.status === 'completed') status = 'completed';
    else if (now) status = 'skipped';               // still on the list, passed over
    if (status !== 'completed') todoState.settled[previousId] = status;
    out.push({
      type: 'step.end',
      ts,
      session,
      payload: {
        step_id: previousId,
        status,
        duration_ms: todoState.activeAt ? Date.now() - todoState.activeAt : undefined,
      },
    });
  }

  if (active && active.id !== previousId) {
    const at = items.indexOf(active);
    // Picked back up after being passed over: the list is now the newer truth.
    delete todoState.settled[active.id];
    out.push({
      type: 'step.start',
      ts,
      session,
      payload: {
        step_id: active.id,
        // The present continuous, because this field answers "what is happening now".
        // Absent at `metadata`, and absent again for a part a merge introduced without
        // naming: the counters below are then the honest whole of what we were told.
        title: redaction === 'metadata' || !active.active
          ? undefined
          : helpers.clamp(active.active, helpers.CAPS.step_title),
        index: at + 1,
        of: items.length,
        plan: planFor(items, redaction, helpers, todoState.settled) ?? undefined,
      },
    });
    todoState.activeId = active.id;
    todoState.activeAt = Date.now();
  } else if (!active) {
    // The list is finished, or between parts. Either way nothing is in hand, and
    // claiming otherwise would leave a stale part on somebody's desk label.
    todoState.activeId = null;
    todoState.activeAt = null;
  }

  return out;
}

/**
 * Close whatever part is still in hand, because the turn is over.
 *
 * The status a part ends in is normally read off the *next* list write, which works
 * for every part except the last: nothing writes after it. Without this, the final
 * part of every turn is never closed on the wire and its duration is never reported
 * at all — one live session carried 192 events, exactly one `step.start` and not a
 * single `step.end`. The office hid it, because the reducer clears the label at
 * `turn.end` regardless, so the picture looked right while the wire lost the fact.
 *
 * On the status: an item the agent left at `in_progress` is genuinely ambiguous — it
 * finished and went unticked, or it stopped half-done, and nothing here can tell
 * which. We take the turn's own word for it, because the turn's status is the only
 * evidence in the room. A clean stop reads as `completed`; an error reads as
 * `failed`. Guessing `cancelled` on a clean stop would strike through work that
 * almost always did get done, which is the more visible of the two ways to be wrong.
 *
 * @param {object} todoState per-session todo state, cleared here
 * @param {object} args
 * @param {string} args.status one of `completed`, `failed`, `cancelled`
 * @returns {object[]} zero or one `step.end`
 */
function closeOpenStep(todoState, { status, ts, session }) {
  const openId = todoState?.activeId ?? null;
  if (!openId) return [];

  const event = {
    type: 'step.end',
    ts,
    session,
    payload: {
      step_id: openId,
      status,
      duration_ms: todoState.activeAt ? Date.now() - todoState.activeAt : undefined,
    },
  };
  todoState.activeId = null;
  todoState.activeAt = null;
  return [event];
}

/**
 * Forget what the last turn concluded, because a new one is starting.
 *
 * This state used to be built once per *session*, so `activeId` outlived the turn
 * that set it and the next turn's first list write would close a part belonging to
 * the previous one — with a `duration_ms` measured across the dead time in between.
 * Seen in the wild as a part still marked active seventeen minutes after its turn
 * had ended, waiting to be attributed to whatever came next.
 *
 * The skip memory goes with it. It only means anything against the list it was
 * inferred from, and a new turn brings a new list.
 *
 * So does the list itself, and for a sharper reason: a merge is applied to whatever we
 * are holding, so a list carried across the boundary would let the new turn's first
 * update land on the old turn's parts — and Rovo's ids start again at 1 every time,
 * which is precisely the collision that would go unnoticed.
 */
function resetTodoState(todoState) {
  if (!todoState) return;
  todoState.activeId = null;
  todoState.activeAt = null;
  todoState.settled = {};
  todoState.list = [];
}

module.exports = {
  isTodoTool, readTodos, applyUpdate, planFor, stepEvents, closeOpenStep, resetTodoState,
  TODO_TOOLS, PLAN_MAX, LIST_MAX,
};
