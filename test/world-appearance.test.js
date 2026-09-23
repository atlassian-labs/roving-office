import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom } from './lib/room.js';
import { play, playUntil } from './lib/frames.js';
import { seedRandom } from '../bin/lib/headless-scene.js';

let THREE, buildWorld, changeAppearance, disposeWorld, loadOffice, resetLayout;
let COLORS, BUILDING_LIST, SEASON_LIST, getSource, MockSource;
let w, scene, restoreRandom;
const lightsLevel = (level) => level;

before(async () => {
  ({ THREE } = await loadRoom());
  globalThis.window = {
    location: { pathname: '/office/TEST-0000/', search: '' },
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
  };
  ({ buildWorld, changeAppearance, disposeWorld } = await import('../src/world.js'));
  ({ loadOffice } = await import('../src/office/office.js'));
  ({ resetLayout } = await import('../src/layout.js'));
  ({ COLORS } = await import('../src/config.js'));
  ({ BUILDING_LIST, SEASON_LIST } = await import('../src/projects.js'));
  ({ getSource } = await import('../src/data/sources.js'));
  ({ MockSource } = await import('../src/data/MockSource.js'));
});

beforeEach(() => { resetLayout(); restoreRandom = seedRandom(209); });
afterEach(() => { if (w) disposeWorld(w, { scene }); w = null; restoreRandom(); });

async function office(building = 'simple', sources = []) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    keycard: 'TEST-0000', scenes: [{ id: 'continuity', sources,
      look: { building: 'simple', season: 'summer' } }],
  }) });
  try { await loadOffice(); } finally { globalThis.fetch = original; }
  scene = new THREE.Scene();
  w = buildWorld('continuity', { scene, overrides: { building, season: 'summer' }, lightsLevel });
  return w;
}
function change(building, season = 'summer') {
  return changeAppearance(w, { scene, overrides: { building, season }, lightsLevel });
}
// Every channel work can arrive by, because a channel this loop does not drive is a
// channel whose letters never land — and an agent waiting at the box for one waits for
// ever. The birds were missing here from the day they were added, and the
// gap only showed when an unrelated change moved the seeded stream far enough to hand
// these four cases a bird instead of a plane. A stall that has to be *stumbled* into
// is worth more comment than the line it takes to fix.
const clock = { update(dt) {
  w.props.door?.update(dt);
  w.mail.update(dt);
  w.birds.update(dt);
  w.deliveries.update(dt);
  w.manager.update(dt);
} };
function spawn(id = 'a', extra = {}) {
  w.manager.handleEvent({ type: 'spawn', id, name: 'Ada', color: 0x7c6647, ...extra });
  return w.manager.agents.get(id);
}
function settled(rec) {
  assert.notEqual(playUntil(clock, () => !rec.arriving, 45), null, 'arrival finishes');
}

test('all buildings and seasons preserve identities, jobs, histories, desks and working actions', async () => {
  await office();
  const rec = spawn();
  settled(rec);
  w.manager.handleEvent({ type: 'job', id: 'a', job: 'Keep working' });
  w.manager.handleEvent({ type: 'status', id: 'a', status: 'working' });
  assert.notEqual(playUntil(clock, () => rec.agent.seated && rec.controller.current?.kind === 'wait', 30), null);
  const original = { manager: w.manager, feeds: w.feeds, root: w.root, props: w.props,
    desk: rec.desk, jobs: rec.jobs, history: rec.agent.history, action: rec.controller.current,
    position: rec.agent.position.clone(), shirt: rec.agent.color };
  const history = JSON.stringify(rec.agent.history);
  const disposed = [];
  // Sill dressing is intentionally replaced; the agent and occupied desk must survive.
  rec.agent.root.traverse(o => { o.geometry?.addEventListener('dispose', () => disposed.push('agent')); });
  const deskRoot = rec.desk.assignmentMarker.root.parent;
  deskRoot.traverse(o => {
    o.geometry?.addEventListener('dispose', () => disposed.push('desk'));
    o.material?.addEventListener?.('dispose', () => disposed.push('desk material'));
  });
  for (const building of BUILDING_LIST) for (const season of SEASON_LIST) {
    change(building, season);
    assert.equal(w.manager, original.manager);
    assert.equal(w.feeds, original.feeds);
    assert.equal(w.root, original.root);
    assert.equal(w.props, original.props);
    assert.equal(w.manager.agents.get('a'), rec);
    assert.equal(rec.desk, original.desk);
    assert.equal(rec.jobs, original.jobs);
    assert.equal(rec.agent.history, original.history);
    assert.equal(JSON.stringify(rec.agent.history), history);
    assert.equal(rec.controller.current, original.action);
    assert.deepEqual(rec.agent.position, original.position);
    assert.equal(rec.agent.color, original.shirt, 'theme does not recolour an agent');
    assert.equal(rec.desk.assignmentMarker.root.visible, true);
    assert.equal(rec.arriving, false);
    assert.deepEqual(disposed, []);
    let themed = 0;
    w.props.propsRoot.traverse(o => {
      const key = o.material?.userData.paletteKey;
      if (key) { themed++; assert.equal(o.material.color.getHex(), COLORS[key]); }
    });
    assert.ok(themed > 10, 'retained furniture is repainted for the new theme');
    assert.equal(scene.children.length, 1, 'one live world');
  }
  play(clock, 1);
  assert.ok(rec.controller.current._left < 3600, 'work continues after changing appearance');
});

