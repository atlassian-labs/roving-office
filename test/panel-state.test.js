import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { stubPage } from './lib/dom.js';

// What the room remembers about its own arrangement. Two halves: the store itself,
// which is a thin thing over src/local-store.js and has to survive junk and refusal,
// and the panels, which are built against `document` — so this borrows the shared page
// out of test/lib/dom.js the way test/panel-close.test.js does.
const { byId, document } = stubPage();

const { recallPanel, rememberPanel } = await import('../src/ui/panel-state.js');
const { createDevPanel } = await import('../src/ui/dev-panel.js');

const KEY = 'roving-office.panels.v1';

const store = new Map();
const storage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
};

/** A browser that will not remember anything: private mode, a locked-down embed. */
const refusing = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

/** The panels build themselves into whatever host the markup would have carried. */
function host(id) {
  const el = document.createElement('div');
  el.className = 'hidden';
  byId.set(id, el);
  return el;
}

const camera = { position: { x: 26, y: 25, z: 26 }, zoom: 1 };
const controls = { target: { x: 12, y: 1.5, z: 10 } };

// The developer panel is the one of the two strips that a stubbed page can build: the
// scene panel draws a compass and a sun map onto canvases, which want a 2D context and
// a computed style the shared page deliberately has none of. Both are the same strip
// wearing different contents (see src/ui/strip.js) and both remember themselves through
// the same two calls, so what is proved here holds for the scene panel too — and the
// scene panel was checked in a real browser, which is the only place it draws at all.
const devPanel = () => createDevPanel({ camera, controls, onPhoto: async () => true });

beforeEach(() => {
  store.clear();
  byId.clear();
});

test('a panel is remembered open or closed, and the two do not disturb each other', () => {
  assert.equal(rememberPanel('dev-panel', true, storage), true);
  assert.equal(rememberPanel('scene-panel', false, storage), true);

  assert.equal(recallPanel('dev-panel', false, storage), true);
  assert.equal(recallPanel('scene-panel', true, storage), false);

  // One entry for the whole arrangement, not one per panel.
  assert.deepEqual(JSON.parse(store.get(KEY)), { 'dev-panel': true, 'scene-panel': false });
});

test('a panel nobody has stored opens the way the app ships', () => {
  assert.equal(recallPanel('agent-panel', true, storage), true);
  assert.equal(recallPanel('dev-panel', false, storage), false);
});

test('junk in the entry is the shipped arrangement rather than a boot failure', () => {
  const cases = ['{not json', '[]', '"closed"', 'null', JSON.stringify({ 'dev-panel': 'yes' })];
  for (const raw of cases) {
    store.set(KEY, raw);
    assert.equal(recallPanel('dev-panel', false, storage), false, raw);
    assert.equal(recallPanel('agent-panel', true, storage), true, raw);
  }
});

// The reason the memory goes through local-store.js at all: private browsing throws,
// and a panel that cannot be remembered still has to open.
test('a browser that refuses to remember still answers with the default', () => {
  assert.equal(rememberPanel('dev-panel', true, refusing), false);
  assert.equal(recallPanel('dev-panel', false, refusing), false);
  assert.equal(recallPanel('agent-panel', true, refusing), true);
});

test('writing one panel does not lose the panel written before it', () => {
  rememberPanel('dev-panel', true, storage);
  rememberPanel('agent-panel', false, storage);
  assert.equal(recallPanel('dev-panel', false, storage), true);
  assert.equal(recallPanel('agent-panel', true, storage), false);
});

// --- The panels themselves -------------------------------------------------
// Built against the real `localStorage` the app uses, so these drive it through
// `globalThis.window` rather than handing a shim down: the point is that the panel
// reaches for the same store on the way up as it wrote to on the way down.

/** Stand a remembering `localStorage` on the stubbed window. */
function shelf(entries = {}) {
  store.clear();
  if (Object.keys(entries).length) store.set(KEY, JSON.stringify(entries));
  globalThis.window.localStorage = storage;
}

test('the developer panel comes back open, and comes back closed', () => {
  shelf({ 'dev-panel': true });
  const opened = host('dev-panel');
  assert.equal(devPanel().isOpen, true);
  assert.equal(opened.classList.contains('hidden'), false);

  shelf({ 'dev-panel': false });
  const closed = host('dev-panel');
  assert.equal(devPanel().isOpen, false);
  assert.equal(closed.classList.contains('hidden'), true);
});

test('the developer panel ships closed for a browser with nothing stored', () => {
  shelf();
  host('dev-panel');
  assert.equal(devPanel().isOpen, false);
});

test('closing the developer panel is what gets written down', () => {
  shelf();
  host('dev-panel');
  const panel = devPanel();

  panel.toggle();
  assert.equal(recallPanel('dev-panel', false, storage), true);
  panel.toggle();
  assert.equal(recallPanel('dev-panel', true, storage), false);
});

// Opening the office reads the arrangement; it must not write it back, or a version
// that changed a default could never change one again.
test('building a panel writes nothing', () => {
  shelf();
  host('dev-panel');
  devPanel();
  assert.equal(store.has(KEY), false);
});

// The × goes through the panel's own `hide`, so the mouse and the key write the same
// thing down — the failure this guards against is a strip that only remembers the key.
test('the panel\'s own × is remembered too', () => {
  shelf({ 'dev-panel': true });
  const el = host('dev-panel');
  devPanel();

  const cross = el.children.find((c) => c.className?.includes('panel-close'));
  assert.ok(cross, 'the strip should carry a close button');
  cross.click();
  assert.equal(el.classList.contains('hidden'), true);
  assert.equal(recallPanel('dev-panel', true, storage), false);
});

test('a panel in a browser that refuses to remember still opens and closes', () => {
  store.clear();
  globalThis.window.localStorage = refusing;
  const el = host('dev-panel');
  const panel = devPanel();
  assert.equal(panel.isOpen, false);
  panel.toggle();
  assert.equal(panel.isOpen, true);
  assert.equal(el.classList.contains('hidden'), false);
  panel.toggle();
  assert.equal(panel.isOpen, false);
});
