import { AgentSource } from './AgentSource.js';
import { firstNameFor, surnameFromPrompt, fullName } from '../agents/names.js';
import { chance, pick, spread, whole } from '../dice.js';

// Generates a believable stream of agent lifecycle events so the office feels
// alive with zero external dependencies.
//
// The simulation is **driven by the post**, exactly as a real office is. Nobody
// invents their own work: a request arrives addressed to somebody who is free, and
// what they spend the next minute on is whatever was inside that envelope. This is
// the one thing worth getting right here, because the alternative — a timer that
// announces one job while the mailbox delivers another — makes it impossible to
// follow a single piece of work across the room, which is the whole point of
// watching it.
//
// A shift looks like:
//   arrive (climb the stairs, hang a coat)
//     -> a request lands, addressed to them; collect it and take it to a desk
//     -> maybe look it up: in the graph at the bookshelf, or on the web at the globe
//     -> maybe wait on input; occasionally the work fails and is binned
//     -> post the finished work in the mailbox
//     -> a drink or a sit down, then the next request
//   ...for a handful of requests, then clock off and walk out.
// People arrive on their own schedule and leave when their shift is done, so the
// headcount drifts rather than sitting pinned at the cap.

// Focused work is the thing you actually watch, so give it room to breathe.
const WORK_UNIT = 15000;     // base length of a stretch of desk work (ms)

// Getting hold of the work: walk to the box, wait for it to land, carry it back.
// One figure, between what a letter used to take and what a parcel did. It was two
// for a while, on the reasoning that a courier comes the long way round — but the
// channel is a coin toss now and says nothing about the work, so timing the mock feed
// off it would have made the same claim the old size inference did.
const PICKUP = 11000;

const RESEARCH_TIME = 9000;  // walk to the shelf, read, walk back
const STEP_UNIT = 5200;      // one part of a checklist, before jitter
const BIN_TIME = 6000;       // walk to the bin, discard
const POST_TIME = 7000;      // walk to the mailbox, drop it in
const WALK_OUT = 12000;      // still in the room until the door closes behind them

// Coming and going, which is the shape of the day rather than a rate.
//
// The office opens with its full complement of regulars and never drops below
// them, fills up slowly over the first few minutes as the extras drift in, and
// from then on wanders between the two — somebody's shift ends, a while later
// somebody else turns up. The two gaps are what make that happen: short-handed,
// the next arrival is soon; otherwise it is a long way off, so the climb to a
// full room is a slow one and a vacated desk stays vacated for a bit.
const ARRIVE_GAP_SHORT = [4000, 4000];    // below the floor: fill up promptly
const ARRIVE_GAP_LONG = [26000, 22000];   // at or above it: drift up slowly
const SETTLE_MIN = 3200;     // walking in and hanging a coat: not ready for work yet
const SETTLE_JITTER = 1800;
const SHIFT_MIN = 2;         // requests handled before clocking off
const SHIFT_MAX = 4;

// Mail cadence. A request is only ever posted to somebody who can start on it, so
// this is a floor on how often work turns up rather than a rate: when the room is
// busy the next request simply waits for a free pair of hands.
const MAIL_GAP_MIN = 5000;
const MAIL_GAP_JITTER = 7000;
const MAIL_RETRY_GAP = 3000;   // recheck delay while everybody is busy

// How often the interesting-but-rarer things happen, per request.
const P_RESEARCH = 0.5;        // ...of which half are web look-ups (see TOPICS)
const P_WAITING = 0.2;
const P_ERROR = 0.12;
const P_BREAK = 0.6;
// How much of the work is a walk through a checklist rather than one long sitting
// (spec §4.2). Deliberately a minority: no steps means one step, and a room where
// every desk had a progress fraction on it would be a room that had stopped saying
// anything by having a checklist. A quarter is enough to keep the panels honest.
const P_PLANNED = 0.25;
const P_STEP_SKIP = 0.35;      // ...of which some skip a part they find nothing to do in
const P_STEP_FAIL = 0.12;      // ...and some die partway down the list
const P_UNADDRESSED = 0.2;     // "for whoever's free" rather than for one person

