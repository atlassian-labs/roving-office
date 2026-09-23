// How nice does this room *look*, judged from a layout alone.
//
// The one goal of the five that no measurement reaches on its own, so it is
// reached the way subjective quality always is: ask somebody which rooms they
// prefer, write down why, turn the why into measures, and then check the measures
// against the ranking they gave.
//
// The rubric is theirs, quoted as given: *"organisation, a clear area (with rugs
// often!) to sit in with couches and armchairs all pointing inward, delineated
// areas, easy access to coffee / research. Rugs and plants for visual interest."*
//
// **It takes a layout blob, not a `built` office, and that is the whole design.**
// The first version read the generator's own output, which meant every label
// expired the moment the generator changed: a label is attached to a *room*, and
// a seed's room is whatever the current code says it is. Correlating judgements of
// yesterday's rooms against today's scores took an agreement of +0.40 and turned
// it into +0.01 — not because the measures got worse but because the rooms had
// been swapped out underneath them. Judging a blob means the eighteen labelled
// rooms are the eighteen labelled rooms for ever, and any future generator can be
// checked against the same held-out taste.

import { applyLayout, resetLayout, DESKS, FURNITURE, DECOR, STATIONS, STATION_KINDS } from '../../src/layout.js';
import { ROOM } from '../../src/config.js';
// Arithmetic only, so it does not compromise the independence above: `ramp` and
// `band` know nothing about a room. The generator's own scorecard is built out of
// the same handful, which is what makes the two sets of numbers comparable.
import { clamp01, ramp, band, mean, share } from '../../src/measure.js';
import { survey } from '../../src/plan/survey.js';

const SEATING = ['couch', 'armchair'];

/** The union area of a set of rectangles, by scanning x and adding up z. */
function unionArea(rects, step = 0.25) {
  if (!rects.length) return 0;
  const x0 = Math.min(...rects.map((r) => r.x0));
  const x1 = Math.max(...rects.map((r) => r.x1));
  let area = 0;
  for (let x = x0; x < x1; x += step) {
    const spans = rects.filter((r) => r.x0 <= x && r.x1 > x)
      .map((r) => [r.z0, r.z1]).sort((a, b) => a[0] - b[0]);
    let end = -Infinity;
    for (const [a, b] of spans) {
      if (b <= end) continue;
      area += (b - Math.max(a, end)) * step;
      end = b;
    }
  }
  return area;
}

/**
 * Single-linkage grouping: two things land in the same group when `joins` says
 * so, and a thing that joins any member joins the group.
 *
 * The rubric asks two questions of the shape of a set — which rugs form one area,
 * and which desks form one bank — and they are the same question over different
 * neighbourhoods, so only the neighbourhood is stated twice.
 */
function linked(list, joins) {
  const left = [...list];
  const out = [];
  while (left.length) {
    const group = [left.pop()];
    for (let grew = true; grew;) {
      grew = false;
      for (let i = left.length - 1; i >= 0; i -= 1) {
        if (!group.some((g) => joins(g, left[i]))) continue;
        group.push(left.splice(i, 1)[0]);
        grew = true;
      }
    }
    out.push(group);
  }
  return out;
}

/**
 * Rectangles grouped into the areas they form, joined where they overlap.
 *
 * Two rugs that overlap are one area — that is the whole point of letting them
 * overlap — and two rugs at opposite ends of the room are two areas however tidy
 * each one is. Every question about the *shape* of a rug area has to be asked of an
 * area rather than of the room.
 */
function connected(rects, slack = 0.3) {
  return linked(rects, (a, b) => a.x0 < b.x1 + slack && a.x1 > b.x0 - slack
    && a.z0 < b.z1 + slack && a.z1 > b.z0 - slack);
}

function centroid(list) {
  if (!list.length) return null;
  return {
    x: list.reduce((n, p) => n + p.x, 0) / list.length,
    z: list.reduce((n, p) => n + p.z, 0) / list.length,
  };
}

/** Single-linkage clusters, joined when two things are within `reach`. */
function clusters(list, reach) {
  return linked(list, (a, b) => Math.hypot(a.x - b.x, a.z - b.z) <= reach);
}

