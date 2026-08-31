import { toCsvLine } from "../../utils/csv";
import { safeGetField } from "../../utils/zoteroItem";
import { databaseService } from "../db/database";
import { getProjectById } from "../project/projectManager";

/**
 * One row per confirmed coding record project-wide (not scoped to a single
 * variable, unlike the Synthesis dialog itself), with whatever theme it's
 * been assigned via synthesis_themes -- empty for a variable Synthesis
 * hasn't been run on yet, same as the dialog's own table shows before a
 * run. Mirrors exportCodingData/exportScreeningLog's item-resolution and
 * CSV-shape conventions.
 */
export async function exportSynthesisData(projectId: number): Promise<string> {
  await databaseService.init();
  const project = await getProjectById(projectId);
  const libraryID = project?.libraryID ?? Zotero.Libraries.userLibraryID;
  const rows = (await databaseService.queryAsync(
    `SELECT cr.item_key, cr.variable_name, cr.variable_value, cr.quote, st.theme
     FROM coding_records cr
     LEFT JOIN synthesis_themes st ON st.coding_record_id = cr.id
     WHERE cr.project_id = ? AND cr.confirmed = 1 AND cr.is_pilot = 0
     ORDER BY cr.variable_name, cr.item_key, cr.id`,
    [projectId],
  )) as
    | {
        item_key: string;
        variable_name: string;
        variable_value: string;
        quote: string | null;
        theme: string | null;
      }[]
    | undefined;

  const lines: string[] = [];
  lines.push(
    toCsvLine([
      "item_key",
      "title",
      "variable_name",
      "variable_value",
      "quote",
      "theme",
    ]),
  );

  for (const r of rows || []) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, r.item_key) as
      | Zotero.Item
      | false;
    const title = item ? safeGetField(item, "title") : "";
    lines.push(
      toCsvLine([
        r.item_key,
        title,
        r.variable_name,
        r.variable_value,
        r.quote || "",
        r.theme || "",
      ]),
    );
  }

  return lines.join("\n");
}
