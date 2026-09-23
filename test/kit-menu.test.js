// The Add-item menu, driven without a browser.
//
// There is no DOM library here, so this drives the menu against the stubbed page in
// test/lib/dom.js — the same approach `panel-close.test.js` takes for the same reason.
// That is not only cheaper than a real browser: headless Chrome in this sandbox crashed
// three times while I was trying to click these tabs by hand, and a check that flakes on
// the harness rather than the code is worse than no check.
//
// Alone among the pages the suite stubs, this one has to be told where things are and
// has to keep `document`'s click listener: the sheet is placed against the trigger's
// corner and its own height, and it shuts itself from a click that reached the page.
//
// What is worth pinning here is the wiring, because the two bugs this control has had
// were both wiring rather than logic: a tab predicate handed the wrong argument, and a
// click-outside test that did not know the sheet had been re-parented and so shut the
// menu the instant you touched a tab.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { all, stubPage } from './lib/dom.js';

/** The height `.kit-sheet` is given in styles.css. */
const SHEET_H = 420;
/** And its width, which went half again as wide for the species strip. */
const SHEET_W = 510;

/** Where the trigger sits. Reassigned by the test about placing the sheet. */
let triggerRect = { left: 40, top: 900, right: 130, bottom: 922, width: 90, height: 22 };

let createKitMenu, groupKit, KIT_TABS;

before(async () => {
  stubPage({
    documentEvents: ['click'],
    // Every element answers with the trigger's corner, because the trigger is the only
    // one the menu ever asks about.
    rectOf: () => ({ ...triggerRect }),
    heightOf: (el) => (el.className?.includes?.('kit-sheet') ? SHEET_H : 0),
    widthOf: (el) => (el.className?.includes?.('kit-sheet') ? SHEET_W : 0),
  });
  ({ createKitMenu, groupKit, KIT_TABS } = await import('../src/editor/kit-menu.js'));
});

const ITEMS = [
  { key: 'furniture:couch', label: 'Couch', roles: [], note: null, full: false },
  { key: 'desk', label: 'Desk', roles: [], note: null, full: false },
  { key: 'station:inbox', label: 'Inbox', roles: ['intake'], note: null, full: false },
  { key: 'station:mailbox', label: 'Mailbox', roles: ['intake', 'dispatch'], note: 'One queue.', full: true },
  { key: 'station:bookshelf', label: 'Bookshelf', roles: ['research'], note: null, full: false },
  { key: 'plant:fig', label: 'Fig', roles: [], note: null, full: false },
  { key: 'station:waterCooler', label: 'Water cooler', roles: ['refresh'], note: null, full: false },
  { key: 'station:bin', label: 'Bin', roles: ['discard'], note: null, full: false },
  { key: 'station:printer', label: 'Printer', roles: [], note: 'No job yet.', full: false },
];

const STATE = {
  required: ['census', 'intake', 'research', 'dispatch'],
  covered: { census: ['Coat stand'], intake: ['Mailbox'], research: ['Bookshelf'], dispatch: ['Mailbox'] },
  verbs: { intake: 'collect work from', dispatch: 'deliver finished work', research: 'look things up', census: 'hang a coat' },
};

const withClass = (node, name) => all(node).filter((n) => n.classList?.contains(name));
const texts = (node, name) => withClass(node, name).map((n) => n.textContent);

let menu;
let added;
let flipped;
let chose;

beforeEach(() => {
  // A fresh page each time. Without this, a test that leaves the menu open strands its
  // sheet on the shared body and the next test's lookup finds that one instead — which
  // is exactly the sort of cross-test bleed that makes a suite lie in both directions.
  globalThis.document.body.children = [];
  added = [];
  flipped = [];
  chose = [];
  menu = createKitMenu({
    onPick: (key) => added.push(key),
    onToggle: (key, on) => flipped.push([key, on]),
    onOption: (key, value) => chose.push([key, value]),
  });
  menu.setKit(groupKit(ITEMS, STATE), { courier: true });
});

/** The sheet, which lives on document.body rather than inside the menu. */
const sheet = () => globalThis.document.body.children
  .find((c) => c.classList?.contains('kit-sheet'));

// --- tabs --------------------------------------------------------------------

