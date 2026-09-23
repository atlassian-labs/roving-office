// A quiet courtyard at the edge of an inhabited adobe town. Narrow walking
// lanes, roof terraces and layered wind-shaped dunes give it a desert horizon.
import * as THREE from 'three';
import { DOOR, STREET_Y } from '../../config.js';
import { box, cyl, group, put } from '../build.js';
import { planting } from '../canopy-planting.js';
import { seeded } from './streetscape.js';

// These are walking lanes, not roads. The central spine meets the existing
// courtyard gate; the west lane and cross alleys join it into one network.
const LANES = [
  [[DOOR.x, -3], [DOOR.x, -67]],
  [[-52, -35.5], [59, -35.5]],
  [[-48, -49.5], [59, -49.5]],
  [[-33.5, -63], [-33.5, 46]],
  [[-49, 12], [-18, 12]],
  [[-49, 29], [-18, 29]],
];

function groundTexture(season) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2048;
  const c = canvas.getContext('2d'), rand = seeded(20523);
  c.fillStyle = season === 'winter' ? '#cbbd9e' : '#d0b081'; c.fillRect(0, 0, 2048, 2048);
  for (let i = 0; i < 23000; i++) {
    c.fillStyle = i % 2 ? 'rgba(142,102,57,.06)' : 'rgba(255,243,207,.09)';
    c.fillRect(rand() * 2048, rand() * 2048, 1 + rand() * 3, 1 + rand() * 3);
  }
  c.translate(1024, 1024); c.scale(2048 / 440, 2048 / 440);
  c.fillStyle = season === 'winter' ? '#dcd1b9' : '#e4cfaa'; c.fillRect(-15, -18, 45, 43);
  // Rounded, irregularly edged town apron, with dunes rising beyond its flat
  // foundations. All surface dressing lives on the terrain, without overlay slabs.
  c.fillStyle = season === 'winter' ? '#ccbb9d' : '#c9a474';
  c.beginPath(); c.roundRect(-53, -68, 115, 48, 11); c.fill();
  c.beginPath(); c.roundRect(-52, -45, 34, 90, 9); c.fill();
  c.lineJoin = c.lineCap = 'round';
  for (const [width, colour] of [[4.1, '#b99163'], [3.6, season === 'winter' ? '#d9c7a6' : '#ddbd8d']]) {
    c.strokeStyle = colour; c.lineWidth = width;
    for (const [index, points] of LANES.entries()) {
      c.lineWidth = index === 0 ? width - .8 : width;
      c.beginPath(); points.forEach(([x, z], i) => i ? c.lineTo(x, z) : c.moveTo(x, z)); c.stroke();
    }
  }
  // A small shaded market square opens out of the western lane.
  c.fillStyle = season === 'winter' ? '#d9c7a6' : '#ddbd8d';
  c.beginPath(); c.ellipse(-33.5, -17, 6.0, 7.2, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#c7a67b'; c.lineWidth = .065;
  for (let z = -23; z < -11; z += 1.2) {
    c.beginPath(); c.moveTo(-38.5, z); c.lineTo(-28.5, z); c.stroke();
  }
  c.lineWidth = 1.8; c.strokeStyle = '#bd895f';
  c.beginPath(); c.moveTo(DOOR.x, -12); c.lineTo(-8, -12); c.lineTo(-8, 23); c.stroke();
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return map;
}

function succulent(parent, x, z, size, seed) {
  const p = planting(parent, { seed, greens: [0x809281, 0x9eaa8f, 0x647d69], shadows: true });
  // Broad, fleshy rosettes instead of the woodland's feathery plants.
  for (let ring = 0; ring < 3; ring++) for (let leaf = 0; leaf < 8; leaf++) {
    p.leaf(x, STREET_Y + .07, z, size * (1.15 - ring * .22), leaf * Math.PI / 4 + ring * .33,
      1.25 - ring * .38);
  }
  p.finish();
}

