# The physics of the office

How people move, stand, wait and sit, and the rules we keep rediscovering the hard way. This is a start rather than a full account — it records what the last few fixes taught us while it is still fresh. The thinking behind each one deserves more space than it gets here.

Everything below was measured, not judged by eye. Where a number appears, it came from running the office headlessly and counting (see [Measuring it](#measuring-it)).

## The rules

### A destination is a place, not a point

The layout gives each thing one coordinate, and for a long time everybody walked to exactly that coordinate. Two people wanting coffee therefore wanted the same square centimetre, and a lift-load of arrivals all wanted the mat just inside the door. This is the single root cause behind most of what looked like broken physics.

The fix is to treat a destination as somewhere with room for more than one person: `crowd.js` hands out standing places either side of the nominal point, and hands out the **middle first**, so a lone visitor stands square to the machine rather than off to one side. Desks and couch seats never had the problem, because a seat is *booked* before it is walked to — which was the clue.

Applies to: machines (coffee, water, mailbox, bin, bookshelf) and the doorway, in and out. Home time sends everybody to the door at once, so leaving claims a place too.

### Waiting is what is left when there is no way round

Yielding to somebody in your way is correct. *Stopping* is not. A blocked walker used to stand still, which is why queues formed in places nobody would queue.

Now `findPath` takes an `avoid` list, and a walker who is getting nowhere for 0.3s asks for a route that treats the people near them as furniture. A third of a second reads as noticing somebody; anything longer reads as being stuck. Waiting survives only where there is genuinely no way past — a lane too narrow for two, or the last step to a machine somebody is standing at. **A queue should be what is left when there is no alternative, not the default.**

Waiting for the lift is a different thing and is untouched: that is a wait for a *thing* to be ready, not for a person to move.

### Do not reset the wait when re-routing

The counter that says how long somebody has been held up is also the tie-break that settles who goes first when two people are in each other's way. An earlier version ended the walk after five seconds of being blocked, which reset the wait — so a group in a doorway could deadlock indefinitely, each politely waiting for the others, and nobody's wait ever growing long enough to win. Re-routing must leave the wait alone.

### A seat is sat on from its front

Twice now. A couch seat sits *inside* the couch, so it is not somewhere anyone can be walked to; a desk seat is walkable floor, so a path to it succeeded by running straight through the chair. Both produced the same tell: people arriving through the furniture.

The pattern that works, for any seat:

1. walk to the floor **in front** of the seat,
2. turn to face the way the seat faces,
3. `stepTo` the seat — a straight line, never a path — lowering themselves backwards into it, still looking out of it,
4. and only then turn to whatever they came to look at.

A desk chair adds a step, because it is furniture that moves: the side to enter from is chosen before setting off, the chair is swung a quarter turn out of the way on arrival, and chair and occupant swivel to the monitors together once they are in it. Getting up reverses it and pushes the chair back in. Being called away mid-sit does the same, or the chair is left askew at an empty desk.

Keep it brisk. The first version was correct and far too slow: it is a spin of a chair on castors, not choreography, and anything statelier makes sitting down look like an event.

### Look at the thing, not in a direction

A heading stored in the layout is only right from one spot, and the whole point of standing places is that people end up a step to one side. Turns take a target and work the angle out from where the agent actually ended up (`lookAt`, in `states.js`).

### The nav grid steers centres, not shoulders

Cells keep an agent's *centre* out of furniture, but a body is about 0.46 across, so a route that clears a prop on paper still clips it on screen. Widening every prop closes the walking lanes, so this is still open — see the holes below.

### A footprint belongs to the prop, not to the world

Every blocked rectangle is measured in the prop's *own* axes — across its front, and front to back — and laid onto x and z according to which way it is pointing. So a couch stood end-on blocks a tall thin rectangle, and the same couch square to the room blocks a wide flat one, from one pair of numbers.

It was not always so, and the way it failed is instructive. The half-extents used to be measured in world axes at each prop's authored facing, with rotation taken as the difference from a `baseFacing` recorded when the instance came into being. For the authored room that is a true description; for anything the *editor* created, the two angles were the same by construction, so the difference was always nought and a rotation never registered. A couch added end-on blocked the floor of a couch stood square — agents walked through its arms, and stopped dead in front of it — and the editor's search for somewhere to put a new piece could not tell one rotation from another however many it tried. A measurement that depends on the state a thing was born in is a measurement waiting to be wrong.

### A moving part of the room needs floor of its own

A footprint is the floor a prop stands on. The door leaf does not stand anywhere — it *sweeps*, hinged on the left jamb and swinging inward through better than a right angle, and the quarter-disc it passes through is floor no one can be standing in. Nothing in `obstacleFootprints()` describes that, because the leaf's rectangle where it hangs shut is against the wall and harmless.

So it was not caught by anything, and the bin's standing room was put 0.26 from the open leaf's centre plane — less than half a body. The leaf swung through whoever was binning something and stayed in them until they left. The courier stands inside the same doorway and is fine, at 0.89; the difference is only that one number was measured and the other was not.

The lesson is not about the door. Anything with a moving part — a lift car, a chair swinging out, a desk travelling up — owns the volume it moves through and not just the one it occupies, and standing room has to be measured against the swept volume. `test/bin-door-clearance.test.js` derives the leaf's arc from `DOOR` and `buildDoor`'s own constants and asserts no station stands in it, so the next prop dragged into the entrance corner fails a test rather than a screenshot.

### Intent is not a position

The door used to open for anybody within 2.6 in x of the opening and 3.4 either side of the wall. That is a guess at intent from geometry, and it was wrong in both directions: it opened for someone stood at a prop that happened to be near the entrance, and it would have opened for anybody crossing the lane on their way to the mailbox.

An errand already knows what it is. `rec.arriving` and `rec.leaving` are set for the length of the walk in and the walk out, so the manager asks those instead — the door is open before an arrival reaches it and eases shut behind them, and a settled office never touches it. Where a proxy for intent is unavoidable, prefer the flag the behaviour already sets over the box it happens to be standing in.

### Every wait needs an end, and a departure's is on the wall clock

Waiting is the office working. Waiting forever is the office broken, and the room's actions are careful about it: `waitUntil` gives up after fourteen seconds, a blocked `walk` abandons after forty, a booked standing place expires after twenty-five. `follow` — the fixed route up a flight of stairs — was the exception, because a walker waits their turn at the end of a flight and that wait had no end to it. Two people never deadlock there (see `_mountBlocked`), but a queue can be *starved*, which is the same fault seen from the bottom step. It now waits twenty seconds and then shares the treads, because being rude on a staircase is a smaller fault than never going home.

The bigger version of the same rule is about the whole errand rather than one action. **Going home is the one walk with nothing to come back to**, so until it finishes the character is still in the room with a desk booked — and it can be held up by everything above at once: a crowd at the door, a lift that has just closed, a flight somebody else is on. So a departure has a deadline. Thirty seconds after being told to leave, the room stops waiting and [beams them up](../user/connect-your-agents.md#when-agents-leave).

**That deadline is wall time, not frames**, and this is the part worth remembering. A browser stops calling `requestAnimationFrame` for a tab nobody is looking at, while a feed's `setInterval` keeps running — so the reduction goes on retiring quiet sessions and telling the room to show them out, and the room never draws a frame in which anybody takes a step. A window left in the background for a few hours came back to a hundred and fifty characters, a hundred and seventeen of them "walking". Nothing was multiplying: they were the whole night's arrivals, every one of them told to go home and none of them able to move. Measured in frames, thirty seconds might be hours of that; measured on the clock, it is thirty seconds. Anything that bounds the room's population has to be on a clock that a stopped loop cannot slow down.

## Where it lives

| file | what it owns |
| --- | --- |
| `src/layout.js` | the layout: prop positions, footprints, `STATIONS`, `DOORWAY` |
| `src/agents/pathfinding.js` | `NavGrid`, A*, the `avoid` list, body clearance |
| `src/agents/crowd.js` | standing places, overlap resolution, `wayBlocked` |
| `src/agents/states.js` | the action list: `walk`, `face`/`lookAt`, `stepTo`, `sit`, `turnChair`, and the detour |
| `src/agents/AgentManager.js` | the choreography that strings actions together |
| `src/scene/beam.js` | the cone of light that takes away anybody the walk out could not |

Actions are a sequential list per agent, which is why a movement that ought to happen *while* another one does — swinging a chair out as the last step is taken — has to be ordered instead. Worth revisiting if more of these appear.

## Measuring it

The office runs headlessly in node, which is how every number here was produced: import `props.js` and `AgentManager`, stub `document.createElement` to return a canvas whose 2D context answers with numbers where numbers are expected, seed `Math.random` so runs are comparable, drive `manager.handleEvent(...)` on a schedule and tick `manager.update(1/60)` in a loop. `bin/coplanar-probe.js` does the same for geometry and installs `three` into `node_modules` on first run.

Two harness details that mattered:

- **Spawn everybody at once.** Arrivals staggered by even half a second hid the doorway pile-up completely; the bug only appears with a lift-load.
- **Do not measure a movement from its last frame.** `stepTo` eases to a stop, so the frame before sitting barely moves and the direction they came from is noise. Take the position ~0.4s earlier.

Invariants worth guarding, with where they stood after the last change:

| what | value |
| --- | --- |
| people interpenetrating | 0% of frames |
| desk sits entered from the back | 0 of 96 |
| longest single wait for a person (quiet office) | 0.33s |
| longest single wait for a person (busy office) | 1.57s |
| lift-load of five clears the doorway | 5.1s |
| standing places at machines actually reached | 99% |
| facing error at a machine | 0.0° mean |
| whole sit-down interaction | 0.82s |
| chair left askew after a sit | 0.97s worst |
| stations whose standing room is inside the door's swing | 0 of 7 (guarded) |
| stations whose standing room is inside the entrance lane | 0 of 7 (guarded) |

For contrast, before these fixes: sits were 31 of 31 from the back, the longest wait was capped at 5.00s by the give-up rule, and a lift-load took 21.1s to clear.

## Known holes

- **Passers-by clip other people's chairs** — 1010 frames of it in a ten-minute run, against 50 for the person actually sitting down. This is the centres-not-shoulders problem, and it is still open.
- **A one-cell pinch at x≈3, z 12–14**, between desk-3 and the fig, is the last place two people genuinely cannot pass, so one waits. A layout nudge would remove it.
- **`lookAt` is a one-shot turn.** If the crowd nudges somebody after they have turned, the angle is not re-derived. One coffee visit in a ten-minute run ended 37° off because of this; the rest were exact.
- **Almost none of the invariants above is guarded automatically.** The two marked *guarded* are, in `test/bin-door-clearance.test.js`; every other harness so far has been a throwaway, so a regression would only show up by eye. Those two were the cheap ones — they are statements about the layout, which a test can read straight off. The rest need the office actually running for minutes at a time, and promoting one to `npm run probe:office` is still the obvious next move.
