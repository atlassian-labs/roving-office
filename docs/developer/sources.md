# The source model

*How several feeds share one room, and the two places a source's identity is not a
string.*

What a source *is*, from a reader's side — the pill, the redaction modes, the two reaping
clocks — is [connect your agents](../user/connect-your-agents.md). This is the browser-side
model behind it. To add one, the recipe is
[extending the office](extending.md#add-a-source).

## An office holds a set, not one

`src/data/feeds.js` runs one feed per selected source and merges them, **namespacing ids
per source** so two feeds cannot collide on a session id. That namespacing is what makes
the picker's live behaviour safe: a source ticked off and straight back on is a new feed
instance, so its newcomers cannot be mistaken for the crowd still walking to the lift.

This follows from a source being a costume rather than a building — if the harness is not
a room, there is no reason for one room to hold a single harness. See
[the spec on scenes and routing](protocol/aop-spec.md#34-scenes-and-routing).

Worth saying because it used to be otherwise: a change of sources rebuilt the world, so
the building, the furniture, the mail in flight and *every* feed's agents went with it —
an office emptied itself in order to add one source to itself.

## Capabilities are feature-detected, never named

A source that implements `sendJob` gets the **T** key. Nothing downstream ever asks what
*kind* of source it is talking to, which is why `T` can vanish from the keyboard and from
the `?` panel together with no source-specific branch anywhere.

The vocabulary a source emits is listed with the recipe in
[extending the office](extending.md#add-a-source).

## A mark is a texture, so `currentColor` cannot help

A source's mark leads the floating name tag, leads each row of the agents panel, and names
itself in full in the detail panel's **Source** row.

Marks keep their own colours everywhere, **including on the tag**, where the mark is
rasterised into a texture shared by every agent in the office. The two marks that ship
monochrome are handed the source's accent to paint with, since `currentColor` has no
cascade to read inside a texture — the same colour the panels give them.

## The office does not route on project id yet

An office id is derived from the git **remote**, not the directory, so every worktree and
every clone of one repo shares a single office — [spec §3.4.1](protocol/aop-spec.md), on
purpose.

But **every office fed by a harness currently sees every session from it.** The project
mapping in `~/.roving-office/projects.json` is carried in each event and is what that
routing will use when `AopSource` starts filtering on it; it is not yet what puts an agent
in a room.

To see what a checkout resolves to:

```bash
node bin/aop-send.cjs --print-project    # office id, branch, redaction mode
```

## Reception loads the door before the room

`src/wizard.js` imports nothing that draws, so the keycard field is live before three.js
has been asked for. The scene is imported **dynamically** and faded in over a drawn office
the page ships with, so if the scene fails to load the drawing stays and the door still
works. See `src/scene/vignette.js`.

That ordering is also the thing to remember when screenshotting reception: the vignette is
a dynamic import, so it is not in a shutter-at-load screenshot. Same trap as
[photographing a prop](prop-portraits.md).

## Read next

- [Extending the office](extending.md#add-a-source) — adding one
- [The AOP spec](protocol/aop-spec.md) — the wire format the live sources speak
- [Adapter notes](protocol/aop-harness-adapters.md) — what each harness can actually see
- [The Test Data source](test-data.md) — the one that makes its own weather
