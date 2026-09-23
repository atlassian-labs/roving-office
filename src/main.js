import * as THREE from 'three';
import {
  keycard, loadOffice, officeInfo, watchOffice, claimLocalEndpoint,
  listScenes, getScene, initialSceneId, rememberActive,
  addScene, setSceneSources, setSceneLook, removeScene, renameScene, watchScenes,
  isOwner, tryPasscode, setPasscode, closeOffice,
} from './office/office.js';
import { openNewOffice } from './office/new-office.js';
import {
  createCamera, updateCameraAspect, createControls, clampPan,
  createFirstPersonCamera, updateFirstPersonAspect,
} from './scene/camera.js';
import { createRenderer } from './scene/renderer.js';
import { saveCameraView } from './scene/camera-view.js';
import { applyTimeOfDay, dayLength, declinationFor, createReflectionEnvironment } from './scene/lighting.js';
import { applyNightLights } from './scene/night-lights.js';
import { buildWorld, changeAppearance, disposeWorld } from './world.js';
import { applyLayout, resetLayout, stationsOfKind } from './layout.js';
import { createFpvRide } from './fpv.js';
import { setTagLegibility, tagLegibilityFor } from './agents/Agent.js';
import { CAMERA, ROOM } from './config.js';
import { BUILDING_LIST, SEASON_LIST } from './projects.js';
import {
  createFrameController,
  roomScreenBox,
  verticalCentre,
  zoomForFrame,
} from './scene/framing.js';
import { startHostApi } from './host.js';
import { createOverlay } from './ui/overlay.js';
import { createSceneSwitcher } from './ui/switcher.js';
import { createKeycardChip } from './ui/keycard-chip.js';
import { createKeycardDialog } from './ui/keycard-dialog.js';
import { askForPasscode } from './ui/passcode-prompt.js';
import { createSourcePicker } from './ui/source-picker.js';
import { createSourceBadge } from './ui/source-badge.js';
import { createShortcutsPanel, press, register, registerGesture } from './ui/shortcuts.js';
import { createWelcomeHint } from './ui/welcome-hint.js';
import { createFpvHud } from './ui/fpv-hud.js';
import { createDevPanel } from './ui/dev-panel.js';
import { createScenePanel, LIGHT_MODES } from './ui/scene-panel.js';
import { createNorthCompass } from './ui/north-compass.js';
import { hemisphereOf } from './ui/place-map.js';
import { copySceneToClipboard } from './ui/photo.js';
import { recallPanel, rememberPanel } from './ui/panel-state.js';
import { officePath } from './office/keycard.js';
import { createEditor } from './editor/editor.js';
import { worldClock } from './time.js';

const canvas = document.getElementById('scene');
const loading = document.getElementById('loading');

// --- Renderer, camera and controls live for the whole session -------------
// Only the world (room, props, agents, feed) is rebuilt when you switch project,
// so your camera framing survives the swap.

const renderer = createRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const reflections = createReflectionEnvironment(renderer);
scene.environment = reflections.texture;

const camera = createCamera(window.innerWidth / window.innerHeight);
const controls = createControls(camera, canvas);

/**
 * The first-person lens, used while riding an agent. Built once and kept: it is
 * cheap to hold and its own aspect has to survive resizes whether or not the view
 * is active, so it cannot be made on demand.
 */
const fpvCamera = createFirstPersonCamera(window.innerWidth / window.innerHeight);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedId = null;

/**
 * The ride (src/fpv.js): whose eyes we look through, and the lens swap. Why the
 * ride is its own state rather than a boolean on `selectedId` is documented
 * there. Declared here like `badge` and `editor` — it is built after the HUD
 * exists, but `activeCamera` and the selection plumbing reference it first.
 * @type {?object}
 */
let ride = null;

/** The camera the frame is drawn through, and the one clicks are cast from. */
function activeCamera() { return ride?.id ? fpvCamera : camera; }

/* The frame mode a host asked for, held as a standing instruction so the resize
 * handler can re-apply it. Declared up here with the session-long camera state
 * because that handler is installed long before `applyFrameMode` exists. */
const frameControl = createFrameController({ apply: (mode) => applyFrameMode(mode) });

/**
 * The live world. Everything in here is torn down and rebuilt on a project
 * switch; `null` only before the first build.
 * @type {?{project: object, theme: object, root: THREE.Group, props: object,
 *          mail: MailFlights, deliveries: CourierDeliveries,
 *          manager: AgentManager, feeds: object}}
 */
let world = null;

/**
 * Season, building and sun overrides from the scene panel. They sit outside the
 * world because a world is rebuilt to apply them, so they cannot live in one.
 * Reset to the project's own defaults whenever the project changes — a project
 * defines its look, and carrying "winter" into a tower would be surprising.
 *
 * `bearing` is the odd one out and rides along anyway: it needs no rebuild, so it
 * is written straight onto the live theme (see `applyBearing`). It is kept here so
 * that the one place a look is assembled stays the one place, and so a scene
 * switch clears it with the rest.
 * @type {{season: ?string, building: ?string, bearing: ?number}}
 */
let overrides = { season: null, building: null, bearing: null, lat: null, lon: null };

/**
 * Lighting override from the scene panel: 'auto' follows the world clock,
 * 'on' and 'off' force the lamps and ceiling fittings either way.
 *
 * Unlike season and building this needs no rebuild — the fittings already exist
 * and only their intensity changes — so it lives here and is read each frame
 * rather than triggering activateProject().
 */
let lightsMode = 'auto';
let automaticLightLevel = 0;

/**
 * The source badge and the picker, declared here rather than where they are
 * built: the very first world is constructed *before* the UI exists, and its
 * feeds report their state synchronously as they are created. Referencing a
 * `const` from that callback would hit the temporal dead zone and take down boot.
 * @type {?object}
 */
let badge = null;
/** @type {?object} */
let sourcePicker = null;

/**
 * The furniture editor. Declared here for the same reason as the two above: it is built
 * after the first world, but `activateScene` — which runs on every switch, and could run
 * before it — has to tell it the room has been replaced. A `const` read from there would
 * be in its temporal dead zone, which optional chaining does not save you from.
 * @type {?object}
 */
let editor = null;

/**
 * The transient direction instrument. It is built with the rest of the HUD, but
 * bearing changes are wired above that point, so keep the pre-HUD state explicit.
 * @type {?ReturnType<typeof createNorthCompass>}
 */
let northCompass = null;

/** What the night lights should be doing, given what the clock wants. */
function lightsLevel(fromClock) {
  if (lightsMode === 'on') return 1;
  if (lightsMode === 'off') return 0;
  return fromClock;
}

/** Feed status lands on the badge — which may not exist yet at first build. */
const onFeedStatus = (summary, states) => badge?.setStatus(summary, states);

