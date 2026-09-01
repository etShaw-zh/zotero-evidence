import { exportProjectArchive } from "../archive/archiveExportService";
import { databaseService } from "../db/database";
import {
  ProjectCollectionMap,
  resolveProjectCollections,
} from "../project/collectionStructure";
import { getRootCollectionId } from "../project/projectContext";
import { getProjectById } from "../project/projectManager";
import { splitCsvLine } from "../../utils/csv";
import { safeGetField } from "../../utils/zoteroItem";
import { ScreeningConsistencyStage } from "./consistencyService";
import {
  confirmDecision as confirmFtDecision,
  FTDecision,
  markUnavailable,
} from "./ftScreeningService";
import { CategoryKappa, cohenKappa, cohenKappaByCategory } from "./kappa";
import {
  confirmDecision as confirmTaDecision,
  TADecision,
} from "./taScreeningService";

export type ConsistencyRoundPhase = "pilot" | "full";
export type ConsistencyRoundStatus = "sampled" | "collected" | "reconciled";

export interface ConsistencyRound {
  id: number;
  projectId: number;
  stage: ScreeningConsistencyStage;
  phase: ConsistencyRoundPhase;
  status: ConsistencyRoundStatus;
  itemKeys: string[];
  reviewerACsvPath: string | null;
  reviewerBCsvPath: string | null;
}

function rowToRound(row: any): ConsistencyRound {
  return {
    id: row.id,
    projectId: row.project_id,
    stage: row.stage,
    phase: row.phase,
    status: row.status,
    itemKeys: JSON.parse(row.item_keys || "[]"),
    reviewerACsvPath: row.reviewer_a_csv_path,
    reviewerBCsvPath: row.reviewer_b_csv_path,
  };
}

/**
 * Fisher-Yates-based random sample, capped at the available pool size.
 * Pure/testable in isolation from Zotero.
 */
export function sampleRandom<T>(items: T[], n: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, Math.min(n, pool.length)));
}

async function resolveProjectQueue(
  projectId: number,
  stage: ScreeningConsistencyStage,
): Promise<{ collections: ProjectCollectionMap; queueId: number }> {
  const project = await getProjectById(projectId);
  if (!project) throw new Error("Project not found.");
  const rootId = getRootCollectionId(project);
  if (rootId === null) throw new Error("Project collection not found.");
  const collections = resolveProjectCollections(rootId);
  const queueId =
    stage === "ta_screening"
      ? collections.screenQueueId
      : collections.ftQueueId;
  return { collections, queueId };
}

async function insertRound(
  projectId: number,
  stage: ScreeningConsistencyStage,
  phase: ConsistencyRoundPhase,
  itemKeys: string[],
): Promise<ConsistencyRound> {
  await databaseService.init();
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `INSERT INTO consistency_rounds (project_id, stage, phase, status, item_keys, created_at, updated_at)
     VALUES (?, ?, ?, 'sampled', ?, ?, ?)`,
    [projectId, stage, phase, JSON.stringify(itemKeys), now, now],
  );
  const id = await databaseService.getLastInsertId();
  return {
    id,
    projectId,
    stage,
    phase,
    status: "sampled",
    itemKeys,
    reviewerACsvPath: null,
    reviewerBCsvPath: null,
  };
}

