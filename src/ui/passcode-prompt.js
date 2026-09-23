// "This office has a passcode." The one prompt in the whole app that stands in front
// of something.
//
// It is client UI reacting to a status, and that is worth saying because the alternative
// was tempting and wrong. The app shell is byte-identical for every office — the server
// sends the same `index.html` whatever keycard is in the path — so serving it reveals
// nothing and there is no reason to put a server-rendered login page in front of it. A
// route that rendered one would be a new gate with `/` and the demo office standing
// behind it, which is exactly the failure the front door must not have. So the server's
// answer to a locked office is `401 {passcode: true}` and this file is what that means.
//
// There is no username, because there is nobody to name. A passcode is a fact about a
// room, not about a person: everyone who gets in types the same thing, and the office
// neither knows nor records who they were.

import { node } from './dom.js';

/**
 * Ask for the passcode until it opens the office, or until whoever is at the keyboard
 * gives up and leaves.
 *
 * Rendered over the loading screen rather than as a modal over a room, because there is
 * no room yet: nothing behind this has loaded, and a backdrop that dismissed to reveal
 * an empty canvas would be a way out to nowhere. The way out is the link to reception,
 * which is a real place with a keycard field and a button that cuts a new office.
 *
 * `submit` is handed in rather than reached for, so this file does no fetching and the
 * data layer does no drawing (`tryPasscode` in src/office/office.js). Its refusals are
 * shown in the server's own words: a wrong passcode, a passcode this office has not got,
 * and "too many wrong passcodes, try again in four minutes" are three different
 * situations and only the server knows which one this is.
 *
 * @param {object} opts
 * @param {string} opts.keycard
 * @param {(passcode: string) => Promise<{ok: boolean, office?: object, reason?: string}>} opts.submit
 * @returns {Promise<?object>} the office document once it opens, or null if it never did
 */
export function askForPasscode({ keycard, submit }) {
  return new Promise((resolve) => {
    const host = node('div', 'pp-host');
    host.id = 'passcode-prompt';

    const card = node('form', 'pp-card');
    card.setAttribute('aria-labelledby', 'pp-title');

    const title = node('h1', 'pp-title', 'This office has a passcode');
    title.id = 'pp-title';

    const sub = node('p', 'pp-sub');
    sub.append('Office ', node('span', 'pp-keycard', keycard),
      ' is locked by whoever opened it. Ask them for the passcode — it is not the keycard.');

    const field = node('input', 'pp-field');
    field.type = 'password';
    field.autocomplete = 'current-password';
    field.placeholder = 'Passcode';
    field.setAttribute('aria-label', `Passcode for office ${keycard}`);

    const go = node('button', 'pp-go', 'Open the office');
    go.type = 'submit';

    const problem = node('p', 'pp-problem');
    // `alert`, so a wrong passcode is announced rather than silently redrawn — the
    // field keeps focus throughout and a screen reader would otherwise never hear it.
    problem.setAttribute('role', 'alert');

    const away = node('a', 'pp-away', 'Go to your offices');
    away.href = '/offices';

    const row = node('div', 'pp-row');
    row.append(field, go);
    card.append(title, sub, row, problem, away);
    host.appendChild(card);
    (document.getElementById('ui') ?? document.body).appendChild(host);

    let busy = false;

    card.addEventListener('submit', async (event) => {
      event.preventDefault();
      const typed = field.value.trim();
      if (!typed || busy) return;
      busy = true;
      go.disabled = true;
      problem.textContent = '';
      const result = await submit(typed);
      busy = false;
      go.disabled = false;
      if (result?.ok) {
        host.remove();
        resolve(result.office ?? null);
        return;
      }
      problem.textContent = result?.reason ?? 'that did not work';
      // Selected rather than cleared: somebody who mistyped one character of six should
      // not have to find the other five again.
      field.select();
    });

    field.focus();
  });
}
