// Driving one agent by hand, from the buttons in the agent detail panel.
//
// The feature is a testing tool, so these are mostly about *not* being interfered
// with: the whole value of a button is that what you asked for is what you get to
// look at, and the room has half a dozen things in it that decide what an agent does
// next — the idle roll, the post waiting in the box, a long stretch at a desk earning
// a coffee run, and the feed itself, which for a test agent is a loop.
//
// A real office is built here (an AgentManager with props), because the parts being
// held off are the manager's own and a stub of it would be checking the stub.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { play, playUntil } from './lib/frames.js';
import { arrived, loadRoom, stubDesk } from './lib/room.js';

let PILOT_ACTIONS, PILOT_HOLD, PILOT_PART, canPilot;
let SOURCES;

before(async () => {
  await loadRoom();
  ({ PILOT_ACTIONS, PILOT_HOLD, PILOT_PART, canPilot } = await import('../src/agents/pilot.js'));
  // The real list, because "which sources get the buttons" is a claim about the
  // sources the office actually offers rather than about a fixture.
  ({ SOURCES } = await import('../src/data/sources.js'));
});

/**
 * One agent in an office with a desk in it, through the door and standing about.
 *
 * `arrived` walks them in and hangs the coat up first, and every test here needs that:
 * until it has happened every behaviour queues *behind* the arrival rather than
 * replacing it (see `_begin`), which would make every assertion below a statement about
 * somebody still on the doormat. No longer than that, though — from here the room is
 * rolling for what to do next, and the point of a button is that it does not matter
 * what it rolled.
 *
 * The desk is right by the door, so a button that sends them to it is answered in a
 * couple of seconds of the simulated clock rather than a walk across the floor.
 */
function office() {
  return arrived({ desks: [stubDesk(2, 2)] }).manager;
}

const rec = (manager) => manager.agents.get('a1');
const row = (manager) => manager.roster().find((r) => r.id === 'a1');

/**
 * Sitting at the desk, working — which is later than merely being seated.
 *
 * Sitting down is a movement: the pose starts folding several frames before the
 * status says what they are sitting down to do, and a check on `seated` alone can
 * also catch somebody still in a chair the *previous* thing they were doing put them
 * in.
 */
const atWork = (manager) =>
  rec(manager).agent.seated && rec(manager).agent.status === 'working';

// --- the catalogue ----------------------------------------------------------

test('every button says what it is, and no two are the same', () => {
  // The panel draws this list without checking it, and a button with no label is a
  // blank lozenge somebody has to press to find out about.
  const keys = new Set();
  for (const action of PILOT_ACTIONS) {
    assert.ok(action.key, 'a key');
    assert.ok(action.label, `${action.key} has a label`);
    assert.ok(action.title, `${action.key} has a tooltip`);
    // Every button stands in for the event a feed would have sent, which is the whole
    // idea of the file — with one exception, and it has to stay one. Nothing a harness
    // can send asks to be beamed up: the cone of light is the room giving up on a
    // departure, so that press goes to the backstop and not through the event gate.
    if (action.beam) assert.equal(action.event, undefined, 'beam stands in for no event');
    else assert.ok(action.event?.type, `${action.key} fires an event`);
    assert.ok(!keys.has(action.key), `${action.key} appears once`);
    keys.add(action.key);
  }
  assert.ok(keys.size >= 10, 'a button per behaviour the office has');
});

test('the buttons are drawn for the test suite and for nobody else', () => {
  // The row used to appear under every agent, live sessions included, where a press
  // put a movement on screen that the session had never reported.
  const piloted = SOURCES.filter((def) => canPilot(def)).map((def) => def.id);
  assert.deepEqual(piloted, ['test-data'],
    'every real harness is left alone, and a new one is left alone by default');
  // An agent the office is drawing before it knows where they came from is not a
  // test agent either.
  assert.equal(canPilot(null), false);
  assert.equal(canPilot(undefined), false);
});

test('a key nobody has, and an agent nobody has, are both refused', () => {
  const manager = office();
  assert.equal(manager.pilot('a1', 'polish-the-plants'), false);
  assert.equal(manager.pilot('nobody', 'wander'), false);
  assert.equal(row(manager).piloted, null, 'and nothing was taken over');
});

