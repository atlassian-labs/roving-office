# Every npm script

*What each command in `package.json` does, and which of them you actually need.*

There is no build step here, so `package.json` is as close as this project gets to a
Makefile: the scripts below are the whole interface to it. Most days you need four of
them — `dev`, `test`, `lint`, `probe` — and the rest are there for the day you need
exactly one of them.

> **This page is generated.** `bin/gen-npm-scripts.mjs` writes it from `package.json`,
> where each script's description lives in a `scriptDocs` entry beside the command
> itself. Editing this file by hand is wasted keystrokes: `npm test` will notice, and the
> next `npm run docs` will overwrite you. Add a script, add its `scriptDocs` line, run
> `npm run docs`. The generator refuses to run if you forget either half.


## Run it

No build step, so there is nothing to compile first. Edit a file, reload the tab.

| Script | Runs | What for |
| --- | --- | --- |
| `npm run start` | `node server.cjs` | Run the office on 8080. Same as `dev`; the name npm users expect. |
| `npm run serve` | `node server.cjs --publish 8080` | Run the office **and publish it**: writes ~/.roving-office/endpoint.json, so every adapter on this machine feeds it. One of these at a time. |
| `npm run dev` | `node server.cjs` | Run a private office on the first free port from 8080 to 8095. Touches no endpoint file, so it cannot steal adapters from the office someone is watching. |

## Check it

Local checks and generation checks, using the same commands as the CI verification step. Internal deployment steps run separately and require maintainer access.

| Script | Runs | What for |
| --- | --- | --- |
| `npm run probe` | `node bin/coplanar-probe.js` | Hunt coplanar faces — two surfaces at identical depth, which is what almost every graphical glitch here turns out to be. `-- --sweep --assert=test/coplanar-baseline.json` is the CI form. |
| `npm run colours:check` | `node bin/gen-colour-names.mjs --check` | Fail if the vendored colour table has drifted from what the generator would write. |
| `npm run pack:openclaw` | `node bin/aop-openclaw-pack.cjs --verify` | Pack the OpenClaw plugin into dist/ and run the artifact from a temp dir. `--verify` is the point: it proves the vendored seam still works outside the repo. |
| `npm run pack:plugins:check` | `node bin/aop-plugin-pack.cjs --check` | Fail if the committed Claude marketplace and archive have drifted from this checkout, or if the three manifests disagree about the version. Part of `npm test`. |
| `npm run docs:scripts:check` | `node bin/gen-npm-scripts.mjs --check` | Fail if this page has drifted from package.json. Part of `npm test`, so it cannot be forgotten. |
| `npm run test` | `node --test` | The whole suite — unit, reducer, scene, server, docs. Plain node:test, no browser, no services, seconds. |
| `npm run lint` | `eslint .` | ESLint over everything it can read. Note it cannot read JavaScript inside HTML, so the standalone `docs/*.html` pages are checked by loading them and nothing else. |

## Connect a harness

Each installs the hooks or plugin that make *your* sessions show up in the room. Every one of them has a `:dry` that changes nothing and a `:status` that says whether what is installed still matches this checkout.

| Script | Runs | What for |
| --- | --- | --- |
| `npm run connect:rovo` | `node bin/aop-rovo-install.cjs` | Install the Rovo CLI hooks that feed the office. |
| `npm run connect:rovo:dry` | `node bin/aop-rovo-install.cjs --dry-run` | Show what installing the Rovo hooks would change, and change nothing. |
| `npm run connect:rovo:status` | `node bin/aop-rovo-install.cjs --status` | Whether the Rovo hooks are installed, and whether they still match this checkout. |
| `npm run disconnect:rovo` | `node bin/aop-rovo-install.cjs --uninstall` | Remove the Rovo CLI hooks. |
| `npm run connect:openclaw` | `node bin/aop-openclaw-install.cjs` | Install the OpenClaw plugin from this checkout, as a link. |
| `npm run connect:openclaw:dry` | `node bin/aop-openclaw-install.cjs --dry-run` | Show what installing the OpenClaw plugin would change, and change nothing. |
| `npm run connect:openclaw:status` | `node bin/aop-openclaw-install.cjs --status` | Whether the OpenClaw plugin is installed, and against which checkout. |
| `npm run disconnect:openclaw` | `node bin/aop-openclaw-install.cjs --uninstall` | Remove the OpenClaw plugin. |
| `npm run connect:claude` | `node bin/aop-claude-install.cjs` | Install the Claude Code plugin that feeds the office. |
| `npm run connect:claude:settings` | `node bin/aop-claude-install.cjs --settings` | Point Claude Code at the office through settings rather than the plugin — no version bump, no session restart. |
| `npm run connect:claude:dry` | `node bin/aop-claude-install.cjs --dry-run` | Show what installing the Claude Code plugin would change, and change nothing. |
| `npm run connect:claude:status` | `node bin/aop-claude-install.cjs --status` | Whether the Claude Code plugin is installed, and whether its snapshot has drifted from this checkout. |
| `npm run disconnect:claude` | `node bin/aop-claude-install.cjs --uninstall` | Remove the Claude Code plugin. |
| `npm run connect:cursor` | `node bin/aop-cursor-install.cjs` | Install the Cursor Agent hooks that feed the office. |
| `npm run connect:cursor:dry` | `node bin/aop-cursor-install.cjs --dry-run` | Show what installing the Cursor hooks would change, and change nothing. |
| `npm run connect:cursor:status` | `node bin/aop-cursor-install.cjs --status` | Whether the Cursor hooks are installed, and whether they still match this checkout. |
| `npm run disconnect:cursor` | `node bin/aop-cursor-install.cjs --uninstall` | Remove the Cursor Agent hooks. |
| `npm run connect:codex` | `node bin/aop-codex-install.cjs` | Install the Codex plugin that feeds the office. |
| `npm run connect:codex:dry` | `node bin/aop-codex-install.cjs --dry-run` | Show what installing the Codex plugin would change, and change nothing. |
| `npm run connect:codex:status` | `node bin/aop-codex-install.cjs --status` | Whether the Codex plugin is installed, and against which checkout. |
| `npm run disconnect:codex` | `node bin/aop-codex-install.cjs --uninstall` | Remove the Codex plugin. |

