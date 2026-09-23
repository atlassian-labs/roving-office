// "Where should this scene get its agents?"
//
// A centred modal in the same idiom as the shortcuts panel (press ?): the host
// element is the dismissing backdrop and the card is its only child. Source cards
// sit in a compact grid — one per source — because this is a high-stakes choice for a
// new scene, not a settings row to be squinted at.
//
// The choice is a *set*, not one of several: a scene is a project, and watching your
// Claude session and your Rovo terminal work the same repo side by side is the
// point (docs/developer/protocol/aop-spec.md §3.4). So the options toggle rather than commit, and a
// confirm button applies them — a click can no longer be the whole interaction,
// because "Rovo as well" and "Rovo instead" are different intentions and only the
// user knows which one they are in the middle of.
//
// In the reserved demo office the whole choice is off the table, and `locked` says
// so out loud rather than by inference. Everything that needs an adapter is disabled,
// and the note explains what a disabled button never can: not that the option is
// broken, but that this office is not yours to repoint — with a link to one that is.
// A dead end with a door in it.
//
// Test Data is the one option that behaves differently, because it means two
// different things. Every scene *starts* on it — a new room has to show something,
// and it needs no adapter — so arriving here with it selected says nothing about
// what anyone wanted. The moment a real harness is chosen it steps aside, since
// "point this room at Claude Code" almost never means "and keep the simulated
// agents milling about in it". Ask for it explicitly, though, and it is pinned:
// simulated traffic beside a live feed is a legitimate thing to want (it is how the
// room gets debugged), and having been asked for once it is not taken away again.

import { closeButton, ensureHost, node } from './dom.js';
import { SOURCES, DEFAULT_SOURCE_ID } from '../data/sources.js';
import { renderMark } from './marks.js';

/** What the note says when the office cannot be repointed at all. */
const LOCKED_NOTE = 'This is the shared demo office, so its sources are fixed — '
  + 'Test Data invents its own traffic and needs nothing installed. To point a room '
  + 'at Claude Code, Rovo CLI, Cursor, Codex or OpenClaw, you need an office of your own.';

/** And what it says the rest of the time: sources, as many as you like. */
const OPEN_NOTE = 'Your agents can share one room. Test Data brings simulated agents; '
  + 'the other sources need a connection before anyone walks in.';

/**
 * @returns {{ show(opts?: {current?: ?string[],
 *             testDataPinned?: boolean, locked?: boolean,
 *             onPick: (sourceIds: string[], meta: {testDataPinned: boolean}) => void,
 *             onOpenOwnOffice?: () => void,
 *             onCancel?: () => void}): void,
 *            hide(): void, get isOpen(): boolean }}
 */
