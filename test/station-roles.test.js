// What a station is *for*, and what the room cannot go without.
//
// The office used to keep the last station of every *kind*, which made "required" a
// side effect of there being one of something. So it insisted on a printer that has no
// work, and a coat stand the code already copes without — while a second bookshelf
// freed the first, so the rule was never "the office needs a bookshelf" but "the office
// needs one of each kind it happens to own".
//
// A kind now declares the jobs it can do and `JOB_ROLES` says which jobs the room must
// keep somebody able to do. These pin the difference, and in particular the two
// properties the change exists for: a station doing no required job may simply go, and
// the capability is kept however it is provided.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATIONS, STATION_KINDS, JOB_ROLES, ROLE_VERBS,
  addStation, canRemoveObject, removeObject, resetLayout,
  rolesOf, stationForRole, stationsForRole, stationsOfKind,
} from '../src/layout.js';

beforeEach(() => resetLayout());

const canRemove = (kind) => canRemoveObject(`station:${kind}`);

// --- the table is coherent ---------------------------------------------------

test('every station kind says what it is for, even if that is nothing', () => {
  for (const [kind, def] of Object.entries(STATION_KINDS)) {
    assert.ok(Array.isArray(def.roles), `${kind} has no roles list`);
    for (const role of def.roles) {
      assert.ok(ROLE_VERBS[role], `${kind} claims role '${role}', which has no verb to say`);
    }
  }
});

test('every required job has somewhere to do it in the authored room', () => {
  for (const role of JOB_ROLES) {
    assert.ok(stationsForRole(role).length >= 1, `nothing in the room can ${role}`);
  }
});

test('every station kind now has a job, the printer last of all', () => {
  // This test used to assert `jobless === ['printer']`, with a note saying that if it
  // ever changed then the printer had been given a job and should be given the role
  // in the same commit. It did, and it does — so the tripwire fired exactly once and
  // becomes the opposite claim: nothing in the room is furniture pretending to be a
  // station any more.
  const jobless = Object.entries(STATION_KINDS)
    .filter(([, def]) => !def.roles.length)
    .map(([kind]) => kind);
  assert.deepEqual(jobless, [], 'a station with no roles is furniture in the wrong table');
  assert.deepEqual(STATION_KINDS.printer.roles, ['intake', 'dispatch'],
    'the printer both takes work out of the building and leaves paper to collect');
});

// --- what may go, and what may not -------------------------------------------

test('a station doing no required job can be taken out', () => {
  // The whole point. None of these was removable before, and none of them for a reason
  // anybody had given: the printer does nothing, the bin's job is not required, and the
  // machines are two ways to do one job that is not required either.
  assert.equal(canRemove('printer').ok, true, 'a printer with no work is not load-bearing');
  assert.equal(canRemove('bin').ok, true, 'discard is not one of JOB_ROLES');
  assert.equal(canRemove('coffee').ok, true, 'refresh is not one of JOB_ROLES');
  assert.equal(canRemove('waterCooler').ok, true);
});

test('the last station able to do a required job stays', () => {
  assert.equal(canRemove('coatStand').ok, false, 'the only census station');

  // Dispatch takes two removals now, because the printer faxes work out as well as the
  // post taking it — so the post is no longer the only way out, exactly as
  // the bookshelf is no longer the only place to look something up.
  assert.equal(canRemove('mailbox').ok, true, 'the printer can dispatch too');
  assert.ok(removeObject('station:mailbox'));
  assert.equal(canRemove('printer').ok, false, 'now the only way out');

  // Research takes two removals now, because the room ships two ways to do it: the
  // bookshelf and the telescope. Neither is individually load-bearing, and
  // whichever is left is the one that stays — which is the rule, not a fact about
  // bookshelves. This assertion used to read `canRemove('bookshelf').ok === false`,
  // and the day a second research station arrived it became a statement about the
  // furniture the room happened to own.
  assert.equal(canRemove('bookshelf').ok, true, 'the telescope can look things up too');
  assert.ok(removeObject('station:bookshelf'));
  assert.equal(canRemove('telescope').ok, false, 'now the only research station');
});

