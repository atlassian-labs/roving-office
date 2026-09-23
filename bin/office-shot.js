#!/usr/bin/env node
/**
 * Photograph a *running* office, for the screenshots in the documentation.
 *
 * `prop-portrait.js` and `scene-map.js` both photograph something static, and both get
 * away with Chrome's `--screenshot` flag, which fires the shutter at the load event. An
 * office cannot be photographed that way and the reason is the whole point of the room:
 * it opens empty and fills up. A load-time shutter catches "Booting the office…", five
 * dark desks and an agents panel reading *No agents in the office yet* — a picture of the
 * one second of the product nobody wants to see.
 *
 * `--virtual-time-budget` is not the answer either: virtual time never expires against a
 * render loop, so the flag hangs and writes nothing (see docs/developer/developing.md).
 *
 * So this drives Chrome over the DevTools protocol instead, which is the only way to say
 * "navigate, wait until the room has people in it, *then* shoot". No dependency: Node has
 * `fetch` and `WebSocket` built in, and the protocol is two JSON messages.
 *
 *     node bin/office-shot.js --out=docs/images/screens/office.png
 *     node bin/office-shot.js --url=/office/TEST-0000/?edit=1 --wait=12000 --out=x.png
 *     node bin/office-shot.js --hide-ui --out=clean.png     # canvas only, no panels
 *
 * It needs an office already running; it will not start one, deliberately, because
 * `server.cjs` claims the machine's adapter endpoint when it publishes and a docs tool has
 * no business doing that to an office somebody is watching. Same rule as prop-portrait.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { options } from './lib/cli-args.js';

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = process.argv.slice(2);
const { value } = options(args);

const PORT = Number(value('port', 8093));
const URL_PATH = value('url', '/office/TEST-0000');
/**
 * How long to let the room fill up before shooting.
 *
 * Test Data opens with its regulars and then drifts more in over a couple of minutes, so
 * there is no moment when the office is "done". Eight seconds is enough for the opening
 * crew to have walked in, taken desks and started work, which is the picture that
 * describes the product. Longer is not better: past about twenty seconds somebody is
 * always mid-stride across the middle of the floor.
 */
const WAIT_MS = Number(value('wait', 8000));
const [W, H] = value('size', '1600,1000').split(/[,x]/).map(Number);
const OUT = value('out', 'office.png');
const HIDE_UI = args.includes('--hide-ui');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The DevTools endpoint takes a moment to come up; poll rather than guess a delay. */
async function devtools(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not listening yet */ }
    await sleep(250);
  }
  throw new Error('Chrome never opened a DevTools endpoint');
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let next = 1;
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result);
  });
  return {
    ready,
    send(method, params = {}) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'office-shot-'));
const debugPort = 9222 + Math.floor(Math.random() * 500);

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  // Motion is what this tool is waiting *for*, so unlike every other screenshot recipe
  // here it must not ask for reduced motion: that would park everybody where they stand.
  //
  // These three are the difference between a photograph and an empty room, and the reason
  // is the same one the office already documents about background tabs: **the walk in only
  // advances on a drawn frame.** A headless window counts as backgrounded, so Chrome
  // throttles `requestAnimationFrame` to a crawl — the feed goes on spawning people and
  // handing them work, and not one of them can take a step. Waiting longer does not help;
  // it just gets you a later picture of one agent standing by the door being renamed as
  // they finish jobs they never walked to a desk to do.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`,
  `--remote-debugging-port=${debugPort}`,
  'about:blank',
], { stdio: 'ignore' });

