import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  copySources, filesForSource, isExcluded, parseIgnoreFile, uploadedFiles,
} from './lib/dockerignore.js'

/**
 * Dockerfile.fly and .dockerignore, read against each other.
 *
 * The two files can disagree in silence. `.dockerignore` decides what is uploaded to the
 * builder and `Dockerfile.fly` decides what is copied out of that upload, so a pattern that
 * excludes one path too many produces a build that succeeds and an image with a hole in it.
 * The hole it produced once was the documentation: an exception has to name every directory
 * level it descends through, because a directory that stays excluded is never walked into,
 * and the version that got that wrong was "a deployed office whose documentation is entirely
 * 404, and nothing local says so" — the comment in `.dockerignore` is that lesson, and this
 * is the same lesson as a failing test rather than a deploy.
 *
 * Only the Fly build reads `.dockerignore`. Nothing else
 * not consult it, and is checked by the tests that read it.
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

/**
 * The holes inside a copied directory that are there on purpose.
 *
 * `COPY plugins` takes the published marketplace, and `.dockerignore` drops the Codex half
 * of it — a Git repository's worth of files waiting for a Git repository, which nothing
 * serves. That is a decision rather than an accident, so it is named here as well as
 * commented in both files.
 */
const DELIBERATE_HOLES = ['plugins/codex']

const patterns = parseIgnoreFile(read('.dockerignore'))
const sources = copySources(read('Dockerfile.fly'))
const uploaded = new Set(uploadedFiles(patterns, root))
const deliberate = (path) => DELIBERATE_HOLES.some((hole) => path === hole || path.startsWith(`${hole}/`))

test('every path Dockerfile.fly copies survives .dockerignore', () => {
  assert.ok(sources.length > 10, 'the COPY lines were parsed out of Dockerfile.fly')
  for (const source of sources) {
    const wanted = filesForSource(root, source).filter((path) => !deliberate(path))
    // A COPY that matches nothing is the other half of the same failure: `COPY docs/*.html`
    // exists so that a new page ships by existing, and a renamed directory would leave this
    // line copying air. Docker errors on a literal path with no match, but says nothing
    // about a glob.
    assert.ok(wanted.length > 0,
      `COPY ${source} matches nothing in the checkout — the path has moved or been renamed`)
    const missing = wanted.filter((path) => !uploaded.has(path))
    assert.deepEqual(missing, [],
      `.dockerignore excludes ${missing.length} file(s) that \`COPY ${source}\` needs, so the `
        + 'built image would have a hole in it and the build would not say so. An exception has '
        + 'to name every level it descends through — or, if the hole is meant, name it in '
        + `DELIBERATE_HOLES above:\n  ${missing.slice(0, 10).join('\n  ')}`)
  }
})

test('nothing tracked is uploaded that no COPY line takes', () => {
  // The consistency the list is kept for. `.dockerignore` cannot break the image by leaving
  // something out — Dockerfile.fly copies named paths and never `. .` — so nothing but a
  // test notices when the list stops matching the recipe, which is how `test` sat in the
  // upload while `bin` and `hooks` beside it were excluded for being unused.
  //
  // Tracked files only: a scratch file in a working tree is nobody's inconsistency.
  const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean))
  const copied = new Set(sources.flatMap((source) => filesForSource(root, source)))
  const spare = [...uploaded].filter((path) => tracked.has(path) && !copied.has(path)).sort()
  assert.deepEqual(spare, [],
    `${spare.length} tracked file(s) are uploaded to the builder and then copied by nothing. `
      + 'Either add a COPY for them or exclude them in .dockerignore, in the group that says '
      + `why they are out:\n  ${spare.slice(0, 20).join('\n  ')}`)
})

test('the ignore rules these tests model are the ones Docker applies', (t) => {
  // The two tests above are only worth their runtime if the model is right, and the
  // interesting cases are all about exceptions under an excluded parent.
  const excluded = (lines, path) => isExcluded(parseIgnoreFile(lines.join('\n')), path)

  // Anchored at the context root, unlike gitignore: a bare name is the top-level one.
  assert.equal(excluded(['test'], 'test/layout.test.js'), true)
  assert.equal(excluded(['test'], 'src/test/layout.test.js'), false)
  assert.equal(excluded(['docs'], 'docs/user/the-room.md'), true)

  // An exception re-includes, and the last pattern to match decides.
  assert.equal(excluded(['docs', '!docs/*.html'], 'docs/office-seeds.html'), false)
  assert.equal(excluded(['docs', '!docs/*.html'], 'docs/user/the-room.md'), true)
  assert.equal(excluded(['docs', '!docs/site', '!docs/site/**'], 'docs/site/index.html'), false)
  assert.equal(excluded(['*.md', '!README.md'], 'README.md'), false)
  assert.equal(excluded(['!README.md', '*.md'], 'README.md'), true)

  // `*` stops at a separator; `**` does not.
  assert.equal(excluded(['docs/*'], 'docs/site/index.html'), true, 'the parent matches')
  assert.equal(excluded(['docs/*.html'], 'docs/site/index.html'), false)
  assert.equal(excluded(['docs/**/*.html'], 'docs/site/developer/index.html'), true)

  // Comments and blank lines are not patterns, and `#` is only a comment in column one.
  assert.equal(excluded(['# docs', ''], 'docs/user/the-room.md'), false)

  // And the incident itself, which only the walk can show: an exception that does not name
  // the directory it sits under leaves that directory unwalked, so the file it names is
  // never reached and the pattern that would have saved it is never consulted. Both of these
  // `!` patterns match the path on their own; only one of them ships it.
  const fixture = mkdtempSync(join(tmpdir(), 'rovo-docker-context-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  mkdirSync(join(fixture, 'docs/site'), { recursive: true })
  writeFileSync(join(fixture, 'docs/site/index.html'), '')
  const ships = (lines) =>
    uploadedFiles(parseIgnoreFile(lines.join('\n')), fixture).includes('docs/site/index.html')
  assert.equal(ships(['docs', '!docs/site', '!docs/site/*']), true)
  assert.equal(ships(['docs', '!site', '!site/*']), false)
})
