# Photographing a prop

*How the object portraits are generated, and the measurements
that came out of it.*

There is no offscreen renderer. The scene is WebGL, so the only thing that can draw it
faithfully is a browser, and [`bin/prop-portrait.js`](../../bin/prop-portrait.js) lets one
do exactly that: it serves the repo on a spare port, opens
[`bin/prop-portrait.html`](../../bin/prop-portrait.html) in a headless Chrome once per
object, and lets Chrome save the PNG. Four at a time, about a minute and a half for the
lot.

```bash
npm run portrait                     # all of them, into docs/images/objects
npm run portrait -- --list           # what there is to photograph
npm run portrait -- --id=chair       # just one, while you are working on it
npm run portrait -- --group=greenery # one section
```

It serves the repo itself rather than starting `server.cjs`, deliberately: the app server
claims `~/.roving-office/endpoint.json`, and a docs tool has no business taking the
endpoint away from an office somebody is watching.

That part of it — finding a browser, the read-only server, the shutter and the flags it
needs — is [`bin/lib/shutter.js`](../../bin/lib/shutter.js), shared with
[`bin/scene-map.js`](../../bin/scene-map.js), which photographs a static scene the same
way. What stays in this tool is what it photographs and what it says about the result.
[`bin/office-shot.js`](../../bin/office-shot.js) is not a caller and cannot be: a
*running* office cannot be shot at the load event, so it drives Chrome over the DevTools
protocol and wants the opposite flags.

## Five details before you change any of it

**The catalogue holds the framing, not the tool.** An entry says which way its object
faces, where the camera stands, how high, and how much air to leave. The tool itself knows
nothing about chairs — it fits whatever it is handed from that object's own bounding box,
which is what lets one page photograph a succulent and a couch without being told the
difference.

**The box is fitted corner by corner, and it ignores light.** A bounding *sphere* is easy
and always too loose: a rug is far wider than it is tall, so a sphere around it is mostly
air. And additively blended meshes are left out of the box altogether, because in this
scene those are the glow pools that after-dark lighting lays on the ground — the street
lamp's is ten metres across, and a box that contained it produced a picture of a bounding
box with a lamp in the middle. Ordinary transparency stays in; the water cooler's bottle is
see-through and is very much part of the water cooler.

**It is a studio, not the room.** The office's rig is a low sun raking through one wall,
which is the wrong light entirely for a single object. A portrait gets a soft fill, a warm
key that casts, and a cool rim — that last one because the chair is nearly black, and
without an edge on it, it photographs as a silhouette. The tone mapping and exposure *are*
the office's, so brushed steel and a lit monitor read here exactly as they do in the room.

**`Math.random` is seeded from the id.** Half the scene is deliberately random — book
colours, kanban cards, which way a cactus leans. Without a seed, regenerating the gallery
would rewrite every file and a real change would be invisible in the diff. With one, each
object keeps its own look and keeps it between runs.