try {
  const cdp = client(await devtools(debugPort));
  await cdp.ready;

  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `http://localhost:${PORT}${URL_PATH}` });

  /*
   * Pump the render loop by photographing the page and throwing the pictures away.
   *
   * This is the load-bearing line in the file. A headless window is never on screen, so
   * Chrome has no reason to composite a frame and `requestAnimationFrame` fires at a
   * crawl — and the office advances *per drawn frame*, which is a property it documents
   * about background tabs and turns out to be just as true of a screenshot rig. Timers
   * keep running, so the feed cheerfully spawns somebody and gives them work; they simply
   * cannot take a step. What you get, however long you wait, is one agent standing by the
   * door being renamed as they finish jobs they never walked to a desk to do.
   *
   * `Page.captureScreenshot` forces a composite, so asking for a frame *is* the fix. The
   * flags above (`--disable-*-throttling`) were the obvious first guess and changed
   * nothing at all; they are kept because they cost nothing and are the right intent.
   */
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    // Swallowed on purpose: the first few land while the page is still navigating and
    // come back "Not attached to an active page", which is a normal part of starting up
    // rather than a failure. The loop only has to keep asking.
    try {
      await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 1 });
    } catch { /* not ready yet */ }
    await sleep(30);
  }

  if (HIDE_UI) {
    // The canvas is the picture; the panels are this app's furniture and date the shot.
    await cdp.send('Runtime.evaluate', {
      expression: "document.getElementById('ui').style.display = 'none'",
    });
    await sleep(400);
  }

  /*
   * `--press=S` opens a panel before the shutter.
   *
   * The office's whole interface is behind single keys, so a screenshot of the scene panel
   * or the source picker is not reachable any other way — there is no URL for "with the
   * scene panel open". The registry listens on `document` for `keydown` (see
   * `src/ui/shortcuts.js`), so one synthetic keydown with the right fields is enough;
   * `text` and `windowsVirtualKeyCode` both matter, because a handler reading `event.key`
   * gets nothing useful without them.
   *
   * Repeatable, and applied in order, for the panels that need two keys to reach.
   */
  // Read here rather than through `bin/lib/cli-flags.cjs`: that helper deliberately gives
  // one value per name, which is right for every other caller, and this is the only flag
  // in the repo that wants repeating.
  const presses = args
    .filter((a) => a.startsWith('--press='))
    .map((a) => a.slice('--press='.length))
    .filter(Boolean);

  for (const key of presses) {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: `Key${key.toUpperCase()}`,
      text: key,
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
    // Panels animate in. Long enough for that, short enough not to lose the room's motion.
    await sleep(1200);
  }

  /*
   * `--clip-to=#scene-panel` frames one element rather than a guessed rectangle.
   *
   * Hand-tuned `--clip` numbers are fine for the room, which does not move. They are the
   * wrong tool for a panel: the strips along the bottom are laid out by a column, so a
   * panel's position depends on which *other* panels are open, and any number written here
   * would be right until somebody opened the roster. Asking the element where it is means
   * the crop follows the layout.
   */
  const clipTo = value('clip-to', null);
  const clip = value('clip', null);
  const shot = { format: 'png' };

  /*
   * `--scale=2` renders the crop at twice the size, for the panels.
   *
   * A screenshot of the room is eight hundred pixels of room and looks fine at any
   * sensible width. A screenshot of a *panel* is two hundred and sixty pixels of chrome,
   * and a page that shows it at nine hundred has upscaled it three and a half times —
   * which is exactly what "the agents panel looks zoomed in" was. Capturing at 2× and
   * showing it near its logical size keeps the text crisp instead.
   */
  const scale = Number(value('scale', 1));

  if (clipTo) {
    const pad = Number(value('pad', 12));
    const { result } = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(clipTo)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()`,
    });
    if (!result?.value) {
      throw new Error(`--clip-to=${clipTo} matched nothing visible on the page`);
    }
    const r = result.value;
    shot.clip = {
      x: Math.max(0, r.x - pad),
      y: Math.max(0, r.y - pad),
      width: r.width + pad * 2,
      height: r.height + pad * 2,
      scale,
    };
    shot.captureBeyondViewport = true;
  } else if (clip) {
    const [x, y, width, height] = clip.split(',').map(Number);
    shot.clip = { x, y, width, height, scale };
    shot.captureBeyondViewport = true;
  }

  const { data } = await cdp.send('Page.captureScreenshot', shot);
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
  cdp.close();

  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  process.stdout.write(`wrote ${OUT} (${W}x${H}, ${kb} KB) from ${URL_PATH}\n`);
} finally {
  chrome.kill();
  // Chrome is still flushing its profile when the signal lands, so give it a moment and
  // then do not care: this is a temp directory, and a failed tidy-up must not turn a
  // written screenshot into a non-zero exit.
  await sleep(300);
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* the OS will have it */ }
}
