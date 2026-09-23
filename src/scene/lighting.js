import * as THREE from 'three';
import { ROOM } from '../config.js';
import { lerp } from '../ease.js';
import { clamp01 } from '../measure.js';

// The light rig, and the time of day that drives it.
//
// The sun is *not* a fixed position in the theme any more. A theme supplies only
// how high the sun climbs in that season (`sunElevation`) and how warm it goes
// (`sunWarmth`); where it actually sits, how bright it is, and what colour the sky
// takes are all derived from the world clock. That is what makes scrubbing the
// clock in the developer panel move the shadows across the floor.

const SUN_DISTANCE = 46;         // how far out the directional light sits

// Daylight window. Kept fixed rather than per-season: the seasons already differ
// in sun height and warmth, and a winter day that ends at 16:00 mostly reads as
// "the scene is broken".
const SUNRISE = 6;
const SUNSET = 20;

// Where the sun stands at midday, and how far it swings either side of that across
// the day. Azimuth is measured as OrbitControls does — atan2(dx, dz) from the room
// centre — so 0 points straight down +z and it increases toward +x.
//
// This was once a sweep across the far side of the building, on the reasoning that
// the sun should rake in through the back and left windows. It did, and the room
// paid for it. A cutaway shows two walls, at z = 0 and x = 0, and their inside faces
// — the only faces of them anyone sees — point back at the camera. A sun behind them
// never touched either one, in any season, at any hour: at midday it sat 178° from
// the default camera heading, two degrees off dead behind, and the brightest thing
// on screen was the pavement outside.
//
// Those faces are lit only while the sun shares the camera's quadrant, so "light the
// room" and "throw shadows toward the viewer" are one tension pulling two ways, and
// the old numbers resolved it entirely one way. These put midday 44° off the default
// heading: far enough that everything on the floor keeps a lit side and a shaded one,
// near enough that the room is actually daylit. Evening still swings round behind the
// building, which is where a long warm rake belongs and where the lamps are already
// coming up to meet it.
//
// The arc itself is fixed; a scene turns it with `bearing` (see `sunState`).
const NOON_AZIMUTH = Math.PI * 0.47;   // 85°; the default camera looks on from 41°
const DAY_ARC = Math.PI;               // 180°, sunrise to sunset, as an equinox does

// --- and where the sun is when the room knows where on earth it stands -------
//
// Give a scene a latitude and none of the above is used: the sun is worked out from
// the sky instead, and the arc above becomes what a room falls back to when nobody
// has put it anywhere.
//
// How far the sun swings north and south of the equator across a year. A season is
// a position in that swing rather than a set of numbers now (`sunTilt` in
// projects.js), and the hemisphere flips it — June is midsummer in London and
// midwinter in Sydney, so the same "Summer" has to mean opposite ends of the tilt
// depending on which side of the equator the pin is on.
const AXIAL_TILT = 23.44;

/**
 * The world azimuth that points north.
 *
 * The two systems turn opposite ways — a world azimuth runs +z toward +x, a compass
 * runs north toward east, and seen from above those are counter-clockwise and
 * clockwise — so a compass bearing is *subtracted* from this rather than added.
 *
 * 265° is not arbitrary: it puts a northern-hemisphere noon sun, which is due south,
 * exactly on NOON_AZIMUTH. Dropping a pin on London therefore leaves midday looking
 * like the tuned default it already was, and changes the shape of the day around it
 * rather than the look of its middle.
 */
const NORTH_AZIMUTH = NOON_AZIMUTH + Math.PI;

/**
 * The room-world azimuth of geographic north for a chosen building bearing.
 *
 * Lighting and the on-screen compass must share this answer. If each carried its
 * own "north", turning the room could leave the sun in one hemisphere and the
 * compass pointing into another.
 *
 * @param {number} bearing  compass degrees, clockwise from north
 * @returns {number} radians, using the room's +z-toward-+x azimuth convention
 */
export function northWorldAzimuth(bearing = 0) {
  return NORTH_AZIMUTH + bearing * RAD;
}

/** Where a directional light is parked after dark; see the note in `sunState`. */
const NIGHT_ELEVATION = 0.55;

// Sun colour at three points in the day, lerped between.
const SUN_NOON = { r: 1.0, g: 0.96, b: 0.89 };
const SUN_LOW = { r: 1.0, g: 0.72, b: 0.44 };   // dawn and dusk
const SUN_NIGHT = { r: 0.62, g: 0.72, b: 1.0 }; // moonlight

