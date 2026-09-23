// Owning an office: closing it, and the optional passcode on it.
//
// Tested at the HTTP surface, because that is where the guarantees are. Every assertion
// here would have *failed* against the office as it stood before any of this existed:
// there was no delete route at all (`DELETE /office/<kc>/api` answered
// `405 {"error":"GET only"}`), no passcode, and no attempt limiter. So this file is
// evidence rather than decoration — it was run against both.
//
// The four things it has to pin down, in the order they matter:
//
//   1. **The front door is unbroken.** `/`, the demo office and reception's mint all
//      still need no credential of any kind, *with a locked office also in the store* —
//      the single failure mode of putting a gate too early in the router.
//   2. **A leaked keycard can be taken back.** Closing needs the write token, and
//      afterwards the office's own token opens nothing.
//   3. **A passcode actually gates a read**, is refused on the demo, and lets a write
//      token straight through — an owner cannot lock themselves out.
//   4. **The limiter actually limits**, per office and not only per client, which is
//      the half that cannot be spoofed and therefore the half that matters.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8197;
const BASE = `http://127.0.0.1:${PORT}`;
/** Small enough to exhaust in a test, large enough that the honest cases pass. */
const PER_OFFICE = 4;
const PER_CLIENT = 6;

let child;
let stateDir;

before(async () => {
  // Its own state directory, because this file closes offices and sets passcodes on
  // them: a shared `~/.roving-office/offices.json` would mean a test run writing
  // credentials into whatever the developer is actually using.
  stateDir = mkdtempSync(join(tmpdir(), 'rovo-owner-'));
  child = spawn(process.execPath, ['server.cjs', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ROVING_OFFICE_STATE_DIR: stateDir,
      // A machine mints in three seconds what a person mints in a week; the mint
      // limits have their own file (test/office-limits.test.js).
      ROVING_OFFICE_MINT_PER_CLIENT: '1000',
      ROVING_OFFICE_MINT_PER_SERVER: '1000',
      // The unlock limits are the subject here, so they are set to numbers a test can
      // reach without sending twenty requests per assertion.
      ROVING_OFFICE_UNLOCK_PER_OFFICE: String(PER_OFFICE),
      ROVING_OFFICE_UNLOCK_PER_CLIENT: String(PER_CLIENT),
    },
  });
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error('server did not come up');
    await new Promise((r) => setTimeout(r, 150));
  }
});

