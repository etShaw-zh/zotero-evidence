import { databaseService } from "../modules/db/database";

// Zotero.Item#key is per-library and gets reassigned every time an item is
// recreated from JSON -- both on a project's own backup/restore round trip
// (archiveImportService.ts always mints a fresh key) AND, more importantly,
// when a *scoped sample archive* (humanConsistencyService.ts's startRound)
// is independently imported into a different reviewer's own library: their
// copy's key has no relationship at all to the coordinator's copy, and
// there is no shared database between two independent Zotero installs --
// A's and B's zoteroEvidence.sqlite never talk to each other. The only
// things that ever travel between them are the sample archive (A -> B) and
// a reviewer's later "Export Screening Log" CSV (B -> A), so whatever id
// the two sides are meant to agree on has to ride along inside one of
// those two files.
//
// That does NOT mean it has to be embedded in the Zotero item's own data
// (Extra field, tags, ...) -- doing that risks colliding with Better
// BibTeX's citation keys or any other plugin's own use of those same
// user-facing fields, and is visible/editable by the user, who has no
// reason to know not to touch it. Instead, this id lives ENTIRELY in this
// plugin's own database (the item_stable_ids table) on whichever machine
// currently holds it, and rides through an export/import round trip as a
// sibling field on ArchiveItem (see archiveTypes.ts) -- a plugin-authored
// file, not the item's own bibliographic JSON. archiveExportService.ts
// reads it from the exporting side's own DB; archiveImportService.ts
// writes it into the importing side's own DB, unchanged, keyed by the
// project_id + item_key it has *there*.
export async function getStableItemId(
  projectId: number,
  itemKey: string,
): Promise<string> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT stable_id FROM item_stable_ids WHERE project_id = ? AND item_key = ?`,
    [projectId, itemKey],
  )) as { stable_id: string }[] | undefined;
  return rows?.[0]?.stable_id ?? "";
}

/**
 * Gets the item's existing stable id, or mints and persists a fresh one if
 * it doesn't have one yet under this project_id + item_key. Called by
 * dedupService.ts the moment a genuinely new item enters a project (the
 * common case, giving every item an id from day one), and by
 * archiveExportService.ts as a backstop for any item that predates that --
 * e.g. one already in a project from before this feature existed.
 * Idempotent -- re-running this on an item that already has an id is a
 * no-op read.
 */
export async function ensureStableItemId(
  projectId: number,
  itemKey: string,
): Promise<string> {
  const existing = await getStableItemId(projectId, itemKey);
  if (existing) return existing;

  const id = crypto.randomUUID();
  await databaseService.init();
  await databaseService.queryAsync(
    `INSERT INTO item_stable_ids (project_id, item_key, stable_id, created_at) VALUES (?, ?, ?, ?)`,
    [projectId, itemKey, id, new Date().toISOString()],
  );
  return id;
}

/**
 * Records a specific stable id (carried over from an archive's
 * ArchiveItem.stableId, or a reviewer's CSV row) against a project_id +
 * item_key that doesn't have one yet -- used by archiveImportService.ts
 * so a restored/imported item keeps the SAME id it arrived with, rather
 * than minting an unrelated new one via ensureStableItemId. A no-op if
 * this project_id + item_key already has an id (shouldn't happen for a
 * freshly-created import, but importing the same archive twice must never
 * silently overwrite an existing row with someone else's id).
 */
export async function recordStableItemId(
  projectId: number,
  itemKey: string,
  stableId: string,
): Promise<void> {
  if (!stableId) return;
  const existing = await getStableItemId(projectId, itemKey);
  if (existing) return;
  await databaseService.init();
  await databaseService.queryAsync(
    `INSERT INTO item_stable_ids (project_id, item_key, stable_id, created_at) VALUES (?, ?, ?, ?)`,
    [projectId, itemKey, stableId, new Date().toISOString()],
  );
}
