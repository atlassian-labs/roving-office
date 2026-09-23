// The layout: what furniture the office contains, where it stands, and every
// rule about adding, moving and removing it.
//
// Split out of config.js, which holds the constants a scene is built against —
// palette, statuses, room shell, camera. This file is the part that *changes*:
// a mutable singleton the whole app reads live, so moving a desk is a write
// here rather than a parameter threaded through the scene. The derived half
// (approach points, seats, nav-grid footprints) is re-worked by reviseLayout()
// after every edit, and the whole plan round-trips through layoutSnapshot() /
// applyLayout() — the furniture editor's persistence story.
//
// The rule of the split: config.js may not import this file. Structure is
// settled at authoring time; the layout leans on structure (a trough needs its
// window's span), never the other way round.

import { ROOM, RUG_COLORS, SOFA_COLORS, windowSpan, WINDOW_LEDGE_Y } from './config.js';

// Workstations: one desk == one agent thread, and the headcount is the length of this
// list (see `agentCapacity()`). Five is what the room was authored with rather than
// what it will hold — the list is read by everything that builds, blocks or sits at a
// desk, and the editor can add to it and take from it.
//
// `facing` rotates the whole desk;
// the occupant sits on the +z side of the desk in local space and looks at the
// monitors, so their world rotation is `facing + PI` (see sitRotation below).
//
// `standing: true` puts the desk on a sit-stand frame instead of four legs. It is a
// desk in every other respect — same top, same monitors, same occupant, same place in
// the headcount — which is exactly why it is a flag here rather than a kind of its own.
// The one thing it adds is that its surface travels, and that its occupant may work
// either sitting or standing.
export const DESKS = [
  { id: 'desk-1', x: 12.0, z: 8.0, facing: Math.PI },
  { id: 'desk-2', x: 20.5, z: 7.0, facing: Math.PI },
  { id: 'desk-3', x: 6.5, z: 13.0, facing: 0 },
  // The sit-stand desk, and it is one of the five rather than a sixth: an office does not
  // grow a desk because somebody wants to stand at it, and the headcount is this list's
  // length, so adding one would have hired somebody to justify the furniture.
  //
  // This one, of the five, for two reasons. It is the nearest desk to the camera and the
  // best lit, so the thing worth seeing is where it can be seen — a raised top only reads
  // as raised beside desk-3 at ordinary height, a few metres away in the same glance. And
  // it is not desk-1, which stands on the rug: the mat would have landed on the rug and
  // made a coplanar pair the probe fails the build over.
  { id: 'desk-4', x: 13.5, z: 13.0, facing: 0, standing: true },
  // Turned side-on so its occupant sits clear of desk-2's approach lane.
  { id: 'desk-5', x: 21.5, z: 11.5, facing: -Math.PI / 2 },
];

// Non-desk stations. Every prop in the room is a station with a purpose:
//   bookshelf    -> looking up information (graph / web retrieval)
//   waterCooler  -> idle refresh between jobs
//   couch        -> idle rest (can be sat on)
//   coffee       -> idle coffee break
//   mailbox      -> dropping finished work
//   bin          -> discarding failed / errored work
//   inbox        -> incoming job material (the cardboard boxes)
//   coatStand    -> agents hang a coat while they're in the office
//   printer      -> nothing yet: in the room and in the editor, with its standing
//                   room derived, but no activity sends anybody to it
/**
 * A station and the floor in front of it, with the direction between the two worked
 * out rather than written down.
 *
 * `lookRotation` is the heading from the approach point back to the prop, and three
 * things read it: the prop is turned to face its own approach point, the shoulder
 * axis for queueing runs at a right angle to it (agents/crowd.js), and it is the
 * fallback for which way a visitor turns. Hand-written, it drifted — the bin was 27°
 * out and the inbox a full 90°, so its boxes faced across the room and anyone
 * collecting from them stood side-on. Derived, it cannot disagree with the layout,
 * and moving a station or its approach point fixes all three uses at once.
 *
 * The authored `approach` is turned inside out on the way in, into a `facing` and a
 * distance. That is what lets a station be *moved*: an absolute approach point stays
 * behind when its prop walks off, while one measured from the prop's own heading
 * travels with it, and turns with it too. The numbers are the same either way —
 * `reviseLayout()` multiplies them straight back out — so writing it this way moves
 * nothing in the room.
 */
function station(kind, id, x, z, approach) {
  const dx = approach.x - x;
  const dz = approach.z - z;
  return {
    kind, id, x, z,
    // Which way the prop looks: at its own approach point, by definition.
    facing: Math.atan2(dx, dz),
    approachDist: Math.hypot(dx, dz),
    // Both derived by reviseLayout(). Seeded here so the shape is complete from the
    // moment the object exists.
    approach: { x: approach.x, z: approach.z },
    lookRotation: 0,
  };
}

/**
 * What each sort of station is, and how many of it the room may hold.
 *
 * The room used to answer both questions by the shape of `STATIONS` itself: a keyed
 * object, one entry per kind, so "one mailbox" was not a rule anybody had written but
 * a consequence of a mailbox being a *key*. That is the wrong place for it, because it
 * is unarguable — there was no way to say that a second bookshelf is fine and a second
 * outbox is not, and no way for the editor to add either.
 *
 * So the cardinality is written down. `max` is what `addStation()` enforces and what
 * the editor reads to decide whether to offer a kind at all:
 *
 *   * **Many.** A bookshelf is somewhere to look something up, and a big office has
 *     several; an agent goes to whichever is nearest and free, so two shelves are two
 *     independent sources rather than a queue.
 *   * **One.** Everything else. Some of it is physical — one coat stand, one coffee
 *     machine — but the mailbox and the inbox are singular for a stronger reason: they
 *     are where finished work leaves and new work arrives, and a room with two outboxes
 *     has an unanswerable question about which one the post is in.
 *
 * `hw` / `hd` are the floor a station blocks, as half-extents in the prop's *own* axes:
 * `hw` across its front, `hd` from its front to its back. Its own axes and not the
 * world's, so that a station which has been turned blocks the floor it is actually
 * standing on — see `obstacleFootprints()`, where one rule now covers a desk, a station
 * and a couch alike.
 *
 * These are the numbers `obstacleFootprints()` used to carry inline, and they are the
 * same numbers: the three kinds whose prop was authored facing along +x — the water
 * cooler, the coffee machine and the mailbox — had theirs written down world-first, so
 * their pair is swapped here and nothing else is touched. Several disagree with the way
 * their prop is actually modelled, because they were measured by eye against the
 * picture; that is the tuning the whole room has been walked against, so they are
 * carried across and must not be "corrected".
 *
 * `approachDist` is only a default, for a station the editor brings into being. An
 * authored station derives its own from the approach point written beside it, so
 * nothing in the room below is defined twice.
 *
 * ---
 *
 * `roles` is the *minimum* getting the same treatment the maximum got above, and it
 * took a while to notice the asymmetry. `max` was written down, so "no second outbox"
 * became a rule somebody had decided. The floor never was: `canRemoveObject` refused
 * to remove the last station of any *kind*, so every singleton was mandatory as a
 * side effect of there being one of it. Which meant the room insisted on keeping a
 * printer that has no job at all, and a coat stand the code already copes without —
 * and meant that adding a second bookshelf freed the first, so the rule was never
 * "the office needs a bookshelf" but "the office needs one of each kind it happens
 * to own". That is the shape making the rule again.
 *
 * So a kind says what it is *for*. A role is a job somebody walks somewhere to do,
 * one per behaviour that needs a destination, and a kind may do several: the mailbox
 * is where finished work leaves *and* where new work arrives, which is the whole
 * reason roles are a list. `JOB_ROLES` below says which of them the room cannot go
 * without, and `canRemoveObject` asks that question instead of counting kinds.
 *
 * The point is what it makes possible without touching any rule. A telescope for
 * looking things up out of the window arrives as `roles: ['research']`; add one and
 * the bookshelf becomes removable, because nothing anywhere says "bookshelf". A
 * second outbox frees the mailbox for `dispatch` while it is still the only
 * `intake`. `serves` is the one place a role is not specific enough — a tea drinker
 * wants the espresso machine and not merely any `refresh` station — so the kind names
 * what comes out of it and `_drinkBreak` prefers a match before falling back.
 */
export const STATION_KINDS = {
  // `serves` earns its keep here for the second time. A lookup already knew
  // which *sort* it was — `_research` has taken a `scope` of 'graph' or 'web' since
  // long before stations had roles — and the shelf has always answered for both, the
  // books for what the company knows and the globe on top for what it does not. Now
  // that a telescope can answer for the outside too, the scope is a preference over
  // two stations rather than a branch inside one, and `stationForRole` already knows
  // how to express that. No new vocabulary: the values are the scopes the feed sends.
  bookshelf: {
    label: 'Bookshelf', max: Infinity, roles: ['research'], serves: ['graph'],
    hw: 1.28, hd: 0.5, approachDist: 2.0,
    note: 'Where things get looked up. Several is fine — an agent walks to the nearest.',
  },
  // The other end of the same job: a question whose answer is outside the building
  // gets looked for outside the building. `research` too, so a room with a telescope
  // and no bookshelf is a working room and either one may be taken out — which is the
  // whole point of the roles, tested here for real rather than with a fixture.
  //
  // The footprint is the tripod's, not the tube's, and that is a correction: the first
  // version set `hd` to 1.16 to cover the objective's overhang at −z, on the grounds
  // that a deck overhead an agent walks through is what the printer's note above says
  // this table exists to prevent. That argument does not survive the arithmetic. The
  // tube's underside clears a 2.51-tall head beyond 0.51 of the centre line, and the
  // feet already reach 0.92 — so every part of the overhang low enough to matter is
  // *inside* the tripod's own footprint, and the rest is genuine headroom.
  //
  // What the over-deep rectangle actually did was steal the floor on the room side,
  // because the footprint is symmetric about the centre. That pushed the standing room
  // back to 1.9 and left an agent stooping at an eyepiece three quarters of a metre in
  // front of them. Both numbers come from `telescopeMetrics()` rather than a ruler.
  //
  // So `approachDist` is 1.52, and it is derived from the pose rather than picked: the
  // eyepiece cup stands 0.65 in front of the centre, a stoop carries an eye 0.50
  // forward (see `STOOP_BEND`), and the remaining 0.37 is half a head plus air.
  //
  // That last term is the one worth naming, because leaving it out is what the first
  // two attempts at this both did. `STOOP_BEND` is derived from where an *eye* goes,
  // and an eye here is the head's centre — but a head is a 0.62 box, so its face is
  // 0.31 further on. Standing them at the distance that puts the eye-point on the cup
  // therefore buries a third of the face in the eyepiece. Checked by looking at it from
  // the side, which is the only angle that shows the difference: face-on, touching and
  // half a metre apart are the same few pixels.
  telescope: {
    label: 'Telescope', max: Infinity, roles: ['research'], serves: ['web'],
    hw: 0.89, hd: 0.77, offX: 0, offZ: 0.22, approachDist: 1.52,
    note: 'For looking something up outside the building. Stands at a window; agents stoop to the eyepiece.',
  },
  waterCooler: {
    label: 'Water cooler', max: 1, roles: ['refresh'], serves: ['water'],
    hw: 0.46, hd: 0.36, approachDist: 1.7,
  },
  coffee: {
    label: 'Coffee machine', max: 1, roles: ['refresh'], serves: ['tea', 'coffee'],
    hw: 1.43, hd: 0.82, offX: 0, offZ: 0.22, approachDist: 1.7,
  },
  // Both, and the only kind that is: the post is where finished work leaves the room
  // and where new work arrives in it. A room may drop to one outbox or one inbox, but
  // not to neither, and while the mailbox is the only one of each it is the reason.
  //
  // `max: Infinity` since the post learned which box it is in. It was 1 for exactly one
  // reason — `Post` was a single queue with no notion of *which box* an envelope was in,
  // so two boxes would both have shown the same three letters — and the answer was to
  // give every envelope a box rather than to forbid the second box. `postBoxFor` above
  // says which one a delivery goes to, and each prop reads only its own tally.
  mailbox: {
    label: 'Mailbox', max: Infinity, roles: ['intake', 'dispatch'], serves: ['post'],
    note: 'Work arrives here and finished work leaves here. Several is fine — each delivery goes to one of them at random, and an agent collects from the nearest box holding something for them.',
    hw: 0.98, hd: 0.49, offX: -0.86, offZ: 0.35, approachDist: 1.7,
  },
  // `discard` is deliberately not a role the room must have. Failed work can be closed
  // where it stands — the pilot's own Close button already does exactly that, without a
  // walk to the bin — so a room with no bin is a duller room and a working one.
  bin: {
    label: 'Bin', max: 1, roles: ['discard'], hw: 0.33, hd: 0.34, approachDist: 1.55,
    note: 'Failed work gets crumpled into it. Optional: without one, work closes at the desk.',
  },
  // Also `intake`, and the difference from the post is what `serves` is for: post is
  // addressed and arrives from outside, stock is the pile an agent takes from when
  // nothing has been sent. Same job, two supplies.
  inbox: {
    label: 'Inbox', max: Infinity, roles: ['intake'], serves: ['stock'],
    note: 'A stack of boxes to take work from when no post is waiting. Have as many as you like.',
    hw: 1.25, hd: 0.72, offX: 0.02, offZ: 0.09, approachDist: 1.8,
  },
  // The office's own paper. Post comes from outside the building; a printout
  // is work the office made for itself, and that difference is the whole reason this is
  // a third channel rather than a second mailbox.
  //
  // **Both roles, and the two are different events.** The ticket asked whether a print
  // is an arrival or a product and said to decide rather than let the animation decide,
  // so:
  //
  //   * `dispatch` — a fax outward. Finished work is fed into the document feeder and
  //     leaves the building. `_deliver` asks for the nearest dispatch station, so which
  //     of the printer and the post gets used is a fact about where somebody sits, and
  //     no new rule was needed to make that true.
  //   * `intake` — and this is the half that makes it a *loop* rather than two
  //     unrelated jobs. Faxing is not silent: the machine prints its own copy of what it
  //     sent, and that sheet waits in the output tray as material for whoever needs some
  //     next. So the tray fills because the office has been working, which is exactly
  //     what "work the office produced for itself" means, and it gives the tray real
  //     state to fill and empty instead of the inbox's bottomless pile.
  //
  // `serves: ['print']` keeps it out of the post's business without a rule saying so:
  // `postBoxes()` filters intake stations down to the ones serving `post`, so no paper
  // plane will ever be aimed at a printer and no courier will throw a parcel at one.
  // Measured off the built prop rather than by eye, and the prop is authored at life
  // size and then stretched — twice up in height, three quarters in plan (see
  // `SCALE` and `PLAN` in scene/props/printer.js, which say why). That leaves 1.86
  // across the scanner deck, which overhangs the body, and 1.70 front to back once
  // the touchscreen and the output tray are counted. Both measured past the *body*,
  // not to it — a deck overhead and a catch tray at chest height that agents walk
  // through are the sort of thing this table exists to prevent. The rectangle is
  // symmetric, so the depth reaches the wall behind; that floor was never walkable,
  // so it costs nothing.
  //
  // The approach is 2.0 rather than the 1.7 a life-size machine wanted. Standing
  // room is measured from the station's centre, and the centre of something this
  // deep is most of a metre behind its own front — at 1.7 an agent stood with their
  // shoulders in the touchscreen.
  //
  // It was `roles: []` until now, with a note saying that giving it a job and giving it
  // the role had to be the same change so the two could not disagree. This is that
  // change, and the consequence lands on the mailbox rather than here: the post is no
  // longer the only thing that can dispatch, so it stops being load-bearing. Which is
  // the by-job model working — `canRemoveObject` needed no edit to notice.
  // `max` was 1 while the printer was furniture with no work: "physically singular, and
  // nothing is gained by a second". Both halves of that stopped being true when it got a
  // job. A second machine is worth having for the same reason a second post box is — it
  // is somewhere else work can arrive and leave, at the other end of a big room — and
  // nothing stands in the way of one: a fax is post, so its queue is per box,
  // its prop is registered per station id, and the frame loop ticks each one
  // by id rather than by kind. The cap was the only thing left saying no.
  printer: {
    label: 'Printer', max: Infinity, roles: ['intake', 'dispatch'], serves: ['print'],
    hw: 0.9, hd: 0.62, approachDist: 2.0,
    note: 'The office\'s own paper. Work faxes in and out of here, and the tray holds what is waiting. Several is fine — each machine has its own tray.',
  },
  // Dressing rather than a destination: nowhere to queue, so no standing room to
  // derive. It still carries a `facing`, because it can still be turned round.
  //
  // Dressing to look at, load-bearing to reason about. One coat per agent in the
  // building, so the stand is a picture of the population — and a room ought always to
  // be able to say who is in, which is why `census` is required even though nothing
  // would break without it. The one role kept for what it *tells* you rather than for
  // a behaviour that would fall over; if that ever stops being worth it, take it out of
  // `JOB_ROLES` and nothing else has to change.
  coatStand: {
    label: 'Coat stand', max: 1, roles: ['census'], hw: 0.4, hd: 0.4, approachDist: null,
    note: 'One coat per agent in the building, so the room can always say who is here.',
  },
};

