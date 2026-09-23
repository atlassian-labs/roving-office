// The pill beside the office switcher: which sources this office listens to, and
// whether those feeds are actually alive.
//
// A live harness feed can legitimately show nothing for minutes, so the office
// has to distinguish "no agents right now" from "nothing is connected". Without
// this badge, an empty room is ambiguous — and the first assumption is always
// that the app is broken.
//
// With several feeds in one room that job gets harder, because they can disagree:
// Claude Code live while the Rovo adapter is missing is a normal Tuesday. The pill
// stays one line — marks, a name, one dot — and the disagreement goes in the
// tooltip, where `2 of 3 live` can be spelled out feed by feed.

import { ensureHost, node } from './dom.js';
import { renderMark } from './marks.js';

/** What each feed state means to someone looking at an empty room. */
const STATE_TEXT = {
  connecting: 'connecting…',
  live: 'live',
  waiting: 'listening',
  offline: 'no adapter',
  idle: 'no source',
};

/** Marks shown before the pill gives up and counts instead. */
const MAX_MARKS = 3;

/**
 * @param {object} [opts]
 * @param {() => void} [opts.onClick] open the picker; omitted means not clickable
 * @returns {{ setSources(defs: object[], opts?: {clickable?: boolean}): void,
 *            setStatus(summary: {state: string, detail?: ?string},
 *                      states?: Array<{def: object, state: string, detail: ?string}>): void }}
 */
export function createSourceBadge({ onClick = null } = {}) {
  const host = ensureHost('source-badge', {
    className: 'source-badge',
    parent: document.querySelector('#title-bar .brand') ?? undefined,
  });

  // Marks live in their own row so several can sit together and overlap slightly;
  // one source is the same element with a single child, so there is one code path.
  const marks = node('span', 'sb-marks');

  const label = node('span', 'sb-label');

  const dot = node('span', 'sb-dot');

  const state = node('span', 'sb-state');

  host.append(marks, label, dot, state);
  host.addEventListener('click', () => {
    if (host.classList.contains('clickable')) onClick?.();
  });

  // The tooltip is assembled from two independent updates — which sources, and how
  // they are doing — so both are kept and the title rebuilt from the pair.
  let clickable = false;
  /** @type {Array<{def: object, state: string, detail: ?string}>} */
  let feedStates = [];

  function paintTitle() {
    const lines = feedStates.map(({ def, state: s, detail }) => {
      const words = detail ? `${STATE_TEXT[s] ?? s} · ${detail}` : (STATE_TEXT[s] ?? s);
      return `${def.label}: ${words}`;
    });
    // Only worth listing when there is something to compare: with one feed the
    // pill already says all of this, and a tooltip repeating it is noise.
    if (feedStates.length < 2) lines.length = 0;
    if (clickable) lines.push('Choose where your agents come from (D)');
    host.title = lines.join('\n');
  }

  return {
    /**
     * Point the badge at a set of source definitions; empty for an office with none.
     *
     * @param {object[]} defs
     * @param {{clickable?: boolean}} [opts]
     */
    setSources(defs, { clickable: canClick = false } = {}) {
      const list = defs ?? [];
      marks.innerHTML = '';
      for (const def of list.slice(0, MAX_MARKS)) {
        const m = node('span', 'sb-mark');
        // Each mark wears its own source's colour, so a mixed office is legible as
        // a mix rather than as one accent applied to three different logos.
        m.style.setProperty('--accent', def.accent);
        m.innerHTML = renderMark(def.mark);
        marks.appendChild(m);
      }
      marks.classList.toggle('stacked', list.length > 1);

      label.textContent = labelFor(list);
      // The pill's own accent is the first source's: the border tint has to be one
      // colour, and the order the picker gave is the order shown.
      host.style.setProperty('--accent', list[0]?.accent ?? 'var(--muted)');
      host.classList.toggle('clickable', canClick);
      clickable = canClick;
      paintTitle();
    },

    /**
     * Say how the set is doing: one word on the pill, the breakdown in the tooltip.
     *
     * @param {{state: string, detail?: ?string}} summary
     * @param {Array<{def: object, state: string, detail: ?string}>} [states]
     */
    setStatus({ state: next = 'idle', detail = null } = {}, states = []) {
      dot.dataset.state = next;
      const words = STATE_TEXT[next] ?? next;
      state.textContent = detail ? `${words} · ${detail}` : words;
      feedStates = states ?? [];
      paintTitle();
    },
  };
}

/**
 * Name a set of sources in the width of a pill.
 *
 * Two still fit and are worth spelling out — "Claude Code + Rovo CLI" is the whole
 * point of a mixed office. Beyond that the marks carry the identity and the words
 * only need to say how many, because three labels would push the switcher off the
 * end of the title bar.
 */
function labelFor(defs) {
  if (defs.length === 0) return 'No source';
  if (defs.length === 1) return defs[0].label;
  if (defs.length === 2) return `${defs[0].label} + ${defs[1].label}`;
  return `${defs.length} sources`;
}
