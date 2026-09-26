# Supported formats

This page summarizes the file formats Zotero Evidence reads on import and writes on export.

## Import formats

Literature import uses Zotero's own import translators rather than a fixed parser. The documented and tested formats are **RIS**, **BibTeX**, **MEDLINE**, and **PubMed XML**. The file picker accepts the extensions `.ris`, `.bib`, `.txt`, `.xml`, and `.nbib`.

Because import delegates to Zotero's translator registry, any format a current Zotero translator recognizes can in principle be imported. If no translator recognizes a file, the import reports that no Zotero import translator recognized it; re-export a valid file from the source database and try again.

Two import commands exist:

- **File → Import Literature → Import to Sources…** files records under `1. Sources/<source name>` and `2. TA-Screen Queue`, running deduplication.
- **File → Import Literature → Import to Coding…** sends records directly to `6. Extract Coding`, bypassing Sources, deduplication, and TA/FT screening.

See [Importing and deduplication](../user-guide/importing-and-deduplication.md).

## Deduplication matching

Import to Sources compares each new record against the canonical records already imported anywhere in the project:

1. **DOI first.** Normalized DOI values are compared for an exact match.
2. **Fallback.** With no DOI match, a duplicate requires the same publication year and the same normalized first-author surname, together with either an exact normalized title or a title similarity of at least 0.90.

Normalization lowercases text and removes punctuation before comparison. These rules make duplicate detection useful but not infallible; missing or inconsistent DOI, title, author, or year can leave a true duplicate undetected or, rarely, cause an unwanted match.

## Export formats

All data exports are **CSV**. Available exports:

| Export | Command | Contents |
| --- | --- | --- |
| PRISMA data | File → Export Data → Export PRISMA Data… | Stage counts and confirmed full-text exclusion reasons |
| Screening decision log | File → Export Data → Export Screening Decision Log… | One row per screening record across TA and FT stages |
| Extract coding data | File → Export Data → Export Extract Coding Data… | One row per included study, one column per Codebook variable |
| Theme mining data | File → Export Data → Export Theme Mining Data… | One row per confirmed coded value, with its assigned theme |
| Codebook | File → Codebook → Export Codebook… | One row per variable, matching the CSV import format |

See [Exporting](../user-guide/exporting.md) for the columns and behavior of each export.

## Archive format

A project archive is a single `.zip` containing the project's items, PDF attachments, PDF annotations, and Evidence records. It is produced by **Archive Project** and consumed only by **Restore Project from Archive**. See [Archive and restore](../user-guide/archive-and-restore.md).

## Related pages

- [Importing and deduplication](../user-guide/importing-and-deduplication.md)
- [Exporting](../user-guide/exporting.md)
- [Project structure](project-structure.md)
