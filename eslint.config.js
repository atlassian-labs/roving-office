// One flat config for the three worlds this repo spans: browser ES modules under
// src/, Node CommonJS under bin/ and lib/, and the OpenClaw plugin's Node ESM.
// Stock recommended rules — the point is a net under refactors, not a style crusade.

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/',
      'vendor/',        // three.js, vendored verbatim
      'dist/',
      // Generated distribution artifacts, for the same reason as dist/: every file in
      // them is a byte-identical copy of one that is linted where it lives, and the
      // copies are not in this config's `files` blocks, so they would be checked
      // against the browser defaults and fail on `Buffer`.
      'plugins/',
      'docs/',
      'inspo/',
      // Every dot-directory: worktree and agent scratch (.worktrees/, .claude/),
      // deploy build output (.output/) — none of it is this repo's source, and new
      // ones appear whenever a tool feels like it.
      '.*/',
    ],
  },

  js.configs.recommended,

  // The app: browser ES modules. `window.__dbg` and canvas work live here.
  //
  // `admin/` is the admin console, which is a browser module like the rest even though it
  // is not part of the app: it renders a page of charts from one fetch and imports
  // nothing from src/. It is linted here rather than given its own block because it is
  // the same world — a module the browser loads — and the only reason it lives outside
  // src/ is that the static file server refuses that directory (server.cjs).
  {
    files: ['src/**/*.js', 'admin/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },

  // The server, the adapters and the tools: Node, mostly CommonJS.
  {
    files: ['server.cjs', 'lib/**/*.cjs', 'bin/**/*.cjs', 'test/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // Node ESM: the OpenClaw plugin, the kaizen entry, the tests, and the two configs.
  //
  // `eleventy.config.mjs` was missing from this list for a while and passed lint only
  // because it happened to use no Node API. The first one it reached for — reading its own
  // location to find the repo root — was reported as `'URL' is not defined`, which is a
  // confusing way to be told a file is in none of these blocks.
  {
    files: [
      'openclaw-plugin/**/*.mjs', 'bin/**/*.mjs', 'bin/**/*.js', 'test/**/*.js',
      'eslint.config.js', 'eleventy.config.mjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // The headless tools run scene modules in Node with a stubbed document, and the
  // two harness pages are browser scripts loaded straight into bin/*.html.
  {
    files: ['bin/lib/headless-scene.js', 'bin/prop-portrait.js', 'bin/scene-map.js', 'bin/coplanar-probe.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    rules: {
      // The codebase idiom: `catch { /* state is a nicety, never a requirement */ }`.
      // An empty catch with a comment is a decision; one without is still flagged.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Intentional in a few hot loops; the default is noise here.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
