// What bounds office creation, at both levels it is bounded.
//
// Creating an office takes no credential — reception's front door and a shared link
// both depend on that — so the endpoint cannot be gated, only bounded, and the thing
// that has to be true after every one of these tests is the same: **a first-time
// visitor cutting themselves one office still gets it.** A limit that fails closed on
// the front door would be worse than the unlimited endpoint it replaced.
//
// Three tiers, each tested where it lives: the sliding window in lib/rate-limit.cjs,
// the cap in lib/office-store.cjs, and the HTTP answers in server.cjs — the last
// against a real spawned server, with the limits turned down by environment so the
// test does not have to mint five hundred offices to reach one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as keycard from '../src/office/keycard.js';
import { mintOffice } from '../src/office/new-office.js';

const require = createRequire(import.meta.url);
const { createOfficeStore, MAX_OFFICES } = require('../lib/office-store.cjs');
const { createRateLimiter } = require('../lib/rate-limit.cjs');

// --- the window ------------------------------------------------------------

test('a rate limiter counts per key and forgets on a sliding window', () => {
  let clock = 1_000;
  const limiter = createRateLimiter({ limit: 3, windowMs: 100, now: () => clock });

  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.take('a').ok, true, `hit ${i + 1} of 3 is inside the limit`);
  }
  const refused = limiter.take('a');
  assert.equal(refused.ok, false, 'the fourth is not');
  assert.ok(refused.retryAfterMs > 0 && refused.retryAfterMs <= 100, 'and says when to come back');

  // Another key is another allowance: one caller in a loop must not refuse everyone.
  assert.equal(limiter.take('b').ok, true);

  // Sliding, not fixed: the oldest hit falls out on its own anniversary rather than
  // the whole tally resetting at a boundary both callers can see coming.
  clock += 101;
  assert.equal(limiter.take('a').ok, true, 'the window has moved past the first three');
});

test('a refund hands one hit back, and never more than was taken', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 10_000 });
  assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, false);
  limiter.refund('a');
  assert.equal(limiter.take('a').ok, true, 'the refunded hit is spendable again');
  limiter.refund('a');
  limiter.refund('a');
  limiter.refund('a');
  assert.equal(limiter.keys, 0, 'refunding an empty key is a no-op, not a negative tally');
  assert.equal(limiter.take('a').ok, true);
});

test('a limiter keyed on a spoofable address stays bounded in memory', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 8 });
  for (let i = 0; i < 500; i++) limiter.take(`client-${i}`);
  assert.ok(limiter.keys <= 8, `bounded at maxKeys, held ${limiter.keys}`);
});

// --- the cap ---------------------------------------------------------------

function cappedStore(maxOffices, { idleTtlMs } = {}) {
  const file = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_cap-')), 'offices.json');
  return createOfficeStore({ keycard, file, maxOffices, idleTtlMs });
}

test('the store default cap is a real number, not "unlimited"', () => {
  assert.ok(Number.isFinite(MAX_OFFICES) && MAX_OFFICES > 0);
  assert.equal(cappedStore(undefined).MAX_OFFICES, MAX_OFFICES);
});

test('a store past its cap refuses to open another office, and says why', () => {
  const store = cappedStore(3);
  const cards = [];
  for (let i = 0; i < 3; i++) cards.push(store.create().keycard);
  assert.equal(store.size, 3);
  assert.equal(store.full(), true);

  let err;
  try { store.open(keycard.mint()); } catch (thrown) { err = thrown; }
  assert.ok(err, 'opening one more is refused rather than quietly allowed');
  assert.match(err.message, /full/, 'and says so in a sentence');
  assert.equal(err.code, 'store-full', 'tagged, so the server can answer it as capacity');
  assert.equal(err.maxOffices, 3);

  // The offices already there are untouched — a cap refuses arrivals, it does not evict.
  for (const card of cards) assert.ok(store.has(card));
});

