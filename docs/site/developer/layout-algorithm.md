# The layout algorithm

*A seed in, a whole layout out. Where it runs, how a candidate room is judged, and why the
streams are hashed.*

Every room in the office is a **layout** — a list of pieces, their kinds and their
positions — whether somebody dragged it into place or a seed produced it. This page is
about the half that produces them.

What a seed *decides*, and the adjacency rules it decides it with, is
[generated offices](../user/generated-offices.md); what a layout *is*, as a file you can
save and send, is [layouts](../user/layouts.md). Read whichever of those you need first —
this page assumes both.

## The plan drawings, and drawing anything else

The gallery images and the terminal plan come from one place. The generator's own working notes are *not* what
gets drawn: a layout is applied to the room, and then the room is **surveyed** —
its blocked floor read straight off `obstacleFootprints()` (the same list the nav
grid blocks) and its standing room derived by the same function the generator
places against (`src/plan/survey.js`). So the picture is of the layout, not of the
generator, and the pale bands, the rings and the rectangles are all things the
room itself would tell you.

Which means anything that is a layout can be drawn:

```bash
npm run plan -- --from=mcb/layouts/11-desks-outside.json   # a layout somebody made
npm run plan -- --from=authored                            # the room as authored
npm run plan -- --from=a.json --from=b.json --gallery --out=plans.html
```

A file drawn this way gets its name from the blob's own `name` if it has one, and
no **Open this office** link if it has no seed — there is nothing to reproduce,
because the file *is* the room.

## Where it runs

Every new room is generated before it is furnished. Three places:

| | Seed | |
| --- | --- | --- |
| **A new office.** A keycard nobody has used becomes an office with one scene, and the scene is generated the first time anyone opens it. | The scene's own id | `adopt()` in `src/office/office.js` |
| **A new scene** in an office you already have (`+` in the switcher). | Minted, and stored in the layout | `addScene()`, same file |
| **Random**, in the furniture editor's Layout row (press `E`). | Minted per press | `onRoll` in `src/editor/editor.js` |
| **A seed link** — `/?seed=slate-orchard-2210`, which is what the gallery's Open-this-office links are. Reception mints a keycard and hands the seed straight on. | The seed in the link, used once | `openOffice()` in `src/wizard.js` |

A room is generated **once**, when it is first opened, and never again. The test
for "never been opened" is the scene's *look*, not its layout, and that is
deliberate: clearing a scene's layout is how the editor's **Reset** says "back to
the floor plan authored in `src/layout.js`", so a generator that ran whenever a
layout was missing would overrule Reset on every reload.

The seed for a scene is derived from the scene's id rather than minted, which
makes it safe to run in two tabs at once: both generate the same office and race
to store an identical blob. That is strictly better than the look-rolling it
replaced, where two tabs rolled differently and the last write won.

**Random** is an ordinary edit. One press of `⌘Z` puts the previous room back, and
the panel prints the name and the seed — the seed because it is the only way back
to a room you liked. Press it six times and the five you passed over are gone
unless their seeds were on screen.

The layout picker shows the office's **name** while it is in the room:
`The January Parlour *`, with the star that means unsaved. By the letter of the
editor's three modes a generated room is an edit of the authored plan and should
read `Default *` — but Default is exactly what it is not, and the whole point of
generating a room is that it is a particular room with a particular name. The
picker's tooltip carries the seed, and Save offers the name.

## The arrangements

Two forms, because there are exactly two ways a desk can have a neighbour:

- **single** — one row, all facing the same way, occupants all on one side. The
  row needs its own aisle behind it, which is what makes a floor of these read as
  rows.
- **paired** — two rows with their monitors meeting in the middle and their
  occupants on the outside. This is what "back to back" means in a bench system,
  and it gives a team one aisle each rather than two.

`rows` and `perimeter` are single; `pods`, `spine` and `island` are paired. What
differs between the three paired ones is where they want to be — pods a clear gap
apart, a spine down the middle of the working half, an island in the middle of the
floor with room all round it — and each says so as a score, in a couple of lines,
beside the arrangement it belongs to.

A bank holds at most four desks along the room's 26 and three across its 20,
worked out from the pitch rather than picked. **A bank that does not entirely fit
seats what it can and hands the rest back**, so a team of six in a room with space
for four in a run becomes four here and two at the end of the next bank along —
which is what every open-plan floor actually looks like. Before that rule the
banks were all-or-nothing, and a room asked for eight desks came back with two.

## What it scans against