after(async () => {
  child?.kill('SIGTERM');
  // The server flushes its store on the way out, so the directory is still being
  // written into for a moment after the signal — remove it once it has stopped.
  await new Promise((r) => { child?.once('exit', r); setTimeout(r, 2000); });
  if (stateDir) rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A fresh office and the write token that owns it. */
async function mint() {
  const res = await fetch(`${BASE}/api/offices`, { method: 'POST' });
  assert.equal(res.status, 201);
  const { keycard, writeToken } = await res.json();
  assert.ok(keycard && writeToken, 'the mint hands back the pair');
  return { card: keycard, token: writeToken };
}

const owner = (token) => ({ 'x-roving-office-token': token });

/** POST to the passcode door, with whatever credential the caller is holding. */
function passcode(card, body, headers = {}) {
  return fetch(`${BASE}/office/${card}/api/passcode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// --- part 1: the owner capability is what the mint response carries -----------

test('the mint response is the only place an office\'s first token appears', async () => {
  const { card, token } = await mint();

  // `toJSON` must never grow it: this document answers for anyone holding the keycard.
  const doc = await (await fetch(`${BASE}/office/${card}/api`)).json();
  assert.equal(doc.writeToken, undefined, 'the office document carries no write token');
  assert.equal(doc.writeTokenHash, undefined, 'nor the hash of one');
  assert.equal(doc.passcode, false, 'a new office has no passcode, so it behaves as it always did');

  // And there is no route that will tell you it again — the browser keeping it
  // (src/office/owner.js) is the whole of registration precisely because of this.
  const listed = await fetch(`${BASE}/office/${card}/aop/v0/tokens`, { headers: owner(token) });
  const { tokens } = await listed.json();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].token, undefined, 'the list describes tokens and never reveals one');
});

// --- part 2: closing an office ----------------------------------------------

test('closing an office needs its write token, and a keycard is not one', async () => {
  const { card, token } = await mint();

  const naked = await fetch(`${BASE}/office/${card}/api`, { method: 'DELETE' });
  assert.equal(naked.status, 401, 'the keycard watches an office; it does not end one');

  const wrong = await fetch(`${BASE}/office/${card}/api`, {
    method: 'DELETE', headers: owner('rot_nonsense'),
  });
  assert.equal(wrong.status, 401, 'and a wrong token is no better than none');

  // Still there, and still answering, after both refusals.
  const alive = await fetch(`${BASE}/office/${card}/api?peek=1`);
  assert.equal(alive.status, 200);

  const closed = await fetch(`${BASE}/office/${card}/api`, { method: 'DELETE', headers: owner(token) });
  assert.equal(closed.status, 200);
  assert.deepEqual(await closed.json(), { closed: card });
});

test('a closed office stops answering to its old write token', async () => {
  const { card, token } = await mint();
  const body = JSON.stringify({
    aop: '0.1', id: 'e-before', type: 'session.start',
    harness: { name: 'claude-code' }, session: { id: 'S1' }, payload: {},
  });

  const before = await fetch(`${BASE}/office/${card}/aop/v0/events`, {
    method: 'POST', headers: { 'content-type': 'application/x-ndjson', ...owner(token) }, body,
  });
  assert.equal(before.status, 202, 'the token writes while the office is open');

  assert.equal(
    (await fetch(`${BASE}/office/${card}/api`, { method: 'DELETE', headers: owner(token) })).status,
    200,
  );

  // The keycard still resolves — visiting an unknown keycard creates an office, so a
  // closed one cannot 404, and that is the point: whoever kept the leaked link is told
  // nothing at all. What they get is an empty room with no history and no credentials.
  const after = await fetch(`${BASE}/office/${card}/api?peek=1`);
  assert.equal(after.status, 404, 'a peek does not resurrect it');

  const again = await fetch(`${BASE}/office/${card}/aop/v0/events`, {
    method: 'POST', headers: { 'content-type': 'application/x-ndjson', ...owner(token) }, body,
  });
  assert.equal(again.status, 401, 'the office is remade empty, and the old token opens nothing');

  const state = await (await fetch(`${BASE}/office/${card}/aop/v0/state`)).json();
  assert.equal((state.events ?? []).length, 0, 'and the event history went with it');
});

test('the demo office cannot be closed, whatever anybody is holding', async () => {
  // Refused before anything has opened the room, which is the state a fresh state
  // directory is in: the exemption is a property of the keycard, so a 404 here would
  // say the front door leads nowhere.
  assert.equal(
    (await fetch(`${BASE}/office/TEST-0000/api`, { method: 'DELETE' })).status,
    403,
    'the front door redirects here; it stays open',
  );

  // And refused with the room actually there — the GET is what makes it.
  assert.equal((await fetch(`${BASE}/office/TEST-0000/api`)).status, 200);
  const { token } = await mint();
  for (const headers of [{}, owner(token)]) {
    const res = await fetch(`${BASE}/office/TEST-0000/api`, { method: 'DELETE', headers });
    assert.equal(res.status, 403, 'another office\'s token does not help either');
  }

  assert.equal((await fetch(`${BASE}/office/TEST-0000/api?peek=1`)).status, 200, 'still there');
});

test('closing an office that is already gone says so rather than making one to delete', async () => {
  const { card, token } = await mint();
  await fetch(`${BASE}/office/${card}/api`, { method: 'DELETE', headers: owner(token) });
  const again = await fetch(`${BASE}/office/${card}/api`, { method: 'DELETE', headers: owner(token) });
  assert.equal(again.status, 404);
});

// --- part 3: the optional passcode ------------------------------------------

test('an office with a passcode refuses a read without it and admits one with it', async () => {
  const { card, token } = await mint();

  // Open to the keycard alone, exactly as every office is until somebody says otherwise.
  assert.equal((await fetch(`${BASE}/office/${card}/api`)).status, 200);

  const set = await passcode(card, { passcode: 'orchard7' }, owner(token));
  assert.equal(set.status, 200);
  assert.equal((await set.json()).passcode, true);
  // The owner's own browser is sealed by the very response that locked the room, so
  // nobody is shut out of the office they have just locked.
  assert.match(set.headers.get('set-cookie') ?? '', new RegExp(`^ro_${card}=[0-9a-f]{64};`));

  for (const path of ['/api', '/api/stream', '/aop/v0/state', '/aop/v0/stream', '/aop/v0/health']) {
    const res = await fetch(`${BASE}/office/${card}${path}`);
    assert.equal(res.status, 401, `${path} is behind the passcode`);
    assert.equal((await res.json()).passcode, true, `${path} says which credential is missing`);
  }

  // A heartbeat is a read too: a viewer who cannot see the room must not be able to
  // keep it alive either.
  const beat = await fetch(`${BASE}/office/${card}/api/heartbeat?viewer=t1`, { method: 'POST' });
  assert.equal(beat.status, 401);

  // The wrong passcode is refused, and the right one hands back the room itself.
  const wrong = await passcode(card, { passcode: 'orchard8' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null, 'a refusal seals nothing');

  const right = await passcode(card, { passcode: 'orchard7' });
  assert.equal(right.status, 200);
  const seal = /(ro_[^;]+)/.exec(right.headers.get('set-cookie') ?? '')?.[1];
  assert.ok(seal, 'a correct passcode is answered with a seal');
  const doc = await right.json();
  assert.equal(doc.keycard, card, 'and with the office, so there is no second round trip');
  assert.ok(Array.isArray(doc.scenes), 'the whole document, rooms and all');

  // The seal then opens the reads it is for, and only reads: ingest still wants a token.
  const sealed = await fetch(`${BASE}/office/${card}/api`, { headers: { cookie: seal } });
  assert.equal(sealed.status, 200);

  const write = await fetch(`${BASE}/office/${card}/aop/v0/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson', cookie: seal },
    body: JSON.stringify({
      aop: '0.1', id: 'e-seal', type: 'session.start',
      harness: { name: 'claude-code' }, session: { id: 'S1' }, payload: {},
    }),
  });
  assert.equal(write.status, 401, 'a seal may only ever admit a read');
});

