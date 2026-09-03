// Integration test for the Project Overview item-pane section
// (src/modules/ui/projectOverviewPane.ts). Same shape as
// test/taQueuePane.test.ts: exercises the real
// Zotero.ItemPaneManager.registerSection() integration end-to-end, not just
// the pure data-assembly logic.
import { assert } from "chai";
import { config } from "../package.json";
import {
  getLatestCodebook,
  saveCodebook,
} from "../src/modules/coding/codebookService";
import { addManualRecord } from "../src/modules/coding/codingService";
import { processImportedItems } from "../src/modules/dedup/dedupService";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import { getRootCollectionId } from "../src/modules/project/projectContext";
import { createProject } from "../src/modules/project/projectManager";
import { getSelectedCollectionIdCompat } from "../src/modules/ui/paneHelpers";
import { confirmDecision as ftConfirmDecision } from "../src/modules/screening/ftScreeningService";
import { saveCriteria } from "../src/modules/screening/criteriaService";
import { confirmDecision as taConfirmDecision } from "../src/modules/screening/taScreeningService";

// getString() can't be imported directly here -- it reads the real plugin
// bundle's `addon` global, not this test file's own separately-bundled one.
// See taQueuePane.test.ts/ftQueuePane.test.ts for the same pattern.
async function pluginString(
  id: string,
  args?: Record<string, unknown>,
): Promise<string> {
  const addonObj = (Zotero as any)[config.addonInstance];
  const [value] = await addonObj.data.locale.current.formatValues([
    { id: `${config.addonRef}-${id}`, args },
  ]);
  return value;
}

// Zotero.ItemPaneManager keeps a disabled section's previously rendered DOM
// around (hidden, not removed) rather than tearing it down -- a broad
// querySelector can match a stale, already-clicked element left over from a
// different pane's earlier test (or a different section entirely, since
// this pane is the 4th one sharing #zotero-view-item with TA/FT/Coding).
// Scope to elements the user could actually see/click.
function visible<T extends Element>(el: T): boolean {
  return (el as unknown as HTMLElement).offsetParent !== null;
}

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

function dumpPaneDiagnostics(win: Window, doc: Document): string {
  const container = doc.getElementById("zotero-view-item");
  const parts: string[] = [`container=${container ? "found" : "MISSING"}`];
  if (container) {
    parts.push(`container.className=${container.className}`);
    parts.push(
      `container.outerHTML(trunc1500)=${container.outerHTML.slice(0, 1500)}`,
    );
  }
  return parts.join(" | ");
}

// processImportedItems() adds a new item to its per-source-database
// sub-collection (e.g. "Web of Science" under "1. Sources"), NOT to
// "1. Sources" itself -- Zotero's default collection view doesn't surface
// child-collection items in the parent, so selecting collections.sourcesId
// directly would never find the item. The per-source sub-collection is
// still mapped to PaneRole "other" (see projectContext.ts's
// sourceCollectionIds loop), so it's the right "other"-role collection to
// browse here.
async function selectSourceCollectionAndItem(
  ZoteroPaneGlobal: any,
  collectionId: number,
  itemId: number,
): Promise<void> {
  await ZoteroPaneGlobal.collectionsView.selectCollection(collectionId);
  await waitUntil(
    () => getSelectedCollectionIdCompat(ZoteroPaneGlobal) === collectionId,
  );
  await ZoteroPaneGlobal.selectItem(itemId);
}