// Requests, worded the way a person would ask for something — an instruction with
// a plain noun in it. That is not decoration: a session is named after the job it
// is on (see agents/names.js), so "Fix the flaky checkout test" is what makes
// somebody Flaky-Mender, and a title of pure jargon would leave them surnameless.
const REQUESTS = [
  'Fix the flaky checkout test',
  'Write up the onboarding guide',
  'Investigate the slow dashboard',
  'Review the payments proposal',
  'Summarise the incident report',
  'Draft the quarterly summary',
  'Fix the broken picture links',
  'Sort the support queue',
  'Trace the missing payment',
  'Rename the settings panel',
  'Check the backup restore',
  'Update the holiday calendar',
  'Prune the stale branches',
  'Measure the page load',
  'Answer the questions on the pricing page',
  'Tidy the release notes',
  'Compare the two proposals',
  'Test the new coffee order form',
  'Clean up the old screenshots',
  'Wire up the weekly report',
  // These were a separate `PACKAGES` list once, kept apart so that a crate
  // never arrived labelled "fix a typo". There are no crates now — a parcel and a
  // letter are the same job arriving by different doors — so the two pools are one
  // and any request may come either way.
  'Migrate the customer records',
  'Refresh the search index',
  'Design the welcome email',
  'Plan the winter release',
  'Sort out the shipping rules',
  'Audit the access list',
  'Write up the welcome tour',
  'Translate the help centre',
  'Simplify the booking flow',
  'Tidy the billing schema',
  'Merge the customer reports',
  'Document the payment flow',
];

// Work that comes with a checklist. Each of these is *one* request — one envelope,
// one log entry, one surname — that happens to be done in parts, which is the whole
// distinction spec §4.2 exists to draw. A five-part round is not five jobs.
//
// Titles carry a plain noun for the same reason the ones above do (sweep, books,
// starter, notes, keys, queue), since the surname is read off the request. The steps
// do not need one: nobody is named after a part.
//
// A round says what the work is and not how it arrives: the channel is a toss made
// when the envelope is posted (see post.js), so watching the same round twice may
// show it flying in once and being carried in the next time. That variety is the
// only thing the channel is for now.
const ROUNDS = [
  { job: 'Run the nightly data sweep', steps: [
    'Collect yesterday\'s exports', 'Check the row counts', 'Reconcile the ledger',
    'Archive the old batches', 'Post the summary',
  ] },
  { job: 'Close the books for the month', steps: [
    'Pull the invoices', 'Chase the missing receipts', 'Balance the accounts', 'File the return',
  ] },
  { job: 'Onboard the new starter', steps: [
    'Create the accounts', 'Assign a buddy', 'Book the welcome chat',
  ] },
  { job: 'Publish the release notes', steps: [
    'Gather the merged changes', 'Draft the highlights', 'Check the screenshots', 'Publish the page',
  ] },
  { job: 'Rotate the signing keys', steps: [
    'Generate the new pair', 'Update the secret store', 'Restart the workers',
    'Revoke the old key', 'Note it in the runbook',
  ] },
  { job: 'Answer the overnight support queue', steps: [
    'Triage the new tickets', 'Reply to the escalations', 'Close the resolved ones',
  ] },
];

// What a look-up is *of*, and the two of them are deliberately the same length.
// The office answers a question in one of two places — the shelf holds what the
// company knows, and the globe on top of it stands in for the web — so an even
// split is what keeps both of them in use.
const TOPICS = {
  graph: [
    'the graph schema', 'the deploy runbook', 'the incident timeline',
    'last quarter\'s metrics', 'the data retention policy', 'the support handbook',
    'the design system notes', 'who owns the billing service',
  ],
  web: [
    'currency rounding rules', 'the timezone database', 'an accessibility standard',
    'a postcode format', 'public holiday dates', 'a licence compatibility question',
    'the going rate for postage', 'how everyone else words this',
  ],
};

export class MockSource extends AgentSource {
  /**
   * @param {object} opts
   * @param {number|(() => number)} opts.capacity  the headcount cap, counting agents
   *   who are on their way out. A function, because the cap is the number of desks in
   *   the room and the room can be rearranged while the office is open: asked afresh
   *   each time somebody is due to arrive, it lets a desk added in the editor be filled
   *   and a desk taken away stop being replaced.
   * @param {number} opts.startCount  agents in when the office opens, and the
   *                                  floor it never drops below afterwards
   */
  constructor({ capacity = 4, startCount = 2 } = {}) {
    super();
    this.capacity = typeof capacity === 'function' ? capacity : () => capacity;
    this.startCount = startCount;
    this._timers = new Set();
    this._seq = 0;
    /** @type {Map<string, {id: string, first: string, surname: ?string, free: boolean, remaining: number}>} */
    this._people = new Map();
    // Told to leave but still walking out. They occupy the room visually, so they
    // count against the cap until the door shuts.
    this._leaving = new Set();
    this._stopped = false;
  }

