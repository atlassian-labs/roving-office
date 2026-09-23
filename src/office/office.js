// The scenes of the office you are standing in.
//
// A scene is one room: a building, a season, and the set of agent sources that
// fill it. An office is a keycard and a list of them, and it lives on the server
// (lib/office-store.cjs) rather than in this browser — because an office is shared
// by sending someone its URL, and two people holding the same keycard have to see
// the same rooms. localStorage was the right home when an office was a private view
// of your own machine's agents; it is the wrong one now.
//
// So this module is a cache with a network behind it. Everything it exposes reads
// from the local copy synchronously — the render loop cannot await — while writes
// go to the server and are applied locally at the same time. The two things it
// keeps to itself are per-browser rather than per-office, and stay in localStorage
// where they belong:
//
//   * which scene *you* are looking at, because two people in one office can stand
//     in different rooms;
//   * the offices this browser has visited (src/office/recent.js), which is the only
//     record anywhere that your office exists;
//   * the write tokens of the offices it minted (src/office/owner.js), which are the
//     only record anywhere of who owns one — there are no accounts, so holding the
//     token *is* the ownership.
//
// Looks are rolled here rather than on the server: seasons, buildings and themes
// are src/projects.js's business, and a server with its own copy of the pools is a
// second opinion about what a warehouse floor looks like. A scene arrives with
// `look: null` the first time anyone opens it, gets one rolled, and hands it back.

import { PROJECTS, createScene as buildSceneRecord } from '../projects.js';
import { getSources } from '../data/sources.js';
import { generateOffice, officeFor } from '../plan/index.js';
import { officePath } from './keycard.js';
import { forgetRecent, rememberRecent } from './recent.js';
import { authHeader, forget as forgetOwner, owns } from './owner.js';
import { readText, writeText } from '../local-store.js';

/** The office this page is: read once from the URL, which is the whole address. */
export const keycard = officePath(window.location.pathname)?.keycard ?? null;

/** Everything about this office hangs off its own path. */
const base = keycard ? `/office/${keycard}` : null;

const ACTIVE_KEY = `roving-office.active.${keycard}`;

/** The office document as the server last described it. @type {?object} */
let office = null;

/** Hydrated scene records, in the office's order. @type {object[]} */
let scenes = [];

/** Called when the office turns out to be gone. Set by main.js. @type {?Function} */
let onGone = null;

// --- reading ---------------------------------------------------------------

/** Every scene in this office, hydrated into the shape the world builder wants. */
export function listScenes() {
  return scenes;
}

export function getScene(id) {
  return scenes.find((s) => s.id === id) ?? null;
}

/** The office as the server sees it: keycard, claim, viewer count. */
export function officeInfo() {
  return office;
}

/** The scene to open on load: the one you were last in, if it still exists. */
export function initialSceneId() {
  const remembered = readText(ACTIVE_KEY);
  if (remembered && getScene(remembered)) return remembered;
  return scenes[0]?.id ?? null;
}

export function rememberActive(id) {
  writeText(ACTIVE_KEY, id);
}

// --- loading --------------------------------------------------------------

/**
 * Fetch the office, creating it if this keycard has never been used.
 *
 * The GET is what makes an office exist: a keycard invented in the address bar,
 * or a link shared before anyone opened it, arrives here and becomes a room. That
 * is the whole of "sign-up" (requirement: a keycard URL with no office behind it
 * gets one), and it is why this returns an office rather than ever a 404.
 *
 * The one office it can fail to open is one whose owner has set a passcode. That
 * arrives as `401 {passcode: true}` and is not an error: it is a request for something
 * the person at the keyboard has and this code does not, so `onLocked` is handed the
 * job and hands back the office document once it has got in (see `tryPasscode`, which
 * is the only thing it needs from here). Given no `onLocked` — the debug log used to be
 * such a caller — it throws with the reason rather than pretending the office is
 * broken.
 *
 * The write token, when this browser holds one, goes on this one request. Nothing else
 * the tab does afterwards carries it: the unlock door hands a locked office's owner a
 * read seal on the way in, and that cookie is what the heartbeat and the streams ride
 * on. So the token is on the wire once per office opened rather than once per beat.
 *
 * @param {{onLocked?: ?(() => Promise<?object>)}} [opts]
 */
