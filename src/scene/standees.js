// Brand-mark standees: the Atlassian ace and the Rovo mark, extruded from their
// own vector artwork rather than kit-bashed from boxes like the rest of the room.
// Both are flat logos in source, so what makes them stand up on a shelf rather
// than lie there like a sticker is depth — a third of the mark's own height,
// enough for the standee to hold its own edge with no separate stand or base.
//
// The ace's artwork is below; the Rovo mark's is in src/rovo-mark.js, because the
// picker tile is the same mark and one set of points is the only way the statue
// and the tile cannot drift apart. That module's own header says why it imports
// nothing.
//
// The artwork is plain point data, not SVG. This app has no build step and
// loads nothing from disk (see docs/user/the-kit.md), and an SVG parser would also be
// a DOM dependency this module cannot carry: the coplanar probe and the prop
// portrait tool both build the whole prop catalogue in Node, headless — see
// bin/lib/headless-scene.js, which stubs `document` just enough for a canvas
// texture and nothing more. So each mark's curves were flattened once, offline,
// into the polygons below (bin/lib is for tools that run *in* this repo; the
// one-off flattening script that produced these points did not need to). A
// THREE.Shape built from a literal array needs nothing but three's own core,
// which is the same reason the rest of the room is boxes and cylinders rather
// than loaded models.
//
// Both marks are Atlassian's own, and both are excluded from the Apache-2.0
// grant — see NOTICE and docs/developer/visual-assets.md, which record where each
// one came from.
//
// Source: the Atlassian ace is the mark from
// https://atlassian.design/assets/c117b4e25b80/logos/atlassian_logo.zip (the icon
// to the left of the wordmark, not the horizontal lockup). The Rovo mark's four
// facets are traced from UXWing's rendering of the same mark
// (https://uxwing.com/atlassian-rovo-icon/) rather than lifted out of a kit SVG —
// flat polygons in four Atlassian brand colours; src/rovo-mark.js has the detail.

import * as THREE from 'three';
import { ROVO_SHAPES } from '../rovo-mark.js';

const ACE_SHAPES = [
  { color: '#1868DB', points: [[41.32, 36.57], [25.44, 4.81], [25.35, 4.62], [25.25, 4.46], [25.16, 4.33], [25.06, 4.23], [24.96, 4.15], [24.86, 4.09], [24.76, 4.05], [24.66, 4.02], [24.55, 4.0], [24.44, 4.0], [24.34, 4.0], [24.25, 4.02], [24.14, 4.04], [24.04, 4.08], [23.93, 4.14], [23.82, 4.22], [23.71, 4.31], [23.6, 4.43], [23.49, 4.58], [23.38, 4.75], [22.74, 5.84], [22.18, 6.95], [21.68, 8.1], [21.26, 9.27], [20.91, 10.47], [20.62, 11.69], [20.4, 12.93], [20.25, 14.19], [20.16, 15.46], [20.13, 16.75], [20.22, 18.54], [20.48, 20.34], [20.91, 22.15], [21.49, 24.02], [22.22, 25.95], [23.08, 27.97], [24.07, 30.11], [25.18, 32.39], [26.39, 34.82], [27.69, 37.44], [27.84, 37.72], [27.98, 37.95], [28.12, 38.14], [28.27, 38.29], [28.42, 38.41], [28.59, 38.5], [28.77, 38.56], [28.97, 38.6], [29.19, 38.62], [29.44, 38.63], [40.44, 38.63], [40.67, 38.62], [40.88, 38.59], [41.07, 38.55], [41.23, 38.48], [41.37, 38.4], [41.49, 38.29], [41.58, 38.17], [41.64, 38.03], [41.68, 37.87], [41.69, 37.69], [41.69, 37.6], [41.68, 37.52], [41.67, 37.43], [41.65, 37.34], [41.62, 37.25], [41.58, 37.14], [41.54, 37.03], [41.48, 36.89], [41.4, 36.74], [41.32, 36.57]] },
  { color: '#1868DB', points: [[18.25, 21.57], [17.9, 21.05], [17.6, 20.64], [17.34, 20.31], [17.12, 20.05], [16.93, 19.86], [16.77, 19.73], [16.63, 19.64], [16.52, 19.59], [16.41, 19.57], [16.31, 19.56], [16.22, 19.57], [16.14, 19.59], [16.05, 19.62], [15.97, 19.68], [15.88, 19.77], [15.78, 19.89], [15.67, 20.05], [15.55, 20.25], [15.41, 20.51], [15.25, 20.81], [7.31, 36.69], [7.24, 36.83], [7.18, 36.96], [7.13, 37.07], [7.09, 37.17], [7.06, 37.25], [7.04, 37.34], [7.02, 37.41], [7.01, 37.48], [7.0, 37.56], [7.0, 37.63], [7.01, 37.78], [7.05, 37.93], [7.12, 38.07], [7.21, 38.2], [7.34, 38.32], [7.49, 38.42], [7.66, 38.51], [7.87, 38.57], [8.11, 38.62], [8.38, 38.63], [19.56, 38.63], [19.78, 38.61], [19.99, 38.56], [20.19, 38.46], [20.37, 38.33], [20.54, 38.17], [20.7, 37.97], [20.84, 37.73], [20.97, 37.46], [21.09, 37.16], [21.19, 36.82], [21.29, 36.37], [21.39, 35.94], [21.46, 35.51], [21.53, 35.08], [21.58, 34.65], [21.62, 34.22], [21.65, 33.79], [21.67, 33.35], [21.69, 32.9], [21.69, 32.44], [21.63, 31.13], [21.48, 29.85], [21.23, 28.59], [20.91, 27.37], [20.53, 26.21], [20.11, 25.11], [19.66, 24.08], [19.19, 23.14], [18.71, 22.3], [18.25, 21.57]] },
];

