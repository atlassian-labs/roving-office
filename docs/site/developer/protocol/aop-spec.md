# Agent Office Protocol (AOP) v0

**Status:** draft · **Version string:** `"0.1"` · **Audience:** anyone writing an adapter that feeds live agent activity into The Roving Office.

AOP is the wire format between an **agentic harness** (Claude Code, Rovo CLI, Codex CLI, OpenClaw, anything else) and the **office** — the 3D diorama that turns that activity into characters walking to desks, hitting the bookshelf, and dropping work in the outbox.

The office already has an internal event vocabulary (`spawn`, `status`, `job`, `research`, `activity`, `dispatch`, `exit` — see `src/agents/AgentManager.js`). Those are *stage directions*, deliberately shaped for the scene. AOP is the layer above: **what actually happened in the harness**, described in harness-neutral terms. The office reduces AOP events into stage directions. Adapters never emit stage directions directly, so an adapter never has to know what a bookshelf is.

```
harness ──hook/stream──▶ adapter ──AOP──▶ ingest ──SSE──▶ browser ──▶ AgentManager
   (Claude Code)          (thin)          (server.cjs)     (AopSource)   (stage directions)
```

## 1. Design rules

These are the constraints that shaped everything below. They are not negotiable without a version bump.

1. **The harness must never wait on us.** Most harnesses emit events by running a short-lived shell command and blocking the agent until it exits. Every adapter is therefore fire-and-forget, hard-capped in wall time, and **always exits 0**. Rovo CLI in particular disables an event hook that exits non-zero.
2. **Lossy by default.** A `kill -9` on the harness means no `session.end`. A crashed office means dropped events. The protocol assumes gaps and defines recovery (§7) rather than pretending to be a reliable log.
3. **Cheap to emit, cheap to ignore.** A conforming emitter can send six event types (§9, level L0) and still produce a believable office. Everything else is enrichment.
4. **No content exfiltration.** Events carry *shapes and summaries* — tool names, file paths, truncated titles — never file contents or full transcripts (§10).
5. **Capability-gated, not network-gated.** Ingest is token-authenticated, and *that* is the boundary — not where the request came from. Reading an office needs its keycard; writing to one needs a write token as well (§5.5). This started life as "loopback only", which was the same intention expressed as a network rule, and it stopped being expressible that way the moment an office could be somewhere other than the machine making the events. It is still not a telemetry pipeline: rule 4 is what limits what may be sent, and it did not move.
6. **Forward compatible.** Receivers ignore unknown event types and unknown fields, so a newer harness adapter can talk to an older office.

## 2. Terminology

| Term | Meaning |
| --- | --- |
| **harness** | The program running the model loop — `claude-code`, `rovo-cli`, `cursor`, `codex-cli`, `openclaw`. |
| **session** | One conversation/thread inside a harness. Maps 1:1 to **one character** in the office. |
| **subagent session** | A session spawned by another session. Its own character, with `session.parent_id` set. |
| **turn** | One user prompt and everything the agent does in response. Maps to a piece of **work** at a desk. |
| **tool call** | One tool invocation inside a turn. Drives which **prop** the character walks to. |
| **office** | The receiving app: `server.cjs` (ingest + fan-out) plus the browser scene. |
| **adapter** | The code that translates a harness's native events into AOP. |

## 3. Envelope

Every event is a single JSON object. Batches are newline-delimited JSON (NDJSON).

```json
{
  "aop": "0.2",
  "id": "9f1c1c1e-0b7d-4b7a-9a3f-2f36a5c4b111",
  "ts": "2026-08-26T12:19:54.058Z",
  "seq": 12,
  "type": "tool.start",
  "harness": { "name": "claude-code", "version": "2.1.246", "variant": "cli" },
  "session": {
    "id": "478c3346-4425-4bd7-9a9f-0163386a04f1",
    "parent_id": null,
    "kind": "main",
    "label": "the-roving-office spec",
    "cwd": "~/dev/roving-office"
  },
  "project": {
    "id": "the-roving-office",
    "name": "The Roving Office",
    "repo": { "remote": "bitbucket.org/atlassian/the-roving-office", "branch": "aop-spec" }
  },
  "payload": { "tool_call_id": "toolu_01", "tool_name": "Read", "tool_class": "read", "target": "src/config.js" }
}
```

### 3.1 Envelope fields

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `aop` | string | ✅ | Protocol version, `"<major>.<minor>"`. Receivers reject a different **major**, accept any minor. |
| `id` | string | ✅ | Unique per event. UUIDv4 or `<session.id>:<seq>`. Used for **idempotency** — a receiver that has seen an `id` MUST drop the duplicate. |
| `ts` | string | ✅ | RFC 3339 / ISO 8601 with milliseconds, **UTC**. Emitter's clock, at the moment the underlying thing happened. |
| `seq` | integer | ⬜ | Monotonic per session, starting at 1. Lets the office detect gaps and order events that share a `ts`. |
| `type` | string | ✅ | One of §4. Dotted lowercase, `<noun>.<verb>`. |
| `harness` | object | ✅ | `{ name, version?, variant? }`. `name` is a lowercase stable slug; see the registry in §4.6 and variants in §4.7. |
| `session` | object | ✅ | See §3.2. |
| `project` | object | ⬜ | See §3.3. Strongly recommended — it is how the office picks which building to show. |
| `payload` | object | ⬜ | Type-specific, per §4. |
| `ext` | object | ⬜ | Vendor-specific extras. Receivers MUST NOT interpret and MUST NOT choke on it. |

### 3.2 `session`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `id` | string | ✅ | Harness-native session id. Stable for the life of the session. |
| `parent_id` | string \| null | ⬜ | Set on subagent sessions. The office draws the parent–child relation (and can seat children near the parent). |
| `kind` | enum | ⬜ | `main` (default) \| `subagent` \| `background` \| `remote`. |
| `label` | string | ⬜ | Human name for the session, ≤ 60 chars. Becomes the character's name tag if present, else a name is generated. |
| `actor` | string | ⬜ | Name of the **agent identity** behind the session, ≤ 60 chars. A whole name is kept whole; a single word becomes a first name and the office adds the job. |
| `actor_color` | string | ⬜ | What the identity wears, ≤ 40 chars. A colour (`#c1440e`, `rgb(193 68 14)`) is used exactly; a description (`Rich red / crimson`) is read and fitted to the office palette. Anything with no colour in it is ignored. |
| `actor_avatar` | string | ⬜ | URL of a picture of the identity, ≤ 512 chars. Absolute `http(s)`, or a path on the office's own origin — see §5.7 for uploading one. |
| `cwd` | string | ⬜ | The session's working directory, tidied per §10 — `$HOME` replaced with `~`. Used as a fallback `project.id` (basename) when `project` is absent, which the tidying leaves intact. Emitters MUST NOT send the absolute form: under `$HOME` it is the local account name, and it is on every event of the session. |
| `agent_type` | string | ⬜ | Harness-declared role of a subagent (`Explore`, `general-purpose`, …). Used for the character's colour bias. |

**Office identity.** A character's key is `harness.name + ":" + session.id`. Two harnesses may collide on session ids; the tuple never does.

