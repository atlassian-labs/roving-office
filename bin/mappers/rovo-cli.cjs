// Rovo CLI → AOP.
//
// Verified against Rovo CLI 202608.25.1 on this machine. The payload every hook
// receives on stdin is:
//
//   {
//     "session_id":      "b2b5e280-e87c-41ed-9189-da867a77c3e1",
//     "transcript_path": "/var/folders/…/message_history.json",
//     "cwd":             "/Users/mike/dev/roving-office",
//     "timestamp":       "2026-08-26T13:40:08.084525+00:00",
//     "hook_event_name": "on_session_end",
//     "attributes":      {}
//   }
//
// `attributes` is empty for the session-scoped events and carries the interesting
// part for the rest. Captured from a live interactive session — tool hooks fire
// only there, not in `rovo run` and not at all under `rovo serve`:
//
//   on_user_prompt     { "user_prompt": "…" }   or   { "prompt": "…" }
//   on_tool_start      { "tool_calls":   [ { "tool_name", "tool_args", "tool_call_id" } ] }
//                      or flat { "tool_name", "tool_call_id", "args": { … } }
//                      update_todo's args are { "merge": bool, "todos": [ { "id": int,
//                        "status", "content"?, "active_form"? } ] } — and `merge` makes
//                        that a patch by id rather than the list, fields and all
//   on_tool_end        { "tool_results": [ { "tool_name", "tool_call_id" } ] }
//                      or flat { "tool_call_id", "status" }   or   { "tool_call_id" }
//   on_tool_permission { "tool_name": "…" }
//   on_complete        { "summary": "…" }   (sometimes absent)
//
// Note the **arrays**: Rovo batches parallel tool calls into one hook event, so
// four files read at once arrive as a single `on_tool_start` with four entries.
// Each entry becomes its own `tool.start`, flagged `concurrent`.
//
// Both the batched and the flat shapes are real, which is the case for fallback
// chains rather than an argument for picking one. The shape recorder at
// `~/.roving-office/shapes-rovo-cli.ndjson` — keys and types, never contents —
// caught the flat variants, and the `prompt` and `args` key names, in live traffic
// after this header first claimed only the array form with `tool_args`. It cost
// nothing, because `argsOf` already reads `args` as well as `tool_args` and `pick`
// already reads `prompt` as well as `user_prompt`; it is written down here so the
// next reader is not misled by a contract that is narrower than reality.
//
// Events, and what Rovo gives us:
//
//   on_session_start   → session.start        [verified; see the timing note below]
//   on_user_prompt     → turn.start          [verified]
//   on_tool_start      → tool.start          [fires in interactive sessions]
//   on_tool_end        → tool.end            [same]
//   on_tool_permission → permission.request  [verified, payload has no tool name]
//   on_complete        → turn.end completed  [verified]
//   on_error           → error + turn.end    [verified name, payload unverified]
//   on_session_end     → session.end         [verified]
//
// Rovo announces itself at the first *task*, not at launch, so its desk stays empty
// until you ask for something. Measured two ways: a Rovo CLI left idle at a fully
// rendered prompt for 14s emits nothing at all, and in live traffic
// `on_session_start` is followed by `on_user_prompt` within 54–1063ms every time.
// Claude Code is the other way round — it fires SessionStart at launch, so an
// untasked Claude session still takes a desk.
//
// The asymmetry is upstream, and not something this adapter should paper over: with
// no event there is no `session_id`, so a character invented at launch could never
// be reconciled with the real session when it finally arrives. A late arrival beats
// a phantom. See docs/developer/protocol/aop-harness-adapters.md.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeClassifier, argsOf, targetOf } = require('./lib/tool-classes.cjs');
const {
  isTodoTool, stepEvents, closeOpenStep, resetTodoState,
} = require('./lib/todo-steps.cjs');
const { stateFor } = require('./lib/event-shape.cjs');

