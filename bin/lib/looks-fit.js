// Turning pairwise answers into a ranking, and comparing a ranking with a score.
//
// Shared by bin/looks-check.js (the judge's acceptance test) and
// bin/looks-explore.js (candidate measures that are not in the judge yet), which
// is the whole reason it is a module: a candidate measure has to be scored against
// exactly the arithmetic the accepted ones are, or the comparison decides nothing.

/**
 * A ranking from pairwise answers (Bradley-Terry, ties as half a win each).
 *
 * A room that never won a pair has no finite strength, so it is floored: with
 * three games a head the difference between "lost all three" and "would lose all
 * thirty" is not something these answers know.
 */
export function ranking(answers, seeds) {
  const wins = new Map(seeds.map((s) => [s, 0]));
  const games = new Map();
  for (const { a, b, winner } of answers) {
    games.set(a, (games.get(a) ?? 0) + 1);
    games.set(b, (games.get(b) ?? 0) + 1);
    if (winner === 'tie') { wins.set(a, wins.get(a) + 0.5); wins.set(b, wins.get(b) + 0.5); }
    else if (winner) wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  const pairs = answers.map(({ a, b }) => [a, b]);
  let p = new Map(seeds.map((s) => [s, 1]));
  for (let step = 0; step < 400; step += 1) {
    const next = new Map();
    for (const s of seeds) {
      let denom = 0;
      for (const [a, b] of pairs) {
        if (a === s) denom += 1 / (p.get(s) + p.get(b));
        else if (b === s) denom += 1 / (p.get(s) + p.get(a));
      }
      next.set(s, denom > 0 && wins.get(s) > 0 ? wins.get(s) / denom : 0.02);
    }
    const scale = [...next.values()].reduce((n, v) => n + v, 0) / next.size;
    p = new Map([...next].map(([s, v]) => [s, v / scale]));
  }
  return { strength: new Map([...p].map(([s, v]) => [s, Math.log(v)])), games };
}

/** Positions 1..n, in the order the values sort. */
export function ranks(values) {
  const order = values.map((_, i) => i).sort((i, j) => values[i] - values[j]);
  const out = [];
  order.forEach((i, pos) => { out[i] = pos + 1; });
  return out;
}

/**
 * Pearson's correlation.
 *
 * Exported because rank correlation is not the only way this codebase pools its
 * rounds: `bin/looks-explore.js` ranks and standardises *within* a round before
 * pooling, and what it needs at the end of that is a plain Pearson over the two
 * pooled columns. Same arithmetic either way, so it is stated once.
 */
export function pearson(xs, ys) {
  const k = xs.length;
  const mx = xs.reduce((n, v) => n + v, 0) / k;
  const my = ys.reduce((n, v) => n + v, 0) / k;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < k; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

/** Spearman's rank correlation — Pearson over the ranks. */
export function spearman(xs, ys) {
  return pearson(ranks(xs), ranks(ys));
}


/**
 * Weights from measured agreement, by a rule rather than by hand.
 *
 * The rule matters more than the weights. Hand-picking a weight per measure and
 * then reporting how well the result agrees is grading your own homework twice
 * over — once in the choice of measures and once in the choice of weights — and
 * with 34 labelled rooms and ten measures there is more than enough room to fit
 * the noise. A rule can be cross-validated: hold a room out, run the rule on the
 * rest, score the room it never saw.
 *
 * **The rule has to be continuous, and that took a wrong turn to learn.** The
 * first version gave a measure weight only once its agreement cleared the noise
 * floor — which reads as caution and is a step function. Leaving one room out
 * moves an agreement by a few hundredths, and a few hundredths either side of a
 * threshold switches a whole measure on or off. Worse, it switches it off
 * *systematically*: a room that a measure agrees with is a room whose removal
 * lowers that measure's agreement, so the fold that has to score it is the fold
 * that just dropped the measure that would have scored it well. Cross-validated
 * agreement came out at −0.01 against +0.42 in sample, which looks like a judge
 * that does not generalise and was really a rule that could not be tested.
 *
 * So: weight is the agreement itself, floored at zero. A measure that agrees
 * twice as well gets twice the say, a measure that agrees not at all gets none,
 * and nothing turns on a hair. The shrinkage a threshold was reaching for is
 * already there — an agreement of 0.02 buys 0.02 of a vote.
 */
export function weightsFor(agreement) {
  const out = new Map();
  for (const [key, value] of agreement) {
    out.set(key, Number.isFinite(value) ? Math.max(0, value) : 0);
  }
  return out;
}