/**
 * The jobs a room cannot go without: one station able to do each, however many kinds.
 *
 * The rule the room used to make by the shape of its data, written down so it can be
 * argued with. Four, and each is a behaviour that has nowhere to go without
 * it — except `census`, which is kept for what the coat stand *says* about the room
 * rather than for anything that would break. `refresh` and `discard` are absent on
 * purpose: an office with nothing to drink and nowhere to bin things is a poorer
 * office and a working one, and both behaviours already cope (see `_drinkBreak` and
 * `_discard`).
 *
 * Written in the order the work flows, since that is the order it reads in: something
 * arrives, somebody looks something up, something leaves — and the coats by the door
 * say who was here to do it.
 */
export const JOB_ROLES = ['census', 'intake', 'research', 'dispatch'];

/**
 * How to say a role out loud, for the one message anybody ever reads about it.
 *
 * "The office needs somewhere to collect from" rather than "the office needs its
 * Mailbox": a refusal should name the job it is protecting, because that is the reason,
 * and naming the furniture is what made the old rule read as arbitrary. Here rather
 * than in the editor because the rule and its reason belong together — the panel only
 * prints what it is handed.
 */
export const ROLE_VERBS = {
  census: 'hang a coat',
  intake: 'collect work from',
  research: 'look things up',
  dispatch: 'deliver finished work',
  refresh: 'get a drink',
  discard: 'throw work away',
};

/** Every station able to do this job, in the order they were added. */
export function stationsForRole(role) {
  return Object.values(STATIONS)
    .filter((s) => STATION_KINDS[s.kind]?.roles?.includes(role));
}

/**
 * The jobs this station can do. A kind with no `roles` does none, which is a real
 * answer — see the printer, which is furniture with standing room and no work.
 */
export function rolesOf(station) {
  return STATION_KINDS[station?.kind]?.roles ?? [];
}

/**
 * Somewhere to do this job: the right sort if the room has one, the nearest if it has
 * several, and null if it has none.
 *
 * The lookup that replaced `STATIONS.mailbox` and friends. Naming the instance was what
 * made the room's vocabulary load-bearing: `_deliver` asking for the mailbox meant a
 * room could satisfy every rule about having somewhere to deliver and still throw,
 * because the somewhere was not called `mailbox`. Asking for the *job* cannot have that
 * problem, and it is what lets a second outbox be a second outbox.
 *
 * `serves` is the flavour of the role, for the two jobs where the role alone is not a
 * specific enough question. A tea drinker wants the espresso machine and not merely any
 * `refresh` station; work waiting in the post is collected from the box it arrived in
 * and not from the stack of boxes in the corner. So it is a *preference* and not a
 * filter: asked for something nothing serves, this falls back to any station with the
 * role, which is what keeps a room with only a water cooler able to give everybody a
 * drink instead of leaving the tea drinkers standing.
 *
 * Null when the room has nobody to do the job at all. Callers must handle it — for a
 * role in `JOB_ROLES` that cannot happen while `canRemoveObject` is doing its work, and
 * for `refresh` or `discard` it is an ordinary Tuesday.
 *
 * @param {string} role
 * @param {object} [opts]
 * @param {{x: number, z: number}} [opts.from]  measured to standing room, not the prop
 * @param {string} [opts.serves]  the sort wanted: a drink, or where work came from
 * @returns {?object}
 */
export function stationForRole(role, { from = null, serves = null } = {}) {
  const all = stationsForRole(role);
  if (!all.length) return null;
  const wanted = serves
    ? all.filter((s) => STATION_KINDS[s.kind]?.serves?.includes(serves))
    : all;
  const pool = wanted.length ? wanted : all;
  if (!from) return pool[0];
  let best = pool[0];
  let bestDist = Infinity;
  for (const s of pool) {
    const at = s.approach ?? s;
    const d = (at.x - from.x) ** 2 + (at.z - from.z) ** 2;
    if (d >= bestDist) continue;
    bestDist = d;
    best = s;
  }
  return best;
}

/**
 * Which ways in are switched on. Mutable, saved with the layout, one entry per channel.
 *
 * The courier is the one you can turn off, and he is the odd one out in the kit for a
 * reason worth stating: he is not furniture. He has no footprint, nothing to drag and
 * nowhere to stand — he walks on from off-stage, throws, and leaves. So "have a courier
 * or not" cannot be adding and removing a prop the way everything else in the editor is;
 * it is a switch, and this is where the switch lives.
 *
 * Turning him off leaves the planes as the only way in, which is a quieter office and a
 * perfectly working one — the arrival was always a coin toss over whatever was enabled,
 * so a one-sided coin is not a special case (see `enabledArrivals`).
 *
 * Saved with the room rather than held in the session, because it is a fact about this
 * office and not about this tab: somebody else holding the keycard should see the same
 * room, on the same terms as where the desks are.
 */
export const CHANNELS = {
  courier: true,
  // The letter channel's other vehicle: sometimes the window admits a bird
  // instead of a paper plane (scene/birds.js). Off, every letter is a plane —
  // the same one-sided coin the courier switch already mints.
  birds: true,
  // Which bird flies the post. 'roster' is the mixed shift — the weighted day
  // draw with the owl on nights — and any single species pins every flight to
  // that bird. A room's choice, saved with the room like the switches above.
  birdKind: 'roster',
};

/** The bird post's species options, 'roster' first because it is the default. */
export const BIRD_KIND_OPTIONS = ['roster', 'owl', 'pigeon', 'kookaburra', 'raven'];

/**
 * Which supply an arrival of this kind turns into once it is here.
 *
 * A letter and a parcel are both *post* — they differ in how they travel and in nothing
 * else — and a fax is paper out of a machine, so it is `print`. Two lines, and
 * they are the whole of the mapping between a channel and a destination.
 */
const ARRIVAL_SUPPLY = { letter: 'post', package: 'post', fax: 'print' };

/**
 * Where a thrown parcel may land, in the order it would rather land there.
 *
 * A parcel is the one arrival that does not need a *slot*. A paper plane has to dive
 * into something and a fax has to come out of something, but a courier can put a box
 * down beside anything — so a package may land at any station work arrives at, and the
 * only question is which one he picks when there is more than one kind to choose from.
 *
 * The post first, because that is what a parcel *is* — addressed, from outside, and the
 * mailbox is where the pile beside it already exists. Then the printer, which at least
 * has a front and standing room and somebody walking to it. The inbox last: it is a
 * stack of boxes somebody takes *from* rather than a place things are delivered to, so
 * a box thrown onto it is the least true of the three, and it is the fallback rather
 * than the answer.
 *
 * Preference and not a filter, on the same terms as `serves` — within a kind the draw
 * is still even, so two mailboxes get half each.
 */
const PARCEL_PREFERENCE = ['mailbox', 'printer', 'inbox'];

/**
 * Every station an arrival of this kind can actually land in.
 *
 * The generalisation of `postBoxes()`, which asked only about the post. It is the same
 * question — where does a thing arriving this way end up? — and asking it per arrival is
 * what lets a fax exist at all: a plane needs a box to dive into, and a fax needs a
 * machine to come out of.
 *
 * @param {string} arrival  one of ARRIVALS
 * @returns {object[]}
 */
export function landingsFor(arrival) {
  // A parcel is the exception, and `PARCEL_PREFERENCE` says why: it needs somewhere to
  // be put down rather than something to arrive *through*, so every intake station will
  // do and the order is a preference. Only the best-served kind present is returned, so
  // the draw one layer up stays even among equals.
  if (arrival === 'package') {
    const here = stationsForRole('intake');
    for (const kind of PARCEL_PREFERENCE) {
      const mine = here.filter((st) => st.kind === kind);
      if (mine.length) return mine;
    }
    // Anything else that takes work in and is not one of the three named above. A new
    // intake kind should receive parcels rather than silently closing the channel, and
    // being last is the right default: the named order is a judgement about the three
    // the room ships, not a claim that nothing else can hold a box.
    return here;
  }
  const wants = ARRIVAL_SUPPLY[arrival];
  if (!wants) return [];
  return stationsForRole('intake')
    .filter((st) => STATION_KINDS[st.kind]?.serves?.includes(wants));
}

/**
 * The ways work may arrive in this room, given what is switched on *and what is in it*.
 *
 * The second half of that is a fix. This used to gate on the courier switch
 * alone and guarantee a non-empty answer by falling back to letters — which was true
 * enough while every room had a post box, and became a way of posting work into thin
 * air once the mailbox could be deleted. A room whose only intake is a printer has
 * nowhere for a plane to land, and a job posted anyway simply never arrived: the agent
 * stood at a box that was not there and the work was lost. So a channel is available
 * only if the room has somewhere for it to come in.
 *
 * **It may now be empty, and the caller has to cope.** A room whose only intake is the
 * inbox is the case: a stack of boxes is somewhere to take work *from*, not somewhere
 * work arrives, so nothing flies in and agents work off the pile. `_postJob` treats an
 * empty answer as "there is no journey to draw" and the collection falls through to the
 * stack, which is what it did before anything was posted at all.
 *
 * @param {string[]} all  every channel the code knows, i.e. ARRIVALS
 * @returns {string[]}
 */
export function enabledArrivals(all) {
  return all.filter((a) => {
    if (a === 'package' && !CHANNELS.courier) return false;
    return landingsFor(a).length > 0;
  });
}

/** Every box work can be posted into, in the order they were added. */
export function postBoxes() {
  return landingsFor('letter');
}

