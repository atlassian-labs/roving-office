import { Agent } from './Agent.js';
import {
  AgentController, walk, face, follow, lookAt, sit, stand, stepTo, turnChair, wait,
  waitUntil, status, carry, act, vec,
} from './states.js';
import { NavGrid } from './pathfinding.js';
import { SHIRT_PALETTE } from './colour.js';
import { chance, pick, spread } from '../dice.js';
import { resolveOverlaps, wayBlocked, StandingSpots, declutterTags } from './crowd.js';
import { ARRIVALS, Post, arrivalFor } from './post.js';
import { PILOT_HOLD, PILOT_PART, pilotAction, pilotPlan } from './pilot.js';
import { RING_SECONDS } from '../scene/props/printer.js';
import { BIRD_SHARE } from '../scene/birds.js';
import { DOOR } from '../config.js';
import { CHANNELS, STATION_KINDS, enabledArrivals, insideCouch, postBoxFor, stationForRole, stationsForRole } from '../layout.js';
import { SEAT_HEIGHT } from '../scene/props/desk.js';
import { COUCH_SEAT_HEIGHT } from '../scene/props/couch.js';
import { BeamUps } from '../scene/beam.js';

// Owns every agent and turns lifecycle events into office behaviour.
//
// Events arrive from one or more feeds (src/data/feeds.js), and `handleEvent`
// takes the SourceDef they came in on alongside the event itself: an office can
// be filled by several sources at once, so "which harness is this" is a property
// of the agent, not of the room.
//
// Event shape (identical for every source):
//   { type:'spawn',    id, name, color? }
//   { type:'rename',   id, name }         same person, new job
//   { type:'status',   id, status:'working'|'waiting'|'error'|'idle' }
//   { type:'job',     id, job }
//   { type:'research', id, topic?, scope:'graph'|'web' }
//     Where the answer is being looked for: the bookshelf holds what the company
//     knows, and the globe on top of it answers for the web. Defaults to 'graph'.
//   { type:'activity', id, activity:'drink'|'couch' }
//     Anything that isn't 'couch' means "take a drink break"; 'water' and
//     'coffee' are accepted as older names for it. Which station they walk to is
//     not the feed's call — it follows the preference the agent walked in with
//     (see agents/drinks.js).
//   { type:'mail',     job, forId?, arrival?:'letter'|'package', vehicle?:'plane'|'bird', plan? }
//     A request arrives: by air if it is small, by courier if it is not, and
//     addressed to one agent when `forId` says so. Sized from the title if the
//     feed doesn't say (see post.js). A `plan` is the checklist that came with the
//     request; it rides inside the envelope and lands when it is opened. `vehicle`
//     picks the letter channel's animal — a paper plane, or a bird (the roster by
//     day, the owl at night); left off, it is a toss like everything else about
//     arrival.
//   { type:'step',     id, step:{ id, title, index, of }|null, plan? }
//     Which part of the round this agent is on (spec §4.2). A label and nothing
//     more: it moves nobody, because parts are done at one desk and walking for
//     each of them would have an agent pace the room five times over one job.
//     Most rounds never send one.
//   { type:'dispatch',  id, summary? }
//   { type:'exit',     id }              agent walks out and is removed
//   { type:'despawn',  id }              immediate removal

const HOLD = 3600;               // "stay like this until told otherwise"

/**
 * The events a hand on the button outranks.
 *
 * Everything here is the feed's opinion about what an agent is *doing*, and while
 * somebody is being driven by hand (see `pilot`) that opinion is a frame or two from
 * overwriting the thing you pressed the button to watch. Everything not here still
 * lands: who somebody is — a rename, a colour, a face — is not a movement, and being
 * told to go home outranks any button.
 */
const HAND_HELD = new Set(['status', 'job', 'step', 'research', 'activity', 'dispatch']);

// The floor just inside the door, treated as somewhere people stand rather than a
// single point, so a lift-load of arrivals spreads out along it (see crowd.js).
const DOORWAY = { id: 'doorway', approach: DOOR.inside, lookRotation: 0 };

const entranceSteps = (direction, actions) => actions.map((a) => ({ ...a, entrance: direction }));


/**
 * Sitting down on a couch, in the order a person does it: come round to the floor
 * in front of the seat, turn to face out of the room, then lower yourself
 * backwards onto the cushion.
 *
 * The seat itself is never walked to. It sits inside the couch, so a path to it
 * aims at the nearest free floor instead — the far side of the furniture — and the
 * final leg cuts straight through the arm. The step in is a step, not a walk (see
 * `stepTo` in states.js).
 */
export const sitDownOn = (seat, seatHeight) => [
  walk(seat.front),
  face(seat.rotation),
  // No separate step in. `sit` carries them the last stride itself, lowering them as
  // it goes: stepping in first put a standing pair of legs through the couch frame,
  // and then the sit snapped the pose in one frame once they were already there.
  sit(seat.rotation, seatHeight, seat.position),
];

/** Getting up: onto your feet, then a step clear of the couch before walking off. */
export const standUpFrom = (seat) => [
  stand(),
  stepTo(seat.front),
];

// Where you stand to sit down in a chair: far enough out that the swung-out seat is
// not where your feet are, close enough that getting into it is one step back.
const CHAIR_FRONT = 0.95;

/**
 * Which way to swing a desk chair out, and where to stand to sit down in it.
 *
 * A desk seat is walkable floor, so a path to it succeeds — and that was the bug:
 * the route ran straight through the chair and the agent dropped into it from
 * behind, through the backrest. A chair is not sat on from behind. It is swung out
 * of the way first, which a task chair does by turning about its post.
 *
 * A quarter turn to either side clears the seat, so the side the arrival is already
 * on wins: it saves them walking round their own chair. Both sides are checked
 * against the room first, because the chair is not what they might back into.
 */
const chairEntry = (desk, nav, agent) => {
  const sides = [1, -1]
    .map((sign) => {
      const facing = desk.sitRotation + sign * (Math.PI / 2);
      return { facing, front: chairFront(desk, facing) };
    })
    .filter(({ front }) => nav.walkableAt(front.x, front.z))
    .sort((a, b) => a.front.distanceToSquared(agent.position)
                  - b.front.distanceToSquared(agent.position));
  if (sides.length) return sides[0];

  // Boxed in on both sides — furniture or a plant too close to stand beside. Swing
  // the chair right out into the lane they walked in along instead, which is floor
  // by definition: they were just standing on it.
  return chairEntryFromTheFront(desk);
};

/** The floor in front of a seat turned this way: where its occupant gets in and out. */
const chairFront = (desk, facing) => vec({
  x: desk.seat.x + Math.sin(facing) * CHAIR_FRONT,
  z: desk.seat.z + Math.cos(facing) * CHAIR_FRONT,
});

/** Straight out into the room: the way in that always exists, and the way back out. */
export const chairEntryFromTheFront = (desk) => {
  const facing = desk.sitRotation + Math.PI;
  return { facing, front: chairFront(desk, facing) };
};

/**
 * Sitting down at a desk, in the order a person does it: come up to the desk, swing
 * the chair out, step round to the front of it, lower yourself in, and swivel to the
 * monitors.
 *
 * The choreography is remembered on the agent's record so that getting up can undo
 * it — out the way they came in, rather than forwards through the desk.
 */
const sitDownAtDesk = (rec, desk, nav) => [
  // Which side to sit down from is decided from across the room, before they set
  // off, so that the walk brings them up beside the chair. Deciding it on arrival
  // meant walking in behind the chair first and then round the back of it.
  act(() => { rec.chairEntry = chairEntry(desk, nav, rec.agent); }),
  // If the last person to use this desk stood at it, the chair is parked aside and the
  // desk is up. Both are undone by the person who wants to sit: they pull the chair back
  // in and put the desk down. No-ops on an ordinary desk and on one already seated.
  act(() => desk.pushChairAside(false)),
  act(() => desk.setStanding(false)),
  walk(() => rec.chairEntry.front),
  // And wait for both to arrive, rather than assuming the walk was longer than the motor.
  // Usually already true by now, which is the point: this costs nothing when the desk
  // beat them to it and saves the one case where it did not. The chair matters as much as
  // the height — sitting on a chair still sliding back in is sitting on thin air.
  waitUntil(() => desk.raised === 0 && desk.chairAside === 0),
  ...getIntoChair(desk, () => rec.chairEntry),
];

/**
 * Taking up a post at a desk — sitting down at it, or standing up to it.
 *
 * The desk decides, not the person and not a coin: `takeStandingTurn` counts posts and
 * keeps the answer the same for three to five of them before flipping (see desk.js).
 * This was a `Math.random()` per job first, and it made the desk twitch — up, down, up
 * again across three consecutive jobs, which is nobody's working day. A height is a
 * decision somebody made about their morning, and it should look like one.
 *
 * Every caller of the old `sitDownAtDesk` goes through here, so nothing has to ask what
 * kind of desk it is holding: only a desk that says it is a sit-stand desk is asked how
 * this post should be worked, and a real desk handle answers no when it is not one anyway.
 * The two questions are not redundant — the cheap one first is what lets a test stand a
 * stub desk here without implementing the whole handle.
 */
const takeUpPostAtDesk = (rec, desk, nav) => (
  desk.standing && desk.takeStandingTurn()
    ? standAtDesk(rec, desk)
    : sitDownAtDesk(rec, desk, nav)
);

/**
 * Standing up to a raised sit-stand desk.
 *
 * Shorter than sitting down, but not by as much as it first looked. The early version
 * sent the desk up from across the room so the motor would be finished by the time they
 * arrived — and the chair went with it, because the chair was tied to the height. What
 * that actually drew was a chair rolling itself aside in an empty patch of floor while
 * its owner was still walking over. The room's furniture moves when somebody moves it.
 *
 * So the order is the order a person does it in: walk up to the desk, shove the chair
 * out of the way, and only then send the surface up. They wait through their own shove
 * and their own motor, which is a second and a half and reads as deliberate.
 *
 * No `chairEntry` is recorded, because they never get into the chair to need a way out.
 */
const standAtDesk = (rec, desk) => [
  act(() => { rec.standingAtDesk = true; }),
  walk(() => desk.approach),
  // Within arm's reach of it before touching it. The mat and the seat are the same patch
  // of floor, so the chair has to go before there is anywhere to stand.
  act(() => desk.pushChairAside(true)),
  waitUntil(() => desk.chairAside === 1),
  act(() => desk.setStanding(true)),
  waitUntil(() => desk.raised === 1),
  stepTo(desk.seat, 0.5),
  face(() => desk.sitRotation),
];

/**
 * Leaving a standing post: a step back off the mat.
 *
 * The desk stays up and the chair stays aside, because nobody has moved them — and the
 * next person to want a seat at this desk pulls the chair in and puts the top down
 * themselves (see `sitDownAtDesk`). A desk that tidied itself the moment its occupant
 * walked off would be the ghost all over again.
 */
const leavePostAtDesk = (rec, desk) => [
  stepTo(desk.approach, 0.3),
  act(() => { rec.standingAtDesk = false; }),
];

/**
 * Getting into a chair, once you are standing beside it.
 *
 * Split out from the walk that brings somebody here, and takes the way in as a getter
 * rather than reading it off an agent's record, so that this is the only description of
 * the movement anywhere. The movement library plays it too (docs/character-movements.html)
 * and a library with its own private copy of the choreography is a library that quietly
 * stops being true — which is exactly what happened the first time it had one.
 */
export const getIntoChair = (desk, entryOf) => [
  turnChair(desk, () => entryOf().facing),
  // Facing the way the chair faces, and stepping back into it: the same movement as
  // sitting down on the couch, and for the same reason — you sit on a seat from its
  // front, looking out of it.
  face(() => entryOf().facing),
  sit(null, SEAT_HEIGHT, desk.seat),
  turnChair(desk, desk.sitRotation),
];

/**
 * Getting up from a desk: swivel out of the desk, stand, step clear — then push the
 * chair back in, which by then is a chair turning on its own, because its occupant
 * is already walking away.
 */
const standUpFromDesk = (rec, desk) => {
  // Somebody seated with no remembered way in leaves by the front, which is always
  // clear. Desks belong to one person for their whole visit, so this is a fallback
  // rather than a case: nobody is turfed out of a chair they are already in.
  const entry = rec.chairEntry ?? chairEntryFromTheFront(desk);
  return [
    ...getOutOfChair(desk, entry),
    act(() => { rec.chairEntry = null; }),
  ];
};

/** Leaving a chair by the way you got into it. Shared with the movement library. */
export const getOutOfChair = (desk, entry) => [
  turnChair(desk, entry.facing),
  stand(),
  stepTo(entry.front, 0.26),
  turnChair(desk, desk.sitRotation),
];

// A stretch at the desk this long counts as a long job, and earns one roll for
// a mid-job drink run. Rolled once per job, so a marathon doesn't turn into a
// procession of coffee runs.
const LONG_JOB = 30;            // seconds of actual seated work
const P_DESK_DRINK = 0.2;

// How long an agent will stand at the mailbox waiting for a plane that has been
// posted but has not landed. Generous: a flight is 1.45s and a queued one waits
// for a free plane, so this only expires if something upstream dropped the
// envelope entirely, at which point standing there forever would be worse.
const MAIL_WAIT = 20;

// How long the globe keeps turning for one look-up: the walk over, the reading,
// and the walk back.
const RESEARCH_SPIN = 7;

/**
 * How long after being told to go home before the room stops waiting, in seconds.
 *
 * Going home is a walk across a room full of other people, and a walk can be held
 * up: a crowd at the door, a lift that has just closed, a flight of stairs
 * somebody else is on. Held up is fine — that is what the office is *for* — but
 * the walk is also the only way out, and until it finishes the character is still
 * standing there with a desk booked and a coat on the stand.
 *
 * The clock is the wall clock rather than accumulated frame time, and that is the
 * whole point of it. A browser stops drawing frames for a tab nobody is looking
 * at, while the feed's reaper goes on retiring sessions from a `setInterval` that
 * does keep running — so a window left in the background for a few hours comes
 * back to a room where every one of those departures has been told to leave and
 * not one of them has taken a step. Thirty *seconds* of frames might be hours of
 * that, and measuring the animation would let the room fill up without limit.
 * Wall time cannot be fooled by a loop that is not running.
 */
const LEAVE_GRACE = 30;

/**
 * How long without a drawn frame counts as a room nobody is looking at.
 *
 * Three seconds, which no running loop ever reaches — a hidden tab draws nothing
 * at all, and even a heavily throttled one manages several frames a second — and
 * which is short enough that the timer behind `tidy` never sits out a background
 * spell waiting to be sure.
 */
