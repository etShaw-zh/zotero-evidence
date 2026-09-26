# Archive and restore

## Goal

Export a complete Evidence project to a single `.zip` archive for backup or sharing, and restore an archive as a new project in any writable Zotero library. The example review is **Digital coaching for medication adherence**.

## Prerequisites

- The project exists and is open in Zotero; see [Project management](project-management.md).
- To restore into a group library, you must have permission to add collections and items there.
- Enough free disk space for the archive. A project with many PDFs produces a large `.zip`.

## Steps

### Archive a project

1. Choose **File → Evidence Project → Archive Project…**.
2. Select `SLR-Digital coaching for medication adherence` and choose a save location and filename for the `.zip`.
3. Keep the dialog open while it reports **Archiving "…"… this can take a while for large projects.** On success it reports **Project "…" archived.**
4. Store the `.zip` in a protected backup or sharing location.

### Restore a project

1. Choose **File → Evidence Project → Restore Project from Archive…**.
2. Select the archive `.zip`. If Zotero offers a library choice, select the personal or writable group library that should own the restored project.
3. Select **Restore**. The dialog reports **Restoring project from archive… this can take a while for large archives.** and then **Project "…" restored from archive.**

## Expected result

A restore always creates a **new** project; it never overwrites an existing one. The restored project reproduces the `SLR-` collection tree, the bibliographic items, PDF attachments, and PDF annotations, together with the Evidence records for screening criteria and decisions, full-text criterion checks, codebooks and coding, synthesis themes, consistency rounds, and import source provenance.

If a project with the same name already exists in the target library, the restored project name receives a numeric suffix such as ` (2)` or ` (3)` so both projects remain distinct.

## Notes and limitations

- Because Zotero item keys are assigned per library, restore assigns new keys to items and annotations and re-files them into their project stages. Evidence remaps its internal references during this process, so screening, coding, synthesis, and consistency history stay linked.
- Restore is not destructive to existing projects: it adds a new project rather than merging into or replacing one. To remove a project you no longer need, use **Delete Project…**; see [Project management](project-management.md).
- Older archives may lack sections added in later releases. An archive created before import-source provenance existed restores with an empty PRISMA identification count; archives created before full-text criterion checks or consistency rounds existed restore without those records.
- Reviewer CSV file paths recorded during a [consistency](consistency.md) round are intentionally not carried into a restored project, because those paths are local to the machine that ran the round.
- Restore only accepts a `.zip` created by **Archive Project**. Another `.zip` produces **Failed to restore the project from this archive. Make sure it's a .zip created by File > Archive Project.**
- An archive is a portable project snapshot, not a substitute for a broader, tested backup policy. Keep a recent archive before upgrading the plugin or performing destructive actions.

## Related pages

- [Project management](project-management.md)
- [Consistency](consistency.md)
- [Project structure](../reference/project-structure.md)
