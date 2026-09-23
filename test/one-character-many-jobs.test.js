// One person, several jobs at once.
//
// An OpenClaw agent gets a new session per cron tick, and a chat of its own besides. Each
// was drawn as a separate character, so a room watching two ten-minute watchers held three
// identical Sideline Crustons — same name, same shirt, same face, three desks. They were
// all honest, and together they were a lie about how many colleagues were in the room.
//
// The fix is that a `spawn` carrying an `actor` (spec §3.2) joins the person already here
// instead of arriving beside them, and the person leaves when their *last* job ends. What
// is pinned below is that, its edges, and the thing it must not disturb: a harness that
// sends no identity at all still gets one character per session, exactly as before.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoom } from './lib/room.js';
// Arrivals and departures are walks, so this file runs the room in tens of seconds.
import { play } from './lib/frames.js';

let THREE, AgentManager, buildDesk;

before(async () => {
  ({ THREE, AgentManager } = await loadRoom());
  ({ buildDesk } = await import('../src/scene/props/desk.js'));
});

const OPENCLAW = { id: 'openclaw' };
const CLAUDE = { id: 'claude-code' };

/** A room with a few desks and nobody in it yet. */
function office(deskCount = 4) {
  const desks = [];
  for (let i = 0; i < deskCount; i++) {
    desks.push(buildDesk({ id: `desk-${i + 1}`, x: i * 6, z: 8, facing: 0 }, i).handle);
  }
  const manager = new AgentManager(new THREE.Group(), { desks });
  return { manager, desks };
}

/** A tick of one of Sideline's cron jobs, as the reducer would announce it. */
function tick(manager, session, { actor = 'Sideline Cruston', source = OPENCLAW } = {}) {
  manager.handleEvent({ type: 'spawn', id: session, name: actor, actor }, source);
}

test('two sessions of one agent are one colleague with two jobs', () => {
  const { manager } = office();
  tick(manager, 'sess-rabbitohs');
  tick(manager, 'sess-utah');

  const roster = manager.roster();
  assert.equal(roster.length, 1, 'one person, not two');
  assert.equal(roster[0].name, 'Sideline Cruston');
  assert.equal(roster[0].jobs.length, 2, 'holding both jobs');
});

test('each job says what it is doing, in its own words', () => {
  const { manager } = office();
  tick(manager, 'sess-rabbitohs');
  tick(manager, 'sess-utah');
  manager.handleEvent({ type: 'job', id: 'sess-rabbitohs', job: 'Rabbitohs live watch' });
  manager.handleEvent({ type: 'job', id: 'sess-utah', job: 'Utah team results watch' });

  const [row] = manager.roster();
  assert.deepEqual(row.jobs.map((j) => j.title),
    ['Rabbitohs live watch', 'Utah team results watch']);
  assert.deepEqual(row.jobs.map((j) => j.status), ['working', 'working']);
});

test('one job ending is not the person going home', () => {
  const { manager } = office();
  tick(manager, 'sess-rabbitohs');
  tick(manager, 'sess-utah');

  manager.handleEvent({ type: 'exit', id: 'sess-rabbitohs' });
  const roster = manager.roster();
  assert.equal(roster.length, 1, 'still here — the other job is still open');
  assert.deepEqual(roster[0].jobs.map((j) => j.id), ['sess-utah']);
});

test('the last job ending is', () => {
  const { manager } = office();
  tick(manager, 'sess-rabbitohs');
  tick(manager, 'sess-utah');
  manager.handleEvent({ type: 'exit', id: 'sess-rabbitohs' });
  manager.handleEvent({ type: 'exit', id: 'sess-utah' });

  assert.equal(manager.agents.get('sess-rabbitohs').leaving, true, 'told to go home');
  // Leaving a building takes a door rather than a delete, so let them walk it.
  play(manager, 60);
  assert.equal(manager.roster().length, 0);
});

test('one desk for one person, however many jobs they hold', () => {
  // Worth pinning beside the random desk booking: a second job must not book
  // a second desk, or two ticks an hour would walk Sideline round the room all day.
  const { manager, desks } = office();
  tick(manager, 'sess-rabbitohs');
  tick(manager, 'sess-utah');
  tick(manager, 'sess-third');
  assert.equal(desks.filter((d) => d.occupiedBy).length, 1);
});

test("an event for the second session reaches the person who owns it", () => {
  const { manager } = office();
  tick(manager, 'sess-rabbitohs');
  tick(manager, 'sess-utah');
  // Through the door first: an arrival is not interrupted mid-stride, so a status sent
  // while somebody is still walking in is not the thing being tested here.
  play(manager, 30);
  manager.handleEvent({ type: 'status', id: 'sess-utah', status: 'error' });

  const [row] = manager.roster();
  // The job's own record is the proof of routing: it is only reachable by finding the
  // person from the session id, so a lookup that missed would have changed nothing.
  assert.equal(row.jobs.find((j) => j.id === 'sess-utah').status, 'error');
  assert.equal(row.jobs.find((j) => j.id === 'sess-rabbitohs').status, 'idle',
    "and the other job was not told something that did not happen to it");
  // Nothing is asserted about `row.status`. A status word is an instruction to *behave* —
  // an error sends somebody to the bin — so what the character ends up doing depends on
  // which props the room has and what they were already up to. That is the room's
  // business, tested where the room is; here it would only be a flaky way to ask a
  // question the job records above have already answered.
});

