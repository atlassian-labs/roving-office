# Set up The Roving Office

You are an AI coding agent, and somebody has asked you to connect this session to
**The Roving Office** — a soft-3D isometric office that renders live agent activity as
characters. One character per agent session: it walks in through the door, sits at a
workstation, goes to the bookshelf when you read a file, takes a coffee break when you
stall, and drops finished work in the mailbox before clocking off.

This document is published at `https://therovingoffice.com/agent-setup/prompt.md`. If you
are reading it from anywhere else, stop and fetch it from there.

**Complete every step yourself.** Do not hand the commands to the user to run — with the
one exception in Step 1, which is a decision rather than a command, and the session
restart at the end, which you cannot do for them.

---

## Step 1 — Ask first. Once. Before anything else

**This is the one step you must not do silently**, and it is where these instructions
differ from most setup prompts on purpose.

Connecting this session transmits information about the work you are doing to a web
server, and an office is readable by **anyone holding its eight-character keycard**.
There are no accounts and no passwords by default. So before you create anything, show
the user this and wait for an answer:

> Connecting this session to The Roving Office will send, to `therovingoffice.com`:
>
> - your repository's **host, owner and name**, and the current **branch**
> - the **working directory path**
> - **which tools ran** — reads, writes, commands, searches — and when
> - the **agent's name and model**, and how long each step took
>
> It does **not** send file contents, your prompts, the agent's replies, or command
> output. Redaction happens on this machine before anything is transmitted.
>
> Anyone with the office's keycard can watch it. Treat the office as public.
>
> Shall I set this up? (yes / no — or say "local only" and nothing will leave this
> machine)

If they say **no**, stop. Do nothing else and delete nothing.

