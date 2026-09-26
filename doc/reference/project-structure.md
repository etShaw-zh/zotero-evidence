# Project structure

This page describes how an Evidence project is organized inside Zotero and where the plugin keeps its own records.

## The managed collection tree

Creating a project builds a fixed collection tree whose root is named with an `SLR-` prefix, for example `SLR-Digital coaching for medication adherence`. The managed stages are:

- `1. Sources` — imported records, filed under a subcollection per source database. New projects start with `Web of Science`, `Scopus`, and `PubMed`; additional source labels create their own subcollections on import.
- `2. TA-Screen Queue` — records awaiting title-and-abstract screening.
- `3. TA-Screening Results` — a parent for the TA outcomes; items are filed in its children, not here directly:
  - `TA-Include`, `TA-Exclude`, `TA-Unclear`.
- `4. FT-Screen Queue` — items awaiting full-text screening (those with a TA decision of Include or Unclear).
- `5. FT-Screening Results` — a parent for the FT outcomes:
  - `FT-Include`, `FT-Exclude`, `FT-Unavailable`.
- `6. Extract Coding` — included studies ready for extraction.

The stage names are fixed and are not meant to be renamed, moved, or extended by hand. Evidence relies on this structure to route items and suppresses those collection actions where it can.

## One project, one library

A project belongs to exactly one Zotero library, chosen when the project is created. Every item, PDF, annotation, and collection in the project lives in that library and syncs with it. A project cannot span multiple libraries, and a group-library project uses Zotero group sync for its contents.

## Where Evidence stores its records

Evidence keeps its own data — screening criteria and decisions, full-text criterion checks, codebooks and coding records, synthesis themes, consistency rounds, import-source provenance, and a local AI usage log — in a separate SQLite database in your Zotero profile directory, distinct from Zotero's main database. Item and annotation references are resolved within the project's library.

A project archive bundles both the Zotero content and these Evidence records into a portable `.zip`; see [Archive and restore](../user-guide/archive-and-restore.md).

## Related pages

- [Project management](../user-guide/project-management.md)
- [Data and privacy](data-and-privacy.md)
- [Supported formats](supported-formats.md)
