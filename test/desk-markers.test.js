import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom } from './lib/room.js';

let THREE, AgentManager, buildDesk;
before(async () => {
  ({ THREE, AgentManager } = await loadRoom());
  ({ buildDesk } = await import('../src/scene/props/desk.js'));
});

test('every desk has the same 30-degree nameplate at the requested midpoint, clear of its mug', () => {
  for (const standing of [false, true]) {
    for (let i = 0; i < 5; i++) {
      const { obj, handle } = buildDesk({ id: `desk-${i}`, x: 0, z: 0, facing: 0, standing }, i);
      const marker = handle.assignmentMarker;
      assert.equal(marker.id, 'nameplate');
      assert.ok(Math.abs(marker.root.rotation.y - Math.PI / 6) < 1e-9);
      // The gap from the left desktop edge (-2.2) to keyboard edge (-.75), and
      // from the front (+1.1) to the monitor row (-.35), measured in desk space.
      assert.ok(Math.abs(marker.root.position.x + 1.475) < 1e-9);
      assert.equal(marker.root.position.y, 1.58);
      assert.ok(Math.abs(marker.root.position.z - .375) < 1e-9);
      handle.setAssignment({ color: 0x4488cc });
      handle.setMug(true);
      obj.updateMatrixWorld(true);
      const plate = new THREE.Box3().setFromObject(marker.root);
      const mug = new THREE.Box3().setFromObject(obj.getObjectByName('desk-mug'));
      assert.equal(plate.intersectsBox(mug), false, 'a drink intersects the nameplate');
      assert.ok(plate.min.x > -2.2 && plate.max.x < -.75, 'outside the gap left of the keyboard');
      assert.ok(plate.min.z > -.35 && plate.max.z < 1.1, 'outside the gap in front of the monitors');
    }
  }
});

test('assignment markers follow claims, recolouring, release and inheritance independently of work', () => {
  const desks = Array.from({ length: 3 }, (_, i) =>
    buildDesk({ id: `live-${i}`, x: 4 + i * 6, z: 8, facing: 0 }, i).handle);
  const manager = new AgentManager(new THREE.Group(), { desks });
  assert.ok(desks.every(d => !d.assignmentMarker.root.visible));
  manager.handleEvent({ type: 'spawn', id: 'ada', name: 'Ada', color: 0x5284b8 });
  manager.handleEvent({ type: 'spawn', id: 'grace', name: 'Grace', color: 0x85b467 });
  const ada = manager.agents.get('ada');
  const grace = manager.agents.get('grace');
  const a = ada.desk.assignmentMarker;
  const g = grace.desk.assignmentMarker;
  assert.equal(a.root.visible, true, 'assigned while still walking in');
  assert.equal(a.colour.color.getHex(), ada.agent.color);
  assert.notEqual(a.colour, g.colour, 'materials must not leak identity between desks');
  manager.handleEvent({ type: 'recolor', id: 'ada', color: 0xc568a1 });
  assert.equal(a.colour.color.getHex(), 0xc568a1);
  assert.equal(g.colour.color.getHex(), grace.agent.color);
  ada.desk.setWorking(true);
  ada.desk.setWorking(false);
  assert.equal(a.root.visible, true, 'leaving a chair does not release its assignment');
  const oldDesk = ada.desk;
  manager._remove(ada);
  assert.equal(a.root.visible, false);
  assert.equal(oldDesk.occupiedBy, null);
  manager.props.desks = [oldDesk, grace.desk];
  manager.handleEvent({ type: 'spawn', id: 'lin', name: 'Lin', color: 0xcca344 });
  assert.equal(manager.agents.get('lin').desk, oldDesk);
  assert.equal(a.root.visible, true);
  assert.equal(a.colour.color.getHex(), manager.agents.get('lin').agent.color);
  assert.equal(oldDesk.assignmentMarker, a, 'the treatment belongs to the desk, not its occupant');
  for (const rec of [...manager.agents.values()]) manager._remove(rec);
});

test('deleting an assigned desk clears the old marker and colours its replacement', () => {
  const desks = [0, 1].map(i => buildDesk({ id: `delete-${i}`, x: 4 + i * 6, z: 8, facing: 0 }, i).handle);
  const props = { desks };
  const manager = new AgentManager(new THREE.Group(), props);
  manager.handleEvent({ type: 'spawn', id: 'ada', name: 'Ada' });
  const rec = manager.agents.get('ada');
  const removed = rec.desk;
  props.desks = desks.filter(d => d !== removed);
  manager.relayout();
  assert.equal(removed.assignmentMarker.root.visible, false);
  assert.equal(rec.desk.assignmentMarker.root.visible, true);
  assert.equal(rec.desk.assignmentMarker.colour.color.getHex(), rec.agent.color);
  manager._remove(rec);
});

test('the nameplate rotates and lifts with its desk, and adds only two meshes without lights', () => {
  for (const standing of [false, true]) {
    const spec = { id: `geometry-${standing}`, x: 4, z: 8, facing: 0, standing };
    const { obj, handle } = buildDesk(spec, 0);
    handle.setAssignment({ color: 0x4488cc });
    const marker = handle.assignmentMarker.root;
    let meshes = 0, lights = 0;
    marker.traverse(part => { if (part.isMesh) meshes++; if (part.isLight) lights++; });
    assert.equal(meshes, 2);
    assert.equal(lights, 0);
    obj.updateMatrixWorld(true);
    const before = marker.children[0].getWorldPosition(new THREE.Vector3());
    handle.setStanding(false);
    handle.update(10);
    obj.updateMatrixWorld(true);
    const lowered = marker.children[0].getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(before.y - lowered.y - (standing ? .34 : 0)) < 1e-6);
    spec.facing = Math.PI;
    spec.x += 3;
    handle.relocate();
    obj.updateMatrixWorld(true);
    const turned = marker.children[0].getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(turned.x - (spec.x - (lowered.x - 4))) < 1e-6);
    assert.ok(Math.abs(turned.z - (16 - lowered.z)) < 1e-6);
    handle.setAssignment(null);
    assert.equal(marker.visible, false);
  }
});
