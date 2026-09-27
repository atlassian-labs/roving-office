# Job delivery: gaps and the shipped-fix ledger

*What the mailbox still gets wrong, and the record of what it used to get wrong.*

The mechanism itself is [job delivery](../job-delivery.md). This is kept separate because
it is a design record rather than a reference: half of it describes behaviour the code
**no longer has**, and reading it as documentation of the current system would mislead.

**The numbering is stable and referenced from the code**, so entries that are fixed keep
their places rather than being deleted.

## 7. Where it stands against TRO-16

The story landed in `fb29c73` ("TRO-16: Fetch every prompt as addressed post"), merged as `de2b4fd`, with two follow-up fixes from the audit that produced this document — the station choice in §8.1 and the abandoned expectation in §8.2. Every behavioural acceptance point in the description is now implemented:

| Requirement | State |
| --- | --- |
| Two kinds of post share one box | Done — `forId` null or set |
| Only the recipient may open addressed post | Done — `Post.indexFor` |
| Other agents must not walk to the box for it | Done — `canCollect` picks the station |
| Addressed at posting, not at landing | Done — `Post.post` bumps `inFlight` |
| An agent may wait at the box for a plane in the air | Done — `waitUntil` |
| Only addressed post interrupts a seated agent | Done — `hasOwn` |
| Mock source unchanged, unaddressed keeps its meaning | Done |
| Post binned when its recipient leaves, in flight included | Done in the model, invisible in the room (§8.3) |
| Desk label set on opening, not on arrival | Done — `_collectMail` |
| Rules in `post.js` with no Three.js | Done |
| ...*so they are testable without a browser* | **Not done** — no tests, no runner |

## 8. Where it could be better

Ordered by how much they matter. The numbering is stable and referenced from the code, so the two that are fixed keep their places rather than being deleted.

### 8.1 Non-recipients walk to a box they may not open — *fixed*

`_work` used to pick the station with `ownPost || this.post.size > 0`, which counts *every* envelope, including ones addressed to somebody else. An agent who needed material while the box held nothing but a colleague's envelope walked over, stood there for the full 20 s `MAIL_WAIT` because `canCollect` was false, got nothing, and headed to their desk anyway. That broke the story's headline requirement: *"other agents must not walk to the box for it at all."*

It now asks the right question, with a method that already existed and already meant exactly this:

```js
const fromMailbox = ownPost || this.post.canCollect(rec.agent.id);
```

The wait was tightened with it. `MAIL_WAIT` now applies only when the agent has post of their own inbound (`ownPost ? MAIL_WAIT : 0`), because an agent collecting unaddressed mail is fetching something that was already in the box — there is no plane to wait for, so losing the race should not cost them twenty seconds of standing about. A timeout of `0` still checks the predicate once, since the runner evaluates it before the clock.

### 8.2 A lost envelope loops its recipient forever — *fixed*

If `MAIL_WAIT` expired, `_collectMail` took `null`, set `hasMaterial = true` and carried on — but nothing decremented `inFlight`. So `hasOwn` stayed true, the agent sat down, `_checkPost` fired on the next frame, and they got straight back up. Forever.

Planes always land in practice, so this was latent rather than live; it would have stopped being latent the moment a payload was stranded in `mail.waiting` by a teardown, or `QUEUE_MAX` was raised. `_collectMail` now gives up explicitly when a trip comes up empty:

```js
if (!item) {
  this.post.abandon(rec.agent.id);
  rec.hasMaterial = true;
  return;
}
```

`Post.abandon` clears every expectation standing for that agent and reports how many there were. Clearing all of them rather than one is deliberate: any plane genuinely in the air would have landed inside 1.45 s, so after a 20 s wait every outstanding expectation is stale by definition. It stays correct if one lands late anyway — `land` puts a late envelope in the box regardless, and an envelope waiting there is enough to bring its recipient back.

### 8.3 Binned post is invisible

An envelope orphaned by a departure vanishes from an array. Nothing goes in the bin, no crumple appears, and — the real cost — **no `removal` entry reaches the job log**, so a request that was genuinely dropped leaves no trace anywhere in the UI. The same is true of an envelope dropped for a full queue, which is the one case where the office has actually lost a prompt and most deserves to say so.

