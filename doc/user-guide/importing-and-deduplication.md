# Importing and deduplication

## Goal

Import search results into an Evidence project while retaining their source and preventing duplicate records from entering the screening queue. The example project is **Digital coaching for medication adherence**.

## Prerequisites

- Create the project first; see [Project management](project-management.md).
- Export bibliographic search results as RIS, BibTeX, MEDLINE, or PubMed XML. Zotero must recognize the file with one of its built-in import translators.
- Know the database or source name for the export, such as `PubMed`, `Scopus`, or an editable custom label such as `PsycINFO`.

## Steps

1. Choose **File → Import Literature → Import to Sources…**.
2. Select `SLR-Digital coaching for medication adherence` in **Project**.
3. Enter or choose the **Source database**. The built-in suggestions are `Web of Science`, `Scopus`, and `PubMed`; a non-empty custom source is also accepted.
4. Select **Choose File…**, choose the exported search-results file, and select **Confirm**.
5. Keep the import dialog open while it reports **Importing… please wait.** On success it closes and reports the parsed, new, and duplicate counts.
6. Verify new records in `1. Sources/<source name>` and `2. TA-Screen Queue`.
7. For a later database export or search update, repeat the import with the appropriate source label. Deduplication compares the new records with canonical records already imported throughout this project, not only records still waiting in the TA queue.

## Expected result

Each new regular bibliographic item is filed in both its source subcollection and `2. TA-Screen Queue`. Evidence records the source label and an import-time snapshot for provenance. A detected duplicate is counted and removed instead of being added as another Zotero item; its source record still points to the retained canonical item.

Matching is DOI-first: normalized DOI values are compared exactly. If no DOI match is found, Evidence requires the same publication year and normalized first-author surname, then accepts an exact normalized title or a title similarity of at least 0.90. These rules make duplicate detection useful, but not infallible.

## Notes and limitations

- Evidence uses Zotero's import translator detection. If the dialog reports that no translator recognized the file, confirm that the export is valid RIS, BibTeX, MEDLINE, or PubMed XML and export it again from the source database.
- A file can parse to zero usable regular items, and malformed records may fail translation. The dialog remains open after an error and shows the failure detail so you can choose a corrected file and retry.
- Review suspicious results. Missing or inconsistent DOI, title, first-author surname, or year can cause a true duplicate to remain; incorrect metadata can also produce an unwanted match.
- Deduplication does not merge metadata fields. The first retained item remains canonical, while a later detected duplicate is recorded for provenance and erased.
- The success message may use the word “merged”; current behavior records the duplicate relationship and removes the later item rather than combining its metadata into the retained item.
- **File → Import Literature → Import to Coding…** is a different workflow. It sends records directly to `6. Extract Coding` and bypasses Sources, deduplication, TA screening, and FT screening.

## Related pages

- [Project management](project-management.md)
- [Screening criteria](screening-criteria.md)
- [Title and abstract screening](title-abstract-screening.md)
