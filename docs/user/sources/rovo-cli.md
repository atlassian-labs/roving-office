# Rovo CLI

*Atlassian's terminal agent. Built, and it says goodbye properly.*

## Install it

```bash
npm run connect:rovo:dry     # show exactly what would change, change nothing
npm run connect:rovo         # install (backs your config up first)
npm run connect:rovo:status  # what is wired up, and what actually runs
npm run disconnect:rovo      # remove, restoring any hook it displaced
```

Then **start a new Rovo session.** Rovo reads its hooks once, at session start, so an
installed hook does nothing for terminals that are already open.

Point an office at **Rovo CLI** (press `D`), and the next thing you ask an agent to do
walks into the room.

## What you get

Arrivals, tool work, research trips, deliveries, errors and departures — the whole session
and turn lifecycle.

**A Rovo character sits at their desk through 30 minutes of quiet** rather than the
five-minute fallback, because Rovo tells the office when a session really ends. Quiet is
the normal state of a session that is waiting on you, and this adapter knows the
difference.

### Checklists

Ask for something with parts and Rovo writes itself a todo list. The office reads it: a
checklist in the detail panel, the part in hand on the desk label, and a count-first line
where a line is all there is room for — *(2/5) Checking the result*.

Nothing needs turning on, and a turn without a list looks exactly as it did before lists
existed. A finished five-part job reads **Done (5/5)** under Recent jobs, and the row opens
to show all five parts rather than reducing the work to a fraction.

At the default redaction the parts are **counted, not named** — *Step 2 of 5* — because a
todo item is a sentence the model wrote.

## What it cannot do

**Subagents.** Rovo has no subagent hook, so a Rovo office never shows a fan-out as
anything but one busy person. [Claude Code](claude-code.md) is the feed that carries them.

**Hooks are a terminal feature.** They do not fire under `rovo serve` at all, and in
headless `rovo run` only the session-scoped ones do — so a `run` that demonstrably executed
a shell tool produces an end-of-session event and no tool work.

## If nothing shows up

| Symptom | Cause |
| --- | --- |
| Agents arrive, sit and deliver, but no tool work or checklists | Another tool has taken the tool-start hook slot. `connect:rovo:status` names what each missing hook costs |
| Nothing at all, and no errors anywhere | The office is not running. The adapter exits immediately when there is no office to post to — harmless, and it stays installed |
| Desk labels all read "Working" | That is the default redaction doing its job. [How to change it](../connect-your-agents.md#how-much-of-your-prompt-the-office-is-told) |

**Rovo runs only the first command of an event**, and the first slot is the only slot worth
having. If you already have a hook there, the installer takes the slot and re-runs yours,
so existing telemetry keeps working — and `disconnect` puts your command back. The traffic
goes the other way too: another tool's installer will take the slot from us just as
readily, and then an office that was working stops showing tool work with nothing broken
and nothing logged. Taking it back is the same command that installed it.

## Read next

- [Connect your agents](../connect-your-agents.md) — redaction, office routing, and when agents leave
- [Sharing an office](../sharing-an-office.md) — pointing these hooks at a hosted office
- The payload shapes and the measurements are in the [developer docs](../../developer/adapters/rovo-cli.md)
