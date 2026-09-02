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
    // = totalRecords - duplicatesRemoved, i.e. the unique-record population
    // that actually enters screening -- exposed directly so it lines up
    // against `screening.screened` (+ `screening.pending`, if nonzero)
    // without the reader having to subtract it themselves.
    uniqueRecords: number;
  };
  screening: {
    screened: number;
    excluded: number;
    unclearToFt: number;
    includedToFt: number;
    // Items still sitting in TA-Screen Queue, not yet decided at all --
    // NOT folded into `screened` (a PRISMA flow diagram assumes a
    // COMPLETE review, where every record has reached a final
    // disposition; screened/excluded only ever count decided items).
    // Exposed separately purely so exporting mid-review surfaces that the
    // numbers aren't final yet, instead of silently looking complete.
    pending: number;
  };
  // PRISMA 2020's full-text stage is two steps with two different
  // denominators, not one: first "sought for retrieval" -> "not
  // retrieved" (did we even get hold of the PDF), then, only for the ones
  // that WERE retrieved, "assessed for eligibility" -> "excluded" (did it
  // meet the criteria). A paper never retrieved was never assessed, so it
  // must not count toward `eligibility.assessedForEligibility` or appear
  // in the exclusion-reasons breakdown -- "couldn't find the full text"
  // isn't an eligibility exclusion reason.
  retrieval: {
    soughtForRetrieval: number;
    notRetrieved: number;
  };
  eligibility: {
    assessedForEligibility: number;
    excluded: number;
    reasons: { reason: string; count: number }[];
    // Same idea as screening.pending -- items still sitting in FT-Screen
    // Queue, not yet marked include/exclude/unavailable at all. Not part
    // of soughtForRetrieval/notRetrieved/assessedForEligibility (those all
    // assume a completed review); exposed separately so exporting
    // mid-review surfaces that these numbers aren't final yet.
    pending: number;
  };
  included: { finalStudies: number };
}

const countItems = (collectionId: number) =>
  (Zotero.Collections.get(collectionId) as Zotero.Collection).getChildItems()
    .length;

/**
 * FT-Screening's exclusion reasons now come from ft_criterion_checks (one
 * row per criterion that actually applied) rather than a single
 * exclusion_reason column -- so a paper excluded for 2 reasons contributes
 * to both reasons' counts here, per the "each reason counted once" rule
 * (not once per excluded paper). Only CONFIRMED checks count, same as
 * ftCriterionCheckService.ts's own getConfirmedExclusionReasons -- an
 * unconfirmed AI suggestion was never actually endorsed as the reason.
 *
 * `criterion_type = 'exclusion'` is required alongside `verdict =
 * 'exclude'` -- verdict='exclude' alone also matches an unmet INCLUSION
 * criterion (a paper simply didn't satisfy something required, which
 * still stores as verdict='exclude' -- see ftCriterionCheckService.ts),
 * and that's a different thing from a configured exclusion criterion
 * actually triggering. PRISMA's itemized "reasons excluded" box means the
 * latter only.
 */
async function getFtReasonCounts(
  projectId: number,
): Promise<{ reason: string; count: number }[]> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT criterion_text, COUNT(*) as n FROM ft_criterion_checks
     WHERE project_id = ? AND criterion_type = 'exclusion' AND verdict = 'exclude' AND confirmed = 1
     GROUP BY criterion_text`,
    [projectId],
  )) as { criterion_text: string; n: number }[] | undefined;
  return (rows || []).map((r) => ({ reason: r.criterion_text, count: r.n }));
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

  const taQueue = countItems(collections.screenQueueId);
  const taInclude = countItems(collections.taIncludeId);
  const taExclude = countItems(collections.taExcludeId);
  const taUnclear = countItems(collections.taUnclearId);
  const ftQueue = countItems(collections.ftQueueId);
  const ftInclude = countItems(collections.ftIncludeId);
  const ftExclude = countItems(collections.ftExcludeId);
  const ftUnavailable = countItems(collections.ftUnavailableId);

  const ftReasons = await getFtReasonCounts(projectId);
  const totalRecords = totalRows?.[0]?.n ?? 0;
  const duplicatesRemoved = duplicateRows?.[0]?.n ?? 0;

  return {
    identification: {
      databases: (dbRows || []).map((r) => ({
        name: r.source_database,
        records: r.n,
      })),
      totalRecords,
      duplicatesRemoved,
      uniqueRecords: totalRecords - duplicatesRemoved,
    },
    screening: {
      screened: taInclude + taExclude + taUnclear,
      excluded: taExclude,
      unclearToFt: taUnclear,
      includedToFt: taInclude,
      pending: taQueue,
    },
    retrieval: {
      soughtForRetrieval: taInclude + taUnclear,
      notRetrieved: ftUnavailable,
    },
    eligibility: {
      assessedForEligibility: ftInclude + ftExclude,
      excluded: ftExclude,
      reasons: ftReasons,
      pending: ftQueue,
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
  lines.push(
    toCsvLine([
      "Identification: deduplicated_records",
      data.identification.uniqueRecords,
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
  if (data.screening.pending > 0) {
    lines.push(
      toCsvLine([
        "TA-Screening: pending_not_yet_screened",
        data.screening.pending,
      ]),
    );
  }
  lines.push(
    toCsvLine([
      "FT-Screening: sought_for_retrieval",
      data.retrieval.soughtForRetrieval,
    ]),
  );
  lines.push(
    toCsvLine(["FT-Screening: not_retrieved", data.retrieval.notRetrieved]),
  );
  lines.push(
    toCsvLine([
      "FT-Screening: assessed_for_eligibility",
      data.eligibility.assessedForEligibility,
    ]),
  );
  lines.push(toCsvLine(["FT-Screening: excluded", data.eligibility.excluded]));
  if (data.eligibility.pending > 0) {
    lines.push(
      toCsvLine([
        "FT-Screening: pending_not_yet_screened",
        data.eligibility.pending,
      ]),
    );
  }
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
    `SELECT item_key, stage, ai_decision, ai_reasoning, ai_model, human_decision, exclusion_reason, decided_by, decided_at, fulltext_ready
     FROM screening_records WHERE project_id = ? ORDER BY item_key, stage, id`,
    [projectId],
  )) as
    | {
        item_key: string;
        stage: string;
        ai_decision: string | null;
        ai_reasoning: string | null;
        ai_model: string | null;
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
      "ai_model",
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
        row.ai_model ?? "",
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