test('the tabs are the ones asked for, in the order asked for', () => {
  assert.deepEqual(KIT_TABS, ['Furniture', 'Desks', 'Jobs', 'Plants', 'Other']);
});

test('opening shows the first tab, not everything at once', () => {
  menu.el.children[0].click();          // the trigger
  const open = sheet();
  assert.ok(open, 'the sheet should be on the body');
  assert.deepEqual(texts(open, 'kit-tab'), ['Furniture', 'Desks', 'Jobs', 'Plants', 'Other']);
  assert.deepEqual(texts(open, 'kit-head-name'), ['Comfort']);
  assert.deepEqual(texts(open, 'kit-row-name'), ['Couch']);
});

test('each tab shows its own sections and nothing else', () => {
  menu.el.children[0].click();
  const seen = {};
  for (const name of KIT_TABS) {
    withClass(sheet(), 'kit-tab').find((t) => t.textContent === name).click();
    seen[name] = {
      heads: texts(sheet(), 'kit-head-name'),
      rows: texts(sheet(), 'kit-row-name'),
    };
  }
  assert.deepEqual(seen.Desks.heads, ['Workstations']);
  assert.deepEqual(seen.Desks.rows, ['Desk']);
  assert.deepEqual(seen.Jobs.heads, ['Delivery & collection']);
  // Addable first, then the full kind that is doing the job, then the switch.
  assert.deepEqual(seen.Jobs.rows, ['Inbox', 'Delivery person', 'Bird post', 'Mailbox']);
  assert.deepEqual(seen.Plants.rows, ['Fig']);
  assert.deepEqual(seen.Other.heads, ['Research', 'Who is here', 'Breaks', 'Waste', 'No job yet']);
  assert.ok(seen.Other.rows.includes('Bookshelf'));
  assert.ok(seen.Other.rows.includes('Printer'), 'the jobless station has somewhere to be');
});

test('clicking a tab does not shut the menu', () => {
  // The bug this pins: the sheet hangs off document.body, so a click-outside test that
  // only asked whether the *menu* contained the target shut it on every tab press —
  // and then re-rendered into a sheet it had just removed, so the tab looked empty.
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  assert.ok(sheet(), 'the sheet should still be there');
  assert.deepEqual(texts(sheet(), 'kit-head-name'), ['Delivery & collection']);
});

test('the tab holding an uncovered job wears a dot', () => {
  const bare = { ...STATE, covered: { ...STATE.covered, census: [] } };
  menu.setKit(groupKit(ITEMS, bare), { courier: true });
  menu.el.children[0].click();
  const wanting = withClass(sheet(), 'kit-tab').filter((t) => t.classList.contains('wanting'));
  assert.deepEqual(wanting.map((t) => t.textContent), ['Other'],
    'census lives under Other, so that is the tab that should ask for attention');
});

// --- what the rows do --------------------------------------------------------

test('picking a row adds that kind and closes the sheet', () => {
  menu.el.children[0].click();
  const couch = withClass(sheet(), 'kit-row').find((r) => texts(r, 'kit-row-name')[0] === 'Couch');
  couch.click();
  assert.deepEqual(added, ['furniture:couch']);
  assert.equal(sheet(), undefined, 'an add is one gesture, so the sheet gets out of the way');
});

test('a full kind explains itself and cannot be picked', () => {
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  const mailbox = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Mailbox');
  assert.ok(mailbox.classList.contains('kit-row-static'), 'it is an explanation, not an offer');
  mailbox.click();
  assert.deepEqual(added, [], 'clicking an explanation should add nothing');
});

// --- the switch --------------------------------------------------------------

/** The checkbox behind a switch's track, which is what a person's click reaches. */
const switchIn = (toggle) => withClass(toggle, 'ui-toggle')[0]
  .children.find((c) => c.type === 'checkbox');

/** Flip it the way a browser does: set the state, then fire the change. */
const flip = (toggle, on) => {
  const input = switchIn(toggle);
  input.checked = on;
  input.fire('change');
};