**`label` and `actor` are different claims, and the difference matters.** `label` names a *session* — "this tab is the night shift" — and is a caption the office repeats verbatim. `actor` names a *someone*: this session is being run by an identity that exists apart from it, and will be back tomorrow under a different session id. Send `actor` whenever the harness has a durable identity behind a session — a configured OpenClaw agent, a named persona — and `label` when the name belongs to the run rather than the runner.

Neither is a place for an identifier. A session key, a run id or an agent slug in either field puts `agent:albus:telegram:direct:1234` on somebody's chest, and the office has no way to tell that it was not meant as a name. Adapters MUST send a name a person would recognise, or nothing: `actor` is optional precisely so that "no idea who this is" has an honest answer. The office draws a name of its own from the session key in that case, and prefers a plausible stranger to a true identifier.

**What the office does with `actor` depends on how much of a name it is.** The office normally writes the surname itself, as the job in hand — *Ada Kettle-Mender* — and that is worth keeping only while it is not talking over somebody:

- **Two or more words: the name is kept whole, permanently.** `"Albus Dumbledclaw"` is **Albus Dumbledclaw**, and no job ever renames him. These names tend to be the joke — Paige Turner, Florence Nightingclaw — and a job surname would delete the better line and take the credit.
- **One word: it is a first name, and the office adds the job.** `"Bobster"` becomes **Bobster Kettle-Mender**, then **Bobster Docs-Verifier**, so a half-given identity still gets the mechanic.

Words carrying digits are dropped as identifiers, and an `actor` with nothing name-shaped left in it — `agent:albus:telegram:direct:1234` — is declined in favour of the pool. A lone honorific is nobody (`"Dr"`), though an honorific *with* a name is a whole name and stays as `"Dr House"`.

An `actor` may arrive **after** the session's first event, because OpenClaw learns it from the agent context one hook later. Adopting it late renames the character: a whole name replaces theirs outright, a single word changes only the person and leaves the job running. Two sessions of one identity are the same colleague and share a name; the anti-collision rule that keeps two anonymous tabs from both being Ada does not apply to a name somebody chose.

**`actor_color` is what that identity wears.** Everyone in the office has a shirt colour, normally drawn from a palette — pleasant, and meaningless. An identity that names its own colour gets it instead, and gets it every session, which turns the colour into something you can recognise across a restart: the agent in rust is always the same agent.

Send it **as written** and let the office read it. That is not politeness, it is the division of labour: an adapter reads a file, and the office has a browser, a palette and a colour space. So `actor_color` is a *claim about appearance*, not a resolved value, and the office handles three kinds of claim differently.

- **A colour stated as a colour is used exactly.** `#c1440e`, `c1440e`, `rgb(193 68 14)`, `hsl(20 87% 41%)`, and a hex anywhere inside a longer string — `Rich red / crimson (#b03a3a)`. A hex is a decision, and decisions are honoured without adjustment.
- **A colour stated in words is read, then fitted.** Real identities describe themselves rather than specify: `Rich red / crimson`, `Bright tangerine / golden-orange`, `Warm library yellow / marigold`, `Field green / pitch green`. The office matches the description against a table of colour names and projects the result into the range its own shirts occupy, so it arrives recognisable *and* wearable. This is the interesting half; `src/agents/colour.js` documents how and, more usefully, why the obvious approaches fail.
- **A claim with no colour in it is ignored**, not an error. `Colour: the vibe of a Tuesday` is a mood, and the palette answers instead.

Note what follows from the middle case: **a bare colour word is a description, not a specification.** `teal` is read and fitted like any other word, because `#008080` is a CSS keyword rather than anybody's shirt. Adapters wanting an exact colour should send hex.

Like `actor`, this may arrive late, in which case the character changes their shirt a few seconds in. Alpha is dropped; a shirt is a shirt.

**`actor_avatar` is a picture of that identity.** Agents that describe themselves tend to have a portrait to go with it, and an office showing one has answered "who is this" in the way a name never quite does. It appears in the agent's detail panel; the character on the floor is still the character.

The field is a **URL**, which is the whole difficulty: an avatar is usually a *file*, on the machine the harness runs on, and the office is a browser elsewhere. An adapter with a local file therefore uploads it first (§5.7) and sends the URL it gets back. An adapter whose identities already have pictures on the web sends those instead, and uploads nothing.

Because the upload has to finish before the URL exists, `actor_avatar` is the **latest-arriving** identity field: the first few events of a session normally carry no avatar and later ones do. Receivers MUST adopt it mid-session, and MUST ignore any value that is neither an absolute `http(s)` URL nor a path on their own origin — a `src` is one of the few places where a string does something.

### 3.3 `project`

| Field | Type | Req | Notes |
| --- | --- | --- | --- |
| `id` | string | ✅ (if `project` present) | Slug. Matches an entry in `src/projects.js` when possible, so the office picks the right building/theme; unknown ids fall back to the default office. |
| `name` | string | ⬜ | Display name. |
| `repo` | object | ⬜ | `{ remote?, branch?, commit? }`. `remote` is the **canonical** `host/owner/repo` — see below. |
| `workitem` | object | ⬜ | `{ key, url?, title? }` — e.g. a Jira key. Lets the office label the work item on the desk. |
| `scene` | string | ⬜ | Explicit scene override. See §3.4.3. |

**`repo.remote` is `host/owner/repo`, not the URL somebody cloned with**, and this is a
`MUST` rather than a tidiness preference. `git remote get-url origin` returns whatever a
contributor typed, and one entirely ordinary form of it is
`https://<user>:<token>@host/owner/repo` — so an emitter that forwards the output
verbatim hands the office a **live credential**, which the office then serves to every
holder of the keycard. Reducing to the three parts a receiver has any use for makes that
impossible by construction rather than by a pattern that has to have anticipated the
shape. Emitters MUST strip any `userinfo` component and SHOULD send the canonical form.

It is also the answer to a second, duller problem: an ssh clone and an https clone of one
repository used to report two different strings for the room they share.

Receivers still canonicalise what arrives (§3.4.1) — an emitter written against an older
spec may send a URL, and dropping its events would be worse than reading them.

## 3.4 Scenes and routing

**One scene is one office is one project.** Not one per harness: three Rovo CLI terminals in the same repo are three characters in *one* office, and a Claude Code session in that same repo walks into the same room and stands next to them. The harness is a **costume** (coat colour, a glyph on the name tag), never a building.

The alternative — a scene per client type — puts unrelated repos in one room and splits one body of work across rooms, which is exactly backwards from how the [Getting started](../../user/install.md) defines a project: *"a body of work you want to watch"*.

### 3.4.1 Deriving the scene key

Adapters SHOULD send `project`. When they don't, or send it partially, the receiver derives it. First hit wins:

| Precedence | Source | Result |
| --- | --- | --- |
| 1 | `project.scene` (explicit override) | used verbatim |
| 2 | `project.id` from the adapter | used verbatim |
| 3 | `project.repo.remote`, canonicalised to `host/owner/repo` | e.g. `bitbucket.org/atlassian/the-roving-office` → `the-roving-office` |
| 4 | basename of the nearest ancestor of `session.cwd` containing `.git` | worktree-aware |
| 5 | basename of `session.cwd` | last resort |
| 6 | none of the above | the `default` office |

**Worktrees and branches collapse into one office.** Because the key comes from the *remote*, a session in `roving-office/.worktrees/agent-spec` lands in the same room as one in the main checkout, with `repo.branch` shown as a per-character detail. Branch-per-office fragments the room precisely when you most want everything in one view. (Deliberately rejected: branch-as-floor. Cute, given `storeysBelow` already slices the building, but a scene change for little gain.)

