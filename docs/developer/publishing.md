# Publishing the office

*Getting the office onto a URL someone else can open.*

The office normally runs on your laptop, because that is where the agents are. A reader
who just wants to *use* a hosted one wants
[sharing an office](../user/sharing-an-office.md) instead; this is the deploy runbook.

The docs you are reading are part of the artifact, so both targets below ship
`docs/site` — see [the docs build](#the-docs-are-part-of-both-artifacts).

**Local development does not need a deployment account.** Running the app, Test Data,
the checks and the docs build uses Node and public npm tooling; start with
[getting the code](getting-the-code.md). Deploying needs a Fly account and an app you
control; the commands below describe the maintainers' app, and nothing in them is an
install or build prerequisite for contributing.

There are a few places it can live, and they are not variations on a theme — they ask
for genuinely different amounts of work. One of them, an internal Atlassian platform,
was evaluated and has since been retired; what is left is what anybody can run.

| Where | What it costs | What you get |
| --- | --- | --- |
| **Local** (`npm run serve`) | nothing | the real thing: live agents, durable offices |
| **Kaizen** (`npm run redeploy`) | Atlassian access, Kaizen CLI and project permissions | an internal hosted office; offices vanish with the sandbox |
| **Fly.io** (`flyctl deploy`) | a `Dockerfile.fly`, a volume, and two env vars read | a public URL outside Atlassian's network, offices that survive a deploy |
| **Cloudflare** | a rewrite of `server.cjs` | durable state and hosted ingest, eventually |

## The retired Kaizen deployment

Gone, and nothing ran on it. `bin/kaizen-publish.sh`, `bin/kaizen-build.sh`,
`bin/kaizen-entry.mjs`, `kaizen.toml` and the design record that described the project
setup are all deleted, along with the pipeline's install and promote steps and the
`redeploy*` npm scripts.

It is recorded here rather than silently absent because the cost it was carrying is the
reason it went, and that is worth not re-incurring: an internal hostname and a platform
project id put it over the Labs bar, so it had to be excluded from the public export —
which forced the `redeploy*` scripts off too, which made the release branch unmergeable
to `main`, which is why four tests had grown an "if the recipe exists" branch. One
deployment target that deployed nothing was holding two trees apart.

If a second target is ever wanted, the thing to preserve is that it can be run by
someone outside the maintainers, or it will pull the same chain again.

## Fly.io

[Fly.io](https://fly.io) runs an ordinary container on an ordinary VM, which is the
other end of the spectrum from Kaizen's sandbox-per-request model — and the reason it
is worth having as a third option: it does not depend on Atlassian's internal network,
so it is the one place a link works for someone outside the company.

```bash
flyctl deploy --app the-roving-office
```

That deploys to **https://the-roving-office.fly.dev**.

### It is automatic, and this is the runbook for when it is not

A change landing on `main` deploys itself. `.github/workflows/deploy.yml` runs the
command above on every push to `main`, so merging a pull request *is* the deploy, and
the rest of this page is background plus the manual route.

Three things follow from how it is wired, and they are the parts worth knowing:

- **It is a separate workflow from CI, and must stay one.** `ci.yml` runs on
  `pull_request`, which means it runs code from forks; a deploy token in reach of that
  job is a token handed to whoever wrote the diff. `deploy.yml` triggers only on `push`
  to `main` — something no pull request can cause — holds the token as an environment
  secret, and is the only workflow here with a credential at all.
- **Deployments are tracked for you.** The job names a `production` environment, so
  GitHub records a deployment per run: the repository's Environments page lists which
  commit went out, who caused it, when, and the URL. Nothing bespoke, nothing to keep
  up to date. That environment also restricts deployable branches to `main`, and is
  where a required reviewer would go if an approval gate were ever wanted.
- **Deploys queue rather than overlap.** One machine holds one volume, so a second push
  waits for the first deploy to finish instead of cancelling it — the opposite of CI's
  choice, because a superseded test run is worthless while a half-finished deploy has a
  machine in a lease.

Two reasons to still run it by hand, and `workflow_dispatch` on the workflow covers the
first without a checkout:

- a redeploy with no commit behind it — a machine that needs replacing, or a rolled-back
  Fly release
- deploying a tree that is not `main`, which is a thing you can do from a checkout and
  the workflow deliberately cannot

For the second, use the script rather than the bare command, so a hand-run deploy stamps
itself the way the workflow's does:

```bash
npm run deploy:dry        # what it would send, and the stamps it would apply
npm run deploy            # this working tree, stamped
```

### Asking the live office what it is running

```bash
curl -s https://therovingoffice.com/api/health
```

```json
{
  "offices": 232,
  "idleTtlMs": 2592000000,
  "maxOffices": 500,
  "build": {
    "version": "0.15.7",
    "commit": "4c25b6e55c05b6273ad740d6e799a274696e4336",
    "dirty": false,
    "source": "github-actions",
    "run": "https://github.com/atlassian-labs/roving-office/actions/runs/…",
    "builtAt": "2026-10-02T21:42:41Z"
  }
}
```

`.git` is not in the build context and should not be, so an image cannot work its own
commit out — it has to be told. `flyctl deploy --build-arg` is that channel,
`Dockerfile.fly` turns the arguments into environment variables, and `server.cjs` reads
them once at startup, because none of it can change while the process lives. The `ARG`
block sits at the **bottom** of the recipe on purpose: an `ARG` that changes invalidates
every layer below it, and these change on every single deploy.

Three of the fields carry a decision rather than a value:

- **`source`** is `github-actions`, `local`, or `unknown`. The third is honest rather
  than apologetic — a laptop running `npm start` has no stamps, and neither does an image
  built by something that did not pass them. A plausible-looking default would be a lie
  in the one field whose entire job is provenance.
- **`dirty`** has three states, and `null` is *nobody said* rather than *clean*. A
  hand-run deploy from an uncommitted tree ships something no commit names, so the hash
  on its own would point at a tree that was never what shipped. The workflow passes no
  dirty flag at all: a runner's checkout is the commit it was given, and reporting a tree
  state nobody inspected would be a check that never ran.
- **`run`** links back to the workflow log that built the image, which is the difference
  between knowing a deploy was automatic and being able to read it.

Before this existed, "is the fix live?" meant cross-referencing the Environments page
against `flyctl releases` and still guessing, because Fly keeps a `User` and nothing
else useful — `Description` reads `"Release"` on every release and `Metadata` is `null`.

The credential is an app-scoped, expiring Fly deploy token
(`flyctl tokens create deploy -a the-roving-office -x 8760h`), held as the `production`
environment secret `FLY_API_TOKEN` rather than a repository secret, so only a job naming
that environment can read it. `flyctl tokens list` says what exists and when it lapses;
rotating it is that pair of commands and nothing else.

### Why the recipe is called `Dockerfile.fly`

Fly is the only deploy target here that builds an image at all, and for a while its
recipe sat at the repo root under the obvious name. That turned out to be a filename
with consequences: a root `Dockerfile` trips Atlassian's trust scanner, and it failed
the checks on pull requests that touched nothing to do with deployment. One deploy
target was taxing every change in the repo.

So the recipe is [`Dockerfile.fly`](../../Dockerfile.fly), and `fly.toml` says where it is:

```toml
[build]
  dockerfile = "Dockerfile.fly"
```

That is worth preferring over the two alternatives it displaces. `flyctl deploy
--dockerfile Dockerfile.fly` works, but it moves a required argument to the call site,
where it can be forgotten — and the docs above would be lying the moment someone
deployed without it. A wrapper script that copied the file into place, deployed, and
deleted it again would put a real `Dockerfile` in the checkout for the length of every
build, which is the thing being avoided; it would also need `Dockerfile` gitignored
against the run that dies before its cleanup. Declaring the path is the version with
nothing to remember and no window in which the file exists.

The path resolves relative to **`fly.toml` itself**, not to the working directory — so
the declaration holds even for a `flyctl deploy --config some/other/fly.toml` run from
elsewhere, as long as the recipe sits beside the config that names it. Both are at the
repo root, so they do.

Docker still reads `.dockerignore` under that name — BuildKit prefers
`<dockerfile>.dockerignore` and falls back to the plain one — so the ignore list needs
no matching suffix.

### Why `server.cjs` needs one line, not a rewrite

Fly runs `node server.cjs` directly inside the container
[`Dockerfile.fly`](../../Dockerfile.fly) builds — no bridge, no shim, no captured
`listen()` the way Kaizen needs. The only friction is where the port comes from: Fly's
convention is `$PORT` in the environment, and `server.cjs` originally only read a CLI
argument. It now checks both:

Both hosted routes run the server in its default, **private** mode — no `--publish`, so nothing
writes an endpoint file, which is right for a container where no adapter reads one. Both also
set `PORT` explicitly (`Dockerfile.fly`, `fly.toml`, and Kaizen through `bin/kaizen-entry.mjs`),
so the 8080–8095 search never runs there: a named port is bound or the boot fails, and a
container quietly moving to 8081 behind a fixed `internal_port` would be a health check that
never passes. The private banner prints the receiver's write token only to a terminal, so a
deploy log gets a placeholder instead of a credential.

```js
const PORT = Number(process.env.PORT) || Number(args.find((a) => /^\d+$/.test(a))) || 8080;
```

**And `HOST`, which is the other half of the same seam.** `server.cjs` binds `127.0.0.1`
unless told otherwise — it serves anything under the checkout, so on a laptop the narrow
bind is the only defensible default. In a container that default reaches nothing: Fly's
proxy arrives on the machine's private interface, not on loopback, so a process listening
only on 127.0.0.1 refuses every forwarded request and the deploy dies on its health check
with nothing in the log that says why. `Dockerfile.fly` therefore sets `HOST=0.0.0.0`,
and it is set *there* rather than in `fly.toml` because it is true of any container and
not of Fly in particular. Kaizen needs nothing: `bin/kaizen-entry.mjs` replaces `listen`
so no socket is ever bound, and the value is inert on that route. A `HOST` this machine
has no address for fails at boot naming the variable, which is the one new way this can
go wrong.

`Dockerfile.fly` copies exactly the file set
[`bin/kaizen-build.sh`](../../bin/kaizen-build.sh) assembles for the Kaizen artifact
(`*.html`, `styles.css`, `lib/`, `src/`, `vendor/`, `server.cjs`), written once as a
comment there and read here rather than re-derived, so the two build lists cannot
quietly drift apart. There is no `npm install` step: the server uses Node built-ins,
and the browser's third-party code and data are vendored in the files being copied.

### One machine, on purpose

Fly's default deploy launches **two** machines per app, for high availability. For most
apps that is exactly right; for this one it recreates the coherence bug `kaizen.toml`'s
own comment warns about — `lib/office-store.cjs` keeps every office in an in-memory
`Map`, so two machines are two independent stores, and which one answers a given
request depends on Fly's load balancer rather than on anything the app controls. The
fix is the same shape as Kaizen's `maxSandboxes = 1`:

```bash
flyctl scale count 1
```

That count is stored against the app rather than in `fly.toml`, so it survives future
`flyctl deploy` runs without needing to be repeated.

`fly.toml` also sets `min_machines_running = 0` with `auto_stop_machines = "stop"`: the
one machine stops when nothing is asking for it and restarts on the next request. That
is only affordable because the machine has somewhere to put its offices down first —
see below, and note that the sleeping is exactly what makes the idle deadline matter.

### Offices survive a deploy (TRO-142)

`lib/office-store.cjs` writes the whole registry — every keycard, its scenes, their
`look` and furniture `layout`, and the hashed ingest token — to `offices.json`, on a
debounce while running and again on the way out. On a laptop that file sits in
`~/.roving-office` and there is nothing more to arrange.

A container is the case that needs arranging, and it needs three things rather than
one. Any two of them without the third and offices still disappear.

**A disk that outlives the image.** Everything in the container is rebuilt on every
deploy; that is the point of a container, and the reason `$HOME` is the wrong place for
state there.

```bash
flyctl volumes create roving_office_data --region syd --size 1 -a the-roving-office
```

```toml
[mounts]
  source = "roving_office_data"
  destination = "/data"
```

1 GB is Fly's minimum and is enormous for this: the registry is kilobytes and an avatar
is capped at 2 MB by `lib/avatar-store.cjs`. A volume binds to **one machine**, which is
a second reason for the `flyctl scale count 1` above — and a reason not to reach for a
bluegreen deploy, which wants a second machine that would have no volume to attach to.

**Something pointing at it.** `ROVING_OFFICE_STATE_DIR` moves the registry and the
avatars together — the avatars are addressed by content hash and referenced from
events, so a room whose faces went missing is as broken as one whose scenes did.

```toml
ROVING_OFFICE_STATE_DIR = "/data/roving-office"
```

`endpoint.json` deliberately stays at `~/.roving-office/endpoint.json` whatever this is
set to. It is not the server's state but a rendezvous point, and every adapter and
installer builds that path from `os.homedir()` itself — so a server that moved its copy
would leave every hook on the machine posting into a file nobody reads, with nothing
anywhere to say so. A container has no local adapters, and loses nothing by it.

**A deadline that outlasts the gaps between visitors.** This is the one that is easy to
miss, because nothing about it looks like storage. An office is reaped after
`IDLE_TTL_MS` with nobody watching and nothing arriving, and that applies twice — the
sweeper drops it while the server runs, and `load()` refuses to restore one that was
already past its deadline while the process was away. Half an hour is the right number
for a laptop, where an office is a scratch thing you opened this afternoon. Here the
machine *sleeps whenever nobody is looking*, so a night's gap would empty the volume on
the next visit, and the disk would have bought nothing.

```toml
ROVING_OFFICE_IDLE_TTL_MS = "2592000000"   # thirty days
```

Long, but still finite. An office nobody has opened in a month is litter, and the
reaper is the only thing that ever tidies up.

What survives is more than the room: the ingest token's hash is in the record, so an
adapter that was posting before a deploy is still accepted after it, with no re-mint
and no emitter reconfigured. What does not survive is the AOP ring buffer in
`lib/aop-bus.cjs` — event history is in memory by design, and a deploy clears it. The
adapters reconnect and the room fills up again.

Worth checking after a change to any of this, because every failure mode here is silent:

```bash
flyctl ssh console -C "cat /data/roving-office/offices.json"
```

**A bound on how much of that volume a stranger may fill.** Creating an office needs no
credential — reception's front door and a link shared before the room exists both depend
on it — so the endpoint cannot be gated, only bounded, and on a public host it has to be.
Three numbers do it, and they cover different things:

```toml
ROVING_OFFICE_MAX_OFFICES = "500"        # the default; the bound on the disk
ROVING_OFFICE_MINT_PER_CLIENT = "20"    # per client, per window
ROVING_OFFICE_MINT_PER_SERVER = "60"    # everyone together, per window
ROVING_OFFICE_MINT_WINDOW_MS = "600000" # ten minutes
ROVING_OFFICE_TRUST_PROXY = "1"         # only where a proxy is really in front
```

- **`MAX_OFFICES`** is the only one that survives a restart, and the only one that is a
  bound on storage rather than on a rate. Past it every creation door answers `503` with
  the idle deadline in `Retry-After` — a rate is not the problem, so `429` would be a lie.
  It sweeps before it refuses, so offices past their deadline are counted as capacity
  rather than as tenants. The reserved demo office is exempt: `/` redirects there, and a
  full store that cannot serve the front page is a worse failure than a full store.
- **The two rate limits** are a sliding window in `lib/rate-limit.cjs`, in memory on
  purpose — a process that has just restarted has also just dropped every ring buffer it
  was holding, so forgiving the counters with it is the honest arithmetic. Per-client
  stops one caller in a loop; per-server is what stops a caller who rotates addresses to
  defeat the first, and is therefore the number that decides how fast the store can be
  filled at worst. Both answer `429` with `Retry-After` and a sentence naming which limit
  was hit; `src/office/new-office.js` prints that sentence on reception's hint line, so
  the numbers are stated once, where they are set.
- **`TRUST_PROXY` is not optional here and is dangerous elsewhere.** Every request to a
  Fly app arrives from Fly's proxy over the internal network, so without it the
  per-client limit collapses into the per-server one and the first twenty visitors of a
  window spend the whole host's allowance. With it, `Fly-Client-IP` is read in preference
  to `X-Forwarded-For`, because Fly *overwrites* the former and only appends to the
  latter. It is off by default because a header a caller can write is a rate limit a
  caller can set — turn it on only where a proxy you control is genuinely in front.

All three limits count *creations*, not requests, so a mint and the browser's immediate
`GET` on the room it just made are one event and not two. `GET /api/health` reports
`offices` and `maxOffices` together, which is the pair an operator actually needs.

### What it still doesn't have

It is unauthenticated and reachable by anyone who has the URL — the same exposure
Kaizen has, minus even the option of `kaizen oauth` restrictions, so treat a Fly URL as
public and set emitter-side redaction accordingly. Fly buys reachability from outside
Atlassian's network and, now, durability; it does not buy access control, which is
still the [Cloudflare](design/cloudflare-deployment.md) spec's job.

Durability here is also a volume on one machine, which is a different claim from
Cloudflare's. It survives deploys and restarts. Losing the host is a worse day: Fly
takes scheduled snapshots and keeps five, so the office comes back from a snapshot
rather than from nothing, but restoring one is a manual `flyctl volumes fork` and
whatever happened since the last snapshot is gone. And none of it scales past the one
process that holds the disk.

## The docs are part of both artifacts

The documentation is served by the app at `/docs`, so it ships in both targets — and it
ships as **built HTML committed to the repository** rather than as something either build
generates.

That is a deliberate exception to the rule `.gitignore` states, and it exists because
neither target can run a build:

- **Fly** builds an image from `Dockerfile.fly`, which runs **no `npm install` at all**.
  Runtime dependencies are already vendored, and Eleventy is a devDependency, so it
  is not there to run.
- **Kaizen** runs `bin/kaizen-build.sh`, which is a file copy by design.

So `npm run docs` is a thing you run in a checkout, and its output travels. The precedent
is `src/agents/colour-names.js`, which is committed generated code for the same reason: the
office never fetches anything at runtime. What makes the exception safe is the drift check
— `npm test` fails when `docs/site` does not match the Markdown, so a committed copy cannot
quietly stop matching its source.

Three files know about it, and a test greps all three:

| File | What it adds |
| --- | --- |
| `bin/kaizen-build.sh` | `cp -R docs/site` and `cp -R docs/images` into the artifact |
| `Dockerfile.fly` | `COPY docs/site` and `COPY docs/images` |
| `.dockerignore` | the `!docs/site` and `!docs/images` exceptions that let them through |

The grep is the cheap half. The expensive half is `test/docker-context.test.js`, which
models Docker's ignore rules — exceptions, and the fact that an excluded directory is never
walked into, so an exception has to name every level it descends through — walks the
checkout the way the builder does, and asserts that **every file each `COPY` would take is
still in the upload**. It asserts the other direction too: nothing tracked is uploaded that
no `COPY` takes, which is what keeps the ignore list matching the recipe rather than
drifting behind it. Both halves exist because the failure they catch is invisible locally
and silent in the build — a wrong guess in those exceptions once produced a deployed office
whose documentation was entirely 404.

`server.cjs` serves `docs/site` **at** `/docs`, falling back to `docs/` for anything not in
the build — the three standalone HTML libraries, and the imagery. One rule, and no file
duplicated in git to make it work.

**A new documentation page therefore ships by existing**, exactly as a new root-level page
does: both recipes copy directories rather than naming files, for the reason
`bin/kaizen-build.sh`'s own comment gives — a page named individually is a page that
silently 404s once deployed and nowhere else.

## Cloudflare

A different trade: Workers cannot run `server.cjs` at all, so the receiver has to be
rewritten against Durable Objects and KV. In exchange, state becomes genuinely durable
and hosted ingest becomes possible. See
[cloudflare-deployment.md](design/cloudflare-deployment.md).

Neither Kaizen nor Fly really rivals Cloudflare. Between themselves, Kaizen answers
"can someone inside Atlassian see this?" and Fly answers "can anyone?" — and since
TRO-142, Fly also answers "will it still be there next week?", which was the gap that
made it a demo. What is left is the harder half: access control, and state that does
not live on one machine's disk. Cloudflare answers "can this be a real hosted product?"
later, and that is what it is still for.
