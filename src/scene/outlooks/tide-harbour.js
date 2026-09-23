// A legible waterfront: water, one office quay, an approach bridge and a town-side
// promenade. All ripples and reflected streaks are baked once, not animated.
import * as THREE from 'three';
import { DOOR, STREET_Y } from '../../config.js';
import { box, group, put } from '../build.js';
import { markNightLight } from '../night-lights.js';
import { seeded } from './streetscape.js';

const WATER_Y = STREET_Y - .31, QUAY_Y = STREET_Y + .025;
// The town sits on a slightly raised bank. Its paving caps are above the soil,
// while the bridge lands nearly flush with the promenade.
const MAINLAND_Y = QUAY_Y + .08, PROMENADE_Y = MAINLAND_Y + .06;
const SEA = { summer: 0x659eaf, spring: 0x71a8b5, autumn: 0x789ca8, winter: 0x8aa6b1 };
const INK = 0x304e5b;

function waterTexture(season) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const c = canvas.getContext('2d'), rand = seeded(20510);
  c.fillStyle = `#${SEA[season].toString(16)}`; c.fillRect(0, 0, 1024, 1024);
  // Broad, almost imperceptible bands carry the open-water read at normal zoom.
  for (let i = 0; i < 160; i++) {
    c.fillStyle = `rgba(220,243,247,${.01 + rand() * .04})`;
    c.fillRect(0, rand() * 1024, 1024, 2 + rand() * 5);
  }
  for (let i = 0; i < 3200; i++) {
    c.strokeStyle = i % 4 ? `rgba(218,241,243,${.05 + rand() * .11})` : 'rgba(47,99,119,.09)';
    c.lineWidth = .6 + rand() * 1.2; c.beginPath();
    const x = rand() * 1024, y = rand() * 1024, w = 2 + rand() * 16;
    c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, y - 1.6, x + w, y); c.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2.8, 2.8); texture.anisotropy = 4;
  return texture;
}

// A few shared instance batches carry the whole settlement and fleet. Adding
// another hull, window or roof changes an instance buffer, not a draw call.
function batches(parent) {
  const types = new Map(), dummy = new THREE.Object3D();
  function define(name, geometry, material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .88 })) {
    types.set(name, { geometry, material, entries: [] });
  }
  define('details', new THREE.BoxGeometry(1, 1, 1));
  define('buildings', new THREE.BoxGeometry(1, 1, 1));
  define('walkways', new THREE.BoxGeometry(1, 1, 1));
  define('seawall', new THREE.BoxGeometry(1, 1, 1));
  define('spars', new THREE.CylinderGeometry(1, 1, 1, 6));
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-.5, 0); roofShape.lineTo(0, 1); roofShape.lineTo(.5, 0); roofShape.closePath();
  const roof = new THREE.ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: false });
  roof.translate(0, 0, -.5); define('roofs', roof);
  const glass = new THREE.MeshStandardMaterial({ color: 0xb5cdd0, roughness: .45, emissive: 0xffd5a1 });
  define('windows', new THREE.BoxGeometry(1, 1, 1), glass);
  const outline = new THREE.Shape();
  outline.moveTo(-1.2, -3); outline.lineTo(-1.62, -.9); outline.lineTo(-1.44, 1.8);
  outline.quadraticCurveTo(-1, 3.3, 0, 4.35); outline.quadraticCurveTo(1, 3.3, 1.44, 1.8);
  outline.lineTo(1.62, -.9); outline.lineTo(1.2, -3); outline.closePath();
  define('hulls', new THREE.ExtrudeGeometry(outline, { depth: .74, bevelEnabled: true,
    bevelThickness: .1, bevelSize: .1, bevelSegments: 1, steps: 1, curveSegments: 5 }));
  define('decks', new THREE.ShapeGeometry(outline, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, side: THREE.DoubleSide }));
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 9.5, .63, 0, 2.35, .63, .18, 2.35, -2.65], 3));
  sail.computeVertexNormals();
  define('sails', sail, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95, side: THREE.DoubleSide }));
  define('rocks', new THREE.IcosahedronGeometry(1, 0));
  define('pine-crowns', new THREE.ConeGeometry(1, 1, 7));
  define('shrubs', new THREE.IcosahedronGeometry(1, 1));
  function add(name, position, scale, colour, rotation = [0, 0, 0], frame) {
    dummy.position.set(...position); dummy.rotation.set(...rotation); dummy.scale.set(...scale); dummy.updateMatrix();
    const matrix = dummy.matrix.clone();
    if (frame) matrix.premultiply(frame);
    types.get(name).entries.push({ matrix, colour });
  }
  function line(from, to, radius, colour, frame) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    dummy.position.copy(a.add(b).multiplyScalar(.5));
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    dummy.scale.set(radius, delta.length(), radius); dummy.updateMatrix();
    const matrix = dummy.matrix.clone();
    if (frame) matrix.premultiply(frame);
    types.get('spars').entries.push({ matrix, colour });
  }
  function flush() {
    for (const [name, { geometry, material, entries }] of types) {
      if (!entries.length) { geometry.dispose(); material.dispose(); continue; }
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      mesh.name = `harbour-${name}`;
      entries.forEach(({ matrix, colour }, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, new THREE.Color(colour)); });
      mesh.receiveShadow = name !== 'windows';
      mesh.castShadow = ['buildings', 'roofs', 'hulls', 'sails'].includes(name);
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); parent.add(mesh);
      if (name === 'windows') markNightLight(mesh, { emissive: [material], emissiveIntensity: .55 });
    }
  }
  return { add, line, flush };
}

