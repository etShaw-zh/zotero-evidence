/**
 * Exclusivity + progress tracking for importProjectArchive() (issue #11):
 * restoring a backup can run long (import every item, re-attach files,
 * re-link screening/coding/consistency rows) with nothing persisted
 * anywhere until it's done, so without this a user who isn't sure the UI
 * is still alive could reopen "从存档恢复项目…" and kick off a second,
 * fully concurrent restore -- two `createProject()` calls racing, or two
 * imports of the same archive producing duplicate projects.
 *
 * Unlike aiRunTracker's runDeduped (same key => reuse the in-flight
 * promise), a second restore attempt here is rejected outright rather than
 * silently folded into the first: the two calls could target different
 * archive files or libraries, so quietly returning the first call's result
 * for the second would misreport what actually got restored. The caller
 * (restoreArchiveDialog) checks isRestoreInProgress() before even opening
 * the file-picker dialog, so a normal double-click never reaches this
 * rejection in practice -- it's the backstop for anything that races past
 * that check.
 *
 * Only one restore is tracked globally (no per-file/per-library keying,
 * unlike aiRunTracker's per project+item keys) -- restoring is heavy enough,
 * and touches enough shared state (a new project, this plugin's SQLite db),
 * that running two at once is never desirable even for two different
 * archives.
 */

export type RestoreStage = "preparing" | "importing" | "linking";

export interface RestoreProgress {
  stage: RestoreStage;
  current?: number;
  total?: number;
}

export type RestoreReporter = (
  stage: RestoreStage,
  detail?: { current: number; total: number },
) => void;

export class RestoreInProgressError extends Error {
  constructor() {
    super("A project restore is already in progress.");
    this.name = "RestoreInProgressError";
  }
}

interface RestoreEntry {
  promise: Promise<unknown>;
  progress: RestoreProgress;
}

let active: RestoreEntry | null = null;

/** Snapshot of the current stage, or null if no restore is running. */
export function getRestoreProgress(): RestoreProgress | null {
  return active?.progress ?? null;
}

export function isRestoreInProgress(): boolean {
  return active !== null;
}

/**
 * Runs `fn` as THE restore, rejecting immediately with
 * RestoreInProgressError if one is already running. `fn` receives a
 * `report` callback to publish its current stage; getRestoreProgress()
 * reflects that until `fn` settles (resolve OR reject), at which point the
 * entry is cleared so the next restore can run.
 */
export function runExclusiveRestore<T>(
  fn: (report: RestoreReporter) => Promise<T>,
): Promise<T> {
  if (active) return Promise.reject(new RestoreInProgressError());

  const entry: RestoreEntry = {
    promise: undefined as any,
    progress: { stage: "preparing" },
  };
  const report: RestoreReporter = (stage, detail) => {
    entry.progress = { stage, ...detail };
  };
  const promise = fn(report).finally(() => {
    active = null;
  });
  entry.promise = promise;
  active = entry;
  return promise;
}
