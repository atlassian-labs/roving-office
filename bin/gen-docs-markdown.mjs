#!/usr/bin/env node
/**
 * Publish a Markdown copy of every built documentation page, beside its HTML.
 *
 * The other half of the [llms.txt convention](https://llmstxt.org/): as well as an index
 * at a fixed path, it proposes that a `.md` version of each page be available, so a
 * reader made of text gets prose instead of markup. The markup is not a rounding error
 * here — a built page carries the sidebar for its whole documentation set, a table of
 * contents, a header, a footer and two font preloads, so a model asking for one page
 * receives the navigation for forty of them and has to find the content inside it.
 *
 * ## Why the published set is derived from the HTML
 *
 * This is the part that matters, and the obvious implementation gets it wrong.
 * The Markdown under `docs/` cannot simply be shipped: the deliberately unpublished set at the
 * bottom of `.eleventyignore` — the deploy runbook, the design records — lives in the
 * same tree, so a wholesale copy, or a `.dockerignore` exception broad enough to let
 * Markdown through, would put those on a public URL. `test/docs.test.js` guards the built
 * *HTML* against exactly that and would not have seen a Markdown copy.
 *
 * So the set is not a list. For each HTML page Eleventy actually built under `docs/site`,
 * the source it came from is copied beside it. A page Eleventy refused to build has no
 * HTML to find and so is never copied: the boundary is `.eleventyignore`, unchanged,
 * enforced by the very mechanism that already enforces it, with no second list to drift.
 *
 * ## Why the copies are not byte-for-byte
 *
 * One rewrite is applied, and leaving it out would publish broken links. These documents
 * cite the code constantly, and `../../bin/aop-send.cjs` is exactly right in a checkout
 * and meaningless on the web — `bin/` is not even in the deployed image. The HTML build
 * sends those to the repository for that reason, so the Markdown copy does too, through
 * the same `bin/lib/docs-links.mjs` helper, or the two artifacts would disagree about the
 * same source. Links that stay inside `docs/` are left alone: they point at `.md` files,
 * and after this runs those `.md` files are there.
 *
 *     node bin/gen-docs-markdown.mjs            # write the copies
 *     node bin/gen-docs-markdown.mjs --check    # differs? non-zero exit, nothing written
 *
 * `--check` runs inside `npm test`, so a stale or missing copy is a red build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapesDocs, repoUrlFor } from './lib/docs-links.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
const SITE = path.join(DOCS, 'site');

/** Every built page, as a site-relative path like `user/sources/codex.html`. */
function builtPages(dir = SITE, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // `assets` is the theme and the fonts; nothing in it came from Markdown.
      if (rel === 'assets') continue;
      out.push(...builtPages(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.html')) {
      out.push(rel);
    }
  }
  return out.sort();
}

/**
 * The Markdown a built page came from, with its outward links redirected.
 *
 * Returns null when there is no source — which is not an error. `docs/site` holds pages
 * Eleventy did not render from Markdown, and a copy of a file that does not exist is not
 * something to invent.
 */
function publishedMarkdown(relHtml) {
  const source = path.join(DOCS, relHtml.replace(/\.html$/, '.md'));
  if (!fs.existsSync(source)) return null;

  // The page's built URL, which is what `escapesDocs` counts `../` against.
  const pageUrl = `/${relHtml}`;

  return fs.readFileSync(source, 'utf8').replace(
    /\]\((?!https?:|\/\/|#|mailto:)([^)\s]+)(\s+"[^"]*")?\)/g,
    (match, target, title) => (
      escapesDocs(pageUrl, target) ? `](${repoUrlFor(pageUrl, target)}${title ?? ''})` : match
    ),
  );
}

/** What should be on disk: site-relative `.md` path → contents. */
function wanted() {
  const out = new Map();
  for (const page of builtPages()) {
    const body = publishedMarkdown(page);
    if (body !== null) out.set(page.replace(/\.html$/, '.md'), body);
  }
  return out;
}

/** The `.md` files currently under `docs/site`, which is what a stale copy shows up in. */
function existing(dir = SITE, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (rel === 'assets') continue;
      out.push(...existing(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out.sort();
}

const want = wanted();
const have = existing();
const check = process.argv.includes('--check');

const missing = [...want.keys()].filter((rel) => !have.includes(rel));
// An extra is the dangerous direction, not the untidy one: it is a page that stopped
// being published while its Markdown stayed on a public URL.
const extra = have.filter((rel) => !want.has(rel));
const stale = [...want].filter(([rel, body]) => (
  have.includes(rel) && fs.readFileSync(path.join(SITE, rel), 'utf8') !== body
)).map(([rel]) => rel);

if (check) {
  const problems = [
    ...missing.map((rel) => `  missing  docs/site/${rel}`),
    ...stale.map((rel) => `  stale    docs/site/${rel}`),
    ...extra.map((rel) => `  orphaned docs/site/${rel} — its page is no longer published`),
  ];
  if (!problems.length) process.exit(0);
  process.stderr.write(
    `docs/site Markdown copies do not match the built pages. Run \`npm run docs\`.\n${
      problems.join('\n')}\n`,
  );
  process.exit(1);
}

for (const rel of extra) fs.rmSync(path.join(SITE, rel));
for (const [rel, body] of want) {
  const target = path.join(SITE, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}
console.log(
  `Wrote ${want.size} Markdown copies into docs/site${
    extra.length ? ` (removed ${extra.length} orphaned)` : ''}.`,
);
