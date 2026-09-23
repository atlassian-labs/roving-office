# Vendored Inter licence

Inter is the UI sans, declared in `assets/ui-theme.css` and loaded from
`assets/Inter-latin.woff2`. The font file lives in `assets/` rather than here because
`ui-theme.css` reaches it with a relative URL and Eleventy copies the pair into
`docs/site/assets/`; only the licence is vendored here, next to three.js's, so the
upstream original is kept verbatim in one place.

- **Version:** 4.1 (latest upstream release as of 2026-09-10; the build string inside the
  file reads `4.001;git-9221beed3;RSMS`)
- **License:** SIL Open Font License 1.1 (`LICENSE` in this directory, from the upstream
  release), "Copyright (c) 2016 The Inter Project Authors"
- **Source:** `https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip`,
  the `InterVariable.ttf` inside it
- **What was vendored:** that variable font, subset to latin and converted to WOFF2 with
  `pyftsubset`, unmodified otherwise:

  ```
  pyftsubset InterVariable.ttf --unicodes-file=latin.txt --flavor=woff2 \
    --layout-features+=tnum,zero,cv07,cv08,cv09,cv10,ss07,ss08 \
    --output-file=assets/Inter-latin.woff2
  ```

  The extra layout features are kept because `ui-theme.css` switches them on through
  `--font-variants-sans`: `cv07`–`cv10` and `ss07`/`ss08` select the letterforms this
  UI is drawn around, and `tnum`/`zero` back the `tabular-nums` this project asks for in
  nine places. Subsetting and format conversion do not modify the outlines, so this stays
  an unmodified OFL font and keeps the upstream family name.

To update, download the same path at a newer release and re-run the same command; check
the character-variant tags still select the same glyphs, because Inter renumbers `cvXX`
between major versions.
