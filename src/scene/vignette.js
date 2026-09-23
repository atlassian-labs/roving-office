// Reception's vignette: one desk, one agent, one small square of floor.
//
// The point of it is honesty. Reception is a page about a 3D office, and the
// cheapest way to say what is behind the door is to show a piece of it — so this
// builds the *same* desk (scene/props.js), the same Aeron chair, the same agent
// (agents/Agent.js) and the same sit-down choreography (agents/states.js) that the
// office uses, at a camera close enough to read a face. Nothing here is a drawing
// of the product; it is the product, cropped.
//
// It takes as much of the room as the crop can hold and no more: the corner two
// walls make behind the desk — sage on one side, beige on the other, both built by
// the office's own buildWall() — with one window cut in the beige one and a few
// trees on the grass outside it. That is the whole of the world here. There is no
// city, no source registry, no nav grid and no crowd: a vignette with one occupant
// needs no pathfinder (the floor is empty, so a straight line is the shortest way),
// and a street of buildings is both the expensive part of the scene and the part
// that would turn a close-up back into a thumbnail.
//
// Loaded lazily by src/wizard.js, after the keycard field is live, so a slow or
// missing three.js delays the picture and never the door — see the SVG fallback it
// swaps out.

import * as THREE from 'three';
import { COLORS, FLOOR_THICKNESS, ROOM } from '../config.js';
import { between } from '../dice.js';
import { lerp } from '../ease.js';
import { box, group, mat, put } from './build.js';
import { buildWall } from './environment.js';
import { buildBush, buildTree } from './outlooks/streetscape.js';
import { buildDesk, SEAT_HEIGHT, DESK_TOP_Y } from './props/desk.js';
import { createRenderer } from './renderer.js';
import { buildAceLogo } from './standees.js';
import { Agent } from '../agents/Agent.js';
import {
  AgentController, act, face, sit, stand, status, stepTo, turnChair, wait, walk,
} from '../agents/states.js';

// The desk sits at the origin facing +z, so its occupant looks into -z — which is
// also why the camera ends up off to the side rather than square behind them. The
// screens face the occupant, so a lit monitor is only a lit monitor from their side
// of the desk; but straight on, the chair's own back hides the person in it. Fifty
// degrees round is the compromise the framing is built on: glowing screens, and a
// shoulder and a head over the top of the chair.
const DESK = { id: 'reception', x: 0, z: 0, facing: 0 };

// The corner the desk stands in.
//
// Two walls, in the office's own two colours and its own construction: sage across
// the back of the desk, beige down the left with the window in it. They are what
// closes the picture now — before them the floor had to run wide enough that its far
// edge landed where the stage's mask had already faded the frame out, because a
// plank floor stopping in mid-air is the one thing that gives away that there is no
// room here.
//
// The heights are not the room's. Reception's camera sits at 3.8 and looks slightly
// down, so the frame runs out around y = 3.8 at this depth: the office's glazing,
// which starts at 2.2 and finishes at 6.8, would show as a sliver of sill with its
// head somewhere off the top of the picture. So the wall is 5.6 rather than 8 — high
// enough to fill the frame, low enough not to spend geometry above it — and the
// window is dropped to sit inside the crop, where it can hold the whole of the view
// out. Everything else about it is the room's: same thickness, same frame, same
// glass, same baseboard.
const WALL_T = ROOM.wallT;
const CORNER = {
  greenZ: -1.85,       // sage wall's centre plane, just behind the back of the desk
  beigeX: -4.3,        // beige wall's, out past the end of it
  height: 5.6,
  sill: 1.42,
  head: 3.34,
  // Where the beige wall stops on the near side. Short of the entry corridor on
  // purpose: the agent walks in past this open end, and a wall that ran any further
  // towards the camera would hide them for the first half of the walk.
  beigeNearZ: 3.4,
  greenFarX: 7.0,      // the sage wall's other end, well outside the frame
  window: { z: 1.0, width: 3.2 },
};

// The floor, now that it has walls to stop against: from the inner face of one to
// beyond the frame's edge, where the mask takes over.
const FLOOR = {
  x0: CORNER.beigeX + WALL_T / 2,
  x1: 20,
  z0: CORNER.greenZ + WALL_T / 2,
  z1: 16,
};
const PLANK_W = 1.6;

