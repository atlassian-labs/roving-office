# OpenClaw: open questions

*Measured, not fixed. Four things the OpenClaw bridge knows are wrong or unproven.*

The adapter itself is [the OpenClaw plugin](../adapters/openclaw.md), which is reference.
This page is the residue: observations that are real, reproduced, and **not** resolved. Each
one is here so the next person does not spend the afternoon re-discovering it.

## 1. Tool calls can be counted twice, and nothing de-duplicates them

OpenClaw wraps Claude Code and Codex, so a machine running this plugin **and** our Claude
Code plugin sees the same work as two sessions standing at two desks.

The emitter holds up its end: it stamps `harness.name = "openclaw"` and, when told,
`ext.wrapped_harness`. **The receiver's half is not built** — de-duplicating on
`session.cwd` plus overlapping time when two harnesses report the same
`project.repo.commit`.

Until it is, the mitigation is to run one or the other. `wrappedHarness` is a declaration
waiting for a reducer that does not exist yet, and it has to be *told* rather than sniffed:
nothing in the hook payloads names the wrapped harness, and `modelProviderId` is the
provider, not the harness.

**Why it has not bitten:** almost nobody runs both plugins on one machine. That is luck, not
design.

## 2. A gateway can deliver `agent_end` without `before_agent_run`, and we do not know why

Measured on a real Gateway, not theorised. The symptom is every desk reading `Working` with
no job label, and the
[permission flag](../../user/sources/openclaw.md#set-this-one-flag-or-desks-will-have-no-labels)
being set correctly.

The adapter handles it — a run that ends without having started is still closed rather than
left open forever — but **the root cause is unidentified.** It is not the conversation-access
block, because that blocks both hooks together. See
[when only half the run lifecycle arrives](../adapters/openclaw.md#when-only-half-the-run-lifecycle-arrives)
for what was actually observed.

## 3. The permission gap needs the WebSocket, and that is a real route not taken

There is no permission hook: OpenClaw's approval flow runs the other way round, so a plugin
can *ask* for approval but cannot observe the approvals the core raises for its own `exec`
tool.

This is the most valuable missing event in the whole project.
[The spec](../protocol/aop-spec.md#44-attention-and-interruptions) calls
`permission.request` the single most valuable non-L0 event, because it is the only reliable
signal that an agent is **waiting on you** — which is precisely what a room full of
characters shows best at a glance.

**The Gateway WebSocket does carry `exec.approval.requested` / `.resolved`.** That is the one
concrete reason to prefer it, and it is an increment rather than a redesign: the mapping is
already written down in
[adapter notes §5](../protocol/aop-harness-adapters.md#5-openclaw), and the plugin's
publisher would be reused as-is.

Not done because the plugin route works for everything else and this would be a second
transport to maintain.

## 4. `origin.detail` and the spec do not agree about scheduled runs

The bridge reports scheduled work in a shape the spec does not quite bless. Both are
defensible and they have not been reconciled; the mismatch is recorded in
[what the office is told](../adapters/openclaw.md#what-the-office-is-told).

Worth resolving in whichever direction, because a field that two documents describe
differently is a field the next adapter author will implement twice.

## Read next

- [The OpenClaw plugin](../adapters/openclaw.md) — the reference, and where each of these was measured
- [Adapter notes §5](../protocol/aop-harness-adapters.md#5-openclaw) — the payloads and the WebSocket mapping
- [Origin and steps](origin-and-steps.md) — the proposal that `origin.detail` belongs to