/** A closed polygon, straight off the flattened point list — SVG's y-down. */
function shapeFrom(points) {
  return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
}

/**
 * Extrude a flat brand mark into a standee thick enough to stand up on its own
 * edge rather than lie flat like a sticker: depth is a third of the height, per
 * the brief this was built against. Every shape becomes its own full-depth mesh
 * in its own colour — this only looks right because the shapes tile edge to
 * edge with no overlap (see src/rovo-mark.js); overlapping source shapes
 * extruded the same way would fight over the same depth.
 *
 * @param {Array<{color: string, points: number[][]}>} shapeSpecs
 * @param {object} [opts]
 * @param {number} [opts.height]  world-space height the standee should read as
 * @returns {{obj: THREE.Group, width: number, height: number, depth: number}}
 *   `obj`'s local origin is centred left-right and front-back and sits on its
 *   base, the same convention as everything else that stands on a floor or sill.
 */
function buildLogoStandee(shapeSpecs, { height = 0.6 } = {}) {
  // Every shape, extruded one unit deep, still in the source's own y-down space
  // and still at a placeholder scale, so a Box3 over the lot gives the
  // artwork's true extent to scale and centre against.
  const raw = new THREE.Group();
  const matFor = new Map();
  for (const { color, points } of shapeSpecs) {
    if (!matFor.has(color)) {
      matFor.set(color, new THREE.MeshStandardMaterial({
        color: new THREE.Color(color), roughness: 0.45, metalness: 0.05,
        // The y-flip below (source y-down to world y-up) mirrors the geometry,
        // which otherwise turns every front face into a culled back face.
        side: THREE.DoubleSide,
      }));
    }
    const geo = new THREE.ExtrudeGeometry(shapeFrom(points), { depth: 1, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, matFor.get(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    raw.add(mesh);
  }

  const bounds = new THREE.Box3().setFromObject(raw);
  const artH = bounds.max.y - bounds.min.y;
  const scaleXY = height / artH;
  const depth = height / 3;

  // Centre the artwork on the origin in its own local space, on all three axes,
  // so the flip-and-scale below leaves it centred rather than pushing it aside.
  const center = bounds.getCenter(new THREE.Vector3());
  raw.position.set(-center.x, -center.y, -center.z);

  const inner = new THREE.Group();
  inner.add(raw);
  inner.scale.set(scaleXY, -scaleXY, depth);
  // Lift so the outer object's own origin — where a caller sets position — is
  // the base, the same convention as every other standing prop in the room.
  inner.position.y = height / 2;

  const obj = new THREE.Group();
  obj.add(inner);
  return { obj, width: (bounds.max.x - bounds.min.x) * scaleXY, height, depth };
}

/** The Atlassian ace, standing on its edge. */
export function buildAceLogo(height = 0.6) {
  return buildLogoStandee(ACE_SHAPES, { height });
}

/** The Rovo mark, standing on its edge. */
export function buildRovoLogo(height = 0.6) {
  return buildLogoStandee(ROVO_SHAPES, { height });
}
