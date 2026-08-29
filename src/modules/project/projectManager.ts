import { databaseService } from "../db/database";
import { createProjectCollectionStructure } from "./collectionStructure";

export interface EvidenceProject {
  id: number;
  name: string;
  collectionKey: string;
  createdAt: string;
  updatedAt: string;
  status: string;
}

function rowToProject(row: any): EvidenceProject {
  return {
    id: row.id,
    name: row.name,
    collectionKey: row.collection_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
  };
}

/**
 * Creates the fixed Collection tree and the owning evidence_projects row.
 * A project is "marked" as a zotero-evidence project purely by having a
 * matching row here (collection_key -> root Collection key) -- nothing is
 * written onto the Zotero Collection itself.
 */
export async function createProject(name: string): Promise<EvidenceProject> {
  await databaseService.init();
  const collections = await createProjectCollectionStructure(name);
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `INSERT INTO evidence_projects (name, collection_key, created_at, updated_at, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [name, collections.rootKey, now, now],
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
