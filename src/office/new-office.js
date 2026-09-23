// Cutting a new keycard.
//
// The server is the only thing that can mint one, because it is the only thing that
// knows which keycards are taken — hand one out from the browser and you eventually
// hand someone the keys to a stranger's office. So there is no offline fallback
// here, and a failure is reported rather than papered over.
//
// This lives on its own because the same door is offered from three places now, and
// three copies of the same fetch would be three chances to disagree about what the
// server returned: reception's "Open a new office" button (src/wizard.js), the
// switcher row inside the reserved demo office, and the note in that office's
// source picker (both src/main.js). The demo office is authored and shared, so every
// invitation to change something in it is really an invitation to leave.

import { parseKeycard, officeUrl } from './keycard.js';
import { remember } from './owner.js';

/**
 * Why the server said no, in its own words where it gave any.
 *
 * The office endpoint is rate-limited and capped (`server.cjs`), and both refusals
 * come with a sentence saying which limit was hit and when to come back. Reception
 * prints whatever this returns straight onto its hint line, so keeping the server's
 * wording is the difference between "try again in 4 minutes" and "server said 429" —
 * and it means the numbers are stated in exactly one place, where they are set.
 *
 * A status is the fallback, not the answer: a body that is not JSON, or JSON with no
 * `error`, means something other than this server refused us.
 */
async function refusal(res) {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
  } catch { /* not JSON: a proxy, a gateway, or something else in the way */ }
  return `server said ${res.status}`;
}

/**
 * Ask the server for an office at a keycard nobody is using.
 *
 * The response is parsed rather than trusted: `parseKeycard` is the one definition
 * of the format, and a server that answered with something else would otherwise
 * send us navigating to a URL that is not an office at all.
 *
 * **The write token beside it is kept**, which is the difference between an office you
 * made and an office you own. The mint is the only response in the whole server that
 * hands a write capability to a caller who presented none, and it happens exactly once
 * per office: there is no route that will tell you that token again, and nothing else
 * can ask for it, because asking needs one. For a long time these four lines read the
 * keycard and discarded the rest of the body, so every office cut at reception was
 * permanently unownable — nobody could add a machine to it, revoke a token on it, put a
 * passcode on it, or close it when its link leaked. See src/office/owner.js, which owns
 * both the storage and the honest account of what it costs.
 *
 * A storage refusal is not a failure here. Private browsing and a full quota both mean
 * the office opens exactly as it used to and simply has no owner, which is strictly
 * better than refusing to cut the keycard at all.
 *
 * @returns {Promise<string>} the new keycard, `XXXX-XXXX`
 * @throws if the server refused, or answered with something that is not a keycard
 */
export async function mintOffice() {
  const res = await fetch('/api/offices', { method: 'POST' });
  if (!res.ok) throw new Error(await refusal(res));
  const office = await res.json();
  const card = parseKeycard(office?.keycard);
  if (!card) throw new Error('the server minted something that is not a keycard');
  remember(card, office?.writeToken);
  return card;
}

/**
 * Mint an office and walk into it.
 *
 * A navigation, not a state change: an office is an address, and the keycard in the
 * URL is the whole of it (src/keycard.js). Nothing is worth keeping from the room
 * being left, so there is no cleanup to do first.
 *
 * @param {{seed?: ?string}} [opts]  a seed to furnish the new room from, for
 *   somebody who has seen a layout they want (see docs/office-seeds.html). It is
 *   carried into the office URL and used once, when the room is first opened.
 * @returns {Promise<string>} the keycard being opened — for a caller that wants to
 *   say so, though the page is already on its way out
 */
export async function openNewOffice({ seed = null } = {}) {
  const card = await mintOffice();
  const destination = new URL(officeUrl(card, { seed }), window.location.href);
  destination.searchParams.set('setup', 'sources');
  window.location.href = `${destination.pathname}${destination.search}`;
  return card;
}