/** The latest round for a project/stage, or null if none has ever started. */
export async function getActiveRound(
  projectId: number,
  stage: ScreeningConsistencyStage,
): Promise<ConsistencyRound | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT * FROM consistency_rounds WHERE project_id = ? AND stage = ? ORDER BY id DESC LIMIT 1`,
    [projectId, stage],
  )) as any[] | undefined;
  const row = rows?.[0];
  return row ? rowToRound(row) : null;
}

/**
 * Samples `percent`% of the items currently sitting in the stage's queue
 * collection (i.e. not yet decided at this stage) and exports them as a
 * scoped archive at `archiveOutputPath`, for distribution to two
 * reviewers. Refuses while a round for this project/stage is already in
 * progress -- one active round at a time, same reasoning as the removed
 * pilot_rounds feature this supersedes.
 */
export async function startPilotRound(
  projectId: number,
  stage: ScreeningConsistencyStage,
  percent: number,
  archiveOutputPath: string,
): Promise<ConsistencyRound> {
  const active = await getActiveRound(projectId, stage);
  if (active && active.status !== "reconciled") {
    throw new Error(
      "A consistency round is already in progress for this project/stage. Finish it before starting a new one.",
    );
  }

  const { queueId } = await resolveProjectQueue(projectId, stage);
  const pool = (Zotero.Collections.get(queueId) as Zotero.Collection)
    .getChildItems()
    .map((item) => item.key);
  if (pool.length === 0) {
    throw new Error("No items in the queue to sample from.");
  }
  const n = Math.max(1, Math.round((pool.length * percent) / 100));
  const itemKeys = sampleRandom(pool, n);

  await exportProjectArchive(projectId, archiveOutputPath, itemKeys);
  return insertRound(projectId, stage, "pilot", itemKeys);
}

/**
 * Starts the 'full' round after the pilot round is reconciled: samples
 * everything still sitting in the stage's queue. The pilot's reconciled
 * items already moved out of that queue via confirmDecision/
 * markUnavailable, so this naturally excludes them without needing to
 * diff item-key sets by hand.
 */
export async function startFullRound(
  projectId: number,
  stage: ScreeningConsistencyStage,
  archiveOutputPath: string,
): Promise<ConsistencyRound> {
  const active = await getActiveRound(projectId, stage);
  if (!active || active.phase !== "pilot" || active.status !== "reconciled") {
    throw new Error(
      "Reconcile the pilot round for this project/stage before starting the full round.",
    );
  }

  const { queueId } = await resolveProjectQueue(projectId, stage);
  const itemKeys = (Zotero.Collections.get(queueId) as Zotero.Collection)
    .getChildItems()
    .map((item) => item.key);
  if (itemKeys.length === 0) {
    throw new Error("No remaining items to screen for the full round.");
  }

  await exportProjectArchive(projectId, archiveOutputPath, itemKeys);
  return insertRound(projectId, stage, "full", itemKeys);
}

/** Records one reviewer's collected CSV path; flips to 'collected' once both are in. */
export async function recordCollectedCsv(
  roundId: number,
  which: "a" | "b",
  csvPath: string,
): Promise<ConsistencyRound> {
  await databaseService.init();
  const column = which === "a" ? "reviewer_a_csv_path" : "reviewer_b_csv_path";
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `UPDATE consistency_rounds SET ${column} = ?, updated_at = ? WHERE id = ?`,
    [csvPath, now, roundId],
  );
  const rows = (await databaseService.queryAsync(
    `SELECT * FROM consistency_rounds WHERE id = ?`,
    [roundId],
  )) as any[];
  // rowToRound() first: rows[0] is a WrappedNative SQLite result row, whose
  // properties can't be assigned to directly (unlike the plain object
  // rowToRound() returns).
  const round = rowToRound(rows[0]);
  if (
    round.reviewerACsvPath &&
    round.reviewerBCsvPath &&
    round.status === "sampled"
  ) {
    await databaseService.queryAsync(
      `UPDATE consistency_rounds SET status = 'collected', updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), roundId],
    );
    round.status = "collected";
  }
  return round;
}

interface ParsedReviewerRow {
  title: string;
  humanDecision: string;
  decidedBy: string;
}

/**
 * Reads back a CSV produced by exportScreeningLog() (screeningExport.ts) --
 * the same "Export Screening Log" format each reviewer is expected to send
 * back. Keyed by column name rather than fixed position so a future column
 * reorder there doesn't silently break this.
 */
function parseReviewerCsv(
  csvText: string,
  stage: ScreeningConsistencyStage,
): ParsedReviewerRow[] {
  const lines = csvText
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const titleCol = col("title");
  const stageCol = col("stage");
  const decisionCol = col("human_decision");
  const decidedByCol = col("decided_by");
  if (titleCol < 0 || stageCol < 0 || decisionCol < 0) {
    throw new Error(
      "This file doesn't look like a Zotero Evidence screening log CSV.",
    );
  }

  const rows: ParsedReviewerRow[] = [];
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    if (fields[stageCol] !== stage) continue;
    const humanDecision = fields[decisionCol]?.trim();
    if (!humanDecision) continue;
    rows.push({
      title: fields[titleCol]?.trim() ?? "",
      humanDecision,
      decidedBy: decidedByCol >= 0 ? (fields[decidedByCol]?.trim() ?? "") : "",
    });
  }
  return rows;
}

export interface HumanConsistencyItem {
  itemKey: string;
  title: string;
  // null means that reviewer's CSV had no row matching this item's title.
  aDecision: string | null;
  bDecision: string | null;
}

export interface HumanConsistencyResult {
  // decided_by read back from each CSV (a Zotero user ID, or "user"/"" if
  // unavailable) -- purely a display label, not used for matching.
  reviewerA: string;
  reviewerB: string;
  n: number;
  observedAgreement: number | null;
  kappa: number | null;
  byCategory: CategoryKappa[];
  // Every item in the round, agreements included -- the reconciliation UI
  // needs the full list, not just the disagreements.
  items: HumanConsistencyItem[];
}