const SKY_NIGHT = 0x121a26;
const SKY_TWILIGHT = 0xd99a6c;

const NIGHT_SUN_INTENSITY = 0.14;
const NIGHT_HEMI_SCALE = 0.68;
const NIGHT_HEMI_SKY = 0x8296b0;
const NIGHT_HEMI_GROUND = 0x596575;

// How low the sun must get before the lamps start coming up. 0.72 is late
// afternoon rather than dusk proper, so they fade in ahead of the light going.
const LAMP_ON_FROM = 0.72;

/** Degrees to radians. Astronomy is written in degrees and trigonometry is not. */
const RAD = Math.PI / 180;

/**
 * A shared reflection rig, baked once for the renderer's lifetime. Broad windows
 * give metals and varnish something to reflect without more per-frame lights.
 * It is lighting only: the visible sky and the moving sun remain the world's.
 * The caller owns the returned render target and disposes it with its renderer.
 */
export function createReflectionEnvironment(renderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x9eafc0);
  const panels = [
    { size: [14, 10], position: [0, 9, 0], colour: [2.8, 2.7, 2.5] },
    { size: [8, 6], position: [7, 3, 4], colour: [3.8, 3.3, 2.6] },
    { size: [6, 8], position: [-7, 2, -3], colour: [1.8, 2.3, 3.1] },
    { size: [20, 20], position: [0, -6, 0], colour: [0.22, 0.16, 0.11] },
  ];
  for (const { size, position, colour } of panels) {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    material.color.setRGB(...colour);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(...size), material);
    panel.position.set(...position);
    panel.lookAt(0, 0, 0);
    studio.add(panel);
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(studio, 0.06, 0.1, 30);
  generator.dispose();
  for (const panel of studio.children) {
    panel.geometry.dispose();
    panel.material.dispose();
  }
  return target;
}

function lerpRGB(a, b, t) {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

function lerpHex(a, b, t) {
  const mix = (shift) => Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, t)) & 0xff;
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/**
 * Build the rig. The sun is created here but positioned by applyTimeOfDay(),
 * which the caller must invoke at least once (and then per frame, cheaply).
 */
