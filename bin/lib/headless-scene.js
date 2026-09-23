//
// Running the scene's own modules outside a browser.
//
// Two tools need this: the coplanar probe, which builds the whole world in Node
// and measures it, and the prop portrait tool, which reads the object catalogue in
// Node to find out what there is to photograph. Both hit the same two walls.
//
// The first is that the app has no build step and no dependencies: index.html
// resolves three.js through an import map — the vendored build in vendor/three,
// or historically a CDN — which Node cannot follow. The second is that scene
// modules bake canvas textures, so importing one touches `document` — which
// does not exist here.
//
// Both are solved once, here, rather than in each tool.
//
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * GET a URL as text, following redirects.
 *
 * Node 16 has no global fetch and the CDN redirects, so this is done the long way
 * rather than pinning these tools to a newer runtime than the rest of the repo
 * needs.
 *
 * @param {string} url
 * @param {number} [hops]  redirects left to follow
 * @returns {Promise<string>}
 */
export function download(url, hops = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'roving-office-tools' } }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (hops <= 0) return reject(new Error('too many redirects'));
        return download(new URL(headers.location, url).href, hops - 1).then(resolve, reject);
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

/**
 * Import three.js, fetching it on first use.
 *
 * The version is read from the import map in index.html rather than named here,
 * so the tools measure the same three the browser runs. It is cached in
 * node_modules/three, where a bare 'three' specifier resolves and where
 * `npm install three` would have put it anyway. Nothing else is installed, and
 * node_modules is git-ignored.
 *
 * @returns {Promise<object>} the three module namespace
 */
export async function loadThree() {
  try {
    return await import('three');
  } catch {
    /* not there yet - fetch it below */
  }

  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const url = html.match(/"three"\s*:\s*"([^"]+)"/)?.[1];
  if (!url) throw new Error('No "three" entry in the import map in index.html.');

  // A path rather than a URL means three is vendored in the repo (the move
  // it there), so the file the browser runs is right here — no fetch, and CI
  // needs no network to build the scene. It still has to land in node_modules,
  // because every scene module says `import 'three'` and only the browser has
  // the import map: Node resolves that bare name through node_modules or not at
  // all. A one-line re-export does it without copying the build, and survives
  // `npm ci` wiping the directory — the next probe run just writes it again.
  if (url.startsWith('/')) {
    const dir = join(ROOT, 'node_modules', 'three');
    mkdirSync(dir, { recursive: true });
    // Relative to node_modules/three/, which sits exactly two levels below ROOT.
    writeFileSync(join(dir, 'index.js'), `export * from '../..${url}';\n`);
    writeFileSync(join(dir, 'package.json'),
      JSON.stringify({ name: 'three', type: 'module', main: 'index.js', private: true }));
    return import('three');
  }

  process.stderr.write(`fetching ${url}\n`);
  let body;
  try {
    body = await download(url);
  } catch (err) {
    throw new Error(
      `Could not fetch three (${err.message}). This is needed once and then ` +
      `cached in node_modules/three; "npm install three" works too.`,
      { cause: err }
    );
  }

  const dir = join(ROOT, 'node_modules', 'three');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.js'), body);
  if (!existsSync(join(dir, 'package.json'))) {
    writeFileSync(join(dir, 'package.json'),
      JSON.stringify({ name: 'three', type: 'module', main: 'index.js' }));
  }
  return import('three');
}

/**
 * Enough of a DOM that scene modules can be imported and built.
 *
 * The scene draws several of its textures — the code on the monitors, the kanban
 * board, the globe's map, the night-light pools — into a 2D canvas. None of that
 * is inspected by a tool running in Node, so every call on the context can be a
 * no-op that returns another no-op.
 */
export function stubDom() {
  const anything = () => new Proxy(function () {}, {
    get: () => anything(), apply: () => anything(), set: () => true,
  });
  // Almost every canvas call can be a no-op that returns another no-op — nothing
  // in Node looks at the pixels. `measureText` is the one exception: callers do
  // arithmetic on `.width` (the name tag sizes itself to its text), and a Proxy
  // in a subtraction is a TypeError. A rough guess per character is fine, because
  // headless nobody reads the tag — it only has to be a number.
  const context = () => new Proxy(function () {}, {
    get: (_, prop) => (prop === 'measureText'
      ? (text) => ({ width: String(text ?? '').length * 6 })
      : anything()),
    apply: () => anything(),
    set: () => true,
  });
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context() }),
  };
}

/**
 * The seed the tools use unless told otherwise.
 *
 * Any constant would do. What matters is that it never changes casually, because
 * every recorded baseline is only meaningful against the seed it was taken under.
 */
export const DEFAULT_SEED = 1;

/**
 * Make `Math.random` deterministic for the rest of this process.
 *
 * The scene is *dressed* at random: book widths on a shelf, which props land on
 * it, which panes of the tower are lit, the cards on the kanban board. In a
 * browser that is variety — two offices should not look identical. To a tool that
 * measures the scene it is noise, and noise that measurement cannot tolerate: the
 * coplanar probe reports "the worst pair of surfaces contesting a plane", so an
 * unseeded sweep reports the worst pair of *one random dressing*, and the same
 * commit scores differently every run. As a CI gate that is a coin toss, which is
 * worse than no gate at all — it fails honest commits and passes real regressions
 * at the same rate.
 *
 * So the tools fix the dressing instead. The scene's own code already does this
 * wherever a rebuild must look the same twice — see `rng` in
 * `src/scene/outlooks/city.js` and `seeded` in `src/scene/outlooks/streetscape.js`
 * — and this is the same idea applied from the outside, to everything at once.
 *
 * mulberry32, matching `city.js`: one 32-bit word of state, and a good enough
 * spread that dressing built from it still looks dressed rather than striped.
 *
 * Call it again to rewind the stream. A tool that builds the scene more than once
 * should reseed **before each build**, so a building measures the same whether it
 * is built alone or tenth in a sweep.
 *
 * @param {number} [seed]
 * @returns {() => void} restores the real `Math.random`
 */
export function seedRandom(seed = DEFAULT_SEED) {
  const real = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => { Math.random = real; };
}

/** The repo root, for tools that need to reach files relative to it. */
export const REPO_ROOT = ROOT;
