'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plan } = require('../bin/aop-cursor-install.cjs');
test('the Cursor installer adds every observer hook and preserves other hooks', () => {
  const { next } = plan({ version: 1, hooks: { stop: [{ command: 'keep-me' }] } });
  assert.equal(next.hooks.sessionStart.length, 1); assert.equal(next.hooks.preToolUse.length, 1); assert.equal(next.hooks.stop.length, 2);
  assert.match(next.hooks.stop.at(-1).command, /aop-send\.cjs" cursor stop$/);
});
test('uninstall only removes the office command', () => {
  const installed = plan({ version: 1, hooks: { stop: [{ command: 'keep-me' }] } }).next;
  const { next } = plan(installed, true);
  assert.deepEqual(next.hooks.stop, [{ command: 'keep-me' }]); assert.equal(next.hooks.sessionStart, undefined);
});
