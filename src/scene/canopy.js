// Canopy House: a timber conservatory around the unchanged, navigable office.
import * as THREE from 'three';
import { ROOM, WINDOW_LEDGE_Y, windowSpan } from '../config.js';
import { DECOR } from '../layout.js';
import { box, cyl, group, put } from './build.js';
import { markNightLight } from './night-lights.js';
import { planting } from './canopy-planting.js';
import { seeded } from './outlooks/streetscape.js';

export const CANOPY_HEIGHT = 10.8;
export const CANOPY_PORTAL_WIDTH = 5.25;
const OAK = 0xad8050, END_GRAIN = 0x87633e, BRONZE = 0x3e4538, STONE = 0xc8bf9e;

function timberTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 1024;
  const c = canvas.getContext('2d'), rand = seeded(2041);
  c.fillStyle = '#d1b183'; c.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 180; i++) {
    const x = rand() * 256;
    c.strokeStyle = `rgba(89,59,26,${.025 + rand() * .07})`; c.lineWidth = .4 + rand() * 1.2;
    c.beginPath(); c.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 32) c.lineTo(x + Math.sin(y * .008 + i) * (1 + rand() * 3), y);
    c.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  return texture;
}

export function buildCanopyFloor() {
  const g = group(); g.name = 'canopy-oak-floor';
  const map = timberTexture(), geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ map, roughness: .7, color: 0xffffff });
  const count = 26 * 5, mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D(), colour = new THREE.Color(), rand = seeded(2042);
  let i = 0;
  for (let x = 0; x < 26; x++) for (let j = 0; j < 5; j++) {
    // Narrow joints, staggered lengths, and a separate edge fascia below them.
    const start = j === 0 ? 0 : j * 4 - (x % 2 ? 1.3 : 0);
    const end = j === 4 ? ROOM.D : (j + 1) * 4 - (x % 2 ? 1.3 : 0);
    dummy.position.set(x + .5, 0, (start + end) / 2);
    dummy.scale.set(.988, .2, end - start - .018); dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i++, colour.setHSL(.105, .14, .82 + rand() * .12));
  }
  mesh.receiveShadow = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); g.add(mesh);
  return g;
}

