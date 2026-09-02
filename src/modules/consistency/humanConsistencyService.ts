/**
 * Human-human consistency: two reviewers independently screen the SAME
 * sampled items all the way through TA and (for whichever ones they
 * themselves didn't TA-exclude) FT, and this compares each reviewer's own
 * overall FINAL verdict per item ("did it end up included") rather than
 * their TA and FT decisions as two separate stage-wise kappas. Replaces an
 * earlier per-stage design (separate TA-only and FT-only rounds) that
 * pooled TA's three-way category set (include/exclude/unclear) and FT's
 * (include/exclude/unavailable) as if they were the same rating task --
 * they aren't (different information available: abstract-only vs. full
 * text), and reporting one stage-wise kappa doesn't answer the question
 * that actually matters for a systematic review: do two independent
 * screeners arrive at the same final included set. See
 * computeRoundConsistency's own doc comment for exactly how a reviewer's
 * multi-stage journey collapses into one verdict.
 */
import { exportProjectArchive } from "../archive/archiveExportService";
import { databaseService } from "../db/database";
import { resolveProjectCollections } from "../project/collectionStructure";
import { getRootCollectionId } from "../project/projectContext";
import { getProjectById } from "../project/projectManager";
import { splitCsvLine } from "../../utils/csv";
import { normalizeDOI } from "../dedup/normalize";
import { safeGetField } from "../../utils/zoteroItem";
import { confirmDecision as confirmFtDecision } from "../screening/ftScreeningService";
import {
  addManualCheck,
  getConfirmedExclusionReasons,
} from "../screening/ftCriterionCheckService";
import { CategoryKappa, cohenKappa, cohenKappaByCategory } from "./kappa";
import { confirmDecision as confirmTaDecision } from "../screening/taScreeningService";
import { saveConsistencyItemResult } from "./consistencyItemResultsService";

export type ConsistencyRoundStatus = "sampled" | "collected" | "reconciled";

// A round now always covers BOTH screening stages for the same sampled
// items -- see the module doc comment below for why. Stored (not just a
// local constant) so getLatestRound/getAllRounds's queries can keep
// filtering by it, which is what makes any pre-redesign
// 'ta_screening'/'ft_screening' round left over in an existing project's DB
// harmlessly invisible to this code rather than being misread as a
// same-shape round it isn't.
const ROUND_STAGE = "full_pipeline";

// consistency_rounds.phase used to distinguish a "pilot" (small, first)
// round from a "full" (everything remaining) round, each gating when the
// other could start. That distinction is gone -- every round is now the
// same kind of thing, started as many times as needed, each just sampling
// a fresh percentage of whatever is currently in TA-Screen Queue (earlier
// rounds' agreed items have already left it; disagreements and never-
// sampled items are fair game to resample). The column is still NOT NULL
// in the schema, so this fixed value is written purely for compat -- no
// code reads it anymore.
const ROUND_PHASE = "pilot";

export interface ConsistencyRound {
  id: number;
  projectId: number;
  status: ConsistencyRoundStatus;
  itemKeys: string[];
  reviewerACsvPath: string | null;
  reviewerBCsvPath: string | null;
  // When this round last changed (sampled -> collected -> reconciled) --
  // display only, e.g. for ordering/labeling entries in a history list.
  updatedAt: string;
}

