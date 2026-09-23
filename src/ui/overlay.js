import { STATUS_GROUPS, STATUS_COLORS, statusLabel } from '../config.js';
// Job-log wording and colours live in format.js so the inspector and the First
// Person panel describe the same job identically. The colours themselves stay in
// config.js as JOB_COLORS, which format.js reads.
import { OUTCOME, clockTime, duration, jobElapsed } from './format.js';
import { activeStepLabels } from '../agents/steps.js';
// `markSpan` lives with the marks themselves, and `hex` with the other DOM helpers:
// the First Person panel puts the same glyph and status dot before an agent's name,
// and one agent should not be able to look like two different agents.
import { markSpan } from './marks.js';
import { hex, node } from './dom.js';
// The mailbox names an envelope's recipient by their first name, and what counts as
// a first name is names.js's business — it drew the name in the first place.
import { firstNameOf } from '../agents/names.js';
// One list of buttons, held where the behaviours are: what a press *does* is the
// office's business, and the panel only draws it (see agents/pilot.js).
import { PILOT_ACTIONS, PILOT_HOLD, canPilot } from '../agents/pilot.js';
import { sourceLabel } from '../data/sources.js';

/**
 * One glyph per plan-entry state, and the distinctions are the point.
 *
 * `skipped` and `pending` must not look alike: a part deliberately passed over and a
 * part not yet reached are the two things a checklist is uniquely able to tell apart,
 * and collapsing them would make the list agree with the fraction and say nothing more
 * than it does. Text rather than SVG because these sit inline in a label — and the
 * class on the row carries the colour, so the glyph never has to carry meaning alone.
 */
const PLAN_GLYPH = {
  pending: '○',     // not reached
  active: '▶',      // in hand
  completed: '✓',
  skipped: '–',     // passed over, on purpose
  failed: '✗',
  cancelled: '✗',
};

// Wires the DOM overlay (agent roster, status legend, inspector panel, job
// delivery feed) to the AgentManager and click-to-select.
// Returns { setSelected, refresh }.

/**
 * What a roster row's status cell says — one line, or one line per job.
 *
 * A person running two cron ticks is doing two things, and showing the newest and
 * dropping the other would say they were doing one: the same small lie as a desk that
 * reads "Working". So several jobs get a line each, with each job's own verb
 * rather than the character's, because the body animates on the newest event and the
 * panel is the only place the others can be seen.
 *
 * Its own function, and pure, because it is the one part of drawing a row that contains
 * a *decision* — everything around it is assembling spans. `renderList` is closed over
 * inside `createOverlay` and needs eighty-odd DOM calls stubbed to reach, so the rule
 * was shipped untested; this is the half worth pinning and it costs nothing to reach.
 *
 * A row with no `jobs` at all renders exactly as it always did, which is what keeps
 * every harness that sends no identity unchanged: one character per session, one line.
 *
 * @param {object} a  a roster row
 * @returns {string[]} one entry per line to show, never empty
 */
export function statusLines(a) {
  const jobs = Array.isArray(a.jobs) ? a.jobs : [];
  if (jobs.length > 1) {
    return jobs.map((j) => {
      const doing = statusLabel(j.status ?? a.status);
      return j.title ? `${doing} · ${j.title}` : doing;
    });
  }
  const said = statusLabel(a.status);
  return [a.job ? `${said} · ${a.job}` : said];
}

