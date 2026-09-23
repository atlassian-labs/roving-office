// The admin console's gate, tested at the HTTP surface.
//
// This file is about **one credential and what it is allowed to reach**, so every test
// here is a refusal except the two that prove the thing works at all. The console shows
// aggregate statistics about a whole server, which makes it the most interesting target
// in the project: the office passcode guards one room and is chosen by whoever opened
// it, whereas this one password is global and is set by the operator.
//
// Each test fails without the code it covers. The ones worth saying that about out loud:
// take the `ADMIN_FILES` guard out of `serveStatic` and the `%2f` test fails; make the
// 404 into a 401 and the "absent" tests fail; compare with `===` and the timing test
// still passes, which is why that one is not the point — the limiter tests are.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PASSWORD = 'a-password-only-the-captain-knows';

/**
 * The console's path in these tests — an operator's choice, not a default.
 *
 * Written out here rather than reusing `/admin` so that every assertion below is against
 * a *configured* path, which is the only kind there is: nothing in the source names a
 * path, because the source is published and a path in it would be published with it.
 */
const AT = '/back-of-house-7f3a';

/** Both variables, which is what it takes for the console to exist at all. */
const CONFIGURED = { ROVING_OFFICE_ADMIN_PASSWORD: PASSWORD, ROVING_OFFICE_ADMIN_PATH: AT };

/**
 * A server on its own state directory and its own `HOME`.
 *
 * The same isolation `test/office-limits.test.js` uses and for the same reason: there is
 * one `endpoint.json` per machine and a test has no business touching the developer's.
 * A per-test state directory also means the counters start empty, which several of these
 * assertions depend on.
 */
