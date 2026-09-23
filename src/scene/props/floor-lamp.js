import * as THREE from 'three';
import { COLORS } from '../../config.js';
import { cyl, group, footY } from '../build.js';

export function buildFloorLamp() {
  const g = group(0, 0, 0);
  // Same flush-with-the-floor problem the coat stand had, and the same fix.
  const BASE_H = 0.1;
  const base = cyl(0.35, 0.4, BASE_H, COLORS.metalDark, { metal: 0.6 });
  base.position.y = footY(BASE_H); g.add(base);
  const pole = cyl(0.05, 0.05, 3.2, 0xd8b25a, { metal: 0.7, rough: 0.3 });
  pole.position.y = 1.6; g.add(pole);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xf3ead0, emissive: 0xffe9b0, emissiveIntensity: 0.5, roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.9, 16, 1, true), shadeMat);
  shade.position.y = 3.4; g.add(shade);
  const bulb = new THREE.PointLight(0xffe6bd, 0.5, 10, 2);
  bulb.position.y = 3.3; g.add(bulb);
  return g;
}
