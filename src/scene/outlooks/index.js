// The outlook registry: every world that can be outside the windows, and the
// grammar of the mode strings that name them.
//
// The same deal the prop registry strikes (scene/props/index.js): projects.js
// stays the authority on which modes exist — OUTSIDE_MODES is data, three-free,
// and what the themes and BUILDINGS point at — while this index owns how each
// outlook is built. The checks at the bottom weld the two together at first
// import: a mode with no outlook behind it, or an outlook no mode can reach,
// fails loudly before anything renders.
//
// Adding an outlook is: one module in this directory exporting its definition,
// one line in OUTLOOKS, one mode string in projects.js — and the checks catch
// whichever is forgotten. The dispatcher (scene/exterior.js) never names one.

import { OUTSIDE_MODES } from '../../projects.js';
import { outlook as street } from './street.js';
import { outlook as skyline } from './skyline.js';
import { outlook as paris } from './paris.js';
import { outlook as canopy } from './canopy-garden.js';
import { outlook as tide } from './tide-harbour.js';
import { outlook as dune } from './dune-courtyard.js';
import { outlook as lantern } from './lantern-garden.js';

/**
 * id → { id, label, aerial, ground(season) → {y, color?}, build(g, ctx) }
 *
 * `aerial` outlooks look down on their own ground, own its level, and never
 * take the per-storey street drop. `ground` is what the dispatcher's shared
 * base plane should be; `build` raises everything standing on it.
 */
export const OUTLOOKS = {
  [street.id]: street,
  [skyline.id]: skyline,
  [paris.id]: paris,
  [canopy.id]: canopy,
  [tide.id]: tide,
  [dune.id]: dune,
  [lantern.id]: lantern,
};

/**
 * The outlook an exterior mode names. Street modes carry their season in the
 * id — 'street-winter' — so every 'street-*' is the one street outlook; an
 * aerial mode is its own id.
 */
export function outlookOf(mode) {
  return mode.startsWith('street-') ? 'street' : mode;
}

/** The season named in an exterior mode, for the modes that carry one. */
export function seasonOf(mode) {
  return mode.startsWith('street-') ? mode.slice('street-'.length) : 'summer';
}

for (const mode of OUTSIDE_MODES) {
  if (!OUTLOOKS[outlookOf(mode)]) {
    throw new Error(`outlook registry: no outlook behind mode '${mode}'`);
  }
}
for (const id of Object.keys(OUTLOOKS)) {
  if (!OUTSIDE_MODES.some((m) => outlookOf(m) === id)) {
    throw new Error(`outlook registry: '${id}' is reachable by no mode in projects.js`);
  }
}