test('the courier is a switch, and it reports its state', () => {
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  const toggle = withClass(sheet(), 'kit-row-toggle')[0];
  assert.ok(toggle, 'the Jobs tab should carry the switch');
  // The same control as Paths along the panel: a native checkbox behind a track, which
  // is what keeps Space, focus and checked state in step without any of this code.
  const input = switchIn(toggle);
  assert.ok(input, 'the switch should be a real checkbox');
  assert.equal(input.getAttribute('role'), 'switch');
  assert.equal(input.checked, true);
  assert.deepEqual(texts(toggle, 'ui-toggle-label'), ['On']);
  // And a label, not a button, so a click anywhere along the row reaches the checkbox.
  assert.equal(toggle.tagName, 'LABEL');
});

test('flipping it asks for the opposite, and leaves the sheet open', () => {
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  flip(withClass(sheet(), 'kit-row-toggle')[0], false);
  assert.deepEqual(flipped, [['courier', false]]);
  assert.ok(sheet(), 'a switch is something you might flip twice');
});

test('flipping it while the sheet is open repaints the switch', () => {
  // The sequence the app actually performs and no test covered: the sheet stays open on
  // a flip (deliberately — a switch is something you might press twice), so the *open*
  // sheet has to show the new state. Every other test here set the kit and then opened,
  // which cannot catch a live sheet that never refreshes.
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  flip(withClass(sheet(), 'kit-row-toggle')[0], false);

  // What the editor does next: commit, then paint, then hand the menu the new channels.
  menu.setKit(groupKit(ITEMS, STATE), { courier: false });

  const toggle = withClass(sheet(), 'kit-row-toggle')[0];
  assert.ok(toggle, 'the sheet should still be open after a flip');
  assert.equal(switchIn(toggle).checked, false);
  assert.deepEqual(
    texts(toggle, 'ui-toggle-label'),
    ['Off'],
    'the open sheet still shows On after the courier was switched off',
  );
});

test('the sheet never opens off the top of the window', () => {
  // The bug behind "the delivery person toggle does nothing". The sheet is a fixed 420
  // tall and anchored by its *bottom* to sit above its trigger, with no clamp — so in a
  // window with less than that above the trigger its top went negative and the first
  // rows ran off the screen. Not merely ugly: the rows live in a scrolling body, so
  // anything outside that box is clipped rather than drawn, and a row half off the top
  // is pixels you can see and cannot press. `elementFromPoint` there returns the canvas
  // and the click goes to the room.
  //
  // Every test of the switch passed throughout, because a test clicks the *element* and
  // a person clicks a *place*. This one checks the place.
  const wasRect = triggerRect;
  const wasHeight = globalThis.window.innerHeight;
  try {
    // A trigger part-way up a window shorter than the sheet: the case that broke. The
    // sheet wants to sit on the trigger, which would put its top at 300 - 420 = -120.
    triggerRect = { left: 20, top: 300, right: 200, bottom: 330, width: 180, height: 30 };
    globalThis.window.innerHeight = 560;
    menu.el.children[0].click();
    const sh = sheet();
    assert.ok(sh, 'the sheet should be open');
    // Its top, in viewport coordinates: innerHeight - bottom - height.
    const bottom = Number.parseFloat(sh.style.bottom);
    const top = globalThis.window.innerHeight - bottom - SHEET_H;
    assert.ok(top >= 0, `the sheet opened with its top at ${top}, off the top of the window`);
    assert.ok(bottom >= 8, 'and never flush against the bottom edge either');
  } finally {
    triggerRect = wasRect;
    globalThis.window.innerHeight = wasHeight;
  }
});

test('a switch that is off says so', () => {
  menu.setKit(groupKit(ITEMS, STATE), { courier: false });
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  const toggle = withClass(sheet(), 'kit-row-toggle')[0];
  assert.deepEqual(texts(toggle, 'ui-toggle-label'), ['Off']);
  assert.equal(switchIn(toggle).checked, false);
  flip(toggle, true);
  assert.deepEqual(flipped, [['courier', true]], 'off should offer to turn it back on');
});

// --- a switch with options inside it: the bird post ---------------------------

/** The bird post's block, which is the second switch on the Jobs tab. */
const birdBlock = () => {
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  return withClass(sheet(), 'kit-toggle-block')
    .find((b) => withClass(b, 'kit-row-name').some((n) => n.textContent === 'Bird post'));
};

