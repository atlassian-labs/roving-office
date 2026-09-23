// The saved-layouts shelf: names are the identity, the name rides in the blob,
// and a browser that refuses storage just has an empty shelf. localStorage is
// shimmed, since Node has no window and the module only reaches for
// window.localStorage through optional chaining.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  },
};

const {
  listLayouts, getLayout, saveLayout, renameLayout, deleteLayout, sameLayout, matchingLayout,
} = await import('../src/editor/layouts.js');

const blob = (x) => ({ layout: 3, complete: true, desks: { 'desk-1': { x, z: 8, facing: 0 } } });

beforeEach(() => store.clear());

test('a saved layout comes back by name, carrying its name in the blob', () => {
  const stored = saveLayout('Cosy Corner', blob(12));
  assert.equal(stored.name, 'Cosy Corner');
  assert.equal(stored.blob.name, 'Cosy Corner', 'an Export of this layout arrives already called something');
  assert.equal(getLayout('Cosy Corner').blob.desks['desk-1'].x, 12);
});

test('saving under an existing name replaces it, keeping the shelf order', () => {
  saveLayout('A', blob(1));
  saveLayout('B', blob(2));
  saveLayout('A', blob(3));
  assert.deepEqual(listLayouts().map((l) => l.name), ['A', 'B'], 'replaced in place, not moved to the end');
  assert.equal(getLayout('A').blob.desks['desk-1'].x, 3);
});

test('a blank name saves nothing', () => {
  assert.equal(saveLayout('   ', blob(1)), null);
  assert.equal(saveLayout('', blob(1)), null);
  assert.deepEqual(listLayouts(), []);
});

test('rename moves the name and the blob\'s copy of it', () => {
  saveLayout('Old', blob(1));
  assert.equal(renameLayout('Old', 'New'), true);
  assert.equal(getLayout('Old'), null);
  assert.equal(getLayout('New').blob.name, 'New');
});

test('rename refuses a taken name — it must never swallow a layout', () => {
  saveLayout('A', blob(1));
  saveLayout('B', blob(2));
  assert.equal(renameLayout('A', 'B'), false);
  assert.equal(getLayout('A').blob.desks['desk-1'].x, 1, 'nothing moved');
});

test('delete forgets; deleting the absent is not an error', () => {
  saveLayout('A', blob(1));
  deleteLayout('A');
  deleteLayout('A');
  assert.deepEqual(listLayouts(), []);
});

test('sameLayout ignores the name — a label is not part of the plan', () => {
  const a = { ...blob(5), name: 'Cosy Corner' };
  const b = blob(5);
  assert.equal(sameLayout(a, b), true);
  assert.equal(sameLayout(a, blob(6)), false);
});

test('matchingLayout finds which stored plan the room currently is', () => {
  saveLayout('One', blob(1));
  saveLayout('Two', blob(2));
  assert.equal(matchingLayout(blob(2)), 'Two');
  assert.equal(matchingLayout({ ...blob(2), name: 'whatever it claims' }), 'Two');
  assert.equal(matchingLayout(blob(9)), null, 'a modified room matches nothing — which is what lights Save up');
});

test('a browser that refuses storage has an empty shelf, never an error', async () => {
  const broken = {
    getItem: () => { throw new Error('private mode'); },
    setItem: () => { throw new Error('private mode'); },
  };
  const real = globalThis.window.localStorage;
  globalThis.window.localStorage = broken;
  try {
    assert.deepEqual(listLayouts(), []);
    saveLayout('A', blob(1));            // swallowed, not thrown
    assert.deepEqual(listLayouts(), []);
  } finally {
    globalThis.window.localStorage = real;
  }
});

test('garbage in storage reads as an empty shelf', () => {
  store.set('roving-office.layouts.v1', '{not json');
  assert.deepEqual(listLayouts(), []);
  store.set('roving-office.layouts.v1', '{"an":"object"}');
  assert.deepEqual(listLayouts(), []);
  store.set('roving-office.layouts.v1', '[{"name":1},{"name":"ok","blob":{}}]');
  assert.deepEqual(listLayouts().map((l) => l.name), ['ok'], 'the readable entries survive');
});
