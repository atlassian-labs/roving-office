# Origin and steps: what an agent is doing, and why

> **Status: part built.** It describes two additions to AOP — an **origin** on a
> turn and a **step** layer inside one — plus the emitter and receiver work each
> needs, and the order to do it in. Track B (steps) is built to B3. Track A is
> built to A3 **for cron jobs**: a scheduled run now names its job on the desk at
> the default redaction. What is left of Track A is the arrival (A4, TRO-103), and
> what is left of Track B is OpenClaw's heartbeat (B4). Parent issue:
> TRO-96, *"for each client, I believe
> we can improve the text sent and read"*. Per-client children: TRO-97 (Claude
> Code), TRO-98 (OpenClaw), TRO-99 (Rovo CLI).

Someone watching the office asks two questions about a character, in this order:

1. **What is it doing?**
2. **Why is it doing it?**

Today the office can answer neither for a scheduled run. The desk label says
`Working`; the log's detail column says `exec · [execute] ·
/home/mcannonbrookes/.openclaw/workspac…`. Both are true and neither is useful.

## Two changes, not one

The two questions are two independent changes, and keeping them apart is what stops
this becoming one unshippable lump. Either can land first; neither blocks the other.

| | **Origin** — why the work exists | **Steps** — what it is doing now |
| --- | --- | --- |
| Adds | `turn.start.payload.origin` | `plan`, `step.start`, `step.end` |
| Generality | General in the wire and the receiver, **OpenClaw-only in practice**: it is the only harness with scheduled work. `trigger` is already in the spec and populated by everyone, but `claude-code.cjs:357` and `rovo-cli.cjs:200` only ever send `'user'`. | **General to every harness.** Claude Code and Rovo CLI can feed it today; OpenClaw's heartbeat is the case that motivated it and the last able to supply it. |
| Alone, it buys | A cron run that names its job on the desk | A session that shows which part of its list it is on |

**The design rule for steps, which falls out of the shape of the work:** a job is
*sometimes* one step and *sometimes* a walk through several, so the step layer is
**optional and its absence means "one step"** — never "data missing". If simple work
needs a ceremonial single `step.start` in order to render properly, the model is
wrong. Most turns will never carry a step and must look right anyway.

Two further faults belong to neither change and should not be smuggled into either:
the `target` truncation (shared mapper code, all three harnesses, blocked by nothing)
and the log's own readability (receiver only). Four pieces of work, of which two are
modelling.

---

## 1. Three sides, and which one owns each fault

Almost every confusion in this area comes from mixing up where code runs. There are
three places, and the middle one is a hard boundary: **a field either exists in the
JSON or the receiver cannot invent it.**

| Side | Where it runs | What it owns |
| --- | --- | --- |
| **Emitter** | Inside the OpenClaw gateway process, on the agent's box | `openclaw-plugin/lib/map.mjs`, and the shared brains it borrows from the checkout: `bin/lib/aop-core.cjs` (how much may be said, and how short) and `bin/mappers/lib/tool-classes.cjs` (what a tool call is *about*). The only side that can see the truth, and the only side that throws it away. |
| **Wire** | `docs/aop-spec.md`, `server.cjs`, `lib/aop-bus.cjs` | Which fields exist. The server stores and relays; it never adds meaning. |
| **Receiver** | The browser | `src/data/AopSource.js` (events → scene instructions), `src/debug/event-row.js` (the log line), `src/agents/*` and `src/scene/*` (the room). Can only rearrange, phrase and dramatise what arrived. |

Against that, the five current faults:

| # | Fault | Side | Evidence |
| --- | --- | --- | --- |
| 1 | `target` is cut to 40 chars, tail-first, without `tidyPath` | Emitter | `bin/mappers/lib/tool-classes.cjs:104` — `clamp(command.split(/\s+/)[0], 40)`. The spec allows 200 (`aop-core.cjs:53`). The command's first token was `…/workspace-paige/scripts/ingest-room-to-read-mail.sh`; tidied against `session.cwd` it would have read `scripts/ingest-room-to-read-mail.sh`, in full, well under the cap. **The ellipsis is in the JSON, not the CSS.** |
| 2 | ~~The desk label is hard-coded `Working`~~ **Fixed for scheduled runs** | Emitter | `map.mjs:492` — `mode === 'metadata' ? 'Working' : …`, and `resolveRedaction()` (`aop-core.cjs:351`) **defaults to `metadata`**. In that same mode the office is already told the tool, the class and the path, so the silence is not privacy — it is an unmade decision. |
| 3 | ~~A cron may be reported as a human request~~ **A `memory` or `overflow` run is** | Emitter | **Verified, and the other way round.** `ctx.trigger` is a closed enum — `cron \| heartbeat \| manual \| memory \| overflow \| user` — and `TRIGGERS` (`map.mjs:145`) already covers four of the six, cron among them. So a cron *is* reported as scheduled; the desk says `Working` because the **title** falls back (#2), not the trigger. What the `?? 'user'` fallback at `map.mjs:496` really mislabels is `memory` and `overflow` — an agent flushing memory or shedding context, drawn as a person asking for something. |
| 4 | ~~Nothing on the wire says *which* job~~ **`origin` does, as of A1** | Wire | `turn.start` carries `{ turn_id?, title, prompt?, prompt_chars?, trigger? }` (spec §4.2). Paige knows the job's name, id and cron expression. There is nowhere to put them. |
| 5 | The one cron signal that does arrive is discarded | Receiver | `AopSource.js:325` reads `p.title` and drops `p.trigger`. Outside one line of log text (`event-row.js:141`), `trigger` is read nowhere in the receiver. |

Two smaller receiver faults worth folding in: the log has no column headers
(`src/debug/debuglog.html:44` is a bare `<ol>`; the seven columns are *time · mark · type ·
character · who · session · detail*), and `event-row.js:153` prefers `target` over
`summary`, so the spec's `tool.start.summary` could never show even if an emitter
sent one — none does.

---

## 2. The model today

```
session ─┬─ turn ─┬─ tool.start / tool.end
         │        └─ artifact.change
         └─ turn ─┬─ …
```

A turn is one prompt-to-answer cycle. A tool call is one action. **There is nothing
in between** — no way to say "this turn has six parts and I am on the second". That
is exactly the shape an OpenClaw heartbeat has, so the gap is not academic.

---

## 3. OpenClaw's two kinds of scheduled work

They are different shapes and must not be flattened together.

| | **Cronjob** | **Heartbeat** |
| --- | --- | --- |
| Does | One job | A set of jobs, in order |
| Identity | A name, an id, a cron expression — e.g. *"Paige hourly Room to Read Gmail check"*, `cbcfacee-…`, `17 * * * *` | A named routine with a documented checklist |
| Announces | Only when there is something to say | Only when something changed |
| AOP shape | One turn, one implied step | One turn, **many steps** |

Paige's own account of hers, which is the worked example for the rest of this doc:

**Cronjob** — *Paige hourly Room to Read Gmail check*. Runs at `:17` UTC; scans the
read-only Gmail accounts for new Room to Read / board mail, ingests it, alerts only
if there is something new. One job, start to finish.

**Heartbeat** — six documented jobs: ingest Room to Read mail; check the board-docs
inbox; update the action tracker; update the board-doc manifest; sync Paige's brain;
stay quiet if nothing changed.

Note the last one. **"Stay quiet if nothing changed" is not a step** — it is an
outcome. The test for a step is mechanical: *a step starts, finishes, and can fail
on its own.* Applying it leaves five steps and one delivery rule, and that test is
what keeps a documented workflow from turning into a padded progress bar.

---

## 4. The proposal

Two additive changes. Additive is enough: spec §11 already requires receivers to
ignore unknown fields, so an old office and a new emitter continue to interoperate,
minus the new detail.

### 4.1 Origin — *why* (emitter → wire → receiver)

`turn.start.payload.origin`, an object:

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | enum | `human` \| `schedule` \| `heartbeat` \| `queue` \| `parent` \| `retry` \| `webhook`. Supersedes `trigger` in expressiveness; `trigger` stays, populated for compatibility. |
| `name` | string ≤ 80 | What the operator called it — *"Paige hourly Room to Read Gmail check"*. |
| `id` | string ≤ 80 | The harness's id for the job, so repeat runs of one job are groupable. |
| `schedule` | string ≤ 40 | `17 * * * *`, or `hourly`. Rendered as *"at :17 past the hour"* by the receiver, not by the emitter. |
| `detail` | string ≤ 200 | Free text, `summary` redaction and above only. |

`kind` splits `schedule` from `heartbeat` deliberately: one is a single errand, the
other is a round. The office draws them differently (§5).

**The redaction question, stated plainly.** A cron job's name is written by the
operator in a config file. It is not the user's words, not model output, and not
conversation content — it is the same category of thing as a tool name or a file
path, both of which `metadata` mode already sends. So: **`kind`, `name`, `id` and
`schedule` are permitted at `metadata`; `detail` is not.** That is a deliberate
extension of spec §10 and needs to be written into the table there, and into the
`//` note in `~/.roving-office/settings.json`, rather than left implicit.

### 4.2 Plan and steps — *what* (emitter → wire → receiver)

**`turn.start.payload.plan`** — optional, an ordered array of `{ id?, title }`. The
checklist, when it is known up front, which is exactly the case for a heartbeat.
Omit it when the work is discovered as it goes.

**`step.start` / `step.end`** — two new event types in §4.2:

| Type | Payload |
| --- | --- |
| `step.start` | `{ step_id, turn_id?, index?, of?, title }` |
| `step.end` | `{ step_id, status, duration_ms?, summary? }` — `status` as `turn.end`: `completed` \| `error` \| `cancelled` |

Rules, so the receiver can be a simple state machine:

- A step lives **inside** a turn and never outside one.
- **A turn with no steps is a one-step turn**, and is the common case. An emitter
  that cannot see steps sends none, and the office draws exactly what it draws today.
  A single ceremonial `step.start` wrapping a whole turn is noise and MUST NOT be
  emitted.
- **One open step per session.** A `step.start` implicitly ends the previous step as
  `completed`; a `turn.end` implicitly ends any open step. Emitters SHOULD send
  `step.end` anyway — a crash mid-step is the interesting case and only an explicit
  `error` tells that story.
- A step contains zero or more tool calls. Tool calls stay exactly as they are;
  steps do not replace them and do not wrap them in the payload.
- `index`/`of` are for display only (*"2 of 5"*). An emitter that cannot count
  omits them.
- A plan is a *hint*. Steps that do not appear in it are legal; plan entries that
  never start are legal too (a heartbeat that skips a job because nothing changed
  is the normal case, and is the honest thing to draw).

### 4.3 Paige's heartbeat, on the wire

```jsonc
// 1. why, and the whole round up front
{ "type": "turn.start", "payload": {
    "title": "Heartbeat",
    "trigger": "schedule",
    "origin": { "kind": "heartbeat", "name": "Paige heartbeat", "id": "…", "schedule": "…" },
    "plan": [
      { "title": "Ingest Room to Read mail" },
      { "title": "Check board-docs inbox" },
      { "title": "Update action tracker" },
      { "title": "Update board-doc manifest" },
      { "title": "Sync Paige brain" }
    ] } }

// 2. what, right now
{ "type": "step.start", "payload": { "step_id": "s1", "index": 1, "of": 5, "title": "Ingest Room to Read mail" } }
{ "type": "tool.start", "payload": { "tool_name": "exec", "tool_class": "execute",
                                     "target": "scripts/ingest-room-to-read-mail.sh" } }
{ "type": "tool.end",   "payload": { "status": "error" } }
{ "type": "step.end",   "payload": { "step_id": "s1", "status": "error" } }

// 3. the round carries on, and the failure survives to the end
{ "type": "step.start", "payload": { "step_id": "s2", "index": 2, "of": 5, "title": "Check board-docs inbox" } }
```

And the cronjob, which needs no plan and no steps — the origin is the whole answer:

```jsonc
{ "type": "turn.start", "payload": {
    "title": "Room to Read Gmail check",
    "trigger": "schedule",
    "origin": { "kind": "schedule", "name": "Paige hourly Room to Read Gmail check",
                "id": "cbcfacee-4c25-4f4f-963d-292d0d02dff8", "schedule": "17 * * * *" } } }
```

Note what fault #1 costs here and what fixing it buys: with `target` tidied rather
than truncated, the failing tool call *names the script*, and the log line reads
`exec · [execute] · scripts/ingest-room-to-read-mail.sh` — which is precisely the
sentence Paige put in her Telegram message, arrived at independently.

---

## 5. What the receiver does with it

### 5.1 The label is two fields, not one — in fact three [built, TRO-102]

The job and the step are **separate fields on the agent record**. This is not a
style preference. `Agent.renameOpenJob()` overwrites the label of the open job
*without* opening a new history entry — so driving steps through it would shred one
heartbeat into five unrelated entries in "Recent jobs" and lose the umbrella that
makes them mean anything.

**Correction from building it.** The warning above is right about the wrong field, and
there turned out to be *three*, not two. There were already two job fields, and this
doc's "job" is the stable one:

| Field | What it is | Who writes it |
| --- | --- | --- |
| `history[n].label` | The **piece of work**. Must not move for the length of a turn, or one round logs as five. | `beginJob` / `renameOpenJob` |
| `job` | The running **headline** — already retitled mid-turn, to `"Looking up: auth token scopes"` at the bookshelf and `"Done: …"` on the walk to the mailbox. | the manager, constantly |
| `step` | The **part**, new here. | `setStep`, per `step.start` |

So neither existing field was free, and `step` (with `plan` beside it) is a third. The
ladder as built:

```
history label   the round     "Nightly sweep"           never moves in a turn
step            the part      "(2/5) Ingest mail"       moves per step.start
job            the headline  "Looking up: …"           moves per activity
```

Rendered together where there is room:

- **Strip / roster row** — `Paige heartbeat · (2/5) Ingest Room to Read mail`; several active plan entries become separate wrapping lines
- **Inspector** — the job, then its steps nested under it, ticked, failed, or not
  yet reached. The plan is what makes "not yet reached" drawable. Once complete, its
  last snapshot stays under the one Recent jobs entry: *Done (5/5)* opens to the
  individual parts.
- **Log** — `step.start` gets its own row and the **turn** family colour, not tool: a
  round walking its list should read as one long turn rather than a burst of tool
  traffic. The plan appears on the `turn.start` row as a count (*"5 steps"*). As built
  it needed no new *mark*, because the mark column carries the harness rather than the
  event type (TRO-105), and no filter change either, because the filter list discovers
  types from what arrives.
- **Scene** — built as a second smaller pill slung under the name tag, and then
  **taken out again**: it worked and it read, but two stacked labels over one small
  character is a lot of furniture over somebody's head, and the right treatment for a
  part in the scene is not yet known. The step lives on the panels for now, where there
  is room to be wrong about it cheaply. Whatever replaces it wants to be *one* label
  rather than two — the head has room for a single line, so a part shown there is a
  part shown **instead of** the name, not underneath it.
- **First-person HUD** — not in the original list, and the surface with the strongest
  claim to it: standing at somebody's shoulder is the one view whose whole purpose is
  "what is this person doing *right now*".

### 5.2 The label ladder

One shared helper in `aop-core.cjs`, used by all three mappers, replacing three
copies of `?? 'Working'`:

```
origin.name  →  step title  →  prompt's first line  →  origin.kind phrasing
             →  tool-derived ("Running ingest-room-to-read-mail.sh")  →  "Working"
```

`Working` stays, as the last resort rather than the first. Everything above the
prompt in that ladder is permitted at `metadata`, which is what makes the default
mode useful instead of mute.

### 5.3 Who brought it: the delivery

`AopSource.js:325` turns a `turn.start` into `{ type: 'mail', job, forId }` — a
paper dart through the window for a letter, a courier at the door for a package
(`docs/job-delivery.md` §1a). The channel is currently chosen by **how big** the
request is. For scheduled work that is the wrong axis: what a viewer needs to see is
**who asked**, and for a cron the honest answer is *nobody asked; the clock did*.
Dressing a 3am ingest as a man knocking at the door is the same small lie as calling
it "Working".

So `origin.kind` picks the channel, and size only picks between letter and package
within the human one:

| `origin.kind` | Delivery |
| --- | --- |
| `human` | As today — dart or courier, addressed to the session. |
| `schedule`, `heartbeat` | Nobody knocked. Staged: **first** a clock mark in the log, a chip on the strip row and an honest label; **then**, once the text is right, its own arrival — a robot or drone, which reads instantly and is truthful. |
| `queue` | Unaddressed post, as `job.queued` already is (`AopSource.js:374`). |
| `parent`, `retry` | No delivery. Nothing arrived from outside. |

Two corrections that fall out of this. `job-delivery.md` §1 currently lists "a
scheduled job" as *unaddressed* post that any agent may claim — but Paige's cronjob
targets Paige's session, so a scheduled run stays **addressed** and only queued work
is unaddressed. And the courier is one-at-a-time by design, so a robot arrival needs
its own queue rather than sharing his; that is a prop-level concern, and it is why
the prop comes last in §7 rather than first.

### 5.4 A failure at 3am must survive until morning

Paige's `Bash failed: ./scripts/ingest-room-to-read-mail.sh` reached Telegram and
the office never heard about it. With steps, the shape is already there: `step.end`
with `status: error` inside a turn that itself ends `error`, drawn as a trip to the
bin, and — because nobody was watching at the time — a mark that persists rather
than a moment that passes. Under `metadata` the message text is withheld, but the
*class* of failure and the script's name are both permitted, and together they are
the whole of the useful part.

---

## 6. Where steps come from, per harness

This is the honest table, and it is why the step layer is not speculative: two of
the three harnesses can feed it today, with no discovery needed at all.

| Harness | Signal | Status |
| --- | --- | --- |
| **Claude Code** | `TodoWrite` — a plan *and* a current item, in one tool call | **Built** (TRO-102), through `bin/mappers/lib/todo-steps.cjs`. Was classified `other` and discarded. |
| **Rovo CLI** | `update_todo` — nearly the same shape | **Built** (TRO-102), same module — and corrected in TRO-99, where `merge: true` turned out to make an update a patch by id rather than a list. See [adapter notes §4.6](../protocol/aop-harness-adapters.md#46-update_todo-steps-and-why-it-fires-at-the-start). |
| **OpenClaw cronjob** | One job; `origin` is the whole answer | **Answered.** `ctx.jobId` on the agent context, and a `cron_changed` hook carrying the job's `name`, `id` and `schedule`. Nothing to infer. |
| **OpenClaw heartbeat** | The checklist is in `HEARTBEAT.md`, in the agent's workspace — route 2, not route 1 | **Half answered.** A `plan` is readable off that file the way `IDENTITY.md` already is. **Which** item is running is exposed nowhere, so route 3 or 4 still, and still guesswork. |

For the heartbeat, in order of preference once Stage 0 reports:

1. **OpenClaw announces its own jobs** to a hook. Best case: a direct mapping.
2. **The plugin reads the heartbeat config** and correlates a run against it —
   giving a `plan` up front, and steps by whatever markers the run does emit.
3. **The agent declares them.** A documented convention: the agent marks each job
   as it starts. This is the same trick `TodoWrite` gives us for free elsewhere, and
   it is worth Paige adopting whether or not the harness ever helps.
4. **Infer from tool targets.** Last resort, and honestly guesswork — a run whose
   first tool call is `scripts/ingest-room-to-read-mail.sh` is *probably* on the
   ingest job. Better than "Working"; worse than being told; and it must never be
   drawn as if it were certain.

---

## 7. The plan

Four pieces of work. The two side-fixes are blocked by nothing and can go first or
in parallel; the two tracks are independent of each other.

### Where this is tracked

| Issue | Piece | Side |
| --- | --- | --- |
| TRO-101 | OpenClaw: send what a scheduled run actually knows | Emitter, one harness |
| TRO-102 | Jobs and steps — Track B | Wire + receiver + todo-tool emitters |
| TRO-103 | Scheduled work arrives differently — Track A | Wire + receiver, every harness |
| TRO-104 | S1. Name the command | Emitter, all three harnesses |
| TRO-105 | S2. Read the log | Receiver |

### Side-fixes (no model change, no discovery)

| # | Side | Work | Done when |
| --- | --- | --- | --- |
| **S1. Name the command** ✅ TRO-104 | Emitter | Rewrite the command branch of `targetOf`: tidy it as a path, prefer the basename when absolute, unwrap wrappers (`bash -lc`, `sh -c`, `env`, `sudo`, `cd … &&`), keep safe subcommands (`git commit`, `npm run probe`), cap at `CAPS.target`. Scrub secret-shaped args. | **Done.** `commandLabel` in `tool-classes.cjs`; Paige's cron now reads `scripts/ingest-room-to-read-mail.sh` in all five wrappings. Two things came out in the doing: the unwrapping also fixes `tool_class`, because `COMMAND_CLASSES` is anchored at the start of a line and so missed a `git push` behind a `cd`; and a credential's *name* is safe to show while the token after it is not, which is a rule about where to stop rather than about what a word looks like. |
| **S2. Read the log** | Receiver | Column headers on the same grid as the cells. `redaction` on the `session.start` row. Elide the **middle** of long paths, not the tail. Render `target` *and* `summary`. | The columns are named, and "why is everything called Working" is answerable from the log alone. |

### Track A — Origin: why the work exists

| Stage | Side | Work | Done when |
| --- | --- | --- | --- |
| **A0. Evidence** ✅ TRO-98 | Emitter | Read it out of the package rather than off a live tick: `npm pack openclaw` ships `dist/*.d.ts` **and** the runtime, so the contract is a file to read, not a `:17` to wait for. | **Done, 2026-09-02**, and it cost a download rather than an afternoon — the same trick that settled the hook payloads in [adapter notes §5.1](../protocol/aop-harness-adapters.md#5-openclaw). Written up as [what a scheduled run looks like](../adapters/openclaw.md#what-a-scheduled-run-looks-like), verified on 2026.7.1-2 **and** 2026.8.2. Three findings, each of which changes a stage below: `ctx.jobId` is already on the agent context; `cron_changed` is a real hook carrying the whole job definition and is **not** conversation-gated; and `ctx.trigger` is a closed six-member enum, which corrects fault #3. `ROVING_OFFICE_TRACE_HOOKS` was never needed and is not built. |
| **A1. Origin on the wire** ✅ | Wire | `origin` in spec §4.2, and the metadata-mode ruling in §10. | **Done.** `{ kind, name?, id?, schedule?, detail? }` in §4.2 and `docs/aop-v0.schema.json`, with §10 carrying the ruling as a row: `kind`, `name`, `id` and `schedule` survive `metadata`; `detail` does not. `kind` gained `maintenance` over the shape proposed above, because the trigger enum turned out to contain two housekeeping values with nowhere honest to go. |
| **A2. OpenClaw emits it** ✅ | Emitter | Register `cron_changed` and keep a `jobId → job` table on the bridge (`gateway_start` seeds it from `ctx.getCron().list()`, for a gateway already running when the plugin loads). `onAgentRun` claims the entry by `ctx.jobId` and fills `origin` from it. Map `memory` and `overflow`, and stop defaulting the rest to `'user'`. | **Done**, with `test/mapper-openclaw.test.mjs` — the first tests the plugin's mapper has had. Two things came out in the doing. It needs `allowConversationAccess` after all: `ctx.jobId` is on the agent context, and `PluginHookToolContext` carries neither it nor `trigger`, so the turn synthesised from a tool call cannot be rescued the same way. And an unmappable trigger is now **omitted** rather than defaulted — `trigger` is optional, and a `memory` run reported as `user` is a lie where a missing field is only a silence. |
| **A3. The office says it** ✅ *(for cron)* | Receiver | The shared label ladder, replacing three copies of `?? 'Working'`. `AopSource` stops discarding the trigger. | **Done for scheduled runs, and it needed less receiver work than expected.** The reducer already labels a desk from `turn.start.payload.title`, so an emitter that sends a real title is the whole fix — the ladder therefore lives emitter-side, in `originTitle`, where the redaction mode it has to consult already is. The receiver change is the log row, which now reads `via schedule: 17 * * * *` instead of `via schedule`. The other two mappers still carry their own `?? 'Working'`; hoisting the ladder into `aop-core.cjs` is worth doing when a second harness has an origin to put in it, and not before. |
| **A4. Who brought it** | Receiver | `origin.kind` picks the delivery channel; the robot arrival and its own queue. Fix `job-delivery.md` on addressed-vs-unaddressed scheduled post. | You can tell a scheduled round from a human request across the room, without reading a label. |

### Track B — Steps: what it is doing now

| Stage | Side | Work | Done when |
| --- | --- | --- | --- |
| **B1. Steps on the wire** ✅ | Wire | `plan`, `step.start`, `step.end` in spec §4.2, with the optionality rule stated: no steps means one step. | The field exists, and a turn without steps is explicitly correct rather than merely tolerated. |
| **B2. A step to look at** ✅ | Receiver | `step` as a **second** field on the agent record, never a retitle (§5.1). Strip, inspector and micro-label render job + step. Extend `MockSource` with multi-step jobs, so the step UI is exercised offline — the same reason the mailbox race is exercised offline (`job-delivery.md` §1). | The UI can be built and screenshotted with no harness attached, and one-step jobs look exactly as they do today. |
| **B3. The harnesses that can already tell us** ✅ | Emitter | Map `TodoWrite` (`claude-code.cjs:112`) and `update_todo` (`rovo-cli.cjs:98`) onto `plan` + `step.*` instead of discarding them as `other`. | A Claude or Rovo session walking a todo list shows which item it is on. No OpenClaw dependency whatsoever. |
| **B4. Heartbeat steps** | Emitter | Whichever of §6's four routes A0 makes possible. | Paige's heartbeat draws as one job with five steps. |

Note the ordering inside Track B: the receiver comes **before** the emitters, because
`MockSource` can drive it and a real harness cannot be made to walk a five-step
heartbeat on demand.

Checks, per `AGENTS.md`: `npm run probe -- --sweep` either side of A4; unit tests for
`tool-classes` and all three mapper suites; a replayed capture of one real cron tick
through the debug log to compare rows before and after; and a headless screenshot for
S2 and B2 — remembering that the shutter fires early, so anything that fades or walks
in wants a throwaway harness page instead.

---

## 8. Open questions

1. **Is `metadata` the mode on the Paige box?** If so, is the answer to move that
   box to `summary`, or to make `metadata` genuinely smarter (§4.1, §5.2)? The
   second is the more interesting fix and benefits every install.
2. **Does the operator-authored job name belong in `metadata`?** This doc argues yes
   and gives the reasoning; it is a privacy decision, not an engineering one.
3. **Is `heartbeat` its own `origin.kind`, or `schedule` with a plan?** Splitting
   them lets the office draw a round differently from an errand; merging them keeps
   the enum smaller. **A0 makes the case for splitting**, on evidence rather than
   taste: OpenClaw itself distinguishes them at the trigger, and they are not the
   same object — a cronjob has an id, a name and a cron expression, and a heartbeat
   has none of the three. `TRIGGERS` currently flattens both onto `schedule`, which
   is what would have to change.
4. ~~**Does a skipped plan entry draw as skipped, or vanish?**~~ **Answered in
   TRO-102: it draws as skipped**, struck through, against a hollow circle for a part
   not yet reached. A heartbeat that finds nothing to do is the normal case, and a
   vanishing entry would make the fraction lie about how long the list was. Telling
   *skipped* from *not reached* is the one thing a plan can do that a step alone
   cannot, so collapsing them would leave the checklist saying nothing the fraction
   did not already say. The emitter derives it without being told: an item still
   `pending` when the next one starts was skipped (§2.4a of the adapters doc).
5. **Robot, drone, or no arrival at all** for scheduled work — is the clock chiming
   and an envelope appearing enough?
