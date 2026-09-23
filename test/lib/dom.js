//
// A page, for the chrome that is built against `document`.
//
// The panels, the switcher, the Add-item menu and the editor's own row are all built
// imperatively out of `document.createElement`, and there is no DOM library here — the
// scene modules stub what they need (see `bin/lib/headless-scene.js`) and the chrome
// stubbed what it needed too, four times over, once per test file. Each copy grew the
// handful of properties its own control happened to touch, so the four had drifted into
// four different partial browsers: one detached a removed node and one did not, one
// answered `contains` truthfully and one always said no, one looked children up by tag
// and one by class.
//
// That is the failure mode a shared stub exists to prevent. A stub is a claim about what
// a browser does, and four files making four different claims means a control can pass
// its own test by relying on an answer no other test would have given it — and, worse,
// that the copy which is right about something cannot lend it to the copy which is not.
//
// So this is one page, and it answers as a browser would wherever the copies disagreed:
// a removed node leaves its parent, `contains` walks the tree, `querySelector` takes a
// class or a tag, and setting `innerHTML` to '' empties the element. What is left to the
// caller is only the two things a browser genuinely cannot be asked in Node — where an
// element is on screen and how tall it is — plus which of `document`'s own listeners the
// test wants kept, because a click that bubbles to a handler the old copy dropped on the
// floor is a different click.
//
// `node --test` treats every file under `test/` as a test file, so this one is reported
// in the run as a file with no tests in it — the same cost `frames.js` and `room.js` pay
// for sitting beside their callers.
//

/** Where an element is, when nobody has said. */
const NOWHERE = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };

/** Words with nowhere else to be: a child that carries text and nothing else. */
function textNode(words) {
  return { textContent: String(words), children: [], parent: null };
}

/**
 * Just enough element: classes, attributes, children, values, clicks.
 *
 * `page` is what an element cannot answer on its own — the layout it has none of, and
 * the `document` listeners a click of it should reach.
 *
 * @param {string} tag
 * @param {object} page
 */
function element(tag, page) {
  let html = '';
  const el = {
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    type: '',
    title: '',
    value: '',
    maxLength: 0,
    hidden: false,
    disabled: false,
    // A checkbox's state. Present by default so a control that only ever reads it —
    // the kit menu's switches ask `input.checked` in their change handler — sees false
    // rather than undefined on an input nobody has set.
    checked: false,
    focused: false,
    textContent: '',
    // `segmented()` tags its buttons with a `data-key`, and a switcher row with the id of
    // the scene it stands for.
    dataset: {},
    style: { setProperty() {} },
    children: [],
    // Deliberately never filled. `append` and `appendChild` take real nodes and text
    // nodes alike into `children`, which is the one list every lookup here walks; the
    // panel's hint reads `childNodes.length` only to decide whether a separator is due,
    // and a stub with no text nodes of its own has none owing.
    childNodes: [],
    parent: null,
    attrs: new Map(),
    listeners: new Map(),
    get innerHTML() { return html; },
    // Setting it to '' is how the switcher empties the menu before a rebuild, so the
    // children have to go with it or every rebuild would double the list.
    set innerHTML(value) { html = value; if (value === '') el.children = []; },
    classList: {
      add(...names) {
        el.className = [...new Set(el.className.split(' ').filter(Boolean).concat(names))].join(' ');
      },
      remove(...names) {
        el.className = el.className.split(' ').filter((c) => c && !names.includes(c)).join(' ');
      },
      contains(name) { return el.className.split(' ').includes(name); },
      toggle(name, on) {
        if (on ?? !el.classList.contains(name)) el.classList.add(name);
        else el.classList.remove(name);
      },
    },
    setAttribute(name, value) { el.attrs.set(name, String(value)); },
    getAttribute(name) { return el.attrs.get(name) ?? null; },
    removeAttribute(name) { el.attrs.delete(name); },
    addEventListener(type, fn) {
      el.listeners.set(type, [...(el.listeners.get(type) ?? []), fn]);
    },
    // `append` takes words as well as nodes, which is what a browser does and what the
    // welcome hint's " (You can't break anything)" relies on — a bare string reached
    // `appendChild` and threw, because a module is strict and a string primitive will
    // not take a `parent`. Wrapped the way the browser wraps it, in a text node.
    append(...nodes) {
      for (const node of nodes) {
        el.appendChild(typeof node === 'string' ? textNode(node) : node);
      }
      return nodes.at(-1);
    },
    appendChild(node) { node.parent = el; el.children.push(node); return node; },
    replaceChildren(...nodes) { el.children = [...nodes]; },
    // Actually detaches. A stub that only flagged itself removed left every sheet the
    // suite had ever opened sitting on the shared body, and the next test found the
    // wrong one — three failures from one lazy line.
    remove() {
      const kids = el.parent?.children;
      if (kids) kids.splice(kids.indexOf(el), 1);
      el.parent = null;
    },
    contains(node) {
      if (node === el) return true;
      return el.children.some((c) => c.contains?.(node));
    },
    focus() { el.focused = true; },
    select() {},
    /** The two selector shapes the chrome uses: a class, or a tag. */
    querySelector(selector) {
      const wantClass = selector.startsWith('.') ? selector.slice(1) : null;
      const wantTag = wantClass ? null : selector.toUpperCase();
      for (const child of el.children) {
        if (wantClass ? child.classList?.contains(wantClass) : child.tagName === wantTag) return child;
        const deeper = child.querySelector?.(selector);
        if (deeper) return deeper;
      }
      return null;
    },
    // Overridable per page, because *where* the trigger is decides where the sheet is
    // put — and a sheet put off the top of the window is the bug that made the courier
    // switch unclickable while every test of it passed.
    getBoundingClientRect() { return page.rectOf(el); },
    // A stub has no layout, so it answers with the height the stylesheet gives it.
    get offsetHeight() { return page.heightOf(el); },
    get offsetWidth() { return page.widthOf(el); },
    /** Any event, by hand: a keydown with a key on it, a blur, a click. */
    fire(type, event = {}) {
      for (const fn of el.listeners.get(type) ?? []) fn({ stopPropagation() {}, ...event });
    },
    /**
     * A click, reporting whether the handler stopped it reaching the room.
     *
     * It bubbles, and it has to: a menu shuts itself from a listener on `document`, so a
     * stub whose clicks never reached one would make the click-outside tests pass by
     * doing nothing. Verified by reverting the fix and watching them go red.
     */
    click() {
      let stopped = false;
      const ev = { target: el, stopPropagation() { stopped = true; } };
      for (const fn of el.listeners.get('click') ?? []) fn(ev);
      if (!stopped) for (const fn of page.listenersFor('click')) fn(ev);
      return stopped;
    },
  };
  return el;
}

