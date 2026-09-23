import * as THREE from 'three';
import { between, chance, pick, whole } from '../dice.js';
import { lerp, smoothstep } from '../ease.js';

// ---------------------------------------------------------------------------
// The board on the second screen.
//
// Two monitors running the same code texture read as one screen shown twice, so
// the second one gets a stripped-back kanban board: three columns of cards, and
// every so often one of them slides into the next column. It is the only prop
// that shows the work rather than somebody doing it, and the movement is what
// makes a desk look attended from across the room.
//
// Dark on purpose. The board is also the emissive map, so a white Jira theme
// would come through SCREEN_ON as a white rectangle — a lamp, not a screen. It
// borrows the editor's night palette instead.
//
// One board per desk rather than one shared texture: five canvases is nothing,
// and it buys five boards with their own cards, on their own schedule, instead of
// five identical ones twitching in lockstep.
const KB_TEX_W = 512;
const KB_TEX_H = 290;               // 1.77 : the aspect of the screen plane itself
const KB = {
  pad: 12,                          // board margin
  gap: 9,                           // between columns
  headTop: 34,                      // board title strip, above the columns
  colHead: 28,                      // column title strip, inside a column
  cardH: 44,
  cardGap: 9,
  slots: 4,                         // cards a column holds before it is full
  moveDur: 0.75,                    // seconds for a card to cross
  waitMin: 5,
  waitMax: 13,
  redrawHz: 20,                     // texture uploads while a card is in flight
};
// The columns sit well back from the cards. Read from across the room the board
// is three panels with blocks in them, and the blocks have to be the part that
// carries — a card only reads as moving if it reads as a card first.
const KB_COLORS = {
  bg: '#0d1826',
  title: '#33465c',
  column: '#122031',
  colTitle: '#7f97b2',
  line: '#a8bdd4',
  lineDim: '#6d89a8',
  slot: '#1b2f45',
  key: '#8ba3bd',
};
// Card bodies come in a handful of hues rather than all one blue, so the board is
// a spread of colour at a glance and a moving card is easy to follow across it.
// All at much the same brightness, so it still reads as one surface.
const KB_CARDS = [
  { fill: '#2f5075', edge: '#3d6690' },   // slate blue
  { fill: '#28605f', edge: '#367a78' },   // teal
  { fill: '#4a3f74', edge: '#5e5090' },   // violet
  { fill: '#2f5d43', edge: '#3d7857' },   // green
  { fill: '#6b3a52', edge: '#87496a' },   // rose
  { fill: '#6a4a2b', edge: '#875f38' },   // amber
];
// The editor's palette, so the two screens look like one machine.
const KB_TAGS = ['#6fb1e0', '#7bc47f', '#e0b24f', '#b489e0', '#4fb0b0'];
const KB_TITLES = ['TO DO', 'IN PROGRESS', 'DONE'];

// The Jira mark, taken from Atlassian's own attribution kit (jira_attribution.zip
// on atlassian.design): a rounded square in Jira blue with the glyph knocked out
// in white, and nothing else — no wordmark, which would be a smear at this size.
// Drawn from the artwork's own 75-unit box so it scales without going soft.
const KB_LOGO_BLUE = '#1868db';
const KB_LOGO_BOX = 75;
const KB_LOGO_GLYPH_D = 'M28.0429 48.5103H23.817C17.4434 48.5103 12.8711 44.6064 12.8711 38.89H35.5942C36.772 38.89 37.534 39.7265 37.534 40.9116V63.7773C31.8532 63.7773 28.0429 59.1763 28.0429 52.7628V48.5103ZM39.266 37.1472H35.04C28.6664 37.1472 24.0941 33.313 24.0941 27.5965H46.8172C47.995 27.5965 48.8263 28.3634 48.8263 29.5485V52.4142C43.1455 52.4142 39.266 47.8132 39.266 41.3996V37.1472ZM50.5582 25.8537H46.3323C39.9587 25.8537 35.3864 21.9498 35.3864 16.2334H58.1095C59.2873 16.2334 60.0493 17.0699 60.0493 18.1853V41.0511C54.3685 41.0511 50.5582 36.45 50.5582 30.0365V25.8537Z';
// Path2D exists in a browser but not in the headless probe, which stubs the canvas
// away entirely; there it simply draws no glyph.
const KB_LOGO_GLYPH = typeof Path2D === 'function' ? new Path2D(KB_LOGO_GLYPH_D) : null;