function rowToRound(row: any): ConsistencyRound {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    itemKeys: JSON.parse(row.item_keys || "[]"),
    reviewerACsvPath: row.reviewer_a_csv_path,
    reviewerBCsvPath: row.reviewer_b_csv_path,
    updatedAt: row.updated_at,
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

/**
 * Always the TA-Screen Queue: a round now means "two reviewers each
 * independently take these items all the way through TA, and then FT for
 * whichever ones they themselves didn't TA-exclude" -- see the module doc
 * comment below. That only makes sense starting from the full, not-yet-
 * screened candidate pool, never the (already TA-passed) FT-Screen Queue.
 */
async function resolveSamplePool(projectId: number) {
  const project = await getProjectById(projectId);
  if (!project) throw new Error("Project not found.");
  const rootId = getRootCollectionId(project);
  if (rootId === null) throw new Error("Project collection not found.");
  const collections = resolveProjectCollections(rootId);
  return { collections, queueId: collections.screenQueueId };
}

async function insertRound(
  projectId: number,
  itemKeys: string[],
): Promise<ConsistencyRound> {
  await databaseService.init();
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `INSERT INTO consistency_rounds (project_id, stage, phase, status, item_keys, created_at, updated_at)
     VALUES (?, ?, ?, 'sampled', ?, ?, ?)`,
    [projectId, ROUND_STAGE, ROUND_PHASE, JSON.stringify(itemKeys), now, now],
  );
  const id = await databaseService.getLastInsertId();
  return {
    id,
    projectId,
    status: "sampled",
    itemKeys,
    reviewerACsvPath: null,
    reviewerBCsvPath: null,
    updatedAt: now,
  };
}

/** The most recently started round for a project, or null if none has ever
 * started -- the one shown with actionable controls (import CSVs / apply
 * agreed results) in the dialog; see getAllRounds for the full history. */
export async function getLatestRound(
  projectId: number,
): Promise<ConsistencyRound | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT * FROM consistency_rounds WHERE project_id = ? AND stage = ? ORDER BY id DESC LIMIT 1`,
    [projectId, ROUND_STAGE],
  )) as any[] | undefined;
  const row = rows?.[0];
  return row ? rowToRound(row) : null;
}

/** Every round ever started for a project, newest first -- drives the
 * dialog's history list (each collected round's own computed consistency,
 * see computeRoundConsistency), alongside getLatestRound for which one (if
 * any) still gets actionable controls. */
export async function getAllRounds(
  projectId: number,
): Promise<ConsistencyRound[]> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT * FROM consistency_rounds WHERE project_id = ? AND stage = ? ORDER BY id DESC`,
    [projectId, ROUND_STAGE],
  )) as any[] | undefined;
  return (rows || []).map(rowToRound);
}

/**
 * Samples `percent`% of the items currently sitting in TA-Screen Queue
 * (i.e. not yet screened at all) and exports them -- with full text, same
 * as every archive export -- as a scoped archive at `archiveOutputPath`,
 * for distribution to two reviewers who will each independently screen
 * these items all the way through TA and FT. Can be called any time, as
 * many times as needed -- there's no "finish the current round first"
 * gate. Each call just samples fresh from whatever's currently in the
 * queue: earlier rounds' agreed items have already left it (see
 * applyAgreedResults), so repeated rounds naturally avoid resampling those,
 * though an earlier round's still-unresolved disagreement (or one whose
 * CSVs were never collected) can legitimately be resampled again.
 */
export async function startRound(
  projectId: number,
  percent: number,
  archiveOutputPath: string,
): Promise<ConsistencyRound> {
  const { queueId } = await resolveSamplePool(projectId);
  const pool = (Zotero.Collections.get(queueId) as Zotero.Collection)
    .getChildItems()
    .map((item) => item.key);
  if (pool.length === 0) {
    throw new Error("No items in the queue to sample from.");
  }
  const n = Math.max(1, Math.round((pool.length * percent) / 100));
  const itemKeys = sampleRandom(pool, n);

  await exportProjectArchive(projectId, archiveOutputPath, itemKeys);
  return insertRound(projectId, itemKeys);
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
  // "" when the CSV predates the doi column (old export) or the item had no
  // DOI -- callers must treat that as "no DOI available", never match two
  // empty-DOI rows against each other.
  doi: string;
  stage: "ta_screening" | "ft_screening";
  humanDecision: string;
  decidedBy: string;
  // Free text from exportScreeningLog's exclusion_reason column -- for an
  // ft_screening row this is the join of every confirmed exclusion
  // criterion's own text (see getConfirmedExclusionReasons), so it can be
  // split back on "; " and exact-matched against the project's current FT
  // exclusion criteria (see applyAgreedResults). "" when not excluded, or
  // when the CSV predates this column.
  exclusionReason: string;
}

