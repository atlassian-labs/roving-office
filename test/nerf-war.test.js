import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom, arrived } from './lib/room.js';
import { play } from './lib/frames.js';

let THREE;
before(async () => { ({ THREE } = await loadRoom()); });

test('Nerf players keep moving, ignore work, and return to normal when stopped', () => {
  const { manager, rec } = arrived();
  manager.setNerfWar(true);
  const start = rec.agent.position.clone();
  assert.equal(manager.nerfGuns.size, 1);
  manager.setNerfWar(true);
  assert.equal(manager.nerfGuns.size, 1, 'repeated entry does not duplicate the blaster');
  manager.handleEvent({ type: 'status', id: 'a1', status: 'working' });
  play(manager, 2);
  assert.ok(start.distanceTo(rec.agent.position) > 0.1, 'a game must move, not freeze');
  assert.equal(rec.agent.status, 'nerfWar');
  play(manager, 20);
  assert.equal(rec.agent.status, 'nerfWar', 'the next route continues the game');
  manager.setNerfWar(false);
  assert.equal(manager.nerfGuns.size, 0);
  assert.equal(rec.agent.status, 'idle', 'the roster immediately leaves the game status');
  manager.handleEvent({ type: 'status', id: 'a1', status: 'working' });
  play(manager, 1);
  assert.notEqual(rec.agent.status, 'nerfWar');
});

test('a spectator link can enable Nerf mode before the first agent arrives', () => {
  const { manager } = arrived();
  manager.setNerfWar(true);
  manager.handleEvent({ type: 'spawn', id: 'new', name: 'Grace' });
  play(manager, 30);
  assert.equal(manager.getAgent('new').status, 'nerfWar');
  assert.equal(manager.nerfGuns.size, 2);
  manager.handleEvent({ type: 'despawn', id: 'new' });
  assert.equal(manager.getAgent('new'), null);
  assert.equal(manager.nerfGuns.size, 1);
});

test('a replacement office restores the global game before late arrivals join', () => {
  const previous = arrived().manager;
  previous.setNerfWar(true);
  const globalFlag = previous.nerfWar;
  const replacement = arrived().manager;
  replacement.setNerfWar(globalFlag);
  replacement.handleEvent({ type: 'spawn', id: 'late', name: 'Late visitor' });
  play(replacement, 45);
  assert.equal(replacement.getAgent('late').status, 'nerfWar');
  assert.equal(replacement.nerfWar, true);
});

test('the happy-hour trike is visible immediately and cruises a closed circuit', async () => {
  const { loadHappyHourTrike } = await import('../src/scene/outlooks/streetscape.js');
  const trike = loadHappyHourTrike(new THREE.Group(), 21, -1.8);
  assert.ok(trike.children[0].children.length > 0);
  trike.userData.cruise(0);
  const start = trike.position.clone();
  trike.userData.cruise(6);
  assert.ok(start.distanceTo(trike.position) > 7);
  trike.userData.cruise(18);
  assert.ok(start.distanceTo(trike.position) < 1e-8);
});
