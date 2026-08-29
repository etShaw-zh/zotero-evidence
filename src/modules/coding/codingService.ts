import { callChatCompletion } from "../ai/aiClient";
import { getActiveProvider } from "../ai/providerConfig";
import { CODING_ANNOTATION_COLOR } from "../../utils/annotationColors";
import {
  locateQuoteInAttachment,
  materializePendingHighlight,
} from "../pdf/pdfAnnotationCreator";
import { databaseService } from "../db/database";
import { sanitizeDbText } from "../../utils/sanitize";
import { getAttachmentFullText } from "../screening/ftScreeningService";
import { CodebookVariable, getLatestCodebook } from "./codebookService";

/**
 * Forces a linked annotation to the fixed default Coding color (REQUIREMENTS
 * 2.4.5) so it stays visually distinguishable from FT-Screening's orange.
 * Silently no-ops if the key doesn't resolve to a real item -- callers
 * always pass a key drawn from the current PDF's real annotation list, so
 * that's not expected, but this isn't the place to throw over it.
 */
async function colorizeCodingAnnotation(annotationKey: string): Promise<void> {
  const annotation = Zotero.Items.getByLibraryAndKey(
    Zotero.Libraries.userLibraryID,
    annotationKey,
  );
  if (!annotation) return;
  (annotation as any).annotationColor = CODING_ANNOTATION_COLOR;
  await (annotation as Zotero.Item).saveTx();
}

export interface CodingRecord {
  id: number;
  variableName: string;
  variableValue: string;
  quote: string | null;
  annotationKey: string | null;
  /** JSON `LocatedQuote` from a successful auto-locate that hasn't been
   * confirmed into a real annotation yet (COD-04) -- see confirmRecord. */
  pendingPosition: string | null;
  source: "ai" | "human" | null;
  confirmed: boolean;
}

// Same cap used in ftScreeningService.ts for the same reason: real PDFs can
// run to tens of thousands of characters, and sending the whole thing
// uncapped risks blowing token/cost limits.
const MAX_FULLTEXT_CHARS = 40000;

const SYSTEM_PROMPT =
  "You are assisting with full-text coding for a systematic literature review. " +
  "Given a Codebook (a list of variables to extract, with their type, allowed values, " +
  "and extraction hints) and the full text of a paper (which may be truncated if very long), " +
  "identify the relevant value for each variable and the exact quote from the text that supports it. " +
  "The quote is used to automatically locate and highlight that passage in the PDF, so it MUST be " +
  "copied verbatim, character-for-character, from the provided text -- do not paraphrase, summarize, " +
  "translate curly quotes/dashes to plain ones, fix typos, or add an ellipsis for a shortened quote. " +
  "Prefer a short quote (one clause or sentence) that is still copied exactly over a longer paraphrase. " +
  "The `variable` field must be copied verbatim from the Codebook variable's own name given below, " +
  "not a shortened or reworded version of it. " +
  "A variable marked as allowing multiple values may appear more than once with different quotes. " +
  "Skip a variable entirely if the text doesn't clearly support a value for it -- do not guess. " +
  "Respond with ONLY a JSON array, no markdown and no extra text: " +
  '[{"variable": "variable_name", "value": "extracted value", "quote": "exact supporting quote from the text"}, ...].';

function describeVariable(v: CodebookVariable): string {
  const parts = [
    `- ${v.name} (${v.type}${v.multiple ? ", multiple" : ""}${v.required ? ", required" : ""})`,
  ];
  if (v.values?.length) parts.push(`  allowed values: ${v.values.join(", ")}`);
  if (v.extractionHint) parts.push(`  hint: ${v.extractionHint}`);
  if (v.notes) parts.push(`  notes: ${v.notes}`);
  return parts.join("\n");
}

function buildPrompt(variables: CodebookVariable[], fullText: string): string {
  const truncated = fullText.length > MAX_FULLTEXT_CHARS;
  const text = truncated ? fullText.slice(0, MAX_FULLTEXT_CHARS) : fullText;
  return [
    `Codebook variables:\n${variables.map(describeVariable).join("\n")}`,
    `Full text${truncated ? " (truncated)" : ""}:\n${text}`,
  ].join("\n\n");
}

interface RawSuggestion {
  variable: string;
  value: string;
  quote: string;
}

/**
 * An unparseable response yields an empty array rather than throwing --
 * the caller surfaces "AI returned nothing usable" and simply writes no
 * suggestion rows, consistent with the fault-tolerance principle
 * established in taScreeningService/ftScreeningService.
 */
export function parseSuggestions(raw: string): RawSuggestion[] {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : text;
  try {
    const obj = JSON.parse(jsonText);
    if (!Array.isArray(obj)) return [];
    return obj
      .filter(
        (item): item is RawSuggestion =>
          item &&
          typeof item.variable === "string" &&
          typeof item.value === "string",
      )
      .map((item) => ({
        variable: sanitizeDbText(item.variable),
        value: sanitizeDbText(item.value),
        quote: typeof item.quote === "string" ? sanitizeDbText(item.quote) : "",
      }));
  } catch {
    return [];
  }
}