### 3.4.2 Many offices, one window

The receiver keeps reduced state for **every** project it has seen. The browser renders exactly one at a time.

- `GET /aop/v0/state` returns per-project rosters, so nothing is lost while offscreen.
- The scene switcher badges live headcounts, and the title bar carries an overflow indicator — *"4 agents in 2 other scenes"*.
- Want two scenes side by side? Open a second browser window on the same keycard and pick a different scene. SSE fan-out already supports N subscribers, and this is far cheaper than a split-screen scene.
- Events for an unknown `project.id` are **never dropped**; they create a new office lazily, themed by `src/projects.js` if the id matches an entry there and generically if it doesn't.

### 3.4.3 The `scene` override

`project.scene` exists for the two cases the derivation gets wrong:

- **Monorepos** — one remote, many teams. Set `scene` per directory.
- **"One room for everything"** — set `ROVING_OFFICE_SCENE=all` in the environment and the adapter stamps `scene: "all"` on every event, collapsing every repo into a single office.

### 3.4.4 Capacity

The room is authored with **5 desks** (`DESKS` in `src/layout.js`), and can be given more in the furniture editor. Real usage overruns whatever it has, so seating degrades in a fixed order:

| Population | Seating |
| --- | --- |
| Main sessions, 1–5 | One desk each, in claim order |
| Main sessions, 6+ | Couch, then standing at the bookshelf |
| Main sessions beyond ~12 | Not rendered; a *"+N waiting"* badge on the roster |
| Subagent sessions | **Never claim a desk** — they ghost onto the parent's, see §6.1 |

Subagents are excluded from desk claiming for a practical reason: a single `Job` fan-out of four would evict every real session in the room within a second.

## 4. Event types

Eighteen types, in five families. **L0** marks the minimum viable set (§9).

### 4.1 Session lifecycle

| Type | L0 | Meaning | Payload |
| --- | --- | --- | --- |
| `session.start` | ✅ | A session began (or the adapter noticed one). | `{ source, capabilities?, redaction?, model?, permission_mode?, transcript?, resumed?, parent_tool_call_id? }` |
| `session.heartbeat` | ✅ | "Still alive." Emit every 15 s while a session exists. | `{ status?, idle_ms? }` |
| `session.end` | ✅ | Session finished or was closed. | `{ reason, duration_ms?, usage? }` |

- `source`: `startup` \| `resume` \| `fork` \| `clear` \| `spawn` \| `attach`.
- `reason`: `exit` \| `clear` \| `logout` \| `error` \| `killed` \| `timeout` \| `other`.
- `capabilities`: array of event types this adapter can emit. Declaring them lets the office avoid waiting for events that will never come (e.g. show no bookshelf trips for an adapter without `tool.start`).
- `usage`: `{ input_tokens?, output_tokens?, cached_tokens?, cost_usd? }`.
- `parent_tool_call_id`: set on a subagent session, naming the parent's `tool.start` of class `agent` that spawned it. This is what lets the office bind a ghost to the exact tool call it came from, and dissolve every straggler when that call ends. Claude Code supplies it as `parent_tool_use_id`.

### 4.2 Turns

| Type | L0 | Meaning | Payload |
| --- | --- | --- | --- |
| `turn.start` | ✅ | A turn began — a user prompt, or a clock. | `{ turn_id?, title, prompt?, prompt_chars?, trigger?, origin?, plan? }` |
| `turn.title` | ⬜ | The turn in flight has a better name than the one it opened with. | `{ turn_id?, title }` |
| `turn.end` | ✅ | The agent stopped and handed control back. | `{ turn_id?, status, title?, summary?, duration_ms?, usage?, tool_calls? }` |
| `step.start` | ⬜ | The agent began one part of a turn. | `{ step_id, turn_id?, title?, index?, of?, plan? }` |
| `step.end` | ⬜ | That part finished. | `{ step_id, status?, duration_ms?, summary? }` |

- `title`: **≤ 80 chars, single line** — the desk label. Adapters SHOULD derive it from the first line of the prompt; the office never re-summarises. If the harness writes its own short name for the work, that is the better label — see `turn.title` below.
- `prompt`: full prompt text. Omitted unless the emitter is explicitly configured to include it (§10).
- `trigger`: `user` \| `queue` \| `schedule` \| `parent` \| `retry`. **Optional, and omitted rather than guessed** — an emitter that does not know how a turn started MUST leave it out. `origin.kind` is the fuller answer and does not have to agree with a word this enum lacks.
- `origin`: *why this turn exists*, `{ kind, name?, id?, schedule?, detail? }`. See below.
- `status` on `turn.end`: `completed` \| `cancelled` \| `error` \| `blocked`.
- `status` on `step.end`: `completed` \| `skipped` \| `failed` \| `cancelled`. Defaults to `completed`.
- `index` / `of`: 1-based, and only meaningful together. `2` of `5` is the second of five.
- `plan`: ordered array of `{ id?, title, status? }`, ≤ 20 entries — the checklist for this turn.

#### The name of the work can arrive late

A turn has to open with a label, and at the moment it opens the only thing available is
usually a quote of the request. Harnesses that write their own short name for the work
— Claude Code generates one per session, the thing its terminal tab shows — produce it a
second or two *after* the prompt that earned it, which is after `turn.start` has gone.

`turn.title` is how an adapter says so without the round becoming two rounds.

1. **Same turn, new name.** It renames the work in hand and MUST NOT be read as a new
   job: no second delivery, no status change, no history entry of its own. A new job is
   `turn.start`'s business.
2. **Only while the turn is open**, and only for a title that differs from the current
   one. An adapter that has nothing better to say says nothing.
3. **Once is enough.** This is an upgrade from a placeholder to the real name, not a
   running commentary; an adapter SHOULD NOT emit it per tool call. Where a harness
   restates a title that has not changed, the receiver's no-op (rule 2) is the backstop,
   not the licence.
4. **Additive.** A receiver that ignores it sees the same title on `turn.end`, which
   already carries one, and renders exactly as it did before this event existed.
5. **Subject to §10 like any other title.** It is model-written free text, so `metadata`
   mode does not send it at all — there is no generic label worth an event.

#### Origin: why a turn exists

`trigger` says how a turn started in five words. `origin` says what started it, and the
difference is the whole of what a viewer wants from a scheduled run: not *"this was on a
schedule"* but *"this is the hourly Room to Read mail check"*.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | enum | `human` \| `schedule` \| `heartbeat` \| `queue` \| `parent` \| `retry` \| `maintenance` \| `webhook`. Required when `origin` is present. |
| `name` | string ≤ 80 | What the **operator** called it — *"Paige hourly Room to Read Gmail check"*. |
| `id` | string ≤ 80 | The harness's id for the job, so repeat runs of one job are groupable. |
| `schedule` | string ≤ 40 | `17 * * * *`, `every 30m`. Sent as the harness states it; the office does the phrasing. |
| `detail` | string ≤ 200 | Free text about this run, or about the job behind it — a scheduler's `description` field is the usual source. Subject to redaction either way, so it travels from `summary` up; see §10. |

