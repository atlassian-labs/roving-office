// The page that asks a person which room is nicer.
//
// "Visually pleasing" is one of the five things the layout work is trying to optimise and
// the only one no measurement can reach on its own. So it is reached the way
// subjective quality is always reached: ask somebody, carefully, and then build a
// judge that agrees with them.
//
// Three deliberate choices, and each is about the answers being worth having.
//
// **Pairwise, not a score out of five.** People are reliable at "which of these
// two" and unreliable at "how good is this" — an absolute scale drifts over a
// session, so room 3 and room 15 end up graded against different standards. A
// forced choice has nothing to drift.
//
// **The renders, not the plans.** A plan drawing is what the generator decides; a
// render is what a person sees. Asking about the plans would be asking whether
// the *diagram* is pretty.
//
// **The answers come back through the clipboard.** No endpoint, no database:
// this repo's pages are self-contained (see docs/office-seeds.html), and a
// labelling session that needs a server running is one nobody does twice. The
// page keeps its state in `localStorage` so a half-finished session survives a
// reload, and hands back one JSON blob at the end.

/**
 * @param {{seed: string, name: string, desks: number, fitness: number}[]} rooms
 * @param {[string, string][]} pairs  seed pairs, in the order they are asked
 * @param {{dir?: string, key?: string}} [opts]  where the renders live relative to
 *   the page, and the localStorage key. **A new round needs a new key**: the state
 *   is what lets a half-finished session survive a reload, and a second round
 *   sharing a key with the first picks up the first round's answers and its
 *   position in a list of pairs that no longer exists.
 */
