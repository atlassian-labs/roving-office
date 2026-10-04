# Test Data

*The simulation, and the default. Nothing to install.*

A fresh office opens onto a busy room with nothing installed, nothing running and no
adapter configured — because **a room with nobody in it is indistinguishable from a room
that is broken.**

It is also how everything visual gets checked, so all four
[authored offices](../buildings.md) use it.

## What a simulated shift looks like

| | |
|---|---|
| **arrive** | climb the stairs, hang a coat, settle in — not available for work until they are actually in |
| **intake** | a request lands addressed to them; they fetch it from the box and take it to their desk |
| **look up** | sometimes: the bookshelf for what the company knows, the globe or telescope for what the web knows |
| **wait** | sometimes: blocked on you |
| **fail** | occasionally: the work is binned, and that is the end of it |
| **post** | the finished work goes in the mailbox |
| **break** | a drink or a sit down, then the next request |
| **clock off** | after a handful of requests, out the door |

Roughly, per request: half involve a look-up, a fifth a wait, an eighth fail, a fifth
arrive unaddressed, and three in ten are big enough to come by courier.

**The post is what drives it.** A request is posted to somebody who is *free*, and what
they spend the next minute on is whatever was inside that envelope — so the plane you
watched land is the work you can then follow across the floor.

## The room fills and empties like a real one

The headcount is the shape of a day rather than a number. The office **opens with its
regulars**, fills up **slowly** over the next couple of minutes as the extras drift in,
and from then on **wanders between the two**: somebody's shift ends, and a while later
somebody else turns up.

Everyone walks in with a shift of two to four requests and leaves when it is done — unless
they are one of the regulars holding the room, in which case the shift quietly extends.
**An office that empties reads as one that is broken**, which is the whole reason this
source exists.

In a five-desk office opening with three, that works out at roughly a fifth of the hour at
three people, half at four, a third at five, and never fewer than three.

## They are named the way real sessions are

Simulated agents used to draw from a short playful pool — `Rovo`, `Pixel`, `Vex`. They now
go through [exactly the same naming as a live session](../agent-names.md),
so `Fix the flaky checkout test` makes somebody `Flaky-Mender`.

Nothing is lost in telling them apart, because the name was never the honest signal: every
agent wears the mark of the source it arrived on, and the badge says
`Test Data · simulated`.

## Pressing T

**T** posts a request by hand, addressed to whoever is free — or unaddressed into the box
if nobody is. It **deliberately ignores whether anybody is free**: somebody asking for work
by hand has already judged that for themselves, and a keypress that quietly declined would
just look broken.

Keep Test Data ticked alongside a live feed and **T** stays available, which is genuinely
useful while you are still getting an adapter working.

## Handy for a second office

Nothing about Test Data needs the receiver. Only one office on a machine can be the one
your adapters feed, so a second one serves the page but gets no events — point that one at
Test Data and it behaves perfectly.

## Read next

- [Connect your agents](../connect-your-agents.md) — swapping this for your real sessions
- [Watching the office](../watching.md) — how to read what you are now looking at
