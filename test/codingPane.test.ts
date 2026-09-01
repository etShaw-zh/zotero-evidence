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
import { addManualRecord } from "../src/modules/coding/codingService";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";

// getString() can't be imported directly here -- see ftQueuePane.test.ts's
// pluginString for why; same cross-sandbox bridge technique.
async function pluginString(id: string): Promise<string> {
  const addonObj = (Zotero as any)[config.addonInstance];
  const [value] = await addonObj.data.locale.current.formatValues([
    { id: `${config.addonRef}-${id}` },
  ]);
  return value;
}

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

// See ftQueuePane.test.ts's identical helper for why: #zotero-view-item
// hosts every registered custom section's body side by side (Screen Queue,
// FT-Queue, Coding all share the `.zotero-evidence-card` class), and a
// section that isn't relevant for the current item still leaves its own
// body element in the DOM rather than being removed -- so a bare
// `container.querySelector(".zotero-evidence-card")` can silently grab a
// different pane's stale card. Scope the lookup to the wrapper whose
// native `data-pane` attribute names this pane's paneID.
function findPaneCard(
  container: Element,
  paneIdFragment: string,
): Element | null {
  for (const el of Array.from(container.querySelectorAll("[data-pane]"))) {
    const attr = el.getAttribute("data-pane") || "";
    if (attr.includes(paneIdFragment)) {
      return el.querySelector(".zotero-evidence-card");
    }
  }
  return null;
}

// A fixed sleep before asserting on the rendered pane is inherently a race:
// onAsyncRender runs on its own schedule, and a delay long enough on a fast
// local machine can still be too short on a slower/loaded CI runner (this
// is exactly what caused these tests to pass consistently locally but fail
// intermittently in GitHub Actions). Poll for the actual condition instead,
// bounded by a generous timeout -- resolves as soon as the pane is ready
// and still fails with a clear assertion message if it never is.
async function waitUntil(
  check: () => boolean,
  timeoutMs = 15000,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await Zotero.Promise.delay(intervalMs);
  }
}

// Same race as above, but for assertions that need the actual matched node
// afterward (not just a boolean): polling with waitUntil() and then
// re-querying the DOM in a separate statement leaves a gap -- the `await`
// inside waitUntil's own delay loop yields to the event loop at least once,
// during which a re-render can swap out the exact node the poll just found,
// so the follow-up query can come back empty even though the poll "passed".
// Returning the node directly from inside the synchronous `get()` call that
// found it closes that gap: nothing yields between "found it" and "handed
// it back to the caller".
async function waitForValue<T>(
  get: () => T | null | undefined,
  timeoutMs = 15000,
  intervalMs = 100,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = get();
    if (value) return value;
    await Zotero.Promise.delay(intervalMs);
  }
  throw new Error("waitForValue: timed out waiting for a truthy value");
}

// This suite passes consistently locally but has failed on GitHub Actions
// CI (Linux + a virtual display) even after the waitForValue fix above --
// and the CI reporter shows the failing assertion's message as literally
// "undefined" rather than the real error, because Error.prototype.message
// is non-enumerable and gets dropped by whatever naive JSON-stringifies
// exceptions crossing the Node<->Zotero process boundary in
// zotero-plugin-scaffold's reporter (chai's AssertionError sets message as
// an own/enumerable property, which is why plain `assert.x()` failures
// display fine but a thrown Error's `.message` doesn't). Funneling any
// failure through assert.fail() with a hand-built string sidesteps that:
// the diagnostic actually reaches the CI log instead of being silently
// dropped, which is what's needed to root-cause this without guessing
// again.
function dumpPaneDiagnostics(win: Window, doc: Document): string {
  const container = doc.getElementById("zotero-view-item");
  const parts: string[] = [
    `innerWidth=${(win as any).innerWidth} innerHeight=${(win as any).innerHeight}`,
    `doc.hasFocus()=${doc.hasFocus()}`,
    `visibilityState=${(doc as any).visibilityState}`,
    `container=${container ? "found" : "MISSING"}`,
  ];
  if (container) {
    parts.push(`container.className=${container.className}`);
    parts.push(`container.childElementCount=${container.childElementCount}`);
    parts.push(
      `container.outerHTML(trunc1500)=${container.outerHTML.slice(0, 1500)}`,
    );
  }
  return parts.join(" | ");
}

