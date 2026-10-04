# Claude Code

*The richest feed there is: explicit turn boundaries and real subagents.*

## Install it

From Claude Code itself, with no download and nothing to clone:

```
/plugin marketplace add https://therovingoffice.com/plugins/claude/marketplace.json
/plugin install roving-office@roving-office
```

The marketplace hands Claude a versioned archive pinned to a checksum, so the install is
refused rather than silently wrong if the file it fetches is not the file we published. It
needs no Git and no npm. It does need **Node** on the machine your agent runs on — the
observer is a handful of JavaScript files, and they have to run somewhere.

Then **start a new Claude session** — hooks are read at session start — and point an office
at **Claude Code** (press `D`).

> **Fifteen hooks cost no tokens.** Claude reports them as *harness-only — no model context
> cost*. Nothing here enters the model's context or changes how your agent behaves. It only
> watches.

> **Connecting it to an office is a separate step.** Installing the plugin does not tell
> it *which* office to feed. Today that still means running an office yourself, or
> pointing this machine at a hosted one from a copy of the project. A one-step way to pair
> a plugin with an office is being built.

### Updating it

Marketplaces that are not Anthropic's have **auto-update off by default**, so a new
version arrives only when you ask for it:

```
/plugin marketplace update roving-office
/plugin update roving-office@roving-office
```

Restart the session afterwards, for the same reason as above.

### If you have a copy of the project

Two more routes install it out of that copy instead, and they are what you want if you are
*changing* the observer rather than watching with it:

```bash
npm run connect:claude           # install as a plugin — a copy of your copy
npm run connect:claude:settings  # hooks pointing straight at your copy — live
npm run connect:claude:status    # which route is live, and whether it is stale
npm run disconnect:claude        # remove whichever route is active
```

| Route | What it is | Use it when |
| --- | --- | --- |
| **marketplace** | The published archive, pinned to a checksum | You want the office. Nothing to clone |
| **plugin** | Installed as a **copy** of your copy | You want a version that is not published yet |
| **settings** | Hooks pointing straight at your copy | You are editing the observer — changes apply to the very next tool call |

**Do not install two of them** — every event would arrive twice, and the room would
double-count. The installer refuses and says which one to remove.

Because the first two run from a copy, `connect:claude:status` compares them and tells you
when that copy has drifted from your working tree. "I changed it and nothing happened" is
otherwise a genuinely confusing half-hour.

## What you get

Everything the other harnesses give, plus things they cannot:

- **Explicit turn boundaries**, so a desk label is never guessed from tool activity.
- **File and commit events**, when something is written.
- **Permission events**, when you say no.
- **Context compaction**, when history is squeezed.
- **Real subagents.** A fan-out arrives as actual child sessions bound to the exact call
  that spawned them. The room does not draw them yet — a fan-out looks like one busy person
  — but the feed is there and waiting on the scene.

**Terminal, desktop and SDK are three surfaces, not one.** The same binary serves a
terminal session, the desktop app's local agent mode and a programmatic run, and the office
tells them apart. "Claude Code in a terminal" and "Claude Code in the desktop app" are two
different things to whoever is watching the room.

Claude also generates a concise title for each session, and the office prefers that as the
job label over quoting your prompt. It is disabled entirely at the default redaction.

## If nothing shows up

| Symptom | Cause |
| --- | --- |
| Every agent appears twice | Two routes are installed. Remove one |
| Nothing from desktop-app sessions, but terminal works | See below — this was a real bug and the fix is installed, but `connect:claude:status` checks the two cases separately for a reason |
| "I changed the adapter and nothing happened" | The plugin is a snapshot. `connect:claude:status` says whether it has drifted |
| A new version was released and nothing changed | Auto-update is off for marketplaces that are not Anthropic's. Run the two update commands above |

**A desktop session gets a different PATH, and that used to empty the room.** A hook
inherits the environment of whatever launched the agent. From a terminal that is a login
shell, so a version manager's Node resolves — but the desktop app is launched by the
system, which hands down a much shorter list of places to look. Every version manager
installs Node under your home directory, none of which is on that list, so every hook
failed and the office stayed empty for exactly the sessions a GUI runs. Silently, because a
non-blocking hook's failure is not the agent's problem.

Every hook now goes through a wrapper that looks where version managers actually put Node
and caches the answer.

## Read next

- [Connect your agents](../connect-your-agents.md) — redaction, office routing, and when agents leave
- [Sharing an office](../sharing-an-office.md) — pointing this at a hosted office, and the version bump it needs
- The event-by-event mapping is in the [developer docs](../../developer/adapters/claude-code.md)
