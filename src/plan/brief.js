// The brief: what this office *is*, before anything is put anywhere.
//
// A test fit is the cheapest insurance in space planning, and the reason is that
// it comes second. First somebody writes down a programme — how many people, in
// what teams, with what support space — and only then is it laid onto a floor
// plate to find out whether it fits. This module is the programme, and
// `furnish.js` is the test fit.
//
// Every number here is a draw from this seed's `brief` stream, in a fixed order,
// so the brief is the seed's and nothing else's. Nothing here knows the room is
// 26 by 20: a brief is what the office wants, and the floor plate gets its say
// afterwards — which is why `furnish.js` may hand back fewer desks than were
// asked for and say so.

import { streamFor } from './rng.js';

/**
 * How the desks are arranged. Five, and each is a real arrangement with a real
 * argument for it rather than five ways of scattering furniture.
 *
 * `minDesks` is what the shape needs before it means anything: a pod is a team
 * facing each other, so two desks is not a pod, it is a pair.
 *
 * `weight` is how often the roll lands here. Rows and pods carry most of it
 * because most offices are one or the other; the island is deliberately rare,
 * because a single block of desks in the middle of the floor is a strong room
 * and a strong room every third time is a mannerism.
 */
export const TYPOLOGIES = {
  rows: {
    label: 'rows',
    weight: 26,
    minDesks: 2,
    // Long benches all facing the same way: the densest arrangement there is, and
    // the one that reads as a room with a front.
    note: 'benches all facing one way',
  },
  pods: {
    label: 'pods',
    weight: 30,
    minDesks: 4,
    // Clusters of four to six are the sweet spot for team work: tight enough to
    // talk across, separate enough not to be one open field of desks.
    note: 'clusters of desks, screens meeting in the middle',
  },
  spine: {
    label: 'spine',
    weight: 18,
    minDesks: 4,
    // One long back-to-back run down the room, with the walking lane either side
    // of it — the arrangement a service spine produces when the power and data
    // come up the middle.
    note: 'one long back-to-back run down the room',
  },
  perimeter: {
    label: 'perimeter',
    weight: 16,
    minDesks: 3,
    // Desks pushed out to the walls, faces to the daylight, and the whole middle
    // of the floor left over. Expensive in frontage, generous in floor.
    note: 'desks at the walls, the floor left open',
  },
  island: {
    label: 'island',
    weight: 10,
    minDesks: 4,
    // Everybody around one block in the middle. A small team's room.
    note: 'one block of desks in the middle of the floor',
  },
};

/**
 * How many desks, and so how many people (`agentCapacity()` is the desk count).
 *
 * Weighted towards the sizes that make a *room* rather than towards the middle of
 * the possible range: four to nine is an office you can see the shape of at a
 * glance, and the tails are worth having because a two-desk back room and a
 * fourteen-desk floor are both real offices and both look nothing like the mean.
 */
const DESK_COUNTS = [
  [2, 3], [3, 7], [4, 11], [5, 13], [6, 14], [7, 12], [8, 11],
  [9, 8], [10, 6], [11, 4], [12, 3], [13, 2], [14, 2],
];

/**
 * How work gets in and out, which is the one thing an office cannot do without.
 *
 * `intake` and `dispatch` are two of the four roles a room must have somewhere to
 * do (`JOB_ROLES` in src/layout.js), and the kinds that can do them differ in
 * *character*, not only in count — so this is a table of characters rather than
 * three independent counts. A post room is a room the courier visits; a paperless
 * floor faxes everything and has no letterbox at all; a depot is two boxes and a
 * pile of stock because the work arrives faster than one box can hold it.
 *
 * Every entry has to satisfy both roles by itself, because the alternative is a
 * room where finished work has nowhere to go. The inbox is intake only — a stack
 * of boxes is somewhere to take work *from* — so no character may consist of one.
 * `test/plan-generator.test.js` holds that down against the real role tables
 * rather than trusting this comment.
 */
export const POST_CHARACTERS = {
  'post-room': {
    label: 'post room',
    weight: 26,
    mailboxes: 1, printers: 0, inboxes: 1, courier: true,
    blurb: 'work comes in by post and leaves the same way',
  },
  mixed: {
    label: 'post and print',
    weight: 24,
    mailboxes: 1, printers: 1, inboxes: 0, courier: true,
    blurb: 'a letterbox at one end and a printer at the other, so finished work leaves by whichever is nearer',
  },
  paperless: {
    label: 'paperless',
    weight: 14,
    mailboxes: 0, printers: 1, inboxes: 0, courier: false,
    blurb: 'no letterbox at all: everything faxes in and out of the one machine',
  },
  depot: {
    label: 'depot',
    weight: 12,
    mailboxes: 2, printers: 0, inboxes: 1, courier: true,
    blurb: 'two post boxes and a stack of stock, because one box could not hold the day',
  },
  'print-shop': {
    label: 'print shop',
    weight: 10,
    mailboxes: 0, printers: 2, inboxes: 1, courier: false,
    blurb: 'two printers and a pile of stock, and not a letter in the building',
  },
  'letters-only': {
    label: 'letters only',
    weight: 8,
    mailboxes: 1, printers: 0, inboxes: 0, courier: false,
    blurb: 'one letterbox and no courier — everything that arrives flies in through a window',
  },
  wharf: {
    label: 'wharf',
    weight: 6,
    mailboxes: 2, printers: 1, inboxes: 1, courier: true,
    blurb: 'every way in the building has: two boxes, a printer and a stack of stock',
  },
};