test('a refusal names the job it is protecting, not the furniture', () => {
  // "The office needs its Mailbox" was a sentence about the furniture, and read as
  // arbitrary because it was. The job is the reason, so the job is what is said.
  // Both said of the *second* station to provide the job rather than the first, which
  // is the point: the sentence must not have changed with the furniture. Down to one
  // of each first, so the refusals have something to protect.
  assert.ok(removeObject('station:bookshelf'));
  assert.ok(removeObject('station:inbox'));
  assert.ok(removeObject('station:mailbox'));

  assert.match(canRemove('telescope').why, /somewhere to look things up/);
  assert.match(canRemove('printer').why, /somewhere to collect/);
  assert.ok(!/Mailbox|Bookshelf|Telescope|Printer/.test(
    canRemove('printer').why + canRemove('telescope').why,
  ), 'a refusal should not name the prop');
});

test('the inbox may go, because the post can also be collected from', () => {
  // Three stations, one required job: none of them individually load-bearing. The
  // printer joined this list later — a printout is work to pick up, so the machine
  // is somewhere work arrives as surely as the post is.
  // As a set, not a list. `stationsForRole` documents its order as "the order they
  // were added", and after any test in this file removes a station `resetLayout()`
  // re-adds it at the end of the key order — so the sequence here is a fact about
  // which test ran first, which is not a claim worth making.
  assert.deepEqual(
    stationsForRole('intake').map((st) => st.id).sort(),
    ['inbox', 'mailbox', 'printer'],
  );
  assert.equal(canRemove('inbox').ok, true);
  assert.ok(removeObject('station:inbox'));

  // …and the mailbox is *still* free, because the printer can do both of its jobs.
  // Which is the whole of the roles model pointed at the station it was written about: the post
  // stopped being load-bearing without a line of `canRemoveObject` changing.
  assert.equal(canRemove('mailbox').ok, true);
  assert.ok(removeObject('station:mailbox'));

  // Now the printer is the last of both, and the refusal names whichever job it is
  // last for first — intake, since that is the order `JOB_ROLES` is written in.
  assert.equal(canRemove('printer').ok, false);
  assert.match(canRemove('printer').why, /somewhere to collect/);
});

// --- the capability, however it is provided ----------------------------------

test('a second bookshelf frees the first', () => {
  // Told with the telescope out of the room, so this is about two of *one* kind — which
  // is the case that was already true before roles existed, and still has to be.
  assert.ok(removeObject('station:telescope'));
  assert.equal(canRemove('bookshelf').ok, false);
  const second = addStation('bookshelf');
  assert.ok(second);
  assert.equal(canRemoveObject(`station:${second.id}`).ok, true);
  assert.equal(canRemove('bookshelf').ok, true,
    'with two places to look things up, neither is the last one');
});

test('a new kind can satisfy an existing job, and nothing mentions the old one', () => {
  // The property the whole roles model exists for, and the reason the telescope was a small
  // change: a telescope frees the bookshelf with no rule anywhere hearing about
  // telescopes. Written against a fixture at the time, because the telescope
  // did not exist; now it does, so the test is the real thing and no longer has to
  // pretend. (The fixture version is below — the property has to hold for kinds that
  // have not been built yet, which is the whole claim.)
  assert.equal(stationsOfKind('telescope').length, 1, 'the authored room has one');
  assert.equal(canRemove('bookshelf').ok, true,
    'the room needs somewhere to look things up, not a bookshelf');

  // And research routes to whichever is nearer, with no special case for either.
  // Measured from standing room: the shelf's is (13.1, 3.0), the telescope's (16.9, 3.25).
  assert.equal(stationForRole('research', { from: { x: 20, z: 4 } }).kind, 'telescope');
  assert.equal(stationForRole('research', { from: { x: 9, z: 4 } }).kind, 'bookshelf');
});

