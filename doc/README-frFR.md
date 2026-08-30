# Zotero Evidence

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=flat-square)](../LICENSE)

**Zotero Evidence** est une extension [Zotero](https://www.zotero.org/) assistée par IA qui transforme une bibliothèque Zotero en espace de travail pour la revue systématique de la littérature (systematic review). Elle fait avancer vos références à travers le pipeline standard de type PRISMA — import et dédoublonnage, tri titre/résumé, tri du texte intégral, et extraction des données (codage) — avec une assistance IA à chaque étape de décision, la validation finale restant toujours humaine.

[English](../README.md) | [简体中文](./README-zhCN.md) | [Français](./README-frFR.md)

## Flux de travail

```
Import & dédoublonnage → Tri titre/résumé (TA-Screening) → Tri du texte intégral (FT-Screening) → Codage (Extract Coding) → Export
```

Chaque étape déplace les références entre un ensemble fixe de Collections créées automatiquement pour chaque projet (`Sources`, `Screen Queue`, `TA-Include/Exclude/Unclear`, `FT-Queue`, `FT-Include/Exclude/Unavailable`, `Coding`), de sorte que l'état actuel de chaque référence est toujours visible directement dans le panneau de la bibliothèque Zotero.

## Fonctionnalités

### Projet et import

- **New Evidence Project** — crée en une seule étape l'arborescence complète de Collections d'un projet.
- **Import Literature** — importe des fichiers d'export de recherche RIS / BibTeX / MEDLINE / PubMed XML (via les traducteurs natifs de Zotero) dans la collection `Sources` d'un projet. Les doublons sont détectés en priorité par DOI, avec repli sur titre + auteur + année, puis fusionnés plutôt que dupliqués. Un réimport ultérieur est sûr : les références déjà triées ou codées conservent leur statut, seules les références réellement nouvelles entrent dans le pipeline.
- **Import Extract Literature** — pour des références déjà triées ailleurs ; importe directement dans `Coding`, en sautant entièrement le tri TA/FT.

### Tri titre/résumé (TA-Screening)

- L'IA évalue chaque référence — **Include / Exclude / Unclear** — au regard de la question de recherche et des critères d'inclusion/exclusion du projet, avec son raisonnement affiché à côté du titre et du résumé.
- Confirmation en un clic pour toute décision ; annulation en un clic pour renvoyer une référence dans la file d'attente.
- Actions groupées via le clic droit sur une sélection : **Run AI Judgment** et **Confirm AI Suggestions**.

### Tri du texte intégral (FT-Screening)

- Le tri se déroule dans la **barre latérale du lecteur PDF** — vous lisez le texte intégral et décidez directement là. La vue bibliothèque conserve un résumé en lecture seule (avec annulation) pour un coup d'œil rapide sans ouvrir le PDF.
- Lorsque l'IA suggère l'exclusion, elle choisit **mot pour mot** le critère le plus pertinent parmi vos critères d'exclusion configurés ; il ne reste qu'à relire et confirmer, sans sélecteur manuel.
- Détecte si un PDF est déjà rattaché à l'item ; les références dont le texte intégral est introuvable peuvent être marquées **Unavailable**. Une action groupée via le clic droit marque en une fois comme indisponibles tous les items sélectionnés sans PDF détecté.
- Les citations justificatives localisées par l'IA, ainsi que vos propres surlignages PDF, peuvent être liés comme preuve à l'appui d'une décision, et sont automatiquement surlignés dans une couleur fixe pour faciliter la relecture.

### Codage (Extract Coding)

- Définissez le **Codebook** d'un projet : variables catégorielles / numériques / textuelles, chacune avec ses valeurs autorisées, ses indicateurs obligatoire/valeurs multiples, des notes, et une consigne d'extraction destinée à l'IA. Importez un Codebook depuis un CSV (un modèle est téléchargeable en un clic), ajoutez des variables une à une, ou modifiez à tout moment la définition d'une variable existante.
- L'IA lit le texte intégral et propose des correspondances `variable = valeur`, chacune appuyée par une citation extraite et, si possible, un surlignage localisé automatiquement sur le PDF.
- Passez en revue les suggestions une à une, ou acceptez/rejetez-les en masse ; ajoutez manuellement ce que l'IA aurait manqué ; annulez un enregistrement confirmé si nécessaire.
- Même répartition lecteur/bibliothèque que pour le FT-Screening : l'éditeur interactif se trouve dans le lecteur PDF, la vue bibliothèque affiche un résumé en lecture seule des preuves confirmées.

### Rapports

- **Export PRISMA Data** — comptages par étape et répartition des motifs d'exclusion, prêts pour un diagramme de flux PRISMA.
- **Export Screening Decision Log** — journal d'audit détaillé de chaque décision de tri, par référence.
- **Export Extract Coding Data** — l'ensemble des correspondances variable/valeur confirmées.
- **Screening Progress** — un tableau de bord en direct des comptages de chaque projet à travers toutes les étapes du pipeline.

### Fournisseur IA

Utilisez le fournisseur compatible OpenAI (chat/completions) de votre choix : point d'accès, modèle et clé API personnalisables. La concurrence des opérations groupées est configurable.

## Prise en main

1. Installez l'extension dans Zotero 7 (une version beta si vous utilisez la toute dernière version de Zotero).
2. **File → AI Provider Settings…** et renseignez votre point d'accès, votre modèle et votre clé API.
3. **File → New Evidence Project…**
4. **File → Import Literature…** pour importer vos résultats de recherche (ou **Import Extract Literature…** si la littérature a déjà été triée ailleurs).
5. **File → Configure Title/Abstract Screening Criteria…** et **Configure Full-Text Screening Criteria…** pour définir votre question de recherche et vos critères d'inclusion/exclusion.
6. Parcourez `Screen Queue` → `FT-Queue` → `Coding` : décidez depuis le panneau de l'item (étape titre/résumé et résumés en bibliothèque) et depuis la barre latérale du lecteur PDF (étape texte intégral et codage).
7. **File → Export PRISMA Data…** / **Export Screening Decision Log…** / **Export Extract Coding Data…** au moment de la rédaction.

## Développement

Cette extension est construite avec [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) et [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit).

### Pré-requis

1. Une version de Zotero pour le développement : <https://www.zotero.org/support/beta_builds>
2. [Node.js LTS](https://nodejs.org/en/) et [Git](https://git-scm.com/)

### Installation

```sh
git clone https://github.com/etShaw-zh/zotero-evidence.git
cd zotero-evidence
cp .env.example .env   # renseignez ZOTERO_PLUGIN_ZOTERO_BIN_PATH et un profil de développement
npm install
```

### Commandes

- `npm start` — démarre le serveur de développement : construit l'extension, lance Zotero avec l'extension chargée, et recharge à chaud à chaque changement sous `src/**` ou `addon/**`.
- `npm test` — exécute la suite de tests dans une instance Zotero réelle.
- `npm run build` — construction en mode production ; le résultat se trouve dans `.scaffold/build/`.
- `npm run lint:check` / `npm run lint:fix` — Prettier + ESLint.
- `npm run release` — incrémente la version et publie (voir [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) pour le processus de publication).

### Structure du projet

```
src/
|-- hooks.ts                  # hooks de cycle de vie, distribution des événements du menu File
|-- modules/
|   |-- project/              # structure projet/Collections, contexte de projet
|   |-- import/               # encapsulation de Zotero.Translate.Import
|   |-- dedup/                # dédoublonnage DOI en priorité / titre+auteur+année
|   |-- screening/            # tri TA/FT : jugement IA, critères, décisions
|   |-- coding/                # services Codebook et Extract Coding
|   |-- pdf/                  # extraction de texte PDF, localisation de citations, création de surlignages
|   |-- ai/                   # configuration du fournisseur IA et appels chat completion
|   |-- export/               # export PRISMA / journal de tri / données de codage
|   |-- db/                   # schéma SQLite et migrations
|   `-- ui/                   # sections du panneau d'item (Screen Queue / FT-Queue / Coding) et boîtes de dialogue
addon/                        # manifest, locales, contenu statique
test/                         # suite de tests Mocha, exécutée dans Zotero via `npm test`
```

### Ressources

- [📖 Documentation de développement des extensions Zotero 7](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [🛠️ Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) | [Documentation API](https://github.com/windingwind/zotero-plugin-toolkit/blob/master/docs/zotero-plugin-toolkit.md)
- [🛠️ Zotero Plugin Scaffold](https://github.com/northword/zotero-plugin-scaffold)
- [ℹ️ Définitions de types Zotero](https://github.com/windingwind/zotero-types)
- [📜 Code source de Zotero](https://github.com/zotero/zotero)

## Licence

AGPL-3.0-or-later. Voir [LICENSE](../LICENSE). Aucune garantie n'est fournie — gardez à l'esprit les lois de votre pays.
