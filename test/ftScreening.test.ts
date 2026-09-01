import { assert } from "chai";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import {
  confirmDecision,
  getAttachmentFullText,
  getScreeningState,
  markFulltextReady,
  markUnavailable,
} from "../src/modules/screening/ftScreeningService";

// Minimal hand-written valid single-page PDF, same technique used to
// empirically verify item.attachmentText before writing this service.
const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 76 >>
stream
BT /F1 24 Tf 72 712 Td (FT SCREENING TEST FIXTURE TEXT) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF
`;

function writeFixturePdf(name: string): string {
  const file = Zotero.File.pathToFile(Zotero.DataDirectory.dir);
  file.append(name);
  Zotero.File.putContents(file, MINIMAL_PDF);
  return file.path;
}

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

async function attachRealPdf(
  item: Zotero.Item,
  fileName: string,
): Promise<Zotero.Item> {
  const attachment = await Zotero.Attachments.importFromFile({
    file: writeFixturePdf(fileName),
    parentItemID: item.id,
    contentType: "application/pdf",
  });
  return attachment as Zotero.Item;
}

describe("Phase 3: FT-Screening core loop", function () {
  this.timeout(60000);

  it("getAttachmentFullText returns null without a PDF attachment", async function () {
    const item = await makeTestItem("No Attachment");
    const text = await getAttachmentFullText(item);
    assert.isNull(text);
  });

  it("getAttachmentFullText reads real extracted PDF text", async function () {
    const item = await makeTestItem("Has Attachment");
    await attachRealPdf(item, `ft-fixture-${Date.now()}.pdf`);
    const text = await getAttachmentFullText(item);
    assert.isNotNull(text);
    assert.include(text!, "FT SCREENING TEST FIXTURE TEXT");
  });

  it("markFulltextReady sets the fulltext_ready gate", async function () {
    const project = await createProject(`FT Ready Test ${Date.now()}`);
    const item = await makeTestItem("Ready Gate");

    let state = await getScreeningState(project.id, item.key);
    assert.isNull(state);

    await markFulltextReady(project.id, item, "test-user");
    state = await getScreeningState(project.id, item.key);
    assert.isTrue(state?.fulltextReady);
  });

  it("confirmDecision(include) moves the item from FT-Queue to FT-Include", async function () {
    const project = await createProject(`FT Confirm Include ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("FT Include Me");
    item.addToCollection(collections.ftQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      "include",
      "test-user",
    );

    assert.isFalse(item.inCollection(collections.ftQueueId));
    assert.isTrue(item.inCollection(collections.ftIncludeId));
    // Coding is "待编码/已编码" (REQUIREMENTS 2.1.4) -- every FT-Include
    // item belongs there right away, not just ones already opened for coding.
    assert.isTrue(item.inCollection(collections.codingId));

    const state = await getScreeningState(project.id, item.key);
    assert.equal(state?.decision, "include");
  });

  it("confirmDecision(exclude) moves the item from FT-Queue to FT-Exclude and joins multiple reasons", async function () {
    const project = await createProject(`FT Confirm Exclude ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("FT Exclude Me");
    item.addToCollection(collections.ftQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      "exclude",
      "test-user",
      ["Sample size < 30", "Wrong study design"],
    );

    assert.isTrue(item.inCollection(collections.ftExcludeId));
    const state = await getScreeningState(project.id, item.key);
    assert.equal(
      state?.exclusionReason,
      "Sample size < 30; Wrong study design",
    );
  });

  it("confirmDecision(exclude) leaves exclusion_reason null when no reasons are given", async function () {
    const project = await createProject(
      `FT Confirm Exclude No Reason ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("FT Exclude No Reason");
    item.addToCollection(collections.ftQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      "exclude",
      "test-user",
    );

    const state = await getScreeningState(project.id, item.key);
    assert.isNull(state?.exclusionReason);
  });

  it("markUnavailable moves the item from FT-Queue to FT-Unavailable", async function () {
    const project = await createProject(`FT Unavailable ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("No PDF Findable");
    item.addToCollection(collections.ftQueueId);
    await item.saveTx();

    await markUnavailable(project.id, item, collections, "test-user");

    assert.isFalse(item.inCollection(collections.ftQueueId));
    assert.isTrue(item.inCollection(collections.ftUnavailableId));

    const state = await getScreeningState(project.id, item.key);
    assert.equal(state?.decision, "unavailable");
  });
});
