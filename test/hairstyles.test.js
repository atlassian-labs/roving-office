// Hairstyles as the room is watched: from above and in front.
//
// The 'long' style used to be a single panel hung behind the head, with nothing on the
// crown. From the office camera the top of the head is most of what you see, so a
// long-haired character read as bald. These measure the hair against the head box it is
// built around (y 1.89..2.51, x/z -0.31..0.31 in world terms; the hair group sits at the
// head's centre, so the head spans local y -0.31..0.31).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let THREE;
let buildHairstyle;

before(async () => {
  stubDom();
  THREE = await loadThree();
  ({ buildHairstyle } = await import('../src/agents/Agent.js'));
});

const bounds = (style) => new THREE.Box3().setFromObject(buildHairstyle(style, 0x332211));
const HEAD_TOP = 0.31;
const HEAD_SIDE = 0.31;

test('long hair covers the crown, where the camera sees the head', () => {
  const b = bounds('long');
  assert.ok(b.max.y > HEAD_TOP, `hair top ${b.max.y} should rise above the head top ${HEAD_TOP}`);
  assert.ok(b.min.x < -0.3 && b.max.x > 0.3, 'the crown spans the head from side to side');
});

test('long hair falls past the ears and down the back', () => {
  const b = bounds('long');
  assert.ok(b.min.x < -HEAD_SIDE && b.max.x > HEAD_SIDE, 'hair reaches past both sides of the head');
  assert.ok(b.min.y < 0, `hair should hang below the head centre, got ${b.min.y}`);
  assert.ok(b.min.z < -0.31, 'and behind it');
});

test('long hair is longer than the short crop', () => {
  assert.ok(bounds('long').min.y < bounds('short').min.y);
});
