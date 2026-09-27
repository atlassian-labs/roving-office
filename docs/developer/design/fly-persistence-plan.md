# Making a Fly office survive a deploy

Today `flyctl deploy` loses every office, every scene layout and every ingest token.
Not because the app has nowhere to write — `lib/office-store.cjs` has persisted the
whole registry to a JSON file since TRO-107 — but because of where that file lands and
how long an office is allowed to be quiet.

Three things are wrong, and all three have to be fixed together. Two of them are one
line each.

## What is lost, and what is not

Persisted already, and therefore recoverable: the keycard, `createdAt`, every scene
with its `look` and its furniture `layout`, and `writeTokenHash` — the office's ingest
token, which is what an adapter posts with. Recovering that hash is the whole of "we
don't lose connections": the plaintext token an emitter already holds keeps verifying
across the deploy, so nothing has to be re-minted or re-installed.

Not persisted, and out of scope here: the AOP ring buffer in `lib/aop-bus.cjs`. Event
history is in memory by design and a deploy still clears it. Adapters reconnect and
the room refills; nobody has to touch a config.

## 1. Give the machine a disk

```bash
flyctl volumes create roving_office_data --region syd --size 1 -a the-roving-office
```

and in `fly.toml`:

```toml
[mounts]
  source = "roving_office_data"
  destination = "/data"
```

1 GB is the Fly minimum and is enormous for this: the store file is kilobytes, and an
avatar is capped at 2 MB by `lib/avatar-store.cjs`.

A volume binds to one machine, so `flyctl scale count 1` — already required by
`docs/publishing.md`, because two machines are two independent in-memory `Map`s — stays
required for a second reason. Keep the default rolling strategy; do not switch to
bluegreen, which wants a second machine that has no volume to attach to.

## 2. Let the state directory be told where to go

`server.cjs:110-114` hardcodes `os.homedir()`. Make it overridable:

```js
const stateDir = process.env.ROVING_OFFICE_STATE_DIR
  || path.join(os.homedir(), '.roving-office');
const endpointFile = path.join(stateDir, 'endpoint.json');
const officeFile = path.join(stateDir, 'offices.json');
const avatarDir = path.join(stateDir, 'avatars');
```

Then in `fly.toml`:

```toml
[env]
  PORT = "8080"
  ROVING_OFFICE_STATE_DIR = "/data/roving-office"
```

Only `offices.json` and `avatars/` actually matter on Fly — `endpoint.json` is the
machine-local adapter handshake and is never written unless `--publish` is passed — but
moving all three keeps one directory to reason about, and one env var to set.

There is a zero-code version of this step: `ENV HOME=/data` in `Dockerfile.fly`, since
Node's `os.homedir()` reads `$HOME` first. It works, and it is worth knowing about if
something needs fixing before a code change can land. It is not worth shipping: it
makes the volume load-bearing on an implicit property of `homedir()`, and it moves
anything else that ever reaches for `$HOME` along with it.

## 3. Stop the idle reaper undoing steps 1 and 2

This is the one that is easy to miss. `IDLE_TTL_MS` is 30 minutes
(`lib/office-store.cjs:34`), and it applies twice: `sweep()` deletes idle offices while
running, and `load()` refuses to restore one that was already past the deadline
(`office-store.cjs:656`). With `min_machines_running = 0` the machine stops whenever
nobody is looking, so any gap longer than half an hour empties the store on the next
boot — volume or no volume.

Thirty minutes is the right default for a laptop, where an office is a scratch thing
you opened this afternoon. It is the wrong number for a hosted URL you hand to someone.
Make it an option rather than a constant:

```js
// in createOfficeStore({ ... })
function createOfficeStore({ keycard, file, idleTtlMs = 30 * 60_000, log = () => {} }) {
```

and use `idleTtlMs` in `sweep()`, `load()` and `toJSON()`. The store already exposes
`store.IDLE_TTL_MS` per instance and `test/office-store.test.js` reads it off the
instance rather than off the module, so the tests follow the option without changing.

`server.cjs` passes it through:

```js
store = createOfficeStore({
  keycard,
  file: officeFile,
  idleTtlMs: Number(process.env.ROVING_OFFICE_IDLE_TTL_MS) || undefined,
  log: (msg) => console.log(msg),
});
```

and `fly.toml` sets a hosted value — 30 days:

```toml
  ROVING_OFFICE_IDLE_TTL_MS = "2592000000"
```

Keep a TTL rather than removing one. An office nobody has opened in a month is litter,
and the reaper is the only thing that ever tidies up.

## Verifying

```bash
flyctl deploy
# open an office, lay out some furniture, note the keycard
flyctl ssh console -C "cat /data/roving-office/offices.json"   # the office is on disk
flyctl deploy                                                  # deploy again
# the same keycard URL: same scenes, same layout, same ingest token
```

Two things worth checking explicitly, because they are the point of the exercise:
an adapter that was posting before the deploy should still be accepted afterwards
(the `writeTokenHash` survived), and an avatar uploaded before it should still render
(it is under the volume too, not just the registry).

## Afterwards

`docs/publishing.md` needs two corrections. The comparison table at line 13 says Fly
gives you "offices that vanish with the machine", and the "What it still doesn't have"
section at line 451 says "nothing written to a durable store" and "a restart forgets
every office". The first was already only half true; after this it is wrong. What
stays true, and should stay said plainly, is that a Fly URL is unauthenticated and
public — durability was never the thing standing between this and a real hosted
product. Access control still is, and that is Cloudflare's job.
