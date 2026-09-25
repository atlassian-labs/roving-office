// The emitter core: everything an AOP emitter needs that is neither harness-specific
// nor transport-specific.
//
// Three things live here, and they are here because they are the same answer to the
// same question however the events were obtained:
//
//   1. **Where the office is** (`resolveEndpoint`, `isLoopback`) — spec §5.5.
//   2. **Which office a directory belongs to** (`deriveProject`) — spec §3.4.1.
//   3. **How much may be said, and how short** (`resolveRedaction`, `clamp`,
//      `tidyPath`, CAPS) — spec §10.
//
// It was extracted when a *third* consumer arrived, which is the right moment: two
// copies are a coincidence, three are a drift. `bin/aop-send.cjs` reads a hook payload
// on stdin and dies; `openclaw-plugin/` is a long-lived in-process bridge that never
// dies; a future `rovo serve` bridge will be a third shape again. None of them agree
// about transport — a short-lived hook spools and hands off, a bridge batches on a
// timer — so transport deliberately stays out of this file. What they cannot be allowed
// to disagree about is which room a repo walks into and what a desk label is allowed
// to contain, because those two are observable to the person watching the office and
// to the person whose prompt it is.
//
// Same reasoning as `bin/lib/local-config.cjs`, one level up: that file owns the config
// *files* every install shares, this one owns the *decisions* every emitter shares.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const DIR = path.join(HOME, '.roving-office');
const ENDPOINT_FILE = path.join(DIR, 'endpoint.json');
const PROJECT_CACHE = path.join(DIR, 'project-cache.json');
const ALIAS_FILE = path.join(DIR, 'projects.json');     // optional repo-slug → office-id map
const SETTINGS_FILE = path.join(DIR, 'settings.json');  // redaction, without an env var

const GIT_MS = 400;                        // per git invocation, and only on a cache miss
const PROJECT_TTL_MS = 60 * 60 * 1000;
const PROJECT_CACHE_MAX = 64;

// The shape of a cached `project`, bumped whenever what goes on the wire narrows.
// The cache is a file on a contributor's machine and outlives any release, so an
// entry written before `repo.remote` was reduced still holds the verbatim URL —
// and a version that no longer matches is simply a miss, which costs two git
// invocations once per directory and cannot serve the old field to an office.
const PROJECT_CACHE_V = 2;

/** The wire version this emitter speaks, spec §11. Minor bumps are additive. */
const AOP_VERSION = '0.2';

/** Truncation caps, spec §10. */

// `color` is short because every legitimate value is: `#c1440e`, `rebeccapurple`,
// `rgb(193 68 14)`. The cap is there to stop a field somebody typed a sentence into
// from riding along on every event for the rest of the session.
const CAPS = {
  title: 80, summary: 200, message: 200, target: 200, prompt: 2000, label: 60, color: 40,
  // A step title is a desk label like any other, so it caps where a title does. Named
  // apart from `title` all the same: they cap the same today, and one of them is a
  // sentence a model wrote about a checklist item while the other is a prompt's first
  // line — a reason for them to part company later without a hunt for call sites.
  step_title: 80,
  // Why a turn exists (spec §4.2). `origin_name` is an operator's name for a scheduled
  // job — "Hourly inbox triage" — so it caps where a desk label does, being the same
  // kind of thing and often the very same string. `origin_schedule` is short because a
  // cron expression is short: `17 * * * *` is ten characters, and a field sized for a
  // sentence would invite one.
  origin_name: 80, origin_id: 80, origin_schedule: 40, origin_detail: 200,
  // A URL rather than a phrase, so the room for it is a URL's: an office avatar path is
  // about 90 characters, and a hosted one somewhere else may reasonably be longer.
  avatar: 512,
};

// --- small helpers ---------------------------------------------------------

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Write via temp + rename so a concurrent reader never sees half a file. */
function writeJsonAtomic(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch { /* state is a nicety, never a requirement */ }
}

