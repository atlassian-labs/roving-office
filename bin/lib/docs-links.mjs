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

/**
 * How far above `docs/` a relative href climbs, or false if it stays inside.
 *
 * Counting `../` against the page's own depth is the only way to tell, since
 * `../../src/layout.js` from `user/sources/` and from `developer/` mean different things
 * — the first lands in `docs/`, the second above it.
 *
 * @param {string} pageUrl  the page's built URL, e.g. `/user/sources/codex.html`
 * @param {string} target   the link, as written in the Markdown
 */
export function escapesDocs(pageUrl, target) {
  const depth = pageUrl.replace(/^\/|\/[^/]*$/g, '').split('/').filter(Boolean).length;
  const ups = (target.match(/\.\.\//g) ?? []).length;
  return ups > depth;
}

/**
 * The repository URL for a path that climbed out of `docs/`.
 *
 * The branch is `main` rather than a commit: a docs page outlives the commit that built
 * it, and a reader following a code link wants the file as it is now.
 */
export const REPO_BLOB = 'https://github.com/atlassian-labs/roving-office/blob/main';

/** `../../src/layout.js` → the same file on the repository. */
export function repoUrlFor(target) {
  return `${REPO_BLOB}/${target.replace(/(?:\.\.\/)+/, '')}`;
}
