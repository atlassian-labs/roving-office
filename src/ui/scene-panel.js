// The scene panel: what the room looks like.
//
// Split out of the old developer panel, which had grown into two unrelated jobs in
// one strip — the controls that dress the room, and the instruments that tell you
// what the app is doing. Those have different audiences and different lifetimes:
// season and building are how a scene gets chosen in the first place, while the
// camera readout is something you open when a frame looks wrong. They are two
// panels now, and this is the first one (see dev-panel.js for the other).
//
// Two kinds of control live here, and they behave differently on purpose:
//
//   * Time is a *live* control. The world clock feeds the sun, the sky and the LED
//     panel on the wall, so scrubbing it re-lights the scene on the next frame
//     with no rebuild.
//   * Lights is live too. It overrides what the clock would do with the street
//     lamps and ceiling fittings, without rebuilding anything.
//   * Orientation is live as well. It turns the room under the sky, and nothing in
//     the room's geometry depends on which way it faces, so the next frame is enough.
//   * Place is live for the same reason. Where the room stands changes only the
//     angle of a light, and the light is read off the theme every frame.
//   * Season and building are *structural*. They change what gets built — the
//     street outside, the facade below, how agents reach the floor — so they ask
//     the app to rebuild the scenery around the running office. They lead the row for that reason: the panel
//     reads from what remakes the room to what only relights it.

import { node } from './dom.js';
import { SEASONS, BUILDINGS, BUILDING_ORDER } from '../projects.js';
import { worldClock } from '../time.js';
import { createStrip, section, segmented, watchStripRows } from './strip.js';
import { createPlaceMap, formatPlace, PLACES } from './place-map.js';
import { createCompassDial } from './compass-dial.js';
import { recallPanel, rememberPanel } from './panel-state.js';

/** Its element id, which is also what it is remembered under. */
const ID = 'scene-panel';

/** The picker's own option for "put this office back nowhere". */
const CLEAR = '\u0000clear';

/** Repaints per second, for the clock readout while the panel is open. */
const READOUT_HZ = 8;

/**
 * Lighting override. Three states rather than a plain on/off switch: the lamps
 * normally follow the world clock, and a two-state switch would either lose that
 * behaviour or leave no way back to it once flipped.
 *
 * Lives here rather than in the developer panel because this is the panel that
 * shows it; `main.js` cycles through these in declaration order for `L`.
 */
export const LIGHT_MODES = {
  auto: { label: 'Auto' },
  on: { label: 'On' },
  off: { label: 'Off' },
};

