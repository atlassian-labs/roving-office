import * as THREE from 'three';
import { cyl, group, mat } from './build.js';

// A classic library globe for the top of the bookshelf: the room's stand-in for
// the web. It turns slowly whenever something is being looked up, and coasts to a
// stop again afterwards.
//
// The map is drawn into a canvas rather than fetched as an image, so the office
// stays a single self-contained page with no assets to load. The outlines are
// deliberately coarse — on screen this globe is a couple of dozen pixels across,
// and all it has to read as is "land in green, water in blue".

const OCEAN = '#2f6f9e';
const LAND = '#5f9e63';
const COAST = '#3f7d4a';
const GRATICULE = 'rgba(255, 255, 255, 0.09)';

const SPIN_SPEED = 0.5;      // rad/s — about twelve seconds a revolution
const SPIN_SECONDS = 6;      // roughly one look-up: walk over, read, walk back
const EASE = 1.4;            // how briskly it comes up to speed and settles back
const TILT = 23.4 * Math.PI / 180;

// Coastlines as [lon, lat] rings, drawn as filled polygons. Rough by design:
// enough to recognise the shape of the world, not a survey.
const LANDMASSES = [
  // North America, Alaska round to the Pacific coast via Central America.
  [[-168, 65], [-160, 71], [-140, 70], [-120, 71], [-100, 73], [-85, 70], [-75, 68],
   [-60, 60], [-55, 51], [-65, 45], [-70, 42], [-75, 36], [-81, 31], [-80, 26],
   [-85, 30], [-90, 29], [-97, 26], [-95, 19], [-88, 21], [-87, 16], [-83, 9],
   [-78, 8], [-83, 13], [-92, 15], [-100, 17], [-106, 21], [-110, 24], [-114, 28],
   [-117, 32], [-122, 37], [-124, 43], [-125, 48], [-133, 55], [-145, 60],
   [-152, 58], [-162, 59], [-168, 65]],

  // South America.
  [[-81, 8], [-76, 11], [-70, 12], [-62, 10], [-52, 5], [-45, -2], [-35, -6],
   [-38, -13], [-42, -23], [-48, -26], [-58, -35], [-62, -40], [-66, -46],
   [-69, -52], [-74, -53], [-73, -45], [-71, -33], [-70, -18], [-76, -14],
   [-81, -6], [-81, 8]],

  // Africa.
  [[-17, 15], [-10, 28], [0, 36], [10, 37], [20, 32], [32, 31], [35, 23], [38, 18],
   [43, 12], [51, 12], [48, 5], [42, -2], [40, -10], [35, -18], [33, -25],
   [27, -33], [20, -35], [15, -28], [12, -18], [9, -5], [1, 5], [-8, 5],
   [-13, 10], [-17, 15]],

  // Eurasia: Iberia round the Arctic coast, then back along the south through
  // south-east Asia, the Indian peninsula and Arabia — the two shapes that make
  // the southern edge legible at a glance.
  [[-10, 36], [-9, 43], [-2, 48], [3, 51], [7, 54], [10, 57], [5, 60], [12, 65],
   [20, 70], [30, 70], [45, 68], [60, 72], [75, 73], [90, 75], [105, 77],
   [120, 73], [135, 72], [150, 70], [165, 68], [178, 66], [172, 61], [160, 58],
   [150, 46], [140, 42], [135, 35], [122, 30], [118, 22], [108, 18], [105, 10],
   [100, 13], [98, 8], [95, 16], [92, 22], [88, 21], [87, 15], [80, 13],
   [77, 8], [73, 16], [70, 22], [65, 25], [60, 25], [57, 26], [58, 22],
   [55, 17], [52, 14], [45, 13], [43, 18], [40, 21], [37, 25], [35, 29],
   [34, 31], [36, 36], [28, 40], [20, 42], [14, 45], [3, 42], [-5, 36], [-10, 36]],

  // Australia.
  [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19],
   [150, -25], [153, -28], [150, -37], [145, -38], [140, -38], [130, -32],
   [125, -33], [115, -34], [114, -22]],

  // Antarctica, as a band closed off along the bottom edge.
  [[-180, -71], [-150, -76], [-110, -74], [-70, -66], [-40, -71], [-10, -70],
   [20, -70], [60, -67], [100, -66], [140, -67], [170, -72], [180, -71],
   [180, -90], [-180, -90], [-180, -71]],

  // Greenland.
  [[-45, 60], [-30, 68], [-25, 75], [-35, 83], [-55, 82], [-60, 76], [-55, 68], [-45, 60]],

  // Islands worth the four points they cost, for orientation.
  [[-5, 50], [-3, 53], [-5, 57], [-2, 58], [1, 53], [1, 51], [-5, 50]],          // Britain & Ireland
  [[130, 31], [136, 34], [140, 36], [142, 41], [146, 44], [141, 45], [138, 37], [133, 33], [130, 31]], // Japan
  [[43, -12], [50, -15], [50, -25], [45, -25], [43, -16], [43, -12]],            // Madagascar
  [[172, -34], [177, -38], [178, -38], [174, -41], [170, -46], [167, -46], [170, -41], [172, -34]], // New Zealand
  [[95, 5], [100, 2], [106, -6], [102, -6], [97, 0], [95, 5]],                   // Sumatra
  [[109, 2], [115, 5], [119, 4], [117, -3], [110, -4], [109, 2]],                // Borneo
  [[131, -1], [140, -2], [147, -6], [150, -9], [141, -9], [134, -5], [131, -1]], // New Guinea
  [[120, 14], [124, 17], [126, 10], [122, 6], [120, 14]],                        // Philippines
];

