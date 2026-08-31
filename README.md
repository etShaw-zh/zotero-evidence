<p align="center">
  <img src="doc/zotero-evidence-social-preview.png" alt="Zotero Evidence" width="800">
</p>

# Zotero Evidence

[![zotero target version](https://img.shields.io/badge/Zotero-7/8/9-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![Latest release](https://img.shields.io/github/v/release/etShaw-zh/zotero-evidence?style=flat-square)](https://github.com/etShaw-zh/zotero-evidence/releases)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](LICENSE)

**Zotero Evidence** turns a [Zotero](https://www.zotero.org/) library into a systematic-review workspace: import & dedup → title/abstract screening → full-text screening → evidence coding → synthesis → export, with AI assistance at every step and a human always confirming the final call.

[English](README.md) | [简体中文](doc/README-zhCN.md) | [Français](doc/README-frFR.md)

> [!NOTE]
> This plugin is scoped tightly to systematic-review workflows — feature-complete for that, not for chasing every Zotero release. Recent major-version churn hasn't meaningfully benefited this project, so there's currently no plan to track future Zotero versions beyond what's already supported.

## Workflow

Each stage moves references through a fixed set of Collections created automatically per project, so status is always visible in the Zotero library pane. Synthesis and Export then work across the whole project's coded data rather than moving items further:

```
1. Sources → 2. TA-Screen Queue → 3. TA-Screening Results
  → 4. FT-Screen Queue → 5. FT-Screening Results → 6. Extract Coding
  → 7. Synthesis → 8. Export
```

## Features

- **Import & dedup** — RIS / BibTeX / MEDLINE / PubMed XML via Zotero's own translators.
- **Title/Abstract screening** — AI suggests Include/Exclude/Unclear with its reasoning.
- **Full-text screening** — AI picks a verbatim exclusion reason from your criteria and locates supporting quotes as highlights.
- **Extract coding** — define a Codebook (categorical/numeric/text variables), AI proposes `variable = value` mappings backed by quotes and auto-located highlights.
- **Synthesis** — one click groups confirmed evidence for any variable into AI-generated themes.
- **Export** — PRISMA flow data, screening decision log, coding data, and synthesis data, all ready for write-up.

## Getting started

1. Install the plugin in Zotero 7, 8 or 9.
2. **File → AI Provider Settings…** — set endpoint, model, API key.
3. **File → New Evidence Project…**, then **Import Evidence Literature…**.
4. **File → Configure Title/Abstract / Full-Text Screening Criteria…**.
5. **File → Extract Codebook →** define variables (or import from CSV) before coding begins.
6. Work through `TA-Screen Queue` → `FT-Screen Queue` → `Extract Coding`.
7. **File → Synthesis…** and the **Export…** menu when ready to write up.
8. **File → Archive Project…** to back up or share a project as a `.zip`; **Restore Project from Archive…** to bring it back.

## Development

Built with [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) and [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit).

```sh
git clone https://github.com/etShaw-zh/zotero-evidence.git
cd zotero-evidence
cp .env.example .env   # set ZOTERO_PLUGIN_ZOTERO_BIN_PATH and a dev profile
npm install
```

- `npm start` — dev server with hot reload
- `npm test` — run the test suite inside a real Zotero instance
- `npm run build` — production build (`.scaffold/build/`)
- `npm run lint:check` / `npm run lint:fix` — Prettier + ESLint
- `npm run release` — bump version and publish

```
src/
|-- hooks.ts        # lifecycle hooks, File-menu dispatch
|-- modules/
|   |-- project/    # project + Collection structure
|   |-- import/     # Zotero.Translate.Import wrapper
|   |-- dedup/      # DOI-first / title+author+year dedup
|   |-- screening/  # TA/FT: AI judgment, criteria, decisions
|   |-- coding/     # Codebook + Extract Coding services
|   |-- pdf/        # text extraction, quote location, highlights
|   |-- ai/         # AI provider config, chat completions, usage tracking
|   |-- export/     # PRISMA / screening log / coding export
|   |-- archive/    # project archive export/restore (.zip)
|   |-- db/         # SQLite schema and migrations
|   `-- ui/         # item-pane sections and dialogs
addon/              # manifest, locales, static content
test/               # Mocha suite, run inside Zotero via `npm test`
```

## License

Copyright © 2026 [Jianjun Xiao](mailto:et_shaw@126.com). AGPL-3.0-or-later, see [LICENSE](LICENSE).  
No warranties are provided — keep the laws of your locality in mind.
