// Scenes: what a room looks like, and the pools a new one is rolled from.
//
// An office is a keycard and a list of scenes (src/office.js); a *scene* is one
// room, and this is where a room's character is decided. The three records in
// PROJECTS are authored scenes — someone chose the tower's grey concrete and the
// warehouse's October — and they furnish the demo office. Every other scene in the
// system is rolled by `createScene()` from the same three pools.
//
// A look is composed from three independent layers rather than written out once
// per scene, because the scene panel lets you change season and building at
// runtime and a flat list of finished themes would need one entry per combination
// (4 seasons × 3 buildings × every interior = unmanageable):
//
//   SEASONS   — what it is like outside: sky, light rig, foliage, ground dressing
//   BUILDINGS — what we are standing in: storeys below, entrance, facade
//   THEMES    — the project's own character: floor finish, wall colours, interior
//
// `resolveTheme()` flattens the three into the single object `buildEnvironment()`
// consumes. Palettes merge base → season → building → theme, so a project can
// always override anything, and the three layers keep to their own (largely
// disjoint) sets of keys.

import { pick } from './dice.js';
import { building as tideBuilding, theme as tideTheme } from './office-styles/tide.js';
import { building as duneBuilding, theme as duneTheme } from './office-styles/dune.js';
import { building as lanternBuilding, theme as lanternTheme } from './office-styles/lantern.js';

/** Exterior modes. Each is built by the outlook registry (scene/outlooks/index.js), which validates this list against itself at first import. */
export const OUTSIDE_MODES = [
  'street-summer', 'street-autumn', 'street-winter', 'street-spring', 'skyline-high',
  // The prototype outlook, forced by the mansard.
  'paris-rooftops',
  'canopy-garden',
  'tide-harbour', 'dune-courtyard', 'lantern-garden',
];

// ---------------------------------------------------------------------------
// Seasons

/**
 * @typedef {object} Season
 * @property {string} label
 * @property {string} street       exterior mode used when the building is on a street
 * @property {number} sky          daylight sky colour
 * @property {object} light        hemi + fill rig; the sun comes from the clock
 * @property {number} sunElevation peak sun elevation in degrees, for a room that has
 *   not been put anywhere — a room with a latitude derives this instead
 * @property {number} sunTilt      where in the year this season sits, as a fraction of
 *   the sun's full swing: 1 at midsummer, −1 at midwinter, 0 at an equinox. The
 *   hemisphere turns it over, so "summer" is June in London and December in Sydney
 *   (scene/lighting.js). A season is three months, so what belongs here is the
 *   *middle* of one — see MID_SEASON below
 * @property {number} sunWarmth    0 = neutral daylight, 1 = very warm
 * @property {object} palette      exterior dressing only
 */

/**
 * Where the sun stands in the middle of a spring or an autumn.
 *
 * These two used to sit at 0 — the equinox exactly — which is the one day of the three
 * months when the sun rises due east, sets due west, and gives every place on earth
 * twelve hours. It is also the one day whose terminator is not a curve but a pair of
 * straight meridians, so the map drew a flat vertical edge in two seasons out of four
 * and looked broken in both.
 *
 * The middle of a season is about forty-five days from the equinox, a quarter of the
 * way round the year, and the sun's declination there is sin(45°) of its full swing.
 * So: not the hinge between two seasons, but the middle of the one being named.
 */
const MID_SEASON = 0.71;