/**
 * The measures, each one a line of the rubric.
 *
 * **The weights are no longer guesses.** Each one is ten times that measure's
 * pooled rank agreement with two rounds of human labelling, rounded — the rule in
 * `weightsFor` (bin/lib/looks-fit.js), applied to the pooled column of
 * `bin/looks-explore.js`. A measure that agrees twice as well gets twice the say
 * and a measure that agrees not at all gets none, which is the only defensible
 * thing to do with ten measures and 34 labelled rooms.
 *
 * **A weight of zero means measured but not voting.** `organised` pools at −0.002
 * and `amenity` at +0.020 — between them they used to carry half the judge's
 * weight. They are kept and reported because knowing that a measure measures
 * nothing is worth something, and because the next round may say why.
 *
 * And the number to keep in view: **cross-validated, this judge agrees at +0.18,
 * not the +0.41 it scores on the rooms it was fitted to.** Leave one room out,
 * refit the weights on the other 33, score the room the weights never saw, and
 * that is what comes back. +0.18 is real and it is weak, and it is why `looks` is
 * still only a quarter of the fitness (bin/office-fitness.js). The bottleneck is
 * the number of *rooms* labelled, not the number of pairs: a rank correlation over
 * n rooms has a standard error of 1/sqrt(n−1), so 34 rooms is ±0.17 however many
 * comparisons are made between them. Eighteen rooms and twenty-nine pairs is enough to say that a measure
 * agrees with somebody or does not; it is nowhere near enough to weigh six of
 * them against each other, and pretending otherwise would be fitting a judge to
 * three games per room.
 */