// --- taking the wheel -------------------------------------------------------

test('a press takes over, and the roster says which button', () => {
  const manager = office();
  assert.equal(manager.pilot('a1', 'wait'), true);
  assert.equal(row(manager).piloted, 'wait');
  // A frame, because a behaviour is an action list and the room runs one action per
  // frame — the same single frame every feed event costs.
  play(manager, 1 / 60);
  assert.equal(row(manager).status, 'waiting');
});

test('the job in hand is closed quietly — nothing walks to the bin', () => {
  const manager = office();
  const feed = [];
  manager.onFeed((entry) => feed.push(entry));

  manager.handleEvent({ type: 'job', id: 'a1', job: 'Something already underway' });
  manager.pilot('a1', 'wait');

  const log = row(manager).recent;
  const closed = log.find((e) => e.label === 'Something already underway');
  assert.equal(closed.outcome, 'done', 'closed where it stood');
  assert.equal(log[0].label, 'Waiting for an answer', 'and the press opened its own entry');
  assert.deepEqual(feed.filter((e) => e.kind === 'removal'), [],
    'a hand on the button is not an error: the mailbox panel says nothing');
});

test('a button with nothing to log leaves the log alone', () => {
  // Half the buttons are errands rather than work — a drink, a wander — and an entry
  // in "Recent jobs" for going to look out of the window would be the panel
  // inventing a job.
  const manager = office();
  manager.handleEvent({ type: 'job', id: 'a1', job: 'Real work' });
  const before = row(manager).recent.length;
  manager.pilot('a1', 'wander');
  assert.equal(row(manager).recent.length, before, 'no new entry');
});

test('the dance button reaches the dance, which nothing else in the room does', () => {
  // The pose was written with the agent and never asked for: `test/agent-dance.test.js`
  // opens by saying it is the one movement the office does not use. So the button is
  // the only route to it, and a button that reaches nothing is worse than no button.
  const manager = office();
  const rec = manager.agents.get('a1');
  const wasAt = { x: rec.agent.position.x, z: rec.agent.position.z };

  manager.pilot('a1', 'dance');
  assert.equal(row(manager).piloted, 'dance', 'the roster says which button');

  // Asserted on the body rather than on the plan, because the plan is consumed as it
  // runs and the question is whether the *pose* is ever reached. `dancePhase` is wound
  // from `dt` inside the dancing branch of `Agent.update` and nothing else touches it,
  // so a non-zero phase is proof that branch ran.
  const took = playUntil(manager, () => rec.agent.dancePhase > 0, 6);
  assert.ok(took !== null, 'nothing in the errand ever reached the dance');
  assert.equal(row(manager).status, 'dancing', 'the legend can count the moving dancer');

  // And it happens where they stand: a celebration is not an errand across the room.
  play(manager, 1);
  assert.ok(Math.hypot(rec.agent.position.x - wasAt.x, rec.agent.position.z - wasAt.z) < 1.5,
    'nobody should be sent across the room to be pleased about something');
  assert.ok(playUntil(manager, () => row(manager).status === 'idle', 10) !== null,
    'the dancer returns to idle when the celebration ends');
});

test('a dance leaves the job log alone, because a mood is not work', () => {
  const manager = office();
  const before = manager.feed?.length ?? 0;
  manager.pilot('a1', 'dance');
  play(manager, 2);
  assert.equal(manager.feed?.length ?? 0, before,
    'the panel gained a job entry for a dance');
});

// --- being left alone -------------------------------------------------------

test('the feed cannot move a piloted agent, but can still rename them', () => {
  const manager = office();
  manager.pilot('a1', 'wait');

  // Exactly what a test-data feed does every few seconds, and what used to make a
  // movement impossible to look at.
  manager.handleEvent({ type: 'status', id: 'a1', status: 'working' });
  manager.handleEvent({ type: 'activity', id: 'a1', activity: 'couch' });
  manager.handleEvent({ type: 'research', id: 'a1', topic: 'anything' });
  manager.handleEvent({ type: 'job', id: 'a1', job: 'Somebody else’s idea' });
  play(manager, 1);
  assert.equal(row(manager).status, 'waiting', 'still doing what was asked of them');

  // Who somebody *is* is not a movement, so it lands.
  manager.handleEvent({ type: 'rename', id: 'a1', name: 'Ada Byron' });
  assert.equal(row(manager).name, 'Ada Byron');
  assert.equal(row(manager).piloted, 'wait', 'and the hold survived it');
});

