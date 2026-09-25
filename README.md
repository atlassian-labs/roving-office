# The Roving Office

An office full of characters, and the characters are your AI agents.

It is a soft-3D isometric office where your agents come to life — stylised characters that
walk in through the door, sit down at workstations, look things up, take coffee breaks, and
drop finished work in the mailbox before clocking off. One character per agent session. The
room *is* the status board.

> **See it now → [the demo office](https://therovingoffice.com/office/TEST-0000)**
>
> Nothing to install. That room runs on *simulated* agents, so it is already busy.
> [Reception](https://therovingoffice.com/) will cut you an empty office of your own.

The goal is skeuomorphic and fun rather than a true simulation: the elements are chosen
because they tangentially relate to the work being done, and because an office with
nothing to notice is a screensaver. It's very alpha, and was written mostly on a plane.

## Documentation

**[therovingoffice.com/docs](https://therovingoffice.com/docs)** — or read the Markdown it
is built from, right here in the repository:

| | |
| --- | --- |
| **[User docs](docs/user/index.md)** | Install it, connect your agents, read the room. Assumes a browser and nothing else. |
| **[Developer docs](docs/developer/index.md)** | How it works and how to change it. Assumes a checkout. |

Two good places to start: [watching the office](docs/user/watching.md) is two minutes and
no install; [getting the code](docs/developer/getting-the-code.md) is the whole loop for a
contributor.

The three generated library pages are worth a look on their own —
[every character movement](docs/character-movements.html),
[every object on a turntable](docs/item-movements.html), and
[two dozen generated offices](docs/office-seeds.html).

## Run it

Built with [Three.js](https://threejs.org/), vendored into the repo and resolved through
an import map — no build step, no install, no network. One process does everything: static
files, the office API, and the receiver your agents post to.

```bash
npm run serve          # the office your agents feed
node server.cjs        # a private one, on the first free port from 8080
```

Then open the printed URL. It lands you straight in the **demo office**, `TEST-0000` — `/`
redirects there, so there is nothing to type to get in.

It will be empty for the first few seconds, and it says so: *"The office is ready."* Give
it a moment. The default source invents its own agents, and they walk in through the door
one at a time rather than appearing all at once — the first within about four seconds, then
a steady trickle until the room is busy.

**Reception** is the other page, at `/offices`: a keycard field, a button that mints you a
fresh office, and beside them a live corner of the room so you can see what you are being
let into.

When you want it to be *your* agents, either let the agent set itself up —

> Fetch and execute the appropriate instructions to set me up for The Roving Office from
> <https://therovingoffice.com/agent-setup/prompt.md>

— or do it yourself:

```bash
npm run connect:rovo     # or: connect:claude / connect:cursor / connect:codex / connect:openclaw
```

Start a new agent session, press `D`, and tick that harness. You can tick more than one —
an office holds a set of sources, so a Rovo terminal and a Claude session can share a room.

Press `?` for everything else, including `F`, which puts you inside a selected character's
head and lets you watch the office from the floor.

## Agents

It opens on **simulated** agents, so a fresh checkout is busy with nothing installed. It
runs on real ones too: there are adapters for **Rovo CLI**, **Claude Code** (terminal,
desktop and SDK), **Cursor**, **Codex** and **OpenClaw**. Multiple agents, and multiple
harnesses, can share one office.

## Roadmap

- **Done:** the [Agent Office Protocol](docs/developer/protocol/aop-spec.md) and its
  receiver, plus adapters for all five harnesses above. OpenClaw is the first long-lived
  bridge, so it can heartbeat — and its agents keep
  [the names they gave themselves](docs/user/sources/openclaw-identity.md).
- **Next:** richer bridge integrations. OpenClaw is in as a plugin rather than hooks, and a
  plugin cannot see permission prompts — the events that would show a character waiting to
  be allowed to do something. Its Gateway WebSocket would carry them.
- **Then:** [ghost rendering for subagents](docs/developer/scene-internals.md#subagents-are-ghosts)
  — the Claude and Codex feeds already carry them — and click-through to live transcripts.

## Elsewhere

The [repository](https://github.com/atlassian-labs/roving-office), and two very
early [demo](https://www.loom.com/share/42b516461af2465b80c3f2245a30b31e)
[Looms](https://www.loom.com/share/5cec3bbeaad745b7868342f25bdcd3b9) (probably out of
date). Bugs, questions and proposals belong on the repository's issue tracker, where
everyone can read the answer.

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) for humans,
[AGENTS.md](AGENTS.md) for agents.

## License

Copyright (c) 2026 Atlassian US., Inc.
Apache 2.0 licensed, see [LICENSE](LICENSE) file.

**That covers the code, and not the brand marks in it.** A handful of the logos in
the scene and the source picker are other companies' trademarks, reproduced to say
which agent an office can listen to. Apache-2.0 disclaims trademarks but not
copyright in artwork, so those assets are excluded from the licence grant and named
one by one in [NOTICE](NOTICE) — fork this and you need your own permission for
them. [Visual assets and their rights](docs/developer/visual-assets.md) gives every
visual asset its source and release basis, first-party artwork included, and is the
place to start if you are adding one.
