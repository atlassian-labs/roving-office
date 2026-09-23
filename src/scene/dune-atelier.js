// The thickness is the architecture: punched arches and soft plaster reveals,
// not a glass conservatory with a different palette. All mass sits at the edge
// of the established floor so agents and user-authored layouts keep their room.
import * as THREE from 'three';
import { ROOM, WINDOW_SILL_Y, WINDOW_HEAD_Y, WINDOW_LEDGE_Y, windowSpan } from '../config.js';
import { DECOR } from '../layout.js';
import { box, cyl, group, put } from './build.js';
import { markNightLight } from './night-lights.js';
import { seeded } from './outlooks/streetscape.js';

export const DUNE_HEIGHT = 10.3;
export const DUNE_PORTAL_WIDTH = 5.25;
const PLASTER = 0xe4cda5, CLAY = 0xa76040, TIMBER = 0x785039;

function plasterTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d'), rand = seeded(20521);
  c.fillStyle = '#f4e8d4'; c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3200; i++) {
    c.fillStyle = i % 2 ? 'rgba(152,112,64,.035)' : 'rgba(255,255,248,.08)';
    c.fillRect(rand() * 256, rand() * 256, .5 + rand() * 3, .5 + rand() * 2);
  }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(.45, .45);
  return map;
}