test('the species sit inside the switch\'s own dashed block', () => {
  // They used to be a sibling of the row, which drew them outside the dashed
  // outline — a separate control that happened to be underneath rather than part of the
  // bird post. One block, one outline.
  menu.el.children[0].click();
  const block = birdBlock();
  assert.ok(block, 'the Jobs tab should carry the bird post');
  assert.equal(withClass(block, 'kit-row-toggle').length, 1, 'the switch is in the block');
  assert.equal(withClass(block, 'kit-options').length, 1, 'and so is the strip');
  // The strip is the block's own second child, under the row rather than beside it.
  assert.ok(block.children.at(-1).classList.contains('kit-options'));
});

test('a species chip is the panel\'s own lozenge, and the live one is marked', () => {
  menu.el.children[0].click();
  const strip = withClass(birdBlock(), 'kit-options')[0];
  const chips = withClass(strip, 'kit-option');
  assert.deepEqual(
    chips.map((c) => c.textContent),
    ['Mixed roster', 'Owl', 'Pigeon', 'Kookaburra', 'Raven'],
  );
  // `.dev-btn`, as Copy and Paste are, rather than a fourth kind of small control
  // invented for this one strip — so `active` lights it the way the panel lights
  // everything else.
  assert.ok(chips.every((c) => c.classList.contains('dev-btn')), 'chips are dev-btns');
  const live = chips.filter((c) => c.classList.contains('active'));
  assert.deepEqual(live.map((c) => c.textContent), ['Mixed roster'], 'the default is lit');
  assert.equal(live[0].getAttribute('aria-pressed'), 'true');
});

test('picking a species asks for it, and leaves the sheet open', () => {
  menu.el.children[0].click();
  withClass(withClass(birdBlock(), 'kit-options')[0], 'kit-option')
    .find((c) => c.textContent === 'Raven').click();
  assert.deepEqual(chose, [['birdKind', 'raven']]);
  assert.ok(sheet(), 'picking a bird is something you might do twice');
});

test('the chosen species is the one the room is holding', () => {
  menu.setKit(groupKit(ITEMS, STATE), { courier: true, birds: true, birdKind: 'kookaburra' });
  menu.el.children[0].click();
  const chips = withClass(withClass(birdBlock(), 'kit-options')[0], 'kit-option');
  assert.deepEqual(
    chips.filter((c) => c.classList.contains('active')).map((c) => c.textContent),
    ['Kookaburra'],
  );
});

test('no species strip while the aviary is shut', () => {
  // Choosing which bird flies is meaningless with the birds switched off, and a strip
  // that stayed would be five buttons that change nothing anybody could see.
  menu.setKit(groupKit(ITEMS, STATE), { courier: true, birds: false });
  menu.el.children[0].click();
  const block = birdBlock();
  assert.equal(withClass(block, 'kit-row-toggle').length, 1, 'the switch itself stays');
  assert.equal(withClass(block, 'kit-options').length, 0);
});

test('the sheet never opens off the right of the window either', () => {
  // The other axis of the clamp above, and newly worth having: the sheet went from 340
  // to 510 wide for this strip, so a trigger near the right edge now pushes a good
  // third of it off-screen — the same pixels-you-can-see-and-cannot-press failure.
  const wasRect = triggerRect;
  try {
    triggerRect = { left: 1400, top: 900, right: 1560, bottom: 922, width: 160, height: 22 };
    menu.el.children[0].click();
    const left = Number.parseFloat(sheet().style.left);
    assert.ok(left >= 8, `the sheet opened at ${left}`);
    assert.ok(
      left + SHEET_W <= globalThis.window.innerWidth - 8,
      `its right edge is at ${left + SHEET_W}, past the window's ${globalThis.window.innerWidth}`,
    );
  } finally {
    triggerRect = wasRect;
  }
});

test('the showing tab survives a refill', () => {
  // Adding a plant should leave you looking at the plants, not back at the first tab.
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Plants').click();
  menu.setKit(groupKit(ITEMS, STATE), { courier: true });
  assert.deepEqual(texts(sheet(), 'kit-head-name'), ['Greenery']);
});

// --- the picture, the plus, and the heading ----------------------------------

