#!/usr/bin/env node
//
// Candidate measures, against every labelling round at once.
//
// The judge (bin/lib/looks-judge.js) holds the measures that have earnt a weight.
// This holds the ones that have not, and it exists because of what round two did
// to round one's conclusions: agreement fell from +0.53 to +0.16 and the ranking
// of the measures almost exactly inverted — `together` went from −0.16 to +0.41,
// `amenity` from +0.18 to −0.16. Some of that is real learning and some of it is
// two rounds of sixteen rooms disagreeing with each other by chance, and there is
// only one way to tell the difference: **a measure that agrees on both rounds is a
// measure, and one that agrees on one is a coin.**
//
// The two rounds are also two different *populations* — round two's rooms come
// from a generator that can overlap rugs and stand a plant between two banks, and
// round one's cannot — so a measure can weaken honestly by being satisfied
// everywhere. `zoned` fell from +0.33 to +0.17 while nearly every room acquired a
// rug under its groups, which is what success looks like from the inside. Read the
// two columns together, not the average.
//
// Usage:
//   node bin/looks-explore.js
//   node bin/looks-explore.js --round=docs/images/looks2
//
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { options } from './lib/cli-args.js';
import { stubDom, loadThree } from './lib/headless-scene.js';
import {
  pearson, ranking, ranks, spearman, weightsFor,
} from './lib/looks-fit.js';
import { clamp01 } from '../src/measure.js';

stubDom();
await loadThree();
const { LOOKS, judge, roomOf } = await import('./lib/looks-judge.js');
const { CANDIDATES } = await import('./lib/looks-candidates.js');

const rounds = options(process.argv.slice(2)).all('round');
const DIRS = rounds.length ? rounds : ['docs/images/looks', 'docs/images/looks2', 'docs/images/looks3'];

const loaded = DIRS.map((dir) => {
  const frozen = JSON.parse(readFileSync(join(dir, 'rooms-frozen.json'), 'utf8'));
  const labels = JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8')).answers;
  const { strength } = ranking(labels, frozen.map((r) => r.seed));
  return {
    dir,
    rooms: frozen,
    pairs: labels.length,
    yours: frozen.map((r) => strength.get(r.seed)),
    // Surveyed once per room and kept, because applying a layout is the slow part
    // and every candidate wants the same geometry.
    seen: frozen.map((r) => roomOf(r.layout)),
    judged: frozen.map((r) => judge(r.layout).total),
  };
});

const name = (dir) => dir.split('/').pop();

/**
 * The two rounds pooled, and why it is worth the trouble.
 *
 * Spearman's standard error is about 1/sqrt(n−1) where n is the number of
 * *rooms* — pairs buy a better ranking of the rooms you have, not more rooms. At
 * sixteen that is ±0.26, so a single round cannot tell +0.3 from 0, and reading
 * one round's column as a result is how a judge ends up fitted to sampling error.
 * Pooling the rounds gets n to 34 and the error to ±0.17, which is still not much
 * and is the best evidence there is.
 *
 * The strengths cannot simply be concatenated: each round is its own
 * Bradley-Terry fit with no pairs crossing between them, so the scales are
 * unrelated.
 *
 * **And neither can the measure**, which is the trap. Standardising only the
 * strengths leaves any difference between the rounds' *measure* distributions free
 * to act as correlation: round two's rooms are systematically less gridded than
 * round one's, and pooling that way gave `aligned` a pooled −0.30 when neither
 * round on its own was past −0.04 and −0.37. So both sides are ranked and
 * standardised **within** a round before pooling, which makes this a pooled
 * within-round correlation and nothing else.
 */
const zed = (list) => {
  const m = list.reduce((a, b) => a + b, 0) / list.length;
  const sd = Math.sqrt(list.reduce((n, v) => n + (v - m) ** 2, 0) / list.length) || 1;
  return list.map((v) => (v - m) / sd);
};
const within = (list) => zed(ranks(list));
const pooledYours = loaded.flatMap((r) => within(r.yours));
const pooledRooms = loaded.reduce((n, r) => n + r.rooms.length, 0);

/** Pearson over the pooled within-round z-scored ranks — a pooled Spearman. */
function pooled(valuesPerRound) {
  return pearson(pooledYours, loaded.flatMap((r, i) => within(valuesPerRound[i])));
}
const err = (n) => 1 / Math.sqrt(n - 1);

const head = `${loaded.map((r) => name(r.dir).padStart(9)).join(' ')}    pooled`;
process.stdout.write(`\n  ${loaded.map((r) => `${name(r.dir)}: ${r.rooms.length} rooms, ${r.pairs} pairs, ±${err(r.rooms.length).toFixed(2)}`).join('   ')}\n`);
process.stdout.write(`  pooled: ${pooledRooms} rooms, ±${err(pooledRooms).toFixed(2)} — anything inside that is noise\n\n`);
process.stdout.write(`  ${'measure'.padEnd(13)} ${head}   note\n`);