- `kind` splits `schedule` from `heartbeat` deliberately: one is a single errand with an
  id and a name, the other is a round that has neither. `maintenance` is the agent's own
  housekeeping — flushing memory, shedding context — which is nobody asking for anything
  and MUST NOT be reported as `human`.
- `origin` is **additive**, and a receiver that ignores it renders exactly as before.
- An emitter that knows only how the turn started still SHOULD send `origin` with just a
  `kind`. "Nobody asked for this" is worth saying on its own.
- `name`, `id` and `schedule` describe a **configured job**, not a conversation, which is
  why §10 lets them through at `metadata` where `title` does not. `detail` is free text
  and does not.

#### Steps: one job, several parts

A job is *sometimes* one step and *sometimes* a walk through a series of them. Between
`turn` and `tool` there was nothing that could say "this turn has five parts and I am on
the second", so a scheduled job working through a list rendered exactly like one long
think. These two types are that missing middle, and the rules keep them from becoming a
second, noisier `tool.start`.

1. **No steps means one step.** A turn that never emits `step.*` is the common case and
   MUST render precisely as it did before this section existed. Adapters MUST NOT wrap a
   single-part turn in a ceremonial lone step, and receivers MUST NOT invent "1 of 1".
2. **One open step at a time**, per session. A `step.start` while another step is open
   closes it as `completed` — harnesses announce the next item far more reliably than they
   close the last one, so the implicit close is the normal path, not the recovery path.
3. **`turn.end` closes any open step.** A step never outlives its turn.
4. **A plan is a hint, not a contract.** Entries may be skipped, reordered or never
   reached, and the count may be wrong. Most harnesses only learn the checklist when the
   agent writes it down, which is *after* `turn.start` — so `plan` may be restated on any
   `step.start`, and the latest one wins. A receiver treats it as the best description
   available of work it will find out about anyway.
5. **Steps are parts of a turn, not tool calls.** An adapter MUST NOT emit a step per tool
   call: that is what `tool.start` is for, the office already debounces it (§6), and a step
   per call would have an agent pace the room for work done at one desk. A step is a unit
   of *intent* — a todo item, a heartbeat phase, a stage of a migration.
6. **`step_id` is opaque** and unique within its turn. Receivers match `step.end` to
   `step.start` on it and MUST NOT parse it.

### 4.3 Tool activity

| Type | L0 | Meaning | Payload |
| --- | --- | --- | --- |
| `tool.start` | ⬜ | A tool call began. | `{ tool_call_id, tool_name, tool_class, target?, summary?, concurrent? }` |
| `tool.end` | ⬜ | A tool call finished. | `{ tool_call_id, tool_name?, tool_class?, status, duration_ms?, error?, result_bytes? }` |
| `artifact.change` | ⬜ | The agent changed something durable. | `{ kind, path?, added?, removed?, url? }` |

- `status`: `ok` \| `error` \| `denied` \| `cancelled` \| `timeout`.
- `kind` on `artifact.change`: `file` \| `commit` \| `branch` \| `pr` \| `page` \| `workitem`.

**`tool_class`** is the whole point of this family: it is the normalised, closed enum the office maps to props. Adapters MUST map their native tool name onto it.

| `tool_class` | Native examples | Office reading |
| --- | --- | --- |
| `read` | `Read`, `open_files`, `cat` | at the desk, working |
| `search` | `Grep`, `Glob`, `grep`, `ToolSearch` | bookshelf trip, researching — a book off the shelf |
| `edit` | `Write`, `Edit`, `create_file` | at the desk, working |
| `execute` | `Bash`, `shell`, test runners | at the desk, working |
| `network` | `WebFetch`, `WebSearch`, `curl` | bookshelf trip, researching — **the globe turns**, no book |
| `knowledge` | Confluence/Jira/graph lookups, MCP reads | bookshelf trip, researching — a book off the shelf |
| `scm` | commit, push, PR create | outbox, delivering |
| `agent` | `Job`, `invoke_subagents` | expect child `session.start` |
| `wait` | sleep, poll, watch | resting |
| `other` | anything unmapped | working |

### 4.4 Attention and interruptions

| Type | L0 | Meaning | Payload |
| --- | --- | --- | --- |
| `permission.request` | ✅ | The agent is blocked on a human decision. | `{ request_id, tool_name?, tool_class?, target?, reason? }` |
| `permission.resolve` | ⬜ | That decision came in. | `{ request_id, decision, by? }` |
| `notification` | ⬜ | Harness wants the human's attention (idle nudge, prompt needed). | `{ message, level? }` |
| `error` | ⬜ | Something failed at session scope. | `{ message, kind?, recoverable? }` |
| `context.compact` | ⬜ | History was compacted. | `{ trigger, tokens_before?, tokens_after? }` |

- `decision`: `allow` \| `deny` \| `defer` \| `always_allow`.
- `level`: `info` \| `warn` \| `error`.
- `trigger`: `auto` \| `manual`.

`permission.request` is the single most valuable non-L0-ish event: it is the only reliable signal that an agent is **waiting on you**, which is exactly what the office is best at showing at a glance.

### 4.5 Inbound work (the mailbox)

These do not describe a session — they describe work *arriving*, and drive the paper-airplane animation. `session` MAY be a synthetic `{ "id": "queue" }`.

| Type | L0 | Meaning | Payload |
| --- | --- | --- | --- |
| `job.queued` | ⬜ | New work landed (Jira assignment, queued prompt, webhook). | `{ job_id, title, source?, url?, priority? }` |
| `job.claimed` | ⬜ | A session picked it up. | `{ job_id, claimed_by }` |
| `job.dropped` | ⬜ | It was cancelled or binned. | `{ job_id, reason? }` |

### 4.6 Harness name registry

`harness.name` is a slug so the office can colour-code and label consistently. Reserved: `claude-code`, `rovo-cli`, `cursor`, `codex-cli`, `openclaw`, `mock`. Anything else is allowed and rendered generically.

### 4.7 Harness variant

One harness binary can have more than one front door. `claude-code` is reached from a terminal, from Claude Desktop's local agent mode, and from the SDK — the same program, but not the same thing to someone watching the room. Optional `harness.variant` names which:

| variant | means |
| --- | --- |
| `cli` | started from a terminal |
| `desktop` | started by a desktop application |
| `sdk` | driven programmatically |

Rules, because a display hint that becomes a routing key stops being optional:

- **Advisory and display-only.** A consumer MUST NOT route, filter or subscribe on `variant`. The office subscribes by `harness.name`; a CLI session and a desktop session are the same source, shown with a different suffix.
- **Never part of identity.** Office identity stays `harness.name + ":" + session.id` (§3.2). A variant is a property of how the session was started, not of who it is.
- **Free-form beyond the table.** An adapter meeting an unfamiliar front door SHOULD pass a sanitised slug rather than nothing; an office renders what it does not recognise verbatim.

An adapter that cannot tell, omits it.

## 5. Transport

Every path below is relative to an **office**: the receiver hosts as many as have
keycards, and each keeps its own buffer and its own subscribers, so two visitors
holding different keycards cannot see each other's agents. In full, ingest is

```
POST /office/<keycard>/aop/v0/events
```

and the same prefix applies to `/stream`, `/state` and `/health`. Emitters never
build that URL: they post to whatever `AOP_URL` or `~/.roving-office/endpoint.json`
names, which is how one machine's hooks are pointed at one office without any adapter
knowing what a keycard is — and equally how they are pointed at an office on a
different host, since a URL is a URL. The unprefixed paths remain as an alias for whichever office currently
holds that endpoint, so a recipe written before offices had addresses still works.

