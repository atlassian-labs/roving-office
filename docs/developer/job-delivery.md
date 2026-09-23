# Job delivery

*The mailbox machinery: how a request gets from a harness into an agent's hands, how
finished work leaves again, and what happens to work that fails or is never collected.*

What a reader sees of all this — the plane, the courier, the flag, the bin — is
[post, parcels and the bin](../user/work-and-post.md). This page is the model underneath
it.

The **mailbox** is both the in-tray and the out-tray: letters land in the slot, parcels stack on the floor beside it, and finished work is walked back and dropped in. Its red flag means *there is work waiting*, whichever shape that work is in. The **inbox** — the stack of cardboard boxes — is the fallback source of material when no post is waiting. The **bin** takes work that errored. Every one of those is a station in `src/layout.js`, and the behaviour that walks to them lives in `src/agents/AgentManager.js`.

The ownership rules are deliberately separate, in `src/agents/post.js`, with no Three.js in them.

Files worth having open:

| File | What it owns |
| --- | --- |
| `src/agents/post.js` | Who may open which envelope, and how big it is. Pure logic, no scene. |
| `src/agents/AgentManager.js` | Turning events into walking about. |
| `src/scene/mail.js` | The paper airplane flight and its queue — letters. |
| `src/scene/courier.js` | The courier, the throw and its queue — packages, by stoop, stairs or lift. |
| `src/scene/approach.js` | The stoop and the staircase: where the steps are, and the routes over them. Shared by the builder, the courier and the agents. |
| `src/scene/props/mailbox.js` | The mailbox flag, letters, parcel pile, and the bin's crumples. |
| `src/data/AopSource.js` | Which harness events become which office events. |
| `src/ui/overlay.js` | The Job Delivery / Job Removal panel. |

---

## 1. The two kinds of post

A single mailbox holds two kinds of envelope, and the difference is about ownership rather than looks.

**Unaddressed** (`forId: null`) is work nobody owns yet — a queued ticket, a scheduled job. The first agent to reach the box takes it, and that race is real: two agents can set off and only one can win. This is what an AOP `job.queued` event becomes, and what a fifth of `MockSource`'s requests are, so the race stays exercised offline.

**Addressed** (`forId` set) is a prompt typed into one specific session. Only its recipient can open it, so nobody else should so much as walk over.

The crucial design decision is *when* addressing happens: at **posting** time, not at collection time. `Post.post(forId)` bumps an in-flight counter the moment the envelope is sent, before the plane has moved:

```js
post(forId = null) {
  if (forId) this.inFlight.set(forId, (this.inFlight.get(forId) ?? 0) + 1);
}
```

That is what lets the room be honest about work in flight. The request exists the moment it is made, so its recipient can get up, walk over, and *wait at the box* for a plane that has not landed yet. Only the animation lags; the simulation never lies about what has been asked for. It also means the plane can be tinted with the recipient's colour in flight (`ADDRESS_TINT` in `mail.js`), so you can see from across the room who a request is for — a name on an envelope.

## 1a. How it arrives, and why that means nothing

Work arrives by air as a paper plane through the window, by courier as a parcel thrown in through the door, or — in a room with a printer — out of the machine as a fax. **Which one is a draw that nothing about the work enters into** — `arrivalFor()` in `post.js`, walking `ARRIVALS` by `ARRIVAL_WEIGHTS`.

The weights are `letter: 2`, `package: 1`, `fax: 1`. The mailbox counts double because the window is the room's front door for work — it is the arrival with the flag, the pile, and two vehicles of its own — and an even three-way split had the thing people watch for arriving a third of the time. It is emphatically not a claim that a letter *means* more than a parcel; the weights are about which animation is worth seeing most often, which is a question about the room rather than about the job. An unlisted channel weighs 1, so a new way in draws from the day its string is added, and the shares renormalise over the pool `enabledArrivals` hands over rather than reserving anything for a channel the room does not have.