/**
 * Put the furniture where this scene keeps it, before anything is built from it.
 *
 * Every prop, the nav grid and the number of desks are derived from the layout at
 * build time, so this has to run before `makeWorld` rather than after it.
 *
 * A scene nobody has rearranged has no layout stored and gets the authored one back.
 * That is a change from when the layout was a session-long singleton that followed
 * you from room to room: now that an edit is *kept*, carrying it into the next scene
 * would mean opening a room and finding somebody else's furniture in it. Laying one
 * room out and looking at it in another building is still a keystroke away — it is
 * the same layout blob, exported from one scene and imported into the other.
 */
function applySceneLayout(sceneId) {
  const stored = getScene(sceneId)?.record?.layout;
  if (stored) applyLayout(stored);
  else resetLayout();
}

/** Build a complete world for a scene and start its feed (src/world.js). */
function makeWorld(sceneId) {
  return buildWorld(sceneId, { scene, overrides, lightsLevel, onFeedStatus });
}


/**
 * Tear the world down and build the named scene in its place.
 *
 * @param {string} sceneId
 * @param {object} [opts]
 * @param {boolean} [opts.keepOverrides]  leave season/building alone. Set when
 *   rebuilding the *same* scene after a developer-panel change — a rolled scene
 *   would otherwise snap straight back to the look it was stored with, which
 *   made the season buttons appear broken.
 */
function activateScene(sceneId, { keepOverrides = false } = {}) {
  const next = getScene(sceneId);
  if (!keepOverrides && next?.look) overrides = { ...next.look };

  // Teardown must come first: the material cache is shared by reference and
  // keyed on colour, so building the new world before releasing the old one
  // would leave the newcomer holding materials that teardown then disposes.
  disposeWorld(world, { scene });
  world = null;

  applySceneLayout(sceneId);
  world = makeWorld(sceneId);
  overlay.attach(world.manager);
  // The room is all new objects, so whatever the editor had selected is gone. The
  // layout is still a singleton in the config, but it now carries this scene's
  // arrangement rather than the last one's — see `applySceneLayout`.
  editor?.attach();
  // The new world brings its own source, which may not support the same pokes.
  syncSourceShortcuts();
  switcher.setActive(world.project);
  paintBadge();
  scenePanel?.setState({ ...lookState(), lights: lightsMode });
  updateWallClock();
  rememberActive(world.project.id);

  // A scene with no feeds has nothing to show and nothing to wait for, so ask
  // straight away rather than leaving an empty room with no explanation.
  if (!world.feeds.defs.length) openPicker();
  return world.project;
}

/**
 * Point the badge at the active scene's sources.
 *
 * Both halves are set from the feeds rather than from the scene record: the
 * record holds ids, some of which may no longer exist, and the feeds are what
 * actually got built and are actually reporting.
 */
function paintBadge() {
  const feeds = world?.feeds;
  badge.setSources(feeds?.defs ?? [], { clickable: true });
  badge.setStatus(feeds?.summary ?? { state: 'idle' }, feeds?.states ?? []);
}

/**
 * Ask which sources should fill the active scene.
 *
 * The choice is stored with the scene, so it is the office's — anyone else holding
 * the keycard will find the room fed the same way. `testDataPinned` comes back from
 * the picker rather than being inferred: it is the difference between the Test Data
 * a scene starts with and the Test Data someone asked for (see source-picker.js).
 */
function openPicker() {
  const scene = world?.project;
  if (!scene) return;

  sourcePicker.show({
    current: scene.sources,
    testDataPinned: scene.record?.testDataPinned ?? false,
    // The demo office is shared and authored, so the live sources are shown but not
    // offered, and the note says where they can be had instead.
    locked: reserved,
    onOpenOwnOffice: () => leaveForOwnOffice(),
    onPick: async (sourceIds, { testDataPinned } = {}) => {
      const updated = await setSceneSources(scene.id, sourceIds, { testDataPinned });
      switcher.setScenes(listScenes());
      applySources(sourceIds, updated);
    },
  });
}

/**
 * Point the room we are standing in at a new set of sources, without rebuilding it.
 *
 * This used to be `activateScene`, and the room paid for it: a rebuild throws away
 * the building, the furniture, the mail in flight and every character in the room,
 * so ticking a second harness on emptied the office to redecorate it and the agents
 * you were already watching came back — if they came back — behind a fresh feed and
 * a fresh reception. Nothing about a different set of feeds asks for a different
 * *room*.
 *
 * So the difference is moved instead, in the order a person would see it happen:
 * the feeds that went are stopped, their characters get up and walk out, and the
 * feeds that arrived are already running by the time the picker has closed.
 *
 * @param {string[]} sourceIds
 * @param {?object} [updated]  the scene record the office now holds, if it changed.
 *   `setSceneSources` replaces the record rather than editing it, so the world would
 *   otherwise go on holding a scene that names the sources it used to have — and the
 *   picker reads that on the way in.
 */
function applySources(sourceIds, updated = null) {
  if (!world) return;
  if (updated) world.project = updated;

  const { removed } = world.feeds.sync(sourceIds, { project: world.project });
  // Their feed has stopped, so nothing is driving them any more: left alone they
  // would stand at their desks forever, still wearing a mark the office no longer
  // subscribes to.
  world.manager.showOut(removed);

  // T and Y come and go with Test Data, and the badge with the whole set.
  syncSourceShortcuts();
  switcher.setActive(world.project);
  paintBadge();

  // Emptied rather than changed: same as opening a scene with nothing chosen, so
  // ask again rather than leaving a room that is about to be empty with no reason.
  if (!world.feeds.defs.length) openPicker();
}

/** "New scene": a fresh building and season, filled with test agents. */
async function createScene() {
  const scene = await addScene();
  if (!scene) return;
  switcher.setScenes(listScenes());
  activateScene(scene.id);
}

/**
 * Leave the demo office for one of your own.
 *
 * Offered wherever the demo office would otherwise invite an edit it cannot honour:
 * the switcher row, and the note in the source picker.
 *
 * A failure opens Your offices, where the retry button, error message and keycard
 * field are available without sending someone back around the demo entrance.
 */
async function leaveForOwnOffice() {
  try {
    await openNewOffice();
  } catch (err) {
    console.warn(`[office] could not cut a keycard: ${err.message}`);
    window.location.href = '/offices?create-failed=1';
  }
}

/**
 * Delete a scene, walking out of it first if it is the one we are standing in.
 *
 * The room has to be left before it is removed, because the world holds live feeds
 * and a scene record that would no longer exist. Which room to walk into is the
 * next one along, or the previous one if this was the last — the same thing a
 * person would do.
 */