### 5.1 Ingest — `POST /aop/v0/events`

- Body: one JSON object, **or** NDJSON for batches, **or** a JSON array.
- `Content-Type: application/json` or `application/x-ndjson`.
- `Content-Encoding: gzip` MUST be accepted.
- Success: `202 Accepted`, body `{"accepted":N,"dropped":M}`. Receivers MUST respond before doing any scene work.
- Errors: `401` bad token, `413` body over 256 KiB, `400` unparseable. An emitter treats **every** failure identically: log locally, never retry inline, never block the agent.

### 5.2 Fan-out — `GET /aop/v0/stream` (SSE)

The browser cannot listen on a socket, so the office server fans out over SSE. Each AOP event becomes one SSE frame with `event:` set to the AOP `type` and `data:` set to the JSON envelope. `id:` carries a receiver-assigned monotonic cursor so a reconnecting browser can resume with `Last-Event-ID`. A `: ping` comment every 15 s keeps intermediaries honest.

### 5.3 Snapshot — `GET /aop/v0/state`

Returns `{ cursor, events: [...] }` — a **replay** of the events belonging to sessions still in flight, in order, filtered by `?harness=`. A page reload calls this first, then subscribes to the stream from `cursor`. Without it, a refresh would empty the office even though five agents are mid-turn.

Replay rather than a pre-reduced world is deliberate: the receiver would otherwise need its own copy of the reducer in §6, and two reducers drift. Sessions that ended, or that went quiet past the TTL in §7.4, are left out — resurrecting an agent that finished an hour ago just to reap it again is worse than not showing it.

### 5.4 Buffering

The receiver keeps a ring buffer of the last N events (default 2 000) and the reduced state. It is intentionally memory-only: the office is a window onto *now*, not a historian.

### 5.5 Discovery and auth

| Concern | Rule |
| --- | --- |
| Host | Any. A receiver may be on loopback or on the other side of the internet, and an emitter treats the two the same way apart from its timing budget (§5.6). |
| Port | The first free port from `8080` to `8095`, or exactly the one named as the first argument: `node server.cjs 8081`. Adapters never need to know it — the port that matters is the one in the endpoint file below. |
| Endpoint file | `~/.roving-office/endpoint.json` = `{ "url", "token", "keycard", "aop": "0.1" }`, mode `0600`. A local receiver writes it on start **when started with `--publish`**, and adds its own `pid` — one without the flag is private and never touches the file, because several receivers run at once and only one of them can own a machine-wide path; `aop-connect` writes it for a remote receiver and adds `remote: true` and `host`. Adapters read it instead of hardcoding. |
| Environment override | `AOP_URL` and `AOP_TOKEN` take precedence over the file. There is one endpoint file and it holds one URL, so the environment is how a single shell feeds a different office without redirecting the whole machine. |
| Endpoint ownership | Only the process whose `pid` is in the file may delete it. A missing `pid` is **not** consent: a remote endpoint has none, and treating absence as ownership silently disarms every hook on the machine. |

#### Two capabilities, not one

| Capability | Size | What it opens | Where it comes from |
| --- | --- | --- | --- |
| **Keycard** | 8 characters | **Reads.** `GET /stream`, `/state`, `/health`, and the office page. Short because a person says it out loud. | The office URL itself. |
| **Write token** | `rot_` + 32 bytes hex | **Writes.** `POST /events`, for that office only. | The first is returned once by `POST /api/offices`; any later one by `POST /tokens`, which requires a token you already hold. Stored hashed, never re-readable. |

Compared in constant time, and sent in **`X-Roving-Office-Token`**. A local receiver additionally accepts its own per-process token from the endpoint file, which is what every local install already uses.

> **Emitters must not use `Authorization: Bearer` for a remote receiver.** Receivers accept
> it, and it is the obvious choice, but `Authorization` is a header that hosting layers
> legitimately claim as their own. Verified against a hosted office: the identical
> request succeeds with `X-Roving-Office-Token` and fails with `Authorization` — `401`
> where the platform strips the header before the app sees it, `502 hosted sandbox bridge
> token was rejected` where its gateway takes offence at a credential it cannot validate.
> The failure is indistinguishable from a wrong token, which is what makes it worth a rule
> rather than a footnote. A custom header is nobody else's business, so it arrives intact.

The split is the whole reason a keycard is safe to paste into chat: it invites someone to **watch** the office without letting them **staff** it.

#### 5.5.1 An office holds several write tokens

One token per office meant one shared secret: a second machine could only join by being handed the credential the first one held, and taking one machine away meant re-minting and reinstalling on all of them. So an office keeps a small list, each entry a hash, a public `id` and a human `label`.

| Route | Does | Needs |
| --- | --- | --- |
| `GET /office/<keycard>/aop/v0/tokens` | Lists what may write here — ids, labels, when each was made and last used. Never a token. | A token |
| `POST /office/<keycard>/aop/v0/tokens` | Mints another, `{ label }`, and returns the plaintext once. | A token |
| `DELETE /office/<keycard>/aop/v0/tokens/<id>` | Revokes that one, immediately, leaving the rest working. | A token |

**All three need a token, and a keycard is never enough.** This is the rule the whole split rests on: a keycard that could mint would be a keycard that can write. So capability begets capability — the office's first token arrives with the office, and every later one is chained off one already held. Listing is gated too, even though it reveals no secret, because it is a map of who can write into the room.

Three consequences worth stating rather than discovering:

- **Lose every token and the office is read-only for good.** There is no owner to recover through, because nothing here has owners — no login, no listing, no account. Mint another office.
- **The last token cannot be revoked.** Zero tokens is the unrecoverable state above, so the API refuses to arrive at it by accident (`409`). An office you want silenced is one you stop handing the keycard to; it reaps itself soon enough.
- **Tokens are flat and equal.** Any token may mint another and revoke any other, including the one that minted it. A parent-and-descendant tree would be the more careful model, and is not worth its weight for a room.

An office may hold **ten** at once — enough for every machine anyone plausibly points at one room, and few enough that the list stays readable. Verification sweeps the whole list in constant time and never returns early, so how long a refusal takes says nothing about the credentials held.

| Concern | Rule |
| --- | --- |
| Office absent | If the endpoint file is missing or the connect fails, the adapter exits 0 silently. Agents must run fine with no office attached. |
| Exposure | A receiver reachable from outside loopback serves any keycard presented to it. Whatever redaction the emitter applies (§10) is therefore the *only* thing standing between a session and that host — decide it before pointing adapters at a shared office, not after. |

### 5.6 Latency budget

| Stage | Budget |
| --- | --- |
| **Time the harness waits** | **≤ 1 s**, always, whatever else is true |
| Local POST, inline | connect ≤ 0.5 s, total ≤ 1 s |
| Remote POST, in a detached sender | connect ≤ 2 s, total ≤ 4 s, process ≤ 10 s |
| Receiver ack | ≤ 50 ms |
| Ingest → SSE frame | ≤ 100 ms |

Anything slower than this and the office stops feeling live; anything that blocks longer than this and the harness starts feeling laggy. When in doubt, drop the event.