  /** The most people the room can hold: one per desk. */
  get maxAgents() { return Math.max(1, this.capacity()); }

  /**
   * The regulars. Whoever is in when the doors open is who the office cannot do
   * without: their shifts never end while they are the ones holding the room.
   *
   * Derived rather than fixed at construction, because the cap it is held under can
   * change: an office cut down to two desks stops holding three people, and drains to
   * two as their shifts end rather than keeping a crowd standing.
   */
  get minAgents() { return Math.max(1, Math.min(this.startCount, this.maxAgents)); }

  start(onEvent) {
    this.onEvent = onEvent;
    // The opening cast doesn't file in on a metronome.
    let t = 700;
    // Never more than there are desks: an office of two desks opens with two people
    // in it however many the project asked for.
    const opening = Math.min(this.startCount, this.maxAgents);
    for (let i = 0; i < opening; i++) {
      this._arrive(t);
      t += spread(2200, 2600);
    }
    this._scheduleArrival();
    this._scheduleMail(2500);
    return this;
  }

  stop() {
    this._stopped = true;
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
  }

  /** Everyone in the office, including those on their way out. */
  _headcount() { return this._people.size + this._leaving.size; }

  // --- scheduling helpers --------------------------------------------------
  _at(delay, fn) {
    const t = setTimeout(() => {
      this._timers.delete(t);
      if (!this._stopped) fn();
    }, Math.max(0, delay));
    this._timers.add(t);
    return t;
  }

  _emit(ev, delay = 0) { this._at(delay, () => this.onEvent?.(ev)); }

  // --- coming and going ----------------------------------------------------
  /**
   * Somebody turns up, whether or not there is room; if there isn't, nobody does.
   *
   * How long until the next one depends on how short-handed the office is, which
   * is the whole of the occupancy behaviour: a room below its regulars refills
   * promptly, a room that has them takes its time about the rest.
   */
  _scheduleArrival() {
    const [base, jitter] = this._headcount() < this.minAgents ? ARRIVE_GAP_SHORT : ARRIVE_GAP_LONG;
    this._at(spread(base, jitter), () => {
      this._arrive(0);
      this._scheduleArrival();
    });
  }

  _arrive(delay) {
    if (this._headcount() >= this.maxAgents) return;

    const id = `agent-${++this._seq}`;
    // Named the way a real session is: a first name that sticks, hashed from the
    // key so it survives a reload, and no double-Adas in one room. The job half of
    // the name comes later, off the first request they are given.
    const first = firstNameFor(`mock:${id}`, this._firstNames());
    const person = { id, first, surname: null, free: false, remaining: whole(SHIFT_MIN, SHIFT_MAX) };
    this._people.set(id, person);

    this._emit({ type: 'spawn', id, name: first }, delay);
    // Not available until they are actually in and settled: post addressed to
    // somebody still on the stairs is post nobody is walking towards.
    this._at(spread(delay + SETTLE_MIN, SETTLE_JITTER), () => {
      if (this._people.has(id)) person.free = true;
    });
  }

  /**
   * Clock off — unless they are one of the regulars holding the room, in which
   * case the shift quietly extends. Somebody has to be here, and an office that
   * empties reads as one that is broken.
   */
  _clockOff(person) {
    if (this._people.size <= this.minAgents) {
      person.remaining = 1;     // one more, and check again then
      return this._free(person);
    }
    this._people.delete(person.id);
    this._leaving.add(person.id);
    this._emit({ type: 'exit', id: person.id }, 800);
    this._at(WALK_OUT, () => this._leaving.delete(person.id));
  }

  /** First names in use, so two people in one room are never both Ada. */
  _firstNames() {
    return new Set([...this._people.values()].map((p) => p.first));
  }

  // --- the post ------------------------------------------------------------
  /**
   * Post a request to somebody who can start on it, then schedule the next.
   *
   * With nobody free there is nothing useful to do but wait: a request needs a
   * pair of hands, and posting one anyway just builds a queue nobody is walking
   * towards. That check is the whole of the throttle — the source knows who is
   * busy because it is the thing keeping them busy.
   */
  _scheduleMail(delay) {
    this._at(delay, () => {
      const free = [...this._people.values()].filter((p) => p.free);
      if (!free.length) return this._scheduleMail(spread(MAIL_RETRY_GAP, MAIL_RETRY_GAP));

      this._assign(pick(free));
      this._scheduleMail(spread(MAIL_GAP_MIN, MAIL_GAP_JITTER));
    });
  }

