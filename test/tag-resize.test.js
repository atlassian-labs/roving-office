// What a viewport change does to the characters already in the room.
//
// `resizeTag()` is driven by the manager on every resize and every zoom: it re-runs the
// tag's sizing so the legibility correction reaches tags that were built before it
// changed. It used to end by calling `_placeStepChip()`, a method that no longer exists
// — the step chip it placed was taken out of the tag, and this one caller was left
// behind. So every resize threw a TypeError from the first character in the roster, the
// loop in AgentManager.resizeTags() stopped there, and every other character kept the
// tag size it was born with.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let Agent;
let setTagLegibility;

before(async () => {
  stubDom();
  await loadThree();
  ({ Agent, setTagLegibility } = await import('../src/agents/Agent.js'));
});

after(() => setTagLegibility(1));

test('resizing a tag does not throw', () => {
  const a = new Agent({ id: 'r', name: 'Resize' });
  assert.doesNotThrow(() => a.resizeTag());
});

test('a legibility change reaches a tag that was built before it', () => {
  setTagLegibility(1);
  const a = new Agent({ id: 'l', name: 'Legible' });
  const before = a.nameTag.scale.y;
  setTagLegibility(2);
  a.resizeTag();
  assert.ok(a.nameTag.scale.y > before * 1.5, `${a.nameTag.scale.y} should have grown from ${before}`);
});
