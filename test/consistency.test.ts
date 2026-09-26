import { assert } from "chai";
import { databaseService } from "../src/modules/db/database";
import { createProject } from "../src/modules/project/projectManager";
import { getFinalVerdictConsistency } from "../src/modules/consistency/consistencyService";

async function makeTestItem(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

describe("Screening Consistency: getFinalVerdictConsistency (project + DB)", function () {
  this.timeout(60000);

  it("derives 'exclude' straight from a TA-exclude, needing no FT row on either side", async function () {
    const project = await createProject(
      `Final Verdict TA Exclude Test ${Date.now()}`,
    );
    await databaseService.init();
    const item = await makeTestItem("TA Excluded Both Sides");
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
       VALUES (?, ?, 'ta_screening', 'exclude', 'exclude')`,
      [project.id, item.key],
    );

    const result = await getFinalVerdictConsistency(project.id);
    assert.equal(result.n, 1);
    assert.equal(result.disagreements.length, 0);
  });

  it("derives 'include' from TA-include/unclear followed by FT-include, and 'exclude' from anything else at FT", async function () {
    const project = await createProject(
      `Final Verdict TA Then FT Test ${Date.now()}`,
    );
    await databaseService.init();
    const items = await Promise.all([
      makeTestItem("Both Include"), // AI+human both TA-include, FT-include -> agree include
      makeTestItem("AI Include Human FT Exclude"), // disagreement, originates at FT
      makeTestItem("AI Unclear At TA Then FT Include"), // TA 'unclear' behaves like TA-include
    ]);
    const [bothInclude, disagreeAtFt, unclearThenInclude] = items;

    for (const key of [bothInclude.key, disagreeAtFt.key]) {
      await databaseService.queryAsync(
        `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
         VALUES (?, ?, 'ta_screening', 'include', 'include')`,
        [project.id, key],
      );
    }
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
       VALUES (?, ?, 'ft_screening', 'include', 'include')`,
      [project.id, bothInclude.key],
    );
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
       VALUES (?, ?, 'ft_screening', 'include', 'exclude')`,
      [project.id, disagreeAtFt.key],
    );

    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
       VALUES (?, ?, 'ta_screening', 'unclear', 'unclear')`,
      [project.id, unclearThenInclude.key],
    );
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
       VALUES (?, ?, 'ft_screening', 'include', 'include')`,
      [project.id, unclearThenInclude.key],
    );

    const result = await getFinalVerdictConsistency(project.id);
    assert.equal(result.n, 3);
    assert.equal(result.disagreements.length, 1);
    assert.equal(result.disagreements[0].itemKey, disagreeAtFt.key);
    assert.equal(result.disagreements[0].aiDecision, "include");
    assert.equal(result.disagreements[0].humanDecision, "exclude");

    const byName = new Map(result.byCategory.map((c) => [c.category, c]));
    assert.isTrue(byName.has("include"));
    assert.isTrue(byName.has("exclude"));
  });

  it("excludes an item from n when either side TA-passed it but hasn't recorded an FT decision yet", async function () {
    const project = await createProject(
      `Final Verdict Pending FT Test ${Date.now()}`,
    );
    await databaseService.init();
    const item = await makeTestItem("Pending FT Item");
    // Both sides TA-included it, but only the AI has gone on to FT --
    // human_decision at FT is still unset.
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
       VALUES (?, ?, 'ta_screening', 'include', 'include')`,
      [project.id, item.key],
    );
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision)
       VALUES (?, ?, 'ft_screening', 'include')`,
      [project.id, item.key],
    );

    const result = await getFinalVerdictConsistency(project.id);
    assert.equal(result.n, 0);
    assert.isNull(result.observedAgreement);
    assert.isNull(result.kappa);
  });

  it("keeps TA-exclude authoritative even if a stray FT row exists for the same item", async function () {
    // Shouldn't normally happen (an item TA-excluded never reaches
    // FT-Screen Queue in the real pipeline), but deriveVerdict must not
    // let a stray FT row override a TA-exclude either way.
    const project = await createProject(
      `Final Verdict Stray FT Test ${Date.now()}`,
    );
    await databaseService.init();
    const item = await makeTestItem("Stray FT Row Item");
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
       VALUES (?, ?, 'ta_screening', 'exclude', 'exclude')`,
      [project.id, item.key],
    );
    await databaseService.queryAsync(
      `INSERT INTO screening_records (project_id, item_key, stage, ai_decision, human_decision)
       VALUES (?, ?, 'ft_screening', 'include', 'include')`,
      [project.id, item.key],
    );

    const result = await getFinalVerdictConsistency(project.id);
    assert.equal(result.n, 1);
    assert.equal(result.disagreements.length, 0); // both still "exclude"
  });
});
