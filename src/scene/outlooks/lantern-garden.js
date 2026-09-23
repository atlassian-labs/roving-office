// A strolling garden: narrow paths, pond, layered planting and a wooded horizon.
import * as THREE from 'three';
import { DOOR, STREET_Y } from '../../config.js';
import { box, cyl, group, put } from '../build.js';
import { markNightLight } from '../night-lights.js';
import { seeded } from './streetscape.js';

const SEASONS = {
  summer: { moss: '#607254', far: '#7e8b77', leaves: [0x843a41, 0xa34b43, 0x6e3942, 0xb05b49] },
  autumn: { moss: '#74774f', far: '#929078', leaves: [0xb5482b, 0xd3692e, 0xa93a28, 0xe49941] },
  winter: { moss: '#9da99b', far: '#bbc4bb', leaves: [0x8c725e, 0x958678] },
  spring: { moss: '#749266', far: '#94a18a', leaves: [0xac5260, 0xc36a71, 0x94434c, 0xb65c58] },
};

// Routes share one plan for painted gravel, stepping stones and planting
// exclusion. The timber bridge completes the only crossing of the pond.
const PATHS = [
  { width: 3.2, points: [[DOOR.x, -3], [DOOR.x, -16.8], [-23, -16.8]] },
  { width: 2.0, smooth: true, points: [[-23, -16.8], [-29, -17], [-32, -24], [-43, -29], [-57, -40]] },
  { width: 1.9, smooth: true, points: [[-12, -16.8], [-17, -7], [-16, 10], [-9, 24], [5, 31], [19, 33], [29, 30]] },
  { width: 1.9, smooth: true, points: [[43, 30], [48, 21], [45, 6], [39, -9], [27, -16.8], [DOOR.x, -16.8]] },
  { width: 1.5, smooth: true, points: [[-16, 10], [-11, 15], [-6, 18]] },
  { width: 1.6, smooth: true, points: [[5, 31], [4, 40], [-6, 47], [-22, 50], [-39, 58]] },
  { width: 1.8, points: [[29, 30], [43, 30]] },
].map(path => ({ ...path, samples: path.smooth
  ? new THREE.CatmullRomCurve3(path.points.map(([x, z]) => new THREE.Vector3(x, 0, z)))
    .getPoints(140).map(p => [p.x, p.z]) : path.points }));

const ISLANDS = [
  [-8, 7, 7.0, 11], [19, -9, 10, 5], [-9, 28, 9, 4],
  [9, 25.4, 11, 3.2], [24, 27, 4, 4], [38, 5, 5, 10],
  [36, 40, 13, 6], [-7, 40, 9, 5], [-22, 35, 9, 7],
  [51, -3, 9, 17], [-35, 19, 9, 18], [12, -29, 20, 7],
];