export function createSourcePicker() {
  const host = ensureHost('source-picker', { className: 'hidden' });

  let open = false;
  let returnFocus = null;
  let handlers = { onPick: null, onCancel: null, onOpenOwnOffice: null };
  /**
   * Whether this office can be repointed at all.
   *
   * Held here rather than read off the buttons, because `paint()` runs on every
   * toggle and would otherwise have to infer from the DOM what it is about to write
   * back into it.
   */
  let locked = false;
  /** The pending selection, applied on confirm and thrown away on cancel. */
  let chosen = new Set();
  /**
   * Whether Test Data is here because someone asked for it.
   *
   * Travels with the scene rather than being re-derived, because the two states look
   * identical in the selection: "the Test Data every new scene starts with" and "the
   * Test Data I want alongside my live feed" are the same tick in the same box.
   */
  let pinned = false;

  const card = node('div', 'sp-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'sp-title');
  card.setAttribute('aria-describedby', 'sp-description');

  const head = node('div', 'sp-head');
  const title = document.createElement('h2');
  title.id = 'sp-title';
  title.textContent = 'Choose sources';
  const sub = document.createElement('p');
  sub.id = 'sp-description';
  sub.className = 'sp-sub';
  const guide = node('a', '', 'connect your agents via plugins');
  guide.href = '/docs/user/connect-your-agents.html';
  guide.target = '_blank';
  guide.rel = 'noopener noreferrer';
  sub.append('Select one or more sources, and ', guide, '.');
  const illustration = node('img', 'sp-illustration');
  illustration.src = '/assets/arrivals.svg';
  illustration.alt = '';
  illustration.width = 120;
  illustration.height = 84;
  // The same way out the backdrop and Escape already offer, said where it can be seen.
  const headCopy = node('div', 'sp-head-copy');
  headCopy.append(title, sub);
  head.append(headCopy, illustration, closeButton('Choose sources', () => cancel()));

  const grid = node('div', 'sp-grid');

  const buttons = new Map();
  for (const def of SOURCES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sp-option';
    btn.dataset.id = def.id;
    // A toggle, so it is announced as one rather than as a button that navigates.
    btn.setAttribute('aria-pressed', 'false');
    // Source identity belongs to the mark; selection uses the shared action blue.
    btn.style.setProperty('--accent', def.accent);

    const logo = node('span', 'sp-logo');
    logo.innerHTML = renderMark(def.mark);

    const label = node('span', 'sp-label', def.label);

    const blurb = node('span', 'sp-blurb', def.blurb);

    const tag = node('span', 'sp-tag');
    // Say plainly which of these needs something installed. A button that looks
    // identical to Test Data but sits empty for ten minutes is a bug report.
    tag.textContent = def.kind === 'mock' ? 'Ready to explore' : 'Connect to use';
    tag.classList.toggle('ready', def.kind === 'mock');

    // A tick, because a ring alone reads as focus. With several selectable at once
    // the difference between "highlighted" and "chosen" has to be unmistakable.
    const check = node('span', 'sp-check');
    check.setAttribute('aria-hidden', 'true');
    check.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 6.3 L4.8 8.6 L9.5 3.9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    btn.append(check, logo, label, blurb, tag);
    btn.addEventListener('click', () => toggle(def.id));

    buttons.set(def.id, btn);
    grid.appendChild(btn);
  }

  const foot = node('div', 'sp-foot');

  const note = node('p', 'sp-note');

  const noteText = document.createElement('span');
  note.appendChild(noteText);

  // A button rather than an <a>, and deliberately: the keycard does not exist yet,
  // so there is no href to give until the server has cut one. Styled as a link
  // because that is what it behaves like — one click and you are somewhere else —
  // and a button is the honest element for something that has to ask first.
  const ownOffice = document.createElement('button');
  ownOffice.type = 'button';
  ownOffice.className = 'sp-link';
  ownOffice.textContent = 'Open a new office';
  ownOffice.hidden = true;
  ownOffice.addEventListener('click', () => {
    const { onOpenOwnOffice } = handlers;
    // Left open behind the navigation: closing it would flash the room the click
    // was a decision to leave.
    onOpenOwnOffice?.();
  });
  note.append(document.createTextNode(' '), ownOffice);

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'sp-confirm';
  confirm.addEventListener('click', () => {
    // A locked card has nothing to apply: the office is not ours to repoint, and a
    // confirm that quietly PATCHed the demo office back to the sources it already
    // had would be writing to a shared room to achieve nothing. So it is a way out
    // of the card, and says as much (see `paint`).
    if (locked) return hide();
    // Nothing chosen is not a selection, it is a cancellation with extra steps —
    // and a scene with no feeds is the state the picker exists to resolve.
    if (chosen.size === 0) return;
    const { onPick } = handlers;
    const ids = orderedIds();
    // Only meaningful while Test Data is actually in the set; storing a pin for a
    // source that is not there would resurrect the rule the next time it appeared.
    const testDataPinned = pinned && chosen.has(DEFAULT_SOURCE_ID);
    hide();
    onPick?.(ids, { testDataPinned });
  });

  foot.append(note, confirm);

  card.append(head, grid, foot);
  host.appendChild(card);

  // Backdrop click cancels; a click inside the card must not.
  host.addEventListener('click', (e) => { if (e.target === host) cancel(); });
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    // The office's shortcuts must stay behind the modal. Browser shortcuts and
    // native button activation still work because their defaults are preserved.
    e.stopPropagation();
    if (e.key === 'Escape') {
      // Stop the global Esc handler from also clearing the selection behind us.
      cancel();
    } else if (e.key === 'Tab') {
      // Keep keyboard focus in the modal, including when options are disabled in
      // the demo. Enter retains native button behaviour: toggle, close or apply.
      const controls = [...card.querySelectorAll('a[href], button:not(:disabled)')]
        .filter((control) => !control.hidden);
      const first = controls[0];
      const last = controls.at(-1);
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !card.contains(active))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (active === last || !card.contains(active))) {
        e.preventDefault();
        first?.focus();
      }
    }
  }, true);

  /** Registry order, not click order: it is the order shown everywhere else. */
  function orderedIds() {
    return SOURCES.filter((def) => chosen.has(def.id)).map((def) => def.id);
  }

  /**
   * Turn one option on or off, and apply the Test Data rule described above.
   *
   * Choosing a live harness drops an unpinned Test Data; choosing Test Data itself
   * pins it for good. Turning it off again unpins it, so the scene goes back to
   * having no opinion rather than remembering one it no longer holds.
   */
  function toggle(id) {
    if (chosen.has(id)) {
      chosen.delete(id);
      if (id === DEFAULT_SOURCE_ID) pinned = false;
    } else {
      chosen.add(id);
      if (id === DEFAULT_SOURCE_ID) pinned = true;
      else if (!pinned) chosen.delete(DEFAULT_SOURCE_ID);
    }
    paint();
  }

  function paint() {
    for (const [id, btn] of buttons) {
      const on = chosen.has(id);
      btn.classList.toggle('selected', on);
      btn.setAttribute('aria-pressed', String(on));
      // Locked disables everything that needs an adapter, and leaves Test Data
      // alone: it is what the room is already running on, and a card with every
      // option greyed out looks broken rather than reserved. `disabled` is what
      // does the work — the class is only so the styling can follow.
      const off = locked && id !== DEFAULT_SOURCE_ID;
      btn.disabled = off;
      btn.classList.toggle('locked', off);
    }
    const n = chosen.size;
    // Locked, the button is the only thing on the card that still does anything, and
    // what it does is close it. "Choose at least one" would be an instruction there is
    // no way to follow, and "Fill the scene" an offer we would not honour.
    if (locked) {
      confirm.disabled = false;
      confirm.textContent = 'Close';
      return;
    }
    confirm.disabled = n === 0;
    confirm.textContent = n === 0
      ? 'Choose at least one'
      : `Use ${n === 1 ? 'this source' : `${n} sources`}`;
  }

  function show({
    current = null, testDataPinned = false, locked: lock = false,
    onPick, onOpenOwnOffice, onCancel,
  } = {}) {
    handlers = { onPick, onOpenOwnOffice, onCancel };
    if (!open) returnFocus = document.activeElement;
    locked = Boolean(lock);
    noteText.textContent = locked ? LOCKED_NOTE : OPEN_NOTE;
    // No door without something to open it: a link that led nowhere would be worse
    // than the dead end it was meant to relieve.
    ownOffice.hidden = !locked || !onOpenOwnOffice;
    // Start from what the scene already has, so re-opening the picker to add a
    // second source does not silently propose replacing the first.
    chosen = new Set(Array.isArray(current) ? current : [current].filter(Boolean));
    pinned = Boolean(testDataPinned);
    paint();
    open = true;
    host.classList.remove('hidden');
    // Focus the first option that can actually be operated — the first button in the
    // grid is disabled when locked, and focusing it would put the keyboard nowhere.
    firstEnabled()?.focus();
  }

  /** The first option a keyboard can reach, or the confirm button if none can. */
  function firstEnabled() {
    for (const btn of buttons.values()) if (!btn.disabled) return btn;
    return confirm.disabled ? null : confirm;
  }

  function hide() {
    if (!open) return;
    open = false;
    host.classList.add('hidden');
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  function cancel() {
    const { onCancel } = handlers;
    hide();
    onCancel?.();
  }

  return {
    get isOpen() { return open; },
    show,
    hide,
  };
}
