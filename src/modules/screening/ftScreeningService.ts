import { databaseService } from "../db/database";
import { ProjectCollectionMap } from "../project/collectionStructure";

export type FTDecision = "include" | "exclude";
export type FTFinalDecision = FTDecision | "unavailable";

export interface ScreeningState {
  id: number;
  fulltextReady: boolean;
  aiDecision: FTDecision | null;
  aiReasoning: string | null;
  decision: FTFinalDecision | null;
  exclusionReason: string | null;
  annotationKey: string | null;
  /** JSON `LocatedQuote` from a successful auto-locate that hasn't been
   * confirmed into a real annotation yet (FTS-06) -- see confirmDecision. */
  pendingPosition: string | null;
}

/**
 * Reads the extracted plain text of an item's best PDF attachment. Returns
 * null (rather than throwing) whenever text isn't available for any reason
 * -- no attachment, not a PDF, not yet indexed -- so callers can show a
 * clear "not available" state instead of an opaque error.
 */
export async function getAttachmentFullText(
  item: Zotero.Item,
): Promise<string | null> {
  try {
    const attachment = await item.getBestAttachment();
    if (!attachment || !attachment.isPDFAttachment()) return null;
    const text = await attachment.attachmentText;
    return text && text.trim() ? text : null;
  } catch {
    return null;
  }
}

// Exported for ftCriterionCheckService.ts, which shares this same
// screening_records row (one per project/item/ft_screening) to gate on
// fulltext_ready and to write back the AI-vs-human rollup summary.
export async function getOrCreateRecordId(
  projectId: number,
  itemKey: string,
): Promise<number> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT id FROM screening_records
     WHERE project_id = ? AND item_key = ? AND stage = 'ft_screening'
     ORDER BY id DESC LIMIT 1`,
    [projectId, itemKey],
  )) as { id: number }[] | undefined;
  if (rows && rows[0]) return rows[0].id;
  await databaseService.queryAsync(
    `INSERT INTO screening_records (project_id, item_key, stage) VALUES (?, ?, 'ft_screening')`,
    [projectId, itemKey],
  );
  return databaseService.getLastInsertId();
}

export async function getScreeningState(
  projectId: number,
  itemKey: string,
): Promise<ScreeningState | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT id, fulltext_ready, ai_decision, ai_reasoning, decision, exclusion_reason, annotation_key, pending_position FROM screening_records
     WHERE project_id = ? AND item_key = ? AND stage = 'ft_screening'
     ORDER BY id DESC LIMIT 1`,
    [projectId, itemKey],
  )) as
    | {
        id: number;
        fulltext_ready: number;
        ai_decision: FTDecision | null;
        ai_reasoning: string | null;
        decision: FTFinalDecision | null;
        exclusion_reason: string | null;
        annotation_key: string | null;
        pending_position: string | null;
      }[]
    | undefined;
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: row.id,
    fulltextReady: !!row.fulltext_ready,
    aiDecision: row.ai_decision,
    aiReasoning: row.ai_reasoning,
    decision: row.decision,
    exclusionReason: row.exclusion_reason,
    annotationKey: row.annotation_key,
    pendingPosition: row.pending_position,
  };
}

/**
 * Records the user's manual confirmation that a PDF is available and ready
 * for full-text screening (FTS-11). Purely human-triggered, per
 * REQUIREMENTS.md 2.4.5 -- the plugin never infers this from attachment
 * presence on its own.
 */
export async function markFulltextReady(
  projectId: number,
  item: Zotero.Item,
  decidedBy: string,
): Promise<void> {
  const id = await getOrCreateRecordId(projectId, item.key);
  await databaseService.queryAsync(
    `UPDATE screening_records
     SET fulltext_ready = 1, fulltext_ready_at = ?, fulltext_ready_by = ?
     WHERE id = ?`,
    [new Date().toISOString(), decidedBy, id],
  );
}

