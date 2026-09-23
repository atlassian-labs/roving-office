// Renaming a scene from the switcher.
//
// A scene could be added and deleted but never renamed, so an office of three rooms
// fed the same way was three rows called "Test Data 2" and "Test Data 3". The name is
// stored on the record and has been all along (`updateScene` in lib/office-store.cjs);
// what was missing was any way to say one.
//
// The menu is built imperatively against `document`, so this drives it against the
// stubbed page in test/lib/dom.js — the same trick as test/panel-close.test.js — rather
// than standing a browser up to prove that Enter keeps a name and Escape does not.
//
// Every event here is fired by hand at the element carrying the handler under test, so
// the page keeps none of `document`'s own listeners: shutting the menu from a click
// elsewhere is not what any of these are about.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stubPage } from './lib/dom.js';

const { byId, document } = stubPage({ pathname: '/office/TEST-0000' });

const { createSceneSwitcher } = await import('../src/ui/switcher.js');

/** A switcher over two Test Data scenes, and everything it was asked to do. */
function mount() {
  const host = document.createElement('div');
  byId.set('scene-switcher', host);
  const renames = [];
  const deletes = [];
  const switcher = createSceneSwitcher({
    scenes: [
      { id: 'a', name: 'Test Data', building: 'Tower', floorName: 'Level 12', sources: ['test-data'] },
      { id: 'b', name: 'Test Data 2', building: 'Brownstone', floorName: 'Second floor', sources: ['test-data'] },
    ],
    initialId: 'a',
    onChange: () => {},
    onRename: (id, name) => renames.push([id, name]),
    onDelete: (id) => deletes.push(id),
  });
  const menu = host.children.find((c) => c.className === 'switcher-menu');
  const rowFor = (id) => menu.children.find((c) => c.dataset?.id === id);
  return { host, switcher, menu, rowFor, renames, deletes };
}

/** Open the field on a row and type into it. */
function typeInto(row, text) {
  row.querySelector('.switcher-rename').fire('click');
  const field = row.querySelector('.switcher-rename-field');
  assert.ok(field, 'the pencil should turn the row into a field');
  field.value = text;
  return field;
}

test('every row offers a pencil, saying which scene it renames', () => {
  const { rowFor } = mount();
  const pen = rowFor('b').querySelector('.switcher-rename');
  assert.ok(pen, 'the row should carry a rename button');
  assert.equal(pen.getAttribute('aria-label'), 'Rename scene Test Data 2');
});

test('the field opens on the name the row is showing, and Enter keeps the new one', () => {
  const { rowFor, renames } = mount();
  const row = rowFor('b');
  row.querySelector('.switcher-rename').fire('click');
  const field = row.querySelector('.switcher-rename-field');
  assert.equal(field.value, 'Test Data 2', 'editing beats typing a name from nothing');
  assert.ok(field.focused, 'the field should be ready to type into');
  assert.ok(row.classList.contains('renaming'));

  field.value = 'The war room';
  field.fire('keydown', { key: 'Enter' });
  assert.deepEqual(renames, [['b', 'The war room']]);
  assert.equal(row.querySelector('.switcher-rename-field'), null, 'the field goes when it is done');
  assert.ok(!row.classList.contains('renaming'));
});

test('Escape puts the name back, and renames nothing', () => {
  const { rowFor, renames } = mount();
  const row = rowFor('a');
  const field = typeInto(row, 'Half a thought');
  field.fire('keydown', { key: 'Escape' });
  assert.deepEqual(renames, [], 'a cancelled edit is not a rename');
  assert.equal(row.querySelector('.switcher-rename-field'), null);
});

test('clicking away keeps what was typed', () => {
  const { rowFor, renames } = mount();
  const field = typeInto(rowFor('a'), '  Reception  ');
  field.fire('blur');
  assert.deepEqual(renames, [['a', 'Reception']], 'and the surrounding space is not part of the name');
});

test('an emptied field asks for the derived name back, rather than being refused', () => {
  const { rowFor, renames } = mount();
  const field = typeInto(rowFor('b'), '   ');
  field.fire('keydown', { key: 'Enter' });
  assert.deepEqual(renames, [['b', '']], 'the office reads an empty name as "no name of its own"');
});

test('a name left alone is not stored, so a derived name goes on being derived', () => {
  const { rowFor, renames } = mount();
  const field = typeInto(rowFor('b'), 'Test Data 2');
  field.fire('keydown', { key: 'Enter' });
  assert.deepEqual(renames, []);
});

test('renaming disarms a trash can, so the next Enter cannot delete', () => {
  const { rowFor, deletes } = mount();
  const row = rowFor('a');
  row.querySelector('.switcher-trash').fire('click');
  assert.ok(row.classList.contains('arming'), 'the first click arms it');
  typeInto(row, 'Somewhere else');
  assert.ok(!row.classList.contains('arming'), 'opening the field should stand the bin down');
  assert.deepEqual(deletes, []);
});

test('a rebuilt list closes any field that was open in the old rows', () => {
  const { switcher, rowFor, menu } = mount();
  typeInto(rowFor('a'), 'Mid-edit');
  switcher.setScenes([
    { id: 'a', name: 'Renamed elsewhere', building: 'Tower', floorName: 'Level 12', sources: ['test-data'] },
    { id: 'b', name: 'Test Data 2', building: 'Brownstone', floorName: 'Second floor', sources: ['test-data'] },
  ]);
  assert.equal(menu.querySelector('.switcher-rename-field'), null);
  const row = menu.children.find((c) => c.dataset?.id === 'a');
  assert.equal(row.querySelector('.switcher-item-name').textContent, 'Renamed elsewhere');
});

test('a switcher given no onRename grows no pencils', () => {
  const host = document.createElement('div');
  byId.set('scene-switcher', host);
  createSceneSwitcher({
    scenes: [{ id: 'a', name: 'Test Data', building: 'Tower', floorName: 'Level 12', sources: ['test-data'] }],
    initialId: 'a',
    onChange: () => {},
  });
  const menu = host.children.find((c) => c.className === 'switcher-menu');
  assert.equal(menu.querySelector('.switcher-rename'), null);
});
