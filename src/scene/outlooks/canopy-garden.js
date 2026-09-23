// A pocket of urban woodland: close tree canopies, garden paths and low pavilions.
import * as THREE from 'three';
import { DOOR, STREET_Y } from '../../config.js';
import { box, group, put } from '../build.js';
import { planting } from '../canopy-planting.js';
import { seeded } from './streetscape.js';

const GREENS = {
  summer: [0x315134, 0x4b7040, 0x79934f, 0x9caf6c],
  spring: [0x4a7240, 0x6c914d, 0xa1b970, 0x90a661],
  autumn: [0x54623c, 0x8b853f, 0xbaa058, 0x98713d],
  winter: [0x3c5547, 0x647563, 0x91a38c, 0xb2bda7],
};

const GARDEN_SPAN = 160;
const GROUND_SPAN = 2000;

function gardenTexture(season) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const c = canvas.getContext('2d'), rand = seeded(2048);
  c.fillStyle = season === 'winter' ? '#d2d6c5' : '#849066'; c.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 7000; i++) {
    const x = rand() * 1024, y = rand() * 1024;
    // Settle to the base colour at the texture border. Clamping this border
    // across the far field then continues the grass without a square seam.
    c.globalAlpha = Math.min(1, Math.max(0, (Math.min(x, y, 1024 - x, 1024 - y) - 16) / 112));
    c.fillStyle = i % 2 ? 'rgba(232,220,169,.065)' : 'rgba(39,63,36,.045)';
    c.fillRect(x, y, 2 + rand() * 5, 2 + rand() * 5);
  }
  c.globalAlpha = 1;
  // Texture/world coordinates share an origin and scale. Both strokes follow one
  // curve: the wider one is the path edging, not a second overlapping ground mesh.
  c.translate(512, 512); c.scale(1024 / GARDEN_SPAN, 1024 / GARDEN_SPAN);
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const [colour, width] of [['#b7b99a', 3.7], ['#d6c9a8', 3.2]]) {
    c.strokeStyle = colour; c.lineWidth = width; c.beginPath();
    c.moveTo(DOOR.x, -3.2); c.lineTo(DOOR.x, -9);
    c.bezierCurveTo(3.4, -19, -23, -16, -30, -31);
    c.bezierCurveTo(-37, -46, -7, -52, 14, -47);
    c.bezierCurveTo(49, -39, 45, 18, 35, 31);
    c.bezierCurveTo(25, 42, -7, 39, -19, 30); c.stroke();
  }
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildCanopyGarden(parent, season = 'summer') {
  const g = group(); g.name = 'canopy-woodland'; parent.add(g);
  // Still two triangles and the same texture. Keep paths at their original
  // world coordinates; UVs beyond the garden clamp to its plain grass border.
  const geometry = new THREE.PlaneGeometry(GROUND_SPAN, GROUND_SPAN);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i,
    (uv.getX(i) - .5) * GROUND_SPAN / GARDEN_SPAN + .5,
    (uv.getY(i) - .5) * GROUND_SPAN / GARDEN_SPAN + .5);
  const ground = new THREE.Mesh(geometry,
    new THREE.MeshLambertMaterial({ map: gardenTexture(season) }));
  ground.name = 'canopy-garden-ground';
  ground.rotation.x = -Math.PI / 2; ground.position.y = STREET_Y + .025;
  ground.receiveShadow = true; g.add(ground);
  const near = planting(g, { seed: 2049, greens: GREENS[season], shadows: true });
  // The close trees are beyond the facade, and never in the entrance approach.
  for (const [x, z, h, r] of [[-7, 3, 13, 4], [-7, 14, 15, 4.5], [12, -8, 14, 4],
    [24, -8, 12, 3.5], [-15, -9, 15, 4.8], [33, 1, 13, 4], [35, 19, 10, 3.8]]) {
    near.tree(x, STREET_Y, z, h, r, 64);
    near.fern(x + .7, STREET_Y + .04, z + .5, 1.1, 6);
  }
  near.finish();
  const distant = planting(g, { seed: 2050, greens: GREENS[season], shadows: false });
  for (let i = 0; i < 20; i++) {
    const a = i * 2.399, radius = 40 + distant.rand() * 21;
    distant.tree(10 + Math.cos(a) * radius, STREET_Y, 7 + Math.sin(a) * radius,
      10 + distant.rand() * 10, 4 + distant.rand() * 3, 32);
  }
  // A few inhabited neighbours make this an urban garden, not a lone cabin.
  for (const [x, z, w, d, h] of [[-34, -23, 12, 9, 9], [32, -33, 15, 11, 12], [-33, 35, 13, 10, 8]]) {
    put(g, box(w, h, d, 0x8e9680, { rough: .85, cast: false }), x, STREET_Y + h / 2, z);
    for (const y of [h * .35, h * .72]) {
      put(g, box(w + .4, .28, d + .4, 0xbbaa86, { cast: false }), x, STREET_Y + y - 1.2, z);
      put(g, box(w - .7, 1.85, .035, 0x536c64, { rough: .3, cast: false }), x, STREET_Y + y, z + d / 2 + .025);
    }
    put(g, box(w + .7, .36, d + .7, 0xc2b89b, { cast: false }), x, STREET_Y + h + .2, z);
    for (let k = 0; k < 5; k++) distant.fern(x - w / 2 + 1.2 + k * (w - 2.4) / 4,
      STREET_Y + h + .4, z + d / 2 - .5, .9, 5);
  }
  distant.finish();
  return g;
}

export const outlook = {
  id: 'canopy-garden', label: 'Woodland garden', aerial: false,
  ground: season => ({ y: STREET_Y - .02, color: season === 'winter' ? 0xc8d0c0 : 0x8e9979 }),
  build(g, { season }) { buildCanopyGarden(g, season); },
};
