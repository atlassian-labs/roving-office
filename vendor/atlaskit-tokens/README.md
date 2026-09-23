# Vendored @atlaskit/tokens licence

`assets/ui-theme.css` is hand-authored CSS, but its ~50 colour values are taken from
Atlassian's design tokens, which its own header has always recorded. The package is not
a dependency and nothing is installed from it — only the numbers travelled — so the
licence is vendored here rather than picked up from `node_modules`.

- **Version:** 16.11.3, `palette-brand-refresh`
- **License:** Apache-2.0 (`LICENSE` in this directory, verbatim from the published
  tarball), "Copyright 2019 Atlassian Pty Ltd"
- **Source:** `https://registry.npmjs.org/@atlaskit/tokens/-/tokens-16.11.3.tgz`,
  `package/LICENSE` inside it. The registry metadata for that version declares
  `"license": "Apache-2.0"`.
- **What was vendored:** the licence text only.

Hex colour values are facts rather than protected expression, so the CSS would stand on
its own authorship — but the tokens are where they came from, and Apache-2.0 asks for
the notice, so it is recorded here and in `THIRD_PARTY_NOTICES.txt` rather than left as
a source comment. Note that this covers the *tokens package* and nothing else: it is not
a licence to Atlassian's brand assets, which are dealt with separately in `NOTICE` and
`docs/developer/visual-assets.md`.
