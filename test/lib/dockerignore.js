/**
 * What a `docker build` would upload, and what a `COPY` would take out of it.
 *
 * A transcription of moby/patternmatcher and the walk around it, which is what both the
 * classic builder and BuildKit use to read `.dockerignore`. The rules are deliberately not
 * gitignore's: patterns are anchored at the context root (so `test` means the top-level
 * `test`, not every directory of that name), `*` does not cross a `/`, `**` does, and the
 * last pattern to match a path decides.
 *
 * The walk is the part that matching paths one at a time cannot replace, and it is the part
 * that has cost this project a deployment — see test/docker-context.test.js.
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Enough of Go's filepath.Clean for the shapes a pattern can take. */
export function clean (pattern) {
  const parts = []
  for (const part of pattern.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') { parts.pop(); continue }
    parts.push(part)
  }
  return parts.length === 0 ? '.' : parts.join('/')
}

/** One pattern as a whole-string regexp, per patternmatcher's compile(). */
export function toRegExp (pattern) {
  let out = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      i += 1
      if (pattern[i + 1] === '/') i += 1
      // `**` at the end takes everything below it; in the middle it takes any number of
      // path segments, including none.
      out += i + 1 >= pattern.length ? '.*' : '(.*/)?'
    } else if (ch === '*') {
      out += '[^/]*'
    } else if (ch === '?') {
      out += '[^/]'
    } else if ('.+()|{}$'.includes(ch)) {
      out += `\\${ch}`
    } else if (ch === '\\') {
      out += i + 1 < pattern.length ? `\\${pattern[i += 1]}` : '\\\\'
    } else if (ch === '[' && pattern[i + 1] === '!') {
      out += '[^'
      i += 1
    } else {
      out += ch
    }
  }
  return new RegExp(`${out}$`)
}

/** The contents of a `.dockerignore` as patterns. */
export function parseIgnoreFile (text) {
  const patterns = []
  for (const line of text.split('\n')) {
    // The comment test is on the raw line, before trimming, exactly as Docker reads it.
    if (line.startsWith('#')) continue
    let pattern = line.trim()
    if (pattern === '') continue
    const exception = pattern.startsWith('!')
    if (exception) pattern = pattern.slice(1).trim()
    pattern = clean(pattern)
    patterns.push({ text: pattern, exception, re: toRegExp(pattern) })
  }
  return patterns
}

function ancestors (path) {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

/**
 * Whether a path is excluded from the upload — patternmatcher's MatchesOrParentMatches.
 *
 * Patterns are read in order and each is only consulted when it could change the answer: a
 * plain pattern while the path is still included, a `!` exception while it is excluded. A
 * pattern matches the path itself or any of its parent directories, which is how a bare
 * `docs` excludes everything beneath it.
 */
export function isExcluded (patterns, path) {
  let excluded = false
  const parents = ancestors(path)
  for (const pattern of patterns) {
    if (pattern.exception !== excluded) continue
    if (pattern.re.test(path) || parents.some((parent) => pattern.re.test(parent))) {
      excluded = !pattern.exception
    }
  }
  return excluded
}

/**
 * The files the builder would receive.
 *
 * An excluded directory is skipped whole, and the only thing that saves it is an exception
 * pattern whose *text* starts with that directory: `!docs/site/**` keeps the walk
 * descending into `docs`, while `!site/**` would not, and every level below has to earn its
 * own reprieve the same way.
 *
 * Directories are not collected, only files: an image needs the files, and Docker creates
 * the directories on the way to them.
 */
export function uploadedFiles (patterns, root) {
  const hasExceptions = patterns.some((pattern) => pattern.exception)
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir === '' ? root : join(root, dir), { withFileTypes: true })) {
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`
      // filepath.Walk does not follow symlinks, so a link to a directory counts as a file.
      const isDir = entry.isDirectory()
      if (isExcluded(patterns, path)) {
        if (!isDir || !hasExceptions) continue
        const reprieved = patterns.some(
          (pattern) => pattern.exception && `${pattern.text}/`.startsWith(`${path}/`))
        if (reprieved) walk(path)
        continue
      }
      if (isDir) walk(path)
      else files.push(path)
    }
  }
  walk('')
  return files
}

/** The source arguments of every COPY in a Dockerfile that reads the build context. */
export function copySources (dockerfile) {
  const sources = []
  for (const line of dockerfile.replace(/\\\n/g, ' ').split('\n')) {
    const copy = /^\s*COPY\s+(.+)$/i.exec(line)
    if (!copy) continue
    const args = copy[1].trim().split(/\s+/)
    // `--from=` copies from another stage or image rather than the context, so
    // `.dockerignore` has nothing to say about it.
    if (args.some((arg) => arg.startsWith('--from='))) continue
    sources.push(...args.filter((arg) => !arg.startsWith('--')).slice(0, -1))
  }
  return sources
}

/** Every file in the checkout that one COPY source would pick up. */
export function filesForSource (root, source) {
  const pattern = clean(source)
  if (pattern.includes('**')) {
    throw new Error(`\`**\` in a COPY source is not modelled here: ${source}`)
  }
  // Walk the pattern a segment at a time, so a glob at the front costs one readdir rather
  // than a walk of the whole tree.
  let matched = ['']
  for (const segment of pattern.split('/')) {
    const re = toRegExp(segment)
    const next = []
    for (const dir of matched) {
      if (dir !== '' && !statSync(join(root, dir)).isDirectory()) continue
      for (const name of readdirSync(dir === '' ? root : join(root, dir))) {
        if (re.test(name)) next.push(dir === '' ? name : `${dir}/${name}`)
      }
    }
    matched = next
  }
  // A matched directory is copied whole, as `COPY docs/images ./docs/images` relies on.
  const filesUnder = (dir) => readdirSync(join(root, dir), { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))
  return matched.flatMap((path) => (statSync(join(root, path)).isDirectory() ? filesUnder(path) : [path]))
}