function start({ port, env = {} }) {
  const home = mkdtempSync(join(tmpdir(), 'tmp_rovo_admin-'));
  mkdirSync(join(home, '.roving-office'), { recursive: true });
  const child = spawn(process.execPath, ['server.cjs', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: home,
      PORT: '',
      ROVING_OFFICE_STATE_DIR: join(home, 'state'),
      // Both unset unless a test asks, so `...env` below can turn the console on.
      ROVING_OFFICE_ADMIN_PASSWORD: '',
      ROVING_OFFICE_ADMIN_PATH: '',
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
  return {
    child,
    base,
    ready,
    log: () => out,
    /**
     * Stop the server, then remove its state directory — in that order, and waiting in
     * between.
     *
     * `kill` only *sends* the signal. Removing the directory immediately afterwards races
     * the server's own exit handler, which flushes the office registry and the counters
     * on the way out (`shutdown` in server.cjs) and so recreates the directory that has
     * just been deleted. That leaves a stray `tmp_rovo_admin-*` per test in the temp
     * directory, which is litter this file is responsible for.
     */
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const done = setTimeout(resolve, 3000);
        child.once('exit', () => { clearTimeout(done); resolve(); });
      });
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

/** Sign in and hand back the cookie header a later request should carry. */
async function signIn(base, password = PASSWORD, at = AT) {
  const res = await fetch(`${base}${at}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { res, cookie: setCookie.split(';')[0] };
}

// --- absent unless configured ----------------------------------------------

test('with no password set the console does not exist', async (t) => {
  const server = start({ port: 8241 });
  t.after(() => server.stop());
  const base = await server.ready;

  // Every path — the configured one and the guessable one it was moved off — and the
  // answer must be indistinguishable from a missing file: a 401 would tell a stranger
  // this deployment has an admin surface they have not got into.
  for (const [method, path] of [
    ['GET', AT],
    ['GET', `${AT}/`],
    ['GET', `${AT}/console.html`],
    ['GET', `${AT}/console.js`],
    ['GET', `${AT}/api/stats`],
    ['POST', `${AT}/api/session`],
    ['GET', '/admin'],
    ['GET', '/admin/'],
    ['GET', '/admin/console.html'],
    ['GET', '/admin/console.js'],
    ['GET', '/admin/console.css'],
    ['GET', '/admin/api/stats'],
    ['POST', '/admin/api/session'],
    ['GET', '/admin/anything-else'],
  ]) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ password: PASSWORD }) : undefined,
    });
    assert.equal(res.status, 404, `${method} ${path}`);
    const body = await res.text();
    assert.equal(body, 'Not found', `${method} ${path} body`);
    // Not JSON, because the shape of the answer is itself a signal. A missing static
    // file answers `text/plain`, so this must too.
    assert.match(res.headers.get('content-type') ?? '', /text\/plain/, `${method} ${path} type`);
  }

  // And the boot log does not mention a console that is not there.
  assert.doesNotMatch(server.log(), /[Aa]dmin console/);
});

test('an empty password variable is the same as no password at all', async (t) => {
  // A deployment that set the variable to nothing meant to leave the feature off, and
  // must not end up with a console whose password is the empty string.
  const server = start({ port: 8242, env: { ROVING_OFFICE_ADMIN_PASSWORD: '   ' } });
  t.after(() => server.stop());
  const base = await server.ready;

  assert.equal((await fetch(`${base}${AT}`)).status, 404);
  const { res } = await signIn(base, '');
  assert.equal(res.status, 404);
});

// --- the files are not static files ----------------------------------------

test('the console’s files are unreachable through the static server', async (t) => {
  // With the password *set*, so this is not passing merely because the console is off.
  const server = start({ port: 8243, env: CONFIGURED });
  t.after(() => server.stop());
  const base = await server.ready;

  // `%2f` survives `url.pathname`, so none of these start with the configured path and
  // all of them fall through the router to `serveStatic`, where `decodeURIComponent`
  // turns the escape back into a separator. Without the guard there, this serves the file.
  //
  // The guard is on the **resolved path** rather than the URL, which is what makes it
  // independent of where the console is mounted: the files live in `admin/` on disk
  // whatever the operator called the route, so the same one guard covers both the
  // encoded configured path and the `admin/` directory itself.
  for (const path of [
    `${AT}%2fconsole.js`,
    `${AT}%2Fconsole.html`,
    '/admin%2fconsole.js',
    '/admin%2Fconsole.html',
    '/admin%2fconsole.css',
    '/.%2fadmin%2fconsole.js',
  ]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(await res.text(), /fetch\(/, `${path} served the console`);
  }
});

// --- both variables, or nothing --------------------------------------------

test('a password with no path is not a console', async (t) => {
  // The dangerous half of the pair is the other way round — a path with no password
  // would be an unauthenticated statistics endpoint at an address the operator believes
  // is secret — but neither half alone may produce a surface.
  const server = start({ port: 8255, env: { ROVING_OFFICE_ADMIN_PASSWORD: PASSWORD } });
  t.after(() => server.stop());
  const base = await server.ready;

  for (const path of [AT, '/admin', `${AT}/api/stats`]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  assert.doesNotMatch(server.log(), /[Aa]dmin console/);
});

test('a path with no password is not a console either', async (t) => {
  const server = start({ port: 8256, env: { ROVING_OFFICE_ADMIN_PATH: AT } });
  t.after(() => server.stop());
  const base = await server.ready;

  assert.equal((await fetch(`${base}${AT}`)).status, 404);
  assert.equal((await fetch(`${base}${AT}/api/stats`)).status, 404);
  // Nothing is served, so there is nothing to sign in to.
  assert.equal((await signIn(base)).res.status, 404);
});

// Four servers in sequence, each stopped before the next binds — hence no `t`.
test('a path that would shadow the app is refused, and the office keeps working', async () => {
  // A console mounted at `/office` would silently take over every room on the server.
  // Refused — and refused by disabling the console rather than by failing to boot, since
  // a mistyped admin path must not be able to take the product down.
  for (const [port, bad] of [[8257, '/office'], [8258, '/api/health'], [8259, '/../secrets'], [8260, '/has spaces']]) {
    const server = start({ port, env: { ROVING_OFFICE_ADMIN_PASSWORD: PASSWORD, ROVING_OFFICE_ADMIN_PATH: bad } });
    const base = await server.ready;
    try {
      assert.match(server.log(), /ROVING_OFFICE_ADMIN_PATH .* the console is disabled/, bad);
      // The office is untouched by the refusal.
      assert.equal((await fetch(`${base}/office/TEST-0000/api`)).status, 200, bad);
      const health = await (await fetch(`${base}/api/health`)).json();
      assert.ok(Number.isFinite(health.offices), bad);
    } finally {
      await server.stop();
    }
  }
});

test('the path is spelled one way however it is written, and is not the password', async (t) => {
  // A trailing slash and a missing leading one are slips rather than decisions, so they
  // are normalised to the one path the router matches.
  const server = start({
    port: 8261,
    env: { ROVING_OFFICE_ADMIN_PASSWORD: PASSWORD, ROVING_OFFICE_ADMIN_PATH: ' back-of-house-7f3a/ ' },
  });
  t.after(() => server.stop());
  const base = await server.ready;

  assert.equal((await fetch(`${base}${AT}`)).status, 200, 'a leading slash is added and a trailing one dropped');
  const { res, cookie } = await signIn(base);
  assert.equal(res.status, 200);
  // The cookie is scoped to the configured path, not to a baked-in one.
  const raw = res.headers.get('set-cookie') ?? '';
  assert.match(raw, new RegExp(`Path=${AT}(;|$)`));
  // And the path is not derived from the password: a path travels in logs, history and
  // referrer headers, so anything computed from the secret would leak part of it there.
  assert.doesNotMatch(AT, new RegExp(PASSWORD));
  assert.ok(cookie.startsWith('ro_admin='));
});

// --- the password itself ---------------------------------------------------

test('a wrong password is refused, and says nothing about the data', async (t) => {
  const server = start({ port: 8244, env: CONFIGURED });
  t.after(() => server.stop());
  const base = await server.ready;

  const { res, cookie } = await signIn(base, 'not-the-password');
  assert.equal(res.status, 401);
  assert.equal(cookie, '', 'a refusal must not set a session cookie');
  const body = await res.json();
  // One sentence, and no counts: an unauthenticated caller must not be able to tell a
  // busy server from an empty one.
  assert.deepEqual(Object.keys(body), ['error']);
  assert.doesNotMatch(JSON.stringify(body), /offices|days|events|census/);
});

test('the statistics need the session, and refusing one reveals no numbers', async (t) => {
  const server = start({ port: 8245, env: CONFIGURED });
  t.after(() => server.stop());
  const base = await server.ready;

  for (const headers of [
    {},
    { cookie: 'ro_admin=' },
    { cookie: 'ro_admin=0000000000000000000000000000000000000000000000000000000000000000' },
    // A valid *office* seal is not a console session. Different secret, different door.
    { cookie: 'ro_TEST-0000=deadbeef' },
  ]) {
    const res = await fetch(`${base}${AT}/api/stats`, { headers });
    assert.equal(res.status, 401, JSON.stringify(headers));
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ['error'], JSON.stringify(headers));
  }

  // The shell is served without a credential on purpose — it is a fixed file with no
  // data in it — but it must carry no numbers of its own.
  const shell = await fetch(`${base}${AT}`);
  assert.equal(shell.status, 200);
  const html = await shell.text();
  assert.match(html, /id="gate"/, 'the shell should offer the password form');
  assert.doesNotMatch(html, /recordingSince|census|"offices"/, 'the shell must hold no data');
});

test('the right password admits, and the report is aggregates only', async (t) => {
  const server = start({ port: 8246, env: CONFIGURED });
  t.after(() => server.stop());
  const base = await server.ready;

  // Some traffic to count: an office, and an event from a named harness.
  const minted = await (await fetch(`${base}/api/offices`, { method: 'POST' })).json();
  const posted = await fetch(`${base}/office/${minted.keycard}/aop/v0/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-roving-office-token': minted.writeToken },
    body: JSON.stringify({
      aop: '0.2',
      type: 'turn.start',
      harness: { name: 'claude-code' },
      session: { id: 's1' },
      payload: { title: 'a secret-sounding job title nobody should ever see' },
    }),
  });
  assert.equal(posted.status, 202);

  const { res, cookie } = await signIn(base);
  assert.equal(res.status, 200);
  assert.match(cookie, /^ro_admin=[0-9a-f]{64}$/);
  // The sign-in carries the report, so a browser that has just got in has the numbers
  // rather than needing a second round trip.
  const signedIn = await res.json();
  assert.equal(signedIn.signedIn, true);

  const report = await (await fetch(`${base}${AT}/api/stats`, { headers: { cookie } })).json();
  const text = JSON.stringify(report);

  // It counted.
  assert.equal(report.days.at(-1).sources['claude-code'].offices, 1);
  assert.equal(report.days.at(-1).sources['claude-code'].events, 1);
  assert.equal(report.days.at(-1).jobs.turnsStarted, 1);
  assert.equal(report.days.at(-1).offices.minted, 1);
  assert.equal(report.census.offices, 1);
  assert.ok(Number.isFinite(report.recording.since));

  // And it counted *only* that. Nothing identifying and nothing written by anybody.
  assert.doesNotMatch(text, /secret-sounding/, 'no content may reach the report');
  assert.doesNotMatch(text, new RegExp(minted.keycard), 'no keycard may reach the report');
  assert.doesNotMatch(text, /rot_/, 'no token may reach the report');
  assert.doesNotMatch(text, /127\.0\.0\.1|::1/, 'no address may reach the report');
  assert.doesNotMatch(text, /\bs1\b/, 'no session id may reach the report');

  // Signing out takes the session away again.
  const out = await fetch(`${base}${AT}/api/session`, { method: 'DELETE', headers: { cookie } });
  assert.match(out.headers.get('set-cookie') ?? '', /ro_admin=; .*Max-Age=0/);
});