/** Collapse whitespace, cap length, and mark the cut so nothing looks complete. */
function clamp(value, max) {
  if (value == null) return undefined;
  const flat = String(value).replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Make a path presentable and non-identifying: relative to the session's cwd when
 * it sits underneath it, `~`-prefixed otherwise (spec §10).
 */
function tidyPath(value, cwd) {
  if (!value) return undefined;
  let out = String(value);
  if (cwd && out.startsWith(cwd)) out = out.slice(cwd.length).replace(/^\/+/, '') || '.';
  else if (out.startsWith(HOME)) out = `~${out.slice(HOME.length)}`;
  return clamp(out, CAPS.target);
}

/** First non-empty string among several candidate keys — harness payloads vary. */
function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function nowIso() { return new Date().toISOString(); }

/** RFC 3339 in UTC with milliseconds, from whatever the harness gave us. */
function toIso(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Seconds or milliseconds — both appear in the wild.
    return new Date(value > 1e12 ? value : value * 1000).toISOString();
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return nowIso();
}

/**
 * The bag of helpers a mapper is handed — the whole of what `map()` may assume
 * about its host beyond the payload itself.
 *
 * A mapper requires nothing: it is a pure function of what it is given, so it can
 * be driven by a hook process, by the in-process openclaw bridge, or by a test,
 * without any of them agreeing about how this file is reached. That makes the bag
 * a contract rather than a convenience, and a contract restated at each call site
 * is one that can differ per driver — a helper a mapper starts using is then
 * present when the tests drive it and missing when the hook does, or the reverse.
 * Stated once, `undefined` here means `undefined` everywhere.
 *
 * Frozen because a mapper reads it and nothing writes to it; the freeze says so
 * to the next mapper rather than leaving it to be discovered.
 */
const MAPPER_HELPERS = Object.freeze({ clamp, tidyPath, firstString, toIso, CAPS });

// --- project derivation (spec §3.4.1) --------------------------------------

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8', timeout: GIT_MS, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return ''; }
}

/**
 * `git@host:owner/repo.git` and `https://host/owner/repo` → `host/owner/repo`.
 *
 * The `userinfo` cut is at the **last** `@`, not the first, and that is the whole
 * defence rather than a detail. A remote is a string a contributor typed, not a URL
 * anybody validated, so `https://user:p@ssw0rd@host/owner/repo` and
 * `https://user:tok/en@host/owner/repo` both reach here — git carries either
 * verbatim where a URL would have to percent-encode them. A first-`@` cut leaves
 * the *tail of the password* in the slug (`ssw0rd@host/owner/repo`), which is why
 * this is not a cosmetic difference: the slug is on the wire.
 *
 * Cutting at the last `@` cannot under-strip. It can over-strip a *path* containing
 * an `@` — no git host permits one in an owner or repository name, and the check
 * below turns that case into `null`, so the failure mode is a repo with no slug
 * rather than a slug with a credential in it.
 */
function canonicalRemote(remote) {
  if (!remote) return null;
  let s = String(remote).trim().replace(/\.git$/, '');
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const at = s.lastIndexOf('@');
  if (at !== -1) s = s.slice(at + 1);
  s = s.replace(':', '/').replace(/\/{2,}/g, '/');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const slug = parts.join('/');
  // A host, an owner and a name, and nothing else: allow only what a git host
  // allows in those, so an unrecognised shape is declined rather than passed on.
  return /^[A-Za-z0-9._~+%-]+(?:\/[A-Za-z0-9._~+%-]+)+$/.test(slug) ? slug : null;
}

/**
 * The remote as an office may see it: a canonical `host/owner/repo`, a tidied
 * directory, or nothing at all.
 *
 * **Not** the verbatim `git remote get-url origin`, which is what this used to send.
 * That output is whatever a contributor cloned with, and one common form of it is
 * `https://<user>:<token>@host/owner/repo` — so an office was being handed a live
 * credential and then serving it to every keycard holder over `/state` and
 * `/stream`. Two consequences follow and both are wanted:
 *
 * - **It reduces rather than scrubs.** Only the three parts the office has any use
 *   for survive, so a shape this file has never seen loses its credential by
 *   omission instead of by a pattern that has to have anticipated it.
 * - **One repository is one remote.** An ssh clone and an https clone of the same
 *   repo previously reported two different strings for the room they share.
 */
