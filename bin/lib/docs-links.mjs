/**
 * Which documentation links point outside `docs/`, and where they should point instead.
 *
 * These documents cite the code constantly, and in a checkout `../../src/layout.js` is
 * exactly right — it opens the file. On the web it is nonsense: the reader is on
 * `therovingoffice.com` with no checkout under their cursor, and several of those paths
 * (`bin/`, `Dockerfile.fly`, `AGENTS.md`, `NOTICE`) are not in the deployed image at all,
 * so they could not be served however the link was spelled. The Markdown goes on pointing
 * at files; anything published points at the same file on the repository.
 *
 * **Extracted because two builds now need to agree about it.** `eleventy.config.mjs`
 * rewrites `href="…"` in rendered HTML; `bin/gen-docs-markdown.mjs` rewrites
 * `[text](…)` in the Markdown copies it publishes. Different syntax, same question —
 * and a page whose HTML sent a link to the repository while its Markdown twin left it
 * pointing at a 404 would be the two artifacts disagreeing about the same source.
 */
import path from 'node:path';

/**
 * Where a link actually lands, as a repository-root-relative path.
 *
 * Resolved rather than pattern-stripped, and that is the whole of this function. The
 * version this replaced did `target.replace(/(?:\.\.\/)+/, '')` — drop the leading run of
 * `../` and treat what is left as root-relative, which is right only while every link
 * climbs in one unbroken run at the front. `../a/../b` came out as `a/../b`: a URL with
 * `../` still in it, pointing at nothing. CodeQL flagged it as incomplete multi-character
 * sanitization, which is exactly what it was.
 *
 * `path.posix` on purpose — these are URLs, so the separator is `/` on every platform,
 * and `path.resolve` would drag the working directory in.
 *
 * @param {string} pageUrl  the page's built URL, e.g. `/user/sources/codex.html`
 * @param {string} target   the link, as written in the Markdown
 * @returns {string} the path from the repository root, e.g. `src/layout.js`
 */
export function resolveFromRepo(pageUrl, target) {
  // Eleventy gives an index page the directory form — `/developer/`, not
  // `/developer/index.html` — and `dirname` on that drops a level, which silently moved
  // every link on the two index pages up one directory. So the trailing slash means the
  // URL already *is* the directory. Both forms arrive here: the Markdown generator works
  // from built filenames and always passes the second.
  const pageDir = pageUrl.endsWith('/')
    ? path.posix.join('docs', pageUrl)
    : path.posix.dirname(path.posix.join('docs', pageUrl));
  return path.posix.normalize(path.posix.join(pageDir, target));
}

/**
 * Whether a relative link climbs out of `docs/`.
 *
 * Asking where it lands rather than counting `../` against the page's depth: the two
 * agree on every link in these documents, and only the first keeps agreeing if one is
 * ever written as `../sources/../../AGENTS.md`.
 *
 * A link that climbs above the repository root is not "outside docs" — it is broken, and
 * saying so is the caller's job. `normalize` leaves the `..` on the front in that case,
 * which is what `startsWith` catches.
 */
export function escapesDocs(pageUrl, target) {
  const landing = resolveFromRepo(pageUrl, target);
  return !landing.startsWith('docs/') && !landing.startsWith('..');
}

/**
 * The repository URL for a path that climbed out of `docs/`.
 *
 * The branch is `main` rather than a commit: a docs page outlives the commit that built
 * it, and a reader following a code link wants the file as it is now.
 */
export const REPO_BLOB = 'https://github.com/atlassian-labs/roving-office/blob/main';

/** `../../src/layout.js`, from a page under `docs/developer/`, → that file on the repository. */
export function repoUrlFor(pageUrl, target) {
  const landing = resolveFromRepo(pageUrl, target);
  if (landing.startsWith('..')) {
    throw new Error(
      `${pageUrl} links to ${target}, which resolves above the repository root. `
      + 'A link that leaves the repository cannot be rewritten to a file in it.',
    );
  }
  return `${REPO_BLOB}/${landing}`;
}
