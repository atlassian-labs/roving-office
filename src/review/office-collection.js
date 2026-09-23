import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyPalette } from '../config.js';
import { resolveTheme, BUILDINGS, BUILDING_ORDER } from '../projects.js';
import { buildEnvironment } from '../scene/environment.js';
import { buildProps } from '../scene/props.js';
import { addLighting, applyTimeOfDay, createReflectionEnvironment } from '../scene/lighting.js';
import { applyNightLights, releaseNightLightAssets } from '../scene/night-lights.js';
import { disposeSubtree, clearMaterialCache } from '../scene/build.js';
import { createRenderer } from '../scene/renderer.js';
import { seeded } from '../scene/outlooks/streetscape.js';

const DESCRIPTIONS = {
  tide: { description: 'Pale ash, ink-blue steel and a wide harbour horizon.', swatches: ['#d8cfb9', '#263e50', '#92bdc5', '#bc755e'] },
  dune: { description: 'Sculpted earth, terracotta and deep courtyard shade.', swatches: ['#e4c9a3', '#ad583c', '#aa8a53', '#707b54'] },
  lantern: { description: 'Dark timber, soft paper light and a carefully framed garden.', swatches: ['#302e28', '#e4dbc1', '#64734f', '#6f464a'] },
};
const VIEWS = {
  room: { eye: [43, 31, 43], target: [11.5, 3.5, 8] },
  close: { eye: [27, 13.5, 25], target: [7, 4.5, 7] },
  garden: { eye: [65, 48, 70], target: [10, 2, 8] },
};
const params = new URLSearchParams(location.search);
let building = Object.hasOwn(DESCRIPTIONS, params.get('building')) ? params.get('building') : 'tide';
let season = ['summer', 'autumn', 'winter', 'spring'].includes(params.get('season')) ? params.get('season') : 'summer';
let hour = [12, 17, 21].includes(Number(params.get('hour'))) ? Number(params.get('hour')) : 12;
let viewName = Object.hasOwn(VIEWS, params.get('view')) ? params.get('view') : 'room';

const renderer = createRenderer({ canvas: document.querySelector('#view') });
const scene = new THREE.Scene();
const reflection = createReflectionEnvironment(renderer);
scene.environment = reflection.texture;
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 5;
controls.maxDistance = 150;
controls.maxPolarAngle = Math.PI * .48;
let root, theme, lights, environment;

function updateURL() {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({ building, season, hour, view: viewName })) url.searchParams.set(key, value);
  history.replaceState(null, '', url);
}

function updateLight() {
  const sun = applyTimeOfDay(lights, hour, theme, scene);
  applyNightLights(environment.nightLights, sun.lampOn);
  document.querySelectorAll('[data-hour]').forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.hour) === hour));
  updateURL();
}

function releaseWorld() {
  if (!root) return;
  disposeSubtree(root);
  scene.remove(root);
  clearMaterialCache();
  releaseNightLightAssets();
}

function build() {
  window.officeCollectionReady = false;
  releaseWorld();
  theme = resolveTheme({ theme: building }, { building, season });
  applyPalette(theme.palette);
  scene.background = new THREE.Color(theme.sky);
  // A fixed dressing makes a change of room a comparison of architecture and light.
  const random = Math.random;
  Math.random = seeded(205);
  try {
    root = new THREE.Group();
    scene.add(root);
    lights = addLighting(root, theme.light);
    environment = buildEnvironment(root, theme);
    buildProps(root, theme);
  } finally {
    Math.random = random;
  }
  const identity = DESCRIPTIONS[building];
  document.body.dataset.building = building;
  document.querySelector('#office-name').textContent = BUILDINGS[building].label;
  document.querySelector('#office-description').textContent = identity.description;
  document.querySelectorAll('.materials i').forEach((chip, i) => { chip.style.background = identity.swatches[i]; });
  document.querySelectorAll('.office-picker button').forEach(button => button.setAttribute('aria-pressed', button.dataset.building === building));
  document.title = `${BUILDINGS[building].label} · The Roving Office`;
  updateLight();
  document.querySelector('#loading').hidden = true;
  window.officeCollectionReady = true;
}

function setView(name) {
  if (!Object.hasOwn(VIEWS, name)) return;
  viewName = name;
  camera.position.set(...VIEWS[name].eye);
  controls.target.set(...VIEWS[name].target);
  controls.update();
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', button.dataset.view === name));
  updateURL();
}

const picker = document.querySelector('.office-picker');
BUILDING_ORDER.filter(key => Object.hasOwn(DESCRIPTIONS, key)).forEach((key, index) => {
  const button = picker.querySelector(`[data-building="${key}"]`);
  const number = button.querySelector('span');
  number.textContent = String(index + 1).padStart(2, '0');
  button.replaceChildren(number, BUILDINGS[key].label);
  button.title = BUILDINGS[key].subtitle;
  picker.appendChild(button);
});
document.querySelectorAll('.office-picker button').forEach(button => button.addEventListener('click', () => {
  if (building === button.dataset.building) return;
  building = button.dataset.building;
  build();
}));
document.querySelectorAll('[data-hour]').forEach(button => button.addEventListener('click', () => { hour = Number(button.dataset.hour); updateLight(); }));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
const seasonSelect = document.querySelector('#season');
seasonSelect.value = season;
seasonSelect.addEventListener('change', () => { season = seasonSelect.value; build(); });

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
addEventListener('error', event => {
  const error = document.querySelector('#error');
  error.hidden = false;
  error.textContent = event.error?.message ?? event.message;
});
resize();
build();
setView(viewName);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// Shared instrumentation for browser verification; the viewer has no saved office.
window.officeCollection = {
  renderer, scene, camera, controls,
  get building() { return building; },
  get root() { return root; },
  setBuilding(value) { if (Object.hasOwn(DESCRIPTIONS, value)) { building = value; build(); } },
  setHour(value) { hour = value; updateLight(); },
  setSeason(value) { if (['summer', 'autumn', 'winter', 'spring'].includes(value)) { season = value; seasonSelect.value = value; build(); } },
  setView,
};
