// Fixed Collection tree per REQUIREMENTS.md 2.1.4. Names are not user-customizable.
export const SOURCE_DATABASE_LABELS = [
  "Web of Science",
  "Scopus",
  "PubMed",
] as const;
export type SourceDatabaseLabel = (typeof SOURCE_DATABASE_LABELS)[number];

// Numbered so Zotero's alphabetically-sorted Collection tree reads
// top-to-bottom in literature-review pipeline order: Sources -> TA-Screen
// Queue -> TA-Screening Results -> FT-Screen Queue -> FT-Screening Results
// -> Extract Coding. Only new projects get these current names/positions --
// resolveProjectCollections() below also recognizes every prior generation
// of names (and FT-Screen Queue's prior nested position under FT-Screening)
// so projects created at any point keep resolving without a migration.
export const TA_QUEUE = "2. TA-Screen Queue";
export const TA_QUEUE_LEGACY_NAMES = ["Screen Queue", "2. Screen Queue"];
export const TA_SCREENING = "3. TA-Screening Results";
export const TA_SCREENING_LEGACY_NAMES = [
  "Title-Abstract Screening",
  "3. Title-Abstract Screening",
];
export const TA_INCLUDE = "TA-Include";
export const TA_EXCLUDE = "TA-Exclude";
export const TA_UNCLEAR = "TA-Unclear";
// FT-Screen Queue used to be nested under Full-Text Screening rather than a
// top-level sibling -- resolveProjectCollections() falls back to searching
// there by this legacy name if it's not found at the root.
export const FT_QUEUE = "4. FT-Screen Queue";
export const FT_QUEUE_LEGACY_NAMES = ["FT-Queue"];
export const FT_SCREENING = "5. FT-Screening Results";
export const FT_SCREENING_LEGACY_NAMES = [
  "Full-Text Screening",
  "4. Full-Text Screening",
];
export const FT_INCLUDE = "FT-Include";
export const FT_EXCLUDE = "FT-Exclude";
export const FT_UNAVAILABLE = "FT-Unavailable";
export const CODING = "6. Extract Coding";
export const CODING_LEGACY_NAMES = ["Coding", "5. Coding"];
export const SOURCES = "1. Sources";
export const SOURCES_LEGACY_NAMES = ["Sources"];

export interface ProjectCollectionMap {
  rootId: number;
  rootKey: string;
  libraryID: number;
  sourcesId: number;
  taQueueId: number;
  // The "3. TA-Screening Results"/"5. FT-Screening Results" parent
  // Collections themselves -- never populated directly by any service
  // (confirmDecision always adds to one of the *Include/*Exclude/*Unclear
  // children below, never to the parent), but a user can still drag an
  // item into either by hand. Exposed so projectContext.ts can map them to
  // PaneRole "other" too, same as sourcesId/rootId, so native panes stay
  // hidden and the title read-only there -- see that file's buildContextMap
  // for the parallel reasoning.
  taScreeningId: number;
  taIncludeId: number;
  taExcludeId: number;
  taUnclearId: number;
  ftQueueId: number;
  ftScreeningId: number;
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

  const taQueue = await createCollection(TA_QUEUE, libraryID, root.id);

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

  const ftQueue = await createCollection(FT_QUEUE, libraryID, root.id);

  const ftScreening = await createCollection(FT_SCREENING, libraryID, root.id);
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
    taQueueId: taQueue.id,
    taScreeningId: taScreening.id,
    taIncludeId: taInclude.id,
    taExcludeId: taExclude.id,
    taUnclearId: taUnclear.id,
    ftQueueId: ftQueue.id,
    ftScreeningId: ftScreening.id,
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
  // Every prior generation of stage names is accepted here, so a project
  // created at any point in this plugin's history keeps resolving without a
  // migration -- see the constant declarations above for the full history
  // of each stage's names.
  const byName = (name: string, legacyNames: string[] = []) =>
    children.find((c) => c.name === name || legacyNames.includes(c.name));

  const sources = byName(SOURCES, SOURCES_LEGACY_NAMES);
  const taQueue = byName(TA_QUEUE, TA_QUEUE_LEGACY_NAMES);
  const taScreening = byName(TA_SCREENING, TA_SCREENING_LEGACY_NAMES);
  const ftScreening = byName(FT_SCREENING, FT_SCREENING_LEGACY_NAMES);
  const coding = byName(CODING, CODING_LEGACY_NAMES);
  if (!sources || !taQueue || !taScreening || !ftScreening || !coding) {
    throw new Error(
      `Project collection structure is incomplete for collection ${rootId}`,
    );
  }

  const taChildren = taScreening.getChildCollections();
  const ftChildren = ftScreening.getChildCollections();
  const taInclude = taChildren.find((c) => c.name === TA_INCLUDE);
  const taExclude = taChildren.find((c) => c.name === TA_EXCLUDE);
  const taUnclear = taChildren.find((c) => c.name === TA_UNCLEAR);
  // FT-Screen Queue is a top-level sibling in new projects (found via
  // byName above, alongside Sources/TA-Screen Queue/etc.) but was nested
  // under FT-Screening in old ones -- fall back to searching there.
  const ftQueue =
    byName(FT_QUEUE, FT_QUEUE_LEGACY_NAMES) ??
    ftChildren.find(
      (c) => c.name === FT_QUEUE || FT_QUEUE_LEGACY_NAMES.includes(c.name),
    );
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
    taQueueId: taQueue.id,
    taScreeningId: taScreening.id,
    taIncludeId: taInclude.id,
    taExcludeId: taExclude.id,
    taUnclearId: taUnclear.id,
    ftQueueId: ftQueue.id,
    ftScreeningId: ftScreening.id,
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
