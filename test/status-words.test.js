// How the office says a state out loud — once.
//
// A status line is drawn beside a coloured lozenge and in front of the job title,
// so the family word is both implied by the specific one and paid for in width:
// "Working · writing · Simplify the booking flow" wrapped onto a second line to
// say "working" and "writing" in the same breath. These are the assertions that
// keep it to one word, here and in the pill that summarises several feeds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_GROUPS, STATUS_LIST, statusLabel } from '../src/config.js';
import { summarise } from '../src/data/feeds.js';

test('a status is said in one word, and it is the specific one', () => {
  assert.equal(statusLabel('working'), 'Writing');
  assert.equal(statusLabel('researching'), 'Researching');
  assert.equal(statusLabel('waiting'), 'Waiting');
  assert.equal(statusLabel('error'), 'Error');
  assert.equal(statusLabel('resting'), 'Resting');
});

test('idle uses its family name and movement keeps its specific labels', () => {
  assert.equal(statusLabel('idle'), 'Idle');       // bare: the heading names it
  assert.equal(statusLabel('walking'), 'Walking');
  assert.equal(statusLabel('dancing'), 'Dancing');
  const moving = STATUS_GROUPS.find((group) => group.label === 'Moving');
  assert.deepEqual(moving.statuses.map((s) => s.key), ['walking', 'dancing']);
});

test('a label too short to stand alone gets a longer word for it', () => {
  assert.equal(statusLabel('drinking'), 'Getting a drink');
});

test('the legend and the roster say the same word for the same dot', () => {
  // The legend's rows are the same labels, capitalised by CSS under the family
  // heading, so a status whose standalone word is invented rather than derived is
  // the office reading two ways in one panel. Exactly one is allowed to, and it
  // expands its label rather than replacing it.
  for (const group of STATUS_GROUPS) {
    for (const s of group.statuses) {
      if (s.bare || group.statuses.length === 1) continue;
      const said = statusLabel(s.key);
      if (said.toLowerCase() === s.label) continue;
      assert.equal(s.key, 'drinking', `${s.key} says "${said}" but the legend says "${s.label}"`);
      assert.ok(said.toLowerCase().includes(s.label), said);
    }
  }
});

test('no status says its own family back to itself', () => {
  for (const group of STATUS_GROUPS) {
    for (const s of group.statuses) {
      const said = statusLabel(s.key);
      assert.ok(!said.includes('·'), `${s.key} pairs two words: ${said}`);
      if (said !== group.label) {
        assert.ok(
          !said.toLowerCase().startsWith(group.label.toLowerCase()),
          `${s.key} leads with its family: ${said}`
        );
      }
    }
  }
});

test('every status has words, and a word we do not know is passed through', () => {
  for (const key of STATUS_LIST) assert.ok(statusLabel(key).length > 0, key);
  // A harness inventing a status should show up as that status, not as a blank.
  assert.equal(statusLabel('brooding'), 'brooding');
  assert.equal(statusLabel(null), '');
});

test('the source pill counts feeds without repeating the state beside it', () => {
  const live = { state: 'live', detail: null };
  const offline = { state: 'offline', detail: null };
  // `live · 2 of 3`, not `live · 2 of 3 live`.
  assert.deepEqual(summarise([live, live, offline]), { state: 'live', detail: '2 of 3' });
  // With no live feed the word is not the state's, so it stays and says what is counted.
  assert.deepEqual(
    summarise([{ state: 'connecting', detail: null }, offline]),
    { state: 'connecting', detail: '0 of 2 live' }
  );
  // One feed still says exactly what that feed said: `live · simulated`.
  assert.deepEqual(summarise([{ state: 'live', detail: 'simulated' }]),
    { state: 'live', detail: 'simulated' });
});
