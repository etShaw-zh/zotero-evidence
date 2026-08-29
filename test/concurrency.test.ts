import { assert } from "chai";
import { runWithConcurrency } from "../src/utils/concurrency";

describe("runWithConcurrency", function () {
  it("never exceeds the concurrency limit", async function () {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    await runWithConcurrency(items, 3, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(item);
      active--;
    });

    assert.isAtMost(maxActive, 3);
    assert.equal(order.length, items.length);
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      items,
    );
  });

  it("processes every item even when limit exceeds item count", async function () {
    const items = [1, 2];
    const seen: number[] = [];
    await runWithConcurrency(items, 10, async (item) => {
      seen.push(item);
    });
    assert.deepEqual(seen.sort(), items);
  });
});
