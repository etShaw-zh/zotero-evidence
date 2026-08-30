import { callChatCompletion } from "../ai/aiClient";
import { getActiveProvider } from "../ai/providerConfig";
import { FT_SCREENING_ANNOTATION_COLOR } from "../../utils/annotationColors";
import {
  locateQuoteInAttachment,
  materializePendingHighlight,
} from "../pdf/pdfAnnotationCreator";
import { databaseService } from "../db/database";
import { sanitizeDbText } from "../../utils/sanitize";
import { ProjectCollectionMap } from "../project/collectionStructure";
import { getLatestCriteria, ScreeningCriteria } from "./criteriaService";

export type FTDecision = "include" | "exclude";
export type FTFinalDecision = FTDecision | "unavailable";

export interface AIJudgmentResult {
  decision: FTDecision | null;
  reasoning: string;
  /** Verbatim sentence the decision hinges on, used to auto-locate and
   * highlight the evidence in the PDF (FTS-06). May fail to match (AI
   * paraphrase, OCR noise) -- that's expected and falls back to manual
   * linking, not an error. */
  quote: string;
  /** The single exclusion criterion the AI judged as the best fit, copied
   * verbatim from the project's configured exclusion criteria -- empty
   * string when including, or when excluding without a confident match.
   * The human never picks this manually (unlike TA-Screening, which
   * doesn't capture a reason at all); they only review and confirm. */
  exclusionReason: string;
}

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

// Real PDFs can run to tens of thousands of characters; sending the whole
// thing uncapped risks blowing token/cost limits. Truncate rather than
// reject -- the AI still gets most papers' full argument, and the prompt
// says explicitly that it may be truncated so it doesn't over-trust an
// absence of a section near the end.
const MAX_FULLTEXT_CHARS = 40000;

const SYSTEM_PROMPT =
  "You are assisting with full-text screening for a systematic literature review. " +
  "Given full-text inclusion criteria, exclusion criteria, and the full text of a paper " +
  "(which may be truncated if very long), decide whether the paper should be included or excluded. " +
  "If excluding, also choose the single exclusion criterion from the provided list that best " +
  "explains why, and copy it into exclusionReason VERBATIM -- character-for-character, exactly as " +
  "given in the Exclusion criteria list -- so it can be matched back to that criterion; leave " +
  "exclusionReason as an empty string when including. " +
  'Respond with ONLY a JSON object, no markdown and no extra text: {"decision": "include"|"exclude", ' +
  '"reasoning": "explain the decision", "exclusionReason": "the verbatim matching exclusion ' +
  'criterion, or empty string if including", "quote": "the exact sentence from the text, verbatim, ' +
  'that drove the decision"}.';

function buildPrompt(criteria: ScreeningCriteria, fullText: string): string {
  const truncated = fullText.length > MAX_FULLTEXT_CHARS;
  const text = truncated ? fullText.slice(0, MAX_FULLTEXT_CHARS) : fullText;
  return [
    `Research question: ${criteria.researchQuestion}`,
    `Inclusion criteria:\n${criteria.inclusionCriteria.map((c) => `- ${c}`).join("\n")}`,
    `Exclusion criteria:\n${criteria.exclusionCriteria.map((c) => `- ${c}`).join("\n")}`,
    `Full text${truncated ? " (truncated)" : ""}:\n${text}`,
  ].join("\n\n");
}

function normalizeDecision(value: unknown): FTDecision | null {
  const v = String(value ?? "").toLowerCase();
  return v === "include" || v === "exclude" ? v : null;
}

/**
 * Unlike TA-Screening there's no "unclear" intermediate state at the
 * full-text stage (REQUIREMENTS.md FTS-04 only defines Include/Exclude), so
 * an unparseable response doesn't get a synthesized third state -- it comes
 * back with decision=null and the raw text as reasoning, and the UI leaves
 * both buttons available for a human to decide directly.
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
        quote: typeof obj.quote === "string" ? sanitizeDbText(obj.quote) : "",
        exclusionReason:
          typeof obj.exclusionReason === "string"
            ? sanitizeDbText(obj.exclusionReason)
            : "",
      };
    }
  } catch {
    // fall through
  }
  return {
    decision: null,
    reasoning: sanitizeDbText(raw),
    quote: "",
    exclusionReason: "",
  };
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

async function getOrCreateRecordId(
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
 * Marks a human-created highlight in the item's PDF as the supporting
 * evidence for its FT-Screening decision (FTS-06). Forces the annotation to
 * the fixed orange color so FT-Screening and Coding annotations on the same
 * PDF stay visually distinguishable by stage (REQUIREMENTS 2.4.5) -- AI
 * itself can't create the highlight (no official text-to-PDF-coordinates
 * API), so the human highlights natively and this just claims/colors it.
 */
