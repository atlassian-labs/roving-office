// A field you type a keycard into, and the manners that go around one.
//
// Two places ask for a keycard: reception (src/wizard.js), where it is the front door,
// and the office's own keycard dialog (src/ui/keycard-dialog.js), where it is the way to
// the *other* office you have the card for. Both do the same three things to the same
// eight characters — fold whatever a human hand did to the code between reading it and
// typing it, say how far off it still is, and walk into the office it names — so they do
// them from here rather than each from itself.
//
// The reason that matters is disagreement rather than duplication. A dialog that refused
// a keycard reception accepts, or accepted one it refuses, would be a bug invisible from
// either file: both would look right on their own. `checkRecent` is shared between the
// same two places for the same reason.
//
// The folding and the format are src/office/keycard.js, which the server loads too. This
// module is only the field's behaviour: the live mask, the hint wording, and the one
// error sentence for a string that is not a keycard.

import { foldPartial, officeUrl, parseKeycard, LENGTH } from '../office/keycard.js';

/**
 * What something that is not a keycard gets told.
 *
 * An example rather than a rule, because the rule ("Crockford base32, no I/L/O/U") is
 * true and useless to somebody who has mistyped one character.
 */
export const NOT_A_KEYCARD = `A keycard is ${LENGTH} characters, like K7F2-9QBX.`;

/**
 * The words for a keycard part-way typed. Empty once there is nothing to say.
 *
 * Empty rather than null, because `say('')` is what clears the hint line and a null would
 * have to be turned into one by every caller.
 *
 * @param {string} folded  already through `foldPartial`
 * @returns {string}
 */
function progressWords(folded) {
  const chars = folded.replace('-', '').length;
  if (!chars) return '';
  if (chars < LENGTH) return `${LENGTH - chars} to go`;
  return 'Looks like a keycard.';
}

/**
 * Wire one input, and optionally the button beside it, as a keycard field.
 *
 * The mask runs on every keystroke rather than complaining at the end: a keycard typed
 * from a screenshot arrives in every possible dialect, and somebody typing has been
 * through every prefix of the string on the way there. The caret is left at the end
 * because that is where typing happens — this is not a field anyone edits in the middle.
 *
 * `enter()` is separate from the wiring so each caller can reach it from whatever it
 * considers submission: reception has a real `<form>`, and the dialog has an Enter key on
 * an input inside a modal that traps Tab.
 *
 * @param {object} opts
 * @param {HTMLInputElement} opts.input
 * @param {?HTMLButtonElement} [opts.go]  disabled until the field holds a whole keycard
 * @param {(message: string, bad?: boolean) => void} [opts.say]  the hint line
 * @param {(url: string) => void} [opts.navigate]  for a test that would rather not leave
 * @returns {{ enter(): boolean, refresh(): void }}
 */
export function wireKeycardField({ input, go = null, say = () => {}, navigate = visit }) {
  function refresh() {
    const folded = foldPartial(input.value);
    if (folded !== input.value) input.value = folded;
    if (go) go.disabled = folded.replace('-', '').length !== LENGTH;
    say(progressWords(folded));
  }

  input.addEventListener('input', refresh);
  refresh();

  /**
   * Go to the office this field names, or say why we cannot.
   *
   * No check that the office exists, because the answer would not change what we do: an
   * unknown keycard makes an office at that address — that is the deal — and asking
   * first would only add a round trip to the door.
   *
   * @returns {boolean} whether we are on our way
   */
  function enter() {
    const card = parseKeycard(input.value);
    if (!card) {
      say(NOT_A_KEYCARD, true);
      input.focus();
      return false;
    }
    navigate(officeUrl(card));
    return true;
  }

  return { enter, refresh };
}

/** The default `navigate`, kept nameable so a caller can replace it. */
function visit(url) {
  window.location.href = url;
}
