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
  | "ft_exclude"
  | "ft_unavailable"
  | "coding";

export interface ProjectPaneContext {
  project: EvidenceProject;
  collections: ProjectCollectionMap;
  role: PaneRole;
}

export function getRootCollectionId(project: EvidenceProject): number | null {
  const collection = Zotero.Collections.getByLibraryAndKey(
    project.libraryID,
    project.collectionKey,
  );
  return collection ? (collection as Zotero.Collection).id : null;
}

async function buildContextMap(): Promise<{
  paneContexts: Map<number, ProjectPaneContext>;
  ownedCollectionIds: Set<number>;
  collectionOwnerProjectId: Map<number, number>;
}> {
  const map = new Map<number, ProjectPaneContext>();
  const ownedCollectionIds = new Set<number>();
  const collectionOwnerProjectId = new Map<number, number>();
  const projects = await listProjects();
  for (const project of projects) {
    const rootId = getRootCollectionId(project);
    if (rootId === null) continue;
    // Every Collection this project owns, not just the 9 pane-mapped roles
    // below (Sources, its WoS/Scopus/PubMed children, TA-/FT-Screening
    // parents, ...) -- used to hide the native "New Subcollection"/"Rename"/
    // "Move To"/"Copy To"/"Delete Collection(...)" menu items on any of
    // them, since editing this plugin-managed tree by hand would break the
    // by-name resolution resolveProjectCollections() relies on. Also used
    // (via collectionOwnerProjectId below) to default a dialog's "which
    // project" picker to whatever project the user actually has selected --
    // e.g. its root or "1. Sources" Collection, not just the 9 leaf/queue
    // ones paneContexts maps.
    ownedCollectionIds.add(rootId);
    collectionOwnerProjectId.set(rootId, project.id);
    const root = Zotero.Collections.get(rootId) as Zotero.Collection;
    for (const d of root.getDescendents(false, "collection")) {
      ownedCollectionIds.add(d.id);
      collectionOwnerProjectId.set(d.id, project.id);
    }
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
    map.set(collections.ftExcludeId, {
      project,
      collections,
      role: "ft_exclude",
    });
    map.set(collections.ftUnavailableId, {
      project,
      collections,
      role: "ft_unavailable",
    });
    map.set(collections.codingId, {
      project,
      collections,
      role: "coding",
    });
  }
  return { paneContexts: map, ownedCollectionIds, collectionOwnerProjectId };
}

// Zotero.ItemPaneManager's onItemChange must decide setEnabled()
// synchronously -- by the time an async DB lookup resolves and calls
// setEnabled() from a .then(), the pane framework has already rendered with
// the section disabled and never revisits that decision. So the
// collection -> project/role lookup used inside onItemChange has to be a
// synchronous in-memory read; this cache is what makes that possible. The
// collection context menu's popupshowing handler (collectionMenuGuard.ts)
// has the same synchronous constraint, hence ownedCollectionIds living here
// too rather than as a separate always-fresh lookup.
let cache: Map<number, ProjectPaneContext> = new Map();
let ownedCollectionIdCache: Set<number> = new Set();
let collectionOwnerProjectIdCache: Map<number, number> = new Map();

export async function refreshProjectPaneContextCache(): Promise<void> {
  const built = await buildContextMap();
  cache = built.paneContexts;
  ownedCollectionIdCache = built.ownedCollectionIds;
  collectionOwnerProjectIdCache = built.collectionOwnerProjectId;
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
 * Synchronous "is this Collection anywhere in an Evidence project's tree"
 * check -- root, Sources, its source-database children, TA-/FT-Screening
 * parents, every stage collection, all of it. Same staleness caveat as
 * findProjectPaneContextSync.
 */
export function isProjectOwnedCollectionSync(
  collectionId: number | null | undefined,
): boolean {
  if (!collectionId) return false;
  return ownedCollectionIdCache.has(collectionId);
}

/**
 * Always-fresh (uncached) lookup for call sites that can afford to await --
 * dialogs, batch commands, tests. Not safe to use from onItemChange.
 */
export async function findProjectPaneContext(
  collectionId: number | null | undefined,
): Promise<ProjectPaneContext | null> {
  if (!collectionId) return null;
  const { paneContexts } = await buildContextMap();
  return paneContexts.get(collectionId) ?? null;
}

/**
 * Which project (if any) owns the given Collection, anywhere in its tree --
 * root, "1. Sources", per-source-database children, TA-/FT-Screening
 * parents, every stage collection. Always-fresh (uncached), for dialogs
 * deciding which project to default their project picker to based on the
 * Collection the user currently has selected in the library pane.
 */
export async function findOwningProjectId(
  collectionId: number | null | undefined,
): Promise<number | null> {
  if (!collectionId) return null;
  const { collectionOwnerProjectId } = await buildContextMap();
  return collectionOwnerProjectId.get(collectionId) ?? null;
}

/**
 * Synchronous cached version of findOwningProjectId. Same staleness caveat
 * as findProjectPaneContextSync.
 */
export function findOwningProjectIdSync(
  collectionId: number | null | undefined,
): number | null {
  if (!collectionId) return null;
  return collectionOwnerProjectIdCache.get(collectionId) ?? null;
}
