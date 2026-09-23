//
// One agent, in through the door, in a room of stubs.
//
// Half a dozen test files are about what a behaviour does *after* somebody has arrived:
// binning failed work, faxing it, collecting a printout, being driven by hand from the
// pilot buttons, coping with a room whose props have been taken away. None of them is
// about arriving, and all of them have to get through it first, because until `arriving`
// clears every behaviour queues behind the walk in rather than replacing it — so an
// assertion made too early is a statement about somebody still on the doormat.
//
// That opening was written out ten times across five files, along with five copies of
// the desk stub it stands somebody at, and the loading dance in front of it nine times.
// It is three separate things, each duplicated for its own reason:
//
//   loadRoom()          three.js and the manager, in Node, with a stubbed DOM
//   stubDesk(x, z)      somewhere to sit, without three hundred lines of geometry
//   arrived(props)      spawn Ada, walk her in, and hand back the room and her record
//
// `loadRoom` has to be awaited from a `before` hook and the other two only work once it
// has: the scene's modules bake canvas textures at import time, so nothing here can be
// imported until `document` exists, which is why every one of these files loads the
// manager dynamically rather than at the top of the file. Files that build their own
// room rather than an arrival — several desks, several agents, a stubbed clock — take
// just `loadRoom` and keep the rest.
//
// A real `AgentManager` with stub props, rather than a stub manager: the thing worth
// pinning in all of these is a walk that finishes and a frame that does not throw, and
// neither is visible to a test of a lookup.
//
// `node --test` treats every file under `test/` as a test file, so this one is reported
// in the run as a file with no tests in it — the same cost `frames.js` pays for sitting
// beside its callers, and for the same reason.
//
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../../bin/lib/headless-scene.js';
import { playUntil } from './frames.js';

let THREE, AgentManager;

/**
 * Everything a room needs before it can be built, once per test file.
 *
 * Call it from `before`. The DOM stub goes in first because importing a scene module
 * draws into a canvas, and three.js lands in `node_modules` on first use — see
 * `loadThree`. Both are returned for the files that build their own room and need to
 * make a `THREE.Group` or a manager by hand.
 *
 * @returns {Promise<{THREE: object, AgentManager: Function}>}
 */
export async function loadRoom() {
  stubDom();
  THREE = await loadThree();
  ({ AgentManager } = await import('../../src/agents/AgentManager.js'));
  return { THREE, AgentManager };
}

/** The one thing that can go wrong here, said once rather than as a TypeError. */
function requireRoom() {
  if (!AgentManager) throw new Error('await loadRoom() in a before() hook first');
}

/**
 * A desk, as far as the manager is concerned: somewhere to sit and a chair to swing.
 *
 * The real one is three hundred lines of geometry and none of it matters here — what a
 * behaviour asks of a desk is a seat, a heading, permission to turn the chair, and its
 * height: taking up a post at a desk puts it down and pulls the chair in first, because
 * the desk may be a sit-stand one that the last person left raised.
 *
 * This is an ordinary desk, so it answers as one: already down, chair already tucked in,
 * and moving it either way is a no-op — which is exactly what the real handle does when
 * there are no lifting columns under it. Nothing reads back what it was told, because
 * the only thing a setter here can change is which way a seated body faces, and no test
 * of a walk or an errand looks at that.
 *
 * @param {number} x
 * @param {number} z
 */
export function stubDesk(x, z) {
  requireRoom();
  return {
    id: `desk-${x}-${z}`,
    occupiedBy: null,
    seat: new THREE.Vector3(x, 0, z),
    sitRotation: 0,
    chairFacing: 0,
    standing: false,
    raised: 0,
    chairAside: 0,
    setChairFacing() {},
    setWorking() {},
    setMug() {},
    setStanding() {},
    pushChairAside() {},
  };
}

/**
 * One agent, in through the door and standing about with the coat hung up.
 *
 * Thirty seconds is the allowance for the walk in, which takes a few — long enough that
 * a room arranged so the door cannot be reached fails here, with a sentence saying so,
 * rather than in whichever assertion happens to come first. No longer than that either:
 * from here the room is rolling for what to do next, and a test that wants to see its
 * own errand has to get its event in before the idle roll picks one.
 *
 * `props` is the room, and it is whatever the caller wants it to be: pass a `door`, a
 * `bin`, a `byStation` of machines, or a `desks` of your own to put the desk somewhere
 * other than the middle of the floor.
 *
 * @param {object} [props]  props for the manager, over one desk at (12, 8)
 * @returns {{manager: object, rec: object}} the room, and Ada's record in it
 */
export function arrived(props = {}) {
  requireRoom();
  const manager = new AgentManager(new THREE.Group(), { desks: [stubDesk(12, 8)], ...props });
  manager.handleEvent({ type: 'spawn', id: 'a1', name: 'Ada Lovelace' });
  playUntil(manager, () => !manager.agents.get('a1').arriving, 30);
  const rec = manager.agents.get('a1');
  assert.equal(rec.arriving, false, 'the agent never finished arriving');
  return { manager, rec };
}
