import { databaseService } from "../db/database";
import { sanitizeDbText } from "../../utils/sanitize";
import { runWithConcurrency } from "../../utils/concurrency";
import { callJev, JevChoice } from "../ai/jevClient";
import { JevConfig } from "../ai/jevConfig";
import { runJevBatchDeduped } from "../ai/jevRunTracker";
import { getLatestCriteria, ScreeningCriteria } from "./criteriaService";

export interface JevEvaluation {
  id: number;
  itemKey: string;
  model: string;
  status: "ok" | "error";
  decision: JevChoice | null;
  confidence: number | null;
  probabilities: Record<string, number>;
  errorMessage: string | null;
  createdAt: string;
}

/**
 * Prompt state text -- ported verbatim from jev_ta_screening_eval.py's
 * build_state(), the validated reference script this feature replaces the
 * manual half of. Kept byte-for-byte identical (including the "screen
 * liberally" policy paragraph) so results stay comparable to that script's
 * past runs and don't quietly drift from what was actually evaluated.
 */
export function buildJevState(
  criteria: ScreeningCriteria,
  title: string,
  abstract: string,
): string {
  const inclusion = criteria.inclusionCriteria.map((c) => `- ${c}`).join("\n");
  const exclusion = criteria.exclusionCriteria.map((c) => `- ${c}`).join("\n");
  return (
    "You are assisting with title/abstract screening for a systematic literature review.\n" +
    "Screen liberally: title/abstract information is inherently limited, so only judge " +
    "'exclude' when the title/abstract CLEARLY shows the paper fails to meet the criteria. " +
    "A criterion simply not being mentioned is missing information, not evidence of a " +
    "mismatch -- that should be 'unclear' rather than 'exclude', so full-text review can " +
    "check it properly. Reserve 'exclude' for when the abstract itself states something " +
    "that plainly conflicts with the criteria.\n\n" +
    `Research question: ${criteria.researchQuestion}\n\n` +
    `Inclusion criteria:\n${inclusion}\n\n` +
    `Exclusion criteria:\n${exclusion}\n\n` +
    `Title: ${title}\n\n` +
    `Abstract: ${abstract || "(no abstract available)"}`
  );
}

