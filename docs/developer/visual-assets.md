# Visual assets: source and release basis

Every visual asset that ships with The Roving Office, where it came from, and on what
basis it is published. Some of them are other companies' brand assets that this project's
code licence does not and cannot cover; those are named again in
[`NOTICE`](../../NOTICE), which is the short, legally operative version. This page is the
longer one, for whoever is changing an asset.

**Read the split first, because it is the whole point.** The code is under the Apache
License 2.0 ([`LICENSE`](../../LICENSE)), whose section 2 grants downstream recipients the
right to reproduce, prepare derivative works of and distribute the work — a right this
project holds in its own code and does *not* hold in another company's logo. Section 6
disclaims trademarks, but it does not disclaim copyright in artwork, so an asset the
project may *use* but may not *sublicense* has to be excluded explicitly rather than left
to be inferred. That is what the carve-out in `NOTICE` is for.

Machine-readable provenance, per-file hashes and per-distribution scope live in
[`third-party/components.json`](../../third-party/components.json) and the generated
[`third-party/inventory.json`](../../third-party/inventory.json). Licence texts that must
travel with a copy are in [`THIRD_PARTY_NOTICES.txt`](../../THIRD_PARTY_NOTICES.txt) and
`vendor/`. This page is the human-readable index over the same facts.

---

## 1. Covered by the project's own licence

First-party work. Authored for this project, owned by Atlassian as the releasing entity,
and published under Apache-2.0 like the rest of the tree.

| Asset | Where | What it is |
|---|---|---|
| Project logo and icon set | `assets/logo.png`, `assets/logo-256.png`, `assets/logo-64.png`, `assets/icon-512.png`, `assets/icon-192.png`, `assets/apple-touch-icon.png`, `favicon.ico` | An isometric cutaway office in a rounded-hex silhouette. Cut from the scene's own render — the method is in [Developing on it](developing.md) |
| Spot illustrations | `assets/airmail.svg`, `assets/arrivals.svg`, `assets/breather.svg`, `assets/curiosity.svg` | Hand-authored flat illustrations: a paper plane, a reception scene, a mug, a telescope |
| UI theme | `assets/ui-theme.css` | Hand-authored CSS custom properties. Its colour values come from `@atlaskit/tokens` — see §4 |
| In-house source glyphs | `src/ui/marks.js` — `cursorMark`, `testDataMark`, `plusMark` | Original geometry: a cursor chevron, a die, a plus. Not any vendor's logo. Cursor's tile is deliberately an original glyph rather than Cursor's mark |
| The room, and every prop in it | `src/scene/`, `src/plan/` | Original geometry, apart from the two brand-mark standees in §3 |
| Scene renders and screenshots | `docs/images/**` | Own renders and own screenshots — except the four in §5, which reproduce a mark |

## 2. Third-party artwork under a licence that permits redistribution

One asset. It is the only third-party mark in the tree that ships on an actual grant
rather than on an approval.

| Asset | Where | Source | Release basis |
|---|---|---|---|
| OpenClaw lobster mascot | `src/ui/marks.js` — `openclawMark` | `openclaw/openclaw` at tag `v2026.9.3`, `ui/public/favicon.svg` | **MIT**, "Copyright (c) 2026 OpenClaw Foundation". The licence grants *"use, copy, modify, merge, publish, distribute, sublicense"*, and requires the notice to travel with the copy — it does, in `THIRD_PARTY_NOTICES.txt`. Details and two evidence caveats in [`vendor/openclaw/README.md`](../../vendor/openclaw/README.md) |

The lobster remains the OpenClaw Foundation's mark. MIT grants copyright permission, not
trademark permission, and it is used here only to identify the corresponding product.

## 3. Brand assets — **excluded from the Apache-2.0 grant**

These are trademarks reproduced to identify a product the office can connect to. The
project may use them; it cannot pass on the right to redistribute them. **They are
therefore excluded from the Apache-2.0 grant and individually named in
[`NOTICE`](../../NOTICE).** Anyone forking this repository needs their own permission.

