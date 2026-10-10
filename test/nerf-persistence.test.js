import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createNerfState } from '../lib/nerf-state.cjs';
import { connectNerfState } from '../src/nerf-state.js';

test('the global flag survives office disposal and server restarts; stop is durable too', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nerf-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'nerf-war.json');
  const first = createNerfState(file), updates = [];
  const unsubscribe = first.subscribe((value) => updates.push(value));
  first.set(true);
  first.set(true);
  assert.deepEqual(updates, [false, true]);
  unsubscribe();
  const replacement = createNerfState(file);
  assert.equal(replacement.enabled, true);
  replacement.set(false);
  assert.equal(createNerfState(file).enabled, false);
});

test('visitors receive snapshots, shared toggles, and reconnect state', async () => {
  let enabled = true, listener, closed = false;
  class Source {
    addEventListener(name, callback) { assert.equal(name, 'nerf-war'); listener = callback; }
    close() { closed = true; }
  }
  const changes = [];
  const state = await connectNerfState({
    EventSourceClass: Source, onChange: (value) => changes.push(value),
    fetcher: async (url, options) => {
      assert.equal(url, '/api/nerf-war');
      if (options) enabled = JSON.parse(options.body).enabled;
      return { ok: true, json: async () => ({ enabled }) };
    },
  });
  assert.equal(state.enabled, true);
  await state.set(false);
  listener({ data: JSON.stringify({ enabled: true }) });
  listener({ data: 'not json' });
  assert.deepEqual(changes, [true, false, true]);
  assert.equal(state.enabled, true);
  state.close();
  assert.equal(closed, true);
});

test('HTTP flag is shared, streamed, validated, and preserved on restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nerf-http-'));
  const base = 'http://127.0.0.1:8207';
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['server.cjs', '8207'], {
      stdio: 'ignore', env: { ...process.env, ROVING_OFFICE_STATE_DIR: dir },
    });
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${base}/api/nerf-war`)).ok) return; } catch { /* booting */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('server did not start');
  };
  const stop = async () => { const exited = once(child, 'exit'); child.kill(); await exited; };
  t.after(async () => {
    if (child?.exitCode === null) await stop();
    rmSync(dir, { recursive: true, force: true });
  });
  await start();
  const write = (body, headers = {}) => fetch(`${base}/api/nerf-war`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.deepEqual(await (await fetch(`${base}/api/nerf-war`)).json(), { enabled: false });
  assert.equal((await write({ enabled: 'yes' })).status, 400);
  assert.equal((await write({ enabled: true }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await write({ enabled: true }, { 'Content-Type': 'text/plain' })).status, 415);
  const abort = new AbortController();
  const stream = await fetch(`${base}/api/nerf-war/stream`, { signal: abort.signal });
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"enabled":false/);
  assert.equal((await write({ enabled: true })).status, 200);
  assert.match(new TextDecoder().decode((await reader.read()).value), /"enabled":true/);
  abort.abort();
  await stop();
  await start();
  assert.deepEqual(await (await fetch(`${base}/api/nerf-war`)).json(), { enabled: true });
  await write({ enabled: false });
});