/** One row: a measure's rank agreement in each round, and pooled. */
function row(key, of, note) {
  const per = loaded.map((r) => r.seen.map((s) => of(s)));
  const cells = loaded.map((r, i) => spearman(r.yours, per[i]));
  const all = pooled(per);
  const flip = cells.length > 1 && Math.min(...cells) < -0.05 && Math.max(...cells) > 0.05;
  // A star is the only claim worth making from this much data: pooled agreement
  // clear of its own noise floor.
  const real = Math.abs(all) > err(pooledRooms);
  process.stdout.write(`  ${key.padEnd(13)} ${cells.map((v) => v.toFixed(3).padStart(9)).join(' ')}`
    + ` ${all.toFixed(3).padStart(9)}${real ? ' *' : flip ? ' !' : '  '} ${note}\n`);
  return { cells, all, real };
}

process.stdout.write('\n  in the judge\n');
for (const m of LOOKS) row(`${m.key}(w${m.weight})`, m.of, m.note);

process.stdout.write('\n  candidates\n');
const scores = new Map();
for (const c of CANDIDATES) scores.set(c.key, row(c.key, c.of, c.note));

process.stdout.write('\n  the judge as it stands\n');
const total = loaded.map((r) => spearman(r.yours, r.judged));
const totalAll = pooled(loaded.map((r) => r.judged));
process.stdout.write(`  ${'JUDGE'.padEnd(13)} ${total.map((v) => v.toFixed(3).padStart(9)).join(' ')} ${totalAll.toFixed(3).padStart(9)}\n`);

// `*` is pooled agreement outside the noise floor, `!` is a measure that changed
// its mind between rounds — and the second is what a person would otherwise
// promote on one round's evidence and regret.
const starred = [...scores].filter(([, v]) => v.real && v.all > 0).map(([k]) => k);
const flipped = [...scores].filter(([, v]) => !v.real
  && v.cells.some((x) => x < -0.05) && v.cells.some((x) => x > 0.05)).map(([k]) => k);
process.stdout.write(`\n  clear of the noise floor: ${starred.length ? starred.join(', ') : 'none'}\n`);
process.stdout.write(`  changed its mind:         ${flipped.length ? flipped.join(', ') : 'none'}\n\n`);

// ---------------------------------------------------------------------------
// Leave one room out.
//
// The judge's weights were chosen by looking at the pooled column above, so the
// pooled agreement of the judge is not an estimate of anything — it is the number
// that was optimised. This is the honest version: for each of the 34 rooms, derive
// the weights by `weightsFor` from the *other* 33, score the held-out room with
// them, and correlate the 34 held-out scores with the rankings.
//
// It is the difference between "these weights fit these rooms" and "this rule
// produces a judge that works on a room it has not seen".
const flat = loaded.flatMap((r, i) => r.seen.map((seen, j) => ({
  round: i, seen, yours: r.yours[j],
})));
// One entry per key, judge first. A promoted measure should have been deleted
// from the candidates list, and this makes a slip in that housekeeping harmless
// rather than a sign error in the result.
// Measures declared `collinear` with one already in the judge are left out of the
// weighting entirely — see `planted` in looks-judge.js. The rule scores each
// measure on its own and cannot see two of them reading the same variable, so the
// second one is the same evidence counted twice; excluding it here rather than
// hand-zeroing its weight is what keeps the cross-validated figure a measurement
// of the procedure in use.
const ALL = [...new Map(
  [...LOOKS, ...CANDIDATES].filter((m) => !m.collinear)
    .map((m) => [m.key, { key: m.key, of: m.of }]),
).values()];
const value = (m, seen) => clamp01(m.of(seen));

/** Pooled within-round agreement for one measure, over a subset of the rooms. */
function agreementOver(rows, of) {
  const byRound = new Map();
  for (const row of rows) {
    if (!byRound.has(row.round)) byRound.set(row.round, []);
    byRound.get(row.round).push(row);
  }
  const xs = [];
  const ys = [];
  for (const list of byRound.values()) {
    if (list.length < 4) continue;
    xs.push(...within(list.map((r) => r.yours)));
    ys.push(...within(list.map((r) => of(r.seen))));
  }
  return pearson(xs, ys);
}

const held = [];
for (let out = 0; out < flat.length; out += 1) {
  const train = flat.filter((_, i) => i !== out);
  const agree = new Map(ALL.map((m) => [m.key, agreementOver(train, (s) => value(m, s))]));
  const w = weightsFor(agree);
  const total = [...w.values()].reduce((a, b) => a + b, 0);
  held.push(total
    ? ALL.reduce((n, m) => n + value(m, flat[out].seen) * w.get(m.key), 0) / total
    : 0);
}
const byRoundHeld = [];
let at = 0;
for (const r of loaded) { byRoundHeld.push(held.slice(at, at + r.rooms.length)); at += r.rooms.length; }
process.stdout.write('  leave-one-room-out, weights refitted without the held-out room\n');
process.stdout.write(`  ${'CV JUDGE'.padEnd(13)} ${byRoundHeld.map(
  (h, i) => spearman(loaded[i].yours, h).toFixed(3).padStart(9),
).join(' ')} ${pooled(byRoundHeld).toFixed(3).padStart(9)}\n`);
// What the rule settles on with everything in — the weights the judge should carry.
const full = new Map(ALL.map((m) => [m.key, agreementOver(flat, (s) => value(m, s))]));
const settled = weightsFor(full);
process.stdout.write(`\n  the rule's weights on all ${flat.length} rooms, x10 for legibility:\n   `
  + `${[...settled].filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${(v * 10).toFixed(1)}`).join(', ')}\n\n`);
