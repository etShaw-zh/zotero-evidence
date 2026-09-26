# Project management

## Goal

Create, open, inspect, and safely remove an Evidence project. This guide uses an adaptable example review named **Digital coaching for medication adherence**.

## Prerequisites

- Zotero Evidence is installed and Zotero is open.
- To create a project in a group library, you must have permission to add collections and items there.
- Before deleting a project that you may need again, create an archive as described in [Archive and restore](archive-and-restore.md).

## Steps

1. Choose **File → Evidence Project → New Project…**.
2. Enter `Digital coaching for medication adherence`. Evidence stores and displays the project as `SLR-Digital coaching for medication adherence`.
3. If the **Library** field is shown, choose your personal library or a writable group library, then select **Confirm**. The project and all of its items, PDFs, annotations, and managed collections belong to that selected Zotero library.
4. To open an existing project, select its `SLR-` root collection or one of its stage collections in Zotero's library pane. There is no separate **Open Project** command.
5. Inspect **Project Overview** in the item pane while browsing the project. It summarizes Sources, TA screening, FT screening, final included studies, and coding, shows missing-configuration warnings, and provides buttons that navigate to the relevant stage collections.
6. To delete a project, first archive it if appropriate, then choose **File → Evidence Project → Delete Project…**.
7. Select the project, read the warning, type the displayed project name exactly, and select **Delete Project**.

## Expected result

A new project appears as an `SLR-` collection tree with these managed stages:

- `1. Sources`, initially containing `Web of Science`, `Scopus`, and `PubMed`
- `2. TA-Screen Queue`
- `3. TA-Screening Results`, containing `TA-Include`, `TA-Exclude`, and `TA-Unclear`
- `4. FT-Screen Queue`
- `5. FT-Screening Results`, containing `FT-Include`, `FT-Exclude`, and `FT-Unavailable`
- `6. Extract Coding`

Selecting project content makes **Project Overview** available. After a confirmed deletion, the entire project collection tree, every item filed anywhere in it, and the project's Evidence records are permanently removed.

## Notes and limitations

- Project context follows the collection currently selected in Zotero. Dialogs use that context to preselect the owning project when possible.
- A project belongs to exactly one Zotero library. Zotero keys are resolved within that library; a group-library project therefore stays in its chosen group library and uses Zotero group sync for its collections, items, PDFs, and annotations.
- Do not rename, move, delete, or add subcollections inside the managed tree by hand. Evidence relies on its fixed structure and suppresses those collection actions where possible.
- **Delete Project…** is not the same as removing a collection from view. It erases the items as well as the collections and cannot be undone. A mistyped confirmation name cancels deletion.
- Project Overview is a dashboard, not an editing surface. Configure criteria, import records, and perform screening through the dedicated commands and stage panes.

## Related pages

- [Importing and deduplication](importing-and-deduplication.md)
- [Screening criteria](screening-criteria.md)
- [Archive and restore](archive-and-restore.md)
