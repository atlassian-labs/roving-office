// The layout model: the mutable singleton in config.js, and the blob format the
// furniture editor persists through. The singleton is module state shared by
// every test in this file, so each one starts from the authored room.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RUG_COLORS, SOFA_COLORS, windowSpan } from '../src/config.js';
// The panel's own grouping, imported for the end-to-end menu test below: pure logic, no DOM.
import { groupKit } from '../src/editor/kit-menu.js';
import { DESKS, STATIONS, FURNITURE, DECOR, STATION_KINDS, JOB_ROLES, ROLE_VERBS, stationsForRole, DESK_LIMITS, layoutSnapshot, applyLayout, resetLayout, agentCapacity, addDesk, addStation, addFurniture, addPlant, addObject, addableObjects, canRemoveObject, canTurnObject, kitKeyOf, paletteOf, setObjectColor, removeObject, stationsOfKind, furnitureOfKind, obstacleFootprints, reviseLayout, insideCouch } from '../src/layout.js';

beforeEach(() => resetLayout());

// --- round trips -------------------------------------------------------------

test('an unrounded snapshot applies back to an identical room', () => {
  const before = layoutSnapshot({ round: false });
  applyLayout(before);
  assert.deepEqual(layoutSnapshot({ round: false }), before);
});

test('the rounded export squares near-right-angles back up', () => {
  // Math.PI leaves a rounded blob as 3.14; on the way back in it must become a
  // quarter-turn again, not stay at 89.95° forever.
  const rounded = layoutSnapshot();
  applyLayout(rounded);
  const desk1 = DESKS.find((d) => d.id === 'desk-1');
  assert.equal(desk1.facing, Math.PI);
});

test('a snapshot is a copy, not a live view', () => {
  const snap = layoutSnapshot({ round: false });
  const was = snap.desks['desk-1'].x;
  DESKS.find((d) => d.id === 'desk-1').x += 3;
  assert.equal(snap.desks['desk-1'].x, was);
});

// --- forgiveness -------------------------------------------------------------

test('coordinates are clamped into the room, not refused', () => {
  applyLayout({ layout: 3, desks: { 'desk-1': { x: 500, z: -40 } } });
  const desk = DESKS.find((d) => d.id === 'desk-1');
  assert.ok(desk.x > 0 && desk.x < 26, `x=${desk.x}`);
  assert.ok(desk.z > 0 && desk.z < 20, `z=${desk.z}`);
});

test('NaN is left alone entirely — there is no sane clamp for it', () => {
  const was = DESKS.find((d) => d.id === 'desk-1').x;
  applyLayout({ layout: 3, desks: { 'desk-1': { x: NaN } } });
  assert.equal(DESKS.find((d) => d.id === 'desk-1').x, was);
});

test('garbage blobs are absorbed, never fatal', () => {
  assert.equal(applyLayout(null), false);
  assert.equal(applyLayout('a string'), false);
  applyLayout({ desks: 'nonsense', stations: [], unknownKey: {} });
});

// --- partial vs complete blobs ----------------------------------------------

test('a partial blob moves what it names and deletes nothing', () => {
  const deskCount = DESKS.length;
  applyLayout({ layout: 3, desks: { 'desk-2': { x: 10, z: 10 } } });
  assert.equal(DESKS.length, deskCount, 'absence is not deletion in a partial blob');
  assert.equal(DESKS.find((d) => d.id === 'desk-2').x, 10);
});

test('a complete blob prunes what it does not mention — where removal is allowed', () => {
  const snap = layoutSnapshot({ round: false });
  addDesk({ id: 'desk-extra' });
  assert.ok(DESKS.some((d) => d.id === 'desk-extra'));
  applyLayout(snap);   // complete: the extra desk is not in it, so it goes
  assert.equal(DESKS.some((d) => d.id === 'desk-extra'), false);
});

