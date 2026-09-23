# Vendored JetBrains Mono licence

JetBrains Mono is the monospace face for numeric readouts and code, declared in
`assets/ui-theme.css` and loaded from `assets/JetBrainsMono-latin.woff2`. As with Inter,
the font file sits in `assets/` because `ui-theme.css` reaches it relatively and Eleventy
copies the pair into `docs/site/assets/`; the licence is vendored here so the upstream
original is kept verbatim.

- **Version:** 2.304 (latest upstream release as of 2026-09-10)
- **License:** SIL Open Font License 1.1 (`LICENSE` in this directory, from the upstream
  release), "Copyright 2020 The JetBrains Mono Project Authors"
- **Source:**
  `https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip`,
  the `fonts/variable/JetBrainsMono[wght].ttf` inside it
- **What was vendored:** that variable font, subset to latin and converted to WOFF2 with
  `pyftsubset`, unmodified otherwise:

  ```
  pyftsubset 'JetBrainsMono[wght].ttf' --unicodes-file=latin.txt --flavor=woff2 \
    --layout-features=ss01,ss02,zero \
    --output-file=assets/JetBrainsMono-latin.woff2
  ```

  `ui-theme.css` switches those three on through `--font-variants-mono`. The feature list
  is given rather than appended, which drops `calt` — JetBrains Mono's code ligatures — on
  purpose: `--`, `=>` and `!=` stay as separate glyphs in code blocks. Add `calt` to both
  the subset and the token if that is ever wanted.

To update, download the same path at a newer release and re-run the same command.
