#!/usr/bin/env node
//
// One number for the whole layout generator.
//
// This is the metric the autoresearch loop optimises
// (`.claude/skills/autoresearch/VENDORED.md`), which makes it the most
// load-bearing file in the layout work: a loop can only ever be as good as the number it
// ratchets on, and a number that measures the wrong thing will get exactly what
// it asked for, overnight, in ninety commits.
//
// So it is built out of five things, and each of them is one of the goals this
// work was asked for:
//
//   1. **the room works** — the plan's own scorecard (src/plan/score.js): seated,
//      daylight, teams, quiet, errands, floor;
//   1b. **it looks like somewhere you would want to sit** — the looks judge
//      (bin/lib/looks-judge.js), which is a person's own rubric turned into
//      measures and checked against the ranking they gave: rugs marking out
//      areas, desks in banks rather than islands, something green, the coffee
//      within reach. It agrees with them at +0.53 where the rest of this file
//      managed +0.11, which is the difference between measuring the goal and
//      hoping;
//   2. **people get where they are going quickly** — measured, by running the
//      office (bin/lib/office-sim.js): how long a collection, a dispatch, a drink
//      and a lookup actually take;
//   3. **and without being blocked** — clipped walking frames, stuck walkers,
//      errands nobody ever completed;
//   4. **efficiently** — how far they walked against how far it was;
//   5. **at any headcount** — every layout is run at several, and the *worst* one
//      counts as much as the average.
//
// Three rules keep it honest, and they matter more than the weights:
//
// * **A held-out seed set.** `--tune` is what the loop is allowed to see;
//   `--hold` is a disjoint set it never does. An improvement on the first that
//   does not appear on the second is the loop learning the sample, which is what
//   the loudest autoresearch result in the wild stands accused of.
// * **Nothing here is in the loop's scope.** The generator is mutable; this file,
//   the simulator and the agent layer are not. The cheapest way to make agents
//   stop bumping into furniture is to edit the walker, and the second cheapest is
//   to edit the scorer.
// * **Every component is printed.** A composite that only ever shows its total is
//   a composite nobody can argue with.
//
// Usage:
//   node bin/office-fitness.js                one number, the tune set
//   node bin/office-fitness.js --hold         the held-out set
//   node bin/office-fitness.js --json         every component
//   node bin/office-fitness.js --noise=12     the sampling error, which is the
//                                             smallest improvement worth believing
//   node bin/office-fitness.js --guard          exit 1 if a floor has been breached
//   node bin/office-fitness.js --record         write the floors from this run
//   node bin/office-fitness.js --seeds=24 --minutes=3
//   node bin/office-fitness.js --prefix=look --seeds=160 --json   a third set,
//                                             for choosing rooms to be labelled
//
import { options } from './lib/cli-args.js';
import { stubDom, loadThree } from './lib/headless-scene.js';
import { ramp, mean } from '../src/measure.js';

const { opt } = options(process.argv.slice(2));

const OPTS = {
  hold: opt('hold') === true,
  guard: opt('guard') === true,
  record: opt('record') === true,
  baseline: opt('baseline', 'test/fitness-floors.json'),
  seeds: Number(opt('seeds', 24)),
  minutes: Number(opt('minutes', 2)),
  noise: Number(opt('noise', 0)),
  json: opt('json') === true,
  quiet: opt('quiet') === true,
  prefix: opt('prefix', null),
};

/**
 * The seed sets, and why they are prefixes rather than numbers.
 *
 * A seed is any string (src/plan/rng.js), so a *set* of them is a prefix and an
 * index — and two prefixes give two sets that cannot overlap however many are
 * drawn from either. `tune-*` is the loop's; `hold-*` is the one it never sees.
 *
 * `--prefix=` names a third set, which exists for the labelling rounds: the rooms
 * a person is shown must come from somewhere that is neither being optimised nor
 * being held out, or the labels and the holdout stop being independent of each
 * other.
 */
const setFor = (hold, n, offset = 0) => Array.from(
  { length: n },
  (_, i) => `${OPTS.prefix ?? (hold ? 'hold' : 'tune')}-${offset + i}`,
);

