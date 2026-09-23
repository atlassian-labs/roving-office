#!/usr/bin/env node
//
// Build the page that asks a person which room is nicer.
//
// The renders come from `bin/scene-map.js --seed=…`; this only chooses the pairs
// and writes the page. Which pairs is the interesting part: a comparison between
// two rooms the current metric already scores twenty points apart teaches almost
// nothing, and one between two it scores identically teaches the most — so the
// pairs are drawn from both, near ones to find where the metric is blind and far
// ones to check that the labelling is working at all.
//
// Usage:
//   node bin/looks-ask.js --rooms=docs/images/looks2/rooms.json \
//     --dir=images/looks2 --key=roving-office.looks.v2 --pairs=60 --out=docs/looks2.html
//
import { readFileSync, writeFileSync } from 'node:fs';
import { options } from './lib/cli-args.js';
import { looksPage } from './lib/looks-page.js';

const { opt } = options(process.argv.slice(2));

const rooms = JSON.parse(readFileSync(opt('rooms', 'picks.json'), 'utf8'));
const out = opt('out', 'docs/looks.html');
const want = Number(opt('pairs', 30));
const dir = opt('dir', 'images/looks');
const key = opt('key', 'roving-office.looks.v1');

// Ordered by what the metric currently thinks, so "near" and "far" mean something.
const ranked = [...rooms].sort((a, b) => a.fitness - b.fitness);

/**
 * The pairs, and why these.
 *
 * Three kinds, and each one is asking a different question.
 *
 * **Near** — neighbours in the current ranking, where the metric has no opinion
 * worth having and a person's does all the work. This is where a blind spot shows
 * up.
 *
 * **Contrast** — two rooms the metric scores within a few points of each other
 * that differ on *one* trait under test. Round one could not ask these, and that
 * was its main failing: every one of its eighteen rooms came from a generator that
 * could not overlap rugs and could not stand a plant away from a wall, so when
 * both arrived there was nothing in the labels that could say whether they help.
 * A pair matched on score and split on one trait is the only pair that answers
 * that.
 *
 * **Far** — a room from the bottom against one from the top, which is partly a
 * calibration check: if the worst-scoring rooms do not lose those, the labelling
 * is not working and every conclusion drawn from it is worthless.
 */
const pairs = [];
const seen = new Set();
const add = (a, b) => {
  const key = [a, b].sort().join('|');
  if (a === b || seen.has(key)) return false;
  seen.add(key);
  // Which side a room appears on is alternated, so a habit of clicking left
  // cannot become a result.
  pairs.push(pairs.length % 2 ? [b, a] : [a, b]);
  return true;
};

// Whatever booleans the picker reported — so adding a trait to bin/looks-pick.js
// puts it into the contrast pairs without a second edit here.
const SKIP = new Set(['seed', 'name', 'desks', 'fitness']);
const TRAITS = Object.keys(ranked[0] ?? {})
  .filter((k) => !SKIP.has(k) && typeof ranked[0][k] === 'boolean');
const traited = TRAITS.length > 0 && ranked.every((r) => TRAITS.every((t) => t in r));

// Contrast first, because they are the scarce kind: there are only so many rooms
// matched on score and split on a trait, and the other two kinds can fill any
// number of slots.
if (traited) {
  for (const trait of TRAITS) {
    const other = TRAITS.filter((t) => t !== trait);
    for (let i = 0; i < ranked.length && pairs.length < want * 0.34; i += 1) {
      for (let j = i + 1; j < ranked.length && pairs.length < want * 0.34; j += 1) {
        const [a, b] = [ranked[i], ranked[j]];
        if (a[trait] === b[trait]) continue;
        if (other.some((t) => a[t] !== b[t])) continue;   // differ on one thing only
        if (Math.abs(a.fitness - b.fitness) > 0.06) continue;
        add(a.seed, b.seed);
      }
    }
  }
}
const contrasts = pairs.length;

for (let gap = 1; gap <= 6 && pairs.length < want * 0.8; gap += 1) {
  for (let i = 0; i + gap < ranked.length && pairs.length < want * 0.8; i += 1) {
    add(ranked[i].seed, ranked[i + gap].seed);
  }
}
const half = Math.floor(ranked.length / 2);
for (let i = 0; i < half && pairs.length < want; i += 1) {
  add(ranked[i].seed, ranked[ranked.length - 1 - i].seed);
}

writeFileSync(out, looksPage(rooms, pairs.slice(0, want), { dir, key }));
process.stdout.write(`  ${pairs.length} pairs over ${rooms.length} rooms`
  + ` (${contrasts} matched on score and split on one trait)`
  + ` — ${(pairs.length * 2 / rooms.length).toFixed(1)} games a room -> ${out}\n`);
