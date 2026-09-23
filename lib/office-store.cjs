// Offices: what a keycard actually opens.
//
// An office is a set of scenes, the local endpoint's claim, and a private AOP bus.
// It is created the moment someone asks for its keycard — visiting an unknown
// keycard *is* how you make an office (there is no "create" step to skip) — and it
// is deleted thirty minutes after the last person stops watching it and the last
// event stops arriving. Nobody is asked to tidy up, because nobody owns it.
//
// Two things are deliberately *not* here:
//
//   * What a scene looks like. Seasons, buildings and themes are the browser's
//     business (src/projects.js), so a scene's `look` starts as null and the first
//     client to open it rolls one and PATCHes it back. The server would otherwise
//     need its own copy of the pools, and two copies of a palette is how a
//     warehouse ends up around a brownstone floor.
//   * Which scene you are looking at. That is per-tab, not per-office: two people
//     holding the same keycard can stand in different rooms, so it lives in their
//     own localStorage.
//
// Persistence is a single JSON file rewritten debounced. It exists so that
// restarting the server does not evict everyone from offices they are still
// standing in — not as a database. An office that was already past its deadline
// when we come back up is not resurrected.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createAopBus } = require('./aop-bus.cjs');

/**
 * How long an office survives with nobody watching and nothing arriving.
 *
 * The default is sized for a laptop, where an office is a scratch thing you opened
 * this afternoon and half an hour of silence means you are done with it. A hosted
 * office is not that: its keycard has been given to someone, the machine stops
 * whenever nobody is looking, and a night's gap would otherwise empty the store on
 * the next boot — the reaper undoing the durable disk underneath it. So the deadline
 * is per-store rather than global, and `server.cjs` lets a deployment set its own.
 */
const IDLE_TTL_MS = 30 * 60_000;

/** How often we look for offices past their deadline. */
const SWEEP_MS = 60_000;

/**
 * How long a heartbeat counts for.
 *
 * Presence is a heartbeat rather than a held-open socket, which is the smaller
 * mechanism *and* the one that does not break tooling: an indefinitely pending
 * response stops Chrome's virtual clock from advancing, so a headless screenshot of
 * an office would hang forever — and looking at the room is how this project is
 * checked (AGENTS.md). Generous enough for a browser that throttles timers in a
 * background tab, short enough that a closed laptop stops counting quickly.
 */
const PRESENCE_TTL_MS = 90_000;

/** Debounce on the persistence write, so a busy office is not a busy disk. */
const SAVE_DEBOUNCE_MS = 500;

const STORE_VERSION = 1;

/**
 * How many live ingest tokens one office may hold.
 *
 * Enough for every machine anyone has plausibly pointed at one room — a laptop, a
 * desktop, a gateway, a CI job — and few enough that the list stays something a
 * person can read and reason about. An uncapped list is two bad things at once: an
 * unbounded store file, and a slowly growing set of live write credentials that
 * nobody is tracking any more.
 */
const MAX_TOKENS = 10;

/**
 * How many offices one store may hold at once.
 *
 * Creating an office needs no credential — that is the product, not an oversight
 * (see `open`) — so the only thing between a public deployment and an unbounded
 * registry is a number, and this is it. Three doors create offices: the mint
 * endpoint, a first visit to a keycard nobody has used, and an adapter posting into
 * an office that was reaped while its harness was quiet. A cap that guarded one of
 * them would not be a cap, so it lives here, where all three arrive.
 *
 * Five hundred, because the numbers around it are small: the hosted office runs on
 * one 512 MB machine with a 30-day idle deadline, each office carries its own
 * 2 000-event ring buffer, and the whole registry is one JSON file rewritten on
 * every edit. Five hundred rooms is more than that demo will ever legitimately hold
 * and still leaves the file and the heap in the range where nothing has to be clever.
 * A deployment that wants a different number sets `ROVING_OFFICE_MAX_OFFICES`.
 *
 * The demo office is exempt, as it is from the reaper: it is the address the front
 * door redirects to, and a full store that cannot serve `/` is a worse failure than
 * a full store.
 */
const MAX_OFFICES = 500;

/**
 * A label is a human's note to themselves about which machine this is.
 *
 * Long enough for "mike's laptop (the one by the window)", short enough that the
 * field cannot become somewhere to keep things.
 */
const LABEL_MAX_CHARS = 60;

/**
 * How coarsely `lastUsedAt` is recorded.
 *
 * It exists to answer "is anything still using this?" before you revoke it, and a
 * minute is far finer than that question needs. Recording every write would dirty
 * the store on every accepted event and turn a busy office into a busy disk — the
 * exact thing `SAVE_DEBOUNCE_MS` exists to prevent, arriving through a different door.
 */
const LAST_USED_GRANULARITY_MS = 60_000;

/**
 * What a minted token looks like, before the random part.
 *
 * A bare hex string is indistinguishable from every other hex string, so a leaked one
 * is unrecognisable in a log, a paste, or a secret scanner's ruleset. The prefix costs
 * four characters and makes it obvious on sight what has escaped. Verification hashes
 * whatever it is given and never inspects the shape, so tokens minted before this
 * existed keep working unchanged.
 */
const TOKEN_PREFIX = 'rot_';

/**
 * The passcode's key derivation, and why it is not the digest tokens use.
 *
 * A write token is 32 random bytes, so `sha256` of it is already out of reach: there is
 * nothing to guess. A passcode is a handful of characters a person chose and can retype
 * from memory, and the store file sits on a mounted volume — a bare digest of six
 * characters is an offline crack in seconds on anything with a GPU. So a KDF, with a
 * per-office salt, and `crypto.scryptSync` is already in this file's imports: no
 * dependency, no build step, no second opinion about hashing.
 *
 * `N = 2^14` costs 16 MB and tens of milliseconds on a laptop, and rather more on a
 * shared-cpu hosted machine. That is affordable because the server never verifies a
 * passcode faster than its per-office attempt limiter allows (`server.cjs`), which is
 * what makes a short secret survivable in the first place — the KDF alone would not.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

/**
 * A human-chosen secret, stretched. **The only key derivation in this project.**
 *
 * At module scope and exported rather than closed over the store, because there is a
 * second human-chosen secret in the system — the admin console's password (`server.cjs`)
 * — and two scrypt call sites would be two opinions about cost parameters, drifting
 * apart the first time one of them is tuned. A secret a person types goes through this
 * function or it is a bug.
 */