/** @type {Record<string, Season>} */
export const SEASONS = {
  summer: {
    label: 'Summer',
    street: 'street-summer',
    sky: 0xbcd3dd,
    sunElevation: 62,
    sunTilt: 1,
    sunWarmth: 0.45,
    light: {
      hemi: { sky: 0xdfe9ef, ground: 0xb08a5a, intensity: 1.1 },
      fill: { color: 0xfff1dd, intensity: 0.65, position: [20, 12, 18] },
    },
    palette: {},
  },

  autumn: {
    label: 'Autumn',
    street: 'street-autumn',
    sky: 0xe8c49a,
    // Low sun and the warmest of the four — this is the golden-hour season.
    sunElevation: 34,
    sunTilt: -MID_SEASON,
    sunWarmth: 0.95,
    light: {
      hemi: { sky: 0xf3dcc4, ground: 0x8a6a4c, intensity: 1.0 },
      fill: { color: 0xffdcb4, intensity: 0.70, position: [18, 9, 16] },
    },
    palette: {
      grass: 0x9a9257,
      leaf: 0xd98324,
      leafDark: 0x8c3b16,
      sky: 0xe8c49a,
    },
  },

  winter: {
    label: 'Winter',
    street: 'street-winter',
    sky: 0xdae4ea,
    // Barely gets up: long shadows all day, and cold.
    sunElevation: 22,
    sunTilt: -1,
    sunWarmth: 0.10,
    light: {
      hemi: { sky: 0xe8f0f5, ground: 0x9aa3ab, intensity: 1.2 },
      fill: { color: 0xffeedd, intensity: 0.60, position: [20, 12, 18] },
    },
    palette: {
      grass: 0xeef3f6,
      leaf: 0x3f6b4f,
      leafDark: 0x2f5540,
      road: 0x7d8288,
      roadLine: 0xd8d5c8,
      sidewalk: 0xd9dce0,
      curb: 0xc2c6ca,
      buildingA: 0x8a6354,
      buildingB: 0x81868d,
      buildingC: 0x9a8878,
      buildingD: 0x68757c,
      windowLit: 0xffd894,
      sky: 0xdae4ea,
    },
  },

  spring: {
    label: 'Spring',
    // Spring reuses the summer street geometry: the difference is blossom on the
    // trees, petals on the ground and fresher grass — palette plus a scatter of
    // litter, so there is no second copy of the park to keep in step.
    street: 'street-spring',
    sky: 0xc8dcea,
    sunElevation: 50,
    sunTilt: MID_SEASON,
    sunWarmth: 0.30,
    light: {
      hemi: { sky: 0xe4eef4, ground: 0x9fb388, intensity: 1.1 },
      fill: { color: 0xf6f7ea, intensity: 0.66, position: [20, 13, 18] },
    },
    palette: {
      grass: 0x86bb64,
      // Blossom rather than foliage: the tree builder reads these two, so a pink
      // pair turns every summer tree into a cherry in flower.
      leaf: 0xf3c2d5,
      leafDark: 0xdb9cb6,
      autumnLitter: 0xf0c4d6,   // fallen petals reuse the litter scatter
      sky: 0xc8dcea,
    },
  },
};

export const SEASON_LIST = Object.keys(SEASONS);

// ---------------------------------------------------------------------------
// Buildings

/**
 * @typedef {object} Building
 * @property {string} label
 * @property {string} subtitle        short description shown on hover in the picker
 * @property {number} storeysBelow  complete levels below the cutaway floor
 * @property {boolean} plinth       diorama base slab (only for a ground floor)
 * @property {'stoop'|'stairs'|'elevator'|'hatch'} entrance
 * @property {'glazed'|'solid'|'punched'} lowerWalls  facade treatment for
 *   those levels
 * @property {boolean} serviceYard  concrete apron + driveway for loading doors
 * @property {'ground'|'high'} elevation
 * @property {string|null} outside  forced exterior mode, ignoring the season's
 *   street: a tower floor looks out over rooftops whatever the month.
 * @property {'gable'|'mansard'|null} [roof]  pitched roof over the two standing
 *   walls; see scene/building.js -> buildRoof()
 * @property {object} palette       facade colours
 */

