// What the office is called, and why it is laid out the way it is.
//
// Both come from the room that was actually built, never from the brief that
// asked for it — because the floor plate gets a say (see `furnish()`), and a room
// called "Four Pods" with three pods in it is worse than no name at all. So this
// module is handed the finished plan and reads it.
//
// The name is a short phrase about the one or two things that make this office
// itself: how the desks are arranged, and whatever is unusual about it — a
// telescope, no letterbox at all, a jungle in the corners. The blurb is the same
// facts written out, in the order somebody would notice them walking in.
//
// It is deliberately not a random word salad. A name here is worth having only
// if it tells you something true, so every word in it is earned by something in
// the layout, and two offices that genuinely are "the sunlit pods" are welcome to
// share the name — they are the same room in every way a name can carry.

import { streamFor } from './rng.js';
import { TYPOLOGIES } from './brief.js';

/**
 * What to call the shape of the desks, in both numbers.
 *
 * Both, because one of the naming patterns counts the banks — and "Two Pod Room"
 * is the sort of phrase that gives a generator away in three words. A name is
 * only worth having if it reads as something a person would have written.
 */
const SHAPE_WORDS = {
  rows: {
    one: ['Bench', 'Row Room', 'Long Room', 'Bench Room'],
    many: ['Benches', 'Rows', 'Bench Rows'],
  },
  pods: {
    one: ['Cluster', 'Pod Room', 'Huddle', 'Quad'],
    many: ['Pods', 'Clusters', 'Huddles', 'Quads'],
  },
  spine: {
    one: ['Spine', 'Long Bench', 'Backbone', 'Run'],
    many: ['Spines', 'Long Benches', 'Runs'],
  },
  perimeter: {
    one: ['Ring', 'Cloister', 'Perimeter', 'Gallery'],
    many: ['Rings', 'Edges', 'Galleries'],
  },
  island: {
    one: ['Island', 'Raft', 'Block', 'Table Room'],
    many: ['Islands', 'Rafts', 'Blocks'],
  },
};

/**
 * What to call whatever is unusual about the room, in the order of how much it
 * says about the place.
 *
 * A trait earns a name only if it is *unusual*: every office has somewhere for
 * work to arrive, so "post room" says nothing, while a floor with no letterbox
 * in it at all is worth naming after that fact. Which is why the ordinary
 * characters — a post room, a reference shelf, a reading corner — are absent
 * from this table and the room falls back to being named after its desks.
 */
const TRAIT_WORDS = {
  observatory: ['Observatory', 'Lookout', 'Telescope Room'],
  'great-library': ['Great Library', 'Stacks', 'Reading Room'],
  paperless: ['Fax Room', 'Paperless Floor', 'Wire Room'],
  'print-shop': ['Print Shop', 'Press Room', 'Copy Room'],
  depot: ['Depot', 'Sorting Office', 'Mail Room'],
  wharf: ['Wharf', 'Exchange', 'Clearing House'],
  'letters-only': ['Letterbox', 'Post Corner'],
  jungle: ['Glasshouse', 'Conservatory', 'Fernery', 'Palm Court'],
  parlour: ['Parlour', 'Snug', 'Lounge'],
  lounge: ['Parlour', 'Drawing Room', 'Lounge'],
  bare: ['Bare Floor', 'Spartan Room'],
  dry: ['Dry Floor', 'Waterless Room'],
  packed: ['Warren', 'Hive', 'Floor'],
  pair: ['Back Room', 'Annex', 'Two-Hander'],
};

/**
 * Adjectives, each earned by something.
 *
 * Grouped by what they are *about* so that a name can only ever pick one that is
 * true of this room: a winter scheme may be called cold, a nine-desk floor may be
 * called great, and neither may borrow the other's word.
 */
