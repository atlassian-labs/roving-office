// The mechanics every instrument in the Scene panel needs before it can draw.
//
// Two of the panel's controls are pictures rather than widgets — the compass card
// and the world map — and they are drawn rather than styled. That leaves each of
// them owning the same three chores before a single line of its own subject gets
// painted: put a canvas on the page that a keyboard and a screen reader can find,
// get a context measured in CSS pixels on a screen that has more of its own, and
// turn a press-and-sweep into a stream of positions.
//
// None of those chores is about a compass or about a map, and neither instrument
// was doing them differently — they were doing them identically, in two files, so
// a hairline that stayed a hairline in one place was a matter of two functions
// happening to agree. They agree here instead.
//
// What is *not* here is the arrow keys. Both controls nudge on a key press, but a
// bearing wraps round through 360 on one axis while a pin clamps at the poles and
// wraps at the date line on two, so there is no shared step to take — only a
// shared habit of taking one.

import { node } from './dom.js';

/** Palette fallbacks, for a canvas painted before the stylesheet is in force. */
const FALLBACKS = {
  '--text': '#243247',
  '--muted': '#53677a',
  '--brand': '#1868db',
};

/**
 * A canvas the reader can reach: named, classed, and in the tab order.
 *
 * Focusable because both of these are controls — the picture is how they are
 * operated, not decoration next to something else that operates them — and a
 * control that cannot be tabbed to has no keyboard at all.
 *
 * @param {object} opts
 * @param {string} opts.className  what styles.css sizes and places it by
 * @param {string} opts.role       what it is, to anything that cannot see it
 * @param {string} opts.label      what it is for, in words
 * @returns {HTMLCanvasElement}
 */
export function controlCanvas({ className, role, label }) {
  const canvas = node('canvas', className);
  canvas.setAttribute('role', role);
  canvas.setAttribute('aria-label', label);
  canvas.tabIndex = 0;
  return canvas;
}

/**
 * A context to paint one frame into, at the device's own resolution.
 *
 * The canvas is sized in device pixels and scaled back down by CSS, then the
 * context is pre-transformed by the same ratio — so the caller goes on drawing in
 * the CSS pixels it laid the control out in, and hairlines stay hairlines on a
 * retina screen instead of being drawn once at half the density and scaled up.
 *
 * Called per repaint rather than once at construction: the ratio changes when a
 * window is dragged between screens, and a picture redrawn eight times a second
 * would otherwise keep the density it was born with.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} width   CSS pixels
 * @param {number} height  CSS pixels
 * @returns {CanvasRenderingContext2D}
 */
export function hidpiContext(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * The office's own ink, for a picture that has to match the chrome around it.
 *
 * Read per repaint from the document rather than captured, because the palette is
 * a CSS custom property the theme switch changes underneath a running office —
 * a colour captured at construction would keep the theme the panel opened in.
 *
 * @param {...string} names  custom properties, e.g. '--text'
 * @returns {string[]} in the order asked for
 */
export function themeInk(...names) {
  const css = getComputedStyle(document.documentElement);
  return names.map((name) => css.getPropertyValue(name).trim() || FALLBACKS[name]);
}

/**
 * Press and sweep, as a stream of positions.
 *
 * `onPoint` is called for the press itself and then for every move until the
 * release, which is what makes both of these controls answer while they are being
 * dragged rather than only where the pointer was let go.
 *
 * The pointer is captured on the way down so the sweep survives leaving the
 * canvas: a bearing being turned past north and a pin being dragged toward a
 * coastline both routinely go outside a control 96 to 232 pixels wide, and
 * without capture the drag would simply stop there. Releasing it can throw if the
 * browser has already taken it back — a cancelled gesture does — and that is not
 * a failure of anything, so it is swallowed.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {(ev: PointerEvent) => void} onPoint
 */
export function onDrag(canvas, onPoint) {
  let dragging = false;

  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true;
    canvas.setPointerCapture(ev.pointerId);
    onPoint(ev);
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (dragging) onPoint(ev);
  });

  const stop = (ev) => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* already gone */ }
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
}
