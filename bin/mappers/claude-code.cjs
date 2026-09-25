// Claude Code → AOP.
//
// Verified against Claude Code 2.1.246. Every hook receives one JSON payload on
// stdin, captured verbatim from a probe session:
//
//   {
//     "session_id":      "478c3346-…",
//     "transcript_path": "/Users/you/.claude/projects/-Users-you-src-app/478c3346-….jsonl",
//     "cwd":             "/Users/you/src/app",
//     "hook_event_name": "SessionStart",
//     "source":          "startup"
//   }
//
// with `prompt_id`, `permission_mode` and `prompt` on `UserPromptSubmit`, and
// `reason` on `SessionEnd`. Tool events add `tool_name`, `tool_use_id` and
// `tool_input` (plus `tool_response` after the fact); subagent events add
// `agent_id`, `agent_type` and `parent_tool_use_id`.
//
// Note there is **no event-name argument** on the installed command: Claude puts
// `hook_event_name` in the payload, so one command string serves every event and
// `hooks/hooks.json` stays boring.
//
// Three ways this differs from the Rovo mapper, all of them Claude being richer:
//
//   1. **Ghosts are real.** `SubagentStart` / `SubagentStop` carry `agent_id`,
//      `agent_type` and `parent_tool_use_id`, so a fan-out renders as actual
//      child sessions bound to the exact `tool.start` that spawned them (spec
//      §6.1) — no guessing from the arguments of a `Task` call, and nothing
//      marked `synthetic`.
//   2. **One call per event.** Claude fires a hook per tool call rather than
//      batching parallel calls into an array, so there is no `concurrent` flag
//      to set and no fan-out to unpack.
//   3. **Turn boundaries are given.** `UserPromptSubmit` → `Stop` is an explicit
//      turn with a `prompt_id` to carry as `turn_id`, so the office never has to
//      infer that an agent started working from the fact that it used a tool.
//   4. **The work has a name the model wrote.** Claude generates a short title for
//      every session — the thing a terminal tab shows — and hands it over twice:
//      as `session_title` on a payload, and as an `ai-title` record in the
//      transcript. It is a far better desk label than a quote of the prompt, and
//      it arrives a second or two *late*, which is the whole reason `turn.title`
//      exists (see the upgrade in `map`).
//
// And one way Claude is noisier: **not every session is a conversation.** Title
// generation, background tasks and the desktop bridge each open a session, fire
// `SessionStart`, and fire `SessionEnd` a fraction of a second later with nothing
// in between — a dozen of them in an afternoon of ordinary use. Taken at face
// value each one is a character who rides the lift up, walks in, and leaves
// again, costing a lift cycle and one of the room's first names to say nothing.
// So `session.start` is **held** until the session does something (`ensure` and
// `QUIET_EVENTS` below), and a session that never does is never mentioned.
//
// Events we map, and how (spec §4):
//
//   SessionStart        → session.start        (source ← source; held, see above)
//   UserPromptSubmit    → turn.start           (turn_id ← prompt_id)
//   any event mid-turn  → turn.title           (once, when the generated title lands)
//   PreToolUse          → tool.start
//   PostToolUse         → tool.end (+ artifact.change for edits and commits)
//   PostToolUseFailure  → tool.end status=error
//   PermissionRequest   → permission.request
//   PermissionDenied    → permission.resolve   (decision: deny)
//   Notification        → notification
//   Stop                → turn.end status=completed
//   StopFailure         → turn.end status=error
//   SubagentStart/Stop  → session.start/end    (kind: subagent → a ghost)
//   PreCompact          → context.compact
//   TeammateIdle        → session.heartbeat    (status: idle)
//   SessionEnd          → session.end          (reason ← reason)
//   FileChanged         → artifact.change      (handled, not installed — see below)
//
// `PostCompact`, `PostToolBatch`, `CwdChanged` and `FileChanged` are deliberately
// **not** installed as hooks even though this mapper understands them: each one
// either duplicates an event we already emit (`PostCompact` after `PreCompact`,
// `PostToolBatch` after its members, `FileChanged` after an `Edit`) or costs a
// process spawn for something the next event tells us anyway (`CwdChanged`, since
// `project` is re-derived from `cwd` on every event). Recognising them costs
// nothing and means a user who wires them by hand gets sensible behaviour.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeClassifier, argsOf, targetOf } = require('./lib/tool-classes.cjs');
const {
  isTodoTool, stepEvents, closeOpenStep, resetTodoState,
} = require('./lib/todo-steps.cjs');
const { stateFor, defined, resultBytes } = require('./lib/event-shape.cjs');