/**
 * Compares the two reviewers' human_decision values for every item in this
 * round, matched by title (item_key isn't stable across independently-
 * imported copies of the same archive -- see archiveImportService.ts).
 * Advisory only, same as the AI-vs-human consistency feature: nothing here
 * writes anything, that's applyReconciliation()'s job.
 */
export async function computeRoundConsistency(
  round: ConsistencyRound,
): Promise<HumanConsistencyResult> {
  if (!round.reviewerACsvPath || !round.reviewerBCsvPath) {
    throw new Error("Both reviewers' CSVs must be collected first.");
  }
  const project = await getProjectById(round.projectId);
  const libraryID = project?.libraryID ?? Zotero.Libraries.userLibraryID;

  const csvA = (await Zotero.File.getContentsAsync(
    round.reviewerACsvPath,
  )) as string;
  const csvB = (await Zotero.File.getContentsAsync(
    round.reviewerBCsvPath,
  )) as string;
  const rowsA = parseReviewerCsv(csvA, round.stage);
  const rowsB = parseReviewerCsv(csvB, round.stage);

  const byTitleA = new Map<string, ParsedReviewerRow>();
  for (const r of rowsA) if (!byTitleA.has(r.title)) byTitleA.set(r.title, r);
  const byTitleB = new Map<string, ParsedReviewerRow>();
  for (const r of rowsB) if (!byTitleB.has(r.title)) byTitleB.set(r.title, r);

  const items: HumanConsistencyItem[] = [];
  const pairs: [string, string][] = [];
  for (const itemKey of round.itemKeys) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
    const title = item ? safeGetField(item as Zotero.Item, "title") : "";
    const a = byTitleA.get(title);
    const b = byTitleB.get(title);
    items.push({
      itemKey,
      title,
      aDecision: a?.humanDecision ?? null,
      bDecision: b?.humanDecision ?? null,
    });
    if (a && b) pairs.push([a.humanDecision, b.humanDecision]);
  }

  const reviewerA = rowsA.find((r) => r.decidedBy)?.decidedBy ?? "";
  const reviewerB = rowsB.find((r) => r.decidedBy)?.decidedBy ?? "";

  const n = pairs.length;
  const disagreementCount = pairs.filter(([a, b]) => a !== b).length;
  const matched = n - disagreementCount;

  return {
    reviewerA,
    reviewerB,
    n,
    observedAgreement: n === 0 ? null : matched / n,
    kappa: cohenKappa(pairs),
    byCategory: cohenKappaByCategory(pairs),
    items,
  };
}

export interface ConsistencyResolution {
  itemKey: string;
  decision: string;
}

/**
 * Writes each resolved item's final decision through the same
 * confirmDecision/markUnavailable path the normal screening UI uses, not a
 * raw SQL write -- this is what correctly moves the item between TA/FT
 * Collections (e.g. out of the queue into Include/Exclude/Unclear), so
 * startFullRound()'s "items still in the queue" pool naturally excludes
 * anything resolved here. Marked decided_by = 'reconciled' so a later
 * export can tell this apart from either individual reviewer's own call.
 *
 * Resolutions don't have to cover every item in the round -- anything left
 * out simply stays pending and can be resolved later, through this wizard
 * or the normal Screening pane, either way.
 */
export async function applyReconciliation(
  round: ConsistencyRound,
  resolutions: ConsistencyResolution[],
): Promise<void> {
  const project = await getProjectById(round.projectId);
  if (!project) throw new Error("Project not found.");
  const rootId = getRootCollectionId(project);
  if (rootId === null) throw new Error("Project collection not found.");
  const collections = resolveProjectCollections(rootId);
  const libraryID = project.libraryID;

  for (const r of resolutions) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, r.itemKey);
    if (!item) continue;
    if (round.stage === "ta_screening") {
      await confirmTaDecision(
        round.projectId,
        item as Zotero.Item,
        collections,
        null,
        r.decision as TADecision,
        "reconciled",
      );
    } else if (r.decision === "unavailable") {
      await markUnavailable(
        round.projectId,
        item as Zotero.Item,
        collections,
        "reconciled",
      );
    } else {
      await confirmFtDecision(
        round.projectId,
        item as Zotero.Item,
        collections,
        r.decision as FTDecision,
        "reconciled",
      );
    }
  }

  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE consistency_rounds SET status = 'reconciled', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), round.id],
  );
}
