import * as THREE from 'three';
import { COLORS } from '../../config.js';
import { cyl, group, mat } from '../build.js';

// ---------------------------------------------------------------------------
// Bin: errored work gets discarded here.
export function buildBin() {
  const g = group(0, 0, 0);
  const body = cyl(0.34, 0.29, 0.85, 0x2b2f36, { segments: 14, metal: 0.2, rough: 0.6 });
  body.position.y = 0.42; g.add(body);
  const lipRing = cyl(0.36, 0.36, 0.06, 0x3a4048, { segments: 14, metal: 0.3 });
  lipRing.position.y = 0.86; g.add(lipRing);

  // Crumpled paper that accumulates as work gets discarded.
  const crumples = [];
  for (let i = 0; i < 3; i++) {
    const ball = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.15, 0),
      mat(COLORS.paper, { flat: true, rough: 0.9 })
    );
    ball.position.set((i - 1) * 0.14, 0.9 + i * 0.05, (i % 2) * 0.1);
    ball.visible = false;
    g.add(ball);
    crumples.push(ball);
  }

  const handle = {
    id: 'bin',
    kind: 'bin',
    discarded: 0,
    discard() {
      const slot = crumples[this.discarded % crumples.length];
      slot.visible = true;
      this.discarded++;
    },
  };
  return { obj: g, handle };
}