test('the demo office is exempt: a full store still opens the front door', () => {
  const store = cappedStore(2);
  store.create();
  store.create();
  assert.equal(store.full(), true);
  const demo = store.open(keycard.DEMO_KEYCARD);
  assert.ok(demo.reserved, 'the room `/` redirects to is not a room the cap may refuse');
});

test('the cap sweeps before it refuses, so litter is not held against a visitor', async () => {
  const store = cappedStore(2, { idleTtlMs: 5 });
  const stale = store.create().keycard;
  store.create();
  assert.equal(store.size, 2);

  // Both are past a five-millisecond deadline by the time this resolves, so the sweep
  // inside `full()` reclaims them rather than turning a store of dead rooms into a
  // closed door.
  await new Promise((r) => setTimeout(r, 20));
  const fresh = store.open(keycard.mint());
  assert.ok(fresh, 'an office past its deadline is capacity, not a tenant');
  assert.equal(store.has(stale), false);
});

test('restoring from disk cannot carry a store past a lowered cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tmp_rovo_cap-'));
  const file = join(dir, 'offices.json');
  const roomy = createOfficeStore({ keycard, file, maxOffices: 5 });
  for (let i = 0; i < 5; i++) roomy.create();
  roomy.flush();

  const tightened = createOfficeStore({ keycard, file, maxOffices: 2 });
  tightened.load();
  assert.equal(tightened.size, 2, 'the file is not an argument for exceeding the limit');
});

// --- the HTTP surface ------------------------------------------------------

/**
 * A server with the limits turned right down, on its own state directory.
 *
 * Its own `HOME` and `ROVING_OFFICE_STATE_DIR` for the reason server-startup.test.js
 * gives — there is one `endpoint.json` per machine, and a test has no business
 * touching the developer's. `--publish` is deliberately absent.
 */
