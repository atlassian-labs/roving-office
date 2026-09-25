# Working agreements

These are for an agent session working in this repository. The human-shaped mirror is
[CONTRIBUTING.md](CONTRIBUTING.md), which is shorter and says most of the same things.

Everything here applies wherever this code is checked out. The maintainers' own tracker,
git host and deployment are **not** here, on purpose — instructions naming a system the
reader cannot reach are worse than none. If your checkout has a `.maintainers/` directory,
that is where they live and it is worth reading alongside this; if it does not, you are not
missing anything you need in order to change this code.

## Three things, always

Before a line of code is written:

1. **An issue.** No change without one. If none exists, open one.
2. **A branch.** Never commit to `main`.
3. **A worktree**, cut from `main`. Not the primary checkout.

The third used to be a preference, hedged with *prefer* and *if*, and the hedge cost an
afternoon: a session working in the primary checkout found somebody else's uncommitted
changes to the very file it was refactoring, plus an unrelated build change, in the same
tree — separable only by hand, and only because the collision happened to be noticed. A
worktree is one command and it makes that impossible:

```bash
git worktree add .worktrees/issue-4 -b worktree-issue-4    # from the primary checkout
```

The primary checkout is where `main` lives and where work in progress sits. Treat it as
somewhere to read from and merge into, not somewhere to write. `git worktree list` names
it on its first line, from any worktree.

A worktree starts with no `node_modules` — it is gitignored, so it does not come across
with the checkout. Tests and lint need it before they will run:

```bash
ln -s ../../node_modules node_modules                     # from .worktrees/<name>
echo node_modules >> "$(git rev-parse --git-dir)/info/exclude"
```

The second line is not optional housekeeping. `.gitignore` says `node_modules/` with a
trailing slash, which matches a directory and **not** a symlink of that name, so the link
shows up as untracked in every `git status` you run in that worktree — and an untracked
thing at the top of a status is exactly what gets swept into a `git add .`. `npm ci`
instead is slower but has no such edge.

### The worktree names the task

If the worktree path or its branch carries an issue reference — `.worktrees/issue-4`,
`worktree-issue-4`, `issue-11-rename-the-protocol-layer` — then **that issue is the task by
default**, with no need to ask which one. Read it before starting:

```bash
git rev-parse --show-toplevel      # or: git branch --show-current
```

If the reference in the path and the one on the branch disagree, or a request names a
different issue, ask rather than guessing. A worktree with no reference in its name says
nothing about the task — take it from the request.

The convention only pays off if it is kept up, so it runs the other way too: **a new
worktree for a known issue is named after it**, and so is its branch. Add a short slug when
it helps a human skim `git worktree list`.

## Documentation

Docs live in the /docs folder, in **two strictly separated sets**, and putting something in
the wrong one is a real error rather than untidiness:

- **`docs/user/`** may assume only a download, an install and a browser. No source paths,
  no `npm test`, no issue numbers as rationale, no infrastructure hostnames — name only
  `therovingoffice.com`. `test/docs.test.js` fails the build if any of those leak in.
- **`docs/developer/`** assumes a checkout and an intent to change something.

Cross-set links are fine and should say so in the link text ("→ developer docs").

**Nothing that ships may cite something the reader cannot open.** A link to a private
wiki, an internal hostname or tool, a company shortlink, or a bare tracker key used as a
citation — all of it is a reference that answers the question for one reader and withholds
it from everyone else. That covers code comments as much as prose, and it is a test rather
than a habit: `test/public-surface.test.js` sweeps both documentation sets, the built site,
the root Markdown files and the code this repository ships, and names the file and the
marker when it finds one. The reason it has to be a test is that the unavailable link is
always right there in the tab you are working from. **Say what the thing was** rather than
citing where it is written down: "took a while to notice the asymmetry" carries the meaning
that "took XYZ-168 to notice" carried, to every reader rather than to one.

**Some pages under those directories are deliberately never published**, and the list is
the block at the bottom of `.eleventyignore`. `docs/site` is committed and both deploy
recipes copy it whole, so **building a page is publishing it** to a public URL; there is no
later gate. Do not link a published page at one of those, do not add one to
`docs/_nav.mjs`, and if you add a new unpublished page put it on that list in the same
commit. `test/docs.test.js` reads the list and fails if built HTML exists for anything on
it.

Some of the project's design records — proposals, evaluations not taken, shipped plans —
and its deployment runbooks are not in this repository, because several of them describe
behaviour the code no longer has and all of them cite infrastructure a contributor has no
access to. Nothing you need in order to change this code is in them; if a decision's
reasoning is worth having, it belongs in a comment next to the code or in
`docs/developer/`.

