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

export interface ScreeningConsistencyResult {
  n: number;
  observedAgreement: number | null;
  kappa: number | null;
  byCategory: CategoryKappa[];
  disagreements: ScreeningDisagreement[];
}

/**
 * Compares each screening_records row's ai_decision against the human's
 * final human_decision for one project/stage -- advisory only, same as the
 * rest of this feature: nothing here changes any decision, it's purely for
 * the reviewer to judge how much to trust the AI's suggestions going
 * forward (or which specific category to double-check).
 */
export async function getScreeningConsistency(
  projectId: number,
  stage: ScreeningConsistencyStage,
): Promise<ScreeningConsistencyResult> {
  await databaseService.init();
  const project = await getProjectById(projectId);
  const libraryID = project?.libraryID ?? Zotero.Libraries.userLibraryID;

  const rows = (await databaseService.queryAsync(
    `SELECT item_key, ai_decision, human_decision FROM screening_records
     WHERE project_id = ? AND stage = ? AND ai_decision IS NOT NULL AND human_decision IS NOT NULL
     ORDER BY item_key`,
    [projectId, stage],
  )) as
    | { item_key: string; ai_decision: string; human_decision: string }[]
    | undefined;

  const pairs: [string, string][] = (rows || []).map((r) => [
    r.ai_decision,
    r.human_decision,
  ]);

  const disagreements: ScreeningDisagreement[] = [];
  for (const r of rows || []) {
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
