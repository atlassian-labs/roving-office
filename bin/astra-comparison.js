#!/usr/bin/env node
// Render two committed snapshots into one portable, searchable HTML review.
// node bin/astra-comparison.js --before=<commit> --after=HEAD --out=astra-city-comparison.html
//
// `--before` defaults to the commit the city-and-lighting experiment was measured against,
// which only resolves in a checkout that carries that history. A clone that does not — a
// shallow one, or a repository exported without history — has to name its own baseline, so
// an unresolvable default is reported as that rather than as a bare `git rev-parse` failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const before = opt('before', '7157bb9');
const after = opt('after', 'HEAD');
const output = path.resolve(ROOT, opt('out', 'astra-city-comparison.html'));
const verifyOnly = process.argv.includes('--verify-only');
const city = opt('city', 'all');
const quick = process.argv.includes('--quick');
const cityNames = { simple: 'Alder Street', warehouse: 'The Warehouse', skyscraper: 'Kestrel Tower', mansard: 'Rue Dauphine' };
if (city !== 'all' && !cityNames[city]) throw new Error(`Unknown city: ${city}`);
const chromePath = opt('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const revision = (ref, flag) => {
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error(`${flag}: this checkout has no commit "${ref}". Name one it does have, e.g. --${flag.slice(2)}=HEAD~1.`);
  }
};
const revisions = { before: revision(before, '--before'), after: after === 'working' ? 'working-tree' : revision(after, '--after') };
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-comparison-'));
const profile = path.join(scratch, 'chrome');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let next = 1;
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return {
    ready,
    send(method, params = {}) {
      const id = next++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 120000);
        pending.set(id, { resolve, reject, timeout });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

let server, chrome, cdp;
try {
  for (const side of verifyOnly ? [] : ['before', 'after']) {
    const destination = path.join(scratch, side);
    fs.mkdirSync(destination);
    if (revisions[side] === 'working-tree') {
      for (const dir of ['src', 'vendor']) fs.cpSync(path.join(ROOT, dir), path.join(destination, dir), { recursive: true });
    } else {
      const archive = execFileSync('git', ['archive', revisions[side], 'src', 'vendor'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
      execFileSync('tar', ['-xf', '-', '-C', destination], { input: archive });
    }
  }
  fs.copyFileSync(path.join(ROOT, 'bin/astra-comparison-render.html'), path.join(scratch, 'render.html'));
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(scratch, `.${pathname}`);
    if (!file.startsWith(`${scratch}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('Not found'); return;
    }
    const mime = path.extname(file) === '.html' ? 'text/html' : 'text/javascript';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--force-prefers-reduced-motion', '--hide-scrollbars', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  chrome.on('error', error => { process.stderr.write(`${error.message}\n`); });
  let debugPort;
  for (let i = 0; i < 100; i++) {
    try { debugPort = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; } catch { await sleep(200); }
  }
  if (!debugPort) throw new Error('Chrome did not open DevTools');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  cdp = connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  let report;
  if (verifyOnly) {
    report = JSON.parse(fs.readFileSync(output, 'utf8').match(/<script id="comparison-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  } else {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/render.html` });
    let metadata;
    for (let i = 0; i < 120; i++) {
      metadata = await evaluate('window.comparison && ({objects:comparison.objects,groups:comparison.groups})');
      if (metadata) break;
      await sleep(250);
    }
    if (!metadata) throw new Error('Comparison harness did not become ready');
    report = { revisions, generated: new Date().toISOString(), groups: metadata.groups, objects: [], scenes: [] };
    const selectedCities = city === 'all' ? Object.keys(cityNames) : [city];
    const cityViews = [
      ['office view', {}], ['neighbourhood', { zoom: .48 }], ['street plan', { zoom: .42, plan: true }],
      ['evening', { zoom: .65, hour: 20.5 }], ['winter', { zoom: .65, season: 'winter' }],
      ['turned camera', { zoom: .8, rotate: -.55 }],
    ].slice(0, quick ? 3 : 6);
    report.title = city === 'all' ? 'Four cities · a greener outlook' : `${cityNames[city]} · a greener city`;
    report.cities = selectedCities.map(id => ({ id, label: cityNames[id] }));
    const views = selectedCities.flatMap(id => cityViews.map(([label, options]) => [id, `${cityNames[id]} · ${label}`, options]));
    for (const [index, [id, label, options]] of views.entries()) {
      const pair = await evaluate(`comparison.scenePair(${JSON.stringify(id)},${JSON.stringify(options)})`);
      const notes = {
        simple: 'Connected streets and crossings, a park with paths to the pavement, planted terraces and shared facade textures.',
        warehouse: 'Brick workshops with sawtooth roofs, factory glazing, a green service yard, and a park with a wider water garden. The driveway actually cuts through the pavement to the loading apron.',
        skyscraper: 'Slender glass towers rise from planted podiums. Roof gardens, balcony planting and a short garden connection sit above streets and a ground-level park.',
        mansard: 'Limestone blocks enclose planted courtyards under zinc mansards, dormers and chimney pots. A garden square and two familiar landmarks sit between connected streets.',
      };
      report.scenes.push({ id: `${id}-${index}`, building: id, label, group: 'scenes', status: 'attempted', focus: 'Green neighbourhood and street layout',
        notes: `${notes[id]} Same camera, season and hour on both sides. City backgrounds and scene lighting are compared here; both sides use the original furniture models.`, ...pair });
      process.stdout.write(`Metrics ${JSON.stringify(pair.metrics)}\n`);
      process.stdout.write(`Scene: ${label}\n`);
    }
    const template = fs.readFileSync(path.join(ROOT, 'bin/astra-comparison-report.html'), 'utf8');
    const html = template.replace('/*__COMPARISON_DATA__*/', JSON.stringify(report).replaceAll('<', '\\u003c'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, html);
    process.stdout.write(`Wrote ${output} (${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB)\n`);
  }
  // Exercise the actual portable file: filters, modal and wipe must work without
  // the renderer or any source modules. No report data is modified by this check.
  fs.copyFileSync(output, path.join(scratch, 'report.html'));
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/report.html` });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await evaluate('document.querySelectorAll(".card").length > 0');
    if (ready) break;
    await sleep(100);
  }
  if (!ready) throw new Error('Exported report did not render');
  await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 1 });
  const verification = await evaluate(`(async () => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const get = id => document.getElementById(id);
    const cards = () => document.querySelectorAll('.card').length;
    assert(cards() === ${report.scenes.length}, 'city coverage');
    document.querySelector('.enlarge').click(); assert(get('viewer').open, 'city enlarged view');
    get('wipe-mode').click(); assert(!get('wipe-container').hidden, 'city wipe view');
    get('divider').value = 25; get('divider').dispatchEvent(new Event('input'));
    assert(get('wipe').style.getPropertyValue('--split') === '25%', 'wipe slider');
    get('close').click();
    const report = JSON.parse(get('comparison-data').textContent);
    const picker = document.querySelector('select[aria-label="City"]');
    if (picker) {
      for (const city of report.cities) {
        picker.value = city.id; picker.dispatchEvent(new Event('change'));
        assert(cards() === report.scenes.filter(item => item.building === city.id).length, 'city filter');
        assert([...document.querySelectorAll('.card h2')].every(title => title.textContent.startsWith(city.label)), 'city filter labels');
      }
      picker.value = 'all'; picker.dispatchEvent(new Event('change'));
      assert(cards() === report.scenes.length, 'all cities restored');
    }
    const pictures = [...report.objects, ...report.scenes].flatMap(item => [item.before, item.after]);
    await Promise.all([...new Set(pictures)].map(async src => {
      const image = new Image(); image.src = src; await image.decode();
      assert(image.naturalWidth >= 960 && image.naturalHeight >= 800, 'embedded image dimensions');
    }));
    return { objects: report.objects.length, scenes: report.scenes.length, images: pictures.length, controls: 'passed' };
  })()`);
  process.stdout.write(`Verified ${JSON.stringify(verification)}\n`);
} finally {
  cdp?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill();
    await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), sleep(3000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