**A new page needs an entry in `docs/_nav.mjs`**, which is the sidebar and the only list of
what the documentation contains; the Markdown files carry no front matter. A page that is
not in the nav is a failing test, not an orphan.

**After editing any Markdown under those two directories, run `npm run docs`.** It
regenerates the generated pages and rebuilds `docs/site`, which is committed because
neither deploy target can build. `npm test` fails if you forget.

**`npm run docs` also fails on a broken internal link or a dead anchor**, so a renamed
heading or a moved page is caught at the moment you cause it rather than in review. If you
move or rename a page, expect to fix the links pointing at it in the same pass — the build
will list them. `npm test` asserts the same thing, so it cannot be committed around.

If you're adding new functionality, ensure it's documented in the correct place. If you're
concerned a new document is needed, ask. Always make sure the documentation is accurate and
up to date as you proceed with a new task or feature.

## The Claude and Codex plugins: bump the version, every time

Claude and Codex do not run this checkout. On install each **copies** the plugin,
so the code a session actually executes is a snapshot taken at some past moment.

The caches are keyed on version, and their update commands compare versions to
decide whether to fetch — so **an update offered the version it already holds does
nothing at all**, silently, however far the files have drifted. A plugin-affecting
change that does not bump the version is a change no session will ever run.

So: **any change under `hooks/`, `bin/aop-send.cjs`, `bin/aop-node.sh`,
`bin/aop-plugin-hook.sh`, `bin/mappers/`, `openclaw-plugin/`, `.claude-plugin/` or
`.codex-plugin/` bumps the version in both plugin manifests** — and `package.json` with
them, since the plugin is a copy of the whole repo and three versions would be three
answers to one question.

`openclaw-plugin/` is on that list for the same reason and one of its own. A packed
install is a snapshot too — `bin/aop-openclaw-pack.cjs` takes the artifact version from
`package.json`, and its own header says what happens without a bump: *"ship a change
without bumping and a server may keep running the old copy."* Worse, it destroys the only
cheap check an operator has, because `openclaw plugins inspect` reports
`install.resolvedVersion`: two different builds both answering `0.12.4` means nobody can
tell whether an install took. Two builds shipped that way before this line existed.

**A bump also has generated output to regenerate.** `plugins/claude/` holds the published
marketplace and the archive it pins by SHA-256, and it is committed for the same reason
`docs/site` is — neither deploy target may build. So a version bump means
`npm run pack:plugins`, and the new archive and manifest go in the same commit. `npm test`
fails if you forget, and says so. See
[docs/developer/plugin-distribution.md](docs/developer/plugin-distribution.md).

Then ship it:

```bash
npm run pack:plugins                         # rebuild the published artifacts, and prove
                                             #   they run outside this checkout
node bin/aop-claude-install.cjs --status     # says whether the snapshot has drifted
claude plugin marketplace update roving-office
claude plugin update roving-office@roving-office
npm run connect:codex
```

If the version was *not* bumped, that update is a no-op and the only way out is to force a fresh copy of the same version — which is also the escape hatch when a snapshot is somehow stale at a version that matches:

```bash
claude plugin uninstall roving-office@roving-office
claude plugin install roving-office@roving-office
```

Either way the hooks are read at session start, so **restart the Claude or Codex
session** afterwards. Each `--status` command compares the installed version with
the checkout and says what is live, so run it rather than guessing.

## Checking the work

- `npm run probe -- --sweep --assert=test/coplanar-baseline.json` before and after touching geometry — CI runs the same assertion, so a new pair fails the build rather than relying on eyes. After a *deliberate* geometry change, re-record with `--record=test/coplanar-baseline.json`.

  The sweep is **deterministic**: the scene dresses itself at random, so the probe seeds it and measures one fixed dressing. Before that it failed and passed the same commit at random, and `main` sat red over a docs change. So a red probe is a real red probe: **do not re-run it hoping**, and do not widen the baseline to make it green. Hunting for a pair that only some dressings produce is what `--seed=<n>` is for, and a baseline only means anything against the seed it was recorded under — the file carries it, and `--assert` refuses a mismatch.

  But know what it does **not** cover. The probe builds `buildEnvironment` only — the shell, the glass, the roof, the storeys — and **not `buildProps`**, so no desk, plant, standee or anything else that stands in the room is in it. A held baseline after changing a prop says nothing about that prop; the portrait and a scene screenshot are what check it. Read `sceneFor()` in `bin/coplanar-probe.js` before claiming the probe validated something.
