import {
  ProjectCollectionMap,
  resolveProjectCollections,
} from "./collectionStructure";
import { EvidenceProject, listProjects } from "./projectManager";

export type PaneRole =
  | "screen_queue"
  | "ta_include"
  | "ta_exclude"
  | "ta_unclear"
  | "ft_queue"
  | "ft_include"
  | "coding";

export interface ProjectPaneContext {
  project: EvidenceProject;
  collections: ProjectCollectionMap;
  role: PaneRole;
}

export function getRootCollectionId(project: EvidenceProject): number | null {
  const collection = Zotero.Collections.getByLibraryAndKey(
    Zotero.Libraries.userLibraryID,
    project.collectionKey,
  );
  return collection ? (collection as Zotero.Collection).id : null;
}

async function buildContextMap(): Promise<Map<number, ProjectPaneContext>> {
  const map = new Map<number, ProjectPaneContext>();
  const projects = await listProjects();
  for (const project of projects) {
    const rootId = getRootCollectionId(project);
    if (rootId === null) continue;
    let collections: ProjectCollectionMap;
    try {
      collections = resolveProjectCollections(rootId);
    } catch {
      // Structure incomplete (e.g. mid-creation) -- skip rather than let one
      // bad project break the whole cache/lookup for everyone else.
      continue;
    }
    map.set(collections.screenQueueId, {
      project,
      collections,
      role: "screen_queue",
    });
    map.set(collections.taIncludeId, {
      project,
      collections,
      role: "ta_include",
    });
    map.set(collections.taExcludeId, {
      project,
      collections,
      role: "ta_exclude",
    });
    map.set(collections.taUnclearId, {
      project,
      collections,
      role: "ta_unclear",
    });
    map.set(collections.ftQueueId, {
      project,
      collections,
      role: "ft_queue",
    });
    map.set(collections.ftIncludeId, {
      project,
      collections,
      role: "ft_include",
    });
    map.set(collections.codingId, {
      project,
      collections,
      role: "coding",
    });
  }
  return map;
}

// Zotero.ItemPaneManager's onItemChange must decide setEnabled()
// synchronously -- by the time an async DB lookup resolves and calls
// setEnabled() from a .then(), the pane framework has already rendered with
// the section disabled and never revisits that decision. So the
// collection -> project/role lookup used inside onItemChange has to be a
// synchronous in-memory read; this cache is what makes that possible.
let cache: Map<number, ProjectPaneContext> = new Map();

export async function refreshProjectPaneContextCache(): Promise<void> {
  cache = await buildContextMap();
}

/**
 * Synchronous lookup against the last-refreshed cache. Safe to call from
 * onItemChange; may be one refresh cycle stale (e.g. right after a brand new
 * project is created elsewhere) -- callers that create/modify projects
 * should call refreshProjectPaneContextCache() afterwards.
 */
export function findProjectPaneContextSync(
  collectionId: number | null | undefined,
): ProjectPaneContext | null {
  if (!collectionId) return null;
  return cache.get(collectionId) ?? null;
}

/**
 * Always-fresh (uncached) lookup for call sites that can afford to await --
 * dialogs, batch commands, tests. Not safe to use from onItemChange.
 */
export async function findProjectPaneContext(
  collectionId: number | null | undefined,
): Promise<ProjectPaneContext | null> {
  if (!collectionId) return null;
  const map = await buildContextMap();
  return map.get(collectionId) ?? null;
}
