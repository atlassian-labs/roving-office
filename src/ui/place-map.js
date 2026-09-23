// A place on earth, picked by pointing at it.
//
// What this draws is a *sun* map rather than a world map, and the distinction is
// deliberate rather than a shortfall admitted late. The office has no build step, no
// dependencies and no network — three.js is vendored and everything else is written
// out — so there is no coastline data here to draw and none that could be fetched. A
// map with invented coastlines would be worse than none: it would look authoritative
// and be wrong.
//
// So it draws the lines that actually decide the light. Latitude is very nearly the
// whole of what bends a sun — how high it climbs, how long it stays up, which way it
// goes round — and the four latitudes that name the change are the tropics and the
// polar circles. Those are drawn and labelled, the equator with them, and a pin
// dropped anywhere reads out its own coordinates. The named places do the rest of the
// work a coastline would have done: they are how somebody finds London without one.

import { controlCanvas, hidpiContext, onDrag, themeInk } from './canvas-control.js';

/** Equirectangular, so the whole world is one rectangle twice as wide as it is tall. */
const ASPECT = 2;

const RAD = Math.PI / 180;

/**
 * Near enough to an equinox that the terminator is a straight line rather than a
 * curve, and `tan δ` is on its way to infinity. Below this the sine shape is drawn as
 * the vertical it has become.
 */
const FLAT_DECLINATION = 0.05;

/** The latitudes worth drawing, because each one is a change in what the sun does. */
const PARALLELS = [
  { lat: 66.56, label: 'Arctic', dashed: true },
  { lat: 23.44, label: 'Cancer', dashed: true },
  { lat: 0, label: 'Equator', dashed: false },
  { lat: -23.44, label: 'Capricorn', dashed: true },
  { lat: -66.56, label: 'Antarctic', dashed: true },
];

/**
 * The land, as coarsely as it can be drawn and still be recognised.
 *
 * Schematic, and openly so: these are outlines traced through the headlands and
 * river mouths that give a coast its shape — the Cape, the Horn, the Gulf, Cape
 * York — not a survey. At 232 pixels the whole world is a degree and a half to the
 * pixel, so a point three degrees out is two pixels out, and the eye is looking for
 * "that is Africa" rather than for a border.
 *
 * They are stroked rather than filled. A filled continent would compete with the
 * night shading, which is the thing on this map that actually carries information;
 * an outline just tells you where you are pointing.
 *
 * Longitude first, then latitude — the same order as the x and y they become.
 */
