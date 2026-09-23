// Office layouts as plan drawings, for looking at a lot of them at once.
//
// A plan view rather than a render, and on purpose: a layout *is* a set of
// positions, so a drawing that shows nothing but positions shows exactly the
// thing itself, twenty-four to a page, with no browser and no WebGL. The real
// renders — the same rooms, dressed, lit and photographed from above — come from
// `bin/scene-map.js --seed=<seed>`, which builds the actual scene.
//
// It draws a **survey** (src/plan/survey.js) rather than a generated office, so
// anything that is a layout can be drawn: a seed, a file somebody exported from
// the furniture editor, or the authored room. Which is also why a generated
// office is surveyed from its own blob rather than drawn from the generator's
// notes — the picture is then of the room that will actually be stored.
//
// The drawing is the architect's convention and not the scene's: the door at the
// top, the walls hatched, the windows broken out of them, and every prop labelled
// with what it is. Aisles are drawn, because a floor plan that does not show its
// circulation is a floor plan hiding the interesting half of itself.

import { ROOM, DOOR, WINDOWS, windowSpan } from '../../src/config.js';

/**
 * One character per kind of prop, shared by both drawings of a plan — the
 * terminal one in bin/office-plan.js and the SVG one here.
 *
 * Shared because they are two views of one thing and a reader moving between
 * them should not have to learn two alphabets. A single character rather than a
 * word for a reason the first draft made obvious: a mailbox is 1.8 units across,
 * which at any legible type size is narrower than the word "mailbox", so every
 * label ran across its neighbours and the plan turned into a hedge of text.
 */
export const GLYPHS = {
  desk: 'D',
  'station:coatStand': 'C',
  'station:mailbox': 'M',
  'station:printer': 'P',
  'station:inbox': 'I',
  'station:bookshelf': 'B',
  'station:telescope': 'T',
  'station:coffee': 'K',
  'station:waterCooler': 'W',
  'station:bin': 'X',
  'furniture:couch': 'U',
  'furniture:armchair': 'A',
  'furniture:sideTable': 't',
  'furniture:floorLamp': 'l',
  'furniture:rug': '~',
  plant: '*',
};

/** What one line of the key says, in the order it reads. */
export const KEY_ROWS = [
  ['D', 'desk'], ['C', 'coats'], ['M', 'post'], ['P', 'printer'], ['I', 'stock'],
  ['B', 'shelf'], ['T', 'telescope'], ['K', 'coffee'], ['W', 'water'], ['X', 'bin'],
  ['U', 'couch'], ['A', 'armchair'], ['t', 'table'], ['l', 'lamp'], ['*', 'plant'],
];

/** The glyph a rectangle's key earns. */
export function glyphFor(key) {
  if (key.startsWith('desk:')) return GLYPHS.desk;
  if (key.startsWith('plant:')) return GLYPHS.plant;
  const [family, id] = key.split(':');
  return GLYPHS[`${family}:${(id ?? '').replace(/-\d+$/, '')}`] ?? '?';
}

/** How the families are coloured. Muted, because there are a lot of them. */
const INK = {
  desk: '#5a7d8c',
  station: '#a8724a',
  furniture: '#7f8f6a',
  plant: '#5d9163',
  way: '#e8e4da',
  stand: '#f3f0e8',
  wall: '#6f6a60',
  glass: '#9fc4d6',
  paper: '#fbf9f4',
  text: '#3a3630',
};

const PAD = 1.2;

/** What a prop's key says it is, for the colour and the label. */
function family(key) {
  return key.split(':')[0];
}

/**
 * What is written inside a prop's rectangle.
 *
 * A desk carries its own number, because which desk is which is the one thing a
 * plan of a *floor* is for; everything else carries its kind's glyph, and a
 * second one of a kind carries the number after it (`M2`).
 */
function label(key) {
  const [fam, id] = key.split(':');
  if (fam === 'desk') return id.replace('desk-', 'D');
  if (fam === 'plant') return '';
  const n = /-(\d+)$/.exec(id ?? '');
  return `${glyphFor(key)}${n ? n[1] : ''}`;
}

/**
 * One layout, as an SVG plan.
 *
 * @param {{rects: object[], approaches: object[]}} plan  from `survey()`
 * @param {number} [scale]  pixels per world unit
 */
