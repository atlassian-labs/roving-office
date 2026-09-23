/**
 * Turn `docs/user` and `docs/developer` into the HTML site served at `/docs`.
 *
 * This is the repo's only build step, and it deliberately does not touch the app. The app
 * has no build step and must not grow one — three.js is vendored, modules load straight
 * off disk, and that constraint is guarded jealously. What this builds is documentation,
 * its output is `docs/site/`, and `server.cjs` serves that directory the same way it
 * serves everything else.
 *
 * Its output is **committed**. `.gitignore` argues against committing generated files and
 * is right to, but neither deploy target may build or fetch at deploy time: `Dockerfile.fly`
 * runs no `npm install` by design, and the Kaizen artifact is a file copy. So this follows
 * the precedent of `src/agents/colour-names.js` — generated, committed, and guarded by a
 * drift check in `npm test` so the committed copy cannot quietly stop matching its source.
 */
import { fileURLToPath } from 'node:url';

import markdownItAnchor from 'markdown-it-anchor';
import pluginTOC from '@uncenter/eleventy-plugin-toc';

import { NAV, SECTIONS, titleFor } from './docs/_nav.mjs';
import { checkDocLinks, formatProblems } from './bin/lib/check-doc-links.mjs';

/**
 * The repository root, from this file's own location rather than `process.cwd()`.
 *
 * Eleventy is always run from the root today, so the two agree — but one of them stays
 * true if it ever is not, and it is this one.
 */
const REPO_DIR = fileURLToPath(new URL('.', import.meta.url));