async function deleteScene(id) {
  const list = listScenes();
  const at = list.findIndex((s) => s.id === id);
  const successor = list[at + 1] ?? list[at - 1] ?? null;
  const standingHere = world?.project?.id === id;

  if (standingHere && successor) activateScene(successor.id);

  const result = await removeScene(id);
  switcher.setScenes(listScenes());
  if (!result.ok) {
    // The refusal is a real answer — the last scene cannot go — so put us back
    // where we were rather than leaving the menu disagreeing with the room.
    if (standingHere && successor) activateScene(id);
    console.warn(`[office] scene not deleted: ${result.reason}`);
  }
}

/**
 * Name a scene, or clear the name and let its feeds name it again.
 *
 * The record is swapped rather than edited, exactly as a change of sources is
 * (`applySources`), so the world stops holding a scene that still answers to the old
 * name — the source picker's heading reads it, and so does the trash can's tooltip.
 *
 * @param {string} id
 * @param {string} name  empty means "back to the derived name"
 */
async function nameScene(id, name) {
  const updated = await renameScene(id, name);
  if (!updated) return;
  if (world?.project?.id === id) world.project = updated;
  switcher.setScenes(listScenes());
  switcher.setActive(world?.project);
}

/**
 * Redecorate the running office with a changed season or building, and keep it.
 *
 * The scene panel is how a scene's look gets chosen in practice, so the choice
 * is stored: an office is a set of rooms someone arranged, and a season that
 * reverted on reload would make the panel a toy. Authored scenes are exempt —
 * their look belongs to src/projects.js, and overwriting it would quietly redecorate
 * the demo office for everyone.
 */
function applyOverrides(next) {
  overrides = { ...overrides, ...next };
  changeAppearance(world, { scene, overrides, lightsLevel });
  scenePanel?.setState({ ...lookState(), lights: lightsMode });
  updateWallClock();
  saveLook(world.project);
}

/**
 * How long after the last nudge of the sun the look is written to the office.
 *
 * A bearing arrives from a slider, so a single turn of the room is a few dozen
 * values; the room follows every one of them and the office hears about the last.
 */
const LOOK_SAVE_DEBOUNCE_MS = 400;

/** @type {?ReturnType<typeof setTimeout>} */
let lookSaveTimer = null;

/**
 * Keep the look somebody chose, so the room comes back that way.
 *
 * Authored scenes are exempt — their look belongs to src/projects.js, and
 * overwriting it would quietly redecorate the demo office for everyone.
 *
 * The look is read *now* and written later, rather than read when the timer fires.
 * A drag reschedules this on every value, so the last one scheduled is the final
 * one either way — and a scene switched during those 400ms would otherwise have
 * this send the new room's season under the old room's id.
 */
function saveLook(scene) {
  if (scene.record?.authored) return;
  const id = scene.id;
  const look = {
    season: world.theme.season,
    building: world.theme.building,
    bearing: world.theme.bearing,
    lat: world.theme.lat,
    lon: world.theme.lon,
  };
  clearTimeout(lookSaveTimer);
  lookSaveTimer = setTimeout(() => {
    lookSaveTimer = null;
    setSceneLook(id, look)
      .then(() => switcher.setScenes(listScenes()))
      .catch(() => {});
  }, LOOK_SAVE_DEBOUNCE_MS);
}

/**
 * The current look, in the shape the scene panel paints.
 *
 * Assembled in one place because three callers want it and each used to spell it out
 * — which is how the bearing came to be missing from two of them.
 *
 * The day length rides along with the place: it is the most legible proof that a
 * latitude is doing something, and a winter afternoon ending at 15:48 is worth
 * saying out loud rather than leaving somebody to notice the room went dark early.
 */
function lookState() {
  const { season, building, bearing, lat, lon, sunTilt } = world.theme;
  const declination = declinationFor(sunTilt ?? 0, lat ?? 0);
  const place = Number.isFinite(lat)
    ? { lat, lon, declination, day: describeDay(lat, sunTilt) }
    : // Nowhere in particular still has a sky: the map shades its night side either
      // way, which is a good deal of what makes it worth pointing at in the first
      // place. With no hemisphere to go on it reads the season as a northern one.
      { lat: null, lon: null, declination, day: null };
  return { season, building, bearing, place };
}

/** "07:36–15:48" for a real day, or what the poles do instead. */
function describeDay(lat, sunTilt) {
  const { sunrise, sunset, polar } = dayLength(lat, declinationFor(sunTilt ?? 0, lat));
  if (polar === 'day') return 'midnight sun';
  if (polar === 'night') return 'polar night';
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  return `${hhmm(sunrise)}–${hhmm(sunset)}`;
}

/**
 * Put the office somewhere on earth, or take it off the map.
 *
 * Live and rebuild-free for the same reason as the bearing: a latitude changes the
 * angle of one light and nothing that gets built. Both coordinates travel together —
 * half a location is not a place — and both being null is a real answer, meaning the
 * room goes back to the authored arc rather than to the equator.
 */
function applyPlace(lat, lon) {
  const located = Number.isFinite(lat) && Number.isFinite(lon);
  // Crossing the equator turns the room to meet the sun.
  //
  // A northern noon sun is due south and a southern one is due north, so the same
  // room facing the same way is lit from the front on one side of the equator and
  // from behind on the other — pick Sydney at a bearing that worked for London and
  // the office goes dark, correctly and uselessly. Half a turn puts the midday sun
  // back where it was, and it is a *turn* rather than a reset: whatever bearing
  // somebody had chosen is carried across the equator with them.
  //
  // It fires on the crossing, not on the hemisphere, so dragging the pin around
  // inside one half does nothing and dragging it back turns the room back. Nowhere
  // in particular counts as northern, which is what the authored arc assumes.
  const turned = hemisphereOf(world?.theme?.lat) !== hemisphereOf(located ? lat : null);
  overrides = { ...overrides, lat: located ? lat : null, lon: located ? lon : null };
  if (world) {
    world.theme.lat = located ? lat : null;
    world.theme.lon = located ? lon : null;
    if (turned) world.theme.bearing = wrapBearing(world.theme.bearing + 180);
  }
  if (turned) overrides = { ...overrides, bearing: world.theme.bearing };
  if (turned) northCompass?.show();
  scenePanel.setState(lookState());
  saveLook(world.project);
}

