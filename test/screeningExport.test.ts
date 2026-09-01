import { assert } from "chai";
import { databaseService } from "../src/modules/db/database";
import { processImportedItems } from "../src/modules/dedup/dedupService";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import {
  computePrismaData,
  exportScreeningLog,
  formatPrismaCsv,
  PrismaData,
} from "../src/modules/export/screeningExport";
import { confirmDecision as taConfirmDecision } from "../src/modules/screening/taScreeningService";
import {
  confirmDecision as ftConfirmDecision,
  markUnavailable,
} from "../src/modules/screening/ftScreeningService";

// processImportedItems (like the real Zotero.Translate.Import path it
// normally consumes) expects already-saved items with real keys -- it reads
// item.key for dedup bookkeeping and may item.eraseTx() a duplicate.
async function makeImportCandidateItem(
  title: string,
  author: string,
  year: string,
  doi?: string,
): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  item.setField("date", year);
  if (doi) item.setField("DOI", doi);
  item.setCreators([
    { firstName: "", lastName: author, creatorType: "author" },
  ]);
  await item.saveTx();
  return item;
}

describe("Phase 6: screeningExport", function () {
  this.timeout(60000);

  describe("formatPrismaCsv (pure)", function () {
    it("stacks a stage-counts table and a reasons table, separated by a blank line", function () {
      const data: PrismaData = {
        identification: {
          databases: [{ name: "Web of Science", records: 2 }],
          totalRecords: 2,
          duplicatesRemoved: 0,
        },
        screening: {
          screened: 1,
          excluded: 1,
          unclearToFt: 0,
          includedToFt: 0,
        },
        eligibility: {
          fullTextAssessed: 0,
          excluded: 0,
          unavailable: 0,
          reasons: [{ reason: "Sample size < 30", count: 1 }],
        },
        included: { finalStudies: 0 },
      };

      const csv = formatPrismaCsv(data);
      const lines = csv.split("\n");
      assert.equal(lines[0], "Stage,Count");
      assert.include(lines, "Identification: Web of Science,2");
      assert.include(lines, "Identification: total_records,2");
      assert.include(lines, "TA-Screening: screened,1");
      assert.include(lines, "TA-Screening: excluded,1");
      const separatorIndex = lines.indexOf("");
      const reasonsTable = lines.slice(separatorIndex + 1);
      assert.equal(reasonsTable[0], "Reason,Stage,Count");
      // TA-Screening no longer captures a reason at all (dropped from the
      // export entirely, not just naturally-empty) -- only FT-Screening
      // reasons should ever appear in this table.
      assert.deepEqual(reasonsTable.slice(1), [
        "Sample size < 30,FT-Screening,1",
      ]);
    });
  });

  it("computePrismaData matches a hand-computed scenario", async function () {
    const project = await createProject(`Prisma Export Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    const item1 = await makeImportCandidateItem(
      "Paper One",
      "Smith",
      "2023",
      "10.1/dup",
    );
    const item2 = await makeImportCandidateItem("Paper Two", "Jones", "2022");
    const item5 = await makeImportCandidateItem("Paper Four", "Kim", "2020");
    await processImportedItems(project.id, collections, "Web of Science", [
      item1,
      item2,
      item5,
    ]);

    const item3 = await makeImportCandidateItem(
      "Paper One",
      "Smith",
      "2023",
      "10.1/dup",
    ); // duplicate of item1
    const item4 = await makeImportCandidateItem("Paper Three", "Lee", "2021");
    await processImportedItems(project.id, collections, "Scopus", [
      item3,
      item4,
    ]);

    // TA-Screening: item1 exclude, item2 include, item4 unclear, item5 include
    await taConfirmDecision(
      project.id,
      item1,
      collections,
      null,
      "exclude",
      "test",
      "Not empirical",
    );
    await taConfirmDecision(
      project.id,
      item2,
      collections,
      null,
      "include",
      "test",
    );
    await taConfirmDecision(
      project.id,
      item4,
      collections,
      null,
      "unclear",
      "test",
    );
    await taConfirmDecision(
      project.id,
      item5,
      collections,
      null,
      "include",
      "test",
    );

    // FT-Screening: item2 exclude, item4 include, item5 unavailable
    await ftConfirmDecision(
      project.id,
      item2,
      collections,
      "exclude",
      "test",
      "Sample size < 30",
    );
    await ftConfirmDecision(project.id, item4, collections, "include", "test");
    await markUnavailable(project.id, item5, collections, "test");

    const data = await computePrismaData(project.id);

    assert.sameDeepMembers(data.identification.databases, [
      { name: "Web of Science", records: 3 },
      { name: "Scopus", records: 2 },
    ]);
    assert.equal(data.identification.totalRecords, 5);
    assert.equal(data.identification.duplicatesRemoved, 1);

    assert.equal(data.screening.screened, 4);
    assert.equal(data.screening.excluded, 1);
    assert.equal(data.screening.unclearToFt, 1);
    assert.equal(data.screening.includedToFt, 2);
    assert.isUndefined((data.screening as any).reasons);

    assert.equal(data.eligibility.fullTextAssessed, 3);
    assert.equal(data.eligibility.excluded, 1);
    assert.equal(data.eligibility.unavailable, 1);
    assert.deepEqual(data.eligibility.reasons, [
      { reason: "Sample size < 30", count: 1 },
      { reason: "Full text unavailable", count: 1 },
    ]);

    assert.equal(data.included.finalStudies, 1);
  });

  it("exportScreeningLog produces one row per screening_records entry with a header", async function () {
    const project = await createProject(`Screening Log Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeImportCandidateItem("Logged Paper", "Doe", "2024");
    await processImportedItems(project.id, collections, "Web of Science", [
      item,
    ]);
    await taConfirmDecision(
      project.id,
      item,
      collections,
      null,
      "include",
      "test",
    );
    await ftConfirmDecision(
      project.id,
      item,
      collections,
      "exclude",
      "test",
      "No control group",
    );

    const csv = await exportScreeningLog(project.id);
    const lines = csv.split("\n");
    assert.equal(lines.length, 3); // header + ta_screening row + ft_screening row
    assert.include(lines[0], "exclusion_reason");
    assert.include(lines[0], "ai_model");
    assert.isTrue(lines.some((l) => l.includes("No control group")));
  });

  it("exportScreeningLog includes the AI model that produced each ai_decision", async function () {
    const project = await createProject(
      `Screening Log Model Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeImportCandidateItem(
      "AI-Judged Paper",
      "Roe",
      "2024",
    );
    await processImportedItems(project.id, collections, "Web of Science", [
      item,
    ]);
    await databaseService.init();
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, ai_reasoning, ai_model)
       VALUES (?, ?, 'ta_screening', 'include', 'fits the criteria', 'gpt-4o-mini')`,
      [project.id, item.key],
    );

    const csv = await exportScreeningLog(project.id);
    const lines = csv.split("\n");
    const header = lines[0].split(",");
    const modelColumn = header.indexOf("ai_model");
    assert.isAbove(modelColumn, -1);
    const dataRow = lines[1].split(",");
    assert.equal(dataRow[modelColumn], "gpt-4o-mini");
  });
});