// How a turn's ending reads for the part still open inside it. A turn that errored did
// not leave a part `completed`, and one that was cancelled did not leave it `failed`.
const STEP_END_FOR_TURN = {
  completed: 'completed',
  error: 'failed',
  cancelled: 'cancelled',
};

/** Everything this adapter can emit, declared on session.start (spec §4.1). */
const CAPABILITIES = [
  'session.start', 'session.heartbeat', 'session.end',
  'turn.start', 'turn.title', 'turn.end',
  'step.start', 'step.end',
  'tool.start', 'tool.end', 'artifact.change',
  'permission.request', 'permission.resolve',
  'notification', 'context.compact',
];

/**
 * Claude's built-in tool names, mapped onto the closed `tool_class` enum
 * (spec §4.3). The office reads the class and never the name, so this table is
 * what decides whether a character sits at the desk or walks to the bookshelf.
 *
 * Anything absent — MCP tools, plugin tools, tools added after this was written —
 * falls through to the shared heuristics in `lib/tool-classes.cjs`.
 */
const TOOL_CLASSES = {
  Read: 'read',
  NotebookRead: 'read',
  Skill: 'read',
  Glob: 'search',
  Grep: 'search',
  ToolSearch: 'search',
  Write: 'edit',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Bash: 'execute',
  BashOutput: 'execute',
  KillShell: 'execute',
  KillBash: 'execute',
  WebFetch: 'network',
  WebSearch: 'network',
  Task: 'agent',
  AskUserQuestion: 'wait',
  // Still `other` as a *tool*: writing a todo list is desk work and moves nobody. What
  // it also is, and what it used to be thrown away as, is the harness telling us this
  // turn has parts — see the `step.*` events emitted alongside it in `PostToolUse`.
  TodoWrite: 'other',
  SlashCommand: 'other',
  ExitPlanMode: 'other',
};

const classify = makeClassifier(TOOL_CLASSES);

const TRANSCRIPT_TAIL_BYTES = 512 * 1024;

/**
 * How many events a turn may spend chasing a title it has not been given yet.
 *
 * The chase is a file read (see `readSessionTitle`), and the events it rides on are
 * tool calls, so a session whose title never lands — a `-p` run, a transcript so
 * long the last `ai-title` has scrolled out of the tail — must not pay for a read
 * per call all turn. Eight is generous for something Claude writes within seconds
 * of the prompt: in practice the first attempt is the only one.
 */
const TITLE_ATTEMPTS = 8;

/** Turn Claude's slug-shaped headings into the sentence case used by the UI. */
function displayTitle(value, helpers) {
  let title = helpers.firstString(value);
  if (!title) return null;
  title = title.trim();
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(title)) {
    title = title.replace(/[-_]+/g, ' ');
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  return helpers.clamp(title, helpers.CAPS.title);
}

/**
 * Claude already writes a concise model-generated title into its transcript.
 *
 * The fallback source, not the first one: `session_title` on the payload says the
 * same thing for free (see `generatedTitle` in `map`). This is what covers the
 * events that payload does not ride on — which includes the one that matters, the
 * first tool call of a session's first turn.
 *
 * The session registry's `name` and the neighbouring `custom-title.json` are not
 * used: Claude Desktop rewrites those with operational labels such as the worktree
 * setup phase, while `ai-title` continues to describe the assignment. `agent-name`
 * is only a fallback for transcripts that contain no generated title at all.
 * Read only a bounded tail, best-effort, and only below Claude's transcript root so
 * a forged hook payload cannot turn this observer into an arbitrary file reader.
 */
function readSessionTitle(
  transcriptPath,
  helpers,
  projectsDir = path.join(os.homedir(), '.claude', 'projects'),
) {
  if (typeof transcriptPath !== 'string' || path.extname(transcriptPath) !== '.jsonl') return null;
  try {
    const root = fs.realpathSync(projectsDir);
    const file = fs.realpathSync(transcriptPath);
    if (!file.startsWith(`${root}${path.sep}`)) return null;

    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      const lines = buffer.toString('utf8').split('\n');
      if (start > 0) lines.shift(); // the first record may begin before our bounded tail

      let agentName = null;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (!lines[i]) continue;
        let record;
        try { record = JSON.parse(lines[i]); } catch { continue; }
        if (record?.type === 'ai-title') return displayTitle(record.aiTitle, helpers);
        if (record?.type === 'agent-name' && !agentName) {
          agentName = displayTitle(record.agentName, helpers);
        }
      }
      return agentName;
    } finally {
      fs.closeSync(fd);
    }
  } catch { /* absent, racing, malformed, or outside the allowed root */ }
  return null;
}