/**
 * Where things get looked up.
 *
 * The two research stations answer different questions — the shelf is what the
 * company knows, the telescope is what is outside the building (`serves: graph`
 * against `serves: web` in `STATION_KINDS`) — so a room with only one of them is
 * a room with an opinion, and both is a room that can answer either without
 * walking to the wrong prop.
 */
export const RESEARCH_CHARACTERS = {
  library: { label: 'library', weight: 34, bookshelves: 2, telescope: false },
  reference: { label: 'reference shelf', weight: 26, bookshelves: 1, telescope: false },
  observatory: { label: 'observatory', weight: 16, bookshelves: 0, telescope: true },
  'both-ways': { label: 'shelf and telescope', weight: 18, bookshelves: 1, telescope: true },
  'great-library': { label: 'great library', weight: 6, bookshelves: 3, telescope: true },
};

/**
 * The break end of the room: what there is to drink and what there is to sit on.
 *
 * `refresh` is not a required role — an office with nothing to drink is a poorer
 * office and a working one — so a dry floor is a real draw, just a rare one.
 */
const REFRESH = {
  both: { label: 'coffee and water', weight: 52, coffee: true, cooler: true },
  coffee: { label: 'coffee only', weight: 26, coffee: true, cooler: false },
  water: { label: 'water only', weight: 16, coffee: false, cooler: true },
  dry: { label: 'nothing to drink', weight: 6, coffee: false, cooler: false },
};

// **Weighted towards somewhere to sit *with* somebody.** A one-seat lounge cannot
// be a group, and a group is what the labelling says people are looking at: the
// judge's `together` carries its heaviest weight on the strength of +0.251 pooled
// over three rounds, and a lone armchair scores 0.6 on it by definition. A reading
// corner used to be the most likely room in the building at weight 26, which is a
// lot of offices whose only soft seat has nothing to face.
const LOUNGES = {
  none: {
    label: 'no lounge', weight: 6, couches: 0, armchairs: 0, tables: 0, lamps: 0,
  },
  reading: {
    label: 'a reading corner', weight: 14, couches: 1, armchairs: 0, tables: 1, lamps: 1,
  },
  snug: {
    label: 'a snug', weight: 26, couches: 1, armchairs: 1, tables: 1, lamps: 1,
  },
  parlour: {
    label: 'a parlour', weight: 18, couches: 2, armchairs: 0, tables: 2, lamps: 1,
  },
  'two-chairs': {
    label: 'two armchairs', weight: 18, couches: 0, armchairs: 2, tables: 1, lamps: 1,
  },
  lounge: {
    label: 'a proper lounge', weight: 18, couches: 2, armchairs: 2, tables: 2, lamps: 2,
  },
};

const PLANTING = {
  spare: { label: 'spare', weight: 16, plants: [1, 2] },
  planted: { label: 'planted', weight: 34, plants: [3, 4] },
  leafy: { label: 'leafy', weight: 30, plants: [5, 6] },
  jungle: { label: 'a jungle', weight: 16, plants: [7, 9] },
  bare: { label: 'bare', weight: 4, plants: [0, 0] },
};

/**
 * The colour schemes, one per building and season, each with the rug and the
 * upholstery that go with it.
 *
 * **Why a table and not a colour wheel.** Most of a room's colour is not the
 * layout's to choose: the walls, the floor finish and the light come from the
 * theme, and the theme comes from the building (`NATIVE_THEME` in
 * src/projects.js). What a *layout* paints is the rug and the soft furniture —
 * and those are the two things in the room that have to agree with everything
 * already decided. Moss velvet on stained warehouse boards under an October sun
 * is a scheme; the same green in the tower's grey daylight is a mistake. That
 * judgement does not come out of a hue rotation, which is exactly the argument
 * `SOFA_COLORS` in src/config.js already makes about its own accents.
 *
 * So: sixteen schemes, the whole grid of four buildings by four seasons, each
 * paired by hand and each named for what it is. `accent` is the second
 * upholstery colour, for a room with an armchair as well as a couch — a suite
 * that matches and a chair that does not are both real rooms, and the roll
 * between them is in `brief()` below.
 *
 * Rug and sofa names are keys into `RUG_COLORS` and `SOFA_COLORS`;
 * `test/plan-brief.test.js` checks every one of them against those tables, so a
 * colour renamed there cannot leave a scheme pointing at nothing.
 */
