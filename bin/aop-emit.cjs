#!/usr/bin/env node
"use strict";
/*
 * aop-emit.cjs — standalone AOP v0 emitter for agents that compose protocol
 * events directly. The mappers in bin/mappers/ turn a harness's native events
 * into AOP; this one skips that step: `node bin/aop-emit.cjs <type> '<json>'`.
 *
 * Fire-and-forget: each event is appended to a local spool and a detached
 * sender flushes it to the office over HTTPS. Every invocation exits 0 —
 * the agent never blocks on the network.
 *
 * Setup: write ~/.roving-office/endpoint.json (mode 0600):
 *   {
 *     "url": "https://therovingoffice.com/office/<KEYCARD>/aop/v0/events",
 *     "keycard": "<KEYCARD>",
 *     "token": "<WRITE_TOKEN>"
 *   }
 * (AOP_URL / AOP_TOKEN env vars override the file.)
 *
 * Optional avatar: PUT the raw image bytes (PNG/JPEG/GIF/WebP, <= 2 MB) to
 *   https://therovingoffice.com/office/<KEYCARD>/aop/v0/avatars/<sha256>
 * with the X-Roving-Office-Token header, then save the returned path to
 * ~/.roving-office/avatar.json as {"path": "<returned path>"}. Every event
 * then carries it as session.actor_avatar.
 *
 * Env overrides: AOP_HARNESS (default "muse"), AOP_ACTOR
 * (default "Muse"), AOP_PROJECT (default "muse").
 *
 * Redaction: metadata-mode shapes only — tool names, tool_class, tidied
 * paths, durations, counts. Never file contents, prompts, replies, or
 * command output. Keep it that way.
 *
 * Licensed under the Apache License, Version 2.0 — see LICENSE.
 * Node built-ins only.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { spawn } = require("child_process");

const DIR = path.join(os.homedir(), ".roving-office");
const ENDPOINT = path.join(DIR, "endpoint.json");
const SESSION = path.join(DIR, "session.json");
const SPOOL = path.join(DIR, "spool.ndjson");
const AOP_VERSION = "0.2";
const MAX_SPOOL_LINES = 2000;

const HARNESS = process.env.AOP_HARNESS || "muse";
const ACTOR = process.env.AOP_ACTOR || "Muse";
const PROJECT = process.env.AOP_PROJECT || "muse";

function loadEndpoint() {
  if (process.env.AOP_URL) {
    return { url: process.env.AOP_URL, token: process.env.AOP_TOKEN || "" };
  }
  try {
    return JSON.parse(fs.readFileSync(ENDPOINT, "utf8"));
  } catch {
    return null;
  }
}

function loadSession() {
  try {
    const s = JSON.parse(fs.readFileSync(SESSION, "utf8"));
    if (s && s.id) return s;
  } catch { /* fall through */ }
  const s = { id: crypto.randomUUID(), seq: 0 };
  try {
    fs.writeFileSync(SESSION, JSON.stringify(s), { mode: 0o600 });
  } catch { /* fall through */ }
  return s;
}

function nextSeq() {
  const s = loadSession();
  s.seq = (s.seq || 0) + 1;
  try {
    fs.writeFileSync(SESSION, JSON.stringify(s), { mode: 0o600 });
  } catch { /* fall through */ }
  return s.seq;
}

function loadAvatarPath() {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(DIR, "avatar.json"), "utf8"));
    return a && a.path ? a.path : null;
  } catch {
    return null;
  }
}

function buildEvent(type, payload) {
  const session = loadSession();
  const sess = { id: session.id, kind: "main", actor: ACTOR, cwd: "~" };
  const avatarPath = loadAvatarPath();
  if (avatarPath) sess.actor_avatar = avatarPath;
  return {
    aop: AOP_VERSION,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    seq: nextSeq(),
    type,
    harness: { name: HARNESS, variant: "agent" },
    session: sess,
    project: { id: PROJECT, name: PROJECT },
    payload: payload || {},
  };
}

function spoolAppend(line) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    let lines = [];
    try {
      lines = fs.readFileSync(SPOOL, "utf8").split("\n").filter(Boolean);
    } catch { /* no spool yet */ }
    lines.push(line);
    if (lines.length > MAX_SPOOL_LINES) {
      lines = lines.slice(-Math.floor(MAX_SPOOL_LINES * 0.75));
    }
    fs.writeFileSync(SPOOL, lines.join("\n") + "\n", { mode: 0o600 });
  } catch { /* never fail the agent */ }
}

function kickSender() {
  try {
    const child = spawn(process.execPath, [__filename, "--flush"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch { /* never fail the agent */ }
}

function postNdjson(url, token, body) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return resolve({ ok: false });
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      u,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          "Content-Length": Buffer.byteLength(body),
          // Spec §5.5: remote receivers need X-Roving-Office-Token;
          // hosting layers may strip Authorization.
          "X-Roving-Office-Token": token,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ ok: res.statusCode === 202, status: res.statusCode }));
      }
    );
    req.on("error", () => resolve({ ok: false }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.write(body);
    req.end();
  });
}

async function flush() {
  const ep = loadEndpoint();
  if (!ep || !ep.url || !ep.token) return;
  let lines = [];
  try {
    lines = fs.readFileSync(SPOOL, "utf8").split("\n").filter(Boolean);
  } catch { /* nothing spooled */ }
  if (!lines.length) return;
  const batch = lines.slice(0, 500);
  const res = await postNdjson(ep.url, ep.token, batch.join("\n") + "\n");
  if (res.ok) {
    // Drop exactly the lines we sent; anything appended meanwhile stays.
    try {
      const rest = fs.readFileSync(SPOOL, "utf8").split("\n").filter(Boolean);
      const remaining = rest.slice(batch.length);
      fs.writeFileSync(SPOOL, remaining.length ? remaining.join("\n") + "\n" : "", { mode: 0o600 });
    } catch { /* never fail */ }
  }
  // On failure the spool stays and a later kick retries. Delivery is
  // at-least-once; the receiver de-duplicates on event id.
}

async function main() {
  const [, , cmd, payloadArg] = process.argv;
  if (cmd === "--flush") {
    await flush();
    return;
  }
  if (!cmd) return;
  let payload = {};
  if (payloadArg) {
    try {
      payload = JSON.parse(payloadArg);
    } catch {
      payload = {};
    }
  }
  spoolAppend(JSON.stringify(buildEvent(cmd, payload)));
  kickSender();
}

main().then(
  () => process.exit(0),
  () => process.exit(0)
);
