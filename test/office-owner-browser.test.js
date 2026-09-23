// What the browser keeps about the offices it owns, and how it checks the ones it
// remembers.
//
// The server half of owning an office is tested over HTTP in test/office-owner.test.js.
// This is the other half, and it is where the original defect actually lived: the server
// had been returning a write token with every minted office all along, and the browser
// read the keycard out of that response and dropped the rest. So the assertions here are
// about two small modules that stand between an office and being unownable:
//
//   * `src/office/owner.js` — the write token, kept per keycard. Holding it *is* being an
//     office's owner; there is no account anywhere to attach it to.
//   * `src/office/recent.js` — the offices this browser has been in, and whether each is
//     still there. That list is the only record anywhere that your offices exist, so the
//     rule about when a row may be dropped is load-bearing rather than cosmetic.
//
// Both are reached from two surfaces now — reception and the keycard dialog inside an
// office — which is exactly why the shared behaviour is tested once here instead of twice
// through two callers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * A browser's `localStorage`, as far as `src/local-store.js` is concerned.
 *
 * Installed as `globalThis.window.localStorage` rather than passed in, because that is
 * how the modules under test find it: `owner.js` and `recent.js` call `local-store.js`
 * with no `storage` argument, and its `shelfFor` reaches for `window.localStorage`. A
 * shim handed in through a parameter would be testing a path the app never takes.
 */
function shelf({ refuse = false } = {}) {
  const held = new Map();
  return {
    held,
    localStorage: {
      getItem: (k) => (held.has(k) ? held.get(k) : null),
      setItem: (k, v) => {
        // Private browsing and a full quota both present as a throw from `setItem`, and
        // that is the whole of what "storage is allowed to refuse" means here.
        if (refuse) throw new Error('quota');
        held.set(k, String(v));
      },
    },
  };
}

/** Install a fresh page for one test, and put back whatever was there. */
function page(t, opts) {
  const was = globalThis.window;
  const store = shelf(opts);
  globalThis.window = { localStorage: store.localStorage };
  t.after(() => { globalThis.window = was; });
  return store;
}

/** Stub `fetch` for one test, recording what it was asked for. */
function serving(t, handler) {
  const was = globalThis.fetch;
  const asked = [];
  t.after(() => { globalThis.fetch = was; });
  globalThis.fetch = async (url, init) => {
    asked.push(String(url));
    return handler(String(url), init);
  };
  return asked;
}

const json = (body, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } },
);

// --- the write token the mint used to throw away ---------------------------

test('minting an office keeps its write token, so the office has an owner', async (t) => {
  page(t);
  serving(t, () => json({ keycard: 'K7F2-9QBX', writeToken: 'rot_abc123', writeTokenId: 'id1' }, 201));

  const { mintOffice } = await import('../src/office/new-office.js');
  const owner = await import('../src/office/owner.js');

  const card = await mintOffice();
  assert.equal(card, 'K7F2-9QBX');

  // The whole of the fix, and the whole of "registration". Before this, `mintOffice`
  // parsed the keycard and discarded the token, so an office cut at reception could
  // never be closed, re-passcoded or given a second machine by anybody.
  assert.equal(owner.tokenFor('K7F2-9QBX'), 'rot_abc123');
  assert.equal(owner.owns('K7F2-9QBX'), true);
  assert.deepEqual(owner.authHeader('K7F2-9QBX'), { 'X-Roving-Office-Token': 'rot_abc123' });

  // And nothing is claimed about an office this browser has never minted.
  assert.equal(owner.tokenFor('AAAA-AAAA'), null);
  assert.equal(owner.owns('AAAA-AAAA'), false);
  assert.deepEqual(owner.authHeader('AAAA-AAAA'), {}, 'no token means no header, not an empty one');
});

