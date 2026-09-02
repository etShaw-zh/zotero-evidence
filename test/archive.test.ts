import { assert } from "chai";
import { exportProjectArchive } from "../src/modules/archive/archiveExportService";
import { importProjectArchive } from "../src/modules/archive/archiveImportService";
import { saveCodebook } from "../src/modules/coding/codebookService";
import { databaseService } from "../src/modules/db/database";
import {
  resolveProjectCollections,
  SOURCE_DATABASE_LABELS,
} from "../src/modules/project/collectionStructure";
import { ensureSourceCollection } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { saveCriteria } from "../src/modules/screening/criteriaService";

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
<< /Length 60 >>
stream
BT /F1 24 Tf 72 712 Td (ARCHIVE ROUND TRIP TEST) Tj ET
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

describe("Archive & Share (export/restore round trip)", function () {
  this.timeout(60000);

  it("exportProjectArchive + importProjectArchive round-trips items, PDFs, annotations, and every DB table", async function () {
    const projectName = `Archive RT Test ${Date.now()}`;
    const project = await createProject(projectName);
    const rootId = getRootCollectionId(project)!;
    const collections = resolveProjectCollections(rootId);
    const wosId = await ensureSourceCollection(
      collections.sourcesId,
      collections.libraryID,
      SOURCE_DATABASE_LABELS[0],
    );

    const item = new Zotero.Item("journalArticle");
    item.libraryID = collections.libraryID;
    item.setField("title", "Archive Round Trip Item");
    item.setField("date", "2024");
    await item.saveTx();
    // Multiple roles at once -- exercises the roles[] array, not just a
    // single collection.
    item.addToCollection(wosId);
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    const attachment = await Zotero.Attachments.importFromFile({
      file: writeFixturePdf(`archive-rt-${Date.now()}.pdf`),
      parentItemID: item.id,
      contentType: "application/pdf",
    });

    const annotation = new Zotero.Item("annotation");
    annotation.libraryID = attachment.libraryID;
    (annotation as any).parentID = attachment.id;
    (annotation as any).annotationType = "highlight";
    (annotation as any).annotationText = "adults aged 18-65";
    (annotation as any).annotationComment = "eligibility evidence";
    (annotation as any).annotationColor = "#2ea8e5";
    (annotation as any).annotationPosition = JSON.stringify({
      pageIndex: 0,
      rects: [[0, 0, 100, 20]],
    });
    (annotation as any).annotationPageLabel = "1";
    (annotation as any).annotationSortIndex = "00000|000000|00000";
    await annotation.saveTx();

    await databaseService.init();
    const criteria = await saveCriteria(project.id, "ta", {
      researchQuestion: "Does X help Y?",
      inclusionCriteria: ["Empirical study"],
      exclusionCriteria: ["Not in English"],
    });
    await databaseService.queryAsync(
      `INSERT INTO screening_records
        (project_id, item_key, stage, criteria_id, decision, annotation_key, decided_at, ai_decision, ai_model)
       VALUES (?, ?, 'ta_screening', ?, 'include', ?, ?, 'include', 'gpt-4o-mini')`,
      [
        project.id,
        item.key,
        criteria.id,
        annotation.key,
        new Date().toISOString(),
      ],
    );

    const codebook = await saveCodebook(project.id, [
      { name: "population", type: "text" },
    ]);
    await databaseService.queryAsync(
      `INSERT INTO coding_records
        (project_id, codebook_id, item_key, annotation_key, variable_name, variable_value,
         confirmed, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'population', 'Adults 18-65', 1, ?, ?)`,
      [
        project.id,
        codebook.id,
        item.key,
        annotation.key,
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    );
    const codingRecordId = await databaseService.getLastInsertId();
    await databaseService.queryAsync(
      `INSERT INTO synthesis_themes (coding_record_id, theme, created_at, updated_at)
       VALUES (?, 'Population characteristics', ?, ?)`,
      [codingRecordId, new Date().toISOString(), new Date().toISOString()],
    );

    const zipFile = Zotero.File.pathToFile(Zotero.DataDirectory.dir) as any;
    zipFile.append(`archive-rt-${Date.now()}.zip`);
    await exportProjectArchive(project.id, zipFile.path);
    assert.isTrue(zipFile.exists(), "archive .zip should have been created");

    // The original (un-archived) project is still in the library under
    // `project.name`, so the restore collides with it and gets suffixed --
    // see the dedicated collision test below for why that's correct.
    const restored = await importProjectArchive(zipFile.path);
    assert.equal(restored.name, `${project.name} (2)`);

    const restoredCollections = resolveProjectCollections(
      getRootCollectionId(restored)!,
    );

    const taQueueItems = (
      Zotero.Collections.get(restoredCollections.taQueueId) as Zotero.Collection
    ).getChildItems();
    assert.equal(taQueueItems.length, 1);
    const restoredItem = taQueueItems[0];
    assert.equal(restoredItem.getField("title"), "Archive Round Trip Item");
    assert.notEqual(
      restoredItem.key,
      item.key,
      "restored item must get a fresh key, not reuse the original",
    );

    const wosItems = (
      Zotero.Collections.get(
        restoredCollections.sourceCollectionIds[SOURCE_DATABASE_LABELS[0]],
      ) as Zotero.Collection
    ).getChildItems();
    assert.equal(
      wosItems[0]?.id,
      restoredItem.id,
      "item should be re-filed into every original role, not just one",
    );

    const restoredAttachmentIds = restoredItem.getAttachments(false);
    assert.equal(restoredAttachmentIds.length, 1);
    const restoredAttachment = Zotero.Items.get(restoredAttachmentIds[0]);
    assert.isTrue(restoredAttachment.isPDFAttachment());

    const restoredAnnotations = restoredAttachment.getAnnotations(false);
    assert.equal(restoredAnnotations.length, 1);
    const restoredAnnotation = restoredAnnotations[0];
    assert.equal(
      (restoredAnnotation as any).annotationText,
      "adults aged 18-65",
    );
    assert.equal((restoredAnnotation as any).annotationColor, "#2ea8e5");
    assert.notEqual(
      restoredAnnotation.key,
      annotation.key,
      "restored annotation must get a fresh key",
    );

    const screeningRows = (await databaseService.queryAsync(
      `SELECT * FROM screening_records WHERE project_id = ?`,
      [restored.id],
    )) as any[];
    assert.equal(screeningRows.length, 1);
    assert.equal(screeningRows[0].item_key, restoredItem.key);
    assert.equal(screeningRows[0].decision, "include");
    assert.equal(screeningRows[0].annotation_key, restoredAnnotation.key);
    assert.equal(screeningRows[0].ai_decision, "include");
    assert.equal(screeningRows[0].ai_model, "gpt-4o-mini");

    const codingRows = (await databaseService.queryAsync(
      `SELECT * FROM coding_records WHERE project_id = ?`,
      [restored.id],
    )) as any[];
    assert.equal(codingRows.length, 1);
    assert.equal(codingRows[0].item_key, restoredItem.key);
    assert.equal(codingRows[0].variable_value, "Adults 18-65");
    assert.equal(codingRows[0].annotation_key, restoredAnnotation.key);

    const themeRows = (await databaseService.queryAsync(
      `SELECT st.* FROM synthesis_themes st
       JOIN coding_records cr ON cr.id = st.coding_record_id
       WHERE cr.project_id = ?`,
      [restored.id],
    )) as any[];
    assert.equal(themeRows.length, 1);
    assert.equal(themeRows[0].theme, "Population characteristics");
  });

  it("restoring the same archive twice auto-suffixes the project name instead of colliding", async function () {
    const project = await createProject(`Archive Collision Test ${Date.now()}`);
    const zipFile = Zotero.File.pathToFile(Zotero.DataDirectory.dir) as any;
    zipFile.append(`archive-collision-${Date.now()}.zip`);
    await exportProjectArchive(project.id, zipFile.path);

    // The original (un-archived) project is still sitting in the library
    // under `project.name`, so even the FIRST restore already collides with
    // it -- that's correct: an archive is meant to be restorable while the
    // project it came from still exists, not just when restoring the same
    // archive more than once.
    const first = await importProjectArchive(zipFile.path);
    const second = await importProjectArchive(zipFile.path);
    assert.equal(first.name, `${project.name} (2)`);
    assert.equal(second.name, `${project.name} (3)`);
    assert.notEqual(first.id, second.id);
  });

  it("importProjectArchive restores into an explicitly chosen library rather than always the personal one", async function () {
    // No real Group library is constructible offline in this test harness
    // (see import.test.ts's equivalent createProject test) -- this proves
    // the libraryID parameter threads all the way through to the restored
    // project rather than being silently ignored, using the only library
    // actually available here.
    const libraryID = Zotero.Libraries.userLibraryID;
    const project = await createProject(`Archive Library Test ${Date.now()}`);
    const zipFile = Zotero.File.pathToFile(Zotero.DataDirectory.dir) as any;
    zipFile.append(`archive-library-${Date.now()}.zip`);
    await exportProjectArchive(project.id, zipFile.path);

    const restored = await importProjectArchive(zipFile.path, libraryID);
    assert.equal(restored.libraryID, libraryID);
    const collections = resolveProjectCollections(
      getRootCollectionId(restored)!,
    );
    assert.equal(collections.libraryID, libraryID);
  });
});
