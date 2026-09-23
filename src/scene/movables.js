// The editor's registration machinery: what makes a prop draggable, and how a
// removed one gives back what it was holding. Split from props.js — this half
// is generic over every prop family, and the editor is its only other reader.

/** Take a built prop out of the room and give back what it was holding. */
export function unbuild(m) {
  m.teardown?.();
  m.obj.parent?.remove(m.obj);
  releaseGeometry(m.obj);
}


/**
 * Give back the GPU memory a removed prop was holding.
 *
 * Geometries only, and deliberately: materials come from the shared cache in
 * scene/build.js and are handed out by reference, so disposing the ones on a deleted
 * desk would take the material out from under every other desk in the room. Geometry
 * is built per mesh, so it is the part that is genuinely this prop's to release. The
 * rest is freed for real on teardown, where the whole world goes at once and
 * `clearMaterialCache()` can run.
 */
export function releaseGeometry(root) {
  root.traverse((o) => o.geometry?.dispose?.());
}


/**
 * Mark a floor group as furniture the editor may pick up, and teach it how to put
 * itself back.
 *
 * The same self-registering trick the night lights use (`userData.nightLight`): a
 * prop declares its own capability at the point it is built, and the thing that
 * wants it goes looking. The editor raycasts into the room, walks up from whatever
 * mesh it hit to the nearest tagged ancestor, and gets the whole prop — so clicking a
 * monitor selects the desk it stands on, not the monitor.
 *
 * Two things make the editor generic rather than a list of special cases:
 *
 *   * `spec` is the prop's own record in the layout config — the very object, not a
 *     copy. Dragging is then a write to `spec.x` and `spec.z`, whatever the prop is,
 *     and `facing` being present is what makes a prop rotatable.
 *   * `relocate` re-reads that record and puts the group where it now says, along
 *     with any world-space anchor derived from it. This is what lets the room keep
 *     running instead of being rebuilt on every drop. Every movable carries one, so
 *     the editor re-places all of them and the props with extra work — a desk's seat,
 *     the couch's cushions, the mailbox's slot — do it themselves.
 *
 * @param {THREE.Object3D} obj
 * @param {string} key    stable identity, e.g. `desk:desk-3` or `station:coffee`
 * @param {object} opts
 * @param {string} opts.label            what the editor panel calls it
 * @param {{x: number, z: number, facing?: number}} opts.spec  its layout record
 * @param {() => void} opts.relocate
 * @param {() => void} [opts.teardown]  what to forget when this prop is taken out of
 *   the room. Only the props that register a handle somewhere need one — a desk is in
 *   `handles.desks` and a bookshelf in `handles.bookshelves`, and a deleted desk that
 *   stayed in that list would be a desk the agent layer went on seating people at.
 */
export function movable(obj, key, { label, spec, relocate, teardown }) {
  obj.userData.movable = { key, label, spec, obj, relocate, teardown };
  return obj;
}

/** Collect every movable under `root`, in build order. */
export function movables(root) {
  const found = [];
  root.traverse((o) => { if (o.userData?.movable) found.push(o.userData.movable); });
  return found;
}

// Place a station prop so it faces its approach point.
export function place(obj, station) {
  obj.position.set(station.x, 0, station.z);
  obj.rotation.y = (station.lookRotation ?? 0) + Math.PI;
  return obj;
}

/**
 * Tag a station prop that `place()` positions, which is most of them.
 *
 * @param {THREE.Object3D} obj
 * @param {object} spec   the station instance
 * @param {string} label
 * @param {() => void} [teardown]
 */
export function placed(obj, spec, label, teardown = undefined) {
  return movable(obj, `station:${spec.id}`, {
    label, spec, relocate: () => place(obj, spec), teardown,
  });
}

/** Remove an item from a handle list, if it is in it. */
export function drop(list, item) {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