function start({ port, env = {} }) {
  const home = mkdtempSync(join(tmpdir(), 'tmp_rovo_limits-'));
  mkdirSync(join(home, '.roving-office'), { recursive: true });
  const child = spawn(process.execPath, ['server.cjs', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: home,
      PORT: '',
      ROVING_OFFICE_STATE_DIR: join(home, 'state'),
      ...env,
    },
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });

  const base = `http://127.0.0.1:${port}`;
  const ready = (async () => {
    const deadline = Date.now() + 8000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) return base;
      } catch { /* not listening yet */ }
      if (Date.now() > deadline) throw new Error(`server did not come up: ${out}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  return { child, base, ready };
}

const mint = (base) => fetch(`${base}/api/offices`, { method: 'POST' });

test('one visitor cutting one office is never the request that is refused', async (t) => {
  // The tightest limit this server has a word for: one office per window, per client
  // and in total. Even here the first visitor gets theirs.
  const server = start({
    port: 8211,
    env: { ROVING_OFFICE_MINT_PER_CLIENT: '1', ROVING_OFFICE_MINT_PER_SERVER: '1' },
  });
  t.after(() => server.child.kill('SIGTERM'));
  const base = await server.ready;

  const res = await mint(base);
  assert.equal(res.status, 201, 'the product’s front door opens');
  const office = await res.json();
  assert.ok(keycard.parseKeycard(office.keycard), 'and hands back a real keycard');
  assert.ok(office.writeToken?.startsWith('rot_'), 'with its first ingest token, once');

  // The office it just made is usable, which is the half of "not blocked" that a
  // status code alone does not prove: the browser's very next request is this one,
  // and it must not be counted as a second creation.
  const entered = await fetch(`${base}/office/${office.keycard}/api`);
  assert.equal(entered.status, 200);
  assert.equal((await entered.json()).keycard, office.keycard);
});

test('a client past the per-client limit gets 429, a Retry-After and a sentence', async (t) => {
  const server = start({
    port: 8212,
    env: {
      ROVING_OFFICE_MINT_PER_CLIENT: '3',
      ROVING_OFFICE_MINT_PER_SERVER: '1000',
      ROVING_OFFICE_MINT_WINDOW_MS: '600000',
    },
  });
  t.after(() => server.child.kill('SIGTERM'));
  const base = await server.ready;

  for (let i = 0; i < 3; i++) {
    assert.equal((await mint(base)).status, 201, `office ${i + 1} of 3 is allowed`);
  }

  const refused = await mint(base);
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get('retry-after')) >= 1, 'says when in a header');
  const body = await refused.json();
  assert.equal(body.scope, 'client');
  assert.equal(body.limit, 3);
  assert.match(body.error, /too many new offices/i);
  // The header is seconds because the header is specified in seconds; the sentence
  // rounds a long wait to minutes rather than making a reader divide by sixty.
  assert.match(body.error, /Try again in \d+ minutes/, 'and when in words a person reads');
  assert.match(body.error, /keycard/, 'and what to do instead');
});

test('the whole-server limit answers separately, and does not spend the client’s tries', async (t) => {
  const server = start({
    port: 8213,
    env: { ROVING_OFFICE_MINT_PER_CLIENT: '10', ROVING_OFFICE_MINT_PER_SERVER: '2' },
  });
  t.after(() => server.child.kill('SIGTERM'));
  const base = await server.ready;

  assert.equal((await mint(base)).status, 201);
  assert.equal((await mint(base)).status, 201);

  // Two more, so the second would fail on the per-client tally as well if the
  // whole-server refusal had charged the client for it.
  for (const attempt of [1, 2]) {
    const refused = await mint(base);
    assert.equal(refused.status, 429, `attempt ${attempt}`);
    const body = await refused.json();
    assert.equal(body.scope, 'server', 'named as the server’s limit, not the caller’s');
    assert.equal(body.limit, 2);
  }
});

test('inventing keycards is not a way round the limit', async (t) => {
  const server = start({
    port: 8214,
    env: { ROVING_OFFICE_MINT_PER_CLIENT: '2', ROVING_OFFICE_MINT_PER_SERVER: '1000' },
  });
  t.after(() => server.child.kill('SIGTERM'));
  const base = await server.ready;

  // The other two doors that create an office: a first GET on a keycard nobody has
  // used, and an adapter posting into one — which opens the room *before* it checks
  // the token, so an unauthenticated POST creates and then gets its 401.
  const first = await fetch(`${base}/office/${keycard.mint()}/api`);
  assert.equal(first.status, 200, 'a shared link still works before anyone opens it');

  const second = await fetch(`${base}/office/${keycard.mint()}/aop/v0/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(second.status, 401, 'created, then refused for having no token');

  // Two creations spent the allowance of two, whichever door they came through.
  const third = await fetch(`${base}/office/${keycard.mint()}/api`);
  assert.equal(third.status, 429);
  assert.equal((await mint(base)).status, 429, 'and the front door agrees');

  // An office that already exists is not a creation, so reading one costs nothing
  // even with the allowance spent.
  const again = await fetch(`${base}/office/${keycard.DEMO_KEYCARD}/api`);
  assert.equal(again.status, 200);
});

test('the demo office is exempt from the rate limit as well as the cap', async (t) => {
  const server = start({
    port: 8215,
    env: { ROVING_OFFICE_MINT_PER_CLIENT: '1', ROVING_OFFICE_MINT_PER_SERVER: '1' },
  });
  t.after(() => server.child.kill('SIGTERM'));
  const base = await server.ready;

  // Spend the whole allowance somewhere else first, then walk in the front door: `/`
  // redirects here, so a limit that could close it would be a limit that breaks the
  // site for everyone who is not creating anything at all.
  assert.equal((await mint(base)).status, 201);
  const demo = await fetch(`${base}/office/${keycard.DEMO_KEYCARD}/api`);
  assert.equal(demo.status, 200);
  assert.ok((await demo.json()).reserved);
});