The cheap fix is a `_emitFeed({ kind: 'removal', ... })` on all three routes in §6. The nice one is to make the metaphor whole: someone clears the box and walks the dead letter to the bin.

### 8.4 Desk starvation strands post indefinitely — *fixed*

`_work` opens with `if (!desk) return this._wait(rec)`. But `waiting` was not one of the `settled` statuses, so `_checkPost` would not retry, and `_wait` parks the agent for `HOLD` — 3600 s. An agent with addressed post waiting and no free desk never collected it, and the flag stayed up for an hour. The same gap stranded an agent standing up mid-job because the editor deleted their desk (see `_dropVanished`): `working` but no longer `seated` isn't `settled` either, so nothing retried them.

The room is authored with five desks, and the headcount cap is now the desk count (`agentCapacity()`), which `MockSource` respects — but `AopSource` does not: six concurrent sessions is enough, and TRO-4 made it easy to fill one office from several sources at once. Adding desks in the editor raises the ceiling; it did not close this hole.

Fixed with a dedicated `_checkDesk(rec)`, run from the frame loop alongside `_checkPost`: any agent with no desk of their own, in either stuck state (`waiting`, or `working`-and-unseated), retries `_claimDesk` every frame and resumes via `_work` the moment one comes free — whether that desk was freed by a departure or added in the editor. Left `settled` alone rather than adding `waiting` to it, since `_checkPost` also gates on addressed post specifically (`post.hasOwn`), which doesn't cover an agent still waiting on generic inbox material.

### 8.5 Unaddressed post has no owner and no expiry

`dropFor` is keyed by recipient, so unaddressed envelopes survive every departure. Empty the office and the flag stays up over a box nobody will ever open again. `pending` is unbounded too — the box shows six letters but counts without limit — and nothing collects unaddressed post except an agent who happens to need material.

Worth deciding explicitly: a TTL on unaddressed post, a sweep when the room empties, or an idle agent who takes unaddressed post as well as their own.

### 8.6 Two counters for one box — *fixed*

`post.pending.length` and `mailbox.pending` were the same quantity, kept in step by four hand-written compensations — including a `for` loop of `collect()` calls in `_remove`. Any new path that removed an envelope had to remember to do this, and forgetting showed up as a flag stuck up or letters that did not match.

The prop now derives its counts from the model. `AgentManager.update` calls `mailbox.setWaiting(post.countBySize('letter'), post.countBySize('package'))` once a frame, and `receive()`, `collect()` and every compensation are gone with it — including the one in `MailFlights`. The cost is a frame of latency, which is invisible; the gain is that adding the parcel pile needed no new bookkeeping at all.

### 8.7 The loser of a race carries a phantom package — *fixed*

Two agents can set off for one unaddressed envelope — the comment in `post.js` says this race is real and intended. But `carry('package')` was pushed onto the action list unconditionally, before anyone knew who would win, so the loser walked back to their desk visibly carrying a package they never picked up.

The two channels forced this open, because the carryable is not knowable when the walk is planned: whether an agent ends up holding an envelope or a crate depends on what is in the box when they get there. So `carry` now accepts a function, resolved when the action runs — the same way `walk` has always resolved its destination — and `_collectMail` sets the carryable itself from what it actually took, or clears it when it took nothing.

### 8.8 The two flags disagree

`mailbox.deliver()` holds the 3D flag up for 5 s to acknowledge outgoing work; the overlay sets its flag from `pending` alone. For five seconds after every delivery the room and the panel say different things. Whichever is right, they should agree — probably by giving the panel the same brief acknowledgement.

### 8.9 `hasMaterial` is a third source of truth

`rec.hasMaterial` duplicates what `post` and the inbox already know, and is set optimistically in the two places where nothing was actually collected (§8.2, §8.7). It is the flag most likely to drift. Deriving "do I have something to work on" from the job log — the agent already tracks an open job — would remove it.

### 8.10 No tests

The story asks for `post.js` to be free of Three.js *so that it is testable without a browser*. It is free of Three.js, and there is no test file, no `npm test`, and no runner in `package.json`. Every bug in §8.1–§8.7 is reachable in a dozen lines of pure `node --test` against `post.js` plus a stub manager: the race, the departure mid-flight, the lost envelope, the non-recipient's walk.

That is the highest-leverage thing left on this story, because it is what stops the next change quietly breaking the ownership rules.
