# The furniture editor

*The seams, the algorithms and the file format. How to **use** it is
[rearranging the furniture](../user/rearranging-furniture.md), which this page assumes you
have read.*

## Why it is only a few hundred lines

Because the room was already built to be moved. The layout lives in exactly one place
(`src/layout.js`), every prop is already a single `THREE.Group` standing at its station
coordinate, and the nav grid already derives itself from `obstacleFootprints()` in one
cheap pass. So "drag a desk and the paths adjust" is really three steps:

```
move the group  ->  write the number back into the layout  ->  rebuild the grid
```

The work was never in the dragging. It was in the seams — the handful of values that
used to be computed once at import and then baked, which had to become things that could
be computed again.

## Which keys the editor dispatches itself

Several of those bindings are dispatched by the editor rather than by the shortcut
registry, and are registered with it for documentation only. **⌘Z** cannot go through the
registry because the registry deliberately ignores anything held with ⌘, ctrl or alt so
that browser and OS shortcuts keep working — and **⌘D** is dispatched beside it for the
same reason. **[**, **]**, **⌫** and the arrows are only meaningful with something
selected in a mode that is usually off, so binding them globally would put dead keys in
the **?** panel.

### The Add-item menu

The key-to-portrait map is the one part of this somebody has to keep in step, because
kit keys and catalogue ids only mostly agree — `desk:standing` is photographed as
`standingDesk`, the coffee machine as `espressoMachine`, `plant:bush` as `leafyBush`.
A missing picture costs a blank tile and nothing else, so `test/kit-portraits.test.js`
insists every offered kind has one *and* that the file it names exists: a wrong name is
invisible to review and `snakePlant` and `snake` are both plausible.

**Grouped by the job, not by the family.** A kind's own `roles` put it in a section, so
a new kind lands in the right place with nothing else edited — give a telescope
`roles: ['research']` and it appears under Research. That also fixes a class of bug by
construction: the old picker matched keys against a fixed table and *dropped whatever it
could not place*, which is how a standing desk once went missing from the menu entirely.
A catch-all section last means nothing can fall through, and a test insists on it.

**The sheet is parented to `document.body`.** Not a style choice: `.dev-panel-body` sets
`overflow: clip`, and load-bearingly so — it is what hides the divider a paired group
wears when the group falls first on its line. A sheet inside the panel is therefore
clipped to a strip an inch tall. CSS will not let one axis clip while the other is
visible, so escaping the box is the only way out, and the position is computed from the
trigger's own rect each time it opens.

It also gets the keyboard right by construction, which the `<select>` did not: a select
keeps focus after a choice and the editor's key handler stands aside for form fields, so
the piece you had just added was selected in the room and deaf to `Del`, `[`, `]` and
the arrows until you clicked elsewhere.

### What the panel asks the layout

The layout answers the questions behind all of it — `canTurnObject`, `canRemoveObject`
and `kitKeyOf` — so the panel never learns what a rug is.

## Keeping the room running through a drop

Nothing is paused while the room is rearranged around the people in it, and keeping
that honest is `AgentManager.relayout()`, called once per accepted drop, and the
order inside it matters:

1. **The walkable map is rebuilt first**, because the re-planning below asks it for routes.
2. **Everybody sitting is re-seated** — snapped to where their seat *now is*, rather than
   shifted by however far the prop moved, which is also right for a desk that was turned
   as well as moved. Without this an occupant stays behind, sitting on thin air, while
   their chair walks off across the room.
3. **Every walker's route is recomputed**, from the position they have just been put in.

It returns how many walkers were left with no route at all. Zero is the normal answer;
anything else is a layout that has fenced somebody in.

### Only what *this* change broke

Every refusal the panel reports is about the piece in hand. That is easy to state and was, for the
reachability check, not true — and the way it failed is worth knowing, because it made
the editor look like it had run out of floor.

