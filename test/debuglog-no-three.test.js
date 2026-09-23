// The debug log must never reach three.js.
//
// debuglog.html carries no import map, deliberately: it answers "what is actually
// arriving?" on a machine where the room is too slow, too dark or too broken to
// read, so it draws no scene and opens no WebGL context. A bare `import 'three'`
// anywhere in its module graph is therefore not a heavier page — it is a blank
// one, because the browser cannot resolve the specifier and refuses the whole
// graph.
//
// Nothing else catches it. Node resolves `three` out of node_modules quite
// happily, so every unit test over these modules keeps passing while the page is
// dead; and the page renders from a live feed, so a screenshot at load looks
// plausibly empty. It has been broken exactly this way once, by src/ui/marks.js
// picking up the Rovo mark's polygons from src/scene/standees.js — which is why
// those polygons now live in src/rovo-mark.js, importing nothing.
//
// So this walks the real graph from the page's own entry point and reads the
// import statements, rather than trusting anyone to remember.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** The entry point debuglog.html loads, as the page's own `<script src>` gives it. */
const ENTRY = 'src/debug/debuglog.js';

/**
 * Comments out, so prose cannot look like code.
 *
 * Two things in this tree read exactly like an import to a regex and are not one:
 * a sentence such as `distinguish "no agents right now" from "nothing is
 * connected"`, and a JSDoc `@param {import('../agents/Agent.js').Agent}` — the
 * second especially, because following it would walk the whole scene graph and
 * report three.js as a dependency of the debug log.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Not `://`, so a URL inside a string survives.
    .replace(/(^|[^:'"\w])\/\/.*$/gm, '$1');
}

/** Every module specifier a module actually imports, static, re-exported or dynamic. */
function specifiersIn(source) {
  const code = stripComments(source);
  const patterns = [
    // `import x from 'y'`, `import {a, b} from 'y'` over several lines, `export … from 'y'`.
    // `[^;]` rather than `[\s\S]` so an unrelated `from` argument cannot make the
    // match run on into the next statement.
    /\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
    /^[ \t]*import\s*['"]([^'"\n]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((re) => [...code.matchAll(re)].map((m) => m[1]));
}

/**
 * Every module reachable from `entry`, keyed by repo-relative path, plus the bare
 * specifiers found along the way — those are the ones an import map has to answer.
 */
function walk(entry) {
  const seen = new Set();
  /** @type {Array<{from: string, specifier: string}>} */
  const bare = [];
  const queue = [entry];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const specifier of specifiersIn(source)) {
      if (specifier.startsWith('.')) {
        queue.push(path.normalize(path.join(path.dirname(rel), specifier)));
      } else if (specifier.startsWith('/')) {
        queue.push(specifier.slice(1));
      } else {
        bare.push({ from: rel, specifier });
      }
    }
  }
  return { modules: seen, bare };
}

test('debuglog.html loads no module that imports a bare specifier', () => {
  const { modules, bare } = walk(ENTRY);
  // Sanity: the walk actually found the graph rather than one file.
  assert.ok(modules.size > 5, `expected a real module graph, walked ${modules.size}`);
  assert.ok(modules.has('src/ui/marks.js'), 'the log draws source marks, so marks.js is in the graph');
  assert.deepEqual(
    bare,
    [],
    'debuglog.html has no import map, so a bare specifier here is an unresolvable module and a blank page: '
      + bare.map(({ from, specifier }) => `${from} imports "${specifier}"`).join(', '),
  );
});

test('the Rovo mark artwork imports nothing at all', () => {
  // One copy of the polygons feeds both the standee (which needs three) and the
  // picker tile (which must not), so the shared module has to stay a leaf.
  const source = fs.readFileSync(path.join(ROOT, 'src/rovo-mark.js'), 'utf8');
  assert.deepEqual(specifiersIn(source), []);
});
