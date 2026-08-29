import { databaseService } from "../db/database";
import { resolveProjectCollections } from "../project/collectionStructure";
import { getRootCollectionId } from "../project/projectContext";
import { getProjectById } from "../project/projectManager";
import { getLatestCodebook } from "./codebookService";
import {
  CodingRecord,
  confirmRecord as coreConfirmRecord,
  linkAnnotationToRecord as coreLinkAnnotationToRecord,
} from "./codingService";
import { cohenKappa, weightedCohenKappa } from "./kappa";

export interface PilotRound {
  id: number;
  projectId: number;
  codebookId: number;
  roundNumber: number;
  sampleItemKeys: string[];
  status: "in_progress" | "completed";
}

function rowToPilotRound(row: any): PilotRound {
  return {
    id: row.id,
    projectId: row.project_id,
    codebookId: row.codebook_id,
    roundNumber: row.round_number,
    sampleItemKeys: JSON.parse(row.sample_item_keys || "[]"),
    status: row.status,
  };
}

/**
 * Fisher-Yates-based random sample, capped at the available pool size.
 * Pure/testable in isolation from Zotero.
 */
export function sampleRandom<T>(items: T[], n: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, Math.min(n, pool.length)));
}

export async function getActivePilotRound(
  projectId: number,
): Promise<PilotRound | null> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT * FROM pilot_rounds
     WHERE project_id = ? AND status = 'in_progress'
     ORDER BY round_number DESC LIMIT 1`,
    [projectId],
  )) as any[] | undefined;
  const row = rows?.[0];
  return row ? rowToPilotRound(row) : null;
}

/**
 * Random sample of `sampleSize` items from the project's FT-Include
 * collection (uncapped across rounds -- re-sampling the same item in a
 * later round is fine, calibration rounds often intentionally overlap).
 * Refuses to start a second round while one is still in_progress (the
 * pilot workflow in REQUIREMENTS.md 2.5.5 is a single active loop at a
 * time), and refuses to start without a configured Codebook.
 */
export async function startPilotRound(
  projectId: number,
  sampleSize: number,
): Promise<PilotRound> {
  const active = await getActivePilotRound(projectId);
  if (active) {
    throw new Error(
      "A pilot round is already in progress for this project. Complete it before starting a new one.",
    );
  }
  const codebookRow = await getLatestCodebook(projectId);
  if (!codebookRow || codebookRow.variables.length === 0) {
    throw new Error("No Codebook configured for this project.");
  }

  const project = await getProjectById(projectId);
  if (!project) throw new Error("Project not found.");
  const rootId = getRootCollectionId(project);
  if (rootId === null) throw new Error("Project collection not found.");
  const collections = resolveProjectCollections(rootId);
  const ftInclude = Zotero.Collections.get(
    collections.ftIncludeId,
  ) as Zotero.Collection;
  const pool = ftInclude.getChildItems().map((item) => item.key);
  const sampleItemKeys = sampleRandom(pool, sampleSize);

  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT MAX(round_number) as maxRound FROM pilot_rounds WHERE project_id = ?`,
    [projectId],
  )) as { maxRound: number | null }[] | undefined;
  const roundNumber = (rows?.[0]?.maxRound ?? 0) + 1;

  const now = new Date().toISOString();
  await databaseService.queryAsync(
    `INSERT INTO pilot_rounds (project_id, codebook_id, round_number, sample_item_keys, status, created_at)
     VALUES (?, ?, ?, ?, 'in_progress', ?)`,
    [
      projectId,
      codebookRow.id,
      roundNumber,
      JSON.stringify(sampleItemKeys),
      now,
    ],
  );
  const id = await databaseService.getLastInsertId();

  return {
    id,
    projectId,
    codebookId: codebookRow.id,
    roundNumber,
    sampleItemKeys,
    status: "in_progress",
  };
}

export async function getPilotRoundForItem(
  projectId: number,
  itemKey: string,
): Promise<PilotRound | null> {
  const active = await getActivePilotRound(projectId);
  if (!active) return null;
  return active.sampleItemKeys.includes(itemKey) ? active : null;
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

/** Same shape as codingService.getCodingRecords but for is_pilot=1 rows. */
export async function getPilotRecords(
  projectId: number,
  itemKey: string,
): Promise<CodingRecord[]> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT id, variable_name, variable_value, quote, annotation_key, pending_position, source, confirmed
     FROM coding_records
     WHERE project_id = ? AND item_key = ? AND is_pilot = 1
     ORDER BY id ASC`,
    [projectId, itemKey],
  )) as any[] | undefined;
  return (rows || []).map(rowToRecord);
}

/**
 * Captures the AI-vs-human comparison for one variable on one item, but
 * only the FIRST time it's reviewed within a pilot round -- repeatedly
 * editing the same variable shouldn't dilute the agreement signal with the
 * human's own back-and-forth.
 */
async function recordPilotReviewOnce(
  pilotRoundId: number,
  itemKey: string,
  variableName: string,
  aiValue: string,
  humanValue: string,
): Promise<void> {
  await databaseService.init();
  const existing = (await databaseService.queryAsync(
    `SELECT id FROM consistency_records
     WHERE pilot_round_id = ? AND item_key = ? AND variable_name = ? LIMIT 1`,
    [pilotRoundId, itemKey, variableName],
  )) as any[] | undefined;
  if (existing && existing.length > 0) return;

  const isMatch =
    aiValue.trim().toLowerCase() === humanValue.trim().toLowerCase();
  await databaseService.queryAsync(
    `INSERT INTO consistency_records (pilot_round_id, item_key, variable_name, ai_value, human_value, is_match, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      pilotRoundId,
      itemKey,
      variableName,
      aiValue,
      humanValue,
      isMatch ? 1 : 0,
      new Date().toISOString(),
    ],
  );
}

