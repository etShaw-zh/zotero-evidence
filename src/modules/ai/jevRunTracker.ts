/**
 * "One JEV pre-evaluation batch per project at a time" guard -- issue #12
 * explicitly asks that a long-running JEV task "避免重复提交" (avoid
 * duplicate submission). Unlike aiRunTracker.ts's runDeduped (per
 * project+item, for a single-item "运行 AI" button), a JEV run is a single
 * project-wide batch job over many items at once -- so this tracks
 * in-flight state per PROJECT, not per item, and getJevRunProgress lets the
 * dialog reflect "N/total done" even for a render pass that didn't start
 * the run itself (same reasoning as aiRunTracker's getRunProgress) --
 * including a render pass from a dialog that was CLOSED and reopened while
 * the run (a plain promise, not tied to any dialog's lifecycle) kept going
 * in the background.
 *
 * Also owns cancellation: requestJevBatchCancel lets the dialog's "取消"
 * button actually interrupt a run that would otherwise have no way to
 * stop -- both by flagging isJevBatchCancelled (checked between items) and
 * by invoking every currently-registered in-flight request's own canceller
 * (registered via registerJevCanceler, called from jevClient.ts's
 * callJev), so a request that's hung waiting on a response gets aborted
 * immediately rather than only being skipped for once it eventually
 * settles on its own.
 */

export interface JevRunProgress {
  done: number;
  total: number;
}

export interface JevCancelToken {
  isCancelled: () => boolean;
  /** Registers a cancel function for one in-flight request; returns an
   * unregister function the caller must invoke once that request settles
   * (success or failure) so a stale canceller is never invoked later. */
  registerCanceler: (cancel: () => void) => () => void;
}

interface RunEntry {
  promise: Promise<unknown>;
  progress: JevRunProgress;
  cancelled: boolean;
  cancelers: Set<() => void>;
}

const runs = new Map<number, RunEntry>();

export function isJevBatchRunning(projectId: number): boolean {
  return runs.has(projectId);
}

export function isJevBatchCancelled(projectId: number): boolean {
  return runs.get(projectId)?.cancelled ?? false;
}

export function getJevRunProgress(projectId: number): JevRunProgress | null {
  return runs.get(projectId)?.progress ?? null;
}

/**
 * Flags the running batch for `projectId` as cancelled and immediately
 * aborts every request currently in flight for it. Returns false (no-op)
 * if no batch is running for that project. Already-completed items keep
 * their persisted rows; runJevBatch itself stops dispatching new items
 * once it observes the flag between items.
 */
export function requestJevBatchCancel(projectId: number): boolean {
  const entry = runs.get(projectId);
  if (!entry) return false;
  entry.cancelled = true;
  for (const cancel of entry.cancelers) {
    try {
      cancel();
    } catch {
      // Best-effort -- a canceller throwing must not block flagging the
      // rest, or stop the loop below from finishing.
    }
  }
  return true;
}

/**
 * Runs `fn` for `projectId` with dedup: if a batch is already in flight for
 * this project, returns that SAME promise instead of starting a second one
 * -- a second click on "运行 JEV 预评估" (or a re-render recreating the
 * button) while one is still running joins the existing run rather than
 * starting a concurrent, wasteful second pass over the same items.
 *
 * The entry is registered in `runs` BEFORE `fn` is invoked (not after),
 * so a cancel token `fn` reads/registers against synchronously, before its
 * first `await`, sees a real entry rather than racing this function's own
 * setup.
 */
export function runJevBatchDeduped<T>(
  projectId: number,
  total: number,
  fn: (
    report: (done: number) => void,
    cancelToken: JevCancelToken,
  ) => Promise<T>,
): Promise<T> {
  const existing = runs.get(projectId);
  if (existing) return existing.promise as Promise<T>;

  const entry: RunEntry = {
    promise: undefined as any,
    progress: { done: 0, total },
    cancelled: false,
    cancelers: new Set(),
  };
  runs.set(projectId, entry);

  const report = (done: number) => {
    entry.progress = { done, total };
  };
  const cancelToken: JevCancelToken = {
    isCancelled: () => entry.cancelled,
    registerCanceler: (cancel) => {
      entry.cancelers.add(cancel);
      return () => entry.cancelers.delete(cancel);
    },
  };
  const promise = fn(report, cancelToken).finally(() => {
    runs.delete(projectId);
  });
  entry.promise = promise;
  return promise;
}
