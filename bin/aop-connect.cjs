#!/usr/bin/env node
// aop-connect — point this machine's adapters at an office on another host.
//
//   node bin/aop-connect.cjs https://therovingoffice.example.com   mint an office there
//   node bin/aop-connect.cjs <url> --office ABCD-1234 --token <t>  rejoin a known one
//   node bin/aop-connect.cjs --status                              where do events go?
//   node bin/aop-connect.cjs --disconnect                          back to local only
//
// Why this exists at all: a local office publishes `~/.roving-office/endpoint.json`
// itself, so adapters find it with no setup. A remote office cannot — it has no
// access to this machine's `$HOME` — so something local has to write that file on its
// behalf. That is the entire job here.
//
// The adapters need no changes to use the result. `aop-send` posts to whatever URL it
// reads, and has always chosen https from the URL's own protocol; pointing it
// somewhere else is a matter of what is in the file, not of new code in the hook.
//
// Two capabilities come back from a mint and they are not interchangeable:
//
//   - the **keycard**, eight characters, which lets anyone *watch* the office;
//   - the **write token**, 32 bytes, which lets a machine *staff* it.
//
// The mint response is the only place the write token is ever shown, so this script
// stores it immediately (mode 0600) and prints only its prefix. Losing it means
// minting a new office, which is the intended shape of "revoke".

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
// `isLoopback` comes from the emitter core rather than being restated here, because
// this file decides what `--status` *reports* while `aop-send.cjs` decides what
// actually *happens*, and the two must agree: a `remote: true` written next to a
// loopback URL is a lie in a file someone will debug from. A person is waiting on
// this command and it runs once, so the require costs nothing worth counting.
const { readJson, isLoopback } = require('./lib/aop-core.cjs');

const DIR = path.join(os.homedir(), '.roving-office');
const ENDPOINT_FILE = path.join(DIR, 'endpoint.json');

// Generous next to a hook's budget, because a person is waiting for this one and it
// runs once. The adapters' own timings are set separately, in aop-send.cjs.
const REQUEST_MS = 15000;

// What a freshly minted office should be watching. A new scene defaults to Test Data,
// which is right for someone who opened reception in a browser and wrong for an office
// minted by this command: connecting a machine and then finding simulated agents in the
// room is a half-finished job. Naming all five harnesses rather than guessing at one is
// harmless — a source with nothing feeding it puts nobody in the building.
const LIVE_SOURCES = ['rovo-cli', 'claude-code', 'cursor', 'codex-cli', 'openclaw'];

// --- helpers ---------------------------------------------------------------

/**
 * Strip an office URL back to its origin.
 *
 * People paste whatever their browser is showing — a bare host, an office page, even
 * a full events endpoint. All of those name the same receiver, so accept them all
 * rather than making the difference the user's problem.
 */
function normaliseBase(input) {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withScheme);
  return `${url.protocol}//${url.host}`;
}

/** Where a keycard's ingest lives on a given host. */
function eventsUrl(base, keycard) {
  return `${base}/office/${keycard}/aop/v0/events`;
}

/** A JSON request that reports failures usefully — a person is reading this one. */
function request(method, target, { body = null, token = null, contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(target); } catch { return reject(new Error(`not a URL: ${target}`)); }
    const lib = url.protocol === 'https:' ? https : http;
    const data = body === null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        Accept: 'application/json',
        // Not `Authorization` — a hosting gateway may claim that header and reject the
        // request before the office sees it, which would make this probe fail against
        // exactly the receivers it exists to validate. See aop-send.cjs.
        ...(token ? { 'X-Roving-Office-Token': token } : {}),
        ...(data ? { 'Content-Type': contentType, 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), text });
      });
    });
    const timer = setTimeout(() => { req.destroy(new Error(`no answer within ${REQUEST_MS}ms`)); }, REQUEST_MS);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(data);
  });
}

// --- the endpoint file -----------------------------------------------------

/**
 * Write the endpoint, preserving what a local office would want back.
 *
 * `pid` is deliberately absent for a remote endpoint. A local office writes its own
 * pid there and `server.cjs` refuses to overwrite an endpoint whose pid is still
 * alive — that check is what stops two local offices stealing each other's adapters.
 * A remote office has no pid on this machine, so leaving the field out is the honest
 * answer and has the right effect: starting a local office reclaims the endpoint,
 * which is what someone who just started one expects.
 */