function desertTerrain(season) {
  // One connected surface replaces both the old square ground patch and its
  // single circular dune. Close vertices describe several curved slip faces;
  // broad outer triangles carry the sand beyond the camera's viewing distance.
  const axis = [-650, -360];
  for (let n = -204; n <= 204; n += 3) axis.push(n);
  axis.push(360, 650);
  const vertices = [], colours = [], uvs = [], indices = [], colour = new THREE.Color();
  const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
  for (const z of axis) for (const x of axis) {
    let height = 0;
    // Offset, wind-swept crests: the steep leeward side and broad windward side
    // give each band a recognisable dune silhouette instead of rounded hills.
    for (const [distance, rise, breadth] of [[84, 10.5, 14], [121, 16.0, 21], [168, 20.0, 27]]) {
      const north = -z - distance - Math.sin(x * .035 + distance * .07) * 8 - Math.sin(x * .071) * 3;
      const west = -x - distance + 9 - Math.sin(z * .029 + distance * .05) * 11;
      const east = x - distance - 26 - Math.sin(z * .032 + distance * .02) * 9;
      const south = z - distance - 14 - Math.sin(x * .024 + distance * .05) * 12;
      const crest = value => Math.exp(-Math.pow(value / (value < 0 ? breadth * .55 : breadth), 2));
      height += rise * (crest(north) * (.76 + .14 * Math.sin(x * .042))
        + crest(west) * .68 + crest(east) * .44 + crest(south) * .37);
    }
    // Keep every village footprint and its paths exactly level; no house is
    // half-buried in a sloping dune. Terrain rises behind the inhabited apron.
    const beyondTown = Math.hypot(Math.max(-58 - x, x - 66, 0), Math.max(-72 - z, z - 50, 0));
    height *= smooth(beyondTown / 14) * (1 - smooth((Math.max(Math.abs(x), Math.abs(z)) - 220) / 90));
    vertices.push(x, STREET_Y + .025 + height, z);
    colour.setRGB(1, 1, 1).multiplyScalar(1 + height * .0025);
    colours.push(colour.r, colour.g, colour.b);
    uvs.push((x + 220) / 440, 1 - (z + 220) / 440);
  }
  for (let z = 0; z < axis.length - 1; z++) for (let x = 0; x < axis.length - 1; x++) {
    const i = z * axis.length + x;
    indices.push(i, i + axis.length, i + 1, i + 1, i + axis.length, i + axis.length + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry,
    new THREE.MeshLambertMaterial({ map: groundTexture(season), vertexColors: true }));
  mesh.name = 'dune-continuous-terrain'; mesh.receiveShadow = true; return mesh;
}

function villageBatch(parent, name, { geometry = new THREE.BoxGeometry(1, 1, 1), shadows = false } = {}) {
  const entries = [], dummy = new THREE.Object3D(), colour = new THREE.Color();
  return {
    add(x, y, z, w, h, d, tone, tilt = 0) {
      dummy.position.set(x, y, z); dummy.scale.set(w, h, d); dummy.rotation.set(tilt, 0, 0); dummy.updateMatrix();
      entries.push({ matrix: dummy.matrix.clone(), tone });
    },
    finish() {
      const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial(), entries.length);
      mesh.name = name;
      entries.forEach(({ matrix, tone }, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, colour.setHex(tone)); });
      mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); parent.add(mesh);
      return mesh;
    },
  };
}

