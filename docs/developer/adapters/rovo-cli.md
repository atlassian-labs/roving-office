# Rovo CLI adapter

*Installing it is [Rovo CLI](../../user/sources/rovo-cli.md). This is the mapper.*

`bin/mappers/rovo-cli.cjs`, over the shared `bin/aop-send.cjs`. The measurements behind
everything here are in [adapter notes §4](../protocol/aop-harness-adapters.md#4-rovo-cli).

## The eight hooks

`on_session_start`, `on_user_prompt`, `on_tool_start`, `on_tool_end`,
`on_tool_permission`, `on_complete`, `on_error`, `on_session_end` — and the installer wires
up all eight.

Between them they cover [L1](../protocol/aop-spec.md#9-conformance-levels)'s tool events
and the whole session and turn lifecycle, plus `error`.

**The one L0 event it does not declare is `session.heartbeat`**, because Rovo has no
periodic hook to send one from. The mapper emits one only as a fallback when it meets a
hook name it does not recognise, which is enough to keep that character from being reaped.

`on_session_end` is the one that changes how the room behaves: because it fires, the
adapter declares `session.end` in its capabilities, and a Rovo character gets the
[30-minute leash rather than the five-minute one](../../user/connect-your-agents.md#when-agents-leave).
Early notes here predicted only implicit spawn and TTL reaping; that turned out to be
wrong, and in a better direction.

## One slot per event, and it is contested

**Rovo runs only the first command of an event.** If a slot is already taken, the installer
takes it and re-runs the displaced command via `aop-send --chain`, so existing telemetry
keeps working; `--uninstall` puts it back. It refuses to guess about anything else.

The traffic goes the other way too: because the first slot is the only slot worth having,
*another* tool's installer will take it from us just as readily — and an office that was
working stops showing tool work with nothing broken and nothing logged.
`connect:rovo:status` names what each missing hook costs.

## `update_todo` → steps, read at the *start*

The plan is read from `on_tool_start`'s arguments, because `on_tool_end` carries results
and **no arguments**.

It understands both of the tool's dialects: a whole list, and a `merge: true` patch that
names only what changed. The second is easy to get wrong in a way that looks fine — a list
of three reported as *2 of 2*, and a part just ticked off drawn as one struck out — so
[adapter notes §4.6](../protocol/aop-harness-adapters.md#46-update_todo-steps-and-why-it-fires-at-the-start)
keeps the measurements.

Consequence worth expecting rather than debugging: **no tool hooks, no checklist.** If that
slot belongs to another command the office sees a session that arrives, sits and delivers,
with no parts and no tool work in between.

The last plan is copied into job history before the live checklist is cleared, which is
what makes a finished round read *Done (5/5)* with all five parts still listed.

## Titles are local, best-effort enrichment

At `summary` and `full` the adapter prefers the concise title Rovo already generated for
its own session list over quoting the prompt, read from
`~/.rovo/sessions/<id>/metadata.json`. **It does not call another model.**

Title generation can finish *after* the first prompt hook, so `on_complete` carries it
again and the completed job is retitled in place.

## Hooks are a TUI feature

They do not fire under `rovo serve` at all, and in headless `rovo run` only the
session-scoped ones do — so a `run` that demonstrably executed a shell tool produces
`on_session_end` and no `on_tool_start`.

## No subagents

Rovo has no subagent hook, so a Rovo office can never show ghosts. See
[Claude Code](claude-code.md) for the feed that carries them.

## Read next

- [Adapter notes §4](../protocol/aop-harness-adapters.md#4-rovo-cli) — payload shapes, and the two mechanisms considered
- [The AOP spec](../protocol/aop-spec.md) — the wire format
- [Extending the office](../extending.md#add-a-harness-adapter) — writing another one
