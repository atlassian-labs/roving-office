// The printer, given a job.
//
// It went into the room as the one station nothing sent anybody to: placeable, turnable,
// saved with the layout, standing room derived, and no reason to walk over. The ticket
// asked whether a print is an *arrival* (new work, like the post) or a *product*
// (finished work, like posting) and said to decide rather than let the animation decide.
//
// The answer is both, in that order, and the order is what these tests pin:
//
//   1. `dispatch` — finished work is faxed out. The office is rid of it.
//   2. `intake` — the machine keeps a copy, and that sheet is material for whoever needs
//      some next. So the tray fills because the room has been *working*, which is what
//      makes a printout different from the post: an envelope comes from outside the
//      building and this does not.
//
// The tray is `Post`, per box, and that is the second thing these tests pin. It had its
// own model for a day — a `PrintTray` keyed by station id — and the question "shouldn't a
// room with only a printer work?" showed that to be wrong twice: a separate queue could
// not *bootstrap*, since the only thing filling it was the office's own output, and it
// could not hold anything *addressed*, since it was a count. `Post` had solved both since
// So a fax is post, the printer is a box, and the second model is gone.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { play, playUntil } from './lib/frames.js';
import { arrived, loadRoom, stubDesk } from './lib/room.js';

let Post, buildPrinter, layout;

before(async () => {
  await loadRoom();
  ({ Post } = await import('../src/agents/post.js'));
  ({ buildPrinter } = await import('../src/scene/props/printer.js'));
  layout = await import('../src/layout.js');
});

beforeEach(() => layout.resetLayout());

// --- a fax is post, and the tray is a box ------------------------------------

test('a fax lands in the machine it came out of, and each box counts its own', () => {
  const post = new Post();
  post.land({ job: 'One', arrival: 'fax', box: 'printer' });
  post.land({ job: 'Two', arrival: 'fax', box: 'printer-2' });
  post.land({ job: 'Three', arrival: 'letter', box: 'mailbox' });

  assert.equal(post.countByArrival('fax', 'printer'), 1);
  assert.equal(post.countByArrival('fax', 'printer-2'), 1);
  assert.equal(post.countByArrival('letter', 'printer'), 0);
  // And the post is not confused by it: a mailbox shows letters, not faxes.
  assert.equal(post.countByArrival('fax', 'mailbox'), 0);
  assert.equal(post.countByArrival('letter', 'mailbox'), 1);
});

test('a fax can be addressed, which a bare count could never be', () => {
  // The reason the separate tray model had to go. Work faxed in for a particular agent
  // has to be collectable by that agent and nobody else, and a number cannot say so.
  const post = new Post();
  post.land({ job: 'For Ada', forId: 'ada', arrival: 'fax', box: 'printer' });
  assert.equal(post.canCollect('ada', 'printer'), true);
  assert.equal(post.canCollect('bob', 'printer'), false,
    'somebody else took a fax addressed to Ada');
});

test('a room with only a printer can still receive work', () => {
  // The question that found all of this: the printer does both required jobs, so the
  // rules allow a room with nothing else — and that room could once never get
  // its first job, because a plane had nowhere to land and the tray only filled from
  // the office's own output. A channel is available only if it has somewhere to come in.
  layout.removeObject('station:mailbox');
  layout.removeObject('station:inbox');
  layout.reviseLayout();

  assert.deepEqual(layout.stationsForRole('intake').map((s) => s.id), ['printer']);
  assert.deepEqual(layout.stationsForRole('dispatch').map((s) => s.id), ['printer']);
  assert.deepEqual(layout.postBoxes(), [], 'no post box, so no plane');
  // A parcel *can* come, though, and that is the difference between the two channels: a
  // plane needs a slot to dive into and a courier only needs somewhere to put a box
  // down, so a package lands beside the printer (see `PARCEL_PREFERENCE`).
  assert.deepEqual(layout.enabledArrivals(['letter', 'package', 'fax']), ['package', 'fax'],
    'the ways in should be the ones the room has somewhere for');
  assert.equal(layout.postBoxFor(Math.random, 'fax').id, 'printer');
  assert.equal(layout.postBoxFor(Math.random, 'package').id, 'printer');
  assert.equal(layout.postBoxFor(Math.random, 'letter'), null,
    'a letter has nowhere to dive, and saying so is the whole fix');
});