// The middle is a working quay, with a straight and unbroken bridge landing.
// Either side opens into coves and headlands. The land continues behind the town
// and beyond the camera's far plane instead of ending as an island-sized slab.
const COAST = [
  [-1000, 120], [-360, 70], [-245, 28], [-205, 4], [-170, 7], [-142, 15],
  [-119, -3], [-96, -15], [-76, -21], [-59, -29], [62, -29],
  [79, -22], [94, -11], [112, -8], [133, -18], [153, -31],
  [180, -27], [207, -3], [246, 27], [335, 65], [1000, 160],
];
function shoreAt(x) {
  for (let i = 1; i < COAST.length; i++) {
    const [ax, az] = COAST[i - 1], [bx, bz] = COAST[i];
    if (x <= bx) {
      const t = Math.max(0, (x - ax) / (bx - ax));
      // Smooth headland transitions, but never overshoot into a moored boat.
      const u = t * t * (3 - 2 * t);
      return az + (bz - az) * u;
    }
  }
  return COAST.at(-1)[1];
}
function coastline() {
  const points = [];
  for (let i = 1; i < COAST.length; i++) {
    const a = COAST[i - 1], b = COAST[i];
    const count = Math.max(2, Math.ceil((b[0] - a[0]) / 5));
    for (let j = 0; j < count; j++) {
      const x = a[0] + (b[0] - a[0]) * j / count;
      points.push([x, shoreAt(x)]);
    }
  }
  points.push(COAST.at(-1));
  return points;
}
function surface(parent, name, points, y, colour) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => { if (i) shape.lineTo(x, -z); else shape.moveTo(x, -z); });
  shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: colour, roughness: .98 }));
  mesh.name = name; mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}
function shoreRibbon(parent, name, points, offset, width, y, colour) {
  return surface(parent, name, [...points.map(([x, z]) => [x, z - offset]),
    ...points.toReversed().map(([x, z]) => [x, z - offset - width])], y, colour);
}

function timberDeck(b, x, z, w, d) {
  b.add('walkways', [x, QUAY_Y + .085, z], [w, .17, d], 0xa89b80);
  const count = Math.floor(d / .4);
  for (let i = 0; i < count; i++) {
    b.add('details', [x, QUAY_Y + .18, z - d / 2 + (i + .5) * d / count], [w - .04, .016, .018], 0x817b6c);
  }
}