The check used to report the first standing place it could not reach, whoever owned it.
So a room that already had one — imported, hand-edited, or saved before a station
existed — reported that same fault against every candidate position of everything
anybody added or moved afterwards, and refused all of it with *"Nowhere in the room to
put that"*. Permanently, and while blaming whatever was in hand.

Adding a **rug** was the tell. A rug's footprint is soft, so it blocks nothing and can
strand nobody; a rug that cannot be added is proof the answer was never about the rug.

So a gesture now takes a baseline first — which standing places nobody can reach *before*
it starts — and reports only what it newly breaks. Three consequences worth knowing:

- A room with a stranded station can still be edited, which is the only way anybody could
  fix such a room by hand. The offending prop can be dragged out even though it is
  standing on the fault.
- A piece that blocks nothing skips the reachability check entirely. Not a shortcut: the
  nav grid ignores soft rectangles when it is built, so the answer cannot differ.
- The baseline is measured at the *start* of a gesture, never per position. Measure it
  mid-drag and it would quietly forgive the very fault being checked for.

A room that is already stranded says so in the status line when you open edit mode,
because it no longer announces itself by everything mysteriously failing.

## The overlays are chrome, not scenery

The five overlays are chrome rather than scenery, so none of them is themed, none casts or
receives shadow, and each sits at a different height above the floor and rugs. Coplanar overlays z-fight, which is exactly what [the
coplanar probe](coplanar-probe.md) exists to catch. The two ribbons get a rung each for a
reason that shows up constantly in practice: people walk back the way they came, so a
route crosses its own history all the time.

Footprint and walking-area cells use solid Atlassian palette colours with
`toneMapped: false`. Their legend uses those same sRGB values: neither sunlight,
renderer exposure nor the floor beneath can tint them. Routes use bolder green and
blue and sit above `CHROME_HEIGHTS.ring`, including where a selection crosses a rug.
The history ribbon still fades with age.

### Why the ribbons are rebuilt every frame

They are redrawn from scratch once a frame while edit mode is open, rather than when
something changes. That is the cheaper thing to *reason about* and it costs nothing that
matters — a few dozen vertex writes into buffers allocated once.

It is also the only version that is reliably correct, because a route changes far more
often than the layout does: on every step of ordinary walking, when a walker steps round
a colleague, when an action list is interrupted, and when an accepted drop re-plans the
room. A redraw that has to be *told* about each of those is a redraw that will one day
miss one, and a stale ribbon is worse than no ribbon — it points confidently at somewhere
nobody is going.

The one thing they do not do is preview. The ribbons are drawn from the live walkable
map, not the throwaway grid used to vet a drag, so they move when you release rather than
under the cursor. Until a drop is accepted nobody has been asked to walk anywhere new,
and showing otherwise would be showing a room that is about to be undone.

## Where a layout lives

A layout belongs to a **scene**, next to that scene's season and building, and is stored
on the server the same way they are: an opaque blob on the scene record, PATCHed to
`/office/<keycard>/api/scenes/<id>` and handed back to whoever opens the office next. The
browser owns its meaning — the store keeps it whole, reads none of it, and enforces only
a size cap, because `src/layout.js` already versions a blob, clamps a prop back into the
room and forgives what it cannot understand, and a second opinion on the server would be
one more thing to keep in step.

Saving is **debounced by half a second** and fire-and-forget. A commit is cheap and
frequent — every drop, every add, every undo — and a PATCH is neither, so nudging a desk
into place is one save rather than nine. Nothing waits on it and nothing reports it: the
room on screen is already right, so a failed save costs the *next* visitor the
arrangement rather than this one, and there is no useful thing to say to somebody in the
middle of moving a chair.

**A scene nobody has rearranged has no layout stored, and gets the authored one back.**
That is a change from when the layout was a session-long singleton that followed you from
room to room. It had to change: now that an edit is kept, carrying it into the next scene
would mean opening a room and finding somebody else's furniture in it. Laying one room
out and looking at it in another building is still there, one keystroke further away —
**Copy** in the first, **Paste** in the second — or **Download** and a drop, if it is going
further than one machine — which is the same blob travelling by hand instead of by
accident.