/** An angle brought back into 0–359 whole degrees, whichever way round it arrived. */
function wrapBearing(deg) {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/**
 * Turn the room under the sky.
 *
 * Live, unlike season and building: the sun is read off the theme every frame
 * (scene/lighting.js), and not one thing that gets *built* depends on which way
 * the room faces — so writing the number onto the theme in hand is the whole
 * change, and rebuilding the world to deliver it would only make dragging the
 * slider feel like a stutter.
 */
function applyBearing(deg) {
  const bearing = wrapBearing(deg);
  overrides = { ...overrides, bearing };
  if (world) world.theme.bearing = bearing;
  northCompass?.show();
  scenePanel.setState(lookState());
  saveLook(world.project);
}

// --- The office ----------------------------------------------------------

// Everything below needs this office's scenes, and they live on the server: the
// keycard in the URL is the whole address, and an unused one becomes an office
// here. Top-level await rather than a callback because there is no useful screen
// to draw first — an office is its rooms, and we do not yet know what they are.
// A locked office is the one case where there is a screen to draw first: the prompt
// stands over the loading line and resolves with the office document once the passcode
// opens it, so everything below this await is unchanged by the existence of passcodes.
const office = await loadOffice({
  onLocked: () => {
    loading.textContent = '';
    return askForPasscode({ keycard, submit: (typed) => tryPasscode(typed) });
  },
});
if (!office) throw new Error('no office to open');   // loadOffice() has redirected

/**
 * Whether this is the reserved demo office (`TEST-0000`).
 *
 * The server says so rather than the browser comparing keycards, because which
 * office is reserved is the store's business — it is the one office never reaped and
 * the only one with authored scenes (lib/office-store.cjs).
 *
 * It is what a stranger sees first, and none of it is theirs: its scenes are authored,
 * its Test Data needs no adapter, and a live feed pointed here would be shared with
 * whoever else is looking. So the two controls that would repoint it — the switcher's
 * add row and the source picker — are not disabled and left to be puzzled over. They
 * turn into the offer of an office that *is* yours.
 *
 * The demo's starting scenes cannot be renamed or deleted. Furniture and scenery
 * experiments stay in this browser; each visit starts with a fresh building and season.
 */
const reserved = Boolean(office.reserved);

// The scene to open with: the one you were last in, else the office's first.
const startId = initialSceneId();
const startScene = getScene(startId);
if (startScene?.look) overrides = { ...startScene.look };
// Each demo visit gets its own look, without changing the shared starting rooms.
// The world clock starts unshifted, so the sun and wall clock follow this browser's time.
if (reserved) {
  overrides.building = BUILDING_LIST[Math.floor(Math.random() * BUILDING_LIST.length)];
  overrides.season = SEASON_LIST[Math.floor(Math.random() * SEASON_LIST.length)];
}

// Built against the first world, then re-pointed on each switch.
applySceneLayout(startId);
world = makeWorld(startId);

// Before the overlay, not with the other panels further down: attaching a manager
// reports "nothing selected" synchronously, so `selectionChanged` runs during
// createOverlay() — and anything it touches has to exist by then. (See the note on
// `badge` above for the same trap caught the hard way.)
// `ride` is assigned on the next line, so the HUD's × reads it at click time rather
// than closing over the null it holds now.
const fpvHud = createFpvHud({ onExit: () => ride?.exit() });
ride = createFpvRide({ fpvCamera, controls, fpvHud, getWorld: () => world });

const overlay = createOverlay(world.manager, {
  onSelect: (id) => selectionChanged(id),
  onFollowAlong: () => press('fpv'),
});

badge = createSourceBadge({ onClick: () => openPicker() });
sourcePicker = createSourcePicker();

const switcher = createSceneSwitcher({
  scenes: listScenes(),
  initialId: startId,
  onChange: (id) => {
    // A scene brings its own season and building with it; an authored one goes
    // back to its theme's defaults rather than inheriting the last scene's look.
    overrides = { season: null, building: null, bearing: null, lat: null, lon: null };
    activateScene(id);
  },
  // In the demo office the row is a way out rather than a way to add: see `reserved`.
  onCreate: () => (reserved ? leaveForOwnOffice() : createScene()),
  ...(reserved
    ? {
      createLabel: 'Open your own office',
      createNote: 'A fresh keycard, and rooms you can point at your own agents',
    }
    : {}),
  onDelete: reserved ? undefined : deleteScene,
  onRename: reserved ? undefined : nameScene,
});

/**
 * The office itself, behind the keycard: the link, the headcount, the passcode and the
 * way to close the room.
 *
 * All four in one dialog because all four answer one question — who can get in here —
 * and the keycard is what that question is about. Two of them need this office's write
 * token, which the browser that cut the keycard is holding (src/office/owner.js); the
 * dialog shows them disabled with a sentence rather than hiding them, because "why can
 * I not close this office?" is the question it exists to answer.
 *
 * Closing navigates to reception rather than staying in a room that no longer exists.
 * `/offices` is the right destination and not `/`: the front door redirects into the
 * demo office, and being dropped into somebody else's shared room immediately after
 * deliberately shutting your own reads as a failure.
 */
const keycardDialog = createKeycardDialog({
  keycard,
  isOwner,
  onPasscode: async (passcode) => {
    const result = await setPasscode(passcode);
    // The padlock beside the keycard is the one part of this that lives outside the
    // dialog, so it is told here rather than left to the next heartbeat — half a
    // minute of a locked office showing no lock is half a minute of wondering whether
    // the thing you just did took.
    if (result.ok) keycardChip.setOffice(officeInfo());
    return result;
  },
  onClose: async () => {
    const result = await closeOffice();
    if (result.ok) window.location.href = '/offices?closed=1';
    return result;
  },
  /**
   * Cut another office from inside this one.
   *
   * `openNewOffice` and nothing else: it is the one mint path, shared with reception and
   * with the demo office's switcher row, and it is what keeps the new office's write
   * token — so an office cut from here is owned exactly as one cut at reception is. A
   * second mint written beside it would be a second chance to forget that, which is the
   * whole defect this change exists to fix.
   *
   * No seed, because a new office rolls its own room.
   *
   * The failure is reported into the dialog rather than by navigating to reception with
   * `?create-failed=1`, which is what `leaveForOwnOffice` does. The difference is where
   * the person is standing: leaving the demo office is already a navigation, so failing
   * into reception lands them somewhere with a retry button, while somebody who opened
   * this dialog from their own room has not asked to leave it and should be told in
   * place. The server is the only thing that can mint a keycard, so there is no offline
   * fallback and a refusal has to say so rather than appear to have worked.
   */
  onOpenAnother: async () => {
    try {
      await openNewOffice();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: `Could not open an office: ${err.message}` };
    }
  },
});

// The keycard, shown because it is the only way back into this office; a live dot when
// the machine's adapters are posting here, and a padlock when it asks for a passcode.
const keycardChip = createKeycardChip({
  keycard,
  onOpen: () => keycardDialog.show(officeInfo()),
});
keycardChip.setOffice(office);

// Two things at once, and both are about the office rather than the room: hold the
// presence stream open so the office is not reaped while someone is watching it,
// and take the local adapter feed if any scene here wants live agents.
watchOffice({
  onOffice: (info) => {
    keycardChip.setOffice(info);
    // The headcount is the one thing in the dialog that moves while nobody touches it,
    // so an open dialog is repainted by the beat that changed it.
    keycardDialog.setOffice(info);
  },
  onLost: () => officeLost(),
});
claimLocalEndpoint().then(() => keycardChip.setOffice(officeInfo()));

