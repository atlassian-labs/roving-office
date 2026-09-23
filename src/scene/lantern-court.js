// A low pavilion: shoji light, precise timber rhythms and an open garden edge.
import * as THREE from 'three';
import { ROOM, WINDOW_LEDGE_Y, windowSpan } from '../config.js';
import { DECOR } from '../layout.js';
import { group, box, put } from './build.js';
import { markNightLight } from './night-lights.js';
import { seeded } from './outlooks/streetscape.js';

export const LANTERN_HEIGHT = 7.8;
export const LANTERN_PORTAL_WIDTH = 5.25;
const TIMBER = 0x342e29, CEDAR = 0x695443, STONE = 0x797a71;

// Repeated joinery is one draw call, with a real bounding sphere for culling.
function joinery(parent) {
  const parts = [], dummy = new THREE.Object3D(), colour = new THREE.Color();
  return {
    add(w, h, d, x, y, z, tone = TIMBER) { parts.push({ w, h, d, x, y, z, tone }); },
    finish() {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: .86 }), parts.length);
      mesh.name = 'lantern-timber-joinery';
      parts.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z); dummy.scale.set(p.w, p.h, p.d); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, colour.setHex(p.tone));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); parent.add(mesh);
    },
  };
}

function floorTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 1040; canvas.height = 800;
  const c = canvas.getContext('2d'), rand = seeded(20531);
  c.fillStyle = '#605347'; c.fillRect(0, 0, canvas.width, canvas.height);
  // A timber perimeter protects the woven field. Each rectangle has a narrow
  // dark cloth binding; alternate the fine weave rather than a checkerboard.
  const edge = 40, cols = 4, rows = 5, w = 240, h = 144;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = edge + col * w, y = edge + row * h;
    c.fillStyle = '#4a4c3e'; c.fillRect(x + 1, y + 1, w - 2, h - 2);
    c.fillStyle = (row + col) % 2 ? '#c8bf99' : '#c4b98f'; c.fillRect(x + 4, y + 4, w - 8, h - 8);
    for (let line = 5; line < h - 5; line += 2) {
      c.fillStyle = `rgba(79,76,44,${.03 + rand() * .09})`;
      c.fillRect(x + 4, y + line, w - 8, .65);
    }
    for (let line = 7; line < w - 5; line += 6) {
      c.fillStyle = 'rgba(255,246,212,.10)'; c.fillRect(x + line, y + 4, .8, h - 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4; return texture;
}

export function buildLanternFloor() {
  const g = group(); g.name = 'lantern-woven-floor';
  const material = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: .96 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM.W, .2, ROOM.D), material);
  floor.position.set(ROOM.W / 2, 0, ROOM.D / 2); floor.receiveShadow = true; g.add(floor);
  return g;
}

function paperTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d'), rand = seeded(20532);
  c.fillStyle = '#f1e8d1'; c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    c.strokeStyle = `rgba(118,101,66,${.025 + rand() * .05})`; c.lineWidth = .5;
    const x = rand() * 128, y = rand() * 128;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + rand() * 6 - 3, y + 1 + rand() * 7); c.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildLanternCourt() {
  const g = group(); g.name = 'lantern-court';
  const wood = joinery(g), paperMap = paperTexture();
  const paper = new THREE.MeshStandardMaterial({ map: paperMap, color: 0xfff6df, roughness: 1,
    side: THREE.DoubleSide, emissive: 0xffcb86, emissiveIntensity: 0 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xc9d8d0, roughness: .20,
    transparent: true, opacity: .075, depthWrite: false, side: THREE.DoubleSide });
  markNightLight(g, { emissive: [paper], emissiveIntensity: .8 });
  put(g, box(ROOM.W - .02, .92, ROOM.D - .02, STONE, { cast: false, rough: 1 }), ROOM.W / 2, -.67, ROOM.D / 2);

  function bay(start, end, back, shoji = false) {
    const length = end - start, centre = (start + end) / 2;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(length - .17, 7.12), shoji ? paper : glass);
    plane.name = shoji ? 'lantern-shoji' : 'lantern-picture-window';
    plane.position.set(back ? centre : -.045, 3.93, back ? -.045 : centre);
    if (!back) plane.rotation.y = Math.PI / 2;
    // Paper blocks direct rays but still receives the broad daylight fill.
    plane.castShadow = shoji; plane.receiveShadow = true; g.add(plane);
    for (const endPoint of [start, end]) wood.add(back ? .17 : .28, 7.4, back ? .28 : .17,
      back ? endPoint : 0, 3.89, back ? 0 : endPoint);
    for (const y of [.27, 7.58]) wood.add(back ? length : .30, .16, back ? .30 : length,
      back ? centre : .025, y, back ? .025 : centre);
    if (shoji) {
      const divisions = Math.max(2, Math.round(length / 1.25));
      for (let i = 1; i < divisions; i++) wood.add(back ? .045 : .06, 7.1, back ? .06 : .045,
        back ? start + length * i / divisions : .025, 3.93, back ? .025 : start + length * i / divisions, CEDAR);
      for (let i = 1; i < 6; i++) wood.add(back ? length - .17 : .07, .038, back ? .07 : length - .17,
        back ? centre : .035, .38 + 7.1 * i / 6, back ? .035 : centre, CEDAR);
    } else {
      // Transom stays above the existing window apertures used by paper planes.
      wood.add(back ? length : .13, .07, back ? .13 : length, back ? centre : .02, 7.03, back ? .02 : centre);
    }
  }
  bay(5.37, 11.92, true); bay(12.12, 14.58, true, true);
  bay(14.78, 21.65, true); bay(21.85, 25.9, true, true);
  bay(.15, 4.06, false, true); bay(4.26, 11.30, false); bay(11.50, 13.91, false, true);

  // Charred timber end wall with a simple pale clock recess, kept free of foliage.
  put(g, box(.28, 7.50, 5.89, TIMBER), -.025, 3.9, 17.055);
  const clock = DECOR.wallClock;
  for (let z = 14.35; z < 20; z += .42) {
    if (Math.abs(z - clock.z) > clock.w / 2 + .35) wood.add(.09, 7.35, .038, .16, 3.9, z, CEDAR);
  }
  put(g, box(.075, clock.h + .52, clock.w + .50, 0xd8ceb7, { cast: false }), .175, clock.y, clock.z);
  // A spare alcove above the clock, with one quiet burgundy panel.
  put(g, box(.39, .16, 4.8, CEDAR), .08, 2.95, 17.15);
  put(g, box(.035, 1.02, 1.5, 0x68454a, { cast: false }), .145, 6.46, 17.05);

  // The original ledge ornaments keep their supported positions and apertures.
  for (const [wall, index] of [['back', 0], ['back', 1], ['left', 0]]) {
    const span = windowSpan(wall, index), back = wall === 'back';
    wood.add(back ? span.width + .20 : .53, .13, back ? .53 : span.width + .20,
      back ? span.centre : .10, WINDOW_LEDGE_Y - .065, back ? .10 : span.centre, CEDAR);
  }

  // Horizontal eaves project outwards; their short inward returns keep desks visible.
  wood.add(ROOM.W + 1.55, .34, 2.25, ROOM.W / 2 - .15, 7.99, -.67);
  wood.add(2.25, .34, ROOM.D + .2, -.67, 7.99, 10.60);
  wood.add(ROOM.W + 1.8, .12, 2.48, ROOM.W / 2 - .15, 8.25, -.72, 0x555852);
  wood.add(2.48, .12, ROOM.D + .2, -.72, 8.25, 10.72, 0x555852);
  for (let x = .55; x < ROOM.W; x += 1.35) wood.add(.095, .12, 2.14, x, 7.75, -.60, CEDAR);
  for (let z = 1.55; z < ROOM.D; z += 1.35) wood.add(2.14, .12, .095, -.60, 7.75, z, CEDAR);

  // An engawa veranda sits wholly outside the editable floor and door approach.
  wood.add(20.5, .22, 2.15, 15.9, -.05, -1.32, CEDAR);
  wood.add(2.15, .22, 20.3, -1.32, -.05, 9.95, CEDAR);
  for (let z = -.1; z < 20; z += .48) wood.add(2.10, .018, .017, -1.32, .069, z);
  for (let x = 5.9; x < 26; x += .48) wood.add(.017, .018, 2.10, x, .069, -1.32);
  wood.add(ROOM.W + .26, .36, .27, ROOM.W / 2, -.13, ROOM.D + .12);
  wood.add(.27, .36, ROOM.D, ROOM.W + .12, -.13, ROOM.D / 2);

  // Square paper lanterns, restrained in daylight and warm after dark. Their
  // emissive faces reuse the existing night-light controller, with no new lights.
  for (const [x, z] of [[12.85, .65], [.65, 12.75]]) {
    const back = z < 2;
    wood.add(back ? .08 : .8, .12, back ? .8 : .08,
      back ? x : .35, 7.79, back ? .35 : z);
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(.74, 1.12, .74), paper);
    lantern.position.set(x, 6.35, z); lantern.name = 'lantern-paper-pendant'; g.add(lantern);
    wood.add(.028, .84, .028, x, 7.35, z);
    for (const y of [5.76, 6.94]) wood.add(.85, .06, .85, x, y, z);
    for (const dx of [-.38, .38]) for (const dz of [-.38, .38]) wood.add(.035, 1.16, .035, x + dx, 6.35, z + dz);
  }
  wood.finish();
  return g;
}