/**
 * Which post box a delivery lands in, when the room has more than one.
 *
 * **At random, evenly.** The first version of this had a rule — each way in serves the
 * box nearest to it, so a plane took the box by its window and the courier the box by
 * the door — which read well and was wrong in practice. Both entrances are at the same
 * end of the authored room, so the box that was already there won both draws and a
 * second box added anywhere else simply never received anything. A rule whose output is
 * always the same value is a rule pretending to be a decision.
 *
 * Random also matches the choice one layer up: which *channel* a job arrives by is a
 * coin toss that means nothing (see ARRIVALS in agents/post.js). The room deliberately
 * does not encode meaning in either, so having one of them be arbitrary and the other
 * geometric was the odd part.
 *
 * The manager draws this once as it posts and stamps the answer onto the envelope; the
 * scenery then aims at the box on the payload rather than drawing again. That is the
 * whole reason a random rule is safe here — nothing has to agree with anything, because
 * there is one draw and everybody downstream is told the result.
 *
 * @param {() => number} [rng]  injectable so a test can pin the draw
 * @returns {?object} the station, or null if the room has no post box at all
 */
export function postBoxFor(rng = Math.random, arrival = 'letter') {
  const boxes = landingsFor(arrival);
  if (!boxes.length) return null;
  return boxes[Math.min(boxes.length - 1, Math.floor(rng() * boxes.length))];
}

/**
 * The stations the room contains, keyed by *instance* id rather than by kind.
 *
 * For every singleton the two are the same string, which is deliberate: `STATIONS.mailbox`
 * goes on reading as it always did, and there is only ever one mailbox for it to mean.
 * A second bookshelf arrives as `bookshelf-2`, carrying `kind: 'bookshelf'` — so anything
 * that wants *a* bookshelf asks `stationsOfKind()` and anything that wants *the* mailbox
 * keeps asking for it by name.
 */
export const STATIONS = {
  bookshelf: station('bookshelf', 'bookshelf', 13.1, 1.0, { x: 13.1, z: 3.0 }),
  waterCooler: station('waterCooler', 'waterCooler', 1.5, 8.6, { x: 3.2, z: 8.6 }),
  coffee: station('coffee', 'coffee', 1.6, 16.8, { x: 3.3, z: 16.8 }),
  mailbox: station('mailbox', 'mailbox', 1.4, 4.2, { x: 3.1, z: 4.2 }),
  // Out of the doorway corner and onto the back wall.
  //
  // It stood at (1.2, 1.5) with its standing room at (2.6, 2.2), and that spot was
  // wrong three times over. The door's leaf hinges on the left jamb at x 2.06 and
  // swings inward to 0.46π, so open it runs from (2.06, 0.0) to (2.40, 2.66) — and
  // the bin's standing room sat 0.26 off the centre plane of it, less than half a
  // body. The leaf swung through whoever was binning something and stayed in them
  // for the whole discard. Worse, their own arrival is what opened it: the proxy in
  // `AgentManager.update` reads anybody within 2.6 in x of the opening as somebody
  // coming or going, and the bin's spot is 0.8. And the room had already written
  // down that nobody should be standing there: `randomInteriorPoint` refuses to let
  // a wanderer stop inside DOORWAY_DEPTH of the opening, ±(DOOR_HALF + 0.8), on the
  // grounds that anybody idling on the way in is somebody every later arrival has to
  // get past. (2.6, 2.2) is inside that rectangle, so the bin's standing room
  // contradicted a rule the room had already made about its own doorway.
  //
  // Here instead: past the printer, tucked into the corner where the back wall runs
  // out at the room's open edge. It went first to the stretch *between* the bookshelf
  // and the printer, at 19.0, which was right about the wall and wrong about the room —
  // paper is at that end (reference one side, print the other), but 19.0 is the middle
  // of a window, and a bin under a window is a bin somebody put down rather than a bin
  // that lives somewhere. The corner is where a bin goes.
  //
  // The corner was not free until now: the monstera stood in it, and moving that plant
  // down the east edge to join the bush is what opened it (see DECOR.plants). Still the
  // printer's neighbour, so failed work crumpled beside the machine that prints it is
  // still the same errand — 2.2 off the printer's footprint rather than the 0.97 it had,
  // which is the cost of being in the corner and worth it.
  //
  // Quieter still, which was the point of moving it out of the doorway in the first
  // place: it is now the furthest station in the room from the door, in the one pocket
  // of floor no route to anywhere else crosses. `z` is unchanged, so the lip keeps the
  // same 0.2 off the plaster the printer was measured to; `x` leaves 0.6 of floor
  // beyond the bin's own footprint, so it reads as *in* the corner and not falling off
  // the edge of the cutaway.
  bin: station('bin', 'bin', 24.9, 0.76, { x: 24.9, z: 2.31 }),
  // Nudged clear of desk-3's approach lane at (6.5, 16.5).
  // 17.9 rather than 17.8, to clear desk-3's standing room by a hair rather than
  // graze it by one. Measuring the footprints put the inbox's body edge at
  // z 16.99 and desk-3's standing room ends at z 17.00, so the shipped room carried
  // a 0.20 x 0.01 overlap — nobody competing for floor, but a fault by the room's
  // own rules, and one the editor now refuses anybody to recreate.
  inbox: station('inbox', 'inbox', 9.6, 17.9, { x: 9.6, z: 16.0 }),
  // The last clear pocket of the back wall: desk-6 runs out to x 19.5 and the
  // monstera's spread starts at 23.45, so this is the one stretch left. (Written when
  // the room had a sixth desk and the monstera stood in the corner, neither of which is
  // true now — the desk went, and the plant moved down the east edge to make room for
  // the bin. So nothing pins this end of the run any more, and the printer stays at 21.4
  // because it is where it looks right rather than because it is the only place left:
  // the telescope is a pane away on one side and the bin is in the corner on the other,
  // which is the arrangement the wall now has.)
  // Set closer to the wall than the bookshelf is, because it is deeper: measured
  // so its back stands 0.2 off the plaster, which is the gap the machine's cables and
  // its castors want and as near flush as a prop on wheels should ever look.
  printer: station('printer', 'printer', 21.4, 0.85, { x: 21.4, z: 2.85 }),
  // At the window, along from the printer.
  //
  // "At the window" is the whole placement, and only two spots in the room are at one.
  // The back wall carries two openings — `WINDOWS.back` in config.js, at x 5.58..11.58
  // and x 14.95..21.45 — and the printer at 21.4 stands at the right-hand end of the
  // second. So this is that window: same glass, a few paces along.
  //
  // And this is the pane. An opening is three lights across (`cols` in `buildWindow`),
  // so the second one runs 17.12..19.28 and its centre is 18.20 — which is the window's
  // own centre, since three panes put the middle one in the middle. A telescope aimed
  // through the join between two panes is aimed at a mullion; this one looks out of
  // the middle of a light.
  //
  // It sat at 16.9 first, which was the centre of the *free frontage* rather than of
  // anything you can see: the bin was at 19.0 then and the space between it and the
  // bookshelf was all there was. The bin has since gone to the corner past the printer,
  // which is what made the pane available. Derived from `windowSpan` rather than
  // written out, so a window that moves takes the telescope with it.
  //
  // The neighbours: the bookshelf runs out to 14.5, the ace standee stands on the sill
  // at 16.03 — the centre of the *first* pane, by the same arithmetic — and the planted
  // trough's sill board starts at 18.40. All three clear, and the standee and this now
  // have a pane each, which is tidier than the pair of them crowding one.
  //
  // `z` is derived, not chosen: the objective overhangs the tripod by 1.16 at −z (see
  // `telescopeMetrics` in scene/props/telescope.js), and the wall's inner face is at
  // `wallT / 2` = 0.2, so 1.40 puts the lens 0.04 inside the plaster line — right at
  // the glass, looking out of it, without the tube buried in the wall.
  telescope: station('telescope', 'telescope', 18.2, 1.40, { x: 18.2, z: 2.92 }),
  coatStand: { kind: 'coatStand', id: 'coatStand', x: 5.8, z: 1.4, facing: 0 },
};

/** Every station of one kind, in the order they were added. */
export function stationsOfKind(kind) {
  return Object.values(STATIONS).filter((s) => s.kind === kind);
}

/**
 * The free-standing furniture, and how much of it the room may hold.
 *
 * `STATION_KINDS` above asks how many of something the *work* needs, and mostly answers
 * one: there is a single place the post is. This table is the furniture that is just in
 * the room — something to sit on, something to put a cup on, something to read by — and
 * there is no answer to how many sofas an office should have except however many fit.
 *
 * So every kind here shares `FURNITURE_LIMITS`, nought to twenty-four. The maximum is a
 * guard on a button, as the desks' is. The *minimum* is the part worth saying: nought is
 * safe here in a way it is not for a desk, because nothing derives a headcount from this
 * list. A room with no couch is a room where nobody sits down, which is a duller office
 * and a perfectly valid one — and the code that would have to cope already does, because
 * a couch with both cushions taken has always been a couch nobody can sit on.
 *
 * `hw` / `hd` are the floor a piece blocks, as half-extents in the piece's own axes, on
 * exactly the terms `STATION_KINDS` states them. All three of these were authored facing
 * +z, so their numbers are unchanged from when they were world-first.
 *
 * `turns` is whether a piece has a front. A couch and a table do, so the editor may
 * rotate them; a floor lamp is a pole under a round shade and looks the same from every
 * side, so turning one is an edit that does nothing and it declines. It decides whether
 * a new piece is given a `facing` at all, which is the test the editor already applies
 * to the rug — one rule about what turns, not two.
 */
export const FURNITURE_KINDS = {
  couch: {
    label: 'Couch',
    // Half-extents of the floor a couch blocks off. Named here because the seats sit
    // inside it — the couch is the one piece of furniture big enough to swallow its own
    // seats — and the way in has to be measured against it.
    hw: 2.1, hd: 0.57, offX: 0, offZ: -0.33,
    turns: true,
    // Upholstery. The seat cushions follow the body colour and the one at your back
    // contrasts with it; both are worked out in scene/props/couch.js, which is where
    // the couch is drawn — this table says only what may be chosen.
    palette: SOFA_COLORS,
    // How far out in front the standing room is, measured from the couch's own heading
    // for the same reason a station's is (see `station` above).
    approachDist: 2.5,
    // Where the cushions are, in couch-local space: across the seat and a touch forward
    // of centre. Each couch's world-space `seats` are derived from these.
    // Back against the cushions rather than perched on the lip: far enough forward
    // that a seated agent's knees clear the couch's front panel, and no further. The
    // couch's own geometry is measured to agree with this (see props/couch.js).
    seatOffsets: [
      { x: -1.1, z: -0.05 },
      { x: 1.1, z: -0.05 },
    ],
  },
  armchair: {
    label: 'Armchair',
    hw: 1.1, hd: 0.57, offX: 0, offZ: -0.33,
    turns: true,
    palette: SOFA_COLORS,
    approachDist: 2.5,
    seatOffsets: [{ x: 0, z: -0.05 }],
  },
  sideTable: { label: 'Side table', hw: 0.71, hd: 0.41, turns: true },
  /**
   * The rug, which is furniture that happens to be flat.
   *
   * It used to be a fixture in `DECOR`, one per floor by construction, on the reasoning
   * that a room has *a* rug the way it has *a* floor. That was the shape making the rule
   * again — the same mistake a top-level `COUCH` made before it — and it is not a
   * decision anybody took about offices. A reading corner and a meeting area want one
   * each, and a room may want none.
   *
   * `walkable` is what makes it a rug rather than a low table: its rectangle is measured
   * and bounded like any other, so it cannot hang off the floor, but nothing walks
   * around it and nothing is refused for overlapping it. See `obstacleFootprints`.
   *
   * `palette` is the set of colours the editor may paint it. It is the only kind with
   * one so far, and it is declared here rather than looked up elsewhere so that asking
   * "what colours does this come in" is one question about the kind.
   */
  rug: {
    label: 'Rug', hw: 4.5, hd: 3.5, turns: true, walkable: true, palette: RUG_COLORS,
  },
  // Blocked wider than the pole it is: see `bodyBerth` in `obstacleFootprints()`.
  floorLamp: { label: 'Floor lamp', hw: 0.4, hd: 0.4, turns: false },
};

/** How many of any one kind of furniture the room may hold. */
export const FURNITURE_LIMITS = { min: 0, max: 24 };

/**
 * The furniture the room contains, as a list rather than an export apiece.
 *
 * It used to be three separate singletons — a top-level `COUCH`, and `sideTable` and
 * `floorLamp` inside `DECOR` — and the shape was the rule, exactly as a keyed `STATIONS`
 * once was: there was one couch because `COUCH` was one object, which is not a decision
 * anybody took about offices. A list of instances carrying their kind says the same
 * thing about the authored room while letting the editor add a second armchair corner.
 *
 * Ids follow the stations' convention, and for the same reason: the first of a kind is
 * named after the kind, so the couch the room was authored with is `couch`.
 */
export const FURNITURE = [
  // Under the desks in the middle of the room, which is where it has always been — it
  // was a fixture in `DECOR` until it became a kind like any other.
  { id: 'rug', kind: 'rug', x: 12, z: 8, facing: 0, color: null },
  // Reading corner on the open edge: couch, a table at the end of it, and a lamp to
  // read by. The couch's back is at -z, so its occupants look toward +z.
  {
    id: 'couch', kind: 'couch', x: 20.5, z: 15.5, facing: 0, color: null,
    approach: { x: 20.5, z: 18.0 }, seats: [],
  },
  { id: 'sideTable', kind: 'sideTable', x: 23.4, z: 15.2, facing: 0 },
  { id: 'floorLamp', kind: 'floorLamp', x: 17.8, z: 16.8 },
];

