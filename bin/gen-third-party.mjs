#!/usr/bin/env node
// Rebuild the dependency evidence inventory and runtime notices, without network access.
// Run after npm ci. --check is used by npm test: dependency/asset upgrades must refresh
// the inventory in the same change. SPDX labels are declarations, not legal clearance.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const json = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stable = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Every file a curated path covers — the file itself, or a directory walked.
 *
 * **A path that is not in this tree contributes nothing rather than throwing.** The
 * inventory is a record of what *this* tree ships, and the public export is a smaller
 * tree cut from the same `components.json`: the vendored research skill and the internal
 * deployment recipe are both left behind there, so their rows legitimately cover nothing
 * once the export is built. Regenerating in the export then produces an inventory that
 * describes the export, which is the point of it.
 *
 * `test/public-surface.test.js` is what keeps this from hiding a mistake in the source
 * repository, where every curated path does exist and a missing one means a rename.
 */
function filesUnder(root, name) {
  const full = path.join(root, name);
  if (!fs.existsSync(full)) return [];
  if (!fs.statSync(full).isDirectory()) return [name];
  return fs.readdirSync(full).sort().flatMap((entry) => filesUnder(root, `${name}/${entry}`));
}

function fileEvidence(root, name, includeText = false) {
  const body = fs.readFileSync(path.join(root, name));
  return { path: name, sha256: sha256(body), ...(includeText ? { text: body.toString('utf8') } : {}) };
}

