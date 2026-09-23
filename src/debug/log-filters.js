// Four questions you can ask a log of two thousand events.
//
// A log this size is only useful if you can put a question to it, and there are
// exactly four worth a control of its own, because they are the four ways a reader
// already thinks about what they are watching:
//
//   - **Who, in the room** — one character, followed through everything they did.
//     The reason this page knows about characters at all (see agents/cast.js).
//   - **What kind of thing** — one event type, which is how you answer "are the
//     tool calls arriving?" without reading a single summary.
//   - **Who sent it** — one harness, for when two adapters are running and only one
//     of them is misbehaving.
//   - **Anything at all** — free text, over the whole envelope rather than the line,
//     because the value you are hunting for is usually one the summary had no room
//     for: a tool call id, a file path, a model name.
//
// They compose, and they are all *views*: filtering hides rows, it never drops
// events. A log that discarded what it was not showing would answer the next
// question with a lie, and the next question always comes.

import { node } from '../ui/dom.js';
import { searchText } from './event-row.js';

/**
 * How long after the last keystroke the list is rebuilt.
 *
 * Long enough that typing a word costs one rebuild rather than five, short enough
 * that it still feels like the list is answering you as you type.
 */
const TYPING_MS = 120;

/** Families in reading order, so the type list groups the way the colours do. */
const FAMILY_ORDER = ['session', 'turn', 'tool', 'attention', 'job', 'presence', 'other'];

const FAMILY_LABEL = {
  session: 'Sessions', turn: 'Turns', tool: 'Tools', attention: 'Attention',
  job: 'Jobs', presence: 'This office', other: 'Other',
};

/**
 * Build the filter strip.
 *
 * @param {{host: ?HTMLElement, onChange: function(): void}} options
 *   `onChange` is called when the answer to `matches` may have changed — the caller
 *   owns the rows and is the only thing that can rebuild them. `host` is the element
 *   from the page's own markup, built into rather than replaced so the strip sits
 *   where the document says it does.
 */
