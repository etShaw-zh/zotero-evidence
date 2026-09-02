import {
  ProjectCollectionMap,
  resolveProjectCollections,
} from "../project/collectionStructure";
import {
  getRootCollectionId,
  refreshProjectPaneContextCache,
} from "../project/projectContext";
import {
  createProject,
  EvidenceProject,
  listProjects,
} from "../project/projectManager";
import { databaseService } from "../db/database";
import { ArchiveManifest, MANIFEST_FILENAME } from "./archiveTypes";
import { unzipToDirectory } from "./zipUtil";

function collectionIdForRole(
  role: string,
  collections: ProjectCollectionMap,
): number | null {
  if (role === "sources") return collections.sourcesId;
  if (role.startsWith("sources:")) {
    return (
      collections.sourceCollectionIds[role.slice("sources:".length)] ?? null
    );
  }
  switch (role) {
    case "taQueue":
      return collections.taQueueId;
    case "taInclude":
      return collections.taIncludeId;
    case "taExclude":
      return collections.taExcludeId;
    case "taUnclear":
      return collections.taUnclearId;
    case "ftQueue":
      return collections.ftQueueId;
    case "ftInclude":
      return collections.ftIncludeId;
    case "ftExclude":
      return collections.ftExcludeId;
    case "ftUnavailable":
      return collections.ftUnavailableId;
    case "coding":
      return collections.codingId;
    default:
      return null;
  }
}

async function uniqueProjectName(baseName: string): Promise<string> {
  const existing = new Set((await listProjects()).map((p) => p.name));
  if (!existing.has(baseName)) return baseName;
  let n = 2;
  while (existing.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

/**
 * Strips fields a fresh Zotero.Item must assign itself (key, version,
 * timestamps, its own collections/relations) from an archived item's
 * toJSON() snapshot before feeding it to fromJSON() -- reusing the
 * *original* key/version here would either collide or desync this
 * (different-library) copy from Zotero's own sync/versioning state.
 * Collection membership is handled separately via each item's `roles`.
 */
function sanitizeItemJson(
  json: Record<string, unknown>,
): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...json };
  delete clone.key;
  delete clone.version;
  delete clone.dateAdded;
  delete clone.dateModified;
  delete clone.collections;
  delete clone.relations;
  return clone;
}

/**
 * Restores a project from a .zip produced by exportProjectArchive(): always
 * creates a brand-new project (auto-suffixing the name on a collision, per
 * REQUIREMENTS -- Archive & Share), never overwrites an existing one.
 *
 * `libraryID` defaults to the personal library (matching the pre-group-
 * library-support behavior of always restoring there) but can target any
 * writable library instead -- the archive itself carries no library of its
 * own, since a project can be archived from one library and restored into
 * a different one entirely (that's the whole point of letting the caller
 * choose here rather than baking the original library into the manifest).
 */
