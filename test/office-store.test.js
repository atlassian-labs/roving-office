// The office lifecycle: visiting an unknown keycard makes an office, watching
// one keeps it alive, and silence reaps it. ESM because the keycard module the
// store leans on is ESM; the store itself arrives via createRequire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as keycard from '../src/office/keycard.js';

const require = createRequire(import.meta.url);
const { createOfficeStore, AUTHORED_SCENE_IDS, MAX_TOKENS } = require('../lib/office-store.cjs');

function freshStore() {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_store-')), 'offices.json');
  return createOfficeStore({ keycard, file });
}

test('visiting an unknown keycard is how an office is made', () => {
  const store = freshStore();
  const card = keycard.mint();
  assert.equal(store.has(card), false);
  const office = store.open(card);
  assert.ok(office);
  assert.ok(store.has(card));
  assert.ok(office.scenes.length >= 1, 'a fresh office has a room to stand in');
});

test('opening the demo keycard seeds the authored scenes, reserved', () => {
  const store = freshStore();
  const demo = store.open(keycard.DEMO_KEYCARD);
  assert.ok(demo.reserved, 'the one office that is never reaped says so');
  assert.ok(demo.scenes.length >= AUTHORED_SCENE_IDS.length - 1);
});

test('visitors cannot change the shared demo starting scenes', () => {
  const store = freshStore();
  const demo = store.open(keycard.DEMO_KEYCARD);
  const before = structuredClone(demo.scenes);
  const id = demo.scenes[0].id;
  assert.equal(store.addScene(demo.keycard, { name: 'Another room' }), null);
  assert.equal(store.updateScene(demo.keycard, id, {
    name: 'Changed', sources: ['claude-code'], layout: { items: [] }, look: { season: 'winter' },
  }), null);
  assert.equal(store.removeScene(demo.keycard, id).ok, false);
  assert.deepEqual(demo.scenes, before);
});

test('mint hands out a keycard no office holds', () => {
  const store = freshStore();
  const card = store.mint();
  assert.ok(keycard.isKeycard(card));
});

test('write tokens verify for their own office and no other', () => {
  const store = freshStore();
  const a = store.open(store.mint());
  const b = store.open(store.mint());
  const { token } = store.mintWriteToken(a);
  assert.equal(store.verifyWriteToken(a, token), true);
  assert.equal(store.verifyWriteToken(b, token), false);
});

// --- more than one token per office -------------------------------
//
// One hash meant one shared secret and one kind of revocation: re-minting, which
// revoked everybody. A second laptop could only join by being handed the first one's
// credential, and taking one machine away meant reinstalling on all of them.

test('an office holds several tokens, each valid on its own', () => {
  const store = freshStore();
  const office = store.open(store.mint());
  const laptop = store.mintWriteToken(office, { label: "mike's laptop" });
  const gateway = store.mintWriteToken(office, { label: 'gateway-syd' });

  assert.notEqual(laptop.token, gateway.token);
  assert.notEqual(laptop.id, gateway.id);
  assert.equal(store.verifyWriteToken(office, laptop.token), true);
  assert.equal(store.verifyWriteToken(office, gateway.token), true);
});

test('revoking one token leaves the others working', () => {
  const store = freshStore();
  const office = store.open(store.mint());
  const laptop = store.mintWriteToken(office, { label: "mike's laptop" });
  const gateway = store.mintWriteToken(office, { label: 'gateway-syd' });

  assert.deepEqual(store.revokeWriteToken(office, laptop.id), { ok: true });
  assert.equal(store.verifyWriteToken(office, laptop.token), false, 'the machine we took away');
  assert.equal(store.verifyWriteToken(office, gateway.token), true, 'and only that one');
});

test('the last token cannot be revoked — minting needs one', () => {
  const store = freshStore();
  const office = store.open(store.mint());
  const only = store.mintWriteToken(office);

  const refused = store.revokeWriteToken(office, only.id);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /at least one/);
  assert.equal(store.verifyWriteToken(office, only.token), true, 'still open for writing');

  // And an id nobody holds is a different answer, so the caller can tell the two apart.
  assert.equal(store.revokeWriteToken(office, 'nope').reason, 'no such token');
});