export const SCHEMES = {
  'high-summer': {
    label: 'High Summer', building: 'simple', season: 'summer',
    rug: 'sage', sofa: 'terracotta', accent: 'moss',
    note: 'warm brownstone wood under a leafy July street',
  },
  'indian-summer': {
    label: 'Indian Summer', building: 'simple', season: 'autumn',
    rug: 'sand', sofa: 'mustard', accent: 'terracotta',
    note: 'the same boards gone amber with the trees outside',
  },
  'first-frost': {
    label: 'First Frost', building: 'simple', season: 'winter',
    rug: 'clay', sofa: 'navy', accent: 'blush',
    note: 'a warm room with a cold street through the glass',
  },
  'blossom-street': {
    label: 'Blossom Street', building: 'simple', season: 'spring',
    rug: 'sand', sofa: 'blush', accent: 'moss',
    note: 'pale wood, cherry blossom, everything a shade lighter',
  },
  'long-shadows': {
    label: 'Long Shadows', building: 'warehouse', season: 'autumn',
    rug: 'clay', sofa: 'mustard', accent: 'terracotta',
    note: 'dark stained boards raked by a golden hour',
  },
  'loading-bay': {
    label: 'Loading Bay', building: 'warehouse', season: 'summer',
    rug: 'slate', sofa: 'charcoal', accent: 'mustard',
    note: 'industrial greys against the brick and the deep sage',
  },
  'cold-store': {
    label: 'Cold Store', building: 'warehouse', season: 'winter',
    rug: 'ink', sofa: 'terracotta', accent: 'charcoal',
    note: 'one warm couch in a big cold room',
  },
  'yard-in-april': {
    label: 'Yard in April', building: 'warehouse', season: 'spring',
    rug: 'sage', sofa: 'moss', accent: 'blush',
    note: 'the service yard greening up under the loading doors',
  },
  'level-thirty-four': {
    label: 'Level Thirty-Four', building: 'skyscraper', season: 'summer',
    rug: 'slate', sofa: 'navy', accent: 'charcoal',
    note: 'polished concrete, cool grey, a field of rooftops below',
  },
  'night-shift': {
    label: 'Night Shift', building: 'skyscraper', season: 'winter',
    rug: 'ink', sofa: 'charcoal', accent: 'navy',
    note: 'a tower floor lit by its own panels most of the day',
  },
  'glasshouse': {
    label: 'Glasshouse', building: 'skyscraper', season: 'spring',
    rug: 'sage', sofa: 'blush', accent: 'moss',
    note: 'grey concrete with something growing on every surface',
  },
  'tower-in-october': {
    label: 'Tower in October', building: 'skyscraper', season: 'autumn',
    rug: 'clay', sofa: 'mustard', accent: 'navy',
    note: 'warm upholstery against the cool glass',
  },
  'zinc-and-limestone': {
    label: 'Zinc and Limestone', building: 'mansard', season: 'autumn',
    rug: 'plum', sofa: 'moss', accent: 'terracotta',
    note: 'pale plaster under a zinc roof, green velvet, Paris',
  },
  'rooftop-spring': {
    label: 'Rooftop Spring', building: 'mansard', season: 'spring',
    rug: 'sand', sofa: 'blush', accent: 'moss',
    note: 'chimney pots and blossom, everything pale',
  },
  'atelier-winter': {
    label: 'Atelier in Winter', building: 'mansard', season: 'winter',
    rug: 'slate', sofa: 'charcoal', accent: 'navy',
    note: 'grey light off a hundred wet roofs',
  },
  'quatorze-juillet': {
    label: 'Quatorze Juillet', building: 'mansard', season: 'summer',
    rug: 'sand', sofa: 'terracotta', accent: 'navy',
    note: 'shutters open, limestone bleached, the whole city out',
  },
};

/** Schemes weighted evenly — sixteen looks, no favourites. */
const SCHEME_KEYS = Object.keys(SCHEMES);

/** A weight table as `weighted()` wants it, from a table of records. */
function byWeight(table) {
  return Object.entries(table).map(([key, def]) => [key, def.weight]);
}

/**
 * How the desks divide into teams that sit together.
 *
 * The one piece of the brief that is about people rather than furniture, and it
 * is what makes a pod a pod: a cluster is only a team's cluster if the team is
 * the thing that decided its size. Sizes are drawn to fit the arrangement — a
 * bench takes three to five, a pod two to three a side — and the last team takes
 * what is left, so the sizes always add up to the headcount.
 *
 * Groups of one are folded back into the group before them where there is one: a
 * team of one is a person sitting on their own at the end of a bench, which is a
 * thing that happens in offices and reads in a plan as a mistake.
 */