test('a complete blob cannot delete by omission what a keypress could not', () => {
  // Stated as the rule rather than about one prop, which is what it was always for.
  // It named the mailbox, and passed for as long as the post was the only way work
  // could leave — then the printer learned to fax and the mailbox became
  // legitimately deletable, so the test failed while the invariant it was protecting
  // was perfectly intact. Ask `canRemoveObject` which stations it is refusing and check
  // those, and the test survives the room being rearranged under it.
  const held = Object.values(STATIONS)
    .filter((st) => !canRemoveObject(`station:${st.id}`).ok)
    .map((st) => st.id);
  assert.ok(held.length, 'the room refuses to delete *something*, or this proves nothing');

  for (const id of held) {
    resetLayout();
    const snap = layoutSnapshot({ round: false });
    delete snap.stations[id];
    applyLayout(snap);
    assert.ok(STATIONS[id], `the room let a blob delete ${id}, which a keypress refuses`);
  }
});

test('a complete blob can create furniture the room never had', () => {
  applyLayout({
    layout: 3,
    stations: { 'bookshelf-2': { kind: 'bookshelf', x: 20, z: 2, facing: 0 } },
  });
  assert.equal(stationsOfKind('bookshelf').length, 2);
});

test('a hand-written entry with no kind is understood from its id', () => {
  applyLayout({ layout: 3, furniture: { 'couch-2': { x: 8, z: 8 } } });
  assert.equal(furnitureOfKind('couch').length, 2);
});

// --- older blob versions ------------------------------------------------------

test('a v1 plants array still moves the plants it lines up with', () => {
  const firstPlant = DECOR.plants[0];
  applyLayout({ layout: 1, plants: [{ x: 5, z: 5 }] });
  assert.equal(firstPlant.x, 5);
  assert.equal(firstPlant.z, 5);
});

test('a v2 singleton couch entry lands on the first couch', () => {
  applyLayout({ layout: 2, couch: { x: 12, z: 12, facing: 0 } });
  assert.equal(furnitureOfKind('couch')[0].x, 12);
});

// --- cardinality rules --------------------------------------------------------

test('addStation enforces max per kind, where a kind has one', () => {
  // The mailbox used to be the example here — 'no second mailbox, ever' — and is now
  // the counter-example: the cap existed because `Post` could not say which box an
  // envelope was in, and once it could, the second box was fine. What is still capped
  // is capped for a reason about the thing: one coffee machine, one coat stand.
  assert.ok(addStation('mailbox'), 'a second post box is allowed now');
  assert.ok(addStation('bookshelf'), 'bookshelves may multiply');
  assert.equal(addStation('coffee'), null, 'one espresso machine is enough');
  assert.equal(addStation('coatStand'), null);
});

test('the last of a load-bearing thing cannot be removed', () => {
  // The coat stand is the only one left on this list, and it is worth noticing what
  // that means: as the room grew second ways of doing things, the set of individually
  // undeletable props shrank to one. The bookshelf came off it when the telescope
  // arrived and the mailbox when the printer learned to fax, in
  // both cases without `canRemoveObject` changing. `test/station-roles.test.js` is
  // where each of those is pinned properly.
  assert.equal(canRemoveObject('station:coatStand').ok, false, 'the only census station');
  assert.equal(canRemoveObject('station:mailbox').ok, true);
  assert.equal(canRemoveObject('station:telescope').ok, true);
  assert.equal(canRemoveObject('station:bookshelf').ok, true);

  // But a second bookshelf frees the first.
  const extra = addStation('bookshelf');
  assert.ok(canRemoveObject(`station:${extra.id}`).ok);
  assert.ok(removeObject(`station:${extra.id}`));
});

test('the office keeps at least one desk', () => {
  while (DESKS.length > DESK_LIMITS.min) {
    assert.ok(removeObject(`desk:${DESKS[DESKS.length - 1].id}`));
  }
  assert.equal(canRemoveObject(`desk:${DESKS[0].id}`).ok, false);
});

test('agentCapacity is the desk count, derived not stored', () => {
  const was = agentCapacity();
  addDesk();
  assert.equal(agentCapacity(), was + 1);
});

test('ids fill no gaps: a deleted mid-list desk is not reincarnated', () => {
  assert.ok(removeObject('desk:desk-3'));
  const added = addDesk();
  assert.notEqual(added.id, 'desk-3', 'a recycled id would point a saved layout at different furniture');
});

