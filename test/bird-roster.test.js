// Who flies the post, and how often.
//
// The odds are the feature here. A bird post where every species turns
// up equally often is a species strip nobody would bother with, and one where the
// rare birds are *too* rare is a promise the room never keeps — somebody told the
// raven exists will watch for it. So the shares are asserted rather than left to
// read off a table that could drift from the prose describing it, which is exactly
// how this file's own comments went stale once already.
//
// Swept, not sampled: every share below is proved by walking an injected toss
// across [0, 1), so nothing here can flake on a bad afternoon.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIRD_KINDS, BIRD_SHARE, rosterBird } from '../src/scene/birds.js';

/**
 * The share each species takes of one shift's flights.
 *
 * `rosterBird` tosses twice — once for the owl, once for which understudy — so the
 * sweep has to be two-dimensional to land on the real shares. A single stream
 * would correlate the two draws and measure something that never happens.
 */
function shares(shift, steps = 300) {
  const tally = {};
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < steps; j += 1) {
      const rolls = [i / steps, j / steps];
      let n = 0;
      const kind = rosterBird(shift, () => rolls[n++] ?? 0);
      tally[kind] = (tally[kind] ?? 0) + 1;
    }
  }
  const total = steps * steps;
  return Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, v / total]));
}

test('the owl takes three flights in four at night', () => {
  const night = shares('night');
  assert.ok(Math.abs(night.owl - 0.75) < 0.005, `owl ${night.owl}`);
});

test('the owl takes half the flights by day', () => {
  const day = shares('day');
  assert.ok(Math.abs(day.owl - 0.5) < 0.005, `owl ${day.owl}`);
});

test('the other three split what the owl leaves, evenly, on both shifts', () => {
  // Evenly on purpose. A weighted tail would be three numbers to tune in exchange
  // for a difference nobody watching the room could detect.
  for (const [shift, owl] of [['night', 0.75], ['day', 0.5]]) {
    const got = shares(shift);
    const each = (1 - owl) / 3;
    for (const kind of ['pigeon', 'kookaburra', 'raven']) {
      assert.ok(Math.abs(got[kind] - each) < 0.005, `${shift} ${kind} ${got[kind]}`);
    }
  }
});

test('every bird in the roster can actually fly, on both shifts', () => {
  // The same guarantee ARRIVALS has: a species in the list is a species that turns
  // up, so adding one is adding it to `UNDERSTUDIES` and nothing else.
  for (const shift of ['night', 'day']) {
    assert.deepEqual(Object.keys(shares(shift)).sort(), [...BIRD_KINDS].sort());
  }
});

test('a toss of exactly 1 still names a bird', () => {
  // Math.random() never returns 1, but an injected rng might, and an undefined
  // species reaches the scene as a bird with no mesh — an invisible courier.
  for (const shift of ['night', 'day']) {
    assert.ok(BIRD_KINDS.includes(rosterBird(shift, () => 1)), shift);
  }
});

test('a letter takes wing one time in three', () => {
  // The share itself, so the number the docs quote has something holding it still.
  assert.ok(Math.abs(BIRD_SHARE - 1 / 3) < 1e-9, `${BIRD_SHARE}`);
});