export interface GenerateSuggestionsResult {
  count: number;
  codebookId: number;
}

export async function generateSuggestions(
  projectId: number,
  item: Zotero.Item,
  isPilot = false,
): Promise<GenerateSuggestionsResult> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error("No AI provider configured.");
  }
  const codebookRow = await getLatestCodebook(projectId);
  if (!codebookRow || codebookRow.variables.length === 0) {
    throw new Error("No Codebook configured for this project.");
  }
  const fullText = await getAttachmentFullText(item);
  if (!fullText) {
    throw new Error("Could not read full text from the PDF attachment.");
  }

  const raw = await callChatCompletion(provider, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildPrompt(codebookRow.variables, fullText) },
  ]);
  const suggestions = parseSuggestions(raw);

  // Best-effort (COD-04): try to locate each suggestion's quote in the PDF.
  // This only records WHERE the evidence is (pending_position) -- it does
  // NOT create a real annotation yet, so nothing shows up on the PDF for a
  // suggestion nobody has reviewed. The highlight only gets materialized
  // once the human actually confirms that record (see confirmRecord). One
  // attachment lookup shared across all suggestions for this item. A miss
  // or extraction failure just leaves pending_position unset for that row --
  // the existing manual "choose a highlight, link" UI is still the
  // fallback, so this must never throw out of generateSuggestions.
  let attachment: Zotero.Item | null = null;
  try {
    const best = await item.getBestAttachment();
    if (best && best.isPDFAttachment()) attachment = best;
  } catch {
    // fall through -- attachment stays null, no auto-placement attempted
  }

  await databaseService.init();
  const now = new Date().toISOString();
  for (const s of suggestions) {
    let pendingPosition: string | null = null;
    if (attachment && s.quote) {
      try {
        const located = await locateQuoteInAttachment(attachment, s.quote);
        if (located) pendingPosition = JSON.stringify(located);
      } catch (e) {
        ztoolkit.log("Coding auto-locate failed", item.key, s.variable, e);
      }
    }
    await databaseService.queryAsync(
      `INSERT INTO coding_records
         (project_id, codebook_id, item_key, pending_position, variable_name, variable_value, quote, is_pilot, source, confirmed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', 0, ?, ?)`,
      [
        projectId,
        codebookRow.id,
        item.key,
        pendingPosition,
        s.variable,
        s.value,
        s.quote,
        isPilot ? 1 : 0,
        now,
        now,
      ],
    );
  }

  return { count: suggestions.length, codebookId: codebookRow.id };
}

function rowToRecord(row: any): CodingRecord {
  return {
    id: row.id,
    variableName: row.variable_name,
    variableValue: row.variable_value,
    quote: row.quote,
    annotationKey: row.annotation_key,
    pendingPosition: row.pending_position,
    source: row.source,
    confirmed: !!row.confirmed,
  };
}

export async function getCodingRecords(
  projectId: number,
  itemKey: string,
): Promise<CodingRecord[]> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT id, variable_name, variable_value, quote, annotation_key, pending_position, source, confirmed
     FROM coding_records
     WHERE project_id = ? AND item_key = ? AND is_pilot = 0
     ORDER BY id ASC`,
    [projectId, itemKey],
  )) as any[] | undefined;
  return (rows || []).map(rowToRecord);
}

/**
 * Links a suggestion (or manual entry) to a real Zotero annotation the user
 * created natively in the PDF reader, and marks it confirmed -- the act of
 * pointing at a real highlight IS the confirmation in this workflow.
 */
export async function linkAnnotationToRecord(
  recordId: number,
  annotationKey: string,
): Promise<void> {
  await colorizeCodingAnnotation(annotationKey);
  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE coding_records SET annotation_key = ?, confirmed = 1, updated_at = ? WHERE id = ?`,
    [annotationKey, new Date().toISOString(), recordId],
  );
}

export async function addManualRecord(
  projectId: number,
  item: Zotero.Item,
  codebookId: number,
  variableName: string,
  variableValue: string,
  annotationKey: string | null,
  quote: string | null,
  isPilot = false,
): Promise<number> {
  if (annotationKey) await colorizeCodingAnnotation(annotationKey);
  await databaseService.init();
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `INSERT INTO coding_records
       (project_id, codebook_id, item_key, annotation_key, variable_name, variable_value, quote, is_pilot, source, confirmed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human', 1, ?, ?)`,
    [
      projectId,
      codebookId,
      item.key,
      annotationKey,
      variableName,
      variableValue,
      quote,
      isPilot ? 1 : 0,
      now,
      now,
    ],
  );
  return databaseService.getLastInsertId();
}

