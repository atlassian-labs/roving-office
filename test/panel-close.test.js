import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stubPage } from './lib/dom.js';

// The panels are built imperatively against `document`, and there is no DOM library
// here — the scene modules stub what they need (see bin/lib/headless-scene.js), so the
// chrome does too, out of test/lib/dom.js. The page keeps none of `document`'s own
// listeners and answers nothing about layout, because neither is what is being proved:
// every strip grows a way out, and clicking it calls the panel's own and stops there.
const { byId, document } = stubPage();

const { closeButton } = await import('../src/ui/dom.js');
const { createStrip } = await import('../src/ui/strip.js');
const { register, press } = await import('../src/ui/shortcuts.js');

/** The × a panel carries, if it carries one. */
const crossIn = (host) => host.children.find((c) => c.className?.includes('panel-close'));

test('a close button says what it closes, not merely "Close"', () => {
  const cross = closeButton('Scene panel', () => {});
  assert.equal(cross.className, 'panel-close');
  assert.equal(cross.getAttribute('aria-label'), 'Close Scene panel');
  assert.equal(cross.title, 'Close Scene panel');
  assert.equal(cross.type, 'button');
});

test('clicking it closes the panel, and does not reach the room behind', () => {
  let closed = 0;
  const cross = closeButton('Scene panel', () => { closed += 1; });
  const stopped = cross.click();
  assert.equal(closed, 1);
  assert.ok(stopped, 'the click should not fall through to the canvas');
});

test('every strip given a way out grows one', () => {
  byId.set('scene-panel', document.createElement('div'));
  let closed = 0;
  const { host } = createStrip({ id: 'scene-panel', title: 'Scene', onClose: () => { closed += 1; } });

  const cross = crossIn(host);
  assert.ok(cross, 'the strip should carry a close button');
  assert.equal(cross.getAttribute('aria-label'), 'Close Scene panel');
  cross.click();
  assert.equal(closed, 1);
});

test('a strip with nowhere to go draws no ×', () => {
  byId.set('dev-panel', document.createElement('div'));
  const { host } = createStrip({ id: 'dev-panel', title: 'Developer' });
  assert.equal(crossIn(host), undefined);
});

// The roster's × fires the binding `A` fires. Going through the registry is the point:
// one implementation, so the key and the button cannot come to mean different things.
test('press fires a registered binding, and says when there was none', () => {
  let toggled = 0;
  register({ id: 'roster-test', keys: ['A'], label: 'Show/hide roster', onPress: () => { toggled += 1; } });
  assert.equal(press('roster-test'), true);
  assert.equal(toggled, 1);
  assert.equal(press('nothing-registered-under-this'), false);
});
