// The Random button: the editor's way into the office generator.
//
// One button and one listener, and the reason it is worth a test is the reason
// `kit-menu.test.js` gives for its own: every bug this class of control has had
// has been wiring rather than logic. What is pinned here is that the button
// exists in the row a person will look for it in, that pressing it asks the
// editor for a room, and that what comes back is *said* — the name and the seed,
// because the seed is the only way back to a room you liked.
//
// Driven against the stubbed page in test/lib/dom.js rather than in a browser, on the
// same terms as panel-close.test.js: there is no DOM library here, and a check that
// flakes on the harness is worse than no check. The panel's own click-outside listener
// stays out of it — `document` keeps none — because a press of Random is aimed at the
// button, and what a press elsewhere does to the layout picker is not what is pinned
// here.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { all, stubPage } from './lib/dom.js';

let createEditorPanel;
let byId, document;

before(async () => {
  ({ byId, document } = stubPage());
  ({ createEditorPanel } = await import('../src/editor/panel.js'));
});

let rolled;

/**
 * A fresh panel on a fresh page.
 *
 * The strip makes its own `#editor-panel` host when the markup has none — which a
 * stub page always has none of — and hangs it on the body, so the body is where a
 * lookup starts. Fresh each time, or a test would find the previous panel's
 * buttons alongside its own.
 */
function mount(onRoll) {
  document.body = document.createElement('body');
  byId.clear();
  return createEditorPanel({ onRoll });
}

beforeEach(() => {
  rolled = [];
  mount(() => {
    rolled.push(true);
    return { ok: true, name: 'The Amber Observatory', seed: 'brass-lantern-0007' };
  });
});

/** A button in the panel, by the words on it. */
function labelled(words) {
  return all(document.body)
    .find((n) => n.tagName === 'BUTTON' && n.textContent === words);
}

/** Everything the panel currently says, as one string. */
function said() {
  return all(document.body).map((n) => n.textContent).join(' | ');
}

test('Random sits in the Layout row, with the layout\'s own buttons', () => {
  const roll = labelled('Random');
  assert.ok(roll, 'no Random button in the panel');
  const row = all(document.body)
    .find((n) => n.className?.includes('editor-layout-row'));
  assert.ok(row, 'no layout row');
  assert.deepEqual(row.children.map((c) => c.textContent),
    ['Copy', 'Paste', 'Download', 'Reset', 'Random']);
});

test('pressing it asks for a room, and says which one arrived', () => {
  labelled('Random').click();
  assert.equal(rolled.length, 1);

  // The name and the seed both, because a generated room is only reproducible if
  // its seed was on screen when you saw it.
  assert.match(said(), /The Amber Observatory/);
  assert.match(said(), /brass-lantern-0007/);
});

test('the picker calls the room what the generator called it', () => {
  // A generated office is an edit nobody has saved, so by the letter of the
  // modes it is `Default *` — and "Default" is exactly what it is not. The name
  // the plan arrived with wins, and the `*` stays because it is still unsaved.
  const panel = mount(() => ({ ok: true, name: 'The Amber Observatory', seed: 'brass-lantern-0007' }));
  panel.setLayoutState({
    layouts: [],
    mode: {
      kind: 'edited', parent: 'default', called: 'The Amber Observatory', seed: 'brass-lantern-0007',
    },
  });
  const trigger = all(document.body)
    .find((n) => n.className?.includes('layout-picker-current'));
  assert.equal(trigger.textContent, 'The Amber Observatory *');

  // And an edit of the authored room is still called Default, because it is.
  panel.setLayoutState({ layouts: [], mode: { kind: 'edited', parent: 'default' } });
  assert.equal(trigger.textContent, 'Default *');
});

test('a generator that finds nothing is reported rather than mimed', () => {
  mount(() => ({}));
  labelled('Random').click();
  assert.match(said(), /Could not generate an office/);
});