It used to say something, and the reason it stopped is worth keeping. Small work came as a letter and big work as a package, decided by `sizeOf(job)`: word lists of "refactor" and "migrate" against "typo" and "bump", a square-rooted lean on the title's length, clamps at both ends, a tuned `PACKAGE_SHARE` of 0.18 to land the observed share near a quarter. Eighty-odd lines, carefully built, and all of it a **guess** — because the feed carries a line of text and nothing else, so there was no signal to read.

Two things were wrong with it:

- **A wrong guess is worse than no guess.** A room that shows work as "big" is making a claim, and a claim nobody can check is noise wearing the clothes of information. The inference was wrong often enough to notice: "port the config" is a crate, "important note" nearly was.
- **The distinction was not real.** A letter and a parcel are the same thing — a job — and everything downstream already treated them identically. The only thing the inference bought was two animations chosen for a bad reason.

So the animations stayed and the meaning went. Both channels are equivalent ways into the same mailbox, and the courier is not a different class of delivery — he is the mailbox, on foot. What an agent carries still matches how it arrived, so work that came by air is delivered by air and binned as a letter, but that is consistency rather than significance.

The arrival is settled in `_post`, before anything leaves, because it decides which channel the work travels by. A source may state it outright (`ev.arrival`), and exactly one kind of thing does: the mail buttons in the pilot panel, which exist to show each channel on demand.

**Adding a third way in is a string and an animation.** A printout or an incoming fax joins `ARRIVALS` and needs no rule to learn about it — which is the whole benefit of the channel meaning nothing.

### The letter's other vehicle: the bird

A letter has a *vehicle* as well as a channel, settled in the same place and by the same kind of draw: two letters in three by paper plane, the third by **bird** (`scene/birds.js`). The bird flies in through the window along a bezier, hovers over the box while the letter drops from its talons, and flies back out — phased as `MailFlights` is, and announcing the arrival at the drop rather than at its own exit, because the drop is the touchdown.

### Threading the window, and why the wings tuck

A plane can go through a window without anybody checking the numbers. A bird cannot, and this is the part worth reading before touching the flight path.

The opening is not a hole. It is three lights by two, so there are **two mullions and a transom in the middle of it** — and a bird with its wings out is about 3.1 units across against a light 2.1 wide. Two things follow, and the birds shipped without either:

- **It has to aim at a light, not at the window.** The centre of the opening *is* the transom. `windowLight()` in config.js returns one light's clear rectangle, inset by half a bar on the divided edges and half the frame on the outer ones; the birds use the middle light of the top row (`LIGHT` in `birds.js`), clear of both jambs and high enough to come in over the desks. The glazing bars moved out of `buildWindow()` into `WINDOW_LIGHTS` at the same time, because a builder that divided the glass differently from what the birds asked about would put them straight through timber — which is what it was doing.
- **It has to fold.** `poseWings()` sweeps both wings back at the shoulder by up to 72°, keyed off distance from the wall plane (`tuckAt`) rather than off the curve's own `t`, so a change to the path cannot leave a bird arriving at the frame half-folded. Tucked, the widest species measures 1.67 across. The beat is damped by the same factor, because a tucked wing still flapping reads as a glitch rather than a glide. This is a gesture with a job, not decoration: without it there is no route through this window at all, which is what `test/bird-window.test.js` asserts first.

The crossing is kept square by putting **both** middle control points of the bezier on the light's centre line. With them coincident there, the curve's drift off the line is the cubic's last term alone — `t³` — so the bend has barely started by the time the bird's tail is out of the frame. A single control point on the line was not enough: the bank was already underway with the tail still in the opening, and the wingtip cleared the near mullion by −0.01. It has to hold for a mailbox dragged anywhere in the room, so it cannot be a path tuned against the default layout.

### One bird at a time

The courier's rule, for the courier's reason. Planes get away with four at once because a dart can pass a foot from another dart; birds converge on one hole in one window and then on one slot in one box, so two at once were not near each other but **inside** each other. `POOL_SIZE` is 1 and the rest of the letters queue, so a burst trickles in a flight apart — about two and a half seconds — and the tally on the box is the same either way.

