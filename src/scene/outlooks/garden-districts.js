// Districts share the street plan but have different plots, roofs and heights.
// The offsets meet the existing office approaches: warehouse is dropped by the
// exterior dispatcher, Paris by its two lower floors, and Tower by its old datum.
import { buildings as alderBuildings } from './alder-layout.js';

const plots = rows => rows.map(([x, z, w, d, h, facade, terrace = false]) =>
  ({ x, z, w, d, h, facade, terrace }));

export const GARDEN_DISTRICTS = {
  warehouse: {
    id: 'warehouse', style: 'industrial', offsetY: 0, serviceYard: true,
    buildings: plots([
      [10, -29, 22, 23, 9.6, 1], [39, -29, 24, 24, 12.8, 0],
      [11, -49, 22, 12, 6.4, 2, true], [39, -50, 24, 11, 9.6, 1],
      [-36, -26, 36, 20, 9.6, 1], [-36, -48, 36, 14, 12.8, 0],
      [-82, 15, 20, 35, 9.6, 0], [-82, -30, 20, 30, 12.8, 1],
      [82, -32, 23, 32, 9.6, 2], [82, 15, 23, 32, 12.8, 1],
      [-36, -81, 36, 24, 12.8, 1], [9, -82, 22, 26, 16, 2, true],
      [40, -82, 25, 26, 9.6, 0], [-42, 79, 26, 26, 6.4, 2],
      [82, 79, 23, 27, 9.6, 1], [-82, -82, 20, 26, 6.4, 0],
    ]),
    beds: [[25, -42, 49, 1.2], [-36, -38.5, 37, 2], [46, 10, 16, 23], [12, 40, 24, 10], [43, 38, 17, 12]],
    cuts: [
      { x0: -1.5, x1: 27.5, z0: 20, z1: 29 },
      { x0: -3.6, x1: -1.5, z0: 21.55, z1: 26.55 },
    ],
  },
  tower: {
    id: 'tower', style: 'tower', offsetY: -24.7,
    buildings: alderBuildings.map((b, i) => ({ ...b,
      h: i < 3 ? 9.6 : [12.8, 16, 9.6][i % 3],
      towerHeight: [25.6, 41.6, 32, 48, 35.2][i % 5], facade: [3, 0, 2, 3, 1][i % 5], terrace: true,
    })),
    beds: [[25, -39, 48, 5], [-36, -37, 37, 4], [46, 10, 16, 23], [12, 39, 24, 12], [43, 38, 17, 12]],
  },
  paris: {
    id: 'paris', style: 'paris', offsetY: -14,
    buildings: plots([
      [9, -33, 20, 32, 12.8, 0], [38, -33, 24, 32, 16, 2],
      [-36, -35, 34, 36, 12.8, 2], [-82, -29, 20, 29, 16, 0],
      [-82, 17, 20, 30, 12.8, 2], [82, -34, 24, 35, 16, 0],
      [82, 17, 24, 30, 12.8, 2], [-36, -82, 34, 24, 16, 0],
      [10, -82, 24, 24, 12.8, 2], [39, -82, 24, 24, 19.2, 0],
      [-42, 78, 26, 28, 12.8, 2], [82, 78, 26, 28, 16, 0],
    ]),
    beds: [[22.5, -33, 3.2, 33], [46, 10, 16, 23], [12, 39, 24, 12], [43, 38, 17, 12]],
  },
};
