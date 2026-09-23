# Getting the code

*Run a checkout, install public development tooling, and check your changes.*

## What you need

**Node.js 24 and npm, and a browser.** Nothing else — no database, no hosted service, no
account.

Node 24 is what CI runs, what both deployment images use, and the only version these
checks are proved against. The development tooling would accept older Node than that —
ESLint 10 sets its floor at `^20.19 || ^22.13 || >=24` — so an older runtime will very
likely work and simply is not tested; if a check fails on one, try 24 before reporting it.
Anything newer than 24 is fine.

## Get it and run it

Start from a checkout or an extracted source archive. The repository clone command is:

```bash
git clone https://github.com/atlassian-labs/roving-office.git
cd roving-office
node server.cjs 8081     # no build step; 8080 is usually taken
```

Edit a file, reload the tab. Three.js is vendored under `vendor/three`, modules load
straight off disk, and there is nothing to compile.

Open `http://localhost:8081/office/TEST-0000/` for a **Test Data** office. It simulates
agents locally and needs no agent account and no installed adapter. Once you have the
source, everything on this page runs with no credential and no access to any hosted
service.

**One server per worktree is the normal state of things.** A server started with a bare
`node server.cjs` is **private**: it does not write `~/.roving-office/endpoint.json`, so it
cannot redirect the hooks feeding an office somebody is watching, and it prints the
`AOP_URL` / `AOP_TOKEN` pair that points a single shell at it. Name a port and you get that
port or an error, never a quiet substitution.

`npm run serve` is the other one — it *publishes*, and it is how the office you actually
work in gets fed.

## Check it

```bash
npm ci          # development tooling from the public npm registry
npm test
npm run lint
npm run probe -- --sweep --assert=test/coplanar-baseline.json
npm run pack:openclaw
npm run pack:plugins
```

These six are the whole of local verification, and they are exactly the commands
`.github/workflows/ci.yml` runs, by the same names. They need no credentials and no
running external service, so a green run here is a green run there.

