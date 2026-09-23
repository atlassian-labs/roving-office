// Beamed up: the way out for somebody who cannot find the way out.
//
// The report was an office with a hundred and fifty characters in it, a hundred and
// seventeen of them walking, most of them the same cron job's session over and over
// — a window left open for hours. Nothing was multiplying: the feed retires a quiet
// session on a `setInterval`, which a background tab goes on running, while the walk
// out only advances under `requestAnimationFrame`, which a background tab does not
// run at all. Every one of those departures had been told to go home and not one of
// them had taken a step.
//
// So a departure now has a deadline, and it is measured on the wall clock rather than
// on frames — which is the whole of the fix, and the reason the clock is a seam here:
// these tests drive it, and a loop that never runs is a loop this test simply does not
// run either.
//
// A real office is built (an AgentManager with real desks), because what is being
// asserted is the room giving a desk back and taking somebody out of the crowd, and a
// stub of the room would be a test of the stub.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { seedRandom } from '../bin/lib/headless-scene.js';
import { loadRoom } from './lib/room.js';

let THREE, AgentManager, buildDesk, DESKS, AT_ONCE;

before(async () => {
  ({ THREE, AgentManager } = await loadRoom());
  ({ buildDesk } = await import('../src/scene/props/desk.js'));
  ({ DESKS } = await import('../src/layout.js'));
  ({ AT_ONCE } = await import('../src/scene/beam.js'));
});

/** The grace period the room allows a departure, in seconds. See LEAVE_GRACE. */
const GRACE = 30;

/**
 * A room with the layout's own desks in it, `n` people, and a clock under our thumb.
 *
 * `frames` draws time; `sleep` passes it without drawing any — a window behind
 * another window, which is the condition this is all about. That the two are separate
 * verbs here is the point: nothing else in the office can tell them apart.
 */
function office(n, { props = {} } = {}) {
  seedRandom(1);
  const desks = DESKS.map((d, i) => buildDesk(d, i).handle);
  const manager = new AgentManager(new THREE.Group(), { desks, ...props });

  let clock = 0;
  manager.now = () => clock;

  const beamed = [];
  const realBeam = manager.beams.beamUp.bind(manager.beams);
  manager.beams.beamUp = (agent, onGone) => {
    beamed.push(agent.id);
    return realBeam(agent, onGone);
  };

  for (let i = 0; i < n; i++) manager.handleEvent({ type: 'spawn', id: `a-${i}`, name: `Agent ${i}` });

  return {
    manager, desks, beamed,
    /** Seconds of a running office. */
    frames(seconds) {
      for (let f = 0; f < Math.round(seconds * 60); f++) {
        clock += 1000 / 60;
        manager.update(1 / 60);
      }
    },
    /** Seconds of nobody looking: the clock moves, the loop does not. */
    sleep(seconds) { clock += seconds * 1000; },
    /** Tell everybody to go home, as a reaped session does. */
    sendHome() {
      for (const rec of [...manager.agents.values()]) {
        manager.handleEvent({ type: 'exit', id: rec.agent.id });
      }
    },
  };
}

test('a departure with no frames to walk in is beamed up once it is overdue', () => {
  const room = office(3);
  room.frames(20);
  assert.equal(room.manager.agents.size, 3);
  room.sendHome();

  // The window goes behind another one for four hours. The feed's reaper kept
  // running the whole time; the walk out did not.
  room.sleep(4 * 3600);
  assert.equal(room.manager.agents.size, 3, 'nobody can leave a room that is not being drawn');
  assert.deepEqual(room.beamed, [], 'and nothing is beamed while there are no frames either');

  // Then it comes back. One frame is all it takes to notice.
  room.frames(1 / 60);
  assert.equal(room.beamed.length, 3, 'everybody overdue is taken in hand at once');
  room.frames(2);
  assert.equal(room.manager.agents.size, 0, 'and the room is empty');

  // Down to the last coat hook: the beam ends in the same removal the door does.
  for (const desk of room.desks) assert.equal(desk.occupiedBy, null, 'a desk is still booked');
});

test('an ordinary departure walks out, and is never beamed', () => {
  const room = office(6);
  room.frames(20);
  room.sendHome();

  // Time passes on the clock exactly as fast as it passes in the room, which is
  // what a healthy render loop is.
  room.frames(GRACE - 5);
  assert.equal(room.manager.agents.size, 0, 'six people take nowhere near thirty seconds to leave');
  assert.deepEqual(room.beamed, [], 'so the backstop never fires');
});

