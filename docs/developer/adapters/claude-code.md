# Claude Code adapter

*Installing it is [Claude Code](../../user/sources/claude-code.md). This is the mapper, and
the version-bump ritual you cannot skip.*

The repo **is** the plugin: `.claude-plugin/plugin.json` declares it and
`hooks/hooks.json` registers fifteen events. The host-selecting wrapper reaches the same
`bin/aop-send.cjs` the Rovo and Codex adapters use. Everything measured here was measured
on 2.1.246 — see [adapter notes §2](../protocol/aop-harness-adapters.md#2-claude-code).

This is [conformance level L2](../protocol/aop-spec.md#9-conformance-levels), the richest
of the five feeds.

## Changing the plugin means bumping the version

**Non-negotiable, and the reason is a snapshot.** `claude plugin install` *copies* the
plugin into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, the cache is keyed
on the version, and `claude plugin update` compares versions to decide whether to fetch
anything at all. **An update offered a version it already holds does nothing, silently,
however far the files have drifted.**

So any change under `hooks/`, `bin/aop-send.cjs`, `bin/aop-node.sh`,
`bin/aop-plugin-hook.sh`, `bin/mappers/`, `.claude-plugin/` or `.codex-plugin/` has to bump
the shared version in both plugin manifests *and* `package.json`.
`connect:claude:status` is the check that tells you which update command you need.

This is why the **settings** route exists. It points at the checkout rather than a copy, so
a mapper edit applies to the very next tool call — which is what you want while you are
actually working on one. `--project` scopes it to one repo by writing
`.claude/settings.local.json`, the personal never-committed one, since the command contains
an absolute path to *your* machine.

**Claude runs every matching hook**, not just the first. So unlike the Rovo installer this
one simply adds itself beside whatever is already there and never touches it — and that is
also why installing both routes sends every event twice. The installer refuses.

**A third route needs no checkout at all.** `npm run pack:plugins` builds the plugin as a
versioned zip and generates the marketplace JSON the site serves at
`/plugins/claude/marketplace.json`, pinned to the archive's SHA-256. That is what a
stranger installs, and it is a snapshot too — with the same version rule and one more
wrinkle, since third-party marketplaces have auto-update off by default. See
[publishing the plugins](../plugin-distribution.md).

## What it maps that the others cannot

- **Explicit turn boundaries**, so a desk label is never inferred from tool activity.
- `artifact.change` on a file write or a commit.
- `permission.resolve` when you say no — Codex cannot report this.
- `context.compact` when history is squeezed.
- **Real subagents.** `SubagentStart` carries `agent_id`, `agent_type` and
  `parent_tool_use_id`, so a fan-out arrives as actual child sessions bound to the exact
  `Job` call that spawned them. Nothing is inferred from tool arguments and nothing is
  marked synthetic. Codex also provides a real subagent lifecycle, but without the parent
  tool-call id.

The reducer (`src/data/aop-reducer.js`) holds a `TODO(ghosts)` and skips the children, so
today they are a feed waiting on a scene. The shape they are owed is in
[scene internals](../scene-internals.md#subagents-are-ghosts).

## Three names for one session, and which one wins

Claude's transcript carries a concise `ai-title` alongside an `agent-name`, and the session
registry keeps a third, custom name.

The adapter prefers **`ai-title`**, falls back to `agent-name`, and sentence-cases
slug-shaped names (`add-office-printer` → "Add office printer"). It deliberately **does not
use the session registry's custom name**: Desktop may replace that with an operational name
such as `furniture-worktree-setup` while the assignment itself has not changed.

Title lookup reads only a bounded tail below `~/.claude/projects/`, is best-effort, and is
disabled entirely under `metadata` redaction.

## Three surfaces, one binary

`CLAUDE_CODE_ENTRYPOINT` is exported into every hook's environment
[verified 2026-08-27, 2.1.246], so the mapper reads the surface for free rather than
parsing a transcript to learn the same fact. An entrypoint nobody predicted is slugged and
reported verbatim rather than dropped, on the grounds that a name we do not recognise is
still better than silence about a harness we did not foresee.

### The launchd PATH trap

A hook inherits the environment of whatever launched the agent. From a terminal that is a
login shell, so a version manager's shims resolve `node` — but a GUI session's parent is
launchd, which hands down only
`/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`.

nvm, fnm, volta and asdf all install Node under `$HOME`, none of which is on that list, so
`env node` exited **127**, every hook failed, and the office stayed empty for exactly the
sessions a GUI harness runs — silently, because a non-blocking hook's failure is not the
agent's problem.

Every plugin hook command therefore goes through `bin/aop-plugin-hook.sh` and then
`bin/aop-node.sh`, which looks where version managers actually put Node and caches the
answer in `~/.roving-office/node-path`. `connect:claude:status` reports the terminal case
and the GUI case **separately**, because a status that only proves the terminal half proves
the easy half.

## Remote offices need no version bump

The plugin's hooks post to whatever URL `~/.roving-office/endpoint.json` names, so pointing
them at a remote receiver is not a plugin change: the snapshot Claude runs reads the same
endpoint file your checkout does. Worth stating plainly right next to the section above,
which is about the opposite case.

## Read next

- [Adapter notes §2](../protocol/aop-harness-adapters.md#2-claude-code) — the event-by-event mapping and how fifteen hooks were verified
- [The AOP spec](../protocol/aop-spec.md) — the wire format
- [Extending the office](../extending.md#add-a-harness-adapter) — writing another one
