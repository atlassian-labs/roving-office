// The First Person panel: what you see instead of the title bar while you are
// looking out of an agent's head (`f`).
//
// One panel across the top, plus a vignette over the view, plus the title bar
// hidden — all three are one piece of state, so they live in one module. Anything
// that says "you are in a head" has to arrive and leave together, and three objects
// toggled from three call sites is three chances for one to be left behind.
//
// What it deliberately does *not* show: status, source, drink, job history. The
// inspector is open beside it saying all of that already, and a second panel
// repeating it is just something else to read. What is left is the part the
// inspector cannot tell you — whose eyes these are, and what their body is doing
// right now — alongside the job, which is the reason to be down here at all.

import { closeButton, ensureHost, hex, node } from './dom.js';
import { markSpan } from './marks.js';
import { STATUS_COLORS } from '../config.js';
import { OUTCOME, clockTime, duration, jobElapsed } from './format.js';
import { stepLabel, planResting } from '../agents/steps.js';

/** Repaints per second. Matches the dev panel: enough for a seconds counter. */
const READOUT_HZ = 8;

const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M1.8 12S5.4 5 12 5s10.2 7 10.2 7-3.6 7-10.2 7S1.8 12 1.8 12z"/>
  <circle cx="12" cy="12" r="2.8"/>
