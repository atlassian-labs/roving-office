// Alder Street: present-day masonry and planted terraces around a connected park.
// Painted facades + instanced solids keep a larger neighbourhood inexpensive.
import * as THREE from 'three';
import { ROOM, STREET_Y } from '../../config.js';
import { markLitWindow } from '../night-lights.js';
import { loadingBayFractions, loadingBayWidth } from '../building.js';
import { WALK_Y, buildCar, buildStreetLamp, seeded } from './streetscape.js';
import { ALDER, buildings, crossings, parking, pavements, ramps, pavingCuts, subtractRectangle } from './alder-layout.js';

const STONE = [0xd1c5ab, 0xb38369, 0xdad6c6, 0x9aabab];

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Mipmaps matter here: distant window grids should settle into a facade.
  texture.anisotropy = 4;
  return texture;
}

// All facades share this one atlas and its window-light mask. A tile describes
// a material and a storey count; individual windows never become scene objects.
function facadeAtlas(style = 'alder', palette = STONE) {
  const canvas = document.createElement('canvas');
  const glow = document.createElement('canvas');
  canvas.width = canvas.height = glow.width = glow.height = 1024;
  const c = canvas.getContext('2d'), e = glow.getContext('2d');
  const tones = palette.map(tone => `#${tone.toString(16).padStart(6, '0')}`);
  const rand = seeded(2017);
  e.fillStyle = '#000'; e.fillRect(0, 0, 1024, 1024);
  for (let tile = 0; tile < 4; tile++) for (let level = 0; level < 4; level++) {
    const tx = tile * 256, ty = level * 256, floors = level + 2;
    c.fillStyle = tones[tile]; c.fillRect(tx, ty, 256, 256);
    if (style === 'industrial') {
      c.fillStyle = '#526356'; c.font = 'bold 9px sans-serif';
      c.fillText(tile % 2 ? 'COOPERATIVE WORKS' : 'STUDIOS & WORKSHOPS', tx + 12, ty + 9);
    }
    for (let row = 0; row < floors; row++) {
      const y = ty + 12 + row * (232 / floors), height = 232 / floors;
      c.fillStyle = 'rgba(66,62,52,.12)'; c.fillRect(tx + 3, y + height - 6, 250, 2);
      for (let col = 0; col < 5; col++) {
        const x = tx + 12 + col * 48, w = style === 'tower' ? 41 : style === 'paris' ? 23 : 31;
        const h = height * (style === 'tower' ? .87 : .69);
        c.fillStyle = '#465a5b'; c.fillRect(x - 2, y - 1, w + 4, h + 4);
        const glass = c.createLinearGradient(x, y, x, y + h);
        glass.addColorStop(0, '#91b0b3'); glass.addColorStop(.4, '#63878e'); glass.addColorStop(1, '#344f58');
        c.fillStyle = glass; c.fillRect(x, y, w, h);
        c.fillStyle = 'rgba(230,238,220,.3)'; c.fillRect(x + 2, y + 1, w * .35, h - 2);
        if (rand() < .28) {
          c.fillStyle = '#b5b9ad'; c.fillRect(x, y, w, h * .32);
          e.fillStyle = rand() < .5 ? '#ead3a0' : '#dce4cc'; e.fillRect(x, y, w, h);
        }
        c.fillStyle = tones[tile]; c.fillRect(x + w * .5, y, 1.5, h);
        c.fillStyle = '#ede4cd'; c.fillRect(x - 2, y + h + 2, w + 4, 2);
        if (style === 'industrial') {
          c.fillStyle = '#87978b';
          for (const f of [.25, .75]) c.fillRect(x + w * f, y, 1, h);
          for (const f of [.33, .66]) c.fillRect(x, y + h * f, w, 1);
        } else if (style === 'paris') {
          c.fillStyle = '#48554e'; c.fillRect(x - 3, y + h - 7, w + 6, 1.5);
          for (let bar = 0; bar < w; bar += 4) c.fillRect(x + bar, y + h - 7, 1, 9);
        }
      }
    }
  }
  return { map: canvasTexture(canvas), emissiveMap: canvasTexture(glow) };
}

