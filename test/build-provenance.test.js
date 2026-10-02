// What the running office says about itself, and the honesty of it when nobody stamped it.
//
// `GET /api/health` reports a `build` object, assembled once at startup from environment
// variables `Dockerfile.fly` sets out of `--build-arg` values. The whole point of the
// field is that a stranger with curl can tell what is live and how it got there, so the
// cases worth pinning down are the three answers it can give — stamped by the workflow,
// stamped by hand, and never stamped at all — plus the thing that would quietly ruin it:
// a default that looks like a real answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;

/**
 * A server on its own `HOME` and state directory, with build variables injected.
 *
 * Its own `HOME` for the reason server-startup.test.js gives: there is one
 * `endpoint.json` per machine and a test has no business touching the developer's.
 * `--publish` is deliberately absent.
 */
function start({ port, env = {} }) {
  const home = mkdtempSync(join(tmpdir(), 'tmp_rovo_build-'));
  mkdirSync(join(home, '.roving-office'), { recursive: true });
  const child = spawn(process.execPath, ['server.cjs', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: home,
      PORT: '',
      ROVING_OFFICE_STATE_DIR: join(home, 'state'),
      // Cleared rather than omitted: the developer's own shell may have these set, and a
      // test that passes because of the environment it inherited is not a test.
      ROVING_OFFICE_GIT_SHA: '',
      ROVING_OFFICE_GIT_DIRTY: '',
      ROVING_OFFICE_DEPLOY_SOURCE: '',
      ROVING_OFFICE_DEPLOY_RUN: '',
      ROVING_OFFICE_BUILD_TIME: '',
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

const healthOf = async (base) => (await (await fetch(`${base}/api/health`)).json()).build;

test('an unstamped server says so rather than guessing', async (t) => {
  const server = start({ port: 8271 });
  t.after(() => server.child.kill());
  await server.ready;

  const build = await healthOf(server.base);
  assert.equal(build.source, 'unknown', 'not a plausible-looking default');
  assert.equal(build.commit, null);
  assert.equal(build.run, null);
  assert.equal(build.builtAt, null);
  // Three states, not two: nobody said, versus a stamped image reporting a clean tree.
  assert.equal(build.dirty, null, 'no commit means the tree state is unknown, not clean');
  // The one thing it can always answer, because it is read from the file beside it.
  assert.equal(build.version, version);
});

test('a workflow deploy is identifiable as one, and names its run', async (t) => {
  const sha = 'a'.repeat(40);
  const run = 'https://github.com/atlassian-labs/roving-office/actions/runs/123';
  const server = start({
    port: 8272,
    env: {
      ROVING_OFFICE_GIT_SHA: sha,
      ROVING_OFFICE_DEPLOY_SOURCE: 'github-actions',
      ROVING_OFFICE_DEPLOY_RUN: run,
      ROVING_OFFICE_BUILD_TIME: '2026-10-02T12:00:00Z',
    },
  });
  t.after(() => server.child.kill());
  await server.ready;

  const build = await healthOf(server.base);
  assert.equal(build.source, 'github-actions');
  assert.equal(build.commit, sha);
  assert.equal(build.run, run, 'traceable back to the log that produced it');
  assert.equal(build.builtAt, '2026-10-02T12:00:00Z');
  assert.equal(build.dirty, false, 'a commit with no dirty flag is a clean tree');
});

test('a hand-run deploy from a dirty tree is visibly from a dirty tree', async (t) => {
  const server = start({
    port: 8273,
    env: {
      ROVING_OFFICE_GIT_SHA: 'b'.repeat(40),
      ROVING_OFFICE_GIT_DIRTY: '1',
      ROVING_OFFICE_DEPLOY_SOURCE: 'local',
    },
  });
  t.after(() => server.child.kill());
  await server.ready;

  const build = await healthOf(server.base);
  assert.equal(build.source, 'local', 'distinguishable from the workflow');
  assert.equal(build.dirty, true, 'the commit alone would name a tree that never shipped');
  // Nothing pretends a run URL exists for a deploy that had no run.
  assert.equal(build.run, null);
});

test('the build is reported beside the counts, not behind the local-only gate', async (t) => {
  const server = start({ port: 8274, env: { ROVING_OFFICE_DEPLOY_SOURCE: 'github-actions' } });
  t.after(() => server.child.kill());
  await server.ready;

  const body = await (await fetch(`${server.base}/api/health`)).json();
  // `claimed` is gated on a loopback caller because a keycard is a read capability. The
  // build is not, and this asserts the pair stay in the same response: a commit hash in
  // a public repository is already public, and a field only its own host can read would
  // answer nobody's question about what is live.
  assert.equal(typeof body.offices, 'number');
  assert.ok(Number.isFinite(body.maxOffices));
  assert.equal(body.build.source, 'github-actions');
});

test('the deploy script and the workflow stamp the same variables', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const recipe = read('../Dockerfile.fly');
  const workflow = read('../.github/workflows/deploy.yml');
  const script = read('../bin/fly-deploy.sh');

  // A build arg the recipe does not declare is silently discarded by the builder, and a
  // variable the recipe declares that nothing passes is a field that is never populated.
  // Either way the failure is invisible in a deploy log, which is why this is a test.
  for (const arg of ['GIT_SHA', 'DEPLOY_SOURCE', 'BUILD_TIME']) {
    assert.match(recipe, new RegExp(`^ARG ${arg}=`, 'm'), `Dockerfile.fly declares ${arg}`);
    assert.ok(workflow.includes(`${arg}=`), `the workflow passes ${arg}`);
    assert.ok(script.includes(`${arg}=`), `bin/fly-deploy.sh passes ${arg}`);
  }
  // GIT_DIRTY is the one asymmetry, and it is deliberate: a runner's checkout is the
  // commit it was given, so claiming to have inspected the tree would be a check nobody
  // ran. The script, which deploys whatever is on disk, is where it means something.
  assert.match(recipe, /^ARG GIT_DIRTY=/m);
  assert.ok(script.includes('GIT_DIRTY='), 'the hand-run route reports tree state');
  assert.ok(!workflow.includes('GIT_DIRTY='), 'the workflow does not claim a tree check');

  // Every ARG the recipe declares is turned into an ENV, or the running process cannot
  // see it however carefully the deploy passed it.
  for (const [, name] of recipe.matchAll(/^ARG (\w+)=/gm)) {
    assert.match(
      recipe,
      new RegExp(`^ENV ROVING_OFFICE_\\w+=\\$${name}$`, 'm'),
      `${name} reaches the process as an environment variable`,
    );
  }
});
