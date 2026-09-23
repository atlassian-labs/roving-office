// The receiver's gate, tested at the HTTP surface: a keycard is enough to
// watch an office, and not enough to inject agents into one. One ephemeral
// server, spawned on a spare port and killed when the file is done.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8199;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

before(async () => {
  child = spawn(process.execPath, ['server.cjs', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // Office creation is rate-limited and capped (server.cjs, test/office-limits.test.js
    // owns those). This file mints a fresh office per test to get an isolated one, which
    // is a machine doing in three seconds what a person does in a week — so the limits
    // are lifted here rather than tested by accident. Without this the later tests fail
    // on a 429 whose body they then try to read as an office.
    env: {
      ...process.env,
      ROVING_OFFICE_MINT_PER_CLIENT: '1000',
      ROVING_OFFICE_MINT_PER_SERVER: '1000',
    },
  });
  // Up when the health route answers; give a slow CI runner a few seconds.
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/office/TEST-0000/aop/v0/health`);
      if (res.ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error('server did not come up');
    await new Promise((r) => setTimeout(r, 150));
  }
});

after(() => { child?.kill('SIGTERM'); });

test('the front door enters the demo and preserves office-entry links', async () => {
  for (const [url, location] of [
    ['/', '/office/TEST-0000/'],
    ['/?edit=1', '/office/TEST-0000/?edit=1'],
    ['/?seed=sunny-room', '/offices?seed=sunny-room'],
    ['/home.html', '/offices'],
    ['/office/not-a-keycard', '/offices?bad-keycard=1'],
  ]) {
    const res = await fetch(`${BASE}${url}`, { redirect: 'manual' });
    assert.equal(res.status, 302, url);
    assert.equal(res.headers.get('location'), location, url);
  }
  const entry = await fetch(`${BASE}/offices`);
  assert.equal(entry.status, 200);
  assert.match(await entry.text(), /id="enter-form"/);
});

test('demo API writes cannot change another visitor’s starting rooms', async () => {
  const url = `${BASE}/office/TEST-0000/api`;
  const before = await (await fetch(url)).json();
  for (const [method, route] of [
    ['POST', '/scenes'],
    ['PATCH', `/scenes/${before.scenes[0].id}`],
    ['PUT', `/scenes/${before.scenes[0].id}`],
    ['DELETE', `/scenes/${before.scenes[0].id}`],
  ]) {
    const res = await fetch(`${url}${route}`, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Changed' }),
    });
    assert.equal(res.status, 403, method);
  }
  const after = await (await fetch(url)).json();
  assert.deepEqual(after.scenes, before.scenes);
});

// --- the edge of the checkout --------------------------------------------
//
// The static server hands out anything under the checkout, so where the checkout *ends*
// is a security boundary and not a detail. It was a string prefix test, which is a
// boundary only by coincidence: a directory sitting next to the checkout whose name
// merely starts the same way — `<checkout>-secrets` — was inside it as far as the guard
// was concerned, and reachable in one request.

test('a sibling directory that shares the checkout\'s name prefix is refused', async () => {
  // The name is derived rather than written down, because the bug is *relative* to
  // whatever the checkout happens to be called.
  const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[/\\]$/, '');
  const sibling = `${basename(root)}-secrets`;

  // `%2f` rather than a plain slash: a real `/../` is collapsed by `new URL` before the
  // server ever sees it, and this one is not — `url.pathname` keeps the escape and
  // `decodeURIComponent` turns it back into a separator, after which `path.normalize`
  // walks one level out of the checkout.
  const out = await fetch(`${BASE}/..%2f${sibling}/loot.txt`);

  // 403, specifically, and the specificity is the test: the containment check runs
  // before anything touches the disk, so a refused path never reaches the filesystem to
  // find out whether it exists. Under the old prefix test this same request passed the
  // guard and came back 404 — or 200, with the file, when the directory was there.
  assert.equal(out.status, 403, 'the guard refuses it on the boundary, not on the disk');
  assert.equal(await out.text(), 'Forbidden');

  // Plain traversal was always refused; it is here so a future rewrite that fixes one
  // and loses the other fails.
  const deeper = await fetch(`${BASE}/..%2f..%2f..%2f..%2fetc/passwd`);
  assert.equal(deeper.status, 403);
});

test('the docs site is still served, and still cannot be escaped', async () => {
  // The same prefix test guarded `docs/site` inside `resolveDocs`, so the fix touches
  // the one path that legitimately resolves outside `ROOT + '/'`-shaped simplicity.
  // These are the requests that would break if the boundary were drawn too tightly.
  for (const path of ['/docs', '/docs/', '/docs/index.html', '/docs/user/install.html']) {
    const res = await fetch(`${BASE}${path}`);
    assert.equal(res.status, 200, `${path} still resolves into the built site`);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/, path);
  }
  // The fallback to `docs/` itself, for the finished pages Eleventy does not build.
  const image = await fetch(`${BASE}/docs/images/objects/desk.png`);
  assert.equal(image.status, 200, 'the unbuilt half of docs/ is still reachable');

  // And out of the built site is still out: this normalises above `docs/site`, so the
  // fallback catches it, and the fallback is inside the checkout — which is the honest
  // reason this returns a page rather than a 403, and why the `ROOT` check is the one
  // that has to be right.
  const escape = await fetch(`${BASE}/docs/..%2f..%2f..%2fetc/passwd`);
  assert.equal(escape.status, 403, 'past the checkout is refused wherever it started');
});

test('health answers for an office — and an unknown keycard IS an office', async () => {
  const ok = await fetch(`${BASE}/office/TEST-0000/aop/v0/health`);
  assert.equal(ok.status, 200);

  // Visiting an unknown keycard is how an office is made (office-store.test.js
  // pins it at the store level) — so a fresh, valid keycard answers too.
  const fresh = await fetch(`${BASE}/office/ZZZZ-ZZZZ/aop/v0/health`);
  assert.equal(fresh.status, 200, 'open on sight, by design');
});

test('reads need only the keycard; writes need a token as well', async () => {
  const state = await fetch(`${BASE}/office/TEST-0000/aop/v0/state`);
  assert.equal(state.status, 200, 'watching an office takes nothing but its address');

  const body = JSON.stringify({
    aop: '0.1', id: 't1', type: 'session.start',
    harness: { name: 'claude-code' }, session: { id: 'S1' }, payload: {},
  });

  const naked = await fetch(`${BASE}/office/TEST-0000/aop/v0/events`, {
    method: 'POST', headers: { 'content-type': 'application/x-ndjson' }, body,
  });
  assert.ok([401, 403].includes(naked.status),
    `an eventless POST must be refused, got ${naked.status}`);

  const wrong = await fetch(`${BASE}/office/TEST-0000/aop/v0/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson', 'x-roving-office-token': 'not-a-token' },
    body,
  });
  assert.ok([401, 403].includes(wrong.status),
    `a bad token must be refused, got ${wrong.status}`);
});

