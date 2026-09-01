import { safeGetField } from "../../utils/zoteroItem";
import { databaseService } from "../db/database";
import { getProjectById } from "../project/projectManager";
import { CategoryKappa, cohenKappa, cohenKappaByCategory } from "./kappa";

export type ScreeningConsistencyStage = "ta_screening" | "ft_screening";

export interface ScreeningDisagreement {
  itemKey: string;
  title: string;
  aiDecision: string;
  humanDecision: string;
}

export interface ScreeningConsistencyStats {
  n: number;
  observedAgreement: number | null;
  kappa: number | null;
  byCategory: CategoryKappa[];
  disagreements: ScreeningDisagreement[];
}

export interface ScreeningConsistencyByModel extends ScreeningConsistencyStats {
  // null groups rows with no recorded AI model -- screening_records written
  // before the ai_model column existed.
  aiModel: string | null;
}

export interface ScreeningConsistencyResult extends ScreeningConsistencyStats {
  // Same stats as above, computed once per distinct ai_model that made a
  // decision at this stage -- lumping different models' decisions into one
  // Kappa would hide a model swap mid-project instead of surfacing it.
  byModel: ScreeningConsistencyByModel[];
}

interface ScreeningRow {
  item_key: string;
  ai_decision: string;
  human_decision: string;
  ai_model: string | null;
}

function buildStats(
  rows: ScreeningRow[],
  libraryID: number,
): ScreeningConsistencyStats {
  const pairs: [string, string][] = rows.map((r) => [
    r.ai_decision,
    r.human_decision,
  ]);

  const disagreements: ScreeningDisagreement[] = [];
  for (const r of rows) {
    if (r.ai_decision === r.human_decision) continue;
    const item = Zotero.Items.getByLibraryAndKey(libraryID, r.item_key);
    disagreements.push({
      itemKey: r.item_key,
      title: item ? safeGetField(item as Zotero.Item, "title") : "",
      aiDecision: r.ai_decision,
      humanDecision: r.human_decision,
    });
  }

  const n = pairs.length;
  const matched = n - disagreements.length;

  return {
    n,
    observedAgreement: n === 0 ? null : matched / n,
    kappa: cohenKappa(pairs),
    byCategory: cohenKappaByCategory(pairs),
    disagreements,
  };
}

/**
 * Compares each screening_records row's ai_decision against the human's
 * final human_decision for one project/stage -- advisory only, same as the
 * rest of this feature: nothing here changes any decision, it's purely for
 * the reviewer to judge how much to trust the AI's suggestions going
 * forward (or which specific category/model to double-check).
 */
export async function getScreeningConsistency(
  projectId: number,
  stage: ScreeningConsistencyStage,
): Promise<ScreeningConsistencyResult> {
  await databaseService.init();
  const project = await getProjectById(projectId);
  const libraryID = project?.libraryID ?? Zotero.Libraries.userLibraryID;

  const rows = ((await databaseService.queryAsync(
    `SELECT item_key, ai_decision, human_decision, ai_model FROM screening_records
     WHERE project_id = ? AND stage = ? AND ai_decision IS NOT NULL AND human_decision IS NOT NULL
     ORDER BY item_key`,
    [projectId, stage],
  )) || []) as ScreeningRow[];

  const rowsByModel = new Map<string | null, ScreeningRow[]>();
  for (const r of rows) {
    const list = rowsByModel.get(r.ai_model) ?? [];
    list.push(r);
    rowsByModel.set(r.ai_model, list);
  }
  // Models with more compared decisions first -- the model actually driving
  // the project matters more than one that only ran on a handful of items.
  const byModel: ScreeningConsistencyByModel[] = Array.from(
    rowsByModel.entries(),
  )
    .sort((a, b) => b[1].length - a[1].length)
    .map(([aiModel, modelRows]) => ({
      aiModel,
      ...buildStats(modelRows, libraryID),
    }));

  return { ...buildStats(rows, libraryID), byModel };
}
