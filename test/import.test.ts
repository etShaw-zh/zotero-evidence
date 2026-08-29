import { assert } from "chai";
import {
  createProject,
  EvidenceProject,
} from "../src/modules/project/projectManager";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { importLiteratureFile } from "../src/modules/import/importService";

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
