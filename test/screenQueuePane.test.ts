// Integration test for the Screen Queue item-pane section
// (src/modules/ui/screenQueuePane.ts). This exercises the real
// Zotero.ItemPaneManager.registerSection() integration end-to-end -- unit
// tests around the pure context-resolution logic aren't enough to catch
// registration/rendering failures, which is exactly what this test caught
// once (registerSection silently returns `false`, and nothing renders, if
// no synchronous onRender handler is provided alongside onAsyncRender).
import { assert } from "chai";
import { config } from "../package.json";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { databaseService } from "../src/modules/db/database";
import { saveCriteria } from "../src/modules/screening/criteriaService";
import { getScreeningState } from "../src/modules/screening/taScreeningService";
import { getSelectedCollectionIdCompat } from "../src/modules/ui/paneHelpers";

// getString() can't be imported directly here -- see ftQueuePane.test.ts for
// why (it reads the real plugin bundle's `addon` global).
async function pluginString(id: string): Promise<string> {
  const addonObj = (Zotero as any)[config.addonInstance];
  const [value] = await addonObj.data.locale.current.formatValues([
    { id: `${config.addonRef}-${id}` },
  ]);
  return value;
}

// Screen Queue and FT-Queue share renderCardHeader's markup (same class
// names), and Zotero.ItemPaneManager keeps a disabled section's previously
// rendered DOM around (hidden, not removed) rather than tearing it down --
// so a broad querySelector can match a stale, already-clicked element left
// over from a different pane's earlier test. Scope to elements the user
// could actually see/click.
function visible<T extends Element>(el: T): boolean {
  return (el as unknown as HTMLElement).offsetParent !== null;
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
// is non-enumerable and gets dropped by whatever naive
// JSON-stringifies exceptions crossing the Node<->Zotero process boundary
// in zotero-plugin-scaffold's reporter (chai's AssertionError sets message
// as an own/enumerable property, which is why plain `assert.x()` failures
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

describe("Screen Queue item-pane section", function () {
  this.timeout(30000);

  it("renders the custom card and hides native sections in Screen Queue", async function () {
    const project = await createProject(`Pane Integration Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    await saveCriteria(project.id, "ta", {
      researchQuestion: "Does X help Y?",
      inclusionCriteria: ["Empirical study"],
      exclusionCriteria: ["Not in English"],
    });

    // The pane's context cache lives in the real plugin's own bundle, not
    // this test file's bundle (each is a separately-loaded temporary
    // add-on with independent module state) -- refresh it through the
    // shared Zotero[addonInstance].api bridge, same as commands.ts does
    // after creating a project via the UI.
    await (Zotero as any)[
      config.addonInstance
    ].api.refreshProjectPaneContextCache();

    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Pane Integration Test Item");
    item.setField("abstractNote", "Integration test abstract.");
    await item.saveTx();
    item.addToCollection(collections.screenQueueId);
    await item.saveTx();

    const win = Zotero.getMainWindow();
    const doc = win.document;
    const ZoteroPaneGlobal = (win as any).ZoteroPane;

    try {
      await ZoteroPaneGlobal.collectionsView.selectCollection(
        collections.screenQueueId,
      );
      // selectCollection()'s promise can resolve before
      // ZoteroPane.getSelectedCollection() actually reflects the change (a
      // CI-only race: confirmed via a diagnostic dump that on GitHub
      // Actions, resolveContextSync's synchronous getSelectedCollection()
      // read was still returning the OLD/no collection at the moment
      // selectItem() fired below, so onItemChange decided this wasn't an
      // Evidence collection and never hid native sections -- no amount of
      // polling the DOM afterward fixes that, since nothing re-triggers
      // onItemChange once it's made that one-time decision). Poll for the
      // actual selection to be visible before selecting the item.
      await waitUntil(
        () =>
          getSelectedCollectionIdCompat(ZoteroPaneGlobal) ===
          collections.screenQueueId,
      );
      await ZoteroPaneGlobal.selectItem(item.id);
      await waitForValue(() => {
        const c = doc.getElementById("zotero-view-item");
        if (!c?.classList.contains("zotero-evidence-hide-native")) return null;
        return c.querySelector(".zotero-evidence-card");
      });

      const container = doc.getElementById("zotero-view-item");
      assert.isNotNull(container, "#zotero-view-item should exist");

      assert.isTrue(
        container!.classList.contains("zotero-evidence-hide-native"),
        "native sections should be hidden while viewing Screen Queue",
      );
      // Built-in sections carry a data-pane attribute; plugin-registered
      // sections render as <item-pane-custom-section> wrapping our own
      // markup, so match on our own card class instead.
      assert.isNotNull(
        container!.querySelector(".zotero-evidence-card"),
        "custom Screen Queue card should be rendered",
      );
      assert.isNotNull(
        container!.querySelector(".zotero-evidence-judgment-area"),
        "judgment area should be rendered",
      );
    } catch (e: any) {
      assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
    }
  });

  it("Exclude confirms immediately with no reason picker (TA never captures a reason)", async function () {
    const project = await createProject(
      `Pane Exclude No Reason Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    await saveCriteria(project.id, "ta", {
      researchQuestion: "Does X help Y?",
      inclusionCriteria: ["Empirical study"],
      exclusionCriteria: ["Not in English", "Wrong population"],
    });
    await (Zotero as any)[
      config.addonInstance
    ].api.refreshProjectPaneContextCache();

    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "Exclude No Reason Pane Test Item");
    await item.saveTx();
    item.addToCollection(collections.screenQueueId);
    await item.saveTx();

    // renderJudgmentContent only shows the Include/Exclude/Unclear buttons
    // once a screening_records row exists (normally created by runAIJudgment,
    // which needs a real AI provider) -- seed a bare row directly, the same
    // shape ftScreeningService.getOrCreateRecordId creates for FT, so the
    // decision buttons render without depending on network access.
    await databaseService.init();
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage) VALUES (?, ?, 'ta_screening')`,
      [project.id, item.key],
    );

    const win = Zotero.getMainWindow();
    const doc = win.document;
    const ZoteroPaneGlobal = (win as any).ZoteroPane;
    try {
      await ZoteroPaneGlobal.collectionsView.selectCollection(
        collections.screenQueueId,
      );
      // See the first test in this file for why: a CI-only race between
      // selectCollection()'s promise resolving and
      // ZoteroPane.getSelectedCollection() actually reflecting it.
      await waitUntil(
        () =>
          getSelectedCollectionIdCompat(ZoteroPaneGlobal) ===
          collections.screenQueueId,
      );
      await ZoteroPaneGlobal.selectItem(item.id);
      const excludeLabel = await pluginString("screen-queue-decision-exclude");
      const excludeBtn = await waitForValue<HTMLButtonElement>(() => {
        const c = doc.getElementById("zotero-view-item");
        if (!c?.classList.contains("zotero-evidence-hide-native")) return null;
        return (
          (
            Array.from(
              c.querySelectorAll(".zotero-evidence-buttons button"),
            ) as HTMLButtonElement[]
          )
            .filter(visible)
            .find((b) => b.textContent === excludeLabel) ?? null
        );
      });
      assert.isDefined(excludeBtn, "Exclude button should be rendered");

      const sectionRoot = excludeBtn.closest(
        ".zotero-evidence-judgment-area",
      ) as HTMLElement;
      assert.isNull(
        sectionRoot.querySelector(".zotero-evidence-exclude-reason"),
        "TA-Screening should never render a reason picker/confirm row",
      );

      excludeBtn.click();
      await Zotero.Promise.delay(500);

      const state = await getScreeningState(project.id, item.key);
      assert.equal(state?.decision, "exclude");
      assert.isNull(state?.exclusionReason);
    } catch (e: any) {
      assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
    }
  });
});
