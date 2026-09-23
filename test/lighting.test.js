// Where the sun is, and what that means for a room you can only see two walls of.
//
// `sunState` is pure numbers given an hour, which is why it was split out of the
// rig in the first place — but lighting.js bare-imports 'three', so it needs the
// same headless harness the catalogue test uses before it can be loaded here.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let sunState, declinationFor, dayLength, hemisphereOf, CAMERA, SEASONS;

before(async () => {
  stubDom();
  await loadThree();
  ({ sunState, declinationFor, dayLength } = await import('../src/scene/lighting.js'));
  ({ hemisphereOf } = await import('../src/ui/place-map.js'));
  ({ CAMERA } = await import('../src/config.js'));
  ({ SEASONS } = await import('../src/projects.js'));
});

const DEG = 180 / Math.PI;

/** The heading the default camera looks on from, in the same terms as an azimuth. */
function cameraAzimuth() {
  const [px, , pz] = CAMERA.position;
  const [tx, , tz] = CAMERA.target;
  return Math.atan2(px - tx, pz - tz) * DEG;
}

/** How far apart two headings are, in degrees, the short way round. */
function apart(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

const theme = (season) => ({
  sunElevation: SEASONS[season].sunElevation,
  sunWarmth: SEASONS[season].sunWarmth,
});

test('the sun spends the working day in front of the building, not behind it', () => {
  // The whole of the sun-path fix. The old arc was pinned to the far side of the
  // building and
  // never came within 133° of the camera — 178° at midday, two degrees off dead
  // behind — so the two walls a cutaway shows were backlit from dawn to dusk.
  const cam = cameraAzimuth();
  for (let h = 8; h <= 17; h += 0.5) {
    const gap = apart(sunState(h, theme('summer')).azimuth * DEG, cam);
    assert.ok(gap < 100, `at ${h}:00 the sun is ${gap.toFixed(0)}° from the camera`);
  }
});

test('and never so close to the camera that the room goes flat', () => {
  // A sun directly over the viewer's shoulder hides every shadow behind the thing
  // casting it. Midday is the closest approach that matters, since it is also the
  // brightest hour.
  const gap = apart(sunState(12, theme('summer')).azimuth * DEG, cameraAzimuth());
  assert.ok(gap > 20, `midday sun is only ${gap.toFixed(0)}° off the camera heading`);
});

test('at midday both of the walls you can see are lit', () => {
  // Only two walls exist — z = 0 and x = 0 — and the faces of them anyone sees point
  // back down +z and +x. Each is lit only while the sun has a component along its
  // normal, which is what puts a ceiling on how far the arc can be pushed round.
  const { azimuth } = sunState(12, theme('summer'));
  assert.ok(Math.cos(azimuth) > 0, 'the back wall is lit');
  assert.ok(Math.sin(azimuth) > 0, 'the left wall is lit');
});

test('a bearing turns the whole arc, and turns it by exactly what it says', () => {
  for (const h of [7, 12, 18]) {
    const plain = sunState(h, theme('summer')).azimuth * DEG;
    const turned = sunState(h, { ...theme('summer'), bearing: 90 }).azimuth * DEG;
    assert.ok(Math.abs(apart(turned, plain) - 90) < 1e-6, `${h}:00 turned by 90°`);
  }
});

test('a bearing is an angle, so it wraps rather than running out', () => {
  const at = (bearing) => sunState(12, { ...theme('summer'), bearing }).azimuth * DEG;
  assert.ok(apart(at(370), at(10)) < 1e-6, '370° is 10°');
  assert.ok(apart(at(-90), at(270)) < 1e-6, '−90° is 270°');
});

test('a bearing moves the sun round without moving it up or down', () => {
  // Height is the season's business and bearing is the room's; they should not be
  // able to reach into each other.
  const plain = sunState(12, theme('summer'));
  const turned = sunState(12, { ...theme('summer'), bearing: 137 });
  assert.equal(turned.elevation, plain.elevation);
  assert.equal(turned.intensity, plain.intensity);
});

test('season still decides how high it climbs', () => {
  const noon = (season) => sunState(12, theme(season)).elevation;
  assert.ok(noon('summer') > noon('spring'));
  assert.ok(noon('spring') > noon('autumn'));
  assert.ok(noon('autumn') > noon('winter'));
});

test('after dark the sun is parked above the horizon, whatever the bearing', () => {
  // A directional light from below lights the undersides of everything and reads as
  // broken, so night keeps it up there — and turning the room must not change that.
  for (const bearing of [0, 90, 200, 359]) {
    const st = sunState(2, { ...theme('winter'), bearing });
    assert.equal(st.isDay, false);
    assert.ok(st.position[1] > 0, 'the light is above the floor');
  }
});

// --- a room that knows where it is standing ---------------------------------
//
// Give a scene a latitude and the arc above is not used at all: the sun is worked
// out from the sky over that latitude. These check it against places whose skies
// are a matter of record, because "the light looks nicer" is not a test.

/** Undo the world→compass turn, so a bearing can be checked against an almanac. */
const compassOf = (azimuth) => (((0.47 + 1) * 180 - azimuth * DEG) % 360 + 360) % 360;

const at = (lat, sunTilt, hours, extra = {}) => sunState(hours, { lat, sunTilt, ...extra });

test('a season is a place in the year, and the hemisphere turns it over', () => {
  assert.equal(declinationFor(1, 51.5).toFixed(2), '23.44', 'London summer: sun to the north');
  assert.equal(declinationFor(1, -33.9).toFixed(2), '-23.44', 'Sydney summer: sun to the south');
  assert.equal(declinationFor(-1, 51.5).toFixed(2), '-23.44');
  assert.equal(declinationFor(0, 51.5), 0, 'an equinox is over the equator either way');
});

test('midsummer noon over London is 62° up and due south', () => {
  const noon = at(51.51, 1, 12);
  assert.ok(Math.abs(noon.elevation * DEG - 62) < 1, `got ${(noon.elevation * DEG).toFixed(1)}°`);
  assert.ok(Math.abs(compassOf(noon.azimuth) - 180) < 1, 'due south');
});

test('and over Sydney it is due north, which is the whole point of the latitude', () => {
  const noon = at(-33.87, 1, 12);
  assert.ok(Math.abs(noon.elevation * DEG - 79.6) < 1, `got ${(noon.elevation * DEG).toFixed(1)}°`);
  const compass = compassOf(noon.azimuth);
  assert.ok(compass < 1 || compass > 359, `due north, got ${compass.toFixed(0)}°`);
});

test('the sun goes round the other way south of the equator', () => {
  // North of it the sun tracks east → south → west, which is clockwise on a compass;
  // south of it, east → north → west, which is not.
  const sweep = (lat) => [9, 12, 15].map((h) => compassOf(at(lat, 1, h).azimuth));
  const [nMorning, , nAfternoon] = sweep(51.51);
  assert.ok(nMorning < 180 && nAfternoon > 180, 'London: east in the morning, west by three');
  const [sMorning, sNoon, sAfternoon] = sweep(-33.87);
  assert.ok(sMorning > sNoon && sAfternoon < 360 && sAfternoon > 180,
    'Sydney: the sun passes through the north');
});

test('winter days are short, and that is now allowed to be true', () => {
  // The fixed 06:00–20:00 window was kept precisely to avoid this. With a latitude
  // the office gets the day the latitude actually has.
  const summer = dayLength(51.51, declinationFor(1, 51.51));
  const winter = dayLength(51.51, declinationFor(-1, 51.51));
  assert.ok(Math.abs((summer.sunset - summer.sunrise) - 16.4) < 0.2, 'a London midsummer');
  assert.ok(Math.abs((winter.sunset - winter.sunrise) - 7.6) < 0.2, 'a London midwinter');
  assert.ok(winter.sunset < 16, 'and it is dark before four');
});

test('the tropics barely notice, which is also true', () => {
  const { sunrise, sunset } = dayLength(1.35, declinationFor(1, 1.35));
  assert.ok(Math.abs((sunset - sunrise) - 12) < 0.3, 'twelve hours all year on the equator');
});

test('past the arctic circle the sun stops rising and setting altogether', () => {
  assert.equal(dayLength(69.65, declinationFor(1, 69.65)).polar, 'day', 'Tromsø in summer');
  assert.equal(dayLength(69.65, declinationFor(-1, 69.65)).polar, 'night', 'Tromsø in winter');
  // And the scene has to survive it rather than dividing by a sunrise that never came.
  for (const h of [0, 6, 12, 18]) {
    const st = at(69.65, -1, h);
    assert.equal(st.isDay, false, `${h}:00 in a polar night is night`);
    assert.ok(Number.isFinite(st.position[1]) && st.position[1] > 0, 'and the light is still placed');
  }
  const summerMidnight = at(69.65, 1, 0);
  assert.equal(summerMidnight.isDay, true, 'the midnight sun is up at midnight');
});

test('a located room still turns under its sky', () => {
  const plain = at(51.51, 1, 12).azimuth * DEG;
  const turned = at(51.51, 1, 12, { bearing: 90 }).azimuth * DEG;
  let d = (turned - plain) % 360;
  if (d < 0) d += 360;
  assert.ok(Math.abs(d - 90) < 1e-6, 'the bearing means the same thing on both paths');
});

test('dropping a pin on London leaves midday where the tuned default put it', () => {
  // Deliberate: NORTH_AZIMUTH is chosen so that giving a room a northern latitude
  // changes the shape of its day without moving the middle of it.
  //
  // Each path's *own* midday, which is not the same clock reading: the authored
  // window runs 06:00–20:00 and so peaks at one, while a real sun peaks at noon.
  const authored = sunState(13, { sunElevation: 62 }).azimuth;
  const located = at(51.51, 1, 12).azimuth;
  assert.ok(Math.abs(authored - located) < 1e-9,
    `authored ${(authored * DEG).toFixed(2)}° vs located ${(located * DEG).toFixed(2)}°`);
});

test('a room with no latitude is left on the arc it always had', () => {
  const authored = sunState(15, { sunElevation: 62 });
  const alsoAuthored = sunState(15, { sunElevation: 62, lat: null, sunTilt: 1 });
  assert.deepEqual(alsoAuthored.position, authored.position);
});

test('no season sits on an equinox, because an equinox is a day and not a season', () => {
  // Spring and autumn were 0 — the equinox exactly — which gives every place on earth
  // twelve hours, the sun due east and due west, and a terminator that is not a curve
  // but a pair of straight meridians. Two seasons out of four drew a flat vertical
  // edge across the map and read as broken.
  for (const key of Object.keys(SEASONS)) {
    const tilt = SEASONS[key].sunTilt;
    assert.ok(Number.isFinite(tilt), `${key} has a tilt`);
    assert.ok(Math.abs(tilt) > 0.5, `${key} sits ${tilt} — too near an equinox`);
  }
});

test('spring and autumn are opposite halves of the same year', () => {
  assert.equal(SEASONS.spring.sunTilt, -SEASONS.autumn.sunTilt);
  // And between the equinox and the solstice, not past either: the middle of a season
  // is a quarter of the way round the year from the hinge.
  assert.ok(Math.abs(SEASONS.spring.sunTilt) < 1);
});

test('the shoulder seasons get days that are neither twelve hours nor a solstice', () => {
  const london = 51.51;
  const hours = (season) => {
    const { sunrise, sunset } = dayLength(london, declinationFor(SEASONS[season].sunTilt, london));
    return sunset - sunrise;
  };
  // A London autumn is a nine-hour day and a spring is a fifteen-hour one; twelve
  // hours is what the equinox gave both of them before.
  assert.ok(hours('autumn') > 8 && hours('autumn') < 10, `autumn ${hours('autumn').toFixed(1)}h`);
  assert.ok(hours('spring') > 14 && hours('spring') < 16, `spring ${hours('spring').toFixed(1)}h`);
  assert.ok(hours('winter') < hours('autumn'), 'and winter is still the shortest');
  assert.ok(hours('summer') > hours('spring'), 'and summer still the longest');
});

// --- crossing the equator ---------------------------------------------------

test('a room is northern until it is told otherwise', () => {
  // The authored arc and the map's night shading both read an absent latitude as
  // zero, so "nowhere in particular" has to count as the northern hemisphere or the
  // room would turn itself round on being taken off the map.
  assert.equal(hemisphereOf(null), 1);
  assert.equal(hemisphereOf(undefined), 1);
  assert.equal(hemisphereOf(0), 1, 'the equator counts as north, and either would do');
  assert.equal(hemisphereOf(51.5), 1);
  assert.equal(hemisphereOf(-33.87), -1);
  assert.equal(hemisphereOf(-0.0001), -1);
});

test('half a turn is exactly what the equator costs', () => {
  // The rule this justifies: crossing the equator adds 180° to the bearing. Check it
  // against the sun rather than against itself — a southern noon at the turned
  // bearing must point where a northern noon pointed at the original one.
  const north = sunState(12, { lat: 51.51, sunTilt: 1, bearing: 0 }).azimuth;
  const south = sunState(12, { lat: -33.87, sunTilt: 1, bearing: 180 }).azimuth;
  assert.ok(Math.abs(apart(north * DEG, south * DEG)) < 1e-9,
    `north ${(north * DEG).toFixed(2)}° vs turned south ${(south * DEG).toFixed(2)}°`);

  // And without the turn it is half a world away, which is the bug being fixed.
  const untuned = sunState(12, { lat: -33.87, sunTilt: 1, bearing: 0 }).azimuth;
  assert.ok(Math.abs(apart(north * DEG, untuned * DEG) - 180) < 1e-9);
});

test('a turn carries whatever bearing was already chosen', () => {
  // Not a reset: somebody who had turned the room to 40° should come out of the
  // crossing at 220°, still 40° off however the sun now runs.
  const chosen = sunState(12, { lat: 51.51, sunTilt: 1, bearing: 40 }).azimuth;
  const carried = sunState(12, { lat: -33.87, sunTilt: 1, bearing: 220 }).azimuth;
  assert.ok(Math.abs(apart(chosen * DEG, carried * DEG)) < 1e-9);
});