The flight was slower than that when the queue arrived, and the two compounded into "the birds are sluggish". `IN_TIME` and the three beats beside it now run at 1.75× the pace they were first flown at, which is a shorter wait for a queued letter as well as a quicker bird. The travel wingbeat scales with them; the hover's flutter does not, because that one is about holding still.

Three things about it are worth knowing, and they are all consequences of the channel meaning nothing:

- **It is a vehicle, not a channel.** Nothing downstream can tell. What lands is a letter — same box tally, same envelope in the collector's hand, same word in the log — and the letter mesh is tinted for its recipient the way an addressed plane is, so who a request is for survives the change of courier. Adding it needed no new arrival, no new rule, and no change to the collect-and-bin path.
- **A feed may name it** (`vehicle: 'bird'` on a `mail` event), which is what the pilot's **Job by bird** button does. Naming the bird names the channel too: `_post` reads `vehicle: 'bird'` as a request for `letter`, because a coin toss that could hand an explicitly-asked-for bird to the courier is a toss outranking an instruction. Left unsaid, `ev.vehicle == null` falls to the `BIRD_SHARE` draw — one letter in three.
- **The room outranks the feed.** The draw is gated on `CHANNELS.birds`, so with the aviary switched off even a feed asking for a bird gets the plane. That is the courier switch's rule, for the courier switch's reason: the switch is a fact about the office, and a request cannot argue with the room.

Which bird flies is the one decision `birds.js` makes for itself. `CHANNELS.birdKind` is `'roster'` by default, and `rosterBird()` draws it per flight off `OWL_SHARE`: the owl takes **0.75 of the night** (`NIGHT_FROM` to `NIGHT_TO`, 19:00–07:00 off `worldClock`) and **0.5 of the day**, and whatever is left goes to one of `UNDERSTUDIES` — pigeon, kookaburra, raven — drawn evenly. Evenly on purpose: a weighted tail would be three more numbers to tune in exchange for a difference nobody watching the room could detect. Two tosses rather than one, because reusing the first roll's remainder would correlate the understudy with how narrowly the owl missed. Or set any of `BIRD_KIND_OPTIONS` to pin every flight to one species, day and night, because a chosen bird is the office's choice and the clock cannot overrule it. It rides in `CHANNELS`, so it is committed through the editor's `commit`, undoable, and saved with the room.

## 1b. The courier

One delivery at a time, because two couriers sharing a doorway reads as a bug even when the queue behind them is honest. Anything asked for mid-round waits in `courier.waiting`.

The beats are `approach → heave → throw → leave`: in from off-stage, a wind-up over the shoulder while the door swings, a flat parabola across the room, then back out the way he came. He does not throw from the threshold — he takes **two paces inside the room first**, at every entrance, because a delivery man lobbing a parcel from a doorway is a silhouette and the point of him is that he can be seen. `INSIDE` is picked to clear the coat stand, so the pace in lands on open floor. It used to have to dodge the bin's approach lane as well; the bin has since moved to the back wall, which leaves the courier the only thing standing inside the doorway on purpose. He gets away with it where the bin did not because he stands 0.89 off the open leaf's centre plane rather than 0.26 — clear of it by better than a body's half-width — and because he holds the door open himself (`_holdDoor`) rather than tripping the proxy that used to open it on anybody standing nearby.

He is built to an **agent's measurements** — hips at 0.9, shoulders at 1.78, a 0.62 head at 2.2 — and not to his own. He used to be a two-thirds-scale version of all of it, which made a grown man delivering to an office look like a child on the doorstep; the door is the one place in the scene where two human figures stand next to each other, so it is the one place a scale mismatch has something to be measured against. He is still not an `Agent`, and should not be: no name tag, no status ring, no work log, no crowd. He is scenery that walks.

And he walks **briskly** — `WALK` is half again what an agent manages, because the round is the job and a delivery man who ambles in reads as somebody who works here. `RUN` and `STEP` are pinned to it as multiples rather than set independently, since what sells them is the ratio: stairs faster than the flat, the pace through the doorway slower than the approach. Leg swing is per unit walked, so a faster pace is more steps a second rather than a longer stride — wound back from 2.0 to 1.5 radians when the walk sped up, because at the new pace the old figure was a blur of legs.

