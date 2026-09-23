#!/usr/bin/env node
//
// The variety gallery: thirty offices in a row, so the algorithm can be judged by
// looking rather than by reading.
//
// **It is a generator and not a hand-written page, and that is the whole point.**
// docs/looks.html was written once by hand and never regenerated, so when the
// generator changed underneath it the page went on showing the same eighteen rooms
// and quietly invited a second labelling session on the first session's data. A
// gallery of generated output has to be as regenerable as the output.
//
// The renders are not made here — they need a real browser, because the scene is
// WebGL (see bin/scene-map.js and the reasoning in bin/prop-portrait.js). Take the
// pictures first, then write the page:
//
//   node bin/scene-map.js $(for i in $(seq 1 30); do echo --seed=variety-$i; done) \
//     --size=560 --out=docs/images/variety
//   node bin/office-variety.js
//
// Usage:
//   node bin/office-variety.js
//   node bin/office-variety.js --count=30 --prefix=variety --out=docs/office-variety.html
//
import { writeFileSync } from 'node:fs';
import { options } from './lib/cli-args.js';
import { stubDom, loadThree } from './lib/headless-scene.js';

const { value } = options(process.argv.slice(2));
const OPTS = {
  count: Number(value('count', 30)),
  prefix: value('prefix', 'variety'),
  dir: value('dir', 'images/variety'),
  out: value('out', 'docs/office-variety.html'),
};

// The looks judge applies a layout to the real room to survey it, so it needs the
// headless scene even though nothing is drawn.
stubDom();
await loadThree();
const { judge } = await import('./lib/looks-judge.js');
const { generateOffice } = await import('../src/plan/index.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (v) => Math.round(v * 100);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const rooms = Array.from({ length: OPTS.count }, (_, i) => {
  const seed = `${OPTS.prefix}-${i + 1}`;
  const office = generateOffice(seed);
  const traits = office.report.traits;
  const card = office.report.score;
  const part = (key) => card.parts.find((p) => p.key === key).value;
  const furniture = Object.values(office.layout.furniture ?? {});
  const count = (kind) => furniture.filter((f) => f.kind === kind).length;
  return {
    seed,
    name: office.name,
    reason: office.reason,
    desks: Object.keys(office.layout.desks).length,
    teams: traits.teams,
    typology: traits.typology,
    scheme: office.report.brief.scheme.key,
    rugs: count('rug'),
    seats: count('couch') + count('armchair'),
    plants: Object.keys(office.layout.plants ?? {}).length,
    stations: Object.keys(office.layout.stations ?? {}).length,
    plan: card.total,
    daylight: part('daylight'),
    looks: judge(office.layout).total,
  };
});

const uniq = (key) => new Set(rooms.map((r) => r[key])).size;
const span = (key) => `${Math.min(...rooms.map((r) => r[key]))}–${Math.max(...rooms.map((r) => r[key]))}`;

