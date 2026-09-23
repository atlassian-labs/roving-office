// The furniture editor's panel: a strip along the bottom, built from the same chrome
// as the scene and developer panels.
//
// Same visual language on purpose. All three are authoring tools rather than parts of
// the office — nobody watching their agents work should ever see one — so they read as
// one set of instruments. That used to be a matter of discipline, with this file and
// dev-panel.js holding byte-identical copies of `section`, `readout` and `segmented`;
// they come from strip.js now, so the look is shared by construction rather than by
// everyone remembering to change it twice.
//
// What is different is where the numbers come from. The developer panel polls, because
// OrbitControls with damping changes continuously and an event per change would be
// wasted work. Here the readout is pushed: the coordinates only move while a prop is
// being dragged, and the drag already knows.

import { node } from '../ui/dom.js';
import { createStrip, section, kv, button, watchStripRows } from '../ui/strip.js';
import { createKitMenu, groupKit } from './kit-menu.js';
import { chromeColours } from './gizmos.js';

/**
 * How far apart the positions a prop can be dropped on are.
 *
 * A quarter unit is half a nav cell, which is the useful default: fine enough to nudge
 * a desk into a lane, coarse enough that two desks meant to line up actually do. The
 * others are there because a room is laid out at more than one scale — whole units for
 * roughing out where the furniture goes, a half for the nav grid's own spacing.
 */
export const SNAPS = {
  0.25: { label: '¼' },
  0.5: { label: '½' },
  1: { label: '1' },
};

/**
 * What to call the selected piece, in the heading.
 *
 * The layout names its instances for itself — `desk-1`, `couch-2` — which is an id and
 * reads like one. This turns that into something to read: the kind in the heading's own
 * small caps, and the instance as `#2` after it, which is how anybody would say it out
 * loud. A piece the layout numbered gets its number; one it did not — the first couch,
 * the wall clock — is simply itself, because `#1` for the only one of something is a
 * count nobody asked for.
 *
 * The label alone is not enough to do this, because a desk's label *is* its id: they
 * come from different places for different families, and the id is the one thing every
 * family has. So the two are read together.
 *
 * @param {string} label  what the prop calls itself
 * @param {string} key    its footprint key, e.g. `furniture:couch-2`
 */
function displayName(label, key) {
  const id = key.split(':')[1] ?? '';
  const numbered = /^(.*?)-(\d+)$/.exec(id);
  // A label that is only the id has nothing to say that the id does not; anything else
  // is a real name and is kept.
  const base = label === id ? (numbered?.[1] ?? id) : label;
  const name = base.replace(/-/g, ' ').toUpperCase();
  return numbered ? `${name} #${numbered[2]}` : name;
}

const fixed = (n) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);
const degrees = (rad) => {
  const deg = Math.round((rad * 180) / Math.PI);
  return `${((deg % 360) + 360) % 360}°`;
};

/**
 * What to call a downloaded layout file.
 *
 * A layout that has a name is called by it — `cosy-corner.json` — because a folder
 * of `layout.json`, `layout (1).json`, `layout (2).json` is a folder nobody can
 * read. An edit of the Default has no name yet and gets the generic one, rather
 * than a made-up one that would look like somebody's own.
 *
 * Exported because it is the one part of Download worth stating as a fact: a name
 * with a slash or a colon in it is a name a filesystem will not take, and the
 * slugging is what stands between a plan called `Q3 / final?` and a failed save.
 *
 * @param {{kind?: string, name?: string, parent?: string}} mode  as setLayoutState took it
 * @returns {string} a filename, always ending `.json`
 */
