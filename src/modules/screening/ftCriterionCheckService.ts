import { callChatCompletion } from "../ai/aiClient";
import { getActiveProvider } from "../ai/providerConfig";
import { FT_SCREENING_ANNOTATION_COLOR } from "../../utils/annotationColors";
import {
  locateQuoteInAttachment,
  materializePendingHighlight,
} from "../pdf/pdfAnnotationCreator";
import { databaseService } from "../db/database";
import { sanitizeDbText } from "../../utils/sanitize";
import { getLatestCriteria, ScreeningCriteria } from "./criteriaService";
import {
  getAttachmentFullText,
  getOrCreateRecordId,
  getScreeningState,
} from "./ftScreeningService";

export type CriterionType = "inclusion" | "exclusion";
export type CriterionVerdict = "include" | "exclude";

export interface CriterionCheck {
  id: number;
  criterionType: CriterionType;
  criterionText: string;
  verdict: CriterionVerdict;
  reasoning: string | null;
  quote: string | null;
  annotationKey: string | null;
  /** JSON `LocatedQuote` from a successful auto-locate that hasn't been
   * confirmed into a real annotation yet -- see confirmCheck. */
  pendingPosition: string | null;
  source: "ai" | "human";
  confirmed: boolean;
}

// Same cap used elsewhere (ftScreeningService.ts's old prompt, codingService.ts)
// for the same reason: real PDFs can run to tens of thousands of characters.
const MAX_FULLTEXT_CHARS = 40000;

const SYSTEM_PROMPT =
  "You are assisting with full-text screening for a systematic literature review, checking one " +
  "paper against a checklist of eligibility criteria rather than making a single overall call. " +
  "You will be given numbered inclusion criteria, numbered exclusion criteria, and the paper's full " +
  "text (which may be truncated if very long). " +
  'For EVERY inclusion criterion, decide whether the paper satisfies it: verdict "include" if ' +
  "satisfied (quote MUST then contain the exact supporting sentence, copied verbatim character-for-" +
  'character -- do not paraphrase), or "exclude" if not satisfied or not supported by the text ' +
  "(explain why in reasoning; quote may be empty). " +
  "For exclusion criteria, only report the ones that actually apply to this paper -- verdict is " +
  'always "exclude" for these, with a supporting verbatim quote; skip any exclusion criterion that ' +
  "does not apply, do not add an entry for it at all. " +
  "Respond with ONLY a JSON object, no markdown and no extra text: " +
  '{"checks": [{"criterionType": "inclusion"|"exclusion", "criterionIndex": 0, ' +
  '"verdict": "include"|"exclude", "reasoning": "...", "quote": "..."}]}. ' +
  "criterionIndex is the 0-based position of the criterion within its own list (inclusion or " +
  "exclusion), exactly as numbered below.";

function buildPrompt(criteria: ScreeningCriteria, fullText: string): string {
  const truncated = fullText.length > MAX_FULLTEXT_CHARS;
  const text = truncated ? fullText.slice(0, MAX_FULLTEXT_CHARS) : fullText;
  return [
    `Research question: ${criteria.researchQuestion}`,
    `Inclusion criteria:\n${criteria.inclusionCriteria.map((c, i) => `${i}. ${c}`).join("\n")}`,
    `Exclusion criteria:\n${criteria.exclusionCriteria.map((c, i) => `${i}. ${c}`).join("\n")}`,
    `Full text${truncated ? " (truncated)" : ""}:\n${text}`,
  ].join("\n\n");
}

interface RawCheck {
  criterionType: CriterionType;
  criterionIndex: number;
  verdict: CriterionVerdict;
  reasoning: string;
  quote: string;
}

/**
 * Tolerant, same fault-handling philosophy as parseSuggestions/parseJudgment
 * elsewhere: a malformed response yields an empty array rather than
 * throwing, and an individual entry with an out-of-range criterionIndex or
 * wrong shape is dropped rather than failing the whole batch.
 */
export function parseCriterionChecks(raw: string): RawCheck[] {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : text;
  try {
    const obj = JSON.parse(jsonText);
    const checks = Array.isArray(obj?.checks) ? obj.checks : [];
    return checks
      .filter(
        (c: any) =>
          (c?.criterionType === "inclusion" ||
            c?.criterionType === "exclusion") &&
          Number.isInteger(c?.criterionIndex) &&
          (c?.verdict === "include" || c?.verdict === "exclude"),
      )
      .map((c: any) => ({
        criterionType: c.criterionType,
        criterionIndex: c.criterionIndex,
        verdict: c.verdict,
        reasoning: sanitizeDbText(String(c.reasoning ?? "")),
        quote: typeof c.quote === "string" ? sanitizeDbText(c.quote) : "",
      }));
  } catch {
    return [];
  }
}