### One route per entrance

The three entrances differ only in the *route walked*, not in the phases. A route is a list of points, each carrying the speed of the leg that arrives at it, timed once at the start so every frame is a lookup:

| Entrance | Route |
| --- | --- |
| `stoop` | round the outside corner of the building → along the wall → up onto the landing → inside |
| `stairs` | along the pavement a storey below → the foot of the flight → **up it at a run** → the landing → inside |
| `elevator` | ride the car up (`summon`) → out of it → inside |

The way out is the same route reversed, which is where a speed belonging to a *leg* rather than a point earns its keep: reversing the points alone would take the flight at the pavement's walk and the doorway at a run, so each point inherits the speed of the point that followed it (`Route.reversed`).

Legs run at a constant speed rather than easing across the whole trip, because the speeds *are* the performance — a run up the flight between a walk along the pavement and a step through the door. Easing the lot flattens the three back into one. Leg swing is driven by distance covered, so a faster pace is more steps a second rather than a longer stride.

Where the steps are is **not** the courier's to decide: `scene/approach.js` works out both the stoop and the flight once and hands the same descriptors to the builder, to the courier and to the agent layer (see [buildings-and-themes.md](../user/buildings.md#the-way-in-is-part-of-the-building)).

The stoop route is the one that changed most. The courier used to appear on open pavement past the end of the stoop, in plain view — a delivery man popping into existence mid-street. He now comes round the **outside corner of the building**, where the two standing walls meet: from the diorama's camera that corner is the one piece of the exterior the building hides from itself, so he walks out from behind it and the arrival has somewhere to have come from. He walks it at pavement height and steps up onto the landing, rather than gliding in a metre above the kerb as he did before.

The door needed nothing new — it has had a hinged leaf and `requestOpen` since agents started walking through it (`environment.js`) — but the hold did. How long the courier is inside now depends on a throw whose length depends on the room, so instead of booking a duration up front he renews a short hold every frame from `DOOR_LEAD` before the doorway until he is back out through it. A lift's landing doors answer the very same call, since `handles.door` and `handles.elevator` are one object, and asking a lift to open also summons it — which is exactly what is wanted while standing on its floor.

The throw is timed and shaped from the distance it actually has to cover. Both used to be constants tuned for a parcel launched from the threshold; from inside the room the throw is a good deal shorter, and the old numbers made it a slow, towering lob over four units.

The lift wait is bounded at `LIFT_WAIT`, and this is the one thing worth being careful about. If the car never comes the courier steps out onto the floor and throws anyway, because the parcel arriving late through a shut door is a room that has fallen behind reality, while a parcel that never arrives is a request the office has silently lost. The audit in §8.2 is the same lesson learned at the mailbox.

## 2. State, and where it lives

Five pieces of state describe the mailbox, which is four more than ideal (see §8.6).

| State | Lives in | Meaning |
| --- | --- | --- |
| `post.pending[]` | `post.js` | Envelopes in the box, oldest first. |
| `post.inFlight` | `post.js` | id → how many envelopes for them are airborne. |
| `mail.waiting[]` | `mail.js` | Payloads with no free plane yet (pool is 4). |
| `courier.waiting[]` | `courier.js` | Packages waiting for the courier to come back. |
| `mailbox.waiting*` | `props.js` | *Derived.* Told once a frame what the model holds. |
| `rec.hasMaterial` | `AgentManager` | Does this agent have something to work on? |
| `rec.workSize` | `AgentManager` | Which size they are carrying, so it leaves as it came. |

The mailbox no longer keeps its own tally. `AgentManager.update` reads `post.countBySize()` and hands it over with `setWaiting(letters, parcels)`, so the flag and the meshes cannot disagree with the model — see §8.6.

## 3. New work arriving

### 3.1 The sequence

