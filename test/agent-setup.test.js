/**
 * The published setup instructions, and the four ways they can quietly stop being true.
 *
 * `agent-setup/prompt.md` is fetched by an agent and executed with shell access, which
 * makes a stale command in it a different class of problem from a stale sentence in a
 * documentation page. Nobody reviews it at the moment it rots: it rots when a harness is
 * added, a connect script is renamed, or a route moves — none of which look like they
 * touch this file. So the drift is a test rather than a habit.
 *
 * What this cannot check: whether the instructions *work*. That needs a real harness and
 * a real office, and the honest answer is that a person has to paste the line into an
 * agent and watch. These four checks only ensure the document is not describing a
 * codebase that no longer exists.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const PROMPT = readFileSync(join(ROOT, 'agent-setup/prompt.md'), 'utf8')
const PAGE = readFileSync(join(ROOT, 'agent-setup/index.html'), 'utf8')
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const SERVER = readFileSync(join(ROOT, 'server.cjs'), 'utf8')

test('the prompt names every harness the project actually adapts', () => {
  // `connect:<harness>` is the list of things this project can connect, by definition —
  // it is what a contributor adds when they write an adapter. A harness with a connect
  // script and no mention in the prompt is a harness the published instructions cannot
  // set up, which is the failure this exists to catch.
  const harnesses = Object.keys(PACKAGE.scripts)
    .map((name) => /^connect:([a-z]+)$/.exec(name)?.[1])
    .filter((name) => name && name !== 'remote')

  assert.ok(harnesses.length >= 5, `expected the five adapters, found ${harnesses.join(', ')}`)

  const missing = harnesses.filter((harness) => !PROMPT.includes(`connect:${harness}`)
    // Claude Code installs from the published marketplace rather than a connect script,
    // so the prompt names the plugin route instead. Either mention counts.
    && !(harness === 'claude' && PROMPT.includes('plugin install roving-office')))

  assert.deepEqual(
    missing,
    [],
    'agent-setup/prompt.md does not tell an agent how to set up these harnesses, so the '
      + `published instructions cannot install them:\n${missing.join('\n')}`,
  )
})

test('every command the prompt tells an agent to run exists', () => {
  // A renamed npm script is the most likely drift and the least visible: the prompt still
  // reads correctly, and the agent runs a command that does not exist.
  const cited = [...PROMPT.matchAll(/npm run ([a-z:]+)/g)].map((m) => m[1])
  assert.ok(cited.length > 0, 'expected the prompt to cite npm scripts')

  const unknown = [...new Set(cited)].filter((name) => {
    if (PACKAGE.scripts[name]) return false
    // `connect:codex:status` is cited as a pattern — the `:status` twin of whichever
    // harness was installed — so a cited name also passes if it is a real twin.
    return !PACKAGE.scripts[name.replace(/:status$/, '')]
  })

  assert.deepEqual(
    unknown,
    [],
    `agent-setup/prompt.md tells an agent to run npm scripts that package.json does not `
      + `define:\n${unknown.join('\n')}`,
  )
})

test('the routes the prompt and the page depend on are still served', () => {
  // The prompt tells an agent that it is authoritative at a URL, and mints an office at
  // another. Both are this server's routes; if one moves, the instructions send an agent
  // somewhere that answers 404 while still reading as correct.
  assert.match(SERVER, /'\/api\/offices'/, 'the mint route the prompt POSTs to has moved')
  assert.match(
    SERVER,
    /urlPath === '\/agent-setup'/,
    'the /agent-setup index mapping has gone, so the page the prompt names 404s',
  )
  assert.match(
    SERVER,
    /'\.md': 'text\/markdown/,
    'prompt.md would be served without a text content type, which some clients download '
      + 'rather than read',
  )

  // The console cannot be configured onto a path this server already serves, and
  // /agent-setup is now one of them.
  assert.match(SERVER, /'\/admin', '\/agent-setup'/, '/agent-setup is not a reserved console path')
})

test('the page and the prompt agree on the one line a user pastes', () => {
  // The landing page's whole job is to hand over one sentence. If it names a different
  // URL from the one the prompt claims as its home, somebody ends up executing a copy
  // from a place the document itself says not to trust.
  const HOME = 'https://therovingoffice.com/agent-setup/prompt.md'
  assert.ok(PROMPT.includes(HOME), 'the prompt does not state where it is published')
  assert.ok(PAGE.includes(HOME), 'the page does not hand over the published URL')

  // And the consent step is the one instruction that must not be quietly dropped: it is
  // the difference between this and a document that publishes somebody's repository name
  // without asking.
  assert.match(
    PROMPT,
    /must not do silently/,
    'the prompt has lost the instruction that makes the consent step non-optional',
  )
})
