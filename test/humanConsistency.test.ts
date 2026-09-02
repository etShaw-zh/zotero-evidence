import { assert } from "chai";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { getCriterionChecks } from "../src/modules/screening/ftCriterionCheckService";
import { computePrismaData } from "../src/modules/export/screeningExport";
import { getConsistencyItemResult } from "../src/modules/consistency/consistencyItemResultsService";
import {
  applyAgreedResults,
  computeRoundConsistency,
  getAllRounds,
  getLatestRound,
  HumanConsistencyResult,
  recordCollectedCsv,
  sampleRandom,
  startRound,
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

/** One reviewer's full-pipeline screening log: a row per (item, stage)
 * they actually reached -- mirrors what exportScreeningLog() produces
 * once a reviewer has screened a sampled item through TA and (if they
 * didn't TA-exclude it) FT in their own copy. */
function reviewerCsv(
  decidedBy: string,
  rows: {
    title: string;
    doi?: string;
    stage: "ta_screening" | "ft_screening";
    decision: string;
    exclusionReason?: string;
  }[],
): string {
  const lines = [
    "item_key,title,doi,stage,ai_decision,ai_reasoning,ai_model,human_decision,exclusion_reason,decided_by,decided_at,fulltext_ready",
  ];
  for (const r of rows) {
    lines.push(
      `,${r.title},${r.doi ?? ""},${r.stage},,,,${r.decision},${r.exclusionReason ?? ""},${decidedBy},2026-01-01T00:00:00.000Z,0`,
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

  it("runs the sample -> collect -> apply round lifecycle, deriving each reviewer's final verdict from their own TA+FT rows, and lets another round start without waiting for the current one to be reconciled", async function () {
    const project = await createProject(`Human Consistency Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    const items = await Promise.all(
      Array.from({ length: 5 }, (_, i) => makeTestItem(`HC Item ${i}`)),
    );
    for (const item of items) {
      item.addToCollection(collections.taQueueId);
      await item.saveTx();
    }

    // No round yet.
    assert.isNull(await getLatestRound(project.id));
    assert.deepEqual(await getAllRounds(project.id), []);

    const round1Zip = tempPath(`hc-round1-${Date.now()}.zip`);
    const round1 = await startRound(
      project.id,
      40, // round(5 * 0.4) = 2
      round1Zip,
    );
    assert.equal(round1.status, "sampled");
    assert.equal(round1.itemKeys.length, 2);
    assert.isTrue(Zotero.File.pathToFile(round1Zip).exists());

    // A second round can start immediately -- no "finish the current one
    // first" gate anymore. getLatestRound always tracks the most recently
    // STARTED round, and getAllRounds lists every round newest-first.
    const round2Zip = tempPath(`hc-round2-${Date.now()}.zip`);
    const round2 = await startRound(project.id, 20, round2Zip); // round(5*0.2)=1
    assert.isTrue(round2.id > round1.id);
    assert.equal((await getLatestRound(project.id))!.id, round2.id);
    assert.deepEqual(
      (await getAllRounds(project.id)).map((r) => r.id),
      [round2.id, round1.id],
    );

    const sampledItems = items.filter((it) => round1.itemKeys.includes(it.key));
    assert.equal(sampledItems.length, 2);
    const [itemA, itemB] = sampledItems;
    const titleA = itemA.getField("title") as string;
    const titleB = itemB.getField("title") as string;

    const csvAPath = tempPath(`hc-reviewer-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-reviewer-b-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      // A: itemA -> TA include, FT include (final: include).
      //    itemB -> TA exclude (final: exclude, never reaches FT).
      reviewerCsv("111", [
        { title: titleA, stage: "ta_screening", decision: "include" },
        { title: titleA, stage: "ft_screening", decision: "include" },
        { title: titleB, stage: "ta_screening", decision: "exclude" },
      ]),
    );
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPath),
      // B: itemA -> TA include, FT include (final: include -- agrees with A).
      //    itemB -> TA include, FT include (final: include -- disagrees
      //    with A's exclude, even though the disagreement originates at
      //    a different stage than a simple "different FT call" would).
      reviewerCsv("222", [
        { title: titleA, stage: "ta_screening", decision: "include" },
        { title: titleA, stage: "ft_screening", decision: "include" },
        { title: titleB, stage: "ta_screening", decision: "include" },
        { title: titleB, stage: "ft_screening", decision: "include" },
      ]),
    );

    let round = await recordCollectedCsv(round1.id, "a", csvAPath);
    assert.equal(round.status, "sampled"); // still waiting on reviewer B
    round = await recordCollectedCsv(round1.id, "b", csvBPath);
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

    const summary = await applyAgreedResults(round);
    // itemA: both reviewers' final verdict was "include" -> applied.
    // itemB: A's was "exclude" (TA), B's was "include" -> left alone.
    assert.equal(summary.applied, 1);
    assert.equal(summary.disagreed, 1);

    // The agreed "include" drives the item all the way to FT-Include (TA
    // confirm, then FT confirm) -- not just TA-Include.
    assert.isFalse(itemA.inCollection(collections.taQueueId));
    assert.isTrue(itemA.inCollection(collections.taIncludeId));
    assert.isFalse(itemA.inCollection(collections.ftQueueId));
    assert.isTrue(itemA.inCollection(collections.ftIncludeId));
    // The disagreement is left completely untouched -- still sitting right
    // where a round always samples from, for a third reviewer to resolve.
    assert.isTrue(itemB.inCollection(collections.taQueueId));
    assert.isFalse(itemB.inCollection(collections.taExcludeId));
    assert.isFalse(itemB.inCollection(collections.taIncludeId));

    // Every item in the round -- agreed or not -- gets a snapshot so
    // taQueuePane.ts can show a third reviewer both original calls.
    const itemBSnapshot = await getConsistencyItemResult(project.id, itemB.key);
    assert.equal(itemBSnapshot!.aVerdict, "exclude");
    assert.equal(itemBSnapshot!.bVerdict, "include");

    const round1AfterApply = (await getAllRounds(project.id)).find(
      (r) => r.id === round1.id,
    )!;
    assert.equal(round1AfterApply.status, "reconciled");
    // "Latest" tracks the most recently STARTED round (round2), not the
    // most recently acted-on one -- round1 being reconciled doesn't change
    // it.
    assert.equal((await getLatestRound(project.id))!.id, round2.id);

    // Starting yet another round samples fresh from whatever's currently
    // in TA-Screen Queue: itemA left (its agreed result got applied);
    // itemB's unresolved disagreement, round2's own never-collected
    // sample, and the rest are all still sitting there and so are fair
    // game to resample.
    const round3Zip = tempPath(`hc-round3-${Date.now()}.zip`);
    const round3 = await startRound(project.id, 100, round3Zip);
    assert.equal(round3.itemKeys.length, 4);
    assert.notInclude(round3.itemKeys, itemA.key);
    assert.include(round3.itemKeys, itemB.key);
  });

  it("applyAgreedResults: an FT-origin agreed exclude reconstructs structured ft_criterion_checks rows (so it still counts in PRISMA's itemized reasons breakdown); a TA-origin agreed exclude does not", async function () {
    const project = await createProject(
      `Human Consistency FT Reasons Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    // ftItem: both reviewers TA-included it, then excluded it at FT after
    // reading the full text -- their own confirmed exclusion criteria
    // overlap but aren't identical, so the reconstruction must dedupe.
    const ftItem = await makeTestItem("FT-Origin Exclude Item");
    // taItem: both reviewers TA-excluded it outright -- never reached FT,
    // so there's no criteria information to reconstruct.
    const taItem = await makeTestItem("TA-Origin Exclude Item");
    for (const item of [ftItem, taItem]) {
      item.addToCollection(collections.taQueueId);
      await item.saveTx();
    }

    const csvAPath = tempPath(`hc-ftreason-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-ftreason-b-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        {
          title: ftItem.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: ftItem.getField("title") as string,
          stage: "ft_screening",
          decision: "exclude",
          exclusionReason: "Wrong population; Not RCT",
        },
        {
          title: taItem.getField("title") as string,
          stage: "ta_screening",
          decision: "exclude",
        },
      ]),
    );
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPath),
      reviewerCsv("222", [
        {
          title: ftItem.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: ftItem.getField("title") as string,
          stage: "ft_screening",
          decision: "exclude",
          exclusionReason: "Wrong population",
        },
        {
          title: taItem.getField("title") as string,
          stage: "ta_screening",
          decision: "exclude",
        },
      ]),
    );

    const round = await startRound(
      project.id,
      100,
      tempPath(`hc-ftreason-pilot-${Date.now()}.zip`),
    );
    await recordCollectedCsv(round.id, "a", csvAPath);
    const finalRound = await recordCollectedCsv(round.id, "b", csvBPath);

    const summary = await applyAgreedResults(finalRound);
    assert.equal(summary.applied, 2);
    assert.equal(summary.disagreed, 0);

    // ftItem: TA gate cleared, then structured, confirmed criterion checks
    // reconstructed from the union of both reviewers' reported fragments
    // ("Wrong population" is shared, "Not RCT" only reported by A).
    assert.isTrue(ftItem.inCollection(collections.taIncludeId));
    assert.isTrue(ftItem.inCollection(collections.ftExcludeId));
    const ftChecks = await getCriterionChecks(project.id, ftItem.key);
    assert.equal(ftChecks.length, 2);
    assert.sameMembers(
      ftChecks.map((c) => c.criterionText),
      ["Wrong population", "Not RCT"],
    );
    for (const check of ftChecks) {
      assert.equal(check.criterionType, "exclusion");
      assert.equal(check.verdict, "exclude");
      assert.isTrue(check.confirmed);
    }

    // taItem: plain TA-exclude, no full text ever read -- no criteria to
    // reconstruct.
    assert.isTrue(taItem.inCollection(collections.taExcludeId));
    assert.equal((await getCriterionChecks(project.id, taItem.key)).length, 0);

    // PRISMA's itemized exclusion-reasons breakdown picks up the
    // reconstructed ftItem checks, but has nothing for taItem (it was
    // never assessed for eligibility at all).
    const prisma = await computePrismaData(project.id);
    assert.sameDeepMembers(prisma.eligibility.reasons, [
      { reason: "Wrong population", count: 1 },
      { reason: "Not RCT", count: 1 },
    ]);
  });

  it("computeRoundConsistency treats a reviewer who TA-passed an item but hasn't finished FT screening it yet as 'no verdict', not a guess", async function () {
    const project = await createProject(
      `Human Consistency Pending FT Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Pending FT Item");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();
    const title = item.getField("title") as string;

    const csvAPath = tempPath(`hc-pending-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-pending-b-${Date.now()}.csv`);
    // A TA-included it but the CSV has no ft_screening row yet (still
    // mid-way through their own full-text screening when they exported).
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        { title, stage: "ta_screening", decision: "include" },
      ]),
    );
    // B finished both stages.
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPath),
      reviewerCsv("222", [
        { title, stage: "ta_screening", decision: "include" },
        { title, stage: "ft_screening", decision: "exclude" },
      ]),
    );

    const round = await startRound(
      project.id,
      100,
      tempPath(`hc-pending-pilot-${Date.now()}.zip`),
    );
    await recordCollectedCsv(round.id, "a", csvAPath);
    const finalRound = await recordCollectedCsv(round.id, "b", csvBPath);

    const result = await computeRoundConsistency(finalRound);
    assert.equal(result.n, 0); // the incomplete pair doesn't count toward n
    const itemResult = result.items.find((it) => it.itemKey === item.key)!;
    assert.isNull(itemResult.aDecision);
    assert.equal(itemResult.bDecision, "exclude");
  });

  it("computeRoundConsistency matches by DOI (across both stages) even when the two reviewers' CSVs disagree on the title text, and falls back to title when no DOI is available", async function () {
    const project = await createProject(
      `Human Consistency DOI Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    // itemWithDoi: both reviewers' CSVs carry a garbled/mismatched title
    // for it at BOTH stages (simulating hand-edited CSVs), but the same
    // DOI (differently formatted -- one with a doi.org URL prefix, one
    // bare, one uppercased) -- normalizeDOI() should still line them up
    // stage by stage.
    const itemWithDoi = await makeTestItem(
      "The Real Title",
      "10.1000/Example.DOI",
    );
    // itemNoDoi: no DOI on the item or in either CSV -- must still match
    // by title as before, and never proceeds to FT since both TA-exclude.
    const itemNoDoi = await makeTestItem("Plain Title No DOI");

    for (const item of [itemWithDoi, itemNoDoi]) {
      item.addToCollection(collections.taQueueId);
      await item.saveTx();
    }

    const csvAPath = tempPath(`hc-doi-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-doi-b-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        {
          title: "Reviewer A's garbled TA title",
          doi: "https://doi.org/10.1000/example.doi",
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: "Reviewer A's garbled FT title",
          doi: "https://doi.org/10.1000/example.doi",
          stage: "ft_screening",
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
          title: "Reviewer B's totally different garbled TA title",
          doi: "10.1000/EXAMPLE.DOI",
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: "Reviewer B's totally different garbled FT title",
          doi: "10.1000/EXAMPLE.DOI",
          stage: "ft_screening",
          decision: "include",
        },
        {
          title: "Plain Title No DOI",
          stage: "ta_screening",
          decision: "exclude",
        },
      ]),
    );

    const round = await startRound(
      project.id,
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
    // Neither CSV's title matches the item's real title (nor each other)
    // at either stage, so this only resolves if the DOI match won at
    // both TA and FT.
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
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    const zip = tempPath(`hc-incomplete-${Date.now()}.zip`);
    const round = await startRound(project.id, 100, zip);

    let threw = false;
    try {
      await computeRoundConsistency(round);
    } catch {
      threw = true;
    }
    assert.isTrue(threw);
  });
});