/**
 * Records the human-final decision and moves the item from FT-Queue into
 * FT-Include or FT-Exclude. `exclusionReasons` is the list of criterion
 * texts the caller collected from confirmed 'exclude'-verdict criterion
 * checks (see ftCriterionCheckService.ts's getConfirmedExclusionReasons) --
 * this function just joins and stores them, it doesn't compute them itself
 * (that would create a circular import between the two services). Evidence
 * is no longer materialized here: each criterion check now carries and
 * materializes its own highlight independently (see
 * ftCriterionCheckService.ts's confirmCheck), since a single item can have
 * several pieces of evidence now instead of one.
 */
export async function confirmDecision(
  projectId: number,
  item: Zotero.Item,
  collections: ProjectCollectionMap,
  decision: FTDecision,
  decidedBy: string,
  exclusionReasons: string[] | null = null,
): Promise<void> {
  const id = await getOrCreateRecordId(projectId, item.key);
  const now = new Date().toISOString();
  const exclusionReason =
    exclusionReasons && exclusionReasons.length > 0
      ? exclusionReasons.join("; ")
      : null;
  await databaseService.queryAsync(
    `UPDATE screening_records
     SET decision = ?, human_decision = ?, exclusion_reason = ?, decided_by = ?, decided_at = ?
     WHERE id = ?`,
    [decision, decision, exclusionReason, decidedBy, now, id],
  );

  item.removeFromCollection(collections.ftQueueId);
  if (decision === "include") {
    item.addToCollection(collections.ftIncludeId);
    // REQUIREMENTS 2.1.4 describes Coding as "待编码/已编码" (pending or
    // already coded) -- every FT-Include item belongs there right away, not
    // just ones a human has already started coding (codingPane.ts's
    // "Generate AI Suggestions" button also adds to this collection, but
    // that only covers items someone already opened).
    item.addToCollection(collections.codingId);
  } else {
    item.addToCollection(collections.ftExcludeId);
  }
  await item.saveTx();
}

/**
 * Records that the full text could not be obtained (FTS-08) and moves the
 * item from FT-Queue into FT-Unavailable. Purely human-triggered.
 */
export async function markUnavailable(
  projectId: number,
  item: Zotero.Item,
  collections: ProjectCollectionMap,
  decidedBy: string,
): Promise<void> {
  const id = await getOrCreateRecordId(projectId, item.key);
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `UPDATE screening_records
     SET decision = 'unavailable', human_decision = 'unavailable', decided_by = ?, decided_at = ?
     WHERE id = ?`,
    [decidedBy, now, id],
  );

  item.removeFromCollection(collections.ftQueueId);
  item.addToCollection(collections.ftUnavailableId);
  await item.saveTx();
}

/**
 * Reverses confirmDecision/markUnavailable: moves the item back to
 * FT-Screen Queue and clears the human decision fields, leaving
 * fulltext_ready/annotation_key/pending_position untouched -- the PDF and
 * whatever highlight was already claimed for it didn't change, so there's
 * nothing to undo there. Same "only clear confirmation fields" precedent as
 * codingService.ts's unconfirmRecord.
 *
 * If the decision being undone was "include", the item also gets removed
 * from Extract Coding (confirmDecision put it there automatically) -- but
 * any coding_records rows already written for it are deliberately left
 * alone, so re-including later picks up existing coding work rather than
 * losing it.
 */
export async function undoDecision(
  projectId: number,
  item: Zotero.Item,
  collections: ProjectCollectionMap,
): Promise<void> {
  const state = await getScreeningState(projectId, item.key);
  if (!state || !state.decision) return;

  const sourceCollectionId =
    state.decision === "include"
      ? collections.ftIncludeId
      : state.decision === "exclude"
        ? collections.ftExcludeId
        : collections.ftUnavailableId;
  item.removeFromCollection(sourceCollectionId);
  if (state.decision === "include") {
    item.removeFromCollection(collections.codingId);
  }
  item.addToCollection(collections.ftQueueId);
  await item.saveTx();

  await databaseService.queryAsync(
    `UPDATE screening_records
     SET decision = NULL, human_decision = NULL, exclusion_reason = NULL, decided_by = NULL, decided_at = NULL
     WHERE id = ?`,
    [state.id],
  );
}