What it scans against is a list of rectangles, each named after what it came from,
and the judge is **`floorFault()` — the furniture editor's own arithmetic**, not a
second copy of it. So "on the floor and out of the way" has one definition in this
codebase, and a generated room is a room somebody could have dragged into place.

Three kinds of rectangle go into the list, and the reason there are three rather
than one flat list of obstacles is a mistake worth not making:

| | |
| --- | --- |
| **footprint** | A prop's own blocked floor, on the world's axes — `worldExtent()` in `src/layout.js`, shared so this cannot disagree with the nav grid about how much floor a turned couch takes. |
| **standing room** | The strip between a prop and the spot its user stands on. Reserved, so that nothing later ends up in front of the coffee machine. |
| **circulation** | The avenue in from the door and the one street it runs into, reserved *before* anything is placed. Aisles drawn last are aisles made of whatever floor happens to be left. |

A **prop** may not overlap a prop, a way, or somebody's standing room. **Standing
room** may not overlap a prop, and may overlap anything else. Which reads as:
build nothing in the aisles, and stand wherever there is floor. The obvious
design — reserve the street, refuse anything that overlaps it — forbids the single
most useful arrangement in the room, a bench of desks with the street doing duty
as the aisle behind the chairs. That is not a conflict; it is what a street is
*for*.

Then the constraints that come from the room itself rather than from the plan:

- **A desk's standing room is 3.5 units out along its own axis**, because that is
  where `buildDesk` puts its approach point and where the agent layer walks to. A
  bench whose standing room lands inside the next bench is a bench nobody can sit
  at. `test/plan-reach.test.js` compares the generator's constant against the
  prop's own geometry, so a change there has to reach the generator.
- **Nobody may build in the doorway.** The room had already written this down:
  `randomInteriorPoint` refuses to let a wanderer stop within `DOORWAY_DEPTH` of
  the opening, because anybody idling on the way in is somebody every later
  arrival has to get past. Those are the numbers the plan reserves, and the authored
  bin was later moved out of exactly that rectangle for the same reason.
- **A standing spot must be somewhere a person can stand.** The nav grid keeps
  walkers 0.6 off the walls and the cutaway edges, so a spot inside that strip is
  a spot nobody can reach however clear the floor looks.
- **Nothing may stand where `applyLayout` would not keep it.** Import clamps a
  prop's centre into the room by `LAYOUT_MARGIN`, so a plan that puts one outside
  that is a plan the room quietly rearranges on the way in.
- **Every number is snapped to authoring precision as it is placed**, not on the
  way out. A plant placed at a scale of 1.6284 and stored as 1.63 grew its spread
  by three millimetres — enough that the desk beside it, whose position had
  rounded the other way, overlapped it by a hair. The plan that was checked and
  the plan that was stored were not the same plan.
- **Nothing may be put down that fences anybody in.** The one rule no rectangle
  can express: a bookcase that overlaps nothing at all can still seal the only way
  into the corridor behind a bank of desks. So each piece, as it goes down, is put
  through one flood fill against every standing spot already in the room — the
  editor's own `reachFault`, asked of a candidate — and a position that strands
  somebody is passed over for the next best. A bank of desks is tested as one
  piece, because that is how it goes down: two desks that each leave a way through
  can between them close the only one.

## What makes a seed *good*

Two different questions, and keeping them apart is the whole of the answer.

### The gate: does the room work?

`validate()` in `src/plan/index.js` is a hard pass/fail, and it is the room's own
rules rather than the generator's opinion of itself:

| | |
| --- | --- |
| **Somewhere to do every job** | One station able to do each of `JOB_ROLES` — census, intake, research, dispatch — read from the same table the furniture editor refuses deletions with. A room that cannot say who is in, cannot take work in, cannot look anything up or cannot get work out is not an office. |
| **Nothing on top of anything else** | Every rectangle judged by `floorFault()`, the editor's own arithmetic, against every other. Includes hanging off the floor. |
| **Everybody can reach their own standing spot** | One flood fill from just inside the door, against every place a person has to stand. |

There is no partial credit in there: a mailbox nobody can reach is not 90% of a
mailbox. A plan that fails is never shipped — instead the brief is **trimmed**
(desks first, then the planting, then the second couch) and fitted again, three
times, and then a small plain floor that is impossible not to fit. So
`generateOffice` cannot fail and cannot return a broken room, which is what makes
it safe to run on every new scene with nobody watching.