export const LOOKS = [
  {
    key: 'zoned',
    weight: 1,
    note: 'each group of furniture stands on a rug that marks it out as an area',
    of: ({ desks, seating, rugs }) => {
      const groups = [...clusters(desks, 7), seating].filter((g) => g.length);
      if (!groups.length) return 1;
      return share(groups, (g) => {
        const mid = centroid(g);
        return mid && rugs.some((r) => mid.x > r.x0 && mid.x < r.x1 && mid.z > r.z0 && mid.z < r.z1);
      });
    },
  },
  {
    key: 'covered',
    weight: 2,
    note: 'how much of each group stands on a rug, counting overlapped rugs as one area',
    // **Promoted after round two, and it is now the heaviest measure here**:
    // pooled over both rounds' 34 rooms it agrees +0.30, the strongest signal in
    // the whole dataset (`bin/looks-explore.js`). The note below is what it was
    // written with and why it had to wait. `zoned` above asks whether a
    // group's *middle* lands on a rug, which turns out to be a measure of almost
    // nothing: a rug at the middle of a bank satisfies it whether it covers two
    // desks of eight or all eight. Rewriting the generator so rugs overlap into one
    // larger area — *"4 can be overlapped slightly to make a single large area to
    // define"* — took the desks actually standing on a rug from 25% to 63% and
    // `zoned` did not move by a thousandth.
    //
    // So this is the measure that ought to replace it. It cannot be promoted on the
    // evidence available, because **the eighteen labelled rooms predate the
    // capability**: not one of them has two rugs that touch, so coverage barely
    // varies across the set and asking the labels to choose between the two forms
    // is asking them about rooms they never saw. On the frozen set the centroid form
    // agrees +0.33 and this one +0.28, which at 3.2 games a room is a difference
    // between two coin flips.
    //
    // The next labelling round includes rooms with joined-up rugs. Whichever form
    // agrees with *those* takes the weight.
    //
    // Overlapping rugs are treated as one surface, which is the whole point of
    // overlapping them: a desk on the join is on the area, and which of the two
    // rugs it is on is the wrong question.
    of: ({ desks, seating, rugs }) => {
      const members = [...clusters(desks, 7), seating].filter((g) => g.length).flat();
      if (!members.length) return 1;
      return share(members, (p) => rugs.some(
        (r) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1,
      ));
    },
  },
  {
    key: 'divided',
    weight: 0,
    note: 'something stands between the areas rather than them running together',
    // *"Plants and other items can also be used to make logical dividers in the
    // room among groups of desks, sitting furniture or a break area."* The rubric's
    // "delineated areas" has two halves and the rug is only one of them: a rug says
    // where an area starts, a divider says where the next one begins.
    //
    // **Also measured and not voting**, and here the reason is sharper. Dividers
    // were *impossible* in the generator that produced the labelled rooms — a plant
    // more than four units from a wall was refused outright — so every room in the
    // set scores on this by accident, when a side table or a station happens to
    // fall on the line between two banks. It agrees −0.17 with the ranking, which
    // is a fact about accidental furniture and says nothing about a divider that
    // was put there on purpose.
    //
    // Scored per *pair* of areas far enough apart to be two areas, because that is
    // the only place a divider can exist. A room with one bank of desks has nothing
    // to divide and is not marked down for it.
    of: ({ desks, seating, props }) => {
      const areas = [...clusters(desks, 7), seating].filter((g) => g.length).map(centroid);
      const pairs = [];
      for (let i = 0; i < areas.length; i += 1) {
        for (let j = i + 1; j < areas.length; j += 1) {
          if (Math.hypot(areas[i].x - areas[j].x, areas[i].z - areas[j].z) >= 6) {
            pairs.push([areas[i], areas[j]]);
          }
        }
      }
      if (!pairs.length) return 1;
      // Between, by the triangle inequality: a prop on the line between two areas
      // adds nothing to the distance from one to the other, and a prop off to the
      // side adds a lot.
      return share(pairs, ([a, b]) => {
        const span = Math.hypot(a.x - b.x, a.z - b.z);
        return props.some((p) => {
          const via = Math.hypot(p.x - a.x, p.z - a.z) + Math.hypot(p.x - b.x, p.z - b.z);
          return via - span < 1.5;
        });
      });
    },
  },
  {
    key: 'organised',
    weight: 0,
    note: 'the desks read as one or two banks rather than islands dotted about',
    // **Demoted to nothing on the evidence, from a weight of 2.** It pools at
    // −0.002 over 34 rooms: not weak, *nothing* — a measure that has no
    // relationship at all with which rooms a person prefers, and it was carrying a
    // quarter of the judge's weight on the strength of one word in the rubric.
    // "Organisation" was the first thing they said and this is not what they
    // meant. Kept and reported so the next round can say what they did mean.
    // "Organisation" was the first word of the rubric, and the pair that showed
    // what it meant was a 2×2 pod on a rug against five desks scattered over three
    // separate islands with empty floor between them. Clusters per desk: one
    // cluster of six is organised, six clusters of one is not.
    of: ({ desks }) => {
      if (desks.length < 2) return 1;
      const groups = clusters(desks, 7).length;
      return band(groups / desks.length, 0, 0.34, 0.4);
    },
  },
  {
    key: 'together',
    weight: 3,
    note: 'the seating reads as one place to sit, facing itself',
    // The half of the rubric that has *not* validated: "couches and armchairs all
    // pointing inward" scored −0.07 against the ranking, and the room they liked
    // best scores 0.58 on it. Kept, at a low weight, and flagged: either the
    // measure is wrong or the words were describing something else in the picture.
    // Another labelling round decides which, and until then it should not be
    // allowed to outvote the two measures that do agree.
    //
    // Since then the inward half has become an **invariant of the generator** —
    // "always face each other, or face at 90 degrees to each other, never away
    // from each other", enforced as a refusal in furnish.js and asserted in
    // test/plan-generator.test.js. So on any freshly generated room that term is
    // 1 by construction and this measure is now really reporting the `spread`
    // half: whether the seats are close enough together to be one place to sit.
    // Which is worth knowing and is not what it says on the tin. It stays as it
    // is until there are labels to re-fit it against, because guessing at a
    // weight is how the first version of this file got to +0.11.
    of: ({ seating }) => {
      if (!seating.length) return 0.35;
      if (seating.length === 1) return 0.6;
      const mid = centroid(seating);
      const spread = mean(seating.map((s) => Math.hypot(s.x - mid.x, s.z - mid.z)));
      const inward = mean(seating.map((s) => {
        const to = { x: mid.x - s.x, z: mid.z - s.z };
        const len = Math.hypot(to.x, to.z);
        if (len < 0.5) return 1;
        const look = { x: Math.sin(s.facing ?? 0), z: Math.cos(s.facing ?? 0) };
        return Math.max(0, (look.x * to.x + look.z * to.z) / len);
      }));
      return 0.5 * band(spread, 0, 3.2, 4) + 0.5 * inward;
    },
  },
  {
    key: 'interest',
    weight: 3,
    note: 'something green, and something on the floor to look at',
    of: ({ plants, rugs }) => {
      const spread = plants.length > 1
        ? band(mean(plants.map((p) => {
          const mid = centroid(plants);
          return Math.hypot(p.x - mid.x, p.z - mid.z);
        })), 4, 12, 6)
        : 0.5;
      return 0.45 * ramp(plants.length, 0, 4) + 0.3 * ramp(rugs.length, 0, 2) + 0.25 * spread;
    },
  },
  {
    key: 'amenity',
    weight: 0,
    note: 'the coffee and the shelf are an easy walk from a desk',
    // **Also demoted from 2 to nothing**, and this one is a lesson about where a
    // measure belongs rather than about taste. It pools at +0.02. "Easy access to
    // coffee / research" is a real requirement and it is genuinely part of what
    // makes the room good — but it is not visible in an overhead render, so asking
    // somebody which picture they prefer cannot possibly measure it. It is already
    // measured properly by the simulator, in seconds, as the `drink` and `lookup`
    // errands. Two votes here were two votes for a thing the labels know nothing
    // about.
    // "Easy access to coffee / research" — and the coffee half of that was
    // measured *nowhere*: the scorecard's `errands` covers intake, dispatch and
    // research, and a drink is not one of them.
    of: ({ desks, stations }) => {
      if (!desks.length) return 1;
      const reach = (role) => {
        const kinds = stations.filter((s) => (STATION_KINDS[s.kind]?.roles ?? []).includes(role));
        if (!kinds.length) return null;
        return mean(desks.map((d) => Math.min(...kinds.map((s) => Math.hypot(d.x - s.x, d.z - s.z)))));
      };
      const both = ['refresh', 'research'].map(reach).filter((v) => v != null);
      if (!both.length) return 0.5;
      return mean(both.map((d) => 1 - ramp(d, 6, 20)));
    },
  },
  {
    key: 'balance',
    weight: 1,
    note: 'the room is furnished all over rather than crammed into one end',
    // The three measures below came out of the rooms the judge got *wrong* in
    // round two, and all three say a version of the same thing: nothing in the
    // rubric was about the floor as a whole, so nothing measured it. `look-147`
    // was the judge's third-best room and the person's second-worst — its whole
    // population of furniture is in the left two thirds and the right third is
    // bare boards with a bin on it.
    //
    // Pooled +0.21 over 34 rooms, and consistent in sign across both rounds,
    // which is more than four of the original measures managed.
    of: ({ footprints, room }) => {
      if (!footprints.length) return 0;
      const mid = {
        x: mean(footprints.map((r) => (r.x0 + r.x1) / 2)),
        z: mean(footprints.map((r) => (r.z0 + r.z1) / 2)),
      };
      return 1 - ramp(Math.hypot(mid.x - room.w / 2, mid.z - room.d / 2), 1.5, 7);
    },
  },
  {
    key: 'quarters',
    weight: 0,
    note: 'no quarter of the room is left empty',
    // `balance` on its own is blind to furniture spread evenly along one wall,
    // which has its centre of mass in the middle of the room and three empty
    // quarters. Pooled +0.22.
    of: ({ footprints, room }) => {
      if (!footprints.length) return 0;
      const counts = [0, 0, 0, 0];
      for (const r of footprints) {
        const x = (r.x0 + r.x1) / 2 > room.w / 2 ? 1 : 0;
        const z = (r.z0 + r.z1) / 2 > room.d / 2 ? 2 : 0;
        counts[x + z] += 1;
      }
      return ramp(Math.min(...counts) / (footprints.length / 4), 0, 0.7);
    },
  },
  {
    key: 'roomy',
    weight: 1,
    note: 'the floor is neither bare nor packed',
    // Pooled +0.18. The band is where the labelled rooms people liked sit, not a
    // number from a standard: a sixth of the floor under furniture is a sparse
    // room and a third is a full one, and both ends of that are liked better than
    // either extreme outside it.
    of: ({ footprints, room }) => band(
      footprints.reduce((n, r) => n + (r.x1 - r.x0) * (r.z1 - r.z0), 0) / (room.w * room.d),
      0.16, 0.34, 0.16,
    ),
  },
  {
    key: 'compact',
    weight: 1,
    note: 'each rug area reads as a rectangle rather than a staircase of offcuts',
    // **The measure that was wrong, and the reason it is worth saying so.**
    //
    // The first version divided the union area of the rugs by the bounding box of
    // *all of them*, and pooled at −0.207: the strongest negative signal in the
    // labelled data, which read as "ragged rug areas are preferred". Asked
    // directly, the person whose taste this models said the opposite —
    // "rectangular rugs (or combined multiple rugs as a rectangle to indicate an
    // area) are definitely better than ragged ones" — and they are right and the
    // measure was broken.
    //
    // A room with a tidy rectangle under the lounge and another tidy rectangle
    // under the desks has a bounding box spanning the whole floor, so the ratio
    // was tiny. It scored two well-formed areas as the ragged case, and scored a
    // single rug as perfect by an early return. It was measuring "all the rugs are
    // in one blob", which is not a thing anybody wants.
    //
    // So: rugs are grouped into the areas they actually form — connected by
    // overlap — and each area is measured against *its own* bounding box, then
    // averaged by size. Two rectangles score 1. One L scores about 0.75. A
    // staircase of five offcuts scores about 0.5.
    of: ({ rugs }) => {
      if (rugs.length < 2) return 1;
      const areas = connected(rugs);
      const parts = areas.map((group) => {
        const box = (Math.max(...group.map((r) => r.x1)) - Math.min(...group.map((r) => r.x0)))
          * (Math.max(...group.map((r) => r.z1)) - Math.min(...group.map((r) => r.z0)));
        return { fill: box > 0 ? unionArea(group) / box : 1, box };
      });
      const weight = parts.reduce((n, p) => n + p.box, 0);
      return weight ? parts.reduce((n, p) => n + p.fill * p.box, 0) / weight : 1;
    },
  },
  {
    key: 'areas',
    weight: 1,
    note: 'the rugs form a small number of definite areas, not one carpet or six offcuts',
    // The other half of the same question. `compact` says each area is a good
    // shape; this says there is a sensible number of them. One area is a room with
    // one place in it and five is confetti.
    of: ({ rugs }) => (rugs.length ? band(connected(rugs).length, 1, 3, 2) : 0.4),
  },
  {
    key: 'planted',
    weight: 0,
    // Excluded from the weighting rule altogether rather than merely weighted at
    // zero, because the reason is structural and known in advance: this reads a
    // variable `interest` already reads. Declaring it lets the cross-validation
    // measure the procedure actually in use.
    collinear: 'interest',
    note: 'more than a token amount of greenery',
    // **Where the weighting rule shows its one real weakness.** Pooled +0.171 over
    // three rounds and positive in all three, which only two other measures manage
    // — so the rule gives it 1.7, and adding it at 2 took the judge from +0.374 to
    // +0.324 and the cross-validated figure from +0.292 to +0.263.
    //
    // `weightsFor` scores each measure on its own and is blind to two measures
    // measuring the same thing. `planted` is the plant count, and `interest`
    // already reads the plant count; the second vote for greenery is not new
    // evidence, it is the same evidence counted twice, and it crowds out `together`
    // and `covered`.
    //
    // Dropping it because it scores better would be the hand-tuning this file
    // exists to avoid. Dropping it because it is collinear with a measure already
    // in the judge is model selection, and the cross-validation — which is the
    // only arbiter here that cannot be argued with — says the same thing.
    of: ({ plants }) => ramp(plants.length, 1, 6),
  },
];

