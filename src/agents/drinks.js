// What each agent drinks.
//
// A preference is rolled once, when the agent walks in, and never changes: it is
// a character trait rather than a mood. It also decides where they take their
// breaks — water and sparkling water come from the cooler, tea and coffee from
// the espresso machine — so the traffic across the room depends on who is in.
//
// The coffee side is deliberately combinatorial rather than a flat list, because
// that is how people actually order: a base drink, sometimes doubled, sometimes
// strong, and about half the time on something other than dairy.

import { pick, chance } from '../dice.js';

/**
 * @typedef {object} Drink
 * @property {string} name     what they would ask for, e.g. 'Double Oat Flat White'
 * @property {'water'|'tea'|'coffee'} kind  what it is, which is also how the room finds
 *   somewhere serving it: a station kind lists what it `serves` (see STATION_KINDS) and
 *   the room asks for the `refresh` job with this as the preference. A drink used to
 *   name its own station, which made the office's furniture part of its definition and
 *   a room without that exact prop a room with nothing to drink.
 * @property {number} color    what it looks like in the cup, so a long black and
 *                             an oat flat white don't land the same
 */

const WATERS = [
  { name: 'Water', color: 0xdfeef7 },
  { name: 'Sparkling Water', color: 0xe4f2fa },
];

const TEAS = [
  { name: 'English Breakfast Tea', color: 0xa4632f },
  { name: 'Earl Grey Tea', color: 0xb0703a },
  { name: 'Green Tea', color: 0xa9bd6a },
  { name: 'Peppermint Tea', color: 0xbcd2a4 },
  { name: 'Chamomile Tea', color: 0xd9bb5e },
  { name: 'Chai Tea', color: 0xc08a5a },
];

// `milk`: whether an alternative milk is a coherent thing to ask for. An oat
// espresso is not a drink.
// `double`: whether it can be doubled. A Magic is a double ristretto flat white
// by definition, so "Double Magic" would be wrong.
const COFFEES = [
  { name: 'Espresso', milk: false, double: true },
  { name: 'Long Black', milk: false, double: true },
  { name: 'Flat White', milk: true, double: true },
  { name: 'Cappuccino', milk: true, double: true },
  { name: 'Macchiato', milk: true, double: true },
  { name: 'Cortado', milk: true, double: true },
  { name: 'Magic', milk: true, double: false },
];

const MILKS = ['Oat', 'Almond', 'Soy'];

const BLACK_COFFEE = 0x3a2418;
const MILK_COFFEE = 0x9d6b45;

// How the office breaks down. Skewed to coffee because that is where the variety
// is, and because it is an office.
const P_COFFEE = 0.55;
const P_TEA = 0.20;          // the remaining 25% is water or sparkling water
const P_DOUBLE = 0.30;
const P_STRONG = 0.15;
const P_ALT_MILK = 0.50;     // of the milk-based coffees, which is the only place
                             // an alternative milk means anything

/**
 * Roll a preference for one agent.
 * @returns {Drink}
 */
export function randomDrink() {
  const roll = Math.random();

  if (roll > P_COFFEE + P_TEA) {
    const water = pick(WATERS);
    return { name: water.name, kind: 'water', color: water.color };
  }

  if (roll > P_COFFEE) {
    const tea = pick(TEAS);
    return { name: tea.name, kind: 'tea', color: tea.color };
  }

  const base = pick(COFFEES);

  // Order the words the way they'd be said: "Double Strong Oat Flat White".
  const parts = [];
  if (base.double && chance(P_DOUBLE)) parts.push('Double');
  if (chance(P_STRONG)) parts.push('Strong');
  const altMilk = base.milk && chance(P_ALT_MILK);
  if (altMilk) parts.push(pick(MILKS));
  parts.push(base.name);

  return {
    name: parts.join(' '),
    kind: 'coffee',
    color: base.milk ? MILK_COFFEE : BLACK_COFFEE,
  };
}
