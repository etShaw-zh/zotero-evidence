# Zotero Evidence

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![zotero target version](https://img.shields.io/badge/Zotero-7|8|9|10-green?style=&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
</br>
[![Latest release](https://img.shields.io/github/v/release/etShaw-zh/zotero-evidence)](https://github.com/etShaw-zh/zotero-evidence/releases)
[![CI](https://github.com/etShaw-zh/zotero-evidence/actions/workflows/ci.yml/badge.svg)](https://github.com/etShaw-zh/zotero-evidence/actions/workflows/ci.yml)
[![Issues](https://img.shields.io/github/issues/etShaw-zh/zotero-evidence)](https://github.com/etShaw-zh/zotero-evidence/issues)
[![Pulls](https://img.shields.io/github/issues-pr/etShaw-zh/zotero-evidence)](https://github.com/etShaw-zh/zotero-evidence/pulls)
</br>
[![Documentation Status](https://readthedocs.org/projects/zotero-evidence/badge/?version=latest)](https://zotero-evidence.readthedocs.io/en/latest/)

Zotero Evidence transforms research papers into **structured, traceable evidence datasets** with AI-assisted screening, extraction, and synthesis.

Define a **Codebook**, and Zotero Evidence extracts evidence from your literature into a structured **Tableau**:

| Study      | Population       | Intervention | Sample | Outcome |
| ---------- | ---------------- | ------------ | -----: | ------- |
| Smith 2024 | Adults with T2DM | CBT          |    248 | HbA1c   |
| Lee 2023   | Older adults     | Exercise     |    126 | QoL     |

Each value remains traceable to its supporting evidence in the original paper.

> **New:** JEV model support — a faster, lighter model pre-screens with confidence scores before you review. See [JEV pre-evaluation](#jev-pre-evaluation).

## Features

- **Import & dedup** — import RIS/BibTeX/MEDLINE/PubMed XML; duplicates removed automatically.
- **Title/Abstract screening** — AI suggests Include/Exclude/Unclear for each paper with reasoning; you confirm.
- **JEV pre-evaluation** _(optional)_ — a faster model gives a quick, confidence-scored pass before you screen.
- **Full-text screening** — AI checks each paper against every criterion with highlighted evidence; you confirm.
- **Extract coding** — AI extracts data into your Codebook, backed by highlighted quotes; you confirm.
- **Synthesis** — AI groups confirmed evidence into themes with one click.
- **Consistency** — measure AI-human agreement (`Cohen's ϰ`), or sample a batch for two reviewers to co-screen.
- **Export** — PRISMA data, screening log, coding data, synthesis output, and the Codebook itself (CSV).
- **Archive & share** — export a project as a `.zip` to back up or share; restore it anywhere.

## Getting started

1. Install the plugin in Zotero 7 or later.
2. **File → AI Settings → AI Provider Settings…** — set endpoint, model, API key, and concurrency.
3. **File → Evidence Project → New Project…**, then **File → Import Literature → Import to Sources…**.
4. **File → Screening Criteria →** define one set of inclusion/exclusion criteria.
5. **File → Codebook →** define variables (or import from CSV) before coding begins.
6. Work through `TA-Screen Queue` → `FT-Screen Queue` → `Extract Coding`.
7. **File → Consistency Calculation → Human-AI Screening Consistency…**.
8. **File → Synthesis Analysis → Theme Mining…**, then **File → Export Data** when ready to write up.
9. **File → Evidence Project → Archive Project…** to back up or share a project as a `.zip`.

## Advanced usage

For a second opinion instead of just AI-vs-human:

1. **File → Consistency Calculation → Human-Human Screening Consistency…**, pick a sample size, then save the sampled archive.
2. Send that `.zip` to two reviewers. Each restores it separately and independently screens every sampled item through TA _and_ FT in their own copy, then exports their own screening log.
3. Import both reviewers' CSVs back into the dialog — `Cohen's ϰ` is computed automatically, and you can start another round any time.
4. Click **Apply Agreed Results**: items both reviewers agreed on become the project's official result; items they disagreed on stay in `TA-Screen Queue`, flagged with a colored tag so they're easy to spot in the items list, with both reviewers' calls shown right in the sidebar for a third reviewer to resolve through the normal screening flow.

Repeat steps 1–4 as many times as you like, and every round's own agreement/ϰ stays listed in the dialog.

### JEV pre-evaluation

An optional AI pre-screening pass over `TA-Screen Queue`, ahead of (or alongside) your own screening — useful for spotting likely-relevant items early and getting their PDFs ready in advance.

1. **File → Screening Criteria → JEV Pre-evaluation…** — set the JEV endpoint (defaults to aihubmix's `/v1/systemone`) and API key, and use **Test Connection** to confirm it's reachable before running a full batch.
2. Click **Run JEV Pre-evaluation**. Each item gets include/exclude/unclear probabilities and a confidence score; re-running only evaluates items that don't already have a result, unless you check "re-evaluate already-completed items." A running batch can be cancelled at any time, and reopening the dialog mid-run picks its progress back up.
3. Filter by minimum confidence and/or decision to focus on the items that matter most, then fetch full text for them — one at a time, or in bulk for everything currently in view — via Zotero's own full-text retrieval.
4. During Title/Abstract screening, each item's JEV result appears as a clearly labeled reference card. It's informational only: your Include/Exclude/Unclear call is the one that counts.

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
|-- hooks.ts          # lifecycle hooks, File-menu dispatch
|-- modules/
|   |-- project/      # project + Collection structure
|   |-- import/       # Zotero.Translate.Import wrapper
|   |-- dedup/        # DOI-first / title+author+year dedup
|   |-- screening/    # TA judgment, FT per-criterion checklist, criteria, decisions, JEV pre-evaluation
|   |-- consistency/  # Human-AI & human-human screening consistency (Cohen's ϰ)
|   |-- coding/       # Codebook + Extract Coding services
|   |-- synthesis/    # theme mining over confirmed coding evidence
|   |-- pdf/          # text extraction, quote location, highlights
|   |-- ai/           # AI provider config, chat completions, usage tracking, JEV client
|   |-- export/       # PRISMA / screening log / coding export
|   |-- archive/      # project archive export/restore (.zip)
|   |-- db/           # SQLite schema and migrations
|   `-- ui/           # item-pane sections and dialogs
addon/                # manifest, locales, static content
test/                 # Mocha suite, run inside Zotero via `npm test`
```

## License

Copyright © 2026 [Jianjun Xiao](mailto:et_shaw@126.com). AGPL-3.0-or-later, see [LICENSE](LICENSE).
