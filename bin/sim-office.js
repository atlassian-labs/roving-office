#!/usr/bin/env node
//
// Run one office and print what happened in it.
//
// The looking-at-it tool for `bin/lib/office-sim.js`, and the thing to reach for
// when a fitness number moves and nobody knows why: it prints the errand times,
// the detours, the clipped frames and the stuck events for one layout at one
// headcount, which is the level at which a bad number is explicable.
//
// Usage:
//   node bin/sim-office.js                        the authored room, 5 people
//   node bin/sim-office.js <seed>                 a generated office
//   node bin/sim-office.js <seed> --agents=3,6,9  at several headcounts
//   node bin/sim-office.js --from=cosy.json       any layout .json
//   node bin/sim-office.js <seed> --minutes=6 --json
//
//   --agents=<list>  headcounts to run, comma-separated (default: desks/2, desks)
//   --minutes=<n>    simulated minutes per run (default 3)
//   --runs=<n>       how many room seeds per headcount (default 1)
//   --json           the metrics as JSON, for piping
//   --trace          every errand, one per line — what a bad number is made of
//
import { readFileSync } from 'node:fs';
import { options } from './lib/cli-args.js';
import { stubDom, loadThree } from './lib/headless-scene.js';

const { opt, positional } = options(process.argv.slice(2));

const OPTS = {
  seed: opt('seed', positional[0] ?? null),
  from: opt('from', null),
  minutes: Number(opt('minutes', 3)),
  runs: Math.max(1, Number(opt('runs', 1))),
  agents: opt('agents', null),
  json: opt('json') === true,
  trace: opt('trace') === true,
};

stubDom();
const THREE = await loadThree();
const { openRoom, runOffice } = await import('./lib/office-sim.js');
const { generateOffice } = await import('../src/plan/index.js');

/** The layout under test, and what to call it. */
function subject() {
  if (OPTS.from) {
    const blob = JSON.parse(readFileSync(OPTS.from, 'utf8'));
    return { blob, name: blob.name ?? OPTS.from, seed: blob.seed ?? null };
  }
  if (OPTS.seed) {
    const office = generateOffice(OPTS.seed);
    return { blob: office.layout, name: office.name, seed: office.seed };
  }
  return { blob: null, name: 'The authored room', seed: null };
}

const { blob, name, seed } = subject();
const rig = await openRoom(THREE, { seed: 1 });

// How many desks the layout has, which is the headcount it was designed for —
// `agentCapacity()` is the desk count, so "full" means one person per desk.
rig.layout.resetLayout();
if (blob) rig.layout.applyLayout(blob);
const desks = rig.layout.DESKS.length;

const headcounts = OPTS.agents
  ? String(OPTS.agents).split(',').map((n) => Number(n)).filter((n) => n > 0)
  : [...new Set([Math.max(2, Math.ceil(desks / 2)), desks])];

const runs = [];
for (const agents of headcounts) {
  for (let r = 0; r < OPTS.runs; r += 1) {
    runs.push(runOffice(rig, {
      blob, agents, minutes: OPTS.minutes, seed: 1 + r, trace: OPTS.trace,
    }));
  }
}
rig.close();

if (OPTS.json) {
  console.log(JSON.stringify({ name, seed, desks, runs }, null, 2));
} else {
  const n = (v, places = 1) => (v == null ? '   —' : v.toFixed(places).padStart(5));
  console.log(`\n  ${name}${seed ? `   seed: ${seed}` : ''}`);
  console.log(`  ${desks} desks · ${OPTS.minutes} simulated minutes · dt 1/30\n`);
  console.log('  people  errand      n  mean   p90  detour   failed');
  for (const run of runs) {
    for (const [kind, e] of Object.entries(run.errands)) {
      console.log(`  ${String(run.agents).padStart(6)}  ${kind.padEnd(9)}  ${String(e.n).padStart(2)} ${n(e.mean)}s ${n(e.p90)}s   ${n(e.detour, 2)}   ${e.failed || ''}`);
    }
    if (run.trace) {
      for (const e of run.trace) {
        console.log(`          ${e.arrived ? ' ' : '!'} ${e.kind.padEnd(9)} ${e.id.padEnd(7)} ${n(e.seconds)}s`
          + (e.arrived ? ` straight ${n(e.straight)} detour ${n(e.detour, 2)}`
            : ` gave up at ${e.stoppedAt.x},${e.stoppedAt.z} — ${n(e.shortBy)} short, ${e.status}`));
      }
    }
    console.log(`  ${String(run.agents).padStart(6)}  ${'—'.padEnd(9)}  clipped ${(run.clipped * 100).toFixed(2)}% of ${run.walkingFrames} walking frames · stuck ${run.stuckEvents} · unfinished ${run.unfinished} · walked ${run.distance.toFixed(0)}\n`);
  }
}
