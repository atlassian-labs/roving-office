# Vendored three.js

Stopgap: three.js is checked into this repo instead of loaded from a public CDN
(`unpkg.com`) or installed via npm, because the project has no bundler yet.
This is a temporary measure — see the tracking issue linked below to move to
the proper npm + Atlaspack + Bifrost setup per Atlassian's Frontend Tech Stack
standard.

- **Version:** 0.185.1 (latest stable on npm as of 2026-08-29)
- **License:** MIT (`LICENSE` in this directory, from the upstream package)
- **Source:** `https://unpkg.com/three@0.185.1/` (mirrors the npm package)
- **Files vendored:**
  - `build/three.module.js` + `build/three.core.js` — the core ES module build
    (three.module.js re-exports from three.core.js as of this version)
  - `examples/jsm/controls/OrbitControls.js` — the only `examples/jsm` addon
    the app uses (see `src/scene/camera.js`)

To update the vendored copy, re-download the same paths at a newer version
and re-check `examples/jsm/controls/OrbitControls.js` for new import
dependencies (addons occasionally start importing sibling addon modules).

Open: replace this vendored copy with an npm-installed three.js
once the app is allowed a bundler.