test('post waiting in the box does not pull them off it', () => {
  const manager = office();
  manager.pilot('a1', 'wait');
  // No mail scenery in this office, so the envelope simply lands in the box.
  manager.handleEvent({ type: 'mail', job: 'A prompt', forId: 'a1' });
  play(manager, 2);
  assert.equal(row(manager).status, 'waiting', 'the box can wait');
  assert.equal(manager.post.hasOwn('a1'), true, 'and the request is still in it');
});

test('the idle roll does not either', () => {
  const manager = office();
  manager.pilot('a1', 'wander');
  // Long enough for the walk to finish and the loop to have rolled a hundred times.
  playUntil(manager, () => !rec(manager).controller.busy, 20);
  assert.equal(row(manager).piloted, 'wander', 'still held');
});

// --- and handed back --------------------------------------------------------

test('ten seconds after the errand, the room takes them back', () => {
  const manager = office();
  manager.pilot('a1', 'wander');

  const took = playUntil(manager, () => row(manager).piloted === null, 40);
  assert.ok(took !== null, 'let go');
  assert.ok(took >= PILOT_HOLD, `held for at least ${PILOT_HOLD}s, not ${took}`);
  // Back in the loop: something is queued, because that is what the loop does.
  play(manager, 1);
  assert.ok(rec(manager).controller.busy || rec(manager).agent.status !== 'walking');
});

test('a press during the hold replaces the last one', () => {
  const manager = office();
  manager.pilot('a1', 'wait');
  play(manager, 2);
  assert.equal(manager.pilot('a1', 'wander'), true);
  assert.equal(row(manager).piloted, 'wander');
  assert.equal(rec(manager).pilot.hold, 0, 'and the ten seconds start again');
});

test('an agent parked at a desk is let go too, not left there for the afternoon', () => {
  // The trap this one is for: work at a desk ends on an hour-long wait rather than by
  // running out of actions, so a hold that waited for an empty queue would never
  // expire and the button would take an agent out of the room for good.
  const manager = office();
  manager.pilot('a1', 'work');
  const seated = playUntil(manager, () => atWork(manager), 30);
  assert.ok(seated !== null, 'sat down at the desk');

  const took = playUntil(manager, () => row(manager).piloted === null, 40);
  assert.ok(took !== null, `let go, ${took}s after sitting down`);
});

test('going home is not held: they leave, and they are gone', () => {
  const manager = office();
  assert.equal(manager.pilot('a1', 'home'), true);
  assert.equal(row(manager).piloted, null, 'nothing to come back to, so no hold');
  playUntil(manager, () => manager.roster().length === 0, 60);
  assert.equal(manager.roster().length, 0, 'out through the door');
});

test('somebody already on their way out cannot be driven', () => {
  const manager = office();
  manager.handleEvent({ type: 'exit', id: 'a1' });
  assert.equal(manager.pilot('a1', 'sofa'), false,
    'interrupting the walk out would strand them in the room');
});

test('the beam button takes them out where they stand', () => {
  const manager = office();
  assert.equal(manager.pilot('a1', 'beam'), true);
  assert.equal(rec(manager).beaming, true, 'in a cone of light');
  assert.equal(manager.beams.active, 1);
  assert.equal(row(manager).piloted, null,
    'nothing to come back to, so no hold — this errand ends with them not existing');

  play(manager, 2);
  assert.equal(manager.roster().length, 0, 'and they are gone');
  assert.equal(manager.beams.active, 0, 'with the cone closed behind them');
});

test('the beam button is the one press allowed on somebody on their way out', () => {
  // Which is the situation it stands in for: thirty seconds of not managing to leave
  // is the thing nobody would sit through to look at (see LEAVE_GRACE).
  const manager = office();
  manager.handleEvent({ type: 'exit', id: 'a1' });
  assert.equal(manager.pilot('a1', 'beam'), true);

  play(manager, 2);
  assert.equal(manager.roster().length, 0);

  // And not twice: a second press has nobody to beam.
  assert.equal(manager.pilot('a1', 'beam'), false);
});

