# program.md — autonomous iteration on the office layout generator

You are improving the **layout generator** in `src/plan/`, which turns a seed into
a whole office. One number says whether you have succeeded. Read this file before
your first experiment and re-read the results log before every one after it.

```
Goal:      make generated offices better rooms to work in
Scope:     src/plan/brief.js src/plan/floor.js src/plan/furnish.js src/plan/naming.js
Metric:    office fitness, 0..1  (redefined 2026-09-06 -- see the note below)
Direction: higher_is_better
Verify:    node bin/office-fitness.js --seeds=96 --minutes=3 --quiet
Guard:     node bin/office-fitness.js --seeds=96 --minutes=3 --guard && node --test test/plan-generator.test.js test/plan-score.test.js test/plan-survey.test.js
```

## What "better" means

Five things, all of them at once. The metric is built out of them
(`bin/office-fitness.js`), and the reason it is one number is so that you can
ratchet on it — not because the five are interchangeable.

1. **Visually pleasing.** Proxied by the plan's own scorecard: desks in coherent
   banks, planting in the corners and window bays, the lounge as a group rather
   than furniture scattered about.
2. **People move efficiently and do not get blocked.** Measured by running the
   office headless (`bin/lib/office-sim.js`): walking frames spent inside the
   furniture, walkers who stop moving while still walking, how far people walk
   against how far it was.
3. **Errands are quick.** Time from work arriving to somebody holding it, from
   finishing to it being sent, from wanting a drink to having one, from a question
   to being at the shelf.
4. **It holds at any headcount.** Every layout is run at half its desks and at
   all of them, and the *worst* headcount counts as much as the average.
5. **It looks like a real office.** Clearances, street widths, cluster sizes, the
   noisy machines away from the quiet end.

## The metric was redefined, and old numbers do not compare

The `looks` component is a model of one person's taste, and it has now been fitted
to **three rounds of labelling: 74 rooms, 146 pairs**. Its weights are not guesses
— each is ten times that measure's pooled rank agreement with those labels
(`bin/looks-explore.js`, and the rule in `bin/lib/looks-fit.js`).

Two rounds ago `organised` and `amenity` carried half the judge's weight between
them; they pool at −0.190 and −0.140 and now carry none. `together`, which had
weight 1 and a *negative* agreement after one round, pools at +0.251 over three
and now carries 3.

Cross-validated — leave one room out, refit on the other 73, score the room the
weights never saw — the judge agrees at **+0.29**. In sample it reads +0.37. That
gap is why `looks` is still only a quarter of the fitness.

The practical consequence for you: **any fitness number recorded before
2026-09-06 is not comparable with one recorded after it.** The results TSV has a
marker row saying so. Compare against the most recent baseline row, not against
the pilot.

## The one thing you must understand before you start

**Speed and office-likeness trade against each other, and the trade is real.**
Widening the gap between desks in a bench from 5.1–5.35 to 5.4–6.4 makes the room
measurably easier to walk about — detour +0.05, errand times better — and
measurably worse as an office, because the desk nearest yours stops being your
teammate's (`teams` −0.028). As a composite those two cancel almost exactly:
+0.0006, which is nothing.

So the metric alone cannot protect the room, and that is what the **Guard** is
for. `--guard` holds a floor under the components that make a room an office —
`seated`, `daylight`, `teams`, `quiet`, `floor`, `clear`, `reliable` — recorded
in `test/fitness-floors.json`. A change that breaches any of them is reverted
however good the number looks. Do not try to route around this. If you believe a
floor is wrong, say so in the results log and stop; it is a decision for a person.

## Start here: daylight

**`daylight` is 0.50 and everything else in the plan score is above 0.85.** It is
the largest deficit in the metric by a wide margin, it carries weight 2 of the
plan's 12, and nothing in the generator currently tries to move it.

Three facts, measured over 400 offices, that say the headroom is real rather than
geometric:

- Every arrangement scores the same: perimeter 0.528, spine 0.515, pods 0.511,
  rows 0.496, island 0.433. A 0.10 spread across five completely different ways of
  laying out a floor means none of them is *trying*.
- Desk count barely matters: 1–4 desks scores 0.521 and 8–10 scores 0.499. If this
  were a capacity limit — too many desks for the window frontage — small rooms
  would score far better. They do not.
- The measure is sound. `toGlass` (src/plan/score.js) measures to the nearest
  point of a window *opening*, so a desk in front of the glass scores as being in
  front of the glass and one behind the pier between two windows does not. Full
  marks within four units, nothing past twelve.

