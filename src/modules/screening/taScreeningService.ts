import { safeGetField } from "../../utils/zoteroItem";
import { sanitizeDbText } from "../../utils/sanitize";
import {
  callChatCompletion,
  reasoningLanguageInstruction,
} from "../ai/aiClient";
import { getActiveProvider } from "../ai/providerConfig";
import { setDisagreementFlag } from "../consistency/disagreementFlagService";
import { databaseService } from "../db/database";
import { ProjectCollectionMap } from "../project/collectionStructure";
import { getLatestCriteria, ScreeningCriteria } from "./criteriaService";

export type TADecision = "include" | "exclude" | "unclear";

export interface AIJudgmentResult {
  decision: TADecision;
  reasoning: string;
  /** Short verbatim substrings copied from the title/abstract that most
   * directly support `decision`, for taQueuePane.ts to highlight in place
   * -- see buildPrompt's instruction to copy them exactly, same "must be
   * verbatim" requirement ftCriterionCheckService.ts's `quote` field
   * already enforces for FT-Screening. Empty when the model didn't return
   * any, or none survived parsing -- never blocks the decision itself. */
  keywords: string[];
}

export interface ScreeningState {
  id: number;
  aiDecision: TADecision | null;
  aiReasoning: string | null;
  aiKeywords: string[];
  decision: TADecision | null;
  exclusionReason: string | null;
}

// Same criteria as full-text screening, but applied liberally here on
// purpose (standard Cochrane/PRISMA practice): a title/abstract rarely
// reports every detail the criteria ask about, and treating a missing
// detail as a mismatch would wrongly exclude eligible studies before
// full-text review ever gets a chance to check. Full-text screening
// (ftScreeningService.ts) applies the same criteria strictly instead,
// once the complete text is available.
const SYSTEM_PROMPT =
  "You are assisting with title/abstract screening for a systematic literature review. " +
  "Given a research question, inclusion criteria, exclusion criteria, and a paper's title/abstract, " +
  "decide whether the paper should be included, excluded, or is unclear (needs full-text review). " +
  "Screen liberally: title/abstract information is inherently limited, so only exclude when the " +
  "title/abstract CLEARLY shows the paper fails to meet the criteria. A criterion simply not being " +
  "mentioned (e.g. the abstract doesn't state participant age or a specific outcome) is missing " +
  "information, not evidence of a mismatch -- that should be 'unclear', not 'exclude', so full-text " +
  "review can check it properly. Reserve 'exclude' for when the abstract itself states something " +
  "that plainly conflicts with the criteria (e.g. an explicitly wrong population, study design, or " +
  "publication type). " +
  "Also return up to 5 short keywords/phrases that most directly support your decision, copied " +
  "VERBATIM character-for-character from the title or abstract text given below -- do not " +
  "paraphrase, translate, or fix typos. Only include a keyword if it's copied exactly; omit it " +
  "entirely rather than guess. These are used to highlight the supporting text for a human " +
  "reviewer, so favor short, distinctive phrases (a few words) over long spans. " +
  'Respond with ONLY a JSON object, no markdown and no extra text: {"decision": "include"|"exclude"|"unclear", "reasoning": "one or two sentences", "keywords": ["...", ...]}.';

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
 * Tolerant like the rest of this parser: a missing/malformed `keywords`
 * array just yields no highlights rather than failing the whole judgment.
 * Capped at 8 (the prompt asks for up to 5; a little slack for a model
 * that slightly overshoots isn't worth discarding the whole judgment
 * over) and each entry sanitized/trimmed the same way `reasoning` is.
 */
function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => sanitizeDbText(v).trim())
    .filter((v) => v.length > 0)
    .slice(0, 8);
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
        keywords: parseKeywords(obj.keywords),
      };
    }
  } catch {
    // fall through to the unclear fallback below
  }
  return { decision: "unclear", reasoning: sanitizeDbText(raw), keywords: [] };
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

  const raw = await callChatCompletion(
    provider,
    [
      {
        role: "system",
        content: SYSTEM_PROMPT + reasoningLanguageInstruction(),
      },
      {
        role: "user",
        content: buildPrompt(criteriaRow.criteria, title, abstract),
      },
    ],
    "ta_screening",
  );
  const judgment = parseJudgment(raw);

  await databaseService.init();
  await databaseService.queryAsync(
    `INSERT INTO screening_records (project_id, item_key, stage, criteria_id, ai_decision, ai_reasoning, ai_keywords, ai_model)
     VALUES (?, ?, 'ta_screening', ?, ?, ?, ?, ?)`,
    [
      projectId,
      item.key,
      criteriaRow.id,
      judgment.decision,
      judgment.reasoning,
      JSON.stringify(judgment.keywords),
      provider.model,
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
    `SELECT id, ai_decision, ai_reasoning, ai_keywords, decision, exclusion_reason FROM screening_records
     WHERE project_id = ? AND item_key = ? AND stage = 'ta_screening'
     ORDER BY id DESC LIMIT 1`,
    [projectId, itemKey],
  )) as
    | {
        id: number;
        ai_decision: TADecision | null;
        ai_reasoning: string | null;
        ai_keywords: string | null;
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
    aiKeywords: parseKeywords(safeJsonParse(row.ai_keywords)),
    decision: row.decision,
    exclusionReason: row.exclusion_reason,
  };
}

/** Tolerant JSON.parse for a column that's either null (row predates this
 * column, or the judgment returned no keywords) or a JSON array string --
 * anything else (corrupt data, a future format change) degrades to no
 * highlights rather than throwing out of getScreeningState. */
function safeJsonParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Records the human-final decision and moves the item out of TA-Screen Queue
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

  // A real decision just got made either way, so whatever "reviewers
  // disagreed on this" flag applyAgreedResults may have set (see
  // humanConsistencyService.ts) no longer applies -- safe to clear
  // unconditionally even if the item was never flagged.
  await setDisagreementFlag(item, false);

  item.removeFromCollection(collections.taQueueId);
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
 * Reverses confirmDecision: moves the item back to TA-Screen Queue and clears
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
  item.addToCollection(collections.taQueueId);
  await item.saveTx();

  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE screening_records
     SET decision = NULL, human_decision = NULL, exclusion_reason = NULL, decided_by = NULL, decided_at = NULL
     WHERE id = ?`,
    [state.id],
  );
}
