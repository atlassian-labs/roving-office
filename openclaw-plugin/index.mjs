// The Roving Office — an OpenClaw plugin.
//
// Turns OpenClaw agent activity into Agent Office Protocol events (docs/developer/protocol/aop-spec.md)
// and publishes them to an office, local or on the other side of the internet.
//
//   openclaw plugins install --link ./openclaw-plugin
//
// OpenClaw is the odd one out among the harnesses, and this is the pleasant kind of
// odd: Claude Code, Codex and Rovo all emit events by running a shell command with a
// JSON payload on stdin, so each of them costs a Node process per tool call and cannot
// remember anything between two of them. OpenClaw has a real in-process hook bus, so
// this is a **bridge** — one long-lived object that batches, retries, keeps its state
// in memory and can send a heartbeat. See `lib/publisher.mjs` for what that buys.
//
// Three things this file is careful about:
//
// **1. It never returns a decision.** `before_tool_call` and friends are hooks that can
// block a tool call, rewrite its parameters or demand human approval. Every handler here
// returns `undefined`, always. A diorama does not get a vote.
//
// **2. It never awaits the network.** OpenClaw awaits hook handlers and budgets them, so
// a handler that waited on a 900ms remote POST would make every tool call 900ms slower —
// design rule 1, the one that cannot bend. Handlers are synchronous: they map, they
// enqueue, they return. The POST happens on a timer nobody is waiting for.
//
// **3. It cannot throw into the host.** A plugin that throws inside a hook is a plugin
// that breaks the agent it was supposed to be watching. Every handler is wrapped, and a
// handler that fails is logged at debug and forgotten.
//
// The entry object is a plain default export rather than a call to
// `definePluginEntry(...)` from `openclaw/plugin-sdk/plugin-entry`, and that is
// deliberate. Read at 2026.7.1-2, that helper is a pure normaliser — it returns
// `{ id, name, description, configSchema, register }` and defaults `configSchema` to a
// **strict empty object schema**, which would reject the very config this plugin needs.
// So importing it would buy nothing but a bare `openclaw` specifier that a `--link`ed
// directory outside the OpenClaw install cannot reliably resolve. `configSchema` below
// is the duck-typed validator the host actually calls (`safeParse`, per
// `dist/config-schema-*.js`), and the JSON Schema in `openclaw.plugin.json` is what
// `openclaw plugins inspect` reads. Net effect: zero dependencies, nothing to build.

import os from 'node:os';
import path from 'node:path';

import { Publisher } from './lib/publisher.mjs';
import { Mapper } from './lib/map.mjs';
import { makeIdentityResolver } from './lib/identity.mjs';
import { makeAvatarUploader } from './lib/avatar.mjs';

const HARNESS_NAME = 'openclaw';   // spec §4.6, reserved slug
const PLUGIN_ID = 'roving-office';

/**
 * The host validates plugin config through this before a hook ever sees it. Permissive
 * on purpose: the authoritative shape is the JSON Schema in `openclaw.plugin.json`, and
 * a bridge that refused to start because it did not recognise a future key would be a
 * worse outcome than one that ignored it.
 */
const configSchema = {
  safeParse(value) {
    if (value == null) return { success: true, data: {} };
    if (typeof value !== 'object' || Array.isArray(value)) {
      return { success: false, error: { issues: [{ path: [], message: 'expected an object' }] } };
    }
    return { success: true, data: value };
  },
};

function num(value) {
  return Number.isFinite(value) ? Number(value) : undefined;
}

