# Jira Coding Agent

**Researched, not built** — and the only source so far that is not a harness on your machine. There is no mapper, no installer, and no entry in the source picker yet; what there is, is a route that has been walked on paper and costed. This document is that route.

The agent in question is **Jira Coding Agent** (JCA), which is the rebranded *Rovo Dev in Jira*, previously *Autodev*, and internally the app codenamed **Boysenberry**. You assign a work item to it, it writes code and raises a pull request in Bitbucket Cloud or GitHub. [verified from internal docs, 2026-08-29]

## Why it breaks every assumption the other four share

The five harnesses differ in their details and agree on the thing that matters: they run **on the machine you are sitting at**, they read a config file you own, and they will run a shell command for you when something happens. All three facts are false here. JCA runs in Atlassian's cloud, its configuration is a Jira Automation rule, and there is nothing anywhere that will execute `bin/aop-send.cjs` on its behalf.

So the question is not "which hook do we install". It is "what in the cloud can be persuaded to make an HTTP request", and the answer turns out to be good.

## Its events exist, and they are telemetry

JCA is thoroughly instrumented against Atlassian's unified AI event standard, and the vocabulary lines up with AOP almost uncomfortably well [verified from internal instrumentation spec]:

| JCA event | `actionType` | AOP equivalent |
| --- | --- | --- |
| `aiInteraction initiated` (server) | `sessionInvoked` | `session.start` |
| `aiInteraction initiated` (client) | `sessionJoined`, `promptSubmit` | `turn.start` |
| `aiResult viewed` | — | `turn.end` |
| `aiResult actioned` | `commitChange`, `publishBranch`, `pullRequestCreated` | `artifact.change` |
| `aiResult adopted` | `pullRequestCreated`, `jiraWorkItemCreated` | `artifact.change` |
| `aiResult error` | session never opened, generation failed, timed out | `error` |
| `aiInteraction dismissed` | — | `session.end` |
| `aiFeedback submitted` | — | — |

Every one carries a `sessionID`, and most carry `automationRuleID`, `pullRequestID` and `jiraWorkItemID` — a session identity and a work item, which is exactly what [spec §3.2](../protocol/aop-spec.md) asks an envelope for.

**None of it is subscribable.** These are analytics events: they travel one way into Atlassian's own data lake and there is no webhook, no SSE endpoint and no session API on the other side of them. Their existence is still worth knowing, because it says the product *has* the concept of a session lifecycle and has already named it — but a table in a data warehouse is not a feed, and nothing in the office can drink from it.

The finer-grained material is more tantalising and just as unreachable. Boysenberry's own UI shows progress, "thinking", and **tool calls**, all shipped — so the data exists server-side and is streamed to a client. It is simply not streamed to *us*. [verified from the Rovo Dev in Jira milestone spec]

## The plugin surface points inwards — which is where the hook is

What JCA does have is a real extension point: an Automation action called **"Generate code"**. A rule picks its own trigger (a transition into *Agent Ready*, a manual run, a schedule), then the action names a repository and a prompt. [verified from the internal dogfooding guide]

Two properties of that action turn it from a way of *driving* the agent into a way of *watching* it:

1. **It publishes smart values when it finishes** — `{{rovodev.codeGeneration.jobId}}`, which is the Boysenberry session id, and `{{rovodev.codeGeneration.repoUrl}}`.
2. **The rule carries on afterwards.** The guide's own worked example posts a comment on the work item once generation completes.

