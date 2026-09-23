import { northWorldAzimuth } from '../scene/lighting.js';

/** How long the settled compass rests before its fade begins. */
const SETTLE_MS = 320;

/** Ignore sub-pixel damping noise once it cannot move the needle visibly. */
const AZIMUTH_EPSILON = 1e-7;

/** The same edge air the rest of the HUD uses, and the gap it keeps off a panel. */
const EDGE_PX = 20;
const PANEL_GAP_PX = 12;
const COMPASS_SIZE_PX = 64;

/** Bring an angle into the shortest -PI…PI representation. */
const signedAngle = (radians) => Math.atan2(Math.sin(radians), Math.cos(radians));

/**
 * Where north appears on screen, clockwise from the top of the viewport.
 *
 * OrbitControls measures the camera from target to lens. Screen-up on the ground
 * points the other way, toward the target, hence the half turn. The room's bearing
 * turns geographic north beneath that view.
 *
 * @param {number} cameraAzimuth  OrbitControls azimuth, radians
 * @param {number} bearing        building bearing, degrees
 * @returns {number} radians, clockwise from screen-up
 */
export function northScreenAngle(cameraAzimuth, bearing = 0) {
  return signedAngle(cameraAzimuth + Math.PI - northWorldAzimuth(bearing));
}

/** The box the compass would occupy, given the offsets it is placed by. */
const boxAt = ({ width, height }, right, bottom) => ({
  left: width - right - COMPASS_SIZE_PX,
  right: width - right,
  top: height - bottom - COMPASS_SIZE_PX,
  bottom: height - bottom,
});

/** Two boxes sharing screen. Edges that merely touch are not an overlap. */
const overlaps = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** A DOMRect-ish thing as edges, or null if it is not on screen at all. */
const edgesOf = (rect) =>
  rect && rect.width > 0 && rect.height > 0
    ? {
      left: rect.left ?? 0,
      top: rect.top ?? 0,
      right: (rect.left ?? 0) + rect.width,
      bottom: (rect.top ?? 0) + rect.height,
    }
    : null;

/**
 * Keep the compass in scene space rather than painting it over a panel.
 *
 * It starts in the bottom-right corner and is pushed out of any panel it lands on,
 * **by that panel's nearest edge**: a shallow full-width strip is cheapest to clear
 * upwards, and a tall panel moored to the right — the agent inspector — is cheapest
 * to clear sideways. One rule covers both, which matters because clearing the
 * inspector the other way would push the compass off the top of the scene: it may
 * be the height of the viewport, so there is no "above" to move to.
 *
 * Every move is away from the corner, so a panel cleared stays cleared and one pass
 * per panel is enough. The clamps leave the compass the usual edge air if a panel is
 * too big to escape at all, which is the one case where it must overlap something.
 *
 * @param {{width: number, height: number}} viewport
 * @param {Array<?DOMRect>} panels  the panels to stay out of, in any order
 * @returns {{right: number, bottom: number}} CSS offsets, px
 */
export function compassPlacement(viewport, panels = []) {
  const { width, height } = viewport;
  const rects = panels.map(edgesOf).filter(Boolean);
  const ceiling = Math.max(EDGE_PX, height - COMPASS_SIZE_PX - EDGE_PX);
  const wall = Math.max(EDGE_PX, width - COMPASS_SIZE_PX - EDGE_PX);

  let right = EDGE_PX;
  let bottom = EDGE_PX;

  // Each panel gets at most one turn, so a panel too big to escape cannot loop, nor
  // spend the pass another panel needed.
  const pending = new Set(rects);
  while (pending.size) {
    const box = boxAt(viewport, right, bottom);
    const hit = [...pending].find((rect) => overlaps(box, rect));
    if (!hit) break;
    pending.delete(hit);

    const up = height - hit.top + PANEL_GAP_PX;
    const aside = width - hit.left + PANEL_GAP_PX;
    const upFits = up <= ceiling;
    const asideFits = aside <= wall;
    // Whichever way out fits. The shorter one when both fit — or when neither does,
    // where the only question left is which way to be clamped.
    if (upFits === asideFits ? up <= aside : upFits) {
      bottom = Math.min(ceiling, Math.max(bottom, up));
    } else {
      right = Math.min(wall, Math.max(right, aside));
    }
  }

  return { right, bottom };
}

