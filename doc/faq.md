# Frequently asked questions

## Do I need an AI provider to use Zotero Evidence?

No. You can create projects, import records, define criteria and a Codebook, and record your own decisions without AI. AI is optional and assists screening, coding, and synthesis; you can make a title/abstract decision without running it. See [AI provider setup](getting-started/ai-provider-setup.md).

## Does the plugin make screening or coding decisions for me?

No. Every AI output is a suggestion. You confirm each screening decision, extracted value, and theme. See [Limitations](reference/limitations.md).

## What data is sent to the AI provider?

Only the prompt content a feature needs — criteria and title/abstract for TA screening, extracted PDF text (up to 40,000 characters) for full-text screening and coding, and confirmed values with quotes for synthesis. The PDF file itself, your API keys, and account information are not sent. See [Data and privacy](reference/data-and-privacy.md).

## Which import and export formats are supported?

Import supports RIS, BibTeX, MEDLINE, and PubMed XML through Zotero's translators. Exports are CSV: PRISMA data, screening log, coding data, theme-mining data, and the Codebook. See [Supported formats](reference/supported-formats.md).

## Which Zotero versions are supported?

Zotero 7, 8, 9, and 10. Confirm compatibility in the release notes for the version you install. See [Installation](getting-started/installation.md).

## Can I use a group library?

Yes. A project belongs to one library chosen at creation, which may be a writable group library, and it syncs through Zotero. A single project cannot span multiple libraries. See [Project structure](reference/project-structure.md).

## How does duplicate detection work?

Import to Sources compares each new record by DOI first, then by year plus normalized first-author surname plus an exact or ≥0.90-similar title. It is useful but fallible, and it does not merge metadata. See [Importing and deduplication](user-guide/importing-and-deduplication.md).

## What is the difference between Import to Sources and Import to Coding?

**Import to Sources…** runs deduplication and enters the full screening pipeline. **Import to Coding…** sends records straight to `6. Extract Coding`, bypassing Sources, deduplication, and TA/FT screening; use it only for literature screened elsewhere.

## How do I back up or share a project?

Use **Archive Project…** to export a `.zip`, and **Restore Project from Archive…** to recreate it as a new project in any writable library. An archive is a snapshot, not a substitute for a broader backup policy. See [Archive and restore](user-guide/archive-and-restore.md).

## What happens when I delete a project?

**Delete Project…** permanently removes the project's collections, the items filed in them, and its Evidence records. It cannot be undone; archive first if you might need the project again. See [Project management](user-guide/project-management.md).

## Is there any tracking or telemetry?

No. The plugin contains no analytics or telemetry. It keeps a local AI usage log for your own accounting, which is never transmitted. See [Data and privacy](reference/data-and-privacy.md).

## Related pages

- [Troubleshooting](troubleshooting.md)
- [Limitations](reference/limitations.md)
- [Your first project](getting-started/first-project.md)