/** @type {Record<string, Building>} */
export const BUILDINGS = {
  tide: tideBuilding,
  dune: duneBuilding,
  lantern: lanternBuilding,
  canopy: {
    label: 'Canopy House',
    subtitle: 'A light-filled office among the trees',
    storeysBelow: 0,
    plinth: false,
    entrance: 'stoop',
    lowerWalls: 'solid',
    serviceYard: false,
    elevation: 'ground',
    outside: 'canopy-garden',
    palette: {},
  },
  simple: {
    label: 'Alder Street',
    subtitle: 'A brownstone beside a leafy city park',
    storeysBelow: 0,
    plinth: true,
    entrance: 'stoop',
    lowerWalls: 'solid',
    serviceYard: false,
    elevation: 'ground',
    outside: null,
    palette: {},
  },

  warehouse: {
    label: 'Foundry Loft',
    subtitle: 'Brick, timber and industrial character',
    // Top floor of two: the storey below is the warehouse's ground level.
    storeysBelow: 1,
    plinth: false,
    entrance: 'stairs',
    lowerWalls: 'solid',
    serviceYard: true,
    elevation: 'high',
    outside: null,
    palette: {
      // Warm red brick, after the San Francisco warehouse references: brick
      // arcades, corbelled cornice, painted ghost sign.
      facadeLower: 0xa2624a,
      slabEdge: 0x9a5c42,
      brickPier: 0x8f5540,
      brickShade: 0x854d36,
      baseCourse: 0x8d8f93,
      signPaint: 0xded8cb,
      // Grey steel loading doors against the brick, with dark steel window
      // frames — the industrial read the ground floor needs.
      shutter: 0x8b9096,
      shutterRib: 0x74797f,
      windowFrame: 0x4a4038,
    },
  },

  skyscraper: {
    label: 'Kestrel Tower',
    subtitle: 'Glass, sky and gardens above the city',
    // Enough levels to establish that this floor is a long way up.
    storeysBelow: 3,
    plinth: false,
    // A tower floor is reached by lift, not a front door.
    entrance: 'elevator',
    lowerWalls: 'glazed',
    serviceYard: false,
    elevation: 'high',
    outside: 'skyline-high',
    palette: {
      // Curtain wall after the tower references: blue-green solar glass, dark
      // spandrels at every floor line, bright anodised mullions between.
      windowDark: 0x2b3d4e,
      spandrel: 0x2c3742,
      mullion: 0xc3cad0,
      slabEdge: 0x8d949a,
      facadeLower: 0x3a444e,
      buildingA: 0x8d949c,
      buildingB: 0x7e858d,
      buildingC: 0x99a1a8,
      buildingD: 0x6c757d,
    },
  },

  // -------------------------------------------------------------------------
  // Prototype.
  //
  // Taken far enough to be *looked at* and no further, so we can find out
  // whether it is worth finishing: punched masonry, and a walk-up stair
  // behind a glazed landing at the top of a city block. It shares the floor
  // plan with everything else, because that is not negotiable — see "What is
  // deliberately not themeable" in the docs.

  mansard: {
    label: 'Rue Dauphine',
    subtitle: 'A Parisian studio above the rooftops',
    // Top floor of three, over the rooftops of a city that is nearly all this
    // height — which is why the outlook is roofs at eye level rather than a street
    // far below.
    storeysBelow: 2,
    plinth: false,
    // A walk-up, the same as the warehouse's own external flight — not a lobby
    // with a lift. The glazing that turns this into a stairwell rather than a
    // plain fire escape is built by buildEnvironment() itself, keyed off the
    // building name, because it means pushing part of the back wall back and
    // that is not expressible as a building/theme data field.
    entrance: 'stairs',
    lowerWalls: 'punched',
    serviceYard: false,
    elevation: 'high',
    outside: 'paris-rooftops',
    roof: 'mansard',
    palette: {
      // Zinc over limestone, with the ironwork dark against it.
      roofPlane: 0x8d9299,
      roofTrim: 0x767c83,
      facadeLower: 0xd6cab2,
      baseCourse: 0xe0d6c0,
      slabEdge: 0xc9bda6,
      windowFrame: 0x3b3a36,
      windowDark: 0x384654,
      metalDark: 0x2f3238,
      chimneyPot: 0xb2643f,
    },
  },
};

export const BUILDING_LIST = Object.keys(BUILDINGS);

// Display order is independent of the pool used when rolling a random office.
export const BUILDING_ORDER = [
  'simple', 'warehouse', 'mansard', 'tide', 'canopy', 'skyscraper', 'lantern', 'dune',
];

