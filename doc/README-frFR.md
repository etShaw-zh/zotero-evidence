# Zotero Evidence

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![CI](https://img.shields.io/github/actions/workflow/status/etShaw-zh/zotero-evidence/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/etShaw-zh/zotero-evidence/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/etShaw-zh/zotero-evidence?style=flat-square)](https://github.com/etShaw-zh/zotero-evidence/releases)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](../LICENSE)

**Zotero Evidence** est une extension [Zotero](https://www.zotero.org/) assistée par IA qui transforme une bibliothèque en espace de travail pour la revue systématique : import & dédoublonnage → tri titre/résumé → tri du texte intégral → codage des preuves → synthèse → export. L'IA assiste chaque étape, la validation finale restant toujours humaine.

[English](../README.md) | [简体中文](./README-zhCN.md) | [Français](./README-frFR.md)

## Flux de travail

Chaque étape déplace les références entre des Collections fixes créées automatiquement par projet, ce qui rend l'état de chaque référence visible directement dans le panneau de bibliothèque Zotero :

```
1. Sources → 2. TA-Screen Queue → 3. TA-Screening Results
  → 4. FT-Screen Queue → 5. FT-Screening Results → 6. Extract Coding
```

## Fonctionnalités

- **Import & dédoublonnage** — RIS / BibTeX / MEDLINE / PubMed XML via les traducteurs natifs de Zotero ; dédoublonnage par DOI avec repli sur titre+auteur+année ; réimport sûr, sans effet sur les références déjà triées.
- **Tri titre/résumé** — l'IA propose Include/Exclude/Unclear avec son raisonnement, directement dans le panneau de l'item ; confirmation/annulation en un clic, actions groupées.
- **Tri du texte intégral** — se fait dans la barre latérale du lecteur PDF ; l'IA choisit un motif d'exclusion mot pour mot dans vos critères et localise les citations à l'appui en surlignages.
- **Codage (Extract Coding)** — définissez un Codebook (variables catégorielles/numériques/textuelles) ; l'IA propose des correspondances `variable = valeur` appuyées par des citations et des surlignages localisés automatiquement.
- **Synthèse** — un clic regroupe les preuves confirmées d'une variable en thèmes générés par IA, à l'échelle du projet.
- **Export** — données de flux PRISMA, journal des décisions de tri, données de codage et de synthèse, prêtes pour la rédaction.
- **Fournisseur IA** — utilisez le fournisseur compatible OpenAI de votre choix (point d'accès, modèle, clé API) ; concurrence des opérations groupées configurable.

## Prise en main

1. Installez l'extension dans Zotero 7.
2. **File → AI Provider Settings…** : renseignez point d'accès, modèle, clé API.
3. **File → New Evidence Project…**, puis **Import Literature…**.
4. **File → Configure Title/Abstract / Full-Text Screening Criteria…**.
5. Parcourez `TA-Screen Queue` → `FT-Screen Queue` → `Extract Coding`.
6. Utilisez **File → Synthesis…** et le menu **Export…** au moment de la rédaction.

## Développement

Construit avec [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) et [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit).

```sh
git clone https://github.com/etShaw-zh/zotero-evidence.git
cd zotero-evidence
cp .env.example .env   # renseignez ZOTERO_PLUGIN_ZOTERO_BIN_PATH et un profil de développement
npm install
```

- `npm start` — serveur de développement avec rechargement à chaud
- `npm test` — exécute la suite de tests dans une instance Zotero réelle
- `npm run build` — build de production (`.scaffold/build/`)
- `npm run lint:check` / `npm run lint:fix` — Prettier + ESLint
- `npm run release` — incrémente la version et publie

```
src/
|-- hooks.ts        # hooks de cycle de vie, distribution du menu File
|-- modules/
|   |-- project/    # structure projet/Collections
|   |-- import/     # encapsulation de Zotero.Translate.Import
|   |-- dedup/      # dédoublonnage DOI en priorité / titre+auteur+année
|   |-- screening/  # tri TA/FT : jugement IA, critères, décisions
|   |-- coding/     # services Codebook et Extract Coding
|   |-- pdf/        # extraction de texte, localisation de citations, surlignages
|   |-- ai/         # configuration du fournisseur IA et chat completions
|   |-- export/     # export PRISMA / journal de tri / données de codage
|   |-- db/         # schéma SQLite et migrations
|   `-- ui/         # sections du panneau d'item et boîtes de dialogue
addon/              # manifest, locales, contenu statique
test/               # suite de tests Mocha, exécutée dans Zotero via `npm test`
```

### Ressources

- [📖 Documentation de développement des extensions Zotero 7](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [🛠️ Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) | [Documentation API](https://github.com/windingwind/zotero-plugin-toolkit/blob/master/docs/zotero-plugin-toolkit.md)
- [🛠️ Zotero Plugin Scaffold](https://github.com/northword/zotero-plugin-scaffold)
- [ℹ️ Définitions de types Zotero](https://github.com/windingwind/zotero-types)
- [📜 Code source de Zotero](https://github.com/zotero/zotero)

## Licence

Copyright © 2026 [Jianjun Xiao](mailto:et_shaw@126.com). AGPL-3.0-or-later, voir [LICENSE](../LICENSE). Aucune garantie n'est fournie — gardez à l'esprit les lois de votre pays.
