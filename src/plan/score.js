// How good is this office, and by what measure?
//
// Two different questions live here, and keeping them apart is the whole point of
// this file existing separately from `validate()`.
//
// **`validate()` is the gate.** It is a hard pass/fail against the room's own
// rules — somewhere to do every job in `JOB_ROLES`, nothing overlapping, nothing
// off the floor, nobody stranded — and a plan that fails it is never shipped. It
// is what "every seed produces a room that works" means, and it is not a score:
// there is no partial credit for a mailbox nobody can reach.
//
// **This is the scorecard.** Six measures of whether a room that works is also a
// room worth working in, each 0 to 1, each named and each independently readable.
// It is deliberately *not* wired into acceptance, and that is a judgement worth
// stating rather than a gap:
//
//   * A generator that rejected rooms below a quality bar would silently narrow
//     what a seed can be. A spare two-desk back room with nothing green in it
//     scores badly on half of these and is a perfectly good office; the room the
//     scorecard likes best every time is a room with no character.
//   * A score used as a gate becomes a target, and the way to hit these targets
//     is to make every office the same shape.
//
// So what it is for is *measurement*: `npm run plan -- --sweep=2000` prints the
// distribution, `test/plan-score.test.js` holds the floor and the median down, and
// the gallery draws it under each plan. That turns "the layouts feel worse since
// that change" into a number somebody can point at — which is the only honest
// version of an eval when the thing being judged is a room.
//
// Every measure is read off the finished plan rather than off the brief, on the
// same terms as the name and the reason: what the office asked for is not
// evidence about what it got.

import { ROOM, DOOR } from '../config.js';
import { STATION_KINDS } from '../layout.js';
import { clamp01, ramp, band, mean, share } from '../measure.js';
import { daylight } from './floor.js';
import { reachable, reached } from './reach.js';

/** Distance between two things with an x and a z. */
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * How far it is to walk from a desk to the nearest station doing a job, as the
 * crow flies between standing spots.
 *
 * Straight-line rather than along a route, and that is a deliberate
 * simplification: this is a measure of *layout*, and a plan whose distances are
 * short but whose routes are long is a plan with a blocked aisle, which is
 * `validate()`'s business and not this file's.
 */
function walk(built, from, role) {
  let best = Infinity;
  for (const station of built.stations) {
    if (!(STATION_KINDS[station.kind]?.roles ?? []).includes(role)) continue;
    best = Math.min(best, gap(from, station));
  }
  return best;
}

/**
 * The six measures, and what each is for.
 *
 * The weights say what this project thinks matters, and they are as arguable as
 * any brief: seating the headcount and keeping the noise off the quiet end are
 * worth more than where the plants ended up. `weight` is the only opinion in the
 * file that is not a measurement.
 */
const MEASURES = [
  {
    key: 'seated',
    label: 'seated',
    weight: 3,
    note: 'desks the floor could seat, against the brief',
    of: (built) => (built.fit.asked ? built.desks.length / built.fit.asked : 1),
  },
  {
    key: 'daylight',
    label: 'daylight',
    weight: 2,
    note: 'how near the desks are to a window',
    // `daylight()` lives in src/plan/floor.js, with the window openings it is
    // measured to and the reasoning behind its shape, because the generator scores
    // desk placements on the same curve — deliberately, so the plan optimises the
    // number it is judged by rather than an approximation of it.
    of: (built) => mean(built.desks.map((desk) => daylight(desk)), 1),
  },
  {
    key: 'teams',
    label: 'teams',
    weight: 2,
    note: 'desks whose nearest neighbour is a teammate',
    // The plainest possible test of "teams sit together", and it needs no
    // parameter: if the desk nearest yours belongs to somebody else's team, you
    // are not sitting with your team. A one-team room scores 1 by definition,
    // which is correct — everybody is a teammate.
    of: (built) => share(built.desks, (desk) => {
      const rest = built.desks.filter((d) => d !== desk);
      if (!rest.length) return true;
      const near = rest.reduce((a, b) => (gap(desk, b) < gap(desk, a) ? b : a));
      return near.team === desk.team;
    }),
  },
  {
    key: 'quiet',
    label: 'quiet',
    weight: 2,
    note: 'the noisy machines kept off the working floor',
    // The printer and the drinks, scored on how far the nearest desk is from
    // them. Six units is about a third of the room's depth and is where the
    // separation stops being worth more.
    of: (built) => {
      const noisy = built.stations.filter((s) => ['printer', 'coffee', 'waterCooler'].includes(s.kind));
      if (!noisy.length || !built.desks.length) return 1;
      return mean(noisy.map((s) => {
        const nearest = Math.min(...built.desks.map((d) => gap(s, d)));
        return ramp(nearest, 2, 6);
      }), 1);
    },
  },
  {
    key: 'errands',
    label: 'errands',
    weight: 2,
    note: 'how far a desk is from the work coming in and going out',
    // The other side of `quiet`, and the reason both are here: a room can win the
    // first by putting everything in a far corner, and then every job is a hike.
    // Scored against the room's own scale — 8 units is a comfortable errand, 20
    // is most of the diagonal.
    of: (built) => {
      if (!built.desks.length) return 1;
      const trips = built.desks.flatMap((d) => ['intake', 'dispatch', 'research']
        .map((role) => walk(built, d, role))
        .filter((n) => Number.isFinite(n)));
      if (!trips.length) return 0;
      return mean(trips.map((d) => 1 - ramp(d, 8, 24)), 1);
    },
  },
  {
    key: 'floor',
    label: 'floor',
    weight: 1,
    note: 'how much of the floor is still floor',
    // A band, not a ramp, because both ends are wrong: a room that is 90% clear
    // is a barn, and one that is 40% clear is a warren. Measured as walkable
    // floor from the doorway, so furniture in a corner nobody can reach counts
    // against it twice, which is right.
    //
    // The bounds were 0.42 to 0.68 and moved up by 0.03 when the prop footprints
    // were measured rather than guessed. No room changed: the rectangles
    // used to overstate the props by a quarter, so the same floor now reads as more
    // of it. Median free floor over the tune seeds went 0.584 to 0.616, and the
    // band moved by what was measured rather than by what would have made the
    // guard pass — the alternative was a band that called two rooms in ten a barn
    // for the crime of having their furniture described accurately.
    of: (built) => {
      const props = built.floor.rects.filter((r) => r.role === 'prop');
      const seen = reachable(props, DOOR.inside);
      const cells = [];
      for (let z = 0.25; z < ROOM.D; z += 0.5) {
        for (let x = 0.25; x < ROOM.W; x += 0.5) cells.push({ x, z });
      }
      const free = cells.filter((c) => reached(seen, c.x, c.z)).length / cells.length;
      return band(free, 0.45, 0.71, 0.25);
    },
  },
];

const TOTAL_WEIGHT = MEASURES.reduce((n, m) => n + m.weight, 0);

/**
 * Score a built office.
 *
 * @param {object} built  from `furnish()`
 * @returns {{total: number, parts: {key: string, label: string, value: number,
 *   weight: number, note: string}[]}}
 */
export function score(built) {
  const parts = MEASURES.map((measure) => ({
    key: measure.key,
    label: measure.label,
    weight: measure.weight,
    note: measure.note,
    value: clamp01(measure.of(built)),
  }));
  const total = parts.reduce((n, p) => n + p.value * p.weight, 0) / TOTAL_WEIGHT;
  return { total: Math.round(total * 1000) / 1000, parts };
}

/** The measures, for anything that wants to name them without scoring a room. */
export const SCORE_KEYS = MEASURES.map((m) => m.key);
