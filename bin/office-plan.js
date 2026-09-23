#!/usr/bin/env node
//
// Office layouts on the command line: generated from a seed, or read from a file.
//
// One seed, printed as a plan you can read in a terminal — or a sweep of
// thousands, which is how the thing is actually held to its promise: every seed
// has to produce a room that works, and the only way to know is to generate a
// lot of them and check every one.
//
// It needs no browser and no three.js: `src/plan/` reaches config.js, layout.js
// and the editor's placement arithmetic and nothing else, all of which are plain
// modules. That is not an accident — a generator you cannot run in a shell is a
// generator nobody sweeps.
//
// Usage:
//   node bin/office-plan.js [seed]            one office, as a plan view
//   node bin/office-plan.js [seed] --json     its layout blob, for piping about
//   node bin/office-plan.js --from=cosy.json  any layout .json, drawn the same way
//   node bin/office-plan.js --from=authored   the room as authored in src/layout.js
//   node bin/office-plan.js --sweep=2000      generate that many and check them
//   node bin/office-plan.js --gallery=24 --out=docs/office-seeds.html
//   node bin/office-plan.js --from=a.json --from=b.json --gallery --out=plans.html
//
//   --seed=<text>    the same as the positional argument
//   --quiet          the sweep's summary only, no per-seed lines
//
import { writeFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ROOM } from '../src/config.js';
import { applyLayout, resetLayout } from '../src/layout.js';
import { generateOffice } from '../src/plan/index.js';
import { survey } from '../src/plan/survey.js';
import { options } from './lib/cli-args.js';
import { plansPage, GLYPHS, KEY_ROWS, glyphFor } from './lib/office-plan-svg.js';

const { opt, all, positional } = options(process.argv.slice(2));

/**
 * A room to draw: its plan, what to call it, and whatever else is known about it.
 *
 * Two producers, one shape. A seed brings a name, a reason, a score and the
 * streets it reserved; a file brings whatever its blob happens to say. Both are
 * *surveyed* — the plan is read back off the room the layout makes rather than
 * out of the generator's notes — so the drawing is of the layout itself either
 * way (see src/plan/survey.js).
 */
function fromSeed(seed) {
  const office = generateOffice(seed);
  resetLayout();
  applyLayout(office.layout);
  return {
    plan: survey({ ways: [office.report.plan.street, office.report.plan.avenue] }),
    name: office.name,
    seed: office.seed,
    reason: office.reason,
    score: office.report.score,
    meta: `${office.look.building} · ${office.look.season} · ${office.report.traits.desks} desks · ${office.report.brief.typology}`,
    office,
  };
}

/**
 * A layout somebody else made.
 *
 * `authored` is the room as written in src/layout.js, which is worth being able
 * to draw for the same reason the generated ones are: it is the plan every other
 * plan is a departure from.
 */
function fromFile(path) {
  resetLayout();
  let blob = null;
  if (path !== 'authored') {
    blob = JSON.parse(readFileSync(path, 'utf8'));
    if (!applyLayout(blob)) throw new Error(`${path} is not a layout this office can read`);
  }
  const plan = survey();
  const desks = plan.rects.filter((r) => r.key.startsWith('desk:') && r.role === 'prop').length;
  return {
    plan,
    name: blob?.name ?? (path === 'authored' ? 'The authored room' : basename(path)),
    seed: typeof blob?.seed === 'string' ? blob.seed : null,
    reason: typeof blob?.reason === 'string' ? blob.reason : null,
    score: null,
    meta: `${path} · ${desks} desks`,
  };
}

/**
 * The plan as characters: half a unit per column, one per row, so the aspect is
 * about right in a terminal where a character is twice as tall as it is wide.
 */