export function addLighting(scene, lightSpec) {
  const defaults = {
    hemi: { sky: 0xdfe9ef, ground: 0xb08a5a, intensity: 1.1 },
    fill: { color: 0xfff1dd, intensity: 0.65, position: [20, 12, 18] },
  };

  const hemiSpec = lightSpec?.hemi ?? defaults.hemi;
  const fillSpec = lightSpec?.fill ?? defaults.fill;

  // Ambient sky/ground fill — soft, slightly cool from above, warm bounce below.
  const hemi = new THREE.HemisphereLight(hemiSpec.sky, hemiSpec.ground, hemiSpec.intensity);
  scene.add(hemi);

  // The sun. Position, colour and intensity are all set by applyTimeOfDay().
  const sun = new THREE.DirectionalLight(0xffe6bd, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 34;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1;
  // Generous, because the sun now swings out much further at dawn and dusk than
  // the old fixed position ever sat; too tight a far plane simply drops shadows.
  sun.shadow.camera.far = SUN_DISTANCE * 2.6;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  sun.shadow.blurSamples = 8;
  sun.target.position.set(ROOM.W * 0.5, 0, ROOM.D * 0.5);
  scene.add(sun);
  scene.add(sun.target);

  // Gentle warm bounce from the room interior (no shadows).
  const fill = new THREE.DirectionalLight(fillSpec.color, fillSpec.intensity);
  fill.position.set(...fillSpec.position);
  scene.add(fill);

  return {
    hemi,
    sun,
    fill,
    // Kept so applyTimeOfDay can scale *against the theme's own values* rather
    // than against whatever it last wrote.
    base: { hemi: { ...hemiSpec }, fill: { ...fillSpec } },
  };
}

/**
 * The sun's declination for a season, at a latitude — how far north or south of the
 * equator it stands that month.
 *
 * `sunTilt` is where in the year a season sits, as a fraction of the sun's full swing:
 * +1 at midsummer, −1 at midwinter, 0 at an equinox. Multiplying by the hemisphere is
 * the whole of "summer means December down there".
 *
 * Note that no season the office ships sits at 0. An equinox is a day, not a season,
 * and it is the one day whose sun rises due east, sets due west and gives everywhere
 * twelve hours — a poor stand-in for the three months around it, and the reason
 * `MID_SEASON` exists in projects.js.
 *
 * @param {number} sunTilt  −1 … 1
 * @param {number} lat      degrees, positive north
 * @returns {number} degrees
 */
export function declinationFor(sunTilt, lat) {
  return AXIAL_TILT * sunTilt * (lat >= 0 ? 1 : -1);
}

/**
 * How long the sun is up, at a latitude and declination.
 *
 * `cos H0 = −tan φ · tan δ` has no solution when the sun neither rises nor sets,
 * which is not an error but the Arctic: past the circle the cosine leaves −1…1 and
 * the answer is a whole day of one thing. Both cases are real places and both are
 * returned as such rather than clamped into a fake sunrise.
 *
 * @returns {{sunrise: number, sunset: number, polar: ?('day'|'night')}} hours
 */
export function dayLength(lat, declination) {
  const cosH0 = -Math.tan(lat * RAD) * Math.tan(declination * RAD);
  if (cosH0 <= -1) return { sunrise: 0, sunset: 24, polar: 'day' };
  if (cosH0 >= 1) return { sunrise: 12, sunset: 12, polar: 'night' };
  const halfDay = Math.acos(cosH0) / RAD / 15;
  return { sunrise: 12 - halfDay, sunset: 12 + halfDay, polar: null };
}

/**
 * The sun's real position, for a room that knows where it is standing.
 *
 * The clock is read as *local solar time* — noon is the sun on the meridian — which
 * is why longitude does not appear here. It is stored with the latitude because a
 * place is a place, and because a real timezone would need it, but the only thing
 * that bends the light is how far north or south the room is. Saying so is better
 * than multiplying by a longitude that cannot mean anything until the office knows
 * what time it is somewhere else.
 *
 * @returns {{elevation: number, azimuth: number, arch: number, isDay: boolean}}
 */
function solarPath(hours, { lat, declination, bearing }) {
  const phi = lat * RAD;
  const dec = declination * RAD;

  // The hour angle: the earth turns 15° an hour, and noon is zero.
  const H = (hours - 12) * 15 * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinAlt)));

  // Azimuth measured from due south and running west, which is the form that stays
  // well behaved through the poles, then turned into a compass bearing.
  const fromSouth = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi),
  );
  const compass = fromSouth + Math.PI;

  // Brightness rides how high the sun is against how high it gets *today*, so a
  // short winter afternoon still reaches its own noon rather than reading as a
  // permanent dusk — and a polar night, whose noon is below the horizon, reads as
  // the night it is.
  const sinNoon = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec);
  const arch = sinNoon > 0 ? clamp01(sinAlt / sinNoon) : 0;

  return {
    elevation,
    // Opposite handedness, hence minus: see NORTH_AZIMUTH.
    azimuth: NORTH_AZIMUTH - compass + bearing,
    arch,
    isDay: elevation > 0,
  };
}

/**
 * Where the sun goes when nobody has said where the room is.
 *
 * A fixed daylight window and a sine arch: the shape the office had before it could
 * be put on a map, kept because most rooms are never given a location and this is a
 * diorama before it is an orrery.
 */
function authoredPath(hours, { peakElevation, bearing }) {
  const u = (hours - SUNRISE) / (SUNSET - SUNRISE);
  const isDay = u >= 0 && u <= 1;
  const arch = isDay ? Math.sin(Math.PI * u) : 0;
  return {
    elevation: isDay ? Math.max(0.04, arch * peakElevation) : NIGHT_ELEVATION,
    azimuth: NOON_AZIMUTH + bearing + (clamp01(u) - 0.5) * DAY_ARC,
    arch,
    isDay,
  };
}

/**
 * Where the sun is and what the light looks like at a given hour.
 *
 * Split out from the scene work so it can be reasoned about (and tested) without
 * a renderer: given an hour it returns pure numbers.
 *
 * Two ways to answer it, and the theme decides which: a room with a latitude gets
 * the real sky over that latitude, and a room without one gets the authored arc it
 * always had. Everything past the position — colour, intensity, the sky, when the
 * lamps come up — is shared, because none of it cares how the angle was arrived at.
 *
 * @param {number} hours          fractional hours, 0–24
 * @param {object} theme          resolved theme (sunElevation, sunWarmth, sky,
 *                                bearing, lat, sunTilt)
 */