## Point this machine somewhere else

By default adapters feed the office on this machine. These three aim them at an office on a URL instead, and aim them back.

| Script | Runs | What for |
| --- | --- | --- |
| `npm run connect:remote` | `node bin/aop-connect.cjs` | Mint an office on a remote host and point this machine's adapters at it. Takes the host URL. |
| `npm run connect:remote:status` | `node bin/aop-connect.cjs --status` | Where this machine's events are going, and whether anything is spooled waiting to drain. |
| `npm run disconnect:remote` | `node bin/aop-connect.cjs --disconnect` | Hand this machine's adapters back to the local office. |

## Regenerate what is generated

A handful of things in this repo are written by a script rather than by hand, because they are derived from something else and would drift if they were typed.

| Script | Runs | What for |
| --- | --- | --- |
| `npm run portrait` | `node bin/prop-portrait.js` | Photograph every catalogue object on its own, into docs/images/objects — the gallery in the kit. `-- --id=chair` for one, `-- --list` to see what there is. |
| `npm run map` | `node bin/scene-map.js` | Photograph each theme's whole exterior from straight above, into docs/images/maps. `-- --theme=tower` for one. |
| `npm run colours` | `node bin/gen-colour-names.mjs` | Rewrite src/agents/colour-names.js, the table that turns `burnt sienna` into a colour. Fetches a pinned list; run it about once a year. |
| `npm run docs` | `node bin/gen-npm-scripts.mjs && eleventy` | Regenerate this page, then build docs/site — the HTML served at /docs. Run it after editing any Markdown under docs/user or docs/developer. |
| `npm run docs:serve` | `eleventy --serve --port 8091` | Build the docs and watch them on 8091, so a Markdown edit reloads the page. |
| `npm run docs:scripts` | `node bin/gen-npm-scripts.mjs` | Rewrite this page from package.json alone. `npm run docs` does it for you; this is for when that is all you changed. |

## Anything else

Not yet filed under a heading above.

| Script | Runs | What for |
| --- | --- | --- |
| `npm run shot` | `node bin/office-shot.js` | Photograph a **running** office for the docs — it waits for people to walk in first, which a load-time screenshot cannot. Needs an office already up. `-- --out=x.png --hide-ui --wait=70000`. |
| `npm run plan` | `node bin/office-plan.js` | Generate a whole office from a seed and print it as a plan you can read. `-- misty-quay-3100` for one, `-- --from=some.json` to draw a layout somebody made. |
| `npm run plan:sweep` | `node bin/office-plan.js --sweep=2000 --quiet` | Generate two thousand offices and check every one against the gate and the scorecard. This is the test that the generator cannot make a room that does not work. |
| `npm run plan:gallery` | `node bin/office-plan.js --gallery=24 --out=docs/office-seeds.html` | Draw two dozen seeds as a contact sheet, into docs/office-seeds.html — names, reasons, scorecards, and an *Open this office* link each. |
| `npm run plan:variety` | `node bin/office-variety.js` | Rewrite docs/office-variety.html: thirty consecutive seeds to scroll past, each with its own name, reasons and scores. Take the pictures first with `npm run map -- --seed=variety-1 …` — this only writes the page. |
| `npm run sim` | `node bin/sim-office.js` | Run one office headless and print what happened in it: errand times, detours, clipped frames, stuck walkers. The tool to reach for when a fitness number moves and nobody knows why. |
| `npm run fitness` | `node bin/office-fitness.js --seeds=96 --minutes=3` | One number for the whole layout generator, over the tune seeds: the plan's scorecard, the office actually running, and a taste model fitted to human judgements. See docs/developer/tuning-the-layouts.md. |
| `npm run fitness:hold` | `node bin/office-fitness.js --hold --seeds=96 --minutes=3` | The same number over the held-out seeds the tuning never optimises against. A gain that appears here is a gain; one that does not is a sample being learnt. |
| `npm run fitness:guard` | `node bin/office-fitness.js --seeds=96 --minutes=3 --guard` | Exit non-zero if any floored component has fallen — the check that stops a room being made quicker to walk about by making it less like an office. |
| `npm run fitness:record` | `node bin/office-fitness.js --seeds=96 --minutes=3 --record` | Rewrite test/fitness-floors.json from the current generator. Raises the ratchet, so run it deliberately and say why. |
| `npm run fitness:noise` | `node bin/office-fitness.js --seeds=96 --minutes=3 --noise=6` | Measure the sampling error between disjoint seed sets of the same size. The smallest improvement worth believing. |
| `npm run pack:plugins` | `node bin/aop-plugin-pack.cjs --verify` | Build the Claude and Codex plugins as distribution artifacts, then install and fire a hook from a temp directory with no checkout above it. Writes the hosted marketplace the site serves; `pack:plugins:check` is what asserts you committed it. |

## Read next

- [Getting the code](getting-the-code.md) — the five commands that make up a full local check
- [Developing on it](developing.md) — the loop, the probe, and the traps