Only the first row is a promise to the harness, and it is the one that cannot bend. The rest describe how the request is allowed to spend its own time — which is why a remote emitter **may hand delivery to a detached process**: it appends the batch to its spool, starts a sender nobody is waiting for, and returns. Measured against a hosted receiver, that keeps a hook at ~40 ms while the POST itself takes 700–900 ms, and it is the only arrangement where a slow network cannot become a slow agent. A remote emitter that insists on sending inline has to fit the whole round trip in the first row's budget, and against a real network it will not.

Delivery is therefore **at-least-once**: a spooled batch may be sent twice if a sender dies between the POST and its acknowledgement. Receivers already de-duplicate on `id` (§5.1), which is what makes that safe to rely on.

### 5.7 Avatars — `PUT /aop/v0/avatars/<sha256>`

An identity's picture is a *file*, on the harness's machine (§3.2). This is how it gets to
the office so that `actor_avatar` has something to point at.

| | |
| --- | --- |
| `PUT /aop/v0/avatars/<sha256>` | Body is the raw image bytes. **Write** — needs the token. `201` stored, `200` already had it. Responds `{ avatar, type, stored }`, and `avatar` is the path to send as `actor_avatar`. |
| `HEAD /aop/v0/avatars/<sha256>` | `200` if the office already holds it, `404` if not. **Read** — keycard only. |
| `GET /aop/v0/avatars/<sha256>` | The bytes, with the type the receiver sniffed. **Read** — keycard only, because an `<img>` cannot present a token. |

The name of the picture **is the SHA-256 of its bytes**, and everything convenient about
this route follows from that:

- Receivers MUST verify it. A name that can be checked is a name that cannot be stuffed; an
  unverified content address is just a slot with a long key.
- `PUT` is idempotent, so an emitter that has forgotten what it uploaded — every restart —
  may simply offer the file again. `HEAD` first makes that free.
- One picture shared by five agents is stored once, and may be cached forever by the
  browser.

Receivers MUST determine the type from the bytes and MUST refuse anything that is not a
raster image; PNG, JPEG, GIF and WebP is the set the reference receiver accepts. **SVG is
excluded deliberately** — it is a document that can carry script, and it would be served
from the office's own origin. Receivers SHOULD cap the body (2 MB in the reference
receiver, which is a portrait rather than a file host) and MUST serve what they store with
the sniffed type and `X-Content-Type-Options: nosniff`.

Emitters MUST NOT upload from inside a harness hook, because an upload cannot fit the
1 s budget of §5.6 and does not need to: send events immediately, upload alongside, and name
the picture on the next event that goes out.

## 6. Reduction: AOP → stage directions

Normative mapping from AOP to the internal `AgentManager` events, so every adapter behaves identically on screen.

| AOP | Stage direction |
| --- | --- |
| `session.start` | `spawn` (walk in, hang coat) |
| `turn.start` | addressed `mail`; the first/new substantive title becomes the stable job, while follow-up turns reuse it; `status: working` |
| `turn.start` with `payload.plan` | the checklist rides **inside the envelope**, so it appears when the agent opens it |
| `turn.title` | the job already in hand is **renamed in place** — desk label and surname follow, no second envelope and no status change |
| `step.start` | `step` — relabels which part is in hand. **No walk**: see §4.2 rule 5 |
| `step.end` | `step` — marks that part done; the last one clears the label |
| `tool.start` `read`/`edit`/`execute`/`other` | `status: working` |
| `tool.start` `search`/`network`/`knowledge` | `research` with `payload.target` as topic |
| `tool.start` `scm` | `status: delivering` |
| `tool.start` `wait` | `activity: couch` |
| `tool.start` `agent` | nothing directly — wait for the child `session.start` (§6.1) |
| `session.start` with `parent_id` | **ghost in** at the parent's desk, no walk-in |
| `session.end` with `parent_id` | **ghost out** — hand a page to the parent, dissolve |
| `permission.request` | `status: waiting` |
| `permission.resolve` | back to `working` |
| `notification` level `warn`/`error` | `status: waiting` |
| `error` | `status: error` |
| `turn.end` status `completed` | `dispatch` with `payload.summary ?? title` |
| `turn.end` status `cancelled`/`blocked` | `status: idle` |
| `turn.end` status `error` | `status: error`, then `idle` |
| `context.compact` | `activity: water` (a breather while it thinks) |
| `session.end` | `exit` (walk out) |
| `job.queued` | `mail` (paper airplane) |
| `job.claimed` | mailbox collection |
| `job.dropped` | bin |
| `session.heartbeat` | liveness only, no visible effect |

**Precedence.** When signals conflict, higher wins: `error` > `waiting` > `delivering` > `researching` > `working` > `resting` > `idle`. So a `permission.request` during a `tool.start` shows as waiting, and the office does not flap back to working until `permission.resolve`.

**Debounce.** Tool calls are often milliseconds long. The office MUST NOT start a walk animation for a `tool.start` whose matching `tool.end` arrives within 400 ms; it renders as continued desk work. Otherwise agents spend all day walking.

### 6.1 Subagents are ghosts

A subagent never walks through the door and never takes a desk. It **materialises at its parent's workstation as a translucent clone** — four people crowded around one screen, pair programming. The parent keeps the chair; the ghosts pull up phantom copies of it.

This is the right read for what a subagent *is*: not a colleague who came to the office, but an extension of one agent's hands, alive only for the length of a tool call.

```
            ghost 3   ghost 1
                  ╲   ╱
        ghost 4 ── ● PARENT ── ghost 2       ● = desk.seat, the real chair
                     │
                 ┌───┴───┐
                 │ desk  │  monitors
                 └───────┘
```

**Seat cloning.** Each ghost gets a cloned chair, placed by rotating the parent's `desk.seat` about the desk origin and pushing it outward, so the fan hugs the monitors:

| Ghost | Angle about the desk | Radius | Facing |
| --- | --- | --- | --- |
| 1 | `+0.42 rad` | `×1.18` | `desk.sitRotation + 0.42` |
| 2 | `−0.42 rad` | `×1.18` | `desk.sitRotation − 0.42` |
| 3 | `+0.80 rad` | `×1.34` | `desk.sitRotation + 0.80` |
| 4 | `−0.80 rad` | `×1.34` | `desk.sitRotation − 0.80` |

Ghosts alternate sides in arrival order, so two subagents flank the parent symmetrically rather than piling up on one shoulder.

**Appearance.** A ghost is a clone of the **parent's** body — same silhouette, so the family resemblance reads instantly — with:

| Property | Value |
| --- | --- |
| Opacity | `0.40` (`depthWrite: false`, no shadow cast) |
| Scale | `0.85` of the parent |
| Tint | Hue shifted by `session.agent_type` (`Explore`, `general-purpose`, …) |
| Name tag | The `agent_type`, not a person name, at reduced size |
| Status ring | Kept — a ghost that errors still goes red |
| Fade | In `400 ms`, out `600 ms` |
| Typing phase | Offset by `index × 0.37` of the cycle, so they aren't a chorus line |

**Ghosts do not travel.** A ghost's `tool.start` of class `search` or `knowledge` does **not** trigger a bookshelf trip; it changes the ghost's status ring and floating micro-label in place. Four ghosts pathfinding around the room at once would be visual noise, and it would destroy the one-screen reading that makes the mechanic work.

**Lifecycle.**

