import * as THREE from 'three';
import { box, group, put } from '../build.js';

// ---------------------------------------------------------------------------
// Digital wall clock: red seven-segment digits on a black panel, mounted on the
// beige wall above the coffee machine. Built facing +z; the caller rotates it.
//
// The digits are drawn as literal segment rectangles rather than text so it
// reads as a hardware readout: unlit segments stay faintly visible, the way a
// real LED panel does.

const CLOCK_TEX_W = 512;
const CLOCK_TEX_H = 232;
const SEG_ON = '#ff2f24';
const SEG_OFF = '#3a0c09';

// Which of the seven segments (a..g) light up for each digit.
const DIGIT_SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
  5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

/**
 * Draw one seven-segment digit.
 * @param {string} ch  a single character; anything unmapped draws all-off
 * @param {number} t   segment thickness
 */
function drawSevenSegment(ctx, ch, x, y, w, h, t) {
  const lit = DIGIT_SEGMENTS[ch] ?? '';
  const half = h / 2;
  const vLen = half - t * 1.5;
  const midY = y + half - t / 2;

  // [key, x, y, w, h] for all seven segments.
  const bars = [
    ['a', x + t, y, w - 2 * t, t],
    ['b', x + w - t, y + t, t, vLen],
    ['c', x + w - t, midY + t, t, vLen],
    ['d', x + t, y + h - t, w - 2 * t, t],
    ['e', x, midY + t, t, vLen],
    ['f', x, y + t, t, vLen],
    ['g', x + t, midY, w - 2 * t, t],
  ];

  for (const [key, bx, by, bw, bh] of bars) {
    const on = lit.includes(key);
    ctx.fillStyle = on ? SEG_ON : SEG_OFF;
    ctx.shadowColor = on ? SEG_ON : 'transparent';
    ctx.shadowBlur = on ? 14 : 0;
    ctx.fillRect(bx, by, bw, bh);
  }
  ctx.shadowBlur = 0;
}

export function buildWallClock(spec) {
  const g = group(0, 0, 0);

  const { w, h } = spec;

  // Housing: a black slab with a slim dark bezel, sitting proud of the wall.
  const shell = box(w, h, 0.16, 0x14161a, { rough: 0.55, metal: 0.15 });
  g.add(shell);
  put(g, box(w + 0.14, h + 0.14, 0.1, 0x24282e, { rough: 0.6, metal: 0.2 }), 0, 0, -0.02);

  // --- The readout ---
  const canvas = document.createElement('canvas');
  canvas.width = CLOCK_TEX_W;
  canvas.height = CLOCK_TEX_H;
  const ctx = canvas.getContext('2d');

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const faceMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,          // only the lit segments emit
    emissiveIntensity: 1.7,
    roughness: 0.35,
    metalness: 0.0,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.88, h * 0.74), faceMat);
  face.position.z = 0.085;
  g.add(face);

  // Digit metrics, derived so the four digits + colon fill the panel evenly.
  const dW = 88, dH = 150, dT = 20, gap = 18, colonW = 26;
  const totalW = dW * 4 + gap * 4 + colonW;
  const originX = (CLOCK_TEX_W - totalW) / 2;
  const originY = (CLOCK_TEX_H - dH) / 2;

  let lastKey = null;

  /** Paint HH:MM. `colonOn` blinks the separator once a second. */
  function render(text, colonOn) {
    const key = `${text}|${colonOn}`;
    if (key === lastKey) return;
    lastKey = key;

    ctx.fillStyle = '#0a0b0d';
    ctx.fillRect(0, 0, CLOCK_TEX_W, CLOCK_TEX_H);

    const digits = text.replace(':', '');
    let x = originX;
    for (let i = 0; i < 4; i++) {
      drawSevenSegment(ctx, digits[i] ?? ' ', x, originY, dW, dH, dT);
      x += dW + gap;
      // Colon sits between the hour and minute pairs.
      if (i === 1) {
        const cx = x + colonW / 2 - dT / 2;
        ctx.fillStyle = colonOn ? SEG_ON : SEG_OFF;
        ctx.shadowColor = colonOn ? SEG_ON : 'transparent';
        ctx.shadowBlur = colonOn ? 14 : 0;
        ctx.fillRect(cx, originY + dH * 0.28, dT, dT);
        ctx.fillRect(cx, originY + dH * 0.64, dT, dT);
        ctx.shadowBlur = 0;
        x += colonW + gap;
      }
    }

    tex.needsUpdate = true;
  }

  const handle = {
    id: 'wallClock',
    kind: 'wallClock',
    /** Show a Date (or now). Leading zero is kept so it reads as a real panel. */
    setTime(date = new Date()) {
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      // Blink the colon on the even half of each second.
      render(`${hh}:${mm}`, date.getSeconds() % 2 === 0);
    },
  };
  handle.setTime();

  return { obj: g, handle };
}
