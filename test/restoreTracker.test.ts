import { assert } from "chai";
import {
  getRestoreProgress,
  isRestoreInProgress,
  RestoreInProgressError,
  runExclusiveRestore,
} from "../src/modules/archive/restoreTracker";

// Pure logic (a module-level slot plus Promise bookkeeping, no Zotero/DB
// dependency at all) -- this backs issue #11's "prevent duplicate
// submission of restore tasks": restoreArchiveDialog checks
// isRestoreInProgress() before it even opens the file picker, and wraps
// the actual importProjectArchive() call in runExclusiveRestore() as a
// backstop against anything that races past that check. Unlike
// aiRunTracker's runDeduped (same key => share the result), a second
// restore attempt here must be REJECTED, not folded into the first one --
// two calls could target different archive files, so silently reusing the
// first call's result would misreport what got restored.
describe("restoreTracker (pure)", function () {
  it("reports not in progress and null progress when idle", function () {
    assert.isFalse(isRestoreInProgress());
    assert.isNull(getRestoreProgress());
  });

  it("only runs one restore at a time; a concurrent second call is rejected", async function () {
    let calls = 0;
    let resolveGate: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const first = runExclusiveRestore(async (report) => {
      calls++;
      report("preparing");
      await gate;
      return "restored";
    });

    assert.isTrue(isRestoreInProgress());

    let rejected: unknown;
    try {
      await runExclusiveRestore(async () => {
        calls++;
        return "should not run";
      });
    } catch (e) {
      rejected = e;
    }
    assert.instanceOf(rejected, RestoreInProgressError);
    assert.equal(calls, 1, "the second, concurrent call must never run fn");

    resolveGate!();
    const result = await first;
    assert.equal(result, "restored");
    assert.isFalse(
      isRestoreInProgress(),
      "the slot must clear once the restore settles",
    );
  });

  it("allows a new restore once the previous one has settled", async function () {
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };

    const first = await runExclusiveRestore(fn);
    const second = await runExclusiveRestore(fn);

    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(calls, 2);
  });

  it("clears the slot after a rejection too, so a later call isn't blocked forever", async function () {
    const failing = async () => {
      throw new Error("archive is corrupt");
    };

    let threw = false;
    try {
      await runExclusiveRestore(failing);
    } catch (e: any) {
      threw = true;
      assert.equal(e.message, "archive is corrupt");
    }
    assert.isTrue(threw);
    assert.isFalse(isRestoreInProgress());

    // A fresh restore right after must actually run, not bounce off a
    // stale "in progress" flag left over from the failed one.
    const result = await runExclusiveRestore(async () => "ok");
    assert.equal(result, "ok");
  });

  it("getRestoreProgress reflects the latest reported stage while running, then clears once settled", async function () {
    let resolveGate: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const promise = runExclusiveRestore(async (report) => {
      report("preparing");
      report("importing", { current: 3, total: 10 });
      await gate;
      report("linking");
      return "done";
    });

    // report() is synchronous and fn runs synchronously up to its first
    // `await`, so both report() calls above already landed before
    // runExclusiveRestore() returns here.
    assert.deepEqual(getRestoreProgress(), {
      stage: "importing",
      current: 3,
      total: 10,
    });

    resolveGate!();
    await promise;

    assert.isNull(
      getRestoreProgress(),
      "progress should be cleared once the restore settles",
    );
  });
});
