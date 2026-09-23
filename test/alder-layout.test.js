import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ALDER, buildings, crossings, parking, pavements, pavingCuts, ramps, subtractRectangle } from '../src/scene/outlooks/alder-layout.js';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';
import { GARDEN_DISTRICTS } from '../src/scene/outlooks/garden-districts.js';

const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
const rect = p => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 });
const roads = [
  ...ALDER.avenues.map(x => ({ x0: x - 4, x1: x + 4, z0: ALDER.min, z1: ALDER.max })),
  ...ALDER.streets.map(z => ({ z0: z - 4, z1: z + 4, x0: ALDER.min, x1: ALDER.max })),
];

test('building plots, the park and parked cars leave the carriageways clear', () => {
  for (const p of [...buildings.map(rect), ...parking.map(rect), ALDER.park]) {
    for (const road of roads) assert.ok(overlap(p, road) < 1e-8, 'a plot intrudes into a road');
  }
  for (let i = 0; i < buildings.length; i++) for (let j = i + 1; j < buildings.length; j++) {
    assert.equal(overlap(rect(buildings[i]), rect(buildings[j])), 0, 'buildings overlap');
  }
});

test('each district leaves its streets, park and planted setbacks clear of buildings', () => {
  for (const district of Object.values(GARDEN_DISTRICTS)) {
    const plots = district.buildings.map(rect);
    const beds = district.beds.map(([x, z, w, d]) => rect({ x, z, w, d }));
    for (const plot of plots) {
      for (const clear of [...roads, ALDER.park, ...beds, ...(district.cuts ?? [])]) {
        assert.ok(overlap(plot, clear) < 1e-8, `${district.id}: a building blocks public space`);
      }
    }
    for (const bed of beds) for (const road of roads) assert.equal(overlap(bed, road), 0);
    for (let i = 0; i < plots.length; i++) for (let j = i + 1; j < plots.length; j++) {
      assert.equal(overlap(plots[i], plots[j]), 0, `${district.id}: buildings overlap`);
    }
  }
});

test('warehouse vehicles have a continuous lowered route from the road into the loading apron', () => {
  const [apron, driveway] = GARDEN_DISTRICTS.warehouse.cuts;
  assert.ok(Math.abs(driveway.x0 - (ALDER.avenues[1] + ALDER.roadWidth / 2)) < 1e-8);
  assert.equal(driveway.x1, apron.x0);
  assert.ok(driveway.z0 >= apron.z0 && driveway.z1 <= apron.z1);
  let pieces = pavements;
  for (const cut of [...pavingCuts, apron, driveway]) pieces = pieces.flatMap(p => subtractRectangle(p, cut));
  for (const piece of pieces) for (const cut of [apron, driveway]) assert.ok(overlap(piece, cut) < 1e-8);
});

test('every crossing spans a road and lands on pavement at both ends', () => {
  for (const p of crossings) {
    assert.ok((p.axis === 'x' ? ALDER.streets : ALDER.avenues).includes(p.axis === 'x' ? p.z : p.x));
    for (const sign of [-1, 1]) {
      const x = p.x + (p.axis === 'z' ? sign * 4.1 : 0);
      const z = p.z + (p.axis === 'x' ? sign * 4.1 : 0);
      assert.ok(pavements.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1), 'crossing ends in a road');
    }
    const approach = p.axis === 'x' ? rect({ ...p, w: p.width + 2, d: 11 }) : rect({ ...p, w: 11, d: p.width + 2 });
    for (const bay of parking) assert.equal(overlap(approach, rect(bay)), 0, 'parking blocks a crossing approach');
  }
  assert.equal(ramps.length, crossings.length * 2);
});

test('kerb cuts really remove paving, with neither overlaps nor lost area elsewhere', () => {
  for (const p of pavements) {
    let pieces = [p];
    for (const cut of pavingCuts) pieces = pieces.flatMap(r => subtractRectangle(r, cut));
    for (const piece of pieces) for (const cut of pavingCuts) assert.ok(overlap(piece, cut) < 1e-8);
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      assert.ok(overlap(pieces[i], pieces[j]) < 1e-8, 'pavement pieces overlap');
    }
  }
  // An internal hole is a useful independent case: the road-edge cuts also use it.
  const pieces = subtractRectangle({ x0: 0, x1: 10, z0: 0, z1: 10 }, { x0: 3, x1: 7, z0: 3, z1: 7 });
  assert.equal(pieces.reduce((sum, p) => sum + (p.x1 - p.x0) * (p.z1 - p.z0), 0), 84);
});

let THREE, buildAlderStreet, disposeSubtree, clearMaterialCache, releaseNightLightAssets;
before(async () => {
  stubDom(); THREE = await loadThree();
  ({ buildAlderStreet } = await import('../src/scene/outlooks/alder.js'));
  ({ disposeSubtree, clearMaterialCache } = await import('../src/scene/build.js'));
  ({ releaseNightLightAssets } = await import('../src/scene/night-lights.js'));
});

test('each season builds without extra lights and releases the instance buffers on teardown', () => {
  for (const district of [{}, ...Object.values(GARDEN_DISTRICTS)]) for (const season of ['summer', 'autumn', 'winter', 'spring']) {
    const root = buildAlderStreet(new THREE.Group(), season, district);
    assert.equal(root.position.y, district.offsetY ?? 0);
    let instances = 0, disposed = 0, lights = 0;
    root.traverse(o => {
      if (o.isLight) lights++;
      if (o.isInstancedMesh) {
        instances++;
        assert.ok(o.boundingSphere.radius > 0 && Number.isFinite(o.boundingSphere.radius));
        o.addEventListener('dispose', () => disposed++);
      }
    });
    assert.ok(instances > 0);
    assert.equal(lights, 0);
    disposeSubtree(root);
    assert.equal(disposed, instances);
    clearMaterialCache(); releaseNightLightAssets();
  }
});
