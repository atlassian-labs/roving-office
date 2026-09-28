# Muse

*Meta's personal AI agent. No plugin — the agent drives the emitter itself.*

Muse connects to an office by running the [standalone emitter](../../developer/adapters/muse.md) directly. There is no marketplace or install step: the agent saves `bin/aop-emit.cjs` from the checkout and narrates through it. Every turn gets a `turn.start`/`turn.end` pair — real work carries the full treatment (the to-do list up front, a numbered sequence of `tool.start`/`tool.end` steps in plain language, `artifact.change` for deliverables), while casual chat goes out as a simple job: a descriptive title, no task list. The emitter only sends what the agent hands it, so the agent itself decides when to emit; nothing on the office side narrates automatically.

## What you will see

A character walks in wearing Muse's avatar, sits down, and its desk label narrates what it is doing in plain language. Because the narration is written by the agent as it works, the labels read like a running commentary rather than hook output.

## What it can see

Metadata only: the repository's host, owner and name, the branch, the working directory, and which tools ran. Never file contents, prompts, replies, or command output. The agent's permissions and instructions redact its event before it calls the emitter; the emitter transports that event unchanged — [what the default actually sends](../connect-your-agents.md#what-the-default-actually-sends).

## Read next

- [Connect your agents](../connect-your-agents.md) — the harness table
- [Watching the office](../watching.md) — how to read what you are now looking at
