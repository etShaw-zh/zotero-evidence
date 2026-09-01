import {
  ProjectCollectionMap,
  resolveProjectCollections,
} from "../project/collectionStructure";
import { getRootCollectionId } from "../project/projectContext";
import { EvidenceProject, getProjectById } from "../project/projectManager";
import { databaseService } from "../db/database";
import {
  ArchiveAnnotation,
  ArchiveAttachment,
  ArchiveCodebook,
  ArchiveCodingRecord,
  ArchiveItem,
  ArchiveManifest,
  ArchiveScreeningCriteria,
  ArchiveScreeningRecord,
  ArchiveSynthesisTheme,
  MANIFEST_FILENAME,
} from "./archiveTypes";

// zotero-types has no copyFile typing (see file.d.ts) even though it exists
// on the real Zotero.File API (chrome/content/zotero/xpcom/file.js) -- cast
// through `any`, same approach the rest of this module takes for
// low-level/untyped Zotero internals.
const ZoteroFileAny = Zotero.File as any;

function roleMap(collections: ProjectCollectionMap): Map<number, string> {
  const map = new Map<number, string>();
  map.set(collections.sourcesId, "sources");
  for (const [label, id] of Object.entries(collections.sourceCollectionIds)) {
    map.set(id, `sources:${label}`);
  }
  map.set(collections.screenQueueId, "screenQueue");
  map.set(collections.taIncludeId, "taInclude");
  map.set(collections.taExcludeId, "taExclude");
  map.set(collections.taUnclearId, "taUnclear");
  map.set(collections.ftQueueId, "ftQueue");
  map.set(collections.ftIncludeId, "ftInclude");
  map.set(collections.ftExcludeId, "ftExclude");
  map.set(collections.ftUnavailableId, "ftUnavailable");
  map.set(collections.codingId, "coding");
  return map;
}

async function ensureDir(dir: any): Promise<void> {
  await ZoteroFileAny.createDirectoryIfMissingAsync(dir.path, {
    ignoreExisting: true,
  });
}

async function buildItems(
  collections: ProjectCollectionMap,
  stagingDir: any,
): Promise<ArchiveItem[]> {
  const root = Zotero.Collections.get(collections.rootId) as Zotero.Collection;
  const roles = roleMap(collections);

  const rolesByItemId = new Map<number, Set<string>>();
  for (const d of root.getDescendents(false, "item", false)) {
    const role = roles.get(d.parent);
    if (!role) continue;
    if (!rolesByItemId.has(d.id)) rolesByItemId.set(d.id, new Set());
    rolesByItemId.get(d.id)!.add(role);
  }

  const filesDir = Zotero.File.pathToFile(stagingDir.path) as any;
  filesDir.append("files");
  await ensureDir(filesDir);

  const items: ArchiveItem[] = [];
  for (const [itemId, itemRoles] of rolesByItemId) {
    const item = Zotero.Items.get(itemId) as Zotero.Item;
    if (!item || item.deleted) continue;

    const attachments: ArchiveAttachment[] = [];
    for (const attId of item.getAttachments(false)) {
      const attachment = Zotero.Items.get(attId) as Zotero.Item;
      if (!attachment || !attachment.isPDFAttachment()) continue;
      const filePath = await attachment.getFilePathAsync();
      if (!filePath) continue;

      const itemDir = Zotero.File.pathToFile(filesDir.path) as any;
      itemDir.append(item.key);
      await ensureDir(itemDir);

      const fileName = `${attachment.key}.pdf`;
      const targetFile = Zotero.File.pathToFile(itemDir.path) as any;
      targetFile.append(fileName);
      await ZoteroFileAny.copyFile(filePath, targetFile.path);

      const annotations: ArchiveAnnotation[] = attachment
        .getAnnotations(false)
        .map((a) => ({
          key: a.key,
          type: String((a as any).annotationType ?? ""),
          color: (a as any).annotationColor ?? "",
          text: (a as any).annotationText ?? "",
          comment: (a as any).annotationComment ?? "",
          position: (a as any).annotationPosition ?? "",
          sortIndex: String((a as any).annotationSortIndex ?? ""),
          pageLabel: (a as any).annotationPageLabel ?? "",
        }));

      attachments.push({
        key: attachment.key,
        relPath: `files/${item.key}/${fileName}`,
        title: attachment.getField("title") as string,
        contentType: "application/pdf",
        annotations,
      });
    }

    items.push({
      key: item.key,
      roles: Array.from(itemRoles),
      json: item.toJSON(),
      attachments,
    });
  }
  return items;
}

