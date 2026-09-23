import { box, cyl, group, footY } from '../build.js';
import { movable } from '../movables.js';

// ---------------------------------------------------------------------------
// Coat stand: shows one coat per agent currently in the office.
export function buildCoatStand() {
  const g = group(0, 0, 0);
  // The foot rests on the floor. It used to be centred at half its own height,
  // which put it entirely inside the slab with its top face exactly on the floor
  // surface — invisible apart from the flicker where the two planes met.
  const BASE_H = 0.1;
  const base = cyl(0.35, 0.4, BASE_H, 'woodDark');
  base.position.y = footY(BASE_H); g.add(base);
  const pole = cyl(0.06, 0.06, 3.4, 'woodDark'); pole.position.y = 1.7; g.add(pole);

  const hooks = [];
  const HOOKS = 6;
  for (let i = 0; i < HOOKS; i++) {
    const a = (i / HOOKS) * Math.PI * 2;
    const hook = box(0.4, 0.08, 0.08, 'woodDark');
    hook.position.set(Math.cos(a) * 0.2, 3.3, Math.sin(a) * 0.2);
    hook.rotation.y = -a;
    g.add(hook);
    hooks.push({ angle: a, taken: false, coat: null });
  }

  const handle = {
    id: 'coatStand',
    kind: 'coatStand',
    hooks,
    /** Hang a coat in this agent's colour; returns the hook used. */
    addCoat(color) {
      const hook = hooks.find((h) => !h.taken);
      if (!hook) return null;
      const coat = box(0.66, 1.15, 0.32, color, { rough: 0.9 });
      coat.position.set(Math.cos(hook.angle) * 0.34, 2.45, Math.sin(hook.angle) * 0.34);
      coat.rotation.y = -hook.angle;
      g.add(coat);
      hook.taken = true;
      hook.coat = coat;
      return hook;
    },
    removeCoat(hook) {
      if (!hook || !hook.coat) return;
      g.remove(hook.coat);
      hook.coat.geometry.dispose?.();
      hook.taken = false;
      hook.coat = null;
    },
  };
  return { obj: g, handle };
}

/** Mount the coat stand: dressing with a facing but nowhere to queue, so no
 * approach point to turn towards. */
export function mount(s, handles) {
  // One coat per agent in the office. Nowhere to queue, so `place()` has no
  // approach point to turn it towards — but it still has a facing of its own.
  const { obj, handle } = buildCoatStand();
  const relocate = () => {
    obj.position.set(s.x, 0, s.z);
    obj.rotation.y = s.facing;
  };
  relocate();
  handles.coatStand = handle;
  return movable(obj, `station:${s.id}`, { label: 'Coat stand', spec: s, relocate });
}
