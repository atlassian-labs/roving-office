import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stubPage } from './lib/dom.js';

// The arrival invitation, and the one thing that ends it early. It sits over the strips
// along the bottom of the screen, so it has to yield to a panel however that panel came
// to be open — including a reload that restored one (see test/panel-state.test.js).
const { byId, document } = stubPage();

/**
 * A MutationObserver the test can fire by hand.
 *
 * Node has none, and the stub page's `classList` notifies nothing, so a browser's own
 * "the class changed" is the one thing that has to be acted out here: change the class,
 * then ring the observer, which is the order a browser does it in.
 */
const observers = [];
globalThis.MutationObserver = class {
  constructor(fn) { this.fn = fn; this.targets = []; observers.push(this); }
  observe(target) { this.targets.push(target); }
  disconnect() { this.targets = []; }
};

/** Every panel appearing rings every live observer, as a class change would. */
const somethingChanged = () => { for (const o of observers) if (o.targets.length) o.fn([]); };

const { createWelcomeHint } = await import('../src/ui/welcome-hint.js');

/** The panels the hint watches, plus the overlay it is appended to. */
const PANELS = [
  'scene-panel', 'dev-panel', 'editor-panel', 'inspector',
  'source-picker', 'shortcuts-panel', 'keycard-dialog',
];

function page({ chrome } = {}) {
  byId.clear();
  observers.length = 0;
  document.body.dataset.chrome = chrome;
  byId.set('ui', document.createElement('div'));
  for (const id of [...PANELS, 'agent-panel']) {
    const host = document.createElement('div');
    // The roster ships open; every panel ships closed, as index.html has them.
    if (id !== 'agent-panel') host.className = 'hidden';
    byId.set(id, host);
  }
  return {
    ui: byId.get('ui'),
    /** Open a panel the way its own show() does, then let the page notice. */
    open(id) { byId.get(id).classList.remove('hidden'); somethingChanged(); },
  };
}

/** Is the invitation in the overlay? */
const onScreen = (ui) => ui.children.some((c) => c.className?.includes('welcome-hint'));

const crossIn = (ui) => ui.children
  .find((c) => c.className?.includes('welcome-hint'))
  ?.children.find((c) => c.className === 'welcome-close');

test('on an ordinary arrival it shows, roster and all', () => {
  const { ui } = page();
  const hint = createWelcomeHint();
  assert.ok(hint, 'the hint should have been built');
  assert.equal(hint.isShowing, true);
  assert.equal(onScreen(ui), true);
  hint.dismiss();
});

// The roster is open on arrival and in the opposite corner of the screen. Counting it
// would mean the invitation never appeared at all, which is the feature deleted rather
// than fixed.
test('the agents roster being open is not a reason to stay away', () => {
  const { ui } = page();
  assert.equal(byId.get('agent-panel').classList.contains('hidden'), false);
  const hint = createWelcomeHint();
  assert.equal(onScreen(ui), true);
  hint.dismiss();
});

test('opening any panel puts it away, whichever one it is', () => {
  for (const id of PANELS) {
    const p = page();
    const hint = createWelcomeHint();
    assert.equal(hint.isShowing, true, id);

    p.open(id);
    assert.equal(hint.isShowing, false, `${id} should have dismissed the hint`);
    assert.equal(onScreen(p.ui), false, `${id} should have removed it from the overlay`);
  }
});

// This PR's own doing: panel state is restored on load, so a room whose Scene strip was
// left open arrives with a panel already on screen and there is no moment to invite
// anybody into. Decided at creation, not only watched for afterwards.
test('a reload into a remembered-open panel never shows it', () => {
  for (const id of PANELS) {
    const p = page();
    byId.get(id).classList.remove('hidden');
    assert.equal(createWelcomeHint(), null, `${id} was already open`);
    assert.equal(onScreen(p.ui), false, id);
  }
});

test('a panel closing again does not bring it back', () => {
  const p = page();
  const hint = createWelcomeHint();
  p.open('scene-panel');
  assert.equal(hint.isShowing, false);

  byId.get('scene-panel').classList.add('hidden');
  somethingChanged();
  assert.equal(hint.isShowing, false, 'dismissed is dismissed');
  assert.equal(onScreen(p.ui), false);
});

// Unchanged by all of the above, and worth saying so: the two ways it always left.
test('its own × still dismisses it', () => {
  const p = page();
  const hint = createWelcomeHint();
  const cross = crossIn(p.ui);
  assert.ok(cross, 'the hint should carry its own ×');
  assert.equal(cross.getAttribute('aria-label'), 'Dismiss welcome hint');
  cross.click();
  assert.equal(hint.isShowing, false);
  assert.equal(onScreen(p.ui), false);
});

test('and it still leaves on its own', () => {
  const p = page();
  const hint = createWelcomeHint();
  // The fade is 20s of real time, so this proves the timer is armed rather than
  // waiting for it: dismissing disarms it, and a second dismissal is a no-op.
  assert.equal(hint.isShowing, true);
  hint.dismiss();
  assert.equal(hint.isShowing, false);
  hint.dismiss();
  assert.equal(onScreen(p.ui), false);
});

// Unchanged: an embed that has asked for less chrome gets no invitation at all.
test('a chrome-restricted embed is left alone', () => {
  for (const chrome of ['none', 'minimal']) {
    const p = page({ chrome });
    assert.equal(createWelcomeHint(), null, chrome);
    assert.equal(onScreen(p.ui), false, chrome);
  }
});

// The dismissal is per page load on purpose: he asked for it to yield to an opened
// panel, not to be remembered. Nothing here writes to storage, and the next arrival
// with nothing open is greeted again.
test('the dismissal is not remembered — the next arrival is greeted again', () => {
  const first = page();
  createWelcomeHint().dismiss();
  assert.equal(onScreen(first.ui), false);

  const second = page();
  const greeted = createWelcomeHint();
  assert.equal(greeted?.isShowing, true);
  assert.equal(onScreen(second.ui), true);
  // Dismissed rather than left to fade: an armed 20-second timer holds the test
  // runner's event loop open for the whole twenty.
  greeted.dismiss();
});