function draw(plan, approaches) {
  const cols = ROOM.W * 2;
  const rows = ROOM.D;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  const put = (rect, ch, over = false) => {
    for (let cz = Math.max(0, Math.floor(rect.z0)); cz < Math.min(rows, Math.ceil(rect.z1)); cz += 1) {
      for (let cx = Math.max(0, Math.floor(rect.x0 * 2)); cx < Math.min(cols, Math.ceil(rect.x1 * 2)); cx += 1) {
        if (over || grid[cz][cx] === ' ') grid[cz][cx] = ch;
      }
    }
  };

  // Aisles first and faintly, then the standing room, then the props over both:
  // the props are what the plan is of, and the floor they stand on is context.
  for (const r of plan.filter((r) => r.role === 'way')) put(r, '.');
  for (const r of plan.filter((r) => r.role === 'stand')) put(r, ',');
  for (const r of plan.filter((r) => r.role === 'prop' && r.soft)) put(r, GLYPHS['furniture:rug']);
  for (const r of plan.filter((r) => r.role === 'prop' && !r.soft)) put(r, glyphFor(r.key), true);
  for (const spot of approaches) {
    const cx = Math.floor(spot.at.x * 2);
    const cz = Math.floor(spot.at.z);
    if (grid[cz]?.[cx] === ' ' || grid[cz]?.[cx] === '.' || grid[cz]?.[cx] === ',') grid[cz][cx] = 'o';
  }

  const edge = `    +${'-'.repeat(cols)}+`;
  const body = grid.map((row, z) => `${String(z).padStart(3)} |${row.join('')}|`);
  return [edge, ...body, edge].join('\n');
}

/**
 * The key, so the plan reads without the source open.
 *
 * Built from the shared glyph table rather than written out, so it cannot come to
 * disagree with the plan it is a key to — five to a line, plus the three marks
 * that belong to the floor rather than to any prop.
 */
const LEGEND = [
  ...Array.from({ length: Math.ceil(KEY_ROWS.length / 5) }, (_, row) => KEY_ROWS
    .slice(row * 5, row * 5 + 5)
    .map(([g, word]) => `${g} ${word}`.padEnd(14))
    .join('')),
  `${GLYPHS['furniture:rug']} rug`.padEnd(14) + '. street'.padEnd(14)
    + ', standing room'.padEnd(18) + 'o where somebody stands',
].join('\n');

/** The scorecard as a line of bars, for a terminal. */
function scoreLines(score) {
  const bar = (v) => '█'.repeat(Math.round(v * 12)).padEnd(12, '·');
  const rows = score.parts
    .map((p) => `  ${p.label.padEnd(9)} ${bar(p.value)} ${p.value.toFixed(2)}   ${p.note}`);
  return [
    `  ${'office'.padEnd(9)} ${bar(score.total)} ${score.total.toFixed(2)}`,
    ...rows,
  ].join('\n');
}

function show(card) {
  console.log(`\n  ${card.name}`);
  if (card.seed) console.log(`  seed: ${card.seed}`);
  console.log(`  ${card.meta}`);
  if (card.reason) console.log(`\n  ${card.reason.replace(/\. /g, '.\n  ')}`);
  console.log(`\n${draw(card.plan.rects, card.plan.approaches)}`);
  console.log(`\n${LEGEND}`);
  if (card.score) console.log(`\n${scoreLines(card.score)}`);
  const r = card.office?.report;
  if (r && !r.ok) console.log(`\n  FAULTS: ${r.faults.join('; ')}`);
  if (r && r.attempts.length > 1) {
    console.log(`  fitted on attempt ${r.attempts.length} (asked for ${r.fit.asked} desks, seated ${r.fit.got})`);
  }
  console.log('');
}

