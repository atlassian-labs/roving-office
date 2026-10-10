import { COLORS } from '../../config.js';
import { box, cyl, group, put, sphere } from '../build.js';
import { buildTrikeRider } from './trike-rider.js';

/**
 * A small adult tricycle for the happy-hour cart.
 *
 * The two wheels at the rear are the important silhouette: this is a human-sized
 * three-wheeler with a cargo box, not a bicycle with a decorative drink tray.
 */
export function buildAdultTricycle() {
  const root = group();
  const frame = 0x39434c;
  const rubber = 0x25282b;
  const brass = 0xc89442;
  const drink = 0xd96d5b;

  const wheel = (x, z, r = 0.34) => {
    const mesh = cyl(r, r, 0.12, rubber, { segments: 16, flat: true });
    mesh.rotation.z = Math.PI / 2;
    put(root, mesh, x, r + 0.02, z);
  };

  // One front wheel and two rear wheels: the stable adult-trike stance.
  wheel(0, 0.86, 0.38);
  wheel(-0.58, -0.64);
  wheel(0.58, -0.64);

  // Low triangular chassis and the steering stem.
  put(root, box(0.12, 0.12, 1.55, frame), 0, 0.46, 0.08);
  put(root, box(1.1, 0.11, 0.11, frame), 0, 0.46, -0.64);
  put(root, box(0.1, 0.75, 0.1, frame), 0, 0.75, 0.66).rotation.x = -0.18;
  put(root, box(0.85, 0.08, 0.08, brass), 0, 1.11, 0.54);

  // Saddle and the rear cargo box — the reason this is the happy-hour trike.
  put(root, box(0.5, 0.12, 0.35, brass), 0, 1.0, -0.14);
  put(root, box(1.05, 0.5, 0.85, COLORS.woodDark), 0, 0.84, -0.7);
  put(root, box(0.9, 0.34, 0.72, COLORS.woodMid), 0, 1.25, -0.7);

  // Three bright bottles make the cart read as a bar even at catalogue scale.
  for (const x of [-0.27, 0, 0.27]) {
    put(root, cyl(0.07, 0.07, 0.32, drink, { segments: 10 }), x, 1.58, -0.7);
    put(root, sphere(0.08, brass, { segments: 8 }), x, 1.78, -0.7);
  }

  const rider = buildTrikeRider();
  root.add(rider.obj);
  root.userData.pedal = rider.pedal;
  // Keep references to scene nodes out of userData: three.js serializes it when
  // cloning, while these closures retain the animation rig without a cycle.
  root.userData.refreshments = {
    get canServe() { return rider.canServe; },
    serve: () => rider.serve(),
    update: (dt) => rider.update(dt),
  };

  return root;
}

/** The parked indoor drinks station uses the same model as the cruising trike. */
export function buildHappyHourTrike() {
  const obj = buildAdultTricycle();
  return { obj, handle: { obj,
    get canServe() { return obj.userData.refreshments.canServe; },
    serve: () => obj.userData.refreshments.serve(),
    update: (dt) => obj.userData.refreshments.update(dt),
  } };
}
