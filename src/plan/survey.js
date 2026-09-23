// The plan of the room as it stands — whoever laid it out.
//
// `furnish()` knows the plan it produced, rectangle by rectangle, because it put
// every rectangle there. This is the same description read back off a room that
// already exists: apply any layout (or none, for the authored one) and ask what
// floor it takes and where people stand in it.
//
// It is what makes the plan drawings general. They were built for the generator
// and drew its own working — which meant the only rooms that could be drawn were
// rooms nobody had touched. Now the drawing is of a *layout*, so
// `node bin/office-plan.js --from=cosy-corner.json` draws a layout somebody
// arranged by hand, and a generated office is drawn from the blob it will
// actually be stored as rather than from the generator's notes about it.
//
// Two rules keep it honest:
//
//   * **The footprints are read, not re-derived.** They come straight from
//     `obstacleFootprints()`, which is what the nav grid is built from, so a
//     drawing cannot disagree with the room about how much floor a couch takes.
//   * **The standing room is derived once**, by `claimOf()` in floor.js — the same
//     function the generator places against. So the strip in a drawing is the
//     strip the generator would have reserved.

import {
  DESKS, STATIONS, STATION_KINDS, FURNITURE, FURNITURE_KINDS, obstacleFootprints,
} from '../layout.js';
import {
  claimOf, doorApron, standable, ROLES, DESK_APPROACH, DESK_BODY,
} from './floor.js';

/**
 * Everything a plan drawing needs: the rectangles on the floor, and the spots
 * people stand on.
 *
 * @param {{ways?: object[]}} [extra]  circulation the caller knows about and the
 *   room cannot: a generated office reserved a street and an avenue, and a
 *   hand-made layout has no such thing to show.
 * @returns {{rects: object[], approaches: {label: string, at: {x: number, z: number}}[]}}
 */
export function survey({ ways = [] } = {}) {
  const rects = [{ ...doorApron(), role: ROLES.WAY }];
  for (const way of ways) rects.push({ ...way, role: ROLES.WAY });

  // Read, not re-derived: this is the same list the nav grid blocks, and it now
  // carries its own roles — a body per prop and the standing room in front of the
  // ones anybody walks up to.
  for (const rect of obstacleFootprints()) rects.push({ ...rect });

  const approaches = [];
  /**
   * The spot one prop's user stands on, if anybody walks to it.
   *
   * The *strip* is no longer pushed here: `obstacleFootprints()` emits standing
   * room itself now, with role `stand`, and it is read in above along with the
   * bodies. Adding it again would have given every prop two identical rectangles
   * for the same floor — harmless to the geometry and a quiet lie about what the
   * room contains, which is worse.
   */
  const stand = (key, at, size) => {
    const claim = claimOf(key, at, size);
    if (!claim.strip) return;
    // Only where somebody could actually stand. A hand-made layout may well have
    // pushed a station's standing room into a wall — the editor allows it and
    // reports it as stranded rather than refusing the drag — and a drawing that
    // put a ring there would be claiming the room works.
    if (standable(claim.spot)) approaches.push({ label: claim.label, at: claim.spot });
  };

  for (const desk of DESKS) {
    stand(`desk:${desk.id}`, desk, {
      ...DESK_BODY, approach: DESK_APPROACH, label: desk.id,
    });
  }
  for (const station of Object.values(STATIONS)) {
    const kind = STATION_KINDS[station.kind];
    if (!kind?.approachDist) continue;
    stand(`station:${station.id}`, station, {
      hw: kind.hw, hd: kind.hd, offX: kind.offX, offZ: kind.offZ,
      approach: kind.approachDist, label: station.id,
    });
  }
  for (const piece of FURNITURE) {
    const kind = FURNITURE_KINDS[piece.kind];
    // Lounge seating only: a side table has no standing room and a rug is floor.
    if (!kind?.seatOffsets) continue;
    stand(`furniture:${piece.id}`, piece, {
      hw: kind.hw, hd: kind.hd, offX: kind.offX, offZ: kind.offZ,
      approach: kind.approachDist, label: piece.id,
    });
  }

  return { rects, approaches };
}