**A copy and a modification are different things here, and which one an asset is decides
what a sign-off has to name.** The Claude Spark and the OpenAI Blossom picker tiles are
their owners' own official published assets, copied path for path, with no recolouring and
no rescaling. The Blossom's `viewBox` is trimmed to the bounds of its own artwork, which
discards empty canvas the published file carries and moves no ink relative to any other
ink; it is the same mark at a size that matches the ones beside it. Everything else in
this section is a modification rather than a copy — the Rovo picker tile and the Rovo
standee are one mark traced into flat polygons and then extruded into a solid, and the
Jira logomark is a mark lifted out of an attribution lockup.

| Asset | Where | Source | Release basis |
|---|---|---|---|
| **Rovo logomark** (picker tile) | `src/ui/marks.js` — `rovoMark`, built from `ROVO_SHAPES` in `src/rovo-mark.js` | Atlassian's own Rovo mark: the four-facet hexagon in four Atlassian brand colours (`#1868db`, `#bf63f3`, `#fca700`, `#82b536`). The polygon geometry is the very points the standee below is extruded from, turned into 2D SVG paths, so the tile and the statue are one artwork and cannot drift apart | Approved by Atlassian Brand for use in this repository. Excluded from the grant |
| **Rovo logomark standee** | `src/rovo-mark.js` — `ROVO_SHAPES`, extruded by `src/scene/standees.js`; portrait at `docs/images/objects/rovoLogo.png` | The same mark, flattened one polygon per facet for extrusion. The same polygons are the picker tile in the row above | Approved by Atlassian Brand, covering the 3D extrusion. Excluded from the grant |
| **Atlassian logo standee** | `src/scene/standees.js` — `ACE_SHAPES`; portrait at `docs/images/objects/aceLogo.png` | Atlassian logo kit, `Atlassian/Atlassian Mark/SVG/Atlassian mark brand RGB.svg`, from <https://atlassian.design/> | Approved by Atlassian Brand, covering the 3D extrusion. Excluded from the grant |
| **Jira logomark** on the kanban board texture | `src/scene/kanban.js` — `KB_LOGO_GLYPH_D`; portrait at `docs/images/objects/kanbanBoard.png` | Jira attribution kit, `jira attribution/SVG/Jira_attribution_dark.svg`, from <https://atlassian.design/> | Approved by Atlassian Brand. Excluded from the grant |
| **Claude Spark** (picker tile) | `src/ui/marks.js` — `claudeMark` | Anthropic press kit, `Claude logos/3 Claude Spark/SVG/Claude Spark - Clay.svg`, from <https://www.anthropic.com/press-kit> | **No permission from Anthropic is held.** Retained on the project owner's decision, accepting that a take-down request would be complied with. Excluded from the grant |
| **OpenAI Blossom** (picker tile, standing in for Codex) | `src/ui/marks.js` — `codexMark` | OpenAI logo kit, `OpenAI-logos/SVGs/OAI_OpenAI-Blossom_Black.svg`, from <https://openai.com/brand> | **No permission from OpenAI is held.** Retained on the same basis as the Spark. Excluded from the grant |

**The last two rows mean what they say.** Anthropic's and OpenAI's brand guidelines are
approval-first: neither grants an affirmative licence to redistribute a mark, and a
permission that was granted could not be passed downstream anyway. Both vendors expressly
permit the product *name* in plain text, so **a text label is the working fallback** — if
a take-down request arrives, replace the mark with the name and nothing else changes.

For each owner's own usage guidance:

- **Atlassian** — <https://atlassian.design/foundations/logos> and
  <https://www.atlassian.com/legal/trademark>
- **Anthropic** — <https://www.anthropic.com/legal/trademark-guidelines>
- **OpenAI** — <https://openai.com/brand>
- **OpenClaw** — no brand guidance is published; the licence in §2 is the whole basis

Product names — Rovo CLI, Claude Code, Codex, Cursor, OpenClaw — are used throughout the
UI and the documentation to say which agent an office can listen to, and nothing more.

