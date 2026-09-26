# Exporting

## Goal

Export a project's data as CSV for analysis, reporting, or sharing: PRISMA flow counts, the screening decision log, the coded dataset, theme-mining output, and the Codebook itself. The example review concerns digital coaching for medication adherence.

## Prerequisites

- A project with the data you intend to export. Each export type requires the corresponding work to have been done; an export with no data is blocked.

## Steps

1. Choose the export you need from **File → Export Data**:
   - **Export PRISMA Data…**
   - **Export Screening Decision Log…**
   - **Export Extract Coding Data…**
   - **Export Theme Mining Data…**

   The Codebook is exported separately with **File → Codebook → Export Codebook…**.
2. Select the project when prompted; the currently selected project is preselected where possible.
3. Choose a save location in the file picker, which offers CSV. Evidence suggests a filename based on the project and export type.
4. On success the dialog reports **Export complete.**

## Expected result

A CSV file is written to the location you chose. Each export contains:

- **PRISMA Data** — a stage-count table (identification, TA screening, full-text screening, and final included studies) plus a table of confirmed full-text exclusion reasons. Items marked full-text unavailable are counted as not retrieved, separately from eligibility exclusions.
- **Screening Decision Log** — one row per screening record, with the item key, a stable project item id, title, DOI, stage (`ta_screening` or `ft_screening`), the AI decision, reasoning and model, the human decision, exclusion reason, who decided, when, and full-text readiness.
- **Extract Coding Data** — one row per included study with author, year, title, and DOI columns followed by one column per Codebook variable in order. A study with multiple confirmed values for a variable expands to multiple rows. Only studies with confirmed coding records are included.
- **Theme Mining Data** — one row per confirmed coded value across the whole project, with the variable name, value, supporting quote, and assigned theme. The theme column is blank for values not yet synthesized.
- **Codebook** — one row per variable using the header `name,type,values,multiple,required,notes,extraction_hint`, matching the import format for a lossless round trip.

## Notes and limitations

- An export with no rows beyond the header is blocked and reports that there is no data to export for this project yet.
- The **stable project item id** column lets a study be matched across independently restored copies of a project; it underpins the two-reviewer [consistency](consistency.md) workflow. It is blank for items that were never carried through a project archive.
- PRISMA counts are derived from the current collection membership and stored records. Restoring an archive created before import-source provenance existed leaves the identification counts empty; see [Archive and restore](archive-and-restore.md).
- Exports are plain CSV snapshots at the time you run them; they do not update automatically as you continue the review.

## Related pages

- [Codebook and extraction](codebook-and-extraction.md)
- [Synthesis](synthesis.md)
- [Consistency](consistency.md)
- [Supported formats](../reference/supported-formats.md)
