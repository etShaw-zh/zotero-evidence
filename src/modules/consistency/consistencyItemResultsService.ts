import { databaseService } from "../db/database";

/**
 * One item's snapshot from a human-human consistency round (see
 * humanConsistencyService.ts's applyAgreedResults) -- both reviewers' own
 * derived verdict and (for an FT-origin exclude) exclusion-reason text.
 * Written for EVERY item in the round, not just disagreements: an agreed
 * item's row is harmless once the item leaves TA-Screen Queue (nothing
 * reads it there), and keeping it uniform avoids a second code path.
 */
export interface ConsistencyItemResult {
  itemKey: string;
  roundId: number;
  aReviewer: string;
  aVerdict: "include" | "exclude" | null;
  aExclusionReason: string;
  bReviewer: string;
  bVerdict: "include" | "exclude" | null;
  bExclusionReason: string;
}

/** Upserts one item's snapshot (one row per project+item, overwritten in
 * place if a later round somehow covers the same item again -- same
 * convention as coding_notes/codingNotesService.ts). */
export async function saveConsistencyItemResult(
  projectId: number,
  result: ConsistencyItemResult,
): Promise<void> {
  await databaseService.init();
  const now = new Date().toISOString();
  const rows = (await databaseService.queryAsync(
    `SELECT id FROM consistency_item_results WHERE project_id = ? AND item_key = ?`,
    [projectId, result.itemKey],
  )) as { id: number }[] | undefined;
  const existingId = rows?.[0]?.id;

  const params = [
    result.roundId,
    result.aReviewer,
    result.aVerdict,
    result.aExclusionReason,
    result.bReviewer,
    result.bVerdict,
    result.bExclusionReason,
    now,
  ];

  if (existingId) {
    await databaseService.queryAsync(
      `UPDATE consistency_item_results
       SET round_id = ?, a_reviewer = ?, a_verdict = ?, a_exclusion_reason = ?,
           b_reviewer = ?, b_verdict = ?, b_exclusion_reason = ?, updated_at = ?
       WHERE id = ?`,
      [...params, existingId],
    );
  } else {
    await databaseService.queryAsync(
      `INSERT INTO consistency_item_results
         (project_id, item_key, round_id, a_reviewer, a_verdict, a_exclusion_reason,
          b_reviewer, b_verdict, b_exclusion_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [projectId, result.itemKey, ...params, now],
    );
  }
}

/** The stored snapshot for one item, or null if it was never part of a
 * human-human consistency round -- screenQueuePane.ts uses this to decide
 * whether to show the "Reviewer A / Reviewer B" block at all. */
export async function getConsistencyItemResult(
  projectId: number,
  itemKey: string,
): Promise<ConsistencyItemResult | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT item_key, round_id, a_reviewer, a_verdict, a_exclusion_reason,
            b_reviewer, b_verdict, b_exclusion_reason
     FROM consistency_item_results WHERE project_id = ? AND item_key = ?`,
    [projectId, itemKey],
  )) as
    | {
        item_key: string;
        round_id: number;
        a_reviewer: string | null;
        a_verdict: string | null;
        a_exclusion_reason: string | null;
        b_reviewer: string | null;
        b_verdict: string | null;
        b_exclusion_reason: string | null;
      }[]
    | undefined;
  const row = rows?.[0];
  if (!row) return null;
  return {
    itemKey: row.item_key,
    roundId: row.round_id,
    aReviewer: row.a_reviewer ?? "",
    aVerdict: (row.a_verdict as "include" | "exclude" | null) ?? null,
    aExclusionReason: row.a_exclusion_reason ?? "",
    bReviewer: row.b_reviewer ?? "",
    bVerdict: (row.b_verdict as "include" | "exclude" | null) ?? null,
    bExclusionReason: row.b_exclusion_reason ?? "",
  };
}
