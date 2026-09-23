# Connect your agents

*One command per harness, then your real sessions walk in through the door.*

<img src="../images/panels/source-picker.png" width="736" alt="The Choose sources dialog: six harness tiles, each with its mark, a one-line description and a badge reading either Connect to use or Ready to explore.">

*A new keycard opens this panel automatically. Press **`D`** to return to it. Test Data is ticked and ready; the rest want a one-line install.*

An office opens on **Test Data** — invented agents, so the room is busy immediately. To
watch your own instead, tick the harness feeding them and install its adapter. The
**connect your agents via plugins** link in the panel opens these instructions in
a new tab, keeping your office open.

Tick more than one to put two crews in the same room. Keep Test Data ticked alongside a
live feed while you are still getting the adapter working.

| Harness | Install it with | Page |
| --- | --- | --- |
| **Test Data** | Nothing to do — it is the default | [Test Data](sources/test-data.md) |
| **Rovo CLI** | `npm run connect:rovo` | [Rovo CLI](sources/rovo-cli.md) |
| **Claude Code** | `npm run connect:claude` | [Claude Code](sources/claude-code.md) |
| **Cursor** | `npm run connect:cursor` | [Cursor](sources/cursor.md) |
| **Codex** | `npm run connect:codex` | [Codex](sources/codex.md) |
| **OpenClaw** | `npm run connect:openclaw` | [OpenClaw](sources/openclaw.md) |

**Then start a *new* agent session.** Every harness reads its hooks when a session starts,
so anything already open keeps posting wherever it was told at launch.

Jira's cloud coding agent is not in the picker — it has no hooks to install, and it runs
where the office cannot be reached from.

## Is it working? Read the pill

The pill beside the office name says which sources are feeding the room and whether they
are alive:

| It says | It means |
| --- | --- |
| **connecting…** | Reaching for the feed. |
| **live** | Events are arriving. |
| **listening** | Connected, nothing has happened yet. |
| **no adapter** | Nothing is pushing events. You have not installed one, or the session predates it. |
| **no source** | Nothing is ticked. |

**An empty room is ambiguous, which is why the pill exists.** A live harness can
legitimately show an empty office for minutes at a stretch, and without the pill your
first assumption would always be that the app is broken.

Several feeds in one room can disagree, and usually do — Claude Code live while the Rovo
adapter is missing is a normal Tuesday. The pill stays one line and puts the disagreement
in the tooltip: it names the set, takes the best state any feed has reached, and counts
the rest beside it, so you get **`live · 2 of 3`**. Hover for the breakdown by name.

## Changing the set while people are standing in the room

Nothing is torn down to do it, and **a feed you did not touch is not touched**. Tick
Claude Code on in a room where three Rovo agents are working and the Rovo feed keeps
running, its people keep working, and the new feed is live by the time the dialog has
closed.

What does change, changes the way it would in a real office:

- **A source that arrives** starts on the spot, and its agents walk in through the door
  like anybody else.
- **A source that goes** stops, and its characters get up and leave — desk handed back,
  coat off the stand, lift called, out the door. They are not deleted where they stand.
  Unticking a source is a decision about a feed, and the person it was drawing was at a
  desk a second ago.
- **A source ticked off and straight back on is a new feed**, never the old one resumed.
  Its newcomers cannot be mistaken for the crowd still walking to the lift.

Only the picker in *your* hands does this. A change somebody else makes to the same scene
arrives the next time you open it.

## How much of your prompt the office is told

By default, **none of it**. The office gets tool names, classes, paths, durations and
counts — no free text at all, so a desk label reads "Working" rather than what you asked
for.

The first `connect:` command you run writes a settings file at
`~/.roving-office/settings.json`. To see your prompts on the desks, change one value:

```json
{ "redaction": "summary" }
```

| Mode | The office is told |
| --- | --- |
| `metadata` *(default)* | Everything in the table below. No free text from you or the model. |
| `summary` | Adds prompt-derived titles, summaries, notification messages, tool error messages, and what a search or a page fetch was for — the pattern, the query, the whole URL — each truncated to 200 characters. |
| `full` | Adds full prompt text, capped at 2 000 characters. Needs `"includePrompts": true` as a second, deliberate opt-in. |

It is a file rather than an environment variable on purpose: a hook inherits the
environment of the session that spawned it, so a variable would mean restarting
everything, while this file is read per event and your very next tool call already obeys
it.

### What the default actually sends

The three modes above are each other's superset, so this is the floor: everything here
leaves your machine at `metadata` too, and there is no setting short of not connecting
that stops it. It is a longer list than "no free text" suggests, which is why it is
written out rather than summarised.