/** Every piece of furniture of one kind, in the order they were added. */
export function furnitureOfKind(kind) {
  return FURNITURE.filter((f) => f.kind === kind);
}

/**
 * The lounge seating: every piece of furniture with cushions somebody can book.
 *
 * A function rather than a constant because the answer changes — this is what anything
 * looking for somewhere to sit asks, and it has to be asked again after every edit.
 * The historical name stays because the agent layer calls the activity `couch`; an
 * armchair is deliberately the one-seat form of that same activity.
 */
export function couches() {
  return FURNITURE.filter((f) => FURNITURE_KINDS[f.kind]?.seatOffsets);
}

/**
 * Standing room directly in front of each lounge seat.
 *
 * A seat is inside the couch, so it is not somewhere anyone can be walked to: ask
 * the pathfinder for a route to blocked floor and it aims at the nearest free cell
 * instead, which for these seats is the far side of the couch. That is how people
 * came to walk round the floor lamp and slide in through the arm.
 *
 * So each seat gets the one approach that does not cross the furniture — the floor
 * in front of it, a pace clear of the blocked footprint. People walk here, turn,
 * and sit down backwards into the cushion; getting up, they step back out to it
 * before walking anywhere. The couch faces +z (see buildCouch), so "in front" is
 * +z of the seat.
 */
const SEAT_STEP_OUT = 0.4;

/**
 * Work the derived half of the layout back out from the authored half.
 *
 * The layout is a mutable singleton, on the same terms as `COLORS` and
 * `applyPalette()`: things read it live rather than being handed a copy, so moving a
 * desk is a write here and not a parameter threaded through the scene. What that
 * costs is this function. Every number in the layout that is *worked out* from
 * another one — a station's approach point, its `lookRotation`, a couch seat and the
 * floor in front of it — has to be worked out again after any edit, or the derived
 * numbers go on describing the room as it used to be.
 *
 * It is called once at import for exactly that reason. Deriving these inline at the
 * literals and again in the editor would be two copies of one rule, free to drift;
 * this way import-time and edit-time derivation are the same code and cannot
 * disagree.
 */
export function reviseLayout() {
  for (const s of Object.values(STATIONS)) {
    if (s.approachDist == null) continue;   // dressing: nowhere to stand, nothing to derive
    const dir = heading(s.facing);
    s.approach.x = s.x + dir.x * s.approachDist;
    s.approach.z = s.z + dir.z * s.approachDist;
    // The heading from the approach point back to the prop, which after the above is
    // simply the reverse of its facing. Still written as the measurement rather than
    // as `facing + PI`, so it stays true if the offset ever stops being radial.
    s.lookRotation = Math.atan2(s.x - s.approach.x, s.z - s.approach.z);
  }

  // Every sittable piece derives its own standing room and cushions, so a couch and an
  // armchair are independent places to sit rather than two views of one. Driven off
  // `seatOffsets` being present — a table has no seats to work out.
  for (const f of FURNITURE) {
    const kind = FURNITURE_KINDS[f.kind];
    if (!kind?.seatOffsets) continue;

    const dir = heading(f.facing);
    f.approach.x = f.x + dir.x * kind.approachDist;
    f.approach.z = f.z + dir.z * kind.approachDist;

    // A fresh array each time, which is safe only because these are the *geometry* of
    // the seats and not the bookings against them: the props layer keeps its own seat
    // objects, carrying `occupiedBy`, and copies these numbers across by index rather
    // than adopting them. See `relocate()` in `buildCouch`.
    f.seats = kind.seatOffsets.map((off) => {
      const seat = local(f, off.x, off.z);
      return {
        x: seat.x,
        z: seat.z,
        // Occupants look the way the couch does.
        rotation: f.facing,
        // The floor in front of this seat: out past the blocked footprint, on the
        // couch's own axis rather than the world's, so a couch turned to face the
        // window still has its standing room in front of the cushions.
        front: local(f, off.x, kind.hd + SEAT_STEP_OUT),
      };
    });
  }
}

/** The unit vector a heading points along, in the room's x/z plane. */
function heading(facing) {
  return { x: Math.sin(facing), z: Math.cos(facing) };
}

/**
 * A point given in a prop's local space, in world coordinates.
 * @param {{x: number, z: number, facing: number}} prop
 */
function local(prop, dx, dz) {
  const s = Math.sin(prop.facing), c = Math.cos(prop.facing);
  return { x: prop.x + dx * c + dz * s, z: prop.z - dx * s + dz * c };
}

reviseLayout();

/**
 * Is this point on the floor a couch or armchair stands on?
 *
 * Asked of people rather than of geometry: anybody standing in here has to step
 * out to the front before they walk anywhere, whether they were sitting or were
 * interrupted halfway onto the cushion.
 *
 * Any lounge seat, since there may be several and somebody has to step out of whichever
 * one they are actually in. Measured in the furniture's own axes rather than the
 * world's — a turned couch blocks a rotated rectangle, and comparing against world x
 * and z would have reported its corners as clear floor.
 */
export const insideCouch = (x, z) => couches().some((c) => {
  const kind = FURNITURE_KINDS[c.kind];
  const s = Math.sin(c.facing), t = Math.cos(c.facing);
  const dx = x - c.x, dz = z - c.z;
  return Math.abs(dx * t - dz * s) < kind.hw && Math.abs(dx * s + dz * t) < kind.hd;
});

// Decorative prop placements (still purposeful where noted).
export const DECOR = {
  // Digital wall clock: mounted on the beige (left, x=0) wall, 4.7 up. `x` sits just
  // proud of the wall's inner face (wallT / 2).
  //
  // `z` is written out rather than taken from `STATIONS.coffee.z`, which is where it
  // used to come from. The clock *happens* to hang above the coffee machine and was
  // placed by eye to do so — but sharing the machine's number said something
  // stronger, that the clock is defined by the machine, and once the machine could be
  // dragged that became a lie: moving the coffee would have slid a clock along a wall
  // it is screwed to. It is on the wall, so it stays where it is put, and it is not
  // draggable in the editor for the same reason.
  wallClock: {
    x: ROOM.wallT / 2 + 0.02,
    y: 4.7,
    z: 16.8,
    w: 3.4,
    h: 1.5,
    facing: Math.PI / 2,   // rotates the face from +z to +x, i.e. into the room
  },
  // The brand-mark standees are not here but in logoPlacements() below: where
  // the ace stands depends on which walls its building cut windows into, and
  // DECOR is a constant, read before any theme is known.
  //
  // Floor planting. `kind` names a species in scene/plants.js, and `seasonal` asks
  // for the palette greens the seasons repaint rather than the evergreen set. The
  // ground each one blocks is PLANT_SPREAD below.
  //
  // Placed for the light, the way a plant actually ends up somewhere — and the big
  // seasonal three are placed for the view as well. They stand where the street is
  // visible behind them, on the two open cutaway edges and in the sage wall's
  // window bay, so when they turn they turn against a matching season outdoors.
  // The rest of the room stays green, which is what stops February looking dead.
  // Each carries an id, for the same reason a desk does: it is what the layout names
  // when it moves one, and what the editor tags the group with. They used to be known
  // by their position in this array, which worked only for as long as the array was
  // fixed — inserting a plant renumbered every plant after it, so a saved layout
  // quietly moved the wrong ones.
  plants: [
    // The three that carry the season, at the size they need to read from across
    // the room: the big leafy plant between the coat stand and the bookshelf, and
    // two more out on the open edge.
    { id: 'plant-1', kind: 'bush', x: 9.5, z: 1.6, scale: 1.4, seasonal: true, facing: 0 },
    // Down the east edge to stand with the bush, out of the corner it used to hold.
    // It was the only thing in that corner, which is what made the corner available
    // for the bin — and the two big seasonal plants read better as a pair than as one
    // at each end of the same edge. 2.5 apart, which leaves 0.38 between their spreads:
    // near enough to be a group, far enough to be two plants.
    { id: 'plant-2', kind: 'monstera', x: 24.5, z: 9.0, scale: 1.55, seasonal: true, facing: 0 },
    { id: 'plant-3', kind: 'bush', x: 24.6, z: 11.5, scale: 1.65, seasonal: true, facing: 0 },

    // Evergreen, in the body of the room. The hero is a big fig on the beige wall,
    // in the one stretch of it that had nothing on it — between the coffee machine
    // and the window, so everyone waiting on a shot of coffee stands in greenery.
    { id: 'plant-4', kind: 'fig', x: 1.8, z: 13.2, scale: 1.5, facing: 0 },
    // Blades, not a canopy: this is the gap between the mailbox and the water
    // cooler, and a plant that spread out here would be in the way of both.
    { id: 'plant-5', kind: 'snake', x: 1.5, z: 6.6, scale: 1.25, facing: 0 },
  ],
};

/**
 * The species that can stand on the floor, and what each one takes up.
 *
 * `spread` is the ground it covers, as a half-width in units per unit of scale: it is
 * what the nav grid blocks, which is why it is here rather than in scene/plants.js —
 * config.js is where the walkable map is derived from the layout. `scale` is only a
 * default, the size a new one of these arrives at.
 *
 * Five of the nine species in scene/plants.js, and the five that make sense down here:
 * the pothos trails off a shelf, and the cactus, succulent and violet are desk plants,
 * knee-high things that would be lost on a floor.
 */
export const PLANT_KINDS = {
  bush: { label: 'Leafy bush', spread: 0.4, scale: 1.4 },
  fig: { label: 'Fig', spread: 0.36, scale: 1.5 },
  monstera: { label: 'Monstera', spread: 0.32, scale: 1.55 },
  snake: { label: 'Snake plant', spread: 0.26, scale: 1.25 },
  fern: { label: 'Fern', spread: 0.33, scale: 1.1 },
};

/** How much floor an unrecognised species is assumed to cover. */
const PLANT_SPREAD_FALLBACK = 0.6;

/**
 * Seasonal planting on the window sills: which opening, which end of it, and how
 * long a trough. Derived rather than written out in world coordinates so the
 * troughs travel with the windows, the way the paper planes' entry point does.
 *
 * `align` is -1 for the near end of the opening, +1 for the far end, 0 to centre
 * it. Held to one end because a trough across the whole light would block the
 * view of the season it is there to announce.
 */
export const WINDOW_TROUGHS = [
  { wall: 'back', window: 0, align: -1, width: 2.4 },
  { wall: 'back', window: 1, align: 1, width: 2.6 },
  { wall: 'left', window: 0, align: -1, width: 2.6 },
];

/**
 * Resolve WINDOW_TROUGHS into world placements.
 *
 * @returns {{x: number, y: number, z: number, rotationY: number, width: number}[]}
 *   `rotationY` turns the trough (built along local x, wall at local -z) to sit
 *   against its wall.
 */
/**
 * @param {{wall: string, window: number}[]} [exclude]  entries to leave out —
 *   for a wall a particular theme built without that opening (the mansard's
 *   glazed stairwell drops both of the back wall's windows), so its trough
 *   doesn't go on planting a sill that was never cut.
 */
export function windowTroughPlacements(exclude = []) {
  const out = [];
  const inset = ROOM.wallT / 2;          // inner face of the wall
  for (const t of WINDOW_TROUGHS) {
    if (exclude.some((e) => e.wall === t.wall && e.window === t.window)) continue;
    const span = windowSpan(t.wall, t.window);
    if (!span) continue;
    // Slide to the requested end, leaving the trough wholly inside the opening.
    const slack = Math.max(0, (span.width - t.width) / 2 - 0.1);
    const along = span.centre + t.align * slack;
    out.push(span.axis === 'x'
      ? { x: along, y: WINDOW_LEDGE_Y, z: inset, rotationY: 0, width: t.width }
      : { x: inset, y: WINDOW_LEDGE_Y, z: along, rotationY: Math.PI / 2, width: t.width });
  }
  return out;
}

/** How far a standee is turned off facing straight out of its window. */
const LOGO_TILT = Math.PI / 12;   // 15°

/**
 * Centres, along the sill, of two marks standing as a pair on one window.
 *
 * Far enough apart to read as two objects, close enough to read as one
 * arrangement — and not a pane width, which is what the mansard's ace wanted
 * and could not have: the sill board under the planting runs 0.35 past the
 * trough at either end (buildWindowTrough), so the middle pane's own centre
 * puts the mark's foot inside the board.
 */
const LOGO_PAIR_GAP = 1.2;

/**
 * Where the brand-mark standees stand (see scene/standees.js). Fixed like the
 * wall clock rather than movable: they are objects on a sill, not furniture on
 * the floor.
 *
 * Each stands in the middle of a pane — a window is three lights across
 * (buildWindow's `cols`) — and is turned LOGO_TILT off square to the glass, so
 * the two marks are angled rather than lined up like a shelf display.
 *
 * Derived per building for the same reason the troughs are (see
 * windowTroughPlacements): the mansard glazes its whole back wall as a
 * stairwell and cuts no windows into it, so the ace's own sill does not exist
 * there — it stood in front of blank plaster, with no sill, frame or planting
 * under it. On that building it comes round to the left wall's sill instead and
 * stands LOGO_PAIR_GAP short of the Rovo mark, on the room side of it, tilted
 * the other way off the window axis so the two turn away from each other rather
 * than both facing the same corner.
 *
 * @param {?string} [building]  the theme's building key
 * @returns {{kind: string, x: number, z: number, rotationY: number}[]}
 */