/**
 * Reads back a CSV produced by exportScreeningLog() (screeningExport.ts) --
 * the same "Export Screening Log" format each reviewer is expected to send
 * back, after they've screened their sampled items all the way through
 * BOTH stages (see the module doc comment). Returns every stage's rows --
 * unlike the old per-stage version of this function, there's no single
 * stage to filter to anymore; callers index by row.stage themselves (see
 * indexRowsByStage). Keyed by column name rather than fixed position so a
 * future column reorder there doesn't silently break this. `doi` is
 * optional -- a CSV exported before the doi column existed still parses
 * fine, it just never gets a DOI match (see computeRoundConsistency's
 * title fallback).
 */
function parseReviewerCsv(csvText: string): ParsedReviewerRow[] {
  const lines = csvText
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const titleCol = col("title");
  const doiCol = col("doi");
  const stageCol = col("stage");
  const decisionCol = col("human_decision");
  const decidedByCol = col("decided_by");
  const exclusionReasonCol = col("exclusion_reason");
  if (titleCol < 0 || stageCol < 0 || decisionCol < 0) {
    throw new Error(
      "This file doesn't look like a Zotero Evidence screening log CSV.",
    );
  }

  const rows: ParsedReviewerRow[] = [];
  for (const line of lines.slice(1)) {
    const fields = splitCsvLine(line);
    const stage = fields[stageCol];
    if (stage !== "ta_screening" && stage !== "ft_screening") continue;
    const humanDecision = fields[decisionCol]?.trim();
    if (!humanDecision) continue;
    rows.push({
      title: fields[titleCol]?.trim() ?? "",
      doi: doiCol >= 0 ? (normalizeDOI(fields[doiCol]) ?? "") : "",
      stage,
      humanDecision,
      decidedBy: decidedByCol >= 0 ? (fields[decidedByCol]?.trim() ?? "") : "",
      exclusionReason:
        exclusionReasonCol >= 0
          ? (fields[exclusionReasonCol]?.trim() ?? "")
          : "",
    });
  }
  return rows;
}

/** Indexes one reviewer's rows for one stage by DOI and by title, for
 * lookupRow below. */
function indexRowsByStage(
  rows: ParsedReviewerRow[],
  stage: "ta_screening" | "ft_screening",
): {
  byDoi: Map<string, ParsedReviewerRow>;
  byTitle: Map<string, ParsedReviewerRow>;
} {
  const byDoi = new Map<string, ParsedReviewerRow>();
  const byTitle = new Map<string, ParsedReviewerRow>();
  for (const r of rows) {
    if (r.stage !== stage) continue;
    if (r.doi && !byDoi.has(r.doi)) byDoi.set(r.doi, r);
    if (!byTitle.has(r.title)) byTitle.set(r.title, r);
  }
  return { byDoi, byTitle };
}

/** DOI first, falling back to title -- same matching precedence as the
 * rest of this file (see computeRoundConsistency's doc comment). */
function lookupRow(
  index: {
    byDoi: Map<string, ParsedReviewerRow>;
    byTitle: Map<string, ParsedReviewerRow>;
  },
  doi: string,
  title: string,
): ParsedReviewerRow | undefined {
  return (doi && index.byDoi.get(doi)) || index.byTitle.get(title);
}

/**
 * One reviewer's overall verdict for one item, derived from their own TA
 * and (if they got that far) FT rows -- see the module doc comment for
 * why a round needs both. A TA-exclude ends the pipeline right there
 * (verdict "exclude": this reviewer never even looked at the full text,
 * same as a real TA-exclude in the actual screening pipeline); TA-include
 * or TA-unclear means they should also have gone on to FT, so the verdict
 * comes from their FT row's human_decision instead (include -> "include",
 * anything else, including "unavailable" -> "exclude"). Null means not
 * enough information to say yet (this reviewer never TA-screened the item
 * at all, or TA-passed it but hasn't finished FT screening it yet) --
 * same "skip from n rather than guess" convention as the rest of this
 * file uses for a missing row.
 */
