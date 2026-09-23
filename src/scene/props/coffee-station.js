import { COLORS } from '../../config.js';
import { box, cyl, group, put } from '../build.js';

// ---------------------------------------------------------------------------
// Espresso machine on a counter. Built facing +z (the side agents stand on).
export function buildCoffeeStation() {
  const g = group(0, 0, 0);

  // Counter cabinet with a worktop and a couple of doors. 30% wider than the
  // machine needs, for elbow room on each side, and deeper than the cabinet
  // below it — the extra depth is added only to the front, so the counter
  // still sits flush against the wall behind it and the machine (against the
  // back, unmoved) gets clear space to work in ahead of it.
  const cab = box(2.86, 1.5, 1.6, 'woodMid', { rough: 0.7 });
  cab.position.set(0, 0.75, 0.2); g.add(cab);
  const worktop = box(3.02, 0.12, 1.72, 0x4a4f55, { rough: 0.45 });
  worktop.position.set(0, 1.56, 0.2); g.add(worktop);
  for (const sx of [-0.715, 0.715]) {
    const door = box(1.235, 1.1, 0.06, 0x7a4f30, { rough: 0.7, cast: false });
    door.position.set(sx, 0.78, 1.01); g.add(door);
    const knob = cyl(0.04, 0.04, 0.08, 0xbf9b45, { segments: 8, metal: 0.7 });
    knob.rotation.x = Math.PI / 2;
    knob.position.set(sx + 0.455, 0.78, 1.06); g.add(knob);
  }

  // --- The machine itself, built on its own (below) and stood on the worktop ---
  put(g, buildEspressoMachine(), -0.36, 1.62, -0.05);

  // A grinder beside it — simplified after a Mahlkönig K30 Vario Air, in the
  // same silver as the machine: a cylindrical body under a tapered single-dose
  // hopper, a stepless grind-adjustment collar, and a fork that cradles the
  // portafilter under the chute instead of a doser chamber.
  const grinderC = 0xc9cdd1;
  const grinder = group(0.78, 1.62, -0.1);
  const gBody = cyl(0.15, 0.15, 0.42, grinderC, { segments: 14, metal: 0.75, rough: 0.22 });
  gBody.position.y = 0.21; grinder.add(gBody);
  const dial = cyl(0.17, 0.17, 0.05, 0x2b2f36, { segments: 14, metal: 0.5, rough: 0.35 });
  dial.position.y = 0.35; grinder.add(dial);
  // Glass hopper on top, with the ground coffee sitting in it — a single-dose
  // grinder's catch is normally hand-filled with whole beans, but on a K30 Air
  // the whole point is that it grinds straight into whatever's under the chute,
  // so it's read here as the grounds resting in their jar before they go in.
  const glass = cyl(0.13, 0.13, 0.22, 0xcfe3ea, { segments: 14, rough: 0.08, metal: 0.1 });
  glass.position.y = 0.53; grinder.add(glass);
  const grounds = cyl(0.115, 0.12, 0.15, 0x5a3a24, { segments: 14, rough: 0.95 });
  grounds.position.y = 0.495; grinder.add(grounds);
  const lid = cyl(0.09, 0.09, 0.04, 0x1c2024, { segments: 14, rough: 0.4 });
  lid.position.y = 0.66; grinder.add(lid);
  const paddle = box(0.05, 0.08, 0.03, 0x1a1c20, { rough: 0.6 });
  paddle.position.set(0, 0.28, 0.16); grinder.add(paddle);
  const chute = box(0.07, 0.05, 0.08, 0x2b2f36, { rough: 0.4, metal: 0.4 });
  chute.position.set(0, 0.15, 0.15); grinder.add(chute);
  for (const sx of [-0.08, 0.08]) {
    const fork = box(0.03, 0.05, 0.16, grinderC, { metal: 0.6, rough: 0.3 });
    fork.position.set(sx, 0.07, 0.18); grinder.add(fork);
  }
  g.add(grinder);

  // A stack of cups beside the grinder.
  for (let i = 0; i < 3; i++) {
    put(g, cyl(0.11, 0.09, 0.2, COLORS.paper, { segments: 10 }), 1.05, 1.72 + i * 0.16, 0.3);
  }

  const handle = { id: 'coffee', kind: 'coffee' };
  return { obj: g, handle };
}

// ---------------------------------------------------------------------------
/**
 * The espresso machine on its own, without the counter it stands on.
 *
 * Split out of the station because it is the piece of the room the rest of the
 * code actually names: a tea or coffee drinker walks to the *machine* (see
 * agents/drinks.js), and the cabinet under it is joinery. Having it as its own
 * builder is also what lets it be photographed by itself for the docs — see
 * scene/catalogue.js.
 *
 * Simplified after a La Marzocco Linea PB, three-group AV, in polished
 * silver — the "AV" is why there is a paddle beside each group instead of a
 * button, and why there is no digital screen: this generation runs on gauges.
 * The old machine had one group head, which meant one order at a time queuing
 * the whole office behind it; three groups pull at once.
 *
 * Built at its own origin with its feet on y = 0, facing +z: the group heads,
 * the gauges and the drip tray are all on that side, and so is the queue.
 *
 * @returns {THREE.Group} polished steel body with a chrome rail framing the cup
 *   warmer, three group heads with paddles and portafilters, two steam wands,
 *   a twin pressure gauge, power light, a wide drip tray with a cup under each
 *   spout, and an assortment of espresso and cappuccino cups warming on top.
 */