export async function importProjectArchive(
  zipPath: string,
  libraryID: number = Zotero.Libraries.userLibraryID,
): Promise<EvidenceProject> {
  await databaseService.init();

  const stagingDir = Zotero.getTempDirectory() as any;
  stagingDir.append(`evidence-restore-${Date.now()}`);
  await (Zotero.File as any).createDirectoryIfMissingAsync(stagingDir.path, {
    ignoreExisting: true,
  });

  try {
    unzipToDirectory(zipPath, stagingDir.path);

    const manifestFile = Zotero.File.pathToFile(stagingDir.path) as any;
    manifestFile.append(MANIFEST_FILENAME);
    if (!manifestFile.exists()) {
      throw new Error(
        "This file doesn't look like a Zotero Evidence archive (manifest.json missing).",
      );
    }
    const manifest = JSON.parse(
      (await Zotero.File.getContentsAsync(manifestFile.path)) as string,
    ) as ArchiveManifest;

    const projectName = await uniqueProjectName(manifest.project.name);
    const project = await createProject(projectName, libraryID);
    const rootId = getRootCollectionId(project);
    if (rootId === null) {
      throw new Error(
        "Failed to resolve the newly created project's root collection.",
      );
    }
    const collections = resolveProjectCollections(rootId);

    const itemKeyMap = new Map<string, string>(); // old item key -> new
    const annotationKeyMap = new Map<string, string>(); // old -> new

    for (const archiveItem of manifest.items) {
      const json = sanitizeItemJson(archiveItem.json);
      const newItem = new (Zotero.Item as any)(json.itemType) as Zotero.Item;
      newItem.libraryID = collections.libraryID;
      newItem.fromJSON(json);
      await newItem.saveTx();
      itemKeyMap.set(archiveItem.key, newItem.key);

      for (const role of archiveItem.roles) {
        const collectionId = collectionIdForRole(role, collections);
        if (collectionId === null) continue;
        newItem.addToCollection(collectionId);
      }
      if (archiveItem.roles.length > 0) await newItem.saveTx();

      for (const attachment of archiveItem.attachments) {
        const sourceFile = Zotero.File.pathToFile(stagingDir.path) as any;
        for (const part of attachment.relPath.split("/")) {
          if (part) sourceFile.append(part);
        }
        if (!sourceFile.exists()) continue;

        const newAttachment = await Zotero.Attachments.importFromFile({
          file: sourceFile.path,
          parentItemID: newItem.id,
          title: attachment.title,
          contentType: attachment.contentType,
        });

        for (const annotation of attachment.annotations) {
          const newAnnotation = new Zotero.Item("annotation");
          newAnnotation.libraryID = newAttachment.libraryID;
          (newAnnotation as any).parentID = newAttachment.id;
          (newAnnotation as any).annotationType = annotation.type;
          (newAnnotation as any).annotationText = annotation.text;
          (newAnnotation as any).annotationComment = annotation.comment;
          (newAnnotation as any).annotationColor = annotation.color;
          (newAnnotation as any).annotationPosition = annotation.position;
          (newAnnotation as any).annotationPageLabel = annotation.pageLabel;
          (newAnnotation as any).annotationSortIndex = annotation.sortIndex;
          await newAnnotation.saveTx();
          annotationKeyMap.set(annotation.key, newAnnotation.key);
        }
      }
    }

    const criteriaIdByStageVersion = new Map<string, number>();
    for (const c of manifest.screeningCriteria) {
      await databaseService.queryAsync(
        `INSERT INTO screening_criteria (project_id, stage, version, criteria, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [project.id, c.stage, c.version, c.criteria, c.createdAt],
      );
      criteriaIdByStageVersion.set(
        `${c.stage}:${c.version}`,
        await databaseService.getLastInsertId(),
      );
    }

    for (const r of manifest.screeningRecords) {
      const newItemKey = itemKeyMap.get(r.itemKey);
      if (!newItemKey) continue;
      const criteriaId =
        r.criteriaVersion !== null
          ? (criteriaIdByStageVersion.get(`${r.stage}:${r.criteriaVersion}`) ??
            null)
          : null;
      await databaseService.queryAsync(
        `INSERT INTO screening_records
          (project_id, item_key, stage, criteria_id, fulltext_ready, fulltext_ready_at,
           fulltext_ready_by, decision, exclusion_reason, annotation_key, pending_position,
           ai_decision, ai_reasoning, ai_model, human_decision, human_reasoning, decided_by, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          newItemKey,
          r.stage,
          criteriaId,
          r.fulltextReady,
          r.fulltextReadyAt,
          r.fulltextReadyBy,
          r.decision,
          r.exclusionReason,
          r.annotationKey
            ? (annotationKeyMap.get(r.annotationKey) ?? null)
            : null,
          r.pendingPosition,
          r.aiDecision,
          r.aiReasoning,
          r.aiModel,
          r.humanDecision,
          r.humanReasoning,
          r.decidedBy,
          r.decidedAt,
        ],
      );
    }

    for (const c of manifest.ftCriterionChecks ?? []) {
      const newItemKey = itemKeyMap.get(c.itemKey);
      if (!newItemKey) continue;
      await databaseService.queryAsync(
        `INSERT INTO ft_criterion_checks
          (project_id, item_key, criterion_type, criterion_text, verdict, reasoning, quote,
           annotation_key, pending_position, source, confirmed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          newItemKey,
          c.criterionType,
          c.criterionText,
          c.verdict,
          c.reasoning,
          c.quote,
          c.annotationKey
            ? (annotationKeyMap.get(c.annotationKey) ?? null)
            : null,
          c.pendingPosition,
          c.source,
          c.confirmed,
          c.createdAt,
          c.updatedAt,
        ],
      );
    }

    const codebookIdByVersion = new Map<number, number>();
    for (const cb of manifest.codebooks) {
      await databaseService.queryAsync(
        `INSERT INTO codebooks (project_id, version, locked, variables, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          cb.version,
          cb.locked,
          cb.variables,
          cb.createdAt,
          cb.updatedAt,
        ],
      );
      codebookIdByVersion.set(
        cb.version,
        await databaseService.getLastInsertId(),
      );
    }

    const codingRecordIdByIndex = new Map<number, number>();
    for (const cr of manifest.codingRecords) {
      const newItemKey = itemKeyMap.get(cr.itemKey);
      if (!newItemKey) continue;
      const codebookId = codebookIdByVersion.get(cr.codebookVersion) ?? null;
      if (codebookId === null) continue;
      await databaseService.queryAsync(
        `INSERT INTO coding_records
          (project_id, codebook_id, item_key, annotation_key, pending_position, variable_name,
           variable_value, page_number, quote, is_pilot, source, confirmed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          codebookId,
          newItemKey,
          cr.annotationKey
            ? (annotationKeyMap.get(cr.annotationKey) ?? null)
            : null,
          cr.pendingPosition,
          cr.variableName,
          cr.variableValue,
          cr.pageNumber,
          cr.quote,
          cr.isPilot,
          cr.source,
          cr.confirmed,
          cr.createdAt,
          cr.updatedAt,
        ],
      );
      codingRecordIdByIndex.set(
        cr.index,
        await databaseService.getLastInsertId(),
      );
    }

    for (const theme of manifest.synthesisThemes) {
      const codingRecordId = codingRecordIdByIndex.get(theme.codingRecordIndex);
      if (!codingRecordId) continue;
      await databaseService.queryAsync(
        `INSERT INTO synthesis_themes (coding_record_id, theme, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [codingRecordId, theme.theme, theme.createdAt, theme.updatedAt],
      );
    }

    await refreshProjectPaneContextCache();
    return project;
  } finally {
    if (stagingDir.exists()) stagingDir.remove(true);
  }
}
