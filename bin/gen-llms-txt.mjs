#!/usr/bin/env node
/**
 * Write `docs/site/llms.txt` — the index a language model reads to find its way around.
 *
 * [llms.txt](https://llmstxt.org/) is a small convention: a Markdown file at a fixed
 * path, with the project name as an H1, a blockquote summary, then `##` sections of
 * links each with a short description, and an `## Optional` section for what a reader
 * can skip when context is short. Nothing about it is magic — the value is entirely in
 * it being at a predictable URL and being short enough to read in full.
 *
 * **Generated, because the list already exists.** `docs/_nav.mjs` is the sidebar and the
 * only inventory of what the documentation contains, so a hand-written copy of it here
 * would be wrong the first time anybody added a page. The descriptions are lifted from
 * the pages themselves, for the same reason: this project opens almost every document
 * with a one-sentence statement of what it is, which is already the description somebody
 * would otherwise retype.
 *
 * The audience is the reason this is worth having at all. The product is about coding
 * agents, `/agent-setup/prompt.md` already exists because an agent arriving at the site
 * needed a document written for it, and `server.cjs` already serves Markdown as
 * `text/markdown`. This is the same move one level up: the entry point rather than the
 * instructions.
 *
 *     node bin/gen-llms-txt.mjs            # write the file
 *     node bin/gen-llms-txt.mjs --check    # differs? non-zero exit, nothing written
 *
 * `--check` runs inside `npm test` (see `test/docs.test.js`), so a new page that never
 * reached this index is a red build rather than a silent omission.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NAV, SECTIONS } from '../docs/_nav.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'site', 'llms.txt');

/**
 * The public site, spelled out rather than left relative.
 *
 * The convention's own examples use absolute URLs, and they are right to: a model handed
 * this file has no base to resolve `/docs/user/install.html` against. The hostname is the
 * same one `plugins/claude/marketplace.json` names for the same reason — it is where this
 * project is actually published.
 */
const SITE = 'https://therovingoffice.com';

/**
 * The summary, and the only prose here written by hand.
 *
 * It has to be hand-written: no page says what the whole project is in one sentence, and
 * deriving it from `docs/user/index.md` would make the file's opening hostage to an edit
 * made for a different reason.
 */
const SUMMARY = 'A soft-3D isometric office that shows what your coding agents are doing, '
  + 'live. Each agent session becomes a character who walks in, sits down, does the work '
  + 'you asked for and leaves — watchable in a browser, shareable by link.';

const PREAMBLE = `The office runs locally or on a URL, takes live events from several
coding-agent harnesses over a small HTTP protocol, and needs no account: an office is
addressed by an unguessable eight-character keycard, which is the whole of its access
control for reading.

The two documentation sets below are strictly separated and it is worth honouring. *For
everyone* assumes a browser and nothing else. *For developers* assumes a checkout and an
intent to change something.
`;

/**
 * The section for the reader this file is actually for.
 *
 * An agent that lands here has usually been asked to do one of two quite different
 * things, and both are a worse experience if it has to infer which pages apply: connect
 * *itself* to an office so its session shows up in the room, or change this project's
 * code. The first has a document written for it and nothing in the two sets below; the
 * second is the whole developer set. Saying so costs eight lines and saves a reader from
 * assembling the procedure out of an architecture page.
 *
 * **The steps are summarised, not restated.** `agent-setup/prompt.md` is authoritative
 * and says so of itself, and a second copy of a procedure that mints credentials would be
 * a second copy to go stale. What is here is enough to know what you are agreeing to
 * before you fetch it — and the consent step especially, because an index that said "set
 * yourself up" without it would be undercutting the one instruction that document is
 * most insistent about. `test/docs.test.js` checks the mint route named here still
 * matches the one the prompt uses.
 */
