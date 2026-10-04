# Cursor

*An observer only: it watches Cursor Agent and never blocks or rewrites anything it does.*

## Install it

```bash
npm run connect:cursor
npm run connect:cursor:status
npm run disconnect:cursor
```

The installer adds itself alongside any hooks you already have, backs the file up first,
and never touches hooks it did not install. **Cursor reloads its hook configuration on its
own**, so there is no restart step — but a session already in flight will not pick the
adapter up mid-turn.

Point an office at **Cursor** (press `D`) and give an agent something to do.

## What you get

Arrivals and departures, prompts starting turns, tool work, and file edits showing up as
work produced.

**Checklists work.** Cursor's todo list becomes a plan in the office: the active item is
the step in hand, finishing it moves to the next, and a multi-part job stays visible as its
actual sequence rather than one undifferentiated block.

Anything Cursor grows in future that the office does not recognise keeps the session
present without pretending to more meaning than that — so a new Cursor release cannot make
your agents vanish from the room.

## What to know

**Cursor hook data can include prompt text and tool results**, so the
[redaction setting](../connect-your-agents.md#how-much-of-your-prompt-the-office-is-told)
is doing real work here. It applies before anything leaves your machine.

**No subagents.** A fan-out looks like one busy person.

## If nothing shows up

| Symptom | Cause |
| --- | --- |
| Nothing at all | Start a new Cursor session. The office is also only fed while it is running |
| Desk labels all read "Working" | The default redaction. That is it working as designed |
| Shell commands counted twice | This is guarded against — shell boundary hooks are only used where the generic one is missing. Report it if you see it |

## Read next

- [Connect your agents](../connect-your-agents.md) — redaction, office routing, and when agents leave
- The hook-to-event mapping is in the [developer docs](../../developer/adapters/cursor.md)
