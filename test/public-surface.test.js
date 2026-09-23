/**
 * What goes public, and what must not be in it.
 *
 * Two separate jobs, in one file because they answer one question.
 *
 * **The marker sweep** is the durable half of the internal-reference cleanup. Stripping
 * internal hostnames, shortlinks and ticket keys out of the documentation once is worth
 * very little on its own, because the next page written from a session on a maintainer's
 * machine puts one straight back — the internal link is *right there* in the tab the
 * author is reading. So the rule is a test rather than a review habit, the same way
 * `test/docs.test.js` guards the user/developer split rather than trusting it.
 *
 * **The export manifest check** keeps `.exportignore` honest. That file lists what the
 * clean export leaves behind, and a path that has since been renamed is silently no
 * longer excluded — the worst kind of failure, because the list still *looks* right.
 *
 * Both are cheap: file reads, no build, no network.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DOCS = join(ROOT, 'docs')

/**
 * The internal markers, and what to say when one is found.
 *
 * Deliberately a small list of things that are *unambiguously* internal, rather than a
 * clever one. A false positive here blocks a merge over a word, so every entry has to be
 * something that could not appear in a public document by accident. `atlassian.design`
 * and `atlassian.com` at large are absent on purpose: the public design system and the
 * public marketing site are fine to link.
 */
const MARKERS = [
  [/hello\.atlassian\.net/, 'a link to the internal wiki'],
  [/\.internal\.atlassian\.com/, 'an internal hostname'],
  [/kaizen\.shared|atlassian-3p\.com/, 'an internal deployment hostname'],
  [/packages\.atlassian\.com/, 'the internal npm registry'],
  [/atl-paas\.net/, 'an internal service hostname'],
  [/\bgo\/[a-z][a-z0-9-]*/, 'an internal shortlink'],
  [/\bTRO-\d+/, 'an internal ticket key'],
  [/\.rovodev\//, 'an internal tool\'s working directory'],
  [/\btwg\s+(?:jira|bitbucket|confluence)\b/i, 'an internal CLI'],
]

/**
 * Every file the public repository leads with — the ones a stranger opens first, plus the
 * sidebar — and both documentation sets and the generated site built from them.
 *
 * `existsSync` rather than a bare list because the governance files arrive on their own
 * schedule, and a sweep that crashes when one is absent is a sweep somebody deletes.
 *
 * `NOTICE` is on the list for a sharper reason than the rest. It is the licence carve-out
 * for the brand marks in the scene, so its whole audience is somebody outside Atlassian
 * deciding whether they may redistribute this — the one reader for whom a ticket key is
 * worse than no citation at all. It is not swept by `shippedCodeFiles()` below, which
 * walks source directories: `NOTICE` has no extension to match.
 *
 * `docs/site` is in scope because it is committed and both deploy recipes copy it whole,
 * so a marker there is a marker on a public URL — the same reasoning as
 * `test/docs.test.js`'s unpublished-pages check. It is generated, so a hit there means
 * either a stale build or a marker in the Markdown, and `npm run docs` fixes the first.
 */
async function publicSurfaceFiles() {
  const out = [
    'README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
    'NOTICE', 'THIRD_PARTY_NOTICES.txt',
    'docs/_nav.mjs',
  ].filter((rel) => existsSync(join(ROOT, rel)))
  const unpublished = new Set(
    readFileSync(join(ROOT, '.eleventyignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('docs/') && line.endsWith('.md')),
  )
  const walk = async (dir, keep) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, keep)
      else if (keep(entry.name)) {
        const rel = relative(ROOT, full)
        if (!unpublished.has(rel)) out.push(rel)
      }
    }
  }
  await walk(join(DOCS, 'user'), (name) => name.endsWith('.md'))
  await walk(join(DOCS, 'developer'), (name) => name.endsWith('.md'))
  await walk(join(DOCS, 'site'), (name) => name.endsWith('.html'))
  return out.filter((rel) => !rel.startsWith('docs/developer/design/'))
}

test('the public surface carries no internal reference', async () => {
  const problems = []
  for (const rel of await publicSurfaceFiles()) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    for (const [pattern, what] of MARKERS) {
      const hit = text.match(pattern)
      // One report per marker per file: the fix is per marker, and twenty lines of the
      // same ticket key in one page is one edit, not twenty.
      if (hit) problems.push(`${rel}: ${what} — ${JSON.stringify(hit[0])}`)
    }
  }
  assert.deepEqual(
    problems,
    [],
    'these files reach a public reader and name something only an Atlassian employee '
      + `can resolve. Describe the thing instead of linking it:\n${problems.join('\n')}`,
  )
})

/**
 * Why a skip rather than a failure: these two tests keep `.exportignore` honest, and in a
 * tree with no such file there is no list to be dishonest about. Named so the reason
 * shows up in the runner's output rather than as a silent pass.
 */
function noExportList() {
  return existsSync(join(ROOT, '.exportignore'))
    ? false
    : 'no .exportignore: this is an exported tree, not the repository it was cut from'
}

/**
 * The export exclusion list, one path per line, comments and blanks dropped.
 *
 * **Empty when there is no `.exportignore`, which is the published repository's normal
 * state.** That file is the boundary drawn by the repository the export is cut *from*,
 * so it does not travel — and the two tests below that read it have nothing to check
 * once it is gone. Returning nothing rather than throwing is what lets one suite run in
 * both trees, and it costs no coverage: an empty exclusion list makes
 * `shippedCodeFiles()` sweep *every* file present instead of fewer, so the marker sweep
 * gets stricter in the export, not laxer.
 */