function deriveKey(plaintext, salt) {
  return crypto
    .scryptSync(plaintext, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
    .toString('hex');
}

/**
 * Are these the same digest? Constant-time, and length-safe before it gets there.
 *
 * `timingSafeEqual` **throws** on differing lengths rather than returning false, so the
 * length check is not an optimisation and removing it turns a wrong secret into a 500.
 * Exported for the same reason `deriveKey` is: comparing a secret with `===` anywhere in
 * this project should be impossible to do by accident, and the way to manage that is for
 * there to be one obvious function to reach for instead.
 */
function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * How long a passcode may be, at both ends.
 *
 * The floor is four characters, which is not security — the limiter is — but a refusal
 * to accept something that was obviously a slip of the hand on the way to an empty
 * field. The ceiling is because scrypt's cost is paid by *this* server on every
 * attempt, so the length of its input is not a caller's decision to make unbounded.
 */
const PASSCODE_MIN_CHARS = 4;
const PASSCODE_MAX_CHARS = 64;

/**
 * How much stored layout a scene may carry.
 *
 * The authored room is twenty-one props and about two kilobytes, so this is roomy
 * enough to be no constraint on anything anyone lays out by hand, and small enough
 * that a PATCH cannot turn the store file into a place to keep things.
 */
const LAYOUT_MAX_CHARS = 64 * 1024;

/**
 * Keepalive on the scene stream, matching the AOP bus.
 *
 * Without traffic a proxy or a sleeping laptop drops the connection quietly, and a
 * tab that has silently stopped listening is worse than one that never was.
 */
const WATCH_PING_MS = 15_000;

/**
 * The scenes of the reserved demo office, by id.
 *
 * Ids only: every one of them is authored in src/projects.js, down to the tower's
 * grey concrete and the warehouse's October, and the client resolves them from
 * there. Restating their looks here would be a second opinion about what "Kestrel
 * Tower" means.
 */
const AUTHORED_SCENE_IDS = [
  'startup-ai', 'initech-llc', 'dotcom-bcorp',
  // The one surviving prototype, authored in exactly the same way. Ids listed
  // here must exist in src/projects.js: an unknown id hydrates as a duplicate
  // of the first project wearing the wrong name, which is how three retired
  // prototypes haunted the demo office for a while.
  'proto-atelier',
];

/**
 * @param {object} opts
 * @param {object} opts.keycard     the src/keycard.js module (one definition of the format)
 * @param {string} opts.file        where to persist
 * @param {number} [opts.idleTtlMs]  how long an unwatched, silent office survives
 * @param {number} [opts.maxOffices] how many offices may exist at once
 * @param {(msg: string) => void} [opts.log]
 * @param {(card: string, at: {reserved: boolean}) => void} [opts.onOpen]
 * @param {(card: string, at: {reserved: boolean, reason: string}) => void} [opts.onClose]
 *
 * `onOpen` and `onClose` exist so that something outside can keep a tally of offices
 * opened and closed (`lib/stats-store.cjs`). They are **here** rather than at the
 * server's call sites because this is the only place that sees every one: four routes
 * reach `open`, two of them through a keycard nobody typed on purpose, and `remove` is
 * called both by a person closing a room and by the reaper an hour later. Counting from
 * outside would mean finding all six and finding the next one too.
 *
 * Both are called after the change has happened and their return value is ignored: a
 * tally is not allowed an opinion about whether an office may exist.
 */
function createOfficeStore({
  keycard, file, idleTtlMs = IDLE_TTL_MS, maxOffices = MAX_OFFICES, log = () => {},
  onOpen = () => {}, onClose = () => {},
}) {
  /** @type {Map<string, object>} */
  const offices = new Map();

  /**
   * Which office the machine's adapters are currently posting into.
   *
   * There is one `endpoint.json` per machine and it holds one URL, so exactly one
   * office can be the destination for local hooks. Kept here rather than in
   * server.cjs because it has to survive a restart with the offices it refers to.
   * @type {?string}
   */
  let claimed = null;

  let saveTimer = null;

  // --- shape helpers -------------------------------------------------------

  function newSceneId() {
    // A timestamp alone is not unique: two scenes created in the same millisecond
    // would share an id, and the second would silently edit the first.
    return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  /**
   * A scene as stored: what it is fed by, and how it looks once someone has looked.
   *
   * `sources` defaults to Test Data because a new scene with nothing in it is a
   * black room with no explanation, and Test Data needs no adapter, no harness and
   * no waiting. `testDataPinned` records that a *person* chose it, which is what
   * lets the picker drop it silently when they pick a real harness instead.
   */
  function makeScene({
    id = newSceneId(),
    name = null,
    sources = ['test-data'],
    testDataPinned = false,
    look = null,
    layout = null,
    authored = false,
  } = {}) {
    return {
      id,
      name,
      sources: normaliseSources(sources),
      testDataPinned: Boolean(testDataPinned),
      look: normaliseLook(look),
      layout: normaliseLayout(layout),
      authored: Boolean(authored),
    };
  }

  function normaliseSources(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    return [...new Set(list.filter((id) => typeof id === 'string' && id.length <= 64))];
  }

  /**
   * A look is two opaque strings, a bearing, a place on earth, or nothing.
   *
   * The browser owns what the strings mean, as it always has. The numbers are a
   * different matter, because they are angles and this side knows what angles do.
   *
   * A bearing *wraps*: 370° is 10° and −90° is 270°, so a caller that adds a turn to
   * one gets a room that has turned rather than one stuck against a stop. A longitude
   * wraps for the same reason, round the date line.
   *
   * A latitude *clamps*, because it does not wrap: 91°N is not 89°S on the other
   * side of the world, it is a mistake, and the pole is the nearest true thing to it.
   *
   * The pair is kept together or not at all. Half a location is not a place, and the
   * sun would silently read the leftover half as an equator.
   */
  function normaliseLook(look) {
    if (!look || typeof look !== 'object') return null;
    const season = typeof look.season === 'string' ? look.season.slice(0, 32) : null;
    const building = typeof look.building === 'string' ? look.building.slice(0, 32) : null;
    const bearing = Number.isFinite(look.bearing) ? wrapDegrees(Math.round(look.bearing)) : null;

    const located = Number.isFinite(look.lat) && Number.isFinite(look.lon);
    const lat = located ? round4(Math.min(90, Math.max(-90, look.lat))) : null;
    const lon = located ? round4(((wrapDegrees(look.lon) + 180) % 360) - 180) : null;

    if (!season && !building && bearing === null && !located) return null;
    return { season, building, bearing, lat, lon };
  }

  /**
   * An angle brought back into 0–360, whichever way round it arrived.
   *
   * Deliberately does not round: a bearing is whole degrees and rounds itself before
   * calling, but a longitude is not, and rounding here would flatten a pin to the
   * nearest hundred kilometres.
   */
  function wrapDegrees(deg) {
    return ((deg % 360) + 360) % 360;
  }

  /**
   * Four decimal places, which is about eleven metres.
   *
   * Far finer than anything the sun can tell apart — a tenth of a degree of latitude
   * moves sunset by well under a minute — and it stops a dragged pin writing
   * seventeen significant figures into the store on every frame.
   */
  function round4(deg) {
    return Math.round(deg * 1e4) / 1e4;
  }

  /**
   * A layout is the furniture editor's blob, kept whole and read by nobody here.
   *
   * Like `look`, the browser owns its meaning. `src/layout.js` versions it, clamps a
   * prop back into the room and forgives what it cannot understand, and repeating any
   * of that here would be a second opinion to keep in step with the first. What this
   * side does own is the *size*, because a scene is written to a file on every edit
   * and an unbounded blob is how that file stops being small.
   *
   * The round trip through JSON is the copy: it drops what cannot be stored anyway,
   * and it means a caller cannot keep a live reference into a stored scene.
   */
  function normaliseLayout(blob) {
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return null;
    let text;
    try { text = JSON.stringify(blob); } catch { return null; }
    if (!text || text.length > LAYOUT_MAX_CHARS) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  function makeOffice(card, {
    scenes,
    createdAt = Date.now(),
    lastSeenAt = Date.now(),
    tokens = [],
    passcode = null,
  } = {}) {
    return {
      keycard: card,
      createdAt,
      /**
       * The optional second tier: a secret a *reader* has to present.
       *
       * `null` on every office until somebody holding a write token sets one, and that
       * is the whole of "optional" — an office with no passcode behaves exactly as every
       * office did before this field existed, which is the property the front door
       * depends on (`/` redirects into the demo, and the demo refuses a passcode).
       *
       * Never the passcode itself: a salt, a scrypt digest and when it was set. See
       * `setPasscode`.
       * @type {?{ salt: string, hash: string, setAt: number }}
       */
      passcode,
      /** Last time anyone was watching or anything arrived — the reaper reads this. */
      lastSeenAt,
      /**
       * Every credential currently allowed to write into this office.
       *
       * Hashes, never the tokens: a store file readable by anyone who can read `$HOME`
       * should not be a set of write credentials, and we never need the originals back
       * — verification only ever compares.
       *
       * A *list*, because one secret shared by every machine is not a credential, it
       * is a password. With one hash the only revocation available was re-minting,
       * which revoked everybody: taking one laptop away meant reinstalling on all of
       * them. Each entry carries an `id` — public, not a secret — so a machine can be
       * named, listed and removed without anything ever having to show a token again.
       * @type {{ id: string, hash: string, label: ?string, createdAt: number, lastUsedAt: ?number }[]}
       */
      tokens,
      reserved: card === keycard.DEMO_KEYCARD,
      scenes: scenes ?? [makeScene()],
      /**
       * Recent heartbeats, by the tab that sent them. A live entry means someone is
       * in the room; the map is pruned as it is read, so nothing has to expire it.
       * @type {Map<string, number>}
       */
      viewers: new Map(),
      /**
       * Tabs listening for scene changes over SSE.
       *
       * Separate from `bus` on purpose. That one carries *agent* events: a ring
       * buffer, filtered by harness, replayed to rebuild a session someone missed.
       * A scene change is none of those things — there is nothing to replay, because
       * the office document a tab fetches on load is already the whole truth — so
       * putting it through the bus would mean a layout edit surfacing in an agent's
       * event log and ageing out of a buffer sized for tool calls.
       * @type {Set<{res: object, viewer: ?string, ping: any}>}
       */
      watchers: new Set(),
      bus: createAopBus(),
    };
  }

  /** The demo office: the authored scenes, all on Test Data, never reaped. */
  function seedDemo() {
    return AUTHORED_SCENE_IDS.map((id) => makeScene({ id, authored: true, sources: ['test-data'] }));
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Whether one more office would go past the cap.
   *
   * Asked before refusing rather than instead of it, and it sweeps first: an office
   * past its deadline is already gone in every sense but the map entry, and refusing
   * a visitor to hold on to litter would be the wrong answer to the right question.
   */
  function full() {
    if (offices.size < maxOffices) return false;
    sweep();
    return offices.size >= maxOffices;
  }

  /**
   * The office for this keycard, created if it does not exist.
   *
   * Requirement and feature both: a keycard URL that names no office makes one, so
   * a link shared before the office was ever opened still works, and "make me an
   * office" needs no separate button anywhere but the wizard.
   *
   * It is also the reason this store has a cap. Creation needs no credential by
   * design, so the number of rooms is bounded by a number and nothing else; past it
   * this throws rather than returning null, because every caller either creates an
   * office or has nothing to hand back, and a silent null would be dereferenced by
   * the next line in three separate places. The error carries
   * `code: 'store-full'` so `server.cjs` can answer it with a sentence rather than
   * a stack trace.
   */
  function open(card) {
    const found = offices.get(card);
    if (found) return found;
    if (card !== keycard.DEMO_KEYCARD && full()) {
      throw Object.assign(
        new Error(`this office server is full: it already holds ${offices.size} offices, the most it will keep at once`),
        { code: 'store-full', maxOffices },
      );
    }
    const office = makeOffice(card, card === keycard.DEMO_KEYCARD ? { scenes: seedDemo() } : {});
    offices.set(card, office);
    log(`[office] ${card} opened (${office.scenes.length} scene${office.scenes.length === 1 ? '' : 's'})`);
    onOpen(card, { reserved: office.reserved });
    save();
    return office;
  }

  function get(card) {
    return offices.get(card) ?? null;
  }

  function has(card) {
    return offices.has(card);
  }

  /**
   * A keycard no office is using. The store is the only authority on that.
   *
   * Node's own CSPRNG goes in explicitly, because `globalThis.crypto` only exists
   * from Node 19 and the keycard module refuses to mint without one rather than
   * quietly reaching for `Math.random()` — a keycard is the only lock an office has.
   */
  function mint() {
    return keycard.mint(
      (candidate) => offices.has(candidate),
      { bytes: (n) => new Uint8Array(crypto.randomBytes(n)) },
    );
  }

  /** Make a new office at a fresh keycard, and hand back the whole thing. */
  function create() {
    return open(mint());
  }

  // --- the ingest capability -----------------------------------------------

  const hashToken = (plaintext) => crypto.createHash('sha256').update(String(plaintext)).digest('hex');

  /** A label as it will be stored: a short string, or nothing. */
  function normaliseLabel(label) {
    if (typeof label !== 'string') return null;
    const trimmed = label.trim().slice(0, LABEL_MAX_CHARS);
    return trimmed || null;
  }

  /**
   * Mint another ingest token for this office and return it, once.
   *
   * The two capabilities an office hands out are deliberately different sizes. A
   * keycard is eight characters because a person reads it aloud, and it lets you
   * *watch*. A token is 32 random bytes because only a machine ever types it, and it
   * lets you *write* — so it is minted separately, returned exactly once to whoever
   * asked, and never included in `toJSON`. Sharing a keycard therefore invites
   * someone into the room without letting them staff it.
   *
   * **Who may call this is the whole of the security story, and it is not decided
   * here.** `server.cjs` requires an *existing* token on the mint route, never the
   * keycard alone: a keycard that could mint would be a keycard that can write, and
   * the split above would be over. Capability begets capability, and the chain
   * starts at the office's creation.
   *
   * The consequence is deliberate and worth saying out loud: lose every token and the
   * office is read-only for good. There is no owner to recover through, because this
   * project has no owners anywhere — no login, no listing, no account. An office is
   * disposable; the answer is another office.
   *
   * @returns {{ id: string, token: string, label: ?string, createdAt: number }}
   */
  function mintWriteToken(office, { label = null } = {}) {
    if (office.tokens.length >= MAX_TOKENS) {
      throw new Error(`an office holds at most ${MAX_TOKENS} ingest tokens; revoke one first`);
    }
    const plaintext = TOKEN_PREFIX + crypto.randomBytes(32).toString('hex');
    const record = {
      // Public, and unrelated to the secret. Deriving it from the hash would make the
      // list a set of hints about the credentials it is meant to describe.
      id: crypto.randomBytes(6).toString('hex'),
      hash: hashToken(plaintext),
      label: normaliseLabel(label),
      createdAt: Date.now(),
      lastUsedAt: null,
    };
    office.tokens.push(record);
    save();
    return { id: record.id, token: plaintext, label: record.label, createdAt: record.createdAt };
  }

  /**
   * Does `supplied` open this office for writing?
   *
   * The loop **always runs to the end**. Returning on the first match would take a
   * time that depends on how far down the list the matching token sits, which is a
   * slow way of telling an attacker something about a set of credentials they are not
   * holding. The whole sweep costs a handful of 32-byte comparisons, and the answer is
   * the OR of all of them.
   *
   * Each comparison is `timingSafeEqual` on two SHA-256 hex digests, so both sides are
   * always the same length and the compare is genuinely constant-time rather than
   * constant-time-if-the-lengths-agree.
   *
   * An office with no tokens refuses everything: absence is not a wildcard.
   */
  function verifyWriteToken(office, supplied) {
    if (!office?.tokens?.length || !supplied) return false;
    const offered = Buffer.from(hashToken(supplied));
    let ok = false;
    for (const record of office.tokens) {
      const known = Buffer.from(record.hash);
      // Bitwise on purpose: `||` would short-circuit and put the early return this
      // loop exists to avoid straight back in.
      ok = Boolean(ok | (known.length === offered.length && crypto.timingSafeEqual(offered, known)));
    }
    // Which one matched is only asked once the answer is yes, so this ordinary
    // `find` runs for callers who have already proved they hold a token. There is
    // nothing left for its timing to leak.
    if (ok) noteTokenUsed(office, offered);
    return ok;
  }

  /**
   * Remember that a token was used, rarely enough that it is not a write per event.
   *
   * `lastUsedAt` is here to answer "is anything still using this?" before somebody
   * revokes it, and a minute's resolution answers that completely. Skipping the save
   * when the value has not moved is what keeps a busy office off the disk.
   */
  function noteTokenUsed(office, offeredHash) {
    const record = office.tokens.find((t) => t.hash === offeredHash.toString());
    if (!record) return;
    const now = Date.now();
    if (record.lastUsedAt && now - record.lastUsedAt < LAST_USED_GRANULARITY_MS) return;
    record.lastUsedAt = now;
    save();
  }

  /**
   * Every live token, described but never revealed.
   *
   * Metadata only — there is no route anywhere that will tell you a token again, and
   * that is not an oversight. What this does carry is a map of who can write into the
   * room, which is why `server.cjs` asks for a token before showing it rather than
   * accepting the keycard a viewer already holds.
   */
  function listWriteTokens(office) {
    return office.tokens.map(({ id, label, createdAt, lastUsedAt }) => ({
      id, label, createdAt, lastUsedAt,
    }));
  }

  /**
   * Revoke one token by its id — unless it is the last one.
   *
   * Refusing the last one is the same refusal `removeScene` makes about the last
   * room, for the same reason: minting needs a token, so an office with none can
   * never have another, and nothing in the UI or the API could get it back. That is
   * a state to be unable to reach by accident, not a capability to offer. An office
   * you want silenced is one you stop handing the keycard to; it reaps itself soon
   * enough.
   */
  function revokeWriteToken(office, id) {
    if (!office.tokens.some((t) => t.id === id)) return { ok: false, reason: 'no such token' };
    if (office.tokens.length <= 1) {
      return { ok: false, reason: 'an office keeps at least one ingest token — minting needs one' };
    }
    office.tokens = office.tokens.filter((t) => t.id !== id);
    save();
    return { ok: true };
  }

  // --- the optional read passcode ------------------------------------------
  //
  // A door on the room, and nothing more than that. It is worth being exact about what
  // it is for, because a passcode invites more faith than it can carry:
  //
  //   * It answers **the link leaking on its own** — a screenshot with the address bar
  //     in it, a keycard pasted into a company-wide channel, a bookmark synced to a
  //     personal account. That is the ordinary leak, precisely because a URL is what
  //     tooling copies by itself and a passcode is what a person has to type on purpose.
  //   * It does **not** answer the link and the passcode leaking together, and it
  //     un-sees nothing that a watcher has already read out of the ring buffer. For
  //     either of those the answer is `remove` — closing the office.
  //   * It is **not redaction.** What the room reveals is decided on the emitting
  //     machine (docs/user/connect-your-agents.md), and this changes that by not one
  //     line.
  //
  // Who may set one is not decided here: `server.cjs` requires a write token, the same
  // rule as every other privileged act on an office. There is no owner record anywhere,
  // because there are no accounts — holding the token *is* being the owner.

  /** Whether a reader has to present anything beyond the keycard. */
  function hasPasscode(office) {
    return Boolean(office?.passcode);
  }

  /**
   * A passcode as it will be stored, or a reason it will not be.
   *
   * Trimmed, because a passcode read off a card and typed into a field arrives with
   * whitespace round it about half the time and a secret nobody can retype is not a
   * secret, it is a lockout.
   */
  function normalisePasscode(plaintext) {
    if (typeof plaintext !== 'string') return { ok: false, reason: 'a passcode is a string' };
    const trimmed = plaintext.trim();
    if (trimmed.length < PASSCODE_MIN_CHARS) {
      return { ok: false, reason: `a passcode is at least ${PASSCODE_MIN_CHARS} characters` };
    }
    if (trimmed.length > PASSCODE_MAX_CHARS) {
      return { ok: false, reason: `a passcode is at most ${PASSCODE_MAX_CHARS} characters` };
    }
    return { ok: true, passcode: trimmed };
  }

  /**
   * Require a passcode on this office, or change the one it has.
   *
   * A fresh salt every time, so setting the same passcode twice does not write the same
   * record — and, more usefully, so **changing the passcode invalidates every cookie
   * already issued** (see `passcodeSeal`, whose key is this hash). That is passcode
   * rotation, and it costs nothing beyond remembering to re-salt.
   *
   * @returns {{ok: true, setAt: number} | {ok: false, reason: string}}
   */
  function setPasscode(office, plaintext) {
    const checked = normalisePasscode(plaintext);
    if (!checked.ok) return checked;
    const salt = crypto.randomBytes(16).toString('hex');
    office.passcode = { salt, hash: deriveKey(checked.passcode, salt), setAt: Date.now() };
    save();
    return { ok: true, setAt: office.passcode.setAt };
  }

  /** Open the office to anyone holding the keycard again. */
  function clearPasscode(office) {
    if (!office.passcode) return false;
    office.passcode = null;
    save();
    return true;
  }

  /**
   * Does `plaintext` open this office for reading?
   *
   * An office with no passcode answers **false**, not true: this is the question "is
   * this the secret", and an office with no secret has no secret to match. Whether a
   * reader may in fact come in is a different question, and `server.cjs` asks it as
   * one (`passcodeOk`) — absence is not a wildcard here for the same reason it is not
   * one in `verifyWriteToken`.
   *
   * Constant-time on two equal-length digests, which costs nothing and means a wrong
   * passcode leaks nothing through timing about how much of it was right.
   */
  function verifyPasscode(office, plaintext) {
    if (!office?.passcode || typeof plaintext !== 'string') return false;
    const trimmed = plaintext.trim();
    if (!trimmed || trimmed.length > PASSCODE_MAX_CHARS) return false;
    return sameDigest(deriveKey(trimmed, office.passcode.salt), office.passcode.hash);
  }

  /**
   * The value a browser is given to prove it has already typed the passcode.
   *
   * `HMAC-SHA256(key = the passcode's digest, msg = the keycard)`, and every part of
   * that is doing a job:
   *
   *   * **Keyed on the stored digest**, so there is no new server secret to generate,
   *     persist or rotate, and no session table anywhere. It survives a restart and a
   *     redeploy for free — and dies the instant the passcode is changed or cleared,
   *     which is what makes rotation a single write rather than a sweep.
   *   * **Over the keycard**, so a value issued for one office proves nothing about
   *     another. The cookie is also scoped to the office's path, but scope is a
   *     browser's courtesy and this is arithmetic.
   *   * **An HMAC rather than the digest itself**, so the thing handed to a browser is
   *     not the thing an offline attacker would be trying to reproduce from the store
   *     file.
   *
   * One invariant rides on this and is stated where it is enforced (`server.cjs`): a
   * seal may only ever admit a *read*. Every write still needs a header token.
   */
  function passcodeSeal(office) {
    if (!office?.passcode) return null;
    return crypto.createHmac('sha256', office.passcode.hash).update(office.keycard).digest('hex');
  }

  /** Is `offered` this office's current seal? */
  function verifyPasscodeSeal(office, offered) {
    const seal = passcodeSeal(office);
    return sameDigest(offered, seal);
  }

  /**
   * Close an office: the one revocation that revokes everything.
   *
   * The reaper's own exit, reachable on purpose. Until `DELETE /office/<keycard>/api`
   * existed this was called by nothing but `sweep`, which meant a leaked keycard was
   * **permanent** — no delete, no rotation, and only a 30-day idle deadline on the
   * hosted deploy. One call takes the link, every watcher, the ring buffer, the
   * furniture and the write tokens together.
   *
   * It has a property worth knowing before it surprises somebody: because visiting an
   * unknown keycard *creates* an office (see `open`), **a closed office cannot 404.**
   * The leaked link resolves to a fresh empty room. So revocation is silent — the
   * person who kept your link is told nothing, not even that they were cut off — and
   * the keycard is not freed for reuse by anyone but the next caller to name it.
   *
   * `reason` distinguishes the two callers for the tally's sake and for nothing else.
   * "Somebody closed this room" and "nobody came back to it for a month" are the same
   * deletion and very different facts, and a count that added them together would answer
   * neither question.
   */
  function remove(card, { reason = 'closed' } = {}) {
    const office = offices.get(card);
    if (!office) return false;
    office.bus.close();
    closeWatchers(office);
    office.viewers.clear();
    offices.delete(card);
    if (claimed === card) claimed = null;
    onClose(card, { reserved: office.reserved, reason });
    save();
    return true;
  }

  // --- scene changes, as they happen ---------------------------------------

  /**
   * Listen for scene changes in this office. Returns an unsubscribe, or null if the
   * office is gone.
   *
   * `viewer` is the tab's own id, and it is here so that a tab is not told about its
   * own edit. Echoing one back is not merely redundant: a tab that has already moved
   * on to its next change would be dragged back to the previous one by its own echo.
   */
  function subscribeScenes(card, res, { viewer = null } = {}) {
    const office = offices.get(card);
    if (!office) return null;
    // A socket can be gone before the first byte after the head — a tab closed during
    // load, a proxy that hung up. Attaching a subscriber that throws on every write
    // would turn one dead client into a failure for the whole room.
    try { res.write(': roving office scene stream\n\n'); } catch { return null; }
    const sub = {
      res,
      viewer,
      ping: setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch { /* closing */ } }, WATCH_PING_MS),
    };
    sub.ping.unref?.();
    office.watchers.add(sub);
    touch(office);
    return () => {
      clearInterval(sub.ping);
      office.watchers.delete(sub);
    };
  }

  /** Tell everyone watching that a scene changed — except whoever changed it. */
  function announceScene(office, scene, { except = null } = {}) {
    if (!office.watchers.size) return;
    const text = `event: scene\ndata: ${JSON.stringify(scene)}\n\n`;
    for (const sub of office.watchers) {
      if (except && sub.viewer === except) continue;
      // A write to a socket the client has already dropped throws, and the request's
      // own close handler is what removes it. Failing here would take the rest of the
      // room's tabs down with it.
      try { sub.res.write(text); } catch { /* the close handler will clean up */ }
    }
  }

  /** Hang up on every watcher: the office they were watching has been reaped. */
  function closeWatchers(office) {
    for (const sub of office.watchers) {
      clearInterval(sub.ping);
      try { sub.res.end(); } catch { /* already gone */ }
    }
    office.watchers.clear();
  }

  // --- presence ------------------------------------------------------------

  /**
   * Note that a tab is still watching, and keep the office alive while it is.
   *
   * "Has agents" was the original wording for the deletion rule, but an office
   * showing simulated agents has none the server can see, and deleting a room
   * someone is actively looking at is indefensible. So aliveness is: a viewer, or
   * an event. Both stop for half an hour, and only then is it gone.
   *
   * The viewer id comes from the tab and is only used to count: two tabs on one
   * office are two viewers, and a reload is the same one again rather than a second.
   */
  function beat(card, viewerId) {
    const office = open(card);
    const now = Date.now();
    office.viewers.set(String(viewerId ?? 'anonymous').slice(0, 64), now);
    prune(office, now);
    office.lastSeenAt = now;
    return office;
  }

  /** Forget heartbeats that have aged out. Called wherever presence is read. */
  function prune(office, now = Date.now()) {
    for (const [id, at] of office.viewers) {
      if (now - at > PRESENCE_TTL_MS) office.viewers.delete(id);
    }
    return office.viewers.size;
  }

  function touch(office) {
    if (office) office.lastSeenAt = Date.now();
  }

  /** Most recent sign of life, whether that was a person or a harness. */
  function lastSeen(office) {
    return Math.max(office.lastSeenAt, office.bus.lastEventAt);
  }

  /**
   * How long this office has been unwatched and silent.
   *
   * A live heartbeat is zero idle time whatever the clocks say — someone is looking
   * at the room right now — and otherwise it is however long ago the last sign of
   * life was, from either a person or a harness.
   */
  function idleFor(office, now = Date.now()) {
    return prune(office, now) > 0 ? 0 : now - lastSeen(office);
  }

  /** Delete every office past its deadline. Returns the keycards that went. */
  function sweep(now = Date.now()) {
    const gone = [];
    for (const [card, office] of offices) {
      if (office.reserved) continue;
      if (idleFor(office, now) < idleTtlMs) continue;
      remove(card, { reason: 'reaped' });
      gone.push(card);
    }
    if (gone.length) log(`[office] reaped after ${Math.round(idleTtlMs / 60000)} idle minutes: ${gone.join(', ')}`);
    return gone;
  }

  let sweeper = null;
  function startSweeping() {
    if (sweeper) return;
    sweeper = setInterval(() => sweep(), SWEEP_MS);
    sweeper.unref?.();
  }

  function stopSweeping() {
    if (sweeper) clearInterval(sweeper);
    sweeper = null;
  }

  // --- scenes --------------------------------------------------------------

  function addScene(card, patch = {}) {
    const office = offices.get(card);
    if (!office || office.reserved) return null;
    // A scene added at runtime is never authored, whatever the caller sent: the
    // authored scenes are a property of the demo office, not something a POST can
    // claim to be and thereby borrow a look it was not given.
    const scene = makeScene({ ...patch, id: undefined, authored: false });
    office.scenes.push(scene);
    touch(office);
    save();
    return scene;
  }

  function updateScene(card, sceneId, patch = {}, { from = null } = {}) {
    const office = offices.get(card);
    if (office?.reserved) return null;
    const scene = office?.scenes.find((s) => s.id === sceneId);
    if (!scene) return null;

    if (patch.sources !== undefined) scene.sources = normaliseSources(patch.sources);
    if (patch.testDataPinned !== undefined) scene.testDataPinned = Boolean(patch.testDataPinned);
    if (patch.look !== undefined) scene.look = normaliseLook(patch.look);
    // `null` is a real value here and means "back to the authored room", which is
    // why this is an `undefined` check rather than a truthiness one.
    if (patch.layout !== undefined) scene.layout = normaliseLayout(patch.layout);
    if (patch.name !== undefined) {
      scene.name = typeof patch.name === 'string' && patch.name.trim()
        ? patch.name.trim().slice(0, 60)
        : null;
    }
    touch(office);
    save();
    announceScene(office, scene, { except: from });
    return scene;
  }

  /**
   * Delete a scene — unless it is the only one left.
   *
   * An office with no scenes is a black screen with a switcher on it, and the
   * wizard has no way to get you out of one. Refusing here rather than in the UI
   * means a second tab, a stale menu or a curl cannot produce that state either.
   */
  function removeScene(card, sceneId) {
    const office = offices.get(card);
    if (!office) return { ok: false, reason: 'no such office' };
    if (office.reserved) return { ok: false, reason: 'the demo keeps its starting rooms' };
    if (office.scenes.length <= 1) return { ok: false, reason: 'an office keeps at least one scene' };
    const before = office.scenes.length;
    office.scenes = office.scenes.filter((s) => s.id !== sceneId);
    if (office.scenes.length === before) return { ok: false, reason: 'no such scene' };
    touch(office);
    save();
    return { ok: true };
  }

  // --- the local endpoint's claim ------------------------------------------

  /**
   * Point this machine's adapters at an office.
   *
   * Claiming is not ownership and grants nothing: it only decides which office a
   * local `aop-send` posts into, because `endpoint.json` holds one URL. It is
   * recorded here so that a restart keeps feeding the office you were using.
   */
  function claim(card) {
    open(card);
    if (claimed === card) return false;
    claimed = card;
    log(`[office] local adapters now feed ${card}`);
    save();
    return true;
  }

  function claimedKeycard() {
    return claimed;
  }

  /** The office local adapters feed, for the legacy un-keycarded AOP routes. */
  function claimedOffice() {
    return claimed ? offices.get(claimed) ?? null : null;
  }

  // --- wire shape ----------------------------------------------------------

  /**
   * What the browser is told about an office. Viewers and the bus stay here.
   *
   * `writeTokenHash` stays here too, and so does the token it hashes. This function
   * answers `GET /office/<keycard>/api` for *anyone holding the keycard*, so a write
   * capability added to it would be a write capability handed to every viewer — the
   * one thing the split exists to prevent. The plaintext token appears in exactly one
   * response, the mint, and `server.cjs` adds it there explicitly.
   */
  function toJSON(office) {
    return {
      keycard: office.keycard,
      createdAt: office.createdAt,
      reserved: office.reserved,
      claimed: claimed === office.keycard,
      idleTtlMs,
      /**
       * How many people are looking at this room, deduplicated.
       *
       * Tabs, strictly — `beat` keys the map on an id the tab keeps in
       * `sessionStorage`, so a reload is the same viewer again rather than a second
       * one, and two tabs on one office are two viewers. It is emphatically not
       * `bus.subscribers`, which counts open SSE connections and is a different
       * number for a different question.
       *
       * **In-process, and therefore per-machine.** The map lives in this process's
       * heap, so the count is exact for as long as one process serves the office —
       * which is today's arrangement: the hosted deploy pins its volume to a single
       * Fly machine with `auto_stop_machines`. Scale the app horizontally and each
       * machine would report only its own share, with no contradiction visible
       * anywhere. That is a property of the hosting model rather than of the
       * counting, and the fix if it ever matters is a shared presence store, not a
       * cleverer map. Said here because this is where the number is read.
       */
      viewers: prune(office),
      passcode: hasPasscode(office),
      scenes: office.scenes.map((s) => ({ ...s })),
    };
  }

  /**
   * What a caller who has not got past the passcode is told.
   *
   * `?peek` must keep answering — reception asks it whether an office in your history
   * is still there, and a 404 would make every locked office look dead and be dropped
   * from the only list that records it exists. So the answer degrades instead of
   * disappearing: it is exactly the three facts a stranger could already establish by
   * trying the door, and none of the ones behind it. Scene *names* are user-set and
   * ride in `toJSON`, which is the reason this is a separate shape rather than a
   * filtered one.
   */
  function toLockedJSON(office) {
    return {
      keycard: office.keycard,
      reserved: office.reserved,
      passcode: true,
      locked: true,
    };
  }

  // --- the census ----------------------------------------------------------

  /**
   * Every office at once, reduced to totals. **A shape with no rows in it.**
   *
   * This answers the two questions the daily counters cannot, because neither is a thing
   * that *happens* on a day: which settings offices are wearing, and which furniture is
   * in them. Both are states rather than events, and the state is right here in the
   * store — so the honest answer is a photograph of the offices that exist now, and the
   * console labels it as exactly that rather than letting it read as history.
   *
   * It is deliberately a reduction rather than a listing, and that is the security
   * property rather than a matter of taste: there is no keycard, no scene name, no
   * token, no coordinate and no per-office entry anywhere in what comes back, so the
   * response cannot be turned into "show me inside this room". A caller who wants a
   * number gets a number.
   *
   * The reserved demo office is left out of all of it. It is authored — its scenes, their
   * sources and their look come from `src/projects.js` every boot — so counting it would
   * be counting this project's own opinions as though somebody had chosen them.
   */
  function census() {
    const out = {
      offices: 0,
      scenes: 0,
      writeTokens: 0,
      withPasscode: 0,
      watchedNow: 0,
      /** Scenes per office, as a histogram: how many rooms people actually keep. */
      scenesPerOffice: {},
      /** Which sources scenes are *set to*, which is a setting and not a connection. */
      sources: {},
      seasons: {},
      buildings: {},
      /** Scenes that have been given a place on earth, for the sun. A count, never a pin. */
      located: 0,
      /** Scenes nobody has opened yet, so the browser has not rolled a look for them. */
      unlooked: 0,
      /** Scenes carrying a furniture layout of their own, rather than the authored room. */
      arranged: 0,
      /** Every prop kind in every stored layout, so the console can rank them. */
      furniture: {},
      /** Which ways in are switched on, across arranged scenes. */
      channels: {},
    };
    const bump = (into, key) => { into[key] = (into[key] ?? 0) + 1; };

    for (const office of offices.values()) {
      if (office.reserved) continue;
      out.offices += 1;
      out.writeTokens += office.tokens.length;
      if (hasPasscode(office)) out.withPasscode += 1;
      if (prune(office) > 0) out.watchedNow += 1;
      bump(out.scenesPerOffice, String(office.scenes.length));

      for (const scene of office.scenes) {
        out.scenes += 1;
        for (const id of scene.sources) bump(out.sources, id);
        if (!scene.look) out.unlooked += 1;
        else {
          if (scene.look.season) bump(out.seasons, scene.look.season);
          if (scene.look.building) bump(out.buildings, scene.look.building);
          if (scene.look.lat !== null && scene.look.lon !== null) out.located += 1;
        }
        if (scene.layout) {
          out.arranged += 1;
          countFurniture(out, scene.layout);
        }
      }
    }
    return out;
  }

  /**
   * The prop kinds in one stored layout.
   *
   * The blob's shape is `src/layout.js`'s business and this reads the four families it
   * writes (`snapshot()` there): desks, stations, furniture and plants. Only the `kind`
   * is read — never a coordinate, never a colour, never an id — because "which furniture
   * do people use" is a question about kinds, and positions are the one part of a layout
   * that could conceivably identify a room by its shape.
   *
   * Desks carry no `kind` of their own in the blob, so they are counted by family. The
   * standing ones are counted separately because a sit-stand desk is a choice somebody
   * made rather than a different object (`src/layout.js` calls it a flag for that reason).
   *
   * Everything is read defensively. A layout is a browser-supplied blob that
   * `normaliseLayout` size-checks and otherwise keeps whole, so this must not throw on
   * one that has been hand-edited into nonsense — a census that can be crashed by a
   * PATCH would be a denial of service on the console.
   */
  function countFurniture(out, layout) {
    const bump = (into, key) => { into[key] = (into[key] ?? 0) + 1; };
    const entries = (family) => (family && typeof family === 'object' && !Array.isArray(family)
      ? Object.values(family) : []);

    for (const desk of entries(layout.desks)) {
      bump(out.furniture, desk?.standing ? 'desk (standing)' : 'desk');
    }
    for (const family of ['stations', 'furniture', 'plants']) {
      for (const item of entries(layout[family])) {
        if (typeof item?.kind === 'string' && item.kind && item.kind.length <= 40) {
          bump(out.furniture, item.kind);
        }
      }
    }
    const channels = layout.channels;
    if (channels && typeof channels === 'object') {
      for (const [name, on] of Object.entries(channels)) {
        if (on && typeof name === 'string' && name.length <= 40) bump(out.channels, name);
      }
    }
  }

  // --- persistence ---------------------------------------------------------

  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flush();
    }, SAVE_DEBOUNCE_MS);
    saveTimer.unref?.();
  }

  function flush() {
    const body = {
      version: STORE_VERSION,
      claimed,
      offices: [...offices.values()].map((office) => ({
        keycard: office.keycard,
        createdAt: office.createdAt,
        lastSeenAt: lastSeen(office),
        tokens: office.tokens,
        // The single hash this list replaced, still written for whatever reads the
        // file next. The file outlives the code that wrote it — a hosted office is a
        // volume that a rollback can point older code at — so a
        // deploy going backwards should cost you the *extra* tokens, not every token
        // and with them every adapter still posting into the room.
        writeTokenHash: office.tokens[0]?.hash ?? null,
        // Additive, and read back defensively (`readPasscode`), for the reason the
        // token list gives above: a version bump to add an optional secret would
        // discard every office on disk to do it.
        passcode: office.passcode,
        scenes: office.scenes,
      })),
    };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (err) {
      log(`[office] could not write ${file}: ${err.message}`);
    }
  }

  /**
   * The tokens on a stored office, however that office was written down.
   *
   * Three shapes have been on disk: nothing at all, from before ingest tokens; a lone
   * `writeTokenHash`, from before there could be more than one; and the list. The
   * middle one is folded into a single-entry list rather than dropped, because the
   * plaintext behind it is installed on somebody's machine right now and a migration
   * that silently stops it working is a migration that breaks their hooks with no
   * error to explain why.
   */
  function readTokens(record) {
    if (Array.isArray(record?.tokens)) {
      return record.tokens
        .filter((t) => t && typeof t.id === 'string' && typeof t.hash === 'string')
        .slice(0, MAX_TOKENS)
        .map((t) => ({
          id: t.id,
          hash: t.hash,
          label: normaliseLabel(t.label),
          createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
          lastUsedAt: Number.isFinite(t.lastUsedAt) ? t.lastUsedAt : null,
        }));
    }
    if (typeof record?.writeTokenHash === 'string') {
      return [{
        id: crypto.randomBytes(6).toString('hex'),
        hash: record.writeTokenHash,
        label: 'original',
        createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
        lastUsedAt: null,
      }];
    }
    return [];
  }

  /**
   * The passcode on a stored office, if it carries one this code understands.
   *
   * Both halves are required and both are checked, because a record with a hash and no
   * salt would derive against `undefined` and refuse the right passcode forever — a
   * lockout with no way out and no error to explain it. A record we cannot read is
   * dropped instead, which leaves the office open to its keycard: that is the safer
   * failure of the two, because the owner still holds the write token and can set the
   * passcode again, whereas nobody can talk their way past a broken one.
   */
  function readPasscode(record) {
    const stored = record?.passcode;
    if (!stored || typeof stored !== 'object') return null;
    if (typeof stored.salt !== 'string' || !stored.salt) return null;
    if (typeof stored.hash !== 'string' || !stored.hash) return null;
    return {
      salt: stored.salt,
      hash: stored.hash,
      setAt: Number.isFinite(stored.setAt) ? stored.setAt : Date.now(),
    };
  }

  /**
   * Reload offices from disk, dropping any that died while we were away.
   *
   * Nobody was watching during the downtime, so the idle clock kept running: an
   * office abandoned yesterday is not owed a resurrection just because the server
   * came back. The demo office is exempt, as it is everywhere else.
   */
  function load() {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return;   // no file, or unreadable: a fresh set of offices is the right answer
    }
    if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.offices)) return;

    const now = Date.now();
    for (const record of parsed.offices) {
      const card = keycard.parseKeycard(record?.keycard);
      if (!card || offices.has(card)) continue;
      // A file holding more than the cap allows is not a reason to exceed it. It is
      // what a lowered `ROVING_OFFICE_MAX_OFFICES` looks like on the next boot, and
      // restoring past the limit would leave the store over its bound with nothing
      // but the reaper to bring it back down.
      if (card !== keycard.DEMO_KEYCARD && offices.size >= maxOffices) continue;
      const lastSeenAt = Number.isFinite(record.lastSeenAt) ? record.lastSeenAt : 0;
      if (card !== keycard.DEMO_KEYCARD && now - lastSeenAt >= idleTtlMs) {
        // A reap that happened while nothing was running. Told to the tally, because the
        // alternative is a count of reaped offices that quietly omits every office that
        // went idle overnight — on a host whose machine stops when nobody is looking,
        // that is most of them. Dated today rather than to the night it actually
        // expired, which is the only date this code can honestly claim to know.
        onClose(card, { reserved: false, reason: 'reaped' });
        continue;
      }

      // The demo office is authored, so its scenes come from the code every time and
      // whatever is on disk is ignored. Trusting the file would leave a checkout
      // showing the tenants of whichever version last ran here — which is exactly
      // what happened the first time these three replaced the previous four.
      const stored = Array.isArray(record.scenes)
        ? record.scenes.filter((s) => s && typeof s.id === 'string').map(makeScene)
        : null;
      const scenes = card === keycard.DEMO_KEYCARD ? seedDemo() : stored;
      offices.set(card, makeOffice(card, {
        scenes: scenes?.length ? scenes : undefined,
        createdAt: Number.isFinite(record.createdAt) ? record.createdAt : now,
        lastSeenAt,
        // Additive rather than a STORE_VERSION bump, twice over: a version change
        // would discard every office on disk to add an optional secret, and then
        // discard them all again to let there be more than one of it.
        tokens: readTokens(record),
        // The demo office is exempt from a passcode wherever the subject comes up, so
        // a file that somehow claims one for it is not honoured: the front door
        // redirects into that room, and a locked demo is a locked front door.
        passcode: card === keycard.DEMO_KEYCARD ? null : readPasscode(record),
      }));
    }

    const restoredClaim = keycard.parseKeycard(parsed.claimed);
    if (restoredClaim && offices.has(restoredClaim)) claimed = restoredClaim;
    if (offices.size) log(`[office] restored ${offices.size} office(s) from ${file}`);
  }

  return {
    open,
    get,
    has,
    full,
    create,
    mint,
    mintWriteToken,
    verifyWriteToken,
    listWriteTokens,
    revokeWriteToken,
    hasPasscode,
    setPasscode,
    clearPasscode,
    verifyPasscode,
    passcodeSeal,
    verifyPasscodeSeal,
    remove,
    beat,
    touch,
    idleFor,
    sweep,
    startSweeping,
    stopSweeping,
    addScene,
    updateScene,
    removeScene,
    subscribeScenes,
    claim,
    claimedKeycard,
    claimedOffice,
    toJSON,
    toLockedJSON,
    census,
    load,
    flush,
    get size() { return offices.size; },
    keycards() { return [...offices.keys()]; },
    /** This store's deadline, not the module's default — the tests and the API read it here. */
    IDLE_TTL_MS: idleTtlMs,
    /** This store's cap, likewise. */
    MAX_OFFICES: maxOffices,
  };
}

module.exports = {
  createOfficeStore,
  deriveKey,
  sameDigest,
  IDLE_TTL_MS,
  AUTHORED_SCENE_IDS,
  MAX_TOKENS,
  MAX_OFFICES,
  PASSCODE_MIN_CHARS,
  PASSCODE_MAX_CHARS,
};
