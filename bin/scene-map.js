#!/usr/bin/env node
//
// Scene maps - a picture of each theme's whole city, from directly above: the
// street or the skyline it looks out on, not only the room at the centre of it.
//
// The prop portraits show the pieces; this shows the place they're in. It builds
// the same environment + lighting + props sequence buildWorld() in src/main.js
// does, minus the agent layer, and photographs it from a straight-down ortho
// camera instead of the isometric one — one PNG per THEMES entry.
//
// It serves the repo on a spare port, opens bin/scene-map.html once per theme in
// a headless Chrome, and lets Chrome save the PNG. That machinery lives in
// bin/lib/shutter.js, shared with the prop portrait tool, along with the reason
// it drives a real browser rather than an offscreen renderer.
//
// Usage:
//   node bin/scene-map.js [options]
//
//   --all               every theme in THEMES (the default)
//   --theme=<key>        just this one; repeatable
//   --seed=<text>       a *generated* office instead of a theme (src/plan/),
//                        framed on the room rather than on the city; repeatable
//   --list              print the theme keys and exit, taking no pictures
//   --size=<px>         the room's longer edge, in pixels (default 1600)
//   --out=<dir>         where the PNGs go (default docs/images/maps)
//   --jobs=<n>          how many Chromes at once (default 4)
//   --port=<n>          port to serve on (default 8098)
//   --chrome=<path>     browser binary, if it is somewhere unusual
//   --timeout=<s>       how long to wait for one picture (default 60)
//
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadThree, stubDom, REPO_ROOT } from './lib/headless-scene.js';
import { options } from './lib/cli-args.js';
import { findChrome, serveRepo, shootAll } from './lib/shutter.js';

const { opt, all } = options(process.argv.slice(2));

const OPTS = {
  themes: all('theme'),
  seeds: all('seed'),
  list: opt('list') === true,
  size: Number(opt('size', 1600)),
  out: opt('out', join('docs', 'images', 'maps')),
  jobs: Math.max(1, Number(opt('jobs', 4))),
  port: Number(opt('port', 8098)),
  chrome: opt('chrome'),
  timeout: Number(opt('timeout', 60)) * 1000,
};

/**
 * The harness page for one subject.
 *
 * A subject is either a theme — the city map this script was written for — or a
 * seed, which is one generated office framed on its own floor. One code path,
 * because everything about taking the picture is the same and only the query
 * string differs.
 */
const pageFor = (name) => `http://127.0.0.1:${OPTS.port}/bin/scene-map.html`
  + `?${OPTS.seeds.length ? 'seed' : 'theme'}=${encodeURIComponent(name)}&size=${OPTS.size}`;

async function main() {
  // THEMES is a scene module (it imports SEASONS/BUILDINGS palettes), so Node
  // needs three and a canvas before it can be imported.
  stubDom();
  await loadThree();
  const { THEMES } = await import('../src/projects.js');
  const themeKeys = Object.keys(THEMES);

  if (OPTS.list) {
    for (const key of themeKeys) process.stdout.write(`  ${key.padEnd(12)}${THEMES[key].label}\n`);
    return;
  }

  let wanted = themeKeys;
  if (OPTS.seeds.length) {
    // Seeds are their own subject and do not mix with themes: a generated office
    // brings its own look, so asking for one alongside `--theme=tower` would be
    // asking for a room in two buildings at once.
    wanted = OPTS.seeds;
  } else if (OPTS.themes.length) {
    const unknown = OPTS.themes.filter((t) => !themeKeys.includes(t));
    if (unknown.length) {
      throw new Error(`No theme called ${unknown.map((u) => `"${u}"`).join(', ')}. --list shows them all.`);
    }
    wanted = OPTS.themes;
  }

  const outDir = resolve(REPO_ROOT, OPTS.out);
  mkdirSync(outDir, { recursive: true });

  const chrome = findChrome(OPTS.chrome);
  const server = await serveRepo(OPTS.port);
  const noun = OPTS.seeds.length ? 'office' : 'theme';
  process.stdout.write(
    `${wanted.length} ${noun}${wanted.length === 1 ? '' : 's'} at ${OPTS.size}px `
    + `-> ${OPTS.out}  (${OPTS.jobs} at a time)\n`
  );

  const results = await shootAll(
    wanted.map((name) => ({ name, url: pageFor(name) })),
    {
      chrome,
      size: OPTS.size,
      timeout: OPTS.timeout,
      jobs: OPTS.jobs,
      profilePrefix: 'roving-map-',
      fileFor: (name) => resolve(outDir, `${name}.png`),
    },
  );
  server.close();

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    process.stderr.write(`\n${failed.length} failed:\n`);
    for (const f of failed) process.stderr.write(`  ${f.name}: ${f.error}\n`);
    process.stderr.write(
      '\nA blank or missing picture is usually a build error. Open the page by hand '
      + `to see it: http://localhost:${OPTS.port}/bin/scene-map.html`
      + `?${OPTS.seeds.length ? 'seed' : 'theme'}=${failed[0].name}\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\nAll present, in ${OPTS.out}.\n`);
}

main().catch((err) => {
  process.stderr.write(`scene-map: ${err.message}\n`);
  process.exitCode = 1;
});