export async function updateRecord(
  recordId: number,
  variableName: string,
  variableValue: string,
): Promise<void> {
  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE coding_records SET variable_name = ?, variable_value = ?, updated_at = ? WHERE id = ?`,
    [variableName, variableValue, new Date().toISOString(), recordId],
  );
}

/**
 * Primary "confirm this record" action for the UI's edit-save button
 * (COD-04). If the record has a pending auto-located highlight and no real
 * annotation yet, this is the moment it gets materialized -- the human
 * reviewing/accepting the value IS the confirmation, so the PDF only gains
 * a highlight once a human has actually looked at it. If there's no
 * pending position (auto-locate missed), behavior is unchanged from plain
 * updateRecord: the value is saved but confirmed is NOT forced to 1 -- the
 * record still needs the manual "choose a highlight, link" path to be
 * confirmed, same as today.
 */
export async function confirmRecord(
  recordId: number,
  item: Zotero.Item,
  variableName: string,
  variableValue: string,
): Promise<void> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT annotation_key, pending_position FROM coding_records WHERE id = ?`,
    [recordId],
  )) as { annotation_key: string | null; pending_position: string | null }[];
  const row = rows?.[0];

  if (row && !row.annotation_key && row.pending_position) {
    try {
      const attachment = await item.getBestAttachment();
      if (attachment && attachment.isPDFAttachment()) {
        const annotationKey = await materializePendingHighlight(
          attachment,
          row.pending_position,
          CODING_ANNOTATION_COLOR,
          variableValue,
        );
        await databaseService.queryAsync(
          `UPDATE coding_records
           SET annotation_key = ?, pending_position = NULL, variable_name = ?, variable_value = ?,
               confirmed = 1, source = 'human', updated_at = ?
           WHERE id = ?`,
          [
            annotationKey,
            variableName,
            variableValue,
            new Date().toISOString(),
            recordId,
          ],
        );
        return;
      }
    } catch (e) {
      ztoolkit.log("Coding materialize highlight failed", item.key, e);
    }
  }

  await updateRecord(recordId, variableName, variableValue);
}

export async function deleteRecord(recordId: number): Promise<void> {
  await databaseService.init();
  await databaseService.queryAsync(`DELETE FROM coding_records WHERE id = ?`, [
    recordId,
  ]);
}

export interface CodingProgress {
  requiredTotal: number;
  requiredDone: number;
}

// Case/whitespace-insensitive: a confirmed record's variable_name is
// whatever the AI (or a human) actually typed/echoed back, which isn't
// guaranteed to be byte-for-byte identical to the Codebook's own casing/
// spacing for that variable -- an exact-match comparison here would leave
// a genuinely-confirmed required variable stuck showing as unconfirmed
// forever over something as trivial as a trailing space.
export function normalizeVariableName(name: string): string {
  return name.trim().toLowerCase();
}

// Codebook variables are often labeled "<short code> — <long description>"
// (e.g. "B01 / QA1 — Design rationale & conjecturing"). The AI reliably
// echoes back only the short-code lead-in when asked to name the variable
// it extracted a value for -- observed in practice as "B01 / QA1" for the
// example above -- so an exact/normalized match against the full label
// alone leaves those (genuinely confirmed) records unmatched. This pulls
// out that lead-in as a fallback alias to match against.
function variableNameAlias(name: string): string | null {
  const m = name.match(/^(.*?)\s+[—–-]\s+/);
  return m ? m[1] : null;
}

/**
 * Resolves a coding record's raw variable_name (whatever the AI/human
 * actually typed) to the Codebook's own canonical name for that variable,
 * matching case/whitespace-insensitively on the full name first and,
 * failing that, on the "<code> — <description>" lead-in alias. Falls back
 * to the raw name unchanged if nothing in the Codebook matches (e.g. a
 * stale/renamed variable), same as before this resolution existed.
 */
export function resolveCanonicalVariableName(
  recordVariableName: string,
  codebookVariableNames: string[],
): string {
  const normalizedRecord = normalizeVariableName(recordVariableName);
  for (const name of codebookVariableNames) {
    if (normalizeVariableName(name) === normalizedRecord) return name;
  }
  for (const name of codebookVariableNames) {
    const alias = variableNameAlias(name);
    if (alias && normalizeVariableName(alias) === normalizedRecord) {
      return name;
    }
  }
  return recordVariableName;
}

export async function getCodingProgress(
  projectId: number,
  itemKey: string,
  variables: CodebookVariable[],
): Promise<CodingProgress> {
  const requiredNames = variables.filter((v) => v.required).map((v) => v.name);
  if (requiredNames.length === 0) {
    return { requiredTotal: 0, requiredDone: 0 };
  }
  const codebookNames = variables.map((v) => v.name);
  const records = await getCodingRecords(projectId, itemKey);
  const confirmedNames = new Set(
    records
      .filter((r) => r.confirmed)
      .map((r) =>
        normalizeVariableName(
          resolveCanonicalVariableName(r.variableName, codebookNames),
        ),
      ),
  );
  const requiredDone = requiredNames.filter((n) =>
    confirmedNames.has(normalizeVariableName(n)),
  ).length;
  return { requiredTotal: requiredNames.length, requiredDone };
}