/**
 * Pilot review: accept an AI suggestion as-is by linking it to a real
 * annotation. Captures ai_value === human_value (an accepted suggestion is
 * agreement by definition) before delegating to the normal linking path.
 */
export async function reviewPilotLink(
  pilotRoundId: number,
  itemKey: string,
  record: CodingRecord,
  annotationKey: string,
): Promise<void> {
  await recordPilotReviewOnce(
    pilotRoundId,
    itemKey,
    record.variableName,
    record.variableValue,
    record.variableValue,
  );
  await coreLinkAnnotationToRecord(record.id, annotationKey);
}

/**
 * Pilot review: the human corrects an AI suggestion's variable/value.
 * Captures the record's value AS IT WAS BEFORE this edit (the AI's
 * original suggestion, still held in `record` from the render pass) versus
 * the corrected value, then delegates to the normal update path and marks
 * the record confirmed/human-attributed now that it's been reviewed.
 */
export async function reviewPilotEdit(
  pilotRoundId: number,
  itemKey: string,
  item: Zotero.Item,
  record: CodingRecord,
  newVariableName: string,
  newValue: string,
): Promise<void> {
  await recordPilotReviewOnce(
    pilotRoundId,
    itemKey,
    record.variableName,
    record.variableValue,
    newValue,
  );
  // confirmRecord materializes a pending auto-located highlight (COD-04) if
  // one exists; either way it also updates the value, so the separate
  // confirmed=1 write below just makes sure pilot review always counts as
  // confirmation even when there was no pending highlight to materialize.
  await coreConfirmRecord(record.id, item, newVariableName, newValue);
  await databaseService.init();
  await databaseService.queryAsync(
    `UPDATE coding_records SET confirmed = 1, source = 'human', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), record.id],
  );
}

export interface ConsistencySummaryRow {
  variableName: string;
  metric: "cohen_kappa" | "weighted_cohen_kappa";
  kappaValue: number | null;
  nItems: number;
}

/**
 * Computes per-variable Kappa (categorical/text -> unweighted, numeric ->
 * quadratic-weighted, per REQUIREMENTS.md PIL-03), persists it to
 * consistency_summary, and marks the round completed. Purely advisory --
 * nothing here blocks or auto-decides anything (PIL-07); the result is
 * just handed back for the UI to display.
 */
export async function completePilotRound(
  pilotRoundId: number,
): Promise<ConsistencySummaryRow[]> {
  await databaseService.init();
  const roundRows = (await databaseService.queryAsync(
    `SELECT * FROM pilot_rounds WHERE id = ?`,
    [pilotRoundId],
  )) as any[] | undefined;
  const roundRow = roundRows?.[0];
  if (!roundRow) throw new Error("Pilot round not found.");
  const round = rowToPilotRound(roundRow);

  const codebookRows = (await databaseService.queryAsync(
    `SELECT variables FROM codebooks WHERE id = ?`,
    [round.codebookId],
  )) as { variables: string }[] | undefined;
  const variables = codebookRows?.[0]
    ? JSON.parse(codebookRows[0].variables)
    : [];
  const typeByName = new Map<string, string>(
    variables.map((v: any) => [v.name, v.type]),
  );

  const comparisonRows = (await databaseService.queryAsync(
    `SELECT variable_name, ai_value, human_value FROM consistency_records WHERE pilot_round_id = ?`,
    [pilotRoundId],
  )) as
    | { variable_name: string; ai_value: string; human_value: string }[]
    | undefined;

  const byVariable = new Map<string, { ai: string; human: string }[]>();
  for (const row of comparisonRows || []) {
    const list = byVariable.get(row.variable_name) ?? [];
    list.push({ ai: row.ai_value, human: row.human_value });
    byVariable.set(row.variable_name, list);
  }

  const summary: ConsistencySummaryRow[] = [];
  const now = new Date().toISOString();
  for (const [variableName, pairs] of byVariable) {
    const type = typeByName.get(variableName) ?? "text";
    let metric: ConsistencySummaryRow["metric"];
    let kappaValue: number | null;
    if (type === "numeric") {
      const numericPairs: [number, number][] = pairs
        .map(({ ai, human }) => [Number(ai), Number(human)] as [number, number])
        .filter(([a, h]) => !Number.isNaN(a) && !Number.isNaN(h));
      metric = "weighted_cohen_kappa";
      kappaValue = weightedCohenKappa(numericPairs);
    } else {
      metric = "cohen_kappa";
      kappaValue = cohenKappa(pairs.map(({ ai, human }) => [ai, human]));
    }

    await databaseService.queryAsync(
      `INSERT INTO consistency_summary (pilot_round_id, variable_name, metric, kappa_value, n_items)
       VALUES (?, ?, ?, ?, ?)`,
      [pilotRoundId, variableName, metric, kappaValue, pairs.length],
    );
    summary.push({ variableName, metric, kappaValue, nItems: pairs.length });
  }

  await databaseService.queryAsync(
    `UPDATE pilot_rounds SET status = 'completed', completed_at = ? WHERE id = ?`,
    [now, pilotRoundId],
  );

  return summary;
}