test('every row carries a thumbnail, a name and a plus', () => {
  menu.el.children[0].click();
  const couch = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Couch');
  assert.equal(withClass(couch, 'kit-shot').length, 1, 'a picture of the thing');
  assert.equal(withClass(couch, 'kit-plus').length, 1, 'and a plus saying what a press does');
  assert.match(couch.title, /add a couch/i, 'said in words too, for a tooltip and a reader');
});

test('a row with no picture still holds the column, so the words line up', () => {
  const odd = [{ key: 'furniture:mystery', label: 'Mystery', roles: [], note: null, full: false }];
  menu.setKit(groupKit(odd, STATE), {});
  menu.el.children[0].click();
  const row = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Mystery');
  assert.ok(row, 'an unmapped kind is still offered');
  assert.equal(withClass(row, 'kit-shot-none').length, 1,
    'a missing portrait costs a picture, not the alignment');
});

test('an explanation has no plus, because pressing it does nothing', () => {
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  const mailbox = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Mailbox');
  assert.equal(withClass(mailbox, 'kit-plus').length, 0);
});

test('the switch sits where the plus sits, not in the words', () => {
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  const toggle = withClass(sheet(), 'kit-row-toggle')[0];
  assert.equal(withClass(toggle, 'kit-plus').length, 0, 'a switch is not an add');
  assert.equal(withClass(toggle, 'ui-toggle').length, 1);
  // And it is the row's own last child, i.e. the third column.
  assert.ok(toggle.children.at(-1).classList.contains('ui-toggle'));
});

test('the sheet is headed, and the heading travels with the tabs', () => {
  menu.el.children[0].click();
  const top = withClass(sheet(), 'kit-top')[0];
  assert.ok(top, 'heading and tabs share one block, so one cannot scroll without the other');
  assert.deepEqual(texts(top, 'kit-title'), ['Add item']);
  assert.equal(withClass(top, 'kit-tab').length, 5);
  // The rows are in a sibling, which is the half that scrolls.
  assert.equal(withClass(top, 'kit-row').length, 0);
  assert.ok(withClass(sheet(), 'kit-body').length, 'and the scrolling half exists');
});

// --- the intake / dispatch lozenges ------------------------------------------

test('the Jobs description names both jobs, in lozenges', () => {
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  const blurb = withClass(sheet(), 'kit-blurb')[0];
  assert.deepEqual(texts(blurb, 'kit-tag'), ['intake', 'dispatch', 'intake', 'dispatch'],
    'named once each in the sentence, then again in the rule about having one of each');
  // Blue for in, green for out, and the classes are what carries that.
  assert.equal(withClass(blurb, 'kit-tag-intake').length, 2);
  assert.equal(withClass(blurb, 'kit-tag-dispatch').length, 2);
});

test('each row wears the jobs it does, in the same lozenges', () => {
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();

  const rowFor = (label) => withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === label);

  // The post does both, which is the case the colours exist for.
  assert.deepEqual(texts(rowFor('Mailbox'), 'kit-tag'), ['intake', 'dispatch']);
  assert.deepEqual(texts(rowFor('Inbox'), 'kit-tag'), ['intake']);
});

test('a job with a section to itself gets no lozenge', () => {
  // Research, census, refresh and discard each head their own section, so a lozenge
  // repeating the heading would be noise. A tag earns its space only where a row could
  // be one of several things.
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Other').click();
  const shelf = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Bookshelf');
  assert.deepEqual(texts(shelf, 'kit-tag'), []);
});

test('an explanation keeps its picture and its lozenges', () => {
  // The bug: rows for kinds the room already has all of were built from a stripped
  // object with no `key` and no `roles`, so the coat stand, the cooler, the machine and
  // the bin all showed a blank tile and no tags.
  const full = [
    { key: 'station:coatStand', label: 'Coat stand', roles: ['census'], note: null, full: true },
    { key: 'station:mailbox', label: 'Mailbox', roles: ['intake', 'dispatch'], note: null, full: true },
  ];
  menu.setKit(groupKit(full, STATE), { courier: true });
  menu.el.children[0].click();

  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  const post = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Mailbox');
  assert.ok(post.classList.contains('kit-row-static'), 'it explains rather than offers');
  assert.equal(withClass(post, 'kit-shot').length, 1, 'and still shows the thing');
  assert.deepEqual(texts(post, 'kit-tag'), ['intake', 'dispatch']);

  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Other').click();
  const coats = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Coat stand');
  assert.equal(withClass(coats, 'kit-shot').length, 1, 'a disabled row is not a blank tile');
});

