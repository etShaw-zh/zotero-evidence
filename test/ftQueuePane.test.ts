// Integration test for the FT-Queue item-pane section
// (src/modules/ui/ftQueuePane.ts). Same rationale as
// test/screenQueuePane.test.ts: registerSection can silently fail to
// register at all (no error, nothing renders) if the synchronous onRender
// handler is missing, which pure unit tests around ftScreeningService.ts
// structurally cannot catch.
//
// FT-Screening now renders in BOTH tabs (moved to match codingPane.ts's
// pattern -- deciding include/exclude fundamentally requires reading the
// PDF, so the full interactive workflow (Run AI/Include-Exclude/evidence
// linker) belongs in the reader tab; the library tab keeps a summary for a
// quick glance without opening the PDF). Undo, unlike the decision itself,
// doesn't require the PDF to use safely, so it's available in BOTH tabs --
// only the judgment-making workflow is reader-only. Per codingPane.test.ts's
// documented finding, the reader tab's lazily-rendered interactive content
// isn't reliably automatable in this harness (no typed API to drive
// selecting a section's sidebar tab) -- so, same as that file, the
// reader-tab test here only proves registerSection succeeded (the exact
// class of bug this suite exists to catch); the interactive content itself
// needs a manual GUI check. The library tab's rendering IS fully
// automatable (renders immediately on selection, same as before), so those
// tests cover the actual rendered content.
import { assert } from "chai";
import { config } from "../package.json";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { databaseService } from "../src/modules/db/database";
import { saveCriteria } from "../src/modules/screening/criteriaService";
import {
  confirmDecision,
  markFulltextReady,
} from "../src/modules/screening/ftScreeningService";

// getString() from src/utils/locale.ts can't be imported directly here: it
// reads the bare `addon` global, which only exists inside the real plugin's
// own bundle sandbox, not this test file's separately-bundled sandbox. Go
// through the same Fluent instance via the cross-sandbox api bridge instead
// (same technique used to empirically verify locale-id prefixing earlier).
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
<< /Length 55 >>
stream
BT /F1 24 Tf 72 712 Td (FT QUEUE PANE TEST) Tj ET
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

// #zotero-view-item hosts every registered custom section's body side by
// side (Screen Queue, FT-Queue, Coding all share the same
// `.zotero-evidence-card` class) -- a section that isn't relevant for the
// current item still leaves its own body element in the DOM (just
// collapsed/hidden via Zotero's own section chrome, not removed), so a
// bare `container.querySelector(".zotero-evidence-card")` can silently
// grab a DIFFERENT pane's stale card from whatever item was selected
// before this one. Scope the lookup to the wrapper whose native
// `data-pane` attribute actually names this pane's paneID (same
// fragment-match approach already used by the reader-tab registration
// tests) so each test only ever inspects its own pane's card.
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