// ---------------------------------------------------------------------------
// Themes: a project's interior character, plus its default season and building.

/**
 * @typedef {object} Theme
 * @property {string} label            human name for the look
 * @property {{kind: string, plankWidth?: number, tileSize?: number}} floor
 * @property {string} season           key into SEASONS
 * @property {string} building         key into BUILDINGS
 * @property {string} [signText]       painted signage, for masonry facades
 * @property {number} [sky]            override the season's sky
 * @property {object} [light]          override parts of the season's rig
 * @property {object} [fittings]       ceiling lighting after dark
 * @property {object} palette          interior colours
 */

/** @type {Record<string, Theme>} */
export const THEMES = {
  tide: tideTheme,
  dune: duneTheme,
  lantern: lanternTheme,
  canopy: {
    label: 'Canopy House · timber and foliage',
    floor: { kind: 'oak' },
    season: 'summer',
    building: 'canopy',
    fittings: { cols: 3, rows: 2, colour: 0xffdea4, intensity: 53, poolRadius: 6.5, poolOpacity: .16 },
    sky: 0xd1d8bb,
    light: {
      hemi: { sky: 0xe8efdc, ground: 0x96825c, intensity: .62 },
      fill: { color: 0xffedcd, intensity: .30, position: [20, 13, 17] },
    },
    palette: {
      wallSage: 0x5b6845, wallWhite: 0x556443, baseboard: 0x846740,
      frame: 0x49503d, glass: 0xbbcfb1, woodDark: 0x654b31,
      woodMid: 0xac7d48, rugSage: 0xa49f7d,
      couch: 0x6d7950, terracotta: 0xb77d52,
      floorWood: 0xc8a373, floorWoodAlt: 0xbd9667,
    },
  },
  // The original: warm brownstone on a leafy street corner.
  brownstone: {
    label: 'Alder Street · warm wood',
    floor: { kind: 'plank', plankWidth: 1.6 },
    season: 'summer',
    building: 'simple',
    // Soft warm domestic fittings, evenly spread.
    fittings: { cols: 3, rows: 2, colour: 0xffe6c4, intensity: 55, poolRadius: 6.5, poolOpacity: 0.20 },
    palette: {},
  },

  // Same street, deep winter. The interior goes warmer and softer to contrast
  // with the cold outside.
  snowfall: {
    label: 'Alder Street · winter',
    floor: { kind: 'carpet', tileSize: 2.4 },
    season: 'winter',
    building: 'simple',
    // Dimmer and warmer than summer, and pooling wider: the point of the room in
    // winter is that it looks like somewhere you would rather be than outside.
    fittings: { cols: 3, rows: 2, colour: 0xffd9a8, intensity: 46, poolRadius: 7.2, poolOpacity: 0.24 },
    palette: {
      wallSage: 0x9aa896,
      wallWhite: 0xf1ece1,
      baseboard: 0xf6f2ea,
      floorCarpet: 0x8f7f6e,
      floorCarpetAlt: 0x87786a,
      rugSage: 0xb9a894,
      couch: 0xc4785e,
    },
  },

  // Level 34 of a glass tower: polished concrete, cool grey walls, and a sea of
  // rooftops below instead of a street.
  tower: {
    label: 'Kestrel Tower · level 34',
    floor: { kind: 'concrete', tileSize: 6 },
    season: 'summer',
    building: 'skyscraper',
    // Recessed office fluorescents: cool, flat, more of them, and tight pools —
    // commercial lighting that is trying to be even rather than atmospheric.
    fittings: { cols: 4, rows: 2, colour: 0xe2edf8, intensity: 60, poolRadius: 5.8, poolOpacity: 0.15 },
    sky: 0xa9c6dd,
    light: {
      // Bright and neutral — nothing is shading this floor.
      hemi: { sky: 0xd7e6f2, ground: 0x8f949a, intensity: 0.65 },
      fill: { color: 0xeaf2fa, intensity: 0.40, position: [20, 16, 18] },
    },
    palette: {
      wallSage: 0x8f979e,
      wallWhite: 0xf4f5f7,
      baseboard: 0xe4e7ea,
      frame: 0x3a3f45,
      glass: 0xa8c8dc,
      rugSage: 0x8fa2ad,
      woodMid: 0x7d6650,
    },
  },

  // Dark stained boards, deep sage, long warm light.
  studio: {
    label: 'Foundry Loft · top floor',
    floor: { kind: 'plank', plankWidth: 1.1 },
    season: 'autumn',
    building: 'warehouse',
    // Industrial high bays: few, strong, warm, thrown wide. A warehouse is lit by
    // a handful of hard lamps a long way up, not a grid of soft ones.
    fittings: { cols: 2, rows: 2, colour: 0xffd49a, intensity: 88, poolRadius: 8.4, poolOpacity: 0.26 },
    // Painted ghost sign across the brick, as on the reference warehouses.
    signText: 'LOOM STUDIO',
    palette: {
      wallSage: 0x6f7b74,
      wallWhite: 0xe4dcc9,
      baseboard: 0xeae2d2,
      floorWood: 0x8a6b46,
      floorWoodAlt: 0x7c5f3d,
      woodDark: 0x53372a,
      woodMid: 0x744d30,
      rugSage: 0x94a08c,
      couch: 0xc07a5c,
      terracotta: 0xc06c45,
    },
  },

  // -------------------------------------------------------------------------
  // Prototype interior, for the one prototype building. Cheap by design: a
  // floor finish, a palette and a lighting rig, which between them is most of
  // what makes a room feel like somewhere. Nothing here adds a prop or moves
  // a station.

  // Under the zinc: pale plaster, narrow boards and black steel — a studio at the
  // top of a city block.
  atelier: {
    label: 'Rue Dauphine · pale plaster',
    floor: { kind: 'plank', plankWidth: 0.9 },
    season: 'autumn',
    building: 'mansard',
    fittings: { cols: 3, rows: 2, colour: 0xffeccb, intensity: 58, poolRadius: 6.8, poolOpacity: 0.20 },
    // A little more ambient than autumn gives by default. Limestone is only cream in
    // light; under the warehouse's raking golden hour a whole city of it reads brown.
    light: {
      hemi: { sky: 0xf2ecdd, ground: 0xc9bda6, intensity: 0.74 },
      fill: { color: 0xfff2dc, intensity: 0.3, position: [20, 11, 17] },
    },
    palette: {
      wallSage: 0xb9bdb4,
      wallWhite: 0xf0ece2,
      baseboard: 0xf6f3ea,
      floorWood: 0xb9925f,
      floorWoodAlt: 0xad8755,
      frame: 0x3b3a36,
      woodDark: 0x4e4437,
      woodMid: 0x7c6647,
      rugSage: 0x9aa3a0,
      couch: 0x6d7f6a,        // velvet, in the green everything in Paris is
      terracotta: 0xbf6f4c,
    },
  },
};

