// A city of glass towers, planted podiums and streets visible between the blocks.
import { STREET_Y } from '../../config.js';
import { group } from '../build.js';
import { buildAlderStreet } from './alder.js';
import { GARDEN_DISTRICTS } from './garden-districts.js';

// Retain the office's existing lower datum, now expressed as a connected street.
export const SKYLINE_GROUND_Y = STREET_Y + GARDEN_DISTRICTS.tower.offsetY;

export function buildSkylineHigh(season = 'summer') {
  const g = group();
  buildAlderStreet(g, season, GARDEN_DISTRICTS.tower);
  return g;
}

export const outlook = {
  id: 'skyline-high', label: 'Skyline', aerial: true,
  ground: () => ({ y: SKYLINE_GROUND_Y - .02 }),
  build(g, { season }) { g.add(buildSkylineHigh(season)); },
};