const TOTAL = LOOKS.reduce((n, m) => n + m.weight, 0);

/**
 * The geometry every measure reads, from a layout blob.
 *
 * Applies the layout to the room and surveys it, so the numbers come off the same
 * geometry the nav grid and the plan drawings use rather than off a second reading
 * of the blob. Exported because bin/looks-explore.js scores *candidate* measures
 * against the same rooms, and a candidate compared on differently-derived geometry
 * is not compared at all.
 *
 * @param {object} blob  a v4 layout, as `generateOffice().layout`
 */
export function roomOf(blob) {
  resetLayout();
  if (blob) applyLayout(blob);
  const plan = survey();

  return {
    desks: DESKS.map((d) => ({ x: d.x, z: d.z })),
    seating: FURNITURE.filter((f) => SEATING.includes(f.kind))
      .map((f) => ({ x: f.x, z: f.z, facing: f.facing })),
    rugs: plan.rects.filter((r) => r.soft && r.key.startsWith('furniture:rug')),
    plants: DECOR.plants.map((p) => ({ x: p.x, z: p.z })),
    // Anything that can stand between two areas and read as a division: the
    // planting, and the furniture that is not somewhere to sit.
    props: [
      ...DECOR.plants.map((p) => ({ x: p.x, z: p.z })),
      ...FURNITURE.filter((f) => !SEATING.includes(f.kind) && f.kind !== 'rug')
        .map((f) => ({ x: f.x, z: f.z })),
    ],
    stations: Object.values(STATIONS).map((s) => ({ kind: s.kind, x: s.x, z: s.z })),
    // Everything with a footprint, and the room it stands in — what a measure
    // about the *whole* floor needs rather than about one kind of thing.
    footprints: plan.rects.filter((r) => !r.soft && r.role === 'prop'),
    room: { w: ROOM.W, d: ROOM.D },
  };
}

/**
 * Judge a layout blob.
 *
 * @param {object} blob  a v4 layout, as `generateOffice().layout`
 * @returns {{total: number, parts: {key: string, value: number, weight: number, note: string}[]}}
 */
export function judge(blob) {
  const room = roomOf(blob);

  const parts = LOOKS.map((m) => ({
    key: m.key,
    weight: m.weight,
    note: m.note,
    value: clamp01(m.of(room)),
  }));
  return {
    total: Math.round((parts.reduce((n, p) => n + p.value * p.weight, 0) / TOTAL) * 1000) / 1000,
    parts,
  };
}