function wireRemote(remote) {
  if (!remote) return undefined;
  const s = String(remote).trim();
  // A remote can be a directory — a bare clone on a stick, a sibling worktree.
  // There is no host/owner/repo in one and no credential either, but its absolute
  // form carries the local account name, so it is tidied as the path it is.
  const local = s.replace(/^file:\/\//i, '');
  if (/^(?:\/|~\/|\.{1,2}\/)/.test(local)) return tidyPath(local.replace(/\.git$/, ''), null);
  return canonicalRemote(s) ?? undefined;
}

/**
 * `session` as an office may see it: `cwd` with `$HOME` collapsed to `~`, spec §10.
 *
 * The mapper keeps the absolute path, because `deriveProject` shells out to git in
 * that directory and `~/dev/repo` is not somewhere git can be run. So the tidying
 * belongs at the wire boundary — after the only consumer that needs the real path
 * has had it, and before the JSON. An absolute path under `$HOME` is the local
 * account name, which is the one identifying thing a `cwd` reliably contains.
 */
function wireSession(session) {
  const cwd = session?.cwd;
  if (typeof cwd !== 'string' || !cwd) return session;
  const tidy = tidyPath(cwd, null);
  return tidy && tidy !== cwd ? { ...session, cwd: tidy } : session;
}

/**
 * Derive `project` for a cwd, cached because hooks fire many times a second and
 * shelling out to git on each one is exactly the latency the spec warns about.
 *
 * Worktrees deliberately collapse onto the repo's office: the id comes from the
 * *remote*, so `roving-office/.worktrees/spec` and the main checkout share a room,
 * with the branch shown as a per-character detail.
 */
function deriveProject(cwd) {
  if (!cwd) return undefined;
  const cache = readJson(PROJECT_CACHE, {}) ?? {};
  const hit = cache[cwd];
  const fresh = hit && hit.v === PROJECT_CACHE_V && Date.now() - (hit.at ?? 0) < PROJECT_TTL_MS;
  let project = fresh ? hit.project : null;

  if (!project) {
    const remote = git(cwd, ['remote', 'get-url', 'origin']);
    const slug = canonicalRemote(remote);
    const top = git(cwd, ['rev-parse', '--show-toplevel']);
    const id = slug ? slug.split('/').pop() : path.basename(top || cwd);
    project = { id, name: id };
    const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    // Reduced here rather than at the wire, because this is the only place the
    // verbatim remote is ever read and the cache below is a file on disk: what is
    // not narrowed before the write is a credential at rest as well as in flight.
    const wire = wireRemote(remote);
    if (wire || branch) {
      project.repo = {};
      if (wire) project.repo.remote = wire;
      if (branch && branch !== 'HEAD') project.repo.branch = branch;
    }
    cache[cwd] = { at: Date.now(), v: PROJECT_CACHE_V, project };
    // Keep the cache from growing without bound across many worktrees.
    const keys = Object.keys(cache);
    if (keys.length > PROJECT_CACHE_MAX) {
      for (const k of keys.slice(0, keys.length - PROJECT_CACHE_MAX)) delete cache[k];
    }
    writeJsonAtomic(PROJECT_CACHE, cache);
  }

  // A repo is rarely named exactly like the office it should walk into, so an
  // optional alias file maps either the canonical remote slug or the derived id
  // onto a project id from src/projects.js. This repo is the easy case — the room
  // in projects.js is `the-roving-office`, which is what this remote already
  // derives to, so it needs no entry. A repo whose name differs from its room
  // does. Read every time, so an edit takes effect on the next hook rather than
  // when the cache expires.
  const aliasFile = readJson(ALIAS_FILE, null);
  const aliases = aliasFile?.aliases ?? aliasFile ?? {};
  const slug = canonicalRemote(project.repo?.remote);
  const alias = aliases[slug] ?? aliases[project.id];
  if (typeof alias === 'string' && alias) project = { ...project, id: alias };

  // §3.4.3: one env var collapses every repo into a single office.
  const scene = process.env.ROVING_OFFICE_SCENE;
  return scene ? { ...project, scene } : project;
}

// --- endpoint (spec §5.5) --------------------------------------------------

/**
 * Loopback or not, which is the only thing that changes an emitter's timing budget.
 * Anything that is not plainly loopback is treated as remote, because being wrong in
 * that direction only costs patience, while being wrong the other way makes a harness
 * wait on the internet.
 */
function isLoopback(url) {
  try {
    const { hostname } = new URL(url);
    // The whole of 127.0.0.0/8 is loopback, not just .1 — a second office on
    // 127.0.0.2 is no further away than the first.
    return /^127\.\d+\.\d+\.\d+$/.test(hostname)
      || hostname === '::1' || hostname === '[::1]' || hostname === 'localhost';
  } catch {
    return false;
  }
}

/**
 * Which office these events belong to, and how to prove we may write to it.
 *
 * Sources, highest precedence first:
 *
 * 0. **An explicit `override`.** Only a long-lived bridge has one: it is configured
 *    once, by an operator, in the host's own config file, which is a better grain than
 *    the environment for something that outlives every shell. Hook adapters pass none.
 * 1. **`AOP_URL` / `AOP_TOKEN` in the environment.** Per-shell, which is the natural
 *    grain for "this terminal's work goes to the hosted office" while everything
 *    else on the machine carries on locally. There is one endpoint file and it holds
 *    one URL, so the environment is the only way to say something different in one
 *    place without disturbing the rest.
 * 2. **`~/.roving-office/endpoint.json`** — written by a local office on start, or by
 *    `aop-connect` when pointing this machine at a remote one.
 *
 * `remote` is derived rather than trusted from the file: a stale `remote: true` next
 * to a loopback URL should not cost us a process spawn per hook.
 */
function resolveEndpoint(override = null) {
  const envUrl = process.env.AOP_URL;
  let endpoint;
  if (override?.url) endpoint = { url: override.url, token: override.token ?? null, source: 'config' };
  else if (envUrl) endpoint = { url: envUrl, token: process.env.AOP_TOKEN ?? null, source: 'env' };
  else endpoint = { ...(readJson(ENDPOINT_FILE, null) ?? {}), source: 'file' };
  if (!endpoint.url) return null;
  endpoint.remote = !isLoopback(endpoint.url);
  return endpoint;
}

// --- delivery --------------------------------------------------------------

/**
 * POST an NDJSON batch. Resolves `true` on 2xx, `false` on anything else, and never
 * throws — spec §5.1 says an emitter treats every failure identically.
 *
 * The budgets are the caller's, because they are the one thing a hook and a bridge
 * genuinely disagree about: a hook is spending the agent's time and gets ~1s, while a
 * bridge is spending its own and can afford four. Everything else about the request is
 * the same, which is why this lives here — and the bracket handling below is exactly
 * why that matters.
 *
 * @param {{url: string, token?: string|null}} endpoint
 * @param {string} body NDJSON
 * @param {{connectMs: number, requestMs: number, gzipOver?: number}} budget
 */
function post(endpoint, body, budget) {
  const { connectMs, requestMs, gzipOver = 4096 } = budget;
  return new Promise((resolve) => {
    let url;
    try { url = new URL(endpoint.url); } catch { return resolve({ ok: false, status: null, reason: `malformed url: ${endpoint.url}`, body: null }); }
    const payload = Buffer.from(body, 'utf8');
    const gzip = payload.length > gzipOver;
    const data = gzip ? zlib.gzipSync(payload) : payload;
    const headers = {
      'Content-Type': 'application/x-ndjson',
      'Content-Length': data.length,
      // `X-Roving-Office-Token`, not `Authorization: Bearer`, and the difference is not
      // stylistic. `Authorization` is a header that hosting layers legitimately claim:
      // Some gateways validate it as their *own* credential, so a bearer token meant
      // for the office is rejected before the office is reached — 401 from the app when
      // it strips the header, 502 "bridge token was rejected" when the gateway takes
      // offence. Verified against a real deployment, where the same request succeeds
      // with this header and fails with that one. Receivers accept both; only this one
      // survives the trip.
      'X-Roving-Office-Token': endpoint.token ?? '',
      // Node sends no `User-Agent` unless told to, and an anonymous POST with no UA is a
      // classic thing for a WAF or egress proxy to refuse — with a 403 that never reaches
      // the office and so cannot be explained by anything the office knows. Naming
      // ourselves is free, and it also means an office operator reading logs can tell our
      // traffic from a scanner's.
      'User-Agent': `roving-office-aop/${AOP_VERSION} (+https://github.com/mcannonbrookes/roving-office)`,
      'Accept': 'application/json',
    };
    if (gzip) headers['Content-Encoding'] = 'gzip';

    // `URL.hostname` keeps the brackets on an IPv6 literal — `http://[::1]:8080/` parses
    // to a hostname of `"[::1]"` — while `http.request` wants it bare and adds its own.
    // Handed the bracketed form it tries to resolve the punctuation as a name, fails,
    // and the office simply never receives anything: every event spools, every retry
    // fails the same way, and nothing anywhere says why. Found by pointing an emitter at
    // an IPv6 loopback URL and watching a reachable receiver get zero requests.
    const hostname = url.hostname.replace(/^\[|\]$/g, '');

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: url.protocol,
      hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers,
    }, (res) => {
      res.resume();
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      if (ok) {
        res.resume();
        return resolve({ ok: true, status: res.statusCode, reason: null, body: null });
      }
      // Read a little of a failing response. The status alone cannot say *who* answered,
      // and that is the question: the office replies JSON (`{"error":"bad or missing
      // token"}`), while a WAF or egress proxy replies HTML. One is a configuration
      // mistake and the other is a network that will not carry the traffic at all, and
      // they are indistinguishable from the status code — a real 403 from somewhere in
      // between looked exactly like an auth failure until the body was read.
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 300) body += c; });
      res.on('end', () => resolve({
        ok: false,
        status: res.statusCode,
        reason: `HTTP ${res.statusCode}${res.statusMessage ? ` ${res.statusMessage}` : ''}`,
        body: body.slice(0, 300).replace(/\s+/g, ' ').trim() || null,
      }));
      res.on('error', () => resolve({
        ok: false,
        status: res.statusCode,
        reason: `HTTP ${res.statusCode}`,
        body: null,
      }));
    });
    req.setTimeout(connectMs, () => { req.destroy(); resolve({ ok: false, status: null, reason: `no response within ${connectMs}ms`, body: null }); });
    const overall = setTimeout(() => { req.destroy(); resolve({ ok: false, status: null, reason: `gave up after ${requestMs}ms`, body: null }); }, requestMs);
    overall.unref?.();
    req.on('error', (err) => resolve({ ok: false, status: null, reason: err?.code ?? err?.message ?? 'connection failed' }));
    req.on('close', () => clearTimeout(overall));
    req.end(data);
  });
}

