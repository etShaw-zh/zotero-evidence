<p align="center">
  <img src="zotero-evidence-social-preview.png" alt="Zotero Evidence" width="800">
</p>

# Zotero Evidence

[![zotero target version](https://img.shields.io/badge/Zotero-7/8/9-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![Latest release](https://img.shields.io/github/v/release/etShaw-zh/zotero-evidence?style=flat-square)](https://github.com/etShaw-zh/zotero-evidence/releases)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](../LICENSE)

**Zotero Evidence** est une extension [Zotero](https://www.zotero.org/) assistée par IA qui transforme une bibliothèque en espace de travail pour la revue systématique : import & dédoublonnage → tri titre/résumé → tri du texte intégral → codage des preuves → synthèse → export. L'IA assiste chaque étape, la validation finale restant toujours humaine.

[English](../README.md) | [简体中文](./README-zhCN.md) | [Français](./README-frFR.md)

> [!NOTE]
> Cette extension se concentre strictement sur les besoins de la revue systématique — fonctionnellement suffisante pour cela, sans chercher à suivre chaque nouvelle version de Zotero. Les changements majeurs récents de Zotero n'apportant que peu de bénéfice réel à ce projet, il n'est pour l'instant pas prévu de suivre les versions futures au-delà de ce qui est déjà pris en charge.

## Flux de travail

Chaque étape déplace les références entre des Collections fixes créées automatiquement par projet, ce qui rend l'état de chaque référence visible directement dans le panneau de bibliothèque Zotero. La Synthèse et l'Export travaillent ensuite sur l'ensemble des données codées du projet, sans déplacer davantage les références :

```
1. Sources → 2. TA-Screen Queue → 3. TA-Screening Results
  → 4. FT-Screen Queue → 5. FT-Screening Results → 6. Extract Coding
  → 7. Synthesis → 8. Export
```

## Fonctionnalités

- **Import & dédoublonnage** — RIS / BibTeX / MEDLINE / PubMed XML via les traducteurs natifs de Zotero.
- **Tri titre/résumé** — l'IA propose Include/Exclude/Unclear avec son raisonnement.
- **Tri du texte intégral** — l'IA choisit un motif d'exclusion mot pour mot dans vos critères et localise les citations à l'appui en surlignages.
- **Codage** — définissez un Codebook (variables catégorielles/numériques/textuelles) ; l'IA propose des correspondances `variable = valeur` appuyées par des citations et des surlignages localisés automatiquement.
- **Synthèse** — un clic regroupe les preuves confirmées en thèmes générés par IA.
- **Export** — données de flux PRISMA, journal des décisions de tri, données de codage et de synthèse, prêtes pour la rédaction.

## Prise en main

1. Installez l'extension dans Zotero 7, 8 ou 9.
2. **File → AI Provider Settings…** : renseignez point d'accès, modèle, clé API.
3. **File → New Evidence Project…**, puis **Import Literature…**.
4. **File → Configure Title/Abstract / Full-Text Screening Criteria…**.
5. **File → Extract Codebook →** définissez les variables (ou importez-les depuis un CSV) avant de commencer le codage.
6. Parcourez `TA-Screen Queue` → `FT-Screen Queue` → `Extract Coding`.
7. Utilisez **File → Synthesis…** et le menu **Export…** au moment de la rédaction.
8. **File → Archive Project…** pour sauvegarder ou partager un projet en `.zip` ; **Restore Project from Archive…** pour le restaurer.

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
|   |-- ai/         # fournisseur IA, chat completions, suivi d'usage
|   |-- export/     # export PRISMA / journal de tri / données de codage
|   |-- archive/    # archivage/restauration de projet (.zip)
|   |-- db/         # schéma SQLite et migrations
|   `-- ui/         # sections du panneau d'item et boîtes de dialogue
addon/              # manifest, locales, contenu statique
test/               # suite de tests Mocha, exécutée dans Zotero via `npm test`
```

## Licence

Copyright © 2026 [Jianjun Xiao](mailto:et_shaw@126.com). AGPL-3.0-or-later, voir [LICENSE](../LICENSE).   
Aucune garantie n'est fournie — gardez à l'esprit les lois de votre pays.
