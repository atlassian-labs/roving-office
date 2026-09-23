/**
 * Reading a colour somebody typed.
 *
 * A harness can say what colour an agent wears (`session.actor_color`, spec §3.2), and
 * what arrives is whatever was written in a config or a Markdown file. Some of it is a
 * colour — `#c1440e`, `rgb(193 68 14)`. Most of it is a *description*:
 *
 *     Colour: Rich red / crimson
 *     Colour: Bright tangerine / golden-orange
 *     Colour: Lavender / healthcare purple
 *
 * Those are real, taken from real agents' `IDENTITY.md` files, and not one of them is a
 * CSS colour. So there are two jobs here, and confusing them is the trap:
 *
 * **1. Finding a colour.** CSS handles the explicit forms; a vendored table of colour
 * names (`colour-names.js`) handles the written ones, and it is startlingly good at it —
 * `rich red`, `field green`, `pitch green`, `tangerine`, `marigold`, `stormy sea` and
 * `oxblood` are all literal entries. Vocabulary is a solved problem.
 *
 * **2. Making it wearable.** This is the part no naming source can help with, because
 * every one of them answers with the *ideal* of a colour: `crimson` is `#8c000f`, nearly
 * black; `marigold` is `#fcc006`, a highlighter; `blue` is `#0000ff`. Dropped into a room
 * whose sixteen shirts are all muted mid-tones, any of them reads as a rendering bug. An
 * LLM asked the same question gives the same fire-engine answers, so this is not a
 * cleverness problem — it is a *fitting* problem, solved by projecting the colour into the
 * range the wardrobe actually occupies. See `fitToWardrobe`.
 *
 * The one thing never fitted is an explicit hex, because a hex is a decision. `Colour:
 * Rich red (#b03a3a)` means that red and no other, and an agent that went to the trouble
 * of choosing one should be dressed in it.
 */

/**
 * The wardrobe: sixteen shirts, a warm/cool mix of saturated and muted tones chosen to
 * sit together in one room.
 *
 * It lives here rather than in AgentManager because it is now two things at once — the
 * palette an unnamed colleague is dressed from, and the *reference* every described colour
 * is fitted against. One list, so the two can never drift apart.
 */
export const SHIRT_PALETTE = [
  0x6fb1e0,  // soft blue
  0x7bc47f,  // sage green
  0xb489e0,  // lavender
  0xe0a94f,  // warm gold
  0x4fb0b0,  // teal
  0xd97fae,  // dusty rose
  0xe0785a,  // warm coral
  0x8b7b9f,  // muted mauve
  0x5a9fd4,  // deeper blue
  0x6d8b6f,  // muted green
  0xd9a76a,  // burnt orange
  0xc97a7a,  // muted terracotta
  0x7a9fbd,  // slate blue
  0xa8956d,  // warm taupe
  0x5fa89f,  // dusty teal
  0xe099b3,  // soft pink
];

/** Long enough for `hsl(210 40% 55% / 0.5)` and for any real description; a cap all the same. */
const MAX_INPUT = 120;

/** Phrases longer than this are not colour names, and scanning for them is wasted work. */
const MAX_PHRASE_WORDS = 3;

// ---------------------------------------------------------------------------
// 1. Colours written as colours
// ---------------------------------------------------------------------------

let ctx = null;

/** One 1×1 canvas for the life of the page; colours are read a handful of times. */
function context() {
  if (ctx) return ctx;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  ctx = canvas.getContext('2d');
  return ctx;
}

// Two sentinels, because a single one cannot tell "invalid, so unchanged" from "valid,
// and happens to be the sentinel". Anything that survives both assignments unchanged was
// genuinely rejected: no real value can equal both.
const SENTINELS = ['#010203', '#040506'];

