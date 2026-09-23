// Source marks for the office picker, the switcher rows and the title-bar pill.
//
// Two kinds live here, and the difference matters:
//
//   - **Real brand marks** (`brandMark`) are each vendor's own official asset,
//     verbatim. A logo is the fastest thing to recognise in a row of five, so
//     where a usable vector exists it beats anything drawn by hand.
//   - **Stylised glyphs** (`mark`) are in-house geometry for sources with no
//     vector to hand. Monochrome, tinted from the source's accent colour.
//
// Everything is inline SVG: no asset fetch, no build step, and no second network
// round-trip before the picker can paint. Stylised glyphs are drawn in a 24×24
// box; brand marks keep their own paths and are sized by CSS.
//
// **A brand mark's viewBox has to be the artwork, not the canvas it shipped on.**
// One CSS rule sizes every mark in the row, so the box is the unit of size and any
// padding baked into a vendor's file comes straight off the mark's visual weight.
// OpenAI's Blossom ships in a 716 box with its ink spanning 355 of it — under half —
// and next to the Claude Spark, which fills 99.6% of its own 94 box, it landed at
// roughly half the weight and read as a grey speck on a name tag. So each viewBox
// below is the artwork's measured bounds. Measure, never guess: `getBBox()` on the
// rendered path in a browser is the only honest answer, because curves bulge past
// their control points (the Blossom's do, by three units).
//
// **The paths themselves are copied as published, and never recoloured, rescaled or
// otherwise adjusted.** Every vendor here requires its mark unaltered, and a
// tempting tweak — dropping a tile that sits heavy, tinting a black mark to match
// a panel — is the thing their guidelines name. Trimming empty canvas off a viewBox
// is not one of those: no ink moves relative to any other ink, and the mark is
// reproduced whole. Where a vendor publishes several official variants, pick the one
// that suits the surface (both surfaces these appear on are near-white, so the
// light-background variants are the right ones) rather than editing one. Each mark's
// provenance and release basis is recorded in docs/developer/visual-assets.md; all
// but OpenClaw's are
// excluded from the Apache-2.0 grant, per NOTICE.

// src/rovo-mark.js and nothing heavier: this module is reachable from
// debuglog.html, which never loads three.js. Its header has the whole reason.
import { ROVO_SHAPES } from '../rovo-mark.js';
import { node } from './dom.js';