export function logoPlacements(building) {
  const left0 = windowSpan('left', 0);
  // "Left" as read by someone in the room facing the glass, which on this wall
  // is the far end in z.
  const rovo = {
    kind: 'rovo',
    x: ROOM.wallT / 2,
    z: left0.centre + left0.width / 3,
    rotationY: Math.PI / 2 + LOGO_TILT,
  };
  if (building === 'mansard') {
    return [
      { kind: 'ace', x: ROOM.wallT / 2, z: rovo.z - LOGO_PAIR_GAP, rotationY: Math.PI / 2 - LOGO_TILT },
      rovo,
    ];
  }
  const back1 = windowSpan('back', 1);
  return [
    { kind: 'ace', x: back1.centre - back1.width / 3, z: ROOM.wallT / 2, rotationY: LOGO_TILT },
    rovo,
  ];
}

// Rectangular footprints that block walking. Derived from the layout above so
// the nav grid always matches what you can see.
// Roughly the half-width of a person (AGENT_RADIUS in agents/crowd.js). Kept here
// as a plain number rather than imported: the layout should not depend on the crowd
// rules, and it only needs to be about right.
export const BODY_BERTH = 0.45;

/**
 * A prop's half-extents laid on the world's axes, according to which way it points.
 *
 * Every prop with a front is blocked the same way, and this is that one rule: the
 * desks, the stations and the furniture in `obstacleFootprints()` all go through it,
 * and so does the layout generator, which has to reason about the floor a prop will
 * take before there is a prop to ask (src/plan/floor.js).
 *
 * A prop's `hw` / `hd` are measured across its front and from front to back — its own
 * axes, not the world's — so its heading is the whole of what decides how the pair
 * lands on x and z. That is the fix for a bug worth naming: these used to be measured
 * in world axes at each prop's authored facing, and rotation was taken as the
 * difference from a `baseFacing` written down when the instance came into being. For
 * anything the editor *created* those two were the same angle by construction, so a
 * couch added end-on blocked the floor of a couch stood square, agents walked through
 * its arms, and the search for somewhere to put a new piece could not tell one
 * rotation from another however many it tried.
 *
 * Anything off the right angle takes the nearer axis. The editor only ever turns in
 * quarter turns, and a prop at 30° has no axis-aligned rectangle anyway, so the
 * closest one is a better answer than refusing to have one.
 *
 * @param {number} facing
 * @param {number} hw  half-width across the prop's own front
 * @param {number} hd  half-depth, front to back
 * @returns {{hw: number, hd: number}} the same pair, on world x and z
 */
export function worldExtent(facing, hw, hd) {
  return Math.abs(Math.cos(facing ?? 0)) > 0.5 ? { hw, hd } : { hw: hd, hd: hw };
}

/**
 * What each kind of prop actually occupies on the floor, in its own axes.
 *
 * **Measured, not chosen.** `node bin/footprint-audit.js --table` builds every prop
 * headlessly, zeroes its rotation, and takes the bounding box of its floor-level
 * geometry — ignoring anything above knee height, which a walker's shins never
 * meet, and anything lying flat, because a printer's paper mat is 3cm high and is
 * a thing you step on rather than walk round. `npm test` re-runs that measurement
 * and fails if this table has drifted from it, so a remodelled prop cannot quietly
 * keep an old footprint.
 *
 * These replaced a set of hand-chosen half-extents that were wrong in both
 * directions at once. Sixteen of twenty-three were larger than the prop — a floor
 * lamp with a 0.8 base blocked 1.9 across — and seven were *smaller* than it, so a
 * walker routed perfectly legally by the nav grid passed straight through the
 * mesh: every desk's chair stuck 0.81 out of its own rectangle, the mailbox 0.94,
 * the coffee machine 0.63. Two were transposed outright.
 *
 * `offX`/`offZ` are the other half of the fix and the reason a tighter number was
 * not enough on its own. Several props are not built around their origin — a
 * couch's seat sits a third of a unit behind it, a desk's chair 0.62 back, the
 * mailbox nearly a unit off in both axes — and a rectangle centred on the origin
 * has to reach far enough to cover the loaded side, which means it reaches that
 * far into the empty side too. Hence too big and too small at once.
 *
 * `berth` is what a *walker* keeps clear on top of the body, and it exists for one
 * prop. A floor lamp is a thin pole with a heavy base and a shade over head
 * height: a walker whose centre clears the base by a hair still looks like they
 * walked through the lamp. That is a fact about walking, not about the floor the
 * lamp stands on, so it inflates the nav grid's rectangle and not the editor's —
 * which is what lets a lamp and a plant stand side by side as a wall you walk
 * around rather than between.
 */
/**
 * The desk's own floor extent: desktop and chair together.
 *
 * The one prop with no kind table of its own, because there is only one sort of
 * desk. `offZ` is the chair — it sits 0.62 behind the desk's origin, which is why a
 * rectangle centred on that origin could never fit it without also reaching the
 * same distance into the empty space in front.
 */
export const DESK_BODY = { hw: 2.03, hd: 1.6, offX: 0, offZ: 0.62 };

/**
 * What each kind of prop occupies on the floor, in the frame `obstacleFootprints`
 * transforms from.
 *
 * **Derived, not declared.** The numbers live on the kind tables above, where every
 * other consumer already reads them: `src/plan/furnish.js` places against them,
 * `src/plan/survey.js` measures against them, and both `SEAT_STEP_OUT` and the
 * on-furniture hit test want the true extent too. A second table would have been a
 * second source of truth, and the two would have disagreed the moment anybody
 * remodelled a prop — four tests failed on exactly that while this *was* two
 * tables, because the generator planned with one set of extents and the editor
 * checked with the other.
 *
 * **The numbers themselves are measured.** `node bin/footprint-audit.js --table`
 * builds every prop headlessly and takes the bounding box of its floor-level
 * geometry, ignoring anything above knee height — which a walker's shins never
 * meet — and anything lying flat, because a printer's paper mat is 3cm high and is
 * a thing you step on rather than walk round.
 *
 * They replaced hand-chosen half-extents that were wrong in both directions at
 * once. Sixteen of twenty-three props were larger than their own mesh — a floor
 * lamp with a 0.8 base blocked 1.9 across — and seven were *smaller*, so a walker
 * routed perfectly legally by the nav grid passed straight through the geometry:
 * every desk's chair stuck 0.81 out of its own rectangle, the mailbox 0.94, the
 * coffee machine 0.63. The coffee machine and the water cooler were transposed.
 *
 * `offX`/`offZ` are the other half of the fix, and the reason a smaller number was
 * not enough on its own. Several props are not built around their origin, and a
 * rectangle centred on the origin has to reach far enough to cover the loaded side
 * — which means it reaches that far into the empty one too. Hence too big and too
 * small at the same time.
 */
export const BODIES = {
  'desk:desk': DESK_BODY,
  ...Object.fromEntries(Object.entries(STATION_KINDS).map(([k, v]) => [`station:${k}`, v])),
  ...Object.fromEntries(Object.entries(FURNITURE_KINDS).map(([k, v]) => [`furniture:${k}`, v])),
  ...Object.fromEntries(Object.entries(PLANT_KINDS)
    .map(([k, v]) => [`plant:${k}`, { hw: v.spread, hd: v.spread, offX: 0, offZ: 0 }])),
};

/**
 * Extra floor a *walker* keeps clear of a kind, over and above its body.
 *
 * One entry, and the reason it is not simply part of the body is the whole point of
 * the split. A floor lamp is a thin pole with a heavy base and a shade over head
 * height: a walker whose centre clears the base by a hair still looks like they
 * walked through the lamp. That is a fact about walking past it, not about the
 * floor it stands on — so it inflates the nav grid's rectangle (see
 * `_addPropObstacles` in src/agents/pathfinding.js) and not the editor's, which is
 * what lets a lamp and a plant stand side by side to make a wall you walk around
 * rather than between.
 */
export const BERTHS = { 'furniture:floorLamp': BODY_BERTH };

/**
 * How far out in front of a desk its occupant stands.
 *
 * Not a choice: `buildDesk` puts a desk's approach point at `SEAT_LOCAL_Z + 1.9`
 * along its own axis, and that is where the agent layer walks to. Lives here rather
 * than in the plan layer because `obstacleFootprints` needs it too, and the plan
 * layer imports from here — the other way round would be a cycle.
 */
export const DESK_APPROACH = 3.5;

/** Room for one body: the width of a way in, and the depth of the spot at the end. */
export const STAND_BODY = 0.5;

/**
 * The floor somebody needs in order to *use* a prop, as a rectangle.
 *
 * The second of the two rectangles every prop gets, and the one that answers "can
 * people walk up and do their action". It runs from the prop's own front face out to
 * a body's depth past where its user stands, and it is aimed along `heading(facing)`
 * — so which side needs the room is a consequence of which way the prop is turned
 * rather than something written down per kind. A printer has one side that needs
 * space and three that need none.
 *
 * Measured from the body's front face rather than from `hd`, which are the same
 * thing only for a prop built around its own origin. A couch's front is at 0.24 and
 * its `hd` is 0.57, so a strip starting at 0.57 would leave a third of a unit
 * belonging to neither the couch nor the way in to it.
 *
 * Shared with `claimOf` in src/plan/floor.js, which is the point: the generator
 * reserves this floor while it lays a room out and the editor refuses drops into it
 * afterwards, and two implementations of the same rectangle would drift.
 */
export function standExtent(facing, body, approach) {
  const near = (body.offZ ?? 0) + body.hd;
  const far = approach + STAND_BODY;
  return {
    // Along the way it faces: from its front face out past its user.
    mid: (far + near) / 2,
    ...worldExtent(facing, Math.max(body.hw, STAND_BODY), Math.max(0, (far - near) / 2)),
  };
}

/**
 * Where a point in a prop's own axes lands in the room, given which way it faces.
 *
 * Local +z is the way the prop looks — `heading()` is the same vector every
 * approach point is derived from — so local +x is a quarter turn clockwise of it.
 */
function toWorld(facing, ox, oz) {
  const c = Math.cos(facing ?? 0);
  const s = Math.sin(facing ?? 0);
  return { x: ox * c + oz * s, z: oz * c - ox * s };
}

export function obstacleFootprints() {
  const f = [];
  /**
   * One rectangle, from a kind's measured body and an instance's place.
   *
   * `key` names the prop it came from — the same key the editor tags its movable
   * groups with (see scene/props.js). The nav grid blocks these and adds `berth`;
   * the editor refuses overlaps against them and does not.
   */
  /**
   * The floor somebody needs to use this prop, if anybody walks up to it.
   *
   * Role `stand` rather than `prop`, and the difference is what the whole model
   * turns on: another prop may not stand in it, but two of these may overlap each
   * other freely, because two people sharing circulation space is not a collision.
   * See the table in `floorFault` (src/editor/placement.js).
   *
   * Keyed `stand:<prop>` so the prop it belongs to is recoverable — a prop never
   * blocks its own way in, and a refusal can say whose way in was blocked.
   */
  const stand = (key, at, body, approach) => {
    if (approach == null) return;
    const dir = { x: Math.sin(at.facing ?? 0), z: Math.cos(at.facing ?? 0) };
    const across = { x: dir.z, z: -dir.x };
    const size = standExtent(at.facing, body, approach);
    const cx = at.x + dir.x * size.mid + across.x * (body.offX ?? 0);
    const cz = at.z + dir.z * size.mid + across.z * (body.offX ?? 0);
    f.push({
      key: `stand:${key}`,
      x0: cx - size.hw,
      z0: cz - size.hd,
      x1: cx + size.hw,
      z1: cz + size.hd,
      soft: false,
      berth: 0,
      role: 'stand',
    });
  };

  const rect = (key, at, body, { soft = false, scale = 1, berth = 0 } = {}) => {
    // Most kinds are built around their own origin and say nothing about it, so the
    // offset defaults to none. Left undefined this multiplied out to NaN and every
    // such prop got a rectangle of NaNs — which no overlap test can ever fail, so
    // the room reported itself perfectly legal while the nav grid blocked nothing.
    const off = toWorld(at.facing, (body.offX ?? 0) * scale, (body.offZ ?? 0) * scale);
    const world = worldExtent(at.facing, body.hw * scale, body.hd * scale);
    f.push({
      key,
      x0: at.x + off.x - world.hw,
      z0: at.z + off.z - world.hd,
      x1: at.x + off.x + world.hw,
      z1: at.z + off.z + world.hd,
      soft,
      berth,
      role: 'prop',
    });
  };

  for (const d of DESKS) {
    rect(`desk:${d.id}`, d, DESK_BODY);
    stand(`desk:${d.id}`, d, DESK_BODY, DESK_APPROACH);
  }

  /**
   * Every station and every piece of furniture, by kind rather than by name —
   * which is what lets there be two of something: a second bookshelf blocks the
   * same floor as the first without anybody adding a line here for it.
   */
  for (const s of Object.values(STATIONS)) {
    const body = BODIES[`station:${s.kind}`];
    if (!body) continue;
    rect(`station:${s.id}`, s, body, { berth: BERTHS[`station:${s.kind}`] ?? 0 });
    stand(`station:${s.id}`, s, body, body.approachDist ?? null);
  }
  for (const piece of FURNITURE) {
    const body = BODIES[`furniture:${piece.kind}`];
    if (!body) continue;
    // A walkable piece still gets a rectangle, marked soft. It is the rug: the nav
    // grid must not block it and a drop must not be refused for lying across a
    // desk, but the editor still needs to know how big it is, so that it can be
    // kept on the floor and shown under the selection ring. Everything that reads
    // these skips the soft ones where blocking is the question — see
    // agents/pathfinding.js and editor/editor.js.
    rect(`furniture:${piece.id}`, piece, body, {
      soft: !!FURNITURE_KINDS[piece.kind]?.walkable,
      berth: BERTHS[`furniture:${piece.kind}`] ?? 0,
    });
    // The lounge seating only: a couch and an armchair are sat on and so have a way
    // in, while a side table, a rug and a floor lamp declare no `approachDist`
    // because nobody walks up to them to do anything.
    stand(`furniture:${piece.id}`, piece, body, body.approachDist ?? null);
  }
  // Floor plants only: the desk plants stand on furniture that is already blocked,
  // and the window troughs are 2.3 up a wall nobody walks through. A plant's body
  // is its kind's unit spread times its own scale.
  for (const p of DECOR.plants) {
    const body = BODIES[`plant:${p.kind}`];
    if (!body) {
      rect(`plant:${p.id}`, { ...p, facing: 0 }, {
        hw: PLANT_SPREAD_FALLBACK, hd: PLANT_SPREAD_FALLBACK, offX: 0, offZ: 0,
      }, { scale: p.scale });
      continue;
    }
    rect(`plant:${p.id}`, { ...p, facing: 0 }, body, { scale: p.scale });
  }

  return f;
}