/**
 * @typedef {object} Project
 * @property {string} id
 * @property {string} name      shown in the switcher
 * @property {string} building  flavour text for the switcher
 * @property {string} floorName flavour text for the switcher
 * @property {string} theme     key into THEMES
 * @property {{startCount: number}} agents  how many file in when the office opens. How
 *   many it can hold is not written here: it is the number of desks in the room (see
 *   `agentCapacity()` in config.js), which used to be repeated as a `maxAgents` beside
 *   this and agreed with the desk list only by coincidence.
 * @property {?string} source    which feed fills this scene (src/data/sources.js);
 *   the authored three are Test Data, so the app is watchable with nothing installed
 * @property {{season: string, building: string}} [look]  the season and building it
 *   opens with; every scene has one, authored or rolled
 * @property {boolean} [custom]  true for scenes rolled by createScene()
 */

/**
 * The authored scenes: three tenants, one per building, one per season that
 * building can show.
 *
 * They furnish the demo office at /office/TEST-0000 and exist to be *looked at* —
 * so between them they cover every interior in THEMES that a building is native to,
 * and every outlook the seasons produce. Each carries an explicit `look`, which is
 * what a rolled scene gets from the pools; the difference is only that someone chose
 * these on purpose.
 *
 * @type {Project[]}
 */