// Outside the window: grass a step below the office floor, a handful of the park's
// own trees, and the far side of the park closing the view. Everything out here is
// placed in the window's coordinates rather than the world's,
// because the window is what decides where the ground is.
//
// The camera sits above the head of the glass and looks down through it, so the
// opening is a view of ground and nothing else — no sky, no horizon, since the
// horizon would appear at eye level and eye level is behind plaster. The strip of
// park it shows runs from about twelve units out at the sill to ninety at the head,
// which is nothing like a linear scale: a tree placed by eye at fifteen units fills
// the whole opening, and a tree at forty is a third of the way up it. Guessing world
// coordinates got a hedge pressed against the glass three times in a row.
//
// So each thing out here is given `u` across the opening and `v` up it, and
// groundPoint() works out where that lands. `v` is the honest control: it is how far
// up the window the foot of the thing appears, so lawn first, then bushes, then
// trees, then the far side of the park at the top.
const OUTSIDE = {
  groundY: -0.34,
  trees: [
    { u: 0.30, v: 0.50, scale: 0.95 },
    { u: 0.62, v: 0.62, scale: 0.90 },
    { u: 0.16, v: 0.72, scale: 0.85 },
    { u: 0.78, v: 0.78, scale: 0.80 },
  ],
  bushes: [{ u: 0.45, v: 0.28 }, { u: 0.72, v: 0.38 }, { u: 0.22, v: 0.42 }],
  // A path, because nothing says park faster than one. It runs away from the window
  // rather than across it, so it reads as a diagonal going somewhere.
  path: { v: 0.33, width: 3.0 },
  // Where the park stops. High up the opening, so it is a band along the top with
  // most of the lawn in front of it.
  treelineV: 0.9,
};

// The park is lit by its own sun, and nothing else is.
//
// The room's key light comes in through the window, which is the right way round for
// the room — it is what puts the light on the sage wall — and exactly the wrong way
// round for the park, whose every face towards us is then the shaded side. Turning
// the key round to suit the trees would flatten the desk and light the wrong wall.
// So the outside gets a second sun from over the viewer's shoulder, kept off the
// room by three.js layers: objects outside are on this layer as well as the default
// one, so the camera still sees them and the park's sun still misses the furniture.
const PARK_LAYER = 1;

// Where the camera stands and what it looks at. A long-ish lens from off the front
// corner: close enough to read the agent, flat enough to keep the isometric feel of
// the office rather than turning into a first-person shot.
const CAM = {
  fov: 30,
  position: [7.0, 3.8, 5.9],
  target: [0.1, 1.5, 1.1],
};

// Where the agent comes in from — off the left of frame, walking in on the diagonal
// so the first thing the page does is move. WAYPOINT keeps that diagonal on the
// room's side of the beige wall: the straight line from ENTRY to the chair used to
// cross where the wall now stands, and an agent walking through plaster is worse
// than an agent taking the corner a little wide.
const ENTRY = { x: -8.6, z: 5.9 };
const WAYPOINT = { x: -2.4, z: 5.0 };

// You stand this far out from a seat to get into it. Same figure as the office's
// CHAIR_FRONT, and the same reason: far enough out that the swung-out seat is not
// where your feet are.
const CHAIR_FRONT = 0.95;

// How long a stretch of typing runs, and the pause between stretches. A body that
// types without pause reads as a machine, so the work comes in bursts.
const TYPING_RUN = [5, 9];
const THINKING_PAUSE = [1.2, 2.8];

// How long one visit to the desk lasts, and how long the desk sits empty before
// they come back. Reception is not a simulation — there is nowhere they have
// actually gone — but a desk nobody ever gets up from reads as a photo, not a
// window, so the agent steps out of frame and back on a loop of its own.
const DESK_TIME = [8, 10];
const AWAY_TIME = [4, 10];

/**
 * Typing bursts and thinking pauses, back to back, filling roughly `total`
 * seconds. Same idea as the office's own idle chatter, just spent all at once
 * against a budget instead of doled out one pair at a time.
 */
function workBursts(total) {
  const actions = [];
  let left = total;
  while (left > 0.5) {
    const typing = Math.min(between(...TYPING_RUN), left);
    actions.push(wait(typing, { typing: true }));
    left -= typing;
    if (left <= 0.5) break;
    const pause = Math.min(between(...THINKING_PAUSE), left);
    actions.push(wait(pause));
    left -= pause;
  }
  return actions;
}

