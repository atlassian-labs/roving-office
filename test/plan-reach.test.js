// Does the *real* nav grid agree that a generated office works?
//
// The generator checks its own plans with `src/plan/reach.js`, which is a second
// implementation of a question `NavGrid` already answers — deliberately, because
// the nav grid can only be built from a layout that has already been applied to
// the room, and applying a layout to find out whether it is any good would mean
// rearranging the office somebody is standing in.
//
// A second implementation of one question is normally the wrong answer, and the
// thing that makes it safe here is this file. Every seed below is applied for
// real, the real grid is built from the real footprints, and the room is put
// through `strandedApproaches` — the furniture editor's own check, with the
// editor's own list of standing places, including the desks' approach points read
// off `buildDesk` rather than recomputed. If the two ever drift, this is what says
// so.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';
import { strandedApproaches } from '../src/editor/placement.js';
import { generateOffice } from '../src/plan/index.js';
import { DESK_APPROACH } from '../src/plan/floor.js';

let NavGrid, buildDesk, layout, DOOR;

before(async () => {
  stubDom();
  await loadThree();
  ({ NavGrid } = await import('../src/agents/pathfinding.js'));
  ({ buildDesk } = await import('../src/scene/props/desk.js'));
  layout = await import('../src/layout.js');
  ({ DOOR } = await import('../src/config.js'));
});

/**
 * Every standing place in the room, exactly as `approaches()` in the editor reads
 * them — desks off the built prop, stations and lounge seating off the layout.
 */
function approaches() {
  const out = [];
  layout.DESKS.forEach((d, i) => {
    out.push({ label: d.id, at: buildDesk({ ...d }, i).handle.approach });
  });
  for (const [key, s] of Object.entries(layout.STATIONS)) {
    if (s.approachDist != null) out.push({ label: key, at: s.approach });
  }
  for (const f of layout.FURNITURE) {
    if (layout.FURNITURE_KINDS[f.kind]?.seatOffsets) out.push({ label: f.id, at: f.approach });
  }
  return out;
}

test('a desk\'s standing room is where the plan thinks it is', () => {
  // `DESK_APPROACH` is written down in the generator because the plan has to
  // leave that floor clear before there is a prop to ask. This is the one place
  // the two can be compared, so it is compared: the number belongs to
  // `buildDesk`, and a change there has to reach the generator.
  layout.resetLayout();
  const desk = { id: 'desk-x', x: 12, z: 8, facing: 0 };
  const { handle } = buildDesk({ ...desk }, 0);
  assert.equal(Math.round(Math.hypot(handle.approach.x - desk.x, handle.approach.z - desk.z) * 1000) / 1000,
    DESK_APPROACH);
});

test('nobody is stranded in a generated office', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => `reach-${i}`);
  for (const seed of seeds) {
    const office = generateOffice(seed);
    layout.resetLayout();
    assert.ok(layout.applyLayout(office.layout), `${seed}: applied nothing`);

    const nav = new NavGrid();
    const stranded = strandedApproaches(approaches(), nav, DOOR.inside);
    assert.deepEqual([...stranded], [],
      `${seed} (${office.name}): the room cannot reach ${[...stranded].join(', ')}`);
  }
  layout.resetLayout();
});

test('the plan and the nav grid agree about the same room', () => {
  // Not merely "both say it works": the generator's own fill and the real grid
  // are asked about every standing place in the same room, and have to give the
  // same answer for each. A room where the plan is *more* permissive than the grid
  // is the failure that matters — it is a room that ships broken — and a plan that
  // is stricter would quietly throw away good offices.
  for (const seed of ['reach-0', 'reach-7', 'reach-19', 'reach-31']) {
    const office = generateOffice(seed);
    layout.resetLayout();
    layout.applyLayout(office.layout);
    const nav = new NavGrid();
    const reached = nav.reachableFrom(DOOR.inside);

    for (const spot of office.report.approaches) {
      assert.ok(nav.walkableAt(spot.at.x, spot.at.z),
        `${seed}: ${spot.label}'s spot at ${spot.at.x},${spot.at.z} is not walkable`);
      assert.ok(nav.reachedBy(reached, spot.at.x, spot.at.z),
        `${seed}: ${spot.label} cannot be reached`);
    }
  }
  layout.resetLayout();
});
