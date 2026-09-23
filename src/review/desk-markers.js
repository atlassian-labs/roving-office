import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyPalette } from '../config.js';
import { BUILDINGS, BUILDING_ORDER, resolveTheme } from '../projects.js';
import { buildDesk } from '../scene/props/desk.js';
import { createRenderer } from '../scene/renderer.js';
import { createCamera } from '../scene/camera.js';
import { addLighting, applyTimeOfDay, createReflectionEnvironment } from '../scene/lighting.js';
import { box, clearMaterialCache, disposeSubtree } from '../scene/build.js';

const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
const renderer = createRenderer({ canvas: $('view'), transparent: true });
const reflection = createReflectionEnvironment(renderer);
scene.environment = reflection.texture;
const colours = ['#6c8bd1', '#cf8663', '#6b9d7f', '#b384c7', '#bd9a48'];
const studies = [];
let root, lights, theme, scheduled = false;

for (const key of BUILDING_ORDER) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = BUILDINGS[key].label;
  $('building').append(option);
}
$('building').value = 'canopy';

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; render(); });
}

for (const [index, hex] of colours.entries()) {
  const label = `Desk ${index + 1}`;
  const article = document.createElement('article');
  article.innerHTML = `<div class="desk-view" tabindex="0" role="img" aria-label="${label}: drag to orbit, scroll to zoom"></div>
    <div class="caption"><div><h2><span class="number">0${index + 1}</span>${label}</h2><p>Blank nameplate · 30°</p></div>
    <input class="swatch" type="color" value="${hex}" aria-label="${label} agent colour"></div>
    <label class="check assignment"><input type="checkbox" checked> Assigned to an agent</label>`;
  $('studies').append(article);
  const viewport = article.querySelector('.desk-view');
  const camera = createCamera(1);
  const controls = new OrbitControls(camera, viewport);
  controls.target.set(12, 1.5, 10);
  controls.enablePan = false;
  controls.minZoom = 3;
  controls.maxZoom = 12;
  controls.minPolarAngle = .12;
  controls.maxPolarAngle = Math.PI * .49;
  controls.addEventListener('change', schedule);
  const colour = article.querySelector('.swatch');
  const assigned = article.querySelector('input[type=checkbox]');
  const study = { viewport, camera, controls, colour, assigned };
  studies.push(study);
  colour.addEventListener('input', () => {
    if ($('same-colour').checked) studies.forEach(s => { s.colour.value = colour.value; });
    updateAssignments();
  });
  assigned.addEventListener('change', () => {
    $('assigned').checked = studies.every(s => s.assigned.checked);
    $('assigned').indeterminate = !studies.every(s => s.assigned.checked === studies[0].assigned.checked);
    updateAssignments();
  });
}

function updateAssignments() {
  for (const study of studies) {
    const agent = study.assigned.checked ? { color: Number.parseInt(study.colour.value.slice(1), 16) } : null;
    study.desk.handle.setAssignment(agent);
  }
  schedule();
}

function build() {
  if (root) { scene.remove(root); disposeSubtree(root); }
  clearMaterialCache();
  theme = resolveTheme({ theme: $('building').value }, { building: $('building').value, season: 'summer' });
  applyPalette(theme.palette);
  root = new THREE.Group();
  scene.add(root);
  lights = addLighting(root, theme.light);
  // A small portrait stage needs a smaller shadow map than the city outside it.
  root.traverse(obj => { if (obj.shadow) obj.shadow.mapSize.set(512, 512); });
  const floor = box(200, .08, 200, theme.palette.floor ?? 0xd9d8c9);
  floor.position.set(12, -.05, 10);
  root.add(floor);
  for (const [i, study] of studies.entries()) {
    study.desk = buildDesk({ id: `study-${i}`, x: 12, z: 10, facing: 0, standing: $('standing').checked }, i);
    study.desk.handle.setMug($('mugs').checked);
    root.add(study.desk.obj);
  }
  updateLight();
  updateAssignments();
}

function updateLight() {
  applyTimeOfDay(lights, Number($('hour').value), theme, scene);
  schedule();
}

function resetViews() {
  for (const { camera, controls } of studies) {
    camera.position.set(140, 189.5, 138);
    controls.target.set(12, 1.5, 10);
    camera.zoom = 7.2;
    camera.updateProjectionMatrix();
    controls.update();
  }
  schedule();
}

function render() {
  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.setScissorTest(true);
  for (const study of studies) {
    const r = study.viewport.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    for (const other of studies) other.desk.obj.visible = other === study;
    const aspect = r.width / r.height;
    study.camera.left = -22 * aspect;
    study.camera.right = 22 * aspect;
    study.camera.updateProjectionMatrix();
    renderer.setViewport(r.left, innerHeight - r.bottom, r.width, r.height);
    renderer.setScissor(r.left, Math.max(0, innerHeight - r.bottom), r.width,
      Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
    renderer.render(scene, study.camera);
  }
  window.deskMarkersReady = true;
}

$('building').addEventListener('change', build);
$('standing').addEventListener('change', build);
$('hour').addEventListener('change', updateLight);
$('mugs').addEventListener('change', () => {
  studies.forEach(study => study.desk.handle.setMug($('mugs').checked));
  schedule();
});
$('reset').addEventListener('click', resetViews);
$('same-colour').addEventListener('change', () => {
  studies.forEach((study, i) => { study.colour.value = $('same-colour').checked ? studies[0].colour.value : colours[i]; });
  updateAssignments();
});
$('assigned').addEventListener('change', () => {
  studies.forEach(study => { study.assigned.checked = $('assigned').checked; });
  updateAssignments();
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); schedule(); });
addEventListener('scroll', schedule, { passive: true });
addEventListener('error', event => { $('error').hidden = false; $('error').textContent = event.message; });
renderer.setSize(innerWidth, innerHeight);
build();
resetViews();

// The review page uses the same desk builder and assignment setter as the office.
window.deskMarkerStudies = { studies, renderer, scene, build, render };
