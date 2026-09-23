// Run an office, headless, and measure what happens in it.
//
// The layout generator (src/plan/) scores a *plan*: rectangles, distances,
// whether anything overlaps. Half of what makes a floor plan good cannot be seen
// from a plan at all — whether people get blocked, how long the walk to the post
// actually takes, whether it still works with nine people in the room instead of
// three. That needs the room *run*, which is what this does: the real
// environment, the real props, the real `AgentManager`, the real nav grid, driven
// by a scripted workload at a fixed time step, with a stopwatch on every errand.
//
// There is precedent. `TIGHT_PENALTY` in agents/pathfinding.js was tuned against
// exactly this measurement — "headless, Test Data, 30 simulated minutes, walking
// frames only" — by hand, once. This makes it repeatable, which is what turns it
// from a note in a comment into a metric a loop can optimise against.
//
// Three things it is careful about, all of them about being able to *compare* two
// runs:
//
//   * **The room is built once and re-furnished per layout.** Building an
//     environment is thousands of meshes and the expensive part of a run; a
//     layout change is `applyLayout` → `handles.sync()` → `manager.relayout()`,
//     which is precisely what the furniture editor does when you drag a desk.
//     Same code path, a fraction of the cost.
//   * **The clock is the caller's.** `AgentManager.now` is overridable for
//     exactly this reason, so grace periods and dwell times advance with the
//     simulation rather than with the wall.
//   * **The workload is scripted, not sampled.** Test Data is random traffic; a
//     fitness metric needs the same errands in the same order every time, or two
//     layouts are being compared on two different days at the office.

/**
 * How often the world ticks, in seconds.
 *
 * A thirtieth is half the app's frame rate and twice what the walking looks
 * smooth at, which is the right trade for a measurement: the separation pass and
 * the route follower both integrate over dt, so too coarse a step lets a walker
 * skip through a gap it should have squeezed past. Measured against 1/60 the
 * errand times agree to within a few hundredths of a second.
 */
const DT = 1 / 30;

/**
 * How long an errand may take before it counts as never having arrived.
 *
 * The room is 26 by 20, so the longest walk in it is about 32 units, and an agent
 * walks at a little over one a second: forty-five seconds is twice the worst
 * honest errand and still short enough that a failure does not eat a third of a
 * three-minute run.
 */
const ERRAND_TIMEOUT = 45;

/**
 * How much further than its own standing room somebody may be and still be *at* a
 * station.
 *
 * A flat 1.8 from the approach point was the first answer and it was wrong in a
 * way worth keeping: a station is a stretch of floor rather than a spot, and the
 * crowd pass spreads arrivals along the front of a machine shoulder to shoulder
 * (agents/crowd.js). The third person to want the post box stands well over 1.8
 * from its approach point — so errands that had plainly been *done* were being
 * recorded as never arriving, and the agent was found afterwards back at their
 * desk, working, six units away.
 *
 * Measured from the station's own centre and against its own `approachDist`, plus
 * this for the queue. It cannot be tight: the cost of being generous is a slightly
 * early stopwatch, and the cost of being tight is a metric that reports a working
 * room as broken.
 */
const QUEUE_ROOM = 1.4;

/** A walker who has moved less than this in `STUCK_WINDOW` is stuck. */
const STUCK_MOVE = 0.05;
const STUCK_WINDOW = 2;

/**
 * Open a room: build the environment and the props once, and hand back something
 * that can be re-furnished and run.
 *
 * The caller must have stubbed the DOM and loaded three first (see
 * bin/lib/headless-scene.js) — this module deliberately does not do it, because
 * a process that runs many rooms should pay for that once.
 *
 * @param {object} THREE
 * @param {{seed?: number}} [opts]
 */