test('a room with no way in at all says so rather than posting into thin air', () => {
  // The inbox is somewhere to take work *from*, not somewhere work arrives. So a room
  // down to the stack has no channels, and `enabledArrivals` is allowed to be empty —
  // it used to guarantee a non-empty answer by falling back to letters, which in a room
  // with no box meant posting work nowhere and losing it.
  layout.removeObject('station:mailbox');
  layout.reviseLayout();
  assert.deepEqual(layout.landingsFor('letter'), []);
  assert.deepEqual(layout.enabledArrivals(['letter']), []);
});

// --- the prop draws what it is told -----------------------------------------

test('the tray shows what the queue holds, and caps its drawing not its counting', () => {
  const { handle } = buildPrinter();
  const shown = () => handle.sheets.filter((s) => s.visible).length;

  // One sheet to start with: a printer with an empty output tray is a printer nobody
  // has ever used, and that askew sheet was in the prop before it had a job.
  assert.equal(shown(), 1);

  handle.setWaiting(3);
  assert.equal(shown(), 3);
  handle.setWaiting(0);
  assert.equal(shown(), 0);

  // Past the slots it has, the drawing caps and the number does not — the same
  // arrangement as the mailbox's backlog.
  handle.setWaiting(50);
  assert.equal(shown(), handle.sheets.length);
  assert.equal(handle.waiting, 50, 'the count should not be clamped to the slots');
});

test('a print runs the machine, whether or not the page lands', () => {
  const { handle } = buildPrinter();
  assert.equal(handle._run, 0);
  handle.print(() => 0.9);            // no overshoot
  assert.ok(handle._run > 0, 'the machine should be busy after a print');
  assert.equal(handle.overshot, false);
});

test('once in a while the page misses the tray, and waits on the floor', () => {
  const { handle } = buildPrinter();
  assert.equal(handle.overshot, false);

  // Forced, because the whole point of the gag is that it is occasional: the odds live
  // in the prop and the draw is injected so a test can have either outcome on demand.
  assert.equal(handle.print(() => 0), true, 'a losing draw should throw the page clear');
  assert.equal(handle.overshot, true);

  // And not twice: the joke is one loose sheet somebody has to walk round, not a drift.
  assert.equal(handle.print(() => 0), false, 'a second overshoot while one is down');
  assert.equal(handle.overshot, true);

  handle.retrieve();
  assert.equal(handle.overshot, false);
});

test('the ready light goes amber while it works and green when it stops', () => {
  // The whole of the machine's mood from across the room, so it is worth reading the
  // actual colour rather than trusting the timer that drives it.
  const GREEN = 0x5fd08a;
  const AMBER = 0xe8ab52;
  const { obj, handle } = buildPrinter();
  const light = obj.children.find((c) => c.material?.emissive?.getHex?.() === GREEN);
  assert.ok(light, 'the prop should have a ready light to read');

  handle.update(0.016);
  assert.equal(light.material.color.getHex(), GREEN, 'idle should be green');

  handle.print(() => 0.9);
  handle.update(0.016);
  assert.equal(light.material.color.getHex(), AMBER, 'working should be amber');

  // And it comes back on its own, rather than staying amber until something else
  // happens to it.
  for (let i = 0; i < 200; i++) handle.update(0.05);
  assert.equal(handle._run, 0);
  assert.equal(light.material.color.getHex(), GREEN, 'it never went back to ready');
});

