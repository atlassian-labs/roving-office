# The coplanar-face probe

```bash
npm run probe -- --building=skyscraper
npm run probe -- --sweep
npm run probe -- --sweep --assert=test/coplanar-baseline.json   # what CI runs
```

The `--assert` form turns the sweep into a pass/fail: each building's worst
visible pair is compared against the recorded baseline, and a regression exits
non-zero with the buildings named. After a *deliberate* geometry change,
re-record with `--record=test/coplanar-baseline.json` and commit the file.

The baseline carries the seed it was taken under, and asserting against a
baseline recorded under a different seed is refused rather than reported — see
[The same scene every time](#the-same-scene-every-time).

One bug has accounted for nearly every graphical glitch reported in this scene: **two faces landing on exactly the same coordinate.** The depth buffer has no way to order them, so the two surfaces trade places pixel by pixel as the camera moves, and it reads as flashing, crawling or shimmering.

It is very hard to find by reading the code. Three rounds of fixes were attempted by reasoning about the geometry; each round found real faults and each round missed the ones actually on screen. The reason is arithmetic: a kerb is fine at `WALK_Y + 0.04` until you notice a pavement slab is also `0.18` thick starting at `WALK_Y - 0.18`, and nothing in either line of code mentions the other.

So measure it instead. `bin/coplanar-probe.js` builds the scene headlessly, takes every mesh's world-space bounding box, and reports every pair of faces sharing a plane, ranked by the area they contest.

## Two rules that make the output readable

Without these, the list is swamped and useless.

**Only same-facing pairs can fight.** If one box's *top* sits on another box's *bottom*, the surfaces merely touch — normal, and safe, because only one of the two faces points at any given camera; the other is a backface. A real fight needs both faces pointing the same way. The probe reports the direction, so `y+` is a pair of upward faces and `y-` a pair of downward ones.

That distinction also tells you whether a hit matters. A `y-` pair buried under something solid — a deck underside below the ground plane, skirting inside a floor slab — is a hit but not a symptom. The `--sweep` summary reports the worst *visible* pair for this reason.

**Transparent surfaces cannot fight.** They blend rather than contest a pixel. The night-light pools are deliberately coincident planes, and glass balustrades are stacked with their posts. Anything `transparent`, or with `depthWrite` or `depthTest` off, is skipped.

## Reading a line

```
   12.960  y+=-1.120  #b6b2a8|#b6b2a8  z[-3.60,0.00] x[-3.60,0.00]
```

Nearly 13 square units of contested surface, on a pair of **upward** faces at `y = -1.120`, between two meshes of the same colour, over a 3.6 by 3.6 square. That was two pavement slabs crossing at a corner, both `WALK_Y` high — they were laid as four long strips that ran past each other instead of two L-shapes.

Same colour on both sides usually means duplicated geometry. Different colours usually means two elements sharing a rung on a depth ladder.

## Finding out what a pair actually is

The scene does not name its meshes, so identify by plane:

```bash
npm run probe -- --building=skyscraper --n=0 --dump=z:20.21
```

That lists every mesh with a face on `z = 20.21`, with size and extents — enough to match against the code. It is how the spandrel/slab-edge collision was found: a `26.00 x 0.42 x 0.20` panel and a `26.24 x 0.42 x 0.42` band, both with an outer face on that plane, because `SLAB_H / 2` and `D_SPANDREL` were both `0.21`.

It is also how the mansard's balcony edge was found, and that one is
worth reading because **the pair was too small to be in the top twelve**. The
report was flicker where the floorboards meet the railings and the planting;
`--dump=y:0.1` listed every top face on the floor's own plane and the answer was
right there in the extents. The floorboards ran to `x = 26.09` because a whole
final plank was laid however much of a bay was left over, and the stone ledge
started at `x = 26.00` — 0.09 of overlap down the whole open edge, both faces on
`y = FLOOR_TOP`. The same dump caught the wrap ledge at the far corner reaching
0.85 back into the room, which is the smaller patch of flicker the report also
mentioned. Both now stop at the room's own boundary.

The lesson is the dump, not the ranking: **a pair only has to be big enough to
see, not big enough to rank.** 1.8 square units sat 30-odd rows down a list of
1293, under a hundred pairs of distant rooftops that no camera ever gets near.
Rank by what the report describes — pick the plane the symptom is on and dump it
— rather than by area.

## The lift

A static scene only ever shows the doors shut and the car at the landing, so drive them:

```bash
for t in 0 0.25 0.5 0.75 1; do npm run probe -- --door=$t --only=leaf --min=0.01; done
for f in 1 2 3; do npm run probe -- --car=$f --only=car --min=0.01; done
```

The lift accounted for more reported flicker than anything else in the scene, and the reason it took so long is that **every round of fixes aimed at the doors**. The leaves are geometrically clean at every point of travel, and always were. Two faults sat either side of them:

* The **shadow map**, once. A leaf is `0.14` thick sliding inside a wall `0.2` thick, so the wall shadowed itself, and the acne moved with the doors because the caster did. The probe cannot see that class of fault — it only knows about surfaces contesting a plane — but proving the geometry clean is what pointed at the shadow pass. The leaves now cast nothing.
* The **threshold surround**, which is what was still on screen afterwards. Each jamb butted flush to the opening, so its inner face landed exactly on the wall's reveal: `2.14` square units contested down the full height of the door, twice over, and the largest visible pair in the building. The head did the same against the soffit above the opening. None of it needed the doors to move or the sun to be up, only a camera — so it read as "the lift is still glitching" long after the doors were innocent. The frame now laps over the opening, burying the reveal behind it.

The **car** was clean on the same measure only by luck of the filter: its floor, ceiling and back were each exactly as wide as the car, and the side panels' outer faces landed on that same width, so three pairs contested each side plane. They sit tens of rows down a 600-pair list and `--only=leaf` hides them, which is what `--only=car` is for. The shell is now a depth ladder.

Two lessons worth keeping. **`--only=leaf` answers a question about the leaves and nothing else** — reach for `--only=car`, or a colour, or `--dump`, before concluding the lift is clean. And **a fault that needs no animation to show is not in the animated part**: if flicker survives `--door=0`, stop reading the door code.

## The same scene every time

The scene **dresses itself at random** — book widths, which props land on a
shelf, which panes of the tower are lit, where the trees are planted. In a
browser that is variety. To a probe it is the difference between a measurement
and a sample, because "the worst pair of surfaces contesting a plane" in a
randomly dressed scene is a random number.

For a while it was exactly that. The same commit scored `0.97` on one run and
`1.55` on the next, so CI failed and passed identical trees at random: pipeline
#48 and #50 were one commit with opposite results, and `main` sat red for days
over a documentation change that could not have moved a vertex. A red build
everybody re-runs is a red build nobody reads, which is worse than no gate.

So the probe fixes the dressing. `seedRandom()` in `bin/lib/headless-scene.js`
replaces `Math.random` with mulberry32 — the same trick the scene already plays
on itself in `src/scene/outlooks/city.js`, so a project always looks out at the
same skyline — and the probe reseeds **before every build**, so a building
measures the same whether it is raised alone or tenth in a sweep.

**Seeding alone was not enough**, for a reason worth knowing before you write
another tool against this scene. three.js draws four `Math.random()` values to
make a UUID for every object, geometry, material and texture it creates: about
22,000 draws a build, against a few dozen for the dressing. So where a book's
width lands in the stream depends on how many *things* were made before it — and
the scene hands out materials from a process-wide cache, so the first build of a
process creates 273 that later builds get for free. Same seed, differently
dressed scene: `mansard/winter` scored 1263 pairs built alone and 1266 built
tenth in a sweep.

So the probe **builds from cold**, calling the same two resets `buildWorld()` in
`src/world.js` calls before it builds — `clearMaterialCache()` and
`releaseNightLightAssets()`. In a browser every build is a cold one, because
those caches are keyed on colour and would otherwise hand back the last theme's
materials. Doing the same here costs nothing, makes each build independent of
every build before it, and keeps the probe measuring the scene the app actually
raises rather than a warm variant of it that no reader will ever see. It also
means the probe leans on an invariant the app already depends on: a cache that
survives a rebuild is a theming bug there, so this cannot quietly rot while the
app stays correct.

### Varying the seed on purpose

`--seed=<n>` is how you hunt for pairs that only one dressing produces. Most of
the scene does not care — `warehouse`, `skyscraper` and `mansard` return the same
worst pair for every seed, because their worst pair is structural. `simple` moves:

```
seed 1  0.97      seed 7  0.97
seed 5  1.06      seed 9  1.41
seed 2  1.70      seed 10 0.97
```

Worth following one before you fix it: at seed 2 the `1.70` is `#6b5a4b|#6b5a4b`
in winter — one colour on both sides, so duplicated geometry by the rule above,
and true as far as it goes. It is two bare limbs, planted close and spun at
random, whose *bounding boxes* came to share a plane while the diagonal branches
inside them never meet. That is the over-report below, not a fault.

Which is the sharpest version of why this had to be fixed rather than absorbed by
widening the slack: the gate was failing honest commits over a known false
positive, and it was random which commit wore it.

Because a number is only comparable to another number from the same dressing, the
recorded baseline carries its seed, and `--assert` under any other seed stops
rather than quietly comparing two different scenes. Explore with `--seed` alone;
`--record` a baseline for a seed you intend to keep.

## The one limitation to remember

**It compares axis-aligned bounding boxes**, so it over-reports rotated and curved geometry. The largest hit in the warehouse — 77 square units — is the external stair's stringer and handrail: two parallel diagonal boards whose bounding boxes coincide exactly while their actual surfaces never meet. Tree canopies do the same, being spheres tangent to a shared plane.

Treat a hit on anything sloped or spherical as a question. Every fault fixed so far has been on axis-aligned boxes, where a hit means what it says.

## Options

| Option | Effect |
| --- | --- |
| `--building=<key>` | `simple`, `warehouse` or `skyscraper` |
| `--season=<key>` | `summer`, `autumn`, `winter`, `spring` |
| `--sweep` | every building and season, one summary line each |
| `--n=<count>` | how many pairs to list (default 12; `0` to list none) |
| `--min=<area>` | ignore pairs contesting less than this (default `0.05`) |
| `--only=<hex>` | only pairs involving that colour; `leaf` means the door leaves, `car` the lift car's shell |
| `--door=<0..1>` | slide the lift doors open by this fraction first |
| `--car=<floors>` | park the lift car this many storeys below the open floor |
| `--dump=<axis>:<n>` | list every mesh with a face on that plane |
| `--seed=<n>` | the dressing to measure (default `1`); vary it to hunt, leave it to compare |

The probe needs `three`, which the app itself loads from a CDN through the import map in `index.html`. On first run it fetches that exact pinned version into `node_modules/three` and caches it there. Nothing else is installed, and there is still no build step. That fetch, the canvas stub that lets a scene module be imported outside a browser, and the seeding above all live in `bin/lib/headless-scene.js` — shared with the [prop portrait tool](prop-portraits.md), which is the other thing here that runs scene code in Node.