export async function openRoom(THREE, { seed = 1 } = {}) {
  const { PROJECTS, resolveTheme } = await import('../../src/projects.js');
  const { applyPalette } = await import('../../src/config.js');
  const { buildEnvironment } = await import('../../src/scene/environment.js');
  const { buildProps } = await import('../../src/scene/props.js');
  const { clearMaterialCache } = await import('../../src/scene/build.js');
  const { releaseNightLightAssets } = await import('../../src/scene/night-lights.js');
  const { MailFlights } = await import('../../src/scene/mail.js');
  const { CourierDeliveries } = await import('../../src/scene/courier.js');
  const { AgentManager } = await import('../../src/agents/AgentManager.js');
  const layout = await import('../../src/layout.js');
  const { seedRandom } = await import('./headless-scene.js');

  // Cold, exactly as `buildWorld` starts: both caches are keyed on colour and
  // would otherwise hand back another theme's materials. The probe explains at
  // length why this matters for reproducibility (bin/coplanar-probe.js).
  clearMaterialCache();
  releaseNightLightAssets();
  const unseed = seedRandom(seed);

  const theme = resolveTheme(PROJECTS[0], {});
  applyPalette(theme.palette);

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const envHandles = buildEnvironment(root, theme);
  const propHandles = buildProps(root, theme);

  const boxAt = (id) => propHandles.byStation[id] ?? propHandles.mailbox ?? null;
  /**
   * The ways in for work, rebuilt from cold for every run.
   *
   * A `MailFlights` holds the planes currently in the air and a `CourierDeliveries`
   * holds whoever is walking one up the stairs, and both outlive the run that
   * launched them: a measurement that ends with two letters mid-flight hands them
   * to the *next* measurement, where they advance, land, and call back into a
   * manager that no longer exists.
   *
   * It is not theoretical. The same office measured on its own collected 13 of 14
   * jobs; measured straight after another run of itself, 6 of 10 — and a metric
   * whose value depends on what was measured before it is not a metric. Same
   * lesson as the coplanar probe's cold builds, reached from the other end.
   */
  const makeChannels = () => ({
    mail: new MailFlights(root, boxAt),
    deliveries: new CourierDeliveries(root, {
      boxAt,
      door: envHandles.door,
      elevator: envHandles.elevator,
      stairs: envHandles.stairs,
      stoop: envHandles.stoop,
    }),
  });
  const props = { ...propHandles, ...envHandles, ...makeChannels() };

  return {
    THREE,
    theme,
    scene,
    root,
    props,
    layout,
    AgentManager,
    seedRandom,
    /** Throw away anything left in the air and start the post from cold. */
    resetChannels: () => Object.assign(props, makeChannels()),
    close: () => unseed(),
  };
}

/**
 * The round one person does, in the order an office does it.
 *
 * **The order is the fix for a whole class of false failure.** The first version
 * handed errands out on a rota — collect, dispatch, drink, lookup, whoever is
 * free — and the manager quite correctly ignored a good number of them: a
 * `dispatch` from somebody carrying nothing has nothing to deliver, and a
 * `research` landing on somebody mid-arrival is queued behind it. The stopwatch
 * then recorded a room that had done nothing wrong as stranding its people, and
 * three of those were found afterwards working, resting and walking somewhere
 * else entirely.
 *
 * So the workload is a *round* rather than a rota: work arrives, somebody
 * collects it, looks something up, sends it, and gets a drink — each stage
 * beginning when the last one ends. Every event now makes sense in the state the
 * agent is actually in, which is the only way the measurement is of the room.
 *
 * By role rather than by prop, for the reason `stationForRole` exists: a room may
 * have no mailbox and get its work by fax, and the walk is the same errand either
 * way.
 */
