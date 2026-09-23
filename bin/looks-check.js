#!/usr/bin/env node
//
// Does the looks judge agree with the person who did the labelling?
//
// The acceptance test for `bin/lib/looks-judge.js`, and the only thing that makes
// a judge worth wiring into the fitness. It reads the frozen labelled rooms — the
// layouts as they were when somebody looked at them, not as the generator makes
// them today — fits a Bradley-Terry ranking from the pairwise answers, and reports
// the rank correlation for the judge and for each of its measures.
//
// Usage:
//   node bin/looks-check.js
//   node bin/looks-check.js --labels=docs/images/looks/labels.json
//
import { readFileSync } from 'node:fs';
import { options } from './lib/cli-args.js';
import { judge, LOOKS } from './lib/looks-judge.js';
import { ranking, spearman } from './lib/looks-fit.js';

const { value } = options(process.argv.slice(2));

const frozen = JSON.parse(readFileSync(value('rooms', 'docs/images/looks/rooms-frozen.json'), 'utf8'));
const labels = JSON.parse(readFileSync(value('labels', 'docs/images/looks/labels.json'), 'utf8')).answers;

const seeds = frozen.map((r) => r.seed);
const { strength, games } = ranking(labels, seeds);
const scored = frozen.map((r) => ({ seed: r.seed, name: r.name, ...judge(r.layout) }));
const yours = scored.map((r) => strength.get(r.seed));

process.stdout.write(`\n  ${frozen.length} labelled rooms, ${labels.length} pairs, `
  + `${((labels.length * 2) / frozen.length).toFixed(1)} games a room\n\n`);
process.stdout.write(`  ${'measure'.padEnd(11)} ${'agreement'.padStart(9)}\n`);
const overall = spearman(yours, scored.map((r) => r.total));
for (const m of LOOKS) {
  const v = spearman(yours, scored.map((r) => r.parts.find((p) => p.key === m.key).value));
  process.stdout.write(`  ${m.key.padEnd(11)} ${v.toFixed(3).padStart(9)}   ${m.note}\n`);
}
process.stdout.write(`  ${'JUDGE'.padEnd(11)} ${overall.toFixed(3).padStart(9)}\n\n`);

// Their ranking against the judge's, side by side, so a disagreement is a room
// somebody can look at rather than a number.
const byTheirs = [...scored].sort((a, b) => strength.get(b.seed) - strength.get(a.seed));
process.stdout.write(`  ${'room'.padEnd(9)} ${'games'.padStart(5)} ${'yours'.padStart(7)} ${'judge'.padStart(6)}   name\n`);
for (const r of byTheirs) {
  process.stdout.write(`  ${r.seed.padEnd(9)} ${String(games.get(r.seed) ?? 0).padStart(5)} `
    + `${strength.get(r.seed).toFixed(2).padStart(7)} ${r.total.toFixed(3).padStart(6)}   ${r.name}\n`);
}
process.stdout.write('\n');