The room has window frontage on two of its four sides, so 1.0 is not achievable.
0.70 probably is, and would be worth about +0.013 on the total — roughly what the
entire twelve-iteration pilot found.

Where it is decided, and this took a wrong guess to find. `deskScore` in
furnish.js **already scores daylight** — `3 * max(0, 1 - toGlass/10)`, averaged
over the bank — so the first guess, that nothing was trying, was wrong. It is
trying and it is outvoted: seating people is worth `4` per desk *summed* while the
whole of `deskScore` is averaged, so a bank of four is chosen on 16 points of
"it fits" against at most 3 of "it has light".

But the real cause is one level up, in `plate` (floor.js):

**The door is in a window wall.** `DOOR` stands at x 3.4 in the z = 0 wall, and
the windows are in the z = 0 wall and the x = 0 wall. `plate` gives the desks
`quietSide` — the block *away from the door* — because a desk bank with the
entrance traffic running through it is worse than one without. So the room's two
rules are in silent conflict: "desks go where the traffic does not" points away
from exactly the wall "desks get the daylight" points at, and the block-level
choice has no daylight input at all. Every arrangement inherits it, which is why
all five score within 0.10 of each other.

## Where else to look

Things worth trying, roughly in order of how much they are likely to move:

- **`furnish.js` — the scoring that places things.** Every prop is placed by
  scoring every position it could take. The weights and the shapes of those
  scores are the biggest lever in the system: what a bank of desks prefers, how
  much a station cares about being near or far from the desks, how the lounge
  finds a corner.
- **`floor.js` — the circulation.** `STREET_W` and where the street lands decide
  the room's grain. Note that the street is a *placement reservation*, not a
  wall: narrowing it frees floor for props rather than making a corridor
  narrower, so it does not do what its name suggests.
- **`brief.js` — what an office asks for.** Desk counts, team sizes, how often
  each arrangement comes up, the intake and dispatch characters, how much
  planting. Changing the *distribution* of briefs changes the average room
  without changing any placement rule.
- **`furnish.js` — the arrangements themselves.** Five (`rows`, `pods`, `spine`,
  `perimeter`, `island`). A new one is a bigger change than a weight, and a
  better one would show up as a real gain.

Things that will not work, and why:

- **Making rooms emptier.** Fewer desks scores worse on `seated`, which is
  floored.
- **Making the brief ask for less.** Same floor.
- **Editing the scorer, the simulator, the agent layer, or the tests.** They are
  out of Scope. `test/plan-score.test.js` also fails if any measure stops
  responding to the room, so a measure that has been quietly turned into a
  constant is caught by the Guard.

## How to run an experiment

1. Read the last twenty rows of the results TSV and `git log --oneline -20`. Do
   not repeat an experiment that has already been tried and reverted.
2. Make **one** focused change. Atomic: if it breaks, everybody can see why.
3. `Verify` takes about forty seconds. That is the budget; do not shorten the
   seed count or the simulated minutes to go faster, because a number measured on
   a different sample is not comparable with the ones already in the log.
4. Keep if the metric improved **and** the Guard passed. Revert otherwise.
5. Write one sentence in the log saying what you tried and what you think
   happened. A kept change nobody can explain is worse than no change.

## Two numbers to keep in view

- **The noise floor.** `node bin/office-fitness.js --seeds=96 --noise=6` measures
  how much the number moves between *disjoint samples* of the same size: about
  0.008 at 96 seeds. But the tune set is *fixed*, so a comparison against the
  previous iteration is paired and deterministic — the same command on the same
  code gives the identical number to four decimal places. Any movement you see is
  caused by your change. The noise floor matters for whether a gain will
  generalise, not for whether it is real.
- **The holdout.** `node bin/office-fitness.js --hold --seeds=96 --minutes=3`
  runs seeds the loop never optimises against. Check it at every eval checkpoint.
  A gain on `tune` that does not appear on `hold` is the loop learning ninety-six
  particular offices, and it should be reported as such rather than celebrated.

## When to stop

- The Guard fails twice in a row for the same reason — the floor is telling you
  the cheap wins are gone.
- Six iterations with no keep.
- The holdout diverges from the tune set by more than the noise floor.

Then write a summary: what moved, what did not, what you would try next with more
budget, and which kept changes you would defend to a person who has to maintain
them.
