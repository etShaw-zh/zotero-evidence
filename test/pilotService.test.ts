import { assert } from "chai";
import {
  getLatestCodebook,
  saveCodebook,
} from "../src/modules/coding/codebookService";
import { addManualRecord } from "../src/modules/coding/codingService";
import {
  completePilotRound,
  getActivePilotRound,
  getPilotRecords,
  getPilotRoundForItem,
  reviewPilotEdit,
  reviewPilotLink,
  sampleRandom,
  startPilotRound,
} from "../src/modules/coding/pilotService";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

async function makeFtIncludeProject(
  name: string,
  ftIncludeCount: number,
): Promise<{
  projectId: number;
  collections: ReturnType<typeof resolveProjectCollections>;
  items: Zotero.Item[];
}> {
  const project = await createProject(name);
  const collections = resolveProjectCollections(getRootCollectionId(project)!);
  const items: Zotero.Item[] = [];
  for (let i = 0; i < ftIncludeCount; i++) {
    const item = await makeTestItem(`${name} Item ${i}`);
    item.addToCollection(collections.ftIncludeId);
    await item.saveTx();
    items.push(item);
  }
  return { projectId: project.id, collections, items };
}

describe("Phase 5: pilotService", function () {
  this.timeout(60000);

  describe("sampleRandom (pure)", function () {
    it("returns exactly n items when the pool is large enough", function () {
      const pool = Array.from({ length: 20 }, (_, i) => i);
      const sample = sampleRandom(pool, 5);
      assert.equal(sample.length, 5);
      // No duplicates.
      assert.equal(new Set(sample).size, 5);
      // All drawn from the pool.
      for (const s of sample) assert.include(pool, s);
    });

    it("caps at the pool size when n exceeds it", function () {
      const pool = [1, 2, 3];
      const sample = sampleRandom(pool, 10);
      assert.equal(sample.length, 3);
      assert.sameMembers(sample, pool);
    });

    it("returns an empty array for n=0 or an empty pool", function () {
      assert.deepEqual(sampleRandom([1, 2, 3], 0), []);
      assert.deepEqual(sampleRandom([], 5), []);
    });
  });

  it("startPilotRound samples from FT-Include, capped at availability", async function () {
    const { projectId, items } = await makeFtIncludeProject(
      `Pilot Sample Test ${Date.now()}`,
      3,
    );
    await saveCodebook(projectId, [
      { name: "x", type: "text", required: true },
    ]);

    const round = await startPilotRound(projectId, 10);
    assert.equal(round.roundNumber, 1);
    assert.equal(round.status, "in_progress");
    assert.equal(round.sampleItemKeys.length, 3);
    assert.sameMembers(
      round.sampleItemKeys,
      items.map((i) => i.key),
    );
  });

  it("startPilotRound refuses to run without a configured Codebook", async function () {
    const { projectId } = await makeFtIncludeProject(
      `Pilot No Codebook Test ${Date.now()}`,
      2,
    );
    let threw = false;
    try {
      await startPilotRound(projectId, 5);
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /codebook/i);
    }
    assert.isTrue(threw);
  });

  it("startPilotRound refuses to start a second active round", async function () {
    const { projectId } = await makeFtIncludeProject(
      `Pilot Active Guard Test ${Date.now()}`,
      3,
    );
    await saveCodebook(projectId, [{ name: "x", type: "text" }]);
    await startPilotRound(projectId, 2);

    let threw = false;
    try {
      await startPilotRound(projectId, 2);
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /progress/i);
    }
    assert.isTrue(threw);
  });

  it("round_number increments across sequential (completed) rounds", async function () {
    const { projectId } = await makeFtIncludeProject(
      `Pilot Round Increment Test ${Date.now()}`,
      3,
    );
    await saveCodebook(projectId, [{ name: "x", type: "text" }]);

    const first = await startPilotRound(projectId, 2);
    assert.equal(first.roundNumber, 1);
    await completePilotRound(first.id);

    const second = await startPilotRound(projectId, 2);
    assert.equal(second.roundNumber, 2);
  });

  it("getPilotRoundForItem identifies sampled vs non-sampled items", async function () {
    const { projectId, items } = await makeFtIncludeProject(
      `Pilot Item Membership Test ${Date.now()}`,
      2,
    );
    await saveCodebook(projectId, [{ name: "x", type: "text" }]);
    const round = await startPilotRound(projectId, 2);

    const inRound = await getPilotRoundForItem(projectId, items[0].key);
    assert.equal(inRound?.id, round.id);

    const notInRound = await getPilotRoundForItem(projectId, "NOTAKEY99");
    assert.isNull(notInRound);
  });

  it("reviewPilotLink captures ai_value===human_value (accepted as-is) and links the annotation", async function () {
    const { projectId, collections, items } = await makeFtIncludeProject(
      `Pilot Review Link Test ${Date.now()}`,
      1,
    );
    const codebook = await saveCodebook(projectId, [
      { name: "study_design", type: "categorical", values: ["RCT"] },
    ]);
    const round = await startPilotRound(projectId, 1);
    const item = items[0];

    const recordId = await addManualRecord(
      projectId,
      item,
      codebook.id,
      "study_design",
      "RCT",
      null,
      "an RCT",
      true,
    );
    const [record] = await getPilotRecords(projectId, item.key);
    assert.equal(record.id, recordId);

    // Fake annotation key -- we're only checking that linking runs and
    // consistency is captured, not exercising the annotation subsystem
    // itself (covered by coding.test.ts / ftScreening.test.ts already).
    await reviewPilotLink(round.id, item.key, record, "FAKEANNOTKEY01");

    const afterLink = await getPilotRecords(projectId, item.key);
    assert.isTrue(afterLink[0].confirmed);
    assert.equal(afterLink[0].annotationKey, "FAKEANNOTKEY01");

    void collections;
  });

  it("reviewPilotEdit captures the pre-edit AI value vs the corrected value, once", async function () {
    const { projectId, items } = await makeFtIncludeProject(
      `Pilot Review Edit Test ${Date.now()}`,
      1,
    );
    const codebook = await saveCodebook(projectId, [
      { name: "sample_size", type: "numeric" },
    ]);
    const round = await startPilotRound(projectId, 1);
    const item = items[0];

    const recordId = await addManualRecord(
      projectId,
      item,
      codebook.id,
      "sample_size",
      "100",
      null,
      null,
      true,
    );
    const [aiRecord] = await getPilotRecords(projectId, item.key);
    assert.equal(aiRecord.variableValue, "100");

    await reviewPilotEdit(
      round.id,
      item.key,
      item,
      aiRecord,
      "sample_size",
      "156",
    );

    const afterEdit = await getPilotRecords(projectId, item.key);
    assert.equal(afterEdit[0].variableValue, "156");
    assert.isTrue(afterEdit[0].confirmed);

    // Editing again should NOT create a second consistency_records entry
    // for the same variable -- verified indirectly via completePilotRound
    // seeing exactly 1 comparison for this variable.
    await reviewPilotEdit(
      round.id,
      item.key,
      item,
      afterEdit[0],
      "sample_size",
      "200",
    );
    const summary = await completePilotRound(round.id);
    const sizeSummary = summary.find((s) => s.variableName === "sample_size");
    assert.equal(sizeSummary?.nItems, 1);
  });

  it("completePilotRound computes Kappa correctly and picks the metric by variable type", async function () {
    const { projectId, items } = await makeFtIncludeProject(
      `Pilot Complete Test ${Date.now()}`,
      2,
    );
    const codebook = await saveCodebook(projectId, [
      { name: "study_design", type: "categorical", values: ["RCT", "Cohort"] },
      { name: "sample_size", type: "numeric" },
    ]);
    const round = await startPilotRound(projectId, 2);

    // categorical: perfect agreement -> kappa = 1
    for (const item of items) {
      const id = await addManualRecord(
        projectId,
        item,
        codebook.id,
        "study_design",
        "RCT",
        null,
        null,
        true,
      );
      const [record] = (await getPilotRecords(projectId, item.key)).filter(
        (r) => r.id === id,
      );
      await reviewPilotLink(round.id, item.key, record, "FAKEKEY");
    }

    // numeric: AI said 100 both times, human corrected to 100 and 102 ->
    // not perfect but a specific computable Kappa.
    const humanValues = ["100", "102"];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = await addManualRecord(
        projectId,
        item,
        codebook.id,
        "sample_size",
        "100",
        null,
        null,
        true,
      );
      const [record] = (await getPilotRecords(projectId, item.key)).filter(
        (r) => r.id === id,
      );
      await reviewPilotEdit(
        round.id,
        item.key,
        item,
        record,
        "sample_size",
        humanValues[i],
      );
    }

    const summary = await completePilotRound(round.id);

    const designSummary = summary.find(
      (s) => s.variableName === "study_design",
    );
    assert.equal(designSummary?.metric, "cohen_kappa");
    assert.equal(designSummary?.kappaValue, 1);
    assert.equal(designSummary?.nItems, 2);

    const sizeSummary = summary.find((s) => s.variableName === "sample_size");
    assert.equal(sizeSummary?.metric, "weighted_cohen_kappa");
    assert.equal(sizeSummary?.nItems, 2);
    assert.isNotNull(sizeSummary?.kappaValue);

    const active = await getActivePilotRound(projectId);
    assert.isNull(active);
  });
});