Two of those three now hold **by construction** rather than by inspection, and
that is the more interesting half of this section. Every placement — every
station, every piece of furniture, every plant, every bank of desks — is refused
if it would fence anybody in, which is the same refusal the editor makes on a drop
(`reachFault`), asked of a candidate before it is committed. It costs one flood
fill per piece placed rather than one per position scored, and it turned an
occasional failure into an impossible one: across three thousand seeds, "cannot be
reached" has not been reported since. The check at the end stays anyway, because
*cannot happen* is a claim, and a claim about a room is worth one flood fill.

What still fires is the first row: a wall can genuinely fill up. In two thousand
seeds, 1,902 offices fit at the first attempt, 73 needed a second, 18 a third and
7 the fallback — nearly always because a room with desks all round its walls had
no frontage left for a bookcase.

### The scorecard: is it a room worth working in?

That is a different question and it deserves different machinery, so
`src/plan/score.js` is six measures, each 0 to 1, each read off the finished plan:

| | | |
| --- | --- | --- |
| **seated** | ×3 | Desks the floor could seat, against the brief. |
| **daylight** | ×2 | How near the desks are to the window openings themselves — measured as a distance, because a room with glass on two of its four sides could never have *all* its desks by a window, and a measure whose best case is 0.4 is one nobody can read. |
| **teams** | ×2 | Desks whose nearest neighbour is a teammate. The plainest possible test of "teams sit together", and it needs no parameter. |
| **quiet** | ×2 | The printer and the drinks, scored on how far the nearest desk is from them. |
| **errands** | ×2 | How far a desk is from the work coming in and going out. The other side of `quiet`: a room can win that one by putting everything in a far corner, and then every job is a hike. |
| **floor** | ×1 | How much of the floor is still walkable floor. A band rather than a ramp, because both ends are wrong — 90% clear is a barn and 40% is a warren. |

`npm run plan -- --sweep=2000` prints the distribution, the gallery draws it under
each plan, and `npm run plan -- <seed>` prints it as bars:

```
  office     ████████████████████·····  0.84
  seated     █████████████████████████  1.00   desks the floor could seat, against the brief
  daylight   ████████████·············  0.49   how near the desks are to a window
  teams      ██████████████████·······  0.75   desks whose nearest neighbour is a teammate
  quiet      █████████████████████████  1.00   the noisy machines kept off the working floor
  errands    ████████████████████·····  0.81   how far a desk is from the work coming in and going out
  floor      █████████████████████████  1.00   how much of the floor is still floor
```

Across two thousand seeds: **median 0.84**, tenth percentile 0.77, worst 0.61.

**It is deliberately not a gate**, and that is a judgement rather than a gap. A
generator that threw away rooms below a quality bar would quietly narrow what a
seed can be — a spare two-desk back room with nothing green in it scores badly on
half of these and is a perfectly good office — and a score used as a gate becomes
a target, which is how every office ends up the same shape. What it is for is
*measurement*: `test/plan-score.test.js` holds the floor and the median down, so
"the layouts feel worse since that change" becomes a number somebody can point
at.

It has already earned that keep twice:

* **`teams` found the bench pitch.** Nineteen rooms in four hundred scored near
  zero on it, and every one of them had banks that were each perfectly one team's.
  The desks within a bank were 5.4 to 6.4 apart while two *rows* are 5.4 apart at
  the closest — so the desk in the next row was nearer to you than the one on your
  own bench. The pitch is 5.1 to 5.35 now, comfortably inside the gap between
  runs, and the count went from nineteen to six.
* **`seated` found the bookcase.** Forty-five rooms in a thousand were losing a
  third of their desks to a trimmed brief, because a floor with desks all round
  its walls had no frontage left for a shelf and the whole brief was refitted
  rather than the shelf being stood free. A bookcase with its back to a bank of
  desks is a thing offices have; twenty rooms in a thousand now need a second
  attempt instead.

### The sweep

```
  2000/2000 offices valid   31ms each
  attempts   first:1902 second:73 third:18 fallback:7
  shape      rows:608  pods:553  spine:338  perimeter:321  island:180
  desks      2:54  3:159  4:244  5:281  6:341  7:331  8:256  9:170  10:81  11:60  12:19 …
  office     min 0.61  p10 0.77  median 0.84  p90 0.89  max 0.95
```

Two thousand seeds, two thousand distinct floor plans. Four test files carry it in
CI: `test/plan-generator.test.js` is the sweep as assertions,
`test/plan-score.test.js` is the scorecard's floor, `test/plan-survey.test.js`
checks that a surveyed room is the room the generator planned, and
`test/plan-reach.test.js` is the one that keeps the generator honest about the
thing it cannot see — it applies generated offices for real, builds the **real
`NavGrid`**, and puts each room through the editor's own `strandedApproaches`,
with the desks' approach points read off `buildDesk` rather than recomputed.

