# Cursor adapter

*Installing it is [Cursor](../../user/sources/cursor.md). This is the mapping.*

The smallest of the five adapters, and an **observer only**: it does not write hook output
and does not block any action.

## Hook → AOP

| Cursor hook | AOP event |
| --- | --- |
| `sessionStart` / `sessionEnd` | `session.start` / `session.end` |
| `beforeSubmitPrompt` | `turn.start` |
| generic tool hooks | `tool.start` / `tool.end` |
| `afterFileEdit` | `artifact.change` |
| `preCompact` | `context.compact` |
| `stop` | `turn.end` |
| anything unrecognised | `session.heartbeat` |

**Shell boundary hooks are used only when a generic Shell hook is unavailable**, which is
what avoids double-counting a command.

**An unknown hook becomes a heartbeat, deliberately.** It keeps a live session present
without claiming semantics the adapter cannot support — so a Cursor release that adds an
event cannot make characters vanish from the room. That is the same instinct as the Rovo
mapper's unrecognised-hook fallback.

## `todo_write` → steps

Cursor's `TodoWrite` / `todo_write` tool becomes an AOP plan: the active todo starts a
step, completing it ends that step, and the next active todo starts the next one. A
multi-step job therefore stays visible as its actual sequence rather than one
undifferentiated tool call.

## Installation

The installer adds commands **alongside** existing entries in `~/.cursor/hooks.json`, backs
the file up before changing it, and does not touch hooks it did not install — the Claude
shape rather than the Rovo one, because Cursor runs every matching hook.

Cursor watches that file and reloads it automatically, so there is no restart step in the
install.

## Redaction matters more here

Cursor hook data can include **prompt text and tool results**, so the adapter is doing real
work at the `metadata` default. [Spec §10](../protocol/aop-spec.md#10-privacy-and-redaction)
is the contract; redaction happens on the machine, before anything leaves it.

## No subagents

Cursor exposes no subagent lifecycle, so a Cursor office cannot show ghosts.

## Read next

- [Adapter notes](../protocol/aop-harness-adapters.md) — the shared measurements
- [The AOP spec](../protocol/aop-spec.md) — the wire format
- [Extending the office](../extending.md#add-a-harness-adapter) — writing another one
