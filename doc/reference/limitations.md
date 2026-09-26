# Limitations

Known limits of the current release. They reflect behavior in the source code, not temporary bugs.

## AI assistance

- **AI is advisory at every stage.** Title/abstract suggestions, full-text criterion checks, coding suggestions, and synthesis themes are proposals. A researcher must confirm each screening decision, extracted value, and interpretation.
- **AI can be wrong.** A provider may omit relevant evidence, misread a criterion, fail to locate a quote, or return plausible but unsupported text.

## PDF text

- Full-text screening and coding send extracted PDF text capped at **40,000 characters**; longer documents are truncated for the request.
- Only text-based PDFs work. Image-only or unindexed PDFs (for example, scans without OCR) may yield no readable text, which blocks AI full-text screening and coding for that item.
- Full-text availability is a human decision. Evidence never infers readiness from the mere presence of an attachment; you mark full text available explicitly.

## Re-runs and editing

- AI re-runs are **additive**. Running screening or coding again adds new records rather than replacing earlier ones; you review and reconcile duplicates yourself.
- Editing the Codebook after coding begins applies going forward. Existing records keep the variable definitions and version they were created under, and deleting a variable does not erase its existing records.
- Synthesis re-runs perform a full regenerate for the analyzed rows, overwriting their previous theme labels rather than merging.

## Deduplication

- Matching is DOI-first, then year plus normalized first-author surname plus an exact or ≥0.90-similar title. It is useful but fallible: missing or inconsistent metadata can leave a true duplicate undetected or cause an unwanted match.
- Deduplication does not merge metadata. The first retained record stays canonical; a later duplicate is recorded for provenance and removed.

## Scope limits

- A project belongs to exactly one Zotero library and cannot span libraries.
- Synthesis analyzes at most **300** confirmed records per variable per run; extra records keep any theme they already have.
- Exports are point-in-time CSV snapshots and do not update automatically.

## Environment

- Supported Zotero versions are 7, 8, 9, and 10. Confirm compatibility in the release notes for the version you install.
- The first documentation release is English only.

## Related pages

- [Data and privacy](data-and-privacy.md)
- [AI providers](ai-providers.md)
- [Troubleshooting](../troubleshooting.md)
