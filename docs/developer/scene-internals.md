# Scene internals

*The code side of the room and the buildings round it: where the constants live, which
rules keep the facades still, and the measurements behind the things that look arbitrary.*

The reader-facing tours are [the room, prop by prop](../user/the-room.md) and
[buildings and themes](../user/buildings.md). This is everything those two pages
deliberately leave out.

## Where things are declared

| What | Where |
| --- | --- |
| Projects and themes | `src/projects.js` (`BUILDINGS`, `THEMES`, `OUTSIDE_MODES`) |
| The floor plan, footprints, stations | `src/layout.js` |
| Prop builders, and the registry | `src/scene/props/`, `props/index.js` |
| Facade and storey construction | `src/scene/building.js` |
| Ways in from the street | `src/scene/approach.js` |
| Outlooks | `src/scene/outlooks/`, `outlooks/index.js` |
| Statuses and their colours | `STATUS_GROUPS`, `JOB_COLORS` in `src/config.js` |
| Status wording | `src/ui/format.js` |
| The gallery's framing | `src/scene/catalogue.js` |

`COLORS` is a **mutable singleton** that `applyPalette()` rewrites in place. Every builder
reads `COLORS.x` at build time, so a theme swap needs no palette threading — but nothing
may destructure `COLORS` at import time.

The material cache in `scene/build.js` is keyed on colour, so it **must** be cleared
between worlds, and teardown has to happen *before* the next build. Cached materials are
shared by reference, so building first would leave the new world holding materials that
teardown then disposes.

### Scene reflections

The main renderer bakes one reflection environment from broad warm and cool light panels.
It lives for the renderer's lifetime, across world swaps, and gives existing materials
something to reflect without adding lights to every frame. `applyTimeOfDay()` lowers its
intensity after dark alongside the existing sky and fill light. The visible sky and sun
still follow the clock, season and orientation.

### Four garden neighbourhoods

`src/scene/outlooks/alder-layout.js` owns the street centres, plots, park, crossings,
parking bays and pavement cuts. `alder.js` builds the shared kit, and `garden-districts.js`
provides the Warehouse, Tower and Paris plots, roof styles and elevation offsets. The
exterior dispatcher passes the building identity to the outlook alongside the season.

Warehouse uses broad factory masses, instanced sawtooth roofs and a loading apron whose
markings use the office facade's exported bay dimensions. Its driveway removes the kerb
and raised pavement. Tower uses taller glass volumes on planted podiums, facade bands
that preserve window proportions, and a short connection between two podium gardens.
Paris uses four-wing courtyard blocks with a merged zinc roof ring, dormers and chimney
pots; the church and iron tower occupy separate plots clear of the street grid.

The existing office buildings and approaches keep their dimensions. The grounded
Warehouse outlook is lowered by the exterior dispatcher. Tower keeps its existing
street datum, while the Paris district meets the bottom of its two-storey staircase.

The roads share one painted ground surface, so intersections cannot double up road slabs
or leave floating lane markings. Each crossing lands on pavement and has a sloped kerb
ramp at both ends. Paving is partitioned around ramps and parking bays; a painted rectangle
on an unbroken raised pavement would leave the original kerb in the way.

Building masses, roof planting, trees and paving use spatially grouped instances. The
facades share one colour atlas and one night-window mask, with mipmaps for distant grids.
The atlas provides window detail without a mesh for every window. Only nearby trees cast
shadows; street lamps retain their inexpensive ground pools. The district adds no real
lights or animation loop. Its canopy planting includes evergreen colour through winter.

`disposeSubtree()` releases instance buffers as well as geometry and materials. The
coplanar probe expands instances to their world transforms, checking world-aligned surface
normals so curved crowns' bounding boxes are not mistaken for planar walls. The layout
tests also check all district plots against roads and planted setbacks, crossing landings,
the loading-yard connection and non-overlapping pavement cuts. All four seasonal builds
are checked for finite instance bounds, no added lights and released instance buffers.

## Canopy House

