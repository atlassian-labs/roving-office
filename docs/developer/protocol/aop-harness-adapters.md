# Emitting AOP from the five harnesses

Companion to [`aop-spec.md`](./aop-spec.md). This is the research: what each harness actually exposes today, which mechanism to use, and what the adapter looks like. Every claim is tagged **[verified locally]**, **[verified from source/docs]** or **[unverified]** — see the appendix for how.

Every source here is a harness on the user's own machine. [§6](#6-a-cloud-agent-is-not-a-harness) covers why a cloud agent is not one, and what would have to change for it to be shown in the room at all.

## 0. The headline

Four of the five harnesses (Claude Code, Codex CLI, Rovo CLI, Cursor) converge on the **same primitive**: *named lifecycle events that run a shell command with a JSON payload on stdin*. Two of them (Claude, Codex) have converged on almost the same event **names** as well. That means:

> One `aop-send` binary + one thin per-harness mapper covers Claude Code, Codex, Rovo and Cursor. OpenClaw is the odd one out: it has a real event bus, so it gets a long-lived bridge instead — which is strictly nicer.

That prediction now has three data points, and the last one is the interesting one. **Rovo CLI (§4), Claude Code (§2) and OpenClaw (§5) are all built.** The second hook harness cost one mapper plus one installer, and the shared adapter needed no changes at all to accept it — only the `hook_event_name` fallback it already had, and a `lib/tool-classes.cjs` split out of the first mapper once there were two.

OpenClaw then tested the other half of the prediction, that an event bus "gets a long-lived bridge instead — which is strictly nicer". It is nicer, and specifically in four ways that all follow from one difference: **a bridge is not dead between events.** It batches (eight parallel tool calls are one request, not eight), it retries in its own process rather than through a spool hand-off, it keeps its per-session state in memory rather than in a JSON file, and — the one that changes what the office can show — **it can heartbeat**. §6 says hooks "cannot heartbeat on their own (they are dead between events)" and that the receiver's TTL is therefore what retires characters; a bridge closes that gap.

What it did *not* need was a new transport. The bridge shares `bin/lib/aop-core.cjs` with the hook adapters — the endpoint, the project derivation, the redaction rules and the POST itself — and that shared file is where a real bug got fixed once instead of twice (§7.2).

Claude Code event names (verified in the installed 2.1.246 binary) vs Codex (verified in `codex-rs/hooks/src/lib.rs`):

| Claude Code | Codex CLI | Rovo CLI | OpenClaw (in-process) |
| --- | --- | --- | --- |
| `SessionStart` / `SessionEnd` | `SessionStart` / `SessionEnd` | — (derive from first event / `on_complete`) | `session_start` / `session_end` |
| `UserPromptSubmit` | `UserPromptSubmit` | — (derive from `on_tool_start`) | `before_agent_run` |
| `PreToolUse` / `PostToolUse` | `PreToolUse` / `PostToolUse` | `on_tool_start` / `on_tool_end` | `before_tool_call` / `after_tool_call` |
| `PermissionRequest` | `PermissionRequest` | `on_tool_permission` | **— none** (§5.2) |
| `Stop` | `Stop` | `on_complete` | `agent_end` |
| `SubagentStart` / `SubagentStop` | `SubagentStart` / `SubagentStop` | — | `subagent_spawned` / `subagent_ended` |
| `PreCompact` / `PostCompact` | `PreCompact` / `PostCompact` | — | `before_compaction` / `after_compaction` |
| `Notification`, `TeammateIdle` | — | `on_error` | — |

OpenClaw is in that table for the shape, not because it shares the mechanism: its hooks are function calls on an in-process bus, not shell commands with JSON on stdin. The names line up anyway, which is the same convergence the rest of the table shows.

The overlap is not a coincidence — Codex's hooks crate mirrors Claude's design — and it is why AOP's event vocabulary was chosen to sit *just above* this shared shape rather than inventing something orthogonal.

## 1. Capability matrix

| | Claude Code | Codex CLI | Rovo CLI | OpenClaw |
| --- | --- | --- | --- | --- |
| Push hooks (shell, stdin JSON) | ✅ 19 event names, 15 worth installing | ✅ 11 event names, 10 installed | ✅ 5 events (8 accepted) | ✅ **40 in-process hooks**, 10 installed |
| Works in the interactive TUI | ✅ | ✅ | ✅ | ✅ |
| Session visible before its first job | ✅ `SessionStart` at launch — but deliberately held, see §4.4 | ✅ `SessionStart`, also held until work | ⬜ first job only (§4.4) | ⬜ `session_start` fires, but carries no `cwd`, so it is deferred (§5.5) |
| Streaming event feed | ✅ `--output-format stream-json` (print mode only) | ✅ app-server JSON-RPC / exec-server | ✅ `rovo serve` SSE | ✅ WebSocket gateway |
| Subagent visibility | ✅ `SubagentStart/Stop`, `agent_id`, `agent_type` | ✅ `SubagentStart/Stop` | ⬜ no hook | ✅ `subagent_spawned/ended`, `childSessionKey`, `agentId` |
| Parent link (for ghosts, spec §6.1) | ✅ `parent_tool_use_id` | ◐ parent session yes, no spawning tool call | ⬜ | ◐ parent session yes, spawning tool call **inferred** (§5.5) |
| Permission/approval events | ✅ `PermissionRequest` | ✅ `PermissionRequest` | ✅ `on_tool_permission` | ⬜ **not via plugin** — WebSocket only (§5.2) |
| Heartbeat while idle | ⬜ dead between events | ⬜ | ⬜ | ✅ **it is a timer** (§5.6) |
| Says a turn has *parts* (spec §4.2) | ✅ `TodoWrite`, always whole | ✅ `update_plan`, always whole | ✅ `update_todo`, whole **or a merge by id** (§4.6) | ◐ a heartbeat is one, but needs §5.6 discovery |
| Packaged install (one command) | ✅ plugin + marketplace (a *copy*, §2.5) | ⬜ config.toml edit | ⬜ config.yml edit | ✅ plugin, installed as a **link** (§5.7) |
| Telemetry side-door | ✅ OTel (`CLAUDE_CODE_ENABLE_TELEMETRY`) | ⬜ | ⬜ | ⬜ |
| Run lifecycle needs an operator opt-in | ⬜ | ⬜ | ⬜ | ✅ `hooks.allowConversationAccess` (§5.3) |
| Best AOP level reachable | **L2** | **L2** | **L1** (L2 via bridge) | **L2**, minus permissions |

## 2. Claude Code

**Built.** `bin/mappers/claude-code.cjs` over the shared `bin/aop-send.cjs`, shipped as a plugin declared at the repo root (`.claude-plugin/plugin.json` + `hooks/hooks.json`) and installed by `bin/aop-claude-install.cjs` (`npm run connect:claude`). Fifteen hooks, L2, real ghosts.

**Mechanism: a plugin that ships hooks.** [verified locally]

Hooks are the right surface: they fire in interactive sessions (unlike `stream-json`, which is `--print` only), they are per-event, and they carry a rich payload on stdin. Shipping them as a **plugin** means a user installs the integration with one command instead of hand-editing settings.

### 2.1 Hook events available

All present in the installed binary, v2.1.246 [verified locally]: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `TeammateIdle`. Official docs list a wider set (`PostToolUseFailure`, `PostToolBatch`, `PermissionDenied`, `FileChanged`, `CwdChanged`, `StopFailure`, …) [verified from docs].

### 2.2 Payloads — captured, verbatim

Real stdin payloads from a probe session [verified locally]:

```json
{"session_id":"478c3346-…","transcript_path":"/Users/mike/.claude/projects/-Users-mike-dev-roving-office/478c3346-….jsonl","cwd":"/Users/mike/dev/roving-office","hook_event_name":"SessionStart","source":"startup"}
{"session_id":"478c3346-…","transcript_path":"…","cwd":"…","prompt_id":"d16102d1-…","permission_mode":"acceptEdits","hook_event_name":"UserPromptSubmit","prompt":"Run the bash command: echo hello-from-hooks…"}
{"session_id":"478c3346-…","transcript_path":"…","cwd":"…","prompt_id":"d16102d1-…","hook_event_name":"SessionEnd","reason":"other"}
```

So `session_id`, `cwd`, `permission_mode`, `prompt_id`, `hook_event_name`, `source`, `reason`, `prompt` are all confirmed present. `PreToolUse` adds `tool_name`, `tool_use_id`, `tool_input`; `PostToolUse` adds `tool_response`; subagent hooks add `agent_id` / `agent_type` [verified from docs, not captured locally — the probe session was unauthenticated so no model turn ran].

### 2.3 Mapping

| Hook | AOP | Notes |
| --- | --- | --- |
| `SessionStart` | `session.start`, **held** until the session does something | `payload.source` ← `source`; `session.cwd` ← `cwd`. Held because not every Claude session is a conversation — see §4.4 |
| `UserPromptSubmit` | `turn.start` | `turn_id` ← `prompt_id`; `title` ← Claude's generated session title when available — `payload.session_title` first, then the transcript's `ai-title` (`agent-name` fallback) — otherwise the first line of `prompt`, truncated |
| any event mid-turn | `turn.title` | Once per turn, when a title that opened as a quote of the prompt (or a bare `Working`) can be replaced by the generated one — see §2.4b |
| `PreToolUse` | `tool.start` | `tool_call_id` ← `tool_use_id`; `tool_class` from the table in §2.4 |
| `PostToolUse` | `tool.end` (+ `artifact.change` for `Write`/`Edit`) | `path` ← `tool_input.file_path` |
| `PostToolUse` of `TodoWrite` | `step.end` and/or `step.start`, **alongside** the `tool.end` | The list in `tool_input.todos` is this harness's only statement that a turn has parts. See §2.4a |
| `PostToolUseFailure` | `tool.end` | `status: error` |
| `PermissionRequest` | `permission.request` | `request_id` ← `tool_use_id` |
| `PermissionDenied` | `permission.resolve` | `decision: deny` |
| `Notification` | `notification` | `message` ← `message` |
| `Stop` / `StopFailure` | `turn.end` | `status: completed` / `error` |
| `SubagentStart` / `SubagentStop` | `session.start` / `session.end` with `session.parent_id` | `kind: subagent`, `agent_type` ← `agent_type`, `parent_tool_call_id` ← `parent_tool_use_id` → renders as a **ghost** at the parent's desk (spec §6.1). Held on the same rule as the main session, so a fan-out of subagents that do nothing renders as the one `Task` call it was |
| `PreCompact` / `PostCompact` | `context.compact` | `trigger` ← `trigger` |
| `TeammateIdle` | `session.heartbeat` with `status: idle` | Suppressed while a `session.start` is held: an idle timer is not work |
| `FileChanged` | `artifact.change` | `kind: file`, `path` ← `path` |
| `SessionEnd` | `session.end` | `reason` ← `reason`. Suppressed, along with the held `session.start`, if the session never did anything |

**As built**, three of those rows are deliberately *recognised but not installed* — `PostCompact`, `FileChanged` and (with `PostToolBatch` and `CwdChanged`) the rest of the wider set. Every hook is a process spawn on the agent's critical path, and each of these either duplicates an event already emitted (`PostCompact` after `PreCompact`, `FileChanged` after an `Edit`) or says something the next event says anyway (`CwdChanged`, since `project` is re-derived from `cwd` every time). The mapper handles them so that wiring one by hand behaves sensibly.

Two further decisions the sketch above did not anticipate, both from the mapper:

- **Tool events carrying `agent_id` are attributed to the subagent**, not to the parent, so a fan-out reads as five ghosts each doing their own thing rather than one character with five tool calls in flight. Turns, by contrast, always belong to the main session — a subagent never opens one.
- **`artifact.change` is only emitted on success**, and shell commands are read for what they produce: `git commit|push` → `kind: commit`, `git branch|switch -c` → `branch`, `gh pr create` → `pr`. A failed write changed nothing and must not walk to the outbox.

### 2.4a `TodoWrite` → steps

`TodoWrite` rewrites a whole todo list on every call, with exactly one item
`in_progress`. That is a `plan` and a `step.start` in the shape spec §4.2 asks for, and
and it was classed `other` and thrown away until the mapper learned better — the one signal this harness sends
about a turn having parts was the one signal the office ignored.

It stays `other` **as a tool**, because writing a list is desk work and moves nobody. The
steps are emitted *in addition to* the `tool.end`, not instead of it.

Three decisions worth knowing:

- **On `PostToolUse`, not `PreToolUse`.** Until the call returns the list is a proposal,
  and a part announced from a write that then failed is a part the agent never started.
  (Rovo has to do the opposite, and §4.6 says why.)
- **Ids are hashed from the item's text**, because Claude's todo items have none and
  their *position* is the one thing about a todo list that genuinely moves: an agent
  inserting a forgotten step at the top would otherwise renumber everything below it and
  the office would read that as five parts finishing at once.
- **The status a part ends in is read off the next list, not announced.** An item now
  `completed` finished; one still `pending` was **skipped**; one that has vanished was
  `cancelled`. That skipped/completed distinction is the entire reason to emit `step.end`
  here — without it, a part passed over looks exactly like a part done.
- **Except for the last part, which no list ever follows.** Reading the end off the
  *next* write works for every part but the final one, so the turn's own ending has to
  close it: `Stop`/`StopFailure` for Claude Code, `on_complete`/`on_error` for Rovo CLI,
  and `SubagentStop` for a ghost's own list. Skipping this cost nothing visible — the
  receiver clears the label at `turn.end` regardless — and lost every last part on the
  wire, along with its duration. One live session carried 192 events, a single
  `step.start` and not one `step.end`.
- **A part left `in_progress` at the end is genuinely ambiguous**, and nothing here can
  resolve it: the agent finished and did not tick it, or it stopped half-done. The
  turn's own status is the only evidence available, so a clean stop reads `completed`,
  an error reads `failed`, and a dead session reads `cancelled`.
