import { assert } from "chai";
import {
  createProject,
  deleteProject,
  EvidenceProject,
  getProjectById,
} from "../src/modules/project/projectManager";
import {
  CODING,
  FT_EXCLUDE,
  FT_INCLUDE,
  FT_QUEUE,
  FT_SCREENING,
  FT_UNAVAILABLE,
  resolveProjectCollections,
  SCREEN_QUEUE,
  SOURCES,
  TA_EXCLUDE,
  TA_INCLUDE,
  TA_SCREENING,
  TA_UNCLEAR,
} from "../src/modules/project/collectionStructure";
import { importLiteratureFile } from "../src/modules/import/importService";
import { databaseService } from "../src/modules/db/database";
import { saveCodebook } from "../src/modules/coding/codebookService";

// Project rows and Zotero Collections live in separate id spaces
// (evidence_projects.id is a SQLite autoincrement; Collection ids are
// assigned by Zotero itself) -- the real entry point is collectionKey.
function getRootCollectionId(project: EvidenceProject): number {
  const collection = Zotero.Collections.getByLibraryAndKey(
    Zotero.Libraries.userLibraryID,
    project.collectionKey,
  );
  if (!collection) {
    throw new Error(
      `Root collection not found for key ${project.collectionKey}`,
    );
  }
  return (collection as Zotero.Collection).id;
}

const SAMPLE_WOS_RIS = `TY  - JOUR
TI  - Effects of Exercise on Cognitive Function in Older Adults
AU  - Smith, John
AU  - Doe, Jane
PY  - 2020
DO  - 10.1000/example.001
ER  -

TY  - JOUR
TI  - A Randomized Trial of Intervention X
AU  - Lee, Amy
PY  - 2019
DO  - 10.1000/example.002
ER  -

TY  - JOUR
TI  - Cross-sectional Study of Y in Adults
AU  - Wang, Fei
PY  - 2021
DO  - 10.1000/example.003
ER  -
`;

const SAMPLE_SCOPUS_RIS = `TY  - JOUR
TI  - A Randomized Trial of Intervention X
AU  - Lee, Amy
PY  - 2019
DO  - 10.1000/example.002
ER  -

TY  - JOUR
TI  - New Study on Z Outcomes
AU  - Brown, Chris
PY  - 2022
DO  - 10.1000/example.004
ER  -
`;

function writeFixtureFile(name: string, content: string): string {
  const file = Zotero.File.pathToFile(Zotero.DataDirectory.dir);
  file.append(name);
  Zotero.File.putContents(file, content);
  return file.path;
}

