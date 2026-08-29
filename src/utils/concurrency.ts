/**
 * Runs `worker` over `items` with at most `limit` in flight at once.
 * REQUIREMENTS.md 5.2: batch AI screening should support multi-threaded
 * (concurrent) LLM requests, not strictly one-at-a-time.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runner()));
}
