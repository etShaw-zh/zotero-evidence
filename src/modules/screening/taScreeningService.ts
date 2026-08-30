import { safeGetField } from "../../utils/zoteroItem";
import { sanitizeDbText } from "../../utils/sanitize";
import { callChatCompletion } from "../ai/aiClient";
import { getActiveProvider } from "../ai/providerConfig";
import { databaseService } from "../db/database";
import { ProjectCollectionMap } from "../project/collectionStructure";
import { getLatestCriteria, ScreeningCriteria } from "./criteriaService";

export type TADecision = "include" | "exclude" | "unclear";

export interface AIJudgmentResult {
  decision: TADecision;
  reasoning: string;
}

export interface ScreeningState {
  id: number;
  aiDecision: TADecision | null;
  aiReasoning: string | null;
  decision: TADecision | null;
  exclusionReason: string | null;
}

const SYSTEM_PROMPT =
  "You are assisting with title/abstract screening for a systematic literature review. " +
  "Given a research question, inclusion criteria, exclusion criteria, and a paper's title/abstract, " +
  "decide whether the paper should be included, excluded, or is unclear (needs full-text review). " +
  'Respond with ONLY a JSON object, no markdown and no extra text: {"decision": "include"|"exclude"|"unclear", "reasoning": "one or two sentences"}.';

function buildPrompt(
  criteria: ScreeningCriteria,
  title: string,
  abstract: string,
): string {
  return [
    `Research question: ${criteria.researchQuestion}`,
    `Inclusion criteria:\n${criteria.inclusionCriteria.map((c) => `- ${c}`).join("\n")}`,
    `Exclusion criteria:\n${criteria.exclusionCriteria.map((c) => `- ${c}`).join("\n")}`,
    `Title: ${title}`,
    `Abstract: ${abstract || "(no abstract available)"}`,
  ].join("\n\n");
}

function normalizeDecision(value: unknown): TADecision | null {
  const v = String(value ?? "").toLowerCase();
  return v === "include" || v === "exclude" || v === "unclear" ? v : null;
}

/**
 * A response that isn't valid/parseable JSON is treated as TA-Unclear with
 * the raw text kept as the reasoning, rather than throwing -- an odd model
 * response shouldn't be worse than "needs a human look", and it shouldn't
 * abort whatever loop triggered the judgment.
 */
export function parseJudgment(raw: string): AIJudgmentResult {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : text;
  try {
    const obj = JSON.parse(jsonText);
    const decision = normalizeDecision(obj.decision);
    if (decision) {
      return {
        decision,
        reasoning: sanitizeDbText(String(obj.reasoning ?? "")),
      };
    }
  } catch {
    // fall through to the unclear fallback below
  }
  return { decision: "unclear", reasoning: sanitizeDbText(raw) };
}

export async function runAIJudgment(
  projectId: number,
  item: Zotero.Item,
): Promise<AIJudgmentResult & { screeningRecordId: number }> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error("No AI provider configured.");
  }
  const criteriaRow = await getLatestCriteria(projectId, "ta");
  if (!criteriaRow) {
    throw new Error("No TA screening criteria configured for this project.");
  }

  const title = safeGetField(item, "title");
  const abstract = safeGetField(item, "abstractNote");

  const raw = await callChatCompletion(provider, [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: buildPrompt(criteriaRow.criteria, title, abstract),
    },
  ]);
  const judgment = parseJudgment(raw);

  await databaseService.init();
  await databaseService.queryAsync(
    `INSERT INTO screening_records (project_id, item_key, stage, criteria_id, ai_decision, ai_reasoning)
     VALUES (?, ?, 'ta_screening', ?, ?, ?)`,
    [
      projectId,
      item.key,
      criteriaRow.id,
      judgment.decision,
      judgment.reasoning,
    ],
  );
  const screeningRecordId = await databaseService.getLastInsertId();

  return { ...judgment, screeningRecordId };
}

export async function getScreeningState(
  projectId: number,
  itemKey: string,
): Promise<ScreeningState | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT id, ai_decision, ai_reasoning, decision, exclusion_reason FROM screening_records
     WHERE project_id = ? AND item_key = ? AND stage = 'ta_screening'
     ORDER BY id DESC LIMIT 1`,
    [projectId, itemKey],
  )) as
    | {
        id: number;
        ai_decision: TADecision | null;
        ai_reasoning: string | null;
        decision: TADecision | null;
        exclusion_reason: string | null;
      }[]
    | undefined;
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: row.id,
    aiDecision: row.ai_decision,
    aiReasoning: row.ai_reasoning,
    decision: row.decision,
    exclusionReason: row.exclusion_reason,
  };
}

/**
 * Records the human-final decision and moves the item out of Screen Queue
 * into TA-Include/TA-Exclude/TA-Unclear. Per REQUIREMENTS.md 2.2.4,
 * TA-Unclear is treated the same as TA-Include for downstream flow: both
 * also land in FT-Queue.
 */
export async function confirmDecision(
  projectId: number,
  item: Zotero.Item,
  collections: ProjectCollectionMap,
  screeningRecordId: number | null,
  finalDecision: TADecision,
  decidedBy: string,
  exclusionReason: string | null = null,
): Promise<void> {
  await databaseService.init();
  const now = new Date().toISOString();

  if (screeningRecordId) {
    await databaseService.queryAsync(
      `UPDATE screening_records
       SET decision = ?, human_decision = ?, exclusion_reason = ?, decided_by = ?, decided_at = ?
       WHERE id = ?`,
      [
        finalDecision,
        finalDecision,
        exclusionReason,
        decidedBy,
        now,
        screeningRecordId,
      ],
    );
  } else {
    const criteriaRow = await getLatestCriteria(projectId, "ta");
    await databaseService.queryAsync(
      `INSERT INTO screening_records
         (project_id, item_key, stage, criteria_id, decision, human_decision, exclusion_reason, decided_by, decided_at)
       VALUES (?, ?, 'ta_screening', ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        item.key,
        criteriaRow?.id ?? null,
        finalDecision,
        finalDecision,
        exclusionReason,
        decidedBy,
        now,
      ],
    );
  }

  item.removeFromCollection(collections.screenQueueId);
  const targetCollectionId =
    finalDecision === "include"
      ? collections.taIncludeId
      : finalDecision === "exclude"
        ? collections.taExcludeId
        : collections.taUnclearId;
  item.addToCollection(targetCollectionId);
  if (finalDecision !== "exclude") {
    item.addToCollection(collections.ftQueueId);
  }
  await item.saveTx();
}

/**
 * Reverses confirmDecision: moves the item back to Screen Queue and clears
 * the human decision fields, leaving ai_decision/ai_reasoning intact -- same
 * "only clear confirmation fields, don't destroy the AI's original
 * suggestion" precedent as codingService.ts's unconfirmRecord. No-ops if
 * the item has no recorded TA decision to undo.
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
      ? collections.taIncludeId
      : state.decision === "exclude"
        ? collections.taExcludeId
        : collections.taUnclearId;
  item.removeFromCollection(sourceCollectionId);
  if (state.decision !== "exclude") {
    item.removeFromCollection(collections.ftQueueId);
  }
  item.addToCollection(collections.screenQueueId);
  await item.saveTx();

  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE screening_records
     SET decision = NULL, human_decision = NULL, exclusion_reason = NULL, decided_by = NULL, decided_at = NULL
     WHERE id = ?`,
    [state.id],
  );
}
