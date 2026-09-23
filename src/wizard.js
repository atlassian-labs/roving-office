// The optional Your offices page: enter a keycard, or open a personal office.

import { node } from './ui/dom.js';
import { agoWords } from './ui/format.js';
import { wireKeycardField } from './ui/keycard-field.js';
import { DEMO_KEYCARD, officeUrl } from './office/keycard.js';
import { openNewOffice } from './office/new-office.js';
import { listRecent, checkRecent } from './office/recent.js';

const form = document.getElementById('enter-form');
const input = document.getElementById('keycard');
const hint = document.getElementById('keycard-hint');
const go = document.getElementById('enter-go');
const create = document.getElementById('create-office');
const recentBox = document.getElementById('recent');
const recentList = document.getElementById('recent-list');

document.getElementById('demo-link').href = officeUrl(DEMO_KEYCARD);

/** Say something under the field. `bad` is for what the user must fix. */
function say(message, bad = false) {
  hint.textContent = message ?? '';
  hint.classList.toggle('bad', Boolean(bad));
}

// The mask, the hint wording and the way in all live in src/ui/keycard-field.js, which
// the keycard dialog inside an office shares — the two fields must not be able to
// disagree about what a keycard is.
const keycardField = wireKeycardField({ input, go, say });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  keycardField.enter();
});

/**
 * Cut a keycard and walk in, optionally furnishing the room from a seed.
 *
 * The seed comes from a link somebody followed — a plan they liked on
 * `/docs/office-seeds.html` — and it is the only reason this takes an argument:
 * the button itself never passes one, because a new office rolls its own.
 */
async function openOffice(seed = null) {
  document.getElementById('create-hint').textContent = '';
  create.disabled = true;
  const was = create.textContent;
  create.textContent = 'Cutting a keycard…';
  try {
    await openNewOffice({ seed });
  } catch (err) {
    // The server is the only thing that can mint a keycard, because it is the only
    // thing that knows which ones are taken. So there is no offline fallback here,
    // and pretending otherwise would hand out a keycard to someone else's office.
    create.disabled = false;
    create.textContent = was;
    document.getElementById('create-hint').textContent = `Could not open an office: ${err.message}`;
  }
}

create.addEventListener('click', () => openOffice());

/**
 * The offices this browser has visited, and whether they are still there.
 *
 * Both halves matter. The list is the only record that your office exists, and an
 * office reaped for being empty is a dead link that must not be offered as a live
 * one — so each row is checked, and a gone office is struck through and dropped
 * from history rather than quietly disappearing, which would look like we lost it.
 */
async function paintRecent() {
  const visits = listRecent();
  if (!visits.length) return;

  recentBox.classList.remove('hidden');
  recentList.innerHTML = '';

  for (const visit of visits) {
    const li = document.createElement('li');

    const link = document.createElement('a');
    link.href = officeUrl(visit.keycard);
    link.className = 'wz-recent-card';
    link.textContent = visit.keycard;

    const when = node('span', 'wz-recent-when', agoWords(visit.at));

    li.append(link, when);
    recentList.appendChild(li);

    // Whether the office is still there, and the forgetting that goes with a "no",
    // both live in `checkRecent` — the keycard dialog asks the same question and the
    // rule about not losing a row silently must not exist twice.
    const { gone, locked } = await checkRecent(visit.keycard);
    if (gone) {
      li.classList.add('gone');
      when.textContent = 'deleted — nobody was watching';
      link.removeAttribute('href');
    } else if (locked) {
      // Its owner has put a passcode on it since. The row stays a working link, and
      // says so, so whoever clicks it is not surprised by a passcode field.
      when.textContent = `${when.textContent} · passcode`;
    }
  }
}

const params = new URLSearchParams(window.location.search);

// Arriving from a mistyped office URL: the server bounced us here rather than
// inventing an office at an address nobody meant.
if (params.has('create-failed')) {
  document.getElementById('create-hint').textContent = 'That office could not be opened. Try again in a moment.';
}

if (params.has('bad-keycard')) {
  say('That link is not a keycard. Check it, or open a new office.', true);
}

// Arriving from an office that was just closed. Said out loud because the act is
// silent by design everywhere else: the room is gone, every watcher has been hung up
// on and nothing anywhere will mention it again — so the one confirmation there is
// belongs here, at the place the browser lands.
if (params.has('closed')) {
  say('That office is closed. Its link now opens an empty room, and nobody holding it is told anything.');
}

// Arriving from a plan somebody liked (`/?seed=slate-orchard-2210`, as the links
// on /docs/office-seeds.html are): mint an office straight away and furnish it
// from that seed. No confirmation step, because following the link *was* the
// confirmation — and reception has nothing else to ask.
const wanted = params.get('seed');
if (wanted && wanted.trim()) {
  say(`Opening a new office from seed \u201c${wanted.trim()}\u201d\u2026`);
  openOffice(wanted.trim());
}

// `wireKeycardField` has already disabled Enter for the empty field, and does it again on
// every keystroke, so there is no second answer to that question here.
// Let visitors meet the office before focusing a field (and opening a mobile keyboard).
if (window.location.hash === '#enter-form') input.focus();
paintRecent();