function deriveFinalVerdict(
  taRow: ParsedReviewerRow | undefined,
  ftRow: ParsedReviewerRow | undefined,
): "include" | "exclude" | null {
  if (!taRow) return null;
  if (taRow.humanDecision === "exclude") return "exclude";
  if (!ftRow) return null;
  return ftRow.humanDecision === "include" ? "include" : "exclude";
}

export interface FinalVerdictDetail {
  verdict: "include" | "exclude" | null;
  // Which stage actually produced the verdict -- applyAgreedResults needs
  // this to decide how to apply an agreed exclude: a TA-origin exclude
  // means this reviewer never read the full text, so it's applied as a
  // plain TA-exclude; an FT-origin exclude means they did, so it's applied
  // as a TA-include followed by a structured FT exclude (see
  // exclusionReason below). Null alongside a null verdict.
  stage: "ta_screening" | "ft_screening" | null;
  // The reviewer's own exclusion_reason text (see ParsedReviewerRow), only
  // ever populated for a "exclude" verdict whose stage is "ft_screening" --
  // a TA-exclude has no FT criteria to report, and an "include" verdict has
  // no reason at all.
  exclusionReason: string;
}

/**
 * Same collapsing rule as deriveFinalVerdict, but keeps the stage that
 * actually produced the verdict and (for an FT-origin exclude) the
 * reviewer's own exclusion-reason text, instead of throwing both away --
 * applyAgreedResults needs both to correctly reconstruct structured
 * ft_criterion_checks rows for an item both reviewers agreed to exclude
 * only after reading the full text, rather than always collapsing an
 * agreed exclude to a TA-level one (which would silently drop it from
 * PRISMA's itemized exclusion-reasons breakdown -- see getFtReasonCounts
 * in screeningExport.ts, which only counts confirmed ft_criterion_checks
 * rows, never screening_records.exclusion_reason).
 */
function deriveFinalVerdictDetail(
  taRow: ParsedReviewerRow | undefined,
  ftRow: ParsedReviewerRow | undefined,
): FinalVerdictDetail {
  if (!taRow) return { verdict: null, stage: null, exclusionReason: "" };
  if (taRow.humanDecision === "exclude") {
    return { verdict: "exclude", stage: "ta_screening", exclusionReason: "" };
  }
  if (!ftRow) return { verdict: null, stage: null, exclusionReason: "" };
  if (ftRow.humanDecision === "include") {
    return { verdict: "include", stage: "ft_screening", exclusionReason: "" };
  }
  return {
    verdict: "exclude",
    stage: "ft_screening",
    exclusionReason: ftRow.exclusionReason,
  };
}

