# Developing on it

There is no app build step or npm runtime install. `index.html` carries an import map, [Three.js](https://threejs.org/) is vendored under `vendor/three`, and every module loads as an ES module straight from disk — so the whole loop is *edit a file, reload the tab*. Use Node.js 24 and npm for the development tools; [getting the code](getting-the-code.md) covers installation from public npm. The one thing you need running is `server.cjs`, which is the static server, the office API and the AOP receiver in a single process:

```bash
node server.cjs          # takes the first free port from 8080 to 8095
```

Run it as often as you like — one per worktree is the normal state of things. A server
started this way is **private**: it does not write `~/.roving-office/endpoint.json`, so it
cannot redirect the hooks feeding an office somebody is watching, and it prints the
`AOP_URL` / `AOP_TOKEN` pair that points a single shell at it if you want to send a session
there. Name a port (`node server.cjs 8081`) and you get that port or an error, never a
quiet substitution. `npm run serve` is the other one — it publishes, and it is how the
office you actually work in gets fed.

It listens on **loopback only**, so `http://localhost:<port>` works and nothing else on
your network can reach it. That is not caution for its own sake: this server hands out
any file under the checkout, with no allowlist, because that is what makes *edit a file,
reload the tab* work — and the checkout also holds your uncommitted work, your `.git`
and whatever local tool configuration you keep in the tree. A wider bind offers all of
it to whoever shares the wifi. If you genuinely need another device to reach it — a
phone, a tablet, a VM — say so once: `HOST=0.0.0.0 node server.cjs`. The banner then
names the interface it bound, so you can tell at a glance which kind of server you are
looking at. The container recipe sets the same variable, because inside a container
loopback reaches nothing at all.

For a local simulation, open `/office/TEST-0000/` on the server's printed URL. Test Data
runs without any connected harness, company account or external service.

Almost every graphical glitch in this scene has turned out to be the same bug: two faces landing on exactly the same coordinate, which gives the depth buffer no way to order them, so the surfaces flicker against each other as the camera moves.

```bash
npm run probe -- --sweep --assert=test/coplanar-baseline.json
```

That builds every building and season headlessly and asserts nothing contests a plane worse than the recorded baseline — CI runs the same command, so a new pair fails the build. Run it after adding geometry — it is far better at finding this than looking is; a deliberate change re-records with `--record=`. See [docs/coplanar-probe.md](coplanar-probe.md) for how to read the output and how to identify what a pair actually is.

## What CI runs

`.github/workflows/ci.yml`, and it is verification and nothing else — six commands, all
of them ones you can run from a checkout:

```
npm ci
npm run lint
npm test
npm run probe -- --sweep --assert=test/coplanar-baseline.json
npm run pack:openclaw
npm run pack:plugins
```

That is the same list by the same script names, on Node 24 and Node 26. `npm test` covers
the unit, reducer, scene, server and documentation suites, and it also asserts the
committed docs site and the third-party inventory are current — so run `npm run docs`
after documentation edits and `node bin/gen-third-party.mjs` after touching a dependency
or a deployment recipe, or CI fails where you would rather it did not. The headless tools
import vendored Three.js, so nothing needs network beyond the npm install.

**It holds no credential and deploys nothing, and that is a security boundary rather than
a simplification.** A public repository takes pull requests from forks, and a job that
touches a deploy token while running a fork's code hands that token to whoever wrote the
diff. So the workflow uses `pull_request` rather than `pull_request_target`, declares
read-only permissions, and references no secret. One guard lives in the repository
settings instead, because a workflow cannot require its own approval: **Settings →
Actions → General → Fork pull request workflows → require approval for all external
contributors.**

Deployment is therefore a maintainer action from a checkout rather than a CI step. The
maintainers' internal mirror of this repository runs its own pipeline that also promotes
the hosted demo on merge; it reaches infrastructure a contributor has no access to,
nothing in verification depends on it, and it is not part of this workflow.

## Look at the scene

The scene is the product, so for anything visual, **look at it**. A headless screenshot catches what no unit test can, and takes seconds:

```bash
node server.cjs 8081 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --enable-unsafe-swiftshader --user-data-dir=/tmp/shot-profile \
  --window-size=1600,1000 --screenshot=/tmp/shot.png http://localhost:8081/
```

Give each shot its own `--user-data-dir`, and do **not** reach for `--virtual-time-budget`: virtual time never expires against a render loop, so the flag hangs and writes nothing — and under it `requestAnimationFrame` never fires at all, so no loop-driven animation advances however long the budget. Chrome fires the shutter at load instead, which is the thing to design around, because that is *earlier than you think*: a dynamically imported module never makes it, and neither does anything that fades or walks in. For those, screenshot a throwaway harness page that imports the module statically, mounts it and disables transitions — the same trick as mounting the real panels against a stub manager for UI detail. `--force-prefers-reduced-motion` is the other half of it. On macOS, `sips -c H W --cropOffset Y X` magnifies a region for a closer look.

## Photograph one object

For a single prop, there is a tool, and it is the same idea with the room taken away:

```bash
npm run portrait -- --id=chair       # one object, transparent background, into docs/images/objects
npm run portrait -- --list           # everything there is to photograph
npm run portrait                     # the lot, which regenerates the gallery
```

Each object is a named entry in `src/scene/catalogue.js`, so a new prop earns its picture by exporting its builder and adding four lines. The pictures fill the [Item Library](../item-movements.html); [photographing a prop](prop-portraits.md) documents the tool and the five things worth knowing about how it takes them.

It is also a quick way to *see* a prop you are working on without walking an agent across the room to it — open `bin/prop-portrait.html?id=chair` by hand and it is right there, lit and centred.

One caveat when two servers are up: only one process can hold `~/.roving-office/endpoint.json`, so the second serves the UI but receives no adapter events. Give that one a [Test Data](test-data.md) office and it behaves.

## Photograph a whole theme from above

For the city round the room rather than the room or one object in it, there is a third tool: a straight-down orthographic shot of a theme's whole exterior — street, park, skyline, service yard, whatever that theme actually builds — not only the office at the centre of it. Built the same way `buildWorld()` builds a live world (environment, lighting, props) but with no agents and no feed, so it is a static, deterministic picture rather than a frame of a running office.

```bash
npm run map                     # every theme, into docs/images/maps
npm run map -- --list           # which theme keys there are
npm run map -- --theme=tower    # just one, while you're working on it
```

The frame is fitted to whatever the theme actually built (the same reasoning as `prop-portrait.html`'s subject-fitted framing, applied to a whole exterior), rather than to the room: a skyscraper's neighbouring towers run to roughly 150 units across, a street to roughly 80, and hand-carrying both numbers — and a third the day a fifth theme wants something else — is exactly the kind of thing worth deriving instead. The one thing excluded by hand is the 220x220 backdrop ground plane `buildExterior()` always lays down so there's never a visible void under the scene: real content tops out at a few dozen units in any one mesh, so anything wider *and* deeper than 100 units is that plane, not something to frame. The settings are captioned in [buildings and themes → user docs](../user/buildings.md#the-cities-from-above).

## Where to make a change

Reception, the app and the documentation share `assets/ui-theme.css`: warm white
surfaces, dark ink, blue actions and semantic status colours. Eleventy copies that
stylesheet and the bundled fonts into the documentation site. Prefer its tokens to
hard-coded panel colours so dialogs and documentation stay consistent. Interactive
accents use blue; body text and metadata use ink and muted tokens. Paper and furniture
colours belong to the scene rather than to text or control styling.

The fonts are Inter 4.1 and JetBrains Mono 2.304, both under the SIL Open Font License
1.1, committed as `assets/Inter-latin.woff2` and `assets/JetBrainsMono-latin.woff2` and
loaded from there — nothing fetches a font at run time. `vendor/inter/` and
`vendor/jetbrains-mono/` hold each licence and a README recording the upstream release
and the `pyftsubset` command that produced the latin subset, following the same pattern
as `vendor/three/`; `third-party/inventory.json` and `THIRD_PARTY_NOTICES.txt` carry the
same provenance alongside every other third-party file, and
[Visual assets and their rights](visual-assets.md) records the source and release basis
of every visual asset in prose. The UI uses these
shared foundations with native HTML controls; it does not require a React or Atlaskit
runtime.

Both faces are used with a few of their character variants switched on, through
`--font-variants-sans` and `--font-variants-mono` in `assets/ui-theme.css`: the seriffed
capital `I`, the flat-top `3`, the spurred `G`, square dots and straight quotes, and a
dotted mono zero. **That is more fiddly than it looks, and the reason is one CSS rule.**
`font-feature-settings` is a low-level property that *replaces* the inherited feature
list rather than adding to it, and it also beats `font-variant-numeric`. So a rule that
sets it drops everything it does not restate — which is why the token exists, why the
nine rules in `styles.css` that want tabular figures write
`font-feature-settings: var(--font-variants-sans), 'tnum' 1` instead of
`font-variant-numeric: tabular-nums`, and why the four rules that use the `font`
shorthand restate the token straight after it. Change a font rule without the token and
the symptom is subtle: digits stop lining up in a column, or one letterform quietly
reverts.

The visual identity follows the same distinction as Atlassian Design's
[app logos](https://atlassian.design/foundations/logos) and
[illustrations](https://atlassian.design/foundations/illustrations): a simple mark
for recognition, with more expressive artwork where there is room for a story.
The logo is the multicolour isometric office in `assets/logo.png`: blue and purple
walls, an orange doorway and a green garden edge. Its PNG variants and favicon are
committed alongside it. Keep the wordmark as native text, and leave the transparent
mark free of an extra background tile or shadow.

Interface colours use the brand-refresh palette published in `@atlaskit/tokens`
16.11.3: neutral white/grey surfaces, Blue700 actions, and Green200/Green800 for
layout import feedback. The office's material palettes remain expressive and separate
from the UI. Inter is the main face; JetBrains Mono is for numeric readouts and code.
Shared definitions live in `assets/ui-theme.css`.
Reception uses the real animated vignette with flat sunshine and leaf shapes.
The small SVG illustrations explain arrivals, research and deliveries; the arrivals
and mug illustrations also give empty states a welcome. Keep these out of dense
settings and active work views. Characters, movement and materials carry the
personality of the room. Blue remains the action colour; yellow and lime are accents
for artwork, not text colours. Shared spacing, type and radius tokens keep the
controls consistent: 6px for controls, 8px for surfaces and 12px for dialogs, following
the [radius foundations](https://atlassian.design/foundations/radius).

The viewing clock starts at 11:00 for a sunny arrival. **Scene → Now** returns it to
local time; the time scrubber selects any other hour. Event timestamps use real time.
The renderer uses exposure 1.0 and a gentler midday sun to preserve material
colour. Editor cells and routes are unlit and bypass tone mapping; the legend
uses the same cell colours. Routes sit above rugs and selection overlays.
Lighting keeps ambient fill at night so the office remains legible while the sun,
sky and lamps continue to follow the selected time.

| You want to | Start in |
| --- | --- |
| Move a desk, add a station | `src/layout.js` — the floor plan, stations and nav-grid footprints all derive from it. To find the position first, drag it: [the furniture editor](editor.md) |
| Change the furniture editor | `src/editor/` — the mode (`editor.js`), its overlays (`gizmos.js`), its panel (`panel.js`) |
| Change what an agent *does* | `src/agents/AgentManager.js`, and `states.js` for the action queue |
| Change how they move | `src/agents/pathfinding.js` and [physics.md](physics.md) |
| Add a prop ([full recipe](extending.md#add-a-prop)) | one file in `src/scene/props/` (builder + any custom mounting), one line in `props/index.js`, one entry in the layout's kind table — the registry fails loudly if any of the three is missing. Then a `scene/catalogue.js` entry so it appears in the [Item Library](../item-movements.html) |
| Add an outlook ([full recipe](extending.md#add-a-building-or-an-outlook)) | one module in `src/scene/outlooks/` exporting its definition, one line in `outlooks/index.js`, one mode string in `projects.js` — the registry fails loudly if any is missing |
| Add a theme or a building | `src/projects.js`, then [buildings and themes](../user/buildings.md) |
| Add a source | `src/data/AgentSource.js` for the interface, `sources.js` to declare it |
| Change how several sources share a room | `src/data/feeds.js` — fan-in, id namespacing, and the state the pill summarises |
| Change what a harness reports | `bin/mappers/` for a hook harness, `openclaw-plugin/lib/map.mjs` for OpenClaw — and bump the version, see below |
| Change something every harness shares | `bin/lib/aop-core.cjs` — the endpoint, the project, the redaction caps and the POST. Both the hook adapter and the OpenClaw bridge read it, which is the point |
| Change a panel | `src/ui/`, and register any new key in `ui/shortcuts.js` |
| Change what a job or a duration reads like | `src/ui/format.js`, shared by every panel that says it |

Two conventions are worth knowing before you start. **A binding cannot exist without a description**: the `?` panel is rendered from the shortcut registry itself, so a key registered without help text is a bug that shows up on screen. And **capabilities are feature-detected, never named** — the **T** binding tests for `source.sendJob` rather than asking whether the source is the mock, which is what lets it disappear from an office where nothing can invent a job.

**F** needs a selected agent, but stays registered so the shortcuts panel can explain
the mode before anyone is selected. The inspector also offers **Follow Along**, wired
through the same shortcut action; its label carries the precondition in the help panel.

## The traps

All of these have cost someone an afternoon:

- **Two surfaces on one plane.** The single most common visual bug in this project. Run the probe.
- **Nothing may destructure `COLORS` at import time.** It is a mutable singleton that `applyPalette()` rewrites in place — see [buildings and themes](../user/buildings.md).
- **Tear down before you build.** The material cache in `scene/build.js` is keyed on colour and shares materials by reference, so building the new world first leaves it holding materials that teardown then disposes.
- **Walls must be rotated into their face, and everything sits at or in front of it.** These walls are solid boxes with nothing punched through them, so a "recessed" element is an invisible one.
- **A changed mapper needs a version bump** to reach Claude or Codex, which run copied plugin snapshots of this repo. See [Claude Code](adapters/claude-code.md#changing-the-plugin-means-bumping-the-version) and [Codex](adapters/codex.md).

## Driving one agent by hand

A test agent runs a loop of its own, so the movement you want to look at arrives when the dice say so. Under **Test Action** at the bottom of the **agent detail panel** — click any **Test Data** agent, in the room or in the roster — is a row of lozenges, one per behaviour the office has, in the order of a working day: **Job by air**, **Job by courier**, **Work**, **Checklist**, **Wait**, **Look up**, **Search web**, **Post run**, **Deliver**, **Bin it**, **Drink**, **Sofa**, **Dance**, **Wander**, **Go home**, **Beam up**.

Pressing one:

1. **Closes whatever was in hand, quietly.** No walk to the bin, nothing posted, and nothing in the Job Delivery panel — a hand on the button is neither a delivery nor an error. The log entry closes where it stood, and the press opens one of its own, so "Recent jobs" becomes a record of which buttons you pressed and in what order.
2. **Runs the behaviour**, as the event a feed would have sent. That is the point of it: the room is driven down exactly the path a real harness drives it down, so what you check by hand is what a session gets.
3. **Holds the agent for ten seconds** once the errand comes to rest — long enough to look at where they ended up, take a screenshot, and read the panel describing it.
4. **Hands them back to the random loop**, unless another button was pressed in the meantime.

While the hold lasts, the pressed lozenge stays lit and the room stops deciding for that one agent: the idle roll, the mid-job coffee run, post waiting in the box and **the feed itself** are all held off. Anything the feed says about what they are *doing* is dropped rather than queued, so nothing lurches when the hold expires; who somebody *is* — a rename, a colour, a face — still lands, and an `exit` outranks any button. Nobody else in the room is affected.

**New job** is the only press that starts outside the agent, and it is the one worth knowing about. A request arriving is a *room* event: the envelope is posted first, addressed to them and sized before it sets off — because the size is what picks the channel, a letter by air through the window and a package to the door with the courier — the flag goes up and the Job Delivery panel names it. Only then does the agent get up, walk to the box, wait there if their plane is still in the air, open it, and carry the letter or package to a desk. The title *inside* the envelope becomes their job, which is why the log entry is named after the request rather than after the button.

**Work** is not a substitute for it: with an empty mailbox that button goes to the inbox stack instead, and an agent who already has material fetches nothing at all. Everything about collection lives in `_work` and `_collectMail`, with `_checkPost` as the frame-loop half that catches a prompt landing while somebody is already seated.

**Checklist** is the other button that is more than a single event: it hands over a five-part plan and works through it at the desk, a part every two seconds, so the four surfaces that phrase a step — roster row, panel checklist, first-person HUD, name tag — can be read against each other. Each part ticking over restarts the ten seconds, so the list always finishes before the room takes them back.

The buttons are drawn for **simulated agents only** — a Test Data office, or the Test Data half of a mixed one. Driving one of those by hand costs nothing, because the loop deciding for them is the one being overridden. A live session's character has no row: a press would put a movement on screen that its harness never reported, and the room being an honest picture of what the sessions are doing is the whole point of it. Two presses have no way back. **Go home** walks them out and removes them, and they do not arrive again until the feed sends a fresh spawn. **Beam up** is the other, and it is the only lozenge that stands in for no feed event at all: nothing a harness can send asks to be beamed up, because the cone of light is the *room* giving up on a departure that has not finished thirty seconds after it was asked for ([when agents leave](../user/connect-your-agents.md#and-the-blue-cone-of-light)). What the button stands in for is the thirty seconds — the one part of that feature nobody would sit through to look at — so it is also the only press allowed on somebody already walking out, which is exactly the state it is about.

The catalogue is `src/agents/pilot.js` and it is one list: the panel draws it and `AgentManager.pilot` runs it, so a new button is an entry there and nothing else. Behaviours deliberately live nowhere but the manager — a movement that existed only for the buttons would be a second office, and it would be the one getting checked.

## Driving the receiver by hand

You do not need a harness to test ingest — [Architecture § Receiving events](architecture.md#receiving-events) has a `curl` that posts a `session.start` straight at the server, and `GET /aop/v0/health` answers the question of whether anything is connected at all.

### Reading the events as text

The room is a poor way to answer "did that event arrive, and what was in it?", so every office has a second page that answers only that:

```
/office/<keycard>/debuglog
```

Same header — keycard, scene switcher, source picker — and in place of the building, the events themselves: newest at the top, each one a line with the wall clock to the millisecond, how long ago it was, **which character in the room it is about**, the harness it came from, the session, and a summary of its payload. Click a line for the whole envelope. There is a link to it under **Events** in the office's own developer panel (press **V**), and `G` goes straight there; a link back to the office sits in its header.

A hundred rows are drawn, but two thousand events are remembered — the same ring the receiver holds — so the filters below the strip can reach the whole of it:

| Filter | What it does |
| --- | --- |
| Search | Matches the **whole envelope**, not the line, so a tool call id or a file path that never made it into a summary is still findable. Several words all have to match. `/` puts the cursor in the box from anywhere on the page; `Esc` empties it. |
| Character | One colleague, followed through everything they did — including the errands of any subagent they spawned. |
| Event | One AOP type, grouped by family in the list, with a count beside each: a list that says `tool.start (0)` has already told you the adapter is not sending them. |
| Sender | One harness, for when two adapters are running and only one is misbehaving. |

They compose, and they are all *views*: filtering hides rows and never drops events, so **Clear filters** always gives them back. When they hide everything the empty state says so, and says how many events are sitting behind them — because "nothing matches" and "nothing arrived" look identical and mean opposite things.

**The names are the room's names.** The column says `Ines Name-Sleuth`, not `…a3f21b8c`, and it is the same name on that agent's desk in the office, because both come from the same place — `src/agents/cast.js`, which turns a session into a character and is read by `AopSource` and this page alike. Two implementations of "who is this?" would be two offices. Three consequences worth knowing:

- **A rename rewrites history.** Surnames follow the work, so the prompt that turns Ada Prompt into Ada Filter-Builder repaints every row she already owns. The alternative is a page holding two names for one person, which breaks the promise the column makes: the name you are watching in the room is the name you can search for here, all the way back.
- **A subagent is filed under its parent**, indented with a `↳`. The room does not draw subagents yet (spec §6.1), so naming one in its own right would promise a colleague you can never go and look at — and it also answers the question the row otherwise provokes: why did nobody move when this arrived?
- **A row about nobody says so**, with an em dash: a queued job belongs to no one yet, and a tab opening is about the office rather than anyone in it.

It loads no three.js and opens no WebGL context, which is the point rather than a nicety: the times you most need to know what is arriving are the times the scene is the suspect.

A few things about it are worth knowing before you trust what it shows you:

- **It tails the whole office, not the scene.** Events from a harness the active scene does not listen to still appear, dimmed, with the reason in their tooltip. That row is the answer to the commonest confusion there is — *my agent is running, why is the room empty?* — and filtering it away to match the scene would hide the one thing worth seeing.
- **It reads frames rather than subscribing to types.** `AopSource` listens for each AOP type by name because `EventSource` delivers named frames only to matching listeners, so a type missing from its list is a type the office never sees. The log parses the stream itself (`src/debug/aop-tail.js`), so an event type nobody has added anywhere still shows up, payload and all. If you are adding a type to the spec, this page will show it before any code knows what it is.
- **Test Data has nothing to tail.** Simulated agents are invented in the browser and never cross the network, so a Test Data scene produces no AOP traffic whatsoever. The **Test Data** toggle logs the simulation's stage directions instead — a different vocabulary, marked with a dashed edge so the two are never confused — and the empty state says so rather than looking broken.
- **The log names characters from the whole ring, and the room only from what it replayed.** Both use the same rules, so the same session is the same person in both — the one seam is that first names avoid collisions among the sessions each knows about, and the log knows about more. If two agents would both have been Ada, the log may pick a different alternate for the second than the room did. The session id is the exact identity when it matters.
- **Viewers arriving and leaving are logged too**, and the strip carries the running count — the only place in the app that shows it. These two rows are the exception to the page's rule about time: presence is a thirty second heartbeat that expires after ninety, so a `viewer.join` is up to 30s late and a `viewer.leave` up to two minutes, where every other row carries the emitter's own clock and is exact. The tooltip on each says so. The first reading is a baseline rather than an arrival, since on load it is counting the tab you are reading it in.

The stream it reads is the ordinary one, so `curl` sees exactly the same thing:

```bash
curl -N "http://localhost:8080/office/<keycard>/aop/v0/stream?after=0"   # the whole ring, then live
```

If you are an agent working in this repo, the working agreements — Jira status, worktrees, merging, and clearing up afterwards — are in [`AGENTS.md`](../../AGENTS.md).