export async function loadOffice({ onLocked = null } = {}) {
  if (!base) {
    // No keycard in the path means this page was reached some other way; reception
    // is the only place that can hand one out.
    window.location.replace('/');
    return null;
  }
  const res = await fetch(`${base}/api`, { headers: authHeader(keycard) });
  if (res.status === 401 && (await body(res))?.passcode) {
    const unlocked = onLocked ? await onLocked() : null;
    if (!unlocked) throw new Error('this office has a passcode');
    adopt(unlocked);
    rememberRecent(keycard);
    return office;
  }
  if (!res.ok) throw new Error(`the office could not be opened (${res.status})`);
  adopt(await res.json());
  rememberRecent(keycard);
  return office;
}

/** A response's JSON, or null — for reading a refusal, where the shape is a guess. */
async function body(res) {
  try { return await res.json(); } catch { return null; }
}

// --- what an owner can do -------------------------------------------------
//
// Three acts, all authorised by the office's own write token and by nothing else
// (src/office/owner.js). None of them exists for a visitor who was merely sent the
// link, and none of them is available in the reserved demo office, which the server
// refuses outright rather than relying on the UI to hide the button.

/** Whether this browser holds this office's write token. */
export function isOwner() {
  return owns(keycard);
}

/**
 * Try a passcode at the unlock door.
 *
 * The response carries the office document, because a browser that has just got in
 * wants the room and not a second round trip — so a successful unlock is a complete
 * load, which is what lets `loadOffice` hand `onLocked` the whole job.
 *
 * @returns {Promise<{ok: true, office: object} | {ok: false, reason: string}>}
 */
export async function tryPasscode(passcode) {
  const res = await request(
    'POST',
    `${base}/api/passcode?viewer=${encodeURIComponent(viewerId)}`,
    { passcode },
  );
  if (!res) return { ok: false, reason: 'the office could not be reached' };
  const doc = await body(res);
  if (!res.ok) return { ok: false, reason: doc?.error ?? `server said ${res.status}` };
  return { ok: true, office: doc };
}

/**
 * Require a passcode of anyone who opens this office, or stop requiring one.
 *
 * `null` clears it, and clearing is the way back rather than a second control — the
 * same shape `renameScene` uses for the same reason. Changing a passcode invalidates
 * every seal already issued, so it doubles as "lock everyone out again", which is the
 * answer when a passcode has been shared further than intended.
 *
 * The office document is refreshed locally from the one fact that moved, rather than
 * adopted: the server's reply to a set is not the office, and re-adopting scenes here
 * would rebuild the room under someone standing in it.
 */
export async function setPasscode(passcode) {
  const res = await request('POST', `${base}/api/passcode`, { passcode }, { owner: true });
  if (!res) return { ok: false, reason: 'the office could not be reached' };
  const doc = await body(res);
  if (!res.ok) return { ok: false, reason: doc?.error ?? `server said ${res.status}` };
  if (office) office.passcode = Boolean(doc?.passcode);
  return { ok: true, passcode: Boolean(doc?.passcode) };
}

/**
 * Close this office: the link, every watcher, the event history and the furniture.
 *
 * The one revocation that revokes everything, and the reason the token above is worth
 * keeping at all. It is irreversible in the only sense that matters — the room and its
 * contents are gone — but it does *not* make the keycard stop resolving, because
 * visiting an unknown keycard creates an office. The leaked link opens an empty room,
 * and whoever kept it is told nothing.
 *
 * Both local records go with it: the token, because there is nothing left to own, and
 * the history entry, because a closed office is a dead link and offering it again is
 * the one thing that list must not do.
 */
