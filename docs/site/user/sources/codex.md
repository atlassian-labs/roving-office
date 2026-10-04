# Codex

*OpenAI's coding agent. Ten lifecycle hooks, real subagents, and one trust step.*

## Install it

Codex installs a plugin from a **marketplace it can clone**, not from a file it can
download — so unlike Claude Code, the published route needs a repository to point at, and
that repository is not up yet. When it is, the commands will be:

```bash
codex plugin marketplace add <publisher>/roving-office-plugins
codex plugin add roving-office@roving-office
```

Until then, install it from a copy of the project:

```bash
npm run connect:codex          # install or update the local plugin
npm run connect:codex:status   # installation, version and hook readiness
npm run connect:codex:dry      # show what it would run, change nothing
npm run disconnect:codex       # remove the plugin
```

Either way, start a **new Codex thread**, open `/hooks`, and **review and trust the
commands**. Codex loads plugins at thread start, so an already-open thread does not gain
an adapter halfway through, and installing a plugin never trusts its hooks for you.

Point an office at **Codex** (press `D`).

> **Hooks are shell commands, and Codex requires you to review them.** `/hooks` is the
> source of truth if the plugin is installed but silent. The adapter always returns success
> and never prints a response: it observes Codex, and it cannot approve, deny, block or
> rewrite its work.

## What you get

Sessions, turns, tool work, patches showing up as work produced, plans as checklists,
permission requests, context compaction, and **real subagents** — a fan-out arrives as
actual child sessions. The room does not draw them yet, so a fan-out looks like one busy
person for now.

Because Codex says when a session really ends, a quiet Codex character gets the patient
30-minute clock rather than the five-minute fallback.

## Two things it cannot see

**Whether a shell command failed.** Codex hands the adapter a command's output but not its
exit status, so a quiet failed command is indistinguishable from a successful one that
printed nothing — and the adapter does not guess from error-looking text. A failure can
therefore pass unremarked.

**Web searches.** Codex does not report its hosted web search as a tool, so that one
activity can be invisible even while the rest of a turn is live. Nobody walks to the
telescope for it.

It also cannot say how a permission request was *resolved* — only that one was asked.

## If nothing shows up

| Symptom | What to do |
| --- | --- |
| Plugin installed but silent | Open `/hooks` and trust the commands. This is the usual answer |
| An error about the command not launching | Compare the version in `/hooks` with `connect:codex:status`. If it is old, reinstall and **fully restart the Codex app** so its plugin registry reloads |
| Works in one thread, not another | A thread keeps the plugin version it loaded at startup. Old threads keep working on the old snapshot; new threads get the new one |
| Nothing, and your organisation manages Codex | An administrator can require managed hooks only. `connect:codex` warns when it can see that setting; a local plugin cannot bypass it, and the command has to be deployed centrally |

## Read next

- [Connect your agents](../connect-your-agents.md) — redaction, office routing, and when agents leave
- The hook table and the worktree trap are in the [developer docs](../../developer/adapters/codex.md)
