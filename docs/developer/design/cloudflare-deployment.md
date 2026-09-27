# Deploying on Cloudflare Workers

A spec, not a description: nothing here is built yet. It says what the code would
become if the office moved from `node server.cjs` on a laptop to a Worker on
Cloudflare's edge, why each change is forced rather than chosen, and which of
today's design decisions stop being true the moment the receiver is on the
internet.

Every API claim below was checked against Cloudflare's docs; the
[Sources](#sources) section lists the pages, and the few places where the docs are
silent are marked as such rather than guessed at.

## The shape of the problem

Two of the three halves of the system are already portable. The scene is static
files with no build step — a CDN import map and plain ES modules — and the
adapters are Node scripts that run inside somebody's agent loop on their own
machine. Neither needs to change much.

The middle is the problem. Read [Architecture](../architecture.md#the-pipeline) and
note where the arrows cross a machine boundary:

```
bin/aop-send.cjs        on your laptop      ─┐
                                             │  today: POST to 127.0.0.1
server.cjs              on your laptop      ─┘  hosted: POST across the internet

server.cjs              on your laptop      ─┐  today: SSE to localhost
src/data/AopSource.js   in your browser     ─┘  hosted: WebSocket to the edge
```

`server.cjs` is the only component that must be rewritten, because it is the only
component that is a *server*. Everything it does falls into four groups, and each
group lands on a different Cloudflare primitive:

| What `server.cjs` does today | Where it goes |
| --- | --- |
| Serves `index.html`, `home.html`, `styles.css`, `src/**` | Workers Static Assets — free, unbilled, no Worker invocation |
| Holds the office registry (`lib/office-store.cjs`, `offices.json`, the sweeper) | One Durable Object per office; the keycard *is* the name |
| Holds each office's ring buffer and fans it out (`lib/aop-bus.cjs`) | The same Durable Object, over hibernatable WebSockets |
| Decides who may write (`isLocal()` + `endpoint.json` token) | Has no equivalent, and is the one real design decision in this document |
| Keeps agent portraits (`lib/avatar-store.cjs`, files on disk) | R2, keyed by the same content hash — the store is already addressed by bytes, so this is the one row that ports without a decision |

The rest of this spec is those four rows in order, then what it costs and how to
stage it.

## One Durable Object per office

This is the central idea, and it deletes more code than it adds.

`lib/office-store.cjs` exists because a process holds a `Map` of offices and has to
answer "which one is this request for?", persist the map to `offices.json` so a
restart does not forget, and sweep the map on a timer to reap the idle ones. All
three jobs are consequences of *being one process holding many offices*.

A Durable Object namespace is addressed by name, and the name can be any string:
`env.OFFICE.getByName("K7F2-9QBX")` returns a stub for the one instance of the
class that answers to that keycard, anywhere in the world, and creates it on first
use. So the keycard stops being a key into a map and becomes the address itself.
The lookup *is* the routing. There is no registry to persist, and therefore no
`offices.json`.

```js
import { DurableObject } from 'cloudflare:workers';

export class Office extends DurableObject {
  // ctx: DurableObjectState, env: bindings — the base class stores both as
  // this.ctx / this.env
}
```

Four behaviours have to be re-founded on that, and each gets simpler:

**Creation on first sight.** Today `store.open(card)` mints an office the first
time a keycard is seen, which is what makes a shared link work before anyone has
opened it. In DO terms every keycard already resolves to an object, so "does this
office exist?" has to become an explicit fact in the object's own storage — a
`createdAt` row written on first contact. This matters because reception's
`?peek` route asks exactly that question and must be able to answer *no* without
creating anything. Reaching a DO and reading empty storage costs a request and
writes nothing, so `peek` stays honest.

**Minting.** `keycard.mint(taken)` asks the store which keycards are in use.
There is no global list any more, and building one (a KV of taken keycards) would
reintroduce the registry we just deleted. Instead: mint locally, ask that one
office whether it already has a `createdAt`, and retry if it does. At 32⁸ ≈ 1.1e12
addresses that loop runs once. `src/office/keycard.js` already takes `taken` as an
injected predicate and `bytes` as an injected CSPRNG, so it needs no change at
all — `globalThis.crypto.getRandomValues` exists in Workers, which is precisely
the case its `randomBytes` fallback was written for.

**Reaping.** The 60-second sweeper over every office becomes each office
scheduling its own execution: `ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS)`,
and an `alarm()` handler that checks whether anything has happened since and, if
not, calls `ctx.storage.deleteAll()`. This is strictly better than the sweeper —
no global scan, no list to walk, and an office that nobody ever visits again
cleans itself up. Alarms are guaranteed at-least-once with retries, so the handler
must be idempotent; deleting already-deleted storage is.

The demo office (`TEST-0000`) keeps its exemption by simply not setting an alarm.

**Presence.** The `/heartbeat` poll survives unchanged in shape. Its comment
explains it is a poll rather than a held-open stream because a pending response
stops Chrome's virtual clock and would hang a headless screenshot; that reason is
unaffected by hosting. The `viewers` set moves into the DO's memory, with the
caveat under [hibernation](#sse-becomes-a-websocket-and-why-it-has-to) that
in-memory state does not survive eviction — so presence either lives in storage or
is derived from the set of attached WebSockets, which is the better answer.

**Scenes.** `/api/scenes` CRUD and the office's scene list are per-office mutable
state, so they belong in the same object as the buffer, in SQLite. That is also
the answer to a bug the current design tolerates: two tabs editing scenes race
through a shared `Map`, whereas a DO serialises every request to one office by
construction.

### Storage backend

Use the SQLite backend. It is the default and the recommendation for all new
classes, it is the *only* backend available on the Workers Free plan, and it is
declared once in a migration:

```jsonc
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["Office"] }
]
```

`ctx.storage.sql.exec(sql, ...params)` is synchronous and does not yield the event
loop, which is why `blockConcurrencyWhile` is rarely needed outside the
constructor. Scenes and the `createdAt` marker are rows. The event ring is
discussed next, and is the one thing that arguably should *not* be.

## SSE becomes a WebSocket, and why it has to

This is the change with the least room for negotiation, and it is a billing
argument before it is a technical one.

Durable Objects are billed for wall-clock duration whenever they are "actively
running or idle in memory but unable to hibernate", and the limits page is explicit
that a DO "remain[s] active while a request, RPC call, **response stream**,
WebSocket, or pending I/O is in flight". An SSE response is a response stream held
open for as long as somebody has the office on a second monitor. There is no
documented duration cap — the docs say there is no hard limit while the client
stays connected — so it would work perfectly and bill continuously. An office left
open all day is a Durable Object resident in memory all day.

Hibernation is the escape, and it applies to WebSockets only. The docs describe no
equivalent for streaming HTTP responses; that is an absence, not a documented
prohibition, but the absence is the whole point — there is no way to detach an SSE
response from a live object.

So: `GET /aop/v0/stream` stops being `text/event-stream` and becomes a WebSocket
upgrade.

### What that looks like

```js
async fetch(request) {
  const [client, server] = Object.values(new WebSocketPair());
  // acceptWebSocket, *not* server.accept(): the latter pins the object in memory.
  this.ctx.acceptWebSocket(server, [harness ?? 'all']);
  return new Response(null, { status: 101, webSocket: client });
}

async webSocketMessage(ws, message) { /* client → office, e.g. cursor acks */ }
async webSocketClose(ws, code, reason, wasClean) { /* presence */ }
async webSocketError(ws, error) { }
```

Four properties of hibernation drive the rest of the design:

**In-memory state is reset and the constructor re-runs.** When the object has been
idle for a short period it is evicted while its clients stay connected to
Cloudflare's network; the next event re-initialises it. `lib/aop-bus.cjs` closes
over `ring`, `cursor`, `seenIds`, `farewellSessions` and `lastEventAt` in a
factory — every one of those is exactly the state hibernation throws away. They
have to be durable. The ring, the cursor and the farewell set become SQLite; the
subscriber set is replaced by `ctx.getWebSockets()`, which the runtime maintains
across hibernation for us.

That is a real cost to weigh: the ring buffer stops being a 2 000-element array
push and becomes rows in a table with an index on cursor and a delete of anything
older. It is more code than the array, and the honest reason for it is that a
hibernating object cannot have a heap.

**Per-connection state survives, if you serialise it.** `ws.serializeAttachment(v)`
keeps a copy of `v` with the connection, and `ws.deserializeAttachment()` reads it
back after the object wakes. The subscriber's `{ harness, after }` filter belongs
here. Tags passed to `acceptWebSocket` (up to 10 per socket, 256 characters each)
give the other half: `ctx.getWebSockets(tag)` replaces the `if (sub.harness !==
harness) continue` scan in `fanout`, so a harness-filtered broadcast becomes a
lookup rather than a loop over everybody.

**Keepalives must not wake it.** The bus sends `: ping <now>` every 15 seconds per
subscriber, for the good reason that proxies and sleeping laptops silently drop
idle connections. Naively ported, that is a timer, and a timer is the opposite of
hibernation: every ping would wake the object and bill it. The answer is
`ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(req, res))`, which
answers a matching client message from the runtime "without waking WebSockets in
hibernation and incurring billable duration charges". Invert the direction —
client pings, edge answers — and the keepalive becomes free.

**Incoming messages are billed, at a discount.** A request is needed to open the
connection; outgoing messages are not charged; incoming messages are charged at a
20:1 ratio. This is another argument for the auto-response ping and against any
chatty client→server protocol.

### What changes in the browser

`src/data/aop-reducer.js` is the one reducer and stays the one reducer. What changes
is the transport underneath it, and the change is not free, because
`EventSource` was doing real work:

- **It reconnects by itself.** A `WebSocket` does not. The retry-with-backoff loop
  that `EventSource` provided has to be written, and it is the thing that keeps an
  office alive across a closed laptop lid.
- **It has `lastEventId`.** The cursor arrives today in the SSE `id:` field and is
  read from `msg.lastEventId`. Over a WebSocket the cursor has to be carried in the
  frame body, so the wire format grows an envelope (or `_onFrame` learns to read
  `ev.cursor`).
- **It has named events.** `_subscribe` registers a listener per AOP event type
  because SSE frames are named. A WebSocket has one `message` event, so the
  `AOP_EVENT_TYPES` fan-out collapses to a single handler — a simplification, and
  the one place this transport is *easier*.
- **`_resync` still matters, and matters more.** Its comment explains that a
  silently reconnected stream against a restarted receiver replays nothing and
  leaves a stale room. Hibernation makes reconnection routine rather than
  exceptional, so the snapshot-then-subscribe dance is load-bearing. Better:
  fold `/state` into the WebSocket handshake and have the object send the
  replay as its first frames, which removes a round trip and the window between
  the two.

The `/state` and `/health` routes stay as plain `fetch` handlers on the DO. They
are short-lived requests, so they hibernate fine.

## The two front doors

Static assets are the easy half and contain one nasty surprise.

By default, a request that matches a file in the assets directory is served
without invoking Worker code at all — free, unbilled, cached at the edge. Only
unmatched requests reach the Worker. That is the correct default for a project
whose entire scene is static files, and it means the 3D office costs nothing to
serve.

The surprise is the filenames. Today `server.cjs` rewrites `/` to `home.html`,
because **`index.html` in this repo is the office, not the front door** —
reception is `home.html`. Under static-asset routing, `index.html` is the one
filename with special meaning: `/` resolves to it, and
`not_found_handling: "single-page-application"` serves it with a 200 for anything
unmatched. Deployed as-is, `/` would open an office shell with no keycard, and
reception would be reachable only at `/home.html`.

Two ways out, and they are not equally good:

1. **Rename.** `home.html` → `index.html` (reception becomes the front door, as
   the convention intends) and `index.html` → `office.html`. The Worker rewrites
   `/office/<keycard>/*` to the office shell via the assets binding. This is a
   handful of renames and it makes the local server *simpler* too, since the
   `'/' → '/home.html'` special case disappears.
2. **Leave the names and force the Worker to run first everywhere.**
   `run_worker_first: true` invokes Worker code on every request, which makes every
   asset a billable invocation and throws away the free-static-serving property.
   Do not do this.

With option 1 the Worker only needs to run for paths that are not files:

```jsonc
{
  "name": "roving-office",
  "main": "worker/index.js",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./",
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    "run_worker_first": ["/office/*", "/api/*"]
  },
  "durable_objects": {
    "bindings": [{ "name": "OFFICE", "class_name": "Office" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Office"] }]
}
```

A note on `run_worker_first` as an array: negative patterns (`"!/office/foo"`)
take precedence over positive ones, and on the Free plan a request matching a
positive pattern that exceeds the daily limit gets a `429` rather than falling
back to asset serving. Since `/office/*` is every office page load, that is worth
knowing before choosing where the line sits.

The Worker's own `fetch` is then thin — it is a router and nothing else, which is
the same shape `server.cjs` has today:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const at = officePath(url.pathname);          // src/office/keycard.js, unchanged
    if (!at) return env.ASSETS.fetch(request);

    const office = env.OFFICE.getByName(at.keycard);
    if (at.rest.startsWith('/aop/v0') || at.rest.startsWith('/api')) {
      return office.fetch(request);               // or an RPC method
    }
    // canonical spelling, then the app shell
    return env.ASSETS.fetch(new URL('/office.html', url));
  }
};

export { Office } from './office.js';
```

Two smaller asset facts worth designing around. The default response header is
`Cache-Control: public, max-age=0, must-revalidate`, which is close enough to the
dev server's deliberate `no-store` that a no-build project stays debuggable; a
`_headers` file can override per path if the CDN import map is ever vendored.
And the limits are generous for this repo: 20 000 files (Free) / 100 000 (Paid),
25 MiB each.

## Ingest without loopback

This is the decision the rest of the spec cannot make for you, and it should be
made deliberately — the same conclusion [the adapter
notes](../protocol/aop-harness-adapters.md) already reached about Cowork.

Today the security model is two capabilities that happen to be cleanly separated:

- **The keycard is the read capability.** Unguessable, in the URL, shareable by
  design. "Public but hidden."
- **Loopback plus a token is the write capability.** `isLocal()` rejects anything
  that is not `127.0.0.1`, and `endpoint.json` is `0600` in `$HOME`. The
  [spec](../protocol/aop-spec.md) states it plainly: a keycard is enough to *watch* an office,
  and not enough to inject agents into one.

Deployed, `isLocal()` is meaningless — every request arrives from the edge — and
if it is simply deleted then the keycard becomes both capabilities at once.
Anyone you share an office with can spawn agents in it. That may be acceptable for
a toy; it should not happen by accident.

Three options, in increasing order of effort:

**A per-office ingest secret.** ✅ **Built** — and built on the Node server rather than
here, because a hosted Kaizen office needed it first. Minting an office returns a
keycard *and* a write token; the token is stored hashed on the office and written into
`~/.roving-office/endpoint.json` alongside the URL, which is already exactly the
file `bin/aop-send.cjs` reads and already carries a `token` field. The adapters did
not change at all — they post to whatever URL and token they find. This preserves
the current separation of capabilities with the least disruption, and it was the
recommendation.

Two notes for whoever ports it to a Durable Object. The `isLocal()` check did not
survive as a gate on the whole surface: reads are keycard-only and writes need the
token, so the split is per *route*, not per network — see
[architecture](../architecture.md#receiving-events). And the office's write-token hash
lives with the office, so a store that loses offices also invalidates every connected
machine's credentials; in a DO that is a feature, whereas on a reaped Kaizen sandbox it
is [the sharp edge](../publishing.md#what-a-hosted-office-still-cannot-do).

**HMAC over the body with a timestamp.** `crypto.subtle.sign({ name: 'HMAC', hash:
'SHA-256' }, key, body)` plus a freshness window, so a captured request cannot be
replayed. More robust, and more for the adapters to do. Probably not warranted for
a scene of walking characters.

**Cloudflare Access with a service token.** Access can gate a Worker route, and a
headless client authenticates with `CF-Access-Client-Id` / `CF-Access-Client-Secret`
headers. Correct, and enterprise-shaped: it means an office cannot be shared with
someone outside the Access policy, which conflicts with "send someone the eight
characters and they are in the room with you."

Whichever is chosen, two supports come nearly free:

- **The secret itself** is a Worker secret (`wrangler secret put`, read as
  `env.NAME`) rather than a config `var`, which is plaintext. Per-office tokens are
  data and live in the DO; a single signing key is a secret.
- **Rate limiting** is a first-class binding, and the natural key is the keycard —
  which conveniently also limits how fast an attacker can probe the address space:

  ```jsonc
  "ratelimits": [{
    "name": "INGEST_LIMIT",
    "namespace_id": "1001",
    "simple": { "limit": 100, "period": 60 }   // period must be 10 or 60
  }]
  ```
  ```js
  const { success } = await env.INGEST_LIMIT.limit({ key: keycard });
  ```

  Note the limit is per Cloudflare location, so it is approximate across the
  network — fine for abuse control, not a quota.

CORS, for once, is a non-issue on the ingest path: a CLI sends no `Origin` and
issues no preflight. It matters only if a browser is ever taught to POST events.

## Runtime differences to design around

Small things that would each cost an afternoon if discovered at deploy time.

- **`crypto.timingSafeEqual` moves.** `authorised()` uses Node's
  `crypto.timingSafeEqual`. Workers expose `crypto.subtle.timingSafeEqual(a, b)`
  — a documented non-standard extension to Web Crypto, taking two
  `ArrayBuffer | TypedArray` and returning a boolean. Same guarantee, different
  namespace, and available without `nodejs_compat`. (Node's version is also
  reachable via `node:crypto` with the flag; prefer the native one.)
- **gzip request bodies.** `handleIngest` calls `zlib.gunzipSync` when
  `Content-Encoding: gzip` is set. `node:zlib` is available under `nodejs_compat`,
  so a literal port works — but `new DecompressionStream('gzip')` piped through
  the request body is the idiomatic Workers form and avoids the flag. The docs do
  not say the runtime decompresses request bodies automatically, so do not assume
  it does.
- **`ctx.waitUntil` is a no-op inside a Durable Object.** It exists for API
  compatibility and does not extend the object's lifetime; DOs stay active while
  work is pending, so it is not needed. In the *Worker* it behaves normally and
  extends execution up to 30 seconds past the response.
- **`blockConcurrencyWhile` in the constructor** is the right place for schema
  setup — but the hibernation docs warn to minimise constructor work, because the
  constructor runs on every wake. A `CREATE TABLE IF NOT EXISTS` is cheap; loading
  the ring into memory is not, and would defeat the point.
- **CPU time is the real ceiling, not duration.** 10 ms per request on Free, 30 s
  (raisable to 5 min) on Paid. Nothing here is CPU-bound — the average Worker uses
  ~2.2 ms — but a DO that parses a large NDJSON batch and writes 2 000 rows
  synchronously on a Free plan is the one plausible way to hit it. The existing
  256 KiB body cap is the mitigation and should stay.
- **Compatibility date matters for two behaviours** cited above: asset navigation
  preference (`2025-04-01` or the
  `assets_navigation_prefers_asset_serving` flag) and `nodejs_compat` being on by
  default (`2026-08-04`). Pin the date explicitly.

## What it costs

Free-plan viability is the interesting question, since the local version costs
nothing and a hosted one should not become a subscription to watch cartoons.

Durable Objects are available on both Free and Paid plans; Free is limited to the
SQLite backend, which is what we want anyway. The relevant allowances:

| | Free | Paid |
| --- | --- | --- |
| Worker requests | 100 000 / day | 10 M / month included |
| Static asset requests | free and unlimited | free and unlimited |
| DO requests | 100 000 / day | 1 M / month, then $0.15/M |
| DO duration | 13 000 GB-s / day | 400 000 GB-s / month, then $12.50/M |
| DO storage | 5 GB / account | unlimited (10 GB per object) |

The whole architecture above is arranged so that the second-to-last row stays near
zero. An office with three people watching and one agent working is, in billing
terms: a handful of Worker invocations per page load, one DO request per WebSocket
open, incoming events at one request each, incoming client messages at 20:1, one
alarm per reap — and *no duration at all* while it is hibernating, which is most of
the time. The costly mistakes are all the ones this spec argues against: an SSE
stream, a `setInterval` keepalive, `server.accept()` instead of
`ctx.acceptWebSocket()`, or `run_worker_first: true`.

## Staging the work

The order matters, because most of the value arrives before any of the risk.

1. **Make `server.cjs` a shell.** Extract the routing table so that "which handler
   does this URL want" is a pure function of the path, shared by both runtimes.
   This is worth doing whether or not anything is ever deployed.
2. **Make the bus durable.** Give `lib/aop-bus.cjs` a storage interface and pass in
   an in-memory implementation locally. Nothing observable changes; the ring stops
   being a closure variable. This is the largest single change and the one most
   worth landing on its own.
3. **Add a WebSocket transport beside SSE.** Both server and `AopSource` speak
   either, chosen by capability. Locally SSE stays the default, so the headless
   screenshot workflow in [Developing](../developing.md) is untouched.
4. **Rename the two HTML files**, and delete the `'/' → '/home.html'` special case.
5. **Write `worker/index.js` and `worker/office.js`** against the extracted pieces,
   plus `wrangler.jsonc`. `wrangler dev` runs assets and DOs locally against the
   same runtime as production, so this step is testable before it is deployed.
6. **Decide ingest.** Nothing before this point is blocked on the security
   decision, which is why it is last rather than first.

Two things do *not* move, and saying so is part of the spec. `endpoint.json` and
the `/claim` route are facts about a machine — which office on this laptop
receives local hooks — and they stay local even when the office they name is a
`https://` URL on the edge. And the reducer stays exactly where it is: the
[architecture's](../architecture.md) first rule is that there is one reducer, in the
browser, and hosting does not give anyone a reason to add a second.

## Alternative: publishing internally, evaluated and dropped

An internal Atlassian functions-hosting platform was weighed against the above and
the comparison used to live here in full. It has since been retired — nothing runs
on it — so the evaluation is removed rather than left as a comparison against
something that no longer exists. The conclusion it reached is the part worth
keeping: a gateway that serves static assets from a cache and wakes a function per
request suited the scene perfectly and could not host the receiver, because a
receiver has to stay awake to hold an event buffer and stream it.

## Open questions

- **Does a hosted office keep the 30-minute idle TTL?** Locally, reaping protects
  a process; hosted, storage is billed. An office someone bookmarked deserves a
  longer life than one someone typo'd into existence, and the DO knows the
  difference (a `createdAt` with no events after it).
- **Does the ring buffer need to be durable at all?** An alternative to the SQLite
  ring: accept that a hibernation cycle loses replay, and let reconnecting clients
  rely on their own state plus the session TTLs. Cheaper and much less code; the
  cost is that an office reopened after a quiet spell is empty until the next tool
  call, which is the exact failure `_hydrate` was written to prevent.
- **Is `locationHint` worth using?** A DO is created near its first caller. For an
  office whose events come from one laptop and whose viewers are elsewhere, first
  contact is arbitrary.
- **Are keycards still enough on a public origin?** 32⁸ with rate limiting is
  defensible. It is also the kind of claim that should be argued explicitly if the
  origin is `*.workers.dev` and not `localhost`.

## Sources

Cloudflare documentation, read 2026-08-28:

- [Durable Objects: WebSockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) — hibernation, `acceptWebSocket`, `WebSocketPair`, attachments
- [`DurableObjectState`](https://developers.cloudflare.com/durable-objects/api/state/) — `acceptWebSocket` tags, `getWebSockets`, `setWebSocketAutoResponse`, `blockConcurrencyWhile`, `waitUntil` no-op
- [Durable Objects namespace](https://developers.cloudflare.com/durable-objects/api/namespace/) — `getByName`, `idFromName`, `newUniqueId`, `locationHint`
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) — free plan, SQLite-only on Free, 20:1 message ratio, hibernation and duration
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) — storage and CPU per object
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) — CPU vs duration, "no hard limit… response stream… in flight"
- [Static assets](https://developers.cloudflare.com/workers/static-assets/) and [routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/), [SPA mode](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), [billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) — `crypto.subtle.timingSafeEqual(a, b)`, HMAC
- [Rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) — `ratelimits` config, `limit({ key })`
- [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) — `nodejs_compat`, `node:zlib`, `node:crypto`

## Read next

- [Architecture](../architecture.md) — the pipeline this spec cuts in half
- [The AOP spec](../protocol/aop-spec.md) — §5, the receiver contract that has to survive the move
- [Adapter notes](../protocol/aop-harness-adapters.md) — the capability split, and how a remote office is fed without making the agent wait
