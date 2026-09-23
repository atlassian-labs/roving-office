// Who a desk belongs to, and what happens to them when it is deleted.
//
// A desk is booked for as long as its occupant is in the building rather than for the
// length of a job. These checks pin the editor's "Assigned to" lookup and the room
// quietly rehousing somebody whose desk has just been deleted out from under them.
//
// Neither is visible in a screenshot, and both are the kind of thing that silently stops
// working. Deleting furniture in the editor while five agents are working is also as
// awkward a moment as this office has, so it is worth pinning that the awkwardness is
// handled rather than merely survived.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom } from './lib/room.js';

let THREE, AgentManager, buildDesk, DESKS;

before(async () => {
  ({ THREE, AgentManager } = await loadRoom());
  ({ buildDesk } = await import('../src/scene/props/desk.js'));
  ({ DESKS } = await import('../src/layout.js'));
});

/** A room with `n` desks and `names.length` agents, each of whom claims one on arrival. */
function office(n, names) {
  const desks = [];
  for (let i = 0; i < n; i++) {
    desks.push(buildDesk({ id: `desk-${i + 1}`, x: i * 6, z: 8, facing: 0 }, i).handle);
  }
  const props = { desks };
  const manager = new AgentManager(new THREE.Group(), props);
  names.forEach((name, i) => manager.handleEvent({ type: 'spawn', id: `a-${i}`, name }));
  return { manager, props, desks };
}

test('a desk names its occupant, and a free one names nobody', () => {
  const { manager, desks } = office(3, ['Ada Lovelace', 'Grace Hopper']);

  // One name each and no doubling up, which is the whole of the booking: two agents, so
  // one of the three desks belongs to nobody at all. Which desk is whose is not asserted,
  // because an arrival picks from the free ones at random.
  const named = desks.map((d) => manager.deskOccupantName(d.id));
  assert.deepEqual(named.filter((n) => n === 'Ada'), ['Ada']);
  assert.deepEqual(named.filter((n) => n === 'Grace'), ['Grace']);
  assert.deepEqual(named.filter((n) => n === null), [null]);

  // First name only: the editor row it feeds is a narrow one, and the surname earns
  // nothing there.
  assert.ok(!named.some((n) => n?.includes('Lovelace')));

  // A desk that is not in the room is not an error, it is nobody's — the editor asks
  // about whatever is selected, and a selection can be stale by a frame.
  assert.equal(manager.deskOccupantName('desk-nowhere'), null);
});

test('delete somebody\u2019s desk and they are given another one', () => {
  const { manager, props, desks } = office(3, ['Ada', 'Grace']);
  const ada = desks.find((d) => manager.deskOccupantName(d.id) === 'Ada');
  const grace = desks.find((d) => manager.deskOccupantName(d.id) === 'Grace');
  const spare = desks.find((d) => !d.occupiedBy);

  // Ada's desk is deleted in the editor: it goes out of the room, and the room is asked to
  // pick itself up. The spare is the only desk she can land on.
  props.desks = desks.filter((d) => d !== ada);
  manager.relayout();

  assert.equal(manager.deskOccupantName(ada.id), null, 'the deleted desk still has her');
  assert.equal(manager.deskOccupantName(spare.id), 'Ada', 'Ada was not rehoused');
  // And not by evicting anybody: Grace keeps hers.
  assert.equal(manager.deskOccupantName(grace.id), 'Grace');
});

test('an arrival takes a free desk at random, not the first one going', () => {
  // The bug this pins. Booking used to be `find((d) => !d.occupiedBy)`, so the layout's
  // order was a pecking order: desk 1 went to the first person through the door every
  // time, and the far end of the row was only ever used in a full house. Sixty rooms of
  // five desks with one arrival each — under the old pick, sixty claims on desk 1.
  const claimed = new Set();
  for (let i = 0; i < 60; i++) {
    const { manager, desks } = office(5, ['Ada']);
    claimed.add(desks.findIndex((d) => manager.deskOccupantName(d.id) === 'Ada'));
  }
  assert.equal(claimed.size, 5, `only desks ${[...claimed].sort()} were ever claimed`);
});

test('with no spare desk, they wait for one rather than sharing', () => {
  // The honest case, and the one that must not be papered over: two agents, two desks,
  // delete one, and somebody genuinely has nowhere to work until a desk is added or a
  // colleague goes home. What would be a bug is two people booked onto one desk.
  const { manager, props, desks } = office(2, ['Ada', 'Grace']);
  const kept = desks[1];
  const keeper = manager.deskOccupantName(kept.id);
  props.desks = [kept];
  manager.relayout();

  assert.equal(manager.deskOccupantName(kept.id), keeper, `${keeper} was turfed out`);
  const booked = desks.filter((d) => d.occupiedBy);
  assert.deepEqual(booked, [kept],
    'the only booking should be the keeper on the only desk left in the room');
});

test('the authored room has five desks, exactly one of which is sit-stand', () => {
  // The headcount is the length of this list, so a sixth desk would have hired a sixth
  // agent to justify one piece of furniture. The sit-stand desk replaces a desk rather
  // than joining them.
  assert.equal(DESKS.length, 5);
  const standing = DESKS.filter((d) => d.standing);
  assert.equal(standing.length, 1, 'the room should have exactly one sit-stand desk');
  // Not the one on the rug: a standing mat on a rug is two flat things at the same height,
  // which is the coplanar pair the probe fails the build over.
  assert.notEqual(standing[0].id, 'desk-1');
});