That last test exists because `src/plan/reach.js` is a deliberate *second*
implementation of a question `NavGrid` already answers. It has to be: the nav grid
can only be built from a layout that has already been applied to the room, and
applying a layout in order to find out whether it is any good would mean
rearranging the office somebody is standing in. A second implementation of one
question is normally the wrong answer, and the test is what makes it safe — it
caught the two apart already. The grid blocks every cell a footprint *touches*
while the first draft of the check tested cell centres, which made the check
**more permissive than the room** and passed offices whose corners the agents
could not reach.

## Determinism, and why the streams are hashed

A seed's office has to be that seed's office, and the trap is worth naming because
Minecraft fell into it: derive per-feature seeds arithmetically from one root and
some seeds produce degenerate streams, so features start repeating along a
diagonal. Every stage here gets its own stream, hashed from the seed *and the
stage's name* — `hash("…/misty-quay-3100::desks")` — which cannot correlate two
stages that way.

It buys a second thing that matters more day to day: the stages are
**independent**, so changing how the planting works cannot reshuffle the desks. A
seed's room stays the room it was, feature by feature, as this code grows.

The one place that could have broken it is the scoring. A scan scores a few hundred
candidate positions and keeps the best; a draw per candidate would make the
stream's position depend on how many candidates there happened to be, so adding
one lattice step somewhere would move every later decision in the room. So the
tie-break is not a draw at all but a **field over the floor** — `fieldAt(seed,
what, x, z)`, a hash of the position — which has no order to depend on. Score it
forwards, backwards, or half of it, and the same position wins.

## What it deliberately does not do

- **It does not touch the room's shape.** 26 by 20, two walls and two open edges,
  one door, three windows: the nav grid, the obstacle map and every approach point
  are derived from those, and they are [deliberately not
  themeable](../user/buildings.md#what-is-deliberately-not-themeable). A
  generated office is a *layout*, which is the editor's domain — not a new
  building.
- **It does not write teams into the blob.** A team is expressed the way an office
  expresses one, by who sits together, and the layout format has no field for it.
  The grouping is in the geometry and in the reason sentence; nothing downstream
  needs to be told.
- **It does not put up walls or meeting rooms.** There is no kit for either. What
  the room has instead is the [zoning](../user/generated-offices.md#the-adjacencies-which-are-the-argument) —
  a quiet end, a break end and a goods end — done with furniture, which is what
  Bürolandschaft did with filing cabinets and potted plants for the same reason.
- **It does not pick your feeds.** A generated scene is filled with Test Data,
  because a new room with no feed is a black screen with no explanation. Point it
  at a real harness and the room stays as it is.

## Where the code lives

```
src/plan/
  rng.js        # seeds, and the streams a seed hands out: one per stage, hashed
  brief.js      # what this office wants: headcount, teams, kit, lounge, scheme
  floor.js      # the floor plate: rectangles, wall bands, the street, the blocks
  furnish.js    # the test fit: circulation, then desks, then stations, then dressing
  naming.js     # what came out, as a name and as a sentence of reasons
  reach.js      # can everybody get everywhere — asked of a plan that is not a room yet
  score.js      # the scorecard: six measures of a room that already works
  survey.js     # the plan of a room as it stands, whoever laid it out
  index.js      # seed in, office out: the blob, the look, the check and the retry
bin/
  office-plan.js          # the CLI: one plan, a sweep, or a gallery
  lib/office-plan-svg.js  # a plan as a drawing, shared by the gallery and the terminal
```

Nothing in `src/plan/` imports three.js, and that is not an accident: it reaches
`config.js`, `layout.js` and the editor's placement arithmetic and nothing else. A
generator you cannot run in a shell is a generator nobody sweeps.

## Read next

- [Tuning the layout generator](tuning-the-layouts.md) — how the rules on this page
  were arrived at. Almost every weight and threshold here was set, moved or thrown
  away because a number said so: a headless simulation of the office running, a
  taste model fitted to 146 pairwise human judgements over 74 frozen rooms, and an
  autonomous loop ratcheting on the composite of the two. It also carries the
  measured reasons a single number is *not* enough
- [Thirty offices, thirty seeds](../office-variety.html) — thirty consecutive seeds,
  scrollable, each with the name and the reasons it gave itself
- [Generated offices](../user/generated-offices.md) — the brief, the adjacencies, the naming
- [The furniture editor](editor.md) — whose `floorFault` and `reachFault` are the judge here
- [Extending the office](extending.md) — adding a prop the generator can then place