// --- what changed, and what must stay gone -----------------------------------

test('no section wears a needed-count chip any more', () => {
  // It restated a rule the description already gives in a sentence, and its tick was
  // reassurance about a state nobody was worried about. What the state is still for is
  // the dot on the tab, which the test above pins.
  menu.el.children[0].click();
  for (const name of KIT_TABS) {
    withClass(sheet(), 'kit-tab').find((t) => t.textContent === name).click();
    assert.equal(withClass(sheet(), 'kit-need').length, 0, `${name} still draws a chip`);
  }
});

test('the lozenges sit beside the name, not under it', () => {
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  const post = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Mailbox');

  const head = withClass(post, 'kit-row-head')[0];
  assert.ok(head, 'the name and its tags share a line');
  // The name first, then both jobs, all children of that one line.
  assert.deepEqual(head.children.map((c) => c.textContent), ['Mailbox', 'intake', 'dispatch']);
  // And the note is a sibling of the line rather than inside it.
  assert.equal(withClass(head, 'kit-row-note').length, 0);
});

test('a kind that comes in colours says so, in its own colour', () => {
  const paintable = [
    { key: 'furniture:couch', label: 'Couch', roles: [], note: null, full: false, colourable: true },
    { key: 'furniture:sideTable', label: 'Side table', roles: [], note: null, full: false },
  ];
  menu.setKit(groupKit(paintable, STATE), {});
  menu.el.children[0].click();

  const rowFor = (label) => withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === label);
  assert.deepEqual(texts(rowFor('Couch'), 'kit-tag'), ['colourable']);
  assert.equal(withClass(rowFor('Couch'), 'kit-tag-colour').length, 1,
    'a third hue: what you can do to it is not what it is for');
  assert.deepEqual(texts(rowFor('Side table'), 'kit-tag'), [],
    'a kind with no palette claims nothing');
});

test('a thing can be both a job and paintable', () => {
  // Nothing in the room is today, but the row has to cope: the two lozenges answer
  // different questions and neither should crowd the other out.
  const both = [{
    key: 'station:mailbox', label: 'Mailbox', roles: ['intake', 'dispatch'],
    note: null, full: false, colourable: true,
  }];
  menu.setKit(groupKit(both, STATE), {});
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  const post = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Mailbox');
  assert.deepEqual(texts(post, 'kit-tag'), ['intake', 'dispatch', 'colourable']);
});

test('an explanation keeps every field the item had, not a chosen few', () => {
  // Raised in review on the PR, and the third time this shape of bug appeared: the row
  // for a kind the room has all of was rebuilt field by field, so whatever was not on
  // that list went missing — the portrait first, then the lozenges, then `colourable`.
  // The fields are copied wholesale now, and this asserts the *general* property rather
  // than the three that happened to be noticed.
  const item = {
    key: 'station:mailbox',
    label: 'Mailbox',
    roles: ['intake', 'dispatch'],
    note: null,
    full: true,
    colourable: true,
  };
  const [section] = groupKit([item], STATE).filter((s) => s.tab === 'Jobs');
  const [explained] = section.extras;

  for (const field of Object.keys(item)) {
    if (field === 'note') continue;            // reworded on purpose
    assert.deepEqual(explained[field], item[field], `${field} was dropped on the way`);
  }
  assert.ok(explained.note, 'and a kind with no note of its own is given one');

  // Which means it renders with all three, without the menu naming any of them.
  menu.setKit(groupKit([item], STATE), {});
  menu.el.children[0].click();
  withClass(sheet(), 'kit-tab').find((t) => t.textContent === 'Jobs').click();
  // By name: the courier's switch is also a row in this section, and it renders
  // before the explanations.
  const row = withClass(sheet(), 'kit-row')
    .find((r) => texts(r, 'kit-row-name')[0] === 'Mailbox');
  assert.ok(row, 'the explanation should be drawn');
  assert.equal(withClass(row, 'kit-shot').length, 1);
  assert.deepEqual(texts(row, 'kit-tag'), ['intake', 'dispatch', 'colourable']);
});
