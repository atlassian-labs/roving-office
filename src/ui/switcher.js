// Scene switcher: the dropdown beside the office heading.
//
// One row per scene in this office — a building and a season and the feeds filling
// it (see src/office.js) — plus a row below the divider that does something rather
// than being somewhere. A custom menu rather than a native <select> so each row can
// carry the marks of its sources, name the building beneath the scene, and hold the
// trash can that removes it.
//
// That last row is worded by the caller, because what it should offer depends on
// whose office this is. In your own it adds a scene; in the reserved demo office,
// where nothing is yours to change, it offers you one of your own instead.
//
// The list is rebuildable because scenes are not a fixed catalogue: they are added,
// repointed and deleted while the app is running, and the office they belong to is
// shared with whoever else holds the keycard.
//
// Deleting asks once. The trash can appears on hover and the first click arms it
// rather than firing: a scene is a season, a building and a set of feeds someone
// chose, and "one stray click in a menu" is not an acceptable way to lose it. The
// armed state times out, so walking away is the same as saying no.
//
// Renaming happens in the row itself. The pencil turns the row into a text field
// holding the name it already shows, so the edit is where the thing being edited is
// — a dialogue would cover the very list that gives a name its context. Enter or a
// click elsewhere keeps it, Escape puts it back, and an emptied field is how a scene
// goes back to being named after whatever fills it (see `nameScenes` in
// src/office/office.js).

import { node } from './dom.js';
import { getSources } from '../data/sources.js';
import { plusMark, renderMark } from './marks.js';

/** How long an armed trash can waits for the second click. */
const ARM_MS = 3000;

/**
 * @param {object} opts
 * @param {Array}  opts.scenes     scene records (see src/office.js)
 * @param {string} opts.initialId  which one starts active
 * @param {(id: string) => void} opts.onChange  fired only on an actual change
 * @param {() => void} [opts.onCreate]  the row below the divider; omitted hides it
 * @param {string} [opts.createLabel]  what that row is called
 * @param {string} [opts.createNote]   the line beneath it, saying what it will do
 * @param {(id: string) => void} [opts.onDelete]  the trash can; omitted hides it
 * @param {(id: string, name: string) => void} [opts.onRename]  the pencil; omitted
 *   hides it. An empty name means "back to the derived one".
 * @returns {{ setActive(scene: object): void, setScenes(list: Array): void,
 *             close(): void }}
 */
