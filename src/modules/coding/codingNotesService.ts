import { sanitizeDbText } from "../../utils/sanitize";
import { databaseService } from "../db/database";

/** The analytic-memo note for one item, or "" if none has been saved. */
export async function getNote(
  projectId: number,
  itemKey: string,
): Promise<string> {
  await databaseService.init();
  const rows = (await databaseService.queryAsync(
    `SELECT note FROM coding_notes WHERE project_id = ? AND item_key = ?`,
    [projectId, itemKey],
  )) as { note: string }[] | undefined;
  return rows?.[0]?.note ?? "";
}

/**
 * Upserts the note (one row per project+item, overwritten in place -- see
 * schema.ts's coding_notes comment for why this doesn't version like
 * coding_records/screening_records do). Saving a blank/whitespace-only
 * note deletes the row instead of storing an empty string, so an item
 * that never had a note and one whose note was cleared read back
 * identically via getNote().
 */
export async function saveNote(
  projectId: number,
  itemKey: string,
  note: string,
): Promise<void> {
  await databaseService.init();
  const trimmed = sanitizeDbText(note).trim();
  const now = new Date().toISOString();
  const rows = (await databaseService.queryAsync(
    `SELECT id FROM coding_notes WHERE project_id = ? AND item_key = ?`,
    [projectId, itemKey],
  )) as { id: number }[] | undefined;
  const existingId = rows?.[0]?.id;

  if (!trimmed) {
    if (existingId) {
      await databaseService.queryAsync(
        `DELETE FROM coding_notes WHERE id = ?`,
        [existingId],
      );
    }
    return;
  }

  if (existingId) {
    await databaseService.queryAsync(
      `UPDATE coding_notes SET note = ?, updated_at = ? WHERE id = ?`,
      [trimmed, now, existingId],
    );
  } else {
    await databaseService.queryAsync(
      `INSERT INTO coding_notes (project_id, item_key, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [projectId, itemKey, trimmed, now, now],
    );
  }
}
