/* Two small things the documentation site needs, and nothing else.
 *
 * No framework and no build step, in keeping with the app it documents. If this file ever
 * wants a bundler, the honest move is to delete whatever wanted one.
 */

// The Contents button, on a narrow screen where the sidebar is folded away.
const toggle = document.querySelector('.menu-toggle');
const sidebar = document.getElementById('sidebar');

if (toggle && sidebar) {
  toggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

/* Mark the section you are currently reading in the right-hand contents.
 *
 * An IntersectionObserver rather than a scroll handler: the browser does the work, and
 * the callback fires only when a heading actually crosses the line rather than on every
 * pixel of every scroll.
 *
 * The `rootMargin` is the whole trick. `-<topbar>px 0px -70% 0px` shrinks the viewport to
 * a band just under the sticky bar, so a heading counts as "here" while it sits near the
 * top of the reading area — which is where your eye is — rather than the moment it
 * appears at the bottom of the screen. Without the bottom margin, scrolling to the end of
 * a long page highlights every remaining heading at once, because they are all visible.
 */
const links = [...document.querySelectorAll('.toc a')];

if (links.length) {
  const byId = new Map();
  for (const link of links) {
    const id = decodeURIComponent(link.hash.slice(1));
    const heading = id && document.getElementById(id);
    if (heading) byId.set(heading, link);
  }

  let current = null;
  const mark = (link) => {
    if (link === current) return;
    current?.classList.remove('here');
    link?.classList.add('here');
    current = link;
  };

  const seen = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) seen.add(entry.target);
      else seen.delete(entry.target);
    }
    // Several headings can share the band on a page of short sections, so take the
    // topmost — the one you have most recently read past.
    const top = [...seen].sort((a, b) => a.offsetTop - b.offsetTop)[0];
    if (top) mark(byId.get(top));
  }, {
    rootMargin: '-64px 0px -70% 0px',
    threshold: 0,
  });

  for (const heading of byId.keys()) observer.observe(heading);
}