export function sunState(hours, theme = {}) {
  const peakElevation = (theme.sunElevation ?? 55) * Math.PI / 180;
  const warmth = theme.sunWarmth ?? 0.45;
  const daySky = theme.sky ?? 0xbcd3dd;
  // Which way this room faces, in degrees, turning the whole day's arc with it.
  const bearing = (theme.bearing ?? 0) * Math.PI / 180;

  const located = Number.isFinite(theme.lat);
  const path = located
    ? solarPath(hours, {
      lat: theme.lat,
      declination: declinationFor(theme.sunTilt ?? 0, theme.lat),
      bearing,
    })
    : authoredPath(hours, { peakElevation, bearing });

  const { arch, azimuth, isDay } = path;
  // At night keep the light source above the horizon anyway: a directional light
  // from below lights the undersides of everything and looks broken. The authored
  // path parks itself; a real one has to be caught here, because a real sun does
  // go under the floor.
  const elevation = isDay ? path.elevation : NIGHT_ELEVATION;

  const cx = ROOM.W * 0.5;
  const cz = ROOM.D * 0.5;
  const horizontal = Math.cos(elevation) * SUN_DISTANCE;
  const position = [
    cx + Math.sin(azimuth) * horizontal,
    Math.max(3, Math.sin(elevation) * SUN_DISTANCE),
    cz + Math.cos(azimuth) * horizontal,
  ];

  // `low` is 1 when the sun is on the horizon and 0 at its peak — it drives both
  // the warm colour shift and the twilight sky.
  const low = isDay ? 1 - arch : 1;

  let colour;
  let intensity;
  let skyColour;

  if (isDay) {
    // Warmth is a season trait, so an autumn noon is already warmer than a
    // summer one before any dawn/dusk shift is applied.
    const warmShift = clamp01(low * low * (0.55 + warmth * 0.45) + warmth * 0.25);
    colour = lerpRGB(SUN_NOON, SUN_LOW, warmShift);
    intensity = lerp(0.35, 1.45, arch);
    // Sky only goes properly orange right at the ends of the day.
    skyColour = lerpHex(daySky, SKY_TWILIGHT, clamp01((low - 0.55) / 0.45) * 0.85);
  } else {
    colour = SUN_NIGHT;
    intensity = NIGHT_SUN_INTENSITY;
    skyColour = SKY_NIGHT;
  }

  // How dark it is overall, 0 = full day, 1 = deep night. Used for the ambient
  // rig and available to callers that want to light windows after dark.
  const darkness = isDay ? clamp01((low - 0.7) / 0.3) * 0.55 : 1;

  // When the artificial lights come on, 0 = off, 1 = full.
  //
  // Deliberately not `darkness`: that is capped at 0.55 through the day and then
  // steps straight to 1 the moment the sun sets, so driving lamps from it would
  // snap them on. This ramps with how low the sun is, reaching full at the horizon
  // and holding through the night, so dusk brings the lamps up gradually.
  const lampOn = isDay ? clamp01((low - LAMP_ON_FROM) / (1 - LAMP_ON_FROM)) : 1;

  return { isDay, position, colour, intensity, skyColour, darkness, lampOn, elevation, azimuth };
}

/**
 * Point the rig at a time of day. Cheap enough to call every frame.
 *
 * @param {object} handles  what addLighting() returned
 * @param {number} hours    fractional hours, 0–24
 * @param {object} theme    resolved theme
 * @param {THREE.Scene} [scene]  if given, its background tracks the sky
 */
export function applyTimeOfDay(handles, hours, theme, scene = null) {
  if (!handles) return null;
  const st = sunState(hours, theme);

  handles.sun.position.set(...st.position);
  handles.sun.color.setRGB(st.colour.r, st.colour.g, st.colour.b);
  handles.sun.intensity = st.intensity;

  // Ambient light cools and drops after dark rather than switching off, so the
  // room stays readable — this is a diorama, not a horror game.
  const base = handles.base;
  const night = st.darkness;
  handles.hemi.intensity = base.hemi.intensity * lerp(1, NIGHT_HEMI_SCALE, night);
  handles.hemi.color.set(lerpHex(base.hemi.sky, NIGHT_HEMI_SKY, night));
  handles.hemi.groundColor.set(lerpHex(base.hemi.ground, NIGHT_HEMI_GROUND, night));
  handles.fill.intensity = base.fill.intensity * lerp(1, 0.7, night);

  if (scene?.background?.set) scene.background.set(st.skyColour);
  // Keep the reflection fill below the sun and sky: too much lifts every dark
  // surface together and washes out the room's colour and contrast.
  if (scene?.environment) scene.environmentIntensity = lerp(0.18, 0.065, night);

  return st;
}