function exportedExclusions() {
  if (!existsSync(join(ROOT, '.exportignore'))) return []
  return readFileSync(join(ROOT, '.exportignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

/**
 * Code and configuration the export carries, and the few things exempt from the sweep.
 *
 * The exemptions are mostly *derived*: anything `.exportignore` drops is out of scope by
 * definition, so adding an entry there removes its exemption here at the same time and
 * nothing has to be remembered twice. That is not a theory — `bitbucket-pipelines.yml`
 * and `test/bitbucket-pipelines.test.js` were named here by hand until the export
 * excluded them, and excluding them is all it took to delete both lines. The remainder
 * are named by hand:
 *
 * - `src/agents/colour-names.js`, which is generated colour data on one very long line.
 *   It legitimately contains "boysenberry pink", and a codename sweep cannot tell that
 *   from a codename;
 * - the two test files that carry the marker patterns themselves, this one included.
 */
const SWEEP_ROOTS = ['src', 'bin', 'lib', 'hooks', 'openclaw-plugin', 'test', 'vendor', 'third-party']
const SWEEP_ROOT_FILES = ['eslint.config.js', 'eleventy.config.mjs', 'styles.css', 'server.cjs', 'kaizen.toml', 'index.html', 'home.html']
const SWEEP_EXTENSIONS = ['.js', '.cjs', '.mjs', '.sh', '.css', '.html', '.json', '.md', '.toml', '.yml']
const SWEEP_EXEMPT = new Set([
  'src/agents/colour-names.js',         // generated colour data: "boysenberry pink"
  'test/docs.test.js',                  // holds the user-docs marker patterns
  'test/public-surface.test.js',        // holds these ones
])

async function shippedCodeFiles() {
  const dropped = exportedExclusions()
  const kept = (rel) => !dropped.some((path) => rel === path || rel.startsWith(`${path}/`))
    && !SWEEP_EXEMPT.has(rel)
  const out = SWEEP_ROOT_FILES.filter((rel) => existsSync(join(ROOT, rel)) && kept(rel))
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const rel = relative(ROOT, full)
      if (!kept(rel)) continue
      if (entry.isDirectory()) await walk(full)
      else if (SWEEP_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(rel)
    }
  }
  for (const dir of SWEEP_ROOTS) {
    if (existsSync(join(ROOT, dir))) await walk(join(ROOT, dir))
  }
  return out
}

test('the code the export ships carries no internal reference', async () => {
  const problems = []
  for (const rel of await shippedCodeFiles()) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    for (const [pattern, what] of MARKERS) {
      const hit = text.match(pattern)
      if (hit) problems.push(`${rel}: ${what} — ${JSON.stringify(hit[0])}`)
    }
  }
  assert.deepEqual(
    problems,
    [],
    'a comment or a string in shipped code names something only an Atlassian employee '
      + 'can resolve. Say what the thing was rather than citing where it is written '
      + `down — a ticket key an outside reader cannot open is worse than no citation:\n${problems.join('\n')}`,
  )
})

test('every path the export excludes still exists', { skip: noExportList() }, () => {
  const gone = exportedExclusions().filter((path) => !existsSync(join(ROOT, path)))
  assert.deepEqual(
    gone,
    [],
    '.exportignore names paths that are not in the repository. A renamed path is a path '
      + 'the export no longer excludes, and the list still looks correct — so fix the '
      + `entry rather than deleting it:\n${gone.join('\n')}`,
  )
})

test('every path the third-party inventory curates still exists', { skip: noExportList() }, () => {
  // `bin/gen-third-party.mjs` treats an absent curated path as "not shipped here", which
  // is what lets the public export regenerate an inventory describing itself. That
  // tolerance would also swallow a rename in this repository, where every curated path
  // *does* exist — so the strict check lives here instead, and runs only in the tree the
  // export is cut from.
  const curated = JSON.parse(readFileSync(join(ROOT, 'third-party/components.json'), 'utf8'))
  const named = [
    ...curated.distributionRecipes,
    ...curated.components.flatMap((item) => [...item.paths, ...item.licenseFiles]),
  ]
  const gone = [...new Set(named)].filter((path) => !existsSync(join(ROOT, path)))
  assert.deepEqual(
    gone,
    [],
    'third-party/components.json curates paths that are not in the repository. A renamed '
      + 'path is a component the inventory silently stops covering, so fix the entry '
      + `rather than deleting it:\n${gone.join('\n')}`,
  )
})

test('the export excludes every unpublished documentation page', { skip: noExportList() }, () => {
  const excluded = new Set(exportedExclusions())
  const unpublished = readFileSync(join(ROOT, '.eleventyignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('docs/') && line.endsWith('.md'))

  // A page held back from the site but shipped in the export is the same document on the
  // same public repository, one click further away. The two lists have to agree, and this
  // is the direction that matters: unpublished implies unexported.
  const missing = unpublished.filter((page) => !excluded.has(page))
  assert.deepEqual(
    missing,
    [],
    'these pages are unpublished in .eleventyignore but would still be copied into the '
      + `public repository. Add them to .exportignore:\n${missing.join('\n')}`,
  )
})
