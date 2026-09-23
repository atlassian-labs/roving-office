// What the emitter is allowed to put on the wire about *where the work is* — the
// repository it is in and the directory it is in — and, mostly, what it is not.
//
// This file exists because of a defect rather than a feature, found by an exposure
// review of what the emitter puts on the wire. `project.repo.remote` used to be the
// verbatim output
// of `git remote get-url origin`, and one entirely ordinary form of that output is
// `https://<user>:<token>@host/owner/repo` — so a contributor who cloned with a
// personal access token was posting it to the office, which then served it to every
// keycard holder over `/state` and `/stream`. The office is public. That is the whole
// bug, and it was a one-line omission: `canonicalRemote()` already existed and was
// used only to pick a room, never to sanitise the field.
//
// Two things follow for how it is tested, and both are the point:
//
//   1. **The assertion is about the whole event, not the field.** A test that only
//      checks `project.repo.remote` passes while the same credential rides along in
//      `session.cwd`, in a desk label, in `project.id`. So every case below searches
//      the serialised envelope for the secret, which is the only assertion that
//      matches what the reviewer was actually worried about.
//   2. **A malformed remote must not throw.** The stripping sits in the hook path, so
//      an exception there does not fail a field — it takes out event emission for the
//      whole session and the office quietly goes empty.
//
// `HOME` is redirected before aop-core is required: the module resolves
// `~/.roving-office` once at load, and the real one holds this machine's endpoint,
// settings and project cache. A test that wrote there would be editing the developer's
// own install, and `tidyPath`'s `~` collapse would be measured against the wrong home.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aop-wire-privacy-'));
const FAKE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(FAKE_HOME, { recursive: true });
process.env.HOME = FAKE_HOME;

const core = require('../bin/lib/aop-core.cjs');
const { canonicalRemote, wireRemote, wireSession, deriveProject } = core;

assert.equal(core.HOME, FAKE_HOME, 'the sandboxed home must be the one aop-core resolved');

process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const TOKEN = 'ghp_liveCredential0123456789';

// --- canonicalRemote: the userinfo cut ---------------------------------------

test('an https remote with a user and a token canonicalises to host/owner/repo', () => {
  assert.equal(
    canonicalRemote(`https://mike:${TOKEN}@bitbucket.org/atlassian/the-roving-office.git`),
    'bitbucket.org/atlassian/the-roving-office',
  );
});

test('a user with no token is stripped just the same', () => {
  assert.equal(
    canonicalRemote('https://mike@bitbucket.org/atlassian/the-roving-office.git'),
    'bitbucket.org/atlassian/the-roving-office',
  );
});

test('ssh, scp-like and plain https all reduce to one slug for one repository', () => {
  const want = 'bitbucket.org/atlassian/the-roving-office';
  assert.equal(canonicalRemote('git@bitbucket.org:atlassian/the-roving-office.git'), want);
  assert.equal(canonicalRemote('ssh://git@bitbucket.org/atlassian/the-roving-office.git'), want);
  assert.equal(canonicalRemote('https://bitbucket.org/atlassian/the-roving-office'), want);
  assert.equal(canonicalRemote('https://bitbucket.org/atlassian/the-roving-office.git'), want);
});

// The two shapes that a cut at the *first* `@` gets wrong, and the reason the cut is
// at the last one. Git carries a remote verbatim; it does not require the percent
// encoding a URL would, so a password with a `/` or an `@` in it arrives intact.
test('a password containing @ leaves nothing of itself behind', () => {
  const slug = canonicalRemote('https://mike:p@ssw0rd@bitbucket.org/atlassian/repo.git');
  assert.equal(slug, 'bitbucket.org/atlassian/repo');
  assert.ok(!slug.includes('ssw0rd'), 'a first-@ cut leaves the tail of the password in the slug');
});

test('a password containing a slash is declined rather than half-stripped', () => {
  const slug = canonicalRemote(`https://mike:to/${TOKEN}@bitbucket.org/atlassian/repo.git`);
  assert.equal(slug, 'bitbucket.org/atlassian/repo');
  assert.ok(!slug.includes(TOKEN));
});