| Trigger | Effect |
| --- | --- |
| `session.start` with `parent_id` | Parent claims a desk if it hasn't; ghost fades in on the next free fan slot |
| Ghost `tool.*` | Status ring + micro-label only, no movement |
| `session.end` with `parent_id` | Ghost slides a page onto the parent's desk, then dissolves |
| `session.end` with `reason: error` | The page is crumpled — it goes to the bin on the parent's next trip |
| Parent's `tool.end` matching `parent_tool_call_id` | Dissolve any ghosts still standing (belt and braces) |
| Parent `session.end` | Dissolve every ghost first, then the parent walks out |
| Ghost TTL, 30 s of silence | Dissolve — far shorter than either main-session TTL (§7.4), because ghosts are short-lived by nature |

**The parent stays `working`, not `waiting`.** A parent blocked on subagents is not blocked on *you*, and `waiting` is reserved for "needs a human" (§6 precedence). Instead the parent's name tag carries a `×N` ghost count, and the desk gets a faint glow while the cluster is live.

**Overflow.** A maximum of **4 ghosts** are rendered per desk. Beyond that, the desk shows a `+N` tally and the extra sessions exist in the roster only, nested under their parent. Nested ghosts of ghosts (a subagent spawning its own subagent) attach to the **nearest ancestor that owns a desk** rather than fanning recursively.

**No desk free for the parent?** The cluster degrades together: parent to the couch, ghosts flanking on the couch and floor with the same fan maths about the couch seat.

## 7. Loss, gaps and recovery

The protocol assumes an unreliable emitter, so receivers implement all four:

1. **Implicit spawn.** Any event naming an unknown session creates that character first, using whatever `session` metadata the event carries. Adapters therefore never *need* `session.start` to have landed.
2. **Idempotency.** Duplicate `id` → drop. Duplicate `session.start` → no-op. Duplicate `session.end` → no-op.
3. **Gap detection.** A jump in `seq` marks the session `degraded`. The office may show it (a tiny frown on the name tag) but must keep animating.
4. **TTL reaping.** Silence is the only defence against `kill -9`, so a character whose session goes quiet is eventually shown the door — but **idleness is not evidence of death**, and the original 90 s fired on ordinary human pauses: read a reply, type a follow-up, and your agent had already left and had to walk back in. Hook-based adapters make this worse, because they are dead between events and cannot heartbeat at all; for them, quiet is the normal state of an alive session.

   So the office runs **two clocks**, chosen per session by what the adapter promised in `capabilities` (§4.1):

   | The adapter | Reaped after | Why |
   | --- | --- | --- |
   | declares `session.end` | **30 min** | It has promised to say goodbye, so silence means "thinking", and the timer is only a backstop for a process that died mid-sentence |
   | does not | **5 min** | Nothing will ever announce the end, so the office has to guess — but slowly enough to survive a coffee |

   An adapter that *can* heartbeat should, and keeps its character alive indefinitely. One now does: the OpenClaw plugin is in-process and long-lived, so heartbeating is a timer rather than an impossibility ([adapter notes §5.4](aop-harness-adapters.md#56-what-being-long-lived-actually-buys)). Ghost sessions (§6.1) reap after **30 s**, and are also dissolved when their parent ends or the spawning tool call closes — so a lost `session.end` for a subagent costs at most half a minute of a lingering ghost.

Out-of-order events are accepted. A `tool.end` with no matching `tool.start` is ignored; a `turn.end` with no `turn.start` still counts as a delivery.

## 8. Worked example

A Claude Code session that greps, edits and finishes, with a permission stop in the middle. Envelope fields trimmed for readability.

```jsonl
{"type":"session.start","seq":1,"payload":{"source":"startup","capabilities":["session.start","session.heartbeat","session.end","turn.start","turn.end","tool.start","tool.end","permission.request"],"model":"claude-sonnet-5"}}
{"type":"turn.start","seq":2,"payload":{"title":"Fix the nav grid around the couch","trigger":"user"}}
{"type":"tool.start","seq":3,"payload":{"tool_call_id":"t1","tool_name":"Grep","tool_class":"search","target":"obstacleFootprints"}}
{"type":"tool.end","seq":4,"payload":{"tool_call_id":"t1","status":"ok","duration_ms":820}}
{"type":"permission.request","seq":5,"payload":{"request_id":"p1","tool_name":"Edit","tool_class":"edit","target":"src/config.js"}}
{"type":"permission.resolve","seq":6,"payload":{"request_id":"p1","decision":"allow","by":"user"}}
{"type":"tool.start","seq":7,"payload":{"tool_call_id":"t2","tool_name":"Edit","tool_class":"edit","target":"src/config.js"}}
{"type":"tool.end","seq":8,"payload":{"tool_call_id":"t2","status":"ok","duration_ms":140}}
{"type":"artifact.change","seq":9,"payload":{"kind":"file","path":"src/config.js","added":6,"removed":2}}
{"type":"turn.end","seq":10,"payload":{"status":"completed","summary":"Couch footprint widened; path reroutes cleanly","duration_ms":18400}}
{"type":"session.end","seq":11,"payload":{"reason":"exit","duration_ms":42000}}
```

On screen: a character walks in, sits, goes to the bookshelf, comes back, turns amber while waiting on the permission prompt, works, then carries a page to the outbox and leaves.

### 8.1 A fan-out, as ghosts

Two subagents spawned from one `Job` call. Note that both children carry `session.parent_id` and the same `parent_tool_call_id`, and that neither ever appears at a desk of its own.

```jsonl
{"type":"tool.start","session":{"id":"S1"},"payload":{"tool_call_id":"t9","tool_name":"Job","tool_class":"agent"}}
{"type":"session.start","session":{"id":"S2","parent_id":"S1","kind":"subagent","agent_type":"Explore"},"payload":{"source":"spawn","parent_tool_call_id":"t9"}}
{"type":"session.start","session":{"id":"S3","parent_id":"S1","kind":"subagent","agent_type":"Explore"},"payload":{"source":"spawn","parent_tool_call_id":"t9"}}
{"type":"tool.start","session":{"id":"S2","parent_id":"S1"},"payload":{"tool_call_id":"t10","tool_name":"Grep","tool_class":"search","target":"nightlights"}}
{"type":"session.end","session":{"id":"S2","parent_id":"S1"},"payload":{"reason":"exit"}}
{"type":"session.end","session":{"id":"S3","parent_id":"S1"},"payload":{"reason":"exit"}}
{"type":"tool.end","session":{"id":"S1"},"payload":{"tool_call_id":"t9","status":"ok","duration_ms":31000}}
```

On screen: two translucent copies of the agent fade in either side of their chair, one of them turns bookshelf-blue *without getting up*, then each slides a page onto the desk and dissolves. The parent never left its seat and never showed as blocked.

## 9. Conformance levels

An adapter declares its level in `session.start.payload.capabilities`; the level is derived from what it lists.

| Level | Requires | What the office can show |
| --- | --- | --- |
| **L0 — presence** | `session.start`, `session.end`, `session.heartbeat`, `turn.start`, `turn.end`, `permission.request` | Who is in the office, what they are working on, who is blocked, when work ships. |
| **L1 — activity** | L0 + `tool.start`, `tool.end` with correct `tool_class` | Desk vs bookshelf vs outbox movement; researching status; realistic pacing. |
| **L2 — full** | L1 + `artifact.change`, `context.compact`, `notification`, `error`, `permission.resolve`, `job.*` | Paper airplanes, bins, filing, error states, artefact counts on the desk. |

Every level MUST: send valid envelopes, exit 0 always, respect the latency budget, and honour §10.

## 10. Privacy and redaction

Sessions contain source code, credentials and customer data. AOP is designed so the interesting rendering needs none of it.

| Rule | Detail |
| --- | --- |
| Never send | File contents, tool results, full transcripts, environment variables, secrets, diffs. |
| `redaction` mode | `session.start.payload.redaction` = `metadata` (default) \| `summary` \| `full`. |
| `metadata` | Tool names, `tool_class`, paths, durations, counts. No free text from the model or user. `title` is replaced by a generic label — **unless it is an `origin.name`**, see the next row. A `turn.title` is not sent at all: a generic label is what the turn already carries, and re-sending it is an event that says nothing. |
| `metadata` and `origin` | `kind`, `name`, `id` and `schedule` **survive**; `detail` does not. A job's name is typed by an operator into a scheduler config, not by a user into a prompt: it is the same category of thing as a tool name or a file path, both of which this mode already sends. So a scheduled turn MAY use `origin.name` as its `title` at `metadata`. This is a deliberate extension rather than an oversight, and the alternative is what motivated it — `metadata` is the default, and withholding an operator's own label made every scheduled desk in every default install read `Working`, which looks like a fault and protects nobody. `detail` is free text about one run and stays behind. |
| `metadata` and steps | A step `title` is a todo item the *model* wrote, so it is free text and it goes. `step_id`, `index`, `of` and `status` are counts and survive, and the office says "Step 2 of 5" — which is the shape of the work without a word of its content. `plan` degrades to its length for the same reason. |
| `metadata` and `target` | A `tool.start.target` is a label for one tool call, and what it may say depends on what kind of thing it is. A **path** — the argument keys `file_path`, `path`, `new_path`, `notebook_path`, `file`, `filename`, `file_paths[0]`, `paths[0]`, `folder_path` — is exactly what this mode permits and is sent, tidied per the Paths row. <!-- redaction:target-path --> So is a **declared name**, `prompt_name`: an identifier somebody saved, the same category as a tool name. <!-- redaction:target-name --> So is a **command**, reduced to the program and its subcommand and never a whole command line. <!-- redaction:target-command --> A **search** — `pattern`, `content_pattern`, `query` — is the model's own words, so **no `target` is sent at all** and `tool_class` carries the fact that a search happened. <!-- redaction:target-search --> A **URL**, `url`, sends its **host only** — no path, no query string, no `userinfo` — the same reduction the Remotes row requires, and for the same reason. <!-- redaction:target-network --> Truncation is not redaction: capping free text at 200 characters is 200 characters of free text. |
| `summary` | Adds `title`, `summary`, `notification.message`, `error.message`, step and `plan` titles, each truncated to 200 chars. **And the whole `target`**: a search's pattern, a web query and a full URL are free text like any other, so this is the mode that buys them. |
| `full` | Adds `payload.prompt`. Requires an explicit opt-in env var (`ROVING_OFFICE_INCLUDE_PROMPTS=1`); adapters MUST NOT default to it. |
| Paths | Absolute paths SHOULD be made relative to `session.cwd`. `$HOME` is replaced with `~`. This includes `session.cwd` itself (§3.2) and a `repo.remote` that is a local directory rather than a host. |
| Remotes | `project.repo.remote` MUST NOT carry a `userinfo` component: `https://<user>:<token>@host/owner/repo` is a common form of `git remote get-url`, and forwarding it verbatim publishes a live credential. Send `host/owner/repo` (§3.3), and send nothing when a remote cannot be reduced to one. |
| Truncation | Every string field is hard-capped: `title` 80, `summary` 200, `message` 200, `target` 200, `prompt` 2 000. A step `title` is a desk label like any other, so it caps at 80. |
| Plan length | `plan` is capped at **20 entries**, and a longer one is truncated rather than dropped — the office shows the remainder as a count. A 200-item list is not a plan, and it would ride on an event that repeats. |
| Redaction is emitter-side | The receiver never sees what was dropped, so a leak cannot be un-leaked downstream. |

## 11. Versioning

- `aop` is `"<major>.<minor>"`. **Minor** = additive only (new event types, new optional fields, new enum members). **Major** = anything that could break a reducer.
- Receivers: reject a different major with `400`; accept any minor; ignore unknown `type` values; ignore unknown fields; treat unknown enum members as the family's fallback (`tool_class` → `other`, `reason` → `other`, `level` → `info`).
- Emitters: never repurpose a field's meaning; add a new one instead.
- Vendor extras live in `ext`, never at the top level.

**`0.2` added `turn.title` (§4.2), and that is what a minor bump is for.** One new event
type, no field repurposed and no reduction changed: a receiver written against `0.1`
ignores it by the rule above and renders a turn exactly as it did, because the title it
was already going to read on `turn.end` still arrives. The bump is not a warning, then —
it is the emitter saying which vocabulary it has, which is the one thing a receiver
cannot work out for itself. Contrast the paragraph below, where nothing about the wire
moved at all.

**Remote hosts did not bump the version, and §1 says they should have.** Its preamble —
"not negotiable without a version bump" — is about the *wire*:
an `aop` bump exists to tell a reducer that its assumptions may have moved. Nothing moved.
No event type, field, enum member or reduction changed; a receiver written against `0.1`
handles a remotely-emitted event and a loopback one identically, because they are the same
bytes. What changed is where an emitter may post them, which capability authorises it, and
how long it may take — all of it §5, none of it observable to a reducer. Rule 5 is
therefore restated rather than versioned. An emitter or receiver that reads only §§3–4 and
§6 needs no changes at all, which is the test the version number is meant to answer.

## 12. Open questions

1. **Cost and usage rendering.** `usage` is specified but unused. Does the office want a meter on the wall, or is that clutter? Note the loose end either way: `usage` exists here only as a *payload field* on `session.end` and `turn.end`, but `AopSource`'s accepted-type list also carries a bare `usage` **event type** that §4 never defines. Whichever way this question is answered, one of the two should give.
2. **Multi-window sync.** §3.4.2 settles routing (project = office, second window for a second office), but two windows pinned to the *same* office both animate independently from the same event stream. Harmless, or should the reduced state be authoritative in the receiver so both windows agree frame-for-frame?
3. **Bidirectional control.** Should the office be able to *answer* a `permission.request` (click the waiting agent → allow)? That needs a reverse channel and turns AOP into a control protocol, with a much bigger security story. Deliberately out of scope for v0.
4. **Team-scale privacy.** Two people, one office, is a nice demo and a surveillance risk. Any remote fan-out needs an explicit consent model.
5. **Idle vs resting.** Harnesses report "waiting for user" as idle. Should a long idle session sit on the couch, or leave and come back?
6. **Ghost fan-out beyond four.** §6.1 caps visible ghosts at four with a `+N` tally. A 10-way fan-out is increasingly common — is the tally enough, or does a big fan-out deserve its own staging (a huddle around the bookshelf, a meeting room) once the meeting room lands?

See [`aop-harness-adapters.md`](../protocol/aop-harness-adapters.md) for how each harness can emit this, and [`aop-v0.schema.json`](./aop-v0.schema.json) for the machine-readable schema.
