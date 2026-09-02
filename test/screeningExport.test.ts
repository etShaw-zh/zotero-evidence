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
import { confirmCheck } from "../src/modules/screening/ftCriterionCheckService";

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
          uniqueRecords: 2,
        },
        screening: {
          screened: 1,
          excluded: 1,
          unclearToFt: 0,
          includedToFt: 0,
          pending: 0,
        },
        retrieval: {
          soughtForRetrieval: 0,
          notRetrieved: 0,
        },
        eligibility: {
          assessedForEligibility: 0,
          excluded: 0,
          reasons: [{ reason: "Sample size < 30", count: 1 }],
          pending: 0,
        },
        included: { finalStudies: 0 },
      };

      const csv = formatPrismaCsv(data);
      const lines = csv.split("\n");
      assert.equal(lines[0], "Stage,Count");
      assert.include(lines, "Identification: Web of Science,2");
      assert.include(lines, "Identification: total_records,2");
      assert.include(lines, "Identification: deduplicated_records,2");
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

    it("only shows a pending-items row (TA or FT) when the review isn't fully screened yet", function () {
      const base: PrismaData = {
        identification: {
          databases: [],
          totalRecords: 0,
          duplicatesRemoved: 0,
          uniqueRecords: 0,
        },
        screening: {
          screened: 0,
          excluded: 0,
          unclearToFt: 0,
          includedToFt: 0,
          pending: 0,
        },
        retrieval: { soughtForRetrieval: 0, notRetrieved: 0 },
        eligibility: {
          assessedForEligibility: 0,
          excluded: 0,
          reasons: [],
          pending: 0,
        },
        included: { finalStudies: 0 },
      };

      const complete = formatPrismaCsv(base);
      assert.notInclude(complete, "pending_not_yet_screened");

      const taIncomplete = formatPrismaCsv({
        ...base,
        screening: { ...base.screening, pending: 5 },
      });
      assert.include(
        taIncomplete.split("\n"),
        "TA-Screening: pending_not_yet_screened,5",
      );

      const ftIncomplete = formatPrismaCsv({
        ...base,
        eligibility: { ...base.eligibility, pending: 3 },
      });
      assert.include(
        ftIncomplete.split("\n"),
        "FT-Screening: pending_not_yet_screened,3",
      );
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

    // FT-Screening: item2 exclude, item4 include, item5 unavailable.
    // PRISMA's reasons breakdown now reads confirmed ft_criterion_checks
    // rows rather than a single exclusion_reason string -- seed one
    // directly, matching what confirmCheck would have written.
    await databaseService.init();
    await databaseService.queryAsync(
      `INSERT INTO ft_criterion_checks
        (project_id, item_key, criterion_type, criterion_text, verdict, source, confirmed, created_at, updated_at)
       VALUES (?, ?, 'exclusion', 'Sample size < 30', 'exclude', 'human', 1, ?, ?)`,
      [
        project.id,
        item2.key,
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    await ftConfirmDecision(project.id, item2, collections, "exclude", "test", [
      "Sample size < 30",
    ]);
    await ftConfirmDecision(project.id, item4, collections, "include", "test");
    await markUnavailable(project.id, item5, collections, "test");

    const data = await computePrismaData(project.id);

    assert.sameDeepMembers(data.identification.databases, [
      { name: "Web of Science", records: 3 },
      { name: "Scopus", records: 2 },
    ]);
    assert.equal(data.identification.totalRecords, 5);
    assert.equal(data.identification.duplicatesRemoved, 1);
    assert.equal(data.identification.uniqueRecords, 4);

    assert.equal(data.screening.screened, 4);
    assert.equal(data.screening.excluded, 1);
    assert.equal(data.screening.unclearToFt, 1);
    assert.equal(data.screening.includedToFt, 2);
    // Every item in this scenario reaches a TA decision -- nothing left in
    // TA-Screen Queue.
    assert.equal(data.screening.pending, 0);
    assert.isUndefined((data.screening as any).reasons);

    assert.equal(data.retrieval.soughtForRetrieval, 3);
    assert.equal(data.retrieval.notRetrieved, 1);
    assert.equal(data.eligibility.assessedForEligibility, 2);
    assert.equal(data.eligibility.excluded, 1);
    // "Full text unavailable" must NOT appear here -- a paper that was
    // never retrieved was never assessed for eligibility, so it can't
    // have an eligibility exclusion reason.
    assert.deepEqual(data.eligibility.reasons, [
      { reason: "Sample size < 30", count: 1 },
    ]);
    // item2/item4/item5 all reach an FT decision (exclude/include/
    // unavailable) -- nothing left in FT-Screen Queue.
    assert.equal(data.eligibility.pending, 0);

    assert.equal(data.included.finalStudies, 1);
  });

  it("computePrismaData counts an item still sitting undecided in TA-Screen Queue as pending", async function () {
    const project = await createProject(`Prisma Pending Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const decided = await makeImportCandidateItem(
      "Decided Paper",
      "Doe",
      "2024",
    );
    const undecided = await makeImportCandidateItem(
      "Undecided Paper",
      "Roe",
      "2024",
    );
    await processImportedItems(project.id, collections, "Web of Science", [
      decided,
      undecided,
    ]);
    await taConfirmDecision(
      project.id,
      decided,
      collections,
      null,
      "include",
      "test",
    );
    // `undecided` is left sitting in TA-Screen Queue -- no decision made.

    const data = await computePrismaData(project.id);

    assert.equal(data.screening.screened, 1);
    assert.equal(data.screening.pending, 1);
  });

  it("computePrismaData counts an item still sitting undecided in FT-Screen Queue as pending", async function () {
    const project = await createProject(`Prisma FT Pending Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const decided = await makeImportCandidateItem(
      "FT Decided Paper",
      "Doe",
      "2024",
    );
    const undecided = await makeImportCandidateItem(
      "FT Undecided Paper",
      "Roe",
      "2024",
    );
    await processImportedItems(project.id, collections, "Web of Science", [
      decided,
      undecided,
    ]);
    // Both pass TA screening, so both move into FT-Screen Queue.
    await taConfirmDecision(
      project.id,
      decided,
      collections,
      null,
      "include",
      "test",
    );
    await taConfirmDecision(
      project.id,
      undecided,
      collections,
      null,
      "include",
      "test",
    );
    await ftConfirmDecision(
      project.id,
      decided,
      collections,
      "include",
      "test",
    );
    // `undecided` is left sitting in FT-Screen Queue -- no FT decision made.

    const data = await computePrismaData(project.id);

    assert.equal(data.eligibility.pending, 1);
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
    await ftConfirmDecision(project.id, item, collections, "exclude", "test", [
      "No control group",
    ]);

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

  it("exportScreeningLog includes each item's DOI, for reviewers' collected CSVs to be matched back up by DOI", async function () {
    const project = await createProject(`Screening Log DOI Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeImportCandidateItem(
      "DOI Paper",
      "Poe",
      "2024",
      "10.1000/example.doi",
    );
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

    const csv = await exportScreeningLog(project.id);
    const lines = csv.split("\n");
    const header = lines[0].split(",");
    const doiColumn = header.indexOf("doi");
    assert.isAbove(doiColumn, -1);
    const dataRow = lines[1].split(",");
    assert.equal(dataRow[doiColumn], "10.1000/example.doi");
  });

  it("exportScreeningLog includes ai_model for FT-Screening rows too, not just TA-Screening", async function () {
    const project = await createProject(
      `Screening Log FT Model Test ${Date.now()}`,
    );
    const item = await makeImportCandidateItem(
      "FT AI-Checked Paper",
      "Loe",
      "2024",
    );
    await databaseService.init();
    const now = new Date().toISOString();
    // Mirrors what runCriterionChecks() (ftCriterionCheckService.ts) itself
    // inserts for one AI-suggested check, including the model column that
    // used to be missing entirely -- confirmCheck() below then triggers
    // refreshAggregate(), which is what actually snapshots it onto
    // screening_records.ai_model (what exportScreeningLog reads).
    await databaseService.queryAsync(
      `INSERT INTO ft_criterion_checks
        (project_id, item_key, criterion_type, criterion_text, verdict, source, confirmed, model, created_at, updated_at)
       VALUES (?, ?, 'inclusion', 'Adults 18-65', 'include', 'ai', 0, 'glm-4-flash', ?, ?)`,
      [project.id, item.key, now, now],
    );
    const checkId = await databaseService.getLastInsertId();
    await confirmCheck(checkId, item, project.id);

    const csv = await exportScreeningLog(project.id);
    const lines = csv.split("\n");
    const header = lines[0].split(",");
    const modelColumn = header.indexOf("ai_model");
    const stageColumn = header.indexOf("stage");
    const ftRow = lines
      .slice(1)
      .map((l) => l.split(","))
      .find((fields) => fields[stageColumn] === "ft_screening");
    assert.isDefined(ftRow);
    assert.equal(ftRow![modelColumn], "glm-4-flash");
  });
});
