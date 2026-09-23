// OpenClaw plugin hooks → AOP.
//
// Verified against the `openclaw` npm package at 2026.7.1-2, by reading the shipped
// type declarations rather than the prose: `dist/hook-types-*.d.ts` carries a
// `PluginHookHandlerMap` of 40 hooks and a payload type per hook, which is where every
// field name below comes from. The exact shapes, trimmed to what we read:
//
//   session_start      { sessionId, sessionKey?, resumedFrom? }
//                      ctx { agentId?, sessionId, sessionKey? }
//   session_end        { sessionId, sessionKey?, messageCount, durationMs?, reason?,
//                        sessionFile?, transcriptArchived?, nextSessionId? }
//   before_agent_run   { prompt, messages, systemPrompt?, accountId?, channelId?,
//                        senderId?, senderIsOwner? }
//                      ctx { runId?, agentId?, sessionId?, sessionKey?, workspaceDir?,
//                            modelProviderId?, modelId?, trigger?, channel?, … }
//   agent_end          { runId?, messages, success, error?, durationMs? }
//   before_tool_call   { toolName, params, runId?, toolCallId?, derivedPaths?, … }
//   after_tool_call    { toolName, params, runId?, toolCallId?, result?, error?, durationMs? }
//   subagent_spawned   { childSessionKey, agentId, label?, mode, requester?, runId,
//                        resolvedModel?, resolvedProvider? }
//   subagent_ended     { targetSessionKey, targetKind, reason, runId?, outcome?, error? }
//   before_compaction  { messageCount, compactingCount?, tokenCount?, sessionFile? }
//   after_compaction   { messageCount, tokenCount?, compactedCount, sessionFile? }
//
// Two consequences of those shapes are worth stating up front, because both shaped
// the code and neither is obvious:
//
// **1. `session_start` does not know where it is.** Its context is only
// `{ agentId, sessionId, sessionKey }` — no `cwd`, no `workspaceDir`. Only the *agent*
// context has `workspaceDir`, and that arrives with the first turn. Emitting
// `session.start` immediately would therefore file the session under no project at all,
// and the office would seat a character in the `default` room and then meet the same
// session again, with a real project, in another. So `session.start` is **deferred**:
// held until the first event that knows a directory, then emitted ahead of it with its
// original timestamp intact. Rovo CLI arrives at the same behaviour for a different
// reason (it has no launch event at all) and the spec blesses it either way — §7 says
// a late arrival beats a phantom. A session that ends without ever running a turn is
// still announced, at the end, with no project; it existed, and it did nothing.
//
// **2. There is no permission hook.** OpenClaw's approval flow runs the other way: a
// plugin *asks* for approval by returning `requireApproval` from `before_tool_call`. It
// cannot observe core's own approvals. So `permission.request` — which the spec calls
// the single most valuable non-L0 event, being the only reliable "waiting on you"
// signal — is **not** in CAPABILITIES for this route. The gateway WebSocket does have
// `exec.approval.requested`, which is the one concrete reason to prefer it; see
// docs/developer/protocol/aop-harness-adapters.md §5.
//
// And one rule that is not a consequence of anything, just a rule: **`before_tool_call`
// returns nothing, ever.** It is a decision hook — a return value can block a call,
// rewrite its parameters or demand human approval. An observer that ever returned
// something would change the behaviour of the thing it is watching, and a diorama does
// not get to veto a tool call. Every handler here is registered for its payload only.

import { core, toolClasses } from './shared.mjs';

const { makeClassifier, argsOf, targetOf } = toolClasses;

/**
 * Everything this route can ever emit, declared on `session.start` (spec §4.1) so the
 * office does not wait for events that will never come. Note the absence of
 * `permission.request`, per the header.
 */
export const CAPABILITIES = [
  'session.start', 'session.end', 'session.heartbeat',
  'turn.start', 'turn.end',
  'tool.start', 'tool.end',
  'artifact.change',
  'context.compact',
];

/**
 * OpenClaw's built-in tool names, mapped onto the closed `tool_class` enum (spec §4.3).
 * Taken from the tool inventory in the package's own `docs/tools/index.md` at 2026.7.1-2.
 * The office reads the class and never the name, so this table is what decides whether
 * a character sits at the desk or walks to the bookshelf.
 */
export const TOOL_CLASSES = {
  read: 'read',
  tool_describe: 'read',
  agents_list: 'read',
  session_status: 'read',
  get_goal: 'read',

  write: 'edit',
  edit: 'edit',
  apply_patch: 'edit',
  create_goal: 'edit',
  update_goal: 'edit',

  bash: 'execute',
  exec: 'execute',
  process: 'execute',
  code_execution: 'execute',

  tool_search: 'search',
  // Code search is a search, not a knowledge lookup: it is this repo being read, not
  // an external system being asked. The shared fallbacks would say `knowledge` on the
  // `search_code` pattern, so it is named here to override them.
  tool_search_code: 'search',

  web_search: 'network',
  web_fetch: 'network',
  browser: 'network',
  x_search: 'network',
  // Generative media is a provider round trip, which is the globe turning rather than
  // a book off the shelf.
  image: 'network',
  image_generate: 'network',
  music_generate: 'network',
  video_generate: 'network',
  tts: 'network',

  subagents: 'agent',

  heartbeat_respond: 'wait',

  // Real work, but none of the office's animations are about it.
  message: 'other',
  cron: 'other',
  gateway: 'other',
  nodes: 'other',
};

/** Unknown tools — plugins, MCP servers, new built-ins — fall through to the shared heuristics. */
const classify = makeClassifier(TOOL_CLASSES);

/**
 * `PluginHookSessionEndReason` → AOP `reason` (spec §4.1). OpenClaw distinguishes more
 * cases than AOP does, and the collapsing is deliberate rather than lossy: the office
 * only ever asks "did this end tidily, was it replaced, or did it time out?"
 */
const END_REASONS = {
  new: 'clear',          // replaced by a fresh session
  reset: 'clear',
  deleted: 'killed',
  idle: 'timeout',
  daily: 'timeout',
  shutdown: 'exit',
  restart: 'exit',
  compaction: 'other',   // a generation rotated; the work did not stop
  unknown: 'other',
};

/**
 * OpenClaw's `ctx.trigger` → AOP's closed `trigger` enum (spec §4.2).
 *
 * `ctx.trigger` is itself closed, and reading the declaration rather than guessing at it
 * is what corrected this table (`docs/developer/adapters/openclaw.md` has the working):
 *
 *     type EmbeddedRunTrigger = "cron" | "heartbeat" | "manual" | "memory" | "overflow" | "user"
 *
 * The other keys below are not in that union. They are kept because this same map is the
 * one place a *future* OpenClaw's new word would land, and a spelling we already
 * understand costs nothing to keep.
 *
 * The interesting half is what is deliberately **absent**. `memory` and `overflow` are the
 * agent's own housekeeping — flushing memory, shedding context — and AOP's five words have
 * no home for either. They used to fall through a `?? 'user'` and be drawn as somebody
 * asking for something, which is the same small lie as calling a 3am ingest "Working". So
 * an unmapped trigger now yields `undefined`, `trigger` is omitted from the payload
 * (it is optional, spec §4.2), and `origin.kind` carries the honest answer instead.
 */
