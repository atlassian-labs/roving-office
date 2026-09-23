// Who an OpenClaw agent is: name, colour, avatar.
//
// OpenClaw keeps two answers to that question in two places, and the better one is not
// the one in the config. `agents.list[].identity.name` is set by whoever edited the
// config, and often is not set at all — but every workspace has an `IDENTITY.md`, which
// the agent itself filled in during the bootstrap conversation:
//
//   # IDENTITY.md - Agent Identity
//
//   - Name: Bobster
//   - Creature: Lobster
//   - Vibe: Surprisingly wise, tough and loyal, extremely resourceful
//   - Emoji: 🦞
//   - Colour: #c1440e
//   - Avatar: avatars/bobster.png
//
// That is where the *default* agent's name lives — `main` typically has no `identity`
// block in the config at all, and it is usually the busiest desk in the building — so a
// bridge that reads only the config leaves the most important character anonymous.
//
// Every path rule below mirrors OpenClaw's own resolution rather than guessing at it:
// `resolveAgentWorkspaceDir`, `resolveDefaultAgentWorkspaceDir`, `resolveStateDir` and
// `resolveDefaultAgentId` in `dist/config-utils-*.js` and `dist/agent-scope-config-*.js`,
// with `IDENTITY.md` from `DEFAULT_IDENTITY_FILENAME`. The field names come from the
// shipped template (`docs/reference/templates/IDENTITY.md`): Name, Creature, Vibe, Emoji
// and Avatar. `Colour` is not in that template — it is a field people add — so both
// spellings are read.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IDENTITY_FILENAME = 'IDENTITY.md';

/** Enough for the fields, which sit at the top; these files can run to essays below. */
const MAX_IDENTITY_BYTES = 128 * 1024;

const str = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length ? s : undefined;
};

/** OpenClaw's own agent-id normalisation, per `dist/config-utils-*.js`. */
export function normaliseAgentId(value) {
  return String(value ?? '').trim().toLowerCase();
}

/** `~/x` → `/home/you/x`, as OpenClaw's `resolveUserPath` does. */
function expandUser(value, home = os.homedir()) {
  const s = str(value);
  if (!s) return undefined;
  if (s === '~') return home;
  if (s.startsWith('~/')) return path.join(home, s.slice(2));
  return s;
}

/** The state root: `OPENCLAW_STATE_DIR`, else `~/.openclaw`. */
function stateDir(env = process.env, home = os.homedir()) {
  return expandUser(str(env.OPENCLAW_STATE_DIR)) ?? path.join(home, '.openclaw');
}

/**
 * The default agent's workspace, honouring `OPENCLAW_WORKSPACE_DIR` and the profile.
 *
 * Note what is *not* honoured: `OPENCLAW_STATE_DIR`. OpenClaw's
 * `resolveDefaultAgentWorkspaceDir` goes straight to `~/.openclaw`, while every other
 * agent's workspace hangs off the state dir — so moving the state dir moves everybody
 * except the default agent. That asymmetry is surprising enough to be worth copying
 * exactly rather than tidying: a bridge that "fixed" it would read the wrong file on
 * precisely the machines that had bothered to configure anything.
 */
function defaultAgentWorkspace(env = process.env, home = os.homedir()) {
  const override = expandUser(str(env.OPENCLAW_WORKSPACE_DIR));
  if (override) return path.resolve(override);
  const profile = normaliseAgentId(env.OPENCLAW_PROFILE);
  const suffix = profile && profile !== 'default' ? `-${profile}` : '';
  return path.join(home, '.openclaw', `workspace${suffix}`);
}

/** The entry in `agents.list` for an id, by OpenClaw's matching rules. */
function agentEntry(config, agentId) {
  const list = config?.agents?.list;
  if (!Array.isArray(list)) return undefined;
  const id = normaliseAgentId(agentId);
  return list.find((entry) => normaliseAgentId(entry?.id) === id);
}

/**
 * OpenClaw's own default agent id, and the reason `main` is spelled out rather than
 * inferred.
 *
 * This used to read "whichever entry says `default: true`, else the first one listed",
 * and the fallback was wrong in both directions at once. `main` typically has **no entry
 * in `agents.list` at all** — that is the whole reason `IDENTITY.md` is read before the
 * config — so crowning the first-listed agent meant:
 *
 *   - `main` was not the default, so it was looked for in `workspace-main`, which does
 *     not exist, and the busiest desk in the building had no name, colour or face; while
 *   - whichever agent happened to be listed first *was* handed `~/.openclaw/workspace`
 *     and read **Main's** `IDENTITY.md`, so it turned up wearing somebody else's name.
 *
 * The default agent id is a constant in OpenClaw, so it is a constant here. An explicit
 * `default: true` still wins, because that is somebody saying so on purpose.
 */
