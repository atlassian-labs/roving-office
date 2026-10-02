/**
 * The documentation's own tests.
 *
 * CI carries one rule and it governs everything: a job runs what a contributor runs
 * locally, by the same npm scripts, and nothing a contributor cannot run. So rather than
 * adding a CI step for the documentation, these checks live in `npm test` — which CI
 * already runs, and which you already run.
 *
 * They are all cheap: no Eleventy, no browser, no network. What they buy is that the three
 * things most likely to rot quietly — the generated script reference, the committed HTML,
 * and the sidebar — cannot rot without going red.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { allPages, NAV } from '../docs/_nav.mjs'
import { checkDocLinks, formatProblems } from '../bin/lib/check-doc-links.mjs'
import toolClasses from '../bin/mappers/lib/tool-classes.cjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const DOCS = join(ROOT, 'docs')
const SITE = join(DOCS, 'site')

/**
 * The Markdown that lives under `docs/` but is deliberately never published.
 *
 * Read out of `.eleventyignore` rather than listed again here, because two lists would
 * drift and the failure when they did would be a page quietly back on the public web.
 * That file is the boundary; this reads it. See its own comment for why the set exists —
 * internal deployment runbooks being served from a public URL.
 *
 * Only exact `.md` paths are understood. The other entries in that file are globs and
 * directories about the build itself (`docs/site`, `docs/images`), and none of them names
 * a documentation page, so there is nothing to match them against.
 */
function unpublishedPages() {
  return new Set(
    readFileSync(join(ROOT, '.eleventyignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('docs/') && line.endsWith('.md'))
      .map((line) => line.slice('docs/'.length)),
  )
}

/** Every Markdown page in the two published sets, as a docs-relative path. */
async function markdownPages() {
  const unpublished = unpublishedPages()
  const out = []
  for (const set of ['user', 'developer']) {
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.name.endsWith('.md')) {
          const rel = relative(DOCS, full)
          if (!unpublished.has(rel)) out.push(rel)
        }
      }
    }
    await walk(join(DOCS, set))
  }
  return out.sort()
}

test('the npm script reference matches package.json', () => {
  const result = spawnSync('node', ['bin/gen-npm-scripts.mjs', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(
    result.status,
    0,
    `docs/developer/npm-scripts.md is stale. Run \`npm run docs\`.\n${result.stderr}`,
  )
})

test('every script has a description, and every description has a script', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const scripts = Object.keys(pkg.scripts ?? {})
  const documented = Object.keys(pkg.scriptDocs ?? {})

  // Stated as two set differences rather than one deep-equal, because the failure message
  // is the whole value of this test: "you added `plan:sweep` and did not say what it does"
  // is actionable, and a diff of two forty-item arrays is not.
  assert.deepEqual(
    scripts.filter((name) => !documented.includes(name)),
    [],
    'these scripts need a scriptDocs entry in package.json',
  )
  assert.deepEqual(
    documented.filter((name) => !scripts.includes(name)),
    [],
    'these scriptDocs entries name a script that no longer exists',
  )
})

test('every documentation page has been built into docs/site', async () => {
  const missing = []
  for (const page of await markdownPages()) {
    const html = join(SITE, page.replace(/\.md$/, '.html'))
    if (!existsSync(html)) missing.push(page)
  }
  assert.deepEqual(
    missing,
    [],
    'these pages have no built HTML. Run `npm run docs`.',
  )
})

test('docs/site holds no page whose Markdown has gone', async () => {
  const pages = new Set(
    (await markdownPages()).map((page) => page.replace(/\.md$/, '.html')),
  )
  const orphans = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.html')) {
        const rel = relative(SITE, full)
        if (!pages.has(rel)) orphans.push(rel)
      }
    }
  }
  for (const set of ['user', 'developer']) {
    const dir = join(SITE, set)
    if (existsSync(dir)) await walk(dir)
  }
  assert.deepEqual(
    orphans,
    [],
    'these built pages have no Markdown source. Delete them, or `rm -rf docs/site && npm run docs`.',
  )
})

test('the unpublished pages have not been built, and so cannot be served', () => {
  // The check this exists for. `docs/site` is committed and both deploy recipes copy
  // it wholesale, so a built page *is* a published page — there is no separate step
  // between Eleventy writing a file and a stranger reading it on the public site. The
  // sources stay in the repository; the HTML must not come back.
  const published = []
  for (const page of unpublishedPages()) {
    const html = join(SITE, page.replace(/\.md$/, '.html'))
    if (existsSync(html)) published.push(relative(ROOT, html))
  }
  assert.deepEqual(
    published,
    [],
    'these pages are listed as unpublished in .eleventyignore but have built HTML, '
      + 'which both deploy recipes would ship. Delete them.',
  )
})