// Packages sometimes keep their full license in README instead of LICENSE (errno,
// esrecurse, imurmurhash). Record the license section, not unrelated documentation.
function readmeLicense(root, name) {
  const body = fs.readFileSync(path.join(root, name), 'utf8');
  const headings = [...body.matchAll(/^#{1,6}\s+(?:Licen[sc]e|Copyright)[^\n]*$/gim)];
  const start = headings.at(-1)?.index ?? body.search(/(?:\*?Copyright|Permission is hereby)/i);
  if (start < 0) return null;
  const text = body.slice(start);
  return { path: name, sha256: sha256(Buffer.from(body)), excerpt: text };
}

function matchesPlatform(values, value) {
  if (!values?.length) return true;
  if (values.includes(`!${value}`)) return false;
  const allowed = values.filter((item) => !item.startsWith('!'));
  return !allowed.length || allowed.includes(value) || allowed.includes('any');
}

export function generate(root = ROOT, { platform = process.platform, arch = process.arch } = {}) {
  const curated = json(root, 'third-party/components.json');
  const lock = json(root, 'package-lock.json');
  const rootManifest = json(root, 'package.json');
  const previous = fs.existsSync(path.join(root, 'third-party/inventory.json'))
    ? json(root, 'third-party/inventory.json').npm : [];
  const npm = Object.entries(lock.packages).filter(([name]) => name).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([location, entry]) => {
    // Mirror changes do not alter package identity. Everything else in the locked
    // entry does, including platform, license, dependency and integrity metadata.
    const lockedIdentity = { ...entry };
    delete lockedIdentity.resolved;
    const lockFingerprint = sha256(stable(lockedIdentity));
    const topLevelName = location.replace(/^node_modules\//, '');
    const direct = !topLevelName.includes('/node_modules/') &&
      (Object.hasOwn(rootManifest.devDependencies ?? {}, topLevelName) || Object.hasOwn(rootManifest.dependencies ?? {}, topLevelName));
    if (!fs.existsSync(path.join(root, location, 'package.json'))) {
      // npm omits fsevents on Linux. Keep its audited evidence from the committed
      // inventory only when the complete locked identity is unchanged. A new or
      // upgraded omitted dependency requires gathering evidence on its platform.
      const omitted = entry.optional && (!matchesPlatform(entry.os, platform) || !matchesPlatform(entry.cpu, arch));
      const recorded = previous.find((item) => item.location === location && item.lockFingerprint === lockFingerprint);
      if (!omitted || !recorded) throw new Error(`${location}: missing package/license evidence; run npm ci on a supported platform and regenerate`);
      const review = curated.npmEvidence[`${recorded.name}@${recorded.version}`]?.note;
      const rest = { ...recorded };
      delete rest.review;
      return { ...rest, direct, ...(review ? { review } : {}) };
    }
    const installed = json(root, `${location}/package.json`);
    if (installed.version !== entry.version) throw new Error(`${location}: run npm ci; installed version differs from lockfile`);
    if (installed.license !== entry.license) throw new Error(`${location}: package and lockfile license declarations disagree`);
    const id = `${installed.name}@${entry.version}`;
    const additional = curated.npmEvidence[id] ?? {};
    const names = fs.readdirSync(path.join(root, location)).sort();
    const licenseFiles = names.filter((name) => /^(?:unlicen[sc]e|licen[sc]e|copying|notice|copyright)(?:[._-].*)?$/i.test(name))
      .filter((name) => fs.statSync(path.join(root, location, name)).isFile())
      .map((name) => fileEvidence(root, `${location}/${name}`, true));
    const readme = licenseFiles.length ? [] : names.filter((name) => /^readme(?:\.|$)/i.test(name))
      .map((name) => readmeLicense(root, `${location}/${name}`)).filter(Boolean);
    const extra = (additional.additionalPaths ?? []).map((name) => {
      // Record provenance comments and a hash, not copies of development-tool code
      // in the source distribution. These declarations can still lack full terms.
      const evidence = fileEvidence(root, `${location}/${name}`);
      const body = fs.readFileSync(path.join(root, location, name), 'utf8');
      const excerpt = body.match(/\/\*[\s\S]*?\*\//)?.[0] ?? (body.match(/^\/\/.*$/gm) ?? []).join('\n');
      return { ...evidence, excerpt };
    });
    const evidence = [...licenseFiles, ...readme, ...extra];
    const terms = evidence.map((item) => item.text ?? item.excerpt).join('\n');
    const fullLicenseText = licenseFiles.length > 0 || /Permission is hereby granted[\s\S]*THE SOFTWARE IS PROVIDED|Redistribution and use[\s\S]*THIS SOFTWARE IS PROVIDED/i.test(terms);
    return {
      name: installed.name, version: entry.version, location,
      purl: `pkg:npm/${installed.name.replace('@', '%40')}@${entry.version}`,
      integrity: entry.integrity ?? null,
      lockFingerprint,
      direct,
      scope: entry.dev ? 'development-install' : 'runtime-npm',
      declaredLicense: entry.license ?? 'NOASSERTION',
      licenseEvidenceStatus: fullLicenseText ? 'license-text-recorded' : 'full-license-text-missing',
      repository: typeof installed.repository === 'object' ? installed.repository.url : installed.repository ?? null,
      dependencies: entry.dependencies ?? {},
      licenseEvidence: evidence,
      ...(additional.note ? { review: additional.note } : {}),
    };
  });
  const components = curated.components.map((item) => ({
    ...item,
    files: item.paths.flatMap((name) => filesUnder(root, name)).sort().map((name) => fileEvidence(root, name)),
    licenseEvidence: item.licenseFiles
      .filter((name) => fs.existsSync(path.join(root, name)))
      .map((name) => fileEvidence(root, name, true)),
    // A component whose every path has gone is a component this tree does not ship, so
    // it is dropped below rather than recorded as an empty row. See filesUnder: the
    // public export is cut from this same curated list and carries less than it names.
  })).filter((item) => item.paths.length === 0 || item.files.length > 0);
  const licenseCounts = {};
  for (const item of npm) licenseCounts[item.declaredLicense] = (licenseCounts[item.declaredLicense] ?? 0) + 1;
  const inventory = {
    schemaVersion: 1,
    generatedBy: 'node bin/gen-third-party.mjs',
    reviewedAt: curated.reviewedAt,
    scope: 'Source inventory with recorded license evidence; not an approval, SPDX/CycloneDX attestation, or built-container SBOM. Unversioned assets and platform components require release review.',
    summary: {
      npmPackages: npm.length,
      npmDeclaredLicenseCounts: licenseCounts,
      npmMissingFullLicenseText: npm.filter((item) => item.licenseEvidenceStatus === 'full-license-text-missing').map((item) => `${item.name}@${item.version}`),
      componentsWithUnresolvedRights: components.filter((item) => item.license === 'NOASSERTION').map((item) => item.id),
    },
    distributions: curated.distributions,
    distributionRecipes: (curated.distributionRecipes ?? []).map((name) => fileEvidence(root, name)),
    components,
    npm,
  };
  const notices = [
    'THIRD-PARTY NOTICES — THE ROVING OFFICE',
    '',
    'The browser application includes the following third-party software/data.',
    'These notices apply to those components only and do not license this project,',
    'its logos or artwork. Source/development-tool provenance and unresolved',
    'rights are recorded separately in third-party/inventory.json in the source tree.',
    'Node and container distributions also retain their own upstream notices.',
    '',
    'Third-party BRAND assets are a different question and are not licensed here:',
    'NOTICE names the ones excluded from this project\'s code licence, and',
    'docs/developer/visual-assets.md records the source and release basis of every',
    'visual asset in the tree.',
    '',
    ...components.filter((item) => item.runtimeNotice).flatMap((item) => [
      '='.repeat(72), `${item.name} ${item.version}`, `Source: ${item.source}`,
      ...(item.modification ? [`Modified: ${item.modification}`] : []),
      '', ...item.licenseEvidence.map((item) => item.text.trimEnd()), '',
    ]),
  ].join('\n');
  return { 'third-party/inventory.json': stable(inventory), 'THIRD_PARTY_NOTICES.txt': `${notices}\n` };
}

export function run({ root = ROOT, check = false } = {}) {
  const outputs = generate(root);
  for (const [name, contents] of Object.entries(outputs)) {
    const full = path.join(root, name);
    if (check) {
      if (!fs.existsSync(full) || fs.readFileSync(full, 'utf8') !== contents) {
        throw new Error(`${name} is stale; run npm ci and node bin/gen-third-party.mjs, then review the evidence`);
      }
    } else fs.writeFileSync(full, contents);
  }
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run({ check: process.argv.includes('--check') });
    console.log(process.argv.includes('--check') ? 'Third-party inventory and notices are current.' : 'Wrote third-party inventory and runtime notices. Review unresolved entries before release.');
  } catch (error) {
    console.error(`third-party: ${error.message}`);
    process.exitCode = 1;
  }
}