export async function closeOffice() {
  const res = await request('DELETE', `${base}/api`, undefined, { owner: true, gone: false });
  if (!res) return { ok: false, reason: 'the office could not be reached' };
  if (!res.ok) {
    const doc = await body(res);
    return { ok: false, reason: doc?.error ?? `server said ${res.status}` };
  }
  forgetOwner(keycard);
  forgetRecent(keycard);
  return { ok: true };
}

/**
 * Take a server document as the truth, hydrating its scenes.
 *
 * Any scene nobody has ever looked at is an empty room, and this is where it
 * becomes a room: the generator is run for it (src/plan/) and the whole office it
 * produces — the season and building to dress it in, and the floor plan to
 * furnish it with — is applied locally and sent back.
 *
 * **A room is generated once, when it is first opened, and never again.** The
 * test is the *look*, not the layout, and that is deliberate: clearing a scene's
 * layout is how the editor's Reset says "back to the authored floor plan", so a
 * generator that ran on every absent layout would overrule it every reload. A
 * scene with no look, on the other hand, is a scene nobody has ever seen.
 *
 * The seed comes from the scene's own id rather than being minted, so two tabs
 * opening a brand-new office at the same instant generate the *same* office and
 * race to store an identical blob. That is strictly better than the look-rolling
 * this replaced, where the two rolled differently and the last write won.
 */
function adopt(doc) {
  office = doc;

  // A seed asked for by whoever opened the link, used once and for the first room
  // that needs one. It is how a plan on /docs/office-seeds.html becomes a room you
  // can walk into: reception mints a keycard and hands the seed on (see
  // `openNewOffice`). Everything after that room is seeded from its scene id as
  // usual, so `?seed=` furnishes one office rather than every room in it.
  let asked = new URLSearchParams(window.location.search).get('seed')?.trim() || null;

  const fresh = [];
  for (const record of doc.scenes ?? []) {
    if (record.authored || record.look) continue;
    const generated = asked ? generateOffice(asked) : officeFor(record.id);
    asked = null;
    record.look = generated.look;
    // Only if the scene has no plan of its own. A layout with no look is not a
    // case the app produces, but a stored office is a file on a server and this
    // is the one line that would overwrite somebody's room if it were wrong.
    if (!record.layout) record.layout = generated.layout;
    fresh.push(record);
  }

  scenes = (doc.scenes ?? []).map(hydrate);
  nameScenes();

  for (const record of fresh) {
    // Fire and forget: the room is already applied locally, and a failed PATCH
    // only means the next visitor generates the same office again.
    patchScene(record.id, { look: record.look, layout: record.layout }).catch(() => {});
  }
}

/**
 * One stored scene, as a record the world builder can consume.
 *
 * The authored scenes are resolved from src/projects.js rather than rebuilt:
 * someone chose the tower's grey concrete and the brownstone's January street, and
 * a record rolled from their id would throw that away.
 */
function hydrate(record) {
  if (record.authored) {
    const authored = PROJECTS.find((p) => p.id === record.id);
    if (authored) return { ...authored, sources: record.sources, record };
  }
  return {
    ...buildSceneRecord({
      id: record.id,
      season: record.look?.season,
      building: record.look?.building,
      sources: record.sources,
    }),
    record,
  };
}

/**
 * Name every scene after what fills it.
 *
 * Derived rather than stored, so a scene repointed from Test Data to Claude Code
 * renames itself instead of keeping a label that is now a lie. Authored scenes keep
 * their authored names, and a name someone typed themselves wins over both.
 *
 * Two names joined is still readable and still tells you what you are looking at;
 * three is a paragraph in a title bar, so past two the scene is simply "Mixed" and
 * the badge carries the roster of feeds.
 */
function nameScenes() {
  const seen = new Map();
  for (const scene of scenes) {
    const base = scene.record.name || (scene.record.authored ? scene.name : null) || sourceName(scene.sources);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    // "Test Data 2" rather than a second row you cannot tell apart from the first.
    scene.name = n === 1 ? base : `${base} ${n}`;
  }
}

