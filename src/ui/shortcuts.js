// Keyboard and mouse shortcuts.
//
// The point of this module is that the help panel cannot go stale. A shortcut is
// not "a keydown handler somewhere, and a line in a hand-written list" — it is one
// registration carrying both the binding and its description, and the panel is
// rendered from the registry at the moment it opens. Adding a key without
// describing it is therefore impossible; the only way to bind one is to write down
// what it does at the same time.
//
// `hidden` withholds a row from the panel without weakening that. The description
// is still compulsory and still lives next to the binding — it simply is not shown,
// because a panel is a finite amount of a reader's attention and spending a row on
// Escape-closes-the-dialog buys nothing. Reflexes only: anything a reader could not
// have guessed belongs in the list.
//
// Mouse gestures can't be dispatched from here, so they register as
// documentation-only entries, next to the code that implements them.

import { closeButton, ensureHost, node } from './dom.js';

/**
 * @typedef {object} Shortcut
 * @property {string} id             unique; re-registering the same id replaces it
 * @property {string[]} keys         display forms, e.g. ['?'] or ['⌘', 'C']
 * @property {string} label          what it does; `{WORD}` sets WORD in the heading face,
 *                                   and a backticked word becomes a key cap
 * @property {string} group          heading in the help panel
 * @property {number} order          sort order within the group
 * @property {string} [sep]          what joins the keys on screen; '+' chord, '/' choice
 * @property {boolean} [hidden]      bound, described, but kept out of the panel
 * @property {?function} onPress     omitted for documentation-only entries
 * @property {?function} match       custom matcher, if `keys` isn't enough
 */

/** @type {Map<string, Shortcut>} */
const registry = new Map();

// Groups the panel puts first, in this order; anything else follows alphabetically.
// Roughly "who is in the room", "the room itself", then the two modes you have to
// turn on — so the further down the panel you read, the more deliberate the thing
// you are doing.
const GROUP_ORDER = ['Agents', 'Scene', 'Edit Mode', 'Developer'];

// Display form -> KeyboardEvent.key. Only needed where the two differ.
const KEY_ALIASES = {
  esc: 'escape',
  space: ' ',
  del: 'delete',
};

// Display form -> the modifier it stands for. `⌘` is the platform's command key:
// Meta on a Mac, Control everywhere else. Which one is down is not something a
// shortcut should have to ask about, and not something the panel should explain.
const MODIFIERS = {
  '⌘': 'cmd',
  cmd: 'cmd',
  ctrl: 'cmd',
  alt: 'alt',
  opt: 'alt',
};

/**
 * Split a `keys` list into the modifiers held and the one key pressed.
 *
 * `keys` is a chord: every entry but the last names a modifier, and they are all
 * required together. Alternatives — `[` or `]`, either of which turns a prop — are
 * a display concern only (see `sep`), because the two entries that need them are
 * documentation-only and never reach a matcher.
 */
function parseKeys(keys) {
  const mods = new Set();
  let main = null;
  for (const k of keys) {
    const mod = MODIFIERS[k.toLowerCase()];
    if (mod) mods.add(mod);
    else main = k;
  }
  return { mods, main };
}

/** True when the user is typing, so shortcuts must not steal the keystroke. */
function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function defaultMatch(entry, event) {
  const { mods, main } = parseKeys(entry.keys);
  if (main === null) return false;

  // Modifiers must match exactly, in both directions. Being able to require one is what
  // makes a chord bindable at all; requiring their *absence* is what keeps every
  // unmodified shortcut out of the way of the browser's own — `⌘S` still saves the page,
  // and does not also open the scene panel.
  if (mods.has('cmd') !== (event.metaKey || event.ctrlKey)) return false;
  if (mods.has('alt') !== event.altKey) return false;

  // Shift is deliberately not checked: `?` is shift+/ on most layouts, and letters
  // arrive lowercased below either way.
  const pressed = event.key.toLowerCase();
  const want = KEY_ALIASES[main.toLowerCase()] ?? main.toLowerCase();
  if (want === pressed) return true;
  // Some layouts report only the base key for '?'.
  if (want === '?' && pressed === '/' && event.shiftKey) return true;
  return false;
}

/** A chord's canonical form, for spotting two entries that claim the same keys. */
function signature(entry) {
  const { mods, main } = parseKeys(entry.keys);
  if (main === null) return null;
  return [...mods].sort().concat(main.toLowerCase()).join('+');
}

/**
 * Register a shortcut. Returns a function that removes it again.
 * @param {Partial<Shortcut>} spec
 */
export function register(spec) {
  const entry = {
    group: 'General',
    order: 0,
    keys: [],
    hidden: false,
    onPress: null,
    match: null,
    ...spec,
  };
  if (!entry.id) throw new Error('register: a shortcut needs an id');

  // Dispatch is first-match-wins over insertion order, so two entries claiming the
  // same chord means one of them silently never fires — and the panel goes on
  // advertising both. Nothing here can decide which was meant, so it says so loudly
  // and carries on rather than throwing: a duplicate key is a bug in the bindings,
  // not a reason for the office to fail to start.
  if (entry.onPress) {
    const sig = signature(entry);
    for (const other of registry.values()) {
      if (other.id === entry.id || !other.onPress) continue;
      if (signature(other) !== sig) continue;
      console.warn(
        `shortcuts: '${entry.id}' and '${other.id}' both bind ${entry.keys.join('+')}. ` +
        `'${other.id}' registered first, so it wins and '${entry.id}' will never fire.`,
      );
    }
  }

  registry.set(entry.id, entry);
  return () => registry.delete(entry.id);
}

