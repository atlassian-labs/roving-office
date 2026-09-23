// The admin console: one gated JSON response, drawn as hand-authored SVG.
//
// **No charting library, on purpose.** This project vendors its dependencies and keeps a
// licence inventory for the open-source release (`third-party/`), so a package would mean
// new licence evidence, new notices and a new inventory row — for a handful of bar
// charts. There is also no build step anywhere here: the app is served as plain files,
// and this page is too.
//
// Two rules run through the drawing, and both come from the same place: these numbers
// are going to be used to make decisions.
//
//   1. **A chart never implies data it does not have.** Nothing is interpolated and
//      nothing is smoothed, because a line between two bars asserts a value for the day
//      between them. Bars only, and a day the server recorded nothing for is drawn as an
//      explicit gap mark rather than as a zero — "nothing happened" and "we were not
//      running" are different facts and the chart must not merge them.
//   2. **Recorded history and a live photograph are never mixed in one panel.** The
//      per-day counters begin at `recording.since` and there is no way to backfill a day
//      before it; the census is the offices that exist right now and is not history at
//      all. Each panel says which it is.

const REPORT = document.getElementById('report');
const BODY = document.getElementById('report-body');
const GATE = document.getElementById('gate');
const GATE_FORM = document.getElementById('gate-form');
const GATE_ERROR = document.getElementById('gate-error');
const PASSWORD = document.getElementById('password');
const SIGN_OUT = document.getElementById('sign-out');
const GENERATED = document.getElementById('generated');

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The console's own path, which this file cannot know.
 *
 * It is the operator's, out of the environment, so the server substitutes it into
 * `console.html` and this reads it back off the body. A default would be a published
 * path, which is the whole reason the path is configured at all — so there is none, and a
 * page served without it is a bug rather than something to paper over with `/admin`.
 */
const BASE = document.body.dataset.adminBase ?? '';

/**
 * How each source bucket is labelled, and which of the theme's colours it wears.
 *
 * The labels match `src/data/sources.js`. The colours deliberately do **not**: that file
 * holds each harness's *brand* accent, for the mark on an agent's name tag, and a chart
 * is not the place for six vendors' brand colours competing. In particular Claude's own
 * terracotta would read as "the Claude bar" on a page that also draws a Claude bar.
 *
 * So these come from the shared theme (`assets/ui-theme.css`). A harness is a *category*
 * with no intrinsic meaning to borrow — unlike the job chart below, where the theme's
 * status colours say exactly what the bars are — so these are chosen for one property:
 * being told apart in a stack. Two of them do carry a meaning worth having, and it is
 * the same one both times: **Test Data wears the idle grey** because it is not real
 * usage, and **an unrecognised harness wears the sun yellow** because it is the one
 * series an operator should notice.
 *
 * They were picked by eye against a stacked bar, and a first attempt failed the only test
 * that matters: `--sage` and `--status-working` are both dark greens a few points apart,
 * and Test Data was indistinguishable from OpenClaw in the legend.
 */
const SOURCE_LABELS = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex',
  cursor: 'Cursor',
  'rovo-cli': 'Rovo CLI',
  openclaw: 'OpenClaw',
  other: 'Other harness',
  // Test Data under both of its names, because two vocabularies meet on this page and
  // only one of them is the wire's. The daily counters are keyed by `harness.name`, where
  // the simulated source is `mock` (spec §4.6); the census counts what a *scene is set
  // to*, which is the picker's id in `src/data/sources.js`, where the same thing is
  // `test-data`. One label for both, rather than a raw key appearing in one table.
  mock: 'Test Data',
  'test-data': 'Test Data',
};

const SOURCE_COLOURS = {
  'claude-code': 'var(--brand)',
  'codex-cli': 'var(--status-researching)',
  cursor: 'var(--status-waiting)',
  'rovo-cli': 'var(--leaf)',
  openclaw: 'var(--status-working)',
  mock: 'var(--status-idle)',
  other: 'var(--sun)',
};

// --- tiny element helpers --------------------------------------------------
//
// Everything is built as DOM nodes rather than assembled into an HTML string, which is
// not a style preference: some of what is drawn here is a *key* out of a stored blob — a
// furniture kind, a season, a building — and although each is length-capped and comes
// from an authored pool, a page that builds markup by concatenation is one schema change
// away from injecting whatever a PATCH put in that key. `textContent` cannot.

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, String(v));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, String(v));
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