/** Anything CSS understands → `0xrrggbb`, or `null`. The canvas is the parser. */
function cssColour(input) {
  let c;
  try {
    c = context();
  } catch {
    return null;   // no DOM (a test, a worker): the palette is a fine answer
  }
  if (!c) return null;
  const results = SENTINELS.map((sentinel) => {
    c.fillStyle = sentinel;
    c.fillStyle = input;
    return c.fillStyle;
  });
  if (results[0] !== results[1]) return null;
  const normalised = results[0];
  if (typeof normalised !== 'string') return null;
  // Canvas gives `#rrggbb` for opaque colours and `rgba(r, g, b, a)` when translucent.
  const hex = /^#([0-9a-f]{6})$/i.exec(normalised);
  if (hex) return Number.parseInt(hex[1], 16);
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(normalised);
  if (!rgba) return null;
  const [r, g, b] = rgba.slice(1, 4).map((n) => Math.min(255, Math.max(0, Math.round(Number(n)))));
  return (r << 16) | (g << 8) | b;
}

/** `#c1440e`, `c1440e`, `rgb(...)`, `oklch(...)` — a colour stated numerically. */
const EXPLICIT = /^(?:#?[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(.*\))$/i;

/**
 * `#c1440e` and its short and alpha-bearing forms, without asking anybody.
 *
 * Hex is arithmetic, so making the *most common* case depend on a canvas was a small
 * mistake with a real cost: it made the whole module quietly DOM-only, and a hex that
 * cannot be read outside a browser is a hex that cannot be read in a test either. Alpha is
 * dropped, as a shirt is a shirt.
 */
function hexColour(digits) {
  const hex = digits.replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  if (hex.length === 3 || hex.length === 4) {
    const [r, g, b] = [...hex.slice(0, 3)].map((c) => Number.parseInt(c + c, 16));
    return (r << 16) | (g << 8) | b;
  }
  if (hex.length === 6 || hex.length === 8) return Number.parseInt(hex.slice(0, 6), 16);
  return null;
}

/**
 * A colour stated as a colour → `0xrrggbb`, or `null` if it was a description instead.
 *
 * Deliberately *narrower* than "anything CSS accepts": a bare colour **word** is not
 * handled here, because `blue` is a description that happens to be in the CSS spec, and
 * `#0000ff` is nobody's shirt. Words go to `describeColour`, which finds the same colour
 * and then makes it wearable. Numbers are exact, and stay exact.
 */
export function parseColour(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input || input.length > MAX_INPUT) return null;
  if (EXPLICIT.test(input)) {
    // Hex is done here rather than through the canvas, which also covers `Colour: c1440e`
    // — a hash is easy to leave off in a Markdown file, and CSS will not guess.
    const digits = /^#?([0-9a-f]{3,8})$/i.exec(input);
    if (digits) return hexColour(digits[1]);
    // `rgb(...)`, `hsl(...)`, `oklch(...)`: a dozen grammars with opinions about commas,
    // percentages and `none`. The browser owns that spec, so let it answer.
    return cssColour(input);
  }
  // A hex inside a sentence — `Rich red / crimson (#b03a3a)` — is still a decision, and
  // the likeliest way one gets written: the words for whoever reads the file, the hex for
  // whoever has to paint with it. Both, and the hex wins.
  const embedded = /#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(input);
  if (embedded) return hexColour(embedded[1]);
  return null;
}