test('canonicalRemote refuses what has no owner/repo shape, and never throws', () => {
  for (const bad of [
    'not-a-remote', '', null, undefined, '@', '://', 'https://', 'https://host',
    'https://user:pw@', '   ', 'https://user:pw@host', '/', '//', 'git@:',
  ]) {
    assert.doesNotThrow(() => canonicalRemote(bad), `threw on ${JSON.stringify(bad)}`);
    const slug = canonicalRemote(bad);
    assert.ok(slug === null || typeof slug === 'string');
    if (slug) assert.ok(!slug.includes('pw'), `${JSON.stringify(bad)} kept a credential`);
  }
});

test('a remote of an unusual shape survives being handed anything at all', () => {
  for (const weird of [
    {}, [], 42, true, `https://${'a'.repeat(5000)}/o/r`, 'https://host/o/r\n\n',
    'https://ho st/o/r', 'https://host/o/r?token=abc', 'https://host/o/r#frag',
    `https://host/o/r|${TOKEN}`,
  ]) {
    assert.doesNotThrow(() => canonicalRemote(weird), `threw on ${JSON.stringify(weird)}`);
    const slug = canonicalRemote(weird);
    if (slug) assert.ok(!slug.includes(TOKEN), `${JSON.stringify(weird)} kept a credential`);
  }
});

test('canonicalRemote is idempotent, so a slug re-canonicalised is the same slug', () => {
  const once = canonicalRemote(`https://mike:${TOKEN}@bitbucket.org/atlassian/repo.git`);
  assert.equal(canonicalRemote(once), once);
});

// --- wireRemote: what actually reaches project.repo.remote -------------------

test('wireRemote sends the canonical slug, not what the contributor cloned with', () => {
  assert.equal(
    wireRemote(`https://mike:${TOKEN}@bitbucket.org/atlassian/the-roving-office.git`),
    'bitbucket.org/atlassian/the-roving-office',
  );
  assert.equal(
    wireRemote('git@bitbucket.org:atlassian/the-roving-office.git'),
    'bitbucket.org/atlassian/the-roving-office',
  );
});

test('wireRemote sends nothing rather than something it could not reduce', () => {
  assert.equal(wireRemote('not-a-remote'), undefined);
  assert.equal(wireRemote(''), undefined);
  assert.equal(wireRemote(null), undefined);
});

test('a remote that is a directory is tidied as the path it is', () => {
  // A bare clone on a stick, or a sibling worktree: no host, no owner, no credential,
  // but an absolute path under $HOME is the local account name.
  assert.equal(wireRemote(`${FAKE_HOME}/mirrors/repo.git`), '~/mirrors/repo');
  assert.equal(wireRemote(`file://${FAKE_HOME}/mirrors/repo.git`), '~/mirrors/repo');
});

// --- wireSession: session.cwd ------------------------------------------------

test('session.cwd loses the account name and keeps its basename', () => {
  const out = wireSession({ id: 's1', kind: 'main', cwd: `${FAKE_HOME}/dev/roving-office` });
  assert.equal(out.cwd, '~/dev/roving-office');
  // Spec §3.2 gives `cwd` one job for a receiver — a fallback `project.id` from its
  // basename — and that has to still work after the tidying.
  assert.equal(path.basename(out.cwd), 'roving-office');
});

test('wireSession leaves everything but cwd exactly as the mapper wrote it', () => {
  const session = {
    id: 's1', parent_id: null, kind: 'main', label: 'the spec', agent_type: 'Plan',
    cwd: `${FAKE_HOME}/dev/repo`,
  };
  const out = wireSession(session);
  assert.deepEqual({ ...out, cwd: session.cwd }, session);
  assert.notEqual(out, session, 'the mapper still needs the absolute path it wrote');
  assert.equal(session.cwd, `${FAKE_HOME}/dev/repo`, 'and must not have it edited underneath it');
});

test('wireSession passes through a session with no cwd, or a broken one', () => {
  for (const s of [{ id: 's' }, { id: 's', cwd: '' }, { id: 's', cwd: 42 }, {}, null, undefined]) {
    assert.doesNotThrow(() => wireSession(s));
  }
  assert.equal(wireSession({ id: 's', cwd: '/opt/work/repo' }).cwd, '/opt/work/repo');
});

// --- deriveProject against a real repository ---------------------------------

/**
 * A throwaway checkout whose `origin` is whatever the caller asks for.
 *
 * Under the sandboxed `$HOME`, because that is where a real checkout lives and it is
 * what makes `session.cwd`'s `~` collapse observable — a repo beside the home
 * directory would be reported absolute, quite correctly, and prove nothing.
 */