function rowToCheck(row: any): CriterionCheck {
  return {
    id: row.id,
    criterionType: row.criterion_type,
    criterionText: row.criterion_text,
    verdict: row.verdict,
    reasoning: row.reasoning,
    quote: row.quote,
    annotationKey: row.annotation_key,
    pendingPosition: row.pending_position,
    source: row.source,
    confirmed: !!row.confirmed,
  };
}

export async function getCriterionChecks(
  projectId: number,
  itemKey: string,
): Promise<CriterionCheck[]> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT id, criterion_type, criterion_text, verdict, reasoning, quote, annotation_key, pending_position, source, confirmed
     FROM ft_criterion_checks WHERE project_id = ? AND item_key = ? ORDER BY id ASC`,
    [projectId, itemKey],
  )) as any[] | undefined;
  return (rows || []).map(rowToCheck);
}

/**
 * Roll-up rule (advisory only, same as every other AI-vs-human feature in
 * this plugin): any CONFIRMED exclude-verdict check -> 'exclude' (whether
 * it's an unmet inclusion criterion or a triggered exclusion criterion,
 * both mean the paper doesn't qualify); otherwise, once every inclusion
 * criterion has a CONFIRMED include-verdict check -> 'include'; anything
 * short of that is 'unclear' -- not enough has been reviewed yet to say
 * either way. Unconfirmed AI suggestions never count on their own, by
 * design: silently trusting them would recreate the exact "AI decided and
 * nobody actually checked" problem this whole checklist replaces.
 */
export function computeRollup(
  checks: CriterionCheck[],
  totalInclusionCriteria: number,
): "include" | "exclude" | "unclear" {
  const confirmed = checks.filter((c) => c.confirmed);
  if (confirmed.some((c) => c.verdict === "exclude")) return "exclude";
  const confirmedIncludes = confirmed.filter(
    (c) => c.criterionType === "inclusion" && c.verdict === "include",
  ).length;
  if (
    totalInclusionCriteria > 0 &&
    confirmedIncludes >= totalInclusionCriteria
  ) {
    return "include";
  }
  return "unclear";
}

/** Only CONFIRMED exclude-verdict checks count as a recorded reason -- an
 * unconfirmed AI suggestion is not evidence anyone actually endorsed. */
export async function getConfirmedExclusionReasons(
  projectId: number,
  itemKey: string,
): Promise<string[]> {
  const checks = await getCriterionChecks(projectId, itemKey);
  return checks
    .filter((c) => c.confirmed && c.verdict === "exclude")
    .map((c) => c.criterionText);
}

/** Unconfirmed AI-suggested exclude-verdict checks -- used by the UI to
 * warn before finalizing an Exclude decision that skips reviewing them. */
export async function getUnconfirmedExcludeChecks(
  projectId: number,
  itemKey: string,
): Promise<CriterionCheck[]> {
  const checks = await getCriterionChecks(projectId, itemKey);
  return checks.filter((c) => !c.confirmed && c.verdict === "exclude");
}

/**
 * Writes the AI-vs-human rollup summary back onto the shared
 * screening_records row (ai_decision/ai_reasoning) purely so existing
 * readers of getScreeningState (the library-tab history view, exports)
 * keep showing something sensible -- the checklist itself, not these
 * columns, is the source of truth going forward.
 */
async function refreshAggregate(
  projectId: number,
  itemKey: string,
): Promise<void> {
  const [checks, criteriaRow] = await Promise.all([
    getCriterionChecks(projectId, itemKey),
    getLatestCriteria(projectId, "ft"),
  ]);
  const totalInclusion = criteriaRow?.criteria.inclusionCriteria.length ?? 0;
  const rollup = computeRollup(checks, totalInclusion);
  const reasons = checks
    .filter((c) => c.confirmed && c.verdict === "exclude")
    .map((c) => c.criterionText);
  const summary =
    rollup === "exclude"
      ? `Fails: ${reasons.join("; ") || "(criterion excluded, not yet confirmed)"}`
      : rollup === "include"
        ? "All inclusion criteria confirmed satisfied."
        : "Not all criteria have been reviewed yet.";

  const id = await getOrCreateRecordId(projectId, itemKey);
  await databaseService.queryAsync(
    `UPDATE screening_records SET ai_decision = ?, ai_reasoning = ? WHERE id = ?`,
    [rollup === "unclear" ? null : rollup, summary, id],
  );
}

/**
 * Runs the AI checklist for one item. Refuses to run unless the user has
 * already confirmed full-text availability (FTS-11 gate), same reasoning
 * as before. Additive like Coding's generateSuggestions: re-running does
 * NOT delete or replace previously-inserted (even unconfirmed) rows --
 * the human sorts out duplicates/superseded suggestions during review.
 */
export async function runCriterionChecks(
  projectId: number,
  item: Zotero.Item,
): Promise<CriterionCheck[]> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error("No AI provider configured.");
  }
  const criteriaRow = await getLatestCriteria(projectId, "ft");
  if (!criteriaRow) {
    throw new Error("No screening criteria configured for this project.");
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

  const raw = await callChatCompletion(
    provider,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(criteriaRow.criteria, fullText) },
    ],
    "ft_screening",
  );
  const rawChecks = parseCriterionChecks(raw);

  let attachment: Zotero.Item | null = null;
  try {
    const best = await item.getBestAttachment();
    if (best && best.isPDFAttachment()) attachment = best;
  } catch {
    // fall through -- attachment stays null, no auto-placement attempted
  }

  await databaseService.init();
  const now = new Date().toISOString();
  const inserted: CriterionCheck[] = [];
  const seen = new Set<string>();

  for (const rc of rawChecks) {
    const list =
      rc.criterionType === "inclusion"
        ? criteriaRow.criteria.inclusionCriteria
        : criteriaRow.criteria.exclusionCriteria;
    const criterionText = list[rc.criterionIndex];
    if (!criterionText) continue; // AI hallucinated an out-of-range index
    // Design rule: an exclusion criterion only ever produces an exclude
    // row -- a malformed "include" verdict for one is dropped rather than
    // trusted.
    if (rc.criterionType === "exclusion" && rc.verdict !== "exclude") {
      continue;
    }
    const dedupeKey = `${rc.criterionType}:${rc.criterionIndex}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let pendingPosition: string | null = null;
    if (attachment && rc.quote) {
      try {
        const located = await locateQuoteInAttachment(attachment, rc.quote);
        if (located) pendingPosition = JSON.stringify(located);
      } catch (e) {
        ztoolkit.log(
          "FT criterion check auto-locate failed",
          item.key,
          rc.criterionType,
          rc.criterionIndex,
          e,
        );
      }
    }

    await databaseService.queryAsync(
      `INSERT INTO ft_criterion_checks
         (project_id, item_key, criterion_type, criterion_text, verdict, reasoning, quote, pending_position, source, confirmed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', 0, ?, ?)`,
      [
        projectId,
        item.key,
        rc.criterionType,
        criterionText,
        rc.verdict,
        rc.reasoning,
        rc.quote || null,
        pendingPosition,
        now,
        now,
      ],
    );
    const id = await databaseService.getLastInsertId();
    inserted.push({
      id,
      criterionType: rc.criterionType,
      criterionText,
      verdict: rc.verdict,
      reasoning: rc.reasoning,
      quote: rc.quote || null,
      annotationKey: null,
      pendingPosition,
      source: "ai",
      confirmed: false,
    });
  }

  await refreshAggregate(projectId, item.key);
  return inserted;
}