**Reset** stores the authored layout rather than clearing the field. The distinction only
shows up in the store, and both mean the same room.

### It moves under everyone at once

A scene change is pushed to every other tab watching that office, over an SSE stream of
its own at `/office/<keycard>/api/stream`. Its own stream rather than the AOP bus, because
that one carries *agent* events — a ring buffer, filtered by harness, replayed to rebuild
a session somebody missed — and a layout edit is none of those things. Putting it through
the bus would surface a moved desk in an agent's event log and then age it out of a buffer
sized for tool calls.

A tab is never told about its own edit. That is not only to save a pointless round trip:
a tab that has already moved on to its next change would be dragged back to the previous
one by its own echo. Each tab names itself with `?viewer=` on both its subscription and
its change, and the broadcast skips it.

**That id is per page load, not per browser session, and the difference is the whole
feature.** A browser copies `sessionStorage` into a tab duplicated from another — which
is how anybody actually opens a second tab — so the id used for presence is *shared*
between the two tabs you are looking at. Suppression on a shared id skips both of them,
and two tabs side by side fall silent in both directions rather than one missing out.
So `office.js` keeps two: `viewerId`, stored and stable across a reload, for counting
who is in the room; and `connectionId`, never stored, minted once per page load, for
telling two tabs apart. `test/office-identity.test.js` pins the pair by loading the
module twice over one storage.

- **`src/layout.js` itself** is untouched. A stored layout is what an office is *showing*;
  the authored layout is what a fresh scene *starts from*, and **Copy** into the source
  is still how a room becomes the one everybody gets.

### Six rugs, and six sofas

Three kinds have a choice about how they look. `RUG_COLORS` in `config.js` holds six for
the floor — sage, clay, sand, slate, plum and ink — and `SOFA_COLORS` holds six for the
upholstery, shared by the couch and the armchair: terracotta, moss, navy, mustard,
charcoal and blush. The panel draws them as swatches rather than as a list of names,
because the thing being chosen is a colour and "Plum" is a word you have to picture.