**CI is these six and nothing else** — no deployment step, no secret, no credential. See
[What CI runs](developing.md#what-ci-runs) for why that is a boundary rather than a
simplification, and for the one guard that lives in the repository settings instead of in
the workflow file.

Three of them are worth understanding rather than just running:

**The probe** builds every building and season headlessly and asserts that no two surfaces
contest a plane worse than the recorded baseline. Almost every graphical glitch in this
scene has turned out to be that same bug. It is **deterministic** — the scene dresses itself
at random, so the probe seeds it — which means a red probe is a *real* red probe. Do not
re-run it hoping, and do not widen the baseline to make it green. See
[the coplanar-face probe](coplanar-probe.md).

**`pack:openclaw`** packs the plugin and runs the artifact from a temp directory, so a
change that breaks the vendored seam cannot land silently. It is the one people forget.

**`pack:plugins`** does the same for the Claude Code and Codex plugins, which are the two
that strangers install: it builds each as a distribution artifact, unpacks it somewhere
with no checkout above it, and fires a real hook at a loopback receiver. `npm test` also
asserts that the committed marketplace under `plugins/claude/` still matches this
checkout, because the site serves those files and no deploy target may build them. See
[publishing the plugins](plugin-distribution.md).

`npm test` also covers the documentation: it checks that
[the npm script reference](npm-scripts.md) still matches `package.json`, that every
Markdown page has been built into `docs/site`, and that **every internal link and anchor
resolves**. If you edited a doc, run `npm run docs`.

That link check also runs at the end of `npm run docs`, which is where you want to meet
it — a moved page or a renamed heading fails the build seconds after you did it, naming
the file. It lives in `bin/lib/check-doc-links.mjs`, one function behind both call sites,
and its header says why both are needed.

## Installing development tooling

The project `.npmrc` defaults to `https://registry.npmjs.org/`, and `package-lock.json`
pins public tarball URLs and integrity hashes. `npm ci` installs the locked versions
without regenerating the lockfile. No npm account or company registry is needed.

If your machine has custom npm configuration, a user-level scoped registry or an
environment override can still take precedence for that scope. For a clean check,
point npm's `--userconfig` and `--globalconfig` at **separate empty files**, set
`--registry=https://registry.npmjs.org/`, use an empty directory for `--cache`, and
remove inherited npm/auth/proxy environment overrides in that process. Do not change
your normal npm configuration or copy credentials into this repository.

When updating dependencies, keep the public URLs, review changed versions and
integrity hashes, and repeat the checks above. A lockfile generated against a private
mirror makes other contributors depend on that mirror.

## Maintaining third-party evidence

[The dependency inventory](../../third-party/inventory.json) records locked npm
packages, vendored code, assets and the evidence available for their licenses. Its
[component records](../../third-party/components.json) describe provenance and which
artifacts contain each component. Missing evidence remains an open review item;
the inventory does not grant permission to redistribute a component.

After changing dependencies, vendored files, asset provenance or distribution
recipes, install the locked dependencies and regenerate the evidence:

```bash
npm ci
node bin/gen-third-party.mjs
```

Review the inventory and [runtime notices](../../THIRD_PARTY_NOTICES.txt) in the
diff. When updating colour names, run `npm run colours` first so the pinned data
and its upstream license are updated together. `npm test` checks the inventory
offline to catch stale evidence and notices; run `node bin/gen-third-party.mjs --check`
for that check alone. Changes to this documentation still require `npm run docs`.

**Visual assets have a second record, and it is the one to read first.**
[Visual assets and their rights](visual-assets.md) gives every asset that ships —
first-party artwork, fonts and other parties' brand marks alike — its source and its
release basis in prose,
and its last section is the checklist for adding or changing one. It exists because the
inventory answers *what is this file* and the question that actually blocks a release is
*may we publish it*. Some of the brand marks are other companies' trademarks that this
project may use but cannot sublicense, so they are named in [`NOTICE`](../../NOTICE) as
excluded from the code licence grant: a permissive licence disclaims trademarks but not
copyright in artwork, which is why the exclusion is written down rather than inferred.
Take vendor artwork from the vendor, unaltered, and record where you got it — a source
comment is not provenance.

## What has no dependencies, and what does

The **server needs no npm runtime install**: it uses Node's built-in modules. The
browser app includes vendored Three.js and derived `color-name-list` data. These are
third-party dependencies even though they are committed to the repository and need no
runtime download. `npm ci` installs development tooling only: ESLint, Eleventy and
their supporting packages.

That distinction is why `Dockerfile.fly` runs no `npm install` at all, and why
`docs/site/` is committed rather than built at deploy time: a deploy copies files, so
anything it serves has to already be a file.

## For anything visual, look at the scene

The scene is the product, so a unit test cannot tell you it looks right. A headless
screenshot takes seconds and catches what no assertion can —
[developing on it](developing.md#look-at-the-scene) has the recipe and, more importantly,
its traps. `npm run map` and `npm run portrait` re-render the documentation imagery.

## Before you open a pull request

Work is tracked one issue at a time — one issue per piece of work, moved to In Progress
when you start and Done when it lands. Branch from `main`, open a pull request, let the
pipeline go green.

**If your change touches the shared plugin files** — `hooks/`, `bin/aop-send.cjs`,
`bin/aop-node.sh`, `bin/aop-plugin-hook.sh`, `bin/mappers/`, `.claude-plugin/`,
`.codex-plugin/` — **bump the plugin version.** Claude and Codex both run a copied snapshot
keyed on that version, so an update offered a version it already holds does nothing at all,
however far the files have drifted. [AGENTS.md](../../AGENTS.md) explains the trap;
[the Claude adapter](adapters/claude-code.md#changing-the-plugin-means-bumping-the-version)
explains the mechanism.

## Read next

- [Developing on it](developing.md) — the loop, the tools, and the traps
- [Architecture](architecture.md) — the map, and its file tree is kept true
- [Extending the office](extending.md) — the four recipes
- [Every npm script](npm-scripts.md) — the rest of the commands
