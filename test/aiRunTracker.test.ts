import { assert } from "chai";
import { getRunProgress, runDeduped } from "../src/modules/ai/aiRunTracker";

// Pure logic (a Map plus Promise bookkeeping, no Zotero/DB/network
// dependency at all) -- this is the actual fix for the real risk behind
// "FT/Coding's 运行 AI button looks stuck after clicking 刷新, so the user
// re-clicks it": runCriterionChecks/generateSuggestions are a single long
// call (read cached full text, call the LLM, then locate each result's
// quote in the PDF one at a time) with nothing persisted until the very
// end, so a stray second invocation for the same item used to mean a
// second, fully concurrent LLM call and PDF scan. These tests exercise
// runDeduped/getRunProgress directly against synthetic async functions
// rather than the real AI-calling services, which have no established
// mocking harness for Zotero.HTTP.request in this test suite.
describe("aiRunTracker (pure)", function () {
  it("only invokes fn once for concurrent calls with the same project+item key", async function () {
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "result";
    };

    const [a, b] = await Promise.all([
      runDeduped(1, "ITEM1", fn),
      runDeduped(1, "ITEM1", fn),
    ]);

    assert.equal(calls, 1, "fn should only run once for the same key");
    assert.equal(a, "result");
    assert.equal(b, "result");
  });

  it("invokes fn again once the previous run for that key has settled", async function () {
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };

    const first = await runDeduped(2, "ITEM2", fn);
    const second = await runDeduped(2, "ITEM2", fn);

    assert.equal(
      calls,
      2,
      "a new call after the first settles should re-run fn",
    );
    assert.equal(first, 1);
    assert.equal(second, 2);
  });

  it("does not dedupe across different projects or different items", async function () {
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return calls;
    };

    await Promise.all([
      runDeduped(1, "ITEM1", fn),
      runDeduped(2, "ITEM1", fn), // different project
      runDeduped(1, "ITEM2", fn), // different item
    ]);

    assert.equal(
      calls,
      3,
      "each distinct (project, item) pair should run independently",
    );
  });

  it("clears the entry after fn rejects, so a later call actually re-runs", async function () {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("boom");
    };

    for (let i = 0; i < 2; i++) {
      let threw = false;
      try {
        await runDeduped(3, "ITEM3", fn);
      } catch (e: any) {
        threw = true;
        assert.equal(e.message, "boom");
      }
      assert.isTrue(threw);
    }

    assert.equal(
      calls,
      2,
      "a rejected run must not permanently block later calls for the same key",
    );
  });

  it("getRunProgress reflects the latest reported stage while running, then clears once settled", async function () {
    assert.isNull(getRunProgress(4, "ITEM4"));

    let resolveGate: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const promise = runDeduped(4, "ITEM4", async (report) => {
      report("reading");
      report("analyzing");
      report("locating", { current: 2, total: 5 });
      await gate;
      report("saving");
      return "done";
    });

    // No polling needed: calling an async function runs its body
    // synchronously up to its first `await`, so all three report() calls
    // above already ran (report() itself is synchronous) before
    // runDeduped() returns here -- fn only actually suspends at `await
    // gate`.
    assert.deepEqual(getRunProgress(4, "ITEM4"), {
      stage: "locating",
      current: 2,
      total: 5,
    });

    resolveGate!();
    await promise;

    assert.isNull(
      getRunProgress(4, "ITEM4"),
      "progress should be cleared once the run settles",
    );
  });
});