function str(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Read config from wherever this host puts it. `api.pluginConfig` is the resolved
 * `plugins.entries.roving-office.config`; the per-handler `event.context.pluginConfig`
 * is the same thing delivered another way, and taking either means the plugin does not
 * care which of the two a given OpenClaw version prefers.
 */
function readConfig(api) {
  const cfg = api?.pluginConfig;
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

/**
 * Has an operator granted this plugin access to the run lifecycle?
 *
 * `before_agent_run` and `agent_end` are **conversation hooks**, and OpenClaw blocks them
 * for any non-bundled plugin unless `plugins.entries.<id>.hooks.allowConversationAccess`
 * is true. It blocks them *silently from the plugin's side* — registration succeeds, the
 * handler simply never fires, and the only trace is a warning in
 * `openclaw plugins inspect`. Which is how this cost an afternoon: a plain chat turn
 * fires `session_start`, `before_agent_run` and `agent_end` and nothing else, so with
 * those two blocked the office heard about the session and never got a single event it
 * could put on screen.
 *
 * The plugin cannot see the block, but it can read the same config the host reads, so it
 * warns rather than limping on in silence. See `degraded` below for what still works.
 */
function hasConversationAccess(api, pluginId) {
  const entry = api?.config?.plugins?.entries?.[pluginId];
  return entry?.hooks?.allowConversationAccess === true;
}

/**
 * A directory to fall back on when no agent context has offered one.
 *
 * `workspaceDir` lives only on OpenClaw's *agent* context, and the two hooks that carry
 * it are exactly the two that get blocked above — so without conversation access there is
 * no directory, and a session with no directory has no office to walk into.
 *
 * This is the same resolution order OpenClaw documents for `agents.defaults.workspace`
 * (`docs/gateway/config-agents.md`), so the answer matches the directory the agent is
 * really working in rather than being a guess.
 */
function fallbackWorkspace(api) {
  const configured = str(api?.config?.agents?.defaults?.repoRoot)
    ?? str(api?.config?.agents?.defaults?.workspace);
  const chosen = configured ?? str(process.env.OPENCLAW_WORKSPACE_DIR) ?? defaultWorkspace();
  if (!chosen) return undefined;
  return chosen.startsWith('~')
    ? path.join(os.homedir(), chosen.slice(1))
    : chosen;
}

function defaultWorkspace() {
  const profile = str(process.env.OPENCLAW_PROFILE);
  const suffix = profile && profile !== 'default' ? `-${profile}` : '';
  return path.join(os.homedir(), '.openclaw', `workspace${suffix}`);
}

/*
 * Who an agent is — name, colour, avatar — lives in `lib/identity.mjs`, which reads the
 * agent's own `IDENTITY.md` before falling back to the config block. The resolver is
 * built per `register` and closes over `api`, so config reloaded under a long-lived
 * gateway is picked up without re-registering a single hook.
 */

/**
 * Teach the mapper about the cron jobs that already existed when it loaded.
 *
 * `cron_changed` covers everything from here on, but not the past — and the past is what
 * matters for an hourly job on a gateway that just restarted, because its very next tick
 * would otherwise be the one with no name. `ctx.getCron()` is the scheduler itself, and
 * `list()` answers with the same job shapes the hook carries.
 *
 * Async, and nobody waits for it: this is a `gateway_start` handler like any other and
 * design rule 2 applies to all of them. If the list resolves after a tick has already
 * begun, that tick is unnamed and the next is not — which is why `seedJobs` never
 * overwrites what the hook has already said.
 */
function seedCronJobs(mapper, ctx, log) {
  const cron = typeof ctx?.getCron === 'function' ? ctx.getCron() : null;
  if (!cron || typeof cron.list !== 'function') return;
  void Promise.resolve()
    .then(() => cron.list({ includeDisabled: true }))
    // OpenClaw has answered this both ways across versions — a bare array, and `{ jobs }`
    // — and its own reconciler accepts either, so this does too.
    .then((result) => mapper.seedJobs(Array.isArray(result) ? result : result?.jobs))
    .then((taken) => {
      if (taken) log?.info?.(`roving-office: ${taken} scheduled job${taken === 1 ? '' : 's'} named ahead of their next run`);
    })
    .catch((err) => log?.debug?.(`roving-office: could not read the schedule: ${err?.message ?? err}`));
}

/**
 * The identity resolver the mapper actually gets: who an agent is, with a picture the
 * office can load rather than a path on this disk.
 *
 * The two halves are kept apart on purpose. `lib/identity.mjs` answers questions about
 * files and config and nothing else; `lib/avatar.mjs` moves bytes and knows about the
 * office. This function is the only place that needs to know both exist — and it stays
 * synchronous, because the mapper calls it from inside a hook, so the first few events of a
 * session carry no avatar and later ones do (spec §3.2).
 */
function identityWithAvatar(api, uploader, log = null) {
  const resolve = makeIdentityResolver({ api });
  // What we last said about each agent, so the line below is printed when the answer
  // *changes* rather than once and never again. Both halves matter: an agent resolved
  // before its `IDENTITY.md` existed would otherwise be logged as nameless forever, and an
  // agent logged on every event would drown the gateway's log in its own name.
  const said = new Map();
  return (agentId) => {
    const who = resolve(agentId);
    if (!who) return who;
    const full = { ...who, avatarUrl: who.avatarUrl ?? uploader.urlFor(who.avatarPath) };
    announceIdentity(log, said, agentId, full);
    return full;
  };
}

/**
 * Say who an agent turned out to be, and where that came from.
 *
 * This exists because the alternative was an afternoon. An agent wearing the wrong name is
 * almost always an `IDENTITY.md` read from the wrong directory, and nothing anywhere said
 * which directory had been read — so the only way to tell a mis-resolved identity from a
 * missing file from a latched one was to reason about it. One line per agent, when the answer
 * changes, turns that into a glance.
 */
function announceIdentity(log, said, agentId, who) {
  const summary = `${who.name ?? '(no name)'} | ${who.color ?? '-'} | ${who.avatarPath ?? who.avatarUrl ?? '-'}`;
  if (said.get(agentId) === summary) return;
  said.set(agentId, summary);
  const parts = [`roving-office: agent "${agentId}" is ${who.name ?? 'nobody we could name'}`];
  if (who.color) parts.push(`wearing ${who.color}`);
  if (who.avatarPath) parts.push(`face ${who.avatarPath}`);
  else if (who.avatarUrl) parts.push(`face ${who.avatarUrl}`);
  if (who.workspace) parts.push(`read from ${who.workspace}`);
  const line = parts.join(', ');
  // A nameless agent is the interesting case, and the one worth raising your voice for: it
  // means the office will invent a character for an agent that had already told us who it is.
  if (who.name) log?.info?.(line);
  else log?.warn?.(`${line} — the office will make a name up for it`);
}

/**
 * One line saying whether this plugin can do anything, and where it is sending events.
 *
 * A misconfigured emitter is silent by nature — it queues, retries, and looks identical to
 * an idle one. Every failure on the first real install was invisible for exactly this
 * reason, so the absence of an office is a **warning**, not a note: a plugin that cannot
 * publish is not "configured differently", it is broken.
 */
function announce(log, publisher) {
  const stats = publisher.stats();
  if (stats.url) {
    log?.info?.(
      `roving-office: publishing to ${stats.url} `
      + `(${stats.remote ? 'remote' : 'local'}, from ${stats.source})`,
    );
    return;
  }
  log?.warn?.(
    'roving-office: no office to publish to, so nothing will appear. Set one with:\n'
    + `  openclaw config set plugins.entries.${PLUGIN_ID}.config.url   <office-events-url>\n`
    + `  openclaw config set plugins.entries.${PLUGIN_ID}.config.token <write-token>\n`
    + '  (mint both: curl -sX POST <office-host>/api/offices -d \'{}\')',
  );
}

export function register(api) {
  const log = api?.logger ?? null;
  const cfg = readConfig(api);

  if (cfg.enabled === false) {
    log?.info?.('roving-office: disabled by config, publishing nothing');
    return;
  }

  const publisher = new Publisher({
    harness: {
      name: HARNESS_NAME,
      ...(str(api?.version) ? { version: str(api.version) } : {}),
      // Every OpenClaw session reaches its agent through the gateway, whatever the
      // human was holding — a terminal, Discord, a phone. `sdk` is the honest reading
      // of spec §4.7 for that, and it is display-only either way.
      variant: 'sdk',
    },
    endpoint: { url: str(cfg.url), token: str(cfg.token) },
    scene: str(cfg.scene) ?? str(process.env.ROVING_OFFICE_SCENE),
    lingerMs: num(cfg.lingerMs),
    heartbeatMs: num(cfg.heartbeatMs),
    logger: log,
  });

  // Faces are carried over out of band — a hook cannot wait for an upload — and the
  // endpoint is asked for per attempt rather than captured, so an office started after the
  // gateway is still found (see lib/avatar.mjs).
  const avatars = makeAvatarUploader({ endpoint: () => publisher.endpoint(), logger: log });

  // Without conversation access the run hooks never fire, so nothing would ever teach a
  // session its directory. A configured `scene` already answers the routing question, so
  // it is only the directory case that needs a fallback.
  const conversation = hasConversationAccess(api, PLUGIN_ID);
  const mapper = new Mapper({
    publish: (ev) => publisher.publish(ev),
    wrappedHarness: str(cfg.wrappedHarness),
    fallbackCwd: fallbackWorkspace(api),
    routable: Boolean(str(cfg.scene) ?? str(process.env.ROVING_OFFICE_SCENE)),
    expectRealCwd: conversation,
    resolveIdentity: identityWithAvatar(api, avatars, log),
    // So the mapper can say, once, that turns are arriving without the hook that names
    // them — the failure that is otherwise indistinguishable from a busy agent.
    logger: log,
  });

  if (!conversation) {
    log?.warn?.(
      `roving-office: no run lifecycle. OpenClaw blocks "before_agent_run" and "agent_end" `
      + `for non-bundled plugins, so desks will have no job labels and turns will not be `
      + `timed. Tool activity, subagents and sessions still report. To fix:\n`
      + `  openclaw config set plugins.entries.${PLUGIN_ID}.hooks.allowConversationAccess true`,
    );
  }

  // Anything a handler throws stops here. The alternative is a plugin that can break
  // the agent it exists to watch, which is not a trade the office is entitled to make.
  const safe = (name, fn) => (event, ctx) => {
    try {
      fn(event ?? {}, ctx ?? {});
    } catch (err) {
      log?.debug?.(`roving-office: ${name} failed: ${err?.message ?? err}`);
    }
    return undefined;   // never a decision — see the header
  };

  const on = (hook, handler) => {
    try {
      // A small budget, declared rather than inherited: these handlers do no I/O, so if
      // one has not finished in 250ms something is wrong and the agent should not wait
      // for it. `hooks.timeouts.<hook>` in the host config still overrides this.
      api.on(hook, handler, { priority: 10, timeoutMs: 250 });
    } catch (err) {
      // An OpenClaw that does not know this hook is an OpenClaw we still work on, minus
      // one event. Worth a line in the log, not worth failing to load.
      log?.debug?.(`roving-office: hook ${hook} unavailable: ${err?.message ?? err}`);
    }
  };

  on('session_start', safe('session_start', (e, c) => mapper.onSessionStart(e, c)));
  on('session_end', safe('session_end', (e, c) => mapper.onSessionEnd(e, c)));
  on('before_agent_run', safe('before_agent_run', (e, c) => mapper.onAgentRun(e, c)));
  on('agent_end', safe('agent_end', (e, c) => mapper.onAgentEnd(e, c)));
  on('before_tool_call', safe('before_tool_call', (e, c) => mapper.onToolStart(e, c)));
  on('after_tool_call', safe('after_tool_call', (e, c) => mapper.onToolEnd(e, c)));
  on('subagent_spawned', safe('subagent_spawned', (e, c) => mapper.onSubagentSpawned(e, c)));
  on('subagent_ended', safe('subagent_ended', (e, c) => mapper.onSubagentEnded(e, c)));
  on('before_compaction', safe('before_compaction', (e, c) => mapper.onBeforeCompaction(e, c)));
  on('after_compaction', safe('after_compaction', (e, c) => mapper.onAfterCompaction(e, c)));

  // The scheduler, which is how a desk stops saying "Working" at 3am. `cron_changed`
  // carries the job as the operator wrote it — name, id, cron expression — and fires
  // `started` just before the run whose `before_agent_run` will arrive with the matching
  // `ctx.jobId`. It publishes nothing on its own; it fills in the table the turn reads.
  //
  // Worth knowing that this one is **not** a conversation hook: it is absent from
  // OpenClaw's `CONVERSATION_HOOK_NAMES`, so unlike `before_agent_run` it costs no
  // `allowConversationAccess` and works on an install that declined it.
  on('cron_changed', safe('cron_changed', (e) => mapper.onCronChanged(e)));

  // Gateway lifecycle: pick up whatever a previous gateway could not deliver, and hand
  // over cleanly when this one goes. `session_end` fires with reason `shutdown` for every
  // live session first, so the office sees its characters leave rather than time out.
  on('gateway_start', safe('gateway_start', (_e, ctx) => {
    const taken = publisher.drainSpool();
    if (taken) log?.info?.(`roving-office: recovered ${taken} events a previous gateway could not deliver`);
    seedCronJobs(mapper, ctx, log);
  }));

  const shutdown = safe('shutdown', () => {
    void publisher.stop().then((s) => {
      log?.info?.(`roving-office: stopped (sent ${s.sent}, spooled ${s.spooled}, dropped ${s.dropped})`);
    });
  });
  // `gateway_stop` only. `deactivate` is a deprecated alias for it (removed after
  // 2026-08-16), and registering both put the same handler on the same event twice —
  // visible as a duplicated `gateway_stop` in `openclaw plugins inspect`.
  on('gateway_stop', shutdown);

  // Report the endpoint here rather than only from `gateway_start`. A plugin installed or
  // reconfigured on a running Gateway is loaded without another `gateway_start`, so that
  // hook is exactly the wrong place for the one line that says whether this thing can work
  // at all. `openclaw plugins inspect` does not show plugin config, so if the log does not
  // say it, nothing does.
  announce(log, publisher);

  publisher.startHeartbeat(() => mapper.live());

  // Exposed for the test harness and for `bin/aop-openclaw-install.cjs --status`, which
  // would otherwise have to guess at what the plugin is doing.
  return { publisher, mapper, conversation };
}

export default {
  id: 'roving-office',
  name: 'The Roving Office',
  description: 'Publishes OpenClaw agent activity to a Roving Office receiver as Agent Office Protocol events.',
  configSchema,
  register,
};