const FOR_AGENTS = `## For agents

If you are an AI coding agent and somebody has asked you to connect **this session** to
the office, do not assemble it from the pages below. There is one document written for
you, it is authoritative, and it is meant to be fetched and followed:

- [Set up The Roving Office](${SITE}/agent-setup/prompt.md): mint an office, install the adapter for your own harness, restart the session.

What it will ask of you, so you know before you fetch it:

1. **Ask the user first, once, and wait.** Connecting transmits — to \`therovingoffice.com\` — your repository's host, owner, name and branch, the working directory path, which tools ran and when, and the agent's name and model. It does **not** transmit file contents, prompts, replies or command output; redaction happens on your machine before anything leaves it. Anyone holding the office's keycard can watch it, so treat an office as public. The document carries the exact wording to show, and honours a "local only" answer that sends nothing anywhere.
2. **Mint an office** with \`curl -fsS -X POST ${SITE}/api/offices\`. The response carries a \`keycard\` — eight characters, the read capability, the URL a person opens — and a write token, which is returned exactly once and cannot be retrieved later.
3. **Install your harness's adapter and restart the session.** The restart is the one step you cannot do for the user.

If you have instead been asked to **change this project's code**, none of the above
applies: start from *For developers* below, and read \`AGENTS.md\` in the repository root,
which is the working agreement for an agent session in this codebase.
`;

/**
 * Where the pages that are deliberately never published are listed.
 *
 * Read rather than restated, because two lists would drift and the failure when they did
 * would be this file advertising a URL that 404s — or worse, one that does not. `docs/_nav.mjs`
 * already omits them, so this is the second of two locks on the same door; it exists
 * because the cost of being wrong is publishing a runbook.
 */