function splitTeams(stream, desks, [lo, hi]) {
  const teams = [];
  let left = desks;
  while (left > 0) {
    const want = stream.int(lo, hi);
    const take = Math.min(want, left);
    teams.push(take);
    left -= take;
  }
  if (teams.length > 1 && teams[teams.length - 1] === 1) {
    teams.pop();
    teams[teams.length - 1] += 1;
  }
  return teams;
}

/** How big a team is, in each arrangement. */
const TEAM_SIZES = {
  rows: [3, 5],
  pods: [4, 6],
  spine: [6, 8],
  perimeter: [2, 4],
  island: [4, 6],
};

/**
 * Everything this seed wants, before the floor plate has had its say.
 *
 * @param {string} seed
 * @returns {object} the brief, which `furnish()` then tries to fit
 */
export function brief(seed) {
  const s = streamFor(seed, 'brief');

  // Size first, because the arrangement depends on it: a pod needs four desks
  // before it is a pod, so the typology roll is re-weighted by what will fit
  // rather than being drawn and then overruled.
  const desks = s.weighted(DESK_COUNTS);
  const shapes = byWeight(TYPOLOGIES)
    .filter(([key]) => desks >= TYPOLOGIES[key].minDesks);
  const typology = s.weighted(shapes.length ? shapes : [['rows', 1]]);

  const teams = splitTeams(s, desks, TEAM_SIZES[typology] ?? [3, 5]);

  // How many desks travel. One is the authored answer and the commonest, because
  // a raised top only reads as raised beside a neighbour at ordinary height; a
  // room with none is an office that never bought one, and a big floor may have
  // a pair.
  const standing = s.weighted([
    [1, 60], [0, 22], [2, desks >= 8 ? 16 : 0], [3, desks >= 12 ? 6 : 0],
  ]);

  const postKey = s.weighted(byWeight(POST_CHARACTERS));
  const researchKey = s.weighted(byWeight(RESEARCH_CHARACTERS));
  const refreshKey = s.weighted(byWeight(REFRESH));
  const loungeKey = s.weighted(byWeight(LOUNGES));
  const plantKey = s.weighted(byWeight(PLANTING));
  const schemeKey = s.pick(SCHEME_KEYS);

  const [plantLo, plantHi] = PLANTING[plantKey].plants;
  const scheme = SCHEMES[schemeKey];

  return {
    seed,
    desks,
    typology,
    teams,
    standing: Math.min(standing, desks),
    // Which way the room is organised: along its length or across it. Read by the
    // circulation stage as the street's own axis, and by the desk stage for which
    // way a bench runs, so the two cannot disagree about the grain of the room.
    grain: s.weighted([['x', 55], ['z', 45]]),
    post: { key: postKey, ...POST_CHARACTERS[postKey] },
    research: { key: researchKey, ...RESEARCH_CHARACTERS[researchKey] },
    refresh: { key: refreshKey, ...REFRESH[refreshKey] },
    lounge: { key: loungeKey, ...LOUNGES[loungeKey] },
    planting: { key: plantKey, count: s.int(plantLo, plantHi) },
    // A bin is optional on purpose: failed work can be closed where it stands.
    bin: s.chance(0.78),
    /**
     * How many plants stand *between* areas rather than in a corner.
     *
     * "Plants and other items can also be used to make logical dividers in the
     * room among groups of desks, sitting furniture or a break area." Some offices
     * do this and some do not, so it is a number a brief decides rather than a rule
     * every room follows.
     */
    dividers: s.weighted([[1, 40], [2, 32], [0, 28]]),
    // One rug per area, which is what a rug is *for*: it is the thing that makes a
    // scattering of furniture read as somewhere. Asked which generated rooms they
    // liked, a person said "a clear area (with rugs often!) to sit in ...
    // delineated areas" — and a room with two groups and one rug can only ever
    // delineate one of them, whatever the placement does.
    //
    // So two is the common case now rather than one: the desks and the lounge.
    // Nought stays possible, because a room with bare boards is a real room.
    // Up to four, because four slightly overlapped is a way of defining one large
    // area and not four small ones — see the rug placement in furnish.js.
    rugs: s.weighted([[3, 34], [2, 30], [4, 22], [1, 10], [0, 4]]),
    scheme: { key: schemeKey, ...scheme },
    // A matched suite, or a chair that deliberately does not match. Both are real
    // rooms; the accent is the scheme's own second colour either way, so neither
    // can be a colour from some other room.
    suite: s.chance(0.55) ? 'matched' : 'accented',
  };
}