test('a forged seal, and one issued for another office, are both refused', async () => {
  const a = await mint();
  const b = await mint();
  await passcode(a.card, { passcode: 'alpha-one' }, owner(a.token));
  await passcode(b.card, { passcode: 'alpha-one' }, owner(b.token));

  const forged = await fetch(`${BASE}/office/${a.card}/api`, {
    headers: { cookie: `ro_${a.card}=${'0'.repeat(64)}` },
  });
  assert.equal(forged.status, 401);

  // Same passcode, different office: the seal is an HMAC over the keycard, keyed on a
  // per-office salted digest, so neither the value nor the cookie name travels.
  const other = await passcode(b.card, { passcode: 'alpha-one' });
  const otherSeal = /(ro_[^;]+)/.exec(other.headers.get('set-cookie') ?? '')?.[1];
  const crossed = await fetch(`${BASE}/office/${a.card}/api`, {
    headers: { cookie: (otherSeal ?? '').replace(b.card, a.card) },
  });
  assert.equal(crossed.status, 401, 'one office\'s seal proves nothing about another');
});

test('changing the passcode invalidates every seal already issued', async () => {
  const { card, token } = await mint();
  await passcode(card, { passcode: 'first-one' }, owner(token));
  const got = await passcode(card, { passcode: 'first-one' });
  const seal = /(ro_[^;]+)/.exec(got.headers.get('set-cookie') ?? '')?.[1];
  assert.equal((await fetch(`${BASE}/office/${card}/api`, { headers: { cookie: seal } })).status, 200);

  await passcode(card, { passcode: 'second-one' }, owner(token));
  assert.equal(
    (await fetch(`${BASE}/office/${card}/api`, { headers: { cookie: seal } })).status,
    401,
    'rotation is a single write, because the seal is keyed on the digest it replaced',
  );
});

test('the write token is stronger than the passcode, so an owner is never locked out', async () => {
  const { card, token } = await mint();
  await passcode(card, { passcode: 'orchard7' }, owner(token));

  // No cookie anywhere — a second machine, a cleared browser, a curl.
  const doc = await fetch(`${BASE}/office/${card}/api`, { headers: owner(token) });
  assert.equal(doc.status, 200);
  assert.equal((await doc.json()).passcode, true, 'and the document says the office is locked');
  // Opening it with a token also leaves a seal, so the tab's credential-free heartbeat
  // and streams are not refused behind a passcode the owner has already satisfied.
  assert.match(doc.headers.get('set-cookie') ?? '', new RegExp(`^ro_${card}=`));

  assert.equal((await fetch(`${BASE}/office/${card}/aop/v0/state`, { headers: owner(token) })).status, 200);

  // And it is the only credential that can take the passcode off again.
  assert.equal((await passcode(card, { passcode: null })).status, 400, 'clearing is a write');
  const cleared = await passcode(card, { passcode: null }, owner(token));
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).passcode, false);
  assert.equal((await fetch(`${BASE}/office/${card}/api`)).status, 200, 'open to the keycard again');
});

