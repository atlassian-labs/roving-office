// A short invitation on arrival, the way further in, and the one thing that ends it
// early.
//
// It sits bottom-centre at z-index 25, which is directly over the strips along the
// bottom of the screen. That was fine while it was the only thing on screen and
// wrong the moment it was not: an invitation to go and look at something, printed
// on top of the thing you just opened, is an obstruction wearing an invitation's
// words. So it yields. Open any panel and the hint's time is up, whether you
// opened it with a key, with the mouse, or by reloading into a room that
// remembered it open (see panel-state.js — that last case is why the question is
// asked at creation as well as watched for afterwards).
//
// The watching is one rule rather than a dismissal wired into each opener. Every
// panel here is shown and hidden by taking the `hidden` class off the host the
// markup gave it, so "a panel appeared" is one observation over one list — where
// a hand-wired call per panel would be one chance per panel to forget the next
// one. That was not hypothetical: the keycard dialog arrived on `main` while this
// was being written, and joining the list was the whole of covering it.
//
// The dismissal is per page load and deliberately not remembered: the hint is an
// arrival, and an arrival that only ever happens once is not an arrival. Its own
// × and its own fade are untouched.

import { node } from './dom.js';

const VISIBLE_MS = 20_000;
const FADE_MS = 600;

/**
 * Every panel a person can deliberately open, by the id its host carries.
 *
 * The agents roster is not one of them, on two counts: it ships *open*, so
 * counting it would mean the invitation never appeared at all, and it lives in the
 * opposite corner of the screen, where it never covered this. Nor is the
 * first-person caption, which cannot reach the screen without a selected agent —
 * and selecting one opens the detail panel, which is on the list.
 */
const PANELS = [
  'scene-panel',
  'dev-panel',
  'editor-panel',
  'inspector',
  'source-picker',
  'shortcuts-panel',
  'keycard-dialog',
];

/** Is one of them on screen? On screen is the host without its `hidden` class. */
function aPanelIsOpen() {
  return PANELS.some((id) => {
    const host = document.getElementById(id);
    return !!host && !host.classList.contains('hidden');
  });
}

/**
 * Show the invitation, unless there is no moment for it to occupy.
 *
 * Call it *after* the panels have been built and restored, or the question below
 * is asked of the markup's opening state rather than of the room as it now is.
 *
 * @returns {?{dismiss: () => void, isShowing: boolean}} null when nothing was shown
 */
export function createWelcomeHint() {
  if (['none', 'minimal'].includes(document.body.dataset.chrome)) return null;
  // A reload into a room whose Scene strip was left open arrives with a panel
  // already on screen, so there is nothing here to invite anybody into.
  if (aPanelIsOpen()) return null;

  const hint = node('aside', 'welcome-hint');
  hint.setAttribute('aria-label', 'Welcome to the demo');
  const copy = node('span', 'welcome-copy');
  copy.append(node('strong', '', 'Watch. Play. Discover.'), " (You can't break anything)");
  const shortcuts = node('span', 'welcome-shortcuts');
  shortcuts.append('If lost, type ', node('kbd', '', '?'), '.');

  /*
   * The other question, and it is addressed to the other reader.
   *
   * `?` answers "how do I drive this", to a person. The line beside it is written to an
   * *agent* — which is not a joke, it is who tends to be looking: somebody pastes a
   * screenshot of the room into a session, or an agent is driving the browser itself. The
   * page it points at is a document written to be fetched and executed, so an agent that
   * reads "If agent, setup yourself" has both the instruction and the means.
   *
   * For a person it still reads as the answer to "how do I get *my* agents in here",
   * which until this link nothing in the running app answered — somebody could watch a
   * busy office for ten minutes without learning it was one pasted sentence away.
   *
   * **A new tab, not this one.** Every other link in the office does the same, for a
   * reason worth stating: navigating the office away loses the room, the camera and the
   * selection, and this hint's whole job is to invite somebody further in rather than
   * out. `rel` goes with `target` as it always must.
   *
   * Root-relative, not origin-absolute: an office on Fly and one on a laptop are
   * different origins and only one of them could ever be written down here. Same rule as
   * `src/ui/dev-panel.js`, which has the longer version of this note.
   */
  const invite = node('span', 'welcome-invite');
  const setup = node('a', '', 'setup yourself');
  setup.href = '/agent-setup/';
  setup.target = '_blank';
  setup.rel = 'noopener noreferrer';
  invite.append('If agent, ', setup, '.');

  const close = node('button', 'welcome-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss welcome hint');
  close.addEventListener('click', () => dismiss());
  hint.append(copy, ' ', shortcuts, ' ', invite, close);
  document.getElementById('ui').appendChild(hint);

  let removeTimer = null;
  const fadeTimer = setTimeout(() => {
    hint.classList.add('is-leaving');
    removeTimer = setTimeout(() => hint.remove(), FADE_MS);
  }, VISIBLE_MS);

  let showing = true;
  let watch = null;

  /** Gone now, not faded: a panel is already using the space. */
  function dismiss() {
    if (!showing) return;
    showing = false;
    clearTimeout(fadeTimer);
    clearTimeout(removeTimer);
    watch?.disconnect();
    hint.remove();
  }

  // One observation of one list, over every route a panel can be opened by. Guarded
  // the way watchStripRows() guards ResizeObserver: a page without it keeps the fade
  // and the ×, which is the behaviour this replaced. The hosts are the ones the markup
  // carries — ensureHost() reuses them rather than replacing them — so observing them
  // before the editor builds its own strip is still observing the right nodes.
  if (typeof MutationObserver !== 'undefined') {
    watch = new MutationObserver(() => { if (aPanelIsOpen()) dismiss(); });
    for (const id of PANELS) {
      const host = document.getElementById(id);
      if (host) watch.observe(host, { attributes: true, attributeFilter: ['class'] });
    }
  }

  return { dismiss, get isShowing() { return showing; } };
}