/** Everything this adapter can ever emit, declared on session.start (spec §4.1). */
const CAPABILITIES = [
  'session.start', 'session.end',
  'turn.start', 'turn.end',
  'step.start', 'step.end',
  'tool.start', 'tool.end',
  'permission.request',
  'error',
];

/**
 * Rovo's own tool names, mapped onto the closed `tool_class` enum (spec §4.3).
 * The office reads the class, never the name, so this table is what decides
 * whether a character sits at the desk or walks to the bookshelf.
 */
const TOOL_CLASSES = {
  open_files: 'read',
  expand_code_chunks: 'read',
  expand_folder: 'read',
  get_session_metadata: 'read',
  get_skill: 'read',
  grep: 'search',
  create_file: 'edit',
  find_and_replace_code: 'edit',
  delete_file: 'edit',
  move_file: 'edit',
  bash: 'execute',
  powershell: 'execute',
  rovo_search: 'knowledge',
  twg_help_plan: 'knowledge',
  invoke_subagents: 'agent',
  watch_jira_issue_update: 'wait',
  // Desk work as a tool — nobody gets up to write a list. What it also is, and what it
  // used to be discarded as, is this harness saying the turn has parts: see the
  // `step.*` events emitted alongside it in `on_tool_start`.
  update_todo: 'other',
  ask_user_questions: 'wait',
  exit_plan_mode: 'other',
};

/**
 * Unknown tools — MCP servers, new built-ins, plugins — fall through to the
 * shared heuristics in `lib/tool-classes.cjs`, which every mapper uses.
 */
const classify = makeClassifier(TOOL_CLASSES);

/**
 * The short title Rovo already generated for its own session list.
 *
 * It is written beside the session transcript as `metadata.json`. Reading it is
 * deliberately best-effort: the first prompt hook can beat title generation, an
 * older Rovo may have no file, and a malformed session id must never become a path.
 * A later hook (usually `on_complete`) can still carry the title so completed task
 * history is retitled even when the first live label had to use the prompt.
 */
function readSessionTitle(id, helpers, sessionsDir = path.join(os.homedir(), '.rovo', 'sessions')) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(sessionsDir, id, 'metadata.json'), 'utf8'));
    const title = helpers.firstString(metadata?.title);
    if (!title || /^(new|untitled)( session)?$/i.test(title.trim())) return null;
    return helpers.clamp(title, helpers.CAPS.title);
  } catch {
    return null;
  }
}

function obj(value) { return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {}; }

/** `attributes` first, then the top level — harness payloads move fields around. */
function pick(payload, keys, helpers) {
  const attrs = obj(payload.attributes);
  const candidates = [];
  for (const k of keys) candidates.push(attrs[k], payload[k]);
  return helpers.firstString(...candidates);
}

/**
 * The tool calls in one hook event, as a list.
 *
 * Rovo **batches parallel tool calls into a single hook event** — verified from
 * live traffic: `attributes.tool_calls[]` on `on_tool_start` and
 * `attributes.tool_results[]` on `on_tool_end`, each entry carrying
 * `{ tool_name, tool_args, tool_call_id }`. Four files read at once is one
 * `on_tool_start` with four entries, which becomes four `tool.start` events
 * marked `concurrent`.
 *
 * The flat single-call shape is kept as a fallback: it costs three lines and
 * covers older builds, hand-rolled payloads and anything that changes upstream.
 */
function toolEntries(payload, arrayKeys) {
  const attrs = obj(payload.attributes);
  for (const key of arrayKeys) {
    const list = attrs[key] ?? payload[key];
    if (Array.isArray(list) && list.length) return list.map(obj);
  }
  return [Object.keys(attrs).length ? attrs : obj(payload)];
}

function entryId(entry, helpers) {
  return helpers.firstString(entry.tool_call_id, entry.toolCallId, entry.tool_use_id, entry.call_id, entry.id);
}

