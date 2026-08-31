import { callChatCompletion } from "../ai/aiClient";
import { getActiveProvider } from "../ai/providerConfig";
import { databaseService } from "../db/database";
import { sanitizeDbText } from "../../utils/sanitize";
import { safeGetField } from "../../utils/zoteroItem";
import { getLatestCodebook } from "./codebookService";
import {
  normalizeVariableName,
  resolveCanonicalVariableName,
} from "./codingService";

export interface SynthesisRow {
  id: number;
  itemKey: string;
  itemTitle: string;
  variableName: string;
  variableValue: string;
  quote: string | null;
  theme: string | null;
}

function resolveItemTitle(itemKey: string): string {
  try {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      itemKey,
    );
    if (item) {
      const title = safeGetField(item as Zotero.Item, "title");
      if (title) return title;
    }
  } catch {
    // fall through -- unresolved items just show as untitled below
  }
  return "(Untitled)";
}

/**
 * Every confirmed coding_records row for a project, narrowed down to the
 * ones whose variable_name resolves to the given Codebook variable --
 * matching resolveCanonicalVariableName/normalizeVariableName the same way
 * getCodingProgress (codingService.ts) does, since a record's raw
 * variable_name is whatever the AI/human actually typed and isn't
 * guaranteed byte-for-byte identical to the Codebook's own casing/spacing.
 */
export async function getSynthesisRows(
  projectId: number,
  variableName: string,
): Promise<SynthesisRow[]> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT cr.id, cr.item_key, cr.variable_name, cr.variable_value, cr.quote, st.theme
     FROM coding_records cr
     LEFT JOIN synthesis_themes st ON st.coding_record_id = cr.id
     WHERE cr.project_id = ? AND cr.confirmed = 1 AND cr.is_pilot = 0
     ORDER BY cr.id ASC`,
    [projectId],
  )) as
    | {
        id: number;
        item_key: string;
        variable_name: string;
        variable_value: string;
        quote: string | null;
        theme: string | null;
      }[]
    | undefined;

  const codebook = await getLatestCodebook(projectId);
  const codebookNames = codebook?.variables.map((v) => v.name) ?? [];
  const targetNormalized = normalizeVariableName(variableName);

  return (rows || [])
    .filter(
      (r) =>
        normalizeVariableName(
          resolveCanonicalVariableName(r.variable_name, codebookNames),
        ) === targetNormalized,
    )
    .map((r) => ({
      id: r.id,
      itemKey: r.item_key,
      itemTitle: resolveItemTitle(r.item_key),
      variableName: r.variable_name,
      variableValue: r.variable_value,
      quote: r.quote,
      theme: r.theme,
    }));
}

// Same cap used in codingService.ts/ftScreeningService.ts for the same
// reason -- not that this prompt sends full text, but a project could
// realistically accumulate hundreds of coded excerpts for one variable
// across many papers, and sending all of them uncapped risks blowing
// token/cost limits the same way an uncapped full-text would.
const MAX_ROWS_PER_CALL = 300;

const SYSTEM_PROMPT =
  "You are assisting with qualitative thematic synthesis for a systematic literature review. " +
  "You are given a list of coded data points, each extracted from a different paper for the SAME " +
  "codebook variable -- a value and the exact quote it was extracted from. " +
  "Group these into a small number of higher-level THEMES that capture recurring concepts or " +
  "patterns across the data points. Assign EVERY data point to exactly one theme; data points that " +
  "share the same underlying concept must be assigned the EXACT SAME theme label (identical text), " +
  "so a scan of the assigned themes reveals which data points cluster together. Keep theme labels " +
  "short (a few words) and grounded in what the data actually say -- do not invent themes unsupported " +
  "by the given values/quotes. " +
  "Respond with ONLY a JSON array, no markdown and no extra text, exactly one entry per given data " +
  'point, referencing it by its id: [{"id": 123, "theme": "Theme label"}, ...].';

function buildSynthesisPrompt(
  variableName: string,
  rows: SynthesisRow[],
): string {
  const items = rows
    .map(
      (r) =>
        `- id: ${r.id}\n  value: ${r.variableValue}\n  quote: ${r.quote || "(no quote)"}`,
    )
    .join("\n");
  return `Variable: ${variableName}\n\nData points:\n${items}`;
}

/**
 * synthesis_themes has no upsert helper at the DB layer (SQLite's UPSERT
 * syntax availability depends on the bundled SQLite version, so this
 * avoids relying on it) -- one row per coding_records id, checked for
 * existence first the same way ftScreeningService.ts's
 * getOrCreateRecordId does for a comparable one-row-per-parent shape.
 */
async function setTheme(
  codingRecordId: number,
  theme: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = (await databaseService.queryAsync(
    `SELECT id FROM synthesis_themes WHERE coding_record_id = ?`,
    [codingRecordId],
  )) as { id: number }[] | undefined;
  if (existing && existing.length > 0) {
    await databaseService.queryAsync(
      `UPDATE synthesis_themes SET theme = ?, updated_at = ? WHERE coding_record_id = ?`,
      [theme, now, codingRecordId],
    );
  } else {
    await databaseService.queryAsync(
      `INSERT INTO synthesis_themes (coding_record_id, theme, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [codingRecordId, theme, now, now],
    );
  }
}

interface RawTheme {
  id: number;
  theme: string;
}

export function parseThemes(raw: string): RawTheme[] {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : text;
  try {
    const obj = JSON.parse(jsonText);
    if (!Array.isArray(obj)) return [];
    return obj
      .filter(
        (item): item is RawTheme =>
          item && typeof item.id === "number" && typeof item.theme === "string",
      )
      .map((item) => ({ id: item.id, theme: sanitizeDbText(item.theme) }));
  } catch {
    return [];
  }
}

/**
 * Runs AI thematic synthesis over every confirmed coding record for one
 * Codebook variable and persists the result. Always a full regenerate --
 * every row's theme is overwritten (cleared to null if the AI didn't return
 * one for it), never merged with a previous run's themes, since re-running
 * is meant to reflect the current full picture across every paper, not an
 * incremental patch.
 */
export async function runSynthesis(
  projectId: number,
  variableName: string,
): Promise<SynthesisRow[]> {
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error("No AI provider configured.");
  }

  const rows = await getSynthesisRows(projectId, variableName);
  if (rows.length === 0) {
    throw new Error("No confirmed coding records for this variable yet.");
  }
  const capped = rows.slice(0, MAX_ROWS_PER_CALL);

  const raw = await callChatCompletion(provider, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildSynthesisPrompt(variableName, capped) },
  ]);
  const themes = parseThemes(raw);
  const themeById = new Map(themes.map((t) => [t.id, t.theme]));

  // Only rows actually sent to the AI (`capped`) get overwritten -- if the
  // project has more confirmed records for this variable than fit in one
  // call, the rest keep whatever theme they already had rather than being
  // silently cleared just because this run didn't consider them.
  await databaseService.init();
  for (const row of capped) {
    const theme = themeById.get(row.id) ?? null;
    await setTheme(row.id, theme);
    row.theme = theme;
  }

  return rows;
}