test('a token list is metadata — it never carries a token back', () => {
  const store = freshStore();
  const office = store.open(store.mint());
  const minted = store.mintWriteToken(office, { label: 'gateway-syd' });

  const [listed] = store.listWriteTokens(office);
  assert.equal(listed.id, minted.id);
  assert.equal(listed.label, 'gateway-syd');
  assert.equal(listed.hash, undefined, 'not even the hash');
  assert.equal(JSON.stringify(store.listWriteTokens(office)).includes(minted.token), false);
});

test('an office refuses to hold more tokens than it can keep track of', () => {
  const store = freshStore();
  const office = store.open(store.mint());
  for (let i = 0; i < MAX_TOKENS; i += 1) store.mintWriteToken(office, { label: `machine ${i}` });
  assert.throws(() => store.mintWriteToken(office), /at most/);

  // Revoking makes room again: the cap is a ceiling, not a lifetime quota.
  const [first] = store.listWriteTokens(office);
  assert.equal(store.revokeWriteToken(office, first.id).ok, true);
  assert.ok(store.mintWriteToken(office, { label: 'the replacement' }).token);
});

test('tokens survive a restart, and so does what they are called', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_store-')), 'offices.json');
  const store = createOfficeStore({ keycard, file });
  const card = store.mint();
  const office = store.open(card);
  const laptop = store.mintWriteToken(office, { label: "mike's laptop" });
  const gateway = store.mintWriteToken(office, { label: 'gateway-syd' });
  store.flush();

  const again = createOfficeStore({ keycard, file });
  again.load();
  const back = again.get(card);
  assert.equal(again.verifyWriteToken(back, laptop.token), true);
  assert.equal(again.verifyWriteToken(back, gateway.token), true);
  assert.deepEqual(again.listWriteTokens(back).map((t) => t.label), ["mike's laptop", 'gateway-syd']);
});

test('an office written before this change keeps the token it was minted with', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmp_rovo_store-'));
  const file = join(dir, 'offices.json');

  // A store file as the previous version wrote it: one hash, no list. The plaintext
  // behind it is installed on somebody's machine right now, so a migration that
  // silently stops it working breaks their hooks with nothing to explain why.
  const secret = 'a-token-somebody-is-still-using';
  const hash = createHash('sha256').update(secret).digest('hex');
  const card = keycard.mint();
  writeFileSync(file, JSON.stringify({
    version: 1,
    claimed: null,
    offices: [{
      keycard: card,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      writeTokenHash: hash,
      scenes: [{ id: 'scene-old', name: 'Before', sources: ['test-data'] }],
    }],
  }));

  const store = createOfficeStore({ keycard, file });
  store.load();
  const office = store.get(card);
  assert.equal(store.verifyWriteToken(office, secret), true, 'the installed token still opens it');
  assert.equal(store.listWriteTokens(office).length, 1);

  // And it is a normal member of the list now: another can join beside it.
  const second = store.mintWriteToken(office, { label: 'the new laptop' });
  assert.equal(store.verifyWriteToken(office, second.token), true);
  assert.equal(store.verifyWriteToken(office, secret), true);
});

test('a rolled-back deploy still finds one token where it expects one', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_store-')), 'offices.json');
  const store = createOfficeStore({ keycard, file });
  const office = store.open(store.mint());
  const first = store.mintWriteToken(office, { label: 'first' });
  store.mintWriteToken(office, { label: 'second' });
  store.flush();

  // The file outlives the code that wrote it, so the shape older code
  // reads is not a hypothetical. It should lose the extra tokens, not all of them.
  const written = JSON.parse(readFileSync(file, 'utf8'));
  const [record] = written.offices;
  assert.equal(record.tokens.length, 2);
  assert.equal(record.writeTokenHash, record.tokens[0].hash);
  assert.equal(
    createHash('sha256').update(first.token).digest('hex'),
    record.writeTokenHash,
    'and it is the first one, still installed somewhere',
  );
});

test('an idle office is swept; a watched one never is', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);

  // Silence for longer than the TTL: the idle clock is measured from
  // `lastSeenAt`, which the test rewinds rather than waiting half an hour.
  office.lastSeenAt = Date.now() - store.IDLE_TTL_MS - 1000;
  store.sweep();
  assert.equal(store.has(card), false, 'nobody watching, nothing arriving: reaped');

  // The demo office had the same silence and is never reaped.
  const demo = store.open(keycard.DEMO_KEYCARD);
  demo.lastSeenAt = Date.now() - store.IDLE_TTL_MS * 10;
  store.sweep();
  assert.ok(store.has(keycard.DEMO_KEYCARD));
});

