import { toCsvLine } from "../../utils/csv";
import { databaseService } from "../db/database";

export type CodebookVariableType = "categorical" | "numeric" | "text";

export interface CodebookVariable {
  name: string;
  type: CodebookVariableType;
  values?: string[];
  multiple?: boolean;
  required?: boolean;
  notes?: string;
  extractionHint?: string;
}

export interface CodebookRow {
  id: number;
  version: number;
  variables: CodebookVariable[];
}

/**
 * Codebooks are versioned (same rationale as screening_criteria): every
 * save inserts a new row rather than updating in place, so past coding
 * decisions stay traceable to the variable definitions in effect at the
 * time.
 */
export async function saveCodebook(
  projectId: number,
  variables: CodebookVariable[],
): Promise<CodebookRow> {
  await databaseService.init();
  const latest = await getLatestCodebook(projectId);
  const version = (latest?.version ?? 0) + 1;
  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `INSERT INTO codebooks (project_id, version, variables, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [projectId, version, JSON.stringify(variables), now, now],
  );
  const id = await databaseService.getLastInsertId();
  return { id, version, variables };
}

export async function getLatestCodebook(
  projectId: number,
): Promise<CodebookRow | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT id, version, variables FROM codebooks
     WHERE project_id = ?
     ORDER BY version DESC LIMIT 1`,
    [projectId],
  )) as { id: number; version: number; variables: string }[];
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    variables: JSON.parse(row.variables),
  };
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function toBool(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Parses a Codebook CSV with header row:
 * name,type,values,multiple,required,notes,extraction_hint
 * `values` is a pipe-separated list (e.g. "RCT|Cohort|Case-control").
 * Unknown/blank `type` defaults to "text" rather than rejecting the row --
 * a typo in one column shouldn't block importing the rest of the sheet.
 */
export function parseCodebookCsv(csvText: string): CodebookVariable[] {
  const lines = csvText
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const nameCol = col("name");
  const typeCol = col("type");
  const valuesCol = col("values");
  const multipleCol = col("multiple");
  const requiredCol = col("required");
  const notesCol = col("notes");
  const hintCol = col("extraction_hint");

  const dataLines = nameCol >= 0 ? lines.slice(1) : lines;

  const variables: CodebookVariable[] = [];
  for (const line of dataLines) {
    const fields = splitCsvLine(line);
    const name = (nameCol >= 0 ? fields[nameCol] : fields[0])?.trim();
    if (!name) continue;

    const rawType = (typeCol >= 0 ? fields[typeCol] : fields[1])?.toLowerCase();
    const type: CodebookVariableType =
      rawType === "categorical" || rawType === "numeric" || rawType === "text"
        ? rawType
        : "text";

    const rawValues = valuesCol >= 0 ? fields[valuesCol] : undefined;
    const values = rawValues
      ? rawValues
          .split("|")
          .map((v) => v.trim())
          .filter(Boolean)
      : undefined;

    variables.push({
      name,
      type,
      values: values && values.length > 0 ? values : undefined,
      multiple: multipleCol >= 0 ? toBool(fields[multipleCol]) : false,
      required: requiredCol >= 0 ? toBool(fields[requiredCol]) : false,
      notes: notesCol >= 0 ? fields[notesCol] || undefined : undefined,
      extractionHint: hintCol >= 0 ? fields[hintCol] || undefined : undefined,
    });
  }
  return variables;
}

/**
 * Serializes Codebook variables back to the exact CSV shape
 * parseCodebookCsv above reads (same header, same `|`-joined `values`,
 * same "0"/"1" flags) -- so a codebook that was edited entirely through the
 * Add/Edit Variable dialogs (never imported from a CSV to begin with) can
 * still be exported and handed to another project's Import Codebook, and a
 * codebook that WAS imported round-trips losslessly after edits instead of
 * silently dropping notes/extraction_hint (the two columns those dialogs
 * collect but codebookViewDialog's summary list doesn't show).
 */
export function formatCodebookCsv(variables: CodebookVariable[]): string {
  const lines = [
    "name,type,values,multiple,required,notes,extraction_hint",
    ...variables.map((v) =>
      toCsvLine([
        v.name,
        v.type,
        v.values?.join("|") ?? "",
        v.multiple ? "1" : "0",
        v.required ? "1" : "0",
        v.notes ?? "",
        v.extractionHint ?? "",
      ]),
    ),
  ];
  return lines.join("\n");
}