**The shutter fires at load, earlier than feels reasonable.** Nothing that fades, walks or
is dynamically imported will be in the picture — which is why the harness uses static
imports and renders a settled frame in a loop. It is the same lesson reception's
late-loading vignette teaches from the other side, and the same one in
[developing on it](developing.md#look-at-the-scene).

## Adding an object

Adding one is the cheapest documentation in this repo:

1. Export its builder from wherever it lives.
2. Add an entry to [`src/scene/catalogue.js`](../../src/scene/catalogue.js) — id, group,
   label, a one-line blurb, and the builder. View hints only if the defaults do not suit
   it.
3. `npm run portrait -- --id=<id>` and look at what comes out.
4. Check it in the [Item Library](../item-movements.html), which is the only gallery of
   the kit there is.

`test/scene-catalogue.test.js` fails if you skip step 2, so you cannot add half a prop.
The full recipe for a prop that agents actually *use* is in
[extending the office](extending.md#add-a-prop).

If it comes out blank, or as a wall of red text, that is the harness telling you the build
threw — it paints the stack trace into the page precisely so a screenshot of a failure is
still worth having. Open the page by hand for the console:

```bash
node server.cjs 8081 &
open "http://localhost:8081/bin/prop-portrait.html?id=chair"
```

The page takes `?face=` too, for looking round the back of something without editing the
catalogue.

## Two measurements the gallery argued into existence

Both of these are derived rather than typed, and both are exported from beside the thing
they are derived from. That is the pattern to copy: a tuned number with a body-scale
argument behind it belongs next to the geometry it was measured against, not as one more
literal in `Agent.js`.

### Why the standing desk rises 0.34 and not 0.54

The honest height would be the real one. A desk is 73 cm seated and about 110 cm standing,
and at this scene's body scale — an agent's head tops out at 2.51 for a body reading about
1.72 m, so roughly 1.46 units to the metre — that 37 cm rise is 0.54 units. It was 0.54
first, and standing empty it looked right.

It is 0.34 because of the arm. An agent's arm is one box on a shoulder pivot with **no
elbow in it**, so where a hand can be is a circle round the shoulder rather than a volume
it can reach into. The shoulder is at 1.78 standing, the hand hangs 0.86 below it, and the
keyboard rides up with the top — so the desk's height *is* the shoulder angle:

| rise | shoulder angle | hands, relative to the shoulder |
| ---: | ---: | :--- |
| 0.18 | -98.7° | 0.13 above |
| **0.34** | **-109.7°** | **0.29 above** |
| 0.54 | -124.7° | 0.49 above |

Seated typing is -97.3°. At 0.54 the arms come up half a unit over the shoulders and the
agent reads as typing above their own head — a desk too high for the person at it, which is
the exact ergonomic fault the real object exists to fix. At 0.34 the reach is 12° past the
seated one, which is somebody at a slightly high desk, and the top still stands clearly
above the row beside it.

So the trade is real and worth naming: a smaller rise than life, bought to keep the pose
honest. A body with no elbow cannot be argued with — and this is why
[`STANDING_TYPE_REACH`](../../src/scene/props/sit-stand.js) is exported from beside the
rise it is derived from.

### The telescope's eyepiece is the measurement everything else comes from

It sits at 2.10, a tenth under a standing agent's eye, which is what makes using it a pose
rather than a pause: `STOOP_BEND` in [`Agent.js`](../../src/agents/Agent.js) is derived
from exactly that gap, so the bend and the tripod cannot drift apart.

It is a small bend on purpose — 22.6°, because at this leverage the arc is mostly forward,
so the angle that lowers an eye 0.10 carries it 0.50 *in* towards the eyepiece, and leaning
in is the whole gesture. The height of the hub and the length of a leg are then whatever
they have to be to put the eyepiece there, computed rather than written down.

### The winter tree, and why the gallery is worth generating at all

**The winter tree is why this gallery is worth generating.** Its branches used to be six
small spheres sitting above the trunk, touching nothing. Across a road that read as a bare
canopy, which is all it had ever been asked to do — and at this range they read as exactly
what they were. A leafy tree hides its structure; a bare one *is* its structure. Nothing
here is retouched, so the picture said so on the first day it existed, and the tree got
real limbs: jointed to the trunk, forking near their ends, with the leader carrying the
trunk's line on up.

Two things came out of that fix. Every tree carries the same skeleton, so each one is
**spun on the spot** — with leaves on, a repeated arrangement is invisible, and with the
structure showing, a row of identical trees is wallpaper. And a bare tree has to be **the
same height as the leafy one**: the old trunk stopped well short of the summer canopy,
which made winter a different species rather than the same tree in January.

Two things came out of that fix that apply to anything else built this way. Every tree
carries the same skeleton, so each one is **spun on the spot** at build time — with leaves
on a repeated arrangement is invisible, and with the structure showing a row of identical
trees is wallpaper. And a bare tree has to be **the same height as the leafy one**: the old
trunk stopped well short of the summer canopy, which made winter a different species rather
than the same tree in January.

The cost is honest and worth knowing: thirteen meshes a tree against the old seven, and a
park plants thirty-four of them. That is why it is four bold limbs rather than a spray of
twigs — and bold is what survives the distance anyway.

### And why the printer's scale is not uniform

The geometry is authored at life size — 1.59 to the top of the feeder — because that is the
only size the proportions of a printer can be reasoned about at. The room then stretches
it: twice up in height, three quarters in plan. Both numbers were argued for. At life size
it was shorter than a desk is wide and read, from across the street, as a white box
somebody had left against the wall; doubled in every direction instead, it was a
two-and-a-half-metre cube of white that ate the corner it stands in. A printer is a tall
thing you stand in front of, and that silhouette is narrow. See `SCALE` and `PLAN` in
[`printer.js`](../../src/scene/props/printer.js).

## Photographing a whole office

The pictures of the *room* in the user docs come from a different tool, because an office
cannot be photographed with a shutter that fires at load:

```bash
node server.cjs 8093 &
npm run shot -- --out=docs/images/screens/office.png --hide-ui \
  --size=1600,1000 --wait=70000 --clip=395,80,875,700
```

`bin/office-shot.js` drives Chrome over the DevTools protocol instead of using
`--screenshot`, and it exists for one reason: **the office advances per drawn frame.** A
headless window is never on screen, so Chrome has no reason to composite and
`requestAnimationFrame` fires at a crawl. Timers keep running, so the feed spawns people
and hands them work — and not one of them can take a step. Whatever you set `--wait` to,
you get one agent standing by the door being renamed as they finish jobs they never walked
to a desk to do.

The fix is to ask for frames: the tool captures a throwaway screenshot every 30ms through
the settle period, because `Page.captureScreenshot` forces a composite. The
`--disable-*-throttling` flags were the obvious first guess and changed nothing.

`--wait=70000` is not superstition either. Test Data opens with its regulars and drifts
more in over a couple of minutes, so a shorter wait photographs an office that is still
arriving. `--clip` crops in the browser so one command still reproduces the exact file,
and `--hide-ui` drops the panels for shots where the room is the subject.

Do **not** pass `--force-prefers-reduced-motion` to this one, unlike every other
screenshot recipe here: motion is the thing it is waiting for.

## Read next

- [Extending the office](extending.md) — the full recipe for a new prop
- [Developing on it](developing.md#look-at-the-scene) — the headless screenshot loop and its traps
- [The coplanar-face probe](coplanar-probe.md) — the bug a new prop is most likely to introduce