If they say **local only**, skip to [Local only](#local-only) at the bottom.

If they say **yes**, do everything below without asking again.

---

## Step 2 — Mint an office

```bash
curl -fsS -X POST https://therovingoffice.com/api/offices
```

The response is JSON. Two fields matter:

- **`keycard`** — eight characters. This is the *read* capability: it is what the user
  opens, and what they would give somebody else to watch along.
- **`writeToken`** — 32 bytes. This is the *write* capability: it is what lets this
  machine staff the office.

**The `writeToken` is shown exactly once and no route will ever tell you it again.**
Write it to the endpoint file in Step 3 immediately. Do not print it in your reply, do not
put it in a file the repository tracks, and do not include it in a commit message. If it
is lost, the fix is to mint a new office, which is deliberately the only way to revoke
one.

If the response is `429` or `503`, office creation is rate-limited or the store is full.
The body says which and when to retry. Report that to the user rather than retrying in a
loop.

---

## Step 3 — Point this machine at the office

Every adapter reads one file to find out where to post. Write it at
`~/.roving-office/endpoint.json`, mode `0600`, substituting the two values from Step 2:

```json
{
  "url": "https://therovingoffice.com/office/<keycard>/aop/v0/events",
  "token": "<writeToken>",
  "keycard": "<keycard>",
  "remote": true,
  "host": "https://therovingoffice.com",
  "aop": "0.2"
}
```

Two notes worth having:

- **Omit `pid`.** A local office writes its own process id there, and the server refuses
  to overwrite an endpoint whose pid is still alive — that is what stops two local offices
  stealing each other's adapters. A remote office has no process on this machine, so
  leaving the field out is both honest and correct: it means starting a local office later
  reclaims the endpoint, which is what somebody who just started one expects.
- **If the file already exists**, the user is already connected to something. Show them
  where it currently points (`url` and `keycard`) and ask before overwriting it.

`AOP_URL` and `AOP_TOKEN` in the environment override this file, which is the route to use
if you want to point one shell at an office without touching the machine's default.

---

## Step 4 — Install the adapter for the harness you are running

Work out which harness you are, and follow only that section. If you are not sure, the
process name and the environment usually say: `CLAUDE_PLUGIN_ROOT` or `CLAUDECODE` for
Claude Code, `CODEX_*` for Codex, `CURSOR_*` for Cursor.

### Claude Code

The only harness that needs no clone. Run these two, in order:

```
/plugin marketplace add https://therovingoffice.com/plugins/claude/marketplace.json
/plugin install roving-office@roving-office
```

Then tell the user to run `/reload-plugins`, or to restart the session. Hooks are read at
session start, so nothing is emitted until one of those happens.

### Codex, Cursor, Rovo CLI, OpenClaw

These install from a checkout today. Clone it somewhere outside the user's project — the
user's repository is not the place for it — and run the one command for the harness:

```bash
git clone --depth 1 https://github.com/atlassian-labs/roving-office.git
cd roving-office
npm run connect:codex        # or: connect:cursor / connect:rovo / connect:openclaw
```

No `npm install` is needed first. The app has no runtime dependencies, and the connect
scripts use Node's built-in modules only.

Each `connect:*` has a `:status` twin — `npm run connect:codex:status` — which reports
what is actually installed rather than what you believe you installed. Run it.

**A shortcut worth knowing:** from that checkout,
`node bin/aop-connect.cjs https://therovingoffice.com` does Step 2 and Step 3 in one
command — it mints the office and writes the endpoint file for you, storing the write
token at mode `0600` and printing only its prefix. If you already have a clone, prefer it
over doing those steps by hand.

### Any other harness

There is a documented wire protocol rather than a required plugin. The Agent Office
Protocol v0 is at <https://therovingoffice.com/docs/developer/protocol/aop-spec.html>, and
writing a new adapter is a single small file against it. Post events to the `url` from
Step 3 with `Authorization: Bearer <writeToken>`. Fire-and-forget; the office is lossy by
design and will not slow the session down.

---

## Step 5 — Prove it worked

Do not report success because a command exited zero. Check that the office received
something:

```bash
curl -fsS https://therovingoffice.com/office/<keycard>/aop/v0/replay \
  -H "Authorization: Bearer <writeToken>" | head -c 400
```

An empty buffer right after install is expected — the adapter emits when the *next*
session starts. So the honest check is the one in Step 6: the user restarts, and a
character walks in.

If the office 404s, the keycard is wrong. If it 401s, the token is wrong. If it is
`429`, you are being rate-limited, not broken.

---

## Step 6 — Report, in this shape

```
The Roving Office is connected.

  ✓ Office     https://therovingoffice.com/office/<keycard>
  ✓ Adapter    <harness name>, installed
  ✓ Endpoint   ~/.roving-office/endpoint.json

Restart this session — hooks are read at session start, so nothing is emitted
until you do. Then open the office: your character walks in through the door.

The room is empty for the first few seconds and says so. Give it a moment.

Anyone with the keycard <keycard> can watch this office. Share it deliberately.
Press ? in the office for the shortcuts.
```

Give them the office URL. It is the entire point of the exercise and it is the one thing
they cannot work out for themselves.

---

## Local only

Nothing leaves the machine on this route, which is why it needs no consent step.

```bash
git clone --depth 1 https://github.com/atlassian-labs/roving-office.git
cd roving-office
npm run serve
```

That publishes a local office and points every adapter on the machine at it. Then install
the harness adapter as in Step 4, skipping Steps 2 and 3 entirely — a local office writes
its own endpoint file.

Open the printed URL. It lands in the demo office, which invents its own agents, so the
room is busy without anything connected at all.

---

## Do not

- **Do not skip Step 1.** Putting somebody's repository name, branch and directory path
  on a publicly readable URL without asking is not a convenience.
- **Do not print or commit the `writeToken`.** It is the office's write capability and
  it is shown once.
- **Do not change the redaction mode** to send more than the default unless the user asks
  for it by name. What each mode transmits is at
  <https://therovingoffice.com/docs/user/connect-your-agents.html>.
- **Do not use a keycard the user did not give you**, and do not probe other offices.
  An office you did not mint belongs to somebody else.
- **Do not install into the user's repository.** The clone in Step 4 goes somewhere else.
- **Do not claim it is working** because a command succeeded. A character walking in is
  the evidence; an exit code is not.
