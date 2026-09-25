// Tiny zero-dependency static file server for The Roving Office, plus the office
// registry and the Agent Office Protocol receiver (docs/developer/protocol/aop-spec.md).
//
// Usage: node server.cjs [port] [--office <keycard>]
//
// There are three kinds of route:
//
//   GET    /                             open the demo office
//   GET    /offices                      enter a keycard, or make an office
//   GET    /office/<keycard>             the office itself (the app shell)
//   GET    /office/<keycard>/api         its scenes, created on first sight
//   DELETE /office/<keycard>/api         close it, with its write token
//   POST   /office/<keycard>/api/passcode  set, clear or type its optional passcode
//          /office/<keycard>/aop/v0      its private AOP receiver
//
// An office is named by its keycard and by nothing else: no login, no account, no
// listing. Visiting an unknown keycard creates the office there, which is what
// makes a shared link work before anyone has opened it — and thirty minutes after
// the last viewer leaves and the last event arrives, it is deleted again. The
// registry is in lib/office-store.cjs; each office's ring buffer is its own
// (lib/aop-bus.cjs), because two people holding different keycards must not be able
// to see each other's agents.
//
// Reduction of events into stage directions happens in the browser
// (src/data/AopSource.js), so there is exactly one reducer in the system.

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { AOP_VERSION } = require('./lib/aop-bus.cjs');
const { createOfficeStore, deriveKey, sameDigest } = require('./lib/office-store.cjs');
const { createAvatarStore } = require('./lib/avatar-store.cjs');
const { createRateLimiter } = require('./lib/rate-limit.cjs');
const { createStatsStore } = require('./lib/stats-store.cjs');

const args = process.argv.slice(2);

/**
 * A port somebody asked for, or null to go and find one.
 *
 * Asked-for means asked-for: a port on the command line or in `PORT` is honoured
 * exactly and fails loudly if it is taken, because someone naming 8081 is usually
 * pointing a screenshot or a second tab at it and being quietly moved elsewhere
 * would be worse than an error.
 */
const REQUESTED_PORT = Number(process.env.PORT) || Number(args.find((a) => /^\d+$/.test(a))) || null;

/** Where to look for a free port when nobody named one. */
const PORT_RANGE = { from: 8080, to: 8095 };

/**
 * Which interface to bind, and why the default is the narrow one.
 *
 * `server.listen(port)` with no host binds `0.0.0.0` and `::` — every interface the
 * machine has. That is the wrong default for what this mostly is, which is a development
 * server for a checkout: `sendFile` serves anything under `ROOT` with no allowlist and no
 * dotfile rule, so a wide bind offers uncommitted work, `.git/config` and whatever local
 * tool configuration lives in the tree to everyone on the same café wifi, for the cost of
 * one `curl`. Nobody running `npm run serve` is asking for that, and this is a repository
 * strangers are invited to clone and run.
 *
 * So: loopback unless a deployment says otherwise, and saying otherwise is one variable.
 * `HOST=0.0.0.0` is what the hosted recipes set, beside `ROVING_OFFICE_TRUST_PROXY` and
 * for the same kind of reason — a platform's proxy reaches the process over the machine's
 * private interface, so it cannot use loopback. `Dockerfile.fly` sets it — the container
 * is what makes the wide bind correct, so the recipe that builds one is where it is said,
 * and `fly.toml` defers to it. A dispatching host needs nothing: an entry shim replaces
 * `listen` so no socket is ever bound, and this value is inert on that route.
 *
 * Deliberately not a `--host` flag. The people who need it are writing a deployment
 * recipe, not a command line, and every one of them already sets `PORT` next to it.
 */
const HOST = process.env.HOST || '127.0.0.1';

/** Settled by `listen()`, because until then we may not know which port we got. */
let PORT = REQUESTED_PORT ?? PORT_RANGE.from;

/**
 * Whether this office takes the machine's adapter feed.
 *
 * **Off by default, and that is the whole point of the flag.** There is one
 * `endpoint.json` per machine holding one URL, so an office that publishes is
 * redirecting *every* hook on the machine into itself — which is right for the office
 * you are working in and wrong for the four servers running beside it, one per
 * worktree, started to look at a branch or take a screenshot. Publishing on sight made
 * the common case (a test server) do the surprising thing, and the surprise was silent:
 * hooks do not announce where they post, so the first sign is agents appearing in a
 * room nobody is watching, or not appearing in the one somebody is.
 *
 * A private server is not a lesser one. It prints the two environment variables that
 * point a single shell at it, which is the per-shell grain the spec already defines
 * (§5.5) and a better fit for testing than a machine-wide file: it needs no cleanup,
 * cannot outlive the terminal it was typed in, and two of them can run at once.
 */
const PUBLISH = args.includes('--publish') || process.env.ROVING_OFFICE_PUBLISH === '1';

/** `--office <keycard>`: pin the local endpoint instead of letting a tab claim it. */
const PINNED_OFFICE = (() => {
  const at = args.indexOf('--office');
  return at >= 0 ? args[at + 1] ?? null : null;
})();

const ROOT = __dirname;

/**
 * The one path under an office that is not the app shell.
 *
 * Spelled once here and read by src/debuglog.js's sibling in the client (the link
 * out of the dev panel), so the page and the route that serves it cannot drift.
 */
const DEBUG_LOG_PATH = '/debuglog';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // agent-setup/prompt.md is fetched by an agent and read as text, so the type is
  // the difference between instructions and a download. See agent-setup/index.html.
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  // The published Claude plugin archive, under /plugins/claude. Claude Code fetches it
  // and verifies it against the SHA-256 in the marketplace JSON beside it, so what it
  // needs from us is the bytes — but served as `application/octet-stream` an archive is
  // a download some intermediaries feel free to rewrite, and the correct type costs a
  // line. See bin/aop-plugin-pack.cjs.
  '.zip': 'application/zip',
};

const MAX_BODY = 256 * 1024;    // spec §5.1: 413 past this

/** Filled in before the server listens: src/office/keycard.js owns the keycard format. */
let keycard = null;
/** Filled in with it: the office registry. */
let store = null;
/** And the daily tally the admin console draws. Always present; see lib/stats-store.cjs. */
let stats = null;

// --- the local endpoint ----------------------------------------------------

/**
 * What this server keeps between runs, and where it may be moved to.
 *
 * `~/.roving-office` is right for a laptop, where `$HOME` is the durable thing and the
 * office is one of several programs living in it. It is wrong for a container, where
 * the home directory is part of the image and a deploy replaces it — which is how a
 * hosted office lost every keycard, layout and ingest token on every release. So the
 * location is a setting, and a hosted deploy points it at a mounted disk
 * (`docs/developer/publishing.md`).
 *
 * The endpoint file deliberately does **not** move with it. It is not this server's
 * state; it is a rendezvous point, and every adapter and installer finds it by
 * building `~/.roving-office/endpoint.json` from `os.homedir()` themselves
 * (`bin/lib/aop-core.cjs`, `bin/aop-connect.cjs`, `bin/lib/local-config.cjs`). Moving
 * the copy this server writes would leave those reading a path nothing writes — hooks
 * that quietly post nowhere, with no error anywhere to say why. A container has no
 * local adapters to hand off to, so it loses nothing by leaving that file behind.
 */
const stateDir = process.env.ROVING_OFFICE_STATE_DIR
  || path.join(os.homedir(), '.roving-office');

/** Loopback-only shared secret, published for adapters to read — at the agreed path. */
const endpointFile = path.join(os.homedir(), '.roving-office', 'endpoint.json');
const officeFile = path.join(stateDir, 'offices.json');
/**
 * The daily counters, beside the registry and for the same reason.
 *
 * They are the only history this project has, so they want the durable directory a
 * hosted deploy mounts — on `$HOME` in a container they would be wiped by every release,
 * which is exactly the failure that moved the office registry here.
 */
const statsFile = path.join(stateDir, 'stats.json');
/**
 * How long an unwatched, silent office survives before it is reaped.
 *
 * The other half of a durable directory, and useless without it: the reaper drops an
 * office both while running and on load, so a deadline shorter than the gaps between
 * visits empties a mounted disk just as thoroughly as no disk at all. A hosted office
 * whose machine sleeps between visitors wants days; a laptop wants the half hour
 * `lib/office-store.cjs` defaults to. Nonsense and zero fall back to the default —
 * a mistyped variable should not silently reap every office at the first sweep.
 */
const IDLE_TTL_MS = Number(process.env.ROVING_OFFICE_IDLE_TTL_MS) > 0
  ? Number(process.env.ROVING_OFFICE_IDLE_TTL_MS)
  : undefined;
/**
 * How many offices this server will hold at once, if the deployment has an opinion.
 *
 * `lib/office-store.cjs` owns the default and the reasoning; this is only the door
 * a container uses to say the machine is bigger or smaller than the one that number
 * was sized for. Nonsense and zero fall back to the default rather than pinning the
 * store at nought, where the front door would be the first casualty.
 */
const MAX_OFFICES = Number(process.env.ROVING_OFFICE_MAX_OFFICES) > 0
  ? Number(process.env.ROVING_OFFICE_MAX_OFFICES)
  : undefined;

// Faces, beside the registry and outside any one office: they are addressed by the hash of
// their own bytes, so two offices watching one gateway share them (see lib/avatar-store.cjs).
const avatarDir = path.join(stateDir, 'avatars');
const avatars = createAvatarStore({ dir: avatarDir, log: (msg) => console.log(msg) });
// Overridable so a test or a scripted setup can talk to a second instance; a fresh
// random secret every start is the right default for a loopback dev server.
const token = process.env.AOP_TOKEN || crypto.randomBytes(32).toString('hex');

// Whether *this* process is the one advertising the endpoint. Only the owner may
// retract it (see unpublishEndpoint).
let ownsEndpoint = false;
/** The keycard currently written into the endpoint file, to avoid pointless writes. */
let publishedKeycard = null;

function readEndpoint() {
  try { return JSON.parse(fs.readFileSync(endpointFile, 'utf8')); } catch { return null; }
}

/** Is that pid still around? `signal 0` checks without sending anything. */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * Advertise where adapters should post, unless a living office already has.
 *
 * There is one well-known path, so two instances cannot both own it. Whoever
 * publishes last would otherwise capture every adapter and then, on exit, delete
 * the endpoint belonging to an office still running — disarming every installed
 * hook with no error anywhere. A stale file from a crashed run is fair game; a
 * live one is not.
 *
 * The URL now names an office, because events have to land somewhere in
 * particular. `aop-send` posts to whatever URL it reads here, so a re-publish is
 * the whole of "my agents should walk into this office instead" — no adapter, hook
 * or installer knows anything about keycards.
 */
