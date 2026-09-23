// Two tabs, and the two different questions "who is this" can mean.
//
// A browser copies `sessionStorage` into a tab duplicated from another, so anything
// read from there is shared between the two tabs somebody actually has open. That is
// harmless for a headcount and wrong for telling two tabs apart — and the scene stream
// needs the second, because it skips whoever made a change so that no tab is told
// about its own edit. When one id was doing both jobs, two duplicated tabs shared it,
// each was skipped as the author of the other's edit, and both fell silent.
//
// A tab here is one evaluation of the module, which is what a tab is: the same stubbed
// storage underneath, a fresh module instance on top.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** One `sessionStorage`, shared by every "tab" — the duplication being modelled. */
const shared = new Map();

globalThis.window = {
  location: { pathname: '/office/TEST-0000/' },
  sessionStorage: {
    getItem: (k) => (shared.has(k) ? shared.get(k) : null),
    setItem: (k, v) => shared.set(k, String(v)),
  },
  localStorage: { getItem: () => null, setItem: () => {} },
};

/** Load the module again, as a duplicated tab would. */
async function openTab(n) {
  return import(`../src/office/office.js?tab=${n}`);
}

test('two tabs duplicated from one are told apart, and still counted as one room', async () => {
  const a = await openTab(1);
  const b = await openTab(2);

  // Presence: the shared id is the point. A reload is the same person, and so — as far
  // as a headcount is concerned — is a tab duplicated from another.
  assert.equal(a.viewerId, b.viewerId, 'sessionStorage is shared, and for counting that is fine');

  // Suppression: these must differ, or each tab is skipped as the author of the other's
  // edit and neither ever hears about a change. This is the assertion that once failed.
  assert.notEqual(a.connectionId, b.connectionId, 'two tabs must be distinguishable');
  assert.match(a.connectionId, /^[a-z0-9]{4,}$/);
});

test('the id that tells tabs apart is never written to storage', async () => {
  const before = new Set(shared.keys());
  const tab = await openTab(3);
  for (const [key, value] of shared) {
    assert.notEqual(value, tab.connectionId, `connectionId leaked into storage as "${key}"`);
  }
  // The viewer id may be created on first sight; nothing else may appear.
  const added = [...shared.keys()].filter((k) => !before.has(k));
  assert.deepEqual(added, [], 'a third tab adds no new storage keys');
});