/** Generate a lot of them and hold every one to the promise. */
function sweep(n, { quiet }) {
  const started = Date.now();
  const stats = {
    ok: 0, failed: [], attempts: [0, 0, 0, 0], desks: new Map(), typology: new Map(),
    post: new Map(), research: new Map(), lounge: new Map(), scheme: new Map(),
    names: new Map(), shortfall: 0, totals: [], parts: new Map(), worst: [],
  };
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

  for (let i = 0; i < n; i += 1) {
    const seed = `sweep-${i}`;
    const office = generateOffice(seed);
    const r = office.report;
    if (r.ok) stats.ok += 1;
    else stats.failed.push({ seed, faults: r.faults });
    stats.attempts[Math.min(3, r.attempts.length - 1)] += 1;
    if (r.fit.got < r.fit.asked) stats.shortfall += 1;
    bump(stats.desks, r.traits.desks);
    bump(stats.typology, r.brief.typology);
    bump(stats.post, r.brief.post.key);
    bump(stats.research, r.brief.research.key);
    bump(stats.lounge, r.brief.lounge.key);
    bump(stats.scheme, r.brief.scheme.key);
    bump(stats.names, office.name);
    stats.totals.push(r.score.total);
    for (const part of r.score.parts) {
      if (!stats.parts.has(part.label)) stats.parts.set(part.label, []);
      stats.parts.get(part.label).push(part.value);
    }
    stats.worst.push({ seed, total: r.score.total });
    if (!quiet && i < 12) {
      console.log(`  ${seed.padEnd(10)} ${office.name.padEnd(28)} ${String(r.traits.desks).padStart(2)} desks  ${r.brief.typology.padEnd(10)} ${r.score.total.toFixed(2)}`);
    }
  }

  const spread = (map, label) => {
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`).join('  ');
    console.log(`  ${label.padEnd(10)} ${rows}`);
  };
  /** min / p10 / median / p90 of a list, which is all anybody reads off one. */
  const quartiles = (list) => {
    const s = [...list].sort((a, b) => a - b);
    const at = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
    return `min ${s[0].toFixed(2)}  p10 ${at(0.1).toFixed(2)}  median ${at(0.5).toFixed(2)}  p90 ${at(0.9).toFixed(2)}  max ${s[s.length - 1].toFixed(2)}`;
  };

  const ms = Date.now() - started;
  console.log(`\n  ${stats.ok}/${n} offices valid   ${(ms / n).toFixed(1)}ms each   ${ms}ms total`);
  console.log(`  attempts   first:${stats.attempts[0]} second:${stats.attempts[1]} third:${stats.attempts[2]} fallback:${stats.attempts[3]}`);
  console.log(`  briefs the floor could not seat in full: ${stats.shortfall}`);
  console.log(`  distinct names: ${stats.names.size} of ${n}`);
  spread(stats.typology, 'shape');
  spread(stats.post, 'post');
  spread(stats.research, 'lookups');
  spread(stats.lounge, 'lounge');
  console.log(`  desks      ${[...stats.desks.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join('  ')}`);

  // The scorecard, which is a different question from validity: see src/plan/score.js.
  console.log(`\n  office     ${quartiles(stats.totals)}`);
  for (const [label, values] of stats.parts) {
    console.log(`  ${label.padEnd(10)} ${quartiles(values)}`);
  }
  const worst = stats.worst.sort((a, b) => a.total - b.total).slice(0, 5);
  console.log(`  worst five: ${worst.map((w) => `${w.seed} ${w.total.toFixed(2)}`).join('  ')}`);

  if (stats.failed.length) {
    console.log(`\n  FAILURES (${stats.failed.length}):`);
    for (const f of stats.failed.slice(0, 20)) console.log(`    ${f.seed}: ${f.faults.join('; ')}`);
    process.exitCode = 1;
  }
}

const sweepN = Number(opt('sweep', 0));
const gallery = opt('gallery', null);
const files = all('from');
const single = opt('from', null);

if (sweepN) {
  sweep(sweepN, { quiet: opt('quiet') === true });
} else if (gallery !== null) {
  // A gallery of files if any were named, and otherwise of seeds. `--gallery=24`
  // says how many seeds; with `--from` it is a bare flag, because the files are
  // the list.
  const cards = files.length
    ? files.map(fromFile)
    : Array.from({ length: Number(gallery) || 24 }, (_, i) => fromSeed(`gallery-${i + 1}`));
  const out = opt('out', 'docs/office-seeds.html');
  writeFileSync(out, plansPage(cards, files.length
    ? { title: 'Office layouts', lede: 'One plan per layout file, drawn from the room each one makes.' }
    : {}));
  console.log(`  ${cards.length} plans -> ${out}`);
} else if (single) {
  for (const path of files.length ? files : [single]) show(fromFile(path));
} else {
  const card = fromSeed(opt('seed', positional[0]) || undefined);
  if (opt('json')) console.log(JSON.stringify(card.office.layout, null, 2));
  else show(card);
}
