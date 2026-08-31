# Zotero Evidence

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](LICENSE)

**Zotero Evidence** is an AI-powered [Zotero](https://www.zotero.org/) plugin that turns a Zotero library into a systematic-review workspace. It walks your references through the standard PRISMA-style pipeline — import & dedup, title/abstract screening, full-text screening, and evidence extraction (coding) — with AI assistance at every decision point and a human always confirming the final call.

[English](README.md) | [简体中文](doc/README-zhCN.md) | [Français](doc/README-frFR.md)

## Workflow

```
Import & Dedup → Title/Abstract Screening → Full-Text Screening → Extract Coding → Synthesis → Export
```

Each stage moves references between a fixed, numbered set of Collections created automatically for every project — `1. Sources` → `2. TA-Screen Queue` → `3. TA-Screening Results` (`TA-Include`/`TA-Exclude`/`TA-Unclear`) → `4. FT-Screen Queue` → `5. FT-Screening Results` (`FT-Include`/`FT-Exclude`/`FT-Unavailable`) → `6. Extract Coding` — so the current state of every reference is always visible directly in the Zotero library pane.

## Features

### Project & import

- **New Evidence Project** — creates the full Collection tree for a project in one step.
- **Import Literature** — imports RIS / BibTeX / MEDLINE / PubMed XML search exports (via Zotero's own translators) into a project's `Sources` collection. Duplicates are detected DOI-first, falling back to title + author + year, and merged rather than duplicated. Re-importing a later batch is safe: references already screened or coded keep their status, only genuinely new references enter the pipeline.
- **Import Extract Literature** — for references already screened elsewhere; imports straight into `Coding`, skipping TA/FT screening entirely.

### Title/Abstract Screening (TA-Screening)

- AI judges each reference **Include / Exclude / Unclear** against your project's research question and inclusion/exclusion criteria, with its reasoning shown alongside the title and abstract.
- One-click confirm for any decision; one-click undo to send a reference back to the queue.
- Right-click batch actions on a selection: **Run AI Judgment** and **Confirm AI Suggestions**.

### Full-Text Screening (FT-Screening)

- The screening workflow lives in the **PDF reader's sidebar** — you read the full text and decide right there. The library view keeps a read-only summary (with undo) for a quick glance without opening the PDF.
- When AI suggests Exclude, it picks the single best-matching criterion **verbatim** from your configured exclusion criteria; you just review and confirm — no manual reason picker.
- Detects whether a PDF is already attached to the item; items with no obtainable full text can be marked **Unavailable**. A right-click batch action marks every selected item without a detected PDF as unavailable in one step.
- AI-located supporting quotes and your own PDF highlights can be linked as the evidence behind a decision, and are auto-highlighted in a fixed color for easy review later.

### Extract Coding

- Define a project's **Codebook**: categorical / numeric / text variables, each with allowed values, required/multiple-value flags, notes, and an extraction hint for the AI. Import a Codebook from CSV (a template is one click away), add variables one at a time, or edit any variable's definition later.
- AI reads the full text and generates suggested `variable = value` mappings, each backed by a quoted excerpt and, where possible, an auto-located highlight on the PDF.
- Review suggestions one at a time or accept/reject them in bulk; add mappings manually for anything AI missed; undo a confirmed record if you change your mind.
- Same reader/library split as FT-Screening: the interactive editor lives in the PDF reader, the library view shows a read-only confirmed-evidence summary.

### Synthesis

- Pick a Codebook variable and see every confirmed value/quote for it project-wide, one row per paper, in a table.
- One click runs AI thematic synthesis: it groups the rows into a small set of recurring themes (rows sharing a theme get identical labels) and saves the result; re-running always regenerates the whole table.

### Reporting

- **Export PRISMA Data** — stage counts and an exclusion-reason breakdown, ready for a PRISMA flow diagram.
- **Export Screening Decision Log** — a per-reference audit trail of every screening decision.
- **Export Extract Coding Data** — the full set of confirmed variable/value mappings.
- **Export Synthesis Data** — every confirmed variable/value/quote project-wide, plus its theme.
- **Screening Progress** — a live dashboard of every project's counts across all pipeline stages.

### AI provider

Bring your own OpenAI-compatible chat/completions endpoint, model, and API key. Batch operations run with configurable concurrency.

## Getting started

1. Install the plugin in Zotero 7 (a beta build if you're running the very latest Zotero).
2. **File → AI Provider Settings…** and enter your endpoint, model, and API key.
3. **File → New Evidence Project…**
4. **File → Import Literature…** to pull in your search results (or **Import Extract Literature…** if the literature is already screened).
5. **File → Configure Title/Abstract Screening Criteria…** and **Configure Full-Text Screening Criteria…** to set your research question and inclusion/exclusion rules.
6. Work through `TA-Screen Queue` → `FT-Screen Queue` → `Extract Coding`, deciding items from the item pane (title/abstract stage and library summaries) and the PDF reader sidebar (full-text stage and coding).
7. **File → Synthesis…** to see cross-study themes for any Codebook variable once enough evidence is coded.
8. **File → Export PRISMA Data…** / **Export Screening Decision Log…** / **Export Extract Coding Data…** / **Export Synthesis Data…** when you're ready to write up.

## Development

This plugin is built with [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) and [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit).

### Requirements

1. A Zotero build to develop against: <https://www.zotero.org/support/beta_builds>
2. [Node.js LTS](https://nodejs.org/en/) and [Git](https://git-scm.com/)

### Setup

```sh
git clone https://github.com/etShaw-zh/zotero-evidence.git
cd zotero-evidence
cp .env.example .env   # set ZOTERO_PLUGIN_ZOTERO_BIN_PATH and a dev profile
npm install
```

### Commands

- `npm start` — start the dev server: builds the plugin, launches Zotero with it loaded, and hot-reloads on every change under `src/**` or `addon/**`.
- `npm test` — run the test suite inside a real Zotero instance.
- `npm run build` — production build; output goes to `.scaffold/build/`.
- `npm run lint:check` / `npm run lint:fix` — Prettier + ESLint.
- `npm run release` — bump the version and publish (see [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) for the release flow).

### Project layout

```
src/
|-- hooks.ts                  # lifecycle hooks, File-menu event dispatch
|-- modules/
|   |-- project/              # project + collection structure, project context
|   |-- import/               # Zotero.Translate.Import wrapper
|   |-- dedup/                # DOI-first / title+author+year deduplication
|   |-- screening/            # TA/FT screening: AI judgment, criteria, decisions
|   |-- coding/                # Codebook + Extract Coding services
|   |-- pdf/                  # PDF text extraction, quote location, highlight creation
|   |-- ai/                   # AI provider configuration and chat completion calls
|   |-- export/               # PRISMA / screening log / coding data export
|   |-- db/                   # SQLite schema and migrations
|   `-- ui/                   # item-pane sections (Screen Queue / FT-Queue / Coding) and dialogs
addon/                        # manifest, locales, static content
test/                         # Mocha test suite, run inside Zotero via `npm test`
```

### Resources

- [📖 Zotero 7 Plugin Development Documentation](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [🛠️ Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) | [API Documentation](https://github.com/windingwind/zotero-plugin-toolkit/blob/master/docs/zotero-plugin-toolkit.md)
- [🛠️ Zotero Plugin Scaffold](https://github.com/northword/zotero-plugin-scaffold)
- [ℹ️ Zotero Type Definitions](https://github.com/windingwind/zotero-types)
- [📜 Zotero Source Code](https://github.com/zotero/zotero)

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE). No warranties are provided — keep the laws of your locality in mind.