test('the sidebar and the Markdown agree, in both directions', async () => {
  const onDisk = (await markdownPages()).map((page) => `/${page.replace(/\.md$/, '.html')}`)
  const inNav = allPages().map((page) => page.url)

  assert.deepEqual(
    onDisk.filter((url) => !inNav.includes(url)),
    [],
    'these pages are not in docs/_nav.mjs, so nothing links to them',
  )
  assert.deepEqual(
    inNav.filter((url) => !onDisk.includes(url)),
    [],
    'docs/_nav.mjs lists these pages, but they do not exist',
  )
})

test('the llms.txt index matches the sidebar', () => {
  const result = spawnSync('node', ['bin/gen-llms-txt.mjs', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(
    result.status,
    0,
    `docs/site/llms.txt is stale. Run \`npm run docs\`.\n${result.stderr}`,
  )
})

test('llms.txt lists every published page, and nothing unpublished', () => {
  const index = readFileSync(join(SITE, 'llms.txt'), 'utf8')

  // The point of generating it: a new page appears here without anybody remembering to
  // add it. Asserted against the sidebar rather than against a count, so the failure
  // names the page instead of a number that moved.
  const missing = allPages().filter((page) => !index.includes(`/docs${page.url})`))
  assert.deepEqual(
    missing.map((page) => page.url),
    [],
    'these pages are in the sidebar but not in llms.txt',
  )

  // And the half that matters more, for the reason the test above it gives: an index
  // that advertises a runbook has published it just as surely as building the HTML
  // would have. The generator throws rather than skipping if the two lists ever
  // disagree; this checks the output in case it is ever written another way.
  for (const page of unpublishedPages()) {
    const url = `/docs/${page.replace(/\.md$/, '.html')}`
    assert.ok(!index.includes(url), `llms.txt advertises the unpublished ${page}`)
  }
})

test('llms.txt tells an agent how to set itself up, before anything else', () => {
  const index = readFileSync(join(SITE, 'llms.txt'), 'utf8')
  const prompt = readFileSync(join(ROOT, 'agent-setup/prompt.md'), 'utf8')

  // Whoever reads this file is more likely than not to be the reader that section is
  // for, so it comes before either documentation set.
  const agents = index.indexOf('## For agents')
  assert.ok(agents > 0, 'llms.txt has no section for agents')
  for (const heading of ['## For everyone', '## For developers']) {
    assert.ok(agents < index.indexOf(heading), `${heading} should come after For agents`)
  }

  // The authoritative document, linked rather than paraphrased.
  assert.ok(
    index.includes('/agent-setup/prompt.md'),
    'llms.txt does not link the one document written for an agent',
  )

  // The summary in llms.txt is a summary, so the route it names has to be the route the
  // prompt actually uses — otherwise an agent that reads only the index mints nothing.
  assert.ok(
    index.includes('POST https://therovingoffice.com/api/offices'),
    'llms.txt does not name the mint route',
  )
  assert.ok(
    prompt.includes('-X POST https://therovingoffice.com/api/offices'),
    'the prompt mints from a different route than llms.txt advertises',
  )

  // The one instruction the prompt is most insistent about. An index that said "set
  // yourself up" and left this out would be undercutting it.
  assert.match(
    index.slice(agents, index.indexOf('## For everyone')),
    /ask the user first/i,
    'the agent section omits the consent step the prompt requires',
  )
})

test('the agent setup page is reachable from both sidebars', () => {
  // It was published and listed nowhere: reachable only from a link in the body of one
  // page, or by already knowing the URL. A page nothing navigates to is the orphan
  // docs/_nav.mjs exists to prevent, and it does not have to be Markdown to count.
  for (const section of ['user', 'developer']) {
    const entries = NAV[section]
      .flatMap((group) => group.pages)
      .filter((page) => page.url === '/agent-setup/')
    assert.equal(entries.length, 1, `/agent-setup/ is not in the ${section} sidebar`)
    // `site` is what stops Eleventy's url filter turning this into /docs/agent-setup/.
    assert.ok(entries[0].site, `/agent-setup/ in the ${section} sidebar needs site: true`)
    assert.ok(entries[0].external, `/agent-setup/ has no Markdown, so it is external`)
  }
})

test('llms.txt is shaped the way the convention expects', () => {
  const lines = readFileSync(join(SITE, 'llms.txt'), 'utf8').split('\n')

  // https://llmstxt.org/ — an H1 with the project name, then a blockquote summary. The
  // H1 is the only required element, and the blockquote is what makes the file readable
  // without following a single link, so both are worth holding.
  assert.match(lines[0], /^# \S/, 'opens with an H1 naming the project')
  assert.ok(
    lines.slice(0, 6).some((line) => line.startsWith('> ')),
    'carries a blockquote summary near the top',
  )
  assert.ok(
    lines.some((line) => line === '## Optional'),
    'uses the Optional heading the convention reserves for what can be skipped',
  )
  // Every link absolute: a model handed this file has no base to resolve against.
  const relative_ = lines.filter((line) => /^- \[[^\]]*\]\((?!https:\/\/)/.test(line))
  assert.deepEqual(relative_, [], 'these links are not absolute URLs')
})

test('the deploy recipe ships the built docs and the imagery', () => {
  const docker = readFileSync(join(ROOT, 'Dockerfile.fly'), 'utf8')
  const ignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8')

  // There is one deploy target now, which is why this reads as a plain assertion. It
  // used to guard two against drifting apart — a /docs that worked on one host and 404d
  // on the other, where only the second ever got noticed.
  assert.match(docker, /^COPY docs\/site \.\/docs\/site$/m)
  assert.match(docker, /^COPY docs\/images \.\/docs\/images$/m)


  // `docs` is excluded wholesale, so the exceptions are what actually let these through.
  assert.match(ignore, /^!docs\/site$/m)
  assert.match(ignore, /^!docs\/site\/\*\*$/m)
  assert.match(ignore, /^!docs\/images$/m)
  assert.match(ignore, /^!docs\/images\/\*\*$/m)
})

test('every internal documentation link resolves', () => {
  // The same check `npm run docs` runs, from the same function — see
  // bin/lib/check-doc-links.mjs. Not redundant with the build: Eleventy writes its files
  // *before* the `eleventy.after` hook fires, so a build that failed on a broken link
  // still leaves output on disk that somebody could commit. This is what stops that
  // reaching main, and it costs nothing — it is file reads over about seven hundred links.
  const problems = checkDocLinks({ repoDir: ROOT })
  assert.deepEqual(
    problems,
    [],
    `broken documentation links:\n${formatProblems(problems)}`,
  )
})

test('both privacy pages describe every category of target the code sends', () => {
  // How the last redaction defect survived: the code and the promise were two
  // independent statements, and only one of them was tested. `tool.start.target` sent a
  // Grep pattern and a whole URL at the default mode while both pages said no free text
  // travelled there — and no test compared them.
  //
  // So `TARGET_KINDS` in mappers/lib/tool-classes.cjs is the source of truth for both,
  // and each category carries the marker of the row that promises it. Checked in both
  // directions, which is the same idiom as the npm script reference above: a new
  // category is red until the pages describe it, and a marker for a category the code
  // no longer has is red too, so the rows cannot rot into decoration.
  //
  // Asserted rather than generated, deliberately. The user table's value is in prose a
  // generator would destroy — "shortened is not hidden" is the sentence that makes the
  // page honest, and no generator writes it. What can be mechanised is that a row
  // *exists* for everything the code sends, which is the case that actually bit.
  const markers = [...new Set(Object.values(toolClasses.TARGET_KINDS).map((k) => k.doc))].sort()
  const pages = ['user/connect-your-agents.md', 'developer/protocol/aop-spec.md']

  for (const page of pages) {
    const text = readFileSync(join(DOCS, page), 'utf8')
    const found = [...new Set(
      [...text.matchAll(/<!--\s*redaction:([a-z-]+)\s*-->/g)].map((m) => m[1]),
    )].sort()
    assert.deepEqual(
      markers.filter((marker) => !found.includes(marker)),
      [],
      `${page} does not say what these categories of tool target send. `
        + 'Add a row, and mark it `<!-- redaction:<category> -->`.',
    )
    assert.deepEqual(
      found.filter((marker) => !markers.includes(marker)),
      [],
      `${page} promises something about these categories, and TARGET_KINDS has no such category`,
    )
  }
})

test('the user documentation gives nothing away about the checkout', async () => {
  // The whole point of the split: a reader with a download and a browser should never be
  // shown a source path, a test command, a ticket number as rationale, or an internal
  // hostname. Prose only — fenced code blocks are exempt, since a few user pages
  // legitimately show an `npm run connect:` command or a settings file.
  const forbidden = [
    [/\bsrc\/[a-z]/i, 'a source path'],
    [/\bnpm (?:test|run lint|ci)\b/, 'a developer command'],
    [/\bTRO-\d+/, 'a ticket number'],
    [/kaizen\.shared|atlassian-3p|fly\.dev|\.internal\.atlassian/, 'an internal hostname'],
  ]
  const problems = []

  for (const page of (await markdownPages()).filter((p) => p.startsWith('user/'))) {
    const text = readFileSync(join(DOCS, page), 'utf8')
    const prose = text
      .replace(/```[\s\S]*?```/g, '')       // fenced code
      .replace(/`[^`\n]*`/g, '')            // inline code
      .replace(/\]\([^)]*\)/g, '')          // link targets
      .replace(/<img[^>]*>/g, '')           // image tags
    for (const [pattern, what] of forbidden) {
      const hit = prose.match(pattern)
      if (hit) problems.push(`${page}: ${what} — ${JSON.stringify(hit[0])}`)
    }
  }

  assert.deepEqual(problems, [], `user docs leaked developer detail:\n${problems.join('\n')}`)
})
