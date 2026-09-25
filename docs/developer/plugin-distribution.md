# Publishing the plugins

*How the Claude Code and Codex plugins reach somebody who has never cloned this
repository — and what is still missing before they do.*

Every route in [Adapter notes](protocol/aop-harness-adapters.md) installs out of a
checkout. `npm run connect:claude` adds `./` as a Claude marketplace;
`npm run connect:codex` stages a copy of the checkout and adds *that*. Both are right
while you are editing a mapper, and neither is any use to a person who has an office URL
and nothing else.

`npm run pack:plugins` builds what that person installs. It is `bin/aop-plugin-pack.cjs`,
and it deliberately follows the shape of
[`bin/aop-openclaw-pack.cjs`](adapters/openclaw.md): an explicit staging
list, the version stamped from `package.json`, an audit that refuses an artifact reaching
outside itself, and a `--verify` that runs the result from a temp directory with no
checkout above it.

```bash
npm run pack:plugins          # build both artifacts, then install and fire a real hook
npm run pack:plugins:check    # fail if the committed half has drifted (npm test runs it)
```

## The two hosts want different things, and that shapes everything

|  | Claude Code | Codex |
| --- | --- | --- |
| Marketplace source | any HTTPS URL to a JSON file | a local path, `owner/repo`, or a Git URL |
| Plugin source | `archive` — a zip over HTTPS, pinnable with a SHA-256 | the repository the marketplace is in |
| So the artifact is | **one file**, plus the JSON that pins it | **a whole repository tree** |
| Can it be published today? | yes — the site serves it | no: it needs a public Git repository |

That difference is the whole design. Claude can be handed a marketplace with no
repository anywhere in the picture, so `plugins/claude/` is two files and the site serves
them. Codex cannot: it clones, so there has to be something to clone.

### Claude: a URL cannot mean `./`

`.claude-plugin/marketplace.json` says `"source": "./"`, which resolves against the
marketplace root — the checkout. Fetched from a URL there is no checkout for `./` to
mean, so the hosted manifest is **generated** with the source replaced:

```json
{
  "name": "roving-office",
  "plugins": [{
    "name": "roving-office",
    "version": "0.15.0",
    "source": {
      "source": "archive",
      "url": "https://therovingoffice.com/plugins/claude/roving-office-0.15.0.zip",
      "sha256": "…"
    }
  }]
}
```

Generated rather than hand-maintained because of that digest. A copy edited by hand would
be wrong the first time anybody changed a mapper, and being wrong means Claude *refuses*
the install — the digest is verified on every download.

### Codex: the tree is the artifact

`plugins/codex/` is a complete distribution repository: `.agents/plugins/marketplace.json`
at the root — the first of the four paths Codex looks in, and the only host-neutral one —
with the plugin beside it and `"source": "./"`, which is correct here for exactly the
reason it is wrong above.

