import { assert } from "chai";
import {
  deleteProvider,
  upsertProvider,
} from "../src/modules/ai/providerConfig";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { saveCriteria } from "../src/modules/screening/criteriaService";
import { databaseService } from "../src/modules/db/database";
import { locateQuoteInAttachment } from "../src/modules/pdf/pdfAnnotationCreator";
import { FT_SCREENING_ANNOTATION_COLOR } from "../src/utils/annotationColors";
import {
  confirmDecision,
  getAttachmentFullText,
  getScreeningState,
  linkFtAnnotation,
  markFulltextReady,
  markUnavailable,
  parseJudgment,
  runAIJudgment,
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

// Same field set/order already verified working in test/coding.test.ts's
// createRealAnnotation -- annotationSortIndex is NOT NULL, discovered the
// hard way in Phase 4.
async function createRealAnnotation(
  attachment: Zotero.Item,
  text: string,
  color = "#ff0000",
): Promise<Zotero.Item> {
  const annotation = new Zotero.Item("annotation");
  annotation.libraryID = attachment.libraryID;
  (annotation as any).parentID = attachment.id;
  (annotation as any).annotationType = "highlight";
  (annotation as any).annotationText = text;
  (annotation as any).annotationColor = color;
  (annotation as any).annotationPosition = JSON.stringify({
    pageIndex: 0,
    rects: [[0, 0, 10, 10]],
  });
  (annotation as any).annotationSortIndex = "00000|000000|00000";
  await annotation.saveTx();
  return annotation;
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

  it("falls back to a null decision (not a synthesized third state) on unparseable AI responses", function () {
    const good = parseJudgment('{"decision": "include", "reasoning": "fits"}');
    assert.equal(good.decision, "include");

    const garbage = parseJudgment("not json at all");
    assert.isNull(garbage.decision);
    assert.equal(garbage.reasoning, "not json at all");
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

  it("runAIJudgment refuses to run without a configured provider", async function () {
    deleteProvider("default");
    const project = await createProject(`FT No Provider Test ${Date.now()}`);
    const item = await makeTestItem("No Provider");
    let threw = false;
    try {
      await runAIJudgment(project.id, item);
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /provider/i);
    }
    assert.isTrue(threw);
  });

  it("runAIJudgment refuses to run without configured FT criteria", async function () {
    upsertProvider({
      id: "default",
      name: "Test Provider",
      baseURL: "http://127.0.0.1:1/unused",
      apiKey: "test",
      model: "test-model",
    });
    const project = await createProject(`FT No Criteria Test ${Date.now()}`);
    const item = await makeTestItem("No Criteria");
    await markFulltextReady(project.id, item, "test-user");
    let threw = false;
    try {
      await runAIJudgment(project.id, item);
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /criteria/i);
    }
    assert.isTrue(threw);
    deleteProvider("default");
  });

  it("runAIJudgment refuses to run before fulltext_ready is confirmed", async function () {
    upsertProvider({
      id: "default",
      name: "Test Provider",
      baseURL: "http://127.0.0.1:1/unused",
      apiKey: "test",
      model: "test-model",
    });
    const project = await createProject(`FT Not Ready Test ${Date.now()}`);
    await saveCriteria(project.id, "ft", {
      researchQuestion: "Q",
      inclusionCriteria: ["A"],
      exclusionCriteria: ["B"],
    });
    const item = await makeTestItem("Not Ready Yet");
    let threw = false;
    try {
      await runAIJudgment(project.id, item);
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /full text/i);
    }
    assert.isTrue(threw);
    deleteProvider("default");
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

  it("confirmDecision materializes a pending auto-located highlight (FTS-06) only once confirmed", async function () {
    const project = await createProject(
      `FT Materialize On Confirm ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("FT Materialize Me");
    const attachment = await attachRealPdf(
      item,
      `ft-materialize-${Date.now()}.pdf`,
    );
    item.addToCollection(collections.ftQueueId);
    await item.saveTx();

    // Simulate what runAIJudgment already did: locate the quote and stash
    // it as pending_position, WITHOUT creating a real annotation.
    const located = await locateQuoteInAttachment(
      attachment,
      "FT SCREENING TEST FIXTURE TEXT",
    );
    assert.isNotNull(located);
    await databaseService.init();
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, pending_position) VALUES (?, ?, 'ft_screening', ?)`,
      [project.id, item.key, JSON.stringify(located)],
    );
    assert.equal(attachment.getAnnotations().length, 0);

    await confirmDecision(
      project.id,
      item,
      collections,
      "include",
      "test-user",
    );

    assert.equal(attachment.getAnnotations().length, 1);
    const state = await getScreeningState(project.id, item.key);
    assert.isNotNull(state?.annotationKey);
    assert.isNull(state?.pendingPosition);
    const annotation = Zotero.Items.getByLibraryAndKey(
      attachment.libraryID,
      state!.annotationKey!,
    ) as Zotero.Item;
    assert.equal(annotation.annotationColor, FT_SCREENING_ANNOTATION_COLOR);
  });

  it("confirmDecision(exclude) moves the item from FT-Queue to FT-Exclude", async function () {
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
      "Sample size < 30",
    );

    assert.isTrue(item.inCollection(collections.ftExcludeId));
    const state = await getScreeningState(project.id, item.key);
    assert.equal(state?.exclusionReason, "Sample size < 30");
  });

  it("linkFtAnnotation (FTS-06) forces the highlight to the fixed orange color and records it", async function () {
    const project = await createProject(
      `FT Link Annotation Test ${Date.now()}`,
    );
    const item = await makeTestItem("FT Evidence Item");
    const attachment = await attachRealPdf(
      item,
      `ft-link-fixture-${Date.now()}.pdf`,
    );
    const annotation = await createRealAnnotation(
      attachment,
      "the key sentence",
      "#ff0000",
    );
    assert.notEqual(annotation.annotationColor, FT_SCREENING_ANNOTATION_COLOR);

    await linkFtAnnotation(project.id, item, annotation.key);

    assert.equal(annotation.annotationColor, FT_SCREENING_ANNOTATION_COLOR);
    const state = await getScreeningState(project.id, item.key);
    assert.equal(state?.annotationKey, annotation.key);
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