- **None of this state outlives its turn.** The open part and the skip memory are reset
  when a turn starts, not when the session does — held per session, `activeId` survived
  into the next turn and its first list write closed a part belonging to the turn
  before, with a duration measured across the gap. A turn merely *re-announced* to a
  restarted receiver is not a fresh turn and resets nothing.

`activeForm` becomes the step `title` and `content` becomes the plan entry's, which is
the distinction the tool itself draws: a checklist reads as a list of things to do, and
the line naming what somebody is doing right now reads better in the other voice.

At `metadata` redaction the titles go and the counters stay, so the office says
"Step 2 of 5" (spec §10). A tool *name* is operator-authored and survives; a todo item
is a sentence the model wrote.

### 2.4b The generated title, and why it needs its own event [verified 2026-09-04, 2.1.260]

Claude writes a short model-generated name for every session — the one its terminal tab
shows, and the one a multiplexer like cmux picks up off the OSC title. It is a far better
desk label than a quote of the request: *"Cinematic office activity filming"* against
*"Create a work item to \"Make great movies\"… and then switch to the branch/work…"*.

It is offered in two places, and the adapter reads both:

- **`payload.session_title`**, on `UserPromptSubmit` and `SessionStart`. Free, and it
  cannot go stale.
- **`{"type":"ai-title","aiTitle":…}`** in the transcript, via the bounded tail read in
  §2.5's transcript note. This is the only source available on a tool event, which is
  precisely the moment that matters.

**The generation loses the race with the hook.** Measured on one session: the prompt
record at `03:12:24.476`, the `ai-title` record next, the first `assistant` text at
`03:12:27.142` — so a second or two after `UserPromptSubmit` has already returned. There
is no title to read when the turn opens, and there is no hook that fires when one lands.

Which leaves the first turn of every session opening under a quote of the prompt. It was
corrected at `turn.end`, which is right and far too late: a turn lasting an hour wore the
quote for the hour. So the adapter carries the debt on the session — a *provisional*
title — and discharges it on the next event of any kind, in practice the turn's first
tool call, with one `turn.title` (spec §4.2). The office renames the job in hand; no
second envelope arrives and no status changes.

Two bounds, because the fallback source is a file read on the agent's critical path:
a turn stops asking once it has been answered, and gives up after 8 events either way —
a `-p` run, or a transcript so long the last `ai-title` has scrolled out of the tail,
must not buy a read per tool call all turn. In the ordinary case exactly one read happens
and it succeeds.

**It is a session title, not a turn title.** Claude generates it once, from the first
prompt, and repeats the same string for the rest of the session, so this upgrade names a
session's *opening* job and the later ones inherit it — which is what the receiver's
`startsNewJob` already prefers for follow-up turns. Per-job naming would need the office
to summarise, and it deliberately never does (spec §4.2).

### 2.4 Tool → `tool_class`

`Read`/`NotebookRead` → `read` · `Grep`/`Glob`/`ToolSearch` → `search` · `Write`/`Edit`/`NotebookEdit` → `edit` · `Bash`/`BashOutput` → `execute` (but `git commit|push`, `gh pr` → `scan the command and emit scm`) · `WebFetch`/`WebSearch` → `network` · `Task` → `agent` · `mcp__*` → `knowledge` · anything else → `other`.

As built, the exact table lives in the mapper and the *guesses* live in `bin/mappers/lib/tool-classes.cjs`, shared with Rovo. That split is deliberate: tool **names** are per-harness, but the reasoning about an unfamiliar name is not — `mcp__…` is a knowledge lookup and `git push` is delivery whoever called them. Every harness permanently has an unknown-tool problem (MCP servers, plugins, new built-ins), so two copies of those regexes would have diverged the first time one was improved.

### 2.5 Plugin shape [as built, verified on 2.1.246]

The sketch was a separate `roving-office-plugin/` directory with its own copy of the adapter. What shipped instead: **the repo itself is the plugin**, because the files a plugin needs are files the repo already has.

```
the-roving-office/
├── .claude-plugin/plugin.json      # { "name": …, "version": "0.1.1" — bumped every change }
├── .claude-plugin/marketplace.json # one entry, "source": "./" — so the repo is its own marketplace
├── hooks/hooks.json                # 15 events → the host-selecting wrapper
├── bin/aop-plugin-hook.sh          # chooses Claude or Codex, then calls the launcher
├── bin/aop-node.sh                 # finds a Node, execs the adapter (§2.7)
└── bin/aop-send.cjs                # the shared adapter, already here for Rovo
```

Each of the fifteen commands is the host-selecting wrapper:

```
"${CLAUDE_PLUGIN_ROOT}/bin/aop-plugin-hook.sh"
```

The wrapper chooses `claude-code` here and `codex-cli` under Codex, then calls
`aop-node.sh` and the shared adapter. That avoids a second manifest and a second
copy of the adapter, either of which would drift. `${CLAUDE_PLUGIN_ROOT}` resolves
to the plugin root in both hosts, so `bin/` and `bin/mappers/` come along for free.

**No event-name argument** in the command: Claude puts `hook_event_name` in the payload, which `aop-send` already falls back to, so one command string serves all fifteen events.

Confirmed by `claude plugin details roving-office`:

```
Hooks (15)  SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure,
            PermissionRequest, PermissionDenied, Notification, Stop, StopFailure,
            SubagentStart, SubagentStop, PreCompact, TeammateIdle, SessionEnd
            (harness-only — no model context cost)
Projected token cost   Always-on: ~0 tok
```

Zero tokens matters more than it looks: watching an agent must not change what the agent does, and a hooks-only plugin adds nothing to the model's context.

#### Three measured behaviours that shaped the installer

1. **`claude plugin install` copies the plugin.** The installed tree lands in `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` and the registry records a `gitCommitSha`. So a plugin install is a **snapshot**: editing a mapper in the checkout changes nothing until `claude plugin marketplace update <name> && claude plugin update <plugin@market>`. This is exactly the sort of thing that costs an afternoon, so `aop-claude-install.cjs --status` diffs the files that matter (`aop-send.cjs`, `lib/aop-core.cjs`, the mapper, `lib/tool-classes.cjs`, `lib/event-shape.cjs`, `aop-plugin-hook.sh`, `aop-node.sh`, `hooks.json` and `plugin.json`) against the snapshot and says so out loud.

   **And that refresh only works if the version moved** [verified 2026-08-28]. The cache path is keyed on the version and `plugin update` compares versions, not contents: offered the version it already holds, it reports success and fetches nothing. A snapshot pinned at `11b9463` sat 43 commits behind a checkout that had said `0.1.0` throughout, and `marketplace update && plugin update` — the command above, run twice — refreshed the marketplace record and left `installed_plugins.json` untouched at `lastUpdated` 2026-08-27. The registry is where you see it: `gitCommitSha` still yesterday's. Hence the working agreement to bump `.claude-plugin/plugin.json` on every plugin-affecting change, `--status` treating a version mismatch as stale whatever the files say, and the escape hatch when someone forgets: `claude plugin uninstall <plugin@market> && claude plugin install <plugin@market>`, which forces a fresh copy at the same version.
2. **Claude runs every matching hook**, not just the first — the opposite of Rovo (§4.1). The installer therefore *adds* itself as its own group beside whatever is already configured and never edits anyone else's entry, and there is no `--chain` in the Claude path at all. Proved by installing beside a pre-existing `PreToolUse`/`PostToolUse` hook on this machine and watching both survive, with their matchers untouched.
3. **Which is also the trap.** Two active routes (plugin *and* settings hooks) mean every event is sent twice, with the same `tool_call_id`. The installer refuses to create that state and names the command that fixes it.

So there are three install routes, and they are not redundant:

| Route | Command | Trade |
| --- | --- | --- |
| marketplace | `/plugin marketplace add https://therovingoffice.com/plugins/claude/marketplace.json` | Needs no checkout, no Git and no npm — a zip pinned to its SHA-256. But a snapshot, and third-party marketplaces have auto-update off by default |
| plugin | `npm run connect:claude` | One command, path-independent — but a snapshot, and it only exists on machines with a checkout |
| settings | `npm run connect:claude:settings` | Live: an edited mapper applies to the next tool call — but the absolute path is stored verbatim, so moving the checkout breaks it |

`--project` writes `.claude/settings.local.json` rather than `settings.json`: the command holds an absolute path to one machine's checkout, which is precisely what must not be committed for a teammate to inherit.

The first route is what `npm run pack:plugins` builds — `bin/aop-plugin-pack.cjs`, which generates the hosted marketplace JSON and the archive it pins, and proves the artifact runs from a temp directory with no checkout above it. A URL-hosted marketplace **cannot** use the `"source": "./"` that `.claude-plugin/marketplace.json` carries, since there is no checkout on the far end for `./` to resolve against; and Codex has no archive source at all, so its published marketplace has to be a repository. Both, and what is still missing before either is live, are in [publishing the plugins](../plugin-distribution.md).

### 2.6 Alternatives considered

- **`stream-json`** — richest feed by far: `--output-format stream-json` plus `--include-hook-events`, `--include-partial-messages`, `--forward-subagent-text`. Confirmed message families in the binary: `stream_event`, `tool_progress`, `thinking`, `task_started`, `task_completed`, `agent_progress`, `compact_boundary`, `hook_started`, `hook_response` [verified locally]. But it only exists in `--print` mode, so it cannot see the interactive sessions we most want to watch. Use it for a **replay/demo mode**, not the live path.
- **OTel** — `CLAUDE_CODE_ENABLE_TELEMETRY=1` with `claude_code.tool_decision`, `claude_code.tool_result`, `claude_code.session.start`, … [OTEL_* env vars verified locally in the binary; event names verified from docs]. Attractive because it needs no plugin, but it is metrics-and-logs shaped, batched on an export interval, and has no per-tool-call correlation id worth the trouble. Interesting as a *second* source for a team-wide office, not for v0.
- **Transcript tailing** — every hook payload hands us `transcript_path`. A long-lived `tail -f` remains too fragile for event detail, but the adapter now makes one narrow use of the file: a bounded, best-effort tail read for Claude's repeated `ai-title`, with `agent-name` only as a fallback. That priority matters because a user/custom agent name can change to an operational label while `ai-title` keeps describing the job. It never reads a path outside `~/.claude/projects/`, and metadata redaction skips the read entirely. `payload.session_title` says the same thing for free where it exists and is preferred; the read covers the events it does not ride on — see §2.4b.

### 2.7 Claude Desktop: the same harness, a different PATH [verified 2026-08-27]

Claude Desktop is not a fifth harness. Its **local agent mode** is this one: the app downloads a real claude-code (`~/Library/Application Support/Claude/claude-code/2.1.246/`) and drives it over the SDK, writing transcripts into the same `~/.claude/projects/` as a terminal session. Its work happens in a git worktree it cuts itself, at `<repo>/.claude/worktrees/<slug>` on branch `claude/<slug>`, which the adapter's git lookup resolves to the parent repo's remote — so the session lands in the right office with no special handling.

**Cowork is a different animal, and §2.8 is about why.** Do not read the rest of this section as covering it: the two look identical in the UI and share nothing below it.

Sessions are told apart by `CLAUDE_CODE_ENTRYPOINT`, exported into every hook's environment, whose value is the same one the transcript records as `entrypoint`. The mapper turns it into the `harness.variant` of spec §4.7, so the office can say "Claude Code - Desktop" rather than filing three different things under one name:

| `CLAUDE_CODE_ENTRYPOINT` | `harness.variant` | who |
| --- | --- | --- |
| `cli` | `cli` | a terminal session |
| `claude-desktop` | `desktop` | Claude Desktop's local agent mode |
| `sdk-cli` | `sdk` | a programmatic SDK run, `claude -p` among them |

Reading the env var rather than the transcript matters: the transcript would cost a file read on every hook to learn a fact that cannot change within a session.

Two things about the spawn are worth knowing, both read out of the app bundle: it passes `settingSources: ['user']`, so `~/.claude/settings.json` — and the `enabledPlugins` in it — is read, while *project* and *local* settings are not; and it adds its own in-process SDK hooks, which sit alongside ours rather than replacing them. A plugin install therefore reaches Cowork; a `--settings --project` install does not.

**And yet it emitted nothing.** Every `claude-desktop` session was missing from the office while every `cli` session arrived. The cause is not Claude at all:

```
$ ps eww -p $(pgrep -f 'Claude.app/Contents/MacOS/Claude') | tr ' ' '\n' | grep ^PATH=
PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

A hook inherits the environment of the process that started the agent. A terminal session inherits a login shell, where a version manager has put `node` on PATH. A GUI application is started by **launchd**, whose PATH is the five directories above — and nvm, fnm, volta and asdf all install Node under `$HOME`. So `#!/usr/bin/env node` exits 127, every one of the fifteen hooks fails, and nothing says so, because a non-blocking hook's failure is not the agent's problem:

```
$ echo '{"hook_event_name":"SessionStart",...}' \
    | env -i PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin HOME=$HOME \
      ~/.claude/plugins/cache/roving-office/roving-office/0.1.0/bin/aop-send.cjs claude-code
env: node: No such file or directory     # exit 127
```

`git` survives this (it is `/usr/bin/git`); Node is the only casualty.

**Fix: `bin/aop-node.sh`.** Every hook command now names the launcher, which finds a Node in the places a version manager actually puts one, caches the answer in `~/.roving-office/node-path`, and `exec`s it. `npm run connect:claude:status` reports what a GUI session would resolve, because a status that only proves the terminal case proves the easy half.

