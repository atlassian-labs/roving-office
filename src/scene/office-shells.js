// Custom ground-floor architecture shares the same functional entrance and floor
// footprint. Geometry stays here; projects.js imports only the theme data.
import { buildCanopyHouse, buildCanopyFloor, CANOPY_HEIGHT, CANOPY_PORTAL_WIDTH } from './canopy.js';
import { buildTideHouse, buildTideFloor, TIDE_HEIGHT, TIDE_PORTAL_WIDTH } from './tide-house.js';
import { buildDuneAtelier, buildDuneFloor, DUNE_HEIGHT, DUNE_PORTAL_WIDTH } from './dune-atelier.js';
import { buildLanternCourt, buildLanternFloor, LANTERN_HEIGHT, LANTERN_PORTAL_WIDTH } from './lantern-court.js';

export const OFFICE_SHELLS = {
  canopy: { build: buildCanopyHouse, floor: buildCanopyFloor, height: CANOPY_HEIGHT, portalWidth: CANOPY_PORTAL_WIDTH },
  tide: { build: buildTideHouse, floor: buildTideFloor, height: TIDE_HEIGHT, portalWidth: TIDE_PORTAL_WIDTH },
  dune: { build: buildDuneAtelier, floor: buildDuneFloor, height: DUNE_HEIGHT, portalWidth: DUNE_PORTAL_WIDTH },
  lantern: { build: buildLanternCourt, floor: buildLanternFloor, height: LANTERN_HEIGHT, portalWidth: LANTERN_PORTAL_WIDTH },
};