function repoWithRemote(name, remote) {
  const dir = path.join(FAKE_HOME, 'checkouts', name);
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'trunk');
  git('remote', 'add', 'origin', remote);
  // A commit, because `rev-parse --abbrev-ref HEAD` has no answer on an unborn
  // branch and the branch is half of what `project.repo` is being checked for.
  fs.writeFileSync(path.join(dir, 'README.md'), '# throwaway\n');
  git('add', 'README.md');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'first');
  return dir;
}

test('deriveProject puts the slug on the project, and never the credential', () => {
  const dir = repoWithRemote('tokened', `https://mike:${TOKEN}@bitbucket.org/atlassian/the-roving-office.git`);
  const project = deriveProject(dir);

  assert.equal(project.repo.remote, 'bitbucket.org/atlassian/the-roving-office');
  assert.equal(project.repo.branch, 'trunk', 'the rest of the project is unchanged');
  assert.equal(project.id, 'the-roving-office');
  assert.equal(project.name, 'the-roving-office');
  assert.ok(!JSON.stringify(project).includes(TOKEN));

  // The cache is a file on a contributor's machine and outlives a release, so a
  // second call — which is a cache *hit* — must answer the same narrowed thing.
  assert.deepEqual(deriveProject(dir), project);
  assert.ok(!fs.readFileSync(core.PROJECT_CACHE, 'utf8').includes(TOKEN),
    'a credential must not be at rest in the project cache either');
});

test('a project cache written by an older build is not served to an office', () => {
  const dir = path.join(SANDBOX, 'stale-cache-repo');
  fs.mkdirSync(dir, { recursive: true });
  const verbatim = `https://mike:${TOKEN}@bitbucket.org/atlassian/the-roving-office.git`;
  const cache = JSON.parse(fs.readFileSync(core.PROJECT_CACHE, 'utf8'));
  // Exactly what the previous version wrote: fresh, unversioned, remote verbatim.
  cache[dir] = {
    at: Date.now(),
    project: { id: 'the-roving-office', name: 'the-roving-office', repo: { remote: verbatim, branch: 'trunk' } },
  };
  fs.writeFileSync(core.PROJECT_CACHE, `${JSON.stringify(cache)}\n`);

  const project = deriveProject(dir);
  assert.ok(!JSON.stringify(project ?? {}).includes(TOKEN), 'the stale entry was served verbatim');
});

test('an ssh checkout and an https checkout of one repo report the same remote', () => {
  const ssh = deriveProject(repoWithRemote('via-ssh', 'git@bitbucket.org:atlassian/twins.git'));
  const https = deriveProject(repoWithRemote('via-https', 'https://bitbucket.org/atlassian/twins'));
  assert.equal(ssh.repo.remote, 'bitbucket.org/atlassian/twins');
  assert.deepEqual(ssh.repo, https.repo);
});

test('a malformed remote costs the field, not the project', () => {
  const project = deriveProject(repoWithRemote('malformed', 'https://user:pw@'));
  assert.ok(project, 'a repo with an unreadable remote still walks into an office');
  assert.equal(project.repo?.remote, undefined);
  assert.equal(project.repo.branch, 'trunk');
  assert.ok(!JSON.stringify(project).includes('pw'));
});

// --- the other wire boundary: the openclaw bridge ----------------------------

test('the openclaw bridge tidies cwd on its own envelopes too', async () => {
  // Two emitters, two envelope builders, one wire. The bridge is a long-lived
  // in-process publisher rather than a hook process, so it does not go through
  // `bin/aop-send.cjs` at all — a fix applied only there would leave every OpenClaw
  // install sending the same thing it always did.
  const { Publisher } = await import('../openclaw-plugin/lib/publisher.mjs');
  const pub = new Publisher({ harness: { name: 'openclaw' }, lingerMs: 60_000 });
  const cwd = path.join(FAKE_HOME, 'checkouts', 'bridge');
  fs.mkdirSync(cwd, { recursive: true });

  pub.publish({ type: 'session.start', session: { id: 'oc-1', kind: 'main', cwd }, payload: {} });
  pub.stopped = true;

  assert.equal(pub.queue.length, 1);
  const envelope = JSON.parse(pub.queue[0]);
  assert.equal(envelope.session.cwd, '~/checkouts/bridge');
  assert.ok(!pub.queue[0].includes(FAKE_HOME));
});