export interface HumanConsistencyItem {
  itemKey: string;
  title: string;
  // The reviewer's DERIVED final verdict ("include"/"exclude") for this
  // item -- see deriveFinalVerdict -- not their raw per-stage decision.
  // Null means not enough information yet (see deriveFinalVerdict).
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
 * A round asks two reviewers to independently take the SAME sampled items
 * all the way through TA and (for whichever ones they themselves didn't
 * TA-exclude) FT screening, then compares each reviewer's own overall
 * final verdict for each item -- "did it end up included" -- rather than
 * comparing their TA decisions and FT decisions as two separate stage-wise
 * kappas. This is deliberate, not an oversight: TA's three-way category
 * set (include/exclude/unclear) and FT's (include/exclude/unavailable)
 * aren't the same rating task, so pooling their raw decisions into one
 * kappa would conflate two different questions with different available
 * information (abstract-only vs full-text) into one number. Collapsing
 * each reviewer's own multi-stage journey down to a single binary verdict
 * first avoids that: "unclear" and "unavailable" both simply mean
 * "didn't end up included," regardless of which stage produced them.
 *
 * Matched by DOI first (a title can collide or drift slightly between two
 * independently hand-edited CSVs -- a DOI doesn't), falling back to title
 * when either side has no usable DOI -- item_key isn't stable across
 * independently-imported copies of the same archive (see
 * archiveImportService.ts), and a CSV exported before the doi column
 * existed simply never DOI-matches. Advisory only, same as the AI-vs-human
 * consistency feature: nothing here writes anything, that's
 * applyAgreedResults()'s job.
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
  const rowsA = parseReviewerCsv(csvA);
  const rowsB = parseReviewerCsv(csvB);

  const taA = indexRowsByStage(rowsA, "ta_screening");
  const ftA = indexRowsByStage(rowsA, "ft_screening");
  const taB = indexRowsByStage(rowsB, "ta_screening");
  const ftB = indexRowsByStage(rowsB, "ft_screening");

  const items: HumanConsistencyItem[] = [];
  const pairs: [string, string][] = [];
  for (const itemKey of round.itemKeys) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
    const title = item ? safeGetField(item as Zotero.Item, "title") : "";
    const doi = item
      ? (normalizeDOI(safeGetField(item as Zotero.Item, "DOI")) ?? "")
      : "";

    const aVerdict = deriveFinalVerdict(
      lookupRow(taA, doi, title),
      lookupRow(ftA, doi, title),
    );
    const bVerdict = deriveFinalVerdict(
      lookupRow(taB, doi, title),
      lookupRow(ftB, doi, title),
    );

    items.push({ itemKey, title, aDecision: aVerdict, bDecision: bVerdict });
    if (aVerdict && bVerdict) pairs.push([aVerdict, bVerdict]);
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

export interface ApplyAgreedResultsSummary {
  applied: number;
  disagreed: number;
}

/**
 * The one manual confirmation step in this workflow: for every item in the
 * round, re-derives each reviewer's own verdict (see
 * deriveFinalVerdictDetail) and, wherever both reviewers agree, writes that
 * verdict through the same confirmTaDecision/confirmFtDecision path the
 * normal screening UI uses -- not a raw SQL write -- which is what
 * correctly moves the item between TA/FT Collections, so a later
 * startRound()'s "items still in TA-Screen Queue" sample pool naturally
 * excludes anything applied here. Marked decided_by = 'consistency_agreed'
 * so a later export can tell this apart from either individual reviewer's
 * own call (see decided_by's doc comment in screeningExport.ts).
 *
 * An agreed exclude is applied differently depending on WHERE the
 * agreement happened, not just collapsed to a TA-exclude the way the old
 * per-item reconciliation UI did:
 *  - Either reviewer's own verdict came from a TA-exclude (they never even
 *    read the full text) -> applied as a plain TA-exclude. Both agreeing
 *    the paper doesn't even warrant a close read is itself the finding;
 *    there's no FT-criteria information to reconstruct.
 *  - Both reviewers' verdicts came from FT (they both read the full text
 *    and excluded it there) -> TA-include first, then their own reported
 *    exclusion-reason text (see ParsedReviewerRow) is split back into
 *    individual criterion fragments and written as real, confirmed
 *    ft_criterion_checks rows via addManualCheck -- the same shape a human
 *    reviewer's own manual check takes in ftQueuePane.ts -- before
 *    confirmFtDecision runs. Skipping this and always collapsing to a
 *    TA-exclude would silently drop the item from PRISMA's itemized
 *    exclusion-reasons breakdown (getFtReasonCounts in screeningExport.ts
 *    only counts confirmed ft_criterion_checks rows, never
 *    screening_records.exclusion_reason directly) even though it correctly
 *    excluded at FT for the overall counts.
 * An agreed include always clears TA then confirms FT-include.
 *
 * A disagreement is deliberately left untouched -- it simply stays wherever
 * it already was (TA-Screen Queue, since a round only ever samples from
 * there), for a third reviewer to resolve through the normal Screening
 * pane. Every item, agreed or not, gets its snapshot written to
 * consistency_item_results so screenQueuePane.ts can show both reviewers'
 * calls next to a still-pending disagreement.
 */
export async function applyAgreedResults(
  round: ConsistencyRound,
): Promise<ApplyAgreedResultsSummary> {
  if (!round.reviewerACsvPath || !round.reviewerBCsvPath) {
    throw new Error("Both reviewers' CSVs must be collected first.");
  }
  const project = await getProjectById(round.projectId);
  if (!project) throw new Error("Project not found.");
  const rootId = getRootCollectionId(project);
  if (rootId === null) throw new Error("Project collection not found.");
  const collections = resolveProjectCollections(rootId);
  const libraryID = project.libraryID;

  const csvA = (await Zotero.File.getContentsAsync(
    round.reviewerACsvPath,
  )) as string;
  const csvB = (await Zotero.File.getContentsAsync(
    round.reviewerBCsvPath,
  )) as string;
  const rowsA = parseReviewerCsv(csvA);
  const rowsB = parseReviewerCsv(csvB);
  const taA = indexRowsByStage(rowsA, "ta_screening");
  const ftA = indexRowsByStage(rowsA, "ft_screening");
  const taB = indexRowsByStage(rowsB, "ta_screening");
  const ftB = indexRowsByStage(rowsB, "ft_screening");
  const reviewerA = rowsA.find((r) => r.decidedBy)?.decidedBy ?? "";
  const reviewerB = rowsB.find((r) => r.decidedBy)?.decidedBy ?? "";

  let applied = 0;
  let disagreed = 0;

  for (const itemKey of round.itemKeys) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
    if (!item) continue;
    const title = safeGetField(item as Zotero.Item, "title");
    const doi = normalizeDOI(safeGetField(item as Zotero.Item, "DOI")) ?? "";

    const aDetail = deriveFinalVerdictDetail(
      lookupRow(taA, doi, title),
      lookupRow(ftA, doi, title),
    );
    const bDetail = deriveFinalVerdictDetail(
      lookupRow(taB, doi, title),
      lookupRow(ftB, doi, title),
    );

    await saveConsistencyItemResult(round.projectId, {
      itemKey,
      roundId: round.id,
      aReviewer: reviewerA,
      aVerdict: aDetail.verdict,
      aExclusionReason: aDetail.exclusionReason,
      bReviewer: reviewerB,
      bVerdict: bDetail.verdict,
      bExclusionReason: bDetail.exclusionReason,
    });

    if (
      !aDetail.verdict ||
      !bDetail.verdict ||
      aDetail.verdict !== bDetail.verdict
    ) {
      disagreed++;
      continue;
    }

    if (aDetail.verdict === "exclude") {
      const ftOriginBoth =
        aDetail.stage === "ft_screening" && bDetail.stage === "ft_screening";
      if (!ftOriginBoth) {
        await confirmTaDecision(
          round.projectId,
          item as Zotero.Item,
          collections,
          null,
          "exclude",
          "consistency_agreed",
        );
      } else {
        await confirmTaDecision(
          round.projectId,
          item as Zotero.Item,
          collections,
          null,
          "include",
          "consistency_agreed",
        );
        const fragments = new Set<string>();
        for (const reason of [
          aDetail.exclusionReason,
          bDetail.exclusionReason,
        ]) {
          for (const part of reason.split(";")) {
            const trimmed = part.trim();
            if (trimmed) fragments.add(trimmed);
          }
        }
        for (const criterionText of fragments) {
          await addManualCheck(
            round.projectId,
            item as Zotero.Item,
            "exclusion",
            criterionText,
            "exclude",
            null,
          );
        }
        const reasons = await getConfirmedExclusionReasons(
          round.projectId,
          itemKey,
        );
        await confirmFtDecision(
          round.projectId,
          item as Zotero.Item,
          collections,
          "exclude",
          "consistency_agreed",
          reasons,
        );
      }
    } else {
      await confirmTaDecision(
        round.projectId,
        item as Zotero.Item,
        collections,
        null,
        "include",
        "consistency_agreed",
      );
      await confirmFtDecision(
        round.projectId,
        item as Zotero.Item,
        collections,
        "include",
        "consistency_agreed",
      );
    }
    applied++;
  }

  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE consistency_rounds SET status = 'reconciled', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), round.id],
  );

  return { applied, disagreed };
}