// --- Editing the layout ----------------------------------------------------
/**
 * The floor plan as a blob, and back again.
 *
 * Three functions, and between them the whole persistence story of the furniture
 * editor (see src/editor.js): read the room out, put a room in, go back to the room
 * as written. They live here rather than in the editor because the layout is what
 * they are about — the editor is only one caller, and a layout that could be read
 * and restored is useful to anything that wants to.
 *
 * What travels is the furniture and where it stands: which pieces there are, of what
 * kind, at what position and facing. Not the palette, and not a prop's model or its
 * dimensions — so pasting a blob into a differently-themed office is a sensible thing
 * to do rather than a way to import somebody else's colours.
 *
 * Kinds travel because the set of pieces is no longer fixed. A blob that could only
 * carry positions could only describe the room it was exported from, prop for prop;
 * carrying the kind alongside is what lets one describe a room with a second bookshelf
 * in it, or a sixth desk, and be read back into an office that has neither.
 */

/**
 * Blob format version, so a stored layout can be recognised or refused.
 *
 * Version 4 moves the rug out of `decor` and into `furniture`, where it is a kind like
 * any other — so a room may have two, or none. A version 3 blob names its rug under
 * `decor.rug`, and that is read onto the first rug the room has, on exactly the terms
 * version 3 reads a version 2 side table.
 *
 * Version 3 gathers the couch, the side table and the floor lamp into one `furniture`
 * map keyed by id, where version 2 had the couch in a top-level entry of its own and the
 * other two among the `decor` — three singletons, because that is what they were.
 *
 * Version 2 keys plants by id and gives every entry its kind, where version 1 had
 * plants in an array and named its props by position. Both older shapes are still read —
 * see the tail of `applyLayout()` — because each is still a true description of the room
 * it was exported from.
 */
export const LAYOUT_VERSION = 4;

/**
 * Two decimal places is the precision a hand-placed prop is authored to.
 *
 * Exported because it is the grid the blob is written on, and the generator snaps
 * to it as it places each prop (`round2` in src/plan/floor.js says why it has to
 * be that way round). One statement of it, so the plan that is checked and the
 * plan that is stored cannot be different plans.
 */
export const round2 = (n) => Math.round(n * 100) / 100;

/**
 * How close to the walls a prop may be pushed.
 *
 * Import clamps to this, which is what stops a hand-edited blob from wedging the
 * office: a desk at x = 500 is not an error worth refusing, it is a typo, and the
 * useful response is to put it back in the room rather than to throw.
 */
export const LAYOUT_MARGIN = 0.8;

const clampX = (x) => Math.min(ROOM.W - LAYOUT_MARGIN, Math.max(LAYOUT_MARGIN, x));
const clampZ = (z) => Math.min(ROOM.D - LAYOUT_MARGIN, Math.max(LAYOUT_MARGIN, z));

/**
 * How far off a right angle a facing may be and still be meant as one.
 *
 * Half a degree, which is wider than the 0.005 rad that two-decimal rounding can
 * introduce and far tighter than any angle somebody would choose on purpose.
 */
const SQUARE_TOLERANCE = 0.01;

/**
 * A facing that is nearly a right angle, made into one exactly.
 *
 * The editor only ever turns furniture in 90° steps, but an exported blob rounds to two
 * decimal places for legibility — so `Math.PI` leaves as `3.14` and, without this, comes
 * back as `3.14` and stays there. Nothing is visibly crooked at 0.05°, which is what
 * makes it worth handling: the error is invisible, permanent, and inherited by whatever
 * is derived from the facing, so a station's standing room ends up a millimetre or two
 * off its own axis for no reason anyone would ever find.
 *
 * It is also the forgiving thing to do with a blob somebody typed. `1.57` is what a
 * person writes when they mean a quarter turn, and treating it as a quarter turn is
 * strictly kinder than treating it as 89.95°. Anything genuinely oblique is left alone.
 */
function squareUp(facing) {
  const quarter = Math.PI / 2;
  const nearest = Math.round(facing / quarter) * quarter;
  return Math.abs(facing - nearest) < SQUARE_TOLERANCE ? nearest : facing;
}

/**
 * Which DECOR entries are floor props the editor may move.
 *
 * None, now. The side table and the floor lamp left first, and the rug followed: all
 * three were fixtures only because the shape said so, and each is furniture proper in
 * `FURNITURE` now that there can be more than one of it. What is left in `DECOR` is
 * what genuinely cannot move — the wall clock is screwed to a wall, the logo statues
 * stand on sills — plus the plants, which have a family of their own.
 *
 * Kept, empty, because it is the seam a future fixture-that-moves would come back
 * through, and because the snapshot below still reads it.
 */
export const MOVABLE_DECOR = [];

/**
 * How many desks and floor plants the room may hold.
 *
 * The desk minimum is one because a desk is a seat for an agent thread and the
 * headcount is the desk count (see `agentCapacity()`): an office with no desks is an
 * office nobody can work in. The maximum is not a design limit but a guard on a button
 * — the editor can add desks one click at a time, and somewhere past a couple of dozen
 * the room stops being a room. What actually happens at that many people is its own
 * question, not this table's.
 *
 * Plants have no minimum. A room with no plants is a sadder room and a valid one.
 */
export const DESK_LIMITS = { min: 1, max: 24 };
export const PLANT_LIMITS = { min: 0, max: 24 };

/**
 * The authored layout, kept aside at import so `resetLayout()` has something true
 * to go back to. Taken by snapshot rather than by re-importing the module, because
 * an ES module is evaluated once and there is no second copy of these literals.
 */
const AUTHORED = snapshot();

/**
 * The layout as it stands: where everything is, and *what* everything is.
 *
 * The second half is the reason every family below is a map keyed by id, with the kind
 * written alongside. A blob used to be a set of positions for a set of props that was
 * fixed and known — five desks and one of each station, named in the config — so it
 * could say where the mailbox had been dragged to and had no way at all to say that
 * there was now a second bookshelf, or one fewer desk. Now the blob describes the
 * furniture as well as the plan, and `applyLayout()` can build what it names.
 *
 * `complete` marks a blob as the whole truth rather than a note about part of it, and
 * it is what gives `applyLayout()` licence to *remove* something. See there.
 */
function snapshot() {
  const out = {
    layout: LAYOUT_VERSION,
    complete: true,
    desks: {},
    stations: {},
    furniture: {},
    decor: {},
    plants: {},
    // Which ways in are switched on. A fact about this office, so it travels with the
    // furniture rather than living in the session.
    channels: { ...CHANNELS },
  };
  // `standing` only on the desks that are, on the same terms as a lamp's absent facing:
  // a blob is something people read and edit, and `standing: false` on five ordinary
  // desks invites the question of what the other setting would do.
  for (const d of DESKS) {
    out.desks[d.id] = d.standing
      ? { x: d.x, z: d.z, facing: d.facing, standing: true }
      : { x: d.x, z: d.z, facing: d.facing };
  }
  for (const [id, s] of Object.entries(STATIONS)) {
    out.stations[id] = { kind: s.kind, x: s.x, z: s.z, facing: s.facing };
  }
  for (const f of FURNITURE) {
    // A facing only where the piece has one. Writing `facing: undefined` for a lamp
    // would come back through `JSON.stringify` as a missing key anyway, but a blob is
    // also something people read and edit, and an entry that lists a heading invites
    // turning something that does not turn.
    // A colour likewise only where the kind has one to give, so a blob does not invite
    // anybody to paint a side table.
    const paint = FURNITURE_KINDS[f.kind]?.palette ? { color: f.color ?? null } : {};
    out.furniture[f.id] = f.facing == null
      ? { kind: f.kind, x: f.x, z: f.z, ...paint }
      : { kind: f.kind, x: f.x, z: f.z, facing: f.facing, ...paint };
  }
  for (const p of DECOR.plants) {
    out.plants[p.id] = {
      kind: p.kind, x: p.x, z: p.z, facing: p.facing, scale: p.scale, seasonal: !!p.seasonal,
    };
  }
  // Empty, since version 4: the rug was the last of the movable dressing and it is a
  // kind of furniture now. The key stays so the blob's shape does not change under the
  // readers of it, and so a fixture that learns to move has somewhere to go.
  for (const key of MOVABLE_DECOR) {
    out.decor[key] = { x: DECOR[key].x, z: DECOR[key].z, facing: DECOR[key].facing };
  }
  return out;
}

/**
 * How many agent threads the office can seat: one per desk, by definition.
 *
 * This used to be written down per scene, as a `maxAgents` beside each project — a
 * number that happened to be five, next to a desk list that happened to be five long,
 * with nothing keeping the two in step. Deriving it means adding a desk in the editor
 * makes room for somebody to sit at it, and taking one away sends somebody home,
 * without a second number anywhere to remember to change.
 */
export function agentCapacity() { return DESKS.length; }

/**
 * The current layout as a plain object ready for JSON.
 *
 * A fresh object every time and no live references into the config, so a caller can
 * hold one as an undo step without it quietly following later edits.
 *
 * @param {{round?: boolean}} [opts]  two decimal places, which is the precision a
 *   layout is *authored* to and so the right thing to export and paste. Turn it off for
 *   an undo step or a revert: those have to restore exactly what was there, and a
 *   rounded round trip would shave a hair off every facing each time it was used —
 *   `Math.PI` coming back as 3.14, and staying there.
 */
export function layoutSnapshot({ round: rounded = true } = {}) {
  const s = snapshot();
  return rounded ? roundBlob(s) : s;
}

/**
 * Round every entry of a blob to authoring precision, in place.
 *
 * Numbers only: an entry also carries its kind and, for a plant, whether it follows
 * the seasons, and rounding a string is how a bookshelf becomes a NaN.
 */
function roundBlob(s) {
  const round = (o) => {
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'number') o[k] = round2(o[k]);
    }
    return o;
  };
  for (const d of Object.values(s.desks)) round(d);
  for (const st of Object.values(s.stations)) round(st);
  for (const f of Object.values(s.furniture)) round(f);
  for (const d of Object.values(s.decor)) round(d);
  for (const p of Object.values(s.plants)) round(p);
  return s;
}

/**
 * Move the furniture to match a blob, and re-derive everything that follows from it.
 *
 * Deliberately forgiving. Unknown keys are ignored and coordinates are clamped into
 * the room, so a blob from a future version, or one edited by hand into nonsense, is
 * absorbed rather than fatal — with one exception: anything that is not a finite
 * number is left alone entirely, because "put this desk at NaN" has no sane clamp.
 *
 * Callers must rebuild whatever they derived for themselves afterwards — the nav
 * grid, and the world-space anchors on the prop handles. `reviseLayout()` only knows
 * about the config's own derived numbers.
 *
 * @param {object} blob  as produced by `layoutSnapshot()`
 * @returns {boolean} whether anything was actually applied
 */
