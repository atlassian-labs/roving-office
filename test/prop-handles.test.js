// Every station's prop, reachable by the station that owns it.
//
// `props.<kind>` holds whichever instance was built last. That was invisible while every
// kind was a singleton and becomes a dead prop the moment one is not — an agent who
// walked to the second inbox would take a box off the first — so `props.byStation` maps
// station id to handle and the behaviours resolve through it.
//
// This exists because the first version of that index was wrong in a way nothing else
// could see. `buildStationProp` returns early for any kind with a `mount` hook, so the
// mailbox and the coat stand never reached the registration line: `byStation.mailbox`
// was undefined, and `_propAt(mailbox)?.deliver()` silently did nothing — the flag never
// moved on a delivery. Optional chaining swallowed it, and the rest of the suite could
// not catch it because those tests stub the props rather than building them.
//
// So this builds the real ones.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let THREE, buildProps, layout;

before(async () => {
  stubDom();
  THREE = await loadThree();
  ({ buildProps } = await import('../src/scene/props.js'));
  layout = await import('../src/layout.js');
});

beforeEach(() => layout.resetLayout());

const build = () => buildProps(new THREE.Group());

test('every station that registers a handle is reachable by its own id', () => {
  const handles = build();
  for (const station of Object.values(layout.STATIONS)) {
    if (!layout.STATION_KINDS[station.kind]) continue;
    // A kind that registers under its own name must also be findable by station.
    if (!handles[station.kind]) continue;
    assert.equal(
      handles.byStation[station.id],
      handles[station.kind],
      `${station.id} is not reachable through byStation`,
    );
  }
});

test('the mailbox and the coat stand are in the index, mount hook and all', () => {
  // Named, because these are the two the first version missed — both build through
  // `mount`, which returns before the general registration.
  const handles = build();
  assert.equal(typeof handles.byStation.mailbox?.deliver, 'function',
    'a delivery calls mailbox.deliver() through byStation; it has to be there');
  assert.equal(typeof handles.byStation.coatStand?.addCoat, 'function');
  assert.equal(typeof handles.byStation.inbox?.takePackage, 'function');
});

test('the research stations are in the index, both of them', () => {
  // The bookshelf used to be the documented exception to the test above: it registered
  // into `props.bookshelves` and never under its own kind, so there was no shelf in the
  // index at all. Harmless while the only route to one was a helper that read the list;
  // a liability the moment a lookup picked a station by *role* and then asked the index
  // what was standing there. So both are in it now.
  const handles = build();
  assert.equal(typeof handles.byStation.bookshelf?.takeBook, 'function',
    'a graph lookup calls takeBook() through byStation; it has to be there');
  assert.equal(typeof handles.byStation.telescope?.scan, 'function',
    'a web lookup calls scan() through byStation');

  // The globe is the one thing that is deliberately *not* in the index, because it is
  // not a station — it is a second prop mounted on one, and `_globeAt` reads the pair.
  const entry = handles.bookshelves.find((b) => b.id === 'bookshelf');
  assert.ok(entry?.globe?.spin, 'the shelf and its globe are still registered together');
});

test('two telescopes are two tubes', () => {
  // The by-kind fallback in `buildStationProp` copies `handles[kind]`, which is
  // whichever was built last — so a mount that leaves the index to it hands every
  // instance the same prop. `max` is Infinity here, so that is a room somebody can make.
  const second = layout.addStation('telescope', { x: 8.6, z: 1.35 });
  assert.ok(second, 'the room would not take a second telescope');
  layout.reviseLayout();

  const handles = build();
  const a = handles.byStation.telescope;
  const b = handles.byStation[second.id];
  assert.ok(a && b, 'both telescopes should have a prop');
  assert.notEqual(a, b, 'two stations sharing one tube is the bug the index prevents');

  a.scan(2);
  assert.equal(a.scanning, true);
  assert.equal(b.scanning, false, 'sweeping one tube moved the other');
  assert.equal(handles.telescopes.length, 2, 'both need to be in the frame loop');
});

test('a second station of a kind gets its own prop, not a shared one', () => {
  // The whole reason the index exists. Two inboxes are two stacks of boxes, and taking
  // one off the second must not shrink the first.
  const second = layout.addStation('inbox', { x: 12, z: 17 });
  assert.ok(second, 'the room would not take a second inbox');
  layout.reviseLayout();

  const handles = build();
  const a = handles.byStation.inbox;
  const b = handles.byStation[second.id];
  assert.ok(a && b, 'both inboxes should have a prop');
  assert.notEqual(a, b, 'two stations sharing one handle is the bug this index prevents');

  a.takePackage();
  assert.equal(a.collected, 1);
  assert.equal(b.collected, 0, 'taking from one stack moved the other');
});

test('a station that leaves the room takes its handle with it', () => {
  const second = layout.addStation('inbox', { x: 12, z: 17 });
  layout.reviseLayout();
  const handles = build();
  assert.ok(handles.byStation[second.id]);

  assert.ok(layout.removeObject(`station:${second.id}`));
  layout.reviseLayout();
  handles.sync();
  assert.equal(handles.byStation[second.id], undefined,
    'a stale handle is a prop the agent layer can still talk to and nobody can see');
});
