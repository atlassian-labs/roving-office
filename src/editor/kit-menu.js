// The Add-item menu: what the room can be given, grouped by what things are *for*.
//
// A custom menu rather than a native `<select>`, for the same reason the scene switcher
// is one (see ui/switcher.js): a row here has to carry more than a label. It says which
// jobs a kind does, whether the room already has that job covered, and a line of prose
// about why you would want one — none of which fits in an `<option>`.
//
// The grouping is **derived from the jobs**, not from a list of families kept in step by
// hand. That matters more than it sounds: the old picker matched keys against a fixed
// `KIT_GROUPS` table and silently dropped anything that matched no group, which is how a
// standing desk once went missing from the menu entirely. Here a kind's own `roles` put
// it in a section, and a catch-all at the end means nothing can fall through.
//
// It also answers a question the old picker could not: **what does the room have to
// have?** Four jobs are required, and a picker that only ever listed what was addable
// could not say so — a room with its one bookshelf showed nothing at all under research.
// Each required section now carries its own state, covered or missing, whether or not
// there is anything to add to it.

/**
 * The sections, in the order the work flows, and what falls into each.
 *
 * `roles` sections are matched on what a kind can do. `match` sections are the things
 * with no job — furniture, plants, and the desks work happens at. Order matters twice:
 * the required jobs come first because they are what the office needs before it needs
 * anywhere nice to sit, and the last entry is a catch-all so an item can never be lost.
 *
 * `extras` are rows that explain rather than add. The delivery person is the case: he is
 * one of the two ways work arrives, and he is not furniture — no footprint, nothing to
 * drag, he walks on from off-stage and leaves. A section about how work arrives that did
 * not mention him would be telling half the story, so he is listed and greyed.
 */
import { node } from '../ui/dom.js';

export const KIT_SECTIONS = [
  {
    tab: 'Furniture',
    name: 'Comfort',
    match: (key) => key.startsWith('furniture:'),
    blurb: 'Things to sit on, put a cup on, and read by.',
  },
  {
    tab: 'Desks',
    name: 'Workstations',
    match: (key) => key === 'desk' || key.startsWith('desk:'),
    blurb: 'One desk is one agent. The count of desks is the headcount.',
  },
  {
    tab: 'Jobs',
    name: 'Delivery & collection',
    roles: ['intake', 'dispatch'],
    // Written as parts so the lozenges can sit *inside* the sentence rather than after
    // it. A role name in prose and the same name on a row are then plainly the same
    // thing, which is the whole point of colouring them.
    blurbParts: [
      'How work reaches the office (', { role: 'intake' }, '), and how finished work',
      ' leaves (', { role: 'dispatch' }, '). You must always have at least 1 (',
      { role: 'intake' }, ') and 1 (', { role: 'dispatch' }, ') item in any scene.',
    ],
    // The one switch in the kit, and it is a switch rather than an item because the
    // courier is not furniture: no footprint, nothing to drag, he walks on from
    // off-stage and leaves. "Have one or not" therefore cannot be adding and removing
    // a prop the way everything else here is.
    toggles: [{
      key: 'courier',
      label: 'Delivery person',
      portrait: 'courier',
      does: 'brings work in',
      note: 'Not a prop. He brings parcels to the door; off, and work comes by air or by fax.',
    }, {
      key: 'birds',
      label: 'Bird post',
      portrait: 'pigeon',
      does: 'brings work in',
      // The odds, said the way you would say them out loud. The exact shares are
      // BIRD_SHARE and OWL_SHARE in scene/birds.js; a note that quoted them would
      // be a table nobody reads and a number to keep in step with two other files.
      note: 'About one letter in three comes by bird instead of paper plane. Mostly the owl at night — but you might spot a raven if you look hard. Off, and every letter is a plane.',
      // The place has options inside: which bird flies. 'roster' is the mixed
      // shift the note above describes; a species pins every flight to it.
      options: {
        key: 'birdKind',
        choices: [
          { id: 'roster', label: 'Mixed roster' },
          { id: 'owl', label: 'Owl' },
          { id: 'pigeon', label: 'Pigeon' },
          { id: 'kookaburra', label: 'Kookaburra' },
          { id: 'raven', label: 'Raven' },
        ],
      },
    }],
  },
  {
    tab: 'Plants',
    name: 'Greenery',
    match: (key) => key.startsWith('plant:'),
    blurb: 'Nought to twenty-four. A room with no plants is a sadder room and a valid one.',
  },
  // Everything else the work touches, in the order it comes up in a working day. All
  // under one tab because none of them is a list you browse — each is one or two
  // things, and three headings in a tab reads better than three tabs of two rows.
  {
    tab: 'Other',
    name: 'Research',
    roles: ['research'],
    blurb: 'Somewhere to look things up.',
  },
  {
    tab: 'Other',
    name: 'Who is here',
    roles: ['census'],
    blurb: 'How the room shows its own population.',
  },
  {
    tab: 'Other',
    name: 'Breaks',
    roles: ['refresh'],
    blurb: 'Optional. Without one, breaks happen without a cup.',
  },
  {
    tab: 'Other',
    name: 'Waste',
    roles: ['discard'],
    blurb: 'Optional. Without one, failed work closes at the desk.',
  },
  // The catch-all, and the reason nothing can be dropped: a station with no job at all
  // still has to appear somewhere. The printer was the one, until it earned a job.
  {
    tab: 'Other',
    name: 'No job yet',
    match: () => true,
    blurb: 'In the room, and nothing sends anybody to it.',
  },
];