/**
 * Somebody rearranged a room. Move the furniture if it is the one on screen.
 *
 * Only the layout is applied live from other tabs. Their choice of season or
 * building stays on the record until this scene is next opened; local appearance
 * controls redecorate immediately, preserving the running agents and feeds.
 *
 * The furniture is the exception because it is the one thing the room was built to
 * change while it is running: `adopt` is the same path an edit of your own takes, and
 * the paths re-route around the newcomer exactly as they do in the editor.
 *
 * A colleague's change of *sources* could join it now that `applySources` no longer
 * rebuilds anything, and probably should — it is deliberately left out here
 * because the question was asked about the picker in your own hands, and a room that
 * re-crews itself because somebody else opened a menu is a bigger decision than a
 * desk moving.
 */
watchScenes({
  onScene: (scene) => {
    if (scene.id !== world?.project?.id) return;
    editor?.adopt(scene.record.layout ?? null);
    switcher.setScenes(listScenes());
  },
});

/**
 * The office was deleted while we were standing in it.
 *
 * Only reachable in the odd cases — a server restart that outlived its store, or a
 * tab woken from sleep with its presence stream long dead. Reloading would silently
 * make a brand-new empty office at the same keycard, so it says what happened and
 * leaves the choice to the person who might still have the scenes on screen.
 */
let lost = false;
function officeLost() {
  if (lost) return;
  lost = true;
  loading.textContent = 'This office was deleted — nobody was watching it, and no agents arrived. ';
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'loading-action';
  again.textContent = 'Open it again';
  again.addEventListener('click', () => window.location.reload());
  loading.appendChild(again);
  loading.classList.remove('done');
}

// The first world was built before the badge existed, so its feeds reported into
// nothing. paintBadge() reads their current state rather than waiting for the next
// change, which is what makes a Test Data office — live before `start()` is even
// called — come up saying so.
paintBadge();
// A freshly minted keycard opens setup once. Remove only the setup flag so a
// refresh or shared link opens the office normally, preserving seed/host options.
const entryUrl = new URL(window.location.href);
const setupSources = entryUrl.searchParams.get('setup') === 'sources';
if (setupSources) {
  entryUrl.searchParams.delete('setup');
  window.history.replaceState(window.history.state, '', entryUrl);
}
if ((!reserved && setupSources) || !world.feeds.defs.length) openPicker();

// --- Shortcuts and the bottom panels ---------------------------------------

const shortcutsPanel = createShortcutsPanel();

northCompass = createNorthCompass({
  controls,
  getBearing: () => world?.theme?.bearing ?? 0,
  host: document.getElementById('ui'),
  // Both of the panels that reach the bottom-right corner the compass rests in: the
  // strips along the bottom, and the agent inspector moored to the right edge. Which
  // way it steps out of each is the compass's own business.
  clearOf: [document.getElementById('bottom-stack'), document.getElementById('inspector')],
});

// Two strips where there was one. The scene panel dresses the room — time, lights,
// season, building — and the developer panel holds the instruments you reach for when
// a frame looks wrong. They were one panel for as long as there were few enough
// controls not to notice they had different audiences.
const scenePanel = createScenePanel({
  onSeason: (season) => applyOverrides({ season }),
  onBuilding: (building) => applyOverrides({ building }),
  onLights: (mode) => setLights(mode),
  getAutomaticLights: () => automaticLightLevel > 0,
  onBearing: (deg) => applyBearing(deg),
  onPlace: (lat, lon) => applyPlace(lat, lon),
});
scenePanel.setState({ ...lookState(), lights: lightsMode });

const devPanel = createDevPanel({
  camera,
  controls,
  onPhoto: () => copySceneToClipboard({ renderer, scene, camera: activeCamera }),
});

// After the strips, not before them, and that ordering is the whole point: the hint
// declines to appear when a panel is already on screen, and the two strips decide
// whether they are on screen inside their own constructors above. Asked any earlier it
// would be reading the markup's opening state and would greet a reload into a
// remembered-open Scene panel with an invitation printed across it.
if (reserved) createWelcomeHint();

/** Set the lighting override. The render loop picks it up on the next frame. */
function setLights(mode) {
  lightsMode = mode;
  scenePanel.setState({ ...lookState(), lights: lightsMode });
}

register({
  id: 'scene-panel',
  keys: ['S'],
  label: 'Show/hide {SCENE} panel',
  group: 'Scene',
  order: 2,
  onPress: () => scenePanel.toggle(),
});

// Moving the camera about, which OrbitControls dispatches for itself — so these are
// description-only rows, like the editor's drag.
//
// They were the one part of the app nothing had ever written down: discoverable by
// flailing at the mouse, which most people do get to eventually, and which is exactly
// the kind of thing a panel headed "Shortcuts" exists to save them from.
registerGesture({
  id: 'camera-zoom',
  keys: ['Scroll wheel'],
  label: 'Zoom scene in / out',
  group: 'Scene',
  order: 4,
});
registerGesture({
  id: 'camera-rotate',
  keys: ['Drag'],
  label: 'Rotate scene',
  group: 'Scene',
  order: 5,
});
registerGesture({
  id: 'camera-pan',
  keys: ['Ctrl', 'Drag'],
  label: 'Move scene',
  group: 'Scene',
  order: 6,
});

// Bound but not listed: the panel prints `?` beside its own title, which teaches the key
// at the moment it is useful and without spending a row of the list saying how to open
// the list you are already reading.
register({
  id: 'help',
  keys: ['?'],
  label: 'Show/hide {SHORTCUTS} panel',
  group: 'Scene',
  order: 3,
  hidden: true,
  onPress: () => shortcutsPanel.toggle(),
});

register({
  id: 'dev',
  keys: ['V'],
  label: 'Show/hide {DEVELOPER} panel',
  group: 'Developer',
  order: 0,
  onPress: () => devPanel.toggle(),
});

// The event log is a page, not a panel, so this navigates rather than toggling. It is
// the same destination as the developer panel's link, offered as a key because the
// panel you would open to find the link is the one thing you cannot read when the
// question is "did anything arrive at all".
register({
  id: 'logs',
  keys: ['G'],
  label: 'Show activity logs',
  group: 'Developer',
  order: 1,
  onPress: () => {
    const at = officePath(window.location?.pathname ?? '');
    if (at) window.location.href = `/office/${at.keycard}/debuglog`;
  },
});

// A bare `C`, not `⌘C`. The registry can express the command key — that is what made
// `⌘C` bindable in the first place — but taking the browser's copy away and then handing
// it back through a special case was a lot of machinery for a room with no text in it.
register({
  id: 'photo',
  keys: ['C'],
  label: 'Copy a photo of the scene to the clipboard',
  group: 'Developer',
  order: 2,
  onPress: () => devPanel.takePhoto(),
});

// --- The furniture editor --------------------------------------------------
// Built once and kept, like the panels: the layout it edits is a singleton in the
// config, so it outlives any one world and there is nothing to rebuild on a switch
// beyond dropping the selection (see `attach`).
editor = createEditor({
  canvas,
  camera,
  controls,
  scene,
  getWorld: () => world,
});

