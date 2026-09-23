// The prop registry: every kind of station and furniture the office can hold,
// with its builder and — where the common mounting pattern is not enough — its
// own way of being put into the room.
//
// This is data/sources.js's pattern applied to props. A definition is one file
// in this directory; this index is the one place it is named. The layout's kind
// tables (layout.js) stay the authority on what may exist and what floor it
// blocks — and the checks at the bottom make the two impossible to drift apart:
// a kind with no builder, or a builder for a kind the layout has never heard
// of, fails the first import loudly rather than failing a click quietly.
//
// So adding a prop is: one builder file here, one line in PROPS, one entry in
// the layout's kind table — and the mismatch checks catch whichever of the
// three is forgotten. The editor, the nav grid and the sync machinery read the
// tables and this registry; none of them name kinds by hand any more.

import { STATION_KINDS, FURNITURE_KINDS } from '../../layout.js';

import { buildBookshelf, mount as mountBookshelf } from './bookshelf.js';
import { buildWaterCooler } from './water-cooler.js';
import { buildCoffeeStation } from './coffee-station.js';
import { buildMailbox, mount as mountMailbox } from './mailbox.js';
import { buildBin } from './bin.js';
import { buildInbox } from './inbox.js';
import { buildCoatStand, mount as mountCoatStand } from './coat-stand.js';
import { buildArmchair, buildCouch, mount as mountCouch, mountArmchair } from './couch.js';
import { buildSideTable } from './side-table.js';
import { buildFloorLamp } from './floor-lamp.js';
import { buildPrinter } from './printer.js';
import { buildTelescope, mount as mountTelescope } from './telescope.js';
import { mount as mountRug } from './rug.js';

/**
 * kind → { build, mount? }
 *
 * `build()` raises the prop at its own origin. `mount(spec, handles, label)` is
 * only present where the common pattern in scene/props.js is not enough — a
 * bookshelf carries a globe and registers into a list, the mailbox sits a
 * quarter turn behind its facing, a couch's seats carry bookings, the coat
 * stand has a facing but nowhere to queue.
 */
export const PROPS = {
  bookshelf: { build: buildBookshelf, mount: mountBookshelf },
  waterCooler: { build: buildWaterCooler },
  coffee: { build: buildCoffeeStation },
  mailbox: { build: buildMailbox, mount: mountMailbox },
  bin: { build: buildBin },
  inbox: { build: buildInbox },
  printer: { build: buildPrinter },
  telescope: { build: buildTelescope, mount: mountTelescope },
  coatStand: { build: buildCoatStand, mount: mountCoatStand },
  couch: { build: buildCouch, mount: mountCouch },
  armchair: { build: buildArmchair, mount: mountArmchair },
  sideTable: { build: buildSideTable },
  floorLamp: { build: buildFloorLamp },
  rug: { mount: mountRug },
};

for (const kind of [...Object.keys(STATION_KINDS), ...Object.keys(FURNITURE_KINDS)]) {
  if (!PROPS[kind]) throw new Error(`prop registry: no builder for kind '${kind}'`);
}
for (const kind of Object.keys(PROPS)) {
  if (!STATION_KINDS[kind] && !FURNITURE_KINDS[kind]) {
    throw new Error(`prop registry: '${kind}' is not a kind the layout knows`);
  }
}

// The desk is not a kind — it is the seat of an agent thread, with its own list
// and limits — and the wall clock is a room fixture, screwed to a wall. Their builders
// live here with the rest so there is exactly one place a prop is built from,
// which is also what the catalogue photographs.
export { buildDesk, buildAeronChair, SEAT_HEIGHT, DESK_TOP_Y, codeScreenTexture } from './desk.js';
export { buildRug } from './rug.js';
export { buildWallClock } from './wall-clock.js';
export { buildEspressoMachine } from './coffee-station.js';
export { buildBookshelf } from './bookshelf.js';
export { buildWaterCooler } from './water-cooler.js';
export { buildCoffeeStation } from './coffee-station.js';
export { buildMailbox } from './mailbox.js';
export { buildBin } from './bin.js';
export { buildInbox } from './inbox.js';
export { buildPrinter } from './printer.js';
export { buildTelescope } from './telescope.js';
export { buildCoatStand } from './coat-stand.js';
export { buildCouch } from './couch.js';
export { buildArmchair } from './couch.js';
export { buildSideTable } from './side-table.js';
export { buildFloorLamp } from './floor-lamp.js';