// --- a job arriving --------------------------------------------------------

test('a new job is posted, then fetched from the box and opened', () => {
  // The one press that exercises the whole delivery path. `Work` cannot stand in for
  // it: with an empty box that button goes to the inbox stack instead, and an agent
  // who already has material fetches nothing at all.
  const manager = office();
  const feed = [];
  manager.onFeed((entry) => feed.push(entry));

  manager.pilot('a1', 'letter');
  assert.equal(manager.post.hasOwn('a1'), true, 'addressed to them, and in the air');
  assert.deepEqual(feed.map((e) => e.kind), ['delivery'], 'and announced as it lands');

  // No mail scenery in this office, so the envelope is in the box already — the walk
  // over is the part being checked, and it ends with the thing opened.
  const took = playUntil(manager, () => manager.post.size === 0, 40);
  assert.ok(took !== null, `collected, ${took}s after the press`);
  assert.equal(row(manager).job, 'A request that came by air',
    'the title inside the envelope is what they are now working on');
  assert.equal(row(manager).recent[0].label, 'A request that came by air',
    'and the log says so too');
  assert.ok(feed.some((e) => e.kind === 'collected' && e.arrival === 'letter'),
    'the mailbox panel saw it taken, and saw what size it was');

  // Then to a desk with it, and held there like any other errand.
  assert.ok(playUntil(manager, () => atWork(manager), 30) !== null, 'sat down with it');
  assert.ok(playUntil(manager, () => row(manager).piloted === null, 40) !== null,
    'and handed back afterwards');
});

test('the courier button forces the courier, whatever the toss would have said', () => {
  // Arrivals are a coin toss now, so the two mail buttons exist to show
  // each channel on demand. That is the only thing left that states an arrival —
  // and it has to be honoured, or the button shows whichever channel it feels like.
  const manager = office();
  manager.pilot('a1', 'package');
  assert.equal(manager.post.countByArrival('package'), 1,
    'the button asked for the courier, so the courier brings it');

  playUntil(manager, () => manager.post.size === 0, 40);
  assert.equal(rec(manager).arrivedBy, 'package',
    'and it goes back out the way it came in');
});

// --- the checklist ----------------------------------------------------------

test('the checklist ticks along at the desk, part by part', () => {
  const manager = office();
  const action = PILOT_ACTIONS.find((a) => a.key === 'checklist');
  manager.pilot('a1', 'checklist');

  const plan = rec(manager).agent.plan;
  assert.equal(plan.items.length, action.plan.length, 'handed over whole');
  assert.ok(plan.items.every((e) => e.status === 'pending'), 'and unticked');
  assert.equal(rec(manager).agent.step, null,
    'no part in hand yet: they have not reached the desk');

  // Nothing is marked off on the walk over — the parts are desk work.
  assert.ok(playUntil(manager, () => atWork(manager), 30) !== null, 'at the desk');
  assert.equal(rec(manager).agent.plan.items[0].status, 'pending');

  play(manager, PILOT_PART * 1.5);
  const step = rec(manager).agent.step;
  assert.equal(step.title, action.plan[0], 'the first part, once they are sitting down');
  assert.equal(step.index, 1);
  assert.equal(step.of, action.plan.length);

  // Every part, and none of them cut short by the hold: an agent sitting at a desk
  // *is* parked, so a hold that counted from the moment they sat down would let them
  // go three parts in and the checklist would never be seen finishing.
  const worked = playUntil(manager, () => rec(manager).agent.step === null, 60);
  assert.ok(worked !== null, 'worked through the list');
  assert.ok(rec(manager).agent.plan.items.every((e) => e.status === 'completed'),
    'and every part is ticked off');
  assert.equal(row(manager).piloted, 'checklist', 'still held at the end of it');

  // Then the ten seconds, and then handed back.
  // Within a frame of the full hold: the last part was ticked off part-way through
  // the frame this measurement starts from, so the clock is a frame ahead of it.
  const took = playUntil(manager, () => row(manager).piloted === null, 40);
  assert.ok(took !== null && took > PILOT_HOLD - 0.1, `the hold came after, not ${took}s`);
  assert.equal(rec(manager).agent.plan, null, 'and the plan goes with the errand');
  assert.equal(rec(manager).agent.step, null);
});