export function buildCanopyHouse() {
  const g = group(); g.name = 'canopy-house';
  const plants = planting(g);
  // A low limestone foundation meets the garden; the oak floor is not floating.
  put(g, box(ROOM.W - .05, .95, ROOM.D - .05, STONE, { rough: .95, cast: false }), ROOM.W / 2, -.68, ROOM.D / 2);
  // Glazing transmits the view; no transmission render pass or shadow-casting pane.
  const glass = new THREE.MeshStandardMaterial({ color: 0xb9d0bd, roughness: .18, metalness: .05,
    transparent: true, opacity: .10, depthWrite: false, side: THREE.DoubleSide });
  function pane(width, height, x, y, z, rotation = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), glass);
    m.position.set(x, y, z); m.rotation.y = rotation; m.name = 'canopy-glazing'; g.add(m);
  }
  // Tall lights with a fine bronze transom, framed by structural timber posts.
  const backStart = CANOPY_PORTAL_WIDTH + .06, backEnd = ROOM.W;
  const pitch = (backEnd - backStart) / 4;
  for (let i = 0; i < 4; i++) {
    const x = backStart + (i + .5) * pitch;
    pane(pitch - .32, 9.75, x, 5.22, -.075);
    put(g, box(.055, 9.75, .085, BRONZE, { cast: false }), x, 5.22, -.01);
  }
  for (let i = 0; i <= 4; i++) put(g, box(.30, 10.25, .42, OAK), backStart + i * pitch, 5.23, 0);
  for (let i = 0; i < 3; i++) {
    const z = 2.05 + i * 4.1;
    pane(3.79, 9.75, -.075, 5.22, z, Math.PI / 2);
    put(g, box(.085, 9.75, .055, BRONZE, { cast: false }), 0, 5.22, z);
  }
  for (let i = 0; i <= 3; i++) put(g, box(.42, 10.25, .30, OAK), 0, 5.23, i * 4.1);
  put(g, box(backEnd - backStart, .075, .12, BRONZE, { cast: false }), (backStart + backEnd) / 2, 7.65, .035);
  put(g, box(.12, .075, 12.25, BRONZE, { cast: false }), .035, 7.65, 6.125);

  // The sill ornaments and paper-plane apertures keep their established places.
  // Real shelves support them even though these windows now reach the floor.
  for (const [wall, index] of [['back', 0], ['back', 1], ['left', 0]]) {
    const span = windowSpan(wall, index), back = wall === 'back';
    put(g, box(back ? span.width + .35 : .58, .16, back ? .58 : span.width + .35, OAK),
      back ? span.centre : .12, WINDOW_LEDGE_Y - .08, back ? .12 : span.centre);
  }

  // Thick glulam beams, a planted clerestory ledge and short exposed rafters.
  // The roof is cut back to these two edges so it never covers the agents.
  put(g, box(ROOM.W + .75, .64, .75, OAK), ROOM.W / 2, CANOPY_HEIGHT - .35, 0);
  put(g, box(.75, .64, ROOM.D - .45, OAK), 0, CANOPY_HEIGHT - .35, (ROOM.D + .45) / 2);
  for (let x = 1; x < ROOM.W; x += 2.25) put(g, box(.17, .35, 2.8, END_GRAIN), x, CANOPY_HEIGHT + .12, .55);
  for (let z = 2.3; z < ROOM.D; z += 2.25) put(g, box(2.6, .35, .17, END_GRAIN), .55, CANOPY_HEIGHT + .12, z);
  put(g, box(ROOM.W - 5.7, .32, .95, END_GRAIN), 15.7, 9.95, -.32);
  for (let x = 6.5; x < 25; x += 1.1) {
    plants.fern(x, 10.15, -.38, .75, 5);
    if (Math.floor(x * 2) % 3 !== 0) plants.vine(x, 9.9, .23, 1.0 + plants.rand() * 1.55);
  }

  // Living wall is flush to the perimeter; its taller fronds stay above heads.
  const wallStart = 12.5, wallLength = ROOM.D - wallStart;
  const clock = DECOR.wallClock;
  const byClock = z => Math.abs(z - clock.z) < clock.w / 2 + .5;
  put(g, box(.32, 9.9, wallLength, 0x334931, { rough: 1 }), -.04, 5.1, wallStart + wallLength / 2);
  put(g, box(.46, 10.3, .32, OAK), .02, 5.23, ROOM.D);
  for (let z = wallStart + .2; z < ROOM.D - .2; z += .35) for (let y = .75; y < 9.9; y += .40) {
    if (byClock(z) && Math.abs(y - clock.y) < clock.h / 2 + .6) continue;
    // Leaves emerge along x; no solid island takes away usable floor area.
    plants.leaf(.16 + plants.rand() * .09, y + (plants.rand() - .5) * .24, z + (plants.rand() - .5) * .22,
      .38 + plants.rand() * .38, Math.PI / 2 + (plants.rand() - .5) * .9, 1.2 + plants.rand() * .55);
  }
  for (const y of [3.6, 6.2, 8.9]) {
    put(g, box(.55, .20, wallLength - .3, OAK), .08, y, wallStart + wallLength / 2);
    for (let z = 13; z < 19.5; z += 1.4) plants.vine(.28, y + .18, z,
      byClock(z) && y === 6.2 ? .3 : .65 + plants.rand() * .9, 1.57);
  }
  put(g, box(.09, clock.h + .3, clock.w + .4, END_GRAIN, { cast: false }), .165, clock.y, clock.z);

  // Open corner terrace: warm boards, low stone planters and clear glazing edges.
  put(g, box(ROOM.W + .6, .55, .45, STONE), ROOM.W / 2, -.28, ROOM.D + .15);
  put(g, box(.45, .55, ROOM.D, STONE), ROOM.W + .15, -.28, ROOM.D / 2);
  put(g, box(ROOM.W + .6, .10, .18, END_GRAIN, { cast: false }), ROOM.W / 2, -.08, ROOM.D + .4);

  // Built-in gardens just outside the glass keep the indoor floor freely editable.
  for (const [x, z, w, d] of [[9, -.95, 6.1, 1.25], [19.7, -.95, 7.7, 1.25], [-.95, 7, 1.25, 8.8]]) {
    put(g, box(w, .70, d, STONE, { rough: .9 }), x, .02, z);
    put(g, box(w - .14, .07, d - .14, 0x504837, { cast: false }), x, .39, z);
    const alongX = w > d, length = Math.max(w, d);
    for (let t = -length / 2 + .7; t < length / 2 - .2; t += .9) {
      plants.fern(x + (alongX ? t : 0), .44, z + (alongX ? 0 : t), .66, 5);
    }
  }

  // Pendants belong to the visible canopy, with basket ribs rather than a solid lid.
  for (const [x, z] of [[8.1, 1.25], [18.3, 1.25], [1.2, 9]]) {
    const pendant = group(x, 8.1, z);
    put(pendant, cyl(.025, .025, 2.3, BRONZE, { segments: 5, cast: false }), 0, 1.15, 0);
    for (let ring = 0; ring < 5; ring++) {
      const radius = .38 + Math.sin(ring / 4 * Math.PI * .7) * .55;
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(radius, .026, 4, 28),
        new THREE.MeshStandardMaterial({ color: OAK, roughness: .8 }));
      hoop.rotation.x = Math.PI / 2; hoop.position.y = -.1 - ring * .22; pendant.add(hoop);
    }
    for (let rib = 0; rib < 16; rib++) {
      const a = rib / 16 * Math.PI * 2;
      plants.branch([x + Math.cos(a) * .38, 8, z + Math.sin(a) * .38],
        [x + Math.cos(a) * .88, 7.15, z + Math.sin(a) * .88], .025, OAK);
    }
    const bulbMaterial = new THREE.MeshStandardMaterial({ color: 0xffe1a3, emissive: 0xffcb72, emissiveIntensity: 1 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.19, 10, 6), bulbMaterial);
    bulb.position.y = -.62; pendant.add(bulb);
    markNightLight(pendant, { emissive: [bulbMaterial], emissiveIntensity: 1.6 });
    g.add(pendant);
  }
  plants.finish();
  return g;
}
