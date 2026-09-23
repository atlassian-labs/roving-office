// A Nordic harbour pavilion: an ash floor, thin dark framing and long clear views.
import * as THREE from 'three';
import { ROOM, WINDOW_LEDGE_Y, windowSpan } from '../config.js';
import { DECOR } from '../layout.js';
import { box, cyl, group, put } from './build.js';
import { markNightLight } from './night-lights.js';
import { seeded } from './outlooks/streetscape.js';

export const TIDE_HEIGHT = 8.6;
export const TIDE_PORTAL_WIDTH = 5.25;
const INK = 0x294553, ASH = 0xc4bba3, LINEN = 0xe4e4d9;

function ashTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 1024;
  const c = canvas.getContext('2d'), rand = seeded(20501);
  c.fillStyle = '#ded9c9'; c.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 150; i++) {
    const x = rand() * 256;
    c.strokeStyle = `rgba(107,111,105,${.025 + rand() * .08})`;
    c.lineWidth = .5 + rand(); c.beginPath(); c.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 32) c.lineTo(x + Math.sin(y * .005 + i) * 3, y);
    c.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildTideFloor() {
  const g = group(); g.name = 'tide-ash-floor';
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: ashTexture(), roughness: .73 }), 20 * 4);
  const dummy = new THREE.Object3D(), colour = new THREE.Color(), rand = seeded(20502);
  let index = 0;
  // Long pale boards run toward the water; the floor plate and its height stay put.
  for (let x = 0; x < 20; x++) for (let z = 0; z < 4; z++) {
    const offset = x % 2 ? 1.3 : 0;
    const start = z === 0 ? 0 : z * 5 - offset;
    const end = z === 3 ? ROOM.D : (z + 1) * 5 - offset;
    dummy.position.set((x + .5) * 1.3, 0, (start + end) / 2);
    dummy.scale.set(1.283, .2, end - start - .015); dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index++, colour.setHSL(.13, .055, .88 + rand() * .1));
  }
  mesh.receiveShadow = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); g.add(mesh);
  return g;
}