export function createOverlay(initialManager, { onSelect, onFollowAlong } = {}) {
  // Held in a mutable binding rather than a parameter: switching projects builds
  // a brand-new AgentManager, and the overlay re-points at it via attach().
  let manager = initialManager;
  let unsubscribe = [];

  const listEl = document.getElementById('agent-list');
  const legendEl = document.getElementById('legend-list');
  const inspector = document.getElementById('inspector');
  const inspName = document.getElementById('inspector-name');
  const inspBody = document.getElementById('inspector-body');
  const inspClose = document.getElementById('inspector-close');

  const deliveryEl = document.getElementById('delivery');
  const deliveryTitle = document.getElementById('delivery-title');
  const deliveryBody = document.getElementById('delivery-body');
  const mailFlag = document.getElementById('mail-flag');

  let selectedId = null;
  // Inspector refreshes rebuild its DOM. Remember which historical jobs the user
  // opened so a live event does not snap their checklist shut underneath them.
  const expandedJobs = new Set();

  // Inspector heading: the agent's name, and nothing else. Status and source both
  // used to be glyphs up here, but the rows below now state each of them in words
  // beside its glyph — so the heading was saying less, twice, above its own answer.
  const inspTitle = node('span', 'insp-name');
  inspName.textContent = '';
  inspName.append(inspTitle);

  // The legend, built once and then only re-counted.
  //
  // It is a key to the floor rings and a census of the room in the same breath:
  // a family per block ("Working"), its members indented beneath it, and a count
  // beside each. Rebuilding the whole list on every roster change would throw
  // away scroll position and flicker several times a second, so the rows are
  // made here and `countEls` keeps a handle on the numbers.
  const countEls = new Map();       // status key | group key -> span
  legendEl.innerHTML = '';
  for (const group of STATUS_GROUPS) {
    const li = node('li', 'legend-group');

    const head = node('div', 'legend-head');
    const title = node('span', 'legend-title', group.label);
    const total = node('span', 'legend-count');
    head.append(title, total);
    countEls.set(`group:${group.key}`, total);
    li.appendChild(head);

    // A family's plain case is named by its own heading, so it gets no row: an
    // agent with nothing on is simply one of the Idle. Its count element is the
    // heading's, which is where its number already appears.
    const rows = group.statuses.filter((s) => !s.bare);
    for (const s of group.statuses) if (s.bare) countEls.set(s.key, total);

    // A family with nothing left to list says everything in its heading, so the
    // swatch moves up into it.
    if (rows.length <= 1) {
      const sw = node('span', 'swatch');
      sw.style.background = hex((rows[0] ?? group.statuses[0]).color);
      head.prepend(sw);
      if (rows.length === 1) countEls.set(rows[0].key, total);
      legendEl.appendChild(li);
      continue;
    }

    const ul = node('ul', 'legend-members');
    for (const s of rows) {
      const row = document.createElement('li');
      const sw = node('span', 'swatch');
      sw.style.background = hex(s.color);
      const label = node('span', 'legend-label', s.label);
      const n = node('span', 'legend-count');
      row.append(sw, label, n);
      countEls.set(s.key, n);
      ul.appendChild(row);
    }
    li.appendChild(ul);
    legendEl.appendChild(li);
  }

  /**
   * Re-count the legend against the roster.
   *
   * Empty rows are dimmed rather than hidden: the legend is also the key to the
   * colours on the floor, and a key that comes and goes is no key at all.
   */
  function renderLegend(roster) {
    const tally = new Map();
    for (const a of roster) tally.set(a.status, (tally.get(a.status) ?? 0) + 1);

    for (const group of STATUS_GROUPS) {
      let total = 0;
      const rows = group.statuses.filter((s) => !s.bare);
      for (const s of group.statuses) {
        const n = tally.get(s.key) ?? 0;
        total += n;
        const el = countEls.get(s.key);
        // A status with no row of its own — a lone member, or a family's plain
        // case — shares its heading's count element, and the group total below
        // writes the same number, so skip the duplicate write here.
        if (el && rows.length > 1 && !s.bare) {
          el.textContent = count(n);
          el.parentElement.classList.toggle('empty', n === 0);
        }
      }
      const head = countEls.get(`group:${group.key}`);
      head.textContent = count(total);
      head.parentElement.classList.toggle('empty', total === 0);
    }
  }

  /**
   * A census figure, written to be skimmed down a column.
   *
   * No brackets: every row had them, so they distinguished nothing and doubled the
   * width of the number they wrapped. And nothing at all for zero, because a
   * fourteen-row legend of which three have anyone in them should read as three
   * numbers on an empty page rather than as eleven noughts to discount one by one.
   * The dimmed row and its swatch still say the status exists.
   */
  function count(n) {
    return n === 0 ? '' : String(n);
  }

  inspClose.addEventListener('click', () => setSelected(null));

  function renderList(roster) {
    renderLegend(roster);
    const focusedAgent = document.activeElement?.closest?.('.agent-row')?.dataset.id;
    const followFocused = document.activeElement?.classList?.contains('insp-follow');
    listEl.innerHTML = '';
    if (roster.length === 0) {
      const li = node('li', 'roster-empty');
      li.innerHTML = '<img src="/assets/arrivals.svg" width="112" height="78" alt="">'
        + '<strong>The office is ready</strong><span>Connected agents will walk in here when their sessions start.</span>';
      listEl.appendChild(li);
    }
    for (const a of roster) {
      const li = node('li', 'agent-row' + (a.id === selectedId ? ' selected' : ''));
      li.dataset.id = a.id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', `View ${a.name}: ${statusLabel(a.status)}`);
      li.setAttribute('aria-pressed', String(a.id === selectedId));
      li.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setSelected(a.id);
        }
      });

      // Two lines: source mark, lozenge and name across the top, the status line
      // beneath — indented into the name's column by the grid in styles.css, so it
      // hangs off the name rather than off the glyphs.
      const marks = node('span', 'a-marks');
      // Per row, not per room: several sources can fill one office, so the mark is
      // how you tell a Claude session from the Rovo terminal sitting next to it.
      if (a.source) marks.appendChild(markSpan(a.source, 'a-src'));
      const sw = node('span', 'swatch');
      sw.style.background = hex(STATUS_COLORS[a.status] ?? STATUS_COLORS.idle);
      marks.appendChild(sw);

      const name = node('span', 'name', a.name);
      const status = node('span', 'status');
      const lines = statusLines(a);
      if (lines.length > 1) {
        status.classList.add('multi');
        for (const text of lines) {
          const line = node('span', 'job-line', text);
          status.appendChild(line);
        }
      } else {
        [status.textContent] = lines;
      }

      // Which part of the round, when the round has parts — which it usually does not.
      // Dimmer and after the headline, because the headline is still the answer to
      // "what are they doing" and the part only qualifies it.
      //
      // Falling back to the tally rather than to nothing keeps the row the same height
      // between one part and the next. The gap is real — on a skipped entry it is the
      // whole of what happens — and a line that came and went would make the roster
      // twitch down the page every few seconds.
      const parts = activeStepLabels(a.step, a.plan);
      if (parts.length) {
        const steps = node('span', 'steps');
        for (const part of parts) {
          const step = node('span', 'step', part);
          steps.appendChild(step);
        }
        li.append(marks, name, status, steps);
      } else {
        li.append(marks, name, status);
      }
      li.addEventListener('click', () => setSelected(a.id));
      listEl.appendChild(li);
    }
    // Keep inspector fresh if the selected agent's data changed.
    if (selectedId) renderInspector(roster.find((r) => r.id === selectedId));
    if (focusedAgent) [...listEl.children].find((row) => row.dataset.id === focusedAgent)?.focus({ preventScroll: true });
    if (followFocused) inspBody.querySelector('.insp-follow')?.focus({ preventScroll: true });
  }

  function renderInspector(a) {
    if (!a) { inspector.classList.add('hidden'); return; }
    inspector.classList.remove('hidden');

    inspTitle.textContent = a.name;

    inspBody.innerHTML = '';

    // The portrait leads, when there is one. An identity that sent a picture of itself
    // has said something no row can: this is what Florence looks like. A broken or slow
    // URL removes itself rather than leaving a torn-image glyph in the panel, because the
    // bytes came off somebody else's machine and may simply not be there any more.
    if (a.avatar) {
      const portrait = node('div', 'portrait');
      const img = document.createElement('img');
      img.alt = `${a.name}'s avatar`;
      img.loading = 'lazy';
      img.addEventListener('error', () => portrait.remove());
      img.src = a.avatar;
      portrait.appendChild(img);
      inspBody.appendChild(portrait);
    }

    // Status carries the same lozenge as the roster row and the same one word —
    // one vocabulary, spelled one way wherever an agent's state is stated on its own.
    const statusVal = node('span', 'v v-status');
    const statusDot = node('span', 'v-dot');
    statusDot.style.backgroundColor = hex(STATUS_COLORS[a.status] ?? STATUS_COLORS.idle);
    statusVal.append(statusDot, document.createTextNode(statusLabel(a.status)));

    // Source sits directly under status: both answer "what is this agent", where
    // the rows below it are identity and trivia. It comes off the agent, because
    // in a mixed office the answer differs from desk to desk.
    const def = a.source ?? null;
    const sourceVal = node('span', 'v v-source');
    // The variant comes off the agent, not the office: one feed can carry a
    // terminal session and a desktop-driven one at the same time, and the row is
    // describing this agent rather than the room.
    if (def) sourceVal.append(markSpan(def, 'v-src'), document.createTextNode(sourceLabel(def, a.variant)));
    else sourceVal.textContent = '—';

    const rows = [
      ['Source', sourceVal],
      ['Status', statusVal],
      ['Agent ID', a.id],
      ['Drink Preference', a.drink?.name ?? '—'],
    ];

    // Colour, but only when it was a choice. Everybody in the room has a colour, so a
    // row that always appeared would be telling you about the palette's dice roll; this
    // one says "this agent asked to be recognisable", which is worth a line. Shown as
    // written — `teal`, `#c1440e` — beside the swatch it resolved to, because the two
    // disagreeing is exactly what somebody debugging their IDENTITY.md needs to see.
    if (a.colorLabel) {
      const colorVal = node('span', 'v v-status');
      const swatch = node('span', 'v-dot');
      swatch.style.backgroundColor = hex(a.color);
      colorVal.append(swatch, document.createTextNode(a.colorLabel));
      rows.push(['Colour', colorVal]);
    }
    for (const [k, v] of rows) {
      const kv = node('div', 'kv');
      const key = node('span', 'k', k);
      // Plain strings become a value span here; the richer rows arrive built. Both
      // paths set text as text — an agent name or job arrives from a harness, and
      // markup in one would otherwise be parsed as markup.
      let val = v;
      if (typeof v === 'string') {
        val = document.createElement('span');
        val.className = 'v';
        val.textContent = v;
      }
      kv.append(key, val);
      inspBody.appendChild(kv);
    }

    const follow = document.createElement('button');
    follow.type = 'button';
    follow.className = 'insp-follow';
    follow.textContent = 'Follow Along';
    follow.title = 'Look through this agent’s eyes (F)';
    follow.addEventListener('click', () => onFollowAlong?.());
    inspBody.appendChild(follow);

    const jobTitle = node('h3', 'insp-job-title');
    jobTitle.textContent = 'Current work';
    inspBody.appendChild(jobTitle);
    const job = node('div', 'job');
    if (a.job) {
      job.textContent = a.job;
    } else {
      job.classList.add('job-idle');
      job.innerHTML = '<img src="/assets/breather.svg" width="84" height="60" alt="">'
        + '<span>A little breathing room.<br>Ready for the next job.</span>';
    }
    inspBody.appendChild(job);

    if (a.plan) inspBody.appendChild(buildPlan(a.plan, a.step));

    inspBody.appendChild(buildJobLog(a.id, a.recent ?? []));

    // Last, because it is the only thing in this panel you press rather than read,
    // and because a row of controls above the log would push the answer to "what has
    // this agent been doing" off the bottom of a 300px column.
    //
    // Simulated agents only, and `canPilot` is where that rule lives.
    if (canPilot(a.source)) inspBody.appendChild(buildPilot(a));
  }

  /**
   * The buttons that drive this agent by hand.
   *
   * A test agent runs its own loop, so the movement you want to look at arrives when
   * the dice say so — which makes the room hard to check. These ask for it directly:
   * one button per behaviour the office has, each firing the event a feed would have
   * sent (see agents/pilot.js), and the agent is then held still for a few seconds so
   * there is time to look at where they ended up.
   *
   * Drawn for simulated agents and nobody else — see the call site.
   *
   * The pressed button stays lit for as long as the hold lasts, because otherwise
   * nothing on screen says the room has stopped deciding for itself — and that is
   * exactly the state somebody watching needs to know they are in.
   */
  function buildPilot(a) {
    const frag = document.createDocumentFragment();

    const head = node('div', 'log-head');
    const heading = node('span', '', 'Test Action');
    const note = node('span', 'count');
    note.textContent = a.piloted ? `held · back to the loop in ${PILOT_HOLD}s` : '';
    head.append(heading, note);

    const row = node('div', 'pilot');
    for (const action of PILOT_ACTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      // The same lozenge the strips use, because it is the same gesture: one
      // vocabulary for "a thing you press" across the whole UI.
      btn.className = 'dev-btn pilot-btn' + (a.piloted === action.key ? ' active' : '');
      btn.textContent = action.label;
      btn.title = action.title;
      btn.addEventListener('click', () => {
        manager.pilot(a.id, action.key);
        // Repaint at once rather than waiting for the next roster event: the press
        // has already taken effect, and a button that lights up a second later
        // reads as a button that was not pressed.
        renderList(manager.roster());
      });
      row.appendChild(btn);
    }

    frag.append(head, row);
    return frag;
  }

  /**
   * The checklist for the round in hand, nested under it.
   *
   * This is the panel the plan exists for. A step on its own can say "2 of 5" but only
   * a plan can draw the other four — and in particular can draw the difference between
   * a part that was **skipped** and one that has **not been reached**, which is
   * invisible everywhere else and is the whole reason §4.2 calls a plan a hint.
   *
   * Drawn only when there is a plan, and there is one for a minority of rounds: a job
   * without parts must look exactly as it did before any of this existed.
   */
  function buildPlan(plan, step) {
    const ul = node('ul', 'plan');

    for (const entry of plan.items) {
      const li = document.createElement('li');
      // The open step wins over the entry's own status: the plan is a description that
      // may lag, and the step is what is happening now.
      const live = step && (entry.id === step.id || entry.title === step.title);
      li.className = `plan-${live ? 'active' : entry.status}`;

      const tick = node('span', 'plan-tick');
      tick.textContent = PLAN_GLYPH[live ? 'active' : entry.status] ?? PLAN_GLYPH.pending;

      const label = node('span', 'plan-label', entry.title);

      li.append(tick, label);
      ul.appendChild(li);
    }

    // A plan longer than the wire carries says so, rather than quietly ending early.
    if (plan.more > 0) {
      const li = node('li', 'plan-more', `… and ${plan.more} more`);
      ul.appendChild(li);
    }
    return ul;
  }

  /** The agent's last N jobs, newest first, with a time log per entry. */
  function buildJobLog(agentId, recent) {
    const frag = document.createDocumentFragment();

    const head = node('div', 'log-head');
    const heading = node('span', '', 'Recent jobs');
    const count = node('span', 'count', recent.length ? `last ${recent.length}` : '');
    head.append(heading, count);
    frag.appendChild(head);

    if (recent.length === 0) {
      const none = node('div', 'log-empty', 'No jobs logged yet.');
      frag.appendChild(none);
      return frag;
    }

    const ul = node('ul', 'log');
    for (const entry of recent) {
      const spec = OUTCOME[entry.outcome] ?? OUTCOME.active;
      const li = node('li', entry.outcome);

      const details = document.createElement('details');
      const hasPlan = Boolean(entry.plan?.items?.length);
      details.className = `log-entry${hasPlan ? ' expandable' : ''}`;
      const key = `${agentId}:${entry.startedAt}`;
      if (hasPlan) {
        details.open = expandedJobs.has(key);
        details.addEventListener('toggle', () => {
          if (details.open) expandedJobs.add(key);
          else expandedJobs.delete(key);
        });
      }

      const summary = document.createElement('summary');
      if (!hasPlan) summary.addEventListener('click', (event) => event.preventDefault());

      const dot = node('span', 'dot');
      dot.style.background = spec.color;

      const text = document.createElement('div');
      const label = node('div', 'label', entry.label);

      const elapsed = jobElapsed(entry);
      const times = node('div', 'times');
      // One entry per round, however many parts it had — the count is the point. A
      // five-part round logging as five jobs was the trap this whole field exists to
      // avoid, so the log says "5 parts" and stays one line.
      const parts = entry.steps
        ? ` (${entry.steps.done}/${entry.steps.of})`
        : '';
      times.innerHTML =
        `${clockTime(entry.startedAt)} · ${duration(elapsed)} · ` +
        `<span class="outcome">${spec.word}</span>${parts}`;

      text.append(label, times);
      summary.append(dot, text);
      details.appendChild(summary);
      if (hasPlan) details.appendChild(buildHistoryPlan(entry.plan));
      li.appendChild(details);
      ul.appendChild(li);
    }
    frag.appendChild(ul);
    return frag;
  }

  /** A completed job's retained checklist, revealed from Recent jobs. */
  function buildHistoryPlan(plan) {
    const ul = node('ul', 'log-plan');
    for (const entry of plan.items) {
      const li = node('li', `plan-${entry.status}`);
      const tick = node('span', 'plan-tick', PLAN_GLYPH[entry.status] ?? PLAN_GLYPH.pending);
      const label = node('span', 'plan-label', entry.title);
      li.append(tick, label);
      ul.appendChild(li);
    }
    if (plan.more > 0) {
      const li = node('li', 'plan-more', `… and ${plan.more} more`);
      ul.appendChild(li);
    }
    return ul;
  }

  // --- Job Delivery / Job Removal ----------------------------------------

  /**
   * One line of mailbox traffic: when it happened, what it was, and any aside.
   *
   * `to` names the agent an addressed envelope belongs to, if it has one. It rides
   * on the time line rather than in `extra`, which is about the state of the box —
   * this is part of the envelope's address, and the two are different facts.
   *
   * @param {number} at              epoch ms
   * @param {string} what            the job
   * @param {?string} [extra]        an aside about the mailbox
   * @param {?{name: string, color: ?number}} [to]  the addressed recipient
   * @param {?('letter'|'package')} [arrival]  which way the work arrived
   */
  function mailItem(at, what, extra, to = null, arrival = null) {
    const wrap = node('div', 'mail-item');

    const when = node('div', 'when');
    when.append(document.createTextNode(clockTime(at)));
    if (to?.name) when.appendChild(addressee(to));

    const text = node('div', 'what');
    // Which door the work came in by — air or courier. Marked on the line rather than
    // spelled out, because the shape is the whole message. It says nothing about the
    // work itself: both are a job, and the channel is a toss.
    if (arrival) {
      const mark = node('span', `parcel-mark ${arrival}`);
      mark.title = arrival === 'package' ? 'Arrived by courier' : 'Arrived by air';
      text.appendChild(mark);
    }
    text.appendChild(document.createTextNode(what));

    wrap.append(when, text);

    if (extra) {
      const more = node('div', 'extra', extra);
      wrap.appendChild(more);
    }
    return wrap;
  }

  /**
   * Who an addressed envelope is for: a paper dart in their colour, then their
   * first name.
   *
   * The colour is the one the plane carried across the room, so the line under the
   * heading answers the question you were already asking while you watched it fly.
   * First name only: the surname is this office's word for the job, and the job
   * itself is spelled out on the very next line.
   */
  function addressee({ name, color }) {
    const el = node('span', 'to');
    el.title = `Addressed to ${name}`;

    const dart = node('span', 'dart');
    if (typeof color === 'number') dart.style.background = hex(color);

    const who = node('span', '', firstNameOf(name));

    el.append(dart, who);
    return el;
  }

  function showEmptyMailbox() {
    deliveryBody.innerHTML = '';
    const empty = node('div', 'mail-empty', 'Mailbox is empty');
    deliveryBody.appendChild(empty);
  }

  function setFlag(up) { mailFlag.classList.toggle('up', up); }

  /**
   * Mailbox traffic. A delivery raises the flag and names the new job; a
   * collection lowers it once nothing is left waiting; a removal relabels the
   * whole section and names what got binned.
   */
  function renderFeed(entry) {
    const waiting = entry.pending ?? 0;

    if (entry.kind === 'removal') {
      deliveryEl.classList.add('removal');
      deliveryTitle.textContent = 'Job Removal';
      deliveryBody.innerHTML = '';
      deliveryBody.appendChild(mailItem(
        entry.at, entry.job || 'Unnamed job',
        entry.by ? `binned by ${entry.by}` : null
      ));
      // The flag reflects the mailbox, not the bin.
      setFlag(waiting > 0);
      return;
    }

    deliveryEl.classList.remove('removal');
    deliveryTitle.textContent = 'Job Delivery';

    if (entry.kind === 'delivery') {
      deliveryBody.innerHTML = '';
      deliveryBody.appendChild(mailItem(
        entry.at, entry.job,
        waiting > 1 ? `+${waiting - 1} more waiting` : null,
        entry.for ? { name: entry.for, color: entry.forColor } : null,
        entry.arrival ?? null
      ));
      setFlag(true);
      return;
    }

    // 'collected'. Name what was taken, not just that something was: a letter and a
    // package are different amounts of work leaving the box, and the line used to say
    // "took one" either way.
    const took = entry.by
      ? (entry.arrival ? `${entry.by} took a ${entry.arrival}` : `${entry.by} took one`)
      : null;

    if (waiting > 0) {
      deliveryBody.innerHTML = '';
      deliveryBody.appendChild(mailItem(
        entry.at, `${waiting} job${waiting === 1 ? '' : 's'} still waiting`,
        took, null, entry.arrival ?? null
      ));
      setFlag(true);
    } else if (took) {
      // Emptying the box used to drop this on the floor: the flag went down and the
      // panel simply said "Mailbox is empty", so the last thing collected was the one
      // collection never announced.
      deliveryBody.innerHTML = '';
      deliveryBody.appendChild(mailItem(
        entry.at, 'Mailbox is empty', took, null, entry.arrival ?? null
      ));
      setFlag(false);
    } else {
      showEmptyMailbox();
      setFlag(false);
    }
  }

  function setSelected(id) {
    selectedId = id;
    onSelect?.(id);
    const roster = manager.roster();
    renderList(roster);
    renderInspector(roster.find((r) => r.id === id) || null);
  }

  /**
   * Point the overlay at a manager, dropping any previous subscriptions. Called
   * once at startup and again on every project switch.
   */
  function attach(nextManager) {
    for (const off of unsubscribe) off();
    unsubscribe = [];

    manager = nextManager;
    // Any prior selection belonged to agents that no longer exist.
    selectedId = null;
    onSelect?.(null);

    unsubscribe.push(manager.onChange(renderList));
    unsubscribe.push(manager.onFeed(renderFeed));

    // Reset the mailbox section — the new office starts with an empty mailbox.
    deliveryEl.classList.remove('removal');
    deliveryTitle.textContent = 'Job Delivery';
    showEmptyMailbox();
    setFlag(false);

    // Both panels read each agent's source off the roster as they render, so a
    // switch needs nothing else here: attach() has already re-pointed it.
    renderList(manager.roster());
    renderInspector(null);
  }

  attach(initialManager);

  // Roster changes are event-driven, so an in-progress job's elapsed time would
  // otherwise sit frozen between events. Re-render the open inspector once a
  // second to keep its time log ticking.
  setInterval(() => {
    if (selectedId) renderInspector(manager.roster().find((r) => r.id === selectedId));
  }, 1000);

  return { setSelected, attach, refresh: () => renderList(manager.roster()) };
}
