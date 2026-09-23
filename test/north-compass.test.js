import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compassPlacement, northScreenAngle } from '../src/ui/north-compass.js';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const degrees = (radians) => radians * DEG;

test('north is anchored to the same tuned world heading as the real sun', () => {
  // With the camera directly on +z, screen-up points toward -z (180°). The room's
  // tuned north is 264.6°, so it appears 84.6° anticlockwise from screen-up.
  assert.ok(Math.abs(degrees(northScreenAngle(0, 0)) + 84.6) < 1e-9);
});

test('orbiting the camera turns north by the same amount on screen', () => {
  const before = northScreenAngle(41 * RAD, 0);
  const after = northScreenAngle(71 * RAD, 0);
  assert.ok(Math.abs(degrees(after - before) - 30) < 1e-9);
});

test('turning the room east takes north a quarter-turn the other way', () => {
  const before = northScreenAngle(41 * RAD, 0);
  const after = northScreenAngle(41 * RAD, 90);
  assert.ok(Math.abs(degrees(after - before) + 90) < 1e-9);
});

// The overlay at 1600×1000, measured the way the browser reports it: the bottom strip
// runs from the roster's gutter to the right inset, and the inspector is moored to the
// bottom-right corner the compass rests in.
const VIEWPORT = { width: 1600, height: 1000 };
const STRIP = { left: 264, top: 684, width: 1320, height: 300 };
const NARROW_STRIP = { ...STRIP, width: 1004 };   // as it is while the inspector is open
const INSPECTOR = { left: 1284, top: 96, width: 300, height: 888 };
const CLOSED = { left: 0, top: 0, width: 0, height: 0 };

test('nothing in the corner leaves the compass in it', () => {
  assert.deepEqual(compassPlacement(VIEWPORT, [CLOSED, CLOSED]), { right: 20, bottom: 20 });
});

test('a bottom strip lifts the compass into the scene rather than being covered', () => {
  assert.deepEqual(compassPlacement(VIEWPORT, [STRIP]), { right: 20, bottom: 328 });
});

// The bug: the inspector shares the compass's corner, and is far too tall to clear
// upwards — 96px from the top of a 1000px viewport — so the compass steps sideways.
test('the agent inspector pushes the compass aside, not off the top', () => {
  assert.deepEqual(compassPlacement(VIEWPORT, [INSPECTOR]), { right: 328, bottom: 20 });
});

test('with both open the compass goes up and across, in either order', () => {
  const placed = { right: 328, bottom: 328 };
  assert.deepEqual(compassPlacement(VIEWPORT, [NARROW_STRIP, INSPECTOR]), placed);
  assert.deepEqual(compassPlacement(VIEWPORT, [INSPECTOR, NARROW_STRIP]), placed);
});

test('a panel too big to escape cannot push the compass off screen', () => {
  const smothered = compassPlacement({ width: 800, height: 500 }, [
    { left: 0, top: 10, width: 800, height: 474 },
  ]);
  assert.deepEqual(smothered, { right: 20, bottom: 416 });
});