## 4. Third-party non-artwork with a notice obligation

| Asset | Where | Source | Release basis |
|---|---|---|---|
| Inter (Latin subset) | `assets/Inter-latin.woff2`, `docs/site/assets/Inter-latin.woff2` | Inter 4.1 | **OFL-1.1**. [`vendor/inter/`](../../vendor/inter/) |
| JetBrains Mono (Latin subset) | `assets/JetBrainsMono-latin.woff2`, `docs/site/assets/JetBrainsMono-latin.woff2` | JetBrains Mono 2.304 | **OFL-1.1**. [`vendor/jetbrains-mono/`](../../vendor/jetbrains-mono/) |
| Atlassian Design System tokens | colour values in `assets/ui-theme.css` | `@atlaskit/tokens` 16.11.3 | **Apache-2.0**. Nothing from the package is bundled — only its colour values were transcribed. [`vendor/atlaskit-tokens/`](../../vendor/atlaskit-tokens/) |

## 5. Images that reproduce a mark

Renders and screenshots inherit the basis of whatever they depict, so these four are
tracked against the assets in §3 rather than as first-party artwork. **Regenerate them
whenever a mark or a standee changes**, and note the object portraits are runtime app
assets as well as documentation: `src/editor/kit-menu.js` fetches them live for the
editor's add-item menu.

| Image | What it reproduces | How to regenerate |
|---|---|---|
| `docs/images/panels/source-picker.png` | All five picker marks at once | Screenshot the picker; see [Developing on it](developing.md) on harness pages |
| `docs/images/objects/rovoLogo.png` | The Rovo standee | `npm run portrait -- --id=rovoLogo` |
| `docs/images/objects/aceLogo.png` | The Atlassian logo standee | `npm run portrait -- --id=aceLogo` |
| `docs/images/objects/kanbanBoard.png` | The Jira logomark | `npm run portrait -- --id=kanbanBoard` |

The scene renders under `docs/images/{looks,looks2,looks3,variety,maps,buildings,generated}/`
are a separate question, because `src/scene/props.js` puts both standees on a window sill
and so an interior render can contain one. Screening them all for the standees' own facet
colours finds them at a handful of pixels each, behind sill planting, never legible as a
mark — so they are treated as first-party renders. Re-screen after any standee change
rather than assuming that holds.

## 6. Not shipped

Recorded so the question does not have to be re-asked.

- **`inspo/`** — art-direction reference material. Gitignored, excluded again by
  `.dockerignore`, and tracked in no distribution.
- **User-uploaded avatars** — supplied by an operator at runtime and served back to their
  own office. Not a project asset; covered by the hosted service's own terms.
- **`vendor/three/`, `vendor/color-name-list/`** — code, not artwork. See
  `third-party/inventory.json`.

---

## Adding or changing a visual asset

1. **Establish where it came from** before it lands, and record it — an asset whose
   provenance is a source comment is an asset somebody has to research again later. Two
   of the marks above were once byte-verified copies taken from a stock icon site whose
   terms forbid redistribution, and the comment beside them said, accurately, that
   commercial use was permitted. Accurate and insufficient.
2. **Take vendor artwork from the vendor**, not from an icon site or a search result, and
   copy it unaltered. Most owners require exactly that, and a recolour to suit a panel is
   the alteration their guidance names.
3. **Add a row to `third-party/components.json`** with its source, its release basis and
   the distributions it reaches, then run `node bin/gen-third-party.mjs`. `npm test`
   fails if the generated inventory and notices have drifted.
4. **If a licence requires its notice to travel**, vendor the licence text under
   `vendor/<name>/LICENSE` with a `README.md` recording the version and the exact source,
   and set `runtimeNotice: true` on the row.
5. **If it is somebody else's brand asset**, add it to §3 above *and* to
   [`NOTICE`](../../NOTICE). It is excluded from the Apache-2.0 grant, and the exclusion
   has to be written down to exist.
6. **Regenerate any image that reproduces it** — §5 is the list, and the rule is the same
   for a new one.
