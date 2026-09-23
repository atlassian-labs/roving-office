// Small DOM helpers shared by the overlay panels.

/**
 * An element, with the two things the chrome almost always says about one.
 *
 * Every panel in here is built imperatively — there is no template engine and no DOM
 * library — so a panel's markup was written as a run of three-line stanzas: make a
 * `span`, give it a class, give it words. Two hundred of them across the chrome, each
 * three lines of ceremony around one line of intent, which left the *shape* of a panel
 * buried in the mechanics of building it. One line per element, and a `paint` function
 * reads as the thing it draws.
 *
 * The class comes second because it is what the element *is*: the stylesheet carries
 * every appearance decision, so `'legend-count'` says more about that span than `span`
 * does. It is assigned even when empty, which costs nothing — a fresh element's
 * `className` is already `''` — and keeps the argument in one position for every caller.
 *
 * The words are a rest parameter so that *passing* them is what counts, not what they
 * turn out to be. `node('span', 'count')` has to leave `textContent` alone for a caller
 * that fills it in later, while `node('span', 'count', row.label)` has to write whatever
 * the caller handed over — including `undefined`, which draws the word "undefined" in
 * the panel. That is a bug worth seeing rather than one worth swallowing here.
 *
 * @param {string} tag           element name, e.g. 'span'
 * @param {string} [className]   classes to apply
 * @param {...*} [text]          its words, if it has any of its own
 * @returns {HTMLElement}
 */
export function node(tag, className = '', ...text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text.length) el.textContent = text[0];
  return el;
}

/**
 * A palette colour as a CSS string.
 *
 * The status palette in config.js is numeric because three.js wants it that way;
 * every panel that paints a status dot needs the same number as `#rrggbb`.
 */
export function hex(n) {
  return '#' + n.toString(16).padStart(6, '0');
}

/**
 * Find a panel's host element, creating it if the markup does not provide one.
 *
 * Panels that build their entire contents in JS only need a positioned box to
 * live in, and that box is placed by CSS rather than by where it sits in the
 * document. Throwing when it is absent means a missing line of boilerplate in
 * index.html takes down everything constructed after it — which is how a
 * developer panel once stopped the render loop from ever starting.
 *
 * So the markup stays the source of truth for structure and reading order, but
 * its absence degrades to a panel that still works instead of a blank screen.
 *
 * @param {string} id                 element id to look for
 * @param {object} [opts]
 * @param {string} [opts.className]   classes to apply when creating it
 * @param {ParentNode} [opts.parent]  where to append; defaults to #ui, then body
 * @returns {HTMLElement}
 */
export function ensureHost(id, { className = '', parent } = {}) {
  const existing = document.getElementById(id);
  if (existing) return existing;

  const host = document.createElement('div');
  host.id = id;
  if (className) host.className = className;

  const target = parent ?? document.getElementById('ui') ?? document.body;
  target.appendChild(host);

  console.warn(`ensureHost: #${id} was missing from the markup, so it was created.`);
  return host;
}

/**
 * The way out of a panel, for a mouse.
 *
 * Every panel here is opened and closed by a key, and for a while only the agent
 * inspector and the shortcuts card also carried an ×. That left the keys as the
 * *only* way to put the rest away, which is a poor bargain for a visitor who opened
 * a strip by clicking something and never learned that `S` closes it again — and the
 * two panels that did have one had drawn it twice, in two stylesheets' worth of
 * near-identical rules.
 *
 * So there is one × for the whole office. It says what it closes rather than just
 * "Close", because a screen reader meets several of them in one overlay.
 *
 * @param {string} name             what it closes, e.g. 'Scene panel'
 * @param {() => void} onClose      invoked on click
 * @returns {HTMLButtonElement}
 */
export function closeButton(name, onClose) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'panel-close';
  el.setAttribute('aria-label', `Close ${name}`);
  el.title = `Close ${name}`;
  el.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.5"/></svg>';
  el.addEventListener('click', (event) => {
    // A panel may sit over the canvas, and the click that closes it is not a click on
    // the room behind it — nor, in a strip, on the section it happens to land in.
    event.stopPropagation();
    onClose();
  });
  return el;
}