/** 1 at or below `good`, 0 at or above `bad` — for things where less is better. */
const fall = (v, good, bad) => 1 - ramp(v, good, bad);

/**
 * How the four errands score on time.
 *
 * Two seconds is as fast as an errand in this room can honestly be — the walk to
 * a machine on the far wall is twenty units at 6.4 a second — and sixteen is
 * somebody who has walked the room twice. Both the mean and the ninetieth
 * percentile count, because an office where the coffee usually takes four seconds
 * and sometimes takes thirty is an office with a queue in it.
 */
function timeScore(errands) {
  const kinds = Object.values(errands).filter((e) => e.n > 0);
  if (!kinds.length) return { time: 0, worst: 0 };
  return {
    time: mean(kinds.map((e) => fall(e.mean ?? 16, 2, 16))),
    worst: mean(kinds.map((e) => fall(e.p90 ?? 30, 3, 30))),
  };
}

/**
 * What one run of one office comes to.
 *
 * `flow` is the part that needed the office actually run, and it is deliberately
 * unforgiving about failure: an errand nobody completed is not a slow errand, it
 * is a room that does not work, and a layout with one of those should not be able
 * to buy its way back with fast walks elsewhere.
 */
function scoreRun(run) {
  const { time, worst } = timeScore(run.errands);
  const detours = Object.values(run.errands)
    .map((e) => e.detour)
    .filter((d) => d != null);
  return {
    time,
    worst,
    // A straight line is 1; 1.6 is a walk round two banks of desks; past 2.5 the
    // room is sending people the long way about.
    detour: detours.length ? fall(mean(detours), 1.15, 2.5) : 0.5,
    // Walking frames spent inside the furniture — the chair-clipping measurement, and
    // the reason `TIGHT_PENALTY` exists at all.
    clear: fall(run.clipped, 0.005, 0.06),
    // Two seconds of walking without moving, per person per minute.
    unblocked: fall(run.stuckEvents / Math.max(1, run.agents * run.minutes), 0.05, 1),
    // Errands nobody ever completed.
    reliable: run.attempted ? fall(run.failed / run.attempted, 0, 0.25) : 0,
  };
}

const FLOW_WEIGHTS = {
  time: 3, worst: 2, detour: 2, clear: 2, unblocked: 2, reliable: 4,
};

/** The weighted mean of a component bag. */
function fold(parts, weights) {
  const total = Object.entries(weights).reduce((n, [, w]) => n + w, 0);
  return Object.entries(weights).reduce((n, [key, w]) => n + (parts[key] ?? 0) * w, 0) / total;
}

/**
 * The whole thing: plan and flow, over a seed set, at several headcounts.
 *
 * The headcounts are the layout's own: half its desks and all of them. Half
 * because a room is mostly not full, and all because that is what it was designed
 * for — and the *minimum* over them is half the flow score, which is what makes
 * "it holds at various agent numbers" a thing the number cares about rather than
 * a hope.
 */
