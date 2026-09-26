import { safeGetField } from "../../utils/zoteroItem";
import { databaseService } from "../db/database";
import { getProjectById } from "../project/projectManager";
import { CategoryKappa, cohenKappa, cohenKappaByCategory } from "./kappa";

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

interface ScreeningRow {
  item_key: string;
  ai_decision: string;
  human_decision: string;
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

interface StageDecisionRow {
  item_key: string;
  stage: "ta_screening" | "ft_screening";
  ai_decision: string | null;
  human_decision: string | null;
}

/**
 * One side's (AI's or the human's) overall final verdict for one item,
 * derived from its own TA and (if it got that far) FT decision -- same
 * collapsing rule as humanConsistencyService.ts's deriveFinalVerdict, and
 * for the same reason: TA's three-way category set (include/exclude/
 * unclear) and FT's (include/exclude/unavailable) aren't the same rating
 * task, so a TA-exclude ends the pipeline right there ("exclude", no FT
 * decision needed or expected), while TA-include/unclear falls through to
 * the FT decision (include -> "include", anything else -> "exclude").
 * Null means not enough information yet -- no TA decision at all, or
 * TA-passed but no FT decision recorded yet -- skipped from n rather than
 * guessed, same convention used everywhere else in this feature.
 */
function deriveVerdict(
  taDecision: string | null | undefined,
  ftDecision: string | null | undefined,
): "include" | "exclude" | null {
  if (!taDecision) return null;
  if (taDecision === "exclude") return "exclude";
  if (!ftDecision) return null;
  return ftDecision === "include" ? "include" : "exclude";
}

/**
 * Compares the AI's and the human's overall FINAL verdict for each item --
 * "did it end up included" -- rather than their TA and FT decisions as two
 * separate stage-wise kappas. An earlier version of this feature reported
 * TA and FT as two independent per-stage Kappas (optionally broken down by
 * ai_model too); both were removed in favor of this single measure, for
 * the same reason the human-human version of this idea
 * (humanConsistencyService.ts) doesn't report per-stage either: TA's
 * three-way category set (include/exclude/unclear) and FT's
 * (include/exclude/unavailable) aren't the same rating task, so pooling
 * them -- or even reporting them side by side as if they answered the same
 * question -- doesn't answer what actually matters for a systematic
 * review: do the AI and the human arrive at the same final included set.
 *
 * Both sides are derived symmetrically from the SAME screening_records
 * rows this project's actual screening already produced
 * (ai_decision/human_decision at each stage), so unlike the human-human
 * version of this idea (which needs two reviewers to independently
 * double-screen a sample), this needs no extra data collection -- it's
 * computable right now from whatever's already been screened. No
 * per-model breakdown: a project that used different models at TA vs FT
 * has no single model to attribute one item's combined final verdict to.
 */
export async function getFinalVerdictConsistency(
  projectId: number,
): Promise<ScreeningConsistencyStats> {
  await databaseService.init();
  const project = await getProjectById(projectId);
  const libraryID = project?.libraryID ?? Zotero.Libraries.userLibraryID;

  const rows = ((await databaseService.queryAsync(
    `SELECT item_key, stage, ai_decision, human_decision FROM screening_records
     WHERE project_id = ? AND (stage = 'ta_screening' OR stage = 'ft_screening')
     ORDER BY item_key, id ASC`,
    [projectId],
  )) || []) as StageDecisionRow[];

  // ORDER BY id ASC + Map overwrite-on-set: the latest row per item/stage
  // wins if a stage was somehow screened more than once for the same item.
  const byItem = new Map<
    string,
    { ta?: StageDecisionRow; ft?: StageDecisionRow }
  >();
  for (const r of rows) {
    const entry = byItem.get(r.item_key) ?? {};
    if (r.stage === "ta_screening") entry.ta = r;
    else entry.ft = r;
    byItem.set(r.item_key, entry);
  }

  const verdictRows: ScreeningRow[] = [];
  for (const [itemKey, entry] of byItem) {
    const aiVerdict = deriveVerdict(
      entry.ta?.ai_decision,
      entry.ft?.ai_decision,
    );
    const humanVerdict = deriveVerdict(
      entry.ta?.human_decision,
      entry.ft?.human_decision,
    );
    if (aiVerdict && humanVerdict) {
      verdictRows.push({
        item_key: itemKey,
        ai_decision: aiVerdict,
        human_decision: humanVerdict,
      });
    }
  }

  return buildStats(verdictRows, libraryID);
}