export function createLogFilters({ host = null, onChange }) {
  const state = { text: '', character: '', type: '', sender: '' };
  let typing = null;

  const element = host ?? document.createElement('div');
  element.classList.add('log-filters');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Filter the log');

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'lf-search';
  search.placeholder = 'Search events…';
  search.setAttribute('aria-label', 'Search events');
  search.title = 'Matches the whole event, not just the line. Several words all have to match.';
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      state.text = search.value.trim().toLowerCase();
      changed();
    }, TYPING_MS);
  });
  // Escape empties the box rather than only blurring it, which is what a reader who
  // has finished with a search means by it.
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !search.value) return;
    e.preventDefault();
    search.value = '';
    clearTimeout(typing);
    state.text = '';
    changed();
  });

  const character = select('character', 'Everybody', 'Filter by character');
  const type = select('type', 'Every event', 'Filter by event type');
  const sender = select('sender', 'Every sender', 'Filter by the harness that sent it');

  // "Clear filters" rather than "Clear", which the strip above already uses for
  // emptying the log: two buttons a few pixels apart, one of which throws away your
  // events and one of which gives them back, must not be a guess.
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'lc-button lf-reset';
  reset.textContent = 'Clear filters';
  reset.addEventListener('click', () => {
    clear();
    changed();
    search.focus();
  });

  element.append(search, character, type, sender, reset);
  sync();

  function select(key, allLabel, label) {
    const el = node('select', `lf-select lf-${key}`);
    el.setAttribute('aria-label', label);
    el.title = label;
    el.addEventListener('change', () => {
      state[key] = el.value;
      changed();
    });
    // The "no filter" row is built here and kept: rebuilding the options must never
    // be able to lose it.
    el.append(option('', allLabel));
    el.dataset.all = allLabel;
    return el;
  }

  function option(value, label) {
    const el = document.createElement('option');
    el.value = value;
    el.textContent = label;
    return el;
  }

  function active() {
    return Boolean(state.text || state.character || state.type || state.sender);
  }

  function clear() {
    state.text = state.character = state.type = state.sender = '';
    clearTimeout(typing);
    search.value = '';
    character.value = type.value = sender.value = '';
    sync();
  }

  /**
   * Make the strip look like what it is doing.
   *
   * Split from `changed` so that clearing the filters tidies the strip whether or not
   * anybody asked for a rebuild: a control left looking active while filtering nothing
   * is a lie about the page underneath it.
   */
  function sync() {
    element.classList.toggle('on', active());
    // Each dropdown says whether it is the one doing the hiding: with three of them in
    // a row, "why is this page half empty" must be answerable without opening any.
    for (const [key, el] of [['character', character], ['type', type], ['sender', sender]]) {
      el.classList.toggle('set', Boolean(state[key]));
    }
    reset.disabled = !active();
  }

  function changed() {
    sync();
    onChange();
  }

  /**
   * Refill one dropdown from what has actually been seen.
   *
   * Counts are shown because they answer the question before you ask it — a type list
   * that says `tool.start (0)` has already told you the adapter is not sending them.
   * The current selection is kept even when its count falls to zero, so you can put a
   * filter up and *wait* for the thing you are watching for; and rebuilding preserves
   * it rather than silently widening the view back out.
   *
   * @param {HTMLSelectElement} el
   * @param {Array<{value: string, label: string, count: number, group?: string}>} items
   */
  function fill(el, items) {
    const chosen = el.value;
    el.replaceChildren(option('', el.dataset.all));

    let group = null;
    let host = el;
    for (const item of items) {
      if (item.group && item.group !== group) {
        group = item.group;
        host = document.createElement('optgroup');
        host.label = FAMILY_LABEL[group] ?? group;
        el.append(host);
      } else if (!item.group) {
        host = el;
      }
      host.append(option(item.value, `${item.label} (${item.count})`));
    }

    // A chosen value that has aged out of the retained events would otherwise
    // disappear from the list and take the filter with it.
    if (chosen && !items.some((item) => item.value === chosen)) {
      el.append(option(chosen, `${chosen} (0)`));
    }
    el.value = chosen;
  }

  return {
    element,
    active,
    clear,
    focusSearch() {
      search.focus();
      search.select();
    },

    /**
     * Whether a row should be on screen.
     *
     * Cheap tests first, and the text last: it is the only one that has to build
     * anything, and by the time a search is running the dropdowns have usually
     * already thrown most of the page away.
     */
    matches(entry) {
      if (state.type && entry.type !== state.type) return false;
      if (state.sender && entry.senderId !== state.sender) return false;
      // A subagent's errand is filed under the agent who sent it (see cast.js), so
      // filtering to a character keeps the work they delegated.
      if (state.character && entry.character?.key !== state.character) return false;
      if (!state.text) return true;
      const haystack = searchText(entry);
      // Every word has to match, in any order: two words are how you narrow a search
      // that a single one left with sixty rows in it.
      return state.text.split(/\s+/).every((word) => haystack.includes(word));
    },

    /**
     * Offer what the retained events actually contain.
     *
     * @param {{characters: Array, types: Array, senders: Array}} facets
     */
    setFacets(facets) {
      fill(character, facets.characters);
      fill(type, facets.types);
      fill(sender, facets.senders);
    },
  };
}

/**
 * Count what can be filtered on, in one pass over the retained events.
 *
 * Kept next to the controls it feeds rather than in the page, because the shape it
 * produces and the shape the dropdowns want are the same decision — and it is a pass
 * over everything the log remembers, so it happens once per rebuild and not per event.
 *
 * @param {Array<object>} entries  newest last
 * @returns {{characters: Array, types: Array, senders: Array}}
 */
export function countFacets(entries) {
  const characters = new Map();
  const types = new Map();
  const senders = new Map();

  for (const entry of entries) {
    if (entry.character?.key) {
      const seen = characters.get(entry.character.key);
      if (seen) seen.count++;
      else characters.set(entry.character.key, { value: entry.character.key, label: entry.character.name, count: 1 });
    }
    if (entry.type) {
      const seen = types.get(entry.type);
      if (seen) seen.count++;
      else types.set(entry.type, { value: entry.type, label: entry.type, count: 1, group: entry.family });
    }
    if (entry.senderId) {
      const seen = senders.get(entry.senderId);
      if (seen) seen.count++;
      else senders.set(entry.senderId, { value: entry.senderId, label: entry.senderLabel ?? entry.senderId, count: 1 });
    }
  }

  // Characters and senders by name, so the list does not reorder itself under the
  // cursor as events arrive; types by family, to match the colours down the page.
  const byLabel = (a, b) => a.label.localeCompare(b.label);
  return {
    characters: [...characters.values()].sort(byLabel),
    types: [...types.values()].sort((a, b) => {
      const family = FAMILY_ORDER.indexOf(a.group) - FAMILY_ORDER.indexOf(b.group);
      return family || byLabel(a, b);
    }),
    senders: [...senders.values()].sort(byLabel),
  };
}