```
harness event                     AopSource._reduce
  turn.start        ──▶  { type:'mail', job, forId: sessionKey }   addressed
  job.queued       ──▶  { type:'mail', job }                      unaddressed
                                        │
                                        ▼
                          AgentManager._post(ev)
                            ├─ recipient not in the room?  drop, silently
                            ├─ post.post(forId)            count it in-flight
                            └─ mail.launch(payload)
                                 ├─ free plane   → fly (1.45 s)
                                 ├─ pool busy    → mail.waiting (max 16)
                                 └─ queue full   → false → post.unpost(forId)
                                        │
                                    touchdown
                                        ▼
                          MailFlights.update
                            ├─ mailbox.receive()      flag up, letter appears
                            └─ onArrive(payload)
                                        ▼
                          AgentManager._mailArrived
                            └─ post.land({job, forId}, isPresent)
                                 ├─ recipient gone → false → mailbox.collect()
                                 └─ pushed to pending → emitFeed('delivery')
```

A `delivery` entry carries the recipient with it — `for` is their name and `forColor` their colour — so the panel can say who an addressed envelope is for: a dart in that colour and their first name, on the same line as the time. The colour is the one the plane wore across the room, and the surname is left off because it is this office's word for the job, which the line below is already spelling out. Unaddressed post has nobody to name, and shows the time alone.

Both facts are copied onto the entry rather than left as an id for the panel to resolve, because an entry is a record of a moment: the line should still name its recipient after they have gone home.

Note that `turn.start` sends the job *inside* the envelope rather than setting it on the agent. The desk label changes when the agent opens the envelope, not when the event arrives — which is the whole point of the envelope. Prompts used to retitle a desk silently, so new work was nearly invisible.

**A turn is not automatically a new job.** The first substantive request earns the
session's stable job label. Acknowledgements, referential corrections ("make it
smaller") and routine packing-up turns (tests, commit, worktree cleanup) carry that
same label through the mailbox instead of quoting the latest message onto the roster.
An explicit boundary such as "new job" or "switch to", and a plainly substantive
unrelated request, replaces it. This is deliberately conservative: losing a real job
to conversational chatter is much more misleading than leaving a short-lived follow-up
under the heading it qualifies.

### 3.2 Deciding to go and fetch it

Two things start a mail run. The first is a `working` status arriving while the agent has nothing to work on. The second — the interesting one — is `_checkPost`, called for every agent on every frame:

```js
_checkPost(rec) {
  if (rec.onMailRun) return;
  const settled = rec.agent.status === 'idle'
    || (rec.agent.status === 'working' && rec.agent.seated);
  if (!settled) return;
  if (!this.post.hasOwn(rec.agent.id)) return;
  this._work(rec);
}
```

Three guards, each earning its place:

- **`onMailRun`** is set by `_begin`, so exactly one owner declares "this action list is a trip to the box". The controller runs roughly one action per frame, so for a frame or two after a mail run starts the agent is still `idle` with post waiting. Anything that cleared the flag from inside an action let `_checkPost` rebuild the walk from the top on the next frame, and the agent restarted forever without taking a step.
- **`settled`** means seated and working, or standing about with nothing on. Interrupting a walk, a permission wait, a bookshelf trip or a coffee run would replace the action list mid-stride. Every one of those states ends in a status change that comes back here anyway. `idle` counts on purpose: a turn that ends before its envelope was collected used to strand the post in the box with the desk label never set.
- **`hasOwn`** is **addressed post only**. Unaddressed mail keeps its looser meaning — picked up on the way to a job by whoever is going anyway — so it must not drag a seated agent out of their chair.

Driving this from the frame loop rather than from the event is what makes the interruption safe: here the agent is provably settled. A queue that outruns the walking is fine and expected — five prompts in five seconds is five trips, taken in order, and a single trip that collected the whole stack would be faster and less true. The room falls behind reality rather than lying about it.

### 3.3 The walk

`_work` builds one action list (`_work` in `src/agents/AgentManager.js`):

