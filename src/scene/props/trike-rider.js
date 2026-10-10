import * as THREE from 'three';
import { box, group, put } from '../build.js';

/** A seated refreshment attendant, with hands on the bars and feet on the pedals. */
export function buildTrikeRider() {
  const obj = group();
  obj.name = 'happy-hour-attendant';
  const shirt = 0x4c9d96;
  const skin = 0xc58d68;
  const trousers = 0x34434f;
  const axis = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const segment = (parent, color, width = 0.16) => put(parent, box(width, 1, width, color));
  const placeLimb = (mesh, a, b) => {
    direction.subVectors(b, a);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.y = direction.length();
    mesh.quaternion.setFromUnitVectors(axis, direction.normalize());
  };

  // Agent-sized above the saddle: the cart is an adult trike, not a toy.
  put(obj, box(0.65, 0.78, 0.4, shirt), 0, 1.57, 0.02);
  put(obj, box(0.38, 0.5, 0.025, 0xf0e0b8), 0, 1.48, 0.235);
  put(obj, box(0.56, 0.56, 0.56, skin), 0, 2.24, 0.03);
  put(obj, box(0.58, 0.15, 0.58, trousers), 0, 2.54, 0.03);
  for (const x of [-0.13, 0.13]) put(obj, box(0.045, 0.045, 0.02, 0x25282b), x, 2.27, 0.32);

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = group(side * 0.35, 1.82, 0.02);
    arm.name = side === 1 ? 'serving-arm' : 'steering-arm';
    obj.add(arm);
    const elbow = new THREE.Vector3(side * 0.06, -0.38, 0.22);
    const hand = new THREE.Vector3(0, -0.7, 0.52);
    placeLimb(segment(arm, shirt), new THREE.Vector3(), elbow);
    placeLimb(segment(arm, skin), elbow, hand);
    put(arm, box(0.17, 0.14, 0.17, skin), hand.x, hand.y, hand.z);
    arms.push(arm);
  }

  const legs = [-1, 1].map((side) => ({
    side,
    hip: new THREE.Vector3(side * 0.22, 1.07, -0.03),
    knee: new THREE.Vector3(),
    foot: new THREE.Vector3(),
    thigh: segment(obj, trousers, 0.22),
    shin: segment(obj, trousers, 0.2),
    shoe: put(obj, box(0.23, 0.12, 0.35, 0x25282b)),
    pedal: put(obj, box(0.3, 0.06, 0.15, 0x25282b)),
  }));
  let phase = 0;
  let serving = 0;
  const pedal = (dt) => {
    phase = (phase + dt * 5) % (2 * Math.PI);
    for (const leg of legs) {
      const angle = phase + (leg.side === 1 ? Math.PI : 0);
      leg.foot.set(leg.side * 0.29, 0.45 + Math.sin(angle) * 0.16, 0.25 + Math.cos(angle) * 0.16);
      leg.knee.set(leg.side * 0.25, 0.76, 0.46 + Math.sin(angle) * 0.05);
      placeLimb(leg.thigh, leg.hip, leg.knee);
      placeLimb(leg.shin, leg.knee, leg.foot);
      leg.shoe.position.copy(leg.foot);
      leg.pedal.position.copy(leg.foot).y -= 0.09;
    }
  };
  pedal(0);

  return {
    obj, pedal,
    // Both the rider and their trike must still be on screen to serve somebody.
    get canServe() { return obj.visible && obj.parent?.visible === true && obj.parent.parent != null; },
    serve() {
      if (!this.canServe) return false;
      serving = 0.8;
      return true;
    },
    update(dt) {
      serving = Math.max(0, serving - dt);
      arms[1].rotation.z = serving > 0 ? -Math.sin(serving / 0.8 * Math.PI) * 0.75 : 0;
    },
  };
}
