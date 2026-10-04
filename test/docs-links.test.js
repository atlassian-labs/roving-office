// Where a documentation link lands, which two builds have to agree about.
//
// `eleventy.config.mjs` rewrites `href="…"` in rendered HTML and `bin/gen-docs-markdown.mjs`
// rewrites `[text](…)` in the Markdown copies it publishes. Both ask the same question of
// the same link, so the answer lives in one module — and the answer has been wrong twice,
// which is why it now has tests of its own rather than only the build that uses it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { escapesDocs, repoUrlFor, resolveFromRepo, REPO_BLOB } from '../bin/lib/docs-links.mjs';

test('a link to a sibling page stays inside the documentation', () => {
  for (const [page, target] of [
    ['/user/install.html', '../developer/getting-the-code.md'],
    ['/developer/architecture.html', '../user/watching.md'],
    ['/user/sources/codex.html', '../../developer/adapters/codex.md'],
    ['/user/install.html', '../images/objects/desk.png'],
  ]) {
    assert.equal(escapesDocs(page, target), false, `${page} → ${target}`);
  }
});

test('a link to the code points out of the documentation', () => {
  for (const [page, target, landing] of [
    ['/developer/getting-the-code.html', '../../bin/aop-send.cjs', 'bin/aop-send.cjs'],
    ['/user/sources/codex.html', '../../../AGENTS.md', 'AGENTS.md'],
    ['/developer/architecture.html', '../../src/main.js', 'src/main.js'],
  ]) {
    assert.equal(escapesDocs(page, target), true, `${page} → ${target}`);
    assert.equal(resolveFromRepo(page, target), landing);
    assert.equal(repoUrlFor(page, target), `${REPO_BLOB}/${landing}`);
  }
});

test('an index page is given its URL as a directory, and that is not a level up', () => {
  // The regression this test exists for. Eleventy hands an index page `/developer/`
  // rather than `/developer/index.html`, and taking `dirname` of that moved every link
  // on both index pages up one directory: a sibling page became a repository URL, and
  // `../../CONTRIBUTING.md` — which really does leave the documentation — was left
  // relative and then rewritten to a `.html` page that does not exist.
  assert.equal(resolveFromRepo('/developer/', '../user/index.md'), 'docs/user/index.md');
  assert.equal(escapesDocs('/developer/', '../user/index.md'), false);

  assert.equal(escapesDocs('/developer/', '../../CONTRIBUTING.md'), true);
  assert.equal(repoUrlFor('/developer/', '../../CONTRIBUTING.md'), `${REPO_BLOB}/CONTRIBUTING.md`);

  // Both spellings of the same page must agree, or the HTML and its Markdown copy would
  // rewrite the same link differently.
  for (const target of ['../user/index.md', '../../AGENTS.md', '../architecture.md']) {
    assert.equal(
      escapesDocs('/developer/', target),
      escapesDocs('/developer/index.html', target),
      `the two forms of the developer index disagree about ${target}`,
    );
  }
});

test('a link that doubles back resolves rather than keeping its ../', () => {
  // What CodeQL caught in the implementation this replaced: a single non-global strip of
  // the leading `../` run left `a/../b` in the URL, because the run was not at the front
  // of everything. Resolving the path cannot have that failure mode.
  assert.equal(resolveFromRepo('/developer/x.html', '../a/../b'), 'docs/b');
  assert.ok(!resolveFromRepo('/developer/x.html', '../a/../b').includes('..'));
  assert.equal(resolveFromRepo('/developer/x.html', '../../src/../lib/x.js'), 'lib/x.js');
});

test('a link above the repository root is refused rather than invented', () => {
  // Nothing in the documentation does this today. If one ever did, producing a repository
  // URL for a file that is not in the repository would be the worst of the options.
  assert.equal(escapesDocs('/user/install.html', '../../../../../etc/passwd'), false);
  assert.throws(
    () => repoUrlFor('/user/install.html', '../../../../../etc/passwd'),
    /above the repository root/,
  );
});
