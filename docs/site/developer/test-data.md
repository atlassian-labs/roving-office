# The Test Data source

*The simulation, and the test rig. What it looks like to watch is
[Test Data](../user/sources/test-data.md).*

`src/data/MockSource.js`. It is the default deliberately, and it is also how the scene, the
themes and the whole UI get exercised — all four authored offices use it, so anything
visual can be checked without a harness anywhere near the machine.

## The post is what drives it, not a timer

`MockSource` does not hand out work on a timer and hope the scenery keeps up. **A request
is posted to somebody who is free**, and what they spend the next minute on is whatever was
inside that envelope.

That is worth stating plainly because the obvious alternative is wrong in a way that is
hard to see. A feed that announces one title while the mailbox delivers another leaves the
room technically busy and completely unreadable: the plane you watched land is not the work
anybody is doing, and no single piece of work can be followed across the floor.

Since the simulation is the thing keeping everyone busy, it always knows who is free — so
posting a request *to* somebody is both truer and simpler than posting one into the air and
throttling the queue afterwards.

## The constants are all in one place

Roughly, per request: half involve a look-up, a fifth a wait, an eighth fail, a fifth
arrive unaddressed, and three in ten are big enough to come by courier. All of it is in the
constants at the top of the file, **which is the only place to change any of it.**

## Two arrival gaps make the shape of a day

Short-handed, the next arrival is seconds away; at or above the regulars it is half a
minute off — so the climb to a full room is a slow one and a vacated desk stays vacated for
a bit.

Departures are not a coin toss after every delivery either: everyone walks in with a
**shift** of two to four requests and leaves when it is done, unless they are one of the
regulars holding the room, in which case the shift quietly extends.

The floor and the ceiling are the office's own `startCount` and the desk count (see
`src/projects.js`), so a room authored with four regulars simply wanders in a narrower
band.

## Naming, and why it stopped being cute

Mock agents used to draw from a short playful pool — `Rovo`, `Pixel`, `Vex` — so test data
was recognisable at a glance. They now go through **exactly the same naming as a live
session**.

Two reasons. The naming is one of the nicer things the office does, and the default view of
the product was the one view that never showed it. And the `rename` path — a person keeping
their identity while their job changes — is **only exercised by a feed that renames
people**, which no other source does offline.

Nothing is lost in telling them apart, because the name was never the honest signal: every
agent wears its source's mark, and the badge says `Test Data · simulated`.

This is also why the sample requests are worded as **instructions with a plain noun in
them** — `Sort the support queue`, `Merge the customer reports`. A title of pure jargon is
deliberately refused a surname (see `src/agents/names.js`), so a pool of
`Refactoring auth module` would leave the whole room surnameless.

## `sendJob`, and why T is feature-detected

**T** posts a request by hand, addressed to whoever is free — or unaddressed into the box
if nobody is.

The binding is feature-detected on `source.sendJob` rather than hardcoded to the mock, so
it disappears from the keyboard *and* from the `?` panel unless some source in the office
can actually invent one. Inventing a job on a purely live office would misrepresent the
agents. Keep Test Data ticked alongside a live feed and **T** stays available, which is a
genuinely useful pairing while an adapter is still being set up.

It also deliberately ignores whether anybody is free. Somebody asking for work by hand has
already judged that for themselves, and a keypress that quietly declined would just look
broken.

## Only one office can hold the endpoint

Nothing about Test Data needs the receiver, which makes it the right choice for a second
server. Only one process can hold `~/.roving-office/endpoint.json`, so a second instance
serves the UI but receives no adapter events at all — point that one at Test Data and it
behaves perfectly.

## One pool, not two

Work flies in as a letter or is brought to the door by a courier, and which one is a coin
toss made when the envelope is posted — so **both channels come up on their own** over any
run worth watching.

The simulation used to *state* it, from two pools of sample titles split by size. There is
one pool now, because a parcel and a letter are the same job arriving by different doors.
See [job delivery](job-delivery.md).

## Read next

- [The source model](sources.md) — how several feeds share one room
- [Job delivery](job-delivery.md) — the mailbox this source posts into
- [Extending the office](extending.md#add-a-source) — adding another one
