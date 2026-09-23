import { box, group } from '../build.js';

// ---------------------------------------------------------------------------
// Inbox: stacked delivery boxes where incoming job material arrives.
export function buildInbox() {
  const g = group(0, 0, 0);

  const mk = (x, z, s, rot) => {
    const b = group(x, 0, z);
    b.rotation.y = rot;
    const body = box(1.1 * s, 0.8 * s, 1.1 * s, 0xbf9b6a, { rough: 0.95 });
    body.position.y = 0.4 * s; b.add(body);
    const tape = box(0.24 * s, 0.82 * s, 1.12 * s, 0xd9c39a, { rough: 0.9, cast: false });
    tape.position.y = 0.4 * s; b.add(tape);
    return b;
  };

  g.add(mk(-0.6, 0, 1.0, 0.15));
  g.add(mk(0.7, 0.25, 0.82, -0.3));
  const stacked = mk(-0.5, -0.1, 0.7, 0.5);
  stacked.position.y = 0.8;
  g.add(stacked);

  const handle = {
    id: 'inbox',
    kind: 'inbox',
    collected: 0,
    takePackage() { this.collected++; return true; },
  };
  return { obj: g, handle };
}
