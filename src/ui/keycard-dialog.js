// The keycard, opened: everything an office is yours to decide.
//
// Four controls, and they are in one dialog rather than four places on purpose. Copying
// the link, seeing who is in the room, putting a passcode on it and closing it are all
// answers to a single question — *who can get in here* — and a person asking it should
// find them together. Scattered across a menu, a badge and a settings strip they would
// be four features; behind the keycard they are one subject, reached by clicking the
// thing the whole subject is about.
//
// The dialog is in the same idiom as the source picker: the host element is the
// dismissing backdrop and the card is its only child, Escape and a backdrop click close
// it, and Tab is trapped inside.
//
// **Two of the four need the office's write token** (src/office/owner.js), and what
// happens without one is the design decision worth stating. They are not hidden — a
// missing control teaches nobody anything, and "why can I not close this office?" is
// exactly the question this dialog exists to answer. They are disabled, with one
// sentence saying what is missing and that it is not recoverable, because there are no
// accounts to recover through. A dead end with an explanation in it.
//
// A fifth section followed from the first four, and it is about the *other* offices:
// until this dialog existed, cutting a new office, seeing the ones you had been in and
// walking into an office somebody sent you the keycard for were all only reachable at
// reception, so from inside a room the only way to any of them was to navigate out of it.
// All three are here now, because "which offices are mine" is the same question as "who
// can get into this one" asked one level up. The recent list deserves more care than a
// browser history would: src/office/recent.js is the *only* record anywhere that your
// offices exist — there is no server-side list and a keycard is the only way back in — so
// it is closer to a key ring, and a row that disappeared without explanation would be a
// lost office rather than a tidied list.
//
// The four subjects are a **two-column grid** and the key ring runs under both of them;
// `.kd-grid` in styles.css says which cell is where and why, and the sections are in that
// reading order in the DOM rather than placed by CSS.

import { closeButton, ensureHost, node } from './dom.js';
import { agoWords } from './format.js';
import { wireKeycardField } from './keycard-field.js';
import { LENGTH, officeUrl } from '../office/keycard.js';
import { checkRecent, listRecent } from '../office/recent.js';

/** How long "Link copied" stays up. The chip used the same number. */
const FLASH_MS = 1600;

/**
 * What the dialog says to somebody who is only a visitor here.
 *
 * Deliberately not "you are not the owner", which invites a search for a login. The
 * office has no owners in any sense a login would recognise — it has a token, this
 * browser has not got it, and that is a fact about storage rather than about identity.
 */
const NOT_OWNER = 'Only the browser that opened this office can change its passcode or '
  + 'close it. There are no accounts here, so there is nothing to sign in to: the office '
  + 'remembered itself in the browser that cut its keycard.';

/** And to its owner, about what the passcode is and is not for. */
const PASSCODE_NOTE = 'A passcode is asked of anyone opening the link. It does not hide '
  + 'what your agents send — that is set where they run — and it cannot un-see anything '
  + 'already read. Change it to lock every browser out again.';

/**
 * @param {object} opts
 * @param {string} opts.keycard
 * @param {() => boolean} opts.isOwner
 * @param {(passcode: ?string) => Promise<{ok: boolean, reason?: string, passcode?: boolean}>} opts.onPasscode
 * @param {() => Promise<{ok: boolean, reason?: string}>} opts.onClose
 * @param {() => Promise<{ok: boolean, reason?: string}>} opts.onOpenAnother  cut a new
 *   office and walk into it. Handed in rather than reached for, like the other two, so
 *   this file does no fetching — and so the one existing mint path is reused rather than
 *   a second one written beside it.
 * @returns {{ show(info: ?object): void, hide(): void, setOffice(info: ?object): void,
 *            get isOpen(): boolean }}
 */