function hhmm(hours) {
  const total = Math.round(((hours % 24) + 24) % 24 * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * @param {object} opts
 * @param {(season: string) => void} opts.onSeason
 * @param {(building: string) => void} opts.onBuilding
 * @param {(mode: string) => void} opts.onLights   one of LIGHT_MODES
 * @param {() => boolean} [opts.getAutomaticLights] whether the clock is lighting the lamps
 * @param {(bearing: number) => void} opts.onBearing  degrees, 0–359
 * @param {(lat: ?number, lon: ?number) => void} opts.onPlace  nulls to clear it
 */
export function createScenePanel({ onSeason, onBuilding, onLights, getAutomaticLights = () => false, onBearing, onPlace }) {
  const { host, body } = createStrip({ id: ID, title: 'Scene', onClose: () => hide() });

  let open = false;
  let sinceRepaint = 0;
  /**
   * Where the sun stands in the year, and the longitude the clock is local to.
   *
   * Held here rather than asked for on every tick: the map's night side has to keep
   * moving with the clock, and the clock moves on its own.
   */
  let sky = 0;
  let skyLon = 0;

  // --- Time ---
  // Fill spare row width, with a compact minimum for the clock and Now button.
  const timeGroup = section('Time');
  timeGroup.el.classList.add('dev-group-time');
  const timeValue = node('span', 'dev-time');

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1439';
  slider.step = '5';
  slider.className = 'dev-slider';
  slider.setAttribute('aria-label', 'Time of day');

  const liveBtn = document.createElement('button');
  liveBtn.type = 'button';
  liveBtn.className = 'dev-btn';
  liveBtn.textContent = 'Now';
  liveBtn.title = 'Hand the clock back to real time';

  slider.addEventListener('input', () => {
    worldClock.setHours(Number(slider.value) / 60);
    paintTime();
  });
  liveBtn.addEventListener('click', () => {
    worldClock.reset();
    paintTime();
  });

  // Now rides the Time heading; the readout and scrubber sit directly beneath it.
  timeGroup.heading.classList.add('dev-time-head');
  timeGroup.heading.appendChild(liveBtn);

  const timeStack = node('div', 'dev-time-stack dev-time-grow');
  timeStack.append(timeValue, slider);
  timeGroup.body.appendChild(timeStack);

  // Auto owns the lamps while selected; clicking it again returns to manual.
  const lightsGroup = section('Lights');
  const lightsRow = node('div', 'dev-lights-row');
  let lightMode = 'auto';
  let manualLightMode = null;
  const autoBtn = node('button', 'dev-btn', 'Auto');
  autoBtn.type = 'button';
  autoBtn.title = 'Let the clock control the lights; click again for manual control';
  autoBtn.addEventListener('click', () => {
    const next = lightMode === 'auto'
      ? manualLightMode ?? (getAutomaticLights() ? 'on' : 'off') : 'auto';
    onLights?.(next);
  });
  const lightToggle = node('label', 'ui-toggle dev-lights-toggle');
  const lightInput = document.createElement('input');
  lightInput.type = 'checkbox';
  lightInput.setAttribute('role', 'switch');
  lightInput.setAttribute('aria-label', 'Lights');
  const lightTrack = node('span', 'ui-toggle-track');
  lightTrack.setAttribute('aria-hidden', 'true');
  const lightLabel = node('span', 'ui-toggle-label');
  lightInput.addEventListener('change', () => onLights?.(lightInput.checked ? 'on' : 'off'));
  lightToggle.append(lightInput, lightTrack, lightLabel);
  lightsRow.append(autoBtn, lightToggle);
  lightsGroup.body.appendChild(lightsRow);

  function paintLights() {
    const automatic = lightMode === 'auto';
    const on = automatic ? getAutomaticLights() : lightMode === 'on';
    autoBtn.classList.toggle('active', automatic);
    autoBtn.setAttribute('aria-pressed', String(automatic));
    lightInput.disabled = automatic;
    lightInput.checked = on;
    lightLabel.textContent = on ? 'On' : 'Off';
    lightToggle.title = automatic ? 'Controlled by Auto; turn Auto off to set the lights' : 'Turn the lights on or off';
  }

  // --- Sun ---
  //
  // Which way the room faces, which is the same thing as where the sun comes from.
  // A season already says how *high* the sun climbs; this says where it climbs, and
  // it is the only part of the light somebody chooses rather than inherits.
  //
  // Fixed-width, for the mechanical reason given on `.dev-group-fixed`:
  // a stack that sets its own width inside a group allowed to shrink just prints
  // itself across its neighbour.
  const orientationGroup = section('Orientation');
  orientationGroup.el.classList.add('dev-group-fixed');

  const compass = createCompassDial({ size: 96, onTurn: (deg) => onBearing?.(deg) });

  const sunResetBtn = document.createElement('button');
  sunResetBtn.type = 'button';
  sunResetBtn.className = 'dev-btn';
  sunResetBtn.textContent = 'North up';
  sunResetBtn.title = 'Face the room north again';
  sunResetBtn.addEventListener('click', () => onBearing?.(0));

  const sunStack = node('div', 'dev-sun-stack');
  sunStack.append(compass.el, sunResetBtn);
  orientationGroup.body.appendChild(sunStack);

  // --- Place ---
  //
  // The tallest thing in the strip, and the reason the panel grew. It earns the room:
  // a latitude is the difference between a sun that climbs overhead and one that
  // scrapes the horizon all day, and there is no arrangement of lozenges that lets
  // somebody say "here" as quickly as pointing at it does.
  const locationGroup = section('Location');
  locationGroup.el.classList.add('dev-group-fixed', 'dev-place-group');

  const placeValue = node('span', 'dev-place-value');

  const placeMap = createPlaceMap({ width: 232, onPick: (lat, lon) => onPlace?.(lat, lon) });

  // A named place is how you find a latitude without a coastline to recognise. It
  // reads "Somewhere" while the pin is off the list, rather than lying about which
  // city the pin is nearest.
  const placeSelect = node('select', 'dev-select');
  placeSelect.setAttribute('aria-label', 'A place to put the office');
  // The picker says where the office is, in three states, and the first option is the
  // one that carries two of them. **Unspecified** is a room that has not been put
  // anywhere — the ordinary case, and the picker dims to say it is naming a state
  // rather than a choice. **Somewhere…** is the same slot once a pin has been dropped
  // on the map at no place with a name, which is a real answer and reads as one.
  const anywhere = document.createElement('option');
  anywhere.value = '';
  anywhere.textContent = 'Unspecified';
  placeSelect.appendChild(anywhere);
  for (const place of PLACES) {
    const opt = document.createElement('option');
    opt.value = place.name;
    opt.textContent = place.name;
    placeSelect.appendChild(opt);
  }
  // And the way back out, at the far end of the list where an action belongs rather
  // than at the top among the places. Choosing it returns the picker to Unspecified.
  const clearOpt = document.createElement('option');
  clearOpt.value = CLEAR;
  clearOpt.textContent = 'Clear location';
  placeSelect.appendChild(clearOpt);
  placeSelect.addEventListener('change', () => {
    const found = PLACES.find((p) => p.name === placeSelect.value);
    onPlace?.(found ? found.lat : null, found ? found.lon : null);
  });


  // The picker rides the heading line, out at the right: it says *which* place the
  // section is showing rather than adjusting anything in it, which is the one kind of
  // control that belongs beside a title instead of under it.
  locationGroup.heading.appendChild(placeSelect);

  // One line under the map: a coordinate and the day it gets, which fits across 232
  // pixels now that nothing shares the line with it.
  const placeStack = node('div', 'dev-place-stack');
  placeStack.append(placeMap.el, placeValue);
  locationGroup.body.appendChild(placeStack);

  // --- Season + building ---
  const seasonGroup = section('Season');
  seasonGroup.el.classList.add('dev-group-season');
  const seasonBtns = segmented(seasonGroup.body, SEASONS, (key) => onSeason?.(key));
  timeGroup.body.appendChild(seasonGroup.el);

  const buildingGroup = section('Building');
  buildingGroup.el.classList.add('dev-group-buildings');
  const buildingChoices = Object.fromEntries(BUILDING_ORDER.map(key => [key, BUILDINGS[key]]));
  const buildingBtns = segmented(buildingGroup.body, buildingChoices, (key) => onBuilding?.(key),
    { stacked: true });
  for (const [key, button] of buildingBtns) button.title = BUILDINGS[key].subtitle;

  // Ordered by how far each choice reaches. Building and Season replace the scenery
  // outright; Lights and Time change what is already standing; Orientation and the
  // map only bend a light. The map goes last because it is the one control here you
  // aim at rather than press, and it is the tallest thing in the row.
  // The compass and the map travel as a pair. They are the two tallest things here and
  // the two that only bend a light, so when the panel runs out of width they are what
  // drops to a second line — together, and beginning under Building. Wrapping them
  // individually would leave the compass stranded beside the map on one line and
  // alone on the next depending on the window, which is the rearranging that
  // `.dev-panel-body` was told not to do.

  const pair = node('div', 'dev-pair');
  pair.append(orientationGroup.el, locationGroup.el);

  body.append(buildingGroup.el, lightsGroup.el, timeGroup.el, pair);

  watchStripRows(body);

  function paintTime() {
    paintLights();
    const hours = worldClock.hours();
    timeValue.textContent = hhmm(hours);
    // The night side of the map rides the same clock as the room does.
    placeMap.setSky({ hours, declination: sky, lon: skyLon });
    liveBtn.classList.toggle('active', !worldClock.shifted);
    // Keep the slider in sync with Now, without moving it under a
    // keyboard or pointer that is currently adjusting it.
    if (document.activeElement !== slider) slider.value = String(Math.round(hours * 60));
  }

  paintTime();

  /** On screen or not, without an opinion about whether that is worth remembering. */
  function apply(next) {
    open = next;
    host.classList.toggle('hidden', !next);
    if (next) paintTime();
  }

  // Declared rather than only living on the returned object, because the panel's own
  // × needs it too — and a strip built before that object exists cannot reach into it.
  function hide() { apply(false); rememberPanel(ID, false); }
  function show() { apply(true); rememberPanel(ID, true); }

  // Back the way it was left. Applied rather than shown, so opening the office does not
  // write back the arrangement it has just read.
  apply(recallPanel(ID, false));

  return {
    get isOpen() { return open; },

    show,
    hide,
    toggle() { open ? hide() : show(); },

    /** Reflect the world's actual season/building/lights/sun, e.g. after a switch. */
    setState({ season, building, lights, bearing, place }) {
      // Absent means "leave it alone" throughout, season and building included. They
      // used to be the exception, on the reasoning that every caller passed them —
      // and then one did not, so turning the compass quietly unhighlighted Summer.
      if (season !== undefined) {
        for (const [key, b] of seasonBtns) b.classList.toggle('active', key === season);
      }
      if (building !== undefined) {
        for (const [key, b] of buildingBtns) b.classList.toggle('active', key === building);
      }
      if (Number.isFinite(bearing)) compass.set(bearing);
      // `place` is passed as an object so that clearing it — both coordinates null —
      // is still something to say, where two absent arguments would be silence.
      if (place !== undefined) {
        sky = place?.declination ?? sky;
        skyLon = place?.lon ?? 0;
        placeMap.set(place?.lat, place?.lon);
        placeValue.textContent = formatPlace(place?.lat, place?.lon)
          + (place?.day ? ` · ${place.day}` : '');
        const named = PLACES.find(
          (p) => Math.abs(p.lat - (place?.lat ?? 999)) < 0.02
            && Math.abs(p.lon - (place?.lon ?? 999)) < 0.02,
        );
        // Named place, a pin of your own, or nowhere: the picker shows which, and goes
        // quiet for the last of the three.
        const located = Number.isFinite(place?.lat);
        placeSelect.value = named ? named.name : '';
        anywhere.textContent = located ? 'Somewhere…' : 'Unspecified';
        placeSelect.classList.toggle('dev-select-dim', !located);
      }
      // Absent means "leave it alone": callers update season and building without
      // always knowing or caring about the lighting override.
      if (lights !== undefined) {
        lightMode = lights;
        if (lights !== 'auto') manualLightMode = lights;
        paintLights();
      }
    },

    /** Called each frame; repaints the clock at READOUT_HZ while the panel is open. */
    update(dt) {
      if (!open) return;
      sinceRepaint += dt;
      if (sinceRepaint < 1 / READOUT_HZ) return;
      sinceRepaint = 0;
      paintTime();
    },
  };
}