export const DEFAULT_AGENT_ID = 'main';

/**
 * The default agent, which matters because its workspace is `workspace` while everybody
 * else's is `workspace-<id>`.
 */
function defaultAgentId(config) {
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const declared = list.find((entry) => entry?.default === true);
  return declared ? normaliseAgentId(declared.id) : DEFAULT_AGENT_ID;
}

/**
 * Where an agent works, by OpenClaw's `resolveAgentWorkspaceDir`.
 *
 * The last two branches are the ones worth reading twice: with an
 * `agents.defaults.workspace` set, a non-default agent lives in a **subdirectory named
 * after its id**, and only without one does the `workspace-<id>` convention apply.
 */
export function workspaceForAgent(config, agentId, env = process.env, home = os.homedir()) {
  const id = normaliseAgentId(agentId);
  if (!id) return undefined;
  const configured = expandUser(str(agentEntry(config, id)?.workspace), home);
  if (configured) return configured;
  const fallback = expandUser(str(config?.agents?.defaults?.workspace), home);
  if (id === defaultAgentId(config)) return fallback ?? defaultAgentWorkspace(env, home);
  if (fallback) return path.join(fallback, id);
  return path.join(stateDir(env, home), `workspace-${id}`);
}

/**
 * Pull the field block out of an `IDENTITY.md`.
 *
 * Deliberately narrow, because the rest of the file is prose and prose is full of
 * sentences that look like fields. A line counts only as `- **Key:** value` or
 * `- Key: value`, with the bullet and the bold both optional, and only the **first**
 * occurrence of a key is taken — a heading further down that reads `Name: ...` is a
 * paragraph, not a correction.
 *
 * A value on its own line is ignored, which is what makes the shipped template safe to
 * read: an unfilled `- **Name:**` is followed by `_(pick something you like)_`, and
 * calling an agent *(pick something you like)* would be worse than calling it nothing.
 */
