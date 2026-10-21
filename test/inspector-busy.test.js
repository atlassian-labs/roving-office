// The open inspector redraws once a second so its time log keeps ticking, and the
// redraw rebuilds its buttons. A click that straddled a redraw landed on a button that
// was gone, so "Follow along" was ignored now and then. The redraw now waits while the
// pointer is over the card or focus is inside it; this tests that decision.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectorBusy } from '../src/ui/overlay.js';

const card = ({ hover = false, holds = null } = {}) => ({
  matches: (sel) => sel === ':hover' && hover,
  contains: (el) => el != null && el === holds,
});

test('the inspector redraw waits under the pointer and with focus inside', () => {
  const button = {};
  assert.equal(inspectorBusy(card({ hover: true }), { activeElement: null }), true);
  assert.equal(inspectorBusy(card({ holds: button }), { activeElement: button }), true);
  assert.equal(inspectorBusy(card(), { activeElement: {} }), false, 'focus elsewhere does not hold the clock');
  assert.equal(inspectorBusy(null, {}), false, 'no inspector, nothing to protect');
});