let _worldTexture = null;

/**
 * Equirectangular world map, 2:1 so it wraps onto a sphere without maths.
 * Cached across worlds like the other canvas textures in the scene.
 */
function worldTexture() {
  if (_worldTexture) return _worldTexture;

  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const x = (lon) => ((lon + 180) / 360) * W;
  const y = (lat) => ((90 - lat) / 180) * H;

  ctx.fillStyle = OCEAN;
  ctx.fillRect(0, 0, W, H);

  // Faint graticule, which is what makes a plain sphere read as a globe.
  ctx.strokeStyle = GRATICULE;
  ctx.lineWidth = 1.5;
  for (let lon = -180; lon <= 180; lon += 30) {
    ctx.beginPath(); ctx.moveTo(x(lon), 0); ctx.lineTo(x(lon), H); ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath(); ctx.moveTo(0, y(lat)); ctx.lineTo(W, y(lat)); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(W, y(0)); ctx.stroke();   // equator

  ctx.fillStyle = LAND;
  ctx.strokeStyle = COAST;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const ring of LANDMASSES) {
    ctx.beginPath();
    ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(x(lon), y(lat)) : ctx.moveTo(x(lon), y(lat))));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  _worldTexture = new THREE.CanvasTexture(canvas);
  _worldTexture.colorSpace = THREE.SRGBColorSpace;
  _worldTexture.wrapS = THREE.RepeatWrapping;      // so the seam meets itself
  _worldTexture.__shared = true;
  return _worldTexture;
}

/**
 * Build the globe: wooden foot, brass meridian ring, and a tilted world that
 * spins on its own axis.
 *
 * @param {object} [opts]
 * @param {number} [opts.radius]  of the world itself
 * @returns {{obj: THREE.Group, handle: object}}
 */
export function buildGlobe({ radius = 0.6 } = {}) {
  const g = group(0, 0, 0);

  // Stand proportions are all derived from the radius, so the thing stays in
  // proportion at any size rather than growing a world on a doll's-house foot.
  const footH = radius * 0.167;
  const postH = radius * 0.267;
  const foot = cyl(radius * 0.5, radius * 0.633, footH, 0x7a5a38, { segments: 16, rough: 0.65 });
  foot.position.y = footH / 2;
  const post = cyl(radius * 0.093, radius * 0.093, postH, 0xb08d3f, { segments: 10, rough: 0.35, metal: 0.65 });
  post.position.y = footH + postH / 2;
  g.add(foot, post);

  // Ring and world share a holder, so tilting the holder tilts the axis and the
  // meridian ring together, the way a real one is mounted.
  const ringRadius = radius * 1.15;
  const holder = group(0, footH + postH + ringRadius, 0);
  holder.rotation.z = -TILT;
  g.add(holder);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius, radius * 0.053, 8, 44),
    mat(0xb08d3f, { rough: 0.35, metal: 0.65 })
  );
  ring.castShadow = true;
  holder.add(ring);

  // Its own material: the world map is the only thing wearing this texture, and
  // the shared cache is keyed on colour alone.
  const world = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 28, 20),
    new THREE.MeshStandardMaterial({ map: worldTexture(), roughness: 0.55, metalness: 0.05 })
  );
  world.castShadow = true;
  world.receiveShadow = true;
  holder.add(world);

  const handle = {
    id: 'globe',
    kind: 'globe',
    spinning: false,
    _velocity: 0,
    _remaining: 0,

    /**
     * Set it turning, because somebody is looking something up.
     *
     * Repeat calls extend rather than restart, so two agents researching at once
     * keeps it going smoothly instead of making it lurch.
     * @param {number} [seconds]
     */
    spin(seconds = SPIN_SECONDS) {
      this._remaining = Math.max(this._remaining, seconds);
    },

    update(dt) {
      this._remaining = Math.max(0, this._remaining - dt);
      const target = this._remaining > 0 ? SPIN_SPEED : 0;

      // Ease both ways: a weighted globe doesn't snap to speed, and it keeps
      // turning for a moment after you let go of it.
      this._velocity += (target - this._velocity) * Math.min(1, dt * EASE);
      if (this._velocity < 1e-4) {
        this._velocity = 0;
        this.spinning = false;
        return;
      }
      this.spinning = true;
      world.rotation.y += this._velocity * dt;
    },
  };

  return { obj: g, handle };
}