test('the demo office refuses a passcode, before it looks at any credential', async () => {
  const { token } = await mint();
  for (const headers of [{}, owner(token)]) {
    const res = await passcode('TEST-0000', { passcode: 'orchard7' }, headers);
    assert.equal(res.status, 403);
  }
  assert.equal((await fetch(`${BASE}/office/TEST-0000/api`)).status, 200, 'and stays open');
});

test('a passcode has to be long enough to be one, and a short one changes nothing', async () => {
  const { card, token } = await mint();
  const res = await passcode(card, { passcode: 'ab' }, owner(token));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /at least/);
  assert.equal((await fetch(`${BASE}/office/${card}/api`)).status, 200, 'the office is untouched');
});

test('a locked office still answers a peek, with less', async () => {
  const { card, token } = await mint();
  await passcode(card, { passcode: 'orchard7' }, owner(token));

  const peeked = await fetch(`${BASE}/office/${card}/api?peek=1`);
  assert.equal(peeked.status, 200, 'reception must be able to tell a locked office from a dead one');
  const doc = await peeked.json();
  assert.deepEqual(doc, { keycard: card, reserved: false, passcode: true, locked: true });
  // Scene names are typed by people, so they stay behind the door with everything else.
  assert.equal(doc.scenes, undefined);
  assert.equal(doc.claimed, undefined);
});

test('an office with no passcode is not a door to knock on', async () => {
  const { card } = await mint();
  const res = await passcode(card, { passcode: 'anything-at-all' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).passcode, false);
});

// --- part 4: the attempt limiter --------------------------------------------

test('the per-office limiter actually limits, and only wrong attempts count', async () => {
  const { card, token } = await mint();
  await passcode(card, { passcode: 'orchard7' }, owner(token));

  // Right first time costs nothing at all, which is what "only wrong attempts count"
  // has to mean if a person who types carefully is never to be rate-limited.
  for (let i = 0; i < PER_OFFICE + 2; i++) {
    assert.equal((await passcode(card, { passcode: 'orchard7' })).status, 200, `attempt ${i}`);
  }

  // Wrong ones do. The window is ten minutes, so the allowance does not come back
  // inside this test — the refusal is the assertion.
  for (let i = 0; i < PER_OFFICE; i++) {
    assert.equal((await passcode(card, { passcode: 'wrong-one' })).status, 401, `wrong ${i}`);
  }
  const stopped = await passcode(card, { passcode: 'wrong-one' });
  assert.equal(stopped.status, 429, 'past the allowance it stops answering');
  assert.ok(Number(stopped.headers.get('retry-after')) > 0, 'and says when to come back');
  const refusal = await stopped.json();
  assert.match(refusal.error, /too many wrong passcodes/);

  // The one that matters: the *right* passcode is refused too. A limiter that let a
  // correct guess through on the attempt after the cap would be a limiter that counted
  // wrong answers and bounded nothing.
  const evenRight = await passcode(card, { passcode: 'orchard7' });
  assert.equal(evenRight.status, 429, 'the office is closed to guessing, not to wrong guesses');

  // And it is keyed on the office, which is the half a caller cannot spoof: a second
  // office is unaffected by the first one being hammered.
  const other = await mint();
  await passcode(other.card, { passcode: 'orchard7' }, owner(other.token));
  assert.equal((await passcode(other.card, { passcode: 'orchard7' })).status, 200);
});

// --- the front door, explicitly unbroken ------------------------------------

test('the front door still needs nothing, with a locked office in the store', async () => {
  const { card, token } = await mint();
  const set = await passcode(card, { passcode: 'orchard7' }, owner(token));
  assert.equal(set.status, 200, 'there is genuinely a locked office present');

  // The single failure mode of this whole change: a gate placed early enough in the
  // router to catch the demo redirect, the app shell, or reception's mint.
  const root = await fetch(`${BASE}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/office/TEST-0000/');

  const demo = await fetch(`${BASE}/office/TEST-0000/api`);
  assert.equal(demo.status, 200, 'cutting an office at reception requires nothing, and still does');
  assert.equal((await demo.json()).passcode, false);

  const minted = await fetch(`${BASE}/api/offices`, { method: 'POST' });
  assert.equal(minted.status, 201, 'and minting one requires nothing either');

  const shell = await fetch(`${BASE}/office/${card}/`);
  assert.equal(shell.status, 200, 'the app shell is ungated: it is identical for every office');

  const entry = await fetch(`${BASE}/offices`);
  assert.equal(entry.status, 200);
});
