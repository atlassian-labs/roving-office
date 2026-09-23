// Measures that have not earnt a weight yet.
//
// Every one of these is a hypothesis about *why the judge is wrong*, written down
// after looking at the rooms it got wrong rather than at the rooms it got right.
// They live here rather than in bin/lib/looks-judge.js so that
// bin/looks-explore.js can score them against every labelling round without any of
// them influencing the fitness the autoresearch loop optimises.
//
// A measure moves into the judge when its pooled agreement clears the noise floor,
// and when it moves it is **deleted from here**. Three of them (`balance`,
// `quarters`, `roomy`) were promoted after round two and left behind in this list
// for one run, which double-counted them in the cross-validation numerator and not
// in its denominator, and turned an honest +0.4 into an alarming −0.25. A measure
// in two places is a measure with two weights.
//
// After three rounds and 74 labelled rooms, `compact`, `areas` and `planted` have
// gone into the judge and these three are what is left. Each is kept for a
// different reason, and the reasons are worth more than the numbers.

import { ramp, band } from '../../src/measure.js';

/** How much of a grid of points over the room falls inside any of these rects. */
function coverGrid(rects, room, step = 0.5) {
  let inside = 0;
  let total = 0;
  for (let x = step / 2; x < room.w; x += step) {
    for (let z = step / 2; z < room.d; z += step) {
      total += 1;
      if (rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) inside += 1;
    }
  }
  return total ? inside / total : 0;
}

export const CANDIDATES = [
  {
    key: 'restraint',
    note: 'the rugs mark out part of the floor, not most of it',
    // **Kept because it is saturated, not because it is wrong.** The idea is
    // sound — a rug that covers everything delineates nothing, because
    // delineation is a contrast between the floor inside an area and the floor
    // outside it — and it pools at −0.070 over three rounds because almost no
    // room this generator makes gets anywhere near the top of the band. Its
    // median over 260 offices is 1.00. A measure cannot correlate with anything
    // while it is answering "yes" to every room, and that is a fact about the
    // generator rather than about the measure.
    of: ({ rugs, room }) => band(coverGrid(rugs, room), 0.06, 0.3, 0.28),
  },
  {
    key: 'aligned',
    note: 'the desks share their lines rather than each sitting at its own angle',
    // **Kept as the evidence for a conclusion nobody should act on yet.** It
    // pools at −0.161 over 74 rooms, just past the noise floor, and `organised`
    // in the judge pools at −0.190 saying a version of the same thing: the rooms
    // a person picked are consistently the *less* regimented ones. Both are
    // negative in the two largest rounds.
    //
    // Acting on it means paying the generator to break up its banks of desks,
    // which fights the `teams` floor — people who work together sit together —
    // and contradicts the first word of the stated rubric. Two measures agreeing
    // at −0.17 is not enough to spend that on, and it is exactly the sort of
    // finding an optimising loop would seize on if it were given a weight. So:
    // reported, weighted at nothing, and put in front of a person.
    of: ({ desks }) => {
      if (desks.length < 2) return 1;
      const shares = (vals) => {
        const on = vals.filter((v) => vals.filter((w) => Math.abs(v - w) < 0.6).length > 1);
        return on.length / vals.length;
      };
      return Math.max(shares(desks.map((d) => d.x)), shares(desks.map((d) => d.z)));
    },
  },
  {
    key: 'breathing',
    note: 'the seating is not jammed against the working desks',
    // **Kept as the cleanest example of a single round lying.** Round two put it
    // at +0.524, the strongest agreement any measure has ever scored here, on
    // sixteen rooms where the standard error is ±0.26. Round three, on forty,
    // said −0.089. Pooled over all three: +0.031, which is nothing.
    //
    // Promoted on round two's evidence it would have carried more weight than
    // anything else in the judge.
    of: ({ seating, desks }) => {
      if (!seating.length || !desks.length) return 1;
      const gap = Math.min(...seating.map(
        (s) => Math.min(...desks.map((d) => Math.hypot(s.x - d.x, s.z - d.z))),
      ));
      return ramp(gap, 2.5, 7);
    },
  },
];