test('the Standing desk menu item adds a desk that stands', () => {
  // The bug this pins was invisible from the menu: the item was keyed `standingDesk`, with no
  // colon in it, and `addObject` reads a key with no colon as a bare family — so it came out
  // as family `desk`, kind nothing, and quietly added an ordinary desk. The branch written to
  // catch `standingDesk` sat below, unreachable. A kind of desk now says so in the half of
  // the key that means kind.
  const offered = addableObjects().find((o) => o.label === 'Standing desk');
  assert.ok(offered, 'the kit does not offer a standing desk at all');

  const before = DESKS.length;
  const made = addObject(offered.key, { x: 8, z: 8 });
  assert.ok(made, 'the menu item added nothing');
  assert.equal(made.spec.standing, true, 'the menu item added an ordinary desk');
  // And it is a desk from there on, in the headcount and under the desk key.
  assert.equal(DESKS.length, before + 1);
  assert.equal(agentCapacity(), before + 1);
  assert.match(made.key, /^desk:/);

  // The plain Desk item is unchanged by all this, and must not have caught `standing`.
  const plain = addObject('desk', { x: 4, z: 4 });
  assert.ok(plain);
  assert.ok(!plain.spec.standing, 'an ordinary desk came out standing');
});

test('every item the kit offers reaches the menu', () => {
  // The test that was missing, at the layer that was broken. `addableObjects` was green
  // throughout while the standing desk was absent from the menu, because the panel grouped
  // the list by matching keys against a fixed table and *dropped whatever it could not
  // place* — and the Workstations group matched the key `desk` exactly. Nothing was wrong
  // with the kit or with adding one: the option was swallowed between the two.
  //
  // The menu is grouped by what a kind is *for* now, with a catch-all last, so an item
  // has to land somewhere by construction. This still asks, because "by construction"
  // is a claim about code somebody can change: remove the catch-all and this fails
  // rather than the item vanishing from the UI.
  const offered = addableObjects();
  const sections = groupKit(offered);
  const reachable = sections.flatMap((sec) => sec.items.map((i) => i.key));

  const lost = offered.map((o) => o.key).filter((k) => !reachable.includes(k));
  assert.deepEqual(lost, [], `offered by the kit but in no menu section: ${lost.join(', ')}`);
  // And not by being in two places at once, which would put one item in the menu twice.
  assert.equal(reachable.length, new Set(reachable).size, 'an item is in more than one section');
  assert.equal(reachable.length, offered.length);

  // The standing desk by name, since it is the one this was found through: a kind of desk
  // belongs among the workstations, not off in the furniture.
  const workstations = sections.find((sec) => sec.name === 'Workstations')?.items ?? [];
  assert.ok(workstations.some((i) => i.label === 'Standing desk'),
    'the standing desk is not offered among the workstations');
});

test('a station lands in a section by the job it does, not by a list of names', () => {
  // The property the sectioning exists for: a kind nothing has heard of should appear
  // under the right heading on the strength of its own `roles`.
  const offered = [
    ...addableObjects(),
    { key: 'station:telescope', label: 'Telescope', roles: ['research'], note: null },
  ];
  const research = groupKit(offered).find((sec) => sec.name === 'Research');
  assert.ok(research.items.some((i) => i.label === 'Telescope'),
    'a research station should reach the research section with no menu edit');
});

test('a required job is a section even when there is nothing to add to it', () => {
  // A room with its one coat stand offers no coat stand, and "one needed · Coat stand
  // has it" is exactly what is worth saying in that space. The old picker listed only
  // what was addable, so it could not say it.
  const sections = groupKit(addableObjects(), {
    required: JOB_ROLES,
    covered: Object.fromEntries(JOB_ROLES.map((r) => [
      r, stationsForRole(r).map((st) => STATION_KINDS[st.kind].label),
    ])),
    verbs: ROLE_VERBS,
  });
  const census = sections.find((sec) => sec.name === 'Who is here');
  assert.ok(census, 'the census section should be drawn even with nothing to add');
  assert.equal(census.items.length, 0);
  assert.deepEqual(census.need.missing, [], 'the room has a coat stand, so nothing is missing');
  assert.deepEqual(census.need.by, ['Coat stand']);
});

