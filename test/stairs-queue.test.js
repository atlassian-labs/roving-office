// Two people, one flight of stairs.
//
// The report was "several agents join at once and walk up the stairs on top of each
// other", and it was exactly true: every arrival is put on the same first point of
// the same fixed route and walks it at the same speed, so three of them made one
// body all the way up to the landing. The separation pass cannot help — it skips
// anybody on a route on purpose (crowd.js), because a flight is not part of the
// room's walkable grid and there is nowhere to shove somebody on a stair.
//
// So the flight is shared by taking turns instead, and this is what holds that down:
// the route is walked in single file, one direction at a time, and it always drains.
// Measured on the warehouse's own flight rather than a made-up line, so a change to
// the geometry is measured too.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let Agent, AgentController, follow, stairFlight, AGENT_RADIUS, resolveOverlaps;

before(async () => {
  stubDom();
  await loadThree();
  ({ Agent } = await import('../src/agents/Agent.js'));
  ({ AgentController, follow } = await import('../src/agents/states.js'));
  ({ stairFlight } = await import('../src/scene/approach.js'));
  ({ AGENT_RADIUS, resolveOverlaps } = await import('../src/agents/crowd.js'));
});

// One storey up, which is the warehouse; the mansard's is two and the same shape.
const flight = () => stairFlight(4.2);

// Outside the room there is no nav grid, and the crowd pass knows it — anybody
// standing on ground it calls unwalkable is moved anyway. That is the case here.
const nav = { walkableAt: () => false };

/**
 * A handful of walkers, each sent up (or down) a route in the same beat.
 *
 * They share one crowd, as they do in the room, because that is how one walker
 * finds out that another is already on the stairs.
 */
function climbers(routes) {
  const people = [];
  const controllers = routes.map((points, i) => {
    const agent = new Agent({ id: `walker-${i}`, name: `Walker ${i}` });
    agent.setPositionXZ(points[0].x, points[0].z);
    agent.setElevation(points[0].y ?? 0);
    const controller = new AgentController(agent, nav, null, () => people);
    controller.push([follow(points)]);
    people.push(agent);
    return controller;
  });

  return {
    people,
    // Handed back so a test can leave one of them out of the frame — which is what
    // a walker stuck on the flight is, and there is no other way to make one.
    controllers,
    /** One frame of the room: everybody moves, then nobody overlaps. */
    step(dt = 1 / 60, only = controllers) {
      for (const c of only) c.update(dt);
      resolveOverlaps(people, nav);
    },
    done: () => controllers.every((c) => !c.current && !c.queue.length),
  };
}

test('three arrivals at once climb one behind the other, not inside each other', () => {
  const { people, step, done } = climbers([flight().route, flight().route, flight().route]);

  let closest = Infinity;
  let onTheStairs = 0;
  for (let frame = 0; frame < 60 * 20 && !done(); frame++) {
    step();
    const climbing = people.filter((p) => p.onRoute);
    onTheStairs = Math.max(onTheStairs, climbing.length);
    for (let i = 0; i < climbing.length; i++) {
      for (let j = i + 1; j < climbing.length; j++) {
        closest = Math.min(closest, climbing[i].position.distanceTo(climbing[j].position));
      }
    }
  }

  // A queue, not a procession of one: they are on the flight together, and a body's
  // width apart on it. Before this they were on the same coordinate — a gap of zero.
  assert.ok(onTheStairs > 1, 'nobody ever shared the flight, so nothing was measured');
  assert.ok(closest >= AGENT_RADIUS * 2,
    `two climbers came within ${closest.toFixed(2)} of each other`);
  assert.ok(done(), 'somebody never got up the stairs');
});

test('everybody ends up at the top, in the order they set off', () => {
  const { people, step, done } = climbers([flight().route, flight().route, flight().route]);
  for (let frame = 0; frame < 60 * 20 && !done(); frame++) step();

  assert.ok(done(), 'the queue never drained');
  // The landing is the last point of the route, and each of them walked to it.
  const landing = flight().route.at(-1);
  for (const p of people) {
    assert.ok(Math.hypot(p.position.x - landing.x, p.position.z - landing.z) < 1.2,
      `${p.id} finished at (${p.position.x.toFixed(2)}, ${p.position.z.toFixed(2)})`);
    assert.equal(p.onRoute, false, `${p.id} is still holding the flight`);
  }
});

test('waiting for a turn that never comes ends in taking it anyway', () => {
  // Taking turns drains a queue, but a queue can still be *starved*, which is the
  // same rule seen from the bottom step: somebody who never gets on. `follow` used
  // to wait for that with no end to it, which made it the one action in the room
  // that could never finish — and an agent who cannot finish walking out is an agent
  // who never leaves. Twenty seconds of waiting is now enough, and what
  // follows it is the rude option: share the treads rather than never go home.
  const f = flight();
  const { people, controllers, step } = climbers([f.route, f.descent]);
  const [climber, leaver] = people;
  const [, down] = controllers;

  // One frame with both of them in it: the climber gets on, and the walker coming
  // down defers to them, which is the rule.
  step();
  assert.equal(climber.onRoute, true, 'the climber never got on the flight');
  assert.equal(leaver.onRoute, false, 'somebody walked into the path of a climber');

  // And then the climber is left out of the frame entirely — frozen on the treads,
  // holding the flight for good. Nothing in the room can clear that.
  for (let frame = 0; frame < 60 * 40; frame++) {
    if (!down.current && !down.queue.length) break;
    step(1 / 60, [down]);
  }

  assert.ok(!down.current && !down.queue.length, 'they are still waiting at the top');
  const foot = f.descent.at(-1);
  assert.ok(Math.hypot(leaver.position.x - foot.x, leaver.position.z - foot.z) < 1.2,
    `they ended at (${leaver.position.x.toFixed(2)}, ${leaver.position.z.toFixed(2)})`);
  assert.equal(leaver.onRoute, false, 'and they are off the flight again at the bottom');
});

test('somebody coming down has the stairs to themselves', () => {
  // One walking out as two walk in — the same flight, in both directions at once.
  const f = flight();
  const { people, step, done } = climbers([f.descent, f.route, f.route]);

  let sharedByBothDirections = 0;
  for (let frame = 0; frame < 60 * 30 && !done(); frame++) {
    step();
    const on = people.filter((p) => p.onRoute);
    if (on.some((p) => p.routeDir === 1) && on.some((p) => p.routeDir === -1)) {
      sharedByBothDirections++;
    }
  }

  assert.equal(sharedByBothDirections, 0,
    'somebody climbed into the path of somebody coming down');
  // And waiting for them cost nobody their trip.
  assert.ok(done(), 'the flight deadlocked: one end waiting on the other');
});