/**
 * A stubbed page, installed as `globalThis.document` and `globalThis.window`.
 *
 * Call it before importing the module under test: the chrome reads `document` while it
 * is being built, so it has to be there first.
 *
 * `documentEvents` is which of the listeners the chrome puts on `document` are kept —
 * none, by default, so a click lands only where it was aimed. Name `'click'` and the
 * control's own click-outside handler comes to life, which is what a test of shutting
 * the thing by clicking elsewhere needs and what a test of anything else does not.
 *
 * @param {object} [options]
 * @param {number} [options.innerHeight]      the height of the window
 * @param {number} [options.innerWidth]       the width of it, which an overlay clamped
 *   into the window has to be able to ask about as well
 * @param {string} [options.pathname]         the page the office is being viewed from
 * @param {string[]} [options.documentEvents] event types `document` keeps listeners for
 * @param {(el: object) => object} [options.rectOf]   where an element is on screen
 * @param {(el: object) => number} [options.heightOf] how tall an element is
 * @param {(el: object) => number} [options.widthOf]  and how wide
 * @returns {{byId: Map<string, object>, document: object, window: object}}
 */
export function stubPage({
  innerHeight = 1000,
  innerWidth = 1600,
  pathname = '/',
  documentEvents = [],
  rectOf = () => ({ ...NOWHERE }),
  heightOf = () => 0,
  widthOf = () => 0,
} = {}) {
  const kept = new Map();
  const page = {
    rectOf,
    heightOf,
    widthOf,
    listenersFor: (type) => kept.get(type) ?? [],
  };
  const make = (tag) => element(tag, page);

  /** Hosts the markup would have carried, which a stub page has to be handed. */
  const byId = new Map();

  const document = {
    createElement: make,
    // A text node is a child with words and nothing else, which is all the blurb needs
    // it to be: the sentence around the lozenges is built out of these.
    createTextNode: textNode,
    getElementById: (id) => byId.get(id) ?? null,
    addEventListener(type, fn) {
      if (documentEvents.includes(type)) kept.set(type, [...(kept.get(type) ?? []), fn]);
    },
    body: make('body'),
  };
  const window = { innerHeight, innerWidth, location: { pathname }, addEventListener() {} };

  globalThis.document = document;
  globalThis.window = window;
  return { byId, document, window };
}

/** Every descendant, so a lookup can walk the tree the way a selector would. */
export function all(node, out = []) {
  for (const child of node.children ?? []) { out.push(child); all(child, out); }
  return out;
}