test('each printer has its own light, not the material cache’s', () => {
  // `box()` hands out materials from a shared cache, so a prop that writes to one
  // writes to every prop drawn in that colour. The agents' cup learned this and says
  // so; this is the same trap two printers would fall into.
  const a = buildPrinter();
  const b = buildPrinter();
  const findReady = (h) => h.obj.children.find(
    (c) => c.material?.emissive && c.material.emissive.getHex?.() === 0x5fd08a,
  );
  const ra = findReady(a);
  const rb = findReady(b);
  assert.ok(ra && rb, 'both printers should have a ready light');
  assert.notEqual(ra.material, rb.material, 'two printers sharing one light material');
});

test('the page that overshoots lands within reach of the standing room', () => {
  // An agent picks this up *from* the standing room rather than walking to it, so if it
  // lands further off than an arm's length the sheet vanishes while they are nowhere
  // near it — which is what the first version did, from 0.78 in front of the machine's
  // own face. Measured in world units through the prop's own scale, because the mesh is
  // positioned in the machine's local metres and `SCALE`/`PLAN` stretch them.
  const { obj } = buildPrinter();
  const station = layout.STATIONS.printer;
  const sheet = obj.children.find((c) => c.visible === false && c.geometry?.type === 'BoxGeometry'
    && Math.abs(c.geometry.parameters.height - 0.012) < 1e-9
    && Math.abs(c.geometry.parameters.depth - 0.30) < 1e-9);
  assert.ok(sheet, 'the prop should carry a hidden sheet for the overshoot');

  const k = obj.scale.x;                       // SCALE * PLAN, the plan stretch
  const at = { x: station.x + sheet.position.x * k, z: station.z + sheet.position.z * k };
  const reach = Math.hypot(at.x - station.approach.x, at.z - station.approach.z);
  assert.ok(reach < 1.1, `the loose page is ${reach.toFixed(2)} from where anybody stands`);

  // And on floor somebody walks on, not tucked under the machine.
  const def = layout.STATION_KINDS.printer;
  assert.ok(at.z > station.z + def.hd, 'the page landed inside the printer\'s footprint');
});

// --- what the room does with it ---------------------------------------------

test('the printer is a way out as well as a way in', () => {
  assert.deepEqual(layout.rolesOf(layout.STATIONS.printer), ['intake', 'dispatch']);
  assert.deepEqual(layout.STATION_KINDS.printer.serves, ['print']);
});

test('no paper plane is ever aimed at a printer', () => {
  // `postBoxes()` narrows intake stations to the ones serving `post`, so this is true
  // without a rule saying "not the printer" — which is the reason `serves` exists.
  // Getting it wrong would fly a plane through the window into a photocopier.
  assert.ok(layout.stationsForRole('intake').some((s) => s.kind === 'printer'));
  assert.ok(!layout.postBoxes().some((s) => s.kind === 'printer'),
    'the printer is in the draw for post, which it should never be');
  for (let i = 0; i < 40; i++) {
    assert.notEqual(layout.postBoxFor(() => i / 40).kind, 'printer');
  }
});

test('the nearest way out decides whether work is posted or faxed', () => {
  // Nearest rather than a draw, unlike an arrival: somebody carrying a finished thing
  // walks to the nearer of the two, which is a fact about where they sit. The post
  // stands its people at (3.1, 4.2) and the printer at (21.4, 2.85).
  const near = (x, z) => layout.stationForRole('dispatch', { from: { x, z } }).kind;
  assert.equal(near(4, 6), 'mailbox', 'a desk by the door posts');
  assert.equal(near(21, 6), 'printer', 'a desk by the machine faxes');
});

// --- the two errands, end to end --------------------------------------------
//
// The behaviour rather than the pieces: an agent who finishes work near the machine
// walks over and faxes it, and an agent who needs work takes the sheet that fax left
// behind. Built with a real `AgentManager` and stub props, the way the bin's own
// door-clearance test is, because what is being checked is the walk finishing — a
// station somebody can never actually reach passes every unit test in this file.

/** A printer that records what was asked of it. */
function stubPrinter() {
  return {
    id: 'printer',
    kind: 'printer',
    faxed: 0,
    printed: 0,
    retrieved: 0,
    waiting: 0,
    overshot: false,
    ringing: 0,
    fax() { this.faxed++; },
    print() { this.printed++; return false; },
    // The stub mirrors the real handle method for method, which is the point: a stub
    // missing one is how `ring` slipped through as `?.ring(...)` and threw.
    ring(seconds) { this.ringing = seconds; },
    retrieve() { this.retrieved++; this.overshot = false; },
    setWaiting(n) { this.waiting = n; },
    update() {},
  };
}