/** Draw the mark with its top-left corner at (x, y), `size` px on a side. */
function kbDrawLogo(ctx, x, y, size) {
  ctx.fillStyle = KB_LOGO_BLUE;
  kbRoundRect(ctx, x, y, size, size, size * 0.25);
  ctx.fill();
  if (!KB_LOGO_GLYPH) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / KB_LOGO_BOX, size / KB_LOGO_BOX);
  ctx.fillStyle = '#ffffff';
  ctx.fill(KB_LOGO_GLYPH);
  ctx.restore();
}

const KB_COL_W = (KB_TEX_W - 2 * KB.pad - 2 * KB.gap) / 3;
const KB_CARD_W = KB_COL_W - 16;
const KB_COL_H = KB_TEX_H - KB.pad - KB.headTop;

/** Top-left corner of the `row`th card slot in column `col`, in texture pixels. */
function kbSlot(col, row) {
  return {
    x: KB.pad + col * (KB_COL_W + KB.gap) + 8,
    y: KB.headTop + KB.colHead + row * (KB.cardH + KB.cardGap),
  };
}

// Issue keys are set dressing, but they are the detail that pays off in
// first-person: sit at a desk and the board has real cards on it.
let _kbNextKey = 100;
function kbCard() {
  return {
    key: `AOP-${_kbNextKey++}`,
    body: pick(KB_CARDS),
    tag: pick(KB_TAGS),
    tagW: between(20, 44),
    // Fractions of the card's text width, so a summary looks written rather than
    // ruled: one long line and a shorter second one.
    lines: [between(0.55, 0.95), between(0.3, 0.7)],
    twoLines: chance(0.7),
  };
}

function kbRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} card
 * @param {number} lift  0 for a card sitting in its column, 1 for one mid-flight
 */
