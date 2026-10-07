// The machine's hooks go to one office, and the office asks for them when it wants
// live agents. A freshly minted office opens on Test Data and has a harness ticked on
// afterwards, in the source picker, so asking only at load never asks at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  location: { pathname: '/office/AAAA-1111/', search: '' },
  sessionStorage: { getItem: () => null, setItem: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
};

const scene = (sources) => ({ id: 'scene-1', name: null, sources, testDataPinned: false, look: {} });
const officeDoc = (sources) => ({ keycard: 'AAAA-1111', reserved: false, scenes: [scene(sources)] });

const calls = [];
let sources = ['test-data'];
globalThis.fetch = async (url, { method = 'GET', body } = {}) => {
  const path = new URL(url, 'http://office.test').pathname;
  calls.push(`${method} ${path}`);
  if (method === 'PATCH') sources = JSON.parse(body).sources;
  const doc = method === 'PATCH' ? scene(sources) : officeDoc(sources);
  return new Response(JSON.stringify(doc), { status: 200 });
};

const office = await import('../src/office/office.js');

test('ticking a harness on in an office that opened on Test Data takes the hooks', async () => {
  await office.loadOffice();
  assert.equal(await office.claimLocalEndpoint(), false, 'Test Data alone has no use for the feed');

  await office.setSceneSources('scene-1', ['claude-code']);

  assert.ok(calls.includes('POST /office/AAAA-1111/api/claim'), `no claim in ${calls.join(', ')}`);
});