/** One agent, arrived and settled at a desk beside the machine. */
function officeByThePrinter() {
  const printer = stubPrinter();
  return { ...arrived({ desks: [stubDesk(21, 6)], byStation: { printer } }), printer };
}

test('finished work near the machine is faxed, and leaves a sheet behind', () => {
  const { manager, printer, rec } = officeByThePrinter();
  assert.equal(manager.post.countByArrival('fax', 'printer'), 0);

  // Stood by their desk before the event, because `_deliver` measures from where they
  // *are*. Clearing `arriving` only means they are through the door with a coat up —
  // they may still be on the mat, from which the post is nearer than the machine, and
  // the test would then be checking the mailbox path with a printer stub attached.
  rec.agent.setPositionXZ(21, 6);
  manager.handleEvent({ type: 'dispatch', id: 'a1', summary: 'Sent' });
  const sent = playUntil(manager, () => printer.faxed > 0, 60);

  assert.ok(sent !== null, 'the work never reached the printer at all');
  assert.equal(printer.printed, 1, 'the machine sent the fax and printed no copy');
  assert.equal(manager.post.countByArrival('fax', 'printer'), 1,
    'the copy did not land in the tray, so nobody will ever collect it');
});

test('a printout waiting in the tray is what somebody collects next', () => {
  const { manager } = officeByThePrinter();
  manager.post.land({ job: 'A printed copy', forId: null, arrival: 'fax', box: 'printer' });

  manager.handleEvent({ type: 'status', id: 'a1', status: 'working' });
  const took = playUntil(manager, () => manager.post.countByArrival('fax', 'printer') === 0, 60);

  assert.ok(took !== null, 'the sheet is still in the tray, so nobody went for it');
  const rec = manager.agents.get('a1');
  assert.equal(rec.hasMaterial, true, 'they came back from the printer empty-handed');
  assert.equal(rec.arrivedBy, 'fax',
    'what it arrived as is what it leaves as, so a fax collected is a fax delivered');
});

test('a page on the floor is picked up on the way to the tray', () => {
  // Before the tray, not after: the sheet is between them and the machine, and walking
  // over it to take a clean one off the top is not what anybody does.
  const { manager, printer } = officeByThePrinter();
  printer.overshot = true;
  manager.post.land({ job: 'A printed copy', forId: null, arrival: 'fax', box: 'printer' });

  manager.handleEvent({ type: 'status', id: 'a1', status: 'working' });
  playUntil(manager, () => printer.retrieved > 0, 60);
  assert.equal(printer.retrieved, 1, 'the loose page was left on the floor');
});

test('with nothing in the tray, work still comes off the inbox stack', () => {
  // The fallback that must not break: `serves` is a preference, so an empty tray sends
  // them to the stack rather than to a machine with nothing on it.
  const inbox = { id: 'inbox', kind: 'inbox', taken: 0, takePackage() { this.taken++; } };
  const { manager } = arrived({
    desks: [stubDesk(21, 6)],
    byStation: { printer: stubPrinter(), inbox },
  });

  manager.handleEvent({ type: 'status', id: 'a1', status: 'working' });
  playUntil(manager, () => inbox.taken > 0, 60);
  assert.equal(inbox.taken, 1, 'an empty tray should send them to the stack');
});