export function createSceneSwitcher({
  scenes,
  initialId,
  onChange,
  onCreate,
  createLabel = 'New scene',
  createNote = 'Random building and season, filled with test agents',
  onDelete,
  onRename,
}) {
  const host = document.getElementById('scene-switcher');
  if (!host) throw new Error('createSceneSwitcher: #scene-switcher not found');

  let items = [...scenes];
  let activeId = initialId;
  let isOpen = false;
  /** The scene whose trash can is armed, and the timer that disarms it. */
  let armed = null;
  let armTimer = null;
  /** The scene whose name is currently a text field, if any. @type {?string} */
  let renaming = null;

  // --- Trigger ---
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'switcher-trigger';
  trigger.title = 'Choose a scene';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const triggerText = node('span', 'switcher-current');

  const caret = node('span', 'switcher-caret');
  caret.innerHTML = '<svg viewBox="0 0 10 6" width="10" height="6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L5 5 L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  trigger.append(triggerText, caret);

  // --- Menu ---
  const menu = node('div', 'switcher-menu');
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  host.append(trigger, menu);

  const rows = new Map();

  /** Rebuild every row. Cheap, and it keeps one code path for add and rename. */
  function build() {
    menu.innerHTML = '';
    rows.clear();
    disarm();
    // Every row is new, so any field open in the old ones went with them.
    renaming = null;

    for (const scene of items) {
      const row = node('div', 'switcher-item');
      row.dataset.id = scene.id;

      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'switcher-choose';
      choose.setAttribute('role', 'option');

      // The marks of everything feeding this scene, so you can see at a glance
      // which are live harness feeds, which are simulated, and which are a mix.
      // Stacked rather than listed: the row's job is to name a scene, and the
      // marks are an aside that must not push the name around.
      const defs = getSources(scene.sources);
      const badge = node('span', 'switcher-item-mark');
      badge.classList.toggle('stacked', defs.length > 1);
      // No sources leaves the slot empty rather than absent, so the scene names
      // below still line up with everything else in the menu.
      for (const def of defs.slice(0, 3)) {
        const one = node('span', 'switcher-item-glyph');
        one.style.setProperty('--accent', def.accent);
        one.innerHTML = renderMark(def.mark);
        badge.appendChild(one);
      }

      const text = node('span', 'switcher-item-text');

      const name = node('span', 'switcher-item-name', scene.name);

      const where = node('span', 'switcher-item-where', `${scene.building} · ${scene.floorName}`);

      text.append(name, where);
      choose.append(badge, text);
      choose.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        if (scene.id === activeId) return;   // no work for a no-op switch
        activeId = scene.id;
        paint();
        onChange?.(scene.id);
      });
      row.appendChild(choose);

      if (onRename) {
        const pen = document.createElement('button');
        pen.type = 'button';
        pen.className = 'switcher-rename';
        pen.title = `Rename ${scene.name}`;
        pen.setAttribute('aria-label', `Rename scene ${scene.name}`);
        pen.innerHTML = pencilMark;
        pen.addEventListener('click', (e) => {
          e.stopPropagation();
          startRename(scene);
        });
        row.appendChild(pen);
      }

      // An office keeps at least one scene, so the last row has no trash can —
      // hiding it is kinder than offering a button that can only refuse.
      if (onDelete && items.length > 1) {
        const bin = document.createElement('button');
        bin.type = 'button';
        bin.className = 'switcher-trash';
        bin.title = `Delete ${scene.name}`;
        bin.setAttribute('aria-label', `Delete scene ${scene.name}`);
        bin.innerHTML = trashMark;
        bin.addEventListener('click', (e) => {
          e.stopPropagation();
          if (armed !== scene.id) return arm(scene.id);
          disarm();
          close();
          onDelete(scene.id);
        });
        row.appendChild(bin);
      }

      rows.set(scene.id, row);
      menu.appendChild(row);
    }

    if (onCreate) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'switcher-item switcher-add';
      const badge = node('span', 'switcher-item-mark');
      badge.innerHTML = plusMark;
      const text = node('span', 'switcher-item-text');
      const name = node('span', 'switcher-item-name', createLabel);
      const where = node('span', 'switcher-item-where', createNote);
      text.append(name, where);
      add.append(badge, text);
      add.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        onCreate();
      });
      menu.appendChild(add);
    }
  }

  /**
   * Turn a row into a text field holding the name it shows.
   *
   * The field starts on the *displayed* name, derived or not, so renaming "Claude
   * Code 2" is a matter of editing the two words already there rather than typing a
   * name from nothing. Committing an unchanged one is therefore a no-op on purpose:
   * storing it would freeze a derived name as a chosen one, and the scene would stop
   * following the feeds it is named after.
   */
  function startRename(scene) {
    const row = rows.get(scene.id);
    if (!row || renaming === scene.id) return;
    disarm();
    renaming = scene.id;
    row.classList.add('renaming');

    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'switcher-rename-field';
    field.value = scene.name ?? '';
    field.setAttribute('aria-label', `Name for ${scene.name}`);
    // The office truncates at 60 characters, so the field says so rather than
    // letting someone type a name that comes back shorter than they wrote it.
    field.setAttribute('maxlength', '60');
    field.setAttribute('placeholder', 'Named after its feeds');

    let settled = false;
    const finish = (keep) => {
      if (settled) return;
      settled = true;
      const wanted = field.value.trim();
      renaming = null;
      row.classList.remove('renaming');
      field.remove?.();
      paint();
      if (keep && wanted !== (scene.name ?? '')) onRename(scene.id, wanted);
    };

    field.addEventListener('click', (e) => e.stopPropagation?.());
    field.addEventListener('keydown', (e) => {
      // Both keys belong to the field while it is open: Escape would otherwise reach
      // the document and close the entire menu instead of putting the name back.
      e.stopPropagation?.();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    // Clicking away is agreement, the same as it is in every other name field: the
    // typing is still on screen, and throwing it away for a stray click would be the
    // surprising half of the choice.
    field.addEventListener('blur', () => finish(true));

    row.appendChild(field);
    field.focus?.();
    field.select?.();
  }

  /** First click on the trash can: say what a second one will do. */
  function arm(id) {
    disarm();
    armed = id;
    const row = rows.get(id);
    row?.classList.add('arming');
    const bin = row?.querySelector('.switcher-trash');
    if (bin) bin.title = 'Click again to delete';
    armTimer = setTimeout(disarm, ARM_MS);
  }

  function disarm() {
    if (armTimer) clearTimeout(armTimer);
    armTimer = null;
    if (armed) rows.get(armed)?.classList.remove('arming');
    armed = null;
  }

  function paint() {
    const active = items.find((s) => s.id === activeId) ?? items[0];
    triggerText.textContent = active?.name ?? 'Scene';
    for (const [id, row] of rows) {
      const on = id === activeId;
      row.classList.toggle('active', on);
      row.querySelector('.switcher-choose')?.setAttribute('aria-selected', String(on));
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    host.classList.add('open');
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    host.classList.remove('open');
    // An armed trash can must not survive the menu closing: re-opening it later and
    // clicking once would then delete without ever having asked.
    disarm();
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen ? close() : open();
  });

  // Dismiss on outside click or Escape.
  document.addEventListener('click', (e) => {
    if (!host.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  build();
  paint();

  return {
    /** Keep the trigger in sync when a switch is driven from elsewhere. */
    setActive(scene) {
      if (!scene) return;
      activeId = scene.id;
      paint();
    },

    /** Replace the scene list — after an add, a repoint or a delete. */
    setScenes(list) {
      items = [...list];
      build();
      paint();
    },

    close,
  };
}

/** A pencil on a diagonal, drawn to sit at the same weight as the trash can. */
const pencilMark = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M9.4 2.4 11.6 4.6M2.5 11.5l.6-2.3 6.1-6.1a.9.9 0 0 1 1.3 0l1 1a.9.9 0 0 1 0 1.3l-6.1 6.1-2.3.6a.5.5 0 0 1-.6-.6Z" '
  + 'stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** A lid, a bin and two ribs. Small enough that a path is cheaper than an import. */
const trashMark = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M2.5 4h9M5.5 4V2.8h3V4M3.6 4l.5 7.2h5.8L10.4 4M6 6.2v3.4M8 6.2v3.4" '
  + 'stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