const ROUND = [
  {
    kind: 'collect',
    role: 'intake',
    /**
     * Done when they are holding the work, which is what collecting it *is*.
     *
     * Geometry was the first answer and it was subtly wrong in a way that took a
     * frame-by-frame trace to see. An agent does not walk to a station's approach
     * point; they walk to a standing spot the crowd pass hands out along the front
     * of it (`StandingSpots`), which can be a unit and a half further out. A
     * radius of `approachDist + 1.4` therefore sat exactly on the boundary — so
     * whether a collection was recorded at all depended on which spot the queue
     * gave them, and half the offices in the sweep reported every collection as a
     * failure while the agent was in fact back at their desk having done it.
     *
     * `hasMaterial` is the room's own answer to the same question and cannot be
     * off by a unit. Every stage below has one: what the agent is *doing* is
     * observable, and it is what the errand was asking for.
     */
    done: (rec) => !!rec.hasMaterial,
    // A title first, because that is what a harness does — it announces the job
    // and then reports work beginning — and because the envelope in the box is
    // matched to the agent by it (see `retitleFor`).
    // Work has to *arrive* before anybody can collect it, or the room falls back
    // to the stack of boxes in the corner and the post is never exercised (see
    // `enabledArrivals`). Addressed, so the person asked for it is the person who
    // may open it (see agents/post.js).
    //
    // **Posted first, and the errand does not start until it has landed.** An
    // envelope is in flight for a while — a paper plane takes `FLIGHT_TIME`, a
    // courier walks in off the street and up the stairs — and `_work` looks in the
    // box the moment it is asked to. Sent together, half of all collections found
    // an empty box, went to the desk instead, and were recorded as a failure with
    // the agent sitting in `waiting` seventeen units away. Waiting for the letter
    // to land also takes the flight out of the measurement, which is right: how
    // long a paper plane is in the air is scenery, and the walk to the box is the
    // layout.
    //
    // `arrival: 'letter'` rather than letting it be drawn, because a courier's
    // walk is seconds of somebody else's journey and this is not a measurement of
    // couriers.
    post: (manager, id, n) => manager.handleEvent({
      type: 'mail', job: { title: 'a job', id: `job-${id}-${n}` }, forId: id, arrival: 'letter',
    }),
    /**
     * Ready when the envelope is in the box and this agent may open it.
     *
     * Asked with the **session** id, which is what `_post` resolves `forId` to
     * and therefore what the envelope carries (`jobOwner` maps a session to its
     * character, and the record is keyed by the result). Asked with
     * `rec.agent.id` — the character's own id, which looks like the more correct
     * thing — the predicate is never true and every collection in the run is
     * skipped. `canCollect` reads `pending`, which holds only what has *landed*,
     * so this is also the gate that keeps the flight out of the stopwatch.
     *
     * One argument, not two. `canCollect(id, box)` filters on the box the
     * envelope is *in*, and `null` there means "in no box at all" — the headless
     * case the manager uses when there is no scenery to walk to. A letter that has
     * landed is in a box by definition, so asking with `null` is asking for the
     * one thing that cannot be true, and it read false for every envelope in
     * every run. Omitted, the box is not filtered on and any box will do.
     */
    ready: (manager, id) => manager.post.canCollect(id),
    // **`status: working`, not `job`.** A `job` event sets a label and moves
    // nobody — "no status, no journey" is what the manager says about it — and the
    // mail run lives in `_work`, which is reached by a status of `working` (spec
    // §4). Asking for the wrong one had 150 of 234 collections recorded as
    // failures with the agent sitting seventeen units away in `waiting`: the room
    // was fine and the stopwatch was timing an instruction nobody had been given.
    event: (id) => ({ type: 'status', id, status: 'working' }),
  },
  {
    kind: 'lookup',
    role: 'research',
    event: (id) => ({ type: 'research', id, scope: 'graph' }),
    // `status('researching')` is pushed *after* the walk and the lookAt, so it
    // means "at the shelf with a book open" rather than "on the way".
    done: (rec) => rec.agent.status === 'researching',
  },
  {
    kind: 'dispatch',
    role: 'dispatch',
    event: (id) => ({ type: 'dispatch', id, summary: 'done' }),
    // Likewise `delivering`: they are at the box or the machine, sending it.
    done: (rec) => rec.agent.status === 'delivering',
  },
  {
    kind: 'drink',
    role: 'refresh',
    event: (id) => ({ type: 'activity', id, activity: 'drink' }),
    // The cup, not the sitting down. `carry('cup')` happens at the machine, and
    // `status('drinking')` only once they have got wherever they are drinking it —
    // their desk, a couch, or where they stand — which is a third of a room away
    // and none of the errand.
    done: (rec) => rec.agent.carrying === 'cup',
  },
];

