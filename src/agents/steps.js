// Steps: the parts a round is sometimes made of, and how to say them in one line.
//
// A job is *sometimes* one step and *sometimes* a walk through a series of them
// (spec §4.2). Everything here is pure — no Three.js, no DOM — because four
// surfaces have to phrase the same step identically or the office contradicts
// itself: the roster row, the inspector, the first-person HUD and the name tag
// above the character's head. A second implementation of "what is this person on"
// is a second office.

/**
 * Statuses a plan entry can be *finished* in, as against pending or active.
 *
 * `skipped` counts as got-through on purpose. A scheduled job that finds nothing to
 * do in a phase has done that phase, and calling it unfinished would leave every
 * quiet heartbeat looking like an abandoned one.
 */
export const SETTLED = new Set(['completed', 'skipped', 'failed', 'cancelled']);

/**
 * How far through a checklist this is.
 *
 * `of` counts the truncated tail as well as the entries we hold, because a plan cut
 * to 20 of 26 is still 26 long and the office should not shorten somebody's
 * afternoon (see `normalisePlan` in src/data/aop-reducer.js).
 *
 * @param {?{items: Array<{status: string}>, more: number}} plan
 * @returns {?{done: number, of: number}}
 */
export function planTally(plan) {
  if (!plan?.items?.length) return null;
  const done = plan.items.filter((e) => SETTLED.has(e.status)).length;
  return { done, of: plan.items.length + (plan.more ?? 0) };
}

/**
 * What to say about a round with a checklist but nothing in hand.
 *
 * There is a real gap between one part finishing and the next being announced, and on
 * a skipped entry it is all there is. Without something to say the line would come and
 * go between every part, and a row that changes height as you watch it is harder to
 * read than one that admits to being between things. So the fraction holds the space.
 *
 * Null when there is no checklist at all, which is the usual case and still draws
 * nothing — this is about a round that *has* parts, not about inventing one.
 *
 * @param {?{items: Array, more: number}} plan
 * @returns {?string}
 */
export function planResting(plan) {
  const tally = planTally(plan);
  return tally ? `${tally.done}/${tally.of} parts` : null;
}

/**
 * One line naming the part in hand, or null when there is nothing to say.
 *
 * Null is the answer for the overwhelming majority of turns, and every caller is
 * expected to draw nothing at all for it rather than a dash or an empty bar: no
 * steps means one step, and a job without parts must look exactly as it did
 * before steps existed.
 *
 * The title-less form is not a fallback for a bug. At `metadata` redaction a step
 * title is dropped on the emitter side — it is text the *model* wrote — while the
 * counters survive, so "Step 2 of 5" is the honest whole of what arrived.
 *
 * @param {?{title: ?string, index: ?number, of: ?number}} step
 * @returns {?string}
 */
export function stepLabel(step) {
  if (!step) return null;
  const { title, index, of } = step;
  const counted = Number.isFinite(index) && Number.isFinite(of);
  if (title && counted) return `(${index}/${of}) ${title}`;
  if (title) return title;
  if (counted) return `Step ${index} of ${of}`;
  return null;
}

/**
 * Every part happening at once, as separate roster lines.
 *
 * `step` is the primary part named by the harness's `step.start`, but a plan can
 * truthfully contain several `active` entries when tools run in parallel. The
 * primary keeps its present-continuous wording; the others use their checklist
 * wording. Falling back to the resting tally keeps the row's height stable in the
 * gap between parts.
 *
 * @param {?object} step
 * @param {?{items: Array<{id: string, title: string, status: string}>, more: number}} plan
 * @returns {string[]}
 */
export function activeStepLabels(step, plan) {
  const active = plan?.items
    ?.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.status === 'active') ?? [];

  if (active.length) {
    const total = plan.items.length + (plan.more ?? 0);
    return active.map(({ entry, index }) => {
      const primary = step && (entry.id === step.id || entry.title === step.title);
      const title = primary ? (step.title ?? entry.title) : entry.title;
      const at = primary && Number.isFinite(step.index) ? step.index : index + 1;
      const of = primary && Number.isFinite(step.of) ? step.of : total;
      return title ? `(${at}/${of}) ${title}` : `Step ${at} of ${of}`;
    });
  }

  const one = stepLabel(step) ?? planResting(plan);
  return one ? [one] : [];
}