function distanceToRoute(x, z, path) {
  let nearest = Infinity;
  for (let i = 1; i < path.samples.length; i++) {
    const [ax, az] = path.samples[i - 1], [bx, bz] = path.samples[i];
    const dx = bx - ax, dz = bz - az;
    const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    nearest = Math.min(nearest, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return nearest;
}

function clearPlanting(x, z, radius = 1) {
  if (x > -2.0 - radius && x < 28 + radius && z > -2.3 - radius && z < 22.2 + radius) return false;
  if (Math.pow((x - 36) / (6.7 + radius), 2) + Math.pow((z - 27) / (10 + radius), 2) < 1) return false;
  // Keep the real doorway, wall gate and every winding path physically clear.
  return PATHS.every(path => distanceToRoute(x, z, path) > path.width / 2 + radius + .25);
}

function islandOutline(x, z, rx, rz, phase = 0) {
  const points = [];
  for (let i = 0; i < 64; i++) {
    const a = i / 64 * Math.PI * 2, ripple = 1 + .07 * Math.sin(a * 3 + phase) + .04 * Math.cos(a * 7 - phase);
    points.push([x + Math.cos(a) * rx * ripple, z + Math.sin(a) * rz * ripple]);
  }
  return points;
}
const POND = islandOutline(36, 27, 6.1, 9.5, 1.4);

function gardenTexture(season) {
  const colors = SEASONS[season] || SEASONS.summer;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2048;
  const c = canvas.getContext('2d'), rand = seeded(20533);
  c.fillStyle = colors.far; c.fillRect(0, 0, 2048, 2048);
  c.translate(1024, 1024); c.scale(2048 / 360, 2048 / 360);
  function trace(points) {
    c.beginPath(); points.forEach(([x, z], i) => i ? c.lineTo(x, z) : c.moveTo(x, z)); c.closePath();
  }
  // A soft, irregular woodland floor continues to the horizon. There is no
  // rectangular gravel plot ending in a blank surround.
  trace(islandOutline(10, 8, 72, 65, .7)); c.fillStyle = colors.moss; c.fill();
  for (let i = 0; i < 9500; i++) {
    const x = rand() * 146 - 65, z = rand() * 140 - 62;
    c.fillStyle = i % 2 ? 'rgba(201,211,166,.075)' : 'rgba(30,54,32,.055)';
    c.beginPath(); c.ellipse(x, z, .3 + rand() * 1.6, .3 + rand(), 0, 0, Math.PI * 2); c.fill();
  }
  // Small raked clearings sit between beds. The gravel is subordinate to the
  // planting, and its curved edges follow the garden rather than a road grid.
  for (const [x, z, rx, rz] of [[-10, 8, 7, 12], [17, -9, 12, 6], [13, 28, 13, 5], [39, 1, 8, 9]]) {
    c.save(); trace(islandOutline(x, z, rx, rz, x * .3)); c.clip();
    c.fillStyle = season === 'winter' ? '#d1d5c9' : '#bfc1ae'; c.fillRect(x - rx * 1.2, z - rz * 1.2, rx * 2.4, rz * 2.4);
    c.strokeStyle = season === 'winter' ? '#bfc8b9' : '#a6af94'; c.lineWidth = .07;
    for (let r = .8; r < Math.max(rx, rz) * 2; r += .58) {
      c.beginPath(); c.ellipse(x, z, r, r * .66, -.28, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }
  for (const [i, [x, z, rx, rz]] of ISLANDS.entries()) {
    trace(islandOutline(x, z, rx, rz, i));
    c.fillStyle = colors.moss; c.fill();
    for (let j = 0; j < 100; j++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand());
      c.fillStyle = j % 2 ? 'rgba(171,188,126,.2)' : 'rgba(40,72,38,.16)';
      c.beginPath(); c.ellipse(x + Math.cos(a) * rx * r, z + Math.sin(a) * rz * r, .2 + rand() * .5, .2, a, 0, Math.PI * 2); c.fill();
    }
  }
  c.lineJoin = c.lineCap = 'round';
  for (const path of PATHS) {
    c.strokeStyle = season === 'winter' ? '#c8cdc0' : '#c7bda5'; c.lineWidth = path.width;
    c.beginPath(); path.samples.forEach(([x, z], i) => i ? c.lineTo(x, z) : c.moveTo(x, z)); c.stroke();
    for (let segment = 1; segment < path.samples.length; segment++) {
      const [ax, az] = path.samples[segment - 1], [bx, bz] = path.samples[segment];
      const length = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / length, nz = (bx - ax) / length;
      for (let d = 0; d < length; d += .18) {
        const t = d / length, across = (rand() - .5) * path.width;
        c.fillStyle = rand() < .5 ? 'rgba(87,86,64,.18)' : 'rgba(250,242,212,.25)';
        c.beginPath(); c.ellipse(ax + (bx - ax) * t + nx * across, az + (bz - az) * t + nz * across,
          .025 + rand() * .10, .025 + rand() * .065, rand() * Math.PI, 0, Math.PI * 2); c.fill();
      }
      // Moss interrupts the edge in small irregular tufts: no curb or dark road border.
      if (segment % 3 === 0 || length > 2) for (const side of [-1, 1]) {
        c.fillStyle = colors.moss; c.beginPath();
        c.ellipse(ax + nx * path.width * .53 * side, az + nz * path.width * .53 * side,
          .13 + rand() * .20, .09 + rand() * .13, rand() * Math.PI, 0, Math.PI * 2); c.fill();
      }
    }
  }
  // The pond overwrites the path beneath its bridge; no gravel stripe crosses water.
  trace(POND); c.fillStyle = '#344f49'; c.fill();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4; return texture;
}

function mapleLeafGeometry() {
  const outline = [[0, 0], [-.08, .13], [-.32, .24], [-.20, .34], [-.47, .57],
    [-.27, .55], [-.31, .80], [-.09, .66], [0, 1], [.09, .66], [.31, .80],
    [.27, .55], [.47, .57], [.20, .34], [.32, .24], [.08, .13]];
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ShapeGeometry(shape), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getY(i) * Math.PI) * .13);
  geo.computeVertexNormals(); return geo;
}

function instanceBatch(parent, geometry, { shadows = true, side = THREE.FrontSide } = {}) {
  const records = [], dummy = new THREE.Object3D(), colour = new THREE.Color();
  return {
    add(position, scale, rotation, tone) {
      dummy.position.set(...position); dummy.scale.set(...scale); dummy.rotation.set(...rotation); dummy.updateMatrix();
      records.push({ matrix: dummy.matrix.clone(), tone });
    },
    branch(from, to, radius, tone) {
      const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), d = b.clone().sub(a);
      dummy.position.copy(a).add(b).multiplyScalar(.5);
      dummy.scale.set(radius, d.length(), radius);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); dummy.updateMatrix();
      records.push({ matrix: dummy.matrix.clone(), tone });
    },
    finish(name) {
      if (!records.length) { geometry.dispose(); return; }
      const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ side }), records.length);
      mesh.name = name;
      records.forEach((r, i) => { mesh.setMatrixAt(i, r.matrix); mesh.setColorAt(i, colour.setHex(r.tone)); });
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); parent.add(mesh);
    },
  };
}