test('a required job with nothing doing it reports itself missing', () => {
  const sections = groupKit(addableObjects(), {
    required: JOB_ROLES,
    covered: { intake: ['Mailbox'], dispatch: ['Mailbox'], research: ['Bookshelf'], census: [] },
    verbs: ROLE_VERBS,
  });
  const census = sections.find((sec) => sec.name === 'Who is here');
  assert.deepEqual(census.need.missing, ['census']);
});

test('both kinds of desk answer to the five-desk limit', () => {
  // Offered inside the desk limit rather than beside it: a standing desk is a desk, so a full
  // room offers neither.
  while (DESKS.length < DESK_LIMITS.max) addObject('desk', {});
  const labels = addableObjects().map((o) => o.label);
  assert.ok(!labels.includes('Desk'), 'a full room still offers a desk');
  assert.ok(!labels.includes('Standing desk'), 'a full room still offers a standing desk');
});

test('addObject speaks the footprint-key dialect the editor uses', () => {
  const made = addObject('plant:fig', { x: 5, z: 5 });
  assert.match(made.key, /^plant:plant-\d+$/);
  assert.ok(removeObject(made.key));
});

test('the armchair is offered by the editor but absent from the authored room', () => {
  assert.equal(furnitureOfKind('armchair').length, 0);
  assert.ok(addableObjects().some((item) => item.key === 'furniture:armchair'));
});

// --- derivation ---------------------------------------------------------------

test('every desk, station, furniture piece and floor plant blocks floor', () => {
  const keys = new Set(obstacleFootprints().map((f) => f.key));
  for (const d of DESKS) assert.ok(keys.has(`desk:${d.id}`));
  for (const s of Object.values(STATIONS)) {
    if (STATION_KINDS[s.kind]) assert.ok(keys.has(`station:${s.id}`), s.id);
  }
  for (const f of FURNITURE) assert.ok(keys.has(`furniture:${f.id}`), f.id);
  for (const p of DECOR.plants) assert.ok(keys.has(`plant:${p.id}`), p.id);
});

test('a turned prop swaps its footprint onto the other axis', () => {
  const couch = furnitureOfKind('couch')[0];
  const rectAt = () => obstacleFootprints().find((f) => f.key === `furniture:${couch.id}`);
  const square = rectAt();
  couch.facing = Math.PI / 2;
  reviseLayout();
  const turned = rectAt();
  const w = (r) => r.x1 - r.x0;
  const d = (r) => r.z1 - r.z0;
  assert.ok(Math.abs(w(square) - d(turned)) < 1e-9);
  assert.ok(Math.abs(d(square) - w(turned)) < 1e-9);
});

test("a station's approach point and lookRotation travel with it", () => {
  const cooler = STATIONS.waterCooler;
  const before = { ...cooler.approach };
  cooler.x += 2;
  reviseLayout();
  assert.ok(cooler.approach.x !== before.x, 'approach re-derived after a move');
  // The prop looks at its own approach point, by definition.
  const dx = cooler.approach.x - cooler.x;
  const dz = cooler.approach.z - cooler.z;
  assert.ok(Math.abs(cooler.facing - Math.atan2(dx, dz)) < 1e-9);
});

test('couch seats derive per couch, so two couches are two places to sit', () => {
  const second = addFurniture('couch', { x: 8, z: 8, facing: 0 });
  reviseLayout();
  const [a, b] = furnitureOfKind('couch');
  assert.equal(b.seats.length, a.seats.length);
  assert.notDeepEqual(a.seats[0], b.seats[0]);
  assert.ok(insideCouch(second.x, second.z));
});

test('an armchair derives one couch-compatible seat', () => {
  const chair = addFurniture('armchair', { x: 8, z: 8, facing: Math.PI / 2 });
  reviseLayout();
  assert.equal(chair.seats.length, 1);
  assert.ok(insideCouch(chair.x, chair.z));
  assert.notDeepEqual(
    { x: chair.seats[0].x, z: chair.seats[0].z },
    chair.seats[0].front,
  );
});