/**
 * Primary "confirm this check" action (mirrors codingService.ts's
 * confirmRecord): if the row has a pending auto-located highlight and no
 * real annotation yet, this is the moment it gets materialized -- the
 * human reviewing/accepting the check IS the confirmation, so the PDF only
 * gains a highlight once a human has actually looked at it.
 */
export async function confirmCheck(
  checkId: number,
  item: Zotero.Item,
  projectId: number,
): Promise<void> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT annotation_key, pending_position, quote, criterion_text FROM ft_criterion_checks WHERE id = ?`,
    [checkId],
  )) as
    | {
        annotation_key: string | null;
        pending_position: string | null;
        quote: string | null;
        criterion_text: string;
      }[]
    | undefined;
  const row = rows?.[0];
  if (!row) return;

  if (!row.annotation_key && row.pending_position) {
    try {
      const attachment = await item.getBestAttachment();
      if (attachment && attachment.isPDFAttachment()) {
        const annotationKey = await materializePendingHighlight(
          attachment,
          row.pending_position,
          FT_SCREENING_ANNOTATION_COLOR,
          row.quote || row.criterion_text,
        );
        await databaseService.queryAsync(
          `UPDATE ft_criterion_checks
           SET annotation_key = ?, pending_position = NULL, confirmed = 1, updated_at = ?
           WHERE id = ?`,
          [annotationKey, new Date().toISOString(), checkId],
        );
        await refreshAggregate(projectId, item.key);
        return;
      }
    } catch (e) {
      ztoolkit.log(
        "FT criterion check materialize highlight failed",
        item.key,
        checkId,
        e,
      );
    }
  }

  await databaseService.queryAsync(
    `UPDATE ft_criterion_checks SET confirmed = 1, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), checkId],
  );
  await refreshAggregate(projectId, item.key);
}