test('a kind nobody has built yet can satisfy a job too', () => {
  // The same property as above, for a kind that does not exist — which is the part
  // that cannot be shown with shipped furniture. A periscope is invented here purely
  // to be something no line of the codebase has ever heard of.
  STATION_KINDS.periscope = {
    label: 'Periscope', max: 1, roles: ['research'], hw: 0.5, hd: 0.5, approachDist: 1.6,
  };
  try {
    assert.ok(removeObject('station:telescope'));
    assert.equal(canRemove('bookshelf').ok, false, 'the only research station, for now');
    const up = addStation('periscope', { x: 8, z: 4 });
    assert.ok(up, 'the room would not take a periscope');
    assert.equal(canRemove('bookshelf').ok, true, 'and now it is not');
    assert.equal(stationForRole('research', { from: { x: 8, z: 6 } }).kind, 'periscope');
  } finally {
    delete STATION_KINDS.periscope;
    resetLayout();
  }
});

test('the two research stations serve the two scopes a lookup comes with', () => {
  // `serves` is a preference, not a filter, and `_research` passes the feed's own scope
  // straight into it — so this is the whole of the routing, checked without an agent.
  assert.equal(stationForRole('research', { serves: 'web' }).kind, 'telescope');
  assert.equal(stationForRole('research', { serves: 'graph' }).kind, 'bookshelf');

  // And with one of them gone the other answers both, rather than a web lookup finding
  // nowhere to go. This is why `serves` must stay a preference.
  assert.ok(removeObject('station:telescope'));
  assert.equal(stationForRole('research', { serves: 'web' }).kind, 'bookshelf');
});

// The test that stood here — 'giving the printer a job makes it load-bearing, with no
// other change' — has been deleted rather than updated, because it was the printer's
// future written as a fixture and that future has happened. Its claims are now made by
// the real
// furniture in the three tests above.
//
// It also had to go: its `finally` restored `STATION_KINDS.printer.roles = []`, which
// was correct while the printer really had no roles and became a *permanent* wipe of
// the real ones the moment it did — `resetLayout()` in `beforeEach` puts `STATIONS`
// back and has no business with `STATION_KINDS`. So every test after it in the file ran
// against a printer with no job, which is how a passing suite hid a broken room. The
// same shadowing hazard the telescope fixture had, and the reason the
// fixture below invents a kind nobody ships.

// --- asking for a job rather than a name -------------------------------------

test('a job is found by what it is, not by what the prop is called', () => {
  // Asked from somewhere, the way every caller in AgentManager asks it. Without a
  // `from` this returns whichever provider happens to be first in the table, which was
  // a safe thing to assert while each of these jobs had exactly one — and stopped being
  // one the day the printer started dispatching too.
  const near = (role, from) => stationForRole(role, { from })?.id;
  assert.equal(near('dispatch', { x: 3, z: 5 }), 'mailbox', 'the post is by the door');
  assert.equal(near('dispatch', { x: 22, z: 4 }), 'printer', 'the machine is by desk-2');
  assert.equal(near('research', { x: 12, z: 4 }), 'bookshelf');
  assert.equal(near('census', { x: 6, z: 3 }), 'coatStand');
  assert.equal(near('discard', { x: 24, z: 3 }), 'bin');
  assert.equal(stationForRole('nonsense'), null, 'a job nothing does is null, not a throw');
});

test('several stations for one job: the nearest wins', () => {
  // Measured to the standing room rather than the prop, because that is where somebody
  // actually ends up. The cooler stands its people at (3.2, 8.6), the machine at
  // (3.3, 16.8), so the far end of the room picks the far machine.
  assert.equal(stationForRole('refresh', { from: { x: 3, z: 8 } }).id, 'waterCooler');
  assert.equal(stationForRole('refresh', { from: { x: 3, z: 17 } }).id, 'coffee');
});