export function applyLayout(blob) {
  // Channels first, because they are a setting rather than a piece of furniture and
  // nothing downstream derives from them. Only booleans are taken: a blob is something
  // people edit, and `courier: 'yes'` should be ignored rather than believed.
  if (blob && typeof blob === 'object' && blob.channels && typeof blob.channels === 'object') {
    for (const [key, on] of Object.entries(blob.channels)) {
      if (key === 'birdKind') {
        // The one non-boolean channel: a species choice. Same rule as the
        // booleans — an unrecognised value is ignored rather than believed.
        if (BIRD_KIND_OPTIONS.includes(on)) CHANNELS.birdKind = on;
      } else if (key in CHANNELS && typeof on === 'boolean') CHANNELS[key] = on;
    }
  }
  if (!blob || typeof blob !== 'object') return false;
  let touched = false;

  const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
  /**
   * Read a colour onto a piece that has a palette.
   *
   * A blob that does not name one is not changing it — but null *is* a name here, and
   * means "follow the room", so absent and null are told apart. A name the kind does
   * not have is ignored rather than taken, on the same terms as a nonsense heading.
   */
  const paint = (target, from) => {
    const palette = FURNITURE_KINDS[target.kind]?.palette;
    if (!palette || !from || !('color' in from)) return;
    const want = from.color;
    if (want === null || (typeof want === 'string' && want in palette)) {
      target.color = want;
      touched = true;
    }
  };

  const move = (target, from, { facing = true } = {}) => {
    if (!from || typeof from !== 'object') return;
    target.x = clampX(num(from.x, target.x));
    target.z = clampZ(num(from.z, target.z));
    if (facing && 'facing' in target) target.facing = squareUp(num(from.facing, target.facing));
    touched = true;
  };

  /**
   * Whether this blob is entitled to delete things.
   *
   * A blob from `layoutSnapshot()` describes the whole room, so a piece it does not
   * mention is a piece that is not there any more — that is how undoing an addition,
   * and resetting to the authored room, put furniture *away* rather than only back.
   *
   * A blob somebody typed is a different thing: half a dozen lines naming the two
   * desks they wanted moved. Reading absence as deletion there would empty the room on
   * the strength of a note about part of it, so a blob that does not claim to be
   * complete is only ever allowed to move and to add.
   */
  const prune = blob.complete === true;

  const family = (entries, { list, id, keyOf, move: moveOne, create }) => {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
    for (const [key, from] of Object.entries(entries)) {
      const existing = list().find((item) => id(item) === key);
      if (existing) moveOne(existing, from);
      else if (create(key, from)) touched = true;
    }
    if (!prune) return;
    const keep = new Set(Object.keys(entries));
    // Through the same gate a deliberate deletion goes through, so a blob cannot do
    // by omission what the editor would refuse to do on a keypress — a room whose
    // mailbox is missing from the plan keeps its mailbox.
    for (const item of list().filter((i) => !keep.has(id(i)))) {
      if (canRemoveObject(keyOf(item)).ok && dropInstance(item)) touched = true;
    }
  };

  family(blob.desks, {
    list: () => DESKS,
    id: (d) => d.id,
    keyOf: (d) => `desk:${d.id}`,
    // A blob may also convert a desk it already knows: `standing` is the one property of
    // a desk that is neither its place nor its heading, so `move` cannot carry it.
    move: (d, from) => {
      move(d, from);
      if (from && 'standing' in from) d.standing = !!from.standing;
    },
    create: (key, from) => !!addDesk({
      id: key, x: num(from?.x, ROOM.W / 2), z: num(from?.z, ROOM.D / 2), facing: num(from?.facing, 0),
      standing: !!from?.standing,
    }),
  });

  family(blob.stations, {
    list: () => Object.values(STATIONS),
    id: (s) => s.id,
    keyOf: (s) => `station:${s.id}`,
    move: (s, from) => move(s, from),
    // A station entry names its kind. One that does not gets the benefit of the doubt
    // from its own id, so a hand-written `"bookshelf-2": { x, z }` is understood.
    create: (key, from) => !!addStation(stationKindOf(from?.kind ?? key), {
      id: key, x: num(from?.x, ROOM.W / 2), z: num(from?.z, ROOM.D / 2), facing: num(from?.facing, 0),
    }),
  });

  family(blob.plants, {
    list: () => DECOR.plants,
    id: (p) => p.id,
    keyOf: (p) => `plant:${p.id}`,
    /**
     * A blob may also **repot** a plant it already knows.
     *
     * The same argument the desk's `standing` makes above, and it took the layout
     * generator to notice the asymmetry: a plant's species, its size and whether
     * it follows the seasons are three properties that are neither its place nor
     * its heading, so `move` cannot carry them — and without this, importing a
     * layout with a fern at `plant-2` into a room whose `plant-2` is a monstera
     * silently kept the monstera. The plan said fern, the room showed monstera,
     * and the difference is a third of a unit of blocked floor (see `spread` in
     * `PLANT_KINDS`), which is enough for the nav grid and the plan to disagree
     * about whether a desk beside it fits.
     *
     * Each is taken only if it is *sayable*: an unknown species is ignored rather
     * than believed, exactly as `addPlant` refuses to create one.
     */
    move: (p, from) => {
      move(p, from);
      if (from && PLANT_KINDS[from.kind]) p.kind = from.kind;
      if (from && Number.isFinite(from.scale)) p.scale = from.scale;
      if (from && 'seasonal' in from) p.seasonal = !!from.seasonal;
    },
    // Unlike a station, a plant cannot be guessed from its id: `plant-7` says nothing
    // about what is growing in it, so an entry with no species is left unplanted.
    create: (key, from) => !!addPlant(from?.kind, {
      id: key, x: num(from?.x, ROOM.W / 2), z: num(from?.z, ROOM.D / 2),
      facing: num(from?.facing, 0), scale: from?.scale, seasonal: from?.seasonal,
    }),
  });

  family(blob.furniture, {
    list: () => FURNITURE,
    id: (f) => f.id,
    keyOf: (f) => `furniture:${f.id}`,
    move: (f, from) => { move(f, from); paint(f, from); },
    // Like a station and unlike a plant, a piece of furniture can be guessed from its
    // own id when an entry does not name its kind, so a hand-written `"couch-2": {x, z}`
    // is understood.
    create: (key, from) => !!addFurniture(furnitureKindOf(from?.kind ?? key), {
      id: key,
      x: num(from?.x, ROOM.W / 2),
      z: num(from?.z, ROOM.D / 2),
      facing: num(from?.facing, 0),
      color: typeof from?.color === 'string' ? from.color : null,
    }),
  });

  for (const key of MOVABLE_DECOR) move(DECOR[key], blob.decor?.[key]);

  // Version 3 kept the rug under `decor`, one per room. Read onto the first rug the
  // room has — which in a room nobody has since added to is the very rug it was
  // exported from — and skipped where there is no longer one, for the reason the v2
  // couch below is skipped: a blob from before rugs could be counted is no evidence
  // about how many there are.
  const firstRug = furnitureOfKind('rug')[0];
  if (firstRug && blob.decor?.rug) {
    move(firstRug, blob.decor.rug);
    paint(firstRug, blob.decor.rug);
  }

  // Version 2 had one couch, one side table and one lamp, each a singleton — the couch
  // in a top-level entry and the other two among the decor. Those blobs still describe
  // the room they came from, so each is read onto the first piece of its kind, which in
  // a room nobody has since added to is the very piece it was exported from. Skipped
  // entirely where the room no longer has one, rather than creating it: a v2 blob is
  // silent about how many there are, so it is no evidence that one is missing.
  const firstCouch = couches()[0];
  if (firstCouch) move(firstCouch, blob.couch);
  for (const kind of ['sideTable', 'floorLamp']) {
    const first = furnitureOfKind(kind)[0];
    if (first) move(first, blob.decor?.[kind], { facing: false });
  }

  // Version 1 kept plants in an array, where a plant's identity was its position in
  // it. Still read, because a blob that was exported then is still a description of
  // this room: the list moves the plants it lines up with and leaves the rest.
  if (Array.isArray(blob.plants)) {
    for (const [i, p] of DECOR.plants.entries()) move(p, blob.plants[i], { facing: false });
  }

  if (touched) reviseLayout();
  return touched;
}

/** Put every prop back where it was authored, and put away anything since added. */
export function resetLayout() {
  return applyLayout(AUTHORED);
}

/**
 * The authored layout, as a fresh copy.
 *
 * What `resetLayout()` returns the room to — exported so anything comparing the
 * current plan against "unchanged" (the editor's Save button, for one) asks the
 * same authority the reset uses instead of keeping a copy of its own.
 */
export function authoredLayout() {
  // Rounded to the same precision an export or a comparison snapshot uses, so
  // "is the room still the authored one?" is answered on equal terms — the raw
  // AUTHORED carries full-precision floats a rounded snapshot can never match.
  return roundBlob(JSON.parse(JSON.stringify(AUTHORED)));
}

// --- Furniture that comes and goes ------------------------------------------

/**
 * A fresh id of the form `desk-6`, counting up past everything already called that.
 *
 * Past, not into gaps: deleting `desk-3` and adding a desk gives `desk-6` rather than
 * reusing the name, because an id is what a saved layout and an undo step refer to and
 * a recycled one would quietly point at a different piece of furniture.
 */