| Sent even at `metadata` | What that looks like |
| --- | --- |
| **Tool activity** | Each tool's name and kind, how long it took, how many bytes came back, and whether it failed. Not the results, and not the arguments except as the four rows below describe. |
| **File paths** | The paths the tools touched, shortened — relative to the directory you are working in where they sit under it, otherwise with your home directory written as `~` — and cut off at 200 characters. Shortened is not hidden: a path under your home directory still names every folder below it. <!-- redaction:target-path --> The name of a saved prompt or command you ran goes the same way, because you named it rather than typed it into a conversation. <!-- redaction:target-name --> |
| **What a command runs** | The program and, for a handful of tools whose subcommands are their identity, a word or two more: `ingest.sh`, `gcloud auth`, `git commit`. Never the whole command line, never a quoted string, never an assignment, and nothing after a word that reads like a credential. <!-- redaction:target-command --> |
| **That a search happened, and not what you searched for** | A grep, a file search or a web search sends the fact of it and nothing else — no pattern and no query. The office animates the trip to the bookshelf without being told the question. <!-- redaction:target-search --> |
| **The host a page was fetched from** | For a page fetch, `docs.example.com` — the site and nothing else. Not the path, and **not the query string**, which is where an access token in a URL would be. <!-- redaction:target-network --> |
| **The directory you are working in** | Shortened the same way, so your account name does not travel — but every folder below your home folder does, which is the project's name and where you keep it. A directory that is *not* under your home folder has nothing to shorten and goes as the absolute path it is. |
| **Your repository** | Just `host/owner/repo` — `bitbucket.org/you/your-repo` — and never the URL you cloned with. So a remote with a password or an access token written into it (the `https://user:token@host/…` form) does not send the credential: only those three parts are sent, and a remote that cannot be reduced to them sends nothing at all. A remote that is a local directory is treated as the path it is, and shortened like one. |
| **The branch, and the repository's name** | The current branch, and the name the office files your sessions under — the last part of the remote, or of the folder if there is no remote. |
| **How long your prompt was** | A character count. Never the words. |
| **Which harness, and how you ran it** | Its name, version, and whether it was the terminal, a desktop app or an SDK. |
| **The shape of the work** | Step numbers and their status, and how many items a plan has — "Step 2 of 5", never what step 2 says. |
| **Scheduled jobs** | For a run started by a schedule rather than by you: the job's name, its id and its schedule, as the operator wrote them. Not its description. |
| **An agent's identity** | Where your harness lets you name an agent, its name, its colour and the address of its avatar image. Truncated, but not redacted at any setting. |
| **Session identifiers** | The ids of the session and of any parent session, and the kind of agent — for example that a subagent is a research one. |

**Withheld at `metadata`, and this is what the setting buys you:** your prompts, the
desk labels derived from them (every desk reads *"Working"* instead), the title your
harness generated for the session, tool error messages, the titles of individual steps,
summaries, notification text, a scheduled job's description, and what a search or a page
fetch was looking for — search patterns, web queries, and everything in a URL after its
host. File contents, tool results, transcripts, diffs, environment variables and secrets
are never sent at any setting.

**A desk says what is being worked on, not what is being asked.** At `metadata` a trip
to the bookshelf carries the *file* — *"researching AopSource.js"* — because a path is
on the list above. A search or a web fetch carries the trip and not the question, so the
character walks over and looks something up without the office being told what. Raising
the mode to `summary` is what adds the pattern, the query and the whole URL.

**Two things are never sent, whatever the mode.** Your account name, because a path under
your home folder is written `~/…` before it goes; and any credential embedded in a git
remote, because only `host/owner/repo` is sent and never the URL you cloned with. Neither
needs anything from you — no setting to change and no remote to go and check first.

That is not the same as anonymity, and the difference is worth being precise about: a
shortened path still names every folder below your home folder, so *"which repository, on
which branch, in which directory, doing what with which tools"* is exactly what the
default sends. What it withholds is the words — yours and the model's — and who you are on
your own machine.

> **Anything on a public URL should be treated as public.** The default is not anonymous:
> read the table above and decide before you hand a keycard round. Redaction also happens
> on *your* machine, before anything is sent — which is the good news and the catch. The
> office never receives what was dropped, so nothing downstream can leak it; equally,
> tightening the setting later does nothing about what already went.

## One office per repository

Which office your sessions land in is derived from the git **remote**, not the directory —
so every worktree and every clone of one repository shares a single room.

If a repository is named differently from the office you want it in, map it in
`~/.roving-office/projects.json`, which is created for you and never overwritten:

```json
{ "aliases": { "bitbucket.org/you/your-repo": "the-roving-office" } }
```

## When agents leave

A character is only removed when the office concludes the session is gone — and
**idleness is not evidence of death.** A hook is dead between events, so quiet is the
normal state of a session that is very much alive and waiting on you.

So there are two clocks. An adapter that promises to say goodbye gets **30 minutes** of
silence, the timer being only a backstop for a process killed mid-sentence. Anything that
makes no such promise is cleared after **5 minutes**.

If you see somebody walk out while you are still thinking, that is the five-minute clock —
which means their adapter never said it would announce its own exit.

### And the blue cone of light

Being retired is only the *start* of leaving: the character hands their desk back, takes
their coat off the stand, calls the lift and walks out, and every step of that crosses a
room with other people in it. So there is a third clock. **Thirty seconds after being told
to go home, anybody who has not managed it is beamed up** — a cone of blue light comes
down out of the sky, they rise into it, and they are gone. Everything the door would have
given back is given back the same way.

It exists because a departure can be blocked, and because of one blocker in particular:
**a browser stops drawing frames for a tab nobody is looking at, and the walk out only
advances on a drawn frame.** The clocks keep running in a background tab regardless, so a
window left behind another one for a few hours filled up with a whole night's worth of
arrivals, every one of them told to leave and not one able to take a step.

If you ever look up to see the office being cleared out in a shower of blue cones, that is
what you are watching — and it means the window had been out of sight for a while. Ask for
reduced motion and there is no cone, just an empty patch of floor.