function rowToEvaluation(row: any): JevEvaluation {
  let probabilities: Record<string, number> = {};
  if (row.probabilities) {
    try {
      probabilities = JSON.parse(row.probabilities);
    } catch {
      probabilities = {};
    }
  }
  return {
    id: row.id,
    itemKey: row.item_key,
    model: row.model,
    status: row.status,
    decision: row.decision,
    confidence: row.confidence,
    probabilities,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

async function insertEvaluation(
  projectId: number,
  itemKey: string,
  model: string,
  outcome:
    | {
        status: "ok";
        decision: JevChoice;
        confidence: number | null;
        probabilities: Record<string, number>;
      }
    | { status: "error"; errorMessage: string },
): Promise<void> {
  await databaseService.init();
  await databaseService.queryAsync(
    `INSERT INTO jev_evaluations
      (project_id, item_key, model, status, decision, confidence, probabilities, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      itemKey,
      model,
      outcome.status,
      outcome.status === "ok" ? outcome.decision : null,
      outcome.status === "ok" ? outcome.confidence : null,
      outcome.status === "ok" ? JSON.stringify(outcome.probabilities) : null,
      outcome.status === "error" ? sanitizeDbText(outcome.errorMessage) : null,
      new Date().toISOString(),
    ],
  );
}

/**
 * The latest jev_evaluations row (success or failure) per item in this
 * project -- "查看最新结果". The table is append-only (every run, and every
 * re-run, adds new rows rather than overwriting), so "latest" is simply
 * the newest id per item_key.
 */
export async function getLatestJevEvaluations(
  projectId: number,
): Promise<Map<string, JevEvaluation>> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT e.* FROM jev_evaluations e
     INNER JOIN (
       SELECT item_key, MAX(id) AS max_id FROM jev_evaluations
       WHERE project_id = ? GROUP BY item_key
     ) latest ON latest.item_key = e.item_key AND latest.max_id = e.id
     WHERE e.project_id = ?`,
    [projectId, projectId],
  )) as any[] | undefined;
  const map = new Map<string, JevEvaluation>();
  for (const row of rows || []) map.set(row.item_key, rowToEvaluation(row));
  return map;
}

export async function getLatestJevEvaluation(
  projectId: number,
  itemKey: string,
): Promise<JevEvaluation | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT * FROM jev_evaluations WHERE project_id = ? AND item_key = ?
     ORDER BY id DESC LIMIT 1`,
    [projectId, itemKey],
  )) as any[] | undefined;
  const row = rows?.[0];
  return row ? rowToEvaluation(row) : null;
}

export interface JevBatchResult {
  succeeded: number;
  failed: number;
  skipped: number;
  /** Items never dispatched, or aborted mid-flight, because the run was
   * cancelled (jevRunTracker.ts's requestJevBatchCancel) -- distinct from
   * `skipped` (already had an 'ok' evaluation, no cancellation involved).
   * No jev_evaluations row is written for these; an explicit user
   * cancellation isn't a model failure worth recording as one. */
  cancelled: number;
  failures: { title: string; reason: string }[];
}

/**
 * Runs JEV over `items` and persists one row per item (success or
 * failure), deduped per-project via jevRunTracker so a second concurrent
 * click joins the same run instead of starting another. Skips an item that
 * already has an 'ok' evaluation unless `forceRerun` is set -- mirrors
 * jev_ta_screening_eval.py's own cache-based incremental behavior, and is
 * what makes clicking "运行" again safe/cheap after new items were added to
 * the project.
 */
export async function runJevBatch(
  projectId: number,
  config: JevConfig,
  items: Zotero.Item[],
  options: {
    forceRerun?: boolean;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<JevBatchResult> {
  const criteriaRow = await getLatestCriteria(projectId, "ta");
  if (!criteriaRow) {
    throw new Error("No screening criteria configured for this project.");
  }
  const existing = options.forceRerun
    ? new Map<string, JevEvaluation>()
    : await getLatestJevEvaluations(projectId);

  const toRun = options.forceRerun
    ? items
    : items.filter((item) => existing.get(item.key)?.status !== "ok");
  const skipped = items.length - toRun.length;

  return runJevBatchDeduped(
    projectId,
    toRun.length,
    async (report, cancelToken) => {
      let done = 0;
      let succeeded = 0;
      let failed = 0;
      let cancelled = 0;
      const failures: { title: string; reason: string }[] = [];

      await runWithConcurrency(
        toRun,
        options.concurrency ?? 3,
        async (item) => {
          // Checked before starting each item (not just relied on via the
          // in-flight canceller below) so a request that hasn't been
          // dispatched yet is never started at all once cancellation was
          // requested, rather than starting and immediately being aborted.
          if (cancelToken.isCancelled()) {
            cancelled++;
            return;
          }
          const title = (item.getField("title") as string) || "";
          const abstract = (item.getField("abstractNote") as string) || "";
          const state = buildJevState(criteriaRow.criteria, title, abstract);
          try {
            const answer = await callJev(config, state, undefined, {
              registerCanceler: cancelToken.registerCanceler,
            });
            await insertEvaluation(projectId, item.key, config.model, {
              status: "ok",
              decision: answer.choice,
              confidence: answer.confidence,
              probabilities: answer.probabilities,
            });
            succeeded++;
          } catch (e: any) {
            if (cancelToken.isCancelled()) {
              // Aborted mid-flight by the "取消" button -- not a model/network
              // failure worth persisting as one (see JevBatchResult's doc
              // comment on `cancelled`).
              cancelled++;
            } else {
              const reason = e?.message ?? String(e);
              await insertEvaluation(projectId, item.key, config.model, {
                status: "error",
                errorMessage: reason,
              });
              failed++;
              failures.push({ title: item.getDisplayTitle(), reason });
            }
          }
          done++;
          report(done);
          options.onProgress?.(done, toRun.length);
        },
      );

      return { succeeded, failed, skipped, cancelled, failures };
    },
  );
}