test('serves is a preference, so a room with one machine still serves everyone', () => {
  // A drink names what it is and the room finds somewhere serving it. Asked for tea
  // with no espresso machine in the building, a water cooler is the right answer —
  // the alternative was tea drinkers walking to a prop that is not there.
  assert.equal(stationForRole('refresh', { serves: 'tea' }).id, 'coffee');
  assert.equal(stationForRole('refresh', { serves: 'water' }).id, 'waterCooler');

  assert.ok(removeObject('station:coffee'));
  assert.equal(stationForRole('refresh', { serves: 'tea' }).id, 'waterCooler',
    'no machine for tea, so the cooler will do');
  assert.equal(stationForRole('refresh', { serves: 'cocoa' }).id, 'waterCooler',
    'and a drink nothing serves still finds somewhere');
});

test('the post, the stack and the tray are one job with three supplies', () => {
  // `serves` names which supply is wanted, and there are three of them since the
  // printer's tray joined: addressed post, the bottomless inbox stack, and
  // paper the office printed for itself.
  assert.equal(stationForRole('intake', { serves: 'post' }).id, 'mailbox');
  assert.equal(stationForRole('intake', { serves: 'stock' }).id, 'inbox');
  assert.equal(stationForRole('intake', { serves: 'print' }).id, 'printer');

  // And a preference rather than a filter, which is what keeps a stripped room working:
  // with no stack to take from, work is collected from whatever else takes work in.
  assert.ok(removeObject('station:inbox'));
  const fallback = stationForRole('intake', { serves: 'stock' });
  assert.ok(fallback, 'a room with no stack still has somewhere work arrives');
  assert.ok(['mailbox', 'printer'].includes(fallback.id), `fell back to ${fallback.id}`);
});

// --- the rule cannot be satisfied by accident --------------------------------

test('rolesOf answers for a station, and shrugs at anything else', () => {
  assert.deepEqual(rolesOf(STATIONS.mailbox), ['intake', 'dispatch']);
  assert.deepEqual(rolesOf(STATIONS.printer), ['intake', 'dispatch'],
    'the printer has a job of its own');
  assert.deepEqual(rolesOf(null), []);
  assert.deepEqual(rolesOf({ kind: 'not-a-kind' }), []);
});

test('the room can be stripped to exactly the jobs it needs', () => {
  // The end state the model allows and the old rule forbade: everything optional gone,
  // every required job still done, and nothing left that can be removed.
  // The telescope is on this list because research is now covered twice, so one of the
  // two goes with everything else optional. Which one is arbitrary — taking the
  // telescope leaves the shelf, and `stationsForRole` below does not care either way.
  for (const kind of ['printer', 'bin', 'coffee', 'waterCooler', 'inbox', 'telescope']) {
    assert.ok(removeObject(`station:${kind}`), `${kind} should have been removable`);
  }
  for (const role of JOB_ROLES) {
    assert.ok(stationsForRole(role).length >= 1, `stripped too far: nothing can ${role}`);
  }
  for (const s of Object.values(STATIONS)) {
    if (!STATION_KINDS[s.kind]) continue;
    assert.equal(canRemoveObject(`station:${s.id}`).ok, false,
      `${s.id} is still removable, so the room was not stripped to the bone`);
  }
  assert.deepEqual(
    Object.values(STATIONS).map((s) => s.kind).sort(),
    ['bookshelf', 'coatStand', 'mailbox'],
    'three props cover all four required jobs, because the mailbox does two',
  );
});

test('a kind may still be capped at one of itself', () => {
  // Roles are the floor; `max` is still the ceiling, and they are independent.
  assert.equal(addStation('coffee'), null, 'one espresso machine is enough');
  assert.ok(addStation('bookshelf'), 'bookshelves may multiply');
  assert.equal(stationsOfKind('bookshelf').length, 2);
});
