// Integration test for the FTS-06/COD-04 highlight pipeline end-to-end:
// real PDF fixture -> MuPDF worker extraction -> quote location (no
// annotation created yet) -> materialization into a real, correctly
// colored/positioned Zotero annotation once "confirmed". Exercises
// src/modules/pdf/pdfAnnotationCreator.ts directly (bypassing
// runAIJudgment/generateSuggestions' AI call, which this codebase has no
// mock-server infrastructure for) -- the DB write-through of pending
// positions and confirmed annotation keys is covered separately in
// ftScreening.test.ts (confirmDecision) and coding.test.ts (confirmRecord).
import { assert } from "chai";
import { FT_SCREENING_ANNOTATION_COLOR } from "../src/utils/annotationColors";
import {
  locateQuoteInAttachment,
  materializePendingHighlight,
} from "../src/modules/pdf/pdfAnnotationCreator";

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
<< /Length 92 >>
stream
BT /F1 14 Tf 72 700 Td (The study included 156 participants with type 2 diabetes.) Tj ET
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

async function makeItemWithPdf(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  const attachment = await Zotero.Attachments.importFromFile({
    file: writeFixturePdf(`auto-highlight-${Date.now()}.pdf`),
    parentItemID: item.id,
    contentType: "application/pdf",
  });
  return attachment as Zotero.Item;
}

describe("Phase 6 followup: pdfAnnotationCreator (locate + materialize)", function () {
  this.timeout(30000);

  it("locateQuoteInAttachment finds a real quote without creating anything", async function () {
    const attachment = await makeItemWithPdf("Locate Only Match Item");

    const located = await locateQuoteInAttachment(
      attachment,
      "156 participants",
    );
    assert.isNotNull(located);
    assert.equal(located!.pageIndex, 0);
    assert.isAbove(located!.rects.length, 0);
    assert.match(located!.sortIndex, /^\d{5}\|\d{6}\|\d{5}$/);
    // Nothing was actually written to the PDF yet.
    assert.equal(attachment.getAnnotations().length, 0);
  });

  it("locateQuoteInAttachment returns null when the quote isn't in the PDF", async function () {
    const attachment = await makeItemWithPdf("Locate Only No Match Item");
    const located = await locateQuoteInAttachment(
      attachment,
      "a sentence that does not appear anywhere in this document",
    );
    assert.isNull(located);
  });

  it("materializePendingHighlight creates a correctly colored, positioned highlight from a located quote", async function () {
    const attachment = await makeItemWithPdf("Materialize Item");
    const located = await locateQuoteInAttachment(
      attachment,
      "156 participants",
    );
    assert.isNotNull(located);

    const key = await materializePendingHighlight(
      attachment,
      JSON.stringify(located),
      FT_SCREENING_ANNOTATION_COLOR,
      "156 participants",
    );

    const annotation = Zotero.Items.getByLibraryAndKey(
      attachment.libraryID,
      key,
    ) as Zotero.Item;
    assert.isOk(annotation);
    assert.equal((annotation as any).annotationType, "highlight");
    assert.equal(annotation.annotationColor, FT_SCREENING_ANNOTATION_COLOR);
    assert.equal((annotation as any).parentID, attachment.id);

    const position = JSON.parse((annotation as any).annotationPosition);
    assert.equal(position.pageIndex, 0);
    assert.isArray(position.rects);
    assert.isAbove(position.rects.length, 0);
    assert.match(
      (annotation as any).annotationSortIndex,
      /^\d{5}\|\d{6}\|\d{5}$/,
    );
    assert.equal(attachment.getAnnotations().length, 1);
  });
});
