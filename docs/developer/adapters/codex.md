# Codex adapter

*Installing it is [Codex](../../user/sources/codex.md). This is the mapper, the staging
trap, and the two gaps in the contract.*

`bin/mappers/codex-cli.cjs` shares the proven Claude state machine and only normalises the
places their contracts differ: turn ids, built-in tool names, plans and patches. Full
reasoning and the alternatives to hooks are in
[adapter notes §3](../protocol/aop-harness-adapters.md#3-codex-cli).

## Hook → AOP

| Codex hook | AOP event |
| --- | --- |
| `SessionStart` / `SessionEnd` | `session.start` / `session.end` |
| `UserPromptSubmit` / `Stop` | `turn.start` / `turn.end` |
| `PreToolUse` / `PostToolUse` | `tool.start` / `tool.end` |
| successful `apply_patch` | `artifact.change` |
| successful `update_plan` | `step.start` / `step.end` |
| `PermissionRequest` | `permission.request` |
| `PreCompact` | `context.compact` |
| `SubagentStart` / `SubagentStop` | real child `session.start` / `session.end` |

`Bash`, `apply_patch`, `update_plan`, `request_user_input`, `spawn_agent` and `view_image`
are normalised onto the tool classes the room already understands. MCP and future tools
fall through the shared classifier.

The explicit `SessionEnd` capability is what gets an idle Codex character the office's
patient lifecycle rather than the five-minute fallback.

## What the contract does not give us

**No `permission.resolve`.** Codex has no hook telling an observer how a permission request
was resolved, so the mapper does not claim it. It has no notification or idle-heartbeat
hook either.

**`PostToolUse` carries Bash output but not its exit status.** A quiet failed command is
therefore indistinguishable from a successful command that printed nothing, and **the
adapter does not guess from error-looking text.** That is a deliberate refusal: inferring
failure from output would mean the room crumpling paper into the bin on the strength of a
regex.

**Subagent hooks identify the parent session but not the tool call that spawned it**, so
the ghost is real but cannot be tied to an exact `spawn_agent` call — unlike Claude, which
carries `parent_tool_use_id`.

**Hosted `WebSearch` is not exposed as a tool hook**, so that one activity is invisible
even while the rest of a turn is live.

## The staging step, and why a worktree needs it

The installer stages this checkout as a small, **non-Git** marketplace under
`~/.roving-office/codex-marketplaces/`, then installs `roving-office@roving-office`.

That indirection is load-bearing in a worktree: **Codex clones a Git-backed local source at
its default branch**, which would silently install `main` instead of the branch being
tested. Staging a non-Git directory is what stops that.

Installation is a snapshot, so plugin changes ship with a fresh version and
`npm run connect:codex`. When the plugin is already present, the installer removes its
immutable cache and marketplace registration before adding the current staged snapshot —
Codex's idempotent `plugin add` alone would leave an older snapshot in place.

**A thread keeps the versioned plugin root it loaded at startup**, so the installer
preserves the previous cache directory when refreshing: already-open threads keep working
on their old snapshot while new threads load the new one.

### A published marketplace is a repository, not a file

Codex takes a marketplace as a local path, `owner/repo`, or a Git URL — and nothing else.
There is no equivalent of the archive URL Claude Code accepts, so a published Codex plugin
needs something to clone. `npm run pack:plugins` builds that something:
`plugins/codex/` is a complete distribution repository, `.agents/plugins/marketplace.json`
at its root with `"source": "./"`, which is correct there for the same reason the staging
step above exists — the marketplace root and the plugin root are one directory.

Everything up to the push is built and verified, including a real
`codex plugin marketplace add` against the generated tree in a throwaway `CODEX_HOME`.
Only the public repository is missing. See
[publishing the plugins](../plugin-distribution.md).

## Verifying against a local office

Use an office of your own. `TEST-0000` deliberately disables every source that needs an
adapter, so it cannot be turned into a Codex or mixed-source office.

```bash
node server.cjs 8082 --publish --office ABCD-1234
npm run connect:codex
npm run connect:codex:status
```

The status output names both answers that matter: the installed plugin version and the
exact `.../office/<keycard>/aop/v0/events` receiver. Remove `/aop/v0/events` to get the URL
to open in a browser.

**The endpoint is machine-wide and read on every hook**, so repointing the server at a
different keycard needs no reinstall and no Codex restart. Installing new hook *code* is
different: start a new thread, open `/hooks`, and trust the new snapshot. An exit code
`127` means the registered command could not be launched — compare the version in `/hooks`
with `connect:codex:status` first.

## Managed installations

An administrator can set `allow_managed_hooks_only = true` in `requirements.toml`.
`connect:codex` and `connect:codex:status` check the known policy locations and warn when
they can see it; **a local plugin cannot bypass it**, and in that environment the command
has to be deployed as a managed hook.

## Read next

- [Adapter notes §3](../protocol/aop-harness-adapters.md#3-codex-cli) — the event-by-event reasoning
- Codex's own contracts: [hooks](https://learn.chatgpt.com/docs/hooks) · [plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Extending the office](../extending.md#add-a-harness-adapter) — writing another one