/**
 * Build the vignette on a canvas and start it.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {() => void} [opts.onFirstFrame]  called once something is on screen, so
 *   the caller can retire whatever placeholder it was showing.
 * @returns {{dispose: () => void}} teardown, for a caller that unmounts. Reception
 *   never does — the page is the vignette's whole lifetime — but a scene that
 *   cannot be taken down is a leak waiting for the first person to reuse it.
 */
export function mountVignette(canvas, { onFirstFrame } = {}) {
  const stage = canvas.parentElement ?? canvas;

  // The office's own look, so a monitor that has just come on glows here exactly as
  // hard as it does in the room; transparent, so the page's own background is the
  // backdrop. Sized by resize() below, against the stage rather than the window.
  const renderer = createRenderer({ canvas, transparent: true });

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.1, 120);
  camera.position.set(...CAM.position);
  camera.lookAt(...CAM.target);

  scene.add(buildFloor());
  scene.add(buildCorner());
  scene.add(buildOutside());
  addLights(scene);

  const { obj: deskObj, handle: desk } = buildDesk(DESK);
  scene.add(deskObj);

  // The Atlassian ace, standing on the desk to the left of the keyboard — the same
  // side of the desk the mug sits on, opposite the mouse. Level with the monitors
  // rather than the keyboard's own KEYS_Z: this camera sits behind the seated
  // agent's left shoulder, so anything at keyboard depth is behind their head.
  // Out by the monitor foot, it clears the agent and reads clean against the wall.
  const { obj: aceObj } = buildAceLogo(0.4);
  aceObj.position.set(-1.75, DESK_TOP_Y, -0.35);
  deskObj.add(aceObj);

  // No name tag: reception has one agent and no names to tell apart, and a pill
  // reading a made-up name is the one thing here that would not be true of the
  // office. The status ring under their feet stays — it is the same green.
  const agent = new Agent({ id: 'reception', name: 'Reception' });
  agent.setTagFade(0);
  agent.setPositionXZ(ENTRY.x, ENTRY.z);
  scene.add(agent.root);

  // A straight line is the shortest way across an empty floor, so this is the whole
  // of the navigation the vignette needs. Same shape as the office's nav so the
  // controller cannot tell the difference.
  const nav = { findPath: (_from, to) => [to.clone()] };
  const controller = new AgentController(agent, nav);

  // Somebody arriving at a desk and sitting down at it, in the office's own words.
  const entryFacing = desk.sitRotation + Math.PI;      // looking out of the chair
  const front = new THREE.Vector3(
    desk.seat.x + Math.sin(entryFacing) * CHAIR_FRONT, 0,
    desk.seat.z + Math.cos(entryFacing) * CHAIR_FRONT,
  );
  const arrive = [
    status('walking'),
    walk(new THREE.Vector3(WAYPOINT.x, 0, WAYPOINT.z)),
    walk(front),
    turnChair(desk, entryFacing),
    face(entryFacing),
    sit(null, SEAT_HEIGHT, desk.seat),
    turnChair(desk, desk.sitRotation),
    // The monitors are black until this moment, which is the one beat the whole
    // vignette is built around.
    act(() => desk.setWorking(true)),
    status('working'),
  ];

  /**
   * One visit to the desk: work for a while, then get up, walk out of frame, wait
   * off-screen, and walk back in to sit down again. The chair choreography is the
   * office's own — swing it clear, stand, step off it, swing it back in behind
   * them (see sitDownAtDesk / standUpFromDesk in agents/AgentManager.js) — just
   * against the fixed entry this corner has instead of one chosen from the room.
   */
  function cycle() {
    return [
      ...workBursts(between(...DESK_TIME)),

      // Up and out. The monitors go dark the moment they're out of the chair, same
      // as an empty desk anywhere else in the office.
      turnChair(desk, entryFacing),
      stand(),
      stepTo(front, 0.26),
      turnChair(desk, desk.sitRotation),
      act(() => desk.setWorking(false)),
      status('walking'),
      walk(new THREE.Vector3(WAYPOINT.x, 0, WAYPOINT.z)),
      walk(new THREE.Vector3(ENTRY.x, 0, ENTRY.z)),

      status('idle'),
      wait(between(...AWAY_TIME)),

      // Back in, the same way they left.
      status('walking'),
      walk(new THREE.Vector3(WAYPOINT.x, 0, WAYPOINT.z)),
      walk(front),
      turnChair(desk, entryFacing),
      face(entryFacing),
      sit(null, SEAT_HEIGHT, desk.seat),
      turnChair(desk, desk.sitRotation),
      act(() => desk.setWorking(true)),
      status('working'),
    ];
  }

  // The queue refills itself rather than the agent going idle at a lit — or dark —
  // desk: each time it empties, the next visit is already decided.
  controller.onIdle = () => controller.push(cycle());

  // Anyone who has asked not to be moved gets the same picture, already settled:
  // seated, screens on, nothing animating. The scene is the point, not the walk.
  const stillness = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const still = Boolean(stillness?.matches);
  if (still) {
    agent.setPositionXZ(desk.seat.x, desk.seat.z);
    agent.setRotation(desk.sitRotation);
    agent.setSeated(true, { seatHeight: SEAT_HEIGHT, instant: true });
    agent.setStatus('working');
    agent.update(0, { typing: true });
    desk.setWorking(true);
  } else {
    controller.run(arrive);
  }

  // ---- Frame loop -------------------------------------------------------
  // Paused whenever nobody can see it: scrolled out of view, or the tab in the
  // background. Reception is a page people leave open.
  let raf = 0;
  let last = performance.now();
  let onScreen = true;
  let painted = false;

  function draw() {
    renderer.render(scene, camera);
    if (!painted) {
      painted = true;
      onFirstFrame?.();
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);   // a returning tab is not a leap
    last = now;
    controller.update(dt);
    desk.update(dt);          // the board on the right-hand screen
    draw();
  }

  function play() {
    if (raf || still || document.hidden || !onScreen) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function resize() {
    const w = stage.clientWidth;
    // A canvas with no height yet (a stage still being laid out) would set an
    // aspect of Infinity and paint nothing, so wait to be asked again.
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  }

  const sizes = new ResizeObserver(resize);
  sizes.observe(stage);
  resize();

  const seen = new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting);
    if (onScreen) play(); else pause();
  }, { threshold: 0.01 });
  seen.observe(canvas);

  const onVisibility = () => (document.hidden ? pause() : play());
  document.addEventListener('visibilitychange', onVisibility);

  play();
  // A still scene never enters the loop, so it needs one frame drawn by hand.
  if (still) draw();

  return {
    dispose() {
      pause();
      sizes.disconnect();
      seen.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      agent.dispose();
      scene.traverse((o) => o.geometry?.dispose?.());
      renderer.dispose();
    },
  };
}