function unpublished() {
  return new Set(
    fs.readFileSync(path.join(ROOT, '.eleventyignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('docs/') && line.endsWith('.md')),
  );
}

/** The Markdown file a built URL came from. */
const sourceOf = (url) => path.join('docs', `${url.replace(/^\//, '').replace(/\.html$/, '')}.md`);

/**
 * One sentence saying what a page is, taken from the page.
 *
 * The first block after the H1, which in this repository is almost always a one-line
 * italic statement of what the document covers — written for a human skimming the
 * sidebar, and so already the right sentence for a model skimming this file.
 *
 * Three things make it less tidy than that sounds, and all three are real:
 *
 *   - **It wraps.** Several of these run to two or three lines, so the block is joined
 *     before anything else happens to it.
 *   - **It is not always italic.** Some pages open with ordinary prose, some with
 *     `**Status:** draft`. The markers are stripped rather than required.
 *   - **It is occasionally a code fence.** `coplanar-probe.md` opens with a shell
 *     example. There is no sentence to find, so the page gets its title and no
 *     description, which the convention allows.
 */
function describe(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return null;
  const lines = fs.readFileSync(full, 'utf8').split('\n');

  const h1 = lines.findIndex((line) => line.startsWith('# '));
  if (h1 === -1) return null;

  let i = h1 + 1;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  // A fence, a table, a list or another heading is not a description of the page.
  if (i >= lines.length || /^(```|#|\||[-*] |\d+\. )/.test(lines[i].trim())) return null;

  const block = [];
  for (; i < lines.length && lines[i].trim() !== ''; i += 1) block.push(lines[i].trim());

  const text = block.join(' ')
    // Links become their text: a URL inside a description is noise, and a relative one
    // would not resolve from here anyway.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return firstSentence(text);
}

/**
 * The first sentence, or a clean truncation.
 *
 * A description is one line in a list, so a three-sentence paragraph has to be cut
 * somewhere. Cutting at a full stop reads like a sentence; cutting at a character count
 * reads like a failure, so that is only the fallback — and it breaks on a word.
 */
function firstSentence(text) {
  if (!text) return null;
  const stop = text.search(/\.(\s|$)/);
  const sentence = stop === -1 ? text : text.slice(0, stop + 1);
  if (sentence.length <= 240) return sentence;
  const cut = sentence.lastIndexOf(' ', 240);
  return `${sentence.slice(0, cut > 0 ? cut : 240).trim()}…`;
}

/**
 * `- [Title](url): description`, with the description left off when there is none.
 *
 * The URL is the **Markdown**, not the HTML, which is the rest of the convention. A built
 * page carries the sidebar for its whole documentation set, a table of contents, a header,
 * a footer and two font preloads — so pointing a model at it spends most of the response
 * on navigation for forty other pages. `bin/gen-docs-markdown.mjs` publishes the copy
 * beside the HTML, which is the only reason this can link it.
 */
function bullet({ title, url, description }) {
  const md = url.replace(/\.html$/, '.md');
  // Not cosmetic. With the copy missing, every link in this index is a 404 and the file
  // is worse than useless — it is confidently wrong. Fail the build instead.
  if (!fs.existsSync(path.join(ROOT, 'docs', 'site', md.replace(/^\//, '')))) {
    throw new Error(
      `docs/site${md} does not exist, so llms.txt will not link it. Run \`npm run docs\`, `
      + 'which publishes the Markdown copies before this runs.',
    );
  }
  return `- [${title}](${SITE}/docs${md})${description ? `: ${description}` : ''}`;
}

function render() {
  const skip = unpublished();
  const lines = [
    `# The Roving Office`, '',
    `> ${SUMMARY}`, '',
    PREAMBLE.trim(), '',
    // First, and before either documentation set: whoever is reading this file is more
    // likely to be the reader that section is for than not.
    FOR_AGENTS.trim(), '',
  ];

  for (const section of SECTIONS) {
    const groups = NAV[section.id] ?? [];
    const pages = groups
      .flatMap((group) => group.pages)
      .filter((page) => !page.external);
    if (!pages.length) continue;

    lines.push(`## ${section.label}`, '', `${section.tagline}`, '');
    for (const page of pages) {
      const source = sourceOf(page.url);
      // The lock described on `unpublished`. A page the sidebar lists and the build
      // refuses is a contradiction worth stopping for rather than quietly skipping.
      if (skip.has(source)) {
        throw new Error(
          `${source} is listed in docs/_nav.mjs and in .eleventyignore's unpublished set. `
          + 'One of the two is wrong; this file will not advertise it either way.',
        );
      }
      lines.push(bullet({ ...page, description: describe(source) }));
    }
    lines.push('');
  }

  /**
   * The interactive pages, under the heading the convention reserves for what can be
   * skipped — which is exactly what they are to a reader made of text. They are whole
   * HTML documents full of scripted galleries rather than prose, so a model fetching one
   * spends a lot of context on markup and learns very little. A person following the same
   * link gets the most useful page on the site for checking a movement change.
   */
  const libraries = (NAV.developer ?? [])
    .flatMap((group) => group.pages)
    // `external` alone is not the test. `/agent-setup/` is external too and is the
    // opposite of optional for the reader of this file — it has its own section above.
    .filter((page) => page.external && !page.site);
  if (libraries.length) {
    lines.push(
      '## Optional',
      '',
      'Interactive galleries rather than prose — scripted HTML, best opened in a browser '
      + 'by a person. There is little here for a reader made of text.',
      '',
      ...libraries.map((page) => `- [${page.title}](${SITE}${page.url})`),
      '',
    );
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

const wanted = render();
const check = process.argv.includes('--check');
const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

if (check) {
  if (existing === wanted) process.exit(0);
  process.stderr.write(
    existing === null
      ? 'docs/site/llms.txt has not been generated. Run `npm run docs`.\n'
      : 'docs/site/llms.txt is stale. Run `npm run docs`.\n',
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, wanted);
const count = (wanted.match(/^- \[/gm) ?? []).length;
console.log(`Wrote docs/site/llms.txt — ${count} links, ${wanted.length} bytes.`);
