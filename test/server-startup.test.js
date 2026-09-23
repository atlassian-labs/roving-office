// How a server chooses its port, and who it tells.
//
// Both halves are about not surprising the machine. Several of these run at once in
// practice — one per worktree, one per screenshot — and there is exactly one
// `endpoint.json` for all of them, so a server that publishes on sight redirects every
// hook on the machine into a room nobody is watching. Each test gets its own `HOME`,
// which is also the only honest way to assert "it did not write the endpoint file".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Start a server, wait for its banner, and hand back what it said. */
function start(args = [], { home, waitMs = 8000, env = {} } = {}) {
  const child = spawn(process.execPath, ['server.cjs', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // `PORT` and `HOST` are cleared rather than inherited: both are ordinary names a
    // shell might already hold, and a test of the default bind is worthless if the
    // ambient environment can set it.
    env: { ...process.env, HOME: home, PORT: '', HOST: '', ...env },
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });

  // Both timers are cleared on both paths. Leaving the poll running on the reject
  // path holds the event loop open, and `node --test` then waits for a server that
  // has already failed — the run hangs instead of failing.
  const ready = new Promise((resolve, reject) => {
    const done = (fn, value) => { clearInterval(tick); clearTimeout(deadline); fn(value); };
    const deadline = setTimeout(() => done(reject, new Error(`server did not start: ${out}`)), waitMs);
    const tick = setInterval(() => {
      const hit = /running at http:\/\/localhost:(\d+)/.exec(out);
      if (hit) done(resolve, Number(hit[1]));
    }, 100);
  });
  return { child, ready, log: () => out };
}

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), 'tmp_rovo_home-'));
  mkdirSync(join(home, '.roving-office'), { recursive: true });
  return home;
}

test('a server started without --publish leaves the endpoint alone', async () => {
  const home = freshHome();
  const endpoint = join(home, '.roving-office', 'endpoint.json');
  // Somebody's real endpoint, pointing at an office on another host.
  const mine = JSON.stringify({ url: 'https://example.test/office/AAAA-1111/aop/v0/events', token: 'x', keycard: 'AAAA-1111', remote: true });
  writeFileSync(endpoint, mine);

  const server = start([], { home });
  const port = await server.ready;
  try {
    assert.ok(port >= 8080 && port <= 8095, `picked a port in range, got ${port}`);
    assert.match(server.log(), /this office is private/);
    assert.match(server.log(), /export AOP_URL=http:\/\/127\.0\.0\.1:/, 'says how one shell can reach it');
    // Piped stdout is a log, not a terminal, and the token opens writes to every office
    // on the receiver. The hosted deployments run this same line into a log collector.
    assert.doesNotMatch(server.log(), /export AOP_TOKEN=[0-9a-f]{8}/, 'no write credential into a pipe');
    assert.equal(readFileSync(endpoint, 'utf8'), mine, 'the endpoint is exactly as it was');
  } finally {
    server.child.kill('SIGTERM');
  }
  // And it does not delete it on the way out, which is the other half of the same bug.
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(existsSync(endpoint), 'still there after the server exits');
});

test('--publish is what takes the machine\'s adapters', async () => {
  const home = freshHome();
  const endpoint = join(home, '.roving-office', 'endpoint.json');
  const server = start(['--publish'], { home });
  const port = await server.ready;
  try {
    const written = JSON.parse(readFileSync(endpoint, 'utf8'));
    assert.match(written.url, new RegExp(`127\\.0\\.0\\.1:${port}/office/`));
    assert.equal(written.pid, server.child.pid);
    assert.doesNotMatch(server.log(), /this office is private/);
  } finally {
    server.child.kill('SIGTERM');
  }
});

test('two servers side by side land on different ports, and say which', async () => {
  const home = freshHome();
  const a = start([], { home });
  const portA = await a.ready;
  const b = start([], { home });
  const portB = await b.ready;
  try {
    assert.notEqual(portA, portB, 'the second walks up to the next free port');
    // The port in the banner is the port in the shell lines: a mismatch here is a URL
    // somebody pastes into a terminal that quietly posts nowhere.
    assert.match(b.log(), new RegExp(`export AOP_URL=http://127\\.0\\.0\\.1:${portB}/`));
  } finally {
    a.child.kill('SIGTERM');
    b.child.kill('SIGTERM');
  }
});

test('a port asked for and taken is refused, not quietly swapped', async () => {
  const home = freshHome();
  const held = start(['8087'], { home });
  await held.ready;
  const clash = start(['8087'], { home, waitMs: 3000 });
  try {
    await assert.rejects(clash.ready, /did not start/);
    assert.match(clash.log(), /port 8087 is already serving something else/);
  } finally {
    held.child.kill('SIGTERM');
    clash.child.kill('SIGTERM');
  }
});