const FRAME_STALL = 3;

/**
 * The clock the grace period is measured on.
 *
 * `performance.now()` where there is one — it is monotonic, so a machine waking
 * from sleep with a corrected clock cannot beam the room out — and `Date.now()`
 * as the fallback. Held on the instance so a test can hand it a clock it drives
 * itself rather than sitting through thirty real seconds.
 */
const wallClock = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * How long a lookup takes at the station, whichever station it is.
 *
 * One constant because the three ways of looking something up are the same errand and
 * should read as taking the same time: a book off a shelf, a globe turned, an eye at an
 * eyepiece. It was written out three times as `2.8` before there was a third.
 */
const RESEARCH_HOLD = 2.8;

/**
 * How long somebody waits at the printer for a fax to go.
 *
 * The one beat that separates faxing from posting: an envelope is gone the moment it
 * is through the slot, and a machine takes a moment over a page. Shorter than the
 * prop's own `PRINT_RUN`, on purpose — they walk away while it is still chuntering,
 * which is what everybody does.
 */
const FAX_HOLD = 1.1;

/**
 * How long somebody spends dialling before the page goes in.
 *
 * Long enough to read as a number being punched in rather than a button being pressed
 * — a fax needs a whole number dialled, which is the joke — and short enough that the
 * errand does not become a wait. Four or five jabs at `DIAL_SPEED`.
 */
const FAX_DIAL = 1.4;

/**
 * How long a celebration lasts.
 *
 * Four beats of the dance rather than a round number of seconds: the hop runs at
 * `DANCE_RATE` and the sway at half of it, so a loop is two hops long and stopping
 * mid-loop leaves the figure leaning. Long enough to be seen from across the room,
 * short enough not to become the thing the room is doing.
 */
const DANCE_SECONDS = 3.4;

