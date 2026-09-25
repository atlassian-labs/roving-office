// The developer panel: instruments, not controls.
//
// What is left after the room's own dials moved to the scene panel — the things you
// open when something looks wrong rather than when you want the office to look
// different. Camera numbers to reproduce a framing, a way into the event log, and a
// button that puts the frame on the clipboard.
//
// The camera readout is polled rather than event-driven: OrbitControls with damping
// keeps moving after the input stops, so a change event fires far more often than a
// readout needs repainting.

import { node } from './dom.js';
import { officePath } from '../office/keycard.js';
import { createStrip, section, readout, button } from './strip.js';
import { recallPanel, rememberPanel } from './panel-state.js';

const READOUT_HZ = 8;

/** Its element id, which is also what it is remembered under. */
const ID = 'dev-panel';

const DEG = 180 / Math.PI;
const fixed = (n, places = 1) => (Math.abs(n) < 0.05 ? 0 : n).toFixed(places);

/**
 * @param {object} opts
 * @param {THREE.Camera} opts.camera
 * @param {object} opts.controls            OrbitControls, for the orbit target
 * @param {() => Promise<boolean>} opts.onPhoto  copy the scene to the clipboard
 */
export function createDevPanel({ camera, controls, onPhoto }) {
  const { host, body } = createStrip({ id: ID, title: 'Developer', onClose: () => hide() });

  let open = false;
  let sinceRepaint = 0;

  // --- Camera readout ---
  const camGroup = section('Camera');
  const posOut = readout(camGroup, 'pos');
  const targetOut = readout(camGroup, 'target');
  const orbitOut = readout(camGroup, 'orbit');
  const zoomOut = readout(camGroup, 'zoom');

  // --- The way to the event log ---
  //
  // A link rather than a control, and it belongs here because this is the panel you
  // are already in when the room stops making sense. The log answers what the room
  // cannot — whether the events arrived at all, and what was in them — and a page
  // nobody can find is a page nobody uses (see src/debuglog.js).
  const logGroup = section('Events');
  const logLink = node('a', 'dev-btn dev-link', 'Debug log');
  logLink.title = 'Every event arriving in this office, as text';
  const at = officePath(window.location?.pathname ?? '');
  // Outside an office there is no stream to tail, so the row says so rather than
  // offering a link into nothing.
  if (at) logLink.href = `/office/${at.keycard}/debuglog`;
  else { logLink.textContent = 'No office'; logLink.title = 'This page is not inside an office'; }
  logGroup.body.appendChild(logLink);

  // --- Screenshot ---
  //
  // One button, because there is one thing to decide and it has already been decided
  // by the time you reach for it. The camera glyph rather than the word: it sits
  // under a heading that already says what it is, and a lozenge reading "Screenshot"
  // under a heading reading "Screenshot" spends a row saying nothing.
  //
  // The button reports back in place — briefly, then returns to the glyph. Copying to
  // a clipboard is otherwise completely silent, and a button that looks identical
  // whether or not it worked is a button you press twice.
  const shotGroup = section('Screenshot');
  const shotBtn = button('', 'Copy a photo of the scene to the clipboard (C)');
  shotBtn.classList.add('dev-shot');
  shotBtn.setAttribute('aria-label', 'Copy a photo of the scene to the clipboard');
  // The glyph is its own element so it can be set large without the status words
  // inheriting the size — `Copied` at the shutter's point size would resize the button
  // every time it reported.
  const shotGlyph = node('span', 'dev-shot-glyph', '📷');
  shotBtn.appendChild(shotGlyph);
  shotGroup.body.appendChild(shotBtn);

  let sayTimer = null;
  function flash(text, ok) {
    clearTimeout(sayTimer);
    shotBtn.textContent = text;
    shotBtn.classList.toggle('bad', !ok);
    sayTimer = setTimeout(() => {
      shotBtn.textContent = '';
      shotBtn.appendChild(shotGlyph);
      shotBtn.classList.remove('bad');
    }, 1600);
  }

  shotBtn.addEventListener('click', () => takePhoto());

  async function takePhoto() {
    const ok = await onPhoto?.();
    flash(ok ? 'Copied' : 'Failed', ok);
    return ok;
  }

  // --- Links ---
  //
  // Where this office came from, for the reader who has just found something odd in it.
  // They open in a new tab: following one is a detour from watching a room, not a
  // departure from it, and a live feed you navigated away from has to reconnect.
  const linksGroup = section('Links');
  linksGroup.body.append(
    // The repository is one thing and the documentation is another, and this row used to
    // be both: a `Datasource Clients: Download/Docs` link into a *pinned commit* of one
    // Markdown file. It went stale the moment that file moved, and it sent somebody
    // looking for "how do I connect my agents" into a source tree to read raw Markdown.
    // The docs are served by this very office now, so they are a row of their own.
    linkRow('Repository:', 'GitHub', 'https://github.com/atlassian-labs/roving-office'),
    // The links here that do not leave for the internet: these pages ship with the
    // server, so they are served by whichever office you are looking at. Root-relative
    // and not origin-absolute, because a hosted office and one on a laptop are
    // different origins and only one of them could ever be written down here —
    // and not document-relative either, because an office lives at `/office/<keycard>`
    // and that would look for the docs inside it.
    linkRow('Docs:', [
      { text: 'For everyone', href: '/docs/user/index.html' },
      { text: 'For developers', href: '/docs/developer/index.html' },
      { text: 'Connect an agent', href: '/docs/user/connect-your-agents.html' },
    ]),
    // One row, three links, because they are one *kind* of thing: three rows each
    // labelled `Docs:` spent two thirds of their width repeating the word, and the
    // names had to carry "Library" to fill it. A short name under a shared label reads
    // faster than a long one under its own.
    linkRow('Libraries:', [
      { text: 'Character Movements', href: '/docs/character-movements.html' },
      { text: 'Items', href: '/docs/item-movements.html' },
      { text: 'Layouts', href: '/docs/office-seeds.html' },
    ]),
  );

  // Controls first, passive readout last: the camera numbers are the one thing here
  // nobody reaches for, so they sit at the end where a squeeze reaches them first.
  body.append(logGroup.el, shotGroup.el, camGroup.el, linksGroup.el);

  /**
   * A `label: link` line, in the same shape as a camera readout — or several
   * links to one label, divided by a rule.
   *
   * @param {string} label
   * @param {string|{text: string, href: string}[]} links  one link's text (with
   *   `href` after it) or a list of them
   * @param {string} [href]  for the single-link form
   */
  function linkRow(label, links, href) {
    const row = node('div', 'dev-kv');
    const k = node('span', 'dev-k', label);
    row.appendChild(k);

    const list = Array.isArray(links) ? links : [{ text: links, href }];
    for (const [i, link] of list.entries()) {
      if (i > 0) {
        const bar = node('span', 'dev-vsep', '|');
        row.appendChild(bar);
      }
      const a = node('a', 'dev-v dev-vlink', link.text);
      a.href = link.href;
      a.target = '_blank';
      // `noopener` so the new tab cannot reach back through `window.opener`.
      a.rel = 'noopener noreferrer';
      row.appendChild(a);
    }
    return row;
  }

  function paintCamera() {
    const p = camera.position;
    const t = controls.target;
    posOut.textContent = `${fixed(p.x)}, ${fixed(p.y)}, ${fixed(p.z)}`;
    targetOut.textContent = `${fixed(t.x)}, ${fixed(t.y)}, ${fixed(t.z)}`;

    // Spherical offset of the camera from what it is looking at: azimuth is the
    // compass swing, polar the tilt down from vertical.
    const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
    const dist = Math.hypot(dx, dy, dz);
    const azimuth = Math.atan2(dx, dz) * DEG;
    const polar = Math.acos(Math.min(1, Math.max(-1, dy / (dist || 1)))) * DEG;
    orbitOut.textContent = `az ${fixed(azimuth, 0)}° · tilt ${fixed(polar, 0)}° · d ${fixed(dist, 0)}`;
    // An orthographic camera has no field of view to report, so zoom is the
    // meaningful number here.
    zoomOut.textContent = `${(camera.zoom ?? 1).toFixed(2)}×`;
  }

  paintCamera();

  /** On screen or not, without an opinion about whether that is worth remembering. */
  function apply(next) {
    open = next;
    host.classList.toggle('hidden', !next);
    if (next) paintCamera();
  }

  // Declared rather than only living on the returned object, because the panel's own
  // × needs it too — and a strip built before that object exists cannot reach into it.
  function hide() { apply(false); rememberPanel(ID, false); }
  function show() { apply(true); rememberPanel(ID, true); }

  // Back the way it was left. Applied rather than shown, so opening the office does not
  // write back the arrangement it has just read.
  apply(recallPanel(ID, false));

  return {
    get isOpen() { return open; },

    show,
    hide,
    toggle() { open ? hide() : show(); },

    /** Take the photo and report in the panel, for the `⌘C` shortcut. */
    takePhoto,

    /** Called each frame; repaints at READOUT_HZ while the panel is open. */
    update(dt) {
      if (!open) return;
      sinceRepaint += dt;
      if (sinceRepaint < 1 / READOUT_HZ) return;
      sinceRepaint = 0;
      paintCamera();
    },
  };
}
