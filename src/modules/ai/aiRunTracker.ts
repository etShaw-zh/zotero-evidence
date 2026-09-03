/**
 * Shared "one AI run per item at a time" tracker for FT-Screening's
 * runCriterionChecks and Coding's generateSuggestions -- both are a single
 * long-running call (read cached full text, call the LLM, then locate each
 * result's quote in the PDF one at a time) with no intermediate state
 * persisted anywhere until the very end, so the "运行 AI" button's
 * "处理中…" text was the ONLY record that a call was in flight. Clicking
 * the unrelated "刷新" button next to it re-renders the whole area from
 * current DB state, which fully recreates that button from scratch -- with
 * nothing in the DB yet (the call hasn't finished), it silently resets back
 * to the idle "运行 AI" label, which reads as "nothing happened" and
 * invites a second, genuinely concurrent click.
 *
 * runDeduped fixes the actual risk (never runs the same project+item twice
 * concurrently, regardless of how many times a button gets re-created or
 * clicked) and getRunProgress lets ANY later render -- not just the one
 * that started the call -- show the real current stage instead of
 * resetting to idle.
 */

export type AIRunStage = "reading" | "analyzing" | "locating" | "saving";

export interface AIRunProgress {
  stage: AIRunStage;
  current?: number;
  total?: number;
}

export type AIRunReporter = (
  stage: AIRunStage,
  detail?: { current: number; total: number },
) => void;

interface RunEntry {
  promise: Promise<unknown>;
  progress: AIRunProgress;
}

const runs = new Map<string, RunEntry>();

function runKey(projectId: number, itemKey: string): string {
  return `${projectId}:${itemKey}`;
}

/**
 * Snapshot of the current stage for (projectId, itemKey), or null if
 * nothing is running. Deliberately a plain snapshot, not a live
 * subscription -- consistent with the rest of this plugin's panes, which
 * only ever redraw in response to an actual user action (selecting an
 * item, clicking refresh), never on a timer. The render pass that itself
 * started the run gets true live updates already, via the `report`
 * callback `runDeduped` hands its own `fn` -- this getter is only for a
 * LATER, different render pass (e.g. after "刷新") that didn't start the
 * call itself but still needs to reflect that one is in flight.
 */
export function getRunProgress(
  projectId: number,
  itemKey: string,
): AIRunProgress | null {
  return runs.get(runKey(projectId, itemKey))?.progress ?? null;
}

/**
 * Runs `fn` for (projectId, itemKey) with dedup: if a run is already in
 * flight for this exact key, returns that SAME promise instead of calling
 * `fn` again -- no matter how many times this is invoked (a stray double
 * click, two separately-rendered buttons for the same item after a
 * refresh, ...), the underlying work -- and the real cost, one LLM call
 * plus a sequential per-result PDF quote search -- only ever happens once.
 * `fn` receives a `report` callback to publish its current stage; that
 * value is what getRunProgress reads until `fn` settles (resolve OR
 * reject), at which point the entry is removed entirely.
 */
export function runDeduped<T>(
  projectId: number,
  itemKey: string,
  fn: (report: AIRunReporter) => Promise<T>,
): Promise<T> {
  const k = runKey(projectId, itemKey);
  const existing = runs.get(k);
  if (existing) return existing.promise as Promise<T>;

  const entry: RunEntry = {
    promise: undefined as any,
    progress: { stage: "reading" },
  };
  const report: AIRunReporter = (stage, detail) => {
    entry.progress = { stage, ...detail };
  };
  const promise = fn(report).finally(() => {
    runs.delete(k);
  });
  entry.promise = promise;
  runs.set(k, entry);
  return promise;
}