```js
const ownPost = this.post.hasOwn(rec.agent.id);
if (ownPost || !rec.hasMaterial) {
  const fromMailbox = ownPost || this.post.canCollect(rec.agent.id);
  const station = fromMailbox ? STATIONS.mailbox : STATIONS.inbox;
  ...
  if (fromMailbox) {
    waitUntil(() => this.post.canCollect(rec.agent.id), ownPost ? MAIL_WAIT : 0)
    wait(0.35)
    act(() => this._collectMail(rec))
  } else {
    wait(0.6); act(() => { this.props.inbox?.takePackage(); rec.hasMaterial = true; })
  }
  actions.push(carry('package'));
}
// then: walk to desk, sit, setWorking(true), status 'working', wait(HOLD)
```

Airmail first, since that is the freshest request; the inbox stack only if the box has nothing this agent may open. Note that the station is chosen with `canCollect` rather than `size`: a box holding only somebody else's envelope is, for this agent, an empty one, and they head for the inbox instead.

The `waitUntil` is the honest move — the request exists, so the agent stands at the box until it lands rather than pretending it already had. `MAIL_WAIT` is 20 s against a 1.45 s flight, generous enough that it only ever expires if something upstream dropped the envelope. It applies only to post of their own: an agent who came over for unaddressed mail is fetching something already in the box, so if they lost the race the predicate is checked once and they carry on rather than loitering at a box with nothing in it.

### 3.4 Opening it

`_collectMail` is where the label finally changes:

```js
const original = rec.agent.currentJobLabel();
if (rec.agent.renameOpenJob(item.job)) {
  rec.jobAlias = { from: original, to: item.job };   // remember the swap
} else {
  rec.agent.job = item.job;
  rec.agent.beginJob(item.job);
}
```

Retitle rather than begin where possible: the agent was already logged as starting work, and this request is what that work turned out to be. With no job open — a first prompt, or one collected after a delivery — it opens a new entry instead, so the log never loses a request.

`jobAlias` then survives the feed re-announcing the original title, which it does after a bookshelf trip (`handleEvent`, `case 'job'`).

The completion summary does not replace `agent.job`. It is the agent's answer, not
the assignment; keeping it on the delivery/log side is what stops an idle roster from
turning into a transcript after every `turn.end`.

### 3.5 Arrivals are limited by free hands, and the plane pool

Mail posted on a blind timer builds an unbounded queue: it lands at ~5.8/min against an office throughput of ~4.9/min. The mock source used to be handed a `getBacklog` callback and hold off while the box was full; it now posts each request **to somebody who is free**, and simply waits when nobody is. That is the same brake with the cause rather than the symptom in it, and it needs nothing from the room — the simulation is what is keeping everybody busy, so it already knows (see [Test Data](test-data.md)).

Pressing **T** ignores that deliberately — someone asking for a job by hand has already judged it for themselves.

Planes are **pooled, and the pool can be outrun**. Four planes carry a 1.45s flight, which no timer could ever exhaust, but one keypress can: press **T** five times in a second and the fifth finds every plane airborne. `MailFlights.launch()` therefore holds the overflow and sends it as planes land, in request order, rather than dropping it — a job that vanished because the animation was busy would read as the office having swallowed it. It only refuses (returning `false`) once even the waiting list is full, and §6 covers what happens to the envelope then.

## 4. Finished work leaving

`turn.end` with `status: 'completed'` becomes a `dispatch` event, and `_deliver` walks the work to the mailbox:

```
release desk ▸ carry('package') ▸ status 'delivering' ▸ walk to mailbox
  ▸ face ▸ wait 0.7 ▸ mailbox.deliver()
                       hasMaterial = false
                       agent.finishJob('done')
                       jobAlias = null
  ▸ carry(null) ▸ wait 0.4 ▸ status 'idle'
```

The `finishJob('done')` fires inside the `act`, at the moment the work actually hits the box, not when the walk began.

If the round had a checklist, its final snapshot is retained on that one history entry
before the live plan disappears. **Recent jobs** puts the completed fraction beside the
outcome — *Done (5/5)* — and makes that row expandable so each completed, skipped,
failed or cancelled part remains inspectable. A job without parts has no disclosure
control and looks exactly as it did before checklist history existed.

