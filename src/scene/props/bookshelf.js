import { pick, spread } from '../../dice.js';
import { box, group, put } from '../build.js';
import { buildGlobe } from '../globe.js';
import { buildPothos } from '../plants.js';
import { place, placed, drop } from '../movables.js';

// ---------------------------------------------------------------------------
// Bookshelf: agents pull a book out when they're looking something up.
export function buildBookshelf() {
  const g = group(0, 0, 0);
  const W = 2.4, H = 4.4, D = 1.0;
  const frameC = 0xc8a86e;

  const left = box(0.15, H, D, frameC); left.position.set(-W / 2, H / 2, 0);
  const right = box(0.15, H, D, frameC); right.position.set(W / 2, H / 2, 0);
  const topP = box(W, 0.15, D, frameC); topP.position.set(0, H, 0);
  const botP = box(W, 0.15, D, frameC); botP.position.set(0, 0.08, 0);
  const backP = box(W, H, 0.08, 0xb99a63); backP.position.set(0, H / 2, -D / 2 + 0.05);
  g.add(left, right, topP, botP, backP);

  const books = [];
  for (let s = 1; s <= 4; s++) {
    const y = (H / 5) * s;
    put(g, box(W - 0.2, 0.1, D - 0.2, frameC, { rough: 0.7 }), 0, y, 0);

    let bx = -W / 2 + 0.25;
    while (bx < W / 2 - 0.35) {
      const bw = spread(0.12, 0.14);
      const bh = spread(0.5, 0.45);
      const c = pick(BOOK_COLORS);
      const bk = put(g, box(bw, bh, D - 0.4, c, { rough: 0.8 }), bx + bw / 2, y + 0.05 + bh / 2, 0);
      books.push({ mesh: bk, color: c, taken: false });
      bx += bw + 0.03;
    }
  }

  const handle = {
    id: 'bookshelf',
    kind: 'bookshelf',
    books,
    topY: H + 0.075,               // where things can be stood on top of it
    topW: W,                       // ... and how much room there is up there, so a
    topD: D,                       //     caller can find a corner rather than guess
    /** Pull a book off the shelf; returns a token to return it later. */
    takeBook() {
      const available = books.filter((b) => !b.taken);
      if (!available.length) return null;
      const b = pick(available);
      b.taken = true;
      b.mesh.visible = false;
      return b;
    },
    returnBook(token) {
      if (!token) return;
      token.taken = false;
      token.mesh.visible = true;
    },
  };

  return { obj: g, handle };
}
const BOOK_COLORS = [0xc0714f, 0x4f7a8a, 0x8ba888, 0xd8b25a, 0x9a6b52, 0x5a6b8a, 0xb85a5a];

/**
 * Mount one bookshelf into the room: the shelf, the globe standing on top, the
 * trailing pothos on the corner — and the registration that makes the pair one
 * piece of furniture to the agent layer. Moved verbatim from the kind switch
 * this file's builder used to be named in.
 */
export function mount(s, handles) {
  // Information retrieval, with a globe standing on top for anything looked up
  // online. Parented to the shelf so `place()` carries it along with the furniture
  // rather than leaving it stranded mid-room.
  const { obj, handle } = buildBookshelf();
  place(obj, s);

  const globe = buildGlobe();
  globe.obj.position.set(0, handle.topY, 0);   // centred on the shelf
  obj.add(globe.obj);

  // Trailing pothos on the shelf top beside the globe, stood right on the front
  // corner: from there its strands fall over the front of the books and one long
  // runner goes down the side of the case, which is the whole point of a trailing
  // plant. Sitting it back from the edge just hid the trails inside the carcass.
  // High-up greenery also costs nothing on the floor.
  put(obj, buildPothos(1.15, { sideDrop: 11 }), handle.topW / 2 - 0.3, handle.topY - 0.02, handle.topD / 2 - 0.24);

  // A shelf and its globe together, because an agent looking something up uses
  // both: they take a book off this shelf and spin this globe, and with two
  // shelves in the room it matters that those are the same piece of furniture.
  const entry = { id: s.id, shelf: handle, globe: globe.handle };
  handles.bookshelves.push(entry);
  // And under its own instance id, which this mount did not do and needed to.
  //
  // `buildStationProp` fills `byStation` after a mount by copying `handles[kind]`, and
  // this mount never set `handles.bookshelf` — so there was no bookshelf in the index at
  // all. Nothing noticed while the only way to a shelf was `_nearestShelf`, which read
  // the list above; the moment a lookup asked for *a research station* and then asked
  // the index what was standing there, `takeBook()` would have been called on undefined
  // and swallowed by the optional chain. Exactly how the mailbox's missing handle hid
  // by the roles model, so it is registered here rather than left to the by-kind fallback —
  // which would in any case hand every shelf the last one built.
  handles.byStation[s.id] = handle;
  return placed(obj, s, 'Bookshelf', () => drop(handles.bookshelves, entry));
}