The `canopy` building and native theme use `src/scene/canopy.js` for their oak floor,
timber structure, tall glazing, living wall and basket pendants. The visual direction
combines the supplied biophilic-office references with Pinterest's
[timber office](https://in.pinterest.com/pin/651192427409775227/) and
[planted coworking space](https://www.pinterest.com/pin/467459636344017265/): large panes,
warm wood, overhead greenery and nearby tree canopies. The geometry is procedural;
reference photographs are not shipped as assets.

`environment.js` selects this shell while retaining the shared 26 × 20 floor, door
position, stoop and prop anchors. The walls rise to 10.8 units. Shelves still support the
existing window ornaments; the living wall leaves a clear mounting area for the clock.
Permanent planters stay outside the editable floor. Agent entry, desk occupation and
departure are covered by `test/canopy-building.test.js`.

`src/scene/outlooks/canopy-garden.js` supplies the `canopy-garden` outlook in all four
seasons. A single textured plane holds the meadow and continuous path from the stoop.
The 160-unit garden texture retains its world scale on a 2,000-unit surface; its grass
fades to a plain border that clamps across the far field, hiding the former square edge.
Nearby trees cast shadows; distant trees and the three low pavilions do not. Seasonal
colour changes preserve some evergreen foliage in winter.

`src/scene/canopy-planting.js` collects curved leaf geometry and tapered branches into
static instance batches. The house and the near/far gardens each use one batch per
material. There are no leaf animation callbacks, alpha-cutout textures, transmission
passes or additional real lights. Tests cap the environment at 250 mesh objects and
350,000 triangles, check finite instance bounds and verify instance-buffer disposal
across every season. The shared six ceiling lights retain responsibility for interior
illumination; pendant bulbs use the existing night-light emissive handling.
World teardown also releases the sun's shadow render targets, so repeated building or
season changes do not retain the previous world's shadow textures.

Use **Scene → Building → Canopy House** in a Test Data office to review agent behaviour
at different camera positions, times of day and seasons.

## Three distinct office styles

Tide Wharf (`tide`), Dune Atelier (`dune`) and Lantern Court (`lantern`) each own a
shell, floor, palette, light specification and outlook. `src/office-styles/` contains
their plain theme/building data so `projects.js` stays independent of Three.js.
`src/scene/office-shells.js` maps the four custom ground-floor buildings, including
Canopy House, to their geometry builders and entrance-portal dimensions.

`environment.js` supplies the working door and stoop once, then mounts the selected
shell and floor. New architecture retains the shared floor dimensions, window ornament
and mail-flight anchors, and wall-clock location. The existing furniture models and
navigation remain common to every building. Selecting a building resolves its complete
native palette and lighting, even when the active scene was authored for another one.

The architecture carries most of the contrast: Tide uses a low glass-and-steel rhythm
against blue water, Dune uses solid warm masses with deeply recessed arches, and Lantern
uses dark timber grids and pale shoji screens around a restrained garden. Their outlooks
are `tide-harbour`, `dune-courtyard` and `lantern-garden`; each meets the common street
datum at the entrance and changes its dressing with the season. They use static meshes,
instanced repeated details, procedural textures and the existing night-light system.
Their scenery adds no real lights or animation callbacks.

The settings extend around the visible sides of the room and into the distance: a
continuous coast and harbour town for Tide, connected pedestrian alleys below layered
dunes for Dune, and garden paths through planted islands and water for Lantern. Repeated
boats, building details and planting are batched so density does not require a mesh per
object. Each outlook owns terrain beyond the common ground plane to keep its boundary
out of the review camera's range. The shared floor-clearance tests raycast the actual
landscape surfaces, including instances, to catch scenery entering the working room.

In the working app, select a building with `S` to compare the architecture across camera
position, season and time of day. Scene selection has no effect on a saved layout or
adapter connection.

`test/distinct-offices.test.js` checks native-theme switching, permanent floor clearance,
agent entry/desk allocation/departure, and all four seasonal builds. It caps each
environment at 250 mesh objects and 350,000 triangles, checks finite instance bounds and
verifies texture and instance-buffer disposal. The shared coplanar sweep covers all
eight buildings. Browser review also checks day/night legibility, mobile controls and
resource counts after repeated switches.

## The rules that keep a facade still

Almost every graphical bug in this project has been a version of the same one. These were
all learned the hard way.

- **Walls must be rotated into their face.** Build a wall in local space (length along x,
  thickness along z) and then rotate the group; a builder that ignores its orientation puts
  side walls across the middle of the building.
- **Everything must sit at or in front of the wall face.** These walls are solid boxes with
  no holes punched through them, so an element positioned "recessed into a reveal" ends up
  *inside* the backing and never renders at all. This silently made every window in the
  building invisible for two rounds: the reveal was added to cure z-fighting and instead
  buried the glazing 0.06 behind a face it could never show through.
- **No two surfaces may share a plane.** Coplanar faces at identical depth fight in the
  depth buffer, and the facade shimmers and looks half-transparent as the camera moves.
  Both rules together mean every element needs its own *positive* offset from the wall
  face — hence the explicit depth ladder at the top of `building.js`
  (`D_SIGN` < `D_GLASS` < `D_BARS` < `D_RING` < `D_PIER` < …). The
  [coplanar probe](coplanar-probe.md) is how you find the pair you just created.
- **The plinth has to actually reach the ground.** The street sits `STREET_Y` below the
  lowest floor plate, so the skirt under the bottom storey is sized from that shared
  constant. A fixed value leaves the building floating with a gap you can see straight
  under the walls through. Where there is no street to meet, `BASE_TO` in `environment.js`
  maps the aerial outlooks to their own floor. Without an entry, the tower stops in mid-air
  with daylight underneath it.
- **Anything that reaches the pavement needs the pavement's height.** The external
  staircase drops `storeysBelow × STOREY_H` *plus* `|WALK_Y|`; the storey line alone left
  the bottom tread hanging a step above the ground. `WALK_Y` is exported from `exterior.js`
  for exactly this reason.

`punched`'s stone surround is a **frame of four pieces**, not one box, and that is the
depth ladder biting again: `D_PIER` is in front of `D_GLASS`, so a solid surround is a slab
hung over the opening and every window in the building goes dark. Same fault as the
recessed reveal, reached from the other side.

The curtain wall's verticals are one fin per column *per wall*, not per floor, so the grid
can be as fine as the references without the mesh count following the floor count. Two
things this gets right that the first pass did not: the fins must be **in front of the
spandrels they cross** (`D_MULLION` > `D_SPANDREL`) or the floor bands swallow them and the
vertical line breaks up; and individual panes are drawn only where an office is lit, since
a ribbon plus fins is visually identical everywhere else.

Loading-bay positions are **exported** (`loadingBayFractions`, `loadingBayWidth`) so the
yard markings outside line up with the doors rather than keeping a second copy of the
numbers. The arcade's springing line is set low (`SPRING_Y` is *negative*) because a wider
opening means a taller arch head, and a high impost would push the crown up through the
signage band.

## Camera and landscape boundaries

The main orthographic camera keeps enough distance from its target for the widest zoom
and lowest allowed tilt. `camera-depth.js` moves the eye along its view axis and retains
400 units of background depth beyond the target. This leaves the projected framing,
zoom and picking unchanged, and repairs old saved views on restore. A short orbit can
put the bottom of the near clipping plane below the ground: everything in front of it
vanishes, leaving a straight strip of sky below even a very large sea. Increasing the
water geometry alone cannot fix that.

All eight outlooks also need terrain covering the full panned ground footprint. Alder,
Foundry, Rue Dauphine and Kestrel share one 2,000-unit street plane whose UVs preserve the
original 220-unit road atlas. Roads continue from its clamped edges, so intersections and
lane widths do not stretch. Canopy uses the same approach for grass; Tide, Dune and
Lantern already own extended terrain. These surface extensions keep their existing
triangle counts and add no lights or animation callbacks. `landscape-coverage.test.js`
raycasts the viewport corners across all buildings and seasons at the pan/orbit limits;
the camera tests separately check depth clipping, saved framing and picking.

## Outlooks: two things the retired prototypes taught

**The frame is smaller than it feels.** The camera is orthographic with a frustum of about
22, so the view at ground level runs roughly fifty units across. Every one of the retired
prototypes' outlooks was first built with its far field sixty to a hundred and twenty units
out — a pressure ridge, four mountains, an iron tower, all correct and all completely off
screen. Distant scenery belongs within about fifty units of the room, and the horizon at
forty to fifty-five.

**A low wide box seen from above is a sheet of paper.** Drifts, snow ridges and the folds
along a slope were all boxes to begin with, and every one read as card lying on the ground.
Flattened, stretched spheres cost the same and read as heaped snow — the same reasoning
turned the neighbouring Paris blocks from flat plates into hipped roofs, using a four-sided
cylinder for one mesh. When scaling one of those, **put the scale on a parent group**: a
mesh's own scale is applied before its own quarter-turn, so scaling it directly turns a
square roof into a diamond.

## The roof's three first-time mistakes

- **The second plane needs a direction, not just a rotation.** A quarter turn about y that
  sends the plane's *length* the right way (local `+x` to world `+z`) sends its *slope* the
  wrong way (local `+z` to world `−x`) — out over open ground with the ridge pointing away
  from the room. The rotation alone cannot satisfy both; it would need a mirror. So the
  slope direction is a parameter (`dir`), and the second plane slopes toward local `−z`.
  Built with the turn alone, the two planes end up in the same corner sloping across each
  other, which is exactly what the coplanar probe reported.
- **The planes must not run into each other.** The left one starts past the corner, because
  the back one already covers that square.
- **A wide deck at the ridge is a flat roof.**

## Ways in are one API

Both the hinged door and the lift answer `requestOpen()`, which is why arriving and leaving
is one piece of code rather than two. What differs is whether anybody has to wait: agent
arrivals and departures are gated on `lift.ready` via the `waitUntil` action, so nobody is
ever standing in an empty shaft.

The courier is the one asymmetry. He rides the car too, but the post cannot depend on the
ride: if the lift never comes a job still has to arrive, so
[job delivery](job-delivery.md) is not gated on it.

The lift is a small state machine — `away → arriving → open → closing → departing`.

### The staircase geometry is shared on purpose

It lives in `src/scene/approach.js`, which owns both ways in from the street, rather than in
the builder. `stairFlight(dropHeight)` works out the risers and hands back a descriptor —
including `route`, the walkable line up it, and `descent`, the same line reversed — and
`buildEnvironment` passes it straight out as `handles.stairs`.

Three parties then agree by construction: the carpentry that puts the treads there, the
courier (`scene/courier.js`), and the agent layer (`props.stairs` in `AgentManager`). A
tread width changed in one place used to be able to leave the other two walking through the
air.

The route is **four points, not one per tread**, because the pitch is constant: the straight
line through the tread noses *is* the flight, so interpolating along it puts feet on the
treads the whole way up, and it stays right when the storey height changes and the step
count with it. Heights are tread tops, since that is what is stood on.

Agents walk it with the `follow` action (`agents/states.js`), which is `stepTo` for a line
of points with heights. The nav grid is one flat plane and cannot express a climb, and there
is nothing to find anyway — a flight of stairs is a route, not a choice.

**Taking it in turns**: the ordinary separation pass skips anybody on a route
(`crowd.js`), and until a walker is actually on the flight `follow` keeps them off it. Only
a walker who is *on* the flight can hold anybody up, and nothing can hold up a walker
already on it — which is what keeps two people from deferring to each other forever and
what makes the queue always drain. `test/stairs-queue.test.js` measures the flight the
warehouse actually builds and holds both halves down.

**An agent is not interruptible while arriving.** Work is announced within a second or two
of a spawn, and replacing the arrival list would leave somebody a storey down the stairs
with only the room's flat floor plan under them — striding home through the air — or hidden
in a lift shaft waiting for a car nobody is calling any more. `AgentManager._begin` queues
behind an arrival rather than replacing it, and `rec.arriving` is what says so.

The mansard's glazed-in stair is keyed off the **building name** rather than a data field,
because it means moving part of a wall. It also means the mansard's back wall has no
windows, so anything that stands on a back-wall sill has nowhere to stand —
`windowTroughPlacements`'s exclusions and `logoPlacements` in `layout.js` are both that.

## Desks, and why they are booked at the door

A desk is claimed as an agent walks in and released in exactly one place, when its owner
leaves the building.

Booking it per *job* meant handing it back between jobs, so an agent returning from the
mailbox took whichever desk happened to be free. People visibly swapped seats, and because
the search takes the first free desk, everyone piled onto the low-numbered ones while the
far corner sat empty.

There is one other way to lose a desk, and it is the editor deleting it out from under you.
That is not a shift ending, so it is not treated as one: whoever was sitting there stands up
and is handed a free desk immediately if the room has one — see
[the editor](editor.md#the-headcount-is-the-desk-count). Who a desk belongs to is otherwise
invisible, since a booked desk with dark screens looks exactly like a free one, which is
why the editor names the occupant in its `Assigned to` row.

## The board on the second screen

Two things about it are deliberate.

It is **dark** because the board is also its screen's emissive map, so a white theme would
come through as a white rectangle — a lamp, not a screen. It borrows the code editor's night
palette so the two monitors look like one machine.

And there is **one canvas per desk** rather than one shared texture. Five canvases cost
nothing, and it buys five boards with their own cards on their own schedule instead of five
identical ones twitching in lockstep. The texture is only re-uploaded while a card is
actually in flight, at 20Hz.

## The mid-job coffee run lives in the room, not the feed

`AgentManager` counts seated working time and rolls for it, rather than the feed asking for
it. A long stretch at a desk is the room's own observation, so it works for a live harness
exactly as well as for Test Data.

## Statuses

`STATUS_GROUPS` in `src/config.js` holds the nine statuses, their four families, their
colours and their wording; the flat list and the colour map are **derived** from it rather
than kept alongside it. Some statuses carry an `alone` form for when they have to stand up
in a roster row on their own — `drinking` reads "drink" under the Idle heading and "Getting
a drink" beside a name.

The colours a *job* is described with are a separate palette (`JOB_COLORS`, turned into
words by `src/ui/format.js`) and deliberately not this one. A job's outcome and an agent's
state are different questions, and one green answering both is how a panel starts lying.

`Agent.refreshTagVisibility` decides name-tag visibility on **depth alone**, since
everywhere an agent can stand outside the room is behind the back wall.
`AgentManager.update` calls it for everybody once a frame — it has to be as true of somebody
standing still as of somebody walking.

## Subagents are ghosts

**Designed, not yet rendered.** The events already arrive — the Claude adapter sends real
child sessions with their parent link — and `AopSource` deliberately drops them
(`TODO(ghosts)`) rather than spawn them as ordinary characters, because one fan-out would
otherwise evict every real session from the room. What follows is the shape the scene owes
them.

A subagent does not walk in and does not take a desk. It **materialises at its parent's
workstation as a translucent clone of them** — four people crowded around one screen, pair
programming. The parent keeps the chair; each ghost pulls up a phantom copy of it, fanned in
a shallow arc around the monitors and alternating sides as they arrive.

Ghosts are 40% opaque at 0.85 scale, cast no shadow, wear their `agent_type` on the name tag
instead of a person's name, and type on a phase offset so they do not move in lockstep.
Crucially **they never travel**: a ghost doing a bookshelf-class lookup turns bookshelf-blue
*in its seat*, because four characters pathfinding at once would destroy the one-screen
reading. When a ghost finishes it slides a page onto the parent's desk and dissolves.

The parent stays `working`, not `waiting` — it is not blocked on *you* — and carries a `×N`
badge for its live ghosts. Four are drawn per desk; beyond that the desk shows a `+N` tally.

Full rules in [the protocol spec](protocol/aop-spec.md#61-subagents-are-ghosts), and the
feed that will drive them in [Claude Code](adapters/claude-code.md).

## Where the sun is, and the history behind the number

Height comes from the season and position from the clock. Which way it sweeps *from* is the
one number a person picks, and it took a while to get right.

The room is a cutaway, so exactly two walls exist — the sage one at the back and the white
one on the left — and the only faces of them anybody ever sees are the insides, pointing
back at the camera. A wall like that is lit while the sun shares the camera's quadrant and
backlit the moment it leaves, which makes "light the room" and "throw shadows toward the
viewer" one tension pulling two ways.

For a long time it was resolved entirely one way. The sun was pinned to the far side of the
building so it would rake in through the windows, and it did — but it never came within 133°
of the camera at any hour in any season, and at midday it sat 178° away, two degrees off
dead behind. Both walls were backlit from dawn to dusk, and the brightest thing on screen
was the pavement outside.

It now sits 44° off the default heading at midday: everything on the floor keeps a lit side
and a shaded one, and late afternoon still swings round behind the building, which is where
a long warm rake belongs and where the lamps are already coming up to meet it.

Orientation is a **live** control like Time and Lights rather than a structural one like
Season and Building: nothing that gets *built* depends on which way the room faces, so the
number is written onto the theme in hand and the next frame has it.

### Seasons are a fraction of the swing

`sunTilt` is a fraction of the sun's full swing: +1 at midsummer, −1 at midwinter, with the
hemisphere turning it over.

**No season sits at 0.** Spring and autumn did, which put them on the equinox exactly: the
one day of the three months when the sun rises due east, sets due west, and gives everywhere
on earth twelve hours. It is also the one day whose terminator is not a curve but a pair of
straight meridians, so the map drew a flat vertical edge in two seasons out of four.

They sit at ±0.71 now — the middle of a season is about forty-five days from the equinox,
and the sun's declination a quarter of the way round the year is sin(45°) of its full swing.

The night band on the map is drawn from the terminator's own identity,
`tan φ = −cos(λ − λ₀) / tan δ`. Flattened onto a rectangle, the edge between day and night
is very nearly a sine wave — the projection of a great circle.

**There is no coastline data** and none that could be fetched: no build step, no dependency,
no network. Inventing one would look authoritative and be wrong, so the map draws the lines
that decide the light instead — equator, tropics, polar circles — with a dozen named places
to find a latitude by.

## After dark: two mechanisms, and why

Lamps ramp up on `lampOn` rather than `darkness`. `darkness` is capped through the day and
then steps straight to 1 the moment the sun sets, so driving lamps from it snaps them on.
`lampOn` tracks how *low* the sun is, reaching full at the horizon, which gives a gradual
dusk.

| | What it is | Where it is used |
| --- | --- | --- |
| **Fitting** | A real `PointLight` | The office interior |
| **Pool** | A flat disc of additive glow on the ground | Roads, and under each fitting |

The split is a **measured** decision, not a stylistic one. A forward renderer runs every
light for every fragment of every lit surface, so lights are priced by count. Giving each of
the nine street lamps its own light took the scene from 17.7fps to 8.8 in a software
rasteriser; the nine pools cost 0.2fps.

What decided it was asking what a street lamp actually has to light: a large, flat,
featureless road, with no relief on it for a real light to model. A disc of glow sells that
completely. The interior is the opposite — desks, plants and agents that need genuine
shading — so it spends real fittings and the street spends none.

Fittings are hidden outright in daylight rather than merely dimmed, which drops them from
the renderer's light list so a daylit scene pays nothing for them. They register themselves
in `userData.nightLight` and are gathered by one traversal in `collectNightLights()`; street
lamps are built three calls deep inside the exterior, and threading a registry down through
every intermediate builder would put lighting plumbing in a dozen signatures with no other
interest in it.

## Crowding

Any station can draw a crowd, so a station is a stretch of floor rather than a coordinate.
Behind that sits an **unconditional** separation pass in `src/agents/crowd.js`, so however
the walking worked out, no two bodies end a frame sharing space. Desks and couch seats never
needed it, because those are booked before they are walked to — which was the clue.

The rest of the movement rules are in [the physics of the office](physics.md).

## Read next

- [The physics of the office](physics.md) — the movement rules, and the holes in them
- [The coplanar-face probe](coplanar-probe.md) — finding the plane you just contested
- [Extending the office](extending.md) — adding a prop, a building or an outlook
- [Photographing a prop](prop-portraits.md) — the gallery tooling and its measurements
