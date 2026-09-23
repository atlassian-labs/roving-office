//
// The shutter - a headless Chrome, a PNG, and the little server it photographs.
//
// Two docs tools take pictures of a *static* scene this way: bin/prop-portrait.js
// photographs one catalogue object at a time, bin/scene-map.js one theme's whole
// city from above. Everything about taking the picture is the same in both — find
// a browser, serve the repo, open a harness page, wait for the file to stop
// growing — so it lives here once instead of twice. What differs is which page,
// which query string, and what the tool says about the result; that stays in the
// tools, where it reads as their own voice.
//
// How it works, and why it works that way: there is no offscreen renderer here.
// The scene is WebGL, so the only thing that can draw it faithfully is a browser,
// and the honest way to get a picture out of a browser is to let one take it.
//
// bin/office-shot.js is deliberately *not* a caller. A running office cannot be
// photographed at the load event — it opens empty and fills up — so it drives
// Chrome over the DevTools protocol and wants the opposite flags. Its own
// comments explain that at length.
//
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { REPO_ROOT } from './headless-scene.js';

// Where a browser might be. Chrome is what the rest of this repo's tooling assumes,
// but any Chromium will do, and an unusual install can be named with --chrome.
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

/**
 * The browser to drive.
 *
 * @param {string|null} [named]  the tool's own --chrome, if it was given one
 * @returns {string} a path that exists
 */
export function findChrome(named = null) {
  const asked = named || process.env.ROVING_CHROME || process.env.CHROME_PATH;
  if (asked) {
    if (!existsSync(asked)) throw new Error(`No browser at ${asked}`);
    return asked;
  }
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (found) return found;
  throw new Error(
    'Could not find Chrome. Pass --chrome=/path/to/chrome, or set ROVING_CHROME.'
  );
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Serve the repo, read-only, on `port`.
 *
 * Only as much server as a harness page needs: the page itself, the ES modules
 * it imports, and nothing else. Path traversal is refused the same way server.cjs
 * refuses it.
 *
 * Deliberately not server.cjs: the app server claims ~/.roving-office/endpoint.json,
 * and a docs tool has no business taking the endpoint away from an office somebody
 * is watching.
 *
 * @param {number} port
 * @returns {Promise<import('node:http').Server>}
 */
export function serveRepo(port) {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = normalize(join(REPO_ROOT, urlPath));
    if (!filePath.startsWith(REPO_ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok(server));
  });
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Take one picture.
 *
 * Chrome is given its own profile directory — two Chromes sharing one profile
 * quietly refuse to both start — and is killed once the file has appeared and
 * stopped growing, because headless Chrome does not reliably exit after writing a
 * screenshot.
 *
 * `--force-prefers-reduced-motion` is not decoration either: the shutter fires at
 * load, far earlier than it feels like it should, so anything that animates into
 * place would be photographed half-way there. The harness pages render a settled
 * frame.
 *
 * @param {object} how
 * @param {string} how.chrome       browser binary
 * @param {string} how.url          the harness page, query string and all
 * @param {string} how.file         absolute path to write
 * @param {number} how.size         square window edge, in pixels
 * @param {number} how.timeout      how long to wait for the file, in ms
 * @param {boolean} [how.transparent]  shoot on nothing rather than on white
 * @param {string} [how.profilePrefix] names the throwaway profile directory
 * @returns {Promise<{ok: boolean, bytes: number, error?: string}>}
 */
export async function shoot(how) {
  const { chrome, url, file, size, timeout, transparent = false } = how;
  if (existsSync(file)) rmSync(file);
  const profile = mkdtempSync(join(tmpdir(), how.profilePrefix || 'roving-shot-'));

  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',       // software WebGL: no GPU on a build box
    '--hide-scrollbars',
    '--force-prefers-reduced-motion',
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `--user-data-dir=${profile}`,
    `--window-size=${size},${size}`,
    `--screenshot=${file}`,
    url,
  ], { stdio: 'ignore' });

  const deadline = Date.now() + timeout;
  let bytes = 0;
  try {
    while (Date.now() < deadline) {
      await sleep(400);
      if (!existsSync(file)) continue;
      const written = statSync(file).size;
      if (written > 0 && written === bytes) break;   // written, and finished writing
      bytes = written;
    }
  } finally {
    child.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true });
  }

  if (!bytes) return { ok: false, bytes: 0, error: 'no screenshot within the timeout' };
  return { ok: true, bytes };
}

/**
 * Photograph a list of named subjects, `jobs` at a time, printing a line each.
 *
 * A subject is a name and a URL, which is all either tool's choice of what to
 * shoot ever amounts to by the time it gets here: an object id or a theme key,
 * and the harness page that draws it.
 *
 * The counter is printed as each picture lands rather than in subject order,
 * because with several Chromes running there is no other order to report — a
 * line appearing is a picture existing.
 *
 * @param {{name: string, url: string}[]} subjects
 * @param {object} how  as `shoot`, minus `url` and `file`, plus:
 * @param {number} how.jobs  how many Chromes at once
 * @param {(name: string) => string} how.fileFor  where each subject's PNG goes
 * @returns {Promise<{name: string, ok: boolean, bytes: number, error?: string}[]>}
 */
export async function shootAll(subjects, how) {
  const queue = [...subjects];
  const results = [];
  let done = 0;
  const runners = Array.from({ length: Math.min(how.jobs, queue.length) }, async () => {
    while (queue.length) {
      const subject = queue.shift();
      const shot = await shoot({ ...how, url: subject.url, file: how.fileFor(subject.name) });
      done += 1;
      const mark = shot.ok ? `${(shot.bytes / 1024).toFixed(0)}k`.padStart(6) : '  FAIL';
      process.stdout.write(`${String(done).padStart(3)}/${subjects.length} ${mark}  ${subject.name}\n`);
      results.push({ name: subject.name, ...shot });
    }
  });
  await Promise.all(runners);
  return results;
}
