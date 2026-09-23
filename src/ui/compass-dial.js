// Which way the room faces, as the instrument that answers that question.
//
// This replaced a slider, and the reason is not decoration. A bearing is an angle on
// a circle: 359 and 1 are two degrees apart, and a track laid out in a line puts them
// at opposite ends of it, so the one motion the control most needs to support — keep
// turning — is the one it cannot do. A slider also has to be read before it can be
// understood, where a compass is already known.
//
// It is a compass *card*, the kind that floats in a binnacle rather than the kind
// with a needle that swings on a fixed dial. The card carries the bearings and turns;
// the index at the top does not. So the heading is whatever the card has brought
// round to the top, which is why the number sits in the middle where a card's heading
// is always read, and why north walks away from the top as you turn off it.

import { controlCanvas, hidpiContext, onDrag, themeInk } from './canvas-control.js';

/** Where the card is grabbed: the north arrow's own tip. */
const HANDLE_R = 6;

const CARDINALS = [
  { deg: 0, label: 'N' },
  { deg: 90, label: 'E' },
  { deg: 180, label: 'S' },
  { deg: 270, label: 'W' },
];

/** An angle brought back into 0–359, whichever way round it arrived. */
const wrap = (deg) => ((Math.round(deg) % 360) + 360) % 360;

/**
 * @param {object} opts
 * @param {number} opts.size            css pixels, square
 * @param {(bearing: number) => void} opts.onTurn
 * @returns {{el: HTMLCanvasElement, set: (bearing: number) => void}}
 */
export function createCompassDial({ size = 96, onTurn }) {
  // A slider is what this is, to anything that cannot see it: one value, a range, and
  // arrow keys that move it. The shape on screen is not the part that needs announcing.
  const canvas = controlCanvas({
    className: 'dev-compass',
    role: 'slider',
    label: 'Which way the room faces',
  });
  canvas.setAttribute('aria-valuemin', '0');
  canvas.setAttribute('aria-valuemax', '359');

  let bearing = 0;

  /**
   * Screen angle of a bearing on the card, in radians, 0 = up and clockwise.
   *
   * The card turns *under* a fixed index, so a heading of 90 brings 90 to the top and
   * takes north round to the left — the minus is the whole of that behaviour.
   */
  const screenAngle = (deg) => (deg - bearing) * Math.PI / 180;

  /** Where a bearing sits on the face, `r` out from the middle. */
  function point(deg, r, c) {
    const a = screenAngle(deg);
    return [c + Math.sin(a) * r, c - Math.cos(a) * r];
  }

  function paint() {
    const ctx = hidpiContext(canvas, size, size);
    const [ink, muted] = themeInk('--text', '--muted');

    const c = size / 2;
    const r = c - 9;
    ctx.clearRect(0, 0, size, size);

    // The face.
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(36,50,71,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(36,50,71,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Ticks every fifteen degrees, longer on the quarters. They belong to the card, so
    // they turn with it — a compass whose ticks stayed put would be a dial, and would
    // say nothing about which way anything is pointing.
    for (let deg = 0; deg < 360; deg += 15) {
      const quarter = deg % 90 === 0;
      const [x1, y1] = point(deg, r - (quarter ? 7 : 4), c);
      const [x2, y2] = point(deg, r - 1, c);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = quarter ? 'rgba(36,50,71,0.34)' : 'rgba(36,50,71,0.14)';
      ctx.lineWidth = quarter ? 1.5 : 1;
      ctx.stroke();
    }

    // E, S and W ride the card. North does not get a letter, because it has an arrow.
    ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = muted;
    for (const { deg, label } of CARDINALS) {
      if (deg === 0) continue;
      const [x, y] = point(deg, r - 14, c);
      ctx.fillText(label, x, y);
    }

    // The index: what the heading is read against, and the only part that never moves.
    ctx.beginPath();
    ctx.moveTo(c, 1.5);
    ctx.lineTo(c - 4.5, -5.5 + 12);
    ctx.lineTo(c + 4.5, -5.5 + 12);
    ctx.closePath();
    ctx.fillStyle = muted;
    ctx.fill();

    // North: red, because every compass in the world has agreed on that, and drawn as
    // an arrow rather than a letter so it reads at a glance and at this size.
    const [nx, ny] = point(0, r - 5, c);
    const a = screenAngle(0);
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 4);
    ctx.lineTo(0, 1.5);
    ctx.lineTo(-4.5, 4);
    ctx.closePath();
    ctx.fillStyle = '#d2513c';
    ctx.fill();
    ctx.restore();

    // Its shaft, back to the middle, so the arrow reads as pointing rather than
    // floating.
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = 'rgba(210,81,60,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // The handle, on the arrow, because that is the part of a card you turn.
    ctx.beginPath();
    ctx.arc(nx, ny, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(210,81,60,0.22)';
    ctx.fill();
    ctx.strokeStyle = '#d2513c';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // The heading, read where a card's heading is read.
    //
    // The digits are centred and the degree sign hung off the end of them, rather than
    // centring the pair. A ° is a light, high, half-width mark, so including it in the
    // measurement drags the number bodily to the left and the dial looks off its own
    // axis — worst at "0°", where one digit is balancing one symbol. Centre the weight,
    // then add the sign.
    ctx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = ink;
    const digits = `${bearing}`;
    ctx.textAlign = 'center';
    ctx.fillText(digits, c, c + 0.5);
    ctx.textAlign = 'left';
    ctx.fillStyle = muted;
    ctx.fillText('°', c + ctx.measureText(digits).width / 2, c + 0.5);
    ctx.textAlign = 'center';
  }

  /** The bearing that would put the card where the pointer is. */
  function bearingAt(ev) {
    const box = canvas.getBoundingClientRect();
    const dx = ev.clientX - (box.left + box.width / 2);
    const dy = ev.clientY - (box.top + box.height / 2);
    // Screen angle of the pointer, clockwise from up. Dragging *north* to there means
    // the card has turned the other way by the same amount, hence the negation.
    const theta = Math.atan2(dx, -dy) * 180 / Math.PI;
    return wrap(-theta);
  }

  // Anywhere on the face turns it. The handle says where to grab, but insisting on
  // it would make a 96-pixel control into a 12-pixel one.
  onDrag(canvas, (ev) => onTurn?.(bearingAt(ev)));

  canvas.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 10 : 1;
    const by = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[ev.key];
    if (by === undefined) return;
    ev.preventDefault();
    onTurn?.(wrap(bearing + by));
  });

  paint();

  return {
    el: canvas,
    set(deg) {
      bearing = wrap(deg ?? 0);
      canvas.setAttribute('aria-valuenow', String(bearing));
      canvas.setAttribute('aria-valuetext', `${bearing} degrees`);
      paint();
    },
  };
}
