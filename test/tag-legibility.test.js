import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TAG_TARGET_PX,
  TAG_WORLD_H,
  setTagLegibility,
  tagLegibilityFor,
  tagPartScale,
} from '../src/agents/Agent.js';

const FRUSTUM = 22;

/** The tag's natural pixel height, which is what the correction has to undo.
 *
 * `TAG_WORLD_H` is in here rather than assumed: it is 1.0 today, so dropping it
 * passes, and the test would go on passing while verifying the wrong number if
 * the tag's world height ever changed. */
const naturalPx = (viewportHeight, zoom) =>
  (TAG_WORLD_H * viewportHeight * zoom) / (2 * FRUSTUM);

test('corrects a tag to the target height whatever the viewport', () => {
  // The failure this exists for: the same code gives a 36px tag on a full screen
  // and a 15px one in a 425px embed, so a name readable in one is not in the
  // other.
  for (const [h, zoom] of [
    [1065, 1.508],
    [748, 1.508],
    [468, 1.38],
    [468, 1.7],
  ]) {
    const scale = tagLegibilityFor({ viewportHeight: h, zoom, frustum: FRUSTUM });
    const corrected = naturalPx(h, zoom) * scale;
    assert.ok(
      Math.abs(corrected - TAG_TARGET_PX) < 0.01,
      `${h}px at zoom ${zoom} corrected to ${corrected}, wanted ${TAG_TARGET_PX}`,
    );
  }
});

test('grows a small viewport and shrinks a large one', () => {
  const small = tagLegibilityFor({ viewportHeight: 468, zoom: 1.38, frustum: FRUSTUM });
  const large = tagLegibilityFor({ viewportHeight: 1065, zoom: 1.508, frustum: FRUSTUM });
  assert.ok(small > 1, `a popover needs bigger tags, got ${small}`);
  assert.ok(large < 1, `a full screen needs slightly smaller, got ${large}`);
});

test('says nothing rather than guessing before layout', () => {
  // Height is 0 until the frame is laid out, and a window created at its final
  // size fires no resize to correct a number baked in then.
  assert.equal(tagLegibilityFor({ viewportHeight: 0, zoom: 1.4, frustum: FRUSTUM }), null);
  assert.equal(tagLegibilityFor({ viewportHeight: 468, zoom: 0, frustum: FRUSTUM }), null);
  assert.equal(tagLegibilityFor({ viewportHeight: 468, zoom: 1.4, frustum: 0 }), null);
});

test('clamps, because this scales a sprite sitting in the room', () => {
  // Unbounded, a very small viewport would put one name tag across the whole
  // office.
  assert.equal(setTagLegibility(99), 2.5);
  assert.equal(setTagLegibility(0.01), 0.6);
  assert.equal(setTagLegibility(1.4), 1.4);
  setTagLegibility(1);
});

test('ignores a value that is not a positive number', () => {
  setTagLegibility(1.2);
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'big', null]) {
    assert.equal(setTagLegibility(bad), 1.2, `should ignore ${String(bad)}`);
  }
  setTagLegibility(1);
});

test('every part of a tag scales by the same factor', () => {
  /* The bug this exists for: the pill and its satellite sprites picked up the
   * legibility correction and the step chip did not, so the chip sat at its
   * natural size and offset under a pill twice its scale. Three call sites that
   * had to agree, and one did not.
   *
   * They now share `tagPartScale`, so the guarantee is that the correction is in
   * the factor rather than remembered at each site. */
  setTagLegibility(1.6);
  assert.equal(tagPartScale(1), 1.6, 'office view, corrected');
  assert.equal(tagPartScale(0.28), 0.28 * 1.6, 'in-world view, corrected too');

  setTagLegibility(1);
  assert.equal(tagPartScale(1), 1);
  assert.equal(tagPartScale(0.28), 0.28, 'uncorrected is the natural scale');
});

test('the factor is multiplicative, so an in-world tag stays proportionally small', () => {
  // The two scales compose rather than one replacing the other: a corrected
  // in-world tag must stay the same fraction of a corrected office one.
  setTagLegibility(2);
  const ratio = tagPartScale(0.28) / tagPartScale(1);
  assert.ok(Math.abs(ratio - 0.28) < 1e-9, `ratio drifted to ${ratio}`);
  setTagLegibility(1);
});
