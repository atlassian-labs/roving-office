# Muse

*Meta's personal AI agent. No plugin — the agent drives the emitter itself.*

Muse connects to an office by running the [standalone emitter](../../developer/adapters/muse.md) directly. There is no marketplace or install step: the agent saves `bin/aop-emit.cjs` from the checkout and narrates its work through it — a `turn.start` when a task begins, `tool.start`/`tool.end` for each notable step, `artifact.change` for deliverables, `turn.end` when done.

## What you will see

A character walks in wearing Muse's avatar, sits down, and its desk label narrates what it is doing in plain language. Because the narration is written by the agent as it works, the labels read like a running commentary rather than hook output.

## What it can see

Metadata only: the repository's host, owner and name, the branch, the working directory, and which tools ran. Never file contents, prompts, replies, or command output. The redaction happens in the emitter before anything is sent — [what the default actually sends](../connect-your-agents.md#what-the-default-actually-sends).

## Read next

- [Connect your agents](../connect-your-agents.md) — the harness table
- [Watching the office](../watching.md) — how to read what you are now looking at
