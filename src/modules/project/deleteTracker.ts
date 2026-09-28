/**
 * Exclusivity + progress tracking for deleteProject() -- the same treatment
 * restoreTracker.ts gives importProjectArchive() (issue #11), applied to
 * project deletion: erasing every item in a large project one at a time,
 * then this plugin's own DB rows, can run long enough with no visible
 * change to the pane that a user unsure the UI is still alive could reopen
 * "删除项目…" and kick off a second, fully concurrent delete -- of the same
 * project (racing eraseTx() calls against a DB row that's disappearing
 * underneath them) or a different one (no reason two unrelated deletes
 * should ever need to run at once).
 *
 * Unlike aiRunTracker's runDeduped (same key => reuse the in-flight
 * promise), a second delete attempt here is rejected outright rather than
 * silently folded into the first: the two calls could target different
 * projects, so quietly returning the first call's result for the second
 * would misreport what actually got deleted. The caller
 * (deleteProjectDialog) checks isDeleteInProgress() before even opening its
 * project-picker dialog, so a normal double-click never reaches this
 * rejection in practice -- it's the backstop for anything that races past
 * that check.
 *
 * Only one delete is tracked globally (no per-project keying) -- same
 * reasoning as restoreTracker.ts: deleting is heavy enough, and touches
 * enough shared state (Zotero's Collection/Item tables, this plugin's own
 * SQLite db), that running two at once is never desirable even for two
 * different projects.
 */

export type DeleteStage =
  | "preparing"
  | "erasingItems"
  | "erasingCollections"
  | "cleaningRecords";

export interface DeleteProgress {
  stage: DeleteStage;
  current?: number;
  total?: number;
}

export type DeleteReporter = (
  stage: DeleteStage,
  detail?: { current: number; total: number },
) => void;

export class DeleteInProgressError extends Error {
  constructor() {
    super("A project deletion is already in progress.");
    this.name = "DeleteInProgressError";
  }
}

interface DeleteEntry {
  promise: Promise<unknown>;
  progress: DeleteProgress;
}

let active: DeleteEntry | null = null;

/** Snapshot of the current stage, or null if no delete is running. */
export function getDeleteProgress(): DeleteProgress | null {
  return active?.progress ?? null;
}

export function isDeleteInProgress(): boolean {
  return active !== null;
}

/**
 * Runs `fn` as THE delete, rejecting immediately with
 * DeleteInProgressError if one is already running. `fn` receives a
 * `report` callback to publish its current stage; getDeleteProgress()
 * reflects that until `fn` settles (resolve OR reject), at which point the
 * entry is cleared so the next delete can run.
 */
export function runExclusiveDelete<T>(
  fn: (report: DeleteReporter) => Promise<T>,
): Promise<T> {
  if (active) return Promise.reject(new DeleteInProgressError());

  const entry: DeleteEntry = {
    promise: undefined as any,
    progress: { stage: "preparing" },
  };
  const report: DeleteReporter = (stage, detail) => {
    entry.progress = { stage, ...detail };
  };
  const promise = fn(report).finally(() => {
    active = null;
  });
  entry.promise = promise;
  active = entry;
  return promise;
}
