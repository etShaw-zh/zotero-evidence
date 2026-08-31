import { databaseService } from "../db/database";
import { createProjectCollectionStructure } from "./collectionStructure";

export interface EvidenceProject {
  id: number;
  name: string;
  collectionKey: string;
  // Which Zotero library the project's Collection tree lives in -- almost
  // always the personal library, but a project can live in a writable Group
  // Library instead (so its items/collections/PDFs/annotations sync via
  // Zotero's own group sync). Every item_key/annotation_key/collection_key
  // this plugin stores is only unique *within* this library, since Zotero
  // keys aren't globally unique across libraries -- so this is what every
  // Zotero.Collections/Items.getByLibraryAndKey() lookup elsewhere in the
  // codebase must use instead of assuming Zotero.Libraries.userLibraryID.
  libraryID: number;
  createdAt: string;
  updatedAt: string;
  status: string;
}

function rowToProject(row: any): EvidenceProject {
  return {
    id: row.id,
    name: row.name,
    collectionKey: row.collection_key,
    // Pre-migration rows have no library_id column value -- they all
    // predate group-library support, so they were necessarily created in
    // the personal library. See schema.ts's COLUMN_MIGRATIONS comment.
    libraryID: row.library_id ?? Zotero.Libraries.userLibraryID,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
  };
}

const SLR_PREFIX = "SLR-";

/**
 * Creates the fixed Collection tree and the owning evidence_projects row.
 * A project is "marked" as a zotero-evidence project purely by having a
 * matching row here (collection_key -> root Collection key) -- nothing is
 * written onto the Zotero Collection itself.
 *
 * The stored name gets an "SLR-" prefix -- every UI surface (option
 * pickers, dialogs, export filenames) reads `project.name` from this row,
 * not the Collection's own `.name`, so the prefix has to live here to stay
 * in sync with the actual Collection tree rather than only on the
 * Collection. Avoids double-prefixing if the caller already included it.
 */
export async function createProject(
  name: string,
  libraryID: number = Zotero.Libraries.userLibraryID,
): Promise<EvidenceProject> {
  await databaseService.init();
  const prefixedName = name.startsWith(SLR_PREFIX)
    ? name
    : `${SLR_PREFIX}${name}`;
  const collections = await createProjectCollectionStructure(
    prefixedName,
    libraryID,
  );
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `INSERT INTO evidence_projects (name, collection_key, library_id, created_at, updated_at, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [prefixedName, collections.rootKey, libraryID, now, now],
  );
  const project = await getProjectByCollectionKey(collections.rootKey);
  if (!project) {
    throw new Error(
      `Failed to read back newly created project for collection ${collections.rootKey}`,
    );
  }
  return project;
}

export async function listProjects(): Promise<EvidenceProject[]> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT * FROM evidence_projects ORDER BY created_at DESC`,
  )) as any[];
  return (rows || []).map(rowToProject);
}

export async function getProjectByCollectionKey(
  collectionKey: string,
): Promise<EvidenceProject | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT * FROM evidence_projects WHERE collection_key = ?`,
    [collectionKey],
  )) as any[];
  return rows && rows[0] ? rowToProject(rows[0]) : null;
}

export async function getProjectById(
  id: number,
): Promise<EvidenceProject | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT * FROM evidence_projects WHERE id = ?`,
    [id],
  )) as any[];
  return rows && rows[0] ? rowToProject(rows[0]) : null;
}

/**
 * Permanently deletes a project: every Collection in its tree (root and all
 * descendants), every Item filed anywhere in that tree (not just trashed --
 * actually erased, since the confirmation dialog promises this can't be
 * undone), and every row this plugin's own tables hold for the project.
 *
 * Deletes items before the root Collection so getDescendents() still has a
 * tree to walk; deletes DB rows in child-before-parent order to respect the
 * FK relationships in schema.ts (real Zotero's SQLite enforces them even
 * though the test harness doesn't).
 */
export async function deleteProject(projectId: number): Promise<void> {
  await databaseService.init();
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error(`No evidence project found with id ${projectId}`);
  }

  const root = Zotero.Collections.getByLibraryAndKey(
    project.libraryID,
    project.collectionKey,
  ) as Zotero.Collection | false;
  if (root) {
    const itemIds = root.getDescendents(false, "item", true).map((d) => d.id);
    for (const itemId of itemIds) {
      const item = Zotero.Items.get(itemId);
      if (item) await item.eraseTx();
    }
    await root.eraseTx();
  }

  await databaseService.executeTransaction(async () => {
    await databaseService.queryAsync(
      `DELETE FROM synthesis_themes WHERE coding_record_id IN
       (SELECT id FROM coding_records WHERE project_id = ?)`,
      [projectId],
    );
    for (const table of [
      "coding_records",
      "codebooks",
      "screening_records",
      "screening_criteria",
      "item_sources",
    ]) {
      await databaseService.queryAsync(
        `DELETE FROM ${table} WHERE project_id = ?`,
        [projectId],
      );
    }
    await databaseService.queryAsync(
      `DELETE FROM evidence_projects WHERE id = ?`,
      [projectId],
    );
  });
}
