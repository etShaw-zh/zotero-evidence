import { assert } from "chai";
import {
  deleteProvider,
  upsertProvider,
} from "../src/modules/ai/providerConfig";
import { createProject } from "../src/modules/project/projectManager";
import { resolveProjectCollections } from "../src/modules/project/collectionStructure";
import {
  findProjectPaneContext,
  getRootCollectionId,
} from "../src/modules/project/projectContext";
import {
  getLatestCriteria,
  saveCriteria,
} from "../src/modules/screening/criteriaService";
import {
  confirmDecision,
  getScreeningState,
  parseJudgment,
  runAIJudgment,
  undoDecision,
} from "../src/modules/screening/taScreeningService";
import {
  isDisagreementFlagged,
  setDisagreementFlag,
} from "../src/modules/consistency/disagreementFlagService";

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  item.setField("abstractNote", "Some abstract text.");
  item.setField("date", "2023");
  await item.saveTx();
  return item;
}

describe("Phase 2: TA-Screening core loop", function () {
  this.timeout(60000);

  it("versions screening criteria on repeated saves", async function () {
    const project = await createProject(`Criteria Test ${Date.now()}`);
    const first = await saveCriteria(project.id, "ta", {
      researchQuestion: "Q1",
      inclusionCriteria: ["A"],
      exclusionCriteria: ["B"],
    });
    assert.equal(first.version, 1);

    const second = await saveCriteria(project.id, "ta", {
      researchQuestion: "Q2",
      inclusionCriteria: ["A", "C"],
      exclusionCriteria: ["B"],
    });
    assert.equal(second.version, 2);

    const latest = await getLatestCriteria(project.id, "ta");
    assert.equal(latest?.version, 2);
    assert.equal(latest?.criteria.researchQuestion, "Q2");
  });

  it("falls back to unclear on unparseable AI responses", function () {
    const good = parseJudgment('{"decision": "include", "reasoning": "fits"}');
    assert.equal(good.decision, "include");
    assert.equal(good.reasoning, "fits");

    const fenced = parseJudgment(
      '```json\n{"decision": "exclude", "reasoning": "no"}\n```',
    );
    assert.equal(fenced.decision, "exclude");

    const garbage = parseJudgment("not json at all");
    assert.equal(garbage.decision, "unclear");
    assert.equal(garbage.reasoning, "not json at all");
  });

  it("confirmDecision(include) moves the item to TA-Include and FT-Queue", async function () {
    const project = await createProject(`Confirm Include Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Include Me");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      null,
      "include",
      "test-user",
    );

    assert.isFalse(item.inCollection(collections.taQueueId));
    assert.isTrue(item.inCollection(collections.taIncludeId));
    assert.isTrue(item.inCollection(collections.ftQueueId));

    const state = await getScreeningState(project.id, item.key);
    assert.equal(state?.decision, "include");
  });

  it("confirmDecision clears a pending reviewer-disagreement flag, regardless of the final decision", async function () {
    const project = await createProject(
      `Confirm Clears Disagreement Flag Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Flagged Disagreement Item");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    // Simulates what humanConsistencyService.ts's applyAgreedResults does
    // when two reviewers disagree on an item -- flags it, then leaves it
    // in TA-Screen Queue for a third reviewer.
    await setDisagreementFlag(item, true);
    assert.isTrue(isDisagreementFlagged(item));

    await confirmDecision(
      project.id,
      item,
      collections,
      null,
      "exclude",
      "third-reviewer",
    );

    assert.isFalse(isDisagreementFlagged(item));
  });

  it("confirmDecision(unclear) also moves the item into FT-Queue", async function () {
    const project = await createProject(`Confirm Unclear Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Unclear Me");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      null,
      "unclear",
      "test-user",
    );

    assert.isTrue(item.inCollection(collections.taUnclearId));
    assert.isTrue(item.inCollection(collections.ftQueueId));
  });

  it("confirmDecision(exclude) does NOT add the item to FT-Queue", async function () {
    const project = await createProject(`Confirm Exclude Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Exclude Me");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      null,
      "exclude",
      "test-user",
      "Not empirical",
    );

    assert.isTrue(item.inCollection(collections.taExcludeId));
    assert.isFalse(item.inCollection(collections.ftQueueId));
    assert.isFalse(item.inCollection(collections.taQueueId));

    const state = await getScreeningState(project.id, item.key);
    assert.equal(state?.exclusionReason, "Not empirical");
  });

  it("confirmDecision(exclude) leaves exclusion_reason null when omitted (backward compat)", async function () {
    const project = await createProject(
      `Confirm Exclude No Reason Test ${Date.now()}`,
    );
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Exclude Me No Reason");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      null,
      "exclude",
      "test-user",
    );

    const state = await getScreeningState(project.id, item.key);
    assert.isNull(state?.exclusionReason);
  });

  it("undoDecision(include) moves the item back to TA-Screen Queue and out of FT-Screen Queue, clearing the decision", async function () {
    const project = await createProject(`Undo Include Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Undo Include Me");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      null,
      "include",
      "test-user",
    );
    assert.isTrue(item.inCollection(collections.taIncludeId));
    assert.isTrue(item.inCollection(collections.ftQueueId));

    await undoDecision(project.id, item, collections);

    assert.isFalse(item.inCollection(collections.taIncludeId));
    assert.isFalse(item.inCollection(collections.ftQueueId));
    assert.isTrue(item.inCollection(collections.taQueueId));

    const state = await getScreeningState(project.id, item.key);
    assert.isNull(state?.decision);
    assert.isNull(state?.exclusionReason);
  });

  it("undoDecision(exclude) moves the item back to TA-Screen Queue without touching FT-Screen Queue", async function () {
    const project = await createProject(`Undo Exclude Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Undo Exclude Me");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    await confirmDecision(
      project.id,
      item,
      collections,
      null,
      "exclude",
      "test-user",
      "Not relevant",
    );
    assert.isTrue(item.inCollection(collections.taExcludeId));
    assert.isFalse(item.inCollection(collections.ftQueueId));

    await undoDecision(project.id, item, collections);

    assert.isFalse(item.inCollection(collections.taExcludeId));
    assert.isFalse(item.inCollection(collections.ftQueueId));
    assert.isTrue(item.inCollection(collections.taQueueId));

    const state = await getScreeningState(project.id, item.key);
    assert.isNull(state?.decision);
    assert.isNull(state?.exclusionReason);
  });

  it("undoDecision no-ops for an item with no recorded TA decision", async function () {
    const project = await createProject(`Undo Noop Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );
    const item = await makeTestItem("Never Screened");
    item.addToCollection(collections.taQueueId);
    await item.saveTx();

    await undoDecision(project.id, item, collections);

    assert.isTrue(item.inCollection(collections.taQueueId));
  });

  it("runAIJudgment refuses to run without a configured provider", async function () {
    deleteProvider("default");
    const project = await createProject(`No Provider Test ${Date.now()}`);
    const item = await makeTestItem("No Provider");
    let threw = false;
    try {
      await runAIJudgment(project.id, item);
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /provider/i);
    }
    assert.isTrue(threw);
  });

  it("runAIJudgment refuses to run without configured criteria", async function () {
    upsertProvider({
      id: "default",
      name: "Test Provider",
      baseURL: "http://127.0.0.1:1/unused",
      apiKey: "test",
      model: "test-model",
    });
    const project = await createProject(`No Criteria Test ${Date.now()}`);
    const item = await makeTestItem("No Criteria");
    let threw = false;
    try {
      await runAIJudgment(project.id, item);
    } catch (e: any) {
      threw = true;
      assert.match(e.message, /criteria/i);
    }
    assert.isTrue(threw);
    deleteProvider("default");
  });

  it("findProjectPaneContext identifies each collection's role (PNL-01/PNL-04)", async function () {
    const project = await createProject(`Pane Context Test ${Date.now()}`);
    const collections = resolveProjectCollections(
      getRootCollectionId(project)!,
    );

    const taQueue = await findProjectPaneContext(collections.taQueueId);
    assert.equal(taQueue?.role, "ta_queue");
    assert.equal(taQueue?.project.id, project.id);

    const taInclude = await findProjectPaneContext(collections.taIncludeId);
    assert.equal(taInclude?.role, "ta_include");

    const taExclude = await findProjectPaneContext(collections.taExcludeId);
    assert.equal(taExclude?.role, "ta_exclude");

    const taUnclear = await findProjectPaneContext(collections.taUnclearId);
    assert.equal(taUnclear?.role, "ta_unclear");

    const ftQueue = await findProjectPaneContext(collections.ftQueueId);
    assert.equal(ftQueue?.role, "ft_queue");

    // Root, Sources, and the TA-/FT-Screening Results PARENT collections
    // (as opposed to their *Include/*Exclude/*Unclear children, asserted
    // above) all resolve to "other" so setNativeSectionsHidden (native
    // panes hidden, title read-only) applies there too, same as every
    // pipeline-stage collection -- none of these are ever populated
    // directly by any service, but a user can still drag an item into one
    // by hand, and projectOverviewPane.ts also renders its project-wide
    // dashboard for this role (see PaneRole's doc comment).
    const root = await findProjectPaneContext(getRootCollectionId(project)!);
    assert.equal(root?.role, "other");
    const sources = await findProjectPaneContext(collections.sourcesId);
    assert.equal(sources?.role, "other");
    const taScreening = await findProjectPaneContext(collections.taScreeningId);
    assert.equal(taScreening?.role, "other");
    const ftScreening = await findProjectPaneContext(collections.ftScreeningId);
    assert.equal(ftScreening?.role, "other");
  });
});