function gardenPlants(parent, season) {
  const colors = SEASONS[season] || SEASONS.summer, rand = seeded(20534);
  // Losing leaves must not change the tree underneath them or move the bamboo.
  const leafRand = seeded(20535);
  const branches = instanceBatch(parent, new THREE.CylinderGeometry(.7, 1, 1, 6));
  const leaves = instanceBatch(parent, mapleLeafGeometry(), { side: THREE.DoubleSide });
  // A spreading, asymmetric maple is the principal view; bare winter branches
  // change its silhouette as well as its colour. Cultivar foliage is burgundy.
  function maple(x, z, h, radius, sparse = false) {
    const y = STREET_Y;
    const root = [x, y, z], fork = [x + .45, y + h * .44, z - .28];
    branches.branch(root, fork, .25 * h / 8, 0x6a6354);
    for (let arm = 0; arm < 10; arm++) {
      const angle = arm * 2.399 + .3, reach = radius * (.65 + rand() * .35);
      const joint = [fork[0] + Math.cos(angle) * reach * .48, y + h * (.62 + rand() * .17), fork[2] + Math.sin(angle) * reach * .48];
      const end = [x + Math.cos(angle) * reach, y + h * (.79 + rand() * .15), z + Math.sin(angle) * reach];
      branches.branch(fork, joint, .12 * h / 8, 0x776b5b);
      branches.branch(joint, end, .061 * h / 8, 0x746558);
      for (let twig = 0; twig < 3; twig++) {
        const a = angle + (twig - 1) * .95;
        const tip = [end[0] + Math.cos(a) * .7, end[1] + (twig % 2 ? .3 : -.18), end[2] + Math.sin(a) * .7];
        branches.branch(end, tip, .022 * h / 8, 0x675d51);
      }
      const count = season === 'winter' ? (arm % 3 ? 0 : 2) : sparse ? 38 : 95;
      for (let k = 0; k < count; k++) {
        const a = leafRand() * Math.PI * 2, r = Math.sqrt(leafRand()) * radius * .42;
        const size = .48 + leafRand() * .40;
        leaves.add([end[0] + Math.cos(a) * r, end[1] + (leafRand() - .5) * .66, end[2] + Math.sin(a) * r],
          [size, size, size], [1.0 + leafRand() * 1.5, a, leafRand() * .9], colors.leaves[Math.floor(leafRand() * colors.leaves.length)]);
      }
    }
  }
  maple(-8.2, 7.9, 9.4, 5.0); maple(18.6, -10.5, 7.4, 4.3);
  maple(-16, 28, 6.1, 3.8, true);
  branches.finish('lantern-maple-branches'); leaves.finish('lantern-maple-leaves');

  // Bamboo is an ordered backdrop beyond the courtyard wall, not a dense indoor jungle.
  const stems = instanceBatch(parent, new THREE.CylinderGeometry(.07, .085, 1, 5), { shadows: false });
  const blade = new THREE.Shape([[0, 0], [.13, .3], [.09, .65], [0, 1], [-.08, .65], [-.10, .3]]
    .map(([x, y]) => new THREE.Vector2(x, y)));
  const blades = instanceBatch(parent, new THREE.ShapeGeometry(blade), { shadows: false, side: THREE.DoubleSide });
  for (let i = 0; i < 46; i++) {
    const x = -24 - rand() * 3.5, z = -18 + i * 1.06, h = 6.3 + rand() * 3.2;
    if (PATHS.some(path => distanceToRoute(x, z, path) < path.width / 2 + .75)) continue;
    stems.add([x, STREET_Y + h / 2, z], [1, h, 1], [0, 0, (rand() - .5) * .07], 0x697657);
    for (let j = 0; j < 30; j++) {
      const y = STREET_Y + h * (.44 + rand() * .55), a = rand() * Math.PI * 2;
      blades.add([x + Math.cos(a) * .40, y, z + Math.sin(a) * .40], [1, 1.1 + rand() * .85, 1],
        [1.1, a, (rand() - .5) * 1.4], season === 'winter' ? 0x788d76 : 0x5b7654);
    }
  }
  stems.finish('lantern-bamboo-stems'); blades.finish('lantern-bamboo-leaves');
}

