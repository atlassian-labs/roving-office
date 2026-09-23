// What the office is drawn with, as opposed to what it is drawn through (camera.js).
//
// Four pages draw this office — the room itself, reception's vignette, the prop
// gallery's studio and the scene map — and each one used to set the renderer up in
// its own words. That is four copies of a *look*: shadow filter, colour space, tone
// mapping and exposure are not per-page choices, they are the reason brushed steel
// and a glowing monitor read the same in a portrait as they do in the room. A page
// that fell behind on one of them would quietly photograph a different office.
//
// Not a caller: docs/character-movements.html and docs/item-movements.html, whose
// stages set only a pixel ratio and a shadow map. They are lit as little display
// cases rather than as the office, and adopting this would change what they draw.

import * as THREE from 'three';

/**
 * A renderer with the office's look, sized by the caller.
 *
 * Nothing here sets a size — that is the one line every caller writes differently
 * (a window, an observed element, a fixed square) — so the pixel ratio goes on
 * first and a later `setSize` has the final word on the backing store.
 *
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {boolean} [opts.transparent]  let the page's own background show through,
 *   which is what lets reception's floor fade out at the edges instead of ending at
 *   a hard rectangle, and a prop portrait drop onto a light or a dark docs page.
 * @param {number} [opts.pixelRatio]  defaults to the display's own, capped at 2 —
 *   past that the extra pixels cost more than they show. The two screenshot pages
 *   pass 1: a headless Chrome's ratio is not what those pictures are sized by.
 * @returns {THREE.WebGLRenderer}
 */
export function createRenderer({ canvas, transparent = false, pixelRatio } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent });
  if (transparent) renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(pixelRatio ?? Math.min(window.devicePixelRatio, 2));

  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap was deprecated in three.js and now silently falls back to
  // hard-edged PCFShadowMap; VSMShadowMap is the current soft-shadow filter.
  renderer.shadowMap.type = THREE.VSMShadowMap;

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  return renderer;
}
