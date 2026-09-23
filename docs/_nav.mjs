/**
 * The sidebar, and the only list of what the documentation contains.
 *
 * This is deliberately hand-ordered rather than derived from the filesystem. A docs
 * sidebar is a reading order — "start here, then this, then the reference you will come
 * back to" — and no directory listing knows that. Alphabetical would open the user
 * section on "buildings" and bury "install" in the middle.
 *
 * It is also the single source of every page's title, which is why the Markdown files
 * carry no front matter at all: they stay plain documents that read correctly in the
 * repository and on Bitbucket, and everything the site needs to frame them lives here.
 *
 * `test/docs.test.js` asserts this file and the Markdown agree in both directions, so a
 * new page that never made it into the sidebar is a failing test rather than an orphan
 * nobody can navigate to.
 *
 * The one exception is the unpublished set listed at the bottom of `.eleventyignore`:
 * internal deployment runbooks and design records that stay in the repository and are
 * never built. That file is where the boundary is drawn — this one just does not list
 * them, which is why there is no "Design records" group and no "Publishing it" page here.
 */

/** The two front doors. `href` is where the tab at the top of every page points. */
export const SECTIONS = [
  {
    id: 'user',
    label: 'For everyone',
    href: '/user/index.html',
    tagline: 'You have the app and a browser.',
  },
  {
    id: 'developer',
    label: 'For developers',
    href: '/developer/index.html',
    tagline: 'You have a checkout and something to change.',
  },
];

/**
 * Pages, grouped, in reading order.
 *
 * `external: true` marks the standalone pages that are not built from Markdown — the
 * three generated HTML libraries, which are served from `docs/` rather than `docs/site/`
 * and so are linked rather than rendered. They appear in both sidebars on purpose: they
 * are as much fun to look at as they are useful to check a change against.
 */
export const NAV = {
  user: [
    {
      label: 'Start here',
      pages: [
        { url: '/user/index.html', title: 'What this is' },
        { url: '/user/watching.html', title: 'Watching the office' },
        { url: '/user/install.html', title: 'Install and run it' },
      ],
    },
    {
      label: 'Using it',
      pages: [
        { url: '/user/keys.html', title: 'Keys and panels' },
        { url: '/user/offices-and-keycards.html', title: 'Offices, keycards and scenes' },
        { url: '/user/connect-your-agents.html', title: 'Connect your agents' },
        { url: '/user/rearranging-furniture.html', title: 'Rearranging the furniture' },
        { url: '/user/layouts.html', title: 'Layouts' },
        { url: '/user/sharing-an-office.html', title: 'Sharing an office' },
      ],
    },
    {
      label: 'What you are looking at',
      pages: [
        { url: '/user/concepts.html', title: 'Jobs: the one idea' },
        { url: '/user/work-and-post.html', title: 'Post, parcels and the bin' },
        { url: '/user/the-room.html', title: 'The room, prop by prop' },
        { url: '/user/agent-names.html', title: 'Agent names' },
        { url: '/user/buildings.html', title: 'Buildings and themes' },
        { url: '/user/solar-geometry.html', title: 'Solar geometry' },
        { url: '/user/generated-offices.html', title: 'Generated offices' },
      ],
    },
    {
      label: 'Connecting a harness',
      pages: [
        { url: '/user/sources/test-data.html', title: 'Test Data' },
        { url: '/user/sources/rovo-cli.html', title: 'Rovo CLI' },
        { url: '/user/sources/claude-code.html', title: 'Claude Code' },
        { url: '/user/sources/cursor.html', title: 'Cursor' },
        { url: '/user/sources/codex.html', title: 'Codex' },
        { url: '/user/sources/openclaw.html', title: 'OpenClaw' },
        { url: '/user/sources/openclaw-server.html', title: 'OpenClaw on a server' },
        { url: '/user/sources/openclaw-identity.html', title: 'OpenClaw: names and faces' },
      ],
    },
    {
      label: 'Libraries',
      pages: [
        { url: '/character-movements.html', title: 'Every character movement', external: true },
        { url: '/item-movements.html', title: 'Every object, turning', external: true },
        { url: '/office-seeds.html', title: 'Two dozen generated offices', external: true },
        { url: '/office-variety.html', title: 'Thirty offices, thirty seeds', external: true },
      ],
    },
  ],

  developer: [
    {
      label: 'Start here',
      pages: [
        { url: '/developer/index.html', title: 'Where to look' },
        { url: '/developer/getting-the-code.html', title: 'Getting the code' },
        { url: '/developer/developing.html', title: 'Developing on it' },
        { url: '/developer/npm-scripts.html', title: 'Every npm script' },
      ],
    },
    {
      label: 'How it works',
      pages: [
        { url: '/developer/architecture.html', title: 'Architecture' },
        { url: '/developer/physics.html', title: 'The physics of the office' },
        { url: '/developer/scene-internals.html', title: 'Scene internals' },
        { url: '/developer/job-delivery.html', title: 'Job delivery' },
        { url: '/developer/editor.html', title: 'The furniture editor' },
        { url: '/developer/layout-algorithm.html', title: 'The layout algorithm' },
        { url: '/developer/tuning-the-layouts.html', title: 'Tuning the layout generator' },
        { url: '/developer/sources.html', title: 'The source model' },
        { url: '/developer/test-data.html', title: 'The Test Data source' },
      ],
    },
    {
      label: 'Changing it',
      pages: [
        { url: '/developer/extending.html', title: 'Extending the office' },
        { url: '/developer/prop-portraits.html', title: 'Photographing a prop' },
        { url: '/developer/visual-assets.html', title: 'Visual assets and their rights' },
        { url: '/developer/coplanar-probe.html', title: 'The coplanar-face probe' },
        { url: '/developer/plugin-distribution.html', title: 'Publishing the plugins' },
        { url: '/developer/admin-console.html', title: 'The admin console' },
      ],
    },
    {
      label: 'The protocol',
      pages: [
        { url: '/developer/protocol/aop-spec.html', title: 'The AOP spec' },
        { url: '/developer/protocol/aop-harness-adapters.html', title: 'Adapter notes' },
      ],
    },
    {
      label: 'Adapters',
      pages: [
        { url: '/developer/adapters/rovo-cli.html', title: 'Rovo CLI' },
        { url: '/developer/adapters/claude-code.html', title: 'Claude Code' },
        { url: '/developer/adapters/cursor.html', title: 'Cursor' },
        { url: '/developer/adapters/codex.html', title: 'Codex' },
        { url: '/developer/adapters/openclaw.html', title: 'OpenClaw' },
      ],
    },
    {
      label: 'Libraries',
      pages: [
        { url: '/character-movements.html', title: 'Every character movement', external: true },
        { url: '/item-movements.html', title: 'Every object, turning', external: true },
        { url: '/office-seeds.html', title: 'Two dozen generated offices', external: true },
        { url: '/office-variety.html', title: 'Thirty offices, thirty seeds', external: true },
      ],
    },
  ],
};

/** Every non-external page, flat, for lookups and for the tests. */
export function allPages() {
  return Object.entries(NAV).flatMap(([section, groups]) =>
    groups.flatMap((group) =>
      group.pages
        .filter((page) => !page.external)
        .map((page) => ({ ...page, section, group: group.label })),
    ),
  );
}

/** The title for a built URL, or null when the sidebar has never heard of it. */
export function titleFor(url) {
  return allPages().find((page) => page.url === url)?.title ?? null;
}