A rule that can post a comment can post to a URL. So **the adapter is a rule**, not a program: components bracketing the `Generate code` action, sending `session.start` before it and `turn.end`, `artifact.change` and `session.end` after it, with `jobId` as the session id and the issue key as `workitem`. Nothing of ours is deployed anywhere, which is a pleasant novelty. The one load-bearing detail still to confirm is that a **Send web request** component is available in such a rule and permitted to reach an external host — see [open questions](#open-questions).

Forge is the other extension model and it is the wrong one. `rovo:agent` and `rovo:mcp` modules let you add capability to an agent, but nothing there fires on the agent's own progress, and an MCP server only ever sees the calls routed *to it* — never the agent's other tool calls. It is a tool, not a hook.

## Three routes, and what each one buys

| Route | Gets us | Costs |
| --- | --- | --- |
| **An Automation rule as the adapter** | **L0.** Arrive, work, ship a PR, leave — with the Jira key on the desk | Needs a publicly reachable office |
| **Jira + Bitbucket webhooks** | Per-artefact only: assignment, bot comments, `pullrequest:created` | Observes footprints, not the agent |
| **A CLI agent in CI** (`acli rovodev run` in a pipeline) | Richest, and reuses [the Rovo mapper](../adapters/rovo-cli.md) unchanged | Headless `rovo run` fires only session-scoped hooks, so still no tool events |

The third is worth keeping in view precisely because it needs nothing new from us: a pipeline step running the CLI in a container is a Rovo CLI session like any other, and if the container can reach the office over HTTP then the existing adapter already works. It is a different product from JCA, though, and a room fed by it is a room of Rovo characters — not a Jira one.

## What the room would actually show

A JCA character would arrive, sit down, work, deliver a pull request and leave. It would never once walk to the bookshelf, because there are no tool events to send — [L0, not L1](../protocol/aop-spec.md#9-conformance-levels). That is a real loss and the honest response is to accept it rather than to synthesise tool activity the agent did not report.

The compensation is that this is the first source where the **work item is the first-class thing**. Every other feed infers a job from a prompt; here the job *is* a Jira issue, with a key, a title and a URL, known before the agent starts. `job.queued`, the `workitem` field and the paper-airplane already exist in the spec for exactly this, so the mail route may suit JCA better than the desk does — see [job delivery](../job-delivery.md).

Two mechanical consequences follow from the agent being in the cloud:

- **The office cannot be on localhost.** Jira Cloud has no route to your laptop, so this is the first source that *requires* a hosted office rather than merely tolerating one. `bin/aop-connect.cjs` already points hooks at a remote receiver, and [publishing](../publishing.md) covers what a shared office exposes.
- **Redaction stops being ours.** Every other source runs `aop-send`, which applies [spec §10](../protocol/aop-spec.md#10-privacy-and-redaction) on the way out. A rule POSTs whatever its author typed into it, so the redaction contract moves to whoever writes the rule — and a prompt pasted into a web request is a prompt on someone else's screen. Any documented rule template we publish should be metadata-only by default, for the same reason `settings.json` defaults that way.

## Open questions

Nothing here has been proved by running it, and these are the items that would need to be:

1. **Is "Send web request" available beside a `Generate code` action, and can it egress?** The whole route rests on this. Chaining *a* component after the action is verified; chaining *that* component is not.
2. **What does the rule know before the agent finishes?** `jobId` is documented as an output of the action, which may mean nothing useful can be sent at `session.start` — in which case a character appears only on completion, and the room shows delivery without work.
3. **Is there any polling route into a Boysenberry session?** The panel in Jira lists sessions with PR and build status, so something serves that; whether it is reachable, and by whom, is unknown.
4. **How does the office id get derived with no checkout?** Every other source resolves a project from the nearest `.git` ([spec §3.4.1](../protocol/aop-spec.md)). A rule has no working directory, so `repoUrl` has to stand in for it — canonicalised the same way `aop-send` canonicalises a git remote, or the two sources will disagree about which room is which.

## Read next

- [Sources](../sources.md) — redaction, office routing and when agents leave
- [Adapter notes §6](../protocol/aop-harness-adapters.md) — the event-by-event detail behind this page, and how it was verified
- [Rovo CLI](../adapters/rovo-cli.md) — the CI route's actual adapter, should that go first