test('Test Data keeps its source, timers, simulated identities and pending work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const def = getSource('test-data');
  const create = def.create;
  let created = 0, started = 0, stopped = 0, source;
  def.create = () => {
    created++;
    source = new MockSource({ startCount: 1, capacity: () => 1 });
    const start = source.start.bind(source), stop = source.stop.bind(source);
    source.start = emit => { started++; start(emit); };
    source.stop = () => { stopped++; stop(); };
    return source;
  };
  try {
    await office('simple', ['test-data']);
    t.mock.timers.tick(5000);
    const rec = [...w.manager.agents.values()][0];
    assert.ok(rec, 'the real simulation has spawned an agent');
    for (const building of BUILDING_LIST) change(building, 'winter');
    assert.equal(created, 1); assert.equal(started, 1); assert.equal(stopped, 0);
    assert.equal(w.manager.agents.get(rec.agent.id), rec);
    const delivered = w.feeds.sendJob('Still connected');
    assert.ok(delivered, 'the original feed still accepts work');
    assert.equal(created, 1);
  } finally { def.create = create; }
});

test('a live feed continues into the same actor and multiple sessions without reconnecting', async () => {
  const def = getSource('openclaw');
  const create = def.create;
  let starts = 0, stops = 0, emit;
  def.create = () => ({ start(fn) { starts++; emit = fn; }, stop() { stops++; } });
  try {
    await office('simple', ['openclaw']);
    emit({ type: 'spawn', id: 's1', actor: 'ada', name: 'Ada' });
    emit({ type: 'job', id: 's1', job: 'First session' });
    const rec = [...w.manager.agents.values()][0];
    settled(rec);
    for (const building of BUILDING_LIST) for (const season of SEASON_LIST) change(building, season);
    emit({ type: 'spawn', id: 's2', actor: 'ada', name: 'Ada' });
    emit({ type: 'job', id: 's2', job: 'Second session' });
    assert.equal(starts, 1); assert.equal(stops, 0);
    assert.equal(w.manager.agents.size, 1);
    assert.equal([...w.manager.agents.values()][0], rec);
    assert.equal(rec.jobs.size, 2);
    emit({ type: 'exit', id: 's1' });
    assert.equal(rec.jobs.size, 1);
    assert.equal(rec.leaving, false);
  } finally { def.create = create; }
});

for (const from of ['warehouse', 'mansard', 'skyscraper']) {
  for (const to of ['simple', 'warehouse', 'mansard', 'skyscraper']) {
    test(`arrival from ${from} continues through ${to}, including queued work`, async () => {
      await office(from);
      const rec = spawn();
      play(clock, .25);
      w.manager.handleEvent({ type: 'job', id: 'a', job: 'Queued on arrival' });
      w.manager.handleEvent({ type: 'status', id: 'a', status: 'working' });
      change(to, 'winter');
      assert.equal(w.manager.agents.get('a'), rec);
      if (to === 'skyscraper' && from !== 'skyscraper') {
        assert.ok(rec.agent.position.z > 0, 'handover uses the lobby, not an empty lift shaft');
        assert.ok(w.manager.nav.walkableAt(rec.agent.position.x, rec.agent.position.z));
      }
      settled(rec);
      assert.ok(rec.agent.root.visible);
      assert.equal(rec.agent.position.y, 0);
      // Took up its post, which is either turn a sit-stand desk rolls: `seated` alone
      // was this assertion for a while and it only ever passed by luck. Nothing about a
      // scenery change should care whether the desk went up — and when an unrelated
      // module changed how many draws it takes from the seeded stream, this seed handed
      // the mansard a standing turn and four cases went red with the room working
      // perfectly (`takeUpPostAtDesk` in AgentManager.js).
      assert.notEqual(
        playUntil(clock, () => rec.agent.seated || rec.standingAtDesk, 45),
        null,
        'the queued work gets worked, sitting or standing',
      );
      assert.equal(rec.agent.job, 'Queued on arrival');
    });
  }
}

