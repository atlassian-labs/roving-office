// Turning a source's inline SVG mark (src/ui/marks.js) into something a sprite
// can wear on an agent's name tag.
//
// Two decisions worth knowing about:
//
//   - **Colours intact.** The mark is rasterised as authored, so Rovo's four
//     facets and OpenClaw's turquoise eyes survive onto the tag — a logo is
//     recognised by its colour as much as its shape, and at tag size colour is
//     the part that still carries. The sprite therefore leaves its material tint
//     white; the texture is the whole picture. It also means the brand marks reach
//     the tag exactly as their vendors published them, which is what their
//     guidelines require (see src/ui/marks.js and docs/developer/visual-assets.md).
//   - **Cached and shared.** An office has one source, so every agent in the
//     room wants the same texture. It is tagged `__shared` so an individual
//     agent's `dispose()` leaves it for the others (see Agent.dispose).

import * as THREE from 'three';
import { renderMark } from '../ui/marks.js';

// Generous next to the ~40px slot in the tag canvas: the tag itself is drawn at
// 512px and downsampled by the sprite, so the mark needs the same headroom to
// avoid being the one soft thing on a crisp pill.
const RASTER_PX = 128;

/** `${colour}|${markup}` -> texture. Module-level: shared across worlds. */
const _textures = new Map();

/**
 * Wrap a mark's markup in a data URL an `Image` can load.
 *
 * Two things the markup does not carry on its own, because in the DOM it inherits
 * both from CSS — and an SVG loaded as an image has no CSS to inherit from:
 *
 *   - **Size.** The marks are authored with a viewBox and no width/height, which
 *     leaves a standalone document with no intrinsic size, and browsers disagree
 *     about what to do with that.
 *   - **`color`.** The in-house glyphs (Cursor's chevron, the Test Data die) paint
 *     in `currentColor`, which resolves to black with no cascade to read —
 *     invisible on a dark pill. Handing in the source's accent is what the panels
 *     do via CSS, so the tag matches them. The brand marks carry their own fills
 *     and ignore it.
 */
function svgDataUrl(markup, currentColor) {
  // renderMark() also settles the `__UID__` placeholder, so gradient ids resolve
  // inside the generated document rather than dangling.
  const sized = renderMark(markup).replace(
    '<svg',
    `<svg width="${RASTER_PX}" height="${RASTER_PX}" style="color:${currentColor}"`,
  );
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
}

/**
 * A source mark as a texture, in its own colours.
 *
 * Returns immediately with a blank texture and fills it in when the SVG has
 * decoded — a mark is decoration on a label that is already correct without it,
 * so nothing waits for this.
 *
 * @param {?string} markup inline SVG from src/ui/marks.js
 * @param {string} [currentColor] what `currentColor` resolves to, for the marks
 *   that are drawn monochrome; ignored by the ones carrying their own fills
 * @returns {?THREE.CanvasTexture} null when there is no mark to draw
 */
export function markTexture(markup, currentColor = '#ffffff') {
  if (!markup) return null;

  const key = `${currentColor}|${markup}`;
  const cached = _textures.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = RASTER_PX;
  canvas.height = RASTER_PX;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.__shared = true;          // outlives any one agent
  _textures.set(key, tex);

  // Headless (the geometry probe, tests): no image decoder, so the texture stays
  // blank rather than throwing. Callers get a working, invisible sprite.
  if (typeof Image === 'undefined') return tex;

  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, RASTER_PX, RASTER_PX);
    // The viewBox does the fitting: any aspect ratio lands centred in the box.
    ctx.drawImage(img, 0, 0, RASTER_PX, RASTER_PX);
    tex.needsUpdate = true;
  };
  img.src = svgDataUrl(markup, currentColor);

  return tex;
}
