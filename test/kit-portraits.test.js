// Every thing the kit offers has a picture, and every picture is really there.
//
// The menu shows each row's own portrait out of the set `bin/prop-portrait.js` makes
// for [the kit](../docs/user/the-kit.md). That is a map from kit keys to catalogue ids, and a
// map somebody has to keep in step is exactly the shape of the bug that once dropped the
// standing desk out of the picker: keys and ids only mostly agree — `desk:standing` is
// photographed as `standingDesk`, the coffee machine as `espressoMachine`, `plant:bush`
// as `leafyBush` — so the disagreements are quiet ones.
//
// Two checks, and they fail for different reasons. The first catches a *new kind* added
// without a picture. The second catches a *wrong name*, which no amount of reading the
// map would show you: `snakePlant` and `snake` both look plausible and only one is a
// file. A missing picture is not fatal in the UI — the row keeps its column and shows a
// blank tile — so without these it would simply be a gap nobody noticed.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let KIT_PORTRAITS, KIT_SECTIONS, kitItems;

before(async () => {
  ({ KIT_PORTRAITS, KIT_SECTIONS } = await import('../src/editor/kit-menu.js'));
  ({ kitItems } = await import('../src/layout.js'));
});

const portrait = (id) => fileURLToPath(new URL(`../docs/images/objects/${id}.png`, import.meta.url));

test('every kind the kit offers has a portrait mapped', () => {
  const missing = kitItems()
    .map((item) => item.key)
    .filter((key) => !KIT_PORTRAITS[key]);
  assert.deepEqual(missing, [],
    `offered by the kit with no picture: ${missing.join(', ')} — add it to KIT_PORTRAITS`);
});

test('every mapped portrait is a file that exists', () => {
  const broken = Object.entries(KIT_PORTRAITS)
    .filter(([, id]) => !existsSync(portrait(id)))
    .map(([key, id]) => `${key} -> ${id}.png`);
  assert.deepEqual(broken, [], `mapped to a picture that is not there: ${broken.join(', ')}`);
});

test('the rows that explain rather than add have pictures too', () => {
  // The delivery person names his own portrait, because he is not a kit key: he is not
  // furniture and nothing adds him. Same for anything else that ever earns a row of its
  // own without being addable.
  const named = KIT_SECTIONS
    .flatMap((s) => [...(s.extras ?? []), ...(s.toggles ?? [])])
    .filter((e) => e.portrait);
  assert.ok(named.length, 'at least the courier should name one');
  for (const e of named) {
    assert.ok(existsSync(portrait(e.portrait)), `${e.label} points at ${e.portrait}.png`);
  }
});

test('both deploy targets ship the portraits', () => {
  // The checks above all read the checkout, which is why they were green the whole time
  // the deployed menu was a column of broken images: the pictures live under docs/, and
  // both deploy targets shipped only docs/*.html on the grounds that the rest of docs/ is
  // prose. These pictures are not prose — they are app furniture served to the editor —
  // so each target has to name them, and the .dockerignore has to let them back through.
  //
  // `docs/images` rather than `docs/images/objects`, because the portraits stopped being
  // the exception the day the documentation itself started being served: the map gallery
  // and the generated-office renders are in the published prose now, so the whole
  // directory ships. A recipe naming only the portraits would pass this test and leave
  // every other picture in the docs broken.
  const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
  const read = (p) => readFileSync(at(p), 'utf8');
  // `bin/kaizen-build.sh` is the maintainers' internal recipe and does not travel to the
  // public repository, so each recipe is checked where it exists rather than assumed.
  const recipes = ['Dockerfile.fly', '.dockerignore', 'bin/kaizen-build.sh']
    .filter((p) => existsSync(at(p)));
  assert.ok(recipes.length >= 2, 'expected at least the Fly recipe and its ignore file');
  for (const path of recipes) {
    assert.match(read(path), /docs\/images/, `${path} leaves the portraits behind`);
  }
});

test('no portrait is mapped for a key the kit does not offer', () => {
  // A stale entry is harmless but it is also a lie about what the room contains, and it
  // is how the map quietly stops describing the kit.
  const offered = new Set(kitItems().map((i) => i.key));
  const stale = Object.keys(KIT_PORTRAITS).filter((key) => !offered.has(key));
  assert.deepEqual(stale, [], `mapped but never offered: ${stale.join(', ')}`);
});
