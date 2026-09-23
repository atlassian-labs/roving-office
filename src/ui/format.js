// Shared formatting for the work log, used by anything that reports a job.
//
// These started out private to the inspector. The first-person job panel needs
// exactly the same three, and two panels quoting the same job in different words —
// "2m 04s" against "2:04", "in progress" against "active" — would read as a bug in
// the simulation rather than a difference of opinion between two files.

import { JOB_COLORS } from '../config.js';

/**
 * How a log entry's outcome is shown: the colour of its dot and the word for it.
 *
 * The colours come from JOB_COLORS rather than being written out here, and that
 * separation is load-bearing: a job's palette describes a piece of paper, the status
 * palette describes a person, and they were once the same three values — so a green
 * dot meant "this agent is typing" in one panel and "this job is finished" in the
 * one below it. Keeping the words here and the hues in config means neither panel can
 * drift from the other, and neither can drift back into the status palette.
 *
 * 'error' reads as "removed" because that is what it means to the office — the feed
 * withdrew the job, so the agent stopped carrying it. Nothing crashed.
 */
export const OUTCOME = {
  active: { color: JOB_COLORS.active, word: 'in progress' },
  done: { color: JOB_COLORS.done, word: 'done' },
  error: { color: JOB_COLORS.error, word: 'removed' },
};

/** Wall-clock time of an epoch-ms instant, to the second, 24-hour. */
export function clockTime(ms) {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

/**
 * Human-readable elapsed time, e.g. "8s" or "2m 04s".
 *
 * Whole seconds, zero-padded: this is the register for a ticking counter in a
 * panel, where sub-second precision would be jitter and a width that changes as
 * it counts would be a distraction. For a one-off measurement — a tool call, a
 * flight — use `preciseDuration`, which trades stability for exactness.
 */
export function duration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Durations read as a person would say them, which is never "18400ms". */
export function preciseDuration(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/**
 * A long value with its middle taken out, rather than its end.
 *
 * Truncating from the right is the wrong cut for most of what a log carries. A
 * path's identity is its last segment: `…/workspace-paige/scripts/ingest.sh`
 * says which job is running, while the first forty characters say only whose
 * machine it is on — and that is exactly the half a right-hand ellipsis keeps.
 * The same goes for a URL, a branch or an id.
 *
 * So the head is kept as a bearing, the tail is kept whole, and the cut is made
 * on separators wherever there are any: the result stays a readable path rather
 * than becoming a string with a hole in it. Only a single unbroken run too long
 * for the budget falls back to cutting mid-word, because at that point there is
 * nothing structural left to respect.
 *
 * @param {string} value
 * @param {number} max  characters, including the ellipsis
 */
export function elideMiddle(value, max = 72) {
  const text = String(value ?? '');
  if (text.length <= max || max < 8) return text;

  // The bearing to keep is the first segment of a path, and the *host* of a URL —
  // `https:/…` would be a worse answer than no elision at all.
  const url = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)(\/.+)$/i.exec(text);
  const segments = (url ? url[2] : text).split(/[/\\]/).filter(Boolean);
  const head = url ? url[1] : (/^[/\\]/.test(text) ? '/' : '') + (segments.shift() ?? '');

  if (segments.length > 1) {
    let tail = segments[segments.length - 1];
    for (let i = segments.length - 2; i >= 0; i -= 1) {
      const grown = `${segments[i]}/${tail}`;
      if (`${head}/…/${grown}`.length > max) break;
      tail = grown;
    }
    const out = `${head}/…/${tail}`;
    if (out.length <= max) return out;
  }

  const keep = max - 1;
  const front = Math.floor(keep * 0.35);
  return `${text.slice(0, front)}…${text.slice(front - keep)}`;
}

/**
 * How long a log entry has been running, or ran for.
 *
 * An open job is still going, so it is measured against now — which is why any
 * panel showing one has to repaint on a timer to stay honest.
 */
export function jobElapsed(entry) {
  return (entry.endedAt ?? Date.now()) - entry.startedAt;
}

/**
 * "3 minutes ago", roughly — for a visit, not for a job.
 *
 * The odd one out in this file, and here rather than in either caller because there are
 * two: reception's list of offices you have been in, and the same list inside the keycard
 * dialog. Those sit on different pages and a reader can hold them both in mind, so one
 * saying "an hour ago" while the other said "60 minutes ago" about the same visit would
 * read as a bug in the office rather than as two files' differing opinions — which is the
 * argument this module's header already makes about jobs.
 *
 * Deliberately coarse, and `duration` above is the contrast worth seeing: that one
 * measures work and is exact to the second because somebody is watching it tick. This
 * measures *when you last opened a room*, where precision would be false comfort — being
 * told you were there 47 minutes ago helps nobody decide anything.
 */
export function agoWords(at) {
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