// --- redaction (spec §10) --------------------------------------------------

/**
 * Spec §10 specifies redaction via env vars, which hooks make awkward: a hook inherits
 * the spawning harness's environment, so changing mode would mean restarting every
 * session. The file is read per event instead, so an edit applies to the next tool
 * call. Env still wins over file, and `full` still needs its own second opt-in.
 */
function resolveRedaction() {
  const file = readJson(SETTINGS_FILE, null) ?? {};
  const mode = String(process.env.ROVING_OFFICE_REDACTION ?? file.redaction ?? '').toLowerCase();
  const promptsAllowed = process.env.ROVING_OFFICE_INCLUDE_PROMPTS === '1' || file.includePrompts === true;
  if (mode === 'full') return promptsAllowed ? 'full' : 'summary';
  if (mode === 'summary') return 'summary';
  return 'metadata';
}

module.exports = {
  HOME, DIR, ENDPOINT_FILE, PROJECT_CACHE, ALIAS_FILE, SETTINGS_FILE,
  AOP_VERSION, CAPS,
  readJson, writeJsonAtomic,
  clamp, tidyPath, firstString, nowIso, toIso,
  MAPPER_HELPERS,
  git, canonicalRemote, wireRemote, wireSession, deriveProject,
  isLoopback, resolveEndpoint,
  post,
  resolveRedaction,
};
