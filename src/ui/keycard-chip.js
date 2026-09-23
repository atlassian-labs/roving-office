// The keycard, in the title bar.
//
// It is here because it is the only way back into this office: nothing lists offices,
// and losing the keycard loses the room. A code that mattered that much and lived only
// in the address bar would be a code people lose, so it is shown in full, in monospace.
//
// Clicking it opens the office's own dialog (src/ui/keycard-dialog.js) rather than
// copying the link, which is a deliberate demotion of a one-click convenience. Copying
// is still one of the four things in there, beside the headcount, the passcode and
// closing the office — and all four are answers to "who can get in here", which is what
// somebody clicking a keycard is asking. A dialog is also where a destructive control
// can live honestly; a button that sometimes copied a link and sometimes closed an
// office would not be.
//
// The dot beside it means the machine's local adapters are posting into *this*
// office (see src/office.js `claimLocalEndpoint`). There is one endpoint file per
// machine holding one URL, so this is genuinely exclusive — and worth saying out
// loud, because the alternative is wondering why your Claude session walked into a
// different room.

import { ensureHost, node } from './dom.js';

/** How long the "copied" acknowledgement stays up. */
const FLASH_MS = 1600;

/**
 * @param {object} opts
 * @param {string} opts.keycard
 * @param {() => void} [opts.onOpen]  what a click means. Without one the chip falls
 *   back to copying the link, which is what it did before there was a dialog — the
 *   debug log has no office controls to offer and should not grow half of them.
 * @returns {{ setOffice(info: ?object): void }}
 */
export function createKeycardChip({ keycard, onOpen = null }) {
  const host = ensureHost('keycard-chip', { className: 'keycard-chip' });
  host.innerHTML = '';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kc-button';
  button.title = onOpen
    ? 'Office keycard — the link, the passcode, who is here, and closing the office'
    : 'Office keycard — copy a link to this office';
  if (onOpen) button.setAttribute('aria-haspopup', 'dialog');

  const code = node('span', 'kc-code', keycard);

  const dot = node('span', 'kc-dot');
  dot.hidden = true;
  dot.title = 'Agents from this machine walk in here';

  /**
   * A padlock when this office asks visitors for a passcode.
   *
   * Worth a glyph in the title bar because it is the one thing about an office that
   * nobody standing inside it can otherwise tell — the room looks identical either way —
   * and it is exactly what an owner wants confirmed in the second before they paste the
   * link somewhere. Its absence says as much as its presence, which is why it is shown
   * rather than only stated inside the dialog.
   */
  const lock = node('span', 'kc-lock');
  lock.hidden = true;
  lock.setAttribute('aria-hidden', 'true');
  lock.innerHTML = '<svg viewBox="0 0 12 12" width="10" height="10" fill="none">'
    + '<rect x="2.5" y="5.25" width="7" height="5.25" rx="1" fill="currentColor"/>'
    + '<path d="M4.25 5.25V4a1.75 1.75 0 0 1 3.5 0v1.25" stroke="currentColor" stroke-width="1.2"/></svg>';

  const note = node('span', 'kc-note');
  note.setAttribute('role', 'status');

  button.append(code, lock, dot);
  host.append(button, note);

  let flash = null;

  button.addEventListener('click', async () => {
    if (onOpen) return onOpen();
    // No dialog here (the debug log), so the chip does what it always did: copy the
    // link, because what someone wants to paste into a chat is a thing the recipient
    // can click, and the keycard on its own asks them to know where to type it.
    try {
      await navigator.clipboard.writeText(window.location.href);
      say('Link copied');
    } catch {
      // Clipboard access is refused in plenty of ordinary situations (no HTTPS, no
      // permission). Pointing at the address bar is a hand-hold, not a failure message.
      say('Copy it from the address bar');
    }
    return undefined;
  });

  function say(message) {
    note.textContent = message;
    if (flash) clearTimeout(flash);
    flash = setTimeout(() => { note.textContent = ''; }, FLASH_MS);
  }

  return {
    /** Reflect the office document: whether we hold the local feed, and whether it locks. */
    setOffice(info) {
      dot.hidden = !info?.claimed;
      lock.hidden = !info?.passcode;
      lock.title = info?.passcode ? 'This office asks visitors for a passcode' : '';
    },
  };
}
