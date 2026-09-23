// The seeding the measuring tools stand on.
//
// The coplanar probe is a CI gate, and a gate that measures a randomly dressed
// scene is a coin toss rather than a gate. What makes it a gate is that
// seedRandom() gives the same stream every time, so this is the property the
// build's trust in that assertion actually rests on.
//
// The probe's own end-to-end determinism is not asserted here: it builds sixteen
// scenes twice over, which belongs in `npm run probe -- --sweep`, and CI runs
// exactly that on the recorded baseline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedRandom, DEFAULT_SEED } from '../bin/lib/headless-scene.js';

/** The first `n` values of a freshly seeded stream. */
const draw = (seed, n = 24) => {
  const restore = seedRandom(seed);
  const out = Array.from({ length: n }, () => Math.random());
  restore();
  return out;
};

test('the same seed gives the same stream', () => {
  assert.deepEqual(draw(1), draw(1));
});

test('the default is a fixed seed, not a fresh one each call', () => {
  assert.equal(typeof DEFAULT_SEED, 'number');
  assert.deepEqual(draw(undefined), draw(DEFAULT_SEED));
});

test('different seeds give different streams', () => {
  // What --seed is for: varying it deliberately is how a dressing-dependent pair
  // gets hunted, so it has to actually move the scene.
  assert.notDeepEqual(draw(1), draw(2));
});

test('reseeding rewinds, so a build cannot inherit where the last one left off', () => {
  // The probe reseeds before every build for this reason: whatever the previous
  // build drew must not shift where this build's dressing lands in the stream.
  const restore = seedRandom(7);
  const first = Array.from({ length: 8 }, () => Math.random());
  seedRandom(7);
  const again = Array.from({ length: 8 }, () => Math.random());
  restore();
  assert.deepEqual(again, first);
});

test('the values are usable as Math.random', () => {
  const restore = seedRandom(3);
  const values = Array.from({ length: 500 }, () => Math.random());
  restore();
  for (const v of values) {
    assert.ok(v >= 0 && v < 1, `${v} is not in [0, 1)`);
  }
  // Dressing built from a lopsided stream would look striped rather than dressed,
  // so a loose spread check: both halves of the range get used.
  assert.ok(values.some((v) => v < 0.5) && values.some((v) => v >= 0.5));
});

test('restoring puts the real Math.random back', () => {
  const real = Math.random;
  const restore = seedRandom(1);
  assert.notEqual(Math.random, real);
  restore();
  assert.equal(Math.random, real);
});
