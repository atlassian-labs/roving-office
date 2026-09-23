// The bottom strip: the chrome every persistent panel is built from.
//
// Three panels stack along the bottom of the screen — Edit Mode, Scene and
// Developer — and they are the same object wearing different contents: a name on
// its own line, then a row of sections beneath it that holds its order at any
// width. That shape used to be written out once per panel, which is how the
// editor and the developer panel ended up with byte-identical `section`,
// `readout` and `segmented` functions and no way to change one without
// remembering the other.
//
// So the builders live here and the panels supply only what is different. The
// `dev-` class prefix is kept as-is: it is what styles.css already targets, and
// renaming it across the stylesheet would be a much wider change than this is.

import { closeButton, ensureHost, node } from './dom.js';

/**
 * A panel that lives in the bottom stack.
 *
 * `onClose` is what the strip's × does, and every strip should have one: the keys
 * are a shortcut, not the only door. It is the caller's business rather than a
 * `hide()` here because closing a strip is not always merely hiding it — shutting
 * Edit Mode has a whole mode to put away behind the panel.
 *
 * @param {object} opts
 * @param {string} opts.id           element id; the markup usually provides it
 * @param {string} opts.title        the panel's name, shown above its sections
 * @param {() => void} [opts.onClose]  what the × does; omitted draws no ×
 * @returns {{host: HTMLElement, body: HTMLElement, heading: HTMLElement}}
 */
export function createStrip({ id, title, onClose }) {
  const host = ensureHost(id, { className: 'hidden' });

  // Says what the strip is, in the roster's voice: one word, above its contents, in the
  // same small uppercase. `Agents`, `Developer`, `Edit Mode` — every panel that stays on
  // screen names itself the same way, and none of them says "panel", which the reader can
  // see for themselves.
  const heading = node('h2', '', title);

  // The sections live in a row that never wraps, and each one wraps its own controls
  // instead. Letting the row wrap meant a narrow window rearranged the panel — a group
  // would drop to a second line and everything after it would shuffle along — so the
  // same control was in a different place depending on the size of the window and
  // whether the inspector happened to be open. Sections holding their positions and
  // growing downwards instead costs a little height and keeps the panel learnable.
  const body = node('div', 'dev-panel-body');

  host.append(heading, body);

  // Placed in the strip's own top-right corner by CSS rather than inside the heading:
  // the editor already keeps its Last Action line up there, and the two share the
  // corner the same way — the × on the edge, the news beside it.
  if (onClose) host.appendChild(closeButton(`${title} panel`, onClose));

  return { host, body, heading };
}

/** Mark the first group on each flex row so dividers only separate neighbours. */
export function watchStripRows(body) {
  if (typeof ResizeObserver === 'undefined') return;
  const groups = [...body.children];
  const observer = new ResizeObserver(() => {
    const tops = groups.map((group) => group.getBoundingClientRect().top);
    groups.forEach((group, i) => {
      group.classList.toggle('dev-row-start', i === 0 || Math.abs(tops[i] - tops[i - 1]) > 1);
    });
  });
  observer.observe(body);
  // Selection changes can move a group without changing the panel's overall size.
  for (const group of groups) observer.observe(group);
}

/**
 * A titled group of controls. Append `.el` to a strip's body, fill `.body`.
 *
 * `.heading` is the h4 itself, handed back so that a caller with one control that
 * belongs *to the section* rather than in it — a picker naming what the section is
 * showing — can put it on the title's own line. It goes inside the heading rather
 * than into a row wrapped around it, which is what the editor's Layout section does
 * with its picker, and the reason is in styles.css: a control is taller than a line
 * of small caps, and every heading in a strip is given that height so one section
 * growing a picker cannot drop its title below its neighbours'.
 */
export function section(name) {
  const el = node('div', 'dev-group');
  const h = node('h4', '', name);
  const body = node('div', 'dev-group-body');
  el.append(h, body);
  return { el, heading: h, body };
}

/**
 * A label/value row, unattached. For rows that come and go — hand back the element so
 * the caller can show and hide it — where `readout` is the common case that just stays.
 * @returns {{el: HTMLElement, value: HTMLElement}}
 */
export function kv(label) {
  const el = node('div', 'dev-kv');
  const key = node('span', 'dev-k', label);
  const value = node('span', 'dev-v', '—');
  el.append(key, value);
  return { el, key, value };
}

/** A label/value row inside a group. Returns the value node, for repainting. */
export function readout(group, label) {
  const row = kv(label);
  group.body.appendChild(row.el);
  return row.value;
}

/**
 * A row of mutually exclusive lozenges, one per key of `source`.
 *
 * `stacked` lays them in a column instead, one under another. Worth having as an
 * option rather than left to the caller's own CSS: a group of four that wraps to two
 * rows at one panel width and three at another is a control that moves about, and in
 * a tall panel there is height to spend on holding still.
 *
 * @returns {Map<string, HTMLButtonElement>} keyed by option, for marking active
 */
export function segmented(parent, source, onPick, { stacked = false } = {}) {
  const wrap = node('div', stacked ? 'dev-seg dev-seg-stack' : 'dev-seg');
  const buttons = new Map();
  for (const [key, spec] of Object.entries(source)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = key;
    b.textContent = spec.label ?? key;
    b.addEventListener('click', () => onPick(key));
    wrap.appendChild(b);
    buttons.set(key, b);
  }
  parent.appendChild(wrap);
  return buttons;
}

/** A plain lozenge button. */
export function button(text, title) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dev-btn';
  b.textContent = text;
  if (title) b.title = title;
  return b;
}