function planSvg(plan, scale = 15) {
  const w = (ROOM.W + PAD * 2) * scale;
  const h = (ROOM.D + PAD * 2) * scale;
  const X = (x) => (x + PAD) * scale;
  const Z = (z) => (z + PAD) * scale;
  const out = [];
  const px = (n) => Math.round(n * 10) / 10;

  out.push(`<svg viewBox="0 0 ${px(w)} ${px(h)}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace, monospace">`);
  out.push(`<rect x="0" y="0" width="${px(w)}" height="${px(h)}" fill="${INK.paper}"/>`);

  // The floor, and the two open edges as a dashed line: this room is a cutaway,
  // so two of its four sides are not walls at all.
  out.push(`<rect x="${px(X(0))}" y="${px(Z(0))}" width="${px(ROOM.W * scale)}" height="${px(ROOM.D * scale)}" fill="#fff" stroke="#ded8cc"/>`);
  out.push(`<path d="M ${px(X(ROOM.W))} ${px(Z(0))} L ${px(X(ROOM.W))} ${px(Z(ROOM.D))} L ${px(X(0))} ${px(Z(ROOM.D))}" fill="none" stroke="#c9c2b4" stroke-dasharray="4 3"/>`);

  // The circulation, then the standing room, then the props on top.
  for (const r of plan.rects) {
    if (r.role !== 'way') continue;
    out.push(`<rect x="${px(X(r.x0))}" y="${px(Z(r.z0))}" width="${px((r.x1 - r.x0) * scale)}" height="${px((r.z1 - r.z0) * scale)}" fill="${INK.way}"/>`);
  }
  for (const r of plan.rects) {
    if (r.role !== 'stand') continue;
    out.push(`<rect x="${px(X(r.x0))}" y="${px(Z(r.z0))}" width="${px((r.x1 - r.x0) * scale)}" height="${px((r.z1 - r.z0) * scale)}" fill="${INK.stand}"/>`);
  }

  // The two real walls, as solid bands; the windows cut out of them.
  const t = ROOM.wallT * scale;
  out.push(`<rect x="${px(X(0) - t)}" y="${px(Z(0) - t)}" width="${px(ROOM.W * scale + t)}" height="${px(t)}" fill="${INK.wall}"/>`);
  out.push(`<rect x="${px(X(0) - t)}" y="${px(Z(0) - t)}" width="${px(t)}" height="${px(ROOM.D * scale + t)}" fill="${INK.wall}"/>`);
  for (const [wall, list] of Object.entries(WINDOWS)) {
    for (let i = 0; i < list.length; i += 1) {
      const span = windowSpan(wall, i);
      if (!span) continue;
      out.push(span.axis === 'x'
        ? `<rect x="${px(X(span.from))}" y="${px(Z(0) - t)}" width="${px(span.width * scale)}" height="${px(t)}" fill="${INK.glass}"/>`
        : `<rect x="${px(X(0) - t)}" y="${px(Z(span.from))}" width="${px(t)}" height="${px(span.width * scale)}" fill="${INK.glass}"/>`);
    }
  }
  // The door, open, in the back wall.
  out.push(`<rect x="${px(X(DOOR.x - DOOR.width / 2))}" y="${px(Z(0) - t)}" width="${px(DOOR.width * scale)}" height="${px(t)}" fill="${INK.paper}" stroke="${INK.wall}"/>`);
  out.push(`<path d="M ${px(X(DOOR.x - DOOR.width / 2))} ${px(Z(0))} L ${px(X(DOOR.x - DOOR.width / 2))} ${px(Z(DOOR.width))}" stroke="${INK.wall}" fill="none"/>`);

  for (const r of plan.rects) {
    if (r.role !== 'prop') continue;
    const fam = family(r.key);
    const ink = INK[fam] ?? INK.station;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    if (fam === 'plant') {
      out.push(`<circle cx="${px(X(cx))}" cy="${px(Z(cz))}" r="${px(((r.x1 - r.x0) / 2) * scale)}" fill="${ink}" fill-opacity="0.5"/>`);
      continue;
    }
    out.push(`<rect x="${px(X(r.x0))}" y="${px(Z(r.z0))}" width="${px((r.x1 - r.x0) * scale)}" height="${px((r.z1 - r.z0) * scale)}" fill="${ink}" fill-opacity="${r.soft ? 0.18 : 0.75}" stroke="${ink}" stroke-opacity="0.9"/>`);
    const text = label(r.key);
    if (text && !r.soft) {
      out.push(`<text x="${px(X(cx))}" y="${px(Z(cz) + 3.2)}" font-size="${px(scale * 0.62)}" fill="#fff" text-anchor="middle">${text}</text>`);
    }
  }

  // Where people stand, which is the half of a layout you cannot see in a room.
  for (const spot of plan.approaches) {
    out.push(`<circle cx="${px(X(spot.at.x))}" cy="${px(Z(spot.at.z))}" r="2.4" fill="none" stroke="${INK.text}" stroke-opacity="0.45"/>`);
  }

  out.push('</svg>');
  return out.join('');
}