export function createKeycardDialog({ keycard, isOwner, onPasscode, onClose, onOpenAnother }) {
  const host = ensureHost('keycard-dialog', { className: 'hidden' });

  let open = false;
  let returnFocus = null;
  /** The office document as last seen, so a repaint needs no round trip. */
  let info = null;
  /** Which shape the passcode section is in: 'idle', 'setting' or 'closing'. */
  let mode = 'idle';
  /** True while a request is out, so a second click cannot send a second one. */
  let busy = false;

  const card = node('div', 'kd-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'kd-title');

  // --- the keycard itself, and the link ---
  const head = node('div', 'kd-head');
  const title = node('h2', '', 'This office');
  title.id = 'kd-title';
  const cardCode = node('p', 'kd-keycard', keycard);
  const headCopy = node('div', 'kd-head-copy');
  headCopy.append(title, cardCode);
  head.append(headCopy, closeButton('This office', () => hide()));

  // The link has a heading of its own — "This office" is said twice, once as the
  // dialog's title and once as a section — because the four subjects are laid out as a
  // grid of four cells and a cell with no heading would be the one that looked unfinished.
  // The title above is about the room; this heading is about the row under it.
  const mine = node('section', 'kd-section');
  const copy = node('button', 'kd-action', 'Copy link');
  copy.type = 'button';
  copy.addEventListener('click', () => copyLink());
  const copyNote = node('span', 'kd-flash');
  copyNote.setAttribute('role', 'status');

  const linkRow = node('div', 'kd-row');
  const link = node('input', 'kd-link');
  link.type = 'text';
  link.readOnly = true;
  link.setAttribute('aria-label', 'Link to this office');
  linkRow.append(link, copy);
  // One line, and one line on purpose. This started as three, which made the cell taller
  // than the headcount beside it to say something the Copy link button says by itself; it
  // was then removed altogether, which left the slot under the heading empty — the same
  // gap that got the Close section reported as having lost its description, one row up.
  // So: the shortest true sentence that is not already elsewhere in the card. It is the
  // link and not the keycard, which is the one thing about this row worth saying.
  const mineNote = node('p', 'kd-note', 'The whole link, so whoever you send it to can click it.');
  mine.append(node('h3', '', 'This office'), mineNote, linkRow, copyNote);

  // --- who is here ---
  //
  // The count includes you, and it says so rather than leaving a "1" in an empty room
  // to be puzzled over. It counts *viewers* and not connections: the server keys
  // presence on an id a tab keeps for as long as it is that tab, so a reload is the same
  // person again (see `toJSON` in lib/office-store.cjs, which also records why the
  // number is exact today).
  const viewers = node('section', 'kd-section');
  const viewersCount = node('p', 'kd-count');
  const viewersNote = node('p', 'kd-note', 'Anyone holding the link can be in the room. '
    + 'The count includes you, and updates every half minute.');
  viewers.append(node('h3', '', 'Who is here'), viewersNote, viewersCount);

  // --- the passcode ---
  const pass = node('section', 'kd-section');
  const passState = node('p', 'kd-state');
  const passNote = node('p', 'kd-note', PASSCODE_NOTE);

  const field = node('input', 'kd-field');
  field.type = 'password';
  field.autocomplete = 'new-password';
  field.placeholder = 'New passcode';
  field.setAttribute('aria-label', 'New passcode for this office');
  field.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPasscode(); });

  const passSet = node('button', 'kd-action', 'Set a passcode');
  passSet.type = 'button';
  passSet.addEventListener('click', () => {
    if (mode !== 'setting') {
      mode = 'setting';
      paint();
      field.focus();
      return;
    }
    submitPasscode();
  });

  const passClear = node('button', 'kd-action kd-quiet', 'Remove');
  passClear.type = 'button';
  passClear.addEventListener('click', () => run(() => onPasscode(null)));

  const passRow = node('div', 'kd-row');
  passRow.append(field, passSet, passClear);
  pass.append(node('h3', '', 'Passcode'), passNote, passState, passRow);

  // --- your other offices: the ones you have been in, a new one, and any other ---
  //
  // Deliberately not in the bottom-right corner of the screen, which is where it was
  // suggested. That corner is the north compass's resting place, and the compass steps
  // aside from any panel it lands on (src/ui/north-compass.js) — so a permanent button
  // there would displace it permanently, trading a transient instrument's home for a
  // control that is only wanted about once a session. Inside the dialog it sits beside
  // the recent list, which is where the list was asked for, and both are then one click
  // from the keycard rather than a navigation away from the room.
  //
  // **Three doors and not two**, because until the keycard field arrived there was a hole
  // where the commonest one should be. The list gets you back into an office this browser
  // remembers and the button cuts a fresh one — but an office somebody *sent* you the
  // keycard for was neither, and the only way into it from inside a room was to type the
  // whole URL into the address bar. Reception has had the field all along; this is the
  // same one (src/ui/keycard-field.js), so the two cannot disagree about what it accepts.
  const offices = node('section', 'kd-section kd-wide');
  const officeList = node('ul', 'kd-offices');
  const officesNote = node('p', 'kd-note');

  const another = node('button', 'kd-action kd-quiet', 'Open a new office');
  another.type = 'button';
  another.addEventListener('click', () => run(() => onOpenAnother(), { label: another, busyWord: 'Cutting a keycard…' }));

  const otherField = node('input', 'kd-field kd-keycard-field');
  otherField.type = 'text';
  otherField.inputMode = 'text';
  otherField.spellcheck = false;
  otherField.autocapitalize = 'characters';
  otherField.placeholder = 'XXXX-XXXX';
  // `LENGTH` plus the one hyphen, which is grouping and not stored — the same cap
  // reception's markup puts on its field, from the constant rather than from a 9.
  otherField.maxLength = LENGTH + 1;
  otherField.size = LENGTH + 1;
  otherField.setAttribute('aria-label', 'Keycard of another office');
  const otherGo = node('button', 'kd-action', 'Enter');
  otherGo.type = 'button';

  /**
   * The hint under the field: how many characters to go, or why that is not a keycard.
   *
   * Its own line rather than `officesNote`. That note is this section's description and
   * says which browser remembers the list; this says what the field makes of what you
   * have typed so far, changes on every keystroke, and belongs beside the field it is
   * about rather than up under the heading.
   */
  const otherHint = node('p', 'kd-note kd-hint');
  otherHint.setAttribute('role', 'status');
  const sayOther = (message, bad = false) => {
    otherHint.textContent = message ?? '';
    otherHint.classList.toggle('bad', Boolean(bad));
  };

  const otherKeycard = wireKeycardField({ input: otherField, go: otherGo, say: sayOther });
  otherGo.addEventListener('click', () => otherKeycard.enter());
  otherField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') otherKeycard.enter();
  });

  const officesRow = node('div', 'kd-row');
  officesRow.append(another, node('span', 'kd-or', 'or go to'), otherField, otherGo);
  offices.append(node('h3', '', 'Your offices'), officesNote, officeList, officesRow, otherHint);

  // --- closing the office ---
  //
  // The dangerous one, so it asks — and the confirmation says what is actually lost,
  // which is more than the room: the link stops working for everyone holding it, the
  // event history goes, and every machine posting into it is cut off. It also says the
  // one non-obvious thing, which is that the keycard will still resolve, to an empty
  // room, because visiting an unknown keycard makes an office.
  const shut = node('section', 'kd-section kd-danger');
  /**
   * What the section is for, in the resting state — and why it is a second text rather
   * than the confirmation shown early.
   *
   * This section used to have one note, and that note was the confirmation, so it was
   * hidden until the button was armed. With every description now sitting under its
   * heading that left Close as the only section whose slot under the heading was empty,
   * directly beside Passcode, which has one — and an empty slot beside a filled one does
   * not read as "nothing to say here", it reads as a description that went missing. It
   * was reported as exactly that.
   *
   * Unhiding the confirmation instead would be worse. A permanent block of consequences
   * would make the calmest state of the dialog read as a warning, and the colour arriving
   * on the second click is the whole of how this control says the first click was a
   * question. So: a calm sentence that stands, and the consequences that arrive.
   *
   * It says the first click is safe, which is the useful thing the confirmation cannot
   * say — by the time you are reading that, you have already made it.
   */
  const shutStanding = node('p', 'kd-note', 'Ending this office for good, and taking its '
    + 'link back from everyone holding it. The button asks once before anything happens.');
  const shutNote = node('p', 'kd-note kd-confirm', 'Closing takes the link back: the rooms, the '
    + 'furniture, the event history and every machine posting here go with it. Anyone '
    + 'who kept your link gets a brand-new empty office at this keycard, and is told '
    + 'nothing. This cannot be undone.');
  // Quiet until it is armed, then red. Unarmed it must not compete with the passcode
  // button above it for "the thing to click": one primary action per dialog, and the
  // irreversible one is not it. The colour arriving on the second state is what says
  // the first click was a question and this one is the act.
  const shutBtn = node('button', 'kd-action kd-quiet kd-danger-action', 'Close this office');
  shutBtn.type = 'button';
  shutBtn.addEventListener('click', () => {
    if (mode !== 'closing') {
      mode = 'closing';
      paint();
      return;
    }
    run(() => onClose());
  });
  const shutCancel = node('button', 'kd-action kd-quiet', 'Keep it');
  shutCancel.type = 'button';
  shutCancel.addEventListener('click', () => { mode = 'idle'; paint(); });
  const shutRow = node('div', 'kd-row');
  shutRow.append(shutBtn, shutCancel);
  // Heading, what the section is for, then — only once armed — what it costs, above the
  // pair of buttons that answer it rather than below them.
  shut.append(node('h3', '', 'Close'), shutStanding, shutNote, shutRow);

  /** Whatever went wrong last, in the server's own words where it gave any. */
  const problem = node('p', 'kd-problem');
  problem.setAttribute('role', 'alert');

  /** Why the two owner controls are unavailable, when they are. */
  const ownerNote = node('p', 'kd-note kd-owner-note', NOT_OWNER);

  /**
   * The four subjects, two to a row, with the key ring under both columns.
   *
   * This is the reading order and nothing here sets a grid position — `.kd-grid` in
   * styles.css lays two tracks and flows these five into them, and says why each cell is
   * where it is. Close is still last of the four, because it is the irreversible one and
   * the eye should reach it having already passed everything that is not.
   */
  const grid = node('div', 'kd-grid');
  grid.append(mine, viewers, pass, shut, offices);

  card.append(head, grid, ownerNote, problem);
  host.appendChild(card);

  host.addEventListener('click', (e) => { if (e.target === host) hide(); });
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    /**
     * Whether this keystroke is aimed at one of the dialog's own fields — and the
     * reason it has to be asked before anything else happens.
     *
     * This is a **capture** listener on `document`, so it runs before the event has
     * reached its target. `stopPropagation()` here therefore stops the event reaching
     * the field's *own* handler too, and the passcode field's Enter would silently
     * never fire: the character still appears, because inserting it is a default
     * action rather than a listener, so the failure looks like a dead Enter key and
     * nothing else. The source picker can stop everything unconditionally because it
     * has no text input in it; this dialog does.
     *
     * Letting a keystroke through costs nothing, because `isTypingTarget` in
     * src/ui/shortcuts.js already declines to act on anything aimed at an input — the
     * office's shortcuts are not what a passcode field has to be protected from.
     */
    const typing = card.contains(e.target) && e.target instanceof HTMLInputElement;
    if (!typing) e.stopPropagation();
    if (e.key === 'Escape') {
      // Always stopped, typing or not: the global Escape handler would otherwise also
      // clear the selection in the room behind the dialog that is closing.
      e.stopPropagation();
      return hide();
    }
    if (e.key !== 'Tab') return undefined;
    // `a[href]` as well, because the recent-offices list is links — and a row struck
     // through as deleted has had its href removed, so it drops out of the ring on its
     // own rather than needing a rule of its own.
    const controls = [...card.querySelectorAll('input:not([disabled]), button:not(:disabled), a[href]')]
      .filter((el) => !el.hidden && el.offsetParent !== null);
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
    return undefined;
  }, true);

  let flash = null;
  function say(message) {
    copyNote.textContent = message;
    if (flash) clearTimeout(flash);
    flash = setTimeout(() => { copyNote.textContent = ''; }, FLASH_MS);
  }

  async function copyLink() {
    // The link, not the keycard: what somebody pastes into a chat should be a thing the
    // recipient can click, and the keycard alone asks them to know where to type it.
    try {
      await navigator.clipboard.writeText(link.value);
      say('Link copied');
    } catch {
      // Refused in plenty of ordinary situations — no HTTPS, no permission — so the
      // field is selected instead. A hand-hold, not a failure.
      link.select();
      say('Copy it from the field');
    }
  }

  function submitPasscode() {
    const typed = field.value.trim();
    if (!typed) {
      problem.textContent = 'Type a passcode first, or Remove to take the current one off.';
      return;
    }
    run(() => onPasscode(typed));
  }

  /**
   * Run one action, and let the dialog wear the outcome.
   *
   * Every one of them is a request that can be refused for a reason the server words
   * better than this file could — the demo office refusing a passcode, a passcode too
   * short, too many wrong attempts, every rate limit — so the reason is shown verbatim
   * rather than translated into a status. The same argument `src/office/new-office.js`
   * makes about reception's hint line.
   *
   * `busyWord` is for the one action with a wait long enough to need narrating. Cutting
   * a keycard is a round trip to the server, because the server is the only thing that
   * knows which keycards are taken and there is deliberately no offline fallback; a
   * button that only greyed out for a second would read as a click that did nothing.
   *
   * @param {{label?: HTMLElement, busyWord?: string}} [narrate]
   */
  async function run(action, { label = null, busyWord = null } = {}) {
    if (busy) return;
    busy = true;
    problem.textContent = '';
    const was = label?.textContent;
    paint();
    if (label && busyWord) label.textContent = busyWord;
    let result;
    try {
      result = await action();
    } finally {
      busy = false;
      if (label && was !== undefined) label.textContent = was;
    }
    if (!result?.ok) {
      problem.textContent = result?.reason ?? 'that did not work';
      mode = 'idle';
      paint();
      return;
    }
    field.value = '';
    mode = 'idle';
    paint();
  }

  /**
   * The offices this browser has been in, and whether they are still there.
   *
   * Two passes, because the second one needs the network and the first must not wait for
   * it: the rows are drawn from `listRecent()` immediately, then each is checked and
   * annotated as its answer arrives. Drawing nothing until every peek returned would
   * leave the section empty for as long as the slowest one took.
   *
   * A row for *this* office is kept rather than filtered out — it is the room you are
   * standing in and leaving a hole where it should be would be the puzzle — but it is
   * plain text rather than a link, because a link to where you already are does nothing.
   *
   * Run from `show()` and not from `paint()`: `paint()` fires on every heartbeat while
   * the dialog is open, and re-peeking every remembered office twice a minute would be a
   * dozen requests a minute to answer a question whose answer almost never changes.
   */
  async function refreshOffices() {
    const visits = listRecent();
    officeList.innerHTML = '';
    officesNote.textContent = visits.length > 1
      ? 'Only this browser remembers these — there is no list of offices on the server, '
        + 'so a keycard is the only way back into one.'
      : 'Offices you open are remembered here, in this browser only.';

    /** The row per keycard, so a peek landing late still finds the row it describes. */
    const rows = new Map();
    for (const visit of visits) {
      const li = document.createElement('li');
      const here = visit.keycard === keycard;
      const name = here
        ? node('span', 'kd-office-card here', visit.keycard)
        : node('a', 'kd-office-card', visit.keycard);
      if (!here) name.href = officeUrl(visit.keycard);
      const when = node('span', 'kd-office-when', here ? 'this office' : agoWords(visit.at));
      li.append(name, when);
      officeList.appendChild(li);
      rows.set(visit.keycard, { li, name, when, here });
    }

    for (const visit of visits) {
      const row = rows.get(visit.keycard);
      // The office we are standing in is demonstrably there, and `?peek` on it would be
      // a request whose answer we are already looking at.
      if (!row || row.here) continue;
      const { gone, locked } = await checkRecent(visit.keycard);
      if (gone) {
        // Struck through and said out loud rather than quietly dropped. `checkRecent` has
        // already forgotten it, so this row will not come back — and since this list is
        // the only record that the office existed, a row vanishing with no explanation
        // would read as us having lost it.
        row.li.classList.add('gone');
        row.when.textContent = 'deleted — nobody was watching';
        row.name.removeAttribute('href');
      } else if (locked) {
        row.when.textContent = `${row.when.textContent} · passcode`;
      }
    }
  }

  function paint() {
    const owner = isOwner();
    const locked = Boolean(info?.passcode);
    const reserved = Boolean(info?.reserved);

    link.value = window.location.href;

    const n = Number(info?.viewers) || 0;
    // "1 person, and it is you" rather than a bare 1, which reads as a headcount that
    // has failed to count anybody else and sends people looking for a bug.
    viewersCount.textContent = n <= 1
      ? 'Just you, so far.'
      : `${n} people are looking at this office, including you.`;

    // The demo office is nobody's: the server refuses a passcode on it and refuses to
    // close it, so saying so here is the honest version of a disabled button. Those two
    // sections are hidden rather than disabled because there they do not exist at all,
    // rather than being unavailable to you — and the note points at the door instead,
    // which is now a button in this same dialog rather than a trip to reception.
    const ownerControls = owner && !reserved;
    pass.hidden = reserved;
    shut.hidden = reserved;
    ownerNote.hidden = ownerControls;
    // Names the control rather than pointing at a place on the card. This note is the
    // last thing in the dialog and the button is in the section above it, so "below"
    // was simply wrong — and any direction would go stale the next time a section moves.
    ownerNote.textContent = reserved
      ? 'This is the shared demo office, so it has no passcode and cannot be closed. '
        + 'Use “Open a new office” for one you can lock.'
      : NOT_OWNER;

    // Never hidden, in any office: cutting another one and seeing the ones you have been
    // in are the two things a visitor to the demo most wants, and the demo is where most
    // visitors start.
    another.disabled = busy;

    passState.textContent = locked
      ? 'This office asks for a passcode.'
      : 'Anyone with the link can open this office.';
    field.hidden = mode !== 'setting';
    field.disabled = !ownerControls || busy;
    passSet.disabled = !ownerControls || busy;
    passSet.textContent = mode === 'setting'
      ? (locked ? 'Change it' : 'Lock the office')
      : (locked ? 'Change the passcode' : 'Set a passcode');
    passClear.hidden = !locked || mode === 'setting';
    passClear.disabled = !ownerControls || busy;

    shutBtn.disabled = !ownerControls || busy;
    shutBtn.textContent = mode === 'closing' ? 'Yes, close it for good' : 'Close this office';
    shutBtn.classList.toggle('armed', mode === 'closing');
    shutCancel.hidden = mode !== 'closing';
    shutNote.hidden = mode !== 'closing';
  }

  /**
   * Put every field back to empty, and its hint with it.
   *
   * Both fields, and for the same reason: a half-typed passcode or a half-typed keycard
   * left lying in the card is a thing the next opening would have to be read carefully
   * enough to notice. `refresh()` rather than a bare assignment for the keycard, because
   * emptying that field also re-disables its Enter button and clears whatever the hint
   * was last saying.
   */
  function clearFields() {
    field.value = '';
    otherField.value = '';
    otherKeycard.refresh();
  }

  function show(next = info) {
    info = next ?? info;
    mode = 'idle';
    clearFields();
    problem.textContent = '';
    if (!open) returnFocus = document.activeElement;
    paint();
    open = true;
    host.classList.remove('hidden');
    copy.focus();
    // Once per opening, not once per repaint — see `refreshOffices`. Not awaited: the
    // dialog is already on screen and the rows annotate themselves as answers arrive.
    refreshOffices();
  }

  function hide() {
    if (!open) return;
    open = false;
    mode = 'idle';
    clearFields();
    host.classList.add('hidden');
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  return {
    get isOpen() { return open; },
    show,
    hide,
    /** Keep an open dialog in step with the heartbeat: the headcount moves on its own. */
    setOffice(next) {
      if (next) info = next;
      if (open) paint();
    },
  };
}