register({
  id: 'edit',
  keys: ['E'],
  label: 'Turn on/off {EDIT} mode',
  group: 'Edit Mode',
  order: 0,
  onPress: () => {
    // Not available from inside somebody's head. Dragging furniture is done by pointing
    // at the floor from above, and a perspective lens at eye level cannot see the floor
    // it would need to point at — so entering edit mode steps out of the ride first.
    if (!editor.isOpen && ride.id) ride.exit();
    editor.toggle();
  },
});

register({
  id: 'edit-paths',
  keys: ['P'],
  label: 'Show / hide agent paths',
  group: 'Edit Mode',
  order: 1,
  onPress: () => editor.togglePaths(),
});

// Documentation-only, because the editor dispatches these itself: they are modal, and
// binding them here would leave dead entries in the help panel every time edit mode was
// closed. Registered so `?` still lists them.
//
// `⌘Z` used to be here because the registry could not express a modifier at all. It can
// now, so this is a choice about where undo lives rather than a limitation — and undo
// belongs with the stack it pops.
//
// Their labels used to open with "While editing:", which the `Edit Mode` heading now says
// once for all of them. A precondition belongs in the section it applies to, not repeated
// down every row of it.
registerGesture({
  id: 'edit-select',
  keys: ['Click'],
  label: 'Select item',
  group: 'Edit Mode',
  order: 2,
});
// One row for three keys that all act on the selected prop. They are alternatives rather
// than a chord, so the slash separator; which of the three does what is carried by the
// label reading in the same order as the keys.
registerGesture({
  id: 'edit-turn',
  keys: ['[', ']', 'Del'],
  sep: '/',
  label: 'Rotate / delete selected item',
  group: 'Edit Mode',
  order: 4,
});
// The four arrows as one cap rather than four, because they are one gesture with four
// directions rather than four things to learn — and because the registry joins a list of
// keys with `+`, which would read as a chord you have to hold all of at once.
registerGesture({
  id: 'edit-nudge',
  keys: ['←→↑↓'],
  label: 'Nudge selected item by one snap',
  group: 'Edit Mode',
  order: 5,
});
registerGesture({
  id: 'edit-duplicate',
  keys: ['⌘', 'D'],
  label: 'Duplicate selected item',
  group: 'Edit Mode',
  order: 6,
});
registerGesture({
  id: 'edit-undo',
  keys: ['⌘', 'Z'],
  label: 'Undo last movement',
  group: 'Edit Mode',
  order: 7,
});
registerGesture({
  id: 'edit-drag',
  keys: ['Drag'],
  label: 'Move furniture & props (+ `Opt` ignores grid)',
  group: 'Edit Mode',
  order: 3,
});

// The roster is plain markup filled in by the overlay, with nothing else interested in
// whether it is on screen, so a class is the whole implementation — and the class is
// what the memory is applied to and read back off. Unlike the strips it ships *open*,
// which is the fallback for a browser with nothing stored.
const ROSTER = 'agent-panel';
const roster = document.getElementById(ROSTER);
roster?.classList.toggle('hidden', !recallPanel(ROSTER, true));

register({
  id: 'roster',
  keys: ['A'],
  label: 'Show/hide {AGENTS} panel',
  group: 'Agents',
  order: 2,
  onPress: () => {
    // It covers the near corner of the room — which, at this camera angle, is the
    // corner you are usually looking at — so putting it away is a decision worth
    // keeping across a reload. See src/ui/panel-state.js.
    if (!roster) return;
    rememberPanel(ROSTER, !roster.classList.toggle('hidden'));
  },
});

// The roster's × fires that binding rather than repeating it, so the class above stays
// the one implementation of showing and hiding the roster.
document.getElementById('agent-panel-close')
  ?.addEventListener('click', () => press('roster'));

register({
  id: 'lights',
  keys: ['L'],
  label: 'Turn lights on / off / time of day (automatic)',
  group: 'Scene',
  order: 1,
  onPress: () => {
    // Cycles through LIGHT_MODES in declaration order, so adding a mode there is
    // enough — this does not need to know what the modes are.
    const modes = Object.keys(LIGHT_MODES);
    setLights(modes[(modes.indexOf(lightsMode) + 1) % modes.length]);
  },
});

/**
 * Offer `T` only while something in this office can actually invent work.
 *
 * Which is to say: only the Test Data source. The capability is feature-detected
 * (`sendJob`) rather than tested against `MockSource` or `kind === 'mock'`, so a
 * harness feed could opt in later if injecting a job ever became meaningful for
 * it, and no source is obliged to. Fabricating work on a live AOP feed would be a
 * lie about what the agents are doing, so those sources don't implement it and the
 * key doesn't exist unless something alongside them can.
 *
 * Re-run on every world build and after every change of sources, which between them
 * cover both ways the answer can change: walking into another office, and ticking
 * Test Data on or off in this one. Because the help panel renders from the registry,
 * un-registering is also what stops `?` advertising a key that would do nothing.
 * @type {?function}
 */
let releaseSendJob = null;
let releaseSendRound = null;
function syncSourceShortcuts() {
  releaseSendJob?.();
  releaseSendRound?.();
  releaseSendJob = null;
  releaseSendRound = null;
  // A blank office waiting on the picker has no feeds at all.
  if (!world?.feeds?.canSendJob) return;
  // Work that comes with a checklist, on demand. The scheduled stream sends one about
  // a quarter of the time, which is the right frequency to watch a room at and the
  // wrong one to check a panel against — hence a key that asks for one.
  if (world.feeds.canSendRound) {
    releaseSendRound = register({
      id: 'send-round',
      keys: ['Y'],
      label: 'Post a job that comes with a checklist (only with Test datasource)',
      group: 'Developer',
      order: 4,
      onPress: () => world.feeds.sendRound(),
    });
  }
  releaseSendJob = register({
    id: 'send-job',
    keys: ['T'],
    // Not "airmail" any more: which way it comes depends on how big the work is, so
    // roughly three presses in four flies in and the fourth arrives at the door.
    label: 'Post a new job (randomized letter or package — only with Test datasource)',
    group: 'Developer',
    order: 3,
    // Read off `world` at press time, not capture: the world is rebuilt whenever
    // the office or its sources change, and the feeds go with it.
    onPress: () => world.feeds.sendJob(),
  });
}
syncSourceShortcuts();

register({
  id: 'source',
  keys: ['D'],
  label: 'Select Datasources for this scene',
  group: 'Scene',
  order: 0,
  onPress: () => openPicker(),
});

