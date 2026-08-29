import { processImportedItems } from "../dedup/dedupService";
import { resolveProjectCollections } from "../project/collectionStructure";
import { importItemsFromFile } from "./translate";

export interface ImportResult {
  totalParsed: number;
  newCount: number;
  duplicateCount: number;
}

/**
 * Imports one exported-search-results file into a project's Sources
 * collection, then runs dedup (see dedupService) to decide Screen Queue
 * membership.
 */
export async function importLiteratureFile(
  projectId: number,
  rootCollectionId: number,
  sourceLabel: string,
  filePath: string,
): Promise<ImportResult> {
  const collections = resolveProjectCollections(rootCollectionId);
  const items = await importItemsFromFile(filePath, collections.libraryID);
  const { newCount, duplicateCount } = await processImportedItems(
    projectId,
    collections,
    sourceLabel,
    items,
  );
  return { totalParsed: items.length, newCount, duplicateCount };
}