export function parseIdentity(text) {
  const out = {};
  const lines = String(text ?? '').split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s{0,3}(?:[-*+]\s+)?\*{0,2}([A-Za-z][A-Za-z ]{0,20}?)\*{0,2}\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    let value = m[2].trim();
    // The template's bold runs *through* the colon — `- **Name:** Claw` — so the closing
    // `**` lands at the front of the value and has to come off, or every agent in the
    // room is called `** Something`. Then the template's italic hints come off too, and
    // what is left is rejected if it was only ever a hint: `_(pick something you like)_`.
    value = value.replace(/^\*{1,2}/, '').replace(/\*{1,2}$/, '').trim();
    value = value.replace(/^_(.*)_$/s, '$1').trim();
    if (!value || /^\(.*\)$/s.test(value)) continue;
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/**
 * Read and cache an agent's `IDENTITY.md`.
 *
 * Cached on mtime, because this is called from a hook on the way to publishing an event
 * and a gateway can run for weeks: a `statSync` per event is affordable, re-reading a
 * file that has not changed is not. A missing file is a perfectly normal answer and is
 * cached as one, so an agent without a workspace does not cost a syscall per event
 * either.
 */
export function makeIdentityReader({ readFile = fs.readFileSync, stat = fs.statSync } = {}) {
  const cache = new Map();
  return (workspace) => {
    if (!workspace) return {};
    const file = path.join(workspace, IDENTITY_FILENAME);
    let mtimeMs;
    let size = 0;
    try {
      const info = stat(file);
      mtimeMs = info.mtimeMs;
      size = info.size;
    } catch {
      mtimeMs = null;   // no file, or no permission: both mean "nothing to read"
    }
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.fields;
    let fields = {};
    if (mtimeMs !== null && size <= MAX_IDENTITY_BYTES) {
      try {
        fields = parseIdentity(readFile(file, 'utf8'));
      } catch {
        fields = {};   // unreadable is the same as absent, and never worth an exception
      }
    }
    cache.set(file, { mtimeMs, fields });
    return fields;
  };
}

/**
 * A last-resort name from the agent id, which is how the default agent comes to be
 * called **Main**.
 *
 * Only a single all-letters word qualifies. `main` and `albus` read as names; `code-reviewer`
 * and `agent-2` are slugs, and a character called Code-reviewer is the machine showing
 * through — better a generated name than that.
 *
 * Used only for ids that appear in `agents.list`, and for the default agent — in both
 * cases the id is a handle a person chose, whether they wrote it in the config or accepted
 * OpenClaw's. An id from anywhere else — a subagent type like `explore`, say — is a
 * category rather than a name, and the office is better at inventing those than we are.
 */
export function nameFromAgentId(agentId) {
  const id = normaliseAgentId(agentId);
  if (!/^\p{L}+$/u.test(id)) return undefined;
  return id[0].toLocaleUpperCase() + id.slice(1);
}

/** Image files worth carrying: what the office will store, and nothing that runs. */
const AVATAR_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/**
 * `Avatar: avatars/paige-turner.jpg` → a file on this disk, or a URL to leave alone.
 *
 * The written value is a relative path far more often than not, and relative to *what* is
 * the only real question here. The workspace is the obvious answer and usually the right
 * one, since that is the directory the `IDENTITY.md` itself lives in — but the config's
 * `identity.avatar` sits beside an `agentDir`, and a picture kept with the agent rather
 * than the workspace is just as reasonable a habit. So the candidates are tried in order
 * and the first one that exists wins, which needs no rule about which convention an
 * operator was following.
 *
 * An `http(s)` value is passed straight through as a URL: somebody else is already hosting
 * it, and uploading a copy would be worse in every way. An extension we would not store is
 * dropped here rather than after a pointless read — and refusing an `.svg` is the point,
 * since the office would serve it from its own origin.
 */
function resolveAvatar(value, { workspace, entry, env = process.env, home = os.homedir() } = {}) {
  const written = str(value);
  if (!written) return undefined;
  if (/^https?:\/\//i.test(written)) return { url: written };
  if (!AVATAR_EXTENSIONS.has(path.extname(written).toLowerCase())) return undefined;
  const expanded = expandUser(written, home);
  if (!expanded) return undefined;
  if (path.isAbsolute(expanded)) return { path: expanded };
  const bases = [
    workspace,
    expandUser(str(entry?.agentDir), home),
    stateDir(env, home),
  ].filter(Boolean);
  // Every candidate, so the caller can pick the one that is really there.
  return { candidates: bases.map((base) => path.resolve(base, expanded)) };
}

/**
 * Everything the office can use about who an agent is.
 *
 * Name precedence is `IDENTITY.md` → `agents.list[].identity.name` → `agents.list[].name`
 * → the id if it reads as a word. The workspace wins because the agent wrote it about
 * itself and keeps it current, while the config block is a label somebody else typed
 * once and often left empty.
 */
export function makeIdentityResolver({
  api, readIdentity = makeIdentityReader(), exists = fs.existsSync, env = process.env,
} = {}) {
  return (agentId) => {
    const id = normaliseAgentId(agentId);
    if (!id) return null;
    const config = api?.config;
    const entry = agentEntry(config, id);
    const workspace = workspaceForAgent(config, id, env);
    const fields = readIdentity(workspace);
    // The default agent gets the id-as-name fallback without an entry, because it is the
    // one agent that routinely has no entry — and a `main` that ends up nameless is the
    // busiest desk in the building drawn as a stranger.
    const known = Boolean(entry) || id === defaultAgentId(config);
    const name = str(fields.name)
      ?? str(entry?.identity?.name)
      ?? str(entry?.name)
      ?? (known ? nameFromAgentId(id) : undefined);
    const avatar = str(fields.avatar) ?? str(entry?.identity?.avatar);
    const picture = resolveAvatar(avatar, { workspace, entry, env });
    // An absolute path still has to be there; a relative one is whichever candidate is.
    const file = picture?.path
      ? (exists(picture.path) ? picture.path : undefined)
      : picture?.candidates?.find((candidate) => exists(candidate));
    return {
      name,
      color: str(fields.colour) ?? str(fields.color),
      avatar,
      // Split in two, because the office needs a URL and only one of these is one
      // already: a picture on the web can be pointed at, a picture on this disk has to
      // be carried there (see lib/avatar.mjs).
      avatarUrl: picture?.url,
      avatarPath: file,
      // Where the answer came from. Only ever used to say so out loud — an identity that is
      // wrong is nearly always an identity read from the wrong directory, and a log line
      // naming the file turns that from an afternoon into a glance.
      workspace,
    };
  };
}
