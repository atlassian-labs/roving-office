import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FRAME_MODES,
  createFrameController,
  roomScreenBox,
  verticalCentre,
  zoomForFrame,
} from '../src/scene/framing.js';

/** The room as it actually is on screen at the default camera, near enough. */
const BOX = { halfW: 15.31, halfH: 12.9, top: 15.33, bottom: -10.47 };
const LIMITS = { frustum: 22, minZoom: 0.7, maxZoom: 2.4 };

const zoom = (mode, aspect) =>
  zoomForFrame({ mode, aspect, ...LIMITS, ...BOX });

test('fill uses more of a wide frame than fit does', () => {
  // 16:9, the case this exists for. The room is 1.19 wide against a 1.78 frame,
  // so fit is bound by height and leaves the width to bare street.
  const fit = zoom('fit', 16 / 9);
  const fill = zoom('fill', 16 / 9);
  assert.ok(fill > fit, `fill ${fill} should exceed fit ${fit}`);

  // Share of the frame's width the room occupies at a given zoom.
  const widthFill = (z) => (BOX.halfW * z) / (LIMITS.frustum * (16 / 9));
  assert.ok(widthFill(fit) < 0.68, `fit leaves the width short: ${widthFill(fit)}`);
  assert.ok(widthFill(fill) > 0.7, `fill uses more of it: ${widthFill(fill)}`);
  // The claim that matters is the gain, not either number on its own.
  assert.ok(widthFill(fill) - widthFill(fit) > 0.05, 'a gain worth having');
});

test('fill never crops past its allowance', () => {
  for (const aspect of [1.33, 1.5, 1.62, 1.78, 2.4, 3.2]) {
    const z = zoomForFrame({ mode: 'fill', aspect, maxCrop: 0.12, ...LIMITS, ...BOX });
    const visibleHalfH = LIMITS.frustum / z;
    const crop = Math.max(0, 1 - visibleHalfH / BOX.halfH);
    assert.ok(crop <= 0.12 + 1e-9, `aspect ${aspect} cropped ${crop}`);
  }
});

test('fit crops nothing, at any aspect', () => {
  for (const aspect of [0.6, 1, 1.78, 3.2]) {
    const z = zoom('fit', aspect);
    const visibleHalfH = LIMITS.frustum / z;
    assert.ok(visibleHalfH >= BOX.halfH, `aspect ${aspect} clipped the room`);
  }
});

test('the two modes agree on a portrait window', () => {
  // Below the room's own aspect, width binds either way, so the crop allowance
  // never engages and a host gains nothing by asking for fill.
  assert.equal(zoom('fit', 0.8), zoom('fill', 0.8));
});

test('respects the office zoom limits rather than inventing its own', () => {
  // A limit breached here is a camera the scroll wheel cannot undo.
  for (const aspect of [0.3, 0.8, 1.78, 6]) {
    for (const mode of FRAME_MODES) {
      const z = zoom(mode, aspect);
      assert.ok(z >= LIMITS.minZoom && z <= LIMITS.maxZoom, `${mode} @ ${aspect} = ${z}`);
    }
  }
});

test('refuses to guess from a degenerate viewport', () => {
  // Called before layout, which is when a window created at its final size fires
  // no resize. Returning a number here would bake in a wrong one.
  assert.equal(zoomForFrame({ mode: 'fit', aspect: 0, ...LIMITS, ...BOX }), null);
  assert.equal(
    zoomForFrame({ mode: 'fit', aspect: 1.7, ...LIMITS, halfW: 0, halfH: 12.9 }),
    null,
  );
});

test('a crop lands on the floor, never on somebody head', () => {
  // Isometric, so the box top is the head of an agent at the back of the room and
  // the bottom is bare floor at the front. Anchoring the top is what puts the
  // shortfall where it costs nothing.
  const z = zoom('fill', 16 / 9);
  const centre = verticalCentre({ frustum: LIMITS.frustum, zoom: z, boxTop: BOX.top, boxBottom: BOX.bottom });
  const halfHeight = LIMITS.frustum / z;
  const frameTop = centre + halfHeight;
  assert.ok(frameTop >= BOX.top - 1e-9, 'the top of the room stays in frame');
  assert.ok(centre - halfHeight > BOX.bottom, 'and the floor is what leaves it');
});