export const PROJECTS = [
  {
    id: 'startup-ai',
    name: 'Startup.AI',
    building: BUILDINGS.simple.label,
    floorName: 'Ground floor · July',
    theme: 'brownstone',
    look: { season: 'summer', building: 'simple' },
    agents: { startCount: 3 },
    sources: ['test-data'],
  },
  {
    id: 'initech-llc',
    name: 'Initech LLC',
    building: BUILDINGS.skyscraper.label,
    // No season in the name: a tower is never on a street, so its winter is
    // something you would have to take on trust. Same rule as createScene().
    floorName: 'Level 34',
    theme: 'tower',
    look: { season: 'winter', building: 'skyscraper' },
    agents: { startCount: 4 },
    sources: ['test-data'],
  },
  {
    id: 'dotcom-bcorp',
    name: 'Dot.com BCorp',
    building: BUILDINGS.warehouse.label,
    floorName: 'Upper floor · October',
    theme: 'studio',
    look: { season: 'autumn', building: 'warehouse' },
    agents: { startCount: 2 },
    sources: ['test-data'],
  },

  // ---- Prototype ----------------------------------------------------------
  // The experiment, in the demo office so it can be walked round and argued
  // about. It is a scene like any other; the only thing that marks it out is
  // that it is not finished yet.
  {
    id: 'proto-atelier',
    name: 'Atelier Marchand',
    building: BUILDINGS.mansard.label,
    floorName: 'Top floor · October',
    theme: 'atelier',
    look: { season: 'autumn', building: 'mansard' },
    agents: { maxAgents: 5, startCount: 3 },
    sources: ['test-data'],
  },
];

/**
 * Build a record for a scene created at runtime.
 *
 * The three scenes above are authored: someone chose the brownstone's summer street
 * and the tower's grey concrete. A rolled scene has no author, so it rolls for a
 * building and a season and takes the interior that building is native to — which
 * is what keeps a warehouse exterior from ending up around a brownstone floor (the
 * same reasoning as NATIVE_THEME below).
 *
 * `look` rides along on the record so main.js can apply it as the scene's own
 * season/building overrides, instead of the world being rebuilt into whatever
 * the scene panel last had set. It is also what gets stored for the scene, so
 * the room comes back the way you left it.
 *
 * @param {object} [opts]
 * @param {string} [opts.id]
 * @param {string} [opts.name]
 * @param {string} [opts.season]    defaults to a random season
 * @param {string} [opts.building]  defaults to a random building
 * @param {string[]} [opts.sources]  source ids; a stored scene brings its own
 */