/** Reverses confirmCheck -- same "unconfirm doesn't touch the real
 * annotation" precedent as codingService.ts's unconfirmRecord. */
export async function unconfirmCheck(
  checkId: number,
  projectId: number,
  itemKey: string,
): Promise<void> {
  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE ft_criterion_checks SET confirmed = 0, updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), checkId],
  );
  await refreshAggregate(projectId, itemKey);
}

/** Human overrides a check's verdict/reasoning (e.g. disagrees with the
 * AI's read of a criterion) -- marks the row source='human' but leaves
 * confirmed state as-is; the reviewer still confirms it separately. */
export async function updateCheck(
  checkId: number,
  verdict: CriterionVerdict,
  reasoning: string | null,
  projectId: number,
  itemKey: string,
): Promise<void> {
  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE ft_criterion_checks SET verdict = ?, reasoning = ?, source = 'human', updated_at = ? WHERE id = ?`,
    [verdict, reasoning, new Date().toISOString(), checkId],
  );
  await refreshAggregate(projectId, itemKey);
}

/** Human-added check for a criterion the AI missed or got wrong from
 * scratch -- mirrors codingService.ts's addManualRecord: source='human',
 * confirmed immediately (a human typing it in IS the confirmation). */
export async function addManualCheck(
  projectId: number,
  item: Zotero.Item,
  criterionType: CriterionType,
  criterionText: string,
  verdict: CriterionVerdict,
  annotationKey: string | null,
): Promise<number> {
  await databaseService.init();
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `INSERT INTO ft_criterion_checks
       (project_id, item_key, criterion_type, criterion_text, verdict, annotation_key, source, confirmed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'human', 1, ?, ?)`,
    [
      projectId,
      item.key,
      criterionType,
      criterionText,
      verdict,
      annotationKey,
      now,
      now,
    ],
  );
  const id = await databaseService.getLastInsertId();
  await refreshAggregate(projectId, item.key);
  return id;
}

/**
 * Claims an existing human-made highlight in the PDF as evidence for one
 * check -- the manual fallback when auto-locate misses, mirrors
 * codingService.ts's linkAnnotationToRecord. Forces the fixed FT-Screening
 * color so it stays visually distinguishable from Coding's highlights on
 * the same PDF (REQUIREMENTS 2.4.5).
 */
export async function linkAnnotationToCheck(
  checkId: number,
  libraryID: number,
  annotationKey: string,
  projectId: number,
  itemKey: string,
): Promise<void> {
  const annotation = Zotero.Items.getByLibraryAndKey(libraryID, annotationKey);
  if (annotation) {
    (annotation as any).annotationColor = FT_SCREENING_ANNOTATION_COLOR;
    await (annotation as Zotero.Item).saveTx();
  }
  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE ft_criterion_checks SET annotation_key = ?, confirmed = 1, updated_at = ? WHERE id = ?`,
    [annotationKey, new Date().toISOString(), checkId],
  );
  await refreshAggregate(projectId, itemKey);
}

export async function deleteCheck(
  checkId: number,
  projectId: number,
  itemKey: string,
): Promise<void> {
  await databaseService.init();
  await databaseService.queryAsync(
    `DELETE FROM ft_criterion_checks WHERE id = ?`,
    [checkId],
  );
  await refreshAggregate(projectId, itemKey);
}
