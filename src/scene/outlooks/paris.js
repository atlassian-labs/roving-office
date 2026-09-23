// Limestone courtyard blocks, zinc mansards, garden squares and two landmarks.
import { STREET_Y } from '../../config.js';
import { archRing, box, cyl, group, put } from '../build.js';
import { hazed } from './streetscape.js';
import { buildAlderStreet } from './alder.js';
import { GARDEN_DISTRICTS } from './garden-districts.js';

export const PARIS_BASE_Y = -34;
export const PARIS_STREET_Y = STREET_Y + GARDEN_DISTRICTS.paris.offsetY;

export function buildParisRooftops(season = 'summer') {
  const g = group();
  buildAlderStreet(g, season, GARDEN_DISTRICTS.paris);
  // Both landmarks occupy the outer blocks, clear of roads and courtyard plots.
  g.add(buildChurchTower(-82, PARIS_STREET_Y, -81, .32));
  g.add(buildIronTower(82, PARIS_STREET_Y, -81));
  return g;
}

function buildChurchTower(x, y, z, haze) {
  const g = group(x, y, z);
  const stone = hazed(0xc9bea3, haze);
  const dark = hazed(0x26272a, haze);
  const W = 6.5;
  const H = 20;

  put(g, box(W, H, W, stone, { rough: 0.95, cast: false }), 0, H / 2);

  // Corner buttresses, the detail that reads as "church" rather than "office
  // block with a hat" at this silhouette.
  for (const [bx, bz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    put(g, box(0.7, H * 0.62, 0.7, stone, { rough: 0.95, cast: false }), bx * (W / 2 - 0.1), H * 0.31, bz * (W / 2 - 0.1));
  }

  // Belfry louvres, dark against the stone, near the top.
  put(g, box(W - 2.6, 3.4, W + 0.3, dark, { cast: false }), 0, H - 3.2);
  put(g, box(W + 0.3, 3.4, W - 2.6, dark, { cast: false }), 0, H - 3.2);

  // A rose window, facing the building.
  const rose = cyl(1.15, 1.15, 0.3, hazed(0x6f8ea0, haze), { segments: 12, rough: 0.4, cast: false });
  rose.rotation.x = Math.PI / 2;
  rose.position.set(0, H * 0.4, W / 2 + 0.06);
  g.add(rose);

  // Pyramidal spire: the mansard cap's own construction, taller and narrower.
  const spireH = 13;
  const spireG = group(0, H, 0);
  spireG.scale.set(W / Math.SQRT2, 1, W / Math.SQRT2);
  const spire = cyl(0.02, 1.0, spireH, dark, { segments: 4, rough: 0.5, cast: false });
  spire.rotation.y = Math.PI / 4;
  spire.position.y = spireH / 2;
  spireG.add(spire);
  g.add(spireG);

  return g;
}

/** The tower: three tapering stages and a mast, in the far haze. */
function buildIronTower(x, y, z) {
  const g = group(x, y, z);
  const iron = hazed(0x7a6a5c, 0.55);
  const stages = [
    { rBot: 9.0, rTop: 5.0, h: 14 },
    { rBot: 4.6, rTop: 2.2, h: 16 },
    { rBot: 2.0, rTop: 0.7, h: 18 },
  ];
  let base = 0;
  for (const st of stages) {
    const stage = cyl(st.rTop, st.rBot, st.h, iron, { segments: 4, rough: 0.9, cast: false });
    stage.rotation.y = Math.PI / 4;
    stage.position.y = base + st.h / 2;
    g.add(stage);
    base += st.h;
  }
  put(g, cyl(0.12, 0.3, 6, iron, { segments: 4, cast: false }), 0, base + 3);
  // The arch under the first stage, which is most of what makes it recognisable.
  put(g, archRing(5.0, 6.4, iron, { cast: false }), 0, 3.0, 0);
  return g;
}

export const outlook = {
  id: 'paris-rooftops', label: 'Paris rooftops', aerial: true,
  ground: () => ({ y: PARIS_STREET_Y - .02, color: 0xb1beb5 }),
  build(g, { season }) { g.add(buildParisRooftops(season)); },
};