/** The tabs, in the order they are shown. Derived, so a section cannot invent one. */
export const KIT_TABS = [...new Set(KIT_SECTIONS.map((s) => s.tab))];

/**
 * The portrait for each thing the kit offers.
 *
 * The pictures already exist: `bin/prop-portrait.js` photographs every entry in the
 * scene catalogue for [the kit](../../docs/user/the-kit.md), and the server serves them. So a
 * row can show the thing itself rather than asking anybody to recognise furniture from
 * the word "Sideboard".
 *
 * A map rather than a rule, because kit keys and catalogue ids are two different
 * namings and only mostly agree — `desk:standing` is photographed as `standingDesk`,
 * the coffee machine as `espressoMachine`, and `plant:bush` as `leafyBush` (plain
 * `bush.png` is the one growing outside on the street). A missing entry costs a picture
 * and nothing else, and `test/kit-menu.test.js` insists every offered key has one, so a
 * new kind arrives with a portrait rather than a gap.
 */
export const KIT_PORTRAITS = {
  desk: 'desk',
  'desk:standing': 'standingDesk',
  'station:bookshelf': 'bookshelf',
  'station:mailbox': 'mailbox',
  'station:inbox': 'inbox',
  'station:waterCooler': 'waterCooler',
  'station:coffee': 'espressoMachine',
  'station:bin': 'bin',
  'station:coatStand': 'coatStand',
  'station:printer': 'printer',
  'station:telescope': 'telescope',
  'furniture:couch': 'couch',
  'furniture:armchair': 'armchair',
  'furniture:sideTable': 'sideTable',
  'furniture:rug': 'rug',
  'furniture:floorLamp': 'floorLamp',
  'plant:bush': 'leafyBush',
  'plant:fig': 'fig',
  'plant:monstera': 'monstera',
  'plant:snake': 'snakePlant',
  'plant:fern': 'fern',
};

/** Where those pictures live. The same ones the kit doc uses. */
const PORTRAIT_PATH = '/docs/images/objects';

/**
 * The jobs that get a lozenge of their own, and what colour it is.
 *
 * `intake` and `dispatch` are the two that need telling apart at a glance, because the
 * Jobs tab is the one place a single prop can do *both* and the room must always have
 * one of each. So they are named in the section's own description and then again beside
 * every row, in the same colours — blue for work coming in, green for work going out.
 * A reader who has met the words once in the sentence recognises them on the rows
 * without being told twice.
 *
 * Blue and green rather than a shape or an order, because the two are peers: neither is
 * a warning and neither comes first, so they want two hues of equal weight rather than
 * anything that reads as a scale.
 *
 * The other roles are absent on purpose. Research, census, refresh and discard each have
 * a section to themselves, so a lozenge repeating the heading would be noise — a tag
 * earns its space only where a row could be one of several things.
 */
