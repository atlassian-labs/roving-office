# Contributing

The whole loop, for a human. (Agents get their own working agreements in
[AGENTS.md](AGENTS.md); this is the shorter, person-shaped mirror.)

## What you need

**Node.js 24 and npm, and a browser.** That is the whole list. There is no database, no
service to sign into and no account of any kind.

Node 24 is what CI runs, what the deployment images use, and the only version the checks
are proved against. The development tooling itself would accept older Node — ESLint 10
sets its floor at `^20.19 || ^22.13 || >=24` — so a slightly older runtime will very
likely work, and nothing below 24 is tested. If a check fails on an older Node, try 24
before reporting it. Newer than 24 is fine and is what several contributors use.

The **app** needs nothing installed at all: Three.js is vendored under `vendor/three`, the
colour-name data is generated and committed, and `server.cjs` uses only Node's built-in
modules. `npm ci` installs **development tooling only** — ESLint, Eleventy and their
supporting packages — from the public npm registry, with no account and no company
credentials. [Getting the code](docs/developer/getting-the-code.md#installing-development-tooling)
has the details, including how to prove a clean install on a machine with custom npm
configuration.

## Run it

From a checkout or extracted source archive:

```bash
node server.cjs 8081     # no build step; 8080 is usually taken
```

Edit a file, reload the tab. Three.js is vendored, modules load straight off
disk, and there is nothing to compile — that constraint is load-bearing and
guarded jealously, so please don't introduce a build step. Open
`http://localhost:8081/office/TEST-0000/` for a **Test Data** office; it invents its own
agents, so it is busy immediately and needs no agent account and no installed adapter.

**Connecting a real harness is optional, and no check needs it.** If you want to watch
your own sessions rather than simulated ones, `npm run connect:claude` (or
`connect:rovo` / `connect:cursor` / `connect:codex` / `connect:openclaw`) installs the
adapter for that harness, and [connect your agents → user
docs](docs/user/connect-your-agents.md) covers the whole loop. Two things worth reading
before you point a real session at a *hosted* office: what an adapter transmits at each
redaction setting, in [what the default actually
sends](docs/user/connect-your-agents.md#what-the-default-actually-sends), and
[§10 of the AOP spec](docs/developer/protocol/aop-spec.md#10-privacy-and-redaction), which
is the normative statement. The short version is that redaction happens on *your* machine
before anything is sent, the default `metadata` mode still transmits your repository host,
owner and name, the branch, the working directory and which tools ran, and a hosted office
is readable by anyone holding its keycard — so treat one as public and set the mode
accordingly.

## Check it

```bash
npm ci          # dev tooling from the public npm registry
npm test        # unit, reducer, scene, server and documentation suites
npm run lint
npm run probe -- --sweep --assert=test/coplanar-baseline.json
npm run pack:openclaw
npm run pack:plugins
```

Those six are the whole of local verification. They need no credentials and no running
external service, and none of them can cause a deployment.

**CI runs those same six commands and nothing else.** `.github/workflows/ci.yml` is
verification only, on Node 24 and Node 26 — no deployment step, no secret, no credential,
so there is no class of red build you cannot reproduce locally. If your pull request comes
from a fork, a maintainer has to approve the workflow run before it starts; that is a
repository setting, not a comment on your change.

The probe seeds the scene's random dressing so its numbers do not move between runs. For
anything visual, **look at the scene** — [developing.md](docs/developer/developing.md) has
the headless screenshot recipe and its traps, and `npm run map` / `npm run portrait`
re-render the docs imagery.

## Change it

- **Adding something?** [docs/developer/extending.md](docs/developer/extending.md) has the recipe —
  a prop, a building or outlook, a source, or a harness adapter, each ending in
  a working thing. The registries fail loudly if you forget a step.
- **Where does code live?** [docs/developer/architecture.md](docs/developer/architecture.md) is the
  map, and its file tree is kept true.
- **Docs move with the code, in the same PR.** The documentation is accurate
  because that is a rule, not a hope — if your change makes a doc wrong, the
  change isn't done.
- **There are two doc sets, and the line between them is strict.**
  [docs/user/](docs/user/index.md) may assume only a download and a browser;
  [docs/developer/](docs/developer/index.md) assumes a checkout. A source path or an
  `npm test` in a user page is a failing test, not a style note. New page? Add it to
  `docs/_nav.mjs`. Then **`npm run docs`**, because `docs/site` is committed: neither
  deploy target can build, so a page that is not committed is a page that is not served.
  That build also refuses a broken internal link or a dead anchor, so renaming a heading
  means fixing what points at it in the same pass; the build lists them.
- **Change a movement, update the Character Movement Library.**
  [docs/character-movements.html](docs/character-movements.html) plays every way
  a character moves, one panel each. Because it drives the real `Agent` through
  the real `AgentController`, a change to how somebody walks or sits shows up
  there on its own — but the words beside each panel do not. If you have changed
  what a movement *is*, its note and the call listed under it are now describing
  something that no longer happens, and a library that lies is worse than no
  library. Open the page and watch the panel you touched.
  **Play the office's own action list rather than writing one for the card.** The
  sit cards once carried private copies and drifted a whole movement behind the
  room while their prose was updated twice; the sequences are exported for this
  reason (`sitDownOn`, `getIntoChair`, and so on).
- **Add or reshape a prop, look at it in the Item Library.**
  [docs/item-movements.html](docs/item-movements.html) puts every catalogue object
  on a turntable, framed the way its portrait is. It needs nothing from you when
  you add an object — a catalogue entry is a card — but it is the fastest way to
  find out that your new prop has no back, floats a centimetre off the floor, or
  faces the wrong way when it is turned.
- **The two library pages carry the same theme block, deliberately.** Each has a
  dark/light toggle so kit and movements can be checked against cream as well as
  charcoal, and each holds its own copy of the palette, the button and the
  `themechange` listener that repaints the studio floor. They ship as bare HTML —
  `docs/*.html` and nothing else — so a shared file would not travel with them.
  Change the switch in one page and change it in the other.
- **Those pages are not linted.** ESLint does not read JavaScript inside HTML, so
  the modules in these two libraries are checked by loading them and nothing
  else. A missing comma there is a blank card and a silent console, not a red
  build.
- **Comments say why.** This codebase writes its reasons down next to the code
  they justify; when you move code, the comments travel verbatim, and when you
  change a decision, rewrite its justification rather than deleting it.
- **Tuned numbers are tuned.** Footprints, offsets and camera angles measured
  by eye against the picture carry the tuning the whole room has been walked
  against. The comments say so where it matters — believe them.

## Ship it

**Open an issue first**, even for something small — one issue per piece of work, moved to
in-progress when you start and closed when it lands. It is not bureaucracy: it is how
somebody else finds out you are already doing the thing they were about to start.

Then branch from `main`, open a pull request, and let CI go green. Cut the branch in a
**worktree** rather than switching the primary checkout — [AGENTS.md](AGENTS.md) explains
why, and it is one command.

If your change touches the shared plugin files (`hooks/`, `bin/aop-send.cjs`,
`bin/aop-node.sh`, `bin/aop-plugin-hook.sh`, `bin/mappers/`, `openclaw-plugin/`,
`.claude-plugin/`, `.codex-plugin/`), **bump the plugin version** and run
`npm run pack:plugins` in the same commit — [AGENTS.md](AGENTS.md) explains the snapshot
trap that makes this non-negotiable, and `npm test` fails if you forget.

One thing about review, so it is not a surprise: a pull request that changes behaviour
without changing the documentation will be sent back for the doc rather than merged and
followed up.

## Sign it

Atlassian requires contributors to sign a Contributor License Agreement, known as
a CLA. It records that you are entitled to contribute the code, documentation or
translation you are offering, and that you are willing to have it used in
distributions and derivative works (or willing to transfer ownership). It is a
one-off: sign once and every later contribution is covered.

**A pull request cannot be accepted before the CLA is signed**, so it is worth
doing before you open one rather than after. Follow whichever link applies —
the corporate CLA if you are contributing as a member of an organisation, the
individual CLA if you are contributing as yourself:

- [CLA for corporate contributors](https://opensource.atlassian.com/corporate)
- [CLA for individuals](https://opensource.atlassian.com/individual)

Contributions are governed by the [Code of Conduct](CODE_OF_CONDUCT.md), and by
the Apache 2.0 [LICENSE](LICENSE) the project ships under: what you contribute is
licensed on those terms to everyone who receives it.
