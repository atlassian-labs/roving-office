// What Download calls the file it hands the browser.
//
// The rest of Download is three lines of DOM and a blob URL, but the name is a
// judgement, and it is the one part that can go wrong quietly: a name a filesystem
// will not take fails the save with nothing said, and a name that is the same every
// time turns a folder of layouts into `layout (4).json`. So it is a pure function,
// stated here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutFileName } from '../src/editor/panel.js';

test('a named layout is called by its name', () => {
  assert.equal(layoutFileName({ kind: 'named', name: 'Cosy Corner' }), 'cosy-corner.json');
});

test('an edit of a named layout keeps that name — it is still that plan', () => {
  assert.equal(layoutFileName({ kind: 'edited', parent: 'Open Plan' }), 'open-plan.json');
});

test('the Default has no name, and is not given a made-up one', () => {
  assert.equal(layoutFileName({ kind: 'default', parent: 'default' }), 'office-layout.json');
  assert.equal(layoutFileName({ kind: 'edited', parent: 'default' }), 'office-layout.json');
});

test('nothing at all still names a file', () => {
  // Download is reachable before any layout state has arrived, and a button that
  // throws is worse than a generically-named file.
  assert.equal(layoutFileName(), 'office-layout.json');
  assert.equal(layoutFileName({}), 'office-layout.json');
});

test('a name a filesystem would refuse is slugged, not passed through', () => {
  // The whole reason this is a function: slashes make directories, colons and
  // question marks are refused outright on some platforms, and either way the
  // save fails silently.
  assert.equal(layoutFileName({ kind: 'named', name: 'Q3 / final?' }), 'q3-final.json');
  assert.equal(layoutFileName({ kind: 'named', name: 'Mike\u2019s room: v2' }), 'mike-s-room-v2.json');
  assert.equal(layoutFileName({ kind: 'named', name: '  spaced  out  ' }), 'spaced-out.json');
});

test('a name with nothing sluggable in it falls back rather than becoming ".json"', () => {
  // A layout called "???" is a layout somebody named; a file called ".json" is a
  // hidden file with no name, which is not what they asked for.
  assert.equal(layoutFileName({ kind: 'named', name: '???' }), 'office-layout.json');
  assert.equal(layoutFileName({ kind: 'named', name: '\u4e2d\u6587' }), 'office-layout.json');
});

test('every answer ends .json', () => {
  for (const mode of [
    { kind: 'named', name: 'A' }, { kind: 'default' }, {}, { kind: 'edited', parent: 'B' },
  ]) assert.match(layoutFileName(mode), /\.json$/);
});