// --- dates -----------------------------------------------------------------

/**
 * Every date from `from` to `to` inclusive, as `YYYY-MM-DD`.
 *
 * UTC throughout, matching `dayKey` in lib/stats-store.cjs, and said out loud in the
 * console: a reader in Sydney or California has a different midnight from the one these
 * buckets are cut on, and a day that looks half-empty is usually that.
 *
 * The calendar is built rather than taken from the recorded days because the gaps are
 * the point — a day with no bucket is a day to mark as having none, and a series that
 * simply omits it would draw a chart whose bars are not evenly spaced in time.
 */
function calendar(from, to) {
  const out = [];
  const day = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // A guard rather than trust: a clock skewed backwards, or a stats file from the
  // future, must not spin here.
  for (let i = 0; day <= end && i < 400; i += 1) {
    out.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

const todayUTC = () => new Date().toISOString().slice(0, 10);

/** `12 Sep 2026`, so a date in a caption is never ambiguous about its order. */
function longDate(ms) {
  if (!Number.isFinite(ms)) return 'never';
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** `12 Sep` for an axis, where the year is in the caption instead. */
function shortDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

const n = (value) => (Number.isFinite(value) ? value : 0).toLocaleString('en-GB');

/**
 * The top of the axis, chosen so that all four gridlines are whole numbers.
 *
 * Everything counted on this page is a count — offices, events, jobs — so a gridline
 * reading "6.25 offices" is not a rounding infelicity, it is a label for a quantity that
 * cannot exist. So the *step* is picked first from a short list of readable intervals and
 * the top is four of them, rather than picking a round top and dividing it by four (which
 * is what produced 6.25 from a peak of 21).
 *
 * `2.5` is deliberately not among the multipliers, for the same reason: it is a perfectly
 * nice step for a measurement and never one for a headcount. The floor of 1 keeps the
 * smallest possible axis at 0–4 rather than descending into tenths.
 */
function axisTop(peak) {
  const rough = Math.max(peak, 0) / 4;
  if (rough <= 1) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const m of [1, 2, 3, 4, 5, 6, 8, 10]) {
    const step = Math.round(magnitude * m);
    if (step >= rough) return step * 4;
  }
  return Math.round(magnitude * 10) * 4;
}

// --- the day chart ---------------------------------------------------------

/**
 * The plot box. `top` leaves a clear line for the y-axis caption above the highest
 * gridline — at 14 it sat on the same baseline as the topmost number and the two
 * overprinted each other.
 */
const CHART = {
  w: 760, h: 216, top: 26, right: 8, bottom: 30, left: 46,
};

/**
 * One bar per day, with a series either stacked or grouped side by side.
 *
 * @param {object} opts
 * @param {string[]} opts.dates      the calendar, including days with no bucket
 * @param {Map} opts.buckets         date → recorded counters, absent where none
 * @param {{key,label,color,of}[]} opts.series  `of(bucket)` is the number for that day
 * @param {boolean} [opts.stacked]   stack the series into one bar per day
 * @param {string} opts.unit         what one unit is, for the y-axis label
 */
function dayChart({ dates, buckets, series, stacked = false, unit }) {
  const { w, h, top, right, bottom, left } = CHART;
  const plotW = w - left - right;
  const plotH = h - top - bottom;

  const valuesFor = (date) => {
    const bucket = buckets.get(date);
    return bucket ? series.map((s) => Math.max(0, s.of(bucket) ?? 0)) : null;
  };

  const peak = dates.reduce((acc, date) => {
    const values = valuesFor(date);
    if (!values) return acc;
    return Math.max(acc, stacked ? values.reduce((a, b) => a + b, 0) : Math.max(...values));
  }, 0);
  const max = axisTop(peak);
  const y = (value) => top + plotH - (value / max) * plotH;

  const root = svg('svg', {
    viewBox: `0 0 ${w} ${h}`,
    role: 'img',
    'aria-label': `${unit} per day, ${shortDate(dates[0])} to ${shortDate(dates[dates.length - 1])}`,
  });

  // Y axis: four gridlines and the numbers on them. Always from zero — a bar chart
  // with a truncated baseline misreports every ratio on it.
  for (let i = 0; i <= 4; i += 1) {
    const value = (max / 4) * i;
    root.append(svg('line', {
      x1: left, x2: left + plotW, y1: y(value), y2: y(value), class: i === 0 ? 'axis' : 'zero',
    }));
    root.append(svg('text', {
      x: left - 6, y: y(value) + 3.5, 'text-anchor': 'end', class: 'tick', text: n(value),
    }));
  }
  root.append(svg('text', { x: 0, y: 9, text: unit, class: 'unit' }));

  // The bars. A slot per day whether or not it has a bucket, so the x axis is time
  // rather than a list of the days that happened to be busy.
  const slot = plotW / dates.length;
  const pad = Math.min(2, slot * 0.15);
  const barW = Math.max(1, slot - pad * 2);

  dates.forEach((date, i) => {
    const x0 = left + i * slot + pad;
    const values = valuesFor(date);

    if (!values) {
      // A day we recorded nothing for. Drawn as a small mark *below* the baseline so it
      // cannot be read as a bar of height zero — the distinction the legend explains.
      root.append(svg('rect', {
        x: x0, y: top + plotH + 2, width: barW, height: 2.5,
        fill: 'var(--border-strong)',
      }));
      return;
    }

    if (stacked) {
      let base = 0;
      values.forEach((value, s) => {
        if (value <= 0) return;
        root.append(svg('rect', {
          x: x0, width: barW, y: y(base + value), height: Math.max(0.6, y(base) - y(base + value)),
          fill: series[s].color,
        }, svg('title', { text: `${date} · ${series[s].label}: ${n(value)}` })));
        base += value;
      });
      return;
    }

    const sub = barW / series.length;
    values.forEach((value, s) => {
      if (value <= 0) return;
      root.append(svg('rect', {
        x: x0 + s * sub, width: Math.max(0.8, sub - 0.4),
        y: y(value), height: Math.max(0.6, top + plotH - y(value)),
        fill: series[s].color,
      }, svg('title', { text: `${date} · ${series[s].label}: ${n(value)}` })));
    });
  });

  // X axis: the ends always, and as many between as will fit without colliding.
  const every = Math.max(1, Math.ceil(dates.length / 8));
  dates.forEach((date, i) => {
    if (i !== 0 && i !== dates.length - 1 && i % every) return;
    root.append(svg('text', {
      x: left + i * slot + slot / 2,
      y: h - bottom + 16,
      'text-anchor': i === 0 ? 'start' : (i === dates.length - 1 ? 'end' : 'middle'),
      text: shortDate(date),
    }));
  });

  return root;
}

/**
 * A colour swatch, as a tiny SVG rather than a styled element.
 *
 * The console is served under a strict `Content-Security-Policy` with no
 * `'unsafe-inline'` in `style-src` (see `sendAdminFile` in server.cjs), and that blocks
 * `style` *attributes* as well as `<style>` blocks — so `background: …` set from script
 * silently does not apply, and the first version of this drew a row of invisible chips.
 * `fill` on an SVG rect is a presentation attribute, not a style, so it is unaffected.
 * Every dynamic colour and every dynamic length on this page goes through SVG for that
 * reason, which is cheap here because the charts are SVG anyway.
 */
function swatch(color, { thin = false } = {}) {
  const size = 11;
  // The gap entry is drawn as the short flat rule the chart actually puts below the
  // baseline, not as another coloured square. Two grey squares in one legend — a reaped
  // office and a day with no data — read as two series of the same kind, which is exactly
  // what they are not; matching the shape says "that mark" instead.
  const h = thin ? 3 : size;
  return svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' },
    svg('rect', { y: (size - h) / 2, width: size, height: h, rx: thin ? 1 : 2, fill: color }));
}

/** The colour key under a chart, plus the gap mark's own entry. */
function legend(series, { gaps = true } = {}) {
  const items = series.map((s) => el('span', {}, [swatch(s.color), s.label]));
  if (gaps) {
    items.push(el('span', { class: 'dim' }, [
      swatch('var(--border-strong)', { thin: true }), 'no events recorded that day',
    ]));
  }
  return el('div', { class: 'legend' }, items);
}

// --- ranked tables ---------------------------------------------------------

/**
 * A stored key, spelled as a person would read it.
 *
 * Prop kinds arrive from a layout blob in the spelling `src/layout.js` uses —
 * `postBox`, `coatStand`, `waterCooler` — which is right for the code and wrong on a
 * page somebody is reading. Only the display changes: the key itself is never rewritten,
 * so nothing downstream depends on this.
 */
function humanKey(key) {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A popularity table: the thing, its count, and a bar for the eye.
 *
 * Ranked rather than charted because these are categories with no order of their own and
 * a long tail — twenty furniture kinds on an x axis is a chart nobody can read the
 * labels on, where a table is exactly the shape of "in what order".
 */
function rankTable(counts, { thing, unit, label = humanKey, limit = 24 }) {
  const rows = Object.entries(counts || {})
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit);
  if (!rows.length) return el('p', { class: 'empty', text: 'Nothing recorded yet.' });

  const top = rows[0][1];
  const table = el('table', {}, [
    el('thead', {}, el('tr', {}, [
      el('th', { text: thing }),
      el('th', { class: 'n', text: unit }),
      el('th', { class: 'meter', text: '' }),
    ])),
  ]);
  const body = el('tbody');
  for (const [key, value] of rows) {
    body.append(el('tr', {}, [
      el('td', { text: label(key) }),
      el('td', { class: 'n', text: n(value) }),
      // An SVG rather than a styled element, because the CSP above rules out a `style`
      // attribute (see `swatch`). It scales to its cell: the width is a percentage of a
      // 100-unit viewBox with `preserveAspectRatio="none"`, and the cell's own width
      // comes from the stylesheet. A fixed pixel width was the first attempt and it
      // overflowed the narrow cards in the grid, painting bars outside their own panel.
      //
      // No `rx`, because unequal scaling would stretch a rounded corner into an ellipse.
      el('td', { class: 'meter' }, svg('svg', {
        viewBox: '0 0 100 7', preserveAspectRatio: 'none', height: 7, 'aria-hidden': 'true',
      }, [
        svg('rect', { width: 100, height: 7, fill: 'var(--surface-soft)' }),
        svg('rect', { width: Math.max(1.5, (value / top) * 100), height: 7, fill: 'var(--brand)' }),
      ])),
    ]));
  }
  table.append(body);
  return table;
}

/**
 * One of the few numbers that carries the page, at display size.
 *
 * Deliberately rationed. A grid of a dozen identical tiles is the house style of every
 * generated dashboard, and worse than generic: it asserts that every number on it matters
 * equally, when "offices minted" and "scenes with their own furniture" plainly do not. So
 * three of these, and `figures` below for the rest.
 */
const big = (value, label, detail = null) => el('div', { class: 'big' }, [
  el('div', { class: 'n', text: value }),
  el('div', { class: 'k' }, [el('b', { text: label }), detail ? ` ${detail}` : null]),
]);

/** The supporting numbers: exact, legible, and not competing for the eye. */
const figures = (pairs) => el('ul', { class: 'figures' }, pairs
  .filter(Boolean)
  .map(([value, label]) => el('li', {}, [el('b', { text: value }), ` ${label}`])));

const section = (title) => el('h2', { class: 'section', text: title });

const card = (title, children, caveat = null) => el('section', { class: 'card' }, [
  el('h3', { text: title }),
  ...[].concat(children),
  caveat ? el('p', { class: 'caveat', text: caveat }) : null,
]);

// --- the report ------------------------------------------------------------

function draw(report) {
  const { recording, days, census, now } = report;
  BODY.replaceChildren();

  const buckets = new Map(days.map((day) => [day.date, day]));
  const since = recording.since;
  const firstDate = since ? new Date(since).toISOString().slice(0, 10) : todayUTC();
  const dates = calendar(days[0]?.date ?? firstDate, todayUTC());

  const sum = (of) => days.reduce((acc, day) => acc + (of(day) ?? 0), 0);
  const jobsDelivered = sum((d) => d.jobs.turnsStarted) + sum((d) => d.jobs.queued);

  BODY.append(honesty(recording, census));

  // --- the three that matter, then the rest ---
  //
  // The heading has to survive a server that has counted nothing, which is every server
  // on its first day: `Recorded since ${longDate(null)}` read "Recorded since never".
  BODY.append(section(since
    ? `Recorded since ${longDate(since)}`
    : 'Recorded so far — nothing yet'));
  BODY.append(el('div', { class: 'headline' }, [
    big(n(sum((d) => d.offices.minted)), 'offices minted', 'since counting began'),
    big(n(jobsDelivered), 'jobs delivered', 'to a desk or a mailbox'),
    big(n(sum((d) => d.jobs.completed)), 'jobs done', 'finished and dispatched'),
  ]));
  BODY.append(figures([
    [n(sum((d) => d.offices.closed)), 'closed by their owner'],
    [n(sum((d) => d.offices.reaped)), 'reaped when idle'],
    [n(sum((d) => d.jobs.unfinished)), 'jobs not finished'],
    [n(sum((d) => d.jobs.claimed)), 'mailbox jobs claimed'],
    [n(sum((d) => d.jobs.dropped)), 'dropped'],
    [n(sum((d) => d.demoEvents)), 'demo-office events, counted apart'],
  ]));

  // --- what is true right now ---
  BODY.append(section('The offices that exist right now'));
  BODY.append(el('div', { class: 'headline' }, [
    big(n(census.offices), 'offices open', `of ${n(now.maxOffices)} this server will hold`),
    big(n(census.writeTokens), 'live write tokens', 'capabilities, not people'),
    big(n(census.watchedNow), 'being watched', 'somebody is in the room'),
  ]));
  BODY.append(figures([
    [n(census.scenes), 'scenes in them'],
    [n(census.withPasscode), 'offices with a passcode'],
    [n(census.arranged), 'scenes rearranged by hand'],
    [n(census.unlooked), 'scenes never opened'],
    [n(census.located), 'scenes given a place on earth'],
  ]));

  BODY.append(section('Day by day'));

  // --- offices created vs closed ---
  // Brand blue for the office being made, the theme's "done" green for a deliberate
  // close, and its idle grey for one nobody came back to — the same three meanings the
  // room itself uses for starting, finishing and standing still.
  const lifecycle = [
    { key: 'minted', label: 'Minted', color: 'var(--brand)', of: (d) => d.offices.minted },
    { key: 'closed', label: 'Closed by their owner', color: 'var(--job-done)', of: (d) => d.offices.closed },
    { key: 'reaped', label: 'Reaped after going idle', color: 'var(--status-idle)', of: (d) => d.offices.reaped },
  ];
  BODY.append(card('Offices created, closed and reaped', [
    el('p', { class: 'why', text: 'One bar group per day. Closing is somebody deliberately revoking an office; reaping is the idle deadline taking one nobody came back to.' }),
    dayChart({ dates, buckets, series: lifecycle, unit: 'offices' }),
    legend(lifecycle),
  ], `A reap noticed at start-up is dated to the day the server came back, not the night the office actually expired — that is the only date this code can honestly claim to know. The demo office is exempt from the reaper and from all three counts. Days are UTC. The idle deadline is currently ${Math.round(now.idleTtlMs / 60000)} minutes.`));

  // --- connections by source ---
  const sourceSeries = recording.sourceKeys.map((key) => ({
    key,
    label: SOURCE_LABELS[key] ?? key,
    color: SOURCE_COLOURS[key] ?? 'var(--status-idle)',
    of: (d) => d.sources[key]?.offices ?? 0,
  }));
  BODY.append(card('Successful connections per day, by type', [
    el('p', { class: 'why', text: 'A connection counts for the day when at least one event from that harness arrived and was accepted — data flowed. Counted as distinct offices fed, not events, so a busy afternoon in one room is one connection.' }),
    dayChart({ dates, buckets, series: sourceSeries, stacked: true, unit: 'offices fed' }),
    legend(sourceSeries),
  ], 'Distinct offices are deduplicated in memory for the current day only, so a restart re-counts: an office fed both before and after a redeploy counts twice that day. That is deliberate — the alternative is writing down which office used which harness, which is the one record this design refuses to keep. Test Data is simulated in the browser and posts nothing to the server, so it is nearly always zero here. The demo office is excluded.'));

  const volume = [{ key: 'events', label: 'Events accepted', color: 'var(--brand)', of: (d) => recording.sourceKeys.reduce((acc, key) => acc + (d.sources[key]?.events ?? 0), 0) }];
  BODY.append(card('Event volume per day', [
    el('p', { class: 'why', text: 'How much traffic arrived, as opposed to how many offices it came from. Kept apart from the chart above because a single busy session can dominate it.' }),
    dayChart({ dates, buckets, series: volume, unit: 'events' }),
    legend(volume),
  ], `Demo-office traffic is counted separately and is not in this chart: ${n(sum((d) => d.demoEvents))} events since recording began.`));

  // --- jobs ---
  // The office's own colours for the states these are: `--status-walking` for work being
  // carried to a desk, the delivering purple for the mailbox, `--job-done` green for
  // finished, and the error red for a turn that did not finish. A reader who knows the
  // room already knows this key.
  const jobs = [
    { key: 'turns', label: 'Delivered to a desk (turn.start)', color: 'var(--status-walking)', of: (d) => d.jobs.turnsStarted },
    { key: 'queued', label: 'Delivered to the mailbox (job.queued)', color: 'var(--status-delivering)', of: (d) => d.jobs.queued },
    { key: 'done', label: 'Done (turn.end, completed)', color: 'var(--job-done)', of: (d) => d.jobs.completed },
    { key: 'unfinished', label: 'Not finished (error, cancelled, blocked)', color: 'var(--status-error)', of: (d) => d.jobs.unfinished },
  ];
  BODY.append(card('Jobs delivered and done', [
    el('p', { class: 'why', text: 'AOP has no event called “job done”, so this is the office’s own vocabulary: work is delivered when a paper aeroplane arrives (a turn opening, or a job landing in the mailbox) and done when it leaves through the outbox — a turn ending as completed.' }),
    dayChart({ dates, buckets, series: jobs, unit: 'jobs' }),
    legend(jobs),
    el('p', { class: 'why', text: `Mailbox jobs claimed: ${n(sum((d) => d.jobs.claimed))} · dropped: ${n(sum((d) => d.jobs.dropped))}` }),
  ], 'Non-test only: the demo office is excluded, and a rename of work in flight (turn.title) is deliberately not counted as a second delivery. Very few harnesses emit job.* at all, so the mailbox bars are expected to be near zero even on a busy server.'));

  // --- settings and furniture ---
  BODY.append(section('What people chose'));
  BODY.append(el('div', { class: 'grid' }, [
    card('Most popular sources chosen', rankTable(census.sources, {
      thing: 'Source', unit: 'scenes', label: (key) => SOURCE_LABELS[key] ?? key,
    }), 'What scenes are *set to*, which is a setting rather than a connection — a scene can name Claude Code and never have been fed by it. A photograph of the scenes that exist now.'),
    card('Most popular seasons', rankTable(census.seasons, { thing: 'Season', unit: 'scenes' }),
      'From the offices that exist now. The per-day record of look choices below is the going-forward version of the same question.'),
    card('Most popular buildings', rankTable(census.buildings, { thing: 'Building', unit: 'scenes' }),
      `Of the scenes that exist now, ${n(census.unlooked)} have never been opened and so have no look at all; ${n(census.located)} have been given a place on earth for the sun.`),
    card('Scenes per office', rankTable(census.scenesPerOffice, { thing: 'Scenes', unit: 'offices' }),
      'How many rooms people actually keep in one office.'),
  ]));

  BODY.append(card('Furniture, in order of use', [
    el('p', { class: 'why', text: 'Every prop in every saved layout, counted by kind and ranked. Only scenes somebody has rearranged have a layout of their own — the rest wear the authored room, which is not counted here because nobody chose it.' }),
    rankTable(census.furniture, { thing: 'Prop', unit: 'placed', limit: 40 }),
  ], `From the ${n(census.arranged)} arranged scenes that exist right now, not from history: a reaped office took its furniture with it. Positions and colours are never read — only which kinds are present.`));

  const lookSeasons = {};
  const lookBuildings = {};
  for (const day of days) {
    for (const [key, value] of Object.entries(day.looks.seasons)) lookSeasons[key] = (lookSeasons[key] ?? 0) + value;
    for (const [key, value] of Object.entries(day.looks.buildings)) lookBuildings[key] = (lookBuildings[key] ?? 0) + value;
  }
  BODY.append(el('div', { class: 'grid' }, [
    card('Seasons chosen, as they were chosen', rankTable(lookSeasons, { thing: 'Season', unit: 'times set' }),
      'Recorded each time a look is saved, so this one does survive an office being reaped — unlike the census above. It counts settings events, so a room whose look is re-rolled ten times counts ten times.'),
    card('Buildings chosen, as they were chosen', rankTable(lookBuildings, { thing: 'Building', unit: 'times set' }),
      'Same caveat: a count of choices made, not of offices wearing them.'),
  ]));

  BODY.append(card('Ways in switched on', rankTable(census.channels, { thing: 'Channel', unit: 'scenes' }),
    'Across arranged scenes that exist now.'));

  GENERATED.textContent = `${n(census.offices)} offices · ${days.length} day${days.length === 1 ? '' : 's'} recorded · read ${new Date(report.generatedAt).toLocaleTimeString('en-GB')}`;
}

/**
 * The panel that says what these numbers cannot tell you.
 *
 * First on the page and not tucked at the bottom, because it is the most important thing
 * on it. Every per-day chart here starts at `recording.since` and there is no history
 * before that date to find: nothing in this project ever wrote one down. An empty chart
 * labelled honestly is an answer; an empty chart that looks complete is not.
 */
function honesty(recording, census) {
  const since = recording.since;
  const list = el('ul');
  const add = (text) => list.append(el('li', { text }));

  add(since
    ? `Per-day counting began on ${longDate(since)}. Every day before that is blank and unrecoverable — until that date this server kept no history of any kind, only a registry of the offices that existed at that moment.`
    : 'Nothing has been counted yet. The first office, event or look will start the record.');
  add(`Daily counters are kept for ${recording.retainDays} days and then dropped.`);
  add('“How many people” cannot be answered. There are no accounts and nothing is fingerprinted, so the nearest honest proxies are offices minted and live write tokens — both count capabilities, not people, and one person may hold many of each.');
  add('Settings and furniture come from the offices that exist right now, not from history: an office that was closed or reaped took its look and its layout with it, and there is no record it ever had them.');
  add('Nothing here is per-office and nothing is content. No keycards, prompts, titles, file paths, agent names, tokens or addresses are recorded anywhere in this data.');

  return el('aside', { class: 'smallprint' }, [
    el('h2', { text: 'What these numbers are, and are not' }),
    list,
    el('p', {
      class: 'foot',
      text: `Days are cut at UTC midnight, so a reader elsewhere has a different midnight from these buckets. Currently holding ${n(census.offices)} offices.`,
    }),
  ]);
}

// --- the gate --------------------------------------------------------------

/**
 * Put a line under the password field. `bad` is a refusal; anything else is just news.
 *
 * One helper rather than assignments scattered about, so the class cannot be left set
 * from a previous message: a stale `bad` would show "Signed out." in the colour of a
 * rejected password, which is how the first version of this read.
 */
function hint(message, bad = false) {
  GATE_ERROR.textContent = message;
  GATE_ERROR.classList.toggle('bad', Boolean(message) && bad);
}

function showGate(message = '', bad = false) {
  REPORT.hidden = true;
  GATE.hidden = false;
  SIGN_OUT.hidden = true;
  GENERATED.textContent = '';
  hint(message, bad);
  PASSWORD.focus();
}

function showReport(report) {
  GATE.hidden = true;
  REPORT.hidden = false;
  SIGN_OUT.hidden = false;
  PASSWORD.value = '';
  hint('');
  draw(report);
}

/** Ask for the numbers. A 401 is the ordinary answer before signing in, not an error. */
async function load() {
  let res;
  try {
    res = await fetch(`${BASE}/api/stats`, { headers: { accept: 'application/json' } });
  } catch {
    showGate('Could not reach the server.', true);
    return;
  }
  if (res.status === 401) return showGate();
  if (!res.ok) return showGate('The server refused that request.', true);
  return showReport(await res.json());
}

GATE_FORM.addEventListener('submit', async (event) => {
  event.preventDefault();
  hint('');
  const password = PASSWORD.value;
  if (!password) return;
  let res;
  try {
    res = await fetch(`${BASE}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    hint('Could not reach the server.', true);
    return;
  }
  const body = await res.json().catch(() => ({}));
  // The server's own sentence, whatever it is: a wrong password and a rate-limited one
  // are different situations and only it knows how long the wait is.
  if (!res.ok) {
    hint(body.error ?? 'That did not work.', true);
    PASSWORD.select();
    return;
  }
  showReport(body);
});

SIGN_OUT.addEventListener('click', async () => {
  await fetch(`${BASE}/api/session`, { method: 'DELETE' }).catch(() => {});
  showGate('Signed out.');
});

load();