// One road surface covers the network; intersections cannot contain overlapping
// road slabs. Paint is in the same texture, so it cannot z-fight with the asphalt.
function roadTexture(season) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2048;
  const c = canvas.getContext('2d'), scale = 2048 / (ALDER.max - ALDER.min);
  c.scale(scale, scale); c.translate(-ALDER.min, -ALDER.min);
  c.fillStyle = season === 'winter' ? '#bdc7c9' : '#818f91';
  c.fillRect(ALDER.min, ALDER.min, 220, 220);
  c.fillStyle = season === 'winter' ? '#7a878b' : '#707f83';
  for (const z of ALDER.streets) c.fillRect(ALDER.min, z - 3.5, 220, 7);
  for (const x of ALDER.avenues) c.fillRect(x - 3.5, ALDER.min, 7, 220);
  const nearCrossing = (x, z) => crossings.some(p => p.axis === 'x'
    ? Math.abs(z - p.z) < 4.1 && Math.abs(x - p.x) < p.width / 2 + 1.8
    : Math.abs(x - p.x) < 4.1 && Math.abs(z - p.z) < p.width / 2 + 1.8);
  c.fillStyle = season === 'winter' ? '#c7cdca' : '#e7e4cd';
  for (let t = ALDER.min + 2; t < ALDER.max - 2; t += 4.8) {
    for (const z of ALDER.streets) {
      if (!ALDER.avenues.some(x => Math.abs(t - x) < 6) && !nearCrossing(t, z)) c.fillRect(t - 1, z - .09, 2, .18);
    }
    for (const x of ALDER.avenues) {
      if (!ALDER.streets.some(z => Math.abs(t - z) < 6) && !nearCrossing(x, t)) c.fillRect(x - .09, t - 1, .18, 2);
    }
  }
  c.fillStyle = season === 'winter' ? '#dce1dd' : '#f1efdf';
  for (const { x, z, axis, width } of crossings) {
    for (let i = -3.5; i < 3.7; i += 1) {
      if (axis === 'x') c.fillRect(x - width / 2, z + i, width, .52);
      else c.fillRect(x + i, z - width / 2, .52, width);
    }
  }
  return canvasTexture(canvas);
}

