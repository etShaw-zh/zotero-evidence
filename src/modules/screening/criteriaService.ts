import { databaseService } from "../db/database";

export type ScreeningStage = "ta" | "ft";

export interface ScreeningCriteria {
  researchQuestion: string;
  inclusionCriteria: string[];
  exclusionCriteria: string[];
}

export interface ScreeningCriteriaRow {
  id: number;
  version: number;
  criteria: ScreeningCriteria;
}

/**
 * Criteria are versioned (REQUIREMENTS.md data-model review): every save
 * inserts a new row rather than updating in place, so past screening
 * decisions stay traceable to the standard that was in effect at the time.
 */
export async function saveCriteria(
  projectId: number,
  stage: ScreeningStage,
  criteria: ScreeningCriteria,
): Promise<ScreeningCriteriaRow> {
  await databaseService.init();
  const latest = await getLatestCriteria(projectId, stage);
  const version = (latest?.version ?? 0) + 1;
  await databaseService.queryAsync(
    `INSERT INTO screening_criteria (project_id, stage, version, criteria, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      projectId,
      stage,
      version,
      JSON.stringify(criteria),
      new Date().toISOString(),
    ],
  );
  const id = await databaseService.getLastInsertId();
  return { id, version, criteria };
}

export async function getLatestCriteria(
  projectId: number,
  stage: ScreeningStage,
): Promise<ScreeningCriteriaRow | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT id, version, criteria FROM screening_criteria
     WHERE project_id = ? AND stage = ?
     ORDER BY version DESC LIMIT 1`,
    [projectId, stage],
  )) as { id: number; version: number; criteria: string }[];
  const row = rows?.[0];
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    criteria: JSON.parse(row.criteria),
  };
}