- **Editing a deployment recipe means regenerating the third-party inventory.** `third-party/inventory.json` pins the SHA-256 of `Dockerfile.fly`, `.dockerignore`, `.github/workflows/ci.yml` and the rest of the recipes, so a one-line change to any of them turns `npm test` red with "inventory.json is stale" and nothing about the message says which file you touched. The same goes for anything the inventory is *built from*: `third-party/components.json` is the curated input, and it pins every path it lists, so editing a provenance description there — or any file such a row names, `src/scene/standees.js` included — goes stale the same way. Run `node bin/gen-third-party.mjs`, then read the diff: only the hashes of files you actually edited should move, and anything else moving means the dependency tree shifted under you.
- **Do not regenerate a portrait whose prop you did not change.** `npm run portrait` is not byte-deterministic: re-rendering an untouched prop rewrites the PNG with a different shadow, so a bare `npm run portrait` quietly dirties two dozen images and buries the one that matters. Pass `--id=<id>`, and diff the pixels rather than the bytes if you need to know whether a change is real.
- The scene is the product, so **look at it** for anything visual. A headless Chrome screenshot works and catches what a unit test cannot:

  ```bash
  node server.cjs 8081 &     # 8080 is usually taken by the primary worktree
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
    --disable-gpu --enable-unsafe-swiftshader --user-data-dir=/tmp/tmp_rovo_chrome \
    --window-size=1600,1000 --screenshot=/tmp/shot.png http://localhost:8081/
  ```

  That Chrome path is the macOS one; adjust it for your platform. Give each shot its own
  `--user-data-dir`, and use **no `--virtual-time-budget`**: virtual time
  never expires against a render loop, so the flag hangs and writes nothing. Chrome
  fires the shutter at load instead, which is the thing to design around — it is
  *earlier than you think*:

  - **A dynamically imported module never makes it.** Reception's vignette is a
    deliberately late `import()`, and the shot always caught the placeholder. That is
    not a bug to chase; it is the shutter being early.
  - **Nor does anything that fades or walks in.** A 0.5s crossfade lands half-drawn,
    and an agent who arrives after two seconds is not in the picture.

  So for anything that is not on screen at load, screenshot a **throwaway harness
  page** that imports the module statically, mounts it, and disables transitions —
  the same trick as mounting the real panels against a stub manager for UI detail.
  `--force-prefers-reduced-motion` is the other half of it, since a scene that honours
  it is a scene that renders its settled state in one frame. Worth knowing why that is
  the only way: under `--virtual-time-budget` **`requestAnimationFrame` never fires at
  all**, so no loop-driven animation ever advances however long the budget. Timers do
  run, and run fast, so a harness that steps a thing with `setTimeout` and prints what
  changed will tell you an animation works when no screenshot can. And on macOS `sips -c
  H W --cropOffset Y X` magnifies a region for a closer look.
  If you drive Chrome through a devtools client rather than the CLI above, **do not
  address elements by a snapshot ref.** The office repaints its chrome on every
  heartbeat and the scene rebuilds nodes continuously, so a ref taken one call ago is
  already stale and the client refuses it — three times running, for a button that is
  plainly on screen. Click and read through `eval` with a query of your own instead,
  which also lets you open a panel, stub out whatever the shutter would otherwise
  catch, and measure the result in the one call.
- Only one instance can hold `~/.roving-office/endpoint.json`, so a second server
  serves the UI but receives no adapter events. Use a **Test Data** office there.

## Packing up

A task is not finished at the merge. When the work has landed and **the request says we are done**, clear the desk without being asked again:

1. **Sweep first, while you still can.** Temp files, stray headless Chromes, `git status`, the health check on whatever is still serving — all of it happens *before* the removal, because the removal takes the shell's own working directory with it and nothing can be run afterwards. An agent that leaves the sweep till last finds it cannot even `pwd`, and has to recreate the path it just deleted to get a shell back.
2. **Stop or move any server** started for the task. Ask what it is serving before killing it, with `lsof -p <pid> | awk '$4=="cwd"{print $NF}'`: a server whose `cwd` is the worktree dies with it, so if it is one you are keeping — the office holding the endpoint — restart it from the primary worktree first and check it re-claimed `~/.roving-office/endpoint.json`.
3. **Remove the worktree**, then **delete the branch** — but only once it is merged.

```bash
lsof -p "$(pgrep -f 'server.cjs 8080')" | awk '$4=="cwd"{print $NF}'   # what would it lose?
pkill -f "server.cjs 8082"
git worktree remove .worktrees/issue-10
git branch -d worktree-issue-10        # -d, never -D: it refuses an unmerged branch for us
```

Run both `git` commands from the primary worktree, with `git -C` and an absolute path if
you are not standing in it.

Leave the temporary files behind at your peril — `tmp_rovo_*` screenshots, throwaway harness pages and probe scratch files all go before the final commit, not after.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