/** Claude's `source` → the spec's `session.start` source enum. */
const SOURCES = {
  startup: 'startup',
  resume: 'resume',
  fork: 'fork',
  clear: 'clear',
  // A session continuing after compaction is the same session seen afresh, which
  // is exactly what `attach` means.
  compact: 'attach',
};

/** Claude's `reason` → the spec's `session.end` reason enum. */
const REASONS = {
  exit: 'exit',
  clear: 'clear',
  logout: 'logout',
  error: 'error',
  killed: 'killed',
  timeout: 'timeout',
  prompt_input_exit: 'exit',
  other: 'other',
};

const TITLE_EVENTS = new Set(['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']);

/**
 * Shell commands that produce something durable, for `artifact.change` (§4.3).
 * A class of `scm` already tells the office someone is walking to the outbox;
 * this says what is in the envelope.
 */
const ARTIFACT_COMMANDS = [
  [/^git\s+(commit|push)\b/, 'commit'],
  [/^git\s+(branch|switch\s+-c|checkout\s+-b)\b/, 'branch'],
  [/^(gh\s+pr\s+create|glab\s+mr\s+create)\b/, 'pr'],
];

function artifactKind(command) {
  for (const [re, kind] of ARTIFACT_COMMANDS) if (re.test(command.trim())) return kind;
  return null;
}

/** Did the tool call fail? Claude reports it in several shapes across versions. */
function toolFailed(payload) {
  if (payload.success === false) return true;
  const r = payload.tool_response ?? payload.tool_result;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  if (r.is_error === true || r.isError === true) return true;
  if (r.error) return true;
  return typeof r.status === 'string' && /error|fail/i.test(r.status);
}

/** Line counts for an edit, derived from the arguments we were given anyway. */
function editSize(toolName, args) {
  const lines = (s) => (typeof s === 'string' && s ? s.split('\n').length : undefined);
  if (toolName === 'Write') return { added: lines(args.content) };
  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
    const added = lines(args.new_string ?? args.new_source);
    const removed = lines(args.old_string ?? args.old_source);
    return { added, removed };
  }
  return {};
}

/**
 * Events that say nothing about whether a session is doing any work.
 *
 * Claude opens a session for things that are not conversations at all — a title
 * generator, a background task, a desktop bridge that never gets as far as a
 * prompt. They arrive as a `SessionStart` and a `SessionEnd` a fraction of a
 * second apart with nothing in between, and there is no field on either payload
 * that marks them out: `source`, `transcript_path` and `cwd` look exactly like a
 * terminal someone is typing into. What separates them is only ever what happens
 * next, so that is what we wait for (see `ensure`).
 *
 * Listed per subject, because a subagent's boundaries are its own: a
 * `SubagentStart` proves the *parent* is working — it took a `Task` call to get
 * here — while saying nothing yet about the ghost it introduces.
 */
const QUIET_EVENTS = {
  main: new Set(['SessionStart', 'SessionEnd', 'TeammateIdle']),
  subagent: new Set(['SubagentStart', 'SubagentStop', 'TeammateIdle']),
};

/**
 * Turn one hook payload into zero or more AOP events.
 *
 * The invariant worth stating: **a session is introduced before it is used, and
 * never before.** A hook can be the first thing the office ever hears — hooks are
 * installed while sessions are already running, and an office that restarts has
 * forgotten everything — so any event may have to carry its own `session.start`
 * ahead of itself, for the main session and for a subagent alike. Equally, a
 * session that is opened and never used is never introduced at all.
 */
