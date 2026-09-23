/**
 * What every page under `docs/user/` inherits — including the subdirectories, because
 * Eleventy's directory data cascades down.
 *
 * This exists so the Markdown files need no front matter. They are documents first and
 * site pages second: they are read in the repository and on Bitbucket at least as often
 * as they are read on the site, and four lines of YAML at the top of each one is four
 * lines of noise for the reader who found it through `git`. Everything the site needs to
 * frame a page — its title, its place in the sidebar — is in `docs/_nav.mjs`.
 */
import { titleFor } from '../_nav.mjs';

export default {
  layout: 'doc.njk',
  section: 'user',
  tagline: 'Watch your agents work in an isometric office.',
  eleventyComputed: {
    // A flat `.html` file per page rather than Eleventy's default pretty directory. The
    // office already serves `/docs/character-movements.html`, so this matches what is
    // there — and it means `server.cjs` never has to resolve a directory to an index,
    // which is one fewer rule in a static handler that deliberately has almost none.
    permalink: (data) => `${data.page.filePathStem}.html`,
    // Falls back to the filename rather than throwing: a page missing from the sidebar
    // should still build and still be readable. `test/docs.test.js` is what makes it a
    // failure, and a test failure names the file, which a broken build at this point
    // would not.
    title: (data) => titleFor(`${data.page.filePathStem}.html`)
      ?? data.page.fileSlug.replace(/-/g, ' '),
  },
};
