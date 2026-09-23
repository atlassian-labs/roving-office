# Install and run it

*Five minutes, and the room opens already full of people.*

You do not have to install anything to look at an office —
[therovingoffice.com](https://therovingoffice.com/) will cut you one. Install it when you
want the office to be *yours*: on your machine, fed by your own agent sessions, and not
sharing a URL with anybody.

## What you need

- **Node 24 or newer.** That is the whole list. There is no build step, no bundler, and
  the app itself has no dependencies — three.js ships inside the download.
- **The files.** Grab the repository from
  [GitHub](https://github.com/atlassian-labs/roving-office) — clone it, or
  download it as an archive and unpack it. Either is fine; nothing here needs `git` to
  run.

## Run it

```bash
npm run serve
```

Then open the URL it prints — usually `http://localhost:8080`. You arrive directly
in the demo office, with a random building and season and a clock showing your
local time. Simulated agents are already getting to work. Watch,
move things around, or press `?` for shortcuts. Choose **Open your own office** in
the scene menu to open a personal office, or use the
[keycard page](https://therovingoffice.com/offices) to enter one you already have.

<img src="../images/screens/watching.png" width="950" alt="The demo office with simulated agents and a small hint at the bottom: Watch. Play. Discover. (You can't break anything) If lost, type ?.">

Open a new office and it is **already busy**. The default source invents its own agents, so
there is nothing to configure before you can watch somebody take a coffee break.

That one command does everything — the page, the office, and the receiver your agents will
eventually post to. One process, no services.

## The other command, and when you want it

```bash
node server.cjs        # a private office, on the first free port from 8080
```

The difference is who they speak for.

**`npm run serve` publishes.** It tells every agent adapter on this machine "post here", by
writing a small file in your home directory that they all read. That is what you want for
the office you actually watch.

**`node server.cjs` does not touch that file.** It takes the first free port between 8080
and 8095 and leaves the adapters pointing wherever they already point. That is the right
choice for a second or third office, because there is only one of those files — and a
server that quietly grabs it redirects the agents you were watching into a different room.

Name a port and you get that port or an error, never a silent substitution:

```bash
node server.cjs 8081
```

> A plain static file server will not do. Offices live on this server's own routes, and
> opening the files directly with `file://` will not load the app at all.

## What to do next

- **[Watching the office](watching.md)** — how to read the room you are now looking at.
- **[Keys and panels](keys.md)** — press `?` in the app for the same list.
- **[Connect your agents](connect-your-agents.md)** — when you want it to be your real
  sessions in there instead of invented ones.

Want to change how the office works? That is the
[developer documentation](../developer/getting-the-code.md), which covers the tests, the
scene probe and the traps.
