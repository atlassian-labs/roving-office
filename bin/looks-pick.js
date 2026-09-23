#!/usr/bin/env node
//
// Choose the rooms for a labelling round, and freeze them.
//
// A labelling round is expensive in the only currency that matters here — a
// person's attention — so which rooms get shown decides how much is learnt. Two
// rules, and the second one is the reason this file exists rather than a `sort`
// in a shell pipeline.
//
// **Spread across what the metric currently believes.** A set of rooms the metric
// already scores within a hair of each other teaches nothing about calibration; a
// set spread evenly across its range lets the ranking be checked end to end.
//
// **Stratified on the thing being tested.** The first round asked about eighteen
// rooms from a generator that could not overlap rugs and could not put a plant
// anywhere but a wall — so when those capabilities arrived there was no evidence
// either way about whether they help, and the measures written for them could not
// be validated on anything. Half of a round's rooms should exhibit whatever was
// just built and half should not, or the round cannot answer the question it was
// run for.
//
// The layouts are written out **frozen**, before any picture is taken. A label is
// attached to a room, and a seed's room is whatever today's generator says it is
// (see the note at the top of bin/lib/looks-judge.js) — so the blob is the record
// and the seed is only a filename.
//
// Usage:
//   node bin/office-fitness.js --prefix=look --seeds=160 --minutes=3 --json > $TMPDIR/look.json
//   node bin/looks-pick.js --from=$TMPDIR/look.json --rooms=16 --out=docs/images/looks2
//
//   --from=<file>   the metric's --json output for the candidate set
//   --rooms=<n>     how many to pick (default 16)
//   --split=<a,b>   which traits to stratify on (default divider,gridded)
//   --out=<dir>     where rooms.json and rooms-frozen.json go
//
// Every trait is *reported*; only the ones named by `--split` are balanced. Two is
// the practical limit — four buckets over forty rooms is ten rooms a bucket, and
// three traits would be five. Choose the two open questions, not the two most
// interesting facts.
//
// And check the trait actually *varies* before splitting on it. The first attempt
// at round three balanced on `gridded` and came back with one of its four buckets
// empty and eight rooms missing, because 256 of 260 candidate offices are gridded:
// desks go down on a lattice with quarter-turn facings, so "not aligned" is not a
// room this generator makes. A trait that is 98% true is not a split, it is a
// constant with a rounding error.
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOM } from '../src/config.js';
import { FURNITURE_KINDS, worldExtent } from '../src/layout.js';
import { generateOffice } from '../src/plan/index.js';
import { CANDIDATES } from './lib/looks-candidates.js';
import { options } from './lib/cli-args.js';
import { stubDom, loadThree } from './lib/headless-scene.js';

stubDom();
await loadThree();
const { roomOf, LOOKS } = await import('./lib/looks-judge.js');

const { opt } = options(process.argv.slice(2));

const OPTS = {
  from: opt('from', null),
  rooms: Number(opt('rooms', 16)),
  split: String(opt('split', 'divider,tight')).split(','),
  out: opt('out', join('docs', 'images', 'looks2')),
};
if (!OPTS.from) {
  process.stderr.write('  --from=<metric json> is required — see the usage note\n');
  process.exit(2);
}

/** A rug's world-space rectangle, which is where the overlaps are. */
function rugRect(rug) {
  const kind = FURNITURE_KINDS.rug;
  const w = worldExtent(rug.facing ?? 0, kind.hw, kind.hd);
  return {
    x0: rug.x - w.hw, x1: rug.x + w.hw, z0: rug.z - w.hd, z1: rug.z + w.hd,
  };
}

const measure = (key) => CANDIDATES.find((c) => c.key === key).of;

/**
 * What this room is an example of.
 *
 * One flag per open question, read off the geometry rather than off the
 * generator's intentions — a rug that was *meant* to join and missed by a foot is
 * not an example of joining.
 *
 * `gridded` and `boxy` are thresholded from the candidate measures themselves
 * rather than reimplemented, so the trait a round is balanced on is the same thing
 * the round is then used to test.
 */
