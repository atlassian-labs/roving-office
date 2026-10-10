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

function drinksCart(position = { x: 3, z: 10 }) {
  layout.removeObject('station:waterCooler');
  layout.removeObject('station:coffee');
  const station = layout.addStation('happyHourTrike', position);
  layout.reviseLayout();
  const cart = buildHappyHourTrike();
  cart.obj.position.set(station.x, 0, station.z);
  cart.obj.rotation.y = (station.lookRotation ?? 0) + Math.PI;
  cart.obj.userData.movable = { spec: station };
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

test('the rider stops to hand a drink to an arriving agent and settles back on the bars', () => {
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

test('the indoor rider tours the furnished office instead of staying at the placed item', () => {
  const { handle, obj } = drinksCart({ x: 13, z: 10, facing: Math.PI / 2 });
  const start = obj.position.clone();
  const footprints = layout.obstacleFootprints().filter((f) => !f.soft && f.role !== 'stand' && !f.key.includes('happyHourTrike'));
  let travelled = 0;
  for (let i = 0; i < 2400; i++) {
    const before = obj.position.clone();
    handle.update(.05);
    travelled += before.distanceTo(obj.position);
    assert.ok(obj.position.x > 0 && obj.position.x < 26 && obj.position.z > 0, 'the tour stays indoors');
    const a = obj.rotation.y;
    const hw = Math.abs(Math.cos(a)) * .7 + Math.abs(Math.sin(a)) * 1.25;
    const hd = Math.abs(Math.sin(a)) * .7 + Math.abs(Math.cos(a)) * 1.25;
    assert.equal(footprints.some((f) => obj.position.x + hw > f.x0 && obj.position.x - hw < f.x1
      && obj.position.z + hd > f.z0 && obj.position.z - hd < f.z1), false, 'the whole cart clears furniture');
  }
  assert.ok(travelled > 15, `a continuing office tour, not a parked trike (${travelled})`);
  assert.ok(start.distanceTo(obj.position) > 1);
});

test('the tour parks for editing and a refreshment rendezvous, then resumes', () => {
  const { handle, obj, station } = drinksCart({ x: 13, z: 10, facing: Math.PI / 2 });
  const initial = obj.position.clone();
  handle.update(5, { paused: true });
  assert.equal(initial.distanceTo(obj.position), 0);
  for (let i = 0; i < 100; i++) handle.update(.05);
  assert.ok(initial.distanceTo(obj.position) > .5);
  const stopped = obj.position.clone();
  const rendezvous = handle.reserve(station, 'customer');
  assert.ok(rendezvous);
  assert.equal(rendezvous.x, stopped.x, 'agents meet the current cart, not its old parking spot');
  for (let i = 0; i < 100; i++) handle.update(.05);
  assert.equal(stopped.distanceTo(obj.position), 0, 'the rider waits for the customer');
  assert.equal(handle.serve(), true);
  handle.release('customer');
  for (let i = 0; i < 100; i++) handle.update(.05);
  assert.ok(stopped.distanceTo(obj.position) > .5, 'service finishes and the tour resumes');
});

test('an agent gets refreshments at the touring cart, not its former parking spot', () => {
  const { handle, obj, manager, rec } = drinksCart({ x: 13, z: 10, facing: Math.PI / 2 });
  for (let i = 0; i < 120; i++) handle.update(.05);
  const rendezvous = obj.position.clone();
  manager.handleEvent({ type: 'activity', id: 'a1', activity: 'drink' });
  let served = false;
  for (let i = 0; i < 800; i++) {
    manager.update(.05);
    handle.update(.05, { agents: [rec.agent] });
    if (rec.agent.carrying === 'cup') { served = true; break; }
    assert.equal(rendezvous.distanceTo(obj.position), 0, 'the cart waits while the customer approaches');
  }
  assert.equal(served, true);
  assert.ok(rec.agent.position.distanceTo(rendezvous) < 2.5, 'handoff occurs beside the current cart');
});

test('the rider yields to pedestrians and resumes after an interrupted drink request', () => {
  const { handle, obj, station } = drinksCart({ x: 13, z: 10, facing: Math.PI / 2 });
  const start = obj.position.clone();
  handle.update(.05, { agents: [{ id: 'pedestrian', position: start.clone(), status: 'walking' }] });
  assert.equal(start.distanceTo(obj.position), 0);
  handle.reserve(station, 'customer');
  const customer = { id: 'customer', position: new THREE.Vector3(2, 0, 2), status: 'working' };
  handle.update(.05, { agents: [customer] });
  assert.equal(start.distanceTo(obj.position), 0, 'wait while a seated customer gets up');
  customer.status = 'walking';
  handle.update(.05, { agents: [customer] });
  customer.status = 'nerfWar';
  for (let i = 0; i < 100; i++) handle.update(.05, { agents: [customer] });
  assert.ok(start.distanceTo(obj.position) > .5, 'interrupted service does not strand the tour');
});

test('a trike added through the editor joins the live world update loop', async () => {
  const { buildProps } = await import('../src/scene/props.js');
  const { updateTrikeTours } = await import('../src/scene/props/trike-tour.js');
  const root = new THREE.Group();
  const original = buildProps(root);
  const worldProps = { ...original }; // buildWorld combines scenery this way.
  const station = layout.addStation('happyHourTrike', { x: 13, z: 10, facing: Math.PI / 2 });
  layout.reviseLayout();
  original.sync();
  assert.equal(worldProps.happyHourTrike, undefined, 'a copied kind lookup is stale after an editor addition');
  const obj = worldProps.byStation[station.id].obj;
  const start = obj.position.clone();
  for (let i = 0; i < 200; i++) updateTrikeTours(worldProps, .05);
  assert.ok(start.distanceTo(obj.position) > 1, 'the live station lookup drives the newly added cart');
});