export default function (eleventyConfig) {
  // Heading ids, which the table of contents needs something to point at. `permalink:
  // false` because the anchor links themselves are noise here — the sidebar is the way
  // people jump around, and a row of ¶ marks down the page earns nothing.
  eleventyConfig.amendLibrary('md', (md) => md.use(markdownItAnchor, {
    permalink: false,
    slugify: (s) => encodeURIComponent(
      String(s).trim().toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-'),
    ),
  }));

  // h2 and h3 only, and unordered. These documents go four deep in places, and a
  // contents list that mirrors every level is a second document rather than a way around
  // the first. Numbers are worse still: several of these files number their own sections,
  // so an ordered list would show "3. 5. The bin" and mean neither.
  eleventyConfig.addPlugin(pluginTOC, {
    tags: ['h2', 'h3'],
    ul: true,
    wrapper: (toc) => `<nav class="toc">${toc}</nav>`,
  });

  eleventyConfig.addPassthroughCopy({ 'docs/_assets': 'assets' });
  for (const name of ['ui-theme.css', 'Inter-latin.woff2', 'JetBrainsMono-latin.woff2']) {
    eleventyConfig.addPassthroughCopy({ [`assets/${name}`]: `assets/${name}` });
  }

  // Both fonts' licences, from the vendored originals. `docs/site` is a distribution of
  // its own — the Kaizen artifact and the Fly image each copy the directory whole — so
  // the OFL text has to be inside it and not only in the repository root, which those
  // recipes copy separately.
  for (const [from, to] of [
    ['vendor/inter/LICENSE', 'assets/Inter-LICENSE.txt'],
    ['vendor/jetbrains-mono/LICENSE', 'assets/JetBrainsMono-LICENSE.txt'],
  ]) {
    eleventyConfig.addPassthroughCopy({ [from]: to });
  }

  eleventyConfig.addGlobalData('nav', NAV);
  eleventyConfig.addGlobalData('sections', SECTIONS);

  eleventyConfig.addFilter('titleFor', titleFor);

  /**
   * How far above `docs/` a relative href climbs, or 0 if it stays inside.
   *
   * Both transforms below need this and they must agree about it, because a link that
   * leaves `docs/` is not a page: it is a file on Bitbucket. Counting `../` against the
   * page's own depth is the only way to tell, since `../../src/layout.js` from
   * `user/sources/` and from `developer/` mean different things.
   */
  const escapesDocs = (page, target) => {
    const depth = page.url.replace(/^\/|\/[^/]*$/g, '').split('/').filter(Boolean).length;
    const ups = (target.match(/\.\.\//g) ?? []).length;
    return ups > depth;
  };

  /**
   * Rewrite `foo.md` links to `foo.html` in the built page.
   *
   * The Markdown keeps pointing at Markdown, because these files are read in the
   * repository and on Bitbucket at least as often as they are read on the site, and a
   * document full of `.html` links is broken in both of those places. Rewriting at build
   * time is the only way both readers get working links out of one source.
   *
   * Restricted to relative hrefs on purpose: an absolute URL ending in `.md` is a link to
   * somebody else's repository — GitHub, Bitbucket — and pointing it at `.html` would
   * invent a page that does not exist.
   *
   * And skipped entirely for a link that climbs out of `docs/`, for the same reason. The
   * transform below sends those to Bitbucket, which serves the Markdown itself — so
   * `../../AGENTS.md` must arrive there as `AGENTS.md`. Rewriting it first produced
   * `src/main/AGENTS.html`, a 404, and it did so for every root Markdown file a doc
   * pointed at.
   */
  eleventyConfig.addTransform('md-links-to-html', function (content) {
    if (!this.page.outputPath?.endsWith('.html')) return content;
    const { page } = this;
    return content.replace(
      /href="(?!https?:|\/\/|#)([^"#]+)\.md(#[^"]*)?"/g,
      (match, path, hash) => (escapesDocs(page, path) ? match : `href="${path}.html${hash ?? ''}"`),
    );
  });

  /**
   * Point links that leave `docs/` at Bitbucket instead.
   *
   * These documents cite the code constantly, and in the repository `../../src/layout.js`
   * is exactly right — it opens the file. On the site it is nonsense: the reader is on
   * `therovingoffice.com` and there is no checkout under their cursor. Some of those paths
   * (`bin/`, `Dockerfile.fly`) are not even shipped in the deployed artifact, so they could
   * not be served however the link was spelled.
   *
   * So the Markdown goes on pointing at files, and the built page points at the same file
   * on Bitbucket. Both readers get a link that works, out of one source — the same bargain
   * the `.md` → `.html` transform above strikes.
   *
   * The branch is `main` rather than a commit: a docs page outlives the commit that built
   * it, and a reader following a code link wants the file as it is now.
   */
  eleventyConfig.addTransform('source-links-to-repository', function (content) {
    if (!this.page.outputPath?.endsWith('.html')) return content;
    const REPO = 'https://github.com/atlassian-labs/roving-office/blob/main';
    const { page } = this;

    return content.replace(/href="((?:\.\.\/)+[^"#]+)"/g, (match, target) => {
      // Still inside docs/ — a sibling page, or the imagery. Leave it alone.
      if (!escapesDocs(page, target)) return match;
      const path = target.replace(/(?:\.\.\/)+/, '');
      return `href="${REPO}/${path}"`;
    });
  });

  /**
   * Refuse to finish a build whose links do not resolve.
   *
   * `eleventy.after` rather than a transform, because a link can only be checked once
   * every page it might point at has been written — a transform runs per page and would
   * be asking about files that do not exist yet.
   *
   * This is the call site that matters. `npm run docs` is already the command you have to
   * run after touching a doc, so a moved page or a renamed heading fails here, seconds
   * after you did it, with the file named. `npm test` checks the same thing as a backstop
   * (Eleventy writes files *before* this fires, so a failed build still leaves output on
   * disk to be committed) — see bin/lib/check-doc-links.mjs for why both exist.
   */
  eleventyConfig.on('eleventy.after', () => {
    const problems = checkDocLinks({ repoDir: REPO_DIR });
    if (!problems.length) return;
    throw new Error(
      `${problems.length} broken documentation link(s):\n${formatProblems(problems)}\n`,
    );
  });

  return {
    dir: {
      input: 'docs',
      output: 'docs/site',
      includes: '_includes',
    },
    // The site lives under /docs on the office's own server, so every link built with the
    // `url` filter needs that prefix. Output paths are unaffected — this only changes what
    // the HTML says, which is exactly the distinction we want.
    pathPrefix: '/docs/',
    // No templating inside the Markdown. These are plain documents, and several of them
    // contain `{{` and `{%` inside code samples — JSON, shell, Nunjucks-adjacent config —
    // which a template engine would try to execute and fail on. The layouts are Nunjucks;
    // the content is content.
    markdownTemplateEngine: false,
    htmlTemplateEngine: 'njk',
  };
}