/** Fifteen-degree ticks, with the quarter turns given the Orientation dial's weight. */
function ticks() {
  return Array.from({ length: 24 }, (_, i) => {
    const quarter = i % 6 === 0;
    const y1 = quarter ? 7 : 8;
    const y2 = quarter ? 13 : 11;
    return `<line class="${quarter ? 'quarter' : ''}" x1="32" y1="${y1}" x2="32" y2="${y2}" transform="rotate(${i * 15} 32 32)" />`;
  }).join('');
}

/**
 * A small, passive compass which appears only while the view or room is turning.
 *
 * @param {object} opts
 * @param {object} opts.controls              OrbitControls
 * @param {() => number} opts.getBearing      current building bearing, degrees
 * @param {HTMLElement} opts.host             the UI overlay
 * @param {Array<?HTMLElement>} [opts.clearOf]  panels it must never be painted over
 * @param {number} [opts.settleMs]
 */
export function createNorthCompass({
  controls, getBearing, host, clearOf = [], settleMs = SETTLE_MS,
}) {
  const el = document.createElement('div');
  el.id = 'north-compass';
  el.className = 'north-compass';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <svg viewBox="0 0 64 64" focusable="false">
      <circle class="north-compass-face" cx="32" cy="32" r="26" />
      <g class="north-compass-ticks">${ticks()}</g>
      <g class="north-compass-needle">
        <path class="north-compass-north" d="M32 10 L37 32 L32 29 L27 32 Z" />
        <path class="north-compass-south" d="M32 54 L27 32 L32 35 L37 32 Z" />
      </g>
      <circle class="north-compass-pin" cx="32" cy="32" r="2.5" />
    </svg>`;
  host.appendChild(el);

  const needle = el.querySelector('.north-compass-needle');
  let lastAzimuth = controls.getAzimuthalAngle();
  let fadeTimer = null;

  const panels = clearOf.filter(Boolean);

  function place() {
    const { right, bottom } = compassPlacement(
      { width: window.innerWidth, height: window.innerHeight },
      panels.map((panel) => panel.getBoundingClientRect()),
    );
    el.style.right = `${right}px`;
    el.style.bottom = `${bottom}px`;
  }

  function paint() {
    place();
    const angle = northScreenAngle(controls.getAzimuthalAngle(), getBearing?.() ?? 0);
    needle.style.transform = `rotate(${angle * 180 / Math.PI}deg)`;
  }

  function show() {
    paint();
    el.classList.add('visible');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      fadeTimer = null;
      el.classList.remove('visible');
    }, settleMs);
  }

  // A controls change may be a zoom, pan or orbit. Only an azimuth change turns
  // the building on screen, so those other gestures leave the compass asleep.
  controls.addEventListener('change', () => {
    const azimuth = controls.getAzimuthalAngle();
    if (Math.abs(signedAngle(azimuth - lastAzimuth)) > AZIMUTH_EPSILON) show();
    lastAzimuth = azimuth;
  });

  // The panels change shape under the compass: the bottom stack grows and shrinks as
  // Scene, Developer and Editor open, close or wrap, and the inspector opens on a
  // selected agent and then grows with its log. Observe the boxes rather than
  // mirroring all of those independent states. A hidden panel measures 0×0, which is
  // how closing one puts the compass back in the corner.
  const observer = globalThis.ResizeObserver ? new ResizeObserver(place) : null;
  for (const panel of panels) observer?.observe(panel);
  window.addEventListener('resize', place);

  paint();

  return { el, show, paint };
}