test('a second office does not displace the first — this is a key ring, not a slot', async (t) => {
  page(t);
  let n = 0;
  serving(t, () => {
    n += 1;
    return json({ keycard: `AAAA-000${n}`, writeToken: `rot_${n}` }, 201);
  });

  const { mintOffice } = await import('../src/office/new-office.js');
  const { tokenFor } = await import('../src/office/owner.js');

  await mintOffice();
  await mintOffice();
  await mintOffice();

  // The keycard dialog can cut an office from inside another one, so a session plausibly
  // mints several. Each has its own credential and losing an earlier one would leave an
  // office nobody can close — the defect this whole change exists to remove.
  assert.equal(tokenFor('AAAA-0001'), 'rot_1');
  assert.equal(tokenFor('AAAA-0002'), 'rot_2');
  assert.equal(tokenFor('AAAA-0003'), 'rot_3');
});

test('forgetting one office leaves the others alone', async (t) => {
  page(t);
  const { remember, forget, tokenFor } = await import('../src/office/owner.js');

  remember('AAAA-0001', 'rot_1');
  remember('AAAA-0002', 'rot_2');
  assert.equal(forget('AAAA-0001'), true);
  assert.equal(tokenFor('AAAA-0001'), null, 'closed, so there is nothing left to own');
  assert.equal(tokenFor('AAAA-0002'), 'rot_2');
  assert.equal(forget('AAAA-0001'), false, 'forgetting what is already gone changes nothing');
});

test('a storage refusal costs you the ownership, never the office', async (t) => {
  page(t, { refuse: true });
  serving(t, () => json({ keycard: 'K7F2-9QBX', writeToken: 'rot_abc123' }, 201));

  const { mintOffice } = await import('../src/office/new-office.js');
  const { owns } = await import('../src/office/owner.js');

  // Private browsing, a locked-down embed, a full quota. The office still opens and the
  // keycard is still returned — refusing to cut a keycard because we could not write a
  // note about it would be much the worse failure.
  const card = await mintOffice();
  assert.equal(card, 'K7F2-9QBX');
  assert.equal(owns('K7F2-9QBX'), false, 'unowned, which is survivable and was the old normal');
});

test('a garbled owner store is discarded rather than trusted', async (t) => {
  const store = page(t);
  store.held.set('roving-office.owner.v1', '{"AAAA-0001": 12, "AAAA-0002": "rot_2", "bad"');
  const { tokenFor } = await import('../src/office/owner.js');
  // Unparseable: `readJson` hands back the fallback, so nothing is owned and nothing
  // throws on the way to finding that out.
  assert.equal(tokenFor('AAAA-0002'), null);

  store.held.set('roving-office.owner.v1', JSON.stringify({ 'AAAA-0001': 12, 'AAAA-0002': 'rot_2' }));
  // Parseable but half nonsense: a token has to be a non-empty string to count, so the
  // number is dropped and the string beside it survives.
  assert.equal(tokenFor('AAAA-0001'), null);
  assert.equal(tokenFor('AAAA-0002'), 'rot_2');
});

// --- checking a remembered office ------------------------------------------
//
// Three outcomes, and the reason they are three rather than two is the passcode: a locked
// office refuses an ordinary read, and a list that read that refusal as a death would
// strike a live office out of the only record that it exists.

test('an office that is gone is reported and forgotten in one act', async (t) => {
  page(t);
  const { rememberRecent, listRecent, checkRecent } = await import('../src/office/recent.js');
  rememberRecent('AAAA-0001');
  rememberRecent('BBBB-0002');

  const asked = serving(t, (url) => (url.includes('AAAA-0001')
    ? json({ error: 'no office at that keycard' }, 404)
    : json({ keycard: 'BBBB-0002', passcode: false })));

  assert.deepEqual(await checkRecent('AAAA-0001'), { gone: true, locked: false, reachable: true });
  // Forgotten here, so the caller's only remaining job is to say so before the row goes.
  // Two surfaces draw this list and neither may be the one place the rule lives.
  assert.deepEqual(listRecent().map((v) => v.keycard), ['BBBB-0002']);

  assert.deepEqual(await checkRecent('BBBB-0002'), { gone: false, locked: false, reachable: true });
  assert.deepEqual(listRecent().map((v) => v.keycard), ['BBBB-0002'], 'a live office is kept');

  // `?peek`, every time. An ordinary GET on a keycard *creates* the office there, so
  // checking a row with one would be the visit that resurrects it and every dead office
  // would look alive for ever.
  assert.ok(asked.every((url) => url.includes('peek')), `peek only, got ${asked.join(' ')}`);
});

