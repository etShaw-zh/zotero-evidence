import { toCsvLine } from "../../utils/csv";
import { safeGetField } from "../../utils/zoteroItem";
import { getLatestCodebook } from "../coding/codebookService";
import {
  getCodingRecords,
  resolveCanonicalVariableName,
} from "../coding/codingService";
import { databaseService } from "../db/database";

/**
 * Core multi-value-row expansion (REQUIREMENTS 2.6.4 / EXP-06): a study
 * exports one row normally, but a variable with more than one confirmed
 * value produces one extra row per extra value, with every other
 * (single-valued) column repeating its first value unchanged. Pure/testable
 * without Zotero.
 */
export function expandRecordsToRows(
  variableNames: string[],
  valuesByVariable: Map<string, string[]>,
): string[][] {
  const rowCount = Math.max(
    1,
    ...variableNames.map((v) => valuesByVariable.get(v)?.length ?? 0),
  );
  const rows: string[][] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push(
      variableNames.map((v) => {
        const values = valuesByVariable.get(v);
        if (!values || values.length === 0) return "";
        return values[i] ?? values[0];
      }),
    );
  }
  return rows;
}

/** EXP-03/04/05/06: wide-format CSV, one column per Codebook variable, in
 * Codebook order, restricted to items with at least one confirmed coding
 * record. */
export async function exportCodingData(projectId: number): Promise<string> {
  const codebook = await getLatestCodebook(projectId);
  const variableNames = (codebook?.variables ?? []).map((v) => v.name);

  await databaseService.init();
  const itemRows = (await databaseService.queryAsync(
    `SELECT DISTINCT item_key FROM coding_records WHERE project_id = ? AND is_pilot = 0`,
    [projectId],
  )) as { item_key: string }[] | undefined;

  const lines: string[] = [];
  lines.push(
    toCsvLine(["item_key", "authors", "year", "title", ...variableNames]),
  );

  for (const { item_key: itemKey } of itemRows || []) {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      itemKey,
    ) as Zotero.Item | false;
    if (!item) continue;

    const authors = item
      .getCreators()
      .map((c) => `${c.lastName}${c.firstName ? ", " + c.firstName : ""}`)
      .join("; ");
    const year = (safeGetField(item, "date").match(/\d{4}/) || [])[0] || "";
    const title = safeGetField(item, "title");

    const records = (await getCodingRecords(projectId, itemKey)).filter(
      (r) => r.confirmed,
    );
    const valuesByVariable = new Map<string, string[]>();
    for (const r of records) {
      const key = resolveCanonicalVariableName(r.variableName, variableNames);
      const list = valuesByVariable.get(key) ?? [];
      list.push(r.variableValue);
      valuesByVariable.set(key, list);
    }
    if (valuesByVariable.size === 0) continue;

    const rows = expandRecordsToRows(variableNames, valuesByVariable);
    for (const row of rows) {
      lines.push(toCsvLine([itemKey, authors, year, title, ...row]));
    }
  }

  return lines.join("\n");
}