// --- the limiter -----------------------------------------------------------

test('guessing is bounded, and a right answer costs nothing', async (t) => {
  const server = start({
    port: 8247,
    env: {
      ...CONFIGURED,
      // Two wrong tries per client, three across the whole server. Small numbers so the
      // test is fast; the shape is what is being checked, not the default.
      ROVING_OFFICE_ADMIN_PER_CLIENT: '2',
      ROVING_OFFICE_ADMIN_PER_SERVER: '3',
      ROVING_OFFICE_ADMIN_WINDOW_MS: '600000',
    },
  });
  t.after(() => server.stop());
  const base = await server.ready;

  assert.equal((await signIn(base, 'wrong-1')).res.status, 401);
  assert.equal((await signIn(base, 'wrong-2')).res.status, 401);

  const stopped = await signIn(base, 'wrong-3');
  assert.equal(stopped.res.status, 429, 'a third wrong password in the window is refused');
  assert.ok(Number(stopped.res.headers.get('retry-after')) > 0, 'and says when to come back');
  const refusal = await stopped.res.json();
  assert.equal(refusal.scope, 'client');
  assert.match(refusal.error, /too many wrong passwords/);

  // The limiter bounds *attempts*, so even the correct password is refused while it is
  // spent. That is the property worth having: it is what makes the password's own
  // strength the only thing an attacker can attack, at five tries per ten minutes.
  assert.equal((await signIn(base)).res.status, 429);
});