test('a harness with no identity keeps one character per session', () => {
  // Claude Code offers a terminal tab and no actor, so the office invents a person per
  // session. Nothing about that changes here, and two invented people must not merge.
  const { manager } = office();
  manager.handleEvent({ type: 'spawn', id: 's1', name: 'Greta Plugin-Wrangler' }, CLAUDE);
  manager.handleEvent({ type: 'spawn', id: 's2', name: 'Rosa Feel-Mender' }, CLAUDE);
  assert.equal(manager.roster().length, 2);
  assert.deepEqual(manager.roster().map((r) => r.jobs.length), [1, 1]);
});

test('two harnesses may each have a Sideline, and they are not the same person', () => {
  const { manager } = office();
  tick(manager, 'sess-a', { source: OPENCLAW });
  tick(manager, 'sess-b', { source: CLAUDE });
  assert.equal(manager.roster().length, 2, 'one name, two sources, two people');
});

test('somebody already walking out is not handed another job', () => {
  // They have been told to go home. Handing them work would either strand them mid-stride
  // or need the leaving unwound; a fresh arrival is simpler and truer to what happened.
  const { manager } = office();
  tick(manager, 'sess-rabbitohs');
  const rec = manager.agents.get('sess-rabbitohs');
  rec.leaving = true;

  tick(manager, 'sess-utah');
  assert.equal(manager.roster().length, 2, 'a new arrival rather than a job for a leaver');
});

test('a repeated spawn for one session is still ignored', () => {
  const { manager } = office();
  tick(manager, 'sess-rabbitohs');
  tick(manager, 'sess-rabbitohs');
  const [row] = manager.roster();
  assert.equal(manager.roster().length, 1);
  assert.equal(row.jobs.length, 1, 'the same session is not two jobs');
});

test('a session that has gone stops routing to a disposed character', () => {
  // `_remove` has to take the routing entries with it, or a straggling event would be
  // applied to somebody who has left the building.
  const { manager } = office();
  tick(manager, 'sess-rabbitohs');
  manager.handleEvent({ type: 'exit', id: 'sess-rabbitohs' });
  play(manager, 60);
  assert.equal(manager.jobOwner.size, 0);
  assert.equal(manager.byActor.size, 0);
  // And a later tick of the same job is a fresh arrival rather than a job for nobody.
  tick(manager, 'sess-next');
  assert.equal(manager.roster().length, 1);
  assert.equal(manager.roster()[0].jobs.length, 1);
});

// --- the work actually reaching each job ------------------------------------
//
// The two gaps that made this feature half-landed, found by driving the real AOP wire
// and watching the panel say "Writing / Idle" for ever. Both are about the difference
// between a *person* and a *job of theirs*, which is the whole idea here — and the
// difference the posting path did not know about.

test('post addressed to a second session reaches its owner', () => {
  // `_post` guarded on `this.agents.has(forId)`, and a joined session is in `jobOwner`
  // rather than in `this.agents` — so the envelope was discarded outright. The job then
  // sat idle for ever, with nothing to do and no title, while the roster showed it as a
  // job in hand. A feed is right to address a prompt to the session that typed it; the
  // manager is the thing that has to know a session may not be a person of its own.
  const { manager } = office();
  tick(manager, 'sess-utah');
  tick(manager, 'sess-ohio');
  play(manager, 40);
  const [first, second] = manager.roster()[0].jobs.map((j) => j.id);

  // `arrival` pinned, because this test is about *addressing* and the channel is a
  // draw over whatever the room can receive. A fax is held for a second while the
  // machine's handset rings, so on those draws the envelope is in flight
  // rather than in the box and a test that asserts an immediate landing fails one time
  // in three. The third test in this repo to need this line, and the same reason each
  // time: say which channel you mean.
  const air = { arrival: 'letter' };
  manager.handleEvent({ type: 'mail', job: 'Check the nightly backups', forId: first, ...air });
  assert.equal(manager.post.pending.length, 1, 'the first job is posted');

  manager.handleEvent({ type: 'mail', job: 'Rotate the access keys', forId: second, ...air });
  assert.equal(manager.post.pending.length, 2,
    "the second job's post was thrown away, so that job can never be given work");

  // Both envelopes belong to the one person, who is the only one who may open them.
  const owner = manager.roster()[0].id;
  for (const item of manager.post.pending) {
    assert.equal(item.forId, owner, 'addressed to the colleague, not to the session');
  }
  assert.deepEqual(
    manager.post.pending.map((i) => i.jobId).sort(),
    [first, second].sort(),
    'and each still knows which job of theirs it is the work for',
  );
});

test('opening an envelope names the job it was for, not the newest one', () => {
  // The panel's half. `_noteJob` is reached from `status`, `job` and `retitle`, and the
  // AOP reducer emits `mail` for a prompt and never `job` — so on any harness but the
  // test feed the job rows had a verb and no name at all. The title travels inside the
  // envelope by design, so opening it is the moment to read it, and it is read onto the
  // job it was addressed to rather than onto whichever is newest.
  const { manager } = office();
  tick(manager, 'sess-utah');
  tick(manager, 'sess-ohio');
  play(manager, 40);
  const [first, second] = manager.roster()[0].jobs.map((j) => j.id);

  // Pinned for the same reason as above, though this one runs frames and would survive
  // either draw — saying which channel it means is the point.
  manager.handleEvent({ type: 'mail', job: 'Check the nightly backups', forId: first, arrival: 'letter' });
  manager.handleEvent({ type: 'mail', job: 'Rotate the access keys', forId: second, arrival: 'letter' });
  play(manager, 90);

  const titles = new Map(manager.roster()[0].jobs.map((j) => [j.id, j.title]));
  assert.equal(titles.get(first), 'Check the nightly backups');
  assert.equal(titles.get(second), 'Rotate the access keys',
    'the second job never learned what it was');
});
