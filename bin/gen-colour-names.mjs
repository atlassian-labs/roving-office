#!/usr/bin/env node
/**
 * Regenerate `src/agents/colour-names.js` — the table that turns a written colour into a
 * colour.
 *
 * An agent describing itself does not write hex. It writes `Rich red / crimson`, or
 * `Warm library yellow / marigold`, and CSS knows neither. What does know them, to a
 * frankly unreasonable degree, is **color-name-list** (MIT): 31,915 names aggregated
 * from the xkcd colour survey, Crayola, Pantone-ish lists and the rest, which between
 * them contain `rich red`, `field green`, `pitch green`, `tangerine`, `marigold`,
 * `golden orange`, `stormy sea`, `oxblood` and `burnt sienna` as literal entries.
 *
 * The whole list is 746 KB, and most of it is names no one will ever type at an agent —
 * `100 Mph`, `3AM Breakup`. So it is filtered to entries of **at most two words that
 * contain a recognised colour term**: 12,005 names of 31,915, 237 KB, and in testing that
 * filter lost nothing the full list could answer. Longer phrases are not needed because
 * the reader scans sub-phrases anyway, so `deep teal, like a diving board` finds `deep
 * teal`.
 *
 * Fetched from a **pinned version** over the network rather than installed, because
 * the server requires no npm packages at runtime. The browser still includes this
 * vendored dependency, and its upstream license must travel with the table. Run it
 * by hand when there is a reason to:
 *
 *     node bin/gen-colour-names.mjs            # rewrite the vendored table
 *     node bin/gen-colour-names.mjs --check    # CI-style: differs? non-zero exit
 *
 * The office never fetches anything at runtime: it imports the file this writes, and
 * only when a descriptive colour actually turns up (see src/agents/colour.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '14.48.0';
const SOURCE = `https://unpkg.com/color-name-list@${VERSION}/dist/colornames.json`;
const LICENSE_SOURCE = `https://unpkg.com/color-name-list@${VERSION}/LICENSE`;
const LICENSE_OUT = fileURLToPath(new URL('../vendor/color-name-list/LICENSE', import.meta.url));
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'agents', 'colour-names.js',
);

/**
 * Words that make a name a *colour* name.
 *
 * The filter's whole job is to drop the whimsy while keeping anything a person might
 * plausibly write about a shirt. A name is kept when it contains one of these, so
 * `stormy sea` and `dusty rose` survive on `sea` and `rose` while `3AM Breakup` does not.
 */
const VOCAB = new Set(`
red crimson scarlet ruby rose pink magenta fuchsia maroon burgundy oxblood brick blush
terracotta rust sienna russet orange tangerine amber apricot peach coral salmon paprika
cinnamon gold golden yellow marigold mustard lemon cream saffron honey caramel champagne
olive lime green sage mint emerald jade forest moss seafoam pistachio avocado chartreuse
teal turquoise aqua cyan blue azure cobalt navy indigo sapphire cerulean denim slate steel
periwinkle violet purple lavender lilac mauve plum orchid aubergine eggplant puce
brown tan beige taupe khaki fawn ecru bronze copper chocolate coffee sand stone sepia
umber ochre ocher vermilion grey gray charcoal silver graphite gunmetal pewter
black white ivory pearl ink sky sea ocean storm dusk dawn sunset wine clay bone smoke
`.trim().split(/\s+/));

const MAX_WORDS = 2;

function keep(name) {
  const words = name.toLowerCase().split(/\s+/);
  if (words.length > MAX_WORDS) return false;
  return words.some((w) => VOCAB.has(w.replace(/[^a-z]/g, '')));
}

/**
 * `[{name, hex}]` → `'field green:60b922|rich red:ff1144|…'`.
 *
 * A string rather than an object literal because a megabyte of JavaScript source is
 * parsed by the JavaScript parser, while a string is one allocation and a `split`. Names
 * are lower-cased here so the reader never has to, and the two separators cannot occur in
 * a colour name.
 */
function encode(entries) {
  const seen = new Set();
  const parts = [];
  for (const { name, hex } of entries) {
    const key = String(name ?? '').toLowerCase().trim();
    const value = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ''));
    if (!key || !value || key.includes(':') || key.includes('|')) continue;
    if (seen.has(key)) continue;   // first spelling wins, as the list is alphabetical
    seen.add(key);
    parts.push(`${key}:${value[1].toLowerCase()}`);
  }
  return parts.join('|');
}

function render(encoded, count) {
  return `// GENERATED FILE — do not edit. Rewrite it with: node bin/gen-colour-names.mjs
//
// ${count} colour names, for reading a colour somebody described in words. Filtered from
// color-name-list@${VERSION} (MIT) to names of at most ${MAX_WORDS} words containing a colour
// term; see bin/gen-colour-names.mjs for the filter and why this is vendored rather than
// fetched or installed.
//
// Source: ${SOURCE}
// Copyright (c) 2017 David Aerne. MIT license: vendor/color-name-list/LICENSE.
// The complete notice also travels with the app in THIRD_PARTY_NOTICES.txt.
//
// One string, not an object: the whole point of this file is that it is cheap to parse.
// src/agents/colour.js splits it into a Map on first use, and imports it lazily so an
// office where nobody has named a colour never loads it at all.

export const NAMES = '${encoded}';
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`${SOURCE} → HTTP ${res.status}`);
  const all = await res.json();
  const licenseResponse = await fetch(LICENSE_SOURCE);
  if (!licenseResponse.ok) throw new Error(`${LICENSE_SOURCE} → HTTP ${licenseResponse.status}`);
  const license = await licenseResponse.text();
  const kept = all.filter((c) => keep(String(c.name ?? '')));
  const encoded = encode(kept);
  const next = render(encoded, kept.length);
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  const size = (next.length / 1024).toFixed(0);
  if (check) {
    if (current === next && fs.existsSync(LICENSE_OUT) && fs.readFileSync(LICENSE_OUT, 'utf8') === license) {
      console.log(`up to date: ${kept.length} names, ${size} KB`);
      return;
    }
    console.error(`out of date: run node bin/gen-colour-names.mjs (${kept.length} names, ${size} KB)`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(OUT, next);
  fs.mkdirSync(path.dirname(LICENSE_OUT), { recursive: true });
  fs.writeFileSync(LICENSE_OUT, license);
  console.log(
    `${path.relative(process.cwd(), OUT)}: ${kept.length} names of ${all.length}, ${size} KB`,
  );
}

main().catch((err) => {
  console.error(`gen-colour-names: ${err.message}`);
  process.exitCode = 1;
});