function nextId(prefix, taken) {
  let n = taken.length + 1;
  const used = new Set(taken);
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/**
 * A free id for one more station of a kind.
 *
 * The first of a kind is called after the kind itself — `mailbox`, not `mailbox-1` —
 * which is what lets `STATIONS.mailbox` go on meaning the mailbox, and is why every
 * singleton in the authored room reads the way it always did. The second onwards
 * counts.
 */
function freeStationId(kind) {
  if (!STATIONS[kind]) return kind;
  let n = stationsOfKind(kind).length + 1;
  while (STATIONS[`${kind}-${n}`]) n += 1;
  return `${kind}-${n}`;
}

/** The station kind a name refers to, allowing for it being an instance id. */
function stationKindOf(name) {
  if (typeof name !== 'string') return null;
  if (STATION_KINDS[name]) return name;
  const base = name.replace(/-\d+$/, '');
  return STATION_KINDS[base] ? base : null;
}

/** A free id for one more piece of furniture of a kind. See `freeStationId`. */
function freeFurnitureId(kind) {
  const taken = new Set(FURNITURE.map((f) => f.id));
  if (!taken.has(kind)) return kind;
  let n = furnitureOfKind(kind).length + 1;
  while (taken.has(`${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

/** The furniture kind a name refers to, allowing for it being an instance id. */
function furnitureKindOf(name) {
  if (typeof name !== 'string') return null;
  if (FURNITURE_KINDS[name]) return name;
  const base = name.replace(/-\d+$/, '');
  return FURNITURE_KINDS[base] ? base : null;
}

/**
 * Add a desk, and with it a seat for one more agent thread.
 *
 * @param {{id?: string, x?: number, z?: number, facing?: number}} [spec]
 * @returns {?object} the desk, or null if the room is already full of them
 */
export function addDesk({ id, x = ROOM.W / 2, z = ROOM.D / 2, facing = 0, standing = false } = {}) {
  if (DESKS.length >= DESK_LIMITS.max) return null;
  const desk = {
    id: id && !DESKS.some((d) => d.id === id) ? id : nextId('desk', DESKS.map((d) => d.id)),
    x: clampX(x), z: clampZ(z), facing: squareUp(facing),
    // Only on the desks that are one, so an ordinary desk's spec is unchanged from
    // before sit-stand desks existed and `'standing' in spec` stays a real question.
    ...(standing ? { standing: true } : {}),
  };
  DESKS.push(desk);
  return desk;
}

/**
 * Add a station of a kind, if that kind allows another one.
 *
 * This is where "one mailbox" is actually enforced, and it is the only place: the
 * editor asks the same question to decide whether to offer the kind at all, but a blob
 * naming a second mailbox comes through here and is refused too.
 *
 * @param {?string} kind  a key in STATION_KINDS
 * @param {{id?: string, x?: number, z?: number, facing?: number}} [spec]
 * @returns {?object} the station, or null if there is already the most it may have
 */
export function addStation(kind, { id, x = ROOM.W / 2, z = ROOM.D / 2, facing = 0 } = {}) {
  const def = STATION_KINDS[kind];
  if (!def) return null;
  if (stationsOfKind(kind).length >= def.max) return null;

  const key = (id && !STATIONS[id]) ? id : freeStationId(kind);
  const at = { x: clampX(x), z: clampZ(z) };
  const square = squareUp(facing);

  // Built through the same factory as the authored stations where there is standing
  // room to derive, so a new coffee machine gets its approach point and its
  // `lookRotation` on exactly the terms the original did. `station()` works those out
  // from an approach *point*, so the kind's default distance is turned into one.
  const dir = heading(square);
  const s = def.approachDist == null
    ? { kind, id: key, ...at, facing: square }
    : station(kind, key, at.x, at.z, {
      x: at.x + dir.x * def.approachDist,
      z: at.z + dir.z * def.approachDist,
    });

  STATIONS[key] = s;
  return s;
}

/**
 * Add a floor plant of a species.
 *
 * @param {?string} kind  a key in PLANT_KINDS
 * @param {{id?: string, x?: number, z?: number, scale?: number, seasonal?: boolean}} [spec]
 * @returns {?object} the plant, or null for an unknown species or a full room
 */
export function addPlant(kind, { id, x = ROOM.W / 2, z = ROOM.D / 2, facing, scale, seasonal } = {}) {
  const def = PLANT_KINDS[kind];
  if (!def) return null;
  if (DECOR.plants.length >= PLANT_LIMITS.max) return null;
  const taken = DECOR.plants.map((p) => p.id);
  const plant = {
    id: id && !taken.includes(id) ? id : nextId('plant', taken),
    kind,
    x: clampX(x), z: clampZ(z),
    facing: squareUp(Number.isFinite(facing) ? facing : 0),
    scale: Number.isFinite(scale) ? scale : def.scale,
    seasonal: !!seasonal,
  };
  DECOR.plants.push(plant);
  return plant;
}

/**
 * Add a piece of free-standing furniture.
 *
 * A couch arrives with the two fields its geometry is derived into — an `approach` point
 * and a `seats` list — present but empty, seeded here so the shape is complete from the
 * moment the object exists, exactly as `station()` seeds a station's. `reviseLayout()`
 * fills them in; the caller runs it, on the same terms as `addStation()`, because one
 * revision after a batch of edits is cheaper than one per edit and the editor already
 * does it either way.
 *
 * @param {?string} kind  a key in FURNITURE_KINDS
 * @param {{id?: string, x?: number, z?: number, facing?: number}} [spec]
 * @returns {?object} the piece, or null for an unknown kind or a room already full of them
 */
export function addFurniture(kind, { id, x = ROOM.W / 2, z = ROOM.D / 2, facing = 0, color = null } = {}) {
  const def = FURNITURE_KINDS[kind];
  if (!def) return null;
  if (furnitureOfKind(kind).length >= FURNITURE_LIMITS.max) return null;

  const square = squareUp(facing);
  const piece = {
    id: id && !FURNITURE.some((f) => f.id === id) ? id : freeFurnitureId(kind),
    kind,
    x: clampX(x), z: clampZ(z),
    // A heading only for a piece that has a front. Its absence is what tells the editor
    // this is something that does not turn, which is the rule the floor lamp follows.
    ...(def.turns ? { facing: square } : {}),
    // A colour only for a kind that comes in colours, and null — "whatever the room
    // is" — for the same reason the authored rug starts there. See `RUG_COLORS`.
    ...(def.palette && { color: color in def.palette ? color : null }),
  };
  if (def.seatOffsets) {
    piece.approach = { x: piece.x, z: piece.z };
    piece.seats = [];
  }

  FURNITURE.push(piece);
  return piece;
}

/**
 * The pieces of furniture the editor may add, right now.
 *
 * One list for the four families that can grow, so the panel is a loop over this rather
 * than four special cases.
 *
 * Only what can actually be added. An earlier version listed every kind and flagged the
 * full ones — the room that already has its coffee machine still offered one, greyed out
 * and relabelled — on the reasoning that "no more of those" is information. In use it is
 * mostly noise: the singular kinds are the majority of the list, so a room in its normal
 * state showed a picker of mostly dead entries, and the one fact they carried is a rule
 * about offices that does not change and does not need restating on every redraw. What
 * is left is a short list of things pressing Add will do something with.
 *
 * Each entry carries the jobs its kind can do, so a menu can be grouped by what things
 * are *for* rather than by a list of families somebody kept in step by hand. That is
 * what makes a new kind land in the right place on its own: give a telescope
 * `roles: ['research']` and it appears under research with nothing else edited.
 *
 * @returns {{key: string, label: string, roles: string[], note: ?string}[]}
 */
export function addableObjects() {
  return kitItems().filter((i) => !i.full);
}

/**
 * Every kind the kit knows, addable or not, with the jobs it does and why it is full.
 *
 * `addableObjects()` is this list minus what the room already has all of, and that is
 * the right answer for most of the picker: a menu mostly made of dead entries is noise,
 * which is why an earlier version listing every kind greyed out was taken back out.
 *
 * But it is the wrong answer for the handful of kinds that carry a *required job*. A
 * room with its one mailbox offered no mailbox at all, so the section about how work
 * arrives and leaves listed only the inbox — and the one thing worth saying about a
 * mailbox, that there may only be one because the post is a single queue, had nowhere
 * to be said. So the full list exists too, and the menu draws a full kind as an
 * explanation rather than an offer, in the sections where the explanation earns its
 * space (see `groupKit`).
 *
 * @returns {{key: string, label: string, roles: string[], note: ?string,
 *   full: boolean}[]}
 */
export function kitItems() {
  const out = [];
  const deskRoom = DESKS.length < DESK_LIMITS.max;
  out.push({
    key: 'desk', label: 'Desk', roles: [], full: !deskRoom,
    note: 'One agent works at one desk, so this is the headcount.',
  });
    // Offered directly under the desk rather than among the furniture, because that is
    // what it is: adding one hires somebody, exactly as adding a desk does, and it is
    // subject to the same five-desk limit — hence inside this `if` rather than beside it.
    //
    // `desk:standing`, not `standingDesk`. The key grammar here is `family:kind`, and a
    // key with no colon is read as a bare family: `standingDesk` came out as family
    // `standingDesk` on the way in but as family `desk`, kind nothing, on the way out, so
    // the menu item quietly added an ordinary desk and the branch meant to catch it was
    // unreachable. A kind of desk should say so in the half of the key that means kind.
  out.push({
    key: 'desk:standing', label: 'Standing desk', roles: [], full: !deskRoom,
    note: 'A desk on a sit-stand frame. Still one of the desks, not an extra.',
  });
  for (const [kind, def] of Object.entries(STATION_KINDS)) {
    out.push({
      key: `station:${kind}`,
      label: def.label,
      roles: def.roles ?? [],
      note: def.note ?? null,
      full: stationsOfKind(kind).length >= def.max,
    });
  }
  for (const [kind, def] of Object.entries(FURNITURE_KINDS)) {
    out.push({
      key: `furniture:${kind}`, label: def.label, roles: [], note: null,
      // Whether the editor can paint one. Read off the kind's own `palette` rather than
      // listed again here, so the couch, the armchair and the rug say so for themselves
      // and a fourth paintable kind needs nothing added.
      colourable: !!def.palette,
      full: furnitureOfKind(kind).length >= FURNITURE_LIMITS.max,
    });
  }
  const plantRoom = DECOR.plants.length < PLANT_LIMITS.max;
  for (const [kind, def] of Object.entries(PLANT_KINDS)) {
    out.push({ key: `plant:${kind}`, label: def.label, roles: [], note: null, full: !plantRoom });
  }
  return out;
}

/**
 * Bring one of `addableObjects()` into being.
 *
 * @param {string} key  as listed there: `desk`, `station:bookshelf`, `plant:fig`
 * @param {{x?: number, z?: number, facing?: number}} [at]
 * @returns {?{key: string, spec: object}} the new piece and the key the layout knows
 *   it by — the same key `obstacleFootprints()` tags its rectangle with, so the caller
 *   can hand it straight to the editor's own validation
 */
export function addObject(key, at = {}) {
  const [family, kind] = key.includes(':') ? key.split(':') : ['desk', null];
  // One family, two kinds. Whichever is added, it is a desk from here on: found, moved,
  // turned and removed as `desk:<id>` like any other, and counted in the headcount.
  if (family === 'desk') {
    const desk = addDesk({ ...at, standing: kind === 'standing' });
    return desk && { key: `desk:${desk.id}`, spec: desk };
  }
  if (family === 'station') {
    const s = addStation(kind, at);
    return s && { key: `station:${s.id}`, spec: s };
  }
  if (family === 'furniture') {
    const f = addFurniture(kind, at);
    return f && { key: `furniture:${f.id}`, spec: f };
  }
  if (family === 'plant') {
    const p = addPlant(kind, at);
    return p && { key: `plant:${p.id}`, spec: p };
  }
  return null;
}

/**
 * May this piece be taken out of the room?
 *
 * Not everything may. A room needs somewhere to work, so it keeps one desk; and it keeps
 * the last station able to do each job in `JOB_ROLES`, which is what stops the post
 * being deleted out from under the agents who walk to it. There is no such thing as a
 * room that cannot post its finished work.
 *
 * **By job, not by kind**. It used to keep the last station of every *kind*,
 * which made every singleton mandatory for no reason anybody had given: the printer was
 * kept although it has no work, the coat stand although the code copes without it, and
 * a second bookshelf freed the first — so the rule was never "the office needs a
 * bookshelf" but "the office needs one of each kind it owns". Asking about the job is
 * both weaker and stronger. Weaker, because a station doing no required job may simply
 * go. Stronger, because the room keeps the *capability* however it is provided: add a
 * telescope with `roles: ['research']` and the bookshelf is free to leave.
 *
 * The refusal names the job rather than the prop, since the job is the reason. "The
 * office needs somewhere to deliver" is a sentence about the room; "the office needs its
 * Mailbox" was a sentence about the furniture, and read as arbitrary because it was.
 *
 * Furniture is absent from the list of things that can refuse, and deliberately: a couch,
 * a table and a lamp all go down to none. Nothing walks to them by necessity — resting is
 * an idle pastime and falls back to a drink when there is nowhere to sit — so the last one
 * is not load-bearing the way the last bookshelf is.
 *
 * @param {string} key  a footprint key, e.g. `desk:desk-6` or `station:bookshelf-2`
 * @returns {{ok: boolean, why: string}}
 */
export function canRemoveObject(key) {
  const found = findInstance(key);
  if (!found) return { ok: false, why: 'nothing the layout knows about' };
  const { family, item } = found;
  if (family === 'desk' && DESKS.length <= DESK_LIMITS.min) {
    return { ok: false, why: 'the office needs a desk to work at' };
  }
  if (family === 'station') {
    // The jobs this station is the last one able to do, and that the room needs doing.
    const orphaned = rolesOf(item)
      .filter((role) => JOB_ROLES.includes(role) && stationsForRole(role).length <= 1);
    if (orphaned.length) {
      return { ok: false, why: `the office needs somewhere to ${ROLE_VERBS[orphaned[0]]}` };
    }
  }
  if (family === 'furniture' && furnitureOfKind(item.kind).length <= FURNITURE_LIMITS.min) {
    return { ok: false, why: `no ${FURNITURE_KINDS[item.kind]?.label ?? item.kind} left to remove` };
  }
  if (family === 'plant' && DECOR.plants.length <= PLANT_LIMITS.min) {
    return { ok: false, why: 'no plants left to remove' };
  }
  return { ok: true, why: '' };
}

/**
 * The colours this prop can be set to, and the one it is set to now.
 *
 * Null for the great majority of props, which have no choice about their colour — a
 * desk is the colour a desk is. The panel asks this of whatever is selected and draws a
 * row of swatches if it gets an answer, so nothing in the editor has to know that the
 * rug is the one with a palette.
 *
 * `current` is null when nothing has been chosen, which is a real state rather than a
 * missing one: it means the room's own theme is painting it. See `RUG_COLORS`.
 *
 * @param {string} key  a footprint key
 * @returns {?{current: ?string, options: {key: string, label: string, hex: number}[]}}
 */
export function paletteOf(key) {
  const found = findInstance(key);
  const palette = found && FURNITURE_KINDS[found.item.kind]?.palette;
  if (!palette) return null;
  return {
    current: found.item.color ?? null,
    options: Object.entries(palette).map(([k, def]) => ({ key: k, label: def.label, hex: def.hex })),
  };
}

/**
 * Paint the selected prop, or hand it back to the room's own theme with null.
 *
 * @param {string} key  a footprint key
 * @param {?string} color  a name from the prop's palette, or null to follow the room
 * @returns {boolean} whether anything changed
 */
export function setObjectColor(key, color) {
  const found = findInstance(key);
  const palette = found && FURNITURE_KINDS[found.item.kind]?.palette;
  if (!palette) return false;
  if (color !== null && !(color in palette)) return false;
  if ((found.item.color ?? null) === color) return false;
  found.item.color = color;
  return true;
}

/**
 * The kit key that would bring a second one of this piece into being.
 *
 * The bridge between an instance and the list of what can be added: `furniture:couch-1`
 * is one couch, `furniture:couch` is the idea of a couch, and Duplicate needs to go from
 * the first to the second. Null for anything the room is built with exactly one of,
 * which is what stops a second rug — there is no list to put it in.
 *
 * @param {string} key  a footprint key
 * @returns {?string} a key `addableObjects()` would list, or null
 */
export function kitKeyOf(key) {
  const found = findInstance(key);
  if (!found) return null;
  const { family, item } = found;
  if (family === 'desk') return 'desk';
  if (['station', 'furniture', 'plant'].includes(family)) return `${family}:${item.kind}`;
  return null;
}

/**
 * Whether the selected prop has a heading to turn, and why not if it has none.
 *
 * The same shape as `canRemoveObject` and asked at the same moment, because the panel
 * has the same job for both: say what this item can do before anybody presses a key at
 * it. A floor lamp is a pole under a round shade and looks the same from every side, so
 * a quarter turn is an edit that does nothing — and a control that offers it is a
 * control that lies.
 *
 * @param {string} key  a footprint key
 * @returns {{ok: boolean, why: string}}
 */
export function canTurnObject(key) {
  const found = findInstance(key);
  if (!found) return { ok: false, why: 'nothing the layout knows about' };
  const { family, item } = found;
  if (item.facing == null) {
    const kind = family === 'furniture'
      ? (FURNITURE_KINDS[item.kind]?.label ?? item.kind)
      : 'it';
    return { ok: false, why: `${kind} looks the same from every side` };
  }

  return { ok: true, why: '' };
}

/**
 * Take a piece of furniture out of the room.
 *
 * @param {string} key  a footprint key
 * @returns {boolean} whether it went
 */
export function removeObject(key) {
  if (!canRemoveObject(key).ok) return false;
  const found = findInstance(key);
  if (!dropInstance(found.item)) return false;
  reviseLayout();
  return true;
}

/** Which family a footprint key belongs to, and the record it names. */
function findInstance(key) {
  if (typeof key !== 'string') return null;
  const [family, id] = key.split(':');
  if (family === 'desk') {
    const item = DESKS.find((d) => d.id === id);
    return item && { family, item };
  }
  if (family === 'station') {
    const item = STATIONS[id];
    return item && { family, item };
  }
  if (family === 'furniture') {
    const item = FURNITURE.find((f) => f.id === id);
    return item && { family, item };
  }
  if (family === 'plant') {
    const item = DECOR.plants.find((p) => p.id === id);
    return item && { family, item };
  }
  return null;
}

/**
 * Remove a record from whichever list holds it.
 *
 * Shared by `removeObject()` and by the pruning half of `applyLayout()`, which is what
 * keeps a deletion and an undone addition the same operation.
 */
function dropInstance(item) {
  if (STATIONS[item.id] === item) {
    delete STATIONS[item.id];
    return true;
  }
  for (const list of [DESKS, FURNITURE, DECOR.plants]) {
    const i = list.indexOf(item);
    if (i >= 0) {
      list.splice(i, 1);
      return true;
    }
  }
  return false;
}
