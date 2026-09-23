// The emitter core's pure helpers: what a desk label may contain, how a path is
// made non-identifying, and which remote slug decides which room a repo walks
// into. Only the functions with no I/O are tested here — deriveProject and post
// shell out and belong to an integration tier.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const {
  CAPS, clamp, tidyPath, firstString, toIso, canonicalRemote, isLoopback,
} = require('../bin/lib/aop-core.cjs');

// --- clamp -------------------------------------------------------------------

test('clamp collapses whitespace and marks the cut', () => {
  assert.equal(clamp('  hello   world  ', 80), 'hello world');
  const cut = clamp('a'.repeat(100), 10);
  assert.equal(cut.length, 10);
  assert.ok(cut.endsWith('…'), 'a truncation must never look complete');
});

test('clamp turns nothing into undefined, not into an empty string', () => {
  assert.equal(clamp(null, 10), undefined);
  assert.equal(clamp('   ', 10), undefined);
  assert.equal(clamp('', 10), undefined);
});

test('a string exactly at the cap survives untouched', () => {
  assert.equal(clamp('abcde', 5), 'abcde');
});

// --- tidyPath ----------------------------------------------------------------

test('tidyPath makes a path relative to the session cwd when underneath it', () => {
  assert.equal(tidyPath('/work/repo/src/main.js', '/work/repo'), 'src/main.js');
  assert.equal(tidyPath('/work/repo', '/work/repo'), '.');
});

test('tidyPath falls back to ~ for paths under the home directory', () => {
  const home = os.homedir();
  assert.equal(tidyPath(`${home}/notes/secret.txt`, '/elsewhere'), '~/notes/secret.txt');
});

test('tidyPath caps at the target limit', () => {
  const long = `/x/${'d'.repeat(400)}`;
  assert.ok(tidyPath(long, null).length <= CAPS.target);
});

// --- firstString / toIso -----------------------------------------------------

test('firstString takes the first non-empty candidate, numbers included', () => {
  assert.equal(firstString(undefined, '', '  ', 'found', 'later'), 'found');
  assert.equal(firstString(null, 42), '42');
  assert.equal(firstString(), undefined);
});

test('toIso reads seconds, milliseconds and strings — both appear in the wild', () => {
  assert.equal(toIso(1700000000), '2023-11-14T22:13:20.000Z');
  assert.equal(toIso(1700000000000), '2023-11-14T22:13:20.000Z');
  assert.equal(toIso('2026-01-02T03:04:05Z'), '2026-01-02T03:04:05.000Z');
});

test('toIso answers now for garbage rather than throwing mid-hook', () => {
  for (const bad of ['not a date', null, undefined, NaN]) {
    assert.match(toIso(bad), /^\d{4}-\d{2}-\d{2}T/);
  }
});

// --- canonicalRemote ---------------------------------------------------------

test('ssh and https remotes canonicalise to the same slug', () => {
  const want = 'github.com/owner/repo';
  assert.equal(canonicalRemote('git@github.com:owner/repo.git'), want);
  assert.equal(canonicalRemote('https://github.com/owner/repo'), want);
  assert.equal(canonicalRemote('https://user@github.com/owner/repo.git'), want);
  assert.equal(canonicalRemote('ssh://git@github.com/owner/repo.git'), want);
});

test('canonicalRemote refuses what has no owner/repo shape', () => {
  assert.equal(canonicalRemote('not-a-remote'), null);
  assert.equal(canonicalRemote(''), null);
  assert.equal(canonicalRemote(null), null);
});

// --- isLoopback --------------------------------------------------------------

test('the whole of 127.0.0.0/8 is loopback, and localhost with it', () => {
  assert.ok(isLoopback('http://127.0.0.1:8080/x'));
  assert.ok(isLoopback('http://127.0.0.2:8080/x'));
  assert.ok(isLoopback('http://localhost:8080/'));
  assert.ok(isLoopback('http://[::1]:8080/'));
});

test('anything not plainly loopback is treated as remote', () => {
  assert.equal(isLoopback('https://office.example.com/aop'), false);
  assert.equal(isLoopback('http://192.168.1.10:8080/'), false);
  assert.equal(isLoopback('not a url'), false);
});