/** Wrap path markup in a 24×24 svg that inherits colour and size from CSS. */
function mark(inner) {
  return `<svg class="src-mark" viewBox="0 0 24 24" role="img" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

/**
 * Wrap a brand logo's own paths, colours intact.
 *
 * `color` from CSS is deliberately ignored: these fills *are* the brand, and
 * tinting them would misrepresent it.
 */
function brandMark(viewBox, inner) {
  // `fill="none"` matters: stroke-only paths (OpenClaw's antennae) would
  // otherwise take the default black fill and blob over the artwork.
  //
  // No `fill-rule` here, deliberately. SVG's default is `nonzero` and every
  // asset below is copied from a vendor file whose own root sets none, so
  // imposing `evenodd` on the wrapper would silently redraw them — OpenAI's
  // Blossom is eight subpaths and its interior reads as solid under one rule and
  // hollow under the other. Each path keeps whatever rule its source file gave it.
  return `<svg class="src-mark src-mark-brand" viewBox="${viewBox}" role="img" aria-hidden="true"
    fill="none" stroke-linejoin="round" stroke-miterlimit="2"
    xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

let uid = 0;

/**
 * Stamp a mark template with fresh ids, ready to insert.
 *
 * A mark can be on screen three times at once — picker button, switcher row and
 * title-bar pill — and any `<defs>` inside it (OpenClaw has a gradient) would
 * then share one id across all three copies. Whichever copy the browser resolved
 * against could later be removed from the DOM, leaving the survivors painting
 * with a dangling `url(#…)`. So every insertion gets its own id.
 *
 * Marks with no ids pass through untouched.
 */
export function renderMark(markup) {
  return String(markup ?? '').split('__UID__').join(`m${++uid}`);
}

/**
 * A span carrying a source's mark, in the source's own colours.
 *
 * `color` is set for the sake of the in-house glyphs, which paint in
 * `currentColor` — Cursor's chevron and the Test Data die; the brand marks carry
 * their own fills and ignore it. The title is there because a logo at 12px is a
 * hint, not a label.
 *
 * Shared rather than per-panel: the roster row and the First Person panel both put
 * this glyph before an agent's name, and one agent should not be able to look like
 * two different agents depending on which panel you read.
 *
 * @param {object} def        source definition, from data/sources.js
 * @param {string} className  class for the wrapper, so each panel can size it
 */
export function markSpan(def, className) {
  const el = node('span', className);
  el.innerHTML = renderMark(def.mark);
  el.style.color = def.accent;
  el.title = `Source: ${def.label}`;
  return el;
}

/**
 * The viewBox enclosing a list of flat polygon shapes, with room to breathe.
 *
 * @param {Array<{points: number[][]}>} shapes
 * @param {number} [inset] fraction of the artwork's own size to leave as padding
 *   on every side, when a dense mark needs an optical trim to stop reading heavy
 *   (the Blossom takes 4%; the hexagon needs none — see below)
 */
function boundsViewBox(shapes, inset = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { points } of shapes) {
    for (const [x, y] of points) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  const px = (x1 - x0) * inset, py = (y1 - y0) * inset;
  return [x0 - px, y0 - py, (x1 - x0) + 2 * px, (y1 - y0) + 2 * py]
    .map((n) => Math.round(n * 100) / 100).join(' ');
}

/** One closed `<path>` per flat polygon, in its own colour. Straight lines only. */
function polygonPaths(shapes) {
  return shapes
    .map(({ color, points }) => `<path d="M${points.map((p) => p.join(' ')).join('L')}Z" fill="${color}"/>`)
    .join('\n  ');
}

/**
 * Rovo — Atlassian's own Rovo mark: the four-facet hexagon, in four flat
 * Atlassian brand colours (#1868db, #bf63f3, #fca700, #82b536).
 *
 * The geometry is not a second copy. It is `ROVO_SHAPES` from src/rovo-mark.js,
 * which is also what the Rovo standee in the room is extruded from — one artwork,
 * so the statue and this tile cannot drift apart.
 * The facets were traced from UXWing's rendering of the same Atlassian mark
 * (https://uxwing.com/atlassian-rovo-icon/) rather than lifted out of a kit SVG;
 * docs/developer/visual-assets.md records that, and §1 there records the standing
 * ruling on the colours,
 * which are Atlassian's own brand values.
 *
 * Paint order is `ROVO_SHAPES`' own order, which is the order the facets were
 * traced in. The original artwork is a painter's-algorithm stack of overlapping
 * paths, but these four are not those: each colour that reaches the surface was
 * traced back out as one solid polygon, and they tile edge to edge with no
 * overlap (see src/rovo-mark.js), so no facet can occlude another —
 * the same property that lets the standee extrude them as four separate solids.
 *
 * A trademark of Atlassian, reproduced to identify the source of a feed.
 */
export const rovoMark = brandMark(boundsViewBox(ROVO_SHAPES), `
  ${polygonPaths(ROVO_SHAPES)}
`);

/**
 * Claude — the Claude Spark, in Anthropic's clay.
 *
 * `Claude logos/3 Claude Spark/SVG/Claude Spark - Clay.svg`, verbatim, from
 * Anthropic's press kit at https://www.anthropic.com/press-kit. The Spark is
 * published free-standing in exactly this colour, so it sits alongside the other
 * marks with no tile to drop and no fill to change — which matters, because the
 * Trademark Guidelines permit no alterations of any kind.
 *
 * A trademark of Anthropic, reproduced to identify the source of a feed.
 */
export const claudeMark = brandMark('0 0 94 94', `
  <path d="M18.7657 62.4437L37.1822 52.1167L37.4857 51.2122L37.1822 50.7085H36.2715L33.1852 50.5208L22.6615 50.2391L13.5545 49.8636L4.70044 49.3942L2.47428 48.9248L0.399902 46.1553L0.602281 44.794L2.47428 43.5266L5.15579 43.7613L11.0754 44.1837L19.98 44.794L26.4055 45.1695L35.9679 46.1553H37.4857L37.6881 45.545L37.1822 45.1695L36.7774 44.794L27.5692 38.5508L17.6021 31.9791L12.3908 28.1769L9.60812 26.2524L8.19147 24.4686L7.58433 20.5256L10.1141 17.7091L13.5545 17.9438L14.4146 18.1785L17.9056 20.8542L25.343 26.6279L35.0572 33.7629L36.4739 34.9364L37.0443 34.5514L37.1316 34.2792L36.4739 33.1996L31.212 23.6706L25.596 13.9539L23.0663 9.91695L22.4086 7.52296C22.1538 6.51831 22.0038 5.68714 22.0038 4.65957L24.8877 0.716544L26.5067 0.200195L30.4025 0.716544L32.0215 2.12477L34.4501 7.66379L38.3458 16.3478L44.4172 28.1769L46.188 31.6975L47.1493 34.9364L47.5035 35.9222H48.1106V35.3589L48.6166 28.6933L49.5273 20.5256L50.438 10.0108L50.7415 7.05356L52.2088 3.48605L55.1433 1.56148L57.42 2.64112L59.292 5.31674L59.039 7.05356L57.926 14.2824L55.7504 25.5952L54.3337 33.1996H55.1433L56.1046 32.2138L59.9497 27.1442L66.3752 19.0704L69.2085 15.8784L72.5478 12.3579L74.6728 10.668H78.7203L81.6548 15.0804L80.3394 19.6337L76.1906 24.8911L72.7502 29.3504L67.8172 35.9595L64.7562 41.2734L65.0307 41.7118L65.7681 41.6489L76.8989 39.255L82.9197 38.1753L90.1041 36.9549L93.3422 38.457L93.6963 40.006L92.4315 43.151L84.7411 45.0287L75.7353 46.8594L62.3244 50.0164L62.1759 50.1358L62.3512 50.3958L68.399 50.9432L70.9794 51.084H77.3037L89.0922 51.9759L92.1785 53.9944L93.9999 56.4822L93.6963 58.4068L88.9404 60.8008L82.5655 59.2987L67.6401 55.7312L62.5301 54.4638H61.8217V54.8862L66.0717 59.064L73.9139 66.1051L83.6786 75.2116L84.1845 77.4648L82.9197 79.2485L81.6042 79.0608L73.0032 72.5829L69.6639 69.6726L62.1759 63.3356H61.67V63.9928L63.3902 66.5276L72.5478 80.2812L73.0032 84.5059L72.3454 85.8672L69.9675 86.7121L67.3871 86.2427L61.9735 78.6852L56.4587 70.2359L52.0064 62.6315L51.4687 62.971L48.8189 91.2654L47.6047 92.7206L44.7714 93.8002L42.3934 92.0164L41.1286 89.1061L42.3934 83.3324L43.9113 75.8219L45.1255 69.8604L46.2386 62.4437L46.9184 59.9661L46.8583 59.8003L46.3153 59.8916L40.7238 67.5603L32.2239 79.0608L25.4948 86.2427L23.8758 86.8999L21.0931 85.4447L21.3461 82.863L22.9145 80.5629L32.2239 68.7338L37.8399 61.3641L41.4594 57.1337L41.4242 56.5218L41.2244 56.5048L16.489 72.6299L12.0873 73.1932L10.1647 71.4094L10.4176 68.4991L11.3283 67.5603L18.7657 62.4437Z" fill="#D97757"/>
`);

/**
 * Codex — OpenAI's Blossom.
 *
 * `OpenAI-logos/SVGs/OAI_OpenAI-Blossom_Black.svg`, verbatim, from
 * https://cdn.openai.com/brand/openai-logos.zip. Black, as published: the kit ships
 * a black and a white Blossom for light and dark surrounds, and both surfaces this
 * appears on — the picker's white tiles and the near-white name-tag pill — want the
 * black one. Picking the published variant is not the same as tinting one, and
 * OpenAI's guidance says to use the logo exactly as provided and adds no colours
 * to the Blossom.
 *
 * The viewBox is not the file's. The published file is a 716 box holding a Blossom
 * 354.67 across — 49.5% of it, the rest empty canvas — which at one shared CSS size
 * put the Blossom at about half the weight of every mark beside it. So the box below
 * is the artwork's own bounds, measured with `getBBox()` in Chrome
 * (x/y 180.5, 354.674 square, centred to within a fifth of a unit), plus a 4%
 * optical trim: the Spark next to it is a radiating star and this is a compact knot,
 * so boxes of equal size make the knot read heavier. Side by side at the picker's
 * 44px, 4% is where they stop looking unequal. The path data is untouched — cropping
 * empty canvas moves no ink, which matters because OpenAI's guidance permits no
 * alterations.
 *
 * There is no Codex-specific mark, so this is OpenAI's corporate mark standing in.
 * A trademark of OpenAI, reproduced to identify the source of a feed.
 */
export const codexMark = brandMark('166 166 384 384', `
  <path d="M508.749 317.399C516.777 287.314 508.991 253.884 485.389 230.282C461.788 206.681 428.36 198.895 398.273 206.923C376.231 184.928 343.39 174.956 311.148 183.596C278.906 192.234 255.45 217.292 247.36 247.361C217.291 255.451 192.233 278.91 183.595 311.149C174.957 343.391 184.927 376.232 206.924 398.274C198.896 428.359 206.683 461.789 230.284 485.391C253.885 508.992 287.313 516.779 317.401 508.75C339.442 530.745 372.286 540.717 404.525 532.079C436.767 523.441 460.223 498.384 468.313 468.315C498.383 460.224 523.44 436.766 532.078 404.526C540.716 372.285 530.747 339.443 508.749 317.402V317.399ZM470.899 244.776C486.892 260.77 493.488 282.601 490.687 303.412L415.577 260.046C412.411 258.218 408.509 258.218 405.345 260.046L317.401 310.82V277.526C317.401 275.191 318.652 273.005 320.676 271.837L387.644 233.174C414.178 218.353 448.346 222.223 470.901 244.776H470.899ZM357.837 311.144L398.275 334.491V381.185L357.837 404.532L317.398 381.185V334.491L357.837 311.144ZM264.776 269.693C265.207 239.305 285.644 211.649 316.453 203.393C338.3 197.54 360.505 202.744 377.127 215.573L302.014 258.937C298.848 260.764 296.898 264.144 296.898 267.798V369.346L268.065 352.699C266.043 351.531 264.776 349.353 264.776 347.017V269.691V269.693ZM203.391 316.454C209.244 294.608 224.854 277.978 244.276 269.999V356.73C244.276 360.384 246.226 363.763 249.392 365.591L337.337 416.365L308.503 433.013C306.481 434.181 303.961 434.188 301.939 433.02L234.971 394.357C208.868 378.789 195.138 347.261 203.391 316.454ZM244.775 470.9C228.781 454.906 222.186 433.075 224.986 412.264L300.096 455.63C303.263 457.457 307.164 457.457 310.328 455.63L398.273 404.856V438.149C398.273 440.485 397.022 442.671 394.997 443.839L328.029 482.502C301.495 497.322 267.327 493.452 244.772 470.9H244.775ZM450.897 445.982C450.466 476.371 430.029 504.027 399.22 512.283C377.373 518.136 355.168 512.932 338.547 500.102L413.659 456.738C416.826 454.911 418.775 451.532 418.775 447.877V346.329L447.609 362.977C449.631 364.145 450.897 366.323 450.897 368.659V445.985V445.982ZM512.282 399.221C506.429 421.068 490.819 437.697 471.397 445.676V358.946C471.397 355.292 469.448 351.912 466.281 350.085L378.336 299.311L407.17 282.663C409.192 281.495 411.712 281.487 413.734 282.655L480.702 321.318C506.805 336.887 520.536 368.415 512.282 399.221Z" fill="black"/>
`);

/** Cursor — a simple cursor chevron; the picker supplies Cursor violet. */
export const cursorMark = mark('<path d="M7 5 L15 12 L7 19" /><circle cx="17.5" cy="12" r="1.5" fill="currentColor" stroke="none" />');

/**
 * OpenClaw — the project's own lobster mascot.
 *
 * `ui/public/favicon.svg` from openclaw/openclaw at tag v2026.9.3 — the static
 * frame of it. That repository is MIT licensed, so this is the one mark here that
 * ships under a licence permitting redistribution; the notice travels with it in
 * THIRD_PARTY_NOTICES.txt, as MIT requires. The upstream file wraps the same
 * geometry in SMIL animation for the app's own surfaces, which a picker tile has
 * no use for; every path, gradient stop, circle and stroke below is byte-identical
 * to it. `__UID__` stands in for the gradient id so `renderMark()` can keep
 * concurrent copies apart.
 */
export const openclawMark = brandMark('0 0 120 120', `
  <defs>
    <linearGradient id="oc-shell-__UID__" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff4d4d"/>
      <stop offset="100%" stop-color="#991b1b"/>
    </linearGradient>
  </defs>
  <path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z" fill="url(#oc-shell-__UID__)"/>
  <path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z" fill="url(#oc-shell-__UID__)"/>
  <path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z" fill="url(#oc-shell-__UID__)"/>
  <path d="M45 15 Q35 5 30 8" stroke="#ff4d4d" stroke-width="3" stroke-linecap="round"/>
  <path d="M75 15 Q85 5 90 8" stroke="#ff4d4d" stroke-width="3" stroke-linecap="round"/>
  <circle cx="45" cy="35" r="6" fill="#050810"/>
  <circle cx="75" cy="35" r="6" fill="#050810"/>
  <circle cx="46" cy="34" r="2.5" fill="#00e5cc"/>
  <circle cx="76" cy="34" r="2.5" fill="#00e5cc"/>
`);

/** Test Data — a die, because this source is honest about rolling for it. */
export const testDataMark = mark(`
  <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3.4" />
  <g fill="currentColor" stroke="none">
    <circle cx="8.6" cy="8.6" r="1.25" />
    <circle cx="15.4" cy="8.6" r="1.25" />
    <circle cx="12" cy="12" r="1.25" />
    <circle cx="8.6" cy="15.4" r="1.25" />
    <circle cx="15.4" cy="15.4" r="1.25" />
  </g>
`);

/** A plus, for the switcher's "New Office" row. */
export const plusMark = mark('<path d="M12 5.5 V18.5" /><path d="M5.5 12 H18.5" />');