test('puts a quarter of any surplus below the room', () => {
  // Portrait, where the vertical extent far exceeds what the room needs. An even
  // split reads as the room floating, because above it is skyline and below it is
  // bare ground.
  const z = zoom('fit', 0.8);
  const halfHeight = LIMITS.frustum / z;
  const centre = verticalCentre({ frustum: LIMITS.frustum, zoom: z, boxTop: BOX.top, boxBottom: BOX.bottom });
  const below = BOX.bottom - (centre - halfHeight);
  const above = centre + halfHeight - BOX.top;
  assert.ok(below > 0 && above > 0, 'slack on both sides');
  assert.ok(above > below * 2, `expected most slack above: ${above} vs ${below}`);
});

test('is continuous where cropping begins', () => {
  // The two branches meet when slack is exactly zero. A step here would be a
  // visible jump as a window is dragged past that width.
  const room = { boxTop: BOX.top, boxBottom: BOX.bottom };
  const exact = (BOX.top - BOX.bottom) / 2;
  const z = LIMITS.frustum / exact;
  const at = verticalCentre({ frustum: LIMITS.frustum, zoom: z, ...room });
  const justCropping = verticalCentre({ frustum: LIMITS.frustum, zoom: z * 1.0001, ...room });
  assert.ok(Math.abs(at - justCropping) < 0.01, `${at} vs ${justCropping}`);
});

test('projects the room box from a camera matrix', () => {
  // Identity: x and y pass through, so the box is the room's own footprint and
  // the wall height plus headroom.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const box = roomScreenBox({
    elements: identity,
    room: { W: 26, D: 20, H: 8 },
    headroom: 3.4,
  });
  assert.equal(box.halfW, 13);
  assert.equal(box.halfH, (8 + 3.4) / 2);
  assert.equal(box.top, 11.4);
  assert.equal(box.bottom, 0);
});

test('headroom leaves room for a name tag above the walls', () => {
  const room = { W: 26, D: 20, H: 8 };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const bare = roomScreenBox({ elements: identity, room });
  const withTags = roomScreenBox({ elements: identity, room, headroom: 3.4 });
  // Tolerance, not equality: this is a sum of floats.
  assert.ok(Math.abs(withTags.top - bare.top - 3.4) < 1e-9);
});

test('says nothing rather than guessing without a matrix', () => {
  assert.equal(roomScreenBox({ elements: null, room: { W: 1, D: 1, H: 1 } }), null);
  assert.equal(roomScreenBox({ elements: [1, 0, 0], room: { W: 1, D: 1, H: 1 } }), null);
});

test('a frame mode is a standing instruction, not a one-off', () => {
  // The bug review caught: resize fixes the frustum and leaves zoom alone, so a
  // computed zoom has to be recomputed or the framing decays to whatever
  // satisfied the rule at the size it was set.
  const applied = [];
  const c = createFrameController({ apply: (m) => applied.push(m) });

  c.set('fill');
  assert.deepEqual(applied, ['fill']);

  // Two resizes.
  c.refresh();
  c.refresh();
  assert.deepEqual(applied, ['fill', 'fill', 'fill']);
  assert.equal(c.mode(), 'fill');
});

test('does nothing at all until a host asks for something', () => {
  // The standalone office must resize exactly as it did before this change.
  const applied = [];
  const c = createFrameController({ apply: (m) => applied.push(m) });
  c.refresh();
  c.refresh();
  assert.deepEqual(applied, []);
  assert.equal(c.mode(), null);
});

test('a later mode replaces the one in force', () => {
  const applied = [];
  const c = createFrameController({ apply: (m) => applied.push(m) });
  c.set('fill');
  c.set('fit');
  c.refresh();
  assert.deepEqual(applied, ['fill', 'fit', 'fit']);
});