test('scenes can be added and removed, but an office keeps its last room', () => {
  const store = freshStore();
  const office = store.open(store.mint());
  const before = office.scenes.length;
  const scene = store.addScene(office.keycard, { name: 'Extra' });
  assert.ok(scene);
  assert.equal(office.scenes.length, before + 1);

  // Down to one, then the refusal.
  while (office.scenes.length > 1) {
    const r = store.removeScene(office.keycard, office.scenes[0].id);
    assert.ok(r.ok, r.reason);
  }
  const refused = store.removeScene(office.keycard, office.scenes[0].id);
  assert.equal(refused.ok, false, 'the last scene cannot go');
});

test('the store round-trips through its file', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_store-')), 'offices.json');
  const store = createOfficeStore({ keycard, file });
  const card = store.mint();
  store.open(card);
  store.flush();

  const again = createOfficeStore({ keycard, file });
  again.load();
  assert.ok(again.has(card), 'an office survives a restart');
});

// --- the deadline is per-store ------------------------------------
//
// Half an hour is a laptop's number. A hosted office sleeps between visitors and its
// keycard has been given to someone, so the deadline is an option — and the half of
// it that actually bites is on the way back *in*: `load()` refuses an office that was
// already past its deadline while the process was away, which is how a machine that
// stops overnight empties a durable disk on the next visit.

test('a store keeps the deadline it was given, not the module default', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_store-')), 'offices.json');
  const week = 7 * 24 * 60 * 60_000;
  const store = createOfficeStore({ keycard, file, idleTtlMs: week });
  assert.equal(store.IDLE_TTL_MS, week);

  // Silent for a day: past the default half hour, nowhere near a week.
  const office = store.open(store.mint());
  office.lastSeenAt = Date.now() - 24 * 60 * 60_000;
  store.sweep();
  assert.ok(store.has(office.keycard), 'the sweeper reads this store\'s deadline');
});

test('a long deadline restores an office a short one would have dropped', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_store-')), 'offices.json');
  const store = createOfficeStore({ keycard, file });
  const card = store.mint();
  const office = store.open(card);
  // A night with nobody looking, written down as such.
  office.lastSeenAt = Date.now() - 12 * 60 * 60_000;
  store.flush();

  const strict = createOfficeStore({ keycard, file });
  strict.load();
  assert.equal(strict.has(card), false, 'the default deadline had already passed');

  const patient = createOfficeStore({ keycard, file, idleTtlMs: 30 * 24 * 60 * 60_000 });
  patient.load();
  assert.ok(patient.has(card), 'a hosted deadline brings the same file back');
});

// --- layouts ------------------------------------------------------
//
// A layout is the furniture editor's blob. The store keeps it whole and reads none
// of it, so what is worth testing here is that it survives — a PATCH, a restart, and
// the trip through `makeScene` that a reload puts every stored scene through.

test('a scene keeps the layout it is given, and hands it back', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  const layout = { layout: 3, complete: true, desks: { 'desk-1': { x: 4.5, z: 7.25, facing: 0 } } };
  const updated = store.updateScene(card, sceneId, { layout });
  assert.deepEqual(updated.layout, layout, 'stored whole, not interpreted');
  assert.notEqual(updated.layout, layout, 'and copied, so the caller cannot edit it after the fact');
});

test('a layout survives a restart, through makeScene on the way back in', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_store-')), 'offices.json');
  const store = createOfficeStore({ keycard, file });
  const card = store.mint();
  const office = store.open(card);
  const layout = { layout: 3, complete: true, plants: { 'plant-2': { kind: 'fern', x: 1, z: 2 } } };
  store.updateScene(card, office.scenes[0].id, { layout });
  store.flush();

  const again = createOfficeStore({ keycard, file });
  again.load();
  assert.deepEqual(again.get(card).scenes[0].layout, layout);
});

test('null clears a layout — that is how a room goes back to the authored one', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  store.updateScene(card, sceneId, { layout: { layout: 3, complete: true } });
  assert.ok(store.get(card).scenes[0].layout);
  const cleared = store.updateScene(card, sceneId, { layout: null });
  assert.equal(cleared.layout, null);
});

