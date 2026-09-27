# Muse adapter

*This is the emitter, not a mapper.* The other adapters turn a harness's
native events into AOP on the wire; this one is for an agent that composes
AOP events directly and just needs them delivered. It runs on the agent's
machine:

```sh
node bin/aop-emit.cjs <event-type> '<payload-json>'
```

[Conformance level L2](../protocol/aop-spec.md#9-conformance-levels).
Redaction is the calling agent's responsibility: its permissions and
instructions must compose metadata-only events containing only tool names,
tool classes, tidied paths, durations and counts — never file contents,
prompts, replies or command output. The emitter transports the payload it is
given unchanged; it does not apply a second redaction pass. The normative
statement is [§10 of the spec](../protocol/aop-spec.md#10-privacy-and-redaction).

## Why a spool and a detached sender

Every invocation appends one event to `~/.roving-office/spool.ndjson` and
kicks a detached sender, then exits `0` — the agent never blocks on the
network, and a slow or unreachable office never becomes a slow agent. If a
flush fails the spool keeps the events and a later kick retries, so delivery
is at-least-once and the office de-duplicates on event id. The spool caps
itself at 2000 lines, keeping the newest three quarters when it trims.

The session id and sequence counter live in `~/.roving-office/session.json`
(mode `0600`, like everything here that could identify a machine).

## A first-class source

Muse is the seventh source in the office's source list (`src/data/sources.js`,
`kind: 'aop'`, `harness: 'muse'`), with its own mark and picker tile — so the
emitter reports `muse` honestly. No costume, no borrowed identity: the
`harness.name` on the wire is the source the room subscribes to. `AOP_HARNESS`
overrides it, along with `AOP_ACTOR` and `AOP_PROJECT`.

## Avatar

The emitter picks up `~/.roving-office/avatar.json` (`{"path": "<path>"}`)
and sends it as `session.actor_avatar` on every event. To get that path,
PUT the raw image bytes (PNG, JPEG, GIF or WebP, ≤ 2 MB) to
`/office/<keycard>/aop/v0/avatars/<sha256>` with the write token in the
`X-Roving-Office-Token` header; the response carries the path to save.

## Narration

The emitter is dumb on purpose — the interesting behaviour is the
convention of the agent driving it, including keeping its payload inside the
agent's metadata-only permissions. Descriptive `turn.start` titles (never
"Working"), the to-do list up front in the turn payload as `todos: [...]`,
per-step `tool.start` / `tool.end` with a plain-language `label`, and
`session.heartbeat` notes with progress on long tasks. The detail panel
becomes the play-by-play.

Break multi-step work into a numbered sequence and say which step you are
on for each job — "step 3 of 6: pushing the branch", then "step 4 of 6" when
it moves. A watcher should always be able to answer "where is it up to?"
without reading the chat.

## Usage

```sh
# announce a session (capabilities are what the office may expect)
node bin/aop-emit.cjs session.start '{"source":"startup","capabilities":["session.start","session.end","turn.start","turn.end","tool.start","tool.end","artifact.change"],"redaction":"metadata"}'

# a unit of work, with its to-do list
node bin/aop-emit.cjs turn.start '{"title":"Researching flights to Tokyo","trigger":"user","todos":[{"label":"Search flight prices","done":false},{"label":"Compare the top 3","done":false}]}'

# notable steps, labelled for watchers; tool_class is one of
# read | search | edit | execute | network | knowledge | scm | agent | wait | other
node bin/aop-emit.cjs tool.start '{"tool_class":"search","label":"Searching flight prices"}'
node bin/aop-emit.cjs tool.end '{"tool_class":"search","label":"Searching flight prices","status":"ok","duration_ms":2400}'

# a durable deliverable
node bin/aop-emit.cjs artifact.change '{"kind":"report","path":"~/workspace/tokyo-flights.md","summary":"3 options compared"}'

# end of work, and a clean exit (the character walks out instead of lingering)
node bin/aop-emit.cjs turn.end '{"status":"completed","title":"Researching flights to Tokyo","summary":"Found 3 options under budget"}'
node bin/aop-emit.cjs session.end '{"reason":"exit"}'
```

Endpoint and token come from `~/.roving-office/endpoint.json` (mode `0600`;
`AOP_URL` / `AOP_TOKEN` override it):

```json
{
  "url": "https://therovingoffice.com/office/<KEYCARD>/aop/v0/events",
  "keycard": "<KEYCARD>",
  "token": "<WRITE_TOKEN>"
}
```