export function buildEspressoMachine() {
  const bodyC = 0xcdd1d4;
  const railC = 0xe6e9eb;
  const machine = group(0, 0, 0);

  const chassis = box(1.5, 0.78, 0.85, bodyC, { rough: 0.32, metal: 0.6 });
  chassis.position.y = 0.39; machine.add(chassis);
  const topPlate = box(1.56, 0.1, 0.89, 0xaeb3b8, { rough: 0.3, metal: 0.55 });
  topPlate.position.y = 0.83; machine.add(topPlate);

  // Chrome rail framing the cup warmer on three sides — the back is against
  // the wall and needs none.
  const front = cyl(0.02, 0.02, 1.56, railC, { segments: 8, metal: 0.9, rough: 0.15 });
  front.rotation.z = Math.PI / 2;
  front.position.set(0, 0.9, 0.4); machine.add(front);
  for (const sx of [-0.76, 0.76]) {
    const side = cyl(0.02, 0.02, 0.8, railC, { segments: 8, metal: 0.9, rough: 0.15 });
    side.rotation.x = Math.PI / 2;
    side.position.set(sx, 0.9, 0); machine.add(side);
  }

  // Espresso and cappuccino cups warming on top, saucer under each — mostly
  // cappuccino, since that's the queue this machine actually has to keep up
  // with. Where two are stacked, the top cup nests down into the one below
  // rather than balancing on its rim.
  const CUPS = [
    { x: -0.58, tall: false, c: 0xd9b08c },
    { x: -0.35, tall: true, c: COLORS.paper, stack: 2 },
    { x: -0.12, tall: true, c: COLORS.paper },
    { x: 0.12, tall: true, c: COLORS.paper, stack: 2 },
    { x: 0.35, tall: false, c: 0xb9c9b0 },
    { x: 0.58, tall: true, c: COLORS.paper },
  ];
  for (const { x, tall, c, stack = 1 } of CUPS) {
    const h = tall ? 0.15 : 0.08;
    const saucer = cyl(tall ? 0.13 : 0.1, tall ? 0.13 : 0.1, 0.015, COLORS.paper, { segments: 10 });
    saucer.position.set(x, 0.89, -0.14); machine.add(saucer);
    // Each cup nests down into the one below by 60% of its height, so a
    // second cup only adds 40% of a cup's height to the visible stack.
    for (let i = 0; i < stack; i++) {
      const cup = cyl(tall ? 0.1 : 0.065, tall ? 0.085 : 0.055, h, c, { segments: 10 });
      cup.position.set(x, 0.9 + h * (0.5 + i * 0.4), -0.14); machine.add(cup);
    }
  }

  // Twin gauges — steam-boiler pressure and brew pressure, side by side.
  for (const sx of [-0.1, 0.1]) {
    const bezelG = cyl(0.09, 0.09, 0.02, 0x14171b, { segments: 12, rough: 0.4 });
    bezelG.rotation.x = Math.PI / 2;
    bezelG.position.set(sx, 0.62, 0.42); machine.add(bezelG);
    const gauge = cyl(0.075, 0.075, 0.025, 0xe8e4d2, { segments: 12, rough: 0.3 });
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(sx, 0.62, 0.435); machine.add(gauge);
  }

  // Three group heads, each with a portafilter and an AV paddle switch beside it —
  // the toggle a Linea PB AV replaces its buttons with.
  for (const sx of [-0.5, 0, 0.5]) {
    const groupHead = box(0.2, 0.2, 0.22, 0xb5b9bd, { rough: 0.3, metal: 0.65 });
    groupHead.position.set(sx, 0.28, 0.42); machine.add(groupHead);
    const basket = cyl(0.095, 0.09, 0.1, 0x6f767d, { segments: 12, metal: 0.6, rough: 0.35 });
    basket.position.set(sx, 0.17, 0.42); machine.add(basket);
    const pfHandle = box(0.26, 0.055, 0.055, 0x1a1c20, { rough: 0.6 });
    pfHandle.position.set(sx, 0.16, 0.63); machine.add(pfHandle);
    const paddle = box(0.16, 0.04, 0.05, 0x1a1c20, { rough: 0.5, metal: 0.3 });
    paddle.rotation.x = -0.3;
    paddle.position.set(sx, 0.42, 0.44); machine.add(paddle);
  }

  // A steam wand on each side.
  for (const sx of [-0.72, 0.72]) {
    const wand = cyl(0.03, 0.03, 0.42, 0xb5b9bd, { segments: 8, metal: 0.75, rough: 0.2 });
    wand.rotation.x = 0.5;
    wand.position.set(sx, 0.28, 0.4); machine.add(wand);
  }

  // A warm power light.
  const led = box(0.06, 0.06, 0.04, 0xffb347, {
    emissive: 0xff9d2e, emissiveIntensity: 0.9, rough: 0.4, cast: false,
  });
  led.position.set(-0.72, 0.6, 0.41); machine.add(led);

  // Wide drip tray with a fresh cup under each group head.
  const tray = box(1.1, 0.05, 0.32, 0x90969a, { rough: 0.4, metal: 0.5 });
  tray.position.set(0, 0.08, 0.46); machine.add(tray);
  for (const sx of [-0.5, 0, 0.5]) {
    const servedCup = cyl(0.1, 0.08, 0.18, COLORS.paper, { segments: 10 });
    servedCup.position.set(sx, 0.19, 0.46); machine.add(servedCup);
  }

  return machine;
}
