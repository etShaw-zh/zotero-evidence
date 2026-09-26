import { assert } from "chai";
import { toCsvLine } from "../src/utils/csv";
import { databaseService } from "../src/modules/db/database";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { getCriterionChecks } from "../src/modules/screening/ftCriterionCheckService";
import { computePrismaData } from "../src/modules/export/screeningExport";
import { getConsistencyItemResult } from "../src/modules/consistency/consistencyItemResultsService";
import { isDisagreementFlagged } from "../src/modules/consistency/disagreementFlagService";
import { exportProjectArchive } from "../src/modules/archive/archiveExportService";
import { importProjectArchive } from "../src/modules/archive/archiveImportService";
import { unzipToDirectory } from "../src/modules/archive/zipUtil";
import { MANIFEST_FILENAME } from "../src/modules/archive/archiveTypes";
import { getStableItemId } from "../src/utils/stableItemId";
import {
  applyAgreedResults,
  computeRoundConsistency,
  getAllRounds,
  getLatestRound,
  HumanConsistencyResult,
  recordCollectedCsv,
  recoverRoundFromArchive,
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
    // "" (the default) exercises the same doi/title fallback path as a CSV
    // exported before this column existed -- see stableItemId.ts.
    stableId?: string;
    stage: "ta_screening" | "ft_screening";
    decision: string;
    exclusionReason?: string;
  }[],
): string {
  const lines = [
    "item_key,project_item_id,title,doi,stage,ai_decision,ai_reasoning,ai_model,human_decision,exclusion_reason,decided_by,decided_at,fulltext_ready",
  ];
  for (const r of rows) {
    lines.push(
      toCsvLine([
        "",
        r.stableId ?? "",
        r.title,
        r.doi ?? "",
        r.stage,
        "",
        "",
        "",
        r.decision,
        r.exclusionReason ?? "",
        decidedBy,
        "2026-01-01T00:00:00.000Z",
        "0",
      ]),
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

    // itemB is also flagged with the visible-in-the-items-list disagreement
    // tag; the agreed itemA is not (confirmTaDecision cleared it as part of
    // finalizing its own decision). Deliberately not confirming a decision
    // on itemB here to check the flag clears -- see screening.test.ts for
    // that -- itemB needs to stay in TA-Screen Queue for round3's resample
    // assertions further down.
    assert.isTrue(isDisagreementFlagged(itemB));
    assert.isFalse(isDisagreementFlagged(itemA));

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

  it("applyAgreedResults: an agreed FT-unavailable lands in FT-Unavailable (via markUnavailable), not a reasonless FT-Exclude; a mixed unavailable+content-exclude prefers the content-based exclude", async function () {
    const project = await createProject(
      `Human Consistency FT Unavailable Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    // bothUnavailable: both reviewers TA-included it, but neither could
    // retrieve the full text.
    const bothUnavailable = await makeTestItem("Both Unavailable Item");
    // mixed: A couldn't retrieve it, but B did and excluded it on content --
    // the content-based call should win over "unavailable".
    const mixed = await makeTestItem("Mixed Unavailable Item");
    for (const item of [bothUnavailable, mixed]) {
      item.addToCollection(collections.taQueueId);
      await item.saveTx();
    }

    const csvAPath = tempPath(`hc-unavailable-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-unavailable-b-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        {
          title: bothUnavailable.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: bothUnavailable.getField("title") as string,
          stage: "ft_screening",
          decision: "unavailable",
        },
        {
          title: mixed.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: mixed.getField("title") as string,
          stage: "ft_screening",
          decision: "unavailable",
        },
      ]),
    );
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPath),
      reviewerCsv("222", [
        {
          title: bothUnavailable.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: bothUnavailable.getField("title") as string,
          stage: "ft_screening",
          decision: "unavailable",
        },
        {
          title: mixed.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: mixed.getField("title") as string,
          stage: "ft_screening",
          decision: "exclude",
          exclusionReason: "Wrong population",
        },
      ]),
    );

    const round = await startRound(
      project.id,
      100,
      tempPath(`hc-unavailable-pilot-${Date.now()}.zip`),
    );
    await recordCollectedCsv(round.id, "a", csvAPath);
    const finalRound = await recordCollectedCsv(round.id, "b", csvBPath);

    const summary = await applyAgreedResults(finalRound);
    assert.equal(summary.applied, 2);
    assert.equal(summary.disagreed, 0);

    // bothUnavailable: TA gate cleared, then FT-Unavailable -- NOT
    // FT-Exclude -- with no criterion checks (never assessed).
    assert.isTrue(bothUnavailable.inCollection(collections.taIncludeId));
    assert.isTrue(bothUnavailable.inCollection(collections.ftUnavailableId));
    assert.isFalse(bothUnavailable.inCollection(collections.ftExcludeId));
    assert.equal(
      (await getCriterionChecks(project.id, bothUnavailable.key)).length,
      0,
    );

    // mixed: the content-based exclude (B's) wins -- lands in FT-Exclude
    // with B's reason reconstructed, not FT-Unavailable.
    assert.isTrue(mixed.inCollection(collections.taIncludeId));
    assert.isTrue(mixed.inCollection(collections.ftExcludeId));
    assert.isFalse(mixed.inCollection(collections.ftUnavailableId));
    const mixedChecks = await getCriterionChecks(project.id, mixed.key);
    assert.equal(mixedChecks.length, 1);
    assert.equal(mixedChecks[0].criterionText, "Wrong population");

    // PRISMA's retrieval box picks up bothUnavailable as not_retrieved,
    // and mixed as assessed-for-eligibility-and-excluded, not the other
    // way around.
    const prisma = await computePrismaData(project.id);
    assert.equal(prisma.retrieval.notRetrieved, 1);
    assert.equal(prisma.eligibility.assessedForEligibility, 1);
    assert.equal(prisma.eligibility.excluded, 1);
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

  it("computeRoundConsistency reports TA-stage and FT-stage kappa separately from raw per-stage decisions, never pooled with each other or with the collapsed final-verdict kappa -- and an item where only one reviewer reached FT is counted for TA but excluded from FT", async function () {
    const project = await createProject(
      `Human Consistency Stage Kappa Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    // Both TA-include, then disagree at FT.
    const item1 = await makeTestItem("Stage Kappa Item 1");
    // A TA-excludes outright (never reaches FT); B TA-unclears through to
    // FT-include -- only A+B's TA rows form a pair here, not FT.
    const item2 = await makeTestItem("Stage Kappa Item 2");
    // Both TA-unclear, then both agree FT-exclude.
    const item3 = await makeTestItem("Stage Kappa Item 3");
    for (const item of [item1, item2, item3]) {
      item.addToCollection(collections.taQueueId);
      await item.saveTx();
    }

    const round = await startRound(
      project.id,
      100,
      tempPath(`hc-stagekappa-${Date.now()}.zip`),
    );
    const csvAPath = tempPath(`hc-stagekappa-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-stagekappa-b-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        {
          title: "Stage Kappa Item 1",
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: "Stage Kappa Item 1",
          stage: "ft_screening",
          decision: "include",
        },
        {
          title: "Stage Kappa Item 2",
          stage: "ta_screening",
          decision: "exclude",
        },
        {
          title: "Stage Kappa Item 3",
          stage: "ta_screening",
          decision: "unclear",
        },
        {
          title: "Stage Kappa Item 3",
          stage: "ft_screening",
          decision: "exclude",
        },
      ]),
    );
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPath),
      reviewerCsv("222", [
        {
          title: "Stage Kappa Item 1",
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: "Stage Kappa Item 1",
          stage: "ft_screening",
          decision: "exclude",
        },
        {
          title: "Stage Kappa Item 2",
          stage: "ta_screening",
          decision: "unclear",
        },
        {
          title: "Stage Kappa Item 2",
          stage: "ft_screening",
          decision: "include",
        },
        {
          title: "Stage Kappa Item 3",
          stage: "ta_screening",
          decision: "unclear",
        },
        {
          title: "Stage Kappa Item 3",
          stage: "ft_screening",
          decision: "exclude",
        },
      ]),
    );
    await recordCollectedCsv(round.id, "a", csvAPath);
    const finalRound = await recordCollectedCsv(round.id, "b", csvBPath);

    const result = await computeRoundConsistency(finalRound);

    // TA pairs: (include,include), (exclude,unclear), (unclear,unclear) --
    // all 3 items, since every item has a TA row from both reviewers.
    assert.equal(result.ta.n, 3);
    assert.approximately(result.ta.kappa!, 0.5, 1e-9);
    assert.sameMembers(
      result.ta.byCategory.map((c) => c.category),
      ["include", "exclude", "unclear"],
    );

    // FT pairs: (include,exclude) from item1, (exclude,exclude) from item3
    // -- item2 is excluded because A never reached FT (TA-excluded), even
    // though B did.
    assert.equal(result.ft.n, 2);
    assert.approximately(result.ft.kappa!, 0, 1e-9);
    assert.sameMembers(
      result.ft.byCategory.map((c) => c.category),
      ["include", "exclude"],
    );

    // The collapsed final-verdict kappa is its own separate thing, not a
    // pooling of the two stage kappas above.
    assert.equal(result.n, 3);
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

  it("computeRoundConsistency matches by stable id (project_item_id) even when BOTH title and DOI disagree between the two reviewers' CSVs and the item itself", async function () {
    const project = await createProject(
      `Human Consistency Stable Id Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Original Title", "10.1000/original");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    const zip = tempPath(`hc-stableid-${Date.now()}.zip`);
    const round = await startRound(project.id, 100, zip);
    // startRound's export (via exportProjectArchive) is what mints the
    // item's stable id in the first place -- see stableItemId.ts.
    const stableId = await getStableItemId(project.id, item.key);
    assert.notEqual(stableId, "");

    const csvAPath = tempPath(`hc-stableid-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-stableid-b-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        {
          title: "A totally different, garbled title",
          doi: "10.9999/not-the-real-doi",
          stableId,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: "A's garbled FT title",
          doi: "10.9999/not-the-real-doi",
          stableId,
          stage: "ft_screening",
          decision: "include",
        },
      ]),
    );
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPath),
      reviewerCsv("222", [
        {
          title: "Yet another different garbled title",
          doi: "10.8888/also-not-the-real-doi",
          stableId,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: "B's garbled FT title",
          doi: "10.8888/also-not-the-real-doi",
          stableId,
          stage: "ft_screening",
          decision: "include",
        },
      ]),
    );

    await recordCollectedCsv(round.id, "a", csvAPath);
    const finalRound = await recordCollectedCsv(round.id, "b", csvBPath);
    const result = await computeRoundConsistency(finalRound);

    const itemResult = result.items.find((it) => it.itemKey === item.key)!;
    assert.equal(itemResult.aDecision, "include");
    assert.equal(itemResult.bDecision, "include");
  });

  it("recoverRoundFromArchive reconstructs a round (against a DIFFERENT, independently re-imported copy of the project) from a sample archive and reviewer CSVs whose own round bookkeeping was lost -- matching by DOI/title exactly like a pre-stable-id sample archive would have to", async function () {
    const origin = await createProject(
      `Human Consistency Recover Origin ${Date.now()}`,
    );
    const originCollections = resolveProjectCollections(
      getRootCollectionId(origin)!,
    );
    const withDoi = await makeTestItem(
      "Recoverable Item With DOI",
      "10.1000/recoverable",
    );
    const withoutDoi = await makeTestItem("Recoverable Item No DOI");
    for (const item of [withDoi, withoutDoi]) {
      item.addToCollection(originCollections.taQueueId);
      await item.saveTx();
    }

    const sampleZipPath = tempPath(`hc-recover-sample-${Date.now()}.zip`);
    const originRound = await startRound(origin.id, 100, sampleZipPath);
    assert.equal(originRound.itemKeys.length, 2);

    // Strips the stable id back out of the sample archive's own manifest,
    // so this test actually exercises the doi/title fallback -- the
    // situation a sample archive made before ArchiveItem.stableId existed
    // (e.g. the user's real archived sample) is permanently stuck in.
    const stagingDir = Zotero.getTempDirectory() as any;
    stagingDir.append(`hc-recover-strip-${Date.now()}`);
    unzipToDirectory(sampleZipPath, stagingDir.path);
    const manifestFile = Zotero.File.pathToFile(stagingDir.path) as any;
    manifestFile.append(MANIFEST_FILENAME);
    const manifest = JSON.parse(
      (await Zotero.File.getContentsAsync(manifestFile.path)) as string,
    );
    for (const archived of manifest.items) {
      archived.stableId = "";
    }
    await Zotero.File.putContentsAsync(
      manifestFile.path,
      JSON.stringify(manifest),
    );
    const strippedSampleZipPath = tempPath(
      `hc-recover-sample-stripped-${Date.now()}.zip`,
    );
    await Zotero.File.zipDirectory(stagingDir.path, strippedSampleZipPath, {});

    // Reviewer CSVs -- no project_item_id column value (stableId left
    // unset), same as a CSV exported against an item that never got a
    // stable id.
    const csvAPath = tempPath(`hc-recover-a-${Date.now()}.csv`);
    const csvBPath = tempPath(`hc-recover-b-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        {
          title: "Recoverable Item With DOI",
          doi: "10.1000/recoverable",
          stage: "ta_screening",
          decision: "include",
        },
        // TA-include requires an FT row to derive a final verdict (see
        // deriveFinalVerdict) -- without this, the item's verdict stays
        // null and it's excluded from n rather than counted as an
        // agreement, same rule computeRoundConsistency's other tests cover.
        {
          title: "Recoverable Item With DOI",
          doi: "10.1000/recoverable",
          stage: "ft_screening",
          decision: "include",
        },
        {
          title: "Recoverable Item No DOI",
          stage: "ta_screening",
          decision: "exclude",
        },
      ]),
    );
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPath),
      reviewerCsv("222", [
        {
          title: "Recoverable Item With DOI",
          doi: "10.1000/recoverable",
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: "Recoverable Item With DOI",
          doi: "10.1000/recoverable",
          stage: "ft_screening",
          decision: "include",
        },
        {
          title: "Recoverable Item No DOI",
          stage: "ta_screening",
          decision: "exclude",
        },
      ]),
    );

    // Simulates "the origin project was later backed up and restored on a
    // different machine" -- an independent copy with an entirely different
    // item_key space, same as importProjectArchive always produces.
    const fullZipPath = tempPath(`hc-recover-full-${Date.now()}.zip`);
    await exportProjectArchive(origin.id, fullZipPath);
    const restored = await importProjectArchive(fullZipPath);
    const restoredCollections = resolveProjectCollections(
      getRootCollectionId(restored)!,
    );
    const restoredItems = (
      Zotero.Collections.get(restoredCollections.taQueueId) as Zotero.Collection
    ).getChildItems();
    assert.equal(restoredItems.length, 2);
    assert.isFalse(
      restoredItems.some((it) => originRound.itemKeys.includes(it.key)),
      "the restored project must have a completely different key space",
    );

    const recovery = await recoverRoundFromArchive(
      restored.id,
      strippedSampleZipPath,
      csvAPath,
      csvBPath,
    );
    assert.deepEqual(recovery.unmatchedTitles, []);
    assert.equal(recovery.totalSampled, 2);
    assert.equal(recovery.matchedCount, 2);
    assert.equal(recovery.round.status, "collected");
    assert.equal(recovery.round.itemKeys.length, 2);
    for (const key of recovery.round.itemKeys) {
      assert.isTrue(restoredItems.some((it) => it.key === key));
    }

    const result = await computeRoundConsistency(recovery.round);
    assert.equal(result.n, 2);
    assert.equal(result.observedAgreement, 1);
  });

  it("applyAgreedResults is safe to call again on the same round: already-resolved items (agreed-include, agreed-exclude, and an FT-origin agreed-exclude) are skipped rather than reprocessed, while an item that only just became resolvable (a reviewer finished FT screening it since the first call) gets applied for the first time", async function () {
    const project = await createProject(
      `Human Consistency Idempotent Apply Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    const agreedInclude = await makeTestItem("Idempotent Agreed Include");
    const agreedFtExclude = await makeTestItem("Idempotent FT-Origin Exclude");
    const disagreed = await makeTestItem("Idempotent Disagreement");
    // Both reviewers TA-included it, but only A has finished FT screening
    // it by the time the round is first applied -- same shape as 龙 still
    // being mid-way through FT screening in the real scenario this guards
    // against.
    const pending = await makeTestItem("Idempotent Pending FT");
    for (const item of [agreedInclude, agreedFtExclude, disagreed, pending]) {
      item.addToCollection(collections.taQueueId);
      await item.saveTx();
    }

    const zip = tempPath(`hc-idempotent-${Date.now()}.zip`);
    const round = await startRound(project.id, 100, zip);
    assert.equal(round.itemKeys.length, 4);

    const csvAPath = tempPath(`hc-idempotent-a-${Date.now()}.csv`);
    const csvBPathRound1 = tempPath(`hc-idempotent-b1-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvAPath),
      reviewerCsv("111", [
        {
          title: agreedInclude.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: agreedInclude.getField("title") as string,
          stage: "ft_screening",
          decision: "include",
        },
        {
          title: agreedFtExclude.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: agreedFtExclude.getField("title") as string,
          stage: "ft_screening",
          decision: "exclude",
          exclusionReason: "Wrong population",
        },
        {
          title: disagreed.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: disagreed.getField("title") as string,
          stage: "ft_screening",
          decision: "include",
        },
        {
          title: pending.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: pending.getField("title") as string,
          stage: "ft_screening",
          decision: "include",
        },
      ]),
    );
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPathRound1),
      reviewerCsv("222", [
        {
          title: agreedInclude.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: agreedInclude.getField("title") as string,
          stage: "ft_screening",
          decision: "include",
        },
        {
          title: agreedFtExclude.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: agreedFtExclude.getField("title") as string,
          stage: "ft_screening",
          decision: "exclude",
          exclusionReason: "Wrong population",
        },
        {
          title: disagreed.getField("title") as string,
          stage: "ta_screening",
          decision: "exclude",
        },
        // pending: TA only -- B hasn't reached FT for it yet.
        {
          title: pending.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
      ]),
    );
    await recordCollectedCsv(round.id, "a", csvAPath);
    const round1 = await recordCollectedCsv(round.id, "b", csvBPathRound1);
    assert.equal(round1.status, "collected");

    const summary1 = await applyAgreedResults(round1);
    assert.equal(summary1.applied, 2); // agreedInclude, agreedFtExclude
    assert.equal(summary1.disagreed, 2); // disagreed (real) + pending (no verdict yet)

    assert.isTrue(agreedInclude.inCollection(collections.ftIncludeId));
    assert.isTrue(agreedFtExclude.inCollection(collections.ftExcludeId));
    assert.isTrue(disagreed.inCollection(collections.taQueueId));
    assert.isTrue(pending.inCollection(collections.taQueueId));

    const ftChecksAfterFirst = await getCriterionChecks(
      project.id,
      agreedFtExclude.key,
    );
    assert.equal(ftChecksAfterFirst.length, 1);
    const screeningRowCountAfterFirst = (
      (await databaseService.queryAsync(
        `SELECT COUNT(*) as n FROM screening_records WHERE project_id = ? AND item_key = ?`,
        [project.id, agreedInclude.key],
      )) as { n: number }[]
    )[0].n;

    // Re-running the exact same round unchanged: the two already-resolved
    // items must be skipped entirely (no new rows) -- only the two items
    // still actually sitting in TA-Screen Queue (the real disagreement and
    // the still-unresolved `pending`) get recomputed and re-flagged, same
    // outcome as before.
    const summaryRepeat = await applyAgreedResults(round1);
    assert.equal(summaryRepeat.applied, 0);
    assert.equal(summaryRepeat.disagreed, 2);
    assert.equal(
      (await getCriterionChecks(project.id, agreedFtExclude.key)).length,
      ftChecksAfterFirst.length,
      "re-running must not duplicate ft_criterion_checks rows",
    );
    assert.equal(
      (
        (await databaseService.queryAsync(
          `SELECT COUNT(*) as n FROM screening_records WHERE project_id = ? AND item_key = ?`,
          [project.id, agreedInclude.key],
        )) as { n: number }[]
      )[0].n,
      screeningRowCountAfterFirst,
      "re-running must not duplicate screening_records rows for an already-resolved item",
    );
    const prismaAfterRepeat = await computePrismaData(project.id);
    assert.sameDeepMembers(prismaAfterRepeat.eligibility.reasons, [
      { reason: "Wrong population", count: 1 },
    ]);

    // B finishes FT screening `pending` (agreeing with A) and re-exports --
    // recordCollectedCsv can just point the SAME round at the new file.
    const csvBPathRound2 = tempPath(`hc-idempotent-b2-${Date.now()}.csv`);
    Zotero.File.putContents(
      Zotero.File.pathToFile(csvBPathRound2),
      reviewerCsv("222", [
        {
          title: agreedInclude.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: agreedInclude.getField("title") as string,
          stage: "ft_screening",
          decision: "include",
        },
        {
          title: agreedFtExclude.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: agreedFtExclude.getField("title") as string,
          stage: "ft_screening",
          decision: "exclude",
          exclusionReason: "Wrong population",
        },
        {
          title: disagreed.getField("title") as string,
          stage: "ta_screening",
          decision: "exclude",
        },
        {
          title: pending.getField("title") as string,
          stage: "ta_screening",
          decision: "include",
        },
        {
          title: pending.getField("title") as string,
          stage: "ft_screening",
          decision: "include",
        },
      ]),
    );
    const round2 = await recordCollectedCsv(round.id, "b", csvBPathRound2);

    const summary2 = await applyAgreedResults(round2);
    assert.equal(summary2.applied, 1); // pending, newly resolvable
    assert.equal(summary2.disagreed, 1); // disagreed, still a real disagreement
    assert.isTrue(pending.inCollection(collections.ftIncludeId));
    assert.isFalse(pending.inCollection(collections.taQueueId));
    // The two already-resolved items are still untouched.
    assert.equal(
      (await getCriterionChecks(project.id, agreedFtExclude.key)).length,
      ftChecksAfterFirst.length,
    );
    assert.equal(
      (
        (await databaseService.queryAsync(
          `SELECT COUNT(*) as n FROM screening_records WHERE project_id = ? AND item_key = ?`,
          [project.id, agreedInclude.key],
        )) as { n: number }[]
      )[0].n,
      screeningRowCountAfterFirst,
    );
  });
});