export function buildAlderStreet(parent, season = 'summer', district = {}) {
  const style = district.style ?? 'alder';
  const palette = style === 'tower' ? [0xa5b4ae, 0xa79881, 0xa8b8bf, 0x889f9f] : STONE;
  const root = new THREE.Group(); root.name = `${district.id ?? 'alder'}-garden-city`;
  root.position.y = district.offsetY ?? 0; parent.add(root);
  const rand = seeded(2019), winter = season === 'winter';
  const batches = new Map();
  const shapes = {
    box: new THREE.BoxGeometry(1, 1, 1),
    crown: new THREE.OctahedronGeometry(1, 1),
    trunk: new THREE.CylinderGeometry(.65, 1, 1, 6),
    ramp: new THREE.BufferGeometry(),
    shed: new THREE.BufferGeometry(),
  };
  shapes.ramp.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5,-.5,-.5, -.5,-.5,.5, .5,.5,.5, -.5,-.5,-.5, .5,.5,.5, .5,.5,-.5,
  ], 3));
  shapes.ramp.computeVertexNormals();
  shapes.shed.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5,-.5,-.5, -.5,-.5,.5, .5,.5,.5, -.5,-.5,-.5, .5,.5,.5, .5,.5,-.5,
    .5,-.5,.5, .5,-.5,-.5, .5,.5,-.5, .5,-.5,.5, .5,.5,-.5, .5,.5,.5,
    -.5,-.5,.5, .5,-.5,.5, .5,.5,.5, .5,-.5,-.5, -.5,-.5,-.5, .5,.5,-.5,
  ], 3));
  shapes.shed.computeVertexNormals();
  const plain = new THREE.MeshLambertMaterial({ color: 0xffffff });
  function part(shape, x, y, z, w, h, d, color, shadow = false, rotation = 0) {
    // Spatial batches retain useful frustum/shadow culling when the camera turns.
    const key = `${shape}/${shadow}/${Math.floor(x / 48)}/${Math.floor(z / 48)}`;
    if (!batches.has(key)) batches.set(key, { shape, shadow, items: [] });
    batches.get(key).items.push({ x, y, z, w, h, d, color, rotation });
  }
  const block = (x, y, z, w, h, d, color, shadow = false) => part('box', x, y, z, w, h, d, color, shadow);
  function bed(x, y, z, w, d) {
    block(x, y + .17, z, w, .34, d, 0xc4bfa9);
    block(x, y + .39, z, w - .25, .18, d - .25, winter ? 0xe1e7df : 0x607e57);
  }
  function tree(x, z, y = WALK_Y, scale = 1, shadow = false) {
    part('trunk', x, y + 1.65 * scale, z, .23 * scale, 3.3 * scale, .23 * scale, 0x796c51, shadow);
    const palette = winter ? [0x829b80, 0xa8b7a2, 0xc6d2c1]
      : season === 'autumn' ? [0x9b9b57, 0xb1ac64, 0x6f914f]
        : season === 'spring' ? [0x8cac71, 0x9ab87d, 0x84a86a] : [0x718f61, 0x829e6f, 0x6e9164];
    for (let i = 0; i < 3; i++) {
      part('crown', x + (i - 1) * .55 * scale, y + (4.4 + i * .42) * scale, z + (i % 2 ? .42 : -.25) * scale,
        (1.7 - i * .2) * scale, (2.05 - i * .15) * scale, 1.55 * scale, palette[i], shadow, rand() * 2);
    }
  }
  function hedge(x, y, z, w, d) {
    block(x, y + .22, z, w, .44, d, winter ? 0xc7d5c1 : 0x779366);
  }

  // These four districts share the same former 220-unit square edge. Continue
  // the surface beyond the orbit's widest ground footprint, keeping crossings
  // and lane widths at their original scale. Clamped UVs carry the roads at the
  // atlas border out into the distance instead of exposing the base/sky below.
  const roadGeometry = new THREE.PlaneGeometry(2000, 2000);
  const uv = roadGeometry.attributes.uv;
  const scale = 2000 / (ALDER.max - ALDER.min);
  for (let i = 0; i < uv.count; i++) uv.setXY(i,
    (uv.getX(i) - .5) * scale + .5, (uv.getY(i) - .5) * scale + .5);
  const road = new THREE.Mesh(roadGeometry,
    new THREE.MeshLambertMaterial({ map: roadTexture(season) }));
  road.name = 'district-ground';
  road.rotation.x = -Math.PI / 2;
  road.position.set(2, STREET_Y + .025, 2); road.receiveShadow = true; root.add(road);
  for (const p of pavements) {
    for (const cap of [false, true]) {
      const inset = cap ? .11 : 0;
      let pieces = [{ x0: p.x0 + inset, x1: p.x1 - inset, z0: p.z0 + inset, z1: p.z1 - inset }];
      for (const cut of [...pavingCuts, ...(district.cuts ?? [])]) pieces = pieces.flatMap(rect => subtractRectangle(rect, cut));
      for (const s of pieces) block((s.x0 + s.x1) / 2, WALK_Y + (cap ? .015 : -.115),
        (s.z0 + s.z1) / 2, s.x1 - s.x0, cap ? .03 : .23, s.z1 - s.z0,
        cap ? (winter ? 0xe2e8df : 0xd4d6c4) : 0xb7bcae);
    }
  }
  for (const r of ramps) {
    const top = WALK_Y + .03, bottom = STREET_Y + .027;
    const rotation = r.alongX ? (r.direction > 0 ? 0 : Math.PI) : -r.direction * Math.PI / 2;
    part('ramp', r.x, (top + bottom) / 2, r.z, 1.2, top - bottom, r.alongX ? r.d : r.w,
      winter ? 0xd6ddd5 : 0xd4d6c4, false, rotation);
  }
  // Parking sits beside the carriageway, not across the pedestrian crossings.
  for (const [i, p] of parking.entries()) {
    block(p.x, STREET_Y + .04, p.z, p.w, .02, p.d, 0x889697);
    const car = buildCar(p.x, p.z, [0x6d8b88, 0xc2b49a, 0xabb9b7][i], 0, season);
    car.position.y = STREET_Y + .05;
    root.add(car);
  }
  if (district.serviceYard) {
    // The cut in the paving and the apron share the loading elevation's dimensions.
    block(ROOM.W / 2, STREET_Y + .04, ROOM.D + 4.5, ROOM.W + 3, .08, 9, winter ? 0xcbd2cb : 0xb6beb3);
    block(-2.55, STREET_Y + .03, ROOM.D + 4.05, 2.1, .06, 5, 0x889697);
    if (!winter) {
      const bayW = loadingBayWidth(ROOM.W, ROOM.D);
      for (const fraction of loadingBayFractions()) {
        const x = ROOM.W / 2 + fraction * ROOM.W;
        for (const dx of [-bayW / 2, bayW / 2]) block(x + dx, STREET_Y + .094, ROOM.D + 3.4, .12, .012, 5.4, 0xe1dbc0);
      }
    }
  }

  // The park's paths meet the surrounding pavement and the mid-block crossing.
  const park = ALDER.park, parkX = (park.x0 + park.x1) / 2, parkZ = (park.z0 + park.z1) / 2;
  block(parkX, WALK_Y + .07, parkZ, park.x1 - park.x0, .06, park.z1 - park.z0, winter ? 0xe0e6d9 : 0x9caf80);
  const path = winter ? 0xcbd5cb : 0xddd5ba;
  // Four lawns leave one continuous, level loop and a path across the park.
  for (const [x, z, w, d] of [[-19, 23.7, 3, 47.4], [-51.6, 23.7, 3, 47.4],
    [-35.3, 4, 29.6, 3], [-35.3, 43.4, 29.6, 3], [-35.3, 18, 29.6, 3], [-16.4, 18, 2.2, 3]]) {
    // Flat path pieces are deliberately trimmed at their junctions.
    block(x, WALK_Y + .12, z, w, .02, d, path);
  }
  // Calm water, a planted rain garden and a small solar pergola.
  const shore = new THREE.Mesh(new THREE.RingGeometry(.97, 1.07, 40), new THREE.MeshLambertMaterial({ color: winter ? 0xcbd6c8 : 0xb6b396 }));
  const pondWidth = style === 'industrial' ? 11 : style === 'paris' ? 6.5 : 9;
  shore.rotation.x = -Math.PI / 2; shore.scale.set(pondWidth, 5.3, 1);
  shore.position.set(-36, WALK_Y + .155, 31); root.add(shore);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshLambertMaterial({ color: winter ? 0xb4d0d1 : 0x78a6a1 }));
  pond.rotation.x = -Math.PI / 2; pond.scale.set(pondWidth, 5.3, 1);
  pond.position.set(-36, WALK_Y + .135, 31); root.add(pond);
  // A short timber crossing connects the two halves of the park over the water.
  block(-35.8, WALK_Y + .2, 31, 2.2, .13, 12.1, 0xb0a27e);
  for (const [from, to] of [[19.5, 24.95], [37.05, 41.9]]) {
    block(-35.8, WALK_Y + .12, (from + to) / 2, 2.2, .02, to - from, path);
  }
  for (const [x, z] of [[-45, 32], [-40, 37.2], [-31, 36.5], [-25, 31]]) bed(x, WALK_Y + .11, z, 3.6, 1.2);
  for (const x of [-44.5, -40.5, -36.5]) {
    for (const z of [8, 13]) block(x, WALK_Y + 1.9, z, .12, 3.8, .12, 0x687b70);
    block(x, WALK_Y + 3.9, 10.5, 3.8, .14, 5.6, 0x44666c);
  }
  for (const z of [2, 11, 26, 40, 46]) {
    tree(-23.5, z, WALK_Y + .1, .9 + rand() * .15, true);
    tree(-47.5, z, WALK_Y + .1, 1 + rand() * .15, true);
  }
  for (const [x, z, rot] of [[-21, 23, 0], [-49.5, 23, 0], [-42, 6.2, Math.PI / 2], [-30, 41, Math.PI / 2]]) {
    part('box', x, WALK_Y + .52, z, .7, .15, 2.3, 0xa59876, false, rot);
    for (const offset of [-.7, .7]) part('box', x + Math.sin(rot) * offset, WALK_Y + .25, z + Math.cos(rot) * offset, .45, .5, .15, 0x647b70, false, rot);
  }

  const { map, emissiveMap } = facadeAtlas(style, palette);
  const facadeMaterial = new THREE.MeshLambertMaterial({ map, emissiveMap, emissive: 0xffffff });
  const positions = [], normals = [], uvs = [];
  function facade(points, normal, style, floors) {
    const col = style, row = Math.max(0, Math.min(3, floors - 2));
    const uv = [[(col * 256 + 3) / 1024, 1 - (row * 256 + 253) / 1024],
      [(col * 256 + 253) / 1024, 1 - (row * 256 + 253) / 1024],
      [(col * 256 + 253) / 1024, 1 - (row * 256 + 3) / 1024],
      [(col * 256 + 3) / 1024, 1 - (row * 256 + 3) / 1024]];
    for (const i of [0, 1, 2, 0, 2, 3]) { positions.push(...points[i]); normals.push(...normal); uvs.push(...uv[i]); }
  }
  function volume(x, y, z, w, h, d, family, greenRoof = true) {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    block(x, y + h / 2, z, w, h, d, palette[family]);
    const count = style === 'tower' ? Math.ceil(h / 16) : 1;
    for (let band = 0; band < count; band++) {
      const lo = y + .28 + band * (h - .54) / count;
      const hi = y + .28 + (band + 1) * (h - .54) / count;
      const f = Math.round(h / count / 3.2);
      facade([[x0, lo, z1 + .025], [x1, lo, z1 + .025], [x1, hi, z1 + .025], [x0, hi, z1 + .025]], [0, 0, 1], family, f);
      facade([[x1 + .025, lo, z1], [x1 + .025, lo, z0], [x1 + .025, hi, z0], [x1 + .025, hi, z1]], [1, 0, 0], family, f);
      facade([[x1, lo, z0 - .025], [x0, lo, z0 - .025], [x0, hi, z0 - .025], [x1, hi, z0 - .025]], [0, 0, -1], family, f);
      facade([[x0 - .025, lo, z0], [x0 - .025, lo, z1], [x0 - .025, hi, z1], [x0 - .025, hi, z0]], [-1, 0, 0], family, f);
    }
    if (!greenRoof) return;
    block(x, y + h + .12, z, w + .45, .24, d + .45, 0xe0dccb);
    block(x, y + h + .28, z, w - .45, .07, d - .45, winter ? 0xd7e0d1 : 0x88a37b);
  }

  const roofPositions = [], roofColours = [];
  function roofQuad(points, tint) {
    const a = new THREE.Vector3(...points[0]), b = new THREE.Vector3(...points[1]), c = new THREE.Vector3(...points[2]);
    const order = b.sub(a).cross(c.sub(a)).y < 0 ? [0,2,1,0,3,2] : [0,1,2,0,2,3];
    const colour = new THREE.Color(tint);
    for (const i of order) { roofPositions.push(...points[i]); roofColours.push(colour.r, colour.g, colour.b); }
  }
  function courtyard(b, y) {
    const wall = 4.8, innerW = b.w - wall * 2, innerD = b.d - wall * 2;
    for (const dz of [-1, 1]) volume(b.x, y, b.z + dz * (b.d - wall) / 2, b.w, b.h, wall, b.facade, false);
    for (const dx of [-1, 1]) volume(b.x + dx * (b.w - wall) / 2, y, b.z, wall, b.h, innerD, b.facade, false);
    const ring = (w, d, height) => [[-1,-1],[1,-1],[1,1],[-1,1]].map(([dx,dz]) =>
      [b.x + dx * w / 2, height, b.z + dz * d / 2]);
    const bottom = y + b.h + .04, top = bottom + 2.8;
    const outer = ring(b.w + .4, b.d + .4, bottom), ridge = ring(b.w - 2.4, b.d - 2.4, top);
    const innerRidge = ring(innerW + 2.4, innerD + 2.4, top), inner = ring(innerW, innerD, bottom);
    const zinc = winter ? 0xb9c8c9 : (b.facade === 2 ? 0x81969b : 0x73888f);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      roofQuad([outer[i], outer[j], ridge[j], ridge[i]], zinc);
      roofQuad([ridge[i], ridge[j], innerRidge[j], innerRidge[i]], zinc);
      roofQuad([innerRidge[i], innerRidge[j], inner[j], inner[i]], zinc);
    }
    for (const dx of [-b.w * .29, 0, b.w * .29]) {
      block(b.x + dx, bottom + 1.22, b.z + b.d / 2 - .48, 1.2, 1.45, 1.25, zinc);
      block(b.x + dx, bottom + 1.31, b.z + b.d / 2 + .165, .68, .82, .025, 0x3d5961);
    }
    for (const dz of [-b.d * .22, b.d * .22]) {
      block(b.x - b.w / 2 + 2.1, top + .44, b.z + dz, 1.35, 1.25, .85, 0xa68c75);
      for (const dx of [-.35, .35]) part('trunk', b.x - b.w / 2 + 2.1 + dx, top + 1.38, b.z + dz,
        .16, .75, .16, 0x9e7157);
    }
    bed(b.x, y + .04, b.z, Math.max(2, innerW - 2), Math.max(2, innerD - 3));
    for (const dz of [-innerD * .23, innerD * .23]) tree(b.x, b.z + dz, y + .46, .78);
  }
  for (const b of district.buildings ?? buildings) {
    const y = WALK_Y + .05;
    if (style === 'paris') { courtyard(b, y); continue; }
    if (style === 'industrial' && !b.terrace) {
      volume(b.x, y, b.z, b.w, b.h, b.d, b.facade, false);
      const teeth = Math.max(3, Math.round(b.w / 5)), pitch = b.w / teeth;
      for (let i = 0; i < teeth; i++) {
        const x = b.x - b.w / 2 + (i + .5) * pitch;
        part('shed', x, y + b.h + .9, b.z, pitch, 1.8, b.d + .25, winter ? 0xc5d0ca : 0x82978c);
        block(x + pitch / 2 + .026, y + b.h + .9, b.z, .025, 1.4, b.d - .2, 0x74969a);
      }
      bed(b.x, y, b.z + b.d / 2 + 1.1, b.w * .75, 1.1);
      continue;
    }
    volume(b.x, y, b.z, b.w, b.h, b.d, b.facade);
    if (b.terrace) {
      const h = b.towerHeight ?? 6.4, upperY = y + b.h + .34;
      volume(b.x - .6, upperY, b.z - 1.6, b.w - 5.2, h, b.d - 5.4, b.facade);
      hedge(b.x, upperY, b.z + b.d / 2 - .75, b.w - 1.5, .8);
      for (const dx of [-b.w / 2 + 1.5, b.w / 2 - 1.5]) tree(b.x + dx, b.z + b.d / 2 - 1.8, upperY, .45);
      // Vertical green along a few bays: occupied balconies, not uniform green caps.
      for (const dx of [-b.w * .28, b.w * .28]) {
        bed(b.x + dx, y + b.h * .5, b.z + b.d / 2 + .33, 3.2, 1.05);
      }
      if (b.facade !== 1) {
        for (const dz of [-1.1, 1.1]) block(b.x - .6, upperY + h + .48, b.z - 1.6 + dz, b.w * .4, .16, 1.8, 0x496b73);
      }
      if (style === 'tower') {
        for (const level of [.34, .68]) {
          block(b.x - .6, upperY + h * level, b.z + (b.d - 5.4) / 2 - 1.2, b.w - 4.5, .22, 1.3, 0xb8c6b5);
          hedge(b.x - .6, upperY + h * level + .13, b.z + (b.d - 5.4) / 2 - 1.0, b.w - 5, .7);
        }
      }
    }
    // A narrow shop canopy establishes a human-scaled ground floor.
    if (b.z > -35 && b.z < -15) {
      block(b.x, y + 3.2, b.z + b.d / 2 + .65, b.w * .78, .16, 1.8, b.facade === 1 ? 0x758f80 : 0xbdb590);
      bed(b.x - b.w / 2 + 1, y, b.z + b.d / 2 + 1.4, 1.8, 1.2);
    }
  }
  if (style === 'tower') {
    const deck = WALK_Y + .05 + 9.6 + .42;
    block(16.5, deck, -25, 3.5, .12, 2.5, 0xb6c2ad);
    for (const z of [-26.2, -23.8]) block(16.5, deck + .61, z, 3.5, 1.1, .05, 0x8ca195);
  }
  if (roofPositions.length) {
    const roofGeometry = new THREE.BufferGeometry();
    roofGeometry.setAttribute('position', new THREE.Float32BufferAttribute(roofPositions, 3));
    roofGeometry.setAttribute('color', new THREE.Float32BufferAttribute(roofColours, 3));
    roofGeometry.computeVertexNormals();
    const roofs = new THREE.Mesh(roofGeometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
    roofs.name = 'courtyard-mansards'; root.add(roofs);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const facades = new THREE.Mesh(geometry, facadeMaterial); facades.name = 'alder-facades';
  markLitWindow(facades, .65); root.add(facades);

  // Pocket gardens connect the planted roofs to the park at street level.
  for (const [x, z, w, d] of district.beds ?? [[25, -39, 48, 5], [-36, -37, 37, 4], [46, 10, 16, 23], [12, 39, 24, 12], [43, 38, 17, 12]]) {
    bed(x, WALK_Y + .04, z, w, d);
    for (let dx = -w / 2 + 2; dx < w / 2; dx += 7) tree(x + dx, z, WALK_Y + .46, .7);
  }
  for (const [x, z] of [[-1.7, 9], [-1.7, 30], [8, -14.3], [31, -14.3], [53, -14.3], [-58, 9], [-58, 34]]) {
    tree(x, z, WALK_Y + .03, .78, true);
  }
  for (const [x, z, angle] of [[4, -2.1, Math.PI / 2], [30, -2.1, Math.PI / 2], [-2.1, 24, Math.PI], [-13.1, 6, 0]]) {
    root.add(buildStreetLamp(x, z, WALK_Y, .82, season, angle));
  }

  for (const [key, batch] of batches) {
    const mesh = new THREE.InstancedMesh(shapes[batch.shape], plain, batch.items.length);
    mesh.name = `alder-${key}`; mesh.castShadow = batch.shadow; mesh.receiveShadow = true;
    const transform = new THREE.Object3D(), color = new THREE.Color();
    batch.items.forEach((p, i) => {
      transform.position.set(p.x, p.y, p.z); transform.scale.set(p.w, p.h, p.d);
      transform.rotation.set(0, p.rotation, 0); transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix); mesh.setColorAt(i, color.setHex(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); root.add(mesh);
  }
  return root;
}