/**
 * The office's plank floor, cropped to a patch.
 *
 * Same construction as scene/environment.js — alternating tones, planks running the
 * depth of the room, slabs centred on y = 0 so props standing at y = 0 have their
 * feet in the surface rather than on top of it.
 */
function buildFloor() {
  const g = group(0, 0, 0);
  const width = FLOOR.x1 - FLOOR.x0;
  const depth = FLOOR.z1 - FLOOR.z0;
  const planks = Math.ceil(width / PLANK_W);
  for (let i = 0; i < planks; i++) {
    const shade = i % 2 === 0 ? COLORS.floorWood : COLORS.floorWoodAlt;
    const p = box(PLANK_W * 0.97, FLOOR_THICKNESS, depth, shade, { rough: 0.8, cast: false });
    p.position.set(FLOOR.x0 + i * PLANK_W + PLANK_W / 2, 0, FLOOR.z0 + depth / 2);
    p.receiveShadow = true;
    g.add(p);
  }
  return g;
}

/**
 * The two walls behind the desk, built by the office's own wall builder.
 *
 * Which wall is which colour, and which one carries the window, is the room's
 * arrangement rather than a decision taken here: the office's sage wall is the one
 * agents' desks face, and its beige wall is the one round to the side with the
 * glazing in it. The camera is 50 degrees off the front of the desk, which puts the
 * beige wall nearly square to us and the sage one raking away — so the window ends
 * up where the eye lands, which is the whole reason to cut one.
 *
 * The beige wall owns the corner and the sage wall butts against its inner face, as
 * in the room, so the two never share a face for the depth buffer to argue over.
 */