/** Escape for dropping text into HTML. */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

/**
 * A page of them, with each room's name and its reason under its plan.
 *
 * Self-contained, like everything else in this project: no assets, no fonts, no
 * script. It is a contact sheet, and its job is to make a hundred layouts
 * skimmable in one scroll.
 *
 * A card whose room came from a seed carries a link that **opens that office** —
 * reception mints a keycard and hands the seed straight to the generator, so a
 * plan you like on this page is one click from being a room you can walk into.
 * A card drawn from a file has no such link, because there is nothing to
 * reproduce: the file is the room.
 *
 * @param {{plan: object, name: string, seed?: ?string, reason?: string,
 *   meta?: string, score?: ?object}[]} cards
 * @param {{title?: string, lede?: string}} [opts]
 */
export function plansPage(cards, { title = 'Generated offices', lede = null } = {}) {
  const intro = lede ?? `One plan per seed, drawn from the layout the generator
    produced — desks blue, stations rust, furniture olive, planting green. The pale
    bands are the circulation the plan reserved before anything was placed: the
    avenue in from the door and the one street it runs into. The rings are where
    people stand.`;

  const figures = cards.map((card) => `
    <figure>
      ${planSvg(card.plan)}
      <figcaption>
        <h2>${esc(card.name)}</h2>
        ${card.seed
    ? `<p class="seed"><code>${esc(card.seed)}</code>
           <a class="open" href="/?seed=${encodeURIComponent(card.seed)}">Open this office \u2197</a></p>`
    : ''}
        ${card.reason ? `<p>${esc(card.reason)}</p>` : ''}
        ${card.score ? scoreBar(card.score) : ''}
        ${card.meta ? `<small>${esc(card.meta)}</small>` : ''}
      </figcaption>
    </figure>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 2rem clamp(1rem, 4vw, 4rem); background: #f4f1ea;
         font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #3a3630; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  .lede { max-width: 46rem; color: #6b6558; margin: 0 0 .75rem; }
  .key { display: flex; flex-wrap: wrap; gap: .25rem .9rem; margin: 0 0 2rem;
         font-size: .8rem; color: #6b6558; }
  .key b { color: #3a3630; font-family: ui-monospace, monospace; }
  main { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); }
  figure { margin: 0; background: #fff; border: 1px solid #e2dcd0; border-radius: 10px;
           overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  figcaption { padding: .85rem 1rem 1.1rem; }
  figcaption h2 { font-size: 1.05rem; margin: 0 0 .15rem; }
  figcaption p { margin: .5rem 0 .4rem; font-size: .88rem; }
  figcaption small { color: #8a8272; font-size: .76rem; }
  .seed { display: flex; align-items: baseline; gap: .6rem; margin: .1rem 0 .5rem; }
  .seed code { font-size: .78rem; color: #8a8272; }
  .open { font-size: .78rem; color: #6b6558; text-decoration: none;
          border-bottom: 1px solid #d9d2c4; white-space: nowrap; }
  .open:hover { color: #3a3630; border-bottom-color: #8a8272; }
  /* The scorecard: one bar per measure, so a weak room is weak visibly rather
     than only in a number nobody reads. */
  .score { display: grid; grid-template-columns: auto 1fr auto; gap: 2px .5rem;
           align-items: center; margin: .6rem 0 .2rem; font-size: .72rem; color: #8a8272; }
  .score b { font-weight: 500; color: #6b6558; }
  .score .bar { height: 5px; background: #ece7dd; border-radius: 3px; overflow: hidden; }
  .score .bar i { display: block; height: 100%; background: #7f8f6a; }
  .score .total b { color: #3a3630; }
</style></head>
<body>
  <h1>${esc(title)}</h1>
  <p class="lede">${intro}</p>
  <p class="key">${KEY_ROWS.map(([g, word]) => `<span><b>${esc(g)}</b> ${esc(word)}</span>`).join('')}</p>
  <main>${figures}</main>
</body></html>`;
}

/** A scorecard as a row of bars — see `score()` in src/plan/score.js. */
function scoreBar(score) {
  const rows = score.parts.map((part) => `
    <b title="${esc(part.note)}">${esc(part.label)}</b>
    <span class="bar"><i style="width:${Math.round(part.value * 100)}%"></i></span>
    <span>${part.value.toFixed(2)}</span>`).join('');
  return `<div class="score">${rows}
    <b class="total">office</b>
    <span class="bar"><i style="width:${Math.round(score.total * 100)}%"></i></span>
    <span>${score.total.toFixed(2)}</span>
  </div>`;
}