**`dispatch` the event and `delivering` the status are different things**, and confusing them would mark work finished every time an agent ran `git push`. A `delivering` status — which `AopSource._toolStart` emits for a push or a commit — routes to `_postRun` instead: the same walk to the same box, `mailbox.deliver()` all the same, but the desk stays booked and the agent sits back down with the job still open. An errand, not a finish.

Outgoing work does not add a letter to the box. `mailbox.deliver()` only sets `_hold = 5`, which keeps the flag up for five seconds as an acknowledgement:

```js
deliver() { this.deliveries++; this._hold = 5; },
receive() { this.received++; this.pending++; this._syncLetters(); },
collect() { if (this.pending === 0) return false; this.pending--; ... },
update(dt) { const up = this.pending > 0 || this._hold > 0; /* ease flag */ }
```

So the 3D flag means "post waiting **or** something just went out", while the overlay's flag means only "post waiting". They disagree for five seconds after every delivery.

## 5. The bin

`_discard` runs on an `error` status — from `turn.end` with `status: 'error'`, a bare `error` event, or any harness error:

```
release desk ▸ status 'error' ▸ wait 1.2 ▸ carry('package')
  ▸ walk to bin ▸ face ▸ wait 0.5
  ▸ bin.discard()                    a crumple appears (3 meshes, cycled)
    hasMaterial = false
    label = agent.currentJobLabel()
    agent.finishJob('error')
    emitFeed({ kind:'removal', job: label, by: agent.name })
  ▸ carry(null) ▸ wait 0.4 ▸ status 'idle'
```

The `wait(1.2)` before picking the work up is the pause where you realise it has gone wrong. As with delivery, the log entry lands as the paper hits the bin.

A `removal` entry relabels the whole overlay section to "Job Removal" and names what was binned; the flag it sets still reflects the mailbox, not the bin. The bin takes both sizes and crumples them the same way, which is the one place the two are deliberately not told apart — what went wrong matters more than how big it was.

Collections name the size too: "Nova took a letter", "Zephyr took a package", falling back to "took one" where the size is unknown. That line also now survives the box emptying — before, a collection that left nothing behind lowered the flag and printed "Mailbox is empty", so the last thing taken was the one thing never announced.

**The bin only ever receives work an agent carried to it.** Post that is binned in the data model — orphaned by a departure, dropped because the flight queue was full, or landed for a recipient who had already gone — is deleted from an array with no crumple, no walk, and no feed entry. See §8.3.

## 6. Post that is never collected

Three routes bin an envelope without anyone touching it.

**The recipient leaves.** `_remove` calls `post.dropFor(id)`, which filters the array and clears the in-flight count, and then compensates the prop by hand:

```js
const orphaned = this.post.dropFor(rec.agent.id);
for (let i = 0; i < orphaned; i++) this.props.mailbox?.collect();
```

**The recipient left while the plane was airborne.** `post.land` takes an `isPresent` predicate and returns `false`, and `_mailArrived` calls `mailbox.collect()` to undo the `receive()` that touchdown already did. Without that, the flag would stay up over an envelope nobody could ever open.

**The flight queue was full.** `mail.launch` returns `false` past `QUEUE_MAX = 16`, and `_post` calls `post.unpost(forId)` so the recipient is not left waiting at an empty box.

And one route gives up on an envelope that was never in the box to begin with. **The recipient waited and nothing came.** If `MAIL_WAIT` expires, `_collectMail` finds nothing to take and calls `post.abandon(id)`, which clears every expectation standing for that agent. This matters more than it looks: `hasOwn` is what sends an agent to the box, so an expectation left standing after a failed trip would send them back on the very next frame, and the frame after that, forever. Giving up is safe against a plane that lands late, because `land` puts a late envelope in the box regardless and one waiting there is enough to bring its recipient back.

## Read next

- [Post, parcels and the bin](../user/work-and-post.md) — the same system, as a reader meets it
- [Architecture](architecture.md) — where this sits in the pipeline
- [The physics of the office](physics.md) — why a destination is a place and not a point
