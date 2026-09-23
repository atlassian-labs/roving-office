// Choosing a zoom and a target for the room, given a viewport.
//
// The office's default is to fit: the whole room on screen, whatever the window.
// That is right for a window shaped roughly like the room, and increasingly wrong
// as the window gets wider, because the room is nearly square on screen and a
// 16:9 frame is not. Fitting a square into a wide frame leaves a third of the
// width as bare street, so a full-screen office reads as a small room adrift in a
// big empty picture.
//
// The other obvious answer, cover, is worse: filling the width of a 16:9 frame
// crops about a third of the room's height, and takes the top of the building and
// everybody's name tag with it.
//
// So neither. Fill the width, but stop before cropping more than `maxCrop` of the
// room, and put what is cropped where it costs least. Both halves are pure
// functions here so the arithmetic can be checked without a WebGL context; the
// caller supplies the room's on-screen box and applies the result.

/** Room fitting modes. `fit` is the default and today's behaviour. */
export const FRAME_MODES = ['fit', 'fill'];

/**
 * Zoom for a viewport, in the mode asked for.
 *
 * `halfW` and `halfH` are the room's half-extents *in the camera's screen basis*,
 * not world units: the projection is the caller's to do, and doing it there means
 * this works for any camera angle rather than assuming the default isometric one.
 *
 * The clamp to the office's own zoom limits is deliberate and last. A very tall,
 * narrow window would otherwise be handed a zoom the scroll wheel could never
 * return to, which is a worse outcome than imperfect framing.
 */
export function zoomForFrame({
  mode,
  aspect,
  frustum,
  halfW,
  halfH,
  maxCrop = 0.12,
  margin = 0.95,
  minZoom,
  maxZoom,
}) {
  if (!(aspect > 0) || !(halfW > 0) || !(halfH > 0)) return null;

  // Zoom that fills each axis exactly. The frustum's horizontal half-extent is
  // frustum * aspect and the vertical is frustum, both divided by zoom.
  const byWidth = (frustum * aspect) / halfW;
  const byHeight = frustum / halfH;

  const raw =
    mode === 'fill'
      ? // Go for width, but never past the point where the room loses more than
        // maxCrop of its height.
        Math.min(byWidth, byHeight / (1 - maxCrop))
      : // Fit: the tighter axis wins and nothing is cropped.
        Math.min(byWidth, byHeight);

  return Math.max(minZoom, Math.min(maxZoom, raw * margin));
}

/**
 * Where the vertical centre of the view should sit, in the camera's screen basis.
 *
 * Two cases, and they are not symmetric.
 *
 * With slack — a portrait window, where width bound the zoom — the surplus is
 * split unevenly on purpose. Above the building is street, skyline and traffic;
 * below it is bare ground. Splitting evenly puts a dead band under the room and
 * reads as the room floating too high.
 *
 * Without slack — the room is taller than the frame, so something is cropped —
 * the room's top edge is anchored to the top of the frame so the shortfall comes
 * off the bottom. That direction is the whole point: because the view is
 * isometric, the top of the room's box is the head of somebody standing at the
 * back, and the bottom is empty floor at the front. Centring would split the loss
 * between the two, and only one of them is expendable.
 */
export function verticalCentre({
  frustum,
  zoom,
  boxTop,
  boxBottom,
  bottomSlackShare = 0.25,
}) {
  const halfHeight = frustum / zoom;
  const span = boxTop - boxBottom;
  const slack = 2 * halfHeight - span;

  if (slack >= 0) {
    return boxBottom - bottomSlackShare * slack + halfHeight;
  }
  return boxTop - halfHeight;
}

/**
 * The room's box in the camera's screen basis.
 *
 * Kept here, and kept free of three.js, so the projection is checkable: it takes
 * the 16 elements of a camera's inverse world matrix rather than a camera. The
 * eight corners of the room's bounding box are projected and reduced to extents,
 * which is correct for any orbit angle — the room is a box, and a box's screen
 * outline is always the hull of its corners.
 *
 * `headroom` is added above the walls because the things that must not be clipped
 * are not the walls: they are the name tags floating over the people inside.
 */
export function roomScreenBox({ elements: e, room, headroom = 0 }) {
  if (!e || e.length < 16 || !room) return null;

  // Column-major, and only x and y matter: an orthographic camera's screen
  // position is the first two rows of the transform, and w is 1.
  const project = (x, y, z) => ({
    x: e[0] * x + e[4] * y + e[8] * z + e[12],
    y: e[1] * x + e[5] * y + e[9] * z + e[13],
  });

  const top = room.H + headroom;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < 8; i++) {
    const p = project(i & 1 ? room.W : 0, i & 2 ? top : 0, i & 4 ? room.D : 0);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    halfW: (maxX - minX) / 2,
    halfH: (maxY - minY) / 2,
    centreX: (maxX + minX) / 2,
    top: maxY,
    bottom: minY,
  };
}

/**
 * A frame mode held as a standing instruction.
 *
 * The distinction this exists to keep is between a hand-set camera and a computed
 * one. A hand zoom is a value; a frame mode is a rule, and the zoom that
 * satisfies it depends on the viewport. So a mode has to be remembered and
 * re-applied whenever the viewport changes, or it silently decays into whatever
 * zoom happened to satisfy it at the size it was set.
 *
 * That was the bug review caught in this change: `updateCameraAspect` fixes the
 * frustum on resize and leaves `zoom` alone, which is right for a hand-set camera
 * and wrong for a computed one. Holding the state here rather than in a module
 * variable is what lets the rule be tested without a viewport.
 */
export function createFrameController({ apply }) {
  let mode = null;

  return {
    /** Adopt a mode and apply it now. */
    set(next) {
      if (next) mode = next;
      if (mode) apply(mode);
    },
    /** Re-apply the standing mode, if there is one. For resize. */
    refresh() {
      if (mode) apply(mode);
    },
    /** What is in force, or null if a host never asked. */
    mode() {
      return mode;
    },
  };
}