test('a locked office is alive, and said to be locked', async (t) => {
  page(t);
  const { rememberRecent, listRecent, checkRecent } = await import('../src/office/recent.js');
  rememberRecent('CCCC-0003');

  // The degraded peek: exactly the facts a stranger could establish by trying the door.
  serving(t, () => json({ keycard: 'CCCC-0003', reserved: false, passcode: true, locked: true }));

  assert.deepEqual(await checkRecent('CCCC-0003'), { gone: false, locked: true, reachable: true });
  assert.deepEqual(listRecent().map((v) => v.keycard), ['CCCC-0003'], 'kept — it is still there');
});

test('a server that cannot be reached is never what loses you an office', async (t) => {
  page(t);
  const { rememberRecent, listRecent, checkRecent } = await import('../src/office/recent.js');
  rememberRecent('DDDD-0004');

  for (const answer of [
    () => { throw new TypeError('Failed to fetch'); },     // offline, or CORS
    () => json({ error: 'bad gateway' }, 502),             // a proxy in the way
    () => new Response('<html>gateway</html>', { status: 503 }),
  ]) {
    const was = globalThis.fetch;
    globalThis.fetch = async () => answer();
    const result = await checkRecent('DDDD-0004');
    globalThis.fetch = was;

    assert.deepEqual(result, { gone: false, locked: false, reachable: false });
    // The row is left alone rather than accused. A keycard is the only way back into an
    // office, so a flaky network must not be a way to throw one away.
    assert.deepEqual(listRecent().map((v) => v.keycard), ['DDDD-0004']);
  }
});

test('a reload is the same visit, and the list stays newest first and capped', async (t) => {
  page(t);
  const { rememberRecent, listRecent } = await import('../src/office/recent.js');

  for (let i = 1; i <= 14; i += 1) rememberRecent(`AAAA-00${String(i).padStart(2, '0')}`);
  const cards = listRecent().map((v) => v.keycard);
  assert.equal(cards.length, 12, 'a dozen, past which this is a list to search rather than read');
  assert.equal(cards[0], 'AAAA-0014', 'most recent first');

  // Revisiting moves a row rather than adding one, which is why the dialog can show this
  // list without it filling up with the office you are standing in.
  rememberRecent('AAAA-0005');
  const after = listRecent().map((v) => v.keycard);
  assert.equal(after[0], 'AAAA-0005');
  assert.equal(new Set(after).size, after.length, 'no duplicate rows');
});

// --- how a visit is dated --------------------------------------------------

test('a visit is dated in words, coarsely and in one place', async (t) => {
  page(t);
  const { agoWords } = await import('../src/ui/format.js');
  const now = Date.now();

  assert.equal(agoWords(now), 'just now');
  assert.equal(agoWords(now - 20_000), 'just now', 'under a minute is not "0 minutes ago"');
  assert.equal(agoWords(now - 60_000), '1 minute ago', 'singular');
  assert.equal(agoWords(now - 3 * 60_000), '3 minutes ago');
  assert.equal(agoWords(now - 60 * 60_000), '1 hour ago');
  assert.equal(agoWords(now - 5 * 60 * 60_000), '5 hours ago');
  assert.equal(agoWords(now - 24 * 60 * 60_000), '1 day ago');
  assert.equal(agoWords(now - 3 * 24 * 60 * 60_000), '3 days ago');
});
