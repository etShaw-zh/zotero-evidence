import { assert } from "chai";
import {
  deleteProvider,
  upsertProvider,
} from "../src/modules/ai/providerConfig";
import { saveCodebook } from "../src/modules/coding/codebookService";
import {
  addManualRecord,
  computeCodingStats,
  confirmRecord,
  deleteRecord,
  generateSuggestions,
  getCodingProgress,
  getCodingRecords,
  linkAnnotationToRecord,
  parseSuggestions,
  unconfirmRecord,
  updateRecord,
} from "../src/modules/coding/codingService";
import { databaseService } from "../src/modules/db/database";
import { locateQuoteInAttachment } from "../src/modules/pdf/pdfAnnotationCreator";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { CODING_ANNOTATION_COLOR } from "../src/utils/annotationColors";

// Same minimal hand-written valid PDF technique established in
// ftScreening.test.ts.
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
<< /Length 70 >>
stream
BT /F1 24 Tf 72 712 Td (CODING TEST FIXTURE SAMPLE SIZE 156) Tj ET
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
  return Zotero.Attachments.importFromFile({
    file: writeFixturePdf(fileName),
    parentItemID: item.id,
    contentType: "application/pdf",
  });
}

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
    rects: [[0, 0, 100, 20]],
  });
  (annotation as any).annotationSortIndex = "00000|000000|00000";
  await annotation.saveTx();
  return annotation;
}