function buildCorner() {
  const g = group(0, 0, 0);
  const shared = { height: CORNER.height, sill: CORNER.sill, head: CORNER.head };

  // Sage, across the back of the desk. Runs from the beige wall's inner face out
  // past the right-hand edge of the frame.
  const greenFrom = CORNER.beigeX + WALL_T / 2;
  g.add(buildWall({
    length: CORNER.greenFarX - greenFrom,
    color: COLORS.wallSage,
    position: [(greenFrom + CORNER.greenFarX) / 2, CORNER.height / 2, CORNER.greenZ],
    rotationY: 0,
    extent: null,
    skirtReturns: [false, true],
    ...shared,
  }).obj);

  // Beige, down the left, with the window. Turned a quarter round, so its local +x
  // runs towards world −z: the corner end is local +x, the open near end local −x,
  // and a window's `center` fraction is measured from that near end — which is why
  // the fraction below is worked out from the wall's own span rather than written in.
  const beigeFar = CORNER.greenZ - WALL_T / 2;      // wraps the sage wall's outer face
  const length = CORNER.beigeNearZ - beigeFar;
  const centreZ = (beigeFar + CORNER.beigeNearZ) / 2;
  const localX = centreZ - CORNER.window.z;
  g.add(buildWall({
    length,
    color: COLORS.wallWhite,
    position: [CORNER.beigeX, CORNER.height / 2, centreZ],
    rotationY: Math.PI / 2,
    extent: null,
    skirtReturns: [true, false],
    windows: [{ center: (localX + length / 2) / length, width: CORNER.window.width }],
    ...shared,
  }).obj);

  return g;
}

/**
 * Where a point on the glass is looking: the spot on the ground outside that appears
 * at (u, v) in the window's opening.
 *
 * Straight line from the camera through the glass to the plane of the park. `u` runs
 * across the opening — 0 at the deep end, 1 at the end nearest the viewer — and `v`
 * up it, 0 at the sill and 1 at the head. It is only ever used to place things, so
 * nothing here needs to be exact; it needs to be the same arithmetic the renderer
 * will do, which by eye it was not.
 *
 * @param {number} u
 * @param {number} v
 * @returns {{x: number, z: number}} world position on the ground
 */
function groundPoint(u, v) {
  const [cx, cy, cz] = CAM.position;
  const wx = CORNER.beigeX;
  const wz = CORNER.window.z + (u - 0.5) * CORNER.window.width;
  const wy = CORNER.sill + v * (CORNER.head - CORNER.sill);
  // How far past the glass the ray travels before it reaches the grass. The head of
  // the window is only just below the camera, so this grows very fast with v — which
  // is the whole reason for placing the park this way round.
  const s = (cy - OUTSIDE.groundY) / (cy - wy);
  return { x: lerp(cx, wx, s), z: lerp(cz, wz, s) };
}

/**
 * What the window looks out on: a lawn with a path across it, a few of the park's own
 * trees, and the far side of the park closing the view.
 *
 * The trees and bushes are the exterior's, so this is the same park the office has
 * across the road — but only ever the sliver of it the opening shows, and the ground
 * is only drawn where the opening can see it. That is worked out from the window
 * rather than guessed: the corners of the view give the lawn its extent, and the
 * treeline stands at whatever distance groundPoint() says is nine tenths of the way
 * up the glass.
 */
