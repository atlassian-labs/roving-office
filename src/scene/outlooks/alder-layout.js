// One plan for the streets, paving, crossings and plots. Coordinates are metres
// in the office's frame (the room occupies x=0..26, z=0..20).
export const ALDER = {
  min: -108, max: 112, roadWidth: 8, walkWidth: 3.6,
  avenues: [-63, -7.6, 62], streets: [-61, -7.6, 55],
  park: { x0: -55.4, x1: -15.2, z0: 0, z1: 47.4 },
};

export const crossings = [];
for (const x of ALDER.avenues) for (const z of ALDER.streets) {
  // Each crossing is outside the intersection and meets a pavement on both ends.
  for (const offset of [-7.1, 7.1]) {
    crossings.push({ x: x + offset, z, axis: 'x', width: 3.2 });
    crossings.push({ x, z: z + offset, axis: 'z', width: 3.2 });
  }
}
// A direct, accessible link from the office's western pavement to the park.
crossings.push({ x: -7.6, z: 18, axis: 'z', width: 3.2 });

function intervals(centres) {
  const edges = [ALDER.min, ...centres.flatMap(c => [c - 4, c + 4]), ALDER.max];
  return edges.flatMap((v, i) => i % 2 === 0 ? [[v, edges[i + 1]]] : []);
}
export const pavements = intervals(ALDER.avenues).flatMap(([x0, x1]) =>
  intervals(ALDER.streets).map(([z0, z1]) => ({ x0, x1, z0, z1 })));

// [x, z, width, depth, height, facade, terrace]. Buildings follow plots, with
// courtyards and gaps for daylight. The office's open front remains a plaza.
export const buildings = [
  [7, -25, 16, 16, 12.8, 0, true], [27, -26, 18, 18, 16, 1, true],
  [47, -25, 15, 16, 12.8, 2, true],
  [6, -48, 14, 13, 19.2, 2, false], [29, -49, 17, 12, 12.8, 0, true],
  [48, -49, 12, 12, 22.4, 3, false],
  [-46, -24, 17, 15, 12.8, 1, true], [-25, -25, 16, 16, 9.6, 0, true],
  [-47, -47, 17, 13, 19.2, 2, true], [-25, -49, 17, 12, 16, 3, true],
  [-80, 7, 17, 18, 12.8, 0, true], [-80, 31, 17, 20, 16, 1, true],
  [-80, -25, 17, 17, 19.2, 2, true], [-81, -48, 18, 13, 16, 0, false],
  [81, -25, 20, 18, 19.2, 2, true], [81, -48, 19, 13, 25.6, 3, true],
  [-45, -80, 19, 20, 22.4, 0, true], [-22, -81, 18, 21, 28.8, 3, true],
  [7, -82, 18, 23, 22.4, 1, true], [33, -82, 21, 22, 32, 2, true],
  [82, 17, 20, 27, 12.8, 0, true],
  [-44, 76, 20, 23, 12.8, 2, true], [83, 77, 22, 22, 19.2, 3, true],
].map(([x, z, w, d, h, facade, terrace]) => ({ x, z, w, d, h, facade, terrace }));

// Recessed parking bays in the northern pavement, clear of crossing approaches.
export const parking = [20, 37, 49].map(x => ({ x, z: -12.95, w: 5.5, d: 2.7 }));

export const ramps = crossings.flatMap(p => [-1, 1].map(direction => {
  const alongX = p.axis === 'z';
  return { x: p.x + (alongX ? direction * 4.6 : 0),
    z: p.z + (alongX ? 0 : direction * 4.6),
    w: alongX ? 1.2 : p.width + .4, d: alongX ? p.width + .4 : 1.2, direction, alongX };
}));

export const pavingCuts = [...parking, ...ramps].map(p => ({
  x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2,
}));

// Partition, rather than cover, a pavement when a bay or ramp removes its kerb.
export function subtractRectangle(rect, cut) {
  const x0 = Math.max(rect.x0, cut.x0), x1 = Math.min(rect.x1, cut.x1);
  const z0 = Math.max(rect.z0, cut.z0), z1 = Math.min(rect.z1, cut.z1);
  if (x1 <= x0 || z1 <= z0) return [rect];
  return [
    { ...rect, x1: x0 }, { ...rect, x0: x1 },
    { x0, x1, z0: rect.z0, z1: z0 }, { x0, x1, z0: z1, z1: rect.z1 },
  ].filter(p => p.x1 - p.x0 > .0001 && p.z1 - p.z0 > .0001);
}

export function onRoad(x, z, margin = 0) {
  const half = ALDER.roadWidth / 2 + margin;
  return ALDER.avenues.some(c => Math.abs(x - c) < half)
    || ALDER.streets.some(c => Math.abs(z - c) < half);
}
