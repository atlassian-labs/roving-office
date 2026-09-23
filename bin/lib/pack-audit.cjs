//
// Does a staged artifact reach outside itself, or import something it forgot to bring?
//
// Both packers ask this, and they ask it for the same reason: their output runs on a
// machine with no checkout above it, and either failure presents identically over
// there — an OpenClaw Gateway or a Claude session logging a module-not-found far from
// here, easy to blame on the host. Cheaper to catch while the staging directory is
// still on this disk, and cheaper still to be told *which* of the two it was.
//
// It lived inside `bin/aop-openclaw-pack.cjs` until `bin/aop-plugin-pack.cjs` needed
// the same walk. Two copies of a check are two answers to one question, and this one
// already earned its keep once: the `from` pattern below exists because a single
// obvious regex missed `import { x } from './y.mjs'` entirely and let a module go
// missing from a shipped artifact.
//
// Findings are returned rather than printed. The packers differ in what they say and
// in how they exit, and neither wants a library writing to its stderr.
//

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Every way a relative specifier can be written.
 *
 * Three patterns rather than one, because the obvious single regex — `import` or
 * `require` followed by a quote — silently misses the form an ES module is almost
 * entirely made of: in `import { x } from './y.mjs'` the quote is nowhere near the
 * `import`. The `from` pattern covers `export … from` too.
 *
 * A computed specifier — `require(\`./mappers/${harness}.cjs\`)` — matches none of
 * them, and deliberately: there is no static answer to give, so the staging list is
 * what has to be right and `--verify` is what proves it.
 */
const SPECIFIERS = [
  /(?:^|[^\w$.])(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g,   // require('x'), import('x')
  /(?:^|[^\w$.])from\s*['"]([^'"]+)['"]/g,                      // import … from 'x'
  /(?:^|[^\w$.])import\s+['"]([^'"]+)['"]/g,                    // import 'x', for effect
];

/**
 * Does this specifier land on a file that is actually in the artifact?
 *
 * ESM wants the exact filename, so the literal path is the answer nearly always; the
 * extension and `index` guesses are here only for CommonJS, which may be required
 * without one.
 */
function resolves(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  const tries = [base];
  for (const ext of ['.mjs', '.cjs', '.js', '.json']) {
    tries.push(base + ext, path.join(base, `index${ext}`));
  }
  return tries.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

/**
 * Walk a staged tree and collect both failures.
 *
 * @param {string} dir  the artifact root; nothing above it may be reached
 * @returns {{escapes: string[], missing: string[]}}  each entry `file -> specifier`
 */
function auditTree(dir) {
  const escapes = [];
  const missing = [];
  const root = path.resolve(dir);

  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(mjs|cjs|js)$/.test(entry.name)) continue;
      const rel = path.relative(root, full);
      const body = fs.readFileSync(full, 'utf8');
      for (const pattern of SPECIFIERS) {
        for (const m of body.matchAll(pattern)) {
          const spec = m[1];
          if (!spec.startsWith('.')) continue;                   // node: builtins, bare ids
          const resolved = path.resolve(path.dirname(full), spec);
          if (!resolved.startsWith(root)) { escapes.push(`${rel} -> ${spec}`); continue; }
          if (!resolves(full, spec)) missing.push(`${rel} -> ${spec}`);
        }
      }
    }
  };

  walk(root);
  return { escapes, missing };
}

module.exports = { SPECIFIERS, auditTree, resolves };