export const ROLE_TAGS = {
  intake: { label: 'intake', tone: 'intake' },
  dispatch: { label: 'dispatch', tone: 'dispatch' },
};

/**
 * The lozenge for a kind that comes in colours.
 *
 * Yellow, and a third hue on purpose: it is not a job, so it should not read as one.
 * Blue and green answer "what is this for"; this answers "what can I do to it", which
 * is a different question and earns a colour of its own rather than a shade of theirs.
 *
 * Which kinds get it is read off the layout — a kind with a `palette` is paintable — so
 * a fourth paintable kind arrives wearing this without anything being added here.
 */
const COLOUR_TAG = { label: 'colourable', tone: 'colour' };

/** One lozenge, whatever it is about. */
function lozenge(tag) {
  const el = node('span', `kit-tag kit-tag-${tag.tone}`, tag.label);
  return el;
}

/** The lozenge for a job, or null for a job that does not get one. */
function tagFor(role) {
  const tag = ROLE_TAGS[role];
  return tag ? lozenge(tag) : null;
}

/** The portrait for a key or an explicit `portrait` name, or null for neither. */
function portraitFor(item) {
  const id = item.portrait ?? KIT_PORTRAITS[item.key];
  return id ? `${PORTRAIT_PATH}/${id}.png` : null;
}

/**
 * Split the addable list into sections, with each required job's state alongside.
 *
 * Exported and pure so the grouping can be tested without a DOM — and so the promise
 * that every item lands somewhere is a test rather than a hope.
 *
 * @param {{key: string, label: string, roles: string[], note: ?string}[]} items
 * @param {object} opts
 * @param {string[]} opts.required  the jobs the room may not go without
 * @param {Record<string, string[]>} opts.covered  role -> labels of what does it now
 * @returns {{name: string, blurb: string, need: ?{roles: string[], missing: string[],
 *   by: string[]}, items: Array, extras: Array}[]}
 */
export function groupKit(items, { required = [], covered = {} } = {}) {
  const left = [...items];
  const out = [];

  for (const section of KIT_SECTIONS) {
    // Both predicates take the whole item, so they cannot disagree about their argument
    // — which they did in the first draft, one taking an item and the other a key.
    const belongs = section.roles
      ? (item) => item.roles?.some((r) => section.roles.includes(r))
      : (item) => section.match(item.key);
    const claimed = [];
    for (let i = left.length - 1; i >= 0; i -= 1) {
      if (belongs(left[i])) claimed.unshift(...left.splice(i, 1));
    }
    // A kind the room already has all of is an *offer* nowhere and an *explanation* in
    // a section about a required job: a mailbox that cannot be added is still the thing
    // doing the job, and the reason there may only be one belongs next to it. Elsewhere
    // it is only noise — nobody needs a greyed-out fern.
    const mine = claimed.filter((item) => !item.full);
    const full = section.roles ? claimed.filter((item) => item.full) : [];

    // A required section is worth showing even with nothing to add to it, because its
    // state is the answer to "what must the room have?". An optional one with nothing
    // to add is just an empty list, so it goes.
    const roles = section.roles ?? [];
    const needed = roles.filter((r) => required.includes(r));
    const need = needed.length ? {
      roles: needed,
      missing: needed.filter((r) => !(covered[r]?.length)),
      by: [...new Set(needed.flatMap((r) => covered[r] ?? []))],
    } : null;

    const toggles = section.toggles ?? [];
    const extras = [
      // The full kinds first: they are what is doing the job now, so they read as the
      // section's answer before the things you could add beside them.
      // `key` and `roles` come along, and both for the same reason: an explanation is
      // the same row as an offer minus the plus, so it wants the same portrait and the
      // same tags. Dropping the key left the coat stand, the cooler, the machine and
      // the bin with blank tiles — `portraitFor` looks the picture up *by key*, and the
      // object it was handed no longer had one.
      // Everything the item had, with only the note reworded. Listing the fields to
      // keep is what went wrong twice: first `key` was missing and the row lost its
      // portrait, then `roles` and it lost its lozenges, and `colourable` was dropped
      // the same way — caught in review before anything could wear it. An explanation
      // *is* the item, minus the plus, so copying it wholesale is both shorter and the
      // only version that cannot go stale when a field is added.
      ...full.map((item) => ({
        ...item,
        note: item.note ?? 'The room already has all of these.',
      })),
      ...(section.extras ?? []),
    ];
    if (!mine.length && !need && !extras.length && !toggles.length) continue;
    out.push({
      tab: section.tab,
      name: section.name,
      blurb: section.blurb ?? '',
      blurbParts: section.blurbParts ?? null,
      need,
      items: mine,
      extras,
      toggles,
    });
  }
  return out;
}

