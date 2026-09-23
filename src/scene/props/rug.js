import { COLORS, FLOOR_TOP, RUG_COLORS } from '../../config.js';
import { FURNITURE_KINDS } from '../../layout.js';
import { box, group, mat, put } from '../build.js';
import { movable } from '../movables.js';

/**
 * The body colour a rug should actually be.
 *
 * No choice means the room's: `COLORS.rugSage` is part of the theme and every project
 * repaints it, so an unasked room goes on following its season. A choice overrides that
 * and keeps overriding it, which is the whole point of having made one.
 */
function bodyColor(color) {
  return RUG_COLORS[color]?.hex ?? COLORS.rugSage;
}

/**
 * The border, a shade darker than the body.
 *
 * Derived rather than written down. It used to be a literal sage green beside a body
 * colour the theme was free to change, so a room on a slate palette got a slate rug with
 * a green edge — and six choosable colours would have been six more chances to have
 * that argument. One rule instead: the border is the body, darkened.
 */
const EDGE = 0.88;
function borderColor(hex) {
  const shade = (shift) => Math.round(((hex >> shift) & 0xff) * EDGE);
  return (shade(16) << 16) | (shade(8) << 8) | shade(0);
}

/**
 * How far a rug's upper surface stands above the floor.
 *
 * Exported because the editor's floor chrome has to clear it: the blocked cells, the
 * footprint edges and the selection tint are all drawn a hair above the boards, and a
 * rug is also a hair above the boards. Anything drawn below this is invisible on a
 * rug — which is exactly what happened, and made the footprints impossible to see
 * while dragging anything across one (see the Y_ constants in editor/gizmos.js).
 *
 * The lift plus half the border box's height plus the border's own offset, which is
 * the tallest thing in the stack below.
 */
export const RUG_LIFT = 0.01;
export const RUG_TOP = RUG_LIFT + 0.005 + 0.07 / 2;

export function buildRug({ x, z, w, d, facing = 0, color = null }) {
  // Lying just clear of the floor surface, which it has to know rather than guess.
  const g = group(x, FLOOR_TOP + RUG_LIFT, z);
  // `w` and `d` are the rug's own axes, so the heading is applied to the group rather
  // than to the numbers: a quarter turn lays the same rectangle the other way round.
  g.rotation.y = facing;
  const rug = box(w, 0.06, d, bodyColor(color), { rough: 0.98, cast: false });
  rug.receiveShadow = true;
  g.add(rug);
  const border = put(g, box(w - 0.8, 0.07, d - 0.8, borderColor(bodyColor(color)), { rough: 0.98, cast: false }), 0, 0.005);

  /**
   * Change the colour without rebuilding the rug.
   *
   * Materials are handed out of a shared cache keyed by colour, so this asks for the
   * material of the new colour rather than writing into the one it has — mutating that
   * would repaint every other prop in the room that happens to be the same green.
   *
   * Hung on `userData` for the same reason `movable` is: a prop declares what can be
   * done to it at the point it is built, and the editor goes looking.
   */
  g.userData.repaint = (next) => {
    const body = bodyColor(next);
    rug.material = mat(body, { rough: 0.98 });
    border.material = mat(borderColor(body), { rough: 0.98 });
  };
  return g;
}

/**
 * Put a rug in the room.
 *
 * Its own mount rather than the common one in scene/props.js, for two reasons: its
 * size comes from the kind table rather than from the instance — a rug is `hw`/`hd`
 * like every other piece of furniture, doubled — and its colour has to come back
 * through `relocate`, which is the only moment a prop is told the layout has changed.
 */
export function mount(spec, handles, label) {
  const kind = FURNITURE_KINDS.rug;
  const obj = buildRug({
    x: spec.x, z: spec.z, w: kind.hw * 2, d: kind.hd * 2, facing: spec.facing, color: spec.color,
  });
  const relocate = () => {
    obj.position.set(spec.x, FLOOR_TOP + RUG_LIFT, spec.z);
    obj.rotation.y = spec.facing ?? 0;
    obj.userData.repaint(spec.color ?? null);
  };
  relocate();
  return movable(obj, `furniture:${spec.id}`, { label, spec, relocate });
}