The general lesson for the harnesses still to be built: **a GUI-launched harness gets launchd's PATH**, so any adapter invoked as a bare interpreter shebang works in a terminal and fails in an app. OpenClaw (§5) turns out to be immune for a structural reason rather than a lucky one: its adapter is a plugin loaded *into* the Gateway's own Node process, so there is no interpreter to find and no PATH to inherit. The problem is specific to spawning a shell command per event, which is exactly what a bridge does not do.

### 2.8 Cowork: out of reach, because it is not on this machine [verified 2026-08-27]

Cowork looks like local agent mode and is nothing like it. **It runs claude-code inside a Linux VM**, so no host-side hook can observe it and §2.7's fix does not apply. The evidence, while a Cowork task was running:

```
~/Library/Application Support/Claude/
├── vm_bundles/claudevm.bundle/
│   ├── rootfs.img        10 GB, written continuously during the task
│   ├── sessiondata.img
│   ├── vmIP              172.16.10.3
│   └── .cowork-adopted
└── claude-code-vm/2.1.246/claude      # a second copy, for the guest

$ ps ax | grep Virtualization
… com.apple.Virtualization.VirtualMachine     # live, Apple Virtualization.framework
```

The giveaway is where the session is *not*. A Cowork prompt never appears in `~/.claude/projects/`, and the host's `claude-code-sessions/` and `local-agent-mode-sessions/` were weeks stale while the VM images were being written by the minute. The prompt text is inside `rootfs.img` — the guest's filesystem — and nowhere on the host.

Three things block an office feed, and none is a bug:

1. **The adapter is not in the guest.** Our plugin lives in the host's `~/.claude/plugins/`; the guest has its own `$HOME` and has never heard of it.
2. **The endpoint is not in the guest.** `~/.roving-office/endpoint.json` carries the URL and token, and it is a host file. A guest hook would not know where to post or how to authenticate.
3. **~~The receiver would refuse it anyway.~~** This one has since dissolved. It read: `isLocal()` in `server.cjs` accepts only `127.0.0.1` and `::1`, and the guest is NAT'd behind gVisor, so a packet from the VM would arrive — if at all — from a non-loopback address. The receiver no longer gates on the network at all (§7.1): ingest needs a per-office write token, and where it came from is not the question being asked. The routing is still against you, since the host cannot even ping the guest, but the *policy* is not.

So supporting Cowork is a feature, not a repair — but a smaller one than it was. The adapter still has to be installed *into the guest image* and an endpoint published *into* the guest; what is no longer needed is teaching the receiver to trust a named subnet, because it now trusts a token instead. The security decision that used to be attached to this — "the token is protected by nothing but the loopback check" — was made for its own reasons in §7.1, and the guest would present a write token like any other remote emitter.

Until then, the honest position is that Cowork sessions are invisible to the office, and a Cowork user seeing an empty room is seeing the truth.

## 3. Codex CLI

**Built.** `bin/mappers/codex-cli.cjs` over the shared `bin/aop-send.cjs`, shipped
as `.codex-plugin/plugin.json` with the common `hooks/hooks.json`, and installed
by `bin/aop-codex-install.cjs` (`npm run connect:codex`). Ten installed hook
events, plans as steps, patches as artifacts and real subagent ghosts.

**Mechanism: a plugin that ships hooks.** [verified from the official hook
contract and installed Codex 0.151.0]

The shared fields are `session_id`, `transcript_path`, `cwd`,
`hook_event_name` and `model`; turn hooks add `turn_id`, and tool hooks add
`tool_name`, `tool_use_id`, `tool_input` and, after the call, `tool_response`.
That is close enough to Claude for the Codex mapper to be a normaliser around
the Claude state machine rather than a second copy of it. `Bash`,
`apply_patch`, `update_plan`, `request_user_input`, `spawn_agent` and
`view_image` are renamed before mapping. The plan array is reshaped into the
shared todo-step dialect; the first touched patch path is extracted without
retaining patch contents.

The shared manifest also contains Claude-only names. Codex's `HookEventsToml`
deserialiser ignores those unknown event keys, while Claude continues to load
them, so one file preserves the richer Claude feed. `bin/aop-plugin-hook.sh`
chooses `codex-cli` when Codex's `PLUGIN_ROOT` is present and `claude-code`
otherwise.

Two limits are structural. Codex has `PermissionRequest` but no resolution hook,
and no notification or idle-heartbeat hook, so those capabilities are not
declared. Hosted `WebSearch` is not exposed to tool hooks either. The legacy
`notify` key is therefore no longer used: it would reduce a full lifecycle feed
to one `agent-turn-complete` message for no benefit.

`PostToolUse` carries Bash's model-facing output but not its exit status, so a
quiet failure and a quiet success are indistinguishable; the mapper reports
completion without guessing from text. Subagent hooks carry `agent_id` and
`agent_type`, but no parent tool-call id. They still make a real ghost under the
parent session, just not one bound to the exact `spawn_agent` invocation.

Hooks are trusted per command in `/hooks`. An administrator can set
`allow_managed_hooks_only = true` in `requirements.toml` and exclude this local
plugin; the installer checks the known policy locations and warns rather than
claiming a silent install is healthy.

**Streaming alternatives** [verified from source, schemas unverified]: the `app-server` JSON-RPC protocol (`codex-rs/app-server-protocol`, what IDE clients use) and `exec-server` notifications `ExecOutputDeltaNotification`, `ExecClosedNotification`, `ExecExitedNotification`. A long-lived app-server bridge is probably the best Codex integration eventually; it is more work than hooks and the protocol is not documented publicly yet.

## 4. Rovo CLI

**Built.** `bin/aop-send.cjs` + `bin/mappers/rovo-cli.cjs`, installed by `bin/aop-rovo-install.cjs`. Two mechanisms exist and the recommendation is still **both**, but hooks turned out to reach further than this document first assumed — and to carry three constraints it did not know about.

### 4.1 Push: `eventHooks` in `~/.rovo/config.yml` [verified on 202608.25.1]

```yaml
eventHooks:
  logFile: /Users/mike/.rovo/event_hooks.log
  events:
  - name: on_tool_start
    commands:
    - command: /path/to/bin/aop-send.cjs rovo-cli on_tool_start
```

