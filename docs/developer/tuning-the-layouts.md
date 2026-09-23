# Tuning the layout generator

[The layout algorithm](layout-algorithm.md) explains how a seed becomes an office.
This explains how we found out whether the offices were any *good*, and it is the
more useful document of the two — the generator is a few hundred lines of scoring
rules, and almost every one of those rules was set, moved or thrown away because a
number said to.

Five things the offices were asked to be:

1. visually pleasing
2. easy to move around, nobody blocked
3. quick to fetch a job, send one, and get a drink
4. still all of that at any headcount
5. like a real office

Four of those five can be measured. The first cannot, so it was **fitted to a
person's judgement** — 146 pairwise comparisons over 74 rooms, in three rounds.
That is the part worth reading about, and the part with the most ways to fool
yourself.

## Contents

- [The gallery](#the-gallery) — thirty offices, if you would rather look than read
- [The rig](#the-rig) — one number, and what goes into it
- [Teaching it taste](#teaching-it-taste) — three rounds of labelling, and a judge
- [The ratchet](#the-ratchet) — an autonomous loop against that number
- [What we learnt](#what-we-learnt) — the parts that generalise beyond this project

## The gallery

**[Thirty offices, thirty seeds](../office-variety.html)** — seeds `variety-1` to
`variety-30`, in order, nothing hand-picked and nothing rejected. Each one carries
its own generated name, the sentence explaining why it is laid out that way, and
its three scores. If you want to know what the tuning below actually bought, that
page is the answer: five arrangements, 2–9 desks, eleven colour schemes, rug areas
that read as rooms-within-rooms, and lounges where the seats face each other.

Regenerate it with:

```sh
node bin/scene-map.js --seed=variety-1 … --size=560 --out=docs/images/variety
```

## The rig

`bin/office-fitness.js` is one number for the whole generator, and it is the most
load-bearing file in the tuning work — a loop can only ever be as good as the
number it ratchets on. Three parts:

| part | weight | what it is |
|---|---|---|
| **plan** | 0.40 | the scorecard in `src/plan/score.js`: seated, daylight, teams, quiet, errands, floor |
| **flow** | 0.35 | the office *run*, headless, in `bin/lib/office-sim.js` |
| **looks** | 0.25 | a model of one person's taste, `bin/lib/looks-judge.js` |

**flow is a simulation, not a heuristic.** `openRoom()` builds the real room with
the real agent layer and no renderer, then re-furnishes it per layout and runs it
at a fixed 1/30 timestep. It measures how long a collection, a dispatch, a lookup
and a drink actually take, how far people walked against how far it was, how many
frames they spent inside the furniture, and how many errands nobody ever
completed. Every layout is run at half its desks and at all of them, and the
*worst* headcount counts as much as the average — that is goal 4, and it is the
one a static score cannot reach at all.

Three rules keep the number honest, and they matter more than the weights:

- **A held-out seed set.** `tune-*` is what the tuning sees; `hold-*` is a disjoint
  set it never does. Seeds are strings, so two prefixes give two sets that cannot
  overlap however many are drawn.
- **Nothing in the rig is in scope.** The generator is mutable; the scorer, the
  simulator and the agent layer are not. The cheapest way to stop agents bumping
  into furniture is to edit the walker.
- **Every component is printed.** A composite that only shows its total is a
  composite nobody can argue with.

### Floors, and why a single number is not enough

Widening the gap between desks in a bench from 5.1–5.35 to 5.4–6.4 makes a room
measurably easier to walk about — `detour` +0.05, errand times better — and
measurably worse as an office, because the desk nearest yours stops being your
teammate's (`teams` −0.028). As a composite those cancel almost exactly: **+0.0006,
which is nothing.** Measured, not supposed.

So office-likeness is a **floor** rather than a dial. `--record` writes the current
value of each floored component to `test/fitness-floors.json`; `--guard` fails if
any has fallen by more than 0.01. A change that breaches a floor is reverted
however good the total looks.

Calibrating that took a planted bug: the bench-pitch change above scores +0.0006
as a composite and is caught immediately as a floor breach. A geometric mean
instead of a weighted sum was *worse* at catching it.

`test/plan-score.test.js` also fails if any measure scores identically across 60
offices — because a floor cannot see a measure that has been quietly deleted, and
gutting one raised the score by +0.0021 before that test existed.

## Teaching it taste

"Visually pleasing" is the goal no measurement reaches on its own, so it was
reached the way subjective quality always is: ask somebody, carefully, then build
a judge that agrees with them and **check that it does**.

### How the asking works

`bin/looks-pick.js` chooses a round's rooms and freezes them. `bin/looks-ask.js`
builds a page of pairwise comparisons. `bin/looks-check.js` fits a Bradley-Terry
ranking from the answers and reports the rank correlation for the judge and for
each measure. `bin/looks-explore.js` does the same for *candidate* measures that
have not earnt a weight yet.

Four choices in that pipeline, each of which was learnt the hard way:

**Pairwise, not a score out of five.** People are reliable at "which of these two"
and unreliable at "how good is this". An absolute scale drifts over a session, so
room 3 and room 15 end up graded against different standards.

**The judge reads a layout blob, not a built room.** The first version read the
generator's output, which meant every label expired the moment the generator
changed — a label is attached to a *room*, and a seed's room is whatever today's
code says it is. Correlating yesterday's judgements against today's scores took an
agreement of +0.40 and turned it into **+0.01**, not because the measures got worse
but because the rooms had been swapped out underneath them. Layouts are now frozen
before any picture is taken, and verified byte-identical afterwards.

**Rooms are stratified on whatever is being tested.** Round one asked about
eighteen rooms from a generator that could not overlap rugs and could not stand a
plant away from a wall. When both arrived there was no evidence either way, and
the measures written for them could not be validated on anything.

**Check a trait varies before splitting on it.** Round three's first attempt
balanced on "gridded desks" and came back with an empty bucket, because 256 of 260
candidate offices are gridded — desks go down on a lattice with quarter-turn
facings. A trait that is 98% true is not a split, it is a constant with a rounding
error.

### What three rounds did to the answers

| measure | r1 (18 rooms) | r2 (16) | r3 (40) | pooled (74) |
|---|---|---|---|---|
| `interest` | +0.317 | +0.076 | +0.365 | **+0.291** |
| `together` | −0.156 | +0.406 | +0.372 | **+0.251** |
| `covered` | +0.276 | +0.326 | +0.111 | **+0.198** |
| `divided` | −0.168 | +0.221 | −0.092 | −0.043 |
| `balance` | +0.247 | +0.159 | −0.058 | +0.063 |
| `quarters` | +0.117 | +0.335 | −0.103 | +0.045 |
| `organised` | +0.098 | −0.115 | −0.350 | **−0.190** |
| `amenity` | +0.179 | −0.159 | −0.276 | **−0.140** |

Read the columns before the numbers. **Four measures changed sign between rounds
one and two.** That is not two different tastes; it is one taste measured twice
with too few rooms.

A rank correlation over *n* rooms has a standard error of about `1/sqrt(n-1)`.
Sixteen rooms is **±0.26** — so no single round could tell +0.3 from zero, and
round one's headline "+0.527 agreement" was never an estimate of anything. It was
hand-picked weights scored on the eighteen rooms they were picked for.

**Pairs buy a better ranking of the rooms you have. Only rooms buy power.** Round
two spent 53 pairs on 16 rooms and was less informative than round three's 64 pairs
on 40.

Two measures were promoted on round two's evidence and reduced to nothing by round
three (`balance`, `quarters`). One candidate, `breathing`, scored +0.524 in round
two — the strongest agreement anything has ever managed here — and −0.089 in round
three. Had it been promoted it would have outweighed everything else in the judge.

### Fitting the weights

Weights come from a **rule**, not a hand: each is ten times that measure's pooled
rank agreement, floored at zero (`weightsFor` in `bin/lib/looks-fit.js`). A rule
can be cross-validated; a hand cannot.

The rule has to be **continuous**, and that took a wrong turn to learn. The first
version gave weight only once agreement cleared the noise floor, which reads as
caution and is a cliff: leaving one room out moves an agreement by hundredths, and
hundredths either side of a threshold switch a whole measure on or off —
*systematically*, because the room a measure agrees with is the room whose removal
drops that measure below the line. Cross-validated agreement came out at −0.01
against +0.42 in sample, which looked like a judge that could not generalise and
was really a rule that could not be tested.

Its one real weakness is **collinearity**: it scores each measure alone and cannot
see two of them reading the same variable. `planted` pools at +0.171 and positive
in all three rounds, so the rule wants to give it 1.7 — and adding it *lowered* both
the fit and the cross-validation, because `interest` already reads the plant count.
It is declared `collinear: 'interest'` and excluded, which is model selection
rather than hand-tuning: the reason is structural, known in advance, and folded
into the rule so the cross-validated figure still measures the procedure in use.

**Where it ended up:**

```
JUDGE, in sample          +0.374
JUDGE, leave-one-room-out +0.292
```

+0.29 is real and it is weak. It is why `looks` is still only a quarter of the
fitness, and it should go up when there are enough labels to earn it.

### The one thing that worked immediately

Everything above is inference. One requirement was simply *stated*:

> Sofas and armchairs, side tables etc. should always face each other, or face at
> 90 degrees to each other, never away from each other.

Measured over 400 offices before it was enforced: **43% of seats faced away from
their own group** and **55% of side tables stood behind the back of the seat they
served**. It is now a refusal in placement and an assertion in
`test/plan-generator.test.js` — 0% and 0%.

And then `together`, the measure of exactly that, went from −0.156 to +0.406 in the
next round and stayed there. **A stated rule belongs in a test, not in a judge.**
A judge is for what somebody cannot articulate; anything they can say outright is
an invariant, and weighing it against being near the coffee machine is a category
error.

The same applies to `amenity` — "easy access to coffee / research" — which pools at
−0.140. It is a real requirement, it is invisible in an overhead render, and the
simulator already measures it properly in seconds. Two votes in the judge were two
votes for a thing the labels know nothing about.

## The ratchet

With a number and a guard, the generator can be improved by an autonomous loop:
read the log, make **one** focused change, verify, keep or revert, write down what
happened. `program.md` is the brief it works from and `autoresearch/*/results.tsv`
is its memory. The skill is vendored under `.claude/skills/autoresearch/`.

Two runs so far.

**Pilot, 12 iterations:** +0.0122 on tune, 3 kept. Two of those gained on tune and
*lost* on the holdout and were reverted — which is the holdout doing the only job
it has.

**Main run, 21 iterations:** +0.0213 on tune and **+0.0150 on the holdout**, 6 kept.
It stopped itself by the brief's own rule — six iterations in a row without a keep
— rather than running out of the fifty it was given.

```
daylight  0.4943 -> 0.6587      covered   0.5547 -> 0.7049
together  0.6480 -> 0.7082      zoned     0.6634 -> 0.8052
```

The target was found by looking rather than guessing: `daylight` sat at 0.50 while
every other component of the plan score was above 0.85. All five arrangements
scored within 0.10 of each other on it and desk count barely mattered, so it was
not a window-frontage limit — and the cause was one line. **The door is in a window
wall.** `plate` gave the desks the block *away* from the door, because a bank with
the entrance traffic running through it is worse than one without, so "desks away
from the traffic" pointed at exactly the block "desks get the light" pointed away
from — and the block-level choice had no daylight term at all.

The single best change was not a placement rule at all. Iteration 11 shifted
`brief.rugs` so rooms ask for more of them, and gained **more on the holdout
(+0.0120) than on the tune set (+0.0082)**. Changing the *distribution of briefs*
changes the average room without changing any rule.

### The loop's most useful output was its failures

- **A change to the number of draws is a change to the whole room.** One iteration
  wrote `max(range(), range())` where there had been one draw. Every later decision
  in every office was re-rolled, so its guard failure meant nothing. Transform the
  draw; never add one.
- **Hand-set constants can be at a local optimum, and you can prove it.**
  `STREET_W` fails the guard at 3.0 (`reliable`) and at 2.0 (`clear`). The
  desk-on-a-lane bonus fails at 3.5 and at 0. Both bracketed in both directions —
  and the log says so, so nobody tries again.
- **Harshness can be the point.** The rug-join rule tests for a shared edge, exact
  to a hundredth. Replacing it with a continuous "how nearly does this fill its
  bounding box" — on the reasonable theory that a near miss is nearly a rectangle
  — dropped rectangular rug areas from 62% to 46% while the metric did not move at
  all. A 0.9 fill earning most of the bonus is enough to beat holding out for a
  true rectangle.
- **One holdout sample of 96 seeds has sd ≈ 0.005.** One iteration looked like a
  −0.0069 holdout regression on a single sample and was flat on two. Below about
  0.010, check with `--noise=2` before believing it.

### When a floor is wrong

`zoned` — "each group of furniture stands on a rug" — vetoed the first two attempts
at the daylight fix. Desks pulled towards the glass sit where a rug's nine by seven
will not fit, so rug coverage fell and the floor breached.

That is a floor misfiring. A floor exists to stop the loop trading *office-likeness*
for speed, and `zoned` is not office-likeness — it is a proxy for one person's
taste, it is the weakest measure the labelling supports (+0.112 pooled, −0.011 in
the largest round), and `daylight` is both a stated goal and floored itself. **A
taste proxy may not hold a stated goal hostage.** It was removed from `FLOORS`, on
the record, as a decision taken outside the loop — which is what `program.md` tells
the loop to do when it believes a floor is wrong: say so and stop.

Rug coverage is still *scored*; it no longer has a veto. `covered`, the
better-supported measure of the same property, went from 0.55 to 0.70 over the run.

One change was also kept **against** the number, at −0.0012: rectangular rug areas
are a stated preference and `compact` carries weight 1, so the metric under-prices
them relative to what was asked for. Said plainly in the log rather than hidden in
a rounding.

## What we learnt

The parts that are not about offices at all:

1. **Label the artefact, not the identifier.** Anything you ask a person about must
   be frozen at the moment you ask, or your labels decay silently as the generator
   improves.
2. **Get the standard error before the result.** `1/sqrt(n-1)` would have saved two
   measures from being promoted and one from nearly being.
3. **Fit with a rule so you can cross-validate it.** In-sample agreement is the
   number you optimised, not an estimate. Here the gap is +0.37 against +0.29 — and
   it was +0.53 against something much lower before there was enough data to check.
4. **Continuous rules can be tested; thresholded ones cannot.** A cliff in a fitting
   rule interacts with leave-one-out in a way that looks exactly like failure to
   generalise.
5. **A stated requirement is an invariant.** It goes in a test. Only what somebody
   cannot articulate belongs in a fitted model.
6. **A composite metric needs floors, and the floors need calibrating with a
   planted bug.** Two real effects at ±0.03 cancel to +0.0006, and a single number
   will happily sell you one for the other.
7. **Distributions are a bigger lever than rules.** The largest and most
   generalising win in 21 iterations changed what rooms *ask for*, not how anything
   is placed.
8. **Write the failures down in more detail than the successes.** Six of 21
   iterations were kept; the other fifteen are why the next person does not repeat
   them.

## Where the code lives

```
bin/
  office-fitness.js         # the number: plan + flow + looks, floors, guard, holdout
  sim-office.js             # one office, run and explained, when a number moves
  looks-pick.js             # choose and freeze a labelling round's rooms
  looks-ask.js              # the pairwise comparison page
  looks-check.js            # does the judge agree with the person?
  looks-explore.js          # candidate measures, every round, with the noise floor
  lib/office-sim.js         # the headless office: build once, re-furnish per layout
  lib/looks-judge.js        # the taste model, weighted by measured agreement
  lib/looks-candidates.js   # measures that have not earnt a weight
  lib/looks-fit.js          # Bradley-Terry, Spearman, and the weighting rule
docs/images/looks{,2,3}/    # three rounds: renders, frozen layouts, labels
program.md                  # the brief the autonomous loop works from
autoresearch/*/results.tsv  # every iteration, kept or not, and why
```

## Read next

- [The layout algorithm](layout-algorithm.md) — how a seed becomes an office in the
  first place, and what the scorecard's six measures are
- [Thirty offices, thirty seeds](../office-variety.html) — the output, with each
  room's own reasons
- [The furniture editor](editor.md) — the **Random** button, and everything else
  that moves a prop