function buildOutside() {
  const g = group(0, 0, 0);
  const y = OUTSIDE.groundY;

  // The four corners of what the window can see, out as far as the treeline. Beyond
  // it there is nothing to draw, which is the only reason the lawn is a sane size:
  // the sightline through the head of the glass runs ninety units before it lands.
  const seen = [
    groundPoint(0, 0.02), groundPoint(1, 0.02),
    groundPoint(0, OUTSIDE.treelineV), groundPoint(1, OUTSIDE.treelineV),
  ];
  const xs = seen.map((p) => p.x);
  const zs = seen.map((p) => p.z);
  const x0 = Math.min(...xs) - 8;
  const x1 = Math.max(...xs) + 6;
  const z0 = Math.min(...zs) - 8;
  const z1 = Math.max(...zs) + 8;

  // Grass. One slab, with no visible edge anywhere: the sill's own sightline does not
  // reach the ground for a dozen units, so the near edge is never in shot.
  const grass = box(x1 - x0, 0.6, z1 - z0, COLORS.grass, { rough: 1.0, cast: false });
  grass.position.set((x0 + x1) / 2, y - 0.3, (z0 + z1) / 2);
  grass.receiveShadow = true;
  g.add(grass);

  // A mown stripe and a path, laid on the grass in that order. Both run away from the
  // window rather than across it, so they cross the opening on the diagonal and give
  // the eye something to measure the depth of the lawn against.
  put(g, box(14, 0.02, z1 - z0, 0x93b878, { rough: 1.0, cast: false }), groundPoint(0.5, 0.62).x, y + 0.01, (z0 + z1) / 2);
  put(g, box(OUTSIDE.path.width, 0.04, z1 - z0, COLORS.sidewalk, { rough: 0.95, cast: false }), groundPoint(0.5, OUTSIDE.path.v).x, y + 0.02, (z0 + z1) / 2);

  for (const t of OUTSIDE.trees) {
    const p = groundPoint(t.u, t.v);
    g.add(buildTree(p.x, p.z, y, t.scale, 'summer'));
  }
  for (const b of OUTSIDE.bushes) {
    const p = groundPoint(b.u, b.v);
    g.add(buildBush(p.x, p.z, y, 'summer'));
  }

  // The far side of the park: a bank of canopy with a solid mass behind it, so no
  // daylight — and no dark page — shows between the blobs. Both are painted in a green
  // mixed towards the haze colour, because the air between here and there is the only
  // thing telling the eye how far away it is.
  const far = mat(0x9cb79f, { flat: true, rough: 0.95 });
  const farDark = mat(0x86a48c, { flat: true, rough: 0.95 });
  const treeline = groundPoint(0.5, OUTSIDE.treelineV).x;
  put(g, box(1.2, 12, z1 - z0, 0x93ae98, { rough: 1.0, cast: false }), treeline - 3, y + 6, (z0 + z1) / 2);
  const blobs = Math.ceil((z1 - z0) / 3);
  for (let i = 0; i < blobs; i++) {
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.4 + (i % 3) * 0.5, 0),
      i % 2 ? far : farDark,
    );
    blob.position.set(treeline + (i % 2 ? 1.1 : 0), y + 2.4 + (i % 3) * 0.7, z0 + i * 3);
    g.add(blob);
  }

  // Everything out here answers to the park's sun as well as the room's lights.
  g.traverse((o) => o.layers.enable(PARK_LAYER));

  return g;
}

/**
 * A light rig for a close-up, not a room.
 *
 * The office's rig is driven by a world clock and throws a sun across forty units
 * of floor; none of that survives a crop this tight, and a shadow map sized for the
 * room would spend its resolution on floor nobody can see. So: one warm key from
 * the front left with a shadow camera drawn round the desk, a cool sky fill for the
 * bounce, and a dim rim from behind the monitors to lift the agent off the page.
 */
function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xdfe9ef, 0xd8c6a0, 1.05));

  const key = new THREE.DirectionalLight(0xffe6bd, 1.5);
  key.position.set(-7, 10, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const s = 9;
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 34;
  key.shadow.bias = -0.0008;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xa8c8e8, 0.35);
  rim.position.set(4, 6, -9);
  scene.add(rim);

  // A soft fill from the viewer's side. The key comes through the window, so without
  // this the beige wall — the one the light passes through — is the darkest thing in
  // the frame, and reads as grey rather than beige.
  const fill = new THREE.DirectionalLight(0xfff2dd, 0.65);
  fill.position.set(11, 5, 6);
  scene.add(fill);

  // The park's own sun and sky, on the park's layer. Brighter than anything indoors,
  // because a window onto a summer afternoon is a window onto something brighter than
  // the room it lights.
  const sun = new THREE.DirectionalLight(0xfff4e2, 2.6);
  sun.position.set(16, 13, 11);
  sun.layers.set(PARK_LAYER);
  scene.add(sun);

  const outdoorSky = new THREE.HemisphereLight(0xdcecf4, 0x6f8f5f, 1.5);
  outdoorSky.layers.set(PARK_LAYER);
  scene.add(outdoorSky);
}