test('a patch that mentions no layout leaves the stored one alone', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  const layout = { layout: 3, complete: true, desks: { 'desk-1': { x: 1, z: 1, facing: 0 } } };
  store.updateScene(card, sceneId, { layout });
  const renamed = store.updateScene(card, sceneId, { name: 'Somewhere else' });
  assert.deepEqual(renamed.layout, layout, 'renaming a scene does not rearrange it');
});

// The switcher's rename field is empty-able on purpose: a scene with no
// name of its own is named after whatever fills it, and clearing the field is the
// only way back to that once someone has typed a name over it.
test('a scene can be named, renamed, and handed back to the name its feeds imply', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  assert.equal(office.scenes[0].name, null, 'a new scene starts with no name of its own');
  assert.equal(store.updateScene(card, sceneId, { name: '  The war room  ' }).name, 'The war room');
  assert.equal(store.updateScene(card, sceneId, { name: null }).name, null, 'cleared, not refused');
  assert.equal(store.updateScene(card, sceneId, { name: '   ' }).name, null, 'and whitespace is empty');
  assert.equal(store.updateScene(card, sceneId, { name: 'x'.repeat(200) }).name.length, 60);
  assert.equal(store.updateScene(card, 'no-such-scene', { name: 'Nowhere' }), null);
});

test('an oversized or nonsense layout is refused rather than stored', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  // Comfortably past the 64 KiB cap: the authored room is about two.
  const huge = { layout: 3, complete: true, junk: 'x'.repeat(70 * 1024) };
  assert.equal(store.updateScene(card, sceneId, { layout: huge }).layout, null);
  assert.equal(store.updateScene(card, sceneId, { layout: [1, 2, 3] }).layout, null, 'an array is not a layout');
  assert.equal(store.updateScene(card, sceneId, { layout: 'desk-1' }).layout, null, 'nor is a string');
});

// --- the scene stream ------------------------------------------------------
//
// A stand-in for the http response an SSE subscriber is: everything written to it,
// and whether it was hung up on.

function fakeRes() {
  const written = [];
  return {
    written,
    ended: false,
    write(text) { written.push(text); return true; },
    end() { this.ended = true; },
    /** The `data:` payloads, parsed — what a browser's `onmessage` would see. */
    events() {
      return written
        .filter((t) => t.startsWith('event: scene'))
        .map((t) => JSON.parse(t.slice(t.indexOf('data: ') + 6).trim()));
    },
  };
}

test('a scene change reaches everyone watching', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  const a = fakeRes();
  const b = fakeRes();
  const stopA = store.subscribeScenes(card, a, { viewer: 'tab-a' });
  const stopB = store.subscribeScenes(card, b, { viewer: 'tab-b' });
  assert.ok(stopA && stopB);

  store.updateScene(card, sceneId, { layout: { layout: 3, complete: true } }, { from: 'tab-a' });

  assert.equal(a.events().length, 0, 'the tab that made the change is not told about it');
  assert.equal(b.events().length, 1, 'every other tab is');
  assert.deepEqual(b.events()[0].layout, { layout: 3, complete: true });

  stopA();
  stopB();
});

test('an edit with no viewer named reaches everyone, including its author', () => {
  // curl, a script, a tab too old to send one: nobody to exclude, so nobody is.
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const res = fakeRes();
  const stop = store.subscribeScenes(card, res, { viewer: 'tab-a' });

  store.updateScene(card, office.scenes[0].id, { name: 'Rearranged' });
  assert.equal(res.events().length, 1);
  stop();
});

test('unsubscribing stops delivery', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const res = fakeRes();
  const stop = store.subscribeScenes(card, res, { viewer: 'tab-a' });
  stop();

  store.updateScene(card, office.scenes[0].id, { name: 'Later' }, { from: 'tab-b' });
  assert.equal(res.events().length, 0);
});

test('a reaped office hangs up on the tabs watching it', () => {
  const store = freshStore();
  const card = store.mint();
  store.open(card);
  const res = fakeRes();
  store.subscribeScenes(card, res, { viewer: 'tab-a' });

  store.remove(card);
  assert.equal(res.ended, true, 'a stream to an office that no longer exists is closed, not left open');
});

test('watching an office that is not there is refused rather than half-attached', () => {
  const store = freshStore();
  assert.equal(store.subscribeScenes(keycard.mint(), fakeRes(), { viewer: 'tab-a' }), null);
});