const TRIGGERS = {
  user: 'user', message: 'user', manual: 'user',
  queue: 'queue', queued: 'queue',
  cron: 'schedule', schedule: 'schedule', scheduled: 'schedule', heartbeat: 'schedule',
  subagent: 'parent', parent: 'parent',
  retry: 'retry',
};

/**
 * The same `ctx.trigger`, onto `origin.kind` (spec §4.2) — which is the expressive one,
 * and the reason the omissions above are affordable.
 *
 * `schedule` and `heartbeat` part company here where `TRIGGERS` flattens them, because
 * OpenClaw itself distinguishes them and they are not the same object: a cron job has an
 * id, a name and an expression, and a heartbeat has none of the three. `maintenance` is
 * the word for the two housekeeping triggers, and exists so they can stop being `user`.
 */
const ORIGIN_KINDS = {
  user: 'human', message: 'human', manual: 'human',
  queue: 'queue', queued: 'queue',
  cron: 'schedule', schedule: 'schedule', scheduled: 'schedule',
  heartbeat: 'heartbeat',
  memory: 'maintenance', overflow: 'maintenance',
  subagent: 'parent', parent: 'parent',
  retry: 'retry',
};

/**
 * The `origin` for a turn, or nothing when we cannot honestly name one.
 *
 * Three cases, and the third is the one worth spelling out:
 *
 * - **No trigger at all** is an ordinary conversational turn. OpenClaw leaves `trigger`
 *   unset for a plain chat, so absence means a person, and `human` is the honest reading.
 * - **A trigger we know** maps through `ORIGIN_KINDS`.
 * - **A trigger we do not know** — a word a future OpenClaw invents — yields *nothing*.
 *   Defaulting it to `human` would be the same lie as the `?? 'user'` this change removed,
 *   one field along: an omitted `origin` says "we do not know why", where `kind: 'human'`
 *   says "a person asked for this" about something that may well be a new kind of clock.
 */
function originFor(trigger, job, mode) {
  if (!trigger) return { kind: 'human' };
  const kind = ORIGIN_KINDS[trigger];
  return kind ? originFromJob(kind, job, mode) : undefined;
}

/**
 * The words in a tool target that could identify a job — `python3 rabbitohs_live_watch.py`
 * → `['rabbitohs', 'live', 'watch']`.
 *
 * Only the *named* thing contributes. An interpreter (`python3`), a flag (`--once`) and a
 * directory on the way to a file are things every job has in common, and a word two jobs
 * share is a word that cannot tell them apart. So: basenames, split on the punctuation
 * people use in filenames, and nothing shorter than four letters — which drops `py`, `sh`
 * and `js` along with the noise.
 */
