# OpenClaw

*The odd one out, in the good way: a real plugin rather than a command per event.*

OpenClaw has an in-process hook bus, so the office gets a **plugin** — no process startup
per tool call, no polling, nothing on disk between events.

**The bonus is heartbeats.** Every other adapter here is a process that lives for forty
milliseconds, which means it cannot say "still alive" — the office has to retire a quiet
character on a timer and hope. A plugin is already running, so an OpenClaw session that
sits idle for an hour between prompts **stays at its desk** instead of being retired out
from under you.

**The gap is permissions.** An OpenClaw agent blocked waiting for your approval looks, from
the office, like an agent thinking hard. That is a real loss and it is
[worth knowing before you choose this route](#what-it-cannot-see).

## Install it

```bash
npm run connect:openclaw           # install from this checkout
openclaw gateway restart           # the plugin only loads at Gateway startup
npm run connect:openclaw:status    # what is wired up, and where the events go
```

Then run the office, press `D`, and tick **OpenClaw**. A local office needs no
configuration at all — the plugin finds it.

Running the Gateway on a **server**, where there is no checkout? That is
[one command at each end](openclaw-server.md).

## Set this one flag, or desks will have no labels

```bash
openclaw config set plugins.entries.roving-office.hooks.allowConversationAccess true
```

`npm run connect:openclaw` sets it for you. **A manual or packed install has to, and this
is the single most likely reason an install looks dead.**

OpenClaw blocks conversation hooks for any non-bundled plugin unless that flag is true, and
the block is invisible from inside the plugin: registration succeeds, the handler simply
never fires. Which matters more than losing two events, because of what a plain chat turn
looks like — session start, run start, run end, and **nothing else**. No tools, no
subagents. So with those blocked, an ordinary conversation produced no event at all and the
office stayed empty with no clue why.

That is now handled rather than merely documented. The plugin **warns at startup** naming
the exact key, and still publishes what it can:

| | Without the flag | With it |
| --- | --- | --- |
| Characters appear, sessions come and go | ✅ | ✅ |
| Tool work: desks, bookshelf, outbox | ✅ | ✅ |
| Compaction, heartbeats | ✅ | ✅ |
| **Job label on the desk** | ❌ | ✅ |
| **Turn timing and tool-call counts** | ❌ | ✅ |

**What granting it actually exposes.** Those hooks carry your prompt *and* the whole message
history. This plugin reads **the prompt only** — clamped to 80 characters for a desk label,
and omitted entirely at the default redaction. It never reads the messages. If that is still
more than you want, `--no-conversation-access` declines it and the table above is the deal.

## When nothing shows up

An emitter that cannot publish looks exactly like one with nothing to say: it queues, it
retries, and it stays quiet. So **the plugin narrates itself into the Gateway log** — read
that first. `openclaw plugins inspect` will not tell you any of it, because it does not show
plugin config.

On load you get one of two lines: where it is publishing to, or `no office to publish to, so
nothing will appear` with the command to fix it. If the office then refuses a batch, it says
so once per outage rather than once per batch — and quotes the first 300 characters of the
response back at you.

**That last part is the useful bit.** A status code cannot say *who* answered, and that is
usually the whole question: the office replies JSON, a corporate proxy replies HTML.

In the order things actually go wrong:

| Symptom | Cause |
| --- | --- |
| `no office to publish to` | No office URL set — the plugin cannot know where to send |
| `HTTP 401` | Wrong or missing write token |
| `HTTP 502` | The same thing, on a hosted office, whose edge replaces the receiver's 401 |
| **`HTTP 403` + HTML** | **Not the office** — its ingest never answers 403. Something in between is blocking it: a firewall or an egress proxy. Confirm with the same request by `curl` from that host |
| `HTTP 404` | Wrong keycard in the URL, or the office expired |
| `ECONNREFUSED`, `ETIMEDOUT` | The host cannot reach the office at all |
| A `no run lifecycle` warning | The permission flag above is not set |
| **Every desk reads `Working`** | The run-start hook is not arriving. The flag above is one cause; a gateway that delivers run-end and not run-start is another, and it has been measured rather than theorised |
| Characters appear in the wrong room | No scene name set on a Gateway that is not in a repo |
| Nothing at all, no log lines | The plugin is not loaded |
| Fixes appear to do nothing | The old artifact is still installed — check the resolved version |

## What it cannot see

**There is no permission hook.** OpenClaw's approval flow runs the other way round: a plugin
*asks* for approval, and cannot observe the approvals the core raises for its own commands.

That matters more than the count of missing events suggests, because a permission request is
the only reliable signal that an agent is **waiting on you** — which is exactly what a room
full of characters is best at showing at a glance. So the office does not claim it, rather
than guessing.

**The plugin never returns a decision.** Its hooks *could* block a call, rewrite its
parameters or demand human approval. Every one of them declines to, always, and a test
asserts it. A diorama does not get a vote on whether a tool call happens.

## One warning if you also run Claude Code

OpenClaw wraps Claude Code and Codex. So a machine with **both** this plugin and the Claude
Code plugin installed can see the same work twice — once as an OpenClaw session, once as a
Claude Code session, **standing at two desks**.

The office cannot yet spot that they are the same work. Until it can, run one or the other.

## Read next

- [OpenClaw on a server](openclaw-server.md) — a Gateway with no checkout
- [Names and faces](openclaw-identity.md) — your agents keep the identities they gave themselves
- [Connect your agents](../connect-your-agents.md) — redaction, office routing, and when agents leave
- The hook payloads and the publisher's design are in the [developer docs](../../developer/adapters/openclaw.md)