export class AgentManager {
  constructor(scene, props) {
    this.scene = scene;
    this.props = props;          // desks, bookshelves, mailbox, waterCooler, ...
    this.nav = new NavGrid();
    // Where people stand when several of them want the same machine. Desks and
    // couch seats book themselves; a station is one point in the layout, so the
    // floor in front of it is handed out here (see crowd.js).
    this.spots = new StandingSpots(this.nav);
    this.agents = new Map();     // id -> { agent, controller, desk, coatHook, ... }
    // Which character a session's events belong to: session id -> character id.
    //
    // One person can be running several sessions at once — an OpenClaw agent with two
    // cron jobs ticking, a chat and a scheduled errand — and they are one colleague with
    // two jobs rather than two colleagues who happen to share a name, a shirt and a face.
    // So the map from sessions to people is many-to-one, and this is it. Deliberately
    // *not* done by letting several keys into `this.agents`: everything
    // that walks the room iterates its values, and one character appearing twice in the
    // crowd would have them queueing behind themselves.
    this.jobOwner = new Map();
    // `<source id>|<actor>` -> character id, so the second session of an actor already in
    // the room finds them. Keyed on the source too, because two harnesses may each have
    // an agent called Sideline and they are not the same person.
    this.byActor = new Map();
    this.listeners = new Set();
    this.feedListeners = new Set();

    // The way out for anybody who cannot find the way out. Nothing is drawn until
    // the first time somebody is beamed up — see `_beamOut` and scene/beam.js.
    this.beams = new BeamUps(scene);
    /** Overridable so a test can drive the grace period. See `wallClock`. */
    this.now = wallClock;
    /** When `update` last ran, which is how `tidy` knows nobody is looking. */
    this._drawnAt = 0;

    // What is in the mailbox and whose it is. Oldest first, so work is picked up
    // in the order it arrived (see post.js for the ownership rules).
    this.post = new Post();
    // Faxes mid-ring: `{ left, payload }`, counted down in `update`. See `_post`.
    this.ringing = [];

    // A plane only counts as "delivered" when it actually touches down, so the
    // panel and the animation announce the job at the same instant.
    if (this.props.mail) {
      this.props.mail.onArrive = (payload) => this._mailArrived(payload);
    }
    if (this.props.birds) {
      // A bird's letter is announced as it leaves the talons, which is its touchdown.
      this.props.birds.onArrive = (payload) => this._mailArrived(payload);
    }
    if (this.props.deliveries) {
      // The courier's parcels arrive into the same box by the same route, because
      // once something is in the office it is just post.
      this.props.deliveries.onArrive = (payload) => this._mailArrived(payload);
    }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emitChange() { const r = this.roster(); for (const fn of this.listeners) fn(r); }

  /**
   * Subscribe to mailbox traffic. Entries are
   *   { kind: 'delivery'|'collected'|'removal', job, at, by?, for?, forColor? }
   * where `at` is a timestamp in ms and `for` is the name of the agent an
   * addressed envelope was posted to (absent when it is open to anyone), with
   * `forColor` their colour — the same one the plane was tinted with.
   *
   * The recipient is spelled out on the entry rather than left as an id for the
   * panels to look up, because an entry is a record of a moment: the line naming
   * who a delivery was for should still say so after they have gone home.
   */
  onFeed(fn) { this.feedListeners.add(fn); return () => this.feedListeners.delete(fn); }
  _emitFeed(entry) {
    const full = { ...entry, at: entry.at ?? Date.now(), pending: this.post.size };
    for (const fn of this.feedListeners) fn(full);
  }

  roster() {
    return [...this.agents.values()].map(({ agent, pilot, jobs }) => ({
      id: agent.id, name: agent.name, status: agent.status,
      // Every job this person has open, one entry each, oldest first. Usually one — and
      // for a single job the panels read `job` and `status` above exactly as before, so
      // nothing had to learn a new shape to keep working. Several means several: two
      // cron ticks, or a chat and an errand, and the row says both rather than picking
      // the newest and quietly dropping the other.
      jobs: [...(jobs?.values() ?? [])].map((j) => ({ id: j.id, title: j.title, status: j.status })),
      // Which button is driving this agent, if one is: the panel that drew the
      // buttons marks the pressed one and says the agent is being held.
      piloted: pilot?.key ?? null,
      color: agent.color, job: agent.job, drink: agent.drink,
      // Only set when the colour was somebody's choice rather than the palette's, so
      // the detail panel can say so without claiming a drawn colour means anything.
      colorLabel: agent.colorLabel ?? null,
      // A picture of whoever this is, when their harness sent one up.
      avatar: agent.avatar ?? null,
      variant: agent.variant,
      // Which part of the round is in hand, and the checklist behind it. Both null
      // for nearly every agent in the room; a panel that draws anything for null is
      // the panel with the bug.
      step: agent.step,
      plan: agent.plan,
      // The feed this one came in on, so the panels can mark each row with the
      // harness it belongs to rather than labelling the whole room with one.
      source: agent.source,
      recent: agent.recentJobs(),
    }));
  }

  getAgent(id) { return this.agents.get(id)?.agent ?? null; }

  /**
   * Whose desk this is, by first name, or null if nobody's.
   *
   * A desk is booked for as long as its occupant is in the building rather than for the
   * length of a job (see `_claimDesk`), so this is a stable answer and worth showing in
   * the editor: it is the one fact about a desk that is not visible by looking at it.
   *
   * First name only, because it is read in a narrow panel beside a coordinate pair, and
   * because a room this size has no two Peters in it. `rec.desk` is the truth here rather
   * than the desk's own `occupiedBy` — they are two sides of one booking, and this side is
   * the one that knows the person.
   *
   * @param   {string} deskId  the desk's layout id, e.g. `desk-4`
   * @returns {?string} their first name, or null if the desk is free
   */
  deskOccupantName(deskId) {
    for (const rec of this.agents.values()) {
      if (rec.desk?.id === deskId) return rec.agent.name.split(/\s+/)[0];
    }
    return null;
  }

  agentIdFromObject(obj) {
    let o = obj;
    while (o) {
      if (o.userData && o.userData.agentId) return o.userData.agentId;
      o = o.parent;
    }
    return null;
  }

  /**
   * Show everybody who came from these sources out of the building.
   *
   * The office's sources changed and some of them are no longer wanted. Their
   * characters walk out on the ordinary path — desk given back, coat off the stand,
   * lift called, out the door — rather than being deleted where they stand, because
   * unticking a source is a decision about a *feed*, and the person it was drawing
   * was standing at a desk a second ago. Removing the room instead, which is what
   * changing sources used to do, took everybody else with it.
   *
   * Anyone already on their way out is left to it, and the source is matched on the
   * agent's own def rather than on their id prefix: the prefix names the feed
   * instance, and this is a question about the source.
   *
   * @param {Array<string|{id: string}>} sources  source ids, or the defs themselves
   * @returns {number} how many were sent home
   */
  showOut(sources) {
    const ids = new Set();
    for (const s of sources ?? []) {
      const id = typeof s === 'string' ? s : s?.id;
      if (id) ids.add(id);
    }
    if (ids.size === 0) return 0;

    let sent = 0;
    // Over a copy: an agent with no door to reach is removed inside `_leave`, which
    // would edit the map underneath the loop.
    for (const rec of [...this.agents.values()]) {
      if (rec.leaving || !ids.has(rec.agent.source?.id)) continue;
      this._leave(rec);
      sent += 1;
    }
    return sent;
  }

  // -------------------------------------------------------------------------
  /**
   * @param {object} ev
   * @param {?object} [source] the SourceDef this event arrived on. Only a spawn
   *   uses it — everything after names an agent who already wears their source —
   *   so a feed that cannot say is simply an agent with no mark.
   */
  handleEvent(ev, source = null) {
    if (ev.type === 'spawn') return this._spawn(ev, source);

    // A new job arrives by paper airplane. The job name rides along so it can
    // be announced the moment the plane lands — and `forId`, when present,
    // addresses the envelope to one agent before it is even in the air.
    if (ev.type === 'mail') return this._post(ev);

    // Through the session-to-person map first, because an event names the session it
    // happened in and a session is not always a person of its own (see `jobOwner`). The
    // fallback keeps every harness that sends no identity working unchanged: with nothing
    // grouped, a session's id *is* its character's id.
    const rec = this.agents.get(this.jobOwner.get(ev.id) ?? ev.id);
    if (!rec) return;

    // Already going up in a cone of light. The room has stopped taking instructions
    // about them: they are gone in a second either way, and every behaviour below
    // would put a rising body back to work at a desk (see `_beamOut`).
    if (rec.beaming) return;

    // Being driven by hand: for as long as the hold lasts, the feed is not the
    // authority on what this agent is doing (see `pilot`). Dropped rather than
    // queued — a burst of buffered history would otherwise all land at once the
    // moment the hold expired, and the room would lurch.
    if (rec.pilot && HAND_HELD.has(ev.type)) return;

    return this._apply(rec, ev);
  }

  /**
   * One event, turned into office behaviour.
   *
   * Split from `handleEvent` so that a button in the agent detail panel can reach the
   * same behaviours the feed reaches, without going back through the gate that is
   * there to keep the feed off it (see `pilot`).
   */
  _apply(rec, ev) {
    switch (ev.type) {
      case 'status': {
        this._noteJob(rec, ev.id, { status: ev.status });
        return this._status(rec, ev.status);
      }
      // A live session is re-surnamed whenever it is given a new job. The person
      // is unchanged, so this must not disturb anything they are doing.
      case 'rename': {
        rec.agent.setName(ev.name);
        return this._emitChange();
      }
      // A harness that knows what colour an agent wears may only learn it a hook
      // after the session began (spec §3.2), so the shirt can change once, early.
      case 'recolor': {
        rec.agent.setColor(ev.color, ev.colorLabel ?? null);
        rec.desk?.setAssignment?.(rec.agent);
        return this._emitChange();
      }
      // A face arrives later still, since the adapter has to get the picture here
      // before it can point at it (spec §3.2).
      case 'avatar': {
        rec.agent.setAvatar(ev.avatar ?? null);
        return this._emitChange();
      }
      case 'job': {
        // If this agent's current work was retitled by what they pulled out of
        // the mailbox, keep honouring that title when the feed re-announces the
        // original (which it does after a trip to the bookshelf).
        const label = rec.jobAlias?.from === ev.job ? rec.jobAlias.to : ev.job;
        rec.agent.job = label;
        rec.agent.beginJob(label);
        this._noteJob(rec, ev.id, { title: label, status: 'working' });
        this._resetDeskTimer(rec);
        return this._emitChange();
      }
      // A harness may learn its concise job title after work has begun. Change the
      // job already in history instead of opening a second one for the same round.
      // Keep the alias even if the envelope is still flying: `_mailArrived` applies
      // it at touchdown, while `retitleFor` covers one already waiting in the box.
      case 'retitle': {
        const from = ev.from ?? rec.agent.job;
        if (from && from !== ev.job) rec.jobAlias = { from, to: ev.job };
        const mailChanged = this.post.retitleFor(rec.agent.id, from, ev.job);
        const jobChanged = rec.agent.retitleLatestJob(ev.job, from);
        this._noteJob(rec, ev.id, { title: ev.job });
        if (mailChanged || jobChanged) return this._emitChange();
        return undefined;
      }
      // A part of the round, in and out. No status, no journey, no log entry — the
      // panels repaint and that is the whole of it.
      case 'step': {
        rec.agent.setStep(ev.step ?? null, ev.plan);
        return this._emitChange();
      }
      case 'research': return this._research(rec, ev.topic, ev.scope);
      case 'activity': return this._activity(rec, ev.activity);
      case 'dispatch': return this._deliver(rec, ev.summary);
      // One session ended. That is the end of a *job*, and only the end of the person
      // when it was their last one — an agent whose cron tick finished while their chat
      // is still open has not gone home. `ev.id` is absent when the detail panel drives
      // this by hand, and by hand means the person, so that still shows them out.
      case 'exit': {
        if (ev.id && rec.jobs.size > 1 && rec.jobs.has(ev.id)) {
          rec.jobs.delete(ev.id);
          this.jobOwner.delete(ev.id);
          return this._emitChange();
        }
        return this._leave(rec);
      }
      case 'despawn': return this._remove(rec);
      default: console.warn('Unknown agent event', ev);
    }
  }

  // --- Driving one agent by hand --------------------------------------------
  //
  // The buttons along the bottom of the agent detail panel. The catalogue of what
  // they are is in pilot.js, and the reason they exist is there too; this is the
  // three things the room has to do about them — take the wheel, keep the errand
  // going, and hand it back.

  /**
   * Do this, now, and then stand still for a moment.
   *
   * Three parts, and each is a decision:
   *
   *   * **Whatever was in hand is over, quietly.** A hand on the button is neither a
   *     delivery nor an error, so nothing walks to the mailbox or the bin and the
   *     feed panel says nothing — the log closes the open entry where it stood and
   *     opens the one you asked for. That entry is what makes the panel's "Recent
   *     jobs" a record of which buttons were pressed, in order.
   *   * **The behaviour runs as a feed event.** Which is the point of the whole
   *     feature: the room is driven down the path a real harness drives it down.
   *   * **Then the agent is held**, for PILOT_HOLD seconds after the errand comes to
   *     rest, before the idle loop takes them back. See `_pilotTick`.
   *
   * @param {string} id    the agent to drive
   * @param {string} key   a key from PILOT_ACTIONS
   * @returns {boolean} whether there was anybody of that id to drive, and a button
   *   of that name to press
   */
  pilot(id, key) {
    const rec = this.agents.get(id);
    const action = pilotAction(key);
    if (!rec || !action) return false;

    // Beam up: the one press that is not an errand at all. There is no event to
    // apply, nothing to hold afterwards and nobody to hand back to the loop — it ends
    // with the agent not existing — so it goes straight to the room's own backstop and
    // returns. It is also the one press allowed on somebody already on their way out,
    // because being stuck on the way out is the situation it stands in for; the walk
    // they were on is thrown away inside `_beamOut`.
    if (action.beam) {
      rec.agent.finishJob('done');
      rec.agent.setStep(null, null);
      rec.jobAlias = null;
      return this._beamOut(rec);
    }

    // Somebody already at the lift with their coat on is not available to be driven:
    // the walk out is the one action list that ends in the agent not existing, and
    // interrupting it would strand them in the room with no way to leave it again.
    if (rec.leaving) return false;

    rec.agent.finishJob('done');
    rec.agent.setStep(null, null);
    rec.jobAlias = null;
    // Not on the way to the box any more, whatever they were doing a moment ago: the
    // flag exists to stop a re-announced job restarting that walk (see `_begin`),
    // and a stale one here would have `_work` decline to move them at all.
    rec.onMailRun = false;

    const plan = pilotPlan(action);
    rec.pilot = {
      key,
      // Seconds the errand has been at rest for. The hold runs on this rather than on
      // a wall clock so a backgrounded tab does not quietly serve the whole ten
      // seconds while nothing was being drawn.
      hold: 0,
      // The parts still to be worked through, and how long until the next one is
      // opened. Null for every button but the checklist.
      parts: plan ? [...plan.items] : null,
      partIn: PILOT_PART,
    };

    if (action.job) {
      rec.agent.job = action.job;
      rec.agent.beginJob(action.job);
    }
    // The checklist is handed over before the behaviour starts, unticked, the way one
    // arrives inside an envelope: the plan is drawn from the first frame and the parts
    // start being marked off once they are actually at the desk (see `_pilotTick`).
    if (plan) rec.agent.setStep(null, plan);

    // A request arriving is not something done *to* an agent — it is posted to the
    // room, and the office does not know whose it is or what it says until somebody
    // opens it — so it goes in by the front door rather than through the event gate.
    // Posted before the behaviour that fetches it, because the walk to the box is
    // built from what is in the box: `_work` sends them to the mailbox rather than
    // the inbox stack precisely because there is now post of their own, and they
    // stand at the box until it lands (see `_work` and MAIL_WAIT).
    if (action.mail) this._post({ type: 'mail', ...action.mail, forId: id });

    this._apply(rec, { ...action.event, id });
    this._emitChange();
    return true;
  }

  /**
   * Keep a hand-driven errand going, and hand the agent back when it is over.
   *
   * Called once a frame per agent, from `update`.
   */
  _pilotTick(rec, dt) {
    const p = rec.pilot;
    if (!p) return;

    // A checklist is worked through at the desk, so its parts wait until they are
    // sitting at one. Ticking during the walk over would have the panel counting off
    // work nobody has started, and the walk is not always short — a room whose only
    // free desk is across the floor, or a trip to the inbox for the material first.
    //
    // "Left to do" counts the open part as well as the ones not reached: the last
    // part still has to be ticked off, and a list whose final entry sits open forever
    // is exactly the checklist bug the panel exists to make visible.
    const left = p.parts && (p.parts.length > 0 || rec.agent.step !== null);
    if (left && rec.agent.seated && rec.agent.status === 'working') {
      p.partIn -= dt;
      if (p.partIn <= 0) {
        p.partIn = PILOT_PART;
        this._nextPart(rec, p);
        // Something just happened, so the pause has not begun. The hold is ten
        // seconds of *stillness* rather than ten seconds from the press — otherwise
        // a checklist longer than the hold would be handed back three parts in.
        p.hold = 0;
      }
    }

    if (!this._parked(rec)) { p.hold = 0; return; }
    p.hold += dt;
    if (p.hold >= PILOT_HOLD) this._letGo(rec);
  }

  /**
   * Tick the part in hand off the checklist and open the next one.
   *
   * The plan object is edited in place, which is what `pilotPlan` builds a fresh one
   * per press for: the panels read the agent's own plan every time they paint, so a
   * marked entry shows up in all four of them at once.
   */
  _nextPart(rec, p) {
    const { agent } = rec;
    const plan = agent.plan;
    const open = agent.step;

    // The checklist has gone — an envelope opened mid-errand carried one of its own,
    // and that one is the truth now. Drop the parts rather than counting against a
    // plan that is not there, and let the hold run out in the ordinary way.
    if (!plan) {
      p.parts.length = 0;
      agent.setStep(null);
      return;
    }

    if (open) {
      const done = plan.items.find((e) => e.id === open.id);
      if (done) done.status = 'completed';
    }

    const next = p.parts.shift() ?? null;
    if (next) next.status = 'active';
    const of = plan.items.length + plan.more;
    // `of` counts the whole list and the index is read off what is left, so the pair
    // agrees with the checklist beside it rather than being counted twice.
    agent.setStep(next ? { id: next.id, title: next.title, index: of - p.parts.length, of } : null);
    this._emitChange();
  }

  /**
   * Has this errand come to rest?
   *
   * Two ways a behaviour ends, and only one of them empties the queue. The rest
   * *park*: work at a desk finishes on `wait(HOLD)` — "stay like this until told
   * otherwise" — which is an hour long and never runs out, so waiting for an empty
   * queue would hold a piloted agent at their desk until the end of the afternoon.
   * Sitting in that wait with nothing behind it is the same thing as being finished.
   */
  _parked(rec) {
    const { current, queue } = rec.controller;
    if (queue.length) return false;
    if (!current) return true;
    return current.kind === 'wait' && current.duration >= HOLD;
  }

  /**
   * Hand a piloted agent back to the room.
   *
   * The seat is given up on the way out, because the hold can end anywhere: at a
   * desk, on a cushion, or standing at the coffee machine. `_release` is the same
   * list every other behaviour starts from, so what happens next starts from
   * somewhere a person could actually stand.
   */
  _letGo(rec) {
    rec.pilot = null;
    // The checklist described the errand, and the errand is over — the same rule a
    // real turn ending follows (spec §4.2 rule 3).
    rec.agent.setStep(null, null);
    // `run`, not `push`: they are parked in an hour-long wait, and that wait is the
    // thing being let go of.
    rec.controller.run(this._release(rec));
    this._idle(rec);
    this._emitChange();
  }

  /**
   * Record what one of a person's jobs is now doing.
   *
   * The character animates on the newest event whatever happens — one body, one thing at
   * a time — and this is the other half of that: the *panel* has to be able to say what
   * each job is doing, which the single `agent.status` cannot when there are two.
   *
   * Silent when the session is not one we are tracking. An event for an unknown job is
   * an event for a person we do have, so it has already been applied to them; inventing
   * a job row from it would put work on the panel that no `spawn` ever announced.
   */
  _noteJob(rec, sessionId, patch) {
    const job = sessionId ? rec.jobs?.get(sessionId) : null;
    if (!job) return;
    Object.assign(job, patch);
  }

  /**
   * Somebody new — or somebody already here, starting a second job.
   *
   * The second case is the whole of the many-sessions-one-person problem in one
   * branch. A `spawn` carries the actor
   * behind its session when the harness knows one (spec §3.2), and an actor already in
   * the room is the *same person*: their new session becomes another job of theirs, and
   * nobody walks in. No second character, no second desk, no second name badge reading
   * the same name — which is what a room with three identical Sidelines in it was.
   *
   * Somebody on their way out is not eligible. They have been told to go home and are
   * walking to the door; handing them a job would either strand them mid-stride or need
   * the leaving unwound, and a fresh arrival is both simpler and truer to what happened.
   */
  _spawn({ id, name, actor = null, color, colorLabel = null, variant = null, avatar = null }, source = null) {
    if (this.agents.has(id) || this.jobOwner.has(id)) return;

    const actorKey = actor && source?.id ? `${source.id}|${actor}` : null;
    const held = actorKey ? this.agents.get(this.byActor.get(actorKey)) : null;
    if (held && !held.leaving) {
      held.jobs.set(id, { id, title: null, status: held.agent.status });
      this.jobOwner.set(id, held.agent.id);
      return this._emitChange();
    }
    const agent = new Agent({
      id,
      name: name || id,
      // A colour the feed supplied is the agent's own — an OpenClaw agent with a
      // `Colour:` in its IDENTITY.md is recognisable across restarts, which a drawn
      // one never is. Everybody else gets the palette.
      color: color ?? this._pickColor(),
      colorLabel,
      avatar,
      source,
      variant,
    });
    // Arrive outside the door — which for a floor up a flight of stairs means at the
    // foot of it, a storey below, with the climb still to come.
    const arriveAt = this.props.stairs?.route[0] ?? DOOR.outside;
    agent.setPositionXZ(arriveAt.x, arriveAt.z);
    agent.setElevation(arriveAt.y ?? 0);
    agent.setRotation(0);                     // facing into the office (+z)
    this.scene.add(agent.root);

    // The controller asks the room before each step whether somebody is standing
    // where it is about to walk, so people queue instead of walking through each
    // other (see crowd.js).
    const controller = new AgentController(agent, this.nav,
      (walker, ux, uz) => wayBlocked(walker, this._people(), ux, uz),
      () => this._people());
    const rec = {
      agent, controller, desk: null, coatHook: null, couchSeat: null, book: null,
      // Which couch that seat is a cushion of. Remembered alongside the seat, for the
      // same reason a borrowed book remembers its shelf: with several couches in the
      // room, the standing room to walk to and step back out to is this couch's and not
      // whichever one happens to be first in the list.
      couch: null,
      // How this person got into their chair, so they can get out of it the same way.
      chairEntry: null,
      // Set when mailbox collection retitles the work in flight.
      jobAlias: null,
      // The jobs this person has open, by the session each one arrived in. One on
      // arrival; more when the same actor's next session turns up (see above). The
      // character leaves when the last of them ends, not when the first does.
      jobs: new Map([[id, { id, title: null, status: 'idle' }]]),
      // How this person is recognised across sessions, so `_remove` can stop
      // advertising them as somebody a later session can join.
      actorKey,
      // Whether the work in hand came as a letter or a package, so it goes back out
      // the way it came in. Null when they are carrying nothing.
      arrivedBy: null,
      // Set while somebody is being driven by hand from the detail panel, and null
      // the rest of the time — which is every agent in a real office. See `pilot`.
      pilot: null,
      // Still on their way in, and not to be interrupted until they are through the
      // door. See `_begin`.
      arriving: true,
      // ...and the other end of it: told to go home and walking out. See `_leave`.
      leaving: false,
      // When they were told, and whether the room has given up on the walk and
      // beamed them up instead. See `LEAVE_GRACE` and `_beamOut`.
      leaveAt: 0,
      beaming: false,
    };
    controller.onIdle = () => this._idle(rec);
    this.agents.set(id, rec);
    this.jobOwner.set(id, id);
    if (actorKey) this.byActor.set(actorKey, id);
    this._peopleCache = null;

    // A desk of their own, booked on the way in and held until they go home. Not
    // deferred to the first job: a desk claimed per job is a desk given back
    // between jobs, and an agent who hands theirs in every time they walk to the
    // mailbox comes back to whichever one happens to be free. That read as people
    // shuffling round the room, and piled everyone onto the low-numbered desks.
    this._claimDesk(rec);

    // Walk in, hang up a coat. With a lift, the agent rides up inside the car and
    // only steps out once it has actually arrived and the doors have opened; up a
    // flight of stairs they climb it, which is how everything gets into that
    // building — the courier included (see scene/courier.js).
    const stairs = this.props.stairs;
    const lift = this.props.elevator;
    if (lift) {
      // Hidden until the car arrives: the agent's spawn point is inside the shaft,
      // so showing them before the car gets there would leave them hanging in mid
      // air. The doors part and they are simply there, as if they rode up.
      agent.root.visible = false;
    }
    this._begin(rec, [
      status('walking'),
      ...entranceSteps('in', [
        ...(lift ? [
          act(() => this.props.elevator.call()),
          waitUntil(() => this.props.elevator.ready),
          act(() => { agent.root.visible = true; }),
        ] : []),
        ...(stairs ? [follow(stairs.route)] : []),
      ]),
      // Step in to a place of their own. A lift can put several people on the mat
      // at once, and one shared point just inside the door meant they arrived on
      // top of each other and then had to untangle themselves.
      walk(() => this.spots.claim(DOORWAY, rec.agent)),
      act(() => {
        rec.coatHook = this.props.coatStand?.addCoat(agent.color) ?? null;
        rec.arriving = false;
      }),
      status('idle'),
    ]);

    this._emitChange();
  }

  // --- The post -------------------------------------------------------------
  //
  // The ownership rules live in `post.js`; this is only the walking about. See
  // that file for why an envelope is addressed at posting time rather than at
  // collection time.

  /** Send an envelope, addressed or not. */
  _post(ev) {
    // Who it is *for*, and which of their jobs it is *the work for* — two different
    // things once a person could hold two jobs, and conflating them threw the second
    // job's post away.
    //
    // A feed addresses a prompt to the session that typed it, which is right: a prompt
    // in one terminal cannot be picked up by anybody else. But a session is no longer
    // always a person of its own — an actor already in the room takes a new session on
    // as another job of theirs — so `forId` off the wire may be a session that is not
    // in `this.agents` at all. It is in `jobOwner`, which is what resolves it here.
    //
    // Unresolved, the guard below dropped the envelope outright: the second job of a
    // pair was posted, discarded, and then sat idle for ever with nothing to do and no
    // title, while the roster cheerfully showed it as a job in hand.
    const jobId = ev.forId ?? null;
    const forId = jobId ? (this.jobOwner.get(jobId) ?? jobId) : null;

    // Addressed to someone who is not in the room: there is nobody to open it.
    if (forId && !this.agents.has(forId)) return;

    const rec = forId ? this.agents.get(forId) : null;
    this.post.post(forId);

    // How the work travels is settled here — before anything leaves — and carried on
    // the payload the whole way, so that what arrived by air is delivered by air. A
    // source may say outright, which is what the pilot buttons do to show each channel
    // on demand; otherwise it is a toss. It says nothing about the work either way.
    //
    // Only the channels this room can actually receive, which since the printer earned a
    // job means the ones with somewhere to land as well as the ones switched on. A room
    // with no way in at all — its only intake being the inbox stack — posts nothing and
    // agents work off the pile, which is what happened before anything was posted anyway.
    const ways = enabledArrivals(ARRIVALS);
    if (!ways.length) return;
    // A source may name the channel outright, which is what the pilot buttons do to put
    // each one on screen on demand — but only if this room can actually receive it. The
    // request used to be honoured unconditionally, which skipped the check entirely: in
    // a room with no post box, "Job by air" and "Job by courier" both posted work with
    // nowhere to land and the scenery then read `.x` off a station that was not there.
    //
    // Refused rather than dropped: the job still arrives, by whatever this room *can*
    // receive. A button that quietly did nothing would be worse than one that shows you
    // the only channel there is.
    // A named bird names the channel too: a feed asking for the owl and getting
    // the courier would be a coin toss outranking an explicit request.
    const asked = ev.arrival && ways.includes(ev.arrival) ? ev.arrival
      : (ev.vehicle === 'bird' && ways.includes('letter') ? 'letter' : null);
    const arrival = asked ?? arrivalFor(Math.random, ways);
    // Where it lands, drawn once and stamped onto the payload so the scenery aims at the
    // same place rather than drawing again. Per *arrival*, because the destinations are
    // not interchangeable: a plane dives into a box and a fax comes out of a machine.
    const box = postBoxFor(Math.random, arrival)?.id ?? null;
    // The checklist rides along unopened, the same way the title does: what is in
    // the envelope is nobody's business until somebody takes it out of the box.
    const payload = {
      job: ev.job, forId, jobId, arrival, box, plan: ev.plan ?? null, color: rec?.agent.color,
    };

    // A letter comes in by air through the window; a parcel is brought to the door by
    // a courier. Both channels answer `launch` the same way, so the choice is the only
    // thing that differs — and the choice is arbitrary, which is the point.
    // A letter comes in by air through the window; a parcel is brought to the door by a
    // courier; a fax simply appears, which is why it has no channel — there is nothing
    // to watch travel, and the beat before it lands is the machine's own chunter.
    // A letter's vehicle is a second toss of the same meaningless coin: two
    // letters in three by paper plane, the third by bird (`BIRD_SHARE` in
    // scene/birds.js). A feed may name it — that is what the pilot's bird button
    // does — but nothing about the work ever decides it, for exactly the reasons
    // the arrival itself is arbitrary. Gated on the room's own switch,
    // like the courier: with the birds off, even a feed asking for one gets the
    // plane — the switch is a fact about the office, and a request cannot argue
    // with the room.
    const byBird = arrival === 'letter'
      && CHANNELS.birds
      && (ev.vehicle === 'bird'
        || (ev.vehicle == null && this.props.birds && Math.random() < BIRD_SHARE));
    const channel = arrival === 'fax'
      ? null
      : arrival === 'package' ? this.props.deliveries
        : byBird ? (this.props.birds ?? this.props.mail)
          : this.props.mail;

    // A fax rings before it prints. The handset shakes on the machine's own screen for
    // `RING_SECONDS` and the envelope lands as it stops — which is this channel's whole
    // journey, and the reason it needs one: everything else arrives by flying in or
    // being thrown at the door, and a page that simply materialised in a tray was an
    // arrival with nothing to watch.
    //
    // Held in a list rather than on a `setTimeout` so it runs on the room's own clock:
    // a scrubbed or paused scene should not have post landing behind its back, and
    // `update` is where every other beat of this room is counted.
    if (arrival === 'fax') {
      this._propAt({ id: box })?.ring?.(RING_SECONDS);
      this.ringing.push({ left: RING_SECONDS, payload });
      return;
    }

    // No scenery for this channel means no journey to wait for, so it is simply
    // already here — the office still works headless.
    if (!channel) return this._mailArrived(payload);

    // The queue is full and this one will never set off, so un-expect it rather
    // than leaving the recipient waiting at an empty box.
    if (channel.launch(payload) === false) this.post.unpost(forId);
  }

  // A letter has just come down in the slot, or a parcel on the pile.
  _mailArrived(payload) {
    const incomingJob = payload?.job ?? 'New job';
    const forId = payload?.forId ?? null;
    // Which job of theirs, carried the whole way so opening the envelope can say what
    // *that* job turned out to be rather than only what its owner is up to.
    const jobId = payload?.jobId ?? null;
    const arrival = payload?.arrival ?? null;
    const box = payload?.box ?? null;
    const plan = payload?.plan ?? null;
    const rec = forId ? this.agents.get(forId) : null;
    const job = rec?.jobAlias?.from === incomingJob
      ? rec.jobAlias.to
      : incomingJob;

    const delivered = this.post.land({ job, forId, jobId, arrival, plan, box }, (id) => this.agents.has(id));
    // A fax arrives *out of* something, so the something runs — the page comes out as the
    // ringing stops. Nothing else does this, because nothing else arrives from inside a
    // prop: a plane is a plane all the way to the slot, and the courier is his own
    // animation.
    if (delivered && arrival === 'fax' && box) this._propAt({ id: box })?.print?.();
    // Binned in transit, because the recipient left while it was on its way. There
    // is nothing to undo on the mailbox: what it shows is read back off the post
    // model every frame, so dropping it here is the whole of it.
    if (!delivered) return;

    this._emitFeed({
      kind: 'delivery',
      job,
      arrival: arrival ?? 'letter',
      for: rec?.agent.name ?? null,
      forColor: rec?.agent.color ?? null,
    });
  }

  /** Open the envelope: the prompt inside is what the work turns out to be. */
  _collectMail(rec, box = undefined) {
    rec.onMailRun = false;

    // Out of the box they are standing at, when they walked to one: an agent can only
    // take what is in front of them, and a room with two boxes would otherwise let
    // somebody reach across it. Unscoped for the headless case, where there is no walk.
    const item = this.post.take(rec.agent.id, box);
    // Nothing there after all — someone took the unaddressed envelope, or a plane
    // of their own is never coming. Stop expecting it before carrying on to the
    // desk: `hasOwn` is what sends an agent to the box, so an expectation left
    // standing here would send them straight back on the next frame, and the frame
    // after that, for as long as they stayed in the room.
    //
    // The request itself is lost at this point, and says so nowhere in the UI. See
    // §8.3 of docs/developer/job-delivery.md — binned post ought to reach the job log.
    if (!item) {
      this.post.abandon(rec.agent.id);
      rec.hasMaterial = true;
      // Empty-handed, so put nothing in their hands. The carryable used to be added
      // to the action list before anyone knew whether there would be anything to
      // collect, which had the loser of a race for one unaddressed envelope walk
      // back to their desk cradling a parcel they never picked up.
      rec.agent.setCarrying(null);
      return;
    }

    // Retitle rather than begin where possible: the agent was already logged as
    // starting work, and this request is what that work turned out to be. With no
    // job open — a first prompt, or one collected after a delivery — it opens a
    // new entry instead, so the log never loses a request.
    const original = rec.agent.currentJobLabel();
    if (rec.agent.renameOpenJob(item.job)) {
      rec.jobAlias = { from: original, to: item.job };
    } else {
      rec.agent.job = item.job;
      rec.agent.beginJob(item.job);
      rec.jobAlias = null;
    }

    // And the *job row* this envelope belonged to, which is the panel's half of it.
    //
    // The character's own headline is `agent.job` above — one body, one thing at a time
    // — and for somebody holding two sessions that can only ever name one of them. The
    // title travels inside the envelope on purpose (the office should not know the
    // heading before anybody has opened the thing), so this is the moment it is read,
    // and it is read onto the job it was addressed to rather than onto whichever of
    // their jobs happens to be newest.
    //
    // Without this the multi-job rows had a verb and no name on any harness but the
    // test feed: `_noteJob` is reached from `status`, `job` and `retitle`, and the AOP
    // reducer emits `mail` for a prompt and never `job`. Two lines reading "Writing"
    // and "Idle" for ever, which is a roster that says a person is busy and declines
    // to say with what.
    if (item.jobId) this._noteJob(rec, item.jobId, { title: item.job, status: 'working' });

    // Whatever checklist came with the request starts here, unticked — this is the
    // moment the agent read it. Nothing in hand yet: the first part is announced by a
    // `step.start` of its own, and guessing one would be the office inventing work.
    if (item.plan) rec.agent.setStep(null, item.plan);

    rec.hasMaterial = true;
    // Carry what was actually in the box, and remember it: how it arrived has to
    // survive the whole round trip, so work that came as a letter is delivered as a
    // letter and binned as one. Cosmetic, and consistent.
    rec.arrivedBy = item.arrival ?? 'letter';
    rec.agent.setCarrying(rec.arrivedBy);
    this._emitFeed({
      kind: 'collected', job: item.job, arrival: rec.arrivedBy, by: rec.agent.name,
    });
    this._emitChange();
  }

  /**
   * A status from the feed, turned into somewhere to be.
   *
   * Spelled out one status at a time rather than as "these three, and everything
   * else wanders": `delivering` used to fall off the end of that list — the AOP
   * adapter emits it for a push or a commit (see AopSource._toolStart) — so an
   * agent told they were delivering went for an aimless walk labelled idle, and
   * the violet ring the palette defines for it was never once seen. Anything
   * genuinely unrecognised still wanders, which is the right shrug for a word we
   * do not know, but it says so first.
   */
  _status(rec, next) {
    switch (next) {
      case 'working': return this._work(rec);
      case 'waiting': return this._wait(rec);
      case 'error': return this._discard(rec);
      case 'delivering': return this._postRun(rec);
      case 'idle': return this._wander(rec);
      default:
        console.warn('Unknown agent status', next);
        return this._wander(rec);
    }
  }

  // --- Behaviours ----------------------------------------------------------

  // Collect job material, then sit at a desk and work.
  _work(rec) {
    // Theirs since they walked in. The retry is for the room that had no desk to
    // give them at the door: this is the moment it matters, so try again now.
    const desk = rec.desk ?? this._claimDesk(rec);
    if (!desk) return this._wait(rec);   // no free desk: hover until one frees up

    // Already on the way to the box for this request: let the trip finish. The
    // feed re-announces work often (every prompt, and again after a bookshelf
    // trip), and restarting the walk each time would leave an agent shuffling on
    // the spot and never arriving.
    if (rec.onMailRun) return;

    this._resetDeskTimer(rec);

    const actions = [];
    let mailRun = false;
    const ownPost = this.post.hasOwn(rec.agent.id);

    // Work has to be fetched before it can be done. Post addressed to this agent
    // is always collected in person, every request, even mid-conversation —
    // otherwise they take whatever is going: airmail first, since that is the
    // freshest request, and the inbox stack only if the box is empty.
    if (ownPost || !rec.hasMaterial) {
      // `canCollect`, not `size`: a box holding nothing but somebody else's
      // envelope has nothing in it for this agent, and sending them over to find
      // that out had them stand at a box they were never allowed to open.
      const fromMailbox = ownPost || this.post.canCollect(rec.agent.id);
      // Somewhere to collect from, and which supply is wanted. Asked by job rather
      // than by name: a room may have two places work arrives, and the one
      // holding *post* is not necessarily called `mailbox`.
      // Anything waiting in a box wins, wherever that box is and whatever it looks
      // like: a mailbox with an envelope in it and a printer with a sheet in its tray
      // are the same question now, because a fax *is* post — one model, per box, since
      // the print tray was folded into it. `_nearestPostBox` walks them to the one
      // actually holding something for them, which was already its job.
      //
      // Otherwise the inbox stack, which is the bottomless fallback. `serves` is a
      // preference and not a filter, so in a room with no stack this lands on whatever
      // else takes work in — and `_collectFrom` copes with that having nothing to give.
      const station = fromMailbox
        ? this._nearestPostBox(rec)
        : stationForRole('intake', { from: rec.agent.position, serves: 'stock' });

      actions.push(
        ...this._release(rec),
        status('walking'),
        walk(() => this.spots.claim(station, rec.agent)),
        lookAt(station),
      );

      if (fromMailbox) {
        actions.push(
          // Their own plane may still be in the air. Waiting at the box is the
          // honest move: the request exists, so the agent stands there until it
          // lands rather than pretending it already had.
          //
          // Only for post of their own, though. An agent collecting unaddressed
          // mail came over for an envelope that was already in the box, so there
          // is nothing to wait for — if someone beat them to it, the predicate is
          // checked once and they carry on rather than loitering for the full
          // twenty seconds over a box that is empty.
          waitUntil(() => this.post.canCollect(rec.agent.id, station?.id ?? null), ownPost ? MAIL_WAIT : 0),
          wait(0.35),
          // A page that missed the tray is picked up on the way past, before whatever is
          // in the tray: it is between them and the machine, and walking over it to take
          // a clean sheet off the top is not what anybody does. Only a printer has one,
          // and asking the prop rather than the kind means nothing here has to know
          // which props can overshoot.
          act(() => {
            const prop = this._propAt(station);
            if (prop?.overshot) prop.retrieve?.();
          }),
          act(() => this._collectMail(rec, station?.id ?? null)),
        );
      } else {
        // What they can actually pick up here, decided by the prop standing at the
        // station rather than by the supply that was asked for.
        //
        // This branch used to assume an inbox, and `_propAt(station)?.takePackage()`
        // read as safe because of the optional chain — which guards a *missing prop*
        // and not a missing *method*. So any intake station without `takePackage`
        // crashed the errand outright: `TypeError: takePackage is not a function`.
        //
        // That was already reachable before the printer had a job. `serves` is a
        // preference and not a filter, so in a room whose inbox has been deleted a
        // request for `stock` falls back to the post — and the mailbox has no
        // `takePackage` either. Delete the inbox on `main` and the first agent to want
        // work throws. Making the inbox removable left this path never learning to
        // cope; the printer becoming an intake station is only a second way in to it.
        //
        // `_research` had exactly this shape and says so in as many words: branch on
        // what the furniture *is* first and on what was wanted second, because that is
        // the only order which cannot ask a prop for something it does not have.
        actions.push(...this._collectFrom(rec, station));
      }

      mailRun = fromMailbox;
    }

    actions.push(
      status('walking'),
      ...takeUpPostAtDesk(rec, desk, this.nav),
      carry(null),
      act(() => desk.setWorking(true)),
      status('working'),
      wait(HOLD, { typing: true }),
    );

    this._begin(rec, actions, mailRun);
    this._emitChange();
  }

  // Waiting on input: stay at the desk if seated, but dim the screens.
  _wait(rec) {
    if (rec.agent.seated && rec.desk) rec.desk.setWorking(false);
    this._begin(rec, [status('waiting'), wait(HOLD)]);
    this._emitChange();
  }

  /**
   * Look something up, then come back to the desk that is waiting for them.
   *
   * A question is answered in one of two places, and the room shows which. What
   * the company knows is on the shelf, so a graph look-up takes a book down and
   * reads it. The web is not in the building, so it is the globe on top of the
   * shelf that answers for it — and the globe turning is the only way to tell,
   * from across the room, that somebody has gone outside for an answer.
   *
   * @param {'graph'|'web'} [scope] where the answer is being looked for
   */
  _research(rec, topic, scope = 'graph') {
    // Somewhere to look something up, preferring the sort that suits the question:
    // the shelf `serves: ['graph']` and the telescope `serves: ['web']`, and
    // `stationForRole` treats that as a preference rather than a filter — so a room
    // with only one of them still answers both kinds of question, at whichever it has.
    //
    // This replaced `_nearestShelf`, which could only ever find a bookshelf. Asking for
    // the *job* is what lets a telescope be an answer to it without a line here naming
    // one, which is the whole of the by-job model put to work.
    const station = stationForRole('research', { from: rec.agent.position, serves: scope });
    // Nowhere to look anything up. Cannot happen while the room keeps its last research
    // station, which `canRemoveObject()` sees to — but if it ever did, they look it up
    // where they sit rather than standing still waiting for one.
    if (!station) return this._work(rec);
    const web = scope === 'web';
    if (topic) rec.agent.job = web ? `Searching the web: ${topic}` : `Looking up: ${topic}`;

    const actions = [
      ...this._release(rec),
      status('walking'),
      walk(() => this.spots.claim(station, rec.agent)),
      lookAt(station),
      wait(0.7),
    ];

    // What happens next is decided by the furniture, not by the question. A telescope
    // has no books on it whichever scope sent them there, and a shelf has no eyepiece:
    // branching on the kind first and the scope second is the only order that cannot
    // ask a prop for something it does not have.
    if (station.kind === 'telescope') {
      const scope3 = this._propAt(station);
      actions.push(
        act(() => scope3?.scan(RESEARCH_HOLD)),
        status('researching'),
        // The stoop and the sweep run for the same beat, so the tube stops moving as
        // they straighten up rather than sweeping on at an empty eyepiece.
        wait(RESEARCH_HOLD, { stooping: true }),
      );
    } else if (web) {
      actions.push(
        act(() => this._globeAt(station)?.spin(RESEARCH_SPIN)),
        status('researching'),
        wait(RESEARCH_HOLD),
      );
    } else {
      actions.push(
        act(() => {
          // The shelf they took it from is remembered with the book, because it is not
          // necessarily the only one: a book has to go back on the case it came off.
          rec.shelf = this._propAt(station);
          rec.book = rec.shelf?.takeBook() ?? null;
        }),
        carry('book', { color: 0x4f7a8a }),
        status('researching'),
        wait(RESEARCH_HOLD, { reading: true }),
        act(() => this._returnBook(rec)),
        carry(null),
      );
    }
    actions.push(wait(0.4));

    // Head back to their desk and resume. The only agent with nowhere to go back
    // to is one the room never had a desk for.
    if (rec.desk) {
      const desk = rec.desk;
      actions.push(
        status('walking'),
        ...takeUpPostAtDesk(rec, desk, this.nav),
        act(() => desk.setWorking(true)),
        status('working'),
        wait(HOLD, { typing: true }),
      );
    }

    this._begin(rec, actions);
    this._emitChange();
  }

  // Finished: carry the work to whichever way out is nearest and send it.
  _deliver(rec, _summary) {
    const { agent } = rec;
    // The nearest way out, which is not always the post any more: the printer
    // dispatches too, as a fax. Nearest rather than a draw — unlike an *arrival*, which
    // is random because nothing about the work decides how it turns up — because a
    // person carrying a finished thing walks to the nearer of the two, and that is a
    // fact about where they sit rather than a coin toss.
    const mb = stationForRole('dispatch', { from: rec.agent.position });
    const faxing = mb?.kind === 'printer';

    // `summary` is what the agent said when it finished, not what it was asked to
    // do. It belongs in the event log and delivery record; replacing `agent.job`
    // here made an idle roster read like a transcript ("Understood. The server is
    // running…") instead of preserving the assignment somebody was watching.

    this._begin(rec, [
      ...this._release(rec),
      // Out the way it came in: work that arrived as a letter leaves as one.
      carry(() => rec.arrivedBy ?? 'package'),
      status('delivering'),
      walk(() => this.spots.claim(mb, rec.agent)),
      lookAt(mb),
      wait(0.7),
      // Dialling the number, which is what makes an outgoing fax read as *outgoing*.
      // One hand up at the touchscreen jabbing at it, and only at a printer: there is
      // nothing to dial on a mailbox, and a hand raised at one would be a mime.
      ...(faxing ? [wait(FAX_DIAL, { dialling: true })] : []),
      act(() => {
        if (faxing) this._fax(rec, mb);
        else this._propAt(mb)?.deliver();
        rec.hasMaterial = false;
        // Log completion at the moment it's actually sent, not when the walk to the
        // way out began.
        agent.finishJob('done');
        rec.jobAlias = null;
        rec.arrivedBy = null;
        this._emitChange();
      }),
      carry(null),
      // A fax is not instant. The sheet goes into the feeder and the machine takes a
      // beat over it, which is the one place this errand differs from posting: an
      // envelope is gone the moment it is through the slot.
      ...(faxing ? [wait(FAX_HOLD)] : []),
      wait(0.4),
      status('idle'),
    ]);
    this._emitChange();
  }

  /**
   * Every prop method in this file is called with `?.()` and not `?.`, and this note is
   * the reason: an optional *chain* guards a prop that is absent, and an optional *call*
   * guards a method that is. They are different failures and only the second one is the
   * common one — a prop is nearly always there and is nearly always a stub or an older
   * handle missing the method just added. This has bitten three times over the printer
   * alone
   * (`takePackage`, then `ring`), each time reading as safe because there was a `?` in
   * the line. If you add a call to a prop here, write `prop?.thing?.()`.
   *
   * Pick up material at a station, whatever that station happens to be.
   *
   * Returns the actions for the collection, or an empty list when there is genuinely
   * nothing here to take — an empty printer tray, or a post box being used as the stock
   * fallback in a room with no inbox. Nothing to collect is a real answer and not an
   * error: they walk over, find it bare, and go to work without visible material, which
   * is what the room already does when it is running headless with no scenery at all.
   *
   * @returns {Array} steps to append, possibly none
   */
  _collectFrom(rec, station) {
    const prop = this._propAt(station);

    // A stack of boxes to take from. Asked of the prop rather than of the kind, so a
    // new kind of stock pile needs no line here — and so a prop that cannot hand
    // anything over is a quiet no rather than a crash.
    if (typeof prop?.takePackage === 'function') {
      return [
        wait(0.6),
        act(() => {
          prop.takePackage();
          rec.hasMaterial = true;
          // The inbox stack is cardboard boxes, so material taken off it is a package
          // by definition — there is no envelope to be had here.
          rec.arrivedBy = 'package';
        }),
        carry('package'),
      ];
    }

    return [];
  }

  /**
   * Send finished work out as a fax, and let the machine keep its own copy.
   *
   * The copy is the whole reason the printer is an `intake` station as well as a
   * `dispatch` one: the work leaves the building, and the sheet it printed on the way
   * out waits in the tray as material for whoever needs some next. That is what makes
   * the tray fill because the office has been *working*, rather than because something
   * arrived — which is the distinction between a printout and the post, and the reason
   * The printer work asked whether a print was an arrival or a product. It is both, in
   * that
   * order, and this function is where the order is written down.
   *
   * The fax goes whether or not the copy prints. A full tray refuses the sheet (see
   * `TRAY_LIMIT`) and the work still leaves, because a machine out of tray space is not
   * a reason for a finished job to stay finished-but-not-sent.
   */
  _fax(rec, station) {
    const prop = this._propAt(station);
    prop?.fax?.();

    // The copy goes into the *post* model, in this machine's own box, unaddressed.
    //
    // It had its own model for a day — a `PrintTray` keyed by station id — and the
    // question "shouldn't a room with only a printer work?" is what showed that to be
    // wrong twice over. A separate queue could not bootstrap, because the only thing
    // that filled it was the office's own output; and it could not hold anything
    // *addressed*, because it was a count, so a job faxed in for a particular agent had
    // nowhere to be. `Post` already solved both — it has held per-box queues of
    // addressed and unaddressed work ever since — so the printer is simply another
    // box, and the second model is gone.
    //
    // Unaddressed on purpose: the copy is for whoever needs work next, which is exactly
    // what an unaddressed envelope means and exactly what the inbox pile is for.
    //
    // Nothing is emitted to the delivery panel, and that is deliberate rather than an
    // omission: posting to the mailbox emits nothing either. That panel's three entry
    // kinds are read by `renderFeed` in ui/overlay.js, and an unrecognised one falls
    // through to the "collected" branch — it would render a fax as "somebody took one".
    const label = rec.agent.currentJobLabel() ?? rec.agent.job;
    this.post.land(
      { job: label ? `Copy: ${label}` : 'A printed copy', forId: null, arrival: 'fax', box: station.id },
      (id) => this.agents.has(id),
    );
    prop?.print?.();
  }

  /**
   * A trip to the mailbox that is not the end of anything.
   *
   * `dispatch` closes a job: the work is finished, it goes in the box, and the
   * log gets its "done". A `delivering` *status* is a smaller thing — a push, a
   * commit, something sent out mid-turn — so this walks the same walk and comes
   * back to the desk with the job still open. Getting these two confused would
   * mark work finished every time an agent ran `git push`.
   */
  _postRun(rec) {
    const mb = stationForRole('dispatch', { from: rec.agent.position });
    const desk = rec.desk;

    const actions = [
      carry(() => rec.arrivedBy ?? 'package'),
      status('delivering'),
      walk(() => this.spots.claim(mb, rec.agent)),
      lookAt(mb),
      wait(0.7),
      act(() => this._propAt(mb)?.deliver()),
      carry(null),
      wait(0.3),
    ];

    // Back to their desk — the turn has not ended, so this is an errand, not a
    // finish. With no desk to return to at all they simply stand down.
    if (desk) {
      actions.push(
        status('walking'),
        ...takeUpPostAtDesk(rec, desk, this.nav),
        act(() => desk.setWorking(true)),
        status('working'),
        wait(HOLD, { typing: true }),
      );
    } else {
      actions.push(status('idle'));
    }

    // Seated: stand up first. The desk stays booked across the errand, as it does
    // across everything else.
    this._begin(rec, [...this._release(rec), ...actions]);
    this._emitChange();
  }

  // Errored: crumple it up and bin it, then go idle.
  _discard(rec) {
    const { agent } = rec;
    const bin = stationForRole('discard', { from: rec.agent.position });
    // No bin in the room at all. `discard` is not a job the office is required to be
    // able to do (see `JOB_ROLES`), so the work is crumpled up and closed where they
    // stand rather than walking them to a prop that is not there — which is what the
    // pilot's own Close button has always done.
    if (!bin) return this._discardInPlace(rec);

    this._begin(rec, [
      ...this._release(rec),
      status('error'),
      wait(1.2),
      carry(() => rec.arrivedBy ?? 'package'),
      walk(() => this.spots.claim(bin, rec.agent)),
      lookAt(bin),
      wait(0.5),
      act(() => {
        this.props.bin?.discard();
        rec.hasMaterial = false;
        // Report the removal as the work actually hits the bin.
        const label = agent.currentJobLabel();
        agent.finishJob('error');
        rec.jobAlias = null;
        rec.arrivedBy = null;
        this._emitFeed({ kind: 'removal', job: label ?? agent.job, by: agent.name });
        this._emitChange();
      }),
      carry(null),
      wait(0.4),
      status('idle'),
    ]);
    this._emitChange();
  }

  /**
   * Throw the work away without a bin to throw it into.
   *
   * A room may have no bin: `discard` is deliberately not one of `JOB_ROLES`, on the
   * grounds that an office with nowhere to bin things is a poorer office and a working
   * one. So the beat still happens — the pause where you realise it has gone wrong, and
   * the work closing as an error — it simply happens at the desk. No walk, no crumple,
   * and the same `removal` entry in the log, because what the panel reports is that the
   * work was thrown away and not which prop received it.
   */
  _discardInPlace(rec) {
    const { agent } = rec;
    this._begin(rec, [
      status('error'),
      wait(1.2),
      act(() => {
        rec.hasMaterial = false;
        const label = agent.currentJobLabel();
        agent.finishJob('error');
        rec.jobAlias = null;
        rec.arrivedBy = null;
        this._emitFeed({ kind: 'removal', job: label ?? agent.job, by: agent.name });
        this._emitChange();
      }),
      wait(0.4),
      status('idle'),
    ]);
    this._emitChange();
  }

  // Idle activities: a drink, a sit on the couch, or a celebration.
  _activity(rec, activity) {
    if (activity === 'couch') return this._rest(rec);
    if (activity === 'dance') return this._celebrate(rec);
    return this._drinkBreak(rec);
  }

  /**
   * The happy dance: arms up, off the floor, and nowhere to go.
   *
   * The pose has been in `Agent` since it was written and nothing ever asked for it —
   * `test/agent-dance.test.js` opened by saying so. It was reachable only by writing a
   * `wait` by hand, which meant the one movement the room could do that nobody had ever
   * seen. So it gets an activity and a button.
   *
   * Done on their feet and on the spot. `_release` gets them out of whatever they are
   * in first, because the seated pose owns the body while it is on and a dance
   * underneath it does nothing — which the tests already pinned. Nobody walks anywhere:
   * a celebration happens where the news arrives, and sending them across the room to
   * do it would make it an errand instead.
   *
   * Nothing is carried, nothing is delivered and nothing is logged. It is not work, and
   * the panel's record of jobs should not gain an entry for a mood.
   */
  _celebrate(rec) {
    this._begin(rec, [
      ...this._release(rec),
      status('idle'),
      wait(0.3),
      status('dancing'),
      wait(DANCE_SECONDS, { dancing: true }),
      status('idle'),
      // A beat standing still afterwards, so it ends rather than simply stopping.
      wait(0.5),
    ]);
    this._emitChange();
  }

  /**
   * Decide where a drink gets drunk, and book whatever that needs.
   *
   * Standing at the machine, sunk into the couch, or back at their own desk, in
   * even thirds — none of the three is the "real" answer, and the mix is what
   * stops break time looking scripted. Both sit-down options can be unavailable
   * (a full couch, or no desk of their own in a room with more people than desks),
   * in which case they drink where they stand.
   *
   * An agent already holding a couch seat keeps it rather than booking a second.
   * "Their own desk" is exactly that, and never a spare one going free: a drink is
   * no reason to move in somewhere else.
   */
  _drinkSpot(rec) {
    const roll = Math.random();

    if (roll < 1 / 3) {
      // A seat already held keeps its own couch with it; otherwise the nearest couch
      // with a cushion going. Either way both are needed, since the walk over is to
      // this couch's standing room.
      const chosen = (rec.couchSeat && rec.couch)
        ? { couch: rec.couch, seat: rec.couchSeat }
        : this._freeSeat(rec);
      if (chosen) {
        chosen.seat.occupiedBy = rec.agent.id;
        rec.couchSeat = chosen.seat;
        rec.couch = chosen.couch;
        return { where: 'couch', ...chosen };
      }
      return { where: 'station' };
    }

    if (roll < 2 / 3 && rec.desk) return { where: 'desk', desk: rec.desk };

    return { where: 'station' };
  }

  /**
   * Which post box to walk to for work: the nearest one holding something openable.
   *
   * "The nearest box" is not good enough once a room has two. An agent standing beside
   * an empty box while their envelope sits in the one across the room is the whole of
   * the bug a second box could otherwise introduce, so the box is chosen by *contents*
   * first and distance second.
   *
   * Falls back to the nearest post box when nothing is openable anywhere — which is
   * what somebody walking over to *wait* for a plane still in the air needs, since
   * there is nothing in any box yet to choose between.
   */
  _nearestPostBox(rec) {
    const holding = new Set(this.post.boxesWith(rec.agent.id));
    // Every station that can hold post, which now includes a printer: a fax in
    // its tray is an envelope in a box, so a collector has to be able to be sent there.
    // This filtered on `serves: 'post'` and would have walked straight past the machine
    // — the sheet would have sat in the tray for ever while agents queued at a mailbox.
    const boxes = stationsForRole('intake')
      .filter((s) => {
        const serves = STATION_KINDS[s.kind]?.serves ?? [];
        return serves.includes('post') || serves.includes('print');
      });
    const candidates = boxes.filter((s) => holding.has(s.id));
    const pool = candidates.length ? candidates : boxes;
    if (!pool.length) return stationForRole('intake', { from: rec.agent.position });

    const at = rec.agent.position;
    let best = pool[0];
    let bestDist = Infinity;
    for (const s of pool) {
      const p = s.approach ?? s;
      const d = (p.x - at.x) ** 2 + (p.z - at.z) ** 2;
      if (d >= bestDist) continue;
      bestDist = d;
      best = s;
    }
    return best;
  }

  /**
   * The built prop standing at this station, or null if the room has not built one.
   *
   * `props.<kind>` holds whichever instance was built last, which was harmless while
   * every kind was a singleton and is a bug the moment one is not: an agent who walked
   * to the second inbox would take a box off the first. So anything that *did the walk*
   * asks by the station it walked to, and `props.byStation` answers.
   *
   * Null is ordinary and not an error — a headless office builds no scenery at all, and
   * the behaviours all optional-chain through this for exactly that reason.
   */
  _propAt(station) {
    return station ? this.props.byStation?.[station.id] ?? null : null;
  }

  /**
   * Which machine this drink comes out of.
   *
   * A drink says what it *is* — water, tea, a flat white — and the room finds somewhere
   * that serves it: the cooler for water, the espresso machine for tea and coffee. It
   * used to say which station it came from, by name (`station: 'waterCooler'` in
   * drinks.js), which quietly made a room without that exact prop a room where nobody
   * could have a drink. Asking for the job with the drink as a preference means a room
   * with only a cooler still serves everybody — the tea drinkers get water and get on
   * with it, rather than standing at a machine that is not there.
   *
   * Null only if the room has nothing to drink at all, which `_drinkBreak` and
   * `_drinkRun` both have to cope with: `refresh` is deliberately not a job the office
   * is required to be able to do.
   */
  _drinkStation(rec, drink) {
    return stationForRole('refresh', { from: rec.agent.position, serves: drink?.kind });
  }

  /**
   * Go and have your drink, wherever yours comes from: the cooler for water and
   * sparkling water, the espresso machine for tea and coffee. The station is not
   * chosen at random and not chosen by the feed — it falls out of the preference
   * the agent walked in with. Where they then drink it is chosen at random.
   */
  _drinkBreak(rec) {
    const drink = rec.agent.drink;
    const station = this._drinkStation(rec, drink);
    // Nothing in the room serves anything. `refresh` is not one of `JOB_ROLES`, so this
    // is a room somebody has deliberately taken the machines out of — they take a break
    // without a cup rather than the office having no idle behaviour at all.
    if (!station) return this._wander(rec);
    const spot = this._drinkSpot(rec);

    // Whatever the destination, it starts the same way: walk over and get it.
    // Their desk is theirs whether or not the drink is going back to it; only the
    // couch seat has to be held across the walk, having just been booked.
    const actions = [
      ...this._release(rec, { keepCouch: spot.where === 'couch' }),
      status('walking'),
      walk(() => this.spots.claim(station, rec.agent)),
      lookAt(station),
      wait(0.8),
      carry('cup', { color: drink.color }),
    ];

    if (spot.where === 'couch') {
      actions.push(
        status('walking'),
        walk(spot.couch.approach),
        ...sitDownOn(spot.seat, COUCH_SEAT_HEIGHT),
        status('drinking'),
        wait(5.0, { drinking: true }),
        carry(null),
        ...standUpFrom(spot.seat),
        act(() => {
          spot.seat.occupiedBy = null;
          rec.couchSeat = null;
          rec.couch = null;
        }),
        status('idle'),
      );
    } else if (spot.where === 'desk') {
      const { desk } = spot;
      actions.push(
        status('walking'),
        ...takeUpPostAtDesk(rec, desk, this.nav),
        status('drinking'),
        wait(3.4, { drinking: true }),
        // Set it down rather than letting it vanish, and stay put afterwards:
        // getting up to wander the moment you've sat down with a coffee looks
        // daft. The next job is what moves them on, and it clears the mug.
        act(() => desk.setMug(true, drink.color)),
        carry(null),
        status('idle'),
        wait(HOLD),
      );
    } else {
      actions.push(
        status('drinking'),
        wait(2.6, { drinking: true }),
        carry(null),
        status('idle'),
      );
    }

    this._begin(rec, actions);
    this._emitChange();
  }

  /**
   * Mid-job drink run: fetch a drink without giving up the job.
   *
   * Deliberately does not go through _release(), which is what makes this read
   * the way it should — the desk stays claimed and the monitors stay lit, so what
   * you see is a glowing, empty workstation and its occupant over at the machine.
   * They come back, set the mug down and carry on with the same job.
   */
  _drinkRun(rec) {
    const { desk } = rec;
    const drink = rec.agent.drink;
    const station = this._drinkStation(rec, drink);
    // No machine to fetch from, so the mug stays where it is and they carry on working.
    // A desk drink is a garnish on a long stretch at a desk; skipping it costs nothing.
    if (!station) return undefined;

    this._begin(rec, [
      status('walking'),
      walk(() => this.spots.claim(station, rec.agent)),
      lookAt(station),
      wait(1.0),
      carry('cup', { color: drink.color }),
      status('walking'),
      ...takeUpPostAtDesk(rec, desk, this.nav),
      // Actually drink some of it before getting back to work — fetching a coffee
      // and setting it down untouched is a strange thing to watch. The sip is
      // 'drinking', so it doesn't count towards the next long-job roll.
      status('drinking'),
      wait(1.6, { drinking: true }),
      act(() => desk.setMug(true, drink.color)),
      carry(null),
      status('working'),
      wait(HOLD, { typing: true }),
    ]);
    this._emitChange();
  }

  _rest(rec) {
    // Nowhere to sit: every cushion in the room is taken, or there is no couch in it at
    // all. Either way they go for a drink instead, which is the same fallback a full
    // couch has always had — and is what makes an office with no couch merely an office
    // where nobody sits down, rather than one where resting breaks.
    const pick = this._freeSeat(rec);
    if (!pick) return this._drinkBreak(rec);
    const { couch, seat } = pick;

    seat.occupiedBy = rec.agent.id;
    rec.couchSeat = seat;
    rec.couch = couch;

    this._begin(rec, [
      ...this._release(rec, { keepCouch: true }),
      status('walking'),
      walk(couch.approach),
      ...sitDownOn(seat, COUCH_SEAT_HEIGHT),
      status('resting'),
      wait(6.0),
      ...standUpFrom(seat),
      act(() => { seat.occupiedBy = null; rec.couchSeat = null; rec.couch = null; }),
      status('idle'),
    ]);
    this._emitChange();
  }

  // Walk out through the door, then remove the agent.
  _leave(rec) {
    // Once is enough. A second instruction to go home — a duplicate `exit`, or a
    // source unticked while its people are already at the lift — would send someone
    // back to their chair to walk the whole way out again.
    if (rec.leaving) return;
    rec.leaving = true;
    // When they were told, so the room can tell how overdue they are. See
    // `LEAVE_GRACE` and `_beamOut`: from here on there is a deadline on getting
    // out, and it holds whether or not this walk ever runs a single frame.
    rec.leaveAt = this.now();
    // Nobody is held on their way out. Going home is the one errand with nothing to
    // come back to, so the hold would be ten seconds spent on a character who is
    // already gone — and the walk out must not be interrupted by the loop taking them
    // back (see `_letGo`).
    rec.pilot = null;
    this._begin(rec, [
      ...this._release(rec),
      status('walking'),
      // A place of their own on the way out too: home time can send several people
      // to the door at once, and they wait there for the lift.
      walk(() => this.spots.claim(DOORWAY, rec.agent)),
      act(() => {
        this.props.coatStand?.removeCoat(rec.coatHook);
        rec.coatHook = null;
      }),
      ...this._exitTransport(),
      act(() => this._remove(rec)),
    ]);
    this._emitChange();
  }

  _exitTransport() {
    return entranceSteps('out', [
      ...(this.props.elevator ? [
        // Summon the lift from the doorway and wait for it, rather than walking
        // into an empty shaft.
        act(() => this.props.elevator.call()),
        waitUntil(() => this.props.elevator.ready),
      ] : []),
      walk(vec(DOOR.outside)),
      // And back down the flight, if that is what they came up. They are already on
      // its top point, so the descent picks them up where the walk left them.
      ...(this.props.stairs ? [follow(this.props.stairs.descent)] : []),
    ]);
  }

  /**
   * A new shell has the same arranged floor. Preserve every interior action and
   * replan walks; only an entrance that no longer exists needs a handover.
   */
  redecorate(previous) {
    const changed = Boolean(previous.elevator) !== Boolean(this.props.elevator)
      || JSON.stringify(previous.stairs?.route) !== JSON.stringify(this.props.stairs?.route);
    if (changed) {
      for (const rec of this.agents.values()) {
        const { agent, controller } = rec;
        if (rec.arriving && controller.replaceEntrance('in', [])) {
          // Transfer the part of an arrival outside the replaced building to its
          // lobby. It is floor even when the new lift car is elsewhere; placing
          // them outside would leave them in an empty shaft or crossing shut doors.
          // The last pace, coat and queued work still run exactly once.
          const landing = this.spots.claim(DOORWAY, agent);
          agent.setPositionXZ(landing.x, landing.z);
          agent.setElevation(0);
          agent.root.visible = true;
        }
        if (rec.leaving) {
          const inTransport = controller.current?.entrance === 'out';
          if (controller.replaceEntrance('out', this._exitTransport()) && inTransport) {
            agent.setPositionXZ(DOOR.inside.x, DOOR.inside.z);
            agent.setElevation(0);
          }
        }
      }
    }
    this.nav.rebuild();
    for (const rec of this.agents.values()) rec.controller.replan();
  }

  /**
   * Empty the room of overdue departures while nothing is being drawn.
   *
   * Called from a timer rather than from a frame (see src/main.js), and it does
   * something only when the frames have stopped — which is the case `_beamOut`
   * cannot cover, because a beam is an animation and an animation needs frames.
   * A tab in the background is not being drawn, so the walk out cannot advance,
   * and every session the feed retires meanwhile is a character who joins a queue
   * for a door nobody can reach. Left alone for a night that is the room filling
   * up without limit.
   *
   * So the timer takes them out where they stand, with no ceremony — there is
   * nobody watching a room that is not being drawn, and the whole value of the
   * cone of light is that somebody sees it. What that buys is a window you can
   * leave open for a week and come back to an office the right size, rather than
   * to half a minute of blue cones.
   *
   * @returns {number} how many were shown the door, for a caller that wants to log it
   */
  tidy() {
    // Frames are being drawn: the room is being looked at, and anybody overdue is
    // `update`'s to deal with, properly, with an animation.
    if (this.now() - this._drawnAt < FRAME_STALL * 1000) return 0;

    const deadline = this.now() - LEAVE_GRACE * 1000;
    let gone = 0;
    for (const rec of [...this.agents.values()]) {
      // A beam that was in the air when the frames stopped will never finish, so
      // its subject goes with the rest: they are already halfway out of the room.
      if (!rec.beaming && !(rec.leaving && rec.leaveAt < deadline)) continue;
      this._remove(rec);
      gone += 1;
    }
    return gone;
  }

  /**
   * Stop waiting for a departure and take them out of the room.
   *
   * The walk out is the office at its best — a coat off the stand, a lift called,
   * a queue at the door — and this is what happens when it is the office at its
   * worst: a hundred people told to go home at once, or a walk that has not had a
   * frame to run in since the window went behind another one. Thirty seconds of
   * that (`LEAVE_GRACE`) and the room stops asking nicely.
   *
   * Everything else is unchanged: `_remove` is the same one the door uses, so the
   * desk, the coat, the couch seat and any post addressed to them are given back
   * exactly as they would have been, and the beam only decides *when*.
   *
   * Not every candidate goes at once — the cones are capped, and one refused here
   * is simply offered again on the next frame, which is what turns a mass
   * clear-out into a queue of them rather than a wall of blue.
   *
   * Also reached by hand, from the `beam` button in the agent detail panel: waiting
   * thirty seconds for a departure to get stuck is not a way to look at this.
   *
   * @returns {boolean} whether they are on their way. False means every cone was
   *   busy, or they were already in one.
   */
  _beamOut(rec) {
    // Every beam busy: leave them exactly as they are — still walking out, still
    // overdue — and `update` offers them again next frame. Asked before anything
    // is disturbed, because a refused candidate has to be able to carry on with
    // the walk they were already on.
    if (rec.beaming || this.beams.busy) return false;

    // Whatever walk they were on is over, and they are out of the crowd from this
    // instant: the cone holds them still while it lifts them, and a colleague
    // pushing past would slide them out of it.
    rec.controller.clear();
    rec.beaming = true;
    this._peopleCache = null;
    this.beams.beamUp(rec.agent, () => this._remove(rec));
    this._emitChange();
    return true;
  }

  _wander(rec) {
    this._begin(rec, [
      ...this._release(rec),
      status('idle'),
      walk(this.nav.randomInteriorPoint(), 'walking'),
      status('idle'),
    ]);
    this._emitChange();
  }

  // Called when an agent's queue empties: keep them believably occupied.
  _idle(rec) {
    // Being driven by hand, and the errand has run out of actions: stand still. This
    // is the hold, and pushing anything here would be the room deciding it had waited
    // long enough — which is the thing the buttons exist to stop. `_pilotTick` counts
    // the ten seconds and calls this again once they are let go.
    if (rec.pilot) return;

    const roll = Math.random();
    if (roll < 0.45) {
      rec.controller.push([
        wait(spread(1.0, 2.5)),
        walk(this.nav.randomInteriorPoint(), 'walking'),
        status('idle'),
      ]);
    } else if (roll < 0.7) {
      this._drinkBreak(rec);
    } else if (roll < 0.85) {
      this._rest(rec);
    } else {
      rec.controller.push([wait(spread(1.5, 3))]);
    }
  }

  // --- Helpers -------------------------------------------------------------

  /**
   * Start an action list, declaring whether it is a trip to the mailbox.
   *
   * Every behaviour starts here so that `onMailRun` has exactly one owner:
   * whoever started what the agent is doing now. That matters because the
   * controller executes roughly one action per frame, so for a frame or two after
   * a mail run begins the agent is still `idle` with post waiting — and anything
   * that cleared the flag from inside an action (as releasing state used to) let
   * `_checkPost` rebuild the walk from the top on the very next frame. The agent
   * restarted forever and never took a step.
   *
   * Somebody still on their way in is queued behind their arrival rather than having
   * it thrown away, because the arrival is the only thing that knows how to get into
   * this building. Work is announced within a second or two of a spawn, so the race
   * is the normal case, not an edge — and losing it strands them: hidden in the lift
   * shaft waiting for a car nobody is calling any more, or a storey down the stairs
   * with only the room's flat floor plan to walk on, striding home through the air.
   */
  _begin(rec, actions, mailRun = false) {
    rec.onMailRun = mailRun;
    if (rec.arriving) rec.controller.push(actions);
    else rec.controller.run(actions);
  }

  /**
   * Let go of whatever the agent is holding on to, ready for something else.
   *
   * Returns a list, because getting out of a seat takes more than standing up. A
   * couch seat is inside the couch, so anything that walks away from it walks through
   * the furniture; a desk chair is on open floor, but its occupant is inside the
   * chair, and walking off leaves the chair behind them and the desk in front. Either
   * way they get out of the seat first, so that every route onwards — a job, a
   * drink, going home — starts from somewhere a person could actually stand.
   *
   * Standing up is not moving out: the desk stays theirs for every one of those
   * routes, and is only handed back when they leave the building (see `_remove`).
   * The couch is the opposite — a seat is booked for one sit and given back after
   * it, so `keepCouch` covers the walk over to it with the seat already reserved.
   */
  _release(rec, { keepCouch = false } = {}) {
    // Anybody standing on the couch's own floor steps out of it first, however
    // they came to be there: sitting, or caught halfway onto the cushion by a job
    // arriving. Being seated is not the test — being in the furniture is.
    const { x, z } = rec.agent.position;
    const leavingCouch = rec.couchSeat && insideCouch(x, z)
      ? standUpFrom(rec.couchSeat)
      : [];
    const leavingDesk = !leavingCouch.length && rec.desk && rec.agent.seated
      ? standUpFromDesk(rec, rec.desk)
      : [];
    // Somebody who was working on their feet has no chair to get out of, so none of the
    // above applies to them — they step back off the mat instead.
    const leavingStand = !leavingCouch.length && !leavingDesk.length
      && rec.standingAtDesk && rec.desk
      ? leavePostAtDesk(rec, rec.desk)
      : [];
    // Called away before they ever got into it: nothing to get up from, but the
    // chair they swung out is theirs to push back, or it stays askew at their own
    // empty desk for as long as they are away from it.
    const tidyChair = !leavingDesk.length && rec.desk && rec.chairEntry
      ? [turnChair(rec.desk, rec.desk.sitRotation), act(() => { rec.chairEntry = null; })]
      : [];

    return [...leavingCouch, ...leavingDesk, ...leavingStand, ...tidyChair, act(() => {
      // Their desk, but nobody at it: screens off and the mug cleared away, so an
      // empty workstation reads as empty even though it is still booked.
      if (rec.desk) {
        rec.desk.setWorking(false);
        rec.desk.setMug(false);
      }
      rec.standingAtDesk = false;
      if (rec.couchSeat && !keepCouch) {
        rec.couchSeat.occupiedBy = null;
        rec.couchSeat = null;
        rec.couch = null;
      }
      this._returnBook(rec);
      if (rec.agent.seated) rec.agent.setSeated(false, { instant: true });
      rec.agent.setCarrying(null);
    })];
  }

  /** A new job is a new chance at a mid-job drink run. */
  _resetDeskTimer(rec) {
    rec.deskTime = 0;
    rec.drinkRolled = false;
  }

  /**
   * Count seated, working time and, once it crosses LONG_JOB, roll once for a
   * drink run. Living here rather than in the feed means it works for any source:
   * a long stretch at the desk is the room's observation, not the harness's.
   */
  _deskDrink(rec, dt) {
    const { agent } = rec;
    // Standing counts as being at your desk. Thirst is not a posture, and a stander left
    // out of this would be the one person in the office who never takes a break.
    if (!rec.desk || !(agent.seated || rec.standingAtDesk) || agent.status !== 'working') return;
    // Not while a hand is on the wheel: the roll is the room noticing a long stretch
    // at the desk, and it would carry somebody off to the coffee machine halfway
    // through the movement you pressed a button to watch.
    if (rec.pilot) return;

    rec.deskTime = (rec.deskTime ?? 0) + dt;
    if (rec.drinkRolled || rec.deskTime < LONG_JOB) return;

    rec.drinkRolled = true;              // one roll per job, win or lose
    if (chance(P_DESK_DRINK)) this._drinkRun(rec);
  }

  /**
   * The globe standing on one particular bookshelf.
   *
   * The one thing `byStation` cannot answer, because the globe is not a station: it is
   * a second prop mounted on top of one, and the pair are registered together on
   * `props.bookshelves` (see `mount` in scene/props/bookshelf.js). Looked up by the
   * shelf's own id rather than by proximity, because a room may have two shelves and
   * the globe that turns has to be the one on the case they are standing at.
   *
   * Replaced `_nearestShelf`, which chose the station *and* returned its props in one
   * step. Choosing is `stationForRole`'s job now — it knows about roles, which that did
   * not, and so could only ever find a bookshelf.
   *
   * @returns {?object} the globe's handle, or null if that shelf has no globe
   */
  _globeAt(station) {
    if (!station) return null;
    return this.props.bookshelves?.find((b) => b.id === station.id)?.globe ?? null;
  }

  /**
   * Somewhere to sit down: a free cushion on the nearest couch that has one.
   *
   * The same argument `stationForRole` makes for the stations — a room may hold several
   * couches, and sitting down is not something that has to happen in a particular one, so
   * somebody at the far end of the office uses the couch at their end. Nearest by the
   * standing room in front of it rather than by the couch itself, since that is where they
   * will actually walk to.
   *
   * A couch with both cushions taken is skipped rather than being the answer, which is
   * what makes several couches genuinely several places to sit: the room only sends
   * somebody for a drink instead once every cushion in it is occupied.
   *
   * Returns the couch as well as the seat, because the way into a cushion is that couch's
   * approach point — the seat itself is inside the furniture and cannot be walked to.
   *
   * @returns {?{couch: object, seat: object}} null when there is nowhere at all to sit,
   *   which is a room whose couches are full — or one with no couch in it, since nought
   *   is a number of couches an office may have.
   */
  _freeSeat(rec) {
    const { x, z } = rec.agent.position;
    let best = null;
    let bestDist = Infinity;
    for (const entry of this.props.couches ?? []) {
      const seat = entry.couch?.freeSeat();
      if (!seat) continue;
      const { approach } = entry.couch;
      const dist = (approach.x - x) ** 2 + (approach.z - z) ** 2;
      if (dist >= bestDist) continue;
      bestDist = dist;
      best = { couch: entry.couch, seat };
    }
    return best;
  }

  /**
   * Put a borrowed book back on the case it came off.
   *
   * One place, because it happens from four: the end of a lookup, an interruption
   * partway through one, going home, and being removed outright. The shelf is the one
   * they borrowed from — which is the whole reason it is remembered — and if that shelf
   * has since been deleted out of the room, the book goes nowhere and is simply
   * dropped, because there is no longer a gap on a shelf for it to fill.
   */
  _returnBook(rec) {
    if (rec.book) rec.shelf?.returnBook(rec.book);
    rec.book = null;
    rec.shelf = null;
  }

  /**
   * Book a free desk for an agent, at random, for as long as they are in the office.
   *
   * At random rather than the first free one, which is what this used to do. Taking the
   * first meant the layout's own order was a pecking order: desk 1 was claimed by the
   * first person through the door every single day, and the desk at the end of the row
   * was only ever used in a full house. A roving office that always seats people in the
   * same seats is not roving, so the pick is a real one across whatever is free.
   *
   * Called once, as they arrive. It can come up empty — a live harness can put more
   * agents in the room than the layout has desks — which is not an error: they work
   * standing up and elsewhere until somebody goes home, and `_work` retries then.
   */
  _claimDesk(rec) {
    if (rec.desk) return rec.desk;
    const free = (this.props.desks ?? []).filter((d) => !d.occupiedBy);
    const desk = pick(free);
    if (!desk) return null;
    desk.occupiedBy = rec.agent.id;
    rec.desk = desk;
    desk.setAssignment?.(rec.agent);
    return desk;
  }

  _remove(rec) {
    if (!this.agents.has(rec.agent.id)) return;
    // Their post goes with them: an envelope only they could have opened would
    // otherwise sit in the box forever, holding the flag up.
    this.post.dropFor(rec.agent.id);
    // Out of the building, so the desk goes back on the market — the one and only
    // place a desk is given up, which is what makes it theirs in between.
    if (rec.desk) {
      rec.desk.setWorking(false);
      rec.desk.setMug(false);
      rec.desk.occupiedBy = null;
      rec.desk.setAssignment?.(null);
    }
    if (rec.couchSeat) rec.couchSeat.occupiedBy = null;
    this._returnBook(rec);
    if (rec.coatHook) this.props.coatStand?.removeCoat(rec.coatHook);

    this.scene.remove(rec.agent.root);
    rec.agent.dispose();
    this.agents.delete(rec.agent.id);
    // Every session that was routing to them, and their advertisement as somebody a
    // later session could join. Left behind, the first would send a stray event to a
    // disposed character and the second would attach a new job to nobody.
    //
    // Read off their own jobs rather than by scanning every session in the room, which
    // is what this did first: `rec.jobs` already holds exactly the sessions belonging to
    // this character, so it is O(their jobs) instead of O(everyone's), and it says what
    // it means. The two are kept in step at every point that touches either — a spawn
    // writes both, joining a session writes both, and a job ending deletes from both —
    // so iterating one to clear the other is sound rather than merely shorter.
    for (const session of rec.jobs.keys()) this.jobOwner.delete(session);
    if (rec.actorKey && this.byActor.get(rec.actorKey) === rec.agent.id) {
      this.byActor.delete(rec.actorKey);
    }
    this._peopleCache = null;
    this._emitChange();
  }

  // -------------------------------------------------------------------------
  /**
   * The furniture has been moved: re-derive the room and put everybody in it right.
   *
   * Called by the furniture editor after each drop (see src/editor.js). The office
   * deliberately keeps running while the layout is edited — freezing it would make the
   * one thing the editor is for, watching the paths adjust, impossible to see — so
   * three things have to be brought back into agreement with the new plan.
   *
   * Order matters. The walkable map is re-derived first, because the re-planning below
   * asks it for routes; then anybody whose furniture is no longer in the room gives it
   * up; then anybody still sitting is moved to where their seat now is; and only then is
   * each walker's route recomputed, from the position they have just been put in rather
   * than the one they were in a moment ago.
   *
   * @returns {number} how many walkers were left with no route at all. Zero is the
   *   normal answer; anything else is a layout that has fenced somebody in, and the
   *   editor uses it to decide whether to keep the drop.
   */
  relayout() {
    this.nav.rebuild();
    this._dropVanished();
    this._reseat();

    let stranded = 0;
    for (const rec of this.agents.values()) {
      if (!rec.controller.replan()) stranded++;
    }
    return stranded;
  }

  /**
   * Re-size every tag after the legibility correction changes.
   *
   * The sizes are set once when a tag is built, so a viewport change has to reach
   * the agents already standing in the room. Nothing here recreates a texture; it
   * is the same two calls the tag makes for itself.
   */
  resizeTags() {
    for (const rec of this.agents.values()) {
      rec.agent.resizeTag();
    }
  }

  /**
   * Let go of any furniture that is not in the room any more.
   *
   * The editor can delete a desk with somebody sitting at it, which is a thing worth
   * allowing: the alternative is a room that cannot be rearranged while it is in use,
   * and this office deliberately keeps running while it is edited. So the desk goes,
   * and its occupant stands up where they were and carries on working — the same
   * situation as an agent who arrived to find every desk taken, which the room already
   * knows how to be. `_work()` gives them the next desk to come free.
   *
   * Held handles are checked against the room rather than notified by it, because a
   * deleted prop has no way to tell anybody it is gone: the reconciliation in
   * scene/props.js drops it out of `handles.desks`, and this is the other half of that.
   */
  _dropVanished() {
    const desks = new Set(this.props.desks ?? []);
    // Every cushion still in the room, across every couch still in it — so deleting one
    // couch of two stands up the people on that one and leaves the others sitting.
    const seats = new Set(
      (this.props.couches ?? []).flatMap((entry) => entry.couch?.seats ?? []),
    );
    for (const rec of this.agents.values()) {
      if (rec.desk && !desks.has(rec.desk)) {
        // Unbooked before it is let go, so that "occupiedBy is set" means "somebody has
        // this desk" whether or not the desk is still in the room. A deleted handle with a
        // name still on it is a small lie, and the editor's undo hands these back.
        rec.desk.occupiedBy = null;
        rec.desk.setAssignment?.(null);
        rec.desk = null;
        rec.chairEntry = null;
        // And they are no longer standing at it, because it is not there. This is the
        // exact mirror of the `_checkDesk` rule that stops a stander being read as stuck:
        // left set, the flag would go on vouching for a desk that has been deleted, and
        // nothing would ever find them a new one.
        rec.standingAtDesk = false;
        if (rec.agent.seated) rec.agent.setSeated(false, { instant: true });
        // Rehoused immediately if the room has a spare, rather than left deskless until
        // their next job happens to ask for one. Deleting a desk in the editor is a
        // change to the furniture, not a change to who works here — and an agent left
        // standing about beside the gap where their desk was, with three empty desks in
        // the room, reads as the editor having broken something.
        //
        // It can still come up empty, and that is the honest case: delete the last spare
        // and somebody genuinely has nowhere to sit until a desk is added or a colleague
        // goes home, which `_work` picks up (see `_claimDesk`).
        this._claimDesk(rec);
      }
      if (rec.couchSeat && !seats.has(rec.couchSeat)) {
        rec.couchSeat = null;
        rec.couch = null;
        if (rec.agent.seated) rec.agent.setSeated(false, { instant: true });
      }
      // The shelf a book came off can go too, and then there is nowhere to put it
      // back: it goes with the furniture rather than staying in their hands forever.
      if (rec.book && !(this.props.bookshelves ?? []).some((b) => b.shelf === rec.shelf)) {
        rec.shelf = null;
        this._returnBook(rec);
        rec.agent.setCarrying(null);
      }
    }
  }

  /**
   * Everybody's route, ahead and just behind, for the furniture editor to draw.
   *
   * A view rather than a copy: the point arrays belong to the controllers and are
   * replaced wholesale whenever a route is re-planned, so a caller that reads this every
   * frame always has the current answer. Only the wrapper objects are new each call,
   * which is a handful of allocations against a render loop that is already walking
   * every desk in the room.
   *
   * Lives here rather than the editor reaching into `agents` itself, so that what the
   * editor is allowed to know about an agent stays one short list.
   *
   * @returns {Array<{id: string, position: THREE.Vector3, ahead: ?Array,
   *                  behind: ?Array, behindAge: number}>}
   */
  pathTrails() {
    const out = [];
    for (const rec of this.agents.values()) {
      const { ahead, behind, behindAge } = rec.controller.pathTrail();
      out.push({
        id: rec.agent.id,
        position: rec.agent.position,
        ahead,
        behind,
        behindAge,
      });
    }
    return out;
  }

  /**
   * Put everybody who is sitting back on the seat they are sitting on.
   *
   * Snapped to the seat's new position rather than shifted by however far the prop
   * moved: the seat has already been recomputed by the prop's own `relocate()`, so
   * asking it where it is now is both simpler and right for a desk that was turned as
   * well as moved. Without this an occupant stays behind, sitting on thin air, while
   * their chair walks off across the room.
   *
   * Their heading is taken from the chair, which the desk turns in step with itself —
   * so somebody at a desk swung round to face the window is turned to face the window
   * too, rather than continuing to stare where the monitors used to be.
   */
  _reseat() {
    for (const rec of this.agents.values()) {
      if (!rec.agent.seated) continue;
      if (rec.desk && rec.agent.status !== 'resting') {
        rec.agent.setPositionXZ(rec.desk.seat.x, rec.desk.seat.z);
        rec.agent.setRotation(rec.desk.chairFacing);
      } else if (rec.couchSeat) {
        rec.agent.setPositionXZ(rec.couchSeat.position.x, rec.couchSeat.position.z);
        rec.agent.setRotation(rec.couchSeat.rotation);
      }
    }
  }

  /**
   * Everybody in the room, for the questions that are about all of them at once.
   * Cached, because every walking agent asks for it on every frame; the roster only
   * changes when somebody arrives or leaves.
   */
  _people() {
    if (!this._peopleCache) {
      // Anybody halfway up a beam of light is not in the room any more, whatever
      // the map still says. Leaving them in would have the crowd shoving a rising
      // body sideways and colleagues queueing behind somebody who is on their way
      // to the ceiling — and it is what keeps the beam's own hand on their name
      // tag (see scene/beam.js).
      this._peopleCache = [...this.agents.values()]
        .filter((rec) => !rec.beaming)
        .map((rec) => rec.agent);
    }
    return this._peopleCache;
  }

  _pickColor() {
    // The wardrobe lives in colour.js, because a described colour is fitted against the
    // same sixteen shirts an unnamed colleague is dressed from — one list, so the room
    // cannot come to hold two ideas of what a shirt looks like.
    return pick(SHIRT_PALETTE);
  }

  // -------------------------------------------------------------------------
  update(dt) {
    let nearDoor = false;
    /** Told to go home long enough ago that the room stops waiting. See `_beamOut`. */
    let overdue = null;
    // When the room was last drawn, which is the one thing `tidy` cannot find out
    // for itself — it runs on a timer, and a timer keeps its appointments whether
    // or not anything is being drawn.
    this._drawnAt = this.now();
    const deadline = this._drawnAt - LEAVE_GRACE * 1000;

    for (const rec of this.agents.values()) {
      // Being beamed up: the effect is driving them now, and everything below
      // would argue with it — the controller's queue is empty, so `onIdle` would
      // send somebody rising through the air off to make a coffee.
      if (rec.beaming) continue;
      if (rec.leaving && rec.leaveAt < deadline) (overdue ??= []).push(rec);

      rec.controller.update(dt);
      this._pilotTick(rec, dt);
      this._deskDrink(rec, dt);
      this._checkDesk(rec);
      this._checkPost(rec);
      // Hold the door for anyone actually coming or going. Being *near* it is not
      // the test and never was a good one: position alone cannot tell somebody on
      // their way out from somebody stood at a prop that happens to be by the
      // entrance, so the door opened on the latter and swung its leaf through them
      // (the bin used to stand there). `arriving` and `leaving` are the
      // errand itself, set for the length of the walk in and the walk out, so the
      // door is open before they reach it and eases shut behind them.
      if (rec.arriving || rec.leaving) {
        const p = rec.agent.position;
        if (Math.abs(p.x - DOOR.x) < 2.6 && p.z > -3.4 && p.z < 3.4) nearDoor = true;
      }
      // Name tags belong indoors. Outside there is no UI, only a street.
      rec.agent.refreshTagVisibility();
    }
    if (nearDoor) this.props.door?.requestOpen(0.9);

    // Outside the loop above, because beaming somebody up can remove them from the
    // very map it is walking.
    if (overdue) for (const rec of overdue) this._beamOut(rec);
    this.beams.update(dt);

    // Faxes part-way in. The handset has been shaking on the machine's screen since the
    // job was posted; the envelope lands as it stops, which is what makes the page look
    // like it came out *because* of the call.
    for (let i = this.ringing.length - 1; i >= 0; i -= 1) {
      const call = this.ringing[i];
      call.left -= dt;
      if (call.left > 0) continue;
      this.ringing.splice(i, 1);
      this._mailArrived(call.payload);
    }

    // The mailbox shows what the post model holds, rather than keeping its own
    // tally and trusting every path that removes an envelope to say so. One source
    // of truth, one place it is read.
    // Each box shows what is in *it*, not what is in the room: two boxes both reporting
    // the room's three letters would be worse than not having a second box.
    //
    // Two supplies now, and which one a station is told about is decided by what it
    // *serves* rather than by its kind. This loop used to hand every intake
    // station a pair of post counts, which was harmless while the only intake stations
    // were post boxes and an inbox — and would have wiped the printer's tray to zero
    // every frame the moment the printer became one, since no envelope is ever
    // addressed to a printer.
    // Which counts a station is told is decided by what it *serves* rather than by its
    // kind: the post shows letters and parcels, a printer shows faxes. One model behind
    // both, so a machine the editor removes needs no tidying up — its envelopes go with
    // the station, exactly as a second mailbox's do.
    // Parcels waiting somewhere with no pile of its own — a printer, a stack of
    // cartons — are drawn by the delivery channel at the spot they were thrown to. The
    // post box draws its own, so it is excluded: two piles on one square is worse than
    // none. Cleared to null when the receiving kind has nothing waiting, which is also
    // what tidies up after the last one is collected.
    let dropped = null;
    for (const station of stationsForRole('intake')) {
      const prop = this._propAt(station);
      const serves = STATION_KINDS[station.kind]?.serves ?? [];
      const parcels = this.post.countByArrival('package', station.id);
      if (parcels > 0 && !serves.includes('post')) dropped = { id: station.id, parcels };
      if (!prop?.setWaiting) continue;
      if (serves.includes('print')) {
        prop.setWaiting(this.post.countByArrival('fax', station.id));
      } else {
        prop.setWaiting(
          this.post.countByArrival('letter', station.id),
          parcels,
        );
      }
    }
    this.props.deliveries?.showDropped?.(dropped?.id ?? null, dropped?.parcels ?? 0);

    // Last word on where anybody is standing. Behaviours ask for a place to be
    // and the walking does its best, but two people can still end up on the same
    // patch of floor — crossing paths, or converging on one machine — so the
    // frame closes by pushing them apart. Doing it here, after every controller
    // has moved and before anything is drawn, means no behaviour has to be
    // careful and no overlap ever reaches the screen.
    this.spots.prune(dt, (id) => this.agents.get(id)?.agent.position ?? null);
    resolveOverlaps(this._people(), this.nav);

    // Bodies are sorted; now the labels above them. A queue standing correctly
    // a shoulder apart still paints an illegible block of overlapping name
    // tags, since each one is drawn wide enough to read from across the room
    // (see crowd.js declutterTags). Run after resolveOverlaps so it declutters
    // against where everyone actually ended up this frame, not last frame's spots.
    declutterTags(this._people());
  }

  /**
   * A desk may have just freed up — someone went home — or been added in the
   * editor, while an agent was left with none of their own. Retried from here
   * because the moment it happens (a departure, a drop) is not the agent's own:
   * nothing about *their* action list changes, so nothing would otherwise wake
   * them up to look again.
   *
   * Two ways to end up with no desk: parked in `_wait` for lack of one (status
   * `waiting`), or standing up mid-job because the editor deleted the one
   * underneath them (status stays `working`, but `seated` goes false — see
   * `_dropVanished`). `waiting` is also where a seated agent sits between
   * prompts, and `working` covers everyone mid-job with a desk to their name,
   * so checking `rec.desk` first is what keeps this from ever touching them.
   */
  _checkDesk(rec) {
    if (rec.desk || rec.onMailRun || rec.pilot) return;
    // Not seated used to be enough to mean "lost their desk", because working meant
    // sitting. It does not any more: somebody standing at a raised sit-stand desk is
    // working perfectly well, and reading them as stuck restarted their job from the top
    // every frame.
    const stuck = rec.agent.status === 'waiting'
      || (rec.agent.status === 'working' && !rec.agent.seated && !rec.standingAtDesk);
    if (!stuck) return;
    if (!this._claimDesk(rec)) return;
    this._work(rec);
  }

  /**
   * A follow-up prompt lands while its agent is already at the desk, mid-job.
   * It is still a request that arrived by air, so they get up, walk over, collect
   * it and come back — one trip per prompt, in the order they were posted.
   *
   * Driven from the frame loop rather than from the event, because the event
   * arrives while the agent is part-way through an action list and replacing that
   * list mid-stride is what causes agents to stutter or to abandon a walk. Here
   * they are provably seated and working, so interrupting is safe.
   *
   * A queue that outruns the walking is fine and expected: the room falls behind
   * reality rather than lying about it.
   */
  _checkPost(rec) {
    // A hand on the button outranks the post, the same way it outranks the feed that
    // sent it: work waiting in the box is still there when the hold expires, and the
    // idle agent it is offered to then fetches it.
    if (rec.onMailRun || rec.pilot) return;

    // Only when they are settled: seated and working, or standing about with
    // nothing on. Interrupting a walk, a permission wait, a bookshelf trip or a
    // coffee run would replace the action list mid-stride, which is how agents end
    // up shuffling on the spot — and every one of those states ends in a status
    // change that brings us straight back here anyway.
    //
    // Idle counts, and that matters more than it looks. Events can arrive far
    // faster than an agent can walk — a burst of buffered history on connect is
    // the extreme case — and a turn that ends before its envelope was collected
    // used to strand the post in the box with the desk label never set. An idle
    // agent with post waiting fetches it, which is also just what a person does.
    // Standing at a desk counts as settled for the same reason sitting does: they are at
    // their own desk, mid-job, and not part-way through a walk. Left out, a follow-up
    // prompt for somebody working on their feet would sit in the mailbox until they next
    // happened to sit down.
    const settled = rec.agent.status === 'idle'
      || (rec.agent.status === 'working' && (rec.agent.seated || rec.standingAtDesk));
    if (!settled) return;

    if (!this.post.hasOwn(rec.agent.id)) return;
    this._work(rec);
  }
}