// #zotero-view-item is shared by all 4 registered sections (TA-Queue,
// FT-Queue, Coding, Project Overview), and Zotero keeps a disabled
// section's previously rendered DOM around (hidden, not removed) rather
// than tearing it down -- by the time this test file's suite runs, the
// other three have very likely already rendered their own
// `.zotero-evidence-card` into this same live window earlier in the same
// mocha run. Filtering by visible() alone isn't enough to disambiguate:
// during the brief window while Zotero is still toggling `hidden` on each
// section (one becoming enabled, the others becoming disabled) in response
// to the same selection change, more than one card can appear visible at
// once, and a naive "first visible" pick can latch onto a stale one from an
// earlier test that just hasn't been hidden yet -- polling then stops right
// there since waitForValue returns on the first truthy result. Anchoring on
// `.zotero-evidence-overview-footer` instead -- a class only this pane ever
// creates -- makes the match unambiguous regardless of that race.
async function waitForOverviewCard(doc: Document): Promise<HTMLElement> {
  return waitForValue(() => {
    const c = doc.getElementById("zotero-view-item");
    if (!c?.classList.contains("zotero-evidence-hide-native")) return null;
    const marker = (
      Array.from(
        c.querySelectorAll(".zotero-evidence-overview-footer"),
      ) as HTMLElement[]
    ).find(visible);
    if (!marker) return null;
    return marker.closest(".zotero-evidence-card") as HTMLElement | null;
  });
}

async function makeImportCandidateItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