function sourceName(ids) {
  const defs = getSources(ids);
  if (defs.length === 0) return 'Empty scene';
  if (defs.length === 1) return defs[0].label;
  if (defs.length === 2) return `${defs[0].label} + ${defs[1].label}`;
  return 'Mixed';
}

// --- writing --------------------------------------------------------------

/**
 * Add a scene: a generated office, filled with test agents.
 *
 * The room is generated *before* it is created, because the season, the building
 * and the floor plan are one decision — the rug and the upholstery are chosen to
 * suit the light (see `SCHEMES` in src/plan/brief.js), so rolling a look here and
 * generating a plan later would be two halves of one room decided separately.
 *
 * The seed is minted rather than derived, since the scene has no id until the
 * server gives it one; it travels inside the layout blob, so the room stays
 * reproducible from the moment it exists.
 *
 * Test Data rather than nothing, because a new room with no feed is a black screen
 * with no explanation, and Test Data needs no adapter and no waiting. Picking a
 * real harness afterwards drops it again — see the source picker.
 */
export async function addScene() {
  const generated = generateOffice();
  const rolled = buildSceneRecord({ ...generated.look });
  const created = await send('POST', `${base}/api/scenes`, {
    sources: rolled.sources.length ? rolled.sources : ['test-data'],
    look: rolled.look,
    layout: generated.layout,
  });
  if (!created) return null;
  office.scenes.push(created);
  scenes.push(hydrate(created));
  nameScenes();
  return scenes[scenes.length - 1];
}

/**
 * Point a scene at a set of sources.
 *
 * `testDataPinned` travels with them because it is the difference between "Test
 * Data is what a new scene starts with" and "Test Data is what I asked for": only
 * the second survives choosing a real harness later.
 */
export async function setSceneSources(id, sourceIds, { testDataPinned = false } = {}) {
  const updated = await patchScene(id, { sources: sourceIds, testDataPinned });
  if (!updated) return null;
  return replace(updated);
}

/** Store a look someone chose in the scene panel, so the room comes back that way. */
export async function setSceneLook(id, look) {
  const updated = await patchScene(id, { look });
  if (!updated) return null;
  return replace(updated);
}

/**
 * Store the layout someone has arranged, so the room comes back that way.
 *
 * Per scene rather than per office, for the same reason `look` is: a scene *is* a
 * room, and two rooms in one office are two different rooms. `null` clears it, which
 * is how a scene goes back to the layout authored in `src/layout.js`.
 *
 * The record is updated in place rather than rehydrated. A layout is opaque to
 * everything a record derives — its name, its look, its sources — so there is nothing
 * to recompute, and swapping the object would leave the world holding the scene it was
 * built from while the list held a different one.
 */
export async function setSceneLayout(id, layout) {
  const updated = await patchScene(id, { layout });
  if (!updated) return null;
  const scene = getScene(id);
  // `scenes[i].record` *is* `office.scenes[i]` — the same object, hydrated around —
  // so one write keeps both in step.
  if (scene) scene.record.layout = updated.layout ?? null;
  return scene;
}

/**
 * Name a scene, or hand it back to the name its feeds imply.
 *
 * A name someone typed wins over the derived one (see `nameScenes`), and an empty
 * one is not an error but the way back: it stores `null`, and the scene goes back to
 * being called after whatever fills it. That is why this sends `null` rather than
 * refusing a blank field — "undo the rename" needs somewhere to be, and a second
 * control for it would be a button that only ever does what clearing a field does.
 */
export async function renameScene(id, name) {
  const wanted = typeof name === 'string' ? name.trim() : '';
  const updated = await patchScene(id, { name: wanted || null });
  if (!updated) return null;
  return replace(updated);
}

/** Delete a scene. Returns a reason when the server refuses, for the caller to show. */
export async function removeScene(id) {
  const res = await request('DELETE', `${base}/api/scenes/${encodeURIComponent(id)}`);
  if (!res) return { ok: false, reason: 'the office could not be reached' };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, reason: body.error ?? `server said ${res.status}` };
  }
  adopt(await res.json());
  return { ok: true };
}