test('a mistyped password does not use up the allowance once it is typed right', async (t) => {
  const server = start({
    port: 8248,
    env: {
      ...CONFIGURED,
      ROVING_OFFICE_ADMIN_PER_CLIENT: '2',
      ROVING_OFFICE_ADMIN_PER_SERVER: '9',
      ROVING_OFFICE_ADMIN_WINDOW_MS: '600000',
    },
  });
  t.after(() => server.stop());
  const base = await server.ready;

  assert.equal((await signIn(base, 'fat-fingered')).res.status, 401);
  assert.equal((await signIn(base)).res.status, 200, 'the second try is the right one');
  // The refund means that success cost nothing, so there is still a try in hand.
  assert.equal((await signIn(base, 'wrong-again')).res.status, 401);
});

test('a body that is not a password is refused before scrypt runs', async (t) => {
  const server = start({ port: 8249, env: CONFIGURED });
  t.after(() => server.stop());
  const base = await server.ready;

  for (const body of ['{}', '{"password":null}', '{"password":""}', '{"password":123}', '']) {
    const res = await fetch(`${base}${AT}/api/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal(res.status, 400, body);
  }
  // A password long enough to be an attack on the KDF rather than a guess at the secret.
  const huge = await fetch(`${base}${AT}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'x'.repeat(5000) }),
  });
  assert.equal(huge.status, 400);
});

