// Working on your feet at a sit-stand desk.
//
// The geometry of the desk is held down in sit-stand-desk.test.js; this is about the
// person at it. Three things went wrong while it was being written, and each one is a
// test here, because each was invisible until an agent had actually been stood up:
//
//   - `_checkDesk` read "working but not seated" as "lost their desk", which had been a
//     safe reading for as long as working meant sitting. A stander was declared stuck and
//     had their job restarted from the top, every frame.
//   - `_checkPost` read "settled" the same way, so a follow-up prompt for somebody on
//     their feet waited in the mailbox until they next happened to sit down.
//   - `_dropVanished` cleared the desk but not the flag that said they were standing at
//     it, which is the same bug from the other side: nothing would find them a new one.
//
// None of the three is reachable from the desk alone, and none would show in a
// screenshot. They are all one boolean, which is exactly why they are worth pinning.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let buildDesk, Agent, STANDING_TYPE_REACH, RISE;

before(async () => {
  stubDom();
  await loadThree();
  ({ buildDesk } = await import('../src/scene/props/desk.js'));
  ({ Agent } = await import('../src/agents/Agent.js'));
  ({ STANDING_TYPE_REACH, RISE } = await import('../src/scene/props/sit-stand.js'));
});

const deskAt = (extra = {}) => buildDesk({ id: 'd', x: 0, z: 0, facing: 0, ...extra }, 0);

/** Settle a sit-stand desk at one end of its travel. */
function park(handle, up) {
  handle.setStanding(up);
  for (let t = 0; t < 30; t += 1 / 30) handle.update(1 / 30);
  return handle.raised;
}

test('the desk stays where the last person left it', () => {
  const { handle } = deskAt({ standing: true });
  assert.equal(park(handle, true), 1);

  // Nothing hands the height back, and nothing needs to. This is the promise the
  // choreography depends on from both ends: it will not sink under the agent standing at
  // it, and it will not tidy itself up the moment they walk away — the next person to want
  // a seat lowers it themselves, which is the only way furniture moves in this room.
  for (let t = 0; t < 240; t += 1 / 30) handle.update(1 / 30);
  assert.equal(handle.raised, 1, 'the desk moved with nobody touching it');
  assert.equal(handle.chairAside, 0, 'the chair moved with nobody touching it');
});

test('a standing agent types: the pose exists and is aimed at the raised keys', () => {
  // The shoulder angle is the whole of the standing pose, and it is derived from the rise
  // rather than chosen — so what is worth asserting is that the two still agree. If RISE
  // is ever retuned and the reach is not, this is what says so.
  const SHOULDER = 1.78;
  const ARM = 0.86;
  const KEYS = 1.63 + RISE;
  const handY = SHOULDER - ARM * Math.cos(STANDING_TYPE_REACH);
  assert.ok(handY > KEYS, `hands at ${handY.toFixed(2)} are below keys at ${KEYS.toFixed(2)}`);
  assert.ok(handY - KEYS < 0.2, `hands at ${handY.toFixed(2)} float above keys at ${KEYS.toFixed(2)}`);
  // Forward of the shoulder too, not straight up: an arm raised overhead is a dance.
  const reach = -ARM * Math.sin(STANDING_TYPE_REACH);
  assert.ok(reach > 0.6, `arm only reaches ${reach.toFixed(2)} forward`);
});

test('a standing agent moves its arms when told it is typing', () => {
  const agent = new Agent({ id: 'a', name: 'Ada', color: 0x88aacc });
  // Not seated, so this is the standing branch of the pose code — the one that used to
  // ignore `typing` entirely and leave a stander's arms hanging at their sides.
  assert.equal(agent.seated, false);
  for (let i = 0; i < 40; i++) agent.update(1 / 30, { typing: true });
  const [a, b] = agent.shoulders.map((s) => s.rotation.x);
  assert.ok(a < -1, `left arm at ${a.toFixed(2)} is not reaching for a desk`);
  assert.ok(b < -1, `right arm at ${b.toFixed(2)} is not reaching for a desk`);
  // Out of phase, so the two arms never make one shape.
  assert.notEqual(a, b);
});

test('an idle agent still lets its arms down', () => {
  // The mirror of the above: adding a standing typing pose must not leave every agent in
  // the room permanently reaching for a keyboard that is not there.
  const agent = new Agent({ id: 'a', name: 'Ada', color: 0x88aacc });
  for (let i = 0; i < 40; i++) agent.update(1 / 30, { typing: true });
  for (let i = 0; i < 200; i++) agent.update(1 / 30, {});
  for (const s of agent.shoulders) {
    assert.ok(Math.abs(s.rotation.x) < 0.05, `arm stuck at ${s.rotation.x.toFixed(2)}`);
  }
});

test('sitting down at a desk the last person stood at: chair in, top down', () => {
  // The failure this prevents is specific and silly-looking. A desk left raised has its
  // chair parked aside, so an agent who sat without undoing both would sit on nothing,
  // beside a chair that is not where they are — and unlike the old cycling version, the
  // desk will *never* put itself right, so the sitter has to.
  const { handle } = deskAt({ standing: true });
  handle.pushChairAside(true);
  park(handle, true);
  assert.equal(handle.raised, 1);
  assert.equal(handle.chairAside, 1);

  // What `sitDownAtDesk` does, in the order it does it.
  handle.pushChairAside(false);
  handle.setStanding(false);
  for (let t = 0; t < 30; t += 1 / 30) handle.update(1 / 30);
  assert.equal(handle.raised, 0, 'the desk did not come down to be sat at');
  assert.equal(handle.chairAside, 0, 'the chair was not pulled back in to be sat on');
});

test('standing up to a desk is the agent\u2019s doing, in order', () => {
  // `standAtDesk` is a list of actions, and the order is the behaviour: arrive, push the
  // chair, then raise. What is worth pinning without a whole agent is that the desk cannot
  // reach the top of its travel while the chair is still in the way, because that ordering
  // is the difference between somebody standing on a mat and somebody standing in a chair.
  const { handle } = deskAt({ standing: true });
  park(handle, false);
  assert.equal(handle.raised, 0);

  handle.pushChairAside(true);
  handle.setStanding(true);
  // One frame in, both are under way and neither has arrived.
  handle.update(1 / 30);
  assert.ok(handle.chairAside > 0 && handle.chairAside < 1);
  assert.ok(handle.raised > 0 && handle.raised < 1);
  // The shove is the shorter of the two, so it lands first — which is what lets the
  // agent's `waitUntil(chairAside === 1)` clear before the desk is up.
  for (let t = 0; t < 0.5; t += 1 / 30) handle.update(1 / 30);
  assert.equal(handle.chairAside, 1, 'the shove outlasted the motor');
  assert.ok(handle.raised < 1, 'the motor beat the shove');
});