/**
 * Ask for this machine's adapter feed.
 *
 * There is one `endpoint.json` per machine holding one URL, so exactly one office
 * can receive local hooks — and the honest default is the office you are looking
 * at, provided it actually wants live agents. An office of Test Data scenes has no
 * use for the feed and does not take it from whoever had it, which is what stops a
 * glance at the demo office from silently unplugging your work.
 *
 * Fails quietly: it is local-only and pinnable with `--office`, so "no" is a normal
 * answer and not something to interrupt anyone about.
 */
export async function claimLocalEndpoint() {
  const wantsLive = scenes.some((scene) => getSources(scene.sources).some((def) => def.kind === 'aop'));
  if (!wantsLive || office?.claimed) return false;
  const res = await request('POST', `${base}/api/claim`);
  if (!res?.ok) return false;
  office = await res.json();
  return true;
}

/** How often to say we are still here. Comfortably inside the server's window. */
const HEARTBEAT_MS = 30_000;

/**
 * This tab, for as long as it is this tab — for **counting** the people in a room.
 *
 * Stable across a reload, because a reload is the same person and not a second one,
 * which is what `sessionStorage` buys and why it is used here.
 *
 * It is emphatically **not** unique per tab, and the comment that used to say so cost
 * an afternoon: a browser *copies* `sessionStorage` into a tab duplicated from another
 * — Duplicate Tab, ⌘-click, `window.open` from the page — so two tabs opened the way
 * anybody actually opens them share this id. For a headcount that is a harmless
 * undercount. For anything that has to tell two tabs apart it is wrong, which is what
 * `connectionId` below exists for.
 */
export const viewerId = (() => {
  const key = 'roving-office.viewer';
  try {
    const existing = window.sessionStorage?.getItem(key);
    if (existing) return existing;
    const fresh = Math.random().toString(36).slice(2, 10);
    window.sessionStorage?.setItem(key, fresh);
    return fresh;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
})();

/**
 * This page load, and nothing longer — for **telling two tabs apart**.
 *
 * The scene stream skips whoever made a change, so a tab is not told about its own
 * edit (see `watchScenes`). That makes "who am I" load-bearing for correctness rather
 * than for a statistic, and `viewerId` cannot carry it: two tabs duplicated from one
 * share that id, so each would be skipped as the author of the other's edit and both
 * would fall silent — which is exactly what happened.
 *
 * Never stored, because storage is the thing that leaks between tabs. A module runs
 * once per page load, so a duplicated tab runs it again and gets its own id, and a
 * reload deliberately gets a new one: there is nothing on the other side of a reload
 * that still needs to know which connection this was.
 */
export const connectionId = Math.random().toString(36).slice(2, 10);

/**
 * Keep the office alive while this tab is open, and notice if it dies.
 *
 * The heartbeat is what "watching" means: an office is deleted thirty minutes after
 * the last viewer stops beating and the last event arrives. A poll rather than a
 * held-open stream, because an indefinitely pending response stops Chrome's virtual
 * clock — which would make a headless screenshot of an office hang, and looking at
 * the room is how this project is checked.
 */
export function watchOffice({ onOffice, onLost } = {}) {
  if (!base) return () => {};
  onGone = onLost ?? null;

  const beat = async () => {
    const res = await request('POST', `${base}/api/heartbeat?viewer=${encodeURIComponent(viewerId)}`);
    if (!res?.ok) return;
    const doc = await res.json().catch(() => null);
    if (!doc || !office) return;
    // Only the office's own facts, not its scenes: adopting those would discard a
    // look this tab has rolled but not yet stored, and rebuild the room under
    // someone who is standing in it.
    // `viewers` and `passcode` are here because the keycard dialog draws both and a
    // dialog left open should not go stale: somebody else walking in changes the
    // headcount, and another of the owner's tabs can change the passcode.
    Object.assign(office, {
      claimed: doc.claimed, viewers: doc.viewers, reserved: doc.reserved, passcode: doc.passcode,
    });
    onOffice?.(office);
  };

  beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  // A tab coming back from the background may have missed several beats while its
  // timers were throttled, so it says hello again immediately rather than waiting
  // out the interval in an office that is counting down.
  const wake = () => { if (document.visibilityState === 'visible') beat(); };
  document.addEventListener('visibilitychange', wake);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', wake);
  };
}

