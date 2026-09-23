// The keycard format: the whole address of an office, so the parser and the mint
// have to agree with themselves forever. These tests pin the folding rules the
// module header promises — accept what a human hand does to a code, never emit it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALPHABET, LENGTH, DEMO_KEYCARD,
  parseKeycard, isKeycard, foldPartial, mint, officePath, officeUrl,
} from '../src/office/keycard.js';

test('parseKeycard accepts every dialect of the same card', () => {
  for (const input of ['K7F2-9QBX', 'k7f2-9qbx', 'K7F29QBX', 'k7f2 9qbx', ' k7f2_9qbx ']) {
    assert.equal(parseKeycard(input), 'K7F2-9QBX', input);
  }
});

test('parseKeycard folds the confusable letters, as Crockford says to', () => {
  // I/L → 1, O → 0, U → V — accepted on input, never emitted.
  assert.equal(parseKeycard('KIFL-OQBU'), 'K1F1-0QBV');
});

test('parseKeycard refuses what is not a keycard', () => {
  assert.equal(parseKeycard('K7F2-9QB'), null);      // too short
  assert.equal(parseKeycard('K7F2-9QBXX'), null);    // too long
  assert.equal(parseKeycard('K7F2-9QB!'), null);     // not in the alphabet
  assert.equal(parseKeycard(''), null);
  assert.equal(parseKeycard(null), null);
  assert.equal(parseKeycard(42), null);
});

test('the demo keycard is a real keycard', () => {
  assert.equal(parseKeycard(DEMO_KEYCARD), DEMO_KEYCARD);
  assert.ok(isKeycard('test 0000'));
});

test('foldPartial keeps prefixes legible while typing', () => {
  assert.equal(foldPartial('k7f'), 'K7F');
  assert.equal(foldPartial('k7f2 9'), 'K7F2-9');
  assert.equal(foldPartial('k7f2!9qbx junk beyond'), 'K7F2-9QBX');
  assert.equal(foldPartial(''), '');
});

test('mint produces valid keycards and honours taken()', () => {
  const first = mint();
  assert.ok(isKeycard(first));

  // A taken() that refuses the first N candidates still gets an answer.
  let refusals = 3;
  const second = mint(() => refusals-- > 0);
  assert.ok(isKeycard(second));
});

test('mint gives up rather than spinning when everything is taken', () => {
  assert.throws(() => mint(() => true, { tries: 4 }), /could not mint/);
});

test('mint characters stay inside the alphabet', () => {
  const chars = mint().replace('-', '');
  assert.equal(chars.length, LENGTH);
  for (const c of chars) assert.ok(ALPHABET.includes(c), c);
});

test('officePath reads the keycard out of any office URL', () => {
  assert.deepEqual(officePath('/office/k7f2-9qbx'), { keycard: 'K7F2-9QBX', rest: '' });
  assert.deepEqual(
    officePath('/office/K7F29QBX/aop/v0/stream'),
    { keycard: 'K7F2-9QBX', rest: '/aop/v0/stream' },
  );
  // Note '/office/not-a-card' would actually resolve: the fold maps it onto the
  // eight-character N0TA-CARD. Genuinely invalid means wrong length or alphabet.
  assert.equal(officePath('/office/nope'), null);
  assert.equal(officePath('/elsewhere'), null);
  assert.equal(officePath(''), null);
});

test('officeUrl and officePath round-trip', () => {
  const card = mint();
  assert.equal(officePath(officeUrl(card))?.keycard, card);
});

test('a seed rides in the query string, and the address is still the keycard', () => {
  // Following a plan from docs/office-seeds.html opens a new office furnished
  // from that seed (see `adopt()` in src/office/office.js). The seed is not part
  // of the address, so the path still parses as the office it is, and dropping
  // the query leaves you in the same room.
  const card = mint();
  const url = officeUrl(card, { seed: 'slate orchard/2210' });
  assert.equal(url, `/office/${card}?seed=slate%20orchard%2F2210`);
  assert.equal(officePath(url.split('?')[0])?.keycard, card);
  // No seed, no query: an office URL is what it always was.
  assert.equal(officeUrl(card), `/office/${card}`);
  assert.equal(officeUrl(card, {}), `/office/${card}`);
});
