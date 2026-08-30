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

    await ZoteroPaneGlobal.collectionsView.selectCollection(
      collections.screenQueueId,
    );
    await Zotero.Promise.delay(300);
    await ZoteroPaneGlobal.selectItem(item.id);
    await Zotero.Promise.delay(2000);

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
    await ZoteroPaneGlobal.collectionsView.selectCollection(
      collections.screenQueueId,
    );
    await Zotero.Promise.delay(300);
    await ZoteroPaneGlobal.selectItem(item.id);
    await Zotero.Promise.delay(2000);

    const container = doc.getElementById("zotero-view-item")!;
    const excludeLabel = await pluginString("screen-queue-decision-exclude");
    const excludeBtn = Array.from(
      container.querySelectorAll(".zotero-evidence-buttons button"),
    )
      .filter(visible)
      .find((b) => b.textContent === excludeLabel) as HTMLButtonElement;
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
  });
});
