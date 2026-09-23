import { box, cyl, group, put } from '../build.js';
import { buildFern } from '../plants.js';

export function buildSideTable() {
  const g = group(0, 0, 0);
  const top = box(1.6, 0.14, 1.0, 'woodDark', { rough: 0.5 });
  top.position.y = 1.0; g.add(top);
  for (const sx of [-0.65, 0.65]) for (const sz of [-0.35, 0.35]) {
    const leg = cyl(0.06, 0.06, 1.0, 'woodDark', { segments: 8 });
    leg.position.set(sx, 0.5, sz); g.add(leg);
  }
  const bookPile = box(0.8, 0.1, 0.55, 0x4f7a8a);
  bookPile.position.set(-0.35, 1.12, 0); bookPile.rotation.y = 0.3; g.add(bookPile);

  // A fern at the other end, so the reading corner has something living in it.
  put(g, buildFern(1.35), 0.45, 1.05, 0);
  return g;
}
