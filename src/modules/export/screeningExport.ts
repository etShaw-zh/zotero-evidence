import { toCsvLine } from "../../utils/csv";
import { safeGetField } from "../../utils/zoteroItem";
import { databaseService } from "../db/database";
import { resolveProjectCollections } from "../project/collectionStructure";
import { getRootCollectionId } from "../project/projectContext";
import { getProjectById } from "../project/projectManager";

export interface PrismaData {
  identification: {
    databases: { name: string; records: number }[];
    totalRecords: number;
    duplicatesRemoved: number;
  };
  screening: {
    screened: number;
    excluded: number;
    unclearToFt: number;
    includedToFt: number;
  };
  eligibility: {
    fullTextAssessed: number;
    excluded: number;
    unavailable: number;
    reasons: { reason: string; count: number }[];
  };
  included: { finalStudies: number };
}

const countItems = (collectionId: number) =>
  (Zotero.Collections.get(collectionId) as Zotero.Collection).getChildItems()
    .length;

async function getReasonCounts(
  projectId: number,
  stage: "ta_screening" | "ft_screening",
): Promise<{ reason: string; count: number }[]> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT exclusion_reason, COUNT(*) as n FROM screening_records
     WHERE project_id = ? AND stage = ? AND decision = 'exclude' AND exclusion_reason IS NOT NULL AND exclusion_reason != ''
     GROUP BY exclusion_reason`,
    [projectId, stage],
  )) as { exclusion_reason: string; n: number }[] | undefined;
  return (rows || []).map((r) => ({ reason: r.exclusion_reason, count: r.n }));
}

/**
 * Assembles REQUIREMENTS.md 2.6.3's PRISMA flow data (EXP-01) from tables
 * and Collections that already exist -- no new schema needed beyond the
 * exclusion_reason column that confirmDecision now writes.
 */
export async function computePrismaData(
  projectId: number,
): Promise<PrismaData> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error("Project not found.");
  const rootId = getRootCollectionId(project);
  if (rootId === null) throw new Error("Project collection not found.");
  const collections = resolveProjectCollections(rootId);

  await databaseService.init();
  const dbRows = (await databaseService.queryAsync(
    `SELECT source_database, COUNT(*) as n FROM item_sources
     WHERE project_id = ? GROUP BY source_database`,
    [projectId],
  )) as { source_database: string; n: number }[] | undefined;
  const totalRows = (await databaseService.queryAsync(
    `SELECT COUNT(*) as n FROM item_sources WHERE project_id = ?`,
    [projectId],
  )) as { n: number }[] | undefined;
  const duplicateRows = (await databaseService.queryAsync(
    `SELECT COUNT(*) as n FROM item_sources WHERE project_id = ? AND is_duplicate_of IS NOT NULL`,
    [projectId],
  )) as { n: number }[] | undefined;

  const taInclude = countItems(collections.taIncludeId);
  const taExclude = countItems(collections.taExcludeId);
  const taUnclear = countItems(collections.taUnclearId);
  const ftInclude = countItems(collections.ftIncludeId);
  const ftExclude = countItems(collections.ftExcludeId);
  const ftUnavailable = countItems(collections.ftUnavailableId);

  const ftReasons = await getReasonCounts(projectId, "ft_screening");
  if (ftUnavailable > 0) {
    ftReasons.push({ reason: "Full text unavailable", count: ftUnavailable });
  }

  return {
    identification: {
      databases: (dbRows || []).map((r) => ({
        name: r.source_database,
        records: r.n,
      })),
      totalRecords: totalRows?.[0]?.n ?? 0,
      duplicatesRemoved: duplicateRows?.[0]?.n ?? 0,
    },
    screening: {
      screened: taInclude + taExclude + taUnclear,
      excluded: taExclude,
      unclearToFt: taUnclear,
      includedToFt: taInclude,
    },
    eligibility: {
      fullTextAssessed: ftInclude + ftExclude + ftUnavailable,
      excluded: ftExclude,
      unavailable: ftUnavailable,
      reasons: ftReasons,
    },
    included: { finalStudies: ftInclude },
  };
}

/** Pure formatter: PrismaData -> a CSV stacking a stage-counts table and a
 * reasons-breakdown table, separated by a blank line. Testable without
 * Zotero. */
export function formatPrismaCsv(data: PrismaData): string {
  const lines: string[] = [];
  lines.push(toCsvLine(["Stage", "Count"]));
  data.identification.databases.forEach((d) => {
    lines.push(toCsvLine([`Identification: ${d.name}`, d.records]));
  });
  lines.push(
    toCsvLine([
      "Identification: total_records",
      data.identification.totalRecords,
    ]),
  );
  lines.push(
    toCsvLine([
      "Identification: duplicates_removed",
      data.identification.duplicatesRemoved,
    ]),
  );
  lines.push(toCsvLine(["TA-Screening: screened", data.screening.screened]));
  lines.push(toCsvLine(["TA-Screening: excluded", data.screening.excluded]));
  lines.push(
    toCsvLine(["TA-Screening: unclear_to_ft", data.screening.unclearToFt]),
  );
  lines.push(
    toCsvLine(["TA-Screening: included_to_ft", data.screening.includedToFt]),
  );
  lines.push(
    toCsvLine([
      "FT-Screening: full_text_assessed",
      data.eligibility.fullTextAssessed,
    ]),
  );
  lines.push(toCsvLine(["FT-Screening: excluded", data.eligibility.excluded]));
  lines.push(
    toCsvLine(["FT-Screening: unavailable", data.eligibility.unavailable]),
  );
  lines.push(
    toCsvLine(["Included: final_studies", data.included.finalStudies]),
  );

  lines.push("");
  lines.push(toCsvLine(["Reason", "Stage", "Count"]));
  data.eligibility.reasons.forEach((r) => {
    lines.push(toCsvLine([r.reason, "FT-Screening", r.count]));
  });

  return lines.join("\n");
}

/** EXP-02: full per-item screening decision history for the project. */
export async function exportScreeningLog(projectId: number): Promise<string> {
  await databaseService.init();
  const project = await getProjectById(projectId);
  const libraryID = project?.libraryID ?? Zotero.Libraries.userLibraryID;
  const rows = (await databaseService.queryAsync(
    `SELECT item_key, stage, ai_decision, ai_reasoning, human_decision, exclusion_reason, decided_by, decided_at, fulltext_ready
     FROM screening_records WHERE project_id = ? ORDER BY item_key, stage, id`,
    [projectId],
  )) as
    | {
        item_key: string;
        stage: string;
        ai_decision: string | null;
        ai_reasoning: string | null;
        human_decision: string | null;
        exclusion_reason: string | null;
        decided_by: string | null;
        decided_at: string | null;
        fulltext_ready: number;
      }[]
    | undefined;

  const lines: string[] = [];
  lines.push(
    toCsvLine([
      "item_key",
      "title",
      "stage",
      "ai_decision",
      "ai_reasoning",
      "human_decision",
      "exclusion_reason",
      "decided_by",
      "decided_at",
      "fulltext_ready",
    ]),
  );
  for (const row of rows || []) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, row.item_key);
    const title = item ? safeGetField(item as Zotero.Item, "title") : "";
    lines.push(
      toCsvLine([
        row.item_key,
        title,
        row.stage,
        row.ai_decision ?? "",
        row.ai_reasoning ?? "",
        row.human_decision ?? "",
        row.exclusion_reason ?? "",
        row.decided_by ?? "",
        row.decided_at ?? "",
        row.fulltext_ready ? "1" : "0",
      ]),
    );
  }
  return lines.join("\n");
}