describe("Coding item-pane section", function () {
  describe("(reader)", function () {
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

      // Zotero.Reader.open() above leaves its reader tab open and focused --
      // without closing it, every later test in the suite that selects a
      // library item still has this reader tab active, so ZoteroPane's
      // selection/pane-context calls resolve against the reader's own item
      // pane (tabType "reader") instead of the library one, wrongly
      // rendering the full interactive editor where a read-only summary was
      // expected. closeAll() leaves the fixed Library tab in place and
      // returns focus to it.
      (win as any).Zotero_Tabs?.closeAll?.();
    }
  }

  // Unlike the reader-tab editor above, this branch renders in the library
  // item pane the same way Screen Queue/FT-Queue do -- immediately on
  // selection, no lazy tab-click needed -- so it's fully automatable.
  describe("(library tab summary)", function () {
    this.timeout(30000);

    it("shows a read-only confirmed-evidence summary with no action buttons", async function () {
      const project = await createProject(`Coding Summary Test ${Date.now()}`);
      const collections = resolveProjectCollections(
        getRootCollectionId(project)!,
      );
      const codebook = await saveCodebook(project.id, [
        { name: "population", type: "text" },
      ]);

      await (Zotero as any)[
        config.addonInstance
      ].api.refreshProjectPaneContextCache();

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Coding Summary Test Item");
      await item.saveTx();
      item.addToCollection(collections.codingId);
      await item.saveTx();

      const attachment = await Zotero.Attachments.importFromFile({
        file: writeFixturePdf(`coding-summary-${Date.now()}.pdf`),
        parentItemID: item.id,
        contentType: "application/pdf",
      });

      const annotation = new Zotero.Item("annotation");
      annotation.libraryID = attachment.libraryID;
      (annotation as any).parentID = attachment.id;
      (annotation as any).annotationType = "highlight";
      (annotation as any).annotationText = "adults aged 18-65";
      (annotation as any).annotationColor = "#00aa00";
      (annotation as any).annotationPosition = JSON.stringify({
        pageIndex: 0,
        rects: [[0, 0, 100, 20]],
      });
      (annotation as any).annotationSortIndex = "00000|000000|00000";
      await annotation.saveTx();

      await addManualRecord(
        project.id,
        item,
        codebook.id,
        "population",
        "Adults 18-65",
        annotation.key,
        null,
      );

      const win = Zotero.getMainWindow();
      const doc = win.document;
      const ZoteroPaneGlobal = (win as any).ZoteroPane;
      try {
        await ZoteroPaneGlobal.collectionsView.selectCollection(
          collections.codingId,
        );
        await Zotero.Promise.delay(300);
        await ZoteroPaneGlobal.selectItem(item.id);
        const confirmedList = await waitForValue(() => {
          const c = doc.getElementById("zotero-view-item");
          if (!c?.classList.contains("zotero-evidence-hide-native"))
            return null;
          return c.querySelector(".zotero-evidence-confirmed-list");
        });

        const container = doc.getElementById("zotero-view-item");
        assert.isNotNull(container, "#zotero-view-item should exist");
        assert.isTrue(
          container!.classList.contains("zotero-evidence-hide-native"),
          "native sections should be hidden while viewing a Coding-collection item",
        );
        assert.isNotNull(
          confirmedList,
          "confirmed-evidence list should be rendered",
        );

        const rowLabel = container!.querySelector(
          ".zotero-evidence-coding-row-label",
        );
        assert.isNotNull(rowLabel);
        assert.include(rowLabel!.textContent, "population");
        assert.include(rowLabel!.textContent, "Adults 18-65");

        // The whole point: no Undo/modify action in this read-only summary.
        assert.isNull(
          container!.querySelector(".zotero-evidence-coding-row-actions"),
          "the library-tab summary must not show the Undo/modify button",
        );
      } catch (e: any) {
        assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
      }
    });

    it("shows an empty-state message for a Coding-collection item with no confirmed evidence yet", async function () {
      const project = await createProject(
        `Coding Summary Empty Test ${Date.now()}`,
      );
      const collections = resolveProjectCollections(
        getRootCollectionId(project)!,
      );
      await saveCodebook(project.id, [{ name: "population", type: "text" }]);

      await (Zotero as any)[
        config.addonInstance
      ].api.refreshProjectPaneContextCache();

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "Coding Summary Empty Test Item");
      await item.saveTx();
      item.addToCollection(collections.codingId);
      await item.saveTx();

      const win = Zotero.getMainWindow();
      const doc = win.document;
      const ZoteroPaneGlobal = (win as any).ZoteroPane;
      try {
        await ZoteroPaneGlobal.collectionsView.selectCollection(
          collections.codingId,
        );
        await Zotero.Promise.delay(300);
        await ZoteroPaneGlobal.selectItem(item.id);
        // renderCardHeader adds the .zotero-evidence-card class and the
        // empty .zotero-evidence-judgment-area div SYNCHRONOUSLY, before
        // the pane's own async content (awaited DB calls) fills that area
        // in -- so "the card exists" is true well before rendering is
        // actually done. Poll for the content area to actually have
        // something in it instead, and hand back the card node itself
        // rather than re-querying for it afterward (see waitForValue's doc
        // comment for why that re-query is a race).
        const card = await waitForValue(() => {
          const c = doc.getElementById("zotero-view-item");
          if (!c?.classList.contains("zotero-evidence-hide-native"))
            return null;
          const found = findPaneCard(c, "zotero-evidence-coding");
          const area = found?.querySelector(".zotero-evidence-judgment-area");
          return area?.textContent?.trim() ? found : null;
        });

        const container = doc.getElementById("zotero-view-item")!;
        assert.isNull(
          container.querySelector(".zotero-evidence-confirmed-list"),
          "no confirmed-evidence list should render when there's nothing confirmed yet",
        );
        const emptyMessage = await pluginString("coding-summary-empty");
        assert.include(card!.textContent, emptyMessage);
      } catch (e: any) {
        assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
      }
    });
  });
});