export async function linkFtAnnotation(
  projectId: number,
  item: Zotero.Item,
  annotationKey: string,
): Promise<void> {
  const annotation = Zotero.Items.getByLibraryAndKey(
    item.libraryID,
    annotationKey,
  );
  if (annotation) {
    (annotation as any).annotationColor = FT_SCREENING_ANNOTATION_COLOR;
    await (annotation as Zotero.Item).saveTx();
  }

  const id = await getOrCreateRecordId(projectId, item.key);
  await databaseService.queryAsync(
    `UPDATE screening_records SET annotation_key = ? WHERE id = ?`,
    [annotationKey, id],
  );
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
 * Runs the AI full-text judgment. Refuses to run unless the user has
 * already confirmed full-text availability (FTS-11 gate) -- this avoids
 * spending a request on an item that isn't actually ready, and keeps the
 * "who confirmed the PDF is usable" step meaningfully human-owned.
 */
export async function runAIJudgment(
  projectId: number,
  item: Zotero.Item,
): Promise<AIJudgmentResult & { screeningRecordId: number }> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error("No AI provider configured.");
  }
  const criteriaRow = await getLatestCriteria(projectId, "ft");
  if (!criteriaRow) {
    throw new Error("No FT screening criteria configured for this project.");
  }
  const state = await getScreeningState(projectId, item.key);
  if (!state?.fulltextReady) {
    throw new Error(
      "Full text has not been confirmed ready for this item yet.",
    );
  }
  const fullText = await getAttachmentFullText(item);
  if (!fullText) {
    throw new Error("Could not read full text from the PDF attachment.");
  }

  const raw = await callChatCompletion(provider, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildPrompt(criteriaRow.criteria, fullText) },
  ]);
  const judgment = parseJudgment(raw);

  // Only trust an exclusionReason that exactly matches one of the
  // project's configured exclusion criteria -- a paraphrase or near-
  // duplicate string would otherwise fragment the PRISMA reasons
  // breakdown (getReasonCounts groups by exact exclusion_reason text).
  // `null` here also correctly clears a stale reason from a prior run
  // when this run doesn't exclude or doesn't confidently match.
  const matchedExclusionReason =
    judgment.decision === "exclude" &&
    criteriaRow.criteria.exclusionCriteria.includes(judgment.exclusionReason)
      ? judgment.exclusionReason
      : null;

  const id = await getOrCreateRecordId(projectId, item.key);
  await databaseService.queryAsync(
    `UPDATE screening_records
     SET criteria_id = ?, ai_decision = ?, ai_reasoning = ?, exclusion_reason = ?
     WHERE id = ?`,
    [
      criteriaRow.id,
      judgment.decision,
      judgment.reasoning,
      matchedExclusionReason,
      id,
    ],
  );

  // Best-effort (FTS-06): try to locate the cited quote in the PDF. This
  // only records WHERE the evidence is (pending_position) -- it does NOT
  // create a real annotation yet. The highlight only gets materialized once
  // the human actually confirms the decision (see confirmDecision), so
  // nothing shows up on the PDF for a suggestion nobody has reviewed. A miss
  // (paraphrase, OCR noise) or any extraction failure just leaves
  // pending_position unset -- the existing manual "choose a highlight, mark
  // as evidence" UI is still there as a fallback, so this must never throw
  // out of runAIJudgment.
  if (judgment.quote) {
    try {
      const attachment = await item.getBestAttachment();
      if (attachment && attachment.isPDFAttachment()) {
        const located = await locateQuoteInAttachment(
          attachment,
          judgment.quote,
        );
        if (located) {
          await databaseService.queryAsync(
            `UPDATE screening_records SET pending_position = ? WHERE id = ?`,
            [JSON.stringify(located), id],
          );
        }
      }
    } catch (e) {
      ztoolkit.log("FT-Screening auto-locate failed", item.key, e);
    }
  }

  return { ...judgment, screeningRecordId: id };
}

/**
 * Records the human-final decision and moves the item from FT-Queue into
 * FT-Include or FT-Exclude. This is also the point where a pending
 * auto-located highlight (FTS-06) gets materialized into a real annotation
 * -- confirming the decision IS the human's confirmation of the evidence,
 * so the PDF only gains a highlight once a decision has actually been made.
 */
export async function confirmDecision(
  projectId: number,
  item: Zotero.Item,
  collections: ProjectCollectionMap,
  decision: FTDecision,
  decidedBy: string,
  exclusionReason: string | null = null,
): Promise<void> {
  const id = await getOrCreateRecordId(projectId, item.key);
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `UPDATE screening_records
     SET decision = ?, human_decision = ?, exclusion_reason = ?, decided_by = ?, decided_at = ?
     WHERE id = ?`,
    [decision, decision, exclusionReason, decidedBy, now, id],
  );

  const state = await getScreeningState(projectId, item.key);
  if (state && !state.annotationKey && state.pendingPosition) {
    try {
      const attachment = await item.getBestAttachment();
      if (attachment && attachment.isPDFAttachment()) {
        const annotationKey = await materializePendingHighlight(
          attachment,
          state.pendingPosition,
          FT_SCREENING_ANNOTATION_COLOR,
          state.aiReasoning ?? "",
        );
        await databaseService.queryAsync(
          `UPDATE screening_records SET annotation_key = ?, pending_position = NULL WHERE id = ?`,
          [annotationKey, id],
        );
      }
    } catch (e) {
      ztoolkit.log("FT-Screening materialize highlight failed", item.key, e);
    }
  }

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