for (const from of ['simple', 'warehouse', 'skyscraper']) for (const to of ['simple', 'mansard', 'skyscraper']) {
  test(`departure from ${from} finishes through ${to}`, async () => {
    await office(from);
    const rec = spawn(); settled(rec);
    w.manager.handleEvent({ type: 'exit', id: 'a' });
    assert.notEqual(playUntil(clock, () => rec.controller.current?.entrance === 'out', 30), null);
    change(to);
    assert.notEqual(playUntil(clock, () => !w.manager.agents.has('a'), 45), null);
    assert.equal(rec.desk.occupiedBy, null);
  });
}

test('a courier keeps its parcel queue and delivers each payload exactly once across entrances', async () => {
  await office('warehouse');
  const landed = [];
  w.deliveries.onArrive = payload => landed.push(payload.id);
  w.deliveries.launch({ id: 'one', box: 'mailbox' });
  w.deliveries.launch({ id: 'two', box: 'mailbox' });
  play(clock, .5);
  change('skyscraper');
  assert.notEqual(playUntil(clock, () => w.deliveries.phase === 'throw', 20), null);
  assert.ok(w.deliveries.route.points.length > 1, 'the courier still has a complete way out');
  change('mansard');
  assert.notEqual(playUntil(clock, () => landed.length === 2, 60), null);
  assert.deepEqual(landed, ['one', 'two']);
});

test('changing season preserves a lift already carrying an arrival', async () => {
  await office('skyscraper');
  const rec = spawn();
  play(clock, .5);
  const before = Object.fromEntries(['state', 'carY', 'targetY', 'doorT', '_hold', '_dwell']
    .map(key => [key, w.props.elevator[key]]));
  const action = rec.controller.current;
  change('skyscraper', 'winter');
  for (const [key, value] of Object.entries(before)) assert.equal(w.props.elevator[key], value, key);
  assert.equal(rec.controller.current, action);
  settled(rec);
  assert.ok(rec.agent.root.visible);
});

test('an exit queued behind an arrival still finishes after the entrance changes', async () => {
  await office('mansard');
  const rec = spawn();
  play(clock, .4);
  w.manager.handleEvent({ type: 'exit', id: 'a' });
  change('skyscraper');
  assert.notEqual(playUntil(clock, () => !w.manager.agents.has('a'), 50), null);
  assert.equal(rec.desk.occupiedBy, null);
});

test('an agent midway down old stairs transfers safely and completes its departure', async () => {
  await office('mansard');
  const rec = spawn(); settled(rec);
  w.manager.handleEvent({ type: 'exit', id: 'a' });
  assert.notEqual(playUntil(clock, () => rec.agent.onRoute && rec.agent.position.y < -1, 35), null);
  change('skyscraper');
  assert.equal(rec.agent.position.y, 0);
  assert.notEqual(playUntil(clock, () => !w.manager.agents.has('a'), 45), null);
});

test('appearance disposal frees old scenery and final teardown frees retained agent resources', async () => {
  await office();
  const rec = spawn(); settled(rec);
  const old = w.scenery;
  let shellDisposed = 0, agentDisposed = 0;
  old.traverse(o => o.geometry?.addEventListener('dispose', () => shellDisposed++));
  rec.agent.root.traverse(o => o.material?.addEventListener?.('dispose', () => agentDisposed++));
  change('tide');
  assert.equal(old.parent, null);
  assert.ok(shellDisposed > 100, 'discarded scenery releases its geometry');
  assert.equal(agentDisposed, 0, 'retained agents keep their materials');
  disposeWorld(w, { scene }); w = null;
  assert.ok(agentDisposed > 0, 'final teardown releases the retained materials');
  assert.equal(scene.children.length, 0);
});

test('repeated recolouring releases upholstery materials that are no longer in the world', async () => {
  await office();
  change('tide');
  const old = new Map();
  w.props.propsRoot.traverse(o => {
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!material || old.has(material)) continue;
      old.set(material, 0);
      material.addEventListener('dispose', () => old.set(material, old.get(material) + 1));
    }
  });
  change('canopy');
  const live = new Set();
  w.root.traverse(o => {
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) if (material) live.add(material);
  });
  let retired = 0;
  for (const [material, disposed] of old) if (!live.has(material)) {
    retired++;
    assert.ok(disposed > 0, 'an unused upholstery or sill material leaked');
  }
  assert.ok(retired > 0, 'the two themes actually use different upholstery');
  assert.ok(scene.background?.isColor, 'the rebuilt scene keeps a sky for the daylight cycle');
});
