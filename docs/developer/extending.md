# Extending the office

Four recipes, each ending in a working thing. They share one shape, because the
codebase does: **a data file owns what exists, a registry owns how it is built,
and import-time checks weld the two together** — forget one half and the first
run tells you, loudly, instead of a click failing quietly. `src/data/sources.js`
is the original of the pattern; the props and the outlooks follow it.

Every recipe ends the same way: `npm test`, the probe, and a look at the scene
([developing.md](developing.md) has the loop). Docs update in the same PR as the
change — this repo's documentation is accurate because that is a rule, not a
hope.

## Add a prop

A prop is one file carrying its geometry and, where the common mounting pattern
is not enough, its own way of being put into the room.

1. **Build it** — `src/scene/props/<kind>.js`, exporting `build<Kind>()`. Raise
   it at its own origin, facing +z, feet on the floor, using the helpers in
   `scene/build.js` (`box`, `cyl`, `group`, `put`, `mat`, `footY`). Look at
   `bin.js` for the minimal shape and `mailbox.js` for a prop with behaviour.
   If agents interact with it, return `{ obj, handle }` and give the handle the
   methods the agent layer will drive.
2. **Register it** — one line in `src/scene/props/index.js`. Add a `mount` only
   if the common pattern (build, face the approach point, register the handle
   under the kind's name) is not enough.
3. **Declare it to the layout** — one entry in the kind table in
   `src/layout.js` (`STATION_KINDS` or `FURNITURE_KINDS`): its label, how many
   the room may hold, and the floor it blocks as half-extents in its own axes.
   That entry is what the editor's Add menu, the nav grid and the sync
   machinery read.
4. **Photograph it** — an entry in `scene/catalogue.js`, so it appears in
   the [Item Library](../item-movements.html) (`npm run portrait` rewrites the stills).

Forget 1, 2 or 3 and the registry throws at first import; forget 4 and
`test/scene-catalogue.test.js` fails. That is the whole safety story: you
cannot add half a prop.

## Add a building or an outlook

A **building** is a `BUILDINGS` entry in `src/projects.js` — storeys below,
walls, roof, which outlook is outside — and most new buildings are only that:
data, no code. The pieces it composes live in `scene/building.js`.

An **outlook** — a new world outside the windows — is the registry one level up:

1. **Build it** — a module in `src/scene/outlooks/`, exporting its definition:
   `{ id, label, aerial, ground(season), build(g, ctx) }`. The shared kit
   (trees, lamps, cars, the seeded RNG that keeps rebuilds still) is
   `outlooks/streetscape.js`; `street.js` is the worked example.
2. **Register it** — one line in `outlooks/index.js`.
3. **Name its mode** — one string in `OUTSIDE_MODES` in `projects.js`, which is
   what a theme or a `BUILDINGS` entry points at.

The registry validates both ways at import, and `npm run map` renders every
theme's whole city so you can see what you built from above.

## Add a source

A source fills an office with agents. The five that exist are declared in
`src/data/sources.js`, and the picker, the badge and the switcher all read that
list — none of them know the roster.

1. **Declare it** — a record in `SOURCES`: `id`, `label`, `blurb`, `accent`,
   a `mark` (inline SVG in `ui/marks.js`), `kind`, and a `create(ctx)` factory.
2. **Implement it** — a class with the `AgentSource` shape (`start(onEvent)`,
   `stop()`, optional capabilities like `sendJob`). For a live harness that
   speaks AOP, `AopSource` already is the implementation — a new AOP harness is
   a `SOURCES` record with `kind: 'aop'` and the harness slug, nothing more on
   the browser side.
3. **Document it** — a page in `docs/sources/`, saying what it can see and how
   to install its adapter.

The events a source emits are the office's own vocabulary — `spawn`, `status`,
`job`, `research`, `dispatch`, `exit` — documented at the top of
`agents/AgentManager.js`. Capabilities are feature-detected, never named: a
source that implements `sendJob` gets the **T** key, and nothing downstream
ever asks what kind of source it is talking to.

## Add a harness adapter

An adapter turns a harness's own events into AOP on the wire — it runs on the
agent's machine, not in the browser. [aop-harness-adapters.md](protocol/aop-harness-adapters.md)
describes the four that exist; [aop-spec.md](protocol/aop-spec.md) is the wire format.

1. **Write the mapper** — `bin/mappers/<harness>.cjs`, exporting
   `map({ event, payload, state, redaction, helpers, endpointId })` → an array
   of AOP events, plus a `CAPABILITIES` list and a `TOOL_CLASSES` table.
   `aop-send.cjs` resolves the mapper from the harness slug, so the filename is
   the registration. `rovo-cli.cjs` is the smaller worked example;
   `claude-code.cjs` shows held introductions and real subagents.
2. **Honour the contract.** The parts every mapper must get right:
   - **Redaction is the adapter's job** (spec §10) — the decision about what
     leaves the machine is made where the secret already lives. In `metadata`
     mode no free text reaches a desk label (titles become "Working", errors are
     dropped); `summary` clamps everything through `helpers.clamp`; `full`
     carries prompts only with the second opt-in. Never emit a whole command
     line — `targetOf` takes the binary name only — and paths leave through
     `helpers.tidyPath`, relative or `~`-prefixed, never absolute.

     **Pass the mode to `targetOf`.** A `target` is not one kind of thing: a
     file path is what `metadata` promises, and a search pattern, a web query
     or a URL is the model's own text. `TARGET_KEYS` in
     `mappers/lib/tool-classes.cjs` says which key is which category and
     `TARGET_KINDS` says what each may say at `metadata` — a search says
     nothing, a URL says its host. A call site that forgets the argument gets
     `metadata` behaviour, so the worst it can do is say too little.
   - **Introduce before use, and never before.** Any event may be the first the
     office hears (hooks get installed mid-session, receivers restart), so a
     mapper carries `session.start` ahead of whatever needs it — and a session
     that never does anything is never introduced at all (see `QUIET_EVENTS`
     in the Claude mapper).
   - **Declare capabilities honestly** on `session.start`: a session that
     promises `session.end` gets the long reaping leash, so only promise what
     the harness reliably delivers.
   - **Classify, don't name.** The office renders `tool_class`, never tool
     names. Exact names go in your `TOOL_CLASSES` table; everything unknown
     falls through the shared heuristics in `mappers/lib/tool-classes.cjs`.
3. **Write the installer** — `bin/aop-<harness>-install.cjs` with `--status`,
   `--dry-run` and `--uninstall`, scaffolding the shared config through
   `bin/lib/local-config.cjs`. The three that exist show the range, and their
   headers say why each is shaped the way it is.
4. **Fixture-test it** — recorded payloads → expected events, next to
   `test/mapper-claude-code.test.cjs`. The recorded shapes are the contract;
   the tests are where the next reader learns the dialect.
5. **Document it** — a page in `docs/sources/`, and a row in
   [aop-harness-adapters.md](protocol/aop-harness-adapters.md).

If the change touches `hooks/`, `bin/aop-send.cjs`, `bin/aop-node.sh`, `bin/aop-plugin-hook.sh`,
`bin/mappers/`, `.claude-plugin/` or `.codex-plugin/`, bump the plugin version — every time. The
why is in [AGENTS.md](../../AGENTS.md).