  /**
   * Post a request right now, outside the usual cadence — this is what the `t`
   * shortcut calls.
   *
   * Deliberately ignores whether anybody is free: someone asking for a job by
   * hand has already judged that for themselves, and a keypress that quietly
   * declined would just look broken. It leaves the scheduled cadence alone too, so
   * holding the key neither starves nor doubles up the automatic stream.
   *
   * @param  {string} [job]  defaults to one of the sample requests
   * @return {?string} the request posted, or null once the source has stopped
   */
  sendJob(job = null) {
    if (this._stopped) return null;
    const free = [...this._people.values()].filter((p) => p.free);
    // Nobody free, so it goes in the box unaddressed for whoever finishes first.
    if (!free.length) {
      const chosen = job ?? pick(REQUESTS);
      this.onEvent?.({ type: 'mail', job: chosen });
      return chosen;
    }
    return this._assign(pick(free), job);
  }

  /**
   * Post a request that comes with a checklist, on demand.
   *
   * The scheduled stream sends one of these about a quarter of the time, which is the
   * right frequency to watch and the wrong one to *test* — hence a way to ask. Falls
   * back to the ordinary path when nobody is free, because an unaddressed envelope has
   * no session to walk the parts of it.
   *
   * @return {?string} the request posted
   */
  sendRound() {
    if (this._stopped) return null;
    const free = [...this._people.values()].filter((p) => p.free);
    if (!free.length) return this.sendJob();
    return this._assign(pick(free), null, pick(ROUNDS));
  }

  /**
   * Hand one request to one person: it flies in (or is carried in) addressed to
   * them, they are put to work, and the job renames them.
   *
   * @return {string} the request
   */
  _assign(person, job = null, round = null) {
    // A request nobody named is sometimes one that comes with a checklist. An explicit
    // title always wins: somebody who typed a request meant that request.
    const chosenRound = round ?? (job || !chance(P_PLANNED) ? null : pick(ROUNDS));
    const chosen = chosenRound?.job ?? job ?? pick(REQUESTS);
    person.free = false;

    // Addressed post is the norm — a prompt belongs to the session it was typed
    // into — but some work is genuinely for whoever gets to it first, and that
    // path deserves to be exercised too.
    const addressed = !chance(P_UNADDRESSED);
    // The checklist rides inside the envelope, exactly as it does off the wire, so the
    // office learns it when the agent opens the thing rather than when it was posted.
    this.onEvent?.({
      type: 'mail', job: chosen, forId: addressed ? person.id : null,
      plan: chosenRound ? MockSource._planOf(chosenRound) : null,
    });
    // Put to work without naming the job: the envelope titles it on collection,
    // so announcing a title here would only be overwritten by the same one.
    this._emit({ type: 'status', id: person.id, status: 'working' }, 150);
    this._rename(person, chosen);

    this._work(person, chosen, chosenRound);
    return chosen;
  }

  /** A checklist in the shape the office reduces one into: all pending, nothing skipped yet. */
  static _planOf(round) {
    return {
      items: round.steps.map((title, i) => ({ id: `s${i + 1}`, title, status: 'pending' })),
      more: 0,
    };
  }


  /** A new job earns a new surname, exactly as it does for a live session. */
  _rename(person, job) {
    const surname = surnameFromPrompt(job);
    if (!surname || surname === person.surname) return;
    person.surname = surname;
    this._emit({ type: 'rename', id: person.id, name: fullName(person.first, surname) }, 400);
  }

  // --- one request, from collection to delivery -----------------------------
  _work(person, job, round = null) {
    const { id } = person;
    let t = PICKUP + WORK_UNIT * (1 + Math.random());
    let failed;

    if (round) {
      // The parts *are* the work, so a round walks its checklist instead of taking one
      // long stretch at the desk. No bookshelf trip and no waiting on you: those are
      // worth exercising, but a round already has plenty going on, and the interesting
      // question here is whether the fraction and the ticks keep up.
      ({ t, failed } = this._walkPlan(person, round, t));
    } else {
      // Something needs looking up. Where they look is the interesting part: the
      // shelf holds what the company knows, the globe answers for the web.
      if (chance(P_RESEARCH)) {
        const scope = chance(0.5) ? 'web' : 'graph';
        this._emit({ type: 'research', id, topic: pick(TOPICS[scope]), scope }, t);
        t += RESEARCH_TIME;
        this._emit({ type: 'job', id, job }, t);   // back on the request itself
        t += WORK_UNIT * spread(0.7, 0.7);
      }

      // Sometimes they need something from you.
      if (chance(P_WAITING)) {
        this._emit({ type: 'status', id, status: 'waiting' }, t);
        t += spread(2800, 2600);
        this._emit({ type: 'status', id, status: 'working' }, t);
        t += WORK_UNIT * spread(0.6, 0.6);
      }

      failed = chance(P_ERROR);
    }

    // Occasionally it fails. The work is binned and that is the end of it — they
    // are free again, and the next request will find them soon enough.
    if (failed) {
      this._emit({ type: 'status', id, status: 'error' }, t);
      return this._at(t + BIN_TIME, () => this._done(person));
    }

    this._emit({ type: 'dispatch', id, summary: `Done: ${job}` }, t);
    this._at(t + POST_TIME, () => this._done(person));
  }