// --- internals -----------------------------------------------------------

/**
 * Listen for scene changes made from somewhere else, and keep the local scenes in
 * step with them.
 *
 * A held-open stream rather than a poll, which is the opposite of what presence does
 * next door — and for the opposite reason. A heartbeat is a fact about *this* tab and
 * thirty seconds late is no worse than on time; a scene change is a fact about the
 * room, and two tabs open side by side is exactly the case where late is useless.
 *
 * The server never sends us our own edits, so `onScene` only ever fires for a change
 * somebody else made and there is no echo to filter here.
 *
 * @param {{onScene?: (scene: object) => void}} [handlers]
 * @returns {() => void} stop listening
 */
export function watchScenes({ onScene } = {}) {
  if (!base || typeof window.EventSource !== 'function') return () => {};

  const source = new window.EventSource(`${base}/api/stream?viewer=${encodeURIComponent(connectionId)}`);
  source.addEventListener('scene', (msg) => {
    let record;
    try { record = JSON.parse(msg.data); } catch { return; }
    if (!record?.id) return;

    // The stored record is updated whatever the change was, so that a scene switch or
    // a reload is right even for the parts that are not applied live. `replace` would
    // rehydrate and hand the world a different object than the one it was built from,
    // which is a bigger claim than "one field moved".
    const scene = getScene(record.id);
    if (!scene) return;
    Object.assign(scene.record, record);
    onScene?.(scene);
  });
  // No error handling beyond the browser's own: EventSource reconnects by itself, and
  // an office that has gone away is noticed by the heartbeat, which is the thing whose
  // job that is.
  return () => source.close();
}

/**
 * Change a scene, naming this page load as the one that changed it.
 *
 * `connectionId`, and it has to be the same id the stream subscribed with, or the
 * server has nothing to match and a tab is told about its own edit after all.
 */
function patchScene(id, body) {
  const url = `${base}/api/scenes/${encodeURIComponent(id)}?viewer=${encodeURIComponent(connectionId)}`;
  return send('PATCH', url, body);
}

/** Swap an updated scene record in, keeping the array order. */
function replace(record) {
  const at = scenes.findIndex((s) => s.id === record.id);
  if (at < 0) return null;
  office.scenes[at] = record;
  scenes[at] = hydrate(record);
  nameScenes();
  return scenes[at];
}

async function send(method, url, body) {
  const res = await request(method, url, body);
  if (!res?.ok) return null;
  return res.json();
}

/**
 * One request, with the reaped-office case handled once.
 *
 * A 404 here does not mean a bad URL: it means the office was deleted for being
 * empty while this tab held a menu describing it. Recreating it silently would be
 * worse than saying so, so the caller is told through `onLost` and can offer the
 * reload that makes the room again.
 *
 * Two options, both about credentials and both narrow on purpose:
 *
 *   * `owner` puts this office's write token on the request. Only the acts that
 *     genuinely need it ask for it — closing the office, and setting or clearing its
 *     passcode — so the token is not on the wire behind every heartbeat.
 *   * `gone` is turned off by the caller that is *itself* deleting the office. A 404
 *     from `closeOffice` means somebody got there first, which is the outcome it wanted;
 *     announcing it as a room that vanished under us would be a warning about success.
 *
 * @param {{owner?: boolean, gone?: boolean}} [opts]
 */
async function request(method, url, body, { owner = false, gone = true } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(owner ? authHeader(keycard) : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 404 && gone) onGone?.();
    return res;
  } catch {
    return null;
  }
}
