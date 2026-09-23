// Build every object in the catalogue, headlessly. This is the check that makes
// the prop registry safe to extend: a new builder that throws in Node fails
// here, before any browser sees it — the exact class of break two rounds of import
// audits kept catching by hand.
//
// The scene modules bake canvas textures and bare-import 'three', so the
// harness the probe and the portrait tool already share does the setup: a
// stubbed document, and the vendored three materialised into node_modules.
// Everything scene-flavoured is imported *after* that, dynamically.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadThree, stubDom } from '../bin/lib/headless-scene.js';

let CATALOGUE, buildCatalogueObject, PROPS;

before(async () => {
  stubDom();
  await loadThree();
  ({ CATALOGUE, buildCatalogueObject } = await import('../src/scene/catalogue.js'));
  ({ PROPS } = await import('../src/scene/props/index.js'));
});

test('every catalogue entry builds and comes back with geometry', async () => {
  for (const entry of CATALOGUE) {
    const obj = buildCatalogueObject(entry.id);
    assert.ok(obj, `${entry.id} built nothing`);
    let meshes = 0;
    obj.traverse?.((o) => { if (o.geometry) meshes++; });
    assert.ok(meshes > 0, `${entry.id} has no meshes`);
  }
});

test('every prop kind the registry mounts is photographed in the catalogue', () => {
  // The one honest mismatch: the station kind is 'coffee' (agents walk to the
  // machine) while the catalogue photographs the whole 'coffeeStation'.
  const ALIAS = { coffee: 'coffeeStation' };
  const ids = new Set(CATALOGUE.map((e) => e.id));
  for (const kind of Object.keys(PROPS)) {
    const id = ALIAS[kind] ?? kind;
    assert.ok(ids.has(id), `registry kind '${kind}' has no catalogue entry '${id}'`);
  }
});