// --- which interface it answers on --------------------------------
//
// `server.listen(port, cb)` — no host — binds every interface the machine has, and this
// server hands out anything under the checkout. On a shared network that is somebody's
// uncommitted work, their `.git/config` and their local tool settings, for one `curl`.
// So loopback is the default and `HOST` is the opt-out, which is what the container
// recipe sets. These two tests are the pair: the default is narrow, and the opt-out
// still works — because the hosted deployment depends on the second one.

/** A real address of this machine that is not loopback, if it has one. */
function lanAddress() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

/** Can something open a TCP connection to this address and port? */
function reachable(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (answer) => { socket.destroy(); resolve(answer); };
    socket.setTimeout(2000);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

test('by default the server answers on loopback and nowhere else', async () => {
  const home = freshHome();
  const server = start(['8196'], { home });
  const port = await server.ready;
  try {
    assert.equal(await reachable('127.0.0.1', port), true, 'loopback is the whole point');
    assert.doesNotMatch(server.log(), /Bound to/, 'and it does not claim a wider bind');

    const lan = lanAddress();
    if (!lan) {
      // Said rather than skipped silently: on a machine with no network there is
      // nothing to prove, and a green test that asserted nothing would be a lie.
      console.log('    (no non-loopback address on this machine — nothing to refuse)');
      return;
    }
    assert.equal(await reachable(lan, port), false,
      `${lan}:${port} answered — the working tree is on the network`);
  } finally {
    server.child.kill('SIGTERM');
  }
});

test('HOST is the deliberate way back to every interface', async () => {
  const lan = lanAddress();
  const home = freshHome();
  const server = start(['8197'], { home, env: { HOST: '0.0.0.0' } });
  const port = await server.ready;
  try {
    // The hosted deployments are this case: a platform's proxy arrives on the machine's
    // private interface, so a process on loopback alone fails every forwarded request.
    // `Dockerfile.fly` sets `HOST=0.0.0.0` and this is the assertion behind it.
    assert.equal(await reachable('127.0.0.1', port), true);
    assert.match(server.log(), /Bound to 0\.0\.0\.0/, 'and it says so, in the deploy log');
    if (lan) assert.equal(await reachable(lan, port), true, 'that is what 0.0.0.0 means');
  } finally {
    server.child.kill('SIGTERM');
  }
});

test('a HOST this machine has no address for fails with the reason', async () => {
  const home = freshHome();
  // Documentation-reserved and unroutable, so it cannot be a real local address.
  const server = start(['8198'], { home, env: { HOST: '192.0.2.1' }, waitMs: 4000 });
  try {
    await assert.rejects(server.ready, /did not start/);
    assert.match(server.log(), /cannot bind HOST=192\.0\.2\.1/);
  } finally {
    server.child.kill('SIGTERM');
  }
});

// --- where the state lives ----------------------------------------
//
// `$HOME` is the durable thing on a laptop and part of the image in a container, so
// a hosted office kept its whole registry — keycards, layouts, ingest tokens — in the
// one directory a deploy throws away. The location is a setting now, and this is the
// assertion that it is really a setting and not a default with a second name.

test('ROVING_OFFICE_STATE_DIR moves the registry off $HOME', async () => {
  const home = freshHome();
  const state = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_state-')), 'roving-office');

  // `--publish` so there is something to write: it claims an office, which is what
  // dirties the registry, and it is the one thing that writes the endpoint file.
  const server = start(['--publish'], { home, env: { ROVING_OFFICE_STATE_DIR: state } });
  await server.ready;
  // The registry is written on a debounce, so a claim made at boot is not on disk
  // the instant the banner appears.
  await new Promise((r) => setTimeout(r, 900));
  try {
    assert.ok(existsSync(join(state, 'offices.json')), 'the registry followed the setting');
    // The directory is made on demand, so "not there" is the honest way to say the
    // registry never went near `$HOME`.
    assert.equal(existsSync(join(home, '.roving-office', 'offices.json')), false);
  } finally {
    server.child.kill('SIGTERM');
  }
});

test('the endpoint file stays where the adapters look for it', async () => {
  const home = freshHome();
  const state = join(mkdtempSync(join(tmpdir(), 'tmp_rovo_state-')), 'roving-office');
  const server = start(['--publish'], { home, env: { ROVING_OFFICE_STATE_DIR: state } });
  const port = await server.ready;
  try {
    // `bin/lib/aop-core.cjs` and friends build this path from `os.homedir()` and
    // nothing else. A server that wrote its endpoint somewhere else would leave every
    // hook on the machine posting into a file nobody reads, silently.
    const written = JSON.parse(readFileSync(join(home, '.roving-office', 'endpoint.json'), 'utf8'));
    assert.match(written.url, new RegExp(`127\\.0\\.0\\.1:${port}/office/`));
    assert.equal(existsSync(join(state, 'endpoint.json')), false, 'and only there');
  } finally {
    server.child.kill('SIGTERM');
  }
});
