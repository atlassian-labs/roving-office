#!/usr/bin/env node
//
// Prop portraits - a picture of every object in the scene, one at a time.
//
// The room is the product, so the docs should show it rather than describe it. This
// photographs each entry in src/scene/catalogue.js on its own, on a transparent
// background, and writes the PNGs the gallery in docs/user/the-kit.md is built from.
//
// It serves the repo on a spare port, opens bin/prop-portrait.html once per object
// in a headless Chrome, and lets Chrome save the PNG. That machinery — finding a
// browser, the little read-only server, the shutter itself and why it is a real
// browser at all — is bin/lib/shutter.js, shared with the scene map tool.
//
// Usage:
//   node bin/prop-portrait.js [options]
//
//   --all               every object in the catalogue (the default)
//   --id=<id>           just this one; repeatable
//   --group=<group>     just this section: stations, furniture, screens, greenery,
//                       people, outside
//   --list              print the catalogue and exit, taking no pictures
//   --size=<px>         square edge, in pixels (default 900)
//   --out=<dir>         where the PNGs go (default docs/images/objects)
//   --jobs=<n>          how many Chromes at once (default 4)
//   --port=<n>          port to serve on (default 8099)
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
  ids: all('id'),
  group: opt('group'),
  list: opt('list') === true,
  size: Number(opt('size', 900)),
  out: opt('out', join('docs', 'images', 'objects')),
  jobs: Math.max(1, Number(opt('jobs', 4))),
  port: Number(opt('port', 8099)),
  chrome: opt('chrome'),
  timeout: Number(opt('timeout', 60)) * 1000,
};

const pageFor = (id) => `http://127.0.0.1:${OPTS.port}/bin/prop-portrait.html`
  + `?id=${encodeURIComponent(id)}&size=${OPTS.size}`;

async function main() {
  // The catalogue is a scene module, so Node needs three and a canvas before it can
  // be imported — but importing it is what lets this tool validate an id, and print
  // the sections, without guessing at the contents of a file.
  stubDom();
  await loadThree();
  const { CATALOGUE, GROUPS } = await import('../src/scene/catalogue.js');

  if (OPTS.list) {
    for (const group of GROUPS) {
      const members = CATALOGUE.filter((e) => e.group === group.id);
      process.stdout.write(`\n${group.label} (${group.id}) - ${members.length}\n`);
      for (const e of members) process.stdout.write(`  ${e.id.padEnd(18)}${e.label}\n`);
    }
    process.stdout.write(`\n${CATALOGUE.length} objects in ${GROUPS.length} sections\n`);
    return;
  }

  let wanted = CATALOGUE;
  if (OPTS.group) {
    if (!GROUPS.some((g) => g.id === OPTS.group)) {
      throw new Error(`No such group "${OPTS.group}". Try one of: ${GROUPS.map((g) => g.id).join(', ')}`);
    }
    wanted = wanted.filter((e) => e.group === OPTS.group);
  }
  if (OPTS.ids.length) {
    const known = new Set(CATALOGUE.map((e) => e.id));
    const unknown = OPTS.ids.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new Error(`No object called ${unknown.map((u) => `"${u}"`).join(', ')}. --list shows them all.`);
    }
    wanted = wanted.filter((e) => OPTS.ids.includes(e.id));
  }

  const outDir = resolve(REPO_ROOT, OPTS.out);
  mkdirSync(outDir, { recursive: true });

  const chrome = findChrome(OPTS.chrome);
  const server = await serveRepo(OPTS.port);
  process.stdout.write(
    `${wanted.length} object${wanted.length === 1 ? '' : 's'} at ${OPTS.size}px `
    + `-> ${OPTS.out}  (${OPTS.jobs} at a time)\n`
  );

  const results = await shootAll(
    wanted.map((e) => ({ name: e.id, url: pageFor(e.id) })),
    {
      chrome,
      size: OPTS.size,
      timeout: OPTS.timeout,
      jobs: OPTS.jobs,
      transparent: true,                 // the gallery lays these over its own page
      profilePrefix: 'roving-portrait-',
      fileFor: (id) => resolve(outDir, `${id}.png`),
    },
  );
  server.close();

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    process.stderr.write(`\n${failed.length} failed:\n`);
    for (const f of failed) process.stderr.write(`  ${f.name}: ${f.error}\n`);
    process.stderr.write(
      '\nA blank or missing picture is usually a build error. Open the page by hand '
      + `to see it: http://localhost:${OPTS.port}/bin/prop-portrait.html?id=${failed[0].name}\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nAll present. The gallery is docs/user/the-kit.md.\n');
}

main().catch((err) => {
  process.stderr.write(`prop-portrait: ${err.message}\n`);
  process.exitCode = 1;
});
