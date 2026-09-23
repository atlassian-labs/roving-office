// The Rovo mark's artwork: four flat polygons, one per facet.
//
// **Its own module, importing nothing**, because two unlike things need the same
// points and one of them has to stay light:
//
//   - `src/scene/standees.js` extrudes them into the standee on the office sill.
//   - `src/ui/marks.js` turns them into the 2D picker tile.
//
// One copy, so the statue and the tile cannot disagree about what the mark looks
// like. The shapes cannot simply live in `standees.js` and be imported from
// there, and the reason is not tidiness: `marks.js` is reachable from
// `debuglog.html` through `src/debug/event-row.js`, and that page carries no
// import map and never loads three.js on purpose — it has to answer "what is
// actually arriving?" on a machine where the room is too broken to draw. An
// import of `three` anywhere in that graph fails module resolution and takes the
// whole page down, silently as far as `npm test` is concerned, because Node
// resolves `three` from `node_modules` and only a browser does not.
// `test/debuglog-no-three.test.js` is what notices.
//
// The artwork is Atlassian's own Rovo mark — the four-facet hexagon — in four
// flat colours from the Atlassian brand palette. The polygons are traced from
// UXWing's rendering of that same mark (https://uxwing.com/atlassian-rovo-icon/)
// rather than lifted out of a kit SVG. It is Atlassian's trademark, excluded from
// the Apache-2.0 grant; NOTICE and docs/developer/visual-assets.md record where it
// came from and on
// what basis it ships.
//
// Rovo's source SVG draws 6 overlapping shapes — a painter's-algorithm icon
// where later paths cover earlier ones (three separate purple facets, for
// instance, only make sense with a paint order in mind). Extruding those verbatim
// gave slabs that overlapped along nearly their whole depth with nowhere honest
// to put a seam, and no amount of nudging them apart in z read as anything but an
// exploded diagram of the icon.
//
// So this is not the source paths: it is the icon rasterized in its own paint
// order, then each of the 4 colours that actually reach the surface — blue,
// purple, orange and green — traced back out as one solid polygon apiece. They
// tile edge to edge with no overlap, the way the flat icon actually reads, which
// is what lets the standee extrude each one as an ordinary full-depth solid and
// what lets the picker tile paint them in list order without a facet occluding
// its neighbour.
//
// Plain point data, not SVG: this app has no build step, and the coplanar probe
// and the prop portrait tool both build the prop catalogue in Node with no DOM to
// parse SVG with — see the note at the top of `src/scene/standees.js`. Points are
// in the source's own y-down SVG space.

/** @type {Array<{color: string, points: number[][]}>} */
export const ROVO_SHAPES = [
  { color: '#1868db', points: [[190.17, 46.5], [186.0, 69.5], [187.5, 271.0], [193.33, 287.17], [208.83, 308.17], [241.67, 329.33], [97.67, 412.17], [60.17, 389.33], [49.5, 376.33], [43.17, 359.67], [43.33, 151.83], [52.33, 131.5], [67.67, 117.33]] },
  { color: '#bf63f3', points: [[258.0, 16.0], [269.67, 17.33], [285.0, 23.33], [414.5, 98.17], [270.5, 181.0], [203.0, 142.17], [203.0, 67.83], [206.0, 52.5], [214.83, 36.5], [229.17, 24.0], [241.5, 18.33]] },
  { color: '#fca700', points: [[414.67, 98.17], [454.33, 122.33], [465.5, 136.0], [471.5, 151.5], [471.5, 360.17], [462.83, 379.83], [450.83, 392.17], [324.67, 465.5], [328.83, 442.17], [327.33, 241.5], [322.5, 226.67], [310.83, 208.5], [299.33, 198.0], [270.83, 181.17]] },
  { color: '#82b536', points: [[241.83, 329.33], [311.83, 369.67], [311.83, 442.5], [309.33, 458.17], [302.0, 472.5], [291.17, 484.17], [278.5, 491.67], [262.33, 495.67], [245.83, 494.67], [229.83, 488.5], [98.0, 412.33]] },
];