function map({
  event, payload, state, redaction, helpers, endpointId = null,
  readTitle = readSessionTitle,
}) {
  const rootId = helpers.firstString(payload.session_id, payload.sessionId, payload.session);
  if (!rootId) return [];

  const cwd = helpers.firstString(payload.cwd, payload.working_directory, payload.workspace_path);
  const ts = helpers.toIso(payload.timestamp);
  const out = [];
  const titleEvent = TITLE_EVENTS.has(event);

  /**
   * Claude's own title for this session, from the cheaper source first.
   *
   * It generates one for every session and then says it twice: as `session_title`
   * on the `UserPromptSubmit` and `SessionStart` payloads [verified 2026-09-04,
   * 2.1.260], and as an `ai-title` record in the transcript. The payload is free
   * and cannot be missed; the transcript read is bounded and therefore can be. So
   * the payload wins where it exists and the read is the fallback — and the read
   * is deferred until somebody asks, because most events never do, and metadata
   * mode must not so much as open the file (§10).
   */
  let read = false;
  let readCache = null;
  const generatedTitle = () => {
    if (redaction === 'metadata') return null;
    const given = displayTitle(payload.session_title, helpers);
    if (given) return given;
    if (!read) {
      read = true;
      readCache = readTitle(payload.transcript_path, helpers);
    }
    return readCache;
  };

  const root = { id: rootId, kind: 'main' };
  if (cwd) root.cwd = cwd;

  // A subagent's own events carry `agent_id`. Attributing them to that id rather
  // than to the parent is what keeps a fan-out legible: five ghosts each doing
  // their own thing, instead of one character with five tool calls in flight.
  const agentId = helpers.firstString(payload.agent_id, payload.agentId);
  const agentType = helpers.clamp(
    helpers.firstString(payload.agent_type, payload.agentType, payload.subagent_type),
    helpers.CAPS.label,
  );

  const ghost = agentId ? { id: agentId, parent_id: rootId, kind: 'subagent' } : null;
  if (ghost) {
    if (cwd) ghost.cwd = cwd;
    if (agentType) { ghost.agent_type = agentType; ghost.label = agentType; }
  }
  const subject = ghost ?? root;

  /**
   * Introduce a session if the office cannot already know about it — but not
   * before the session has done anything.
   *
   * An introduction is built eagerly and then **held in state until an event
   * arrives that proves the session is real** (`QUIET_EVENTS` above). A held
   * introduction is not a dropped one: it is stored on disk with the source and
   * timestamp it really had, so the session that eventually types something is
   * announced as the `startup` it was, at the moment it began. A session that
   * never types anything is never announced at all, and the office is spared an
   * agent who rides the lift up, walks in, and leaves again.
   *
   * `endpointId` changing means we are talking to a *different* receiver than
   * the one this session was announced to — a restarted office has an empty
   * buffer and has never heard our capabilities, which is what it uses to decide
   * how patiently to wait before reaping an idle agent. So we re-introduce.
   */
  let reintroduced = false;     // did the main session have to be introduced again?
  const ensure = (session, source, extra = {}) => {
    const s = stateFor(state, session.id);
    const newReceiver = endpointId !== null && s.endpointId !== endpointId;
    // A held introduction always still owes the office an appearance, even if a
    // previous receiver was told about this session already.
    if (s.started && !newReceiver && !s.intro) return s;
    if (session.id === rootId) reintroduced = newReceiver;
    s.endpointId = endpointId;

    // Reuse the held introduction rather than describing the session afresh:
    // `startup` two minutes ago is the truth, and `attach` now is not. It still
    // learns from the event that finally justified it — a prompt carries the
    // permission mode a bare `SessionStart` never did.
    const intro = s.intro ?? {
      type: 'session.start',
      ts,
      session,
      payload: {
        source,
        capabilities: CAPABILITIES,
        redaction,
        transcript: Boolean(payload.transcript_path),
      },
    };
    // The session descriptor itself is always the fresh one: a held introduction
    // read back from disk may name a directory the session has since left.
    intro.session = session;
    Object.assign(intro.payload, defined(extra));

    if (QUIET_EVENTS[session.kind === 'subagent' ? 'subagent' : 'main'].has(event)) {
      s.intro = intro;
      s.started = false;
      // Nothing is emitted for a held session, and the sequence numbering that
      // usually stamps `lastSeen` never runs — so do it here, or the sweep in
      // `aop-send` reaps the introduction before it can be delivered.
      s.lastSeen = Date.now();
      return s;
    }

    s.started = true;
    delete s.intro;
    out.push(intro);
    return s;
  };

  const rootSource = event === 'SessionStart'
    ? (SOURCES[String(payload.source ?? '').toLowerCase()] ?? 'startup')
    : 'attach';
  const rootState = ensure(root, rootSource, {
    permission_mode: helpers.firstString(payload.permission_mode, payload.permissionMode),
    model: helpers.firstString(payload.model, payload.model_id),
    resumed: payload.source === 'resume' ? true : undefined,
  });

  // The parent must exist before its child, and the child must name the tool call
  // it came from — that link is what lets the office dissolve stragglers when the
  // `Task` call ends rather than waiting for a `SubagentStop` that may never come.
  const subjectState = ghost
    ? ensure(ghost, 'spawn', {
      parent_tool_call_id: helpers.firstString(payload.parent_tool_use_id, payload.parentToolUseId),
    })
    : rootState;

  /**
   * Open a turn on the main session.
   *
   * Claude tells us when a turn starts, so this is only a safety net for the
   * common case of hooks being installed mid-session: tool activity with no turn
   * open would otherwise render as a character busy for no stated reason.
   */
  // `fresh` separates a turn that is actually starting from one being said again to a
  // receiver that has not heard it (below). Only the former should forget what the last
  // turn concluded: re-announcing a turn already in flight must not discard the part it
  // has in hand.
  //
  // `provisional` marks a title we would rather replace — the first line of the prompt,
  // or the bare `Working` of a turn this adapter inferred — and is what the upgrade
  // below looks for. A title Claude generated is never provisional; nor is anything in
  // metadata mode, where a generated title may not be adopted at all (§10).
  const openTurn = (title, trigger, { fresh = true, provisional = false } = {}) => {
    if (rootState.turnOpen || ghost) return;
    rootState.turnOpen = true;
    rootState.turnAt = Date.now();
    rootState.turnProvisional = provisional && redaction !== 'metadata';
    if (fresh) {
      rootState.titleTries = 0;
      resetTodoState(rootState.todo);
    }
    // Remembered so it can be said again to a receiver that has not heard it. Only
    // ever read while the turn is open, so a stale one after `turn.end` is inert.
    rootState.turnTitle = title ?? 'Working';
    rootState.turnTrigger = trigger ?? 'user';
    out.push({
      type: 'turn.start',
      ts,
      session: root,
      payload: {
        turn_id: rootState.turnId,
        title: rootState.turnTitle,
        trigger: rootState.turnTrigger,
      },
    });
  };

  // The office names a session after the work it is doing, and the title is the only
  // place that work is stated. A restarted receiver has never heard the turn already
  // in flight, so without this the session sits there nameless and unlabelled until
  // the next prompt — which may be an hour of tool calls away. Repeating the title we
  // were given is the same courtesy as repeating our capabilities in `ensure`.
  //
  // Not when this very event is the prompt: it is about to open a turn of its own,
  // and the office would be told about two. The turn id is unchanged, because it is
  // the same turn — only the listener is new.
  if (reintroduced && rootState.turnOpen) rootState.turnStale = true;
  // A subagent's event cannot carry it — `openTurn` declines while a ghost is the
  // subject — so the debt is held on the session until an event of the main
  // session's own comes along, rather than being dropped on the floor.
  if (rootState.turnStale && !ghost && event !== 'UserPromptSubmit') {
    rootState.turnStale = false;
    rootState.turnOpen = false;
    openTurn(rootState.turnTitle, rootState.turnTrigger, {
      fresh: false,
      // Said again exactly as it stands, debt included: a turn still hoping for a
      // better title has not stopped hoping because the listener changed.
      provisional: rootState.turnProvisional,
    });
  }

  /**
   * Upgrade a provisional title as soon as Claude has generated one.
   *
   * Claude names a session a second or two *after* the prompt, so the first turn of
   * one opens wearing the first line of the raw prompt — the desk reads
   * `Create a work item to "Make great movies"...` where the terminal tab reads
   * `Cinematic office activity filming`. Waiting for `turn.end` to adopt the better
   * one, which it does, means a turn spends however long it lasts mislabelled, and
   * an hour is a normal length for one.
   *
   * So the next event that comes along fixes it, which in practice is the turn's
   * first tool call. `turn.title` is the whole of what that costs the office: one
   * rename of the job already in hand (§6), no second envelope and no status flap.
   * Only the main session's, because a ghost has no desk label of its own.
   *
   * Nothing to do on a `TITLE_EVENTS` event: those carry the title themselves.
   */
  if (!ghost && rootState.turnOpen && rootState.turnProvisional && !titleEvent) {
    rootState.titleTries = (rootState.titleTries ?? 0) + 1;
    const better = generatedTitle();
    if (better && better !== rootState.turnTitle) {
      rootState.turnTitle = better;
      rootState.turnProvisional = false;
      out.push({
        type: 'turn.title',
        ts,
        session: root,
        payload: { turn_id: rootState.turnId, title: better },
      });
    } else if (rootState.titleTries >= TITLE_ATTEMPTS) {
      rootState.turnProvisional = false;   // it is not coming; stop reading the file
    }
  }

  const closeTurn = (status, summary, title = generatedTitle()) => {
    const duration = rootState.turnAt ? Date.now() - rootState.turnAt : undefined;
    // The part first, because it ends inside the turn. Nothing rewrites the todo list
    // after the last part, so this is the only place that part's end can come from —
    // and every exit runs through here, `Stop`, `StopFailure` and `SessionEnd` alike.
    out.push(...closeOpenStep(rootState.todo, {
      status: STEP_END_FOR_TURN[status] ?? 'completed',
      ts,
      session: root,
    }));
    rootState.turnOpen = false;
    rootState.turnStale = false;        // over before we could repeat it: nothing owed
    rootState.turnAt = null;
    out.push({
      type: 'turn.end',
      ts,
      session: root,
      payload: {
        turn_id: rootState.turnId, status, title: title ?? undefined,
        summary, duration_ms: duration,
      },
    });
    rootState.turnId = undefined;
  };

  switch (event) {
    case 'SessionStart':
      break; // the session.start above is the whole event

    case 'UserPromptSubmit': {
      const prompt = helpers.firstString(payload.prompt, payload.user_prompt, payload.message);
      // Claude has a title for every prompt but the first of a session: it generates
      // one from that first prompt and then carries it on every payload after. So the
      // quote of the prompt is the opening turn's label and nobody else's, and it is
      // provisional — see the upgrade above.
      const generated = generatedTitle();
      // In `metadata` mode the desk label must not be the user's words (§10).
      const title = redaction === 'metadata'
        ? 'Working'
        : generated ?? helpers.clamp(String(prompt ?? '').split('\n')[0], helpers.CAPS.title);

      // A new prompt while a turn is open means the last one ended without a
      // `Stop` we saw — close it rather than leaving a turn open forever.
      if (rootState.turnOpen) closeTurn('completed');
      rootState.turnId = helpers.firstString(payload.prompt_id, payload.promptId);
      openTurn(title, 'user', { provisional: !generated });

      const started = out[out.length - 1].payload;
      if (redaction === 'full' && prompt) started.prompt = helpers.clamp(prompt, helpers.CAPS.prompt);
      if (prompt) started.prompt_chars = String(prompt).length;
      break;
    }

    case 'PreToolUse': {
      const toolName = helpers.firstString(payload.tool_name, payload.toolName);
      const callId = helpers.firstString(payload.tool_use_id, payload.toolUseId, payload.tool_call_id)
        ?? `${subject.id}:${Date.parse(ts)}`;
      const args = argsOf(payload);
      const command = helpers.firstString(args.command, args.cmd);
      const toolClass = classify(toolName, command);

      // Inferred, so `Working` is a placeholder and not a label anybody chose:
      // provisional, and the first title Claude has generated replaces it.
      openTurn('Working', 'user', { provisional: true });
      subjectState.tools[callId] = { name: toolName, class: toolClass, at: Date.now() };

      out.push({
        type: 'tool.start',
        ts,
        session: subject,
        payload: {
          tool_call_id: callId,
          tool_name: toolName ?? 'tool',
          tool_class: toolClass,
          target: targetOf(args, command, cwd, helpers, redaction),
        },
      });
      break;
    }

    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const toolName = helpers.firstString(payload.tool_name, payload.toolName);
      const callId = helpers.firstString(payload.tool_use_id, payload.toolUseId, payload.tool_call_id);
      const known = callId ? subjectState.tools[callId] : undefined;
      const args = argsOf(payload);
      const command = helpers.firstString(args.command, args.cmd);
      const toolClass = known?.class ?? classify(toolName, command);
      const failed = event === 'PostToolUseFailure' || toolFailed(payload);

      out.push({
        type: 'tool.end',
        ts,
        session: subject,
        payload: {
          tool_call_id: callId ?? `${subject.id}:unknown`,
          tool_name: toolName ?? known?.name,
          tool_class: toolClass,
          status: failed ? 'error' : 'ok',
          duration_ms: known?.at ? Date.now() - known.at : undefined,
          error: failed && redaction !== 'metadata'
            ? helpers.clamp(
              helpers.firstString(payload.error, payload.message, payload.tool_response?.error),
              helpers.CAPS.message,
            )
            : undefined,
          result_bytes: resultBytes(payload.tool_response ?? payload.tool_result),
        },
      });
      if (callId) delete subjectState.tools[callId];

      // A rewritten todo list is the one place this harness says how many parts a turn
      // has. Emitted here rather than on `PreToolUse` because until the call returns the
      // list is a proposal, and a part announced from one that then failed would be a
      // part the agent never started.
      //
      // `subjectState`, so a subagent walking its own list is its own ghost's business.
      if (!failed && isTodoTool(toolName)) {
        subjectState.todo = subjectState.todo ?? {};
        out.push(...stepEvents({
          todos: args.todos,
          todoState: subjectState.todo,
          session: subject,
          ts,
          redaction,
          helpers,
        }));
      }

      // Something durable changed. Only on success: a failed write changed
      // nothing, and the office should not carry it to the outbox.
      if (!failed) {
        const path = helpers.firstString(args.file_path, args.notebook_path, args.path);
        if (toolClass === 'edit' && path) {
          out.push({
            type: 'artifact.change',
            ts,
            session: subject,
            payload: { kind: 'file', path: helpers.tidyPath(path, cwd), ...editSize(toolName, args) },
          });
        } else if (command) {
          const kind = artifactKind(command);
          if (kind) {
            out.push({ type: 'artifact.change', ts, session: subject, payload: { kind } });
          }
        }
      }
      break;
    }

    case 'PermissionRequest': {
      const toolName = helpers.firstString(payload.tool_name, payload.toolName);
      const args = argsOf(payload);
      const command = helpers.firstString(args.command, args.cmd);
      // Inferred, so `Working` is a placeholder and not a label anybody chose:
      // provisional, and the first title Claude has generated replaces it.
      openTurn('Working', 'user', { provisional: true });
      out.push({
        type: 'permission.request',
        ts,
        session: subject,
        payload: {
          request_id: helpers.firstString(
            payload.permission_request_id, payload.request_id, payload.tool_use_id,
          ) ?? `${subject.id}:${Date.now()}`,
          tool_name: toolName,
          tool_class: toolName || command ? classify(toolName, command) : undefined,
          target: targetOf(args, command, cwd, helpers, redaction),
          reason: redaction === 'metadata'
            ? undefined
            : helpers.clamp(helpers.firstString(payload.reason, payload.message), helpers.CAPS.message),
        },
      });
      break;
    }

    case 'PermissionDenied':
      out.push({
        type: 'permission.resolve',
        ts,
        session: subject,
        payload: {
          request_id: helpers.firstString(
            payload.permission_request_id, payload.request_id, payload.tool_use_id,
          ) ?? `${subject.id}:${Date.now()}`,
          decision: 'deny',
          by: 'user',
        },
      });
      break;

    case 'Notification': {
      const level = /error|fail/i.test(String(payload.level ?? payload.severity ?? ''))
        ? 'error'
        : (/warn/i.test(String(payload.level ?? payload.severity ?? '')) ? 'warn' : 'info');
      out.push({
        type: 'notification',
        ts,
        session: subject,
        payload: {
          // `message` is required, so metadata mode gets a fixed one rather than
          // nothing: "your attention is wanted" is the signal, not the wording.
          message: redaction === 'metadata'
            ? 'Attention needed'
            : helpers.clamp(
              helpers.firstString(payload.message, payload.title, payload.body),
              helpers.CAPS.message,
            ) ?? 'Attention needed',
          level,
        },
      });
      break;
    }

    case 'Stop':
      closeTurn('completed', redaction === 'metadata'
        ? undefined
        : helpers.clamp(
          helpers.firstString(payload.summary, payload.last_message, payload.message),
          helpers.CAPS.summary,
        ));
      break;

    case 'StopFailure':
      closeTurn('error');
      break;

    case 'SubagentStart':
      break; // the ghost's session.start above is the whole event

    case 'SubagentStop':
      // A ghost the office was never introduced to has nothing to dissolve: the
      // held introduction is dropped instead, and the fan-out that spawned five
      // subagents who did nothing renders as the one `Task` call it really was.
      if (ghost && subjectState.started) {
        subjectState.turnOpen = false;
        subjectState.ended = true;
        // A subagent writes its own todo list, so its own parts are its to close.
        out.push(...closeOpenStep(subjectState.todo, {
          status: 'completed', ts, session: subject,
        }));
        out.push({
          type: 'session.end',
          ts,
          session: ghost,
          payload: { reason: 'exit' },
        });
      } else if (ghost) {
        delete subjectState.intro;
        subjectState.ended = true;
      }
      break;

    case 'PreCompact':
    case 'PostCompact':
      // One compaction, one event: `PreCompact` is the moment worth animating,
      // and `PostCompact` is only installed by hand (see the header), so honour
      // whichever we are given without ever emitting both for one compaction.
      if (event === 'PreCompact' || !rootState.compacting) {
        rootState.compacting = event === 'PreCompact';
        out.push({
          type: 'context.compact',
          ts,
          session: root,
          payload: {
            trigger: /manual/i.test(String(payload.trigger ?? '')) ? 'manual' : 'auto',
            tokens_before: Number.isFinite(payload.tokens_before) ? payload.tokens_before : undefined,
            tokens_after: Number.isFinite(payload.tokens_after) ? payload.tokens_after : undefined,
          },
        });
      } else {
        rootState.compacting = false;
      }
      break;

    case 'TeammateIdle':
      // A heartbeat is what keeps a working agent from being reaped, so it is
      // worth nothing for a session that has never worked: announcing one here
      // would put a character in the room on the strength of an idle timer.
      if (subjectState.started) {
        out.push({
          type: 'session.heartbeat',
          ts,
          session: subject,
          payload: { status: 'idle' },
        });
      }
      break;

    case 'FileChanged': {
      const path = helpers.firstString(payload.path, payload.file_path);
      out.push({
        type: 'artifact.change',
        ts,
        session: subject,
        payload: { kind: 'file', path: helpers.tidyPath(path, cwd) },
      });
      break;
    }

    case 'SessionEnd':
      // Kept in state rather than deleted: the sequence counter has to survive
      // long enough to number this event correctly. The TTL sweep clears it.
      rootState.ended = true;
      // The whole session came and went without doing anything, so the office
      // never heard of it and there is nobody to send home. Drop the held
      // introduction and this is the one kind of session that costs nothing:
      // no lift cycle, no name taken, no character on screen for half a second.
      if (!rootState.started) { delete rootState.intro; break; }
      if (rootState.turnOpen) closeTurn('cancelled');
      out.push({
        type: 'session.end',
        ts,
        session: root,
        payload: { reason: REASONS[String(payload.reason ?? '').toLowerCase()] ?? 'other' },
      });
      break;

    default:
      // An unknown hook — a Claude release with a new event, or one wired by hand
      // — still proves the session is alive, which is enough to keep the
      // character from being reaped.
      out.push({ type: 'session.heartbeat', ts, session: subject, payload: {} });
      break;
  }

  return out;
}