// Bound but not listed. Escape closing whatever is in front of you is a convention
// older than this app, and a panel that spends a row explaining it is spending
// attention to say something the reader already knew. `hidden` is for exactly this
// case — reflexes — and not a licence to leave a real shortcut undocumented.
register({
  id: 'dismiss',
  keys: ['Esc'],
  label: 'Close the open panel, or clear the selected agent',
  group: 'Agents',
  order: 3,
  hidden: true,
  onPress: () => {
    // Most-recent-first: dismiss what is in the way before touching selection.
    // The picker handles its own Escape (it has to know whether the choice was
    // abandoned), so it is not listed here.
    if (shortcutsPanel.isOpen) return shortcutsPanel.hide();
    // Edit mode before the strips: it is the one that has changed what the mouse
    // does, so it is the more likely thing meant by "stop that".
    if (editor?.isOpen) return editor.exit();
    // Developer before scene, on the same reasoning one step down: the developer panel
    // is the more transient of the two, opened to answer a question and closed again,
    // where the scene panel is left up while dressing a room.
    if (devPanel.isOpen) return devPanel.hide();
    if (scenePanel.isOpen) return scenePanel.hide();
    // Stepping out of a head comes before dropping the selection: it is the
    // larger change to what you are looking at, and the more likely thing meant
    // by "get me out of this".
    if (ride.id) return ride.exit();
    overlay.setSelected(null);
  },
});

// Mouse gestures are documented next to nothing that can dispatch them, so they
// register as description-only rows.
//
// Clicking empty space to deselect is not one of them, though it still works. Two
// rows reading `Click` in the same group asked the reader to tell them apart, to
// learn something every selection they have ever made already taught them.
registerGesture({
  id: 'select-agent',
  keys: ['Click'],
  label: 'Select an agent',
  group: 'Agents',
  order: 0,
});

// --- Riding an agent (src/fpv.js) ------------------------------------------
// The selection is what the ride follows, so the two are kept in step here —
// the render loop only asks the ride to aim.

// Discoverable in Help before selection; Follow Along offers the same action in the inspector.
register({
  id: 'fpv',
  keys: ['F'],
  label: 'First person view of the selected agent',
  group: 'Agents',
  order: 1,
  onPress: () => (ride.id ? ride.exit() : (selectedId != null && ride.enter(selectedId))),
});

/**
 * A new selection (or none), from the roster, a click in the scene, or Escape.
 *
 * While riding, picking a different agent moves the ride rather than dropping it:
 * having got down to floor level, the interesting next question is what the person
 * across the desk can see, and making you press `f` twice to ask it is friction for
 * its own sake. Clearing the selection ends the ride, because there is then nobody
 * whose eyes these could be.
 */
function selectionChanged(id) {
  selectedId = id;
  highlightSelected();
  if (!ride.id) return;
  if (id == null) ride.exit();
  else if (id !== ride.id) ride.enter(id);
}

function highlightSelected() {
  if (!world) return;
  for (const { agent } of world.manager.agents.values()) {
    const on = agent.id === selectedId;
    agent.statusRing.material.emissiveIntensity = on ? 1.4 : 0.6;
    agent.statusRing.scale.setScalar(on ? 1.25 : 1.0);
  }
}

// Click-to-select via raycasting.
let downXY = null;
canvas.addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  // Edit mode owns the pointer: a click there picks up furniture, and selecting the
  // agent standing behind the desk you just grabbed is not what was meant. Checked
  // rather than intercepted, because both handlers are on the canvas and stopping
  // propagation between listeners on one element takes a bigger hammer than this
  // deserves.
  if (editor?.isOpen) return;
  // Ignore drags (orbit/pan) — only treat as click if the pointer barely moved.
  if (!downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
  downXY = null;
  if (moved > 6) return;

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  // Cast from whichever lens drew the frame, so clicking an agent seen from inside
  // another one's head selects who you actually pointed at.
  raycaster.setFromCamera(pointer, activeCamera());
  const roots = [...world.manager.agents.values()].map((r) => r.agent.root);
  const hits = raycaster.intersectObjects(roots, true);
  if (hits.length) {
    overlay.setSelected(world.manager.agentIdFromObject(hits[0].object));
  } else {
    overlay.setSelected(null);
  }
});

// The clock is the LED panel on the beige wall above the coffee machine. Poll
// twice a second so the blinking colon lands on the second boundary; the panel
// only repaints its canvas when the readout actually changes.
function updateWallClock() { world?.props.wallClock?.setTime(worldClock.now()); }
updateWallClock();
setInterval(updateWallClock, 500);

/*
 * Keep the room the right size while nobody is looking at it.
 *
 * A timer, deliberately, and this is the one place in the app where that is the
 * point: `requestAnimationFrame` stops for a tab in the background while a
 * `setInterval` goes on keeping its appointments — which is exactly the pair of
 * facts that filled an office overnight. The feeds run on timers too,
 * so they went on retiring sessions and telling the room to show them out, and
 * the room never drew a frame in which anybody could take a step.
 *
 * `tidy` does nothing at all while frames are being drawn: a room being looked at
 * shows people out through the door, and beams up whoever cannot manage it. This
 * is only for the hours when there is nothing to watch.
 */
setInterval(() => world?.manager.tidy(), 15_000);

window.addEventListener('resize', () => {
  const aspect = window.innerWidth / window.innerHeight;
  updateCameraAspect(camera, aspect);
  // Both lenses, always: resizing while riding must fix the view you are in, and
  // resizing while outside must not leave a stale aspect waiting for the next `f`.
  updateFirstPersonAspect(fpvCamera, aspect);
  renderer.setSize(window.innerWidth, window.innerHeight);

  /* Re-frame if a host asked for a frame mode.
   *
   * `updateCameraAspect` above fixes the frustum, which is the horizontal extent,
   * and leaves `zoom` alone. That is right for a hand-set camera and wrong for a
   * computed one: `frame` derives its zoom from the aspect, so without this the
   * zoom keeps a value computed for the old viewport and the framing drifts on
   * every resize. Caught in review of this change.
   *
   * Nothing happens unless a host set a mode, so the standalone office resizes
   * exactly as it did before. A hand zoom made after the last resize survives
   * until the next one, which is the trade a standing instruction implies. */
  frameControl.refresh();
  // After the frame mode, because it may have changed the zoom this reads.
  refreshTagLegibility();
});

const timer = new THREE.Timer();
window.__dbg = { get world(){return world} };

