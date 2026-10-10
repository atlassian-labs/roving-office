import { box, cyl, group, put } from '../build.js';

/** A bright toy blaster, pointing along the character's local +z. */
export function buildFoamBlaster() {
  const root = group();
  put(root, box(0.2, 0.22, 0.65, 0x258bc9), 0, 0, 0);
  put(root, box(0.14, 0.28, 0.16, 0xffa24d), 0, -0.18, -0.15);
  const barrel = cyl(0.1, 0.1, 0.22, 0xffa24d, { segments: 12 });
  barrel.rotation.x = Math.PI / 2;
  put(root, barrel, 0, 0, 0.4);
  return root;
}
