// Where a thrown parcel lands, and what happens when there is nowhere obvious.
//
// A parcel is the one arrival that does not need a *slot*. A paper plane has to dive
// into something and a fax has to come out of something, but a courier can put a box
// down beside anything — so a package may land at any station work arrives at, and
// `PARCEL_PREFERENCE` in src/layout.js only decides which he picks when the room offers
// more than one kind: the post first, then the printer, the stack of cartons last.
//
// The reason this file exists is the bug underneath it. Both delivery channels aimed
// with `?? STATIONS.mailbox`, which was safe for exactly as long as the mailbox could
// not be deleted — and the printer was then given both of the post's jobs, so the post
// became removable and that fallback became `undefined.x`. In the courier's case it
// threw *in the constructor*, so a room with no post box did not render at all: a black
// screen, not a missing parcel. Every test in the suite passed, because the tests build
// `AgentManager` with stub props and never construct the real scenery.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let THREE, CourierDeliveries, MailFlights, layout;

before(async () => {
  stubDom();
  THREE = await loadThree();
  ({ CourierDeliveries } = await import('../src/scene/courier.js'));
  ({ MailFlights } = await import('../src/scene/mail.js'));
  layout = await import('../src/layout.js');
});

beforeEach(() => layout.resetLayout());

/** Strip the room down to the intake stations named, as far as the rules allow. */
function keepOnly(...keep) {
  for (const id of ['mailbox', 'inbox', 'printer']) {
    if (keep.includes(id)) continue;
    if (layout.canRemoveObject(`station:${id}`).ok) layout.removeObject(`station:${id}`);
  }
  layout.reviseLayout();
  return layout.stationsForRole('intake').map((s) => s.id);
}

// --- the preference order ----------------------------------------------------

test('a parcel goes to the post first, then the printer, then the stack', () => {
  assert.equal(layout.postBoxFor(Math.random, 'package').kind, 'mailbox',
    'with a post box in the room a parcel is post, and goes to it');

  keepOnly('inbox', 'printer');
  assert.equal(layout.postBoxFor(Math.random, 'package').kind, 'printer',
    'no post box, so the machine — it has a front and somebody walks to it');

  // The inbox tier is unreachable in the room as it ships, because dispatch needs the
  // post or the printer and taking both away is refused. It is still the right rule:
  // the day a dispatch-only kind exists, a room can be inbox-plus-that and a parcel has
  // to land somewhere. Asserted through `landingsFor` rather than by building that room.
  assert.deepEqual(layout.landingsFor('package').map((s) => s.kind), ['printer']);
});

test('a plane still needs a slot, so it does not follow the parcel', () => {
  // The asymmetry is the point: a courier puts a box down, a plane dives in. A room
  // with no post box can take a parcel and cannot take a letter, and the channel says
  // so rather than flying one at a printer.
  keepOnly('inbox', 'printer');
  assert.deepEqual(layout.landingsFor('letter'), []);
  assert.equal(layout.postBoxFor(Math.random, 'letter'), null);
  assert.ok(layout.enabledArrivals(['letter', 'package', 'fax']).includes('package'));
  assert.ok(!layout.enabledArrivals(['letter', 'package', 'fax']).includes('letter'));
});

// --- the crash ---------------------------------------------------------------

test('the delivery scenery builds in a room with no post box', () => {
  // The bug, as the smallest thing that reproduces it: `CourierDeliveries` aims in its
  // own constructor, so this threw before any parcel was ever sent.
  keepOnly('printer');
  assert.equal(layout.STATIONS.mailbox, undefined, 'the post should be gone');
  assert.doesNotThrow(() => {
    new CourierDeliveries(new THREE.Group(), { boxAt: () => null, onArrive: () => {} });
  }, 'a room with no post box did not render at all');
  assert.doesNotThrow(() => {
    new MailFlights(new THREE.Group(), () => null);
  }, 'the plane channel has the same fallback');
});

test('with nowhere at all to put one down, the courier refuses the round', () => {
  // Unreachable through the editor — `intake` is required, so a room always has at
  // least one of the three — but the belt to that braces. A courier who sets off for a
  // room with no landing spot walks in, heaves, and throws a parcel at the floor.
  keepOnly('printer');
  const deliveries = new CourierDeliveries(new THREE.Group(), {
    boxAt: () => null, onArrive: () => {},
  });
  assert.equal(deliveries.canDeliver, true, 'the printer will take one');
  assert.equal(deliveries.launch({ arrival: 'package', box: 'printer' }), true);
});

test('a parcel with no box named still lands somewhere sensible', () => {
  // The manager always stamps a box, so this is a caller that did not — and aiming at
  // the origin (what removing the mailbox fallback left behind) throws the box into the
  // corner of the floor, which looks like a bug because it is one.
  keepOnly('printer');
  const deliveries = new CourierDeliveries(new THREE.Group(), {
    boxAt: () => null, onArrive: () => {},
  });
  deliveries.launch({ arrival: 'package', box: null });
  assert.ok(deliveries.target.x > 1, `aimed at x ${deliveries.target.x}, which is the corner`);
  assert.equal(Math.round(deliveries.target.x), Math.round(layout.STATIONS.printer.x));
});

// --- the parcel is visible where it lands ------------------------------------

test('a parcel waiting at a station with no pile of its own is still drawn', () => {
  // `onArrive` hides the thrown box and hands over to the receiving station's own pile
  // — which the post box has and a printer does not, so the parcel simply vanished on
  // touchdown. The delivery channel draws those, at the spot it threw them.
  // Both kept, because the last assertion is about *changing* station and a station
  // that is not in the room draws nothing — which is correct, and would have made this
  // pass for the wrong reason.
  keepOnly('inbox', 'printer');
  const deliveries = new CourierDeliveries(new THREE.Group(), {
    boxAt: () => null, onArrive: () => {},
  });
  const shown = () => deliveries.dropped.filter((d) => d.visible).length;
  assert.equal(shown(), 0);

  deliveries.showDropped('printer', 2);
  assert.equal(shown(), 2, 'two parcels waiting should be two parcels lying there');
  const [first] = deliveries.dropped;
  assert.ok(Math.abs(first.position.x - layout.STATIONS.printer.x) < 1.2,
    'they should be beside the machine, not somewhere else in the room');

  // Collected, and they go.
  deliveries.showDropped('printer', 0);
  assert.equal(shown(), 0);

  // And a change of station clears the old pile rather than leaving boxes beside
  // furniture that is no longer receiving.
  deliveries.showDropped('printer', 3);
  deliveries.showDropped('inbox', 1);
  assert.equal(shown(), 1);
});