test('a minted office accepts writes with its own token and no other', async () => {
  const minted = await fetch(`${BASE}/api/offices`, { method: 'POST' });
  assert.equal(minted.status, 201, 'a fresh office is a creation');
  const { keycard, writeToken } = await minted.json();
  assert.ok(keycard && writeToken, 'POST /api/offices returns the pair');

  const body = JSON.stringify({
    aop: '0.1', id: 't2', type: 'session.start',
    harness: { name: 'claude-code' }, session: { id: 'S1' }, payload: {},
  });

  const accepted = await fetch(`${BASE}/office/${keycard}/aop/v0/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson', 'x-roving-office-token': writeToken },
    body,
  });
  assert.equal(accepted.status, 202, 'the office takes its own token — accepted for fan-out');

  const elsewhere = await fetch(`${BASE}/office/TEST-0000/aop/v0/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson', 'x-roving-office-token': writeToken },
    body,
  });
  assert.ok([401, 403].includes(elsewhere.status),
    'one office\'s token opens no other office');

  const replay = await fetch(`${BASE}/office/${keycard}/aop/v0/state`);
  const snap = await replay.json();
  assert.ok((snap.events ?? []).some((e) => e.id === 't2'), 'the write landed in the ring');
});

test('a scene change reaches another tab over the stream, and not its own author', async () => {
  const minted = await fetch(`${BASE}/api/offices`, { method: 'POST' });
  const { keycard: card } = await minted.json();
  const doc = await (await fetch(`${BASE}/office/${card}/api`)).json();
  const sceneId = doc.scenes[0].id;

  // The listening tab. Aborted at the end whatever happens, so a failure here cannot
  // leave the suite holding a stream open.
  const stop = new AbortController();
  const stream = await fetch(`${BASE}/office/${card}/api/stream?viewer=tab-b`, { signal: stop.signal });
  assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();

  /** Read until the buffer holds a full SSE frame, or give up. */
  const nextFrame = async (ms) => {
    let buf = '';
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise((r) => setTimeout(() => r({ value: undefined }), deadline - Date.now())),
      ]);
      if (!chunk?.value) break;
      buf += decoder.decode(chunk.value, { stream: true });
      if (buf.includes('event: scene')) return buf;
    }
    return buf;
  };

  try {
    const patch = (viewer, x) => fetch(
      `${BASE}/office/${card}/api/scenes/${encodeURIComponent(sceneId)}?viewer=${viewer}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: { layout: 3, complete: true, desks: { 'desk-1': { x, z: 6.25, facing: 0 } } } }),
      },
    );

    await patch('tab-a', 9.5);
    const frame = await nextFrame(3000);
    assert.match(frame, /event: scene/, 'the other tab is told');
    const payload = JSON.parse(frame.slice(frame.indexOf('data: ') + 6).split('\n')[0]);
    assert.equal(payload.layout.desks['desk-1'].x, 9.5);

    // Its own edit does not come back — the frame reader should time out empty.
    await patch('tab-b', 2);
    assert.doesNotMatch(await nextFrame(700), /event: scene/, 'a tab is not told about its own edit');
  } finally {
    stop.abort();
  }
});

// --- more than one token per office -------------------------------
//
// The rule these all circle: a token can mint another token, and a keycard never can.
// If the keycard could, every viewer would be a writer and the read/write split the
// rest of this file tests would be over.

test('a second machine gets its own token, minted with the first', async () => {
  const minted = await fetch(`${BASE}/api/offices`, { method: 'POST' });
  const { keycard, writeToken } = await minted.json();

  const second = await fetch(`${BASE}/office/${keycard}/aop/v0/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-roving-office-token': writeToken },
    body: JSON.stringify({ label: 'gateway-syd' }),
  });
  assert.equal(second.status, 201);
  const gateway = await second.json();
  assert.ok(gateway.token && gateway.id, 'the plaintext, once, and an id to name it by');
  assert.equal(gateway.label, 'gateway-syd');
  assert.notEqual(gateway.token, writeToken);

  const body = JSON.stringify({
    aop: '0.1', id: 't3', type: 'session.start',
    harness: { name: 'claude-code' }, session: { id: 'S2' }, payload: {},
  });
  for (const [who, tok] of [['the first machine', writeToken], ['the second', gateway.token]]) {
    const res = await fetch(`${BASE}/office/${keycard}/aop/v0/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson', 'x-roving-office-token': tok },
      body,
    });
    assert.equal(res.status, 202, `${who} can write`);
  }
});

test('a keycard cannot mint, list or revoke — only a token can', async () => {
  const minted = await fetch(`${BASE}/api/offices`, { method: 'POST' });
  const { keycard, writeToken } = await minted.json();
  const url = `${BASE}/office/${keycard}/aop/v0/tokens`;

  // Naming the office in the path is the whole of holding its keycard, and these
  // requests do exactly that and nothing more.
  assert.equal((await fetch(url)).status, 401, 'the list is a map of who can write');
  assert.equal((await fetch(url, { method: 'POST' })).status, 401, 'and minting is the split itself');
  assert.equal((await fetch(`${url}/anything`, { method: 'DELETE' })).status, 401);

  // Same three with a token: allowed.
  const auth = { 'x-roving-office-token': writeToken };
  assert.equal((await fetch(url, { headers: auth })).status, 200);
});

test('revoking takes one machine away and leaves the rest', async () => {
  const minted = await fetch(`${BASE}/api/offices`, { method: 'POST' });
  const { keycard, writeToken } = await minted.json();
  const url = `${BASE}/office/${keycard}/aop/v0/tokens`;
  const auth = { 'content-type': 'application/json', 'x-roving-office-token': writeToken };

  const gateway = await (await fetch(url, {
    method: 'POST', headers: auth, body: JSON.stringify({ label: 'gateway-syd' }),
  })).json();

  const listed = await (await fetch(url, { headers: auth })).json();
  assert.deepEqual(listed.tokens.map((t) => t.label), ['first', 'gateway-syd']);
  assert.ok(listed.tokens.every((t) => !('hash' in t)), 'metadata, never the credential');

  const gone = await fetch(`${url}/${gateway.id}`, { method: 'DELETE', headers: auth });
  assert.equal(gone.status, 200);

  const body = JSON.stringify({
    aop: '0.1', id: 't4', type: 'session.start',
    harness: { name: 'claude-code' }, session: { id: 'S3' }, payload: {},
  });
  const refused = await fetch(`${BASE}/office/${keycard}/aop/v0/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson', 'x-roving-office-token': gateway.token },
    body,
  });
  assert.ok([401, 403].includes(refused.status), 'the revoked machine is out');

  const still = await fetch(`${BASE}/office/${keycard}/aop/v0/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson', 'x-roving-office-token': writeToken },
    body,
  });
  assert.equal(still.status, 202, 'and nobody else was disturbed');
});

test('the last token is refused rather than leaving an office nobody can staff', async () => {
  const minted = await fetch(`${BASE}/api/offices`, { method: 'POST' });
  const { keycard, writeToken, writeTokenId } = await minted.json();
  const auth = { 'x-roving-office-token': writeToken };

  const refused = await fetch(`${BASE}/office/${keycard}/aop/v0/tokens/${writeTokenId}`, {
    method: 'DELETE', headers: auth,
  });
  assert.equal(refused.status, 409, 'the token is there; it is the outcome that is refused');

  const missing = await fetch(`${BASE}/office/${keycard}/aop/v0/tokens/nosuchid`, {
    method: 'DELETE', headers: auth,
  });
  assert.equal(missing.status, 404, 'and an id nobody holds is a different answer');
});
