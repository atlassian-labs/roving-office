// The happy dance, which is the one movement the office does not use yet.
//
// It exists to be reached for — a celebration, wired the same way typing and reading
// are, so any action list can ask for it with `wait(n, { dancing: true })`. Nothing in
// the room calls it, so nothing in the room would notice if it broke; these are what
// notice instead.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let Agent;

before(async () => {
  stubDom();
  await loadThree();
  ({ Agent } = await import('../src/agents/Agent.js'));
});

const dancer = () => new Agent({ id: 'd', name: 'Dancer' });

/**
 * Run a few frames of one pose and hand back the agent.
 *
 * Frames rather than seconds, and one named animation held throughout, which is why
 * this is not test/lib/frames.js's `play` — that runs the room's clock and this
 * holds a character in one pose to look at it.
 */
function pose(agent, anim, frames = 30) {
  for (let i = 0; i < frames; i++) agent.update(1 / 60, anim);
  return agent;
}

test('dancing raises both arms and takes the feet off the floor', () => {
  const a = dancer();
  // Sampled across a whole beat rather than at one instant: the pose is a cycle, and
  // a single frame of it could be the moment anything happens to be at rest.
  let maxHop = 0;
  let armsUp = 0;
  for (let i = 0; i < 90; i++) {
    a.update(1 / 60, { dancing: true });
    maxHop = Math.max(maxHop, a.body.position.y);
    if (a.shoulders[0].rotation.x < -1.5 && a.shoulders[1].rotation.x < -1.5) armsUp++;
  }
  assert.ok(maxHop > 0.1, `hop only reached ${maxHop.toFixed(3)}`);
  assert.equal(armsUp, 90, 'both arms stay overhead for the whole cycle');
});

test('the two arms never make one shape', () => {
  // Out of phase is the difference between a dance and a jumping jack. If the two
  // shoulders ever agree exactly, the silhouette is symmetrical and reads as a pose.
  const a = dancer();
  let apart = 0;
  for (let i = 0; i < 90; i++) {
    a.update(1 / 60, { dancing: true });
    apart = Math.max(apart, Math.abs(a.shoulders[0].rotation.x - a.shoulders[1].rotation.x));
  }
  assert.ok(apart > 0.4, `arms only ever ${apart.toFixed(2)} apart`);
});

test('and the lean unwinds when the dancing stops', () => {
  // The one thing a dance leaves behind: no other pose writes `body.rotation.z`, so a
  // tilt would simply stay on a character who had walked off mid-celebration.
  const a = pose(dancer(), { dancing: true }, 45);
  assert.ok(Math.abs(a.body.rotation.z) > 0.01, 'leaning while dancing');
  pose(a, { moving: true }, 60);
  assert.equal(a.body.rotation.z, 0, 'and upright again once they walk off');
});

test('a seated agent does not dance', () => {
  // Sitting wins. A dance is a thing done on your feet, and the seated pose owns the
  // hips and knees — letting both write them would put a sitter half out of the chair.
  const a = dancer();
  a.setSeated(true, { instant: true });
  const hips = a.hips[0].rotation.x;
  assert.ok(hips < -1, 'seated to begin with');
  pose(a, { dancing: true }, 30);
  assert.equal(a.hips[0].rotation.x, hips, 'still sitting, and sitting the same way');
  assert.equal(a.body.rotation.z, 0, 'and not leaning');
});