</svg>`;

/** What an agent is holding, in words. Keys match `Agent.setCarrying`. */
const CARRY_WORDS = { package: 'a job', book: 'a book', cup: 'a drink' };

export function createFpvHud({ onExit } = {}) {
  const host = ensureHost('fpv-hud', { className: 'hidden' });
  // Absent markup is survivable — ensureHost says so out loud and carries on — so
  // these two are optional rather than a boot-time throw.
  const vignette = document.getElementById('fpv-vignette');
  const shell = document.getElementById('ui');

  // --- Header: whose eyes, and the way out ---------------------------------
  const head = node('div', 'fpv-head');

  const eye = node('span', 'fpv-eye');
  eye.innerHTML = EYE_SVG;

  // The source glyph and status dot, in the roster's order and from the roster's
  // helpers, so the agent you picked from the list is recognisably the same agent
  // once you are inside their head. The glyph is rebuilt on the rare occasion the
  // source changes; the dot is just recoloured.
  const marks = node('span', 'fpv-marks');

  const swatch = node('span', 'fpv-swatch');

  const name = node('span', 'fpv-name');

  const exit = node('span', 'fpv-exit');
  exit.innerHTML = '<kbd>f</kbd>to step out';

  // The hint says which key; the × is for the reader who would rather click it. The
  // panel itself takes no pointer events — it is a caption over somebody's view, not a
  // control — so the button takes them back for its own few pixels (see styles.css).
  head.append(eye, marks, swatch, name, exit, closeButton('First person view', () => onExit?.()));

  // --- Body: the job, and what they are physically up to ------------------
  const body = node('div', 'fpv-body');

  const nowGroup = group('Working on');
  const jobLabel = node('div', 'fpv-job-label');
  // Which part of it, when the round has parts. Down here more than anywhere else it
  // earns its place: standing at somebody's shoulder is the one view whose entire
  // purpose is "what is this person doing *right now*", and "3 of 5" is a better
  // answer to that than the title of the round they have been on for ten minutes.
  const stepRow = node('div', 'fpv-job-step');
  const timesRow = node('div', 'fpv-job-times');
  nowGroup.body.append(jobLabel, stepRow, timesRow);

  const doingGroup = group('Doing');
  const doingOut = node('div', 'fpv-doing');
  doingGroup.body.appendChild(doingOut);

  body.append(nowGroup.el, doingGroup.el);
  host.append(head, body);

  function group(title) {
    const el = node('div', 'fpv-group');
    const h = node('h4', '', title);
    const groupBody = node('div', 'fpv-group-body');
    el.append(h, groupBody);
    return { el, body: groupBody };
  }

  /**
   * What the body is visibly doing, which the status alone doesn't say.
   *
   * The inspector's status is the feed's word for the work ('working', 'waiting');
   * this is the animation you can see from inside the head, and the two genuinely
   * differ — an agent can be 'working' while walking back from the bookshelf. That
   * gap is the reason this field survived and the rest of the Agent section didn't.
   *
   * "on their feet" rather than "standing": `moving` is per-frame and goes false the
   * instant a path finishes, so an agent the roster still calls 'walking' can be
   * momentarily still, and "Walking / standing" looks broken rather than precise.
   */
  function activity(agent) {
    const place = agent.seated ? 'at their desk'
      : agent.moving ? 'walking'
      : 'on their feet';
    const carrying = CARRY_WORDS[agent.carrying];
    return carrying ? `${place}, carrying ${carrying}` : place;
  }

  /**
   * The source glyph, replaced only when the source is genuinely different.
   *
   * The sentinel matters: an agent with no source at all is legitimate, and `null`
   * has to be able to count as a change on the very first paint.
   */
  const UNSET = Symbol('unset');
  let shownSource = UNSET;
  function paintSource(source) {
    if (source === shownSource) return;
    shownSource = source;
    marks.textContent = '';
    // An agent without a source is possible; the glyph simply has nothing to say.
    if (source) marks.appendChild(markSpan(source, 'fpv-src'));
    marks.hidden = !source;
  }

  function paint(agent) {
    name.textContent = agent.name;
    paintSource(agent.source);
    swatch.style.background = hex(STATUS_COLORS[agent.status] ?? STATUS_COLORS.idle);

    // `agent.job` rather than the log entry's label, and the difference matters.
    // The log records the piece of work ("Reviewing PR #482") and keeps that title
    // until it is posted; `job` is the running headline, which the manager retitles
    // as they go — "Looking up: auth token scopes" at the bookshelf, "Done: …" on the
    // walk to the mailbox. The headline is the answer to "what are they doing", it is
    // the part that changes in real time, and it is what the roster and the inspector
    // both show: a third panel quoting something else would just look wrong.
    const open = agent.openJob();
    const headline = agent.job ?? open?.label ?? null;

    if (headline) {
      jobLabel.textContent = headline;
      jobLabel.classList.remove('idle');
    } else {
      // Between jobs is a real state and worth naming, rather than leaving the last
      // job on screen as though it were still running.
      jobLabel.textContent = 'Nothing on right now';
      jobLabel.classList.add('idle');
    }

    // Hidden rather than emptied when there is no step: an empty row still costs its
    // margins, and the HUD is small enough that a gap where nothing goes reads as a
    // panel with something missing from it.
    const part = stepLabel(agent.step) ?? planResting(agent.plan);
    stepRow.textContent = part ?? '';
    stepRow.hidden = !part;

    // Timed from the log entry, so this is the age of the work itself and does not
    // reset when the headline changes partway through.
    //
    // Falling back to the last closed entry matters more than it looks. Between
    // posting a job at the mailbox and picking up the next one, the headline still
    // reads "Done: …" while nothing is open — and a line saying the job is not
    // logged, about a job that has just this second been logged and finished, is
    // the sort of small lie that makes a panel untrustworthy. So the entry keeps
    // reporting, with its real outcome and final duration.
    const entry = open ?? agent.recentJobs(1)[0] ?? null;
    if (entry) {
      const outcome = Object.hasOwn(OUTCOME, entry.outcome) ? entry.outcome : 'active';
      const spec = OUTCOME[outcome];
      timesRow.innerHTML =
        `started ${clockTime(entry.startedAt)} · <strong>${duration(jobElapsed(entry))}</strong> · ` +
        `<span style="color:var(--job-${outcome})">${spec.word}</span>`;
    } else {
      timesRow.textContent = 'Waiting for the next job';
    }

    doingOut.textContent = activity(agent);
  }

  let since = 0;
  let shown = null;

  return {
    /** Open the panel on an agent, painted immediately. */
    show(agent) {
      shown = agent;
      since = 0;
      paint(agent);
      host.classList.remove('hidden');
      vignette?.classList.add('on');
      // The office's own title bar goes with it: the brand, the office switcher and
      // the source badge are all about which office you are looking at, which is not
      // the question you are asking from inside somebody's head. CSS decides what
      // 'riding' actually hides — see styles.css.
      shell?.classList.add('riding');
    },

    /**
     * Called every frame while riding. Repaints at READOUT_HZ so the elapsed counter
     * ticks, and immediately when the agent changes so switching riders is not
     * briefly wrong.
     */
    update(agent, dt) {
      if (!shown) return;
      const switched = agent !== shown;
      shown = agent;
      since += dt;
      if (!switched && since < 1 / READOUT_HZ) return;
      since = 0;
      paint(agent);
    },

    hide() {
      shown = null;
      host.classList.add('hidden');
      vignette?.classList.remove('on');
      shell?.classList.remove('riding');
    },
  };
}