/**
 * Run one office for a while and measure it.
 *
 * The workload: everybody files in, settles, and then takes one errand at a time
 * on a rota — collect, dispatch, drink, look something up — staggered so the room
 * has several people moving at once without everybody wanting the same machine on
 * the same frame. Every errand is timed from the event that asks for it to the
 * walker standing at somewhere that can do it.
 *
 * @param {object} rig  from `openRoom`
 * @param {object} opts
 * @param {?object} opts.blob      a layout blob, or null for the authored room
 * @param {number} opts.agents     how many people are in
 * @param {number} opts.minutes    how long to run, in simulated minutes
 * @param {number} opts.seed       seeds the room's own randomness
 * @returns {object} metrics
 */
export function runOffice(rig, {
  blob = null, agents = 5, minutes = 3, seed = 1, trace = false,
}) {
  const {
    props, root, layout, AgentManager, seedRandom,
  } = rig;

  // Re-furnish, exactly as a drag in the editor does: put the layout in, let the
  // props catch up, and let the agent layer re-derive what it had cached.
  layout.resetLayout();
  if (blob) layout.applyLayout(blob);
  props.sync();
  // And start the post from cold, so this run is independent of every run before
  // it. See `makeChannels`.
  rig.resetChannels();

  const unseed = seedRandom(seed);
  let clock = 0;                       // simulated seconds
  const manager = new AgentManager(root, props);
  // The manager's own clock, which it exposes for precisely this (see `wallClock`).
  manager.now = () => clock * 1000;
  manager.relayout();

  // Bodies only: a soft rug is floor, and standing room is floor somebody is
  // meant to walk into. Being inside either is not being inside the furniture.
  const blockers = layout.obstacleFootprints()
    .filter((r) => !r.soft && r.role !== 'stand');
  const inProp = (x, z) => blockers.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);

  /**
   * Where an errand of this kind can be done: the station's centre, and how near
   * counts as being there.
   *
   * By station rather than by approach point, because how far away a person
   * stands is a property of the machine — a printer's standing room is 2.0 out
   * and a bin's 1.55 — and because a queue forms along the front of it.
   */
  const spotsFor = (role) => layout.stationsForRole(role).map((s) => ({
    x: s.x,
    z: s.z,
    near: (layout.STATION_KINDS[s.kind]?.approachDist ?? 1.5) + QUEUE_ROOM,
  }));

  const ids = Array.from({ length: agents }, (_, i) => `sim-${i + 1}`);
  for (const [i, id] of ids.entries()) {
    manager.handleEvent({ type: 'spawn', id, name: `Sim ${i + 1}` });
  }

  // Long enough for everybody to walk in, climb whatever they have to climb, and
  // take a desk. Nothing is measured during it: arriving is not an errand, and a
  // lift office would otherwise score its queue for the car as walking badly.
  const SETTLE = 25;
  /**
   * A breath between finishing one errand and being given the next.
   *
   * Eight seconds, not two, and the difference is the whole difference between
   * measuring a room and measuring a stampede. At two, everybody was on an errand
   * essentially all the time and every round posted an addressed envelope, so one
   * post box had seven people queueing on it permanently — `waitUntil` holds a
   * collector at the box for up to `MAIL_WAIT` (twenty seconds) while somebody
   * else's envelope is in front of theirs. Reliability sat at 0.43 for *every*
   * layout, which is a term that swamps the number without telling anybody
   * anything about the floor. Test Data's own traffic is a job every ten to thirty
   * seconds a head; this is the same order.
   */
  const DWELL = 8;
  /** How far apart people start their rounds, so nobody moves in lockstep. */
  const STAGGER = 1.5;

  const pending = new Map();           // agent id -> open errand
  const done = [];
  const walked = new Map(ids.map((id) => [id, 0]));
  const last = new Map();
  const stuckFor = new Map(ids.map((id) => [id, 0]));
  /** Where each person is in their round, and when they may start the next stage. */
  const round = new Map(ids.map((id, i) => [id, {
    stage: 0, at: SETTLE + i * STAGGER, done: 0, posted: false, postedAt: 0,
  }]));
  /** How long to wait for an envelope before giving up on it and moving on. */
  const POST_WAIT = 8;
  let walkingFrames = 0;
  let clippedFrames = 0;
  let stuckEvents = 0;

  const frames = Math.round((minutes * 60) / DT);
  for (let frame = 0; frame < frames; frame += 1) {
    clock += DT;

    // Everybody's own round, advanced independently.
    for (const id of ids) {
      const turn = round.get(id);
      if (pending.has(id) || clock < turn.at) continue;
      const rec = manager.agents.get(id);
      const at = rec?.agent?.position;
      if (!at) continue;

      const stage = ROUND[turn.stage % ROUND.length];
      const spots = spotsFor(stage.role);
      // Nothing in the room can do this job — a dry floor has no drinks, and a
      // room may have no bin. Skip the stage, not the round.
      if (!spots.length) { turn.stage += 1; turn.posted = false; continue; }

      // A stage that has to arrange something first — the post — does it, and then
      // waits for it to be true before the stopwatch starts.
      if (stage.post && !turn.posted) {
        stage.post(manager, id, turn.done);
        turn.posted = true;
        turn.postedAt = clock;
        continue;
      }
      if (stage.ready && !stage.ready(manager, id)) {
        // Still in the air. Give it a while, then get on with the round rather
        // than stalling the whole measurement on one envelope.
        if (clock - turn.postedAt > POST_WAIT) { turn.stage += 1; turn.posted = false; }
        continue;
      }
      // Already done before it started — somebody standing at the machine, or
      // still carrying the last job. Timing that measures where they happened to
      // be rather than anything about the plan, so the stage is skipped.
      const doneAlready = stage.done
        ? stage.done(rec)
        : spots.some((s) => Math.hypot(at.x - s.x, at.z - s.z) <= s.near);
      if (doneAlready) {
        turn.stage += 1;
        turn.at = clock + DWELL;
        turn.posted = false;
        continue;
      }

      manager.handleEvent(stage.event(id));
      pending.set(id, {
        kind: stage.kind,
        spots,
        at: clock,
        from: { x: at.x, z: at.z },
        walked: walked.get(id),
      });
    }

    // The frame, as `main.js` runs it. The mail flights and the courier are ticked
    // by the render loop rather than by the manager (main.js:1188), and a paper
    // plane that is never advanced never lands: the envelope sat `inFlight`
    // forever, `canCollect` was never true, and every collection in the run was
    // skipped. One of the two lines this simulator most needed and had least
    // reason to guess at.
    props.mail.update(DT);
    props.deliveries.update(DT);
    manager.update(DT);

    // What happened this frame, per person.
    for (const id of ids) {
      const rec = manager.agents.get(id);
      if (!rec) continue;
      const pos = rec.agent.position;
      const previous = last.get(id);
      const step = previous ? Math.hypot(pos.x - previous.x, pos.z - previous.z) : 0;
      last.set(id, { x: pos.x, z: pos.z });

      const trail = rec.controller.pathTrail?.();
      const walking = !!trail?.ahead;
      if (walking) {
        walkingFrames += 1;
        walked.set(id, walked.get(id) + step);
        if (inProp(pos.x, pos.z)) clippedFrames += 1;
        // Standing still while still walking somewhere: either shoved by the
        // crowd pass or waiting for a lane that is not opening.
        if (step < STUCK_MOVE * DT * 30) {
          const held = stuckFor.get(id) + DT;
          stuckFor.set(id, held);
          if (held >= STUCK_WINDOW) { stuckEvents += 1; stuckFor.set(id, 0); }
        } else stuckFor.set(id, 0);
      } else stuckFor.set(id, 0);

      const errand = pending.get(id);
      if (!errand) continue;
      // The room's own signal, or failing that the geometry: either counts. The
      // signal is authoritative — it is the errand actually being done — and the
      // fallback is kept for a stage that has none.
      const near = errand.done?.(rec)
        ?? errand.spots.some((s) => Math.hypot(pos.x - s.x, pos.z - s.z) <= s.near);
      if (near) {
        // Against where they *ended up*, not against the machine they were
        // walking to. Measured to the machine, the ratio came out at 0.51 —
        // walking half the straight-line distance, which is impossible — because
        // arrival is being *at* a station (`ARRIVED`) rather than standing on it,
        // and a queue two paces long is most of a short errand. Measured to the
        // point they actually reached, a detour is at least 1 by construction and
        // anything above it is the furniture.
        const straight = Math.hypot(pos.x - errand.from.x, pos.z - errand.from.z);
        const travelled = walked.get(id) - errand.walked;
        done.push({
          kind: errand.kind,
          id,
          seconds: clock - errand.at,
          straight,
          detour: straight > 1 ? travelled / straight : null,
          arrived: true,
        });
        pending.delete(id);
        const turn = round.get(id);
        turn.stage += 1;
        turn.done += 1;
        turn.at = clock + DWELL;
        turn.posted = false;
      } else if (clock - errand.at > ERRAND_TIMEOUT) {
        done.push({
          kind: errand.kind, id, seconds: ERRAND_TIMEOUT, straight: null, detour: null, arrived: false,
          // Where they were when the clock ran out, and how far that was from the
          // nearest place they could have done the errand. A failure with a small
          // distance is a queue; a failure with a large one is a walk that never
          // started.
          stoppedAt: { x: Math.round(pos.x * 10) / 10, z: Math.round(pos.z * 10) / 10 },
          shortBy: Math.round(Math.min(...errand.spots
            .map((s) => Math.hypot(pos.x - s.x, pos.z - s.z))) * 10) / 10,
          status: rec.agent.status,
        });
        pending.delete(id);
        const turn = round.get(id);
        turn.stage += 1;
        turn.done += 1;
        turn.at = clock + DWELL;
        turn.posted = false;
      }
    }
  }

  // Everybody goes home, which is the only place a desk is given up (see
  // `_release` and the note on desk booking in docs/the-scene.md).
  //
  // Without this, every run after the first found every desk still claimed by
  // people who no longer exist, `_work` fell through to `_wait` — "no free desk:
  // hover until one frees up" — and the collection never happened. It is the whole
  // explanation for a symptom that took four wrong theories: collect errands
  // failing with the agent parked in `waiting`, in every run but the first, in
  // rooms that measured perfectly well on their own. A measurement that depends on
  // what was measured before it is not a measurement.
  for (const id of ids) manager.handleEvent({ type: 'despawn', id });
  manager.update(DT);

  unseed();

  const of = (kind) => done.filter((e) => e.kind === kind);
  /** Robust to an errand that turned into two walks — see `detour` below. */
  const median = (list) => {
    if (!list.length) return null;
    const s2 = [...list].sort((a, b) => a - b);
    return s2[Math.floor(s2.length / 2)];
  };
  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const p90 = (list) => {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
  };

  const errands = {};
  for (const { kind } of ROUND) {
    const runs = of(kind);
    const arrived = runs.filter((e) => e.arrived);
    errands[kind] = {
      n: runs.length,
      failed: runs.length - arrived.length,
      mean: mean(arrived.map((e) => e.seconds)),
      p90: p90(arrived.map((e) => e.seconds)),
      // The *median*, not the mean. An errand is usually one walk, and
      // occasionally two — a job event landing on somebody mid-arrival is queued
      // behind it (see `_begin`), so they finish walking to their desk before
      // setting off for the post, and the ratio for that errand is a number about
      // the queue rather than about the floor. A median shrugs those off; a mean
      // lets one of them swamp a run.
      detour: median(arrived.map((e) => e.detour).filter((d) => d != null)),
    };
  }

  return {
    agents,
    minutes,
    seed,
    ...(trace ? { trace: done } : {}),
    desks: layout.DESKS.length,
    errands,
    /** How many errands nobody ever completed — the hard failure. */
    failed: done.filter((e) => !e.arrived).length,
    attempted: done.length,
    /** Still walking when the clock ran out: not a failure, but not an arrival. */
    unfinished: pending.size,
    walkingFrames,
    /** Walking frames spent inside a piece of furniture: the chair-clipping metric. */
    clipped: walkingFrames ? clippedFrames / walkingFrames : 0,
    /** Two seconds of walking without moving. Blocked, shoved, or deadlocked. */
    stuckEvents,
    distance: [...walked.values()].reduce((a, b) => a + b, 0),
  };
}
