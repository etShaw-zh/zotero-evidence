import { safeGetField } from "../../utils/zoteroItem";
import { databaseService } from "../db/database";
import {
  ensureSourceCollection,
  ProjectCollectionMap,
} from "../project/collectionStructure";
import {
  normalizeAuthorLastName,
  normalizeDOI,
  normalizeTitle,
  similarityRatio,
} from "./normalize";

const TITLE_SIMILARITY_THRESHOLD = 0.9;

interface CandidateRecord {
  itemKey: string;
  doi: string | null;
  normalizedTitle: string;
  authorLastName: string;
  year: string;
}

export interface DedupSummary {
  newCount: number;
  duplicateCount: number;
}

function getItemYear(item: Zotero.Item): string {
  const date = safeGetField(item, "date");
  const match = date.match(/\d{4}/);
  return match ? match[0] : "";
}

function getFirstAuthorLastName(item: Zotero.Item): string {
  const creators = item.getCreators();
  return normalizeAuthorLastName(creators[0]?.lastName ?? "");
}

function buildRecordSnapshot(item: Zotero.Item): Record<string, unknown> {
  return {
    itemType: item.itemType,
    title: safeGetField(item, "title"),
    creators: item.getCreators().map((c) => ({
      firstName: c.firstName,
      lastName: c.lastName,
    })),
    date: safeGetField(item, "date"),
    DOI: safeGetField(item, "DOI"),
  };
}

function toCandidate(itemKey: string, item: Zotero.Item): CandidateRecord {
  return {
    itemKey,
    doi: normalizeDOI(safeGetField(item, "DOI")),
    normalizedTitle: normalizeTitle(safeGetField(item, "title")),
    authorLastName: getFirstAuthorLastName(item),
    year: getItemYear(item),
  };
}

/**
 * Loads the canonical (non-duplicate) items already recorded for this
 * project, across its entire history -- not just the current TA-Screen Queue --
 * per the incremental-import dedup scope in REQUIREMENTS.md 2.1.3.
 */
async function loadCandidateIndex(
  projectId: number,
  libraryID: number,
): Promise<CandidateRecord[]> {
  const rows = (await databaseService.queryAsync(
    `SELECT DISTINCT item_key FROM item_sources
     WHERE project_id = ? AND is_duplicate_of IS NULL`,
    [projectId],
  )) as { item_key: string }[];

  const candidates: CandidateRecord[] = [];
  for (const row of rows || []) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, row.item_key);
    if (item) candidates.push(toCandidate(row.item_key, item as Zotero.Item));
  }
  return candidates;
}

function findMatch(
  target: CandidateRecord,
  candidates: CandidateRecord[],
): CandidateRecord | undefined {
  if (target.doi) {
    const doiMatch = candidates.find((c) => c.doi === target.doi);
    if (doiMatch) return doiMatch;
  }
  return candidates.find((c) => {
    if (!target.year || c.year !== target.year) return false;
    if (!target.authorLastName || c.authorLastName !== target.authorLastName)
      return false;
    if (!target.normalizedTitle || !c.normalizedTitle) return false;
    if (target.normalizedTitle === c.normalizedTitle) return true;
    return (
      similarityRatio(target.normalizedTitle, c.normalizedTitle) >=
      TITLE_SIMILARITY_THRESHOLD
    );
  });
}

async function recordItemSource(
  projectId: number,
  itemKey: string,
  sourceDatabase: string,
  originalRecord: Record<string, unknown>,
  isDuplicateOf: string | null,
): Promise<void> {
  await databaseService.queryAsync(
    `INSERT INTO item_sources (project_id, item_key, source_database, imported_at, original_record, is_duplicate_of)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      itemKey,
      sourceDatabase,
      new Date().toISOString(),
      JSON.stringify(originalRecord),
      isDuplicateOf,
    ],
  );
}

/**
 * Given freshly-imported (but not yet filed) Zotero items, decides which are
 * new vs. duplicates of items already in the project's history:
 *  - New items are filed into Sources/<sourceLabel> and TA-Screen Queue.
 *  - Duplicates are recorded for provenance (their snapshot is preserved in
 *    item_sources.original_record) and then erased, so the library doesn't
 *    accumulate orphan duplicate entries outside any project collection.
 */
export async function processImportedItems(
  projectId: number,
  collections: ProjectCollectionMap,
  sourceLabel: string,
  items: Zotero.Item[],
): Promise<DedupSummary> {
  const candidates = await loadCandidateIndex(projectId, collections.libraryID);
  const sourceCollectionId = await ensureSourceCollection(
    collections.sourcesId,
    collections.libraryID,
    sourceLabel,
  );

  let newCount = 0;
  let duplicateCount = 0;

  for (const item of items) {
    if (!item.isRegularItem()) continue;

    const candidate = toCandidate(item.key, item);
    const match = findMatch(candidate, candidates);
    const snapshot = buildRecordSnapshot(item);

    if (match) {
      const duplicateKey = item.key;
      await recordItemSource(
        projectId,
        duplicateKey,
        sourceLabel,
        snapshot,
        match.itemKey,
      );
      await item.eraseTx();
      duplicateCount++;
    } else {
      await item.addToCollection(sourceCollectionId);
      await item.addToCollection(collections.taQueueId);
      await item.saveTx();
      await recordItemSource(projectId, item.key, sourceLabel, snapshot, null);
      candidates.push(candidate);
      newCount++;
    }
  }

  return { newCount, duplicateCount };
}