function boat(b, x, z, scale = 1, angle = 0, kind = 'sail', colour = 0xe8e5d7) {
  const frame = new THREE.Object3D();
  frame.position.set(x, WATER_Y + .04, z); frame.rotation.y = angle; frame.scale.setScalar(scale); frame.updateMatrix();
  const add = (name, position, size, tint, rotation) => b.add(name, position, size, tint, rotation, frame.matrix);
  const line = (a, c, r, tint) => b.line(a, c, r, tint, frame.matrix);
  add('hulls', [0, .62, 0], [1, 1, 1], colour, [Math.PI / 2, 0, 0]);
  add('decks', [0, .75, 0], [.89, .89, .89], 0xc3b79a, [Math.PI / 2, 0, 0]);
  if (kind === 'dinghy') {
    for (const benchZ of [-1.2, .6, 2]) add('details', [0, .82, benchZ], [benchZ > 1 ? 1.8 : 2.2, .14, .38], 0x8b7660);
    line([-1.2, .9, -1.7], [1.6, .9, 2.2], .05, 0xa58460);
    return;
  }
  const fishing = kind === 'fishing';
  add('details', [0, fishing ? 1.35 : 1.02, -.38], [1.75, fishing ? 1.35 : .66, 2.1], colour);
  add('details', [0, fishing ? 1.97 : 1.39, -.32], [1.78, .28, 1.75], INK);
  add('details', [0, fishing ? 2.18 : 1.6, -.32], [1.91, .13, 2], 0xe8e7d9);
  if (kind === 'sail') {
    line([0, .7, .6], [0, 9.8, .6], .046, INK);
    line([0, 2.2, .6], [0, 2.2, -2.7], .04, INK);
    add('sails', [0, 0, 0], [1, 1, 1], 0xe9e4cf);
  } else {
    line([0, 1.5, -.8], [0, fishing ? 5.2 : 3, -.8], .035, INK);
    if (fishing) {
      line([-1.2, 1, 1.3], [-1.2, 3.4, 1.3], .055, INK);
      line([1.2, 1, 1.3], [1.2, 3.4, 1.3], .055, INK);
      line([-1.2, 3.4, 1.3], [1.2, 3.4, 1.3], .055, INK);
      add('details', [0, 1.1, 1.6], [1.4, .5, 1.2], 0x788a76);
    }
  }
}

function harbourBuilding(b, x, z, w, d, h, colour, angle = 0) {
  const frame = new THREE.Object3D(); frame.position.set(x, MAINLAND_Y - .01, z); frame.rotation.y = angle; frame.updateMatrix();
  const add = (name, position, size, tint, rotation) => b.add(name, position, size, tint, rotation, frame.matrix);
  add('buildings', [0, h / 2, 0], [w, h, d], colour);
  add('roofs', [0, h, 0], [w + .6, w * .25, d + .6], 0x526572);
  add('details', [0, h - .08, 0], [w + .14, .18, d + .14], 0xdad6c5);
  add('details', [w * .24, h + w * .19, -d * .2], [.6, 1.65, .65], 0x6d625a);
  const rows = h > 6 ? 2 : 1;
  for (let row = 0; row < rows; row++) for (let col = 0; col < 4; col++) {
    if (!row && (col === 1 || col === 2)) continue;
    add('windows', [(col - 1.5) * (w - 2.4) / 4, rows === 1 ? h * .57 : h * (.3 + row * .4), d / 2 + .04], [1.22, 1.4, .06], 0xffffff);
  }
  for (const side of [-1, 1]) for (let col = 0; col < 3; col++) {
    add('windows', [side * (w / 2 + .04), h * .6, (col - 1) * d * .27], [.06, 1.3, 1.1], 0xffffff);
  }
  add('details', [0, 1.33, d / 2 + .035], [2.1, 2.65, .09], INK);
}