Nothing serves a clone, so it is gitignored and rebuilt on every push. Publishing it is a
`git push` into a public repository, and that repository is
**[the one thing this build cannot stand in for](#what-is-still-missing)**.

## What is in an artifact, and what is not

`RUNTIME` in the packer is the list, and it is a small fraction of `bin/`: the hook
entry point, the Node launcher, the adapter, `aop-core.cjs`, the mappers the host
actually needs, `hooks/hooks.json` and the logo. The office generators, the probe and the
screenshot tools are a contributor's toolkit and several of them import the vendored
three.js — none of that belongs on a stranger's machine.

Each artifact also carries three generated files:

- **`FILES.json`** — every other file with its size, mode and SHA-256. This is the
  "explicit file list" a published runtime artifact needs: names alone would say what was
  *meant* to be there, and the digests make it a statement about the bytes.
- **`NOTICE`** — version, copyright, and the fact that the artifact bundles no
  third-party code, which the staging list and the audit together actually establish.
- **`README.md`** — the install commands, where the endpoint comes from, and what
  redaction defaults to.

The mapper the *other* host needs is left out, and `bin/mappers/codex-cli.cjs` keeps its
state machine in `claude-code.cjs` — so the Codex artifact ships both. That is the kind of
mistake `--verify` exists to catch: an artifact missing a required module passes every
static check and dies on its first hook.

### The notices it does *not* carry

`THIRD_PARTY_NOTICES.txt` is not in either artifact, and that is deliberate. It is the
*browser application's* notices — the vendored 3D library and the colour table — and its
own first paragraph says as much: "These notices apply to those components only and do not
license this project, its fonts, logos or artwork." None of that software is in a plugin
artifact, so shipping a file of notices for it would be misleading rather than thorough.

What makes that a fact rather than a hope is `auditDependencies`: every bare specifier in
the payload has to be a Node builtin. `auditTree` only answers the *relative* half of the
question — a bare specifier in a checkout is a package that is really there, and in an
artifact it is one that is not. So the generated `NOTICE` says the artifact contains this
project's own code and its logo and no third-party software, and the build refuses to
produce one where that is untrue.

`third-party/components.json` describes both artifacts as distributions
(`claude-plugin-archive`, `codex-plugin-marketplace`) and lists `bin/aop-plugin-pack.cjs`
among the distribution recipes whose bytes are recorded as evidence. `assets/logo-256.png`
is the only tracked component inside them, and its release rights are an open gate — the
same gate as the missing licence below.

## Why `plugins/claude/` is committed

Generated output in the repository is exactly what `.gitignore` argues against, and
`docs/site` is the precedent for doing it anyway: **neither deploy target may build.**
`Dockerfile.fly` runs no
`npm install` at all — read either one; the reason is in their comments. So a marketplace
assembled at deploy time would exist on one target and 404 on the other.

So it is committed, both recipes ship it, and `npm test` guards it. The rule is: **what
the site serves is committed; what needs a repository that does not exist yet is not.**

That only works because the archive is **byte-reproducible**. `bin/lib/zip.cjs` stores
rather than deflates — zlib's output depends on the zlib version Node was built against,
so a deflated entry is reproducible on one machine and not the next — and stamps one fixed
timestamp on every entry. A digest that moved on a rebuild would fail the drift check on a
checkout nobody had edited, and would republish an identical plugin under a new identity.

## Bump the version. Every time

The rule in [Working agreements](../../AGENTS.md) applies with full force here, because a
published install is a snapshot like every other: both hosts cache by version, and an
update offered the version it already holds does nothing at all, silently. `--check`
refuses a build where `package.json` and the two plugin manifests disagree.

## Nothing relies on the executable bit

`hooks/hooks.json` says `sh "${CLAUDE_PLUGIN_ROOT}/bin/aop-plugin-hook.sh"`, and that
script `exec sh`s the Node launcher rather than running it directly. A local install
copies the plugin and modes survive; a published Claude install is unpacked from a zip by
the host, and whether a stored unix mode reaches disk is the extractor's business. The
failure it prevents is the worst kind this adapter has — a hook that cannot be executed
fails *silently*, because a non-blocking hook's failure is not the agent's problem, so the
only symptom is an office that stays empty.

The modes are set in the archive anyway. Belt and braces.

## What `--verify` actually proves

An audit proves no import escapes the artifact and no file names the machine that built
it. Neither proves the thing works — a file can be present, correct and still be the
wrong version of itself. So `--verify`:

1. Extracts the archive into a temp directory, and cross-checks it against `unzip -t`
   when one is on `PATH`.
2. Reads the command out of the artifact's own `hooks/hooks.json` and runs it through a
   shell, with the host's plugin-root variables set, `HOME` pointed at a scratch
   directory so the run cannot see or disturb the office on this machine, and `AOP_URL`
   pointed at a loopback receiver it opened.
3. Fires `SessionStart` *and* `UserPromptSubmit`, because the mapper holds the
   introduction at session start and releases it on the first real event — a check that
   fired only the first would assert that a working adapter sends nothing.
4. Asserts `session.start` and `turn.start` arrive, and that every event names the
   harness the artifact was cut for.
5. Where `codex` is on `PATH`, does the whole thing again through a *real* Codex install
   into a throwaway `CODEX_HOME`, and then fires the hook from the cache Codex wrote.

## What is still missing

`npm run pack:plugins` produces artifacts. It publishes nothing, and three things stand
between these artifacts and an installable plugin:

- **A public Git repository for Codex.** `plugins/codex/` is ready to be its contents;
  there is nowhere to push it yet. Everything up to that boundary is built and verified,
  including a real `codex plugin marketplace add` against the generated tree.
- **Office pairing.** Installing a plugin does not tell it which office to feed. The
  adapter reads `~/.roving-office/endpoint.json` or `AOP_URL`, and there is no published
  way to write either without a checkout. A short-lived pairing code is new functionality
  and separate work.
- **A licence.** There is no `LICENSE` at the root of this repository, so no artifact
  carries one, and the generated `NOTICE` says so. The packer picks one up the moment it
  lands; until then it prints a warning on every build.

And one thing that is not missing so much as *owed to existing installs*:

- **Migrating the settings route.** Somebody who installed with
  `npm run connect:claude:settings` has fifteen hooks in `~/.claude/settings.json` naming
  an absolute path into their checkout. Installing the published plugin beside those would
  send every event twice — two `tool.start`s with the same `tool_call_id`, and a room that
  double-counts. A migration has to: recognise our own hooks by the `aop-send.cjs` marker
  and remove *only* those, leaving every other hook in the file untouched and every
  matcher unedited; delete the `hooks` block and the file itself if nothing else is in
  them, so an uninstall is indistinguishable from never having run; and back the file up
  first. `bin/aop-claude-install.cjs`'s `planSettings` already does exactly this for
  `--uninstall`, so the work is wiring, not invention. It is not implemented here.

Anthropic's and OpenAI's own directories are a later step again: the recommendation is to
run our own marketplace first and submit for discovery afterwards.

## Read next

- [Adapter notes](protocol/aop-harness-adapters.md) — what each harness can actually tell us
- [The Claude Code adapter](adapters/claude-code.md) and [the Codex adapter](adapters/codex.md)
- [Getting the code](getting-the-code.md) — the checks this build is one of