async function buildScreeningTables(projectId: number): Promise<{
  criteria: ArchiveScreeningCriteria[];
  records: ArchiveScreeningRecord[];
}> {
  const criteriaRows = (await databaseService.queryAsync(
    `SELECT id, stage, version, criteria, created_at FROM screening_criteria WHERE project_id = ?`,
    [projectId],
  )) as any[];
  const criteriaVersionById = new Map<number, number>();
  for (const row of criteriaRows) criteriaVersionById.set(row.id, row.version);

  const criteria: ArchiveScreeningCriteria[] = criteriaRows.map((row) => ({
    stage: row.stage,
    version: row.version,
    criteria: row.criteria,
    createdAt: row.created_at,
  }));

  const recordRows = (await databaseService.queryAsync(
    `SELECT * FROM screening_records WHERE project_id = ?`,
    [projectId],
  )) as any[];
  const records: ArchiveScreeningRecord[] = recordRows.map((row) => ({
    itemKey: row.item_key,
    stage: row.stage,
    criteriaVersion: row.criteria_id
      ? (criteriaVersionById.get(row.criteria_id) ?? null)
      : null,
    fulltextReady: row.fulltext_ready,
    fulltextReadyAt: row.fulltext_ready_at,
    fulltextReadyBy: row.fulltext_ready_by,
    decision: row.decision,
    exclusionReason: row.exclusion_reason,
    annotationKey: row.annotation_key,
    pendingPosition: row.pending_position,
    aiDecision: row.ai_decision,
    aiReasoning: row.ai_reasoning,
    aiModel: row.ai_model,
    humanDecision: row.human_decision,
    humanReasoning: row.human_reasoning,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  }));

  return { criteria, records };
}

async function buildCodingTables(projectId: number): Promise<{
  codebooks: ArchiveCodebook[];
  codingRecords: ArchiveCodingRecord[];
  synthesisThemes: ArchiveSynthesisTheme[];
}> {
  const codebookRows = (await databaseService.queryAsync(
    `SELECT id, version, locked, variables, created_at, updated_at FROM codebooks WHERE project_id = ?`,
    [projectId],
  )) as any[];
  const codebookVersionById = new Map<number, number>();
  for (const row of codebookRows) codebookVersionById.set(row.id, row.version);

  const codebooks: ArchiveCodebook[] = codebookRows.map((row) => ({
    version: row.version,
    locked: row.locked,
    variables: row.variables,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const codingRows = (await databaseService.queryAsync(
    `SELECT * FROM coding_records WHERE project_id = ? ORDER BY id`,
    [projectId],
  )) as any[];
  const codingRecordIndexById = new Map<number, number>();
  const codingRecords: ArchiveCodingRecord[] = codingRows.map((row, i) => {
    codingRecordIndexById.set(row.id, i);
    return {
      index: i,
      itemKey: row.item_key,
      codebookVersion: codebookVersionById.get(row.codebook_id) ?? 0,
      annotationKey: row.annotation_key,
      pendingPosition: row.pending_position,
      variableName: row.variable_name,
      variableValue: row.variable_value,
      pageNumber: row.page_number,
      quote: row.quote,
      isPilot: row.is_pilot,
      source: row.source,
      confirmed: row.confirmed,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  const themeRows = (await databaseService.queryAsync(
    `SELECT st.* FROM synthesis_themes st
     JOIN coding_records cr ON cr.id = st.coding_record_id
     WHERE cr.project_id = ?`,
    [projectId],
  )) as any[];
  const synthesisThemes: ArchiveSynthesisTheme[] = themeRows
    .filter((row) => codingRecordIndexById.has(row.coding_record_id))
    .map((row) => ({
      codingRecordIndex: codingRecordIndexById.get(row.coding_record_id)!,
      theme: row.theme,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

  return { codebooks, codingRecords, synthesisThemes };
}

/**
 * Archives a project into a single .zip: every item's bibliographic data +
 * PDF attachments + annotations across the whole Collection tree, plus this
 * plugin's own screening/coding/synthesis data for it. See archiveTypes.ts
 * for why cross-references use archive-local keys rather than live database
 * ids.
 */
export async function exportProjectArchive(
  projectId: number,
  outputZipPath: string,
): Promise<void> {
  await databaseService.init();
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error(`No evidence project found with id ${projectId}`);
  }
  const rootId = getRootCollectionId(project as EvidenceProject);
  if (rootId === null) {
    throw new Error(`Root collection not found for project "${project.name}"`);
  }
  const collections = resolveProjectCollections(rootId);

  const stagingDir = Zotero.getTempDirectory() as any;
  stagingDir.append(`evidence-archive-${Date.now()}`);
  await ensureDir(stagingDir);

  try {
    const items = await buildItems(collections, stagingDir);
    const { criteria, records } = await buildScreeningTables(projectId);
    const { codebooks, codingRecords, synthesisThemes } =
      await buildCodingTables(projectId);

    const manifest: ArchiveManifest = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: { name: project.name, status: project.status },
      items,
      screeningCriteria: criteria,
      screeningRecords: records,
      codebooks,
      codingRecords,
      synthesisThemes,
    };

    const manifestFile = Zotero.File.pathToFile(stagingDir.path) as any;
    manifestFile.append(MANIFEST_FILENAME);
    await Zotero.File.putContentsAsync(
      manifestFile.path,
      JSON.stringify(manifest),
    );

    await Zotero.File.zipDirectory(stagingDir.path, outputZipPath, {});
  } finally {
    if (stagingDir.exists()) stagingDir.remove(true);
  }
}