test('a printer-only room takes a job in, and sends it back out', () => {
  // The question that started all of this, as a test. The printer does both required
  // jobs, so the rules allow a room with nothing else — and a rule that allows a room
  // nothing can happen in is a rule pretending to be a decision.
  layout.removeObject('station:mailbox');
  layout.removeObject('station:inbox');
  layout.reviseLayout();

  const { manager, printer, rec } = officeByThePrinter();

  // In. `arrival` pinned, because this room can receive two ways — a fax out of the
  // machine and a parcel put down beside it — and the draw between them would make this
  // pass two times in three. Pinning is the same fix the flight test needed when the
  // fax channel arrived: a test about one channel should say which one.
  //
  // It rings first: the handset shakes on the machine's screen and the page lands as it
  // stops, so the envelope is not there on the same frame it was posted.
  manager.handleEvent({ type: 'mail', job: 'Something to do', forId: 'a1', arrival: 'fax' });
  assert.equal(manager.ringing.length, 1, 'the machine should be ringing');
  assert.equal(manager.post.countByArrival('fax', 'printer'), 0, 'and not landed yet');
  play(manager, 2);
  assert.equal(manager.post.countByArrival('fax', 'printer'), 1,
    'nothing arrived, so this room can never get its first job');

  manager.handleEvent({ type: 'status', id: 'a1', status: 'working' });
  const got = playUntil(manager, () => rec.hasMaterial, 90);
  assert.ok(got !== null, 'the fax was never collected');

  // Out: and the same machine is the way out.
  manager.handleEvent({ type: 'dispatch', id: 'a1', summary: 'done' });
  const sent = playUntil(manager, () => printer.faxed > 0, 90);
  assert.ok(sent !== null, 'the work could not leave the room');
});

test('an intake station with nothing to hand over is a quiet no, not a crash', () => {
  // A bug that pre-dated the printer having a job, and that the printer only gave a
  // second route to. `serves` is a preference, so in a room whose inbox is gone a
  // request for `stock` falls back to the post — and the mailbox has no `takePackage`.
  // `_propAt(station)?.takePackage()` read as safe, but the optional chain guards a
  // missing *prop*, not a missing *method*: the errand threw `takePackage is not a
  // function` and took the frame with it. Delete the inbox on any build before this one
  // and the first agent to want work brings the room down.
  layout.removeObject('station:inbox');
  layout.reviseLayout();

  const mailbox = {
    id: 'mailbox', kind: 'mailbox', deliveries: 0,
    deliver() { this.deliveries++; }, setWaiting() {}, update() {},
  };
  const { manager } = arrived({ byStation: { mailbox } });

  manager.handleEvent({ type: 'status', id: 'a1', status: 'working' });
  assert.doesNotThrow(() => play(manager, 60),
    'collecting from a station with no supply should be a no-op, not a throw');
});

// --- what the two errands look like -----------------------------------------

test('the handset shakes, then stops on its own', () => {
  // A fax has no journey — it does not fly in or arrive at the door — so the ring *is*
  // the arrival, and the manager holds the envelope for exactly as long as it lasts.
  const { obj, handle } = buildPrinter();
  const phone = obj.children
    .flatMap((c) => (c.children ?? []))
    .find((c) => c.children?.length === 3);
  assert.ok(phone, 'the screen should carry a handset to shake');
  assert.equal(phone.visible, false, 'and it should be hidden until there is a call');

  handle.ring(1);
  assert.equal(handle.ringing, true);
  assert.equal(phone.visible, true);

  // It shakes: the tilt has to actually move, not merely be set once.
  handle.update(0.1);
  const first = phone.rotation.z;
  handle.update(0.1);
  assert.notEqual(phone.rotation.z, first, 'the handset is not moving');

  for (let i = 0; i < 60; i++) handle.update(0.05);
  assert.equal(handle.ringing, false, 'it should stop on its own');
  assert.equal(phone.visible, false, 'and put itself away');
});

test('a ring counts as busy, so the machine lights up before the paper appears', () => {
  const GREEN = 0x5fd08a;
  const AMBER = 0xe8ab52;
  const { obj, handle } = buildPrinter();
  const light = obj.children.find((c) => c.material?.emissive?.getHex?.() === GREEN);
  handle.update(0.016);
  assert.equal(light.material.color.getHex(), GREEN);
  handle.ring(1);
  handle.update(0.016);
  assert.equal(light.material.color.getHex(), AMBER,
    'the machine should look like it is about to do something');
});