test('windowSpan mirrors the left wall, as the header warns', () => {
  const back = windowSpan('back', 0);
  const left = windowSpan('left', 0);
  assert.equal(back.axis, 'x');
  assert.equal(left.axis, 'z');
  // The left wall runs against world z, so a centre fraction of 0.62 lands at
  // (1 - 0.62) of the wall's length — the mirroring that caught the paper planes.
  assert.ok(Math.abs(left.centre - (1 - 0.62) * 20) < 1e-9);
  assert.equal(windowSpan('back', 9), null);
});

test('addPlant refuses an unknown species rather than planting a mystery', () => {
  assert.equal(addPlant('triffid'), null);
  const fern = addPlant('fern', { x: 4, z: 4 });
  assert.ok(fern);
  assert.equal(fern.scale, 1.1, "a new plant arrives at its kind's default size");
});

// --- what a piece can have done to it ----------------------------------------
//
// The editor draws its controls from these three questions, so a wrong answer here is
// a panel offering a gesture that does nothing or refusing one that would have worked.

const theRug = () => furnitureOfKind('rug')[0];

test('a rug turns, and its heading survives a round trip', () => {
  theRug().facing = Math.PI / 2;
  applyLayout(layoutSnapshot({ round: false }));
  assert.equal(theRug().facing, Math.PI / 2);
});

test('a plant turns, and its heading survives a round trip', () => {
  const plant = DECOR.plants[0];
  plant.facing = Math.PI;
  applyLayout(layoutSnapshot({ round: false }));
  assert.equal(DECOR.plants.find((p) => p.id === plant.id).facing, Math.PI);
});

test('a plant added by the editor is given a heading to turn', () => {
  const made = addObject('plant:fig', {});
  assert.equal(typeof made.spec.facing, 'number');
});

test('the floor lamp says why it does not turn', () => {
  const lamp = FURNITURE.find((f) => f.kind === 'floorLamp');
  const verdict = canTurnObject(`furniture:${lamp.id}`);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /every side/);
});

test('an instance names the kit entry that would make another of it', () => {
  assert.equal(kitKeyOf('desk:desk-1'), 'desk');
  assert.equal(kitKeyOf(`plant:${DECOR.plants[0].id}`), `plant:${DECOR.plants[0].kind}`);
  assert.equal(kitKeyOf('station:bookshelf'), 'station:bookshelf');
  assert.equal(kitKeyOf(`furniture:${theRug().id}`), 'furniture:rug');
});

// --- a rug is furniture, not a fixture ----------------------------------------
//
// It was one per room by construction until the shape stopped making that rule. A
// reading corner and a meeting area want one each, and a room may want none.

test('the room is authored with exactly one rug', () => {
  assert.equal(furnitureOfKind('rug').length, 1);
});

test('a rug can be added, and the picker offers one', () => {
  assert.ok(addableObjects().some((o) => o.key === 'furniture:rug'));
  const made = addObject('furniture:rug', {});
  assert.ok(made);
  assert.equal(furnitureOfKind('rug').length, 2);
});

test('a rug can be taken out, down to none', () => {
  const first = theRug();
  assert.equal(canRemoveObject(`furniture:${first.id}`).ok, true);
  assert.equal(removeObject(`furniture:${first.id}`), true);
  assert.equal(furnitureOfKind('rug').length, 0);
});

test('a rug is measured but never walked around', () => {
  const rect = obstacleFootprints().find((r) => r.key === `furniture:${theRug().id}`);
  // It has a rectangle, so the editor can keep it on the floor and draw it under the
  // selection — but it is soft, so the nav grid ignores it and a desk may stand on it.
  assert.ok(rect, 'the rug has a footprint');
  assert.equal(rect.soft, true);
  assert.equal(rect.x1 - rect.x0, 9);
  assert.equal(rect.z1 - rect.z0, 7);
});

test('everything else blocks the floor for real', () => {
  const couch = FURNITURE.find((f) => f.kind === 'couch');
  assert.equal(obstacleFootprints().find((r) => r.key === `furniture:${couch.id}`).soft, false);
});

test('turning a rug swaps which way its long side runs', () => {
  const rug = theRug();
  rug.facing = Math.PI / 2;
  const rect = obstacleFootprints().find((r) => r.key === `furniture:${rug.id}`);
  assert.equal(rect.x1 - rect.x0, 7);
  assert.equal(rect.z1 - rect.z0, 9);
});

