// Integration test for the FT-Queue item-pane section
// (src/modules/ui/ftQueuePane.ts). Same rationale as
// test/screenQueuePane.test.ts: registerSection can silently fail to
// register at all (no error, nothing renders) if the synchronous onRender
// handler is missing, which pure unit tests around ftScreeningService.ts
// structurally cannot catch.
import { assert } from "chai";
import { config } from "../package.json";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { databaseService } from "../src/modules/db/database";
import { saveCriteria } from "../src/modules/screening/criteriaService";
import {
  confirmDecision,
  getScreeningState,
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

// Screen Queue and FT-Queue share renderCardHeader's markup (same class
// names), and Zotero.ItemPaneManager keeps a disabled section's previously
// rendered DOM around (hidden, not removed) rather than tearing it down --
// so a broad querySelector can match a stale, already-clicked element left
// over from the other pane's test. Scope to elements the user could
// actually see/click.
function visible<T extends Element>(el: T): boolean {
  return (el as unknown as HTMLElement).offsetParent !== null;
}

describe("FT-Queue item-pane section", function () {
  this.timeout(30000);

  it("renders the custom card and hides native sections in FT-Queue", async function () {
    const project = await createProject(
      `FT Pane Integration Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    await saveCriteria(project.id, "ft", {
      researchQuestion: "Does X help Y?",
      inclusionCriteria: ["Reports quantitative outcomes"],
      exclusionCriteria: ["Pilot study only"],
    });

    // The pane's context cache lives in the real plugin's own bundle, not
    // this test file's bundle -- refresh through the shared
    // Zotero[addonInstance].api bridge, same as screenQueuePane.test.ts.
    await (Zotero as any)[
      config.addonInstance
    ].api.refreshProjectPaneContextCache();

    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "FT Pane Integration Test Item");
    await item.saveTx();
    item.addToCollection(collections.ftQueueId);
    await item.saveTx();

    const win = Zotero.getMainWindow();
    const doc = win.document;
    const ZoteroPaneGlobal = (win as any).ZoteroPane;

    await ZoteroPaneGlobal.collectionsView.selectCollection(
      collections.ftQueueId,
    );
    await Zotero.Promise.delay(300);
    await ZoteroPaneGlobal.selectItem(item.id);
    await Zotero.Promise.delay(2000);

    const container = doc.getElementById("zotero-view-item");
    assert.isNotNull(container, "#zotero-view-item should exist");

    assert.isTrue(
      container!.classList.contains("zotero-evidence-hide-native"),
      "native sections should be hidden while viewing FT-Queue",
    );
    assert.isNotNull(
      container!.querySelector(".zotero-evidence-card"),
      "custom FT-Queue card should be rendered",
    );
    assert.isNotNull(
      container!.querySelector(".zotero-evidence-attachment-status"),
      "attachment status line should be rendered",
    );
    const buttons = Array.from(
      container!.querySelectorAll(".zotero-evidence-judgment-area button"),
    ).map((b) => b.textContent);
    assert.include(
      buttons,
      await pluginString("ft-queue-confirm-ready"),
      "should show the confirm-ready button before fulltext_ready is set",
    );
    assert.include(
      buttons,
      await pluginString("ft-queue-mark-unavailable"),
      "should always show the mark-unavailable button",
    );
  });

  it("Exclude confirms the AI-picked reason as read-only text; no manual picker", async function () {
    const project = await createProject(
      `FT Pane Exclude Reason Test ${Date.now()}`,
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
    item.setField("title", "FT Exclude Reason Pane Test Item");
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
    await ZoteroPaneGlobal.collectionsView.selectCollection(
      collections.ftQueueId,
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
    const reasonRow = sectionRoot.querySelector(
      ".zotero-evidence-exclude-reason",
    )!;
    excludeBtn.click();
    assert.isTrue(reasonRow.classList.contains("open"));

    assert.isNull(
      reasonRow.querySelector("select"),
      "FT-Screening should show the AI-picked reason as text, not a picker",
    );
    assert.include(reasonRow.textContent, "No control group");

    const confirmLabel = await pluginString("exclude-reason-confirm");
    const confirmBtn = Array.from(reasonRow.querySelectorAll("button")).find(
      (b) => b.textContent === confirmLabel,
    ) as HTMLButtonElement;
    confirmBtn.click();
    await Zotero.Promise.delay(500);

    const state = await getScreeningState(project.id, item.key);
    assert.equal(state?.decision, "exclude");
    assert.equal(state?.exclusionReason, "No control group");
  });

  it("FT-Include history view shows the decision and an Undo button that reverts it", async function () {
    const project = await createProject(`FT Pane Undo Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    await (Zotero as any)[
      config.addonInstance
    ].api.refreshProjectPaneContextCache();

    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", "FT Pane Undo Test Item");
    await item.saveTx();
    item.addToCollection(collections.ftQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      "include",
      "test-user",
    );
    assert.isTrue(item.inCollection(collections.ftIncludeId));
    assert.isTrue(item.inCollection(collections.codingId));

    const win = Zotero.getMainWindow();
    const doc = win.document;
    const ZoteroPaneGlobal = (win as any).ZoteroPane;
    await ZoteroPaneGlobal.collectionsView.selectCollection(
      collections.ftIncludeId,
    );
    await Zotero.Promise.delay(300);
    await ZoteroPaneGlobal.selectItem(item.id);
    await Zotero.Promise.delay(2000);

    const container = doc.getElementById("zotero-view-item")!;
    const humanLabel = await pluginString("ft-queue-history-human");
    const includeLabel = await pluginString("screen-queue-decision-include");
    const historyText = Array.from(
      container.querySelectorAll(".zotero-evidence-card p"),
    )
      .map((p) => p.textContent)
      .join(" | ");
    assert.include(historyText, humanLabel);
    assert.include(historyText, includeLabel);

    const undoLabel = await pluginString("ft-queue-undo");
    const undoBtn = Array.from(container.querySelectorAll("button"))
      .filter(visible)
      .find((b) => b.textContent === undoLabel) as HTMLButtonElement;
    assert.isDefined(undoBtn, "Undo button should be rendered");
    undoBtn.click();
    await Zotero.Promise.delay(500);

    assert.isFalse(item.inCollection(collections.ftIncludeId));
    assert.isFalse(item.inCollection(collections.codingId));
    assert.isTrue(item.inCollection(collections.ftQueueId));
    const state = await getScreeningState(project.id, item.key);
    assert.isNull(state?.decision);
  });
});