const ADJECTIVES = {
  summer: ['Sunlit', 'Bright', 'High', 'Midsummer', 'Open', 'Warm'],
  autumn: ['Amber', 'Golden', 'Long-Shadowed', 'October', 'Russet', 'Late'],
  winter: ['Cold', 'Frosted', 'Lamplit', 'January', 'Shuttered', 'Dim'],
  spring: ['Green', 'Blossom', 'Fresh', 'April', 'Early', 'New'],
  small: ['Little', 'Quiet', 'Back', 'Small', 'Narrow', 'Half'],
  mid: ['Second', 'Middle', 'Corner', 'Everyday', 'Plain', 'Working'],
  big: ['Great', 'Broad', 'Long', 'Whole', 'Deep', 'Wide'],
  simple: ['Brownstone', 'Street-Level', 'Ground-Floor', 'Alder', 'Kerbside'],
  warehouse: ['Loft', 'Timber', 'Upper', 'Warehouse', 'Mill', 'Boarded'],
  skyscraper: ['Upper', 'Glass', 'Level', 'Tower', 'Thirty-Fourth', 'Curtain-Wall'],
  mansard: ['Attic', 'Zinc', 'Rooftop', 'Mansard', 'Chimney', 'Top-Floor'],
};

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** `a` or `an`, which is the sort of detail that gives a generator away. */
function article(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** How big this office is, as a word the adjectives are keyed on. */
function sizeBand(desks) {
  if (desks <= 4) return 'small';
  if (desks <= 8) return 'mid';
  return 'big';
}

/**
 * Everything about this room worth saying, read off the finished plan.
 *
 * One place, so the name and the blurb cannot disagree about the room they are
 * describing — which they did, once, when each counted the desks itself.
 */
export function traitsOf(brief, built) {
  const kinds = (kind) => built.stations.filter((s) => s.kind === kind).length;
  const pieces = (kind) => built.furniture.filter((f) => f.kind === kind).length;
  const desks = built.desks.length;
  const teams = new Map();
  for (const d of built.desks) teams.set(d.team, (teams.get(d.team) ?? 0) + 1);

  const traits = [];
  const note = (key) => { if (TRAIT_WORDS[key]) traits.push(key); };
  // In the order they say something about the place.
  if (brief.research.key === 'observatory' || brief.research.key === 'great-library') {
    note(brief.research.key);
  }
  if (!kinds('mailbox') && kinds('printer')) note(brief.post.key === 'print-shop' ? 'print-shop' : 'paperless');
  if (kinds('mailbox') >= 2) note(brief.post.key === 'wharf' ? 'wharf' : 'depot');
  if (kinds('mailbox') === 1 && !kinds('printer') && !kinds('inbox')) note('letters-only');
  // From what is actually in the room rather than from what the brief asked for:
  // a floor that wanted nine plants and had room for three is not a glasshouse.
  if (built.plants.length >= 6) note('jungle');
  if (built.plants.length === 0) note('bare');
  if (pieces('couch') + pieces('armchair') >= 3) note('lounge');
  else if (pieces('couch') >= 2) note('parlour');
  if (!kinds('coffee') && !kinds('waterCooler')) note('dry');
  if (desks >= 12) note('packed');
  if (desks <= 2) note('pair');

  return {
    desks,
    teams: [...teams.values()].sort((a, b) => b - a),
    banks: built.fit.banks,
    typology: brief.typology,
    shape: TYPOLOGIES[brief.typology]?.note ?? '',
    along: built.fit.along,
    street: built.plan.axis === 'x' ? 'across the room' : 'down the length of the room',
    workSide: built.plan.work === built.plan.far ? 'far' : 'near',
    stations: Object.fromEntries(
      ['mailbox', 'printer', 'inbox', 'bookshelf', 'telescope', 'coffee', 'waterCooler', 'bin', 'coatStand']
        .map((k) => [k, kinds(k)]),
    ),
    furniture: Object.fromEntries(
      ['couch', 'armchair', 'sideTable', 'floorLamp', 'rug'].map((k) => [k, pieces(k)]),
    ),
    plants: built.plants.length,
    standing: built.desks.filter((d) => d.standing).length,
    courier: brief.post.courier,
    scheme: brief.scheme,
    traits,
    size: sizeBand(desks),
  };
}

/**
 * The office's name.
 *
 * Four patterns, and which ones are available depends on what the room has to
 * say: a room with nothing unusual about it can only be named after its desks,
 * and a room with two unusual things can be named after both. The stream is this
 * seed's `naming` stream, so the same room is always called the same thing.
 */
export function nameFor(brief, traits) {
  const s = streamFor(brief.seed, 'naming');
  const words = SHAPE_WORDS[traits.typology] ?? SHAPE_WORDS.rows;
  const shape = s.pick(words.one);
  const shapes = s.pick(words.many);
  const [first, second] = traits.traits;
  const trait = first ? s.pick(TRAIT_WORDS[first]) : null;
  const other = second ? s.pick(TRAIT_WORDS[second]) : null;

  const adjectives = [
    ...(ADJECTIVES[traits.scheme.season] ?? []),
    ...(ADJECTIVES[traits.size] ?? []),
    ...(ADJECTIVES[traits.scheme.building] ?? []),
  ];
  const adjective = s.pick(adjectives);

  const patterns = [
    // Named after its desks, dressed with something true about the light or the
    // building it is in.
    () => `The ${adjective} ${shape}`,
    () => (traits.banks === 1
      ? `The ${adjective} ${shape}`
      : `${COUNT_WORDS[Math.min(traits.banks, COUNT_WORDS.length - 1)]} ${shapes}`),
  ];
  if (trait) {
    patterns.push(() => `The ${adjective} ${trait}`);
    patterns.push(() => `${traits.banks === 1 ? shape : shapes} and ${article(trait)} ${trait}`);
    patterns.push(() => `The ${trait}`);
  }
  if (other) {
    patterns.push(() => `${trait} and ${article(other)} ${other}`);
  }

  // A room with something to say says it: the plain desk patterns stay in the
  // list, but a trait beats them four times out of five, because "The Observatory"
  // is a better name for a room with a telescope in it than "Three Pods" is.
  const weights = patterns.map((_, i) => (i < 2 ? (trait ? 1 : 4) : 3));
  const pick = s.weighted(patterns.map((p, i) => [i, weights[i]]));
  return patterns[pick]();
}

/**
 * Why the room is like this: two or three sentences of fact, in the order
 * somebody walking in would notice them.
 *
 * Every clause is read off `traits`, so this cannot flatter the room. A floor
 * that came out with fewer desks than the brief asked for says so; a floor with
 * no letterbox says that too, because it is the most surprising thing about it.
 */
export function reasonFor(brief, traits) {
  const out = [];
  const teams = traits.teams;
  const people = `${traits.desks} desk${traits.desks === 1 ? '' : 's'}`;
  // A team that ended up with one desk is said as what it is — somebody on their
  // own at the end of a bank — rather than counted in as a "team of 1", which is
  // the sort of phrase that tells you a sentence was assembled rather than written.
  const alone = teams.filter((n) => n === 1).length;
  const proper = teams.filter((n) => n > 1);
  const grouping = proper.length > 1
    ? `in ${COUNT_WORDS[Math.min(proper.length, 8)].toLowerCase()} teams of ${list(proper.map(String))}`
    : 'in one team';
  const leftover = alone
    ? `, with ${alone === 1 ? 'one desk' : `${COUNT_WORDS[Math.min(alone, 8)].toLowerCase()} desks`} on their own`
    : '';

  out.push(`${people} ${proper.length ? grouping : 'one to a corner'}${leftover}, ${traits.shape}, off a street ${traits.street}.`);

  // How work gets in and out, which is the room's whole reason for existing.
  const post = [];
  if (traits.stations.mailbox) {
    post.push(traits.stations.mailbox > 1 ? `${traits.stations.mailbox} post boxes` : 'a post box');
  }
  if (traits.stations.printer) {
    post.push(traits.stations.printer > 1 ? `${traits.stations.printer} printers` : 'a printer');
  }
  if (traits.stations.inbox) post.push('a stack of stock');
  out.push(post.length
    ? `Work comes and goes by ${list(post)}${traits.courier ? ', and the courier calls' : ', with no courier'}.`
    : 'Nothing arrives here yet.');

  // Where you look things up, and where the noise is.
  const research = [];
  if (traits.stations.bookshelf) {
    research.push(traits.stations.bookshelf > 1
      ? `${traits.stations.bookshelf} bookshelves` : 'a bookshelf');
  }
  if (traits.stations.telescope) research.push('a telescope at the window');
  if (research.length) out.push(`Lookups go to ${list(research)}.`);

  const breaks = [];
  if (traits.stations.coffee) breaks.push('coffee');
  if (traits.stations.waterCooler) breaks.push('water');
  const seats = traits.furniture.couch + traits.furniture.armchair;
  if (breaks.length || seats) {
    const seating = seats
      ? `${COUNT_WORDS[Math.min(seats, 8)].toLowerCase()} thing${seats === 1 ? '' : 's'} to sit on`
      : null;
    out.push(`The break end has ${list([...breaks, seating].filter(Boolean))}, kept away from the quiet desks.`);
  }

  if (traits.plants >= 6) out.push(`${traits.plants} plants, which is as many as the corners will take.`);
  else if (!traits.plants) out.push('Nothing green in it at all.');

  // And the look, which is the one part of the room somebody chose rather than
  // worked out.
  out.push(`${traits.scheme.label}: ${traits.scheme.note}.`);
  return out.join(' ');
}

/** "a, b and c" — the one piece of grammar a generated sentence always gets wrong. */
function list(items) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