test('the deadline is thirty seconds, and not a second under it', () => {
  const room = office(2);
  room.frames(20);
  room.sendHome();
  room.sleep(GRACE - 1);
  room.frames(1 / 60);
  assert.deepEqual(room.beamed, [], 'twenty-nine seconds overdue is still a departure');

  room.sleep(2);
  room.frames(1 / 60);
  assert.equal(room.beamed.length, 2, 'thirty-one seconds is not');
});

test('a roomful goes up a few at a time, and every one of them goes', () => {
  const room = office(60);
  room.frames(20);
  room.sendHome();
  room.sleep(3600);

  // Every frame until the room is empty, watching how many cones are lit at once.
  let most = 0;
  for (let f = 0; f < 60 * 60 && room.manager.agents.size; f++) {
    room.frames(1 / 60);
    most = Math.max(most, room.manager.beams.active);
  }

  assert.equal(room.manager.agents.size, 0, 'the clear-out finished');
  assert.ok(most > 1, `only ${most} beam ran at a time, so nothing was batched`);
  assert.ok(most <= AT_ONCE, `${most} beams at once, which is a wall of blue`);
  // Refused candidates are offered again on a later frame rather than dropped, so
  // nobody is beamed twice — and a few of them beat the queue for a cone by simply
  // reaching the door, which is the room preferring its own way out and is why this
  // counts uniqueness rather than expecting all sixty.
  assert.equal(new Set(room.beamed).size, room.beamed.length, 'somebody was beamed up twice');
  assert.ok(room.beamed.length > AT_ONCE,
    `${room.beamed.length} beamed, so the queue behind the first cones did not drain`);
});

test('somebody in a beam is out of the crowd, and takes no more instructions', () => {
  const room = office(2);
  room.frames(20);
  room.sendHome();
  room.sleep(GRACE + 1);
  room.frames(1 / 60);

  const rising = [...room.manager.agents.values()][0];
  assert.equal(rising.beaming, true);
  assert.ok(!room.manager._people().includes(rising.agent),
    'a rising body is still being shoved about by the separation pass');
  assert.equal(rising.controller.queue.length, 0, 'the walk they were on should be over');

  // A feed with more to say about them — a status, a job — must not put somebody
  // halfway up a cone of light back to work.
  room.manager.handleEvent({ type: 'status', id: rising.agent.id, status: 'working' });
  room.manager.handleEvent({ type: 'job', id: rising.agent.id, job: 'One more thing' });
  assert.equal(rising.controller.queue.length, 0, 'the room went back to taking orders');

  room.frames(2);
  assert.equal(room.manager.agents.size, 0);
});

test('a room nobody is drawing empties itself on the timer, with no cone at all', () => {
  const room = office(8);
  room.frames(20);
  room.sendHome();

  // The timer keeps its appointments while the loop sleeps — which is the whole of
  // the bug — so this is what it finds when it fires.
  room.sleep(45);
  assert.equal(room.manager.tidy(), 8, 'the timer should have shown all eight out');
  assert.equal(room.manager.agents.size, 0);
  assert.deepEqual(room.beamed, [], 'nothing was beamed for an audience that is not there');
  for (const desk of room.desks) assert.equal(desk.occupiedBy, null, 'a desk is still booked');
});

test('the timer keeps out of the way of a room that is being drawn', () => {
  const room = office(3);
  room.frames(20);
  room.sendHome();
  room.sleep(45);

  // One frame is enough to say the room is live, and from then on the departure is
  // the beam's business — otherwise a background timer would be racing the
  // animation and quietly deleting whoever it got to first.
  room.frames(1 / 60);
  assert.equal(room.manager.tidy(), 0, 'the timer took somebody the beam had in hand');
  assert.equal(room.beamed.length, 3);
  room.frames(2);
  assert.equal(room.manager.agents.size, 0);
});

test('a beam interrupted by the frames stopping does not leave somebody hanging', () => {
  const room = office(2);
  room.frames(20);
  room.sendHome();
  room.sleep(31);
  room.frames(1 / 60);
  assert.equal(room.manager.beams.active, 2, 'both of them should be in a cone by now');

  // The window goes away mid-animation. The beam will never finish, so its subject
  // has to be swept up with everybody else rather than hanging in mid air forever.
  room.sleep(60);
  assert.equal(room.manager.tidy(), 2);
  assert.equal(room.manager.agents.size, 0);
});

test('asked for stillness, they simply go', () => {
  const room = office(4);
  room.frames(20);
  room.sendHome();
  room.sleep(GRACE + 1);

  globalThis.window = { matchMedia: () => ({ matches: true }) };
  try {
    room.frames(1 / 60);
    assert.equal(room.manager.agents.size, 0, 'a viewer who wants no motion still wants an empty room');
    assert.equal(room.manager.beams.active, 0, 'and no cone was drawn to get there');
  } finally {
    delete globalThis.window;
  }
});
