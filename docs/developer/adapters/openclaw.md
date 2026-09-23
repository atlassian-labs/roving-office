# OpenClaw adapter

*Installing it is [OpenClaw](../../user/sources/openclaw.md); the identity fields are
[names, colours and faces](../../user/sources/openclaw-identity.md). This is the plugin.*

The only adapter that is a **plugin** rather than a shell command per event, because
OpenClaw has a real in-process hook bus. That buys heartbeats — every other adapter is a
process that lives forty milliseconds and cannot say "still alive" — and costs the
permission events, which its approval flow runs the wrong way round to observe.

[Conformance level L2](../protocol/aop-spec.md#9-conformance-levels). The verified hook
payloads, the publisher's design and the WebSocket route are in
[adapter notes §5](../protocol/aop-harness-adapters.md#5-openclaw).

Everything the plugin accepts — `url`, `token`, `scene`, `wrappedHarness`, `heartbeatMs`,
`lingerMs`, `enabled` — is declared in `openclaw-plugin/openclaw.plugin.json`, and
`openclaw plugins inspect roving-office` reads it back.

## Why the installer takes no `--url` and `--token`

It would be one flow with two implementations: minting an office, spelling the ingest path,
and knowing that `enabled` and `allowConversationAccess` matter — done once in the
installer and again in whatever a reader pasted out of a page. The
[server-side script](../../user/sources/openclaw-server.md) does all of it, once.

## Upgrading a server install keeps its office

Running the script again is the whole procedure — that part is in
[OpenClaw on a server](../../user/sources/openclaw-server.md). What follows is the
resolution order behind it, and the diagnostics for when it goes wrong.

**It keeps the office it already had.** The script used to mint a fresh one on every run,
which was defensible while an office was disposable — a deploy lost them all anyway, so a
new keycard cost nothing that was not already gone. It is not defensible now: an office
survives a deploy holding its scene layout, its furniture and its history, and it holds
several named ingest tokens rather than one that re-minting revokes.

So the office is resolved in this order, and the same goes for the **scene** — a room name
somebody chose is not re-guessed from the hostname on an upgrade:

| | |
| --- | --- |
| `--keycard` + `--token` | the office you named |
| *(nothing)* | the one this Gateway is already publishing to, read back out of `plugins.entries.roving-office.config` |
| *(nothing, and none configured)* | a freshly minted one |
| `--new-office` | a fresh one anyway. The old one is **left behind, not replaced** — everything in it is still there for anyone holding its keycard. |

The config is read **before** the install, which is load-bearing and easy to undo:
`openclaw plugins install` rewrites `plugins.entries.roving-office`, so the endpoint is gone
by the time the install has finished. Read, install, write. And it is read from the file
rather than with `openclaw config get`, which would be the stabler contract and is the wrong
tool here — `config get` prints the config *redacted*, and the write token is exactly the
field that comes back masked.

That works because the script always installs with `--force`, and it has to: `plugins install` **refuses to overwrite an existing install**, stopping with `plugin already exists: … (delete it first)`. On a server every run after the first is a replacement, so the polite form is only ever right once.

Not `openclaw plugins update`: that is for packages tracked against a registry, and this is a private scoped tarball no registry has heard of. `--force` is also incompatible with `--link`, which is fine — a linked plugin never needs replacing, because there is no copy to replace.

Two things to check afterwards, because "installed" and "running" are different claims:

```bash
openclaw plugins inspect roving-office --runtime --json
# install.resolvedVersion — did the version actually move?
# diagnostics[]           — anything blocked? see the permission section above
```

**`scene` is set for you, to the server's hostname.** Rooms are normally derived from the git remote, and a Gateway working outside a repo has none — it would land in a room named after whatever directory it happened to be in. `scene` names the room outright ([spec §3.4.3](../protocol/aop-spec.md#343-the-scene-override)), so all of that Gateway's work arrives in one place; the hostname is a better guess than a directory, and `--scene` overrides it when the hostname is not what you want to see over a desk.

**Check the server can actually reach the office before anything else.** A Gateway usually
runs somewhere other than your laptop, so it is answering a different network's questions —
and an office behind a corporate proxy, a VPN or an allowlisting edge returns `403` and an
error page *before* the keycard or the token is ever looked at, which reads exactly like a
bad token. One `curl` from the Gateway host settles which it is:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  https://therovingoffice.com/office/AB12CD34/aop/v0/events \
  -H 'Content-Type: application/x-ndjson' -H 'X-Roving-Office-Token: <token>' \
  --data '{"aop":"0.1","id":"probe","seq":1,"at":"2026-01-01T00:00:00Z","type":"session.start","harness":{"name":"openclaw"},"session":{"id":"probe","cwd":"/tmp"},"payload":{"source":"startup"}}'
# 202 -> the network is fine; 403 -> it is not, and no plugin setting will fix it
```

If it is `403`, host the receiver somewhere the agent can reach instead — `server.cjs` is an
ordinary Node server and will run wherever you can put one.

**The office is minted for you** — the script POSTs this itself and reads the reply, so the token never goes through a clipboard. By hand, from [reception](https://therovingoffice.com/) or over HTTP; the write token is returned once, at mint, and no route will tell you it again:

```bash
curl -sX POST https://therovingoffice.com/api/offices -d '{}'
# -> { "keycard": "AB12CD34", "writeToken": "…", … }
```

**No change is needed to the office server itself.** Ingest has been harness-agnostic since it was written: the plugin posts the same gzipped NDJSON batches to the same per-office endpoint with the same write token as the hook adapters, and `harness.name` is a label the receiver stores rather than a list it checks. This was tested against a deployed office rather than assumed: a new adapter needs no redeploy.

## What the packer does, and the one thing it costs

The plugin shares two modules with the hook adapters, up in `bin/` — the same answers to "which office does this directory belong to" and "how much may be said about it". A tarball has no `bin/` above it, so the packer **vendors** those two files and rewrites the one file that reaches for them (`lib/shared.mjs`, which exists to be that single seam). Everything else in the artifact is byte-identical to the checkout, so it can be reviewed by diffing.

It also copies `bin/aop-openclaw-server.sh` out beside the tarball, verbatim rather than generated — for the same reason the rest of the artifact is byte-identical to the checkout, since a shell script written into a JS string is a shell script nobody will review.

It then refuses to ship an artifact that reaches outside itself. Every relative `import` and `require` in the staged tree is resolved, and any that escapes the package is a hard failure — because the symptom otherwise appears far away, as an OpenClaw Gateway logging a module-not-found at startup, and looks like OpenClaw's fault. `--verify` goes further and *runs* the packed plugin from a temp directory with no checkout above it, because a vendored file can be present and still be the wrong one.

**The cost is that a packed install is a snapshot**, and snapshots go stale — the trap described below, arriving by the other door. The version is stamped from `package.json` so the artifact is at least traceable, but a server keeps running the copy it has until someone installs a new one. Where you can link, link.

This stopped being hypothetical on the first real install. `0.3.0` went to a server, the run-lifecycle problem above was found and fixed, and the fix had to ship as `0.4.0` — because OpenClaw records `resolvedVersion` and an install of a version it already holds can legitimately do nothing. **If you are replacing an artifact on a server, check the version moved**, and confirm with `openclaw plugins inspect roving-office --runtime --json` (the `install.resolvedVersion` and `install.installedAt` fields say what is really loaded).

## Installed as a link, not a copy

`npm run connect:openclaw` runs `openclaw plugins install --link`, and the link is deliberate.

OpenClaw will happily install from ClawHub, npm, git or a local path, and for a local path it offers a copy or a link. A copy would be the conventional choice and it is the wrong one here, for two reasons. The plugin **shares** `bin/lib/aop-core.cjs` with the hook adapters — one answer per machine to "which office does this repo belong to" and "how much may this office be told" — and a copy of the plugin directory alone would not carry it. And a copy is a snapshot, which is the trap the [Claude Code plugin](claude-code.md#changing-the-plugin-means-bumping-the-version) has to work around with a version bump on every change: an update that offers the version it already holds does nothing at all, silently, however far the files have drifted. A link has no snapshot, so it cannot go stale and there is no ritual to forget.

The price is that the checkout has to stay where it is — and that a Gateway with no checkout at all cannot use this route, which is what `npm run pack:openclaw` is for. `--status` prints the linked path and says so plainly if it no longer points at this checkout, so a moved directory is a visible fact rather than an empty room.

## The one thing the plugin cannot see

**There is no permission hook.** OpenClaw's approval flow runs the other way round: a plugin *asks* for approval by returning `requireApproval` from `before_tool_call`. It cannot observe the approvals **core** raises for its own `exec` tool.

That matters more than the count of missing events suggests, because [the spec](../protocol/aop-spec.md#44-attention-and-interruptions) calls `permission.request` the single most valuable non-L0 event — it is the only reliable signal that an agent is *waiting on you*, which is exactly what a room full of characters is best at showing at a glance. So the plugin does not declare it in its capabilities, and an OpenClaw agent blocked on an approval looks, from the office, like an agent thinking hard.

The Gateway WebSocket does carry `exec.approval.requested` / `.resolved`, and that is the one concrete reason to prefer it. It is the obvious next increment rather than a redesign: the mapping is already written down in [adapter notes §5](../protocol/aop-harness-adapters.md#5-openclaw), and the plugin's publisher would be reused as-is.

**And the plugin never returns a decision.** `before_tool_call`, `before_agent_run` and several others *can* block a call, rewrite its parameters or demand human approval. Every handler in this plugin returns `undefined`, always, and the test harness asserts it. A diorama does not get a vote on whether a tool call happens.

## Double counting, and why it has not bitten yet

OpenClaw wraps Claude Code and Codex. So a machine with this plugin **and** our Claude Code plugin installed can see the same work twice: once as an OpenClaw session, once as a Claude Code session, standing at two desks.

The plugin holds up its end — it stamps `harness.name = "openclaw"` and, when told which harness it is fronting, `ext.wrapped_harness`:

```json
{ "plugins": { "entries": { "roving-office": { "config": { "wrappedHarness": "claude-code" } } } } }
```

It has to be told rather than sniffing, and that is the honest position: nothing in the hook payloads names the wrapped harness. `modelProviderId` is the provider (`anthropic`), not the harness, and guessing `claude-code` from it would be wrong for every session where OpenClaw drives Anthropic directly.

The other end — the office **de-duplicating** on `session.cwd` plus overlapping time when two harnesses report the same `project.repo.commit` — is **not built**. Until it is, the mitigation is to run one or the other, which is what `wrappedHarness` is really for: it is a declaration, ready for a reducer that does not exist yet.

## What the office is told

The same as every other source, and the same [redaction](../protocol/aop-spec.md#10-privacy-and-redaction) settings in `~/.roving-office/settings.json` govern it — they are the office's, not a harness's, so one setting covers every harness on the machine.

| OpenClaw hook | Becomes | Note |
| --- | --- | --- |
| `session_start` | `session.start` | **deferred** — see below |
| `session_end` | `session.end` | its nine reasons collapse onto AOP's seven |
| `before_agent_run` | `turn.start` | the desk label, and the first event that knows a directory |
| `agent_end` | `turn.end` | with a duration and a tool-call count |
| `before_tool_call` | `tool.start` | classified into the closed `tool_class` enum |
| `after_tool_call` | `tool.end`, `artifact.change` | the artifact only on success |
| `subagent_spawned` / `subagent_ended` | child `session.start` / `session.end` | real [ghosts](../scene-internals.md#subagents-are-ghosts), bound to the tool call that spawned them |
| `before_compaction` + `after_compaction` | `context.compact` | the pair, because each hook knows one of the two numbers |
| `cron_changed` | *nothing, directly* | it names the scheduled jobs, so the **turn** they cause can say which one it is — see below |
| *a 15-second timer* | `session.heartbeat` | the thing no hook adapter can do |

### What a scheduled run looks like

*Verified 2026-09-02 by reading `dist/hook-types-*.d.ts`, `dist/server-cron-*.js`,
`dist/run-executor.runtime-*.js` and `dist/embedded-agent-*.js` out of `npm pack openclaw`,
at **2026.7.1-2** (the version the plugin targets) and again at **2026.8.2** (current). Every
fact below holds on both.*

This is the answer the plan for carrying *why a job exists* onto the wire went looking for,
and it is better than that plan assumed: **a cron run already tells a plugin its job's name,
id, schedule and outcome.** Nothing needs to be inferred, and no new permission
is needed to hear it.

**1. The agent context names the job.** `PluginHookAgentContext` — the `ctx` of
`before_agent_run`, `agent_end`, `before_tool_call` and `after_tool_call` — carries two fields
the mapper does not read today:

| Field | For a cron run | Declared |
| --- | --- | --- |
| `ctx.trigger` | `"cron"` | *"What initiated this agent run"* — a closed enum, see below |
| `ctx.jobId` | the job's id | *"Stable cron job identifier populated for cron-triggered runs"* |

Both are set together where the run is launched (`run-executor.runtime`, for the CLI-backed and
embedded paths alike) and copied straight onto the hook context in `embedded-agent`, beside
`runId`, `sessionId` and `workspaceDir`. So `ctx.jobId` is the **correlation key**, and it is on
the same event that already becomes `turn.start`.

**2. `ctx.trigger` is a closed six-member enum**, not free text:

```ts
type EmbeddedRunTrigger = "cron" | "heartbeat" | "manual" | "memory" | "overflow" | "user";
```

Which settles the old suspicion that a cron is drawn as a human request, and settles it the
other way round from the guess. `TRIGGERS` in `lib/map.mjs` already maps
`cron`, `heartbeat`, `manual` and `user`, so **a cron is not being reported as a human
request** — the desk says `Working` because the *title* falls back, not because the trigger is
wrong. The two genuinely unmapped values are `memory` and `overflow`, both of which silently
become `'user'` today. Neither is a human asking for anything: they are the agent flushing
memory and shedding context.

**3. There is a `cron_changed` hook, and it carries the whole job.** It is in
`PLUGIN_HOOK_NAMES`, it is **not** in `CONVERSATION_HOOK_NAMES`, and so — unlike
`before_agent_run` — it needs no `allowConversationAccess`. It fires with a *gateway* context,
not an agent one:

```ts
cron_changed: (event: PluginHookCronChangedEvent, ctx: PluginHookGatewayContext) => void
```

| `event.action` | When | What comes with it |
| --- | --- | --- |
| `started` | immediately before the run begins | `jobId`, `job`, `runAtMs` |
| `finished` | after it ends | `jobId`, `job`, `status`, `error`, `summary`, `durationMs`, `sessionId`, `sessionKey`, `runId`, `delivered`, `nextRunAtMs`, `model`, `provider` |
| `added`, `updated`, `removed` | the job definition changed | `jobId`, `job` |

And `event.job` is the definition itself — `id`, `agentId`, `name`, `description`, `enabled`,
`sessionTarget`, `payload.text`, and a discriminated `schedule`:

```ts
| { kind: "cron";    expr?; tz?; staggerMs? }
| { kind: "at";      at? }
| { kind: "every";   everyMs?; anchorMs? }
| { kind: "on-exit"; command?; cwd? }
```

Which is, field for field, the `origin` object that doc proposed: `name`, `id`, `schedule`.
The operator's own words for the job, its id and its cron expression — *"Hourly inbox
triage"*, `11111111-…` and `17 * * * *` in the example below — are all right there.

**Two ordering facts that decide the design.** `started` fires *before* the run, so a job
cached on `cron_changed` is already in hand when `before_agent_run` arrives with the matching
`ctx.jobId` — the lookup is local and synchronous, which is the only kind a hook may do. But
`started` carries **no `sessionId` or `sessionKey`** (only `finished` does), so the join has to
run in that direction: `cron_changed` stashes the job by id; `before_agent_run` claims it by
`ctx.jobId`. Going the other way would need a session the `started` event does not know.

`ctx.getCron()` on the gateway context is the backstop for a gateway that was already running
jobs when the plugin loaded — `list({ includeDisabled })` returns the same `job` shapes. It is
async, so it belongs in `gateway_start`, never in a hook.

**4. The heartbeat is a different shape, and its answer is thinner.** A heartbeat run is
`ctx.trigger === "heartbeat"` with **no `jobId`** — it is not a cron job. There is a
`heartbeat_prompt_contribution` hook carrying `{ sessionKey, agentId, heartbeatName }`, so the
*name* is available; but it is a prompt-injection hook, whose whole purpose is to return text
to inject, and registering it means core will call and merge our result. Observing through it
is possible (return nothing) but it is a decision hook by nature, and
[the plugin's rule](#the-one-thing-the-plugin-cannot-see) is that we never register for one to
watch it.

The checklist is not on any hook. It lives in **`HEARTBEAT.md` in the agent's workspace** —
the default prompt is *"Read HEARTBEAT.md if it exists… Follow it strictly"* — so the plugin
has to read the checklist off a file rather than be handed it by a hook, which is the same
trick `lib/identity.mjs` already plays on `IDENTITY.md` in the same directory. So a heartbeat `plan`
is readable; **which** item is running is still not, and nothing found here changes that.

**What is still missing**, so it is not re-discovered later: there is no per-step signal for a
cron or heartbeat run, and `payload.text` is the job's prompt rather than a description of its
parts. Steps for OpenClaw remain the last unanswered stage of the step work, and remain
unanswered.

### So a scheduled desk says what it is doing

Built on the above, and the reason the desk label stopped reading `Working`.

The plugin keeps a table of `jobId → job`, filled from `cron_changed` and topped up at
`gateway_start` from `getCron().list()` for the jobs that already existed. A `turn.start`
then carries an `origin` ([spec §4.2](../protocol/aop-spec.md#origin-why-a-turn-exists)) claimed from
that table by `ctx.jobId`:

```jsonc
{ "type": "turn.start", "payload": {
    "title": "Hourly inbox triage",
    "trigger": "schedule",
    "origin": { "kind": "schedule",
                "name": "Hourly inbox triage",
                "id": "11111111-2222-4333-8444-555555555555",
                "schedule": "17 * * * *" } } }
```

Three things about that are worth stating rather than leaving to be inferred.

**The name survives `metadata`, which is the whole point.** `resolveRedaction()` defaults to
`metadata`, so a rule that treated an operator's job name as conversation content is what made
every scheduled desk in every default install read `Working`. A cron job's name is typed into a
scheduler config, not into a prompt — the same category of thing as a tool name or a file path,
both of which `metadata` already sends. [Spec §10](../protocol/aop-spec.md#10-privacy-and-redaction)
carries the ruling as a row of its own. The job's *prompt* (`payload.text`) is a prompt like any
other and never travels; only `name`, `id` and `schedule` do.

**It needs `allowConversationAccess`, and that is not obvious.** `ctx.jobId` rides on the agent
context, and the only hook carrying it that we register is `before_agent_run` — a conversation
hook. `PluginHookToolContext` has neither `jobId` nor `trigger`, so the turn synthesised from a
tool call cannot be rescued *this* way. On an install that declined the permission, a cron run
still appears; it just cannot say whose errand it is by this route — see
[the next section](#when-only-half-the-run-lifecycle-arrives) for the route that does not need
the permission at all. One more entry for
[the table above](../../user/sources/openclaw.md#set-this-one-flag-or-desks-will-have-no-labels).

**An unmapped trigger is now omitted rather than called `user`.** `memory` and `overflow` are
the agent flushing memory and shedding context, and AOP's five-word `trigger` enum has no home
for either. They used to arrive as `user` — drawn as a person asking for something, which is the
same small lie as calling a 3am ingest "Working". `trigger` is optional, so it is left out, and
`origin.kind` says `maintenance`.

### When only half the run lifecycle arrives

*Measured on 2026-09-03, from the office's own buffer
(`/office/<keycard>/aop/v0/state?after=0`) on a gateway running `openclaw` with the plugin
installed and publishing happily.*

The section above assumed the run lifecycle is all-or-nothing: either
`allowConversationAccess` is set and both hooks fire, or it is not and neither does. A live
gateway disagreed. Four consecutive turns arrived carrying `turn.end` with a `turn_id`, a
`duration_ms` and a tool count — which only `agent_end` produces — while every `turn.start`
was the one synthesised inside `onToolStart`, payload `{"title":"Working"}` and nothing else.
`before_agent_run` was not arriving; `agent_end` was.

Three signatures tell those two turns apart, and they are worth writing down because the
office cannot show the difference and a busy agent looks identical:

1. **The timestamp matches the tool call to the millisecond.** A real `turn.start` precedes
   the first tool call by however long the model thought.
2. **`ext.openclaw.run_id` is set while `payload.turn_id` is not.** Both are read off the same
   `ctx.runId` in `onAgentRun`, so that pair cannot occur on the real path — but `onToolStart`
   learns the run id and then emits a turn that has no id to give.
3. **`tool_calls` climbs across turns of one session** — 14, then 16, then 20. The reset lived
   only in `onAgentRun`. That is fixed: the count now belongs to whichever handler opens the
   turn.

Both dispatch sites for the hook are inside OpenClaw (`runEmbeddedAttemptBeforeAgentRun`, and
the CLI runner), both are guarded by a `hookRunner` handed in by the caller, and the
registration gate is per hook name but reads one flag for the whole conversation set
(`dist/loader-*.js`, `conversationHookNameSet`) — so a permission that admits `agent_end` has
admitted `before_agent_run` too, and the cause is further in than config. Root cause on the
gateway is still open; what follows is the plugin not depending on the answer.

What settles it, on the gateway host, in three commands. The hook dispatch line is logged at
`debug` by OpenClaw itself, which is the one piece of evidence that separates *not registered*
from *registered and never called*:

```bash
openclaw plugins inspect roving-office --runtime --json   # registered hooks, diagnostics[], resolvedVersion
openclaw config get plugins.entries.roving-office         # allowConversationAccess, and whether it is installed twice
OPENCLAW_LOG_LEVEL=debug openclaw logs --follow | grep -E '\[hooks\] running (before_agent_run|agent_end)'
```

`openclaw logs` works over RPC, so none of that needs a shell on the box.

**One more thing the same buffer showed, unrelated and worth its own look.** In the
interactive session every tool call arrived **twice** — same `tool_call_id`, about 55 ms
apart, under two names (`openclawcron` and `cron`, `openclawmemory_search` and
`memory_search`), the second `tool.end` missing its duration because the first had already
taken the call off the in-flight table. Seven real calls became fourteen. The cron session's
`exec` fired once, so this is the interactive path only, and the two payloads differ, so it is
two dispatches rather than a duplicated publish. Whether that is a gateway wrapper announcing
the call at two layers or the plugin being loaded twice is answered by the second command
above. Not fixed here: de-duplicating on `tool_call_id` in the mapper would paper over a
question worth answering, and would also hide a genuinely re-run tool call.

**So a scheduled desk names its job without the run hook.** `cron_changed` is *not* a
conversation hook, and it carries the whole job. It cannot carry the join — `started` has no
session — but two of its actions can be made to:

| Route | Evidence | Confidence |
| --- | --- | --- |
| `ctx.jobId` on `before_agent_run` | the harness states the pairing | certain, and preferred whenever it arrives |
| `finished` → `{ jobId, sessionId }` | the one cron event carrying a job and a session together | certain, from the second tick of a `sessionTarget` job onwards |
| a `started` tick claimed by a session | one unclaimed tick, < 60 s old, for this session's agent | a join on the clock |
| the tick whose job describes the work in hand | the target of the first tool call, scored against each job's name and prompt | a join on the evidence, and it **declines on a tie** |

The last two rows are the only inference in the chain, and both are fenced: the agent has to
match where both ends know it, a claim is consumed so two sessions cannot take one tick, and
an ambiguity that cannot be resolved yields no `origin` at all. A desk wearing the wrong
errand's name is worse than a desk wearing none.

**The fourth row is what makes the third one useful in practice**, because two jobs for one
agent on the same ten-minute anchor is not a corner case. Measured on 2026-09-03: Sideline's
Rabbitohs and Utah watchers tick together, and the clock alone could only decline — so *both*
desks lost their name, which is the failure this whole section exists to remove, arriving by
another road. The run itself settles it. A tick's job was described by an operator who wrote a
name and a prompt, and a run shelling out to `python3 rabbitohs_live_watch.py` has said which
of the two descriptions it belongs to.

Scored on the *words* of the target, not the string, because the two ends are written by
different people: `rabbitohs_live_watch.py` and *"Sideline Rabbitohs live watch"* share three
words and no substring. Only the named thing contributes — basenames, nothing under four
letters, no interpreters, no flags — because a word two jobs share cannot tell them apart, and
`watch` is in both of those names. The winner must be strict; a tie is the ambiguity we
started with.

`payload.text` is read for this and, as everywhere else, never published. Reading a prompt to
recognise a job is not the same act as forwarding it, and the test file holds that line with
an assertion over the whole wire rather than over one field.

**And a turn with no job to claim says what it is doing instead of that it is doing
something.** `Working` is true of every turn ever run. The first tool call is a worse label
than a prompt and a much better one than that — `Running rabbitohs_live_watch.py` — and it is
new on the wire nowhere: the same string is already travelling as the `tool.start` beside it.
Only the classes whose target is a path or a command name it; a `search` target is the model's
own query, which is free text, so those contribute the verb alone.

**The desk drops the agent's own name off the front of the label.** An operator who calls a job
*"Sideline Rabbitohs live watch"* is naming the agent because a scheduler config has nowhere
else to say whose errand it is — and the office has a character standing at the desk already
wearing that name. So the sidebar reads `Sideline Cruston · Rabbitohs live watch`, twenty-eight
characters instead of forty, while `origin.name` keeps the operator's words verbatim because
that is the fact and repeat runs of one job group by it.

**A job's `description` travels from `summary` up.** It is the operator's own answer to *why
this job exists*, which is exactly what a viewer wants and what the agent had to be asked for
in a chat window. It goes in `origin.detail` — and [spec §10](../protocol/aop-spec.md#10-privacy-and-redaction)
holds `detail` back at `metadata`, where `name` gets through. A description is an operator's
prose rather than a model's, which is a fair argument for letting it through too, but that is
an argument for changing that row of the spec and not for an emitter quietly disagreeing with
it. Left as the spec has it, and noted here as the open question it is.

## Identity resolution, and the latch that bit

The reader-facing rules are
[names, colours and faces](../../user/sources/openclaw-identity.md). Two implementation
facts belong here.

**The default agent is the load-bearing detail**, since it is the one whose workspace is
plain `workspace` rather than `workspace-<id>`. It is `main` unless an entry in
`agents.list` says `default: true`, and that constant is not an optimisation — inferring it
from the config was a bug worth naming, because `main` is the agent most likely not to be in
the config at all. Guessing "whichever is listed first" was wrong twice over: `main` was
looked for in a `workspace-main` that does not exist and turned up nameless, while whoever
happened to be listed first was handed `~/.openclaw/workspace` and read **Main's**
`IDENTITY.md`. Two agents wearing the wrong name each, from one guess.

Workspace paths follow OpenClaw's own rules, including the quirk that `OPENCLAW_STATE_DIR`
moves every agent's workspace **except** the default one, which moves with
`OPENCLAW_WORKSPACE_DIR`. `--status` resolves through the plugin's own `lib/identity.mjs`,
so it cannot politely disagree with the room.

**An identity belongs to an agent, not to a desk**, and this one has already gone wrong. The
bridge remembers who a session is so it is not re-reading files on every event, and the
first version of that remembering was a **latch**: the first agent a session record ever saw
got to name it, permanently. A session key handed out a second time, or a ghost respawned at
an address a previous one had, therefore turned up wearing the *previous* occupant's name,
shirt and face; the room filled with copies of whoever arrived first, and Bobster's work
appeared under Sideline's name.

The rule now is that the answer is kept beside the agent it was asked about, and a different
agent at the desk **drops all three fields together** — keeping any one of them is the same
bug, one field at a time.

The colour fitting itself, including the two approaches that produced a green charcoal and a
hot-pink oxblood, is in `src/agents/colour.js`.

## `session.start` waits, and that is not a bug

OpenClaw's session hooks do not know where they are: the context is
`{ agentId, sessionId, sessionKey }` and nothing else. Only the *agent* context carries
`workspaceDir`, and that does not arrive until the first turn.

Publishing immediately would file the session under no project at all — the office would
seat a character in the `default` room and then meet the same session again, with a real
project, in another. So the event is **held** until something knows a directory, then sent
ahead of it with its original timestamp intact.

[Rovo CLI](../adapters/rovo-cli.md) ends up in the same place for a different reason, and
[the spec](../protocol/aop-spec.md#7-loss-gaps-and-recovery) blesses it either way: a late
arrival beats a phantom. A session that ends without ever running a turn is still announced,
at the end, with no project — it existed, and it did nothing.

## Avatars: the bytes have to travel

The file is on the gateway and the office is a browser somewhere else, so there is nothing
to link to. The plugin reads it, hashes it, asks the office whether it already holds that
picture, and uploads only if not — so a gateway restart costs one small question per agent.
It never happens inside a hook, so an agent is never waiting on it.

`.svg` is refused on purpose: it is a document that can carry script, and the office would
be serving it from its own origin.

## Read next

- [Adapter notes §5](../protocol/aop-harness-adapters.md#5-openclaw) — the verified payloads, the publisher, and the WebSocket route
- [The AOP spec](../protocol/aop-spec.md) — the protocol itself