function fernGeometry() {
  const vertices = [], indices = [];
  // One bent frond carries paired tapered pinnae. All the ferns share it.
  for (let i = 0; i < 7; i++) {
    const t = i / 7, y = .1 + t * .66, z = t * .9;
    const width = Math.sin((t * .8 + .12) * Math.PI) * .24;
    for (const side of [-1, 1]) {
      const start = vertices.length / 3;
      vertices.push(0, y, z, side * width, y + .12, z + .14, 0, y + .065, z + .12);
      indices.push(start, start + 1, start + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function layeredPlanting(parent, season) {
  const rand = seeded(20536), winter = season === 'winter';
  const shrubs = instanceBatch(parent, new THREE.IcosahedronGeometry(1, 1));
  const ferns = instanceBatch(parent, fernGeometry(), { side: THREE.DoubleSide });
  const stones = instanceBatch(parent, new THREE.IcosahedronGeometry(1, 0));
  const green = winter ? [0x6f826d, 0x81917a, 0x596c58] : [0x526d46, 0x6d874f, 0x405d3e, 0x839458];
  for (const [island, [x, z, rx, rz]] of ISLANDS.entries()) {
    for (let plant = 0; plant < 16; plant++) {
      const angle = rand() * Math.PI * 2, r = Math.sqrt(rand()) * .87;
      const px = x + Math.cos(angle) * rx * r, pz = z + Math.sin(angle) * rz * r;
      const size = .55 + rand() * 1.05;
      if (!clearPlanting(px, pz, size * 1.15)) continue;
      const height = size * (.58 + rand() * .28);
      for (let lobe = 0; lobe < 3; lobe++) {
        const a = lobe * 2.4 + rand();
        const tone = season === 'spring' && island % 3 === 0 && lobe === 2 ? 0xb58c94 : green[(plant + lobe) % green.length];
        shrubs.add([px + Math.cos(a) * size * .36, STREET_Y + height * (.62 + lobe * .08), pz + Math.sin(a) * size * .33],
          [size * .72, height, size * .66], [0, a, .08], tone);
      }
      if (plant % 3 === 0) {
        const fx = px + size * 1.1, fz = pz - size * .3;
        if (clearPlanting(fx, fz, .65)) for (let frond = 0; frond < 8; frond++) {
          ferns.add([fx, STREET_Y + .09, fz], [1.1, 1.1, 1.1], [0, frond * Math.PI / 4 + rand() * .2, 0], green[frond % green.length]);
        }
      }
    }
  }
  // Mossy, partly buried rocks articulate the pond edge, not a ring of identical bollards.
  for (let i = 0; i < POND.length; i += 3) {
    const [x, z] = POND[i], size = .45 + rand() * .65;
    if (!clearPlanting(x, z, .35) && Math.abs(z - 30) < 1.8) continue;
    stones.add([x, STREET_Y + .24, z], [size, .35 + rand() * .25, size * .72], [.12, rand() * Math.PI, .13], green[i % green.length]);
  }
  shrubs.finish('lantern-layered-shrubs'); ferns.finish('lantern-understory-ferns'); stones.finish('lantern-pond-stones');

  const trunks = instanceBatch(parent, new THREE.CylinderGeometry(.7, 1, 1, 6));
  const clouds = instanceBatch(parent, new THREE.IcosahedronGeometry(1, 1));
  function pine(x, z, h, size) {
    const fork = [x + .55, STREET_Y + h * .88, z - .3];
    trunks.branch([x, STREET_Y, z], fork, .22 * size, 0x6c6555);
    for (let tier = 0; tier < 3; tier++) for (let arm = 0; arm < 3; arm++) {
      const a = arm * 2.1 + tier * .7, reach = size * (2.0 - tier * .42);
      const end = [x + Math.cos(a) * reach, STREET_Y + h * (.48 + tier * .2), z + Math.sin(a) * reach];
      const branchY = end[1] - .7, trunkFraction = (branchY - STREET_Y) / (fork[1] - STREET_Y);
      trunks.branch([x + (fork[0] - x) * trunkFraction, branchY, z + (fork[2] - z) * trunkFraction], end, .072 * size, 0x746c59);
      clouds.add(end, [size * 1.35, size * .47, size * 1.13], [0, a, 0], green[(arm + tier) % green.length]);
    }
  }
  for (const [x, z, h, size] of [[-11, -7, 6.4, 1.3], [33, -8, 7.7, 1.65], [-23, 28, 7.8, 1.6],
    [25, 40, 5.6, 1.1], [49, 8, 8.3, 1.7], [-10, 40, 5.4, 1.1], [49, 36, 6.8, 1.5]]) pine(x, z, h, size);
  trunks.finish('lantern-cloud-pine-branches'); clouds.finish('lantern-cloud-pine-canopies');

  // Low woodland groups fill the wide camera without adding shadow passes.
  // Trees are staggered in depth and height instead of a single enclosing wall.
  const farTrunks = instanceBatch(parent, new THREE.CylinderGeometry(.15, .24, 1, 5), { shadows: false });
  const farLeaves = instanceBatch(parent, new THREE.IcosahedronGeometry(1, 1), { shadows: false });
  for (let ring = 0; ring < 4; ring++) for (let i = 0; i < 28 + ring * 14; i++) {
    const a = (i + ring * .37) / (28 + ring * 14) * Math.PI * 2, radius = 52 + ring * 15 + rand() * 9;
    const x = 10 + Math.cos(a) * radius, z = 8 + Math.sin(a) * radius;
    if (!clearPlanting(x, z, 3.2)) continue;
    const h = 5.2 + rand() * 5.8, crown = 2.6 + rand() * 1.8 + ring * .45;
    farTrunks.add([x, STREET_Y + h / 2, z], [1, h, 1], [0, a, .025], 0x79786a);
    for (let lobe = 0; lobe < 3; lobe++) {
      farLeaves.add([x + Math.cos(lobe * 2.2) * crown * .5, STREET_Y + h * (.63 + lobe * .1), z + Math.sin(lobe * 2.2) * crown * .5],
        [crown, crown * .7, crown * .95], [0, a + lobe, 0], winter ? [0x81917f, 0x8d9e89, 0x738670][lobe] : [0x65825c, 0x7d9064, 0x506d50][lobe]);
    }
  }
  farTrunks.finish('lantern-woodland-trunks'); farLeaves.finish('lantern-woodland-canopies');
}

function pondAndBridge(parent, season) {
  const shape = new THREE.Shape(POND.map(([x, z]) => new THREE.Vector2(x, -z)));
  const pond = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({
    color: season === 'winter' ? 0x74918a : 0x436d64, roughness: .32, metalness: .12,
  }));
  pond.name = 'lantern-garden-pond'; pond.rotation.x = -Math.PI / 2;
  pond.position.y = STREET_Y + .07; pond.receiveShadow = true; parent.add(pond);
  const timber = instanceBatch(parent, new THREE.BoxGeometry(1, 1, 1));
  const rail = instanceBatch(parent, new THREE.CylinderGeometry(1, 1, 1, 6));
  const deckY = x => STREET_Y + .21 + Math.sin((x - 29) / 14 * Math.PI) * .72;
  for (let i = 0; i < 28; i++) {
    const x = 29.25 + i * .5;
    timber.add([x, deckY(x), 30], [.475, .13, 1.85], [0, 0, Math.cos((x - 29) / 14 * Math.PI) * .16], 0x82705a);
  }
  for (const z of [28.94, 31.06]) {
    for (let i = 0; i < 7; i++) {
      const x = 29 + i * 14 / 6;
      timber.add([x, deckY(x) + .53, z], [.105, 1.15, .105], [0, 0, 0], 0x5d5548);
      if (i < 6) {
        const nextX = 29 + (i + 1) * 14 / 6;
        rail.branch([x, deckY(x) + 1.03, z], [nextX, deckY(nextX) + 1.03, z], .052, 0x5d5548);
      }
    }
  }
  timber.finish('lantern-footbridge-timber'); rail.finish('lantern-footbridge-rails');
  // Flat pads add scale to still water; no reflection camera or water animation.
  const pads = instanceBatch(parent, new THREE.CircleGeometry(1, 9), { shadows: false, side: THREE.DoubleSide });
  for (const [x, z, r] of [[34, 21, .38], [34.8, 21.6, .48], [35.9, 21.4, .32], [39, 25, .47], [39.7, 25.7, .30]]) {
    pads.add([x, STREET_Y + .10, z], [r, r, r], [-Math.PI / 2, 0, x], season === 'winter' ? 0x899577 : 0x82924f);
  }
  pads.finish('lantern-water-lilies');
}

export function buildLanternGarden(parent, season = 'summer') {
  const g = group(); g.name = 'lantern-garden'; parent.add(g);
  // The textured garden keeps its world scale; a lower matching plain extends
  // underneath it so the maximum orbit zoom cannot expose a square cut edge.
  const horizon = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshLambertMaterial({ color: (SEASONS[season] || SEASONS.summer).far }));
  horizon.name = 'lantern-landscape-horizon'; horizon.rotation.x = -Math.PI / 2;
  horizon.position.y = STREET_Y - .04; horizon.receiveShadow = true; g.add(horizon);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(360, 360), new THREE.MeshLambertMaterial({ map: gardenTexture(season) }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = STREET_Y + .025; ground.receiveShadow = true; g.add(ground);
  gardenPlants(g, season);
  layeredPlanting(g, season);
  pondAndBridge(g, season);

  // Stones form deliberately uneven groups; the near stepping stones stay off
  // the full-width accessible entrance path.
  const rocks = instanceBatch(g, new THREE.IcosahedronGeometry(1, 1));
  for (const [x, z, w, h, d] of [[-8, 3.9, 1.8, 1.1, 1.15], [-9.7, 4.9, 1.1, .55, .9],
    [-6.6, 5, .74, .46, .8], [23.5, -9.2, 1.7, 1.3, 1.4], [25.2, -10.1, .85, .55, 1.1]]) {
    rocks.add([x, STREET_Y + h * .46, z], [w, h, d], [.1, x * .3, .12], 0x757c75);
  }
  for (const path of [PATHS[2], PATHS[4], PATHS[5]]) {
    let walked = 0;
    for (let i = 1; i < path.samples.length; i++) {
      const [x, z] = path.samples[i], [px, pz] = path.samples[i - 1];
      walked += Math.hypot(x - px, z - pz);
      if (walked < 1.7) continue;
      walked = 0;
      rocks.add([x, STREET_Y + .07, z], [.56, .14, .70], [0, Math.atan2(x - px, z - pz), 0], 0x9a9f8c);
    }
  }
  rocks.finish('lantern-garden-stones');

  // The enclosing wall opens around the approach at z=-16.8, so the entrance
  // remains a continuous route from outside the courtyard to the office stoop.
  for (const [from, to] of [[-20, -19], [-14.6, 32]]) {
    put(g, box(.35, 2.75, to - from, 0xb1afa0, { rough: 1 }), -22, STREET_Y + 1.36, (from + to) / 2);
    put(g, box(.58, .15, to - from + .15, 0x50564f), -22, STREET_Y + 2.83, (from + to) / 2);
  }
  put(g, box(61, 2.75, .35, 0xb1afa0, { rough: 1 }), 8.3, STREET_Y + 1.36, -21.5);
  put(g, box(61.3, .15, .58, 0x50564f), 8.3, STREET_Y + 2.83, -21.5);

  // Small, low neighbouring pavilions keep the context inhabited and horizontal.
  for (const [x, z, w, d, h] of [[-36, -7, 12, 15, 5.3], [13, -36, 17, 9, 4.5], [39, -27, 10, 11, 6]]) {
    put(g, box(w, h, d, 0xb4b3a4, { cast: false, rough: 1 }), x, STREET_Y + h / 2, z);
    put(g, box(w - .9, 1.9, .08, 0x596861, { cast: false }), x, STREET_Y + h * .57, z + d / 2 + .06);
    const roofGeo = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0x59615c }));
    roof.scale.set((w + 2.1) / Math.SQRT2, 2.0, (d + 2.1) / Math.SQRT2);
    roof.position.set(x, STREET_Y + h + .9, z); g.add(roof);
  }

  // Two garden lanterns accent the threshold after dark without extra point lights.
  for (const [x, z] of [[-.5, -9], [-5.3, 15.5]]) {
    put(g, cyl(.38, .49, .24, 0x767c72, { segments: 8 }), x, STREET_Y + .12, z);
    put(g, box(.22, 1.3, .22, 0x575c55), x, STREET_Y + .8, z);
    const light = new THREE.Mesh(new THREE.BoxGeometry(.64, .74, .64),
      new THREE.MeshStandardMaterial({ color: 0xe4dcc2, emissive: 0xffcb84, emissiveIntensity: 0 }));
    light.position.set(x, STREET_Y + 1.62, z); g.add(light);
    put(g, box(.93, .16, .93, 0x4d554e), x, STREET_Y + 2.08, z);
    markNightLight(light, { emissive: [light.material], emissiveIntensity: 1.2 });
  }
  return g;
}

export const outlook = {
  id: 'lantern-garden', label: 'Maple courtyard', aerial: false,
  ground: season => ({ y: STREET_Y - .02, color: season === 'winter' ? 0xbdc6bf : 0x7e8b77 }),
  build(g, { season }) { buildLanternGarden(g, season); },
};
