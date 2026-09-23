#!/usr/bin/env node
/**
 * Regenerate `docs/developer/npm-scripts.md` — the list of every command this repo can run.
 *
 * There are forty-odd npm scripts and they are the whole interface to this project: there
 * is no build step, so `package.json` is the closest thing to a Makefile. A hand-written
 * page listing them was tried in spirit and would rot in a fortnight, because the thing
 * that changes (a new `connect:` pair, a renamed flag) is not the thing anyone remembers
 * to edit.
 *
 * So the page is generated from `package.json`, and the prose lives there too, in a
 * `scriptDocs` object beside `scripts`. JSON has no comments and this repo already puts
 * explanatory text in a `"//"` key elsewhere (`~/.roving-office/settings.json`), so a
 * sibling object is in keeping — and it puts the description one line away from the
 * command it describes, which is where it has the best chance of being updated.
 *
 * The generator is **strict in both directions**, which is the only thing that makes
 * "always up to date" true rather than aspirational:
 *
 *   - a script with no `scriptDocs` entry is an error, so you cannot add a command
 *     without saying what it does;
 *   - a `scriptDocs` entry naming no script is an error, so a renamed or deleted command
 *     cannot leave a description behind describing something that no longer exists.
 *
 *     node bin/gen-npm-scripts.mjs            # rewrite the page
 *     node bin/gen-npm-scripts.mjs --check    # CI-style: differs? non-zero exit
 *
 * `--check` runs inside `npm test` (see `test/docs.test.js`), so forgetting to regenerate
 * is a red build on your own machine before it is a red build anywhere else.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'package.json');
const OUT = path.join(ROOT, 'docs', 'developer', 'npm-scripts.md');

/**
 * The sections of the page, in order, each with the test that claims a script for it.
 *
 * Order matters twice over: a script lands in the first section that will have it, and the
 * sections come out on the page in this sequence. It runs roughly in the order a reader
 * meets them — run the thing, check the thing, feed the thing, regenerate its pictures,
 * ship it — rather than alphabetically, which would interleave `connect:claude` with
 * `colours` and teach nobody anything.
 *
 * `rest` is a deliberate escape hatch rather than an error. A missing *description* is
 * worth failing a build over; a script that has simply not been filed yet is worth a row
 * in "Anything else", because the alternative is a generator that blocks an unrelated
 * change until somebody edits this table.
 */
const SECTIONS = [
  {
    title: 'Run it',
    blurb: 'No build step, so there is nothing to compile first. Edit a file, reload the tab.',
    claims: (name) => ['start', 'serve', 'dev'].includes(name),
  },
  {
    title: 'Check it',
    blurb: 'Local checks and generation checks, using the same commands as the CI verification'
      + ' step. Internal deployment steps run separately and require maintainer access.',
    claims: (name) => ['test', 'lint', 'probe', 'pack:openclaw'].includes(name)
      || name.endsWith(':check'),
  },
  {
    title: 'Connect a harness',
    blurb: 'Each installs the hooks or plugin that make *your* sessions show up in the room.'
      + ' Every one of them has a `:dry` that changes nothing and a `:status` that says'
      + ' whether what is installed still matches this checkout.',
    claims: (name) => /^(connect|disconnect):(rovo|claude|cursor|codex|openclaw)/.test(name),
  },
  {
    title: 'Point this machine somewhere else',
    blurb: 'By default adapters feed the office on this machine. These three aim them at an'
      + ' office on a URL instead, and aim them back.',
    claims: (name) => /remote/.test(name),
  },
  {
    title: 'Regenerate what is generated',
    blurb: 'A handful of things in this repo are written by a script rather than by hand,'
      + ' because they are derived from something else and would drift if they were typed.',
    claims: (name) => ['portrait', 'map', 'colours', 'docs', 'docs:serve', 'docs:scripts'].includes(name),
  },
];

const REST = {
  title: 'Anything else',
  blurb: 'Not yet filed under a heading above.',
};

const HEADER = `# Every npm script

*What each command in \`package.json\` does, and which of them you actually need.*

There is no build step here, so \`package.json\` is as close as this project gets to a
Makefile: the scripts below are the whole interface to it. Most days you need four of
them — \`dev\`, \`test\`, \`lint\`, \`probe\` — and the rest are there for the day you need
exactly one of them.

> **This page is generated.** \`bin/gen-npm-scripts.mjs\` writes it from \`package.json\`,
> where each script's description lives in a \`scriptDocs\` entry beside the command
> itself. Editing this file by hand is wasted keystrokes: \`npm test\` will notice, and the
> next \`npm run docs\` will overwrite you. Add a script, add its \`scriptDocs\` line, run
> \`npm run docs\`. The generator refuses to run if you forget either half.
`;

function render(pkg) {
  const scripts = pkg.scripts ?? {};
  const docs = pkg.scriptDocs ?? {};

  const names = Object.keys(scripts);
  const undocumented = names.filter((name) => !docs[name]);
  const orphaned = Object.keys(docs).filter((name) => !(name in scripts));

  if (undocumented.length || orphaned.length) {
    const lines = ['package.json and its scriptDocs disagree.', ''];
    if (undocumented.length) {
      lines.push('These scripts have no scriptDocs entry — say what they do:');
      lines.push(...undocumented.map((n) => `  - ${n}`), '');
    }
    if (orphaned.length) {
      lines.push('These scriptDocs entries name no script — delete or rename them:');
      lines.push(...orphaned.map((n) => `  - ${n}`), '');
    }
    throw new Error(lines.join('\n'));
  }

  const unclaimed = new Set(names);
  const sections = [];

  for (const section of SECTIONS) {
    const claimed = names.filter((name) => unclaimed.has(name) && section.claims(name));
    for (const name of claimed) unclaimed.delete(name);
    if (claimed.length) sections.push({ ...section, scripts: claimed });
  }
  if (unclaimed.size) {
    sections.push({ ...REST, scripts: names.filter((name) => unclaimed.has(name)) });
  }

  const out = [HEADER];
  for (const section of sections) {
    out.push(`\n## ${section.title}\n\n${section.blurb}\n`);
    out.push('| Script | Runs | What for |');
    out.push('| --- | --- | --- |');
    for (const name of section.scripts) {
      // Pipes inside a cell would end it early. Nothing in `scripts` has one today, but a
      // shell pipeline in an npm script is an ordinary thing to write and would otherwise
      // silently shear the table in half.
      const cell = (text) => String(text).replaceAll('|', '\\|');
      out.push(`| \`npm run ${name}\` | \`${cell(scripts[name])}\` | ${cell(docs[name])} |`);
    }
  }

  out.push(`
## Read next

- [Getting the code](getting-the-code.md) — the five commands that make up a full local check
- [Developing on it](developing.md) — the loop, the probe, and the traps
`);

  return `${out.join('\n').trimEnd()}\n`;
}

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const wanted = render(pkg);
const check = process.argv.includes('--check');
const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

if (check) {
  if (current === wanted) {
    process.stdout.write('docs/developer/npm-scripts.md is up to date\n');
  } else {
    process.stderr.write(
      'docs/developer/npm-scripts.md is stale — run `npm run docs:scripts`\n',
    );
    process.exit(1);
  }
} else if (current === wanted) {
  process.stdout.write('docs/developer/npm-scripts.md unchanged\n');
} else {
  fs.writeFileSync(OUT, wanted);
  process.stdout.write(
    `wrote docs/developer/npm-scripts.md (${Object.keys(pkg.scripts).length} scripts)\n`,
  );
}