export function createScene({
  // A timestamp alone is not unique: two scenes created in the same millisecond
  // would share an id, and the second would silently edit the first.
  id = `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  name = 'New scene',
  season = pick(SEASON_LIST),
  building = pick(BUILDING_LIST),
  sources = [],
} = {}) {
  const themeKey = NATIVE_THEME[building] ?? 'brownstone';
  const b = BUILDINGS[building] ?? BUILDINGS.simple;
  const s = SEASONS[season] ?? SEASONS.summer;

  return {
    id,
    name,
    building: b.label,
    // Elevation gives the floor its name; the season is only worth mentioning if
    // you can actually see it. A building that forces its own outlook (the tower's
    // skyline) never shows a street, so naming its season there would be a lie —
    // but the warehouse is an upper floor that *does* look out onto one.
    floorName: b.outside
      ? floorWord(b)
      : `${floorWord(b)} · ${s.label}`,
    theme: themeKey,
    agents: { startCount: 2 },
    sources,
    look: { season, building },
    custom: true,
  };
}

function floorWord(building) {
  return building.elevation === 'high' ? 'Upper floor' : 'Ground floor';
}

/**
 * The theme authored for each building, used when the scene panel forces a
 * building the project was not written for.
 *
 * Without this, overriding the building swapped the shell, the facade below and
 * the whole street — and left the floor you are actually standing on untouched,
 * so a warehouse exterior sat around a brownstone interior. Pointing at the
 * native theme rather than restating its colours keeps one definition of what a
 * warehouse floor looks like.
 */
const NATIVE_THEME = {
  tide: 'tide',
  dune: 'dune',
  lantern: 'lantern',
  canopy: 'canopy',
  simple: 'brownstone',
  warehouse: 'studio',
  skyscraper: 'tower',
  mansard: 'atelier',
};

/** A project's own theme record, before season and building are folded in. */
export function getTheme(project) {
  return THEMES[project?.theme] ?? THEMES.brownstone;
}

/**
 * Flatten project + season + building into the theme `buildEnvironment()` wants.
 *
 * @param {object} project
 * @param {{season?: string, building?: string, bearing?: number, lat?: number,
 *   lon?: number}} [overrides] from the scene panel
 */
export function resolveTheme(project, overrides = {}) {
  const theme = getTheme(project);
  const seasonKey = SEASONS[overrides.season] ? overrides.season : theme.season;
  const buildingKey = BUILDINGS[overrides.building] ? overrides.building : theme.building;
  const season = SEASONS[seasonKey];
  const building = BUILDINGS[buildingKey];

  // Forcing a building the project was not written for swaps the interior too.
  // The building is the floor you stand on as much as the facade outside it, so
  // changing one without the other leaves a warehouse wrapped round a brownstone.
  const swapped = buildingKey !== theme.building;
  const interior = swapped ? (THEMES[NATIVE_THEME[buildingKey]] ?? theme) : theme;

  return {
    label: swapped ? `${interior.label} (in ${building.label})` : theme.label,
    floor: interior.floor,
    season: seasonKey,
    building: buildingKey,

    // A building may insist on its own outlook — a tower is never on a street —
    // otherwise the season decides which street we get.
    outside: building.outside ?? season.street,
    elevation: building.elevation,
    storeysBelow: building.storeysBelow,
    plinth: building.plinth,
    entrance: building.entrance,
    lowerWalls: building.lowerWalls,
    serviceYard: building.serviceYard,
    // Only ever over the two standing walls, so it never becomes a lid on the room.
    roof: building.roof ?? null,
    // Signage only makes sense on masonry, so it is dropped for a curtain wall
    // rather than quietly painting a ghost sign onto glass.
    signText: building.lowerWalls === 'solid' ? (interior.signText ?? null) : null,

    sky: interior.sky ?? season.sky,
    // The sun is deliberately absent: it is derived from the clock at runtime
    // (scene/lighting.js), with these two numbers shaping how high it climbs and
    // how warm it gets in this season.
    sunElevation: season.sunElevation,
    sunWarmth: season.sunWarmth,
    // Which way this room faces, in degrees, turning the sun's whole arc with it.
    // A season decides how high the sun climbs; this decides where it climbs, and
    // is the one part of the light a person picks rather than inherits.
    bearing: Number.isFinite(overrides.bearing) ? overrides.bearing : (theme.bearing ?? 0),

    // And where on earth it is standing, which is what turns the two numbers above
    // into a real sky. Null is the ordinary case — most rooms are never put
    // anywhere, and those keep the authored arc and `sunElevation` above. A
    // latitude replaces both with the sun that latitude actually gets, including
    // how long its day lasts. See scene/lighting.js.
    lat: Number.isFinite(overrides.lat) ? overrides.lat : (theme.lat ?? null),
    lon: Number.isFinite(overrides.lon) ? overrides.lon : (theme.lon ?? null),
    sunTilt: season.sunTilt ?? 0,
    light: {
      hemi: { ...season.light.hemi, ...(interior.light?.hemi ?? {}) },
      fill: { ...season.light.fill, ...(interior.light?.fill ?? {}) },
    },

    // Ceiling lighting after dark, falling back to the brownstone's soft warm grid
    // for any theme that does not specify its own.
    fittings: { ...THEMES.brownstone.fittings, ...(interior.fittings ?? {}) },

    palette: { ...season.palette, ...building.palette, ...interior.palette },
  };
}