**Auto** is the absence of a choice rather than a colour, and it is what everything
starts as. `COLORS.rugSage` and `COLORS.couch` are both part of the theme and the projects
repaint them, so a room nobody has asked goes on following its scene and its season. What
that means for the reader is in
[rearranging the furniture](../user/rearranging-furniture.md#six-rugs-and-six-sofas).

**What is not chosen is derived.** A rug's border is its body a shade darker. A sofa's
seat cushions are its body lifted toward white, and the cushion at your back is the
accent named beside that colour in `SOFA_COLORS` — moss wants ochre and navy wants clay,
which is a judgement rather than a hue rotation, so the pairs are written down.

Both of those replaced literals that had come adrift. The rug's border was a fixed sage
green beside a body colour the theme was free to change, so a room on a slate palette got
a slate rug with a green edge. The sofa's seat cushions were a fixed terracotta under a
body colour three of the four projects repaint — so the green velvet couch in the Paris
scene sat on cushions off a different sofa entirely. Six choosable colours apiece would
have been six more chances to have each of those arguments.

### Where a new piece lands

Nowhere you chose, which is the one compromise in it: asking for a position would need a
click, and a click in this mode already selects. So the floor is swept instead, nearest the
middle first, at each quarter turn the piece has, and the piece goes in at the first spot the
drop check accepts — the same check a drag is held to, so nothing can arrive somewhere a
drag could not have put it. Then you drag it where you meant.

Five details are worth knowing, because each was wrong at some point and pressing the
button is what found them.

**A piece gets turned if that is what fits.** Only a piece with a front is offered the
four headings; a lamp or a plant would be the same position tried four times.

**The sweep runs coarse then fine** — a one-unit lattice, then half that, then the snap
itself — because the difference between "nowhere for another desk" and one that slots in
against a wall can be a fraction of a unit. It used to stop at half a unit while drags
landed on multiples of the quarter-unit snap, so there were positions you could put a
piece with the mouse that **Add** could never find. Going all the way down to the snap
costs about four times the candidates: measured on the authored room, a search that
finds nowhere goes from 58 ms to 136 ms.

**A piece is never offered a position it could not fit in.** The sweep knows the piece's
own half-extents, so it skips anywhere the piece would hang off the floor rather than
generating the position and having the drop check refuse it. This mattered most for the
rug, which at 9 by 7 can only have its centre inside x 4.5–21.5, z 3.5–16.5 — four
candidates in seven were being made only to be thrown away.

**Delete a desk, add a desk, and it goes back in the hole.** The sweep tries the spot the
last deletion left before it tries the lattice at all. Without that it hunted outwards
from the middle of the room and could easily report there was nowhere — the floor was
provably free, since a desk had been standing on it a moment earlier, but the hole was
often not on the lattice: a desk dragged to 1.75 sits between the cells of every pass.
The offer is still only a suggestion, held to the same checks as any other candidate, so
deleting a side table and adding a couch does not wedge the couch into the gap.

**One piece is brought in and then moved**, rather than a fresh one made and unmade at each
candidate, and that is the fix for a bug that made **Add** look broken: it would place a
piece in one spot and then insist there was nowhere for another. Ids count *past* what
exists rather than into gaps, so every one of those short-lived records was called `desk-6`
— and the props layer, matching by name, kept the prop it had already built for the first
one. That prop stayed where the first candidate put it, reading a record nothing would ever
write to again, and reported *its* seat and standing room for every position tried
afterwards. So the room answered every later candidate with the geometry of the first, and
refused it. Moving one piece is what dragging does, and it cannot go stale; the props layer
also now compares the record rather than the name, so an impostor is rebuilt (`syncProps`).

Measured on the stock room, with the props actually built: each of the next seven desks is
found in 5–25 ms, and a room with no room left says so in about 20.

That last case is real rather than a bug to chase. Twelve desks, a couch, a rug and seven
stations with walkable standing room at each is about what 26 by 19 units holds; the
thirteenth desk is refused because every position at every facing either overlaps something,
leaves its own standing room unstandable, or walls something off.

## How many of a thing the room may have

Furniture can be added and deleted, and the interesting question is not how but *how
many*. It used to have an answer nobody had written: `STATIONS` was a keyed object, one
entry per kind, so "one mailbox" was not a rule but a consequence of a mailbox being a
*key* — and "five desks" was a five-entry array that everything downstream iterated, so
five was never a limit at all, only what the room was authored with.

Both are now written down in the kind tables in `src/layout.js`, because the editor has
to be able to ask. The limits themselves are tabulated in
[rearranging the furniture](../user/rearranging-furniture.md#how-many-of-a-thing-the-room-may-have).

### The minimum is a job, not a kind

The maximum is a question about props. The minimum is a question about **work**, and
it was asked the wrong way for a long time:
the last of *every kind* of station was undeletable, so the room insisted on keeping a
printer that has nothing to do — while a second bookshelf quietly made the first one
disposable. The rule was never "the office needs a bookshelf" but "the office needs one
of each kind it happens to own", which is nobody's decision. It is the same shape as the
maximum problem above, one layer down.

So a station kind declares what it is *for*, and the room keeps whatever it needs to be
able to do those jobs. Which four are required, and which two are optional, is
[tabulated for the reader](../user/rearranging-furniture.md#the-minimum-is-a-job-not-a-kind).

What that changes in practice:

- **The bin, the machines and the inbox can all be deleted**, none of which was true
  before. The inbox can go because the post can also be collected from. The printer was
  on this list too until it was given
  both of the post's jobs — so it is now kept for the same reason anything is, and the
  *mailbox* became deletable in its place.
- **A second of anything frees the first**, which is the rule the reader is given.
- **A new kind can cover an existing job with no rule changing.** This one has since
  happened: the telescope, added later,
  looks things up out of the window, and the bookshelf became optional the day it landed
  — with no rule anywhere hearing the word "telescope". It was a prop, a role and a
  placement, and the paragraph that predicted it needed no edit.
- **A refusal names the job.** *"The office needs somewhere to deliver finished work"*,
  not "the office needs its Mailbox" — which read as arbitrary because it was.

`canRemoveObject()` is still the one place that decides, and both the **⌫** key and the
pruning half of an imported layout go through it — so a blob cannot do by omission what
the editor would refuse on a keypress. See [the jobs system](../user/concepts.md) for the
concepts behind the roles.

### The headcount is the desk count

One desk, one agent thread, and now literally: `agentCapacity()` returns `DESKS.length`
and the simulation asks it afresh each time somebody is due to arrive. Add a desk in the
editor and somebody files in to sit at it; delete one and the room drains to its new size
as shifts end, rather than keeping a crowd standing.

This used to be a `maxAgents: 5` written beside each project in `src/projects.js`, next to
a desk list that happened to be five long, with nothing keeping the two in step. It is
gone. What a project still says is `startCount` — how many are in when the doors open —
which is a different question and a matter of taste.

### The wall clock, which used to be two objects sharing one number

`DECOR.wallClock.z` used to be written as `STATIONS.coffee.z`, which is a perfectly
reasonable thing to write when the coffee machine cannot move: it says "the clock is
above the coffee machine" in one short line. The moment the coffee machine *can* move it
becomes a bug, because dragging the machine across the room drags a clock off the wall
with it.

So the clock now has its own `x`, `y` and `z`, written out in full, with a comment
recording that it *happens* to sit above the coffee machine rather than being defined by
it. This is the shape of most of the work in the seams, and it is worth recognising the
pattern: **a value derived from another object's position is a value that will move when
that object does**, whether or not you meant it.

## Offsets, not positions

The other half of the seams. Two kinds of value used to be authored as absolute points
and baked once at import:

- **Approach points.** `STATIONS.coffee.approach` was the absolute spot an agent stands
  to use the machine. A moved machine would have left its standing room behind.
- **Couch seats**, and the point in front of each seat.

Both are now stored as **offsets from their prop's centre**, and the absolute point is
derived from centre + offset + facing. The offsets were computed from the numbers that
were already authored, so nothing in the room changed position when they were converted.

The authored literals still *read* as absolute points, because two coordinates you can
check by eye are much easier to review than an offset. The conversion happens once on the
way in — which is fine everywhere except when baking a layout back into the source, where
it is the one thing to get right. See [Baking a layout in](#baking-a-layout-in).

Deriving them is `reviseLayout()`, and it is called from exactly two places: once at
import, replacing the loops that used to bake these values, and again after every edit.
One function, so import-time and edit-time derivation cannot drift apart — if a dragged
couch's seats are wrong, so are a freshly loaded one's, which is a bug you find
immediately rather than in six months.

`obstacleFootprints()` needed no change at all. It was already derived.

## One serialisation, four buttons

A layout leaves by the **clipboard** or as a **file**, and comes back the same two ways —
four buttons' worth of behaviour over exactly one serialisation, `onLayoutText` and
`onLayoutApply` in `panel.js`. There is no textarea any more. There used to be one box
serving as both outbox and inbox, with **Export** and **Import** either side of it, and
the trouble with that was that neither label was true: Export also filled a box, and
Import read the box rather than the clipboard everybody assumed it read.

**The download is named after the layout**, which is the one part of it worth a test
(`test/editor-download-name.test.js`). A folder of `layout.json`, `layout (1).json`,
`layout (2).json` is a folder nobody can read; and a name with a slash or a colon in it is
a name a filesystem refuses, so it is slugged. An edit of the Default has no name yet and
gets `office-layout.json` rather than a made-up one.

### The strip is narrower than the window

The panel sits between the roster and the inspector, not across the screen: opening the
agent detail on a 1366px laptop leaves the strip about 770px while the *window* has not
changed width at all. So the panel shrinks by asking about **itself** — a container query
on `#editor-panel`, not a media query, because the viewport gives the same answer in both
cases and would squeeze a panel with room to spare while leaving the cramped one alone.

Under about 1040px the sections shrink in place rather than reflowing, which is what
`strip.js` asks for: a group that drops to a second line takes everything after it along,
so the same button ends up somewhere different depending on whether the inspector happens
to be open, and a control you have to find again is worse than a smaller one. Snap gives
up track length (three stops need less room than the clock's twenty-four hours), Paths
puts On above Off, the drop zone shortens its sentence to *Drop a .json* — keeping the
long one in its `title` — and the four buttons go two-by-two. Below about 820px each of
those tightens once more, along with the gutters and the picker's width.

The wrap is still underneath as a last resort, at around 700px instead of 1040px. It has
to be: `.dev-panel-body` **clips** rather than scrolls, so a section pushed out of the box
would be gone rather than merely out of sight.

## The blob

**Copy** puts the layout on the clipboard, and **Download** puts the same text in a file.
Which pieces there are, of what kind, where and facing which way — no sizes, no palette —
rounded to two decimal places:

```json
{
  "layout": 4,
  "complete": true,
  "desks": {
    "desk-1": { "x": 12, "z": 8, "facing": 3.14 },
    "desk-6": { "x": 17.5, "z": 14.5, "facing": 0 }
  },
  "stations": {
    "coffee":      { "kind": "coffee", "x": 1.6, "z": 16.8 },
    "bookshelf-2": { "kind": "bookshelf", "x": 20.5, "z": 6, "facing": 3.14 }
  },
  "furniture": {
    "couch":     { "kind": "couch", "x": 20.5, "z": 15.5, "facing": 0 },
    "sideTable": { "kind": "sideTable", "x": 23.4, "z": 15.2, "facing": 0 },
    "floorLamp": { "kind": "floorLamp", "x": 17.8, "z": 16.8 },
    "rug":       { "kind": "rug", "x": 12, "z": 8, "facing": 0, "color": null }
  },
  "decor":  {},
  "plants": { "plant-1": { "kind": "bush", "x": 9.5, "z": 1.6, "scale": 1.4, "seasonal": true } }
}
```

**Version 4 moved the rug into the furniture.** It was the last thing left in `decor`, on
the reasoning that a room has *a* rug the way it has *a* floor — which was the shape making
the rule again, exactly as a top-level `COUCH` once did. A reading corner and a meeting
area want one each, and a room may want none. `decor` is empty now, and kept only as the
seam a fixture that learns to move would come back through. A version 3 blob names its rug
under `decor.rug`; that is read onto the first rug the room has, and skipped where the room
no longer has one — a blob from before rugs could be counted is no evidence about how many
there are.

**Version 3 gathered the comfort furniture into one map.** The couch had a top-level entry
of its own and the side table and lamp sat among the `decor`, which was an accurate shape
for three things there was exactly one of each of. Keyed by id like the desks and stations,
the blob can now say there is a second couch.

Note the lamp has no `facing` and only the rug has a `color`. A piece carries a heading
only if it has a front to point — a couch and a table do, a pole under a round shade does
not — and a colour only if its kind comes in colours. Both absences are the same thing the
editor reads when it declines to offer a control.

Two things changed at version 2, both so that the blob can describe furniture and not only
positions.

**Kinds travel.** A blob that carried only coordinates could only describe the room it was
exported from, prop for prop. Carrying the kind alongside is what lets one say *there is a
second bookshelf here*, and be read into an office that has never had one — `applyLayout()`
builds what it names. Plants moved from an array to a map keyed by id for the same reason:
their identity used to be their position in the list, so inserting one silently renumbered
every plant after it.

**`complete` is permission to delete.** A blob from **Copy** or **Download** describes the
whole room, so
a piece it does not mention is a piece that is not there any more — that is how undoing an
addition, and **Reset**, put furniture *away* rather than only back. A blob somebody typed
is a different thing: six lines naming the two desks they wanted moved. Reading absence as
deletion there would empty the room on the strength of a note about part of it, so a blob
that does not claim to be complete may only move and add.

Both older shapes still import — version 2's separate couch and decor entries, and version
1's plants-as-an-array. Each remains a true description of the room it came from, so a v2
couch is read onto the first couch in the room. Skipped rather than created where the room
no longer has one: a v2 blob is silent about how many couches there are, so it is no
evidence that one is missing.

**Paste** is deliberately forgiving, because the whole point of a portable format is
that it gets hand-edited:

- **Unknown keys are ignored** and missing ones left alone, so a blob from a future
  version still moves what it can, and a partial blob naming two desks moves two desks.
- **Every coordinate is clamped into the room** by `LAYOUT_MARGIN`, rather than refused.
- **Anything that is not a finite number is left alone entirely**, because "put this desk
  at `NaN`" has no sane clamp.
- **A facing within half a degree of a right angle is treated as that right angle.** That
  is both what somebody typing `1.57` meant, and what makes a copy/paste round trip
  exactly lossless despite the blob being rounded for legibility.

So a hand-edited blob cannot wedge the office, and the worst a bad one can do is put the
furniture somewhere silly — which you can see, and undo.

## Baking a layout in

A layout you want to keep goes into the source, by hand. Say you have dragged `desk-3`
and the coffee machine and pressed **Copy**:

```json
{ "layout": 4, "complete": true,
  "desks":    { "desk-3": { "x": 8.25, "z": 14.5, "facing": 1.57 } },
  "stations": { "coffee": { "kind": "coffee", "x": 3.5, "z": 16.8 } } }
```

(A copy names every prop in the room; the two that moved are the two shown here.)

**A desk is the easy one.** In the `DESKS` array, find the entry with `id: 'desk-3'` and
write the numbers straight in:

```js
{ id: 'desk-3', x: 8.25, z: 14.5, facing: Math.PI / 2 },
```

`facing` is radians, and the editor turns in 90° steps, so a copied facing is always
`0`, `Math.PI / 2`, `Math.PI` or `-Math.PI / 2`. Write those rather than the rounded
decimal from the blob. Paste treats a facing within half a degree of a right angle *as*
that right angle, so a pasted `1.57` will behave — but `Math.PI / 2` in the source says
what it means, and a source that says what it means is the point of baking.

**A station needs one more edit, and this is the trap.** Stations are built by a helper
that takes the approach point as an *absolute* position and turns it into an offset on
the way in:

```js
coffee: station('coffee', 1.6, 16.8, { x: 3.3, z: 16.8 }),
//                        ^ centre     ^ where you stand to use it
```

The offset is `approach − centre`. So writing only the new centre leaves the approach
point where it was, which changes the offset rather than moving it — and the offset is
what the facing and the standing distance are derived from. Move the coffee machine from
`x: 1.6` to `x: 3.5` and nothing else, and its approach offset collapses from 1.7 in
front to 0.2 *behind*: the machine turns round to face the wall and its standing room
lands inside it.

**Move the approach point by the same delta as the centre.** Here the centre moved
`+1.9` in x, so the approach does too — `3.3 + 1.9 = 5.2`:

```js
coffee: station('coffee', 3.5, 16.8, { x: 5.2, z: 16.8 }),
```

That reproduces the runtime layout exactly. If you turned the station as well as moving
it, place the approach point at the same distance along the new heading instead of
shifting it — the distance is what has to survive, not the direction.

The asymmetry is worth understanding rather than memorising. At runtime the offset *is*
the stored thing, so dragging a station carries its standing room along for free. In the
source the offset is written as two absolute points that happen to imply it, because that
is much easier to read and to check by eye. Baking is the one moment those two
representations meet, so it is the one moment you have to convert by hand.

Then reload and press nothing. The room should come up exactly as you left it. If it does
not, there are two likely culprits and both have been met above: an approach point that
did not travel with its station, or a value still being computed from another object's
position somewhere — the wall clock's bug, in a new place.

A named-layouts *directory* the editor loaded from at startup is the obvious next step,
and it is still not here. **Download** and the drop zone give a layout a life as a file
without it: a file that a person carries, rather than one the app reads on boot. That
distinction is the whole reason — a directory the editor loaded from would be a second
source of truth for the layout, which is exactly what the last hundred lines of
`layout.js` exist to avoid.

## Where the code is

| File | What it holds |
| --- | --- |
| `src/layout.js` | The layout, a mutable singleton: `reviseLayout()`, `applyLayout()`, `layoutSnapshot()`, `resetLayout()`, and what may exist — `STATION_KINDS`, `FURNITURE_KINDS`, `PLANT_KINDS`, `addObject()`, `removeObject()`, `agentCapacity()` |
| `src/scene/props.js` (+ `movables.js`, `props/`) | `userData.movable` tags, `handles.propsRoot`, a `relocate()` per prop, a builder per kind, and `sync()` — which builds what the layout has gained, unbuilds what it has lost, and rebuilds anything whose record the layout has replaced under the same name |
| `src/editor/editor.js` | Enter and leave, pick, drag, snap, rotate, undo, validate, commit |
| `src/editor/layouts.js` | The saved-layouts shelf: names, blobs and localStorage |
| `src/plan/` | What **Random** presses: a seed in, a whole layout out. [The layout algorithm](layout-algorithm.md) |
| `src/editor/gizmos.js` | The blocked cells, the footprints and the selection ring |
| `src/editor/path-trails.js` | The route ribbons: one strip per walker, ahead and behind |
| `src/editor/panel.js` | The panel: title, selection readout, furniture picker, snap, paths, Copy, Paste, Download, the drop zone, Reset, Random |
| `src/main.js` | The **E** binding, the editor's lifecycle across scene switches, `?edit=1` |
| `src/agents/AgentManager.js` | `relayout()` — rebuild, let go of vanished furniture, re-seat, re-plan — and `pathTrails()` |
| `src/agents/states.js` | `replan()`, and the route each walker remembers having walked |

Props self-register as movable, the same trick `userData.nightLight` already uses:

```js
props.add(movable(obj, `desk:${spec.id}`, {
  label: spec.id, spec, relocate: () => handle.relocate(),
}));
```

The editor raycasts against `propsRoot` and walks up to the nearest tagged ancestor,
which is what makes clicking a monitor select the whole desk. It never needs a list of
what is movable, so **adding a movable prop is one call at the point you build it** and
no edit to the editor at all.

`relocate()` is the other half. Three handles bake world-space anchors that cannot be
re-read from the layout — the desk (`seat`, `approach`, `sitRotation`, `chairFacing`), the
couch (seats and approach), and the mailbox (`slot` and `pile`) — so each gets a
`relocate()` that recomputes them. Everything else reads `STATIONS` live and needs
nothing. That is what lets the room keep running instead of demanding a world rebuild
per drop.

## What is not here

The list is in
[rearranging the furniture](../user/rearranging-furniture.md#what-is-not-here).

One entry that used to be on it is no longer true, and is worth naming here because the
sentence outlived the feature that removed it: a layout **is** persisted per scene, on the
server, exactly as *Where a layout lives* above describes. What is per-browser is the shelf
of *named* layouts, which is `localStorage` and deliberately local.

## Read next

- [The layout algorithm](layout-algorithm.md) — where **Random** gets a room from,
  and why every seed produces one that works