// --- which Claude is this? ---------------------------------------------------

/**
 * Claude's own name for how a session was started, normalised to a slug.
 *
 * The same claude-code binary serves a terminal, the desktop app's local agent
 * mode and the SDK, and an office wants to tell them apart: "Claude Code" over
 * a desktop session and a terminal session is two different things to whoever
 * is watching the room.
 *
 * `CLAUDE_CODE_ENTRYPOINT` is exported into every hook's environment
 * [verified 2026-08-27, 2.1.246], carrying the same value the transcript
 * records as `entrypoint` — so this costs nothing, unlike reading the
 * transcript from the hook path to learn the same fact.
 */
const VARIANTS = {
  cli: 'cli',                 // a terminal session
  'claude-desktop': 'desktop', // Claude Desktop's local agent mode
  'sdk-cli': 'sdk',           // a programmatic SDK run, `claude -p` among them
};

function variant({ env = process.env } = {}) {
  const raw = typeof env.CLAUDE_CODE_ENTRYPOINT === 'string' ? env.CLAUDE_CODE_ENTRYPOINT.trim() : '';
  if (!raw) return null;
  if (VARIANTS[raw]) return VARIANTS[raw];
  // An entrypoint we have not seen is still worth reporting: better a slug the
  // office renders verbatim than silence about a harness we did not predict.
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return slug || null;
}

module.exports = {
  map, classify, variant, readSessionTitle, displayTitle, CAPABILITIES, TOOL_CLASSES,
};
