import { assert } from "chai";
import {
  DeleteInProgressError,
  getDeleteProgress,
  isDeleteInProgress,
  runExclusiveDelete,
} from "../src/modules/project/deleteTracker";

// Pure logic (a module-level slot plus Promise bookkeeping, no Zotero/DB
// dependency at all) -- same shape as test/restoreTracker.test.ts, backing
// deleteProjectDialog's "prevent duplicate submission of delete tasks":
// deleteProjectDialog checks isDeleteInProgress() before it even opens the
// project picker, and wraps the actual deleteProject() call in
// runExclusiveDelete() as a backstop against anything that races past that
// check. A second delete attempt must be REJECTED, not folded into the
// first one -- two calls could target different projects, so silently
// reusing the first call's result would misreport what got deleted.
describe("deleteTracker (pure)", function () {
  it("reports not in progress and null progress when idle", function () {
    assert.isFalse(isDeleteInProgress());
    assert.isNull(getDeleteProgress());
  });

  it("only runs one delete at a time; a concurrent second call is rejected", async function () {
    let calls = 0;
    let resolveGate: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const first = runExclusiveDelete(async (report) => {
      calls++;
      report("preparing");
      await gate;
      return "deleted";
    });

    assert.isTrue(isDeleteInProgress());

    let rejected: unknown;
    try {
      await runExclusiveDelete(async () => {
        calls++;
        return "should not run";
      });
    } catch (e) {
      rejected = e;
    }
    assert.instanceOf(rejected, DeleteInProgressError);
    assert.equal(calls, 1, "the second, concurrent call must never run fn");

    resolveGate!();
    const result = await first;
    assert.equal(result, "deleted");
    assert.isFalse(
      isDeleteInProgress(),
      "the slot must clear once the delete settles",
    );
  });

  it("allows a new delete once the previous one has settled", async function () {
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };

    const first = await runExclusiveDelete(fn);
    const second = await runExclusiveDelete(fn);

    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(calls, 2);
  });

  it("clears the slot after a rejection too, so a later call isn't blocked forever", async function () {
    const failing = async () => {
      throw new Error("FOREIGN KEY constraint failed");
    };

    let threw = false;
    try {
      await runExclusiveDelete(failing);
    } catch (e: any) {
      threw = true;
      assert.equal(e.message, "FOREIGN KEY constraint failed");
    }
    assert.isTrue(threw);
    assert.isFalse(isDeleteInProgress());

    // A fresh delete right after must actually run, not bounce off a stale
    // "in progress" flag left over from the failed one.
    const result = await runExclusiveDelete(async () => "ok");
    assert.equal(result, "ok");
  });

  it("getDeleteProgress reflects the latest reported stage while running, then clears once settled", async function () {
    let resolveGate: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const promise = runExclusiveDelete(async (report) => {
      report("preparing");
      report("erasingItems", { current: 4, total: 9 });
      await gate;
      report("erasingCollections");
      report("cleaningRecords");
      return "done";
    });

    // report() is synchronous and fn runs synchronously up to its first
    // `await`, so both report() calls above already landed before
    // runExclusiveDelete() returns here.
    assert.deepEqual(getDeleteProgress(), {
      stage: "erasingItems",
      current: 4,
      total: 9,
    });

    resolveGate!();
    await promise;

    assert.isNull(
      getDeleteProgress(),
      "progress should be cleared once the delete settles",
    );
  });
});