const LAND = [
  // Africa, from Gibraltar round the east coast to the Cape and back up the west.
  [[-5, 36], [10, 37], [20, 32], [32, 31], [35, 28], [38, 22], [43, 12], [51, 12],
    [45, 5], [41, -2], [40, -10], [40, -16], [35, -24], [32, -29], [25, -34], [18, -34],
    [15, -26], [12, -17], [13, -8], [9, -1], [5, 4], [0, 5], [-8, 5], [-13, 9],
    [-17, 15], [-16, 21], [-13, 28], [-9, 32], [-5, 36]],
  // Eurasia. The Mediterranean is a notch rather than a sea, and the Black and
  // Caspian are left out entirely: at this scale they are three pixels of coastline
  // that cost twenty points to describe.
  [[-9, 43], [-2, 44], [-4, 48], [2, 51], [4, 53], [8, 55], [10, 58], [5, 62],
    [12, 68], [26, 71], [40, 68], [60, 70], [75, 72], [90, 75], [105, 77], [130, 73],
    [150, 70], [170, 68], [180, 66], [180, 62], [170, 60], [162, 56], [155, 50],
    [140, 45], [132, 43], [126, 38], [122, 31], [110, 20], [105, 9], [100, 6],
    [98, 12], [95, 17], [90, 22], [80, 10], [77, 8], [73, 19], [67, 25], [57, 25],
    [51, 27], [48, 30], [45, 13], [43, 12], [39, 21], [35, 28], [34, 31], [36, 36],
    [30, 37], [26, 40], [19, 42], [13, 45], [12, 42], [16, 38], [12, 37], [8, 44],
    [3, 43], [-2, 43], [-9, 43]],
  // North America.
  [[-168, 66], [-160, 71], [-140, 70], [-125, 70], [-100, 69], [-85, 70], [-75, 73],
    [-65, 60], [-60, 55], [-53, 47], [-65, 45], [-70, 42], [-75, 37], [-81, 25],
    [-84, 30], [-90, 29], [-97, 26], [-95, 18], [-92, 15], [-84, 10], [-79, 9],
    [-90, 14], [-96, 16], [-105, 20], [-110, 23], [-114, 31], [-117, 33], [-122, 37],
    [-124, 44], [-125, 49], [-133, 57], [-150, 60], [-165, 63], [-168, 66]],
  // South America.
  [[-79, 9], [-72, 12], [-62, 10], [-52, 5], [-44, -2], [-38, -5], [-35, -8],
    [-39, -13], [-43, -23], [-48, -28], [-58, -35], [-62, -40], [-65, -45], [-68, -52],
    [-67, -56], [-75, -50], [-74, -44], [-73, -37], [-71, -30], [-70, -20], [-76, -14],
    [-81, -6], [-80, 0], [-78, 6], [-79, 9]],
  // Australia.
  [[113, -22], [115, -32], [118, -35], [126, -32], [135, -35], [138, -35], [141, -38],
    [145, -38], [150, -37], [153, -28], [149, -21], [146, -19], [143, -11], [137, -12],
    [131, -12], [126, -14], [122, -17], [117, -20], [113, -22]],
  // Antarctica, closed along the bottom of the map so it reads as a continent rather
  // than a stray line across the last few rows.
  [[-180, -72], [-150, -75], [-120, -73], [-90, -73], [-60, -63], [-45, -78],
    [-20, -71], [10, -70], [40, -68], [70, -67], [100, -66], [130, -66], [160, -70],
    [170, -78], [180, -78], [180, -88], [-180, -88], [-180, -72]],
  // Greenland.
  [[-45, 60], [-52, 65], [-55, 70], [-60, 76], [-50, 82], [-30, 83], [-22, 73],
    [-25, 68], [-42, 61], [-45, 60]],
  // The islands that are landmarks rather than land: each one is somewhere people
  // look for when finding themselves on a map this small.
  [[-22, 66], [-14, 66], [-14, 64], [-22, 64], [-22, 66]],                    // Iceland
  [[-5, 58], [-2, 57], [0, 53], [1, 51], [-5, 50], [-5, 53], [-6, 55], [-5, 58]], // Britain
  [[-10, 54], [-6, 55], [-6, 52], [-10, 52], [-10, 54]],                      // Ireland
  [[142, 45], [145, 43], [141, 38], [140, 35], [135, 34], [131, 31], [130, 33],
    [136, 37], [140, 40], [142, 45]],                                          // Japan
  [[49, -12], [50, -16], [47, -25], [44, -22], [44, -16], [49, -12]],          // Madagascar
  [[95, 6], [106, -6], [104, -6], [98, 2], [95, 6]],                           // Sumatra
  [[105, -6], [114, -8], [114, -9], [105, -7]],                                // Java
  [[109, 2], [117, 4], [119, -1], [114, -4], [109, -3], [109, 2]],             // Borneo
  [[131, -1], [141, -3], [150, -10], [143, -9], [134, -8], [131, -1]],         // New Guinea
  [[121, 18], [124, 13], [126, 7], [122, 6], [120, 13], [121, 18]],            // Philippines
  [[173, -35], [178, -38], [174, -41], [171, -44], [168, -47], [167, -45],
    [172, -41], [173, -35]],                                                   // New Zealand
];

/**
 * Somewhere to put an office, and the coordinates to put it there.
 *
 * A short list on purpose: it is a way of finding a latitude quickly, not a gazetteer.
 * The spread matters more than the count — both hemispheres, the tropics, and one
 * inside the Arctic circle, so that the polar cases are one click away rather than
 * something you have to know to go looking for.
 */
export const PLACES = [
  { name: 'Sydney', lat: -33.87, lon: 151.21 },
  { name: 'San Francisco', lat: 37.77, lon: -122.42 },
  { name: 'Austin', lat: 30.27, lon: -97.74 },
  { name: 'New York', lat: 40.71, lon: -74.01 },
  { name: 'London', lat: 51.51, lon: -0.13 },
  { name: 'Amsterdam', lat: 52.37, lon: 4.90 },
  { name: 'Gdańsk', lat: 54.35, lon: 18.65 },
  { name: 'Bengaluru', lat: 12.97, lon: 77.59 },
  { name: 'Manila', lat: 14.60, lon: 120.98 },
  { name: 'Tokyo', lat: 35.68, lon: 139.77 },
  { name: 'São Paulo', lat: -23.55, lon: -46.63 },
  { name: 'Reykjavík', lat: 64.15, lon: -21.94 },
];