/**
 * Build the menu.
 *
 * @param {object} opts
 * @param {(key: string) => void} opts.onPick  bring one of these in
 * @param {(key: string, on: boolean) => void} [opts.onToggle]  flip a channel switch
 * @param {(key: string, value: string) => void} [opts.onOption]  pick a switch's option
 * @returns {{el: HTMLElement, setKit(sections: Array): void, close(): void}}
 */
export function createKitMenu({ onPick, onToggle, onOption }) {
  const el = node('div', 'kit-menu');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dev-btn kit-trigger';
  trigger.textContent = 'Add item…';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  el.appendChild(trigger);

  // The sheet lives on `document.body`, not inside the menu, and that is not a style
  // choice. `.dev-panel-body` sets `overflow: clip`, and load-bearingly so — it is what
  // hides the divider a paired group wears when the group falls first on its line, a
  // question CSS cannot otherwise ask. A sheet parented inside the panel is therefore
  // clipped to the panel's own height, which for a strip an inch tall means a menu you
  // cannot read. CSS will not let one axis clip while the other is visible either, so
  // escaping the box is the only way out; the position is worked out from the trigger's
  // own rect each time it opens.
  const sheet = node('div', 'kit-sheet');
  sheet.hidden = true;

  const place = () => {
    const at = trigger.getBoundingClientRect();
    // Clamped at the right edge as well as the left. The sheet went half again as wide
    // for the species strip, and a fixed box anchored only by its left edge
    // runs off whichever side the trigger happens to be near — the same unclickable
    // failure as the vertical clamp below, in the other axis.
    const width = sheet.offsetWidth || 510;
    const rightmost = Math.max(8, window.innerWidth - width - 8);
    sheet.style.left = `${Math.max(8, Math.min(at.left, rightmost))}px`;
    // Above the trigger, because the panel is at the bottom of the window: opening
    // downward would put the sheet off-screen.
    //
    // Clamped into the window, which it was not, and the failure was a nasty one: the
    // sheet is a fixed 420 tall and anchored by its *bottom*, so in a window with less
    // than that above the trigger its top went negative and the first rows ran off the
    // top of the screen. Not merely ugly — unclickable. The rows live in `.kit-body`,
    // which scrolls, so anything outside that box is clipped rather than drawn, and a
    // row at y −43 with 57 pixels showing is 57 pixels you can see and cannot press:
    // `elementFromPoint` there returns the canvas, and the click goes to the room.
    //
    // That is why the delivery person's switch "did nothing" while every test of it
    // passed. A test clicks the element; a person clicks a *place*, and the place had
    // the 3D scene in it. Only hit-testing the real page finds this, which is what
    // finally did.
    const height = sheet.offsetHeight || 420;
    const wanted = window.innerHeight - at.top + 8;      // sitting on the trigger
    const highest = window.innerHeight - height - 8;      // top edge still on screen
    sheet.style.bottom = `${Math.max(8, Math.min(wanted, highest))}px`;
  };

  const close = () => {
    sheet.hidden = true;
    sheet.remove();
    trigger.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    document.body.appendChild(sheet);
    sheet.hidden = false;
    place();
    trigger.setAttribute('aria-expanded', 'true');
  };
  // Re-placed rather than re-anchored: the panel moves with the window, so a sheet left
  // where it was opened would drift off its trigger.
  window.addEventListener('resize', () => { if (!sheet.hidden) place(); });
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sheet.hidden) open(); else close();
  });
  // Anywhere else shuts it, which is what every other menu on the page does. Escape too,
  // and the keypress is swallowed so it does not also leave edit mode — closing a menu
  // and closing the mode it belongs to should not be one keystroke.
  // Both, and the sheet is the half that is easy to forget: it hangs off `document.body`
  // rather than off the menu (see above), so `el.contains` alone answers false for every
  // click *inside* the sheet and shut it on contact. Tabs were the symptom — a tab press
  // closed the menu and then re-rendered into a sheet that had just been removed, so the
  // Jobs tab appeared to be empty.
  document.addEventListener('click', (e) => {
    if (!el.contains(e.target) && !sheet.contains(e.target)) close();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || sheet.hidden) return;
    e.stopPropagation();
    close();
    trigger.focus();
  });

  /**
   * A row: picture, words, and something on the right saying what a click will do.
   *
   * The three columns are the point of this change. A row used to be a stack of text
   * sitting under a heading that was also a stack of text, so an item and a section
   * title read as the same kind of thing. The thumbnail gives the list a spine, the
   * indent makes items plainly subordinate to their heading, and the thing on the right
   * — a plus, or a switch — says what pressing it does rather than leaving you to guess
   * that a row is a button at all.
   *
   * @param {object} item  label, and optionally `does` and `note`
   * @param {?HTMLElement} affordance  the plus, the switch, or null for an explanation
   */
  const rowOf = (item, affordance, tag = null) => {
    const host = document.createElement(tag ?? (affordance ? 'button' : 'div'));
    if (!tag && affordance) host.type = 'button';
    host.className = 'kit-row';

    const shot = portraitFor(item);
    if (shot) {
      const img = node('img', 'kit-shot');
      img.src = shot;
      img.alt = '';
      // Decorative: the name is right beside it, so a screen reader reading the
      // filename would only be saying the same thing worse.
      img.setAttribute('aria-hidden', 'true');
      // Not lazy, deliberately. Only the showing tab's rows are in the DOM, so this is a
      // handful of small PNGs rather than the whole kit — and lazy images in a scrolling
      // sheet arrived late enough to leave visible empty tiles on first open.
      img.setAttribute('decoding', 'async');
      host.appendChild(img);
    } else {
      // No portrait, but still the column: the words of every row line up whether or
      // not there is a picture to put beside them.
      const gap = node('span', 'kit-shot kit-shot-none');
      host.appendChild(gap);
    }

    const words = node('span', 'kit-words');

    // Name and lozenges on one line. They were stacked, which made a two-job row three
    // lines tall before the description even began and pushed the note out of the
    // glance — the tags are an aside about the name, so they belong beside it.
    const head = node('span', 'kit-row-head');
    const name = node('span', 'kit-row-name', item.label);
    head.appendChild(name);
    // The jobs this thing does, as the same lozenges the section's description used.
    // Beside the name rather than under it, so a row that does two — the post — reads
    // as one thing wearing two labels rather than as a paragraph.
    const tags = (item.roles ?? []).map(tagFor).filter(Boolean);
    if (item.colourable) tags.push(lozenge(COLOUR_TAG));
    for (const tag of tags) head.appendChild(tag);
    words.appendChild(head);

    if (!tags.length && item.does) {
      // Whatever it does has no lozenge of its own — the courier's 'brings work in',
      // which is true and is not one of the jobs a room must have covered.
      const does = node('span', 'kit-row-does', item.does);
      words.appendChild(does);
    }
    if (item.note) {
      const note = node('span', 'kit-row-note', item.note);
      words.appendChild(note);
    }
    host.appendChild(words);

    if (affordance) host.appendChild(affordance);
    return host;
  };

  const row = (item) => {
    const plus = node('span', 'kit-plus', '+');
    plus.setAttribute('aria-hidden', 'true');

    const b = rowOf(item, plus);
    b.title = `Add a ${item.label.toLowerCase()} to the room`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      onPick(item.key);
    });
    return b;
  };

  const explainer = (extra) => {
    const d = rowOf(extra, null);
    d.classList.add('kit-row-static');
    return d;
  };

  // A switch, drawn as a row so it sits among the things it is about. Its state comes
  // from the caller on every fill, so it cannot drift from the layout it switches.
  const toggleRow = (t, on) => {
    // The same switch as Paths, along the panel — a native checkbox behind a track and
    // an On/Off word (`.ui-toggle`). It was a bespoke two-half pill, which was a second
    // idea about what a switch looks like in a panel that already had one, and the
    // native input brings Space, focus and checked state in step for free.
    //
    // A `span` rather than the `label` Paths uses, because the whole row is already the
    // label: nesting one inside another is invalid, and the outer one is what makes a
    // click anywhere along the row flip the switch.
    const sw = node('span', 'ui-toggle');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', t.label);
    input.checked = on;
    const track = node('span', 'ui-toggle-track');
    track.setAttribute('aria-hidden', 'true');
    sw.append(input, track, node('span', 'ui-toggle-label', on ? 'On' : 'Off'));

    // A `label`, so the row keeps its whole surface clickable now that it is not a
    // button. The species chips have to stay outside it — interactive content inside a
    // label is activated *by* the label, so a chip in here would flip the switch it was
    // meant to configure — which is what `toggleBlock` below is for.
    const b = rowOf(t, sw, 'label');
    b.classList.add('kit-row-toggle');
    b.title = on ? `Turn off the ${t.label.toLowerCase()}` : `Turn on the ${t.label.toLowerCase()}`;

    // The sheet stays open, unlike an add: a switch is something you might flip twice,
    // and closing on every press would put the second press two clicks away. The click
    // is stopped for the same reason a tab press is — flipping it refills the sheet, so
    // the row that was clicked is gone before any outside-click test could place it.
    //
    // `change` and not `click`: a click on the label reaches here twice, once for the
    // label and once for the click it synthesises on the input, and a switch that
    // toggles twice per press is a switch that does nothing.
    input.addEventListener('click', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => onToggle?.(t.key, input.checked));
    return b;
  };

  /**
   * A switch's options, as a strip of choices under its row — only drawn while
   * the switch is on, because choosing which bird flies is meaningless with the
   * aviary shut.
   *
   * The chips are the panel's own lozenges (`.dev-btn`, as Copy and Paste are)
   * at a smaller size, rather than a fourth kind of small control invented here.
   */
  const optionStrip = (options, current) => {
    const strip = node('div', 'kit-options');
    for (const choice of options.choices) {
      const live = choice.id === current;
      const chip = node('button', `dev-btn kit-option${live ? ' active' : ''}`, choice.label);
      chip.type = 'button';
      chip.title = `Post flies by ${choice.label.toLowerCase()}`;
      chip.setAttribute('aria-pressed', live ? 'true' : 'false');
      chip.addEventListener('click', (e) => {
        // Same reason the toggle stops its click: picking refills the sheet.
        e.stopPropagation();
        onOption?.(options.key, choice.id);
      });
      strip.appendChild(chip);
    }
    return strip;
  };

  /**
   * A switch and its options as one thing: the dashed outline goes round both.
   *
   * The strip used to sit outside the switch's dashed border, which drew the
   * species as a separate control that happened to be underneath rather than as
   * part of the bird post. One block, one outline.
   */
  const toggleBlock = (t, on, current) => {
    const block = node('div', 'kit-toggle-block');
    block.appendChild(toggleRow(t, on));
    if (t.options && on) block.appendChild(optionStrip(t.options, current));
    return block;
  };

  /** Which tab is showing. Kept across refills, so a redraw does not jump. */
  let activeTab = KIT_TABS[0];

  return {
    el,
    close,

    /**
     * What the room can be given, in tabs.
     *
     * The whole sheet is rebuilt on every call. That is cheap and it keeps one code
     * path — the alternative is diffing a menu against itself, which is a bug farm.
     * `activeTab` survives the rebuild, so adding a plant leaves you looking at the
     * plants rather than back at the first tab.
     *
     * @param {ReturnType<typeof groupKit>} sections
     * @param {Record<string, boolean>} [channels]  the state of the switches
     */
    setKit(sections, channels = {}) {
      sheet.replaceChildren();

      const tabs = KIT_TABS.filter((t) => sections.some((sec) => sec.tab === t));
      if (!tabs.includes(activeTab)) [activeTab] = tabs;

      // Heading and tabs together in one block, and the block is what stays put: the
      // body scrolls under it, so which panel this is and which tab you are on are
      // never scrolled away. Its title uses the same type scale as the Agents panel.
      const top = node('div', 'kit-top');
      const heading = node('div', 'kit-title', 'Add item');
      top.appendChild(heading);

      const bar = node('div', 'kit-tabs');
      bar.setAttribute('role', 'tablist');
      for (const name of tabs) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `kit-tab${name === activeTab ? ' active' : ''}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', name === activeTab ? 'true' : 'false');
        tab.textContent = name;
        // A tab holding a required job nobody is doing wears a dot, so the thing that
        // wants attention is visible without opening every tab to hunt for it.
        if (sections.some((sec) => sec.tab === name && sec.need?.missing.length)) {
          tab.classList.add('wanting');
        }
        tab.addEventListener('click', (e) => {
          // Handled here, so it must not also read as a click *outside* the menu. Asking
          // `sheet.contains(target)` in the document listener is not enough and was the
          // first attempt at this: the line below re-renders the sheet, so by the time
          // that listener runs the tab it was given has been detached and containment
          // answers false. The menu shut on every tab press and then drew into a sheet
          // it had just removed, which is why the tabs looked empty.
          e.stopPropagation();
          activeTab = name;
          this.setKit(sections, channels);
        });
        bar.appendChild(tab);
      }
      top.appendChild(bar);
      sheet.appendChild(top);

      const body = node('div', 'kit-body');
      sheet.appendChild(body);

      for (const section of sections) {
        if (section.tab !== activeTab) continue;

        const head = node('div', 'kit-head');
        const title = node('span', 'kit-head-name', section.name);
        head.appendChild(title);

        // No chip here. There was one — "one of each needed ✓" — and it did not earn
        // its space: it restated a rule the description already gives in a full
        // sentence, and its tick was reassurance about a state nobody was worried
        // about. What the state is still *for* is the dot on the tab, which points at
        // a job nobody is doing; `need` is computed for that and read nowhere else.
        body.appendChild(head);

        if (section.blurbParts || section.blurb) {
          const blurb = node('div', 'kit-blurb');
          for (const part of section.blurbParts ?? [section.blurb]) {
            if (typeof part === 'string') {
              blurb.appendChild(document.createTextNode(part));
            } else {
              const tag = tagFor(part.role);
              if (tag) blurb.appendChild(tag);
            }
          }
          body.appendChild(blurb);
        }

        for (const item of section.items) body.appendChild(row(item));
        for (const t of section.toggles ?? []) {
          const isOn = channels[t.key] !== false;
          const current = t.options
            ? channels[t.options.key] ?? t.options.choices[0].id
            : null;
          body.appendChild(toggleBlock(t, isOn, current));
        }
        for (const extra of section.extras) body.appendChild(explainer(extra));

        const empty = !section.items.length
          && !section.extras.length
          && !(section.toggles ?? []).length;
        if (empty) {
          const none = node('div', 'kit-row-note kit-none', 'The room has all of these.');
          body.appendChild(none);
        }
      }
    },
  };
}