function traits(blob, seen) {
  const rugs = Object.values(blob.furniture ?? {})
    .filter((f) => f.kind === 'rug').map(rugRect);
  return {
    joined: rugs.some((a, i) => rugs.some((b, j) => j !== i
      && a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.z0 < b.z1 - 0.5 && a.z1 > b.z0 + 0.5)),
    divider: Object.values(blob.plants ?? {}).some(
      (p) => Math.min(p.x, p.z, ROOM.W - p.x, ROOM.D - p.z) > 4,
    ),
    gridded: measure('aligned')(seen) > 0.9,
    boxy: measure('compact')(seen) > 0.97,
    // How tight the seating group is. `together` is the measure whose agreement
    // swung hardest between the rounds — −0.16 then +0.41, pooling to +0.11 — so
    // it is either the second most useful thing here or nothing at all, and one
    // more round decides which.
    tight: LOOKS.find((m) => m.key === 'together').of(seen) > 0.65,
  };
}

const source = JSON.parse(readFileSync(OPTS.from, 'utf8'));
const rows = source.rows.map((r) => {
  const office = generateOffice(r.seed);
  return {
    seed: r.seed,
    name: office.name,
    desks: r.desks,
    fitness: Math.round((0.4 * r.plan + 0.35 * r.flow + 0.25 * r.looks) * 10000) / 10000,
    blob: office.layout,
    ...traits(office.layout, roomOf(office.layout)),
  };
});

// One bucket per combination of the split traits, so the round can separate them
// instead of only ever seeing them together.
const bucket = (r) => OPTS.split
  .map((t) => (r[t] ? t[0].toUpperCase() : t[0])).join('');
const buckets = new Map();
for (const r of rows) {
  if (!buckets.has(bucket(r))) buckets.set(bucket(r), []);
  buckets.get(bucket(r)).push(r);
}
// Within a bucket, evenly across the metric's range rather than the best of it:
// a labelling set of only good rooms cannot tell a good room from a bad one.
for (const list of buckets.values()) list.sort((a, b) => a.fitness - b.fitness);
const spread = (list, n) => (list.length <= n ? list
  : Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]));

const share = Math.ceil(OPTS.rooms / buckets.size);
const picks = [];
for (const [key, list] of [...buckets.entries()].sort()) {
  const take = spread(list, Math.min(share, list.length));
  process.stderr.write(`  ${key}  ${String(list.length).padStart(3)} candidates, ${take.length} picked\n`);
  picks.push(...take);
}
picks.sort((a, b) => a.fitness - b.fitness);
const chosen = spread(picks, Math.min(OPTS.rooms, picks.length));

mkdirSync(OPTS.out, { recursive: true });
writeFileSync(join(OPTS.out, 'rooms.json'), `${JSON.stringify(
  chosen.map(({ blob: _blob, ...rest }) => rest), null, 1,
)}\n`);
// The shape bin/looks-check.js reads: seed, name and the layout itself, one
// entry per room. Round one's file is the same, so a round's labels can be
// checked with the same command whichever round they came from.
writeFileSync(join(OPTS.out, 'rooms-frozen.json'), `${JSON.stringify(
  chosen.map((r) => ({ seed: r.seed, name: r.name, layout: r.blob })),
)}\n`);

const TRAITS = ['joined', 'divider', 'gridded', 'boxy', 'tight'];
process.stderr.write(`\n  ${chosen.length} rooms · fitness ${chosen[0].fitness.toFixed(3)}`
  + `–${chosen.at(-1).fitness.toFixed(3)} · `
  + `${TRAITS.map((t) => `${t} ${chosen.filter((r) => r[t]).length}`).join(' · ')}\n`);
for (const r of chosen) {
  process.stderr.write(`    ${r.seed.padEnd(9)} ${r.fitness.toFixed(3)}  ${bucket(r)}  ${String(r.desks).padStart(2)} desks  ${r.name}\n`);
}
process.stderr.write(`\n  frozen in ${join(OPTS.out, 'rooms-frozen.json')} — render these seeds next\n`);