export function buildDuneFloor() {
  const g = group(); g.name = 'dune-handmade-clay-floor';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d'), rand = seeded(20522);
  c.fillStyle = '#9a6c51'; c.fillRect(0, 0, 512, 512);
  // A four-tile repeat preserves larger, calm squares at the normal zoom level.
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const x = col * 256, y = row * 256;
    c.fillStyle = ['#bd7853', '#c7855d', '#b77350', '#c27e56'][row * 2 + col];
    c.fillRect(x + 2, y + 2, 252, 252);
    for (let i = 0; i < 1300; i++) {
      c.fillStyle = i % 2 ? 'rgba(99,40,21,.025)' : 'rgba(255,208,147,.035)';
      c.fillRect(x + 3 + rand() * 247, y + 3 + rand() * 247, rand() * 4 + .5, rand() * 3 + .5);
    }
  }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(6.5, 5); map.anisotropy = 4;
  // A horizontal plane gives the map world-aligned UVs; the separate fascia is
  // below its visible top, so no tile/edge coplanar pair flickers at a distance.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.W, ROOM.D),
    new THREE.MeshStandardMaterial({ map, roughness: .91 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(ROOM.W / 2, .1, ROOM.D / 2);
  floor.receiveShadow = true; g.add(floor);
  put(g, box(ROOM.W, .2, ROOM.D, CLAY), ROOM.W / 2, -.03, ROOM.D / 2);
  return g;
}

/** Elliptical crown above the established rectangular flight aperture. */
function archPath(path, span, bottom = WINDOW_SILL_Y - .04) {
  const side = WINDOW_HEAD_Y + .15, rise = 2.15, extra = .08;
  path.moveTo(span.from - extra, bottom);
  path.lineTo(span.to + extra, bottom);
  path.lineTo(span.to + extra, side);
  path.absellipse(span.centre, side, span.width / 2 + extra, rise, 0, Math.PI, false);
  path.lineTo(span.from - extra, bottom);
  return path;
}

function punchedWall(from, to, windows, material) {
  const shape = new THREE.Shape(), radius = .34;
  shape.moveTo(from, -.04); shape.lineTo(to, -.04);
  shape.lineTo(to, DUNE_HEIGHT - radius);
  shape.quadraticCurveTo(to, DUNE_HEIGHT, to - radius, DUNE_HEIGHT);
  shape.lineTo(from + radius, DUNE_HEIGHT);
  shape.quadraticCurveTo(from, DUNE_HEIGHT, from, DUNE_HEIGHT - radius);
  shape.closePath();
  for (const span of windows) shape.holes.push(archPath(new THREE.Path(), span));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.14, bevelEnabled: true, bevelThickness: .07, bevelSize: .055,
    bevelSegments: 3, steps: 1, curveSegments: 18,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

export function buildDuneAtelier() {
  const g = group(); g.name = 'dune-atelier';
  const plaster = new THREE.MeshStandardMaterial({ color: PLASTER, map: plasterTexture(), roughness: .96 });
  // Thickness projects outside: the interior face remains behind the existing
  // wall clock, shelves and windowsill ornaments.
  const backSpans = [windowSpan('back', 0), windowSpan('back', 1)];
  put(g, punchedWall(DUNE_PORTAL_WIDTH + .015, ROOM.W, backSpans, plaster), 0, 0, -1.14);
  const left = punchedWall(.12, ROOM.D, [windowSpan('left', 0)], plaster);
  left.rotation.y = -Math.PI / 2; g.add(left);
  put(g, box(ROOM.W, 1.12, ROOM.D, 0xb99266, { rough: 1 }), ROOM.W / 2, -.71, ROOM.D / 2);

  // The glazing is intentionally recessed. The full arch is one inexpensive
  // transparent surface, with no reflection pass or dark slab inside the room.
  const glass = new THREE.MeshStandardMaterial({ color: 0xcbd1bb, transparent: true,
    opacity: .10, roughness: .28, depthWrite: false, side: THREE.DoubleSide });
  for (const [wall, index] of [['back', 0], ['back', 1], ['left', 0]]) {
    const span = windowSpan(wall, index), back = wall === 'back';
    const pane = new THREE.Mesh(new THREE.ShapeGeometry(archPath(new THREE.Shape(), span), 24), glass);
    if (back) pane.position.z = -.76;
    else { pane.rotation.y = -Math.PI / 2; pane.position.x = -.76; }
    pane.name = 'dune-recessed-glazing'; g.add(pane);
    put(g, box(back ? span.width + .18 : .88, .18, back ? .88 : span.width + .18, PLASTER),
      back ? span.centre : -.03, WINDOW_LEDGE_Y - .09, back ? -.03 : span.centre);
    // One bronze transom below the arched head: the curve stays uninterrupted.
    put(g, box(back ? span.width : .055, .055, back ? .055 : span.width, TIMBER, { cast: false }),
      back ? span.centre : -.7, WINDOW_HEAD_Y + .16, back ? -.7 : span.centre);
  }

  // A low sculpted edge and short pergola give real directional shadow without
  // putting a ceiling over the agents. Sparse detail keeps the plaster dominant.
  for (let z = 1.25; z < 12; z += 1.4) {
    put(g, box(3.1, .17, .14, TIMBER), .52, DUNE_HEIGHT + .17, z);
  }
  put(g, box(.19, .32, 11.8, TIMBER), 1.83, DUNE_HEIGHT + .09, 6.15);
  // Thin earthen strata on the unpierced wall end, below and above the clock.
  for (const y of [1.4, 2.8, 6.4, 7.9, 9.3]) {
    put(g, box(.027, .022, 7.9, 0xc5a075, { cast: false }), .078, y, 16.0);
  }
  const clock = DECOR.wallClock;
  put(g, box(.08, clock.h + .28, clock.w + .34, 0xcba379, { cast: false }), .12, clock.y, clock.z);

  // Two terracotta pendants make little amber pools in the plaster at night.
  // Their emissive interiors join the existing night-light system, not new lights.
  for (const [x, z] of [[12.9, .9], [.9, 12.2]]) {
    // A short bronze bracket reaches from the plaster to each pendant cable.
    const back = z < 2;
    put(g, box(back ? .08 : 1.4, .08, back ? 1.4 : .08, TIMBER),
      back ? x : .3, 10.25, back ? .3 : z);
    const pendant = group(x, 8.2, z);
    put(pendant, cyl(.018, .018, 2.0, TIMBER, { segments: 5, cast: false }), 0, 1.05, 0);
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(.24, .64, .64, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: CLAY, roughness: .95, side: THREE.DoubleSide }));
    hood.position.y = -.28; hood.castShadow = true; pendant.add(hood);
    const glow = new THREE.MeshStandardMaterial({ color: 0xffdca1, emissive: 0xffb74b, emissiveIntensity: 1 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.14, 10, 6), glow);
    bulb.position.y = -.47; pendant.add(bulb);
    markNightLight(pendant, { emissive: [glow], emissiveIntensity: 1.7 }); g.add(pendant);
  }
  return g;
}
