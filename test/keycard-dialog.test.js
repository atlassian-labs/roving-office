import assert from 'node:assert/strict';
import { test } from 'node:test';
import { all, stubPage } from './lib/dom.js';

// The keycard dialog's shape, and its third door.
//
// Two claims worth a test rather than an eye. The first is the **reading order**: every
// section says what it is, then what it is for, then offers the control — and every one
// of those descriptions used to sit at the foot of its section instead, so a reader met
// the button before the sentence explaining it. That is the sort of thing that reverts
// itself the next time somebody appends a note.
//
// The second is that the keycard field in "Your offices" is **reception's field and not a
// second one**. Both accept a keycard in any dialect a human hand produces and both
// refuse the same strings with the same sentence, because both are src/ui/keycard-field.js
// — and a dialog that accepted a keycard reception rejected would be a bug invisible from
// either file, since each would look right on its own.

const { byId, document, window } = stubPage({ pathname: '/office/K7F2-9QBX' });
byId.set('keycard-dialog', document.createElement('div'));

const { createKeycardDialog } = await import('../src/ui/keycard-dialog.js');
const { NOT_A_KEYCARD } = await import('../src/ui/keycard-field.js');

/** A dialog in an office this browser owns, with nothing refused and nothing asked. */
function openDialog({ isOwner = () => true, reserved = false } = {}) {
  const host = byId.get('keycard-dialog');
  host.children = [];
  const dialog = createKeycardDialog({
    keycard: 'K7F2-9QBX',
    isOwner,
    onPasscode: async () => ({ ok: true }),
    onClose: async () => ({ ok: true }),
    onOpenAnother: async () => ({ ok: true }),
  });
  // `window.location.href = …` is how the shared field leaves, so the stub's location is
  // where "we went to another office" is read back from.
  window.location.href = '';
  dialog.show({ keycard: 'K7F2-9QBX', viewers: 1, reserved });
  return { dialog, host, card: host.children[0] };
}

/** Every section in the card, as its heading and what follows it. */
function sections(card) {
  return all(card)
    .filter((el) => el.classList?.contains('kd-section'))
    .map((el) => ({
      title: el.children[0]?.textContent,
      hidden: el.hidden,
      wide: el.classList.contains('kd-wide'),
      after: el.children.slice(1).map((c) => c.className),
      /** The first note under the heading that is actually on screen, if there is one. */
      standing: el.children.slice(1).find((c) => c.classList?.contains('kd-note') && !c.hidden),
    }));
}

const findByText = (card, words) => all(card).find((el) => el.textContent === words);

test('every section says what it is, then what it is for, then offers the control', () => {
  const { card } = openDialog();
  const named = Object.fromEntries(sections(card).map((s) => [s.title, s]));

  assert.deepEqual(Object.keys(named), ['This office', 'Who is here', 'Passcode', 'Close', 'Your offices']);
  for (const [title, section] of Object.entries(named)) {
    assert.equal(section.after[0], 'kd-note', `${title}: the description comes first`);
  }
});

// The claim worth its own test, because the DOM order above was already right while the
// rendering was not: Close's only note used to be the armed-state confirmation, so its
// slot under the heading was empty in the resting state — beside Passcode, which has one
// — and it was reported as a description that had gone missing. `hidden`, not position,
// is what says whether a reader sees one.
test('and every section shows one in the resting state, not only in the DOM', () => {
  const { card } = openDialog();
  for (const section of sections(card)) {
    assert.ok(section.standing, `${section.title}: a description is on screen at rest`);
    assert.ok(section.standing.textContent.length > 20, `${section.title}: and it says something`);
  }
});

test('the key ring spans both columns of the grid; the other four are cells', () => {
  const { card } = openDialog();
  const wide = sections(card).filter((s) => s.wide).map((s) => s.title);
  assert.deepEqual(wide, ['Your offices'], 'only Your offices runs under both columns');
});

