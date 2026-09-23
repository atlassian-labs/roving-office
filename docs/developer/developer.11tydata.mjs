/**
 * The developer set's half of the arrangement in `docs/user/user.11tydata.mjs` — same
 * reasoning, same shape, different section. Cascades to `protocol/`, `adapters/` and
 * `design/` as well.
 */
import { titleFor } from '../_nav.mjs';

export default {
  layout: 'doc.njk',
  section: 'developer',
  tagline: 'How the office is built, and how to change it.',
  eleventyComputed: {
    permalink: (data) => `${data.page.filePathStem}.html`,
    title: (data) => titleFor(`${data.page.filePathStem}.html`)
      ?? data.page.fileSlug.replace(/-/g, ' '),
  },
};