**Eight event names, not five.** Beyond `on_tool_start`, `on_tool_end`, `on_tool_permission`, `on_complete` and `on_error`, the CLI's own binary registers `on_session_start`, `on_user_prompt` and `on_session_end`. Rovo accepts all eight in config, and `on_session_end` was observed firing. So Rovo is **not** confined to implicit spawn and TTL reaping: in an interactive session it gives an explicit `session.start`, a real `turn.start` and a clean `session.end`, which is a *complete* L1 rather than the partial one predicted here. (An earlier draft called this L2. It isn't — [§9](aop-spec.md#9-conformance-levels) puts `artifact.change`, `context.compact`, `notification`, `permission.resolve` and `job.*` at that level, and Rovo has hooks for none of them. What changed was the floor, not the ceiling.)

**The payload, captured verbatim:**

```json
{
  "session_id": "b2b5e280-8b50-45d8-9346-7a3c2fa96774",
  "transcript_path": "/var/folders/…/T/tmpa0_pvr2_/message_history.json",
  "cwd": "/Users/you/src/roving-office",
  "timestamp": "2026-08-26T13:40:08.084525+00:00",
  "hook_event_name": "on_session_end",
  "attributes": {}
}
```

Flat and consistent across events. `attributes` is empty for the session-scoped events and carries the interesting part for the rest — **captured from a live interactive session**, since tool hooks fire nowhere else:

| Event | `attributes` |
| --- | --- |
| `on_session_start`, `on_session_end` | `{}` |
| `on_user_prompt` | `{ user_prompt }` — note the name, not `prompt` |
| `on_tool_start` | `{ tool_calls: [ { tool_name, tool_args, tool_call_id } ] }` |
| `on_tool_end` | `{ tool_results: [ { tool_name, tool_call_id } ] }` |
| `on_tool_permission` | `{ tool_name }` |
| `on_complete` | `{ summary }`, sometimes `{}` |

**Those are arrays, and that matters.** Rovo batches parallel tool calls into a *single* hook event, so four files read at once arrive as one `on_tool_start` with four entries. The mapper emits one `tool.start` per entry, flagged `concurrent` (spec §4.3) — one event per entry, not one per hook, or the office loses three quarters of the activity and can never balance its `tool.end`s.

Earlier drafts of this adapter guessed a flat `{ tool_name, tool_call_id, args }` and shipped every tool as `tool_class: other` until real traffic proved otherwise. The flat shape is still accepted as a fallback, and payload *shapes* — keys and value types, never string contents — keep being recorded to `~/.roving-office/shapes-rovo-cli.ndjson`, so the next drift shows up as data rather than as a bug.

Five hard constraints. The first two were known; the rest cost an evening:

1. **Always exit 0.** Rovo *disables* an event hook that exits non-zero — a failed POST would silently uninstall the integration.
2. **Budget ~10 s max** and spool on failure rather than retrying inline.
3. **Only the first `command` of an event actually runs.** The `/hooks` help implies commands run in parallel; they do not. Verified twice — an appended second command never executed and never appeared in Rovo's own `event_hooks.log`, while a sole command on a fresh event did. An installer must therefore *take* the first slot and re-run what it displaced itself, which is what `aop-send --chain '<command>'` is for. Appending politely means never being called at all.
4. **`eventHooks` is read once, at session start.** There is no hot reload, so a freshly installed hook does nothing for sessions already running. Installers must say so or people will conclude the office is broken.
5. **Hooks are a TUI-session feature.** They do not fire under `rovo serve` at all, and in headless `rovo run` only the session-scoped ones fire — a `run` that demonstrably executed a shell tool produced `on_session_end` and no `on_tool_start`. Any attempt to capture tool payloads has to happen in a real interactive session.

Mapping, as implemented:

| Rovo hook | AOP |
| --- | --- |
| `on_session_start` | `session.start`, `source: startup`, with `capabilities` |
| `on_user_prompt` | `turn.start` — Rovo's generated session title when available, otherwise `user_prompt`; only when redaction ≥ `summary` |
| `on_tool_start` | one `tool.start` **per batched call** (+ synthesised `turn.start` if none is open) |
| `on_tool_end` | one `tool.end` per result, with `tool_class`/`duration_ms` recovered from adapter state |
| `on_tool_permission` | `permission.request` — no tool name available |
| `on_complete` | `turn.end` status `completed` |
| `on_error` | `error`, then `turn.end` status `error` |
| `on_session_end` | `session.end`, reason `exit` |

Any event naming a session we have not seen still emits an explicit `session.start` first, with `source: attach` — cheaper for the office than inferring, and the only place the adapter gets to declare its `capabilities`.

**A receiver that has restarted is told the turn as well.** The endpoint file carries the receiver's pid, so a changed `pid@url` means an office with an empty replay buffer that has never heard of us. Re-announcing `session.start` is not enough on its own: the office names a session and labels its desk from `turn.start.title`, and the title of a turn already in flight exists nowhere but in the adapter. A session mid-job would otherwise sit there nameless for as long as the job lasts — an hour of tool calls, with the one prompt that could have named it already gone. So a remembered title is repeated to the new receiver, using the same `turn_id` because it is the same turn. If the reintroduction happens to coincide with a prompt, only the new prompt's turn is sent; and a title we never heard (hooks installed mid-turn, or an upgrade mid-turn) stays `Working`, which the office knows to leave unnamed rather than name badly. `Working` is provisional like any other placeholder, though, so such a turn takes Claude's generated title the moment §2.4b can find one — a mid-turn arrival is named on its next tool call rather than staying anonymous to the end.

**Rovo subagents ghost, but on a guess.** Rovo has `invoke_subagents` and no subagent lifecycle hooks, so a fan-out would otherwise read as one busy character. When the tool arguments name the subagents, the mapper emits **synthetic** ghost sessions — `session.id = <parent>:<tool_call_id>:<index>`, `parent_id` set, `kind: subagent`, `agent_type` from the name — and dissolves all of them on the matching `on_tool_end`. They carry `ext.synthetic: true` so the office can render a guess more faintly than the truth. This depends on `subagent_names` surviving into the hook payload, which is exactly the unverified part.

### 4.2 Closed: hook payload field names [was blocker #3]

Fully closed, by installing the adapter and reading what a real interactive session sent (§4.1). Every envelope field and every `attributes` key is now verified first-hand rather than inferred.

The one field deliberately unused is `transcript_path`: the file is deleted when the turn ends. The useful title lives elsewhere: Rovo writes the concise heading shown in its own session list to `~/.rovo/sessions/<id>/metadata.json`. The mapper reads that file best-effort at `on_user_prompt` and `on_complete`; the latter matters because title generation can lose the race with the prompt hook, and lets the receiver retitle the one completed history entry instead of logging a second job.

Two things still worth knowing. `on_tool_permission` carries only `tool_name` — no target, no reason — so the office can say *"waiting on you, about bash"* and no more. And `on_complete` is inconsistent about `summary`: the one real sample so far arrived as `{}`, so a turn may end with a status and nothing to say. The generated session title is the label to rely on when it exists, with the prompt as the first-hook fallback. And `on_error`'s payload has never been observed, because nothing errored during the probes; the mapper reads `error`/`error_message`/`message`/`reason` and falls back to a bare `"Error"`.

### 4.3 Pull: the `rovo serve` API [verified locally]

`rovo serve <PORT>` runs a FastAPI app — this is what the Rovo web GUI talks to. Two SSE endpoints matter, and both were captured live:

`GET /v3/agent_lifecycle_events` — "Stream lifecycle events from agent runs":

```
event: agent_run_start
data: {'timestamp': 1787746794.056015, 'session_id': '2b169249-…'}

event: agent_run_end
data: {'timestamp': 1787746802.550284, 'session_id': '2b169249-…', 'task_status': 'TASK_COMPLETED'}

: ping - 2026-08-26 12:20:07.011522+00:00
```

⚠️ Note the **single quotes**: that `data:` line is a Python dict repr, not valid JSON. An adapter must parse it leniently (or we file a bug — this looks like an accidental `str(dict)` instead of `json.dumps`).

`GET /v3/stream_chat` — per-turn streaming, captured event names: `user-prompt`, `part_start`, `part_delta`, `request-usage`, `close`. Part kinds from the OpenAPI schema: `text`, `thinking`, `tool-call`, `tool-return`, `builtin-tool-call`, `builtin-tool-return`, `user-prompt`, `system-prompt`, `retry-prompt`, `file`. `ToolCallPart` = `{ tool_name, args, tool_call_id, id, provider_name, provider_details, part_kind }`; `ToolReturnPart` = `{ tool_name, content, tool_call_id, metadata, timestamp, part_kind }`.

Also useful: `GET /v3/sessions/list`, `GET /v3/sessions/current_session`, `GET /v3/status` (`cliVersion`, `workingDirectory`, `account`, `model`, `sessionFilepath`), `GET /v3/tools`, `GET /healthcheck`, `POST /shutdown`. Auth is HTTP Bearer, disableable with `--disable-session-token`.

Mapping: `agent_run_start` → `turn.start`, `agent_run_end` → `turn.end` (`task_status: TASK_COMPLETED` → `completed`), `tool-call` part → `tool.start`, `tool-return` part → `tool.end`, `request-usage` → `usage` on the next `turn.end`.

Re-probed while building the hooks adapter, on 202608.25.1: the lifecycle stream still emits single-quoted Python dict reprs, `stream_chat` still names its frames `user-prompt` / `part_start` / `part_delta` / `request-usage` / `close`, and one frame name not previously recorded showed up — **`on_call_tools_start`**. Tool calls appear as `part_kind: tool-call` with a real `tool_name`, which is exactly the field hooks are cagey about.

**Recommendation:** hooks for the everyday case (they work in the normal TUI, no extra process), plus an optional `serve` bridge for a richer feed when the user is happy to run `rovo serve`. The bridge is also the natural place to prototype AOP changes, because it is a normal long-lived process with real JSON.

One caveat now measured: **`serve` fires no event hooks at all**, so the two mechanisms do not double-count. They are alternatives, not overlapping feeds, and a future bridge can run alongside the hooks without de-duplication work.

### 4.4 When a session becomes visible [verified 2026-08-27]

**Rovo announces itself at the first job, not at launch.** A Rovo CLI sitting at a fully rendered prompt is invisible to the office — its desk stays empty until you ask for something. Claude Code is the opposite, firing `SessionStart` with `source: startup` the moment it opens.

Measured two ways:

- **Idle launch.** A Rovo CLI started in a repo and left untouched at its prompt for 14 seconds produced *no events at all*; the receiver's cursor never moved. The TUI had fully rendered — suggestion chips, input box — so this is not a boot race.
- **Live traffic.** Across four independent sessions, `on_session_start` is followed by `on_user_prompt` within **54–1063 ms** every time, which is the signature of a hook firing with the first prompt rather than at REPL open. For contrast, two Claude sessions on the same day reached the office with a `session.start` and *no* turn at all, having been opened and never given work.

Upstream this looks deliberate rather than broken: Rovo ties `on_session_start` to session-with-history creation, and its release notes show those semantics being tuned — `fix(core): ensure on_session_start hook fires for new sessions with empty history`, and `docs(event-hooks): clarify on_session_start behavior`. There is no REPL-open hook to subscribe to. `on_ready` and `on_exit` do exist in the installed bundle, but they belong to the Agent Client Protocol, not to event hooks.

**Why the adapter does not paper over it.** With no launch event there is no `session_id`, so a character invented at launch could never be reconciled with the real session once it arrives: you would get a phantom at launch and a second character at the first job, and AOP has no identity-merging semantics to join them. A late arrival beats a ghost. The fix belongs upstream — fire at REPL open, or add a launch hook.

**And Claude's eagerness turned out to be the worse of the two problems** [measured 2026-08-27, 2.1.246]. In one afternoon of ordinary local use, **15 of 20 sessions** in `~/.roving-office/state-claude-code.json` reached the office with `seq = 2` — a `session.start` and a `session.end`, nothing between, often less than a second apart. Each one spawned a character who rode the lift up, walked in, and left again, spending a lift cycle and one of the room's first names to say nothing.

They are not conversations. **14 of the 15 never wrote a transcript file at all**, which is the clearest signal available that no model turn ever ran: title generation, background tasks and the desktop bridge each open a session the same way a terminal does. Nothing on the payload distinguishes them — `source` is `startup`, `cwd` is the repo, and `transcript_path` is set on every one of them, pointing at a file that is never created.

So the adapter **holds** `session.start` in its state file until an event arrives that proves the session is real, and holds a subagent's the same way. The held introduction keeps the `source` and timestamp it had, so a session that eventually types something is still announced as the `startup` it was, at the moment it began — nothing is renamed `attach` for having been patient. `TeammateIdle` and `SessionEnd` are suppressed while an introduction is held, since a heartbeat and a farewell are both meaningless for a session the office never heard of.

The upshot is that **both harnesses now become visible at their first sign of life**, by opposite routes: Rovo because it has no launch event to offer, Claude because its launch event does not mean what it appears to. The cost is that a terminal opened and left at an empty prompt has no character until it is used, which is the same trade this section already documents for Rovo — and unlike a phantom at launch, it needs no identity merging to resolve.

### 4.5 Payload shapes, as recorded [closes open item 3]

The shape recorder was built on the assumption that this undocumented contract would drift. It did — though not in the direction expected. Rovo emits **more than one shape per hook**, and §4.2 documented only one of each:

| Hook | Documented in §4.2 | Also observed in live traffic |
| --- | --- | --- |
| `on_user_prompt` | `{ user_prompt }` | `{ prompt }` |
| `on_tool_start` | `{ tool_calls: [ { tool_name, tool_args, tool_call_id } ] }` | flat `{ tool_name, tool_call_id, args: { … } }` |
| `on_tool_end` | `{ tool_results: [ { tool_name, tool_call_id } ] }` | flat `{ tool_call_id, status }`, and bare `{ tool_call_id }` |

Note `args` rather than `tool_args`, and `prompt` rather than `user_prompt`: the same field under two names, in the same CLI version.

**Nothing needed fixing**, which is the interesting part. `argsOf` already reads `args` alongside `tool_args`, `pick` already reads `prompt` alongside `user_prompt`, `toolEntries` already falls back to treating `attributes` as a single flat entry, and `entryId`/`status` already cover the shortened `on_tool_end` forms. The fallback chains absorbed a real contract change without a line of code — which is the argument for writing them even when a single shape has been "verified", and the argument for recording shapes as data rather than trusting a comment.

The lesson for the other harnesses: treat every §*.2 payload block as *one observed shape*, not *the* shape.

### 4.6 `update_todo` → steps, and why it fires at the *start*

Rovo's `update_todo` is nearly Claude's `TodoWrite` under another name — a list with one
item `in_progress` — and it maps through the same shared module
(`bin/mappers/lib/todo-steps.cjs`). Two differences, both of which had to be built:

**`merge: true` means the update is not the list.** The tool takes a merge flag, and with
it an update carries only the items that changed and only the fields that changed —
`{id: 1, status: "completed"}, {id: 2, status: "in_progress"}`, not a word of text.
Claude's `TodoWrite` has no such flag and Codex's `update_plan` sends the whole plan, so
the shared module had been written to assume a rewrite. Replayed against a three-part
checklist walked by merges, that assumption was wrong three ways at once:

| What the agent did | What the office was told |
| --- | --- |
| ticked off part 1, took up part 2, ids only | **nothing at all** — no `step.end`, no `step.start`, part 1 still on the desk label |
| the same, with the text carried | `2 of 2` and a two-item checklist, for a list of three |
| the same again | part 1 `cancelled` — struck through and *remembered* that way |

None of the three is a rendering fault, and none of them would show up as an error: the
office drew exactly what it was told, confidently. The fix is to hold the list per turn
on the emitter and apply the update to it, so absence means "unchanged" under a merge and
only a replacement can drop a part. The held list is cleared at `turn.start` with the
rest of the todo state, which matters more than it looks — Rovo's ids restart at 1 each
turn, so a list carried across the boundary would take the next turn's first merge onto
the last turn's parts.

**Its todo items carry their own `id`, and integers.** The text-hashing Claude needs is
unnecessary here — but a `typeof id === 'string'` test had been quietly sending every Rovo
item to the hash anyway. Two costs, one of them the reason merges can work at all: an
id-and-status update has nothing *but* the id to be matched on, and a hash is a hash of
the wording, so an agent rewording an item mid-turn read as a part abandoned and another
started. Rovo answers the question; take its answer.

One difference, and it is forced rather than chosen: the steps are emitted from
**`on_tool_start`**, where Claude uses `PostToolUse`. Rovo's `on_tool_end` carries
`tool_results` and no arguments, so the list only exists at the start of the call. The
cost is announcing a part from a call that could still fail, which for a local list
rewrite is close to never — and a part announced a moment early beats the whole checklist
being invisible, which is what it was before.

A batch containing `update_todo` alongside other calls still reports every one of them:
the steps ride along with the `tool.start` they came from, and do not displace it.

## 5. OpenClaw

**Built.** `openclaw-plugin/` — an in-process plugin, not a hook adapter — installed by `bin/aop-openclaw-install.cjs` (`npm run connect:openclaw`), or packed for a Gateway on a server by `bin/aop-openclaw-pack.cjs` (`npm run pack:openclaw`) and installed there against a freshly minted office by `bin/aop-openclaw-server.sh`, which ships beside the tarball. Ten hooks, L2 minus permissions, real ghosts, and the first thing here that can heartbeat.

```
openclaw-plugin/openclaw.plugin.json   manifest: id, activation.onStartup, configSchema
openclaw-plugin/package.json           openclaw.extensions -> ./index.mjs
openclaw-plugin/index.mjs              entry: registers the hooks, wires the two below
openclaw-plugin/lib/map.mjs            OpenClaw hooks -> AOP (the mapper)
openclaw-plugin/lib/publisher.mjs      queue, batch, retry, heartbeat, spool (the bridge)
openclaw-plugin/lib/shared.mjs         the one file that reaches into bin/ (§5.7)
bin/lib/aop-core.cjs                   shared with the hook adapters (§7.2)
bin/aop-openclaw-pack.cjs              vendors + tarballs it for a server (§5.7)
```

Repo `github.com/openclaw/openclaw`, docs `docs.openclaw.ai`, config `~/.openclaw/openclaw.json` (JSON5, hot-reloaded).

### 5.1 Verified from the package, not the prose [verified 2026-08-29 on 2026.7.1-2]

The previous version of this section was written from `docs.openclaw.ai` and carried a list of hook names with **unverified** field types. That list was close but not right, and the way to settle it turned out to be cheap: `npm pack openclaw` ships `dist/*.d.ts` **and** the whole `docs/` tree. So the contract below is read from the type declarations, not from a web page.

`dist/hook-types-*.d.ts` defines a `PluginHookHandlerMap` of **40** hooks. The ten worth installing, with their real payload fields:

| Hook | Payload | Context |
| --- | --- | --- |
| `session_start` | `{ sessionId, sessionKey?, resumedFrom? }` | `{ agentId?, sessionId, sessionKey? }` |
| `session_end` | `{ sessionId, sessionKey?, messageCount, durationMs?, reason?, sessionFile?, nextSessionId? }` | same |
| `before_agent_run` | `{ prompt, messages, systemPrompt?, accountId?, channelId?, senderId?, senderIsOwner? }` | `{ runId?, agentId?, sessionId?, sessionKey?, workspaceDir?, modelProviderId?, modelId?, trigger?, … }` |
| `agent_end` | `{ runId?, messages, success, error?, durationMs? }` | agent context |
| `before_tool_call` | `{ toolName, params, runId?, toolCallId?, toolKind?, derivedPaths? }` | `{ …, toolName, toolCallId?, runId? }` |
| `after_tool_call` | `{ toolName, params, runId?, toolCallId?, result?, error?, durationMs? }` | tool context |
| `subagent_spawned` | `{ childSessionKey, agentId, label?, mode, requester?, threadRequested, runId, resolvedModel?, resolvedProvider? }` | agent context |
| `subagent_ended` | `{ targetSessionKey, targetKind, reason, runId?, outcome?, error? }` | agent context |
| `before_compaction` | `{ messageCount, compactingCount?, tokenCount?, sessionFile? }` | agent context |
| `after_compaction` | `{ messageCount, tokenCount?, compactedCount, previousSessionId? }` | agent context |

Three corrections to what the earlier draft claimed, each of which would have cost a debugging session:

- The subagent hooks are **`subagent_spawned` / `subagent_ended`**, not `subagent_start` / `subagent_stop`.
- Registration is **`api.on(name, handler, { priority?, timeoutMs? })`**, and an operator can override the budget per hook with `plugins.entries.<id>.hooks.timeouts.<hookName>`.
- `session_end`'s `reason` is a **nine-member enum** — `new | reset | idle | daily | compaction | deleted | shutdown | restart | unknown` — which collapses onto AOP's seven. `shutdown` and `restart` fire from the Gateway's shutdown finalizer for sessions still live when the process stops, which is exactly the case that would otherwise leave characters in the room forever.

### 5.2 There is no permission hook, and that is the one real loss

The plugin route **cannot see approvals**. OpenClaw's flow runs the other way: a plugin *asks* for approval by returning `requireApproval` from `before_tool_call` (`docs/plugins/plugin-permission-requests.md`), and there is no hook for observing the approvals core raises for its own `exec` tool.

That is worse than it sounds by count, because spec §4.4 calls `permission.request` the single most valuable non-L0 event — the only reliable signal that an agent is *waiting on you*. So `CAPABILITIES` in `lib/map.mjs` deliberately omits it, which is what stops the office waiting for an event that will never come, and an OpenClaw agent blocked on an approval looks like an agent thinking hard.

**The Gateway WebSocket is the fix, and it is an increment rather than a redesign.** `127.0.0.1:18789`, protocol v4, connected with `role: "operator"`, streams `agent` (`runId`, `status`, `stream: lifecycle|assistant|tool`, `phase: start|end|error`), `session.message`, `session.operation`, `session.tool`, `session.observer`, `sessions.changed` (with `activeRunIds`), `exec.approval.requested` / `.resolved` (`approvalId`, `toolName`, `params`), plus `presence`, `health`, `tick`. Mapping: `sessions.changed`/`activeRunIds` → `session.start`/`session.end`, `agent` with `stream: lifecycle` → `turn.start`/`turn.end`, `session.tool` → `tool.start`/`tool.end`, `exec.approval.requested`/`.resolved` → `permission.request`/`permission.resolve`, `health`/`tick` → `session.heartbeat`. `lib/publisher.mjs` is transport-only and would be reused unchanged; only a new mapper is needed. [from docs, unverified]

**And the plugin never returns a decision.** Several of these hooks are decision hooks — a return value can block a call, rewrite its params or demand approval. Every handler returns `undefined`, always, and the test harness asserts it on every fire. A diorama does not get a vote on whether a tool call happens. This is the one rule in the plugin that is not a trade-off.

### 5.3 The permission that is not optional [verified 2026-08-29, on a real Gateway]

**`before_agent_run` and `agent_end` do not fire** for a non-bundled plugin unless an operator sets `plugins.entries.<id>.hooks.allowConversationAccess = true`. They are *conversation hooks*, gated along with `llm_input`, `llm_output`, `before_model_resolve`, `before_agent_reply` and `before_agent_finalize` (`docs/gateway/configuration-reference.md`).

This is the one thing the type declarations could not have told us, and it took a real install to find. It is worth writing down carefully, because every part of it is a trap.

**The block is invisible from inside the plugin.** `api.on('before_agent_run', …)` succeeds. No throw, no return value, no diagnostic the plugin can observe. The handler is simply never called. The only evidence is host-side, in `openclaw plugins inspect <id> --runtime --json`:

```
"level": "warn",
"message": "typed hook \"before_agent_run\" blocked because non-bundled plugins must set
            plugins.entries.roving-office.hooks.allowConversationAccess=true"
```

**And it took the whole adapter down, not two events.** A plain chat turn — the first thing anyone tests — fires `session_start`, `before_agent_run`, `agent_end` and nothing else. No tools, no subagents, no compaction. Those two hooks were also the only carriers of `workspaceDir` (§5.5), so §5.5's deferred `session.start` was waiting for a directory that could never arrive. Net effect: an install that reported `status: "loaded"`, `activated: true`, eleven hooks registered, and published **nothing at all**.

Three changes came out of it, and the ordering matters — the first is the fix, the other two are why the failure was silent:

1. **Grant it at install.** `bin/aop-openclaw-install.cjs` sets the key, with `--no-conversation-access` to decline. A permission that a document tells you to set by hand is a permission half the installs will not have.
2. **Say so when it is missing.** The plugin cannot see the block, but it can read the same config the host reads, so `register` checks `api.config.plugins.entries[id].hooks.allowConversationAccess` and warns at startup naming the key. Detecting an invisible failure indirectly is worth more than the code it costs.
3. **Degrade instead of dying.** Sessions, tools, subagents, compaction and heartbeats do not need conversation access. Only the desk *label* and turn timing do. So `session.start` no longer waits on a directory that may never come — see §5.5 — and a blocked install now loses labels rather than everything.

**What it grants is narrower than its name.** Those hooks carry `prompt` and `messages`. The mapper reads the prompt, clamps it to `CAPS.title` (80 characters) for a desk label, and drops it entirely under `metadata` redaction. `messages` is never read. That asymmetry is worth stating in the docs, because "allow conversation access" sounds like far more than one truncated line.

There is a **non-gated alternative that was deliberately not used**: `before_agent_start` carries the same `prompt` and the same agent context, and is absent from the gated list. It is documented as "compatibility-only — prefer the two hooks above", so building on it would mean depending on a deprecated path to route around a permission the operator is entitled to withhold. Declining it, warning clearly and degrading well is the more honest arrangement. Worth revisiting only if the gate turns out to be commonly refused. [unverified: whether `before_agent_start` really escapes the gate in practice]

### 5.4 A silent emitter is the hardest kind, so this one talks

Three failures on the first real install, and **none of them produced an error anywhere**. A blocked hook that registers cleanly and never fires. An artifact that installs and is not the one that runs. An endpoint that is simply absent, which is indistinguishable from an idle agent because both look like an empty queue.

The pattern is worth naming, because it is a property of emitters generally rather than of OpenClaw: **a fire-and-forget adapter has no natural failure channel.** Design rule 1 says never make the agent wait, and the price of obeying it is that nothing downstream can report back. Two mitigations, both cheap:

- **Say what you are doing, when you load.** One line naming the resolved endpoint, whether it is remote, and which of the three sources it came from. Logged from `register`, deliberately not from `gateway_start` — a plugin installed or reconfigured on a running Gateway never sees another `gateway_start`, which makes that hook precisely the wrong home for the one line that says whether the thing can work.
- **Infer what you cannot observe.** The plugin cannot see that a hook was blocked, but it can read the same config the host read to block it. It cannot see that its artifact is stale, but the version is stamped into it. Neither is a real error channel; both turn a silence into a sentence.

**A status code does not say who answered, and that is usually the question.** The first real
refusal came back `403`, which reads as an auth failure and is not one: the receiver's ingest
returns `401` for a bad token and never returns `403` at all, so a `403` is proof that
something *between* the agent and the office answered — a WAF, or an egress proxy — and no
amount of correcting the token or the keycard would have helped. The office replies JSON and a
WAF replies HTML, so `core.post` now reads the first 300 characters of a failing response and
the warning quotes it back. Per-status guidance follows the measurements rather than the HTTP
spec: `401` and `502` mean the token (`502` because the hosting edge replaces the receiver's
`401`), `404` means the keycard, and `403` means *ask the network*, with the decisive next
step — the same POST by `curl` from the same host — named in the log line itself.

That is also why the emitter now sends a `User-Agent`. Node sends none by default, and an
anonymous POST with no UA is a normal thing for a WAF to refuse.

And **an absent office is a warning, not a note.** It had been logged at `info`, which on a busy Gateway is the same as not logging it. A plugin that cannot publish is not configured differently, it is broken.

That also changed `core.post`'s contract: it now resolves `{ ok, status, reason }` rather than a bare boolean, so a refusal can be reported as `HTTP 403` — check the token — rather than as an event that quietly never arrived. `401`/`403` point at the token and `404` at the keycard, which between them cover most of what goes wrong once the endpoint is set at all. It complains **once per outage** and reports recovery, because a wrong token would otherwise write a line every few seconds forever, and an operator being shouted at continuously is one who stops reading.

### 5.5 Two payload facts that shaped the mapper

**`session_start` does not know where it is.** Its context is `{ agentId, sessionId, sessionKey }` — no `cwd`, no `workspaceDir`. Only the *agent* context carries `workspaceDir`, and that does not arrive until the first turn. Publishing `session.start` immediately would file the session under no project at all, so the office would seat a character in the `default` room and then meet the same session again, with a real project, in another.

So `session.start` is **deferred** — but only while a better answer is actually coming, which is a distinction §5.3 forced. It is held until an event knows a directory, then emitted ahead of it with its original timestamp intact. If no run hook will ever fire (conversation access refused), there is nothing to wait for, and the mapper publishes immediately against a fallback workspace resolved the way OpenClaw resolves `agents.defaults.workspace`. Both halves are load-bearing, and each was briefly wrong on its own: deferring unconditionally published nothing at all for a chat session, and publishing unconditionally sent `session.start` stamped with the fallback moments before the real directory arrived — seating one session in two rooms, which is the exact phantom the deferral exists to prevent. Rovo CLI lands in the same behaviour from the opposite cause — it has no launch event at all (§4.4) — and spec §7 blesses it either way: a late arrival beats a phantom. A session that ends without ever running a turn is still announced, at the end, with no project.

**`parent_tool_call_id` has to be inferred.** Spec §4.1 wants a ghost bound to the exact `agent`-class tool call that spawned it, so the office can dissolve every straggler when that call ends. Claude Code hands it over as `parent_tool_use_id`; OpenClaw does not. The mapper tracks the last `agent`-class tool call per session — which is what `subagents` is — and uses that. Correct for the ordinary case and wrong if two `subagents` calls overlap, which is a knowingly accepted approximation rather than an oversight.

### 5.5a A routing key is not a name [verified 2026-08-29, from live traffic]

The first thing anybody said about the working bridge was that the names were wrong. They were: every character in the room wore

```
agent:albus:telegram:direct:12345
```

because `session_start` carries a `sessionKey` and the mapper sent it as `session.label`. Two mistakes in one line, and the second is the interesting one. A `sessionKey` is an **address** — agent, channel, chat type, chat id — so it is a plausible-looking identifier and no kind of name. And `label` is the office's *override*: the field an adapter uses to say "this session is called X", which suppresses the whole naming pipeline. So the room did not merely read badly; nobody ever picked up a job surname either, because a harness-set name is never second-guessed. One wrong field cost both halves of the mechanic.

**What OpenClaw actually has is better than any other harness.** Its agents are configured by hand, and the config names them:

```jsonc
"agents": { "list": [{ "id": "albus", "identity": { "name": "Albus Dumbledclaw" } }] }
```

`api.config` is already on the plugin API — the same object §5.3 and §5.4 read for the conversation gate and the workspace fallback — so the lookup is local, synchronous and needs no new permission. `agentId` → `agents.list[].identity.name`, falling back to `agents.list[].name`, resolved with OpenClaw's own id normalisation (trim, lower-case, per `dist/config-utils-*.js`). The result goes in the new [`session.actor`](./aop-spec.md#32-session), which means *who is running this* rather than *what this is called*.

**And then the real config settled the design question.** The first cut took a first name from the identity and went on generating the job surname, on the theory that the office's best idea should keep working. Six real agents said otherwise:

```
Guy Fawkes · Albus Dumbledclaw · Paige Turner · Sideline Cruston · Florence Nightingclaw
```

Every surname is the punchline. `Paige Docs-Verifier` throws away *Turner* and puts our own gag in its place, which is the office talking over the person who set the room up. So the rule went by word count instead: **two or more words are kept whole and permanently**, `namedFrom: 'actor'` freezing them against the job-driven rename; **one word is a first name** and still earns a job, so `Bobster` becomes *Bobster Flaky-Mender*. Worth the note because the mechanic looked like the thing to protect right up until the data arrived — the office's naming is only good while it is not overwriting somebody.

Three details that are easy to get wrong:

- **The id is never used as a name.** `albus` happens to read like one; `code-reviewer` and `main` do not, and defaulting to the id would fill a room with characters called Main. No identity configured means a generated name, which is what every other harness gets.
- **The identity arrives late, and that is normal.** `agentId` is on the *agent* context, so a session's first event can be anonymous and its second one Albus — the same asymmetry that defers `session.start` in §5.5. The office adopts a late actor by renaming the character: a whole name replaces theirs outright, a single word changes only the person and the job carries on.
- **The resolver is injected, not imported.** The mapper takes a function; `index.mjs` closes over `api.config`. So the mapper is testable without an OpenClaw, and a config reloaded under a long-lived gateway is picked up without re-registering hooks.

### 5.5b The config was the wrong file [verified 2026-08-29]

§5.5a read `agents.list[].identity.name` and called that "the only place a display name exists". It is not, and it is not even the good one. Every OpenClaw workspace holds an **`IDENTITY.md`**, written by the agent itself during the bootstrap conversation:

```markdown
- Name: Bobster
- Creature: Lobster
- Emoji: 🦞
- Colour: #c1440e
```

The config block is a label somebody typed once; this is the file the agent maintains about itself. And crucially, it is where the **default agent's** name lives — `main` usually has no `identity` block in config at all, and is usually the busiest desk in the building, so a config-only bridge leaves the most important character in the room anonymous. Name resolution is now `IDENTITY.md` → `identity.name` → `name` → the id if it reads as a word, which is where **Main** comes from.

Four things this cost, all of them the kind that only show up against real files:

- **The bold runs through the colon.** The shipped template writes `- **Name:** Claw`, so a regex that treats `**` as a wrapper around the *key* leaves the closing pair at the head of the value, and every agent in the office is called `** Something`. Found by a test against three real files, not by reading the template.
- **An unfilled field is a trap.** `- **Name:**` is followed by `_(pick something you like)_` on its own line. Read values on the same line only, and reject `_(…)_`, or a fresh workspace produces a colleague called *(pick something you like)*.
- **The rest of the file is prose, and prose contains colons.** These files run to essays — priorities, communication style, a line reading `**Never guesses people's names:** ask instead`. Only the first match for a key counts, and only bullet-shaped lines qualify.
- **`OPENCLAW_STATE_DIR` does not move the default agent's workspace.** Every other agent's hangs off the state dir; the default agent's comes from `resolveDefaultAgentWorkspaceDir`, which goes straight to `~/.openclaw` and honours `OPENCLAW_WORKSPACE_DIR` instead. Copy the asymmetry rather than tidying it, or you read the wrong file on exactly the machines that configured anything. With `agents.defaults.workspace` set, non-default agents are in a **subdirectory named after the id**, not `workspace-<id>`.

The reader caches on mtime, since it is called on the way to publishing an event and a gateway runs for weeks: one `statSync` per event is affordable, re-reading an essay is not, and an edited `IDENTITY.md` is still picked up without a restart.

### 5.5c Clothes as identity [verified 2026-08-29]

`IDENTITY.md` sometimes carries a `Colour`, and it turns out to be worth more than decoration. Office shirt colours are drawn from a palette on arrival, which means they are pleasant and mean nothing — the same agent is a different colour every restart. A colour from an identity is stable, so it becomes the thing you actually recognise: the agent in rust is always that agent.

Two decisions are load-bearing:

- **Send it as written; resolve it in the office.** `#c1440e`, `teal`, `rgb(193 68 14)`, `hsl(20 87% 41%)` — the office has a browser and an adapter does not, so the functional forms are parsed by assigning them to a canvas `fillStyle` and seeing whether it took, which is parsing and validation in one step. Doing it with **two** sentinels is what makes that honest, since one cannot distinguish "rejected, so unchanged" from "accepted, and equal to the sentinel". Hex is done arithmetically instead: it is the commonest case by far, and routing it through a canvas would have made the whole module untestable outside a browser for no gain.
- **An unreadable colour is not an error.** `Colour: lobster red` is a mood; the palette answers and nothing anywhere special-cases a failure. The detail panel then shows a **Colour** row *only* when a colour was chosen and parsed, which makes the panel a debugging tool: no row means the field did not take.

### 5.5d Real colours are not colours [verified 2026-08-29, against a live Gateway's config]

The `Colour` field above was built against a hex, and then six real agents were asked what they had written in theirs:

```
Rich red / crimson · Bright tangerine / golden-orange · Blue
Warm library yellow / marigold · Lavender / healthcare purple · Field green / pitch green
```

**Five of the six resolved to nothing**, and the sixth was worse: `Blue` is a CSS keyword, so it resolved to `#0000ff` — a saturated primary in a room whose sixteen shirts are all muted mid-tones, which reads as a rendering fault rather than a choice. A canvas is a *colour* parser, and nobody writes colours.

Three findings came out of fixing it, in ascending order of usefulness.

- **Vocabulary is a solved problem, and not by an LLM.** `color-name-list` (MIT, 31,915 names) contains `rich red`, `field green`, `pitch green`, `tangerine`, `marigold`, `golden orange`, `stormy sea`, `oxblood` and `burnt sienna` as literal entries. Filtered to names of ≤ 2 words containing a colour term it is 12,005 entries and 237 KB, vendored as `src/agents/colour-names.js` by `bin/gen-colour-names.mjs` — pinned, so no dependency and no fetch at runtime — and **imported dynamically**, so an office with no described colours in it never loads the table at all.
- **Finding a colour is the easy half; making it wearable is the point.** Every naming source, LLMs included, answers with the *ideal*: `crimson` is `#8c000f` (nearly black), `marigold` `#fcc006` (a highlighter), `blue` `#0000ff`. So the match is projected into the lightness and chroma range the palette actually occupies — measured off those sixteen shirts, not chosen — keeping the hue, which is the part a description is about.
- **The colour space decides whether that works.** The first attempt clamped S and L in HSL and was comedy: `charcoal grey` came out **green** and `oxblood` came out **hot pink**, because HSL's axes are not independent. In OkLab it behaves, and a near-neutral keeps its chroma rather than acquiring a hue out of rounding noise — so charcoal stays grey.

Two smaller rules earned their place on real data. Matching prefers the phrase that explains a **whole segment**, or `Warm library yellow / marigold` matches `yellow` (one word of three) and Paige gets olive. And modifier words are applied as adjustments — `deep`, `muted`, `pale` — but skipped when the matched name already contains them, or `deep teal` is deepened twice.

**On using OpenClaw's own model to guess a hex**, which is the obvious idea: no. A hook may never await, so it could only run once at register time; it would be non-deterministic across restarts; it would help one harness out of four; and per the second finding it would return the same fire-engine `#DC143C` a table does, so it does not even solve the problem. The *useful* version of the idea costs nothing: the agent already wrote the file, so a hex **anywhere** in the line is honoured exactly — `Colour: Rich red / crimson (#b03a3a)` — words for the reader, hex for the office. Document that and the model does the work at authoring time.

### 5.5e Avatars: the bytes have to travel [verified 2026-08-29]

`IDENTITY.md` often carries an `Avatar`, and three of the six real agents had one. It is the only identity field that cannot simply be *read*: the file is on the gateway's disk and the office is a browser elsewhere, so there is nothing to point at until the picture has been moved.

- **Content-addressed, both ends.** The plugin hashes the bytes and `PUT`s them to `/aop/v0/avatars/<sha256>` ([spec §5.7](./aop-spec.md#57-avatars-put-aopv0avatarssha256)); the receiver verifies the hash before storing, which is what turns an address into a claim it can check. Idempotence falls out of it, so a restarted gateway offers its avatars again — `HEAD` first — and nothing moves.
- **Never in a hook.** `urlFor(file)` is synchronous and answers only from what has already been uploaded, starting the upload in the background when it cannot. Which makes `actor_avatar` the latest-arriving identity field: named late, adopted late, exactly like `actor` and `actor_color` before it.
- **The type is sniffed, never asserted, and SVG is refused.** The office serves these from its own origin, so a document that can carry script is not a portrait. PNG, JPEG, GIF, WebP; 2 MB cap.
- **The path is relative to more than one thing.** `avatars/x.jpg` is relative to the workspace when it came from `IDENTITY.md` and arguably to `agentDir` when it came from the config block. Both are tried, first hit wins — no rule for an operator to have followed.

The picture goes in the detail panel rather than on the character: at the scale a name tag is legible, a face is four pixels.

### 5.5f A cache of who somebody is, is a latch [verified 2026-08-29, from a live gateway]

All of §5.5b–e shipped and the room filled with copies of one agent: four identical Sidelines, Bobster's work under Sideline's name, and `main` anonymous. Four symptoms, and the interesting part is that they came from two mistakes, both of them the same shape — **an answer about one agent, kept somewhere that outlives the question**.

**An identity resolved once is not a cache, it is a latch.** Looking up a name means config and a `statSync`, and this runs on every event, so of course it is remembered. But it was remembered *per session record* and guarded with `if (!s.actor)`, which quietly means "the first agent this record ever saw gets to name it, permanently". Session records outlive occupants: `childSessionKey` is a routing address that OpenClaw hands out again, and `subagent_ended` is the hook least likely to fire. So the second ghost at an address wore the first one's name, colour and face, and no event could correct it. The fix is not more invalidation but a different question — not "do we know who this is" but "do we know who this is *now*" — so the answer is stored beside the agent id it was asked about, and a mismatch drops all three fields at once. Dropping two of three would be the same bug with a longer tail.

**A subagent's `agentId` is not evidence that it is a different agent.** OpenClaw runs helper threads *as* the spawning agent and reports that agent's id, so `identityFor(event.agentId)` faithfully named every helper after its parent. That is where the four Sidelines came from — and the guard has to survive the child's own hooks, which will `learn` the same id a moment later and re-adopt what was just declined. Hence a flag on the session rather than a decision at spawn time: some sessions have no identity of their own, and that is a fact about them, not a step in a sequence.

**And a default that is inferred is a default that is wrong.** `agents.list` has no entry for `main` on a normal install — that is the entire reason §5.5b reads `IDENTITY.md` first — so "the default agent is whichever entry says `default: true`, else the first one listed" mis-crowned the first-listed agent. That single fallback produced two wrong answers: `main` was looked for in a `workspace-main` that does not exist, and the first-listed agent was handed `~/.openclaw/workspace` and read Main's `IDENTITY.md`. OpenClaw's default agent id is a constant, so it is a constant here.

The lesson that generalises past this plugin is the fourth one: **none of this was diagnosable.** Nothing said which file an identity had been read from, so telling a latched identity from a mis-resolved workspace from a missing file was pure inference. Both fixes for that are one line each — a gateway log line per agent, re-printed if the answer ever changes, and a `Cast:` table in `--status` that resolves through `lib/identity.mjs` so it cannot disagree with the room. An adapter that maps *identity* should be able to say who it thinks everybody is, out loud, without a browser.

### 5.6 What being long-lived actually buys

All four of these are unavailable to a hook adapter, and all four fall out of the same fact: the bridge is still running when the next event arrives.

| | Hook adapter | This bridge |
| --- | --- | --- |
| Eight parallel tool calls | eight processes, eight POSTs | one batch, one POST |
| Retry | spool + a detached sender, at-least-once | in-process, in order, at-most-once |
| Per-session state | `~/.roving-office/state-<harness>.json` | memory |
| Idle session | office reaps it on a TTL | `session.heartbeat` every 15s |

The heartbeat is the one that changes what the room can show. §7 notes that hooks "cannot heartbeat on their own (they are dead between events)" and concludes that v0 should just rely on the receiver's TTL. A Gateway that is already running does not have that problem, so an OpenClaw session sitting quietly for an hour between prompts keeps its desk.

The rule it must still obey is **design rule 1**, and being in-process makes it easier to break, not harder: OpenClaw *awaits* hook handlers. A handler that awaited a 900ms remote POST would make every tool call 900ms slower. So `publish()` is synchronous — envelope, push, arm a timer, return — and the network only ever happens on the timer. Measured in the harness: ten events queued in 2–3ms against an office deliberately answering in 900ms, delivered as one request.

### 5.7 Installed as a link, deliberately

`openclaw plugins install` accepts `clawhub:`, `npm:`, `npm-pack:`, `git:`, a local path, and `--link <path>`. We link, for two reasons.

The plugin **shares `bin/lib/aop-core.cjs`** with the hook adapters, so a copy of `openclaw-plugin/` alone would not carry it. And a copy is a snapshot — precisely the trap §2.5 documents for the Claude plugin, where install copies the repo to a version-keyed cache and `plugin update` compares versions to decide whether to re-copy, so a change that does not bump the version is a change no session ever runs. **A link has no snapshot, so it cannot go stale, and there is no version ritual to forget.** Given how much of §2.5 is spent on that ritual, this is the more interesting half of the comparison.

The price is that the checkout has to stay put — the same deal §4.1 already strikes by baking an adapter path into a config file. `--status` prints the linked path and says so if it no longer points at this checkout.

**And a Gateway on a server has no checkout to link to**, which the first draft of this section quietly ignored. `bin/aop-openclaw-pack.cjs` (`npm run pack:openclaw`) closes it: a tarball installable with `openclaw plugins install npm-pack:<file>`. The interesting part is the seam. Rather than regex-rewriting import paths at pack time — which works until someone adds a third import and does not notice — the plugin reaches outside itself in exactly **one** file, `lib/shared.mjs`, whose whole job is to be that seam. The packer vendors `aop-core.cjs` and `tool-classes.cjs` into `vendor/` and replaces that single file; every other file in the artifact is byte-identical to the checkout, so an artifact can be reviewed by diffing it against `openclaw-plugin/`.

Two guards, because the failure mode is remote and misattributed — a Gateway logging a module-not-found at startup looks like OpenClaw's fault:

- **The audit.** Every relative specifier in the staged tree is resolved, and two things fail the build (exit 1, not a warning): one that escapes the package, and one that resolves to a file the artifact does not contain. Both confirmed by deliberately breaking them and watching it refuse.

  The second half was added after it was needed. `FILES` is a hand-written list, a new `lib/avatar.mjs` was not added to it, and the audit passed — because its one regex looked for `import` or `require` followed by a quote, which is *not* what `import { x } from './y.mjs'` looks like. The form the plugin is almost entirely written in was the form it never checked, so the only thing that caught the missing module was `--verify` actually running the artifact, and the message was a Node stack trace. Three patterns now, and a missing file is reported as a missing file.
- **`--verify`.** It extracts the tarball to a temp directory with no checkout above it, registers the plugin against a stub `api`, drives a session and asserts the envelopes — because a vendored file can be *present* and still be the wrong one. It is what the default `npm run pack:openclaw` runs.

The honest cost is that a packed install is a **copy**, so §2.5's staleness trap returns by the other door: the version is stamped from `package.json` for traceability, but a server runs the copy it has until someone replaces it. Link where you can, pack where you must.

The manifest is required even with no config (`docs/plugins/building-plugins.md`), and `activation.onStartup: true` is what makes a hook-only observer load at all. One deliberate deviation: the entry is a **plain default export** rather than a call to `definePluginEntry`. Read at 2026.7.1-2 that helper is a pure normaliser returning `{ id, name, description, configSchema, register }`, and it defaults `configSchema` to a *strict empty object schema* — which would reject the very config this plugin needs. Importing it would buy nothing but a bare `openclaw` specifier that a linked directory outside the OpenClaw install cannot reliably resolve. The plugin therefore has **zero dependencies and no build step**.

### 5.8 Double counting: half-built, and honest about which half

OpenClaw wraps Claude Code and Codex, so a machine with this plugin *and* our Claude plugin can show the same work as two characters.

The emitter half is done: `harness.name = "openclaw"` always, and `ext.wrapped_harness` when configured with `plugins.entries.roving-office.config.wrappedHarness`. It has to be **told** rather than sniffing, and that is the honest position — nothing in the hook payloads names the wrapped harness. `modelProviderId` is the provider (`anthropic`), not the harness, and inferring `claude-code` from it would be wrong for every session where OpenClaw drives Anthropic directly.

The receiver half — de-duplicating on `session.cwd` + overlapping time when two harnesses report the same `project.repo.commit` — is **not built**. Until it is, `wrappedHarness` is a declaration waiting for a reducer, and the practical mitigation is to run one adapter or the other. This is the one open item that was supposed to be settled *before* the plugin shipped (§7 item 6); it shipped first because the emitter side is what the office needs in order to have anything to de-duplicate.

## 6. A cloud agent is not a harness

Every adapter above rests on the same premise: a process on the user's own machine that
will run a shell command, or an in-process bus an adapter can register on. A **cloud**
coding agent — one that takes a work item and returns a pull request, without ever
touching your laptop — has neither. There is no config file to edit and no process that
will execute anything on an adapter's behalf, so every mechanism in this document is
unavailable, and the only route left is something server-side posting to a published
office directly.

That is worth writing down rather than leaving as an omission, because three of the
adapter contract's assumptions turn out to be load-bearing only for local harnesses, and
anything running in the cloud breaks each one:

- **No `.git`, so no project.** §7 step 4 derives the office from the nearest ancestor
  `.git` and `git remote get-url origin`. Something with no working directory has to be
  handed a repository URL instead, canonicalised to `host/owner/repo` by exactly the same
  rules — or one repository lands in two different rooms depending on where the work
  started.
- **No redaction of ours.** Spec §10 is enforced in the adapter. A source that posts to
  the office itself sends whatever its author configured, so the redaction contract moves
  into whatever template does the posting, and that template should therefore be
  metadata-only.
- **No loopback.** A cloud service cannot reach `127.0.0.1`, so this is the first source
  that *requires* a published office (§7.1) rather than merely tolerating one.

Beyond that, nothing general can be said: whether a given product exposes a subscribable
event stream at all, what an integration may post, and when it knows enough to post it,
are questions about that product rather than about AOP. Settle them against the product —
and with whoever owns it — before writing an adapter, or before writing anything more
specific here.

## 7. The shared adapter

`bin/aop-send <harness> [event-name]` — one script (Node, no deps, or plain `bash` + `curl`), used by all three hook-based harnesses:

1. Read stdin (raw JSON payload), never block on an empty stdin.
2. Resolve the endpoint — `AOP_URL`/`AOP_TOKEN` if set, else `~/.roving-office/endpoint.json`; **if neither, exit 0 immediately.**
3. Normalise: pick the mapper by `argv[1]`, derive `type` and `payload`, apply the redaction rules and truncation caps from spec §10.
4. Derive `project` per spec §3.4.1: nearest ancestor `.git`, `git remote get-url origin` canonicalised to `host/owner/repo`, current branch into `repo.branch`. The canonical form is what goes in `repo.remote` as well as what picks the office — the raw `get-url` output may carry a `userinfo` credential and MUST NOT be sent (spec §3.3, §10). Worktrees deliberately collapse onto the repo's office. Honour `ROVING_OFFICE_SCENE` by stamping `project.scene`. Cache the whole lot in `~/.roving-office/project-cache.json` keyed by `cwd` — do **not** shell out to git on every hook, and version the entries, or a cache written before a field was narrowed keeps serving the old one.
5. `POST` NDJSON, gzip if > 4 KiB — inline against a loopback office (connect 0.5 s, total 1 s), or spooled and handed to a detached sender against a remote one (§7.1).
6. On any failure, append to a capped spool file and exit 0. The bridge (or the next successful call) drains it.
7. `exit 0`. Always. Under every circumstance.

Plus one long-lived **heartbeat/reaper** helper: hooks cannot heartbeat on their own (they are dead between events), so the receiver's TTL logic (spec §7.4) is what retires characters — or a tiny daemon `aop-heartbeat` pings for sessions it has seen recently. Given the office reaps on its own, v0 should just rely on TTL.

**As built** (`bin/aop-send.cjs`, zero dependencies, Node — same runtime the office already needs). All seven steps above hold, with four additions the plan did not anticipate:

- **`--chain '<command>'`.** Re-runs a displaced hook with the same stdin, detached, before we do anything else. Forced by Rovo's first-command-only behaviour (§4.1) and useful anywhere a harness gives one slot per event.
- **A hard watchdog.** `exit 0` after 2.5 s no matter what state the process is in, on top of the per-request timeouts. Belt and braces, because the failure mode is someone's agent appearing to hang.
- **Per-session state** in `~/.roving-office/state-<harness>.json`: `seq` counters, whether a turn is open, and in-flight tool calls, so `tool.end` can still report a name, class and duration when the harness only sends an id. Written atomically; last writer wins, and a duplicated `session.start` is absorbed by the receiver's id de-duplication.
- **`~/.roving-office/settings.json`.** Spec §10 specifies redaction via env vars, which hooks make awkward: a hook inherits the spawning harness's environment, so changing mode means restarting every session. The file is read per event, so `{ "redaction": "summary" }` applies to the next tool call. Env still wins over file, and `full` still needs its own second opt-in.
- **Shape sampling.** Payload *keys and value types* — never string contents — are appended to `~/.roving-office/shapes-<harness>.ndjson`, capped, so unverified field names get closed out by real traffic instead of guesswork. `ROVING_OFFICE_CAPTURE=full` records values too, `=0` turns it off.

Adding the second harness then pulled two small shared modules out of the first, and the third harness pulled a larger one. Each was extracted when a second (or third) consumer actually arrived, which is the right moment — earlier would have been speculative, later would have been two copies drifting:

- **`bin/mappers/lib/tool-classes.cjs`** — the fallback patterns, the shell-command reclassification and the `target` extraction. Per-harness tool *tables* stay in their mappers; the reasoning about unknown tools is shared (§2.4).
- **`bin/mappers/lib/event-shape.cjs`** — the three mechanics under a mapper that turned out not to be per-harness at all, once there were four mappers to compare: the per-session bookkeeping record (`{seq, started, turnOpen, tools, todo}` — every mapper wants the same fields for the same reasons), the rule that an `undefined` field must not overwrite a known one, and the result byte count. Which *field* holds the result is per-harness and stays in the mapper; how big it is, is arithmetic. Three copies of the state record and two each of the other two went in.
- **`bin/lib/local-config.cjs`** — `~/.roving-office/settings.json` and `projects.json` scaffolding, the adapter sanity check, and the `--status` lines about both. These files describe the *office*, not a harness: a machine with two harnesses wired up has one redaction setting and one alias table, and whichever installer runs first should be the one that creates them.
- **`bin/lib/cli-flags.cjs`** — how the five installers read their own arguments: `flag('--dry-run')`, `value('--config')` (the argument *after* the name, because a path is what every harness's own CLI takes there and what tab-completes), and `help`, since all five accept both `--help` and `-h`. Four of the five had written the pair out themselves, in three spellings: `flag` three times, `value` three times with two different answers for an absent flag, and Codex with a `Set` of the whole argument list to ask the same questions with `.has` — while Cursor asked `args.includes('--uninstall')` three separate times in one function. Deliberately *not* merged with `bin/lib/cli-args.js`, which is the same job for the twelve office-generating tools: those take `--seed=7`, typed by hand dozens of times a session, and these take `--config <path>`. Two conventions rather than one reader with a mode, and in any case these five are CommonJS, because a hook adapter starts under whatever Node the harness launches it with.
- **`bin/lib/aop-core.cjs`** — *the emitter core*, pulled out for OpenClaw (§5). Where the office is (`resolveEndpoint`, `isLoopback`), which office a directory belongs to (`deriveProject`, `canonicalRemote`), how much may be said and how short (`resolveRedaction`, `clamp`, `tidyPath`, `CAPS`), and the POST itself. Everything a *hook* needs that a *bridge* needs identically. Its smallest export earns its place by reach rather than by size: `readJson(file, fallback)` — parse or fall back, because every one of these files reads JSON somebody may have hand-edited — had a private copy in the Claude, Codex and Cursor installers (Cursor's named `read`, and hard-wired to a `{}` fallback), in `local-config.cjs` and in `aop-connect.cjs` — six restatements of one line, in files that were already requiring `aop-core` transitively through `local-config.cjs`. It also owns `MAPPER_HELPERS`, the frozen bag of `{ clamp, tidyPath, firstString, toIso, CAPS }` a mapper is handed: a mapper requires nothing, so what it may assume about its host is a contract, and a contract assembled at each call site can differ per driver — `bin/aop-send.cjs` built one, and the seven test files that drive the mappers built their own, one of them already missing `toIso`. Stated once, a helper a mapper starts using is either there for every driver or for none. Transport deliberately stays out: a short-lived hook spools and hands off, a bridge batches on a timer, and forcing those into one shape would help nobody. What they must not be allowed to disagree about is which room a repo walks into and what a desk label may contain — one is visible to whoever is watching, the other to whoever wrote the prompt.

The extraction paid for itself immediately, which is §7.2.

One deviation worth naming: the files are `.cjs`, not extensionless `aop-send`. The office's `package.json` is `"type": "module"`, and an extensionless Node script's module type is ambiguous enough to break on a version bump; `.cjs` is unambiguous and matches `server.cjs`.

- **`bin/aop-node.sh`** — the one file in `bin/` that is not Node, because it is what finds Node. A hook command names the launcher and the launcher `exec`s the adapter, so no hook depends on `node` being on the PATH it happens to inherit. This is not defensive programming for its own sake: a GUI-launched harness gets launchd's five-directory PATH and no version manager is on it, which cost every Cowork session (§2.7). It resolves once, caches to `~/.roving-office/node-path`, and — like the adapter — exits 0 and stays off stderr whatever happens.

### 7.1 Remote offices, without making the agent wait

The adapter needed **no changes at all** to *address* a remote office — it posts to
whatever URL it resolves and has always picked `https` from the URL's own protocol. What
it needed was a different way to *spend time*, because the budgets were written for
loopback: 500 ms to connect, 1 s in total, against a measured 0.7–0.9 s round trip to a
hosted receiver. Left alone, every event would have timed out into the spool and the
office would have gone quiet without a single error anywhere.

Raising the budgets alone is not available: design rule 2 says a slow office must never
become a slow agent, and a Rovo hook blocks its agent while it runs. So delivery splits
by locality:

| | Local (loopback) | Remote |
| --- | --- | --- |
| POST happens | inline, in the hook | in a detached child (`aop-send --flush`) |
| Hook wall time | ~40 ms, including the POST | ~40 ms, excluding it |
| Budgets | connect 0.5 s, total 1 s | connect 2 s, total 4 s, process ceiling 10 s |
| If it fails | spool, retry on the next hook | spool, retry on the next hook |

The hook appends to the spool *first* and then spawns, so the events are on disk before
anything can go wrong with the child; if the spawn fails they are simply carried by the
next hook. The child is `detached` with `stdio: 'ignore'` so it survives the harness
reaping the hook's process group and holds no pipe that could block.

That turns the spool from an error path into the normal path, which exposed a race worth
naming: two senders can now be in flight at once. Reading the spool and deleting it
afterwards loses whatever arrived in between, so a sender **renames** the spool to a
private claim file, and appends the batch back on failure. The rename is atomic, so
exactly one sender owns a given batch. Delivery becomes at-least-once, which the
receiver's existing id de-duplication already covers.

Two behaviours found by testing, both worth keeping in mind:

- **A local office start takes the machine's adapters back**, because there is one
  endpoint file and it holds one URL. It now says so on stderr rather than silently
  redirecting every hook.
- **`unpublishEndpoint` had to get stricter.** It deleted any endpoint whose `pid` was
  not *contradicting* it — and a remote endpoint has no pid by design, so a local office
  exiting wiped it and disarmed every hook on the machine. It now requires a pid that
  positively matches its own. Absence of a claim is not a claim.

A project **alias file** turned out to be necessary too. A repo is rarely named exactly like the office it should walk into, so `~/.roving-office/projects.json` maps either a canonical remote slug or a derived id onto a project id:

```json
{ "aliases": { "bitbucket.org/you/your-repo": "the-roving-office" } }
```

Read on every hook rather than cached with the git lookup, so an edit takes effect on the next event instead of when the cache expires.

**This repo needs no alias of its own.** The room in `src/projects.js` is `the-roving-office`, which is exactly what its remote slug derives to. That is deliberate, and it is the lesson of the rename: the office id is what a repo rename silently changes, so a room named after the remote means a fresh clone lands in the right office with no machine-local setup at all. The mechanism stays for any repo whose name genuinely differs from its room.

### 7.2 The bug that justified the shared core [verified 2026-08-29]

`post()` was duplicated — once in `aop-send.cjs`, once in the OpenClaw publisher — for about an hour, on the reasonable grounds that the two want different timing budgets. Then a test pointed an emitter at an IPv6 loopback URL and a *reachable* receiver logged zero requests.

The cause is a mismatch between two Node APIs. `new URL('http://[::1]:8080/x').hostname` returns `"[::1]"` — **with** the brackets — while `http.request({ hostname })` wants it bare and adds its own. Handed the bracketed form it tries to resolve the punctuation as a hostname, fails, and the emitter behaves exactly as though the office were down: every event spools, every retry fails identically, and nothing anywhere says why. Silent, total, and indistinguishable from a network problem.

Two things worth taking from it:

- **The fix belongs in one file.** Both copies had it, because the second was copied from the first. `post()` now lives in `aop-core.cjs` and takes its budgets as an argument, which was the only thing the two genuinely disagreed about.
- **`isLoopback` does not recognise `::ffff:127.0.0.1`.** That is correct as written — its own comment says anything not plainly loopback is treated as remote, because being wrong that way only costs patience. It also makes a useful test lever: an IPv4-mapped loopback address is classified `remote: true` while still being reachable, which is how the remote delivery path gets exercised on one machine. The obvious alternative, binding to the machine's own LAN address, does not work — its firewall resets connections to itself.

There was a fourth copy of `isLoopback`, in `local-config.cjs`, with a comment reading "the same loopback test as aop-send.cjs, which is the file that acts on it". It now imports the real one.

There was a fifth, in `aop-connect.cjs`, and its comment is the more instructive one: it justified the duplication on the grounds that "that file is on the hook's critical path and stays free of local requires, so the cost of a hook is a Node start and nothing else". True when written, and false by the time `aop-send.cjs` acquired `require('./lib/aop-core.cjs')` — which is exactly what §7.2 is about, since the shared `post()` is what it went there for. A comment asserting why two copies are cheaper than one require does not notice when the require arrives. `aop-connect` now imports it too; the half of that comment worth keeping is the half about *agreement*, because `--status` reports `remote` and the adapter acts on it, and it survives on the import line.

## 8. Suggested build order

1. ~~**Receiver first.**~~ **Built.** `server.cjs` serves, per office, `POST /office/<keycard>/aop/v0/events` (token-gated, NDJSON batches, id de-duplication), `GET /aop/v0/stream` (SSE, `?harness=` filtered), `GET /aop/v0/state` (replay of live sessions) and `GET /aop/v0/health`. `src/data/AopSource.js` is the single reducer for spec §6; `src/data/sources.js` registers the six sources and the picker drives them. Poke it with the `curl` in [Architecture](../architecture.md#receiving-events) before suspecting an adapter.
2. ~~**Claude Code plugin.**~~ **Built.** `bin/mappers/claude-code.cjs` + `.claude-plugin/` + `hooks/hooks.json` + `bin/aop-claude-install.cjs`. Fifteen hooks, L2, at zero token cost. Claude, Codex and OpenClaw can drive real **ghosts** (spec §6.1), so the scene-side ghost work is the next thing that pays off: cloned chairs and a translucent body clone in `props.js` / `Agent.js`, plus per-desk fan slots in `AgentManager`. Read §2.5's three measured behaviours first, particularly that a plugin install is a *copy*.
3. ~~**Rovo hooks** (L1) — five hook entries and a mapper.~~ **Built, and a fuller L1 than predicted.** `bin/aop-send.cjs` (shared core) + `bin/mappers/rovo-cli.cjs` (mapper)
   + `bin/aop-rovo-install.cjs` (installer). Eight hook entries, not five, so a Rovo session gets an explicit lifecycle rather than implicit spawn. Read §4.1's five constraints before touching it — particularly first-command-only, which is why the installer has to chain.
4. ~~**Codex `notify`** (degraded L0) while capturing real `hooks` payloads, then the full mapper.~~ **Built as the full hooks plugin.** `bin/mappers/codex-cli.cjs` + `.codex-plugin/` + the shared `hooks/hooks.json` + `bin/aop-codex-install.cjs`.
5. ~~**Cursor hooks.**~~ **Built.** `bin/mappers/cursor.cjs` + `bin/aop-cursor-install.cjs`, translating Cursor-native events and TodoWrite multi-step plans into AOP.
6. **Rovo `serve` bridge** (L2) — also the reference implementation for a long-lived bridge.
7. ~~**OpenClaw plugin**, once the double-count question in §5 is settled.~~ **Built** — and the double-count question is *half* settled, which is a deviation worth naming: the emitter stamps `harness.name` and `ext.wrapped_harness`, but the receiver-side de-duplication does not exist (§5.8). It shipped in that order because the office needs the declarations before it can have anything to de-duplicate. `openclaw-plugin/` + `bin/aop-openclaw-install.cjs`, ten hooks, L2 minus permissions. Read §5.2 first: the plugin route cannot see approvals at all, which is the one thing the Gateway WebSocket would add.
8. **A cloud source** (§6) — something server-side posting to a *published* office, not a mapper. Whatever it is, do it after the hosted office is something the project relies on, since it cannot be tested against loopback at all.
9. Keep `MockSource` as the offline demo, and add an AOP recorder/replay so the the screenshots are reproducible.

## Appendix: how this was verified

**Claude Code** — installed locally, v2.1.246. Flags read from `claude --help` and `claude plugin --help`. Hook payloads captured for real by running a probe session with a temporary settings file whose hooks were `cat >> tmp_rovo_hooks.jsonl`, with `--output-format stream-json --include-hook-events --verbose`; the session itself failed with "Not logged in", which is *why* only `SessionStart`, `UserPromptSubmit` and `SessionEnd` fired. Hook and SDK-message name inventories came from `strings` over the installed binary — which also confirms the wider set really is present in 2.1.246, not just in the docs: `PostToolUseFailure`, `PostToolBatch`, `PermissionDenied`, `FileChanged`, `CwdChanged` and `StopFailure` all appear. Docs claims (payload fields for tool hooks, OTel event names) came from `docs.claude.com`.

The plugin work was then verified by building and running it, not by reading:

- **Manifest shape** taken from `claude plugin init --with hooks` rather than from memory (a throwaway plugin, scaffolded, read, deleted), then checked with `claude plugin validate .` — which is also where the marketplace `description` warning came from.
- **Install** through `claude plugin marketplace add ./` + `claude plugin install roving-office@roving-office`; `claude plugin details` reported all 15 hooks and `~0 tok`. Re-running both commands proved them idempotent (exit 0, "already installed"), which is what lets the installer just run them.
- **The copy-on-install behaviour** was found by looking: the tree under `~/.claude/plugins/cache/…/0.1.0/` contains `bin/`, `bin/mappers/` and the exec bit intact, and `installed_plugins.json` records `installPath` and `gitCommitSha`.
- **Live delivery, both routes.** An unauthenticated `claude -p …` still fires `SessionStart` and `UserPromptSubmit` (the auth failure is *why* nothing further runs), and both arrived at the receiver as real `session.start` / `turn.start` envelopes with the project resolved through the alias file — first via the plugin, then again with the plugin disabled and hooks installed at project scope.
- **Everything the unauthenticated session cannot reach** — tool calls, subagents, permissions, compaction, failures — was exercised by replaying a scripted 25-event session through the mapper in all three redaction modes and asserting the output: types against the spec's enum, ghost parentage, turn ids, classes, `artifact.change` on success only, and that nothing is emitted that `CAPABILITIES` does not declare.
- **Settings-route safety** was tested against a copy of this machine's real `~/.claude/settings.json`, which already has two hooks: install added 15 entries and left both untouched with their matchers, a second run was a no-op, and `--uninstall` returned the file byte-identical to the original.

**Rovo CLI** — v202608.25.1. `eventHooks` schema read from the live `~/.rovo/config.yml`; the stdin/exit-0/latency constraints from an existing production hook script on this machine. Real payloads read from a co-resident hook's own debug log (25 samples across `on_complete` and `on_tool_permission`), then confirmed by installing this adapter and watching real `session.start`/`session.end` envelopes arrive at the receiver. The extra three event names came from `strings` over the installed binary, which registers `["on_session_start","on_user_prompt","on_complete","on_session_end"]`, and were then accepted by Rovo in a real config. First-command-only was proved by adding a second command to an event and observing that it neither ran nor appeared in Rovo's own `event_hooks.log`, while a single command on a fresh event did both. Hook firing per mode (TUI vs `run` vs `serve`) was established by driving one turn each way with a capture-only config and diffing what arrived. The `serve` API was probed for real: `rovo serve 8791 --disable-session-token`, then `GET /openapi.json` for the endpoint and schema inventory, a live SSE subscription to `/v3/agent_lifecycle_events`, and one tiny chat turn through `POST /v3/set_chat_message` + `GET /v3/stream_chat` to capture frame names. Server shut down afterwards via `POST /shutdown`.

Session-visibility timing (§4.4) was established by launching a Rovo CLI in a repo under a pty, sending it no input, and watching the receiver's cursor for 14 seconds while the TUI sat fully rendered at its prompt: nothing arrived. The complementary figure — `on_session_start` to `on_user_prompt` within 54–1063 ms across four sessions — came from the recorded shape timestamps, and the Claude contrast from two same-day sessions that reached the office with a `session.start` and no turn at all.

**Codex CLI** — installed locally, v0.151.0. The hook names and stdin fields were
checked against the current official hook contract and the public Rust types;
the installed CLI supplied plugin/marketplace JSON, feature status and doctor
output for the installer. A scripted eight-case fixture session covers lifecycle,
turn ids, the absence of a Bash failure signal, patch artifacts without patch-content retention,
plans, permission requests, waiting, subagent parentage and summaries. The plugin
manifest is checked with the Codex plugin validator, and the installer's dry-run
and status paths are exercised without modifying the active installation.

**OpenClaw** — the runtime is not installed on the development machine, though §5.3 is the exception and the most valuable evidence here: a **real Gateway on a Linux server** installed the packed tarball, and its `openclaw plugins inspect roving-office --runtime --json` is what revealed the conversation-hook gate — then, once that was fixed, that the same command shows no plugin *config* at all, which is what forced the self-narration in §5.4. Three releases in an afternoon (`0.3.0` → `0.5.0`), each fixing something no local test could have found, all of it in the install-and-configure seam. Nothing else in this section needed one, because the *contract* does not depend on it, because `npm pack openclaw` (2026.7.1-2) ships both `dist/*.d.ts` and the entire `docs/` tree. So §5.1's hook table is read from `dist/hook-types-*.d.ts` — the `PluginHookHandlerMap` and every `PluginHook*Event` / `PluginHook*Context` type — rather than from a web page, and it corrected three things the docs-only draft had wrong (the subagent hook names, the registration signature, and the nine-member `session_end` reason enum). `definePluginEntry`'s behaviour came from its *implementation* in `dist/plugin-entry-*.js`, which is what revealed that its default `configSchema` is a strict empty object and would reject this plugin's own config. Packaging and install semantics from the shipped `docs/plugins/{building-plugins,manage-plugins,sdk-entrypoints}.md` and `docs/cli/plugins.md`. The Gateway WebSocket route (§5.2) is still **docs-only and unverified** — nothing here has connected as an operator.

The plugin itself was then verified by running it, since a plugin whose harness is absent can still be driven directly:

- **A stub `api`** implementing `on(name, handler, opts)` drives a scripted 21-event session — start, a turn, five tool calls including two overlapping, a spawned subagent, a compaction pair, heartbeats, and an end — with payloads shaped to the `.d.ts`. Asserted: types against the spec's enum, the deferred `session.start` arriving first and carrying the project, `tool_class` for each tool, ghost parentage on the right tool call, `artifact.change` on success only, that no handler ever returns a value, and that every fire returns in under 50ms.
- **Delivery, end to end, into the real receiver.** `server.cjs` on this machine accepted the plugin's envelopes and replayed them from `GET /aop/v0/state` as `openclaw/sdk` sessions with the project resolved — the same route and the same office the hook adapters use.
- **The remote path, for real**, using `::ffff:127.0.0.1` so `isLoopback` classifies it remote while it stays reachable (§6.2). Asserted: ten events queued in 2–3ms against an office answering in 900ms; a downed office costing **one** failed request rather than twenty, because the backoff floor is not defeated by fresh events arriving; unassisted recovery, in order, once it came back; `stop()` spooling the remainder; and the spool draining on the next start.
- **Batching and gzip** were confirmed accidentally and then deliberately: the first harness receiver silently dropped the opening batch because it did not decompress, which is how the >4 KiB gzip threshold got exercised without being aimed at.
- **The refactor was re-tested from the other side.** Moving `post`, `deriveProject` and the redaction helpers into `aop-core.cjs` touched the two working adapters, so both installers' `--status` and a real Rovo-mapper `session.start` were run again against the live office afterwards.
- **Against the *hosted* office, twice.** An office was minted on the deployed receiver with `POST /api/offices` and the plugin published into it over the public internet — once from the checkout, once from a **packed tarball extracted outside it**, which is the server scenario end to end. The hosted office replayed the sessions back with tool classes, an `artifact.change`, `project.scene` from config, and `openclaw/sdk` as the harness. This is the evidence behind "no server change is needed": the deployment predated the adapter by weeks.
- **One assertion was wrong before the code was.** The hosted replay appeared to be missing subagent ghosts, which read as a mapper bug for a few minutes. It is not: `lib/aop-bus.cjs`'s `replay` drops a session on `session.end`, and `/state` is defined as the *live* set, so a ghost that has finished is correctly absent. The office's `buffered` count is what proves the events were accepted. Worth recording because the same trap is waiting for the next person who tests a short-lived session against `/state`.

**§6** is the one section with nothing behind it: no cloud source has been built, run or measured, and it deliberately claims nothing about any particular product. Read it as the three constraints an adapter would have to satisfy, not as a design.

**Known unverified items, in priority order**

1. ~~Codex `hooks` stdin payload field names~~ → **closed** (§3 and the official hook contract).
2. Claude `PreToolUse`/`PostToolUse`/`PermissionRequest`/`SubagentStart` payloads as *actually emitted* by 2.1.246 — still docs-only, because this machine's Claude is not logged in, so no model turn has ever run here. The mapper reads every field through a fallback chain and the installed plugin records payload shapes to `~/.roving-office/shapes-claude-code.ndjson` (keys and types, never contents), so the first authenticated session closes this by itself: check that file against §2.2, then tighten the chains in `bin/mappers/claude-code.cjs`. `SessionStart` and `UserPromptSubmit` are already confirmed from live traffic.
3. ~~Rovo hook payload field names~~ → **closed** (§4.2, §4.5). The shape recorder did the job it was built for: 50 recorded shapes across 8 hook names now cover `on_tool_start` and `on_tool_end`, and they found the contract to be *wider* than §4.2 claimed rather than different. No chain needed tightening — see §4.5.
4. Whether Rovo's lifecycle SSE single-quote payload is a bug or intentional. Still present in 202608.25.1, so any `serve` bridge needs a lenient parser.
5. ~~OpenClaw session-state enum values, and how it labels wrapped Claude/Codex sessions~~ → **half closed** (§5.1, §5.8). The enum is settled: `session_end.reason` is `new | reset | idle | daily | compaction | deleted | shutdown | restart | unknown`, from the type declarations. The second half is closed in the *negative*, which is the more useful answer — **nothing in the hook payloads names the wrapped harness.** `modelProviderId` is the provider, not the harness. So the de-duplication design in §5.6 cannot be built on sniffing, and `wrappedHarness` is configured instead.
6. Whether any cloud source can be made to post to an office at all, and what it knows early enough to be worth posting. A source that can only report *after* it has delivered gives the room presence without work, which is the opposite of what the office is for. §6 sets out the constraints; nothing beyond them has been settled.