// renderCardHeader (paneHelpers.ts) always appends its own Expand/Collapse
// abstract-toggle button directly to the card, outside the
// `.zotero-evidence-judgment-area` div it returns for the pane's own
// content -- that toggle is legitimate in every mode (reader or library,
// decided or not) and isn't part of what "read-only" or "no interactive
// controls" means here. Scoping a "no button" check to this content area
// instead of the whole card is what actually tests the FT-Queue pane's own
// output.
function paneContentArea(card: Element): Element | null {
  return card.querySelector(".zotero-evidence-judgment-area");
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

describe("FT-Queue item-pane section", function () {
  describe("(reader)", function () {
    this.timeout(60000);

    it("registers successfully and is enabled for an FT-Screen Queue item", async function () {
      const project = await createProject(
        `FT Pane Reader Registration Test ${Date.now()}`,
      );
      const collections = resolveProjectCollections(
        getRootCollectionId(project)!,
      );
      await saveCriteria(project.id, "ft", {
        researchQuestion: "Does X help Y?",
        inclusionCriteria: ["Reports quantitative outcomes"],
        exclusionCriteria: ["Pilot study only"],
      });
      await (Zotero as any)[
        config.addonInstance
      ].api.refreshProjectPaneContextCache();

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "FT Pane Reader Registration Test Item");
      await item.saveTx();
      item.addToCollection(collections.ftQueueId);
      await item.saveTx();

      const attachment = await Zotero.Attachments.importFromFile({
        file: writeFixturePdf(`ft-queue-pane-${Date.now()}.pdf`),
        parentItemID: item.id,
        contentType: "application/pdf",
      });

      const win = Zotero.getMainWindow();
      const doc = win.document;
      const ZoteroPaneGlobal = (win as any).ZoteroPane;

      await ZoteroPaneGlobal.collectionsView.selectCollection(
        collections.ftQueueId,
      );
      await Zotero.Promise.delay(300);
      await ZoteroPaneGlobal.selectItem(item.id);
      await Zotero.Promise.delay(300);

      await Zotero.Reader.open(attachment.id);
      await Zotero.Promise.delay(3000);

      // Same defensive search as codingPane.test.ts: a chrome-privileged DOM
      // can contain exotic elements whose `.id` isn't a plain string.
      const paneIdFragment = "zotero-evidence-ft-queue";
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
        "registerSection for the FT-Queue pane should have created a DOM " +
          "element referencing its paneID somewhere in the reader UI (proves " +
          "registration succeeded for tabType: reader, i.e. onRender was " +
          "provided alongside onAsyncRender)",
      );

      // See codingPane.test.ts's identical cleanup for why: Zotero.Reader.open()
      // leaves this reader tab open/focused, which would otherwise bleed into
      // every later library-tab test in this file (and any other file run
      // after it) by making ZoteroPane's selection resolve against the
      // reader's own item pane instead of the library one.
      (win as any).Zotero_Tabs?.closeAll?.();
    });
  });

  // Library tab: renders immediately on selection (no lazy tab-click), so
  // this IS fully automatable -- it's a quick-glance summary (no Run AI/
  // Include-Exclude/evidence-linker controls, those stay reader-only) that
  // still offers Undo, mirroring codingPane.ts's renderCodingSummary except
  // for that one action, which doesn't need the PDF the way the underlying
  // decision does.
  describe("(library tab summary)", function () {
    this.timeout(30000);

    it("shows a read-only 'no record yet' summary with no buttons for a fresh FT-Screen Queue item", async function () {
      const project = await createProject(
        `FT Pane Library Summary Test ${Date.now()}`,
      );
      const collections = resolveProjectCollections(
        getRootCollectionId(project)!,
      );
      await saveCriteria(project.id, "ft", {
        researchQuestion: "Does X help Y?",
        inclusionCriteria: ["Reports quantitative outcomes"],
        exclusionCriteria: ["Pilot study only"],
      });
      await (Zotero as any)[
        config.addonInstance
      ].api.refreshProjectPaneContextCache();

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "FT Pane Library Summary Test Item");
      await item.saveTx();
      item.addToCollection(collections.ftQueueId);
      await item.saveTx();

      const win = Zotero.getMainWindow();
      const doc = win.document;
      const ZoteroPaneGlobal = (win as any).ZoteroPane;
      try {
        await ZoteroPaneGlobal.collectionsView.selectCollection(
          collections.ftQueueId,
        );
        // selectCollection()'s promise can resolve before
        // ZoteroPane.getSelectedCollection() actually reflects the change
        // (a CI-only race: confirmed via a diagnostic dump that on GitHub
        // Actions, resolveContextSync's synchronous getSelectedCollection()
        // read was still returning the OLD/no collection at the moment
        // selectItem() fired below, so onItemChange decided this wasn't an
        // Evidence collection and never hid native sections -- no amount of
        // polling the DOM afterward fixes that, since nothing re-triggers
        // onItemChange once it's made that one-time decision). Poll for the
        // actual selection to be visible before selecting the item.
        await waitUntil(
          () =>
            ZoteroPaneGlobal.getSelectedCollection(true) ===
            collections.ftQueueId,
        );
        await ZoteroPaneGlobal.selectItem(item.id);
        // renderCardHeader adds the .zotero-evidence-card class and the
        // empty .zotero-evidence-judgment-area div SYNCHRONOUSLY, before
        // the pane's own async content (awaited DB calls) fills that area
        // in -- so "the card exists" is true well before rendering is
        // actually done. Poll for the content area to actually have
        // something in it instead.
        const card = await waitForValue(() => {
          const c = doc.getElementById("zotero-view-item");
          if (!c?.classList.contains("zotero-evidence-hide-native"))
            return null;
          const found = findPaneCard(c, "zotero-evidence-ft-queue");
          const area = found && paneContentArea(found);
          return area?.textContent?.trim() ? found : null;
        });

        const container = doc.getElementById("zotero-view-item");
        assert.isNotNull(container, "#zotero-view-item should exist");
        assert.isTrue(
          container!.classList.contains("zotero-evidence-hide-native"),
          "native sections should be hidden while viewing FT-Screen Queue",
        );
        assert.isNotNull(card, "custom FT-Queue card should be rendered");

        assert.isNull(
          paneContentArea(card!)!.querySelector("button"),
          "no screening record yet -- no Undo (or any other) button should render",
        );
        assert.include(
          card!.textContent,
          await pluginString("ft-queue-history-none"),
          "should show the 'no screening record yet' message",
        );
      } catch (e: any) {
        assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
      }
    });

    it("shows the human decision with a working Undo button for an FT-Include item", async function () {
      const project = await createProject(
        `FT Pane Library Include Test ${Date.now()}`,
      );
      const collections = resolveProjectCollections(
        getRootCollectionId(project)!,
      );
      await (Zotero as any)[
        config.addonInstance
      ].api.refreshProjectPaneContextCache();

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "FT Pane Library Include Test Item");
      await item.saveTx();
      item.addToCollection(collections.ftQueueId);
      await item.saveTx();

      await confirmDecision(project.id, item, collections, "include", "test");
      assert.isTrue(item.inCollection(collections.ftIncludeId));

      const win = Zotero.getMainWindow();
      const doc = win.document;
      const ZoteroPaneGlobal = (win as any).ZoteroPane;
      try {
        await ZoteroPaneGlobal.collectionsView.selectCollection(
          collections.ftIncludeId,
        );
        // See the first (library tab summary) test in this file for why:
        // a CI-only race between selectCollection()'s promise resolving
        // and ZoteroPane.getSelectedCollection() actually reflecting it.
        await waitUntil(
          () =>
            ZoteroPaneGlobal.getSelectedCollection(true) ===
            collections.ftIncludeId,
        );
        await ZoteroPaneGlobal.selectItem(item.id);
        // See the earlier waitForValue in this file for why this checks
        // the content area's text and hide-native class, and returns the
        // actual card node, rather than re-querying for it afterward.
        const card = await waitForValue(() => {
          const c = doc.getElementById("zotero-view-item");
          if (!c?.classList.contains("zotero-evidence-hide-native"))
            return null;
          const found = findPaneCard(c, "zotero-evidence-ft-queue");
          const area = found && paneContentArea(found);
          return area?.textContent?.trim() ? found : null;
        });

        const humanLabel = await pluginString("ft-queue-history-human");
        const includeLabel = await pluginString(
          "screen-queue-decision-include",
        );
        assert.include(card.textContent, humanLabel);
        assert.include(card.textContent, includeLabel);

        const undoBtn = paneContentArea(card)!.querySelector(
          "button",
        ) as HTMLButtonElement | null;
        assert.isNotNull(
          undoBtn,
          "library-tab summary should still offer Undo -- reversing a decision " +
            "doesn't require the PDF the way making it does",
        );
        assert.include(
          undoBtn!.textContent,
          await pluginString("ft-queue-undo"),
        );

        undoBtn!.click();
        await Zotero.Promise.delay(1500);
        assert.isFalse(
          item.inCollection(collections.ftIncludeId),
          "clicking Undo from the library tab should actually revert the decision",
        );
        assert.isTrue(item.inCollection(collections.ftQueueId));
      } catch (e: any) {
        assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
      }
    });

    it("shows the AI-picked exclude reason as read-only text with no interactive controls for an FT-Screen Queue item", async function () {
      const project = await createProject(
        `FT Pane Library Exclude Reason Test ${Date.now()}`,
      );
      const collections = resolveProjectCollections(
        getRootCollectionId(project)!,
      );
      await saveCriteria(project.id, "ft", {
        researchQuestion: "Does X help Y?",
        inclusionCriteria: ["Reports quantitative outcomes"],
        exclusionCriteria: ["Pilot study only", "No control group"],
      });
      await (Zotero as any)[
        config.addonInstance
      ].api.refreshProjectPaneContextCache();

      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "FT Pane Library Exclude Reason Test Item");
      await item.saveTx();
      item.addToCollection(collections.ftQueueId);
      await item.saveTx();
      await markFulltextReady(project.id, item, "test");

      // Simulate what runAIJudgment writes once it parses an AI response --
      // no live provider is mocked in this suite (see ftScreening.test.ts),
      // so seed the same columns directly.
      await databaseService.init();
      await databaseService.queryAsync(
        `UPDATE screening_records
       SET ai_decision = 'exclude', ai_reasoning = 'No control arm reported.', exclusion_reason = 'No control group'
       WHERE project_id = ? AND item_key = ? AND stage = 'ft_screening'`,
        [project.id, item.key],
      );

      const win = Zotero.getMainWindow();
      const doc = win.document;
      const ZoteroPaneGlobal = (win as any).ZoteroPane;
      try {
        await ZoteroPaneGlobal.collectionsView.selectCollection(
          collections.ftQueueId,
        );
        // See the first (library tab summary) test in this file for why:
        // a CI-only race between selectCollection()'s promise resolving
        // and ZoteroPane.getSelectedCollection() actually reflecting it.
        await waitUntil(
          () =>
            ZoteroPaneGlobal.getSelectedCollection(true) ===
            collections.ftQueueId,
        );
        await ZoteroPaneGlobal.selectItem(item.id);
        const card = await waitForValue(() => {
          const c = doc.getElementById("zotero-view-item");
          if (!c?.classList.contains("zotero-evidence-hide-native"))
            return null;
          const found = findPaneCard(c, "zotero-evidence-ft-queue");
          return found?.textContent?.includes("No control arm reported.")
            ? found
            : null;
        });

        const aiLabel = await pluginString("ft-queue-history-ai");
        assert.include(card.textContent, aiLabel);
        assert.include(card.textContent, "No control arm reported.");

        assert.isNull(
          card.querySelector("select"),
          "library-tab summary should never show the manual-link/reason picker",
        );
        assert.isNull(
          paneContentArea(card)!.querySelector("button"),
          "AI suggested exclude but no human decision was confirmed yet -- no " +
            "Confirm/Exclude buttons (reader-only) and no Undo (nothing to undo)",
        );
      } catch (e: any) {
        assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
      }
    });
  });
});