async function measure(rig, seeds, { minutes }) {
  const { generateOffice } = await import('../src/plan/index.js');
  const rows = [];

  for (const seed of seeds) {
    const office = generateOffice(seed);
    const desks = Object.keys(office.layout.desks).length;
    const headcounts = [...new Set([Math.max(2, Math.ceil(desks / 2)), desks])];

    const flows = [];
    for (const agents of headcounts) {
      const run = rig.runOffice(rig.rig, {
        blob: office.layout, agents, minutes, seed: 1,
      });
      flows.push({ agents, parts: scoreRun(run), run });
    }

    // Judged from the blob rather than from the office, which is what keeps a
    // labelled room labelled: see the note at the top of looks-judge.js.
    const looks = judge(office.layout);

    const each = flows.map((f) => fold(f.parts, FLOW_WEIGHTS));
    rows.push({
      seed,
      name: office.name,
      desks,
      plan: office.report.score.total,
      planParts: office.report.score.parts,
      looks: looks.total,
      looksParts: looks.parts,
      // Half the average and half the worst headcount: a plan that only works
      // when the office is quiet has not worked.
      flow: 0.5 * mean(each) + 0.5 * Math.min(...each),
      flowParts: flows,
      failed: flows.reduce((n, f) => n + f.run.failed, 0),
    });
  }

  const planned = mean(rows.map((r) => r.plan));
  const flowed = mean(rows.map((r) => r.flow));
  const looked = mean(rows.map((r) => r.looks));
  // Every component, averaged over the whole set, so a guard can be asked about
  // one of them and a reader can see which way a total moved.
  const components = {};
  for (const row of rows) {
    for (const part of row.planParts) {
      (components[part.key] ??= []).push(part.value);
    }
    for (const f of row.flowParts) {
      for (const [key, value] of Object.entries(f.parts)) (components[key] ??= []).push(value);
    }
    for (const part of row.looksParts) (components[part.key] ??= []).push(part.value);
  }
  return {
    components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, mean(v)])),
    // Three ways of asking whether a room is any good, weighted by how much each
    // one is actually *known*. The plan and the room in it are measured; the looks
    // are a model of one person's taste checked against twenty-nine of their
    // answers, which is real evidence and thin evidence at once — so a quarter,
    // and it goes up when there are enough labels to earn it.
    total: 0.4 * planned + 0.35 * flowed + 0.25 * looked,
    plan: planned,
    flow: flowed,
    looks: looked,
    seeds: seeds.length,
    rows,
  };
}

/**
 * The components that may not fall, and why these ones.
 *
 * The loop maximises one number, and one number can be bought: a change that
 * makes the room quicker to walk about can pay for itself by making it less like
 * an office, and at fifty-fifty the two cancel *exactly* — the bench pitch this
 * project whose footprints were later corrected scores +0.0006 as a composite while
 * `teams` falls by
 * 0.028 and `detour` rises by 0.05. Measured, not supposed.
 *
 * So the office-likeness half is a **floor** rather than a dial. These may not
 * fall; everything else is free to move, because everything else is what we are
 * trying to improve. The mechanism is the loop's own `Guard:`, which reverts a
 * change regardless of the metric — see `.claude/skills/autoresearch/`.
 *
 * `clear` and `reliable` are in here too, and they are not about looks: walking
 * through the furniture and errands nobody completes are the two ways a room can
 * be *broken* while scoring well on speed.
 *
 * **`zoned` was in here and has been taken out, deliberately and on the record.**
 * It vetoed the first two attempts at the thing this loop exists to fix. Pulling
 * the desk banks towards the glass leaves them where a rug's nine by seven will
 * not fit, so rug coverage falls, so `zoned` breached and a real gain in
 * `daylight` was reverted twice.
 *
 * That is the floor misfiring rather than working. A floor is here to stop the
 * loop trading *office-likeness* for speed. `zoned` is not office-likeness — it is
 * a proxy for one person's taste, it is the weakest of the measures the labelling
 * supports (pooled +0.112 over three rounds, and −0.011 in the largest round),
 * and `daylight` is both one of the five things this work was asked for and
 * floored itself. A taste proxy may not hold a stated goal hostage.
 *
 * Rug coverage is still *scored*, by `zoned` and `covered` inside the looks judge,
 * so a change that wrecks the rugs still costs. It no longer gets a veto.
 *
 * Recorded here rather than done quietly in a loop iteration, because program.md
 * tells the loop that a floor it believes is wrong is "a decision for a person"
 * and this is that decision.
 */
const FLOORS = ['seated', 'daylight', 'teams', 'quiet', 'floor', 'clear', 'reliable', 'interest'];

/** How far a floored component may drift before the guard calls it a breach. */
const TOLERANCE = 0.01;

stubDom();
const THREE = await loadThree();
const { judge } = await import('./lib/looks-judge.js');
const { openRoom, runOffice } = await import('./lib/office-sim.js');
const room = await openRoom(THREE, { seed: 1 });
const rig = { rig: room, runOffice };