test('a write to a dead socket does not take the other tabs down with it', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const dead = fakeRes();
  dead.write = () => { throw new Error('EPIPE'); };
  const alive = fakeRes();
  store.subscribeScenes(card, dead, { viewer: 'gone' });
  store.subscribeScenes(card, alive, { viewer: 'here' });

  store.updateScene(card, office.scenes[0].id, { name: 'Still fine' }, { from: 'tab-a' });
  assert.equal(alive.events().length, 1);
});

// --- the sun in a look --------------------------------------------
//
// A look was two opaque strings the browser owned the meaning of. It now carries a
// third thing the store does have an opinion about, because it is a number and an
// angle: which way the room faces.

test('a look keeps a bearing beside its season and building', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  const updated = store.updateScene(card, sceneId, {
    look: { season: 'autumn', building: 'warehouse', bearing: 210 },
  });
  assert.deepEqual(updated.look,
    { season: 'autumn', building: 'warehouse', bearing: 210, lat: null, lon: null });
});

test('a bearing wraps rather than clamping — it is an angle, not a dial with stops', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;
  const bearing = (deg) => store.updateScene(card, sceneId, { look: { bearing: deg } }).look.bearing;

  assert.equal(bearing(370), 10);
  assert.equal(bearing(-90), 270);
  assert.equal(bearing(720), 0);
  assert.equal(bearing(44.6), 45, 'and lands on a whole degree');
});

test('a look with nothing in it is still nothing', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  assert.equal(store.updateScene(card, sceneId, { look: {} }).look, null);
  assert.equal(store.updateScene(card, sceneId, { look: { bearing: 'north' } }).look, null,
    'a bearing that is not a number is not a bearing');
});

test('a bearing survives a restart', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_store-')), 'offices.json');
  const store = createOfficeStore({ keycard, file });
  const card = store.mint();
  const office = store.open(card);
  store.updateScene(card, office.scenes[0].id, { look: { season: 'winter', bearing: 135 } });
  store.flush();

  const again = createOfficeStore({ keycard, file });
  again.load();
  assert.equal(again.get(card).scenes[0].look.bearing, 135);
});

test('a look can carry a place on earth, to four decimal places', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  const updated = store.updateScene(card, sceneId, { look: { lat: 51.5072, lon: -0.1276 } });
  assert.equal(updated.look.lat, 51.5072);
  assert.equal(updated.look.lon, -0.1276);
  // Eleven metres is already far finer than the sun can tell apart; the rest is a
  // dragged pin writing noise into the store.
  const fine = store.updateScene(card, sceneId, { look: { lat: 51.50723456, lon: -0.12764321 } });
  assert.equal(fine.look.lat, 51.5072);
});

test('a latitude clamps at the poles and a longitude wraps round the date line', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;
  const place = (lat, lon) => store.updateScene(card, sceneId, { look: { lat, lon } }).look;

  assert.equal(place(91, 0).lat, 90, '91°N is a mistake, and the pole is the nearest truth');
  assert.equal(place(-140, 0).lat, -90);
  assert.equal(place(0, 200).lon, -160, 'past the date line and out the other side');
  assert.equal(place(0, -190).lon, 170);
});

test('half a location is not a place', () => {
  const store = freshStore();
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;

  // Kept as a pair or dropped as a pair: a lone latitude would have the sun quietly
  // reading the missing half as the prime meridian.
  assert.equal(store.updateScene(card, sceneId, { look: { lat: 51.5 } }).look, null);
  assert.equal(store.updateScene(card, sceneId, { look: { lon: -0.1 } }).look, null);
  assert.equal(store.updateScene(card, sceneId, { look: { lat: 51.5, lon: 'west' } }).look, null);
});

test('a place survives a restart, and clears back to nowhere', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_store-')), 'offices.json');
  const store = createOfficeStore({ keycard, file });
  const card = store.mint();
  const office = store.open(card);
  const sceneId = office.scenes[0].id;
  store.updateScene(card, sceneId, { look: { season: 'summer', lat: -33.8688, lon: 151.2093 } });
  store.flush();

  const again = createOfficeStore({ keycard, file });
  again.load();
  assert.equal(again.get(card).scenes[0].look.lat, -33.8688);

  // Back to a room that is nowhere in particular, which is a real state and not an
  // absence of one: it is how a scene goes back to the authored arc.
  const cleared = again.updateScene(card, sceneId, { look: { season: 'summer' } });
  assert.equal(cleared.look.lat, null);
});
