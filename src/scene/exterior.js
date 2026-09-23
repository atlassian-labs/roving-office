// The world outside the windows. Which world is the outlook registry's
// business (outlooks/index.js) — this dispatcher resolves the mode, lays the
// one shared ground plane at whatever level the outlook asks for, hands the
// outlook its group to build into, and drops a street by a storey per level
// below. It never names an outlook.
//
// Screen orientation note: with the locked isometric camera, screen-right is
// (+x, -z) and screen-left is (-x, +z).

import * as THREE from 'three';
import { COLORS, ROOM } from '../config.js';
import { group, mat } from './build.js';
import { OUTLOOKS, outlookOf, seasonOf } from './outlooks/index.js';

const STOREY_H = 7;          // height of a complete building level

export function buildExterior(parent, { mode = 'street-summer', season: seasonIn = null, storeysBelow = 0, serviceYard = false, building = null } = {}) {
  const g = group(0, 0, 0);
  // The mode names the season for a street, but a tower's mode is just
  // 'skyline-high' whatever the month, so seasonOf() returned summer for it every
  // time and the roofscape never changed. The caller knows the season, so it says.
  const season = seasonIn ?? seasonOf(mode);
  const outlook = OUTLOOKS[outlookOf(mode)] ?? OUTLOOKS.street;

  g.add(buildGroundPlane(outlook.ground(season)));
  outlook.build(g, { season, serviceYard, building });

  // The street has to drop by a storey per level below us, or the ground ends up
  // level with a first-floor window. An aerial outlook looks *down* on something
  // rather than out at a street, owns its own ground level, and never drops: it
  // is placed relative to this floor, which is the only floor there is anything
  // to see from.
  if (!outlook.aerial && storeysBelow > 0) g.position.y = -storeysBelow * STOREY_H;

  parent.add(g);
  return g;
}

/**
 * A big base plane so there is never a visible void under the scene. One plane,
 * at whatever level and colour the outlook's `ground()` asks for — the road for
 * a street, the rooftop datum for the skyline, zinc-toned haze under Paris.
 */
function buildGroundPlane({ y, color = COLORS.road }) {
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    mat(color, { rough: 1.0 })
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(ROOM.W / 2, y, ROOM.D / 2);
  plane.receiveShadow = true;
  return plane;
}
