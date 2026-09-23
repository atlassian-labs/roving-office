// Riding an agent.
//
// The office is watched from outside, orthographically, which is the right lens
// for reading a room and the wrong one for standing in it. `f` swaps to a
// perspective camera parked behind the selected agent's eyes: same scene, same
// simulation, a viewpoint instead of a plan.
//
// The ride owns exactly one piece of state — whose eyes we are looking through —
// and it is deliberately not just a boolean paired with the selection: the ride
// survives you clicking a different agent (it moves to them), but it must not
// survive that agent leaving, and it has to be able to end while a selection
// remains. main.js keeps the selection in step with the ride (see
// selectionChanged there); the render loop only asks `track()` to aim.

import { FPV } from './config.js';
import { aimFirstPerson } from './scene/camera.js';

/**
 * @param {object} deps
 * @param {THREE.PerspectiveCamera} deps.fpvCamera  the first-person lens
 * @param {object} deps.controls   the orbit controls to freeze while riding
 * @param {object} deps.fpvHud     the caption panel (ui/fpv-hud.js)
 * @param {() => ?object} deps.getWorld  the live world, if any
 */
export function createFpvRide({ fpvCamera, controls, fpvHud, getWorld }) {
  /** @type {?string} whose eyes, or null for the office view */
  let fpvId = null;

  function enter(id) {
    const agent = getWorld()?.manager.getAgent(id);
    if (!agent) return;
    fpvId = id;
    // Aim once before the next frame so the view opens already in the head, rather
    // than easing in from wherever the last ride left the camera.
    aimFirstPerson(fpvCamera, agent, 0);
    // The orbit camera keeps its framing for when we step back out, but its controls
    // must stop reading the mouse: a drag now is aiming a camera it does not own.
    controls.enabled = false;
    fpvHud.show(agent);
    sync();
  }

  function exit() {
    if (!fpvId) return;
    fpvId = null;
    controls.enabled = true;
    fpvHud.hide();
    sync();
  }

  /**
   * Put every agent into the right presentation for the lens that is about to draw.
   *
   * Three things, all of which have to be true of *every* agent rather than only the
   * one being ridden — and one that is true of only that one:
   *
   * - Tags render as part of the world while riding, over it otherwise. It is the
   *   *other* agents' tags that punch through the monitor you are looking at.
   * - Tags fade as they come closer than they can be read.
   * - The agent being ridden loses their own head, because you are inside it.
   *
   * Called each frame as well as on entry, because a feed can add or retire an agent
   * mid-ride and a newcomer would otherwise arrive dressed for the wrong lens. Every
   * setter returns early when nothing has changed, so a steady frame costs a handful
   * of comparisons per agent.
   */
  function sync() {
    const world = getWorld();
    if (!world) return;
    const riding = fpvId != null;
    const mode = riding ? 'inWorld' : 'overlay';
    const { tagFadeNear, tagFadeFar } = FPV;
    const span = Math.max(1e-3, tagFadeFar - tagFadeNear);

    for (const rec of world.manager.agents.values()) {
      const { agent } = rec;
      // Being beamed up: their tag was put out as the cone came down, and they are
      // gone within the second. Distance to a rising body is not a question worth
      // answering, and answering it would light the pill up again halfway to the
      // ceiling (see scene/beam.js).
      if (rec.beaming) continue;
      agent.setTagMode(mode);
      // Only the rider is inside their own head; everyone else keeps theirs.
      agent.setHeadVisible(!(riding && agent.id === fpvId));
      if (!riding) continue;
      // Distance across the floor, not through the air. Two reasons, and the second
      // is the load-bearing one: "how far away is that person" is a question about the
      // floor, and the eye sits roughly 2.3 above its own feet — so a straight-line
      // measure would put the agent being ridden a comfortable 2.3 away and leave them
      // wearing their own name tag in the middle of their own view.
      const dx = fpvCamera.position.x - agent.root.position.x;
      const dz = fpvCamera.position.z - agent.root.position.z;
      agent.setTagFade((Math.hypot(dx, dz) - tagFadeNear) / span);
    }
  }

  /**
   * Keep the first-person camera on its agent, and the caption on their work.
   *
   * The agent going away is the interesting case: a feed can retire one at any time,
   * and there is no event to lean on that would fire before the body is gone from the
   * scene. Checking here means the ride ends by returning you to the office view
   * rather than by leaving the camera stranded inside a deleted head.
   */
  function track(dt) {
    if (!fpvId) return;
    const agent = getWorld()?.manager.getAgent(fpvId);
    if (!agent) return exit();
    aimFirstPerson(fpvCamera, agent, dt);
    fpvHud.update(agent, dt);
    sync();
  }

  return {
    /** Whose eyes we are looking through, or null for the office view. */
    get id() { return fpvId; },
    enter,
    exit,
    sync,
    track,
  };
}