// --- end to end: the process, a receiver, and a checkout with a token --------

/**
 * Drive `bin/aop-send.cjs` exactly as a Claude Code hook does — payload on stdin,
 * harness and event as argv — against a receiver that records what arrives.
 *
 * The unit tests above assert about functions; this asserts about the bytes. The
 * fields in question are attached by the *envelope* rather than by a mapper, so a
 * fix applied one layer too low would leave every test above green and the wire
 * unchanged.
 *
 * Asynchronously, and that is not a style choice: the receiver is this process, so
 * blocking on the child — `spawnSync` — is a deadlock. The hook POSTs to a server
 * whose event loop is the one waiting for the hook, the POST times out against its
 * own watchdog, and the events land in the spool instead of the assertion. Which
 * reads exactly like a passing emitter that sends nothing.
 */
function emitted(cwd, payloads) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push(body); res.writeHead(204); res.end(); });
  });

  const fire = (port, event, payload) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(__dirname, '..', 'bin', 'aop-send.cjs'), 'claude-code', event,
    ], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: {
        ...process.env,
        HOME: FAKE_HOME,
        AOP_URL: `http://127.0.0.1:${port}/aop/v0/events`,
        AOP_TOKEN: 'test-token',
        ROVING_OFFICE_REDACTION: 'metadata',
      },
      cwd,
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`aop-send exited ${code}: ${stderr}`));
      else resolve();
    });
    child.stdin.end(JSON.stringify(payload));
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        for (const [event, payload] of payloads) await fire(port, event, payload);
      } catch (err) { server.close(); reject(err); return; }
      server.close(() => resolve(received.join('\n')));
    });
  });
}

test('a hook fired in a checkout with a tokened remote posts no credential', async () => {
  const cwd = repoWithRemote('end-to-end', `https://mike:${TOKEN}@bitbucket.org/atlassian/the-roving-office.git`);
  const session = 'e2e-session-1';
  // The mapper holds the introduction until there is something to introduce, so a
  // `SessionStart` on its own emits nothing at all — the sequence is the fixture.
  const raw = await emitted(cwd, [
    ['SessionStart', { session_id: session, cwd, hook_event_name: 'SessionStart', source: 'startup', transcript_path: `${cwd}/t.jsonl` }],
    ['UserPromptSubmit', { session_id: session, cwd, prompt: 'Fix the parser', prompt_id: 'p1' }],
    ['PreToolUse', { session_id: session, cwd, tool_name: 'Read', tool_use_id: 'c1', tool_input: { file_path: `${cwd}/src/config.js` } }],
  ]);

  assert.ok(raw.length, 'the receiver got nothing at all — the harness would be silent');
  assert.ok(!raw.includes(TOKEN), `the credential is on the wire:\n${raw}`);
  assert.ok(!raw.includes('mike:'), 'and neither is the userinfo it sat in');

  const events = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const start = events.find((e) => e.type === 'session.start');
  assert.ok(start, 'session.start must still be emitted');
  assert.equal(start.project.repo.remote, 'bitbucket.org/atlassian/the-roving-office');
  assert.equal(start.project.id, 'the-roving-office');
  assert.equal(start.project.repo.branch, 'trunk');
  assert.equal(start.session.cwd, '~/checkouts/end-to-end');
  assert.ok(!raw.includes(FAKE_HOME), 'the absolute path — and so the account name — is gone');
  assert.equal(start.aop, core.AOP_VERSION);
  assert.equal(start.harness.name, 'claude-code');

  // The event shape is otherwise untouched: same keys, same types, same order of
  // business. This fix narrows two strings and must not be visible anywhere else.
  assert.deepEqual(
    Object.keys(start).sort(),
    ['aop', 'harness', 'id', 'payload', 'project', 'seq', 'session', 'ts', 'type'],
  );
  assert.ok(events.some((e) => e.type === 'tool.start'), 'the tool call still arrives');
  for (const e of events) {
    assert.equal(e.project.repo.remote, 'bitbucket.org/atlassian/the-roving-office');
    assert.equal(e.session.cwd, start.session.cwd);
  }
});
