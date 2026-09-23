import * as THREE from 'three';
import { COLORS } from '../../config.js';
import { box, cyl, group, put } from '../build.js';

// ---------------------------------------------------------------------------
// Water cooler: agents visit between jobs. Built facing +z.
export function buildWaterCooler() {
  const g = group(0, 0, 0);

  // Cabinet.
  put(g, box(0.92, 1.15, 0.72, COLORS.coolerBody, { rough: 0.55 }), 0, 0.575);
  put(g, box(0.86, 0.12, 0.66, 0x9aa0a6, { rough: 0.7, cast: false }), 0, 0.06);

  // Dispensing recess + taps (front == +z).
  put(g, box(0.5, 0.34, 0.1, 0x6f767d, { rough: 0.6, cast: false }), 0, 0.86, 0.37);
  for (const [sx, c] of [[-0.13, 0x3f7fbf], [0.13, 0xc0392b]]) {
    put(g, box(0.1, 0.16, 0.14, c, { rough: 0.4 }), sx, 0.9, 0.42);
  }
  // Drip tray.
  put(g, box(0.46, 0.05, 0.2, 0x8f959b, { rough: 0.5, cast: false }), 0, 0.7, 0.42);

  // Inverted bottle on top.
  put(g, cyl(0.3, 0.34, 0.12, 0xb9bfc5, { segments: 14, rough: 0.5 }), 0, 1.2);
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.3, 0.78, 16),
    new THREE.MeshStandardMaterial({
      color: COLORS.coolerWater, transparent: true, opacity: 0.75,
      roughness: 0.2, metalness: 0.0,
    })
  );
  bottle.position.y = 1.66;
  bottle.castShadow = true;
  g.add(bottle);
  put(g, cyl(0.14, 0.24, 0.2, COLORS.coolerWater, { segments: 12, rough: 0.2 }), 0, 1.18);

  // Cup dispenser on the side.
  put(g, cyl(0.09, 0.09, 0.5, 0xdfe3e7, { segments: 10, rough: 0.5 }), 0.55, 1.0, 0.1);

  const handle = { id: 'waterCooler', kind: 'waterCooler' };
  return { obj: g, handle };
}