export function layoutFileName(mode = {}) {
  const named = mode.kind === 'named' ? mode.name
    : (mode.parent && mode.parent !== 'default' ? mode.parent : null);
  const slug = String(named ?? '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'office-layout'}.json`;
}

/**
 * @param {object} opts
 * @param {(size: number) => void} opts.onSnap
 * @param {(on: boolean) => void} opts.onPaths  show or hide the route ribbons
 * @param {() => string} opts.onLayoutText   the layout as text, for the clipboard or a file
 * @param {(text: string) => boolean} opts.onLayoutApply  true if it was accepted
 * @param {() => void} opts.onReset
 * @param {() => {ok?: boolean, name?: string, seed?: string}} opts.onRoll  generate a
 *   whole new office from a fresh seed (src/plan/) and put the room in it
 * @param {(key: string) => void} opts.onAdd     bring a new piece of furniture in
 * @param {(key: string, on: boolean) => void} opts.onChannel  switch a way in on or off
 * @param {(key: string, value: string) => void} opts.onChannelOption  pick a switch's
 *   option — which bird flies the post
 * @param {() => void} opts.onDelete             take the selected piece out
 * @param {() => void} opts.onDuplicate          put a second one beside it
 * @param {(color: ?string) => void} opts.onColor  paint the selected piece
 * @param {() => {ok?: boolean, name?: string, needsName?: boolean, suggest?: string}}
 *   opts.onLayoutSave  the mode's verb: writes back to a named parent, or asks
 *   for a name by answering `needsName`
 * @param {(name: string) => boolean} opts.onLayoutSaveAs  store under a new name
 * @param {(name: string) => void} opts.onLayoutPick       switch to a stored plan
 * @param {(from: string, to: string) => boolean} opts.onLayoutRename
 * @param {(name: string) => void} opts.onLayoutDelete
 */
export function createEditorPanel({
  onSnap, onPaths, onLayoutText, onLayoutApply, onReset, onRoll, onAdd, onChannel, onChannelOption, onDelete, onDuplicate, onColor,
  onLayoutSave, onLayoutSaveAs, onLayoutPick, onLayoutRename, onLayoutDelete, onClose,
}) {
  // --- What this is --------------------------------------------------------
  // Edit mode changes what a click does — it picks up furniture instead of selecting an
  // agent — so it needs something on screen saying so. A mode you cannot tell you are in
  // is a mode you get stuck in.
  //
  // It says it as a title rather than as a pill beside the first control, in the
  // roster's and the other strips' voice: a panel's name belongs on its own line
  // above its contents, and the permanent panels ought not to have several ideas about
  // where that is. The warning survives the move in the colour (see styles.css).
  //
  // Named `Edit Mode` to match the heading its shortcuts sit under in the `?` panel.
  // The × leaves the mode rather than merely hiding the strip — there are gizmos, path
  // trails and a pointer that picks up furniture behind this panel, and a hidden panel
  // with all of that still live would be exactly the mode you cannot tell you are in.
  const { host, body, heading } = createStrip({
    id: 'editor-panel', title: 'Edit Mode', onClose: () => onClose?.(),
  });
  heading.title = 'Press E to leave';

  /**
   * What the coloured squares on the floor mean, beside the word that says which mode
   * you are in.
   *
   * In the heading because that is where somebody looks when they want to know what
   * they are looking at, and because the floor is unreadable without it: four
   * colours, one of which only ever appears in place of another, is not something to
   * work out by experiment.
   *
   * **Footprints first, then the two states of the thing in hand, then the floor
   * people walk on.** Blue is the answer to the question the mode is usually open
   * for — where can this go — and green and red only mean anything once something is
   * picked up.
   *
   * The swatches share the floor overlays’ unlit colours (`chromeColours`),
   * independent of the building, time of day and renderer exposure.
   */
  const legend = node('span', 'editor-legend');
  const shown = chromeColours();
  const LEGEND = [
    [shown.zone, 'Item footprints'],
    [shown.pick, 'Selected item'],
    [shown.clash, "Can't move here!"],
    [shown.walk, 'Walking area'],
  ];
  for (const [colour, label] of LEGEND) {
    const item = node('span', 'editor-legend-item');
    const dot = node('i', 'editor-legend-dot');
    dot.style.background = colour;
    item.append(dot, document.createTextNode(label));
    legend.appendChild(item);
  }
  heading.appendChild(legend);

  let open = false;
  // Whether anything is picked, which is what tells the hint line under Items whether
  // it is describing a thing or describing the mode.
  let hasSelection = false;

  // --- What is selected ----------------------------------------------------
  //
  // The section has two states rather than one with blanks in it. With nothing picked it
  // says how to pick something and stops; the coordinate rows and the Delete button only
  // exist once there is something for them to be about. Three em dashes and a dead button
  // told the reader the fields were unavailable, which they could already see — and made
  // an empty selection look like a broken one.
  // Fixed, and wider than the rest: a coordinate pair has no smaller form. Let this
  // group shrink and `12.00, 8.00` breaks across two lines mid-number, which is worse
  // than unreadable — it looks like two different numbers. It now carries the name, the
  // position, the swatches and the key hints, so it is given the room to hold them.
  const selGroup = section('Selected');
  selGroup.el.classList.add('dev-group-fixed', 'dev-group-selected');
  // What is selected is named in the heading, beside the word Selected — the same shape
  // the Layout section uses for its picker. It is the answer to what the section is
  // about, so it belongs in the section's own title rather than in the first of its
  // rows; and it is the one piece of text here worth reading at a glance, so it is the
  // one piece set in the panel's foreground colour rather than its muted one.
  const selName = node('span', 'editor-sel-name');
  selGroup.heading.appendChild(selName);
  // Where it is and which way it points, on one line: `(12.00, 8.00) facing 90°`. They
  // were two rows with a field name each, which spent two lines of a narrow panel
  // labelling numbers whose own shape says what they are — a coordinate pair in
  // brackets, and a heading that says the word "facing" itself.
  const posRow = kv('Position');
  const posOut = posRow.value;
  selGroup.body.append(posRow.el);

  // Who works at the selected desk. A name to go with the coloured marker:
  // an empty desk in an office of five agents may be booked by somebody
  // who is off making coffee — and it is exactly what you want to know before deleting
  // one. Desks only: it is the only piece of furniture anybody is assigned to, and a row
  // reading "Assigned to — No one" under a pot plant would be a field looking for a use.
  const whoRow = kv('Assigned to');
  const whoOut = whoRow.value;
  selGroup.body.append(whoRow.el);
  // Hidden until something is selected, rather than relying on the first `setSelection` to
  // hide it. Nothing is selected when the panel opens, and a row asking who is assigned to
  // nothing is a question about nothing.
  whoRow.el.hidden = true;
  const markerRow = kv('Desk marker');
  markerRow.el.hidden = true;
  selGroup.body.append(markerRow.el);

  // Deleting belongs to the selection, not to the furniture picker: it acts on what is
  // already in the room, where Add acts on the list of what could be. It moved here when
  // the picker's title stopped saying "Furniture" and started saying what it is a list of.
  const deleteBtn = button('Delete', 'Take the selected item out of the room (⌫)');
  const duplicateBtn = button('Duplicate', 'Put a second one of this beside it (⌘D)');
  // One row, because they are the same sort of decision about the same thing — and
  // because a keystroke nobody is told about is a keystroke nobody uses. ⌘D is in the
  // tooltip for the same reason ⌫ is on Delete.
  const selActions = node('div', 'dev-row');
  selActions.append(duplicateBtn, deleteBtn);

  /**
   * A row of swatches, for the props that have a choice of colour.
   *
   * Swatches rather than a dropdown of colour names, because the thing being chosen is
   * a colour: "Plum" is a word you have to picture, and a square of it is the thing
   * itself. The row is empty and hidden for everything without a palette, which is
   * almost everything — the panel never learns which prop that is, it just draws
   * whatever `setPalette` hands it.
   *
   * The first swatch is Room: no choice, the state every rug starts in, where the scene
   * theme paints it and goes on repainting it as the season turns.
   */
  const colorRow = kv('Colour');
  const colorSwatches = node('div', 'editor-swatches');
  // `kv` seeds a readout with an em dash, for a number that has nothing to say yet.
  // This row's value is a strip of swatches rather than a number, so the dash is
  // replaced rather than sat in front of.
  colorRow.value.replaceChildren(colorSwatches);

  // The keys that act on the selection, under the selection — which is where they were
  // always about. They used to sit beneath the picker, on the reasoning that that was
  // where the space was; it made them read as a caption to the list of what can be
  // brought in, which is the one thing they say nothing about.
  const hint = node('div', 'editor-hint');
  selGroup.body.append(colorRow.el, selActions, hint);

  // --- Furniture -----------------------------------------------------------
  // What the room contains, rather than where it is: a picker of everything that can be
  // brought in, and a way to take the selected piece out again.
  //
  // A dropdown rather than a row of buttons, because the list runs to a dozen and a half
  // entries and would otherwise be the widest thing on screen — and because it groups,
  // which is worth having when "Desk" and "Fig" are not the same sort of decision.
  //
  // It lists only what can actually be added. An earlier version kept the full kinds in
  // it, greyed out and relabelled "one only", on the reasoning that a list which silently
  // shortened would leave you wondering whether you had imagined the coffee machine. What
  // that produced in practice was a picker mostly made of dead entries, since most kinds
  // are singular and the stock room has one of each — so the rule moved into the layout
  // (see `addableObjects`) and the panel draws whatever it is given.
  // Fixed, like Time and Snap: the picker has no narrower form to shrink into, so the
  // group keeps its width and the squeeze goes to the sections built out of lozenges.
  //
  // Named for what it does rather than for what it lists. It had an Add button beside
  // it, which made choosing a kind and asking for one two separate acts — and there is
  // no third thing you might have wanted after choosing "Couch" from a list headed Add
  // Item. Picking one puts it in the room and hands you the selection; the list falls
  // back to `(Choose)…` so it is ready for the next one rather than sitting there
  // naming something already added.
  const kitGroup = section('Add item');
  kitGroup.el.classList.add('dev-group-fixed');
  const kitRow = node('div', 'dev-row dev-row-nowrap');
  // A menu of our own rather than a `<select>`, because a row has to say more than a
  // label: which jobs a kind does, whether the room already has that job covered, and a
  // line about why you would want one. See editor/kit-menu.js — and ui/switcher.js,
  // which is the same decision taken for the same reason about scenes.
  //
  // It also gets the keyboard right by construction. A `<select>` keeps focus after a
  // choice and the editor's key handler stands aside for form fields, so the piece you
  // had just added was selected in the room and deaf to `Del`, `[`, `]` and the arrows
  // until you clicked elsewhere. A button hands focus back when the sheet closes.
  const kitMenu = createKitMenu({
    onPick: (key) => onAdd?.(key),
    onToggle: (key, on) => onChannel?.(key, on),
    onOption: (key, value) => onChannelOption?.(key, value),
  });
  kitRow.append(kitMenu.el);
  kitGroup.body.appendChild(kitRow);

  /**
   * Write the hint out for what is selected.
   *
   * Every gesture listed here is one that would do something *to the selection*, so the
   * list is only honest once there is a selection to be honest about: a rug does not
   * turn and cannot be taken out, and a line offering `[`/`]` and `Del` for one is a
   * line that lies twice. With nothing picked it lists the lot, because then it is
   * documentation of the mode rather than a claim about a thing.
   *
   * Only the two gestures with nothing else to tell you about them. Duplicate and
   * delete each have a button an inch above this line, carrying the key in its tooltip
   * and its own reason for being dim — so listing them here was the same thing said
   * twice in one section. Both are still bound, and both are still in the `?` panel,
   * which is where the whole vocabulary lives.
   *
   * Dragging is true of everything the editor will let you select; turning is something
   * a piece can decline, and the line is written from the answer rather than from a
   * fixed list with a hole in it.
   *
   * @param {{turns: boolean}} can
   */
  function drawHint({ turns }) {
    const gestures = [[['Drag'], 'move']];
    if (turns) gestures.push([['[', ']'], 'rotate']);
    hint.replaceChildren();
    for (const [keys, what] of gestures) {
      if (hint.childNodes.length) hint.appendChild(document.createTextNode(', '));
      keys.forEach((k, i) => {
        if (i > 0) hint.appendChild(document.createTextNode('/'));
        const kbd = node('kbd', '', k);
        hint.appendChild(kbd);
      });
      hint.appendChild(document.createTextNode(` ${what}`));
    }
  }
  drawHint({ turns: true });

  deleteBtn.addEventListener('click', () => onDelete?.());
  duplicateBtn.addEventListener('click', () => onDuplicate?.());

  /** Draw the swatch row for whatever is selected. See `colorRow`. */
  function drawPalette(palette) {
    colorSwatches.replaceChildren();
    colorRow.el.hidden = !palette;
    if (!palette) return;
    const swatch = (key, label, css) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'editor-swatch';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-pressed', String((palette.current ?? null) === key));
      // A colour swatch *is* its inline background — that is the whole of what it says.
      // Auto is not a colour and gets none, which leaves the stylesheet free to fill it
      // when it is the one in force. It had `transparent` written on inline, which beat
      // the rule that fills it, so the chosen Auto was painting its text in the panel's
      // own background colour over nothing at all: black on black.
      if (css) b.style.background = css;
      b.addEventListener('click', () => onColor?.(key));
      colorSwatches.appendChild(b);
    };
    // Auto first, and it says so in words: it is the absence of a choice, not a colour,
    // and drawn as an empty square it read as a seventh swatch — of black, on this
    // panel. A labelled pill cannot be mistaken for paint.
    swatch(null, 'Auto — the colour the scene paints it', null);
    const auto = colorSwatches.lastChild;
    auto.classList.add('editor-swatch-auto');
    auto.textContent = 'Auto';
    for (const o of palette.options) {
      swatch(o.key, o.label, `#${o.hex.toString(16).padStart(6, '0')}`);
    }
  }

  // --- Snap grid -----------------------------------------------------------
  //
  // A scrubber rather than three lozenges, because the thing being chosen is a distance
  // and a slider says "coarser this way" in a way a row of buttons cannot.
  //
  // Upright, because the strip is a row of sections and a horizontal slider needs width
  // the row would rather spend on the sections that hold words. Coarse at the top, fine
  // at the bottom, which is the way a scale of sizes is drawn everywhere else.
  //
  // The stops sit at their own values — ¼ a quarter of the way up, ½ halfway, 1 at the
  // top — so the track is a picture of the grid it sets, not three evenly spaced notches
  // wearing fractions as names. That is why `step` is fine-grained and the snapping is
  // done here instead: a stepped input would space them equally, and the gap from ½ to 1
  // would look the same as the gap from ¼ to ½ while being twice the distance.
  const SNAP_SIZES = Object.keys(SNAPS).map(Number).sort((a, b) => a - b);
  const snapGroup = section('Snap grid');
  snapGroup.el.classList.add('dev-group-fixed');

  // The stops, drawn on. Each label sits over its own tick and both are placed at the
  // value's own fraction of the track, so the scale is visible rather than something you
  // discover by dragging and feeling it catch. The current one is marked, which is what
  // replaces the single readout the clock has: three labels that are always there say
  // more than one that changes.
  const snapScale = node('div', 'dev-snap-scale');
  const snapTicks = new Map();
  for (const size of SNAP_SIZES) {
    const tick = node('span', 'dev-snap-tick');
    // The thumb travels between half its own height of each end, so the track's usable
    // span is inset — place the marks on the same span or they drift from the stops.
    const fraction = size / SNAP_SIZES[SNAP_SIZES.length - 1];
    tick.style.bottom = `calc(${fraction * 100}% + ${(0.5 - fraction) * 14}px)`;
    const label = node('span', 'dev-snap-label', SNAPS[size]?.label ?? String(size));
    const mark = node('span', 'dev-snap-mark', '—');
    tick.append(mark, label);
    snapScale.appendChild(tick);
    snapTicks.set(size, tick);
  }

  const snapSlider = document.createElement('input');
  snapSlider.type = 'range';
  snapSlider.min = '0';
  snapSlider.max = String(SNAP_SIZES[SNAP_SIZES.length - 1]);
  snapSlider.step = '0.01';
  snapSlider.className = 'dev-slider dev-slider-upright';
  snapSlider.setAttribute('aria-label', 'Snap grid');

  /** The permitted size nearest `v` — there is no resting place between them. */
  const nearestSnap = (v) =>
    SNAP_SIZES.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), SNAP_SIZES[0]);

  snapSlider.addEventListener('input', () => {
    const size = nearestSnap(Number(snapSlider.value));
    // Paint before telling anyone, so the thumb jumps to the stop under the cursor
    // rather than trailing a frame behind the drag.
    paintSnap(size);
    onSnap?.(size);
  });

  const snapStack = node('div', 'dev-snap-stack-upright');
  // Slider first, scale beside it: the marks read as labels *on* the track rather than
  // as a second column that happens to line up with it.
  snapStack.append(snapSlider, snapScale);
  snapGroup.body.appendChild(snapStack);

  function paintSnap(size) {
    snapSlider.value = String(size);
    for (const [key, tick] of snapTicks) tick.classList.toggle('active', key === size);
  }

  // --- The route ribbons ---------------------------------------------------
  // The same switch as P, on screen. Worth having both: the key is the one you reach for
  // once you know the mode, and a control is the only way to find out the ribbons can be
  // turned off at all — and to see, without pressing anything, whether an empty floor
  // means nobody is walking or means the ribbons are off.
  //
  // A native checkbox keeps Space, focus and checked state in step.
  const pathGroup = section('Paths');
  pathGroup.el.classList.add('dev-group-paths');
  const pathToggle = node('label', 'ui-toggle');
  const pathInput = document.createElement('input');
  pathInput.type = 'checkbox';
  pathInput.setAttribute('role', 'switch');
  pathInput.setAttribute('aria-label', 'Walking paths');
  const pathTrack = node('span', 'ui-toggle-track');
  pathTrack.setAttribute('aria-hidden', 'true');
  const pathLabel = node('span', 'ui-toggle-label', 'Off');
  pathInput.addEventListener('change', () => {
    pathLabel.textContent = pathInput.checked ? 'On' : 'Off';
    onPaths?.(pathInput.checked);
  });
  pathToggle.append(pathInput, pathTrack, pathLabel);
  pathGroup.body.appendChild(pathToggle);

  // --- The layout: mode, shelf and the ways in and out ----------------------
  // One section owns the plan itself. Its heading carries the layout picker — a
  // smaller cousin of the scene switcher's trigger, opening upward — which always
  // says which of the three states the room is in: the authored Default, a named
  // layout off this browser's shelf, or an edit of one of those. The buttons row
  // below holds Save beside Copy/Paste/Download/Reset, and the drop zone under that.
  const layoutGroup = section('Layout');
  layoutGroup.el.classList.add('dev-group-layout');

  /**
   * The last mode the editor reported, kept because Download has to name the file
   * after the layout and the panel is already told which layout that is. Held here
   * rather than asked for, so there is no second callback saying the same thing.
   * @type {{kind: string, name?: string, parent?: string}}
   */
  let layoutMode = { kind: 'default' };

  // The picker lives in the heading, right-aligned: heading text left, trigger
  // right, menu anchored to the trigger and opening upward (the strip is at the
  // bottom of the screen; a menu that opened downward would leave it).
  const head = layoutGroup.el.querySelector('h4');
  head.classList.add('dev-group-head');
  const headTools = node('div', 'layout-head-tools');
  const picker = node('div', 'layout-picker');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'layout-picker-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const triggerText = node('span', 'layout-picker-current');
  const caret = node('span', 'switcher-caret');
  caret.innerHTML = '<svg viewBox="0 0 10 6" width="9" height="5" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L5 5 L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  trigger.append(triggerText, caret);
  const menu = node('div', 'layout-picker-menu');
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  picker.append(trigger, menu);
  const saveBtn = button('Save', 'Store this layout in this browser');
  saveBtn.classList.add('dev-btn-small');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'editor-name';
  nameInput.maxLength = 40;
  nameInput.hidden = true;
  nameInput.setAttribute('aria-label', 'Layout name');
  const nameOk = button('OK', 'Confirm the name');
  nameOk.classList.add('dev-btn-small');
  nameOk.hidden = true;
  headTools.append(picker, saveBtn, nameInput, nameOk);
  head.appendChild(headTools);

  let pickerOpen = false;
  function setPickerOpen(open) {
    pickerOpen = open;
    menu.hidden = !open;
    picker.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) disarm();
  }
  trigger.addEventListener('click', (e) => { e.stopPropagation(); setPickerOpen(!pickerOpen); });
  document.addEventListener('click', (e) => {
    if (pickerOpen && !picker.contains(e.target)) setPickerOpen(false);
  });

  const trashMark = '<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M2 3.5h10M5.5 3.5V2.2h3v1.3M3.4 3.5l.7 8.3h5.8l.7-8.3M5.8 6v3.8M8.2 6v3.8"/></svg>';
  const pencilMark = '<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 11.5 3 9.2 9.8 2.4a1.1 1.1 0 0 1 1.6 0l.2.2a1.1 1.1 0 0 1 0 1.6L4.8 11l-2.3.5Z"/></svg>';

  // Deleting arms on the first press and fires on the second, exactly as a
  // scene's trash can does: a stored layout is a set of choices someone made,
  // and one stray click is not a way to lose them. Anything else disarms it.
  let armed = null;
  let armTimer = null;
  function disarm() {
    if (armTimer) clearTimeout(armTimer);
    armTimer = null;
    if (armed) armed.classList.remove('arming');
    armed = null;
  }

  // --- The buttons row: Save with the layout's own four ----------------------
  // Four plain verbs, each doing exactly the one thing its label says. They used
  // to be two — Export and Import — either side of a textarea that was both the
  // outbox and the inbox, so neither button's name was quite true: Export also
  // filled a box, Import read one rather than the clipboard everyone assumed.
  // Copy and Paste are now the clipboard, straight there and straight back, and
  // Download is the same layout as a file that can be kept, mailed or committed.
  const copyBtn = button('Copy', 'Copy this layout to the clipboard');
  const pasteBtn = button('Paste', 'Apply the layout on the clipboard');
  const downloadBtn = button('Download', 'Save this layout as a .json file');
  const resetBtn = button('Reset', 'Back to the Default layout');
  // **Random** sits at the end of the row rather than the start: the other four
  // are about *this* layout, and this one replaces it. It is the same distance
  // from the mouse as Reset and does about as much, which is the honest grouping.
  //
  // The button says "Random" and the code says "roll", and the mismatch is
  // deliberate: rolling is this project's own word for it — a scene's look is
  // *rolled* from the pools in projects.js — while "Random" is the word somebody
  // reaching for a different room is actually looking for.
  const rollBtn = button('Random', 'Generate a whole new office from a fresh seed');
  const layoutRow = node('div', 'dev-row editor-layout-row');
  layoutRow.append(copyBtn, pasteBtn, downloadBtn, resetBtn, rollBtn);
  layoutGroup.body.appendChild(layoutRow);

  /** What the name field is being asked for, or null while it is closed. */
  let asking = null;   // { verb: 'save' | 'rename', from?: string }

  /**
   * Swap the heading's controls for the question: [picker][Save] becomes
   * [name field][OK], in place — no extra line appears. Enter or OK commits,
   * Escape puts the controls back with nothing changed.
   */
  function askName(verb, prefill, from = null) {
    asking = { verb, from };
    nameInput.value = prefill ?? '';
    picker.hidden = true;
    saveBtn.hidden = true;
    nameInput.hidden = false;
    nameOk.hidden = false;
    nameInput.focus();
    nameInput.select();
  }

  function closeName() {
    asking = null;
    nameInput.hidden = true;
    nameOk.hidden = true;
    picker.hidden = false;
    saveBtn.hidden = false;
  }

  function confirmName() {
    if (!asking) return;
    const name = nameInput.value.trim();
    if (!name) return say('A layout needs a name.', false);
    if (asking.verb === 'save') {
      const ok = onLayoutSaveAs?.(name) ?? false;
      say(ok ? `Saved as \u201c${name}\u201d.` : 'Could not save that layout.', ok);
      if (ok) closeName();
    } else {
      const ok = onLayoutRename?.(asking.from, name) ?? false;
      say(ok ? `Renamed to \u201c${name}\u201d.` : 'That name is taken.', ok);
      if (ok) closeName();
    }
  }

  nameOk.addEventListener('click', confirmName);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmName(); }
    if (e.key === 'Escape') { e.stopPropagation(); closeName(); }
  });

  // Save is the mode's verb: on an edit of a named layout it writes straight
  // back to that name; on an edit of the Default it has no name yet, so the
  // editor answers needsName and the prompt opens with the best suggestion.
  saveBtn.addEventListener('click', () => {
    const result = onLayoutSave?.() ?? {};
    if (result.needsName) return askName('save', result.suggest || 'My layout');
    if (result.ok) say(`Saved to \u201c${result.name}\u201d.`, true);
  });

  // The other way in: a file. Download's opposite number, and Paste's for anyone
  // whose clipboard is out of reach — a layout mailed round as an attachment never
  // has to be opened and its contents fished out, it is just dropped here.
  //
  // It takes a click as well as a drop, opening the ordinary file picker, because
  // dragging is not available to everybody: a keyboard alone, or a hand that finds
  // a press easier than a drag, still needs the way in.
  const drop = node('div', 'editor-drop');
  drop.tabIndex = 0;
  drop.setAttribute('role', 'button');
  drop.title = 'Drop JSON layout file, or click to choose one';
  // Two labels, one shown at a time — see the container queries in styles.css. A
  // narrow strip has no room for the sentence, and the `title` keeps saying it, so
  // the short form loses nothing that was not already a hover away.
  const dropLong = node('span', 'editor-drop-long');
  dropLong.textContent = 'Drop JSON layout file, or click to choose one';
  const dropShort = node('span', 'editor-drop-short', 'Drop JSON layout file');
  drop.append(dropLong, dropShort);
  const picked = document.createElement('input');
  picked.type = 'file';
  picked.accept = 'application/json,.json';
  picked.hidden = true;
  picked.setAttribute('aria-label', 'Choose a JSON layout file');
  layoutGroup.body.append(drop, picked);

  // The last thing that happened — moved, turned, saved, refused — said in the
  // panel’s top-right corner, beside the heading. It holds for five
  // seconds, then fades rather than blanking: a message that vanishes the
  // instant you glance at it is worse than none.
  const status = node('div', 'editor-status');
  status.setAttribute('role', 'status');
  const statusLabel = node('span', '', 'Last action: ');
  const statusText = document.createElement('span');
  status.append(statusLabel, statusText);
  host.appendChild(status);
  let statusTimer = null;
  // Starts as it will look whenever there is no news: quiet, and through the one
  // function that decides what quiet means, rather than by reaching for the class here
  // and hoping the two agree.
  say('');

  /**
   * Apply some text as the layout, whatever brought it — the clipboard or a
   * dropped file. One path, so a file that is not a layout is refused in exactly
   * the same words as a clipboard that is not, and neither can get further than
   * the other. `whence` only names the source in the refusal, and `done` is what to
   * say when it worked — a file says which file, where the clipboard has no name.
   */
  function applyText(text, whence, done = 'Layout applied.') {
    if (!text || !text.trim()) return say(`Nothing to read: ${whence} is empty.`, false);
    const ok = onLayoutApply?.(text);
    say(ok ? done : 'That is not a layout I can read.', ok);
    return ok;
  }

  /**
   * The clipboard needs a secure context and permission, and neither is
   * guaranteed — a plain `http://` host on the network has no `navigator.clipboard`
   * at all. So there is a fallback: a scratch textarea, selected and copied the
   * deprecated way, which still works exactly where the modern call does not.
   */
  async function toClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* the old way, then */ }
    try {
      const scratch = document.createElement('textarea');
      scratch.value = text;
      scratch.setAttribute('aria-hidden', 'true');
      scratch.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
      document.body.appendChild(scratch);
      scratch.select();
      const ok = document.execCommand('copy');
      scratch.remove();
      return ok;
    } catch { return false; }
  }

  copyBtn.addEventListener('click', async () => {
    const text = onLayoutText?.() ?? '';
    // Download is the way out when both clipboard routes are shut, so the refusal
    // points at it rather than leaving somebody with nothing.
    const ok = await toClipboard(text);
    say(ok ? 'Copied to the clipboard.'
      : 'Could not reach the clipboard \u2014 use Download instead.', ok);
  });

  pasteBtn.addEventListener('click', async () => {
    let text;
    // Reading is the fussier half: Safari and Firefox gate it behind a prompt or
    // refuse it outright even where writing is allowed. The drop zone is the way
    // in when they do, so the refusal points at that.
    try { text = await navigator.clipboard.readText(); } catch {
      return say('Could not read the clipboard \u2014 drop a JSON layout file instead.', false);
    }
    applyText(text, 'the clipboard');
  });

  downloadBtn.addEventListener('click', () => {
    const text = onLayoutText?.() ?? '';
    const name = layoutFileName(layoutMode);
    // A blob URL behind an anchor nobody sees: the one way to hand the browser a
    // file it did not fetch. Revoked on a later turn rather than straight away,
    // because revoking before the click has been serviced cancels the save.
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    say(`Downloaded ${name}.`, true);
  });

  // --- The drop zone --------------------------------------------------------
  // `dragover` must be prevented as well as `dragenter`, or the browser keeps its
  // own idea of what a drop means and navigates away to the file — losing the
  // office, the edit and the point.
  let hovering = 0;
  const lit = (on) => drop.classList.toggle('over', on);

  drop.addEventListener('dragenter', (e) => {
    e.preventDefault();
    hovering += 1;
    lit(true);
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); });
  // Counted rather than toggled: dragging across a child element fires `leave` on
  // the one behind and `enter` on the one in front, so a plain toggle flickers.
  drop.addEventListener('dragleave', () => {
    hovering = Math.max(0, hovering - 1);
    if (!hovering) lit(false);
  });

  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    hovering = 0;
    lit(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) {
      // Text dragged out of an editor rather than a file: still a layout, and
      // refusing it would be pedantry.
      const text = e.dataTransfer?.getData('text/plain');
      if (text) return applyText(text, 'what you dropped');
      return say('That was not a file I can read.', false);
    }
    await readFile(file);
  });

  drop.addEventListener('click', () => picked.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picked.click(); }
  });
  picked.addEventListener('change', async () => {
    const file = picked.files?.[0];
    if (file) await readFile(file);
    // Cleared, so choosing the same file twice in a row still fires `change`.
    picked.value = '';
  });

  /**
   * Read a dropped or chosen file and apply it. The extension is checked only to
   * say something useful about an obvious mistake — a `.png` dragged in by
   * accident — and not as a gate: the parse is the real judge, and a layout saved
   * as `.txt` is still a layout.
   */
  async function readFile(file) {
    const looksRight = /\.json$/i.test(file.name) || file.type === 'application/json';
    let text;
    try { text = await file.text(); } catch {
      return say(`Could not read ${file.name}.`, false);
    }
    const ok = applyText(text, file.name, `Layout applied from ${file.name}.`);
    // A `.png` dragged in by accident gets the plainer explanation, since "not a
    // layout I can read" of a file that was never going to be one is unhelpful.
    if (!ok && !looksRight) say(`${file.name} is not a layout .json.`, false);
  }

  resetBtn.addEventListener('click', () => {
    onReset?.();
    say('Back to the authored layout.', true);
  });

  // A generated office says what it is called and what seed made it, because the
  // seed is the only way back to a room you liked: press Random six times and
  // the five you passed over are gone unless their seeds were on screen.
  rollBtn.addEventListener('click', () => {
    const result = onRoll?.() ?? {};
    say(result.ok
      ? `\u201c${result.name}\u201d \u2014 seed ${result.seed}`
      : 'Could not generate an office.', !!result.ok);
  });

  // The sections sit in a row of their own beneath the title: a section keeps its place
  // at every width and grows downwards rather than the row reflowing and shuffling the
  // controls about.
  // Items before Selected: the panel reads left to right as the order you work in —
  // pick something to put in the room, then say things about what is in it. Selected
  // also grows and shrinks as you choose different props (swatches appear for a rug and
  // not for a desk), and a section that changes height is better placed after the one
  // that does not than before it.
  body.append(kitGroup.el, selGroup.el, snapGroup.el, pathGroup.el, layoutGroup.el);
  watchStripRows(body);

  /**
   * Report the last thing that happened — or, given nothing to report, say nothing.
   *
   * The empty case is not a rounding error: entering edit mode calls this precisely to
   * clear whatever the last visit left behind. It used to un-fade the line and set an
   * empty message, so every `E` lit up the words `Last Action:` followed by a blank —
   * a label for news that had not happened. The label is part of the readout, so it
   * keeps the readout's own rule: absent until there is something to name.
   */
  function say(message, ok = true) {
    const words = (message ?? '').trim();
    statusText.textContent = words ? ` ${words}` : '';
    // Not merely faded: with nothing to say the label leaves the document altogether,
    // so a screen reader is not offered `Last Action:` on its own either.
    statusLabel.hidden = !words;
    status.classList.toggle('bad', Boolean(words) && !ok);
    status.classList.toggle('fade', !words);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = words ? setTimeout(() => status.classList.add('fade'), 5000) : null;
  }

  return {
    get isOpen() { return open; },

    show() { open = true; host.classList.remove('hidden'); },
    hide() { open = false; host.classList.add('hidden'); },

    /**
     * Say what is selected and where it is.
     *
     * @param {?{label: string, key: string, x: number, z: number, facing?: number,
     *           assignedTo?: ?string, markerStyle?: ?string}} sel
     *   null for nothing selected, which is the state the editor opens in. `assignedTo`
     *   is a desk's occupant, absent on everything that is not a desk.
     */
    setSelection(sel) {
      selName.textContent = sel ? displayName(sel.label, sel.key) : '';

      // A desk always answers, even when the answer is nobody — "No one" is a fact about
      // the desk, where a blank would read as the panel not having looked.
      const who = sel?.assignedTo;
      whoRow.el.hidden = who == null;
      if (who != null) whoOut.textContent = who;
      markerRow.el.hidden = !sel?.markerStyle;
      if (sel?.markerStyle) markerRow.value.textContent = sel.markerStyle;

      // A lamp has no facing, and saying "facing 0°" for one would invite somebody to
      // turn it — so the heading is left off rather than answered with a dash.
      posOut.replaceChildren();
      if (sel) {
        posOut.textContent = sel.facing == null
          ? `(${fixed(sel.x)}, ${fixed(sel.z)})`
          : `(${fixed(sel.x)}, ${fixed(sel.z)}) facing ${degrees(sel.facing)}`;
      } else {
        // With nothing picked the row says how to pick something — a key cap and two
        // words where the position would be, so the section still has a job when it is
        // empty. It loses its field name with them: `Position` labelling an instruction
        // would be a heading for the wrong thing.
        const kbd = node('kbd', '', 'Click');
        posOut.append(kbd, document.createTextNode(' Select item'));
      }

      // The rest belongs to the selection: no selection, nothing to say.
      hasSelection = !!sel;
      posRow.key.hidden = !sel;
      selActions.hidden = !sel;
    },

    /**
     * Redraw the list of furniture that can be brought in.
     *
     * Pushed from the editor after every change, because what may be added depends on
     * what is already there: the room that has just gained a coffee machine may not have
     * another, and the one that has just lost its spare bookshelf may.
     *
     * The selection survives a redraw where it can. Adding three plants in a row is a
     * normal thing to want, and a picker that reset itself to Desk each time would make
     * it three journeys through the list.
     *
     * Everything listed is something that can be added: the layout hands over only the
     * kinds there is room for, so there are no dead entries to grey out. A kind that goes
     * full simply leaves — which is a list that shortens by one the moment you add the
     * coffee machine, and is the behaviour to expect of a menu of things you can do.
     *
     * @param {{key: string, label: string}[]} items
     */
    /**
     * What the room can be given, and which of the jobs it needs are covered.
     *
     * Both together, because a section is worth drawing when it is *empty*: a room with
     * its one bookshelf has nothing to add under research, and "research · one needed ·
     * the bookshelf has it" is the useful thing to say there. The old picker listed only
     * what was addable and so could not say it at all.
     */
    setKit(items, roleState, channels) {
      kitMenu.setKit(groupKit(items, roleState), channels);
    },

    /**
     * Say what the selected prop can actually have done to it.
     *
     * One call rather than one per capability, because the hint under Items is written
     * from all of them at once and a panel told them one at a time would redraw that
     * line from a half-answer.
     *
     * Each reason goes on its own button rather than into the status line: it is a
     * property of the thing selected, not news about something that happened, so it
     * should be readable *before* pressing anything — which is what a tooltip on a
     * disabled button is for. Disabled rather than hidden for the same reason: a control
     * that vanishes takes its explanation with it.
     *
     * @param {{turn: {ok: boolean, why: string}, remove: {ok: boolean, why: string},
     *   duplicate: {ok: boolean, why: string},
     *   palette: ?{current: ?string, options: {key: string, label: string, hex: number}[]}}} can
     */
    setCapabilities(can) {
      deleteBtn.disabled = !can.remove.ok;
      deleteBtn.title = can.remove.ok
        ? 'Take the selected item out of the room (⌫)'
        : (can.remove.why || 'This item cannot be removed');
      duplicateBtn.disabled = !can.duplicate.ok;
      duplicateBtn.title = can.duplicate.ok
        ? 'Put a second one of this beside it (⌘D)'
        : (can.duplicate.why || 'This item cannot be duplicated');
      // With nothing picked the line is documentation of the mode and lists everything.
      drawHint(hasSelection ? { turns: can.turn.ok } : { turns: true });
      drawPalette(hasSelection ? can.palette : null);
    },

    /** @param {number} size  one of the keys of SNAPS */
    setSnap(size) {
      paintSnap(size);
    },

    /**
     * Reflect whether the route ribbons are showing.
     *
     * Pushed rather than owned here, because P sets the same thing: the panel draws the
     * state, the editor keeps it. A control that tracked its own clicks would drift out
     * of step the first time the key was used.
     *
     * @param {boolean} on
     */
    setPaths(on) {
      pathInput.checked = !!on;
      pathLabel.textContent = on ? 'On' : 'Off';
    },

    /**
     * Redraw the layout picker and the Save button for the room's mode.
     *
     * Pushed from the editor after every change to the room or the shelf. The
     * three modes are the whole vocabulary: `default` (the authored room),
     * `named` (the room is a layout off the shelf), `edited` (a change on top
     * of one of those, whose `parent` says which).
     *
     * @param {object} state
     * @param {{name: string}[]} state.layouts
     * @param {{kind: 'default'|'named'|'edited', name?: string, parent?: string,
     *   called?: ?string, seed?: ?string}} state.mode  `called` is the name a plan
     *   arrived with — generated or pasted — and `seed` is where it came from
     */
    setLayoutState({ layouts, mode }) {
      disarm();
      closeName();
      layoutMode = mode;

      /**
       * What the picker calls the plan the room is standing on.
       *
       * Three sources, in order of how much they know: a layout off the shelf
       * says its own name; a plan that *arrived already called something* — a
       * generated office, or a pasted blob carrying a name — says that; and
       * anything else is an edit of the authored Default.
       *
       * The middle one is the interesting case. A generated room is an edit
       * nobody has saved, so by the letter of the modes it is `Default *` — but
       * "Default" is exactly what it is not, and the whole point of generating a
       * room is that it is a particular room with a particular name. `mode.called`
       * is that name, and the `*` stays, because it is still unsaved.
       */
      const parentLabel = mode.parent && mode.parent !== 'default'
        ? mode.parent
        : (mode.called ?? 'Default');
      triggerText.textContent = mode.kind === 'default' ? 'Default'
        : mode.kind === 'named' ? mode.name
        : `${parentLabel} *`;
      // Where a name came from, for the one case where it is not obvious: a seed
      // is the only way back to a generated room, so the picker holds on to it.
      trigger.title = mode.seed
        ? `\u201c${parentLabel}\u201d, generated from seed ${mode.seed}`
        : 'Which layout this room is';
      picker.classList.toggle('edited', mode.kind === 'edited');

      saveBtn.disabled = mode.kind !== 'edited';
      saveBtn.title = mode.kind === 'edited'
        ? (mode.parent !== 'default'
          ? `Save these changes to \u201c${mode.parent}\u201d`
          : (mode.called
            ? `Save this as \u201c${mode.called}\u201d\u2026`
            : 'Save this as a new layout\u2026'))
        : (mode.kind === 'named'
          ? `This is \u201c${mode.name}\u201d, unchanged \u2014 nothing to save`
          : 'This is the Default layout \u2014 change something to save your own');

      // The menu: Default first, then the shelf, each row choose + rename + trash.
      menu.replaceChildren();
      const addRow = (label, { active, onChoose, name = null }) => {
        const row = node('div', 'layout-item');
        row.classList.toggle('active', active);
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'layout-choose';
        choose.setAttribute('role', 'option');
        choose.setAttribute('aria-selected', String(active));
        choose.textContent = label;
        choose.addEventListener('click', (e) => {
          e.stopPropagation();
          setPickerOpen(false);
          onChoose();
        });
        row.appendChild(choose);
        if (name) {
          const pen = document.createElement('button');
          pen.type = 'button';
          pen.className = 'layout-tool';
          pen.title = `Rename \u201c${name}\u201d`;
          pen.innerHTML = pencilMark;
          pen.addEventListener('click', (e) => {
            e.stopPropagation();
            setPickerOpen(false);
            askName('rename', name, name);
          });
          const bin = document.createElement('button');
          bin.type = 'button';
          bin.className = 'layout-tool layout-trash';
          bin.title = `Forget \u201c${name}\u201d`;
          bin.innerHTML = trashMark;
          bin.addEventListener('click', (e) => {
            e.stopPropagation();
            if (armed !== row) {
              disarm();
              armed = row;
              row.classList.add('arming');
              bin.title = 'Click again to forget it';
              armTimer = setTimeout(disarm, 4000);
              return;
            }
            disarm();
            setPickerOpen(false);
            onLayoutDelete?.(name);
            say(`Forgot \u201c${name}\u201d.`, true);
          });
          row.append(pen, bin);
        }
        menu.appendChild(row);
      };

      addRow('Default', {
        active: mode.kind === 'default',
        onChoose: () => onReset?.(),
      });
      for (const l of layouts) {
        addRow(l.name, {
          active: mode.kind === 'named' && mode.name === l.name,
          name: l.name,
          onChoose: () => onLayoutPick?.(l.name),
        });
      }
    },

    /** Report on the last thing that happened, e.g. a refused drop. */
    say,
  };
}
