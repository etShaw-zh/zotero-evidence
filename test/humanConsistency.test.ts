import { assert } from "chai";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import {
  applyReconciliation,
  computeRoundConsistency,
  getActiveRound,
  HumanConsistencyResult,
  recordCollectedCsv,
  sampleRandom,
  startFullRound,
  startPilotRound,
} from "../src/modules/consistency/humanConsistencyService";

async function makeTestItem(title: string, doi?: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  if (doi) item.setField("DOI", doi);
  await item.saveTx();
  return item;
}

function tempPath(name: string): string {
  const file = Zotero.File.pathToFile(Zotero.DataDirectory.dir) as any;
  file.append(name);
  return file.path;
}

function reviewerCsv(
  decidedBy: string,
  rows: { title: string; doi?: string; stage: string; decision: string }[],
): string {
  const lines = [
    "item_key,title,doi,stage,ai_decision,ai_reasoning,ai_model,human_decision,exclusion_reason,decided_by,decided_at,fulltext_ready",
  ];
  for (const r of rows) {
    lines.push(
      `,${r.title},${r.doi ?? ""},${r.stage},,,,${r.decision},,${decidedBy},2026-01-01T00:00:00.000Z,0`,
    );
  }
  return lines.join("\n");
}

describe("Screening Consistency: humanConsistencyService (project + DB)", function () {
  this.timeout(60000);

  describe("sampleRandom (pure)", function () {
    it("returns an empty array for n=0 or an empty pool", function () {
      assert.deepEqual(sampleRandom([1, 2, 3], 0), []);
      assert.deepEqual(sampleRandom([], 5), []);
    });

    it("caps at the pool size when n exceeds it", function () {
      const result = sampleRandom([1, 2, 3], 10);
      assert.equal(result.length, 3);
      assert.sameMembers(result, [1, 2, 3]);
    });

    it("returns exactly n distinct elements from the pool", function () {
      const pool = Array.from({ length: 20 }, (_, i) => i);
      const result = sampleRandom(pool, 5);
      assert.equal(result.length, 5);
      assert.equal(new Set(result).size, 5);
      for (const v of result) assert.include(pool, v);
    });
  });

  it("runs the full pilot -> reconcile -> full-round lifecycle", async function () {
    const project = await createProject(`Human Consistency Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    const items = await Promise.all(
      Array.from({ length: 5 }, (_, i) => makeTestItem(`HC Item ${i}`)),
    );
    for (const item of items) {
      item.addToCollection(collections.screenQueueId);
      await item.saveTx();
    }

    // No round yet.
    assert.isNull(await getActiveRound(project.id, "ta_screening"));

    const pilotZip = tempPath(`hc-pilot-${Date.now()}.zip`);
    const pilotRound = await startPilotRound(
      project.id,
      "ta_screening",
      40, // round(5 * 0.4) = 2
      pilotZip,
    );
    assert.equal(pilotRound.phase, "pilot");
    assert.equal(pilotRound.status, "sampled");
    assert.equal(pilotRound.itemKeys.length, 2);
    assert.isTrue(Zotero.File.pathToFile(pilotZip).exists());

    // A second round can't start while this one is still open.
    let threw = false;
    try {
      await startPilotRound(project.id, "ta_screening", 40, pilotZip);
    } catch {
      threw = true;
    }
    assert.isTrue(threw);

    const sampledItems = items.filter((it) =>
      pilotRound.itemKeys.includes(it.key),
    );
    assert.equal(sampledItems.length, 2);
    const [itemA, itemB] = sampledItems;
    const titleA = itemA.getField("title") as string;
    const titleB = itemB.getField("title") as string;

    const csvAPath = tempPath(`hc-reviewer-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-reviewer-b-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        { title: titleA, stage: "ta_screening", decision: "include" },
        { title: titleB, stage: "ta_screening", decision: "exclude" },
      ]),
    );
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPath),
      reviewerCsv("222", [
        { title: titleA, stage: "ta_screening", decision: "include" }, // agree
        { title: titleB, stage: "ta_screening", decision: "include" }, // disagree
      ]),
    );

    let round = await recordCollectedCsv(pilotRound.id, "a", csvAPath);
    assert.equal(round.status, "sampled"); // still waiting on reviewer B
    round = await recordCollectedCsv(pilotRound.id, "b", csvBPath);
    assert.equal(round.status, "collected");

    const result: HumanConsistencyResult = await computeRoundConsistency(round);
    assert.equal(result.reviewerA, "111");
    assert.equal(result.reviewerB, "222");
    assert.equal(result.n, 2);
    assert.equal(result.items.length, 2);
    const itemAResult = result.items.find((it) => it.itemKey === itemA.key)!;
    assert.equal(itemAResult.aDecision, "include");
    assert.equal(itemAResult.bDecision, "include");
    const itemBResult = result.items.find((it) => it.itemKey === itemB.key)!;
    assert.equal(itemBResult.aDecision, "exclude");
    assert.equal(itemBResult.bDecision, "include");
    assert.approximately(result.observedAgreement!, 0.5, 1e-9);

    await applyReconciliation(round, [
      { itemKey: itemA.key, decision: "include" },
      { itemKey: itemB.key, decision: "exclude" },
    ]);

    assert.isFalse(itemA.inCollection(collections.screenQueueId));
    assert.isTrue(itemA.inCollection(collections.taIncludeId));
    assert.isFalse(itemB.inCollection(collections.screenQueueId));
    assert.isTrue(itemB.inCollection(collections.taExcludeId));

    const reconciled = await getActiveRound(project.id, "ta_screening");
    assert.equal(reconciled!.status, "reconciled");
    assert.equal(reconciled!.phase, "pilot");

    const fullZip = tempPath(`hc-full-${Date.now()}.zip`);
    const fullRound = await startFullRound(project.id, "ta_screening", fullZip);
    assert.equal(fullRound.phase, "full");
    assert.equal(fullRound.status, "sampled");
    // The 2 pilot items moved out of the queue when reconciled, so only
    // the remaining 3 are in scope for the full round.
    assert.equal(fullRound.itemKeys.length, 3);
    assert.notInclude(fullRound.itemKeys, itemA.key);
    assert.notInclude(fullRound.itemKeys, itemB.key);
  });

  it("computeRoundConsistency matches by DOI even when the two reviewers' CSVs disagree on the title text, and falls back to title when no DOI is available", async function () {
    const project = await createProject(
      `Human Consistency DOI Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    // itemWithDoi: both reviewers' CSVs carry a garbled/mismatched title for
    // it (simulating hand-edited CSVs), but the same DOI (differently
    // formatted -- one with a doi.org URL prefix, one bare, one uppercased)
    // -- normalizeDOI() should still line them up.
    const itemWithDoi = await makeTestItem(
      "The Real Title",
      "10.1000/Example.DOI",
    );
    // itemNoDoi: no DOI on the item or in either CSV -- must still match by
    // title as before.
    const itemNoDoi = await makeTestItem("Plain Title No DOI");

    for (const item of [itemWithDoi, itemNoDoi]) {
      item.addToCollection(collections.screenQueueId);
      await item.saveTx();
    }

    const csvAPath = tempPath(`hc-doi-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-doi-b-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        {
          title: "Reviewer A's garbled title",
          doi: "https://doi.org/10.1000/example.doi",
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: "Plain Title No DOI",
          stage: "ta_screening",
          decision: "exclude",
        },
      ]),
    );
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPath),
      reviewerCsv("222", [
        {
          title: "Reviewer B's totally different garbled title",
          doi: "10.1000/EXAMPLE.DOI",
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: "Plain Title No DOI",
          stage: "ta_screening",
          decision: "exclude",
        },
      ]),
    );

    const round = await startPilotRound(
      project.id,
      "ta_screening",
      100,
      tempPath(`hc-doi-pilot-${Date.now()}.zip`),
    );
    await recordCollectedCsv(round.id, "a", csvAPath);
    const finalRound = await recordCollectedCsv(round.id, "b", csvBPath);
    assert.equal(finalRound.status, "collected");

    const result = await computeRoundConsistency(finalRound);

    const doiItemResult = result.items.find(
      (it) => it.itemKey === itemWithDoi.key,
    )!;
    // Neither CSV's title matches the item's real title (nor each other),
    // so this only resolves if the DOI match won.
    assert.equal(doiItemResult.aDecision, "include");
    assert.equal(doiItemResult.bDecision, "include");

    const titleItemResult = result.items.find(
      (it) => it.itemKey === itemNoDoi.key,
    )!;
    assert.equal(titleItemResult.aDecision, "exclude");
    assert.equal(titleItemResult.bDecision, "exclude");
  });

  it("computeRoundConsistency refuses until both reviewers' CSVs are collected", async function () {
    const project = await createProject(
      `Human Consistency Incomplete Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Incomplete Item");
    item.addToCollection(collections.screenQueueId);
    await item.saveTx();

    const zip = tempPath(`hc-incomplete-${Date.now()}.zip`);
    const round = await startPilotRound(project.id, "ta_screening", 100, zip);

    let threw = false;
    try {
      await computeRoundConsistency(round);
    } catch {
      threw = true;
    }
    assert.isTrue(threw);
  });
});