test('what closing costs is said on arming, above the buttons — and not before', () => {
  const { card } = openDialog();
  const shut = sections(card).find((s) => s.title === 'Close');
  const confirm = all(card).find((el) => el.textContent.startsWith('Closing takes the link back'));

  // Two texts: the calm one stands, the consequences arrive. Unhiding the second in the
  // resting state would make the calmest state of the dialog read as a warning.
  assert.equal(shut.after[0], 'kd-note', 'the standing description first');
  assert.equal(shut.after[1], 'kd-note kd-confirm', 'then the confirmation, above the row');
  assert.equal(shut.after[2], 'kd-row');
  assert.notEqual(shut.standing, confirm, 'the standing one is not the confirmation');
  assert.equal(confirm.hidden, true);

  findByText(card, 'Close this office').click();
  assert.equal(confirm.hidden, false);
  assert.equal(shut.standing.hidden, false, 'and the standing one does not go away');
  assert.ok(findByText(card, 'Yes, close it for good'));

  // The non-obvious part, verbatim in substance: the keycard still resolves, to an empty
  // room, and whoever kept your link is told nothing.
  assert.match(confirm.textContent, /brand-new empty office at this keycard, and is told nothing/);
  assert.match(confirm.textContent, /cannot be undone/);
});

test('the button that cuts an office says it cuts a new one', () => {
  const { card } = openDialog();
  assert.ok(findByText(card, 'Open a new office'), 'reception’s wording, in both places');
  assert.equal(findByText(card, 'Open another office'), undefined);
});

test('a keycard typed in any dialect opens that office', () => {
  const { card } = openDialog();
  const field = card.querySelector('.kd-keycard-field');
  const enter = findByText(card, 'Enter');

  // Nowhere to go until there is a whole keycard, and the field says how far off it is.
  field.value = 'test 00';
  field.fire('input');
  assert.equal(field.value, 'TEST-00');
  assert.equal(enter.disabled, true);
  assert.equal(card.querySelector('.kd-hint').textContent, '2 to go');

  // Lower case, a space for the hyphen, and the two letters Crockford folds — which is
  // what a keycard read off a screenshot arrives as.
  field.value = 'test 000o';
  field.fire('input');
  assert.equal(field.value, 'TEST-0000');
  assert.equal(enter.disabled, false);

  enter.click();
  assert.equal(window.location.href, '/office/TEST-0000');
});

test('a string that is not a keycard is refused in reception’s words, and goes nowhere', () => {
  const { card } = openDialog();
  const field = card.querySelector('.kd-keycard-field');
  const hint = card.querySelector('.kd-hint');

  field.value = 'ZZZ';
  field.fire('keydown', { key: 'Enter' });

  assert.equal(hint.textContent, NOT_A_KEYCARD);
  assert.ok(hint.classList.contains('bad'));
  assert.equal(window.location.href, '', 'and we are still standing in this office');
});

test('opening the dialog again leaves no half-typed keycard in it', () => {
  const { card, dialog } = openDialog();
  const field = card.querySelector('.kd-keycard-field');

  field.value = 'TEST-00';
  field.fire('input');
  dialog.hide();

  assert.equal(field.value, '');
  assert.equal(card.querySelector('.kd-hint').textContent, '');
  assert.equal(findByText(card, 'Enter').disabled, true);
});

test('the demo office keeps the key ring and loses the two controls it has not got', () => {
  const { card } = openDialog({ reserved: true });
  const shown = sections(card).filter((s) => !s.hidden).map((s) => s.title);

  assert.deepEqual(shown, ['This office', 'Who is here', 'Your offices']);
  // Which is the whole of why no cell is placed by CSS: with Passcode and Close hidden
  // the key ring closes up behind them rather than leaving two empty grid cells.
  assert.ok(findByText(card, 'Open a new office'), 'and the way to one you can lock');
});

test('a visitor to somebody else’s office can still walk into their own', () => {
  const { card } = openDialog({ isOwner: () => false });
  const field = card.querySelector('.kd-keycard-field');

  // The two owner controls are disabled here. The third door is not one of them: it
  // needs no credential, because walking into an office never did.
  assert.equal(findByText(card, 'Set a passcode').disabled, true);
  assert.equal(findByText(card, 'Close this office').disabled, true);
  assert.equal(findByText(card, 'Open a new office').disabled, false);

  field.value = 'TEST-0000';
  field.fire('input');
  assert.equal(field.disabled, false);
  findByText(card, 'Enter').click();
  assert.equal(window.location.href, '/office/TEST-0000');
});