function writeEndpoint({ base, keycard, token }) {
  fs.mkdirSync(DIR, { recursive: true });
  const body = {
    url: eventsUrl(base, keycard),
    token,
    keycard,
    remote: !isLoopback(base),
    host: base,
    connectedAt: new Date().toISOString(),
    // Spelled out rather than imported: this file is deliberately free of local
    // requires (see the header), and one string is a cheap price for that.
    aop: '0.2',
  };
  fs.writeFileSync(ENDPOINT_FILE, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  return body;
}

function showStatus() {
  const current = readJson(ENDPOINT_FILE, null);
  if (!current?.url) {
    console.log('No endpoint published: adapters are dormant.');
    console.log('Start a local office (npm run serve) or connect to a remote one:');
    console.log('  node bin/aop-connect.cjs <url>');
    return;
  }
  const remote = !isLoopback(current.url);
  console.log(`Events go to: ${current.url}`);
  console.log(`  office:  ${current.keycard ?? '(unknown)'}`);
  console.log(`  mode:    ${remote ? 'remote' : 'local'}`);
  if (current.pid) console.log(`  served by pid ${current.pid}`);
  if (current.connectedAt) console.log(`  connected ${current.connectedAt}`);
  console.log(`  token:   ${current.token ? `${String(current.token).slice(0, 8)}… (${String(current.token).length} chars)` : '(none)'}`);
  if (remote) {
    console.log('');
    console.log('Remote mode: each hook spools its events and hands them to a detached');
    console.log('sender, so the network never delays the agent.');
  }
}

function disconnect() {
  const current = readJson(ENDPOINT_FILE, null);
  if (!current?.url) return console.log('Nothing to disconnect: no endpoint published.');
  if (current.pid) {
    console.log(`Refusing to remove an endpoint owned by a live local office (pid ${current.pid}).`);
    console.log('Stop that office instead; it retracts its own endpoint on exit.');
    return;
  }
  try { fs.unlinkSync(ENDPOINT_FILE); } catch { /* already gone */ }
  console.log('Disconnected. Adapters are dormant until an office publishes an endpoint.');
  console.log('The write token is gone with it — rejoining that office needs the token,');
  console.log('so mint a new one unless you saved it.');
}

// --- connecting ------------------------------------------------------------

/**
 * Tune a new office's scene to the harnesses that will feed it.
 *
 * Best-effort on purpose. The endpoint file is already written by the time this runs,
 * so events will arrive whatever happens here; failing to retune a scene is a cosmetic
 * disappointment, not a reason to report that connecting failed. The room can always
 * be retuned from its own source picker.
 */
async function pointSceneAtHarnesses(base, keycard, minted, sources) {
  const scene = minted?.scenes?.[0];
  if (!scene?.id) return null;
  const wanted = sources?.length ? sources : LIVE_SOURCES;
  try {
    const res = await request('PATCH', `${base}/office/${keycard}/api/scenes/${encodeURIComponent(scene.id)}`, {
      body: { sources: wanted },
    });
    return res.status === 200 ? wanted : null;
  } catch {
    return null;
  }
}

/**
 * Attach this machine to an office on `base`, minting one unless told otherwise.
 *
 * Rejoining is offered because the write token is shown once and a machine that
 * already holds it should not have to abandon the office to use it — a second laptop
 * feeding the same room is the whole point of a remote host. It is verified before it
 * is stored, so a typo fails here rather than silently disarming every hook.
 */
async function connect(target, { keycard, token, sources }) {
  const base = normaliseBase(target);

  let office = keycard;
  let writeToken = token;
  let minted = null;

  if (office && !writeToken) {
    throw new Error(`--office ${office} needs its --token: only the machine that minted it has one`);
  }

  if (!office) {
    console.log(`Minting an office on ${base}…`);
    const res = await request('POST', `${base}/api/offices`);
    minted = res.json;
    if (res.status !== 201 || !res.json?.keycard) {
      throw new Error(`could not mint an office (HTTP ${res.status}): ${res.text.slice(0, 200)}`);
    }
    if (!res.json.writeToken) {
      throw new Error(
        `${base} minted office ${res.json.keycard} but returned no write token.\n`
        + '  That host predates per-office ingest tokens, so it will refuse events from\n'
        + '  another machine. Redeploy it before connecting.',
      );
    }
    office = res.json.keycard;
    writeToken = res.json.writeToken;
  }

  // Prove the credentials before writing them. An endpoint file naming an office that
  // will not accept us is worse than no endpoint at all: hooks stay silent and look
  // installed, which is exactly the failure that is hardest to notice.
  //
  // An empty NDJSON batch is the cheapest honest test — it takes the real ingest path
  // and the real token check, and accepts nothing, so a probe leaves no mark on the
  // office and cannot put a stray agent in the room.
  const probe = await request('POST', eventsUrl(base, office), {
    body: '',
    token: writeToken,
    contentType: 'application/x-ndjson',
  });
  // Tell "your token is wrong" apart from "the host would not pass the request on".
  // An office refusing a token answers in our own JSON shape; a hosting layer refusing
  // the request answers in its own words, and reporting that as a bad credential sends
  // someone off minting fresh offices to fix a problem that was never theirs.
  const officeRefused = probe.status === 401 || (probe.status === 403 && probe.json?.error && !isPlatformError(probe.json.error));
  if (officeRefused) {
    throw new Error(
      `office ${office} on ${base} refused that token (HTTP ${probe.status}).\n`
      + '  A write token is shown only when its office is minted and cannot be looked up\n'
      + '  again. Mint a fresh office by connecting without --office/--token.',
    );
  }
  if (probe.status === 403) {
    throw new Error(
      `${base} would not pass the request to office ${office} (HTTP ${probe.status}): `
      + `${probe.json?.error ?? probe.text.slice(0, 120)}\n`
      + '  That is the host talking, not the office — the credentials were never checked.\n'
      + '  Nothing has been changed here; try again in a minute.',
    );
  }
  if (probe.status === 404) throw new Error(`${base} has no AOP receiver at /office/${office}/aop/v0`);
  if (probe.status >= 500) throw new Error(`${base} answered HTTP ${probe.status}: ${probe.text.slice(0, 200)}`);

  const written = writeEndpoint({ base, keycard: office, token: writeToken });

  // Only for an office we just made. Rejoining one means someone else chose what it
  // watches — possibly while watching it — and silently retuning their room from
  // another machine would be rude as well as surprising.
  let watching = null;
  if (minted) watching = await pointSceneAtHarnesses(base, office, minted, sources);

  console.log('');
  console.log(`Connected to office ${office} on ${base}`);
  console.log(`  watch it:  ${base}/office/${office}`);
  console.log(`  events to: ${written.url}`);
  if (watching) console.log(`  watching:  ${watching.join(', ')}`);
  console.log(`  token:     ${writeToken.slice(0, 8)}… stored in ${ENDPOINT_FILE} (mode 0600)`);
  console.log('');
  // The token itself stays out of stdout. It is a write credential, and a terminal keeps
  // its scrollback long after the office is gone — while printing it buys nothing, since
  // the line below already saved it somewhere with better manners than a scrollback
  // buffer. So: where it is, not what it is.
  console.log('To feed this office from a second machine, read the token out of');
  console.log(`${ENDPOINT_FILE} and pass it there:`);
  console.log(`  node bin/aop-connect.cjs ${base} --office ${office} --token <write-token>`);
  console.log('');
  console.log('That file is the only copy — no route will tell you the token again, and');
  console.log('minting a fresh office is the intended way to recover from losing it.');
  console.log('');
  console.log('Installed hooks need no change — they post to whatever this file names.');
  console.log('Rovo CLI reads its hooks at session start, so restart it to pick this up.');
}

/**
 * Does this error message come from the hosting layer rather than from an office?
 *
 * Matched on the platform's own vocabulary, which is the only signal available: these
 * messages arrive with the same status codes the office itself uses. Observed from a
 * hosted deployment while a single pinned sandbox was restarting, when the gateway
 * briefly has no route to the app it is fronting.
 */
function isPlatformError(message) {
  return /sandbox|ingress policy|bridge token|gateway|upstream/i.test(String(message));
}

/** `--sources a,b` → ['a','b'], tolerating spaces and stray commas. */
function splitList(value) {
  return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const out = { target: null, keycard: null, token: null, sources: null, status: false, disconnect: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--status') { out.status = true; continue; }
    if (arg === '--disconnect' || arg === '--uninstall') { out.disconnect = true; continue; }
    if (arg === '--office') { out.keycard = argv[++i] ?? null; continue; }
    if (arg === '--token') { out.token = argv[++i] ?? null; continue; }
    if (arg === '--sources') { out.sources = splitList(argv[++i]); continue; }
    if (arg.startsWith('--sources=')) { out.sources = splitList(arg.slice(10)); continue; }
    if (arg.startsWith('--office=')) { out.keycard = arg.slice(9); continue; }
    if (arg.startsWith('--token=')) { out.token = arg.slice(8); continue; }
    if (arg === '--help' || arg === '-h') { out.help = true; continue; }
    if (!arg.startsWith('-')) out.target = arg;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 26).join('\n').replace(/^\/\/ ?/gm, ''));
    return;
  }
  if (args.status) return showStatus();
  if (args.disconnect) return disconnect();
  if (!args.target) {
    console.error('Usage: node bin/aop-connect.cjs <url> [--office <keycard> --token <token>] [--sources a,b]');
    console.error('       node bin/aop-connect.cjs --status | --disconnect');
    process.exitCode = 1;
    return;
  }
  await connect(args.target, { keycard: args.keycard, token: args.token, sources: args.sources });
}

main().catch((err) => {
  console.error(`aop-connect: ${err.message}`);
  process.exitCode = 1;
});