describe("Project Overview item-pane section", function () {
  this.timeout(30000);

  it("renders all 5 stage rows with zero counts and all 3 warnings for a fresh, unconfigured project", async function () {
    const project = await createProject(`Overview Fresh Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    const item = await makeImportCandidateItem("Fresh Overview Test Item");
    await processImportedItems(project.id, collections, "Web of Science", [
      item,
    ]);

    await (Zotero as any)[
      config.addonInstance
    ].api.refreshProjectPaneContextCache();

    const win = Zotero.getMainWindow();
    const doc = win.document;
    const ZoteroPaneGlobal = (win as any).ZoteroPane;

    try {
      await selectSourceCollectionAndItem(
        ZoteroPaneGlobal,
        collections.sourceCollectionIds["Web of Science"],
        item.id,
      );
      const card = await waitForOverviewCard(doc);

      const titles = await Promise.all(
        [
          "overview-stage-sources-title",
          "overview-stage-ta-title",
          "overview-stage-ft-title",
          "overview-stage-final-title",
          "overview-stage-coding-title",
        ].map((id) => pluginString(id)),
      );
      const renderedTitles = Array.from(
        card.querySelectorAll(".zotero-evidence-section h3"),
      )
        .filter(visible)
        .map((h) => h.textContent);
      assert.deepEqual(
        renderedTitles,
        titles,
        "all 5 stage rows should render in pipeline order",
      );

      const warnings = Array.from(
        card.querySelectorAll(".zotero-evidence-overview-warning"),
      ).filter(visible);
      assert.equal(
        warnings.length,
        3,
        "TA criteria, FT criteria, and Codebook are all unconfigured -- 3 warnings expected",
      );
      const noCriteriaText = await pluginString("overview-warning-no-criteria");
      const noCodebookText = await pluginString("overview-warning-no-codebook");
      assert.equal(
        warnings.filter((w) => w.textContent?.includes(noCriteriaText)).length,
        2,
        "TA and FT rows should both show the no-criteria warning",
      );
      assert.equal(
        warnings.filter((w) => w.textContent?.includes(noCodebookText)).length,
        1,
        "Coding row should show the no-codebook warning",
      );

      const statText = card.querySelector(
        ".zotero-evidence-judgment-area",
      )!.textContent!;
      assert.include(
        statText,
        "1",
        "the one imported item should show up as 1 unique record / 1 pending TA item",
      );
    } catch (e: any) {
      assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
    }
  });

  it("reflects real counts and hides warnings once criteria/codebook are configured", async function () {
    const project = await createProject(
      `Overview Configured Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    const included = await makeImportCandidateItem("Configured Include Item");
    const excluded = await makeImportCandidateItem("Configured Exclude Item");
    await processImportedItems(project.id, collections, "Web of Science", [
      included,
      excluded,
    ]);

    await saveCriteria(project.id, "ta", {
      researchQuestion: "Does X help Y?",
      inclusionCriteria: ["Empirical study"],
      exclusionCriteria: ["Not in English"],
    });
    await saveCriteria(project.id, "ft", {
      researchQuestion: "Does X help Y?",
      inclusionCriteria: ["Empirical study"],
      exclusionCriteria: ["Not in English"],
    });
    const codebook = await saveCodebook(project.id, [
      { name: "QA1", type: "text" },
    ]);
    assert.isNotNull(await getLatestCodebook(project.id));

    await taConfirmDecision(
      project.id,
      included,
      collections,
      null,
      "include",
      "test",
    );
    await taConfirmDecision(
      project.id,
      excluded,
      collections,
      null,
      "exclude",
      "test",
      "Not empirical",
    );
    await ftConfirmDecision(
      project.id,
      included,
      collections,
      "include",
      "test",
    );
    await addManualRecord(
      project.id,
      included,
      codebook.id,
      "QA1",
      "yes",
      null,
      null,
    );

    await (Zotero as any)[
      config.addonInstance
    ].api.refreshProjectPaneContextCache();

    const win = Zotero.getMainWindow();
    const doc = win.document;
    const ZoteroPaneGlobal = (win as any).ZoteroPane;

    try {
      // included is still a member of its per-source sub-collection (import
      // never removes it there) even though it's since moved through
      // TA-Include/FT-Include/Coding too -- role resolution keys off the
      // currently BROWSED collection, not the item's own other memberships.
      await selectSourceCollectionAndItem(
        ZoteroPaneGlobal,
        collections.sourceCollectionIds["Web of Science"],
        included.id,
      );
      const card = await waitForOverviewCard(doc);
      await waitUntil(() =>
        (
          card.querySelector(".zotero-evidence-judgment-area")?.textContent ??
          ""
        ).includes("2"),
      );

      const warnings = card.querySelectorAll(
        ".zotero-evidence-overview-warning",
      );
      assert.equal(
        warnings.length,
        0,
        "criteria and codebook are all configured -- no warnings expected",
      );

      const statText = card.querySelector(
        ".zotero-evidence-judgment-area",
      )!.textContent!;
      assert.include(statText, "2", "2 imported records");
      assert.include(
        statText,
        "1",
        "1 final included study / 1 confirmed evidence item",
      );
    } catch (e: any) {
      assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
    }
  });

  it("the TA-Screening row's button navigates to TA-Screen Queue", async function () {
    const project = await createProject(`Overview Nav Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeImportCandidateItem("Nav Test Item");
    await processImportedItems(project.id, collections, "Web of Science", [
      item,
    ]);
    await (Zotero as any)[
      config.addonInstance
    ].api.refreshProjectPaneContextCache();

    const win = Zotero.getMainWindow();
    const doc = win.document;
    const ZoteroPaneGlobal = (win as any).ZoteroPane;

    try {
      await selectSourceCollectionAndItem(
        ZoteroPaneGlobal,
        collections.sourceCollectionIds["Web of Science"],
        item.id,
      );
      const card = await waitForOverviewCard(doc);

      const taTitle = await pluginString("overview-stage-ta-title");
      const enterLabel = await pluginString("overview-button-enter");
      const taSection = Array.from(
        card.querySelectorAll(".zotero-evidence-section"),
      ).find((s) => s.querySelector("h3")?.textContent === taTitle) as
        | HTMLElement
        | undefined;
      assert.isDefined(taSection, "TA-Screening stage row should render");

      const enterBtn = Array.from(
        taSection!.querySelectorAll(".zotero-evidence-overview-footer button"),
      )
        .filter(visible)
        .find((b) => b.textContent === enterLabel) as
        | HTMLButtonElement
        | undefined;
      assert.isDefined(
        enterBtn,
        "TA-Screening row's enter button should render",
      );

      enterBtn!.click();
      await waitUntil(
        () =>
          getSelectedCollectionIdCompat(ZoteroPaneGlobal) ===
          collections.taQueueId,
      );
      assert.equal(
        getSelectedCollectionIdCompat(ZoteroPaneGlobal),
        collections.taQueueId,
        "clicking the TA-Screening row should select TA-Screen Queue",
      );
    } catch (e: any) {
      assert.fail(`${e?.message ?? e} || ${dumpPaneDiagnostics(win, doc)}`);
    }
  });
});