  /**
   * Walk a checklist, part by part, announcing each one as it is taken up.
   *
   * Two things are deliberately imperfect, because both are the normal case for real
   * work and both are what the panels have to survive. A part is sometimes **skipped**
   * — a sweep that finds nothing to archive has still done the archiving — and the
   * round sometimes **dies partway down the list**, leaving the rest never reached
   * rather than never mentioned.
   *
   * @return {{t: number, failed: boolean}} the clock after the last part
   */
  _walkPlan(person, round, t0) {
    const { id } = person;
    const plan = MockSource._planOf(round);
    const of = plan.items.length;
    let t = t0;

    // Never the first part: a round that skipped or died before it started anything
    // would only be testing the empty case, which the unplanned path covers already.
    const skipAt = chance(P_STEP_SKIP) ? whole(1, of - 1) : -1;

    // Where it can go wrong: any part after the first, except the one already being
    // skipped. Drawing the two independently let them collide, and on a collision the
    // skip branch returns early and swallows the failure — so the round finished clean
    // and whether this path ran at all was a coin toss. Choosing from what is left
    // cannot collide, which beats rerolling until it does not.
    const candidates = [];
    for (let i = 1; i < of; i += 1) if (i !== skipAt) candidates.push(i);
    const failAt = candidates.length > 0 && chance(P_STEP_FAIL)
      ? pick(candidates)
      : -1;

    for (let i = 0; i < of; i += 1) {
      const item = plan.items[i];
      if (i === skipAt) {
        item.status = 'skipped';
        this._emitStep(id, null, plan, t);
        t += 700;
        continue;
      }

      item.status = 'active';
      this._emitStep(id, { id: item.id, title: item.title, index: i + 1, of }, plan, t);
      t += STEP_UNIT * spread(0.6, 0.8);

      if (i === failAt) {
        item.status = 'failed';
        // Everything below stays pending, which is the honest record: those parts were
        // not skipped, they were never reached.
        this._emitStep(id, null, plan, t);
        return { t, failed: true };
      }
      item.status = 'completed';
    }

    // The round is over, so the checklist goes with it — the same thing `turn.end`
    // does on the wire. What it counted up to survives on the job log entry.
    this._emit({ type: 'step', id, step: null, plan: null }, t);
    return { t, failed: false };
  }

  /**
   * Announce a part, with a **snapshot** of the checklist as it stands.
   *
   * The copy is the whole point. Every emit here is deferred through a timer while the
   * loop above keeps ticking statuses off, so handing the live object over would have
   * each event arrive describing the end of the round: five parts, all complete, from
   * the very first one.
   */
  _emitStep(id, step, plan, delay) {
    const snapshot = { items: plan.items.map((e) => ({ ...e })), more: plan.more };
    this._emit({ type: 'step', id, step, plan: snapshot }, delay);
  }

  /** That's one off the list: a break, another request, or home. */
  _done(person) {
    if (!this._people.has(person.id)) return;
    person.remaining--;
    if (person.remaining <= 0) return this._clockOff(person);

    if (chance(P_BREAK)) {
      // Whether they have a drink or sit down is this feed's call; which station a
      // drink comes from is the agent's own preference (see agents/drinks.js).
      const activity = chance(0.66) ? 'drink' : 'couch';
      this._emit({ type: 'activity', id: person.id, activity }, 600);
      this._at(activity === 'couch' ? 9000 : 6000, () => this._free(person));
    } else {
      this._at(spread(1500, 2500), () => this._free(person));
    }
  }

  /** Back at their desk with nothing on: eligible for the next request. */
  _free(person) {
    if (this._people.has(person.id)) person.free = true;
  }
}