/** Register a mouse gesture for documentation only — nothing to dispatch. */
export function registerGesture(spec) {
  return register({ ...spec, onPress: null });
}

/**
 * Fire a registered binding as though its key had been pressed.
 *
 * For the places where a click means exactly what a key means — a panel's × standing
 * in for the key that closes it. Going through the registry rather than calling the
 * same code twice is what keeps the two honest: whatever `A` does to the roster is
 * what the roster's × does, including any later change to it.
 *
 * No event is passed, so a binding that needs one is keyboard-only by construction.
 *
 * @param {string} id  the id the binding was registered under
 * @returns {boolean}  whether anything was there to fire
 */
export function press(id) {
  const entry = registry.get(id);
  if (!entry?.onPress) return false;
  entry.onPress();
  return true;
}

/** Everything registered, grouped and ordered, ready to render. */
export function grouped() {
  const byGroup = new Map();
  for (const entry of registry.values()) {
    if (entry.hidden) continue;
    if (!byGroup.has(entry.group)) byGroup.set(entry.group, []);
    byGroup.get(entry.group).push(entry);
  }
  const names = [...byGroup.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return names.map((name) => ({
    name,
    items: byGroup.get(name).sort((a, b) => a.order - b.order),
  }));
}

// One listener for the whole app. Registered at module load, before any world
// exists, so bindings survive project switches.
document.addEventListener('keydown', (event) => {
  if (isTypingTarget(event.target)) return;

  // No blanket modifier guard here any more. It used to live at the top of this
  // handler, which is also why `⌘Z` had to be implemented over in the editor and
  // merely described from here. Each entry now states the modifiers it wants and
  // `defaultMatch` holds it to them exactly, so the protection the guard provided
  // is still in force — it is just expressed per binding instead of once for all.
  for (const entry of registry.values()) {
    if (!entry.onPress) continue;
    const hit = entry.match ? entry.match(event) : defaultMatch(entry, event);
    if (!hit) continue;
    event.preventDefault();
    entry.onPress(event);
    return;
  }
});

/**
 * Write a label into `el`. Two markers are understood:
 *
 *   `{BRACED}`   a panel's name, set in the section-heading face
 *   `` `KEY` ``  a key, set as a key cap like the ones in the left-hand column
 *
 * A row that says "Show/hide ᴀɢᴇɴᴛs panel" is naming the panel headed `Agents` two
 * inches away, and setting the word the way that heading is set is what makes the
 * two obviously the same thing rather than a coincidence of wording. The same
 * argument runs for a key mentioned mid-sentence: a modifier that only applies to
 * part of a gesture cannot go in the keys column without claiming to be the whole
 * binding, but it should still look like a key where it does appear.
 *
 * Built out of text nodes rather than a template string: labels are written by
 * whoever registers a shortcut, and none of them should be able to put markup on
 * the page by writing a label with a `<` in it.
 */
function appendLabel(el, label) {
  for (const part of String(label).split(/(\{[^}]*\}|`[^`]*`)/)) {
    if (!part) continue;
    if (part.startsWith('{') && part.endsWith('}')) {
      const cap = node('span', 'sc-cap', part.slice(1, -1));
      el.appendChild(cap);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      const kbd = node('kbd', '', part.slice(1, -1));
      el.appendChild(kbd);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  }
}

/**
 * The shortcuts panel: a centred modal listing everything in the registry.
 *
 * Rendered on every open rather than once at startup, which is what keeps it
 * honest — whatever is registered by then is what you see.
 */
export function createShortcutsPanel() {
  const host = ensureHost('shortcuts-panel', { className: 'hidden' });

  let open = false;

  const card = node('div', 'sc-card');

  const head = node('div', 'sc-head');

  // The title carries the key that opens it, which is why `?` takes no row in the list
  // below: the one place a reader is certain to see it is the top of the thing it opened,
  // and a list explaining how to open the list you are reading is a row wasted.
  const title = document.createElement('h2');
  title.textContent = 'Keyboard shortcuts';
  const titleKey = document.createElement('kbd');
  titleKey.textContent = '?';
  title.appendChild(titleKey);
  head.append(title, closeButton('Shortcuts', () => hide()));

  const bodyEl = node('div', 'sc-body');

  card.append(head, bodyEl);
  host.appendChild(card);

  // Clicking the backdrop dismisses; clicking the card must not.
  host.addEventListener('click', (e) => { if (e.target === host) hide(); });

  function render() {
    bodyEl.innerHTML = '';
    for (const group of grouped()) {
      const section = node('section', 'sc-group');

      const h = node('h3', '', group.name);
      section.appendChild(h);

      for (const item of group.items) {
        const row = node('div', 'sc-row');

        const keys = node('span', 'sc-keys');
        item.keys.forEach((k, i) => {
          if (i > 0) {
            // `+` for a chord, `/` for a choice. The two used to render alike, so
            // the pair that turns a prop read as though both brackets were held.
            const sep = node('span', 'sc-sep', item.sep ?? '+');
            keys.appendChild(sep);
          }
          const kbd = node('kbd', '', k);
          keys.appendChild(kbd);
        });

        const label = node('span', 'sc-label');
        appendLabel(label, item.label);

        row.append(keys, label);
        section.appendChild(row);
      }

      bodyEl.appendChild(section);
    }
  }

  function show() {
    render();
    open = true;
    host.classList.remove('hidden');
  }

  function hide() {
    open = false;
    host.classList.add('hidden');
  }

  return {
    get isOpen() { return open; },
    show,
    hide,
    toggle() { open ? hide() : show(); },
  };
}