// --- the front door is untouched -------------------------------------------

// Two servers in sequence rather than `t.after`, so each is stopped before the next
// binds — hence no `t` here.
test('the front door still needs nothing, console or no console', async () => {
  // Both ways round, because the point is that this change is invisible to every
  // ordinary visitor whether or not the operator configured a console.
  for (const [port, env] of [
    [8250, {}],
    [8251, CONFIGURED],
  ]) {
    const server = start({ port, env });
    const base = await server.ready;
    try {
      const front = await fetch(`${base}/`, { redirect: 'manual' });
      assert.equal(front.status, 302);
      assert.equal(front.headers.get('location'), '/office/TEST-0000/');

      const demo = await fetch(`${base}/office/TEST-0000/api`);
      assert.equal(demo.status, 200, 'the demo office asks for no credential');
      const office = await demo.json();
      assert.equal(office.keycard, 'TEST-0000');
      assert.equal(office.passcode, false);

      // The page itself, and reception.
      assert.equal((await fetch(`${base}/office/TEST-0000/`)).status, 200);
      assert.equal((await fetch(`${base}/offices`)).status, 200);
      // The unauthenticated health route keeps answering what it always did.
      const health = await (await fetch(`${base}/api/health`)).json();
      assert.ok(Number.isFinite(health.offices));
      // And says nothing about a console.
      assert.doesNotMatch(JSON.stringify(health), /admin/i);
    } finally {
      await server.stop();
    }
  }
});

// --- the demo office is not in the statistics ------------------------------