export function buildTideHarbour(parent, season = 'summer') {
  const g = group(); g.name = 'tide-harbour'; parent.add(g);
  const b = batches(g), rand = seeded(20511);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ map: waterTexture(season), roughness: .3, metalness: .12 }));
  water.material.map.repeat.set(28, 28);
  water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.name = 'harbour-water';
  // No reflection camera, transparency, simulation or extra draw pass.
  water.receiveShadow = true; g.add(water);

  const stone = season === 'winter' ? 0xc1cccf : 0xb9bdb3;
  put(g, box(35, .68, 32, 0x8d9c9f, { cast: false }), 13.5, QUAY_Y - .34, 9).name = 'harbour-office-quay';
  put(g, box(34.9, .06, 31.9, stone, { cast: false }), 13.5, QUAY_Y + .03, 9);
  const coast = coastline();
  surface(g, 'harbour-mainland', [...coast, [1000, -1200], [-1000, -1200]], MAINLAND_Y, season === 'winter' ? 0xb3c0b9 : 0x87998b);
  shoreRibbon(g, 'harbour-promenade', coast, 0, 5.8, PROMENADE_Y, 0xcdcbbc);
  shoreRibbon(g, 'harbour-coastal-lane', coast, 6.8, 5.8, MAINLAND_Y + .015, 0x89969a);
  shoreRibbon(g, 'harbour-inland-lane', coast, 31, 4.8, MAINLAND_Y + .025, 0xa7b0a0);
  // Solid retaining stones follow the coast. Local instance bounds keep each
  // short piece on its actual shore, rather than enclosing the whole bay.
  const wallBottom = WATER_Y - .2, wallTop = PROMENADE_Y - .012;
  for (let i = 1; i < coast.length; i++) {
    const [ax, az] = coast[i - 1], [bx, bz] = coast[i];
    const dx = bx - ax, dz = bz - az;
    b.add('seawall', [(ax + bx) / 2, (wallTop + wallBottom) / 2, (az + bz) / 2],
      [Math.hypot(dx, dz), wallTop - wallBottom, .28], 0x829697, [0, -Math.atan2(dz, dx), 0]);
  }

  // Stoop → office quay → bridge → uninterrupted town promenade.
  timberDeck(b, DOOR.x, -18, 4.3, 22);
  timberDeck(b, 32.6, 8, 3.2, 16);
  timberDeck(b, 13.3, 22.2, 31.4, 3);
  timberDeck(b, 28.6, 9.8, 2.25, 21.2);
  for (const x of [-45, -28, 34, 55]) {
    timberDeck(b, x, -23, 1.7, 12);
    for (const z of [-27, -22, -17.4]) {
      b.line([x - .7, WATER_Y - .2, z], [x - .7, QUAY_Y + .55, z], .09, INK);
      b.line([x + .7, WATER_Y - .2, z], [x + .7, QUAY_Y + .55, z], .09, INK);
    }
  }
  for (let z = -27.4; z <= -8; z += 3.8) for (const x of [DOOR.x - 2.03, DOOR.x + 2.03]) {
    b.line([x, QUAY_Y + .05, z], [x, QUAY_Y + 1.25, z], .1, INK);
    if (z + 3.8 <= -8) b.line([x, QUAY_Y + 1.03, z], [x, QUAY_Y + 1.03, z + 3.8], .026, 0x6a777b);
  }
  for (const [x, z] of [[-3.5, 0], [-3.5, 14], [30.5, -5], [30.5, 23.8], [-3.5, 23.8]]) {
    b.line([x, QUAY_Y - .18, z], [x, QUAY_Y + 1.02, z], .1, INK);
  }

  // A varied fleet, with a broad unblocked channel east of the office. Mooring
  // fingers stop short of that channel; every hull is fully over water.
  for (const spec of [
    [-7.1, 10, .9, .12, 'sail', 0xe5e6df], [37.4, 10, .95, .03, 'fishing', 0xcc8066],
    [18, -18.1, .7, Math.PI / 2, 'sail', 0xe6e6db], [-40.7, -23, .8, .08, 'fishing', 0x927e64],
    [-23.7, -22.5, .78, -.12, 'sail', 0xe9e4d3], [29.6, -22.6, .69, .04, 'motor', 0x819fa3],
    [59.2, -22, .72, -.06, 'sail', 0xd2d7cf], [-25, 7, .58, 1.1, 'dinghy', 0xb17960],
    [50, 28, .74, -.4, 'motor', 0xe2d8bc], [21, 43, .66, -.9, 'dinghy', 0x9caeaa],
    [78, 10, 1.1, .7, 'fishing', 0xb17b5b], [-56, 25, .78, -.35, 'motor', 0xdae0d9],
    [100, 58, 1.1, -1, 'sail', 0xebdfc6], [-91, 19, .9, .35, 'sail', 0xe5e6df],
    [-20, 75, .78, -.8, 'sail', 0xdce1d8], [60, 85, .75, .6, 'fishing', 0x8da5a5],
    [143, 22, .85, -.5, 'sail', 0xe0d9c4], [-141, 40, .9, .8, 'motor', 0xa9b9b8],
  ]) boat(b, ...spec);
  b.line([-3.5, QUAY_Y + .75, 14], [-6.3, WATER_Y + .95, 13], .025, 0x8c8a77);
  b.line([34.1, QUAY_Y + .15, 11], [36.1, WATER_Y + 1, 11], .025, 0x8c8a77);

  const colours = [0xb36e55, 0xc9c5b2, 0x7e989f, 0xd0c6ab, 0xa85f4d, 0xc1c8c1, 0x819196];
  // Two staggered rows have proper alleys between them, with small uphill houses
  // behind. No row ends at the water: every building sits on continuous mainland.
  for (let row = 0; row < 3; row++) for (let i = 0; i < 13; i++) {
    const x = -111 + i * 18.5 + (row % 2 ? 8 : 0), w = row === 2 ? 8 + rand() * 3 : 10 + rand() * 3;
    const d = row === 0 ? 8 : row === 2 ? 9 : 11 + rand() * 2;
    const h = row === 2 ? 4 + rand() * 2.5 : 5.8 + rand() * 3;
    const shore = Math.min(shoreAt(x - w / 2), shoreAt(x), shoreAt(x + w / 2));
    const z = shore - 20 - row * 24;
    harbourBuilding(b, x, z, w, d, h, colours[(i + row * 3) % colours.length]);
    if (row === 0 && i % 2 === 0) {
      b.add('details', [x, QUAY_Y + 2.75, z + d / 2 + .85], [w * .7, .15, 1.8], i % 4 ? 0x8b9d91 : 0xd9cbb0);
      b.add('details', [x + w / 2 + 2, QUAY_Y + .04, z - 5], [2.2, .05, 26], 0xc5c5b4);
    }
  }
  // The front of the waterfront stays pedestrian-scaled: benches, crates and
  // bollards follow its curved promenade rather than spilling into the channel.
  for (let x = -120; x <= 128; x += 12) {
    const z = shoreAt(x) - 2.7;
    b.line([x, QUAY_Y, z + 1.7], [x, QUAY_Y + .8, z + 1.7], .16, INK);
    if (Math.abs(x - DOOR.x) < 6) continue;
    b.add('details', [x, QUAY_Y + .55, z], [2.4, .16, .75], 0x9d9279);
    for (const dx of [-.8, .8]) b.add('details', [x + dx, QUAY_Y + .27, z], [.16, .5, .6], INK);
  }
  for (const [x, z] of [[-48, -32], [-30, -32], [48, -33], [58, -32]]) {
    for (let i = 0; i < 3; i++) b.add('details', [x + i * .85, QUAY_Y + .32, z], [.68, .64, .68], i % 2 ? 0xa98a65 : 0x879883);
  }

  // Sea-weathered rocks, low scrub and a sparse pine belt layer the headlands.
  // All planting is beyond the office, keeping its large windows and water open.
  for (let i = 0; i < 105; i++) {
    const x = -225 + rand() * 465;
    if (x > -61 && x < 64) continue;
    const z = shoreAt(x) + .2 + rand() * 2.3, size = .45 + rand() * 1.1;
    b.add('rocks', [x, WATER_Y + size * .25, z], [size * 1.5, size * .65, size], 0x9ba9a3, [0, rand() * 6.28, 0]);
  }
  for (let i = 0; i < 135; i++) {
    const x = -230 + rand() * 470, z = shoreAt(x) - 79 - rand() * 54;
    const h = 4 + rand() * 6;
    b.line([x, MAINLAND_Y - .01, z], [x, MAINLAND_Y + h * .8, z], .13, 0x727667);
    const tint = season === 'winter' ? 0x79908a : [0x5e7e70, 0x6d8a76, 0x779481][i % 3];
    b.add('pine-crowns', [x, MAINLAND_Y + h * .63, z], [h * .33, h * .84, h * .33], tint);
    b.add('pine-crowns', [x, MAINLAND_Y + h * .43, z], [h * .4, h * .62, h * .4], tint);
  }
  for (let i = 0; i < 65; i++) {
    const x = -210 + rand() * 430, z = shoreAt(x) - 58 - rand() * 60;
    b.add('shrubs', [x, MAINLAND_Y + .6, z], [1.2 + rand(), .9, 1.2 + rand()], season === 'winter' ? 0xa6b7ad : 0x81977e);
  }

  const stalks = [];
  for (const [x, z, w, d] of [[-2.3, 5.8, 1.4, 7], [21, -5.4, 9, 1.1]]) {
    b.add('details', [x, QUAY_Y + .27, z], [w, .49, d], 0x84979b);
    for (let i = 0; i < 58; i++) stalks.push([x + (rand() - .5) * (w - .18), z + (rand() - .5) * (d - .18), .6 + rand()]);
  }
  for (const [x, z, h] of stalks) b.line([x, QUAY_Y + .51, z], [x + (rand() - .5) * .2, QUAY_Y + .51 + h, z], .018,
    season === 'spring' || season === 'summer' ? 0x788b6c : 0xab9e78);
  b.flush();
  return g;
}

export const outlook = {
  id: 'tide-harbour', label: 'Nordic harbour', aerial: false,
  ground: season => ({ y: WATER_Y - .08, color: SEA[season] ?? SEA.summer }),
  build(g, { season }) { buildTideHarbour(g, season); },
};
