# Vendored OpenClaw licence

The OpenClaw lobster in `src/ui/marks.js` is copied from the OpenClaw repository, which
is MIT licensed. MIT requires the copyright notice and permission text to travel with
the copy, so the licence is vendored here and emitted into `THIRD_PARTY_NOTICES.txt`.

- **Version:** tag `v2026.9.3`
- **License:** MIT (`LICENSE` in this directory, verbatim from that tag),
  "Copyright (c) 2026 OpenClaw Foundation"
- **Source:** `https://raw.githubusercontent.com/openclaw/openclaw/v2026.9.3/LICENSE`;
  the artwork is `ui/public/favicon.svg` at the same tag
- **What was vendored:** the licence text. The artwork itself is inline SVG in
  `src/ui/marks.js`, because this app loads no assets from disk.

Two things worth knowing before touching this. **The file is verbatim MIT plus one
trailing sentence** pointing at the upstream project's own `THIRD_PARTY_NOTICES.md`,
which adds no carve-out — but that extra line defeats GitHub's exact-match licence
detector, so automated scans report the repository as `NOASSERTION` / `other`. That is a
detector artefact, not a narrowed grant. And **the website favicon is not the same file**:
`openclaw.ai/favicon.svg` hashes differently and carries no licence, so this copy is
sourced from the repository deliberately. The upstream repository file wraps the same
geometry in SMIL animation; every path, gradient stop, circle and stroke we ship is
byte-identical to it.

This is the only third-party mark in the picker that ships under a licence actually
permitting redistribution — see `NOTICE` and `docs/developer/visual-assets.md` for
the rest.
