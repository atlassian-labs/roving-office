import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHROME_LEVELS,
  applyKnobs,
  isHostMessage,
  knobsFromMessage,
  knobsFromSearch,
  startHostApi,
} from '../src/host.js';

test('reads the knobs it knows out of a query string', () => {
  const knobs = knobsFromSearch('?chrome=minimal&frame=fill&zoom=1.8&season=winter');
  assert.deepEqual(knobs, {
    chrome: 'minimal',
    frame: 'fill',
    zoom: 1.8,
    season: 'winter',
  });
});

test('an explicit zoom beats a frame mode that computes one', () => {
  // Sending both means "fill, but actually this much". Applying zoom second is
  // what makes the explicit number win.
  const order = [];
  applyKnobs(
    { frame: 'fill', zoom: 1.4 },
    {
      chrome: () => {},
      frame: (v) => order.push(['frame', v]),
      zoom: (v) => order.push(['zoom', v]),
      look: () => {},
    },
  );
  assert.deepEqual(order, [['frame', 'fill'], ['zoom', 1.4]]);
});

test('rejects a frame mode it does not have', () => {
  assert.deepEqual(knobsFromSearch('?frame=cover'), {});
});

test('leaves the office alone rather than defaulting a typo', () => {
  // The failure this guards against is a host reframing the room because it
  // misspelled a value. Absent is not the same as wrong, and both mean "do
  // nothing" here.
  assert.deepEqual(knobsFromSearch('?chrome=minimalish&zoom=nope'), {});
  assert.deepEqual(knobsFromSearch('?edit=1&keycard=TEST-0000'), {});
  assert.deepEqual(knobsFromSearch(''), {});
});

test('rejects a zoom that would blank the frame', () => {
  for (const bad of ['0', '-1', 'Infinity', 'NaN']) {
    assert.deepEqual(knobsFromSearch(`?zoom=${bad}`), {}, `zoom=${bad}`);
  }
});

test('an hour has to be an hour', () => {
  assert.deepEqual(knobsFromSearch('?hour=0'), { hour: 0 });
  assert.deepEqual(knobsFromSearch('?hour=23.5'), { hour: 23.5 });
  assert.deepEqual(knobsFromSearch('?hour=24'), {});
  assert.deepEqual(knobsFromSearch('?hour=-1'), {});
});

test('the URL and a message reach the same knobs', () => {
  // The two paths must not diverge: a host that sets one and then sends the
  // other should not get two different offices.
  assert.deepEqual(
    knobsFromMessage({ chrome: 'none', zoom: 1.8, hour: 9 }),
    knobsFromSearch('?chrome=none&zoom=1.8&hour=9'),
  );
});

test('a message from anywhere but our embedder is ignored', () => {
  const view = { parent: { name: 'embedder' } };
  const good = { source: view.parent, data: { type: 'office:set', chrome: 'none' } };

  assert.equal(isHostMessage(good, view), true);

  // Some other window that happens to know the keycard.
  assert.equal(
    isHostMessage({ source: { name: 'stranger' }, data: good.data }, view),
    false,
  );
  // Our embedder, but not addressed to us.
  assert.equal(
    isHostMessage({ source: view.parent, data: { type: 'something-else' } }, view),
    false,
  );
  assert.equal(isHostMessage({ source: view.parent, data: null }, view), false);
});

test('a standalone office takes no orders at all', () => {
  // `parent === self` means nobody framed this page. Accepting commands here
  // would let any opener drive an office it merely found.
  const view = {};
  view.parent = view;
  assert.equal(
    isHostMessage({ source: view, data: { type: 'office:set', chrome: 'none' } }, view),
    false,
  );
});

test('applies look as one call, not one per key', () => {
  // Season and building each rebuild the scene, so two calls would rebuild it
  // twice for a single message.
  const calls = [];
  applyKnobs(
    { season: 'winter', building: 'simple', hour: 9 },
    {
      chrome: () => calls.push('chrome'),
      frame: () => calls.push('frame'),
      zoom: () => calls.push('zoom'),
      look: (look) => calls.push(['look', look]),
    },
  );
  assert.deepEqual(calls, [['look', { season: 'winter', building: 'simple', hour: 9 }]]);
});

test('touches only what was asked for', () => {
  const calls = [];
  applyKnobs(
    { chrome: 'minimal' },
    {
      chrome: (v) => calls.push(['chrome', v]),
      frame: () => calls.push('frame'),
      zoom: () => calls.push('zoom'),
      look: () => calls.push('look'),
    },
  );
  assert.deepEqual(calls, [['chrome', 'minimal']]);
});

test('applies the URL before anything is sent, and announces itself', () => {
  const listeners = [];
  const posted = [];
  const parent = { postMessage: (msg, origin) => posted.push([msg, origin]) };
  const view = {
    parent,
    location: { search: '?chrome=none' },
    addEventListener: (type, fn) => listeners.push([type, fn]),
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex(([t, f]) => t === type && f === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };

  const applied = [];
  const stop = startHostApi({
    apply: { chrome: (v) => applied.push(v), frame: () => {}, zoom: () => {}, look: () => {} },
    view,
  });

  assert.deepEqual(applied, ['none'], 'the URL lands before the first frame');
  assert.equal(posted.length, 1);
  assert.equal(posted[0][0].type, 'office:ready');
  assert.deepEqual(posted[0][0].chrome, CHROME_LEVELS);

  // And a later message is honoured.
  const [, onMessage] = listeners[0];
  onMessage({ source: parent, data: { type: 'office:set', chrome: 'full' } });
  assert.deepEqual(applied, ['none', 'full']);

  stop();
  assert.equal(listeners.length, 0, 'stops listening so a torn-down office leaks nothing');
});

test('a standalone office announces nothing', () => {
  const view = { location: { search: '' }, addEventListener() {}, removeEventListener() {} };
  view.parent = view;
  // No parent to postMessage to; the guard is that this does not throw.
  assert.doesNotThrow(() =>
    startHostApi({ apply: { chrome() {}, frame() {}, zoom() {}, look() {} }, view }),
  );
});