test('the demo office is excluded from every statistic', async (t) => {
  // A known ingest token, so this test can actually feed the demo office. The server's
  // own token opens writes to every office on it and is normally random per boot.
  const server = start({
    port: 8252,
    env: { ...CONFIGURED, AOP_TOKEN: 'test-server-token' },
  });
  t.after(() => server.stop());
  const base = await server.ready;

  // Open the demo (the front door does this for every visitor) and feed it. This is the
  // room `/` redirects to, so counting it would report this project's own demo as usage.
  await fetch(`${base}/office/TEST-0000/api`);
  const posted = await fetch(`${base}/office/TEST-0000/aop/v0/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-roving-office-token': 'test-server-token' },
    body: [1, 2, 3].map((i) => JSON.stringify({
      aop: '0.2',
      type: 'turn.start',
      harness: { name: 'claude-code' },
      session: { id: `demo-${i}` },
      payload: { title: 'demo traffic' },
    })).join('\n'),
  });
  assert.equal((await posted.json()).accepted, 3);

  const { cookie } = await signIn(base);
  const report = await (await fetch(`${base}${AT}/api/stats`, { headers: { cookie } })).json();
  const today = report.days.at(-1);

  // The demo office exists, is being fed, and none of that is in the real numbers.
  assert.equal(report.now.demoOffice, true, 'the demo office is open');
  assert.equal(report.census.offices, 0, 'and is not in the census');
  assert.equal(report.census.scenes, 0, 'nor are its three authored scenes');
  assert.equal(today.offices.minted, 0, 'opening the demo is not somebody minting an office');
  assert.equal(today.sources['claude-code'].offices, 0, 'nor is feeding it a connection');
  assert.equal(today.sources['claude-code'].events, 0);
  assert.equal(today.jobs.turnsStarted, 0, 'nor are its turns jobs anybody delivered');
  // Counted apart rather than discarded, so the exclusion is visible instead of silent.
  assert.equal(today.demoEvents, 3);
});

test('the census counts offices and reveals no office', async (t) => {
  const server = start({
    port: 8253,
    env: {
      ...CONFIGURED,
      ROVING_OFFICE_MINT_PER_CLIENT: '100',
      ROVING_OFFICE_MINT_PER_SERVER: '100',
    },
  });
  t.after(() => server.stop());
  const base = await server.ready;

  const offices = [];
  for (let i = 0; i < 3; i += 1) {
    offices.push(await (await fetch(`${base}/api/offices`, { method: 'POST' })).json());
  }
  // Give one of them a look and a layout, which is the only way the server ever learns
  // what a room looks like (the browser rolls it and PATCHes it back).
  const [first] = offices;
  await fetch(`${base}/office/${first.keycard}/api/scenes/${first.scenes[0].id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      look: { season: 'autumn', building: 'tower', bearing: 30 },
      layout: {
        layout: 4,
        complete: true,
        desks: { 'desk-1': { x: 1, z: 1, facing: 0 }, 'desk-2': { x: 2, z: 2, facing: 0, standing: true } },
        stations: { bookshelf: { kind: 'bookshelf', x: 3, z: 3, facing: 0 } },
        furniture: { 'rug-1': { kind: 'rug', x: 4, z: 4 } },
        plants: { 'plant-1': { kind: 'fern', x: 5, z: 5, facing: 0, scale: 1 } },
        channels: { post: true, parcel: false },
      },
    }),
  });

  const { cookie } = await signIn(base);
  const report = await (await fetch(`${base}${AT}/api/stats`, { headers: { cookie } })).json();
  const text = JSON.stringify(report);

  assert.equal(report.census.offices, 3);
  assert.equal(report.census.writeTokens, 3, 'one token each, as minted');
  assert.equal(report.census.arranged, 1);
  assert.equal(report.census.unlooked, 2);
  assert.deepEqual(report.census.seasons, { autumn: 1 });
  assert.deepEqual(report.census.buildings, { tower: 1 });
  assert.deepEqual(report.census.channels, { post: 1 }, 'only the ways in that are on');
  // Furniture is counted by kind, and desks by whether they stand.
  assert.equal(report.census.furniture.desk, 1);
  assert.equal(report.census.furniture['desk (standing)'], 1);
  assert.equal(report.census.furniture.bookshelf, 1);
  assert.equal(report.census.furniture.fern, 1);
  // The look choice is recorded per day as well as photographed.
  assert.equal(report.days.at(-1).looks.seasons.autumn, 1);

  // Three offices in the numbers, no way to reach one from them.
  for (const office of offices) {
    assert.doesNotMatch(text, new RegExp(office.keycard), 'a keycard reached the report');
    assert.doesNotMatch(text, new RegExp(office.scenes[0].id), 'a scene id reached the report');
  }
  // Nor a coordinate out of the layout that was stored.
  assert.doesNotMatch(text, /"x":/, 'a prop position reached the report');
});

// --- closing is counted apart from reaping ---------------------------------

test('an office closed by its owner is counted as closed, not reaped', async (t) => {
  const server = start({ port: 8254, env: CONFIGURED });
  t.after(() => server.stop());
  const base = await server.ready;

  const office = await (await fetch(`${base}/api/offices`, { method: 'POST' })).json();
  const closed = await fetch(`${base}/office/${office.keycard}/api`, {
    method: 'DELETE',
    headers: { 'x-roving-office-token': office.writeToken },
  });
  assert.equal(closed.status, 200);

  const { cookie } = await signIn(base);
  const report = await (await fetch(`${base}${AT}/api/stats`, { headers: { cookie } })).json();
  const today = report.days.at(-1);
  assert.equal(today.offices.minted, 1);
  assert.equal(today.offices.closed, 1);
  assert.equal(today.offices.reaped, 0, 'deliberate and abandoned are different facts');
  assert.equal(report.census.offices, 0);
});