function animate(timestamp) {
  requestAnimationFrame(animate);
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.05);
  if (world) {
    world.manager.update(dt);
    // Each desk runs the board on its second screen — and only while it is being
    // worked at, so this is one cheap early return per desk in an empty room.
    for (const desk of world.props.desks) desk.update(dt);
    world.props.mailbox?.update(dt);
    // Every printer, because the ready light and the touchscreen are per machine and
    // `props.printer` is only ever the last one built. By station, which is the index
    // that stays correct when a kind has more than one (see scene/props.js).
    for (const s of stationsOfKind('printer')) world.props.byStation[s.id]?.update?.(dt);
    // One globe per bookshelf, and a room may have more than one shelf. Each spins
    // down on its own after whoever turned it walks away.
    for (const shelf of world.props.bookshelves) shelf.globe?.update(dt);
    // And one tube per telescope, sweeping while somebody has an eye to it and
    // easing back to its resting pitch once they walk away.
    for (const t of world.props.telescopes ?? []) t.scope?.update(dt);
    world.props.door?.update(dt);
    world.mail.update(dt);
    world.birds.update(dt);
    world.deliveries.update(dt);
    highlightSelected();
    // Cheap: a handful of uniform writes. Doing it per frame is what makes
    // scrubbing the clock feel continuous rather than stepped.
    const sun = applyTimeOfDay(world.lights, worldClock.hours(), world.theme, scene);
    // The street lamps and ceiling fittings ride the same clock, so dusk brings
    // them up as the sun goes down — unless the scene panel is overriding it.
    automaticLightLevel = sun.lampOn;
    applyNightLights(world.props.nightLights, lightsLevel(automaticLightLevel));
  }
  scenePanel.update(dt);
  devPanel.update(dt);
  // After manager.update(), so the route ribbons are drawn from where people have just
  // got to rather than trailing them by a frame. A no-op unless edit mode is open.
  editor?.tick();
  // Aiming happens after manager.update() and before the render, so the eye is at
  // this frame's head position rather than trailing it by one.
  ride.track(dt);
  if (!ride.id) {
    // Damping and pan clamping only mean anything for the lens they belong to;
    // running them while riding would have the office view drifting unseen.
    controls.update();
    clampPan(camera, controls);
  }
  renderer.render(scene, activeCamera());
}

animate();

// Hide loading overlay once the first frame is drawn.
requestAnimationFrame(() => loading.classList.add('done'));

/**
 * Point the camera at the room the way `frame` asked for.
 *
 * The arithmetic is in src/scene/framing.js and is unit tested; everything here
 * is the three.js half: project the room, ask for a zoom, and move the target so
 * the vertical placement lands where framing.js said it should.
 *
 * The target has to move with the camera, not instead of it. Setting the orbit
 * target alone shears the view direction and starts a fight with the clamped
 * orbit limits, so the same delta is applied to both.
 */
/**
 * Keep the name tags legible for the viewport they are being shown in.
 *
 * The tags are sprites sized in world units, so their pixel size follows the
 * viewport instead of compensating for it: the tag that is 36px tall on a full
 * screen is 15px in a 425px embed, which leaves the name itself at about 5px.
 * This corrects for that, so a tag is roughly the same size on screen whatever
 * the office is shown in.
 *
 * Called on resize and after any zoom change, because both move the answer.
 */
function refreshTagLegibility() {
  const scale = tagLegibilityFor({
    viewportHeight: window.innerHeight,
    zoom: camera.zoom,
    frustum: CAMERA.frustum,
  });
  if (scale === null) return;
  setTagLegibility(scale);
  world?.manager?.resizeTags();
}

// User gestures persist through OrbitControls' change event. The app also moves
// the lens directly for host zoom and frame modes, and OrbitControls cannot see
// an externally assigned orthographic zoom; finish those paths in one place so
// they update the controls, persistence and tag scale together.
function commitCameraView() {
  controls.update();
  saveCameraView(camera, controls);
  refreshTagLegibility();
}

function applyFrameMode(mode) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!w || !h) return;

  camera.updateMatrixWorld();
  const box = roomScreenBox({
    elements: camera.matrixWorldInverse.elements,
    room: ROOM,
    // A little air above the wall tops, and no more. It is tempting to reserve
    // the height of a name tag here, but tags float over people's heads at
    // roughly y=4 and the walls are 8 units tall, so they are already well
    // inside the box. Reserving 3.4 for them cost 3 points of width fill at
    // full screen for nothing.
    headroom: 1,
  });
  if (!box) return;

  const zoom = zoomForFrame({
    mode,
    aspect: w / h,
    frustum: CAMERA.frustum,
    halfW: box.halfW,
    halfH: box.halfH,
    minZoom: CAMERA.minZoom,
    maxZoom: CAMERA.maxZoom,
  });
  if (zoom === null) return;

  camera.zoom = zoom;
  camera.updateProjectionMatrix();

  const wantY = verticalCentre({
    frustum: CAMERA.frustum,
    zoom,
    boxTop: box.top,
    boxBottom: box.bottom,
  });

  // Screen-space corrections, turned back into world movement along the camera's
  // own right and up axes. Doing it this way means the maths above never has to
  // know the camera's angle.
  const e = camera.matrixWorld.elements;
  const right = { x: e[0], y: e[1], z: e[2] };
  const up = { x: e[4], y: e[5], z: e[6] };

  const inCamera = camera.matrixWorldInverse.elements;
  const t = controls.target;
  const targetY =
    inCamera[1] * t.x + inCamera[5] * t.y + inCamera[9] * t.z + inCamera[13];
  const targetX =
    inCamera[0] * t.x + inCamera[4] * t.y + inCamera[8] * t.z + inCamera[12];

  const dY = wantY - targetY;
  const dX = box.centreX - targetX;

  const move = {
    x: right.x * dX + up.x * dY,
    y: right.y * dX + up.y * dY,
    z: right.z * dX + up.z * dY,
  };

  t.set(t.x + move.x, t.y + move.y, t.z + move.z);
  camera.position.set(
    camera.position.x + move.x,
    camera.position.y + move.y,
    camera.position.z + move.z,
  );
  commitCameraView();
}

/* The embedder's control surface (src/host.js).
 *
 * Started after the first frame so that everything it can reach already exists,
 * and so a `chrome` or `zoom` that came in on the URL is applied to a built scene
 * rather than a half-built one. The URL half still lands before anybody sees the
 * room, because the overlay above is only just clearing.
 *
 * Each knob forwards to the path the office's own UI already uses, so an embedder
 * and a person clicking the Look menu go through the same code. */
startHostApi({
  apply: {
    chrome: (level) => {
      // A data attribute, not display:none from here: styles.css owns what each
      // level hides, so the levels can change without this file knowing.
      document.body.dataset.chrome = level;
    },
    zoom: (zoom) => {
      camera.zoom = Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, zoom));
      camera.updateProjectionMatrix();
      commitCameraView();
    },
    frame: (mode) => frameControl.set(mode),
    look: (look) => applyOverrides(look),
  },
});

/**
 * `?edit=1` opens edit mode on load.
 *
 * There for people, and for the camera. A headless screenshot fires its shutter at load
 * and has no way to press a key, so a mode reachable only by keyboard is a mode no
 * screenshot can ever show — see the note on checking the work in AGENTS.md. This is the
 * only way to photograph the gizmos and the panel.
 */
if (new URLSearchParams(window.location.search).get('edit') === '1') editor.enter();