function kbDrawCard(ctx, card, x, y, lift = 0) {
  if (lift > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${0.4 * lift})`;
    kbRoundRect(ctx, x + 2, y + 3 + 4 * lift, KB_CARD_W, KB.cardH, 4);
    ctx.fill();
  }
  ctx.fillStyle = card.body.fill;
  kbRoundRect(ctx, x, y, KB_CARD_W, KB.cardH, 4);
  ctx.fill();
  // A lighter top edge lifts the card off its column without a real shadow.
  ctx.fillStyle = card.body.edge;
  kbRoundRect(ctx, x, y, KB_CARD_W, 2, 1);
  ctx.fill();

  const textW = KB_CARD_W - 16;
  ctx.fillStyle = KB_COLORS.line;
  ctx.fillRect(x + 8, y + 9, textW * card.lines[0], 4);
  if (card.twoLines) {
    ctx.fillStyle = KB_COLORS.lineDim;
    ctx.fillRect(x + 8, y + 17, textW * card.lines[1], 4);
  }

  // Label chip and issue key, along the bottom.
  ctx.fillStyle = card.tag;
  kbRoundRect(ctx, x + 8, y + KB.cardH - 14, card.tagW, 6, 3);
  ctx.fill();
  ctx.fillStyle = KB_COLORS.key;
  ctx.font = '9px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(card.key, x + 14 + card.tagW, y + KB.cardH - 11);
}

/**
 * Repaint the whole board. Cheap enough to do wholesale: one 512×290 canvas, and
 * only while a card is actually moving.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[][]} cols   cards per column, left to right
 * @param {?object} drag      the card in flight, if there is one
 */
function kbDraw(ctx, cols, drag) {
  ctx.fillStyle = KB_COLORS.bg;
  ctx.fillRect(0, 0, KB_TEX_W, KB_TEX_H);

  // The mark, then the board's name and the team's avatars. The name is a bar and
  // the people are dots: at this size real text there would only be legible from
  // inside the chair, and the logo already says what the screen is.
  kbDrawLogo(ctx, KB.pad, 5, 24);
  ctx.fillStyle = KB_COLORS.title;
  ctx.fillRect(KB.pad + 32, 13, 88, 7);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = KB_TAGS[i];
    ctx.beginPath();
    ctx.arc(KB_TEX_W - KB.pad - 8 - i * 18, 17, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let c = 0; c < 3; c++) {
    const cx = KB.pad + c * (KB_COL_W + KB.gap);
    ctx.fillStyle = KB_COLORS.column;
    kbRoundRect(ctx, cx, KB.headTop, KB_COL_W, KB_COL_H, 5);
    ctx.fill();

    ctx.fillStyle = KB_COLORS.colTitle;
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(KB_TITLES[c], cx + 9, KB.headTop + 14);
    // The count includes a card on its way in, so the header does not flicker
    // down and back up as one crosses.
    const n = cols[c].length + (drag && drag.dest === c ? 1 : 0);
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(String(n), cx + KB_COL_W - 15, KB.headTop + 14);

    for (const [row, card] of cols[c].entries()) {
      const s = kbSlot(c, row);
      kbDrawCard(ctx, card, s.x, s.y);
    }
  }

  if (drag) {
    // The gap it is being dropped into, then the card itself on top of it.
    const s = kbSlot(drag.dest, drag.row);
    ctx.fillStyle = KB_COLORS.slot;
    kbRoundRect(ctx, s.x, s.y, KB_CARD_W, KB.cardH, 4);
    ctx.fill();
    kbDrawCard(ctx, drag.card, drag.x, drag.y, 1);
  }
}

/**
 * A board with a life of its own.
 *
 * @returns {{texture: THREE.CanvasTexture, update: (dt: number) => void}}
 */
export function makeKanbanBoard() {
  const canvas = document.createElement('canvas');
  canvas.width = KB_TEX_W;
  canvas.height = KB_TEX_H;
  const ctx = canvas.getContext('2d');

  const cols = [[], [], []];
  for (let i = 0; i < 3; i++) cols[0].push(kbCard());
  for (let i = 0; i < 2; i++) cols[1].push(kbCard());
  for (let i = 0; i < whole(1, 2); i++) cols[2].push(kbCard());

  /** @type {?{card: object, dest: number, row: number, from: object, to: object, t: number, x: number, y: number}} */
  let drag = null;
  // Boards start mid-cycle so the desks are not all moving a card at once.
  let wait = between(1, KB.waitMax);
  let dirty = true;
  let sinceDraw = 1;

  /** Send a card onwards, or clear space so the next one can go. */
  function nextMove() {
    const movable = [0, 1].filter((c) => cols[c].length && cols[c + 1].length < KB.slots);
    if (!movable.length) {
      // Everything downstream is full: retire a finished card instead, which
      // frees the slot the next move needs.
      if (cols[2].length) { cols[2].shift(); dirty = true; }
      return;
    }
    const src = pick(movable);
    const row = Math.floor(Math.random() * cols[src].length);
    const [card] = cols[src].splice(row, 1);
    const dest = src + 1;
    // Taken before the insert, so it is the row the card is heading for. The
    // cards left behind reflow up the moment it is picked up, which is what
    // dragging one actually looks like.
    const destRow = cols[dest].length;
    const from = kbSlot(src, row);
    const to = kbSlot(dest, destRow);
    drag = { card, dest, row: destRow, from, to, t: 0, x: from.x, y: from.y };
    dirty = true;
  }

  function land() {
    cols[drag.dest].push(drag.card);
    // Ship the oldest finished card off the board and top the backlog back up, so
    // the board circulates instead of silting up in Done.
    if (cols[2].length >= KB.slots) cols[2].shift();
    if (cols[0].length < 2) cols[0].push(kbCard());
    drag = null;
    dirty = true;
  }

  kbDraw(ctx, cols, drag);
  dirty = false;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  return {
    texture,

    /**
     * @param {number} dt  seconds; only ticks while the desk is being worked at,
     *   so a dark monitor costs nothing.
     */
    update(dt) {
      if (drag) {
        drag.t += dt;
        const k = Math.min(1, drag.t / KB.moveDur);
        const e = smoothstep(k);
        drag.x = lerp(drag.from.x, drag.to.x, e);
        // Lifted clear of the column on the way across, as if by hand.
        drag.y = lerp(drag.from.y, drag.to.y, e) - Math.sin(Math.PI * k) * 7;
        dirty = true;
        if (k >= 1) land();
      } else {
        wait -= dt;
        if (wait <= 0) { wait = between(KB.waitMin, KB.waitMax); nextMove(); }
      }

      sinceDraw += dt;
      if (dirty && sinceDraw >= 1 / KB.redrawHz) {
        kbDraw(ctx, cols, drag);
        texture.needsUpdate = true;
        dirty = false;
        sinceDraw = 0;
      }
    },
  };
}

