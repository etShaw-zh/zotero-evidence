// Fixed Collection tree per REQUIREMENTS.md 2.1.4. Names are not user-customizable.
export const SOURCE_DATABASE_LABELS = [
  "Web of Science",
  "Scopus",
  "PubMed",
] as const;
export type SourceDatabaseLabel = (typeof SOURCE_DATABASE_LABELS)[number];

export const SCREEN_QUEUE = "Screen Queue";
export const TA_SCREENING = "Title-Abstract Screening";
export const TA_INCLUDE = "TA-Include";
export const TA_EXCLUDE = "TA-Exclude";
export const TA_UNCLEAR = "TA-Unclear";
export const FT_SCREENING = "Full-Text Screening";
export const FT_QUEUE = "FT-Queue";
export const FT_INCLUDE = "FT-Include";
export const FT_EXCLUDE = "FT-Exclude";
export const FT_UNAVAILABLE = "FT-Unavailable";
export const CODING = "Coding";
export const SOURCES = "Sources";

export interface ProjectCollectionMap {
  rootId: number;
  rootKey: string;
  libraryID: number;
  sourcesId: number;
  screenQueueId: number;
  taIncludeId: number;
  taExcludeId: number;
  taUnclearId: number;
  ftQueueId: number;
  ftIncludeId: number;
  ftExcludeId: number;
  ftUnavailableId: number;
  codingId: number;
  sourceCollectionIds: Record<string, number>;
}

async function createCollection(
  name: string,
  libraryID: number,
  parentID?: number,
): Promise<Zotero.Collection> {
  const collection = new Zotero.Collection({ name, libraryID, parentID });
  await collection.saveTx();
  return collection;
}

/**
 * Creates the full fixed Collection tree for a new Evidence project.
 * Sub-collections for stages not yet reachable (TA/FT/Coding) are created
 * upfront so later phases don't need extra migration logic.
 */
export async function createProjectCollectionStructure(
  projectName: string,
  libraryID: number = Zotero.Libraries.userLibraryID,
): Promise<ProjectCollectionMap> {
  const root = await createCollection(projectName, libraryID);

  const sources = await createCollection(SOURCES, libraryID, root.id);
  const sourceCollectionIds: Record<string, number> = {};
  for (const label of SOURCE_DATABASE_LABELS) {
    const c = await createCollection(label, libraryID, sources.id);
    sourceCollectionIds[label] = c.id;
  }

  const screenQueue = await createCollection(SCREEN_QUEUE, libraryID, root.id);

  const taScreening = await createCollection(TA_SCREENING, libraryID, root.id);
  const taInclude = await createCollection(
    TA_INCLUDE,
    libraryID,
    taScreening.id,
  );
  const taExclude = await createCollection(
    TA_EXCLUDE,
    libraryID,
    taScreening.id,
  );
  const taUnclear = await createCollection(
    TA_UNCLEAR,
    libraryID,
    taScreening.id,
  );

  const ftScreening = await createCollection(FT_SCREENING, libraryID, root.id);
  const ftQueue = await createCollection(FT_QUEUE, libraryID, ftScreening.id);
  const ftInclude = await createCollection(
    FT_INCLUDE,
    libraryID,
    ftScreening.id,
  );
  const ftExclude = await createCollection(
    FT_EXCLUDE,
    libraryID,
    ftScreening.id,
  );
  const ftUnavailable = await createCollection(
    FT_UNAVAILABLE,
    libraryID,
    ftScreening.id,
  );

  const coding = await createCollection(CODING, libraryID, root.id);

  return {
    rootId: root.id,
    rootKey: root.key,
    libraryID,
    sourcesId: sources.id,
    screenQueueId: screenQueue.id,
    taIncludeId: taInclude.id,
    taExcludeId: taExclude.id,
    taUnclearId: taUnclear.id,
    ftQueueId: ftQueue.id,
    ftIncludeId: ftInclude.id,
    ftExcludeId: ftExclude.id,
    ftUnavailableId: ftUnavailable.id,
    codingId: coding.id,
    sourceCollectionIds,
  };
}

/**
 * Re-derives the Collection id map for an existing project by walking child
 * collections by name, rather than caching ids that could go stale if the
 * user renames/reorganizes collections directly in Zotero.
 */
export function resolveProjectCollections(
  rootId: number,
): ProjectCollectionMap {
  const root = Zotero.Collections.get(rootId) as Zotero.Collection;
  const libraryID = root.libraryID;
  const children = root.getChildCollections();
  const byName = (name: string) => children.find((c) => c.name === name);

  const sources = byName(SOURCES);
  const screenQueue = byName(SCREEN_QUEUE);
  const taScreening = byName(TA_SCREENING);
  const ftScreening = byName(FT_SCREENING);
  const coding = byName(CODING);
  if (!sources || !screenQueue || !taScreening || !ftScreening || !coding) {
    throw new Error(
      `Project collection structure is incomplete for collection ${rootId}`,
    );
  }

  const taChildren = taScreening.getChildCollections();
  const ftChildren = ftScreening.getChildCollections();
  const taInclude = taChildren.find((c) => c.name === TA_INCLUDE);
  const taExclude = taChildren.find((c) => c.name === TA_EXCLUDE);
  const taUnclear = taChildren.find((c) => c.name === TA_UNCLEAR);
  const ftQueue = ftChildren.find((c) => c.name === FT_QUEUE);
  const ftInclude = ftChildren.find((c) => c.name === FT_INCLUDE);
  const ftExclude = ftChildren.find((c) => c.name === FT_EXCLUDE);
  const ftUnavailable = ftChildren.find((c) => c.name === FT_UNAVAILABLE);
  if (
    !taInclude ||
    !taExclude ||
    !taUnclear ||
    !ftQueue ||
    !ftInclude ||
    !ftExclude ||
    !ftUnavailable
  ) {
    throw new Error(
      `Project collection structure is incomplete for collection ${rootId}`,
    );
  }

  const sourceCollectionIds: Record<string, number> = {};
  for (const c of sources.getChildCollections()) {
    sourceCollectionIds[c.name] = c.id;
  }

  return {
    rootId: root.id,
    rootKey: root.key,
    libraryID,
    sourcesId: sources.id,
    screenQueueId: screenQueue.id,
    taIncludeId: taInclude.id,
    taExcludeId: taExclude.id,
    taUnclearId: taUnclear.id,
    ftQueueId: ftQueue.id,
    ftIncludeId: ftInclude.id,
    ftExcludeId: ftExclude.id,
    ftUnavailableId: ftUnavailable.id,
    codingId: coding.id,
    sourceCollectionIds,
  };
}

/**
 * Returns the Sources sub-collection id for a given source database label,
 * creating it if the project didn't have one yet (e.g. a source added after
 * Phase 1's fixed WoS/Scopus/PubMed set).
 */
export async function ensureSourceCollection(
  sourcesId: number,
  libraryID: number,
  sourceLabel: string,
): Promise<number> {
  const sources = Zotero.Collections.get(sourcesId) as Zotero.Collection;
  const existing = sources
    .getChildCollections()
    .find((c) => c.name === sourceLabel);
  if (existing) return existing.id;
  const created = await createCollection(sourceLabel, libraryID, sourcesId);
  return created.id;
}
