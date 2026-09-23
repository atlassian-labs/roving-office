/**
 * Check every internal link and image in the built documentation site.
 *
 * The docs have around seven hundred internal links. When they were split into two
 * sets, an ad-hoc version of this found **176 broken links and bad anchors** — pages that
 * had moved, sections that had been renamed out from under their own anchors, and `../`
 * depths that were right before a file changed directory and wrong afterwards. All 176
 * were fixed by hand. This exists so the next rename cannot do it again quietly, because
 * a broken link in published docs is the class of fault nobody notices for months.
 *
 * **It reads the built HTML, not the Markdown**, and that is the important decision.
 * Linting the `.md` files would mean reimplementing what the build does to a link: the
 * `.md` → `.html` rewrite, the Bitbucket rewrite for paths that escape `docs/`, and
 * `pathPrefix`. That is a second opinion on link semantics, and the moment it drifts from
 * `eleventy.config.mjs` the checker is confidently wrong. Reading the output checks the
 * artifact that actually ships, after every transform has had its say.
 *
 * It is called from two places, and each catches something the other cannot:
 *
 *   - `eleventy.config.mjs` on `eleventy.after` — fails `npm run docs`. This is where it
 *     earns its keep: the output is fresh by construction, and `npm run docs` is already
 *     the command you must run after touching a doc, so a bad link fails seconds after
 *     you write it.
 *   - `test/docs.test.js` — fails `npm test`. The backstop, and not redundant: Eleventy
 *     writes files *before* `after` fires, so without this somebody can watch the build
 *     fail and commit anyway. It also means CI needs no new command, which keeps
 *     `bitbucket-pipelines.yml`'s rule about running only what a contributor runs.
 *
 * One function behind two call sites is the same argument `reviseLayout()` makes over in
 * the layout: called at import *and* after every edit, so the two cannot drift apart.
 *
 * **Nothing here touches the network.** External links are skipped on purpose — egress in
 * a build is a flake source, and this project guards being able to work offline. A dead
 * link to somebody else's site is a different job with a different failure mode, and it
 * does not belong in a check that gates a commit.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Every `href` and `src`, wherever it appears. */
const REF = /(?:href|src)="([^"]*)"/g;
/** Any element carrying an id, which is what an anchor can land on. */
const ID = /\sid="([^"]*)"/g;

/** Schemes and shapes that are somebody else's problem. */
function isExternal(target) {
  return /^(?:https?:|mailto:|data:|tel:|\/\/)/.test(target);
}

/**
 * An office URL is a route, not a file.
 *
 * `server.cjs` serves the app shell for anything under `/office/<keycard>`, so there is no
 * file on disk to point at. Rather than skipping the whole prefix — which would wave a
 * typo straight through — the keycard is checked against the format `src/office/keycard.js`
 * defines: Crockford base32, which is the digits and A–Z without I, L, O or U.
 */
const OFFICE_ROUTE = /^\/office\/[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}(?:\/.*)?$/;

function isAppRoute(target) {
  if (target === '/' || target === '/docs' || target === '/debuglog') return true;
  return target.startsWith('/office/') && OFFICE_ROUTE.test(target);
}

/**
 * Where a link actually resolves, mirroring `serveStatic()` in `server.cjs`.
 *
 * The mirror is the whole subtlety. `docs/site` is served *at* `/docs`, and anything not
 * found there falls back to `docs/` itself — which is how the three standalone HTML
 * libraries and 5MB of imagery are reached without being copied into the build. A checker
 * that resolves paths on disk without that fallback reports every `../images/...` link in
 * the docs as broken while they all work perfectly in a browser. That was 137 of the
 * original 176, and it is the reason this function exists rather than a bare `existsSync`.
 */
function resolveOnDisk({ target, pageFile, siteDir, docsDir, repoDir }) {
  const inSite = (rel) => path.join(siteDir, rel);
  const inDocs = (rel) => path.join(docsDir, rel);

  let candidates;
  if (target.startsWith('/docs/')) {
    const rel = target.slice('/docs/'.length);
    candidates = [inSite(rel), inDocs(rel)];
  } else if (target.startsWith('/')) {
    // Root-absolute and not under /docs: served straight out of the repo, like
    // /assets/logo-64.png or /favicon.ico.
    candidates = [path.join(repoDir, target.slice(1))];
  } else {
    // Relative to the page. Resolve against its directory in the *output* tree, then try
    // the same path under docs/ for the fallback above.
    const abs = path.resolve(path.dirname(pageFile), target);
    candidates = [abs];
    const rel = path.relative(siteDir, abs);
    if (!rel.startsWith('..')) candidates.push(inDocs(rel));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * @param {object} opts
 * @param {string} opts.repoDir  the repository root
 * @returns {Array<{page: string, link: string, problem: string}>} empty when all is well
 */
export function checkDocLinks({ repoDir }) {
  const docsDir = path.join(repoDir, 'docs');
  const siteDir = path.join(docsDir, 'site');
  const problems = [];

  if (!fs.existsSync(siteDir)) {
    return [{ page: 'docs/site', link: '', problem: 'not built — run `npm run docs`' }];
  }

  const pages = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) pages.push(full);
    }
  };
  walk(siteDir);

  // Ids are read once per page and cached, because a page linked from thirty others would
  // otherwise be parsed thirty times.
  const idsFor = new Map();
  const ids = (file) => {
    if (!idsFor.has(file)) {
      const html = fs.readFileSync(file, 'utf8');
      idsFor.set(file, new Set([...html.matchAll(ID)].map((m) => m[1])));
    }
    return idsFor.get(file);
  };

  for (const pageFile of pages.sort()) {
    const page = path.relative(repoDir, pageFile);
    const html = fs.readFileSync(pageFile, 'utf8');

    for (const [, raw] of html.matchAll(REF)) {
      if (!raw || isExternal(raw) || isAppRoute(raw)) continue;

      const hash = raw.indexOf('#');
      const target = hash === -1 ? raw : raw.slice(0, hash);
      const anchor = hash === -1 ? '' : decodeURIComponent(raw.slice(hash + 1));

      // A bare `#thing`: same page.
      if (!target) {
        if (anchor && !ids(pageFile).has(anchor)) {
          problems.push({ page, link: raw, problem: `no id "${anchor}" on this page` });
        }
        continue;
      }

      const resolved = resolveOnDisk({ target, pageFile, siteDir, docsDir, repoDir });
      if (!resolved) {
        problems.push({ page, link: raw, problem: 'target does not exist' });
        continue;
      }

      // Only a built page can be asked about its anchors. A link into one of the
      // standalone libraries is checked for existence and no further: those pages are
      // hand-written and their ids are not ours to police.
      if (anchor && resolved.startsWith(siteDir) && resolved.endsWith('.html')) {
        if (!ids(resolved).has(anchor)) {
          const where = path.relative(repoDir, resolved);
          problems.push({ page, link: raw, problem: `no id "${anchor}" in ${where}` });
        }
      }
    }
  }

  return problems;
}

/** One problem per line, for a build that is about to throw or a test that just failed. */
export function formatProblems(problems) {
  return problems
    .map(({ page, link, problem }) => `  ${page}\n      ${link || '(anchor)'} — ${problem}`)
    .join('\n');
}