function buildTown(parent, season) {
  const walls = villageBatch(parent, 'dune-town-walls', { shadows: true });
  const parapets = villageBatch(parent, 'dune-town-parapets', { shadows: true });
  const joinery = villageBatch(parent, 'dune-town-doors-and-shutters');
  const shade = villageBatch(parent, 'dune-town-awnings', { shadows: true });
  const supports = villageBatch(parent, 'dune-town-shade-supports', { shadows: true });
  const terraces = villageBatch(parent, 'dune-town-roof-stairs');
  const pots = villageBatch(parent, 'dune-town-terracotta-pots', { geometry: new THREE.CylinderGeometry(.65, 1, 1, 8) });
  const tones = season === 'winter' ? [0xcbb99b, 0xbda788, 0xd1c4ac, 0xb99d80]
    : [0xcda778, 0xb78760, 0xdac09a, 0xc09a72];
  // The spaces between these clusters are the actual alleys. Low stepped rows
  // frame the office from behind and to its left, keeping its open corner clear.
  const plots = [
    [-44, -27, 8, 8, 5.1], [-24, -27, 10, 8, 6.0], [-12, -27, 8, 7.5, 4.7],
    [-3.2, -27, 5.5, 8, 5.6], [13, -27, 8, 8, 4.2], [23.5, -27, 9, 8.5, 6.7],
    [35, -27.8, 9, 8, 5.2], [47, -28, 10, 8, 4.7],
    [-43, -42.5, 9, 8, 6.8], [-24, -42.5, 10, 8, 5.6], [-12, -42.5, 8, 8, 7.5],
    [-3, -42.5, 5, 8, 4.7], [13, -43, 8, 8.5, 6.4], [24, -43, 9, 8.5, 5.0],
    [36, -43, 10, 8, 8.6], [49, -43, 10, 8, 5.8],
    [-43, -59, 9, 10, 4.8], [-23.5, -58.5, 10, 10, 6.1], [-11, -58, 9, 9, 4.6],
    [-2.5, -58.5, 4, 10, 6.6], [12.5, -58.5, 8, 10, 4.9], [24, -58, 9, 9, 6.0],
    [36, -58.5, 10, 10, 5.2], [49.5, -58, 9, 9, 9.5],
    [-24, -8, 10, 10, 5.7], [-24, 5, 10, 8, 4.7], [-24, 20.5, 10, 10, 6.7],
    [-24, 38, 10, 10, 5.2], [-43.5, -5, 10, 11, 6.2], [-43.5, 20.5, 10, 10, 4.5],
    [-43.5, 38, 10, 10, 5.9],
  ];
  plots.forEach(([x, z, w, d, h], i) => {
    const tone = tones[i % tones.length], roof = season === 'winter' ? 0xd3c4a9 : 0xddbe8e;
    walls.add(x, STREET_Y + (h - .035) / 2, z, w, h + .035, d, tone);
    // Real recessed roof terraces. The rim starts at the roof surface; burying
    // it in the house would overlap their flush outer wall faces.
    parapets.add(x, STREET_Y + h + .26, z - (d - .30) / 2, w - .60, .52, .30, roof);
    parapets.add(x, STREET_Y + h + .26, z + (d - .30) / 2, w - .60, .52, .30, roof);
    for (const side of [-1, 1]) parapets.add(x + side * (w - .30) / 2, STREET_Y + h + .26, z, .30, .52, d, roof);
    const face = z + d / 2;
    joinery.add(x - w * .19, STREET_Y + 1.27, face + .018, 1.13, 2.48, .10, i % 4 ? 0x655542 : 0x677871);
    for (const side of [-1, 1]) {
      joinery.add(x + side * w * .26, STREET_Y + Math.max(3.35, h * .64), face + .018, .9, 1.2, .10, 0x756550);
      joinery.add(x + w / 2 + .018, STREET_Y + h * .58, z + side * d * .24, .10, 1.18, .88, 0x7e6b51);
    }
    if (i % 3 === 1 && w > 7) {
      shade.add(x, STREET_Y + 2.9, face + .58, w * .65, .12, 1.40, i % 2 ? 0xae694c : 0xe3c794, -.10);
      for (const side of [-1, 1]) supports.add(x + side * w * .28, STREET_Y + 1.435,
        face + .99, .11, 2.90, .11, 0x80664c);
    }
    if (i % 5 === 0 && w >= 8) {
      // The small rooftop stair rises to a setback room, entirely inside the
      // footprint so it never spills into a pedestrian lane.
      for (let step = 0; step < 6; step++) terraces.add(x - w * .28, STREET_Y + h + step * .14 + .13,
        z + d * .28 - step * .43, 1.25, .28 + step * .28, .44, tone);
      terraces.add(x - w * .13, STREET_Y + h + .83, z - d * .17, w * .40, 1.73, d * .42, tone);
      parapets.add(x - w * .13, STREET_Y + h + 1.73, z - d * .17, w * .43, .22, d * .45, roof);
    }
    if (i % 3 === 0) pots.add(x + w * .26, STREET_Y + h + .29, z + d * .20, .42, .62, .42, 0xa9714f);
  });
  // A pair of canvas stalls gives the widened lane a purpose. Their tables
  // and posts stay at the square's edges; its centre remains an open route.
  for (const [x, z, tone] of [[-38, -17.2, 0xb76d4b], [-28.7, -18, 0xe6c79a]]) {
    shade.add(x, STREET_Y + 3.25, z, 3.2, .13, 3.9, tone, .08);
    terraces.add(x, STREET_Y + .8, z + .15, 2.7, .35, 1.1, 0x9b7958);
    for (const dx of [-1.4, 1.4]) for (const dz of [-1.65, 1.65]) {
      const height = 3.22 - Math.sin(.08) * dz;
      supports.add(x + dx, STREET_Y + height / 2 - .015, z + dz, .10, height, .10, 0x80664c);
    }
    for (const dx of [-1, 1]) supports.add(x + dx, STREET_Y + .32, z + .15, .13, .67, .7, 0x80664c);
    for (let k = 0; k < 4; k++) pots.add(x + (k - 1.5) * .5, STREET_Y + 1.21, z + .15, .19, .47, .19, 0xb98455);
  }
  walls.finish(); parapets.finish(); joinery.finish(); shade.finish(); supports.finish(); terraces.finish(); pots.finish();
}