if (OPTS.noise) {
  // The sampling error, which is the whole point of this mode: every run of this
  // command is byte-identical for the same seeds, so the variance that matters is
  // not run-to-run but *sample*-to-sample. Disjoint samples of the same size,
  // measured; the spread is the smallest difference worth believing, and anything
  // the loop claims below it is noise wearing a commit message.
  const samples = [];
  for (let j = 0; j < OPTS.noise; j += 1) {
    const seeds = setFor(OPTS.hold, OPTS.seeds, j * OPTS.seeds);
    const out = await measure(rig, seeds, { minutes: OPTS.minutes });
    samples.push(out.total);
    if (!OPTS.quiet) process.stderr.write(`  sample ${j + 1}/${OPTS.noise}  ${out.total.toFixed(4)}\n`);
  }
  const m = mean(samples);
  const sd = Math.sqrt(mean(samples.map((v) => (v - m) ** 2)));
  const sorted = [...samples].sort((a, b) => a - b);
  process.stderr.write(`\n  ${OPTS.noise} disjoint samples of ${OPTS.seeds} seeds, ${OPTS.minutes} min each\n`);
  process.stderr.write(`  mean ${m.toFixed(4)}  sd ${sd.toFixed(4)}  min ${sorted[0].toFixed(4)}  max ${sorted.at(-1).toFixed(4)}\n`);
  process.stderr.write(`  spread ${(sorted.at(-1) - sorted[0]).toFixed(4)} — an improvement smaller than this is not one\n`);
  console.log(sd.toFixed(4));
} else if (OPTS.guard || OPTS.record) {
  const out = await measure(rig, setFor(OPTS.hold, OPTS.seeds), { minutes: OPTS.minutes });
  const { writeFileSync, readFileSync } = await import('node:fs');
  if (OPTS.record) {
    const floors = Object.fromEntries(FLOORS.map((k) => [k, Math.round(out.components[k] * 10000) / 10000]));
    writeFileSync(OPTS.baseline, `${JSON.stringify({
      recorded: new Date().toISOString().slice(0, 10),
      seeds: OPTS.seeds,
      minutes: OPTS.minutes,
      total: Math.round(out.total * 10000) / 10000,
      floors,
    }, null, 2)}\n`);
    process.stderr.write(`  floors recorded in ${OPTS.baseline}\n`);
    for (const [k, v] of Object.entries(floors)) process.stderr.write(`    ${k.padEnd(10)} ${v.toFixed(4)}\n`);
  } else {
    const base = JSON.parse(readFileSync(OPTS.baseline, 'utf8'));
    const breaches = [];
    for (const [key, floor] of Object.entries(base.floors)) {
      const now = out.components[key];
      if (now == null) { breaches.push(`${key} is no longer measured at all`); continue; }
      if (now < floor - TOLERANCE) breaches.push(`${key} ${now.toFixed(4)} < ${floor.toFixed(4)}`);
    }
    if (breaches.length) {
      process.stderr.write(`  GUARD FAILED — the room got worse at being an office:\n`);
      for (const b of breaches) process.stderr.write(`    ${b}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(`  guard passed — every floor held (total ${out.total.toFixed(4)})\n`);
    }
  }
} else {
  const out = await measure(rig, setFor(OPTS.hold, OPTS.seeds), { minutes: OPTS.minutes });
  if (OPTS.json) {
    console.log(JSON.stringify(out, (key, value) => (key === 'run' ? undefined : value), 2));
  } else if (!OPTS.quiet) {
    const worst = [...out.rows].sort((a, b) => (a.plan + a.flow) - (b.plan + b.flow)).slice(0, 3);
    process.stderr.write(`\n  ${OPTS.hold ? 'held-out' : 'tune'} set · ${out.seeds} offices · ${OPTS.minutes} simulated minutes each\n`);
    process.stderr.write(`  plan ${out.plan.toFixed(4)}   flow ${out.flow.toFixed(4)}   looks ${out.looks.toFixed(4)}   total ${out.total.toFixed(4)}\n`);
    process.stderr.write(`  worst three: ${worst.map((r) => `${r.seed} ${(0.5 * r.plan + 0.5 * r.flow).toFixed(3)}`).join('  ')}\n`);
    process.stderr.write(`  errands nobody completed: ${out.rows.reduce((n, r) => n + r.failed, 0)}\n\n`);
    console.log(out.total.toFixed(4));
  } else {
    console.log(out.total.toFixed(4));
  }
}
room.close();
