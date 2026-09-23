// A world's scenery can change while its people, furniture and feeds keep running.
import * as THREE from 'three';
import { applyPalette } from './config.js';
import { resolveTheme } from './projects.js';
import { getScene, listScenes } from './office/office.js';
import { addLighting, applyTimeOfDay } from './scene/lighting.js';
import { applyNightLights, releaseNightLightAssets } from './scene/night-lights.js';
import { buildEnvironment } from './scene/environment.js';
import { buildProps } from './scene/props.js';
import { MailFlights } from './scene/mail.js';
import { BirdFlights } from './scene/birds.js';
import { CourierDeliveries } from './scene/courier.js';
import { disposeSubtree, clearMaterialCache } from './scene/build.js';
import { AgentManager } from './agents/AgentManager.js';
import { createFeeds } from './data/feeds.js';
import { worldClock } from './time.js';

/** The disposable shell, outlook and lighting, separate from the running office. */
function buildScenery(root, theme, { scene, lightsLevel }) {
  scene.background = new THREE.Color(theme.sky);
  const scenery = new THREE.Group();
  root.add(scenery);
  const lights = addLighting(scenery, theme.light);
  const sun = applyTimeOfDay(lights, worldClock.hours(), theme, scene);
  const environment = buildEnvironment(scenery, theme);
  applyNightLights(environment.nightLights, lightsLevel(sun.lampOn));
  return { scenery, lights, environment };
}

/** Build a complete world for a scene and start its feeds once. */
export function buildWorld(sceneId, { scene, overrides, lightsLevel, onFeedStatus }) {
  const project = getScene(sceneId) ?? listScenes()[0];
  const theme = resolveTheme(project, overrides);
  applyPalette(theme.palette);
  clearMaterialCache();
  const root = new THREE.Group();
  scene.add(root);
  const scenery = buildScenery(root, theme, { scene, lightsLevel });
  const propHandles = buildProps(root, theme);

  // Stable lookups also follow furniture moved or added by the editor.
  const boxAt = (id) => propHandles.byStation[id] ?? propHandles.mailbox ?? null;
  const mail = new MailFlights(root, boxAt);
  // The letter channel's other vehicle: sometimes the window admits a bird
  // instead of a plane (the roster by day, the owl by night — scene/birds.js).
  const birds = new BirdFlights(root, boxAt);
  const deliveries = new CourierDeliveries(root, { boxAt, ...scenery.environment });
  const props = { ...propHandles, ...scenery.environment, mail, birds, deliveries };
  const manager = new AgentManager(root, props);
  const feeds = createFeeds(project.sources, { project, manager, onStatus: onFeedStatus });
  feeds.start((ev, def) => manager.handleEvent(ev, def));
  return { project, theme, root, props, mail, birds, deliveries, manager, feeds, ...scenery };
}

/**
 * Change a building or season in place. No feed stop/start, replay, new manager or
 * layout reset: controllers, jobs, desk reservations and UI subscriptions survive.
 */
export function changeAppearance(w, { scene, overrides, lightsLevel }) {
  const theme = resolveTheme(w.project, overrides);
  const previous = w.environment;
  const old = w.scenery;
  w.root.remove(old);
  applyPalette(theme.palette);
  w.props.retheme(theme);
  // Props and people can share cached materials with the shell. Their resources
  // must outlive the discarded scenery. Keep their cache entries too, so a later
  // upholstery repaint can release the materials it no longer uses.
  disposeSubtree(old, { keep: w.root });
  clearMaterialCache({ keep: w.root });
  releaseNightLightAssets();
  const next = buildScenery(w.root, theme, { scene, lightsLevel });
  inheritEntranceState(previous, next.environment);
  for (const key of Object.keys(previous)) delete w.props[key];
  Object.assign(w.props, next.environment);
  Object.assign(w, next, { theme });
  w.manager.redecorate(previous);
  w.deliveries.redecorate(next.environment, previous);
  w.mail.relocate();
  // Both vehicles come in through the window, so both need re-aiming when the
  // window moves with the building.
  w.birds.relocate();
  return w;
}

/** A season must not reset an occupied lift or slam a moving door shut. */
function inheritEntranceState(previous, next) {
  if (previous.elevator && next.elevator) {
    for (const key of ['state', 'carY', 'targetY', 'doorT', '_hold', '_dwell']) {
      next.elevator[key] = previous.elevator[key];
    }
    next.elevator.update(0);
  } else if (previous.door?.pivot && next.door?.pivot) {
    next.door._hold = previous.door._hold;
    next.door.pivot.rotation.y = previous.door.pivot.rotation.y;
  }
}

/** Stop a world's feeds and release everything it allocated. */
export function disposeWorld(w, { scene }) {
  if (!w) return;
  w.feeds?.stop();
  scene.remove(w.root);
  disposeSubtree(w.root);
  clearMaterialCache();
  releaseNightLightAssets();
}