const card = (r, i) => `
  <article class="room" id="${r.seed}">
    <div class="shot"><img loading="lazy" width="560" height="560"
      src="${OPTS.dir}/${r.seed}.png" alt="Overhead view of ${esc(r.name)}"/></div>
    <div class="about">
      <p class="num">${String(i + 1).padStart(2, '0')} / ${rooms.length}</p>
      <h2>${esc(r.name)}</h2>
      <p class="chips">
        <span class="chip">${plural(r.desks, 'desk')}</span>
        <span class="chip">${plural(r.teams.length, 'team')} of ${r.teams.join('+')}</span>
        <span class="chip">${esc(r.typology)}</span>
        <span class="chip">${esc(r.scheme)}</span>
      </p>
      <p class="reason">${esc(r.reason)}</p>
      <p class="chips small">
        <span class="chip">${plural(r.rugs, 'rug')}</span>
        <span class="chip">${plural(r.seats, 'soft seat')}</span>
        <span class="chip">${plural(r.plants, 'plant')}</span>
        <span class="chip">${plural(r.stations, 'station')}</span>
      </p>
      <dl class="scores">
        <div><dt>plan</dt><dd>${pct(r.plan)}</dd></div>
        <div><dt>daylight</dt><dd>${pct(r.daylight)}</dd></div>
        <div><dt>looks</dt><dd>${pct(r.looks)}</dd></div>
      </dl>
      <p class="seed"><code>${r.seed}</code>
        <a href="/?seed=${encodeURIComponent(r.seed)}">open this office &rarr;</a></p>
    </div>
  </article>`;

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Thirty offices, thirty seeds</title>
<style>
  :root { color-scheme: light; --ink: #34302a; --dim: #6f6759; --line: #e2dcd0; --paper: #f4f1ea; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink);
         font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  a { color: #6f7f5c; }
  header { position: sticky; top: 0; z-index: 5; backdrop-filter: blur(8px);
           background: rgba(244,241,234,.9); border-bottom: 1px solid var(--line);
           padding: .8rem clamp(1rem, 4vw, 3rem); display: flex; gap: 1.1rem;
           align-items: baseline; flex-wrap: wrap; }
  header h1 { font-size: 1.05rem; margin: 0; }
  header p { margin: 0; color: var(--dim); font-size: .84rem; }
  .lede { padding: clamp(1.4rem, 4vw, 2.6rem) clamp(1rem, 4vw, 3rem) 0;
          max-width: 62rem; margin: 0 auto; }
  .lede p { margin: 0 0 .7rem; font-size: .95rem; color: #4a443c; }
  main { padding: 0 clamp(1rem, 4vw, 3rem) 4rem; max-width: 92rem; margin: 0 auto; }
  .room { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(17rem, .75fr);
          gap: clamp(1rem, 3vw, 2.4rem); align-items: start;
          padding: clamp(1.6rem, 4vw, 3rem) 0; border-bottom: 1px solid var(--line); }
  @media (max-width: 62rem) { .room { grid-template-columns: 1fr; } }
  .shot { background: #fff; border: 1px solid var(--line); border-radius: 14px;
          overflow: hidden; box-shadow: 0 1px 2px rgba(52,48,42,.06); }
  .shot img { display: block; width: 100%; height: auto; }
  .num { margin: 0; font-variant-numeric: tabular-nums; letter-spacing: .12em;
         font-size: .72rem; color: var(--dim); }
  .about h2 { font-size: 1.5rem; margin: .15rem 0 .7rem; line-height: 1.2; }
  .chips { display: flex; flex-wrap: wrap; gap: .35rem; margin: 0 0 .9rem; }
  .chip { font-size: .76rem; padding: .16rem .55rem; border: 1px solid var(--line);
          border-radius: 999px; background: #fff; color: var(--dim); white-space: nowrap; }
  .chips.small .chip { font-size: .72rem; background: transparent; }
  .reason { margin: 0 0 .9rem; font-size: .93rem; color: #4a443c; }
  .scores { display: flex; gap: 1.4rem; margin: 0 0 .9rem; padding: .7rem 0;
            border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .scores div { display: flex; flex-direction: column; }
  .scores dt { font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
  .scores dd { margin: 0; font-size: 1.15rem; font-variant-numeric: tabular-nums; }
  .seed { margin: 0; font-size: .8rem; color: var(--dim); display: flex;
          gap: .8rem; align-items: baseline; flex-wrap: wrap; }
  .seed code, code { background: #fff; border: 1px solid var(--line); border-radius: 6px;
                     padding: .1rem .4rem; font-size: .82em; }
  footer { padding: 0 clamp(1rem, 4vw, 3rem) 4rem; color: var(--dim);
           font-size: .86rem; max-width: 62rem; margin: 0 auto; }
</style></head>
<body>
<header>
  <h1>Thirty offices, thirty seeds</h1>
  <p>${uniq('typology')} arrangements &middot; ${uniq('scheme')} colour schemes
     &middot; ${span('desks')} desks &middot; scroll</p>
</header>
<div class="lede">
  <p>Seeds <code>${OPTS.prefix}-1</code> to <code>${OPTS.prefix}-${rooms.length}</code>,
     in order. <b>Nothing here was hand-picked and nothing was rejected</b> — these are
     the first thirty seeds, so the variety is the algorithm's own. Every room is a
     pure function of its seed: the same string always gives the same office.</p>
  <p>Each one carries the name it gave itself and the sentence explaining why it is
     laid out that way, both generated from what actually went into the room. The
     three numbers are its scorecard, out of 100: <b>plan</b> is how well it works as
     an office, <b>daylight</b> is how near the desks are to the glass, and
     <b>looks</b> is a model of one person's taste fitted to 146 pairwise judgements
     over 74 rooms. See <a href="tuning-the-layouts.md">Tuning the layout
     generator</a> for how those were arrived at, and
     <a href="generated-offices.md">Generated offices</a> for how a seed becomes a
     room.</p>
</div>
<main>${rooms.map(card).join('')}</main>
<footer>
  <p>Regenerate with <code>node bin/scene-map.js</code> for the pictures and
     <code>node bin/office-variety.js</code> for this page.</p>
</footer>
</body></html>`;

writeFileSync(OPTS.out, html);
process.stderr.write(`  ${rooms.length} offices -> ${OPTS.out}\n`);
process.stderr.write(`  ${uniq('typology')} arrangements · ${uniq('scheme')} schemes · ${span('desks')} desks\n`);
