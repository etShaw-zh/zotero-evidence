# Codebook and extraction

## Goal

Define a Codebook of variables to extract from each included study, then use it to code the full text of studies in `6. Extract Coding`, confirming each value against a supporting quote in the PDF. The example review concerns digital coaching for medication adherence.

## Prerequisites

- Studies reach `6. Extract Coding` when their full-text decision is **Include**; see [Full-text screening](full-text-screening.md). You may also use **File → Import Literature → Import to Coding…** for literature screened elsewhere.
- Finalize the intended Codebook variables before extraction, because each save creates a new version and existing records stay tied to the version used at extraction time.
- AI suggestions require an active [AI provider](../getting-started/ai-provider-setup.md) and a PDF whose text Zotero can read.

## Steps

### Define the Codebook

1. Choose **File → Codebook → Add Codebook Variable…** to add variables one at a time, or **File → Codebook → Import Codebook (CSV)…** to load a prepared file.
2. For each variable, set **Variable name**, **Type (categorical / numeric / text)**, and, for a categorical variable, **Allowed values (pipe-separated, categorical only)** such as `RCT|Cohort|Case-control`. Optionally set **Allows multiple values**, **Required**, **Notes**, and **Extraction hint**.
3. A CSV Codebook uses the header row `name,type,values,multiple,required,notes,extraction_hint`. The `values` column is pipe-separated for categorical variables and blank otherwise; `multiple` and `required` accept `1`/`0`. An unknown or blank type is treated as `text`.
4. Use **Edit Codebook Variable…** to change any field except the name, **Delete Codebook Variable…** to remove a variable, **View Codebook…** to review the current set, and **Export Codebook…** to save it as CSV.

### Extract and confirm evidence

5. Open a study in `6. Extract Coding` in Zotero's PDF reader and open the **Evidence Coding** pane. Select **Run AI Suggestions** (later runs read **Re-run AI Suggestions**).
6. Review each pending suggestion. A suggestion whose quote was located shows a page number; a suggestion whose quote could not be located shows **Needs manual linking**.
7. For a located suggestion, confirm it to materialize its PDF highlight, or reject it. **Accept All** confirms every located suggestion and skips the rest. For an unlocated suggestion, open its inline picker, choose an existing highlight, and link it.
8. Use the **Add mapping manually** form to record a value the AI missed: choose a variable, enter the value, and optionally link a highlight. A manual mapping is confirmed immediately.
9. To prepare several studies at once, select items in `6. Extract Coding` and use **Generate Coding AI Suggestions (Selected Items)**. Individual failures are reported at the end and do not stop the batch.
10. To reverse a confirmation, use the undo control on a confirmed record; it returns to the pending list.

## Expected result

Each confirmed value is stored with its supporting quote and a linked PDF highlight labeled with the variable and value, so exported coding data stays traceable to the source. Clicking a confirmed record navigates to its highlight in the reader. Confirmed, non-pilot records are what [Exporting](exporting.md) writes as the coded dataset (the "tableau"): one row per study, expanded to multiple rows when a variable has several confirmed values.

## Notes and limitations

- AI is not the final coder. Read each proposed value and quote in the PDF before confirming; only confirmed records count as reviewed evidence.
- The AI receives extracted PDF text capped at 40,000 characters, plus the Codebook variables and their hints. Long documents are truncated for the request, and image-only or unindexed PDFs may yield no readable text.
- Re-running suggestions is additive; it adds new pending rows rather than replacing earlier ones. Review duplicates rather than assuming the newest run cleaned them up.
- Undoing a confirmation clears the confirmed flag but does not delete an already created PDF highlight; remove unwanted highlights in the reader.
- Editing the Codebook after extraction begins applies going forward. Existing records keep the variable definitions and version they were created under; a deleted variable stops appearing in pickers and exports but its existing records are not erased.
- **Import to Coding…** bypasses Sources, deduplication, and TA/FT screening; use it only for literature screened elsewhere. See [Importing and deduplication](importing-and-deduplication.md).

## Related pages

- [Full-text screening](full-text-screening.md)
- [Consistency](consistency.md)
- [Synthesis](synthesis.md)
- [Exporting](exporting.md)