/**
 * Which side of the equator a place is on: 1 for the north, −1 for the south.
 *
 * A room that has not been put anywhere counts as northern, because that is what the
 * rest of the office assumes of it — the authored arc, and the declination the map
 * shades its night with, both read an absent latitude as zero.
 *
 * Exported because one thing depends on it beyond the sun's own arithmetic: crossing
 * the equator turns the room (see `applyPlace` in main.js), and a rule about where
 * the office *is* belongs next to the other things that know what a place is.
 */
export function hemisphereOf(lat) {
  return Number.isFinite(lat) && lat < 0 ? -1 : 1;
}

/**
 * A coordinate in the form people write them: 51.5°N, 0.1°W.
 *
 * One decimal, which is eleven kilometres and still finer than the sun can tell
 * apart — a tenth of a degree of latitude moves sunset by a few seconds. Two
 * decimals read as more exact and cost four characters, and the line this shares
 * with a day length has 232 pixels: at two decimals a pin dragged out to 170°W
 * during a midnight sun overran them and was cut off at the edge of the panel.
 */
export function formatPlace(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'Nowhere in particular';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

/**
 * The map itself.
 *
 * @param {object} opts
 * @param {number} opts.width            css pixels; height follows the aspect
 * @param {(lat: number, lon: number) => void} opts.onPick
 * @returns {{el: HTMLCanvasElement, set: (lat: ?number, lon: ?number) => void}}
 */
export function createPlaceMap({ width = 232, onPick }) {
  const height = Math.round(width / ASPECT);
  const canvas = controlCanvas({
    className: 'dev-map',
    role: 'button',
    label: 'Where on earth this office is',
  });

  /** @type {?{lat: number, lon: number}} */
  let pin = null;
  /** @type {{hours: number, declination: number, lon: number}} where the sun is now. */
  let sky = { hours: 12, declination: 0, lon: 0 };

  const xOf = (lon) => ((lon + 180) / 360) * width;
  const yOf = (lat) => ((90 - lat) / 180) * height;
  const lonOf = (x) => (x / width) * 360 - 180;
  const latOf = (y) => 90 - (y / height) * 180;

  /**
   * The night half of the world, as it stands at this moment.
   *
   * Flattened onto a rectangle, the edge between day and night is very nearly a sine
   * wave — the projection of a great circle — and it is the single most legible thing
   * a map of this size can say. Where the pin sits inside it, the office is in the
   * dark, and scrubbing the clock walks the band across the map.
   *
   * The curve comes from the terminator's own identity, `tan φ = −cos(λ − λ₀) / tan δ`:
   * for every column, the latitude at which the sun is exactly on the horizon. Which
   * side of it is night is decided by the poles, since exactly one of them is in
   * daylight whenever the sun is off the equator — and at an equinox, when neither is,
   * the curve straightens into the pair of meridians handled above.
   */
  function paintNight(ctx) {
    const dec = sky.declination;
    // Where the sun is overhead: the office's own longitude, walked round by however
    // far the clock is from its local noon. Fifteen degrees an hour, the way the
    // earth turns.
    const subsolar = sky.lon + (12 - sky.hours) * 15;

    ctx.save();
    ctx.beginPath();
    if (Math.abs(dec) < FLAT_DECLINATION) {
      // An equinox: night is simply the half of the world facing away from the sun.
      for (let x = 0; x <= width; x++) {
        const H = lonOf(x) - subsolar;
        if (Math.cos(H * RAD) < 0) ctx.rect(x, 0, 1, height);
      }
    } else {
      // The lit pole tells us which way up the shading goes.
      const northIsDay = dec > 0;
      ctx.moveTo(0, northIsDay ? height : 0);
      for (let x = 0; x <= width; x++) {
        const H = (lonOf(x) - subsolar) * RAD;
        const lat = Math.atan(-Math.cos(H) / Math.tan(dec * RAD)) / RAD;
        ctx.lineTo(x, yOf(lat));
      }
      ctx.lineTo(width, northIsDay ? height : 0);
      ctx.closePath();
    }
    // Dark enough that the two halves are told apart at a glance, which is the whole
    // job, and no darker: it is the background of a picker, not the subject of it.
    ctx.fillStyle = 'rgba(50,73,105,0.18)';
    ctx.fill();
    ctx.restore();
  }

  function paint() {
    const ctx = hidpiContext(canvas, width, height);
    const [ink, muted, accent] = themeInk('--text', '--muted', '--brand');

    ctx.clearRect(0, 0, width, height);
    // The lit half of the world, which everything else is drawn over.
    ctx.fillStyle = 'rgba(36,50,71,0.10)';
    ctx.fillRect(0, 0, width, height);

    // Under everything else: the graticule and the pin have to stay readable across it.
    paintNight(ctx);

    // The land, over the night so a dark continent still shows its shape.
    ctx.strokeStyle = 'rgba(36,50,71,0.30)';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    for (const shape of LAND) {
      ctx.beginPath();
      shape.forEach(([lon, lat], i) => {
        const x = xOf(lon);
        const y = yOf(lat);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // The graticule: every thirty degrees, quiet enough to read as paper ruling.
    ctx.strokeStyle = 'rgba(36,50,71,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lon = -150; lon < 180; lon += 30) {
      ctx.moveTo(Math.round(xOf(lon)) + 0.5, 0);
      ctx.lineTo(Math.round(xOf(lon)) + 0.5, height);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.moveTo(0, Math.round(yOf(lat)) + 0.5);
      ctx.lineTo(width, Math.round(yOf(lat)) + 0.5);
    }
    ctx.stroke();

    // The parallels that mean something, which is the whole reason this is a picture
    // and not two number fields.
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'bottom';
    for (const { lat, label, dashed } of PARALLELS) {
      const y = Math.round(yOf(lat)) + 0.5;
      ctx.setLineDash(dashed ? [3, 3] : []);
      ctx.strokeStyle = dashed ? 'rgba(36,50,71,0.20)' : 'rgba(36,50,71,0.34)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = muted;
      ctx.fillText(label, 3, y - 1.5);
    }

    // The places, as dots. Unlabelled — a dozen names at this size is a smudge — and
    // named by the picker beside the map instead.
    ctx.fillStyle = 'rgba(36,50,71,0.30)';
    for (const p of PLACES) {
      ctx.beginPath();
      ctx.arc(xOf(p.lon), yOf(p.lat), 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (pin) {
      const x = xOf(pin.lon);
      const y = yOf(pin.lat);
      // Crosshair first, so the dot sits on top of its own lines rather than under.
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, height);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ink;
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(36,50,71,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }

  /** Where a pointer event landed, in degrees, clamped to the world it is over. */
  function pointAt(ev) {
    const box = canvas.getBoundingClientRect();
    const x = Math.min(box.width, Math.max(0, ev.clientX - box.left));
    const y = Math.min(box.height, Math.max(0, ev.clientY - box.top));
    return {
      lat: Math.min(90, Math.max(-90, latOf((y / box.height) * height))),
      lon: Math.min(180, Math.max(-180, lonOf((x / box.width) * width))),
    };
  }

  onDrag(canvas, (ev) => {
    const { lat, lon } = pointAt(ev);
    onPick?.(lat, lon);
  });

  // Arrow keys nudge a degree at a time, which is the only way to hit a latitude
  // exactly on a map two hundred pixels wide.
  canvas.addEventListener('keydown', (ev) => {
    if (!pin) return;
    const step = ev.shiftKey ? 10 : 1;
    const moves = {
      ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step],
    };
    const move = moves[ev.key];
    if (!move) return;
    ev.preventDefault();
    onPick?.(
      Math.min(90, Math.max(-90, pin.lat + move[0])),
      ((pin.lon + move[1] + 180 + 360) % 360) - 180,
    );
  });

  paint();

  return {
    el: canvas,
    /** Move the pin, or take it off the map entirely with nulls. */
    set(lat, lon) {
      pin = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      paint();
    },

    /**
     * Move the night round, as the clock and the season move it.
     *
     * Called on the panel's repaint tick, so it has to be cheap to call and cheaper to
     * ignore: the terminator crawls a quarter of a degree a minute, and redrawing the
     * map eight times a second to show that would be eight times as much work as the
     * picture deserves. A tenth of a degree is below what a 232-pixel map can draw.
     */
    setSky({ hours, declination, lon }) {
      const next = { hours, declination, lon: lon ?? 0 };
      const moved = Math.abs((next.hours - sky.hours) * 15) > 0.1
        || Math.abs(next.declination - sky.declination) > 0.1
        || Math.abs(next.lon - sky.lon) > 0.1;
      sky = next;
      if (moved) paint();
    },
  };
}