// --- rug colour ---------------------------------------------------------------

test('a rug starts with no colour of its own, so the room paints it', () => {
  assert.equal(paletteOf(`furniture:${theRug().id}`).current, null);
});

test('only the kinds that come in colours have a palette', () => {
  assert.equal(paletteOf('desk:desk-1'), null);
  assert.equal(paletteOf(`plant:${DECOR.plants[0].id}`), null);
  // A side table is the colour a side table is; a sofa is upholstered.
  assert.equal(paletteOf(`furniture:${FURNITURE.find((f) => f.kind === 'sideTable').id}`), null);
  assert.equal(paletteOf(`furniture:${theRug().id}`).options.length, Object.keys(RUG_COLORS).length);
  const couch = FURNITURE.find((f) => f.kind === 'couch');
  assert.equal(paletteOf(`furniture:${couch.id}`).options.length, Object.keys(SOFA_COLORS).length);
});

test('a sofa and an armchair are upholstered from the same palette', () => {
  const couch = FURNITURE.find((f) => f.kind === 'couch');
  const chair = addFurniture('armchair', { x: 6, z: 6 });
  assert.equal(setObjectColor(`furniture:${couch.id}`, 'navy'), true);
  assert.equal(setObjectColor(`furniture:${chair.id}`, 'moss'), true);
  assert.equal(setObjectColor(`furniture:${chair.id}`, 'sage'), false, 'a rug colour is not a sofa colour');
  applyLayout(layoutSnapshot({ round: false }));
  assert.equal(FURNITURE.find((f) => f.id === couch.id).color, 'navy');
  assert.equal(FURNITURE.find((f) => f.id === chair.id).color, 'moss');
});

test('a colour is taken, a nonsense one is refused, and null hands it back', () => {
  const key = `furniture:${theRug().id}`;
  assert.equal(setObjectColor(key, 'clay'), true);
  assert.equal(theRug().color, 'clay');
  assert.equal(setObjectColor(key, 'chartreuse'), false);
  assert.equal(theRug().color, 'clay');
  assert.equal(setObjectColor(key, null), true);
  assert.equal(theRug().color, null);
});

test('two rugs are painted independently', () => {
  setObjectColor(`furniture:${theRug().id}`, 'ink');
  const second = addFurniture('rug', { x: 4, z: 4 });
  assert.equal(second.color, null);
  setObjectColor(`furniture:${second.id}`, 'plum');
  assert.equal(theRug().color, 'ink');
  assert.equal(second.color, 'plum');
});

test('a chosen colour survives a round trip, and so does no colour', () => {
  const key = `furniture:${theRug().id}`;
  setObjectColor(key, 'ink');
  applyLayout(layoutSnapshot({ round: false }));
  assert.equal(theRug().color, 'ink');
  setObjectColor(key, null);
  applyLayout(layoutSnapshot({ round: false }));
  assert.equal(theRug().color, null);
});

test('a blob that says nothing about colour leaves the colour alone', () => {
  const rug = theRug();
  setObjectColor(`furniture:${rug.id}`, 'plum');
  applyLayout({ layout: 4, furniture: { [rug.id]: { kind: 'rug', x: 10, z: 6 } } });
  assert.equal(theRug().color, 'plum');
  assert.equal(theRug().x, 10);
});

// --- reading the room a version 3 blob describes -------------------------------

test('a version 3 blob keeps its rug, which it kept under the decor', () => {
  applyLayout({
    layout: 3,
    decor: { rug: { x: 6, z: 4, facing: Math.PI / 2, color: 'slate' } },
  });
  assert.equal(theRug().x, 6);
  assert.equal(theRug().z, 4);
  assert.equal(theRug().facing, Math.PI / 2);
  assert.equal(theRug().color, 'slate');
});

test('a version 3 blob does not conjure a rug into a room with none', () => {
  removeObject(`furniture:${theRug().id}`);
  applyLayout({ layout: 3, decor: { rug: { x: 6, z: 4 } } });
  // A blob from before rugs could be counted is no evidence about how many there are.
  assert.equal(furnitureOfKind('rug').length, 0);
});