export function buildDuneCourtyard(parent, season = 'summer') {
  const g = group(); g.name = 'dune-courtyard'; parent.add(g);
  g.add(desertTerrain(season));

  // Low enclosing masses stay below the arched views. The entrance has a real
  // opening, not a path painted through a solid garden wall.
  const sand = season === 'winter' ? 0xd4c5aa : 0xd8bb8d;
  for (const [x, z, w, d] of [[-6.65, -18.3, 16.7, .65], [18.2, -18.3, 23.6, .65],
    [-15.3, 3.2, .65, 42.4], [30.3, -6.2, .65, 24]]) {
    put(g, box(w, 1.45, d, sand, { rough: 1 }), x, STREET_Y + .71, z);
  }
  // A narrow recessed rill beside the garden, quiet enough to read as water
  // without a simulation, reflection render or frame update.
  put(g, box(1.68, .40, 13.5, 0xb8996f, { rough: .96 }), -4.7, STREET_Y + .19, 8);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1.40, 13.2),
    new THREE.MeshStandardMaterial({ color: 0x557c70, roughness: .25, metalness: .12 }));
  water.rotation.x = -Math.PI / 2; water.position.set(-4.7, STREET_Y + .405, 8); g.add(water);
  for (const z of [2, 5, 8, 11, 14]) {
    put(g, box(.9, .035, .024, 0xa3b6a0, { cast: false }), -4.7, STREET_Y + .43, z);
  }

  const olive = planting(g, { seed: 20524,
    greens: season === 'spring' ? [0x6e7f4c, 0x8d9b68, 0xa7b087] : [0x69784e, 0x899571, 0xa3ab8a], shadows: true });
  olive.tree(13, STREET_Y, -8, 8.7, 3.1, 42); olive.finish();
  put(g, cyl(2.65, 2.85, .2, 0xb8a078, { segments: 36, rough: 1 }), 13, STREET_Y + .09, -8);
  for (const [i, x, z, size] of [[0, -11.8, 15.7, 1.6], [1, -11.2, 18.2, .9],
    [2, 25.6, -12.9, 1.5], [3, 27.3, -12, .85], [4, -10.3, -14.8, 1.0]]) {
    succulent(g, x, z, size, 20525 + i);
  }
  // A simple shaded bench remains outdoors, clear of both the entrance and the
  // editor's full floor. Tall urns accent the quiet, unplanted stretches.
  put(g, box(4.8, .48, 1.4, 0xcdb18a), -12.2, STREET_Y + .72, 7.5);
  for (const x of [-14.1, -10.3]) put(g, box(.75, .5, 1.25, sand), x, STREET_Y + .25, 7.5);
  for (const [x, z, height] of [[23.2, -5.2, 1.5], [24.4, -5.4, .95]]) {
    put(g, cyl(.31, .53, height, 0xb2734b, { segments: 18, rough: 1 }), x, STREET_Y + height / 2, z);
    put(g, cyl(.25, .25, .025, 0x67513a, { segments: 18, cast: false }), x, STREET_Y + height + .017, z);
  }

  buildTown(g, season);
  return g;
}

export const outlook = {
  id: 'dune-courtyard', label: 'Desert courtyard', aerial: false,
  ground: season => ({ y: STREET_Y - .02, color: season === 'winter' ? 0xcbbd9e : 0xd0b081 }),
  build(g, { season }) { buildDuneCourtyard(g, season); },
};
