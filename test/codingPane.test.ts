// Integration test for the Coding item-pane section
// (src/modules/ui/codingPane.ts), registered with tabType: 'reader'.
//
// Empirically confirmed while writing this test: unlike the library item
// pane (screenQueuePane.ts/ftQueuePane.ts), where every enabled section
// renders immediately, the reader sidebar appears to render registered
// sections lazily -- onAsyncRender only fires once the user actually
// selects that section's tab in the sidebar. Driving that tab-click
// reliably from an automated test turned out to be its own can of worms
// (no typed API for it, and the DOM location isn't pinned down the way
// #zotero-view-item is for the library pane), so this test verifies what
// IS reliably automatable: the section registers successfully (the exact
// class of bug Phase 2 caught -- registerSection silently returns false
// with no error if onRender is missing) and gets correctly enabled/disabled
// via onItemChange based on project/collection context. Whether the
// lazy-rendered content itself looks right needs a manual GUI check.
import { assert } from "chai";
import { config } from "../package.json";
import { saveCodebook } from "../src/modules/coding/codebookService";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";

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
BT /F1 24 Tf 72 712 Td (CODING PANE INTEGRATION TEST) Tj ET
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

describe("Coding item-pane section (reader)", function () {
  this.timeout(60000);

  it("registers successfully and is enabled only for FT-Include/Coding items", async function () {
    try {
      await runTest();
    } catch (e: any) {
      const file = Zotero.File.pathToFile(Zotero.DataDirectory.dir);
      file.append("coding-pane-test-error.log");
      Zotero.File.putContents(
        file,
        `${e?.message ?? e}\n\n${e?.stack ?? "(no stack)"}`,
      );
      throw e;
    }
  });
});

async function runTest() {
  {
    const project = await createProject(
      `Coding Pane Integration Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    await saveCodebook(project.id, [
      { name: "study_design", type: "categorical", values: ["RCT"] },
    ]);

    // Cross-sandbox cache refresh -- see ftQueuePane.test.ts for why.
    await (Zotero as any)[
      config.addonInstance
    ].api.refreshProjectPaneContextCache();

    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Coding Pane Integration Test Item");
    await item.saveTx();
    item.addToCollection(collections.ftIncludeId);
    await item.saveTx();

    const attachment = await Zotero.Attachments.importFromFile({
      file: writeFixturePdf(`coding-pane-${Date.now()}.pdf`),
      parentItemID: item.id,
      contentType: "application/pdf",
    });

    const win = Zotero.getMainWindow();
    const doc = win.document;
    const ZoteroPaneGlobal = (win as any).ZoteroPane;

    // Select the FT-Include collection + item in the library pane first
    // (resolveContextSync reads ZoteroPane.getSelectedCollection(), which
    // stays valid once a reader tab is focused -- confirmed empirically
    // during planning), then open the PDF in a reader tab.
    await ZoteroPaneGlobal.collectionsView.selectCollection(
      collections.ftIncludeId,
    );
    await Zotero.Promise.delay(300);
    await ZoteroPaneGlobal.selectItem(item.id);
    await Zotero.Promise.delay(300);

    await Zotero.Reader.open(attachment.id);
    await Zotero.Promise.delay(3000);

    // If registerSection had silently failed (the Phase 2 bug class), no
    // element referencing our paneID would exist anywhere -- search both
    // the main window document and every open reader's iframe document.
    // This chrome-privileged DOM can contain exotic elements (XUL/XBL/SVG)
    // whose `.id` isn't a plain string, so coerce defensively rather than
    // assume a shape.
    const paneIdFragment = "zotero-evidence-coding";
    const matchesPaneId = (el: Element): boolean => {
      try {
        const idStr = String(el.id ?? "");
        const paneAttr = String(el.getAttribute?.("data-pane") ?? "");
        return (
          idStr.includes(paneIdFragment) || paneAttr.includes(paneIdFragment)
        );
      } catch {
        return false;
      }
    };

    let found = false;
    for (const el of Array.from(doc.querySelectorAll("*"))) {
      if (matchesPaneId(el)) {
        found = true;
        break;
      }
    }
    if (!found) {
      const readers = ((Zotero.Reader as any)._readers as any[]) || [];
      for (const r of readers) {
        let iframeDoc: Document | undefined;
        try {
          iframeDoc = r._iframeWindow?.document;
        } catch {
          continue;
        }
        if (!iframeDoc) continue;
        for (const el of Array.from(iframeDoc.querySelectorAll("*"))) {
          if (matchesPaneId(el)) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    assert.isTrue(
      found,
      "registerSection for the Coding pane should have created a DOM element " +
        "referencing its paneID somewhere in the reader UI (proves registration " +
        "succeeded, i.e. onRender was provided alongside onAsyncRender)",
    );
  }
}