test('a full server refuses with 503 and points at the idle deadline', async (t) => {
  const server = start({
    port: 8216,
    env: {
      ROVING_OFFICE_MAX_OFFICES: '2',
      ROVING_OFFICE_MINT_PER_CLIENT: '100',
      ROVING_OFFICE_MINT_PER_SERVER: '100',
      // Long enough that nothing is reaped mid-test, so "full" means full.
      ROVING_OFFICE_IDLE_TTL_MS: '3600000',
    },
  });
  t.after(() => server.child.kill('SIGTERM'));
  const base = await server.ready;

  assert.equal((await mint(base)).status, 201);
  assert.equal((await mint(base)).status, 201);

  const refused = await mint(base);
  assert.equal(refused.status, 503, 'a rate is not the problem, so 429 would be a lie');
  assert.ok(Number(refused.headers.get('retry-after')) >= 1);
  const body = await refused.json();
  assert.equal(body.scope, 'capacity');
  assert.equal(body.maxOffices, 2);
  assert.match(body.error, /full/i);
  assert.match(body.error, /idle minutes/, 'says when a room frees up');

  const health = await fetch(`${base}/api/health`);
  const state = await health.json();
  assert.equal(state.maxOffices, 2, 'the cap is visible beside the count');
  assert.ok(state.offices >= 2);
});

test('a forwarded-for header is only believed when the deployment says so', async (t) => {
  // Untrusted: the header is ignored, so five spoofed addresses share one allowance.
  const closed = start({
    port: 8217,
    env: { ROVING_OFFICE_MINT_PER_CLIENT: '1', ROVING_OFFICE_MINT_PER_SERVER: '1000' },
  });
  t.after(() => closed.child.kill('SIGTERM'));
  const closedBase = await closed.ready;

  const spoof = (base, ip) => fetch(`${base}/api/offices`, {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });

  assert.equal((await spoof(closedBase, '10.0.0.1')).status, 201);
  assert.equal((await spoof(closedBase, '10.0.0.2')).status, 429,
    'a header a caller writes is not a rate limit a caller may reset');

  // Trusted: the same two requests are two clients, which is what makes the limit
  // usable at all behind a proxy that is the only address the server ever sees.
  const open = start({
    port: 8218,
    env: {
      ROVING_OFFICE_TRUST_PROXY: '1',
      ROVING_OFFICE_MINT_PER_CLIENT: '1',
      ROVING_OFFICE_MINT_PER_SERVER: '1000',
    },
  });
  t.after(() => open.child.kill('SIGTERM'));
  const openBase = await open.ready;

  assert.equal((await spoof(openBase, '10.0.0.1')).status, 201);
  assert.equal((await spoof(openBase, '10.0.0.2')).status, 201, 'two clients, two allowances');
  assert.equal((await spoof(openBase, '10.0.0.1')).status, 429, 'and each one still bounded');

  // Fly overwrites `Fly-Client-IP`, so it wins where both are present.
  const fly = await fetch(`${openBase}/api/offices`, {
    method: 'POST',
    headers: { 'x-forwarded-for': '10.0.0.9', 'fly-client-ip': '10.0.0.1' },
  });
  assert.equal(fly.status, 429, 'the header the platform vouches for is the one counted');
});

// --- what reception is left holding ----------------------------------------
//
// A limit nobody can read is a limit that looks like a broken site, so the last thing
// tested is the sentence. `src/wizard.js` prints `err.message` on its hint line
// verbatim, which makes the message the user interface here.

test('reception is given the server’s reason, not its status code', async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });

  globalThis.fetch = async () => new Response(
    JSON.stringify({
      error: 'too many new offices from here: 20 every 10 minutes. Try again in 214 seconds, or open an office you already have a keycard for.',
      scope: 'client',
    }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  );

  await assert.rejects(mintOffice(), /Try again in 214 seconds/, 'the words the server chose');
  await assert.rejects(mintOffice(), (err) => !/429/.test(err.message), 'and not the number');
});

test('a refusal from something that is not this server still says something', async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });

  // A gateway, a proxy, a captive portal: an HTML body and no `error` field. The status
  // is the fallback precisely because there is nothing better to say.
  globalThis.fetch = async () => new Response('<html>502 Bad Gateway</html>', { status: 502 });
  await assert.rejects(mintOffice(), /server said 502/);
});