describe("Phase 1: project structure, import, dedup", function () {
  this.timeout(60000);

  it("creates the fixed Collection tree for a new project", async function () {
    const project = await createProject(`Evidence Test ${Date.now()}`);
    const collections = resolveProjectCollections(getRootCollectionId(project));
    assert.isNumber(collections.sourcesId);
    assert.isNumber(collections.screenQueueId);
    assert.isNumber(collections.taIncludeId);
    assert.isNumber(collections.ftQueueId);
    assert.isNumber(collections.codingId);
  });

  it("deleteProject erases the Collection tree, its items, and every DB row for the project", async function () {
    const project = await createProject(`Evidence Delete Test ${Date.now()}`);
    const collections = resolveProjectCollections(getRootCollectionId(project));

    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Delete Test Item");
    await item.saveTx();
    item.addToCollection(collections.screenQueueId);
    await item.saveTx();
    const itemId = item.id;

    await databaseService.init();
    await databaseService.queryAsync(
      `INSERT INTO screening_criteria (project_id, stage, version, criteria, created_at)
       VALUES (?, 'ta', 1, '{}', ?)`,
      [project.id, new Date().toISOString()],
    );
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage) VALUES (?, ?, 'ta_screening')`,
      [project.id, item.key],
    );
    const codebook = await saveCodebook(project.id, [
      { name: "population", type: "text" },
    ]);
    await databaseService.queryAsync(
      `INSERT INTO coding_records
        (project_id, codebook_id, item_key, variable_name, variable_value, confirmed, created_at, updated_at)
       VALUES (?, ?, ?, 'population', 'Adults', 1, ?, ?)`,
      [
        project.id,
        codebook.id,
        item.key,
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    const codingRecordId = await databaseService.getLastInsertId();
    await databaseService.queryAsync(
      `INSERT INTO synthesis_themes (coding_record_id, theme, created_at, updated_at)
       VALUES (?, 'Theme A', ?, ?)`,
      [codingRecordId, new Date().toISOString(), new Date().toISOString()],
    );

    await deleteProject(project.id);

    assert.isFalse(
      !!Zotero.Collections.get(collections.rootId),
      "root Collection should be gone",
    );
    assert.isFalse(!!Zotero.Items.get(itemId), "item should be erased");
    assert.isNull(
      await getProjectById(project.id),
      "evidence_projects row should be gone",
    );
    for (const table of [
      "screening_criteria",
      "screening_records",
      "codebooks",
      "coding_records",
      "item_sources",
    ]) {
      const rows = await databaseService.queryAsync(
        `SELECT * FROM ${table} WHERE project_id = ?`,
        [project.id],
      );
      assert.isEmpty(
        rows,
        `${table} should have no rows for the deleted project`,
      );
    }
    const themeRows = await databaseService.queryAsync(
      `SELECT * FROM synthesis_themes WHERE coding_record_id = ?`,
      [codingRecordId],
    );
    assert.isEmpty(
      themeRows,
      "synthesis_themes should have no rows for the deleted project",
    );
  });

  it("names a new project's top-level Collections with pipeline-order number prefixes", async function () {
    const project = await createProject(`Evidence Order Test ${Date.now()}`);
    const collections = resolveProjectCollections(getRootCollectionId(project));
    const nameOf = (id: number) =>
      (Zotero.Collections.get(id) as Zotero.Collection).name;
    assert.equal(nameOf(collections.sourcesId), SOURCES);
    assert.equal(nameOf(collections.screenQueueId), SCREEN_QUEUE);
    assert.equal(nameOf(collections.ftQueueId), FT_QUEUE);
    assert.equal(nameOf(collections.codingId), CODING);
    assert.isTrue(SOURCES.startsWith("1."));
    assert.isTrue(SCREEN_QUEUE.startsWith("2."));
    assert.isTrue(TA_SCREENING.startsWith("3."));
    assert.isTrue(FT_QUEUE.startsWith("4."));
    assert.isTrue(FT_SCREENING.startsWith("5."));
    assert.isTrue(CODING.startsWith("6."));
  });

  it("resolveProjectCollections still resolves a pre-existing project whose Collections use the old unprefixed names", async function () {
    // Regression: projects created before the numbered-prefix naming (see
    // collectionStructure.ts) have real, already-saved Collections named
    // "Sources"/"Screen Queue"/etc, not "1. Sources"/"2. Screen Queue" --
    // those are never renamed, so resolveProjectCollections must still find
    // them by the legacy name.
    const libraryID = Zotero.Libraries.userLibraryID;
    const makeCollection = async (name: string, parentID?: number) => {
      const c = new Zotero.Collection({ name, libraryID, parentID });
      await c.saveTx();
      return c;
    };

    const root = await makeCollection(`Legacy Naming Test ${Date.now()}`);
    const sources = await makeCollection("Sources", root.id);
    const screenQueue = await makeCollection("Screen Queue", root.id);
    const taScreening = await makeCollection(
      "Title-Abstract Screening",
      root.id,
    );
    await makeCollection(TA_INCLUDE, taScreening.id);
    await makeCollection(TA_EXCLUDE, taScreening.id);
    await makeCollection(TA_UNCLEAR, taScreening.id);
    const ftScreening = await makeCollection("Full-Text Screening", root.id);
    // The legacy structure nests FT-Queue under Full-Text Screening rather
    // than making it a top-level sibling -- resolveProjectCollections()'s
    // two-tier fallback (root children first, then this) has to find it
    // here, by its own legacy literal name ("FT-Queue"), not the current
    // FT_QUEUE constant value.
    const ftQueue = await makeCollection("FT-Queue", ftScreening.id);
    await makeCollection(FT_INCLUDE, ftScreening.id);
    await makeCollection(FT_EXCLUDE, ftScreening.id);
    await makeCollection(FT_UNAVAILABLE, ftScreening.id);
    const coding = await makeCollection("Coding", root.id);

    const collections = resolveProjectCollections(root.id);
    assert.equal(collections.sourcesId, sources.id);
    assert.equal(collections.screenQueueId, screenQueue.id);
    assert.equal(collections.ftQueueId, ftQueue.id);
    assert.equal(collections.codingId, coding.id);
  });

  it("imports RIS via Zotero.Translate.Import and dedupes across sources", async function () {
    try {
      await runImportDedupTest();
    } catch (e: any) {
      const file = Zotero.File.pathToFile(Zotero.DataDirectory.dir);
      file.append("evidence-test-error.log");
      Zotero.File.putContents(
        file,
        `${e?.message ?? e}\n\n${e?.stack ?? "(no stack)"}`,
      );
      throw e;
    }
  });
});

async function runImportDedupTest() {
  const project = await createProject(`Evidence Dedup Test ${Date.now()}`);
  const collections = resolveProjectCollections(getRootCollectionId(project));

  const wosPath = writeFixtureFile("wos-sample.ris", SAMPLE_WOS_RIS);
  const wosResult = await importLiteratureFile(
    project.id,
    collections.rootId,
    "Web of Science",
    wosPath,
  );
  assert.equal(wosResult.totalParsed, 3, "WoS file should parse 3 records");
  assert.equal(wosResult.newCount, 3, "all 3 WoS records should be new");
  assert.equal(wosResult.duplicateCount, 0);

  const scopusPath = writeFixtureFile("scopus-sample.ris", SAMPLE_SCOPUS_RIS);
  const scopusResult = await importLiteratureFile(
    project.id,
    collections.rootId,
    "Scopus",
    scopusPath,
  );
  assert.equal(
    scopusResult.totalParsed,
    2,
    "Scopus file should parse 2 records",
  );
  assert.equal(
    scopusResult.newCount,
    1,
    "only 1 Scopus record is genuinely new",
  );
  assert.equal(
    scopusResult.duplicateCount,
    1,
    "1 Scopus record duplicates a WoS DOI",
  );

  const screenQueueCollection = Zotero.Collections.get(
    collections.screenQueueId,
  ) as Zotero.Collection;
  const screenQueueItems = screenQueueCollection.getChildItems();
  assert.equal(
    screenQueueItems.length,
    4,
    "Screen Queue should contain 4 unique records (3 WoS + 1 new Scopus)",
  );
}