export function buildTideHouse() {
  const g = group(); g.name = 'tide-house';
  put(g, box(ROOM.W - .05, 1.05, ROOM.D - .05, 0xa8b3b4, { rough: .95 }), ROOM.W / 2, -.73, ROOM.D / 2);

  const glass = new THREE.MeshStandardMaterial({ color: 0xb7e0e5, roughness: .12, metalness: .08,
    transparent: true, opacity: .075, depthWrite: false, side: THREE.DoubleSide });
  function pane(width, x, z, turn = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, 7.50), glass);
    m.position.set(x, 4.32, z); m.rotation.y = turn; m.name = 'tide-glazing'; g.add(m);
  }
  // Two wide uninterrupted ribbons, with only slim steel uprights. The shared
  // functional portal occupies the first 5.25m of the back wall.
  const start = TIDE_PORTAL_WIDTH + .06, width = ROOM.W - start, pitch = width / 3;
  for (let i = 0; i < 3; i++) pane(pitch - .13, start + (i + .5) * pitch, -.09);
  for (let i = 0; i <= 3; i++) put(g, box(.13, 8.1, .24, INK), start + i * pitch, 4.24, 0);
  for (let i = 0; i < 2; i++) pane(6.16, -.09, 3.15 + i * 6.3, Math.PI / 2);
  for (let i = 0; i <= 2; i++) put(g, box(.24, 8.1, .13, INK), 0, 4.24, i * 6.3);
  // A continuous low sill and fine upper transom make the silhouette horizontal.
  for (const y of [.49, 8.08]) {
    put(g, box(width, .13, .28, INK), start + width / 2, y, -.01);
    put(g, box(.28, .13, 12.65, INK), -.01, y, 6.3);
  }
  put(g, box(width, .055, .12, INK, { cast: false }), start + width / 2, 6.55, .005);
  put(g, box(.12, .055, 12.6, INK, { cast: false }), .005, 6.55, 6.3);

  // Window ornaments and paper planes still use their established apertures.
  for (const [wall, index] of [['back', 0], ['back', 1], ['left', 0]]) {
    const span = windowSpan(wall, index), back = wall === 'back';
    put(g, box(back ? span.width + .28 : .54, .12, back ? .54 : span.width + .28, ASH),
      back ? span.centre : .12, WINDOW_LEDGE_Y - .06, back ? .12 : span.centre);
  }

  // The clock sits in quiet linen panelling rather than competing with foliage.
  const panelStart = 12.75, panelWidth = ROOM.D - panelStart;
  put(g, box(.30, 8.05, panelWidth, LINEN), -.04, 4.25, panelStart + panelWidth / 2);
  const slatCount = Math.ceil((panelWidth - .25) / .34);
  const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(.05, 7.90, .045),
    new THREE.MeshStandardMaterial({ color: ASH, roughness: .9 }), slatCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < slatCount; i++) {
    dummy.position.set(.13, 4.26, panelStart + .25 + i * .34); dummy.updateMatrix(); slats.setMatrixAt(i, dummy.matrix);
  }
  slats.receiveShadow = true; slats.computeBoundingBox(); slats.computeBoundingSphere(); g.add(slats);
  put(g, box(.10, DECOR.wallClock.h + .30, DECOR.wallClock.w + .38, LINEN, { cast: false }),
    .15, DECOR.wallClock.y, DECOR.wallClock.z);
  put(g, box(.28, 8.15, .18, INK), .02, 4.30, ROOM.D);

  // A shallow floating eave gives a crisp low pavilion profile. Only its L-shaped
  // perimeter is retained in the cutaway, leaving the working floor fully visible.
  put(g, box(ROOM.W + 1.25, .31, 1.65, LINEN), ROOM.W / 2, TIDE_HEIGHT - .22, -.22);
  put(g, box(1.65, .31, ROOM.D - .65, LINEN), -.22, TIDE_HEIGHT - .22, ROOM.D / 2 + .33);
  put(g, box(ROOM.W + 1.45, .12, 1.8, INK), ROOM.W / 2, TIDE_HEIGHT + .015, -.22);
  put(g, box(1.8, .12, ROOM.D - .65, INK), -.22, TIDE_HEIGHT + .015, ROOM.D / 2 + .33);
  // Warm soffits are sheltered inside the dark outer edge, not another whole roof.
  put(g, box(width, .09, .91, ASH), start + width / 2, TIDE_HEIGHT - .42, .37);
  put(g, box(.91, .09, ROOM.D - .4, ASH), .37, TIDE_HEIGHT - .42, ROOM.D / 2);

  // Three ceramic shades: tactile and domestic, against the cool harbour palette.
  // Only their small emissive discs follow the existing night-light registry.
  for (const [x, z] of [[9.4, 1.28], [20, 1.28], [1.2, 8.5]]) {
    // Short steel arms attach the cables to the surviving cutaway soffit.
    const back = z < 2;
    put(g, box(back ? .06 : x - .27, .06, back ? z - .27 : .06, INK),
      back ? x : (x + .37) / 2, 8.19, back ? (z + .37) / 2 : z);
    const pendant = group(x, 6.55, z);
    put(pendant, cyl(.02, .02, 1.34, INK, { segments: 5, cast: false }), 0, .97, 0);
    put(pendant, cyl(.22, .82, .55, 0x7d9ca6, { segments: 24 }), 0, 0, 0);
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xffe9c2, emissive: 0xffd49b });
    const diffuser = new THREE.Mesh(new THREE.CircleGeometry(.72, 24), lampMaterial);
    diffuser.rotation.x = Math.PI / 2; diffuser.position.y = -.287; pendant.add(diffuser);
    markNightLight(pendant, { emissive: [lampMaterial], emissiveIntensity: 1.2 }); g.add(pendant);
  }
  // Fascia ties the floor to its quay without enclosing either viewing side.
  put(g, box(ROOM.W + .1, .31, .18, INK), ROOM.W / 2, -.17, ROOM.D + .04);
  put(g, box(.18, .31, ROOM.D, INK), ROOM.W + .04, -.17, ROOM.D / 2);
  return g;
}