function targetWords(target) {
  const value = str(target);
  if (!value) return [];
  const out = new Set();
  for (const chunk of value.split(/[\s'"()]+/)) {
    if (!chunk || chunk.startsWith('-')) continue;
    const base = chunk.split('/').pop();
    if (!base || !/[._-]/.test(base)) continue;   // a bare word names nothing in particular
    for (const word of base.toLowerCase().split(/[._\-\d]+/)) {
      if (word.length >= 4) out.add(word);
    }
  }
  return [...out];
}

/** How many of those words this job's operator used, in its name or its prompt. */
function jobScore(job, words) {
  if (!job) return 0;
  const haystack = `${str(job.name) ?? ''} ${str(job.payload?.text) ?? ''}`.toLowerCase();
  if (!haystack.trim()) return 0;
  return words.reduce((n, word) => (haystack.includes(word) ? n + 1 : n), 0);
}

/**
 * How long a started cron tick may wait for a session to claim it (see `claimTick`).
 *
 * A minute, because a tick's first tool call is seconds away and the risk on the other side
 * is a real one: the longer this window, the likelier an unrelated turn walks off with the
 * errand's name.
 */
const TICK_WINDOW_MS = 60_000;

/**
 * One cron job's definition → the `origin` object.
 *
 * Everything here arrives from `cron_changed` (see `onCronChanged`), which carries the job
 * as the operator wrote it. Note what is *not* read: `payload.text` is the job's prompt,
 * which is a prompt like any other and answers to redaction like one. `name` does not —
 * see `originTitle`.
 *
 * `description` is the operator's own answer to *why this job exists*, and it is the one
 * field here that answers to redaction: spec §10 lets `kind`, `name`, `id` and `schedule`
 * through at `metadata` because they describe a configured job, and holds `detail` back
 * because it is prose. A description is prose an operator wrote rather than prose a model
 * did, which is a fair argument for letting it through too — but it is an argument for
 * changing that row of the spec, not for quietly disagreeing with it here. So it travels
 * from `summary` up, where every other sentence in AOP starts travelling.
 */
function originFromJob(kind, job, mode) {
  const origin = { kind };
  if (!job) return origin;
  const name = core.clamp(str(job.name), core.CAPS.origin_name);
  if (name) origin.name = name;
  const id = core.clamp(str(job.id), core.CAPS.origin_id);
  if (id) origin.id = id;
  const schedule = scheduleLabel(job.schedule);
  if (schedule) origin.schedule = schedule;
  const detail = mode !== 'metadata' ? core.clamp(str(job.description), core.CAPS.origin_detail) : undefined;
  if (detail) origin.detail = detail;
  return origin;
}

/**
 * A job's schedule, as the short string `origin.schedule` is specified to be.
 *
 * OpenClaw's schedule is a discriminated union of four kinds and this flattens it to one
 * line, because the office renders the phrasing ("at :17 past the hour") and the emitter
 * only has to say the fact. A `cron` expression is sent verbatim — it is the thing an
 * operator recognises, and re-phrasing it here would be the emitter doing the receiver's
 * job in the one place the receiver can do it better.
 */
function scheduleLabel(schedule) {
  if (!schedule || typeof schedule !== 'object') return undefined;
  const kind = str(schedule.kind);
  let out;
  if (kind === 'cron') out = [str(schedule.expr), str(schedule.tz)].filter(Boolean).join(' ');
  else if (kind === 'every' && Number.isFinite(schedule.everyMs)) out = `every ${everyLabel(schedule.everyMs)}`;
  else if (kind === 'at') out = str(schedule.at);
  // `on-exit` watches a command, and the command is the schedule. It is a path like any
  // other tool target, so it is tidied by the same rules rather than pasted in raw.
  else if (kind === 'on-exit') {
    const command = str(schedule.command);
    out = command ? `on exit: ${toolClasses.commandLabel(command, str(schedule.cwd), core) ?? command}` : 'on exit';
  }
  return core.clamp(out, core.CAPS.origin_schedule);
}

/**
 * The desk label for a turn: the top rung of the ladder that has an answer.
 *
 *     origin.name  →  the prompt's first line  →  a phrase for the kind  →  "Working"
 *
 * **The rung that matters is the first one, and it is allowed at `metadata`.** That is a
 * privacy decision rather than an oversight, so here is the reasoning in the one place
 * somebody will come looking for it. Spec §10 withholds the *title* at `metadata` because
 * a title is normally the user's own words — their prompt, truncated. A cron job's name is
 * not that. It was typed by the operator into a scheduler config, it is the same category
 * of thing as a tool name or a file path, and `metadata` already sends both of those. It
 * is also, in the ordinary case, the *only* thing anybody wants to read off the desk.
 *
 * The cost of the alternative is what settles it: `resolveRedaction()` defaults to
 * `metadata`, so treating an operator's job name as conversation content is what made
 * every scheduled desk in every default install read `Working` — silence that looks like
 * a bug and protects nobody. Spec §10 carries this as a row of its own.
 *
 * Everything below `origin.name` behaves exactly as it did: a prompt is the user's words
 * and goes at `metadata`, and the kind-phrase is a word we chose ourselves.
 */
function originTitle(origin, prompt, mode, who = null) {
  const name = origin?.name;
  if (name) return deskName(name, who);
  if (mode !== 'metadata') {
    const fromPrompt = core.clamp(prompt, core.CAPS.title);
    if (fromPrompt) return fromPrompt;
  }
  // Better than "Working" and true at any redaction, because it is a fact about how the
  // run started rather than anything about what it is doing. An unnamed cron job is a
  // real thing — `name` is optional in OpenClaw — and so is a heartbeat, which has no
  // name to have.
  return KIND_TITLES[origin?.kind] ?? 'Working';
}

/**
 * A job's name, with the agent's own name taken off the front of it.
 *
 * `origin.name` keeps the operator's words exactly — it is the fact, and grouping repeat
 * runs of one job depends on it. This is only the **desk label**, and a desk label is read
 * beside a character who is already wearing their name: an operator who calls a job
 * *"Sideline Rabbitohs live watch"* is naming the agent because a scheduler config has no
 * other way to say whose errand it is, and the office does. So the sidebar reads
 * `Sideline Cruston — Rabbitohs live watch` rather than saying Sideline twice, in about
 * twenty-eight characters rather than forty.
 *
 * Conservative on purpose: the prefix goes only when there are still two words left
 * afterwards. A job called *"Sideline"* is a job whose whole name is the agent's, and
 * a one-word remainder is more likely a mangling than a label.
 */
function deskName(name, who) {
  const first = str(who?.actor)?.split(/\s+/)[0] ?? str(who?.agentId);
  if (!first) return name;
  const rest = name.slice(first.length).replace(/^[\s:—–-]+/, '');
  if (!name.toLowerCase().startsWith(first.toLowerCase()) || !/\s/.test(rest)) return name;
  return `${rest[0].toUpperCase()}${rest.slice(1)}`;
}

/** A phrase for a turn nobody named, per `origin.kind`. */
const KIND_TITLES = {
  schedule: 'Scheduled job',
  heartbeat: 'Heartbeat',
  maintenance: 'Housekeeping',
  queue: 'Queued work',
  retry: 'Retrying',
};

/**
 * A desk label for a turn we did not see begin, from the first thing it did.
 *
 * "Working" is true of every turn ever run and therefore says nothing, and it is what a
 * desk reads for the whole of a run when the run lifecycle never reaches the plugin. The
 * first tool call is a worse answer than the prompt and a much better one than that: an
 * office showing `Running rabbitohs_live_watch.py` has told you what the 3am tick was for.
 *
 * Only the classes whose target is a path or a command get to name it. A `search` target is
 * the model's own query — free text, and `metadata` does not send free text — so those
 * classes contribute the verb alone.
 *
 * That reasoning was right and was left half-finished: the query it declined to promote
 * into a title was travelling verbatim as the `tool.start.target` beside it, at every
 * mode, in every default install. `redactTarget` in `tool-classes.cjs` is the other half,
 * and the split it draws is this one — so a `target` arriving here at `metadata` has
 * already been reduced, and this set now decides a desk label rather than a disclosure.
 */
const ACTIVITY_VERBS = {
  read: 'Reading', edit: 'Editing', execute: 'Running', scm: 'Committing',
  search: 'Searching', network: 'Fetching', agent: 'Delegating', wait: 'Waiting',
};
const ACTIVITY_NAMES_ITS_TARGET = new Set(['read', 'edit', 'execute', 'scm']);

function activityTitle({ toolClass, target } = {}) {
  const verb = ACTIVITY_VERBS[toolClass];
  if (!verb) return undefined;
  const named = target && ACTIVITY_NAMES_ITS_TARGET.has(toolClass) ? `${verb} ${target}` : verb;
  return core.clamp(named, core.CAPS.title);
}

/** `3600000` → `1h`. Whole units only; anything awkward stays in seconds. */
function everyLabel(ms) {
  const s = Math.round(ms / 1000);
  if (s % 86400 === 0) return `${s / 86400}d`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

/** `edit`/`scm` tool classes leave something durable behind (spec §4.3). */
const ARTIFACT_KINDS = { edit: 'file', scm: 'commit' };

function str(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * The whole mapping, as one object holding per-session state.
 *
 * State is in memory rather than in a file, which is the other quiet luxury of being
 * long-lived: `bin/aop-send.cjs` has to persist sequence numbers and in-flight tool
 * calls to `~/.roving-office/state-<harness>.json` because its process dies between
 * every pair of events. A bridge just remembers.
 */
export class Mapper {
  /**
   * @param {object}   opts
   * @param {(ev: object) => void} opts.publish
   * @param {() => string}         [opts.redaction] re-read per event, so an edit to
   *                                                settings.json applies immediately
   * @param {string}   [opts.wrappedHarness] slug of the harness OpenClaw wraps here
   * @param {Function} [opts.now]
   */
  constructor({
    publish,
    redaction = core.resolveRedaction,
    wrappedHarness = null,
    fallbackCwd = null,
    routable = false,
    expectRealCwd = true,
    resolveIdentity = null,
    logger = null,
    now = Date.now,
  }) {
    this.publishRaw = publish;
    this.redaction = redaction;
    this.wrappedHarness = wrappedHarness;
    // agent id → who that agent is: `{ name, color, avatarUrl, avatarPath }`, for `session.actor`
    // and `session.actor_color` (spec §3.2). Injected rather than read here because it
    // means config and files, and a mapper that reached for those would need a whole
    // OpenClaw and a workspace on disk before it could be tested at all.
    this.resolveIdentity = typeof resolveIdentity === 'function' ? resolveIdentity : null;
    // Used only when no agent context ever offers a `workspaceDir` — which is the norm
    // when an operator has not granted conversation access, since the two hooks carrying
    // it are the two OpenClaw blocks. Better a real configured workspace than a session
    // that never gets published at all.
    this.fallbackCwd = fallbackCwd || null;
    // True when a configured `scene` already answers the routing question, so a session
    // needs no directory to be publishable (spec §3.4.3).
    this.routable = Boolean(routable);
    // True when the run hooks will fire, and so a real `workspaceDir` is still to come.
    // It is the difference between waiting for a better answer and waiting for nothing.
    this.expectRealCwd = Boolean(expectRealCwd);
    this.now = now;
    this.sessions = new Map();
    // `jobId` → the cron job that id belongs to, as `cron_changed` last described it.
    //
    // This is the whole of what makes a scheduled desk label possible, and it is a table
    // rather than a lookup because of an ordering in OpenClaw: `cron_changed` with
    // `action: "started"` fires *before* the run and carries the job but **no session**,
    // while `before_agent_run` arrives with `ctx.jobId` and no job. Neither event can
    // answer on its own; the join only runs in this direction.
    //
    // It is not per-session and is never cleared on `finished`: a job is a standing
    // definition that outlives any one run of it, and a gateway that restarts the same
    // job every hour would otherwise forget its name between ticks.
    this.jobs = new Map();
    // Ticks that have started and not yet been spoken for:
    // `{ jobId, agentId, at, claimedBy }`. The join `ctx.jobId` makes for free, made the
    // hard way, for the runs that arrive without a run hook. See `claimTick`.
    this.ticks = [];
    // session id → the job that session was last seen running, from `cron_changed`
    // `finished` — the one event that carries a job and a session at the same time. A
    // guess for one tick, a certainty for every tick after it.
    this.sessionJobs = new Map();
    this.logger = logger;
    // Said once per gateway, not once per turn. See `noteRecoveredTurn`.
    this.saidRecovered = false;
  }

  /**
   * `cron_changed` → remember the job. Never publishes anything by itself.
   *
   * Deliberately not an AOP event. A job being added or edited is a change to the
   * *furniture*, not something an agent did, and the office has nowhere to draw it; the
   * run it eventually causes arrives as an ordinary turn, wearing the name kept here.
   */
  onCronChanged(event = {}) {
    const id = str(event.jobId) ?? str(event.job?.id);
    if (!id) return;
    if (event.action === 'removed') {
      this.jobs.delete(id);
      this.ticks = this.ticks.filter((t) => t.jobId !== id);
      return;
    }
    // `added`, `updated`, `started` and `finished` all carry the job. Only replace on one
    // that does: a future action arriving without it must not blank a name we already have.
    if (event.job && typeof event.job === 'object') this.jobs.set(id, event.job);

    // `started` fires immediately before the run, and `finished` after it, carrying the
    // session the run happened in. Together they are a second route to the same join
    // `ctx.jobId` gives us for nothing — and the only route on a gateway where the run
    // hook never arrives, because `cron_changed` is not a conversation hook. See `claimTick`.
    if (event.action === 'started') {
      this.forgetStaleTicks();
      // `agentId` is on the event as well as the job — the declaration mirrors it — and the
      // event is the better of the two to read: an action arriving without its `job` still
      // says whose errand it is, and whose it is, is the one filter that stops a chat turn
      // walking off with a tick.
      const agentId = str(event.agentId) ?? str(event.job?.agentId);
      this.ticks.push({ jobId: id, agentId: agentId ?? null, at: this.now(), claimedBy: null });
      return;
    }
    if (event.action === 'finished') {
      this.ticks = this.ticks.filter((t) => t.jobId !== id);
      const session = str(event.sessionId) ?? str(event.sessionKey);
      // Bounded, because a job that gets a fresh session per tick leaves an entry per tick
      // and a gateway runs for months. `session_end` clears the tidy cases; this is for the
      // ones that end without saying so. Insertion order is age order, so the oldest goes.
      if (session) {
        if (this.sessionJobs.size >= 200) this.sessionJobs.delete(this.sessionJobs.keys().next().value);
        this.sessionJobs.set(session, id);
      }
    }
  }

  /**
   * Seed the table from the gateway's own scheduler, for the jobs that existed before
   * this plugin loaded.
   *
   * Without it, a gateway restarted between two ticks of an hourly job knows nothing
   * about that job until it next runs — and the run *is* the tick, so the first one after
   * every restart would be the one that says "Working". `ctx.getCron().list()` is async,
   * which is why this is called from `gateway_start` and never from a hook.
   */
  seedJobs(jobs) {
    if (!Array.isArray(jobs)) return 0;
    let taken = 0;
    for (const job of jobs) {
      const id = str(job?.id);
      // A job `cron_changed` has already described is the fresher answer, and a slow
      // `list()` resolving after a tick has already begun is exactly when that matters.
      if (!id || this.jobs.has(id)) continue;
      this.jobs.set(id, job);
      taken += 1;
    }
    return taken;
  }

  /** Ticks nobody claimed in time. A run that has not called a tool in a minute is not ours. */
  forgetStaleTicks() {
    const floor = this.now() - TICK_WINDOW_MS;
    if (this.ticks.length) this.ticks = this.ticks.filter((t) => t.at >= floor);
  }

  /**
   * Which cron job, if any, this session is running right now — for a turn that arrived
   * without `ctx.jobId` to say so.
   *
   * `before_agent_run` is the only hook that carries `ctx.jobId`, and it is a conversation
   * hook: an operator who has not granted `allowConversationAccess` — or a gateway that
   * does not deliver it, which is the case this was written for — leaves every scheduled
   * desk reading a fallback. `cron_changed` needs no permission at all, so the same fact is
   * reachable the long way round. Two routes, and they are not equally good:
   *
   * - **Certain.** `finished` carries a job *and* a session, so once a session has run a
   *   job we know that pairing. A job with a `sessionTarget` runs its every tick in the
   *   same session, so the first tick guesses and all of them after it do not.
   * - **A join on the clock.** A tick that started within the last minute, for this
   *   session's agent, that nothing else has claimed. Narrow on purpose, and it **refuses
   *   to guess between two candidates**: two ticks in flight for one agent cannot be told
   *   apart from here, and a desk wearing the wrong errand's name is worse than a desk
   *   wearing none. A claim is consumed, so two sessions cannot both take one tick.
   *
   * The agent has to match where both ends know it. That is the one piece of evidence in
   * the tick that is about *who*, and without it a chat turn typed a moment after a tick
   * could walk off with the errand's name.
   */
  claimTick(s, activity) {
    const bound = this.jobs.get(this.sessionJobs.get(s.id));
    if (bound) return bound;

    this.forgetStaleTicks();
    const candidates = this.ticks.filter((t) => {
      if (t.claimedBy) return false;
      if (!this.jobs.has(t.jobId)) return false;
      const agent = str(t.agentId) ?? str(this.jobs.get(t.jobId).agentId);
      return !agent || !s.agentId || agent === s.agentId;
    });

    const chosen = candidates.length === 1
      ? candidates[0]
      : this.tickDoingThis(candidates, activity);
    if (!chosen) return null;
    chosen.claimedBy = s.id;
    return this.jobs.get(chosen.jobId) ?? null;
  }

  /**
   * Which of several ticks is the one this session is actually running.
   *
   * Two jobs for one agent on the same ten-minute anchor is not a corner case — it is
   * Tuesday — and until now it cost *both* desks their name, because `claimTick` would
   * rather say nothing than guess. This is the evidence that lets it stop guessing: the
   * work in hand. A tick's job is described by an operator who wrote a name and a prompt,
   * and a run that shells out to `python3 rabbitohs_live_watch.py` has said which of those
   * two descriptions it belongs to.
   *
   * Scored on the words of the target rather than the whole string, because the two ends
   * are written by different people: `rabbitohs_live_watch.py` versus *"Sideline Rabbitohs
   * live watch"* share three words and no substring. The winner has to be strict — a tie
   * is the ambiguity we started with — and the words that do the matching are the ones
   * already on the wire in `tool.start.target`.
   *
   * `payload.text` is read here and, as everywhere else, never published: a job's prompt
   * is a prompt. Reading one to recognise a job is not the same act as forwarding it, and
   * `test/mapper-openclaw.test.mjs` holds that line with an assertion over the whole wire.
   */
  tickDoingThis(candidates, activity) {
    if (candidates.length < 2) return null;
    const words = targetWords(activity?.target);
    if (!words.length) return null;

    let best = null;
    let bestScore = 0;
    let tied = false;
    for (const tick of candidates) {
      const score = jobScore(this.jobs.get(tick.jobId), words);
      if (score > bestScore) { best = tick; bestScore = score; tied = false; }
      else if (score === bestScore && score > 0) tied = true;
    }
    return bestScore > 0 && !tied ? best : null;
  }

  /**
   * The payload for a turn we did not see begin.
   *
   * Ranked by how much we actually know: the cron job this session is running, then the
   * work in hand, then the word that says nothing. The middle rung is the one that changed
   * — a desk reading `Running rabbitohs_live_watch.py` for a run whose prompt we never saw
   * is the difference between an office and a status light.
   */
  recoveredTurn(s, activity) {
    this.noteRecoveredTurn();
    const mode = this.redaction();
    const job = this.claimTick(s, activity);
    if (job) {
      const origin = originFromJob('schedule', job, mode);
      return { title: originTitle(origin, undefined, mode, s), trigger: 'schedule', origin };
    }
    return { title: activityTitle(activity) ?? 'Working' };
  }

  /**
   * Say, once, that turns are arriving without the hook that names them.
   *
   * The office cannot tell this apart from an agent that is simply busy, which is how it
   * went unnoticed: every desk read `Working`, correctly, for a fortnight. A turn recovered
   * from a tool call is *normal* once — a plugin that loads mid-turn has missed the start of
   * it — and evidence of a broken run lifecycle when it is every turn. One line, at the
   * boundary where it is cheap, naming the thing to check.
   */
  noteRecoveredTurn() {
    if (this.saidRecovered) return;
    this.saidRecovered = true;
    this.logger?.warn?.(
      'roving-office: a turn began without "before_agent_run", so its desk is labelled from '
      + 'the work in hand rather than the request. Normal for a turn already running when the '
      + 'plugin loaded; if every turn says it, the run lifecycle is not reaching this plugin — '
      + 'check "openclaw plugins inspect roving-office --runtime --json" for a blocked hook.',
    );
  }

  /** Who an agent is, or an empty answer if nobody has said. */
  identityFor(agentId) {
    if (!agentId || !this.resolveIdentity) return {};
    try {
      return this.resolveIdentity(agentId) ?? {};
    } catch {
      return {};   // a name is a nicety; never a reason to drop an event
    }
  }

  /**
   * @returns {object} the per-session record, created on demand (spec §7, implicit spawn).
   *
   * `reseat` is for the one caller that knows an existing record is stale.
   * `childSessionKey` is a routing address rather than a session identity, and OpenClaw
   * hands the same one out again after a ghost that never reported its end — so a record
   * found under it may belong to somebody who has already left. Without this, the new
   * arrival inherited the last occupant's name, shirt and face, which is the same bug as
   * the latch in `identify` wearing a different hat.
   */
  session(id, {
    kind = 'main', parentId = null, agentType = null, label = null,
    actor = null, actorColor = null, actorAvatar = null, agentId = null,
    hasOwnIdentity = true, reseat = false,
  } = {}) {
    if (reseat) this.sessions.delete(id);
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        kind,
        parentId,
        agentType,
        label,
        actor,
        actorColor,
        actorAvatar,
        // Which agent the identity above was resolved for, so a change of agent is visible
        // as one rather than silently kept. See `identify`.
        identityFrom: agentId,
        identityPending: !actor,
        // False for a ghost that runs *as* its parent's agent: it is that agent's helper,
        // not a second copy of them, and must never take their name. See `onSubagentSpawned`.
        hasOwnIdentity,
        // Seeded with the fallback so a session is publishable from its first event, and
        // replaced the moment an agent context offers the real thing (see `learn`).
        cwd: this.fallbackCwd,
        cwdIsFallback: Boolean(this.fallbackCwd),
        model: null,
        provider: null,
        agentId,
        runId: null,
        pendingStart: null,   // the deferred session.start, see the header
        started: false,
        turnOpen: false,
        toolCalls: 0,
        tools: new Map(),
        lastAgentCall: null,  // the tool call a subagent should hang off (spec §4.1)
        compactTokens: null,
        lastSeen: this.now(),
        ended: false,
      };
      this.sessions.set(id, s);
    }
    return s;
  }

  /** The AOP `session` object for a record, rebuilt each time so it picks up a late cwd. */
  descriptor(s) {
    const session = { id: s.id, kind: s.kind };
    if (s.cwd) session.cwd = s.cwd;
    if (s.parentId) session.parent_id = s.parentId;
    if (s.agentType) session.agent_type = s.agentType;
    const label = core.clamp(s.label, core.CAPS.label);
    if (label) session.label = label;
    const actor = core.clamp(s.actor, core.CAPS.label);
    if (actor) session.actor = actor;
    // Sent as written — `#c1440e`, `teal`, `rgb(193 68 14)` — because the office has a
    // browser to resolve a colour with and a plugin does not. Clamped so a paragraph
    // typed into the field cannot ride along on every event.
    const actorColor = core.clamp(s.actorColor, core.CAPS.color);
    if (actorColor) session.actor_color = actorColor;
    // Only ever a URL by the time it reaches here — the file it came from was uploaded
    // first, which is why this is the one identity field that can appear several events
    // into a session (see lib/avatar.mjs).
    const actorAvatar = core.clamp(s.actorAvatar, core.CAPS.avatar);
    if (actorAvatar) session.actor_avatar = actorAvatar;
    return session;
  }

  /**
   * Vendor extras (spec §3.1 `ext`). `wrapped_harness` is the de-duplication hook: because
   * OpenClaw wraps Claude Code and Codex, a user running both our OpenClaw bridge and our
   * Claude plugin would otherwise appear twice in the room, and the office needs to be told
   * which of the two reports are the same work. See docs/developer/protocol/aop-harness-adapters.md §5.
   */
  ext(s) {
    const openclaw = {};
    if (s.agentId) openclaw.agent_id = s.agentId;
    if (s.runId) openclaw.run_id = s.runId;
    if (s.model) openclaw.model = s.model;
    if (s.provider) openclaw.provider = s.provider;
    const ext = {};
    if (Object.keys(openclaw).length) ext.openclaw = openclaw;
    if (this.wrappedHarness) ext.wrapped_harness = this.wrappedHarness;
    return Object.keys(ext).length ? ext : undefined;
  }

  /**
   * Emit, flushing the deferred `session.start` first if this event is the one that
   * finally taught us where the session lives.
   */
  emit(s, event) {
    s.lastSeen = this.now();
    if (!s.started && s.pendingStart) {
      const pending = s.pendingStart;
      s.pendingStart = null;
      s.started = true;
      this.publishRaw({
        type: 'session.start',
        ts: pending.ts,
        session: this.descriptor(s),
        payload: pending.payload,
        ext: this.ext(s),
      });
    }
    this.publishRaw({ ...event, session: this.descriptor(s), ext: event.ext ?? this.ext(s) });
  }

  /**
   * Learn what an agent-scoped context knows.
   *
   * A real `workspaceDir` always wins, including over a fallback already in place — the
   * fallback exists to stop a session being unpublishable, not to outrank the truth.
   */
  learn(s, ctx = {}) {
    const workspace = str(ctx.workspaceDir);
    if (workspace && (!s.cwd || s.cwdIsFallback)) {
      s.cwd = workspace;
      s.cwdIsFallback = false;
    }
    if (str(ctx.modelId)) s.model = str(ctx.modelId);
    if (str(ctx.modelProviderId)) s.provider = str(ctx.modelProviderId);
    if (str(ctx.agentId)) s.agentId = str(ctx.agentId);
    if (str(ctx.runId)) s.runId = str(ctx.runId);
    this.identify(s);
  }

  /**
   * Make sure a session is wearing **its own** agent's identity.
   *
   * `agentId` is a slug (`albus`) and no name for a colleague, so it is looked up against
   * the agent's own `IDENTITY.md` and config entry — the only places a real name exists.
   * Late is normal and fine: the office adopts an identity that turns up after the session
   * has (spec §3.2), so a chat turn that only learns its agent on the first run hook still
   * ends up with the right person at the desk.
   *
   * The emphasis is the fix. This used to be a single `if (!s.actor)`, which reads like a
   * cache and behaves like a **latch**: the first agent a record ever saw got to name it,
   * and if the record's `agentId` later changed — a session key handed out again, a ghost
   * respawned at an address a previous one had — the first agent's name, shirt and face
   * stayed behind. The office drew Bobster's work under Sideline's name, and every arrival
   * after the first looked like the first. So the question is not "do we know who this is",
   * it is "do we know who this is **now**", and the answer is kept beside the agent it was
   * asked about. A different agent at the desk means everything the last one brought goes
   * with them — all three fields, because keeping any of them is the same latch again, one
   * field at a time.
   *
   * `identityPending` is the other half: this runs on every event and the lookup is a
   * `statSync`, cheap but not free. It stops once there is nothing left that could arrive —
   * and a picture still on its way to the office is the usual thing that could, since the
   * bytes have to get there before there is a URL to name (see lib/avatar.mjs). A session
   * with no name yet keeps asking on purpose: an agent that writes its `IDENTITY.md` during
   * a bootstrap conversation should be recognised in the session that wrote it.
   */
  identify(s) {
    if (!s.agentId || !s.hasOwnIdentity) return;
    if (s.identityFrom !== s.agentId) {
      s.actor = null;
      s.actorColor = null;
      s.actorAvatar = null;
      s.identityFrom = s.agentId;
      s.identityPending = true;
    }
    if (!s.identityPending) return;
    const who = this.identityFor(s.agentId);
    s.actor = s.actor ?? str(who.name) ?? null;
    s.actorColor = s.actorColor ?? str(who.color) ?? null;
    s.actorAvatar = s.actorAvatar ?? str(who.avatarUrl) ?? null;
    s.identityPending = !s.actor || (!s.actorAvatar && Boolean(who.avatarPath));
  }

  /** Sessions the heartbeat should speak for. */
  live() {
    const out = [];
    for (const s of this.sessions.values()) {
      if (s.ended || !s.started) continue;
      out.push({ session: this.descriptor(s), idleMs: this.now() - s.lastSeen });
    }
    return out;
  }

  // --- the hooks -----------------------------------------------------------

  /** `session_start` → a deferred `session.start`. See the header for why it waits. */
  onSessionStart(event = {}, ctx = {}) {
    const id = str(event.sessionId) ?? str(ctx.sessionId);
    if (!id) return;
    const s = this.session(id);
    this.learn(s, ctx);
    if (s.started) return;
    // No `label` here, and that is the fix for the first thing anybody noticed about
    // this bridge. OpenClaw's `sessionKey` is a routing address —
    // `agent:albus:telegram:direct:12345` — and it was being sent as the session's
    // human name, which the office honours verbatim (spec §3.2): every character in
    // the room wore a routing key on their name tag, and because a harness-set label
    // is never second-guessed, none of them ever picked up a job either. Who this is
    // belongs in `actor`, which `learn` fills from the configured agent.
    const payload = {
      source: str(event.resumedFrom) ? 'resume' : 'startup',
      capabilities: CAPABILITIES,
      redaction: this.redaction(),
      resumed: Boolean(str(event.resumedFrom)),
    };

    // Publish now if the room is settled, defer only while a better answer is genuinely
    // coming. Three ways to be settled, and the third is the subtle one:
    //
    //   - a configured `scene` routes the session outright (spec §3.4.3);
    //   - a real `workspaceDir` is already known;
    //   - only a *fallback* directory is known, but no run hook will ever fire to improve
    //     on it, so waiting would mean waiting forever.
    //
    // Both halves are load-bearing. Deferring unconditionally meant a plain chat turn was
    // never published at all when OpenClaw blocked the run hooks — no character, no clue
    // why. Publishing unconditionally was worse in the opposite direction: `session_start`
    // went out stamped with the fallback, then the real directory arrived a moment later,
    // and the office had seated one session in two different rooms.
    const settled = this.routable
      || (s.cwd && !s.cwdIsFallback)
      || (s.cwd && !this.expectRealCwd);
    if (settled) {
      s.started = true;
      s.pendingStart = null;
      this.emit(s, { type: 'session.start', payload });
      return;
    }
    s.pendingStart = { ts: new Date(this.now()).toISOString(), payload };
  }

  /** `session_end` → `session.end`. Announces an unannounced session on the way out. */
  onSessionEnd(event = {}, ctx = {}) {
    const id = str(event.sessionId) ?? str(ctx.sessionId);
    if (!id) return;
    const s = this.session(id);
    this.learn(s, ctx);

    // A turn still open when the session goes is a turn that was cut off, not one that
    // finished. Saying so keeps the office from leaving a desk labelled mid-job.
    if (s.turnOpen) {
      s.turnOpen = false;
      this.emit(s, { type: 'turn.end', payload: { status: 'cancelled', turn_id: s.runId ?? undefined } });
    }

    const payload = { reason: END_REASONS[str(event.reason) ?? 'unknown'] ?? 'other' };
    if (Number.isFinite(event.durationMs)) payload.duration_ms = event.durationMs;
    this.emit(s, { type: 'session.end', payload });

    s.ended = true;
    this.sessions.delete(id);
    this.sessionJobs.delete(id);
  }

  /** `before_agent_run` → `turn.start`. The first event that knows a `workspaceDir`. */
  onAgentRun(event = {}, ctx = {}) {
    const id = str(ctx.sessionId) ?? str(ctx.sessionKey);
    if (!id) return;
    const s = this.session(id);
    this.learn(s, ctx);

    const mode = this.redaction();
    const prompt = str(event.prompt);
    const trigger = String(ctx.trigger ?? '').toLowerCase();
    // `ctx.jobId` is populated only for cron-triggered runs, and is the id of the job in
    // the table above. It is the one field that turns "a scheduled run happened" into
    // "*this* job ran".
    const job = this.jobs.get(str(ctx.jobId)) ?? null;
    const origin = originFor(trigger, job, mode);
    // The run hook knows the pairing outright, so a tick it accounts for must not be left
    // lying around for `claimTick` to hand to somebody else.
    if (job) {
      this.ticks = this.ticks.filter((t) => t.jobId !== job.id);
      this.sessionJobs.set(s.id, job.id);
    }

    const payload = { title: originTitle(origin, prompt, mode, s) };
    // Omitted rather than defaulted: see TRIGGERS. A `memory` or `overflow` run has no
    // honest word in AOP's five, and `origin.kind` says `maintenance` for it instead.
    const aopTrigger = TRIGGERS[trigger];
    if (aopTrigger) payload.trigger = aopTrigger;
    // A turn nobody asked for is worth saying so even when we know nothing else about it,
    // so this rides on every turn rather than only on the ones carrying a job — but only
    // when we can name a kind. See `originFor`.
    if (origin) payload.origin = origin;
    if (str(ctx.runId)) payload.turn_id = str(ctx.runId);
    if (prompt) payload.prompt_chars = prompt.length;
    if (mode === 'full' && prompt) payload.prompt = core.clamp(prompt, core.CAPS.prompt);

    s.turnOpen = true;
    s.toolCalls = 0;
    this.emit(s, { type: 'turn.start', payload });
  }

  /** `agent_end` → `turn.end`. */
  onAgentEnd(event = {}, ctx = {}) {
    const id = str(ctx.sessionId) ?? str(ctx.sessionKey);
    if (!id) return;
    const s = this.session(id);
    this.learn(s, ctx);

    const payload = {
      status: event.success ? 'completed' : (str(event.error) ? 'error' : 'cancelled'),
      tool_calls: s.toolCalls,
    };
    if (Number.isFinite(event.durationMs)) payload.duration_ms = event.durationMs;
    const turnId = str(event.runId) ?? str(ctx.runId);
    if (turnId) payload.turn_id = turnId;
    // An error message is free text, so `metadata` mode does not get one.
    if (this.redaction() !== 'metadata' && str(event.error)) {
      payload.summary = core.clamp(event.error, core.CAPS.summary);
    }

    s.turnOpen = false;
    this.emit(s, { type: 'turn.end', payload });
  }

  /**
   * `before_tool_call` → `tool.start`.
   *
   * Returns nothing. This is a decision hook and we are an observer; see the header.
   */
  onToolStart(event = {}, ctx = {}) {
    const id = str(ctx.sessionId) ?? str(ctx.sessionKey);
    if (!id) return;
    const s = this.session(id);
    this.learn(s, ctx);

    const toolName = str(event.toolName) ?? str(ctx.toolName) ?? 'tool';
    const params = event.params && typeof event.params === 'object' ? event.params : argsOf(event);
    const command = core.firstString(params.command, params.cmd, params.script);
    const toolClass = classify(toolName, command);
    const callId = str(event.toolCallId) ?? str(ctx.toolCallId) ?? `${id}:${this.now()}:${s.toolCalls}`;

    // `derivedPaths` is OpenClaw's own best-effort parse of the destination paths for
    // tools it recognises, and it is a better answer than re-guessing from `params` —
    // but only a hint, per its own docs, so `targetOf` remains the fallback.
    //
    // A derived path needs no gate: it is a path, which is the one category
    // `metadata` promises. `targetOf` gets the mode because `params` may hold a
    // search pattern or a URL instead — see `TARGET_KINDS` in `tool-classes.cjs`.
    const derived = Array.isArray(event.derivedPaths) ? core.firstString(event.derivedPaths[0]) : undefined;
    const target = derived
      ? core.tidyPath(derived, s.cwd)
      : targetOf(params, command, s.cwd, core, this.redaction());

    // A turn we never saw open: OpenClaw can run tools for a turn that started before
    // the plugin loaded — or for a whole gateway that never delivers `before_agent_run`.
    // Open one rather than dropping the call on the floor.
    //
    // It still claims nothing about *who* asked unless something can be shown to have:
    // `claimTick` produces an `origin` only where the evidence names one job and no other,
    // and where it cannot, this turn says how it started by saying nothing about it.
    //
    // Before the count, not after: `tool_calls` on `turn.end` is this turn's, and the reset
    // used to live only in `onAgentRun`. On a gateway where that hook never fires it never
    // ran either, so one session's turns reported 14, then 16, then 20 — a running total
    // dressed as a per-turn count.
    if (!s.turnOpen) {
      s.turnOpen = true;
      s.toolCalls = 0;
      this.emit(s, { type: 'turn.start', payload: this.recoveredTurn(s, { toolClass, target }) });
    }

    s.toolCalls += 1;
    s.tools.set(callId, { name: toolName, class: toolClass, target, at: this.now() });
    if (toolClass === 'agent') s.lastAgentCall = callId;

    const payload = { tool_call_id: callId, tool_name: toolName, tool_class: toolClass };
    if (target) payload.target = target;
    // More than one call in flight is the office's cue to show parallel work.
    if (s.tools.size > 1) payload.concurrent = true;
    this.emit(s, { type: 'tool.start', payload });
  }

  /** `after_tool_call` → `tool.end`, plus `artifact.change` when something durable landed. */
  onToolEnd(event = {}, ctx = {}) {
    const id = str(ctx.sessionId) ?? str(ctx.sessionKey);
    if (!id) return;
    const s = this.session(id);
    this.learn(s, ctx);

    const callId = str(event.toolCallId) ?? str(ctx.toolCallId);
    const remembered = callId ? s.tools.get(callId) : undefined;
    if (callId) s.tools.delete(callId);

    const toolName = str(event.toolName) ?? remembered?.name;
    const params = event.params && typeof event.params === 'object' ? event.params : {};
    const command = core.firstString(params.command, params.cmd, params.script);
    const toolClass = remembered?.class ?? classify(toolName, command);
    const error = str(event.error);

    const payload = {
      tool_call_id: callId ?? `${id}:${this.now()}`,
      status: error ? 'error' : 'ok',
    };
    if (toolName) payload.tool_name = toolName;
    if (toolClass) payload.tool_class = toolClass;
    if (Number.isFinite(event.durationMs)) payload.duration_ms = event.durationMs;
    else if (remembered) payload.duration_ms = this.now() - remembered.at;
    if (error && this.redaction() !== 'metadata') payload.error = core.clamp(error, core.CAPS.message);

    this.emit(s, { type: 'tool.end', payload });

    // Only on success, and only for the classes that leave something behind.
    const kind = ARTIFACT_KINDS[toolClass];
    if (!error && kind) {
      const target = remembered?.target ?? targetOf(params, command, s.cwd, core, this.redaction());
      // `path` only where a path is what we have. For a shell command `targetOf`
      // names the command ("git push origin main"), which is the right desk label
      // for a `tool.start` and a wrong answer for an artifact's path — a `git push`
      // produced a commit, not a file called `git`. A commit's real identity is a
      // sha nobody handed us, so the honest payload names the kind and stops there.
      const isPath = kind === 'file' && target && /[/.]/.test(target);
      this.emit(s, {
        type: 'artifact.change',
        payload: isPath ? { kind, path: target } : { kind },
      });
    }
  }

  /**
   * `subagent_spawned` → a child `session.start` (spec §6.1 — subagents are ghosts).
   *
   * `parent_tool_call_id` is what lets the office bind the ghost to the exact tool call
   * that spawned it, and dissolve every straggler when that call ends. OpenClaw does not
   * hand it to us, so it is the last `agent`-class tool call we saw on the parent —
   * which is what `subagents` is.
   *
   * **A ghost only takes a name when it really is somebody else.** A subagent can be one of
   * the operator's own configured agents, in which case it has a name and a shirt of its own
   * and should be called by them. But OpenClaw also runs helper threads *as the spawning
   * agent*, reporting the parent's own `agentId` — and naming those after the parent put four
   * identical Sidelines in the room with nothing to tell them apart, which is what this whole
   * fix is about. A helper is Sideline's, not a second Sideline, so it goes into the pool and
   * gets a character of its own. `hasOwnIdentity: false` makes that stick: without it the
   * child's first tool call would `learn` the same `agentId` and quietly re-adopt the name we
   * just declined.
   */
  onSubagentSpawned(event = {}, ctx = {}) {
    const childId = str(event.childSessionKey);
    if (!childId) return;
    const parentId = str(ctx.sessionId) ?? str(ctx.sessionKey);
    const parent = parentId ? this.session(parentId) : null;
    const childAgent = str(event.agentId) ?? null;
    const parentAgent = parent?.agentId ?? str(ctx.agentId) ?? null;
    const ownIdentity = Boolean(childAgent) && childAgent !== parentAgent;
    const childOf = ownIdentity ? this.identityFor(childAgent) : {};

    const child = this.session(childId, {
      kind: 'subagent',
      parentId: parentId ?? null,
      agentType: childAgent,
      label: str(event.label) ?? null,
      agentId: childAgent,
      hasOwnIdentity: ownIdentity,
      actor: str(childOf.name) ?? null,
      actorColor: str(childOf.color) ?? null,
      actorAvatar: str(childOf.avatarUrl) ?? null,
      // A spawn is an arrival, so an existing record under this key belongs to a ghost that
      // has already gone — `subagent_ended` is the hook least likely to fire, and OpenClaw
      // reuses these addresses. Reusing the record would hand the newcomer the last
      // occupant's face.
      reseat: true,
    });
    if (parent?.cwd) child.cwd = parent.cwd;
    if (str(event.resolvedModel)) child.model = str(event.resolvedModel);
    if (str(event.resolvedProvider)) child.provider = str(event.resolvedProvider);
    if (str(event.runId)) child.runId = str(event.runId);

    const payload = {
      source: 'spawn',
      capabilities: CAPABILITIES,
      redaction: this.redaction(),
    };
    if (parent?.lastAgentCall) payload.parent_tool_call_id = parent.lastAgentCall;

    // Not deferred: a ghost inherits its parent's directory, so it already knows its room.
    child.started = true;
    child.pendingStart = null;
    this.publishRaw({
      type: 'session.start',
      session: this.descriptor(child),
      payload,
      ext: this.ext(child),
    });
    child.lastSeen = this.now();
  }

  /** `subagent_ended` → the child's `session.end`. */
  onSubagentEnded(event = {}) {
    const childId = str(event.targetSessionKey);
    if (!childId) return;
    const child = this.sessions.get(childId);
    if (!child) return;

    const outcome = str(event.outcome);
    const reason = outcome === 'ok' ? 'exit'
      : outcome === 'error' ? 'error'
      : outcome === 'timeout' ? 'timeout'
      : outcome === 'killed' ? 'killed'
      : outcome === 'reset' || outcome === 'deleted' ? 'clear'
      : 'other';

    this.emit(child, { type: 'session.end', payload: { reason } });
    child.ended = true;
    this.sessions.delete(childId);
  }

  /**
   * `before_compaction` is remembered, `after_compaction` reports (spec §4.4).
   *
   * Only the pair carries the interesting number: `context.compact` wants tokens before
   * *and* after, and each hook knows one of them. A `before` with no `after` is a
   * compaction that failed, and says nothing.
   *
   * `trigger` is always `auto`: OpenClaw fires the same hook for an automatic cycle and
   * for an operator's `/compact`, and nothing in the payload separates them. [unverified]
   */
  onBeforeCompaction(event = {}, ctx = {}) {
    const id = str(ctx.sessionId) ?? str(ctx.sessionKey);
    if (!id) return;
    const s = this.session(id);
    this.learn(s, ctx);
    s.compactTokens = Number.isFinite(event.tokenCount) ? event.tokenCount : null;
  }

  onAfterCompaction(event = {}, ctx = {}) {
    const id = str(ctx.sessionId) ?? str(ctx.sessionKey);
    if (!id) return;
    const s = this.session(id);
    this.learn(s, ctx);

    const payload = { trigger: 'auto' };
    if (Number.isFinite(s.compactTokens)) payload.tokens_before = s.compactTokens;
    if (Number.isFinite(event.tokenCount)) payload.tokens_after = event.tokenCount;
    s.compactTokens = null;
    this.emit(s, { type: 'context.compact', payload });
  }
}