describe("Phase 4: Full-Text Coding core loop", function () {
  this.timeout(60000);

  it("parseSuggestions parses a JSON array and tolerates bad entries", function () {
    const good = parseSuggestions(
      '[{"variable":"study_design","value":"RCT","quote":"a randomized controlled trial"}]',
    );
    assert.equal(good.length, 1);
    assert.equal(good[0].variable, "study_design");

    const fenced = parseSuggestions(
      '```json\n[{"variable":"sample_size","value":"156","quote":"156 participants"}]\n```',
    );
    assert.equal(fenced.length, 1);

    const mixed = parseSuggestions(
      '[{"variable":"a","value":"b","quote":"c"},{"variable":"missing_value"},"not an object"]',
    );
    assert.equal(mixed.length, 1);

    assert.deepEqual(parseSuggestions("not json at all"), []);
    assert.deepEqual(parseSuggestions('{"not":"an array"}'), []);
  });

  it("parseSuggestions strips control chars mozStorage rejects on bind (e.g. an embedded NUL)", function () {
    // Regression: a NUL character anywhere in an AI-derived string throws
    // "InvalidCharacterError: An invalid or illegal string was specified"
    // from Zotero's SQLite layer when the record is inserted, aborting
    // generateSuggestions entirely with no records saved at all. Built via
    // String.fromCharCode (not a literal escape) so the NUL only ever
    // exists as a runtime value, never as a raw byte in this source file.
    const nul = String.fromCharCode(0);
    const raw = JSON.stringify([
      {
        variable: "study" + nul + "_design",
        value: "RCT" + nul,
        quote: "a randomized" + nul + " controlled trial",
      },
    ]);
    const [result] = parseSuggestions(raw);
    assert.equal(result.variable, "study_design");
    assert.equal(result.value, "RCT");
    assert.equal(result.quote, "a randomized controlled trial");
  });

  it("generateSuggestions refuses to run without a configured provider", async function () {
    deleteProvider("default");
    const project = await createProject(
      `Coding No Provider Test ${Date.now()}`,
    );
    const item = await makeTestItem("No Provider");
    let threw = false;
    try {
      await generateSuggestions(project.id, item);
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /provider/i);
    }
    assert.isTrue(threw);
  });

  it("generateSuggestions refuses to run without a configured Codebook", async function () {
    upsertProvider({
      id: "default",
      name: "Test Provider",
      baseURL: "http://127.0.0.1:1/unused",
      apiKey: "test",
      model: "test-model",
    });
    const project = await createProject(
      `Coding No Codebook Test ${Date.now()}`,
    );
    const item = await makeTestItem("No Codebook");
    let threw = false;
    try {
      await generateSuggestions(project.id, item);
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /codebook/i);
    }
    assert.isTrue(threw);
    deleteProvider("default");
  });

  it("addManualRecord + linkAnnotationToRecord support 1-to-many and multi-value", async function () {
    const project = await createProject(`Coding 1toN Test ${Date.now()}`);
    const codebook = await saveCodebook(project.id, [
      { name: "study_design", type: "categorical", values: ["RCT"] },
      { name: "outcome", type: "text", multiple: true },
    ]);

    const item = await makeTestItem("1toN Item");
    const attachment = await attachRealPdf(
      item,
      `coding-1ton-${Date.now()}.pdf`,
    );
    const annotation = await createRealAnnotation(
      attachment,
      "randomized controlled trial with two outcomes",
    );
    assert.notEqual(annotation.annotationColor, CODING_ANNOTATION_COLOR);

    // 1-to-many: the SAME annotation backs two different variables.
    const id1 = await addManualRecord(
      project.id,
      item,
      codebook.id,
      "study_design",
      "RCT",
      annotation.key,
      "randomized controlled trial",
    );
    const id2 = await addManualRecord(
      project.id,
      item,
      codebook.id,
      "outcome",
      "mortality",
      annotation.key,
      "mortality outcome",
    );
    // Multi-value: a second row for the SAME variable, different value.
    const id3 = await addManualRecord(
      project.id,
      item,
      codebook.id,
      "outcome",
      "quality of life",
      annotation.key,
      "quality of life outcome",
    );

    // addManualRecord (COD-04/2.4.5) forces the highlight to the fixed
    // default Coding color once it's linked to any variable.
    assert.equal(annotation.annotationColor, CODING_ANNOTATION_COLOR);

    const records = await getCodingRecords(project.id, item.key);
    assert.equal(records.length, 3);
    assert.isTrue(records.every((r) => r.annotationKey === annotation.key));
    const outcomeRecords = records.filter((r) => r.variableName === "outcome");
    assert.equal(outcomeRecords.length, 2);
    assert.sameMembers(
      outcomeRecords.map((r) => r.variableValue),
      ["mortality", "quality of life"],
    );

    // linkAnnotationToRecord confirms an AI-style unlinked suggestion.
    const suggestionId = id1;
    await linkAnnotationToRecord(suggestionId, annotation.key, "study_design", "RCT");
    const afterLink = await getCodingRecords(project.id, item.key);
    const linked = afterLink.find((r) => r.id === suggestionId);
    assert.isTrue(linked?.confirmed);
    assert.equal(linked?.annotationKey, annotation.key);

    void id2;
    void id3;
  });

  it("linkAnnotationToRecord (2.4.5) forces the highlight to the fixed default Coding color", async function () {
    const project = await createProject(`Coding Link Color Test ${Date.now()}`);
    const codebook = await saveCodebook(project.id, [
      { name: "population", type: "text" },
    ]);
    const item = await makeTestItem("Link Color Item");
    const attachment = await attachRealPdf(
      item,
      `coding-link-color-${Date.now()}.pdf`,
    );
    const annotation = await createRealAnnotation(
      attachment,
      "adults aged 18-65",
      "#00aa00",
    );
    assert.notEqual(annotation.annotationColor, CODING_ANNOTATION_COLOR);

    const recordId = await addManualRecord(
      project.id,
      item,
      codebook.id,
      "population",
      "Adults 18-65",
      null,
      null,
    );
    await linkAnnotationToRecord(
      recordId,
      annotation.key,
      "population",
      "Adults 18-65",
    );

    assert.equal(annotation.annotationColor, CODING_ANNOTATION_COLOR);
    // A manually-linked highlight keeps its own real annotationText (the
    // user drew it themselves) -- only the comment is coding's to set.
    assert.equal(
      (annotation as any).annotationComment,
      "population: Adults 18-65",
    );
  });

  it("unconfirmRecord reverts a confirmed record back to pending (unlinks, doesn't delete the annotation)", async function () {
    const project = await createProject(`Coding Undo Test ${Date.now()}`);
    const codebook = await saveCodebook(project.id, [
      { name: "population", type: "text" },
    ]);
    const item = await makeTestItem("Undo Item");
    const attachment = await attachRealPdf(item, `coding-undo-${Date.now()}.pdf`);
    const annotation = await createRealAnnotation(
      attachment,
      "adults aged 18-65",
      "#00aa00",
    );

    const recordId = await addManualRecord(
      project.id,
      item,
      codebook.id,
      "population",
      "Adults 18-65",
      null,
      null,
    );
    await linkAnnotationToRecord(
      recordId,
      annotation.key,
      "population",
      "Adults 18-65",
    );

    let records = await getCodingRecords(project.id, item.key);
    let record = records.find((r) => r.id === recordId)!;
    assert.equal(record.annotationKey, annotation.key);
    assert.isTrue(record.confirmed);

    await unconfirmRecord(recordId);

    records = await getCodingRecords(project.id, item.key);
    record = records.find((r) => r.id === recordId)!;
    assert.isNull(record.annotationKey);
    assert.isFalse(record.confirmed);
    // The real PDF highlight is left untouched -- undo only unlinks it.
    assert.isFalse(annotation.deleted);
  });

  it("updateRecord edits variable/value assignment (COD-08)", async function () {
    const project = await createProject(`Coding Edit Test ${Date.now()}`);
    const codebook = await saveCodebook(project.id, [
      { name: "sample_size", type: "numeric" },
    ]);
    const item = await makeTestItem("Edit Item");

    const recordId = await addManualRecord(
      project.id,
      item,
      codebook.id,
      "sample_size",
      "100",
      null,
      null,
    );
    await updateRecord(recordId, "sample_size", "156");

    const records = await getCodingRecords(project.id, item.key);
    assert.equal(records[0].variableValue, "156");
  });

  it("confirmRecord materializes a pending auto-located highlight (COD-04) and confirms the record", async function () {
    const project = await createProject(
      `Coding Confirm Materialize Test ${Date.now()}`,
    );
    const codebook = await saveCodebook(project.id, [
      { name: "sample_size", type: "numeric" },
    ]);
    const item = await makeTestItem("Confirm Materialize Item");
    const attachment = await attachRealPdf(
      item,
      `coding-confirm-materialize-${Date.now()}.pdf`,
    );

    // Simulate what generateSuggestions already did: locate the quote and
    // stash it as pending_position, WITHOUT creating a real annotation.
    const located = await locateQuoteInAttachment(
      attachment,
      "CODING TEST FIXTURE SAMPLE SIZE 156",
    );
    assert.isNotNull(located);
    await databaseService.init();
    const now = new Date().toISOString();
    await databaseService.queryAsync(
      `INSERT INTO coding_records
         (project_id, codebook_id, item_key, pending_position, variable_name, variable_value, quote, is_pilot, source, confirmed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'ai', 0, ?, ?)`,
      [
        project.id,
        codebook.id,
        item.key,
        JSON.stringify(located),
        "sample_size",
        "100",
        "CODING TEST FIXTURE SAMPLE SIZE 156",
        now,
        now,
      ],
    );
    const [before] = await getCodingRecords(project.id, item.key);
    assert.isFalse(before.confirmed);
    assert.equal(attachment.getAnnotations().length, 0);

    await confirmRecord(before.id, item, "sample_size", "156");

    assert.equal(attachment.getAnnotations().length, 1);
    const [after] = await getCodingRecords(project.id, item.key);
    assert.equal(after.variableValue, "156");
    assert.isTrue(after.confirmed);
    assert.isNotNull(after.annotationKey);
    assert.isNull(after.pendingPosition);
    const annotation = Zotero.Items.getByLibraryAndKey(
      attachment.libraryID,
      after.annotationKey!,
    ) as Zotero.Item;
    assert.equal(annotation.annotationColor, CODING_ANNOTATION_COLOR);
    // Regression: the reader-sidebar annotation list showed a bare coded
    // value ("156") with no real quote and no indication of which variable
    // it was -- annotationText must be the actual located quote, and
    // annotationComment must label which variable/value it maps to.
    assert.equal(
      annotation.annotationText,
      "CODING TEST FIXTURE SAMPLE SIZE 156",
    );
    assert.equal(
      (annotation as any).annotationComment,
      "sample_size: 156",
    );
  });

  it("confirmRecord behaves like updateRecord when there's no pending position (no forced confirm)", async function () {
    const project = await createProject(
      `Coding Confirm No Pending Test ${Date.now()}`,
    );
    const codebook = await saveCodebook(project.id, [
      { name: "sample_size", type: "numeric" },
    ]);
    const item = await makeTestItem("Confirm No Pending Item");
    const recordId = await addManualRecord(
      project.id,
      item,
      codebook.id,
      "sample_size",
      "100",
      null,
      null,
    );
    // addManualRecord already confirms (source='human'); reset to simulate
    // an AI suggestion with no locatable quote, i.e. no pending_position.
    await databaseService.init();
    await databaseService.queryAsync(
      `UPDATE coding_records SET confirmed = 0, source = 'ai' WHERE id = ?`,
      [recordId],
    );

    await confirmRecord(recordId, item, "sample_size", "156");

    const [record] = await getCodingRecords(project.id, item.key);
    assert.equal(record.variableValue, "156");
    assert.isFalse(record.confirmed);
    assert.isNull(record.annotationKey);
  });

  it("deleteRecord removes the row", async function () {
    const project = await createProject(`Coding Delete Test ${Date.now()}`);
    const codebook = await saveCodebook(project.id, [
      { name: "x", type: "text" },
    ]);
    const item = await makeTestItem("Delete Item");
    const recordId = await addManualRecord(
      project.id,
      item,
      codebook.id,
      "x",
      "y",
      null,
      null,
    );
    await deleteRecord(recordId);
    const records = await getCodingRecords(project.id, item.key);
    assert.equal(records.length, 0);
  });

  it("getCodingProgress counts confirmed required variables only", async function () {
    const project = await createProject(`Coding Progress Test ${Date.now()}`);
    const codebook = await saveCodebook(project.id, [
      { name: "required_a", type: "text", required: true },
      { name: "required_b", type: "text", required: true },
      { name: "optional_c", type: "text", required: false },
    ]);
    const item = await makeTestItem("Progress Item");

    let progress = await getCodingProgress(
      project.id,
      item.key,
      codebook.variables,
    );
    assert.deepEqual(progress, { requiredTotal: 2, requiredDone: 0 });

    // Confirmed record for a required variable counts.
    await addManualRecord(
      project.id,
      item,
      codebook.id,
      "required_a",
      "value",
      null,
      null,
    );
    // Confirmed record for the optional variable should NOT move the
    // required-variable counter.
    await addManualRecord(
      project.id,
      item,
      codebook.id,
      "optional_c",
      "value",
      null,
      null,
    );

    progress = await getCodingProgress(
      project.id,
      item.key,
      codebook.variables,
    );
    assert.deepEqual(progress, { requiredTotal: 2, requiredDone: 1 });
  });

  it("computeCodingStats counts items in the Coding collection vs. how many have confirmed evidence", async function () {
    const project = await createProject(`Coding Stats Test ${Date.now()}`);
    const codebook = await saveCodebook(project.id, [
      { name: "population", type: "text" },
    ]);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    const codedItem = await makeTestItem("Stats Coded Item");
    codedItem.addToCollection(collections.codingId);
    await codedItem.saveTx();
    await addManualRecord(
      project.id,
      codedItem,
      codebook.id,
      "population",
      "Adults 18-65",
      null,
      null,
    );

    const uncodedItem = await makeTestItem("Stats Uncoded Item");
    uncodedItem.addToCollection(collections.codingId);
    await uncodedItem.saveTx();

    const stats = await computeCodingStats(project.id);
    assert.equal(stats.totalInCoding, 2);
    assert.equal(stats.itemsWithConfirmedEvidence, 1);
  });

  it("Zotero.Reader.open(attachmentId, {annotationKey}) is callable for a real annotation", async function () {
    const project = await createProject(`Coding Reader Test ${Date.now()}`);
    const item = await makeTestItem("Reader Nav Item");
    const attachment = await attachRealPdf(
      item,
      `coding-reader-${Date.now()}.pdf`,
    );
    const annotation = await createRealAnnotation(attachment, "some quote");

    // Not asserting visual scroll position (out of scope per the plan) --
    // just confirming the officially-documented navigation call succeeds
    // against a real attachment + real annotation key without throwing.
    await Zotero.Reader.open(attachment.id, {
      annotationKey: annotation.key,
    });
  });
});
