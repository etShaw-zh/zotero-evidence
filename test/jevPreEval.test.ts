import { assert } from "chai";
import { databaseService } from "../src/modules/db/database";
import {
  getJevConfig,
  isJevConfigured,
  setJevConfig,
} from "../src/modules/ai/jevConfig";
import { parseJevAnswer } from "../src/modules/ai/jevClient";
import {
  getJevRunProgress,
  isJevBatchCancelled,
  isJevBatchRunning,
  requestJevBatchCancel,
  runJevBatchDeduped,
} from "../src/modules/ai/jevRunTracker";
import { createProject } from "../src/modules/project/projectManager";
import { saveCriteria } from "../src/modules/screening/criteriaService";
import {
  buildJevState,
  getLatestJevEvaluation,
  getLatestJevEvaluations,
  runJevBatch,
} from "../src/modules/screening/jevPreEvalService";

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

describe("JEV pre-evaluation (issue #12)", function () {
  describe("jevConfig (pure, prefs-backed)", function () {
    afterEach(function () {
      setJevConfig({ endpoint: "", apiKey: "", model: "" });
    });

    it("falls back to the documented defaults when nothing is saved", function () {
      setJevConfig({ endpoint: "", apiKey: "", model: "" });
      const config = getJevConfig();
      assert.equal(config.endpoint, "https://aihubmix.com/v1/systemone");
      assert.equal(config.model, "jev-1.13");
      assert.equal(config.apiKey, "");
      assert.isFalse(isJevConfigured(config));
    });

    it("round-trips a saved config", function () {
      setJevConfig({
        endpoint: "https://example.com/v1/systemone",
        apiKey: "sk-test",
        model: "jev-2.0",
      });
      const config = getJevConfig();
      assert.equal(config.endpoint, "https://example.com/v1/systemone");
      assert.equal(config.apiKey, "sk-test");
      assert.equal(config.model, "jev-2.0");
      assert.isTrue(isJevConfigured(config));
    });
  });

  describe("parseJevAnswer (pure)", function () {
    it("parses a well-formed decision answer", function () {
      const answer = parseJevAnswer({
        answers: {
          decision: {
            choice: "include",
            confidence: 0.87,
            probabilities: { include: 0.87, exclude: 0.05, unclear: 0.08 },
          },
        },
      });
      assert.equal(answer.choice, "include");
      assert.equal(answer.confidence, 0.87);
      assert.deepEqual(answer.probabilities, {
        include: 0.87,
        exclude: 0.05,
        unclear: 0.08,
      });
    });

    it("defaults confidence/probabilities when the response omits them", function () {
      const answer = parseJevAnswer({
        answers: { decision: { choice: "unclear" } },
      });
      assert.equal(answer.choice, "unclear");
      assert.isNull(answer.confidence);
      assert.deepEqual(answer.probabilities, {});
    });

    it("throws on a missing/invalid choice", function () {
      assert.throws(
        () => parseJevAnswer({ answers: { decision: {} } }),
        /valid answers\.decision\.choice/,
      );
      assert.throws(
        () => parseJevAnswer({}),
        /valid answers\.decision\.choice/,
      );
    });

    it("surfaces a provider-shaped error message instead of the generic one", function () {
      assert.throws(
        () => parseJevAnswer({ error: { message: "insufficient balance" } }),
        /JEV: insufficient balance/,
      );
    });
  });

  describe("buildJevState (pure)", function () {
    it("embeds the research question, criteria, title and abstract", function () {
      const state = buildJevState(
        {
          researchQuestion: "Does X improve Y?",
          inclusionCriteria: ["Empirical study", "Peer-reviewed"],
          exclusionCriteria: ["Protocol only"],
        },
        "A Study of X",
        "We found that X improves Y.",
      );
      assert.include(state, "Does X improve Y?");
      assert.include(state, "- Empirical study");
      assert.include(state, "- Peer-reviewed");
      assert.include(state, "- Protocol only");
      assert.include(state, "Title: A Study of X");
      assert.include(state, "Abstract: We found that X improves Y.");
      assert.include(state, "Screen liberally");
    });

    it("shows a placeholder for a missing abstract rather than an empty line", function () {
      const state = buildJevState(
        { researchQuestion: "Q", inclusionCriteria: [], exclusionCriteria: [] },
        "Title only",
        "",
      );
      assert.include(state, "Abstract: (no abstract available)");
    });
  });

  // Mirrors aiRunTracker.test.ts's own philosophy exactly, at project (not
  // item) granularity -- see jevRunTracker.ts's doc comment for why a JEV
  // run is deduped per-project rather than per-item.
  describe("jevRunTracker (pure)", function () {
    it("only invokes fn once for concurrent calls against the same project", async function () {
      let calls = 0;
      const fn = async (report: (done: number) => void) => {
        calls++;
        report(1);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "result";
      };

      const [a, b] = await Promise.all([
        runJevBatchDeduped(101, 1, fn),
        runJevBatchDeduped(101, 1, fn),
      ]);

      assert.equal(calls, 1);
      assert.equal(a, "result");
      assert.equal(b, "result");
    });

    it("reports isJevBatchRunning/getJevRunProgress while in flight, clears once settled", async function () {
      assert.isFalse(isJevBatchRunning(102));
      assert.isNull(getJevRunProgress(102));

      let resolveGate: () => void;
      const gate = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });
      const promise = runJevBatchDeduped(102, 5, async (report) => {
        report(3);
        await gate;
        return "done";
      });

      assert.isTrue(isJevBatchRunning(102));
      assert.deepEqual(getJevRunProgress(102), { done: 3, total: 5 });

      resolveGate!();
      await promise;

      assert.isFalse(isJevBatchRunning(102));
      assert.isNull(getJevRunProgress(102));
    });

    it("clears the entry after fn rejects, so a later call re-runs", async function () {
      let calls = 0;
      const fn = async () => {
        calls++;
        throw new Error("boom");
      };
      for (let i = 0; i < 2; i++) {
        let threw = false;
        try {
          await runJevBatchDeduped(103, 1, fn);
        } catch (e: any) {
          threw = true;
          assert.equal(e.message, "boom");
        }
        assert.isTrue(threw);
      }
      assert.equal(calls, 2);
    });
  });

  describe("jevRunTracker cancellation (pure)", function () {
    it("requestJevBatchCancel flags isCancelled and invokes every registered canceler; a second request once idle is a no-op", async function () {
      let cancelCalls = 0;
      let resolveGate: () => void;
      const gate = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });

      const promise = runJevBatchDeduped(
        201,
        1,
        async (_report, cancelToken) => {
          const unregister1 = cancelToken.registerCanceler(() => {
            cancelCalls++;
          });
          const unregister2 = cancelToken.registerCanceler(() => {
            cancelCalls++;
          });
          await gate;
          unregister1();
          unregister2();
          return cancelToken.isCancelled();
        },
      );

      assert.isFalse(isJevBatchCancelled(201));
      assert.isTrue(requestJevBatchCancel(201));
      assert.isTrue(isJevBatchCancelled(201));
      assert.equal(
        cancelCalls,
        2,
        "every registered canceler should be invoked",
      );

      resolveGate!();
      assert.isTrue(
        await promise,
        "cancelToken.isCancelled() should read true from inside fn too",
      );

      assert.isFalse(
        requestJevBatchCancel(201),
        "no run is active anymore, so a later cancel request is a no-op",
      );
    });

    it("returns false immediately when no batch is running for that project", function () {
      assert.isFalse(requestJevBatchCancel(999999));
    });

    it("an unregistered canceler (its own request already settled) is never invoked by a later cancel", async function () {
      let calls = 0;
      const promise = runJevBatchDeduped(
        202,
        1,
        async (_report, cancelToken) => {
          const unregister = cancelToken.registerCanceler(() => {
            calls++;
          });
          unregister(); // simulates the request settling on its own first
          return "done";
        },
      );
      await promise;
      requestJevBatchCancel(202); // no run active anymore either way
      assert.equal(calls, 0);
    });
  });

  describe("runJevBatch / getLatestJevEvaluation(s) (project + DB)", function () {
    this.timeout(60000);

    it("refuses to run without configured TA criteria", async function () {
      const project = await createProject(`JEV No Criteria Test ${Date.now()}`);
      const item = await makeTestItem("No Criteria");
      let threw = false;
      try {
        await runJevBatch(
          project.id,
          {
            endpoint: "http://127.0.0.1:1/unused",
            apiKey: "x",
            model: "jev-1.13",
          },
          [item],
        );
      } catch (e: any) {
        threw = true;
        assert.match(e.message, /criteria/i);
      }
      assert.isTrue(threw);
    });

    it("persists a failed call as an 'error' row rather than dropping it", async function () {
      const project = await createProject(`JEV Failure Test ${Date.now()}`);
      await saveCriteria(project.id, "ta", {
        researchQuestion: "Q",
        inclusionCriteria: ["A"],
        exclusionCriteria: ["B"],
      });
      const item = await makeTestItem("Unreachable Endpoint Item");

      const result = await runJevBatch(
        project.id,
        {
          endpoint: "http://127.0.0.1:1/unused",
          apiKey: "x",
          model: "jev-1.13",
        },
        [item],
      );

      assert.equal(result.succeeded, 0);
      assert.equal(result.failed, 1);
      assert.equal(result.skipped, 0);
      assert.equal(result.failures.length, 1);

      const evaluation = await getLatestJevEvaluation(project.id, item.key);
      assert.isNotNull(evaluation);
      assert.equal(evaluation!.status, "error");
      assert.isNotNull(evaluation!.errorMessage);
      assert.isNull(evaluation!.decision);

      const all = await getLatestJevEvaluations(project.id);
      assert.isTrue(all.has(item.key));
      assert.equal(all.get(item.key)!.status, "error");
    });

    it("does not skip an item whose latest row is 'error' (only 'ok' rows are skipped)", async function () {
      const project = await createProject(`JEV Retry Test ${Date.now()}`);
      await saveCriteria(project.id, "ta", {
        researchQuestion: "Q",
        inclusionCriteria: ["A"],
        exclusionCriteria: ["B"],
      });
      const item = await makeTestItem("Retried Item");
      const config = {
        endpoint: "http://127.0.0.1:1/unused",
        apiKey: "x",
        model: "jev-1.13",
      };

      const first = await runJevBatch(project.id, config, [item]);
      assert.equal(first.failed, 1);
      assert.equal(first.skipped, 0);

      const second = await runJevBatch(project.id, config, [item]);
      assert.equal(
        second.skipped,
        0,
        "an item whose only prior row failed must be retried, not skipped",
      );
      assert.equal(second.failed, 1);

      const all = await getLatestJevEvaluations(project.id);
      assert.equal(
        all.size,
        1,
        "getLatestJevEvaluations returns one row per item, not per run",
      );
    });

    it("skips an item that already has an 'ok' evaluation unless forceRerun is set", async function () {
      const project = await createProject(`JEV Skip Test ${Date.now()}`);
      await saveCriteria(project.id, "ta", {
        researchQuestion: "Q",
        inclusionCriteria: ["A"],
        exclusionCriteria: ["B"],
      });
      const item = await makeTestItem("Already Evaluated Item");

      // Seed a successful evaluation directly -- this suite has no mocking
      // harness for Zotero.HTTP.request (see ftCriterionCheckService's own
      // tests, which take the same approach), so a real 'ok' row has to be
      // written the same low-level way insertEvaluation() itself would.
      await databaseService.init();
      await databaseService.queryAsync(
        `INSERT INTO jev_evaluations
          (project_id, item_key, model, status, decision, confidence, probabilities, error_message, created_at)
         VALUES (?, ?, ?, 'ok', 'include', 0.9, '{"include":0.9}', NULL, ?)`,
        [project.id, item.key, "jev-1.13", new Date().toISOString()],
      );

      const config = {
        endpoint: "http://127.0.0.1:1/unused",
        apiKey: "x",
        model: "jev-1.13",
      };

      const skippedRun = await runJevBatch(project.id, config, [item]);
      assert.equal(skippedRun.skipped, 1);
      assert.equal(skippedRun.succeeded, 0);
      assert.equal(skippedRun.failed, 0);

      const stillOk = await getLatestJevEvaluation(project.id, item.key);
      assert.equal(stillOk!.status, "ok");
      assert.equal(stillOk!.decision, "include");

      const forced = await runJevBatch(project.id, config, [item], {
        forceRerun: true,
      });
      assert.equal(forced.skipped, 0);
      assert.equal(
        forced.failed,
        1,
        "forceRerun must actually re-call, which fails against this unreachable endpoint",
      );

      const afterForce = await getLatestJevEvaluation(project.id, item.key);
      assert.equal(
        afterForce!.status,
        "error",
        "forceRerun's new (failed) row becomes the latest -- append-only, not overwritten in place",
      );
    });

    it("cancelling mid-batch stops dispatching remaining items, which are counted as cancelled rather than failed and get no persisted row", async function () {
      const project = await createProject(`JEV Cancel Test ${Date.now()}`);
      await saveCriteria(project.id, "ta", {
        researchQuestion: "Q",
        inclusionCriteria: ["A"],
        exclusionCriteria: ["B"],
      });
      const items = await Promise.all([
        makeTestItem("Cancel Item 1"),
        makeTestItem("Cancel Item 2"),
        makeTestItem("Cancel Item 3"),
      ]);
      const config = {
        endpoint: "http://127.0.0.1:1/unused",
        apiKey: "x",
        model: "jev-1.13",
      };

      // concurrency: 1 makes runWithConcurrency fully sequential, so
      // requesting cancellation synchronously from inside onProgress right
      // after the FIRST item finishes deterministically lands before the
      // second item is ever dispatched -- no reliance on real network
      // timing (unlike racing a cancel against connection-refused speed).
      const result = await runJevBatch(project.id, config, items, {
        concurrency: 1,
        onProgress: (done) => {
          if (done === 1) {
            assert.isTrue(requestJevBatchCancel(project.id));
          }
        },
      });

      assert.equal(
        result.failed,
        1,
        "only the item already in flight when cancellation was requested should have actually been attempted",
      );
      assert.equal(
        result.cancelled,
        2,
        "the remaining items should be cancelled rather than attempted",
      );
      assert.equal(result.succeeded, 0);
      assert.equal(result.skipped, 0);
      assert.isFalse(isJevBatchRunning(project.id));

      const all = await getLatestJevEvaluations(project.id);
      assert.equal(
        all.size,
        1,
        "only the one attempted (and failed) item gets a persisted row -- cancelled items get none",
      );
    });
  });
});
