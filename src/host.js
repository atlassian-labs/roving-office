// A small control surface for whoever is embedding the office.
//
// The office already embeds well: point a frame or a web view at
// /office/<keycard> and it feeds itself, because its stream and its API are on
// its own origin. What an embedder cannot currently do is *adjust* it. There is
// no way to say "this is a 425px panel, drop the roster" or "frame the room
// tighter", so a host is left with whatever the office does at that viewport.
//
// Two embedders hit this independently. RovoSwift works around it by injecting
// JavaScript, which a native WKWebView host is allowed to do; Quick Glance cannot,
// because a cross-origin iframe has no such reach, and instead over-sizes the
// frame and scales it down so the office's fixed-width panels take a smaller share
// of it. Both are working around the same missing seam, and the second one only
// makes the chrome smaller, never absent.
//
// So: a documented seam. Everything here is a knob the office already had
// internally, exposed in two equivalent ways.
//
//   ?chrome=minimal&frame=fill       on the URL, applied before the first frame
//   postMessage({ type: 'office:set', chrome: 'minimal' })   at any time
//
// The URL half matters as much as the messages: a host that can only set a `src`
// gets the same control, and it lands before boot rather than as a visible jump
// afterwards.
//
// Nothing here is new behaviour. `chrome` toggles a data attribute that styles.css
// reads, `look` forwards to the same override path the Look menu already uses, and
// `camera` writes the zoom and target the controls already own. If the office
// grows a knob, it belongs in KNOBS below and nowhere else.

import { FRAME_MODES } from './scene/framing.js';

/** What `chrome` may be, loosest first. */
export const CHROME_LEVELS = ['full', 'minimal', 'none'];

/**
 * The knobs, and how to read one out of a string.
 *
 * A table rather than a chain of ifs, because the URL parser and the message
 * handler must agree exactly: a host that sets `zoom=1.8` on the URL and then
 * messages `zoom: 1.8` should not be able to get two different results.
 */
const KNOBS = {
  chrome: (raw) => (CHROME_LEVELS.includes(raw) ? raw : null),
  frame: (raw) => (FRAME_MODES.includes(raw) ? raw : null),
  zoom: (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  },
  season: (raw) => (typeof raw === 'string' && raw ? raw : null),
  building: (raw) => (typeof raw === 'string' && raw ? raw : null),
  lights: (raw) => (typeof raw === 'string' && raw ? raw : null),
  hour: (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n < 24 ? n : null;
  },
};

/**
 * Read the knobs out of a query string, ignoring everything else.
 *
 * Unknown keys and unparseable values are dropped rather than defaulted, so a
 * typo leaves the office alone instead of silently reframing it. The office's own
 * parameters (`edit`, and the keycard in the path) are none of this function's
 * business and are not in KNOBS.
 */
export function knobsFromSearch(search) {
  const params = new URLSearchParams(search ?? '');
  const out = {};
  for (const [key, parse] of Object.entries(KNOBS)) {
    if (!params.has(key)) continue;
    const value = parse(params.get(key));
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * The same, from a message body.
 *
 * Shares KNOBS with the URL parser on purpose. Values arrive already typed here,
 * so the parsers are written to accept both a number and its string form.
 */
export function knobsFromMessage(message) {
  if (!message || typeof message !== 'object') return {};
  const out = {};
  for (const [key, parse] of Object.entries(KNOBS)) {
    if (!(key in message)) continue;
    const value = parse(message[key]);
    if (value !== null) out[key] = value;
  }
  return out;
}

/**
 * Whether a message is one of ours, and from somewhere entitled to send it.
 *
 * The office is reachable by anyone holding the keycard, so an embedded office
 * must not take orders from any window that can find it. Two conditions, and both
 * are needed:
 *
 * - It has to come from the thing that framed us. `event.source === window.parent`
 *   with `window.parent !== window` means exactly "our embedder", and nothing
 *   about the sender's origin has to be guessed. A page nobody framed accepts no
 *   commands at all, which is the right answer for the standalone office.
 * - It has to be addressed to us. The `office:set` tag keeps this from firing on
 *   the unrelated postMessage traffic a host may already have.
 *
 * Origin is deliberately not checked against a list. An embedder's origin is not
 * knowable here — it is `tauri://localhost` for one of them and a custom scheme
 * for another — and a list that has to be edited per host is a list that ends up
 * as `*`.
 */
export function isHostMessage(event, view = window) {
  if (view.parent === view) return false;
  if (event?.source !== view.parent) return false;
  const data = event?.data;
  return Boolean(data) && typeof data === 'object' && data.type === 'office:set';
}

/**
 * Apply knobs to the running office.
 *
 * `apply` is injected rather than imported so this module holds no reference to
 * the scene: it makes the seam testable without a WebGL context, and keeps the
 * office's internals the caller's business.
 */
export function applyKnobs(knobs, apply) {
  if (knobs.chrome !== undefined) apply.chrome(knobs.chrome);
  // Frame before zoom: `frame` computes a zoom from the viewport, so a host that
  // sends both means "fill, but actually this much", and the explicit number has
  // to be the one that survives.
  if (knobs.frame !== undefined) apply.frame(knobs.frame);
  if (knobs.zoom !== undefined) apply.zoom(knobs.zoom);

  // Look is one call, because season and building both rebuild the scene and
  // doing them separately would rebuild it twice for one message.
  const look = {};
  for (const key of ['season', 'building', 'lights', 'hour']) {
    if (knobs[key] !== undefined) look[key] = knobs[key];
  }
  if (Object.keys(look).length) apply.look(look);
}

/**
 * Start listening, and apply whatever the URL already asked for.
 *
 * Returns a function that stops listening, so a host that tears the office down
 * does not leak a handler onto `window`.
 */
export function startHostApi({ apply, view = window }) {
  applyKnobs(knobsFromSearch(view.location?.search), apply);

  const onMessage = (event) => {
    if (!isHostMessage(event, view)) return;
    applyKnobs(knobsFromMessage(event.data), apply);
  };

  view.addEventListener('message', onMessage);

  // Tell the embedder we are listening, so it can send its first `office:set`
  // without polling or guessing at a boot delay. Sent to the parent only, and
  // with `'*'` because the parent's origin is not knowable from in here; the
  // payload carries nothing that is not already visible in the URL.
  if (view.parent !== view) {
    view.parent.postMessage(
      { type: 'office:ready', chrome: CHROME_LEVELS, frame: FRAME_MODES },
      '*',
    );
  }

  return () => view.removeEventListener('message', onMessage);
}