export function looksPage(rooms, pairs, { dir = 'images/looks', key = 'roving-office.looks.v1' } = {}) {
  const meta = Object.fromEntries(rooms.map((r) => [r.seed, r]));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Which room is nicer?</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: #f4f1ea; color: #3a3630; }
  header { padding: 1.2rem clamp(1rem, 4vw, 3rem) 0.6rem; }
  h1 { font-size: 1.35rem; margin: 0 0 .3rem; }
  p.lede { max-width: 52rem; color: #6b6558; margin: 0; font-size: .92rem; }
  main { padding: .8rem clamp(1rem, 4vw, 3rem) 3rem; }
  .bar { display: flex; align-items: center; gap: 1rem; margin: .8rem 0; font-size: .85rem; color: #6b6558; }
  .track { flex: 1; height: 6px; background: #e4ded2; border-radius: 3px; overflow: hidden; }
  .track i { display: block; height: 100%; background: #7f8f6a; transition: width .2s; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  figure { margin: 0; background: #fff; border: 2px solid #e2dcd0; border-radius: 10px; overflow: hidden;
           cursor: pointer; transition: border-color .12s, transform .12s; }
  figure:hover { border-color: #7f8f6a; transform: translateY(-2px); }
  figure img { display: block; width: 100%; }
  figcaption { padding: .5rem .7rem .6rem; font-size: .8rem; color: #6b6558; }
  figcaption b { display: block; color: #3a3630; font-size: .92rem; }
  .keys { display: flex; gap: .6rem; justify-content: center; margin: 1rem 0 .4rem; }
  button { font: inherit; padding: .5rem 1.1rem; border-radius: 8px; border: 1px solid #d6cfc0;
           background: #fff; cursor: pointer; }
  button:hover { border-color: #7f8f6a; }
  button.primary { background: #7f8f6a; color: #fff; border-color: #7f8f6a; }
  textarea { width: 100%; box-sizing: border-box; font: inherit; padding: .5rem .6rem; margin-top: .5rem;
             border: 1px solid #d6cfc0; border-radius: 8px; min-height: 2.6rem; background: #fff; }
  .done { text-align: center; padding: 3rem 1rem; }
  .done pre { text-align: left; max-width: 46rem; margin: 1rem auto; background: #fff; padding: 1rem;
              border: 1px solid #e2dcd0; border-radius: 10px; overflow: auto; max-height: 40vh; font-size: .78rem; }
  kbd { font: inherit; font-size: .8rem; background: #fff; border: 1px solid #d6cfc0;
        border-bottom-width: 2px; border-radius: 5px; padding: 0 .35rem; }
</style></head>
<body>
<header>
  <h1>Which of these two is the nicer office?</h1>
  <p class="lede">Click the room you would rather work in — or <kbd>&larr;</kbd> / <kbd>&rarr;</kbd>,
     <kbd>=</kbd> for no preference. Go on gut feel and go quickly; there is no right answer and
     the point is your taste, not your reasoning. If one of them is obviously bad
     <em>because</em> of something, say so in the box — those notes are what turn into
     measurements. ${pairs.length} pairs, about ${Math.round(pairs.length / 7)}–${Math.round(pairs.length / 4)} minutes.</p>
</header>
<main id="app"></main>
<script>
const ROOMS = ${JSON.stringify(meta)};
const PAIRS = ${JSON.stringify(pairs)};
const DIR = ${JSON.stringify(dir)};
const KEY = ${JSON.stringify(key)};

let state = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.answers) return s; } catch {}
  return { at: 0, answers: [] };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }

const app = document.getElementById('app');

function card(seed, side) {
  const r = ROOMS[seed];
  return \`<figure data-pick="\${seed}" data-side="\${side}">
      <img src="\${DIR}/\${seed}.png" alt="Overhead render of a generated office"/>
      <figcaption><b>\${side === 'left' ? '← ' : ''}\${r.desks} desks\${side === 'right' ? ' →' : ''}</b>
        \${r.name}</figcaption>
    </figure>\`;
}

function render() {
  if (state.at >= PAIRS.length) return finish();
  const [a, b] = PAIRS[state.at];
  app.innerHTML = \`
    <div class="bar"><span>\${state.at + 1} / \${PAIRS.length}</span>
      <span class="track"><i style="width:\${(state.at / PAIRS.length) * 100}%"></i></span>
      <button id="back" \${state.at ? '' : 'disabled'}>Back</button></div>
    <div class="pair">\${card(a, 'left')}\${card(b, 'right')}</div>
    <div class="keys">
      <button id="tie">No preference (=)</button>
      <button id="skip">Skip</button>
    </div>
    <textarea id="why" placeholder="Why? Only if you feel strongly — e.g. 'the desks are all in one corner', 'nothing is by the windows', 'that couch is stranded'"></textarea>\`;

  for (const fig of app.querySelectorAll('figure')) {
    fig.addEventListener('click', () => answer(fig.dataset.pick));
  }
  app.querySelector('#tie').addEventListener('click', () => answer('tie'));
  app.querySelector('#skip').addEventListener('click', () => answer(null));
  app.querySelector('#back').addEventListener('click', () => {
    if (!state.at) return;
    state.at -= 1; state.answers.pop(); save(); render();
  });
}

function answer(winner) {
  const [a, b] = PAIRS[state.at];
  const why = (app.querySelector('#why')?.value ?? '').trim();
  state.answers.push({ a, b, winner, why: why || undefined });
  state.at += 1;
  save();
  render();
}

function finish() {
  const out = { version: 1, at: new Date().toISOString(), answers: state.answers };
  const text = JSON.stringify(out, null, 1);
  app.innerHTML = \`<div class="done">
      <h2>Done — thank you.</h2>
      <p>Copy this and paste it back into the conversation.</p>
      <button class="primary" id="copy">Copy results</button>
      <button id="again">Start again</button>
      <pre id="out">\${text.replace(/</g, '&lt;')}</pre>
    </div>\`;
  app.querySelector('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); app.querySelector('#copy').textContent = 'Copied'; }
    catch { app.querySelector('#out').scrollIntoView(); }
  });
  app.querySelector('#again').addEventListener('click', () => {
    state = { at: 0, answers: [] }; save(); render();
  });
}

document.addEventListener('keydown', (e) => {
  if (state.at >= PAIRS.length) return;
  // Not while somebody is typing their reasons. The first version bound these on
  // the document with no such check, so a space or an equals in the why box
  // answered the pair and moved the page on — which is why the first labelling
  // session came back with every choice and none of the reasons.
  const typing = e.target instanceof HTMLElement
    && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
  if (typing) return;
  const [a, b] = PAIRS[state.at];
  if (e.key === 'ArrowLeft') answer(a);
  else if (e.key === 'ArrowRight') answer(b);
  else if (e.key === '=' || e.key === ' ') { e.preventDefault(); answer('tie'); }
});

render();
</script>
</body></html>`;
}
