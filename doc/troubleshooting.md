# Troubleshooting

Common problems and where to resolve them. When reporting an issue, use sanitized information: never include API keys, copyrighted article text, personal data, or confidential research material.

## Installation and commands

- **Evidence commands are missing from the File menu.** Confirm the plugin is listed in **Tools → Plugins** and enabled, then restart Zotero. Reinstall from a trusted release `.xpi` if needed. See [Installation](getting-started/installation.md).
- **The plugin will not install.** Download the release asset ending in `.xpi` and drag it onto the Plugins window without extracting it. Check that your Zotero version is within the supported range for that release.

## AI provider

- **Test connection fails.** Verify the endpoint is the full chat/completions URL, the API key is valid, and the model identifier is accepted by the provider. The dialog shows the provider's error detail after **✗ Connection failed:**. See [AI provider setup](getting-started/ai-provider-setup.md).
- **Fetch models fails.** The endpoint may not expose a `/models` list, or authentication was rejected. Type the model identifier manually instead.
- **Requests are slow or hit rate limits.** Lower the concurrency (default 3, range 1–10). AI calls use a 5-minute timeout and do not retry silently, so a persistent failure surfaces promptly.

## Importing and deduplication

- **No translator recognized the file.** Re-export valid RIS, BibTeX, MEDLINE, or PubMed XML from the source database and try again. See [Supported formats](reference/supported-formats.md).
- **A true duplicate was not detected, or an unwanted match occurred.** Deduplication relies on DOI, then year, first-author surname, and title similarity. Missing or inconsistent metadata reduces its accuracy; review suspicious counts against `1. Sources`. See [Importing and deduplication](user-guide/importing-and-deduplication.md).
- **Records skipped TA screening.** You likely used **Import to Coding…**, which sends records straight to `6. Extract Coding`. Use **Import to Sources…** for the full screening pipeline.

## Screening and coding

- **AI cannot read the PDF.** Full-text screening and coding require extractable text. Image-only or unindexed PDFs may yield nothing; obtain a text-based PDF. Very long documents are truncated at 40,000 characters.
- **Full-text actions are unavailable.** Mark full text available explicitly first, or mark it unavailable when it cannot be obtained. See [Full-text screening](user-guide/full-text-screening.md).
- **A coding suggestion says it needs manual linking.** The AI's quote could not be located automatically. Link it to a PDF highlight from the suggestion's inline picker. See [Codebook and extraction](user-guide/codebook-and-extraction.md).
- **Re-running AI created duplicate rows.** Re-runs are additive by design. Review and reject superseded suggestions; the newest run does not clean up earlier ones.

## Synthesis and export

- **Theme Mining reports no records.** It needs confirmed coding records for the selected variable. Only the first 300 confirmed records per variable are analyzed per run. See [Synthesis](user-guide/synthesis.md).
- **An export is blocked.** An export with no data beyond the header row is not written. Complete the relevant work first, then retry. See [Exporting](user-guide/exporting.md).
- **PRISMA identification counts are empty after restoring an archive.** Archives created before import-source provenance existed restore without those counts. See [Archive and restore](user-guide/archive-and-restore.md).

## Projects and archives

- **A deleted project cannot be recovered.** **Delete Project…** permanently removes the collections, the items filed in them, and the project's Evidence records. Archive first if you might need it. See [Project management](user-guide/project-management.md).
- **Restore rejects a file.** Restore accepts only a `.zip` created by **Archive Project**. See [Archive and restore](user-guide/archive-and-restore.md).

## Getting further help

If these steps do not resolve the problem, follow the support policy and reporting channels in the project's [SUPPORT.md](https://github.com/etShaw-zh/zotero-evidence/blob/main/SUPPORT.md). Prefer sanitized logs, and use any private channel it names for sensitive reports.

## Related pages

- [Frequently asked questions](faq.md)
- [Limitations](reference/limitations.md)
- [Data and privacy](reference/data-and-privacy.md)