function entryName(entry, helpers) {
  return helpers.firstString(entry.tool_name, entry.toolName, entry.tool, entry.name);
}

/**
 * Turn one hook payload into zero or more AOP events.
 *
 * Two kinds of synthesis happen here, both required by the spec's recovery rules
 * (§7): an explicit `session.start` the first time we see a session — the first
 * hook to arrive is not always `on_session_start`, because a receiver that restarts
 * mid-session has to be told again, and `rovo run` and `rovo serve` skip the tool
 * hooks entirely — and a `turn.start` when tool activity shows up without a prompt
 * event, so the character is never busy without a reason on the desk.
 */
function map({
  event, payload, state, redaction, helpers, endpointId = null,
  readTitle = readSessionTitle,
}) {
  const id = helpers.firstString(payload.session_id, payload.sessionId, payload.session);
  if (!id) return [];

  const cwd = helpers.firstString(payload.cwd, payload.working_directory, payload.workspace_path);
  const ts = helpers.toIso(payload.timestamp);
  const session = { id, kind: 'main' };
  if (cwd) session.cwd = cwd;

  const s = stateFor(state, id);
  const out = [];
  // Rovo's own generated heading is already the concise task description the office
  // wants. It is model-written text, so metadata redaction still excludes it.
  const titleEvent = event === 'on_user_prompt' || event === 'on_complete';
  const sessionTitle = redaction === 'metadata' || !titleEvent ? null : readTitle(id, helpers);

  // Implicit spawn, made explicit. Cheaper for the office than inferring, and it
  // is the only place we get to declare what this adapter can and cannot emit —
  // which is also why it has to be repeated to a receiver that has restarted:
  // an office that never heard our capabilities falls back to reaping this session
  // as though it will never say goodbye.
  const newReceiver = endpointId !== null && s.endpointId !== endpointId;
  if (!s.started || newReceiver) {
    s.started = true;
    s.endpointId = endpointId;
    out.push({
      type: 'session.start',
      ts,
      session,
      payload: {
        source: event === 'on_session_start' ? 'startup' : 'attach',
        capabilities: CAPABILITIES,
        redaction,
        transcript: Boolean(payload.transcript_path),
      },
    });
  }

  // `fresh` distinguishes a turn that is actually starting from one being said again
  // to a receiver that has not heard it (below). Only the first should forget what the
  // last turn concluded — re-announcing a turn already in flight must not throw away
  // the part it currently has in hand.
  const openTurn = (title, trigger, { fresh = true } = {}) => {
    if (s.turnOpen) return;
    s.turnOpen = true;
    if (fresh) resetTodoState(s.todo);
    // Remembered so it can be said again to a receiver that has not heard it. Only
    // ever read while the turn is open, so a stale one after `turn.end` is inert.
    s.turnTitle = title ?? 'Working';
    s.turnTrigger = trigger ?? 'user';
    out.push({
      type: 'turn.start',
      ts,
      session,
      payload: { title: s.turnTitle, trigger: s.turnTrigger },
    });
  };

  // The office names a session after the work it is doing, and the title is the only
  // place that work is stated. A restarted receiver has never heard the turn already
  // in flight, so without this the session sits there nameless and unlabelled until
  // the next prompt — which may be an hour of tool calls away. Repeating the title we
  // were given is the same courtesy as repeating our capabilities above.
  //
  // Not when this very event is the prompt: it is about to open a turn of its own,
  // and the office would be told about two.
  if (newReceiver && s.turnOpen && event !== 'on_user_prompt') {
    s.turnOpen = false;
    openTurn(s.turnTitle, s.turnTrigger, { fresh: false });
  }

  switch (event) {
    case 'on_session_start':
      break; // the session.start above is the whole event

    case 'on_user_prompt': {
      // In `metadata` mode the desk label must not be the user's words (§10).
      const prompt = pick(payload, ['user_prompt', 'prompt', 'message', 'text', 'input'], helpers);
      const title = redaction === 'metadata'
        ? 'Working'
        : sessionTitle ?? helpers.clamp(prompt, helpers.CAPS.title);
      s.turnOpen = false;
      openTurn(title, 'user');
      if (redaction === 'full' && prompt) {
        out[out.length - 1].payload.prompt = helpers.clamp(prompt, helpers.CAPS.prompt);
      }
      if (prompt) out[out.length - 1].payload.prompt_chars = String(prompt).length;
      break;
    }

    case 'on_tool_start': {
      const entries = toolEntries(payload, ['tool_calls']);
      openTurn('Working', 'user');
      s.pending = s.pending ?? [];
      s.ghosts = s.ghosts ?? {};

      entries.forEach((entry, index) => {
        const toolName = entryName(entry, helpers);
        // A batch shares one timestamp, so the index keeps synthesised ids unique.
        const callId = entryId(entry, helpers) ?? `${id}:${Date.parse(ts)}:${index}`;
        const args = argsOf(entry);
        const command = helpers.firstString(args.command, args.cmd, entry.command);
        const toolClass = classify(toolName, command);

        s.tools[callId] = { name: toolName, class: toolClass, at: Date.now() };
        s.pending.push(callId);

        out.push({
          type: 'tool.start',
          ts,
          session,
          payload: {
            tool_call_id: callId,
            tool_name: toolName ?? 'tool',
            tool_class: toolClass,
            target: targetOf(args, command, cwd, helpers, redaction),
            // Spec §4.3: tells the office this is one of several calls in flight.
            concurrent: entries.length > 1 ? true : undefined,
          },
        });

        // A todo list is where this harness says how many parts the turn has.
        //
        // At the *start* of the call, unlike Claude Code, and not by preference: Rovo's
        // `on_tool_end` carries results and no arguments, so the list only exists here.
        // The cost is announcing a part from a call that could still fail, which for a
        // local list rewrite is close to never — and a part announced a moment early
        // beats the whole checklist being invisible, which is what it was before.
        //
        // `merge` travels with it because Rovo's list is not always a rewrite: with the
        // flag set, `todos` holds only the items that changed and only the fields that
        // changed. It is the harness's own word for which of the two it means, and the
        // shared module needs it to tell a part being ticked off from a part being
        // dropped — see the header of `lib/todo-steps.cjs` for what reading a merge as
        // a list did to the desk label.
        if (isTodoTool(toolName)) {
          s.todo = s.todo ?? {};
          out.push(...stepEvents({
            todos: args.todos,
            merge: args.merge === true,
            todoState: s.todo,
            session,
            ts,
            redaction,
            helpers,
          }));
        }

        // Rovo has no subagent lifecycle hooks, so a fan-out would otherwise
        // render as one busy character. When the arguments name the subagents,
        // stand in ghosts for them and mark them synthetic, so the office can
        // render the guess more faintly than the truth (spec §6.1).
        const names = Array.isArray(args.subagent_names) ? args.subagent_names : null;
        if (toolClass === 'agent' && names?.length) {
          s.ghosts[callId] = names.slice(0, 8).map((name, i) => {
            const ghostId = `${id}:${callId}:${i}`;
            out.push({
              type: 'session.start',
              ts,
              session: {
                id: ghostId,
                parent_id: id,
                kind: 'subagent',
                cwd,
                agent_type: helpers.clamp(name, helpers.CAPS.label),
                label: helpers.clamp(name, helpers.CAPS.label),
              },
              payload: { source: 'spawn', parent_tool_call_id: callId, redaction },
              ext: { synthetic: true },
            });
            return ghostId;
          });
        }
      });
      break;
    }

    case 'on_tool_end': {
      const entries = toolEntries(payload, ['tool_results', 'tool_calls']);
      s.pending = s.pending ?? [];
      s.ghosts = s.ghosts ?? {};

      for (const entry of entries) {
        // No id in the payload? Close the most recent open call, which is right
        // in the overwhelmingly common sequential case and harmless otherwise.
        const callId = entryId(entry, helpers) ?? s.pending[s.pending.length - 1];
        const known = callId ? s.tools[callId] : undefined;
        const error = helpers.firstString(entry.error, entry.error_message);
        const status = helpers.firstString(entry.status, entry.result_status);

        out.push({
          type: 'tool.end',
          ts,
          session,
          payload: {
            tool_call_id: callId ?? `${id}:unknown`,
            tool_name: entryName(entry, helpers) ?? known?.name,
            tool_class: known?.class,
            status: (error || status === 'error') ? 'error' : 'ok',
            duration_ms: known?.at ? Date.now() - known.at : undefined,
          },
        });

        if (callId) {
          delete s.tools[callId];
          s.pending = s.pending.filter((p) => p !== callId);

          // Every ghost dissolves with the call that conjured it.
          for (const ghostId of s.ghosts[callId] ?? []) {
            out.push({
              type: 'session.end',
              ts,
              session: { id: ghostId, parent_id: id, kind: 'subagent', cwd },
              payload: { reason: 'exit' },
              ext: { synthetic: true },
            });
          }
          delete s.ghosts[callId];
        }
      }
      break;
    }

    case 'on_tool_permission': {
      // The verified payload carries no tool name, so this says only "blocked on
      // you" — which is still the single most valuable thing the office shows.
      const toolName = pick(payload, ['tool_name', 'toolName', 'tool'], helpers);
      openTurn('Working', 'user');
      out.push({
        type: 'permission.request',
        ts,
        session,
        payload: {
          request_id: pick(payload, ['request_id', 'permission_id', 'tool_call_id'], helpers) ?? `${id}:${Date.now()}`,
          tool_name: toolName,
          tool_class: toolName ? classify(toolName) : undefined,
          reason: redaction === 'metadata' ? undefined : pick(payload, ['reason', 'message'], helpers),
        },
      });
      break;
    }

    case 'on_complete': {
      s.turnOpen = false;
      // Before the turn, because the part ends inside it. Nothing writes the todo list
      // after the last part, so this is the only place its end can come from.
      out.push(...closeOpenStep(s.todo, { status: 'completed', ts, session }));
      const summary = redaction === 'metadata'
        ? undefined
        : helpers.clamp(pick(payload, ['summary', 'message', 'response', 'last_message'], helpers), helpers.CAPS.summary);
      out.push({
        type: 'turn.end', ts, session,
        payload: { status: 'completed', title: sessionTitle ?? undefined, summary },
      });
      break;
    }

    case 'on_error': {
      const message = redaction === 'metadata'
        ? 'Error'
        : helpers.clamp(pick(payload, ['error', 'error_message', 'message', 'reason'], helpers), helpers.CAPS.message) ?? 'Error';
      out.push({ type: 'error', ts, session, payload: { message, recoverable: true } });
      out.push(...closeOpenStep(s.todo, { status: 'failed', ts, session }));
      if (s.turnOpen) {
        s.turnOpen = false;
        out.push({ type: 'turn.end', ts, session, payload: { status: 'error' } });
      }
      break;
    }

    case 'on_session_end':
      // Kept in state rather than deleted: the sequence counter has to survive
      // long enough to number this event correctly. The TTL sweep clears it.
      s.turnOpen = false;
      s.ended = true;
      // A session that dies with a part in hand really was cancelled, unlike one that
      // merely stopped writing its list down.
      out.push(...closeOpenStep(s.todo, { status: 'cancelled', ts, session }));
      out.push({ type: 'session.end', ts, session, payload: { reason: 'exit' } });
      break;

    default:
      // An unknown hook name still proves the session is alive, which is enough
      // to keep the character from being reaped.
      out.push({ type: 'session.heartbeat', ts, session, payload: {} });
      break;
  }

  return out;
}

module.exports = { map, classify, readSessionTitle, CAPABILITIES };
