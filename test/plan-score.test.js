// The scorecard: how good is a generated office, as against whether it works.
//
// The two questions are deliberately separate (see src/plan/score.js), and this
// file is about the second one. What it can usefully assert is not a number — a
// score is a judgement and judgements move — but the *shape* of the answer:
//
//   * every measure is a fraction, so a card can be read as bars;
//   * the measures actually measure something, checked by building rooms that
//     ought to score badly on one and confirming that they do;
//   * across a sweep the floor and the median hold, which is what turns "the
//     layouts feel worse since that change" into a failing test.
//
// The thresholds below are set *under* what the generator currently manages, on
// purpose. They are a floor, not a target: a change that improves the median is
// welcome and silent, and a change that drops it through the floor is a change
// somebody has to defend.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateOffice } from '../src/plan/index.js';
import { brief } from '../src/plan/brief.js';
import { furnish } from '../src/plan/furnish.js';
import { score, SCORE_KEYS } from '../src/plan/score.js';

const SWEEP = 240;
const seeds = Array.from({ length: SWEEP }, (_, i) => `sweep-${i}`);

/** The nth percentile of a list of numbers. */
function percentile(list, f) {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * f))];
}

test('a scorecard is six fractions and a total', () => {
  const office = generateOffice('slate-orchard-2210');
  const card = office.report.score;
  assert.deepEqual(card.parts.map((p) => p.key), SCORE_KEYS);
  for (const part of card.parts) {
    assert.ok(part.value >= 0 && part.value <= 1, `${part.key} is ${part.value}`);
    assert.ok(part.weight > 0);
    assert.ok(part.note.length > 8, `${part.key} does not say what it measures`);
  }
  assert.ok(card.total > 0 && card.total <= 1);
  // The total is the weighted mean of its parts and nothing else, so a card can
  // be argued with by arguing with a part.
  const weighted = card.parts.reduce((n, p) => n + p.value * p.weight, 0)
    / card.parts.reduce((n, p) => n + p.weight, 0);
  assert.ok(Math.abs(card.total - weighted) < 0.002);
});

test('the same seed always scores the same', () => {
  assert.deepEqual(
    generateOffice('brass-lantern-0007').report.score,
    generateOffice('brass-lantern-0007').report.score,
  );
});

test('a measure that cannot fail is not a measure', () => {
  // Each of these builds a room that ought to be bad at one thing, and checks
  // that the card says so. Without this the scorecard could be six constants.

  // `seated`: ask for far more desks than 26 by 20 can hold, and refuse the
  // retry its chance to trim the brief by going straight to `furnish`.
  const packed = brief('sweep-3');
  const crowded = { ...furnish({ ...packed, desks: 24, teams: [6, 6, 6, 6] }), fit: null };
  crowded.fit = { asked: 24, got: crowded.desks.length, banks: 0 };
  assert.ok(score(crowded).parts.find((p) => p.key === 'seated').value < 0.8,
    'a floor that seated a third of the brief scored well on seating it');

  // `errands`: a room whose only intake and dispatch is a printer in one corner
  // and whose desks are elsewhere has long errands by construction. Measured
  // against the same room with the post *and* a printer, which cannot be worse.
  const one = generateOffice('sweep-101').report.score;
  const many = generateOffice('sweep-77').report.score;
  assert.notEqual(one.parts.find((p) => p.key === 'errands').value,
    many.parts.find((p) => p.key === 'errands').value);
});

test('the sweep holds its floor', () => {
  const totals = [];
  const worst = { seed: null, total: 1 };
  for (const seed of seeds) {
    const office = generateOffice(seed);
    const total = office.report.score.total;
    totals.push(total);
    if (total < worst.total) Object.assign(worst, { seed, total });
  }

  // Nothing below this is a room worth showing anybody. Measured at 0.63 when
  // this was written, on a distribution whose median is 0.84.
  assert.ok(worst.total >= 0.55,
    `${worst.seed} scored ${worst.total.toFixed(2)}, which is below the floor`);
  assert.ok(percentile(totals, 0.5) >= 0.78,
    `the median office scores ${percentile(totals, 0.5).toFixed(2)}`);
  assert.ok(percentile(totals, 0.1) >= 0.68,
    `a tenth of offices score below ${percentile(totals, 0.1).toFixed(2)}`);
});

test('no measure is allowed to be a constant', () => {
  // The defence against a *deleted* measure, which is a different failure from a
  // measure going down and is not caught by anything else here.
  //
  // The layout work needed the scorecard to hold a floor for its tuning loop, and
  // the obvious attack on a floor is not to breach it but to stop measuring: a
  // `quiet` that always returns 1 is comfortably above its floor for ever, and the
  // composite fitness went *up* by 0.002 when that exact edit was planted. So the
  // shape of the card is not enough — every measure has to actually respond to
  // the room, and a measure with no variance across sixty different offices is
  // one that has stopped looking.
  const spread = new Map();
  for (const seed of seeds.slice(0, 60)) {
    for (const part of generateOffice(seed).report.score.parts) {
      if (!spread.has(part.key)) spread.set(part.key, new Set());
      spread.get(part.key).add(Math.round(part.value * 1000));
    }
  }
  for (const [key, values] of spread) {
    assert.ok(values.size > 1,
      `${key} scored the same on all sixty offices — it has stopped measuring anything`);
  }
});

test('teams sit together, and the card is how we know', () => {
  // The measure that earned its keep: it found benches whose within-bank pitch
  // was wider than the gap between banks, so the desk nearest yours was in the
  // next row and belonged to somebody else's team (see PITCH in furnish.js).
  // Nineteen rooms in four hundred were affected; the fix took it to six.
  let poor = 0;
  for (const seed of seeds) {
    const teams = generateOffice(seed).report.score.parts.find((p) => p.key === 'teams');
    if (teams.value < 0.6) poor += 1;
  }
  assert.ok(poor <= SWEEP * 0.05, `${poor} of ${SWEEP} rooms split their teams up`);
});
