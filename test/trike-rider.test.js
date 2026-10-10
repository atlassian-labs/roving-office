import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom, arrived } from './lib/room.js';
import { playUntil } from './lib/frames.js';

let THREE, layout, buildHappyHourTrike, loadHappyHourTrike;
before(async () => {
  ({ THREE } = await loadRoom());
  layout = await import('../src/layout.js');
  ({ buildHappyHourTrike } = await import('../src/scene/props/adult-tricycle.js'));
  ({ loadHappyHourTrike } = await import('../src/scene/outlooks/streetscape.js'));
});
beforeEach(() => layout.resetLayout());

function drinksCart() {
  layout.removeObject('station:waterCooler');
  layout.removeObject('station:coffee');
  const station = layout.addStation('happyHourTrike', { x: 3, z: 10 });
  layout.reviseLayout();
  const cart = buildHappyHourTrike();
  new THREE.Group().add(cart.obj);
  const { manager, rec } = arrived({ byStation: { [station.id]: cart.handle } });
  return { ...cart, station, manager, rec, rider: cart.obj.getObjectByName('happy-hour-attendant') };
}

test('the trike arrives staffed and its rider pedals while the street cart cruises', () => {
  const mount = loadHappyHourTrike(new THREE.Group(), 21, -1.8);
  const rider = mount.getObjectByName('happy-hour-attendant');
  assert.ok(rider?.visible, 'a visible person occupies the saddle');
  const initial = rider.children.map((part) => part.position.clone());
  const start = mount.position.clone();
  mount.userData.cruise(0.2);
  assert.ok(start.distanceTo(mount.position) > 0.1);
  assert.ok(rider.children.some((part, i) => initial[i].distanceTo(part.position) > 0.05), 'feet follow the pedals');
  rider.removeFromParent();
  const stopped = mount.position.clone();
  mount.userData.cruise(1);
  assert.equal(stopped.distanceTo(mount.position), 0, 'an empty saddle cannot drive the cart');
});

test('the parked rider hands a drink to an arriving agent and settles back on the bars', () => {
  const { handle, rider, manager, rec } = drinksCart();
  assert.equal(handle.canServe, true);
  manager.handleEvent({ type: 'activity', id: 'a1', activity: 'drink' });
  assert.notEqual(playUntil(manager, () => rec.agent.carrying === 'cup', 30), null, 'the attendant serves a cup after the walk');
  handle.update(0.4);
  const arm = rider.getObjectByName('serving-arm');
  assert.ok(Math.abs(arm.rotation.z) > 0.1, 'one hand reaches out to serve');
  assert.equal(rider.getObjectByName('steering-arm').rotation.z, 0);
  handle.update(1);
  assert.equal(arm.rotation.z, 0, 'the serving arm returns to the handlebar');
});

test('without a rider the trike cannot be selected or hand out refreshments', () => {
  const { handle, rider, station, manager, rec } = drinksCart();
  rider.removeFromParent();
  assert.equal(handle.canServe, false);
  assert.equal(handle.serve(), false);
  assert.equal(manager._drinkStation(rec, rec.agent.drink), null, 'no other refreshments are available');
  assert.equal(manager._collectDrink(station), null, 'also rechecked at handoff');
  assert.equal(manager._drinkRun(rec), undefined);
});