function publishEndpoint() {
  if (!PUBLISH) return;
  const card = store.claimedKeycard();
  if (!card) return;
  if (ownsEndpoint && publishedKeycard === card) return;

  const existing = readEndpoint();
  if (!ownsEndpoint && existing?.pid && existing.pid !== process.pid && pidAlive(existing.pid)) {
    console.warn(`[aop] endpoint already published by pid ${existing.pid} (${existing.url})`);
    console.warn('[aop] this instance serves the UI but will receive no adapter events');
    return;
  }
  // A remote endpoint has no local pid to defer to, so starting an office here does
  // take the machine's adapters back. That is almost always what someone starting one
  // wants — but it silently redirects every hook, so it is said out loud, along with
  // how to undo it. The write token is not ours to keep, so reconnecting needs a mint.
  if (!ownsEndpoint && existing?.remote && existing.url) {
    console.warn(`[aop] taking the endpoint back from remote office ${existing.keycard ?? existing.url}`);
    console.warn('[aop] local adapters now feed this office; re-run aop-connect to send them back');
    console.warn('[aop] (only --publish does this — a server started without it leaves the endpoint alone)');
  }
  try {
    fs.mkdirSync(path.dirname(endpointFile), { recursive: true });
    fs.writeFileSync(
      endpointFile,
      `${JSON.stringify({
        url: `http://127.0.0.1:${PORT}/office/${card}/aop/v0/events`,
        token,
        pid: process.pid,
        keycard: card,
        aop: AOP_VERSION,
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    ownsEndpoint = true;
    publishedKeycard = card;
    console.log(`[aop] local adapters now post into office ${card}`);
  } catch (err) {
    console.warn(`[aop] could not write ${endpointFile}: ${err.message}`);
  }
}

/**
 * Retract the endpoint — but only if it is still ours.
 *
 * The file is a single well-known path shared by every instance, and it already
 * records the publishing pid. Unlinking blindly means a second office (or a test
 * server) exiting deletes the endpoint out from under a first one that is still
 * running, silently disarming every installed hook: adapters see no endpoint and
 * go dormant, and nothing anywhere reports an error.
 */
function unpublishEndpoint() {
  if (!ownsEndpoint) return;
  const current = readEndpoint();
  // Positive identification, not absence of a contradiction. The old test — "a pid
  // that is present and not mine means leave it" — read a *missing* pid as consent,
  // and a remote endpoint written by `aop-connect` has no pid by design. So exiting
  // deleted it and disarmed every hook on the machine, which is the exact failure
  // this function was written to avoid, arriving by the one door left open.
  if (current?.pid !== process.pid) return;
  try { fs.unlinkSync(endpointFile); } catch { /* already gone */ }
}

// --- request helpers -------------------------------------------------------

/** Reject anything that is not talking to us over loopback. */
function isLocal(req) {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Whatever secret the request is presenting, by either accepted header.
 *
 * `X-Roving-Office-Token` wins, and the order matters more than it looks. Hosting layers
 * inject and rewrite `Authorization` — some gateways treat it as their own credential —
 * so a request can arrive carrying somebody else's bearer value alongside a perfectly
 * good office token. Checking `Authorization` first would read the platform's header,
 * fail the comparison, and report a wrong token to an emitter that sent the right one.
 * The custom header is the one nothing else touches, so it is the one we trust first.
 */
function suppliedToken(req) {
  const custom = req.headers['x-roving-office-token'];
  if (custom) return String(custom);
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/**
 * May this request write to this office?
 *
 * Two secrets open ingest, for two different situations:
 *
 * 1. **This process's token**, published to `~/.roving-office/endpoint.json`. The
 *    original arrangement, and the one every local install already uses: an adapter
 *    on this machine reads the file and presents what it finds. Untouched.
 * 2. **The office's own ingest token**, minted with the office and held by whoever
 *    minted it. This is the one that works from another machine, where reading a
 *    file in *our* `$HOME` is not an option — and it is per-office, so it authorises
 *    writing to that room and no other.
 *
 * The first is checked without an office because it predates the idea of one.
 */
function authorised(req, office = null) {
  const supplied = suppliedToken(req);
  if (!supplied) return false;
  // Constant-time compare, so a wrong token leaks nothing through timing.
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  return office ? store.verifyWriteToken(office, supplied) : false;
}

// --- the optional read passcode --------------------------------------------
//
// An office may require a secret of its *readers*, set by whoever holds a write token
// (`POST /office/<keycard>/api/passcode`). Most offices have none and behave exactly as
// they always did; `passcodeOk` returns true for them without consulting anything.
//
// **One invariant holds the whole arrangement up, and it is a rule rather than a
// consequence:**
//
// > A cookie may only ever admit a **read**. A write always needs a header token.
//
// `handleAop`'s docblock has said "nothing here is cookie-authenticated, so a browser
// being tricked into requesting one of these gains its owner nothing" since before there
// were cookies at all, and that sentence stays true where it matters. Every read a seal
// covers is an idempotent GET, so there is no CSRF to have; ingest, the token routes and
// setting the passcode itself are header-authenticated and ignore the seal entirely.

/** The cookie one office's seal lives in. Scoped by name as well as by path. */
function sealCookieName(card) {
  return `ro_${card}`;
}

/**
 * One cookie's value out of the request, or null.
 *
 * Hand-parsed because this server has no dependencies and one header is not a reason to
 * acquire some. `split('=')` would be wrong — a cookie value may contain `=` — so only
 * the first separator counts, and a nameless or valueless pair is skipped rather than
 * read as an empty match for a name that is also empty.
 */
function cookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    if (pair.slice(0, at).trim() !== name) continue;
    return pair.slice(at + 1).trim();
  }
  return null;
}

/**
 * Is this connection https, as far as we can tell?
 *
 * Only to decide whether to mark the seal cookie `Secure`, and the two failure modes are
 * not symmetric: marked on a plain-http origin the browser silently drops the cookie and
 * the office asks for its passcode again on every request, which looks like a broken
 * passcode. So it is set when we can see TLS — directly, or asserted by the proxy that
 * terminated it — and omitted on the loopback http server a checkout runs.
 *
 * `x-forwarded-proto` is only believed from a deployment that said it is behind a proxy,
 * the same header discipline `clientKey` applies and for the same reason.
 */
function isSecureRequest(req) {
  if (req.socket.encrypted) return true;
  if (!TRUST_PROXY) return false;
  return String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
}

/**
 * How long a browser keeps a seal before it has to type the passcode again.
 *
 * Thirty days, which is the convenience the feature is for: a passcode somebody retypes
 * on every reload is a passcode they will not set. The honest cost of that is stated in
 * the user docs — an unlocked office stays open in that browser, so a shared or kiosk
 * machine keeps the room open — and the owner's remedy is not to wait it out but to
 * change the passcode, which invalidates every seal at once.
 */
const SEAL_MAX_AGE_S = 30 * 24 * 60 * 60;

/**
 * Hand this browser the proof that it has already typed the passcode.
 *
 * `Path` scopes it to the one office, which the server's canonical-spelling redirect
 * makes stable; `HttpOnly` keeps it out of reach of the page's own scripts, which
 * matters here because the office renders agent-supplied strings; `SameSite=Lax` is
 * enough, since the seal admits nothing but reads.
 */
function setSealCookie(req, res, office) {
  const seal = store.passcodeSeal(office);
  if (!seal) return;
  const parts = [
    `${sealCookieName(office.keycard)}=${seal}`,
    `Path=/office/${office.keycard}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SEAL_MAX_AGE_S}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/**
 * Throw away a seal this browser is holding.
 *
 * Clearing the passcode leaves every issued seal unverifiable anyway — there is no hash
 * left to key the HMAC on — so this is tidiness rather than revocation: without it the
 * browser keeps sending a dead cookie at an office that has stopped asking.
 */
function clearSealCookie(res, card) {
  res.setHeader('Set-Cookie', `${sealCookieName(card)}=; Path=/office/${card}; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * May this request read this office?
 *
 * True in three cases, and the third is the one worth naming: **a write token is
 * strictly stronger than a passcode**, so the owner is never locked out of the room
 * they just locked — including from a browser that has no cookie yet, and including
 * from `curl`.
 */
function passcodeOk(req, office) {
  if (!store.hasPasscode(office)) return true;
  if (authorised(req, office)) return true;
  return store.verifyPasscodeSeal(office, cookie(req, sealCookieName(office.keycard)));
}

/**
 * "This office has a passcode, and you have not given it."
 *
 * 401 with `passcode: true`, which is the whole of the client protocol: there is no
 * server-rendered login page and no new template, because the app shell is byte-identical
 * for every office and serving it reveals nothing. The prompt is ordinary client UI
 * reacting to this body (`src/ui/passcode-prompt.js`).
 */
function refuseLocked(res) {
  return json(res, 401, { error: 'this office has a passcode', passcode: true });
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

// --- the admin console -----------------------------------------------------
//
// A set of numbers about this server's own use, behind a password. It answers "how much
// has this been used" from the counters in lib/stats-store.cjs and a census of the
// offices that exist now — never anything about one office, because there is nothing
// per-office in either source to reveal (see `census` there, and the privacy note at the
// top of the stats store).
//
// **It does not exist unless the operator configures it**, and that takes *two*
// environment variables — a password and a path. Either one missing and every request
// that could have reached it is a 404 indistinguishable from a missing file, the
// console's own files are unreachable by any URL, and nothing anywhere says an admin
// surface was ever compiled in. A deployment that has not deliberately configured one is
// not advertising one; and since neither value has a default, there is nothing committed
// to leak and nothing on disk to crack offline.
//
// Three refusals make up the rest of it, and each is the same mechanism the office
// passcode already uses rather than a second one:
//
//   1. `deriveKey` and `sameDigest` from lib/office-store.cjs — one scrypt, one
//      constant-time compare, no `===` anywhere near a secret.
//   2. `createRateLimiter` from lib/rate-limit.cjs, twice, exactly as the per-office
//      unlock route does it. A single global password is the one credential here genuinely
//      worth brute-forcing, so the limit that cannot be spoofed is the one that matters.
//   3. A signed cookie derived from the digest, on the model of `passcodeSeal`.

/**
 * The console's password, from the environment and nowhere else.
 *
 * Read once at module load, so a deployment cannot be talked into an admin surface after
 * the fact and there is no route that changes it. Whitespace-only is treated as unset:
 * an empty variable is a deployment that meant to leave the feature off, not one asking
 * for a password of nothing.
 */
const ADMIN_PASSWORD = (() => {
  const raw = process.env.ROVING_OFFICE_ADMIN_PASSWORD;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
})();

/**
 * Where the console answers — the operator's choice, and never a default.
 *
 * **A path baked into this source would be worth nothing**, and the reason is specific to
 * this repository rather than general security advice: the code is published. Any clever
 * path written down here is published with it, so on release day every deployment in the
 * world would share one address that anybody could read out of the tree. An operator's own
 * path is the only kind that is not public knowledge.
 *
 * It is **deliberately not derived from the password**, not even through a hash. A path
 * travels in places a password must never go — server access logs, browser history, a
 * `Referer` header on any link clicked from the page — so anything computed from the
 * password would be depositing a function of the secret in all three. Two independent
 * values, and the only thing they share is that both must be present.
 *
 * And it is **not a security control**. The password is. This keeps the console out of
 * casual discovery and bot scans that walk a wordlist of common admin paths, and that is
 * the whole of its job; it survives being guessed, shoulder-read or found in a log,
 * because everything behind it still needs the password. Said plainly here and in
 * docs/developer/admin-console.md, because an operator who reads the path as protection
 * will choose a weaker password than they should.
 */
const ADMIN_PATH = normaliseAdminPath(process.env.ROVING_OFFICE_ADMIN_PATH);

/**
 * The console's path as it will be matched, or null if it cannot be used.
 *
 * A path from the environment is a string somebody typed, so the shapes it can arrive in
 * are normalised rather than refused — a missing leading slash and a trailing one are
 * slips, not decisions. What *is* refused is anything that would be a different kind of
 * mistake:
 *
 *   * **Something that is not a path.** A dot segment, a query or fragment, whitespace, a
 *     backslash, a percent escape, or any character outside an unreserved URL set. A path
 *     containing `%2f` would be the one thing the static guard is there to stop, arriving
 *     through the configuration.
 *   * **Something that would shadow the app.** A console mounted at `/office` or `/api`
 *     would silently take over the routes above it and break every room on the server —
 *     a far worse outcome than a console that does not start. Checked against the prefixes
 *     the router actually claims.
 *
 * A refusal leaves the console **absent** rather than taking the server down with it. The
 * office is the product and a mistyped admin path should not stop anybody's room from
 * loading; absent is also the fail-safe direction, since the alternative to "no console"
 * is never "an open console".
 */
function normaliseAdminPath(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  // Trailing slashes off, so `/x` and `/x/` cannot become two different consoles.
  const path_ = withSlash.replace(/\/+$/, '');
  const complain = (why) => {
    console.error(`[admin] ROVING_OFFICE_ADMIN_PATH ${why} — the console is disabled. Use a path like /a-word-nobody-would-guess.`);
    return null;
  };
  if (path_.length < 2) return complain('is empty');
  if (path_.length > 120) return complain('is longer than 120 characters');
  // Unreserved URL characters and the separator, and nothing else: no escapes to decode,
  // no case-folding to reason about, nothing a proxy might rewrite on the way in.
  if (!/^(\/[A-Za-z0-9._~-]+)+$/.test(path_)) {
    return complain('may only contain letters, digits, dot, underscore, hyphen, tilde and /');
  }
  if (path_.split('/').includes('..')) return complain('may not contain a dot segment');
  // The prefixes the router claims above this one, plus the two directories on disk that
  // the console's own files and the static guard live in.
  for (const taken of ['/api', '/office', '/offices', '/aop', '/docs', '/assets', '/vendor', '/src', '/lib', '/plugins', '/admin', '/agent-setup']) {
    if (path_ === taken || path_.startsWith(`${taken}/`)) {
      return complain(`may not be ${taken} or inside it — that is a path this server already serves`);
    }
  }
  return path_;
}

/**
 * Whether the console exists at all. Asked before anything else, everywhere.
 *
 * Both values or neither. A password with no path has nowhere to answer, and a path with
 * no password would be an unauthenticated statistics endpoint at an address the operator
 * believes is a secret — which is precisely the misunderstanding the note on `ADMIN_PATH`
 * warns about, so it is refused rather than served.
 */
const ADMIN_ENABLED = ADMIN_PASSWORD !== null && ADMIN_PATH !== null;

/**
 * The salt for the admin digest — fixed, in the code, and that is correct here.
 *
 * A salt defends a *stored* digest against a precomputed attack, and there is no stored
 * digest: the password lives in this process's environment and its digest in this
 * process's heap, and both are already lost to anyone who can read either. So the salt
 * has no offline attack to frustrate, and a random one per boot would buy nothing except
 * signing every operator out on each redeploy — which on a machine that stops when
 * nobody is looking means signing in on every visit.
 *
 * What scrypt is still doing is making each *online* guess expensive, and that is the
 * half that matters: it pairs with the two limiters below exactly as the per-office
 * passcode's KDF pairs with its own (see `SCRYPT` in lib/office-store.cjs).
 */
const ADMIN_SALT = 'roving-office/admin-console/v1';

/**
 * The digest, derived once at boot rather than per attempt.
 *
 * scrypt at these parameters costs tens of milliseconds, and deriving the *known* side
 * on every request would be paying that twice — and would put an unauthenticated route
 * in charge of how often this server runs a deliberately expensive function. The offered
 * side still costs a derivation per attempt, which is the point, and the limiters bound
 * how many of those anybody gets.
 */
const adminDigest = ADMIN_ENABLED ? deriveKey(ADMIN_PASSWORD, ADMIN_SALT) : null;

/**
 * How many wrong passwords are heard, per client and in total.
 *
 * The same two-limiter shape as the per-office unlock route (`unlockPerClient` /
 * `unlockPerOffice`) and the same reasoning, with the second one turned all the way up to
 * the whole server: there is exactly one admin password, so "this password" and "this
 * server" are the same target and the global limit is the only one an attacker cannot
 * sidestep by rotating a header. Tighter numbers than the office's, because nobody shares
 * this door with a building's worth of colleagues — it is one person who knows the
 * password and will type it right within a few tries.
 */
const ADMIN_PER_CLIENT = Number(process.env.ROVING_OFFICE_ADMIN_PER_CLIENT) > 0
  ? Number(process.env.ROVING_OFFICE_ADMIN_PER_CLIENT) : 5;
const ADMIN_PER_SERVER = Number(process.env.ROVING_OFFICE_ADMIN_PER_SERVER) > 0
  ? Number(process.env.ROVING_OFFICE_ADMIN_PER_SERVER) : 15;
const ADMIN_WINDOW_MS = Number(process.env.ROVING_OFFICE_ADMIN_WINDOW_MS) > 0
  ? Number(process.env.ROVING_OFFICE_ADMIN_WINDOW_MS) : 10 * 60_000;

const adminPerClient = createRateLimiter({ limit: ADMIN_PER_CLIENT, windowMs: ADMIN_WINDOW_MS });
const adminPerServer = createRateLimiter({ limit: ADMIN_PER_SERVER, windowMs: ADMIN_WINDOW_MS });

/** The cookie the console's session lives in. */
const ADMIN_COOKIE = 'ro_admin';

/**
 * How long a signed-in console session lasts.
 *
 * Twelve hours, not the office passcode's thirty days. A passcode's long life is a
 * deliberate convenience for a room somebody watches all month; an admin credential on a
 * public host is the opposite kind of thing, and a working day is as long as anybody
 * needs one browser tab to stay signed in.
 */
const ADMIN_SESSION_S = 12 * 60 * 60;

/**
 * The value that proves this browser has typed the password.
 *
 * `HMAC-SHA256(key = the digest, msg = a constant)`, which is `passcodeSeal`'s
 * construction with the keycard replaced by a fixed string — there is one console, so
 * there is nothing to scope it to. Keyed on the digest rather than being the digest, for
 * the reason given there: what a browser holds should not be what an attacker would be
 * trying to reproduce. Changing the environment variable changes the digest and so
 * invalidates every issued cookie, which is the whole of password rotation here.
 */
function adminSeal() {
  if (!adminDigest) return null;
  return crypto.createHmac('sha256', adminDigest).update('admin-console').digest('hex');
}

/** Is this request carrying a valid console session? */
function adminSignedIn(req) {
  if (!ADMIN_ENABLED) return false;
  return sameDigest(cookie(req, ADMIN_COOKIE), adminSeal());
}

function setAdminCookie(req, res) {
  const seal = adminSeal();
  if (!seal) return;
  const parts = [
    `${ADMIN_COOKIE}=${seal}`,
    // Scoped to the configured path, so the session is not sent on every request to the
    // office. A cookie's scope is the browser's courtesy rather than a control — the seal
    // itself is what `adminSignedIn` checks — but there is no reason to hand it out wider
    // than the one page that uses it.
    `Path=${ADMIN_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ADMIN_SESSION_S}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=${ADMIN_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * "There is nothing here", said exactly as a missing file says it.
 *
 * Byte-identical to what `sendFile` writes for a path that does not exist, because the
 * difference between "no console" and "a console you cannot open" is the one thing this
 * must not tell anybody. No JSON, no `Cache-Control`, no header a probe could sort on.
 */
function adminAbsent(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

/**
 * The body, up to `limit` bytes, or a rejection with `code: 413`.
 *
 * Stops at the limit **without killing the connection**, which is the whole subtlety here.
 * Destroying the request the moment it goes over is the obvious move and it throws away
 * the answer: the response is written to a socket that is already gone, so a client
 * uploading something too big sees a dropped connection rather than the 413 explaining
 * why. So the stream is paused and what we held is released, leaving the caller to answer
 * and `refuseBody` to close the socket afterwards.
 */
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;   // no reason to keep a body we have refused
        req.pause();
        reject(Object.assign(new Error('body too large'), { code: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/**
 * Refuse a body, and say so.
 *
 * The upload is still arriving and nobody is going to read the rest of it, so this
 * connection cannot be reused — but it can carry one last response, and that response is
 * the only thing telling the adapter what it did wrong. Written first, socket closed once
 * it has flushed.
 */
function refuseBody(req, res, err) {
  const payload = JSON.stringify({ error: err.message });
  res.writeHead(err.code === 413 ? 413 : 400, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  res.end(payload, () => req.destroy());
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  const text = raw.toString('utf8').trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/** One object, an array, or NDJSON — all three are legal bodies (spec §5.1). */
function parseEvents(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed);
    return Array.isArray(arr) ? arr : [];
  }
  if (!trimmed.includes('\n')) return [JSON.parse(trimmed)];
  const out = [];
  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { /* skip the bad line, keep the batch */ }
  }
  return out;
}

const numberParam = (url, name) => {
  const raw = url.searchParams.get(name);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
};

// --- AOP, per office -------------------------------------------------------

async function handleIngest(req, res, office) {
  if (!authorised(req, office)) return json(res, 401, { error: 'bad or missing token' });

  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    return refuseBody(req, res, err);
  }

  if ((req.headers['content-encoding'] ?? '').includes('gzip')) {
    try {
      raw = require('zlib').gunzipSync(raw);
    } catch {
      return json(res, 400, { error: 'gzip body could not be inflated' });
    }
  }

  let events;
  try {
    events = parseEvents(raw.toString('utf8'));
  } catch (err) {
    return json(res, 400, { error: `unparseable body: ${err.message}` });
  }

  // Kept rather than counted, because the tally needs the accepted events themselves —
  // their type and their harness — and an event the bus rejected is not data that flowed.
  const taken = [];
  for (const ev of events) if (office.bus.accept(ev)) taken.push(ev);
  // Events are a sign of life as much as a viewer is: an office being worked in by
  // an agent while nobody watches is still in use.
  if (taken.length) {
    store.touch(office);
    // The captain's definition of a successful connection, used literally: a source
    // counts for a day when at least one event from it was accepted. Only the type and
    // the harness name are read — see `eventsAccepted` in lib/stats-store.cjs.
    stats.eventsAccepted({
      keycard: office.keycard,
      reserved: office.reserved,
      events: taken,
    });
  }
  json(res, 202, { accepted: taken.length, dropped: events.length - taken.length, keycard: office.keycard });
}

/**
 * `/aop/v0/avatars/<sha256>` — the one route that carries pictures rather than events.
 *
 * Split the same way as everything else in this file (see `handleAop`): **writing** a face
 * needs the ingest token, because it puts bytes on our disk; **reading** one needs only the
 * keycard already proved by the path, because a face is not a secret and the office page
 * has to be able to fetch it with an `<img>` tag, which cannot carry a token.
 *
 * `PUT` is idempotent and `HEAD` is the cheap version of asking, so a gateway that has
 * forgotten what it uploaded — every restart — costs one small request per agent rather
 * than one upload per agent.
 */
async function handleAvatar(req, res, name, office) {
  if (!avatars.validName(name)) return json(res, 400, { error: 'avatar name must be a sha-256 hex digest' });

  if (req.method === 'GET' || req.method === 'HEAD') {
    const found = avatars.get(name);
    if (!found) return json(res, 404, { error: 'no such avatar' });
    res.writeHead(200, {
      // The sniffed type, never one the uploader asserted, and `nosniff` so the browser
      // does not go looking for a second opinion either.
      'Content-Type': found.type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': fs.statSync(found.file).size,
      // Bytes that hash to this name are always these bytes, so this is the one thing the
      // office serves that may be kept forever.
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(found.file).pipe(res);
  }

  if (req.method !== 'PUT' && req.method !== 'POST') {
    return json(res, 405, { error: `avatars accept GET, HEAD or PUT, not ${req.method}` });
  }
  if (!authorised(req, office)) return json(res, 401, { error: 'bad or missing token' });

  let bytes;
  try {
    bytes = await readBody(req, avatars.MAX_BYTES);
  } catch (err) {
    return refuseBody(req, res, err);
  }
  try {
    const { stored, type } = avatars.put(name, bytes);
    store.touch(office);
    return json(res, stored ? 201 : 200, {
      avatar: `/office/${office.keycard}/aop/v0/avatars/${name}`,
      type,
      stored,
    });
  } catch (err) {
    return json(res, err.code === 413 ? 413 : 400, { error: err.message });
  }
}

function handleStream(req, res, url, office) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // `?? null` and an explicit finite check, not `|| null`: cursor 0 is a legitimate
  // "replay everything you still have", and `0 || null` quietly threw it away.
  const unsubscribe = office.bus.subscribe(res, {
    harness: url.searchParams.get('harness'),
    after: numberParam(url, 'after'),
  });
  req.on('close', unsubscribe);
}

// --- who else may write in here --------------------------------------------
//
// All three routes require a token and never accept the keycard alone, which is the
// single rule holding the read/write split up. A keycard is a capability a person
// reads aloud; if it could mint, every viewer would be a writer and the office would
// have one kind of key again. So capability begets capability: the office's first
// token comes with the office, and every later one is chained off one already held.
//
// Listing is gated for the same reason even though it reveals no secret — it is a map
// of who can write into the room, and a viewer holding a keycard has no business
// reading it.

/** GET /office/<keycard>/aop/v0/tokens — what is currently allowed to write here. */
function handleListTokens(req, res, office) {
  if (!authorised(req, office)) return json(res, 401, { error: 'bad or missing token' });
  return json(res, 200, { keycard: office.keycard, tokens: store.listWriteTokens(office) });
}

/**
 * POST /office/<keycard>/aop/v0/tokens — mint another one, for another machine.
 *
 * The response is the only time this token exists anywhere outside a hash, so a
 * caller that loses it has not lost access to the office — they hold the one they
 * minted with — but has certainly lost that one.
 */
async function handleMintToken(req, res, office) {
  if (!authorised(req, office)) return json(res, 401, { error: 'bad or missing token' });
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return refuseBody(req, res, err);
  }
  try {
    const minted = store.mintWriteToken(office, { label: body?.label });
    store.touch(office);
    return json(res, 201, minted);
  } catch (err) {
    // The cap, which is a refusal rather than a failure: the caller is holding a
    // valid token and is being told to tidy up, not that something went wrong.
    return json(res, 409, { error: err.message });
  }
}

/** DELETE /office/<keycard>/aop/v0/tokens/<id> — take one machine's access away. */
function handleRevokeToken(req, res, office, id) {
  if (!authorised(req, office)) return json(res, 401, { error: 'bad or missing token' });
  const result = store.revokeWriteToken(office, id);
  // 409 rather than 404 for the last one: the token is there, and the refusal is
  // about what the office would become without it.
  if (!result.ok) return json(res, result.reason === 'no such token' ? 404 : 409, { error: result.reason });
  store.touch(office);
  return json(res, 200, { revoked: id, tokens: store.listWriteTokens(office) });
}

/**
 * The AOP surface for one office.
 *
 * Reachable from anywhere, gated per route rather than per network. A keycard is
 * enough to *watch* an office from another device; it is not enough to inject agents
 * into one. That was always the sentence describing this function — the loopback
 * check that used to stand here enforced something stricter and blunter, refusing
 * reads from another machine and making a hosted office unable to show anything but
 * simulated data.
 *
 * So the two halves are now told apart by what they are, not by where they came from:
 *
 * - **Reads** (`/stream`, `/state`, `/health`) need the keycard, which the caller has
 *   already proved by naming an office in the path — eight unguessable characters,
 *   the same capability that opens the office page.
 * - **Writes** (`/events`) need a token as well, and always did.
 *
 * No **write** here is cookie-authenticated, so a browser being tricked into posting to
 * one of these gains its owner nothing. That is why the writes are matched first, above
 * the passcode gate: a seal admits reads and only reads, and a route that consulted one
 * before asking for a token would be the end of the rule rather than an exception to it.
 */
function handleAop(req, res, route, url, office) {
  // --- writes: a token, always, and never a seal ---
  if (route === '/events' && req.method === 'POST') return handleIngest(req, res, office);
  if (route === '/tokens') {
    if (req.method === 'GET') return handleListTokens(req, res, office);
    if (req.method === 'POST') return handleMintToken(req, res, office);
  }
  const oneToken = /^\/tokens\/([^/]+)$/.exec(route);
  if (oneToken && req.method === 'DELETE') return handleRevokeToken(req, res, office, oneToken[1]);

  // --- reads: the keycard, plus the passcode if this office has one ---
  //
  // `passcodeOk` passes a write token through, so an uploading gateway is unaffected by
  // a passcode and `PUT /avatars/<sha>` below still answers to a token as it always has.
  // An unauthenticated PUT to a locked office is refused here rather than by
  // `handleAvatar`, which changes the wording of that 401 and nothing else about it.
  if (!passcodeOk(req, office)) return refuseLocked(res);

  const avatar = /^\/avatars\/([^/]+)$/.exec(route);
  if (avatar) return handleAvatar(req, res, avatar[1], office);
  if (route === '/stream' && req.method === 'GET') return handleStream(req, res, url, office);
  if (route === '/state' && req.method === 'GET') {
    return json(res, 200, office.bus.replay({
      harness: url.searchParams.get('harness'),
      after: numberParam(url, 'after'),
    }));
  }
  if (route === '/health' && req.method === 'GET') {
    return json(res, 200, {
      aop: AOP_VERSION,
      keycard: office.keycard,
      cursor: office.bus.cursor,
      buffered: office.bus.buffered,
      // Two counts of two different things, and the difference is the whole reason both
      // are here. `subscribers` is open SSE connections, which a reload briefly doubles
      // and a background tab may drop. `viewers` is people: `store.beat` keys presence
      // on an id a tab keeps in `sessionStorage`, so a reload is the same viewer again.
      // The keycard dialog shows the second one, because that is what an owner means by
      // "how many people are looking at this" (see `toJSON`, which also records why the
      // number is exact today and would be per-machine on a horizontally scaled app).
      subscribers: office.bus.subscribers,
      viewers: office.viewers.size,
      passcode: store.hasPasscode(office),
    });
  }

  json(res, 404, { error: `no AOP route for ${req.method} ${url.pathname}` });
}

// --- the office API --------------------------------------------------------

/**
 * DELETE /office/<keycard>/api — close this office.
 *
 * The route the office went a long time without, and the one that fixes the actual
 * defect: before it, a keycard that had leaked was leaked **permanently**. It revokes
 * everything in one act — the link, every watcher, the ring buffer, the furniture and
 * every write token — because `store.remove` already closed the bus and hung up the
 * watchers for the reaper's sake and nothing new has to be got right here.
 *
 * Authorised by the office's own write token, which is the same rule as every other
 * privileged act on an office: capability begets capability, and there is no owner
 * record to consult because there are no accounts. The browser that minted the office
 * keeps that token (`src/office/owner.js`), which is what makes this reachable from
 * reception's front door rather than only from a terminal.
 *
 * The three refusals are asked in this order on purpose:
 *
 *   * **403** for the reserved demo — first, and asked of the *keycard* rather than of
 *     `office.reserved`. `/` redirects into that room, so it refuses whether or not it
 *     happens to be instantiated at the moment: on a fresh state directory nothing has
 *     opened it yet, and answering 404 there would say the front door leads nowhere.
 *     Before any credential is looked at, so the answer does not depend on who asks.
 *   * **404** when there is no office — a stale menu in a tab that slept through the
 *     idle window, told rather than quietly handed a fresh empty room to delete.
 *   * **401** otherwise. A keycard is enough to watch an office and never enough to
 *     end it.
 */
function handleCloseOffice(req, res, card) {
  if (card === keycard.DEMO_KEYCARD) {
    return json(res, 403, { error: 'The demo office stays open. Open your own office to have one you can close.' });
  }
  const office = store.get(card);
  if (!office) return json(res, 404, { error: 'no office at that keycard', keycard: card });
  if (!authorised(req, office)) return json(res, 401, { error: 'closing an office needs its write token' });
  store.remove(card);
  console.log(`[office] ${card} closed by whoever holds its write token`);
  return json(res, 200, { closed: card });
}

/**
 * How many wrong passcodes one client may offer in a window, and how many one office
 * will hear from everybody together.
 *
 * The second number is the one that matters, and this is the point most passcode designs
 * get wrong. A per-client limit is a courtesy: its key is the client address, which
 * behind a proxy means a header the caller wrote (see `clientKey`), so somebody willing
 * to rotate it defeats that limit entirely. **The office key cannot be spoofed** — it is
 * in the path, and it is the thing being attacked.
 *
 * With twenty attempts per office per ten minutes, a six-character passcode over the
 * keycard alphabet (32⁶ ≈ 10⁹) takes on the order of a million years, and even a
 * six-digit numeric one (10⁶) takes a thousand. **Without a per-office limiter a short
 * passcode is worth nothing at all**, however good the KDF behind it — which is why the
 * limiter and `SCRYPT` in lib/office-store.cjs are two halves of one control rather than
 * belt and braces.
 *
 * Only *wrong* attempts count: a correct one is refunded, so a person who mistypes twice
 * and then gets it right has spent nothing. In memory, per the argument in
 * lib/rate-limit.cjs — a restart has also just dropped every ring buffer, so forgiving
 * the counters with them is the honest arithmetic.
 */
const UNLOCK_PER_CLIENT = Number(process.env.ROVING_OFFICE_UNLOCK_PER_CLIENT) > 0
  ? Number(process.env.ROVING_OFFICE_UNLOCK_PER_CLIENT) : 10;
const UNLOCK_PER_OFFICE = Number(process.env.ROVING_OFFICE_UNLOCK_PER_OFFICE) > 0
  ? Number(process.env.ROVING_OFFICE_UNLOCK_PER_OFFICE) : 20;
/** The window both count over. Ten minutes, as the mint limits use. */
const UNLOCK_WINDOW_MS = Number(process.env.ROVING_OFFICE_UNLOCK_WINDOW_MS) > 0
  ? Number(process.env.ROVING_OFFICE_UNLOCK_WINDOW_MS) : 10 * 60_000;

const unlockPerClient = createRateLimiter({ limit: UNLOCK_PER_CLIENT, windowMs: UNLOCK_WINDOW_MS });
const unlockPerOffice = createRateLimiter({ limit: UNLOCK_PER_OFFICE, windowMs: UNLOCK_WINDOW_MS });

/**
 * POST /office/<keycard>/api/passcode — set one, clear one, or type one.
 *
 * Three requests in one route, told apart by what the caller is holding:
 *
 *   | body | credential | meaning |
 *   |---|---|---|
 *   | `{passcode: "…"}` | a write token | set it, or change it |
 *   | `{passcode: null}` | a write token | clear it |
 *   | `{passcode: "…"}` | nothing | an unlock attempt |
 *
 * One route rather than three because they are one subject, and because the owner's own
 * set is *also* an unlock: the response carries the seal cookie, so nobody locks
 * themselves out of the room they have just locked.
 *
 * It is the one thing under `/api` that must stay in front of the passcode gate — it is
 * the door — so `handleOfficeApi` reaches it before asking `passcodeOk` anything.
 */
async function handlePasscode(req, res, card, url) {
  // First, of the keycard rather than of an office that may not be instantiated, and
  // before the credential check or the body is read — the same ordering and the same
  // reasoning as `handleCloseOffice`. The demo is where `/` lands, and a passcode on it
  // would be a passcode on the front door.
  if (card === keycard.DEMO_KEYCARD) {
    return json(res, 403, { error: 'The demo office is open to everyone. Open your own office to put a passcode on it.' });
  }
  const office = store.get(card);
  if (!office) return json(res, 404, { error: 'no office at that keycard', keycard: card });

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return refuseBody(req, res, err);
  }
  const offered = body?.passcode;

  // The owner's side: a header token, never the seal. Setting a passcode is a write.
  if (authorised(req, office)) {
    if (offered === null || offered === undefined || offered === '') {
      store.clearPasscode(office);
      clearSealCookie(res, card);
      return json(res, 200, { keycard: card, passcode: false });
    }
    const set = store.setPasscode(office, offered);
    if (!set.ok) return json(res, 400, { error: set.reason });
    store.touch(office);
    setSealCookie(req, res, office);
    return json(res, 200, { keycard: card, passcode: true, setAt: set.setAt });
  }

  // A reader's side. Clearing is a write and a bare keycard is not one, so this is only
  // ever an attempt — and an attempt needs something to be attempting.
  if (typeof offered !== 'string' || !offered) {
    return json(res, 400, { error: 'send a passcode, or a write token to change one' });
  }
  if (!store.hasPasscode(office)) {
    return json(res, 400, { error: 'this office has no passcode', passcode: false });
  }

  // Both limiters before the KDF, which is the other thing they are for: scrypt is
  // deliberately expensive, so an unmetered attempt route would be a way to spend this
  // server's cpu rather than only a way to guess.
  const key = clientKey(req);
  for (const [limiter, limiterKey, scope] of [
    [unlockPerClient, key, 'client'],
    [unlockPerOffice, card, 'office'],
  ]) {
    const spend = limiter.take(limiterKey);
    if (spend.ok) continue;
    // Whatever the earlier limiter granted goes back: the attempt never happened.
    if (scope === 'office') unlockPerClient.refund(key);
    const seconds = retryAfterSeconds(spend.retryAfterMs);
    res.setHeader('Retry-After', String(seconds));
    return json(res, 429, {
      error: `too many wrong passcodes: try again in ${waitInWords(seconds)}.`,
      passcode: true,
      retryAfterSeconds: seconds,
      scope,
    });
  }

  if (!store.verifyPasscode(office, offered)) {
    return json(res, 401, { error: 'that is not this office’s passcode', passcode: true });
  }
  // Right first time or right in the end, it cost nothing: only wrong attempts count.
  unlockPerClient.refund(key);
  unlockPerOffice.refund(card);
  setSealCookie(req, res, office);
  // The office document, because a browser that has just got in wants the room rather
  // than a second round trip to ask for it. `?viewer=` is accepted so the unlock also
  // counts as arriving, which is what stops a room somebody just opened being reaped.
  return json(res, 200, store.toJSON(store.beat(card, url?.searchParams.get('viewer'))));
}

/**
 * Everything under /office/<keycard>/api.
 *
 * Unauthenticated on purpose: the keycard is the credential (see src/office/keycard.js),
 * and asking for a second one would mean an office could not be shared by sending
 * someone its link — which is the entire point of the format. An office whose owner has
 * deliberately added a passcode is the one exception, and it is one gate in one place
 * (`passcodeOk`) rather than a condition sprinkled through the routes below.
 */
async function handleOfficeApi(req, res, route, card, url) {
  // The door itself, in front of the gate: setting, clearing and typing the passcode.
  if (route === '/passcode' && req.method === 'POST') return handlePasscode(req, res, card, url);

  // Closing, likewise ahead of the gate — it authorises with a write token, which is
  // strictly stronger than a passcode, and a locked office has to stay closable.
  if ((route === '' || route === '/') && req.method === 'DELETE') {
    return handleCloseOffice(req, res, card);
  }

  /**
   * The gate, asked once for the whole surface below.
   *
   * Only for an office that already exists: a keycard nobody has used has no passcode
   * to check, and `openOfficeFor` further down is what turns it into a room.
   */
  const known = store.get(card);
  if (known && !passcodeOk(req, known)) {
    // `?peek` degrades rather than refusing. Reception asks it whether an office in
    // your history is still there, and a 401 there would either drop a live office
    // from the only list recording that it exists, or teach that list to treat a
    // refusal as a yes — see `toLockedJSON`.
    if ((route === '' || route === '/') && req.method === 'GET' && url.searchParams.has('peek')) {
      return json(res, 200, store.toLockedJSON(known));
    }
    return refuseLocked(res);
  }

  // The current state of the room. GET creates on first sight, which is how a
  // keycard someone invented becomes a real office — unless it is only a `?peek`,
  // which reception uses to ask whether an office in your history is still there.
  // Answering that with a resurrection would make every dead office look alive.
  if (route === '' || route === '/') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET to open this office, DELETE to close it' });
    if (url.searchParams.has('peek')) {
      const seen = store.get(card);
      return seen
        ? json(res, 200, store.toJSON(seen))
        : json(res, 404, { error: 'no office at that keycard', keycard: card });
    }
    // Creation on first sight is the same act as a mint and is bounded the same way:
    // a caller who cannot mint through the front door cannot walk round to inventing
    // keycards instead (see `openOfficeFor`).
    const entered = openOfficeFor(req, res, card);
    if (!entered) return undefined;
    // An owner opening their own locked room is let in by the write token, and leaves
    // with a seal as well. Without that line the page would load and then every
    // credential-free request the tab makes afterwards — the heartbeat, the scene
    // stream, the avatars — would be refused behind the passcode, which is an office
    // that looks open and quietly stops keeping itself alive. Issuing a seal to a
    // request that already proved something strictly stronger gives nothing away.
    if (store.hasPasscode(entered) && authorised(req, entered)) setSealCookie(req, res, entered);
    return json(res, 200, store.toJSON(entered));
  }

  // Presence: "I am still looking at this room". An office with a live heartbeat is
  // never reaped, and the answer carries the office back so a tab learns about a
  // claim it did not make itself.
  //
  // A poll rather than a held-open stream, and deliberately: an indefinitely pending
  // response stops Chrome's virtual clock, so a headless screenshot of an office —
  // how anything visual here gets checked — would hang forever.
  //
  // It does not create the office. A beat arriving for one that is gone comes from a
  // tab that slept through the whole idle window, and its 404 is how that tab finds
  // out; silently making a fresh empty office under it would leave a switcher full of
  // rooms the server has never heard of.
  if (route === '/heartbeat' && req.method === 'POST') {
    const beating = store.get(card);
    if (!beating) return json(res, 404, { error: 'no office at that keycard', keycard: card });
    return json(res, 200, store.toJSON(store.beat(card, url.searchParams.get('viewer'))));
  }

  // Everything below edits an office, and an edit to an office that is not there is
  // not a request to create one: it means this tab is holding a menu from before the
  // office was reaped, and it deserves to be told so rather than quietly given a
  // brand-new empty room to write into.
  const office = store.get(card);
  if (!office) return json(res, 404, { error: 'no office at that keycard', keycard: card });

  // Scene changes as they happen, so a second tab does not have to be reloaded to
  // see the furniture move. Reads only — the keycard is the credential for watching,
  // exactly as it is for the office document this stream carries deltas to.
  if (route === '/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const unsubscribe = store.subscribeScenes(card, res, { viewer: url.searchParams.get('viewer') });
    if (!unsubscribe) return res.end();
    return req.on('close', unsubscribe);
  }

  // Visitors can experiment locally, but the demo's starting rooms stay intact.
  if (office.reserved && (route === '/scenes' || route.startsWith('/scenes/'))
      && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    return json(res, 403, { error: 'The demo keeps its starting rooms. Open your own office to save changes.' });
  }

  if (route === '/scenes' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(res, 201, store.addScene(card, body));
  }

  const scene = /^\/scenes\/([^/]+)$/.exec(route);
  if (scene) {
    const sceneId = decodeURIComponent(scene[1]);
    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = await readJsonBody(req);
      // `?viewer=` names the tab making the change, so the broadcast can skip it.
      // The same id the heartbeat uses, for the same reason: it identifies a tab
      // without identifying a person.
      const updated = store.updateScene(card, sceneId, body, { from: url.searchParams.get('viewer') });
      // A look arriving is how a room gets its season and its building: the browser
      // rolls them and PATCHes them back (`lib/office-store.cjs`'s header), so this is
      // the one moment the server can see a setting being *chosen* rather than merely
      // held. Counted as two words out of an authored pool and nothing else.
      if (updated && body?.look !== undefined) {
        stats.lookSet({ reserved: office.reserved, look: updated.look });
      }
      return updated ? json(res, 200, updated) : json(res, 404, { error: 'no such scene' });
    }
    if (req.method === 'DELETE') {
      const result = store.removeScene(card, sceneId);
      return result.ok ? json(res, 200, store.toJSON(office)) : json(res, 409, { error: result.reason });
    }
    return json(res, 405, { error: 'PATCH or DELETE' });
  }

  // Take the machine's adapter feed. Local-only: it rewrites endpoint.json, which
  // is a fact about this machine and none of a remote visitor's business.
  if (route === '/claim' && req.method === 'POST') {
    if (!isLocal(req)) return json(res, 403, { error: 'the local endpoint can only be claimed locally' });
    // Nothing to claim: this server never wrote the endpoint file, so handing it an
    // office would change a fact about the machine that this process does not own.
    if (!PUBLISH) {
      return json(res, 409, { error: 'this office was started without --publish and holds no endpoint' });
    }
    if (PINNED_OFFICE) {
      return json(res, 409, {
        error: `the endpoint is pinned to ${store.claimedKeycard()} by --office`,
        keycard: store.claimedKeycard(),
      });
    }
    if (store.claim(card)) publishEndpoint();
    return json(res, 200, store.toJSON(office));
  }

  return json(res, 404, { error: `no office route for ${req.method} ${route || '/'}` });
}

// --- the admin console's routes --------------------------------------------

/**
 * The console's own files, by name rather than by path.
 *
 * An allowlist of three names, so there is no path to normalise, no `..` to catch and no
 * boundary test to get right — the set of things this route can serve is written out in
 * full. `serveStatic` cannot reach these files at all (see the guard there), so this is
 * the only door to them and it is worth it being a short one.
 */
const ADMIN_FILES = {
  '': { file: 'console.html', type: 'text/html; charset=utf-8', template: true },
  '/': { file: 'console.html', type: 'text/html; charset=utf-8', template: true },
  '/console.js': { file: 'console.js', type: 'text/javascript; charset=utf-8' },
  '/console.css': { file: 'console.css', type: 'text/css; charset=utf-8' },
};

/**
 * The one thing in the console's files that cannot be written down: its own address.
 *
 * The page has to link its stylesheet and its script, and the script has to know where to
 * fetch the statistics from — and all three are under a path only the operator knows. With
 * no build step anywhere in this project there is nothing to compile the value in, so the
 * server substitutes it on the way out. One token, in one file (`console.html`), replaced
 * every time it is served.
 *
 * Relative URLs were the alternative and they are a trap here: `/back-office` and
 * `/back-office/` are the same console, and `href="console.css"` resolves to a different
 * place under each. An absolute path built from the configured one is the same under both.
 */
const ADMIN_BASE_TOKEN = /\{\{ADMIN_BASE\}\}/g;

/**
 * Everything under the console's configured path.
 *
 * The first line is the whole security posture: without both environment variables this
 * is a 404 for every path, every method and every caller. In practice the router cannot
 * even reach it in that state — `ADMIN_PATH` is null, so nothing matches — and the check
 * stays because a guard on a security surface should not depend on a caller having come
 * through the one door that currently exists.
 *
 * The **shell is served without a credential** and the **numbers are not**, which is the
 * same split `refuseLocked` describes for a locked office and is sound for the same
 * reason: `console.html` is a fixed file with no data in it, identical on a server that
 * has recorded a million events and one that booted a second ago, so serving it reveals
 * nothing beyond "this deployment has a console" — which anyone able to sign in knows
 * already. The password form is ordinary client UI reacting to a 401, so there is no
 * server-rendered login page and no second template to keep in step.
 */
async function handleAdmin(req, res, route) {
  if (!ADMIN_ENABLED) return adminAbsent(res);

  if (route === '/api/session') {
    if (req.method === 'POST') return handleAdminSignIn(req, res);
    if (req.method === 'DELETE') {
      clearAdminCookie(res);
      return json(res, 200, { signedIn: false });
    }
    return json(res, 405, { error: 'POST to sign in, DELETE to sign out' });
  }

  if (route === '/api/stats' && req.method === 'GET') {
    // No counts in the refusal, and no hint of how many there would have been: an
    // unauthenticated caller learns only that they are not signed in.
    if (!adminSignedIn(req)) return json(res, 401, { error: 'this console needs its password' });
    return json(res, 200, adminReport());
  }

  const asset = ADMIN_FILES[route];
  if (asset) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' });
    return sendAdminFile(res, asset);
  }

  // Anything else under the console's path is as absent as the whole console is when it
  // is not configured — an unrecognised path here must not answer differently from an
  // unconfigured one, or the shape of the surface is readable from outside it.
  return adminAbsent(res);
}

/** One of the three console files, read from `admin/` and never from a caller's path. */
function sendAdminFile(res, asset) {
  fs.readFile(path.join(ROOT, 'admin', asset.file), (err, raw) => {
    if (err) return adminAbsent(res);
    // `ADMIN_PATH` has already been through `normaliseAdminPath`, so it holds nothing
    // that needs escaping into an attribute — no quote, no angle bracket, no space.
    const data = asset.template
      ? Buffer.from(raw.toString('utf8').replace(ADMIN_BASE_TOKEN, ADMIN_PATH), 'utf8')
      : raw;
    res.writeHead(200, {
      'Content-Type': asset.type,
      'Cache-Control': 'no-store',
      // The console draws its own charts from its own JSON and loads nothing from
      // anywhere else, so it can say so: no third-party script, no inline handler, no
      // frame, no form target. There is no build step here to complicate it.
      //
      // `font-src` is here because the console wears the shared theme
      // (`assets/ui-theme.css`), which loads Inter and JetBrains Mono from `assets/`.
      // Under `default-src 'none'` a missing `font-src` is not a warning — the fonts are
      // simply blocked, and the page silently falls back to a system stack. Which is to
      // say: the reason this page looks like the rest of the application is a header.
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(data);
  });
}

/**
 * POST /admin/api/session — type the password.
 *
 * Both limiters are spent **before** the KDF, for the reason the unlock route gives: an
 * unmetered attempt route on a deliberately expensive function is a way to spend this
 * server's cpu as well as a way to guess. Only wrong attempts count — a correct one is
 * refunded — so getting it right after a typo costs nothing.
 */
async function handleAdminSignIn(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return refuseBody(req, res, err);
  }
  const offered = body?.password;
  if (typeof offered !== 'string' || !offered) {
    return json(res, 400, { error: 'send a password' });
  }
  // The same ceiling the office passcode uses, and here it is also what stops a caller
  // handing scrypt a megabyte to chew on.
  if (offered.length > 256) return json(res, 400, { error: 'that is not the password' });

  const key = clientKey(req);
  for (const [limiter, limiterKey, scope] of [
    [adminPerClient, key, 'client'],
    [adminPerServer, '*', 'server'],
  ]) {
    const spend = limiter.take(limiterKey);
    if (spend.ok) continue;
    if (scope === 'server') adminPerClient.refund(key);
    const seconds = retryAfterSeconds(spend.retryAfterMs);
    res.setHeader('Retry-After', String(seconds));
    return json(res, 429, {
      error: `too many wrong passwords: try again in ${waitInWords(seconds)}.`,
      retryAfterSeconds: seconds,
      scope,
    });
  }

  if (!sameDigest(deriveKey(offered, ADMIN_SALT), adminDigest)) {
    return json(res, 401, { error: 'that is not the password' });
  }
  adminPerClient.refund(key);
  adminPerServer.refund('*');
  setAdminCookie(req, res);
  return json(res, 200, { signedIn: true, ...adminReport() });
}

/**
 * Everything the console draws, in one response.
 *
 * Three parts, and the console keeps them visibly apart because they answer with
 * different authority and a reader who mixes them up will over-trust one of them:
 *
 *   * `days` — recorded history, complete only from `recordingSince` (lib/stats-store.cjs).
 *   * `census` — a photograph of the offices that exist *now*. It is not history and
 *     cannot be: a reaped office took its settings and its furniture with it.
 *   * `now` — this server's live totals and its own limits, so a number has something to
 *     be a proportion of.
 */
function adminReport() {
  const census = store.census();
  return {
    generatedAt: Date.now(),
    recording: {
      since: stats.recordingSince,
      retainDays: stats.RETAIN_DAYS,
      sourceKeys: stats.SOURCE_KEYS,
    },
    days: stats.series(),
    census,
    now: {
      offices: census.offices,
      demoOffice: store.has(keycard.DEMO_KEYCARD),
      maxOffices: store.MAX_OFFICES,
      idleTtlMs: store.IDLE_TTL_MS,
      uptimeMs: Math.round(process.uptime() * 1000),
    },
  };
}

// --- bounding office creation ----------------------------------------------
//
// Creating an office takes no credential, and that is the product rather than a hole
// in it: reception's "Open a new office" is the front door, and a shared link works
// before anyone has opened the room behind it. So the endpoint cannot be gated — it
// can only be bounded, and it is bounded three ways, because each one covers what the
// others cannot:
//
//   1. **Per client, per window.** Stops one caller in a loop, which is the whole of
//      the realistic case. Keyed on the client address, which behind a proxy means
//      trusting a header — see `clientKey`.
//   2. **Per server, per window.** The same limit with the key thrown away. A caller
//      rotating spoofed addresses defeats (1) entirely and this not at all, so it is
//      the number that decides how fast the store can be filled at worst.
//   3. **A hard cap on offices** (`lib/office-store.cjs`). The only one of the three
//      that survives a restart, and the only one that is a bound on the *disk* rather
//      than on a rate.
//
// All three fail with a sentence saying which limit was hit and when to come back:
// `src/office/new-office.js` puts the server's own words on reception's hint line, so
// the numbers are only ever read in one place and a refusal is never just a status.

/**
 * How many offices one client may create in a window.
 *
 * Twenty, which is generous on purpose, because this is not the number that bounds
 * anything: the cap bounds the store and the whole-server limit bounds the rate. What
 * *this* one has to do is stop one caller in a loop, and a loop does twenty in under a
 * second and is then stopped for ten minutes — while nothing a person does comes near
 * it. Reception mints one office per click; `aop-connect` and the OpenClaw
 * setup scripts mint one each.
 *
 * Deliberately not sized down to "what a visitor needs", which would be about three.
 * One address is often not one person — an office, a school, a VPN and a mobile
 * carrier all arrive as one — and a shared exit is exactly the case where a tight
 * per-client limit stops being a rate limit and starts being an outage for a building.
 * The cost of the generous end is that a determined single caller fills the store in
 * about seventeen hours instead of four; the cost of the tight end is a stranger being
 * told to come back later because a colleague opened an office first.
 */
const MINT_PER_CLIENT = Number(process.env.ROVING_OFFICE_MINT_PER_CLIENT) > 0
  ? Number(process.env.ROVING_OFFICE_MINT_PER_CLIENT) : 20;

/**
 * How many offices the whole server may create in a window, from everyone together.
 *
 * Sixty, which is twelve unrelated first-time visitors an hour on a demo host that
 * has never seen anything like that — and, put the other way, the reason a caller who
 * rotates addresses to defeat the per-client limit still cannot fill a 500-office
 * store in under an hour and a half. That is the number's real job: to buy an
 * operator time to notice, since the cap alone would be reached in seconds.
 */
const MINT_PER_SERVER = Number(process.env.ROVING_OFFICE_MINT_PER_SERVER) > 0
  ? Number(process.env.ROVING_OFFICE_MINT_PER_SERVER) : 60;

/** The window both limits count over. Ten minutes. */
const MINT_WINDOW_MS = Number(process.env.ROVING_OFFICE_MINT_WINDOW_MS) > 0
  ? Number(process.env.ROVING_OFFICE_MINT_WINDOW_MS) : 10 * 60_000;

/**
 * Whether a forwarded-for header may be believed.
 *
 * Off by default and it has to be, because the header is written by whoever sent the
 * request: trusting it unasked would turn the per-client limit into a field an
 * attacker fills in. On a laptop the socket address is the client address and this
 * changes nothing.
 *
 * On a hosted deployment the opposite is true and just as absolute — every request
 * arrives from the platform's proxy, so *without* this the per-client limit collapses
 * into the per-server one and one visitor's five mints are the whole host's. So the
 * deployment that runs behind a proxy says so (`fly.toml`), which is the only place
 * that can honestly know it.
 */
const TRUST_PROXY = process.env.ROVING_OFFICE_TRUST_PROXY === '1';

const mintPerClient = createRateLimiter({ limit: MINT_PER_CLIENT, windowMs: MINT_WINDOW_MS });
const mintPerServer = createRateLimiter({ limit: MINT_PER_SERVER, windowMs: MINT_WINDOW_MS });

/**
 * Who to count this request against.
 *
 * `Fly-Client-IP` before `X-Forwarded-For` because Fly's proxy *overwrites* the first
 * and only appends to the second, so where both exist the former is the one the
 * platform vouches for and the latter still carries whatever the caller put there.
 * Leftmost of `X-Forwarded-For` for any other proxy, which is the client as the first
 * hop saw it. Neither is read at all unless the deployment set `TRUST_PROXY`.
 */
function clientKey(req) {
  if (TRUST_PROXY) {
    const fly = req.headers['fly-client-ip'];
    if (fly) return String(fly).trim();
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Seconds, rounded up and at least one — a `Retry-After` of 0 invites an instant retry. */
function retryAfterSeconds(ms) {
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * The same wait as a person would say it.
 *
 * `Retry-After` is seconds because the header is specified in seconds, but a sentence
 * that says "try again in 592 seconds" makes a reader do arithmetic to find out it
 * means ten minutes. Over ninety seconds this rounds up to whole minutes — up, so the
 * advice is never early, and never "in 0 minutes".
 */
function waitInWords(seconds) {
  if (seconds <= 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * May this request create an office? Answers the request itself when the answer is no.
 *
 * The demo office is exempt: it is where `/` redirects, so counting it would spend a
 * first-time visitor's allowance on a room they did not ask for, and refusing it would
 * take the front door down with the limit.
 *
 * @returns {boolean} true if the caller may go on and create
 */
function admitOfficeCreation(req, res, card = null) {
  if (card && card === keycard.DEMO_KEYCARD) return true;

  const key = clientKey(req);
  const mine = mintPerClient.take(key);
  if (!mine.ok) {
    const seconds = retryAfterSeconds(mine.retryAfterMs);
    res.setHeader('Retry-After', String(seconds));
    json(res, 429, {
      error: `too many new offices from here: ${MINT_PER_CLIENT} every ${Math.round(MINT_WINDOW_MS / 60_000)} minutes. Try again in ${waitInWords(seconds)}, or open an office you already have a keycard for.`,
      limit: MINT_PER_CLIENT,
      windowMs: MINT_WINDOW_MS,
      retryAfterSeconds: seconds,
      scope: 'client',
    });
    return false;
  }

  const everyone = mintPerServer.take('*');
  if (!everyone.ok) {
    // The caller did nothing wrong, so their own allowance is handed back: a queue
    // behind a busy minute should not also cost them four of their five tries.
    mintPerClient.refund(key);
    const seconds = retryAfterSeconds(everyone.retryAfterMs);
    res.setHeader('Retry-After', String(seconds));
    json(res, 429, {
      error: `this office server is opening new offices as fast as it will: ${MINT_PER_SERVER} every ${Math.round(MINT_WINDOW_MS / 60_000)} minutes. Try again in ${waitInWords(seconds)}.`,
      limit: MINT_PER_SERVER,
      windowMs: MINT_WINDOW_MS,
      retryAfterSeconds: seconds,
      scope: 'server',
    });
    return false;
  }
  return true;
}

/**
 * The store is full, said out loud.
 *
 * 503 rather than 429, because this is not a rate: the caller's pace is irrelevant
 * and coming back in a second will not help. `Retry-After` is the idle deadline,
 * which is genuinely when the next room falls free if nobody leaves one sooner.
 */
function refuseFullStore(res, err) {
  res.setHeader('Retry-After', String(retryAfterSeconds(store.IDLE_TTL_MS)));
  return json(res, 503, {
    error: `${err.message}. Offices are cleared after ${Math.round(store.IDLE_TTL_MS / 60_000)} idle minutes, so one will free up — or open an office you already have a keycard for.`,
    maxOffices: err.maxOffices,
    scope: 'capacity',
  });
}

/**
 * Open an office for a request that may be creating it, or answer the request.
 *
 * Every door that can create one goes through here, so the limits are counted once
 * and worded once. An office that already exists is not a creation and costs nothing —
 * which is what keeps a mint at one counted event rather than two, since the browser's
 * very next request is a `GET` on the room it just made.
 *
 * @returns {?object} the office, or null when the answer has already been written
 */
function openOfficeFor(req, res, card) {
  const existing = store.get(card);
  if (existing) return existing;
  if (!admitOfficeCreation(req, res, card)) return null;
  try {
    return store.open(card);
  } catch (err) {
    if (err?.code !== 'store-full') throw err;
    refuseFullStore(res, err);
    return null;
  }
}

/** POST /api/offices — mint a keycard nobody is using and open the office there. */
function handleMint(req, res) {
  if (!admitOfficeCreation(req, res)) return undefined;
  let office;
  try {
    office = store.create();
  } catch (err) {
    if (err?.code === 'store-full') return refuseFullStore(res, err);
    return json(res, 503, { error: err.message });
  }
  // One of the two responses in the whole server that carry a write capability, and
  // the only one that needs no capability to ask for. Whoever minted the office is
  // the only party who ever sees this one, which is what makes the keycard safe to
  // share afterwards — so it goes here and not into `toJSON`, and there is
  // deliberately no route that will tell you it again.
  //
  // It is also the root of the chain: every later token is minted by presenting one
  // that already exists, so this is where an office's write capability begins — and
  // therefore where *ownership* begins, since holding this token is the whole of being
  // an office's owner. There is no user store and no account to attach it to. The
  // browser at reception keeps it (`src/office/owner.js`), which is what makes closing
  // an office and setting a passcode on one possible from the front door at all; for a
  // long time it read this field and threw it away, and an office cut at reception was
  // therefore permanently unownable.
  const minted = store.mintWriteToken(office, { label: 'first' });
  return json(res, 201, {
    ...store.toJSON(office),
    // The field name predates there being more than one, and adapters and installers
    // read it. It stays exactly what it was: the plaintext, once.
    writeToken: minted.token,
    writeTokenId: minted.id,
  });
}

// --- Static files ----------------------------------------------------------

/**
 * Is `target` `base` itself, or somewhere underneath it?
 *
 * A boundary test, and the distinction is the whole reason this is a named function.
 * `target.startsWith(base)` is a *string prefix* test, so with `base` of
 * `/home/me/roving-office` it also accepts `/home/me/roving-office-secrets/loot.txt` —
 * a directory the server has no business reading, sitting next to the checkout, one
 * `..%2f` away. `%2f` is what makes it reachable: it survives `url.pathname` intact
 * (the browser and `new URL` both collapse a real `/../`) and is only turned back into
 * a separator by the `decodeURIComponent` in `serveStatic`, after which `path.normalize`
 * walks out of the checkout and the prefix still matches.
 *
 * Requiring the separator closes it, and `target === base` keeps the base directory
 * itself inside its own boundary — without that clause a request that resolves exactly
 * to `base` would be refused, which is not what any caller means.
 */
function within(base, target) {
  return target === base || target.startsWith(base + path.sep);
}

function sendFile(res, filePath, code = 200) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // `no-store`, because this is a development server for a project with no build
    // step: every reload must fetch the file as it is on disk right now. Without
    // it there are no validators at all — no ETag, no Last-Modified — and browsers
    // are free to keep an ES module indefinitely, so a source edit appears to have
    // done nothing and the bug you just fixed is still on screen.
    res.writeHead(code, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
}

/**
 * `/docs` is the built documentation site, with a fallback to `docs/` itself.
 *
 * Eleventy renders `docs/user` and `docs/developer` into `docs/site`, and that directory is
 * served *at* `/docs` — so `/docs/user/install.html` is `docs/site/user/install.html`. What
 * is deliberately not in the build is everything that is already a finished file: the three
 * standalone HTML libraries, which are whole documents with their own head and their own
 * module imports, and 5MB of imagery. Those stay in `docs/` and are reached by the fallback
 * below.
 *
 * One rule rather than two, because the alternative is copying either the libraries or the
 * images into the build output, and both would then exist twice in git — which
 * `.gitignore` argues against for good reason. The fallback also means the editor's
 * Add-item menu keeps finding `/docs/images/objects/*.png` exactly where it always has.
 */
function resolveDocs(urlPath) {
  const tail = urlPath.slice('/docs'.length);
  // `/docs` and `/docs/` are the same request, and both mean the landing page. Handled
  // here rather than by a directory-index rule, because this is the only directory in the
  // whole server that has an index and inventing the general case would be inventing a
  // behaviour nothing else wants.
  const rest = tail === '' || tail === '/' ? '/index.html' : tail;
  const built = path.normalize(path.join(ROOT, 'docs', 'site', rest));
  if (within(path.join(ROOT, 'docs', 'site'), built) && fs.existsSync(built)
      && fs.statSync(built).isFile()) {
    return built;
  }
  return path.normalize(path.join(ROOT, 'docs', rest));
}

function serveStatic(req, res, url) {
  let urlPath = decodeURIComponent(url.pathname);
  if (urlPath === '/' || urlPath === '/home.html') {
    // Seed links still mint a personal office; bad keycards still offer recovery.
    const officeEntry = urlPath === '/home.html'
      || url.searchParams.has('seed') || url.searchParams.has('bad-keycard');
    const destination = officeEntry ? '/offices' : `/office/${keycard.DEMO_KEYCARD}/`;
    res.writeHead(302, { Location: `${destination}${url.search}`, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (urlPath === '/offices' || urlPath === '/offices/') urlPath = '/home.html';
  // The published agent setup instructions, at the URL the prompt itself names as
  // its home. `prompt.md` beside it needs nothing: it is a real file under ROOT and
  // falls through to `sendFile` like any other. Only the directory needs an index.
  if (urlPath === '/agent-setup' || urlPath === '/agent-setup/') urlPath = '/agent-setup/index.html';

  const filePath = urlPath === '/docs' || urlPath.startsWith('/docs/')
    ? resolveDocs(urlPath)
    // Prevent path traversal.
    : path.normalize(path.join(ROOT, urlPath));
  if (!within(ROOT, filePath)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  /**
   * The admin console's files are not static files, whatever the path spells.
   *
   * `admin/` sits inside the checkout, so without this the static server would hand out
   * `console.html` to anybody — and, worse, would do it *after* the router has stopped
   * looking. The router matches on `url.pathname`, which is still percent-encoded, so a
   * request for `/admin%2fconsole.js` does not start with `/admin/` and falls through to
   * here — where the `decodeURIComponent` above turns it back into a separator and
   * resolves the very file the router was guarding. That is the same `%2f` gap the
   * `within` docblock describes, arriving from the other direction.
   *
   * So the boundary is tested on the resolved path rather than on the URL, which is the
   * only form that cannot be spelled two ways. Refused as absent rather than forbidden,
   * because `/admin` must answer the same way whether or not a password is configured.
   */
  if (within(path.join(ROOT, 'admin'), filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  sendFile(res, filePath);
}

// --- Routing ---------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);

  try {
    if (url.pathname === '/api/offices' && req.method === 'POST') return handleMint(req, res);

    // The admin console, at whatever path the operator configured, matched before
    // anything else can claim it. When it is not configured `ADMIN_PATH` is null and this
    // branch cannot match at all — so an unconfigured deployment does not merely refuse
    // the console, it has no route for one, and `/admin` falls through to `serveStatic`
    // like any other path that names nothing (where the guard there answers 404 for the
    // directory the console's files live in).
    if (ADMIN_PATH && (url.pathname === ADMIN_PATH || url.pathname.startsWith(`${ADMIN_PATH}/`))) {
      return await handleAdmin(req, res, url.pathname.slice(ADMIN_PATH.length));
    }

    // A keycard-shaped path we could not parse is a typo, not a 404 to a file:
    // send them to the wizard, which can say so and offer to make one instead.
    if (url.pathname.startsWith('/office/')) {
      const at = keycard.officePath(url.pathname);
      if (!at) {
        res.writeHead(302, { Location: '/offices?bad-keycard=1' });
        return res.end();
      }

      const rest = at.rest;

      // Ingest opens the office it is addressed to: the endpoint file names a
      // keycard, and an adapter posting into an office that was reaped while its
      // harness was quiet should bring the room back, not lose the session.
      if (rest.startsWith('/aop/v0')) {
        // Bounded like the other two doors, and for a reason worth stating: the office
        // is opened *before* the token is checked, so an unauthenticated POST to an
        // invented keycard creates a room and then gets its 401. That is the third way
        // to fill the store, and it is the least obvious one.
        const receiving = openOfficeFor(req, res, at.keycard);
        if (!receiving) return undefined;
        return handleAop(req, res, rest.replace('/aop/v0', ''), url, receiving);
      }
      if (rest === '/api' || rest.startsWith('/api/')) {
        return await handleOfficeApi(req, res, rest.replace('/api', ''), at.keycard, url);
      }
      // The office itself. Every other path under it is the app shell too, so a
      // reload of a deep link lands in the same room rather than on a 404.
      if (req.method === 'GET' || req.method === 'HEAD') {
        // Canonical spelling in the address bar, so a keycard typed in lower case
        // does not become a second-looking URL for the same office.
        const canonical = `/office/${at.keycard}${rest}`;
        if (url.pathname !== canonical) {
          res.writeHead(302, { Location: canonical + url.search });
          return res.end();
        }
        // `/debuglog` is a different page rather than a route inside the app: it
        // reads the same office through the same header, but draws the event stream
        // as text and so loads no scene and no three.js at all. Serving the app
        // shell here would defeat the entire point of it (see src/debuglog.js).
        return sendFile(res, path.join(ROOT, rest === DEBUG_LOG_PATH ? 'debuglog.html' : 'index.html'));
      }
      return json(res, 405, { error: 'GET only' });
    }

    // The un-keycarded protocol paths, kept working for adapters and curl recipes
    // written before offices had addresses: they land in whichever office holds the
    // local endpoint's claim.
    //
    // Loopback-only, and this is the one place where that check still earns its keep.
    // Everywhere else the keycard in the path *is* the read capability, so opening
    // reads to any host costs nothing — but here the office is named implicitly, by
    // whichever one holds this machine's endpoint. A caller who has proved nothing
    // would be handed a stream of someone's real agents. The alias is a local
    // convenience, so it stays local; to read an office from elsewhere, hold its
    // keycard and say so.
    if (url.pathname.startsWith('/aop/v0')) {
      if (!isLocal(req)) return json(res, 403, { error: 'name an office: /office/<keycard>/aop/v0/...' });
      const office = store.claimedOffice();
      if (!office) return json(res, 503, { error: 'no office holds the local endpoint yet' });
      return handleAop(req, res, url.pathname.replace('/aop/v0', ''), url, office);
    }

    if (url.pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        offices: store.size,
        // A keycard is the read capability, so handing this one out unasked would
        // publish the way into whichever office this machine is feeding. Local callers
        // are the ones who need it — it is a diagnostic for "which room am I filling?"
        ...(isLocal(req) ? { claimed: store.claimedKeycard() } : {}),
        idleTtlMs: store.IDLE_TTL_MS,
        // The cap and the count together, because "how full is it?" is the question an
        // operator actually has, and one number without the other cannot answer it.
        maxOffices: store.MAX_OFFICES,
      });
    }

    return serveStatic(req, res, url);
  } catch (err) {
    if (res.headersSent) return res.end();
    return json(res, err?.code === 413 ? 413 : 500, { error: err?.message ?? 'server error' });
  }
});

// --- Boot ------------------------------------------------------------------

/**
 * The keycard format is loaded, not restated.
 *
 * src/office/keycard.js is an ES module because the browser needs it too — the wizard
 * validates what you type before it navigates — and a CommonJS copy of the
 * alphabet here would be a second opinion about which strings are keycards. That
 * is worth an async boot: a client accepting a keycard the server then rejects is
 * a bug nobody would find twice.
 */
async function main() {
  keycard = await import('./src/office/keycard.js');
  stats = createStatsStore({ file: statsFile, log: (msg) => console.log(msg) });
  stats.load();
  store = createOfficeStore({
    keycard,
    file: officeFile,
    idleTtlMs: IDLE_TTL_MS,
    maxOffices: MAX_OFFICES,
    log: (msg) => console.log(msg),
    // The tally, hung off the store because the store is the only place that sees every
    // office begin and end (see `createOfficeStore`). It counts and cannot refuse.
    onOpen: (card, { reserved }) => stats.officeMinted({ reserved }),
    onClose: (card, { reserved, reason }) => (reason === 'reaped'
      ? stats.officesReaped(reserved ? 0 : 1)
      : stats.officeClosed({ reserved })),
  });
  store.load();

  // Somewhere for local hooks to land before anyone opens an office. The demo
  // office is never reaped, so it is always a valid destination; the first office
  // you open that actually wants live agents takes the claim from it.
  const pinned = PINNED_OFFICE ? keycard.parseKeycard(PINNED_OFFICE) : null;
  if (PINNED_OFFICE && !pinned) {
    console.error(`[office] --office ${PINNED_OFFICE} is not a keycard`);
    process.exit(1);
  }
  // Claiming is about which office receives the machine's hooks, so a server that
  // publishes nothing has no business recording an answer to it in the shared store.
  if (PUBLISH) store.claim(pinned ?? store.claimedKeycard() ?? keycard.DEMO_KEYCARD);
  store.startSweeping();

  try {
    PORT = await listen(server);
  } catch (err) {
    if (err.code === 'EADDRNOTAVAIL') {
      // The one new way to fail since the bind became a setting: a HOST this machine
      // has no address for. Worth naming, because the message underneath is
      // `listen EADDRNOTAVAIL` and does not say which value it came from.
      console.error(`[office] cannot bind HOST=${HOST} — this machine has no such address. Unset it for loopback, or use 0.0.0.0 to serve every interface.`);
    } else if (err.code !== 'EADDRINUSE') {
      console.error(`[office] server error: ${err.message}`);
    } else if (REQUESTED_PORT) {
      // A named port is honoured or refused, never quietly swapped: somebody who typed
      // 8081 is usually pointing something else at it.
      console.error(`[office] port ${REQUESTED_PORT} is already serving something else — try another: node server.cjs ${REQUESTED_PORT + 1}`);
    } else {
      console.error(`[office] every port from ${PORT_RANGE.from} to ${PORT_RANGE.to} is busy — free one, or name a port: node server.cjs 9000`);
    }
    process.exit(1);
  }

  // The listen-time handler is removed once a port is bound, so the server needs a
  // lasting one: an unhandled 'error' event later on takes the process down with a
  // stack trace about `net:1432` and buries the one useful fact.
  server.on('error', (err) => console.error(`[office] server error: ${err.message}`));

  publishEndpoint();
  console.log(`The Roving Office running at http://localhost:${PORT}`);
  // Said out loud only when it is the wide bind, because that is the surprising one and
  // it is the hosted deployments' logs this line lands in. A working tree served to a
  // whole network should be a deliberate sentence somebody can find afterwards.
  if (HOST !== '127.0.0.1') {
    console.log(`Bound to ${HOST} — reachable from other machines, because HOST says so`);
  }
  console.log(`Offices at /office/<keycard> — the demo office is ${keycard.DEMO_KEYCARD}`);
  // Said only when it exists, and never the password. A deployment with no console should
  // have no line about one in its logs — and the path is printed because a log an operator
  // is reading at boot is where they look for it, and because the path is not the secret
  // (see `ADMIN_PATH`). The password is never printed anywhere, on a terminal or not.
  if (ADMIN_ENABLED) console.log(`Admin console at ${ADMIN_PATH} — summary statistics only, both path and password from the environment`);
  if (PUBLISH) {
    console.log(`AOP receiver at /office/<keycard>/aop/v0 — adapter credentials in ${endpointFile}`);
  } else {
    console.log('AOP receiver at /office/<keycard>/aop/v0 — this office is private: it has');
    console.log('not touched the machine\'s endpoint, so nothing posts here until a shell says so:');
    console.log('');
    console.log(`  export AOP_URL=http://127.0.0.1:${PORT}/office/${keycard.DEMO_KEYCARD}/aop/v0/events`);
    // The token opens writes to *every* office on this receiver, so it is printed only
    // to a terminal somebody is sitting at. Piped or redirected stdout is a log file, a
    // CI transcript or a hosting platform's collector — none of them a place to leave a
    // write credential, and the hosted deployments run exactly this line.
    if (process.stdout.isTTY) {
      console.log(`  export AOP_TOKEN=${token}`);
    } else {
      console.log('  export AOP_TOKEN=…   (shown only on a terminal; set AOP_TOKEN yourself to pin it)');
    }
    console.log('');
    console.log('Point them at any office on this server by swapping the keycard. To feed every');
    console.log('adapter on the machine instead, restart with --publish.');
  }
}

/**
 * Listen on `HOST`, taking the port that was asked for or the first free one in the range.
 *
 * Several of these run at once in practice — one per worktree — so a taken port is an
 * ordinary condition rather than an exceptional one, and walking up to the next is what
 * somebody who did not name a port meant. The `error` listener is removed between
 * attempts because a rejected `listen` leaves the server reusable but not its handlers.
 *
 * @returns {Promise<number>} the port actually bound
 */
function listen(server) {
  const ports = REQUESTED_PORT
    ? [REQUESTED_PORT]
    : Array.from({ length: PORT_RANGE.to - PORT_RANGE.from + 1 }, (_, i) => PORT_RANGE.from + i);

  return new Promise((resolve, reject) => {
    const attempt = (i) => {
      /**
       * Which port we ended up on — **asked of the socket, never of this closure.**
       *
       * `server.listen(port, cb)` registers `cb` as a one-shot 'listening' listener,
       * and a failed bind never consumes it: the callback from the attempt on 8080 is
       * still waiting when 8081 succeeds, and then fires. Reading `ports[i]` there
       * reports the port that was *refused* — the server is on 8081 and every URL it
       * prints says 8080, a lie that survives into somebody's shell. Asking the socket
       * makes a stale callback harmless, because whichever one fires gets the same
       * true answer.
       *
       * The fallback is for a server that never binds at all: an entry shim
       * replaces `listen` with a stub that runs the callback and opens no socket, so
       * `address()` is null there and the port asked for is the right answer.
       */
      const settle = () => {
        server.removeListener('error', onError);
        resolve(server.address()?.port ?? ports[i]);
      };
      const onError = (err) => {
        server.removeListener('error', onError);
        server.removeListener('listening', settle);
        if (err.code === 'EADDRINUSE' && i + 1 < ports.length) return attempt(i + 1);
        return reject(err);
      };
      server.once('error', onError);
      // Both the event and the callback, because the two live hosts disagree about
      // which one exists: a real socket emits 'listening', and a dispatching stub calls the
      // callback and emits nothing. `settle` is idempotent via the promise itself.
      server.once('listening', settle);
      // The host is passed, never omitted: `listen(port, cb)` binds every interface,
      // which is the one thing this must not do unless a deployment asked for it.
      server.listen(ports[i], HOST, settle);
    };
    attempt(0);
  });
}

function shutdown() {
  store?.stopSweeping();
  store?.flush();
  // The counters are debounced by two seconds, so a restart inside that window would
  // otherwise lose whatever was counted in it — and on a host that stops as soon as
  // nobody is looking, that window is exactly when the last events arrive.
  stats?.flush();
  unpublishEndpoint();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown();
    process.exit(0);
  });
}
process.on('exit', shutdown);

main().catch((err) => {
  console.error(`[office] failed to start: ${err.message}`);
  process.exit(1);
});