// ---------------------------------------------------------------------------
// 2. Making a colour wearable — OkLab
// ---------------------------------------------------------------------------
//
// The first attempt at this clamped saturation and lightness in HSL, and the results were
// comedy: `charcoal grey` came out green and `oxblood` came out hot pink. HSL's S and L
// are not independent of each other or of hue, so clamping them separately invents a
// colour nobody asked for. OkLab is perceptually uniform, which is exactly what "keep the
// hue, change how dark and how vivid it is" needs — and its chroma is an absolute
// quantity, so a near-grey stays a near-grey instead of acquiring a hue out of noise.

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(color) {
  const r = srgbToLinear(((color >> 16) & 255) / 255);
  const g = srgbToLinear(((color >> 8) & 255) / 255);
  const b = srgbToLinear((color & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function fromOklab([L, a, bb]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * bb) ** 3;
  const rgb = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((v) => Math.min(255, Math.max(0, Math.round(linearToSrgb(v) * 255))));
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

/** OkLab → lightness, chroma, hue. Hue in radians, because nothing here reads it. */
function toLch(color) {
  const [L, a, b] = toOklab(color);
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
}

const fromLch = (L, C, h) => fromOklab([L, C * Math.cos(h), C * Math.sin(h)]);

/** How light and how vivid a shirt in this room is allowed to be. Measured, not chosen. */
const WARDROBE = (() => {
  const lch = SHIRT_PALETTE.map(toLch);
  const ls = lch.map((x) => x[0]);
  const cs = lch.map((x) => x[1]);
  return {
    lMin: Math.min(...ls), lMax: Math.max(...ls),
    cMin: Math.min(...cs), cMax: Math.max(...cs),
  };
})();

/** Below this much chroma a colour is a grey, and must stay one. */
const NEUTRAL_CHROMA = 0.02;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Adjectives, as adjustments.
 *
 * Colour names come with modifiers attached — `deep teal`, `muted olive`, `pale sage` —
 * and the table knows only some of those as whole entries. Applying the adjective
 * ourselves generalises to the ones it does not, and each is a nudge in OkLab: `l` shifts
 * lightness, `c` scales chroma. Applied *before* the fit, so the room still has the last
 * word: `bright` cannot make a highlighter, only the brightest shirt here.
 */
const MODIFIERS = {
  rich: { c: 1.10 },
  deep: { l: -0.05, c: 1.10 },
  dark: { l: -0.06 },
  bright: { c: 1.15 },
  vivid: { c: 1.20 },
  strong: { c: 1.15 },
  muted: { c: 0.75 },
  dusty: { c: 0.70 },
  dull: { c: 0.70 },
  soft: { c: 0.80, l: 0.03 },
  pale: { c: 0.60, l: 0.06 },
  light: { l: 0.05 },
};

/**
 * A colour, as worn in this room.
 *
 * Keeps the hue exactly — that is what a description is actually about — and pulls
 * lightness and chroma into the wardrobe's own range. What comes back is recognisably the
 * colour asked for and unmistakably a shirt from this building: `crimson` becomes a brick
 * red, `marigold` a warm gold, `blue` a shirt blue.
 */
export function fitToWardrobe(color, modifiers = []) {
  if (!Number.isFinite(color)) return null;
  const [lightness, chroma, hue] = toLch(color & 0xffffff);
  let L = lightness;
  let C = chroma;
  const neutral = C < NEUTRAL_CHROMA;
  for (const word of modifiers) {
    const adjust = MODIFIERS[word];
    if (!adjust) continue;
    if (adjust.l) L += adjust.l;
    if (adjust.c) C *= adjust.c;
  }
  L = clamp(L, WARDROBE.lMin, WARDROBE.lMax);
  // A grey keeps its greyness: clamping chroma *up* to the palette minimum would give
  // `charcoal` a hue, and which hue would be pure chance.
  if (!neutral) C = clamp(C, WARDROBE.cMin, WARDROBE.cMax);
  return fromLch(L, C, hue);
}

// ---------------------------------------------------------------------------
// 3. Colours written as words
// ---------------------------------------------------------------------------

/** The parsed table, once somebody has needed it. */
let names = null;
let loading = null;

/**
 * Fetch the colour-name table.
 *
 * Imported dynamically, and only when a description actually arrives, because it is 237 KB
 * to answer a question most offices never ask: a room full of Claude Code sessions has no
 * `actor_color` in it at all, and should not pay for one. The cost of that choice is that
 * the first described colour resolves a beat late — which the office already handles,
 * since an identity can arrive after its session does (see AopSource._adoptColour).
 *
 * A failed import is remembered as an empty table rather than retried, so a broken deploy
 * costs one request, not one per event.
 */
export function loadColourNames() {
  if (names) return Promise.resolve(true);
  if (!loading) {
    loading = import('./colour-names.js')
      .then((mod) => {
        names = parseTable(mod.NAMES);
        return names.size > 0;
      })
      .catch(() => {
        names = new Map();
        return false;
      });
  }
  return loading;
}

/** `'field green:60b922|rich red:ff1144'` → Map. One allocation and a split, by design. */
function parseTable(encoded) {
  const map = new Map();
  for (const entry of String(encoded ?? '').split('|')) {
    const colon = entry.lastIndexOf(':');
    if (colon < 1) continue;
    const color = Number.parseInt(entry.slice(colon + 1), 16);
    if (Number.isFinite(color)) map.set(entry.slice(0, colon), color);
  }
  return map;
}

/**
 * Descriptions arrive as a list of tries, not one colour: `Rich red / crimson`, `Lavender
 * / healthcare purple`. Each side is a whole answer, so each is scored separately.
 */
const SEGMENTS = /[/,;|·—–]|\bor\b/;

const WORDS = /[^a-z0-9]+/;

/**
 * A written colour → the best match in it, or `null`.
 *
 * Scored by **how much of a segment the match covers**, which sounds fussy and is the
 * difference between right and wrong on real data. `Warm library yellow / marigold`
 * contains `yellow` — one word of three — and `marigold`, which is the whole second
 * segment; so the segment that is explained completely wins, and Paige gets marigold
 * rather than a mouthful of olive. Ties go to the earlier segment, because people write
 * the colour they mean first and gloss it afterwards.
 */
function matchName(value) {
  if (!names) return null;
  let best = null;
  String(value).toLowerCase().split(SEGMENTS).forEach((segment) => {
    const words = segment.split(WORDS).filter(Boolean);
    if (!words.length) return;
    for (let n = Math.min(MAX_PHRASE_WORDS, words.length); n >= 1; n -= 1) {
      for (let i = 0; i + n <= words.length; i += 1) {
        const phrase = words.slice(i, i + n).join(' ');
        // The table first, then CSS for a single word — which catches the colour names the
        // table's filter dropped for containing no colour word at all (`rebeccapurple`,
        // `chartreuse`).
        let color = names.get(phrase) ?? null;
        if (color === null && n === 1 && phrase.length >= 3) color = cssColour(phrase);
        if (color === null) continue;
        const coverage = n / words.length;
        if (!best || coverage > best.coverage + 1e-9) {
          best = {
            color,
            matched: phrase,
            coverage,
            // Only the adjectives the matched name did not already account for, or
            // `deep teal` would be deepened twice.
            modifiers: words.filter((w) => w in MODIFIERS && !phrase.includes(w)),
          };
        }
        return;   // the longest phrase in this segment; anything else here is shorter
      }
    }
  });
  return best;
}

/**
 * A written colour → a wearable `0xrrggbb`, with the workings.
 *
 * `null` means nothing colour-shaped was in there — or the table has not loaded yet — and
 * the palette decides, which is a normal answer and why a fanciful entry costs nothing but
 * the wish.
 */
export function describeColour(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input || input.length > MAX_INPUT) return null;
  const found = matchName(input);
  if (!found) return null;
  const color = fitToWardrobe(found.color, found.modifiers);
  if (color === null) return null;
  return { color, matched: found.matched, ideal: found.color };
}

/**
 * Everything, in the right order: an explicit colour exactly as given, else a description
 * fitted to the room.
 *
 * `exact` says which happened, because that is the difference between honouring a decision
 * and interpreting a phrase.
 */
export function resolveColour(value) {
  const exact = parseColour(value);
  if (exact !== null) return { color: exact, exact: true, matched: null };
  const described = describeColour(value);
  if (!described) return null;
  return { color: described.color, exact: false, matched: described.matched };
}
